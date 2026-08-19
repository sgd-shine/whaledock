'use strict';
// macOS 代码签名：默认 ad-hoc（无证书、无费用、不联网、不依赖任何外部服务）。
//
// 为什么必须有这一步：
//   electron-builder 会重写 Info.plist、重命名主可执行文件、注入 app.asar，
//   Electron 官方预编译包自带的签名因此失效，而 CSC_IDENTITY_AUTO_DISCOVERY=false
//   又让 electron-builder 直接跳过重新签名 —— 产物里根本没有 Contents/_CodeSignature。
//   本机构建出来的包没有 quarantine 属性，所以自己用没事；
//   一旦经 GitHub Release 下载，文件被打上 com.apple.quarantine，
//   Gatekeeper 校验包级签名失败，Apple Silicon 上直接弹「已损坏，应移到废纸篓」，
//   右键「打开」也救不回来（macOS 15 起该绕行入口已被移除）。
//
// 打上 ad-hoc 签名后，提示退化为「无法验证开发者」，用户可在
// 系统设置 → 隐私与安全性 → 仍要打开 放行。要做到零提示仍需 Developer ID + 公证：
// 设置 WHALEDOCK_MAC_SIGN_IDENTITY 后本脚本自动切换为正式签名 + Hardened Runtime。
//
// 本文件不 require Electron，纯函数部分可被 test/smoke.js 在任意平台加载。

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AD_HOC_IDENTITY = '-';
const ENTITLEMENTS = path.join(ROOT, 'build', 'entitlements.mac.plist');
const BUNDLE_SUFFIXES = ['.app', '.framework'];

// Mach-O 魔数（薄/胖、大小端）。0xcafebabe 与 Java class 文件冲突，另行判别。
const THIN_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);
const FAT_MAGICS = new Set([0xcafebabe, 0xbebafeca]);

// ---------- 纯函数：可在 Linux/Windows 上测试 ----------

// header 至少 8 字节。胖二进制的 nfat_arch 必须是个小数字，
// 否则就是 Java class（其第 5-8 字节是 minor/major 版本号，通常 >= 0x0034）。
function looksLikeMachO(header) {
  if (!header || header.length < 8) return false;
  const be = header.readUInt32BE(0);
  const le = header.readUInt32LE(0);
  if (THIN_MAGICS.has(be) || THIN_MAGICS.has(le)) return true;
  if (FAT_MAGICS.has(be)) {
    const count = be === 0xcafebabe ? header.readUInt32BE(4) : header.readUInt32LE(4);
    return count > 0 && count < 32;
  }
  return false;
}

// 签名身份：默认 ad-hoc；给了 Developer ID 才开 Hardened Runtime 与 entitlements。
function signingIdentity(env = process.env) {
  const explicit = String(env.WHALEDOCK_MAC_SIGN_IDENTITY || '').trim();
  if (!explicit || explicit === AD_HOC_IDENTITY) {
    return { identity: AD_HOC_IDENTITY, adHoc: true, hardened: false, source: 'ad-hoc' };
  }
  return { identity: explicit, adHoc: false, hardened: true, source: 'developer-id' };
}

// codesign 参数：ad-hoc 不能打时间戳，也不需要 entitlements。
function codesignArgs(target, options = {}) {
  const { identity = AD_HOC_IDENTITY, hardened = false, entitlements = null, adHoc = true } = options;
  const args = ['--force', '--sign', identity];
  args.push(adHoc ? '--timestamp=none' : '--timestamp');
  if (hardened) args.push('--options', 'runtime');
  if (hardened && entitlements) args.push('--entitlements', entitlements);
  args.push(target);
  return args;
}

// 内层先签、外层后签；同层按路径深度倒序，保证嵌套 .app / .framework 不会被外层覆盖前签空。
function depth(p) {
  return path.resolve(p).split(path.sep).length;
}

function orderTargets(appPath, { machoFiles = [], bundleDirs = [] } = {}) {
  const byDeepest = (a, b) => depth(b) - depth(a) || (a < b ? 1 : a > b ? -1 : 0);
  return [
    ...machoFiles.slice().sort(byDeepest),
    ...bundleDirs.slice().sort(byDeepest),
    path.resolve(appPath)
  ];
}

// 遍历 .app，收集所有需要单独签名的 Mach-O 文件与嵌套 bundle。
// 符号链接一律跳过：framework 的 Versions/Current 是链接，跟着走会重复签名。
function collectTargets(appPath) {
  const root = path.resolve(appPath);
  const machoFiles = [];
  const bundleDirs = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'EACCES') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (BUNDLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)) && full !== root) {
          bundleDirs.push(bundleSignTarget(full));
        }
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isMachOFile(full)) machoFiles.push(full);
    }
  };

  walk(root);
  return { machoFiles, bundleDirs };
}

// framework 要签 Versions/A 而不是 framework 目录本身。
function bundleSignTarget(bundlePath) {
  if (!bundlePath.endsWith('.framework')) return bundlePath;
  const versions = path.join(bundlePath, 'Versions');
  if (!fs.existsSync(versions)) return bundlePath;
  const candidates = fs.readdirSync(versions, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'Current')
    .map((entry) => path.join(versions, entry.name))
    .sort();
  return candidates.length ? candidates[candidates.length - 1] : bundlePath;
}

function isMachOFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (error) {
    if (error && (error.code === 'EACCES' || error.code === 'ENOENT')) return false;
    throw error;
  }
  try {
    const header = Buffer.alloc(8);
    const read = fs.readSync(fd, header, 0, 8, 0);
    return read === 8 && looksLikeMachO(header);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- 执行部分：只在 macOS 上真正调用 codesign ----------

function runCodesign(args) {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign ${args.join(' ')} 失败 (exit ${result.status})\n${String(result.stderr || '').trim()}`);
  }
  return String(result.stdout || '') + String(result.stderr || '');
}

function signApp(appPath, env = process.env) {
  if (process.platform !== 'darwin') {
    throw new Error('签名只能在 macOS 上执行');
  }
  const resolved = path.resolve(appPath);
  if (!fs.existsSync(resolved)) throw new Error(`找不到 App：${resolved}`);

  const id = signingIdentity(env);
  const entitlements = fs.existsSync(ENTITLEMENTS) ? ENTITLEMENTS : null;
  if (id.hardened && !entitlements) {
    throw new Error(`正式签名需要 entitlements 文件：${ENTITLEMENTS}`);
  }

  const collected = collectTargets(resolved);
  const targets = orderTargets(resolved, collected);
  console.log(`MACOS_CODESIGN_START identity=${id.source} macho=${collected.machoFiles.length} bundles=${collected.bundleDirs.length}`);

  for (const target of targets) {
    runCodesign(codesignArgs(target, { ...id, entitlements }));
  }

  verifyApp(resolved);
  console.log(`MACOS_CODESIGN_DONE identity=${id.source} targets=${targets.length} app=${resolved}`);
  return { identity: id, targets };
}

// 校验：包级签名必须存在且严格通过。ad-hoc 不做 spctl（本来就过不了，那是公证的事）。
function verifyApp(appPath) {
  const resolved = path.resolve(appPath);
  const seal = path.join(resolved, 'Contents', '_CodeSignature', 'CodeResources');
  if (!fs.existsSync(seal)) {
    throw new Error(`MACOS_CODESIGN_VERIFY_FAIL 缺少包级签名：${seal}`);
  }
  if (process.platform === 'darwin') {
    runCodesign(['--verify', '--strict', '--verbose=2', resolved]);
    const info = runCodesign(['-dv', '--verbose=4', resolved]);
    const authority = /Authority=(.*)/.exec(info);
    const signature = /Signature=(.*)/.exec(info);
    console.log(`MACOS_CODESIGN_VERIFY_PASS app=${resolved} authority=${authority ? authority[1].trim() : (signature ? signature[1].trim() : 'adhoc')}`);
  } else {
    console.log(`MACOS_CODESIGN_SEAL_PRESENT app=${resolved}`);
  }
  return true;
}

// electron-builder afterPack 钩子：打包完立刻签名，dmg/zip 装的就是签好的包。
async function electronBuilderAfterPack(context) {
  if (!context || context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  signApp(appPath);
}

// ---------- CLI ----------

function findAppsUnder(dir) {
  const root = path.resolve(dir);
  const found = [];
  const walk = (current, level) => {
    if (level > 4) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.name.endsWith('.app')) {
        found.push(full);
        continue;
      }
      walk(full, level + 1);
    }
  };
  if (fs.existsSync(root)) walk(root, 0);
  return found.sort();
}

function main(argv) {
  const [command, target] = argv;
  if (command === 'sign') {
    if (!target) throw new Error('用法：node scripts/macos-codesign.js sign <App 路径>');
    signApp(target);
    return;
  }
  if (command === 'verify') {
    if (!target) throw new Error('用法：node scripts/macos-codesign.js verify <App 路径>');
    verifyApp(target);
    return;
  }
  if (command === 'verify-dir') {
    if (!target) throw new Error('用法：node scripts/macos-codesign.js verify-dir <解压后的目录>');
    const apps = findAppsUnder(target);
    if (!apps.length) throw new Error(`目录里没有找到 .app：${target}`);
    for (const app of apps) verifyApp(app);
    console.log(`MACOS_CODESIGN_VERIFY_ALL_PASS apps=${apps.length}`);
    return;
  }
  throw new Error('用法：node scripts/macos-codesign.js <sign|verify|verify-dir> <路径>');
}

module.exports = electronBuilderAfterPack;
module.exports.looksLikeMachO = looksLikeMachO;
module.exports.signingIdentity = signingIdentity;
module.exports.codesignArgs = codesignArgs;
module.exports.orderTargets = orderTargets;
module.exports.collectTargets = collectTargets;
module.exports.bundleSignTarget = bundleSignTarget;
module.exports.isMachOFile = isMachOFile;
module.exports.findAppsUnder = findAppsUnder;
module.exports.signApp = signApp;
module.exports.verifyApp = verifyApp;
module.exports.AD_HOC_IDENTITY = AD_HOC_IDENTITY;
module.exports.ENTITLEMENTS = ENTITLEMENTS;

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error && error.stack || error);
    process.exit(1);
  }
}
