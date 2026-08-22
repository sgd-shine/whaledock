'use strict';
// 纯 Node 冒烟测试：不需要 Electron。
// 覆盖：PATH 探测、which、端口探测、用自定义命令启动/停止后端（连进程组一起停）。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { spawnSync } = require('child_process');

const backend = require('../lib/backend');
const config = require('../lib/config');
const log = require('../lib/log');
const update = require('../lib/update');
const macosBuildVisibility = require('../scripts/macos-build-visibility');
const macosCodesign = require('../scripts/macos-codesign');

const PORT = 3123;
let failed = 0;

function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failed += 1;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-smoke-'));

  // config
  const data = config.init(tmp);
  check('config: 默认值加载', data.port === 3080 && data.autoStartBackend === true);
  check('config: 默认锁定后端版本', data.dshVersion === '0.1.0-rc.6');
  check('config: v0.2 五个新字段默认值正确',
    data.preferBundled === false
      && data.openAtLogin === false
      && data.startMinimized === false
      && data.checkUpdates === true
      && data.skipVersion === null);

  const oldConfigDir = path.join(tmp, 'old-config');
  fs.mkdirSync(oldConfigDir, { recursive: true });
  fs.writeFileSync(path.join(oldConfigDir, 'config.json'), JSON.stringify({
    port: 4321,
    hotkey: 'CommandOrControl+Shift+J'
  }));
  const upgraded = config.init(oldConfigDir);
  check('config: 旧配置无损补齐 v0.2 默认值',
    upgraded.port === 4321
      && upgraded.hotkey === 'CommandOrControl+Shift+J'
      && upgraded.preferBundled === false
      && upgraded.openAtLogin === false
      && upgraded.startMinimized === false
      && upgraded.checkUpdates === true
      && upgraded.skipVersion === null);
  config.init(tmp);
  config.set({ port: PORT, command: `node "${path.join(__dirname, 'fake-backend.js')}"` });
  check('config: 写入并读取', config.get('port') === PORT);
  check('config: 文件已落盘', fs.existsSync(config.filePath()));

  // log
  log.init(path.join(tmp, 'logs'));
  log.line('test', 'hello');
  check('log: 写入与读取', log.recent().includes('hello') && fs.existsSync(log.filePath()));

  // update：严格 semver、精确资产、非遥测请求与本地 SHA-256。
  let invalidVersionRejected = false;
  try { update.compareVersions('0.2', '0.2.0'); } catch (_e) { invalidVersionRejected = true; }
  check('update: semver 比较含 prerelease 与非法输入',
    update.compareVersions('0.2.0-beta', '0.2.0') < 0
      && update.compareVersions('0.2.1', '0.2.0') > 0
      && update.compareVersions('v0.2.0+build.1', '0.2.0+build.2') === 0
      && invalidVersionRejected);

  const releaseFixture = {
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/sgd-shine/whaledock/releases/tag/v0.2.0',
    name: 'WhaleDock v0.2.0',
    body: '跨平台更新',
    draft: false,
    prerelease: false,
    assets: [
      'WhaleDock-0.2.0-arm64.dmg',
      'WhaleDock-0.2.0-arm64-mac.zip',
      'WhaleDock-0.2.0-x64.dmg',
      'WhaleDock-0.2.0-x64-mac.zip',
      'WhaleDock-Setup-0.2.0.exe',
      'WhaleDock-0.2.0-portable.exe',
      'SHA256SUMS-mac.txt',
      'SHA256SUMS-win.txt'
    ].map((name) => ({
      name,
      browser_download_url: `https://github.com/sgd-shine/whaledock/releases/download/v0.2.0/${name}`
    }))
  };
  const macArmAsset = update.pickAsset(releaseFixture, 'darwin', 'arm64');
  const macX64Asset = update.pickAsset(releaseFixture, 'darwin', 'x64');
  const winAsset = update.pickAsset(releaseFixture, 'win32', 'x64');
  check('update: 三平台资产与校验和精确配对',
    macArmAsset.asset.name === 'WhaleDock-0.2.0-arm64.dmg'
      && macX64Asset.asset.name === 'WhaleDock-0.2.0-x64.dmg'
      && winAsset.asset.name === 'WhaleDock-Setup-0.2.0.exe'
      && macArmAsset.checksumAsset.name === 'SHA256SUMS-mac.txt'
      && winAsset.checksumAsset.name === 'SHA256SUMS-win.txt');

  let fetchCalls = 0;
  let updateRequest = null;
  const fakeFetch = async (url, options) => {
    fetchCalls += 1;
    updateRequest = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(releaseFixture)
    };
  };
  const disabledUpdate = await update.checkForUpdate('0.1.1', {
    checkUpdates: false,
    fetchImpl: fakeFetch,
    platform: 'darwin',
    arch: 'arm64'
  });
  const availableUpdate = await update.checkForUpdate('0.1.1', {
    checkUpdates: true,
    fetchImpl: fakeFetch,
    platform: 'darwin',
    arch: 'arm64'
  });
  check('update: 开关关闭零请求且请求不含用户标识',
    disabledUpdate.reason === 'disabled'
      && fetchCalls === 1
      && availableUpdate.updateAvailable === true
      && updateRequest.url === update.RELEASE_API
      && JSON.stringify(Object.keys(updateRequest.options.headers).sort())
        === JSON.stringify(['Accept', 'User-Agent'].sort())
      && updateRequest.options.headers['User-Agent'] === 'WhaleDock-Update');

  const hashFixture = path.join(tmp, 'update-sha-fixture.bin');
  fs.writeFileSync(hashFixture, 'abc');
  const shaPass = await update.verifySha256(
    hashFixture,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  fs.appendFileSync(hashFixture, 'tampered');
  const shaFail = await update.verifySha256(
    hashFixture,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  check('update: SHA-256 篡改前通过、篡改后失败', shaPass && !shaFail);

  const installerName = 'WhaleDock-Setup-0.2.0.exe';
  const installerDigest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  let prefixedChecksumRejected = false;
  try {
    update.checksumForAsset(`${installerDigest} *release/${installerName}\n`, installerName);
  } catch (error) {
    prefixedChecksumRejected = error && error.code === 'ERR_CHECKSUM_NOT_FOUND';
  }
  check('update: 校验和合约只接受产物裸文件名',
    update.checksumForAsset(`${installerDigest} *${installerName}\n`, installerName) === installerDigest
      && prefixedChecksumRejected);

  const skippedUpdate = await update.checkForUpdate('0.1.1', {
    checkUpdates: true,
    skipVersion: '0.2.0',
    fetchImpl: fakeFetch,
    platform: 'darwin',
    arch: 'arm64'
  });
  check('update: skipVersion 抑制已跳过版本',
    skippedUpdate.skipped === true
      && skippedUpdate.updateAvailable === false
      && skippedUpdate.reason === 'skipped');

  function injectedDownload(body, declaredLength, beforeEnd) {
    return (_url, _options, callback) => {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = () => {};
      process.nextTick(() => {
        const response = new PassThrough();
        response.statusCode = 200;
        response.headers = { 'content-length': String(declaredLength) };
        callback(response);
        if (beforeEnd) beforeEnd();
        response.end(body);
      });
      return request;
    };
  }

  const shortDownload = path.join(tmp, 'short-update.bin');
  let lengthMismatchRejected = false;
  try {
    await update.downloadFile('https://example.invalid/update.bin', shortDownload, {
      request: injectedDownload(Buffer.from('abc'), 100),
      timeoutMs: 2000
    });
  } catch (error) {
    lengthMismatchRejected = error && error.code === 'ERR_DOWNLOAD_LENGTH_MISMATCH';
  }
  check('update: Content-Length 不符时拒绝并清理半包',
    lengthMismatchRejected
      && !fs.existsSync(shortDownload)
      && !fs.readdirSync(tmp).some((name) => name.startsWith('short-update.bin.part-')));

  const racedDownload = path.join(tmp, 'raced-update.bin');
  let overwriteRaceRejected = false;
  try {
    await update.downloadFile('https://example.invalid/update.bin', racedDownload, {
      request: injectedDownload(Buffer.from('new'), 3, () => fs.writeFileSync(racedDownload, 'victim')),
      timeoutMs: 2000
    });
  } catch (error) {
    overwriteRaceRejected = error && error.code === 'ERR_DESTINATION_EXISTS';
  }
  check('update: overwrite=false 竞态下不覆盖已有文件',
    overwriteRaceRejected
      && fs.readFileSync(racedDownload, 'utf8') === 'victim'
      && !fs.readdirSync(tmp).some((name) => name.startsWith('raced-update.bin.part-')));

  // macOS 构建裸包不能留在 Spotlight 可发现的 .app 路径；DMG/ZIP 与无关 App 必须保留。
  const macRelease = path.join(tmp, 'mac-release');
  const armBundle = path.join(macRelease, 'mac-arm64', 'WhaleDock.app');
  const x64Bundle = path.join(macRelease, 'mac', 'WhaleDock.app');
  const unrelatedBundle = path.join(macRelease, 'mac', 'Other.app');
  const outsideBundle = path.join(tmp, 'outside', 'WhaleDock.app');
  const linkedBundle = path.join(macRelease, 'mac-x64', 'WhaleDock.app');
  for (const bundle of [armBundle, x64Bundle, unrelatedBundle, outsideBundle]) {
    fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
  }
  fs.mkdirSync(path.dirname(linkedBundle), { recursive: true });
  const linkedBundleIsSymlink = process.platform !== 'win32';
  if (linkedBundleIsSymlink) fs.symlinkSync(outsideBundle, linkedBundle);
  else fs.writeFileSync(linkedBundle, 'Windows runner 无需创建特权目录符号链接');
  const dmgFixture = path.join(macRelease, 'WhaleDock-0.2.0-arm64.dmg');
  const zipFixture = path.join(macRelease, 'WhaleDock-0.2.0-arm64-mac.zip');
  fs.writeFileSync(dmgFixture, 'dmg');
  fs.writeFileSync(zipFixture, 'zip');

  macosBuildVisibility.prepareOutput(macRelease);
  const stagingPlan = macosBuildVisibility.findStagingApps(macRelease);
  const macBuildResult = { platformToTargets: new Map([[{ name: 'mac', nodeName: 'darwin' }, new Map()]]) };
  const windowsBuildResult = { platformToTargets: new Map([[{ name: 'windows', nodeName: 'win32' }, new Map()]]) };
  check('packaging: 只规划受控 release/mac* 下的 WhaleDock 裸 App',
    JSON.stringify(stagingPlan) === JSON.stringify([x64Bundle, armBundle].sort())
      && fs.existsSync(path.join(macRelease, '.metadata_never_index'))
      && macosBuildVisibility.buildIncludesMac(macBuildResult)
      && !macosBuildVisibility.buildIncludesMac(windowsBuildResult)
      && JSON.stringify(macosBuildVisibility.unexpectedVisibleApps([
        '/Applications/WhaleDock.app', '/tmp/WhaleDock.app'
      ])) === JSON.stringify(['/tmp/WhaleDock.app']));

  const archivedApps = macosBuildVisibility.archiveMacAppBundles(macRelease, {
    unregister: false
  });
  const archiveRoot = path.join(macRelease, '.app-archives.noindex');
  const x64Archive = path.join(archiveRoot, 'WhaleDock-x64.app-bundle');
  fs.mkdirSync(path.join(x64Bundle, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(x64Bundle, 'Contents', 'second-build'), 'new');
  const replacedApps = macosBuildVisibility.archiveMacAppBundles(macRelease, { unregister: false });
  check('packaging: 裸 App 归档后不可被识别为版本且保留安装包与无关文件',
    archivedApps.length === 2
      && replacedApps.length === 1
      && macosBuildVisibility.findStagingApps(macRelease).length === 0
      && fs.readdirSync(archiveRoot).filter((name) => name.endsWith('.app-bundle')).length === 2
      && fs.readFileSync(path.join(x64Archive, 'Contents', 'second-build'), 'utf8') === 'new'
      && fs.existsSync(path.join(archiveRoot, '.metadata_never_index'))
      && !fs.existsSync(armBundle)
      && !fs.existsSync(x64Bundle)
      && fs.existsSync(unrelatedBundle)
      && (linkedBundleIsSymlink
        ? fs.lstatSync(linkedBundle).isSymbolicLink()
        : fs.lstatSync(linkedBundle).isFile())
      && fs.existsSync(outsideBundle)
      && fs.readFileSync(dmgFixture, 'utf8') === 'dmg'
      && fs.readFileSync(zipFixture, 'utf8') === 'zip'
      && macosBuildVisibility.archiveMacAppBundles(macRelease, { unregister: false }).length === 0);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  check('packaging: macOS 打包挂上 afterPack 签名钩子',
    pkg.build.afterPack === 'scripts/macos-codesign.js' && pkg.build.mac.identity === null,
    `${pkg.build.afterPack} / identity=${String(pkg.build.mac.identity)}`);
  check('packaging: 签名钩子默认 ad-hoc、不引入证书或付费服务',
    macosCodesign.signingIdentity({}).identity === '-'
      && fs.existsSync(path.join(__dirname, '..', 'build', 'entitlements.mac.plist')));

  const releaseWorkflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'release.yml'),
    'utf8'
  );
  const submitStepOffset = releaseWorkflow.indexOf('- name: Submit macOS artifacts for notarization');
  const preserveStepOffset = releaseWorkflow.indexOf('- name: Preserve signed macOS assets and notarization state');
  const notarizeStepOffset = releaseWorkflow.indexOf('- name: Wait for notarization and staple macOS artifacts');
  check('packaging: 公证前不运行 Gatekeeper spctl',
    notarizeStepOffset > 0
      && !releaseWorkflow.slice(0, notarizeStepOffset).includes('spctl -a'));
  const checksumStepOffset = releaseWorkflow.indexOf(
    '- name: Verify macOS artifact names and write checksums',
    notarizeStepOffset
  );
  const submitStep = releaseWorkflow.slice(submitStepOffset, preserveStepOffset);
  const notarizeStep = releaseWorkflow.slice(notarizeStepOffset, checksumStepOffset);
  const resumeWorkflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'resume-notarization.yml'),
    'utf8'
  );
  const publishStepOffset = releaseWorkflow.indexOf('  publish-release:');
  const publishStep = releaseWorkflow.slice(publishStepOffset);
  check('packaging: 发布仅下载 final macOS 与 Windows 成品，排除 pending 覆盖',
    publishStepOffset > 0
      && publishStep.includes('name: whaledock-mac-${{ github.ref_name }}')
      && publishStep.includes('name: whaledock-win-${{ github.ref_name }}')
      && !publishStep.includes('pattern: whaledock-*-${{ github.ref_name }}')
      && !publishStep.includes('merge-multiple: true'));
  check('packaging: macOS 公证提交后先保存成品与 submission id',
    submitStepOffset > 0
      && preserveStepOffset > submitStepOffset
      && notarizeStepOffset > preserveStepOffset
      && submitStep.includes('--no-wait --output-format json')
      && submitStep.includes('release/notary-submissions.tsv')
      && releaseWorkflow.slice(preserveStepOffset, notarizeStepOffset).includes('whaledock-mac-pending-${{ github.ref_name }}'));
  check('packaging: macOS 公证并行等待且可按同一批 submission id 续跑',
    checksumStepOffset > notarizeStepOffset
      && notarizeStep.includes('notarytool wait "$submission_id"')
      && notarizeStep.includes('--timeout 10m --output-format json')
      && notarizeStep.includes('notarytool info "$submission_id"')
      && notarizeStep.includes('notary_deadline_epoch')
      && !notarizeStep.includes('--wait --timeout 45m')
      && resumeWorkflow.includes('whaledock-mac-pending-${{ inputs.release_tag }}')
      && resumeWorkflow.includes('run-id: ${{ inputs.source_run_id }}')
      && resumeWorkflow.includes('notarytool info "$submission_id"')
      && !resumeWorkflow.includes('notarytool submit'));
  const appGatekeeperAssessment =
    'spctl --assess --type execute --verbose=2 "$mount_dir/WhaleDock.app"';
  check('packaging: 公证 DMG 验 ticket 并挂载校验内层 App',
    notarizeStep.includes('xcrun stapler validate "$asset"')
      && notarizeStep.includes('hdiutil attach "$asset" -nobrowse -readonly')
      && notarizeStep.includes(appGatekeeperAssessment)
      && resumeWorkflow.includes('xcrun stapler validate "$dmg"')
      && resumeWorkflow.includes('hdiutil attach "$dmg" -nobrowse -readonly')
      && resumeWorkflow.includes(appGatekeeperAssessment)
      && !notarizeStep.includes('spctl --assess --type install')
      && !resumeWorkflow.includes('spctl --assess --type install'));

  // PATH / which
  check('backend: fullPath 非空', backend.fullPath().split(path.delimiter).length > 3);
  check('backend: which(node) 找得到', !!backend.which('node'), backend.which('node') || '');

  // Windows PATH / PATHEXT 用参数注入在任意 runner 上验证。
  const windowsEnv = {
    Path: 'C:\\Existing\\bin;C:\\Tools',
    PATHEXT: '.EXE;.CMD;.BAT',
    USERPROFILE: 'C:\\Users\\Shine',
    APPDATA: 'C:\\Users\\Shine\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\Shine\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    ProgramData: 'C:\\ProgramData',
    NVM_SYMLINK: 'C:\\Program Files\\nodejs'
  };
  let windowsLoginShellCalled = false;
  const windowsPath = backend.fullPath(true, {
    platform: 'win32',
    env: windowsEnv,
    homeDir: windowsEnv.USERPROFILE,
    loginShellPath: () => {
      windowsLoginShellCalled = true;
      return 'SHOULD_NOT_BE_USED';
    }
  });
  const windowsPathParts = windowsPath.split(';');
  check('backend: Windows PATH 常见目录且跳过 login shell',
    !windowsLoginShellCalled
      && windowsPathParts.includes('C:\\Program Files\\nodejs')
      && windowsPathParts.includes('C:\\Users\\Shine\\AppData\\Roaming\\npm')
      && windowsPathParts.includes('C:\\Users\\Shine\\AppData\\Local\\Volta\\bin')
      && windowsPathParts.includes('C:\\Users\\Shine\\scoop\\shims')
      && windowsPathParts.includes('C:\\ProgramData\\chocolatey\\bin'));

  check('backend: execCandidates 按 PATHEXT 展开',
    JSON.stringify(backend.execCandidates('dsh', 'win32', '.EXE;.CMD;.BAT'))
      === JSON.stringify(['dsh.exe', 'dsh.cmd', 'dsh.bat', 'dsh'])
      && JSON.stringify(backend.execCandidates('dsh', 'darwin', '.EXE;.CMD'))
        === JSON.stringify(['dsh']));

  const shimDir = path.join(tmp, 'windows-shims');
  fs.mkdirSync(shimDir, { recursive: true });
  const dshShim = path.join(shimDir, 'dsh.cmd');
  fs.writeFileSync(dshShim, '@echo off\r\n');
  const portableWindowsPath = { ...path.posix, delimiter: ';' };
  const windowsDsh = backend.which('dsh', {
    platform: 'win32',
    env: { PATHEXT: '.EXE;.CMD;.BAT' },
    pathValue: `${path.join(tmp, 'missing')};${shimDir}`,
    pathModule: portableWindowsPath
  });
  check('backend: Windows which 命中临时 dsh.cmd 垫片',
    Boolean(windowsDsh) && path.normalize(windowsDsh) === path.normalize(dshShim),
    windowsDsh || 'null');

  const darwinKill = backend.killPlan(1234, 'darwin');
  const windowsKill = backend.killPlan(5678, 'win32');
  check('backend: killPlan 两平台顺序正确',
    darwinKill[0].target === 'group'
      && darwinKill[0].signal === 'SIGTERM'
      && darwinKill[1].ms === 4000
      && darwinKill[2].signal === 'SIGKILL'
      && JSON.stringify(windowsKill[0].args) === JSON.stringify(['/PID', '5678', '/T'])
      && windowsKill[1].ms === 4000
      && JSON.stringify(windowsKill[2].args) === JSON.stringify(['/PID', '5678', '/T', '/F']));

  const fastExitChild = new EventEmitter();
  fastExitChild.pid = 2468;
  fastExitChild.kill = () => true;
  const fastExitState = { child: fastExitChild, exited: false };
  fastExitChild.once('exit', () => { fastExitState.exited = true; });
  const fastExitSignals = [];
  const fastExitWaits = [];
  let fastStopResolved = false;
  const fastStop = backend.stop(fastExitState, {
    platform: 'darwin',
    graceMs: 4000,
    settleMs: 300,
    kill: (_pid, signal) => {
      fastExitSignals.push(signal);
      if (signal === 'SIGTERM') setImmediate(() => fastExitChild.emit('exit', 0, null));
    },
    // 永不自行结束：只有子进程退出事件能打断这次 4 秒等待。
    wait: (ms) => {
      fastExitWaits.push(ms);
      return new Promise(() => {});
    }
  }).then(() => { fastStopResolved = true; });
  await Promise.race([
    fastStop,
    // 给繁忙 CI runner 足够调度余量，仍显著短于 4 秒宽限期。
    new Promise((resolve) => setTimeout(resolve, 1000))
  ]);
  check('backend: 子进程速退会打断宽限等待并跳过强杀',
    fastStopResolved
      && fastExitState.exited
      && JSON.stringify(fastExitSignals) === JSON.stringify(['SIGTERM'])
      && JSON.stringify(fastExitWaits) === JSON.stringify([4000]));

  const harnessPage = backend.classifyHarnessResponse(
    { 'content-type': 'text/html; charset=utf-8' },
    '<!doctype html><html><head><title>DeepSeek Harness</title></head></html>'
  );
  const otherPage = backend.classifyHarnessResponse(
    { 'content-type': 'text/html' },
    '<html><head><title>Another local service</title></head></html>'
  );
  check('backend: attach 弱特征分类 match / mismatch',
    harnessPage.status === 'match' && otherPage.status === 'mismatch');

  const fakeWindowsChild = new EventEmitter();
  fakeWindowsChild.pid = 6789;
  fakeWindowsChild.stdout = new EventEmitter();
  fakeWindowsChild.stderr = new EventEmitter();
  fakeWindowsChild.kill = () => true;
  let windowsSpawnCall = null;
  backend.start({ workdir: 'C:\\Work' }, {}, {
    platform: 'win32',
    env: windowsEnv,
    pathValue: windowsPath,
    findCommand: (name) => name === 'dsh' ? 'C:\\Program Files\\nodejs\\dsh.cmd' : null,
    probeDshVersion: () => '0.1.0-rc.6',
    spawn: (file, args, options) => {
      windowsSpawnCall = { file, args, options };
      return fakeWindowsChild;
    }
  });
  check('backend: Windows .cmd 使用 shell 且隐藏控制台',
    windowsSpawnCall.file === '"C:\\Program Files\\nodejs\\dsh.cmd"'
      && windowsSpawnCall.options.shell === true
      && windowsSpawnCall.options.detached === false
      && windowsSpawnCall.options.windowsHide === true);
  fakeWindowsChild.emit('exit', 0, null);

  const targetSystemChild = new EventEmitter();
  targetSystemChild.pid = 6790;
  targetSystemChild.stdout = new EventEmitter();
  targetSystemChild.stderr = new EventEmitter();
  targetSystemChild.kill = () => true;
  let targetVersionProbe = null;
  let targetSystemSpawn = null;
  backend.start({ workdir: '/test/work' }, {}, {
    platform: 'darwin',
    env: { PATH: '/test/bin' },
    homeDir: '/test/home',
    pathValue: '/test/bin',
    findCommand: (name) => name === 'dsh' ? '/test/bin/dsh' : null,
    probeDshVersion: (file) => {
      targetVersionProbe = file;
      return '0.1.1-rc.2';
    },
    spawn: (file, args, options) => {
      targetSystemSpawn = { file, args, options };
      return targetSystemChild;
    }
  });
  check('backend: start 先证明 system 版本再生成支持版启动参数',
    targetVersionProbe === '/test/bin/dsh'
      && targetSystemSpawn.file === '/test/bin/dsh'
      && JSON.stringify(targetSystemSpawn.args) === JSON.stringify([
        'web', '--port', '3080', '--no-open'
      ])
      && targetSystemSpawn.options.shell === false
      && targetSystemSpawn.options.detached === true);
  targetSystemChild.emit('exit', 0, null);

  const bundledResources = path.join(tmp, 'packaged-resources');
  const bundledRoot = path.join(bundledResources, 'dsh-runtime');
  const bundledPackage = path.join(
    bundledRoot, 'node_modules', '@deepseek-ai', 'dsh'
  );
  fs.mkdirSync(path.join(bundledPackage, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(bundledPackage, 'lib', 'bin.js'), '// smoke fixture\n');
  fs.writeFileSync(path.join(bundledRoot, 'manifest.json'), JSON.stringify({
    dshVersion: '0.1.0-rc.6'
  }));
  const fakeRuntimeInfo = {
    execPath: '/Applications/WhaleDock.app/Contents/MacOS/WhaleDock',
    resourcesPath: bundledResources
  };
  const bundledFallback = backend.resolveCommand({ dshVersion: '0.1.0-rc.6' }, {
    findCommand: () => null,
    runtimeInfo: fakeRuntimeInfo
  });
  const bundledPreferred = backend.resolveCommand({
    dshVersion: '0.1.0-rc.6',
    preferBundled: true
  }, {
    findCommand: () => { throw new Error('preferBundled 不应继续 PATH 探测'); },
    runtimeInfo: fakeRuntimeInfo
  });
  const pathFirst = backend.resolveCommand({
    dshVersion: '0.1.0-rc.6',
    preferBundled: false
  }, {
    findCommand: (name) => name === 'dsh' ? '/test/bin/dsh' : null,
    runtimeInfo: fakeRuntimeInfo
  });
  const missingBundled = backend.resolveCommand({ dshVersion: '0.1.0-rc.6' }, {
    findCommand: () => null,
    runtimeInfo: { execPath: '/test/WhaleDock', resourcesPath: path.join(tmp, 'missing') }
  });
  check('backend: 内置引擎第四级探测与 preferBundled 次序',
    bundledFallback
      && JSON.stringify(bundledFallback) === JSON.stringify({
        file: fakeRuntimeInfo.execPath,
        args: [
          '--expose-internals', path.join(bundledPackage, 'lib', 'bin.js'),
          'web', '--port', '3080'
        ],
        shell: false,
        env: { ELECTRON_RUN_AS_NODE: '1' },
        bundled: true,
        label: '内置 dsh@0.1.0-rc.6 web --port 3080',
        version: '0.1.0-rc.6'
      })
      && bundledFallback.bundled === true
      && bundledFallback.env.ELECTRON_RUN_AS_NODE === '1'
      && bundledFallback.args[0] === '--expose-internals'
      && bundledFallback.args[1].endsWith(path.join('@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      && bundledPreferred.bundled === true
      && pathFirst.file === '/test/bin/dsh'
      && missingBundled === null,
    bundledFallback ? bundledFallback.label : 'null');

  const bundledCandidateBlocked = backend.resolveCommand({ dshVersion: '0.1.1-rc.2' }, {
    findCommand: () => null,
    runtimeInfo: fakeRuntimeInfo
  });
  const bundledCandidatePlan = backend.buildBundledCommandPlan(
    fakeRuntimeInfo.execPath,
    path.join(bundledPackage, 'lib', 'bin.js'),
    '0.1.1-rc.2',
    '3080'
  );
  check('backend: bundled 纯 planner 覆盖 rc.6/rc.2 完整对象且不绕过生产锁',
    bundledCandidateBlocked === null
      && JSON.stringify(bundledFallback) === JSON.stringify(
        backend.buildBundledCommandPlan(
          fakeRuntimeInfo.execPath,
          path.join(bundledPackage, 'lib', 'bin.js'),
          '0.1.0-rc.6',
          '3080'
        )
      )
      && JSON.stringify(bundledCandidatePlan) === JSON.stringify({
        file: fakeRuntimeInfo.execPath,
        args: [
          '--expose-internals', path.join(bundledPackage, 'lib', 'bin.js'),
          'web', '--port', '3080', '--no-open'
        ],
        shell: false,
        env: { ELECTRON_RUN_AS_NODE: '1' },
        bundled: true,
        label: '内置 dsh@0.1.1-rc.2 web --port 3080 --no-open',
        version: '0.1.1-rc.2'
      }));

  // 端口应当未开
  check('backend: 端口初始未开', !(await backend.isPortOpen(PORT)));

  // 启动假后端（走 config.command 自定义命令分支，shell:true）
  process.env.HARNESS_FAKE_PORT = String(PORT);
  const lines = [];
  let exited = false;
  const state = backend.start(config.get(), {
    onLine: (l) => lines.push(l),
    onExit: () => { exited = true; }
  });
  const up = await backend.waitForPort(PORT, { timeoutMs: 15000, intervalMs: 300 });
  let abortChecks = 0;
  const abortedAfterProbe = await backend.waitForPort(PORT, {
    timeoutMs: 1000,
    intervalMs: 50,
    shouldAbort: () => ++abortChecks > 1
  });
  check('backend: 启动后端口就绪', up && !abortedAfterProbe,
    `ready=${up} postProbeAbort=${!abortedAfterProbe}`);
  check('backend: 收到子进程输出', lines.some((l) => l.includes('fake harness listening')));

  // 停止并确认端口关闭
  await backend.stop(state);
  await new Promise((r) => setTimeout(r, 500));
  check('backend: 停止后进程已退出', exited || state.exited);
  check('backend: 停止后端口关闭', !(await backend.isPortOpen(PORT)));

  // resolveCommand 自动探测分支（清掉 command 覆盖后应能找到 dsh 或 npx）
  config.set({ command: null });
  const cmd = backend.resolveCommand(config.get());
  check('backend: resolveCommand 能自动探测', !!cmd, cmd ? cmd.label : 'null');
  const onlyNpx = (name) => name === 'npx' ? '/test/bin/npx' : null;
  const pinned = backend.resolveCommand({ dshVersion: '0.1.0-rc.6' }, onlyNpx);
  const latest = backend.resolveCommand({ dshVersion: 'latest' }, onlyNpx);
  const target = backend.resolveCommand({ dshVersion: '0.1.1-rc.2' }, onlyNpx);
  const empty = backend.resolveCommand({ dshVersion: '  ' }, onlyNpx);
  check('backend: npx 回退命令带版本锁',
    JSON.stringify(pinned) === JSON.stringify({
      file: '/test/bin/npx',
      args: ['-y', '@deepseek-ai/dsh@0.1.0-rc.6', 'web', '--port', '3080'],
      shell: false,
      label: 'npx -y @deepseek-ai/dsh@0.1.0-rc.6 web --port 3080',
      version: '0.1.0-rc.6'
    })
      && pinned.file === '/test/bin/npx'
      && pinned.shell === false
      && pinned.version === '0.1.0-rc.6'
      && JSON.stringify(pinned.args) === JSON.stringify([
        '-y', '@deepseek-ai/dsh@0.1.0-rc.6', 'web', '--port', '3080'
      ])
      && pinned.label === 'npx -y @deepseek-ai/dsh@0.1.0-rc.6 web --port 3080'
      && latest.args[1] === '@deepseek-ai/dsh@latest'
      && latest.version === 'latest'
      && JSON.stringify(latest.args) === JSON.stringify([
        '-y', '@deepseek-ai/dsh@latest', 'web', '--port', '3080', '--no-open'
      ])
      && JSON.stringify(target.args) === JSON.stringify([
        '-y', '@deepseek-ai/dsh@0.1.1-rc.2', 'web', '--port', '3080', '--no-open'
      ])
      && empty.args[1] === '@deepseek-ai/dsh@0.1.0-rc.6',
    pinned.label);

  const systemRc6 = backend.resolveCommand({ dshVersion: '0.1.1-rc.2' }, {
    findCommand: (name) => name === 'dsh' ? '/test/bin/dsh' : null,
    probeDshVersion: () => '0.1.0-rc.6'
  });
  const systemTarget = backend.resolveCommand({ dshVersion: '0.1.0-rc.6' }, {
    findCommand: (name) => name === 'dsh' ? '/test/bin/dsh' : null,
    probeDshVersion: () => '0.1.1-rc.2'
  });
  const systemUnknown = backend.resolveCommand({}, {
    findCommand: (name) => name === 'dsh' ? '/test/bin/dsh' : null,
    probeDshVersion: () => null
  });
  let customVersionProbes = 0;
  const customUntouched = backend.resolveCommand({ command: 'my-dsh-wrapper --safe' }, {
    findCommand: () => { throw new Error('custom 不得探测 PATH'); },
    probeDshVersion: () => { customVersionProbes += 1; return '0.1.1-rc.2'; }
  });
  check('backend: system dsh 版本感知且 custom 命令零改写零探测',
    JSON.stringify(systemRc6) === JSON.stringify({
      file: '/test/bin/dsh',
      args: ['web', '--port', '3080'],
      shell: false,
      label: 'dsh web --port 3080',
      version: 'PATH 中的已安装版本'
    })
      && JSON.stringify(systemTarget.args) === JSON.stringify([
        'web', '--port', '3080', '--no-open'
      ])
      && systemTarget.label === 'dsh web --port 3080 --no-open'
      && JSON.stringify(systemUnknown.args) === JSON.stringify([
        'web', '--port', '3080'
      ])
      && customVersionProbes === 0
      && JSON.stringify(customUntouched) === JSON.stringify({
        file: 'my-dsh-wrapper --safe',
        args: [],
        shell: true,
        label: 'my-dsh-wrapper --safe',
        version: '由自定义命令决定'
      }));

  const windowsNpmRoot = path.join(tmp, 'system-windows');
  const windowsPackageRoot = path.join(
    windowsNpmRoot, 'node_modules', '@deepseek-ai', 'dsh'
  );
  fs.mkdirSync(path.join(windowsPackageRoot, 'lib'), { recursive: true });
  const windowsShim = path.join(windowsNpmRoot, 'dsh.cmd');
  const modernV9Shim = [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & '
      + 'set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  '
      + '"%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ''
  ].join('\r\n');
  fs.writeFileSync(windowsShim, modernV9Shim);
  const windowsManifest = JSON.stringify({
    name: '@deepseek-ai/dsh', version: '0.1.1-rc.2', bin: { dsh: 'lib/bin.js' }
  });
  fs.writeFileSync(path.join(windowsPackageRoot, 'package.json'), windowsManifest);
  const probedTarget = backend.probeSystemDshVersion(windowsShim, {
    platform: 'win32',
    pathImpl: path
  });

  // 真实临时文件始终走 runner 当前 OS 的 path；另用纯内存 C:\ 布局
  // 显式证明生产 Windows path.win32 join，避免 mac 上模拟通过、Windows CI 却假红。
  const virtualWindowsShim = 'C:\\Tools\\dsh.cmd';
  const virtualWindowsPackage = path.win32.join(
    path.win32.dirname(virtualWindowsShim),
    'node_modules', '@deepseek-ai', 'dsh', 'package.json'
  );
  const virtualFiles = new Map([
    [virtualWindowsShim, Buffer.from(modernV9Shim)],
    [virtualWindowsPackage, Buffer.from(windowsManifest)]
  ]);
  const virtualPositions = new Map();
  const virtualWindowsFs = {
    constants: fs.constants,
    openSync(file) {
      if (!virtualFiles.has(file)) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' });
      virtualPositions.set(file, 0);
      return file;
    },
    fstatSync(fd) {
      const value = virtualFiles.get(fd);
      return { isFile: () => true, size: value.length };
    },
    readSync(fd, destination, offset, length) {
      const value = virtualFiles.get(fd);
      const sourceOffset = virtualPositions.get(fd) || 0;
      const count = Math.min(length, value.length - sourceOffset);
      if (count > 0) value.copy(destination, offset, sourceOffset, sourceOffset + count);
      virtualPositions.set(fd, sourceOffset + count);
      return count;
    },
    closeSync(fd) { virtualPositions.delete(fd); }
  };
  const probedWin32Join = backend.probeSystemDshVersion(virtualWindowsShim, {
    platform: 'win32', fsImpl: virtualWindowsFs, pathImpl: path.win32
  });
  fs.writeFileSync(windowsShim, [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & '
      + '"%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ''
  ].join('\r\n'));
  const probedV7Target = backend.probeSystemDshVersion(windowsShim, {
    platform: 'win32', pathImpl: path
  });
  fs.writeFileSync(windowsShim, [
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe" "%~dp0\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ') ELSE (',
    '  @SETLOCAL',
    '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
    '  node  "%~dp0\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ')',
    ''
  ].join('\r\n'));
  const probedLegacyTarget = backend.probeSystemDshVersion(windowsShim, {
    platform: 'win32', pathImpl: path
  });

  const posixPackageRoot = path.join(
    tmp, 'system-posix', 'node_modules', '@deepseek-ai', 'dsh'
  );
  const posixBin = path.join(posixPackageRoot, 'lib', 'bin.js');
  fs.mkdirSync(path.dirname(posixBin), { recursive: true });
  fs.writeFileSync(posixBin, '// official npm bin fixture\n');
  fs.writeFileSync(path.join(posixPackageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh', version: '0.1.0-rc.6', bin: { dsh: 'lib/bin.js' }
  }));
  const probedRc6 = backend.probeSystemDshVersion(posixBin, {
    platform: 'darwin', pathImpl: path
  });
  fs.writeFileSync(path.join(posixPackageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/not-dsh', version: '0.1.1-rc.2', bin: { dsh: 'lib/bin.js' }
  }));
  const rejectedWrongPackage = backend.probeSystemDshVersion(posixBin, {
    platform: 'darwin', pathImpl: path
  });
  fs.writeFileSync(path.join(posixPackageRoot, 'package.json'), ' '.repeat(64 * 1024 + 1));
  const rejectedLargeManifest = backend.probeSystemDshVersion(posixBin, {
    platform: 'darwin', pathImpl: path
  });
  fs.writeFileSync(windowsShim,
    '@rem node_modules\\@deepseek-ai\\dsh\\lib\\bin.js\r\n@echo this-is-not-dsh\r\n');
  const rejectedCommentShim = backend.probeSystemDshVersion(windowsShim, {
    platform: 'win32', pathImpl: path
  });
  fs.writeFileSync(windowsShim,
    `@rem ${'x'.repeat(16 * 1024)} node_modules\\@deepseek-ai\\dsh\\lib\\bin.js\r\n`);
  const rejectedLargeShim = backend.probeSystemDshVersion(windowsShim, {
    platform: 'win32', pathImpl: path
  });
  check('backend: system 版本只读官方 npm 布局且有界 fail-closed',
    probedTarget === '0.1.1-rc.2'
      && probedWin32Join === '0.1.1-rc.2'
      && probedV7Target === '0.1.1-rc.2'
      && probedLegacyTarget === '0.1.1-rc.2'
      && probedRc6 === '0.1.0-rc.6'
      && rejectedWrongPackage === null
      && rejectedLargeManifest === null
      && rejectedCommentShim === null
      && rejectedLargeShim === null
      && backend.probeSystemDshVersion(path.join(windowsNpmRoot, 'dsh.exe'), {
        platform: 'win32', pathImpl: path
      }) === null
      && backend.dshSupportsNoOpen('0.1.0-rc.6') === false
      && backend.dshSupportsNoOpen('0.1.0-rc.7') === false
      && backend.dshSupportsNoOpen('0.1.0-rc.8') === true
      && backend.dshSupportsNoOpen('0.1.1-rc.2') === true
      && backend.dshSupportsNoOpen('latest') === true
      && backend.dshSupportsNoOpen('not-a-version') === false);

  // v0.3 分层直测必须由统一 smoke 真实执行，避免 CI 只跑旧用例而假绿。
  for (const [file, label] of [
    ['config-v03-smoke.js', '配置与安全静态窗口'],
    ['events-smoke.js', '事件状态机与持久化'],
    ['backend-events-smoke.js', 'dsh 只读事件适配器'],
    ['main-events-smoke.js', 'Electron 主进程事件薄层']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.3: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // v0.4 工作区、图片、prompt 适配与 Electron 薄层也必须由统一 smoke 真实执行。
  for (const [file, label] of [
    ['workspaces-smoke.js', '工作区事务与 journal'],
    ['image-input-smoke.js', '图片状态与受控文件'],
    ['backend-prompt-smoke.js', 'dsh prompt fail-closed 适配器'],
    ['main-v04-smoke.js', 'Electron 工作区/图片薄层']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.4: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // v0.5.1 macOS 签名合约：未签名产物在 Apple Silicon 上会被判「已损坏」，是分发级缺陷。
  for (const [file, label] of [
    ['macos-codesign-smoke.js', 'macOS 签名目标收集与 fail-closed 校验']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.5.1: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // v0.6 工作台包解析层与 Electron 薄层：安全校验全部在这里拿证据。
  for (const [file, label] of [
    ['workbenches-smoke.js', '工作台包解析与 A-11 安全校验'],
    ['main-v06-smoke.js', 'Electron 工作台薄层与 unknown 不重试']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.6: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // v0.7 视频驾驶舱：文件合约、拍摄状态机与纯本地窗口全部进统一 smoke。
  for (const [file, label] of [
    ['main-v07-smoke.js', '视频驾驶舱壳、匿名任务条与全宽对话布局'],
    ['main-video-runtime-smoke.js', '视频驾驶舱 token、发布灯、拍摄与写回薄层'],
    ['video-cockpit-smoke.js', '驾驶舱文件契约与 proposal CAS'],
    ['video-shooting-smoke.js', '拍摄 session 状态机与收工计划'],
    ['shooting-window-smoke.js', '纯本地提词器窗口与 IPC 白名单']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.7: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // dsh 跟版候选门：manifest/lock/原生目标/临时路径只做纯 Node fail-closed 校验。
  for (const [file, label] of [
    ['dsh-candidate-smoke.js', 'dsh 候选 runtime 严格入口'],
    ['dsh-candidate-evidence-smoke.js', 'dsh 候选原生证据收集器'],
    ['dsh-candidate-capsule-smoke.js', 'dsh 三平台合规胶囊聚合器'],
    ['dsh-candidate-capsule-verify-smoke.js', 'dsh 候选合规胶囊回读器']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`dsh 跟版: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // v0.7 远程板块：纯 Node 通道核心与 Electron 薄层必须一起拿到证据。
  for (const [file, label] of [
    ['remote-smoke.js', '远程收推批、绑定与生命周期'],
    ['main-remote-smoke.js', '远程设置与 Electron 薄层']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.7: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  // v0.5 宠物包与主题包解析同样必须由统一 smoke 真实执行。
  for (const [file, label] of [
    ['pets-themes-smoke.js', '宠物包与主题包解析'],
    ['main-v05-smoke.js', 'Electron 宠物窗与主题薄层']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check(`v0.5: ${label}直测纳入统一 smoke`, result.status === 0,
      result.status === 0 ? file : `${file} exit=${result.status}`);
  }

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(1);
});
