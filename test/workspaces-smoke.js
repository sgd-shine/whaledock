'use strict';

// v0.4 Phase A/B：配置首启、recent、journal 与工作区切换纯 Node 直测。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../lib/config');
const workspaces = require('../lib/workspaces');

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  workspaces: ${name}`);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function configFile(dir) { return path.join(dir, 'config.json'); }

// 与产品同一口径的既有路径身份：原生 realpath（Windows 展开 8.3 短名）后去掉 \\?\ 前缀。
// 这里直接用 Node/libuv 的结果，不复用产品实现，才能证明产品与操作系统口径一致。
function osRealPath(value) {
  const realpathSync = fs.realpathSync.native || fs.realpathSync;
  let resolved = realpathSync(value);
  if (process.platform === 'win32') {
    if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`;
    else if (/^\\\\\?\\[A-Za-z]:/.test(resolved)) resolved = resolved.slice(4);
  }
  return path.resolve(resolved);
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeJournal(calls, initial = null) {
  let current = initial;
  return {
    read() { calls.push('journal-read'); return current; },
    cleanupCompleted() { calls.push('journal-cleanup-completed'); return true; },
    writePrepared(value) {
      calls.push('journal-prepared');
      current = { ...value, phase: 'prepared' };
      return current;
    },
    writeConfigApplied(value) {
      calls.push('journal-config-applied');
      current = { ...value, phase: 'config-applied' };
      return current;
    },
    finalize() {
      calls.push('journal-finalize');
      current = null;
      return { completed: true, cleanupPending: false };
    },
    remove() { calls.push('journal-remove'); current = null; return true; },
    current: () => current
  };
}

function coordinatorFixture(options = {}) {
  const calls = [];
  let configState = {
    workdir: options.workdir === undefined ? '/workspace/A' : options.workdir,
    recentWorkdirs: options.recentWorkdirs || ['/workspace/A']
  };
  let runtime = options.runtime || {
    backendReady: true,
    spawnedByUs: true,
    state: { name: 'old', exited: false }
  };
  let paused = options.paused === true;
  const journal = options.journal || fakeJournal(calls, options.initialJournal || null);
  const canonicalize = options.canonicalize || ((value) => {
    const resolved = path.posix.resolve(value);
    return { path: resolved, key: resolved };
  });
  const startImpl = options.startAndConfirm || (async ({ workdir, rollback }) => {
    calls.push(rollback ? `start-rollback:${workdir}` : `start-target:${workdir}`);
    return { state: { name: rollback ? 'rollback' : 'target', exited: false }, effectiveWorkdir: workdir };
  });
  const startAndConfirm = async (request) => {
    const result = await startImpl(request);
    if (result && result.state) {
      runtime = { backendReady: true, spawnedByUs: true, state: result.state };
    }
    return result;
  };
  const stopManaged = options.stopManaged || (async (state) => {
    calls.push(`stop:${state.name}`);
    state.exited = true;
  });
  const coordinator = workspaces.createWorkspaceSwitchCoordinator({
    platform: 'darwin',
    homeDir: '/Users/tester',
    canonicalize,
    getConfig: () => ({ ...configState, recentWorkdirs: [...configState.recentWorkdirs] }),
    setWorkspaceConfig: async (patch) => {
      calls.push(`config:${patch.workdir}`);
      configState = { ...configState, ...patch, recentWorkdirs: [...patch.recentWorkdirs] };
    },
    getRuntime: () => runtime,
    isBudgetPaused: () => paused,
    journal,
    invalidateCaptures: async () => { calls.push('invalidate-captures'); },
    quiesceEvents: async () => { calls.push('quiesce-events'); },
    stopManaged,
    startAndConfirm,
    recoveryPortClear: options.recoveryPortClear || (async () => true),
    beforeSwitch: options.beforeSwitch,
    onCommit: async () => { calls.push('commit-surface'); },
    onRollback: async () => { calls.push('rollback-surface'); }
  });
  return {
    coordinator,
    calls,
    journal,
    getConfig: () => configState,
    getRuntime: () => runtime,
    setRuntime: (value) => { runtime = value; },
    setPaused: (value) => { paused = value; }
  };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-v04-workspaces-'));
  try {
    await test('config 仅对 ENOENT 创建并应用 freshDefaults', async () => {
      const dir = path.join(tmp, 'fresh');
      const freshWorkdir = path.join(tmp, 'fresh-workspace');
      fs.mkdirSync(freshWorkdir);
      const value = config.init(dir, { freshDefaults: { workdir: freshWorkdir } });
      assert.equal(value.workdir, path.resolve(freshWorkdir));
      assert.deepEqual(value.recentWorkdirs, []);
      assert.equal(value.screenshotHotkeyEnabled, true);
      assert.equal(value.screenshotHotkey, 'CommandOrControl+Shift+S');
      assert.equal(JSON.parse(fs.readFileSync(configFile(dir), 'utf8')).workdir, path.resolve(freshWorkdir));
    });

    await test('existing explicit/null/缺 workdir 均忽略 freshDefaults', async () => {
      const freshWorkdir = path.join(tmp, 'must-not-apply');
      for (const [name, raw, expected] of [
        ['explicit', { workdir: '/existing/project', port: 4100 }, path.resolve('/existing/project')],
        ['null', { workdir: null, port: 4101 }, null],
        ['missing-field', { port: 4102 }, null]
      ]) {
        const dir = path.join(tmp, `existing-${name}`);
        writeJson(configFile(dir), raw);
        const before = fs.readFileSync(configFile(dir), 'utf8');
        const value = config.init(dir, { freshDefaults: { workdir: freshWorkdir } });
        assert.equal(value.workdir, expected, name);
        assert.equal(fs.readFileSync(configFile(dir), 'utf8'), before, `${name} 不应因补默认就重写`);
      }
    });

    await test('freshDefaults 工厂仅在实际 ENOENT 时执行', async () => {
      let calls = 0;
      const freshDir = path.join(tmp, 'fresh-factory');
      const first = config.init(freshDir, {
        freshDefaults: () => { calls += 1; return { workdir: '/factory-workspace' }; }
      });
      assert.equal(first.workdir, path.resolve('/factory-workspace'));
      assert.equal(calls, 1);
      const second = config.init(freshDir, {
        freshDefaults: () => { calls += 1; throw new Error('existing 不得执行'); }
      });
      assert.equal(second.workdir, path.resolve('/factory-workspace'));
      assert.equal(calls, 1);
    });

    await test('existing 坏 JSON 或不可读节点不会被默认值覆盖', async () => {
      const badDir = path.join(tmp, 'bad-json');
      fs.mkdirSync(badDir);
      fs.writeFileSync(configFile(badDir), '{bad-json');
      const before = fs.readFileSync(configFile(badDir));
      assert.throws(() => config.init(badDir, { freshDefaults: { workdir: '/new' } }), assertCode('CONFIG_READ_FAILED'));
      assert.deepEqual(fs.readFileSync(configFile(badDir)), before);

      const unreadableDir = path.join(tmp, 'unreadable-node');
      fs.mkdirSync(configFile(unreadableDir), { recursive: true });
      assert.throws(() => config.init(unreadableDir, { freshDefaults: { workdir: '/new' } }), assertCode('CONFIG_READ_FAILED'));
      assert(fs.statSync(configFile(unreadableDir)).isDirectory());
    });

    await test('config 对数组与 bounds 返回深拷贝', async () => {
      const dir = path.join(tmp, 'clone');
      config.init(dir);
      config.set({ recentWorkdirs: ['/one'], bounds: { x: 1, y: 2, width: 800, height: 600 } });
      const first = config.get();
      first.recentWorkdirs.push('/mutated');
      first.bounds.width = 9999;
      assert.deepEqual(config.get('recentWorkdirs'), [path.resolve('/one')]);
      assert.equal(config.get('bounds').width, 800);
      const recent = config.get('recentWorkdirs');
      recent.push('/also-mutated');
      assert.equal(config.get('recentWorkdirs').length, 1);
    });

    await test('workdir 移出通用设置白名单，截图字段受跨快捷键校验', async () => {
      const dir = path.join(tmp, 'settings-fields');
      config.init(dir);
      assert(!config.SETTINGS_FIELDS.has('workdir'));
      assert(config.SETTINGS_FIELDS.has('screenshotHotkeyEnabled'));
      assert(config.SETTINGS_FIELDS.has('screenshotHotkey'));
      assert.throws(() => config.validateSettingsPatch({ workdir: '/forbidden' }), (error) => (
        error && error.code === 'INVALID_CONFIG' && error.field === 'workdir'
      ));
      assert.throws(() => config.validateSettingsPatch({
        hotkey: 'CommandOrControl+Shift+S'
      }), (error) => error && error.code === 'INVALID_CONFIG' && error.field === 'screenshotHotkey');
      assert.deepEqual(config.validateSettingsPatch({
        screenshotHotkeyEnabled: false,
        screenshotHotkey: 'CommandOrControl+Shift+H'
      }), {
        screenshotHotkeyEnabled: false,
        screenshotHotkey: 'CommandOrControl+Shift+H'
      });

      const legacyCollisionDir = path.join(tmp, 'legacy-shortcut-collision');
      writeJson(configFile(legacyCollisionDir), { hotkey: 'CommandOrControl+Shift+S' });
      config.init(legacyCollisionDir);
      assert.doesNotThrow(() => config.set({ bounds: { width: 800, height: 600 } }));
    });

    await test('默认工作区只 chmod 新建目录，已有目录安全复用', async () => {
      const documents = path.join(tmp, 'Documents');
      const first = workspaces.ensureDefaultWorkspace(documents);
      assert.equal(first.created, true);
      assert.equal(first.canonicalPath, osRealPath(path.join(
        documents, '鲸坞工作台', '默认工作区'
      )));
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(first.canonicalPath).mode & 0o777, 0o700);
        fs.chmodSync(first.canonicalPath, 0o755);
      }
      const second = workspaces.ensureDefaultWorkspace(documents);
      assert.equal(second.created, false);
      if (process.platform !== 'win32') assert.equal(fs.statSync(second.canonicalPath).mode & 0o777, 0o755);

      const badDocuments = path.join(tmp, 'Documents-file');
      const badTarget = workspaces.defaultWorkspacePath(badDocuments);
      fs.mkdirSync(path.dirname(badTarget), { recursive: true });
      fs.writeFileSync(badTarget, 'not-a-directory');
      assert.throws(() => workspaces.ensureDefaultWorkspace(badDocuments), assertCode('ERR_WORKSPACE_NOT_DIRECTORY'));
    });

    await test('canonical workspace 跟随工作区自身 symlink 并返回平台比较键', async () => {
      const real = path.join(tmp, 'canonical-real');
      const link = path.join(tmp, 'canonical-link');
      fs.mkdirSync(real);
      fs.symlinkSync(real, link, 'dir');
      const value = workspaces.canonicalWorkspace(link);
      assert.equal(value.path, osRealPath(real));
      assert.equal(value.key, process.platform === 'win32' ? value.path.toLowerCase() : value.path);
      assert.throws(() => workspaces.canonicalWorkspace(path.join(tmp, 'missing')), assertCode('ERR_WORKSPACE_NOT_DIRECTORY'));
    });

    await test('路径身份统一走原生 realpath：Windows 8.3 别名与 \\\\?\\ 前缀不能绕过受保护根', async () => {
      // JS 版 fs.realpathSync 只解析 symlink，会保留 8.3 短名；原生版返回最终长路径。
      // 产品必须取原生结果，否则 lib/image-input.js（fs.promises.realpath 是原生实现）
      // 拿到的长路径与受保护根的短路径比不上，别名工作区就能绕过保护。
      const shortHome = 'C:\\Users\\RUNNER~1\\home';
      const longRoot = 'C:\\Users\\runneradmin\\home\\.dsh';
      const win32Options = { platform: 'win32', pathImpl: path.win32, homeDir: shortHome };
      const fsImpl = {
        realpathSync: Object.assign((value) => value, {
          native: (value) => (value === 'C:\\Users\\RUNNER~1\\home\\.dsh'
            ? `\\\\?\\${longRoot}` : value)
        })
      };
      const roots = config.protectedWorkspaceRoots({ ...win32Options, fsImpl });
      assert(roots.includes(longRoot), '受保护根必须归一为原生长路径且去掉 \\\\?\\ 前缀');
      assert.equal(config.isProtectedWorkspacePath(`${longRoot}\\project`, {
        ...win32Options, fsImpl
      }), true);

      const wsFsImpl = {
        statSync: () => ({ isDirectory: () => true }),
        realpathSync: Object.assign((value) => value, {
          native: () => '\\\\?\\C:\\Users\\runneradmin\\home\\.dsh\\nested'
        })
      };
      assert.throws(() => workspaces.canonicalWorkspace('C:\\Users\\RUNNER~1\\alias-link', {
        platform: 'win32', pathImpl: path.win32, fsImpl: wsFsImpl, forbiddenRoots: roots
      }), assertCode('ERR_WORKSPACE_PROTECTED'));

      assert.equal(config.normalizeRealPath('\\\\?\\UNC\\server\\share\\x',
        { platform: 'win32', pathImpl: path.win32 }), '\\\\server\\share\\x');
      assert.equal(config.normalizeRealPath('/tmp/./x',
        { platform: 'linux', pathImpl: path.posix }), '/tmp/x');
    });

    await test('canonical workspace 拒绝 fake home/.dsh 本身、后代与 realpath 落入链接', async () => {
      const fakeHome = path.join(tmp, 'fake-home-protected');
      const protectedRoot = path.join(fakeHome, '.dsh');
      const protectedChild = path.join(protectedRoot, 'nested-workspace');
      const protectedLink = path.join(tmp, 'link-into-fake-dsh');
      const normal = path.join(fakeHome, 'normal-workspace');
      const forbiddenRoots = config.protectedWorkspaceRoots({ homeDir: fakeHome });
      fs.mkdirSync(fakeHome);
      // 字面后代应在任何 stat/realpath 前拒绝，因此路径无需存在。
      assert.throws(() => workspaces.canonicalWorkspace(
        path.join(protectedRoot, 'never-created'), { forbiddenRoots }
      ), assertCode('ERR_WORKSPACE_PROTECTED'));
      assert.throws(() => workspaces.ensureDefaultWorkspace(
        path.join(protectedRoot, 'Documents'), { forbiddenRoots }
      ), assertCode('ERR_WORKSPACE_PROTECTED'));
      assert.equal(fs.existsSync(protectedRoot), false);
      fs.mkdirSync(protectedChild, { recursive: true });
      fs.mkdirSync(normal);
      fs.symlinkSync(protectedChild, protectedLink, process.platform === 'win32' ? 'junction' : 'dir');
      const activeForbiddenRoots = config.protectedWorkspaceRoots({ homeDir: fakeHome });
      const protectedDocuments = path.join(protectedRoot, 'Documents');
      const protectedDocumentsLink = path.join(tmp, 'documents-link-into-fake-dsh');
      fs.mkdirSync(protectedDocuments);
      fs.symlinkSync(protectedDocuments, protectedDocumentsLink,
        process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => workspaces.ensureDefaultWorkspace(protectedDocumentsLink, {
        forbiddenRoots: activeForbiddenRoots
      }), assertCode('ERR_WORKSPACE_PROTECTED'));
      assert.equal(fs.existsSync(path.join(protectedDocuments, '鲸坞工作台')), false);
      for (const candidate of [protectedRoot, protectedChild, protectedLink]) {
        assert.throws(() => workspaces.canonicalWorkspace(candidate, {
          forbiddenRoots: activeForbiddenRoots
        }),
          assertCode('ERR_WORKSPACE_PROTECTED'));
      }
      assert.equal(workspaces.canonicalWorkspace(normal, {
        forbiddenRoots: activeForbiddenRoots
      }).path,
        osRealPath(normal));
      assert.equal(config.isProtectedWorkspacePath(protectedChild, { homeDir: fakeHome }), true);
      assert.equal(config.isProtectedWorkspacePath(normal, { homeDir: fakeHome }), false);
      assert.throws(() => coordinatorFixture({
        workdir: protectedChild,
        recentWorkdirs: [protectedChild],
        canonicalize: (value) => workspaces.canonicalWorkspace(value, {
          forbiddenRoots: activeForbiddenRoots
        })
      }), assertCode('ERR_WORKSPACE_PROTECTED'));

      const symlinkHome = path.join(tmp, 'fake-home-protected-link');
      const symlinkTarget = path.join(tmp, 'fake-dsh-real-target');
      fs.mkdirSync(symlinkHome);
      fs.mkdirSync(symlinkTarget);
      fs.symlinkSync(symlinkTarget, path.join(symlinkHome, '.dsh'),
        process.platform === 'win32' ? 'junction' : 'dir');
      const symlinkForbiddenRoots = config.protectedWorkspaceRoots({ homeDir: symlinkHome });
      assert(symlinkForbiddenRoots.includes(osRealPath(symlinkTarget)));
      assert(!/(?:readFile|readdir)/.test(config.protectedWorkspaceRoots.toString()));
      assert.throws(() => workspaces.canonicalWorkspace(symlinkTarget, {
        forbiddenRoots: symlinkForbiddenRoots
      }), assertCode('ERR_WORKSPACE_PROTECTED'));
    });

    await test('recent 目标置顶、带回旧 current、去重并限制 10 项', async () => {
      const values = workspaces.updateRecentWorkdirs({
        previous: ['/B', '/C', '/D', '/E', '/F', '/G', '/H', '/I', '/J', '/K', '/L'],
        current: '/A',
        target: '/B',
        platform: 'darwin',
        limit: 10
      });
      assert.deepEqual(values, ['/B', '/A', '/C', '/D', '/E', '/F', '/G', '/H', '/I', '/J']);
      assert.deepEqual(workspaces.updateRecentWorkdirs({
        previous: ['C:\\WORK', 'C:\\Else'], current: 'c:\\work', target: 'C:\\Target', platform: 'win32'
      }), ['C:\\Target', 'c:\\work', 'C:\\Else']);
      assert.deepEqual(workspaces.updateRecentWorkdirs({
        previous: ['/Case'], current: '/case', target: '/Target', platform: 'darwin'
      }), ['/Target', '/case', '/Case']);
    });

    await test('menu view 不重复 current，同名用父目录消歧，null 保留旧主目录语义', async () => {
      const view = workspaces.workspaceMenuView({
        workdir: '/one/project',
        recentWorkdirs: ['/one/project', '/two/project', '/three/other'],
        homeDir: '/Users/tester',
        platform: 'darwin'
      });
      assert.equal(view.current.label, 'project — one');
      assert.deepEqual(view.recent.map((item) => item.label), ['project — two', 'other']);
      const legacy = workspaces.workspaceMenuView({
        workdir: null,
        recentWorkdirs: ['/Users/tester'],
        homeDir: '/Users/tester',
        platform: 'darwin'
      });
      assert.equal(legacy.current.label, '主目录（旧配置）');
      assert.equal(legacy.current.configuredPath, null);
      assert.equal(legacy.recent.length, 0);
    });

    await test('journal strict schema、0600、原子 phase 更新与 completed tombstone', async () => {
      const filePath = path.join(tmp, 'journal', 'workspace-switch.json');
      const store = workspaces.createWorkspaceJournalStore({ filePath });
      const prepared = store.writePrepared({
        schemaVersion: 1,
        phase: 'prepared',
        startedAt: '2026-08-15T00:00:00.000Z',
        previous: { workdir: null, recentWorkdirs: [] },
        target: { workdir: '/target', recentWorkdirs: ['/target'] },
        previousRuntime: { wasReady: true, wasManaged: true }
      });
      assert.equal(store.read().phase, 'prepared');
      if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
      store.writeConfigApplied(prepared);
      assert.equal(store.read().phase, 'config-applied');
      const finalized = store.finalize();
      assert.equal(finalized.completed, true);
      assert.equal(store.read(), null);
      assert.equal(fs.existsSync(`${filePath}.completed`), false);
      assert.equal(fs.readdirSync(path.dirname(filePath)).some((name) => name.includes('.tmp-')), false);

      writeJson(filePath, { schemaVersion: 99 });
      assert.throws(() => store.read(), assertCode('ERR_WORKSPACE_JOURNAL_INVALID'));
    });

    await test('completed tombstone 清理失败时 active 仍已原子移出恢复路径', async () => {
      const filePath = path.join(tmp, 'journal-cleanup-failure', 'workspace-switch.json');
      const completedPath = `${filePath}.completed`;
      const fsProxy = new Proxy(fs, {
        get(target, property) {
          if (property === 'unlinkSync') {
            return (value) => {
              if (value === completedPath) {
                const error = new Error('simulated cleanup denial');
                error.code = 'EACCES';
                throw error;
              }
              return target.unlinkSync(value);
            };
          }
          return target[property];
        }
      });
      const store = workspaces.createWorkspaceJournalStore({ filePath, fsImpl: fsProxy });
      store.writePrepared({
        schemaVersion: 1,
        phase: 'prepared',
        startedAt: '2026-08-15T00:00:00.000Z',
        previous: { workdir: null, recentWorkdirs: [] },
        target: { workdir: '/target', recentWorkdirs: ['/target'] },
        previousRuntime: { wasReady: false, wasManaged: false }
      });
      const result = store.finalize();
      assert.equal(result.cleanupPending, true);
      assert.equal(fs.existsSync(filePath), false);
      assert.equal(fs.existsSync(completedPath), true);
      assert.equal(store.read(), null);
      fs.unlinkSync(completedPath);
    });

    await test('runtime ownership 只有精确 managed/external 组合，矛盾状态为 unknown', async () => {
      const owned = { exited: false };
      assert.equal(workspaces.classifyBackendRuntime({ backendReady: true, spawnedByUs: true, state: owned }).kind, 'managed');
      assert.equal(workspaces.classifyBackendRuntime({ backendReady: true, spawnedByUs: false, state: null }).kind, 'external');
      assert.equal(workspaces.classifyBackendRuntime({ backendReady: false, spawnedByUs: false, state: null }).kind, 'stopped');
      assert.equal(workspaces.classifyBackendRuntime({ backendReady: true, spawnedByUs: false, state: owned }).kind, 'unknown');
      assert.equal(workspaces.classifyBackendRuntime({ backendReady: false, spawnedByUs: true, state: owned }).kind, 'unknown');
    });

    await test('same effective workspace 先于 budget/external gate 返回 no-op，旧 null 不被改写', async () => {
      const fixture = coordinatorFixture({
        workdir: null,
        paused: true,
        runtime: { backendReady: true, spawnedByUs: false, state: null },
        canonicalize: (value) => ({ path: path.posix.resolve(value), key: path.posix.resolve(value) })
      });
      const result = await fixture.coordinator.switchTo('/Users/tester');
      assert.equal(result.status, 'noop');
      assert.equal(fixture.getConfig().workdir, null);
      assert.deepEqual(fixture.calls, []);
    });

    await test('budget/external/unknown 全部在 journal 前 fail-closed', async () => {
      for (const [name, options, code] of [
        ['budget', { paused: true }, 'ERR_WORKSPACE_BUDGET_PAUSED'],
        ['external', { runtime: { backendReady: true, spawnedByUs: false, state: null } }, 'ERR_WORKSPACE_EXTERNAL_ATTACH'],
        ['unknown', { runtime: { backendReady: true, spawnedByUs: false, state: { exited: false } } }, 'ERR_WORKSPACE_RUNTIME_UNKNOWN']
      ]) {
        const fixture = coordinatorFixture(options);
        await assert.rejects(fixture.coordinator.switchTo('/workspace/B'), assertCode(code), name);
        assert.deepEqual(fixture.calls, [], name);
        assert.equal(fixture.getConfig().workdir, '/workspace/A');
      }
    });

    await test('事件 quiesce 期间 budget latch 翻转会二次 fail-closed', async () => {
      const fixture = coordinatorFixture();
      const original = fixture.coordinator;
      // 用同一套 deps 重建，让 quiesce 原子翻转持久 latch。
      const calls = [];
      let paused = false;
      let state = { workdir: '/workspace/A', recentWorkdirs: ['/workspace/A'] };
      const coordinator = workspaces.createWorkspaceSwitchCoordinator({
        platform: 'darwin', homeDir: '/Users/tester',
        canonicalize: (value) => ({ path: value, key: value }),
        getConfig: () => ({ ...state, recentWorkdirs: [...state.recentWorkdirs] }),
        setWorkspaceConfig: async (patch) => { calls.push('config'); state = { ...state, ...patch }; },
        getRuntime: () => ({ backendReady: true, spawnedByUs: true, state: { exited: false } }),
        isBudgetPaused: () => paused,
        journal: fakeJournal(calls),
        invalidateCaptures: async () => { calls.push('invalidate'); },
        quiesceEvents: async () => { calls.push('quiesce'); paused = true; },
        stopManaged: async () => { calls.push('stop'); },
        startAndConfirm: async () => { calls.push('start'); return { state: { exited: false } }; }
      });
      await assert.rejects(coordinator.switchTo('/workspace/B'), assertCode('ERR_WORKSPACE_BUDGET_PAUSED'));
      assert.deepEqual(calls, ['journal-prepared', 'invalidate', 'quiesce', 'journal-remove']);
      assert.equal(state.workdir, '/workspace/A');
      assert(original);
    });

    await test('managed 成功顺序严格，commit 前 generation/snapshot 不变', async () => {
      const fixture = coordinatorFixture();
      const before = fixture.coordinator.snapshot();
      const result = await fixture.coordinator.switchTo('/workspace/B');
      assert.equal(result.status, 'committed');
      assert.deepEqual(fixture.calls, [
        'journal-prepared', 'invalidate-captures', 'quiesce-events', 'stop:old',
        'config:/workspace/B', 'journal-config-applied', 'start-target:/workspace/B',
        'journal-finalize', 'commit-surface'
      ]);
      assert.equal(before.workdir, '/workspace/A');
      assert.equal(fixture.coordinator.snapshot().workdir, '/workspace/B');
      assert.equal(fixture.coordinator.snapshot().generation, before.generation + 1);
      assert.deepEqual(fixture.getConfig().recentWorkdirs.slice(0, 2), ['/workspace/B', '/workspace/A']);
    });

    await test('old backend stop 未确认退出时 config 零写入', async () => {
      const fixture = coordinatorFixture({
        stopManaged: async (state) => { fixture.calls.push(`stop-unconfirmed:${state.name}`); }
      });
      await assert.rejects(fixture.coordinator.switchTo('/workspace/B'), assertCode('ERR_WORKSPACE_STOP'));
      assert.equal(fixture.getConfig().workdir, '/workspace/A');
      assert(!fixture.calls.some((value) => value.startsWith('config:')));
      assert.equal(fixture.journal.current(), null);
    });

    await test('target 必须回读 effectiveWorkdir，否则回滚', async () => {
      const fixture = coordinatorFixture({
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `start-rollback:${workdir}` : `start-target:${workdir}`);
          return rollback
            ? { state: { name: 'restored', exited: false }, effectiveWorkdir: workdir }
            : { state: { name: 'unproven-target', exited: false } };
        }
      });
      await assert.rejects(fixture.coordinator.switchTo('/workspace/B'), assertCode('ERR_WORKSPACE_TARGET_CWD'));
      assert.equal(fixture.getConfig().workdir, '/workspace/A');
      assert(fixture.calls.includes('stop:unproven-target'));
    });

    await test('target start 失败会恢复 previous config/backend 并删除 active journal', async () => {
      let targetAttempts = 0;
      const fixture = coordinatorFixture({
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `start-rollback:${workdir}` : `start-target:${workdir}`);
          if (!rollback && targetAttempts++ === 0) throw Object.assign(new Error('target failed'), { code: 'TARGET_FAILED' });
          return { state: { name: 'restored', exited: false }, effectiveWorkdir: workdir };
        }
      });
      await assert.rejects(fixture.coordinator.switchTo('/workspace/B'), (error) => error && error.code === 'TARGET_FAILED');
      assert.equal(fixture.getConfig().workdir, '/workspace/A');
      assert.deepEqual(fixture.calls, [
        'journal-prepared', 'invalidate-captures', 'quiesce-events', 'stop:old',
        'config:/workspace/B', 'journal-config-applied', 'start-target:/workspace/B',
        'config:/workspace/A', 'start-rollback:/workspace/A', 'journal-remove', 'rollback-surface'
      ]);
      assert.equal(fixture.journal.current(), null);
    });

    await test('target config 原子写失败时只恢复旧 backend，不启 target', async () => {
      const calls = [];
      const journal = fakeJournal(calls);
      const backendState = { name: 'old', exited: false };
      const current = { workdir: '/workspace/A', recentWorkdirs: ['/workspace/A'] };
      const coordinator = workspaces.createWorkspaceSwitchCoordinator({
        platform: 'darwin', homeDir: '/Users/tester',
        canonicalize: (value) => ({ path: value, key: value }),
        getConfig: () => ({ ...current, recentWorkdirs: [...current.recentWorkdirs] }),
        setWorkspaceConfig: async () => {
          calls.push('config-target-failed');
          throw Object.assign(new Error('disk full'), { code: 'TARGET_CONFIG_FAILED' });
        },
        getRuntime: () => ({ backendReady: true, spawnedByUs: true, state: backendState }),
        isBudgetPaused: () => false,
        journal,
        quiesceEvents: async () => { calls.push('quiesce'); },
        stopManaged: async (state) => { calls.push(`stop:${state.name}`); state.exited = true; },
        startAndConfirm: async ({ workdir, rollback }) => {
          calls.push(rollback ? 'start-rollback' : 'ILLEGAL-START-TARGET');
          return { state: { name: 'restored', exited: false }, effectiveWorkdir: workdir };
        }
      });
      await assert.rejects(coordinator.switchTo('/workspace/B'), assertCode('TARGET_CONFIG_FAILED'));
      assert.equal(current.workdir, '/workspace/A');
      assert(calls.includes('start-rollback'));
      assert(!calls.includes('ILLEGAL-START-TARGET'));
      assert.equal(journal.current(), null);
    });

    await test('journal finalize 失败不冒充 commit，目标 backend/config 均回滚', async () => {
      const calls = [];
      const journal = fakeJournal(calls);
      journal.finalize = () => {
        calls.push('journal-finalize-failed');
        throw Object.assign(new Error('rename denied'), { code: 'ERR_WORKSPACE_JOURNAL_FINALIZE' });
      };
      const fixture = coordinatorFixture({ journal });
      await assert.rejects(
        fixture.coordinator.switchTo('/workspace/B'),
        assertCode('ERR_WORKSPACE_JOURNAL_FINALIZE')
      );
      assert.equal(fixture.getConfig().workdir, '/workspace/A');
      assert.equal(fixture.coordinator.snapshot().workdir, '/workspace/A');
      assert(calls.includes('journal-finalize-failed'));
      assert.equal(journal.current(), null);
    });

    await test('finalize 失败且 target stop 未确认退出时 fail-closed 并交还 state', async () => {
      const journalCalls = [];
      const journal = fakeJournal(journalCalls);
      const targetState = { name: 'target-unresolved', exited: false };
      journal.finalize = () => {
        journalCalls.push('journal-finalize-failed');
        throw Object.assign(new Error('rename denied'), { code: 'ERR_WORKSPACE_JOURNAL_FINALIZE' });
      };
      const fixture = coordinatorFixture({
        journal,
        stopManaged: async (state) => {
          fixture.calls.push(`stop-unresolved:${state.name}`);
          if (state.name === 'old') state.exited = true;
        },
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `ILLEGAL-START-OLD:${workdir}` : `start-target:${workdir}`);
          return rollback
            ? { state: { name: 'illegal-old', exited: false }, effectiveWorkdir: workdir }
            : { state: targetState, effectiveWorkdir: workdir };
        }
      });
      let failure;
      await assert.rejects(fixture.coordinator.switchTo('/workspace/B'), (error) => {
        failure = error;
        return assertCode('ERR_WORKSPACE_ROLLBACK_TARGET_STOP')(error);
      });
      assert.strictEqual(failure.state, targetState);
      assert.strictEqual(failure.targetState, targetState);
      assert.equal(targetState.exited, false);
      assert.equal(fixture.getConfig().workdir, '/workspace/B');
      assert.equal(fixture.coordinator.snapshot().workdir, '/workspace/A');
      assert.equal(journal.current().phase, 'config-applied');
      assert(!fixture.calls.includes('config:/workspace/A'));
      assert(!fixture.calls.some((value) => value.startsWith('ILLEGAL-START-OLD:')));
      assert(!fixture.calls.includes('rollback-surface'));
      assert(!journalCalls.includes('journal-remove'));
    });

    await test('finalize 失败且 target stop 抛错仍未退出时保留 target config/journal', async () => {
      const journalCalls = [];
      const journal = fakeJournal(journalCalls);
      const targetState = { name: 'target-stop-throws', exited: false };
      const stopFailure = Object.assign(new Error('stop transport failed'), { code: 'TARGET_STOP_FAILED' });
      journal.finalize = () => {
        journalCalls.push('journal-finalize-failed');
        throw Object.assign(new Error('rename denied'), { code: 'ERR_WORKSPACE_JOURNAL_FINALIZE' });
      };
      const fixture = coordinatorFixture({
        journal,
        stopManaged: async (state) => {
          fixture.calls.push(`stop-throws:${state.name}`);
          if (state.name === 'old') {
            state.exited = true;
            return;
          }
          throw stopFailure;
        },
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `ILLEGAL-START-OLD:${workdir}` : `start-target:${workdir}`);
          return rollback
            ? { state: { name: 'illegal-old', exited: false }, effectiveWorkdir: workdir }
            : { state: targetState, effectiveWorkdir: workdir };
        }
      });
      let failure;
      await assert.rejects(fixture.coordinator.switchTo('/workspace/B'), (error) => {
        failure = error;
        return assertCode('ERR_WORKSPACE_ROLLBACK_TARGET_STOP')(error);
      });
      assert.strictEqual(failure.cause, stopFailure);
      assert.strictEqual(failure.state, targetState);
      assert.strictEqual(failure.targetState, targetState);
      assert.equal(fixture.getConfig().workdir, '/workspace/B');
      assert.equal(journal.current().phase, 'config-applied');
      assert(!fixture.calls.includes('config:/workspace/A'));
      assert(!fixture.calls.some((value) => value.startsWith('ILLEGAL-START-OLD:')));
      assert(!fixture.calls.includes('rollback-surface'));
      assert(!journalCalls.includes('journal-remove'));
    });

    await test('target stop 虽抛错但 exited 已确认时继续恢复 previous', async () => {
      const journalCalls = [];
      const journal = fakeJournal(journalCalls);
      const targetState = { name: 'target-exited', exited: false };
      journal.finalize = () => {
        journalCalls.push('journal-finalize-failed');
        throw Object.assign(new Error('rename denied'), { code: 'ERR_WORKSPACE_JOURNAL_FINALIZE' });
      };
      const fixture = coordinatorFixture({
        journal,
        stopManaged: async (state) => {
          fixture.calls.push(`stop-after-exit:${state.name}`);
          state.exited = true;
          if (state === targetState) throw new Error('late stop error');
        },
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `start-rollback:${workdir}` : `start-target:${workdir}`);
          return rollback
            ? { state: { name: 'restored', exited: false }, effectiveWorkdir: workdir }
            : { state: targetState, effectiveWorkdir: workdir };
        }
      });
      await assert.rejects(
        fixture.coordinator.switchTo('/workspace/B'),
        assertCode('ERR_WORKSPACE_JOURNAL_FINALIZE')
      );
      assert.equal(targetState.exited, true);
      assert.equal(fixture.getConfig().workdir, '/workspace/A');
      assert.equal(fixture.coordinator.snapshot().workdir, '/workspace/A');
      assert(fixture.calls.includes('config:/workspace/A'));
      assert(fixture.calls.includes('start-rollback:/workspace/A'));
      assert(fixture.calls.includes('rollback-surface'));
      assert(journalCalls.includes('journal-remove'));
      assert.equal(journal.current(), null);
    });

    await test('previous backend 回滚启动失败时 config 已恢复但 journal 保留', async () => {
      const fixture = coordinatorFixture({
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `start-rollback:${workdir}` : `start-target:${workdir}`);
          if (rollback) throw new Error('previous failed');
          throw Object.assign(new Error('target failed'), { code: 'TARGET_FAILED' });
        }
      });
      await assert.rejects(
        fixture.coordinator.switchTo('/workspace/B'),
        assertCode('ERR_WORKSPACE_ROLLBACK_BACKEND')
      );
      assert.equal(fixture.getConfig().workdir, '/workspace/A');
      assert(fixture.journal.current());
      assert(!fixture.calls.includes('journal-remove'));
    });

    await test('rollback config 失败保留 journal 且不启 previous backend', async () => {
      const calls = [];
      let writes = 0;
      let state = { workdir: '/workspace/A', recentWorkdirs: ['/workspace/A'] };
      const backendState = { name: 'old', exited: false };
      const journal = fakeJournal(calls);
      const coordinator = workspaces.createWorkspaceSwitchCoordinator({
        platform: 'darwin', homeDir: '/Users/tester',
        canonicalize: (value) => ({ path: value, key: value }),
        getConfig: () => ({ ...state, recentWorkdirs: [...state.recentWorkdirs] }),
        setWorkspaceConfig: async (patch) => {
          calls.push(`config:${patch.workdir}`);
          writes += 1;
          if (writes === 2) throw new Error('rollback disk full');
          state = { ...state, ...patch };
        },
        getRuntime: () => ({ backendReady: true, spawnedByUs: true, state: backendState }),
        isBudgetPaused: () => false,
        journal,
        quiesceEvents: async () => { calls.push('quiesce'); },
        stopManaged: async (backendState) => {
          calls.push(`stop:${backendState.name}`);
          backendState.exited = true;
        },
        startAndConfirm: async ({ rollback }) => {
          if (rollback) calls.push('ILLEGAL-ROLLBACK-START');
          throw Object.assign(new Error('target failed'), { code: 'TARGET_FAILED' });
        }
      });
      await assert.rejects(coordinator.switchTo('/workspace/B'), assertCode('ERR_WORKSPACE_ROLLBACK_CONFIG'));
      assert(journal.current());
      assert(!calls.includes('ILLEGAL-ROLLBACK-START'));
      assert(!calls.includes('journal-remove'));
    });

    await test('prepared/config-applied 启动恢复均以 previous 为准', async () => {
      for (const phase of ['prepared', 'config-applied']) {
        const calls = [];
        const record = {
          schemaVersion: 1,
          phase,
          startedAt: '2026-08-15T00:00:00.000Z',
          previous: { workdir: '/workspace/A', recentWorkdirs: ['/workspace/A'] },
          target: { workdir: '/workspace/B', recentWorkdirs: ['/workspace/B', '/workspace/A'] },
          previousRuntime: { wasReady: true, wasManaged: true }
        };
        const fixture = coordinatorFixture({
          workdir: phase === 'prepared' ? '/workspace/A' : '/workspace/B',
          recentWorkdirs: phase === 'prepared' ? ['/workspace/A'] : ['/workspace/B', '/workspace/A'],
          journal: fakeJournal(calls, record)
        });
        // fixture 的 calls 由外部 journal 闭包持有，不影响结果断言。
        const result = await fixture.coordinator.recoverAtStartup();
        assert.equal(result.status, 'rolled-back');
        assert.equal(fixture.getConfig().workdir, '/workspace/A');
      }
    });

    await test('恢复时端口占用只保留 journal 并拒绝 start/stop/attach', async () => {
      const calls = [];
      const record = {
        schemaVersion: 1, phase: 'config-applied', startedAt: '2026-08-15T00:00:00.000Z',
        previous: { workdir: '/workspace/A', recentWorkdirs: ['/workspace/A'] },
        target: { workdir: '/workspace/B', recentWorkdirs: ['/workspace/B'] },
        previousRuntime: { wasReady: true, wasManaged: true }
      };
      let state = { workdir: '/workspace/B', recentWorkdirs: ['/workspace/B'] };
      const journal = fakeJournal(calls, record);
      const coordinator = workspaces.createWorkspaceSwitchCoordinator({
        platform: 'darwin', homeDir: '/Users/tester',
        canonicalize: (value) => ({ path: value, key: value }),
        getConfig: () => ({ ...state, recentWorkdirs: [...state.recentWorkdirs] }),
        setWorkspaceConfig: async (patch) => { calls.push(`config:${patch.workdir}`); state = { ...state, ...patch }; },
        getRuntime: () => ({ backendReady: false, spawnedByUs: false, state: null }),
        isBudgetPaused: () => false,
        journal,
        recoveryPortClear: async () => false,
        stopManaged: async () => { calls.push('ILLEGAL-STOP'); },
        startAndConfirm: async () => { calls.push('ILLEGAL-START'); }
      });
      await assert.rejects(coordinator.recoverAtStartup(), assertCode('ERR_WORKSPACE_RECOVERY_PORT_OCCUPIED'));
      assert.equal(state.workdir, '/workspace/A');
      assert(journal.current());
      assert(!calls.includes('ILLEGAL-STOP'));
      assert(!calls.includes('ILLEGAL-START'));
    });

    await test('恢复时 config 既非 previous 也非 target 则不覆盖用户手改', async () => {
      const calls = [];
      const record = {
        schemaVersion: 1, phase: 'prepared', startedAt: '2026-08-15T00:00:00.000Z',
        previous: { workdir: '/workspace/A', recentWorkdirs: ['/workspace/A'] },
        target: { workdir: '/workspace/B', recentWorkdirs: ['/workspace/B'] },
        previousRuntime: { wasReady: false, wasManaged: false }
      };
      const fixture = coordinatorFixture({
        workdir: '/workspace/C', recentWorkdirs: ['/workspace/C'], journal: fakeJournal(calls, record)
      });
      await assert.rejects(fixture.coordinator.recoverAtStartup(), assertCode('ERR_WORKSPACE_RECOVERY_CONFIG_DRIFT'));
      assert.equal(fixture.getConfig().workdir, '/workspace/C');
    });

    await test('并发 switch 严格串行，第二次以第一次 commit 为 previous', async () => {
      const gate = deferred();
      let starts = 0;
      const fixture = coordinatorFixture({
        startAndConfirm: async ({ workdir, rollback }) => {
          fixture.calls.push(rollback ? `start-rollback:${workdir}` : `start-target:${workdir}`);
          starts += 1;
          if (starts === 1) await gate.promise;
          return { state: { name: `state-${workdir}`, exited: false }, effectiveWorkdir: workdir };
        }
      });
      const first = fixture.coordinator.switchTo('/workspace/B');
      const second = fixture.coordinator.switchTo('/workspace/C');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fixture.calls.filter((value) => value.startsWith('start-target')).length, 1);
      gate.resolve();
      await Promise.all([first, second]);
      assert.equal(fixture.getConfig().workdir, '/workspace/C');
      assert.deepEqual(fixture.getConfig().recentWorkdirs.slice(0, 3), [
        '/workspace/C', '/workspace/B', '/workspace/A'
      ]);
    });

    await test('切换前复核与事务共用串行边界，并发请求不反转顺序', async () => {
      const gate = deferred();
      let preflights = 0;
      const fixture = coordinatorFixture({
        beforeSwitch: async (target) => {
          preflights += 1;
          fixture.calls.push(`preflight:${target}`);
          if (preflights === 1) await gate.promise;
        }
      });
      const first = fixture.coordinator.switchTo('/workspace/B');
      const second = fixture.coordinator.switchTo('/workspace/C');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fixture.coordinator.busy, true);
      assert.deepEqual(fixture.calls, ['preflight:/workspace/B']);
      gate.resolve();
      await Promise.all([first, second]);
      const firstCommit = fixture.calls.indexOf('commit-surface');
      const secondPreflight = fixture.calls.indexOf('preflight:/workspace/C');
      assert(firstCommit >= 0 && secondPreflight > firstCommit,
        '第二个 preflight 必须等第一笔 commit 后才进入');
      assert.equal(fixture.getConfig().workdir, '/workspace/C');
    });

    await test('noop 与非法目标在有副作用的切换前复核之前收口', async () => {
      let preflights = 0;
      const fixture = coordinatorFixture({
        beforeSwitch: async () => { preflights += 1; },
        canonicalize: (value) => {
          if (value === '/workspace/forbidden') {
            const error = new Error('受保护目标');
            error.code = 'ERR_WORKSPACE_PROTECTED';
            throw error;
          }
          const resolved = path.posix.resolve(value);
          return { path: resolved, key: resolved };
        }
      });
      const noop = await fixture.coordinator.switchTo('/workspace/A');
      assert.equal(noop.status, 'noop');
      assert.equal(preflights, 0, 'noop 不得退休当前 attach');
      await assert.rejects(
        fixture.coordinator.switchTo('/workspace/forbidden'),
        assertCode('ERR_WORKSPACE_PROTECTED')
      );
      assert.equal(preflights, 0, '非法目标不得先破坏当前 attach');
    });

    console.log(`\nWORKSPACES ALL PASS (${passed})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('WORKSPACES FAIL:', error && error.stack || error);
  process.exit(1);
});
