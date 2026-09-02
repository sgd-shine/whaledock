'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
const main = require('../main');
const bridge = require('../lib/context-bridge');
const projects = require('../lib/projects');
const layout = require('../lib/project-layout');
const artifacts = require('../lib/project-artifacts');
const projectRootRef = require('../lib/project-root-ref');
const projectBootstrapTicket = require('../lib/project-bootstrap-ticket');
const workbenches = require('../lib/workbenches');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v11-projects: ${name}`);
  } catch (error) {
    console.error(`FAIL  main-v11-projects: ${name}`);
    throw error;
  }
}

function globalRequest(overrides = {}) {
  return {
    requestToken: 'a'.repeat(64),
    requestSeq: 41,
    controllerId: 'controller-projects-0001',
    pageInstanceId: 'page-projects-0001',
    selectionRevision: 7,
    operation: 'projects.list',
    input: { cursor: 0, limit: 32, includeHidden: false },
    issuedAtMs: 1000,
    deadlineMs: 11000,
    ...overrides
  };
}

function builtinPackages() {
  const listed = workbenches.listWorkbenchPackages({
    roots: [{
      dir: path.join(__dirname, '..', 'assets', 'workbenches'),
      source: 'builtin'
    }]
  });
  assert.deepEqual(listed.skipped, []);
  return listed.packages;
}

function videoPackage() {
  const found = builtinPackages().find((entry) => entry.id === 'builtin:短视频创作台');
  assert(found);
  return found;
}

async function run() {
  await test('legacy 21 + project 8 = combined 29 且互不混用', () => {
    assert.equal(main.CONTEXT_POC_LEGACY_WORKSPACE_FILE_OPERATIONS.size, 21);
    assert.equal(main.CONTEXT_POC_PROJECT_OPERATIONS.size, 8);
    assert.equal(main.CONTEXT_POC_WORKSPACE_FILE_OPERATIONS.size, 29);
    assert.equal([...main.CONTEXT_POC_PROJECT_OPERATIONS]
      .some((name) => main.CONTEXT_POC_LEGACY_WORKSPACE_FILE_OPERATIONS.has(name)), false);
  });

  await test('全局项目请求不要求视频 project/context，但严格绑定页面 fence', () => {
    const request = globalRequest();
    assert.deepEqual(main.contextPocWorkspaceFileRequestValue(request), request);
    assert.equal(main.contextPocWorkspaceFileRequestValue({
      ...request,
      projectId: `wdp1_${'b'.repeat(32)}`
    }), null);
    assert.equal(main.contextPocWorkspaceFileRequestValue({
      ...request,
      deadlineMs: 11001
    }), null);

    const runtime = {
      handshake: {
        hostInstanceId: 'host-projects-0001',
        capabilities: ['workspace-files-v1']
      },
      binding: null,
      pageBinding: {
        controllerId: request.controllerId,
        pageInstanceId: request.pageInstanceId,
        selectionRevision: request.selectionRevision
      }
    };
    assert.deepEqual(main.contextPocWorkspaceFileBindingFor(runtime, request), {
      hostInstanceId: runtime.handshake.hostInstanceId,
      controllerId: request.controllerId,
      pageInstanceId: request.pageInstanceId,
      selectionRevision: request.selectionRevision
    });
    assert.equal(main.contextPocWorkspaceFileBindingFor(runtime, {
      ...request, selectionRevision: request.selectionRevision + 1
    }), null);
  });

  await test('bind/open commit 私有 root proof 与 currentBindingRef 严格限定且不进 input', () => {
    const currentBindingRef = `session-binding-${'a'.repeat(64)}`;
    const sessionRootRef = `session-root-${'c'.repeat(64)}`;
    const commit = globalRequest({
      operation: 'projects.open',
      input: {
        phase: 'commit',
        projectId: `proj_${'a'.repeat(32)}`,
        openToken: `project-open-${'b'.repeat(64)}`
      },
      currentBindingRef,
      sessionRootRef
    });
    assert.deepEqual(main.contextPocWorkspaceFileRequestValue(commit), commit);
    assert.equal(Object.prototype.hasOwnProperty.call(commit.input, 'currentBindingRef'), false);
    assert.equal(main.contextPocWorkspaceFileRequestValue({
      ...commit, currentBindingRef: `session-${'a'.repeat(64)}`
    }), null);
    const { currentBindingRef: _privateRef, ...missing } = commit;
    assert.equal(main.contextPocWorkspaceFileRequestValue(missing), null);
    const { sessionRootRef: _rootRef, ...missingRoot } = commit;
    assert.equal(main.contextPocWorkspaceFileRequestValue(missingRoot), null);
    assert.equal(main.contextPocWorkspaceFileRequestValue(globalRequest({
      operation: 'projects.open',
      input: { phase: 'prepare', projectId: `proj_${'a'.repeat(32)}` },
      currentBindingRef,
      sessionRootRef
    })), null);
    const bind = globalRequest({
      operation: 'projects.bind',
      input: {
        projectId: `proj_${'a'.repeat(32)}`,
        bindingRef: currentBindingRef
      },
      sessionRootRef
    });
    assert.deepEqual(main.contextPocWorkspaceFileRequestValue(bind), bind);
    assert.equal(main.contextPocWorkspaceFileRequestValue({
      ...bind, sessionRootRef: `delivery-target-${'c'.repeat(64)}`
    }), null);
    assert.equal(main.contextPocWorkspaceFileRequestValue(globalRequest({
      operation: 'projects.bind', input: bind.input
    })), null);
    assert(!JSON.stringify(commit.input).includes(currentBindingRef));
    assert(!JSON.stringify(bind.input).includes(sessionRootRef));
  });

  await test('none selection 仍保留受管页面身份，未登记页面不伪造身份', () => {
    const controller = { controllerId: 'controller-projects-0001' };
    const runtime = { handshake: { hostInstanceId: 'host-projects-0001' } };
    assert.deepEqual(main.contextPocBindingValue({
      state: 'none',
      hostInstanceId: 'host-projects-0001',
      sessionRef: null,
      controllerId: controller.controllerId,
      pageInstanceId: 'page-projects-0001',
      selectionRevision: 8,
      code: null
    }, runtime, controller), {
      state: 'none',
      controllerId: controller.controllerId,
      pageInstanceId: 'page-projects-0001',
      selectionRevision: 8,
      code: null
    });
    assert.deepEqual(main.contextPocBindingValue({
      state: 'none', hostInstanceId: 'host-projects-0001', sessionRef: null, code: null
    }, runtime, controller), { state: 'none', code: null });

    const selected = {
      state: 'selected',
      hostInstanceId: 'host-projects-0001',
      sessionRef: `session-${'a'.repeat(64)}`,
      deliveryTargetRef: `delivery-target-${'b'.repeat(64)}`,
      controllerId: controller.controllerId,
      pageInstanceId: 'page-projects-0001',
      selectionRevision: 9,
      currentBindingRef: `session-binding-${'c'.repeat(64)}`,
      sessionRootRef: `session-root-${'d'.repeat(64)}`,
      code: null
    };
    assert.deepEqual(main.contextPocBindingValue(selected, runtime, controller), {
      state: 'selected',
      sessionRef: selected.sessionRef,
      deliveryTargetRef: selected.deliveryTargetRef,
      controllerId: controller.controllerId,
      pageInstanceId: selected.pageInstanceId,
      selectionRevision: 9,
      currentBindingRef: selected.currentBindingRef,
      sessionRootRef: selected.sessionRootRef,
      code: null
    });
    const { sessionRootRef: _missingRoot, ...halfProof } = selected;
    assert.equal(main.contextPocBindingValue(halfProof, runtime, controller), null);
    assert.equal(main.contextPocBindingValue({
      state: 'none', hostInstanceId: 'host-projects-0001', sessionRef: null,
      currentBindingRef: selected.currentBindingRef, sessionRootRef: selected.sessionRootRef,
      code: null
    }, runtime, controller), null, '非 selected 回包不得夹带项目 proof');
  });

  await test('全局 binding 精确对账，不与 workspace binding 串用', () => {
    const global = {
      hostInstanceId: 'host-projects-0001',
      controllerId: 'controller-projects-0001',
      pageInstanceId: 'page-projects-0001',
      selectionRevision: 7
    };
    assert.equal(main.contextPocWorkspaceBindingEqual(global, { ...global }), true);
    assert.equal(main.contextPocWorkspaceBindingEqual(global, {
      ...global, selectionRevision: 8
    }), false);
    assert.equal(main.contextPocWorkspaceBindingEqual(global, {
      ...global,
      projectId: `wdp1_${'c'.repeat(32)}`,
      contextRevision: 1,
      workspaceGeneration: 1,
      rootIdentity: { dev: '1', ino: '2' }
    }), false);
  });

  await test('项目注册表在 userData 内初始化并固定创建控制室', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-projects-'));
    let marked = 0;
    const store = main.initializeProjectRegistry(root, {
      configSnapshot: { workdir: null, workbenchId: null, projectMigrationVersion: 0 },
      markMigrated: () => { marked += 1; },
      logger: () => {}
    });
    const consoleProject = store.get(projects.CONSOLE_PROJECT_ID);
    assert(consoleProject);
    assert.equal(consoleProject.kind, 'builtin');
    assert.equal(consoleProject.pinned, true);
    assert.equal(consoleProject.hasFolder, false);
    assert.equal(path.dirname(store.filePath), path.join(root, 'projects'));
    assert.equal(fs.existsSync(store.filePath), true);
    const protectedRoots = main.projectProtectedRoots(root).map((item) => path.resolve(item));
    assert(protectedRoots.includes(path.resolve(root)));
    assert(protectedRoots.includes(path.join(path.resolve(root), 'context-poc', 'v1', 'dsh-home')));
    assert.equal(marked, 1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('registry live root 拒绝 .dsh、userData 与 managed dsh-home 的任何祖先', () => {
    const fixtureRoot = path.join(os.tmpdir(), 'whaledock-main-protected-ancestor');
    const userData = path.join(fixtureRoot, 'user-data');
    const managedHome = path.join(userData, 'context-poc', 'v1', 'dsh-home');
    const registeredFolder = path.join(fixtureRoot, 'registered-link', 'project');
    const projectId = `proj_${'6'.repeat(32)}`;
    const project = { id: projectId, kind: 'user', boundSession: null };
    const store = {
      filePath: path.join(userData, 'projects', 'registry.json'),
      get: (id) => id === projectId ? project : null,
      folderOf: (id) => {
        assert.equal(id, projectId);
        return registeredFolder;
      }
    };
    const cases = [
      { label: '.dsh', root: path.join(os.homedir(), '.dsh'), ancestor: os.homedir() },
      { label: 'userData', root: userData, ancestor: path.dirname(userData) },
      { label: 'managed dsh-home', root: managedHome, ancestor: path.dirname(managedHome) }
    ];
    for (const entry of cases) {
      const realpathSync = (value) => (
        path.resolve(value) === path.resolve(registeredFolder)
          ? path.resolve(entry.ancestor)
          : path.resolve(value)
      );
      realpathSync.native = realpathSync;
      assert.throws(() => main.canonicalRegistryProjectFolder(projectId, {
        projectStore: store,
        userData,
        forbiddenRoots: [entry.root],
        fsImpl: {
          statSync: () => ({ isDirectory: () => true }),
          realpathSync
        }
      }), (error) => Boolean(error && error.code === 'ERR_PROJECT_PROTECTED'), entry.label);
    }
  });

  await test('legacy 迁移 durable once：首次原子 seed 视频窗格，reused/已标记均不复活', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-migration-'));
    try {
      const packages = builtinPackages();
      const folder = path.join(tmp, 'legacy-video');
      const userData = path.join(tmp, 'user-data');
      fs.mkdirSync(folder);
      const legacy = {
        workdir: folder,
        workbenchId: 'builtin:短视频创作台',
        projectMigrationVersion: 0
      };
      const before = JSON.stringify(legacy);
      let marked = 0;
      let store = main.initializeProjectRegistry(userData, {
        configSnapshot: legacy,
        packages,
        markMigrated: () => { marked += 1; },
        logger: () => {}
      });
      const migrated = store.findByFolder(folder);
      assert(migrated);
      assert.equal(migrated.templateId, 'builtin:短视频创作台');
      assert.equal(migrated.paneState.windows.some((window) => window.tabs.some((tab) => (
        tab.type === 'video-template' && tab.templateId === migrated.templateId
      ))), true, '短视频类型必须真实实例化为窗格');
      assert.equal(marked, 1);
      assert.equal(JSON.stringify(legacy), before, '迁移不能改旧 config 快照');

      let migrateCalls = 0;
      store = main.initializeProjectRegistry(userData, {
        configSnapshot: { ...legacy, projectMigrationVersion: 1 },
        migrate: () => { migrateCalls += 1; throw new Error('不得再迁移'); },
        markMigrated: () => { marked += 1; },
        logger: () => {}
      });
      assert.equal(migrateCalls, 0);
      assert.equal(marked, 1, '已标记时不重复写 marker');

      const reusedData = path.join(tmp, 'reused-data');
      const reusedFolder = path.join(tmp, 'reused-folder');
      fs.mkdirSync(reusedFolder);
      const initial = projects.createProjectStore({ baseDir: reusedData, forbiddenRoots: [] });
      const customPane = layout.createPaneState('grid-four');
      const existing = initial.create({
        folder: reusedFolder,
        templateId: 'builtin:短视频创作台',
        layoutPreset: customPane.preset,
        paneState: customPane
      });
      const exactPane = JSON.stringify(existing.paneState);
      let reusedMarked = 0;
      const reopened = main.initializeProjectRegistry(reusedData, {
        configSnapshot: {
          workdir: reusedFolder,
          workbenchId: 'builtin:短视频创作台',
          projectMigrationVersion: 0
        },
        packages,
        markMigrated: () => { reusedMarked += 1; },
        logger: () => {}
      });
      assert.equal(JSON.stringify(reopened.get(existing.id).paneState), exactPane,
        '普通 reused 项目不能被补回 video tab');
      assert.equal(reusedMarked, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('legacy seed/registry 失败不写 marker、不产生半项目，日志只含安全码', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-migration-fail-'));
    try {
      const folder = path.join(tmp, 'legacy-folder');
      fs.mkdirSync(folder);
      let marked = 0;
      const logs = [];
      const store = main.initializeProjectRegistry(path.join(tmp, 'user-data'), {
        configSnapshot: {
          workdir: folder,
          workbenchId: 'builtin:短视频创作台',
          projectMigrationVersion: 0
        },
        seedMigrationPaneState: () => {
          const error = new Error(`seed failed at ${folder}`);
          error.code = 'ERR_PROJECT_TEMPLATE_LAYOUT';
          throw error;
        },
        markMigrated: () => { marked += 1; },
        logger: (scope, message) => logs.push({ scope, message })
      });
      assert.equal(store.findByFolder(folder), null);
      assert.equal(marked, 0);
      assert.equal(logs.some((entry) => entry.message === (
        'legacy migration failed code=ERR_PROJECT_TEMPLATE_LAYOUT'
      )), true);
      assert.equal(JSON.stringify(logs).includes(folder), false);
      assert.equal(fs.existsSync(store.filePath), true, '控制室本身仍可正常落库');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('模板创建先预检、直落项目根且只补缺失，并原子登记 video-template 窗格', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-template-create-'));
    try {
      const packages = builtinPackages();
      const folder = path.join(tmp, 'project');
      fs.mkdirSync(path.join(folder, '01_选题库'), { recursive: true });
      const sentinel = path.join(folder, '01_选题库', '说明.md');
      fs.writeFileSync(sentinel, '用户原文，不能覆盖\n');
      const store = projects.createProjectStore({
        baseDir: path.join(tmp, 'user-data'), forbiddenRoots: []
      });
      store.ensureConsole();
      const created = main.createProjectAtFolder({
        name: '短视频项目', icon: '🎬', templateId: 'builtin:短视频创作台'
      }, folder, { projectStore: store, packages });
      assert.equal(created.templateId, 'builtin:短视频创作台');
      assert.equal(created.paneState.windows.some((window) => window.tabs.some((tab) => (
        tab.type === 'video-template' && tab.templateId === created.templateId
      ))), true);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), '用户原文，不能覆盖\n');
      assert.equal(fs.existsSync(path.join(folder, '02_脚本', '说明.md')), true);
      assert.equal(fs.existsSync(path.join(folder, '短视频创作台')), false,
        '不能额外套 template root');

      const unknown = path.join(tmp, 'unknown');
      fs.mkdirSync(unknown);
      assert.throws(() => main.createProjectAtFolder({
        templateId: 'builtin:不存在'
      }, unknown, { projectStore: store, packages }), (error) => (
        error && error.code === 'ERR_PROJECT_TEMPLATE_NOT_FOUND'
      ));
      assert.deepEqual(fs.readdirSync(unknown), [], '未知模板不能留下任何文件');

      let resolved = 0;
      for (const [storeFixture, code] of [
        [{
          findByFolder: () => ({ id: `proj_${'d'.repeat(32)}` }),
          list: () => []
        }, 'ERR_PROJECT_DUPLICATE_FOLDER'],
        [{
          findByFolder: () => {
            const error = new Error('protected');
            error.code = 'ERR_PROJECT_PROTECTED';
            throw error;
          },
          list: () => []
        }, 'ERR_PROJECT_PROTECTED']
      ]) {
        assert.throws(() => main.createProjectAtFolder({
          templateId: 'builtin:短视频创作台'
        }, unknown, {
          projectStore: storeFixture,
          resolveTemplate: () => { resolved += 1; }
        }), (error) => error && error.code === code);
      }
      assert.equal(resolved, 0, 'duplicate/protected 必须在模板解析前拦截');

      assert.throws(() => main.createProjectAtFolder({
        templateId: 'builtin:短视频创作台'
      }, unknown, {
        projectStore: {
          findByFolder: () => null,
          list: () => Array.from({ length: 127 }, (_, index) => ({
            id: `proj_${index.toString(16).padStart(32, '0')}`, kind: 'user'
          }))
        },
        maxProjects: 128,
        resolveTemplate: () => { resolved += 1; }
      }), (error) => error && error.code === 'ERR_PROJECT_LIMIT');
      assert.equal(resolved, 0, '项目上限必须在解析/落地模板前拦截');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('模板已落地而 registry 失败给可恢复内部回执，绝不删除用户文件或泄路径', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-template-pending-'));
    try {
      const folder = path.join(tmp, 'project');
      fs.mkdirSync(folder);
      const packages = builtinPackages();
      let error = null;
      try {
        main.createProjectAtFolder({ templateId: 'builtin:短视频创作台' }, folder, {
          projectStore: {
            findByFolder: () => null,
            list: () => [],
            create: () => {
              const failed = new Error(`registry failed ${folder}`);
              failed.code = 'ERR_PROJECT_RUNTIME';
              throw failed;
            }
          },
          packages
        });
      } catch (caught) { error = caught; }
      assert(error);
      assert.equal(error.code, 'ERR_PROJECT_REGISTRY_AFTER_TEMPLATE');
      assert.deepEqual(Object.keys(error.recovery), [
        'kind', 'templateId', 'createdCount', 'keptCount'
      ]);
      assert(error.recovery.createdCount > 0);
      assert.equal(JSON.stringify(error.recovery).includes(folder), false);
      assert.equal(fs.existsSync(path.join(folder, '02_脚本', '说明.md')), true,
        'registry 失败不能猜测性删除已落地用户文件');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('模板 action/catalog 每次从受管包投影且公开面精确无包路径', () => {
    const packages = builtinPackages();
    const video = videoPackage();
    const actions = main.projectTemplateActionsFor(video.id, { packages });
    assert.equal(actions.length, 5);
    for (const action of actions) {
      assert.deepEqual(Object.keys(action), ['id', 'label', 'hint', 'confirm', 'prompt']);
    }
    const catalog = main.projectTemplateCatalog({ listed: { packages } });
    assert.equal(catalog.some((entry) => entry.id === video.id), true);
    for (const entry of catalog) {
      assert.deepEqual(Object.keys(entry), ['id', 'label', 'hint']);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'prompt'), false);
    }
    const publicText = JSON.stringify({ actions, catalog });
    assert.equal(publicText.includes(path.join(__dirname, '..', 'assets')), false);
    assert.equal(publicText.includes('"dir"'), false);
  });

  await test('页级快捷命令绑定产生时 Host/controller/page/revision，后台页不能抢占且精确清除', () => {
    const rows = [
      { id: `proj_${'a'.repeat(32)}`, kind: 'user', name: '甲', icon: '🧱', hidden: false },
      { id: `proj_${'b'.repeat(32)}`, kind: 'user', name: '乙', icon: '🧭', hidden: false },
      { id: projects.CONSOLE_PROJECT_ID, kind: 'builtin', name: '控制室', icon: '🖥️', hidden: false }
    ];
    const store = {
      get: (id) => rows.find((item) => item.id === id) || null,
      list: () => rows.slice()
    };
    const binding = {
      hostInstanceId: 'host-shortcut-0001',
      controllerId: 'controller-shortcut-0001',
      pageInstanceId: 'page-shortcut-0001',
      selectionRevision: 4
    };
    main.clearProjectSwitchCommand();
    const first = main.queueProjectSwitchCommand(rows[0].id, {
      projectStore: store, binding, now: () => 1000, refresh: false
    });
    assert.deepEqual(first, { seq: first.seq, projectId: rows[0].id });
    for (const wrong of [
      { ...binding, hostInstanceId: 'host-shortcut-0002' },
      { ...binding, controllerId: 'controller-shortcut-0002' },
      { ...binding, pageInstanceId: 'page-shortcut-0002' },
      { ...binding, selectionRevision: 5 }
    ]) {
      assert.equal(main.readProjectSwitchCommand(wrong, {
        projectStore: store, now: () => 1001
      }), null);
    }
    assert.deepEqual(main.readProjectSwitchCommand(binding, {
      projectStore: store, now: () => 1002
    }), first, '错误页读取不能 claim/清除前台命令');

    const second = main.queueProjectSwitchCommand(rows[0].id, {
      projectStore: store, binding, now: () => 1003, refresh: false
    });
    assert(second.seq > first.seq);
    assert.equal(main.clearProjectSwitchCommand(rows[0].id, first.seq), false,
      '旧 open 完成不能清掉更晚快捷命令');
    assert.deepEqual(main.readProjectSwitchCommand(binding, {
      projectStore: store, now: () => 1004
    }), second);
    assert.equal(main.readProjectSwitchCommand(binding, {
      projectStore: store, now: () => 1003 + main.PROJECT_SWITCH_COMMAND_TTL_MS
    }), null, 'TTL 到点必须失效且清除');
    assert.equal(main.queueProjectSwitchCommand(projects.CONSOLE_PROJECT_ID, {
      projectStore: store, binding, now: () => 2000, refresh: false
    }), null);
    rows[1].hidden = true;
    assert.equal(main.queueProjectSwitchCommand(rows[1].id, {
      projectStore: store, binding, now: () => 2000, refresh: false
    }), null);
    assert.deepEqual(main.projectShortcutRows({ projectStore: store }), [{
      index: 1, projectId: rows[0].id, name: '甲', icon: '🧱'
    }]);
    const menu = main.projectMenuTemplate({
      rows: main.projectShortcutRows({ projectStore: store })
    });
    assert.equal(menu[0].accelerator, 'CommandOrControl+Shift+1');
    assert.equal(main.PROJECT_SWITCH_COMMAND_TTL_MS, 9000);
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const queueBlock = source.slice(
      source.indexOf('function queueProjectSwitchCommand('),
      source.indexOf('function readProjectSwitchCommand(')
    );
    assert(!/restartBackend|touchOpened|ackSession|executeJavaScript/.test(queueBlock),
      '快捷键 main 只排内存命令，不重启后端、不 touch/ack/DOM 注入');
    main.clearProjectSwitchCommand();
  });

  await test('普通与锁定产物预览从 main-only 根安全读取，fingerprint 不符/敏感路径不下发', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-preview-'));
    try {
      const folder = path.join(tmp, 'project');
      fs.mkdirSync(path.join(folder, 'drafts'), { recursive: true });
      fs.mkdirSync(path.join(folder, 'output'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'drafts', 'current.md'),
        '# 标题\n<script>alert(1)</script>\n');
      fs.writeFileSync(path.join(folder, 'output', 'result.txt'), '最终结果\n');
      fs.writeFileSync(path.join(folder, 'widget-result.json'), JSON.stringify({
        window: 2, path: 'output/result.txt', kind: 'text'
      }));
      const store = projects.createProjectStore({
        baseDir: path.join(tmp, 'user-data'), forbiddenRoots: []
      });
      const pane = JSON.parse(JSON.stringify(layout.createPaneState('split-two')));
      pane.windows[0].tabs = [{
        id: 'draft', type: 'markdown', title: '草稿', path: 'drafts/current.md'
      }];
      pane.windows[0].active = 'draft';
      const created = store.create({
        folder, layoutPreset: pane.preset, paneState: pane
      });
      const verified = artifacts.readProjectArtifact(folder);
      const withArtifact = JSON.parse(JSON.stringify(pane));
      withArtifact.windows[1] = layout.lockArtifact(
        withArtifact.windows[1], verified.descriptor
      );
      store.update(created.id, { paneState: withArtifact });
      const previews = main.projectPanePreviews(store.get(created.id), { projectStore: store });
      assert.equal(previews.length, 2);
      assert.deepEqual(previews[0], {
        window: 1,
        tabId: 'draft',
        preview: {
          kind: 'markdown', text: '# 标题\n<script>alert(1)</script>\n', truncated: false
        }
      });
      assert.equal(previews[1].preview.kind, 'text');
      const serialized = JSON.stringify(previews);
      assert.equal(serialized.includes(folder), false);
      assert.equal(serialized.includes('absolutePath'), false);

      fs.writeFileSync(path.join(folder, 'output', 'result.txt'), '已替换\n');
      const afterReplace = main.projectPanePreviews(store.get(created.id), { projectStore: store });
      assert.equal(afterReplace.some((entry) => entry.tabId.startsWith('artifact-')), false,
        '持久 descriptor fingerprint 与回读不一致时产物预览必须消失');

      const sensitive = JSON.parse(JSON.stringify(layout.createPaneState('split-two')));
      sensitive.windows[0].tabs = [{
        id: 'secret', type: 'text', title: '秘密', path: 'secrets/token.txt'
      }];
      sensitive.windows[0].active = 'secret';
      fs.mkdirSync(path.join(folder, 'secrets'));
      fs.writeFileSync(path.join(folder, 'secrets', 'token.txt'), 'do-not-return');
      store.update(created.id, { paneState: sensitive });
      assert.deepEqual(main.projectPanePreviews(store.get(created.id), {
        projectStore: store
      }), []);

      const png = Buffer.alloc(24);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
      png.writeUInt32BE(13, 8);
      png.write('IHDR', 12, 'ascii');
      png.writeUInt32BE(40, 16);
      png.writeUInt32BE(20, 20);
      const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
      const image = main.projectImagePreview(png, {
        nativeImageImpl: {
          createFromBuffer: () => ({
            isEmpty: () => false,
            getSize: () => ({ width: 40, height: 20 }),
            resize: ({ width, height }) => ({
              getSize: () => ({ width, height }),
              toJPEG: () => jpeg
            })
          })
        }
      });
      assert.deepEqual(image, {
        kind: 'image',
        dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        width: 40,
        height: 20
      });
      assert(Buffer.byteLength(image.dataUrl) < main.PROJECT_PANE_PREVIEW_TOTAL_BYTES);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('经典驾驶舱降级为 Settings-only 固定入口，项目工作台占用 1–9', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload-settings.js'), 'utf8');
    const settings = fs.readFileSync(path.join(__dirname, '..', 'settings.html'), 'utf8');
    const shellHtml = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
    const shellJs = fs.readFileSync(path.join(__dirname, '..', 'shell.js'), 'utf8');
    assert(settings.includes('经典驾驶舱（旧）'));
    assert(settings.includes('id="open-classic-cockpit"'));
    assert(settings.includes('id="return-project-workbench"'));
    assert(preload.includes("ipcRenderer.invoke('settings:open-classic-cockpit')"));
    assert(preload.includes("ipcRenderer.invoke('settings:return-project-workbench')"));
    assert(mainSource.includes("'settings:open-classic-cockpit'"));
    assert(mainSource.includes("'settings:return-project-workbench'"));
    assert(mainSource.includes('if (args.length !== 0)'));
    assert(mainSource.includes('showApp();'));
    const trayBody = mainSource.slice(
      mainSource.indexOf('function trayMenuTemplate()'),
      mainSource.indexOf('function refreshTrayMenu()')
    );
    const appBody = mainSource.slice(
      mainSource.indexOf('function createAppMenu()'),
      mainSource.indexOf("app.on('window-all-closed'")
    );
    assert(!trayBody.includes("label: '经典驾驶舱（旧）'"));
    assert(!appBody.includes("label: '经典驾驶舱（旧）'"));
    assert(appBody.includes("label: '项目'"));
    assert(!mainSource.includes("accelerator: 'CommandOrControl+Shift+0'"));
    assert(shellHtml.includes('body:not(.classic-mode) #rail { display:none; }'));
    assert(shellJs.includes("classList.toggle('classic-mode', state.classicMode === true)"));
    assert.deepEqual(main.mainViewLayout({ width: 1000, height: 700 }), {
      mode: 'projects', visible: true, bounds: { x: 0, y: 0, width: 1000, height: 700 }
    });
    assert.equal(main.enterClassicCockpit({ refresh: false }).mode, 'classic');
    assert.equal(main.returnToProjectWorkbench({ refresh: false }).mode, 'projects');
  });

  await test('session root HMAC 与 Host 精确同根，A→B 同步旋转 runtime/context 代际', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-active-root-'));
    try {
      const userData = path.join(tmp, 'user-data');
      const folderA = path.join(tmp, 'project-a');
      const folderB = path.join(tmp, 'project-b');
      const folderPlain = path.join(tmp, 'project-plain');
      fs.mkdirSync(folderA);
      fs.mkdirSync(folderB);
      fs.mkdirSync(folderPlain);
      const packages = builtinPackages();
      const store = main.initializeProjectRegistry(userData, {
        configSnapshot: { workdir: null, workbenchId: null, projectMigrationVersion: 1 },
        packages,
        logger: () => {}
      });
      const projectA = main.createProjectAtFolder({
        name: '项目 A', templateId: 'builtin:短视频创作台'
      }, folderA, { projectStore: store, packages });
      const projectB = main.createProjectAtFolder({
        name: '项目 B', templateId: 'builtin:短视频创作台'
      }, folderB, { projectStore: store, packages });
      const projectPlain = store.create({ name: '无模板项目', folder: folderPlain });
      store.bindSession(projectA.id, `session-binding-${'a'.repeat(64)}`);
      store.bindSession(projectB.id, `session-binding-${'b'.repeat(64)}`);
      store.bindSession(projectPlain.id, `session-binding-${'c'.repeat(64)}`);

      main.returnToProjectWorkbench({ refresh: false });
      main.clearActiveRegistryProject();
      assert.equal(main.videoWorkspaceRoot(), null,
        '未成功 commit 时不能借用旧 config.workdir');
      assert.equal(main.currentContextPocWorkspaceIdentity(), null);

      const secret = 'ab'.repeat(32);
      const hostInstanceId = 'host-project-root-0001';
      const backendState = { contextBridgeAuthToken: secret, exited: false };
      const runtime = {
        backendState,
        handshake: { hostInstanceId },
        pageBinding: {
          controllerId: 'controller-bootstrap-main1',
          pageInstanceId: 'page-bootstrap-main0001',
          selectionRevision: 9
        }
      };
      const mainProof = main.contextPocProjectSessionRootRef(runtime, projectA.id);
      const hostProof = projectRootRef.sessionRootRef(
        secret, hostInstanceId, fs.realpathSync(folderA)
      );
      assert.equal(mainProof, hostProof);
      assert.equal(JSON.stringify({ mainProof }).includes(folderA), false);
      const openToken = `project-open-${'d'.repeat(64)}`;
      const ticket = main.contextPocProjectBootstrapTicket({
        projectId: projectA.id,
        openToken,
        binding: {
          hostInstanceId,
          controllerId: runtime.pageBinding.controllerId,
          pageInstanceId: runtime.pageBinding.pageInstanceId,
          selectionRevision: runtime.pageBinding.selectionRevision
        }
      }, {
        runtime,
        projectStore: store,
        now: () => 1234,
        randomBytes: (size) => Buffer.alloc(size, size)
      });
      assert.match(ticket, projectBootstrapTicket.TICKET_RE);
      assert.equal(ticket.includes(folderA), false, 'bootstrap ticket 不得明文泄露注册表根');
      const openedTicket = projectBootstrapTicket.openProjectBootstrapTicket(ticket, {
        secret,
        hostInstanceId,
        controllerId: runtime.pageBinding.controllerId,
        pageInstanceId: runtime.pageBinding.pageInstanceId,
        selectionRevision: runtime.pageBinding.selectionRevision,
        projectId: projectA.id,
        openToken
      }, { now: () => 1234 });
      assert.equal(openedTicket.root, fs.realpathSync(folderA));

      let wakes = 0;
      const wakeBridge = () => { wakes += 1; return false; };
      const openedA = main.activateOpenedRegistryProject(projectA.id, { wakeBridge });
      const locationA = main.videoWorkspaceLocation();
      const snapshotA = main.currentVideoWorkspaceSnapshot();
      const identityA = main.currentContextPocWorkspaceIdentity();
      const contextA = main.currentContextPocProject(identityA);
      assert.equal(locationA.root, fs.realpathSync(folderA));
      assert.equal(locationA.generation, openedA.generation);
      assert.equal(snapshotA.status, 'ready');
      assert.equal(snapshotA.generation, openedA.generation);
      assert.equal(identityA.workspaceKey, locationA.root);
      assert.equal(identityA.workspaceGeneration, openedA.generation);
      assert(contextA);
      const tokensA = snapshotA.projects.map((item) => item.projectToken);
      assert(tokensA.length > 0, '模板 seed 文件必须由 A runtime 真实扫描');
      assert(snapshotA.projects.some((item) => item.actions.length > 0),
        '项目 runtime 必须使用 registry video template 动作，不借 config');
      assert.equal(wakes, 1);

      const rootProofB = main.contextPocProjectSessionRootRef(runtime, projectB.id);
      assert.equal(main.activeRegistryProjectBindingMatches(runtime, {
        state: 'selected',
        currentBindingRef: `session-binding-${'a'.repeat(64)}`,
        sessionRootRef: mainProof
      }), true);
      runtime.resumeEffects = [{ type: 'context-stage', envelope: { stale: true } }];
      const closedForB = main.reconcileActiveRegistryProjectBinding(runtime, {
        state: 'selected',
        currentBindingRef: `session-binding-${'b'.repeat(64)}`,
        sessionRootRef: rootProofB
      });
      assert.deepEqual(closedForB, { closed: true, code: 'workspace-mismatch' });
      assert.deepEqual(runtime.resumeEffects, [], '切换会话必须丢弃 A 的待重放 stage');
      assert.equal(main.videoWorkspaceRoot(), null, '选择 B 后必须自动关闭 active A');
      assert.deepEqual(main.reconcileActiveRegistryProjectBinding(runtime, {
        state: 'selected',
        currentBindingRef: `session-binding-${'a'.repeat(64)}`,
        sessionRootRef: mainProof
      }), { closed: false, code: null });
      assert.equal(main.videoWorkspaceRoot(), null,
        'B→A 不得自动复活，必须 fresh projects.open commit');

      const openedB = main.activateOpenedRegistryProject(projectB.id, { wakeBridge });
      const locationB = main.videoWorkspaceLocation();
      const snapshotB = main.currentVideoWorkspaceSnapshot();
      const identityB = main.currentContextPocWorkspaceIdentity();
      const contextB = main.currentContextPocProject(identityB);
      assert.equal(locationB.root, fs.realpathSync(folderB));
      assert.equal(locationB.generation, openedB.generation);
      assert(openedB.generation > openedA.generation);
      assert.equal(snapshotB.status, 'ready');
      assert.equal(snapshotB.generation, openedB.generation);
      assert.equal(identityB.workspaceKey, locationB.root);
      assert.notEqual(contextB.projectRevision, contextA.projectRevision);
      assert(tokensA.every((token) => (
        !snapshotB.projects.some((item) => item.projectToken === token)
      )), 'A 的 token 不能在 B runtime 重放');
      assert.throws(() => main.videoDocumentSurface(tokensA[0]), /过期/);
      assert.equal(wakes, 2);

      main.activateOpenedRegistryProject(projectPlain.id, { wakeBridge });
      assert.equal(main.videoWorkspaceRoot(), null,
        '无模板 registry 项目不能借旧 config 启动 video runtime');
      const plainIdentity = main.currentContextPocWorkspaceIdentity({
        // 显式注入一个旧 config video 工作台，证明 registry 无模板
        // 分支不会把它借进项目 context。
        currentWorkbench: videoPackage(),
        packages
      });
      const plainContext = main.currentContextPocProject(plainIdentity);
      assert.equal(plainIdentity.registryMode, true);
      assert.equal(plainIdentity.workbench, null);
      assert.equal(plainContext.workbenchId, null);
      assert.match(plainContext.title, /默认工作台$/);
      assert.equal(wakes, 3);

      assert.throws(() => main.activateOpenedRegistryProject(projectA.id, {
        startMonitor: () => ({ status: 'error' }),
        wakeBridge
      }), (error) => error && error.code === 'ERR_PROJECT_VIDEO_RUNTIME');
      assert.equal(main.videoWorkspaceRoot(), null,
        '新根 runtime 启动失败时不得沿用 B');
      assert.equal(main.currentContextPocWorkspaceIdentity(), null);
      assert.equal(wakes, 3, '新 runtime 失败时不得进入 restage');

      const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
      const activationBody = source.slice(
        source.indexOf('function activateOpenedRegistryProject('),
        source.indexOf('function videoProjectActions(')
      );
      assert(!/config\.set|restartBackend|startWorkspaceBackend/.test(activationBody),
        '项目根旋转不能改旧 config 或重启 backend');
    } finally {
      main.clearActiveRegistryProject();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('open outcome-unknown hook 只清理同 id active root 并立即刷新外壳', () => {
    const failedId = `proj_${'6'.repeat(32)}`;
    const otherId = `proj_${'5'.repeat(32)}`;
    const calls = [];
    const supplied = {
      clearActive: () => { calls.push('clear'); return true; },
      pushState: () => { calls.push('push'); }
    };
    assert.equal(main.handleProjectOpenOutcomeUnknown(failedId, new Error('late'), {
      ...supplied,
      activeProjectId: otherId
    }), false);
    assert.deepEqual(calls, [], '后台/已切换的其他项目不得被清理');
    assert.equal(main.handleProjectOpenOutcomeUnknown(failedId, new Error('late'), {
      ...supplied,
      activeProjectId: failedId
    }), true);
    assert.deepEqual(calls, ['clear', 'push']);

    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const adapter = source.slice(
      source.indexOf('const contextPocProjectOperations ='),
      source.indexOf('function contextPocWorkspaceFileBroker(')
    );
    assert.match(adapter,
      /onProjectOpenOutcomeUnknown:\s*handleProjectOpenOutcomeUnknown/,
      'main project-ops adapter 必须真实接线清理钩子');
  });

  await test('done 产物双回读 fingerprint 后只追加目标窗、锁定并幂等持久化', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-artifact-'));
    try {
      const userData = path.join(tmp, 'userData');
      const folder = path.join(tmp, 'project');
      fs.mkdirSync(path.join(folder, 'output'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'output', 'result.md'), '# 完成\n');
      fs.writeFileSync(path.join(folder, 'widget-result.json'), JSON.stringify({
        window: 4, path: 'output/result.md', kind: 'markdown'
      }));
      const store = projects.createProjectStore({ baseDir: userData, forbiddenRoots: [] });
      const created = store.create({ folder, layoutPreset: 'split-two', paneState: null });
      store.bindSession(created.id, `session-binding-${'a'.repeat(64)}`);
      const first = await main.scanCompletedProjectArtifact(created.id, { projectStore: store });
      assert.equal(first.state, 'locked');
      const persisted = store.get(created.id);
      assert.deepEqual(persisted.paneState.windows.map((item) => item.window), [1, 2, 3, 4]);
      const locked = persisted.paneState.windows[3];
      assert.equal(locked.tabs.length, 1);
      assert.equal(locked.tabs[0].type, 'artifact');
      assert.equal(locked.tabs[0].descriptor.path, 'output/result.md');
      assert.equal(Object.prototype.hasOwnProperty.call(
        locked.tabs[0].descriptor, 'absolutePath'
      ), false);
      assert.match(locked.tabs[0].descriptor.fingerprint.sha256, /^[a-f0-9]{64}$/);
      const revision = store.revision;
      const duplicate = await main.scanCompletedProjectArtifact(created.id, { projectStore: store });
      assert.equal(duplicate.state, 'duplicate');
      assert.equal(store.revision, revision, '同 fingerprint 不重复持久化');

      const beforeFailure = JSON.stringify(store.get(created.id).paneState);
      fs.writeFileSync(path.join(folder, 'widget-result.json'), JSON.stringify({
        window: 1, path: '../escape.md', kind: 'markdown'
      }));
      const logs = [];
      const failed = await main.scanCompletedProjectArtifact(created.id, {
        projectStore: store,
        logger: (scope, message) => logs.push({ scope, message })
      });
      assert.equal(failed.state, 'failed');
      assert.equal(JSON.stringify(store.get(created.id).paneState), beforeFailure);
      assert.equal(logs.length, 1);
      assert(!logs[0].message.includes(folder));
      assert(!logs[0].message.includes('../escape.md'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('fingerprint 回读不一致 fail-closed 且不写布局', async () => {
    const folder = path.join(os.tmpdir(), 'whaledock-fingerprint-project');
    const realpathSync = (value) => path.resolve(value);
    realpathSync.native = realpathSync;
    const base = {
      internal: { absolutePath: path.join(os.tmpdir(), 'result.md') },
      descriptor: {
        window: 1, path: 'result.md', kind: 'markdown',
        fingerprint: { size: 1, mtime: 1, sha256: 'a'.repeat(64) }
      }
    };
    const calls = { update: 0, read: 0 };
    const store = {
      get: () => ({
        id: `proj_${'b'.repeat(32)}`, kind: 'user',
        boundSession: `session-binding-${'b'.repeat(64)}`,
        layoutPreset: 'split-two', paneState: null
      }),
      folderOf: () => folder,
      update: () => { calls.update += 1; }
    };
    const logs = [];
    const result = await main.scanCompletedProjectArtifact(`proj_${'b'.repeat(32)}`, {
      projectStore: store,
      readArtifact: () => {
        calls.read += 1;
        return calls.read === 1 ? base : {
          ...base,
          descriptor: {
            ...base.descriptor,
            fingerprint: { ...base.descriptor.fingerprint, sha256: 'c'.repeat(64) }
          }
        };
      },
      userData: path.join(os.tmpdir(), 'whaledock-fingerprint-user-data'),
      fsImpl: {
        statSync: () => ({ isDirectory: () => true }),
        realpathSync
      },
      logger: (_scope, message) => logs.push(message)
    });
    assert.equal(result.state, 'failed');
    assert.equal(result.code, 'ERR_PROJECT_ARTIFACT_CHANGED');
    assert.equal(calls.read, 2);
    assert.equal(calls.update, 0);
    assert.equal(logs.length, 1);
  });

  await test('产物每次读前重验 registry 根，祖先链接漂入 .dsh/userData/managed home 均关闭', async () => {
    const fixtureRoot = path.join(os.tmpdir(), 'whaledock-artifact-root-drift');
    const userData = path.join(fixtureRoot, 'user-data');
    const registeredFolder = path.join(fixtureRoot, 'link-parent', 'project');
    const projectId = `proj_${'7'.repeat(32)}`;
    const paneState = JSON.parse(JSON.stringify(layout.createPaneState('split-two')));
    paneState.windows[0].tabs = [
      { id: 'one', type: 'markdown', title: '一', path: 'one.md' },
      { id: 'two', type: 'markdown', title: '二', path: 'two.md' }
    ];
    paneState.windows[0].active = 'one';
    const project = {
      id: projectId,
      kind: 'user',
      boundSession: `session-binding-${'7'.repeat(64)}`,
      layoutPreset: 'split-two',
      paneState
    };
    const store = {
      filePath: path.join(userData, 'projects', 'registry.json'),
      get: (id) => id === projectId ? project : null,
      folderOf: (id) => {
        assert.equal(id, projectId);
        return registeredFolder;
      },
      update: () => { throw new Error('受保护根不得写布局'); }
    };
    const fakeFsFor = (resolveRegistered) => {
      const realpathSync = (value) => (
        path.resolve(value) === path.resolve(registeredFolder)
          ? resolveRegistered()
          : path.resolve(value)
      );
      realpathSync.native = realpathSync;
      return {
        statSync: () => ({ isDirectory: () => true }),
        realpathSync
      };
    };
    const protectedTargets = [
      path.join(os.homedir(), '.dsh', 'project'),
      path.join(userData, 'project'),
      path.join(userData, 'context-poc', 'v1', 'dsh-home', 'project')
    ];
    for (const protectedTarget of protectedTargets) {
      let artifactReads = 0;
      const fsImpl = fakeFsFor(() => protectedTarget);
      const scanned = await main.scanCompletedProjectArtifact(projectId, {
        projectStore: store,
        userData,
        fsImpl,
        readArtifact: () => { artifactReads += 1; throw new Error('不得读产物'); },
        logger: () => {}
      });
      assert.equal(scanned.state, 'failed');
      assert.equal(scanned.code, 'ERR_PROJECT_PROTECTED');
      assert.equal(artifactReads, 0, '必须在 project-artifacts reader 之前拦截');

      let previewReads = 0;
      assert.deepEqual(main.projectPanePreviews(project, {
        projectStore: store,
        userData,
        fsImpl,
        readFile: () => { previewReads += 1; throw new Error('不得读预览'); }
      }), []);
      assert.equal(previewReads, 0);
    }

    // 第一读仍安全、第二读前祖先才漂移：证明不是每轮只验一次。
    let resolutions = 0;
    let artifactReads = 0;
    const driftFs = fakeFsFor(() => {
      resolutions += 1;
      return resolutions === 1
        ? registeredFolder
        : path.join(userData, 'context-poc', 'v1', 'dsh-home', 'project');
    });
    const rawArtifact = {
      internal: { absolutePath: path.join(registeredFolder, 'result.md') },
      descriptor: {
        window: 1, path: 'result.md', kind: 'markdown',
        fingerprint: { size: 1, mtime: 1, sha256: '8'.repeat(64) }
      }
    };
    const drifted = await main.scanCompletedProjectArtifact(projectId, {
      projectStore: store,
      userData,
      fsImpl: driftFs,
      readArtifact: () => { artifactReads += 1; return rawArtifact; },
      logger: () => {}
    });
    assert.equal(drifted.state, 'failed');
    assert.equal(drifted.code, 'ERR_PROJECT_PROTECTED');
    assert.equal(artifactReads, 1, '第二次 readArtifact 前必须重验');
  });

  await test('HTML 只接受本轮内存验证对象并用隔离子窗拒权限/弹窗/越界导航', async () => {
    const absolutePath = path.join(os.tmpdir(), 'result.html');
    const expectedUrl = pathToFileURL(absolutePath).href;
    assert.equal(main.projectArtifactNavigationAllowed(expectedUrl, expectedUrl), true);
    assert.equal(main.projectArtifactNavigationAllowed(
      `file://attacker${new URL(expectedUrl).pathname}`, expectedUrl
    ), false, 'UNC/remote file host 即使 pathname 相同也必须拒绝');
    assert.equal(main.projectArtifactNavigationAllowed(
      `file://localhost${new URL(expectedUrl).pathname}`, expectedUrl
    ), false, 'localhost 也不是空 local host');
    assert.equal(main.projectArtifactNavigationAllowed(`${expectedUrl}?view=1`, expectedUrl), false);
    assert.equal(main.projectArtifactNavigationAllowed(`${expectedUrl}#other`, expectedUrl), false,
      '导航 URL 必须与授权 URL 完全相同');
    const raw = {
      internal: { absolutePath },
      descriptor: {
        window: 1, path: 'result.html', kind: 'html', openMode: 'electron-child',
        fingerprint: { size: 8, mtime: 2, sha256: 'd'.repeat(64) }
      }
    };
    const verified = main.verifiedProjectArtifactReadback(raw, raw);
    let instance = null;
    class FakeWindow {
      constructor(options) {
        this.options = options;
        this.destroyed = false;
        this.shown = false;
        this.handlers = {};
        this.sessionHandlers = {};
        this.session = {
          on: (name, callback) => { this.sessionHandlers[name] = callback; },
          setPermissionRequestHandler: (callback) => { this.permissionRequest = callback; },
          setPermissionCheckHandler: (callback) => { this.permissionCheck = callback; },
          setDevicePermissionHandler: (callback) => { this.devicePermission = callback; },
          webRequest: {
            onBeforeRequest: (_filter, callback) => { this.beforeRequest = callback; }
          }
        };
        this.webContents = {
          session: this.session,
          on: (name, callback) => { this.handlers[name] = callback; },
          setWindowOpenHandler: (callback) => { this.windowOpen = callback; },
          loadURL: async (url) => { this.loaded = url; }
        };
        instance = this;
      }
      once(name, callback) { this.handlers[name] = callback; }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; }
      show() { this.shown = true; }
      focus() { this.focused = true; }
    }
    await assert.rejects(() => main.prepareProjectArtifactHtmlPreview(raw, {
      BrowserWindowClass: FakeWindow,
      randomBytes: () => Buffer.alloc(16, 1),
      parent: null
    }));
    const preview = await main.prepareProjectArtifactHtmlPreview(verified, {
      BrowserWindowClass: FakeWindow,
      randomBytes: () => Buffer.alloc(16, 2),
      parent: null
    });
    assert.equal(instance.options.webPreferences.sandbox, true);
    assert.equal(instance.options.webPreferences.contextIsolation, true);
    assert.equal(instance.options.webPreferences.nodeIntegration, false);
    assert.equal(instance.options.webPreferences.partition.startsWith('persist:'), false);
    assert.deepEqual(instance.windowOpen({ url: 'https://evil.example' }), { action: 'deny' });
    let permission = true;
    instance.permissionRequest(null, 'camera', (allowed) => { permission = allowed; });
    assert.equal(permission, false);
    assert.equal(instance.permissionCheck(), false);
    let prevented = false;
    instance.handlers['will-navigate']({ preventDefault: () => { prevented = true; } }, 'https://evil.example');
    assert.equal(prevented, true);
    let blocked = null;
    instance.beforeRequest({ url: 'https://evil.example/a.js' }, (value) => { blocked = value; });
    assert.deepEqual(blocked, { cancel: true });
    preview.activate();
    assert.equal(instance.shown, true);
    preview.destroy();
    assert.equal(instance.destroyed, true);
  });

  await test('控制室 need 只更新托盘文案，无数据不冒充计数', () => {
    assert.equal(main.updateControlRoomNeedCount(3), true);
    assert.match(main.trayTooltipFor('waiting'), /3 处等你/);
    assert.equal(main.updateControlRoomNeedCount(3), false);
    assert.equal(main.updateControlRoomNeedCount(0), true);
    assert.doesNotMatch(main.trayTooltipFor('waiting'), /处等你/);
    assert.equal(main.updateControlRoomNeedCount(-1), false);
  });

  await test('main 在项目副作用点调用 Host root authorize，并透传 late outcome-unknown', async () => {
    const calls = [];
    const binding = {
      hostInstanceId: 'host-projects-0001',
      controllerId: 'controller-projects-0001',
      pageInstanceId: 'page-projects-0001',
      selectionRevision: 7
    };
    const internalToken = 'b'.repeat(64);
    const internalClaim = 'c'.repeat(64);
    const authorizationToken = 'd'.repeat(64);
    const broker = {
      enqueue() { return { requestToken: internalToken }; },
      read() { return [{ requestToken: internalToken, requestSeq: 1 }]; },
      claim() { return { claimed: true, claimToken: internalClaim }; },
      async execute({ context }) {
        assert.equal(typeof context.authorizeProjectRoot, 'function');
        assert.equal(await context.authorizeProjectRoot(), true);
        calls.push({ endpoint: 'broker/effect' });
        return {
          snapshot: {
            state: 'fulfilled',
            result: {
              kind: 'binding', revision: 1,
              projectId: `proj_${'a'.repeat(32)}`,
              bindingRef: `session-binding-${'e'.repeat(64)}`
            }
          }
        };
      },
      snapshot() { throw new Error('unexpected snapshot'); }
    };
    const runtime = {
      handshake: {
        hostInstanceId: binding.hostInstanceId,
        capabilities: ['workspace-files-v1']
      },
      backendState: { contextBridgeAuthToken: 'ab'.repeat(32), exited: false },
      transport: {
        async call(endpoint, payload) {
          calls.push({ endpoint, payload });
          if (endpoint === 'workspace/files/claim') {
            return {
              claimed: true, code: null, claimToken: 'f'.repeat(64), runningDeadlineMs: 9000
            };
          }
          if (endpoint === 'workspace/files/authorize') {
            return { authorized: true, code: null, authorizationToken };
          }
          if (endpoint === 'workspace/files/settle') {
            return { settled: false, code: 'outcome-unknown' };
          }
          throw new Error(`unexpected endpoint ${endpoint}`);
        }
      }
    };
    const request = globalRequest({
      operation: 'projects.bind',
      input: {
        projectId: `proj_${'a'.repeat(32)}`,
        bindingRef: `session-binding-${'e'.repeat(64)}`
      },
      sessionRootRef: `session-root-${'a'.repeat(64)}`
    });
    const coordinator = main.createContextPocWorkspaceFileCoordinator({
      broker,
      bindingFor: () => binding,
      isCurrent: () => true,
      now: () => 1500
    });
    assert.equal(await coordinator.apply(runtime, request), false);
    assert.deepEqual(calls.map((entry) => entry.endpoint), [
      'workspace/files/claim', 'workspace/files/authorize',
      'broker/effect', 'workspace/files/settle'
    ]);
    const authorizationCall = calls.find((entry) => (
      entry.endpoint === 'workspace/files/authorize'
    ));
    assert.equal(Object.prototype.hasOwnProperty.call(
      authorizationCall.payload, 'sessionRootRef'
    ), false, 'main 不把 root proof 回传为可替换参数');
    const settleCall = calls.find((entry) => entry.endpoint === 'workspace/files/settle');
    assert.equal(settleCall.payload.rootAuthorizationToken, authorizationToken);
  });

  await test('fulfilled settle 异步拒绝必须进 catch 并改发有界失败回执', async () => {
    const request = globalRequest({
      operation: 'projects.open',
      input: { phase: 'prepare', projectId: `proj_${'a'.repeat(32)}` }
    });
    const binding = {
      hostInstanceId: 'host-projects-0001',
      controllerId: request.controllerId,
      pageInstanceId: request.pageInstanceId,
      selectionRevision: request.selectionRevision
    };
    const internalToken = `file-request-${'b'.repeat(64)}`;
    const internalClaim = `file-claim-${'c'.repeat(64)}`;
    const broker = {
      enqueue() { return { requestToken: internalToken }; },
      read() { return [{ requestToken: internalToken, requestSeq: 1 }]; },
      claim() { return { claimed: true, claimToken: internalClaim }; },
      async execute() {
        return {
          snapshot: {
            state: 'fulfilled',
            result: {
              kind: 'open-prepared', project: {}, bindingRef: null,
              openToken: `project-open-${'d'.repeat(64)}`
            }
          }
        };
      },
      snapshot() { throw new Error('unexpected snapshot'); }
    };
    const run = async (rejectFallback) => {
      const settles = [];
      const runtime = {
        handshake: {
          hostInstanceId: binding.hostInstanceId,
          capabilities: ['workspace-files-v1']
        },
        transport: {
          async call(endpoint, payload) {
            if (endpoint === 'workspace/files/claim') {
              return {
                claimed: true, code: null, claimToken: 'f'.repeat(64),
                runningDeadlineMs: 9000
              };
            }
            if (endpoint === 'workspace/files/settle') {
              settles.push(payload);
              if (settles.length === 1 || rejectFallback) {
                throw new Error('transport rejected settle');
              }
              return { settled: true, code: null };
            }
            throw new Error(`unexpected endpoint ${endpoint}`);
          }
        }
      };
      const coordinator = main.createContextPocWorkspaceFileCoordinator({
        broker, bindingFor: () => binding, isCurrent: () => true, now: () => 1500
      });
      return { applied: await coordinator.apply(runtime, request), settles };
    };

    const recovered = await run(false);
    assert.equal(recovered.applied, true);
    assert.deepEqual(recovered.settles.map((item) => ({
      status: item.status, code: item.code, result: item.result
    })), [
      { status: 'fulfilled', code: null,
        result: recovered.settles[0].result },
      { status: 'rejected', code: 'operation-failed', result: null }
    ]);

    const failed = await run(true);
    assert.equal(failed.applied, false,
      '连有界 fallback 也无法送达时不得伪报成功');
    assert.equal(failed.settles.length, 2);
  });

  await test('混合读取响应允许全局项目请求且仍核对 Host', () => {
    const runtime = { handshake: { hostInstanceId: 'host-projects-0001' } };
    const value = {
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: runtime.handshake.hostInstanceId,
      requests: [globalRequest()]
    };
    assert.deepEqual(main.contextPocWorkspaceFileReadResponseValue(value, runtime), value);
    assert.equal(main.contextPocWorkspaceFileReadResponseValue({
      ...value, hostInstanceId: 'host-projects-9999'
    }, runtime), null);
  });

  console.log(`\nMAIN V0.11 PROJECTS ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
