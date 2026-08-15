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
      && bundledFallback.bundled === true
      && bundledFallback.env.ELECTRON_RUN_AS_NODE === '1'
      && bundledFallback.args[0] === '--expose-internals'
      && bundledFallback.args[1].endsWith(path.join('@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      && bundledPreferred.bundled === true
      && pathFirst.file === '/test/bin/dsh'
      && missingBundled === null,
    bundledFallback ? bundledFallback.label : 'null');

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
  const empty = backend.resolveCommand({ dshVersion: '  ' }, onlyNpx);
  check('backend: npx 回退命令带版本锁',
    pinned.file === '/test/bin/npx'
      && pinned.shell === false
      && pinned.version === '0.1.0-rc.6'
      && JSON.stringify(pinned.args) === JSON.stringify([
        '-y', '@deepseek-ai/dsh@0.1.0-rc.6', 'web', '--port', '3080'
      ])
      && pinned.label === 'npx -y @deepseek-ai/dsh@0.1.0-rc.6 web --port 3080'
      && latest.args[1] === '@deepseek-ai/dsh@latest'
      && latest.version === 'latest'
      && empty.args[1] === '@deepseek-ai/dsh@0.1.0-rc.6',
    pinned.label);

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

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(1);
});
