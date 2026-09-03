'use strict';

// v0.10 Host ↔ main 文件能力的纯 Node 状态机。它不读写文件，也不知道
// Electron；main 只能注册高层 operation handler，页面不能把路径或通用
// front matter patch 塞进通道。
const crypto = require('crypto');

const STATES = Object.freeze({
  queued: 'queued',
  running: 'running',
  fulfilled: 'fulfilled',
  rejected: 'rejected'
});

const DEFAULT_LIMITS = Object.freeze({
  maxActive: 32,
  maxTotal: 64,
  maxPerController: 4,
  maxReadBatch: 4,
  maxInputBytes: 4 * 1024,
  maxResultBytes: 6 * 1024,
  maxJsonDepth: 8,
  maxJsonNodes: 512,
  maxJsonKeyChars: 64,
  maxOperations: 32,
  maxTokenAttempts: 8,
  queueTtlMs: 10_000,
  leaseTtlMs: 10_000,
  resultTtlMs: 30_000
});

const LIMIT_CEILINGS = Object.freeze({
  maxActive: 256,
  maxTotal: 512,
  maxPerController: 32,
  maxReadBatch: 16,
  maxInputBytes: 8 * 1024,
  maxResultBytes: 8 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 4096,
  maxJsonKeyChars: 128,
  maxOperations: 64,
  maxTokenAttempts: 32,
  queueTtlMs: 60_000,
  leaseTtlMs: 60_000,
  resultTtlMs: 300_000
});

// 只有显式登记的项目/控制室 operation 可以使用这组更高预算。broker 的
// 默认 4/6 KiB 不变，避免旧 21 个内容 operation 被整体放宽。
const OPERATION_LIMIT_CEILINGS = Object.freeze({
  maxInputBytes: 48 * 1024,
  maxResultBytes: 64 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 8192,
  maxJsonKeyChars: 128
});

const GLOBAL_BINDING_KEYS = Object.freeze([
  'hostInstanceId', 'controllerId', 'pageInstanceId', 'selectionRevision'
]);
const WORKSPACE_BINDING_KEYS = Object.freeze([
  'hostInstanceId', 'controllerId', 'pageInstanceId', 'selectionRevision',
  'projectId', 'contextRevision', 'workspaceGeneration', 'rootIdentity'
]);
const ROOT_IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROJECT_ID_RE = /^wdp1_[a-f0-9]{32}$/;
const DEVICE_ID_RE = /^[0-9]{1,40}$/;
const OPERATION_RE = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31}){1,3}$/;
const CODE_RE = /^[a-z][a-z0-9-]{0,63}$/;
const REQUEST_TOKEN_RE = /^file-request-[a-f0-9]{64}$/;
const CLAIM_TOKEN_RE = /^file-claim-[a-f0-9]{64}$/;
const TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FORBIDDEN_OPERATION_PARTS = new Set([
  'file', 'files', 'filesystem', 'fs', 'path', 'frontmatter', 'front-matter', 'patch'
]);
const FORBIDDEN_INPUT_KEYS = new Set([
  '__proto__', 'prototype', 'constructor',
  'path', 'filepath', 'relativepath', 'absolutepath', 'effectivepath',
  'root', 'rootpath', 'cwd', 'workspacekey', 'frontmatter', 'patch',
  'context', 'envelope', 'hash', 'dev', 'ino'
]);
const FORBIDDEN_RESULT_KEYS = new Set([
  ...FORBIDDEN_INPUT_KEYS,
  'requestseq', 'claimtoken', 'authtoken', 'selectiontoken', 'controllerproof',
  'sessionref', 'currentsessionid', 'rawsession', 'contextbody', 'frozentext',
  'dev', 'ino'
]);

function rpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return isPlainObject(value)
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => keys.includes(key));
}

function finiteSafeInteger(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function canonicalFieldName(value) {
  return value.toLowerCase().replace(/[-_]/g, '');
}

function checkedNow(now) {
  const value = now();
  if (!finiteSafeInteger(value, 0)) throw rpcError('ERR_CLOCK_INVALID', '时钟返回值无效');
  return value;
}

function deadlineFrom(at, duration) {
  const deadline = at + duration;
  if (!Number.isSafeInteger(deadline) || deadline < at) {
    throw rpcError('ERR_CLOCK_INVALID', '时钟无法生成安全截止时间');
  }
  return deadline;
}

function immutableJson(value, options, depth = 0, counter = { value: 0 }) {
  counter.value += 1;
  if (counter.value > options.maxNodes || depth > options.maxDepth) {
    throw rpcError('ERR_JSON_LIMIT', 'JSON 投影超过复杂度上限');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (TEXT_CONTROL_RE.test(value)) throw rpcError('ERR_JSON_FIELD', 'JSON 文本含禁止控制字符');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutableJson(entry, options, depth + 1, counter)));
  }
  if (!isPlainObject(value)) throw rpcError('ERR_JSON_SHAPE', 'JSON 投影不是纯数据');
  const result = {};
  for (const key of Object.keys(value)) {
    const normalized = canonicalFieldName(key);
    if (typeof key !== 'string' || key.length < 1 || key.length > options.maxKeyChars
        || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)
        || options.forbiddenKeys.has(normalized)) {
      throw rpcError('ERR_JSON_FIELD', 'JSON 投影含有禁止字段');
    }
    result[key] = immutableJson(value[key], options, depth + 1, counter);
  }
  return Object.freeze(result);
}

function jsonBytes(value) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch (_error) { throw rpcError('ERR_JSON_SHAPE', 'JSON 投影无法序列化'); }
  if (typeof serialized !== 'string') throw rpcError('ERR_JSON_SHAPE', 'JSON 投影无法序列化');
  return Buffer.byteLength(serialized, 'utf8');
}

function normalizeBinding(value) {
  const commonValid = isPlainObject(value)
      && typeof value.hostInstanceId === 'string' && ID_RE.test(value.hostInstanceId)
      && typeof value.controllerId === 'string' && ID_RE.test(value.controllerId)
      && typeof value.pageInstanceId === 'string' && ID_RE.test(value.pageInstanceId)
      && finiteSafeInteger(value.selectionRevision, 1);
  if (commonValid !== true) {
    throw rpcError('ERR_BINDING_INVALID', '文件 RPC 作用域绑定无效');
  }
  if (exactKeys(value, GLOBAL_BINDING_KEYS)) {
    return Object.freeze({
      hostInstanceId: value.hostInstanceId,
      controllerId: value.controllerId,
      pageInstanceId: value.pageInstanceId,
      selectionRevision: value.selectionRevision
    });
  }
  if (!exactKeys(value, WORKSPACE_BINDING_KEYS)
      || typeof value.projectId !== 'string' || !PROJECT_ID_RE.test(value.projectId)
      || !finiteSafeInteger(value.contextRevision, 1)
      || !finiteSafeInteger(value.workspaceGeneration, 0)
      || !exactKeys(value.rootIdentity, ROOT_IDENTITY_KEYS)
      || typeof value.rootIdentity.dev !== 'string' || !DEVICE_ID_RE.test(value.rootIdentity.dev)
      || typeof value.rootIdentity.ino !== 'string' || !DEVICE_ID_RE.test(value.rootIdentity.ino)) {
    throw rpcError('ERR_BINDING_INVALID', '文件 RPC 作用域绑定无效');
  }
  return Object.freeze({
    hostInstanceId: value.hostInstanceId,
    controllerId: value.controllerId,
    pageInstanceId: value.pageInstanceId,
    selectionRevision: value.selectionRevision,
    projectId: value.projectId,
    contextRevision: value.contextRevision,
    workspaceGeneration: value.workspaceGeneration,
    rootIdentity: Object.freeze({
      dev: String(value.rootIdentity.dev),
      ino: String(value.rootIdentity.ino)
    })
  });
}

function sameBinding(left, right) {
  if (!left || !right) return false;
  const leftGlobal = exactKeys(left, GLOBAL_BINDING_KEYS);
  const rightGlobal = exactKeys(right, GLOBAL_BINDING_KEYS);
  if (leftGlobal || rightGlobal) {
    return leftGlobal && rightGlobal
      && GLOBAL_BINDING_KEYS.every((key) => left[key] === right[key]);
  }
  return exactKeys(left, WORKSPACE_BINDING_KEYS)
    && exactKeys(right, WORKSPACE_BINDING_KEYS)
    && WORKSPACE_BINDING_KEYS.slice(0, -1).every((key) => left[key] === right[key])
    && left.rootIdentity.dev === right.rootIdentity.dev
    && left.rootIdentity.ino === right.rootIdentity.ino;
}

function normalizeLimits(overrides) {
  if (overrides === undefined) return DEFAULT_LIMITS;
  if (!isPlainObject(overrides)
      || Object.keys(overrides).some((key) => !Object.hasOwn(DEFAULT_LIMITS, key))) {
    throw rpcError('ERR_LIMITS_INVALID', '文件 RPC 上限配置无效');
  }
  const merged = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (!finiteSafeInteger(value, 1) || value > LIMIT_CEILINGS[key]) {
      throw rpcError('ERR_LIMITS_INVALID', '文件 RPC 上限配置无效');
    }
  }
  if (merged.maxPerController > merged.maxActive
      || merged.maxActive > merged.maxTotal
      || merged.maxReadBatch > merged.maxActive) {
    throw rpcError('ERR_LIMITS_INVALID', '文件 RPC 容量上限关系无效');
  }
  return Object.freeze(merged);
}

function normalizeOperationName(value) {
  if (typeof value !== 'string' || !OPERATION_RE.test(value)
      || value.split('.').some((part) => (
        FORBIDDEN_OPERATION_PARTS.has(canonicalFieldName(part))
        || part.split('-').some((piece) => FORBIDDEN_OPERATION_PARTS.has(piece))
      ))) {
    throw rpcError('ERR_OPERATION_INVALID', '只允许已登记的高层文件操作');
  }
  return value;
}

function normalizeDescriptorLimits(value, baseLimits) {
  const keys = Object.keys(OPERATION_LIMIT_CEILINGS);
  if (value === undefined) {
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, baseLimits[key]])));
  }
  if (!isPlainObject(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw rpcError('ERR_HANDLER_INVALID', 'operation 独立上限无效');
  }
  const merged = Object.fromEntries(keys.map((key) => [key,
    Object.hasOwn(value, key) ? value[key] : baseLimits[key]
  ]));
  for (const [key, entry] of Object.entries(merged)) {
    if (!finiteSafeInteger(entry, 1) || entry > OPERATION_LIMIT_CEILINGS[key]) {
      throw rpcError('ERR_HANDLER_INVALID', 'operation 独立上限无效');
    }
  }
  return Object.freeze(merged);
}

function normalizeDescriptor(value, baseLimits) {
  if (!isPlainObject(value)) throw rpcError('ERR_HANDLER_INVALID', '高层 operation handler 无效');
  const keys = Object.keys(value);
  if (!['validate', 'handle', 'redact'].every((key) => typeof value[key] === 'function')
      || (value.errorCode !== undefined && typeof value.errorCode !== 'function')
      || keys.some((key) => !['validate', 'handle', 'redact', 'errorCode', 'limits'].includes(key))) {
    throw rpcError('ERR_HANDLER_INVALID', '高层 operation handler 无效');
  }
  return Object.freeze({
    validate: value.validate,
    handle: value.handle,
    redact: value.redact,
    errorCode: value.errorCode || null,
    limits: normalizeDescriptorLimits(value.limits, baseLimits)
  });
}

function publicSnapshot(record, requestToken = record && record.requestToken) {
  if (!record) {
    return Object.freeze({
      requestToken,
      state: STATES.rejected,
      code: 'request-unavailable',
      result: null
    });
  }
  return Object.freeze({
    requestToken: record.requestToken,
    state: record.state,
    code: record.code,
    result: record.state === STATES.fulfilled ? record.result : null
  });
}

function createContextFileRpcBroker(options = {}) {
  if (!isPlainObject(options)) throw rpcError('ERR_OPTIONS_INVALID', '文件 RPC 选项无效');
  const allowedOptions = new Set(['operations', 'now', 'randomBytes', 'limits']);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw rpcError('ERR_OPTIONS_INVALID', '文件 RPC 选项无效');
  }
  const now = options.now === undefined ? Date.now : options.now;
  const randomBytes = options.randomBytes === undefined ? crypto.randomBytes : options.randomBytes;
  if (typeof now !== 'function' || typeof randomBytes !== 'function') {
    throw rpcError('ERR_OPTIONS_INVALID', '文件 RPC 时钟或随机源无效');
  }
  const limits = normalizeLimits(options.limits);
  const operations = new Map();
  const records = new Map();
  const requestSeqs = new Set();
  const claimTokens = new Set();

  const randomBuffer = (size) => {
    let value;
    try { value = randomBytes(size); }
    catch (_error) { throw rpcError('ERR_RANDOM_INVALID', '文件 RPC 随机源失败'); }
    if (!Buffer.isBuffer(value) || value.length !== size) {
      throw rpcError('ERR_RANDOM_INVALID', '文件 RPC 随机源返回值无效');
    }
    return value;
  };

  const mintToken = (prefix, active) => {
    for (let attempt = 0; attempt < limits.maxTokenAttempts; attempt += 1) {
      const token = `${prefix}${randomBuffer(32).toString('hex')}`;
      if (!active.has(token)) return token;
    }
    throw rpcError('ERR_RANDOM_COLLISION', '文件 RPC 随机 token 冲突');
  };

  const mintRequestSeq = () => {
    for (let attempt = 0; attempt < limits.maxTokenAttempts; attempt += 1) {
      const bytes = randomBuffer(6);
      const value = bytes.readUIntBE(0, 6) || 1;
      if (!requestSeqs.has(value)) return value;
    }
    throw rpcError('ERR_RANDOM_COLLISION', '文件 RPC 随机 seq 冲突');
  };

  const terminalize = (record, state, code, result, at) => {
    const retireAtMs = deadlineFrom(at, limits.resultTtlMs);
    if (record.claimToken) claimTokens.delete(record.claimToken);
    record.state = state;
    record.code = code;
    record.result = result;
    record.finishedAtMs = at;
    record.retireAtMs = retireAtMs;
    record.claimToken = null;
    record.leaseDeadlineMs = null;
    record.executing = false;
    record.input = null;
  };

  const sweepAt = (at) => {
    let expired = 0;
    let removed = 0;
    for (const [requestToken, record] of records) {
      if (record.state === STATES.queued && at >= record.deadlineMs) {
        terminalize(record, STATES.rejected, 'request-expired', null, at);
        expired += 1;
      } else if (record.state === STATES.running && at >= record.leaseDeadlineMs) {
        // 不声称底层工作已取消，只把可确认结果记为 unknown。
        terminalize(record, STATES.rejected, 'outcome-unknown', null, at);
        expired += 1;
      } else if ((record.state === STATES.fulfilled || record.state === STATES.rejected)
          && at >= record.retireAtMs) {
        records.delete(requestToken);
        requestSeqs.delete(record.requestSeq);
        removed += 1;
      }
    }
    return Object.freeze({ expired, removed });
  };

  const sweep = () => sweepAt(checkedNow(now));

  const normalizeOwnerRequest = (value, keys) => {
    if (!exactKeys(value, ['binding', ...keys])) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC 请求形状无效');
    }
    return { ...value, binding: normalizeBinding(value.binding) };
  };

  const ownedRecord = (requestToken, binding) => {
    const record = records.get(requestToken);
    return record && sameBinding(record.binding, binding) ? record : null;
  };

  const registerOperation = (name, descriptor) => {
    const operation = normalizeOperationName(name);
    if (operations.has(operation)) throw rpcError('ERR_OPERATION_EXISTS', 'operation 已登记');
    if (operations.size >= limits.maxOperations) {
      throw rpcError('ERR_OPERATION_CAPACITY', 'operation 登记数超过上限');
    }
    operations.set(operation, normalizeDescriptor(descriptor, limits));
    return operation;
  };

  const enqueue = (raw) => {
    if (!exactKeys(raw, ['binding', 'operation', 'input'])) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC 入队请求无效');
    }
    const binding = normalizeBinding(raw.binding);
    const operation = normalizeOperationName(raw.operation);
    const descriptor = operations.get(operation);
    if (!descriptor) throw rpcError('ERR_OPERATION_UNAVAILABLE', 'operation 未登记');
    let candidate;
    try {
      candidate = immutableJson(raw.input, {
        maxDepth: descriptor.limits.maxJsonDepth,
        maxNodes: descriptor.limits.maxJsonNodes,
        maxKeyChars: descriptor.limits.maxJsonKeyChars,
        forbiddenKeys: FORBIDDEN_INPUT_KEYS
      });
    } catch (_error) {
      throw rpcError('ERR_INPUT_INVALID', 'operation 输入不是允许的高层数据');
    }
    if (jsonBytes(candidate) > descriptor.limits.maxInputBytes) {
      throw rpcError('ERR_INPUT_TOO_LARGE', 'operation 输入超过上限');
    }
    let validated;
    try { validated = descriptor.validate(candidate); }
    catch (_error) { throw rpcError('ERR_INPUT_INVALID', 'operation 输入未通过校验'); }
    let input;
    try {
      input = immutableJson(validated, {
        maxDepth: descriptor.limits.maxJsonDepth,
        maxNodes: descriptor.limits.maxJsonNodes,
        maxKeyChars: descriptor.limits.maxJsonKeyChars,
        forbiddenKeys: FORBIDDEN_INPUT_KEYS
      });
    } catch (_error) {
      throw rpcError('ERR_INPUT_INVALID', 'operation 输入不是允许的高层数据');
    }
    if (jsonBytes(input) > descriptor.limits.maxInputBytes) {
      throw rpcError('ERR_INPUT_TOO_LARGE', 'operation 输入超过上限');
    }
    const at = checkedNow(now);
    sweepAt(at);
    const active = [...records.values()].filter((record) => (
      record.state === STATES.queued || record.state === STATES.running
    ));
    const ownedActive = active.filter((record) => (
      record.binding.hostInstanceId === binding.hostInstanceId
      && record.binding.controllerId === binding.controllerId
    ));
    if (records.size >= limits.maxTotal || active.length >= limits.maxActive
        || ownedActive.length >= limits.maxPerController) {
      throw rpcError('ERR_CAPACITY', '文件 RPC 队列已满');
    }
    const requestToken = mintToken('file-request-', records);
    const requestSeq = mintRequestSeq();
    const deadlineMs = deadlineFrom(at, limits.queueTtlMs);
    requestSeqs.add(requestSeq);
    const record = {
      requestToken,
      requestSeq,
      binding,
      operation,
      descriptor,
      input,
      state: STATES.queued,
      code: null,
      result: null,
      issuedAtMs: at,
      deadlineMs,
      claimToken: null,
      leaseDeadlineMs: null,
      executing: false,
      finishedAtMs: null,
      retireAtMs: null
    };
    records.set(requestToken, record);
    return publicSnapshot(record);
  };

  const read = (raw) => {
    const request = normalizeOwnerRequest(raw, ['limit']);
    if (!finiteSafeInteger(request.limit, 1) || request.limit > limits.maxReadBatch) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC read limit 无效');
    }
    sweep();
    const items = [];
    for (const record of records.values()) {
      if (items.length >= request.limit) break;
      if (record.state !== STATES.queued || !sameBinding(record.binding, request.binding)) continue;
      items.push(Object.freeze({
        requestToken: record.requestToken,
        requestSeq: record.requestSeq,
        operation: record.operation,
        input: record.input,
        binding: record.binding,
        issuedAtMs: record.issuedAtMs,
        deadlineMs: record.deadlineMs
      }));
    }
    return Object.freeze(items);
  };

  const claim = (raw) => {
    const request = normalizeOwnerRequest(raw, ['requestToken', 'requestSeq']);
    if (typeof request.requestToken !== 'string' || !REQUEST_TOKEN_RE.test(request.requestToken)
        || !finiteSafeInteger(request.requestSeq, 1)) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC claim 无效');
    }
    sweep();
    const record = ownedRecord(request.requestToken, request.binding);
    if (!record || record.requestSeq !== request.requestSeq) {
      return Object.freeze({ claimed: false, code: 'request-unavailable' });
    }
    if (record.state === STATES.running) {
      return Object.freeze({ claimed: false, code: 'already-running' });
    }
    if (record.state !== STATES.queued) {
      return Object.freeze({ claimed: false, code: record.code || 'already-settled' });
    }
    const at = checkedNow(now);
    const leaseDeadlineMs = deadlineFrom(at, limits.leaseTtlMs);
    const claimToken = mintToken('file-claim-', claimTokens);
    claimTokens.add(claimToken);
    record.state = STATES.running;
    record.claimToken = claimToken;
    record.leaseDeadlineMs = leaseDeadlineMs;
    return Object.freeze({
      claimed: true,
      code: null,
      requestToken: record.requestToken,
      requestSeq: record.requestSeq,
      claimToken,
      leaseDeadlineMs: record.leaseDeadlineMs
    });
  };

  const claimMatches = (record, value) => {
    if (!record || record.state !== STATES.running
        || typeof value !== 'string' || !CLAIM_TOKEN_RE.test(value)
        || typeof record.claimToken !== 'string' || !CLAIM_TOKEN_RE.test(record.claimToken)) return false;
    return crypto.timingSafeEqual(
      Buffer.from(value.slice('file-claim-'.length), 'hex'),
      Buffer.from(record.claimToken.slice('file-claim-'.length), 'hex')
    );
  };

  const settle = (raw) => {
    const request = normalizeOwnerRequest(raw, [
      'requestToken', 'requestSeq', 'claimToken', 'status', 'code', 'result'
    ]);
    if (typeof request.requestToken !== 'string' || !REQUEST_TOKEN_RE.test(request.requestToken)
        || !finiteSafeInteger(request.requestSeq, 1)
        || !['fulfilled', 'rejected'].includes(request.status)
        || (request.status === 'fulfilled'
          ? request.code !== null
          : (typeof request.code !== 'string' || !CODE_RE.test(request.code)))
        || (request.status === 'rejected' && request.result !== null)) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC settle 无效');
    }
    const record = ownedRecord(request.requestToken, request.binding);
    if (!record || record.requestSeq !== request.requestSeq
        || !claimMatches(record, request.claimToken)) {
      return Object.freeze({ settled: false, code: 'claim-invalid' });
    }
    if (record.executing) return Object.freeze({ settled: false, code: 'already-running' });
    const at = checkedNow(now);
    if (at >= record.leaseDeadlineMs) {
      terminalize(record, STATES.rejected, 'outcome-unknown', null, at);
      return Object.freeze({ settled: true, code: 'outcome-unknown', snapshot: publicSnapshot(record) });
    }
    if (request.status === 'rejected') {
      terminalize(record, STATES.rejected, request.code, null, at);
      return Object.freeze({ settled: true, code: request.code, snapshot: publicSnapshot(record) });
    }

    let result;
    try {
      result = immutableJson(record.descriptor.redact(request.result), {
        maxDepth: record.descriptor.limits.maxJsonDepth,
        maxNodes: record.descriptor.limits.maxJsonNodes,
        maxKeyChars: record.descriptor.limits.maxJsonKeyChars,
        forbiddenKeys: FORBIDDEN_RESULT_KEYS
      });
      if (jsonBytes(result) > record.descriptor.limits.maxResultBytes) {
        terminalize(record, STATES.rejected, 'result-too-large', null, at);
        return Object.freeze({
          settled: true,
          code: 'result-too-large',
          snapshot: publicSnapshot(record)
        });
      }
    } catch (_error) {
      terminalize(record, STATES.rejected, 'result-invalid', null, at);
      return Object.freeze({ settled: true, code: 'result-invalid', snapshot: publicSnapshot(record) });
    }
    terminalize(record, STATES.fulfilled, null, result, at);
    return Object.freeze({ settled: true, code: null, snapshot: publicSnapshot(record) });
  };

  const execute = async (raw) => {
    const request = normalizeOwnerRequest(raw, [
      'requestToken', 'requestSeq', 'claimToken', 'context'
    ]);
    if (typeof request.requestToken !== 'string' || !REQUEST_TOKEN_RE.test(request.requestToken)
        || !finiteSafeInteger(request.requestSeq, 1)) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC execute 无效');
    }
    const record = ownedRecord(request.requestToken, request.binding);
    if (!record || record.requestSeq !== request.requestSeq
        || !claimMatches(record, request.claimToken)) {
      return Object.freeze({ settled: false, code: 'claim-invalid' });
    }
    if (record.executing) return Object.freeze({ settled: false, code: 'already-running' });
    const startedAt = checkedNow(now);
    if (startedAt >= record.leaseDeadlineMs) {
      terminalize(record, STATES.rejected, 'outcome-unknown', null, startedAt);
      return Object.freeze({
        settled: true,
        code: 'outcome-unknown',
        snapshot: publicSnapshot(record)
      });
    }
    record.executing = true;
    let status = 'fulfilled';
    let code = null;
    let result = null;
    try {
      result = await record.descriptor.handle(Object.freeze({
        input: record.input,
        binding: record.binding,
        context: request.context
      }));
    } catch (error) {
      status = 'rejected';
      code = 'operation-failed';
      if (record.descriptor.errorCode) {
        try {
          const mapped = record.descriptor.errorCode(error);
          if (typeof mapped === 'string' && CODE_RE.test(mapped)) code = mapped;
        } catch (_error) { /* 错误映射器不能泄漏 handler 异常 */ }
      }
    }
    if (record.state !== STATES.running || !claimMatches(record, request.claimToken)) {
      return Object.freeze({ settled: false, code: 'already-settled' });
    }
    record.executing = false;
    return settle({
      binding: request.binding,
      requestToken: request.requestToken,
      requestSeq: request.requestSeq,
      claimToken: request.claimToken,
      status,
      code,
      result: status === 'fulfilled' ? result : null
    });
  };

  const cancel = (raw) => {
    const request = normalizeOwnerRequest(raw, ['requestToken']);
    if (typeof request.requestToken !== 'string' || !REQUEST_TOKEN_RE.test(request.requestToken)) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC cancel 无效');
    }
    const at = checkedNow(now);
    sweepAt(at);
    const record = ownedRecord(request.requestToken, request.binding);
    if (!record) return publicSnapshot(null, request.requestToken);
    if (record.state === STATES.queued) {
      terminalize(record, STATES.rejected, 'request-cancelled', null, at);
    }
    // running 是已经取得执行权的事实；返回 running，绝不伪造取消。
    return publicSnapshot(record);
  };

  const snapshot = (raw) => {
    const request = normalizeOwnerRequest(raw, ['requestToken']);
    if (typeof request.requestToken !== 'string' || !REQUEST_TOKEN_RE.test(request.requestToken)) {
      throw rpcError('ERR_REQUEST_INVALID', '文件 RPC snapshot 无效');
    }
    sweep();
    return publicSnapshot(ownedRecord(request.requestToken, request.binding), request.requestToken);
  };

  const initialOperations = options.operations;
  if (initialOperations !== undefined) {
    const entries = initialOperations instanceof Map
      ? [...initialOperations.entries()]
      : (isPlainObject(initialOperations) ? Object.entries(initialOperations) : null);
    if (!entries) throw rpcError('ERR_OPTIONS_INVALID', 'operations 必须是 Map 或纯对象');
    for (const [name, descriptor] of entries) registerOperation(name, descriptor);
  }

  return Object.freeze({
    limits,
    registerOperation,
    enqueue,
    read,
    claim,
    execute,
    settle,
    cancel,
    snapshot,
    sweep
  });
}

module.exports = Object.freeze({
  STATES,
  DEFAULT_LIMITS,
  OPERATION_LIMIT_CEILINGS,
  normalizeBinding,
  createContextFileRpcBroker
});
