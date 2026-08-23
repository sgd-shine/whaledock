'use strict';

// 投递预检与贴卡回执的纯 Node 中性层。
// 本模块只在内存中保留投递所需的敏感引用；所有公开视图均由白名单重建。
const crypto = require('crypto');

const WORKSPACE_MATCHES = new Set(['match', 'mismatch', 'unknown']);
const TRACKING_STATES = new Set(['ready', 'unavailable']);
const DELIVERY_STATES = new Set([
  'submitting', 'queued', 'running', 'waiting',
  'completed', 'error', 'rejected', 'unknown'
]);
const FINAL_STATES = new Set(['completed', 'error', 'rejected']);
const EVICTABLE_STATES = new Set([...FINAL_STATES, 'unknown']);
const UPDATE_EVIDENCE = new Set(['target-activity']);
const UNKNOWN_RECOVERY_STATES = new Set([
  'queued', 'running', 'waiting', 'completed', 'error', 'rejected'
]);
const PULSE_TTL_MS = 30_000;
const DEFAULT_MAX_PREFLIGHTS = 128;
const DEFAULT_MAX_RECEIPTS = 256;
const DEFAULT_PREFLIGHT_TTL_MS = 120_000;
const MAX_CAPACITY = 10_000;
const MAX_PREFLIGHT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FILE_RESULTS = 100;

function flowError(message, code = 'ERR_FLOW_RECEIPT_INPUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertObject(value, name = '输入') {
  if (!isPlainObject(value)) throw flowError(`${name}必须是对象`);
  return value;
}

function boundedString(value, name, maxLength = 4096) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw flowError(`${name}必须是非空且长度受限的字符串`);
  }
  return value;
}

function enumValue(value, allowed, name) {
  if (!allowed.has(value)) throw flowError(`${name}不在允许范围内`);
  return value;
}

function capacity(value, fallback, name) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > MAX_CAPACITY) {
    throw flowError(`${name}必须是 1–${MAX_CAPACITY} 的整数`, 'ERR_FLOW_RECEIPT_CONFIG');
  }
  return selected;
}

function ttl(value) {
  const selected = value === undefined ? DEFAULT_PREFLIGHT_TTL_MS : value;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > MAX_PREFLIGHT_TTL_MS) {
    throw flowError(
      `preflightTtlMs 必须是 1–${MAX_PREFLIGHT_TTL_MS} 的整数`,
      'ERR_FLOW_RECEIPT_CONFIG'
    );
  }
  return selected;
}

function clonePrivate(value, name) {
  if (!isPlainObject(value)) throw flowError(`${name}必须是普通对象`);
  try {
    return structuredClone(value);
  } catch (_error) {
    throw flowError(`${name}必须是可安全复制的数据`);
  }
}

function cloneResult(value) {
  try {
    return structuredClone(value);
  } catch (_error) {
    throw flowError('fileResults 必须是可安全复制的数据');
  }
}

function parseTime(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) throw flowError(`${name}必须是有效时间`);
  return milliseconds;
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function trackingText(tracking) {
  return tracking === 'ready'
    ? '可跟踪目标会话活动'
    : '任务事件不可用，无法自动跟踪';
}

function statusText(status, tracking) {
  if (tracking === 'unavailable') {
    switch (status) {
      case 'submitting':
        return '正在提交；任务事件不可用，后续请到目标会话确认';
      case 'queued':
        return '已提交；任务事件不可用，无法自动确认进度';
      case 'running':
        return '已记录为处理中；任务事件不可用，后续请到目标会话确认';
      case 'waiting':
        return '已记录为等待中；任务事件不可用，后续请到目标会话确认';
      case 'completed':
        return '已确认完成';
      case 'error':
        return '已确认执行出错';
      case 'rejected':
        return '投递已被拒绝';
      case 'unknown':
        return '投递结果未知；任务事件不可用，请到目标会话确认';
      default:
        return '任务事件不可用，请到目标会话确认';
    }
  }
  switch (status) {
    case 'submitting': return '正在提交';
    case 'queued': return '已进入目标会话队列';
    case 'running': return '目标会话处理中';
    case 'waiting': return '目标会话等待处理';
    case 'completed': return '目标会话已完成';
    case 'error': return '目标会话执行出错';
    case 'rejected': return '投递已被拒绝';
    case 'unknown': return '投递结果未知，请到目标会话确认';
    default: return '投递状态未知';
  }
}

function canAdvanceStatus(current, next, evidence) {
  if (current === next) return true;
  if (FINAL_STATES.has(current)) return false;
  if (current === 'unknown') {
    return evidence === 'target-activity' && UNKNOWN_RECOVERY_STATES.has(next);
  }
  if (FINAL_STATES.has(next) || next === 'unknown') return true;
  if (current === 'submitting') return ['queued', 'running', 'waiting'].includes(next);
  if (current === 'queued') return ['running', 'waiting'].includes(next);
  if (current === 'running') return next === 'waiting';
  if (current === 'waiting') return next === 'running';
  return false;
}

function createFlowReceiptService(options = {}) {
  assertObject(options, '回执服务配置');
  const nowImpl = options.now === undefined ? () => new Date() : options.now;
  const mintTokenImpl = options.mintToken === undefined
    ? () => crypto.randomUUID()
    : options.mintToken;
  if (typeof nowImpl !== 'function') {
    throw flowError('now 必须是函数', 'ERR_FLOW_RECEIPT_CONFIG');
  }
  if (typeof mintTokenImpl !== 'function') {
    throw flowError('mintToken 必须是函数', 'ERR_FLOW_RECEIPT_CONFIG');
  }

  const maxPreflights = capacity(
    options.maxPreflights,
    DEFAULT_MAX_PREFLIGHTS,
    'maxPreflights'
  );
  const maxReceipts = capacity(options.maxReceipts, DEFAULT_MAX_RECEIPTS, 'maxReceipts');
  const preflightTtlMs = ttl(options.preflightTtlMs);
  const preflights = new Map();
  const receipts = new Map();
  const resultTokens = new Map();
  let ordinal = 0;

  function readNow() {
    let value;
    try {
      value = nowImpl();
    } catch (_error) {
      throw flowError('now 读取失败', 'ERR_FLOW_RECEIPT_CONFIG');
    }
    return parseTime(value, 'now');
  }

  function tokenExists(token) {
    if (preflights.has(token) || receipts.has(token) || resultTokens.has(token)) return true;
    for (const receipt of receipts.values()) {
      if (receipt.pulse && receipt.pulse.id === token) return true;
    }
    return false;
  }

  function issueToken(kind) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let value;
      try {
        value = mintTokenImpl(kind);
      } catch (_error) {
        throw flowError('mintToken 生成失败', 'ERR_FLOW_RECEIPT_CONFIG');
      }
      if (typeof value !== 'string' || value.length < 8 || value.length > 256
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
        throw flowError('mintToken 必须生成安全、非空且长度受限的令牌', 'ERR_FLOW_RECEIPT_CONFIG');
      }
      if (!tokenExists(value)) return value;
    }
    throw flowError('mintToken 连续生成重复令牌', 'ERR_FLOW_RECEIPT_CONFIG');
  }

  function pruneExpiredPreflights(currentMs) {
    for (const [token, entry] of preflights.entries()) {
      if (currentMs >= entry.expiresMs) preflights.delete(token);
    }
  }

  function evictOldestPreflight() {
    let selected = null;
    for (const entry of preflights.values()) {
      if (!selected || entry.ordinal < selected.ordinal) selected = entry;
    }
    if (selected) preflights.delete(selected.token);
  }

  function dropReceipt(entry) {
    receipts.delete(entry.receiptId);
    if (entry.resultToken) resultTokens.delete(entry.resultToken);
  }

  function evictReceipt() {
    let selected = null;
    for (const entry of receipts.values()) {
      if (!selected) {
        selected = entry;
        continue;
      }
      const entryTerminal = EVICTABLE_STATES.has(entry.status);
      const selectedTerminal = EVICTABLE_STATES.has(selected.status);
      if ((entryTerminal && !selectedTerminal)
          || (entryTerminal === selectedTerminal && entry.ordinal < selected.ordinal)) {
        selected = entry;
      }
    }
    if (selected) dropReceipt(selected);
  }

  function publicPreflight(entry) {
    return {
      preflightToken: entry.token,
      targetLabel: entry.targetLabel,
      workspaceLabel: entry.workspaceLabel,
      workspaceMatch: entry.workspaceMatch,
      targetRunning: entry.targetRunning,
      eventTracking: entry.eventTracking,
      expiresAt: iso(entry.expiresMs)
    };
  }

  function activePulse(entry, currentMs) {
    if (!entry.pulse) return null;
    if (currentMs - entry.pulse.atMs >= PULSE_TTL_MS) {
      entry.pulse = null;
      return null;
    }
    return entry.pulse;
  }

  function publicReceipt(entry, currentMs) {
    const endMs = entry.terminalMs === null ? currentMs : entry.terminalMs;
    const elapsedMs = Math.max(0, endMs - entry.createdMs);
    const view = {
      receiptId: entry.receiptId,
      anchorRef: entry.anchorRef,
      targetLabel: entry.targetLabel,
      tracking: entry.tracking,
      trackingText: trackingText(entry.tracking),
      expectedStage: entry.expectedStage,
      status: entry.status,
      statusText: statusText(entry.status, entry.tracking),
      createdAt: iso(entry.createdMs),
      updatedAt: iso(entry.updatedMs),
      terminalAt: entry.terminalMs === null ? null : iso(entry.terminalMs),
      elapsedMs,
      durationMs: entry.terminalMs === null ? null : elapsedMs,
      resultCount: entry.resultCount
    };
    if (entry.resultCount === 1 && entry.resultToken) view.resultToken = entry.resultToken;
    const pulse = activePulse(entry, currentMs);
    if (pulse) {
      view.pulseAt = iso(pulse.atMs);
      view.pulseId = pulse.id;
    }
    return view;
  }

  function createPreflight(input) {
    assertObject(input, '预检输入');
    const prepared = {
      owner: boundedString(input.owner, 'owner'),
      actionFingerprint: boundedString(input.actionFingerprint, 'actionFingerprint'),
      targetToken: boundedString(input.targetToken, 'targetToken'),
      sessionRef: boundedString(input.sessionRef, 'sessionRef'),
      cwdFacts: clonePrivate(input.cwdFacts, 'cwdFacts'),
      context: clonePrivate(input.context, 'context'),
      targetLabel: boundedString(input.targetLabel, 'targetLabel', 256),
      workspaceLabel: boundedString(input.workspaceLabel, 'workspaceLabel', 256),
      workspaceMatch: enumValue(input.workspaceMatch, WORKSPACE_MATCHES, 'workspaceMatch'),
      targetRunning: input.targetRunning,
      eventTracking: enumValue(input.eventTracking, TRACKING_STATES, 'eventTracking')
    };
    if (typeof prepared.targetRunning !== 'boolean') {
      throw flowError('targetRunning 必须是布尔值');
    }
    const currentMs = readNow();
    pruneExpiredPreflights(currentMs);
    const token = issueToken('preflight');
    while (preflights.size >= maxPreflights) evictOldestPreflight();

    const entry = {
      token,
      ...prepared,
      createdMs: currentMs,
      expiresMs: currentMs + preflightTtlMs,
      ordinal: ++ordinal
    };
    preflights.set(entry.token, entry);
    return publicPreflight(entry);
  }

  function consumePreflight(input) {
    assertObject(input, '预检消费输入');
    const token = boundedString(input.preflightToken, 'preflightToken', 256);
    const entry = preflights.get(token);
    if (!entry) return { accepted: false, reason: 'not-found' };

    // 首次消费尝试即撤销令牌：不允许更换 owner、动作或 override 后重放。
    preflights.delete(token);
    const currentMs = readNow();
    if (currentMs >= entry.expiresMs) return { accepted: false, reason: 'expired' };
    if (input.owner !== entry.owner) return { accepted: false, reason: 'owner-mismatch' };
    if (input.actionFingerprint !== entry.actionFingerprint) {
      return { accepted: false, reason: 'action-mismatch' };
    }

    const overrideUsed = input.override === true;
    if (entry.workspaceMatch !== 'match' && !overrideUsed) {
      return { accepted: false, reason: `workspace-${entry.workspaceMatch}` };
    }
    return {
      accepted: true,
      reason: entry.workspaceMatch === 'match' ? 'workspace-match' : 'workspace-override',
      overrideUsed,
      delivery: {
        targetToken: entry.targetToken,
        sessionRef: entry.sessionRef,
        cwdFacts: clonePrivate(entry.cwdFacts, 'cwdFacts'),
        context: clonePrivate(entry.context, 'context'),
        targetLabel: entry.targetLabel,
        workspaceLabel: entry.workspaceLabel,
        workspaceMatch: entry.workspaceMatch,
        targetRunning: entry.targetRunning,
        eventTracking: entry.eventTracking
      }
    };
  }

  function createReceipt(input) {
    assertObject(input, '回执输入');
    const prepared = {
      owner: boundedString(input.owner, 'owner'),
      anchorRef: boundedString(input.anchorRef, 'anchorRef', 256),
      deliveryRef: boundedString(input.deliveryRef, 'deliveryRef'),
      targetLabel: boundedString(input.targetLabel, 'targetLabel', 256),
      tracking: enumValue(input.tracking, TRACKING_STATES, 'tracking'),
      expectedStage: boundedString(input.expectedStage, 'expectedStage', 256)
    };
    const currentMs = readNow();
    const receiptId = issueToken('receipt');
    while (receipts.size >= maxReceipts) evictReceipt();
    const entry = {
      receiptId,
      ...prepared,
      status: 'submitting',
      createdMs: currentMs,
      updatedMs: currentMs,
      terminalMs: null,
      resultCount: 0,
      resultToken: null,
      results: [],
      terminalResultSupplemented: false,
      pulse: null,
      ordinal: ++ordinal
    };
    receipts.set(receiptId, entry);
    // 返回创建视图就是首次 baseline，因此这一次不产生“刚更新”脉冲。
    return publicReceipt(entry, currentMs);
  }

  function findOwnedReceipt(owner, receiptId) {
    const entry = receipts.get(receiptId);
    if (!entry || entry.owner !== owner) {
      throw flowError('回执不存在或不属于当前 owner', 'ERR_FLOW_RECEIPT_NOT_FOUND');
    }
    return entry;
  }

  function normalizeFileResults(value) {
    if (!Array.isArray(value) || value.length > MAX_FILE_RESULTS) {
      throw flowError(`fileResults 必须是最多 ${MAX_FILE_RESULTS} 项的数组`);
    }
    return value.map(cloneResult);
  }

  function replaceFileResults(entry, nextResults) {
    if (entry.resultToken) resultTokens.delete(entry.resultToken);
    entry.results = nextResults;
    entry.resultCount = nextResults.length;
    entry.resultToken = null;
    if (nextResults.length === 1) {
      entry.resultToken = issueToken('result');
      resultTokens.set(entry.resultToken, {
        owner: entry.owner,
        receiptId: entry.receiptId,
        value: cloneResult(nextResults[0])
      });
    }
  }

  function updateReceipt(input) {
    assertObject(input, '回执更新输入');
    const owner = boundedString(input.owner, 'owner');
    const receiptId = boundedString(input.receiptId, 'receiptId', 256);
    if (input.status !== undefined && input.state !== undefined && input.status !== input.state) {
      throw flowError('status 与 state 不得冲突');
    }
    const requestedStatus = input.status === undefined ? input.state : input.status;
    const nextStatus = requestedStatus === undefined
      ? null
      : enumValue(requestedStatus, DELIVERY_STATES, 'status');
    const nextTracking = input.tracking === undefined
      ? null
      : enumValue(input.tracking, TRACKING_STATES, 'tracking');
    const evidence = input.evidence === undefined
      ? null
      : enumValue(input.evidence, UPDATE_EVIDENCE, 'evidence');
    const hasFileResults = Object.hasOwn(input, 'fileResults');
    const nextResults = hasFileResults ? normalizeFileResults(input.fileResults) : null;
    const entry = findOwnedReceipt(owner, receiptId);
    const currentMs = readNow();
    const observedMs = input.at === undefined ? currentMs : parseTime(input.at, 'at');

    if (observedMs < entry.updatedMs) {
      return publicReceipt(entry, currentMs);
    }

    if (FINAL_STATES.has(entry.status)) {
      const maySupplementCompletedResult = entry.status === 'completed'
        && (nextStatus === null || nextStatus === 'completed')
        && hasFileResults
        && nextResults.length > 0
        && !entry.terminalResultSupplemented
        && entry.resultCount === 0;
      if (!maySupplementCompletedResult) return publicReceipt(entry, currentMs);

      // watcher 可能在 completed 事件之后才观测到落盘文件。
      // 只允许给这一个已完成回执补一次非空结果，不改写终态时间。
      replaceFileResults(entry, nextResults);
      entry.terminalResultSupplemented = true;
      entry.updatedMs = observedMs;
      entry.pulse = { id: issueToken('pulse'), atMs: currentMs };
      return publicReceipt(entry, currentMs);
    }

    if (entry.status === 'unknown'
        && (nextStatus === null || !canAdvanceStatus(entry.status, nextStatus, evidence))) {
      return publicReceipt(entry, currentMs);
    }

    if (nextStatus !== null && nextStatus !== entry.status
        && !canAdvanceStatus(entry.status, nextStatus, evidence)) {
      return publicReceipt(entry, currentMs);
    }

    const statusChanged = nextStatus !== null && nextStatus !== entry.status;
    const trackingChanged = nextTracking !== null && nextTracking !== entry.tracking;
    const changed = statusChanged || trackingChanged || hasFileResults;
    if (!changed) return publicReceipt(entry, currentMs);

    if (statusChanged) entry.status = nextStatus;
    if (trackingChanged) entry.tracking = nextTracking;
    if (hasFileResults) replaceFileResults(entry, nextResults);
    entry.updatedMs = observedMs;
    if (FINAL_STATES.has(entry.status) || entry.status === 'unknown') {
      entry.terminalMs = observedMs;
      if (entry.status === 'completed' && entry.resultCount > 0) {
        entry.terminalResultSupplemented = true;
      }
    } else if (statusChanged) {
      // unknown 被后续精确会话活动纠正后，恢复为可跟踪的非终态。
      entry.terminalMs = null;
    }
    entry.pulse = { id: issueToken('pulse'), atMs: currentMs };
    return publicReceipt(entry, currentMs);
  }

  function updateByDeliveryRef(input) {
    assertObject(input, '投递引用更新输入');
    const owner = boundedString(input.owner, 'owner');
    const deliveryRef = boundedString(input.deliveryRef, 'deliveryRef');
    const updates = [];
    for (const entry of receipts.values()) {
      if (entry.owner !== owner || entry.deliveryRef !== deliveryRef) continue;
      const next = { ...input, receiptId: entry.receiptId };
      delete next.deliveryRef;
      updates.push(updateReceipt(next));
    }
    return updates;
  }

  function snapshot(input) {
    assertObject(input, '回执快照输入');
    const owner = boundedString(input.owner, 'owner');
    const anchorRef = input.anchorRef === undefined
      ? null
      : boundedString(input.anchorRef, 'anchorRef', 256);
    const currentMs = readNow();
    const selected = [];
    for (const entry of receipts.values()) {
      if (entry.owner !== owner || (anchorRef !== null && entry.anchorRef !== anchorRef)) continue;
      selected.push(entry);
    }
    selected.sort((a, b) => b.ordinal - a.ordinal);
    return { receipts: selected.map((entry) => publicReceipt(entry, currentMs)) };
  }

  function ackPulse(input) {
    assertObject(input, '脉冲确认输入');
    const owner = boundedString(input.owner, 'owner');
    const receiptId = boundedString(input.receiptId, 'receiptId', 256);
    const pulseId = boundedString(input.pulseId, 'pulseId', 256);
    const entry = receipts.get(receiptId);
    if (!entry || entry.owner !== owner) return false;
    const pulse = activePulse(entry, readNow());
    if (!pulse || pulse.id !== pulseId) return false;
    entry.pulse = null;
    return true;
  }

  function resolveResult(input) {
    assertObject(input, '结果解析输入');
    const owner = boundedString(input.owner, 'owner');
    const resultToken = boundedString(input.resultToken, 'resultToken', 256);
    const entry = resultTokens.get(resultToken);
    if (!entry || entry.owner !== owner || !receipts.has(entry.receiptId)) return null;
    return cloneResult(entry.value);
  }

  function prune() {
    pruneExpiredPreflights(readNow());
    while (preflights.size > maxPreflights) evictOldestPreflight();
    while (receipts.size > maxReceipts) evictReceipt();
    return { preflights: preflights.size, receipts: receipts.size };
  }

  return Object.freeze({
    createPreflight,
    consumePreflight,
    createReceipt,
    updateReceipt,
    updateByDeliveryRef,
    snapshot,
    ackPulse,
    resolveResult,
    prune
  });
}

module.exports = {
  createFlowReceiptService,
  DELIVERY_STATES: Object.freeze([...DELIVERY_STATES]),
  PULSE_TTL_MS
};
