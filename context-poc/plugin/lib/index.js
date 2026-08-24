import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';

export const name = 'whaledock-context-bridge-poc';
export const inject = ['connection', 'systemPrompt', 'sessions', 'llm'];

const CONTRACT = 'whaledock.context-bridge/v1';
const CHANNEL = '/whaledock.context';
const SECTION = 'whaledock:workspace-context';
const CAPABILITIES = Object.freeze([
  'per-session-revision',
  'turn-freeze',
  'revision-ack',
  'delivery-proof',
  'selection-authority',
  'controller-conflict-fence',
  'ordered-events'
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SESSION_REF_RE = /^session-[a-f0-9]{64}$/;
const PROJECT_ID_RE = /^wdp1_[a-f0-9]{32}$/;
const PROJECT_REVISION_RE = /^[a-f0-9]{64}$/;
const WORKBENCH_ID_RE = /^(?:builtin|user):[A-Za-z0-9][A-Za-z0-9._-]{0,87}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const NONCE_RE = /^[a-f0-9]{64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const LEASE_MS = 15000;
const MAX_EVENTS = 512;
const MAX_EVENT_BYTES = 2048;
const MAX_CONTROLLERS = 128;
const MAX_RECORDS = 256;
const MAX_RPC_SESSIONS = 4;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, required, optional = []) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function bridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return createHmac('sha256', secret)
    .update(`${label}\0${CONTRACT}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

function tokenMatches(actual, expected) {
  return typeof actual === 'string' && TOKEN_RE.test(actual)
    && typeof expected === 'string' && TOKEN_RE.test(expected)
    && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function ok(value) {
  return { ok: true, value };
}

function bad() {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message: 'invalid context-bridge request',
      details: { issues: [] }
    }
  };
}

function internal() {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: 'context bridge internal failure',
      details: {}
    }
  };
}

function validId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

function validRawSession(value) {
  return value === null || (typeof value === 'string' && value.length > 0
    && value.length <= 256 && !CONTROL_RE.test(value));
}

function validRelativePath(value) {
  if (value === '.') return true;
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 2048
      || CONTROL_RE.test(value) || value.includes('\\')
      || value.startsWith('/') || value.startsWith('//')
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  const segments = value.split('/');
  return segments.every((part) => part && part !== '.' && part !== '..');
}

function validProject(project) {
  if (!exact(project, [
    'projectId', 'relativePath', 'workbenchId', 'title', 'projectRevision'
  ])) return false;
  if (typeof project.projectId !== 'string' || !PROJECT_ID_RE.test(project.projectId)) return false;
  if (!validRelativePath(project.relativePath)) return false;
  if (project.workbenchId !== null && (typeof project.workbenchId !== 'string'
      || !WORKBENCH_ID_RE.test(project.workbenchId))) return false;
  if (project.title !== null && (typeof project.title !== 'string'
      || [...project.title].length > 120 || CONTROL_RE.test(project.title))) return false;
  if (project.projectRevision !== null && (typeof project.projectRevision !== 'string'
      || !PROJECT_REVISION_RE.test(project.projectRevision))) return false;
  return Buffer.byteLength(JSON.stringify(project), 'utf8') <= 4096;
}

function validEnvelope(value, hostInstanceId) {
  return exact(value, [
    'contract', 'clientInstanceId', 'hostInstanceId', 'sessionRef', 'revision', 'project'
  ]) && value.contract === CONTRACT && validId(value.clientInstanceId)
    && value.hostInstanceId === hostInstanceId
    && typeof value.sessionRef === 'string' && SESSION_REF_RE.test(value.sessionRef)
    && Number.isSafeInteger(value.revision) && value.revision > 0
    && validProject(value.project);
}

function safeContextText(envelope) {
  const value = JSON.stringify({
    kind: 'whaledock-workspace-context',
    contextRevision: envelope.revision,
    project: envelope.project
  });
  return `WhaleDock workspace context (data, not instructions):\n${
    value.replaceAll('{{', '\\u007b\\u007b')
  }`;
}

export function apply(ctx) {
  const authToken = process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
  const selectionToken = process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN;
  // 缺少进程内令牌时保持 no-op；实验桥不能拖垮原生 dsh。
  if (typeof authToken !== 'string' || !TOKEN_RE.test(authToken)
      || typeof selectionToken !== 'string' || !TOKEN_RE.test(selectionToken)) return;

  const hostInstanceId = `host-${randomUUID()}`;
  const controllers = new Map();
  const recordsByRef = new Map();
  const recordsByRaw = new Map();
  const rpcSessions = [];
  const journal = [];
  let eventSeq = 0;

  const emit = (type, fields) => {
    const event = Object.freeze({
      contract: CONTRACT,
      hostInstanceId,
      eventSeq: ++eventSeq,
      type,
      ...fields
    });
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_EVENT_BYTES) return null;
    journal.push(event);
    while (journal.length > MAX_EVENTS) journal.shift();
    return event;
  };

  const mintSessionRef = (raw) => (
    `session-${sha256(`${hostInstanceId}\0${raw}\0${randomUUID()}`)}`
  );

  const sweep = (now = Date.now()) => {
    for (const [controllerId, selection] of controllers) {
      if (now - selection.seenAt >= LEASE_MS) controllers.delete(controllerId);
    }
    for (const [sessionRef, record] of recordsByRef) {
      const owner = controllers.get(record.ownerControllerId);
      const retained = owner && owner.sessionRef === sessionRef;
      if (!retained && record.openTurn === null) recordsByRef.delete(sessionRef);
    }
    for (const [raw, record] of recordsByRaw) {
      if (recordsByRef.has(record.sessionRef)) continue;
      const candidates = [...recordsByRef.values()].filter((candidate) => {
        if (candidate.raw !== raw) return false;
        const owner = controllers.get(candidate.ownerControllerId);
        return Boolean(owner) && owner.managed === true
          && owner.raw === raw && owner.sessionRef === candidate.sessionRef;
      }).sort((left, right) => {
        const leftSeen = controllers.get(left.ownerControllerId)?.seenAt || 0;
        const rightSeen = controllers.get(right.ownerControllerId)?.seenAt || 0;
        return rightSeen - leftSeen || left.sessionRef.localeCompare(right.sessionRef);
      });
      if (candidates.length) recordsByRaw.set(raw, candidates[0]);
      else recordsByRaw.delete(raw);
    }
  };

  const activeSelectionsFor = (raw, now = Date.now()) => [...controllers.values()]
    .filter((selection) => selection.raw === raw && now - selection.seenAt < LEASE_MS);

  const resolveSelectionState = (selection) => {
    if (!selection || Date.now() - selection.seenAt >= LEASE_MS) {
      return { state: 'stale', sessionRef: null, code: 'selection-expired' };
    }
    if (selection.raw === null) return { state: 'none', sessionRef: null, code: null };
    const owners = activeSelectionsFor(selection.raw);
    if (owners.length !== 1 || owners[0] !== selection) {
      return { state: 'conflict', sessionRef: null, code: 'session-multi-controller' };
    }
    const record = recordsByRef.get(selection.sessionRef);
    const active = recordsByRaw.get(selection.raw);
    if (record && (!active || active.openTurn === null)) recordsByRaw.set(selection.raw, record);
    else if (record && active !== record) active.successor = record;
    return { state: 'selected', sessionRef: selection.sessionRef, code: null };
  };

  const activeOwnerFor = (record) => {
    if (!record || record.revoked) return null;
    const selection = controllers.get(record.ownerControllerId);
    if (!selection || selection.managed !== true || selection.raw !== record.raw
        || selection.sessionRef !== record.sessionRef) return null;
    const resolved = resolveSelectionState(selection);
    return resolved.state === 'selected' && resolved.sessionRef === record.sessionRef
      ? selection : null;
  };

  const registerSelection = (payload) => {
    if (!exact(payload, [
      'contract', 'controllerId', 'pageInstanceId', 'selectionRevision',
      'currentSessionId', 'managed', 'selectionToken'
    ]) || payload.contract !== CONTRACT || !validId(payload.controllerId)
        || !validId(payload.pageInstanceId)
        || !Number.isSafeInteger(payload.selectionRevision) || payload.selectionRevision < 1
        || !validRawSession(payload.currentSessionId)
        || !tokenMatches(payload.selectionToken, selectionToken)
        || typeof payload.managed !== 'boolean') return bad();

    sweep();
    const previous = controllers.get(payload.controllerId);
    if (previous && previous.pageInstanceId !== payload.pageInstanceId
        && payload.selectionRevision <= previous.selectionRevision) {
      return ok({
        state: 'conflict',
        code: 'revision-conflict',
        selectionRevision: previous.selectionRevision
      });
    }
    if (previous && payload.selectionRevision < previous.selectionRevision) {
      return ok({
        state: 'ignored-stale',
        code: 'selection-revision-stale',
        selectionRevision: previous.selectionRevision
      });
    }
    if (previous && payload.selectionRevision === previous.selectionRevision) {
      if (previous.pageInstanceId !== payload.pageInstanceId
          || previous.raw !== payload.currentSessionId || previous.managed !== payload.managed) {
        return ok({
          state: 'conflict',
          code: 'revision-conflict',
          selectionRevision: previous.selectionRevision
        });
      }
      previous.seenAt = Date.now();
      const current = resolveSelectionState(previous);
      return ok({
        ...current,
        controllerId: previous.controllerId,
        pageInstanceId: previous.pageInstanceId,
        selectionRevision: previous.selectionRevision
      });
    }

    if (!previous && controllers.size >= MAX_CONTROLLERS) {
      return ok({ state: 'conflict', code: 'controller-capacity', selectionRevision: 0 });
    }
    if (payload.currentSessionId !== null && recordsByRef.size >= MAX_RECORDS) {
      return ok({ state: 'conflict', code: 'record-capacity', selectionRevision: 0 });
    }

    const raw = payload.currentSessionId;
    const selection = {
      controllerId: payload.controllerId,
      pageInstanceId: payload.pageInstanceId,
      selectionRevision: payload.selectionRevision,
      raw,
      managed: payload.managed,
      sessionRef: raw === null ? null : mintSessionRef(raw),
      seenAt: Date.now()
    };
    controllers.set(selection.controllerId, selection);
    if (raw !== null) {
      const record = {
        raw,
        ownerControllerId: selection.controllerId,
        sessionRef: selection.sessionRef,
        effective: null,
        pending: null,
        openTurn: null,
        frozen: null,
        frozenText: '',
        deliveredKey: null,
        lastDigest: null,
        revoked: false,
        successor: null
      };
      recordsByRef.set(record.sessionRef, record);
      const prior = recordsByRaw.get(raw);
      if (!prior || prior.openTurn === null) recordsByRaw.set(raw, record);
    }
    sweep();
    const current = resolveSelectionState(selection);
    return ok({
      ...current,
      controllerId: selection.controllerId,
      pageInstanceId: selection.pageInstanceId,
      selectionRevision: selection.selectionRevision
    });
  };

  const withAuth = (payload, required, optional = []) => {
    if (!exact(payload, [...required, 'authToken'], optional)
        || !rpcSessions.includes(payload.authToken)) return null;
    const { authToken: _secret, ...value } = payload;
    return value;
  };

  const stageContext = (payload) => {
    const value = withAuth(payload, [
      'controllerId', 'pageInstanceId', 'selectionRevision', 'envelope'
    ]);
    if (!value || !validId(value.controllerId) || !validId(value.pageInstanceId)
        || !Number.isSafeInteger(value.selectionRevision) || value.selectionRevision < 1
        || !validEnvelope(value.envelope, hostInstanceId)) return bad();
    const selection = controllers.get(value.controllerId);
    const resolved = resolveSelectionState(selection);
    if (!selection || selection.managed !== true || resolved.state !== 'selected'
        || selection.pageInstanceId !== value.pageInstanceId
        || selection.selectionRevision !== value.selectionRevision
        || selection.sessionRef !== value.envelope.sessionRef) {
      return ok({ accepted: false, code: 'session-unavailable' });
    }
    const record = recordsByRef.get(value.envelope.sessionRef);
    if (!record || record.revoked) return ok({ accepted: false, code: 'session-unavailable' });
    const digest = sha256(JSON.stringify(value.envelope.project));
    const current = Math.max(record.effective?.revision || 0, record.pending?.revision || 0);
    if (value.envelope.revision < current
        || (value.envelope.revision === current && record.lastDigest !== digest)) {
      return ok({ accepted: false, code: 'revision-conflict' });
    }
    if (value.envelope.revision === current && record.lastDigest === digest) {
      const duplicateState = record.pending?.revision === value.envelope.revision
        ? 'queued' : 'effective';
      return ok({
        accepted: true,
        state: 'duplicate',
        eventSeq,
        ack: {
          contract: CONTRACT,
          clientInstanceId: value.envelope.clientInstanceId,
          hostInstanceId,
          sessionRef: value.envelope.sessionRef,
          revision: value.envelope.revision,
          state: duplicateState
        }
      });
    }
    const envelope = structuredClone(value.envelope);
    record.lastDigest = digest;
    if (record.openTurn !== null) {
      record.pending = envelope;
      const event = emit('ack', { controllerId: selection.controllerId, ack: {
        contract: CONTRACT,
        clientInstanceId: envelope.clientInstanceId,
        hostInstanceId,
        sessionRef: envelope.sessionRef,
        revision: envelope.revision,
        state: 'queued'
      } });
      return ok({ accepted: true, state: 'queued', eventSeq: event?.eventSeq || eventSeq });
    }
    record.effective = envelope;
    const event = emit('ack', { controllerId: selection.controllerId, ack: {
      contract: CONTRACT,
      clientInstanceId: envelope.clientInstanceId,
      hostInstanceId,
      sessionRef: envelope.sessionRef,
      revision: envelope.revision,
      state: 'effective'
    } });
    return ok({ accepted: true, state: 'effective', eventSeq: event?.eventSeq || eventSeq });
  };

  const handler = async (endpoint, payload) => {
    try {
      sweep();
      if (endpoint === 'selection/register') return registerSelection(payload);
      if (endpoint === 'handshake') {
        if (!exact(payload, ['type', 'protocol', 'clientNonce', 'requestProof'])
            || payload.type !== 'handshake' || payload.protocol !== CONTRACT
            || !NONCE_RE.test(payload.clientNonce)
            || !tokenMatches(payload.requestProof, bridgeHmac(
              authToken, 'handshake-request', payload.clientNonce, ''
            ))) return bad();
        const proof = bridgeHmac(
          authToken, 'handshake-proof', payload.clientNonce, hostInstanceId
        );
        const rpcSession = bridgeHmac(
          authToken, 'rpc-session', payload.clientNonce, hostInstanceId
        );
        rpcSessions.push(rpcSession);
        while (rpcSessions.length > MAX_RPC_SESSIONS) rpcSessions.shift();
        return ok({
          ok: true,
          type: 'handshake',
          protocol: CONTRACT,
          contract: CONTRACT,
          hostInstanceId,
          capabilities: CAPABILITIES,
          clientNonce: payload.clientNonce,
          proof
        });
      }
      if (endpoint === 'selection/resolve') {
        const value = withAuth(payload, ['contract', 'controllerId']);
        if (!value || value.contract !== CONTRACT || !validId(value.controllerId)) return bad();
        const selection = controllers.get(value.controllerId);
        if (!selection || selection.managed !== true) {
          return ok({ state: 'none', hostInstanceId, sessionRef: null, code: null });
        }
        const current = resolveSelectionState(selection);
        return ok({
          ...current,
          hostInstanceId,
          controllerId: selection.controllerId,
          pageInstanceId: selection.pageInstanceId,
          selectionRevision: selection.selectionRevision
        });
      }
      if (endpoint === 'context/stage') return stageContext(payload);
      if (endpoint === 'events/read') {
        const value = withAuth(payload, ['contract', 'hostInstanceId', 'afterEventSeq']);
        if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
            || !Number.isSafeInteger(value.afterEventSeq) || value.afterEventSeq < 0) return bad();
        const oldestEventSeq = journal[0]?.eventSeq || eventSeq + 1;
        const resyncRequired = value.afterEventSeq < oldestEventSeq - 1
          || value.afterEventSeq > eventSeq;
        return ok({
          contract: CONTRACT,
          hostInstanceId,
          oldestEventSeq,
          throughEventSeq: eventSeq,
          resyncRequired,
          events: resyncRequired ? [] : journal.filter((event) => (
            event.eventSeq > value.afterEventSeq
          )).slice(0, 64)
        });
      }
      return bad();
    } catch (_error) {
      return internal();
    }
  };

  ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'loopback' });
  ctx.systemPrompt.context({
    name: SECTION,
    order: 105,
    text(assembly) {
      const raw = assembly.agent?.id;
      if (typeof raw !== 'string') return '';
      return recordsByRaw.get(raw)?.frozenText || '';
    }
  });

  ctx.on('session/event', (session, event) => {
    sweep();
    const record = recordsByRaw.get(String(session.id));
    if (!record) return;
    if (event.type === 'turn/start') {
      if (!Number.isSafeInteger(event.data?.turn) || event.data.turn < 1) return;
      // selection lease / multi-controller fence 必须在真正冻结的一刻再验证。
      // resolve 后到 turn/start 之间可能出现页面刷新或第二控制器，
      // 此时宁可不注入，也不能沿用旧 effective 上下文。
      if (record.openTurn !== null) return;
      const owner = activeOwnerFor(record);
      if (!record.effective || !owner) {
        emit('turn-miss', {
          controllerId: record.ownerControllerId,
          sessionRef: record.sessionRef,
          turn: event.data.turn,
          reason: owner ? 'context-not-effective' : 'session-unavailable'
        });
        return;
      }
      record.openTurn = event.data.turn;
      record.frozen = record.effective;
      record.frozenText = safeContextText(record.frozen);
      record.deliveredKey = null;
      emit('turn-start', {
        controllerId: record.ownerControllerId,
        sessionRef: record.sessionRef,
        turn: event.data.turn,
        frozenRevision: record.frozen.revision
      });
      return;
    }
    if (event.type === 'turn/end' && record.openTurn === event.data.turn) {
      emit('turn-end', {
        controllerId: record.ownerControllerId,
        sessionRef: record.sessionRef,
        turn: event.data.turn
      });
      record.openTurn = null;
      record.frozen = null;
      record.frozenText = '';
      record.deliveredKey = null;
      if (record.pending) {
        record.effective = record.pending;
        record.pending = null;
        emit('ack', { controllerId: record.ownerControllerId, ack: {
          contract: CONTRACT,
          clientInstanceId: record.effective.clientInstanceId,
          hostInstanceId,
          sessionRef: record.sessionRef,
          revision: record.effective.revision,
          state: 'effective'
        } });
      }
      const successor = record.successor;
      const owners = activeSelectionsFor(record.raw);
      if (successor && owners.length === 1
          && owners[0].sessionRef === successor.sessionRef) {
        recordsByRaw.set(record.raw, successor);
      }
      record.successor = null;
    }
  });

  ctx.on('llm/stream', (options, next) => {
    try {
      if (!isAgentLoopRequest(options) || options.sessionId === undefined) return next();
      const record = recordsByRaw.get(String(options.sessionId));
      if (!record?.frozen || record.openTurn === null || record.revoked) return next();
      let matched = null;
      for (let index = options.messages.length - 1; index >= 0; index -= 1) {
        const message = options.messages[index];
        const source = message?.source;
        if (message?.role === 'user' && source?.kind === 'plugin'
            && source.plugin === '@deepseek-ai/dsh-system-prompt'
            && source.form === 'snapshot'
            && source.sections?.some((section) => (
              section.name === SECTION && section.text === record.frozenText
            ))) {
          matched = message;
          break;
        }
      }
      const key = `${record.openTurn}:${record.frozen.revision}`;
      if (matched && record.deliveredKey !== key) {
        record.deliveredKey = key;
        emit('delivery', {
          controllerId: record.ownerControllerId,
          delivery: {
            contract: CONTRACT,
            clientInstanceId: record.frozen.clientInstanceId,
            hostInstanceId,
            sessionRef: record.sessionRef,
            openTurn: record.openTurn,
            frozenRevision: record.frozen.revision
          },
          proof: {
            messageSha256: sha256(matched.id),
            sectionSha256: sha256(record.frozenText),
            boundary: 'llm-stream-local'
          }
        });
      }
    } catch (_error) {
      // 取证失败只是不发 delivery；永不破坏原生模型调用。
    }
    return next();
  }, { global: true, prepend: true });
}
