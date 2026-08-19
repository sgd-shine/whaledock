'use strict';
// macOS 签名脚本直测：纯 Node，可在任意平台跑（不真正调用 codesign）。
// 目的是把「产物必须带包级签名」这条分发红线钉成可回归的合约。
const fs = require('fs');
const os = require('os');
const path = require('path');

const signer = require('../scripts/macos-codesign');

let failed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failed += 1;
}

function machoHeader(magic, next = 0) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(magic, 0);
  buf.writeUInt32BE(next, 4);
  return buf;
}

// 造一个结构与真实 Electron 产物同形的假 .app
function fakeApp(root) {
  const app = path.join(root, 'WhaleDock.app');
  const fw = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework');
  const helper = path.join(app, 'Contents', 'Frameworks', 'WhaleDock Helper.app');
  const resources = path.join(app, 'Contents', 'Resources', 'dsh-runtime', 'node_modules', 'node-pty');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(fw, 'Versions', 'A', 'Libraries'), { recursive: true });
  fs.mkdirSync(path.join(helper, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<plist/>');
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'WhaleDock'), machoHeader(0xfeedfacf));
  fs.writeFileSync(path.join(fw, 'Versions', 'A', 'Electron Framework'), machoHeader(0xfeedfacf));
  fs.writeFileSync(path.join(fw, 'Versions', 'A', 'Libraries', 'libffmpeg.dylib'), machoHeader(0xfeedfacf));
  fs.writeFileSync(path.join(helper, 'Contents', 'MacOS', 'WhaleDock Helper'), machoHeader(0xfeedfacf));
  fs.writeFileSync(path.join(resources, 'pty.node'), machoHeader(0xfeedfacf));
  fs.writeFileSync(path.join(resources, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'app.asar'), Buffer.from([4, 0, 0, 0, 1, 2, 3, 4]));
  // Versions/Current 是符号链接，必须被跳过，否则同一份代码会被签两次
  try {
    fs.symlinkSync('A', path.join(fw, 'Versions', 'Current'), 'dir');
  } catch (_) { /* 平台不支持符号链接时跳过这一项 */ }
  return { app, fw, helper };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-sign-'));
  const { app, fw } = fakeApp(tmp);

  // 魔数判别
  check('sign: 识别 64 位 Mach-O', signer.looksLikeMachO(machoHeader(0xfeedfacf)));
  check('sign: 识别胖二进制', signer.looksLikeMachO(machoHeader(0xcafebabe, 2)));
  check('sign: 不把 Java class 当 Mach-O', !signer.looksLikeMachO(machoHeader(0xcafebabe, 0x0000_0034)));
  check('sign: 不把普通文本当 Mach-O', !signer.looksLikeMachO(Buffer.from('module.ex')));

  // 身份解析：默认 ad-hoc，不开 Hardened Runtime
  const adhoc = signer.signingIdentity({});
  check('sign: 默认 ad-hoc 且不加固', adhoc.identity === '-' && adhoc.adHoc === true && adhoc.hardened === false);
  const devid = signer.signingIdentity({ WHALEDOCK_MAC_SIGN_IDENTITY: 'Developer ID Application: X (Y)' });
  check('sign: 给了 Developer ID 才开 Hardened Runtime',
    devid.adHoc === false && devid.hardened === true && devid.identity === 'Developer ID Application: X (Y)');
  check('sign: 空白身份回落 ad-hoc', signer.signingIdentity({ WHALEDOCK_MAC_SIGN_IDENTITY: '   ' }).adHoc === true);

  // 参数：ad-hoc 不能打时间戳，也不带 entitlements
  const adhocArgs = signer.codesignArgs('/tmp/A.app', { ...adhoc, entitlements: '/tmp/e.plist' });
  check('sign: ad-hoc 参数不含时间戳服务与 entitlements',
    adhocArgs.includes('--timestamp=none') && !adhocArgs.includes('--entitlements') && !adhocArgs.includes('runtime'),
    adhocArgs.join(' '));
  const devArgs = signer.codesignArgs('/tmp/A.app', { ...devid, entitlements: '/tmp/e.plist' });
  check('sign: 正式签名参数含 runtime 与 entitlements',
    devArgs.includes('--options') && devArgs.includes('runtime')
      && devArgs.includes('--entitlements') && devArgs.includes('--timestamp'),
    devArgs.join(' '));

  // 收集与排序
  const collected = signer.collectTargets(app);
  const machoNames = collected.machoFiles.map((p) => path.basename(p)).sort();
  check('sign: 收齐 Frameworks/Helper/Resources 三处 Mach-O',
    collected.machoFiles.length === 5 && machoNames.includes('pty.node') && machoNames.includes('libffmpeg.dylib'),
    machoNames.join(','));
  check('sign: 不把 app.asar 或 js 当 Mach-O', !machoNames.includes('app.asar') && !machoNames.includes('index.js'));
  check('sign: framework 签到 Versions/A 而不是 framework 目录',
    collected.bundleDirs.includes(path.join(fw, 'Versions', 'A')));
  check('sign: 跳过 Versions/Current 符号链接',
    !collected.bundleDirs.some((p) => p.endsWith(path.join('Versions', 'Current'))));

  const order = signer.orderTargets(app, collected);
  const appIndex = order.indexOf(path.resolve(app));
  check('sign: 外层 .app 最后签', appIndex === order.length - 1);
  const firstBundle = order.findIndex((p) => collected.bundleDirs.includes(p));
  const lastMacho = order.reduce((acc, p, i) => (collected.machoFiles.includes(p) ? i : acc), -1);
  check('sign: 所有单体 Mach-O 都排在嵌套 bundle 之前', lastMacho < firstBundle, `${lastMacho} < ${firstBundle}`);
  check('sign: 目标总数 = Mach-O + 嵌套 bundle + 本体',
    order.length === collected.machoFiles.length + collected.bundleDirs.length + 1);

  // 校验合约：没有包级签名必须 fail-closed
  let sealError = null;
  try {
    signer.verifyApp(app);
  } catch (error) {
    sealError = error;
  }
  check('sign: 缺少 _CodeSignature 时校验必须失败', !!sealError && /_CodeSignature/.test(sealError.message));

  fs.mkdirSync(path.join(app, 'Contents', '_CodeSignature'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', '_CodeSignature', 'CodeResources'), '<plist/>');
  if (process.platform !== 'darwin') {
    check('sign: 补上包级签名后非 macOS 侧校验通过', signer.verifyApp(app) === true);
  } else {
    check('sign: macOS 侧留给真实 codesign 校验', true, '由 CI/本机构建执行');
  }

  // 产物扫描
  const apps = signer.findAppsUnder(tmp);
  check('sign: 能从解压目录里找出 .app', apps.length === 1 && apps[0] === path.resolve(app), apps.join(','));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed === 0 ? '\nMACOS_CODESIGN_SMOKE ALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
