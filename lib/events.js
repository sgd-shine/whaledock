'use strict';

// 任务事件中性层：只处理已归一化事件，不依赖 Electron 或具体后端协议。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const USAGE_DISCLAIMER = 'dsh 已观测用量，非账单';
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_TOKEN_VALUE = 1_000_000_000_000;
const MAX_DAILY_TOKEN_BUDGET = 1_000_000_000;
const MAX_LEDGER_ENTRIES = 10_000;
const MAX_BUFFERED_EVENTS_PER_SESSION = 10_000;
const MAX_BUFFERED_EVENTS_TOTAL = 50_000;

const EVENT_KINDS = new Set([
  'subscribed',
  'message',
  'turn-terminal',
  'approval-open',
  'approval-close',
  'question-open',
  'question-close',
  'jobs',
  'projection'
]);

const AVAILABILITY_STATES = new Set([
  'probing', 'backfilling', 'live', 'disconnected', 'unavailable'
]);
const AVAILABILITY_DETAILS = new Set([
  'state-recovered', 'contract-mismatch', 'transport-error',
  'history-gap', 'consumer-error', 'closed', 'ready'
]);

const TERMINAL_RESULTS = new Map([
  ['error', 'error'],
  ['aborted', 'cancelled'],
  ['blocked', 'blocked'],
  ['max-tokens', 'max-tokens'],
  ['interrupted', 'interrupted']
]);

const DEFAULT_CONFIG = Object.freeze({
  taskNotifications: true,
  budgetEnabled: false,
  dailyTokenBudget: 1_000_000,
  priceInputPerMillion: 1,
  priceCacheReadPerMillion: 0.02,
  priceOutputPerMillion: 2,
  timeZone: undefined,
  recentTaskLimit: 100,
  retentionDays: 14
});

function eventError(message, code = 'ERR_EVENT_INPUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function safeIso(value, fallback) {
  const date = value === undefined || value === null ? fallback : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw eventError('事件时间必须是有效日期');
  }
  return date.toISOString();
}

function safeStoredIso(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeOrigin(value) {
  if (value === 'subagent') return 'subagent';
  if (value === 'user') return 'user';
  return 'unknown';
}

function normalizeRef(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw eventError(`${name} 必须是非空且长度受限的字符串`);
  }
  return value;
}

function normalizeSeq(value, name = 'seq') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw eventError(`${name} 必须是非负安全整数`);
  }
  return value;
}

function normalizeFloor(value) {
  if (!Number.isSafeInteger(value) || value < -1) {
    throw eventError('notificationFloorSeq 必须是 -1 或非负安全整数');
  }
  return value;
}

function normalizeTurn(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw eventError('turn 必须是非负安全整数');
  }
  return value;
}

function normalizeToken(value, name) {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_VALUE) {
    throw eventError(`${name} 必须是非负且受限的安全整数`);
  }
  return value;
}

function normalizeUsage(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw eventError('usage 必须是对象');
  return {
    input: normalizeToken(value.inputTokens, 'inputTokens'),
    cacheRead: normalizeToken(value.cacheReadTokens, 'cacheReadTokens'),
    output: normalizeToken(value.outputTokens, 'outputTokens')
  };
}

function validateTimeZone(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 128) {
    throw eventError('timeZone 必须是有效 IANA 时区', 'ERR_EVENT_CONFIG');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch (_error) {
    throw eventError('timeZone 必须是有效 IANA 时区', 'ERR_EVENT_CONFIG');
  }
  return value;
}

function normalizeConfig(input = {}, base = DEFAULT_CONFIG) {
  if (!isPlainObject(input)) throw eventError('事件配置必须是对象', 'ERR_EVENT_CONFIG');
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw eventError(`不支持的事件配置：${key}`, 'ERR_EVENT_CONFIG');
  }
  const next = { ...base, ...input };
  for (const key of ['taskNotifications', 'budgetEnabled']) {
    if (typeof next[key] !== 'boolean') {
      throw eventError(`${key} 必须是布尔值`, 'ERR_EVENT_CONFIG');
    }
  }
  if (!Number.isSafeInteger(next.dailyTokenBudget) || next.dailyTokenBudget < 1
      || next.dailyTokenBudget > MAX_DAILY_TOKEN_BUDGET) {
    throw eventError('dailyTokenBudget 必须是 1–1000000000 的整数', 'ERR_EVENT_CONFIG');
  }
  for (const key of [
    'priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion'
  ]) {
    if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 1_000_000) {
      throw eventError(`${key} 必须是非负有限数字`, 'ERR_EVENT_CONFIG');
    }
  }
  if (!Number.isSafeInteger(next.recentTaskLimit) || next.recentTaskLimit < 1
      || next.recentTaskLimit > 1000) {
    throw eventError('recentTaskLimit 必须是 1–1000 的整数', 'ERR_EVENT_CONFIG');
  }
  if (!Number.isSafeInteger(next.retentionDays) || next.retentionDays < 7
      || next.retentionDays > 366) {
    throw eventError('retentionDays 必须是 7–366 的整数', 'ERR_EVENT_CONFIG');
  }
  next.timeZone = validateTimeZone(next.timeZone);
  return next;
}

function newSession() {
  return {
    lastContiguousSeq: -1,
    notificationFloorSeq: null,
    coverageGap: false,
    origin: 'unknown',
    parentKey: null,
    turns: {},
    pendingApprovals: {},
    pendingQuestions: {},
    lastTerminal: null,
    lastNotifiedTerminalSeq: null
  };
}

function newState(salt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    salt,
    updatedAt: null,
    sessions: {},
    notificationLedger: {},
    usageEntries: {},
    messageLedger: {},
    recentTasks: [],
    nextTaskOrdinal: 1,
    budget: {
      date: null,
      crossingDate: null,
      pausedDate: null,
      resumeDate: null
    }
  };
}

function safeHashMap(value, mapper) {
  const result = {};
  if (!isPlainObject(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (!HASH_RE.test(key)) continue;
    const mapped = mapper(item, key);
    if (mapped !== null) result[key] = mapped;
  }
  return result;
}

function safeStoredTurn(value) {
  if (!isPlainObject(value) || !HASH_RE.test(value.taskKey || '')) return null;
  return {
    taskKey: value.taskKey,
    hasAssistantMessage: value.hasAssistantMessage === true,
    hasDirectUserMessage: value.hasDirectUserMessage === true,
    startSeq: Number.isSafeInteger(value.startSeq) && value.startSeq >= 0 ? value.startSeq : null,
    startedAt: safeStoredIso(value.startedAt)
  };
}

function safeStoredSession(value) {
  if (!isPlainObject(value)) return null;
  const session = newSession();
  if (Number.isSafeInteger(value.lastContiguousSeq) && value.lastContiguousSeq >= -1) {
    session.lastContiguousSeq = value.lastContiguousSeq;
  }
  if (Number.isSafeInteger(value.notificationFloorSeq) && value.notificationFloorSeq >= -1) {
    session.notificationFloorSeq = value.notificationFloorSeq;
  }
  session.coverageGap = value.coverageGap === true;
  session.origin = normalizeOrigin(value.origin);
  session.parentKey = HASH_RE.test(value.parentKey || '') ? value.parentKey : null;
  if (isPlainObject(value.turns)) {
    for (const [turn, item] of Object.entries(value.turns)) {
      if (!/^\d+$/.test(turn)) continue;
      const safe = safeStoredTurn(item);
      if (safe) session.turns[turn] = safe;
    }
  }
  session.pendingApprovals = safeHashMap(value.pendingApprovals, (item) => safeStoredIso(item));
  session.pendingQuestions = safeHashMap(value.pendingQuestions, (item) => safeStoredIso(item));
  if (isPlainObject(value.lastTerminal)
      && Number.isSafeInteger(value.lastTerminal.seq)
      && Number.isSafeInteger(value.lastTerminal.turn)
      && typeof value.lastTerminal.result === 'string') {
    session.lastTerminal = {
      seq: value.lastTerminal.seq,
      turn: value.lastTerminal.turn,
      result: value.lastTerminal.result,
      at: safeStoredIso(value.lastTerminal.at)
    };
  }
  if (Number.isSafeInteger(value.lastNotifiedTerminalSeq)
      && value.lastNotifiedTerminalSeq >= 0) {
    session.lastNotifiedTerminalSeq = value.lastNotifiedTerminalSeq;
  }
  return session;
}

function safeUsageEntry(value) {
  if (!isPlainObject(value)
      || !HASH_RE.test(value.taskKey || '')
      || !HASH_RE.test(value.sessionKey || '')
      || !HASH_RE.test(value.messageKey || '')) return null;
  try {
    const at = safeStoredIso(value.at);
    if (!at) return null;
    return {
      taskKey: value.taskKey,
      sessionKey: value.sessionKey,
      messageKey: value.messageKey,
      day: /^\d{4}-\d{2}-\d{2}$/.test(value.day || '') ? value.day : '',
      at,
      origin: normalizeOrigin(value.origin),
      mode: value.mode === 'final' ? 'final' : 'chunk',
      input: normalizeToken(value.input, 'input'),
      cacheRead: normalizeToken(value.cacheRead, 'cacheRead'),
      output: normalizeToken(value.output, 'output')
    };
  } catch (_error) {
    return null;
  }
}

function safeRecentTask(value) {
  if (!isPlainObject(value) || !HASH_RE.test(value.taskKey || '')) return null;
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 1) return null;
  return {
    taskKey: value.taskKey,
    ordinal: value.ordinal,
    turn: Number.isSafeInteger(value.turn) && value.turn >= 0 ? value.turn : 0,
    result: typeof value.result === 'string' ? value.result : 'unknown',
    origin: normalizeOrigin(value.origin),
    completedAt: safeStoredIso(value.completedAt),
    terminalSeq: Number.isSafeInteger(value.terminalSeq) ? value.terminalSeq : -1,
    durationMs: value.durationMs === null
      ? null
      : (Number.isSafeInteger(value.durationMs) && value.durationMs >= 0
        ? value.durationMs : null)
  };
}

function storedIsoOrNull(value) {
  return value === null || safeStoredIso(value) !== null;
}

function storedDayOrNull(value) {
  return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validHashMap(value, validator) {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(([key, item]) => HASH_RE.test(key) && validator(item));
}

function validStoredTurn(value) {
  return isPlainObject(value)
    && HASH_RE.test(value.taskKey || '')
    && typeof value.hasAssistantMessage === 'boolean'
    && typeof value.hasDirectUserMessage === 'boolean'
    && (value.startSeq === null
      || (Number.isSafeInteger(value.startSeq) && value.startSeq >= 0))
    && storedIsoOrNull(value.startedAt);
}

function validStoredSession(value) {
  if (!isPlainObject(value)
      || !Number.isSafeInteger(value.lastContiguousSeq)
      || value.lastContiguousSeq < -1
      || !(value.notificationFloorSeq === null
        || (Number.isSafeInteger(value.notificationFloorSeq)
          && value.notificationFloorSeq >= -1))
      || !(value.coverageGap === undefined || typeof value.coverageGap === 'boolean')
      || !['unknown', 'user', 'subagent'].includes(value.origin)
      || !(value.parentKey === null || HASH_RE.test(value.parentKey || ''))
      || !isPlainObject(value.turns)
      || !Object.entries(value.turns).every(([turn, item]) => (
        /^\d+$/.test(turn) && validStoredTurn(item)
      ))
      || !validHashMap(value.pendingApprovals, (item) => safeStoredIso(item) !== null)
      || !validHashMap(value.pendingQuestions, (item) => safeStoredIso(item) !== null)
      || !(value.lastNotifiedTerminalSeq === null
        || (Number.isSafeInteger(value.lastNotifiedTerminalSeq)
          && value.lastNotifiedTerminalSeq >= 0))) return false;
  if (value.notificationFloorSeq === null && value.lastContiguousSeq !== -1) return false;
  if (value.lastTerminal === null) return true;
  return isPlainObject(value.lastTerminal)
    && Number.isSafeInteger(value.lastTerminal.seq)
    && value.lastTerminal.seq >= 0
    && Number.isSafeInteger(value.lastTerminal.turn)
    && value.lastTerminal.turn >= 0
    && typeof value.lastTerminal.result === 'string'
    && value.lastTerminal.result.length <= 64
    && storedIsoOrNull(value.lastTerminal.at);
}

function validStoredUsage(value) {
  return isPlainObject(value)
    && HASH_RE.test(value.taskKey || '')
    && HASH_RE.test(value.sessionKey || '')
    && HASH_RE.test(value.messageKey || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(value.day || '')
    && safeStoredIso(value.at) !== null
    && ['unknown', 'user', 'subagent'].includes(value.origin)
    && ['chunk', 'final'].includes(value.mode)
    && [value.input, value.cacheRead, value.output].every((tokens) => (
      Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= MAX_TOKEN_VALUE
    ));
}

function validStoredMessage(value) {
  return isPlainObject(value)
    && HASH_RE.test(value.stepKey || '')
    && safeStoredIso(value.at) !== null
    && ['chunk', 'final'].includes(value.mode);
}

function validStoredTask(value) {
  return isPlainObject(value)
    && HASH_RE.test(value.taskKey || '')
    && Number.isSafeInteger(value.ordinal)
    && value.ordinal >= 1
    && Number.isSafeInteger(value.turn)
    && value.turn >= 0
    && typeof value.result === 'string'
    && value.result.length <= 64
    && ['unknown', 'user', 'subagent'].includes(value.origin)
    && safeStoredIso(value.completedAt) !== null
    && Number.isSafeInteger(value.terminalSeq)
    && value.terminalSeq >= 0
    && (value.durationMs === null
      || (Number.isSafeInteger(value.durationMs) && value.durationMs >= 0));
}

function validateStoredState(raw) {
  const valid = storedIsoOrNull(raw.updatedAt)
    && validHashMap(raw.sessions, validStoredSession)
    && validHashMap(raw.notificationLedger, (value) => safeStoredIso(value) !== null)
    && validHashMap(raw.usageEntries, validStoredUsage)
    && validHashMap(raw.messageLedger, validStoredMessage)
    && Array.isArray(raw.recentTasks)
    && raw.recentTasks.every(validStoredTask)
    && Number.isSafeInteger(raw.nextTaskOrdinal)
    && raw.nextTaskOrdinal >= 1
    && isPlainObject(raw.budget)
    && ['date', 'crossingDate', 'pausedDate', 'resumeDate']
      .every((key) => storedDayOrNull(raw.budget[key]));
  if (!valid) throw eventError('事件状态文件局部结构损坏', 'ERR_EVENT_STATE_CORRUPT');
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return newState(crypto.randomBytes(32).toString('base64'));
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (error) {
    throw eventError(`事件状态文件无法读取：${error.message}`, 'ERR_EVENT_STATE_CORRUPT');
  }
  if (!isPlainObject(raw)) {
    throw eventError('事件状态文件根节点损坏', 'ERR_EVENT_STATE_CORRUPT');
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    if (!Number.isSafeInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
      throw eventError('事件状态文件 schema 损坏', 'ERR_EVENT_STATE_CORRUPT');
    }
    throw eventError('事件状态文件 schema 不受支持', 'ERR_EVENT_STATE_SCHEMA');
  }
  if (typeof raw.salt !== 'string' || raw.salt.length < 32 || raw.salt.length > 128
      || Buffer.from(raw.salt, 'base64').length < 32) {
    throw eventError('事件状态文件 salt 无效', 'ERR_EVENT_STATE_CORRUPT');
  }
  validateStoredState(raw);
  const state = newState(raw.salt);
  state.updatedAt = safeStoredIso(raw.updatedAt);
  state.sessions = safeHashMap(raw.sessions, safeStoredSession);
  state.notificationLedger = safeHashMap(raw.notificationLedger, (value) => (
    typeof value === 'string' ? value : null
  ));
  state.usageEntries = safeHashMap(raw.usageEntries, safeUsageEntry);
  state.messageLedger = safeHashMap(raw.messageLedger, (value) => {
    if (!isPlainObject(value) || !HASH_RE.test(value.stepKey || '')) return null;
    const at = safeStoredIso(value.at);
    if (!at) return null;
    return {
      stepKey: value.stepKey,
      at,
      mode: value.mode === 'final' ? 'final' : 'chunk'
    };
  });
  if (Array.isArray(raw.recentTasks)) {
    state.recentTasks = raw.recentTasks.map(safeRecentTask).filter(Boolean);
  }
  if (Number.isSafeInteger(raw.nextTaskOrdinal) && raw.nextTaskOrdinal >= 1) {
    state.nextTaskOrdinal = raw.nextTaskOrdinal;
  } else if (state.recentTasks.length > 0) {
    state.nextTaskOrdinal = Math.max(...state.recentTasks.map((task) => task.ordinal)) + 1;
  }
  if (isPlainObject(raw.budget)) {
    for (const key of ['date', 'crossingDate', 'pausedDate', 'resumeDate']) {
      state.budget[key] = /^\d{4}-\d{2}-\d{2}$/.test(raw.budget[key] || '')
        ? raw.budget[key] : null;
    }
  }
  return state;
}

function recoverCorruptState(stateFile) {
  const directory = path.dirname(stateFile);
  const basename = path.basename(stateFile);
  const backup = path.join(
    directory,
    `${basename}.corrupt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );
  fs.chmodSync(stateFile, 0o600);
  if (process.platform !== 'win32'
      && (fs.statSync(stateFile).mode & 0o777) !== 0o600) {
    throw eventError('损坏状态文件无法收紧为 0600', 'ERR_EVENT_STATE_RECOVERY');
  }
  fs.renameSync(stateFile, backup);
  fs.chmodSync(backup, 0o600);
  if (process.platform !== 'win32'
      && (fs.statSync(backup).mode & 0o777) !== 0o600) {
    throw eventError('损坏状态备份无法保持 0600', 'ERR_EVENT_STATE_RECOVERY');
  }
  const prefix = `${basename}.corrupt-`;
  const backups = fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .reverse();
  for (const old of backups.slice(3)) {
    try { fs.unlinkSync(path.join(directory, old)); } catch (_error) { /* bounded best effort */ }
  }
  return backup;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function cloneBuffers(buffers) {
  const copy = new Map();
  for (const [sessionKey, entries] of buffers) copy.set(sessionKey, new Map(entries));
  return copy;
}

function calendarDate(date, timeZone) {
  if (!timeZone) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function mondayFor(day) {
  const [year, month, date] = day.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date));
  const offset = (cursor.getUTCDay() + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - offset);
  return cursor.toISOString().slice(0, 10);
}

function addDays(day, delta) {
  const [year, month, date] = day.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date + delta));
  return cursor.toISOString().slice(0, 10);
}

function emptyTokens() {
  return { input: 0, cacheRead: 0, output: 0, total: 0 };
}

function addUsage(tokens, entry) {
  tokens.input += entry.input;
  tokens.cacheRead += entry.cacheRead;
  tokens.output += entry.output;
  tokens.total += entry.input + entry.cacheRead + entry.output;
}

function estimatedCost(tokens, config) {
  const value = (
    tokens.input * config.priceInputPerMillion
    + tokens.cacheRead * config.priceCacheReadPerMillion
    + tokens.output * config.priceOutputPerMillion
  ) / 1_000_000;
  return Number(value.toFixed(12));
}

function createEventService(options = {}) {
  if (!isPlainObject(options)) throw eventError('事件服务参数必须是对象');
  if (typeof options.stateFile !== 'string' || options.stateFile.length === 0) {
    throw eventError('stateFile 必须是明确文件路径');
  }
  const stateFile = path.resolve(options.stateFile);
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : null;
  let config = normalizeConfig(options.config || {});
  let recoveredCorruptState = false;
  let state;
  try {
    state = loadState(stateFile);
  } catch (error) {
    if (!error || error.code !== 'ERR_EVENT_STATE_CORRUPT') throw error;
    recoverCorruptState(stateFile);
    state = newState(crypto.randomBytes(32).toString('base64'));
    recoveredCorruptState = true;
  }
  let buffers = new Map();
  const runtimeRefs = new Map();
  let availability = {
    state: 'probing',
    detail: recoveredCorruptState ? 'state-recovered' : null
  };
  let committedState = cloneState(state);
  let committedBuffers = cloneBuffers(buffers);
  let committedConfig = { ...config };
  let committedAvailability = { ...availability };
  let operation = Promise.resolve();
  let closed = false;
  let connectionGeneration = 0;
  let generationRequired = false;

  function currentDate() {
    return calendarDate(new Date(now()), config.timeZone);
  }

  function hmac(namespace, ...parts) {
    const digest = crypto.createHmac('sha256', Buffer.from(state.salt, 'base64'));
    digest.update(namespace);
    for (const part of parts) {
      digest.update('\0');
      digest.update(String(part));
    }
    return digest.digest('hex');
  }

  function sessionKeyFor(sessionRef) {
    return hmac('session', normalizeRef(sessionRef, 'sessionRef'));
  }

  function rememberRef(sessionKey, sessionRef) {
    runtimeRefs.set(sessionKey, sessionRef);
  }

  function ensureSession(sessionKey) {
    if (!state.sessions[sessionKey]) state.sessions[sessionKey] = newSession();
    return state.sessions[sessionKey];
  }

  function lineageKeyFor(sessionKey) {
    let current = sessionKey;
    const seen = new Set();
    while (!seen.has(current)) {
      seen.add(current);
      const session = state.sessions[current];
      if (!session || !session.parentKey) return current;
      current = session.parentKey;
    }
    return current;
  }

  function assertOpen() {
    if (closed) throw eventError('事件服务已关闭', 'ERR_EVENT_CLOSED');
  }

  function assertGeneration(generation, required = generationRequired) {
    if ((!required && generation === undefined)
        || (Number.isSafeInteger(generation) && generation === connectionGeneration)) return;
    throw eventError('操作来自已失效或缺失的连接代', 'ERR_EVENT_GENERATION');
  }

  function emitChanged() {
    if (!onChanged) return;
    try { onChanged(snapshot()); } catch (_error) { /* UI 回调不能破坏事件状态 */ }
  }

  async function persistState() {
    const directory = path.dirname(stateFile);
    await fs.promises.mkdir(directory, { recursive: true });
    state.updatedAt = new Date(now()).toISOString();
    const durable = cloneState(state);
    const suffix = crypto.randomBytes(6).toString('hex');
    const temporary = `${stateFile}.tmp-${process.pid}-${suffix}`;
    let handle = null;
    try {
      handle = await fs.promises.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(durable, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.chmod(temporary, 0o600);
      await fs.promises.rename(temporary, stateFile);
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch (_closeError) { /* ignore */ }
      }
      try { await fs.promises.unlink(temporary); } catch (_unlinkError) { /* ignore */ }
      throw error;
    }
  }

  function enqueue(work) {
    const run = operation.then(work);
    operation = run.catch(() => {});
    return run;
  }

  async function transaction(work, options = {}) {
    return enqueue(async () => {
      assertOpen();
      const stateBefore = cloneState(state);
      const buffersBefore = cloneBuffers(buffers);
      const configBefore = config;
      const availabilityBefore = { ...availability };
      const generationBefore = connectionGeneration;
      const generationRequiredBefore = generationRequired;
      try {
        const outcome = await work();
        const dirty = outcome && outcome.dirty === true;
        const changed = dirty || (outcome && outcome.changed === true);
        if (dirty || options.forcePersist) await persistState();
        committedState = cloneState(state);
        committedBuffers = cloneBuffers(buffers);
        committedConfig = { ...config };
        committedAvailability = { ...availability };
        if (changed) emitChanged();
        if (outcome && Object.hasOwn(outcome, 'value')) return outcome.value;
        return outcome && Array.isArray(outcome.effects) ? outcome.effects : [];
      } catch (error) {
        state = stateBefore;
        buffers = buffersBefore;
        config = configBefore;
        availability = availabilityBefore;
        connectionGeneration = generationBefore;
        generationRequired = generationRequiredBefore;
        throw error;
      }
    });
  }

  function rollBudgetDay() {
    const today = currentDate();
    if (state.budget.date === today) return false;
    state.budget.date = today;
    state.budget.crossingDate = null;
    state.budget.pausedDate = null;
    state.budget.resumeDate = null;
    return true;
  }

  function aggregate(predicate, sourceState = state, sourceConfig = config) {
    const tokens = emptyTokens();
    const origins = { user: 0, subagent: 0 };
    for (const entry of Object.values(sourceState.usageEntries)) {
      const day = calendarDate(new Date(entry.at), sourceConfig.timeZone);
      if (!predicate(entry, day)) continue;
      addUsage(tokens, entry);
      const origin = entry.origin === 'subagent' ? 'subagent' : 'user';
      origins[origin] += entry.input + entry.cacheRead + entry.output;
    }
    return {
      tokens,
      origins,
      estimatedCost: estimatedCost(tokens, sourceConfig)
    };
  }

  function todayAggregate() {
    const day = currentDate();
    return { day, ...aggregate((_entry, entryDay) => entryDay === day) };
  }

  function budgetEffect(triggerSessionRef) {
    if (!config.budgetEnabled) return null;
    const today = currentDate();
    const total = todayAggregate().tokens.total;
    if (total < config.dailyTokenBudget) return null;
    if (state.budget.resumeDate === today || state.budget.crossingDate === today) return null;
    state.budget.crossingDate = today;
    state.budget.pausedDate = today;
    return {
      type: 'budget-crossed',
      date: today,
      observedTokens: total,
      limitTokens: config.dailyTokenBudget,
      requiresSpawnedByUs: true,
      sessionRef: triggerSessionRef || null
    };
  }

  function prune() {
    let dirty = false;
    const cutoff = addDays(currentDate(), -(config.retentionDays - 1));
    for (const [key, entry] of Object.entries(state.usageEntries)) {
      const day = calendarDate(new Date(entry.at), config.timeZone);
      if (day < cutoff) {
        delete state.usageEntries[key];
        dirty = true;
      }
    }
    for (const [key, entry] of Object.entries(state.messageLedger)) {
      const day = entry.at ? calendarDate(new Date(entry.at), config.timeZone) : null;
      if (day && day < cutoff) {
        delete state.messageLedger[key];
        dirty = true;
      }
    }
    if (state.recentTasks.length > config.recentTaskLimit) {
      state.recentTasks = state.recentTasks.slice(-config.recentTaskLimit);
      dirty = true;
    }
    const ledgerEntries = Object.entries(state.notificationLedger);
    if (ledgerEntries.length > MAX_LEDGER_ENTRIES) {
      ledgerEntries.sort((left, right) => String(left[1]).localeCompare(String(right[1])));
      for (const [key] of ledgerEntries.slice(0, ledgerEntries.length - MAX_LEDGER_ENTRIES)) {
        delete state.notificationLedger[key];
      }
      dirty = true;
    }
    return dirty;
  }

  function prepareEvent(input, suppressNotifications) {
    if (!isPlainObject(input) || !EVENT_KINDS.has(input.kind)) {
      throw eventError('事件 kind 不是受支持的中性类型');
    }
    const sessionRef = normalizeRef(input.sessionRef, 'sessionRef');
    const sessionKey = sessionKeyFor(sessionRef);
    rememberRef(sessionKey, sessionRef);
    const prepared = {
      kind: input.kind,
      sessionKey,
      sessionRef,
      suppressNotifications: suppressNotifications === true,
      at: safeIso(input.at === undefined ? input.observedAt : input.at, new Date(now()))
    };
    if (input.seq !== undefined) prepared.seq = normalizeSeq(input.seq);
    if (input.origin !== undefined) prepared.origin = normalizeOrigin(input.origin);

    if (input.kind === 'subscribed') {
      const floor = input.notificationFloorSeq === undefined ? input.lastSeq : input.notificationFloorSeq;
      prepared.notificationFloorSeq = normalizeFloor(floor);
      return prepared;
    }

    if (input.kind === 'message' || input.kind === 'turn-terminal') {
      if (prepared.seq === undefined) throw eventError(`${input.kind} 必须带 seq`);
      prepared.turn = normalizeTurn(input.turn);
      prepared.taskKey = hmac('task', sessionKey, prepared.turn);
    }

    if (input.kind === 'message') {
      const role = input.role === undefined ? input.messageRole : input.role;
      prepared.role = role === 'assistant' ? 'assistant' : (role === 'user' ? 'user' : 'other');
      const stepRef = input.step === undefined ? 'default' : normalizeRef(String(input.step), 'step');
      prepared.stepKey = hmac('step', prepared.taskKey, stepRef);
      prepared.usage = normalizeUsage(input.usage);
      prepared.usageMode = input.usageMode === 'final' ? 'final' : 'chunk';
      const rawMessageRef = input.messageRef === undefined ? input.messageId : input.messageRef;
      if (rawMessageRef !== undefined && rawMessageRef !== null) {
        prepared.messageKey = hmac('message', normalizeRef(rawMessageRef, 'messageRef'));
      } else {
        const usage = prepared.usage || { input: 0, cacheRead: 0, output: 0 };
        prepared.messageKey = hmac(
          'message-fallback', lineageKeyFor(sessionKey), prepared.turn, stepRef, prepared.at,
          usage.input, usage.cacheRead, usage.output
        );
      }
      return prepared;
    }

    if (input.kind === 'turn-terminal') {
      const reason = input.reason === undefined ? input.terminalReason : input.reason;
      prepared.reason = typeof reason === 'string' && reason.length <= 128 ? reason : 'unknown';
      return prepared;
    }

    if (input.kind.startsWith('approval-') || input.kind.startsWith('question-')) {
      const requestRef = normalizeRef(input.requestRef, 'requestRef');
      prepared.requestKey = hmac('request', input.kind.split('-')[0], requestRef);
    }
    return prepared;
  }

  function getTurn(session, event) {
    const key = String(event.turn);
    if (!session.turns[key]) {
      session.turns[key] = {
        taskKey: event.taskKey,
        hasAssistantMessage: false,
        hasDirectUserMessage: false,
        startSeq: event.seq,
        startedAt: event.at
      };
    }
    return session.turns[key];
  }

  function applyUsage(event, session) {
    if (!event.usage) return false;
    const previousOwner = state.messageLedger[event.messageKey];
    if (previousOwner && previousOwner.stepKey !== event.stepKey) {
      const previous = state.usageEntries[previousOwner.stepKey];
      const previousMode = previous ? previous.mode : previousOwner.mode;
      if (previousMode === 'final' || event.usageMode !== 'final') return false;
      if (previous) {
        // fork 中子会话可能补到 final；数值升级，但归属保持首次观察者。
        state.usageEntries[previousOwner.stepKey] = {
          ...previous,
          messageKey: event.messageKey,
          mode: 'final',
          input: event.usage.input,
          cacheRead: event.usage.cacheRead,
          output: event.usage.output
        };
        state.messageLedger[event.messageKey] = {
          stepKey: previousOwner.stepKey,
          at: event.at,
          mode: 'final'
        };
        return true;
      }
    }
    const existing = state.usageEntries[event.stepKey];
    if (existing && existing.mode === 'final' && event.usageMode !== 'final') return false;
    const day = calendarDate(new Date(event.at), config.timeZone);
    state.usageEntries[event.stepKey] = {
      taskKey: event.taskKey,
      sessionKey: event.sessionKey,
      messageKey: event.messageKey,
      day,
      at: event.at,
      origin: session.origin,
      mode: event.usageMode,
      input: event.usage.input,
      cacheRead: event.usage.cacheRead,
      output: event.usage.output
    };
    state.messageLedger[event.messageKey] = {
      stepKey: event.stepKey,
      at: event.at,
      mode: event.usageMode
    };
    return true;
  }

  function terminalResult(reason, hasAssistantMessage) {
    if (reason === 'completed') return hasAssistantMessage ? 'completed' : 'incomplete';
    return TERMINAL_RESULTS.get(reason) || 'unknown';
  }

  function upsertRecentTask(event, session, result, durationMs) {
    let task = state.recentTasks.find((item) => item.taskKey === event.taskKey);
    if (!task) {
      task = {
        taskKey: event.taskKey,
        ordinal: state.nextTaskOrdinal,
        turn: event.turn,
        result,
        origin: session.origin,
        completedAt: event.at,
        terminalSeq: event.seq,
        durationMs
      };
      state.nextTaskOrdinal += 1;
      state.recentTasks.push(task);
    } else {
      task.result = result;
      task.origin = session.origin;
      task.completedAt = event.at;
      task.terminalSeq = event.seq;
      task.durationMs = durationMs;
    }
    if (state.recentTasks.length > config.recentTaskLimit) {
      state.recentTasks = state.recentTasks.slice(-config.recentTaskLimit);
    }
    return task;
  }

  function applyWaiting(event, session, effects) {
    const isApproval = event.kind.startsWith('approval-');
    const isOpen = event.kind.endsWith('-open');
    const pending = isApproval ? session.pendingApprovals : session.pendingQuestions;
    if (!isOpen) {
      if (!Object.hasOwn(pending, event.requestKey)) return false;
      delete pending[event.requestKey];
      return true;
    }
    if (Object.hasOwn(pending, event.requestKey)) return false;
    pending[event.requestKey] = event.at;
    const ledgerKey = hmac('notification', isApproval ? 'approval' : 'question', event.requestKey);
    const alreadyHandled = Object.hasOwn(state.notificationLedger, ledgerKey);
    if (!alreadyHandled) state.notificationLedger[ledgerKey] = event.at;
    if (!alreadyHandled
        && !event.suppressNotifications
        && config.taskNotifications
        && session.notificationFloorSeq !== null
        && session.origin !== 'subagent') {
      effects.push({
        type: 'waiting-human',
        requestKind: isApproval ? 'approval' : 'question',
        sessionRef: event.sessionRef
      });
    }
    return true;
  }

  function applyPrepared(event, effects) {
    const session = ensureSession(event.sessionKey);
    if (event.origin === 'user' || event.origin === 'subagent') session.origin = event.origin;
    if (event.kind === 'subscribed') {
      if (session.notificationFloorSeq === null) {
        session.notificationFloorSeq = event.notificationFloorSeq;
        return true;
      }
      return false;
    }
    if (event.kind.startsWith('approval-') || event.kind.startsWith('question-')) {
      return applyWaiting(event, session, effects);
    }
    if (event.kind === 'message') {
      const turn = getTurn(session, event);
      if (event.role === 'assistant') turn.hasAssistantMessage = true;
      if (event.role === 'user') turn.hasDirectUserMessage = true;
      applyUsage(event, session);
      return true;
    }
    if (event.kind === 'turn-terminal') {
      const turnKey = String(event.turn);
      const existingTurn = session.turns[turnKey] || null;
      const turn = existingTurn || {
        taskKey: event.taskKey,
        hasAssistantMessage: false,
        hasDirectUserMessage: false,
        startSeq: event.seq,
        startedAt: event.at
      };
      const result = terminalResult(event.reason, turn.hasAssistantMessage);
      let durationMs = null;
      if (existingTurn && existingTurn.startedAt) {
        const elapsed = new Date(event.at).getTime() - new Date(existingTurn.startedAt).getTime();
        if (Number.isSafeInteger(elapsed) && elapsed >= 0) durationMs = elapsed;
      }
      const task = upsertRecentTask(event, session, result, durationMs);
      session.lastTerminal = {
        seq: event.seq,
        turn: event.turn,
        result,
        at: event.at
      };
      delete session.turns[turnKey];

      const ledgerKey = hmac('notification', event.taskKey, event.seq);
      const handled = Object.hasOwn(state.notificationLedger, ledgerKey);
      if (!handled) state.notificationLedger[ledgerKey] = event.at;
      session.lastNotifiedTerminalSeq = event.seq;
      const floor = session.notificationFloorSeq;
      const notifyResult = result !== 'unknown' && result !== 'incomplete';
      if (!handled
          && floor !== null
          && event.seq > floor
          && !event.suppressNotifications
          && config.taskNotifications
          && session.origin !== 'subagent'
          && notifyResult) {
        effects.push({
          type: 'task-terminal',
          taskKey: task.taskKey,
          result,
          turn: event.turn,
          terminalSeq: event.seq,
          sessionRef: event.sessionRef
        });
      }
      return true;
    }
    // jobs/projection 只参与连续性；其业务字段由后续 UI 阶段按需扩展。
    return true;
  }

  function bufferSequenced(event) {
    let pending = buffers.get(event.sessionKey);
    if (!pending) {
      pending = new Map();
      buffers.set(event.sessionKey, pending);
    }
    if (pending.has(event.seq)) return { dirty: false, changed: false };
    let totalBuffered = 0;
    for (const entries of buffers.values()) totalBuffered += entries.size;
    if (pending.size >= MAX_BUFFERED_EVENTS_PER_SESSION
        || totalBuffered >= MAX_BUFFERED_EVENTS_TOTAL) {
      throw eventError('事件 gap 缓冲超过安全上限', 'ERR_EVENT_BUFFER_LIMIT');
    }
    pending.set(event.seq, event);
    return { dirty: false, changed: true };
  }

  function drainBuffered(sessionKey, effects) {
    const session = ensureSession(sessionKey);
    if (session.notificationFloorSeq === null) return { dirty: false, changed: false };
    const pending = buffers.get(sessionKey);
    if (!pending) return { dirty: false, changed: false };
    let dirty = false;
    let next = session.lastContiguousSeq + 1;
    while (pending.has(next)) {
      const buffered = pending.get(next);
      pending.delete(next);
      applyPrepared(buffered, effects);
      session.lastContiguousSeq = next;
      dirty = true;
      next += 1;
    }
    if (pending.size === 0) buffers.delete(sessionKey);
    return { dirty, changed: dirty };
  }

  function processSequenced(event, effects) {
    const session = ensureSession(event.sessionKey);
    if (event.seq <= session.lastContiguousSeq) return { dirty: false, changed: false };
    if (session.notificationFloorSeq === null) return bufferSequenced(event);
    const expected = session.lastContiguousSeq + 1;
    if (event.seq > expected) return bufferSequenced(event);

    let dirty = applyPrepared(event, effects);
    session.lastContiguousSeq = event.seq;
    dirty = true;
    const drained = drainBuffered(event.sessionKey, effects);
    dirty = drained.dirty || dirty;
    return { dirty, changed: true };
  }

  async function registerSession(sessionRef, metadata = {}) {
    if (!isPlainObject(metadata)) throw eventError('session metadata 必须是对象');
    return transaction(async () => {
      let dirty = rollBudgetDay();
      let changed = dirty;
      const effects = [];
      const sessionKey = sessionKeyFor(sessionRef);
      rememberRef(sessionKey, sessionRef);
      const existed = Boolean(state.sessions[sessionKey]);
      const session = ensureSession(sessionKey);
      if (!existed) dirty = true;
      if (metadata.origin !== undefined) {
        const origin = normalizeOrigin(metadata.origin);
        if (origin !== 'unknown' && session.origin !== origin) {
          session.origin = origin;
          dirty = true;
        }
      }
      if (metadata.parentRef !== undefined && metadata.parentRef !== null) {
        const parentKey = sessionKeyFor(metadata.parentRef);
        if (session.parentKey !== parentKey) {
          session.parentKey = parentKey;
          dirty = true;
        }
      }
      if (metadata.notificationFloorSeq !== undefined
          && session.notificationFloorSeq === null) {
        session.notificationFloorSeq = normalizeFloor(metadata.notificationFloorSeq);
        dirty = true;
      }
      if (metadata.initialContiguousSeq !== undefined) {
        const initial = normalizeFloor(metadata.initialContiguousSeq);
        const pending = buffers.get(sessionKey);
        if (session.notificationFloorSeq === null
            || initial > session.notificationFloorSeq
            || (pending && pending.size > 0)) {
          throw eventError('initialContiguousSeq 只能用于无缓冲的首次历史基线');
        }
        // 只允许从初始 -1 向前建立一次已取证的尾部基线；已运行过的
        // session 绝不允许借此跳过真实 gap。
        if (session.lastContiguousSeq === -1) {
          // 只有 history 未能证明全前缀时才会使用此基线。缺口与
          // cursor 同一事务持久化；未提供全历史证明前永不清除。
          if (!session.coverageGap) {
            session.coverageGap = true;
            dirty = true;
          }
          if (initial !== -1) {
            session.lastContiguousSeq = initial;
            dirty = true;
          }
        }
      }
      const drained = drainBuffered(sessionKey, effects);
      dirty = drained.dirty || dirty;
      changed = drained.changed || dirty || changed;
      const crossed = budgetEffect(drained.dirty ? sessionRef : null);
      if (crossed) {
        effects.push(crossed);
        dirty = true;
        changed = true;
      }
      return { dirty: prune() || dirty, changed, effects };
    });
  }

  function getCursor(sessionRef) {
    const sessionKey = sessionKeyFor(sessionRef);
    const session = committedState.sessions[sessionKey];
    if (!session) {
      return {
        known: false,
        lastContiguousSeq: -1,
        notificationFloorSeq: null,
        origin: null
      };
    }
    rememberRef(sessionKey, sessionRef);
    return {
      known: true,
      lastContiguousSeq: session.lastContiguousSeq,
      notificationFloorSeq: session.notificationFloorSeq,
      origin: session.origin
    };
  }

  async function ingestMany(inputs, ingestOptions = {}) {
    if (!Array.isArray(inputs)) throw eventError('ingestMany 必须接收数组');
    if (!isPlainObject(ingestOptions)) throw eventError('ingest options 必须是对象');
    if (inputs.length > 50_000) throw eventError('单批事件超过 50000 条上限');
    for (const key of Object.keys(ingestOptions)) {
      if (!['suppressNotifications', 'generation'].includes(key)) {
        throw eventError(`不支持的 ingest option：${key}`);
      }
    }
    const suppressNotifications = ingestOptions.suppressNotifications === true;
    return transaction(async () => {
      assertGeneration(ingestOptions.generation);
      if (availability.state === 'disconnected' || availability.state === 'unavailable') {
        throw eventError('当前连接代不可接收事件', 'ERR_EVENT_GENERATION');
      }
      let dirty = rollBudgetDay();
      let changed = dirty;
      let triggerSessionRef = null;
      const effects = [];
      for (const input of inputs) {
        const event = prepareEvent(input, suppressNotifications);
        const existed = Boolean(state.sessions[event.sessionKey]);
        ensureSession(event.sessionKey);
        if (!existed) dirty = true;
        let outcome;
        if (event.seq === undefined) {
          const eventDirty = applyPrepared(event, effects);
          const drained = event.kind === 'subscribed'
            ? drainBuffered(event.sessionKey, effects)
            : { dirty: false, changed: false };
          outcome = {
            dirty: eventDirty || drained.dirty,
            changed: eventDirty || drained.changed
          };
        } else {
          outcome = processSequenced(event, effects);
        }
        dirty = outcome.dirty || dirty;
        changed = outcome.changed || changed;
        if (event.usage) triggerSessionRef = event.sessionRef;
      }
      const crossed = budgetEffect(triggerSessionRef);
      if (crossed) {
        effects.push(crossed);
        dirty = true;
        changed = true;
      }
      if (prune()) dirty = true;
      return { dirty, changed, effects };
    });
  }

  async function ingest(input, ingestOptions = {}) {
    return ingestMany([input], ingestOptions);
  }

  async function disconnect(generation) {
    return transaction(async () => {
      assertGeneration(generation, true);
      let dirty = false;
      for (const session of Object.values(state.sessions)) {
        if (Object.keys(session.pendingApprovals).length > 0) {
          session.pendingApprovals = {};
          dirty = true;
        }
        if (Object.keys(session.pendingQuestions).length > 0) {
          session.pendingQuestions = {};
          dirty = true;
        }
      }
      availability = { state: 'disconnected', detail: null };
      connectionGeneration += 1;
      generationRequired = true;
      return { dirty, changed: true, effects: [] };
    });
  }

  async function beginConnection() {
    return transaction(async () => {
      let dirty = false;
      for (const session of Object.values(state.sessions)) {
        if (Object.keys(session.pendingApprovals).length > 0) {
          session.pendingApprovals = {};
          dirty = true;
        }
        if (Object.keys(session.pendingQuestions).length > 0) {
          session.pendingQuestions = {};
          dirty = true;
        }
      }
      connectionGeneration += 1;
      generationRequired = true;
      availability = { state: 'probing', detail: null };
      return {
        dirty,
        changed: true,
        effects: [],
        value: connectionGeneration
      };
    });
  }

  async function configure(patch) {
    const next = normalizeConfig(patch, config);
    return transaction(async () => {
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      config = next;
      let dirty = rollBudgetDay();
      const effects = [];
      const crossed = budgetEffect(null);
      if (crossed) {
        effects.push(crossed);
        dirty = true;
      }
      if (prune()) dirty = true;
      return { dirty, changed: changed || dirty, effects };
    });
  }

  async function resumeBudget() {
    return transaction(async () => {
      let dirty = rollBudgetDay();
      const today = currentDate();
      const isPaused = config.budgetEnabled
        && state.budget.pausedDate === today
        && state.budget.resumeDate !== today;
      const effects = [];
      if (isPaused) {
        state.budget.resumeDate = today;
        state.budget.pausedDate = null;
        dirty = true;
        effects.push({
          type: 'budget-resumed',
          date: today,
          requiresExplicitRestart: true,
          sessionRef: null
        });
      }
      return { dirty, changed: dirty, effects };
    });
  }

  async function setAvailability(nextState, detail = null, generation) {
    return transaction(async () => {
      assertGeneration(generation, true);
      if (!AVAILABILITY_STATES.has(nextState)) {
        throw eventError('availability state 不受支持');
      }
      let safeDetail = null;
      if (detail !== null && detail !== undefined) {
        if (typeof detail !== 'string' || !AVAILABILITY_DETAILS.has(detail)) {
          throw eventError('availability detail 必须是批准的原因码');
        }
        safeDetail = detail;
      }
      availability = { state: nextState, detail: safeDetail };
      return {
        dirty: false,
        changed: true,
        effects: [],
        value: { ...availability }
      };
    });
  }

  function snapshot() {
    const sourceState = committedState;
    const sourceBuffers = committedBuffers;
    const sourceConfig = committedConfig;
    const sourceAvailability = committedAvailability;
    const today = calendarDate(new Date(now()), sourceConfig.timeZone);
    const weekStart = mondayFor(today);
    const todayData = aggregate(
      (_entry, day) => day === today,
      sourceState,
      sourceConfig
    );
    const weekData = aggregate(
      (_entry, day) => day >= weekStart && day <= today,
      sourceState,
      sourceConfig
    );
    const gapSessionKeys = new Set();
    for (const [sessionKey, pending] of sourceBuffers.entries()) {
      if (pending.size > 0) gapSessionKeys.add(sessionKey);
    }
    let approvals = 0;
    let questions = 0;
    let baselinePendingSessions = 0;
    let persistentHistoryGap = false;
    // 未结束的 turn 就是「AI 正在干活」；turn-terminal 会删除该条目。
    let openTurns = 0;
    let openSessions = 0;
    for (const [sessionKey, session] of Object.entries(sourceState.sessions)) {
      approvals += Object.keys(session.pendingApprovals).length;
      questions += Object.keys(session.pendingQuestions).length;
      const sessionOpenTurns = Object.keys(session.turns).length;
      if (sessionOpenTurns > 0) { openTurns += sessionOpenTurns; openSessions += 1; }
      if (session.notificationFloorSeq === null) baselinePendingSessions += 1;
      if (session.coverageGap) {
        persistentHistoryGap = true;
        gapSessionKeys.add(sessionKey);
      }
    }
    const gapSessions = gapSessionKeys.size;

    const taskUsage = new Map();
    for (const entry of Object.values(sourceState.usageEntries)) {
      if (!taskUsage.has(entry.taskKey)) taskUsage.set(entry.taskKey, emptyTokens());
      addUsage(taskUsage.get(entry.taskKey), entry);
    }
    const recentTasks = sourceState.recentTasks
      .slice(-sourceConfig.recentTaskLimit)
      .reverse()
      .map((task) => {
        const tokens = taskUsage.get(task.taskKey) || emptyTokens();
        return {
          taskKey: task.taskKey,
          ordinal: task.ordinal,
          label: `任务 ${String(task.ordinal).padStart(2, '0')}`,
          turn: task.turn,
          result: task.result,
          origin: task.origin,
          completedAt: task.completedAt,
          terminalSeq: task.terminalSeq,
          durationMs: task.durationMs,
          tokens: { ...tokens },
          estimatedCost: estimatedCost(tokens, sourceConfig)
        };
      });
    const paused = sourceConfig.budgetEnabled
      && sourceState.budget.pausedDate === today
      && sourceState.budget.resumeDate !== today;
    const historyGap = persistentHistoryGap || sourceAvailability.detail === 'history-gap';
    let coverageStatus = 'unavailable';
    if (gapSessions > 0 || historyGap) coverageStatus = 'gap';
    else if (baselinePendingSessions > 0
        || sourceAvailability.state === 'probing'
        || sourceAvailability.state === 'backfilling') coverageStatus = 'partial';
    else if (sourceAvailability.state === 'live') coverageStatus = 'complete';

    return {
      schemaVersion: SCHEMA_VERSION,
      disclaimer: USAGE_DISCLAIMER,
      availability: { ...sourceAvailability },
      coverage: {
        status: coverageStatus,
        sessions: Object.keys(sourceState.sessions).length,
        gapSessions,
        baselinePendingSessions,
        historyGap
      },
      today: {
        date: today,
        tokens: todayData.tokens,
        origins: todayData.origins,
        estimatedCost: todayData.estimatedCost
      },
      week: {
        startDate: weekStart,
        endDate: today,
        tokens: weekData.tokens,
        origins: weekData.origins,
        estimatedCost: weekData.estimatedCost
      },
      waiting: { approvals, questions },
      activity: { openTurns, openSessions },
      budget: {
        enabled: sourceConfig.budgetEnabled,
        date: today,
        limitTokens: sourceConfig.dailyTokenBudget,
        observedTokens: todayData.tokens.total,
        crossed: sourceState.budget.crossingDate === today,
        paused,
        resumed: sourceState.budget.resumeDate === today
      },
      pricing: {
        inputPerMillion: sourceConfig.priceInputPerMillion,
        cacheReadPerMillion: sourceConfig.priceCacheReadPerMillion,
        outputPerMillion: sourceConfig.priceOutputPerMillion
      },
      recentTasks
    };
  }

  async function flush() {
    return transaction(async () => ({ dirty: false, changed: false, effects: [] }), {
      forcePersist: true
    });
  }

  async function close() {
    if (closed) return [];
    const result = await flush();
    closed = true;
    return result;
  }

  function getSalt() {
    return committedState.salt;
  }

  return {
    ingest,
    ingestMany,
    registerSession,
    getCursor,
    beginConnection,
    setAvailability,
    configure,
    snapshot,
    disconnect,
    resumeBudget,
    flush,
    close,
    getSalt
  };
}

// v0.5 桌面宠物的五态推导：纯函数，渲染层只消费结论。
// transient 由主进程按既有 task-terminal effect 写入并自带过期时间，
// 事件层不可用时固定 idle，绝不用「看起来在忙」冒充真实状态。
const PET_STATES = Object.freeze(['idle', 'busy', 'waiting', 'celebrate', 'error']);

function derivePetState(options = {}) {
  const snapshot = options.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return 'idle';
  const availability = snapshot.availability && typeof snapshot.availability === 'object'
    ? snapshot.availability.state : null;
  if (availability === 'unavailable' || availability === null) return 'idle';

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const transient = options.transient;
  if (transient && typeof transient === 'object'
      && PET_STATES.includes(transient.kind)
      && Number.isFinite(transient.until) && transient.until > now) {
    if (transient.kind === 'error' || transient.kind === 'celebrate') return transient.kind;
  }

  const waiting = snapshot.waiting && typeof snapshot.waiting === 'object' ? snapshot.waiting : {};
  const pending = (Number.isSafeInteger(waiting.approvals) ? waiting.approvals : 0)
    + (Number.isSafeInteger(waiting.questions) ? waiting.questions : 0);
  if (pending > 0) return 'waiting';

  const activity = snapshot.activity && typeof snapshot.activity === 'object'
    ? snapshot.activity : {};
  if (Number.isSafeInteger(activity.openTurns) && activity.openTurns > 0) return 'busy';
  return 'idle';
}

// 把既有终态 effect 翻译成一次性庆祝/出错表现。
function petTransientFor(result, now, durationMs = 2500) {
  const at = Number.isFinite(now) ? now : Date.now();
  if (result === 'completed') return { kind: 'celebrate', until: at + durationMs };
  if (result === 'error' || result === 'aborted') return { kind: 'error', until: at + durationMs };
  return null;
}

module.exports = {
  SCHEMA_VERSION,
  USAGE_DISCLAIMER,
  PET_STATES,
  createEventService,
  derivePetState,
  petTransientFor
};
