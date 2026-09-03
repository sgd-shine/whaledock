'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createContextFileRpcBroker } = require('../lib/context-file-rpc');
const layout = require('../lib/project-layout');

const PROJECT_NAMES = [
  'projects.list', 'projects.create', 'projects.update', 'projects.remove',
  'projects.bind', 'projects.reorder', 'projects.open', 'projects.adopt',
  'projects.sidecar', 'projects.detach', 'console.read'
];
const CONSOLE_ID = `proj_${'0'.repeat(31)}1`;
const PROJECT_A = `proj_${'a'.repeat(32)}`;
const PROJECT_B = `proj_${'b'.repeat(32)}`;
const BINDING_A = `session-binding-${'a'.repeat(64)}`;
const BINDING_B = `session-binding-${'b'.repeat(64)}`;
const ROOT_REF_A = `session-root-${'a'.repeat(64)}`;
const ROOT_REF_B = `session-root-${'b'.repeat(64)}`;
const SAFE_SKIN = Object.freeze({
  base: 'dark',
  colors: Object.freeze({
    background: '#07111b',
    surface: '#0b1926',
    border: '#1f3a4a',
    primary: '#e9f4fb',
    accent: '#35b6d4',
    text: '#e9f4fb',
    textMuted: '#9cb3c3'
  })
});

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  project-ops: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-ops: ${name}`);
    throw error;
  }
}

function operationError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function project(overrides = {}) {
  return {
    id: PROJECT_A,
    kind: 'user',
    name: '旅行 Atlas',
    icon: '🌍',
    folder: '/private/secret/旅行 Atlas',
    folderTail: '旅行 Atlas',
    hasFolder: true,
    boundSession: BINDING_A,
    templateId: 'builtin:short-video',
    layoutPreset: 'split-two',
    paneState: layout.createPaneState('split-two'),
    order: 1,
    hidden: false,
    pinned: false,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    lastOpenedAt: null,
    openCount: 0,
    ...overrides
  };
}

function ordinaryPaneState() {
  const state = JSON.parse(JSON.stringify(layout.createPaneState('split-two')));
  state.windows[0].tabs = [{
    id: 'draft', type: 'text', title: '草稿', path: 'drafts/current.txt'
  }];
  state.windows[0].active = 'draft';
  return state;
}

function largePaneState(urlPadding = 500) {
  const state = JSON.parse(JSON.stringify(
    layout.ensureTargetWindow(layout.createPaneState('split-two'), 16)
  ));
  for (const window of state.windows) {
    const id = `draft-${window.window}`;
    window.tabs = [{
      id,
      type: 'browser',
      title: '长标题'.repeat(30),
      url: `https://example.com/${'x'.repeat(urlPadding)}-${window.window}`
    }];
    window.active = id;
  }
  return layout.validatePaneState(state);
}

function createStore() {
  let revision = 7;
  let records = [
    project({
      id: CONSOLE_ID, kind: 'builtin', name: '控制室', icon: '🖥️', folder: null,
      folderTail: null, hasFolder: false, boundSession: null, order: 0, pinned: true
    }),
    project(),
    project({
      id: PROJECT_B, name: '隐藏项目', icon: '🧱', boundSession: BINDING_B,
      folder: '/missing', folderTail: 'missing', order: 2, hidden: true
    })
  ];
  const calls = {
    create: [], adopt: [], update: [], remove: [], sidecar: [],
    bind: [], reorder: [], touch: []
  };
  const find = (id) => records.find((entry) => entry.id === id) || null;
  const store = {
    get revision() { return revision; },
    list(options = {}) {
      const includeHidden = options.includeHidden !== false;
      return records.filter((entry) => includeHidden || !entry.hidden).map((entry) => ({ ...entry }));
    },
    get(id) {
      const hit = find(id);
      return hit ? { ...hit } : null;
    },
    create(input) {
      calls.create.push(input);
      if (input.folder === '/protected') throw operationError('ERR_PROJECT_PROTECTED');
      if (input.folder === '/duplicate') throw operationError('ERR_PROJECT_DUPLICATE_FOLDER');
      const next = project({
        id: `proj_${'c'.repeat(32)}`,
        name: input.name === undefined ? '新项目' : input.name,
        icon: input.icon === undefined ? '🧱' : input.icon,
        templateId: input.templateId === undefined ? null : input.templateId,
        folder: input.folder,
        folderTail: path.basename(input.folder),
        boundSession: null
      });
      records.push(next);
      revision += 1;
      return { ...next };
    },
    adoptFolder(folder) {
      calls.adopt.push(folder);
      return { adopted: 'existing', project: { ...find(PROJECT_A) } };
    },
    update(id, changes) {
      calls.update.push({ id, changes });
      const hit = find(id);
      if (!hit) throw operationError('ERR_PROJECT_NOT_FOUND');
      Object.assign(hit, changes);
      revision += 1;
      return { ...hit };
    },
    remove(id) {
      calls.remove.push(id);
      const hit = find(id);
      if (!hit) throw operationError('ERR_PROJECT_NOT_FOUND');
      if (hit.kind === 'builtin') throw operationError('ERR_PROJECT_BUILTIN');
      records = records.filter((entry) => entry.id !== id);
      revision += 1;
      return true;
    },
    writeManifest(id) {
      calls.sidecar.push(id);
      if (!find(id)) throw operationError('ERR_PROJECT_NOT_FOUND');
      return true;
    },
    bindSession(id, bindingRef) {
      calls.bind.push({ id, bindingRef });
      const hit = find(id);
      if (!hit) throw operationError('ERR_PROJECT_NOT_FOUND');
      hit.boundSession = bindingRef;
      revision += 1;
      return { ...hit };
    },
    reorder(ids) {
      calls.reorder.push(ids);
      revision += 1;
      return records.slice().sort((left, right) => {
        const li = ids.indexOf(left.id);
        const ri = ids.indexOf(right.id);
        if (li >= 0 || ri >= 0) return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri);
        return left.order - right.order;
      }).map((entry) => ({ ...entry }));
    },
    folderExists(id) {
      const hit = find(id);
      if (!hit) throw operationError('ERR_PROJECT_NOT_FOUND');
      return hit.folder !== null && hit.folder !== '/missing';
    },
    touchOpened(id) {
      calls.touch.push(id);
      const hit = find(id);
      if (!hit) throw operationError('ERR_PROJECT_NOT_FOUND');
      hit.openCount += 1;
      hit.lastOpenedAt = '2026-09-02T00:01:00.000Z';
      revision += 1;
      return { ...hit };
    }
  };
  return { store, calls };
}

function createClock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms) { value += ms; }
  };
}

function createRandom() {
  let counter = 0;
  return (size) => {
    counter += 1;
    return Buffer.alloc(size, counter);
  };
}

function requestBinding(overrides = {}) {
  return {
    hostInstanceId: 'host-instance-0001',
    controllerId: 'controller-instance-0001',
    pageInstanceId: 'page-instance-0001',
    selectionRevision: 3,
    ...overrides
  };
}

function currentContext(sequence, overrides = {}) {
  let index = 0;
  return {
    currentBindingRef: BINDING_A,
    sessionRootRef: ROOT_REF_A,
    projectRootRef: ROOT_REF_A,
    authorizeProjectRoot: async () => true,
    ...overrides,
    assertCurrent() {
      if (!sequence) return true;
      const value = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return value;
    }
  };
}

function createRoom() {
  const logs = {
    sanitized: [], builds: [], outputs: [], acks: [], status: 'need',
    recent: Object.freeze({ role: 'assistant', text: '已生成初稿，请确认。', updatedAt: 999_000 })
  };
  let buildNumber = 0;
  const room = {
    sanitizeSnapshot(raw) {
      logs.sanitized.push(raw);
      return Object.freeze({
        byId: Object.freeze({ [BINDING_A]: Object.freeze({ pending: true }) }),
        subagentsByParent: Object.freeze({}),
        jobsBySession: Object.freeze({}),
        current: BINDING_A
      });
    },
    buildCards(input) {
      logs.builds.push(input);
      buildNumber += 1;
      const status = logs.status;
      const output = {
        cards: [{
          projectId: PROJECT_A,
          name: '旅行 Atlas',
          icon: '🌍',
          pinned: false,
          hidden: false,
          boundSession: BINDING_A,
          status,
          statusLabel: status === 'done' ? '已完成' : (status === 'busy' ? '进行中' : '待你决定'),
          glow: status === 'need',
          runtimeMs: 3000,
          kids: 1,
          sessionTitle: '需要确认',
          recent: logs.recent,
          cwd: '/private/secret/cwd',
          folder: '/private/secret/folder'
        }],
        counts: {
          need: status === 'need' ? 1 : 0,
          done: status === 'done' ? 1 : 0,
          busy: status === 'busy' ? 1 : 0,
          idle: status === 'idle' ? 1 : 0,
          total: 1,
          glowing: status === 'need' ? 1 : 0
        },
        acks: Object.freeze({ opaqueAckGeneration: buildNumber }),
        seen: Object.freeze({ opaqueSeenGeneration: buildNumber })
      };
      logs.outputs.push(output);
      return output;
    },
    ackSession(acks, snapshot, bindingRef) {
      logs.acks.push({ acks, snapshot, bindingRef });
      return Object.freeze({ acknowledgedOpaque: true });
    }
  };
  return { room, logs };
}

function loadModule() {
  return require('../lib/project-ops');
}

function createFixture(overrides = {}) {
  const { store, calls } = overrides.storeFixture || createStore();
  const { room, logs } = overrides.roomFixture || createRoom();
  const clock = overrides.clock || createClock();
  const needs = [];
  const consoleEvents = [];
  const opened = [];
  const detached = [];
  const module = loadModule();
  const operations = module.createProjectOperations({
    projectStore: store,
    chooseFolder: overrides.chooseFolder || (async () => '/chosen/新项目'),
    controlRoom: room,
    now: clock.now,
    randomBytes: overrides.randomBytes || createRandom(),
    ...(overrides.createProject ? { createProject: overrides.createProject } : {}),
    templateActionsFor: overrides.templateActionsFor || (() => []),
    templateCatalogFor: overrides.templateCatalogFor || (() => []),
    previewForProject: overrides.previewForProject || (() => []),
    skinForTemplate: overrides.skinForTemplate || (() => null),
    readSwitchCommand: overrides.readSwitchCommand || (() => null),
    bootstrapTicketFor: overrides.bootstrapTicketFor || (() => null),
    onProjectOpened: (projectId, seq) => {
      opened.push({ projectId, seq });
      if (typeof overrides.onProjectOpened === 'function') {
        return overrides.onProjectOpened(projectId, seq);
      }
      return undefined;
    },
    ...(overrides.onProjectOpenOutcomeUnknown ? {
      onProjectOpenOutcomeUnknown: overrides.onProjectOpenOutcomeUnknown
    } : {}),
    onDetach: (value) => {
      detached.push(value);
      return typeof overrides.onDetach === 'function' ? overrides.onDetach(value) : undefined;
    },
    onNeedCount: (count) => needs.push(count),
    onConsoleResult: (event) => {
      consoleEvents.push(event);
      if (typeof overrides.onConsoleResult === 'function') return overrides.onConsoleResult(event);
      return undefined;
    }
  });
  return {
    module, operations, store, calls, room, logs, clock, needs, consoleEvents, opened, detached
  };
}

async function invoke(fixture, name, input, options = {}) {
  const descriptor = fixture.operations[name];
  const validated = descriptor.validate(input);
  const raw = await descriptor.handle({
    input: validated,
    binding: options.binding || requestBinding(),
    context: options.context || currentContext()
  });
  return descriptor.redact(raw);
}

async function captureError(run) {
  try { await run(); }
  catch (error) { return error; }
  assert.fail('预期 operation 拒绝');
}

async function invokeThroughBroker(broker, binding, operation, input) {
  const queued = broker.enqueue({ binding, operation, input });
  const row = broker.read({ binding, limit: 4 })
    .find((entry) => entry.requestToken === queued.requestToken);
  assert(row, 'broker 应返回刚入队的 operation');
  const claim = broker.claim({
    binding, requestToken: row.requestToken, requestSeq: row.requestSeq
  });
  assert.equal(claim.claimed, true);
  const outcome = await broker.execute({
    binding,
    requestToken: row.requestToken,
    requestSeq: row.requestSeq,
    claimToken: claim.claimToken,
    context: currentContext()
  });
  assert.equal(outcome.settled, true);
  return broker.snapshot({ binding, requestToken: row.requestToken });
}

async function main() {
  await test('导出精确 11 项与完整 descriptor，模块保持纯 Node 边界', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'project-ops.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:electron|fs)['"]\)/);
    const fixture = createFixture();
    assert.equal(fixture.module.PROJECT_OPERATION_NAMES.size, 11);
    assert.deepEqual(
      [...fixture.module.PROJECT_OPERATION_NAMES].sort(), [...PROJECT_NAMES].sort()
    );
    assert.deepEqual(Object.keys(fixture.operations).sort(), [...PROJECT_NAMES].sort());
    assert(Object.isFrozen(fixture.operations));
    for (const descriptor of Object.values(fixture.operations)) {
      assert(Object.isFrozen(descriptor));
      for (const method of ['validate', 'handle', 'redact', 'errorCode']) {
        assert.equal(typeof descriptor[method], 'function');
      }
      assert(Object.keys(descriptor).every((key) => (
        ['validate', 'handle', 'redact', 'errorCode', 'limits'].includes(key)
      )));
    }
  });

  await test('descriptor 可直接登记到 context-file-rpc，console 使用独立 48 KiB 预算', async () => {
    const fixture = createFixture();
    const broker = createContextFileRpcBroker({
      operations: fixture.operations,
      randomBytes: createRandom()
    });
    const snapshot = await invokeThroughBroker(
      broker,
      requestBinding(),
      'console.read',
      {
        snapshot: {
          byId: { [BINDING_A]: { running: true, displayTitle: 'x'.repeat(12 * 1024) } },
          subagentsByParent: {},
          jobsBySession: {},
          current: BINDING_A
        }
      }
    );
    assert.equal(snapshot.state, 'fulfilled');
    assert.equal(snapshot.result.kind, 'console');
  });

  await test('{} 合法性按 operation 区分，全部输入拒绝未知字段', async () => {
    const { operations } = createFixture();
    assert.doesNotThrow(() => operations['projects.list'].validate({}));
    assert.doesNotThrow(() => operations['projects.create'].validate({}));
    assert.doesNotThrow(() => operations['projects.adopt'].validate({}));
    for (const name of PROJECT_NAMES.filter((entry) => (
      !['projects.list', 'projects.create', 'projects.adopt'].includes(entry)
    ))) {
      assert.throws(() => operations[name].validate({}));
    }
    const valid = {
      'projects.list': {},
      'projects.create': {},
      'projects.update': { projectId: PROJECT_A, changes: { name: '新名称' } },
      'projects.remove': { projectId: PROJECT_A },
      'projects.bind': { projectId: PROJECT_A, bindingRef: BINDING_A },
      'projects.reorder': { ids: [PROJECT_A] },
      'projects.open': { phase: 'prepare', projectId: PROJECT_A },
      'projects.adopt': {},
      'projects.sidecar': { projectId: PROJECT_A },
      'projects.detach': { projectId: PROJECT_A, window: 1, tabId: 'draft' },
      'console.read': { snapshot: { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null } }
    };
    for (const name of PROJECT_NAMES) {
      assert.throws(() => operations[name].validate({ ...valid[name], extra: true }), name);
    }
  });

  await test('projects.list 分页不超过 32，摘要不含 paneState、路径或 bindingRef', async () => {
    const fixture = createFixture();
    assert.throws(() => fixture.operations['projects.list'].validate({ limit: 33 }));
    const result = await invoke(fixture, 'projects.list', {
      cursor: 1, limit: 1, includeHidden: true
    });
    assert.deepEqual(Object.keys(result), [
      'kind', 'revision', 'cursor', 'nextCursor', 'projects', 'switchCommand', 'templateCatalog'
    ]);
    assert.equal(result.kind, 'projects');
    assert.equal(result.cursor, 1);
    assert.equal(result.nextCursor, 2);
    assert.equal(result.projects.length, 1);
    assert.equal(result.switchCommand, null);
    assert.deepEqual(result.templateCatalog, []);
    assert.deepEqual(Object.keys(result.projects[0]), [
      'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned'
    ]);
    assert.equal(result.projects[0].hasBinding, true);
    const text = JSON.stringify(result);
    for (const secret of ['/private/secret', 'paneState', 'boundSession', 'bindingRef', 'folder']) {
      assert(!text.includes(secret), `列表泄漏 ${secret}`);
    }
  });

  await test('projects.list 仅首屏交付页级快捷命令与脱敏模板目录，并在异步后重验代际', async () => {
    const calls = { command: 0, catalog: 0 };
    const fixture = createFixture({
      readSwitchCommand: async () => {
        calls.command += 1;
        return { seq: 9, projectId: PROJECT_A };
      },
      templateCatalogFor: async () => {
        calls.catalog += 1;
        return [{ id: 'builtin:short-video', label: '短视频', hint: '五阶段面板' }];
      }
    });
    const first = await invoke(fixture, 'projects.list', { cursor: 0, limit: 1 });
    assert.deepEqual(first.switchCommand, { seq: 9, projectId: PROJECT_A });
    assert.deepEqual(first.templateCatalog, [{
      id: 'builtin:short-video', label: '短视频', hint: '五阶段面板'
    }]);
    assert(!JSON.stringify(first).includes('prompt'));
    assert(!JSON.stringify(first).includes('/private/'));
    const later = await invoke(fixture, 'projects.list', { cursor: 1, limit: 1 });
    assert.equal(later.switchCommand, null);
    assert.deepEqual(later.templateCatalog, []);
    assert.deepEqual(calls, { command: 1, catalog: 1 }, '非首屏不能读取或抢占命令');

    const staleCalls = { catalog: 0 };
    const stale = createFixture({
      readSwitchCommand: async () => ({ seq: 10, projectId: PROJECT_A }),
      templateCatalogFor: async () => { staleCalls.catalog += 1; return []; }
    });
    const error = await captureError(() => invoke(stale, 'projects.list', {}, {
      context: currentContext([true, false])
    }));
    assert.equal(stale.operations['projects.list'].errorCode(error), 'operation-stale');
    assert.equal(staleCalls.catalog, 0, '快捷命令 await 后 stale 不继续读取目录');

    const invalid = createFixture({
      templateCatalogFor: () => [{
        id: 'builtin:short-video', label: '短视频', hint: '/private/package'
      }, {
        id: 'builtin:short-video', label: '重复', hint: null
      }]
    });
    const dropped = await invoke(invalid, 'projects.list', {});
    assert.deepEqual(dropped.templateCatalog, [], '目录任一非法或重复时整条 fail-closed');
  });

  await test('projects.create 目录只来自 chooser，取消/受保护根/过期绑定稳定映射', async () => {
    const cancelled = createFixture({ chooseFolder: async () => null });
    let error = await captureError(() => invoke(cancelled, 'projects.create', {}));
    assert.equal(cancelled.operations['projects.create'].errorCode(error), 'cancelled');
    assert.equal(cancelled.calls.create.length, 0);

    const protectedFixture = createFixture({ chooseFolder: async () => '/protected' });
    error = await captureError(() => invoke(protectedFixture, 'projects.create', {}));
    assert.equal(protectedFixture.operations['projects.create'].errorCode(error), 'project-protected');

    const stale = createFixture({ chooseFolder: async () => '/chosen/stale' });
    error = await captureError(() => invoke(stale, 'projects.create', {}, {
      context: currentContext([true, false])
    }));
    assert.equal(stale.operations['projects.create'].errorCode(error), 'operation-stale');
    assert.equal(stale.calls.create.length, 0, 'chooser 返回后 stale 不能写注册表');

    const asyncStore = createStore();
    let asyncCreateCalls = 0;
    const staleAfterCreate = createFixture({
      storeFixture: asyncStore,
      createProject: async (input, folder) => {
        asyncCreateCalls += 1;
        return asyncStore.store.create({ ...input, folder });
      }
    });
    error = await captureError(() => invoke(staleAfterCreate, 'projects.create', {}, {
      context: currentContext([true, true, false])
    }));
    assert.equal(staleAfterCreate.operations['projects.create'].errorCode(error), 'operation-stale');
    assert.equal(asyncCreateCalls, 1, '异步 create 返回后必须再次执行 page fence');

    const fixture = createFixture();
    const result = await invoke(fixture, 'projects.create', {
      name: '新项目', icon: '🧭', templateId: 'builtin:short-video'
    });
    assert.deepEqual(fixture.calls.create[0], {
      name: '新项目', icon: '🧭', templateId: 'builtin:short-video', folder: '/chosen/新项目'
    });
    assert(!JSON.stringify(result).includes('/chosen/'));
    assert.equal(result.project.projectId, `proj_${'c'.repeat(32)}`);
  });

  await test('projects.adopt 只认 chooser 文件夹，返回脱敏认领模式并在缺能力时关闭', async () => {
    const cancelled = createFixture({ chooseFolder: async () => null });
    let error = await captureError(() => invoke(cancelled, 'projects.adopt', {}));
    assert.equal(cancelled.operations['projects.adopt'].errorCode(error), 'cancelled');
    assert.deepEqual(cancelled.calls.adopt, []);

    const invalidFolder = createFixture({ chooseFolder: async () => '/chosen/bad\u0000folder' });
    error = await captureError(() => invoke(invalidFolder, 'projects.adopt', {}));
    assert.equal(invalidFolder.operations['projects.adopt'].errorCode(error), 'project-folder-invalid');
    assert.deepEqual(invalidFolder.calls.adopt, []);

    const stale = createFixture({ chooseFolder: async () => '/chosen/stale-adopt' });
    error = await captureError(() => invoke(stale, 'projects.adopt', {}, {
      context: currentContext([true, false])
    }));
    assert.equal(stale.operations['projects.adopt'].errorCode(error), 'operation-stale');
    assert.deepEqual(stale.calls.adopt, [], 'chooser 返回后 stale 不得认领目录');

    const storeFixture = createStore();
    storeFixture.store.adoptFolder = (folder) => {
      storeFixture.calls.adopt.push(folder);
      return { adopted: 'manifest', project: storeFixture.store.get(PROJECT_A) };
    };
    const fixture = createFixture({
      storeFixture,
      chooseFolder: async () => '/private/chosen/from-sidecar'
    });
    const result = await invoke(fixture, 'projects.adopt', {});
    assert.deepEqual(storeFixture.calls.adopt, ['/private/chosen/from-sidecar']);
    assert.deepEqual(Object.keys(result), ['kind', 'revision', 'adopted', 'project']);
    assert.equal(result.kind, 'adopted');
    assert.equal(result.adopted, 'manifest');
    assert.equal(result.project.projectId, PROJECT_A);
    assert.deepEqual(Object.keys(result.project), [
      'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned'
    ]);
    assert(!JSON.stringify(result).includes('/private/'), '认领结果不得回传选择器路径');
    for (const adopted of ['existing', 'relinked', 'manifest', 'new']) {
      assert.equal(fixture.operations['projects.adopt'].redact({ ...result, adopted }).adopted, adopted);
    }
    assert.throws(() => fixture.operations['projects.adopt'].redact({
      ...result, adopted: 'imported'
    }));
    assert.throws(() => fixture.operations['projects.adopt'].redact({
      ...result, absolutePath: '/private/chosen/from-sidecar'
    }));

    const unavailableStore = createStore();
    delete unavailableStore.store.adoptFolder;
    const unavailable = createFixture({ storeFixture: unavailableStore });
    error = await captureError(() => invoke(unavailable, 'projects.adopt', {}));
    assert.equal(unavailable.operations['projects.adopt'].errorCode(error), 'operation-failed');

    const conflictStore = createStore();
    conflictStore.store.adoptFolder = () => {
      const conflict = new Error('旁车 id 已占用');
      conflict.code = 'ERR_PROJECT_IDENTITY_CONFLICT';
      throw conflict;
    };
    const conflict = createFixture({ storeFixture: conflictStore });
    error = await captureError(() => invoke(conflict, 'projects.adopt', {}));
    assert.equal(conflict.operations['projects.adopt'].errorCode(error),
      'project-identity-conflict');
  });

  await test('projects.update 仅接受严格普通 paneState，页面不能伪造 artifact/locked', async () => {
    const fixture = createFixture();
    const descriptor = fixture.operations['projects.update'];
    assert.throws(() => descriptor.validate({ projectId: PROJECT_A, changes: {} }));
    assert.throws(() => descriptor.validate({
      projectId: PROJECT_A, changes: { folder: '/tmp/nope' }
    }));
    assert.doesNotThrow(() => descriptor.validate({
      projectId: PROJECT_A, changes: { paneState: ordinaryPaneState() }
    }));
    assert.throws(() => descriptor.validate({
      projectId: PROJECT_A, changes: { paneState: { text: 'not-layout' } }
    }));
    assert.throws(() => descriptor.validate({
      projectId: PROJECT_A, changes: { layoutPreset: 'grid' }
    }));
    const forged = JSON.parse(JSON.stringify(layout.createPaneState()));
    forged.windows[0] = layout.lockArtifact(forged.windows[0], {
      window: 1,
      path: 'output/result.md',
      kind: 'markdown',
      fingerprint: { size: 4, mtime: 42, sha256: 'd'.repeat(64) }
    });
    assert.throws(() => descriptor.validate({
      projectId: PROJECT_A, changes: { paneState: forged }
    }));
    const pane = ordinaryPaneState();
    const result = await invoke(fixture, 'projects.update', {
      projectId: PROJECT_A,
      changes: { name: '已更新', hidden: true, layoutPreset: 'split-two', paneState: pane }
    });
    assert.deepEqual(fixture.calls.update[0], {
      id: PROJECT_A,
      changes: {
        name: '已更新', hidden: true, layoutPreset: 'split-two',
        paneState: layout.validatePaneState(pane)
      }
    });
    assert(!JSON.stringify(result).includes('paneState'));
  });

  await test('remove/bind/reorder 严格校验 builtin、稳定 bindingRef、唯一 ids 与错误码', async () => {
    const fixture = createFixture();
    assert.throws(() => fixture.operations['projects.bind'].validate({
      projectId: PROJECT_A, bindingRef: `session-binding-${'A'.repeat(64)}`
    }));
    assert.throws(() => fixture.operations['projects.bind'].validate({
      projectId: PROJECT_A, bindingRef: 'raw-session-id'
    }));
    assert.throws(() => fixture.operations['projects.bind'].validate({
      projectId: PROJECT_A, bindingRef: null
    }));
    assert.throws(() => fixture.operations['projects.reorder'].validate({ ids: [PROJECT_A, PROJECT_A] }));
    assert.throws(() => fixture.operations['projects.reorder'].validate({
      ids: Array.from({ length: 129 }, (_, index) => `proj_${index.toString(16).padStart(32, '0')}`)
    }));

    let error = await captureError(() => invoke(fixture, 'projects.remove', {
      projectId: CONSOLE_ID
    }));
    assert.equal(fixture.operations['projects.remove'].errorCode(error), 'operation-invalid');
    const bound = await invoke(fixture, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A
    });
    assert.equal(bound.bindingRef, BINDING_A);
    await invoke(fixture, 'projects.reorder', { ids: [PROJECT_B, PROJECT_A] });
    assert.deepEqual(fixture.calls.reorder[0], [PROJECT_B, PROJECT_A]);

    error = operationError('ERR_PROJECT_FOLDER');
    assert.equal(fixture.operations['projects.create'].errorCode(error), 'project-folder-invalid');
    assert.equal(fixture.operations['projects.create'].errorCode(
      operationError('ERR_PROJECT_DUPLICATE_FOLDER')
    ), 'project-duplicate-folder');
    assert.equal(fixture.operations['projects.create'].errorCode(
      operationError('ERR_PROJECT_LIMIT')
    ), 'project-limit');
    assert.equal(fixture.operations['projects.create'].errorCode(
      operationError('ERR_PROJECT_NOT_FOUND')
    ), 'project-not-found');
    assert.equal(fixture.operations['projects.create'].errorCode(
      operationError('ERR_PROJECT_REGISTRY_AFTER_TEMPLATE')
    ), 'outcome-unknown');
    assert.equal(fixture.operations['projects.bind'].errorCode(
      operationError('ERR_PROJECT_SESSION_BOUND')
    ), 'operation-invalid');
    assert.equal(fixture.operations['projects.bind'].errorCode(
      operationError('ERR_PROJECT_ROOT_MISMATCH')
    ), 'workspace-mismatch');
  });

  await test('projects.sidecar 只按 projectId 写旁车，结果不泄漏目录且缺能力即失败', async () => {
    const fixture = createFixture();
    const result = await invoke(fixture, 'projects.sidecar', { projectId: PROJECT_A });
    assert.deepEqual(fixture.calls.sidecar, [PROJECT_A]);
    assert.deepEqual(result, {
      kind: 'sidecar', revision: 7, projectId: PROJECT_A, written: true
    });
    assert(Object.isFrozen(result));
    assert(!JSON.stringify(result).includes('/private/'));
    assert.throws(() => fixture.operations['projects.sidecar'].redact({
      ...result, written: false
    }));
    assert.throws(() => fixture.operations['projects.sidecar'].redact({
      ...result, manifestPath: '/private/project/.whaledock/project.json'
    }));

    let error = await captureError(() => invoke(fixture, 'projects.sidecar', {
      projectId: `proj_${'f'.repeat(32)}`
    }));
    assert.equal(fixture.operations['projects.sidecar'].errorCode(error), 'project-not-found');
    assert.deepEqual(fixture.calls.sidecar, [PROJECT_A], '不存在项目不得尝试写旁车');

    const unavailableStore = createStore();
    delete unavailableStore.store.writeManifest;
    const unavailable = createFixture({ storeFixture: unavailableStore });
    error = await captureError(() => invoke(unavailable, 'projects.sidecar', {
      projectId: PROJECT_A
    }));
    assert.equal(unavailable.operations['projects.sidecar'].errorCode(error), 'operation-failed');
  });

  await test('bootstrap bind 用 prepare openToken 做 CAS，跨页、重放与并发新绑定均不覆盖', async () => {
    const firstStore = createStore();
    firstStore.store.bindSession(PROJECT_A, null);
    firstStore.calls.bind.length = 0;
    const fixture = createFixture({ storeFixture: firstStore });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.doesNotThrow(() => fixture.operations['projects.bind'].validate({
      projectId: PROJECT_A, bindingRef: BINDING_A, openToken: prepared.openToken
    }));
    let error = await captureError(() => invoke(fixture, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A, openToken: prepared.openToken
    }, { binding: requestBinding({ pageInstanceId: 'page-instance-0002' }) }));
    assert.equal(fixture.operations['projects.bind'].errorCode(error), 'operation-stale');
    assert.equal(fixture.store.get(PROJECT_A).boundSession, null);

    const bound = await invoke(fixture, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A, openToken: prepared.openToken
    }, { binding: requestBinding({ selectionRevision: 4 }) });
    assert.equal(bound.bindingRef, BINDING_A);
    error = await captureError(() => invoke(fixture, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A, openToken: prepared.openToken
    }));
    assert.equal(fixture.operations['projects.bind'].errorCode(error), 'operation-stale');
    assert.deepEqual(fixture.calls.bind, [{ id: PROJECT_A, bindingRef: BINDING_A }],
      '同 token 只能完成一次 bootstrap 绑定');

    const racedStore = createStore();
    racedStore.store.bindSession(PROJECT_A, null);
    racedStore.calls.bind.length = 0;
    const raced = createFixture({ storeFixture: racedStore });
    const racedPrepared = await invoke(raced, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    racedStore.store.bindSession(PROJECT_A, BINDING_B);
    error = await captureError(() => invoke(raced, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A, openToken: racedPrepared.openToken
    }));
    assert.equal(raced.operations['projects.bind'].errorCode(error), 'operation-stale');
    assert.equal(raced.store.get(PROJECT_A).boundSession, BINDING_B,
      '旧 prepare 不得覆盖另一页先完成的绑定');

    const authStore = createStore();
    authStore.store.bindSession(PROJECT_A, null);
    authStore.calls.bind.length = 0;
    const authRace = createFixture({ storeFixture: authStore });
    const authPrepared = await invoke(authRace, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    error = await captureError(() => invoke(authRace, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A, openToken: authPrepared.openToken
    }, { context: currentContext(null, {
      authorizeProjectRoot: async () => {
        authStore.store.bindSession(PROJECT_A, BINDING_B);
        return true;
      }
    }) }));
    assert.equal(authRace.operations['projects.bind'].errorCode(error), 'operation-stale');
    assert.equal(authRace.store.get(PROJECT_A).boundSession, BINDING_B,
      '最终 root 授权 await 期间的新绑定也不得被覆盖');
  });

  await test('bind/open commit 根 proof 不一致时在 bind/touch/ack/激活前 fail-closed', async () => {
    const fixture = createFixture();
    let error = await captureError(() => invoke(fixture, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A
    }, { context: currentContext(null, { projectRootRef: ROOT_REF_B }) }));
    assert.equal(error.code, 'ERR_PROJECT_ROOT_MISMATCH');
    assert.equal(fixture.operations['projects.bind'].errorCode(error), 'workspace-mismatch');
    assert.equal(fixture.calls.bind.length, 0);

    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }, { context: currentContext(null, { sessionRootRef: ROOT_REF_B }) }));
    assert.equal(error.code, 'ERR_PROJECT_ROOT_MISMATCH');
    assert.equal(fixture.calls.touch.length, 0);
    assert.equal(fixture.opened.length, 0);
    assert.equal(fixture.logs.acks.length, 0);
  });

  await test('bind/open commit 最终 root 授权失败时零持久副作用', async () => {
    const fixture = createFixture();
    let authorizations = 0;
    const denied = currentContext(null, {
      authorizeProjectRoot: async () => {
        authorizations += 1;
        return false;
      }
    });
    let error = await captureError(() => invoke(fixture, 'projects.bind', {
      projectId: PROJECT_A, bindingRef: BINDING_A
    }, { context: denied }));
    assert.equal(error.code, 'ERR_PROJECT_ROOT_MISMATCH');
    assert.equal(fixture.calls.bind.length, 0);

    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }, { context: denied }));
    assert.equal(error.code, 'ERR_PROJECT_ROOT_MISMATCH');
    assert.equal(authorizations, 2);
    assert.deepEqual(fixture.calls.touch, []);
    assert.deepEqual(fixture.logs.acks, []);
    assert.deepEqual(fixture.opened, []);
  });

  await test('projects.open 激活 runtime 失败会保守报结果未知，且不 touch/ACK', async () => {
    const activationError = operationError('ERR_PROJECT_VIDEO_RUNTIME');
    const cleanup = [];
    const fixture = createFixture({
      onProjectOpened: () => { throw activationError; },
      onProjectOpenOutcomeUnknown: (projectId, cause) => cleanup.push({ projectId, cause })
    });
    await invoke(fixture, 'console.read', {
      snapshot: { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null }
    });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    const error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }));
    assert.equal(error.code, 'ERR_PROJECT_OPEN_OUTCOME_UNKNOWN');
    assert.equal(error.cause, activationError);
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'outcome-unknown');
    assert.deepEqual(fixture.calls.touch, []);
    assert.deepEqual(fixture.logs.acks, []);
    assert.deepEqual(fixture.opened, [{ projectId: PROJECT_A, seq: null }]);
    assert.deepEqual(cleanup, [{ projectId: PROJECT_A, cause: activationError }]);
  });

  await test('projects.open 激活后 registry/ACK 失败会清理并只报结果未知', async () => {
    const storeFixture = createStore();
    const registryError = operationError('ERR_PROJECT_REGISTRY_WRITE');
    const cleanupError = operationError('ERR_PROJECT_CLEANUP');
    storeFixture.store.touchOpened = (id) => {
      storeFixture.calls.touch.push(id);
      throw registryError;
    };
    const cleanup = [];
    const fixture = createFixture({
      storeFixture,
      onProjectOpenOutcomeUnknown: (projectId, cause) => {
        cleanup.push({ projectId, cause });
        throw cleanupError;
      }
    });
    await invoke(fixture, 'console.read', {
      snapshot: { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null }
    });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    const error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }));
    assert.equal(error.code, 'ERR_PROJECT_OPEN_OUTCOME_UNKNOWN');
    assert.equal(error.cause, registryError);
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'outcome-unknown');
    assert.deepEqual(fixture.opened, [{ projectId: PROJECT_A, seq: null }],
      'registry 失败发生在 runtime 激活之后');
    assert.deepEqual(fixture.calls.touch, [PROJECT_A]);
    assert.equal(fixture.logs.acks.length, 1);
    assert.deepEqual(cleanup, [{ projectId: PROJECT_A, cause: registryError }],
      '必须显式请求 main 清理已激活的权威根');

    const roomFixture = createRoom();
    const ackError = operationError('ERR_PROJECT_ACK');
    roomFixture.room.ackSession = () => { throw ackError; };
    const ackCleanup = [];
    const ackFixture = createFixture({
      roomFixture,
      onProjectOpenOutcomeUnknown: (projectId, cause) => {
        ackCleanup.push({ projectId, cause });
      }
    });
    await invoke(ackFixture, 'console.read', {
      snapshot: { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null }
    });
    const ackPrepared = await invoke(ackFixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    const ackOutcome = await captureError(() => invoke(ackFixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: ackPrepared.openToken
    }));
    assert.equal(ackOutcome.code, 'ERR_PROJECT_OPEN_OUTCOME_UNKNOWN');
    assert.equal(ackOutcome.cause, ackError);
    assert.equal(ackFixture.operations['projects.open'].errorCode(ackOutcome), 'outcome-unknown');
    assert.deepEqual(ackFixture.opened, [{ projectId: PROJECT_A, seq: null }]);
    assert.deepEqual(ackFixture.calls.touch, [], 'ACK 失败后不应继续 touch registry');
    assert.deepEqual(ackCleanup, [{ projectId: PROJECT_A, cause: ackError }]);
  });

  await test('projects.open prepare/commit 仅成功 commit touch+ack，拒绝重放与跨页面', async () => {
    const fixture = createFixture();
    const snapshot = { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null };
    await invoke(fixture, 'console.read', { snapshot });
    const missingFolder = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_B
    });
    assert.equal(missingFolder.project.hasFolder, false, 'prepare 必须回读目录当前是否存在');
    assert.equal(missingFolder.project.folderTail, 'missing', '目录丢失仍应保留安全 basename');
    assert.equal(fixture.calls.touch.length, 0);
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.equal(prepared.kind, 'open-prepared');
    assert.equal(prepared.bindingRef, BINDING_A);
    assert.match(prepared.openToken, /^project-open-[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(prepared.project), [
      'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned',
      'folderTail', 'templateId', 'layoutPreset', 'paneState',
      'templateActions', 'templateActionsCapped'
    ]);
    assert.equal(prepared.project.folderTail, '旅行 Atlas');
    assert.equal(prepared.project.templateId, 'builtin:short-video');
    assert.equal(prepared.project.layoutPreset, 'split-two');
    assert.deepEqual(prepared.project.paneState, layout.createPaneState('split-two'));
    assert.equal(fixture.operations['projects.open'].limits.maxResultBytes, 24 * 1024);
    assert(!JSON.stringify(prepared.project).includes('/private/'));
    assert.equal(fixture.calls.touch.length, 0);
    assert.equal(fixture.logs.acks.length, 0);

    let error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }, { binding: requestBinding({ pageInstanceId: 'page-instance-0002' }) }));
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.equal(fixture.calls.touch.length, 0);

    error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_B, openToken: prepared.openToken
    }));
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.equal(fixture.calls.touch.length, 0);

    const committed = await invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }, { binding: requestBinding({ selectionRevision: 4 }) });
    assert.equal(committed.kind, 'open-committed');
    assert.deepEqual(fixture.calls.touch, [PROJECT_A]);
    assert.equal(fixture.logs.acks.length, 1);
    assert.equal(fixture.logs.acks[0].bindingRef, BINDING_A);

    error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }));
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.deepEqual(fixture.calls.touch, [PROJECT_A], 'token 重放不能再次 touch');

    assert.throws(() => fixture.operations['projects.open'].redact({
      kind: 'open-prepared',
      project: { ...prepared.project, paneState: { selected: '/private/secret' } },
      bindingRef: BINDING_A,
      openToken: `project-open-${'f'.repeat(64)}`
    }));

    const largeFixture = createFixture();
    await invoke(largeFixture, 'projects.update', {
      projectId: PROJECT_A,
      changes: { paneState: largePaneState() }
    });
    const broker = createContextFileRpcBroker({
      operations: largeFixture.operations,
      randomBytes: createRandom()
    });
    const brokerResult = await invokeThroughBroker(
      broker,
      requestBinding(),
      'projects.open',
      { phase: 'prepare', projectId: PROJECT_A }
    );
    assert.equal(brokerResult.state, 'fulfilled', JSON.stringify(brokerResult));
    assert.equal(brokerResult.result.project.paneState.windows.length, 16);
    assert(Buffer.byteLength(JSON.stringify(brokerResult.result), 'utf8') > 8 * 1024);
  });

  await test('未绑定 prepare 在最大 ticket 下动态裁可选面且总包不超 24 KiB', async () => {
    const storeFixture = createStore();
    storeFixture.store.update(PROJECT_A, { paneState: largePaneState(500) });
    storeFixture.store.bindSession(PROJECT_A, null);
    storeFixture.calls.bind.length = 0;
    const ticket = `project-bootstrap-v1.${'A'.repeat(16)}.${'B'.repeat(8000)}.${'C'.repeat(22)}`;
    assert(Buffer.byteLength(ticket, 'utf8') < 8 * 1024);
    const action = {
      id: 'bootstrap_draft', label: '生成草稿', hint: '仅填入当前对话', confirm: false,
      prompt: 'x'.repeat(3000)
    };
    const fixture = createFixture({
      storeFixture,
      bootstrapTicketFor: () => ticket,
      templateActionsFor: () => [action]
    });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.equal(prepared.bootstrapTicket, ticket);
    assert.equal(prepared.project.paneState.windows.length, 16,
      '必需 paneState 不能为给 ticket 让路而被删除');
    assert.deepEqual(prepared.project.templateActions, [],
      '总包超预算时先裁可选 action');
    assert.equal(prepared.project.templateActionsCapped, true);
    assert(Buffer.byteLength(JSON.stringify(prepared), 'utf8') <= 24 * 1024);
    assert.deepEqual(fixture.calls.touch, []);
    assert.deepEqual(fixture.logs.acks, []);

    const impossibleStore = createStore();
    impossibleStore.store.update(PROJECT_A, { paneState: largePaneState(590) });
    impossibleStore.store.bindSession(PROJECT_A, null);
    impossibleStore.calls.bind.length = 0;
    const impossible = createFixture({
      storeFixture: impossibleStore,
      bootstrapTicketFor: () => ticket
    });
    const error = await captureError(() => invoke(impossible, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    }));
    assert.equal(impossible.operations['projects.open'].errorCode(error), 'operation-failed');
    assert.deepEqual(impossible.calls.touch, []);
    assert.deepEqual(impossible.logs.acks, []);
  });

  await test('projects.open 强验当前 bindingRef、允许同页 revision 前进，并精确回执快捷 seq', async () => {
    const fixture = createFixture({
      readSwitchCommand: () => ({ seq: 27, projectId: PROJECT_A })
    });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    }, { binding: requestBinding({ selectionRevision: 10 }) });
    assert.equal(prepared.bindingRef, BINDING_A);
    let error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }, {
      binding: requestBinding({ selectionRevision: 11 }),
      context: currentContext(null, { currentBindingRef: BINDING_B })
    }));
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.equal(fixture.calls.touch.length, 0);

    const preparedAgain = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    }, { binding: requestBinding({ selectionRevision: 12 }) });
    const committed = await invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: preparedAgain.openToken
    }, {
      binding: requestBinding({ selectionRevision: 13 }),
      context: currentContext(null, { currentBindingRef: BINDING_A })
    });
    assert.equal(committed.kind, 'open-committed');
    assert.deepEqual(fixture.opened, [{ projectId: PROJECT_A, seq: 27 }]);

    const unboundFixture = createFixture();
    unboundFixture.store.bindSession(PROJECT_A, null);
    const unbound = await invoke(unboundFixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.equal(unbound.bindingRef, null, '未绑定项目仍可只读 prepare 详情');
    error = await captureError(() => invoke(unboundFixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: unbound.openToken
    }, { context: currentContext(null, { currentBindingRef: null }) }));
    assert.equal(unboundFixture.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.equal(unboundFixture.calls.touch.length, 0);
  });

  await test('projects.open 只投影严格 actions/preview，异步 stale 与超预算整条降级', async () => {
    const storeFixture = createStore();
    storeFixture.store.update(PROJECT_A, { paneState: ordinaryPaneState() });
    const action = {
      id: 'draft', label: '生成草稿', hint: '只填入对话草稿', confirm: false,
      prompt: '请生成一份安全草稿'
    };
    const fixture = createFixture({
      storeFixture,
      templateActionsFor: () => [action],
      previewForProject: () => [{
        window: 1,
        tabId: 'draft',
        preview: { kind: 'text', text: '<script>不执行</script>', truncated: false }
      }]
    });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.deepEqual(prepared.project.templateActions, [action]);
    assert.equal(prepared.project.templateActionsCapped, false);
    const tab = prepared.project.paneState.windows[0].tabs[0];
    assert.equal(tab.relativeRef, 'drafts/current.txt');
    assert.deepEqual(tab.preview, {
      kind: 'text', text: '<script>不执行</script>', truncated: false
    });
    const serialized = JSON.stringify(prepared.project);
    assert(!serialized.includes('panePreviews'));
    assert(!serialized.includes('"path"'));

    const capped = createFixture({
      templateActionsFor: () => [1, 2].map((number) => ({
        id: `long_${number}`, label: `动作${number}`, hint: null, confirm: false,
        prompt: 'x'.repeat(6500)
      })),
      previewForProject: () => [{
        window: 1, tabId: 'missing',
        preview: { kind: 'text', text: '不会附着', truncated: false }
      }]
    });
    const cappedResult = await invoke(capped, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.deepEqual(cappedResult.project.templateActions, []);
    assert.equal(cappedResult.project.templateActionsCapped, true);
    assert.equal(Object.prototype.hasOwnProperty.call(
      cappedResult.project.paneState.windows[0].tabs[0] || {}, 'preview'
    ), false);

    const stale = createFixture({ templateActionsFor: async () => [action] });
    const error = await captureError(() => invoke(stale, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    }, { context: currentContext([true, false]) }));
    assert.equal(stale.operations['projects.open'].errorCode(error), 'operation-stale');

    const commitStale = createFixture({ templateActionsFor: async () => [action] });
    const commitPrepared = await invoke(commitStale, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    const commitError = await captureError(() => invoke(commitStale, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: commitPrepared.openToken
    }, { context: currentContext([true, false]) }));
    assert.equal(commitStale.operations['projects.open'].errorCode(commitError), 'operation-stale');
    assert.equal(commitStale.calls.touch.length, 0, 'commit action await 后 stale 不得 touch');
  });

  await test('projects.open 的可选 skin 只投影固定色票，非法/读取失败时安全省略', async () => {
    const requested = [];
    const fixture = createFixture({
      skinForTemplate: async (templateId) => {
        requested.push(templateId);
        return SAFE_SKIN;
      }
    });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.deepEqual(requested, ['builtin:short-video']);
    assert.deepEqual(prepared.project.skin, SAFE_SKIN);
    assert(Object.isFrozen(prepared.project.skin));
    assert(Object.isFrozen(prepared.project.skin.colors));
    assert.deepEqual(Object.keys(prepared.project.skin.colors), [
      'background', 'surface', 'border', 'primary', 'accent', 'text', 'textMuted'
    ]);
    const serialized = JSON.stringify(prepared.project.skin);
    for (const forbidden of ['path', 'css', 'font', 'url', '/private/']) {
      assert(!serialized.includes(forbidden), `skin 不得包含 ${forbidden}`);
    }

    const invalid = createFixture({
      skinForTemplate: () => ({
        base: 'dark', colors: { ...SAFE_SKIN.colors, accent: '#35B6D4', rawCss: 'body{}' }
      })
    });
    const dropped = await invoke(invalid, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.equal(Object.prototype.hasOwnProperty.call(dropped.project, 'skin'), false);

    const failed = createFixture({
      skinForTemplate: () => { throw operationError('ERR_SKIN_READ', '/private/theme.json'); }
    });
    const fallback = await invoke(failed, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.equal(Object.prototype.hasOwnProperty.call(fallback.project, 'skin'), false);
    assert(!JSON.stringify(fallback).includes('/private/theme.json'));

    let commandCalls = 0;
    const stale = createFixture({
      skinForTemplate: async () => SAFE_SKIN,
      readSwitchCommand: () => { commandCalls += 1; return null; }
    });
    const error = await captureError(() => invoke(stale, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    }, { context: currentContext([true, true, true, false]) }));
    assert.equal(stale.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.equal(commandCalls, 0, 'skin await 后 stale 不得继续读取快捷命令');
  });

  await test('projects.open token TTL 到期 fail-closed 且不 touch', async () => {
    const fixture = createFixture();
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    fixture.clock.advance(30_001);
    const error = await captureError(() => invoke(fixture, 'projects.open', {
      phase: 'commit', projectId: PROJECT_A, openToken: prepared.openToken
    }));
    assert.equal(fixture.operations['projects.open'].errorCode(error), 'operation-stale');
    assert.equal(fixture.calls.touch.length, 0);
  });

  await test('detailFromStore 可返回 main 写入的严格 artifact paneState', async () => {
    const fixture = createFixture();
    const paneState = JSON.parse(JSON.stringify(layout.createPaneState()));
    paneState.windows[0] = layout.lockArtifact(paneState.windows[0], {
      window: 1,
      path: 'output/result.md',
      kind: 'markdown',
      fingerprint: { size: 4, mtime: 42, sha256: 'e'.repeat(64) }
    });
    fixture.store.update(PROJECT_A, { paneState, layoutPreset: 'split-two' });
    const prepared = await invoke(fixture, 'projects.open', {
      phase: 'prepare', projectId: PROJECT_A
    });
    assert.equal(prepared.project.paneState.windows[0].tabs[0].type, 'artifact');
    assert.equal(prepared.project.paneState.windows[0].tabs[0].locked, true);
    assert.equal(
      prepared.project.paneState.windows[0].tabs[0].descriptor.relativeRef,
      'output/result.md'
    );
    assert.equal(Object.prototype.hasOwnProperty.call(
      prepared.project.paneState.windows[0].tabs[0].descriptor, 'path'
    ), false);
    assert.equal(prepared.project.hasBinding, true);

    await invoke(fixture, 'projects.update', {
      projectId: PROJECT_A, changes: { layoutPreset: 'grid-four' }
    });
    let saved = fixture.store.get(PROJECT_A);
    assert.equal(saved.paneState.preset, 'grid-four');
    assert.deepEqual(saved.paneState.windows.map((item) => item.window), [1, 2, 3, 4]);
    assert.equal(saved.paneState.windows[0].tabs[0].type, 'artifact', '切预设不能删除产物');

    await invoke(fixture, 'projects.update', {
      projectId: PROJECT_A, changes: { paneState: layout.createPaneState('split-two') }
    });
    saved = fixture.store.get(PROJECT_A);
    assert.equal(saved.paneState.windows[0].tabs[0].type, 'artifact', '普通页面状态不能覆盖锁定产物');

    const broker = createContextFileRpcBroker({
      operations: fixture.operations,
      randomBytes: createRandom()
    });
    const brokerResult = await invokeThroughBroker(
      broker, requestBinding(), 'projects.open', { phase: 'prepare', projectId: PROJECT_A }
    );
    assert.equal(brokerResult.state, 'fulfilled');
    const text = JSON.stringify(brokerResult.result);
    assert(!text.includes('"path"'));
    assert(text.includes('"relativeRef":"output/result.md"'));
  });

  await test('projects.detach 只按现存 window/tab 定位，并仅向 Host 交付安全项目身份', async () => {
    const storeFixture = createStore();
    storeFixture.store.update(PROJECT_A, { paneState: ordinaryPaneState() });
    const fixture = createFixture({ storeFixture });
    const result = await invoke(fixture, 'projects.detach', {
      projectId: PROJECT_A, window: 1, tabId: 'draft'
    });
    assert.deepEqual(result, {
      kind: 'detached', projectId: PROJECT_A, window: 1, tabId: 'draft'
    });
    assert(Object.isFrozen(result));
    assert.equal(fixture.detached.length, 1);
    const payload = fixture.detached[0];
    assert(Object.isFrozen(payload));
    assert(Object.isFrozen(payload.project));
    assert(Object.isFrozen(payload.tab));
    assert.deepEqual(Object.keys(payload), ['project', 'window', 'tab']);
    assert.deepEqual(payload.project, {
      projectId: PROJECT_A, name: '旅行 Atlas', icon: '🌍'
    });
    assert.deepEqual(payload.tab, {
      id: 'draft', type: 'text', title: '草稿', path: 'drafts/current.txt'
    });
    const payloadText = JSON.stringify(payload);
    for (const forbidden of ['/private/', 'folder', 'boundSession', 'bindingRef']) {
      assert(!payloadText.includes(forbidden), `分离窗 Host 输入泄漏 ${forbidden}`);
    }
    assert(!JSON.stringify(result).includes('drafts/current.txt'), '页面结果不得回传相对文件引用');

    let error = await captureError(() => invoke(fixture, 'projects.detach', {
      projectId: PROJECT_A, window: 2, tabId: 'draft'
    }));
    assert.equal(fixture.operations['projects.detach'].errorCode(error), 'operation-invalid');
    assert.equal(fixture.detached.length, 1, '失效目标不得打开窗口');
    for (const input of [
      { projectId: PROJECT_A, window: 0, tabId: 'draft' },
      { projectId: PROJECT_A, window: 17, tabId: 'draft' },
      { projectId: PROJECT_A, window: 1, tabId: 'bad\u0000tab' },
      { projectId: PROJECT_A, window: 1, tabId: 'draft', relativeRef: 'drafts/current.txt' }
    ]) {
      assert.throws(() => fixture.operations['projects.detach'].validate(input));
    }
    assert.throws(() => fixture.operations['projects.detach'].redact({
      ...result, path: '/private/secret'
    }));

    const artifactStore = createStore();
    const artifactPane = JSON.parse(JSON.stringify(layout.createPaneState()));
    artifactPane.windows[0] = layout.lockArtifact(artifactPane.windows[0], {
      window: 1,
      path: 'output/final.md',
      kind: 'markdown',
      fingerprint: { size: 8, mtime: 42, sha256: 'f'.repeat(64) }
    });
    artifactStore.store.update(PROJECT_A, { paneState: artifactPane });
    const artifactFixture = createFixture({ storeFixture: artifactStore });
    const artifactTabId = artifactPane.windows[0].tabs[0].id;
    await invoke(artifactFixture, 'projects.detach', {
      projectId: PROJECT_A, window: 1, tabId: artifactTabId
    });
    assert.equal(artifactFixture.detached[0].tab.locked, true);
    assert.equal(artifactFixture.detached[0].tab.descriptor.kind, 'markdown');
    assert.equal(artifactFixture.detached[0].tab.descriptor.path, 'output/final.md');

    const staleStore = createStore();
    staleStore.store.update(PROJECT_A, { paneState: ordinaryPaneState() });
    let staleWindowDestroyed = 0;
    const stale = createFixture({
      storeFixture: staleStore,
      onDetach: async () => ({
        destroy() { staleWindowDestroyed += 1; }
      })
    });
    error = await captureError(() => invoke(stale, 'projects.detach', {
      projectId: PROJECT_A, window: 1, tabId: 'draft'
    }, { context: currentContext([true, false]) }));
    assert.equal(stale.operations['projects.detach'].errorCode(error), 'operation-stale');
    assert.equal(staleWindowDestroyed, 1, 'await 后 stale 必须撤销已打开的分离窗');
  });

  await test('console.read 二次消毒、复合 binding 缓存/TTL 与 need 回调均有界', async () => {
    const fixture = createFixture();
    const raw = {
      byId: { [BINDING_A]: { running: true, cwd: '/private/raw/cwd' } },
      subagentsByParent: {}, jobsBySession: {}, current: BINDING_A
    };
    const first = await invoke(fixture, 'console.read', { snapshot: raw });
    assert.equal(fixture.logs.sanitized[0].byId[BINDING_A].cwd, '/private/raw/cwd');
    assert.deepEqual(fixture.needs, [1]);
    assert.deepEqual(first.cards[0].recent, {
      role: 'assistant', text: '已生成初稿，请确认。', updatedAt: 999_000
    });
    assert(Object.isFrozen(first.cards[0].recent));
    const text = JSON.stringify(first);
    for (const secret of ['/private/', 'cwd', 'folder', 'boundSession', 'bindingRef']) {
      assert(!text.includes(secret), `控制室结果泄漏 ${secret}`);
    }
    const firstMemory = fixture.logs.builds[0];
    assert.equal(firstMemory.acks, undefined);
    assert.equal(firstMemory.seen, undefined);

    await invoke(fixture, 'console.read', { snapshot: raw });
    // 只检查 opaque 对象原样回灌，不读取或断言其内部签名形状。
    assert.strictEqual(fixture.logs.builds[1].acks, fixture.logs.outputs[0].acks);
    assert.strictEqual(fixture.logs.builds[1].seen, fixture.logs.outputs[0].seen);

    await invoke(fixture, 'console.read', { snapshot: raw }, {
      binding: requestBinding({ pageInstanceId: 'page-instance-0002' })
    });
    assert.equal(fixture.logs.builds[2].acks, undefined, '不同页面不能共享 ack');

    fixture.clock.advance(30_001);
    await invoke(fixture, 'console.read', { snapshot: raw });
    assert.equal(fixture.logs.builds[3].acks, undefined, 'TTL 后不得复用旧 ack');

    const oversized = {
      snapshot: { byId: { [BINDING_A]: { displayTitle: '中'.repeat(17_000) } }, subagentsByParent: {}, jobsBySession: {}, current: null }
    };
    assert.throws(() => fixture.operations['console.read'].validate(oversized));

    fixture.logs.recent = {
      role: 'assistant', text: '安全摘要', updatedAt: 999_001,
      privatePath: '/private/should-not-pass'
    };
    const error = await captureError(() => invoke(fixture, 'console.read', { snapshot: raw }));
    assert.equal(fixture.operations['console.read'].errorCode(error), 'operation-failed',
      'control-room 输出的 recent 也必须二次精确校验');
  });

  await test('console.read 只在已绑定项目新进入 done 时触发扫描回调', async () => {
    const fixture = createFixture();
    const snapshot = { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null };
    await invoke(fixture, 'console.read', { snapshot });
    assert.deepEqual(fixture.consoleEvents[0].doneProjectIds, []);
    fixture.logs.status = 'done';
    await invoke(fixture, 'console.read', { snapshot });
    assert.deepEqual(fixture.consoleEvents[1].doneProjectIds, [PROJECT_A]);
    await invoke(fixture, 'console.read', { snapshot });
    assert.deepEqual(fixture.consoleEvents[2].doneProjectIds, [], '重复 done 不重复扫描');
    fixture.logs.status = 'busy';
    await invoke(fixture, 'console.read', { snapshot });
    fixture.logs.status = 'done';
    await invoke(fixture, 'console.read', { snapshot });
    assert.deepEqual(fixture.consoleEvents[4].doneProjectIds, [PROJECT_A]);
    assert(!JSON.stringify(fixture.consoleEvents).includes(BINDING_A));
  });

  await test('console.read 使用真实 control-room 二次消毒并限制复合 binding 缓存容量', async () => {
    const actualRoom = require('../lib/control-room');
    const actualFixture = createFixture({
      roomFixture: { room: actualRoom, logs: null }
    });
    const snapshot = {
      byId: {
        [BINDING_A]: {
          running: true,
          pendingInteraction: 'question',
          displayTitle: '需要确认',
          recent: {
            role: 'assistant', text: '  已完成草稿，请确认  ', updatedAt: 999_000,
            privatePath: '/private/never-return'
          },
          cwd: '/private/never-return'
        }
      },
      subagentsByParent: {}, jobsBySession: {}, current: BINDING_A
    };
    const result = await invoke(actualFixture, 'console.read', { snapshot });
    assert.deepEqual(result.counts, {
      need: 1, done: 0, busy: 0, idle: 2, total: 3, glowing: 1
    });
    const card = result.cards.find((entry) => entry.projectId === PROJECT_A);
    assert.deepEqual(card.recent, {
      role: 'assistant', text: '已完成草稿，请确认', updatedAt: 999_000
    });
    assert.deepEqual(Object.keys(card.recent), ['role', 'text', 'updatedAt']);
    assert(!JSON.stringify(result).includes('/private/never-return'));

    const invalidRecent = await invoke(actualFixture, 'console.read', {
      snapshot: {
        ...snapshot,
        byId: {
          [BINDING_A]: {
            ...snapshot.byId[BINDING_A],
            recent: { role: 'tool', text: '不应显示', updatedAt: 999_001 }
          }
        }
      }
    });
    assert.equal(
      invalidRecent.cards.find((entry) => entry.projectId === PROJECT_A).recent,
      null,
      '未知角色的 recent 必须降为 null'
    );

    const fixture = createFixture();
    const empty = { byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null };
    for (let index = 0; index < 65; index += 1) {
      await invoke(fixture, 'console.read', { snapshot: empty }, {
        binding: requestBinding({ pageInstanceId: `page-instance-${String(index).padStart(4, '0')}` })
      });
    }
    await invoke(fixture, 'console.read', { snapshot: empty }, {
      binding: requestBinding({ pageInstanceId: 'page-instance-0000' })
    });
    assert.equal(fixture.logs.builds[65].acks, undefined, '第 65 个 binding 后最旧缓存必须淘汰');
    assert.equal(fixture.logs.builds[65].seen, undefined);
  });

  console.log(`PROJECT OPS ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('FAIL  project-ops:', error && error.stack ? error.stack : error);
  process.exit(1);
});
