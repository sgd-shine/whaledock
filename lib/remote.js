'use strict';

// 鲸坞远程板块核心。纯 Node、零运行时依赖，不知道 Electron，也不保存平台凭据。
// 平台 adapter 只能实现收 / 推 / 批与生命周期；这里刻意没有通用 RPC 或命令入口。
const crypto = require('crypto');

const CHANNELS = Object.freeze(['feishu', 'dingtalk', 'web']);
const PUSH_KINDS = Object.freeze(['approval', 'task-completed', 'report-ready']);
const STATES = Object.freeze([
  'disabled', 'disconnected', 'connecting', 'connected', 'error', 'unavailable'
]);
const BINDINGS = Object.freeze(['unbound', 'pending', 'bound']);
const SENSITIVITIES = Object.freeze(['anonymous', 'ordinary', 'customer']);
const INBOUND_KINDS = Object.freeze(['text', 'link', 'file']);
const MAX_TEXT_BYTES = 150 * 1024;
const MAX_OPAQUE_LENGTH = 512;
const MAX_PENDING_OPERATIONS = 64;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;
const MAX_APPROVAL_LEDGER = 10_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 20_000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 4_000;
const DEFAULT_BINDING_TTL_MS = 5 * 60_000;
const SERVICE_OPTION_KEYS = Object.freeze([
  'receiveSink', 'applyApproval', 'classifyContent', 'persistBinding', 'readBinding',
  'auditEvent', 'onStateChanged', 'onBindingRequested', 'operationTimeoutMs',
  'disconnectTimeoutMs', 'bindingTtlMs', 'now', 'initialBindings', 'policy'
]);

function remoteError(message, code = 'ERR_REMOTE_CONTRACT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function onlyKeys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw remoteError(`${label}含不支持的字段`);
  }
}

function fixedString(value, label, maximum = MAX_OPAQUE_LENGTH) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) {
    throw remoteError(`${label}无效`);
  }
  return value;
}

function channelId(value) {
  const id = fixedString(value, '通道标识', 32);
  if (!CHANNELS.includes(id)) throw remoteError('不支持的远程通道');
  return id;
}

function safeReason(value, fallback = null) {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value) ? value : fallback;
}

function normalizeTimeout(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 10 || value > 120_000) {
    throw remoteError(`${label}无效`);
  }
  return value;
}

function newCounters() {
  return {
    received: 0,
    pushed: 0,
    approved: 0,
    unauthorizedDropped: 0,
    policyDropped: 0,
    errors: 0
  };
}

function increment(entry, field) {
  if (entry.counters[field] < Number.MAX_SAFE_INTEGER) entry.counters[field] += 1;
  return entry.counters[field];
}

function normalizeSensitivity(value) {
  if (!SENSITIVITIES.includes(value)) throw remoteError('内容分级无效');
  return value;
}

function normalizeInbound(value) {
  if (!isRecord(value)) throw remoteError('收件必须是对象');
  onlyKeys(value, ['actorId', 'kind', 'content'], '收件');
  const actorId = fixedString(value.actorId, '发送者标识', 256);
  if (!INBOUND_KINDS.includes(value.kind)) throw remoteError('收件类型无效');
  if (value.kind === 'file') {
    if (!isRecord(value.content)) throw remoteError('文件收件内容无效');
    onlyKeys(value.content, ['name', 'size', 'reference'], '文件收件');
    const name = fixedString(value.content.name, '文件名', 255);
    const size = value.content.size;
    const reference = fixedString(value.content.reference, '文件引用', 2048);
    if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024) {
      throw remoteError('文件大小无效');
    }
    return Object.freeze({
      actorId,
      kind: value.kind,
      content: Object.freeze({ name, size, reference }),
      retainedBytes: Buffer.byteLength(name, 'utf8') + Buffer.byteLength(reference, 'utf8')
    });
  }
  const content = fixedString(value.content, '收件正文', MAX_TEXT_BYTES);
  const retainedBytes = Buffer.byteLength(content, 'utf8');
  if (retainedBytes > MAX_TEXT_BYTES) throw remoteError('收件正文过大');
  return Object.freeze({ actorId, kind: value.kind, content, retainedBytes });
}

function normalizePush(value) {
  if (!isRecord(value)) throw remoteError('推送必须是对象');
  onlyKeys(value, ['kind', 'body', 'dedupeKey'], '推送');
  if (!PUSH_KINDS.includes(value.kind)) throw remoteError('推送类型无效');
  const body = fixedString(value.body, '推送正文', MAX_TEXT_BYTES);
  if (Buffer.byteLength(body, 'utf8') > MAX_TEXT_BYTES) throw remoteError('推送正文过大');
  const dedupeKey = value.dedupeKey === undefined
    ? null : fixedString(value.dedupeKey, '推送去重标识', 256);
  return Object.freeze({ kind: value.kind, body, dedupeKey });
}

function decisionFromReply(value) {
  if (typeof value !== 'string') return 'unknown';
  const reply = value.trim();
  if (reply === '1' || reply === '采用') return 'adopt';
  if (reply === '2' || reply === '重来' || reply === '再来一版') return 'redo';
  return 'unknown';
}

function normalizeDecision(value) {
  if (!isRecord(value)) throw remoteError('远程确认必须是对象');
  onlyKeys(value, ['actorId', 'requestToken', 'reply'], '远程确认');
  const actorId = fixedString(value.actorId, '发送者标识', 256);
  const requestToken = fixedString(value.requestToken, '确认项标识', 256);
  const reply = fixedString(value.reply, '确认回复', 64);
  return Object.freeze({
    actorId,
    requestToken,
    decision: decisionFromReply(reply),
    retainedBytes: Buffer.byteLength(actorId, 'utf8')
      + Buffer.byteLength(requestToken, 'utf8') + Buffer.byteLength(reply, 'utf8')
  });
}

function normalizePolicy(value = {}) {
  if (!isRecord(value)) throw remoteError('远程内容策略必须是对象');
  const defaults = {
    allowApprovals: true,
    allowTaskCompletions: true,
    allowReports: true,
    notificationsEnabled: true,
    quietMode: false
  };
  onlyKeys(value, Object.keys(defaults), '远程内容策略');
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const supplied = Object.hasOwn(value, key) ? value[key] : fallback;
    if (typeof supplied !== 'boolean') throw remoteError(`${key} 必须是布尔值`);
    result[key] = supplied;
  }
  return Object.freeze(result);
}

function validateAdapter(id, adapter) {
  if (!isRecord(adapter)) throw remoteError(`${id} adapter 必须是普通对象`);
  onlyKeys(adapter, ['connect'], `${id} adapter`);
  if (typeof adapter.connect !== 'function') throw remoteError(`${id} adapter 缺少 connect`);
  return adapter;
}

function validateSession(id, session) {
  if (!isRecord(session)) throw remoteError(`${id} 连接句柄必须是普通对象`);
  const methods = ['disconnect', 'push', 'approve', 'challengeBinding'];
  onlyKeys(session, methods, `${id} 连接句柄`);
  for (const method of methods) {
    if (typeof session[method] !== 'function') throw remoteError(`${id} 连接句柄缺少 ${method}`);
  }
  return session;
}

function approvalKey(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function deadline(work, options = {}) {
  const timeoutMs = options.timeoutMs;
  const signal = options.signal || null;
  const timeoutCode = options.timeoutCode || 'ERR_REMOTE_TIMEOUT';
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, remoteError('远程操作已取消', 'ERR_REMOTE_ABORTED'));
    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      finish(reject, remoteError('远程操作超时', timeoutCode));
    }, timeoutMs);
    Promise.resolve().then(work).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

function createRemoteService(options = {}) {
  if (!isRecord(options)) throw remoteError('远程服务参数必须是对象');
  onlyKeys(options, SERVICE_OPTION_KEYS, '远程服务参数');
  const callbackOption = (name, fallback) => {
    if (options[name] === undefined) return fallback;
    if (typeof options[name] !== 'function') throw remoteError(`${name} 必须是函数`);
    return options[name];
  };
  const receiveSink = callbackOption('receiveSink', async () => {});
  // 「验 token」和「执行既有确认」不能拆成两个会丢动作的 await。权威层必须
  // 用同一个幂等事务 apply，返回可持久回读的结果；默认永远不是 pending。
  const applyApproval = callbackOption(
    'applyApproval', async () => ({ status: 'not-pending' })
  );
  // 分级只能来自主进程的受信工作区策略；平台消息自己携带 sensitivity 会被严格拒绝。
  // 未接策略时默认 customer，因而飞书/钉钉 fail-closed，只有私网 web 可以通过。
  const classifyContent = callbackOption('classifyContent', async () => 'customer');
  // 绑定只有在受信本机存储确认持久化后才生效；默认拒绝，不做内存假绑定。
  const hasPersistBinding = options.persistBinding !== undefined;
  const hasReadBinding = options.readBinding !== undefined;
  if (hasPersistBinding !== hasReadBinding) {
    throw remoteError('persistBinding 与 readBinding 必须成对提供');
  }
  const persistBinding = hasPersistBinding
    ? callbackOption('persistBinding') : async () => null;
  const readBinding = hasReadBinding ? callbackOption('readBinding') : async () => null;
  const auditEvent = callbackOption('auditEvent', () => {});
  const onStateChanged = callbackOption('onStateChanged', () => {});
  const onBindingRequested = callbackOption('onBindingRequested', () => {});
  const operationTimeoutMs = normalizeTimeout(
    options.operationTimeoutMs, DEFAULT_OPERATION_TIMEOUT_MS, '远程操作超时'
  );
  const disconnectTimeoutMs = normalizeTimeout(
    options.disconnectTimeoutMs, DEFAULT_DISCONNECT_TIMEOUT_MS, '远程断开超时'
  );
  const bindingTtlMs = normalizeTimeout(
    options.bindingTtlMs, DEFAULT_BINDING_TTL_MS, '绑定码有效期'
  );
  const now = callbackOption('now', Date.now);
  const initialBindings = options.initialBindings === undefined ? {} : options.initialBindings;
  if (!isRecord(initialBindings)) throw remoteError('初始绑定必须是对象');
  onlyKeys(initialBindings, CHANNELS, '初始绑定');
  let policy = normalizePolicy(options.policy || {});
  let policyVersion = 0;
  let closing = false;
  let closed = false;
  let closePromise = null;
  const approvalLedger = new Map();
  const approvalSerial = new Map();
  const channels = new Map(CHANNELS.map((id) => [id, {
    id,
    enabled: false,
    state: 'disabled',
    binding: 'unbound',
    reasonCode: null,
    counters: newCounters(),
    adapter: null,
    session: null,
    sessionDisconnectRaw: null,
    connectAttempt: null,
    abortController: null,
    connectionGeneration: 0,
    lifecycleVersion: 0,
    serial: Promise.resolve(),
    connectPromise: null,
    disconnectPromise: null,
    pendingOperations: 0,
    pendingBytes: 0,
    pendingOutboundOperations: 0,
    pendingOutboundBytes: 0,
    boundActorId: Object.hasOwn(initialBindings, id)
      ? fixedString(initialBindings[id], `${id} 初始绑定`, 256) : null,
    pendingActorId: null,
    pendingBindingToken: null,
    pendingBindingGeneration: null,
    pendingBindingChallenge: null,
    pendingBindingExpiresAt: null,
    bindingCommit: null
  }]));
  for (const entry of channels.values()) {
    if (entry.boundActorId) entry.binding = 'bound';
  }

  function entryFor(id) {
    return channels.get(channelId(id));
  }

  function assertUsable() {
    if (closing || closed) throw remoteError('远程服务已关闭', 'ERR_REMOTE_CLOSED');
  }

  function audit(entry, event, reasonCode = null) {
    const payload = Object.freeze({
      event: safeReason(event, 'unknown'),
      channelId: entry.id,
      count: entry.counters.unauthorizedDropped,
      reasonCode: safeReason(reasonCode)
    });
    try { auditEvent(payload); } catch (_error) { /* 审计展示不能破坏远程状态机 */ }
  }

  function publicEntry(entry) {
    return {
      enabled: entry.enabled,
      state: STATES.includes(entry.state) ? entry.state : 'error',
      binding: BINDINGS.includes(entry.binding) ? entry.binding : 'unbound',
      setupState: entry.adapter ? 'configured' : 'not-configured',
      reasonCode: safeReason(entry.reasonCode),
      counters: { ...entry.counters }
    };
  }

  function snapshot() {
    const result = {};
    for (const id of CHANNELS) result[id] = publicEntry(channels.get(id));
    return { channels: result };
  }

  function changed() {
    try { onStateChanged(snapshot()); } catch (_error) { /* UI 回调不能破坏状态机 */ }
  }

  function enqueueEntry(entry, work, allowClosing = false) {
    const run = entry.serial.then(async () => {
      if (!allowClosing) assertUsable();
      return work();
    });
    entry.serial = run.catch(() => {});
    return run;
  }

  function enqueueInbound(entry, retainedBytes, work) {
    if (entry.pendingOperations >= MAX_PENDING_OPERATIONS
        || entry.pendingBytes + retainedBytes > MAX_PENDING_BYTES) {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', 'backpressure');
      changed();
      return Promise.resolve({ accepted: false, reasonCode: 'backpressure' });
    }
    entry.pendingOperations += 1;
    entry.pendingBytes += retainedBytes;
    return enqueueEntry(entry, work).finally(() => {
      entry.pendingOperations = Math.max(0, entry.pendingOperations - 1);
      entry.pendingBytes = Math.max(0, entry.pendingBytes - retainedBytes);
    });
  }

  function enqueueOutbound(entry, retainedBytes, work) {
    if (entry.pendingOutboundOperations >= MAX_PENDING_OPERATIONS
        || entry.pendingOutboundBytes + retainedBytes > MAX_PENDING_BYTES) {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', 'backpressure');
      changed();
      return Promise.resolve({
        channelId: entry.id,
        delivered: false,
        reasonCode: 'backpressure'
      });
    }
    entry.pendingOutboundOperations += 1;
    entry.pendingOutboundBytes += retainedBytes;
    return enqueueEntry(entry, work).finally(() => {
      entry.pendingOutboundOperations = Math.max(0, entry.pendingOutboundOperations - 1);
      entry.pendingOutboundBytes = Math.max(0, entry.pendingOutboundBytes - retainedBytes);
    });
  }

  function invalidateConnection(entry) {
    entry.connectionGeneration += 1;
    if (entry.abortController) entry.abortController.abort();
  }

  function clearPendingBinding(entry, force = false) {
    // 持久化已开始后就可能「已写盘但回执迟到」。在权威结果落定前，
    // 断线/拒绝都不得把 UI 画回 unbound，否则重启可能突然变成 bound。
    if (entry.bindingCommit && !force) return false;
    entry.pendingActorId = null;
    entry.pendingBindingToken = null;
    entry.pendingBindingGeneration = null;
    entry.pendingBindingChallenge = null;
    entry.pendingBindingExpiresAt = null;
    if (entry.binding === 'pending') entry.binding = 'unbound';
    return true;
  }

  function pendingBindingExpired(entry) {
    return entry.binding === 'pending' && !entry.bindingCommit
      && (!Number.isSafeInteger(entry.pendingBindingExpiresAt)
        || now() > entry.pendingBindingExpiresAt);
  }

  async function disconnectSession(owner, session, reason) {
    if (!session) return;
    let raw = owner.sessionDisconnectRaw;
    if (!raw) {
      raw = Promise.resolve().then(() => session.disconnect(reason));
      owner.sessionDisconnectRaw = raw;
      raw.catch(() => {
        // 显式拒绝可重试；超时仍保留同一 raw，不重发断开。
        if (owner.sessionDisconnectRaw === raw) owner.sessionDisconnectRaw = null;
      });
    }
    // receipt 按连接代际保存，而非按 session 对象保存；adapter 即使
    // 误复用句柄，新一代也会发出自己的断开。
    await deadline(
      () => raw,
      { timeoutMs: disconnectTimeoutMs, timeoutCode: 'ERR_REMOTE_DISCONNECT_TIMEOUT' }
    );
  }

  function recordDisconnectFailure(entry) {
    increment(entry, 'errors');
    entry.state = 'error';
    entry.reasonCode = 'disconnect-failed';
    audit(entry, 'disconnect-failed', entry.reasonCode);
    changed();
  }

  function beginEscapedCleanup(entry, attempt, reason) {
    if (attempt.cleanupPromise && !attempt.cleanupFailed) return attempt.cleanupPromise;
    // 显式拒绝/瞬时故障可以在下一次 disable/close 重试；如果是超时，
    // disconnectSession 会继续等同一个 raw promise，不会重复调平台断开。
    if (attempt.cleanupFailed) {
      attempt.cleanupPromise = null;
      attempt.cleanupFailed = false;
    }
    attempt.cleanupPromise = attempt.outcomePromise.then(async (outcome) => {
      if (!outcome.ok) {
        if (entry.connectAttempt === attempt) entry.connectAttempt = null;
        if (entry.abortController === attempt.controller) entry.abortController = null;
        if (entry.state === 'error' && entry.reasonCode === 'connect-cleanup-pending') {
          entry.state = entry.enabled && !closing ? 'disconnected' : 'disabled';
          entry.reasonCode = null;
          changed();
        }
        return;
      }
      let session;
      try { session = validateSession(entry.id, outcome.value); }
      catch (_error) {
        attempt.cleanupFailed = true;
        recordDisconnectFailure(entry);
        throw remoteError(`${entry.id} 连接无法安全回收`, 'ERR_REMOTE_DISCONNECT');
      }
      attempt.session = session;
      try { await disconnectSession(attempt, session, reason); }
      catch (_error) {
        attempt.cleanupFailed = true;
        recordDisconnectFailure(entry);
        throw remoteError(`${entry.id} 连接无法安全回收`, 'ERR_REMOTE_DISCONNECT');
      }
      attempt.session = null;
      attempt.sessionDisconnectRaw = null;
      if (entry.connectAttempt === attempt) entry.connectAttempt = null;
      if (entry.abortController === attempt.controller) entry.abortController = null;
      entry.state = entry.enabled && !closing ? 'disconnected' : 'disabled';
      entry.reasonCode = null;
      changed();
    });
    // cleanupPromise 仍保留 rejection 供停用/close 回读；这里只阻止未处理 rejection。
    void attempt.cleanupPromise.catch(() => {});
    return attempt.cleanupPromise;
  }

  async function disconnectTransport(entry, reason) {
    const session = entry.session;
    if (session) {
      await disconnectSession(entry, session, reason);
      if (entry.session === session) {
        entry.session = null;
        entry.sessionDisconnectRaw = null;
      }
    }
    const attempt = entry.connectAttempt;
    if (attempt) {
      const cleanup = beginEscapedCleanup(entry, attempt, reason);
      await deadline(
        () => cleanup,
        {
          timeoutMs: disconnectTimeoutMs,
          timeoutCode: 'ERR_REMOTE_DISCONNECT_TIMEOUT'
        }
      );
    }
  }

  async function disconnectEntry(entry, reason, disabled) {
    invalidateConnection(entry);
    try { await disconnectTransport(entry, reason); }
    catch (_error) {
      clearPendingBinding(entry);
      recordDisconnectFailure(entry);
      throw remoteError(`${entry.id} 未确认断开`, 'ERR_REMOTE_DISCONNECT');
    }
    entry.abortController = null;
    clearPendingBinding(entry);
    entry.state = disabled ? 'disabled' : 'disconnected';
    entry.reasonCode = null;
    changed();
  }

  async function failEntry(entry, reasonCode) {
    invalidateConnection(entry);
    try { await disconnectTransport(entry, reasonCode); }
    catch (_error) {
      clearPendingBinding(entry);
      recordDisconnectFailure(entry);
      throw remoteError(`${entry.id} 未确认断开`, 'ERR_REMOTE_DISCONNECT');
    }
    entry.abortController = null;
    clearPendingBinding(entry);
    increment(entry, 'errors');
    if (entry.enabled && !closing) {
      entry.state = 'error';
      entry.reasonCode = reasonCode;
      audit(entry, reasonCode, reasonCode);
    } else {
      entry.state = 'disabled';
      entry.reasonCode = null;
    }
    changed();
  }

  function adapterOperation(entry, method, value, guard = null) {
    const signal = entry.abortController && entry.abortController.signal;
    const session = entry.session;
    const generation = entry.connectionGeneration;
    if (!session) return Promise.reject(remoteError('远程通道未连接', 'ERR_REMOTE_OFFLINE'));
    return deadline(
      async () => {
        if (entry.session !== session || generation !== entry.connectionGeneration
            || entry.state !== 'connected') {
          throw remoteError('远程连接已变更', 'ERR_REMOTE_ABORTED');
        }
        if (typeof guard === 'function') {
          const reasonCode = guard();
          if (reasonCode) throw remoteError(reasonCode, 'ERR_REMOTE_POLICY_CHANGED');
        }
        const result = await session[method](value, Object.freeze({ signal }));
        if (entry.session !== session || generation !== entry.connectionGeneration
            || entry.state !== 'connected') {
          throw remoteError('远程连接已变更', 'ERR_REMOTE_ABORTED');
        }
        return result;
      },
      { signal, timeoutMs: operationTimeoutMs, timeoutCode: 'ERR_REMOTE_OPERATION_TIMEOUT' }
    );
  }

  function staleResult() {
    return { accepted: false, reasonCode: 'stale-connection' };
  }

  function adapterLifecycle(id, generation, state, reasonCode) {
    const entry = entryFor(id);
    if (generation !== entry.connectionGeneration) return Promise.resolve(staleResult());
    const nextReason = safeReason(reasonCode, state === 'error' ? 'transport-error' : 'remote-closed');
    invalidateConnection(entry);
    entry.abortController = null;
    clearPendingBinding(entry);
    entry.state = state;
    entry.reasonCode = nextReason;
    if (state === 'error') increment(entry, 'errors');
    audit(entry, state === 'error' ? 'transport-error' : 'disconnected', nextReason);
    changed();
    return enqueueEntry(entry, async () => {
      try { await disconnectTransport(entry, nextReason); }
      catch (_error) { recordDisconnectFailure(entry); }
      return { accepted: true };
    }, true);
  }

  async function connectEntry(entry, lifecycleVersion) {
    if (!entry.enabled || lifecycleVersion !== entry.lifecycleVersion) return;
    if (!entry.adapter) {
      entry.state = 'unavailable';
      entry.reasonCode = 'adapter-missing';
      audit(entry, 'unavailable', entry.reasonCode);
      changed();
      return;
    }
    if (entry.connectAttempt) {
      entry.state = 'error';
      entry.reasonCode = entry.connectAttempt.cleanupFailed
        ? 'disconnect-failed' : 'connect-cleanup-pending';
      audit(entry, 'connect-blocked', entry.reasonCode);
      changed();
      return;
    }
    const generation = entry.connectionGeneration + 1;
    entry.connectionGeneration = generation;
    const controller = new AbortController();
    entry.abortController = controller;
    entry.state = 'connecting';
    entry.reasonCode = null;
    changed();

    const rawConnect = Promise.resolve().then(() => entry.adapter.connect(Object.freeze({
      signal: controller.signal,
      onReceive: (value) => receiveFromGeneration(entry.id, generation, value),
      onDecision: (value) => approveFromGeneration(entry.id, generation, value),
      onClose: (reasonCode) => adapterLifecycle(entry.id, generation, 'disconnected', reasonCode),
      onError: (reasonCode) => adapterLifecycle(entry.id, generation, 'error', reasonCode)
    })));
    const attempt = {
      generation,
      controller,
      outcomePromise: rawConnect.then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false })
      ),
      cleanupPromise: null,
      cleanupFailed: false,
      session: null,
      sessionDisconnectRaw: null
    };
    entry.connectAttempt = attempt;
    entry.connectPromise = rawConnect;
    let outcome;
    try {
      outcome = await deadline(
        () => attempt.outcomePromise,
        {
          signal: controller.signal,
          timeoutMs: operationTimeoutMs,
          timeoutCode: 'ERR_REMOTE_CONNECT_TIMEOUT'
        }
      );
    } catch (error) {
      controller.abort();
      beginEscapedCleanup(entry, attempt, 'late-connect');
      increment(entry, 'errors');
      entry.state = 'error';
      entry.reasonCode = 'connect-cleanup-pending';
      audit(entry, 'connect-failed', error && error.code === 'ERR_REMOTE_CONNECT_TIMEOUT'
        ? 'connect-timeout' : 'connect-cancelled');
      changed();
      return;
    } finally {
      if (entry.connectPromise === rawConnect) entry.connectPromise = null;
    }

    if (!outcome.ok) {
      if (entry.connectAttempt === attempt) entry.connectAttempt = null;
      if (entry.abortController === controller) entry.abortController = null;
      const cancelled = generation !== entry.connectionGeneration || !entry.enabled || closing;
      if (cancelled) {
        entry.state = entry.enabled && !closing ? 'disconnected' : 'disabled';
        entry.reasonCode = null;
      } else {
        increment(entry, 'errors');
        entry.state = 'error';
        entry.reasonCode = 'connect-failed';
        audit(entry, 'connect-failed', entry.reasonCode);
      }
      changed();
      return;
    }

    let session;
    try { session = validateSession(entry.id, outcome.value); }
    catch (_error) {
      attempt.cleanupFailed = true;
      recordDisconnectFailure(entry);
      return;
    }
    attempt.session = session;

    if (!entry.enabled || controller.signal.aborted || generation !== entry.connectionGeneration
        || lifecycleVersion !== entry.lifecycleVersion || closing) {
      beginEscapedCleanup(entry, attempt, 'connect-cancelled');
      try { await attempt.cleanupPromise; } catch (_error) { /* 已记录真实故障 */ }
      return;
    }
    entry.connectAttempt = null;
    attempt.session = null;
    attempt.sessionDisconnectRaw = null;
    entry.session = session;
    entry.sessionDisconnectRaw = null;
    entry.state = 'connected';
    entry.reasonCode = null;
    audit(entry, 'connected');
    changed();
  }

  function registerAdapter(id, adapter) {
    assertUsable();
    const entry = entryFor(id);
    if (entry.adapter || entry.state === 'connecting' || entry.state === 'connected') {
      throw remoteError(`${entry.id} adapter 已注册`);
    }
    entry.adapter = validateAdapter(entry.id, adapter);
    entry.state = entry.enabled ? 'disconnected' : 'disabled';
    entry.reasonCode = null;
    changed();
    return snapshot();
  }

  function setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(remoteError('enabled 必须是布尔值'));
    let entry;
    try {
      assertUsable();
      entry = entryFor(id);
    } catch (error) { return Promise.reject(error); }
    entry.enabled = enabled;
    entry.lifecycleVersion += 1;
    const version = entry.lifecycleVersion;
    if (!enabled) invalidateConnection(entry);
    changed();
    return enqueueEntry(entry, async () => {
      if (enabled) {
        if (entry.enabled && version === entry.lifecycleVersion
            && entry.state !== 'connected' && entry.state !== 'connecting') {
          await connectEntry(entry, version);
        }
      } else {
        await disconnectEntry(entry, 'disabled', !entry.enabled);
      }
      return snapshot();
    });
  }

  function configurePolicy(value) {
    let normalized;
    try {
      assertUsable();
      normalized = normalizePolicy(value);
    } catch (error) { return Promise.reject(error); }
    policy = normalized;
    policyVersion += 1;
    audit(channels.get('web'), 'policy-configured');
    changed();
    return Promise.resolve(snapshot());
  }

  function markUnauthorized(entry, reasonCode) {
    increment(entry, 'unauthorizedDropped');
    audit(entry, 'unauthorized-dropped', reasonCode);
    changed();
    return { accepted: false, reasonCode };
  }

  function actorAuthorized(entry, actorId) {
    return entry.binding === 'bound' && entry.boundActorId === actorId;
  }

  async function trustedSensitivity(entry, operation, kind) {
    try {
      const value = await deadline(
        () => classifyContent(Object.freeze({ channelId: entry.id, operation, kind })),
        {
          signal: entry.abortController && entry.abortController.signal,
          timeoutMs: operationTimeoutMs,
          timeoutCode: 'ERR_REMOTE_POLICY_TIMEOUT'
        }
      );
      return { ok: true, sensitivity: normalizeSensitivity(value) };
    } catch (_error) {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', 'classification-failed');
      changed();
      return { ok: false, reasonCode: 'classification-failed' };
    }
  }

  async function requestBinding(entry, actorId, generation) {
    if (pendingBindingExpired(entry)) {
      clearPendingBinding(entry);
      audit(entry, 'binding-expired', 'binding-expired');
    }
    if (entry.binding !== 'unbound') return 'not-bound';
    entry.binding = 'pending';
    entry.pendingActorId = actorId;
    entry.pendingBindingGeneration = generation;
    entry.pendingBindingToken = crypto.randomBytes(24).toString('hex');
    entry.pendingBindingChallenge = String(crypto.randomInt(100_000, 1_000_000));
    entry.pendingBindingExpiresAt = now() + bindingTtlMs;
    audit(entry, 'binding-pending', 'binding-required');
    const bindingToken = entry.pendingBindingToken;
    const challengeCode = entry.pendingBindingChallenge;
    const expiresAt = entry.pendingBindingExpiresAt;
    try {
      await adapterOperation(entry, 'challengeBinding', Object.freeze({
        actorId,
        challengeCode,
        expiresAt
      }));
      const shown = await deadline(
        () => onBindingRequested(Object.freeze({
          channelId: entry.id,
          bindingToken,
          challengeCode,
          expiresAt
        })),
        {
          signal: entry.abortController && entry.abortController.signal,
          timeoutMs: operationTimeoutMs,
          timeoutCode: 'ERR_REMOTE_BINDING_UI_TIMEOUT'
        }
      );
      if (shown !== true) throw remoteError('未创建绑定确认卡');
    } catch (_error) {
      if (entry.pendingBindingToken === bindingToken) clearPendingBinding(entry);
      increment(entry, 'errors');
      audit(entry, 'binding-request-failed', 'binding-unavailable');
      changed();
      return 'binding-unavailable';
    }
    changed();
    return 'binding-required';
  }

  function normalizeBindingConfirmation(value) {
    if (!isRecord(value)) throw remoteError('绑定确认必须是对象');
    onlyKeys(value, ['bindingToken', 'challengeCode'], '绑定确认');
    const challengeCode = fixedString(value.challengeCode, '绑定码', 6);
    if (!/^\d{6}$/.test(challengeCode)) throw remoteError('绑定码无效');
    return Object.freeze({
      bindingToken: fixedString(value.bindingToken, '绑定确认标识', 128),
      challengeCode
    });
  }

  async function readPersistedBinding(entry) {
    try {
      const value = await deadline(
        () => readBinding(Object.freeze({ channelId: entry.id })),
        {
          signal: entry.abortController && entry.abortController.signal,
          timeoutMs: operationTimeoutMs,
          timeoutCode: 'ERR_REMOTE_BINDING_READ_TIMEOUT'
        }
      );
      if (value === null) return { known: true, actorId: null };
      return { known: true, actorId: fixedString(value, '持久绑定账号', 256) };
    } catch (_error) {
      return { known: false, actorId: null };
    }
  }

  async function settleBindingCommit(entry, commit, outcome) {
    if (entry.bindingCommit !== commit) return;
    commit.outcome = outcome;
    let bindingState = outcome.ok ? { known: true, actorId: commit.actorId }
      : await readPersistedBinding(entry);
    if (bindingState.known && bindingState.actorId === commit.actorId) {
      entry.bindingCommit = null;
      entry.boundActorId = commit.actorId;
      clearPendingBinding(entry, true);
      entry.binding = 'bound';
      audit(entry, outcome.ok ? 'binding-confirmed' : 'binding-reconciled');
    } else if (bindingState.known && bindingState.actorId === null) {
      entry.bindingCommit = null;
      clearPendingBinding(entry, true);
      audit(entry, 'binding-persist-failed', 'binding-persist-failed');
    } else {
      // 读回失败或已有不同 owner 都是未知/冲突，继续 pending，绝不猜测覆盖。
      audit(entry, 'binding-persist-pending', 'binding-persist-pending');
    }
    changed();
    return entry.binding === 'bound' ? 'bound'
      : entry.bindingCommit ? 'pending' : 'unbound';
  }

  async function persistConfirmedBinding(entry, actorId) {
    if (entry.bindingCommit) {
      const existing = entry.bindingCommit;
      if (!existing.outcome) return { pending: true, ok: false };
      const state = await settleBindingCommit(entry, existing, existing.outcome);
      return { pending: state === 'pending', ok: state === 'bound' };
    }
    const bindingToken = entry.pendingBindingToken;
    const commit = {
      actorId,
      commitId: approvalKey(bindingToken),
      outcomePromise: null,
      outcome: null
    };
    const raw = Promise.resolve().then(() => persistBinding(Object.freeze({
      channelId: entry.id,
      actorId,
      // 存储层用这个不可逆 id 做原子 CAS/幂等写，不保存桌面 bindingToken。
      commitId: commit.commitId
    })));
    commit.outcomePromise = raw.then(
      (value) => ({ ok: value === commit.commitId }),
      () => ({ ok: false })
    );
    entry.bindingCommit = commit;
    try {
      const outcome = await deadline(
        () => commit.outcomePromise,
        {
          signal: entry.abortController && entry.abortController.signal,
          timeoutMs: operationTimeoutMs,
          timeoutCode: 'ERR_REMOTE_BINDING_PERSIST_TIMEOUT'
        }
      );
      const state = await settleBindingCommit(entry, commit, outcome);
      return { pending: state === 'pending', ok: state === 'bound' };
    } catch (_error) {
      // 超时是「未知」而不是「未写」。保持 pending，禁止拒绝/重绑，并等原始
      // promise 迟到回执。若进程先退出，下次启动以 initialBindings 的持久回读为准。
      audit(entry, 'binding-persist-pending', 'binding-persist-pending');
      changed();
      void commit.outcomePromise.then((outcome) => (
        enqueueEntry(entry, async () => { await settleBindingCommit(entry, commit, outcome); }, true)
      )).catch(() => {});
      return { pending: true, ok: false };
    }
  }

  function receiveFromGeneration(id, generation, value) {
    let entry;
    try { entry = entryFor(id); } catch (error) { return Promise.reject(error); }
    if (generation !== entry.connectionGeneration) return Promise.resolve(staleResult());
    let inbound;
    try { inbound = normalizeInbound(value); } catch (error) { return Promise.reject(error); }
    // adapter.connect 必须先返回 generation-bound session 再消费帧；提前 await
    // onReceive/onDecision 会与本通道串行队列互锁，因此这里立即 fail-closed。
    if (entry.state !== 'connected' || !entry.session) {
      return Promise.resolve({ accepted: false, reasonCode: 'connection-not-ready' });
    }
    return enqueueInbound(entry, inbound.retainedBytes, async () => {
      if (generation !== entry.connectionGeneration) return staleResult();
      if (!entry.enabled || entry.state !== 'connected') return markUnauthorized(entry, 'channel-offline');
      if (!actorAuthorized(entry, inbound.actorId)) {
        const reasonCode = await requestBinding(entry, inbound.actorId, generation);
        return markUnauthorized(entry, reasonCode);
      }
      const classified = await trustedSensitivity(entry, 'receive', inbound.kind);
      if (!classified.ok) return { accepted: false, reasonCode: classified.reasonCode };
      if (classified.sensitivity === 'customer' && entry.id !== 'web') {
        increment(entry, 'policyDropped');
        audit(entry, 'policy-dropped', 'customer-web-only');
        changed();
        return { accepted: false, reasonCode: 'customer-web-only' };
      }
      try {
        await deadline(
          () => receiveSink(Object.freeze({
            channelId: entry.id,
            kind: inbound.kind,
            sensitivity: classified.sensitivity,
            content: inbound.content
          }), Object.freeze({ signal: entry.abortController && entry.abortController.signal })),
          {
            signal: entry.abortController && entry.abortController.signal,
            timeoutMs: operationTimeoutMs,
            timeoutCode: 'ERR_REMOTE_RECEIVE_TIMEOUT'
          }
        );
      } catch (_error) {
        await failEntry(entry, 'receive-failed');
        throw remoteError('远程收件未完成', 'ERR_REMOTE_RECEIVE');
      }
      increment(entry, 'received');
      audit(entry, 'received');
      changed();
      return { accepted: true };
    });
  }

  function receive(id, value) {
    let entry;
    try { entry = entryFor(id); } catch (error) { return Promise.reject(error); }
    return receiveFromGeneration(entry.id, entry.connectionGeneration, value);
  }

  function confirmBinding(id, value) {
    let confirmation;
    try { confirmation = normalizeBindingConfirmation(value); }
    catch (error) { return Promise.reject(error); }
    let entry;
    try { entry = entryFor(id); } catch (error) { return Promise.reject(error); }
    return enqueueEntry(entry, async () => {
      if (pendingBindingExpired(entry)) clearPendingBinding(entry);
      if (entry.binding !== 'pending' || !entry.pendingActorId || !entry.pendingBindingToken
          || entry.pendingBindingToken !== confirmation.bindingToken
          || entry.pendingBindingChallenge !== confirmation.challengeCode
          || entry.pendingBindingGeneration !== entry.connectionGeneration
          || entry.state !== 'connected') {
        throw remoteError('没有匹配的待确认绑定', 'ERR_REMOTE_BINDING');
      }
      const actorId = entry.pendingActorId;
      const persisted = await persistConfirmedBinding(entry, actorId);
      if (persisted.pending) {
        throw remoteError('绑定仍在安全保存，请等待状态更新', 'ERR_REMOTE_BINDING_PENDING');
      }
      if (!persisted.ok) {
        throw remoteError('绑定未能安全保存', 'ERR_REMOTE_BINDING_PERSIST');
      }
      return snapshot();
    });
  }

  function rejectBinding(id, bindingToken) {
    let token;
    try { token = fixedString(bindingToken, '绑定确认标识', 128); }
    catch (error) { return Promise.reject(error); }
    let entry;
    try { entry = entryFor(id); } catch (error) { return Promise.reject(error); }
    return enqueueEntry(entry, async () => {
      if (entry.bindingCommit) {
        throw remoteError('绑定仍在安全保存，暂不能拒绝', 'ERR_REMOTE_BINDING_PENDING');
      }
      if (pendingBindingExpired(entry)) clearPendingBinding(entry);
      if (entry.binding !== 'pending' || entry.pendingBindingToken !== token
          || entry.pendingBindingGeneration !== entry.connectionGeneration) {
        throw remoteError('没有匹配的待确认绑定', 'ERR_REMOTE_BINDING');
      }
      clearPendingBinding(entry);
      audit(entry, 'binding-rejected');
      changed();
      return snapshot();
    });
  }

  function rememberApproval(token, state) {
    const key = approvalKey(token);
    approvalLedger.set(key, state);
    while (approvalLedger.size > MAX_APPROVAL_LEDGER) {
      const oldest = approvalLedger.keys().next().value;
      approvalLedger.delete(oldest);
    }
  }

  function approvalState(token) {
    return approvalLedger.get(approvalKey(token));
  }

  function enqueueApproval(token, work) {
    const key = approvalKey(token);
    const previous = approvalSerial.get(key) || Promise.resolve();
    const run = previous.then(work);
    const tail = run.catch(() => {});
    approvalSerial.set(key, tail);
    return run.finally(() => {
      if (approvalSerial.get(key) === tail) approvalSerial.delete(key);
    });
  }

  async function replyApproval(entry, payload) {
    try {
      await adapterOperation(entry, 'approve', Object.freeze(payload));
      return true;
    } catch (_error) {
      await failEntry(entry, 'approval-reply-failed');
      return false;
    }
  }

  function forgetApproval(token) {
    approvalLedger.delete(approvalKey(token));
  }

  function normalizeApprovalResult(value, requestedDecision) {
    if (!isRecord(value)) return { status: 'uncertain' };
    if (Object.keys(value).some((key) => !['status', 'decision'].includes(key))) {
      return { status: 'uncertain' };
    }
    if (value.status === 'not-pending' || value.status === 'uncertain') {
      return { status: value.status };
    }
    if (value.status === 'applied' && value.decision === requestedDecision) {
      return { status: 'applied', decision: value.decision };
    }
    if (value.status === 'duplicate'
        && (value.decision === 'adopt' || value.decision === 'redo')) {
      return { status: 'duplicate', decision: value.decision };
    }
    return { status: 'uncertain' };
  }

  function applyLateApprovalResult(entry, request, result) {
    if (result.status === 'applied' || result.status === 'duplicate') {
      rememberApproval(request.requestToken, result.decision);
      if (result.status === 'applied') increment(entry, 'approved');
      audit(entry, 'approval-reconciled', result.status);
      changed();
    } else if (result.status === 'not-pending') {
      forgetApproval(request.requestToken);
    } else {
      rememberApproval(request.requestToken, 'uncertain');
    }
  }

  async function applyAuthoritativeApproval(entry, request) {
    const raw = Promise.resolve().then(() => applyApproval(Object.freeze({
      channelId: entry.id,
      requestToken: request.requestToken,
      decision: request.decision,
      commitId: approvalKey(request.requestToken)
    })));
    const outcome = raw.then(
      (value) => normalizeApprovalResult(value, request.decision),
      () => ({ status: 'uncertain' })
    );
    try {
      return await deadline(
        () => outcome,
        {
          signal: entry.abortController && entry.abortController.signal,
          timeoutMs: operationTimeoutMs,
          timeoutCode: 'ERR_REMOTE_APPROVAL_APPLY_TIMEOUT'
        }
      );
    } catch (_error) {
      // 超时/断线只是回执未知，apply 原始事务仍可能落定。继续观察同一
      // promise，不再次调 apply；权威层依 commitId 幂等，重启后返回 duplicate。
      void outcome.then((result) => applyLateApprovalResult(entry, request, result));
      return { status: 'uncertain' };
    }
  }

  function approveFromGeneration(id, generation, value) {
    let entry;
    try { entry = entryFor(id); } catch (error) { return Promise.reject(error); }
    if (generation !== entry.connectionGeneration) return Promise.resolve(staleResult());
    let request;
    try { request = normalizeDecision(value); } catch (error) { return Promise.reject(error); }
    if (entry.state !== 'connected' || !entry.session) {
      return Promise.resolve({ accepted: false, reasonCode: 'connection-not-ready' });
    }
    return enqueueInbound(entry, request.retainedBytes, async () => {
      if (generation !== entry.connectionGeneration) return staleResult();
      if (!entry.enabled || entry.state !== 'connected') return markUnauthorized(entry, 'channel-offline');
      if (!actorAuthorized(entry, request.actorId)) return markUnauthorized(entry, 'not-bound');
      const classified = await trustedSensitivity(entry, 'approve', 'approval');
      if (!classified.ok) return { accepted: false, reasonCode: classified.reasonCode };
      if (classified.sensitivity === 'customer' && entry.id !== 'web') {
        increment(entry, 'policyDropped');
        audit(entry, 'policy-dropped', 'customer-web-only');
        changed();
        return { accepted: false, reasonCode: 'customer-web-only' };
      }

      return enqueueApproval(request.requestToken, async () => {
        if (generation !== entry.connectionGeneration || entry.state !== 'connected') {
          return staleResult();
        }
        if (!actorAuthorized(entry, request.actorId)) return markUnauthorized(entry, 'not-bound');
        const previous = approvalState(request.requestToken);
        if (previous === 'adopt' || previous === 'redo') {
          const acknowledged = await replyApproval(entry, {
            requestToken: request.requestToken,
            outcome: previous,
            reply: previous === 'adopt' ? '已采用' : '已要求重来'
          });
          return { accepted: true, decision: previous, duplicate: true, acknowledged };
        }
        if (previous === 'processing' || previous === 'uncertain') {
          await replyApproval(entry, {
            requestToken: request.requestToken,
            outcome: 'unknown',
            reply: '状态不确定，回桌面处理'
          });
          return { accepted: false, reasonCode: 'approval-uncertain' };
        }

        if (request.decision === 'unknown') {
          const acknowledged = await replyApproval(entry, {
            requestToken: request.requestToken,
            outcome: 'unknown',
            reply: '没看懂，回桌面处理'
          });
          audit(entry, 'approval-unknown', 'unknown-reply');
          return {
            accepted: false,
            reasonCode: acknowledged ? 'unknown-reply' : 'approval-reply-failed'
          };
        }

        // 权威层用一个持久、幂等的 apply 同时完成「仍 pending」校验与
        // 既有确认机制落定，避免先 consume 再 sink 造成永久丢动作。
        rememberApproval(request.requestToken, 'processing');
        const applied = await applyAuthoritativeApproval(entry, request);
        if (applied.status === 'not-pending') {
          forgetApproval(request.requestToken);
          await replyApproval(entry, {
            requestToken: request.requestToken,
            outcome: 'unknown',
            reply: '没看懂，回桌面处理'
          });
          audit(entry, 'approval-rejected', 'approval-not-pending');
          return { accepted: false, reasonCode: 'approval-not-pending' };
        }
        if (applied.status === 'uncertain') {
          rememberApproval(request.requestToken, 'uncertain');
          increment(entry, 'errors');
          audit(entry, 'approval-uncertain', 'approval-uncertain');
          changed();
          await replyApproval(entry, {
            requestToken: request.requestToken,
            outcome: 'unknown',
            reply: '状态不确定，回桌面处理'
          });
          return { accepted: false, reasonCode: 'approval-uncertain' };
        }
        rememberApproval(request.requestToken, applied.decision);
        if (applied.status === 'applied') increment(entry, 'approved');
        audit(entry, 'approved');
        changed();
        const acknowledged = await replyApproval(entry, {
          requestToken: request.requestToken,
          outcome: applied.decision,
          reply: applied.decision === 'adopt' ? '已采用' : '已要求重来'
        });
        return {
          accepted: true,
          decision: applied.decision,
          duplicate: applied.status === 'duplicate',
          acknowledged
        };
      });
    });
  }

  function approve(id, value) {
    let entry;
    try { entry = entryFor(id); } catch (error) { return Promise.reject(error); }
    return approveFromGeneration(entry.id, entry.connectionGeneration, value);
  }

  function pushAllowed(entry, item) {
    if (!entry.enabled || entry.state !== 'connected' || entry.binding !== 'bound') return 'channel-unavailable';
    if (!policy.notificationsEnabled) return 'notifications-disabled';
    if (policy.quietMode && entry.id !== 'web') return 'quiet-mode';
    if (item.kind === 'approval' && !policy.allowApprovals) return 'kind-disabled';
    if (item.kind === 'task-completed' && !policy.allowTaskCompletions) return 'kind-disabled';
    if (item.kind === 'report-ready' && !policy.allowReports) return 'kind-disabled';
    return null;
  }

  async function pushToEntry(entry, item) {
    const startedPolicyVersion = policyVersion;
    const initialReason = pushAllowed(entry, item);
    if (initialReason) {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', initialReason);
      return { channelId: entry.id, delivered: false, reasonCode: initialReason };
    }
    const classified = await trustedSensitivity(entry, 'push', item.kind);
    if (!classified.ok) {
      return { channelId: entry.id, delivered: false, reasonCode: classified.reasonCode };
    }
    if (classified.sensitivity === 'customer' && entry.id !== 'web') {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', 'customer-web-only');
      return { channelId: entry.id, delivered: false, reasonCode: 'customer-web-only' };
    }
    // 分级可能是异步的；真正交给 session 前必须按最新策略再判一次。
    if (policyVersion !== startedPolicyVersion) {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', 'policy-changed');
      return { channelId: entry.id, delivered: false, reasonCode: 'policy-changed' };
    }
    const finalReason = pushAllowed(entry, item);
    if (finalReason) {
      increment(entry, 'policyDropped');
      audit(entry, 'policy-dropped', finalReason);
      return { channelId: entry.id, delivered: false, reasonCode: finalReason };
    }
    try {
      await adapterOperation(entry, 'push', Object.freeze({
        ...item,
        sensitivity: classified.sensitivity
      }), () => policyVersion === startedPolicyVersion
        ? pushAllowed(entry, item) : 'policy-changed');
      increment(entry, 'pushed');
      audit(entry, 'pushed');
      return { channelId: entry.id, delivered: true };
    } catch (error) {
      if (error && error.code === 'ERR_REMOTE_POLICY_CHANGED') {
        const reasonCode = safeReason(error.message, 'policy-changed');
        increment(entry, 'policyDropped');
        audit(entry, 'policy-dropped', reasonCode);
        return { channelId: entry.id, delivered: false, reasonCode };
      }
      if (!entry.enabled || closing) {
        return { channelId: entry.id, delivered: false, reasonCode: 'channel-unavailable' };
      }
      await failEntry(entry, 'push-failed');
      return { channelId: entry.id, delivered: false, reasonCode: 'push-failed' };
    }
  }

  function push(value) {
    let item;
    try {
      assertUsable();
      item = normalizePush(value);
    } catch (error) { return Promise.reject(error); }
    const retainedBytes = Buffer.byteLength(item.body, 'utf8')
      + (item.dedupeKey ? Buffer.byteLength(item.dedupeKey, 'utf8') : 0);
    const operations = CHANNELS.map((id) => {
      const entry = channels.get(id);
      return enqueueOutbound(entry, retainedBytes, () => pushToEntry(entry, item));
    });
    return Promise.all(operations).then((results) => {
      changed();
      return {
        delivered: results.filter((value) => value.delivered).map((value) => value.channelId),
        skipped: results.filter((value) => !value.delivered).map((value) => ({
          channelId: value.channelId,
          reasonCode: value.reasonCode
        }))
      };
    });
  }

  function disconnectAll() {
    try { assertUsable(); } catch (error) { return Promise.reject(error); }
    for (const entry of channels.values()) {
      entry.enabled = false;
      entry.lifecycleVersion += 1;
      invalidateConnection(entry);
    }
    changed();
    const operations = CHANNELS.map((id) => {
      const entry = channels.get(id);
      return enqueueEntry(entry, () => disconnectEntry(entry, 'disconnect-all', true));
    });
    return Promise.allSettled(operations).then((results) => {
      if (results.some((value) => value.status === 'rejected')) {
        throw remoteError('部分远程通道未确认断开', 'ERR_REMOTE_DISCONNECT');
      }
      return snapshot();
    });
  }

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    for (const entry of channels.values()) {
      entry.enabled = false;
      entry.lifecycleVersion += 1;
      invalidateConnection(entry);
    }
    changed();
    const operations = CHANNELS.map((id) => {
      const entry = channels.get(id);
      return enqueueEntry(entry, () => disconnectEntry(entry, 'service-close', true), true);
    });
    closePromise = Promise.allSettled(operations).then((results) => {
      closed = true;
      if (results.some((value) => value.status === 'rejected')) {
        throw remoteError('远程服务关闭不完整', 'ERR_REMOTE_DISCONNECT');
      }
      return snapshot();
    });
    return closePromise;
  }

  return Object.freeze({
    registerAdapter,
    setEnabled,
    configurePolicy,
    receive,
    push,
    approve,
    confirmBinding,
    rejectBinding,
    disconnectAll,
    close,
    snapshot
  });
}

// 仅供 smoke / 离线侦察。生产 main 不注册它，避免把假通道画成真在线。
function createLoopbackAdapter() {
  let active = null;
  const pushed = [];
  const approvals = [];
  const bindingChallenges = [];
  const adapter = {
    async connect(value) {
      if (!isRecord(value) || typeof value.onReceive !== 'function'
          || typeof value.onDecision !== 'function' || typeof value.onClose !== 'function'
          || typeof value.onError !== 'function' || !value.signal) {
        throw remoteError('回环连接参数无效');
      }
      const record = { hooks: value, connected: true, abortListener: null };
      record.abortListener = () => { record.connected = false; };
      value.signal.addEventListener('abort', record.abortListener, { once: true });
      const ensureConnected = () => {
        if (!record.connected) throw remoteError('回环通道未连接');
      };
      const session = Object.freeze({
        async disconnect() {
          record.connected = false;
          value.signal.removeEventListener('abort', record.abortListener);
          if (active === record) active = null;
        },
        async push(payload) {
          ensureConnected();
          pushed.push(payload);
        },
        async approve(payload) {
          ensureConnected();
          approvals.push(payload);
        },
        async challengeBinding(payload) {
          ensureConnected();
          bindingChallenges.push(payload);
        }
      });
      record.session = session;
      active = record;
      return session;
    }
  };
  return Object.freeze({
    adapter,
    emitReceive: (value) => {
      if (!active || !active.connected) throw remoteError('回环通道未连接');
      return active.hooks.onReceive(value);
    },
    emitDecision: (value) => {
      if (!active || !active.connected) throw remoteError('回环通道未连接');
      return active.hooks.onDecision(value);
    },
    emitClose: (reasonCode) => {
      if (!active) throw remoteError('回环通道未连接');
      return active.hooks.onClose(reasonCode);
    },
    emitError: (reasonCode) => {
      if (!active) throw remoteError('回环通道未连接');
      return active.hooks.onError(reasonCode);
    },
    snapshot: () => ({
      connected: Boolean(active && active.connected),
      pushed: pushed.slice(),
      approvals: approvals.slice(),
      bindingChallenges: bindingChallenges.slice()
    })
  });
}

module.exports = {
  createRemoteService,
  createLoopbackAdapter,
  decisionFromReply,
  CHANNELS,
  PUSH_KINDS,
  STATES,
  BINDINGS,
  SENSITIVITIES,
  INBOUND_KINDS
};
