'use strict';

const api = window.whaleNotice;
const byId = (id) => document.getElementById(id);
const KINDS = new Set(['completed', 'waiting', 'failed']);
const COPY = {
  completed: { symbol: '✓', title: '一个任务已完成', detail: '鲸坞已记录该任务的匿名摘要。' },
  waiting: { symbol: '!', title: '有任务等待你确认', detail: '打开主窗口继续处理。' },
  failed: { symbol: '×', title: '一个任务未完成', detail: '打开鲸坞查看当前状态。' }
};

function cleanText(value, fallback, maximum) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function showNotice(payload) {
  const safe = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const kind = KINDS.has(safe.kind) ? safe.kind : 'completed';
  const copy = COPY[kind];
  document.body.dataset.kind = kind;
  byId('notice-symbol').textContent = copy.symbol;
  byId('notice-title').textContent = cleanText(safe.title, copy.title, 48);
  byId('notice-detail').textContent = cleanText(safe.detail, copy.detail, 100);
  // 不显示会话 ID、正文或工具内容，仅接受已匿名标签。
  byId('notice-task').textContent = cleanText(safe.anonymousLabel, '匿名任务', 32);
}

byId('notice-activate').addEventListener('click', () => {
  if (api && typeof api.activate === 'function') api.activate();
});
byId('notice-dismiss').addEventListener('click', () => {
  if (api && typeof api.dismiss === 'function') api.dismiss();
});

if (api && typeof api.show === 'function') {
  const unsubscribe = api.show(showNotice);
  window.addEventListener('beforeunload', () => unsubscribe(), { once: true });
}
