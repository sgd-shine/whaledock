'use strict';
// 构建期准备锁定版 dsh 运行时；运行期不调用 npm，也不修改用户目录。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DEFAULTS } = require('../lib/config');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'vendor', 'dsh-runtime');
const version = String(DEFAULTS.dshVersion || '').trim();
const MANIFEST_SCHEMA_VERSION = 2;
const INSTALL_SCRIPT_ALLOWLIST = new Set([
  '@deepseek-ai/dsh-subprocess-local',
  '@google/genai',
  'koffi',
  'node-pty',
  'protobufjs'
]);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

const targetPlatform = option('platform', process.platform);
const targetArch = option('arch', process.arch);

if (!['darwin', 'win32', 'linux'].includes(targetPlatform)) {
  throw new Error(`不支持的内置引擎目标平台：${targetPlatform}`);
}
if (!['arm64', 'x64'].includes(targetArch)) {
  throw new Error(`不支持的内置引擎目标架构：${targetArch}`);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('DEFAULTS.dshVersion 必须是可复现的固定版本');
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const offset = lockPath.lastIndexOf(marker);
  return offset < 0 ? null : lockPath.slice(offset + marker.length);
}

function validateInstallScriptClosure(lock) {
  const observed = new Set();
  for (const [lockPath, entry] of Object.entries(lock.packages || {})) {
    if (!entry || entry.hasInstallScript !== true) continue;
    const name = packageNameFromLockPath(lockPath);
    if (!name) throw new Error(`无法识别带安装脚本的锁文件条目：${lockPath}`);
    observed.add(name);
  }

  const unknown = [...observed].filter((name) => !INSTALL_SCRIPT_ALLOWLIST.has(name));
  const missing = [...INSTALL_SCRIPT_ALLOWLIST].filter((name) => !observed.has(name));
  if (unknown.length || missing.length) {
    throw new Error([
      '内置 dsh 安装脚本闭包与已审核白名单不一致',
      unknown.length ? `未知：${unknown.sort().join(', ')}` : null,
      missing.length ? `缺失：${missing.sort().join(', ')}` : null
    ].filter(Boolean).join('；'));
  }
  return [...observed].sort();
}

function requireRegularFile(filePath, label) {
  let stat;
  try { stat = fs.statSync(filePath); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isFile()) throw new Error(`${label}不存在：${filePath}`);
  return stat;
}

function requirePackage(packageDir, expectedName, label) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  if (manifest.name !== expectedName) {
    throw new Error(`${label}不匹配：得到 ${manifest.name || '未知'}，预期 ${expectedName}`);
  }
  return manifest;
}

function requireSingleTargetFile(dir, predicate, label) {
  let names;
  try { names = fs.readdirSync(dir).filter(predicate); } catch (_error) { /* 统一报错 */ }
  if (!names || names.length !== 1) {
    throw new Error(`${label}数量异常：${dir}（得到 ${names ? names.length : 0}）`);
  }
  return requireRegularFile(path.join(dir, names[0]), label);
}

function validateTargetRuntime(lock) {
  const installScriptPackages = validateInstallScriptClosure(lock);
  const nodePtyDir = path.join(
    outputDir, 'node_modules', 'node-pty', 'prebuilds', `${targetPlatform}-${targetArch}`
  );
  requireRegularFile(path.join(nodePtyDir, 'pty.node'), '目标 node-pty prebuild');

  if (targetPlatform === 'win32') {
    for (const fileName of ['conpty.node', 'conpty_console_list.node', 'winpty-agent.exe', 'winpty.dll']) {
      requireRegularFile(path.join(nodePtyDir, fileName), `目标 node-pty ${fileName}`);
    }
  } else {
    const spawnHelper = path.join(nodePtyDir, 'spawn-helper');
    requireRegularFile(spawnHelper, '目标 node-pty spawn-helper');
    fs.chmodSync(spawnHelper, 0o755);
    if ((fs.statSync(spawnHelper).mode & 0o111) === 0) {
      throw new Error(`node-pty spawn-helper 不可执行：${spawnHelper}`);
    }
  }

  const koffiName = `@koromix/koffi-${targetPlatform}-${targetArch}`;
  const koffiDir = path.join(outputDir, 'node_modules', '@koromix', `koffi-${targetPlatform}-${targetArch}`);
  requirePackage(koffiDir, koffiName, '目标 koffi 预编译包');
  requireRegularFile(
    path.join(koffiDir, `${targetPlatform}_${targetArch}`, 'koffi.node'),
    '目标 koffi prebuild'
  );

  const sharpName = `@img/sharp-${targetPlatform}-${targetArch}`;
  const sharpDir = path.join(outputDir, 'node_modules', '@img', `sharp-${targetPlatform}-${targetArch}`);
  requirePackage(sharpDir, sharpName, '目标 sharp 预编译包');
  requireSingleTargetFile(
    path.join(sharpDir, 'lib'),
    (name) => name.startsWith(`sharp-${targetPlatform}-${targetArch}-`) && name.endsWith('.node'),
    '目标 sharp 原生模块'
  );

  const ripgrepName = `@vscode/ripgrep-${targetPlatform}-${targetArch}`;
  const ripgrepDir = path.join(outputDir, 'node_modules', '@vscode', `ripgrep-${targetPlatform}-${targetArch}`);
  requirePackage(ripgrepDir, ripgrepName, '目标 ripgrep 预编译包');
  const ripgrep = path.join(ripgrepDir, 'bin', targetPlatform === 'win32' ? 'rg.exe' : 'rg');
  requireRegularFile(ripgrep, '目标 ripgrep 可执行文件');
  if (targetPlatform !== 'win32') {
    fs.chmodSync(ripgrep, 0o755);
    if ((fs.statSync(ripgrep).mode & 0o111) === 0) throw new Error(`ripgrep 不可执行：${ripgrep}`);
  }

  const addonTarget = targetPlatform === 'win32'
    ? `${targetPlatform}-${targetArch}-msvc`
    : targetPlatform === 'linux'
      ? `${targetPlatform}-${targetArch}-gnu`
      : `${targetPlatform}-${targetArch}`;
  const addonName = `node-addon-require-builtin-${addonTarget}`;
  const addonDir = path.join(outputDir, 'node_modules', addonName);
  requirePackage(addonDir, addonName, '目标 node-addon-require-builtin 预编译包');
  requireSingleTargetFile(
    path.join(addonDir, 'prebuilt'),
    (name) => name.startsWith(`${addonTarget}-`) && name.endsWith('.node'),
    '目标 node-addon-require-builtin 原生模块'
  );
  return installScriptPackages;
}

try {
  const current = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  const installed = JSON.parse(fs.readFileSync(path.join(
    outputDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'
  ), 'utf8'));
  if (current.schemaVersion === MANIFEST_SCHEMA_VERSION
      && current.installScriptsIgnored === true
      && current.dshVersion === version
      && current.platform === targetPlatform
      && current.arch === targetArch
      && current.packageIntegrity
      && installed.version === version) {
    const lock = JSON.parse(fs.readFileSync(path.join(outputDir, 'package-lock.json'), 'utf8'));
    validateTargetRuntime(lock);
    console.log(`BUNDLED_DSH_REUSE ${version} ${targetPlatform}/${targetArch}`);
    process.exit(0);
  }
} catch (_e) { /* 缓存缺失或损坏时重新生成 */ }

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify({
  name: 'whaledock-dsh-runtime',
  private: true,
  version: '0.0.0',
  dependencies: {
    '@deepseek-ai/dsh': version
  }
}, null, 2) + '\n');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, [
  'install',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
  '--save-exact',
  '--ignore-scripts',
  `--os=${targetPlatform}`,
  `--cpu=${targetArch}`
], {
  cwd: outputDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    npm_config_platform: targetPlatform,
    npm_config_arch: targetArch
  }
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);

const installedManifestPath = path.join(
  outputDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'
);
const installed = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'));
if (installed.name !== '@deepseek-ai/dsh' || installed.version !== version) {
  throw new Error(`内置 dsh 校验失败：得到 ${installed.name}@${installed.version}，预期 @deepseek-ai/dsh@${version}`);
}

const lock = JSON.parse(fs.readFileSync(path.join(outputDir, 'package-lock.json'), 'utf8'));
const lockEntry = lock.packages && lock.packages['node_modules/@deepseek-ai/dsh'];
if (!lockEntry || lockEntry.version !== version || !lockEntry.integrity) {
  throw new Error('package-lock.json 缺少锁定版 dsh 的完整性信息');
}
const installScriptPackages = validateTargetRuntime(lock);

const manifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  dshVersion: version,
  packageIntegrity: lockEntry.integrity,
  installScriptsIgnored: true,
  installScriptPackages,
  platform: targetPlatform,
  arch: targetArch,
  hostPlatform: process.platform,
  hostArch: process.arch,
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log(`BUNDLED_DSH_READY ${version} ${targetPlatform}/${targetArch}`);
