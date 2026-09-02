'use strict';

const assert = require('assert/strict');
const { createHash, createHmac } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const projectRootRef = require('../lib/project-root-ref');
const projectBootstrapTicket = require('../lib/project-bootstrap-ticket');

let passed = 0;
const CONTRACT = 'whaledock.context-bridge/v1';
const BRIDGE_TOKEN = 'ab'.repeat(32);
const SELECTION_TOKEN = 'cd'.repeat(32);
const controllerProofs = new Map();
let registerNonceSequence = 0;

function clientImport(specifier) {
  if (specifier === 'react') return {};
  if (specifier === 'react/jsx-runtime') return {};
  throw new Error(`unexpected client import: ${specifier}`);
}

function bridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return createHmac('sha256', secret)
    .update(`${label}\0${CONTRACT}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

function rpcSession(secret, clientNonce, hostInstanceId) {
  return bridgeHmac(secret, 'rpc-session', clientNonce, hostInstanceId);
}

function deliveryTargetRef(secret, hostInstanceId, rawSessionId) {
  return `delivery-target-${createHmac('sha256', secret)
    .update(`whaledock-delivery-target-v1\0${hostInstanceId}\0${rawSessionId}`)
    .digest('hex')}`;
}

function sessionBindingRef(rawSessionId) {
  return `session-binding-${createHash('sha256')
    .update(`whaledock-session-binding/v1\0${rawSessionId}`)
    .digest('hex')}`;
}

function projectIdForCwd(cwd) {
  let normalized = cwd.replace(/\\/g, '/');
  while (normalized.length > 1 && normalized.endsWith('/')
      && !/^[A-Za-z]:\/$/.test(normalized)) normalized = normalized.slice(0, -1);
  const digest = createHash('sha256')
    .update(`whaledock-project/v1\0${normalized}\0.`)
    .digest('hex');
  return `wdp1_${digest.slice(0, 32)}`;
}

function handshakeRequest(clientNonce, secret = BRIDGE_TOKEN) {
  return {
    type: 'handshake',
    protocol: CONTRACT,
    clientNonce,
    requestProof: bridgeHmac(secret, 'handshake-request', clientNonce, '')
  };
}

function selectionRequest(value) {
  let controllerProof = controllerProofs.get(value.controllerId);
  if (!controllerProof) {
    controllerProof = (++registerNonceSequence).toString(16).padStart(64, '0');
    controllerProofs.set(value.controllerId, controllerProof);
  }
  return {
    selectionToken: SELECTION_TOKEN,
    registerNonce: (++registerNonceSequence).toString(16).padStart(32, '0'),
    issuedAtMs: Date.now(),
    controllerProof,
    ...value
  };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  context-poc-plugin: ${name}`);
  } catch (error) {
    console.error(`FAIL  context-poc-plugin: ${name}`);
    throw error;
  }
}

async function main() {
  const root = path.join(__dirname, '..');
  const sourceRoot = path.join(root, 'context-poc');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'plugin', 'package.json'), 'utf8'
  ));

  await test('静态包无生产依赖且 Host/Client/package exports 完整', async () => {
    assert.equal(manifest.name, '@whaledock/context-bridge-poc');
    assert.equal(manifest.type, 'module');
    assert.equal(manifest.private, true);
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'dependencies'), false);
    assert.equal(manifest.exports['.'], './lib/index.js');
    assert.equal(manifest.exports['./client'], './lib/client.js');
    assert.equal(manifest.exports['./package.json'], './package.json');
    assert.deepEqual(manifest.dsh.client.inject, [
      '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime'
    ]);
    const patch = fs.readFileSync(path.join(sourceRoot, 'context-bridge.patch.yml'), 'utf8');
    assert.match(patch, /id: whaledock-context-bridge-poc/);
    assert.match(patch, /name: '@whaledock\/context-bridge-poc'/);
    const layoutManifest = JSON.parse(fs.readFileSync(
      path.join(sourceRoot, 'forks', 'ui-layout', 'package.json'), 'utf8'
    ));
    const conversationManifest = JSON.parse(fs.readFileSync(
      path.join(sourceRoot, 'forks', 'ui-conversation', 'package.json'), 'utf8'
    ));
    assert.equal(layoutManifest.name, '@deepseek-ai/dsh-client-ui-layout');
    assert.equal(conversationManifest.name, '@deepseek-ai/dsh-client-ui-conversation');
    const layoutFork = fs.readFileSync(path.join(
      sourceRoot, 'forks', 'ui-layout', 'lib', 'client.js'
    ), 'utf8');
    const pluginClient = fs.readFileSync(path.join(
      sourceRoot, 'plugin', 'lib', 'client.js'
    ), 'utf8');
    const pluginHost = fs.readFileSync(path.join(
      sourceRoot, 'plugin', 'lib', 'index.js'
    ), 'utf8');
    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(layoutFork, /whaledock\.content-shell\/v1/);
    assert.match(layoutFork, /getWhaleDockShell/);
    assert.match(layoutFork, /ctx\.get\("whaledockContentShell"\)/);
    assert.doesNotMatch(layoutFork, /creatorProjects|stageCopy|whaledockShellPreferences|wd10-/,
      '上游 layout fork 只能保留窄 mount seam，不再持有鲸坞业务 UI');
    assert.match(pluginClient, /data-whaledock-layout/);
    assert.match(pluginClient, /function creatorProjects/);
    assert.match(pluginClient, /archivedSessionIds/);
    assert.doesNotMatch(pluginClient, /const STAGE_COPY = new Map/);
    const workspaceOperations = [
      'catalog.read', 'overview.read', 'document.read', 'topic.choose',
      'project.action.prepare', 'project.action.submit',
      'block.action.prepare', 'block.action.submit',
      'proposal.read', 'proposal.decide', 'proposal.undo',
      'publish.read', 'publish.create', 'publish.update',
      'review.tactics.read', 'review.solidify',
      'shoot.open', 'shoot.history.read',
      'receipts.read', 'receipts.ack', 'receipts.open',
      'projects.list', 'projects.create', 'projects.update', 'projects.remove',
      'projects.bind', 'projects.reorder', 'projects.open', 'console.read'
    ];
    const operationSet = (source, name) => {
      const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
      assert(match, `${name} missing`);
      return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
    };
    const assertOperationSet = (actual, message) => {
      assert.equal(new Set(actual).size, actual.length, `${message}: duplicate`);
      assert.deepEqual([...actual].sort(), [...workspaceOperations].sort(), message);
    };
    assertOperationSet(operationSet(pluginClient, 'WORKSPACE_FILE_OPERATIONS'), 'Client operation set');
    assertOperationSet(operationSet(pluginHost, 'WORKSPACE_FILE_OPERATIONS'), 'Host operation set');
    const legacySource = fs.readFileSync(path.join(root, 'lib', 'context-workspace-ops.js'), 'utf8');
    const projectSource = fs.readFileSync(path.join(root, 'lib', 'project-ops.js'), 'utf8');
    const legacyOperations = operationSet(
      legacySource, 'CONTEXT_POC_WORKSPACE_FILE_OPERATIONS'
    );
    const projectOperations = operationSet(projectSource, 'PROJECT_OPERATION_NAMES');
    assert.equal(legacyOperations.length, 21, 'legacy operation 必须精确21项');
    assert.equal(projectOperations.length, 8, 'project operation 必须精确8项');
    assertOperationSet([...legacyOperations, ...projectOperations],
      'Main/Host/Client 三处 operation exact set 必须同步');
    assert.match(pluginClient, /const MAX_PROJECT_DETAIL_BYTES = 24 \* 1024;/);
    assert.match(pluginHost, /const MAX_PROJECT_DETAIL_BYTES = 24 \* 1024;/,
      'projects.open Client/Host 跨层预算必须统一为24KiB');
    assert.match(projectSource, /const MAX_PROJECT_DETAIL_BYTES = 20 \* 1024;/,
      'main 内核项目详情预算必须独立卡在20KiB');
    assert.match(projectSource,
      /const MAX_PROJECT_OPEN_RESULT_BYTES = 24 \* 1024;[\s\S]*?'projects\.open':[\s\S]*?maxResultBytes: MAX_PROJECT_OPEN_RESULT_BYTES/,
      'broker projects.open result 上限必须保持24KiB');
    assert.match(mainSource, /const PROJECT_PANE_PREVIEW_TOTAL_BYTES = 8 \* 1024;/,
      '所有窗格预览合计必须卡在8KiB');
    assert.match(mainSource,
      /\.\.\.CONTEXT_POC_LEGACY_WORKSPACE_FILE_OPERATIONS,[\s\S]*\.\.\.CONTEXT_POC_PROJECT_OPERATIONS/,
      'Main combined set 必须由 legacy21 + project8 合成');
    assert.match(pluginClient, /contentRef/);
    assert.match(pluginClient, /function ReviewPanel/);
    assert.match(pluginClient, /function ShootPanel/);
    assert.match(pluginClient, /const MAX_TACTIC_PAGES = 512;/,
      '打法分页必须覆盖 backend 最多 512 条且允许因响应体积每页少于 4 条');
    assert.match(pluginClient, /const MAX_SHOOT_HISTORY_PAGES = 128;/,
      '拍摄记录分页最多 128 页，每页固定上限 4 条');
    assert.match(pluginClient, /const MAX_BROWSER_PROMPTER_BYTES = 64 \* 1024;/,
      'browserOnly 手动提词文本必须有 64 KiB 硬上限');
    assert.match(pluginClient, /function provideBrowserOnlyContentShell/);
    assert.match(pluginClient,
      /页内简版只在当前页面滚动，不记录镜头完成状态，也不会写入拍摄记录。/);
    assert.match(pluginClient,
      /以下是 WhaleDock 标记的本地收工记录；不是视频、设备或平台数据回读。/);
    assert.match(pluginClient, /page\.addEventListener\('visibilitychange', pauseWhenHidden\)/,
      '页内简版必须在页面隐藏时暂停');
    assert.match(pluginClient, /打法只能由你从真实复盘显式固化。/);
    assert.match(pluginClient,
      /一期没有平台数据通道；以下都是本地文件，不显示播放量、评论聚类、使用次数或胜率。/);
    assert.match(pluginClient, /这一格还没做/);
    assert.match(pluginClient, /workspaces\.connectWorkspace\(workspaceId\)/);
    assert.match(pluginClient, /async fillDraft\(sessionId, text, workspaceId, signal, stillValid\)/,
      '填草稿守门必须支持 selection\/commit generation 竞态校验');
    assert.match(pluginClient, /projectTemplateActionDraft/);
    assert.match(pluginClient, /右侧当前对话已有草稿，未覆盖/);
    assert.match(pluginClient, /没有发送/);
    assert.doesNotMatch(pluginClient, /\.send(?:Session|Message|Prompt)?\s*\(/,
      '模板动作只能填草稿，Client 不得自动发送');
    assert.match(pluginClient, /whaledockContentShell/);
    assert.match(pluginClient, /function ProjectDrawer/,
      '受管页面必须有项目抽屉');
    assert.match(pluginClient, /function ControlRoom/,
      '受管页面必须有控制室窗格');
    assert.match(pluginClient, /const PROJECT_POLL_MS = 2000;/,
      '控制室轮询节奏必须固定为2秒');
    assert.match(pluginClient,
      /\[browserOnly, mode, whaledockProjects, projectRefreshKey, sessionState\.current\]/,
      '当前对话换人必须立即触发控制室重读');
    assert.doesNotMatch(pluginClient,
      /\[browserOnly, mode, whaledockProjects, projectRefreshKey, sessionState\]/,
      '任意 session snapshot 微变化不得在 bootstrap 期间制造请求风暴');
    assert.match(pluginClient,
      /controller\.abort\(\);[\s\S]{0,180}clearTimeout\(pollTimer\)/,
      '卸载或离开项目模式必须停止请求和轮询 timer');
    assert.match(pluginClient, /data-wt-theme/,
      '三态主题必须只由控制室作用域承载');
    assert.match(pluginClient, /data-wt-status/);
    assert.match(pluginClient, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
      '控制室标准宽度必须是三列卡片');
    assert.match(pluginClient,
      /children: project\.hasBinding \? '重绑' : '绑定'/,
      '关闭新建提示后，管理行仍必须能绑定或重绑当前对话');
    assert.match(pluginClient, /children: '＋ 添加项目'/);
    assert.match(pluginClient, /先选项目模板，再由系统窗口选项目文件夹/);
    assert.match(pluginClient, /children: '选择文件夹并创建'/);
    assert.match(pluginClient, /whaledockProjects\.create\(\{ templateId \}, signal\)/,
      '新建只能使用首屏下发的模板 id，文件夹仍由 main 选择');
    assert.doesNotMatch(pluginClient, /whaledockProjects\.create\(\{\}, signal\)/);
    assert.match(pluginClient, /children: '短视频模板'/,
      '老创作台必须降级为模板入口');
    assert.match(pluginClient, /原生会话与设置一直可达/);
    assert.match(pluginClient,
      /if \(projectId === CONTROL_PROJECT_ID\) \{[\s\S]{0,260}refreshProjectWorkbench\(\);[\s\S]{0,80}return;/,
      '控制室是聚合视图，不得误调项目 open/ACK');
    assert.match(pluginClient,
      /whaledockProjects\.open\(\s*\{ projectId \}, signal, \{ allowBootstrap: !shortcut \}\s*\)/,
      '普通项目卡允许 bootstrap，快捷命令必须显式禁用');
    assert.match(pluginClient, /function ProjectPane/,
      '真实项目打开后必须有可见窗格容器');
    assert.match(pluginClient,
      /container-name:wd11-pane[\s\S]{0,180}@container wd11-pane \(max-width:720px\)/,
      '中栏真实变窄时必须按容器宽度收为单列，不能仅看整页 viewport');
    assert.match(pluginClient,
      /container-name:wd11-window[\s\S]{0,900}@container wd11-window \(max-width:600px\)/,
      '中栏仍为双列但单窗过窄时，模板内部也必须按单窗宽度收为单列');
    assert.match(pluginClient, /data-empty[\s\S]{0,120}active === undefined/,
      '空窗口必须暴露窄态标记，避免等待产物的空态占满整屏');
    assert.match(pluginClient, /等待 Agent 产物，或从项目动作中选择内容/,
      '空窗口必须说明它是稳定的产物落点');
    assert.match(pluginClient, /'split-two'[\s\S]{0,180}'left-stack'[\s\S]{0,180}'grid-four'/,
      '页面必须只提供三个稳定预设');
    assert.match(pluginClient, /children: '已验证指纹'/);
    assert.match(pluginClient, /function ProjectPreview/,
      'Markdown、文本和图片必须走受限真实预览组件');
    assert.match(pluginClient, /react_jsx_runtime\.jsx\('pre', \{ className: 'wd11-previewText'/,
      '文本与 Markdown 必须作为纯文本渲染，不能注入 HTML');
    assert.match(pluginClient, /data:image\\\/\(\?:png\|jpeg\);base64/,
      '图片预览只接受主进程投影的 png/jpeg data URL');
    assert.doesNotMatch(pluginClient, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(pluginClient, /安全通道尚未提供内容读取/,
      '批次3不得继续以相对引用占位冒充真实预览');
    assert.match(pluginClient, /在 Electron 受控子窗中打开/);
    assert.match(pluginClient, /sandbox: 'allow-forms allow-scripts'/,
      'browser tab 只能在无弹窗/无顶层导航权限的 sandbox iframe 中显示');
    assert.doesNotMatch(pluginClient, /allow-(?:popups|top-navigation)/);
    assert.match(pluginClient,
      /changes: \{ layoutPreset: preset \}/,
      '切预设只发 layoutPreset，不得将 public artifact 状态回传');
    assert.doesNotMatch(pluginClient, /path: (?:tab|descriptor)\.relativeRef/,
      '页面不得把 relativeRef 重建为私有 path 布局字段');
    assert.match(pluginClient, /data-project-template/,
      'video-template 必须在 WindowN 内承载真实模板面板');
    assert.match(pluginClient, /data-template-five-stage/,
      '窗格内必须渲染现有五阶段组件而非跳转占位按钮');
    assert.doesNotMatch(pluginClient, /onTemplate: \(\) => selectMode\('content'\)/,
      '项目窗格不得靠切回旧 content 模式冒充 video-template 内容');
    assert.doesNotMatch(pluginClient, /children: '打开短视频模板'/);
    assert.match(pluginClient,
      /workspaceFiles\.execute\('projects\.open', \{[\s\S]{0,100}phase: 'prepare'/,
      '详情只读刷新必须复用 prepare 而不是新增路径 RPC');
    assert.match(pluginClient, /PROJECT_SWITCH_STORAGE_KEY/);
    assert.match(pluginClient, /consumedProjectSwitch\.current = next;[\s\S]{0,300}setPendingProjectSwitch/,
      '快捷命令必须先记已消费，失败不自动重试');
    assert.match(pluginClient, /selectModeRef\.current\?\.\('projects'\)/);
    assert.match(pluginClient,
      /openProjectRef\.current\(pendingProjectSwitch\.projectId, \{ shortcut: true \}\)/,
      '快捷命令必须走真实 prepare，但不得 bootstrap 未绑定项目');
    assert.match(pluginClient, /这个项目还没绑定可用对话。先选择右侧对话并绑定。/);
    assert.match(pluginClient,
      /const targetSource = mode === 'projects'[\s\S]{0,160}'current-session'[\s\S]{0,80}'none'[\s\S]{0,80}'host'/,
      '项目窗格根只能来自已 commit 的当前会话，不得回退 Host 根');
    assert.match(pluginClient, /const projectTemplateSurfaceCurrent = templateSessionCurrent/);
    assert.match(pluginClient, /cwd: preCommitCwd/,
      'commit generation 必须锁定当时当前会话的规范 cwd');
    assert.match(pluginClient, /postCommitCwd === preCommitCwd/,
      'commit 前后 cwd 必须一致，防止成功回包窗口内的根切换');
    assert.match(pluginClient, /selectionRevision === preCommitSelectionRevision/,
      'commit 窗口内 selection A→B→A 不得通过表面相等检查');
    assert.match(pluginClient, /currentCwd !== record\.cwd/,
      '同 raw session cwd 变化必须失效，不得跟到另一项目根');
    assert.match(pluginClient,
      /PROJECT_CONTEXT_RETRY_MS = Object\.freeze\(\[120, 240, 480, 960, 1600\]\)/,
      'commit 后上下文尚未 stage 时只做有界、可取消重试');
    assert.doesNotMatch(pluginClient, /face\.history/,
      '项目界面不得使用 dsh 私有 history 接口');
    const conversationFork = fs.readFileSync(path.join(
      sourceRoot, 'forks', 'ui-conversation', 'lib', 'client.js'
    ), 'utf8');
    assert.match(conversationFork, /whaledockContextGate/);
    assert.match(conversationFork, /鲸坞受管会话：工作台上下文未就绪，本次未发送/);
    assert.match(conversationFork, /if \(gate === void 0\)/);
    assert.match(conversationFork,
      /__WHALEDOCK_CONTEXT_MANAGED__ !== true && !fragmentManaged\) return this\.conversation\(\)\.sendSession/,
      '无 gate 且 marker/fragment 均未证明受管时必须保持原生发送');
    assert.match(conversationFork, /这是鲸坞受管页面：上下文闸门没有加载，本次未发送/,
      'marker 或合法 loopback fragment 证明受管时，缺 gate 必须 fail-closed');
  });

  await test('项目工作台状态机拒绝过期回包、保留旧数据并防重入', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    const sandbox = {
      window: { __ModuleLoader__: { load(value) { definition = value; } } },
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'context-poc/project-workbench-state.js' });
    const plugin = definition.factory(clientImport);
    const machine = plugin.projectWorkbenchStateMachine;
    assert(machine, '项目工作台状态机必须可纯 Node 直测');

    let state = machine.initial();
    assert.equal(state.theme, 'system');
    assert.equal(state.selectedProjectId, `proj_${'0'.repeat(31)}1`);
    assert.equal(state.projects.status, 'loading');
    state = machine.reduce(state, { type: 'projects:start', request: 2 });
    state = machine.reduce(state, { type: 'projects:slow', request: 2 });
    assert.equal(state.projects.status, 'slow');
    const current = machine.reduce(state, {
      type: 'projects:success', request: 1, revision: 1,
      items: [{ projectId: `proj_${'a'.repeat(32)}`, kind: 'user', name: '过期',
        icon: '📦', hasFolder: true, hasBinding: true, bindingKnown: true,
        hidden: false, pinned: false }]
    });
    assert.equal(current, state, '过期项目回包必须原对象拒绝');
    state = machine.reduce(state, {
      type: 'projects:success', request: 2, revision: 2,
      templateCatalog: [{ id: 'builtin:short-video', label: '短视频', hint: '五阶段模板' }],
      items: [{ projectId: `proj_${'b'.repeat(32)}`, kind: 'user', name: '旅行图鉴',
        icon: '🌍', hasFolder: true, hasBinding: false, bindingKnown: false,
        hidden: false, pinned: false }]
    });
    assert.equal(state.projects.status, 'ready');
    assert.equal(state.templateCatalog[0].id, 'builtin:short-video');
    state = machine.reduce(state, { type: 'create:open' });
    assert.equal(state.createWizard.open, true);
    assert.equal(state.createWizard.templateId, 'builtin:short-video',
      '向导只能默认选中首屏下发的模板');
    assert.equal(machine.reduce(state, {
      type: 'create:select', templateId: 'builtin:hard-coded'
    }), state, '未在 catalog 中的模板不得进入向导状态');
    state = machine.reduce(state, { type: 'create:close' });
    assert.equal(state.createWizard.open, false);
    state = machine.reduce(state, { type: 'projects:start', request: 3 });
    state = machine.reduce(state, { type: 'projects:error', request: 3 });
    assert.equal(state.projects.status, 'stale', '刷新失败但有旧数据时不得白屏');
    assert.equal(state.projects.items[0].name, '旅行图鉴');

    state = machine.reduce(state, {
      type: 'action:start', token: 7, kind: 'open', projectId: `proj_${'b'.repeat(32)}`
    });
    const reentered = machine.reduce(state, {
      type: 'action:start', token: 8, kind: 'remove', projectId: `proj_${'b'.repeat(32)}`
    });
    assert.equal(reentered, state, '未完成操作期间必须拒绝重入');
    assert.equal(machine.reduce(state, {
      type: 'action:finish', token: 6, notice: '过期'
    }), state, '过期操作结果必须被拒绝');
    state = machine.reduce(state, {
      type: 'action:finish', token: 7, notice: '已打开'
    });
    assert.equal(state.action, null);
    assert.equal(state.notice, '已打开');

    const noBinding = machine.projectListResult({
      state: 'fulfilled', result: {
        kind: 'projects', revision: 4, cursor: 0, nextCursor: null,
        switchCommand: null,
        templateCatalog: [{ id: 'builtin:short-video', label: '短视频', hint: null }],
        projects: [{ projectId: `proj_${'c'.repeat(32)}`, kind: 'user', name: '未知绑定',
          icon: '🧱', hasFolder: true, hidden: false, pinned: false }]
      }
    });
    assert.equal(noBinding.projects[0].hasBinding, false);
    assert.equal(noBinding.projects[0].bindingKnown, false,
      '旧 Host 未提供 hasBinding 时必须显式降级为未知，不得猜测');
    assert.equal(noBinding.templateCatalog[0].id, 'builtin:short-video');
    assert.equal(noBinding.switchCommand, null);
    assert.equal(JSON.stringify(noBinding).includes('bindingRef'), false);
    const withSwitch = machine.projectListResult({
      state: 'fulfilled', result: {
        kind: 'projects', revision: 4, cursor: 0, nextCursor: null,
        projects: [], templateCatalog: [],
        switchCommand: { seq: 7, projectId: `proj_${'c'.repeat(32)}` }
      }
    });
    assert.equal(withSwitch.switchCommand.seq, 7);
    assert.equal(machine.projectSwitchSequence(0, withSwitch.switchCommand), 7);
    assert.equal(machine.projectSwitchSequence(7, withSwitch.switchCommand), null,
      '同一快捷 seq 只能消费一次');
    assert.equal(machine.projectActionFailureMessage({ code: 'workspace-unavailable' }, 'open'),
      '这个项目还没绑定可用对话。先选择右侧对话并绑定。');
    const mismatchMessage = machine.projectActionFailureMessage(
      { code: 'workspace-mismatch' }, 'bind'
    );
    assert.equal(mismatchMessage, '右侧当前对话不属于该项目文件夹，未绑定。');
    assert.equal(/[/\\]/.test(mismatchMessage), false, '根不匹配提示不得暴露路径');
    assert.equal(machine.projectListResult({
      state: 'fulfilled', result: {
        kind: 'projects', revision: 4, cursor: 32, nextCursor: null,
        projects: [], switchCommand: null,
        templateCatalog: [{ id: 'builtin:short-video', label: '越界', hint: null }]
      }
    }), null, '非首屏不得夹带模板目录');

    const consoleResult = machine.projectConsoleResult({
      state: 'fulfilled', result: {
        kind: 'console', revision: 5,
        cards: [{ projectId: `proj_${'c'.repeat(32)}`, name: '未知绑定', icon: '🧱',
          pinned: false, hidden: false, status: 'need', statusLabel: '待你决定',
          glow: true, runtimeMs: 42000, kids: 2, sessionTitle: '编写首页' }],
        counts: { need: 1, done: 0, busy: 0, idle: 0, total: 1, glowing: 1 }
      }
    });
    assert.equal(consoleResult.cards[0].status, 'need');
    state = machine.reduce(state, { type: 'console:start', request: 9 });
    state = machine.reduce(state, { type: 'console:success', request: 9,
      revision: consoleResult.revision, cards: consoleResult.cards, counts: consoleResult.counts });
    assert.equal(state.console.cards[0].runtimeMs, 42000);
    state = machine.reduce(state, { type: 'console:start', request: 10 });
    state = machine.reduce(state, { type: 'console:error', request: 10 });
    assert.equal(state.console.status, 'stale');
    assert.equal(state.console.cards[0].statusLabel, '待你决定');
    const themed = machine.reduce(state, { type: 'theme', theme: 'dark' });
    assert.equal(themed.theme, 'dark');
    assert.equal(machine.reduce(themed, { type: 'theme', theme: 'neon' }), themed,
      '主题状态只接受深色/浅色/系统三态');

    const detailSnapshot = {
      state: 'fulfilled', result: {
        kind: 'open-committed', bindingRef: `session-binding-${'d'.repeat(64)}`,
        project: {
          projectId: `proj_${'c'.repeat(32)}`, kind: 'user', name: '产物项目', icon: '🧰',
          hasFolder: true, hasBinding: true, hidden: false, pinned: false,
          folderTail: '产物项目', templateId: 'builtin:short-video',
          layoutPreset: 'split-two',
          templateActions: [], templateActionsCapped: false,
          paneState: {
            schemaVersion: 1, preset: 'split-two', windows: [
              { window: 1, label: '窗口1', active: 'artifact-a', collapsed: false, tabs: [{
                id: 'artifact-a', type: 'artifact', title: '产物：result.md', locked: true,
                descriptor: { window: 1, relativeRef: 'output/result.md', kind: 'markdown',
                  fingerprint: { size: 42, mtime: 1234, sha256: 'e'.repeat(64) },
                  preview: { kind: 'markdown', text: '# 已完成\n\n安全预览', truncated: false } }
              }] },
              { window: 2, label: '窗口2', active: 'browser-a', collapsed: false, tabs: [{
                id: 'browser-a', type: 'browser', title: '参考', url: 'https://example.com/path'
              }] }
            ]
          }
        }
      }
    };
    const detail = machine.projectOpenResult(detailSnapshot, 'open-committed');
    assert.equal(detail.paneState.windows[0].tabs[0].descriptor.relativeRef,
      'output/result.md');
    assert.equal(detail.paneState.windows[0].tabs[0].descriptor.preview.text, '# 已完成\n\n安全预览');
    assert.equal(JSON.stringify(detail).includes('"path"'), false);
    assert.equal(detail.paneState.windows[0].tabs[0].locked, true);
    const badPath = JSON.parse(JSON.stringify(detailSnapshot));
    badPath.result.project.paneState.windows[0].tabs[0].descriptor.path = '/private/leak';
    assert.equal(machine.projectOpenResult(badPath, 'open-committed'), null,
      'public detail 含 path 时必须整体拒绝');
    const badBrowser = JSON.parse(JSON.stringify(detailSnapshot));
    badBrowser.result.project.paneState.windows[1].tabs[0].url = 'javascript:alert(1)';
    assert.equal(machine.projectOpenResult(badBrowser, 'open-committed'), null,
      'browser tab 只允许 http/https');
    const badPreviewKind = JSON.parse(JSON.stringify(detailSnapshot));
    badPreviewKind.result.project.paneState.windows[0].tabs[0].descriptor.preview.kind = 'html';
    assert.equal(machine.projectOpenResult(badPreviewKind, 'open-committed'), null,
      '预览 kind 必须与锁定产物 kind 一致');
    const oversizedPreview = JSON.parse(JSON.stringify(detailSnapshot));
    oversizedPreview.result.project.paneState.windows[0].tabs[0].descriptor.preview.text =
      '文'.repeat(2049);
    assert.equal(machine.projectOpenResult(oversizedPreview, 'open-committed'), null,
      'Markdown UTF-8 预览必须严格限制为 6 KiB');
    const validImage = JSON.parse(JSON.stringify(detailSnapshot));
    validImage.result.project.paneState.windows[0].tabs[0].descriptor.kind = 'image';
    validImage.result.project.paneState.windows[0].tabs[0].descriptor.relativeRef = 'output/cover.png';
    validImage.result.project.paneState.windows[0].tabs[0].descriptor.preview = {
      kind: 'image',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      width: 1,
      height: 1
    };
    assert.equal(machine.projectOpenResult(validImage, 'open-committed')
      .paneState.windows[0].tabs[0].descriptor.preview.kind, 'image');
    const unsafeImage = JSON.parse(JSON.stringify(validImage));
    unsafeImage.result.project.paneState.windows[0].tabs[0].descriptor.preview.dataUrl =
      'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+';
    assert.equal(machine.projectOpenResult(unsafeImage, 'open-committed'), null,
      '图片预览必须拒绝 SVG 与非 png/jpeg MIME');
    const unboundPrepared = JSON.parse(JSON.stringify(detailSnapshot));
    unboundPrepared.result.kind = 'open-prepared';
    unboundPrepared.result.bindingRef = null;
    unboundPrepared.result.openToken = `project-open-${'f'.repeat(64)}`;
    unboundPrepared.result.project.hasBinding = false;
    assert.equal(machine.projectOpenResult(unboundPrepared, 'open-prepared').hasBinding, false,
      '未绑定项目的 prepare 可只读显示安全详情');
    const unboundCommitted = JSON.parse(JSON.stringify(unboundPrepared));
    delete unboundCommitted.result.openToken;
    unboundCommitted.result.kind = 'open-committed';
    assert.equal(machine.projectOpenResult(unboundCommitted, 'open-committed'), null,
      '未绑定项目绝不得被当成已 commit/ACK');

    state = machine.reduce(state, { type: 'detail:start', request: 11,
      projectId: detail.projectId, revision: 8 });
    const staleDetail = machine.reduce(state, { type: 'detail:success', request: 10,
      project: detail, revision: 8 });
    assert.equal(staleDetail, state, '过期详情回包不得覆盖当前窗格');
    state = machine.reduce(state, { type: 'detail:success', request: 11,
      project: detail, revision: 8 });
    assert.equal(state.surface, 'project');
    assert.equal(state.detail.project.name, '产物项目');
    assert.equal(state.detail.opened, false,
      'prepare-only/未注明来源的详情不得取得旧21项模板能力');
    state = machine.reduce(state, { type: 'detail:start', request: 12,
      projectId: detail.projectId, revision: 8 });
    state = machine.reduce(state, { type: 'detail:success', request: 12,
      project: detail, revision: 8, opened: true });
    assert.equal(state.detail.opened, true, '仅本地 commit 事件可标记项目已真实打开');
    const staleOpened = machine.reduce(state, { type: 'detail:success', request: 11,
      project: detail, revision: 9, opened: false });
    assert.equal(staleOpened, state, '过期 prepare 不得改变已打开 generation');
  });

  await test('全受管 mode 快捷命令先消费 seq，未绑定只 prepare 且同 seq 不重试', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    const projectId = `proj_${'7'.repeat(32)}`;
    const commandSeq = 73;

    const runScenario = async (startingMode) => {
      const eventLog = [];
      const hookSlots = [];
      const pendingEffects = [];
      let hookCursor = 0;
      let dirty = false;
      let tree = null;
      let Root = null;
      let rootProps = null;
      const sameDependencies = (left, right) => Array.isArray(left) && Array.isArray(right)
        && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
      const useStoredValue = (kind, initialize) => {
        const index = hookCursor++;
        if (!hookSlots[index]) hookSlots[index] = { kind, value: initialize() };
        assert.equal(hookSlots[index].kind, kind, `hook 顺序发生变化: ${index}`);
        return [hookSlots[index], index];
      };
      const setStoredValue = (slot, next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        if ((slot.value === 'content' || slot.value === 'sessions') && value === 'projects') {
          eventLog.push('mode:projects');
        }
        slot.value = value;
        dirty = true;
      };
      const registerEffect = (effect, dependencies) => {
        const index = hookCursor++;
        let slot = hookSlots[index];
        if (!slot) {
          slot = { kind: 'effect', dependencies: undefined, cleanup: null };
          hookSlots[index] = slot;
        }
        assert.equal(slot.kind, 'effect', `effect hook 顺序发生变化: ${index}`);
        if (dependencies !== undefined && sameDependencies(slot.dependencies, dependencies)) return;
        pendingEffects.push({ index, effect, dependencies });
      };
      const fakeReact = {
        useState(initial) {
          const [slot] = useStoredValue('state', () => (
            typeof initial === 'function' ? initial() : initial
          ));
          return [slot.value, (next) => setStoredValue(slot, next)];
        },
        useReducer(reducer, initial, initialize) {
          const [slot] = useStoredValue('reducer', () => (
            typeof initialize === 'function' ? initialize(initial) : initial
          ));
          return [slot.value, (action) => setStoredValue(slot, reducer(slot.value, action))];
        },
        useRef(initial) {
          const [slot] = useStoredValue('ref', () => ({ current: initial }));
          return slot.value;
        },
        useMemo(factory, dependencies) {
          const index = hookCursor++;
          let slot = hookSlots[index];
          if (!slot) {
            slot = { kind: 'memo', dependencies: undefined, value: undefined };
            hookSlots[index] = slot;
          }
          assert.equal(slot.kind, 'memo', `memo hook 顺序发生变化: ${index}`);
          if (!sameDependencies(slot.dependencies, dependencies)) {
            slot.value = factory();
            slot.dependencies = dependencies?.slice();
          }
          return slot.value;
        },
        useCallback(callback, dependencies) {
          const index = hookCursor++;
          let slot = hookSlots[index];
          if (!slot) {
            slot = { kind: 'callback', dependencies: undefined, value: undefined };
            hookSlots[index] = slot;
          }
          assert.equal(slot.kind, 'callback', `callback hook 顺序发生变化: ${index}`);
          if (!sameDependencies(slot.dependencies, dependencies)) {
            slot.value = callback;
            slot.dependencies = dependencies?.slice();
          }
          return slot.value;
        },
        useEffect: registerEffect,
        useLayoutEffect: registerEffect
      };
      const renderElement = (type, props, key) => ({
        type, key: key ?? null, props: props || {}
      });
      const fakeJsx = { jsx: renderElement, jsxs: renderElement, Fragment: Symbol('fragment') };
      const render = () => {
        dirty = false;
        hookCursor = 0;
        pendingEffects.length = 0;
        tree = Root(rootProps);
        const effects = pendingEffects.splice(0);
        for (const pending of effects) {
          const slot = hookSlots[pending.index];
          if (typeof slot.cleanup === 'function') slot.cleanup();
          slot.dependencies = pending.dependencies?.slice();
          const cleanup = pending.effect();
          slot.cleanup = typeof cleanup === 'function' ? cleanup : null;
        }
      };
      const flush = async () => {
        let idleTurns = 0;
        for (let turn = 0; turn < 80; turn += 1) {
          if (dirty) {
            render();
            idleTurns = 0;
          }
          await new Promise((resolve) => setImmediate(resolve));
          if (dirty) continue;
          idleTurns += 1;
          if (idleTurns >= 2) return;
        }
        throw new Error(`${startingMode}: React effect 未在有界轮次内稳定`);
      };
      const unmount = () => {
        for (const slot of hookSlots) {
          if (slot?.kind === 'effect' && typeof slot.cleanup === 'function') slot.cleanup();
        }
      };

      let definition = null;
      let uuidSequence = 0;
      let timerSequence = 0;
      let intervalSequence = 0;
      let commandEnabled = startingMode === 'projects';
      let projectService = null;
      let workspaceFiles = null;
      let providedShell = null;
      let pluginCleanup = null;
      let sessionOpenCalls = 0;
      let bootstrapCalls = 0;
      const timers = new Map();
      const intervals = new Map();
      const storage = new Map();
      const requests = new Map();
      const operations = [];
      const sandbox = {
        window: { __ModuleLoader__: { load(value) { definition = value; } } },
        location: {
          hash: `#whaledockController=controller-shortcut-${startingMode}&whaledockSelectionToken=${SELECTION_TOKEN}`,
          pathname: '/', search: ''
        },
        history: { state: null, replaceState() {} },
        crypto: { randomUUID: () => (
          `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
        ) },
        sessionStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem(key, value) {
            storage.set(key, String(value));
            if (key === 'whaledock.project-switch.v1') eventLog.push('persist-switch');
          }
        },
        localStorage: {
          length: 0, key: () => null, getItem: () => null,
          setItem() {}, removeItem() {}
        },
        setTimeout(fn, delay) {
          const id = ++timerSequence;
          timers.set(id, { fn, delay });
          return id;
        },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, delay) {
          const id = ++intervalSequence;
          intervals.set(id, { fn, delay });
          return id;
        },
        clearInterval(id) { intervals.delete(id); },
        URL,
        URLSearchParams,
        AbortController,
        Date,
        Symbol,
        Number,
        Promise
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(source, sandbox, { filename: `context-poc/shortcut-${startingMode}.js` });
      const plugin = definition.factory((specifier) => {
        if (specifier === 'react') return fakeReact;
        if (specifier === 'react/jsx-runtime') return fakeJsx;
        throw new Error(`unexpected shortcut import: ${specifier}`);
      });
      const realm = (value) => vm.runInNewContext(`(${JSON.stringify(value)})`, sandbox);
      const sessionSnapshot = realm({
        phase: 'ready', current: null, ids: [], byId: {},
        subagentsByParent: {}, jobsBySession: {}
      });
      const workspaceState = realm({ items: [], archivedSessionIds: [] });
      const operationResult = (request) => {
        if (request.operation === 'projects.list') {
          return {
            kind: 'projects', revision: 4, cursor: 0, nextCursor: null,
            projects: [{
              projectId, kind: 'user', name: '未绑定项目', icon: '📦',
              hasFolder: true, hasBinding: false, hidden: false, pinned: false
            }],
            switchCommand: commandEnabled ? { seq: commandSeq, projectId } : null,
            templateCatalog: []
          };
        }
        if (request.operation === 'console.read') {
          return {
            kind: 'console', revision: 4, cards: [],
            counts: { need: 0, done: 0, busy: 0, idle: 0, total: 0, glowing: 0 }
          };
        }
        if (request.operation === 'projects.open' && request.input.phase === 'prepare') {
          return {
            kind: 'open-prepared',
            project: {
              projectId, kind: 'user', name: '未绑定项目', icon: '📦',
              hasFolder: true, hasBinding: false, hidden: false, pinned: false,
              folderTail: '未绑定项目', templateId: null,
              layoutPreset: null, paneState: null
            },
            bindingRef: null,
            openToken: `project-open-${'6'.repeat(64)}`,
            bootstrapTicket: `project-bootstrap-v1.${'A'.repeat(16)}.${'B'.repeat(32)}.${'C'.repeat(22)}`
          };
        }
        throw new Error(`${startingMode}: unexpected operation ${request.operation}`);
      };
      const connection = {
        isLoopback: true,
        rpc: {
          async call(_channel, endpoint, payload) {
            if (endpoint === 'selection/register') {
              return realm({ ok: true, value: {
                state: 'none', code: null, selectionRevision: payload.selectionRevision
              } });
            }
            if (endpoint === 'ui/preferences/get') {
              return realm({ ok: true, value: { snapshot: {
                revision: 1, contentViewMode: 'content', contentViewHintSeen: true
              } } });
            }
            if (endpoint === 'projects/session/bootstrap') {
              bootstrapCalls += 1;
              return realm({ ok: true, value: {
                bootstrapped: false, bindingRef: null, code: 'workspace-unavailable'
              } });
            }
            if (endpoint === 'workspace/files/request') {
              const requestToken = (++uuidSequence).toString(16).padStart(64, '0');
              const request = {
                operation: payload.operation,
                input: JSON.parse(JSON.stringify(payload.input))
              };
              requests.set(requestToken, request);
              operations.push(request);
              eventLog.push(`operation:${request.operation}:${request.input.phase || ''}`);
              return realm({ ok: true, value: {
                accepted: true, requestToken, state: 'queued', code: null,
                deadlineMs: Date.now() + 10000
              } });
            }
            if (endpoint === 'workspace/files/status') {
              const request = requests.get(payload.requestToken);
              return realm({ ok: true, value: {
                requestToken: payload.requestToken,
                state: 'fulfilled', code: null, result: operationResult(request)
              } });
            }
            throw new Error(`${startingMode}: unexpected endpoint ${endpoint}`);
          }
        },
        hostDescription: {
          getSnapshot: () => realm({ cwd: '' }),
          subscribe: () => () => {}
        }
      };
      const sessions = {
        list: { getSnapshot: () => sessionSnapshot, subscribe: () => () => {} },
        open() { sessionOpenCalls += 1; },
        scope: () => undefined
      };
      const ctx = {
        get(name) {
          if (name === 'connection') return connection;
          if (name === 'sessions') return sessions;
          if (name === 'workspaces') return {};
          return undefined;
        },
        reflect: {
          provide(name, value) {
            if (name === 'whaledockProjects') projectService = value;
            if (name === 'whaledockWorkspaceFiles') workspaceFiles = value;
            if (name === 'whaledockContentShell') providedShell = value;
            return () => {};
          }
        },
        effect(factory) { pluginCleanup = factory(); }
      };
      plugin.apply(ctx);
      await new Promise((resolve) => setImmediate(resolve));
      assert(projectService && workspaceFiles && providedShell && pluginCleanup);
      const preferences = startingMode === 'projects' ? undefined : {
        getSnapshot: () => ({
          contentViewMode: startingMode, contentViewHintSeen: true
        }),
        subscribe: () => () => {},
        write: async () => ({ ok: true })
      };
      const shell = plugin.createContentShell(ctx, preferences, workspaceFiles, {
        alignmentScope: `controller-shortcut-${startingMode}`,
        whaledockProjects: projectService,
        projectDetailReader: providedShell.projectDetailReader,
        projectOpenCurrent: providedShell.projectOpenCurrent
      });
      Root = shell.Component;
      rootProps = {
        useSessions: (selector) => selector(sessionSnapshot),
        useWorkspaces: (selector) => selector(workspaceState),
        mount: {
          viewport: 1440, frameRef: { current: null }, frameClassName: 'fixture-frame',
          columns: { details: 0 },
          renderSidebar: () => ({ fixture: 'native-sidebar' }),
          renderConversation: () => ({ fixture: 'native-conversation' }),
          renderDetails: () => ({ fixture: 'native-details' }),
          renderOverlay: () => ({ fixture: 'overlay' })
        },
        integration: shell
      };
      dirty = true;
      await flush();

      const findNode = (value, predicate) => {
        if (value === null || value === undefined || typeof value !== 'object') return null;
        if (predicate(value)) return value;
        const children = value.props?.children;
        if (Array.isArray(children)) {
          for (const child of children) {
            const found = findNode(child, predicate);
            if (found) return found;
          }
          return null;
        }
        return findNode(children, predicate);
      };
      const rootMode = () => findNode(tree, (node) => (
        node.props?.['data-whaledock-layout'] !== undefined
      ));
      const drawer = () => findNode(tree, (node) => node.type?.name === 'ProjectDrawer');
      const fireProjectPoll = async () => {
        const candidates = [...timers.entries()].filter(([, timer]) => timer.delay === 2000);
        assert.equal(candidates.length, 1,
          `${startingMode}: 受管页任何时刻只能有一个项目快捷轮询 timer`);
        const [id, timer] = candidates[0];
        timers.delete(id);
        timer.fn();
        await flush();
      };

      if (startingMode !== 'projects') {
        const label = startingMode === 'content' ? '短视频模板' : '对话';
        const modeButton = findNode(tree, (node) => (
          node.type === 'button' && node.props?.children === label
        ));
        assert(modeButton, `${startingMode}: 找不到原生 mode 切换入口`);
        modeButton.props.onClick();
        await flush();
      }
      const expectedLeft = startingMode === 'projects'
        ? 'projects' : startingMode === 'content' ? 'library' : 'sessions';
      assert.equal(rootMode().props['data-whaledock-left'], expectedLeft,
        `${startingMode}: 初始 mode 未稳定 ${JSON.stringify(eventLog)}`);
      if (startingMode !== 'projects') {
        commandEnabled = true;
        await fireProjectPoll();
      }
      await flush();
      assert.equal(rootMode().props['data-whaledock-left'], 'projects',
        `${startingMode}: 命令必须先切回项目工作台`);
      assert.equal(storage.get('whaledock.project-switch.v1'), String(commandSeq));
      const prepareCalls = () => operations.filter((request) => (
        request.operation === 'projects.open' && request.input.phase === 'prepare'
      ));
      assert.equal(prepareCalls().length, 1,
        `${startingMode}: 未绑定快捷项目也必须真实尝试一次 prepare`);
      assert.equal(operations.some((request) => (
        request.operation === 'projects.open' && request.input.phase === 'commit'
      )), false, `${startingMode}: bindingRef=null 不得进入 commit/ACK/touch 链`);
      assert.equal(operations.some((request) => request.operation === 'receipts.ack'), false);
      assert.equal(sessionOpenCalls, 0, `${startingMode}: 未绑定不得打开或猜测会话`);
      assert.equal(bootstrapCalls, 0,
        `${startingMode}: 快捷命令必须显式 allowBootstrap:false`);
      assert.equal(drawer().props.state.notice,
        '这个项目还没绑定可用对话。先选择右侧对话并绑定。',
        `${startingMode}: force-open 失败必须可见`);
      const persistIndex = eventLog.indexOf('persist-switch');
      const prepareIndex = eventLog.indexOf('operation:projects.open:prepare');
      assert(persistIndex >= 0 && persistIndex < prepareIndex,
        `${startingMode}: seq 必须在 open 前持久化`);
      if (startingMode !== 'projects') {
        const modeIndex = eventLog.indexOf('mode:projects');
        assert(persistIndex < modeIndex && modeIndex < prepareIndex,
          `${startingMode}: 必须先消费 seq，再切 projects，最后 open`);
      }

      await fireProjectPoll();
      assert.equal(prepareCalls().length, 1,
        `${startingMode}: 同 seq 后续 poll 不得重试失败的 open`);
      unmount();
      pluginCleanup();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal([...timers.values()].filter((timer) => timer.delay === 2000).length, 0);
      assert.equal(intervals.size, 0);
    };

    for (const mode of ['content', 'sessions', 'projects']) await runScenario(mode);
  });

  await test('模板动作必须 fresh open，只填实时当前对话的空草稿', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    const sandbox = {
      window: { __ModuleLoader__: { load(value) { definition = value; } } },
      URLSearchParams, AbortController, setTimeout, clearTimeout
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'context-poc/project-template-action.js' });
    const machine = definition.factory(clientImport).projectWorkbenchStateMachine;
    const projectId = `proj_${'9'.repeat(32)}`;
    const bindingRef = `session-binding-${'8'.repeat(64)}`;
    const project = (actions) => ({
      projectId, kind: 'user', name: '项目 A', icon: '🎬', hasFolder: true,
      hasBinding: true, hidden: false, pinned: false, folderTail: '项目A',
      templateId: 'builtin:short-video', layoutPreset: null, paneState: null,
      templateActions: actions, templateActionsCapped: false
    });
    const opened = (actions) => ({ state: 'fulfilled', result: {
      kind: 'open-committed', project: project(actions), bindingRef
    } });
    let current = 'session-b';
    let generation = false;
    let openCalls = 0;
    let fillCalls = 0;
    let sendCalls = 0;
    const drafts = new Map([['session-a', ''], ['session-b', '']]);
    const action = {
      id: 'draft-script', label: '写脚本', hint: '生成草稿', confirm: false,
      prompt: '这是 main 本次打开后返回的最新提示词'
    };
    const open = async (input) => {
      assert.equal(JSON.stringify(input), JSON.stringify({ projectId }),
        '页面 fresh open 不得回传 prompt/action/path');
      openCalls += 1;
      current = 'session-a';
      generation = true;
      return opened([action]);
    };
    const isCurrent = (id, binding) => generation && id === projectId
      && binding === bindingRef && current === 'session-a';
    const fillDraft = async (sessionId, text, _workspaceId, _signal, stillValid) => {
      fillCalls += 1;
      assert.equal(sessionId, 'session-a', 'A 项目 fresh open 后绝不得使用 render 时的 B 会话');
      if (drafts.get(sessionId) !== '') return { ok: false, code: 'draft-not-empty' };
      if (!stillValid()) return { ok: false, code: 'operation-stale' };
      drafts.set(sessionId, text);
      if (!stillValid()) {
        if (drafts.get(sessionId) === text) drafts.set(sessionId, '');
        return { ok: false, code: 'operation-stale' };
      }
      return { ok: true };
    };
    const base = {
      projectId, actionId: action.id, open, isCurrent,
      currentSession: () => current, fillDraft
    };
    const success = await machine.projectTemplateActionDraft(base);
    assert.equal(success.ok, true, JSON.stringify(success));
    assert.equal(openCalls, 1, '每次点 action 都必须重新真实打开项目');
    assert.equal(fillCalls, 1);
    assert.equal(drafts.get('session-a'), action.prompt);
    assert.equal(drafts.get('session-b'), '', '旧会话草稿不得被串写');
    assert.equal(sendCalls, 0, '动作不存在自动发送步骤');

    drafts.set('session-a', '用户已有草稿');
    const nonEmpty = await machine.projectTemplateActionDraft(base);
    assert.equal(nonEmpty.code, 'draft-not-empty');
    assert.equal(drafts.get('session-a'), '用户已有草稿', '非空草稿不得覆盖');

    drafts.set('session-a', '');
    const cancelled = await machine.projectTemplateActionDraft({
      ...base,
      open: async () => {
        current = 'session-a';
        generation = true;
        return opened([{ ...action, confirm: true }]);
      },
      confirm: () => false
    });
    assert.equal(cancelled.code, 'cancelled');
    assert.equal(drafts.get('session-a'), '', '本地确认取消不得填草稿');

    const stale = await machine.projectTemplateActionDraft({
      ...base,
      fillDraft: async (_sessionId, _text, _workspaceId, _signal, stillValid) => {
        generation = false;
        return stillValid() ? { ok: true } : { ok: false, code: 'operation-stale' };
      }
    });
    assert.equal(stale.code, 'operation-stale');
    assert.equal(drafts.get('session-a'), '', 'commit generation 竞态失效时不得回填');

    const removed = await machine.projectTemplateActionDraft({
      ...base,
      open: async () => {
        current = 'session-a';
        generation = true;
        return opened([{ ...action, id: 'replacement', prompt: '新动作' }]);
      }
    });
    assert.equal(removed.code, 'template-action-missing',
      '页面只传 id，main fresh detail 已删的动作必须 fail-closed');
  });

  await test('项目默认界面与打开后窗格均保留抽屉、原生对话同屏', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    let projectStateOverride = null;
    const renderElement = (type, props, key) => {
      if (typeof type === 'function' && [
        'ProjectDrawer', 'ControlRoom', 'ProjectPane', 'PaneWindow', 'ProjectTabContent',
        'ProjectPreview', 'ProjectVideoTemplate', 'CreatorSidebar', 'CreatorDetail'
      ].includes(type.name)) {
        return type(props || {});
      }
      return { type, key: key ?? null, props: props || {} };
    };
    const fakeReact = {
      useMemo: (factory) => factory(),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useReducer: (_reducer, initial, initialize) => [projectStateOverride
        || (initialize ? initialize(initial) : initial), () => {}],
      useRef: (value) => ({ current: value }),
      useEffect() {},
      useLayoutEffect() {},
      useCallback: (callback) => callback
    };
    const fakeJsx = { jsx: renderElement, jsxs: renderElement, Fragment: Symbol('fragment') };
    const sandbox = {
      window: { __ModuleLoader__: { load(value) { definition = value; } } },
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'context-poc/project-workbench-render.js' });
    const plugin = definition.factory((specifier) => {
      if (specifier === 'react') return fakeReact;
      if (specifier === 'react/jsx-runtime') return fakeJsx;
      throw new Error(`unexpected render import: ${specifier}`);
    });
    const projectService = {
      list() {}, create() {}, update() {}, bindCurrent() {}, reorder() {}, open() {}, readConsole() {}
    };
    let liveSessionState = { phase: 'ready', current: null, ids: [], byId: {} };
    const shell = plugin.createContentShell({
      get(name) {
        if (name === 'connection') return {
          hostDescription: { getSnapshot: () => ({ cwd: '/host/classic-root' }) }
        };
        if (name === 'sessions') return {
          open() {}, list: { getSnapshot: () => liveSessionState }
        };
        if (name === 'workspaces') return {};
        return undefined;
      }
    }, { getSnapshot: () => ({ contentViewMode: 'content' }) }, {}, {
      whaledockProjects: projectService,
      projectOpenCurrent: () => true
    });
    const tree = shell.Component({
      useSessions: (selector) => selector({
        phase: 'ready', current: null, ids: [], byId: {}
      }),
      useWorkspaces: (selector) => selector({ items: [], archivedSessionIds: [] }),
      mount: {
        viewport: 1440,
        frameRef: { current: null },
        frameClassName: 'fixture-frame',
        columns: { details: 0 },
        renderSidebar: () => ({ fixture: 'native-sidebar' }),
        renderConversation: () => ({ fixture: 'native-conversation' }),
        renderDetails: () => ({ fixture: 'native-details' }),
        renderOverlay: () => ({ fixture: 'overlay' })
      },
      integration: shell
    });
    const nodes = [];
    const visit = (value) => {
      if (value === null || value === undefined || typeof value === 'boolean') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (typeof value !== 'object') { nodes.push(value); return; }
      nodes.push(value);
      visit(value.props?.children);
    };
    visit(tree);
    const root = nodes.find((node) => node?.props?.['data-whaledock-layout'] === 'v0.11-projects');
    assert(root, '受管 shell 默认必须进入项目工作台');
    assert.equal(root.props.style.gridTemplateColumns,
      '272px minmax(420px, 1.15fr) minmax(340px, 1fr)');
    assert(nodes.some((node) => node?.props?.className === 'wd11-projectDrawer'));
    const control = nodes.find((node) => node?.props?.className === 'wd11-control');
    assert(control);
    assert.equal(control.props['data-wt-theme'], 'system');
    const themeGroup = nodes.find((node) => node?.props?.['aria-label'] === '控制室主题');
    assert.equal(themeGroup.props.children.length, 3, '控制室必须只有深色/浅色/系统三态');
    assert(nodes.some((node) => node?.props?.['aria-label'] === '原生对话'));
    assert(nodes.some((node) => node?.fixture === 'native-conversation'),
      '项目模式不得隐藏原生对话');
    assert(nodes.some((node) => node?.fixture === 'native-sidebar'),
      '项目模式必须保留原生侧栏的可达路径');
    assert(nodes.includes('＋ 添加项目'));
    assert(nodes.includes('短视频模板'));

    const projectId = `proj_${'d'.repeat(32)}`;
    const projectDetail = {
      projectId, kind: 'user', name: '产物工作台', icon: '🧰', hasFolder: true,
      hasBinding: true, hidden: false, pinned: false,
      folderTail: '产物工作台', templateId: 'builtin:short-video', layoutPreset: 'split-two',
      templateActions: [{ id: 'draft-script', label: '写脚本', hint: '填草稿',
        confirm: false, prompt: '请写脚本' }], templateActionsCapped: false,
      paneState: {
        schemaVersion: 1, preset: 'split-two', windows: [
          { window: 1, label: '窗口1', active: 'artifact-a', collapsed: false, tabs: [{
            id: 'artifact-a', type: 'artifact', title: '产物：result.md', locked: true,
            descriptor: { window: 1, relativeRef: 'output/result.md', kind: 'markdown',
              fingerprint: { size: 42, mtime: 1234, sha256: 'e'.repeat(64) },
              preview: { kind: 'markdown', text: '# 真实预览\n\n内容已回到项目窗格。',
                truncated: false } }
          }] },
          { window: 2, label: '窗口2', active: 'browser-a', collapsed: false, tabs: [{
            id: 'browser-a', type: 'browser', title: '参考网页', url: 'https://example.com/path'
          }, {
            id: 'template-a', type: 'video-template', title: '模板',
            templateId: 'builtin:short-video'
          }] },
          { window: 3, label: '窗口3', active: 'image-a', collapsed: false, tabs: [{
            id: 'image-a', type: 'image', title: '封面', relativeRef: 'output/cover.png',
            preview: { kind: 'image',
              dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              width: 1, height: 1 }
          }] },
          { window: 4, label: '窗口4', active: 'text-a', collapsed: false, tabs: [{
            id: 'text-a', type: 'text', title: '说明', relativeRef: 'notes/readme.txt'
          }] },
          { window: 5, label: '窗口5', active: 'template-main', collapsed: false, tabs: [{
            id: 'template-main', type: 'video-template', title: '短视频模板',
            templateId: 'builtin:short-video'
          }] }
        ]
      }
    };
    const machine = plugin.projectWorkbenchStateMachine;
    projectStateOverride = machine.initial();
    projectStateOverride = machine.reduce(projectStateOverride, {
      type: 'projects:start', request: 1
    });
    projectStateOverride = machine.reduce(projectStateOverride, {
      type: 'projects:success', request: 1, revision: 7,
      templateCatalog: [{ id: 'builtin:short-video', label: '短视频', hint: null }],
      items: [{ projectId, kind: 'user', name: '产物工作台', icon: '🧰', hasFolder: true,
        hasBinding: true, bindingKnown: true, hidden: false, pinned: false }]
    });
    projectStateOverride = machine.reduce(projectStateOverride, {
      type: 'detail:start', request: 1, projectId, revision: 7
    });
    projectStateOverride = machine.reduce(projectStateOverride, {
      type: 'detail:success', request: 1, project: projectDetail, revision: 7, opened: true
    });
    projectStateOverride = machine.reduce(projectStateOverride, { type: 'create:open' });
    liveSessionState = {
      phase: 'ready', current: 'session-project-a', ids: ['session-project-a'],
      byId: { 'session-project-a': { cwd: '/projects/a', origin: 'user' } }
    };
    const projectTree = shell.Component({
      useSessions: (selector) => selector(liveSessionState),
      useWorkspaces: (selector) => selector({ items: [], archivedSessionIds: [] }),
      mount: {
        viewport: 1440, frameRef: { current: null }, frameClassName: 'fixture-frame',
        columns: { details: 0 },
        renderSidebar: () => ({ fixture: 'native-sidebar' }),
        renderConversation: () => ({ fixture: 'native-conversation' }),
        renderDetails: () => ({ fixture: 'native-details' }),
        renderOverlay: () => ({ fixture: 'overlay' })
      },
      integration: shell
    });
    const projectNodes = [];
    const visitProject = (value) => {
      if (value === null || value === undefined || typeof value === 'boolean') return;
      if (Array.isArray(value)) { value.forEach(visitProject); return; }
      if (typeof value !== 'object') { projectNodes.push(value); return; }
      projectNodes.push(value);
      visitProject(value.props?.children);
    };
    visitProject(projectTree);
    const projectRoot = projectNodes.find((node) => (
      node?.props?.['data-whaledock-layout'] === 'v0.11-projects'
    ));
    assert.equal(projectRoot.props['data-whaledock-panel'], 'project-panes');
    assert(projectNodes.some((node) => node?.props?.['data-project-pane'] === true));
    assert(projectNodes.some((node) => node?.props?.['aria-label'] === '项目模板动作'));
    assert(projectNodes.includes('写脚本'));
    assert(projectNodes.some((node) => node?.props?.['aria-label'] === '新建项目向导'));
    assert(projectNodes.includes('项目模板'));
    assert(projectNodes.includes('选择文件夹并创建'));
    assert(projectNodes.some((node) => node?.props?.['data-window'] === 1));
    assert(projectNodes.some((node) => node?.props?.['data-window'] === 2));
    assert(projectNodes.includes('已验证指纹'));
    assert(projectNodes.includes('output/result.md'));
    assert(projectNodes.includes('# 真实预览\n\n内容已回到项目窗格。'));
    assert(projectNodes.includes('预览不可用或超过安全上限；项目内引用仍可用于核对。'));
    const previewImage = projectNodes.find((node) => node?.type === 'img');
    assert.equal(previewImage.props.src.startsWith('data:image/png;base64,'), true);
    assert.equal(previewImage.props.alt, '封面 预览');
    assert.equal(previewImage.props.loading, 'lazy');
    const templateWindow = projectNodes.find((node) => node?.props?.['data-window'] === 5);
    const templateNodes = [];
    const visitTemplate = (value) => {
      if (value === null || value === undefined || typeof value === 'boolean') return;
      if (Array.isArray(value)) { value.forEach(visitTemplate); return; }
      if (typeof value !== 'object') { templateNodes.push(value); return; }
      templateNodes.push(value);
      visitTemplate(value.props?.children);
    };
    visitTemplate(templateWindow);
    assert(templateNodes.some((node) => node?.props?.['data-project-template']
      === 'builtin:short-video'));
    assert(templateNodes.some((node) => node?.props?.['data-template-five-stage'] === true));
    assert(templateNodes.some((node) => node?.props?.['aria-label'] === '项目阶段'));
    for (const label of ['概览', '脚本', '拍摄', '发布', '复盘']) {
      assert(templateNodes.includes(label), `窗口5 缺少真实阶段：${label}`);
    }
    const iframe = projectNodes.find((node) => node?.type === 'iframe');
    assert.equal(iframe.props.src, 'https://example.com/path');
    assert.equal(iframe.props.sandbox, 'allow-forms allow-scripts');
    assert.equal(iframe.props.referrerPolicy, 'no-referrer');
    assert(projectNodes.some((node) => node?.props?.['aria-label'] === '原生对话'));
    assert(projectNodes.some((node) => node?.fixture === 'native-conversation'),
      '项目窗格不得替换右侧原生对话');
    assert.equal(shell.projectActions.target('current-session').cwd, '/projects/a');
    liveSessionState = {
      phase: 'ready', current: 'session-project-b', ids: ['session-project-b'],
      byId: { 'session-project-b': { cwd: '/projects/b', origin: 'user' } }
    };
    assert.equal(shell.projectActions.target('current-session').cwd, '/projects/b',
      'A→B 打开后项目模板根必须跟随实时当前会话');
    liveSessionState = { phase: 'ready', current: null, ids: [], byId: {} };
    assert.equal(shell.projectActions.target('current-session').ok, false,
      '未 commit/无当前会话时不得借用别的项目根');
    assert.equal(shell.projectActions.target('host').cwd, '/host/classic-root',
      '经典模式仍保留 Host 工作根语义');
  });

  await test('browserOnly 无 fragment/非 loopback 只注册官方 shell，零 gate 与零 RPC', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    const scenarios = [
      { isLoopback: true, hash: '' },
      { isLoopback: false,
        hash: `#whaledockController=controller-12345678&whaledockSelectionToken=${SELECTION_TOKEN}` }
    ];
    for (const scenario of scenarios) {
      let definition = null;
      let rpcCalls = 0;
      let disposed = false;
      let cleanup = null;
      const provided = [];
      const sandbox = {
        window: { __ModuleLoader__: { load(value) { definition = value; } } },
        location: { hash: scenario.hash, pathname: '/', search: '' },
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(source, sandbox, { filename: 'context-poc/browser-client.js' });
      const plugin = definition.factory(clientImport);
      const connection = {
        isLoopback: scenario.isLoopback,
        rpc: { call() { rpcCalls += 1; throw new Error('browserOnly must not call RPC'); } }
      };
      const sessions = {};
      plugin.apply({
        get(name) { return name === 'connection' ? connection : sessions; },
        reflect: {
          provide(name, value) {
            provided.push({ name, value });
            return () => { disposed = true; };
          }
        },
        effect(factory, label) {
          assert.equal(label, 'whaledock-context-bridge: browser-only content shell');
          cleanup = factory();
        }
      });
      assert.deepEqual(provided.map((item) => item.name), ['whaledockContentShell']);
      const shell = provided[0].value;
      assert.equal(shell.contract, 'whaledock.content-shell/v1');
      assert.equal(shell.browserOnly, true);
      assert.equal(shell.preferences, undefined);
      assert.equal(shell.workspaceFiles, undefined);
      assert.equal(shell.whaledockProjects, undefined);
      assert.equal(shell.projectActions, null);
      assert.equal(rpcCalls, 0);
      assert.equal(Object.prototype.hasOwnProperty.call(
        sandbox, '__WHALEDOCK_CONTEXT_MANAGED__'
      ), false);
      assert.equal(typeof cleanup, 'function');
      cleanup();
      assert.equal(disposed, true);
    }
  });

  await test('Client 静态 bundle 上报选择，并串行保留偏好写入的最后意图', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    const storage = new Map();
    const timers = new Map();
    let timerId = 0;
    const replacedUrls = [];
    let uuidSequence = 0;
    const sandbox = {
      window: { __ModuleLoader__: { load(value) { definition = value; } } },
      location: {
        hash: `#whaledockController=controller-12345678&whaledockSelectionToken=${SELECTION_TOKEN}`,
        pathname: '/',
        search: '?native=preserved'
      },
      history: {
        state: { native: true },
        replaceState(state, title, url) { replacedUrls.push({ state, title, url }); }
      },
      crypto: { randomUUID: () => (
        `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
      ) },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value))
      },
      setInterval(fn) { const id = ++timerId; timers.set(id, fn); return id; },
      clearInterval(id) { timers.delete(id); },
      setTimeout,
      clearTimeout,
      URLSearchParams,
      AbortController,
      Date,
      Symbol,
      Object,
      Number,
      Promise
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'context-poc/client.js' });
    assert.equal(definition.id, '@whaledock/context-bridge-poc');
    const plugin = definition.factory(clientImport);
    assert.deepEqual(Array.from(plugin.inject), ['connection', 'sessions', 'workspaces']);

    const calls = [];
    let current = 'raw-session-a';
    let sessionListener = null;
    let hostListener = null;
    let dispose = null;
    let gate = null;
    let gateDisposed = false;
    let preferences = null;
    let preferencesDisposed = false;
    let workspaceFiles = null;
    let workspaceFilesDisposed = false;
    let whaledockProjects = null;
    let whaledockProjectsDisposed = false;
    let contentShell = null;
    let contentShellDisposed = false;
    let registerCalls = 0;
    let failPreferenceGet = false;
    let preferenceHostSnapshot = {
      revision: 1,
      contentViewMode: 'content',
      contentViewHintSeen: false
    };
    let preferenceWriteHandler = null;
    let workspaceRequestSeq = 0;
    let loseWorkspaceAdmissionReply = false;
    let workspaceStatusHandler = null;
    let workspaceRealm = (value) => value;
    const preferenceProtocolEvents = [];
    const connection = {
      isLoopback: true,
      rpc: {
        call: async (channel, endpoint, payload) => {
          calls.push({ channel, endpoint, payload });
          if (endpoint === 'selection/register' && ++registerCalls === 3) {
            return {
              ok: true,
              value: {
                state: 'ignored-stale',
                code: 'selection-revision-stale',
                selectionRevision: 5
              }
            };
          }
          if (endpoint === 'selection/register') {
            return { ok: true, value: {
              state: 'selected', code: null, selectionRevision: payload.selectionRevision
            } };
          }
          if (endpoint === 'ui/preferences/get') {
            if (failPreferenceGet) throw new Error('preference fixture unavailable');
            preferenceProtocolEvents.push(`get:${preferenceHostSnapshot.revision}`);
            return { ok: true, value: { snapshot: { ...preferenceHostSnapshot } } };
          }
          if (endpoint === 'ui/preferences/write') {
            preferenceProtocolEvents.push(`write:${payload.baseRevision}`);
            if (preferenceWriteHandler) return preferenceWriteHandler(payload);
            return { ok: true, value: {
              accepted: true,
              code: null,
              snapshot: {
                revision: 2,
                contentViewMode: 'sessions',
                contentViewHintSeen: false
              }
            } };
          }
          if (endpoint === 'workspace/files/request') {
            workspaceRequestSeq += 1;
            if (loseWorkspaceAdmissionReply) throw new Error('admission reply lost');
            return workspaceRealm({ ok: true, value: {
              accepted: true,
              requestToken: workspaceRequestSeq.toString(16).padStart(64, '0'),
              state: 'queued',
              code: null,
              deadlineMs: Date.now() + 10000
            } });
          }
          if (endpoint === 'workspace/files/status') {
            if (workspaceStatusHandler) return workspaceStatusHandler(payload);
            return workspaceRealm({ ok: true, value: {
              requestToken: payload.requestToken,
              state: 'queued',
              code: null,
              result: null
            } });
          }
          if (endpoint === 'workspace/files/cancel') {
            return workspaceRealm({ ok: true, value: {
              cancelled: true,
              code: 'cancelled',
              snapshot: {
                requestToken: payload.requestToken,
                state: 'cancelled',
                code: 'cancelled',
                result: null
              }
            } });
          }
          return { ok: true, value: {} };
        }
      },
      hostDescription: {
        subscribe(listener) { hostListener = listener; return () => { hostListener = null; }; }
      }
    };
    const sessions = {
      list: {
        getSnapshot: () => ({ phase: 'ready', current }),
        subscribe(listener) { sessionListener = listener; return () => { sessionListener = null; }; }
      }
    };
    plugin.apply({
      get: (name) => (name === 'connection' ? connection : sessions),
      reflect: {
        provide(name, value) {
          if (name === 'whaledockContextGate') {
            gate = value;
            return () => { gateDisposed = true; };
          }
          if (name === 'whaledockShellPreferences') {
            preferences = value;
            return () => { preferencesDisposed = true; };
          }
          if (name === 'whaledockWorkspaceFiles') {
            workspaceFiles = value;
            return () => { workspaceFilesDisposed = true; };
          }
          if (name === 'whaledockProjects') {
            whaledockProjects = value;
            return () => { whaledockProjectsDisposed = true; };
          }
          assert.equal(name, 'whaledockContentShell');
          contentShell = value;
          return () => { contentShellDisposed = true; };
        }
      },
      effect: (factory) => { dispose = factory(); }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(Object.getOwnPropertyDescriptor(
      sandbox, '__WHALEDOCK_CONTEXT_MANAGED__'
    ), {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    }, 'Client 受管 marker 必须不可覆写、不可重定义且不可枚举');
    assert.deepEqual(replacedUrls, [{
      state: { native: true }, title: '', url: '/?native=preserved'
    }]);
    let selectionCalls = calls.filter((call) => call.endpoint === 'selection/register');
    assert.equal(selectionCalls.length, 1);
    assert.equal(selectionCalls[0].payload.currentSessionId, 'raw-session-a');
    assert.equal(selectionCalls[0].payload.selectionRevision, 1);
    assert.equal(selectionCalls[0].payload.managed, true);
    assert.equal(selectionCalls[0].payload.selectionToken, SELECTION_TOKEN);
    assert.match(selectionCalls[0].payload.registerNonce, /^[a-f0-9]{32}$/);
    assert.match(selectionCalls[0].payload.controllerProof, /^[a-f0-9]{64}$/);
    assert.equal(selectionCalls[0].payload.issuedAtMs <= Date.now(), true);
    assert.equal(
      storage.get('whaledock.context.controller-proof.controller-12345678'),
      selectionCalls[0].payload.controllerProof
    );
    assert.deepEqual(JSON.parse(JSON.stringify(preferences.getSnapshot())), {
      revision: 1,
      contentViewMode: 'content',
      contentViewHintSeen: false
    });

    current = 'raw-session-b';
    sessionListener();
    await Promise.resolve();
    selectionCalls = calls.filter((call) => call.endpoint === 'selection/register');
    assert.equal(selectionCalls[1].payload.selectionRevision, 2);
    assert.equal(selectionCalls[1].payload.currentSessionId, 'raw-session-b');
    hostListener();
    await new Promise((resolve) => setImmediate(resolve));
    selectionCalls = calls.filter((call) => call.endpoint === 'selection/register');
    assert.equal(selectionCalls[2].payload.selectionRevision, 2);
    assert.equal(selectionCalls[3].payload.selectionRevision, 6);
    assert.equal(storage.get('whaledock.context.selection.controller-12345678'), '6');
    let notified = null;
    const unsubscribePreference = preferences.subscribe((value) => { notified = value; });
    let settleFirstWrite = null;
    preferenceProtocolEvents.length = 0;
    preferenceWriteHandler = (payload) => {
      if (payload.baseRevision === 1) {
        return new Promise((resolve) => {
          settleFirstWrite = () => {
            preferenceHostSnapshot = {
              revision: 2,
              contentViewMode: 'sessions',
              contentViewHintSeen: false
            };
            resolve({ ok: true, value: {
              accepted: true, code: null, snapshot: { ...preferenceHostSnapshot }
            } });
          };
        });
      }
      assert.equal(payload.baseRevision, 2, '第二次点击必须读取第一次 settle 后的新 revision');
      preferenceHostSnapshot = {
        revision: 3,
        contentViewMode: 'content',
        contentViewHintSeen: false
      };
      return { ok: true, value: {
        accepted: true, code: null, snapshot: { ...preferenceHostSnapshot }
      } };
    };
    const firstPreferenceWrite = preferences.write({ contentViewMode: 'sessions' });
    const lastPreferenceWrite = preferences.write({ contentViewMode: 'content' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof settleFirstWrite, 'function');
    assert.equal(calls.filter((call) => call.endpoint === 'ui/preferences/write').length, 1,
      '第一次 settle 前第二次点击必须留在队列，不能并发使用旧 revision');
    const preferenceCall = calls.find((call) => call.endpoint === 'ui/preferences/write');
    assert.deepEqual(Object.keys(preferenceCall.payload).sort(), [
      'baseRevision', 'contract', 'controllerId', 'controllerProof', 'pageInstanceId',
      'patch', 'selectionRevision', 'selectionToken'
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(preferenceCall.payload, 'sessionRef'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(preferenceCall.payload, 'currentSessionId'), false);
    settleFirstWrite();
    assert.deepEqual(JSON.parse(JSON.stringify(await firstPreferenceWrite)), {
      ok: true, code: null
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await lastPreferenceWrite)), {
      ok: true, code: null
    });
    const preferenceCalls = calls.filter((call) => call.endpoint === 'ui/preferences/write');
    assert.deepEqual(preferenceCalls.map((call) => call.payload.baseRevision), [1, 2]);
    assert.deepEqual(preferenceProtocolEvents, ['get:1', 'write:1', 'get:2', 'write:2']);
    assert.equal(notified.contentViewMode, 'content');
    assert.deepEqual(JSON.parse(JSON.stringify(preferences.getSnapshot())), {
      revision: 3,
      contentViewMode: 'content',
      contentViewHintSeen: false
    }, '快速 A→B 最终必须保留最后一次点击 B');

    let rejectFailedWrite = null;
    let failureAttempts = 0;
    preferenceProtocolEvents.length = 0;
    preferenceWriteHandler = (payload) => {
      failureAttempts += 1;
      if (failureAttempts === 1) {
        return new Promise((_resolve, reject) => { rejectFailedWrite = reject; });
      }
      assert.equal(payload.baseRevision, 3, '前一次失败不得虚增 revision');
      preferenceHostSnapshot = {
        revision: 4,
        contentViewMode: 'sessions',
        contentViewHintSeen: false
      };
      return { ok: true, value: {
        accepted: true, code: null, snapshot: { ...preferenceHostSnapshot }
      } };
    };
    const failedPreferenceWrite = preferences.write({ contentViewHintSeen: true });
    const recoveredPreferenceWrite = preferences.write({ contentViewMode: 'sessions' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof rejectFailedWrite, 'function');
    assert.equal(failureAttempts, 1, '失败写入未结束前后继点击仍必须排队');
    rejectFailedWrite(new Error('deferred preference failure'));
    assert.deepEqual(JSON.parse(JSON.stringify(await failedPreferenceWrite)), {
      ok: false, code: 'preferences-unavailable'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await recoveredPreferenceWrite)), {
      ok: true, code: null
    }, '失败必须释放串行队列');
    assert.equal(failureAttempts, 2);
    assert.deepEqual(preferenceProtocolEvents, ['get:3', 'write:3', 'get:3', 'write:3']);
    assert.deepEqual(JSON.parse(JSON.stringify(preferences.getSnapshot())), {
      revision: 4,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    });
    assert.equal(JSON.stringify(preferences.getSnapshot()).includes(SELECTION_TOKEN), false);
    failPreferenceGet = true;
    assert.equal((await preferences.refresh()).ok, false);
    assert.equal(typeof gate.beforeSend, 'function', 'preferences 失败不能移除 context gate');
    unsubscribePreference();
    assert.equal(timers.size, 1);
    assert.equal(typeof gate.beforeSend, 'function');
    assert.equal(contentShell.contract, 'whaledock.content-shell/v1');
    assert.equal(typeof contentShell.Component, 'function');
    assert.equal(contentShell.preferences, preferences);
    assert.equal(contentShell.workspaceFiles, workspaceFiles);
    assert.equal(contentShell.whaledockProjects, whaledockProjects,
      '可见 shell 必须消费同一个全局项目服务实例');
    assert.deepEqual(Object.keys(whaledockProjects).sort(), [
      'bindCurrent', 'create', 'list', 'open', 'readConsole', 'remove', 'reorder', 'update'
    ]);
    // 前半段历史 fixture 显式注入了外层 Object；文件协议会构造
    // 安全深拷贝，这里切回浏览器实际的同 realm Object/response。
    delete sandbox.Object;
    workspaceRealm = (value) => vm.runInNewContext(
      `(${JSON.stringify(value)})`, sandbox
    );
    const workspaceInput = (source) => vm.runInNewContext(`(${source})`, sandbox);
    const beforeInvalidWorkspaceCall = calls.length;
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.request(
      'catalog.read', workspaceInput("{ cwd: '/private/forbidden' }")
    ))), {
      accepted: false, requestToken: null, state: 'rejected',
      code: 'operation-invalid', deadlineMs: null
    });
    assert.equal(calls.length, beforeInvalidWorkspaceCall,
      'Client 禁止键必须在本地拒绝，不得进入 RPC');
    assert.equal((await workspaceFiles.request(
      'catalog.read', workspaceInput("{ Absolute_Path: '/private/forbidden' }")
    )).code, 'operation-invalid', '禁止键大小写/分隔符变体也须本地拒绝');
    const queued = await workspaceFiles.request('catalog.read', workspaceInput('{}'));
    assert.equal(queued.accepted, true, JSON.stringify({ queued, calls: calls.slice(-3) }));
    const workspaceRequestCall = calls.find((call) => (
      call.endpoint === 'workspace/files/request'
    ));
    assert.deepEqual(Object.keys(workspaceRequestCall.payload).sort(), [
      'contract', 'controllerId', 'controllerProof', 'input', 'operation',
      'pageInstanceId', 'selectionRevision', 'selectionToken'
    ]);
    assert.equal(JSON.stringify(workspaceRequestCall.payload).includes('raw-session-b'), false);
    loseWorkspaceAdmissionReply = true;
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.request(
      'catalog.read', workspaceInput('{}')
    ))), {
      accepted: false, requestToken: null, state: 'rejected',
      code: 'outcome-unknown', deadlineMs: null
    }, 'Host 可能已入队但响应丢失时不得伪报确定未执行');
    loseWorkspaceAdmissionReply = false;
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.status(
      queued.requestToken
    ))), {
      requestToken: queued.requestToken, state: 'queued', code: null, result: null
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.cancel(
      queued.requestToken
    ))), {
      cancelled: true,
      code: 'cancelled',
      snapshot: {
        requestToken: queued.requestToken,
        state: 'cancelled',
        code: 'cancelled',
        result: null
      }
    });
    workspaceStatusHandler = (payload) => workspaceRealm({ ok: true, value: {
      requestToken: payload.requestToken,
      state: 'fulfilled',
      code: null,
      result: { projects: [{ projectToken: 'project-safe', title: '可见项目' }] }
    } });
    const executed = await workspaceFiles.execute('catalog.read', workspaceInput('{}'));
    assert.deepEqual(JSON.parse(JSON.stringify(executed)), {
      requestToken: '3'.padStart(64, '0'),
      state: 'fulfilled',
      code: null,
      result: { projects: [{ projectToken: 'project-safe', title: '可见项目' }] }
    });
    workspaceStatusHandler = (payload) => workspaceRealm({ ok: true, value: {
      requestToken: payload.requestToken,
      state: 'fulfilled',
      code: null,
      result: { cwd: '/private/leak' }
    } });
    assert.equal(await workspaceFiles.status(executed.requestToken), null,
      'Client 不得接纳 Host 回包中的工作区绝对路径');
    dispose();
    assert.equal(timers.size, 0);
    assert.equal(gateDisposed, true);
    assert.equal(preferencesDisposed, true);
    assert.equal(workspaceFilesDisposed, true);
    assert.equal(whaledockProjectsDisposed, true);
    assert.equal(contentShellDisposed, true);
  });

  await test('Client whaledockProjects 全局服务脱敏并在真实 sessions.open 后才 commit', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    let uuidSequence = 0;
    let intervalId = 0;
    let cleanup = null;
    let projectService = null;
    let contentShell = null;
    let projectServiceDisposed = false;
    let sessionUpdate = null;
    const intervals = new Map();
    const storage = new Map();
    const sandbox = {
      window: { __ModuleLoader__: { load(value) { definition = value; } } },
      location: {
        hash: `#whaledockController=controller-projectclient&whaledockSelectionToken=${SELECTION_TOKEN}`,
        pathname: '/', search: ''
      },
      history: { state: null, replaceState() {} },
      crypto: { randomUUID: () => (
        `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
      ) },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value))
      },
      setInterval(fn, delay) {
        const id = ++intervalId;
        intervals.set(id, { fn, delay });
        return id;
      },
      clearInterval(id) { intervals.delete(id); },
      setTimeout,
      clearTimeout,
      URLSearchParams,
      AbortController,
      Date,
      Symbol,
      Number,
      Promise
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'context-poc/projects-client.js' });
    const plugin = definition.factory(clientImport);
    const realm = (value) => vm.runInNewContext(`(${JSON.stringify(value)})`, sandbox);
    const rawA = 'client-project-raw-a';
    const rawB = 'client-project-raw-b';
    const bindingA = sessionBindingRef(rawA);
    const projectId = `proj_${'d'.repeat(32)}`;
    const openToken = `project-open-${'e'.repeat(64)}`;
    const sessionSnapshot = realm({
      phase: 'ready',
      current: null,
      byId: {
        [rawA]: {
          running: true,
          completed: false,
          pendingInteraction: null,
          parentId: null,
          displayTitle: '会话 A',
          updatedAt: 1000,
          cwd: '/private/must-not-cross'
        },
        [rawB]: {
          running: false,
          completed: true,
          pendingInteraction: 'question',
          parentId: null,
          displayTitle: '会话 B',
          updatedAt: 2000,
          cwd: '/private/must-not-cross'
        }
      },
      subagentsByParent: {},
      jobsBySession: {
        [rawA]: [{ status: 'running', startedAt: 900 }]
      }
    });
    const requests = new Map();
    const calls = [];
    const events = [];
    let sequence = 0;
    let mutateCwdOnCommitResult = false;
    let churnSelectionOnCommitResult = false;
    let prepareUnbound = false;
    let bootstrapReply = null;
    let bootstrapCalls = 0;
    const resultFor = (request) => {
      if (request.operation === 'projects.list') {
        return {
          kind: 'projects', revision: 1, cursor: 0, nextCursor: null,
          projects: [], switchCommand: null, templateCatalog: []
        };
      }
      if (request.operation === 'projects.update') {
        return {
          kind: 'project', revision: 2,
          project: {
            projectId, kind: 'user', name: '新名字', icon: '🧱',
            hasFolder: true, hidden: false, pinned: false
          }
        };
      }
      if (request.operation === 'projects.bind') {
        return { kind: 'binding', revision: 3, projectId, bindingRef: sessionBindingRef(rawB) };
      }
      if (request.operation === 'console.read') {
        return {
          kind: 'console', revision: 3, cards: [],
          counts: { need: 0, done: 0, busy: 0, idle: 0, total: 0, glowing: 0 }
        };
      }
      if (request.operation === 'projects.open' && request.input.phase === 'prepare') {
        if (prepareUnbound) {
          return {
            kind: 'open-prepared',
            project: {
              projectId, kind: 'user', name: '项目', icon: '🧱', hasFolder: true,
              hasBinding: false,
              hidden: false, pinned: false, folderTail: '项目', templateId: null,
              layoutPreset: null, paneState: null
            },
            bindingRef: null,
            openToken,
            bootstrapTicket: `project-bootstrap-v1.${'A'.repeat(16)}.${'B'.repeat(32)}.${'C'.repeat(22)}`
          };
        }
        return {
          kind: 'open-prepared',
          project: {
            projectId, kind: 'user', name: '项目', icon: '🧱', hasFolder: true,
            hasBinding: true,
            hidden: false, pinned: false, folderTail: '项目', templateId: null,
            layoutPreset: null, paneState: null
          },
          bindingRef: bindingA,
          openToken
        };
      }
      if (request.operation === 'projects.open' && request.input.phase === 'commit') {
        if (mutateCwdOnCommitResult) {
          mutateCwdOnCommitResult = false;
          sessionSnapshot.byId[rawA].cwd = '/changed-during-commit';
        }
        if (churnSelectionOnCommitResult) {
          churnSelectionOnCommitResult = false;
          sessionSnapshot.current = rawB;
          sessionUpdate();
          sessionSnapshot.current = rawA;
          sessionUpdate();
        }
        return {
          kind: 'open-committed',
          project: {
            projectId, kind: 'user', name: '项目', icon: '🧱', hasFolder: true,
            hasBinding: true,
            hidden: false, pinned: false, folderTail: '项目', templateId: null,
            layoutPreset: null, paneState: null
          },
          bindingRef: bindingA
        };
      }
      throw new Error(`unexpected operation ${request.operation}`);
    };
    const connection = {
      isLoopback: true,
      rpc: {
        async call(_channel, endpoint, payload) {
          calls.push({ endpoint, payload });
          if (endpoint === 'selection/register') {
            return realm({ ok: true, value: {
              state: payload.currentSessionId === null ? 'none' : 'selected',
              code: null,
              selectionRevision: payload.selectionRevision
            } });
          }
          if (endpoint === 'ui/preferences/get') {
            return realm({ ok: true, value: { snapshot: {
              revision: 1, contentViewMode: 'content', contentViewHintSeen: false
            } } });
          }
          if (endpoint === 'workspace/files/request') {
            const requestToken = (++sequence).toString(16).padStart(64, '0');
            requests.set(requestToken, {
              operation: payload.operation,
              input: JSON.parse(JSON.stringify(payload.input))
            });
            if (payload.operation === 'projects.open' && payload.input.phase === 'commit') {
              events.push('commit');
            }
            return realm({ ok: true, value: {
              accepted: true, requestToken, state: 'queued', code: null,
              deadlineMs: Date.now() + 10000
            } });
          }
          if (endpoint === 'workspace/files/status') {
            const request = requests.get(payload.requestToken);
            return realm({ ok: true, value: {
              requestToken: payload.requestToken,
              state: 'fulfilled',
              code: null,
              result: resultFor(request)
            } });
          }
          if (endpoint === 'projects/session/resolve') {
            const candidateIndex = payload.candidateSessionIds.indexOf(rawA);
            return realm({ ok: true, value: {
              resolved: candidateIndex >= 0,
              candidateIndex: candidateIndex >= 0 ? candidateIndex : null,
              code: candidateIndex >= 0 ? null : 'workspace-unavailable'
            } });
          }
          if (endpoint === 'projects/session/bootstrap') {
            bootstrapCalls += 1;
            return realm(bootstrapReply);
          }
          throw new Error(`unexpected endpoint ${endpoint}`);
        }
      },
      hostDescription: { subscribe() { return () => {}; } }
    };
    const sessions = {
      list: {
        getSnapshot: () => sessionSnapshot,
        subscribe(listener) { sessionUpdate = listener; return () => {}; }
      },
      open(id) {
        assert.equal(id, rawA);
        events.push('sessions.open');
        sessionSnapshot.current = id;
      }
    };
    plugin.apply({
      get: (name) => (name === 'connection' ? connection : sessions),
      reflect: {
        provide(name, value) {
          if (name === 'whaledockProjects') {
            projectService = value;
            return () => { projectServiceDisposed = true; };
          }
          if (name === 'whaledockContentShell') {
            contentShell = value;
          }
          return () => {};
        }
      },
      effect(factory) { cleanup = factory(); }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert(projectService);
    assert(contentShell);
    assert.equal(intervals.size, 1);

    const list = await projectService.list(realm({}));
    assert.equal(list.state, 'fulfilled', '当前会话为null仍可列项目');
    const listRequest = [...requests.values()].find((request) => request.operation === 'projects.list');
    assert.deepEqual(listRequest.input, { cursor: 0, limit: 32, includeHidden: false });

    const updated = await projectService.update(realm({
      projectId, changes: { name: '新名字' }
    }));
    assert.equal(updated.state, 'fulfilled');
    const updateRequest = [...requests.values()].find((request) => (
      request.operation === 'projects.update'
    ));
    assert.deepEqual(updateRequest.input, { projectId, changes: { name: '新名字' } });
    assert.equal(Object.prototype.hasOwnProperty.call(updateRequest.input, 'patch'), false);
    const beforeForbiddenCreate = calls.length;
    assert.equal((await projectService.create(realm({
      folder: '/private/must-not-cross'
    }))).code, 'operation-invalid');
    assert.equal(calls.length, beforeForbiddenCreate,
      '页面项目 API 不得把 folder/path 送进 RPC');

    sessionSnapshot.current = rawB;
    const bound = await projectService.bindCurrent(realm({ projectId }));
    assert.equal(bound.state, 'fulfilled');
    const bindRequest = [...requests.values()].find((request) => request.operation === 'projects.bind');
    assert.deepEqual(bindRequest.input, { projectId },
      'Client API 只请求绑当前会话，bindingRef 由 Host 注入');

    const consoleResult = await projectService.readConsole();
    assert.equal(consoleResult.state, 'fulfilled');
    const consoleRequest = [...requests.values()].find((request) => (
      request.operation === 'console.read'
    ));
    assert.equal(JSON.stringify(consoleRequest.input).includes('/private/must-not-cross'), false);
    assert.equal(JSON.stringify(consoleRequest.input).includes(rawA), true,
      'raw id 只存在 Client→Host 的受信 console snapshot');
    assert.deepEqual(Object.keys(consoleRequest.input.snapshot.byId[0]).sort(), [
      'completed', 'displayTitle', 'parentId', 'pendingInteraction',
      'running', 'sessionId', 'updatedAt'
    ]);

    await contentShell.projectDetailReader(projectId);
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      'prepare-only 详情不得解锁五阶段模板');
    const opened = await projectService.open(realm({ projectId }));
    assert.equal(opened.state, 'fulfilled');
    assert.deepEqual(events, ['sessions.open', 'commit'],
      'Host commit 前必须先调用官方 sessions.open');
    const resolverCall = calls.find((call) => call.endpoint === 'projects/session/resolve');
    assert.equal(resolverCall.payload.bindingRef, bindingA);
    assert.deepEqual(Array.from(resolverCall.payload.candidateSessionIds), [rawA, rawB]);
    const commitRequest = [...requests.values()].find((request) => (
      request.operation === 'projects.open' && request.input.phase === 'commit'
    ));
    assert.deepEqual(commitRequest.input, {
      projectId, phase: 'commit', openToken, bindingRef: bindingA
    });
    assert.equal(JSON.stringify(opened).includes(rawA), false,
      'whaledockProjects.open 公开结果不得带 raw session id');
    const openRegistration = calls.filter((call) => (
      call.endpoint === 'selection/register'
    )).at(-1);
    assert.equal(openRegistration.payload.currentSessionId, rawA,
      'commit 前 Host selection 已与真实打开的会话对齐');
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), true,
      '真实 commit 后且 selection 未变时才可消费项目绑定模板');
    sessionSnapshot.byId[rawA].cwd = '/different-root';
    sessionUpdate();
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      '同一 raw session 的 cwd 变化必须立即永久失效当前 open generation');
    sessionSnapshot.byId[rawA].cwd = '/private/must-not-cross';
    sessionUpdate();
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      'cwd A→B→A 不能复活旧 generation');
    const reopenedAfterCwdChange = await projectService.open(realm({ projectId }));
    assert.equal(reopenedAfterCwdChange.state, 'fulfilled');
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), true,
      'cwd 变化后必须重新完成两阶段 open 才能恢复');
    mutateCwdOnCommitResult = true;
    const racedOpen = await projectService.open(realm({ projectId }));
    assert.equal(racedOpen.state, 'fulfilled', '攻击样例中 main commit 本身仍可成功');
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      'commit 请求与回包之间 cwd A→B 时不得解锁 Client 项目根');
    const reopenedAfterCommitRace = await projectService.open(realm({ projectId }));
    assert.equal(reopenedAfterCommitRace.state, 'fulfilled');
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), true,
      '只有在新 cwd 上再次稳定完成两阶段 open 才能重新解锁');
    churnSelectionOnCommitResult = true;
    const selectionRacedOpen = await projectService.open(realm({ projectId }));
    assert.equal(selectionRacedOpen.state, 'fulfilled');
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      'commit 窗口内 selection A→B→A 也不得建立旧 generation');
    const reopenedAfterSelectionRace = await projectService.open(realm({ projectId }));
    assert.equal(reopenedAfterSelectionRace.state, 'fulfilled');
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), true,
      'selection 竞态后也必须 fresh open 才能恢复');
    sessionSnapshot.current = rawB;
    sessionUpdate();
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      'selection 离开绑定会话时必须立即永久失效本次 open generation');
    sessionSnapshot.current = rawA;
    sessionUpdate();
    assert.equal(contentShell.projectOpenCurrent(projectId, bindingA), false,
      'A→B→A 不能复活旧 generation，必须重新两阶段 open');

    prepareUnbound = true;
    sessionSnapshot.current = null;
    sessionUpdate();
    const malformedBootstrapReplies = [
      { ok: true, value: { unexpected: true } },
      { ok: true, value: { bootstrapped: true, bindingRef: 'invalid', code: null } },
      { ok: true, value: {
        bootstrapped: false, bindingRef: bindingA, code: 'workspace-unavailable'
      } }
    ];
    for (const reply of malformedBootstrapReplies) {
      bootstrapReply = reply;
      const failed = await projectService.open(realm({ projectId }));
      assert.equal(failed.state, 'rejected');
      assert.equal(failed.code, 'outcome-unknown',
        'Host bootstrap 调用后非法回包必须保守表达外部副作用不确定');
    }
    assert.equal(bootstrapCalls, malformedBootstrapReplies.length);

    cleanup();
    assert.equal(projectServiceDisposed, true);
    assert.equal(intervals.size, 0);
  });

  await test('Client revision 0 以 50/100/200/400/800ms 有界快速重试并立即采用 rev1', async () => {
    const clientSource = fs.readFileSync(
      path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8'
    );
    assert.match(clientSource,
      /PREFERENCE_BOOTSTRAP_RETRY_MS = Object\.freeze\(\[50, 100, 200, 400, 800\]\)/);
    assert.match(clientSource,
      /preferenceBootstrapRetryIndex >= PREFERENCE_BOOTSTRAP_RETRY_MS\.length/,
      '启动重试必须在固定数组末尾停止');

    const createFixture = async () => {
      let definition = null;
      let uuidSequence = 0;
      let timerId = 0;
      let dispose = null;
      let preferences = null;
      const timeouts = new Map();
      const timeoutDelays = [];
      const intervals = new Map();
      const getRevisions = [];
      const host = {
        snapshot: {
          revision: 0,
          contentViewMode: 'content',
          contentViewHintSeen: false
        }
      };
      const storage = new Map();
      const sandbox = {
        window: { __ModuleLoader__: { load(value) { definition = value; } } },
        location: {
          hash: `#whaledockController=controller-bootstrap1&whaledockSelectionToken=${SELECTION_TOKEN}`,
          pathname: '/',
          search: ''
        },
        history: { state: null, replaceState() {} },
        crypto: { randomUUID: () => (
          `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
        ) },
        sessionStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value))
        },
        setTimeout(fn, delay) {
          const id = ++timerId;
          timeoutDelays.push(delay);
          timeouts.set(id, { fn, delay });
          return id;
        },
        clearTimeout(id) { timeouts.delete(id); },
        setInterval(fn, delay) {
          const id = ++timerId;
          intervals.set(id, { fn, delay });
          return id;
        },
        clearInterval(id) { intervals.delete(id); },
        URLSearchParams,
        AbortController,
        Date,
        Symbol,
        Object,
        Number,
        Promise
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(clientSource, sandbox, { filename: 'context-poc/bootstrap-client.js' });
      const plugin = definition.factory(clientImport);
      const connection = {
        isLoopback: true,
        rpc: {
          async call(_channel, endpoint) {
            if (endpoint === 'selection/register') {
              return { ok: true, value: {
                state: 'selected', code: null, selectionRevision: 1
              } };
            }
            assert.equal(endpoint, 'ui/preferences/get');
            getRevisions.push(host.snapshot.revision);
            return { ok: true, value: { snapshot: { ...host.snapshot } } };
          }
        },
        hostDescription: { subscribe() { return () => {}; } }
      };
      const sessions = {
        list: {
          getSnapshot: () => ({ phase: 'ready', current: 'raw-session-bootstrap' }),
          subscribe() { return () => {}; }
        }
      };
      plugin.apply({
        get: (name) => (name === 'connection' ? connection : sessions),
        reflect: {
          provide(name, value) {
            if (name === 'whaledockShellPreferences') preferences = value;
            return () => {};
          }
        },
        effect(factory) { dispose = factory(); }
      });
      const flush = async () => {
        await Promise.resolve();
        await new Promise((resolve) => setImmediate(resolve));
      };
      await flush();
      return {
        host,
        preferences,
        timeouts,
        timeoutDelays,
        intervals,
        getRevisions,
        dispose,
        async runNext(delay) {
          const next = timeouts.entries().next().value;
          assert.ok(next, `缺少 ${delay}ms 启动重试`);
          const [id, timer] = next;
          assert.equal(timer.delay, delay);
          timeouts.delete(id);
          timer.fn();
          await flush();
        }
      };
    };

    const adopting = await createFixture();
    assert.deepEqual(adopting.getRevisions, [0]);
    assert.deepEqual([...adopting.intervals.values()].map((item) => item.delay), [5000],
      '正常 heartbeat 仍保持 5s');
    for (const delay of [50, 100, 200, 400]) await adopting.runNext(delay);
    adopting.host.snapshot = {
      revision: 1,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    };
    await adopting.runNext(800);
    assert.deepEqual(adopting.timeoutDelays, [50, 100, 200, 400, 800]);
    assert.deepEqual(adopting.getRevisions, [0, 0, 0, 0, 0, 1]);
    assert.deepEqual(JSON.parse(JSON.stringify(adopting.preferences.getSnapshot())), {
      revision: 1,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    }, 'main sync rev1 后必须在 5s heartbeat 前采用 sessions');
    assert.equal(adopting.timeouts.size, 0, 'rev>=1 必须立即停止快速重试');
    adopting.dispose();
    assert.equal(adopting.intervals.size, 0);

    const bounded = await createFixture();
    for (const delay of [50, 100, 200, 400, 800]) await bounded.runNext(delay);
    assert.deepEqual(bounded.timeoutDelays, [50, 100, 200, 400, 800]);
    assert.equal(bounded.timeouts.size, 0, 'rev0 也不得进入无限轮询');
    assert.deepEqual(bounded.getRevisions, [0, 0, 0, 0, 0, 0]);
    bounded.dispose();
    assert.equal(bounded.intervals.size, 0);
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-context-plugin-'));
  const oldToken = process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
  const oldSelectionToken = process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN;
  try {
    const nodeModules = path.join(tmp, 'node_modules');
    const packageRoot = path.join(nodeModules, '@whaledock', 'context-bridge-poc');
    fs.mkdirSync(path.dirname(packageRoot), { recursive: true });
    fs.cpSync(path.join(sourceRoot, 'plugin'), packageRoot, { recursive: true });
    const llmFixtureRoot = path.join(nodeModules, '@deepseek-ai', 'dsh-llm');
    fs.mkdirSync(path.join(llmFixtureRoot, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(llmFixtureRoot, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      version: '0.1.1-rc.2',
      type: 'module',
      exports: { '.': './lib/index.js' }
    }));
    fs.writeFileSync(path.join(llmFixtureRoot, 'lib', 'index.js'), [
      'export function isAgentLoopRequest(value) {',
      "  return Boolean(value && value.__agentLoop === 'fixture');",
      '}',
      'export function markAgentLoopRequest(value) {',
      "  return { ...value, __agentLoop: 'fixture' };",
      '}'
    ].join('\n'));
    process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN = BRIDGE_TOKEN;
    process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN = SELECTION_TOKEN;
    const hostPlugin = await import(`${pathToFileURL(path.join(packageRoot, 'lib', 'index.js')).href}?t=${Date.now()}`);
    const llm = await import(pathToFileURL(path.join(
      llmFixtureRoot, 'lib', 'index.js'
    )).href);

    await test('register nonce/时效/接管 proof fail-closed，公共回包不含 sessionRef', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;
      try {
        const base = selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-proof0001',
          pageInstanceId: 'page-proof00000001',
          selectionRevision: 1,
          currentSessionId: 'proof-raw-session',
          managed: true
        });
        const first = await rpcHandler('selection/register', base);
        assert.equal(first.value.state, 'selected');
        assert.equal(Object.prototype.hasOwnProperty.call(first.value, 'sessionRef'), false);
        assert.equal(JSON.stringify(first).includes('proof-raw-session'), false);
        assert.equal((await rpcHandler('selection/register', base)).ok, false, 'nonce 不可重放');

        const forged = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: base.controllerId,
          pageInstanceId: 'page-proof00000002',
          selectionRevision: 2,
          currentSessionId: 'proof-raw-session',
          managed: true,
          controllerProof: 'ff'.repeat(32)
        }));
        assert.equal(forged.ok, false, '错误 proof 不得用高 revision 接管');
        const takeover = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: base.controllerId,
          pageInstanceId: 'page-proof00000002',
          selectionRevision: 2,
          currentSessionId: 'proof-raw-session',
          managed: true
        }));
        assert.equal(takeover.value.state, 'selected');
        assert.equal(Object.prototype.hasOwnProperty.call(takeover.value, 'sessionRef'), false);

        const expired = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-proof-old1',
          pageInstanceId: 'page-proof-old0001',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          issuedAtMs: now - 10001
        }));
        const future = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-proof-new1',
          pageInstanceId: 'page-proof-new0001',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          issuedAtMs: now + 1001
        }));
        assert.equal(expired.ok, false);
        assert.equal(future.ok, false);
      } finally {
        Date.now = originalNow;
      }
    });

    await test('deliveryTargetRef 仅由受认证 resolve 返回，同 Host/raw 稳定且跨绑定轮换', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '6d'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const controllerId = 'controller-deliveryref1';
      const pageInstanceId = 'page-deliveryref00001';
      const select = async (currentSessionId, selectionRevision, managed = true) => {
        const registered = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId,
          pageInstanceId,
          selectionRevision,
          currentSessionId,
          managed
        }));
        assert.equal(registered.ok, true);
        assert.equal(Object.prototype.hasOwnProperty.call(
          registered.value, 'deliveryTargetRef'
        ), false, '页面注册回包不得暴露 main 内部 target ref');
        return rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId, authToken
        });
      };

      const rawA = 'delivery-raw-session-a';
      const first = await select(rawA, 1);
      const expectedA = deliveryTargetRef(BRIDGE_TOKEN, hostInstanceId, rawA);
      assert.equal(first.value.state, 'selected');
      assert.equal(first.value.deliveryTargetRef, expectedA);
      assert.match(first.value.deliveryTargetRef, /^delivery-target-[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(first).includes(rawA), false, 'raw session 不得出 dsh');

      const sameRawNewPageLease = await select(rawA, 2);
      assert.notEqual(sameRawNewPageLease.value.sessionRef, first.value.sessionRef,
        '页面 selection lease 更新仍轮换原有随机 sessionRef');
      assert.equal(sameRawNewPageLease.value.deliveryTargetRef, expectedA,
        '同一 Host/raw 的投递绑定必须稳定');

      const rawB = 'delivery-raw-session-b';
      const otherRaw = await select(rawB, 3);
      assert.equal(otherRaw.value.deliveryTargetRef,
        deliveryTargetRef(BRIDGE_TOKEN, hostInstanceId, rawB));
      assert.notEqual(otherRaw.value.deliveryTargetRef, expectedA,
        '不同 raw 不得共享投递绑定');

      const noSelection = await select(null, 4);
      assert.equal(noSelection.value.state, 'none');
      assert.equal(Object.prototype.hasOwnProperty.call(
        noSelection.value, 'deliveryTargetRef'
      ), false, '无选中时不得提供 target ref');

      let secondHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { secondHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const secondNonce = '6e'.repeat(32);
      const secondHello = await secondHandler('handshake', handshakeRequest(secondNonce));
      const secondAuth = rpcSession(
        BRIDGE_TOKEN, secondNonce, secondHello.value.hostInstanceId
      );
      const secondRegistration = selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-deliveryref2',
        pageInstanceId: 'page-deliveryref00002',
        selectionRevision: 1,
        currentSessionId: rawA,
        managed: true
      });
      assert.equal((await secondHandler(
        'selection/register', secondRegistration
      )).value.state, 'selected');
      const secondHost = await secondHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: secondRegistration.controllerId,
        authToken: secondAuth
      });
      assert.equal(secondHost.value.deliveryTargetRef, deliveryTargetRef(
        BRIDGE_TOKEN, secondHello.value.hostInstanceId, rawA
      ));
      assert.notEqual(secondHost.value.deliveryTargetRef, expectedA,
        'hostInstanceId 轮换必须切断旧 Host 绑定');
    });

    await test('无效鉴权不耗限速，endpoint 桶互相隔离且零 token 不可命中 padding', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const originalNow = Date.now;
      const now = originalNow();
      Date.now = () => now;
      try {
        assert.equal((await rpcHandler('selection/resolve', {
          contract: CONTRACT,
          controllerId: 'controller-ratelimit1',
          authToken: '00'.repeat(32)
        })).ok, false);
        for (let index = 0; index < 24; index += 1) {
          assert.equal((await rpcHandler(
            'handshake', handshakeRequest(index.toString(16).padStart(64, '0'), 'ef'.repeat(32))
          )).ok, false);
        }
        const clientNonce = '07'.repeat(32);
        const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
        assert.equal(hello.ok, true, '无效 handshake 不得耗掉 16/s 桶');
        const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
        await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-ratelimit1',
          pageInstanceId: 'page-ratelimit0001',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false
        }));
        for (let index = 0; index < 80; index += 1) {
          assert.equal((await rpcHandler('selection/resolve', {
            contract: CONTRACT,
            controllerId: 'controller-ratelimit1',
            authToken: 'ef'.repeat(32)
          })).ok, false);
        }
        assert.equal((await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId: 'controller-ratelimit1', authToken
        })).ok, true, '无效 auth 不得耗掉 resolve 桶');
        for (let index = 0; index < 64; index += 1) {
          assert.equal((await rpcHandler('events/read', {
            contract: CONTRACT,
            hostInstanceId: hello.value.hostInstanceId,
            afterEventSeq: 0,
            authToken
          })).ok, true);
        }
        assert.equal((await rpcHandler('events/read', {
          contract: CONTRACT,
          hostInstanceId: hello.value.hostInstanceId,
          afterEventSeq: 0,
          authToken
        })).ok, false);
        assert.equal((await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId: 'controller-ratelimit1', authToken
        })).ok, true, 'events 桶耗尽不得拖累 resolve');
      } finally {
        Date.now = originalNow;
      }
    });

    await test('UI preferences 双向协议严格认证、settle 后生效且 3 秒超时有界', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '09'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      assert.equal(hello.value.capabilities.includes('ui-preferences-v1'), true);
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
      const registration = selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-preference1',
        pageInstanceId: 'page-preference00001',
        selectionRevision: 1,
        currentSessionId: null,
        managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).ok, true);
      const pageAuth = {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: registration.selectionRevision,
        selectionToken: registration.selectionToken,
        controllerProof: registration.controllerProof
      };
      const initial = {
        revision: 1,
        contentViewMode: 'content',
        contentViewHintSeen: false
      };
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT,
        snapshot: initial,
        authToken: '00'.repeat(32)
      })).ok, false);
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT,
        snapshot: initial,
        authToken
      })).value.accepted, true);
      const firstGet = await rpcHandler('ui/preferences/get', pageAuth);
      assert.deepEqual(firstGet.value.snapshot, initial);
      assert.equal((await rpcHandler('ui/preferences/get', {
        ...pageAuth,
        selectionToken: '00'.repeat(32)
      })).ok, false);
      assert.equal((await rpcHandler('ui/preferences/get', {
        ...pageAuth,
        controllerProof: 'ff'.repeat(32)
      })).ok, false);

      const writePromise = rpcHandler('ui/preferences/write', {
        ...pageAuth,
        baseRevision: 1,
        patch: { contentViewMode: 'sessions' }
      });
      assert.deepEqual((await rpcHandler('ui/preferences/get', pageAuth)).value.snapshot, initial,
        'write 只进入独立偏好队列，settle 前不得改 Host snapshot');
      assert.equal((await rpcHandler('ui/preferences/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        authToken: '00'.repeat(32)
      })).ok, false, '独立偏好读取只接受 main-auth');
      const requestPage = await rpcHandler('ui/preferences/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        authToken
      });
      assert.deepEqual(Object.keys(requestPage.value).sort(), [
        'contract', 'hostInstanceId', 'requests'
      ]);
      assert.equal(requestPage.value.requests.length, 1);
      const request = requestPage.value.requests[0];
      assert.deepEqual(request.patch, { contentViewMode: 'sessions' });
      assert.match(request.requestToken, /^[a-f0-9]{64}$/);
      assert.equal(Number.isSafeInteger(request.issuedAtMs), true);
      assert.equal(request.deadlineMs - request.issuedAtMs, 3000);
      const serialized = JSON.stringify(request);
      assert.equal(serialized.includes(SELECTION_TOKEN), false);
      assert.equal(serialized.includes(registration.controllerProof), false);
      assert.equal(serialized.includes('sessionRef'), false);
      assert.equal(serialized.includes('eventSeq'), false);
      const untouchedCore = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(untouchedCore.value.events, []);
      assert.equal(untouchedCore.value.throughEventSeq, 0,
        '偏好请求绝不能占用 core journal 序号');
      assert.equal((await rpcHandler('ui/preferences/settle', {
        contract: CONTRACT,
        requestToken: request.requestToken,
        status: 'applied',
        code: null,
        snapshot: {
          revision: 2,
          contentViewMode: 'sessions',
          contentViewHintSeen: false
        },
        authToken: '00'.repeat(32)
      })).ok, false);
      const settled = await rpcHandler('ui/preferences/settle', {
        contract: CONTRACT,
        requestToken: request.requestToken,
        status: 'applied',
        code: null,
        snapshot: {
          revision: 2,
          contentViewMode: 'sessions',
          contentViewHintSeen: false
        },
        authToken
      });
      assert.deepEqual(settled.value, { settled: true });
      const written = await writePromise;
      assert.equal(written.value.accepted, true);
      assert.equal(written.value.snapshot.revision, 2);

      const originalSetTimeout = global.setTimeout;
      const originalDateNow = Date.now;
      let expire = null;
      try {
        global.setTimeout = (callback, delay) => {
          assert.equal(Number.isSafeInteger(delay) && delay >= 0 && delay <= 3000, true,
            'Host timer 不能越过事件绝对 deadline');
          expire = callback;
          return { unref() {} };
        };
        const timeoutPromise = rpcHandler('ui/preferences/write', {
          ...pageAuth,
          baseRevision: 2,
          patch: { contentViewHintSeen: true }
        });
        assert.equal(typeof expire, 'function');
        const timeoutRequestPage = await rpcHandler('ui/preferences/read', {
          contract: CONTRACT,
          hostInstanceId: hello.value.hostInstanceId,
          authToken
        });
        const timeoutRequest = timeoutRequestPage.value.requests[0];
        assert.equal(timeoutRequest.deadlineMs - timeoutRequest.issuedAtMs, 3000);
        global.setTimeout = originalSetTimeout;
        Date.now = () => timeoutRequest.deadlineMs;
        assert.equal((await rpcHandler('ui/preferences/settle', {
          contract: CONTRACT,
          requestToken: timeoutRequest.requestToken,
          status: 'rejected',
          code: 'preferences-timeout',
          snapshot: {
            revision: 2,
            contentViewMode: 'sessions',
            contentViewHintSeen: false
          },
          authToken
        })).ok, false, '绝对 deadline 到点后即使 timer 尚未回调也不得接纳 settle');
        Date.now = originalDateNow;
        const timedOut = await timeoutPromise;
        assert.equal(timedOut.value.accepted, false);
        assert.equal(timedOut.value.code, 'preferences-timeout');
        expire();
      } finally {
        global.setTimeout = originalSetTimeout;
        Date.now = originalDateNow;
      }
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT,
        snapshot: { ...initial, revision: 1_000_000_001 },
        authToken
      })).ok, false);
      assert.equal((await rpcHandler('ui/preferences/write', {
        ...pageAuth,
        baseRevision: 2,
        patch: { contentViewMode: 'invalid' }
      })).ok, false);
    });

    await test('项目全局通道、稳定 binding、console 预算与 open 两阶段均 fail-closed', async () => {
      let rpcHandler = null;
      const rawA = 'project-global-raw-session-a';
      const rawB = 'project-global-raw-session-b';
      const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-project-root-host-'));
      const cwdA = path.join(rootTmp, 'Project-A');
      const cwdB = path.join(rootTmp, 'Project-B');
      fs.mkdirSync(cwdA);
      fs.mkdirSync(cwdB);
      const liveSessions = [
        { header: { id: rawA, cwd: cwdA } },
        { header: { id: rawB, cwd: cwdB } }
      ];
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        sessions: {
          list() { return liveSessions; },
          get(id) { return liveSessions.find((entry) => entry.header.id === id) || null; }
        },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '2b'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const controllerId = 'controller-projectglobal1';
      const pageInstanceId = 'page-projectglobal0001';
      let registration = selectionRequest({
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision: 1,
        currentSessionId: null, managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'none');
      let pageAuth = {
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision: 1,
        selectionToken: SELECTION_TOKEN, controllerProof: registration.controllerProof
      };
      const readOne = () => rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 1, authToken
      });
      const claim = (request) => rpcHandler('workspace/files/claim', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        authToken
      });
      const authorize = (request, claimed) => rpcHandler('workspace/files/authorize', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        claimToken: claimed.value.claimToken,
        authToken
      });
      const settle = (request, claimed, result, authorizationToken = null) => rpcHandler('workspace/files/settle', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        claimToken: claimed.value.claimToken,
        status: 'fulfilled',
        code: null,
        result,
        ...(authorizationToken === null ? {} : {
          rootAuthorizationToken: authorizationToken
        }),
        authToken
      });
      const queue = async (operation, input) => {
        const queued = await rpcHandler('workspace/files/request', {
          ...pageAuth, operation, input
        });
        assert.equal(queued.ok, true);
        assert.equal(queued.value.accepted, true, JSON.stringify(queued));
        const read = await readOne();
        assert.equal(read.value.requests.length, 1);
        assert.equal(read.value.requests[0].operation, operation);
        return read.value.requests[0];
      };
      const finish = async (request, result) => {
        const claimed = await claim(request);
        assert.equal(claimed.value.claimed, true);
        let authorizationToken = null;
        if (Object.prototype.hasOwnProperty.call(request, 'sessionRootRef')) {
          const authorization = await authorize(request, claimed);
          assert.equal(authorization.value.authorized, true);
          authorizationToken = authorization.value.authorizationToken;
        }
        assert.deepEqual(await settle(request, claimed, result, authorizationToken), {
          ok: true, value: { settled: true, code: null }
        });
        return rpcHandler('workspace/files/status', {
          ...pageAuth, requestToken: request.requestToken
        });
      };

      const listRequest = await queue('projects.list', {
        cursor: 0, limit: 32, includeHidden: true
      });
      assert.equal(Object.prototype.hasOwnProperty.call(listRequest, 'projectId'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(listRequest, 'contextRevision'), false);
      const largeListResult = { kind: 'projects', padding: 'x'.repeat(7000) };
      const listStatus = await finish(listRequest, largeListResult);
      assert.equal(listStatus.value.result.padding.length, 7000,
        '项目列表结果应有独立上限，不受旧6KiB约束');
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: { padding: 'x'.repeat(5000) }
      })).ok, false, '旧21项 input 仍必须卡在4KiB');
      const legacyNoContext = await rpcHandler('workspace/files/request', {
        ...pageAuth, operation: 'catalog.read', input: {}
      });
      assert.equal(legacyNoContext.value.accepted, false);
      assert.equal(legacyNoContext.value.code, 'workspace-unavailable',
        '当前会话为空时只放行新8项，旧21项边界不变');

      const rawSnapshot = {
        byId: Array.from({ length: 40 }, (_value, index) => ({
          sessionId: `project-console-raw-${String(index).padStart(3, '0')}`,
          running: index === 0,
          completed: false,
          pendingInteraction: index === 1 ? 'question' : null,
          parentId: null,
          displayTitle: `会话${index}-${'x'.repeat(100)}`,
          updatedAt: 1000 + index
        })),
        subagentsByParent: [],
        jobsBySession: [],
        current: null
      };
      assert.equal(Buffer.byteLength(JSON.stringify({ snapshot: rawSnapshot })) > 4096, true);
      const consoleRequest = await queue('console.read', { snapshot: rawSnapshot });
      const serializedConsoleRequest = JSON.stringify(consoleRequest);
      assert.equal(serializedConsoleRequest.includes('project-console-raw-'), false,
        'main 请求不得含 raw session id');
      assert.match(Object.keys(consoleRequest.input.snapshot.byId)[0],
        /^session-binding-[a-f0-9]{64}$/);
      assert.equal(Object.keys(consoleRequest.input.snapshot.byId)[0].length, 80,
        'console.read 单项允许 80 字符稳定 key');
      await finish(consoleRequest, {
        kind: 'console', revision: 1, cards: [],
        counts: { need: 0, done: 0, busy: 0, idle: 0, total: 0, glowing: 0 }
      });

      registration = selectionRequest({
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision: 2,
        currentSessionId: rawA, managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'selected');
      pageAuth = {
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision: 2,
        selectionToken: SELECTION_TOKEN, controllerProof: registration.controllerProof
      };
      const projectId = `proj_${'a'.repeat(32)}`;
      const expectedBindingRef = sessionBindingRef(rawA);
      const expectedRootRef = projectRootRef.sessionRootRef(
        BRIDGE_TOKEN, hostInstanceId, fs.realpathSync(cwdA)
      );
      const selectedPrivate = await rpcHandler('selection/resolve', {
        contract: CONTRACT, controllerId, authToken
      });
      assert.equal(selectedPrivate.value.currentBindingRef, expectedBindingRef);
      assert.equal(selectedPrivate.value.sessionRootRef, expectedRootRef);
      assert.equal(JSON.stringify(selectedPrivate).includes(cwdA), false);
      const fencedEnvelope = {
        contract: CONTRACT,
        clientInstanceId: 'client-project-stage1',
        hostInstanceId,
        sessionRef: selectedPrivate.value.sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'e'.repeat(32)}`,
          relativePath: '.',
          workbenchId: null,
          title: '项目 A',
          projectRevision: null
        }
      };
      liveSessions[0].header.cwd = cwdB;
      assert.deepEqual(await rpcHandler('context/stage', {
        controllerId,
        pageInstanceId,
        selectionRevision: 2,
        currentBindingRef: expectedBindingRef,
        sessionRootRef: expectedRootRef,
        envelope: fencedEnvelope,
        authToken
      }), { ok: true, value: { accepted: false, code: 'session-unavailable' } },
      'resolve 后、stage 前 cwd 变化必须由 Host 当场 proof 重验挡住');
      liveSessions[0].header.cwd = cwdA;
      assert.equal((await rpcHandler('context/stage', {
        controllerId,
        pageInstanceId,
        selectionRevision: 2,
        currentBindingRef: expectedBindingRef,
        sessionRootRef: expectedRootRef,
        envelope: fencedEnvelope,
        authToken
      })).value.state, 'effective');
      const forgedRoot = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'projects.bind',
        input: { projectId, sessionRootRef: expectedRootRef }
      });
      assert.equal(forgedRoot.ok, false, 'Client 不得在 input 伪造 sessionRootRef');
      const bindRequest = await queue('projects.bind', { projectId });
      assert.deepEqual(bindRequest.input, { projectId, bindingRef: expectedBindingRef });
      assert.equal(bindRequest.sessionRootRef, expectedRootRef,
        'Host 必须以 auth token + canonical cwd 生成 main-only root proof');
      assert.equal(Object.prototype.hasOwnProperty.call(bindRequest.input, 'sessionRootRef'), false);
      assert.equal(JSON.stringify(bindRequest).includes(rawA), false);
      const bindStatus = await finish(bindRequest, {
        kind: 'binding', revision: 2, projectId, bindingRef: expectedBindingRef
      });
      assert.equal(JSON.stringify(bindStatus).includes(expectedRootRef), false,
        'status/result 不得回显私有 root proof');

      const claimRaceRequest = await queue('projects.bind', { projectId });
      const claimRaceClaim = await claim(claimRaceRequest);
      assert.equal(claimRaceClaim.value.claimed, true);
      liveSessions[0].header.cwd = cwdB;
      const deniedAuthorization = await authorize(claimRaceRequest, claimRaceClaim);
      assert.deepEqual(deniedAuthorization, {
        ok: true, value: { authorized: false, code: 'workspace-mismatch' }
      }, 'claim 后、授权前 cwd 变化必须精确拒绝，main 尚无持久副作用');
      liveSessions[0].header.cwd = cwdA;
      const claimRaceStatus = await rpcHandler('workspace/files/status', {
        ...pageAuth, requestToken: claimRaceRequest.requestToken
      });
      assert.equal(claimRaceStatus.value.state, 'rejected');
      assert.equal(claimRaceStatus.value.code, 'workspace-mismatch');

      const settleRaceRequest = await queue('projects.bind', { projectId });
      const settleRaceClaim = await claim(settleRaceRequest);
      const settleRaceAuthorization = await authorize(settleRaceRequest, settleRaceClaim);
      assert.equal(settleRaceAuthorization.value.authorized, true);
      liveSessions[0].header.cwd = cwdB;
      assert.deepEqual(await settle(settleRaceRequest, settleRaceClaim, {
        kind: 'binding', revision: 3, projectId, bindingRef: expectedBindingRef
      }, settleRaceAuthorization.value.authorizationToken), {
        ok: true, value: { settled: false, code: 'outcome-unknown' }
      }, '授权线性化后 cwd 再变化时不得回 fulfilled');
      liveSessions[0].header.cwd = cwdA;
      const settleRaceStatus = await rpcHandler('workspace/files/status', {
        ...pageAuth, requestToken: settleRaceRequest.requestToken
      });
      assert.equal(settleRaceStatus.value.state, 'rejected');
      assert.equal(settleRaceStatus.value.code, 'outcome-unknown');
      assert.equal(JSON.stringify(settleRaceStatus).includes(expectedRootRef), false);
      assert.equal(JSON.stringify(settleRaceStatus).includes(
        settleRaceAuthorization.value.authorizationToken
      ), false, 'status 不得泄露最终授权 token');

      const rootRace = await rpcHandler('workspace/files/request', {
        ...pageAuth, operation: 'projects.bind', input: { projectId }
      });
      assert.equal(rootRace.value.accepted, true);
      liveSessions[0].header.cwd = cwdB;
      const rootRaceRead = await readOne();
      assert.deepEqual(rootRaceRead.value.requests, [],
        '排队后同 raw 的 cwd 变化必须在 main claim 前失效');
      liveSessions[0].header.cwd = cwdA;
      const rootRaceStatus = await rpcHandler('workspace/files/status', {
        ...pageAuth, requestToken: rootRace.value.requestToken
      });
      assert.equal(rootRaceStatus.value.state, 'rejected');
      assert.equal(rootRaceStatus.value.code, 'workspace-unavailable');
      assert.equal(JSON.stringify(rootRaceStatus).includes(expectedRootRef), false);

      const resolved = await rpcHandler('projects/session/resolve', {
        ...pageAuth,
        bindingRef: expectedBindingRef,
        candidateSessionIds: [rawB, rawA]
      });
      assert.deepEqual(resolved, {
        ok: true, value: { resolved: true, candidateIndex: 1, code: null }
      });
      assert.equal(JSON.stringify(resolved).includes(rawA), false,
        '私有 resolver 回包也只给候选索引，不回 raw');

      const openPrepare = await queue('projects.open', { projectId, phase: 'prepare' });
      assert.equal(Object.prototype.hasOwnProperty.call(openPrepare, 'currentBindingRef'), false,
        'prepare 不得伪装成已验证的当前绑定');
      assert.equal(Object.prototype.hasOwnProperty.call(openPrepare, 'sessionRootRef'), false,
        'prepare 不得携带 root proof');
      const openToken = `project-open-${'c'.repeat(64)}`;
      await finish(openPrepare, {
        kind: 'open-prepared',
        project: { projectId },
        bindingRef: expectedBindingRef,
        openToken
      });
      const wrongCommit = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'projects.open',
        input: {
          projectId,
          phase: 'commit',
          openToken,
          bindingRef: sessionBindingRef(rawB)
        }
      });
      assert.equal(wrongCommit.value.accepted, false);
      assert.equal(wrongCommit.value.code, 'workspace-unavailable');
      const openCommit = await queue('projects.open', {
        projectId,
        phase: 'commit',
        openToken,
        bindingRef: expectedBindingRef
      });
      assert.deepEqual(openCommit.input, { projectId, phase: 'commit', openToken },
        'Host 验证完 bindingRef 后必须在进 main 前剥离');
      assert.equal(openCommit.currentBindingRef, expectedBindingRef,
        'Host 必须把由当前 raw 重算的 stable ref 仅作为 main job metadata');
      assert.equal(openCommit.sessionRootRef, expectedRootRef,
        'open commit 必须与 bind 重算同一 canonical session root proof');
      assert.equal(JSON.stringify(openCommit).includes(rawA), false);
      await finish(openCommit, {
        kind: 'open-committed', project: { projectId }, bindingRef: expectedBindingRef
      });

      const racePrepare = await queue('projects.open', { projectId, phase: 'prepare' });
      const raceToken = `project-open-${'d'.repeat(64)}`;
      await finish(racePrepare, {
        kind: 'open-prepared', project: { projectId },
        bindingRef: expectedBindingRef, openToken: raceToken
      });
      const raceCommit = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'projects.open',
        input: {
          projectId, phase: 'commit', openToken: raceToken,
          bindingRef: expectedBindingRef
        }
      });
      assert.equal(raceCommit.value.accepted, true);
      liveSessions[0].header.cwd = cwdB;
      assert.deepEqual((await readOne()).value.requests, [],
        'open commit 排队后 cwd 变化必须在 main claim 前失效');
      liveSessions[0].header.cwd = cwdA;
      const raceCommitStatus = await rpcHandler('workspace/files/status', {
        ...pageAuth, requestToken: raceCommit.value.requestToken
      });
      assert.equal(raceCommitStatus.value.state, 'rejected');
      assert.equal(raceCommitStatus.value.code, 'workspace-unavailable');
      assert.equal(JSON.stringify(raceCommitStatus).includes(expectedRootRef), false);

      const nearBudgetRequest = await queue('projects.open', { projectId, phase: 'prepare' });
      const nearBudgetClaim = await claim(nearBudgetRequest);
      const nearBudgetResult = { kind: 'budget', padding: 'x'.repeat(23 * 1024) };
      assert.equal(Buffer.byteLength(JSON.stringify(nearBudgetResult), 'utf8') < 24 * 1024, true);
      assert.deepEqual(await rpcHandler('workspace/files/settle', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: nearBudgetRequest.requestToken,
        requestSeq: nearBudgetRequest.requestSeq,
        claimToken: nearBudgetClaim.value.claimToken,
        status: 'fulfilled',
        code: null,
        result: nearBudgetResult,
        authToken
      }), { ok: true, value: { settled: true, code: null } },
      'projects.open Host result 必须接纳24KiB以内回包');
      const overBudgetRequest = await queue('projects.open', { projectId, phase: 'prepare' });
      const overBudgetClaim = await claim(overBudgetRequest);
      const overBudgetResult = { kind: 'budget', padding: 'x'.repeat(24 * 1024) };
      assert.equal(Buffer.byteLength(JSON.stringify(overBudgetResult), 'utf8') > 24 * 1024, true);
      assert.equal((await rpcHandler('workspace/files/settle', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: overBudgetRequest.requestToken,
        requestSeq: overBudgetRequest.requestSeq,
        claimToken: overBudgetClaim.value.claimToken,
        status: 'fulfilled',
        code: null,
        result: overBudgetResult,
        authToken
      })).ok, false, 'projects.open Host result 必须拒绝超过24KiB回包');

      let restartedHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { restartedHandler = handler; } } },
        sessions: {
          list() { return liveSessions; },
          get(id) { return liveSessions.find((entry) => entry.header.id === id) || null; }
        },
        systemPrompt: { context() {} },
        on() {}
      });
      const restartedNonce = '2c'.repeat(32);
      const restartedHello = await restartedHandler('handshake', handshakeRequest(restartedNonce));
      const restartedRegistration = selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-projectrestart',
        pageInstanceId: 'page-projectrestart001',
        selectionRevision: 1,
        currentSessionId: null,
        managed: true
      });
      assert.equal((await restartedHandler(
        'selection/register', restartedRegistration
      )).value.state, 'none');
      const restartedResolve = await restartedHandler('projects/session/resolve', {
        contract: CONTRACT,
        controllerId: restartedRegistration.controllerId,
        pageInstanceId: restartedRegistration.pageInstanceId,
        selectionRevision: 1,
        selectionToken: SELECTION_TOKEN,
        controllerProof: restartedRegistration.controllerProof,
        bindingRef: expectedBindingRef,
        candidateSessionIds: [rawA]
      });
      assert.deepEqual(restartedResolve, {
        ok: true, value: { resolved: true, candidateIndex: 0, code: null }
      }, '同 raw 在新 Host 实例必须重建出同一稳定 binding');
      fs.rmSync(rootTmp, { recursive: true, force: true });
    });

    await test('Host bootstrap 密文根、稳定会话、重放与副作用后不确定均收敛', async () => {
      const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-bootstrap-host-'));
      const projectRoot = path.join(rootTmp, 'Project Root');
      fs.mkdirSync(projectRoot);
      const canonicalRoot = fs.realpathSync(projectRoot);
      const projectId = `proj_${'8'.repeat(32)}`;
      const rawSessionId = `session-whaledock-project-${'8'.repeat(32)}`;

      const createScenario = async (mode = 'success') => {
        let rpcHandler = null;
        let registration = null;
        const liveSessions = [];
        if (mode.startsWith('stable-')) {
          liveSessions.push({
            header: {
              id: rawSessionId,
              cwd: canonicalRoot,
              ...(mode === 'stable-parent' ? { parentSession: 'session-parent-owner' } : {})
            },
            blank: mode !== 'stable-nonblank',
            origin: mode === 'stable-subagent' ? 'subagent' : 'user'
          });
        }
        const calls = { workspace: 0, sessionList: 0, workspaceList: 0, sessionCreate: 0 };
        let churned = false;
        const apiProxy = {
          workspace: {
            async create({ payload }) {
              calls.workspace += 1;
              assert.equal(payload.path, canonicalRoot, '根只能在 Host 内解密交给官方 API');
              if (mode.startsWith('workspace-') && !churned) {
                churned = true;
                const selfSelected = mode === 'workspace-same-root-selection'
                  || mode === 'workspace-same-root-parent-selection'
                  || mode === 'workspace-same-root-revision-jump';
                const foreignSelected = mode === 'workspace-other-root-selection';
                const crossedPage = mode === 'workspace-cross-page-selection';
                const selectedId = selfSelected
                  ? (mode === 'workspace-same-root-parent-selection'
                    ? 'session-child-initial-selection' : 'session-official-initial-selection')
                  : ((foreignSelected || crossedPage) ? 'session-foreign-selection' : null);
                if (selectedId !== null) {
                  liveSessions.push({
                    header: {
                      id: selectedId,
                      cwd: selfSelected ? canonicalRoot : path.join(rootTmp, 'Other Root'),
                      ...(mode === 'workspace-same-root-parent-selection'
                        ? { parentSession: 'session-parent-owner' } : {})
                    },
                    blank: true,
                    origin: 'user'
                  });
                }
                registration = selectionRequest({
                  contract: CONTRACT,
                  controllerId: registration.controllerId,
                  pageInstanceId: crossedPage
                    ? 'page-bootstrap-cross-page' : registration.pageInstanceId,
                  selectionRevision: registration.selectionRevision
                    + (mode === 'workspace-same-root-revision-jump' ? 2 : 1),
                  currentSessionId: selectedId,
                  managed: true
                });
                await rpcHandler('selection/register', registration);
              }
              return { result: { ok: true, value: { workspace: {
                workspaceId: 'workspace-bootstrap-0001', path: canonicalRoot
              } } } };
            },
            async list() {
              calls.workspaceList += 1;
              if (mode === 'bad-workspace-list') return { result: { ok: false } };
              return { result: { ok: true, value: {
                items: [{
                  workspaceId: 'workspace-bootstrap-0001', path: canonicalRoot,
                  sessionIds: mode === 'stable-detached' ? []
                    : liveSessions.map((entry) => entry.header.id)
                }],
                archivedSessionIds: mode === 'stable-archived' ? [rawSessionId] : []
              } } };
            }
          },
          sessions: {
            async list() {
              calls.sessionList += 1;
              if (mode === 'bad-session-list') return { result: { ok: true, value: {} } };
              return { result: { ok: true, value: { items: liveSessions.map((entry) => ({
                sessionId: entry.header.id, cwd: entry.header.cwd,
                blank: entry.blank === undefined ? true : entry.blank,
                origin: entry.origin || 'user',
                ...(entry.header.parentSession === undefined
                  ? {} : { parentSessionId: entry.header.parentSession })
              })) } } };
            },
            async create({ payload }) {
              calls.sessionCreate += 1;
              assert.equal(payload.workspaceId, 'workspace-bootstrap-0001');
              assert.equal(payload.sessionId, rawSessionId,
                '新 ticket 也必须 ensure 同一项目稳定 raw id');
              if (!liveSessions.some((entry) => entry.header.id === payload.sessionId)) {
                liveSessions.push({ header: { id: payload.sessionId, cwd: canonicalRoot } });
              }
              if (mode === 'session-churn' && !churned) {
                churned = true;
                registration = selectionRequest({
                  contract: CONTRACT,
                  controllerId: registration.controllerId,
                  pageInstanceId: registration.pageInstanceId,
                  selectionRevision: registration.selectionRevision + 1,
                  currentSessionId: null,
                  managed: true
                });
                await rpcHandler('selection/register', registration);
              }
              return { result: { ok: true, value: { sessionId: payload.sessionId } } };
            }
          }
        };
        hostPlugin.apply({
          connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
          sessions: {
            list: () => liveSessions,
            get: (id) => liveSessions.find((entry) => entry.header.id === id) || null
          },
          apiProxy,
          systemPrompt: { context() {} },
          on() {}
        });
        const clientNonce = createHash('sha256').update(`bootstrap-${mode}`).digest('hex');
        const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
        registration = selectionRequest({
          contract: CONTRACT,
          controllerId: `controller-bootstrap-${mode}`,
          pageInstanceId: `page-bootstrap-${mode}`,
          selectionRevision: 1,
          currentSessionId: null,
          managed: true
        });
        assert.equal((await rpcHandler('selection/register', registration)).value.state, 'none');
        const auth = {
          contract: CONTRACT,
          controllerId: registration.controllerId,
          pageInstanceId: registration.pageInstanceId,
          selectionRevision: registration.selectionRevision,
          selectionToken: SELECTION_TOKEN,
          controllerProof: registration.controllerProof
        };
        const issue = (openToken, owner = auth) => projectBootstrapTicket.sealProjectBootstrapTicket({
          secret: BRIDGE_TOKEN,
          hostInstanceId: hello.value.hostInstanceId,
          controllerId: owner.controllerId,
          pageInstanceId: owner.pageInstanceId,
          selectionRevision: owner.selectionRevision,
          projectId,
          openToken,
          root: canonicalRoot
        });
        const call = (openToken, ticket, owner = auth) => rpcHandler('projects/session/bootstrap', {
          ...owner, projectId, openToken, bootstrapTicket: ticket
        });
        return { rpcHandler, calls, liveSessions, auth, issue, call };
      };

      try {
        const success = await createScenario();
        const firstToken = `project-open-${'1'.repeat(64)}`;
        const firstTicket = success.issue(firstToken);
        assert.equal(firstTicket.includes(canonicalRoot), false);
        const first = await success.call(firstToken, firstTicket);
        assert.deepEqual(first, { ok: true, value: {
          bootstrapped: true,
          bindingRef: sessionBindingRef(rawSessionId),
          code: null
        } });
        assert.equal(JSON.stringify(first).includes(canonicalRoot), false);
        assert.equal(JSON.stringify(first).includes(rawSessionId), false);
        assert.equal(JSON.stringify(first).includes(firstTicket), false);
        assert.deepEqual(success.calls, {
          workspace: 1, sessionList: 1, workspaceList: 1, sessionCreate: 1
        });
        assert.deepEqual(await success.call(firstToken, firstTicket), first,
          '同 ticket 重放必须复用同一 outcome');
        assert.equal(success.calls.sessionCreate, 1);
        const secondToken = `project-open-${'2'.repeat(64)}`;
        const second = await success.call(secondToken, success.issue(secondToken));
        assert.equal(second.value.bootstrapped, true);
        assert.equal(success.calls.sessionCreate, 1,
          '新 prepare/ticket 也必须复用项目稳定会话');

        for (const mode of [
          'stable-nonblank', 'stable-subagent', 'stable-parent',
          'stable-archived', 'stable-detached'
        ]) {
          const occupied = await createScenario(mode);
          const token = `project-open-${createHash('sha256').update(mode).digest('hex')}`;
          const result = await occupied.call(token, occupied.issue(token));
          assert.deepEqual(result, { ok: true, value: {
            bootstrapped: false, bindingRef: null, code: 'workspace-mismatch'
          } }, `${mode}: 预定 raw id 不能替代完整官方 roster 证明`);
          assert.equal(occupied.calls.sessionCreate, 0,
            `${mode}: 恶意占位后不得覆盖或复用`);
        }

        for (const mode of ['bad-session-list', 'bad-workspace-list']) {
          const incomplete = await createScenario(mode);
          const token = `project-open-${mode === 'bad-session-list' ? '3' : '4'}`.padEnd(77,
            mode === 'bad-session-list' ? '3' : '4');
          const ticket = incomplete.issue(token);
          const result = await incomplete.call(token, ticket);
          assert.deepEqual(result, { ok: true, value: {
            bootstrapped: false, bindingRef: null, code: 'outcome-unknown'
          } });
          assert.equal(incomplete.calls.sessionCreate, 0,
            '无法证明 roster 完整时不得盲建会话');
          await incomplete.call(token, ticket);
          assert.equal(incomplete.calls.workspace, 1, 'outcome-unknown 同 ticket 必须幂等缓存');
        }

        const workspaceRace = await createScenario('workspace-churn');
        const workspaceToken = `project-open-${'5'.repeat(64)}`;
        const workspaceTicket = workspaceRace.issue(workspaceToken);
        const workspaceOutcome = await workspaceRace.call(workspaceToken, workspaceTicket);
        assert.equal(workspaceOutcome.value.code, 'outcome-unknown');
        assert.equal(workspaceRace.calls.sessionCreate, 0);
        await workspaceRace.call(workspaceToken, workspaceTicket);
        assert.equal(workspaceRace.calls.workspace, 1,
          'workspace.create 后 owner 漂移不得二次执行副作用');

        const officialSelection = await createScenario('workspace-same-root-selection');
        const officialToken = `project-open-${'8'.repeat(64)}`;
        const officialOutcome = await officialSelection.call(
          officialToken, officialSelection.issue(officialToken)
        );
        assert.deepEqual(officialOutcome, { ok: true, value: {
          bootstrapped: true,
          bindingRef: sessionBindingRef('session-official-initial-selection'),
          code: null
        } }, '官方首选同根空白会话导致的 revision 前进必须安全收敛');
        assert.equal(officialSelection.calls.sessionCreate, 0,
          '应复用官方已创建的同根空白会话');

        for (const mode of [
          'workspace-other-root-selection', 'workspace-cross-page-selection',
          'workspace-same-root-parent-selection', 'workspace-same-root-revision-jump'
        ]) {
          const attack = await createScenario(mode);
          const token = `project-open-${createHash('sha256').update(mode).digest('hex')}`;
          const result = await attack.call(token, attack.issue(token));
          assert.equal(result.value.code, 'outcome-unknown',
            `${mode}: 自触发例外不得放行异根、跨页或子会话选择`);
          assert.equal(attack.calls.sessionCreate, 0);
        }

        const sessionRace = await createScenario('session-churn');
        const sessionToken = `project-open-${'6'.repeat(64)}`;
        const sessionTicket = sessionRace.issue(sessionToken);
        const sessionOutcome = await sessionRace.call(sessionToken, sessionTicket);
        assert.equal(sessionOutcome.value.code, 'outcome-unknown');
        assert.equal(sessionRace.calls.sessionCreate, 1);
        const nextAuth = {
          ...sessionRace.auth,
          selectionRevision: sessionRace.auth.selectionRevision + 1
        };
        const recoveryToken = `project-open-${'7'.repeat(64)}`;
        const recovered = await sessionRace.call(
          recoveryToken, sessionRace.issue(recoveryToken, nextAuth), nextAuth
        );
        assert.equal(recovered.value.bootstrapped, true,
          '新 owner 重试只能收敛到已创建的稳定会话');
        assert.equal(sessionRace.calls.sessionCreate, 1);
      } finally {
        fs.rmSync(rootTmp, { recursive: true, force: true });
      }
    });

    await test('workspace/files 同项目闭环不泄露路径，错位仅四项投递进入 main preflight', async () => {
      let rpcHandler = null;
      const workspaceCwd = '/Users/fixture/WhaleDock-Content';
      const otherCwd = '/Users/fixture/Other-Project';
      const rawSessionId = 'workspace-file-raw-session';
      let currentCwd = workspaceCwd;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        sessions: {
          get(id) {
            return id === rawSessionId ? { header: { cwd: currentCwd } } : null;
          }
        },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '0b'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      assert.equal(hello.ok, true);
      assert.equal(hello.value.capabilities.includes('workspace-files-v1'), true);
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const registration = selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-workspace1',
        pageInstanceId: 'page-workspace000001',
        selectionRevision: 1,
        currentSessionId: rawSessionId,
        managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'selected');
      const resolved = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        authToken
      });
      assert.match(resolved.value.sessionRef, /^session-[a-f0-9]{64}$/);
      assert.equal(resolved.value.deliveryTargetRef,
        deliveryTargetRef(BRIDGE_TOKEN, hostInstanceId, rawSessionId));
      const stage = await rpcHandler('context/stage', {
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-workspace01',
          hostInstanceId,
          sessionRef: resolved.value.sessionRef,
          revision: 1,
          project: {
            projectId: projectIdForCwd(workspaceCwd),
            relativePath: '.',
            workbenchId: 'builtin:video',
            title: '内容工作区',
            projectRevision: null
          }
        },
        authToken
      });
      assert.equal(stage.value.state, 'effective');
      const pageAuth = {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: 1,
        selectionToken: registration.selectionToken,
        controllerProof: registration.controllerProof
      };
      const coreBefore = await rpcHandler('events/read', {
        contract: CONTRACT, hostInstanceId, afterEventSeq: 0, authToken
      });
      const baselineEventSeq = coreBefore.value.throughEventSeq;

      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: {},
        unexpected: true
      })).ok, false, '未知字段不得被忽略');
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        controllerProof: 'ff'.repeat(32),
        operation: 'catalog.read',
        input: {}
      })).ok, false, '伪造页面 proof 不得入队');
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'document.read',
        input: { absolutePath: '/private/forbidden.md' }
      })).ok, false, '路径键不得穿过 Host 边界');
      for (const input of [
        { Absolute_Path: '/private/forbidden.md' },
        { Front_Matter: { status: 'done' } },
        { Hash: 'ab'.repeat(32) },
        { Delivery_Target_Ref: resolved.value.deliveryTargetRef }
      ]) {
        assert.equal((await rpcHandler('workspace/files/request', {
          ...pageAuth, operation: 'catalog.read', input
        })).ok, false, '禁止键的大小写/分隔符变体也不得穿过 Host 边界');
      }
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'document.read',
        input: {
          chunkA: 'a'.repeat(1500),
          chunkB: 'b'.repeat(1500),
          chunkC: 'c'.repeat(1500)
        }
      })).ok, false, '超过 4KiB 的输入不得入队');

      const queued = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: { cursor: 0 }
      });
      assert.deepEqual(Object.keys(queued.value).sort(), [
        'accepted', 'code', 'deadlineMs', 'requestToken', 'state'
      ]);
      assert.equal(queued.value.accepted, true);
      assert.match(queued.value.requestToken, /^[a-f0-9]{64}$/);
      assert.equal(queued.value.deadlineMs > Date.now(), true);

      assert.equal((await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 4, authToken: '00'.repeat(32)
      })).ok, false, '伪造 main auth 不得读取队列');
      const read = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 4, authToken
      });
      assert.equal(read.value.requests.length, 1);
      const request = read.value.requests[0];
      assert.equal(request.requestToken, queued.value.requestToken);
      assert.equal(request.projectId, projectIdForCwd(workspaceCwd));
      assert.equal(request.contextRevision, 1);
      assert.equal(request.operation, 'catalog.read');
      assert.deepEqual(request.input, { cursor: 0 });
      const requestText = JSON.stringify(request);
      for (const forbidden of [
        workspaceCwd, rawSessionId, resolved.value.sessionRef,
        registration.selectionToken, registration.controllerProof,
        'absolutePath', 'relativePath', 'cwd', 'claimToken'
      ]) assert.equal(requestText.includes(forbidden), false, `main 请求泄露: ${forbidden}`);

      assert.equal((await rpcHandler('workspace/files/claim', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        authToken: '00'.repeat(32)
      })).ok, false);
      const claimed = await rpcHandler('workspace/files/claim', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        authToken
      });
      assert.equal(claimed.value.claimed, true);
      assert.match(claimed.value.claimToken, /^[a-f0-9]{64}$/);
      assert.equal(claimed.value.runningDeadlineMs <= request.deadlineMs, true,
        'claim 不能重置页面看到的绝对 deadline');
      const runningCancel = await rpcHandler('workspace/files/cancel', {
        ...pageAuth,
        requestToken: request.requestToken
      });
      assert.equal(runningCancel.value.cancelled, false);
      assert.equal(runningCancel.value.code, 'already-running');

      const settleBase = {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        claimToken: claimed.value.claimToken,
        status: 'fulfilled',
        code: null,
        authToken
      };
      assert.equal((await rpcHandler('workspace/files/settle', {
        ...settleBase,
        result: { absolutePath: '/private/forbidden.md' }
      })).ok, false, '结果中的绝对路径必须拒绝');
      assert.equal((await rpcHandler('workspace/files/settle', {
        ...settleBase,
        result: {
          chunkA: 'a'.repeat(2048),
          chunkB: 'b'.repeat(2048),
          chunkC: 'c'.repeat(2048)
        }
      })).ok, false, '超过 6KiB 的结果必须拒绝');
      assert.deepEqual((await rpcHandler('workspace/files/settle', {
        ...settleBase,
        result: {
          projects: [{ projectToken: 'project-safe', title: '可见项目' }],
          count: 1
        }
      })).value, { settled: true, code: null });
      const fulfilled = await rpcHandler('workspace/files/status', {
        ...pageAuth,
        requestToken: request.requestToken
      });
      assert.deepEqual(fulfilled.value, {
        requestToken: request.requestToken,
        state: 'fulfilled',
        code: null,
        result: {
          projects: [{ projectToken: 'project-safe', title: '可见项目' }],
          count: 1
        }
      });
      assert.equal(JSON.stringify(fulfilled).includes(claimed.value.claimToken), false);
      assert.equal((await rpcHandler('workspace/files/status', {
        ...pageAuth,
        pageInstanceId: 'page-workspace-forged',
        requestToken: request.requestToken
      })).ok, false, '其他页不得读取结果');

      const cancelQueued = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'document.read',
        input: { projectToken: 'project-safe' }
      });
      const cancelled = await rpcHandler('workspace/files/cancel', {
        ...pageAuth,
        requestToken: cancelQueued.value.requestToken
      });
      assert.equal(cancelled.value.cancelled, true);
      assert.equal(cancelled.value.snapshot.state, 'cancelled');

      currentCwd = otherCwd;
      const mismatch = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: {}
      });
      assert.deepEqual(mismatch.value, {
        accepted: false,
        requestToken: null,
        state: 'rejected',
        code: 'workspace-mismatch',
        deadlineMs: null
      });
      const mutationMismatch = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'topic.choose',
        input: { projectToken: 'project-safe', option: 'fixture' }
      });
      assert.equal(mutationMismatch.value.code, 'workspace-mismatch',
        '非投递 mutation 仍必须 fail-closed');

      const deliveryOperations = [
        'project.action.prepare', 'project.action.submit',
        'block.action.prepare', 'block.action.submit'
      ];
      const deliveryQueued = [];
      for (const operation of deliveryOperations) {
        const queuedDelivery = await rpcHandler('workspace/files/request', {
          ...pageAuth,
          operation,
          input: { projectToken: 'project-safe', actionId: 'fixture-action' }
        });
        assert.deepEqual(Object.keys(queuedDelivery.value).sort(), [
          'accepted', 'code', 'deadlineMs', 'requestToken', 'state'
        ], '页面可见 operation 回包形状不得增加内部 target ref');
        assert.equal(queuedDelivery.value.accepted, true,
          `${operation} 必须进入 main 既有 preflight/override 链`);
        assert.equal(JSON.stringify(queuedDelivery).includes('delivery-target-'), false,
          '页面 RPC 回包不得暴露内部 target ref');
        deliveryQueued.push(queuedDelivery.value.requestToken);
      }
      const deliveryRead = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 4, authToken
      });
      assert.deepEqual(deliveryRead.value.requests.map((item) => item.operation),
        deliveryOperations);
      assert.deepEqual(deliveryRead.value.requests.map((item) => item.requestToken),
        deliveryQueued);
      for (const deliveryRequest of deliveryRead.value.requests) {
        assert.equal(deliveryRequest.deliveryTargetRef,
          resolved.value.deliveryTargetRef,
        'Host→main 队列项必须绑定当前选中 raw 的 deterministic opaque ref');
        assert.match(deliveryRequest.deliveryTargetRef,
          /^delivery-target-[a-f0-9]{64}$/);
      }
      const deliveryReadText = JSON.stringify(deliveryRead);
      assert.equal(deliveryReadText.includes(rawSessionId), false);
      assert.equal(deliveryReadText.includes(resolved.value.sessionRef), false);
      const claimedMismatchDelivery = await rpcHandler('workspace/files/claim', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: deliveryRead.value.requests[0].requestToken,
        requestSeq: deliveryRead.value.requests[0].requestSeq,
        authToken
      });
      assert.equal(claimedMismatchDelivery.value.claimed, true,
        '错位投递进入 main 后不得被 Host sweep 再次淘汰');
      const coreAfter = await rpcHandler('events/read', {
        contract: CONTRACT, hostInstanceId, afterEventSeq: 0, authToken
      });
      assert.equal(coreAfter.value.throughEventSeq, baselineEventSeq,
        'workspace/files 不得占用 core journal 序号');
    });

    await test('workspace/files/read 对多项大 console 请求按字节分批且保序', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        sessions: { list() { return []; }, get() { return null; } },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '4b'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const controllerId = 'controller-large-read1';
      const pageInstanceId = 'page-large-read000001';
      const registration = selectionRequest({
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision: 1,
        currentSessionId: null, managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'none');
      const pageAuth = {
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision: 1,
        selectionToken: SELECTION_TOKEN, controllerProof: registration.controllerProof
      };
      const largeSnapshot = {
        byId: Array.from({ length: 64 }, (_value, index) => ({
          sessionId: `large-read-session-${String(index).padStart(3, '0')}`,
          running: false,
          completed: false,
          pendingInteraction: null,
          parentId: null,
          displayTitle: `${index}-${'x'.repeat(477)}`,
          updatedAt: 1000 + index
        })),
        subagentsByParent: [],
        jobsBySession: [],
        current: null
      };
      const expectedTokens = [];
      for (let index = 0; index < 4; index += 1) {
        const queued = await rpcHandler('workspace/files/request', {
          ...pageAuth,
          operation: 'console.read',
          input: { snapshot: largeSnapshot }
        });
        assert.equal(queued.value.accepted, true, JSON.stringify(queued));
        expectedTokens.push(queued.value.requestToken);
      }

      const delivered = [];
      const rpcId = `wd-${'0'.repeat(36)}`;
      while (delivered.length < expectedTokens.length) {
        const batch = await rpcHandler('workspace/files/read', {
          contract: CONTRACT, hostInstanceId, limit: 4, authToken
        });
        assert.equal(batch.value.requests.length, 1,
          '单项近 48KiB 的 console 请求必须动态分批');
        assert.equal(Buffer.byteLength(JSON.stringify(batch), 'utf8') <= 56 * 1024, true,
          'Host RPC result 必须留出传输层信封预算');
        assert.equal(Buffer.byteLength(JSON.stringify({
          type: 'server-response', rpcId, result: batch
        }), 'utf8') <= 64 * 1024, true,
        '完整 backend 回包不得超过 64KiB');
        const request = batch.value.requests[0];
        assert.equal(request.requestToken, expectedTokens[delivered.length],
          '分批不得跳过队首或打乱 requestSeq');
        assert.equal(Buffer.byteLength(JSON.stringify(request.input), 'utf8') > 47 * 1024,
          true, '回归输入应接近 console.read 的 48KiB 上限');
        delivered.push(request);
        const claimed = await rpcHandler('workspace/files/claim', {
          contract: CONTRACT,
          hostInstanceId,
          requestToken: request.requestToken,
          requestSeq: request.requestSeq,
          authToken
        });
        assert.equal(claimed.value.claimed, true);
      }
      assert.deepEqual(delivered.map((request) => request.requestToken), expectedTokens);
      assert.equal(Buffer.byteLength(JSON.stringify({
        type: 'server-response',
        rpcId,
        result: {
          ok: true,
          value: { contract: CONTRACT, hostInstanceId, requests: delivered }
        }
      }), 'utf8') > 64 * 1024, true,
      '旧的固定 4 项切片在该场景一定会超出 backend 上限');
    });

    await test('workspace/files 在 A→B→A 后不可读取、取消或 claim 旧 selection 请求', async () => {
      let rpcHandler = null;
      const rawA = 'workspace-selection-raw-a';
      const rawB = 'workspace-selection-raw-b';
      const cwdA = '/Users/fixture/Workspace-A';
      const cwdB = '/Users/fixture/Workspace-B';
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        sessions: {
          get(id) {
            if (id === rawA) return { header: { cwd: cwdA } };
            if (id === rawB) return { header: { cwd: cwdB } };
            return null;
          }
        },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '1b'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const controllerId = 'controller-file-aba1';
      const pageInstanceId = 'page-file-aba000001';
      const select = async (raw, selectionRevision) => {
        const registration = selectionRequest({
          contract: CONTRACT, controllerId, pageInstanceId, selectionRevision,
          currentSessionId: raw, managed: true
        });
        const registered = await rpcHandler('selection/register', registration);
        assert.equal(registered.value.state, 'selected');
        const resolved = await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId, authToken
        });
        return { registration, sessionRef: resolved.value.sessionRef };
      };
      const selectedA = await select(rawA, 1);
      const stageA = await rpcHandler('context/stage', {
        controllerId, pageInstanceId, selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-file-aba001', hostInstanceId,
          sessionRef: selectedA.sessionRef, revision: 1,
          project: {
            projectId: projectIdForCwd(cwdA), relativePath: '.',
            workbenchId: 'builtin:video', title: 'A', projectRevision: null
          }
        },
        authToken
      });
      assert.equal(stageA.value.state, 'effective');
      const authFor = (selectionRevision) => ({
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision,
        selectionToken: selectedA.registration.selectionToken,
        controllerProof: selectedA.registration.controllerProof
      });
      const contextStale = await rpcHandler('workspace/files/request', {
        ...authFor(1), operation: 'catalog.read', input: {}
      });
      const firstRead = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 1, authToken
      });
      const contextStaleRequest = firstRead.value.requests[0];
      assert.equal(contextStaleRequest.requestToken, contextStale.value.requestToken);
      const stageA2 = await rpcHandler('context/stage', {
        controllerId, pageInstanceId, selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-file-aba001', hostInstanceId,
          sessionRef: selectedA.sessionRef, revision: 2,
          project: {
            projectId: projectIdForCwd(cwdA), relativePath: '.',
            workbenchId: 'builtin:video', title: 'A2', projectRevision: 'a'.repeat(64)
          }
        },
        authToken
      });
      assert.equal(stageA2.value.state, 'effective');
      assert.deepEqual((await rpcHandler('workspace/files/claim', {
        contract: CONTRACT, hostInstanceId,
        requestToken: contextStaleRequest.requestToken,
        requestSeq: contextStaleRequest.requestSeq, authToken
      })).value, { claimed: false, code: 'operation-stale' },
      '同 selection 下 context revision 更新也必须淘汰旧请求');
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(1), requestToken: contextStaleRequest.requestToken
      })).ok, false, '新 context 不得读取旧 context token');

      const queued = await rpcHandler('workspace/files/request', {
        ...authFor(1), operation: 'catalog.read', input: {}
      });
      const read = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 1, authToken
      });
      const oldRequest = read.value.requests[0];
      assert.equal(oldRequest.requestToken, queued.value.requestToken);

      await select(rawB, 2);
      const staleClaim = await rpcHandler('workspace/files/claim', {
        contract: CONTRACT, hostInstanceId,
        requestToken: oldRequest.requestToken, requestSeq: oldRequest.requestSeq, authToken
      });
      assert.deepEqual(staleClaim.value, { claimed: false, code: 'operation-stale' });
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(1), requestToken: oldRequest.requestToken
      })).ok, false, '旧 revision 不得读旧 token');
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(2), requestToken: oldRequest.requestToken
      })).ok, false, '新 session 不得继承旧 token');

      await select(rawA, 3);
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(3), requestToken: oldRequest.requestToken
      })).ok, false, 'A 返回后也不得复活旧 token');
      assert.equal((await rpcHandler('workspace/files/cancel', {
        ...authFor(3), requestToken: oldRequest.requestToken
      })).ok, false, 'A 返回后也不得取消旧 token');
    });

    await test('513 次偏好尝试不占 core journal，后续 ACK→turn→delivery→end 连续可回放', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler, options) { listeners.set(name, { handler, options }); }
      });
      const clientNonce = '0a'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
      const selectionValue = {
        contract: CONTRACT,
        controllerId: 'controller-pref-flood1',
        pageInstanceId: 'page-pref-flood00001',
        selectionRevision: 1,
        currentSessionId: 'preference-flood-raw',
        managed: true
      };
      let registration = selectionRequest(selectionValue);
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'selected');
      const pageAuth = {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: registration.selectionRevision,
        selectionToken: registration.selectionToken,
        controllerProof: registration.controllerProof
      };
      const initial = {
        revision: 1,
        contentViewMode: 'content',
        contentViewHintSeen: false
      };
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT, snapshot: initial, authToken
      })).value.accepted, true);

      const originalNow = Date.now;
      let now = originalNow();
      const attempts = [];
      Date.now = () => now;
      try {
        for (let index = 0; index < 513; index += 1) {
          if (index > 0 && index % 10 === 0) {
            registration = selectionRequest(selectionValue);
            assert.equal((await rpcHandler('selection/register', registration)).value.state,
              'selected', '偏好洪泛夹具必须保持页面 lease 有效');
          }
          attempts.push(rpcHandler('ui/preferences/write', {
            ...pageAuth,
            baseRevision: 1,
            patch: { contentViewHintSeen: index % 2 === 0 }
          }));
          now += 1001;
        }
        now += 3000;
        const empty = await rpcHandler('ui/preferences/read', {
          contract: CONTRACT,
          hostInstanceId: hello.value.hostInstanceId,
          authToken
        });
        assert.deepEqual(empty.value.requests, []);
        const outcomes = await Promise.all(attempts);
        assert.equal(outcomes.length, 513);
        assert.equal(outcomes.every((outcome) => outcome.ok === true
          && outcome.value.accepted === false
          && outcome.value.code === 'preferences-timeout'), true);
      } finally {
        Date.now = originalNow;
      }

      const resolved = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: selectionValue.controllerId,
        authToken
      });
      const envelope = {
        contract: CONTRACT,
        clientInstanceId: 'client-pref-flood01',
        hostInstanceId: hello.value.hostInstanceId,
        sessionRef: resolved.value.sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'7'.repeat(32)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title: '偏好隔离回归',
          projectRevision: null
        }
      };
      assert.equal((await rpcHandler('context/stage', {
        controllerId: selectionValue.controllerId,
        pageInstanceId: selectionValue.pageInstanceId,
        selectionRevision: 1,
        envelope,
        authToken
      })).value.state, 'effective');
      const sessionEvent = listeners.get('session/event').handler;
      sessionEvent({ id: selectionValue.currentSessionId }, {
        type: 'turn/start', data: { turn: 1 }
      });
      const contextText = contextProvider.text({
        agent: { id: selectionValue.currentSessionId }
      });
      const message = {
        id: 'message-pref-flood1',
        role: 'user',
        content: [{ type: 'text', text: contextText }],
        source: {
          kind: 'plugin',
          plugin: '@deepseek-ai/dsh-system-prompt',
          form: 'snapshot',
          sections: [{ name: 'whaledock:workspace-context', text: contextText }]
        }
      };
      const options = llm.markAgentLoopRequest({
        provider: 'fixture', model: 'fixture',
        sessionId: selectionValue.currentSessionId, messages: [message]
      });
      assert.equal(listeners.get('llm/stream').handler(options, () => 'stream'), 'stream');
      sessionEvent({ id: selectionValue.currentSessionId }, {
        type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }
      });
      const core = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.equal(core.value.resyncRequired, false);
      assert.equal(core.value.oldestEventSeq, 1);
      assert.equal(core.value.throughEventSeq, 4);
      assert.deepEqual(core.value.events.map((event) => event.type), [
        'ack', 'turn-start', 'delivery', 'turn-end'
      ]);
      assert.deepEqual(core.value.events.map((event) => event.eventSeq), [1, 2, 3, 4]);
    });

    await test('超大事件被丢弃时 eventSeq 不留永久空洞', async () => {
      const oversizeRoot = path.join(nodeModules, '@whaledock', 'context-bridge-oversize');
      fs.cpSync(path.join(sourceRoot, 'plugin'), oversizeRoot, { recursive: true });
      const oversizeEntry = path.join(oversizeRoot, 'lib', 'index.js');
      const originalSource = fs.readFileSync(oversizeEntry, 'utf8');
      const boundedSource = originalSource.replace(
        'const MAX_EVENT_BYTES = 2048;', 'const MAX_EVENT_BYTES = 400;'
      );
      assert.notEqual(boundedSource, originalSource);
      fs.writeFileSync(oversizeEntry, boundedSource);
      const oversizePlugin = await import(
        `${pathToFileURL(oversizeEntry).href}?oversize=${Date.now()}`
      );
      let rpcHandler = null;
      const listeners = new Map();
      oversizePlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on(name, handler) { listeners.set(name, handler); }
      });
      const clientNonce = '08'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
      await rpcHandler('selection/register', selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-oversize01',
        pageInstanceId: 'page-oversize000001',
        selectionRevision: 1,
        currentSessionId: 'oversize-raw-session',
        managed: true
      }));
      const resolved = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-oversize01',
        authToken
      });
      const staged = await rpcHandler('context/stage', {
        controllerId: 'controller-oversize01',
        pageInstanceId: 'page-oversize000001',
        selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: `client-${'b'.repeat(121)}`,
          hostInstanceId: hello.value.hostInstanceId,
          sessionRef: resolved.value.sessionRef,
          revision: 1,
          project: {
            projectId: `wdp1_${'8'.repeat(32)}`,
            relativePath: '.',
            workbenchId: 'builtin:video',
            title: '事件连号',
            projectRevision: null
          }
        },
        authToken
      });
      assert.equal(staged.value.state, 'effective');
      assert.equal(staged.value.eventSeq, 0, '超限 ACK 不得消耗序号');
      listeners.get('session/event')(
        { id: 'oversize-raw-session' }, { type: 'turn/start', data: { turn: 1 } }
      );
      const events = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(events.value.events.map((event) => event.eventSeq), [1]);
      assert.deepEqual(events.value.events.map((event) => event.type), ['turn-start']);
    });

    await test('Host RPC 真实执行 handshake→selection→stage→turn→delivery 事件序列', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: {
          rpc: {
            handle(channel, handler, options) {
              assert.equal(channel, '/whaledock.context');
              assert.deepEqual(options, { authority: 'loopback' });
              rpcHandler = handler;
            }
          }
        },
        systemPrompt: {
          context(provider) { contextProvider = provider; }
        },
        on(name, handler, options) {
          listeners.set(name, { handler, options });
        }
      });
      assert.equal(typeof rpcHandler, 'function');
      assert.equal(contextProvider.name, 'whaledock:workspace-context');

      const secret = 'ab'.repeat(32);
      const clientNonce = '01'.repeat(32);
      const handshake = await rpcHandler('handshake', handshakeRequest(clientNonce));
      assert.equal(handshake.ok, true);
      assert.equal(handshake.value.ok, true);
      assert.match(handshake.value.hostInstanceId, /^host-/);
      assert.equal(handshake.value.capabilities.includes('delivery-proof'), true);
      const hostInstanceId = handshake.value.hostInstanceId;
      assert.equal(handshake.value.clientNonce, clientNonce);
      assert.equal(
        handshake.value.proof,
        bridgeHmac(secret, 'handshake-proof', clientNonce, hostInstanceId)
      );
      const authToken = rpcSession(secret, clientNonce, hostInstanceId);

      const selection = await rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        currentSessionId: 'raw-session-a',
        managed: true,
        selectionToken: SELECTION_TOKEN
      }));
      assert.equal(selection.ok, true);
      assert.equal(selection.value.state, 'selected');
      assert.equal(Object.prototype.hasOwnProperty.call(selection.value, 'sessionRef'), false);
      assert.equal(JSON.stringify(selection).includes('raw-session-a'), false);
      const resolved = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-12345678',
        authToken
      });
      const sessionRef = resolved.value.sessionRef;
      assert.match(sessionRef, /^session-[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(resolved).includes('raw-session-a'), false);
      const preflight = (overrides = {}) => rpcHandler('context/preflight', {
        contract: CONTRACT,
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        currentSessionId: 'raw-session-a',
        mode: 'queue',
        managed: true,
        selectionToken: SELECTION_TOKEN,
        ...overrides
      });
      assert.deepEqual((await preflight()).value, {
        ready: false, code: 'context-not-effective'
      });
      assert.equal((await preflight({ currentSessionId: 'raw-session-other' })).value.ready, false);
      assert.equal((await preflight({ selectionToken: 'ef'.repeat(32) })).ok, false);

      const envelope = {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: 'client-12345678',
        hostInstanceId,
        sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'1'.repeat(32)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title: '视频项目 A',
          projectRevision: null
        }
      };
      const staged = await rpcHandler('context/stage', {
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        envelope,
        authToken
      });
      assert.equal(staged.value.accepted, true);
      assert.equal(staged.value.state, 'effective');
      assert.deepEqual((await preflight()).value, { ready: true, code: null });

      for (const relativePath of [
        '/Users/example/private', '../../private', 'C:/private', 'C:private', 'file:/private'
      ]) {
        const invalidPath = await rpcHandler('context/stage', {
          controllerId: 'controller-12345678',
          pageInstanceId: 'page-123456789012',
          selectionRevision: 1,
          envelope: {
            ...envelope,
            revision: 2,
            project: { ...envelope.project, relativePath }
          },
          authToken
        });
        assert.equal(invalidPath.ok, false);
      }

      const sessionEvent = listeners.get('session/event').handler;
      sessionEvent({ id: 'raw-session-a' }, { type: 'turn/start', data: { turn: 7 } });
      assert.deepEqual((await preflight({ mode: 'steer' })).value, {
        ready: true, code: null
      });
      const contextText = contextProvider.text({ agent: { id: 'raw-session-a' } });
      assert.match(contextText, /contextRevision/);
      assert.match(contextText, /视频项目 A/);

      const message = {
        id: 'message-12345678',
        role: 'user',
        content: [{ type: 'text', text: contextText }],
        source: {
          kind: 'plugin',
          plugin: '@deepseek-ai/dsh-system-prompt',
          form: 'snapshot',
          sections: [{ name: 'whaledock:workspace-context', text: contextText }]
        }
      };
      const options = llm.markAgentLoopRequest({
        provider: 'fixture', model: 'fixture', sessionId: 'raw-session-a', messages: [message]
      });
      const llmListener = listeners.get('llm/stream');
      assert.deepEqual(llmListener.options, { global: true, prepend: true });
      assert.equal(llmListener.handler(options, () => 'native-stream'), 'native-stream');
      sessionEvent({ id: 'raw-session-a' }, {
        type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } }
      });

      const events = await rpcHandler('events/read', {
        contract: 'whaledock.context-bridge/v1',
        hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(events.value.events.map((event) => event.type), [
        'ack', 'turn-start', 'delivery', 'turn-end'
      ]);
      assert.deepEqual(events.value.events.map((event) => event.eventSeq), [1, 2, 3, 4]);
      assert.equal(events.value.events[2].proof.boundary, 'llm-stream-local');
      assert.equal(JSON.stringify(events.value).includes('raw-session-a'), false);
    });

    await test('同 raw session 多 controller 冲突，错误 auth 与未知字段均拒绝', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      let sessionEvent = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) {
          if (name === 'session/event') sessionEvent = handler;
        }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '02'.repeat(32);
      const handshake = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, handshake.value.hostInstanceId);
      const register = (controllerId, managed) => rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId,
        pageInstanceId: `page-${controllerId.slice(-8)}`,
        selectionRevision: 1,
        currentSessionId: 'same-raw-session',
        managed,
        selectionToken: SELECTION_TOKEN
      }));
      const first = await register('controller-11111111', true);
      assert.equal(first.value.state, 'selected');
      assert.equal(Object.prototype.hasOwnProperty.call(first.value, 'sessionRef'), false);
      const owned = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-11111111',
        authToken
      });
      const ownedSessionRef = owned.value.sessionRef;
      assert.match(ownedSessionRef, /^session-[a-f0-9]{64}$/);
      const duplicatePage = () => rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        pageInstanceId: 'page-second1111',
        selectionRevision: 1,
        currentSessionId: 'same-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      }));
      assert.equal((await duplicatePage()).value.state, 'conflict');
      assert.equal((await register('controller-11111111', true)).value.state, 'selected');
      assert.equal((await duplicatePage()).value.state, 'conflict');
      const staged = await rpcHandler('context/stage', {
        controllerId: 'controller-11111111',
        pageInstanceId: 'page-11111111',
        selectionRevision: 1,
        envelope: {
          contract: 'whaledock.context-bridge/v1',
          clientInstanceId: 'client-conflict1',
          hostInstanceId: handshake.value.hostInstanceId,
          sessionRef: ownedSessionRef,
          revision: 1,
          project: {
            projectId: `wdp1_${'3'.repeat(32)}`,
            relativePath: '.',
            workbenchId: 'builtin:video',
            title: '冲突上下文',
            projectRevision: null
          }
        },
        authToken
      });
      assert.equal(staged.value.accepted, true);
      assert.equal((await register('observer-22222222', false)).value.state, 'conflict');
      const conflicted = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        authToken
      });
      assert.equal(conflicted.value.state, 'conflict');
      assert.equal(conflicted.value.sessionRef, null);

      sessionEvent({ id: 'same-raw-session' }, { type: 'turn/start', data: { turn: 1 } });
      assert.equal(contextProvider.text({ agent: { id: 'same-raw-session' } }), '');
      const missed = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: handshake.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(missed.value.events.map((event) => event.type), ['ack', 'turn-miss']);
      assert.equal(missed.value.events[1].reason, 'session-unavailable');

      const wrongAuth = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        authToken: 'cd'.repeat(32)
      });
      assert.equal(wrongAuth.ok, false);
      const wrongSelection = await rpcHandler('selection/register', selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-unauth001',
        pageInstanceId: 'page-unauth000001',
        selectionRevision: 1,
        currentSessionId: null,
        managed: false,
        selectionToken: 'ef'.repeat(32)
      }));
      assert.equal(wrongSelection.ok, false);
      for (let index = 0; index < 6; index += 1) {
        const refusedHandshake = await rpcHandler(
          'handshake', handshakeRequest(`${index}`.padStart(64, '0'), 'ef'.repeat(32))
        );
        assert.equal(refusedHandshake.ok, false);
      }
      const stillAuthenticated = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-11111111',
        authToken
      });
      assert.equal(stillAuthenticated.ok, true,
        '未认证 handshake 不得挤出已有 RPC session');
      const unknown = await rpcHandler('handshake', {
        ...handshakeRequest(clientNonce), unexpected: true
      });
      assert.equal(unknown.ok, false);
      assert.notEqual(handshake.value.hostInstanceId, undefined);
    });

    await test('两活页面中较高 revision 一次接管，heartbeat 不往返夺权', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const register = (pageInstanceId, selectionRevision) => (
        rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-two-pages',
          pageInstanceId,
          selectionRevision,
          currentSessionId: 'two-pages-raw',
          managed: true,
          selectionToken: SELECTION_TOKEN
        }))
      );
      const first = await register('page-two-pages-a1', 1);
      const second = await register('page-two-pages-b2', 2);
      assert.equal(first.value.state, 'selected');
      assert.equal(second.value.state, 'selected');
      for (let index = 0; index < 4; index += 1) {
        const oldPage = await register('page-two-pages-a1', 1);
        const ownerPage = await register('page-two-pages-b2', 2);
        assert.equal(oldPage.value.state, 'conflict');
        assert.equal(oldPage.value.selectionRevision, 2);
        assert.equal(ownerPage.value.state, 'selected');
        assert.equal(ownerPage.value.sessionRef, second.value.sessionRef);
      }
    });

    await test('重复 stage 返回可消费 ACK，无需污染有序事件 journal', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '03'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, hello.value.hostInstanceId);
      const selected = await rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-duplicate1',
        pageInstanceId: 'page-duplicate0001',
        selectionRevision: 1,
        currentSessionId: 'duplicate-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      }));
      assert.equal(Object.prototype.hasOwnProperty.call(selected.value, 'sessionRef'), false);
      const selectedPrivate = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-duplicate1',
        authToken
      });
      const envelope = {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: 'client-duplicate01',
        hostInstanceId: hello.value.hostInstanceId,
        sessionRef: selectedPrivate.value.sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'d'.repeat(32)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title: '幂等恢复',
          projectRevision: null
        }
      };
      const payload = {
        controllerId: 'controller-duplicate1',
        pageInstanceId: 'page-duplicate0001',
        selectionRevision: 1,
        envelope,
        authToken
      };
      assert.equal((await rpcHandler('context/stage', payload)).value.state, 'effective');
      const duplicate = await rpcHandler('context/stage', payload);
      assert.equal(duplicate.value.state, 'duplicate');
      assert.deepEqual(duplicate.value.ack, {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: envelope.clientInstanceId,
        hostInstanceId: envelope.hostInstanceId,
        sessionRef: envelope.sessionRef,
        revision: 1,
        state: 'effective'
      });
      const events = await rpcHandler('events/read', {
        contract: 'whaledock.context-bridge/v1',
        hostInstanceId: envelope.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(events.value.events.map((event) => event.type), ['ack']);
    });

    await test('两 session 快速 A→B→A 每次轮换 opaque ref 且 turn 上下文不串线', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) { listeners.set(name, handler); }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '06'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, hello.value.hostInstanceId);
      const controllerId = 'controller-abaswitch';
      const pageInstanceId = 'page-abaswitch0001';
      const select = async (raw, revision) => {
        const reply = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId,
          pageInstanceId,
          selectionRevision: revision,
          currentSessionId: raw,
          managed: true,
          selectionToken: SELECTION_TOKEN
        }));
        const resolved = await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId, authToken
        });
        return { reply, sessionRef: resolved.value.sessionRef };
      };
      const stage = (selection, revision, title, digit) => rpcHandler('context/stage', {
        controllerId,
        pageInstanceId,
        selectionRevision: revision,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-abaswitch1',
          hostInstanceId: hello.value.hostInstanceId,
          sessionRef: selection.sessionRef,
          revision: 1,
          project: {
            projectId: `wdp1_${digit.repeat(32)}`,
            relativePath: '.',
            workbenchId: 'builtin:video',
            title,
            projectRevision: null
          }
        },
        authToken
      });
      const firstA = await select('raw-session-a-fast', 1);
      await stage(firstA, 1, 'A-first', 'a');
      const selectedB = await select('raw-session-b-fast', 2);
      await stage(selectedB, 2, 'B-only', 'b');
      const sessionEvent = listeners.get('session/event');
      sessionEvent({ id: 'raw-session-b-fast' }, { type: 'turn/start', data: { turn: 1 } });
      const bText = contextProvider.text({ agent: { id: 'raw-session-b-fast' } });
      assert.match(bText, /B-only/);
      assert.doesNotMatch(bText, /A-first/);
      sessionEvent({ id: 'raw-session-b-fast' }, { type: 'turn/end', data: { turn: 1 } });

      const secondA = await select('raw-session-a-fast', 3);
      assert.notEqual(secondA.sessionRef, firstA.sessionRef);
      await stage(secondA, 3, 'A-returned', 'c');
      sessionEvent({ id: 'raw-session-a-fast' }, { type: 'turn/start', data: { turn: 2 } });
      const aText = contextProvider.text({ agent: { id: 'raw-session-a-fast' } });
      assert.match(aText, /A-returned/);
      assert.doesNotMatch(aText, /B-only|A-first/);
    });

    await test('controller/record 有硬上限，lease 过期后可回收并重用容量', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;
      try {
        for (let index = 0; index < 128; index += 1) {
          const reply = await rpcHandler('selection/register', selectionRequest({
            contract: CONTRACT,
            controllerId: `observer-capacity-${String(index).padStart(3, '0')}`,
            pageInstanceId: `page-capacity-${String(index).padStart(3, '0')}`,
            selectionRevision: 1,
            currentSessionId: null,
            managed: false,
            selectionToken: SELECTION_TOKEN
          }));
          assert.notEqual(reply.value.code, 'controller-capacity');
        }
        const full = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'observer-capacity-overflow',
          pageInstanceId: 'page-capacity-overflow',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          selectionToken: SELECTION_TOKEN
        }));
        assert.equal(full.value.code, 'controller-capacity');
        now += 16000;
        const recovered = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'observer-capacity-reused',
          pageInstanceId: 'page-capacity-reused',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          selectionToken: SELECTION_TOKEN
        }));
        assert.equal(recovered.value.state, 'none');
      } finally {
        Date.now = originalNow;
      }
    });

    await test('冲突方 lease 过期后立即恢复唯一活跃 owner 的 turn 上下文', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      let sessionEvent = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) {
          if (name === 'session/event') sessionEvent = handler;
        }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '05'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, hello.value.hostInstanceId);
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;
      try {
        const register = (controllerId, pageInstanceId) => rpcHandler(
          'selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId,
          pageInstanceId,
          selectionRevision: 1,
          currentSessionId: 'lease-recovery-raw',
          managed: true,
            selectionToken: SELECTION_TOKEN
          })
        );
        const owner = await register('controller-leaseowner', 'page-leaseowner01');
        assert.equal(Object.prototype.hasOwnProperty.call(owner.value, 'sessionRef'), false);
        const ownerPrivate = await rpcHandler('selection/resolve', {
          contract: CONTRACT,
          controllerId: 'controller-leaseowner',
          authToken
        });
        await rpcHandler('context/stage', {
          controllerId: 'controller-leaseowner',
          pageInstanceId: 'page-leaseowner01',
          selectionRevision: 1,
          envelope: {
            contract: CONTRACT,
            clientInstanceId: 'client-leaseowner1',
            hostInstanceId: hello.value.hostInstanceId,
            sessionRef: ownerPrivate.value.sessionRef,
            revision: 1,
            project: {
              projectId: `wdp1_${'5'.repeat(32)}`,
              relativePath: '.',
              workbenchId: 'builtin:video',
              title: 'Lease 恢复',
              projectRevision: null
            }
          },
          authToken
        });
        now += 1000;
        assert.equal((await register(
          'controller-leaseother', 'page-leaseother01'
        )).value.state, 'conflict');
        now += 13000;
        assert.equal((await register(
          'controller-leaseowner', 'page-leaseowner01'
        )).value.state, 'conflict');
        now += 3000;
        sessionEvent({ id: 'lease-recovery-raw' }, {
          type: 'turn/start', data: { turn: 1 }
        });
        assert.match(contextProvider.text({ agent: { id: 'lease-recovery-raw' } }), /Lease 恢复/);
      } finally {
        Date.now = originalNow;
      }
    });

    await test('页面刷新会轮换 sessionRef，但已开启 turn 保持旧上下文直到结束', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) { listeners.set(name, handler); }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '04'.repeat(32);
      const handshakeReply = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = handshakeReply.value.hostInstanceId;
      const authToken = rpcSession(secret, clientNonce, hostInstanceId);
      const register = async (pageInstanceId, selectionRevision) => {
        const response = await rpcHandler('selection/register', selectionRequest({
          contract: 'whaledock.context-bridge/v1',
          controllerId: 'controller-refresh1',
          pageInstanceId,
          selectionRevision,
          currentSessionId: 'refresh-raw-session',
          managed: true,
          selectionToken: SELECTION_TOKEN
        }));
        const resolved = await rpcHandler('selection/resolve', {
          contract: CONTRACT,
          controllerId: 'controller-refresh1',
          authToken
        });
        return { response, sessionRef: resolved.value.sessionRef };
      };
      const first = await register('page-refresh0001', 1);
      const envelope = (sessionRef, clientInstanceId, title) => ({
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId,
        hostInstanceId,
        sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${title === 'A' ? 'a' : 'b'.repeat(1)}${'0'.repeat(31)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title,
          projectRevision: null
        }
      });
      const stage = (selection, pageInstanceId, selectionRevision, context) => (
        rpcHandler('context/stage', {
          controllerId: 'controller-refresh1',
          pageInstanceId,
          selectionRevision,
          envelope: context,
          authToken
        })
      );
      await stage(first.response.value, 'page-refresh0001', 1,
        envelope(first.sessionRef, 'client-refresh01', 'A'));
      const sessionEvent = listeners.get('session/event');
      sessionEvent({ id: 'refresh-raw-session' }, { type: 'turn/start', data: { turn: 1 } });
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"A"/);

      const second = await register('page-refresh0002', 2);
      assert.equal(second.response.value.state, 'selected');
      assert.notEqual(second.sessionRef, first.sessionRef);
      await stage(second.response.value, 'page-refresh0002', 2,
        envelope(second.sessionRef, 'client-refresh02', 'B'));
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"A"/);
      sessionEvent({ id: 'refresh-raw-session' }, {
        type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }
      });
      sessionEvent({ id: 'refresh-raw-session' }, { type: 'turn/start', data: { turn: 2 } });
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"B"/);
    });
  } finally {
    if (oldToken === undefined) delete process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
    else process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN = oldToken;
    if (oldSelectionToken === undefined) delete process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN;
    else process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN = oldSelectionToken;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nCONTEXT POC PLUGIN ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
