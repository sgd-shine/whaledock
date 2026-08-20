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

let state = { current: null, packages: [], skipped: [], defaultLabel: '默认工作台' };
let confirmHandler = null;
let toastTimer = null;

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
  railName.textContent = current ? current.name : state.defaultLabel;

  clear(actionsBox);
  const actions = current && Array.isArray(current.actions) ? current.actions : [];
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    if (action.hint) button.title = action.hint;
    button.dataset.actionId = action.id;
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
      actionNote.textContent = `已发出「${action.label}」，去右边的会话里看结果。`;
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
    defaultLabel: next.defaultLabel || '默认工作台'
  };
  renderRail();
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
