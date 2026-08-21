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
const sceneCurrent = el('scene-current');

let state = {
  current: null, packages: [], skipped: [], defaultLabel: '默认工作台', busy: false,
  cockpit: null
};
let confirmHandler = null;
let toastTimer = null;
let activeScene = 'today';

const ROUTE = Object.freeze([
  { id: 'inbox', label: '灵感' },
  { id: 'topic', label: '选题' },
  { id: 'script', label: '写稿' },
  { id: 'shoot', label: '拍摄' },
  { id: 'edit', label: '剪辑', deferred: true },
  { id: 'publish', label: '发布' },
  { id: 'data', label: '数据', unavailable: true },
  { id: 'review', label: '复盘', deferred: true }
]);

const SCENES = Object.freeze({
  today: { kicker: 'TODAY · 今天', heading: '今天，推进一件事', summary: '现场跟着文件走；没有证据的位置保持留白。', current: '今天' },
  inbox: { kicker: 'INBOX · 灵感', heading: '把一坨东西丢进来', summary: '先接住，再拆条；链接只作为文字保存，不会自动访问。', current: '灵感收件箱' },
  topic: { kicker: 'TOPIC · 选题', heading: '立项就是做选择题', summary: '角度和钩子由你拍板，鲸坞不替你决定。', current: '选题现场' },
  script: { kicker: 'SCRIPT · 脚本', heading: '一次只改一块', summary: '建议先进入对照卡；你点采用后才写回原稿。', current: '脚本现场' },
  shoot: { kicker: 'SHOOT · 拍摄', heading: 'AI 最安静的现场', summary: '提词、打勾、记重来；拍没拍过只由你确认。', current: '拍摄现场' },
  edit: { kicker: 'EDIT · 剪辑', heading: '工单先留在航道上', summary: '一期不碰剪辑时间线，现场暂未接通。', current: '剪辑工单' },
  publish: { kicker: 'PUBLISH · 发布', heading: '过灯，再由你亲手发布', summary: '鲸坞只做检查，不会替你点击平台发布。', current: '发布现场' },
  data: { kicker: 'DATA · 数据', heading: '侦察中，未接通', summary: '没有平台数据通道时，不展示播放、漏斗或雷达数字。', current: '数据舱门' },
  review: { kicker: 'REVIEW · 复盘', heading: '复盘要有去向', summary: '二期接通数据后再把结论固化进打法库。', current: '复盘现场' }
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
  for (const stage of ROUTE) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-step';
    if (stage.id === activeScene) button.classList.add('active');
    if (stage.deferred || stage.unavailable) button.classList.add('blocked');
    button.textContent = stage.label;
    button.title = stage.unavailable ? '侦察中，未接通'
      : (stage.deferred ? '后续批次接通' : `进入${stage.label}现场`);
    button.addEventListener('click', () => {
      activeScene = stage.id;
      renderRoute();
      renderSceneHeading();
    });
    routeStages.appendChild(button);
  }
}

function renderSceneHeading() {
  const scene = SCENES[activeScene] || SCENES.today;
  sceneKicker.textContent = scene.kicker;
  sceneHeading.textContent = scene.heading;
  sceneSummary.textContent = scene.summary;
  sceneCurrent.textContent = scene.current;
}

function renderCockpit() {
  const cockpit = state.cockpit && typeof state.cockpit === 'object' ? state.cockpit : null;
  const available = Boolean(cockpit && cockpit.kind === 'video');
  const active = Boolean(available && cockpit.mode === 'cockpit');
  document.body.classList.toggle('cockpit-available', available);
  document.body.classList.toggle('cockpit-active', active);
  document.body.classList.toggle('chat-collapsed', active && cockpit.chatCollapsed === true);
  cockpitName.textContent = state.current ? state.current.name : '短视频创作台';
  toggleChat.textContent = cockpit && cockpit.chatCollapsed ? '展开' : '折叠';
  renderTaskFlow(cockpit && cockpit.taskFlow);
  renderRoute();
  renderSceneHeading();
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
el('scene-workspace').addEventListener('click', () => { void api.openWorkspace(); });
el('scene-primary').addEventListener('click', () => {
  activeScene = 'today';
  renderRoute();
  renderSceneHeading();
});
el('exit-cockpit').addEventListener('click', () => {
  void api.setCockpitView({ mode: 'native' });
});
el('enter-cockpit').addEventListener('click', () => {
  void api.setCockpitView({ mode: 'cockpit' });
});
toggleChat.addEventListener('click', () => {
  const collapsed = Boolean(state.cockpit && state.cockpit.chatCollapsed);
  void api.setCockpitView({ chatCollapsed: !collapsed });
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
  if (event.key !== 'Escape') return;
  closeLayer(switcherLayer);
  if (confirmLayer.classList.contains('open')) { confirmHandler = null; closeLayer(confirmLayer); }
  if (onboardingLayer.classList.contains('open')) {
    closeLayer(onboardingLayer);
    if (state.current) void api.markOnboardingSeen(state.current.id);
  }
});

api.onState(applyState);
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
