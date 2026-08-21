'use strict';

const api = window.whaleShooting;
const SPEEDS = Object.freeze([0.6, 0.8, 1, 1.2, 1.5]);
const FONT_SIZES = new Set(['small', 'medium', 'large']);
const MODES = new Set(['checklist', 'teleprompter']);
const PHASES = new Set(['loading', 'ready', 'preview', 'finishing', 'finished', 'error']);
const MAX_SHOTS = 200;
const MAX_TEXT = 64 * 1024;
const RING_CIRCUMFERENCE = 326.726;
const BASE_SCROLL_PIXELS_PER_SECOND = 42;

const byId = (id) => document.getElementById(id);
const elements = Object.freeze({
  studio: byId('studio'),
  title: byId('shooting-title'),
  sessionStatus: byId('session-status'),
  checklistView: byId('checklist-view'),
  teleprompterView: byId('teleprompter-view'),
  modeChecklist: byId('mode-checklist'),
  modeTeleprompter: byId('mode-teleprompter'),
  progressRing: byId('progress-ring'),
  progressValue: byId('progress-value'),
  progressPercent: byId('progress-percent'),
  progressCount: byId('progress-count'),
  sourceLabel: byId('source-label'),
  shotList: byId('shot-list'),
  emptyState: byId('empty-state'),
  emptyTitle: byId('empty-title'),
  emptyDetail: byId('empty-detail'),
  promptShotLabel: byId('prompt-shot-label'),
  promptDuration: byId('prompt-duration'),
  promptRetakes: byId('prompt-retakes'),
  promptScroll: byId('prompt-scroll'),
  promptCopy: byId('prompt-copy'),
  promptProgress: byId('prompt-progress'),
  promptState: byId('prompt-state'),
  teleprompterSettings: byId('teleprompter-settings'),
  keyboardHelp: byId('keyboard-help'),
  speedChoices: byId('speed-choices'),
  fontChoices: byId('font-choices'),
  retryShot: byId('retry-shot'),
  togglePlayback: byId('toggle-playback'),
  playSymbol: byId('play-symbol'),
  playLabel: byId('play-label'),
  finish: byId('finish-shooting'),
  finishPreview: byId('finish-preview'),
  finishSummary: byId('finish-summary'),
  toast: byId('toast'),
  announcer: byId('announcer')
});

let current = normalizeState(null);
let commandBusy = false;
let pushedStateVersion = 0;
let unsubscribe = () => {};
let animationFrame = 0;
let previousFrameTime = 0;
let scrollShotId = null;
let pauseAtEndSent = false;
let endedShotId = null;
let toastTimer = 0;

function cleanLine(value, fallback, maximum = 160) {
  if (typeof value !== 'string') return fallback;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function cleanBody(value) {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_TEXT)
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim();
}

function validShotId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function normalizeShot(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validShotId(value.id)) {
    return null;
  }
  const retakes = Number.isInteger(value.retakes)
    ? Math.min(99, Math.max(0, value.retakes)) : 0;
  return Object.freeze({
    id: value.id,
    label: cleanLine(value.label, `镜头 ${index + 1}`, 80),
    text: cleanBody(value.text),
    durationLabel: cleanLine(value.durationLabel, '', 40),
    completed: value.completed === true,
    retakes,
    gapReason: cleanLine(value.gapReason, '', 160) || null
  });
}

function normalizeState(value) {
  const safe = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const shots = (Array.isArray(safe.shots) ? safe.shots : [])
    .slice(0, MAX_SHOTS)
    .map(normalizeShot)
    .filter(Boolean);
  const mode = MODES.has(safe.mode) ? safe.mode : 'checklist';
  const phase = PHASES.has(safe.phase) ? safe.phase : 'loading';
  const speed = SPEEDS.includes(Number(safe.speed)) ? Number(safe.speed) : 1;
  const fontSize = FONT_SIZES.has(safe.fontSize) ? safe.fontSize : 'medium';
  const requestedShot = validShotId(safe.currentShotId) ? safe.currentShotId : null;
  const currentShotId = shots.some((shot) => shot.id === requestedShot)
    ? requestedShot : (shots[0] ? shots[0].id : null);
  const rawSummary = safe.finishSummary && typeof safe.finishSummary === 'object'
    && !Array.isArray(safe.finishSummary) ? safe.finishSummary : null;
  const boundedCount = (value) => (Number.isSafeInteger(value) && value >= 0 && value <= MAX_SHOTS
    ? value : 0);
  const finishSummary = rawSummary ? Object.freeze({
    total: boundedCount(rawSummary.total),
    confirmed: boundedCount(rawSummary.confirmed),
    missing: boundedCount(rawSummary.missing),
    retakes: Number.isSafeInteger(rawSummary.retakes) && rawSummary.retakes >= 0
      ? Math.min(9999, rawSummary.retakes) : 0,
    gapsProvided: boundedCount(rawSummary.gapsProvided)
  }) : null;
  return Object.freeze({
    phase,
    mode,
    title: cleanLine(safe.title, phase === 'loading' ? '正在准备拍摄现场' : '未命名拍摄', 120),
    sourceLabel: cleanLine(safe.sourceLabel, shots.length ? '本地口播稿' : '等待口播稿。', 180),
    notice: cleanLine(safe.notice, '', 240),
    shots,
    currentShotId,
    playing: safe.playing === true && phase === 'ready' && Boolean(currentShotId),
    speed,
    fontSize,
    canFinish: safe.canFinish === true && shots.length > 0 && ['ready', 'preview'].includes(phase),
    finishSummary
  });
}

function setText(element, value) {
  element.textContent = typeof value === 'string' ? value : '';
}

function currentShot() {
  return current.shots.find((shot) => shot.id === current.currentShotId) || null;
}

function renderPromptText(value) {
  elements.promptCopy.replaceChildren();
  const paragraphs = String(value || '').split(/\n\s*\n/);
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) elements.promptCopy.appendChild(textNode('· 停顿 ·', 'prompt-pause'));
    elements.promptCopy.appendChild(textNode(paragraph.trim(), 'prompt-paragraph'));
  });
}

function textNode(value, className) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = value;
  return node;
}

function syncPromptProgress() {
  const maximum = Math.max(1, elements.promptScroll.scrollHeight - elements.promptScroll.clientHeight);
  elements.promptProgress.value = Math.min(1, Math.max(0, elements.promptScroll.scrollTop / maximum));
}

function phaseLabel(phase) {
  const labels = {
    loading: '载入中',
    ready: '纯本地 · 已就绪',
    preview: '等你确认收工摘要',
    finishing: '正在写回',
    finished: '本次已收工',
    error: '需要处理'
  };
  return labels[phase] || '载入中';
}

function shotPreview(text) {
  return cleanLine(text, '这镜还没有正文', 96);
}

function createShotItem(shot, index) {
  const item = document.createElement('li');
  item.className = 'shot-item';
  item.classList.toggle('current', shot.id === current.currentShotId);
  item.classList.toggle('complete', shot.completed);

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'shot-main';
  main.dataset.shotAction = 'select';
  main.dataset.shotId = shot.id;
  main.setAttribute('aria-label', `选择${shot.label}`);

  const number = document.createElement('span');
  number.className = 'shot-number';
  number.textContent = String(index + 1).padStart(2, '0');

  const body = document.createElement('span');
  body.className = 'shot-body';
  const label = document.createElement('span');
  label.className = 'shot-label';
  label.textContent = shot.label;
  const preview = document.createElement('span');
  preview.className = 'shot-preview';
  preview.textContent = shotPreview(shot.text);
  body.append(label, preview);

  const facts = document.createElement('span');
  facts.className = 'shot-facts';
  if (shot.durationLabel) {
    const duration = document.createElement('span');
    duration.textContent = shot.durationLabel;
    facts.append(duration);
  }
  if (shot.retakes > 0) {
    const retake = document.createElement('span');
    retake.className = 'retake-badge';
    retake.textContent = `重来 ${shot.retakes}`;
    facts.append(retake);
  }
  main.append(number, body, facts);

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'shot-check';
  check.dataset.shotAction = 'complete';
  check.dataset.shotId = shot.id;
  check.setAttribute('aria-pressed', String(shot.completed));
  check.setAttribute('aria-label', `${shot.label}：${shot.completed ? '取消完成' : '标记拍完'}`);
  check.textContent = '✓';

  item.append(main, check);
  if (!shot.completed) {
    const gap = document.createElement('div');
    gap.className = 'shot-gap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'shot-gap-input';
    input.maxLength = 160;
    input.placeholder = '若这镜没拍，写下素材缺口（可留空）';
    input.value = shot.gapReason || '';
    input.setAttribute('aria-label', `${shot.label}的素材缺口原因`);
    const save = document.createElement('button');
    save.type = 'button';
    save.dataset.shotAction = 'save-gap';
    save.dataset.shotId = shot.id;
    save.textContent = '记下';
    gap.append(input, save);
    item.append(gap);
  }
  return item;
}

function renderChecklist() {
  const completed = current.shots.filter((shot) => shot.completed).length;
  const total = current.shots.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const offset = RING_CIRCUMFERENCE * (1 - (percent / 100));
  elements.progressValue.setAttribute('stroke-dashoffset', offset.toFixed(3));
  elements.progressRing.setAttribute('aria-label', `拍摄进度 ${percent}%`);
  setText(elements.progressPercent, `${percent}%`);
  setText(elements.progressCount, `${completed} / ${total} 镜`);
  setText(elements.sourceLabel, current.sourceLabel);

  elements.shotList.replaceChildren();
  current.shots.forEach((shot, index) => elements.shotList.append(createShotItem(shot, index)));
  const empty = total === 0;
  elements.emptyState.hidden = !empty;
  elements.shotList.hidden = empty;
  if (empty) {
    setText(elements.emptyTitle, current.phase === 'error' ? '没能打开这份口播稿' : '还没有可拍的镜头');
    setText(elements.emptyDetail, current.notice || '从驾驶舱选择一份口播稿，再进入拍摄现场。');
  }
}

function renderTeleprompter() {
  const shot = currentShot();
  const shotChanged = shot && shot.id !== scrollShotId;
  if (shotChanged) {
    scrollShotId = shot.id;
    endedShotId = null;
    elements.promptScroll.scrollTop = 0;
    pauseAtEndSent = false;
  }
  if (!shot) {
    scrollShotId = null;
    setText(elements.promptShotLabel, '当前没有镜头');
    setText(elements.promptDuration, '');
    setText(elements.promptRetakes, '');
    elements.promptRetakes.hidden = true;
    renderPromptText('先在清单里选择一个镜头。');
  } else {
    const index = current.shots.findIndex((item) => item.id === shot.id);
    setText(elements.promptShotLabel, `${String(index + 1).padStart(2, '0')} · ${shot.label}`);
    setText(elements.promptDuration, shot.durationLabel);
    setText(elements.promptRetakes, shot.retakes ? `已重来 ${shot.retakes} 次` : '');
    elements.promptRetakes.hidden = shot.retakes === 0;
    renderPromptText(shot.text || '这镜还没有提词正文。');
  }
  setText(elements.promptState, shot && shot.completed ? '已确认拍完'
    : (shot && endedShotId === shot.id ? '已念完 · 待你确认拍完'
      : (current.playing ? `正在滚动 · ${current.speed.toFixed(1)}×` : '已暂停')));
  setText(elements.playSymbol, current.playing ? 'Ⅱ' : '▶');
  setText(elements.playLabel, current.playing ? '暂停提词' : '开始提词');
  elements.togglePlayback.disabled = commandBusy || !shot;
  elements.retryShot.disabled = commandBusy || !shot;

  for (const button of elements.speedChoices.querySelectorAll('[data-speed]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === current.speed));
    button.disabled = commandBusy || !shot;
  }
  for (const button of elements.fontChoices.querySelectorAll('[data-font-size]')) {
    button.setAttribute('aria-pressed', String(button.dataset.fontSize === current.fontSize));
    button.disabled = commandBusy || !shot;
  }
  syncPromptProgress();
}

function syncAutoScroll() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
  previousFrameTime = 0;
  if (current.mode !== 'teleprompter' || !current.playing || document.hidden || !currentShot()) return;
  animationFrame = requestAnimationFrame(stepAutoScroll);
}

function stepAutoScroll(timestamp) {
  animationFrame = 0;
  if (current.mode !== 'teleprompter' || !current.playing || document.hidden || !currentShot()) return;
  if (!previousFrameTime) previousFrameTime = timestamp;
  const elapsed = Math.min(48, Math.max(0, timestamp - previousFrameTime));
  previousFrameTime = timestamp;
  elements.promptScroll.scrollTop += (elapsed / 1000) * BASE_SCROLL_PIXELS_PER_SECOND * current.speed;
  syncPromptProgress();

  const atEnd = elements.promptScroll.scrollTop + elements.promptScroll.clientHeight
    >= elements.promptScroll.scrollHeight - 2;
  if (atEnd) {
    if (!pauseAtEndSent) {
      pauseAtEndSent = true;
      endedShotId = current.currentShotId;
      void sendCommand({ type: 'set-playing', value: false }, '本镜已念完，等待你确认拍完。');
    }
    return;
  }
  animationFrame = requestAnimationFrame(stepAutoScroll);
}

function render(value) {
  const previousPlaying = current.playing;
  current = normalizeState(value);
  elements.studio.dataset.mode = current.mode;
  elements.studio.dataset.playing = String(current.playing);
  elements.studio.dataset.font = current.fontSize;
  elements.studio.dataset.phase = current.phase;
  setText(elements.title, current.title);
  setText(elements.sessionStatus, phaseLabel(current.phase));

  const checklist = current.mode === 'checklist';
  elements.checklistView.hidden = !checklist;
  elements.teleprompterView.hidden = checklist;
  elements.modeChecklist.setAttribute('aria-pressed', String(checklist));
  elements.modeTeleprompter.setAttribute('aria-pressed', String(!checklist));
  elements.teleprompterSettings.hidden = checklist;
  elements.keyboardHelp.hidden = checklist;
  elements.retryShot.hidden = checklist;
  elements.togglePlayback.hidden = checklist;
  elements.finish.disabled = commandBusy || !current.canFinish;
  setText(elements.finish, current.phase === 'finishing' ? '正在写回…'
    : (current.phase === 'finished' ? '已收工'
      : (current.phase === 'preview' ? '确认收工并写回' : '收工并核对')));
  const preview = current.phase === 'preview' && current.finishSummary;
  elements.finishPreview.hidden = !preview;
  if (preview) {
    const value = current.finishSummary;
    setText(elements.finishSummary,
      `已确认 ${value.confirmed}/${value.total} 镜；未确认 ${value.missing} 镜；`
      + `重来 ${value.retakes} 次；已填写 ${value.gapsProvided} 条素材缺口。`);
  }

  renderChecklist();
  renderTeleprompter();
  if (!current.playing && previousPlaying) pauseAtEndSent = false;
  syncAutoScroll();
}

function showToast(message) {
  const text = cleanLine(message, '操作没有完成，请再试一次。', 240);
  setText(elements.toast, text);
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 5200);
}

function announce(message) {
  setText(elements.announcer, cleanLine(message, '', 180));
}

function stateFromResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.state && typeof result.state === 'object') return result.state;
  if (Array.isArray(result.shots) || typeof result.phase === 'string') return result;
  return null;
}

async function perform(operation, successMessage = '') {
  if (commandBusy) return;
  commandBusy = true;
  render(current);
  try {
    const result = await operation();
    if (result && result.ok === false) throw new Error(cleanLine(result.message, '操作没有完成。', 240));
    const next = stateFromResult(result);
    if (next) render(next);
    if (result && result.message) announce(result.message);
    else if (successMessage) announce(successMessage);
  } catch (error) {
    showToast(error && error.message ? error.message : '操作没有完成。');
  } finally {
    commandBusy = false;
    render(current);
  }
}

function sendCommand(command, successMessage = '') {
  if (!api || typeof api.command !== 'function') {
    showToast('拍摄窗口尚未接通。');
    return Promise.resolve();
  }
  return perform(() => api.command(command), successMessage);
}

function interactiveTarget(target) {
  return target instanceof Element
    && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
}

elements.modeChecklist.addEventListener('click', () => {
  if (current.mode !== 'checklist') void sendCommand({ type: 'set-mode', value: 'checklist' });
});

elements.modeTeleprompter.addEventListener('click', () => {
  if (current.mode !== 'teleprompter') void sendCommand({ type: 'set-mode', value: 'teleprompter' });
});

elements.shotList.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-shot-action]') : null;
  if (!button || !elements.shotList.contains(button)) return;
  const shot = current.shots.find((item) => item.id === button.dataset.shotId);
  if (!shot) return;
  if (button.dataset.shotAction === 'select') {
    void sendCommand({ type: 'select-shot', shotId: shot.id }, `已选择${shot.label}`);
  } else if (button.dataset.shotAction === 'complete') {
    void sendCommand({ type: 'set-shot-complete', shotId: shot.id, value: !shot.completed },
      shot.completed ? `${shot.label}已取消完成` : `${shot.label}已标记拍完`);
  } else if (button.dataset.shotAction === 'save-gap') {
    const input = button.closest('.shot-gap') && button.closest('.shot-gap').querySelector('.shot-gap-input');
    const value = input instanceof HTMLInputElement ? input.value : '';
    void sendCommand({ type: 'set-gap', shotId: shot.id, value },
      value.trim() ? `${shot.label}的素材缺口已记下` : `${shot.label}的素材缺口已清空`);
  }
});

elements.shotList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)
      || !event.target.classList.contains('shot-gap-input')) return;
  event.preventDefault();
  const gap = event.target.closest('.shot-gap');
  const save = gap && gap.querySelector('button[data-shot-action="save-gap"]');
  if (save instanceof HTMLButtonElement) save.click();
});

elements.speedChoices.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-speed]') : null;
  if (!button || !elements.speedChoices.contains(button)) return;
  const speed = Number(button.dataset.speed);
  if (SPEEDS.includes(speed) && speed !== current.speed) {
    void sendCommand({ type: 'set-speed', value: speed }, `提词速度 ${speed.toFixed(1)} 倍`);
  }
});

elements.fontChoices.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-font-size]') : null;
  if (!button || !elements.fontChoices.contains(button)) return;
  const fontSize = button.dataset.fontSize;
  if (FONT_SIZES.has(fontSize) && fontSize !== current.fontSize) {
    void sendCommand({ type: 'set-font-size', value: fontSize });
  }
});

elements.togglePlayback.addEventListener('click', () => {
  const shot = currentShot();
  if (shot) void sendCommand({ type: 'set-playing', value: !current.playing });
});

elements.retryShot.addEventListener('click', () => {
  const shot = currentShot();
  if (shot) void sendCommand({ type: 'retry-shot', shotId: shot.id }, `${shot.label}标记重来`);
});

elements.finish.addEventListener('click', () => {
  if (!current.canFinish || !api || typeof api.finish !== 'function') return;
  void perform(() => api.finish());
});

document.addEventListener('keydown', (event) => {
  if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
      || current.mode !== 'teleprompter' || interactiveTarget(event.target)) return;
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault();
    const shot = currentShot();
    if (shot) void sendCommand({ type: 'set-playing', value: !current.playing });
    return;
  }
  if (typeof event.key === 'string' && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    const shot = currentShot();
    if (shot) void sendCommand({ type: 'retry-shot', shotId: shot.id }, `${shot.label}标记重来`);
  }
});

document.addEventListener('visibilitychange', syncAutoScroll);
elements.promptScroll.addEventListener('scroll', syncPromptProgress, { passive: true });

if (api && typeof api.onState === 'function') {
  unsubscribe = api.onState((value) => {
    pushedStateVersion += 1;
    render(value);
  });
}

window.addEventListener('beforeunload', () => {
  unsubscribe();
  if (animationFrame) cancelAnimationFrame(animationFrame);
  clearTimeout(toastTimer);
}, { once: true });

const stateVersionAtRequest = pushedStateVersion;
if (api && typeof api.getState === 'function') {
  void api.getState().then((value) => {
    if (pushedStateVersion === stateVersionAtRequest) render(value);
  }).catch((error) => {
    render({ phase: 'error', notice: error && error.message ? error.message : '无法读取拍摄状态。' });
    showToast(error && error.message ? error.message : '无法读取拍摄状态。');
  });
} else {
  render({ phase: 'error', notice: '拍摄窗口尚未接通。' });
}
