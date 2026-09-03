'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const backend = require('../lib/backend');
const config = require('../lib/config');

let passed = 0;
const CONTEXT_BRIDGE_PROTOCOL = 'whaledock.context-bridge/v1';

function bridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return crypto.createHmac('sha256', secret)
    .update(`${label}\0${CONTEXT_BRIDGE_PROTOCOL}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  backend-context-poc-assets: ${name}`);
  } catch (error) {
    console.error(`FAIL  backend-context-poc-assets: ${name}`);
    throw error;
  }
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 42420;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

function snapshotTrees(roots) {
  const result = {};
  const visit = (root, current) => {
    const stat = fs.lstatSync(current, { bigint: true });
    const relative = path.relative(root, current) || '.';
    const key = `${path.basename(root)}/${relative}`;
    result[key] = {
      type: stat.isDirectory() ? 'directory' : 'file',
      mode: Number(stat.mode & 0o777n),
      size: Number(stat.size),
      mtimeNs: stat.mtimeNs.toString(),
      sha256: stat.isFile()
        ? crypto.createHash('sha256').update(fs.readFileSync(current)).digest('hex')
        : null
    };
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) visit(root, path.join(current, name));
    }
  };
  for (const root of roots) visit(root, root);
  return result;
}

function makeFixtureRemovable(root) {
  let stat;
  try { stat = fs.lstatSync(root); }
  catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.chmodSync(root, 0o700);
    for (const name of fs.readdirSync(root)) {
      makeFixtureRemovable(path.join(root, name));
    }
  } else if (stat.isFile()) {
    fs.chmodSync(root, 0o600);
  }
}

function runtimeFixture(root, enabled = true) {
  const resourcesPath = path.join(root, 'resources');
  const runtimeRoot = path.join(resourcesPath, 'dsh-runtime');
  const entry = path.join(
    runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'
  );
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '// fixture');
  fs.writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify({
    dshVersion: config.DSH_CONTRACT.packageVersion
  }));
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(userDataPath, { recursive: true });
  return {
    execPath: path.join(root, 'WhaleDock'),
    resourcesPath,
    userDataPath,
    contextPocAssetRoot: path.join(__dirname, '..', 'context-poc'),
    contextPocEnabled: enabled
  };
}

function bundledPlan() {
  return backend.buildBundledCommandPlan(
    '/Applications/WhaleDock.app/Contents/MacOS/WhaleDock',
    '/Applications/WhaleDock.app/Contents/Resources/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    config.DSH_CONTRACT.packageVersion,
    3080
  );
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-context-poc-assets-'));
  try {
    const info = runtimeFixture(tmp);

    await test('planner 只放行 flag + managed bundled + 精确根包证明', async () => {
      assert.deepEqual(backend.contextPocPlan(bundledPlan(), { ...info, contextPocEnabled: false }), {
        eligible: false,
        reason: 'disabled'
      });
      for (const command of [
        { ...bundledPlan(), bundled: false },
        { ...bundledPlan(), packageVersionProof: '0.1.0-rc.6' },
        { ...bundledPlan(), packageVersionProof: null }
      ]) {
        assert.deepEqual(backend.contextPocPlan(command, info), {
          eligible: false,
          reason: 'bridge-unavailable'
        });
      }
      const plan = backend.contextPocPlan(bundledPlan(), info);
      assert.equal(plan.eligible, true);
      assert.equal(plan.sourceRoot, path.resolve(info.contextPocAssetRoot));
      assert.equal(plan.userDataPath, path.resolve(info.userDataPath));
      assert.equal(plan.runtimeModulesPath, path.resolve(
        info.resourcesPath, 'dsh-runtime', 'node_modules'
      ));
      assert.equal(Object.isFrozen(plan), true);
      assert.deepEqual(backend.contextPocPlan(bundledPlan(), {
        ...info, resourcesPath: ''
      }), { eligible: false, reason: 'bridge-unavailable' });

      const winPlan = backend.contextPocPlan(bundledPlan(), {
        ...info,
        contextPocAssetRoot: 'C:\\WhaleDock\\resources\\context-poc',
        userDataPath: 'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock',
        resourcesPath: 'C:\\WhaleDock\\resources'
      }, { platform: 'win32', pathModule: path.win32 });
      assert.equal(winPlan.eligible, true);
      assert.equal(winPlan.sourceRoot, 'C:\\WhaleDock\\resources\\context-poc');
      assert.equal(winPlan.userDataPath,
        'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock');
      assert.equal(winPlan.runtimeModulesPath,
        'C:\\WhaleDock\\resources\\dsh-runtime\\node_modules');
    });

    await test('package link planner 在 Windows 只规划三个精确 junction', async () => {
      const links = backend.contextPocPackageLinkPlan(
        'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock\\context-poc\\v1\\assets\\asset-digest-owner',
        'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock\\context-poc\\v1\\dsh-home',
        { platform: 'win32', pathModule: path.win32 }
      );
      assert.equal(links.length, 3);
      assert.deepEqual(links.map((link) => link.type), ['junction', 'junction', 'junction']);
      assert.deepEqual(links.map((link) => path.win32.basename(link.linkPath)), [
        'context-bridge-poc', 'dsh-client-ui-layout', 'dsh-client-ui-conversation'
      ]);
      assert.equal(links.every((link) => link.linkPath.includes(
        '\\dsh-home\\profiles\\web\\node_modules\\'
      )), true);
      assert.equal(links.every((link) => link.targetPath.includes(
        '\\assets\\asset-digest-owner\\packages\\'
      )), true);
      const resolver = backend.contextPocResolverLinkPlan(
        'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock\\context-poc\\v1\\assets\\asset-digest-owner',
        'C:\\WhaleDock\\resources\\dsh-runtime\\node_modules',
        { platform: 'win32', pathModule: path.win32 }
      );
      assert.deepEqual(resolver, {
        linkPath: 'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock\\context-poc\\v1\\assets\\asset-digest-owner\\node_modules',
        targetPath: 'C:\\WhaleDock\\resources\\dsh-runtime\\node_modules',
        type: 'junction'
      });
    });

    await test('固定基线锁定 15 文件且 2 MiB / 8 MiB 边界 fail-closed', async () => {
      const plan = backend.contextPocPlan(bundledPlan(), info);
      const baseline = backend.contextPocReadAssets(plan);
      const fileLimit = 2 * 1024 * 1024;
      const totalLimit = 8 * 1024 * 1024;
      assert.equal(backend.CONTEXT_POC_LIMITS.maxAssetFileBytes, fileLimit);
      assert.equal(backend.CONTEXT_POC_LIMITS.maxAssetBytes, totalLimit);
      assert.equal(baseline.assets.length, 15);
      assert.equal(baseline.assets.reduce(
        (sum, asset) => sum + asset.data.length, 0
      ) < totalLimit, true);

      const changedRoot = path.join(tmp, 'asset-changed');
      fs.cpSync(plan.sourceRoot, changedRoot, { recursive: true });
      const changedAsset = path.join(
        changedRoot, ...baseline.assets[0].relative.split('/')
      );
      const changedData = fs.readFileSync(changedAsset);
      changedData[0] ^= 0xff;
      fs.writeFileSync(changedAsset, changedData);
      assert.throws(
        () => backend.contextPocReadAssets(
          { ...plan, sourceRoot: changedRoot },
          { crypto: { createHash: () => { throw new Error('must not inject'); } } }
        ),
        /fixed baseline/
      );

      const sourcePaths = baseline.assets.map((asset) => asset.relative);
      const boundaryFiles = sourcePaths.map((relative, index) => ({
        path: relative,
        size: index < 3 ? fileLimit
          : (index === 3 ? fileLimit - (sourcePaths.length - 4) : 1),
        sha256: String(index.toString(16)).slice(-1).repeat(64)
      }));
      const digest = (files) => crypto.createHash('sha256')
        .update(files.map((file) => (
          `${file.path}\0${file.size}\0${file.sha256}`
        )).join('\n')).digest('hex');
      const exactBoundary = {
        schema: 1,
        package: '@whaledock/context-bridge-poc',
        files: boundaryFiles,
        totalBytes: totalLimit,
        digest: digest(boundaryFiles)
      };
      assert.equal(backend.contextPocValidateBaseline(exactBoundary).totalBytes, totalLimit);
      assert.throws(
        () => backend.contextPocValidateBaseline({
          ...exactBoundary,
          files: boundaryFiles.map((file, index) => (
            index === 0 ? { ...file, size: fileLimit + 1 } : file
          ))
        }),
        /file is invalid/
      );
      const aggregateOverflowFiles = boundaryFiles.map((file, index) => (
        index === 3 ? { ...file, size: file.size + 1 } : file
      ));
      assert.throws(
        () => backend.contextPocValidateBaseline({
          ...exactBoundary,
          files: aggregateOverflowFiles,
          totalBytes: totalLimit + 1,
          digest: digest(aggregateOverflowFiles)
        }),
        /fixed baseline (?:is invalid|exceeds total byte limit)/
      );
      assert.throws(
        () => backend.contextPocValidateBaseline({
          ...exactBoundary,
          digest: '0'.repeat(64)
        }),
        /digest is invalid/
      );
    });

    await test('静态资产按摘要复用，稳定 home 跨 prepare 完整保留用户数据', async () => {
      const plan = backend.contextPocPlan(bundledPlan(), info);
      const first = backend.prepareContextPocAssets(plan);
      assert.equal(first.mounted, true);
      assert.match(first.authToken, /^[a-f0-9]{64}$/);
      assert.match(first.selectionToken, /^[a-f0-9]{64}$/);
      assert.equal(fs.statSync(first.patchPath).isFile(), true);
      assert.equal(first.homePath, path.join(
        info.userDataPath, 'context-poc', 'v1', 'dsh-home'
      ));
      assert.equal(first.homePath.startsWith(path.resolve(info.userDataPath) + path.sep), true);
      assert.equal(first.homePath.includes(`${path.sep}.dsh${path.sep}`), false);

      const linkPlan = backend.contextPocPackageLinkPlan(first.mountRoot, first.homePath);
      for (const link of linkPlan) {
        assert.equal(fs.lstatSync(link.linkPath).isSymbolicLink(), true);
        assert.equal(fs.realpathSync(link.linkPath), fs.realpathSync(link.targetPath));
        assert.equal(fs.statSync(path.join(link.linkPath, 'package.json')).isFile(), true);
      }
      const resolver = backend.contextPocResolverLinkPlan(
        first.mountRoot, path.join(info.resourcesPath, 'dsh-runtime', 'node_modules')
      );
      assert.equal(fs.lstatSync(resolver.linkPath).isSymbolicLink(), true);
      assert.equal(fs.realpathSync(resolver.linkPath), fs.realpathSync(resolver.targetPath));
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(first.patchPath).mode & 0o222, 0);
      }

      const sentinels = [
        ['sessions', 'workspace/session.jsonl.zstd', 'session-bytes'],
        ['settings', 'config.json', '{"theme":"dark"}'],
        ['.credentials', 'provider.json', '{"fixture":"redacted"}'],
        ['attachments', 'v1/objects/aa/object.bin', 'attachment-bytes'],
        ['storages', 'session_projcache.json', '{"items":[1]}'],
        ['.agent-presets', 'preset-a/config.json', '{"name":"preset-a"}']
      ];
      const roots = [];
      for (const [directory, relative, data] of sentinels) {
        const root = path.join(first.homePath, directory);
        const file = path.join(root, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
        roots.push(root);
      }
      const before = snapshotTrees(roots);
      const second = backend.prepareContextPocAssets(plan);
      assert.equal(second.assetDigest, first.assetDigest);
      assert.equal(second.homePath, first.homePath);
      assert.equal(second.mountRoot, first.mountRoot);
      assert.notEqual(second.authToken, first.authToken);
      assert.notEqual(second.selectionToken, first.selectionToken);
      assert.deepEqual(snapshotTrees(roots), before,
        'sessions/settings/credentials/attachments/storages/presets 的内容、hash、mtime 必须不变');
      let child = null;
      let runningEnv = null;
      const running = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: info.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin', DSH_HOME: '/must-not-inherit' },
        pathValue: '/usr/bin', runtimeInfo: info,
        spawn(_file, _args, options) {
          runningEnv = options.env;
          child = fakeChild();
          return child;
        }
      });
      assert.equal(running.contextBridgeHomePath, first.homePath);
      assert.equal(runningEnv.DSH_HOME, first.homePath);
      assert.equal(Object.keys(runningEnv)
        .filter((key) => key.toUpperCase() === 'DSH_HOME').length, 1);
      child.emit('exit', 0, null);
      const third = backend.prepareContextPocAssets(plan);
      assert.equal(third.mountRoot, first.mountRoot);
      assert.equal(third.homePath, first.homePath);
      assert.deepEqual(snapshotTrees(roots), before,
        '三次 prepare、真实 exit 回调、再 prepare 后六类持久树必须逐项不变');
    });

    await test('web alias 改为 profile 形式再添加 patch，隔离环境大小写无关', async () => {
      const prepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info),
        { randomBytes: (size) => Buffer.alloc(size, 0xab) }
      );
      const decorated = backend.applyContextPocCommand({
        ...bundledPlan(),
        env: { ELECTRON_RUN_AS_NODE: '1', dsh_home: '/untrusted', Dsh_Home: '/old' }
      }, prepared);
      assert.deepEqual(decorated.args.slice(-7), [
        '--profile', 'web', '--patch', prepared.patchPath, '--port', '3080', '--no-open'
      ]);
      assert.equal(decorated.env.DSH_HOME, prepared.homePath);
      assert.equal(decorated.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN, 'ab'.repeat(32));
      assert.equal(decorated.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN, 'ab'.repeat(32));
      assert.equal(decorated.contextBridgePort, 3080);
      assert.equal(Object.keys(decorated.env).filter((key) => key.toUpperCase() === 'DSH_HOME').length, 1);
      for (const args of [
        ['web', '--patch', '/already', '--port', '3080'],
        ['--profile', 'web', '--port', '3080'],
        ['web', 'web', '--port', '3080'],
        ['web', '--port', '3080', '--port', '3081'],
        ['--port', '3080'],
        ['web', '--port'],
        ['web', '--port', '65536'],
        ['web', '--port', 'not-a-port'],
        ['web', '--port', '0x0c08'],
        ['web', '--port', ' 3080 ']
      ]) {
        assert.throws(() => backend.applyContextPocCommand({
          ...bundledPlan(), args
        }, prepared));
      }
    });

    await test('旧摘要 asset 可共存且不同摘要不改变稳定 data home', async () => {
      const isolated = runtimeFixture(path.join(tmp, 'digest-coexist'));
      const assetsRoot = path.join(isolated.userDataPath, 'context-poc', 'v1', 'assets');
      const oldDigest = '12'.repeat(32);
      const oldRoot = path.join(assetsRoot, `asset-${oldDigest}-${'34'.repeat(8)}`);
      fs.mkdirSync(oldRoot, { recursive: true });
      fs.writeFileSync(path.join(oldRoot, 'old-baseline-sentinel'), 'preserve-old-asset');
      const prepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), isolated)
      );
      assert.notEqual(prepared.mountRoot, oldRoot);
      assert.equal(fs.readFileSync(
        path.join(oldRoot, 'old-baseline-sentinel'), 'utf8'
      ), 'preserve-old-asset');
      assert.equal(prepared.homePath, path.join(
        isolated.userDataPath, 'context-poc', 'v1', 'dsh-home'
      ));
      const again = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), isolated)
      );
      assert.equal(again.homePath, prepared.homePath);
      assert.equal(again.mountRoot, prepared.mountRoot);
    });

    await test('resolver 只绑定当前 bundled modules，篡改根不复用且不触碰外部目标', async () => {
      const tamperedInfo = runtimeFixture(path.join(tmp, 'resolver-tampered'));
      const plan = backend.contextPocPlan(bundledPlan(), tamperedInfo);
      const first = backend.prepareContextPocAssets(plan);
      const expectedModules = path.join(
        tamperedInfo.resourcesPath, 'dsh-runtime', 'node_modules'
      );
      const resolver = backend.contextPocResolverLinkPlan(
        first.mountRoot, expectedModules
      );
      const external = path.join(tmp, 'resolver-external-target');
      fs.mkdirSync(external);
      fs.writeFileSync(path.join(external, 'sentinel'), 'preserve-resolver-target');
      fs.chmodSync(first.mountRoot, 0o700);
      fs.unlinkSync(resolver.linkPath);
      fs.symlinkSync(
        external, resolver.linkPath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      if (process.platform !== 'win32') fs.chmodSync(first.mountRoot, 0o500);

      const rebuilt = backend.prepareContextPocAssets(plan);
      assert.notEqual(rebuilt.mountRoot, first.mountRoot);
      const rebuiltResolver = backend.contextPocResolverLinkPlan(
        rebuilt.mountRoot, expectedModules
      );
      assert.equal(
        fs.realpathSync(rebuiltResolver.linkPath), fs.realpathSync(expectedModules)
      );
      assert.equal(fs.readFileSync(path.join(external, 'sentinel'), 'utf8'),
        'preserve-resolver-target');
      assert.equal(fs.lstatSync(resolver.linkPath).isSymbolicLink(), true,
        '不可信旧 asset 只能跳过，不能删除或跟随其 resolver');

      const occupiedInfo = runtimeFixture(path.join(tmp, 'resolver-occupied'));
      const occupiedPlan = backend.contextPocPlan(bundledPlan(), occupiedInfo);
      const occupied = backend.prepareContextPocAssets(occupiedPlan);
      const occupiedResolver = backend.contextPocResolverLinkPlan(
        occupied.mountRoot,
        path.join(occupiedInfo.resourcesPath, 'dsh-runtime', 'node_modules')
      );
      fs.chmodSync(occupied.mountRoot, 0o700);
      fs.unlinkSync(occupiedResolver.linkPath);
      fs.mkdirSync(occupiedResolver.linkPath);
      fs.writeFileSync(path.join(occupiedResolver.linkPath, 'sentinel'), 'preserve-occupied');
      if (process.platform !== 'win32') fs.chmodSync(occupied.mountRoot, 0o500);
      const occupiedRebuilt = backend.prepareContextPocAssets(occupiedPlan);
      assert.notEqual(occupiedRebuilt.mountRoot, occupied.mountRoot);
      assert.equal(fs.readFileSync(
        path.join(occupiedResolver.linkPath, 'sentinel'), 'utf8'
      ), 'preserve-occupied');
    });

    await test('bundled modules 根为 symlink 时 fail-closed 且 spawn 为零', async () => {
      const unsafeInfo = runtimeFixture(path.join(tmp, 'runtime-modules-symlink'));
      const modulesPath = path.join(
        unsafeInfo.resourcesPath, 'dsh-runtime', 'node_modules'
      );
      const externalModules = path.join(tmp, 'runtime-modules-external');
      fs.renameSync(modulesPath, externalModules);
      fs.symlinkSync(
        externalModules, modulesPath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      fs.writeFileSync(path.join(externalModules, 'sentinel'), 'preserve-runtime-target');
      let spawnCalls = 0;
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: unsafeInfo.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin' }, pathValue: '/usr/bin', runtimeInfo: unsafeInfo,
        spawn() { spawnCalls += 1; return fakeChild(); }
      }), (error) => error && error.code === 'CONTEXT_POC_RUNTIME_UNSAFE');
      assert.equal(spawnCalls, 0);
      assert.equal(fs.readFileSync(
        path.join(externalModules, 'sentinel'), 'utf8'
      ), 'preserve-runtime-target');
    });

    await test('occupied link 与 symlink 祖先 fail-closed，外部目标绝不删除', async () => {
      const occupiedInfo = runtimeFixture(path.join(tmp, 'occupied-package-link'));
      const occupied = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), occupiedInfo)
      );
      const occupiedLink = backend.contextPocPackageLinkPlan(
        occupied.mountRoot, occupied.homePath
      )[0];
      fs.unlinkSync(occupiedLink.linkPath);
      fs.mkdirSync(occupiedLink.linkPath);
      fs.writeFileSync(path.join(occupiedLink.linkPath, 'sentinel'), 'ordinary-directory');
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), occupiedInfo)
      ), /link path is occupied/);
      assert.equal(fs.readFileSync(
        path.join(occupiedLink.linkPath, 'sentinel'), 'utf8'
      ), 'ordinary-directory');
      let unsafeSpawnCalls = 0;
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: occupiedInfo.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin', DSH_HOME: '/must-not-use' },
        pathValue: '/usr/bin', runtimeInfo: occupiedInfo,
        spawn() { unsafeSpawnCalls += 1; return fakeChild(); }
      }), /link path is occupied/);
      assert.equal(unsafeSpawnCalls, 0,
        '持久 home 结构不安全时不得回退到 custom DSH_HOME 或 ~/.dsh 启动');

      const ancestorInfo = runtimeFixture(path.join(tmp, 'symlink-ancestor'));
      const externalAncestor = path.join(tmp, 'external-ancestor-target');
      fs.mkdirSync(externalAncestor);
      fs.writeFileSync(path.join(externalAncestor, 'sentinel'), 'external-preserved');
      const stableRoot = path.join(
        ancestorInfo.userDataPath, 'context-poc', 'v1', 'dsh-home'
      );
      fs.mkdirSync(stableRoot, { recursive: true });
      fs.symlinkSync(externalAncestor, path.join(stableRoot, 'profiles'));
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), ancestorInfo)
      ), /owned regular directory/);
      assert.equal(fs.readFileSync(
        path.join(externalAncestor, 'sentinel'), 'utf8'
      ), 'external-preserved');
      assert.equal(fs.lstatSync(path.join(stableRoot, 'profiles')).isSymbolicLink(), true);

      const replaceInfo = runtimeFixture(path.join(tmp, 'replace-package-symlink'));
      const replace = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), replaceInfo)
      );
      const replaceLink = backend.contextPocPackageLinkPlan(
        replace.mountRoot, replace.homePath
      )[0];
      const externalLinkTarget = path.join(tmp, 'external-link-target');
      fs.mkdirSync(externalLinkTarget);
      fs.writeFileSync(path.join(externalLinkTarget, 'sentinel'), 'do-not-delete-target');
      fs.unlinkSync(replaceLink.linkPath);
      fs.symlinkSync(externalLinkTarget, replaceLink.linkPath, 'dir');
      const replaced = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), replaceInfo)
      );
      assert.equal(fs.readFileSync(
        path.join(externalLinkTarget, 'sentinel'), 'utf8'
      ), 'do-not-delete-target');
      const rebuiltLink = backend.contextPocPackageLinkPlan(
        replaced.mountRoot, replaced.homePath
      )[0];
      assert.equal(fs.realpathSync(rebuiltLink.linkPath), fs.realpathSync(rebuiltLink.targetPath));
    });

    await test('持久数据目录与文件 symlink 在 spawn 前拒绝且不触碰外部目标', async () => {
      const directoryInfo = runtimeFixture(path.join(tmp, 'data-root-directory-link'));
      const directoryPrepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), directoryInfo)
      );
      const externalSessions = path.join(tmp, 'external-sessions');
      fs.mkdirSync(externalSessions);
      fs.writeFileSync(path.join(externalSessions, 'sentinel'), 'sessions-preserved');
      fs.symlinkSync(
        externalSessions,
        path.join(directoryPrepared.homePath, 'sessions'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      let directorySpawnCalls = 0;
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: directoryInfo.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin' }, pathValue: '/usr/bin', runtimeInfo: directoryInfo,
        spawn() { directorySpawnCalls += 1; return fakeChild(); }
      }), /data entry is unsafe/);
      assert.equal(directorySpawnCalls, 0);
      assert.equal(fs.readFileSync(
        path.join(externalSessions, 'sentinel'), 'utf8'
      ), 'sessions-preserved');

      const fileInfo = runtimeFixture(path.join(tmp, 'data-root-file-link'));
      const filePrepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), fileInfo)
      );
      const externalSettings = path.join(tmp, 'external-settings.yaml');
      fs.writeFileSync(externalSettings, 'settings-preserved');
      fs.symlinkSync(externalSettings, path.join(filePrepared.homePath, 'settings.yaml'));
      let fileSpawnCalls = 0;
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: fileInfo.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin' }, pathValue: '/usr/bin', runtimeInfo: fileInfo,
        spawn() { fileSpawnCalls += 1; return fakeChild(); }
      }), /data entry is unsafe/);
      assert.equal(fileSpawnCalls, 0);
      assert.equal(fs.readFileSync(externalSettings, 'utf8'), 'settings-preserved');
    });

    await test('rc.2 profile bootstrap 文件、fallback 根与 scope symlink 均在 spawn 前拒绝', async () => {
      for (const profileFile of [
        'package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'
      ]) {
        const isolated = runtimeFixture(path.join(
          tmp, `profile-file-link-${profileFile.replace(/[^a-z]/g, '-')}`
        ));
        const prepared = backend.prepareContextPocAssets(
          backend.contextPocPlan(bundledPlan(), isolated)
        );
        const external = path.join(
          tmp, `external-${profileFile.replace(/[^a-z]/g, '-')}`
        );
        fs.writeFileSync(external, `${profileFile}-preserved`);
        fs.symlinkSync(
          external, path.join(prepared.homePath, 'profiles', 'web', profileFile)
        );
        let spawnCalls = 0;
        assert.throws(() => backend.start({
          preferBundled: true,
          dshVersion: config.DSH_CONTRACT.packageVersion,
          port: 3080,
          workdir: isolated.userDataPath
        }, {}, {
          platform: process.platform,
          env: { PATH: '/usr/bin' }, pathValue: '/usr/bin', runtimeInfo: isolated,
          spawn() { spawnCalls += 1; return fakeChild(); }
        }), (error) => error && error.code === 'CONTEXT_POC_HOME_UNSAFE');
        assert.equal(spawnCalls, 0);
        assert.equal(fs.readFileSync(external, 'utf8'), `${profileFile}-preserved`);
      }

      const fallbackInfo = runtimeFixture(path.join(tmp, 'profile-fallback-root-link'));
      const fallbackPrepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), fallbackInfo)
      );
      const fallbackExternal = path.join(tmp, 'profile-fallback-external');
      fs.mkdirSync(fallbackExternal);
      fs.writeFileSync(path.join(fallbackExternal, 'sentinel'), 'fallback-preserved');
      fs.symlinkSync(
        fallbackExternal,
        path.join(fallbackPrepared.homePath, 'profiles', 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      let fallbackSpawnCalls = 0;
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: fallbackInfo.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin' }, pathValue: '/usr/bin', runtimeInfo: fallbackInfo,
        spawn() { fallbackSpawnCalls += 1; return fakeChild(); }
      }), (error) => error && error.code === 'CONTEXT_POC_HOME_UNSAFE');
      assert.equal(fallbackSpawnCalls, 0);
      assert.equal(fs.readFileSync(
        path.join(fallbackExternal, 'sentinel'), 'utf8'
      ), 'fallback-preserved');

      const scopeInfo = runtimeFixture(path.join(tmp, 'profile-fallback-scope-link'));
      const scopePrepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), scopeInfo)
      );
      const fallbackRoot = path.join(scopePrepared.homePath, 'profiles', 'node_modules');
      fs.mkdirSync(fallbackRoot);
      const scopeExternal = path.join(tmp, 'profile-scope-external');
      fs.mkdirSync(scopeExternal);
      fs.writeFileSync(path.join(scopeExternal, 'sentinel'), 'scope-preserved');
      fs.symlinkSync(
        scopeExternal, path.join(fallbackRoot, '@external'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      let scopeSpawnCalls = 0;
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: scopeInfo.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin' }, pathValue: '/usr/bin', runtimeInfo: scopeInfo,
        spawn() { scopeSpawnCalls += 1; return fakeChild(); }
      }), (error) => error && error.code === 'CONTEXT_POC_HOME_UNSAFE');
      assert.equal(scopeSpawnCalls, 0);
      assert.equal(fs.readFileSync(
        path.join(scopeExternal, 'sentinel'), 'utf8'
      ), 'scope-preserved');
    });

    await test('源/目标篡改与 symlink 都 fail-closed 且不覆盖', async () => {
      const sourceCopy = path.join(tmp, 'source-copy');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), sourceCopy, { recursive: true });
      fs.writeFileSync(path.join(sourceCopy, 'unknown.txt'), 'reject');
      const badSourceInfo = { ...info, contextPocAssetRoot: sourceCopy };
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), badSourceInfo)
      ), /unknown entries/);

      const modifiedSource = path.join(tmp, 'source-modified');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), modifiedSource, { recursive: true });
      const modifiedFile = path.join(modifiedSource, 'plugin', 'package.json');
      const modifiedBytes = fs.readFileSync(modifiedFile);
      modifiedBytes[0] ^= 0xff;
      fs.writeFileSync(modifiedFile, modifiedBytes);
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), {
          ...info, contextPocAssetRoot: modifiedSource
        })
      ), /fixed baseline/);

      const missingSource = path.join(tmp, 'source-missing');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), missingSource, { recursive: true });
      fs.rmSync(path.join(missingSource, 'plugin', 'lib', 'client.js'));
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), {
          ...info, contextPocAssetRoot: missingSource
        })
      ), /unknown entries/);

      const symlinkSource = path.join(tmp, 'source-symlink');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), symlinkSource, { recursive: true });
      const client = path.join(symlinkSource, 'plugin', 'lib', 'client.js');
      fs.rmSync(client);
      fs.symlinkSync(path.join(__dirname, '..', 'context-poc', 'plugin', 'lib', 'client.js'), client);
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), { ...info, contextPocAssetRoot: symlinkSource })
      ), /bounded regular file/);

      const prepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info)
      );
      const targetClient = path.join(
        prepared.mountRoot, 'packages', '@whaledock',
        'context-bridge-poc', 'lib', 'client.js'
      );
      fs.chmodSync(targetClient, 0o600);
      fs.appendFileSync(targetClient, '\n// tampered');
      const generatedProfile = path.join(
        prepared.homePath, 'profiles', 'web', 'cordis.patch.yml'
      );
      fs.writeFileSync(generatedProfile, 'runtime-state');
      const fresh = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info)
      );
      assert.notEqual(fresh.mountRoot, prepared.mountRoot);
      assert.equal(fresh.homePath, prepared.homePath);
      assert.equal(fs.readFileSync(generatedProfile, 'utf8'), 'runtime-state',
        '重建静态资产时不得重建或清理稳定 DSH_HOME');
      assert.doesNotMatch(fs.readFileSync(path.join(
        fresh.mountRoot, 'packages', '@whaledock',
        'context-bridge-poc', 'lib', 'client.js'
      ), 'utf8'), /tampered/);

      const postRenameInfo = runtimeFixture(path.join(tmp, 'post-rename-failure'));
      let verifyCalls = 0;
      let promotedRoot = null;
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), postRenameInfo),
        {
          verifyContextPocTarget(root) {
            verifyCalls += 1;
            if (verifyCalls === 2) {
              promotedRoot = root;
              throw new Error('post-rename verification fixture');
            }
            return true;
          }
        }
      ), /post-rename verification fixture/);
      assert.equal(verifyCalls, 2);
      assert.equal(fs.existsSync(promotedRoot), false,
        'rename 后二次回读失败也必须凭 state-held owner 回收本次 mount');
    });

    await test('start 对非 bundled 零准备，合格 bundled 失败也完整回退', async () => {
      let prepareCalls = 0;
      const customSpawn = [];
      const custom = backend.start({
        command: 'fixture command', port: 3080, workdir: info.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: info,
        prepareContextPocAssets() { prepareCalls += 1; throw new Error('must not run'); },
        spawn(file, args, options) {
          customSpawn.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(prepareCalls, 0);
      assert.equal(custom.contextBridgeMounted, false);
      assert.equal(customSpawn[0].options.env.DSH_HOME, undefined);

      const bundledSpawn = [];
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: info.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin', dsh_home: '/must-survive-fallback' },
        pathValue: '/usr/bin', runtimeInfo: info,
        prepareContextPocAssets() { prepareCalls += 1; throw new Error('fixture failure'); },
        spawn(file, args, options) {
          bundledSpawn.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(prepareCalls, 1);
      assert.equal(state.contextBridgeMounted, false);
      assert.equal(state.contextBridgeReason, 'bridge-unavailable');
      assert.equal(bundledSpawn[0].args.includes('--patch'), false);
      assert.equal(bundledSpawn[0].options.env.DSH_HOME, path.join(
        info.userDataPath, 'context-poc', 'v1', 'dsh-home'
      ));
      assert.equal(Object.keys(bundledSpawn[0].options.env)
        .filter((key) => key.toUpperCase() === 'DSH_HOME').length, 1,
      'bridge 回退也不得继承 custom DSH_HOME 或落到 ~/.dsh');
      assert.equal(bundledSpawn[0].options.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN, undefined);
    });

    await test('bridge 回退先解除旧 shadow，且不跟随或删除外部链接目标', async () => {
      const isolated = runtimeFixture(path.join(tmp, 'fallback-clears-shadow'));
      const plan = backend.contextPocPlan(bundledPlan(), isolated);
      const prepared = backend.prepareContextPocAssets(plan);
      const links = backend.contextPocPackageLinkPlan(
        prepared.mountRoot, prepared.homePath
      );
      const externalTarget = path.join(tmp, 'fallback-external-target');
      fs.mkdirSync(externalTarget);
      fs.writeFileSync(path.join(externalTarget, 'sentinel'), 'preserve-external');
      fs.unlinkSync(links[0].linkPath);
      fs.symlinkSync(
        externalTarget,
        links[0].linkPath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      const badSource = path.join(tmp, 'fallback-bad-source');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), badSource, { recursive: true });
      fs.appendFileSync(path.join(badSource, 'plugin', 'package.json'), '\n');
      const badInfo = { ...isolated, contextPocAssetRoot: badSource };
      const spawned = [];
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform,
        env: { PATH: '/usr/bin', DSH_HOME: '/must-not-use' },
        pathValue: '/usr/bin', runtimeInfo: badInfo,
        spawn(file, args, options) {
          spawned.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(state.contextBridgeMounted, false);
      assert.equal(state.contextBridgeReason, 'bridge-unavailable');
      assert.equal(spawned.length, 1);
      assert.equal(spawned[0].options.env.DSH_HOME, prepared.homePath);
      assert.equal(spawned[0].args.includes('--patch'), false);
      for (const link of links) {
        assert.equal(fs.existsSync(link.linkPath), false,
          '原生回退时不得留下可解析旧 fork 的 profile-local shadow');
      }
      assert.equal(fs.readFileSync(
        path.join(externalTarget, 'sentinel'), 'utf8'
      ), 'preserve-external');
    });

    await test('装饰回退与受管 child 退出都不清理 asset root 或稳定 home', async () => {
      const fallbackIsolated = runtimeFixture(path.join(tmp, 'cleanup-fallback'));
      let rejectedMount = null;
      let rejectedHome = null;
      const fallbackState = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: fallbackIsolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: fallbackIsolated,
        prepareContextPocAssets(plan, runtime) {
          const prepared = backend.prepareContextPocAssets(plan, runtime);
          rejectedMount = prepared.mountRoot;
          rejectedHome = prepared.homePath;
          return { ...prepared, selectionToken: 'invalid' };
        },
        spawn() { return fakeChild(); }
      });
      assert.equal(fallbackState.contextBridgeMounted, false);
      assert.equal(fs.statSync(rejectedMount).isDirectory(), true);
      assert.equal(fs.statSync(rejectedHome).isDirectory(), true,
        'prepare 成功但命令装饰拒绝时也不得清理稳定数据');

      const spawnFailureInfo = runtimeFixture(path.join(tmp, 'spawn-failure-preserve'));
      const beforeSpawnFailure = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), spawnFailureInfo)
      );
      const spawnFailureSentinel = path.join(
        beforeSpawnFailure.homePath, 'settings', 'spawn-failure.json'
      );
      fs.mkdirSync(path.dirname(spawnFailureSentinel), { recursive: true });
      fs.writeFileSync(spawnFailureSentinel, 'preserve-before-spawn');
      assert.throws(() => backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: spawnFailureInfo.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: spawnFailureInfo,
        spawn() { throw new Error('spawn fixture'); }
      }), /spawn fixture/);
      const afterSpawnFailure = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), spawnFailureInfo)
      );
      assert.equal(afterSpawnFailure.mountRoot, beforeSpawnFailure.mountRoot);
      assert.equal(afterSpawnFailure.homePath, beforeSpawnFailure.homePath);
      assert.equal(fs.readFileSync(spawnFailureSentinel, 'utf8'), 'preserve-before-spawn');

      const isolated = runtimeFixture(path.join(tmp, 'cleanup-start'));
      let child = null;
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: isolated,
        spawn() {
          child = fakeChild();
          return child;
        }
      });
      const mountRoot = state.contextBridgeMountRoot;
      const homePath = state.contextBridgeHomePath;
      const sessionSentinel = path.join(homePath, 'sessions', 'exit-preserve.jsonl');
      fs.mkdirSync(path.dirname(sessionSentinel), { recursive: true });
      fs.writeFileSync(sessionSentinel, 'preserve-on-exit');
      assert.equal(fs.statSync(mountRoot).isDirectory(), true);
      child.emit('exit', 0, null);
      assert.equal(state.exited, true);
      assert.equal(fs.statSync(mountRoot).isDirectory(), true);
      assert.equal(fs.readFileSync(sessionSentinel, 'utf8'), 'preserve-on-exit');
      const restarted = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), isolated)
      );
      assert.equal(restarted.mountRoot, mountRoot);
      assert.equal(restarted.homePath, homePath);
      assert.equal(fs.readFileSync(sessionSentinel, 'utf8'), 'preserve-on-exit');
      assert.equal(backend.cleanupContextPocMount(
        isolated.userDataPath,
        path.dirname(isolated.userDataPath),
        '00'.repeat(32),
        { platform: process.platform }
      ), false, '宽目标必须拒绝清理');
      assert.equal(fs.statSync(isolated.userDataPath).isDirectory(), true);

      const forgedParent = path.join(tmp, 'forged-parent');
      const forgedOwner = 'ef'.repeat(32);
      const forgedDigest = 'cd'.repeat(32);
      const forgedRoot = path.join(
        forgedParent, `asset-${forgedDigest}-${forgedOwner.slice(0, 16)}`
      );
      fs.mkdirSync(forgedRoot, { recursive: true });
      fs.writeFileSync(path.join(forgedRoot, '.whaledock-context-poc.json'), JSON.stringify({
        schema: 1,
        digest: forgedDigest,
        package: '@whaledock/context-bridge-poc',
        ownerToken: forgedOwner
      }));
      assert.equal(backend.cleanupContextPocMount(
        forgedRoot, forgedParent, 'ab'.repeat(32), { platform: process.platform }
      ), false, 'marker 自报 owner 与 state-held owner 不符时不得删除');
      assert.equal(fs.statSync(forgedRoot).isDirectory(), true);
    });

    await test('启动 sweep 仅清可信 staging，sealed/未知 asset 与稳定 home 全保留', async () => {
      const isolated = runtimeFixture(path.join(tmp, 'startup-sweep'));
      const plan = backend.contextPocPlan(bundledPlan(), isolated);
      const prepared = backend.prepareContextPocAssets(plan);
      const runsRoot = prepared.mountParent;

      const stagingDigest = prepared.assetDigest;
      const stagingOwner = '34'.repeat(32);
      const stagingRoot = path.join(
        runsRoot, `.staging-${stagingDigest}-${stagingOwner.slice(0, 16)}`
      );
      fs.mkdirSync(stagingRoot);
      fs.writeFileSync(
        path.join(stagingRoot, '.whaledock-context-poc-staging'),
        JSON.stringify({
          schema: 1,
          package: '@whaledock/context-bridge-poc',
          digest: stagingDigest,
          ownerToken: stagingOwner,
          state: 'staging'
        })
      );
      fs.writeFileSync(path.join(stagingRoot, 'partial'), 'owned');

      const unknownRoot = path.join(runsRoot, 'unknown-entry');
      fs.mkdirSync(unknownRoot);
      const oldDigest = '56'.repeat(32);
      const oldOwner = '78'.repeat(32);
      const oldRoot = path.join(
        runsRoot, `.staging-${oldDigest}-${oldOwner.slice(0, 16)}`
      );
      fs.mkdirSync(oldRoot);
      fs.writeFileSync(
        path.join(oldRoot, '.whaledock-context-poc-staging'), `${oldDigest}\n`
      );

      const forgedDigest = '9a'.repeat(32);
      const forgedOwner = 'bc'.repeat(32);
      const forgedRoot = path.join(
        runsRoot, `asset-${forgedDigest}-${'de'.repeat(8)}`
      );
      fs.mkdirSync(forgedRoot);
      fs.writeFileSync(
        path.join(forgedRoot, '.whaledock-context-poc.json'),
        JSON.stringify({
          schema: 1,
          package: '@whaledock/context-bridge-poc',
          digest: forgedDigest,
          ownerToken: forgedOwner
        })
      );

      const mismatchedDigest = 'c1'.repeat(32);
      const mismatchedNameDigest = 'd2'.repeat(32);
      const mismatchedOwner = 'e3'.repeat(32);
      const mismatchedDigestRoot = path.join(
        runsRoot,
        `asset-${mismatchedNameDigest}-${mismatchedOwner.slice(0, 16)}`
      );
      fs.mkdirSync(mismatchedDigestRoot);
      fs.writeFileSync(
        path.join(mismatchedDigestRoot, '.whaledock-context-poc.json'),
        JSON.stringify({
          schema: 1,
          package: '@whaledock/context-bridge-poc',
          digest: mismatchedDigest,
          ownerToken: mismatchedOwner
        })
      );

      const outsideRoot = path.join(tmp, 'startup-sweep-symlink-target');
      const linkDigest = 'ef'.repeat(32);
      const linkOwner = '01'.repeat(32);
      fs.mkdirSync(outsideRoot);
      fs.writeFileSync(path.join(outsideRoot, 'sentinel'), 'preserve');
      fs.writeFileSync(
        path.join(outsideRoot, '.whaledock-context-poc.json'),
        JSON.stringify({
          schema: 1,
          package: '@whaledock/context-bridge-poc',
          digest: linkDigest,
          ownerToken: linkOwner
        })
      );
      const linkRoot = path.join(
        runsRoot, `asset-${linkDigest}-${linkOwner.slice(0, 16)}`
      );
      fs.symlinkSync(outsideRoot, linkRoot);

      const result = backend.cleanupContextPocRuns(isolated.userDataPath);
      assert.deepEqual(result, { scanned: 7, removed: 1, skipped: 6 });
      assert.equal(fs.existsSync(prepared.mountRoot), true,
        '崩溃后 final run 可能仍被 detached dsh 使用，不能凭自报 marker 删除');
      assert.equal(fs.existsSync(stagingRoot), false);
      for (const preserved of [
        unknownRoot, oldRoot, forgedRoot, mismatchedDigestRoot, linkRoot
      ]) {
        assert.equal(fs.lstatSync(preserved).isDirectory()
          || fs.lstatSync(preserved).isSymbolicLink(), true);
      }
      assert.equal(fs.readFileSync(path.join(outsideRoot, 'sentinel'), 'utf8'), 'preserve');
    });

    await test('启动 sweep 每次最多检查 1024 项并保留超出项', async () => {
      const isolated = runtimeFixture(path.join(tmp, 'startup-sweep-limit'));
      const runsRoot = path.join(
        isolated.userDataPath, 'context-poc', 'v1', 'assets'
      );
      fs.mkdirSync(runsRoot, { recursive: true });
      for (let index = 0; index < 1025; index += 1) {
        fs.mkdirSync(path.join(runsRoot, `unknown-${String(index).padStart(4, '0')}`));
      }
      const result = backend.cleanupContextPocRuns(isolated.userDataPath);
      assert.deepEqual(result, { scanned: 1024, removed: 0, skipped: 1025 });
      assert.equal(fs.readdirSync(runsRoot).length, 1025);
    });

    await test('首包用 nonce 请求 MAC，验 PoP 后才派生 session token', async () => {
      const spawned = [];
      const isolated = runtimeFixture(path.join(tmp, 'eligible-start'));
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin', Dsh_Home: '/old' },
        pathValue: '/usr/bin', runtimeInfo: isolated,
        spawn(file, args, options) {
          spawned.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(state.contextBridgeMounted, true);
      assert.equal(spawned[0].args.includes('--patch'), true);
      assert.equal(Object.keys(spawned[0].options.env)
        .filter((key) => key.toUpperCase() === 'DSH_HOME').length, 1);
      assert.equal(JSON.stringify(state).includes('contextBridgeAuthToken'), false);
      assert.equal(JSON.stringify(state).includes(isolated.userDataPath), false);
      assert.equal(Object.keys(state).includes('contextBridgePort'), false);
      assert.equal(Object.keys(state).includes('contextBridgeSpawnChild'), false);
      assert.equal(Object.keys(state).includes('contextBridgeSelectionToken'), false);

      const secret = spawned[0].options.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
      const hostInstanceId = 'host-12345678';
      const requestBodies = [];
      let swapDuringReply = false;
      const request = (options, callback) => {
        assert.equal(options.hostname, '127.0.0.1');
        assert.equal(options.port, 3080);
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = (body) => {
          const requestBody = JSON.parse(body);
          requestBodies.push(requestBody);
          const response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          let value;
          if (requestBody.method === 'handshake') {
            assert.equal(Object.prototype.hasOwnProperty.call(
              requestBody.payload, 'authToken'
            ), false);
            assert.match(requestBody.payload.clientNonce, /^[a-f0-9]{64}$/);
            assert.equal(requestBody.payload.requestProof, bridgeHmac(
              secret, 'handshake-request', requestBody.payload.clientNonce, ''
            ));
            value = {
              ok: true,
              type: 'handshake',
              protocol: CONTEXT_BRIDGE_PROTOCOL,
              contract: CONTEXT_BRIDGE_PROTOCOL,
              hostInstanceId,
              capabilities: ['selection-authority'],
              clientNonce: requestBody.payload.clientNonce,
              proof: bridgeHmac(
                secret, 'handshake-proof', requestBody.payload.clientNonce, hostInstanceId
              )
            };
          } else {
            if (swapDuringReply) state.child = fakeChild();
            value = {
              state: 'none', hostInstanceId, sessionRef: null, code: null
            };
          }
          response.end(JSON.stringify({
            type: 'server-response',
            rpcId: requestBody.rpcId,
            result: { ok: true, value }
          }));
        };
        return req;
      };
      const transport = backend.createContextBridgeTransport(state, {
        request,
        randomBytes: (size) => Buffer.alloc(size, 0x11)
      });
      const input = Object.freeze({
        type: 'handshake', protocol: CONTEXT_BRIDGE_PROTOCOL
      });
      const reply = await transport(input);
      assert.deepEqual(reply, {
        ok: true,
        type: 'handshake',
        protocol: CONTEXT_BRIDGE_PROTOCOL,
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        capabilities: ['selection-authority']
      });
      const handshakeBody = requestBodies[0];
      assert.equal(handshakeBody.method, 'handshake');
      assert.deepEqual(Object.keys(handshakeBody.payload).sort(), [
        'clientNonce', 'protocol', 'requestProof', 'type'
      ]);
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'authToken'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'clientNonce'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'proof'), false);
      assert.equal(typeof transport.call, 'function');

      const resolved = await transport.call('selection/resolve', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        controllerId: 'controller-12345678'
      });
      assert.deepEqual(resolved, {
        state: 'none', hostInstanceId, sessionRef: null, code: null
      });
      const sessionBody = requestBodies[1];
      const expectedSessionToken = bridgeHmac(
        secret, 'rpc-session', handshakeBody.payload.clientNonce, hostInstanceId
      );
      assert.equal(sessionBody.payload.authToken, expectedSessionToken);
      assert.notEqual(sessionBody.payload.authToken, secret);

      const preferenceSnapshot = Object.freeze({
        revision: 1,
        contentViewMode: 'content',
        contentViewHintSeen: false
      });
      await transport.call('ui/preferences/sync', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        snapshot: preferenceSnapshot
      });
      await transport.call('ui/preferences/read', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId
      });
      await transport.call('ui/preferences/settle', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        requestToken: 'ab'.repeat(32),
        status: 'rejected',
        code: 'preferences-stale',
        snapshot: preferenceSnapshot
      });
      const preferenceBodies = requestBodies.slice(2, 5);
      assert.deepEqual(preferenceBodies.map((body) => body.method), [
        'ui/preferences/sync', 'ui/preferences/read', 'ui/preferences/settle'
      ]);
      for (const body of preferenceBodies) {
        assert.equal(body.payload.authToken, expectedSessionToken);
        assert.equal(JSON.stringify(body.payload).includes(secret), false);
        assert.equal(JSON.stringify(body.payload).includes('sessionRef'), false);
      }
      assert.equal(Object.prototype.hasOwnProperty.call(preferenceSnapshot, 'authToken'), false);

      await transport.call('workspace/files/read', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        limit: 4
      });
      await transport.call('workspace/files/claim', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        requestToken: 'ab'.repeat(32),
        requestSeq: 1
      });
      await transport.call('workspace/files/authorize', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        requestToken: 'ab'.repeat(32),
        requestSeq: 1,
        claimToken: 'cd'.repeat(32)
      });
      await transport.call('workspace/files/settle', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        requestToken: 'ab'.repeat(32),
        requestSeq: 1,
        claimToken: 'cd'.repeat(32),
        status: 'rejected',
        code: 'operation-stale',
        result: null
      });
      const nearConsoleLimit = {
        kind: 'console',
        padding: 'x'.repeat(63 * 1024)
      };
      await transport.call('workspace/files/settle', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        requestToken: 'ab'.repeat(32),
        requestSeq: 1,
        claimToken: 'cd'.repeat(32),
        status: 'fulfilled',
        code: null,
        result: nearConsoleLimit
      });
      const workspaceBodies = requestBodies.slice(5, 10);
      assert.deepEqual(workspaceBodies.map((body) => body.method), [
        'workspace/files/read', 'workspace/files/claim', 'workspace/files/authorize',
        'workspace/files/settle', 'workspace/files/settle'
      ]);
      assert.equal(workspaceBodies.every((body) => (
        body.payload.authToken === expectedSessionToken
          && JSON.stringify(body.payload).includes(secret) === false
      )), true);
      const largeSettleBody = workspaceBodies.at(-1);
      assert.equal(Buffer.byteLength(JSON.stringify(largeSettleBody), 'utf8')
        > backend.CONTEXT_POC_LIMITS.maxRequestBytes, true,
      'console.read 合法大结果不能被普通 8KiB 上限误伤');
      assert.equal(Buffer.byteLength(JSON.stringify(largeSettleBody), 'utf8')
        < backend.CONTEXT_POC_LIMITS.maxWorkspaceSettleRequestBytes, true);

      const beforeOversizeSettle = requestBodies.length;
      await assert.rejects(() => transport.call('workspace/files/settle', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        requestToken: 'ab'.repeat(32),
        requestSeq: 1,
        claimToken: 'cd'.repeat(32),
        status: 'fulfilled',
        code: null,
        result: { padding: 'x'.repeat(
          backend.CONTEXT_POC_LIMITS.maxWorkspaceSettleRequestBytes
        ) }
      }), /too large/);
      assert.equal(requestBodies.length, beforeOversizeSettle,
        '超过 settle 专属上限必须在底层请求前拒绝');

      await assert.rejects(() => transport.call('unknown', {}));
      const beforeOversizeOrdinary = requestBodies.length;
      await assert.rejects(() => transport.call('context/stage', {
        text: 'x'.repeat(backend.CONTEXT_POC_LIMITS.maxRequestBytes)
      }), /too large/);
      assert.equal(requestBodies.length, beforeOversizeOrdinary,
        '普通端点超过 8KiB 必须在底层请求前拒绝');

      let refusedRequests = 0;
      const refusedRequest = () => {
        refusedRequests += 1;
        throw new Error('must not request');
      };
      const wrongPort = backend.createContextBridgeTransport(state, {
        port: 3081, request: refusedRequest
      });
      await assert.rejects(() => wrongPort(input), /unavailable/);
      assert.equal(refusedRequests, 0);

      const requestCount = requestBodies.length;
      state.exited = true;
      await assert.rejects(() => transport.call('selection/resolve', {}), /unavailable/);
      state.exited = false;
      assert.equal(requestBodies.length, requestCount);

      const spawnedChild = state.child;
      state.child = fakeChild();
      await assert.rejects(() => transport.call('selection/resolve', {}), /unavailable/);
      state.child = spawnedChild;
      assert.equal(requestBodies.length, requestCount);

      swapDuringReply = true;
      await assert.rejects(() => transport.call('selection/resolve', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        controllerId: 'controller-12345678'
      }), /unavailable/);
      state.child = spawnedChild;
      swapDuringReply = false;

      let badHandshakeBody = null;
      const badProofRequest = (_options, callback) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = (body) => {
          badHandshakeBody = JSON.parse(body);
          const response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          response.end(JSON.stringify({
            type: 'server-response',
            rpcId: badHandshakeBody.rpcId,
            result: { ok: true, value: {
              ok: true,
              type: 'handshake',
              protocol: CONTEXT_BRIDGE_PROTOCOL,
              contract: CONTEXT_BRIDGE_PROTOCOL,
              hostInstanceId,
              capabilities: [],
              clientNonce: badHandshakeBody.payload.clientNonce,
              proof: '00'.repeat(32)
            } }
          }));
        };
        return req;
      };
      const badProof = backend.createContextBridgeTransport(state, {
        request: badProofRequest,
        randomBytes: (size) => Buffer.alloc(size, 0x22)
      });
      await assert.rejects(() => badProof(input), /proof invalid/);
      assert.equal(Object.prototype.hasOwnProperty.call(
        badHandshakeBody.payload, 'authToken'
      ), false);
      await assert.rejects(() => badProof.call('selection/resolve', {}), /unavailable/);
    });

    await test('持续回流量也不能续期 RPC 的绝对总 deadline', async () => {
      const spawned = [];
      const isolated = runtimeFixture(path.join(tmp, 'deadline-start'));
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' },
        pathValue: '/usr/bin', runtimeInfo: isolated,
        spawn(file, args, options) {
          spawned.push({ file, args, options });
          return fakeChild();
        }
      });
      const secret = spawned[0].options.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
      const hostInstanceId = 'host-deadline1';
      let slowChunks = 0;
      let cleanupSlowResponse = () => {};
      const request = (_options, callback) => {
        const req = new EventEmitter();
        let response = null;
        let interval = null;
        req.destroy = () => {
          if (interval !== null) clearInterval(interval);
          interval = null;
          if (response && !response.destroyed) response.destroy();
        };
        req.end = (body) => {
          const requestBody = JSON.parse(body);
          response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          if (requestBody.method === 'handshake') {
            const clientNonce = requestBody.payload.clientNonce;
            response.end(JSON.stringify({
              type: 'server-response',
              rpcId: requestBody.rpcId,
              result: { ok: true, value: {
                ok: true,
                type: 'handshake',
                protocol: CONTEXT_BRIDGE_PROTOCOL,
                contract: CONTEXT_BRIDGE_PROTOCOL,
                hostInstanceId,
                capabilities: [],
                clientNonce,
                proof: bridgeHmac(
                  secret, 'handshake-proof', clientNonce, hostInstanceId
                )
              } }
            }));
            return;
          }
          interval = setInterval(() => {
            slowChunks += 1;
            response.write(' ');
          }, 3);
          cleanupSlowResponse = req.destroy;
        };
        return req;
      };
      const transport = backend.createContextBridgeTransport(state, {
        request,
        timeoutMs: 45,
        randomBytes: (size) => Buffer.alloc(size, 0x33)
      });
      await transport({ type: 'handshake', protocol: CONTEXT_BRIDGE_PROTOCOL });

      const startedAt = Date.now();
      let watchdog = null;
      try {
        await assert.rejects(Promise.race([
          transport.call('events/read', {
            contract: CONTEXT_BRIDGE_PROTOCOL,
            hostInstanceId,
            afterEventSeq: 0
          }),
          new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('deadline test watchdog')), 750);
          })
        ]), /context bridge RPC timeout/);
      } finally {
        if (watchdog !== null) clearTimeout(watchdog);
        cleanupSlowResponse();
      }
      const elapsedMs = Date.now() - startedAt;
      assert.equal(slowChunks >= 2, true);
      assert.equal(elapsedMs < 500, true);
    });

    console.log(`\nBACKEND CONTEXT POC ASSETS ALL PASS (${passed})`);
  } finally {
    makeFixtureRemovable(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
