'use strict';

// 主窗外壳渲染层。三条硬规矩：
// 1) 包里来的文字（工作台名、按钮标题、onboarding 正文）一律 textContent 写入，不做 HTML 字符串赋值；
// 2) onboarding.md 只按行做「# 加大加粗 / - 成条目」两种样式，不解析 Markdown、不生成任何链接；
// 3) 按钮点下去只发一个 actionId 给主进程，提示词全文在主进程侧，渲染层从头到尾看不到它。
const api = window.whaleShell;

const el = (id) => document.getElementById(id);
const railName = el('switcher-name');
const actionsBox = el('actions');
const actionNote = el('action-note');
const switcherLayer = el('switcher-layer');
const switcherList = el('switcher-list');
const switcherBroken = el('switcher-broken');
const onboardingLayer = el('onboarding-layer');
const onboardingBody = el('onboarding-body');
const confirmLayer = el('confirm-layer');
const confirmTitle = el('confirm-title');
const confirmBody = el('confirm-body');
const confirmOk = el('confirm-ok');
const dropBox = el('drop');
const toast = el('toast');
const cockpitName = el('cockpit-name');
const routeStages = el('route-stages');
const taskState = el('task-state');
const taskStateLabel = el('task-state-label');
const taskActive = el('task-active');
const taskWaiting = el('task-waiting');
const taskCompleted = el('task-completed');
const taskRecent = el('task-recent');
const toggleChat = el('toggle-chat');
const sceneKicker = el('scene-kicker');
const sceneHeading = el('scene-heading');
const sceneSummary = el('scene-summary');
const sceneStage = el('scene-stage');

let state = {
  current: null, packages: [], skipped: [], defaultLabel: '默认工作台', busy: false,
  cockpit: null
};
let confirmHandler = null;
let toastTimer = null;
let activeScene = 'today';
let videoState = {
  status: 'loading', route: [], today: [], projects: [], proposal: null,
  ordinaryCount: 0, issues: [], selectedToken: null, truncated: false
};
let currentDocument = null;
let selectedProjectToken = null;
let selectedBlockToken = null;
let sceneBusy = false;
let inspirationDraft = '';

const ROUTE = Object.freeze([
  { id: 'inspiration', label: '灵感' },
  { id: 'topic', label: '选题' },
  { id: 'script', label: '写稿' },
  { id: 'shoot', label: '拍摄' },
  { id: 'edit', label: '剪辑', deferred: true },
  { id: 'publish', label: '发布' },
  { id: 'data', label: '数据', unavailable: true },
  { id: 'review', label: '复盘', deferred: true },
  { id: 'asset', label: '打法' }
]);

const SCENES = Object.freeze({
  today: { kicker: 'TODAY · 今天', heading: '今天，推进一件事', summary: '现场跟着文件走；没有证据的位置保持留白。', current: '今天' },
  inspiration: { kicker: 'INBOX · 灵感', heading: '把一坨东西丢进来', summary: '先接住，再拆条；链接只作为文字保存，不会自动访问。' },
  topic: { kicker: 'TOPIC · 选题', heading: '立项就是做选择题', summary: '角度和钩子由你拍板，鲸坞不替你决定。', current: '选题现场' },
  script: { kicker: 'SCRIPT · 脚本', heading: '一次只改一块', summary: '建议先进入对照卡；你点采用后才写回原稿。', current: '脚本现场' },
  shoot: { kicker: 'SHOOT · 拍摄', heading: 'AI 最安静的现场', summary: '提词、打勾、记重来；拍没拍过只由你确认。', current: '拍摄现场' },
  edit: { kicker: 'EDIT · 剪辑', heading: '工单先留在航道上', summary: '一期不碰剪辑时间线，现场暂未接通。', current: '剪辑工单' },
  publish: { kicker: 'PUBLISH · 发布', heading: '过灯，再由你亲手发布', summary: '鲸坞只做检查，不会替你点击平台发布。', current: '发布现场' },
  data: { kicker: 'DATA · 数据', heading: '侦察中，未接通', summary: '没有平台数据通道时，不展示播放、漏斗或雷达数字。', current: '数据舱门' },
  review: { kicker: 'REVIEW · 复盘', heading: '复盘要有去向', summary: '没有平台数据时只处理真实复盘文件。' },
  asset: { kicker: 'PLAYBOOK · 打法库', heading: '把有用的一招留下来', summary: '只收你从复盘显式固化的内容；一期不显示战绩。' }
});

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value == null ? '' : String(value);
  return node;
}

function openLayer(layer) { layer.classList.add('open'); }
function closeLayer(layer) { layer.classList.remove('open'); }

function showToast(message, ms = 6000) {
  toast.textContent = message == null ? '' : String(message);
  toast.classList.add('open');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('open'), ms);
}

// ---------- 左栏 ----------

function renderRail() {
  const current = state.current;
  // 重工作台切换要停后端、建目录、再重启，真机上几秒到十几秒；
  // 这段时间左栏必须明确显示在忙，而不是看起来点了没反应。
  railName.textContent = state.busy ? '正在切换…' : (current ? current.name : state.defaultLabel);
  el('switcher-button').disabled = state.busy === true;

  clear(actionsBox);
  const actions = current && Array.isArray(current.actions) ? current.actions : [];
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    if (action.hint) button.title = action.hint;
    button.dataset.actionId = action.id;
    if (state.busy) button.disabled = true;
    button.addEventListener('click', () => {
      if (action.confirm) {
        askConfirm('要发出这个动作吗？', [
          `按钮：${action.label}`,
          action.hint ? `说明：${action.hint}` : '',
          '这会把包里写好的一段提示词原样发给当前会话。'
        ].filter(Boolean), () => submitAction(button, action));
        return;
      }
      submitAction(button, action);
    });
    actionsBox.appendChild(button);
  }
}

// ---------- 视频驾驶舱壳 ----------

function taskCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : '—';
}

function renderTaskFlow(flow) {
  const value = flow && typeof flow === 'object' ? flow : null;
  const activity = value && value.activity && typeof value.activity === 'object'
    ? value.activity : { state: 'offline', label: '正在接线' };
  taskState.dataset.state = activity.state || 'offline';
  taskStateLabel.textContent = activity.label || '正在接线';
  const counts = value && value.counts && typeof value.counts === 'object' ? value.counts : {};
  taskActive.textContent = taskCount(counts.active);
  taskWaiting.textContent = taskCount(counts.waiting);
  taskCompleted.textContent = taskCount(counts.completed);
  clear(taskRecent);
  const recent = value && Array.isArray(value.recent) ? value.recent.slice(0, 3) : [];
  for (const item of recent) {
    const label = item && item.label ? item.label : '匿名任务';
    const suffix = item && item.result === 'completed' ? '已完成'
      : (item && item.result === 'cancelled' ? '已取消' : '需留意');
    taskRecent.appendChild(text('span', `${label} · ${suffix}`, 'task-chip'));
  }
  if (!recent.length) taskRecent.appendChild(text('span', '暂无最近终态', 'task-chip'));
}

function renderRoute() {
  clear(routeStages);
  const routeCounts = new Map((Array.isArray(videoState.route) ? videoState.route : [])
    .map((item) => [item && item.stage, item && item.count]));
  for (const stage of ROUTE) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-step';
    if (stage.id === activeScene) button.classList.add('active');
    if (stage.deferred || stage.unavailable) button.classList.add('blocked');
    const count = routeCounts.get(stage.id);
    button.textContent = Number.isSafeInteger(count) ? `${stage.label} ${count}` : stage.label;
    button.title = stage.unavailable ? '侦察中，未接通'
      : (stage.deferred ? '后续批次接通' : `进入${stage.label}现场`);
    button.addEventListener('click', () => {
      if (state.cockpit && state.cockpit.chatOpen === true) {
        void api.setCockpitView({ chatOpen: false });
      }
      activeScene = stage.id;
      currentDocument = null;
      selectedBlockToken = null;
      renderRoute();
      renderScene();
    });
    routeStages.appendChild(button);
  }
}

function renderSceneHeading() {
  const scene = SCENES[activeScene] || SCENES.today;
  sceneKicker.textContent = scene.kicker;
  sceneHeading.textContent = scene.heading;
  sceneSummary.textContent = scene.summary;
}

function button(label, className = 'secondary-action') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.disabled = sceneBusy;
  return node;
}

function projectsAt(stage) {
  return (Array.isArray(videoState.projects) ? videoState.projects : [])
    .filter((project) => project && project.stage === stage && project.status !== 'ignored');
}

function selectedProject(projects) {
  const rows = Array.isArray(projects) ? projects : [];
  return rows.find((project) => project.projectToken === selectedProjectToken) || rows[0] || null;
}

function operationText(result, fallback) {
  if (!result || typeof result !== 'object') return fallback;
  if (result.text) return String(result.text);
  if (result.state === 'accepted') return `已提交给 ${result.target || '当前会话'}。`;
  if (result.state === 'unknown') return '已提交，但没有收到确认；请先到会话里核对，不会自动重发。';
  if (result.state === 'rejected') return `会话拒绝了提交（${result.reason || 'rejected'}）。`;
  if (result.kind === 'ok') return fallback;
  return fallback;
}

async function runSceneOperation(label, operation) {
  if (sceneBusy) return null;
  sceneBusy = true;
  renderScene();
  try {
    const result = await operation();
    const message = operationText(result, `${label}已完成。`);
    showToast(message);
    return result;
  } catch (error) {
    const message = error && error.message ? String(error.message).slice(0, 300) : `${label}失败。`;
    showToast(message);
    return null;
  } finally {
    sceneBusy = false;
    renderScene();
  }
}

function appendEmpty(title, detail, actionLabel, onAction) {
  const box = document.createElement('div');
  box.className = 'empty-cockpit';
  const body = document.createElement('div');
  body.appendChild(text('strong', title));
  body.appendChild(text('span', detail));
  if (actionLabel && typeof onAction === 'function') {
    const actions = document.createElement('div');
    actions.className = 'scene-actions';
    const action = button(actionLabel, 'primary-action');
    action.addEventListener('click', onAction);
    actions.appendChild(action);
    body.appendChild(actions);
  }
  box.appendChild(body);
  sceneStage.appendChild(box);
}

function projectCard(project, options = {}) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'project-card';
  if (project.projectToken === selectedProjectToken) node.classList.add('selected');
  node.disabled = sceneBusy;
  const top = document.createElement('div');
  top.className = 'topline';
  top.appendChild(text('span', project.stageLabel || '未分类'));
  top.appendChild(text('span', project.status || project.fileLabel || '本地文件'));
  node.appendChild(top);
  node.appendChild(text('h3', project.title || '未命名项目'));
  const detail = project.decision || project.hook || project.angle || project.audience || project.fileLabel;
  if (detail) node.appendChild(text('p', detail));
  const chips = [].concat(project.platforms || []).slice(0, 3);
  if (chips.length) {
    const row = document.createElement('div');
    row.className = 'chip-row';
    for (const value of chips) row.appendChild(text('span', value, 'chip'));
    node.appendChild(row);
  }
  node.addEventListener('click', () => {
    selectedProjectToken = project.projectToken;
    if (typeof options.onSelect === 'function') options.onSelect(project);
    else renderScene();
  });
  return node;
}

function projectGrid(projects, options = {}) {
  const grid = document.createElement('div');
  grid.className = 'project-grid';
  for (const project of projects) grid.appendChild(projectCard(project, options));
  return grid;
}

async function openDocument(project, nextScene = null) {
  const result = await runSceneOperation('打开文档', () => api.openVideoDocument(project.projectToken));
  if (!result || result.kind !== 'video-document') return;
  currentDocument = result;
  selectedProjectToken = project.projectToken;
  selectedBlockToken = null;
  if (nextScene) activeScene = nextScene;
  renderRoute();
  renderScene();
}

function appendProjectActions(container, project) {
  const actions = Array.isArray(project.actions) ? project.actions : [];
  for (const action of actions) {
    const control = button(action.label || '继续', 'primary-action');
    if (action.hint) control.title = action.hint;
    control.addEventListener('click', () => {
      void runSceneOperation(action.label || '项目动作', () => (
        api.runVideoProjectAction(project.projectToken, action.id)
      ));
    });
    container.appendChild(control);
  }
}

function renderTodayScene() {
  const projects = Array.isArray(videoState.today) ? videoState.today : [];
  if (!projects.length) {
    const detail = videoState.status === 'ready'
      ? `没有带今天状态的项目；已看见 ${videoState.projects.length} 份受控文档、${videoState.ordinaryCount || 0} 份普通 Markdown。`
      : (videoState.text || '本地工作区还没准备好。');
    appendEmpty('今天没有被系统替你安排', detail, '打开工作区', () => { void api.openWorkspace(); });
    return;
  }
  const project = selectedProject(projects);
  const hero = document.createElement('section');
  hero.className = 'scene-hero';
  const main = document.createElement('div');
  main.className = 'scene-main';
  const body = document.createElement('div');
  body.appendChild(text('span', `${project.stageLabel || '现场'} · ${project.status || '待推进'}`, 'scene-badge'));
  body.appendChild(text('h2', project.title, 'scene-title'));
  body.appendChild(text('p', project.decision || project.hook || '这张卡来自本地文件，没有补写平台状态。', 'scene-copy'));
  main.appendChild(body);
  const actions = document.createElement('div');
  actions.className = 'scene-actions';
  const view = button('展开这份文件', 'secondary-action');
  view.addEventListener('click', () => { void openDocument(project, 'script'); });
  actions.appendChild(view);
  appendProjectActions(actions, project);
  main.appendChild(actions);
  hero.appendChild(main);
  const side = document.createElement('div');
  side.className = 'scene-side';
  for (const item of projects.slice(0, 3)) {
    const card = document.createElement('div');
    card.className = 'signal-card';
    card.appendChild(text('span', item.stageLabel || '未分类', 'label'));
    card.appendChild(text('strong', item.title));
    card.appendChild(text('small', item.status || item.fileLabel || '本地 Markdown'));
    side.appendChild(card);
  }
  hero.appendChild(side);
  sceneStage.appendChild(hero);
}

function renderInspirationScene() {
  const stack = document.createElement('div');
  stack.className = 'scene-stack';
  const drop = document.createElement('section');
  drop.className = 'inbox-drop';
  const head = document.createElement('div');
  head.appendChild(text('span', 'LOCAL DROP · 纯本地', 'hero-kicker'));
  head.appendChild(text('h2', '先接住，不丢灵感', 'scene-title'));
  drop.appendChild(head);
  const input = document.createElement('textarea');
  input.maxLength = 8192;
  input.placeholder = '粘贴一句念头、一批笔记，或一条链接。链接只按文字保存，不会自动访问。';
  input.value = inspirationDraft;
  input.addEventListener('input', () => { inspirationDraft = input.value; });
  drop.appendChild(input);
  const foot = document.createElement('div');
  foot.className = 'inbox-foot';
  foot.appendChild(text('small', '存入后生成一份新的 Markdown；不会覆盖、移动或删除你的原文件。'));
  const actions = document.createElement('div');
  actions.className = 'scene-actions';
  for (const spec of [
    { label: '仅存入待分拣', askAgent: false, primary: false },
    { label: '存入并请鲸坞拆条', askAgent: true, primary: true }
  ]) {
    const control = button(spec.label, spec.primary ? 'primary-action' : 'secondary-action');
    control.disabled = sceneBusy || !inspirationDraft.trim();
    control.addEventListener('click', async () => {
      const payload = inspirationDraft;
      const result = await runSceneOperation(spec.label, () => api.runVideoSceneAction({
        action: 'deposit-inspiration', text: payload, askAgent: spec.askAgent
      }));
      if (result && (result.kind === 'ok' || result.stored === true)) inspirationDraft = '';
    });
    actions.appendChild(control);
  }
  foot.appendChild(actions);
  drop.appendChild(foot);
  stack.appendChild(drop);
  const cards = projectsAt('inspiration');
  if (cards.length) {
    const sectionHead = document.createElement('div');
    sectionHead.className = 'scene-section-head';
    sectionHead.appendChild(text('strong', '待分拣'));
    sectionHead.appendChild(text('span', `${cards.length} 张真实文件卡`));
    stack.appendChild(sectionHead);
    const grid = document.createElement('div');
    grid.className = 'project-grid';
    for (const project of cards) {
      const card = document.createElement('article');
      card.className = 'project-card';
      card.appendChild(text('span', project.fileLabel || '本地 Markdown', 'hero-kicker'));
      card.appendChild(text('h3', project.title));
      if (project.decision) card.appendChild(text('p', project.decision));
      const triage = document.createElement('div');
      triage.className = 'scene-actions';
      for (const spec of [['promote', '收进选题'], ['ignore', '忽略但不删除']]) {
        const control = button(spec[1], spec[0] === 'promote' ? 'primary-action' : 'secondary-action');
        control.addEventListener('click', () => { void runSceneOperation(spec[1], () => api.runVideoSceneAction({
          action: 'triage-inspiration', projectToken: project.projectToken, decision: spec[0]
        })); });
        triage.appendChild(control);
      }
      card.appendChild(triage);
      grid.appendChild(card);
    }
    stack.appendChild(grid);
  }
  sceneStage.appendChild(stack);
}

function choiceRow(project, field, candidates, chosen) {
  const row = document.createElement('div');
  row.className = 'chip-row';
  if (!candidates.length) {
    row.appendChild(text('span', `文件里没有${field === 'angle' ? '角度' : '钩子'}候选`, 'chip'));
    return row;
  }
  for (const value of candidates) {
    const control = button(value, 'chip');
    control.setAttribute('aria-pressed', value === chosen ? 'true' : 'false');
    control.addEventListener('click', () => {
      void runSceneOperation('写回选题选择', () => api.runVideoSceneAction({
        action: 'choose-topic', projectToken: project.projectToken, field, value
      }));
    });
    row.appendChild(control);
  }
  return row;
}

function renderTopicScene() {
  const projects = projectsAt('topic');
  if (!projects.length) {
    appendEmpty('还没有选题卡', '把灵感存入待分拣，或在 01_选题库 放入带 stage: topic 的 Markdown。', '去投灵感', () => {
      activeScene = 'inspiration'; renderRoute(); renderScene();
    });
    return;
  }
  const project = selectedProject(projects);
  selectedProjectToken = project.projectToken;
  const stack = document.createElement('div');
  stack.className = 'scene-stack';
  if (projects.length > 1) stack.appendChild(projectGrid(projects));
  const hero = document.createElement('section');
  hero.className = 'scene-hero single';
  const main = document.createElement('div');
  main.className = 'scene-main';
  main.appendChild(text('span', project.audience ? `给谁看 · ${project.audience}` : '受众未写入文件', 'scene-badge'));
  main.appendChild(text('h2', project.title, 'scene-title'));
  const angleHead = document.createElement('div');
  angleHead.className = 'scene-section-head';
  angleHead.appendChild(text('strong', '角度 · 单选'));
  angleHead.appendChild(text('span', project.angle ? '已拍板' : '待你拍板'));
  main.appendChild(angleHead);
  main.appendChild(choiceRow(project, 'angle', project.angles || [], project.angle));
  const hookHead = document.createElement('div');
  hookHead.className = 'scene-section-head';
  hookHead.appendChild(text('strong', '钩子 · 单选'));
  hookHead.appendChild(text('span', project.hook ? '已拍板' : '待你拍板'));
  main.appendChild(hookHead);
  main.appendChild(choiceRow(project, 'hook', project.hooks || [], project.hook));
  const actions = document.createElement('div');
  actions.className = 'scene-actions';
  appendProjectActions(actions, project);
  const inspect = button('展开原文件', 'secondary-action');
  inspect.addEventListener('click', () => { void openDocument(project, 'script'); });
  actions.appendChild(inspect);
  main.appendChild(actions);
  hero.appendChild(main);
  stack.appendChild(hero);
  sceneStage.appendChild(stack);
}

function renderProposal() {
  const proposal = videoState.proposal;
  if (!proposal) return null;
  const card = document.createElement('section');
  card.className = 'proposal-card';
  const head = document.createElement('div');
  head.className = 'proposal-head';
  const title = document.createElement('div');
  title.appendChild(text('span', '鲸坞建议 · 黄牌，不会自动生效', 'hero-kicker'));
  title.appendChild(text('strong', `${proposal.title || '当前文档'} · ${proposal.intentLabel || '建议'}`));
  head.appendChild(title);
  head.appendChild(text('span', '', 'lamp'));
  card.appendChild(head);
  if (proposal.status === 'queued') {
    card.appendChild(text('p', '建议副本已建立，正在等会话把目标内容块写好。原稿没有变化。', 'scene-copy'));
  } else {
    const compare = document.createElement('div');
    compare.className = 'compare-grid';
    for (const pane of [
      { label: '原来', value: proposal.before },
      { label: proposal.status === 'adopted' ? '已采用' : '鲸坞建议', value: proposal.after }
    ]) {
      const node = document.createElement('div');
      node.className = 'compare-pane';
      node.appendChild(text('span', pane.label));
      node.appendChild(text('p', pane.value || '建议尚未就绪'));
      compare.appendChild(node);
    }
    card.appendChild(compare);
  }
  const actions = document.createElement('div');
  actions.className = 'proposal-actions';
  if (proposal.canAdopt && proposal.proposalToken) {
    const adopt = button('采用这一块', 'primary-action');
    adopt.addEventListener('click', () => { void runSceneOperation('采用建议', () => (
      api.decideVideoProposal(
        proposal.proposalToken, 'adopt', proposal.proposalRevisionToken
      )
    )); });
    actions.appendChild(adopt);
  }
  if (proposal.canReject && proposal.proposalToken) {
    const reject = button('退回，原稿不动', 'secondary-action');
    reject.addEventListener('click', () => { void runSceneOperation('退回建议', () => (
      api.decideVideoProposal(proposal.proposalToken, 'reject')
    )); });
    actions.appendChild(reject);
  }
  if (proposal.canUndo && proposal.revisionToken) {
    const undo = button('撤销上一次采用', 'secondary-action');
    undo.addEventListener('click', () => { void runSceneOperation('撤销采用', () => (
      api.undoVideoRevision(proposal.revisionToken)
    )); });
    actions.appendChild(undo);
  }
  if (actions.childNodes.length) card.appendChild(actions);
  return card;
}

function renderDocumentBlocks() {
  if (!currentDocument) return null;
  const stage = document.createElement('section');
  stage.className = 'document-stage';
  const head = document.createElement('div');
  head.className = 'document-head';
  const label = document.createElement('div');
  label.appendChild(text('strong', currentDocument.title));
  label.appendChild(text('span', `${currentDocument.stageLabel || '未分类'} · ${currentDocument.blockCount || 0} 块`, 'chip'));
  head.appendChild(label);
  const close = button('返回文件卡', 'secondary-action');
  close.addEventListener('click', () => { currentDocument = null; selectedBlockToken = null; renderScene(); });
  head.appendChild(close);
  stage.appendChild(head);
  const proposal = renderProposal();
  if (proposal) stage.appendChild(proposal);
  const blocks = document.createElement('div');
  blocks.className = 'block-list';
  for (const item of currentDocument.blocks || []) {
    const block = document.createElement('article');
    block.className = 'document-block';
    if (item.blockToken === selectedBlockToken) block.classList.add('selected');
    const meta = document.createElement('div');
    meta.className = 'block-meta';
    meta.appendChild(text('span', item.kind || '内容块'));
    meta.appendChild(text('span', `第 ${item.startLine}-${item.endLine} 行`));
    block.appendChild(meta);
    block.appendChild(text('p', item.text, 'block-copy'));
    const toolbar = document.createElement('div');
    toolbar.className = 'block-toolbar';
    for (const spec of [
      ['revise', '改这段'], ['spoken', '更口语'], ['shorten', '压时长'], ['ask', '问一句']
    ]) {
      const control = button(spec[1], '');
      control.addEventListener('click', (event) => {
        event.stopPropagation();
        void runSceneOperation(spec[1], () => api.runVideoBlockAction(
          currentDocument.projectToken, item.blockToken, spec[0]
        ));
      });
      toolbar.appendChild(control);
    }
    block.appendChild(toolbar);
    block.addEventListener('click', () => {
      selectedBlockToken = item.blockToken;
      renderScene();
    });
    blocks.appendChild(block);
  }
  stage.appendChild(blocks);
  return stage;
}

function renderScriptScene() {
  const documentView = renderDocumentBlocks();
  if (documentView) { sceneStage.appendChild(documentView); return; }
  const projects = projectsAt('script').concat(projectsAt('shoot'));
  if (!projects.length) {
    appendEmpty('还没有可展开的脚本', '在 02_脚本 或 03_口播稿 放入 Markdown；普通文档也会被读成内容块。');
    return;
  }
  const stack = document.createElement('div');
  stack.className = 'scene-stack';
  const proposal = renderProposal();
  if (proposal) stack.appendChild(proposal);
  stack.appendChild(projectGrid(projects, { onSelect: (project) => { void openDocument(project); } }));
  sceneStage.appendChild(stack);
}

function renderShootScene() {
  const projects = projectsAt('shoot').filter((project) => project.canShoot);
  if (!projects.length) {
    appendEmpty('还没有可拍的口播稿', '拍摄现场只接受你明确选择的 03_口播稿 文件；素材清单不会被误当成台词。');
    return;
  }
  const project = selectedProject(projects);
  selectedProjectToken = project.projectToken;
  const stack = document.createElement('div');
  stack.className = 'scene-stack';
  stack.appendChild(projectGrid(projects));
  const hero = document.createElement('section');
  hero.className = 'scene-hero compact single';
  const main = document.createElement('div');
  main.className = 'scene-main';
  main.appendChild(text('span', 'FULLSCREEN · 本地提词', 'scene-badge'));
  main.appendChild(text('h2', project.title, 'scene-title'));
  main.appendChild(text('p', '清单与提词两种模式；Space 暂停/继续，R 记录重来。收工后只写拍摄记录与素材缺口，不改口播原稿。', 'scene-copy'));
  const actions = document.createElement('div');
  actions.className = 'scene-actions';
  const open = button('进入拍摄现场', 'primary-action');
  open.addEventListener('click', () => { void runSceneOperation('打开拍摄现场', () => api.openShooting(project.projectToken)); });
  actions.appendChild(open);
  main.appendChild(actions);
  hero.appendChild(main);
  stack.appendChild(hero);
  sceneStage.appendChild(stack);
}

function renderPublishScene() {
  const checklists = projectsAt('publish');
  if (!checklists.length) {
    const sources = projectsAt('shoot').concat(projectsAt('script'), projectsAt('edit'));
    if (!sources.length) {
      appendEmpty('还没有发布检查单', '先准备脚本或口播稿；鲸坞不会凭空生成发布状态。');
      return;
    }
    const project = selectedProject(sources);
    selectedProjectToken = project.projectToken;
    const stack = document.createElement('div');
    stack.className = 'scene-stack';
    stack.appendChild(projectGrid(sources));
    const create = button('为所选项目新建检查单', 'primary-action');
    create.addEventListener('click', () => { void runSceneOperation('新建发布检查单', () => api.runVideoSceneAction({
      action: 'create-publish-checklist', projectToken: project.projectToken
    })); });
    stack.appendChild(create);
    sceneStage.appendChild(stack);
    return;
  }
  const project = selectedProject(checklists);
  selectedProjectToken = project.projectToken;
  const surface = project.publish;
  const stack = document.createElement('div');
  stack.className = 'scene-stack';
  if (checklists.length > 1) stack.appendChild(projectGrid(checklists));
  const hero = document.createElement('section');
  hero.className = 'scene-hero';
  const main = document.createElement('div');
  main.className = 'scene-main';
  main.appendChild(text('span', surface && surface.ready ? '检查项已齐 · 仍需人工发布' : '过灯检查 · 不代发', 'scene-badge'));
  main.appendChild(text('h2', project.title, 'scene-title'));
  const lights = document.createElement('div');
  lights.className = 'publish-lights';
  for (const light of (surface && surface.lights) || []) {
    const control = button('', 'publish-light');
    if (light.checked) control.classList.add('on');
    control.disabled = sceneBusy || !light.available
      || (light.id === 'ai-label' && surface.aiDisclosure !== 'ai');
    control.appendChild(text('span', '', 'lamp'));
    control.appendChild(text('span', light.label));
    control.addEventListener('click', () => { void runSceneOperation('更新发布检查灯', () => api.runVideoSceneAction({
      action: 'toggle-publish-light', projectToken: project.projectToken,
      lightId: light.id, checked: !light.checked
    })); });
    lights.appendChild(control);
  }
  main.appendChild(lights);
  const ai = document.createElement('div');
  ai.className = 'ai-choice';
  for (const choice of [
    ['unknown', '待确认'], ['ai', '含 AI 生成'], ['not-ai', '不含 AI 生成']
  ]) {
    const control = button(choice[1], '');
    control.setAttribute('aria-pressed', surface && surface.aiDisclosure === choice[0] ? 'true' : 'false');
    control.addEventListener('click', () => { void runSceneOperation('记录 AI 内容状态', () => api.runVideoSceneAction({
      action: 'set-ai-disclosure', projectToken: project.projectToken, value: choice[0]
    })); });
    ai.appendChild(control);
  }
  main.appendChild(ai);
  main.appendChild(text('p', surface && surface.published
    ? '你已在文件里确认“本人已发布”；这不是平台回读。'
    : '最后一下始终由你在平台完成；鲸坞不会宣称已发布或已合规。', 'scene-copy'));
  hero.appendChild(main);
  const side = document.createElement('div');
  side.className = 'scene-side';
  const card = document.createElement('div');
  card.className = 'signal-card';
  card.appendChild(text('span', '发布边界', 'label'));
  card.appendChild(text('strong', surface && surface.ready ? '检查项已齐' : '还有灯未确认'));
  card.appendChild(text('small', '只表示本地清单状态，不代表平台规则审查。'));
  side.appendChild(card);
  hero.appendChild(side);
  stack.appendChild(hero);
  sceneStage.appendChild(stack);
}

function renderReviewScene() {
  const projects = projectsAt('review');
  if (!projects.length) {
    appendEmpty('没有真实复盘文件', '一期没有平台数据回读；不会自动生成播放量、评论聚类或结论。');
    return;
  }
  const project = selectedProject(projects);
  selectedProjectToken = project.projectToken;
  const stack = document.createElement('div');
  stack.className = 'scene-stack';
  stack.appendChild(projectGrid(projects));
  const action = button('显式固化进打法库', 'primary-action');
  action.addEventListener('click', () => { void runSceneOperation('固化打法', () => api.runVideoSceneAction({
    action: 'solidify-tactic', projectToken: project.projectToken
  })); });
  stack.appendChild(action);
  sceneStage.appendChild(stack);
}

function renderAssetScene() {
  const projects = projectsAt('asset');
  if (!projects.length) {
    appendEmpty('打法库还是空的', '打法只能由你从真实复盘显式固化；一期不显示使用次数或胜率。');
    return;
  }
  const wall = document.createElement('div');
  wall.className = 'tactic-wall';
  for (const project of projects) wall.appendChild(text('span', project.title, 'tactic-chip'));
  sceneStage.appendChild(wall);
}

function renderUnavailableScene(kind) {
  const door = document.createElement('div');
  door.className = 'data-door';
  const body = document.createElement('div');
  body.appendChild(text('div', '', 'door-lamp'));
  body.appendChild(text('h2', kind === 'data' ? '侦察中，未接通' : '一期暂未接通'));
  body.appendChild(text('p', kind === 'data'
    ? '抖音、小红书、视频号都没有可验证的数据通道；这里不展示播放量、漏斗、评论次数或雷达数字。'
    : '鲸坞不会进入剪辑时间线；当前只保留航道位置，不伪装已有剪辑工单。'));
  door.appendChild(body);
  sceneStage.appendChild(door);
}

function renderScene() {
  renderSceneHeading();
  clear(sceneStage);
  if (videoState.status === 'loading') {
    appendEmpty('正在读取工作区', '只投影本地 Markdown 事实。');
    return;
  }
  if (videoState.truncated) {
    const warning = text('div', '扫描达到安全上限，当前卡片与计数不完整；没有把截断结果冒充全量。', 'status-strip scan-warning');
    sceneStage.appendChild(warning);
  }
  const otherIssues = videoState.issues.filter((issue) => issue && issue.reason !== 'scan-limit-reached');
  if (otherIssues.length) {
    const count = otherIssues.reduce((total, issue) => total
      + (Number.isSafeInteger(issue.count) ? issue.count : 0), 0);
    sceneStage.appendChild(text(
      'div', `有 ${count || otherIssues.length} 项本地文件未纳入；没有用旧数据补齐。`,
      'status-strip scan-warning'
    ));
  }
  const renderers = {
    today: renderTodayScene,
    inspiration: renderInspirationScene,
    topic: renderTopicScene,
    script: renderScriptScene,
    shoot: renderShootScene,
    edit: () => renderUnavailableScene('edit'),
    publish: renderPublishScene,
    data: () => renderUnavailableScene('data'),
    review: renderReviewScene,
    asset: renderAssetScene
  };
  (renderers[activeScene] || renderTodayScene)();
}

function applyVideoState(next) {
  if (!next || typeof next !== 'object') return;
  videoState = {
    status: next.status || 'error',
    text: next.text || null,
    route: Array.isArray(next.route) ? next.route : [],
    today: Array.isArray(next.today) ? next.today : [],
    projects: Array.isArray(next.projects) ? next.projects : [],
    proposal: next.proposal && typeof next.proposal === 'object' ? next.proposal : null,
    ordinaryCount: Number.isSafeInteger(next.ordinaryCount) ? next.ordinaryCount : 0,
    truncated: next.truncated === true,
    issues: Array.isArray(next.issues) ? next.issues : [],
    selectedToken: typeof next.selectedToken === 'string' ? next.selectedToken : null
  };
  const tokens = new Set(videoState.projects.map((project) => project.projectToken));
  if (selectedProjectToken && !tokens.has(selectedProjectToken)) {
    selectedProjectToken = null;
    currentDocument = null;
    selectedBlockToken = null;
  }
  renderRoute();
  renderScene();
}

function renderCockpit() {
  const cockpit = state.cockpit && typeof state.cockpit === 'object' ? state.cockpit : null;
  const available = Boolean(cockpit && cockpit.kind === 'video');
  const active = Boolean(available && cockpit.mode === 'cockpit');
  document.body.classList.toggle('cockpit-available', available);
  document.body.classList.toggle('cockpit-active', active);
  document.body.classList.toggle('chat-open', active && cockpit.chatOpen === true);
  cockpitName.textContent = state.current ? state.current.name : '短视频创作台';
  const chatOpen = Boolean(active && cockpit.chatOpen === true);
  toggleChat.textContent = chatOpen ? '返回现场' : '对话 ⌘K';
  toggleChat.setAttribute('aria-pressed', chatOpen ? 'true' : 'false');
  toggleChat.title = chatOpen ? '返回视频创作现场' : '打开完整 dsh 对话现场';
  renderTaskFlow(cockpit && cockpit.taskFlow);
  renderRoute();
  renderScene();
}

// 点击后 5 秒禁用自己：防止用户以为没发出去而连点造成重复排队（D-4）。
function submitAction(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  actionNote.textContent = `正在发送「${action.label}」…`;
  const release = setTimeout(() => { button.disabled = false; }, 5000);
  api.runAction(action.id).then((result) => {
    if (!result || result.state === 'error') {
      actionNote.textContent = (result && result.text) || '没能发出去。';
      return;
    }
    if (result.state === 'accepted') {
      // 说清楚发去了哪个会话：dsh 的会话不一定跟当前工作区是同一个目录，
      // 发错了会话时 agent 会老实说找不到文件夹，但用户得知道去哪看。
      actionNote.textContent = `已发出「${action.label}」→ ${result.target || '当前会话'}。`
        + '\n如果 agent 说找不到文件夹，说明这个会话不在本工作台的工作区里，换一个会话再点。';
      return;
    }
    if (result.state === 'rejected') {
      actionNote.textContent = `会话拒绝了这次提交（${result.reason || 'rejected'}）。`;
      return;
    }
    // unknown：绝不自动重试，把决定权交回用户。
    actionNote.textContent = '已提交，但没收到确认，请到会话里看一眼再决定要不要重发。';
  }).catch((error) => {
    actionNote.textContent = error && error.message ? String(error.message).slice(0, 240) : '发送失败。';
  }).finally(() => {
    clearTimeout(release);
    setTimeout(() => { button.disabled = false; }, 5000);
  });
}

// ---------- 切换器 ----------

function renderSwitcher() {
  clear(switcherList);
  clear(switcherBroken);

  const rows = [{ id: null, name: state.defaultLabel, summary: '不启用任何工作台包', heavy: false }]
    .concat(state.packages);
  rows.forEach((row, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const selected = (state.current ? state.current.id : null) === row.id;
    button.appendChild(text('span', selected ? '✓' : '', 'tick'));
    const body = document.createElement('span');
    body.className = 'body';
    body.appendChild(text('span', row.name, 'title'));
    const subParts = [];
    if (row.summary) subParts.push(row.summary);
    if (row.heavy) subParts.push('重工作台 · 会建文件夹');
    if (row.source === 'builtin') subParts.push('随安装包自带');
    if (row.unknownFieldCount > 0) subParts.push(`${row.unknownFieldCount} 个本版本不认识的字段（已忽略）`);
    if (subParts.length) body.appendChild(text('span', subParts.join(' · '), 'sub'));
    button.appendChild(body);
    if (index >= 1 && index <= 9) button.appendChild(text('span', `⌘⇧${index}`, 'key'));
    button.addEventListener('click', () => {
      closeLayer(switcherLayer);
      void switchTo(row.id);
    });
    switcherList.appendChild(button);
  });

  for (const item of state.skipped) {
    switcherBroken.appendChild(text('div', `⚠ ${item.id}　未加载：${item.reason}`, 'broken'));
  }
}

function switchTo(workbenchId) {
  return api.switchTo(workbenchId).then((result) => {
    if (result && result.kind === 'error') showToast(result.text);
  }).catch((error) => {
    showToast(error && error.message ? String(error.message).slice(0, 240) : '切换失败');
  });
}

// ---------- onboarding：纯文本，按行两种样式 ----------

function renderOnboarding(current) {
  clear(onboardingBody);
  const raw = current && typeof current.onboarding === 'string' ? current.onboarding : '';
  for (const line of raw.split('\n')) {
    const value = line.replace(/\s+$/, '');
    if (!value.trim()) { onboardingBody.appendChild(text('div', '', 'ob-blank')); continue; }
    if (value.startsWith('#')) {
      onboardingBody.appendChild(text('div', value.replace(/^#+\s*/, ''), 'ob-h'));
    } else if (/^\s*-\s+/.test(value)) {
      onboardingBody.appendChild(text('div', value.replace(/^\s*-\s+/, ''), 'ob-li'));
    } else {
      onboardingBody.appendChild(text('div', value, 'ob-p'));
    }
  }
  openLayer(onboardingLayer);
}

// ---------- 确认卡 ----------

function askConfirm(title, lines, onOk) {
  confirmTitle.textContent = title;
  clear(confirmBody);
  for (const line of lines) confirmBody.appendChild(text('div', line, 'ob-p'));
  confirmHandler = onOk;
  openLayer(confirmLayer);
}

// ---------- 状态 ----------

function applyState(next) {
  if (!next || typeof next !== 'object') return;
  state = {
    current: next.current || null,
    packages: Array.isArray(next.packages) ? next.packages : [],
    skipped: Array.isArray(next.skipped) ? next.skipped : [],
    defaultLabel: next.defaultLabel || '默认工作台',
    busy: next.busy === true,
    cockpit: next.cockpit && typeof next.cockpit === 'object' ? next.cockpit : null
  };
  renderRail();
  renderCockpit();
  if (switcherLayer.classList.contains('open')) renderSwitcher();
  if (next.showOnboarding && state.current && state.current.onboarding) {
    renderOnboarding(state.current);
  }
  if (next.notice) showToast(next.notice);
}

// ---------- 接线 ----------

el('switcher-button').addEventListener('click', () => {
  renderSwitcher();
  openLayer(switcherLayer);
});
el('manage-workbenches').addEventListener('click', () => {
  closeLayer(switcherLayer);
  void api.openSettings();
});
el('open-workspace').addEventListener('click', () => { void api.openWorkspace(); });
el('open-settings').addEventListener('click', () => { void api.openSettings(); });
el('exit-cockpit').addEventListener('click', () => {
  void api.setCockpitView({ mode: 'native' });
});
el('enter-cockpit').addEventListener('click', () => {
  void api.setCockpitView({ mode: 'cockpit' });
});
toggleChat.addEventListener('click', () => {
  const chatOpen = Boolean(state.cockpit && state.cockpit.chatOpen);
  void api.setCockpitView(chatOpen ? { chatOpen: false } : { focusChat: true });
});

confirmOk.addEventListener('click', () => {
  const handler = confirmHandler;
  confirmHandler = null;
  closeLayer(confirmLayer);
  if (typeof handler === 'function') handler();
});

for (const node of document.querySelectorAll('[data-close]')) {
  node.addEventListener('click', () => {
    const which = node.dataset.close;
    if (which === 'switcher') closeLayer(switcherLayer);
    if (which === 'confirm') { confirmHandler = null; closeLayer(confirmLayer); }
    if (which === 'onboarding') {
      closeLayer(onboardingLayer);
      if (state.current) void api.markOnboardingSeen(state.current.id);
    }
  });
}

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey
      && event.key.toLowerCase() === 'k' && state.cockpit) {
    event.preventDefault();
    void api.setCockpitView({ focusChat: true });
    return;
  }
  if (event.key === 'Escape' && state.cockpit && state.cockpit.chatOpen === true) {
    event.preventDefault();
    void api.setCockpitView({ chatOpen: false });
    return;
  }
  if (event.key !== 'Escape') return;
  closeLayer(switcherLayer);
  if (confirmLayer.classList.contains('open')) { confirmHandler = null; closeLayer(confirmLayer); }
  if (onboardingLayer.classList.contains('open')) {
    closeLayer(onboardingLayer);
    if (state.current) void api.markOnboardingSeen(state.current.id);
  }
});

api.onState(applyState);
api.onVideoState(applyVideoState);
api.onNotice((value) => {
  if (!value) return;
  if (value.kind === 'drag') {
    dropBox.classList.toggle('open', value.dragging === true);
    return;
  }
  if (value.text) showToast(value.text);
});

api.getState().then(applyState).catch(() => {
  showToast('工作台状态读取失败，已退回默认工作台。');
});
api.getVideoState().then(applyVideoState).catch(() => {
  applyVideoState({
    status: 'error', text: '视频工作区读取失败；没有使用旧数据。',
    route: [], today: [], projects: [], ordinaryCount: 0, issues: [], proposal: null
  });
});
