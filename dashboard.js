'use strict';

// 看板只消费主进程已清洗快照，不从 DOM 接收数值用于副作用。
const api = window.whaleDashboard;
const byId = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const costFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
let selectedTaskKey = null;
let latestTasks = [];

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function boundedText(value, fallback, maximum = 80) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function tokenText(value) {
  const number = finite(value);
  return number == null ? '—' : numberFormat.format(Math.round(number));
}

function costText(value, allowed = true) {
  const number = finite(value);
  return !allowed || number == null ? '暂不可估算' : `¥ ${costFormat.format(number)} 估算`;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number != null) return number;
  }
  return null;
}

function statusValue(value, allowed, fallback) {
  const candidate = typeof value === 'string' ? value : value && value.status;
  return allowed.has(candidate) ? candidate : fallback;
}

function setAvailability(snapshot) {
  const raw = snapshot.availability;
  const state = statusValue(raw, new Set(['available', 'degraded', 'unavailable', 'loading']), 'unavailable');
  const labels = {
    available: '事件能力可用',
    degraded: '事件能力受限',
    unavailable: '事件能力不可用',
    loading: '正在读取'
  };
  const node = byId('availability');
  node.dataset.state = state;
  node.textContent = boundedText(raw && raw.label, labels[state], 48);
  const dot = byId('availability-dot');
  dot.className = state === 'available' ? 'dot good' : state === 'degraded' ? 'dot warn' : 'dot';
}

function setCoverage(snapshot) {
  const raw = snapshot.coverage;
  const state = statusValue(raw, new Set(['complete', 'partial', 'gap', 'unavailable', 'loading']), 'unavailable');
  const labels = {
    complete: '覆盖完整：可显示已观测 token 与估算费用。',
    partial: '覆盖有限：仅统计已观测样本。',
    gap: '存在覆盖缺口：费用将不显示伪精确总额。',
    unavailable: '尚无可用覆盖数据，主 Harness 体验不受影响。',
    loading: '等待 dsh 事件快照。'
  };
  const node = byId('coverage');
  node.dataset.state = state === 'partial' ? 'gap' : state;
  node.textContent = boundedText(raw && (raw.message || raw.label), labels[state], 180);
  return state === 'complete';
}

function totals(snapshot) {
  const today = snapshot.today && typeof snapshot.today === 'object' ? snapshot.today : {};
  const week = snapshot.week && typeof snapshot.week === 'object' ? snapshot.week : {};
  const usage = snapshot.usage && typeof snapshot.usage === 'object' ? snapshot.usage : {};
  return {
    todayTokens: firstNumber(today.tokens, snapshot.todayTokens, usage.todayTokens),
    weekTokens: firstNumber(week.tokens, snapshot.weekTokens, usage.weekTokens),
    todayCost: firstNumber(today.estimatedCost, snapshot.todayCost, usage.todayCost),
    topLevel: firstNumber(today.topLevelTokens, usage.topLevelTokens, snapshot.topLevelTokens),
    subagents: firstNumber(today.subagentTokens, usage.subagentTokens, snapshot.subagentTokens)
  };
}

function setTotals(snapshot, coverageComplete) {
  const value = totals(snapshot);
  byId('today-tokens').textContent = tokenText(value.todayTokens);
  byId('week-tokens').textContent = tokenText(value.weekTokens);
  const costAllowed = coverageComplete && snapshot.costAvailable !== false;
  byId('today-cost').textContent = costText(value.todayCost, costAllowed);
  byId('top-level-tokens').textContent = tokenText(value.topLevel);
  byId('subagent-tokens').textContent = tokenText(value.subagents);
}

function normalizedTasks(snapshot) {
  const source = Array.isArray(snapshot.recentTasks) ? snapshot.recentTasks
    : Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  return source.filter((task) => task && typeof task === 'object').slice(0, 12);
}

function taskTime(value) {
  if (typeof value !== 'string' || value.length > 64) return '时间未知';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
    : '时间未知';
}

function renderTasks(snapshot) {
  latestTasks = normalizedTasks(snapshot);
  if (!latestTasks.some((task) => task.taskKey === selectedTaskKey)) {
    selectedTaskKey = typeof latestTasks[0]?.taskKey === 'string' ? latestTasks[0].taskKey.slice(0, 128) : null;
  }
  const list = byId('recent-tasks');
  while (list.firstChild) list.removeChild(list.firstChild);
  byId('task-count').textContent = `${latestTasks.length} 条`;
  if (!latestTasks.length) {
    const empty = document.createElement('li');
    empty.className = 'task-empty';
    empty.textContent = '暂无可用任务摘要';
    list.appendChild(empty);
    return;
  }

  latestTasks.forEach((task, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const key = typeof task.taskKey === 'string' ? task.taskKey.slice(0, 128) : '';
    button.type = 'button';
    button.className = `task-button${key && key === selectedTaskKey ? ' selected' : ''}`;
    const copy = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = `匿名任务 ${String(index + 1).padStart(2, '0')}`;
    const meta = document.createElement('span');
    meta.className = 'task-meta';
    meta.textContent = `${taskTime(task.at || task.completedAt)} · ${tokenText(task.tokens)} tokens`;
    copy.appendChild(title);
    copy.appendChild(meta);
    const result = document.createElement('span');
    result.className = 'task-result';
    const resultLabels = { completed: '已完成', failed: '失败', waiting: '待人工', cancelled: '已取消' };
    result.textContent = resultLabels[task.result] || '已记录';
    button.appendChild(copy);
    button.appendChild(result);
    button.addEventListener('click', () => {
      if (!key) return;
      selectedTaskKey = key;
      renderTasks({ recentTasks: latestTasks });
    });
    item.appendChild(button);
    list.appendChild(item);
  });
}

function setBudget(snapshot) {
  const budget = snapshot.budget && typeof snapshot.budget === 'object' ? snapshot.budget : {};
  const enabled = budget.enabled === true;
  const used = firstNumber(budget.used, budget.todayTokens, totals(snapshot).todayTokens) || 0;
  const limit = firstNumber(budget.limit, budget.dailyTokenBudget);
  const paused = budget.paused === true || budget.state === 'paused';
  const resumed = budget.resumed === true || budget.state === 'resumed';
  const externalWarning = budget.enforcement === 'external-warning';
  const resumeAvailable = budget.resumeAvailable === true || paused;
  let label = '未开启';
  let detail = '只统计，不停止后端。';
  if (enabled && limit != null) {
    label = externalWarning ? '已达预算，外部服务仍在运行'
      : paused ? '已达预算，今日已暂停'
      : resumed ? '已确认今日继续'
        : used >= limit ? '已达今日预算' : '预算监测中';
    detail = externalWarning
      ? `${tokenText(used)} / ${tokenText(limit)} tokens · 鲸坞不会停止外部服务`
      : `${tokenText(used)} / ${tokenText(limit)} tokens`;
  }
  byId('budget-state').textContent = label;
  byId('budget-detail').textContent = detail;
  const percent = enabled && limit != null ? (limit === 0 ? (used > 0 ? 100 : 0) : Math.min(100, used / limit * 100)) : 0;
  byId('budget-progress').value = Math.round(percent);
  byId('budget-percent').textContent = `${Math.round(percent)}%`;
  byId('resume-budget').textContent = externalWarning
    ? '允许今日后续托管启动' : '今日继续运行';
  byId('resume-budget').hidden = !resumeAvailable;
}

function render(snapshot) {
  const safe = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  setAvailability(safe);
  const coverageComplete = setCoverage(safe);
  setTotals(safe, coverageComplete);
  renderTasks(safe);
  setBudget(safe);
}

function setAction(message) {
  byId('action-status').textContent = boundedText(message, '', 120);
}

async function exportReport(action) {
  if (!api || typeof api.export !== 'function') return setAction('战报桥接不可用。');
  if (!selectedTaskKey) return setAction('请先选择一条匿名任务。');
  const theme = byId('report-theme').value === 'light' ? 'light' : 'dark';
  setAction(action === 'copy' ? '正在生成并复制…' : '正在生成战报…');
  try {
    const result = await api.export({ taskKey: selectedTaskKey, theme, action });
    setAction(boundedText(result && result.message, action === 'copy' ? '已复制战报图片。' : '战报图片已保存。', 120));
  } catch (error) {
    setAction(boundedText(error && error.message, '战报生成失败，请重试。', 120));
  }
}

byId('copy-report').addEventListener('click', () => exportReport('copy'));
byId('export-report').addEventListener('click', () => exportReport('save'));
byId('show-main').addEventListener('click', () => api && api.showMain());
byId('resume-budget').addEventListener('click', async () => {
  setAction('正在请求今日继续运行…');
  try {
    await api.resume();
    setAction('已提交，主进程将重新核验预算与后端身份。');
  } catch (error) {
    setAction(boundedText(error && error.message, '今日继续请求失败。', 120));
  }
});

if (!api || typeof api.get !== 'function' || typeof api.onChanged !== 'function') {
  render({ availability: 'unavailable', coverage: 'unavailable' });
} else {
  api.get().then(render).catch(() => render({ availability: 'unavailable', coverage: 'unavailable' }));
  const unsubscribe = api.onChanged(render);
  window.addEventListener('beforeunload', () => unsubscribe(), { once: true });
}
