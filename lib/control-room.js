'use strict';

// v0.11 控制室：把 dsh 会话列表快照镜像成「每个项目现在在干什么、哪里等我」。
//
// 这是标杆 dsh-worktable「控制室」的纯函数内核：零轮询、零 Token，输入只有两样——
// dsh client runtime 的 sessions.list 快照（rc.2 形状：byId / subagentsByParent /
// jobsBySession）与项目→会话绑定；输出是每张项目卡的状态。
//
// 状态优先级与原生 UI 一致：待你决定(need) > 已完成(done) > 工作中(busy) > 空闲(idle)。
// 等待判断时 pendingInteraction 与 running 同时为真，必须判 need。
// 子代理聚合：待决常挂在子代理会话上，父会话只有 running；沿 parentId 与
// subagentsByParent 两条通道向下收集后代。
// ack 生命周期：点开项目 = 确认本轮 need/done，光效熄灭但事实状态不变；
// need 真↔假发生转移时自动清除旧 ack，新一轮问题重新点亮。
//
// 保持纯 Node、纯函数：不 require Electron，不做 IO，不修改输入。
const crypto = require('crypto');

const STATUSES = Object.freeze(['need', 'done', 'busy', 'idle']);
const STATUS_LABELS = Object.freeze({
  need: '待你决定',
  done: '已完成',
  busy: '工作中',
  idle: '空闲'
});
const LIMITS = Object.freeze({
  maxSessions: 512,
  maxKidsPerParent: 64,
  maxKidsDepth: 4,
  maxJobsPerSession: 64,
  maxTitleChars: 120
});

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeTitle(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned.length > LIMITS.maxTitleChars ? `${cleaned.slice(0, LIMITS.maxTitleChars - 1)}…` : cleaned;
}

function safeKind(value) {
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  return cleaned || 'unknown';
}

const EMPTY_SNAPSHOT = deepFreeze({ byId: {}, subagentsByParent: {}, jobsBySession: {}, current: null });

// 只保留控制室需要的字段；路径、投影值、原始错误一律不进镜像。
function sanitizeEntry(id, raw) {
  if (!plainRecord(raw)) return null;
  const pending = raw.pending === true
    || (raw.pendingInteraction !== undefined && raw.pendingInteraction !== null);
  return {
    id,
    running: raw.running === true,
    completed: raw.completed === true,
    pending,
    pendingKind: pending ? safeKind(raw.pendingKind ?? raw.pendingInteraction) : null,
    parentId: safeId(raw.parentId) ? raw.parentId : null,
    origin: typeof raw.origin === 'string' && raw.origin.length <= 32 ? raw.origin : null,
    displayTitle: safeTitle(raw.displayTitle || raw.title),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  };
}

function childIdsOf(rawCatalog) {
  let rows = [];
  if (Array.isArray(rawCatalog)) rows = rawCatalog;
  else if (plainRecord(rawCatalog)) {
    if (Array.isArray(rawCatalog.entries)) rows = rawCatalog.entries;
    else if (Array.isArray(rawCatalog.items)) rows = rawCatalog.items;
    else if (Array.isArray(rawCatalog.children)) rows = rawCatalog.children;
  }
  const ids = [];
  for (const row of rows) {
    if (ids.length >= LIMITS.maxKidsPerParent) break;
    if (typeof row === 'string') { if (safeId(row)) ids.push(row); continue; }
    if (!plainRecord(row)) continue;
    if (row.kind !== undefined && row.kind !== 'child') continue;
    const id = row.sessionId !== undefined ? row.sessionId : row.id;
    if (safeId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function sanitizeJobs(rawJobs) {
  if (!Array.isArray(rawJobs)) return [];
  const jobs = [];
  for (const job of rawJobs) {
    if (jobs.length >= LIMITS.maxJobsPerSession) break;
    if (!plainRecord(job)) continue;
    jobs.push({
      status: typeof job.status === 'string' && job.status.length <= 32 ? job.status : 'unknown',
      startedAt: Number.isFinite(job.startedAt) ? job.startedAt : null
    });
  }
  return jobs;
}

// 把宿主快照收窄成有界、冻结、不含路径的镜像；任何垃圾输入都退化为空快照。
function sanitizeSnapshot(raw) {
  if (!plainRecord(raw)) return EMPTY_SNAPSHOT;
  const byId = {};
  let count = 0;
  if (plainRecord(raw.byId)) {
    for (const [id, entry] of Object.entries(raw.byId)) {
      if (count >= LIMITS.maxSessions) break;
      if (!safeId(id)) continue;
      const cleaned = sanitizeEntry(id, entry);
      if (!cleaned) continue;
      byId[id] = cleaned;
      count += 1;
    }
  } else if (Array.isArray(raw.items)) {
    for (const entry of raw.items) {
      if (count >= LIMITS.maxSessions) break;
      if (!plainRecord(entry) || !safeId(entry.sessionId)) continue;
      const cleaned = sanitizeEntry(entry.sessionId, {
        ...entry,
        parentId: entry.parentSessionId,
        displayTitle: entry.title
      });
      if (!cleaned) continue;
      byId[entry.sessionId] = cleaned;
      count += 1;
    }
  }
  const subagentsByParent = {};
  if (plainRecord(raw.subagentsByParent)) {
    for (const [parentId, catalog] of Object.entries(raw.subagentsByParent)) {
      if (!safeId(parentId)) continue;
      const ids = childIdsOf(catalog);
      if (ids.length > 0) subagentsByParent[parentId] = ids;
    }
  }
  const jobsBySession = {};
  if (plainRecord(raw.jobsBySession)) {
    for (const [sid, jobs] of Object.entries(raw.jobsBySession)) {
      if (!safeId(sid)) continue;
      const cleaned = sanitizeJobs(jobs);
      if (cleaned.length > 0) jobsBySession[sid] = cleaned;
    }
  }
  return deepFreeze({
    byId,
    subagentsByParent,
    jobsBySession,
    current: safeId(raw.current) ? raw.current : null
  });
}

function sessionNotifyState(entry) {
  if (!entry) return null;
  if (entry.pending === true) return 'need';
  if (entry.completed === true) return 'done';
  return null;
}

// 沿 parentId 与 subagentsByParent 两条通道收集后代；有界、防环。
function collectKids(snapshot, sid) {
  const result = new Set();
  if (!snapshot || !safeId(sid)) return result;
  let frontier = [sid];
  for (let depth = 0; depth < LIMITS.maxKidsDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      for (const [id, entry] of Object.entries(snapshot.byId)) {
        if (entry.parentId === parent && id !== sid && !result.has(id)) { result.add(id); next.push(id); }
      }
      for (const id of snapshot.subagentsByParent[parent] || []) {
        if (id !== sid && !result.has(id)) { result.add(id); next.push(id); }
      }
      if (result.size >= LIMITS.maxSessions) return result;
    }
    frontier = next;
  }
  return result;
}

function extraOf(extras, sid) {
  if (!plainRecord(extras) || !safeId(sid)) return null;
  const value = extras[sid];
  return plainRecord(value) ? value : null;
}

// 事实状态（不看 ack）：need > done > busy > idle。
function statusOf(snapshot, sid, extras) {
  if (!snapshot || !safeId(sid)) return 'idle';
  const entry = snapshot.byId[sid];
  if (!entry) return 'idle';
  if (sessionNotifyState(entry) === 'need') return 'need';
  for (const kid of collectKids(snapshot, sid)) {
    if (sessionNotifyState(snapshot.byId[kid]) === 'need') return 'need';
  }
  const extra = extraOf(extras, sid);
  if (extra && extra.pending === true) return 'need';
  if (entry.completed === true) return 'done';
  if (entry.running === true) return 'busy';
  return 'idle';
}

// 运行时长：本会话正在运行的后台任务最早 startedAt 起算；没有任务时用会话面提供的
// 本轮开始时间（extras[sid].turnStartedAt）。不在运行中一律 null。
function runtimeOf(snapshot, sid, now, extras) {
  if (!snapshot || !safeId(sid) || !Number.isFinite(now)) return null;
  const entry = snapshot.byId[sid];
  if (!entry || entry.running !== true) return null;
  let start = null;
  for (const job of snapshot.jobsBySession[sid] || []) {
    if (job.status === 'running' && Number.isFinite(job.startedAt) && (start === null || job.startedAt < start)) {
      start = job.startedAt;
    }
  }
  if (start === null) {
    const extra = extraOf(extras, sid);
    if (extra && Number.isFinite(extra.turnStartedAt)) start = extra.turnStartedAt;
  }
  if (start === null) return null;
  return Math.max(0, now - start);
}

function formatRuntime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

function normalizeAcks(acks) {
  const result = {};
  if (!plainRecord(acks)) return result;
  for (const [sid, signature] of Object.entries(acks)) {
    if (safeId(sid) && typeof signature === 'string'
        && /^(?:need|done):[a-f0-9]{64}$/.test(signature)) result[sid] = signature;
  }
  return result;
}

function normalizeSeen(seen) {
  const result = {};
  if (!plainRecord(seen)) return result;
  for (const [sid, value] of Object.entries(seen)) {
    if (safeId(sid) && (value === null || (typeof value === 'string'
        && /^(?:need|done):[a-f0-9]{64}$/.test(value)))) result[sid] = value;
  }
  return result;
}

function notificationSignature(snapshot, sid, extras) {
  const status = statusOf(snapshot, sid, extras);
  if (status !== 'need' && status !== 'done') return null;
  const facts = [];
  if (status === 'need') {
    const ids = [sid, ...collectKids(snapshot, sid)].filter(safeId).sort();
    for (const id of ids) {
      const entry = snapshot.byId[id];
      if (entry && entry.pending === true) {
        facts.push([id, entry.pendingKind || 'unknown', entry.updatedAt]);
      }
    }
    const extra = extraOf(extras, sid);
    if (extra && extra.pending === true) {
      facts.push([sid, `extra:${safeKind(extra.pendingKind)}`,
        Number.isFinite(extra.updatedAt) ? extra.updatedAt : 0]);
    }
  } else {
    const entry = snapshot.byId[sid];
    facts.push([sid, 'done', entry && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0]);
  }
  return `${status}:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
}

// 事件签名驱动 ack 失效：need/done 的事实轮次、待决子代理集合或更新时间变化时
// 都会生成新签名。这样 done→busy→done 以及“旧问题仍在、又来一个新子代理问题”都会重亮。
function transitionAcks(memory, snapshot, boundSessions, extras) {
  const acks = normalizeAcks(memory && memory.acks);
  const seen = normalizeSeen(memory && memory.seen);
  for (const sid of boundSessions) {
    if (!safeId(sid)) continue;
    const current = notificationSignature(snapshot, sid, extras);
    if (Object.prototype.hasOwnProperty.call(acks, sid) && acks[sid] !== current) delete acks[sid];
    seen[sid] = current;
  }
  return { acks, seen };
}

// 点开项目 = 确认：按当前事实状态记下 need/done（含子代理），光效熄灭。
function ackSession(acks, snapshot, sid, extras) {
  const next = normalizeAcks(acks);
  if (!snapshot || !safeId(sid)) return next;
  const status = statusOf(snapshot, sid, extras);
  if (status !== 'need' && status !== 'done') return next;
  next[sid] = notificationSignature(snapshot, sid, extras);
  if (status === 'need') {
    for (const kid of collectKids(snapshot, sid)) {
      if (sessionNotifyState(snapshot.byId[kid]) === 'need') {
        next[kid] = notificationSignature(snapshot, kid, extras);
      }
    }
  }
  return next;
}

function glowOf(status, sid, acks, signature) {
  if (!sid) return false;
  if (status === 'need' || status === 'done') return acks[sid] !== signature;
  return false;
}

// 组装控制室卡片。projects = 项目注册表的公开视图数组（id/name/icon/pinned/hidden/boundSession）。
function buildCards(input) {
  if (!plainRecord(input)) throw new TypeError('buildCards 需要普通对象参数');
  const snapshot = sanitizeSnapshot(input.snapshot);
  const projects = Array.isArray(input.projects) ? input.projects.filter(plainRecord) : [];
  const now = Number.isFinite(input.now) ? input.now : 0;
  const extras = plainRecord(input.extras) ? input.extras : null;
  const boundSessions = projects.map((p) => p.boundSession).filter(safeId);
  const memory = transitionAcks({ acks: input.acks, seen: input.seen }, snapshot, boundSessions, extras);
  const counts = { need: 0, done: 0, busy: 0, idle: 0, total: 0, glowing: 0 };
  const cards = projects.map((project) => {
    const sid = safeId(project.boundSession) ? project.boundSession : null;
    const status = statusOf(snapshot, sid, extras);
    const signature = notificationSignature(snapshot, sid, extras);
    const glow = glowOf(status, sid, memory.acks, signature);
    counts[status] += 1;
    counts.total += 1;
    if (glow) counts.glowing += 1;
    return {
      projectId: typeof project.id === 'string' ? project.id : '',
      name: safeTitle(project.name),
      icon: typeof project.icon === 'string' ? project.icon : '🧱',
      pinned: project.pinned === true,
      hidden: project.hidden === true,
      boundSession: sid,
      status,
      statusLabel: STATUS_LABELS[status],
      glow,
      runtimeMs: runtimeOf(snapshot, sid, now, extras),
      kids: sid ? collectKids(snapshot, sid).size : 0,
      sessionTitle: sid && snapshot.byId[sid] ? snapshot.byId[sid].displayTitle : ''
    };
  });
  return deepFreeze({ cards, acks: memory.acks, seen: memory.seen, counts });
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  LIMITS,
  EMPTY_SNAPSHOT,
  sanitizeSnapshot,
  sessionNotifyState,
  collectKids,
  statusOf,
  runtimeOf,
  formatRuntime,
  transitionAcks,
  notificationSignature,
  ackSession,
  buildCards
};
