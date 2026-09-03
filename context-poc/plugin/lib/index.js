import {
  createDecipheriv, createHash, createHmac, randomUUID, timingSafeEqual
} from 'node:crypto';
import { chmodSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';

export const name = 'whaledock-context-bridge-poc';
export const inject = [
  'connection', 'systemPrompt', 'sessions', 'llm', 'apiProxy', 'agents', 'subprocess'
];

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
  'workspace-files-v1',
  'project-workbench-v1',
  'project-session-bootstrap-v1',
  'project-terminal-v1'
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SESSION_REF_RE = /^session-[a-f0-9]{64}$/;
const SESSION_BINDING_REF_RE = /^session-binding-[a-f0-9]{64}$/;
const SESSION_ROOT_REF_RE = /^session-root-[a-f0-9]{64}$/;
const PROJECT_OPEN_TOKEN_RE = /^project-open-[a-f0-9]{64}$/;
const PROJECT_BOOTSTRAP_TICKET_RE = /^project-bootstrap-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{16,10923}\.[A-Za-z0-9_-]{22}$/;
const PROJECT_BOOTSTRAP_NONCE_RE = /^[a-f0-9]{32}$/;
const DELIVERY_TARGET_REF_RE = /^delivery-target-[a-f0-9]{64}$/;
const PROJECT_ID_RE = /^wdp1_[a-f0-9]{32}$/;
const APP_PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
const PROJECT_TERMINAL_REF_RE = /^terminal-[a-f0-9]{32}$/;
const PROJECT_TERMINAL_PANE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
  'review.tactics.read', 'review.solidify',
  'shoot.open', 'shoot.history.read',
  'receipts.read', 'receipts.ack', 'receipts.open',
  'projects.list', 'projects.create', 'projects.update', 'projects.remove',
  'projects.bind', 'projects.reorder', 'projects.open', 'projects.adopt',
  'projects.sidecar', 'projects.detach', 'console.read'
]);
const PROJECT_OPERATIONS = new Set([
  'projects.list', 'projects.create', 'projects.update', 'projects.remove',
  'projects.bind', 'projects.reorder', 'projects.open', 'projects.adopt',
  'projects.sidecar', 'projects.detach', 'console.read'
]);
const WORKSPACE_FILE_DELIVERY_OPERATIONS = new Set([
  'project.action.prepare', 'project.action.submit',
  'block.action.prepare', 'block.action.submit'
]);
const WORKSPACE_FILE_STATES = new Set([
  'queued', 'running', 'fulfilled', 'rejected', 'cancelled', 'expired'
]);
const WORKSPACE_FILE_REJECT_CODES = new Set([
  'workspace-unavailable', 'workspace-mismatch', 'operation-invalid',
  'operation-timeout', 'operation-failed', 'operation-stale', 'outcome-unknown', 'busy',
  'cancelled', 'project-not-found', 'project-folder-invalid', 'project-protected',
  'project-duplicate-folder', 'project-identity-conflict', 'project-limit'
]);
const WORKSPACE_FILE_FORBIDDEN_KEYS = new Set([
  'absolutepath', 'relativepath', 'effectivepath', 'workspacekey', 'cwd',
  'filepath', 'root', 'rootpath', 'frontmatter', 'patch',
  'sessionref', 'sessionrootref', 'currentbindingref', 'currentsessionid',
  'rootauthorizationtoken',
  'rawsession', 'context', 'envelope',
  'deliverytargetref',
  'authtoken', 'selectiontoken', 'controllerproof', 'claimtoken', 'requestseq',
  'hash', 'dev', 'ino'
]);
const MAX_WORKSPACE_FILE_INPUT_BYTES = 4 * 1024;
const MAX_WORKSPACE_FILE_RESULT_BYTES = 6 * 1024;
const MAX_PROJECT_DETAIL_BYTES = 24 * 1024;
const MAX_PROJECT_LIST_BYTES = 32 * 1024;
const MAX_PROJECT_CONSOLE_BYTES = 48 * 1024;
const MAX_PROJECT_RESULT_BYTES = 64 * 1024;
const MAX_PROJECT_CONSOLE_SESSIONS = 512;
const MAX_PROJECT_RECENT_CHARS = 160;
const MAX_WORKSPACE_FILE_JOBS = 64;
const MAX_WORKSPACE_FILE_QUEUED = 32;
const MAX_WORKSPACE_FILE_PER_CONTROLLER = 4;
const MAX_WORKSPACE_FILE_READ_BATCH = 4;
// backend 的完整 HTTP 回包上限为 64KiB。这里按 Host RPC result 的
// 实际 UTF-8 序列化体积动态装箱，并为 client-request 中最多 8KiB 的
// rpcId 回显与 server-response 外层信封预留空间。
const MAX_WORKSPACE_FILE_READ_RESULT_BYTES = 56 * 1024;
const WORKSPACE_FILE_PENDING_MS = 10000;
const WORKSPACE_FILE_RUNNING_MS = 10000;
const WORKSPACE_FILE_RETAIN_MS = 30000;
const WORKSPACE_FILE_ROOT_AUTHORIZATION_MS = 5000;
const PROJECT_BOOTSTRAP_TICKET_MS = 10000;
const PROJECT_BOOTSTRAP_CLOCK_SKEW_MS = 1000;
const MAX_PROJECT_BOOTSTRAP_TICKET_BYTES = 8192;
const MAX_PROJECT_BOOTSTRAP_REPLAYS = 128;
const PROJECT_BOOTSTRAP_SESSION_PREFIX = 'session-whaledock-project-';
const PROJECT_TERMINAL_LIMITS = Object.freeze({
  host: 4,
  project: 2,
  pane: 1,
  outputBytes: 512 * 1024,
  readBytes: 32 * 1024,
  inputBytes: 8 * 1024,
  minCols: 20,
  maxCols: 300,
  minRows: 5,
  maxRows: 120,
  graceMs: 4000
});
const PROJECT_TERMINAL_INPUT_CONTROL_RE = /[\u0000-\u0007\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const PROJECT_TERMINAL_BIDI_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const PROJECT_TERMINAL_HOME_PREFIX = 'whaledock-project-terminal-';
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
  'workspace/files/authorize': 32,
  'workspace/files/settle': 32,
  'projects/session/resolve': 16,
  'projects/session/bootstrap': 8,
  'terminal.open': 8,
  'terminal.read': 128,
  'terminal.write': 64,
  'terminal.signal': 16,
  'terminal.close': 16
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

function deliveryTargetRef(secret, hostInstanceId, rawSessionId) {
  return `delivery-target-${createHmac('sha256', secret)
    .update(`whaledock-delivery-target-v1\0${hostInstanceId}\0${rawSessionId}`)
    .digest('hex')}`;
}

// 项目绑定跨 Host 重启稳定；它不是现有单轮、随机的 sessionRef。
function sessionBindingRef(rawSessionId) {
  return `session-binding-${sha256(`whaledock-session-binding/v1\0${rawSessionId}`)}`;
}

// session.header.cwd 只在 Host 内部 realpath；跨进程仅传当次 Host
// auth token 域分离的 opaque HMAC，Client 既看不到路径也不能伪造 proof。
function canonicalSessionRoot(value) {
  if (typeof value !== 'string' || !value || CONTROL_RE.test(value)
      || Buffer.byteLength(value, 'utf8') > 4096 || !path.isAbsolute(value)) return null;
  try {
    const stat = statSync(value);
    if (!stat || !stat.isDirectory()) return null;
    const resolver = typeof realpathSync.native === 'function' ? realpathSync.native : realpathSync;
    let normalized = resolver(value);
    if (process.platform === 'win32') {
      if (normalized.startsWith('\\\\?\\UNC\\')) normalized = `\\\\${normalized.slice(8)}`;
      else if (/^\\\\\?\\[A-Za-z]:/.test(normalized)) normalized = normalized.slice(4);
    }
    normalized = path.resolve(normalized);
    return process.platform === 'win32'
      ? normalized.toLocaleLowerCase('en-US') : normalized;
  } catch (_error) { return null; }
}

function projectTerminalRootIdentity(root) {
  if (typeof root !== 'string' || !root) return null;
  try {
    const stat = statSync(root);
    if (!stat?.isDirectory()) return null;
    const field = (value) => {
      if (typeof value === 'bigint') return value >= 0n ? String(value) : null;
      return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    };
    const dev = field(stat.dev);
    const ino = field(stat.ino);
    return dev === null || ino === null ? null : `${dev}:${ino}`;
  } catch (_error) { return null; }
}

function projectTerminalRootGeneration(secret, hostInstanceId, root, identity) {
  if (typeof root !== 'string' || typeof identity !== 'string') return null;
  return createHmac('sha256', secret)
    .update(`whaledock-project-terminal-root/v1\0${hostInstanceId}\0${root}\0${identity}`)
    .digest('hex');
}

class ProjectTerminalSanitizer {
  constructor() {
    this.state = 'text';
    this.pendingCr = false;
    this.finished = false;
  }

  write(value) {
    if (this.finished || typeof value !== 'string') return '';
    let output = '';
    const append = (character) => {
      if (this.pendingCr) {
        output += '\n';
        this.pendingCr = false;
        if (character === '\n') return;
      }
      if (character === '\r') { this.pendingCr = true; return; }
      if (character === '\n' || character === '\t') { output += character; return; }
      const code = character.charCodeAt(0);
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)
          || PROJECT_TERMINAL_BIDI_RE.test(character)) return;
      output += character;
    };
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (this.state === 'text') {
        if (code === 0x1b) { this.state = 'escape'; continue; }
        if (code === 0x9b) { this.state = 'csi'; continue; }
        if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
          this.state = 'control-string';
          continue;
        }
        if (code === 0x9c) continue;
        append(character);
        continue;
      }
      if (this.state === 'escape') {
        if (character === '[') this.state = 'csi';
        else if ([']', 'P', 'X', '^', '_'].includes(character)) {
          this.state = 'control-string';
        } else if (code === 0x1b) this.state = 'escape';
        else if (code >= 0x30 && code <= 0x7e) this.state = 'text';
        continue;
      }
      if (this.state === 'csi') {
        if (code === 0x1b) this.state = 'escape';
        else if (code >= 0x40 && code <= 0x7e) this.state = 'text';
        continue;
      }
      if (this.state === 'control-string') {
        if (code === 0x07 || code === 0x9c) this.state = 'text';
        else if (code === 0x1b) this.state = 'control-string-escape';
        continue;
      }
      if (this.state === 'control-string-escape') {
        if (character === '\\' || code === 0x9c) this.state = 'text';
        else if (code !== 0x1b) this.state = 'control-string';
      }
    }
    return output;
  }

  finish() {
    if (this.finished) return '';
    this.finished = true;
    const output = this.pendingCr ? '\n' : '';
    this.pendingCr = false;
    this.state = 'text';
    return output;
  }
}

function projectTerminalContinuationByte(value) {
  return (value & 0xc0) === 0x80;
}

function projectTerminalUtf8Prefix(value, maximum) {
  if (value.length <= maximum) return value;
  let end = maximum;
  while (end > 0 && projectTerminalContinuationByte(value[end])) end -= 1;
  return value.subarray(0, end);
}

class ProjectTerminalBuffer {
  constructor() {
    this.chunks = [];
    this.retainedBytes = 0;
    this.startSeq = 0;
    this.endSeq = 0;
    this.truncated = false;
    this.closed = false;
    this.sanitizer = new ProjectTerminalSanitizer();
  }

  appendClean(clean) {
    const bytes = Buffer.from(clean, 'utf8');
    this.endSeq += bytes.length;
    if (bytes.length) {
      this.chunks.push(bytes);
      this.retainedBytes += bytes.length;
    }
    while (this.retainedBytes > PROJECT_TERMINAL_LIMITS.outputBytes
        && this.chunks.length) {
      const excess = this.retainedBytes - PROJECT_TERMINAL_LIMITS.outputBytes;
      const first = this.chunks[0];
      if (first.length <= excess) {
        this.chunks.shift();
        this.retainedBytes -= first.length;
        this.startSeq += first.length;
        this.truncated = true;
        continue;
      }
      let cut = excess;
      while (cut < first.length && projectTerminalContinuationByte(first[cut])) cut += 1;
      this.chunks[0] = first.subarray(cut);
      this.retainedBytes -= cut;
      this.startSeq += cut;
      this.truncated = true;
    }
  }

  append(value) {
    if (this.closed || typeof value !== 'string') return;
    this.appendClean(this.sanitizer.write(value));
  }

  finish() {
    if (this.closed) return;
    const tail = this.sanitizer.finish();
    this.appendClean(tail);
    this.closed = true;
  }

  page(afterSeq, maxBytes) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > this.endSeq
        || !Number.isSafeInteger(maxBytes) || maxBytes < 4
        || maxBytes > PROJECT_TERMINAL_LIMITS.readBytes) return null;
    const retained = this.chunks.length ? Buffer.concat(this.chunks) : Buffer.alloc(0);
    let offset = Math.max(afterSeq, this.startSeq) - this.startSeq;
    while (offset < retained.length && projectTerminalContinuationByte(retained[offset])) {
      offset += 1;
    }
    const fromSeq = this.startSeq + offset;
    const selected = projectTerminalUtf8Prefix(retained.subarray(offset), maxBytes);
    const nextSeq = fromSeq + selected.length;
    return Object.freeze({
      contentType: 'text/plain',
      renderMode: 'text-only',
      text: selected.toString('utf8'),
      fromSeq,
      nextSeq,
      endSeq: this.endSeq,
      retainedBytes: this.retainedBytes,
      truncated: afterSeq < this.startSeq,
      hasMore: nextSeq < this.endSeq
    });
  }
}

function createProjectTerminalHome() {
  let created = null;
  try {
    const resolver = typeof realpathSync.native === 'function' ? realpathSync.native : realpathSync;
    const parent = resolver(tmpdir());
    created = mkdtempSync(path.join(parent, PROJECT_TERMINAL_HOME_PREFIX));
    chmodSync(created, 0o700);
    const canonical = resolver(created);
    if (path.dirname(canonical) !== parent
        || !path.basename(canonical).startsWith(PROJECT_TERMINAL_HOME_PREFIX)) {
      throw new Error('terminal home escaped private parent');
    }
    return Object.freeze({ path: canonical, parent });
  } catch (_error) {
    if (created !== null) {
      try { rmSync(created, { recursive: true, force: true }); } catch (_cleanupError) {}
    }
    return null;
  }
}

function removeProjectTerminalHome(home) {
  if (!home || typeof home.path !== 'string' || typeof home.parent !== 'string'
      || path.dirname(home.path) !== home.parent
      || !path.basename(home.path).startsWith(PROJECT_TERMINAL_HOME_PREFIX)) return false;
  try {
    rmSync(home.path, { recursive: true, force: true });
    return true;
  } catch (_error) { return false; }
}

function projectTerminalLaunchPlan(root, privateHome) {
  if (typeof privateHome !== 'string' || !privateHome) return null;
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const environment = Object.freeze({
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: privateHome,
      TMPDIR: privateHome,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      SHELL: '/bin/bash',
      HISTFILE: '/dev/null'
    });
    const order = [
      'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'SHELL', 'HISTFILE'
    ];
    return Object.freeze({
      argv: Object.freeze([
        '/usr/bin/env', '-i', ...order.map((key) => `${key}=${environment[key]}`),
        '/bin/bash', '--noprofile', '--norc', '-i'
      ]),
      cwd: root,
      env: environment
    });
  }
  if (process.platform !== 'win32') return null;
  const systemRoot = 'C:\\Windows';
  const environment = Object.freeze({
    PATH: `${systemRoot}\\System32;${systemRoot};${systemRoot}\\System32\\Wbem;${systemRoot}\\System32\\WindowsPowerShell\\v1.0`,
    HOME: privateHome,
    USERPROFILE: privateHome,
    TEMP: privateHome,
    TMP: privateHome,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    COMSPEC: `${systemRoot}\\System32\\cmd.exe`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    POWERSHELL_UPDATECHECK: 'Off'
  });
  const names = Object.keys(environment)
    .map((name) => `'${name.replaceAll("'", "''")}'`).join(',');
  const bootstrap = [
    `$wdNames = @(${names})`,
    '$wdValues = @{}',
    'foreach ($wdName in $wdNames) {',
    "  $wdValues[$wdName] = [Environment]::GetEnvironmentVariable($wdName, 'Process')",
    '}',
    'Get-ChildItem Env: | ForEach-Object {',
    "  Remove-Item -LiteralPath ('Env:' + $_.Name) -ErrorAction SilentlyContinue",
    '}',
    'foreach ($wdName in $wdNames) {',
    '  $wdValue = $wdValues[$wdName]',
    '  if ($null -ne $wdValue) {',
    "    [Environment]::SetEnvironmentVariable($wdName, [string]$wdValue, 'Process')",
    '  }',
    '}',
    'Set-PSReadLineOption -HistorySaveStyle SaveNothing -ErrorAction SilentlyContinue',
    'Remove-Variable wdName, wdNames, wdValue, wdValues -ErrorAction SilentlyContinue'
  ].join('\r\n');
  return Object.freeze({
    argv: Object.freeze([
      'powershell.exe', '-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand',
      Buffer.from(bootstrap, 'utf16le').toString('base64')
    ]),
    cwd: root,
    env: environment
  });
}

function sessionRootRef(secret, hostInstanceId, cwd) {
  const canonical = canonicalSessionRoot(cwd);
  if (canonical === null) return null;
  return `session-root-${createHmac('sha256', secret)
    .update(`whaledock-session-root/v1\0${hostInstanceId}\0${canonical}`)
    .digest('hex')}`;
}

function projectBootstrapKey(secret) {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update('whaledock-project-bootstrap-key/v1')
    .digest();
}

function openProjectBootstrapTicket(secret, hostInstanceId, ticket, expected, now = Date.now()) {
  try {
    if (typeof secret !== 'string' || !TOKEN_RE.test(secret)
        || !validId(hostInstanceId) || typeof ticket !== 'string'
        || !PROJECT_BOOTSTRAP_TICKET_RE.test(ticket)
        || Buffer.byteLength(ticket, 'utf8') > MAX_PROJECT_BOOTSTRAP_TICKET_BYTES
        || !plain(expected) || !validId(expected.controllerId)
        || !validId(expected.pageInstanceId)
        || !validPreferenceRevision(expected.selectionRevision)
        || !APP_PROJECT_ID_RE.test(expected.projectId)
        || !PROJECT_OPEN_TOKEN_RE.test(expected.openToken)
        || !Number.isSafeInteger(now) || now < 0) return null;
    const parts = ticket.split('.');
    const iv = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || encrypted.length < 1 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', projectBootstrapKey(secret), iv);
    decipher.setAAD(Buffer.from(`project-bootstrap-v1\0${hostInstanceId}`, 'utf8'));
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([
      decipher.update(encrypted), decipher.final()
    ]).toString('utf8');
    if (Buffer.byteLength(decoded, 'utf8') > 6144) return null;
    const value = JSON.parse(decoded);
    if (!exact(value, [
      'version', 'hostInstanceId', 'controllerId', 'pageInstanceId',
      'selectionRevision', 'projectId', 'openToken', 'root',
      'issuedAtMs', 'expiresAtMs', 'nonce'
    ]) || value.version !== 1 || value.hostInstanceId !== hostInstanceId
        || value.controllerId !== expected.controllerId
        || value.pageInstanceId !== expected.pageInstanceId
        || value.selectionRevision !== expected.selectionRevision
        || value.projectId !== expected.projectId
        || value.openToken !== expected.openToken
        || typeof value.root !== 'string' || !value.root
        || Buffer.byteLength(value.root, 'utf8') > 4096
        || CONTROL_RE.test(value.root) || !path.isAbsolute(value.root)
        || !PROJECT_BOOTSTRAP_NONCE_RE.test(String(value.nonce || ''))
        || !Number.isSafeInteger(value.issuedAtMs) || value.issuedAtMs < 0
        || !Number.isSafeInteger(value.expiresAtMs)
        || value.expiresAtMs <= value.issuedAtMs
        || value.expiresAtMs - value.issuedAtMs > PROJECT_BOOTSTRAP_TICKET_MS
        || value.issuedAtMs > now + PROJECT_BOOTSTRAP_CLOCK_SKEW_MS
        || now >= value.expiresAtMs) return null;
    return Object.freeze({
      projectId: value.projectId,
      openToken: value.openToken,
      root: value.root,
      nonce: value.nonce,
      expiresAtMs: value.expiresAtMs
    });
  } catch (_error) { return null; }
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

function workspaceFileLimits(operation) {
  if (operation === 'console.read') {
    return Object.freeze({ input: MAX_PROJECT_CONSOLE_BYTES, result: MAX_PROJECT_RESULT_BYTES });
  }
  if (operation === 'projects.list') {
    return Object.freeze({ input: MAX_WORKSPACE_FILE_INPUT_BYTES, result: MAX_PROJECT_LIST_BYTES });
  }
  if (PROJECT_OPERATIONS.has(operation)) {
    return Object.freeze({ input: MAX_PROJECT_DETAIL_BYTES, result: MAX_PROJECT_DETAIL_BYTES });
  }
  return Object.freeze({
    input: MAX_WORKSPACE_FILE_INPUT_BYTES,
    result: MAX_WORKSPACE_FILE_RESULT_BYTES
  });
}

function safeWorkspaceValue(value, maximumBytes, options = {}) {
  const maxDepth = Number.isSafeInteger(options.maxDepth) ? options.maxDepth : 5;
  const maxArrayItems = Number.isSafeInteger(options.maxArrayItems) ? options.maxArrayItems : 64;
  const maxStringBytes = Number.isSafeInteger(options.maxStringBytes) ? options.maxStringBytes : 2048;
  const maxInteger = Number.isSafeInteger(options.maxInteger)
    ? options.maxInteger : 1_000_000_000_000;
  const maxKeyChars = Number.isSafeInteger(options.maxKeyChars) ? options.maxKeyChars : 64;
  const canonicalKey = (key) => key.toLowerCase().replace(/[-_]/g, '');
  const visit = (item, depth) => {
    if (depth > maxDepth) return null;
    if (item === null || typeof item === 'boolean') return item;
    if (Number.isSafeInteger(item) && Math.abs(item) <= maxInteger) return item;
    if (typeof item === 'string') {
      return Buffer.byteLength(item, 'utf8') <= maxStringBytes && !WORKSPACE_TEXT_CONTROL_RE.test(item)
        ? item : null;
    }
    if (Array.isArray(item)) {
      if (item.length > maxArrayItems) return null;
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
      if (typeof key !== 'string' || key.length < 1 || key.length > maxKeyChars
          || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)
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

function safeWorkspaceOperationValue(operation, value, direction) {
  const limits = workspaceFileLimits(operation);
  const project = PROJECT_OPERATIONS.has(operation);
  return safeWorkspaceValue(value, limits[direction], project ? {
    maxDepth: 12,
    maxArrayItems: MAX_PROJECT_CONSOLE_SESSIONS,
    maxStringBytes: MAX_PROJECT_DETAIL_BYTES,
    maxInteger: Number.MAX_SAFE_INTEGER,
    maxKeyChars: operation === 'console.read' ? 128 : 64
  } : undefined);
}

function validBoundRawSession(value) {
  return value !== null && validRawSession(value);
}

function redactRecentPaths(value) {
  if (typeof value !== 'string' || !value) return value;
  // 引号内路径可以精确找到边界；未引号路径包含空格时无法
  // 区分后续是文件名还是自然语言，因此从绝对/tilde 起点保守隐去到行尾。
  return value
    .replace(/(["'`])(?:~[\\/]|\/{1,2}|[A-Za-z]:[\\/]|\\\\)[^"'`\r\n]*\1/g,
      '[路径]')
    .replace(/(^|[^A-Za-z0-9])(?:~[\\/]|\/{1,2}|[A-Za-z]:[\\/]|\\\\)[^\r\n]*/g,
      '$1[路径]');
}

// Client 先把官方 snapshot 收窄成数组，Host 再把所有 raw id 换成稳定 bindingRef；
// 这样 main/项目 operation 永远看不到 dsh 原始 session id，也避开长 opaque id 作为 JSON key。
function redactedRecentMessage(event, now = Date.now()) {
  if (!event || !['user/message', 'assistant/message'].includes(event.type)
      || !Number.isSafeInteger(now) || now < 0) return null;
  const content = event.data?.message?.content;
  if (!Array.isArray(content)) return null;
  let text = content.filter((part) => plain(part) && part.type === 'text'
    && typeof part.text === 'string').map((part) => part.text).join(' ');
  if (!text) return null;
  text = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:https?|ftp):\/\/\S+/gi, '[链接]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[邮箱]');
  text = redactRecentPaths(text)
    .replace(/\b(?:token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
      '[凭据字段]=[已隐去]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, '[凭据]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[长凭据]')
    .replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let clipped = text.slice(0, MAX_PROJECT_RECENT_CHARS);
  if (/[\ud800-\udbff]$/.test(clipped)) clipped = clipped.slice(0, -1);
  return Object.freeze({
    role: event.type === 'user/message' ? 'user' : 'assistant',
    text: clipped.length < text.length ? `${clipped.slice(0, -1)}…` : clipped,
    updatedAt: now
  });
}

function projectConsoleSnapshot(value, recentMessages = new Map()) {
  if (!exact(value, ['byId', 'subagentsByParent', 'jobsBySession', 'current'])
      || !Array.isArray(value.byId) || value.byId.length > MAX_PROJECT_CONSOLE_SESSIONS
      || !Array.isArray(value.subagentsByParent)
      || value.subagentsByParent.length > MAX_PROJECT_CONSOLE_SESSIONS
      || !Array.isArray(value.jobsBySession)
      || value.jobsBySession.length > MAX_PROJECT_CONSOLE_SESSIONS
      || !(value.current === null || validBoundRawSession(value.current))) return null;
  const seen = new Set();
  const byId = {};
  for (const entry of value.byId) {
    if (!exact(entry, [
      'sessionId', 'running', 'completed', 'pendingInteraction',
      'parentId', 'displayTitle', 'updatedAt'
    ]) || !validBoundRawSession(entry.sessionId) || seen.has(entry.sessionId)
        || typeof entry.running !== 'boolean' || typeof entry.completed !== 'boolean'
        || !(entry.pendingInteraction === null || (
          typeof entry.pendingInteraction === 'string'
          && ['approval', 'plan-review', 'question'].includes(entry.pendingInteraction)
        )) || !(entry.parentId === null || validBoundRawSession(entry.parentId))
        || typeof entry.displayTitle !== 'string'
        || Buffer.byteLength(entry.displayTitle, 'utf8') > 512
        || WORKSPACE_TEXT_CONTROL_RE.test(entry.displayTitle)
        || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0) return null;
    seen.add(entry.sessionId);
    const bindingRef = sessionBindingRef(entry.sessionId);
    const recent = recentMessages.has(entry.sessionId)
      ? recentMessages.get(entry.sessionId) : null;
    byId[bindingRef] = Object.freeze({
      id: bindingRef,
      running: entry.running,
      completed: entry.completed,
      pendingInteraction: entry.pendingInteraction,
      parentId: entry.parentId === null ? null : sessionBindingRef(entry.parentId),
      displayTitle: entry.displayTitle,
      updatedAt: entry.updatedAt,
      ...(recent === null ? {} : { recent })
    });
  }
  const subagentsByParent = {};
  for (const row of value.subagentsByParent) {
    if (!exact(row, ['parentId', 'children']) || !validBoundRawSession(row.parentId)
        || !Array.isArray(row.children) || row.children.length > 64
        || row.children.some((id) => !validBoundRawSession(id))) return null;
    subagentsByParent[sessionBindingRef(row.parentId)] = Object.freeze(
      [...new Set(row.children)].map(sessionBindingRef)
    );
  }
  const jobsBySession = {};
  for (const row of value.jobsBySession) {
    if (!exact(row, ['sessionId', 'jobs']) || !validBoundRawSession(row.sessionId)
        || !Array.isArray(row.jobs) || row.jobs.length > 64) return null;
    const jobs = [];
    for (const job of row.jobs) {
      if (!exact(job, ['status', 'startedAt']) || typeof job.status !== 'string'
          || !job.status || job.status.length > 32 || CONTROL_RE.test(job.status)
          || !(job.startedAt === null || (Number.isSafeInteger(job.startedAt)
            && job.startedAt >= 0))) return null;
      jobs.push(Object.freeze({ status: job.status, startedAt: job.startedAt }));
    }
    jobsBySession[sessionBindingRef(row.sessionId)] = Object.freeze(jobs);
  }
  const snapshot = {
    byId: Object.freeze(byId),
    subagentsByParent: Object.freeze(subagentsByParent),
    jobsBySession: Object.freeze(jobsBySession),
    current: value.current === null ? null : sessionBindingRef(value.current)
  };
  return safeWorkspaceOperationValue('console.read', snapshot, 'input');
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
  const projectBootstrapReplays = new Map();
  const projectRecentMessages = new Map();
  const projectTerminals = new Map();
  const projectTerminalAllocations = new Set();
  let projectTerminalDisposed = false;
  let revokeTerminalsForController = () => {};
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
      if (now - selection.seenAt >= LEASE_MS) {
        revokeTerminalsForController(controllerId, 'selection-expired');
        controllers.delete(controllerId);
      }
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
    if (previous) revokeTerminalsForController(previous.controllerId, 'selection-changed');
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
    if (raw !== null && current.state !== 'selected') {
      for (const owner of activeSelectionsFor(raw)) {
        revokeTerminalsForController(owner.controllerId, 'selection-conflict');
      }
    }
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

  const terminalOpenFailure = (code) => ok(Object.freeze({
    opened: false,
    code,
    terminalRef: null,
    capability: null,
    status: null,
    page: null
  }));

  const terminalReadFailure = (code) => ok(Object.freeze({
    accepted: false,
    code,
    status: null,
    page: null
  }));

  const terminalStatus = (entry) => {
    if (entry?.status?.kind === 'exited') {
      return Object.freeze({
        kind: 'exited',
        exitCode: Number.isSafeInteger(entry.status.exitCode) ? entry.status.exitCode : null,
        signal: typeof entry.status.signal === 'string'
          && /^[A-Z][A-Z0-9]{2,15}$/.test(entry.status.signal)
          ? entry.status.signal : null
      });
    }
    return Object.freeze({ kind: 'running' });
  };

  const terminalAuthorityFor = (selection) => {
    const resolved = resolveSelectionState(selection);
    if (!selection || selection.managed !== true || resolved.state !== 'selected'
        || resolved.sessionRef !== selection.sessionRef
        || !validBoundRawSession(selection.raw)) return null;
    let session = null;
    let owner = null;
    try {
      session = ctx.sessions?.get?.(selection.raw) || null;
      owner = ctx.agents?.get?.(selection.raw) || null;
    } catch (_error) { return null; }
    if (!session || !owner || String(session.id) !== selection.raw
        || owner.id !== selection.raw || owner.session !== session) return null;
    const root = canonicalSessionRoot(session.header?.cwd);
    if (root === null) return null;
    const rootIdentity = projectTerminalRootIdentity(root);
    const rootRef = sessionRootRef(authToken, hostInstanceId, root);
    const rootGeneration = rootIdentity === null ? null
      : projectTerminalRootGeneration(authToken, hostInstanceId, root, rootIdentity);
    if (rootIdentity === null || !SESSION_ROOT_REF_RE.test(String(rootRef || ''))
        || !TOKEN_RE.test(String(rootGeneration || ''))) return null;
    return Object.freeze({
      selection,
      session,
      owner,
      raw: selection.raw,
      root,
      rootIdentity,
      rootRef,
      rootGeneration
    });
  };

  const terminalCapabilityFor = (entry) => createHmac('sha256', authToken)
    .update([
      'whaledock-project-terminal-capability/v1', hostInstanceId,
      entry.controllerId, entry.pageInstanceId, entry.selectionRevision,
      entry.sessionRef, entry.raw, entry.rootRef, entry.rootGeneration,
      entry.projectId, entry.paneRef, entry.terminalRef, entry.nonce
    ].join('\0'))
    .digest('hex');

  const terminalEntryFor = (payload) => {
    if (!PROJECT_TERMINAL_REF_RE.test(String(payload.terminalRef || ''))
        || !TOKEN_RE.test(String(payload.capability || ''))) return null;
    const entry = projectTerminals.get(payload.terminalRef);
    if (!entry || entry.projectId !== payload.projectId || entry.paneRef !== payload.paneRef) {
      return null;
    }
    const expected = terminalCapabilityFor(entry);
    return tokenMatches(entry.capability, expected)
      && tokenMatches(payload.capability, expected) ? entry : null;
  };

  const terminalEntryCurrent = (entry, selection) => {
    const authority = terminalAuthorityFor(selection);
    return authority && selection === controllers.get(entry.controllerId)
      && entry.controllerId === selection.controllerId
      && entry.pageInstanceId === selection.pageInstanceId
      && entry.selectionRevision === selection.selectionRevision
      && entry.sessionRef === selection.sessionRef
      && entry.raw === authority.raw
      && entry.session === authority.session
      && entry.owner === authority.owner
      && entry.root === authority.root
      && entry.rootIdentity === authority.rootIdentity
      && entry.rootRef === authority.rootRef
      && entry.rootGeneration === authority.rootGeneration
      ? authority : null;
  };

  const finishTerminalOutput = (entry) => {
    if (!entry || entry.outputFinished) return;
    entry.outputFinished = true;
    try {
      const tail = entry.decoder.end();
      if (tail) entry.buffer.append(tail);
    } catch (_error) {}
    entry.buffer.finish();
  };

  const detachTerminalOutput = (entry) => {
    if (!entry || entry.outputDetached) return;
    entry.outputDetached = true;
    const output = entry.handle?.output;
    if (output && typeof output.off === 'function') {
      output.off('data', entry.onOutputData);
      output.off('end', entry.onOutputEnd);
      output.off('close', entry.onOutputEnd);
      output.off('error', entry.onOutputError);
    }
    finishTerminalOutput(entry);
  };

  const closeTerminalEntry = async (entry) => {
    if (!entry) return false;
    entry.revoked = true;
    if (entry.leaseTimer) {
      clearTimeout(entry.leaseTimer);
      entry.leaseTimer = null;
    }
    detachTerminalOutput(entry);
    if (entry.quiescent) {
      if (!entry.homeRemoved) {
        entry.homeRemoved = removeProjectTerminalHome(entry.privateHome);
      }
      if (projectTerminals.get(entry.terminalRef) === entry) {
        projectTerminals.delete(entry.terminalRef);
      }
      return true;
    }
    if (entry.closing) return entry.closing;
    entry.closing = (async () => {
      try {
        await entry.handle.terminate();
        entry.quiescent = true;
        entry.homeRemoved = removeProjectTerminalHome(entry.privateHome);
        if (projectTerminals.get(entry.terminalRef) === entry) {
          projectTerminals.delete(entry.terminalRef);
        }
        return true;
      } catch (_error) { return false; }
      finally {
        if (!entry.quiescent) entry.closing = null;
      }
    })();
    return entry.closing;
  };

  const scheduleTerminalLeaseCheck = (record) => {
    if (!record) return;
    if (record.leaseTimer) clearTimeout(record.leaseTimer);
    const check = () => {
      record.leaseTimer = null;
      const published = projectTerminals.get(record.terminalRef) === record;
      const allocating = projectTerminalAllocations.has(record);
      if (!published && !allocating) return;
      const selection = controllers.get(record.controllerId);
      const now = Date.now();
      const sameGeneration = Boolean(selection
        && selection.pageInstanceId === record.pageInstanceId
        && selection.selectionRevision === record.selectionRevision
        && selection.sessionRef === record.sessionRef
        && selection.raw === record.raw);
      const remaining = selection ? LEASE_MS - (now - selection.seenAt) : 0;
      if (!sameGeneration || remaining <= 0) {
        if (allocating) record.abort.abort();
        if (published) void closeTerminalEntry(record);
        sweep(now);
        return;
      }
      record.leaseTimer = setTimeout(check, Math.max(1, remaining));
      if (typeof record.leaseTimer.unref === 'function') record.leaseTimer.unref();
    };
    const selection = controllers.get(record.controllerId);
    const delay = selection ? Math.max(1, LEASE_MS - (Date.now() - selection.seenAt)) : 1;
    record.leaseTimer = setTimeout(check, delay);
    if (typeof record.leaseTimer.unref === 'function') record.leaseTimer.unref();
  };

  const appendTerminalDecoded = (entry, value) => {
    if (entry.revoked || typeof value !== 'string' || !value) return;
    let offset = 0;
    while (offset < value.length) {
      let end = Math.min(value.length, offset + 65536);
      if (end < value.length && /[\ud800-\udbff]/.test(value[end - 1])) end -= 1;
      if (end <= offset) end = Math.min(value.length, offset + 2);
      entry.buffer.append(value.slice(offset, end));
      offset = end;
    }
  };

  const attachTerminalOutput = (entry) => {
    entry.onOutputData = (chunk) => {
      if (entry.revoked) return;
      try {
        if (typeof chunk === 'string') {
          appendTerminalDecoded(entry, chunk);
          return;
        }
        if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
          void closeTerminalEntry(entry);
          return;
        }
        const bytes = Buffer.isBuffer(chunk)
          ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          appendTerminalDecoded(entry, entry.decoder.write(bytes.subarray(
            offset, Math.min(bytes.length, offset + 65536)
          )));
        }
      } catch (_error) { void closeTerminalEntry(entry); }
    };
    entry.onOutputEnd = () => finishTerminalOutput(entry);
    entry.onOutputError = () => {
      finishTerminalOutput(entry);
      if (entry.status.kind !== 'exited') {
        entry.status = Object.freeze({ kind: 'exited', exitCode: null, signal: null });
      }
      void Promise.resolve(entry.handle.terminate()).catch(() => {});
    };
    entry.handle.output.on('data', entry.onOutputData);
    entry.handle.output.on('end', entry.onOutputEnd);
    entry.handle.output.on('close', entry.onOutputEnd);
    entry.handle.output.on('error', entry.onOutputError);
    Promise.resolve(entry.handle.done).then((outcome) => {
      entry.status = Object.freeze({
        kind: 'exited',
        exitCode: Number.isSafeInteger(outcome?.exitCode) ? outcome.exitCode : null,
        signal: typeof outcome?.signal === 'string' ? outcome.signal : null
      });
    }, () => {
      entry.status = Object.freeze({ kind: 'exited', exitCode: null, signal: null });
      void Promise.resolve(entry.handle.terminate()).catch(() => {});
    });
  };

  const terminalReservationCount = (predicate) => {
    let count = 0;
    for (const entry of projectTerminals.values()) if (predicate(entry)) count += 1;
    for (const entry of projectTerminalAllocations) if (predicate(entry)) count += 1;
    return count;
  };

  const revokeTerminalsWhere = (predicate) => {
    for (const allocation of projectTerminalAllocations) {
      if (predicate(allocation)) allocation.abort.abort();
    }
    for (const entry of projectTerminals.values()) {
      if (predicate(entry)) void closeTerminalEntry(entry);
    }
  };

  revokeTerminalsForController = (controllerId) => {
    revokeTerminalsWhere((entry) => entry.controllerId === controllerId);
  };

  const validTerminalIdentity = (payload) => APP_PROJECT_ID_RE.test(payload.projectId || '')
    && typeof payload.paneRef === 'string'
    && PROJECT_TERMINAL_PANE_REF_RE.test(payload.paneRef);

  const openProjectTerminal = async (payload) => {
    const selection = preferencePageSelection(payload, ['projectId', 'paneRef', 'cols', 'rows']);
    if (!selection || !validTerminalIdentity(payload)
        || !Number.isSafeInteger(payload.cols)
        || payload.cols < PROJECT_TERMINAL_LIMITS.minCols
        || payload.cols > PROJECT_TERMINAL_LIMITS.maxCols
        || !Number.isSafeInteger(payload.rows)
        || payload.rows < PROJECT_TERMINAL_LIMITS.minRows
        || payload.rows > PROJECT_TERMINAL_LIMITS.maxRows) return bad();
    if (!takeEndpointBudget('terminal.open')) return bad();
    const authority = terminalAuthorityFor(selection);
    if (!authority || projectTerminalDisposed
        || typeof ctx.subprocess?.spawnTerminal !== 'function'
        || typeof ctx.agents?.withInitiator !== 'function') {
      return terminalOpenFailure('terminal-unavailable');
    }
    if (terminalReservationCount(() => true) >= PROJECT_TERMINAL_LIMITS.host
        || terminalReservationCount((entry) => (
          entry.rootGeneration === authority.rootGeneration
        )) >= PROJECT_TERMINAL_LIMITS.project
        || terminalReservationCount((entry) => (
          entry.rootGeneration === authority.rootGeneration && entry.paneRef === payload.paneRef
        )) >= PROJECT_TERMINAL_LIMITS.pane) {
      return terminalOpenFailure('terminal-busy');
    }
    const privateHome = createProjectTerminalHome();
    if (!privateHome) return terminalOpenFailure('terminal-unavailable');
    const launch = projectTerminalLaunchPlan(authority.root, privateHome.path);
    if (!launch) {
      removeProjectTerminalHome(privateHome);
      return terminalOpenFailure('terminal-unavailable');
    }
    let terminalRef = null;
    for (let attempt = 0; attempt < 4 && terminalRef === null; attempt += 1) {
      const candidate = `terminal-${randomUUID().replaceAll('-', '')}`;
      const reserved = [...projectTerminalAllocations].some((entry) => (
        entry.terminalRef === candidate
      ));
      if (PROJECT_TERMINAL_REF_RE.test(candidate)
          && !projectTerminals.has(candidate) && !reserved) terminalRef = candidate;
    }
    if (terminalRef === null) {
      removeProjectTerminalHome(privateHome);
      return internal();
    }
    let settleAllocation;
    const allocation = {
      terminalRef,
      nonce: randomUUID().replaceAll('-', ''),
      projectId: payload.projectId,
      paneRef: payload.paneRef,
      controllerId: selection.controllerId,
      pageInstanceId: selection.pageInstanceId,
      selectionRevision: selection.selectionRevision,
      sessionRef: selection.sessionRef,
      raw: authority.raw,
      session: authority.session,
      owner: authority.owner,
      root: authority.root,
      rootIdentity: authority.rootIdentity,
      rootRef: authority.rootRef,
      rootGeneration: authority.rootGeneration,
      privateHome,
      abort: new AbortController(),
      leaseTimer: null,
      finished: new Promise((resolve) => { settleAllocation = resolve; })
    };
    projectTerminalAllocations.add(allocation);
    scheduleTerminalLeaseCheck(allocation);
    let handle = null;
    let published = false;
    let rollbackQuiescent = false;
    try {
      handle = await ctx.agents.withInitiator(authority.owner, () => (
        ctx.subprocess.spawnTerminal({
          argv: [...launch.argv],
          cwd: launch.cwd,
          env: { ...launch.env },
          rows: payload.rows,
          cols: payload.cols,
          graceMs: PROJECT_TERMINAL_LIMITS.graceMs,
          signal: allocation.abort.signal
        })
      ));
      const currentSelection = controllers.get(selection.controllerId);
      const current = terminalEntryCurrent(allocation, currentSelection);
      const validHandle = handle && typeof handle.write === 'function'
        && typeof handle.signalForeground === 'function'
        && typeof handle.terminate === 'function'
        && handle.output && typeof handle.output.on === 'function'
        && typeof handle.output.off === 'function'
        && handle.done && typeof handle.done.then === 'function';
      if (!current || !validHandle || allocation.abort.signal.aborted
          || projectTerminalDisposed) {
        if (handle && typeof handle.terminate === 'function') {
          try { await handle.terminate(); rollbackQuiescent = true; } catch (_error) {}
        }
        return terminalOpenFailure(current ? 'terminal-unavailable' : 'terminal-stale');
      }
      const entry = {
        ...allocation,
        handle,
        decoder: new StringDecoder('utf8'),
        buffer: new ProjectTerminalBuffer(),
        status: Object.freeze({ kind: 'running' }),
        capability: null,
        revoked: false,
        quiescent: false,
        closing: null,
        outputFinished: false,
        outputDetached: false,
        inputBusy: false,
        signalBusy: false
      };
      if (allocation.leaseTimer) {
        clearTimeout(allocation.leaseTimer);
        allocation.leaseTimer = null;
      }
      entry.leaseTimer = null;
      entry.capability = terminalCapabilityFor(entry);
      if (!TOKEN_RE.test(entry.capability)) {
        try { await handle.terminate(); rollbackQuiescent = true; } catch (_error) {}
        return terminalOpenFailure('terminal-unavailable');
      }
      projectTerminals.set(entry.terminalRef, entry);
      published = true;
      scheduleTerminalLeaseCheck(entry);
      attachTerminalOutput(entry);
      return ok(Object.freeze({
        opened: true,
        code: null,
        terminalRef: entry.terminalRef,
        capability: entry.capability,
        status: terminalStatus(entry),
        page: entry.buffer.page(0, PROJECT_TERMINAL_LIMITS.readBytes)
      }));
    } catch (_error) {
      if (handle && typeof handle.terminate === 'function') {
        try { await handle.terminate(); rollbackQuiescent = true; } catch (_cleanupError) {}
      }
      return terminalOpenFailure(allocation.abort.signal.aborted
        ? 'terminal-stale' : 'terminal-unavailable');
    } finally {
      projectTerminalAllocations.delete(allocation);
      if (allocation.leaseTimer) clearTimeout(allocation.leaseTimer);
      if (!published && (handle === null || rollbackQuiescent)) {
        removeProjectTerminalHome(privateHome);
      }
      settleAllocation();
    }
  };

  const readProjectTerminal = (payload) => {
    const selection = preferencePageSelection(payload, [
      'projectId', 'paneRef', 'terminalRef', 'capability', 'afterSeq', 'maxBytes'
    ]);
    if (!selection || !validTerminalIdentity(payload)
        || !Number.isSafeInteger(payload.afterSeq) || payload.afterSeq < 0
        || !Number.isSafeInteger(payload.maxBytes) || payload.maxBytes < 4
        || payload.maxBytes > PROJECT_TERMINAL_LIMITS.readBytes) return bad();
    const entry = terminalEntryFor(payload);
    if (!entry) return bad();
    if (!takeEndpointBudget('terminal.read')) return bad();
    if (entry.revoked || !terminalEntryCurrent(entry, selection)) {
      void closeTerminalEntry(entry);
      return terminalReadFailure('terminal-stale');
    }
    const page = entry.buffer.page(payload.afterSeq, payload.maxBytes);
    if (!page) return bad();
    return ok(Object.freeze({
      accepted: true,
      code: null,
      status: terminalStatus(entry),
      page
    }));
  };

  const writeProjectTerminal = async (payload) => {
    const selection = preferencePageSelection(payload, [
      'projectId', 'paneRef', 'terminalRef', 'capability', 'data'
    ]);
    if (!selection || !validTerminalIdentity(payload)
        || typeof payload.data !== 'string' || !payload.data
        || Buffer.byteLength(payload.data, 'utf8') > PROJECT_TERMINAL_LIMITS.inputBytes
        || PROJECT_TERMINAL_INPUT_CONTROL_RE.test(payload.data)) return bad();
    const entry = terminalEntryFor(payload);
    if (!entry) return bad();
    if (!takeEndpointBudget('terminal.write')) return bad();
    if (entry.revoked || !terminalEntryCurrent(entry, selection)) {
      void closeTerminalEntry(entry);
      return ok({ accepted: false, code: 'terminal-stale' });
    }
    if (entry.status.kind === 'exited') {
      return ok({ accepted: false, code: 'terminal-exited' });
    }
    if (entry.inputBusy) return ok({ accepted: false, code: 'terminal-busy' });
    entry.inputBusy = true;
    try {
      await entry.handle.write(payload.data);
      if (!terminalEntryCurrent(entry, controllers.get(entry.controllerId))) {
        void closeTerminalEntry(entry);
        return ok({ accepted: false, code: 'outcome-unknown' });
      }
      return ok({ accepted: true, code: null });
    } catch (_error) {
      return ok({ accepted: false, code: 'terminal-write-failed' });
    } finally { entry.inputBusy = false; }
  };

  const signalProjectTerminal = async (payload) => {
    const selection = preferencePageSelection(payload, [
      'projectId', 'paneRef', 'terminalRef', 'capability', 'signal'
    ]);
    if (!selection || !validTerminalIdentity(payload) || payload.signal !== 'SIGINT') return bad();
    const entry = terminalEntryFor(payload);
    if (!entry) return bad();
    if (!takeEndpointBudget('terminal.signal')) return bad();
    if (entry.revoked || !terminalEntryCurrent(entry, selection)) {
      void closeTerminalEntry(entry);
      return ok({ delivered: false, code: 'terminal-stale' });
    }
    if (entry.status.kind === 'exited') {
      return ok({ delivered: false, code: 'terminal-exited' });
    }
    if (entry.signalBusy) return ok({ delivered: false, code: 'terminal-busy' });
    entry.signalBusy = true;
    try {
      const group = await entry.handle.signalForeground('SIGINT');
      if (!Number.isSafeInteger(group) || group < 1) {
        return ok({ delivered: false, code: 'terminal-signal-failed' });
      }
      if (!terminalEntryCurrent(entry, controllers.get(entry.controllerId))) {
        void closeTerminalEntry(entry);
        return ok({ delivered: false, code: 'outcome-unknown' });
      }
      return ok({ delivered: true, code: null });
    } catch (_error) {
      return ok({ delivered: false, code: 'terminal-signal-failed' });
    } finally { entry.signalBusy = false; }
  };

  const closeProjectTerminal = async (payload) => {
    const selection = preferencePageSelection(payload, [
      'projectId', 'paneRef', 'terminalRef', 'capability'
    ]);
    if (!selection || !validTerminalIdentity(payload)) return bad();
    const entry = terminalEntryFor(payload);
    if (!entry) return bad();
    if (!takeEndpointBudget('terminal.close')) return bad();
    const current = terminalEntryCurrent(entry, selection);
    const quiescent = await closeTerminalEntry(entry);
    return ok(Object.freeze({
      closed: quiescent,
      quiescent,
      code: quiescent ? (current ? null : 'terminal-stale') : 'terminal-close-failed'
    }));
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

  const prepareProjectOperationInput = (operation, input, selection) => {
    if (operation === 'projects.list') {
      if (!exact(input, ['cursor', 'limit', 'includeHidden'])
          || !Number.isSafeInteger(input.cursor) || input.cursor < 0
          || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 32
          || typeof input.includeHidden !== 'boolean') return { code: 'operation-invalid' };
      return { input };
    }
    if (operation === 'projects.create') {
      if (!plain(input) || Object.keys(input).some((key) => (
        key !== 'name' && key !== 'icon' && key !== 'templateId'
      ))) return { code: 'operation-invalid' };
      return { input };
    }
    if (operation === 'projects.adopt') {
      return exact(input, []) ? { input } : { code: 'operation-invalid' };
    }
    if (operation === 'projects.update') {
      if (!exact(input, ['projectId', 'changes']) || !APP_PROJECT_ID_RE.test(input.projectId)
          || !plain(input.changes) || Object.keys(input.changes).length < 1
          || Object.keys(input.changes).some((key) => ![
            'name', 'icon', 'hidden', 'layoutPreset', 'paneState'
          ].includes(key))) return { code: 'operation-invalid' };
      return { input };
    }
    if (operation === 'projects.remove') {
      return exact(input, ['projectId']) && APP_PROJECT_ID_RE.test(input.projectId)
        ? { input } : { code: 'operation-invalid' };
    }
    if (operation === 'projects.sidecar') {
      return exact(input, ['projectId']) && APP_PROJECT_ID_RE.test(input.projectId)
        ? { input } : { code: 'operation-invalid' };
    }
    if (operation === 'projects.detach') {
      return exact(input, ['projectId', 'window', 'tabId'])
        && APP_PROJECT_ID_RE.test(input.projectId)
        && Number.isSafeInteger(input.window) && input.window >= 1 && input.window <= 16
        && typeof input.tabId === 'string' && input.tabId.length >= 1
        && input.tabId.length <= 128 && !CONTROL_RE.test(input.tabId)
        ? { input } : { code: 'operation-invalid' };
    }
    if (operation === 'projects.bind') {
      if (!exact(input, ['projectId'], ['openToken'])
          || !APP_PROJECT_ID_RE.test(input.projectId)
          || (Object.prototype.hasOwnProperty.call(input, 'openToken')
            && !PROJECT_OPEN_TOKEN_RE.test(String(input.openToken || '')))) {
        return { code: 'operation-invalid' };
      }
      if (!selection || !validBoundRawSession(selection.raw)) {
        return { code: 'workspace-unavailable' };
      }
      let session = null;
      try { session = ctx.sessions?.get?.(selection.raw) || null; }
      catch (_error) { session = null; }
      const rootRef = sessionRootRef(authToken, hostInstanceId, session?.header?.cwd);
      if (!SESSION_ROOT_REF_RE.test(String(rootRef || ''))) {
        return { code: 'workspace-unavailable' };
      }
      return { input: Object.freeze({
        projectId: input.projectId,
        bindingRef: sessionBindingRef(selection.raw),
        ...(Object.prototype.hasOwnProperty.call(input, 'openToken')
          ? { openToken: input.openToken } : {})
      }), sessionRootRef: rootRef };
    }
    if (operation === 'projects.reorder') {
      if (!exact(input, ['ids']) || !Array.isArray(input.ids)
          || input.ids.length < 1 || input.ids.length > 128
          || input.ids.some((id) => !APP_PROJECT_ID_RE.test(id))
          || new Set(input.ids).size !== input.ids.length) return { code: 'operation-invalid' };
      return { input };
    }
    if (operation === 'projects.open') {
      if (!plain(input) || !APP_PROJECT_ID_RE.test(input.projectId)
          || (input.phase !== 'prepare' && input.phase !== 'commit')) {
        return { code: 'operation-invalid' };
      }
      if (input.phase === 'prepare') {
        return exact(input, ['projectId', 'phase']) ? { input } : { code: 'operation-invalid' };
      }
      if (!exact(input, ['projectId', 'phase', 'openToken', 'bindingRef'])
          || !PROJECT_OPEN_TOKEN_RE.test(input.openToken)
          || !SESSION_BINDING_REF_RE.test(input.bindingRef)) {
        return { code: 'operation-invalid' };
      }
      if (!selection || !validBoundRawSession(selection.raw)
          || sessionBindingRef(selection.raw) !== input.bindingRef) {
        return { code: 'workspace-unavailable' };
      }
      let session = null;
      try { session = ctx.sessions?.get?.(selection.raw) || null; }
      catch (_error) { session = null; }
      const rootRef = sessionRootRef(authToken, hostInstanceId, session?.header?.cwd);
      if (!SESSION_ROOT_REF_RE.test(String(rootRef || ''))) {
        return { code: 'workspace-unavailable' };
      }
      // bindingRef 只用于 Host 确认 Client 已真实切到目标会话；
      // main 的公开 input 仅收 prepare 发放的 openToken。Host 从已验证
      // raw 重新计算的 stable ref 只放在内部 job metadata，页面无法覆盖。
      return {
        input: Object.freeze({
          projectId: input.projectId,
          phase: 'commit',
          openToken: input.openToken
        }),
        currentBindingRef: sessionBindingRef(selection.raw),
        sessionRootRef: rootRef
      };
    }
    if (operation === 'console.read') {
      if (!exact(input, ['snapshot'])) return { code: 'operation-invalid' };
      const snapshot = projectConsoleSnapshot(input.snapshot, projectRecentMessages);
      return snapshot ? { input: Object.freeze({ snapshot }) } : { code: 'operation-invalid' };
    }
    return { code: 'operation-invalid' };
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
    if (job && job.scope === 'global') {
      const pageCurrent = Boolean(selection && selection.managed === true
        && selection.pageInstanceId === job.pageInstanceId
        && selection.selectionRevision === job.selectionRevision);
      if (!pageCurrent) return false;
      if (job.sessionRootRef === null) return true;
      if (!validBoundRawSession(selection.raw)) return false;
      let session = null;
      try { session = ctx.sessions?.get?.(selection.raw) || null; }
      catch (_error) { session = null; }
      return sessionRootRef(authToken, hostInstanceId, session?.header?.cwd)
        === job.sessionRootRef;
    }
    const record = job && recordsByRef.get(job.sessionRef);
    const envelope = record && record.effective;
    let session = null;
    try {
      session = record && ctx.sessions && typeof ctx.sessions.get === 'function'
        ? ctx.sessions.get(record.raw) : null;
    } catch (_error) { session = null; }
    const boundDeliveryTarget = Boolean(
      WORKSPACE_FILE_DELIVERY_OPERATIONS.has(job?.operation)
      && typeof record?.raw === 'string'
      && typeof job?.deliveryTargetRef === 'string'
      && DELIVERY_TARGET_REF_RE.test(job.deliveryTargetRef)
      && job.deliveryTargetRef === deliveryTargetRef(authToken, hostInstanceId, record.raw)
    );
    return Boolean(selection && selection.managed === true
      && selection.pageInstanceId === job.pageInstanceId
      && selection.selectionRevision === job.selectionRevision
      && selection.sessionRef === job.sessionRef
      && record && record.revoked !== true && envelope
      && envelope.revision === job.contextRevision
      && envelope.project.projectId === job.projectId
      && envelope.project.projectRevision === job.projectRevision
      && (sessionProjectId(session) === job.projectId || boundDeliveryTarget));
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
        if (job.sessionRootRef !== null && job.rootAuthorizationToken === null) {
          // root-bound 操作在最终 authorize 之前按协议不得执行任何
          // bind/touch/ACK/active 副作用，因此可精确报 workspace-mismatch。
          job.state = 'rejected';
          job.code = 'workspace-mismatch';
          job.result = null;
          job.claimToken = null;
          job.finishedAtMs = now;
        } else if (job.sessionRootRef === null) {
          // 旧 operation 或无 root proof 的 operation 保持原有不确定语义。
          job.state = 'rejected';
          job.code = 'outcome-unknown';
          job.result = null;
          job.claimToken = null;
          job.finishedAtMs = now;
        }
        // 已取得 root authorization 的任务以该快照为线性化点；
        // 留在 running 到 settle，settle 会再读当前根并降级为
        // outcome-unknown，绝不回 fulfilled。
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
        || (job.scope !== 'global' && selection.sessionRef !== job.sessionRef)
        || !workspaceFileContextCurrent(job)
        || !tokenMatches(payload.controllerProof, selection.controllerProof)) return null;
    return selection;
  };

  const requestWorkspaceFile = (payload) => {
    const selection = preferencePageSelection(payload, ['operation', 'input']);
    const operation = typeof payload?.operation === 'string' ? payload.operation : '';
    let input = selection && WORKSPACE_FILE_OPERATIONS.has(operation)
      ? safeWorkspaceOperationValue(operation, payload.input, 'input') : null;
    if (!selection || typeof payload.operation !== 'string'
        || !WORKSPACE_FILE_OPERATIONS.has(payload.operation) || !input) return bad();
    if (!takeEndpointBudget('workspace/files/request')) return bad();
    sweep();
    const globalProjectOperation = PROJECT_OPERATIONS.has(payload.operation);
    let currentBindingRef = null;
    let sessionRootRef = null;
    let record = null;
    let envelope = null;
    let deliveryOperation = false;
    if (globalProjectOperation) {
      const prepared = prepareProjectOperationInput(payload.operation, input, selection);
      if (!prepared.input) return ok({
        accepted: false, requestToken: null, state: 'rejected',
        code: prepared.code, deadlineMs: null
      });
      input = safeWorkspaceOperationValue(payload.operation, prepared.input, 'input');
      if (!input) return bad();
      currentBindingRef = typeof prepared.currentBindingRef === 'string'
        ? prepared.currentBindingRef : null;
      sessionRootRef = typeof prepared.sessionRootRef === 'string'
        ? prepared.sessionRootRef : null;
    } else {
      const resolved = resolveSelectionState(selection);
      record = resolved.state === 'selected'
        ? recordsByRef.get(selection.sessionRef) : null;
      envelope = record && record.effective;
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
      deliveryOperation = WORKSPACE_FILE_DELIVERY_OPERATIONS.has(payload.operation);
      if ((!selectedProjectId || selectedProjectId !== envelope.project.projectId)
          && !deliveryOperation) {
        return ok({
          accepted: false, requestToken: null, state: 'rejected',
          code: 'workspace-mismatch', deadlineMs: null
        });
      }
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
    const boundDeliveryTarget = deliveryOperation
      ? deliveryTargetRef(authToken, hostInstanceId, record.raw) : null;
    if (deliveryOperation && !DELIVERY_TARGET_REF_RE.test(boundDeliveryTarget)) return internal();
    const job = {
      requestToken,
      requestSeq,
      controllerId: selection.controllerId,
      pageInstanceId: selection.pageInstanceId,
      selectionRevision: selection.selectionRevision,
      scope: globalProjectOperation ? 'global' : 'workspace',
      sessionRef: globalProjectOperation ? null : selection.sessionRef,
      projectId: globalProjectOperation ? null : envelope.project.projectId,
      projectRevision: globalProjectOperation ? null : envelope.project.projectRevision,
      contextRevision: globalProjectOperation ? null : envelope.revision,
      operation: payload.operation,
      input,
      currentBindingRef,
      sessionRootRef,
      deliveryTargetRef: boundDeliveryTarget,
      issuedAtMs,
      deadlineMs,
      runningDeadlineMs: null,
      state: 'queued',
      code: null,
      result: null,
      claimToken: null,
      rootAuthorizationToken: null,
      rootAuthorizedAtMs: null,
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
    const queuedJobs = [...workspaceFileJobs.values()]
      .filter((job) => job.state === 'queued')
      .sort((left, right) => left.requestSeq - right.requestSeq)
      .slice(0, value.limit);
    const requests = [];
    const reply = () => ok({ contract: CONTRACT, hostInstanceId, requests });
    for (const job of queuedJobs) {
      const request = Object.freeze({
        requestToken: job.requestToken,
        requestSeq: job.requestSeq,
        controllerId: job.controllerId,
        pageInstanceId: job.pageInstanceId,
        selectionRevision: job.selectionRevision,
        ...(job.scope === 'workspace' ? {
          projectId: job.projectId,
          projectRevision: job.projectRevision,
          contextRevision: job.contextRevision
        } : {}),
        operation: job.operation,
        input: job.input,
        ...(job.currentBindingRef === null
          ? {} : { currentBindingRef: job.currentBindingRef }),
        ...(job.sessionRootRef === null
          ? {} : { sessionRootRef: job.sessionRootRef }),
        ...(job.deliveryTargetRef === null
          ? {} : { deliveryTargetRef: job.deliveryTargetRef }),
        issuedAtMs: job.issuedAtMs,
        deadlineMs: job.deadlineMs
      });
      requests.push(request);
      if (Buffer.byteLength(JSON.stringify(reply()), 'utf8')
          > MAX_WORKSPACE_FILE_READ_RESULT_BYTES) {
        requests.pop();
        break;
      }
    }
    return reply();
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

  const authorizeWorkspaceFileRoot = (payload) => {
    const value = withAuth(payload, [
      'contract', 'hostInstanceId', 'requestToken', 'requestSeq', 'claimToken'
    ]);
    if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
        || !TOKEN_RE.test(value.requestToken) || !TOKEN_RE.test(value.claimToken)
        || !Number.isSafeInteger(value.requestSeq) || value.requestSeq < 1) return bad();
    if (!takeEndpointBudget('workspace/files/authorize')) return bad();
    sweep();
    const job = workspaceFileJobs.get(value.requestToken);
    if (job && job.state === 'rejected' && job.code === 'workspace-mismatch') {
      return ok({ authorized: false, code: 'workspace-mismatch' });
    }
    if (!job || job.requestSeq !== value.requestSeq || job.state !== 'running'
        || job.sessionRootRef === null || job.rootAuthorizationToken !== null
        || !tokenMatches(value.claimToken, job.claimToken)
        || !workspaceFileContextCurrent(job)) {
      return ok({ authorized: false, code: 'operation-stale' });
    }
    const now = Date.now();
    const authorizationToken = sha256(
      `workspace-root-authorize\0${randomUUID()}\0${job.requestToken}\0${job.requestSeq}`
    );
    job.rootAuthorizationToken = authorizationToken;
    job.rootAuthorizedAtMs = now;
    return ok({ authorized: true, code: null, authorizationToken });
  };

  const settleWorkspaceFile = (payload) => {
    const value = withAuth(payload, [
      'contract', 'hostInstanceId', 'requestToken', 'requestSeq',
      'claimToken', 'status', 'code', 'result'
    ], ['rootAuthorizationToken']);
    if (!value || value.contract !== CONTRACT || value.hostInstanceId !== hostInstanceId
        || !TOKEN_RE.test(value.requestToken) || !TOKEN_RE.test(value.claimToken)
        || !Number.isSafeInteger(value.requestSeq) || value.requestSeq < 1
        || !['fulfilled', 'rejected'].includes(value.status)
        || (Object.prototype.hasOwnProperty.call(value, 'rootAuthorizationToken')
          && !TOKEN_RE.test(value.rootAuthorizationToken))) return bad();
    const job = workspaceFileJobs.get(value.requestToken);
    const result = value.status === 'fulfilled' && job
      ? safeWorkspaceOperationValue(job.operation, value.result, 'result') : null;
    if ((value.status === 'fulfilled' && (value.code !== null || !result))
        || (value.status === 'rejected'
          && (!WORKSPACE_FILE_REJECT_CODES.has(value.code) || value.result !== null))) return bad();
    if (!takeEndpointBudget('workspace/files/settle')) return bad();
    sweep();
    if (!job || job.requestSeq !== value.requestSeq || job.state !== 'running'
        || !tokenMatches(value.claimToken, job.claimToken)) {
      return ok({ settled: false, code: 'operation-stale' });
    }
    const rootBound = job.sessionRootRef !== null;
    const hasRootAuthorization = Object.prototype.hasOwnProperty.call(
      value, 'rootAuthorizationToken'
    );
    if (rootBound) {
      if (hasRootAuthorization
          ? (!job.rootAuthorizationToken
            || !tokenMatches(value.rootAuthorizationToken, job.rootAuthorizationToken))
          : value.status === 'fulfilled') return bad();
      if (hasRootAuthorization && (!Number.isSafeInteger(job.rootAuthorizedAtMs)
          || Date.now() - job.rootAuthorizedAtMs > WORKSPACE_FILE_ROOT_AUTHORIZATION_MS)) {
        job.state = 'rejected';
        job.code = 'outcome-unknown';
        job.result = null;
        job.claimToken = null;
        job.finishedAtMs = Date.now();
        return ok({ settled: false, code: 'outcome-unknown' });
      }
      // settle 必须再读 Host 当前 cwd。authorize 是 main 同步提交的
      // 线性化点；如果此后根又变化，无法撤回已授权的本地同步
      // 动作，但绝不对外声称 fulfilled。
      if (hasRootAuthorization && !workspaceFileContextCurrent(job)) {
        job.state = 'rejected';
        job.code = 'outcome-unknown';
        job.result = null;
        job.claimToken = null;
        job.finishedAtMs = Date.now();
        return ok({ settled: false, code: 'outcome-unknown' });
      }
    } else if (hasRootAuthorization) return bad();
    job.state = value.status;
    job.code = value.code;
    job.result = result;
    job.claimToken = null;
    job.rootAuthorizationToken = null;
    job.rootAuthorizedAtMs = null;
    job.finishedAtMs = Date.now();
    return ok({ settled: true, code: null });
  };

  const bootstrapProjectSession = async (payload) => {
    const selection = preferencePageSelection(payload, [
      'projectId', 'openToken', 'bootstrapTicket'
    ]);
    if (!selection || !APP_PROJECT_ID_RE.test(String(payload.projectId || ''))
        || !PROJECT_OPEN_TOKEN_RE.test(String(payload.openToken || ''))
        || typeof payload.bootstrapTicket !== 'string'
        || !PROJECT_BOOTSTRAP_TICKET_RE.test(payload.bootstrapTicket)
        || Buffer.byteLength(payload.bootstrapTicket, 'utf8')
          > MAX_PROJECT_BOOTSTRAP_TICKET_BYTES) return bad();
    const now = Date.now();
    for (const [nonce, record] of projectBootstrapReplays) {
      if (record.expiresAtMs <= now) projectBootstrapReplays.delete(nonce);
    }
    const ticket = openProjectBootstrapTicket(authToken, hostInstanceId,
      payload.bootstrapTicket, {
        controllerId: payload.controllerId,
        pageInstanceId: payload.pageInstanceId,
        selectionRevision: payload.selectionRevision,
        projectId: payload.projectId,
        openToken: payload.openToken
      }, now);
    if (!ticket) {
      return ok({ bootstrapped: false, bindingRef: null, code: 'operation-stale' });
    }
    const ticketDigest = sha256(payload.bootstrapTicket);
    const currentOwner = (selfSelectedRoot = null) => {
      const current = controllers.get(payload.controllerId);
      if (!current || current.managed !== true
          || current.pageInstanceId !== payload.pageInstanceId
          || !tokenMatches(payload.controllerProof, current.controllerProof)
          || Date.now() >= ticket.expiresAtMs) return false;
      const exactRevision = current.selectionRevision === payload.selectionRevision;
      const selfSelectedRevision = selfSelectedRoot !== null
        && current.selectionRevision === payload.selectionRevision + 1;
      if (!exactRevision && !selfSelectedRevision) return false;
      const resolved = resolveSelectionState(current);
      if (exactRevision) return resolved.state === 'none' || resolved.state === 'selected';
      // workspace.create 会触发 rc.2 官方前端的首选逻辑：它可能立即
      // 创建并选中一个同根空白会话，从而让本页 revision 精确自增一次。这种
      // 自触发前进不应把本次 ticket 误判为并发篡改；但只有当当前
      // 唯一 owner 仍是同页/同 proof，且 live 顶层会话仍精确属于目标
      // 规范根时才放行。none、异根、子代理、跨页或 revision 回退仍拒绝。
      if (resolved.state !== 'selected' || !validBoundRawSession(current.raw)) return false;
      let selected = null;
      try { selected = ctx.sessions?.get?.(current.raw) || null; }
      catch (_error) { selected = null; }
      return Boolean(selected && selected.header?.id === current.raw
        && selected.header?.origin !== 'subagent'
        && selected.header?.parentSession === undefined
        && canonicalSessionRoot(selected.header?.cwd) === selfSelectedRoot);
    };
    if (!currentOwner()) {
      return ok({ bootstrapped: false, bindingRef: null, code: 'operation-stale' });
    }
    const replay = projectBootstrapReplays.get(ticket.nonce);
    if (replay) {
      if (replay.ticketDigest !== ticketDigest) {
        return ok({ bootstrapped: false, bindingRef: null, code: 'operation-stale' });
      }
      return replay.promise;
    }
    if (!takeEndpointBudget('projects/session/bootstrap')) return bad();
    if (projectBootstrapReplays.size >= MAX_PROJECT_BOOTSTRAP_REPLAYS) {
      return ok({ bootstrapped: false, bindingRef: null, code: 'busy' });
    }
    const operation = (async () => {
      const root = canonicalSessionRoot(ticket.root);
      if (root === null || !ctx.apiProxy || !ctx.apiProxy.workspace
          || typeof ctx.apiProxy.workspace.create !== 'function'
          || typeof ctx.apiProxy.workspace.list !== 'function'
          || !ctx.apiProxy.sessions || typeof ctx.apiProxy.sessions.create !== 'function'
          || typeof ctx.apiProxy.sessions.list !== 'function') {
        return ok({ bootstrapped: false, bindingRef: null, code: 'workspace-unavailable' });
      }
      let sideEffectPossible = false;
      try {
        // workspace.create 是第一个外部持久副作用；自调用开始起，
        // 任何抛错、丢包或 owner 漂移都只能回 outcome-unknown，
        // 不得伪装成完全没有副作用的 stale/unavailable。
        sideEffectPossible = true;
        const workspaceReply = await ctx.apiProxy.workspace.create({
          rpcId: randomUUID(), payload: { path: root }
        });
        if (!currentOwner(root)) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        if (workspaceReply?.result?.ok !== true) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        const workspaceValue = workspaceReply.result.value;
        const workspace = workspaceValue?.workspace;
        if (!workspace || typeof workspace.workspaceId !== 'string'
            || workspace.workspaceId.length < 1 || workspace.workspaceId.length > 256
            || CONTROL_RE.test(workspace.workspaceId)) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        if (canonicalSessionRoot(workspace.path) !== root) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'workspace-mismatch' });
        }
        // raw id 由注册表 projectId 唯一派生，而不是由每次 ticket 派生。
        // 即使首次 session.create 成功后回包丢失，新 prepare 也只会
        // ensure 同一个 raw id，不会无界生成孤儿会话。
        const rawSessionId = `${PROJECT_BOOTSTRAP_SESSION_PREFIX}${ticket.projectId.slice(5)}`;
        // 上一次成功 birth 后若 Host→Client 回包丢失，新 prepare 会带新
        // ticket。先复用同一官方 workspace 中仍为空、未归档、已 attach 且
        // cwd 精确一致的会话，避免每次重试盲建一条。
        const [sessionListReply, workspaceListReply] = await Promise.all([
          ctx.apiProxy.sessions.list({ rpcId: randomUUID(), payload: {} }),
          ctx.apiProxy.workspace.list({ rpcId: randomUUID(), payload: {} })
        ]);
        if (!currentOwner(root)) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        if (sessionListReply?.result?.ok !== true
            || !Array.isArray(sessionListReply.result.value?.items)
            || sessionListReply.result.value.items.length > MAX_PROJECT_CONSOLE_SESSIONS
            || workspaceListReply?.result?.ok !== true
            || !Array.isArray(workspaceListReply.result.value?.items)
            || workspaceListReply.result.value.items.length > MAX_PROJECT_CONSOLE_SESSIONS
            || !Array.isArray(workspaceListReply.result.value?.archivedSessionIds)
            || workspaceListReply.result.value.archivedSessionIds.length
              > MAX_PROJECT_CONSOLE_SESSIONS) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        const sessionRows = sessionListReply.result.value.items;
        const workspaceRows = workspaceListReply.result.value.items;
        const archived = new Set(workspaceListReply.result.value.archivedSessionIds);
        const listedWorkspace = workspaceRows.find((item) => (
          item?.workspaceId === workspace.workspaceId
          && canonicalSessionRoot(item.path) === root
        ));
        if (!listedWorkspace || !Array.isArray(listedWorkspace.sessionIds)
            || listedWorkspace.sessionIds.length > MAX_PROJECT_CONSOLE_SESSIONS
            || listedWorkspace.sessionIds.some((id) => !validBoundRawSession(id))) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        const accounted = new Set(listedWorkspace.sessionIds);
        const reusableSession = (item) => {
          if (!item || item.blank !== true || item.origin === 'subagent'
              || item.parentSessionId !== undefined
              || !validBoundRawSession(item.sessionId)
              || !accounted.has(item.sessionId) || archived.has(item.sessionId)
              || canonicalSessionRoot(item.cwd) !== root) return false;
          let live = null;
          try { live = ctx.sessions?.get?.(item.sessionId) || null; }
          catch (_error) { live = null; }
          return Boolean(live && live.header?.id === item.sessionId
            && live.header?.origin !== 'subagent'
            && live.header?.parentSession === undefined
            && canonicalSessionRoot(live.header?.cwd) === root);
        };
        // 预定 stable id 不是所有权证明。只要官方 roster 或 live
        // store 中已有同 id，必须同时证明它为空、非子代理、未归档、
        // attach 到本次精确 workspace，并且 live cwd/id 一致。不允许
        // 单凭 ctx.sessions.get(id) 绕过这些证明。
        let stableLive = null;
        try { stableLive = ctx.sessions?.get?.(rawSessionId) || null; }
        catch (_error) { stableLive = null; }
        const stableRows = sessionRows.filter((item) => item?.sessionId === rawSessionId);
        const stableAttachedElsewhere = workspaceRows.some((item) => (
          item?.workspaceId !== workspace.workspaceId
          && Array.isArray(item?.sessionIds)
          && item.sessionIds.includes(rawSessionId)
        ));
        const stableOccupied = stableRows.length > 0 || accounted.has(rawSessionId)
          || archived.has(rawSessionId) || stableAttachedElsewhere || stableLive !== null;
        if (stableOccupied) {
          if (stableRows.length === 1 && !stableAttachedElsewhere
              && reusableSession(stableRows[0])) {
            return ok({
              bootstrapped: true,
              bindingRef: sessionBindingRef(rawSessionId),
              code: null
            });
          }
          return ok({ bootstrapped: false, bindingRef: null, code: 'workspace-mismatch' });
        }
        const reusable = sessionRows.find(reusableSession);
        if (reusable) {
          return ok({
            bootstrapped: true,
            bindingRef: sessionBindingRef(reusable.sessionId),
            code: null
          });
        }
        let sessionReply = null;
        try {
          sessionReply = await ctx.apiProxy.sessions.create({
            rpcId: randomUUID(),
            payload: { workspaceId: workspace.workspaceId, sessionId: rawSessionId }
          });
        } catch (_error) {
          // 回包丢失后不能只凭 live id/cwd 猜测它是本次创建。
          // 保留 outcome-unknown，下一张 ticket 再通过完整官方 roster
          // 证明 blank/origin/archive/workspace attach 后复用。
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        if (!currentOwner(root)) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        const sessionValue = sessionReply?.result?.ok === true
          ? sessionReply.result.value : null;
        if (!sessionValue || sessionValue.sessionId !== rawSessionId) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'outcome-unknown' });
        }
        let session = null;
        try { session = ctx.sessions?.get?.(rawSessionId) || null; }
        catch (_error) { session = null; }
        if (!session || session.header?.id !== rawSessionId
            || canonicalSessionRoot(session.header?.cwd) !== root) {
          return ok({ bootstrapped: false, bindingRef: null, code: 'workspace-mismatch' });
        }
        return ok({
          bootstrapped: true,
          bindingRef: sessionBindingRef(rawSessionId),
          code: null
        });
      } catch (_error) {
        return ok({
          bootstrapped: false,
          bindingRef: null,
          code: sideEffectPossible ? 'outcome-unknown' : 'workspace-unavailable'
        });
      }
    })();
    projectBootstrapReplays.set(ticket.nonce, Object.freeze({
      ticketDigest,
      expiresAtMs: ticket.expiresAtMs,
      promise: operation
    }));
    const result = await operation;
    if (result?.ok !== true || (result.value?.bootstrapped !== true
        && result.value?.code !== 'outcome-unknown')) {
      projectBootstrapReplays.delete(ticket.nonce);
    }
    return result;
  };

  const resolveProjectSession = (payload) => {
    const selection = preferencePageSelection(payload, ['bindingRef', 'candidateSessionIds']);
    if (!selection || typeof payload.bindingRef !== 'string'
        || !SESSION_BINDING_REF_RE.test(payload.bindingRef)
        || !Array.isArray(payload.candidateSessionIds)
        || payload.candidateSessionIds.length > MAX_PROJECT_CONSOLE_SESSIONS
        || payload.candidateSessionIds.some((id) => !validBoundRawSession(id))
        || new Set(payload.candidateSessionIds).size !== payload.candidateSessionIds.length) {
      return bad();
    }
    if (!takeEndpointBudget('projects/session/resolve')) return bad();
    let liveSessions;
    try {
      liveSessions = ctx.sessions && typeof ctx.sessions.list === 'function'
        ? ctx.sessions.list() : null;
    } catch (_error) { liveSessions = null; }
    if (!Array.isArray(liveSessions)) {
      return ok({ resolved: false, candidateIndex: null, code: 'workspace-unavailable' });
    }
    const candidates = new Map(payload.candidateSessionIds.map((id, index) => [id, index]));
    for (const session of liveSessions) {
      const raw = session && session.header && session.header.id;
      const candidateIndex = candidates.get(raw);
      if (candidateIndex !== undefined && sessionBindingRef(raw) === payload.bindingRef) {
        return ok({ resolved: true, candidateIndex, code: null });
      }
    }
    return ok({ resolved: false, candidateIndex: null, code: 'workspace-unavailable' });
  };

  const validPreflightAuth = (payload) => exact(payload, [
    'contract', 'controllerId', 'pageInstanceId', 'selectionRevision',
    'currentSessionId', 'mode', 'managed', 'selectionToken'
  ]) && tokenMatches(payload.selectionToken, selectionToken);

  const stageContext = (payload) => {
    const value = withAuth(payload, [
      'controllerId', 'pageInstanceId', 'selectionRevision', 'envelope'
    ], ['currentBindingRef', 'sessionRootRef']);
    const hasBindingProof = Boolean(value && Object.prototype.hasOwnProperty.call(
      value, 'currentBindingRef'
    ));
    const hasRootProof = Boolean(value && Object.prototype.hasOwnProperty.call(
      value, 'sessionRootRef'
    ));
    if (!value || !validId(value.controllerId) || !validId(value.pageInstanceId)
        || !Number.isSafeInteger(value.selectionRevision) || value.selectionRevision < 1
        || !validEnvelope(value.envelope, hostInstanceId)
        || hasBindingProof !== hasRootProof
        || (hasBindingProof && (!SESSION_BINDING_REF_RE.test(value.currentBindingRef)
          || !SESSION_ROOT_REF_RE.test(value.sessionRootRef)))) return bad();
    const selection = controllers.get(value.controllerId);
    const resolved = resolveSelectionState(selection);
    if (!selection || selection.managed !== true || resolved.state !== 'selected'
        || selection.pageInstanceId !== value.pageInstanceId
        || selection.selectionRevision !== value.selectionRevision
        || selection.sessionRef !== value.envelope.sessionRef) {
      return ok({ accepted: false, code: 'session-unavailable' });
    }
    if (hasBindingProof) {
      let session = null;
      try { session = ctx.sessions?.get?.(selection.raw) || null; }
      catch (_error) { session = null; }
      const actualBindingRef = validBoundRawSession(selection.raw)
        ? sessionBindingRef(selection.raw) : null;
      const actualRootRef = sessionRootRef(
        authToken, hostInstanceId, session?.header?.cwd
      );
      // registry 项目模式必须在真正 stage 的这一刻重算 selection/cwd；
      // resolve 时的 proof 只用于 main 决策，不能跨越此处的竞态窗口。
      if (actualBindingRef !== value.currentBindingRef
          || actualRootRef !== value.sessionRootRef) {
        return ok({ accepted: false, code: 'session-unavailable' });
      }
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
        let currentBindingRef = null;
        let currentRootRef = null;
        if (current.state === 'selected' && validBoundRawSession(selection.raw)) {
          let session = null;
          try { session = ctx.sessions?.get?.(selection.raw) || null; }
          catch (_error) { session = null; }
          currentBindingRef = sessionBindingRef(selection.raw);
          currentRootRef = sessionRootRef(
            authToken, hostInstanceId, session?.header?.cwd
          );
          if (!SESSION_BINDING_REF_RE.test(currentBindingRef)
              || !SESSION_ROOT_REF_RE.test(String(currentRootRef || ''))) {
            // 经典模式仍允许没有 canonical cwd 的 selection；它不携带
            // registry proof。main 若有 active registry project 会因 proof
            // 缺失自动关闭，绝不借这个兼容分支继续 stage。
            currentBindingRef = null;
            currentRootRef = null;
          }
        }
        const boundDeliveryTarget = current.state === 'selected'
          && typeof selection.raw === 'string'
          ? deliveryTargetRef(authToken, hostInstanceId, selection.raw) : null;
        return ok({
          ...current,
          hostInstanceId,
          controllerId: selection.controllerId,
          pageInstanceId: selection.pageInstanceId,
          selectionRevision: selection.selectionRevision,
          ...(currentBindingRef === null ? {} : {
            currentBindingRef,
            sessionRootRef: currentRootRef
          }),
          ...(boundDeliveryTarget === null
            ? {} : { deliveryTargetRef: boundDeliveryTarget })
        });
      }
      if (endpoint === 'context/stage') {
        if (!withAuth(payload, [
          'controllerId', 'pageInstanceId', 'selectionRevision', 'envelope'
        ], ['currentBindingRef', 'sessionRootRef'])) return bad();
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
      if (endpoint === 'terminal.open') return openProjectTerminal(payload);
      if (endpoint === 'terminal.read') return readProjectTerminal(payload);
      if (endpoint === 'terminal.write') return writeProjectTerminal(payload);
      if (endpoint === 'terminal.signal') return signalProjectTerminal(payload);
      if (endpoint === 'terminal.close') return closeProjectTerminal(payload);
      if (endpoint === 'projects/session/bootstrap') return bootstrapProjectSession(payload);
      if (endpoint === 'projects/session/resolve') return resolveProjectSession(payload);
      if (endpoint === 'workspace/files/request') return requestWorkspaceFile(payload);
      if (endpoint === 'workspace/files/status') return statusWorkspaceFile(payload);
      if (endpoint === 'workspace/files/cancel') return cancelWorkspaceFile(payload);
      if (endpoint === 'workspace/files/read') return readWorkspaceFiles(payload);
      if (endpoint === 'workspace/files/claim') return claimWorkspaceFile(payload);
      if (endpoint === 'workspace/files/authorize') return authorizeWorkspaceFileRoot(payload);
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

  ctx.on('session/disposed', (session) => {
    const raw = typeof session?.id === 'string' ? session.id : null;
    if (raw === null) return;
    projectRecentMessages.delete(raw);
    revokeTerminalsWhere((entry) => entry.raw === raw && entry.session === session);
  });

  ctx.on('agent/disposed', ({ agent } = {}) => {
    if (!agent || typeof agent.id !== 'string') return;
    revokeTerminalsWhere((entry) => entry.raw === agent.id && entry.owner === agent);
  });

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => async () => {
      projectTerminalDisposed = true;
      const allocations = [...projectTerminalAllocations];
      for (const allocation of allocations) allocation.abort.abort();
      await Promise.allSettled(allocations.map((allocation) => allocation.finished));
      await Promise.allSettled([...projectTerminals.values()].map(closeTerminalEntry));
    }, 'whaledock project terminal teardown');
  }

  ctx.on('session/event', (session, event) => {
    sweep();
    const rawSessionId = String(session.id);
    const recent = redactedRecentMessage(event);
    if (recent) {
      projectRecentMessages.delete(rawSessionId);
      while (projectRecentMessages.size >= MAX_PROJECT_CONSOLE_SESSIONS) {
        projectRecentMessages.delete(projectRecentMessages.keys().next().value);
      }
      projectRecentMessages.set(rawSessionId, recent);
    }
    const record = recordsByRaw.get(rawSessionId);
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
