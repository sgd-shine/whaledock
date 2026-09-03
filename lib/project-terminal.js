'use strict';

// 批次 5 终端窗格的纯 Node 安全合同。本模块不负责文件系统
// 授权或 PTY 生命周期；main/Host 只能在项目根已完成 realpath 和
// identity 复核后，把受信 cwd 交给 plan.launch()。页面请求始终不带路径。

const crypto = require('crypto');
const path = require('path');

const LIMITS = Object.freeze({
  maxSessionBytes: 512 * 1024,
  maxOutputChunkBytes: 1024 * 1024,
  maxReadBytes: 32 * 1024,
  minReadBytes: 4,
  maxInputBytes: 8 * 1024,
  minCols: 20,
  maxCols: 300,
  minRows: 5,
  maxRows: 120,
  maxWaitMs: 15 * 1000,
  maxPathBytes: 4096,
  maxPathValueBytes: 8192,
  maxPaneRefChars: 128
});

const ERROR_CODES = Object.freeze({
  request: 'ERR_PROJECT_TERMINAL_REQUEST',
  input: 'ERR_PROJECT_TERMINAL_INPUT',
  output: 'ERR_PROJECT_TERMINAL_OUTPUT',
  dimensions: 'ERR_PROJECT_TERMINAL_DIMENSIONS',
  signal: 'ERR_PROJECT_TERMINAL_SIGNAL',
  authority: 'ERR_PROJECT_TERMINAL_AUTHORITY',
  plan: 'ERR_PROJECT_TERMINAL_PLAN',
  state: 'ERR_PROJECT_TERMINAL_STATE'
});

const PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
const ROOT_REF_RE = /^session-root-[a-f0-9]{64}$/;
const TERMINAL_REF_RE = /^terminal-[a-f0-9]{32}$/;
const CAPABILITY_RE = /^[a-f0-9]{64}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PANE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const INPUT_FORBIDDEN_RE = /[\u0000-\u0007\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

const POSIX_ENV_ORDER = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'SHELL', 'HISTFILE'
]);
const WINDOWS_ENV_ORDER = Object.freeze([
  'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC',
  'PATHEXT', 'TERM', 'COLORTERM', 'POWERSHELL_TELEMETRY_OPTOUT', 'POWERSHELL_UPDATECHECK'
]);

function terminalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function safeInteger(value, minimum, maximum, code, message) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw terminalError(code, message);
  }
  return value;
}

function safeIdentifier(value, pattern, code, message) {
  if (typeof value !== 'string' || !pattern.test(value)) throw terminalError(code, message);
  return value;
}

function validateDimensions(cols, rows) {
  return Object.freeze({
    cols: safeInteger(cols, LIMITS.minCols, LIMITS.maxCols,
      ERROR_CODES.dimensions, '终端列数超出安全范围'),
    rows: safeInteger(rows, LIMITS.minRows, LIMITS.maxRows,
      ERROR_CODES.dimensions, '终端行数超出安全范围')
  });
}

function validateOpenRequest(value) {
  if (!exactKeys(value, ['projectId', 'paneRef', 'cols', 'rows'])) {
    throw terminalError(ERROR_CODES.request, '终端打开请求字段无效');
  }
  const dimensions = validateDimensions(value.cols, value.rows);
  return Object.freeze({
    projectId: safeIdentifier(value.projectId, PROJECT_ID_RE,
      ERROR_CODES.request, '终端项目身份无效'),
    paneRef: safeIdentifier(value.paneRef, PANE_REF_RE,
      ERROR_CODES.request, '终端窗格身份无效'),
    cols: dimensions.cols,
    rows: dimensions.rows
  });
}

function validateTerminalCredentials(value, extraRequired = [], extraOptional = []) {
  const required = ['terminalRef', 'capability', ...extraRequired];
  if (!exactKeys(value, required, extraOptional)) {
    throw terminalError(ERROR_CODES.request, '终端请求字段无效');
  }
  return {
    terminalRef: safeIdentifier(value.terminalRef, TERMINAL_REF_RE,
      ERROR_CODES.request, '终端会话身份无效'),
    capability: safeIdentifier(value.capability, CAPABILITY_RE,
      ERROR_CODES.request, '终端能力身份无效')
  };
}

function validateWriteRequest(value) {
  const credentials = validateTerminalCredentials(value, ['data']);
  if (typeof value.data !== 'string' || value.data.length === 0
      || Buffer.byteLength(value.data, 'utf8') > LIMITS.maxInputBytes
      || INPUT_FORBIDDEN_RE.test(value.data)) {
    throw terminalError(ERROR_CODES.input, '终端输入无效或超出安全上限');
  }
  return Object.freeze({ ...credentials, data: value.data });
}

function validateReadRequest(value) {
  const credentials = validateTerminalCredentials(value,
    ['afterSeq', 'maxBytes'], ['waitMs']);
  const afterSeq = safeInteger(value.afterSeq, 0, Number.MAX_SAFE_INTEGER,
    ERROR_CODES.output, '终端输出序号无效');
  const maxBytes = safeInteger(value.maxBytes, LIMITS.minReadBytes, LIMITS.maxReadBytes,
    ERROR_CODES.output, '终端输出页大小无效');
  const waitMs = value.waitMs === undefined ? 0 : safeInteger(value.waitMs, 0, LIMITS.maxWaitMs,
    ERROR_CODES.output, '终端输出等待时间无效');
  return Object.freeze({ ...credentials, afterSeq, maxBytes, waitMs });
}

function validateResizeRequest(value) {
  const credentials = validateTerminalCredentials(value, ['cols', 'rows']);
  const dimensions = validateDimensions(value.cols, value.rows);
  return Object.freeze({ ...credentials, ...dimensions });
}

function validateSignalRequest(value) {
  const credentials = validateTerminalCredentials(value, ['signal']);
  if (value.signal !== 'SIGINT') {
    throw terminalError(ERROR_CODES.signal, '终端首版只允许 SIGINT');
  }
  return Object.freeze({ ...credentials, signal: 'SIGINT' });
}

function validateCloseRequest(value) {
  return Object.freeze(validateTerminalCredentials(value));
}

function validateAuthority(value) {
  const fields = [
    'projectId', 'paneRef', 'rootRef', 'hostInstanceId', 'controllerId',
    'pageInstanceId', 'selectionRevision', 'backendGeneration'
  ];
  if (!exactKeys(value, fields)) {
    throw terminalError(ERROR_CODES.authority, '终端权限上下文无效');
  }
  return Object.freeze({
    projectId: safeIdentifier(value.projectId, PROJECT_ID_RE,
      ERROR_CODES.authority, '终端权限上下文无效'),
    paneRef: safeIdentifier(value.paneRef, PANE_REF_RE,
      ERROR_CODES.authority, '终端权限上下文无效'),
    rootRef: safeIdentifier(value.rootRef, ROOT_REF_RE,
      ERROR_CODES.authority, '终端权限上下文无效'),
    hostInstanceId: safeIdentifier(value.hostInstanceId, OPAQUE_ID_RE,
      ERROR_CODES.authority, '终端权限上下文无效'),
    controllerId: safeIdentifier(value.controllerId, OPAQUE_ID_RE,
      ERROR_CODES.authority, '终端权限上下文无效'),
    pageInstanceId: safeIdentifier(value.pageInstanceId, OPAQUE_ID_RE,
      ERROR_CODES.authority, '终端权限上下文无效'),
    selectionRevision: safeInteger(value.selectionRevision, 0, Number.MAX_SAFE_INTEGER,
      ERROR_CODES.authority, '终端权限上下文无效'),
    backendGeneration: safeInteger(value.backendGeneration, 0, Number.MAX_SAFE_INTEGER,
      ERROR_CODES.authority, '终端权限上下文无效')
  });
}

function randomHex(bytes, randomBytes) {
  let value;
  try { value = randomBytes(bytes); }
  catch (_error) { throw terminalError(ERROR_CODES.state, '终端随机源不可用'); }
  if (!Buffer.isBuffer(value) || value.length !== bytes) {
    throw terminalError(ERROR_CODES.state, '终端随机源返回无效');
  }
  return value.toString('hex');
}

function createTerminalBinding(authority, options = {}) {
  if (!exactKeys(options, [], ['randomBytes'])) {
    throw terminalError(ERROR_CODES.state, '终端绑定选项无效');
  }
  const randomBytes = options.randomBytes || crypto.randomBytes;
  if (typeof randomBytes !== 'function') {
    throw terminalError(ERROR_CODES.state, '终端随机源无效');
  }
  return Object.freeze({
    terminalRef: `terminal-${randomHex(16, randomBytes)}`,
    capability: randomHex(32, randomBytes),
    authority: validateAuthority(authority)
  });
}

function publicTerminalBinding(record) {
  if (!isPlainObject(record) || !TERMINAL_REF_RE.test(record.terminalRef || '')
      || !CAPABILITY_RE.test(record.capability || '')) {
    throw terminalError(ERROR_CODES.state, '终端绑定记录无效');
  }
  return Object.freeze({ terminalRef: record.terminalRef, capability: record.capability });
}

function timingSafeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function assertTerminalBinding(record, request, currentAuthority) {
  let current;
  try { current = validateAuthority(currentAuthority); }
  catch (_error) { throw terminalError(ERROR_CODES.authority, '终端权限已失效'); }
  if (!isPlainObject(record) || !isPlainObject(record.authority)
      || !isPlainObject(request)
      || !timingSafeStringEqual(record.terminalRef, request.terminalRef)
      || !timingSafeStringEqual(record.capability, request.capability)) {
    throw terminalError(ERROR_CODES.authority, '终端权限已失效');
  }
  const bound = record.authority;
  for (const key of Object.keys(current)) {
    if (bound[key] !== current[key]) {
      throw terminalError(ERROR_CODES.authority, '终端权限已失效');
    }
  }
  return true;
}

class TerminalSanitizer {
  constructor() {
    this.state = 'text';
    this.pendingCr = false;
    this.finished = false;
  }

  write(value) {
    if (this.finished) throw terminalError(ERROR_CODES.state, '终端输出清洗器已结束');
    if (typeof value !== 'string') {
      throw terminalError(ERROR_CODES.output, '终端输出必须是文本');
    }
    let output = '';
    const appendText = (character) => {
      if (this.pendingCr) {
        output += '\n';
        this.pendingCr = false;
        if (character === '\n') return;
      }
      if (character === '\r') { this.pendingCr = true; return; }
      if (character === '\n' || character === '\t') { output += character; return; }
      const code = character.charCodeAt(0);
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)
          || BIDI_CONTROL_RE.test(character)) return;
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
        appendText(character);
        continue;
      }
      if (this.state === 'escape') {
        if (character === '[') this.state = 'csi';
        else if ([']', 'P', 'X', '^', '_'].includes(character)) this.state = 'control-string';
        else if (code === 0x1b) this.state = 'escape';
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

function sanitizeTerminalText(value) {
  const instance = new TerminalSanitizer();
  return instance.write(value) + instance.finish();
}

function continuationByte(value) {
  return (value & 0xc0) === 0x80;
}

function utf8Prefix(buffer, maximum) {
  if (buffer.length <= maximum) return buffer;
  let end = maximum;
  while (end > 0 && continuationByte(buffer[end])) end -= 1;
  return buffer.subarray(0, end);
}

const RING_STATE = new WeakMap();

function ringState(instance) {
  const state = RING_STATE.get(instance);
  if (!state) throw terminalError(ERROR_CODES.state, '终端输出缓冲状态无效');
  return state;
}

function appendClean(instance, value) {
  const state = ringState(instance);
  const bytes = Buffer.from(value, 'utf8');
  const acceptedBytes = bytes.length;
  state.end += acceptedBytes;
  if (acceptedBytes > 0) {
    state.chunks.push(bytes);
    state.retained += acceptedBytes;
  }
  while (state.retained > state.maxBytes && state.chunks.length > 0) {
    const excess = state.retained - state.maxBytes;
    const first = state.chunks[0];
    if (first.length <= excess) {
      state.chunks.shift();
      state.retained -= first.length;
      state.start += first.length;
      state.lost = true;
      continue;
    }
    let cut = excess;
    while (cut < first.length && continuationByte(first[cut])) cut += 1;
    state.chunks[0] = first.subarray(cut);
    state.retained -= cut;
    state.start += cut;
    state.lost = true;
  }
  return Object.freeze({
    acceptedBytes,
    retainedBytes: state.retained,
    nextSeq: state.end,
    truncated: state.lost
  });
}

class Utf8RingBuffer {
  constructor(options = {}) {
    if (!exactKeys(options, [], ['maxBytes'])) {
      throw terminalError(ERROR_CODES.output, '终端输出缓冲选项无效');
    }
    const maxBytes = options.maxBytes === undefined ? LIMITS.maxSessionBytes
      : safeInteger(options.maxBytes, LIMITS.minReadBytes, LIMITS.maxSessionBytes,
        ERROR_CODES.output, '终端输出缓冲上限无效');
    RING_STATE.set(this, {
      maxBytes,
      chunks: [],
      retained: 0,
      start: 0,
      end: 0,
      lost: false,
      closed: false,
      cleaner: new TerminalSanitizer()
    });
  }

  get retainedBytes() { return ringState(this).retained; }
  get startSeq() { return ringState(this).start; }
  get endSeq() { return ringState(this).end; }
  get truncated() { return ringState(this).lost; }

  append(value) {
    const state = ringState(this);
    if (state.closed) throw terminalError(ERROR_CODES.state, '终端输出缓冲已关闭');
    if (typeof value !== 'string'
        || Buffer.byteLength(value, 'utf8') > LIMITS.maxOutputChunkBytes) {
      throw terminalError(ERROR_CODES.output, '终端输出分块无效或超出安全上限');
    }
    return appendClean(this, state.cleaner.write(value));
  }

  finish() {
    const state = ringState(this);
    if (state.closed) return Object.freeze({
      retainedBytes: state.retained, nextSeq: state.end, truncated: state.lost
    });
    const tail = state.cleaner.finish();
    const result = appendClean(this, tail);
    state.closed = true;
    return result;
  }

  page(request) {
    const state = ringState(this);
    if (!exactKeys(request, ['afterSeq', 'maxBytes'])) {
      throw terminalError(ERROR_CODES.output, '终端输出页请求无效');
    }
    const afterSeq = safeInteger(request.afterSeq, 0, Number.MAX_SAFE_INTEGER,
      ERROR_CODES.output, '终端输出序号无效');
    const maxBytes = safeInteger(request.maxBytes, LIMITS.minReadBytes, LIMITS.maxReadBytes,
      ERROR_CODES.output, '终端输出页大小无效');
    if (afterSeq > state.end) {
      throw terminalError(ERROR_CODES.output, '终端输出序号超过当前边界');
    }
    const retained = state.chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(state.chunks);
    let offset = Math.max(afterSeq, state.start) - state.start;
    while (offset < retained.length && continuationByte(retained[offset])) offset += 1;
    const fromSeq = state.start + offset;
    const selected = utf8Prefix(retained.subarray(offset), maxBytes);
    const nextSeq = fromSeq + selected.length;
    return Object.freeze({
      contentType: 'text/plain',
      renderMode: 'text-only',
      text: selected.toString('utf8'),
      fromSeq,
      nextSeq,
      endSeq: state.end,
      retainedBytes: state.retained,
      truncated: afterSeq < state.start,
      hasMore: nextSeq < state.end
    });
  }
}

function safePath(value, platform, field) {
  const tools = platform === 'win32' ? path.win32 : path.posix;
  if (typeof value !== 'string' || !value || CONTROL_RE.test(value)
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxPathBytes
      || !tools.isAbsolute(value)) {
    throw terminalError(ERROR_CODES.plan, `${field} 无效`);
  }
  return value;
}

function safePathValue(value, fallback) {
  const selected = value === undefined ? fallback : value;
  if (typeof selected !== 'string' || !selected || CONTROL_RE.test(selected)
      || Buffer.byteLength(selected, 'utf8') > LIMITS.maxPathValueBytes) {
    throw terminalError(ERROR_CODES.plan, '终端 PATH 无效');
  }
  return selected;
}

function posixLaunch(input) {
  if (!exactKeys(input, ['platform', 'cwd', 'tempHome', 'tempDir'], ['pathValue'])) {
    throw terminalError(ERROR_CODES.plan, 'POSIX 终端启动计划字段无效');
  }
  const cwd = safePath(input.cwd, input.platform, 'POSIX cwd');
  const tempHome = safePath(input.tempHome, input.platform, 'POSIX 临时 HOME');
  const tempDir = safePath(input.tempDir, input.platform, 'POSIX 临时目录');
  const environment = Object.freeze({
    PATH: safePathValue(input.pathValue, '/usr/bin:/bin:/usr/sbin:/sbin'),
    HOME: tempHome,
    TMPDIR: tempDir,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    SHELL: '/bin/bash',
    HISTFILE: '/dev/null'
  });
  const assignments = POSIX_ENV_ORDER.map((key) => `${key}=${environment[key]}`);
  return Object.freeze({
    platform: input.platform,
    file: '/usr/bin/env',
    args: Object.freeze([
      '-i', ...assignments, '/bin/bash', '--noprofile', '--norc', '-i'
    ]),
    cwd,
    env: environment
  });
}

function windowsBootstrapScript() {
  const names = WINDOWS_ENV_ORDER.map((name) => `'${name.replaceAll("'", "''")}'`).join(',');
  return [
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
    'Remove-Variable wdName, wdNames, wdValue, wdValues -ErrorAction SilentlyContinue'
  ].join('\r\n');
}

function windowsLaunch(input) {
  if (!exactKeys(input, ['platform', 'cwd', 'tempHome', 'tempDir'],
    ['pathValue', 'systemRoot'])) {
    throw terminalError(ERROR_CODES.plan, 'Windows 终端启动计划字段无效');
  }
  const cwd = safePath(input.cwd, 'win32', 'Windows cwd');
  const tempHome = safePath(input.tempHome, 'win32', 'Windows 临时 HOME');
  const tempDir = safePath(input.tempDir, 'win32', 'Windows 临时目录');
  const systemRoot = safePath(input.systemRoot === undefined ? 'C:\\Windows' : input.systemRoot,
    'win32', 'Windows 系统根');
  const systemPath = [
    path.win32.join(systemRoot, 'System32'),
    systemRoot,
    path.win32.join(systemRoot, 'System32', 'Wbem'),
    path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  ].join(';');
  const environment = Object.freeze({
    PATH: safePathValue(input.pathValue, systemPath),
    HOME: tempHome,
    USERPROFILE: tempHome,
    TEMP: tempDir,
    TMP: tempDir,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    COMSPEC: path.win32.join(systemRoot, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    POWERSHELL_UPDATECHECK: 'Off'
  });
  const encoded = Buffer.from(windowsBootstrapScript(), 'utf16le').toString('base64');
  return Object.freeze({
    platform: 'win32',
    file: 'powershell.exe',
    args: Object.freeze(['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', encoded]),
    cwd,
    env: environment
  });
}

function launchPlan(input) {
  if (!isPlainObject(input)) throw terminalError(ERROR_CODES.plan, '终端启动计划无效');
  if (input.platform === 'win32') return windowsLaunch(input);
  if (input.platform === 'darwin' || input.platform === 'linux') return posixLaunch(input);
  throw terminalError(ERROR_CODES.plan, '终端平台不受支持');
}

function describeLaunchPlan(value) {
  if (!isPlainObject(value) || !Array.isArray(value.args) || !isPlainObject(value.env)
      || typeof value.platform !== 'string' || typeof value.file !== 'string') {
    throw terminalError(ERROR_CODES.plan, '终端启动计划无效');
  }
  return Object.freeze({
    platform: value.platform,
    file: value.file,
    argumentCount: value.args.length,
    environmentKeys: Object.freeze(Object.keys(value.env).sort())
  });
}

const validate = Object.freeze({
  open: validateOpenRequest,
  write: validateWriteRequest,
  read: validateReadRequest,
  resize: validateResizeRequest,
  signal: validateSignalRequest,
  close: validateCloseRequest,
  authority: validateAuthority
});

const plan = Object.freeze({
  launch: launchPlan,
  describe: describeLaunchPlan,
  POSIX_ENV_ORDER,
  WINDOWS_ENV_ORDER
});

const sanitizer = Object.freeze({
  sanitize: sanitizeTerminalText,
  TerminalSanitizer
});

const buffer = Object.freeze({
  Utf8RingBuffer,
  safeOutputPage: (instance, request) => {
    if (!(instance instanceof Utf8RingBuffer)) {
      throw terminalError(ERROR_CODES.output, '终端输出缓冲实例无效');
    }
    return instance.page(request);
  }
});

module.exports = Object.freeze({
  LIMITS,
  ERROR_CODES,
  TERMINAL_REF_RE,
  CAPABILITY_RE,
  validate,
  plan,
  sanitizer,
  buffer,
  createTerminalBinding,
  publicTerminalBinding,
  assertTerminalBinding
});
