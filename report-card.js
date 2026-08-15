'use strict';

const api = window.whaleReport;
const byId = (id) => document.getElementById(id);
const THEMES = new Set(['dark', 'light']);
const RESULTS = new Set(['completed', 'failed', 'waiting', 'cancelled']);
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const costFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
let renderSequence = 0;

function cleanText(value, fallback, maximum) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function tokens(value) {
  const number = finite(value);
  return number == null ? '—' : numberFormat.format(Math.round(number));
}

function duration(value) {
  const milliseconds = finite(value);
  if (milliseconds == null) return '—';
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} 时 ${minutes} 分`;
  if (minutes) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function dateText(value) {
  if (typeof value !== 'string' || value.length > 64) return '时间未记录';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
    : '时间未记录';
}

function resultCopy(value) {
  const result = RESULTS.has(value) ? value : 'completed';
  return {
    completed: { symbol: '✓', label: 'AI 任务完成' },
    failed: { symbol: '×', label: 'AI 任务未完成' },
    waiting: { symbol: '!', label: '任务等待人工' },
    cancelled: { symbol: '—', label: '任务已取消' }
  }[result];
}

function coverageCopy(value) {
  const status = typeof value === 'string' ? value : value && value.status;
  const labels = {
    complete: '已观测数据 · 覆盖完整',
    partial: '已观测数据 · 覆盖有限',
    gap: '已观测数据 · 存在覆盖缺口',
    unavailable: '已观测数据 · 覆盖不可用'
  };
  return { status, label: labels[status] || '已观测数据 · 覆盖状态未知' };
}

function costText(value, allowed) {
  const number = finite(value);
  return allowed && number != null ? `¥ ${costFormat.format(number)}` : '暂不可估算';
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function acknowledge(sequence, theme) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await nextFrame();
  await nextFrame();
  if (sequence === renderSequence && api && typeof api.ready === 'function') {
    api.ready({ ok: true, theme });
  }
}

function render(payload) {
  const safe = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const theme = THEMES.has(safe.theme) ? safe.theme : 'dark';
  document.documentElement.dataset.theme = theme;

  const result = resultCopy(safe.result);
  byId('report-symbol').textContent = result.symbol;
  byId('report-status').textContent = result.label;
  byId('report-task').textContent = cleanText(safe.taskLabel, '匿名任务已经靠岸。', 86);

  const coverage = coverageCopy(safe.coverage);
  byId('report-coverage').textContent = cleanText(safe.coverageLabel, coverage.label, 90);
  byId('report-duration').textContent = duration(safe.durationMs);
  byId('report-total').textContent = tokens(safe.totalTokens);
  byId('report-input').textContent = tokens(safe.inputTokens);
  byId('report-cache').textContent = tokens(safe.cacheReadTokens);
  byId('report-output').textContent = tokens(safe.outputTokens);
  byId('report-cost').textContent = costText(safe.estimatedCost, coverage.status === 'complete' && safe.costAvailable !== false);
  byId('report-model').textContent = cleanText(safe.priceModel, 'deepseek-v4-flash', 36);
  byId('report-time').textContent = dateText(safe.completedAt);
  byId('report-version').textContent = cleanText(safe.appVersion, '鲸坞 WhaleDock', 38);

  renderSequence += 1;
  acknowledge(renderSequence, theme).catch(() => {
    if (api && typeof api.ready === 'function') api.ready({ ok: false, theme });
  });
}

if (api && typeof api.render === 'function') {
  const unsubscribe = api.render(render);
  window.addEventListener('beforeunload', () => unsubscribe(), { once: true });
}
