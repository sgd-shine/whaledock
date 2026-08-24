'use strict';

// WhaleDock 上下文桥的纯 Node 契约内核。
// 这里只做验证、稳定标识、revision/ACK 与 turn freeze；不碰 fs/http/Electron/dsh。
const crypto = require('crypto');

const CONTRACT_VERSION = 'whaledock.context-bridge/v1';
const FEATURE_ENV = 'WHALEDOCK_CONTEXT_POC';
const CAPABILITIES = Object.freeze([
  'per-session-revision',
  'turn-freeze',
  'revision-ack',
  'delivery-proof'
]);
const LIMITS = Object.freeze({
  maxWorkspaceBytes: 4096,
  maxRelativePathBytes: 2048,
  maxContextBytes: 4096,
  maxTitleChars: 120,
  maxWorkbenchIdChars: 96,
  maxInstanceIdChars: 128,
  maxSessionRefChars: 128,
  maxReasonChars: 64,
  maxCapabilities: 16,
  maxSessions: 64
});

const REASON_CODES = Object.freeze([
  'feature-disabled',
  'not-connected',
  'handshake-invalid',
  'protocol-mismatch',
  'bridge-disconnected',
  'external-unproven',
  'unsupported-version',
  'bridge-unavailable',
  'bridge-not-ready',
  'bridge-degraded',
  'ack-protocol-mismatch',
  'ack-instance-mismatch',
  'ack-unknown-revision',
  'ack-future-revision',
  'ack-broke-turn-freeze',
  'delivery-protocol-mismatch',
  'delivery-instance-mismatch',
  'delivery-fence-mismatch',
  'host-rejected',
  'context-invalid',
  'revision-conflict',
  'session-unavailable',
  'context-not-effective',
  'turn-open',
  'turn-stale',
  'turn-fence-lost',
  'awaiting-delivery',
  'awaiting-ack',
  'invalid-snapshot'
]);
const REASON_CODE_SET = new Set(REASON_CODES);
const HOST_REJECTION_CODE_SET = new Set([
  'host-rejected',
  'context-invalid',
  'revision-conflict',
  'session-unavailable'
]);

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const WORKBENCH_ID_RE = /^(?:builtin|user):[A-Za-z0-9][A-Za-z0-9._-]{0,87}$/;
const PROJECT_REVISION_RE = /^[a-f0-9]{64}$/;
const PROJECT_ID_RE = /^wdp1_[a-f0-9]{32}$/;
const SESSION_REF_RE = /^session-[a-f0-9]{64}$/;
const INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REASON_RE = /^[a-z][a-z0-9-]{0,63}$/;

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contractError(field, message) {
  const error = new Error(message);
  error.code = 'ERR_CONTEXT_BRIDGE_CONTRACT';
  error.field = field;
  return error;
}

function exactKeys(value, required, optional, label) {
  if (!plainRecord(value)) throw contractError(label, `${label} 必须是普通对象`);
  const requiredSet = new Set(required);
  const allowed = new Set([...required, ...optional]);
  for (const key of requiredSet) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw contractError(`${label}.${key}`, `${label} 缺少 ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw contractError(`${label}.${key}`, `${label} 含未知字段 ${key}`);
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (plainRecord(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = clone(item);
    return result;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(clone(value));
}

function validInstanceId(value, field) {
  if (typeof value !== 'string' || value.length > LIMITS.maxInstanceIdChars
      || !INSTANCE_ID_RE.test(value)) {
    throw contractError(field, `${field} 不是合法 instance id`);
  }
  return value;
}

function validSessionRef(value, field = 'sessionRef') {
  if (typeof value !== 'string' || value.length > LIMITS.maxSessionRefChars
      || !SESSION_REF_RE.test(value)) {
    throw contractError(field, `${field} 必须是 WhaleDock opaque session ref`);
  }
  return value;
}

function validReason(value, field = 'reason') {
  if (typeof value !== 'string' || value.length > LIMITS.maxReasonChars
      || !REASON_RE.test(value) || !REASON_CODE_SET.has(value)) {
    throw contractError(field, `${field} 不是有限 reason code`);
  }
  return value;
}

function safeHostReason(value) {
  return typeof value === 'string' && value.length <= LIMITS.maxReasonChars
    && HOST_REJECTION_CODE_SET.has(value) ? value : 'host-rejected';
}

function validRevision(value, field = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw contractError(field, `${field} 必须是正安全整数`);
  }
  return value;
}

function isContextPocEnabled(env = process.env) {
  return Boolean(env) && typeof env === 'object' && !Array.isArray(env)
    && env[FEATURE_ENV] === '1';
}

function normalizeWorkspaceKey(value) {
  if (typeof value !== 'string' || !value || CONTROL_RE.test(value)
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxWorkspaceBytes) {
    throw contractError('workspaceKey', 'workspaceKey 必须是有限 canonical 绝对路径 key');
  }
  const absolute = value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith('\\\\');
  if (!absolute) throw contractError('workspaceKey', 'workspaceKey 必须是绝对路径 key');
  let normalized = value.replace(/\\/g, '/');
  while (normalized.length > 1 && normalized.endsWith('/')
      && !/^[A-Za-z]:\/$/.test(normalized)) normalized = normalized.slice(0, -1);
  return normalized;
}

function normalizeRelativePath(value) {
  if (value == null || value === '' || value === '.') return '.';
  if (typeof value !== 'string' || CONTROL_RE.test(value)
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxRelativePathBytes) {
    throw contractError('relativePath', 'relativePath 必须是有限工作区相对路径');
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('//')
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) {
    throw contractError('relativePath', 'relativePath 不得是绝对路径');
  }
  const segments = normalized.split('/');
  if (!segments.length || segments.some((part) => !part || part === '.' || part === '..')) {
    throw contractError('relativePath', 'relativePath 不得包含空段、. 或 ..');
  }
  return segments.join('/');
}

function deriveProjectId(input) {
  exactKeys(input, ['workspaceKey'], ['relativePath'], 'projectIdentity');
  const workspaceKey = normalizeWorkspaceKey(input.workspaceKey);
  const relativePath = normalizeRelativePath(input.relativePath);
  // 这是路径派生身份：同一 canonical 位置稳定；移动/重命名后的 relocation 不保证同一。
  const digest = crypto.createHash('sha256')
    .update(`whaledock-project/v1\0${workspaceKey}\0${relativePath}`)
    .digest('hex');
  return `wdp1_${digest.slice(0, 32)}`;
}

function normalizeWorkbenchId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > LIMITS.maxWorkbenchIdChars
      || !WORKBENCH_ID_RE.test(value)) {
    throw contractError('workbenchId', 'workbenchId 不是有限 WhaleDock 工作台标识');
  }
  return value;
}

function normalizeTitle(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || CONTROL_RE.test(value)) {
    throw contractError('title', 'title 必须是有限单行文本');
  }
  const normalized = value.replace(/ +/g, ' ').trim();
  if (!normalized || [...normalized].length > LIMITS.maxTitleChars) {
    throw contractError('title', `title 必须是 1–${LIMITS.maxTitleChars} 字符`);
  }
  return normalized;
}

function normalizeProjectRevision(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !PROJECT_REVISION_RE.test(value)) {
    throw contractError('projectRevision', 'projectRevision 必须是 64 位小写 SHA-256');
  }
  return value;
}

function normalizeProjectContext(input) {
  exactKeys(
    input,
    ['workspaceKey'],
    ['relativePath', 'workbenchId', 'title', 'projectRevision'],
    'project'
  );
  const relativePath = normalizeRelativePath(input.relativePath);
  const normalized = {
    projectId: deriveProjectId({ workspaceKey: input.workspaceKey, relativePath }),
    relativePath,
    workbenchId: normalizeWorkbenchId(input.workbenchId),
    title: normalizeTitle(input.title),
    projectRevision: normalizeProjectRevision(input.projectRevision)
  };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > LIMITS.maxContextBytes) {
    throw contractError('project', '规范化项目上下文超过字节上限');
  }
  return immutable(normalized);
}

function projectDigest(project) {
  return crypto.createHash('sha256').update(JSON.stringify(project)).digest('hex');
}

function createContextBridgeState(options = {}) {
  exactKeys(options, [], ['enabled', 'clientInstanceId'], 'options');
  const enabled = options.enabled === true;
  if (options.enabled !== undefined && typeof options.enabled !== 'boolean') {
    throw contractError('options.enabled', 'enabled 必须是布尔值');
  }
  const clientInstanceId = options.clientInstanceId === undefined
    ? `client-${crypto.randomUUID()}`
    : validInstanceId(options.clientInstanceId, 'clientInstanceId');
  const sessions = new Map();
  let connection = enabled
    ? { state: 'disconnected', reason: 'not-connected' }
    : { state: 'disabled', reason: 'feature-disabled' };

  function sessionRecord(sessionRef, create = false) {
    let record = sessions.get(sessionRef);
    if (!record && create) {
      if (sessions.size >= LIMITS.maxSessions) {
        throw contractError('sessionRef', 'context bridge session 容量已满');
      }
      record = {
        sessionRef,
        desiredRevision: null,
        desiredDigest: null,
        project: null,
        sentRevision: null,
        sentProject: null,
        ackedRevision: null,
        ackedState: null,
        effectiveRevision: null,
        effectiveProject: null,
        deliveredRevision: null,
        deliveredProject: null,
        deliveredTurn: null,
        pendingRevision: null,
        openTurn: null,
        lastTurn: null,
        endedTurn: null,
        frozenRevision: null,
        frozenProject: null,
        turnFenceLost: false,
        lastError: null
      };
      sessions.set(sessionRef, record);
    }
    return record || null;
  }

  function sessionSnapshot(record) {
    if (!record) return null;
    let state = 'empty';
    if (record.lastError) state = 'degraded';
    else if (record.openTurn !== null && record.frozenRevision !== null
        && record.deliveredRevision === record.frozenRevision
        && record.deliveredTurn === record.openTurn) state = 'delivered';
    else if (record.openTurn !== null && record.frozenRevision !== null) state = 'awaiting-delivery';
    else if (record.openTurn !== null) state = 'frozen';
    else if (record.pendingRevision !== null
        && record.pendingRevision !== record.effectiveRevision) state = 'queued';
    else if (record.effectiveRevision !== null
        && record.deliveredRevision === record.effectiveRevision) state = 'delivered';
    else if (record.effectiveRevision !== null) state = 'effective';
    return immutable({
      sessionRef: record.sessionRef,
      state,
      project: record.project,
      desiredRevision: record.desiredRevision,
      sentRevision: record.sentRevision,
      sentProject: record.sentProject,
      ackedRevision: record.ackedRevision,
      ackedState: record.ackedState,
      effectiveRevision: record.effectiveRevision,
      effectiveProject: record.effectiveProject,
      deliveredRevision: record.deliveredRevision,
      deliveredProject: record.deliveredProject,
      deliveredTurn: record.deliveredTurn,
      pendingRevision: record.pendingRevision,
      openTurn: record.openTurn,
      lastTurn: record.lastTurn,
      endedTurn: record.endedTurn,
      frozenRevision: record.frozenRevision,
      frozenProject: record.frozenProject,
      turnFenceLost: record.turnFenceLost,
      lastError: record.lastError
    });
  }

  function snapshot(sessionRef) {
    if (sessionRef !== undefined) validSessionRef(sessionRef);
    const result = {
      contract: CONTRACT_VERSION,
      enabled,
      connection: connection.state === 'ready'
        ? {
          state: 'ready',
          reason: null,
          hostInstanceId: connection.hostInstanceId
        }
        : {
          state: connection.state === 'suspended' ? 'disconnected' : connection.state,
          reason: connection.reason
        },
      sessionCount: sessions.size
    };
    if (sessionRef !== undefined) result.session = sessionSnapshot(sessionRecord(sessionRef));
    return immutable(result);
  }

  function soleSessionRef() {
    return sessions.size === 1 ? sessions.keys().next().value : undefined;
  }

  function result(kind, effects, sessionRef, reason) {
    const output = {
      kind,
      effects: immutable(effects || []),
      snapshot: snapshot(sessionRef)
    };
    if (reason !== undefined) output.reason = reason;
    return immutable(output);
  }

  function clearRemoteProofs() {
    for (const record of sessions.values()) {
      record.sentRevision = null;
      record.sentProject = null;
      record.ackedRevision = null;
      record.ackedState = null;
      record.effectiveRevision = null;
      record.effectiveProject = null;
      record.deliveredRevision = null;
      record.deliveredProject = null;
      record.deliveredTurn = null;
      record.pendingRevision = record.desiredRevision;
      record.frozenRevision = record.openTurn === null ? null : record.frozenRevision;
      record.frozenProject = record.openTurn === null ? null : record.frozenProject;
      record.turnFenceLost = record.openTurn !== null;
      record.lastError = record.turnFenceLost ? 'turn-fence-lost' : null;
    }
  }

  function stageEffect(record, force = false) {
    if (connection.state !== 'ready' || record.openTurn !== null || !record.project) return null;
    if (!force && record.sentRevision !== null
        && record.desiredRevision <= record.sentRevision) return null;
    record.sentRevision = record.desiredRevision;
    record.sentProject = record.project;
    record.ackedRevision = null;
    record.ackedState = null;
    return immutable({
      type: 'context-stage',
      envelope: {
        contract: CONTRACT_VERSION,
        clientInstanceId,
        hostInstanceId: connection.hostInstanceId,
        sessionRef: record.sessionRef,
        revision: record.desiredRevision,
        project: record.project
      }
    });
  }

  function connect(handshake) {
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    if (!plainRecord(handshake)) {
      connection = { state: 'degraded', reason: 'handshake-invalid' };
      clearRemoteProofs();
      return result('degraded', [], soleSessionRef(), 'handshake-invalid');
    }
    if (handshake.contract !== CONTRACT_VERSION) {
      connection = { state: 'degraded', reason: 'protocol-mismatch' };
      clearRemoteProofs();
      return result('degraded', [], soleSessionRef(), 'protocol-mismatch');
    }
    try {
      exactKeys(handshake, ['contract', 'hostInstanceId', 'capabilities'], [], 'handshake');
      validInstanceId(handshake.hostInstanceId, 'hostInstanceId');
      if (!Array.isArray(handshake.capabilities)
          || handshake.capabilities.length > LIMITS.maxCapabilities
          || new Set(handshake.capabilities).size !== handshake.capabilities.length
          || handshake.capabilities.some((item) => (
            typeof item !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item)
          ))
          || CAPABILITIES.some((item) => !handshake.capabilities.includes(item))) {
        throw contractError('handshake.capabilities', 'handshake 缺少必须能力');
      }
    } catch (_error) {
      connection = { state: 'degraded', reason: 'handshake-invalid' };
      clearRemoteProofs();
      return result('degraded', [], soleSessionRef(), 'handshake-invalid');
    }
    if (connection.state === 'ready'
        && connection.hostInstanceId === handshake.hostInstanceId) {
      return result('noop', [], soleSessionRef());
    }
    if (connection.state === 'suspended'
        && connection.hostInstanceId === handshake.hostInstanceId) {
      connection = {
        state: 'ready',
        reason: null,
        hostInstanceId: handshake.hostInstanceId
      };
      const effects = [];
      for (const record of sessions.values()) {
        if (record.openTurn === null && record.pendingRevision !== null
            && record.pendingRevision !== record.effectiveRevision) {
          const effect = stageEffect(record, true);
          if (effect) effects.push(effect);
        }
      }
      return result('connected', effects, soleSessionRef());
    }
    clearRemoteProofs();
    connection = {
      state: 'ready',
      reason: null,
      hostInstanceId: handshake.hostInstanceId
    };
    const effects = [];
    for (const record of sessions.values()) {
      const effect = stageEffect(record);
      if (effect) effects.push(effect);
    }
    return result('connected', effects, soleSessionRef());
  }

  function disconnect(reason = 'bridge-disconnected') {
    validReason(reason);
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    connection = { state: 'degraded', reason };
    clearRemoteProofs();
    return result('disconnected', [], soleSessionRef(), reason);
  }

  function suspend(reason = 'bridge-disconnected') {
    validReason(reason);
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    if (connection.state === 'suspended') {
      connection.reason = reason;
      return result('noop', [], soleSessionRef(), reason);
    }
    if (connection.state !== 'ready') {
      return result('ignored-stale', [], soleSessionRef(), reason);
    }
    connection = {
      state: 'suspended',
      reason,
      hostInstanceId: connection.hostInstanceId
    };
    // 同一 Host 的 journal 仍是权威事实：不清 effective、openTurn、frozen 或
    // delivery。重连确认 Host 身份后，只重试尚未 effective 的 idle stage。
    return result('suspended', [], soleSessionRef(), reason);
  }

  function stage(input) {
    exactKeys(input, ['sessionRef', 'project'], [], 'stage');
    const sessionRef = validSessionRef(input.sessionRef);
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    const project = normalizeProjectContext(input.project);
    const digest = projectDigest(project);
    const record = sessionRecord(sessionRef, true);
    if (record.desiredDigest === digest) return result('noop', [], sessionRef);
    const previous = record.desiredRevision || 0;
    if (previous >= Number.MAX_SAFE_INTEGER) {
      throw contractError('revision', 'session revision 已耗尽，拒绝回绕');
    }
    record.desiredRevision = previous + 1;
    record.desiredDigest = digest;
    record.project = project;
    record.pendingRevision = record.desiredRevision;
    if (!record.turnFenceLost) record.lastError = null;
    const effect = stageEffect(record);
    return result('queued', effect ? [effect] : [], sessionRef);
  }

  function validateTurnInput(input, label) {
    exactKeys(input, ['sessionRef', 'turn'], [], label);
    return {
      sessionRef: validSessionRef(input.sessionRef),
      turn: validRevision(input.turn, `${label}.turn`)
    };
  }

  function observeTurnStart(input) {
    const { sessionRef, turn } = validateTurnInput(input, 'turnStart');
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    const record = sessionRecord(sessionRef);
    if (!record) return result('blocked', [], sessionRef, 'context-not-effective');
    if (record.openTurn === turn) return result('noop', [], sessionRef);
    if (record.openTurn !== null) {
      throw contractError('turnStart.turn', '同一 session 已有未结束 turn');
    }
    if (record.lastTurn !== null && turn <= record.lastTurn) {
      return result('ignored-stale', [], sessionRef, 'turn-stale');
    }
    if (connection.state !== 'ready' || record.desiredRevision === null
        || record.effectiveRevision !== record.desiredRevision
        || record.pendingRevision !== null || !record.effectiveProject) {
      return result('blocked', [], sessionRef, 'context-not-effective');
    }
    record.deliveredRevision = null;
    record.deliveredProject = null;
    record.deliveredTurn = null;
    record.openTurn = turn;
    record.frozenRevision = record.effectiveRevision;
    record.frozenProject = record.effectiveProject;
    record.lastTurn = turn;
    record.turnFenceLost = false;
    record.lastError = null;
    return result('turn-started', [], sessionRef);
  }

  function observeHostTurnStart(input) {
    exactKeys(input, ['sessionRef', 'turn', 'frozenRevision'], [], 'hostTurnStart');
    const sessionRef = validSessionRef(input.sessionRef, 'hostTurnStart.sessionRef');
    const turn = validRevision(input.turn, 'hostTurnStart.turn');
    const frozenRevision = validRevision(
      input.frozenRevision, 'hostTurnStart.frozenRevision'
    );
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    const record = sessionRecord(sessionRef);
    if (!record) return result('blocked', [], sessionRef, 'context-not-effective');
    if (record.openTurn === turn) return result('noop', [], sessionRef);
    if (record.openTurn !== null) {
      throw contractError('hostTurnStart.turn', '同一 session 已有未结束 turn');
    }
    if (record.lastTurn !== null && turn <= record.lastTurn) {
      return result('ignored-stale', [], sessionRef, 'turn-stale');
    }
    // 原生 composer 与 bridge RPC 之间存在不可消除的竞态：Host 可能已
    // 冻结当前 effective 后，主进程才 stage 更新 revision。权威事件只要
    // 精确证明 frozenRevision 仍是本地已 ACK 的 effective，就可以如实接纳；
    // desired/pending 继续留到 turn-end，不能倒写本轮冻结上下文。
    if (connection.state !== 'ready' || record.effectiveRevision !== frozenRevision
        || !record.effectiveProject) {
      return result('blocked', [], sessionRef, 'context-not-effective');
    }
    record.deliveredRevision = null;
    record.deliveredProject = null;
    record.deliveredTurn = null;
    record.openTurn = turn;
    record.frozenRevision = frozenRevision;
    record.frozenProject = record.effectiveProject;
    record.lastTurn = turn;
    record.turnFenceLost = false;
    record.lastError = null;
    return result('turn-started', [], sessionRef);
  }

  function observeTurnEnd(input) {
    const { sessionRef, turn } = validateTurnInput(input, 'turnEnd');
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    const record = sessionRecord(sessionRef);
    if (!record) {
      throw contractError('turnEnd.turn', 'turn end 与当前冻结 turn 不匹配');
    }
    if (record.openTurn === null && record.endedTurn === turn) {
      const retry = record.pendingRevision !== null
        && record.pendingRevision !== record.effectiveRevision
        ? stageEffect(record, true) : null;
      return result('noop', retry ? [retry] : [], sessionRef);
    }
    if (record.openTurn !== turn) {
      throw contractError('turnEnd.turn', 'turn end 与当前冻结 turn 不匹配');
    }
    record.openTurn = null;
    record.endedTurn = turn;
    record.frozenRevision = null;
    record.frozenProject = null;
    record.turnFenceLost = false;
    if (record.lastError === 'turn-fence-lost') record.lastError = null;
    let effect = null;
    if (record.desiredRevision !== null
        && record.pendingRevision !== null
        && record.pendingRevision !== record.effectiveRevision) {
      effect = stageEffect(record);
    }
    return result('turn-ended', effect ? [effect] : [], sessionRef);
  }

  function observeTurnMiss(input) {
    exactKeys(input, ['sessionRef', 'turn', 'reason'], [], 'turnMiss');
    const sessionRef = validSessionRef(input.sessionRef, 'turnMiss.sessionRef');
    const turn = validRevision(input.turn, 'turnMiss.turn');
    const reason = validReason(input.reason);
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    const record = sessionRecord(sessionRef);
    if (!record) return result('ignored-stale', [], sessionRef, 'session-unavailable');
    if (record.openTurn !== null) {
      return result('ignored-stale', [], sessionRef, 'turn-open');
    }
    if (record.lastTurn !== null && turn <= record.lastTurn) {
      return result('ignored-stale', [], sessionRef, 'turn-stale');
    }
    record.lastTurn = turn;
    record.deliveredRevision = null;
    record.deliveredProject = null;
    record.deliveredTurn = null;
    record.lastError = reason;
    return result('turn-missed', [], sessionRef, reason);
  }

  function releaseSession(input) {
    exactKeys(input, ['sessionRef'], [], 'releaseSession');
    const sessionRef = validSessionRef(input.sessionRef, 'releaseSession.sessionRef');
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    const record = sessionRecord(sessionRef);
    if (!record) return result('noop', [], sessionRef);
    if (record.openTurn !== null) return result('blocked', [], sessionRef, 'turn-open');
    sessions.delete(sessionRef);
    return result('released', [], sessionRef);
  }

  function markProtocolDegraded(reason) {
    connection = { state: 'degraded', reason };
  }

  function ack(input) {
    exactKeys(
      input,
      ['contract', 'clientInstanceId', 'hostInstanceId', 'sessionRef', 'revision', 'state'],
      ['code'],
      'ack'
    );
    const sessionRef = validSessionRef(input.sessionRef, 'ack.sessionRef');
    const revision = validRevision(input.revision, 'ack.revision');
    if (!['queued', 'effective', 'rejected'].includes(input.state)) {
      throw contractError('ack.state', 'ack.state 不是有限状态');
    }
    const record = sessionRecord(sessionRef);
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    if (connection.state !== 'ready') {
      return result('rejected', [], sessionRef, 'bridge-not-ready');
    }
    if (input.contract !== CONTRACT_VERSION) {
      markProtocolDegraded('ack-protocol-mismatch');
      return result('rejected', [], sessionRef, 'ack-protocol-mismatch');
    }
    if (input.clientInstanceId !== clientInstanceId
        || input.hostInstanceId !== connection.hostInstanceId) {
      return result('ignored-instance', [], sessionRef, 'ack-instance-mismatch');
    }
    if (!record || record.sentRevision === null) {
      markProtocolDegraded('ack-unknown-revision');
      return result('rejected', [], sessionRef, 'ack-unknown-revision');
    }
    if (revision < record.sentRevision) return result('ignored-stale', [], sessionRef);
    if (revision > record.sentRevision) {
      markProtocolDegraded('ack-future-revision');
      return result('rejected', [], sessionRef, 'ack-future-revision');
    }

    const currentAckState = record.ackedRevision === revision ? record.ackedState : null;
    if (currentAckState === 'effective' || currentAckState === 'rejected') {
      return result(
        currentAckState === input.state ? 'noop' : 'ignored-stale',
        [],
        sessionRef
      );
    }
    if (currentAckState === 'queued' && input.state === 'queued') {
      return result('noop', [], sessionRef);
    }
    if (input.state === 'rejected') {
      record.ackedRevision = revision;
      record.ackedState = 'rejected';
      record.lastError = safeHostReason(input.code);
      return result('rejected', [], sessionRef, record.lastError);
    }
    if (input.state === 'effective' && record.openTurn !== null
        && record.frozenRevision !== revision) {
      markProtocolDegraded('ack-broke-turn-freeze');
      return result('rejected', [], sessionRef, 'ack-broke-turn-freeze');
    }
    record.ackedRevision = revision;
    record.ackedState = input.state;
    if (!record.turnFenceLost) record.lastError = null;
    if (input.state === 'effective') {
      record.effectiveRevision = revision;
      record.effectiveProject = record.sentProject;
      if (record.pendingRevision !== null && record.pendingRevision <= revision) {
        record.pendingRevision = null;
      }
    }
    return result('accepted', [], sessionRef);
  }

  // delivered 是模型请求已真实读取 frozen revision 的消息级证据，不能由 ACK 推导。
  function observeDelivery(input) {
    exactKeys(
      input,
      [
        'contract', 'clientInstanceId', 'hostInstanceId', 'sessionRef',
        'openTurn', 'frozenRevision'
      ],
      [],
      'delivery'
    );
    const sessionRef = validSessionRef(input.sessionRef, 'delivery.sessionRef');
    const openTurn = validRevision(input.openTurn, 'delivery.openTurn');
    const frozenRevision = validRevision(input.frozenRevision, 'delivery.frozenRevision');
    const record = sessionRecord(sessionRef);
    if (!enabled) return result('disabled', [], undefined, 'feature-disabled');
    if (connection.state !== 'ready') {
      return result('rejected', [], sessionRef, 'bridge-not-ready');
    }
    if (input.contract !== CONTRACT_VERSION) {
      markProtocolDegraded('delivery-protocol-mismatch');
      return result('rejected', [], sessionRef, 'delivery-protocol-mismatch');
    }
    if (input.clientInstanceId !== clientInstanceId
        || input.hostInstanceId !== connection.hostInstanceId) {
      return result('ignored-instance', [], sessionRef, 'delivery-instance-mismatch');
    }
    if (record && record.turnFenceLost) {
      return result('rejected', [], sessionRef, 'turn-fence-lost');
    }
    if (!record || record.openTurn !== openTurn
        || record.frozenRevision !== frozenRevision
        || record.effectiveRevision !== frozenRevision) {
      return result('ignored-stale', [], sessionRef, 'delivery-fence-mismatch');
    }
    if (record.deliveredRevision === frozenRevision && record.deliveredTurn === openTurn) {
      return result('noop', [], sessionRef);
    }
    record.deliveredRevision = frozenRevision;
    record.deliveredProject = record.frozenProject;
    record.deliveredTurn = openTurn;
    return result('delivered', [], sessionRef);
  }

  return Object.freeze({
    connect,
    disconnect,
    suspend,
    stage,
    observeTurnStart,
    observeHostTurnStart,
    observeTurnEnd,
    observeTurnMiss,
    ack,
    observeDelivery,
    releaseSession,
    snapshot
  });
}

function publicContextBridgeSurface(value) {
  const fallback = () => immutable({
    state: 'degraded',
    reason: 'invalid-snapshot',
    projectId: null,
    effectiveRevision: null,
    deliveredRevision: null,
    pendingRevision: null,
    frozen: false
  });
  if (!plainRecord(value) || value.contract !== CONTRACT_VERSION
      || typeof value.enabled !== 'boolean' || !plainRecord(value.connection)) return fallback();
  const connectionState = value.connection.state;
  const connectionReason = typeof value.connection.reason === 'string'
    && REASON_CODE_SET.has(value.connection.reason) ? value.connection.reason : null;
  const session = plainRecord(value.session) ? value.session : null;
  const effectiveRevision = session && Number.isSafeInteger(session.effectiveRevision)
    && session.effectiveRevision > 0 ? session.effectiveRevision : null;
  const deliveredRevision = session && Number.isSafeInteger(session.deliveredRevision)
    && session.deliveredRevision > 0 ? session.deliveredRevision : null;
  const pendingRevision = session && Number.isSafeInteger(session.pendingRevision)
    && session.pendingRevision > 0 ? session.pendingRevision : null;
  const frozen = Boolean(session && Number.isSafeInteger(session.openTurn) && session.openTurn > 0);

  let state;
  let reason = connectionReason;
  if (!value.enabled || connectionState === 'disabled') {
    state = 'disabled';
    reason = 'feature-disabled';
  } else if (connectionState === 'degraded') {
    state = 'degraded';
    reason = connectionReason || 'bridge-degraded';
  } else if (connectionState === 'disconnected') {
    state = 'unavailable';
    reason = connectionReason || 'not-connected';
  } else if (connectionState !== 'ready') {
    return fallback();
  } else if (session && typeof session.lastError === 'string'
      && REASON_CODE_SET.has(session.lastError)) {
    state = 'degraded';
    reason = session.lastError;
  } else if (frozen && session.frozenRevision !== null
      && deliveredRevision === session.frozenRevision
      && session.deliveredTurn === session.openTurn) {
    state = 'delivered';
    reason = null;
  } else if (frozen && Number.isSafeInteger(session.frozenRevision)
      && session.frozenRevision > 0) {
    state = 'awaiting-delivery';
    reason = 'awaiting-delivery';
  } else if (frozen) {
    state = 'frozen';
    reason = 'turn-open';
  } else if (pendingRevision !== null && pendingRevision !== effectiveRevision) {
    state = 'queued';
    reason = 'awaiting-ack';
  } else if (effectiveRevision !== null) {
    state = deliveredRevision === effectiveRevision ? 'delivered' : 'effective';
    reason = null;
  } else {
    state = 'ready';
    reason = null;
  }

  // projectId 必须与当前状态引用的 revision 同源。desired 在 running 中可以继续
  // 变化，绝不能让它覆盖 frozen/effective/delivered 对应的项目身份。
  let surfacedProject = session && session.project;
  if (session) {
    if (frozen) {
      surfacedProject = Number.isSafeInteger(session.frozenRevision)
        && session.frozenRevision > 0 ? session.frozenProject : null;
    } else if (pendingRevision !== null && pendingRevision !== effectiveRevision) {
      surfacedProject = session.project;
    } else if (effectiveRevision !== null) {
      surfacedProject = deliveredRevision === effectiveRevision
        ? session.deliveredProject : session.effectiveProject;
    }
  }
  const projectRequired = frozen || effectiveRevision !== null
    || deliveredRevision !== null || pendingRevision !== null;
  const validProject = plainRecord(surfacedProject)
    && typeof surfacedProject.projectId === 'string'
    && PROJECT_ID_RE.test(surfacedProject.projectId);
  if ((projectRequired || surfacedProject != null) && !validProject) return fallback();
  const projectId = validProject ? surfacedProject.projectId : null;
  return immutable({
    state,
    reason,
    projectId,
    effectiveRevision,
    deliveredRevision,
    pendingRevision,
    frozen
  });
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  FEATURE_ENV,
  CAPABILITIES,
  LIMITS,
  isContextPocEnabled,
  deriveProjectId,
  normalizeProjectContext,
  createContextBridgeState,
  publicContextBridgeSurface
});
