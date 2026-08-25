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
  'ordered-events',
  'ui-preferences-v1',
  'workspace-files-v1'
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SESSION_REF_RE = /^session-[a-f0-9]{64}$/;
const PROJECT_ID_RE = /^wdp1_[a-f0-9]{32}$/;
const PROJECT_REVISION_RE = /^[a-f0-9]{64}$/;
const WORKBENCH_ID_RE = /^(?:builtin|user):[A-Za-z0-9][A-Za-z0-9._-]{0,87}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const NONCE_RE = /^[a-f0-9]{64}$/;
const REGISTER_NONCE_RE = /^[a-f0-9]{32}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const WORKSPACE_TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LEASE_MS = 15000;
const REGISTER_NONCE_TTL_MS = 10000;
const REGISTER_CLOCK_SKEW_MS = 1000;
const MAX_EVENTS = 512;
const MAX_EVENT_BYTES = 2048;
const MAX_CONTROLLERS = 128;
const MAX_RECORDS = 256;
const MAX_RPC_SESSIONS = 4;
const MAX_REGISTER_NONCES = 4096;
const MAX_PREFERENCE_REVISION = 1_000_000_000;
const MAX_PENDING_PREFERENCES = 64;
const MAX_PREFERENCE_READ_BATCH = 16;
const PREFERENCE_PENDING_MS = 3000;
const WORKSPACE_FILE_OPERATIONS = new Set([
  'catalog.read', 'overview.read', 'document.read', 'topic.choose',
  'project.action.prepare', 'project.action.submit',
  'block.action.prepare', 'block.action.submit',
  'proposal.read', 'proposal.decide', 'proposal.undo',
  'publish.read', 'publish.create', 'publish.update',
  'receipts.read', 'receipts.ack', 'receipts.open'
]);
const WORKSPACE_FILE_STATES = new Set([
  'queued', 'running', 'fulfilled', 'rejected', 'cancelled', 'expired'
]);
const WORKSPACE_FILE_REJECT_CODES = new Set([
  'workspace-unavailable', 'workspace-mismatch', 'operation-invalid',
  'operation-timeout', 'operation-failed', 'operation-stale', 'outcome-unknown', 'busy'
]);
const WORKSPACE_FILE_FORBIDDEN_KEYS = new Set([
  'absolutepath', 'relativepath', 'effectivepath', 'workspacekey', 'cwd',
  'filepath', 'root', 'rootpath', 'frontmatter', 'patch',
  'sessionref', 'currentsessionid', 'rawsession', 'context', 'envelope',
  'authtoken', 'selectiontoken', 'controllerproof', 'claimtoken', 'requestseq',
  'hash', 'dev', 'ino'
]);
const MAX_WORKSPACE_FILE_INPUT_BYTES = 4 * 1024;
const MAX_WORKSPACE_FILE_RESULT_BYTES = 6 * 1024;
const MAX_WORKSPACE_FILE_JOBS = 64;
const MAX_WORKSPACE_FILE_QUEUED = 32;
const MAX_WORKSPACE_FILE_PER_CONTROLLER = 4;
const MAX_WORKSPACE_FILE_READ_BATCH = 4;
const WORKSPACE_FILE_PENDING_MS = 10000;
const WORKSPACE_FILE_RUNNING_MS = 10000;
const WORKSPACE_FILE_RETAIN_MS = 30000;
const ENDPOINT_RATES = Object.freeze({
  handshake: 16,
  'selection/register': 256,
  'selection/resolve': 32,
  'context/stage': 64,
  'context/preflight': 128,
  'events/read': 64,
  'ui/preferences/get': 64,
  'ui/preferences/write': 16,
  'ui/preferences/read': 64,
  'ui/preferences/sync': 32,
  'ui/preferences/settle': 32,
  'workspace/files/request': 16,
  'workspace/files/status': 64,
  'workspace/files/cancel': 16,
  'workspace/files/read': 64,
  'workspace/files/claim': 32,
  'workspace/files/settle': 32
});

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

function validPreferenceRevision(value, allowZero = false) {
  return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1)
    && value <= MAX_PREFERENCE_REVISION;
}

function preferencePatch(value) {
  if (!plain(value)) return null;
  const keys = Object.keys(value);
  if (keys.length < 1 || keys.length > 2
      || keys.some((key) => key !== 'contentViewMode' && key !== 'contentViewHintSeen')
      || (Object.prototype.hasOwnProperty.call(value, 'contentViewMode')
        && value.contentViewMode !== 'content' && value.contentViewMode !== 'sessions')
      || (Object.prototype.hasOwnProperty.call(value, 'contentViewHintSeen')
        && typeof value.contentViewHintSeen !== 'boolean')) return null;
  return Object.freeze({ ...value });
}

function preferenceSnapshot(value, allowZero = false) {
  if (!exact(value, ['revision', 'contentViewMode', 'contentViewHintSeen'])
      || !validPreferenceRevision(value.revision, allowZero)
      || (value.contentViewMode !== 'content' && value.contentViewMode !== 'sessions')
      || typeof value.contentViewHintSeen !== 'boolean') return null;
  return Object.freeze({
    revision: value.revision,
    contentViewMode: value.contentViewMode,
    contentViewHintSeen: value.contentViewHintSeen
  });
}

function samePreferenceSnapshot(left, right) {
  return Boolean(left && right && left.revision === right.revision
    && left.contentViewMode === right.contentViewMode
    && left.contentViewHintSeen === right.contentViewHintSeen);
}

function safeWorkspaceValue(value, maximumBytes) {
  const canonicalKey = (key) => key.toLowerCase().replace(/[-_]/g, '');
  const visit = (item, depth) => {
    if (depth > 5) return null;
    if (item === null || typeof item === 'boolean') return item;
    if (Number.isSafeInteger(item) && Math.abs(item) <= 1_000_000_000_000) return item;
    if (typeof item === 'string') {
      return Buffer.byteLength(item, 'utf8') <= 2048 && !WORKSPACE_TEXT_CONTROL_RE.test(item)
        ? item : null;
    }
    if (Array.isArray(item)) {
      if (item.length > 64) return null;
      const result = [];
      for (const child of item) {
        const clean = visit(child, depth + 1);
        if (clean === null && child !== null) return null;
        result.push(clean);
      }
      return result;
    }
    if (!plain(item) || Object.keys(item).length > 64) return null;
    const result = {};
    for (const [key, child] of Object.entries(item)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
          || WORKSPACE_FILE_FORBIDDEN_KEYS.has(canonicalKey(key))) return null;
      const clean = visit(child, depth + 1);
      if (clean === null && child !== null) return null;
      result[key] = clean;
    }
    return result;
  };
  const clean = visit(value, 0);
  if (!plain(clean)) return null;
  return Buffer.byteLength(JSON.stringify(clean), 'utf8') <= maximumBytes
    ? Object.freeze(clean) : null;
}

function sessionProjectId(session) {
  const cwd = session && session.header && session.header.cwd;
  if (typeof cwd !== 'string' || !cwd || CONTROL_RE.test(cwd)
      || Buffer.byteLength(cwd, 'utf8') > 4096) return null;
  let normalized = cwd.replace(/\\/g, '/');
  if (!(normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
      || normalized.startsWith('//'))) return null;
  while (normalized.length > 1 && normalized.endsWith('/')
      && !/^[A-Za-z]:\/$/.test(normalized)) normalized = normalized.slice(0, -1);
  const digest = sha256(`whaledock-project/v1\0${normalized}\0.`);
  return `wdp1_${digest.slice(0, 32)}`;
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
  const registerNonces = new Map();
  const endpointBuckets = new Map();
  const pendingPreferences = new Map();
  const workspaceFileJobs = new Map();
  let workspaceFileRequestSeq = 0;
  let preferences = Object.freeze({
    revision: 0,
    contentViewMode: 'content',
    contentViewHintSeen: false
  });
  let eventSeq = 0;

  const emit = (type, fields) => {
    const nextEventSeq = eventSeq + 1;
    const event = Object.freeze({
      contract: CONTRACT,
      hostInstanceId,
      eventSeq: nextEventSeq,
      type,
      ...fields
    });
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_EVENT_BYTES) return null;
    eventSeq = nextEventSeq;
    journal.push(event);
    while (journal.length > MAX_EVENTS) journal.shift();
    return event;
  };

  const mintSessionRef = (raw) => (
    `session-${sha256(`${hostInstanceId}\0${raw}\0${randomUUID()}`)}`
  );

  const takeEndpointBudget = (endpoint, now = Date.now()) => {
    const limit = ENDPOINT_RATES[endpoint];
    if (!Number.isSafeInteger(limit)) return false;
    const windowId = Math.floor(now / 1000);
    const bucket = endpointBuckets.get(endpoint);
    if (!bucket || bucket.windowId !== windowId) {
      endpointBuckets.set(endpoint, { windowId, count: 1 });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };

  const acceptRegisterNonce = (nonce, issuedAtMs, now = Date.now()) => {
    for (const [key, expiresAt] of registerNonces) {
      if (expiresAt < now) registerNonces.delete(key);
    }
    if (!REGISTER_NONCE_RE.test(nonce) || !Number.isSafeInteger(issuedAtMs)
        || issuedAtMs < now - REGISTER_NONCE_TTL_MS
        || issuedAtMs > now + REGISTER_CLOCK_SKEW_MS
        || registerNonces.has(nonce) || registerNonces.size >= MAX_REGISTER_NONCES) return false;
    registerNonces.set(nonce, issuedAtMs + REGISTER_NONCE_TTL_MS);
    return true;
  };

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
    sweepWorkspaceFileJobs(now);
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
      'currentSessionId', 'managed', 'selectionToken', 'registerNonce',
      'issuedAtMs', 'controllerProof'
    ]) || payload.contract !== CONTRACT || !validId(payload.controllerId)
        || !validId(payload.pageInstanceId)
        || !Number.isSafeInteger(payload.selectionRevision) || payload.selectionRevision < 1
        || !validRawSession(payload.currentSessionId)
        || !tokenMatches(payload.selectionToken, selectionToken)
        || !TOKEN_RE.test(payload.controllerProof)
        || typeof payload.managed !== 'boolean') return bad();

    const now = Date.now();
    if (!takeEndpointBudget('selection/register', now)) return bad();
    sweep(now);
    const previous = controllers.get(payload.controllerId);
    if (previous && !tokenMatches(payload.controllerProof, previous.controllerProof)) return bad();
    if (!acceptRegisterNonce(payload.registerNonce, payload.issuedAtMs, now)) return bad();
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
        state: current.state,
        code: current.code,
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
      controllerProof: payload.controllerProof,
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
      state: current.state,
      code: current.code,
      controllerId: selection.controllerId,
      pageInstanceId: selection.pageInstanceId,
      selectionRevision: selection.selectionRevision
    });
  };

  const withAuth = (payload, required, optional = []) => {
    const shapeValid = exact(payload, [...required, 'authToken'], optional);
    const actualValid = shapeValid && typeof payload.authToken === 'string'
      && TOKEN_RE.test(payload.authToken);
    const actual = Buffer.from(actualValid ? payload.authToken : '00'.repeat(32), 'hex');
    let matched = 0;
    for (let index = 0; index < MAX_RPC_SESSIONS; index += 1) {
      const expected = rpcSessions[index] || '00'.repeat(32);
      const equal = timingSafeEqual(actual, Buffer.from(expected, 'hex'));
      if (index < rpcSessions.length && equal) matched |= 1;
    }
    if (!actualValid || matched !== 1) return null;
    const { authToken: _secret, ...value } = payload;
    return value;
  };

  const preferencePageSelection = (payload, extra) => {
    if (!exact(payload, [
      'contract', 'controllerId', 'pageInstanceId', 'selectionRevision',
      'selectionToken', 'controllerProof', ...extra
    ]) || payload.contract !== CONTRACT || !validId(payload.controllerId)
        || !validId(payload.pageInstanceId)
        || !validPreferenceRevision(payload.selectionRevision)
        || !tokenMatches(payload.selectionToken, selectionToken)
        || !TOKEN_RE.test(payload.controllerProof)) return null;
    sweep();
    const selection = controllers.get(payload.controllerId);
    if (!selection || selection.managed !== true
        || selection.pageInstanceId !== payload.pageInstanceId
        || selection.selectionRevision !== payload.selectionRevision
        || !tokenMatches(payload.controllerProof, selection.controllerProof)) return null;
    return selection;
  };

  const syncPreferences = (payload) => {
    const value = withAuth(payload, ['contract', 'snapshot']);
    const snapshot = value && preferenceSnapshot(value.snapshot);
    if (!value || value.contract !== CONTRACT || !snapshot) return bad();
    if (!takeEndpointBudget('ui/preferences/sync')) return bad();
    sweep();
    if (snapshot.revision < preferences.revision) {
      return ok({ accepted: false, code: 'preferences-stale', snapshot: preferences });
    }
    if (snapshot.revision === preferences.revision
        && !samePreferenceSnapshot(snapshot, preferences)) {
      return ok({ accepted: false, code: 'preferences-conflict', snapshot: preferences });
    }
    preferences = snapshot;
    return ok({ accepted: true, code: null, snapshot: preferences });
  };

  const expirePendingPreference = (requestToken, pending, now = Date.now()) => {
    if (pendingPreferences.get(requestToken) !== pending || now < pending.deadlineMs) {
      return false;
    }
    pendingPreferences.delete(requestToken);
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(ok({
      accepted: false,
      code: 'preferences-timeout',
      snapshot: preferences
    }));
    return true;
  };

  const expirePendingPreferences = (now = Date.now()) => {
    for (const [requestToken, pending] of pendingPreferences) {
      expirePendingPreference(requestToken, pending, now);
    }
  };

  const readPreferences = (payload) => {
    const value = withAuth(payload, ['contract', 'hostInstanceId']);
    if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId) {
      return bad();
    }
    if (!takeEndpointBudget('ui/preferences/read')) return bad();
    expirePendingPreferences();
    return ok({
      contract: CONTRACT,
      hostInstanceId,
      requests: [...pendingPreferences.values()]
        .slice(0, MAX_PREFERENCE_READ_BATCH)
        .map((pending) => pending.request)
    });
  };

  const settlePreferences = (payload) => {
    const value = withAuth(payload, [
      'contract', 'requestToken', 'status', 'code', 'snapshot'
    ]);
    const snapshot = value && preferenceSnapshot(value.snapshot);
    const rejectedCodes = new Set([
      'preferences-invalid', 'preferences-stale',
      'preferences-unavailable', 'preferences-write-failed', 'preferences-timeout'
    ]);
    if (!value || value.contract !== CONTRACT || !TOKEN_RE.test(value.requestToken)
        || !snapshot || !['applied', 'rejected'].includes(value.status)
        || (value.status === 'applied' ? value.code !== null : !rejectedCodes.has(value.code))) {
      return bad();
    }
    if (!takeEndpointBudget('ui/preferences/settle')) return bad();
    sweep();
    expirePendingPreferences();
    const pending = pendingPreferences.get(value.requestToken);
    if (!pending) return bad();
    if (value.status === 'applied') {
      const expected = {
        ...preferences,
        ...pending.patch,
        revision: pending.baseRevision + 1
      };
      if (preferences.revision !== pending.baseRevision
          || snapshot.revision !== expected.revision
          || !samePreferenceSnapshot(snapshot, expected)) return bad();
    } else if (snapshot.revision < preferences.revision
        || (snapshot.revision === preferences.revision
          && !samePreferenceSnapshot(snapshot, preferences))) return bad();

    pendingPreferences.delete(value.requestToken);
    if (pending.timer) clearTimeout(pending.timer);
    preferences = snapshot;
    pending.resolve(ok({
      accepted: value.status === 'applied',
      code: value.code,
      snapshot: preferences
    }));
    return ok({ settled: true });
  };

  const getPreferences = (payload) => {
    if (!preferencePageSelection(payload, [])) return bad();
    if (!takeEndpointBudget('ui/preferences/get')) return bad();
    return ok({ snapshot: preferences });
  };

  const writePreferences = (payload) => {
    if (!preferencePageSelection(payload, ['baseRevision', 'patch'])
        || !validPreferenceRevision(payload.baseRevision)) return bad();
    const patch = preferencePatch(payload.patch);
    if (!patch) return bad();
    if (!takeEndpointBudget('ui/preferences/write')) return bad();
    expirePendingPreferences();
    if (preferences.revision < 1) {
      return ok({ accepted: false, code: 'preferences-unavailable', snapshot: preferences });
    }
    if (payload.baseRevision !== preferences.revision) {
      return ok({ accepted: false, code: 'preferences-stale', snapshot: preferences });
    }
    if (pendingPreferences.size >= MAX_PENDING_PREFERENCES) {
      return ok({ accepted: false, code: 'preferences-busy', snapshot: preferences });
    }
    const issuedAtMs = Date.now();
    const deadlineMs = issuedAtMs + PREFERENCE_PENDING_MS;
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0
        || !Number.isSafeInteger(deadlineMs)) return internal();
    const requestToken = sha256(
      `preferences\0${randomUUID()}\0${issuedAtMs}\0${pendingPreferences.size}`
    );
    const request = Object.freeze({
      controllerId: payload.controllerId,
      pageInstanceId: payload.pageInstanceId,
      selectionRevision: payload.selectionRevision,
      requestToken,
      baseRevision: payload.baseRevision,
      issuedAtMs,
      deadlineMs,
      patch
    });
    return new Promise((resolve) => {
      const pending = {
        baseRevision: payload.baseRevision,
        deadlineMs,
        patch,
        request,
        resolve,
        timer: null
      };
      pendingPreferences.set(requestToken, pending);
      const remainingMs = Math.max(0, Math.min(
        PREFERENCE_PENDING_MS, deadlineMs - Date.now()
      ));
      pending.timer = setTimeout(() => {
        expirePendingPreference(requestToken, pending);
      }, remainingMs);
      if (pending.timer && typeof pending.timer.unref === 'function') pending.timer.unref();
    });
  };

  const workspaceFileTerminal = (state) => (
    state === 'fulfilled' || state === 'rejected'
      || state === 'cancelled' || state === 'expired'
  );

  const workspaceFileSnapshot = (job) => Object.freeze({
    requestToken: job.requestToken,
    state: job.state,
    code: job.code,
    result: job.state === 'fulfilled' ? job.result : null
  });

  const workspaceFileContextCurrent = (job) => {
    const selection = job && controllers.get(job.controllerId);
    const record = job && recordsByRef.get(job.sessionRef);
    const envelope = record && record.effective;
    let session = null;
    try {
      session = record && ctx.sessions && typeof ctx.sessions.get === 'function'
        ? ctx.sessions.get(record.raw) : null;
    } catch (_error) { session = null; }
    return Boolean(selection && selection.managed === true
      && selection.pageInstanceId === job.pageInstanceId
      && selection.selectionRevision === job.selectionRevision
      && selection.sessionRef === job.sessionRef
      && record && record.revoked !== true && envelope
      && envelope.revision === job.contextRevision
      && envelope.project.projectId === job.projectId
      && envelope.project.projectRevision === job.projectRevision
      && sessionProjectId(session) === job.projectId);
  };

  const sweepWorkspaceFileJobs = (now = Date.now()) => {
    for (const [requestToken, job] of workspaceFileJobs) {
      if (job.state === 'queued' && now >= job.deadlineMs) {
        job.state = 'expired';
        job.code = 'operation-timeout';
        job.finishedAtMs = now;
      } else if (job.state === 'running' && now >= job.runningDeadlineMs) {
        job.state = 'rejected';
        // claim 后 main 可能已完成副作用但 settle 回包丢失；这里不能伪称未执行。
        job.code = 'outcome-unknown';
        job.result = null;
        job.claimToken = null;
        job.finishedAtMs = now;
      } else if (job.state === 'queued' && !workspaceFileContextCurrent(job)) {
        job.state = 'rejected';
        job.code = 'workspace-unavailable';
        job.finishedAtMs = now;
      } else if (job.state === 'running' && !workspaceFileContextCurrent(job)) {
        // claim 已发出后 selection 变化，副作用是否发生不可确认。
        job.state = 'rejected';
        job.code = 'outcome-unknown';
        job.result = null;
        job.claimToken = null;
        job.finishedAtMs = now;
      }
      if (workspaceFileTerminal(job.state)
          && Number.isSafeInteger(job.finishedAtMs)
          && now - job.finishedAtMs >= WORKSPACE_FILE_RETAIN_MS) {
        workspaceFileJobs.delete(requestToken);
      }
    }
  };

  const workspaceFileOwner = (payload, job) => {
    if (!exact(payload, [
      'contract', 'controllerId', 'pageInstanceId', 'selectionRevision',
      'selectionToken', 'controllerProof', 'requestToken'
    ]) || payload.contract !== CONTRACT || !validId(payload.controllerId)
        || !validId(payload.pageInstanceId)
        || !validPreferenceRevision(payload.selectionRevision)
        || !tokenMatches(payload.selectionToken, selectionToken)
        || !TOKEN_RE.test(payload.controllerProof) || !TOKEN_RE.test(payload.requestToken)
        || !job || job.controllerId !== payload.controllerId
        || job.pageInstanceId !== payload.pageInstanceId
        || payload.selectionRevision !== job.selectionRevision) return null;
    const selection = controllers.get(payload.controllerId);
    if (!selection || selection.managed !== true
        || selection.pageInstanceId !== payload.pageInstanceId
        || selection.selectionRevision !== payload.selectionRevision
        || selection.sessionRef !== job.sessionRef
        || !workspaceFileContextCurrent(job)
        || !tokenMatches(payload.controllerProof, selection.controllerProof)) return null;
    return selection;
  };

  const requestWorkspaceFile = (payload) => {
    const selection = preferencePageSelection(payload, ['operation', 'input']);
    const input = selection && safeWorkspaceValue(
      payload.input, MAX_WORKSPACE_FILE_INPUT_BYTES
    );
    if (!selection || typeof payload.operation !== 'string'
        || !WORKSPACE_FILE_OPERATIONS.has(payload.operation) || !input) return bad();
    if (!takeEndpointBudget('workspace/files/request')) return bad();
    sweep();
    const resolved = resolveSelectionState(selection);
    const record = resolved.state === 'selected'
      ? recordsByRef.get(selection.sessionRef) : null;
    const envelope = record && record.effective;
    if (!record || record.revoked || !envelope) {
      return ok({
        accepted: false, requestToken: null, state: 'rejected',
        code: 'workspace-unavailable', deadlineMs: null
      });
    }
    let session = null;
    try {
      session = ctx.sessions && typeof ctx.sessions.get === 'function'
        ? ctx.sessions.get(record.raw) : null;
    } catch (_error) { session = null; }
    const selectedProjectId = sessionProjectId(session);
    if (!selectedProjectId || selectedProjectId !== envelope.project.projectId) {
      return ok({
        accepted: false, requestToken: null, state: 'rejected',
        code: 'workspace-mismatch', deadlineMs: null
      });
    }
    const activeForController = [...workspaceFileJobs.values()].filter((job) => (
      job.controllerId === selection.controllerId && !workspaceFileTerminal(job.state)
    )).length;
    const queued = [...workspaceFileJobs.values()].filter((job) => job.state === 'queued').length;
    if (workspaceFileJobs.size >= MAX_WORKSPACE_FILE_JOBS
        || queued >= MAX_WORKSPACE_FILE_QUEUED
        || activeForController >= MAX_WORKSPACE_FILE_PER_CONTROLLER) {
      return ok({
        accepted: false, requestToken: null, state: 'rejected',
        code: 'busy', deadlineMs: null
      });
    }
    const issuedAtMs = Date.now();
    const deadlineMs = issuedAtMs + WORKSPACE_FILE_PENDING_MS;
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0
        || !Number.isSafeInteger(deadlineMs)
        || workspaceFileRequestSeq >= Number.MAX_SAFE_INTEGER) return internal();
    const requestSeq = ++workspaceFileRequestSeq;
    const requestToken = sha256(
      `workspace-file\0${randomUUID()}\0${issuedAtMs}\0${requestSeq}`
    );
    const job = {
      requestToken,
      requestSeq,
      controllerId: selection.controllerId,
      pageInstanceId: selection.pageInstanceId,
      selectionRevision: selection.selectionRevision,
      sessionRef: selection.sessionRef,
      projectId: envelope.project.projectId,
      projectRevision: envelope.project.projectRevision,
      contextRevision: envelope.revision,
      operation: payload.operation,
      input,
      issuedAtMs,
      deadlineMs,
      runningDeadlineMs: null,
      state: 'queued',
      code: null,
      result: null,
      claimToken: null,
      finishedAtMs: null
    };
    workspaceFileJobs.set(requestToken, job);
    return ok({
      accepted: true,
      requestToken,
      state: 'queued',
      code: null,
      deadlineMs
    });
  };

  const statusWorkspaceFile = (payload) => {
    sweep();
    const job = workspaceFileJobs.get(payload && payload.requestToken);
    if (!workspaceFileOwner(payload, job)) return bad();
    if (!takeEndpointBudget('workspace/files/status')) return bad();
    return ok(workspaceFileSnapshot(job));
  };

  const cancelWorkspaceFile = (payload) => {
    sweep();
    const job = workspaceFileJobs.get(payload && payload.requestToken);
    if (!workspaceFileOwner(payload, job)) return bad();
    if (!takeEndpointBudget('workspace/files/cancel')) return bad();
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.code = 'cancelled';
      job.finishedAtMs = Date.now();
      return ok({ cancelled: true, code: 'cancelled', snapshot: workspaceFileSnapshot(job) });
    }
    return ok({
      cancelled: false,
      code: job.state === 'running' ? 'already-running' : 'already-settled',
      snapshot: workspaceFileSnapshot(job)
    });
  };

  const readWorkspaceFiles = (payload) => {
    const value = withAuth(payload, ['contract', 'hostInstanceId', 'limit']);
    if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
        || !Number.isSafeInteger(value.limit) || value.limit < 1
        || value.limit > MAX_WORKSPACE_FILE_READ_BATCH) return bad();
    if (!takeEndpointBudget('workspace/files/read')) return bad();
    sweep();
    const requests = [...workspaceFileJobs.values()]
      .filter((job) => job.state === 'queued')
      .sort((left, right) => left.requestSeq - right.requestSeq)
      .slice(0, value.limit)
      .map((job) => Object.freeze({
        requestToken: job.requestToken,
        requestSeq: job.requestSeq,
        controllerId: job.controllerId,
        pageInstanceId: job.pageInstanceId,
        selectionRevision: job.selectionRevision,
        projectId: job.projectId,
        projectRevision: job.projectRevision,
        contextRevision: job.contextRevision,
        operation: job.operation,
        input: job.input,
        issuedAtMs: job.issuedAtMs,
        deadlineMs: job.deadlineMs
      }));
    return ok({ contract: CONTRACT, hostInstanceId, requests });
  };

  const claimWorkspaceFile = (payload) => {
    const value = withAuth(payload, [
      'contract', 'hostInstanceId', 'requestToken', 'requestSeq'
    ]);
    if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
        || !TOKEN_RE.test(value.requestToken)
        || !Number.isSafeInteger(value.requestSeq) || value.requestSeq < 1) return bad();
    if (!takeEndpointBudget('workspace/files/claim')) return bad();
    sweep();
    const job = workspaceFileJobs.get(value.requestToken);
    if (!job || job.requestSeq !== value.requestSeq || job.state !== 'queued'
        || !workspaceFileContextCurrent(job)) {
      return ok({ claimed: false, code: 'operation-stale' });
    }
    const now = Date.now();
    job.state = 'running';
    job.runningDeadlineMs = Math.min(job.deadlineMs, now + WORKSPACE_FILE_RUNNING_MS);
    job.claimToken = sha256(
      `workspace-claim\0${randomUUID()}\0${value.requestToken}\0${value.requestSeq}`
    );
    return ok({
      claimed: true,
      code: null,
      claimToken: job.claimToken,
      runningDeadlineMs: job.runningDeadlineMs
    });
  };

  const settleWorkspaceFile = (payload) => {
    const value = withAuth(payload, [
      'contract', 'hostInstanceId', 'requestToken', 'requestSeq',
      'claimToken', 'status', 'code', 'result'
    ]);
    if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
        || !TOKEN_RE.test(value.requestToken) || !TOKEN_RE.test(value.claimToken)
        || !Number.isSafeInteger(value.requestSeq) || value.requestSeq < 1
        || !['fulfilled', 'rejected'].includes(value.status)) return bad();
    const result = value.status === 'fulfilled'
      ? safeWorkspaceValue(value.result, MAX_WORKSPACE_FILE_RESULT_BYTES) : null;
    if ((value.status === 'fulfilled' && (value.code !== null || !result))
        || (value.status === 'rejected'
          && (!WORKSPACE_FILE_REJECT_CODES.has(value.code) || value.result !== null))) return bad();
    if (!takeEndpointBudget('workspace/files/settle')) return bad();
    sweep();
    const job = workspaceFileJobs.get(value.requestToken);
    if (!job || job.requestSeq !== value.requestSeq || job.state !== 'running'
        || !tokenMatches(value.claimToken, job.claimToken)) {
      return ok({ settled: false, code: 'operation-stale' });
    }
    job.state = value.status;
    job.code = value.code;
    job.result = result;
    job.claimToken = null;
    job.finishedAtMs = Date.now();
    return ok({ settled: true, code: null });
  };

  const validPreflightAuth = (payload) => exact(payload, [
    'contract', 'controllerId', 'pageInstanceId', 'selectionRevision',
    'currentSessionId', 'mode', 'managed', 'selectionToken'
  ]) && tokenMatches(payload.selectionToken, selectionToken);

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

  const preflightContext = (payload) => {
    if (!exact(payload, [
      'contract', 'controllerId', 'pageInstanceId', 'selectionRevision',
      'currentSessionId', 'mode', 'managed', 'selectionToken'
    ]) || payload.contract !== CONTRACT || !validId(payload.controllerId)
        || !validId(payload.pageInstanceId)
        || !Number.isSafeInteger(payload.selectionRevision) || payload.selectionRevision < 1
        || !validRawSession(payload.currentSessionId) || payload.currentSessionId === null
        || (payload.mode !== 'queue' && payload.mode !== 'steer')
        || payload.managed !== true
        || !tokenMatches(payload.selectionToken, selectionToken)) return bad();
    const selection = controllers.get(payload.controllerId);
    const resolved = resolveSelectionState(selection);
    if (!selection || resolved.state !== 'selected'
        || selection.pageInstanceId !== payload.pageInstanceId
        || selection.selectionRevision !== payload.selectionRevision
        || selection.raw !== payload.currentSessionId) {
      return ok({ ready: false, code: resolved.code || 'session-unavailable' });
    }
    const record = recordsByRef.get(selection.sessionRef);
    if (!record || record.revoked || record.raw !== payload.currentSessionId) {
      return ok({ ready: false, code: 'session-unavailable' });
    }
    // queue 在当前 turn 期间可等待 pending 上下文于 turn/end 生效；
    // steer 属于当前 turn，必须已经有冻结上下文。
    const envelope = record.openTurn !== null && payload.mode === 'steer'
      ? record.frozen
      : (record.pending || record.effective);
    return envelope
      ? ok({ ready: true, code: null })
      : ok({ ready: false, code: 'context-not-effective' });
  };

  const handler = async (endpoint, payload) => {
    try {
      if (endpoint === 'selection/register') return registerSelection(payload);
      if (endpoint === 'handshake') {
        if (!exact(payload, ['type', 'protocol', 'clientNonce', 'requestProof'])
            || payload.type !== 'handshake' || payload.protocol !== CONTRACT
            || !NONCE_RE.test(payload.clientNonce)
            || !tokenMatches(payload.requestProof, bridgeHmac(
              authToken, 'handshake-request', payload.clientNonce, ''
            ))) return bad();
        if (!takeEndpointBudget(endpoint)) return bad();
        sweep();
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
        if (!takeEndpointBudget(endpoint)) return bad();
        sweep();
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
      if (endpoint === 'context/stage') {
        if (!withAuth(payload, [
          'controllerId', 'pageInstanceId', 'selectionRevision', 'envelope'
        ])) return bad();
        if (!takeEndpointBudget(endpoint)) return bad();
        sweep();
        return stageContext(payload);
      }
      if (endpoint === 'context/preflight') {
        if (!validPreflightAuth(payload)) return bad();
        if (!takeEndpointBudget(endpoint)) return bad();
        sweep();
        return preflightContext(payload);
      }
      if (endpoint === 'ui/preferences/get') return getPreferences(payload);
      if (endpoint === 'ui/preferences/write') return writePreferences(payload);
      if (endpoint === 'ui/preferences/read') return readPreferences(payload);
      if (endpoint === 'ui/preferences/sync') return syncPreferences(payload);
      if (endpoint === 'ui/preferences/settle') return settlePreferences(payload);
      if (endpoint === 'workspace/files/request') return requestWorkspaceFile(payload);
      if (endpoint === 'workspace/files/status') return statusWorkspaceFile(payload);
      if (endpoint === 'workspace/files/cancel') return cancelWorkspaceFile(payload);
      if (endpoint === 'workspace/files/read') return readWorkspaceFiles(payload);
      if (endpoint === 'workspace/files/claim') return claimWorkspaceFile(payload);
      if (endpoint === 'workspace/files/settle') return settleWorkspaceFile(payload);
      if (endpoint === 'events/read') {
        const value = withAuth(payload, ['contract', 'hostInstanceId', 'afterEventSeq']);
        if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
            || !Number.isSafeInteger(value.afterEventSeq) || value.afterEventSeq < 0) return bad();
        if (!takeEndpointBudget(endpoint)) return bad();
        sweep();
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
