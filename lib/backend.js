'use strict';
// dsh 后端进程管理：命令探测、启动、端口等待、停止。
// 不依赖 Electron，纯 Node 可测。

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { DEFAULTS, DSH_CONTRACT } = require('./config');

const HOME = os.homedir();
const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const BUNDLED_DSH_BIN_PARTS = [
  'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'
];
let runtimeInfo = { execPath: '', resourcesPath: '' };

function setRuntimeInfo(info = {}) {
  runtimeInfo = {
    execPath: String(info.execPath || ''),
    resourcesPath: String(info.resourcesPath || '')
  };
}

function configuredPort(config = {}) {
  const port = Number(config.port);
  return String(Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULTS.port);
}

function envValue(env, name) {
  const key = Object.keys(env || {}).find((item) => item.toUpperCase() === name.toUpperCase());
  return key ? env[key] : '';
}

function uniq(items, caseInsensitive = false) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item) return false;
    const key = caseInsensitive ? String(item).toLowerCase() : String(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pathApi(platform, injected) {
  return injected || (platform === 'win32' ? path.win32 : path.posix);
}

// nvm 用户：~/.nvm/versions/node/vX.Y.Z/bin（取版本号最大的排前面）
function nvmBinDirs(homeDir = HOME, fsImpl = fs, pathImpl = path.posix) {
  try {
    const dir = pathImpl.join(homeDir, '.nvm', 'versions', 'node');
    return fsImpl.readdirSync(dir)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => pathImpl.join(dir, version, 'bin'));
  } catch (_e) {
    return [];
  }
}

// 向登录 shell 要一份完整 PATH（zsh/bash 均可），带超时防卡死。
// Windows 不启动 login shell，避免弹窗和无意义探测。
function loginShellPath(timeoutMs = 4000, runtime = {}) {
  const platform = runtime.platform || process.platform;
  if (platform === 'win32') return '';
  const env = runtime.env || process.env;
  const spawnSyncImpl = runtime.spawnSync || spawnSync;
  const shell = envValue(env, 'SHELL') || '/bin/zsh';
  for (const flag of ['-ilc', '-lc']) {
    try {
      const result = spawnSyncImpl(shell, [flag, 'printf "__PATH__%s" "$PATH"'], {
        timeout: timeoutMs,
        encoding: 'utf8',
        env
      });
      const match = (result.stdout || '').match(/__PATH__(.*)$/s);
      if (match && match[1] && match[1].trim()) return match[1].trim();
    } catch (_e) { /* 换下一种方式 */ }
  }
  return '';
}

function windowsCommonDirs(homeDir, env, pathImpl) {
  const appData = envValue(env, 'APPDATA') || pathImpl.join(homeDir, 'AppData', 'Roaming');
  const localAppData = envValue(env, 'LOCALAPPDATA') || pathImpl.join(homeDir, 'AppData', 'Local');
  const driveRoot = pathImpl.parse(homeDir).root || 'C:\\';
  const programFiles = envValue(env, 'ProgramFiles') || pathImpl.join(driveRoot, 'Program Files');
  const programData = envValue(env, 'ProgramData') || pathImpl.join(driveRoot, 'ProgramData');
  return [
    envValue(env, 'NVM_SYMLINK'),
    pathImpl.join(programFiles, 'nodejs'),
    pathImpl.join(appData, 'npm'),
    pathImpl.join(localAppData, 'Volta', 'bin'),
    pathImpl.join(homeDir, 'scoop', 'shims'),
    pathImpl.join(programData, 'chocolatey', 'bin')
  ];
}

function calculateFullPath(runtime = {}) {
  const platform = runtime.platform || process.platform;
  const env = runtime.env || process.env;
  const homeDir = runtime.homeDir || envValue(env, 'USERPROFILE') || HOME;
  const fsImpl = runtime.fs || fs;
  const pathImpl = pathApi(platform, runtime.pathModule);
  const delimiter = runtime.delimiter || pathImpl.delimiter;
  const inherited = String(envValue(env, 'PATH') || '').split(delimiter);

  if (platform === 'win32') {
    return uniq([
      ...inherited,
      ...windowsCommonDirs(homeDir, env, pathImpl)
    ], true).join(delimiter);
  }

  const readLoginPath = runtime.loginShellPath
    ? runtime.loginShellPath
    : () => loginShellPath(4000, runtime);
  return uniq([
    ...String(readLoginPath() || '').split(delimiter),
    ...inherited,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    pathImpl.join(homeDir, '.volta', 'bin'),
    pathImpl.join(homeDir, '.local', 'bin'),
    ...nvmBinDirs(homeDir, fsImpl, pathImpl),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin'
  ]).join(delimiter);
}

let cachedPath = null;

function fullPath(refresh = false, runtime = {}) {
  if (typeof refresh === 'object' && refresh !== null) {
    runtime = refresh;
    refresh = false;
  }
  const injectedRuntime = Object.keys(runtime || {}).length > 0;
  if (!injectedRuntime && cachedPath && !refresh) return cachedPath;
  const result = calculateFullPath(runtime);
  if (!injectedRuntime) cachedPath = result;
  return result;
}

// Windows 按 PATHEXT 展开；其他平台保持原命令名。纯函数，便于三平台 smoke。
function execCandidates(name, platform = process.platform, pathext = process.env.PATHEXT) {
  const value = String(name || '');
  if (platform !== 'win32' || path.win32.extname(value)) return [value];
  const extensions = String(pathext || DEFAULT_WINDOWS_PATHEXT)
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase());
  return uniq([...extensions.map((ext) => `${value}${ext}`), value], true);
}

function which(cmd, runtime = {}) {
  const platform = runtime.platform || process.platform;
  const env = runtime.env || process.env;
  const fsImpl = runtime.fs || fs;
  const pathImpl = pathApi(platform, runtime.pathModule);
  const delimiter = runtime.delimiter || pathImpl.delimiter;
  const searchPath = runtime.pathValue == null ? fullPath(false, runtime) : String(runtime.pathValue);
  const hasDirectory = pathImpl.dirname(cmd) !== '.';
  const candidates = execCandidates(cmd, platform, envValue(env, 'PATHEXT'));

  for (const rawDir of directoriesFor(searchPath, delimiter, hasDirectory)) {
    const dir = String(rawDir || '').trim().replace(/^"|"$/g, '');
    if (!hasDirectory && !dir) continue;
    for (const name of candidates) {
      const candidate = hasDirectory ? name : pathImpl.join(dir, name);
      try {
        const mode = platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
        fsImpl.accessSync(candidate, mode);
        if (fsImpl.statSync(candidate).isFile()) return candidate;
      } catch (_e) { /* 下一个候选 */ }
    }
  }
  return null;
}

function directoriesFor(searchPath, delimiter, hasDirectory) {
  return hasDirectory ? [''] : searchPath.split(delimiter);
}

// TCP 探测端口是否有服务在听
function isPortOpen(port, host = '127.0.0.1', timeoutMs = 900) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function waitForPort(port, opts = {}) {
  const {
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 700,
    onTick = null,
    shouldAbort = null
  } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (shouldAbort && shouldAbort()) return false;
    const open = await isPortOpen(port);
    // 探测期间子进程可能刚好退出；返回成功前再确认一次。
    if (shouldAbort && shouldAbort()) return false;
    if (open) return true;
    if (onTick) onTick(Date.now() - start);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

// attach 前的弱特征检查：只负责识别 dsh Web 的标题，不把网络异常升级成失败态。
function classifyHarnessResponse(headers = {}, body = '') {
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  const html = String(body || '');
  const looksLikeHtml = contentType.includes('text/html')
    || /^\s*(?:<!doctype\s+html|<html\b)/i.test(html);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  return {
    status: looksLikeHtml && /deepseek\s+harness/i.test(title) ? 'match' : 'mismatch',
    title
  };
}

function probeHarness(port, opts = {}) {
  const timeoutMs = opts.timeoutMs == null ? 1500 : opts.timeoutMs;
  const get = opts.get || http.get;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let req = null;
    try {
      req = get({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        headers: { Accept: 'text/html' }
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 256 * 1024) body += chunk;
        });
        res.once('end', () => finish({
          ...classifyHarnessResponse(res.headers, body),
          statusCode: res.statusCode || 0
        }));
        res.once('aborted', () => finish({ status: 'unknown', reason: 'response-aborted' }));
        res.once('error', (error) => finish({ status: 'unknown', reason: error.message }));
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        finish({ status: 'unknown', reason: 'timeout' });
      });
      req.once('error', (error) => finish({ status: 'unknown', reason: error.message }));
    } catch (error) {
      finish({ status: 'unknown', reason: error.message });
    }
  });
}

// 托管 backend 的真实工作目录只能由仍存活的 WhaleDock child 对应 host
// 现场证明。这里是 one-shot 只读请求，不缓存、不读取文件系统，也不访问
// dsh home；所有 rc wire 与 host 版本事实继续收口在 backend/config。
function dshWorkdirError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertManagedWorkdirState(state, childAtStart = null) {
  if (!state || typeof state !== 'object' || !state.child
      || (typeof state.child !== 'object' && typeof state.child !== 'function')
      || state.exited !== false
      || (childAtStart !== null && state.child !== childAtStart)) {
    throw dshWorkdirError(
      'ERR_DSH_WORKDIR_STATE',
      '只有仍存活且未换代的鲸坞托管 backend 可以证明工作目录'
    );
  }
  return state.child;
}

function workdirRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function proveManagedWorkdir(options = {}) {
  const childAtStart = assertManagedWorkdirState(options.state);
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'dsh workdir 端口无效');
  }
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', '当前 Node 运行时缺少 fetch');
  }
  const timeoutMs = options.timeoutMs == null ? 3000 : Number(options.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'timeoutMs 必须在 1–30000ms 之间');
  }
  const maxResponseBytes = options.maxResponseBytes == null
    ? 64 * 1024 : Number(options.maxResponseBytes);
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 128
      || maxResponseBytes > 1024 * 1024) {
    throw dshWorkdirError(
      'ERR_DSH_WORKDIR_CONTRACT',
      'maxResponseBytes 必须在 128B–1MiB 之间'
    );
  }
  const mintRpcId = options.mintRpcId || (() => crypto.randomUUID());
  const rpcId = mintRpcId();
  if (typeof rpcId !== 'string' || !rpcId || rpcId.length > 256
      || /[\u0000-\u001f\u007f]/.test(rpcId)) {
    throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'workdir rpcId 无效');
  }

  const baseHttp = `http://127.0.0.1:${port}`;
  const endpoint = `${baseHttp}/api/host.describe`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  async function boundedText(response) {
    const body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const chunk = Buffer.from(part.value || []);
          total += chunk.length;
          if (total > maxResponseBytes) {
            controller.abort();
            try { await reader.cancel(); } catch (_error) { /* ignore */ }
            throw dshWorkdirError(
              'ERR_DSH_WORKDIR_RESPONSE_TOO_LARGE',
              'host.describe 响应超过字节上限'
            );
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (error && error.code === 'ERR_DSH_WORKDIR_RESPONSE_TOO_LARGE') throw error;
        if (timedOut) {
          throw dshWorkdirError('ERR_DSH_WORKDIR_TIMEOUT', 'host.describe 读取超时');
        }
        throw dshWorkdirError('ERR_DSH_WORKDIR_TRANSPORT', 'host.describe 响应读取失败');
      } finally {
        try { reader.releaseLock(); } catch (_error) { /* ignore */ }
      }
      return Buffer.concat(chunks, total).toString('utf8');
    }
    let text;
    try {
      text = await response.text();
    } catch (_error) {
      if (timedOut) {
        throw dshWorkdirError('ERR_DSH_WORKDIR_TIMEOUT', 'host.describe 读取超时');
      }
      throw dshWorkdirError('ERR_DSH_WORKDIR_TRANSPORT', 'host.describe 响应读取失败');
    }
    if (typeof text !== 'string') {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe 响应正文无效');
    }
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw dshWorkdirError(
        'ERR_DSH_WORKDIR_RESPONSE_TOO_LARGE',
        'host.describe 响应超过字节上限'
      );
    }
    return text;
  }

  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: 'host.describe',
          payload: {}
        }),
        redirect: 'error',
        signal: controller.signal
      });
    } catch (_error) {
      if (timedOut) throw dshWorkdirError('ERR_DSH_WORKDIR_TIMEOUT', 'host.describe 超时');
      assertManagedWorkdirState(options.state, childAtStart);
      throw dshWorkdirError('ERR_DSH_WORKDIR_TRANSPORT', 'host.describe 传输失败');
    }
    assertManagedWorkdirState(options.state, childAtStart);
    if (!response || typeof response.text !== 'function') {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe HTTP 响应无效');
    }
    if (response.redirected) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_REDIRECT', 'host.describe 拒绝跟随重定向');
    }
    if (response.url) {
      let responseUrl;
      try { responseUrl = new URL(response.url); } catch (_error) {
        throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe 响应 URL 无效');
      }
      if (responseUrl.origin !== baseHttp) {
        throw dshWorkdirError(
          'ERR_DSH_WORKDIR_REDIRECT',
          'host.describe 响应离开固定 loopback origin'
        );
      }
    }
    if (!response.ok) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_TRANSPORT', 'host.describe HTTP 请求失败');
    }
    const contentType = response.headers && typeof response.headers.get === 'function'
      ? String(response.headers.get('content-type') || '').toLowerCase() : '';
    if (!contentType.includes('application/json')) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe 响应不是 JSON');
    }
    const lengthHeader = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length') : null;
    if (lengthHeader !== null && lengthHeader !== undefined && lengthHeader !== '') {
      if (!/^\d+$/.test(String(lengthHeader))) {
        throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe Content-Length 无效');
      }
      if (Number(lengthHeader) > maxResponseBytes) {
        controller.abort();
        throw dshWorkdirError(
          'ERR_DSH_WORKDIR_RESPONSE_TOO_LARGE',
          'host.describe 响应超过字节上限'
        );
      }
    }
    const text = await boundedText(response);
    if (timedOut) throw dshWorkdirError('ERR_DSH_WORKDIR_TIMEOUT', 'host.describe 超时');
    assertManagedWorkdirState(options.state, childAtStart);
    let envelope;
    try { envelope = JSON.parse(text); } catch (_error) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe 响应不是有效 JSON');
    }
    if (!workdirRecord(envelope) || envelope.type !== 'server-response'
        || envelope.rpcId !== rpcId || !workdirRecord(envelope.result)
        || envelope.result.ok !== true
        || !Object.prototype.hasOwnProperty.call(envelope.result, 'value')) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe envelope 无效');
    }
    const value = envelope.result.value;
    if (!workdirRecord(value)
        || typeof value.version !== 'string'
        || typeof value.cwd !== 'string'
        || !Number.isInteger(value.attachedSessions) || value.attachedSessions < 0
        || typeof value.canOpenPath !== 'boolean') {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe value shape 无效');
    }
    for (const field of ['provider', 'model']) {
      if (value[field] !== undefined
          && (typeof value[field] !== 'string' || value[field].length > 4096)) {
        throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', `host.describe ${field} 无效`);
      }
    }
    if (value.version !== DSH_CONTRACT.hostVersion) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_VERSION', 'dsh host 工作目录合约版本不匹配');
    }
    if (!value.cwd || value.cwd.length > 4096
        || Buffer.byteLength(value.cwd, 'utf8') > 16 * 1024
        || /[\u0000-\u001f\u007f]/.test(value.cwd)
        || !(path.isAbsolute(value.cwd) || path.win32.isAbsolute(value.cwd))) {
      throw dshWorkdirError('ERR_DSH_WORKDIR_CONTRACT', 'host.describe cwd 无效');
    }
    assertManagedWorkdirState(options.state, childAtStart);
    return Object.freeze({ proven: true, cwd: value.cwd });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- dsh prompt 适配器（rc.6 写入合约只收口在 backend） ----------

const DSH_PROMPT_LIMITS = Object.freeze({
  maxTextBytes: 64 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxTargets: 500,
  maxTokenChars: 256,
  maxRpcIdChars: 256,
  maxTimeZoneChars: 128
});
const DSH_PROMPT_METHODS = new Set([
  'host.describe', 'session.list', 'session.prompt'
]);

function dshPromptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function promptContract(message) {
  return dshPromptError('ERR_DSH_PROMPT_CONTRACT', message);
}

function promptRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function promptNonEmptyString(value, label, maximum = 4096) {
  if (typeof value !== 'string' || !value || value.length > maximum) {
    throw promptContract(`${label} 必须是有限非空字符串`);
  }
  return value;
}

function createDshPromptAdapter(options = {}) {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw promptContract('dsh prompt 端口必须是 1024–65535 的整数');
  }
  // 根包版本与 host.describe.version 是两个不同信号；两个都必须精确命中
  // 当前实证过的 rc.6 合约，不能由调用者把适配器悄悄放宽到别的版本。
  const expectedHostVersion = promptNonEmptyString(
    options.expectedHostVersion,
    'expectedHostVersion',
    64
  );
  if (expectedHostVersion !== DSH_CONTRACT.hostVersion) {
    throw promptContract('expectedHostVersion 不等于当前锁定的 dsh host 合约版本');
  }
  const packageProven = options.packageVersionProof === DSH_CONTRACT.packageVersion;
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw promptContract('当前 Node 运行时缺少 fetch');
  const timeoutMs = options.timeoutMs == null ? 3000 : Number(options.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw promptContract('timeoutMs 必须在 1–30000ms 之间');
  }
  const maxResponseBytes = options.maxResponseBytes == null
    ? DSH_PROMPT_LIMITS.maxResponseBytes : Number(options.maxResponseBytes);
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 128
      || maxResponseBytes > DSH_PROMPT_LIMITS.maxResponseBytes) {
    throw promptContract('maxResponseBytes 必须在 128B–1MiB 之间');
  }
  const mintRpcId = options.mintRpcId || (() => crypto.randomUUID());
  const mintTargetToken = options.mintTargetToken || (() => crypto.randomUUID());
  const baseHttp = `http://127.0.0.1:${port}`;
  const rawByTargetToken = new Map();
  const activeControllers = new Set();
  const inFlightCalls = new Set();
  let adapterClosed = false;
  let closePromise = null;
  let describePromise = null;

  const assertOpen = () => {
    if (adapterClosed) {
      throw dshPromptError('ERR_DSH_PROMPT_CLOSED', 'dsh prompt 适配器已关闭');
    }
  };

  const rpcId = () => {
    const value = mintRpcId();
    if (typeof value !== 'string' || !value
        || value.length > DSH_PROMPT_LIMITS.maxRpcIdChars) {
      throw promptContract('mintRpcId 必须返回有限非空字符串');
    }
    return value;
  };

  const targetToken = (occupied) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = mintTargetToken();
      if (typeof value !== 'string'
          || !/^[A-Za-z0-9_-]+$/.test(value)
          || value.length > DSH_PROMPT_LIMITS.maxTokenChars) {
        throw promptContract('mintTargetToken 必须返回有限的 opaque token');
      }
      if (!occupied.has(value)) return value;
    }
    throw promptContract('target token 连续冲突');
  };

  async function boundedResponseText(response, method, controller, timedOut) {
    const body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      const chunks = [];
      let total = 0;
      const reader = body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const chunk = Buffer.from(part.value || []);
          total += chunk.length;
          if (total > maxResponseBytes) {
            controller.abort();
            try { await reader.cancel(); } catch (_error) { /* ignore */ }
            throw dshPromptError(
              'ERR_DSH_PROMPT_RESPONSE_TOO_LARGE',
              `${method} 响应超过字节上限`
            );
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (error && error.code === 'ERR_DSH_PROMPT_RESPONSE_TOO_LARGE') throw error;
        if (timedOut()) throw dshPromptError('ERR_DSH_PROMPT_TIMEOUT', `${method} 超时`);
        if (adapterClosed) throw dshPromptError('ERR_DSH_PROMPT_CLOSED', `${method} 已中止`);
        throw dshPromptError('ERR_DSH_PROMPT_TRANSPORT', `${method} 读取响应失败`);
      } finally {
        try { reader.releaseLock(); } catch (_error) { /* ignore */ }
      }
      return Buffer.concat(chunks, total).toString('utf8');
    }
    let text;
    try {
      text = await response.text();
    } catch (_error) {
      if (timedOut()) throw dshPromptError('ERR_DSH_PROMPT_TIMEOUT', `${method} 超时`);
      if (adapterClosed) throw dshPromptError('ERR_DSH_PROMPT_CLOSED', `${method} 已中止`);
      throw dshPromptError('ERR_DSH_PROMPT_TRANSPORT', `${method} 读取响应失败`);
    }
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw dshPromptError(
        'ERR_DSH_PROMPT_RESPONSE_TOO_LARGE',
        `${method} 响应超过字节上限`
      );
    }
    return text;
  }

  async function performCall(method, payload) {
    assertOpen();
    if (!DSH_PROMPT_METHODS.has(method)) {
      throw promptContract('拒绝未授权的 dsh prompt RPC');
    }
    const id = rpcId();
    const request = {
      type: 'client-request',
      rpcId: id,
      method,
      payload
    };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    activeControllers.add(controller);
    try {
      let response;
      try {
        response = await fetchImpl(`${baseHttp}/api/${method}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(request),
          redirect: 'error',
          signal: controller.signal
        });
      } catch (_error) {
        if (timedOut) throw dshPromptError('ERR_DSH_PROMPT_TIMEOUT', `${method} 超时`);
        if (adapterClosed) throw dshPromptError('ERR_DSH_PROMPT_CLOSED', `${method} 已中止`);
        throw dshPromptError('ERR_DSH_PROMPT_TRANSPORT', `${method} 传输失败`);
      }
      if (adapterClosed) throw dshPromptError('ERR_DSH_PROMPT_CLOSED', `${method} 已中止`);
      if (!response || typeof response.text !== 'function') {
        throw promptContract(`${method} 返回了无效 HTTP 响应`);
      }
      if (response.redirected) {
        throw dshPromptError('ERR_DSH_PROMPT_REDIRECT', `${method} 拒绝跟随重定向`);
      }
      if (response.url) {
        let responseUrl;
        try { responseUrl = new URL(response.url); } catch (_error) {
          throw promptContract(`${method} 响应 URL 无效`);
        }
        if (responseUrl.origin !== baseHttp) {
          throw dshPromptError('ERR_DSH_PROMPT_REDIRECT', `${method} 响应离开 loopback origin`);
        }
      }
      if (!response.ok) {
        throw dshPromptError('ERR_DSH_PROMPT_TRANSPORT', `${method} HTTP 请求失败`);
      }
      const contentType = response.headers && typeof response.headers.get === 'function'
        ? String(response.headers.get('content-type') || '').toLowerCase() : '';
      if (!contentType.includes('application/json')) {
        throw promptContract(`${method} 响应不是 application/json`);
      }
      const declared = response.headers && typeof response.headers.get === 'function'
        ? Number(response.headers.get('content-length')) : NaN;
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        throw dshPromptError(
          'ERR_DSH_PROMPT_RESPONSE_TOO_LARGE',
          `${method} 响应超过字节上限`
        );
      }
      const text = await boundedResponseText(response, method, controller, () => timedOut);
      if (adapterClosed) throw dshPromptError('ERR_DSH_PROMPT_CLOSED', `${method} 已中止`);
      let envelope;
      try { envelope = JSON.parse(text); } catch (_error) {
        throw promptContract(`${method} 响应不是有效 JSON`);
      }
      if (!promptRecord(envelope) || envelope.type !== 'server-response'
          || envelope.rpcId !== id || !promptRecord(envelope.result)) {
        throw promptContract(`${method} 响应 envelope 无效`);
      }
      return envelope.result;
    } finally {
      clearTimeout(timer);
      activeControllers.delete(controller);
    }
  }

  function call(method, payload) {
    const pending = performCall(method, payload);
    inFlightCalls.add(pending);
    void pending.then(
      () => inFlightCalls.delete(pending),
      () => inFlightCalls.delete(pending)
    );
    return pending;
  }

  function successfulValue(result, method) {
    if (!promptRecord(result) || result.ok !== true
        || !Object.prototype.hasOwnProperty.call(result, 'value')) {
      throw promptContract(`${method} 成功结果形状无效`);
    }
    return result.value;
  }

  function validateDescribe(value) {
    if (!promptRecord(value)) throw promptContract('host.describe value 无效');
    promptNonEmptyString(value.version, 'host.describe.version', 64);
    promptNonEmptyString(value.cwd, 'host.describe.cwd');
    if (!Number.isInteger(value.attachedSessions) || value.attachedSessions < 0
        || typeof value.canOpenPath !== 'boolean') {
      throw promptContract('host.describe shape 无效');
    }
    for (const field of ['provider', 'model']) {
      if (value[field] !== undefined && typeof value[field] !== 'string') {
        throw promptContract(`host.describe.${field} 无效`);
      }
    }
    if (value.version !== expectedHostVersion) {
      throw dshPromptError('ERR_DSH_PROMPT_VERSION', 'dsh host prompt 合约版本不匹配');
    }
    return true;
  }

  function ensureDescribe() {
    assertOpen();
    if (!describePromise) {
      const pending = call('host.describe', {})
        .then((result) => validateDescribe(successfulValue(result, 'host.describe')));
      describePromise = pending;
      void pending.catch(() => {
        if (describePromise === pending) describePromise = null;
      });
    }
    return describePromise;
  }

  function unavailableReason(error) {
    switch (error && error.code) {
      case 'ERR_DSH_PROMPT_VERSION': return 'host-version';
      case 'ERR_DSH_PROMPT_TIMEOUT': return 'timeout';
      case 'ERR_DSH_PROMPT_RESPONSE_TOO_LARGE': return 'response-too-large';
      case 'ERR_DSH_PROMPT_REDIRECT': return 'redirect';
      case 'ERR_DSH_PROMPT_CLOSED': return 'closed';
      case 'ERR_DSH_PROMPT_CONTRACT': return 'contract';
      default: return 'transport';
    }
  }

  async function detect() {
    assertOpen();
    if (!packageProven) return { available: false, reason: 'package-unproven' };
    try {
      await ensureDescribe();
      return { available: true, reason: 'ready' };
    } catch (error) {
      if (error && error.code === 'ERR_DSH_PROMPT_CLOSED') throw error;
      return { available: false, reason: unavailableReason(error) };
    }
  }

  function validateSessionRow(value, index) {
    if (!promptRecord(value)) throw promptContract(`session.list.items[${index}] 无效`);
    const sessionId = promptNonEmptyString(
      value.sessionId,
      `session.list.items[${index}].sessionId`,
      4096
    );
    if (!Number.isFinite(value.updatedAt)
        || typeof value.running !== 'boolean' || typeof value.blank !== 'boolean') {
      throw promptContract(`session.list.items[${index}] shape 无效`);
    }
    if (value.origin !== undefined && value.origin !== 'subagent') {
      throw promptContract(`session.list.items[${index}].origin 无效`);
    }
    if (value.parentSessionId !== undefined) {
      promptNonEmptyString(
        value.parentSessionId,
        `session.list.items[${index}].parentSessionId`,
        4096
      );
    }
    return {
      sessionId,
      updatedAt: value.updatedAt,
      running: value.running,
      selectable: value.blank === false
        && value.origin !== 'subagent'
        && value.parentSessionId === undefined
    };
  }

  async function listTargets() {
    assertOpen();
    const availability = await detect();
    if (!availability.available) {
      rawByTargetToken.clear();
      return { ...availability, targets: [] };
    }
    try {
      const result = await call('session.list', {});
      const value = successfulValue(result, 'session.list');
      if (!promptRecord(value) || !Array.isArray(value.items)
          || value.items.length > DSH_PROMPT_LIMITS.maxTargets) {
        throw promptContract('session.list.items 无效或超过上限');
      }
      const rows = value.items.map(validateSessionRow);
      const ids = new Set();
      for (const row of rows) {
        if (ids.has(row.sessionId)) throw promptContract('session.list 出现重复 sessionId');
        ids.add(row.sessionId);
      }
      const selectable = rows.filter((row) => row.selectable)
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const nextMap = new Map();
      const targets = selectable.map((row, index) => {
        const token = targetToken(nextMap);
        nextMap.set(token, row.sessionId);
        return {
          targetToken: token,
          label: `会话 ${String(index + 1).padStart(2, '0')}`,
          running: row.running,
          updatedAt: row.updatedAt
        };
      });
      rawByTargetToken.clear();
      for (const [token, raw] of nextMap) rawByTargetToken.set(token, raw);
      return { available: true, reason: 'ready', targets };
    } catch (error) {
      rawByTargetToken.clear();
      if (error && error.code === 'ERR_DSH_PROMPT_CLOSED') throw error;
      return { available: false, reason: unavailableReason(error), targets: [] };
    }
  }

  function validatePromptInput(value) {
    if (!promptRecord(value)) {
      throw dshPromptError('ERR_DSH_PROMPT_INPUT', 'prompt 输入必须是对象');
    }
    if (typeof value.targetToken !== 'string'
        || value.targetToken.length < 1
        || value.targetToken.length > DSH_PROMPT_LIMITS.maxTokenChars) {
      throw dshPromptError('ERR_DSH_PROMPT_TARGET', '未知目标，请刷新会话列表');
    }
    const rawSessionId = rawByTargetToken.get(value.targetToken);
    if (!rawSessionId) {
      throw dshPromptError('ERR_DSH_PROMPT_TARGET', '未知目标，请刷新会话列表');
    }
    if (typeof value.text !== 'string' || !value.text.trim()
        || value.text.trimStart().startsWith('/')
        || value.text.includes('\0')
        || Buffer.byteLength(value.text, 'utf8') > DSH_PROMPT_LIMITS.maxTextBytes) {
      throw dshPromptError('ERR_DSH_PROMPT_INPUT', '只允许有限的普通文本 prompt');
    }
    const payload = {
      sessionId: rawSessionId,
      mode: 'queue',
      content: [{ type: 'text', text: value.text }]
    };
    if (value.clientTimeZone !== undefined) {
      if (typeof value.clientTimeZone !== 'string' || !value.clientTimeZone
          || value.clientTimeZone.length > DSH_PROMPT_LIMITS.maxTimeZoneChars) {
        throw dshPromptError('ERR_DSH_PROMPT_INPUT', 'clientTimeZone 无效');
      }
      try {
        payload.clientTimeZone = new Intl.DateTimeFormat('en-US', {
          timeZone: value.clientTimeZone
        }).resolvedOptions().timeZone;
      } catch (_error) {
        throw dshPromptError('ERR_DSH_PROMPT_INPUT', 'clientTimeZone 无效');
      }
    }
    return payload;
  }

  function rejectedReason(result) {
    if (!promptRecord(result) || result.ok !== false || !promptRecord(result.error)) return null;
    const code = result.error.code;
    return typeof code === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(code)
      ? code : 'rejected';
  }

  async function submitText(value) {
    assertOpen();
    const payload = validatePromptInput(value);
    if (!packageProven) return { state: 'unknown', reason: 'package-unproven' };
    try {
      await ensureDescribe();
      const result = await call('session.prompt', payload);
      const rejected = rejectedReason(result);
      if (rejected) return { state: 'rejected', reason: rejected };
      if (!promptRecord(result) || result.ok !== true
          || !promptRecord(result.value) || result.value.accepted !== true) {
        throw promptContract('session.prompt 成功结果 shape 无效');
      }
      return { state: 'accepted', reason: 'accepted' };
    } catch (error) {
      return { state: 'unknown', reason: unavailableReason(error) };
    }
  }

  function close() {
    if (closePromise) return closePromise;
    adapterClosed = true;
    closePromise = (async () => {
      for (const controller of activeControllers) controller.abort();
      await Promise.allSettled([...inFlightCalls]);
      activeControllers.clear();
      inFlightCalls.clear();
      rawByTargetToken.clear();
      describePromise = null;
    })();
    return closePromise;
  }

  return Object.freeze({ detect, listTargets, submitText, close });
}

// ---------- dsh 事件适配器（rc 私有合约只收口在 backend） ----------

const DSH_EVENTS_HTTP_METHODS = new Set([
  'host.describe', 'session.list', 'session.history'
]);
const DSH_EVENTS_WS_METHODS = new Set([
  'session/event', 'session/subscribed',
  'approval/requested', 'approval/resolved',
  'question/requested', 'question/resolved',
  'session/queue', 'session/jobs', 'session/projection', 'stream/error'
]);
const DSH_TERMINAL_OUTCOMES = new Set([
  'completed', 'error', 'aborted', 'blocked', 'max-tokens', 'interrupted'
]);

function dshEventsError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function dshContract(message, cause) {
  return dshEventsError('ERR_DSH_EVENTS_CONTRACT', message, cause);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw dshContract(`${label} 必须是对象`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw dshContract(`${label} 必须是非空字符串`);
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw dshContract(`${label} 必须是不小于 ${minimum} 的整数`);
  }
  return value;
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw dshContract(`${label} 必须是有限数字`);
  return value;
}

function normalizeObservedUsage(raw, label) {
  const usage = requireRecord(raw, label);
  const result = {
    inputTokens: requireInteger(usage.inputTokens, `${label}.inputTokens`),
    outputTokens: requireInteger(usage.outputTokens, `${label}.outputTokens`)
  };
  for (const key of ['cacheReadTokens', 'cacheWriteTokens']) {
    if (usage[key] !== undefined) result[key] = requireInteger(usage[key], `${label}.${key}`);
  }
  // reasoningTokens 已包含在 outputTokens；适配层不向外暴露，避免消费者重复计数。
  return result;
}

function createDshEventsAdapter(options = {}) {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw dshContract('dsh 事件端口必须是 1024–65535 的整数');
  }
  // host.describe.version 是 host app 协议版本，不是 @deepseek-ai/dsh 根包版本。
  // 两者由调用者分开验证；这里只接受不带默认值的 host 版本。
  const expectedHostVersion = requireString(options.expectedHostVersion, 'expectedHostVersion');
  const sessionSalt = options.sessionSalt;
  if (!(typeof sessionSalt === 'string' || Buffer.isBuffer(sessionSalt))
      || Buffer.byteLength(sessionSalt) < 1) {
    throw dshContract('sessionSalt 必须是非空字符串或 Buffer');
  }
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw dshContract('当前 Node 运行时缺少 fetch');
  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;
  const timeoutMs = options.timeoutMs == null ? 3000 : Number(options.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw dshContract('timeoutMs 必须在 1–30000ms 之间');
  }
  const maxResponseBytes = options.maxResponseBytes == null
    ? 8 * 1024 * 1024 : Number(options.maxResponseBytes);
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 128
      || maxResponseBytes > 16 * 1024 * 1024) {
    throw dshContract('maxResponseBytes 必须在 128B–16MiB 之间');
  }
  const maxFrameBytes = options.maxFrameBytes == null
    ? 256 * 1024 : Number(options.maxFrameBytes);
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 128
      || maxFrameBytes > 1024 * 1024) {
    throw dshContract('maxFrameBytes 必须在 128B–1MiB 之间');
  }
  const maxUnknownMethods = options.maxUnknownMethods == null
    ? 32 : Number(options.maxUnknownMethods);
  if (!Number.isInteger(maxUnknownMethods) || maxUnknownMethods < 1 || maxUnknownMethods > 256) {
    throw dshContract('maxUnknownMethods 必须在 1–256 之间');
  }
  const maxSessions = options.maxSessions == null ? 1000 : Number(options.maxSessions);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 5000) {
    throw dshContract('maxSessions 必须在 1–5000 之间');
  }
  const maxSubscriptions = options.maxSubscriptions == null ? 4 : Number(options.maxSubscriptions);
  if (!Number.isInteger(maxSubscriptions) || maxSubscriptions < 1 || maxSubscriptions > 16) {
    throw dshContract('maxSubscriptions 必须在 1–16 之间');
  }
  const maxPendingEvents = options.maxPendingEvents == null ? 1000 : Number(options.maxPendingEvents);
  if (!Number.isInteger(maxPendingEvents) || maxPendingEvents < 1 || maxPendingEvents > 10000) {
    throw dshContract('maxPendingEvents 必须在 1–10000 之间');
  }
  const maxPendingEventBytes = options.maxPendingEventBytes == null
    ? 4 * 1024 * 1024 : Number(options.maxPendingEventBytes);
  if (!Number.isInteger(maxPendingEventBytes) || maxPendingEventBytes < 1024
      || maxPendingEventBytes > 16 * 1024 * 1024) {
    throw dshContract('maxPendingEventBytes 必须在 1KiB–16MiB 之间');
  }
  const mintRpcId = options.mintRpcId || (() => crypto.randomUUID());
  const baseHttp = `http://127.0.0.1:${port}`;
  const baseWs = `ws://127.0.0.1:${port}`;
  const rawBySessionRef = new Map();
  const originBySessionRef = new Map();
  const activeControllers = new Set();
  const inFlightCalls = new Set();
  const subscriptions = new Set();
  let describePromise = null;
  let adapterClosed = false;
  let closePromise = null;

  const assertAdapterOpen = () => {
    if (adapterClosed) throw dshEventsError('ERR_DSH_EVENTS_CLOSED', 'dsh 事件适配器已关闭');
  };

  const refFor = (kind, raw) => {
    const value = requireString(raw, `${kind} id`);
    const digest = crypto.createHmac('sha256', sessionSalt)
      .update(`whaledock-events-v1\0${kind}\0${value}`)
      .digest('hex');
    return `${kind}-${digest}`;
  };

  const registerSession = (rawSessionId, origin) => {
    assertAdapterOpen();
    const sessionRef = refFor('session', rawSessionId);
    if (!rawBySessionRef.has(sessionRef) && rawBySessionRef.size >= maxSessions) {
      throw dshContract(`session 映射超过 ${maxSessions} 条上限`);
    }
    rawBySessionRef.set(sessionRef, rawSessionId);
    if (origin === 'subagent') originBySessionRef.set(sessionRef, 'subagent');
    else if (!originBySessionRef.has(sessionRef)) originBySessionRef.set(sessionRef, 'unknown');
    return sessionRef;
  };

  const rpcId = () => {
    const value = mintRpcId();
    if (typeof value !== 'string' || !value || value.length > 256) {
      throw dshContract('mintRpcId 必须返回 1–256 字符的字符串');
    }
    return value;
  };

  async function boundedResponseText(response, method, controller, timedOut) {
    const body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const chunk = Buffer.from(part.value || []);
          total += chunk.length;
          if (total > maxResponseBytes) {
            controller.abort();
            try { await reader.cancel(); } catch (_error) { /* ignore */ }
            throw dshEventsError('ERR_DSH_EVENTS_RESPONSE_TOO_LARGE', `${method} 响应超过字节上限`);
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (error && error.code === 'ERR_DSH_EVENTS_RESPONSE_TOO_LARGE') throw error;
        if (timedOut()) throw dshEventsError('ERR_DSH_EVENTS_TIMEOUT', `${method} 读取响应超时`, error);
        if (adapterClosed) throw dshEventsError('ERR_DSH_EVENTS_CLOSED', `${method} 因适配器关闭而中止`, error);
        throw dshEventsError('ERR_DSH_EVENTS_TRANSPORT', `${method} 读取响应失败`, error);
      } finally {
        try { reader.releaseLock(); } catch (_error) { /* ignore */ }
      }
      return Buffer.concat(chunks, total).toString('utf8');
    }
    let text;
    try { text = await response.text(); } catch (error) {
      if (timedOut()) throw dshEventsError('ERR_DSH_EVENTS_TIMEOUT', `${method} 读取响应超时`, error);
      if (adapterClosed) throw dshEventsError('ERR_DSH_EVENTS_CLOSED', `${method} 因适配器关闭而中止`, error);
      throw dshEventsError('ERR_DSH_EVENTS_TRANSPORT', `${method} 读取响应失败`, error);
    }
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw dshEventsError('ERR_DSH_EVENTS_RESPONSE_TOO_LARGE', `${method} 响应超过字节上限`);
    }
    return text;
  }

  async function performCall(method, payload) {
    assertAdapterOpen();
    if (!DSH_EVENTS_HTTP_METHODS.has(method)) throw dshContract(`拒绝未授权的 dsh RPC：${method}`);
    const id = rpcId();
    const body = { type: 'client-request', rpcId: id, method, payload };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    activeControllers.add(controller);
    let response;
    try {
      response = await fetchImpl(`${baseHttp}/api/${method}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      activeControllers.delete(controller);
      if (timedOut) throw dshEventsError('ERR_DSH_EVENTS_TIMEOUT', `${method} 超时`, error);
      if (adapterClosed) throw dshEventsError('ERR_DSH_EVENTS_CLOSED', `${method} 因适配器关闭而中止`, error);
      throw dshEventsError('ERR_DSH_EVENTS_TRANSPORT', `${method} 传输失败`, error);
    }
    try {
      if (!response || typeof response.text !== 'function') {
        throw dshContract(`${method} 返回了无效 HTTP 响应`);
      }
      if (response.redirected) {
        throw dshEventsError('ERR_DSH_EVENTS_REDIRECT', `${method} 拒绝跟随重定向`);
      }
      if (response.url) {
        let responseUrl;
        try { responseUrl = new URL(response.url); } catch (error) {
          throw dshContract(`${method} 响应 URL 无效`, error);
        }
        if (responseUrl.origin !== baseHttp) {
          throw dshEventsError('ERR_DSH_EVENTS_REDIRECT', `${method} 响应离开 loopback origin`);
        }
      }
      if (!response.ok) {
        throw dshEventsError('ERR_DSH_EVENTS_TRANSPORT', `${method} HTTP ${response.status}`);
      }
      const contentType = response.headers && response.headers.get
        ? String(response.headers.get('content-type') || '').toLowerCase() : '';
      if (!contentType.includes('application/json')) {
        throw dshContract(`${method} 响应不是 application/json`);
      }
      const declared = response.headers && response.headers.get
        ? Number(response.headers.get('content-length')) : NaN;
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        throw dshEventsError('ERR_DSH_EVENTS_RESPONSE_TOO_LARGE', `${method} 响应超过字节上限`);
      }
      const text = await boundedResponseText(response, method, controller, () => timedOut);
      let envelope;
      try { envelope = JSON.parse(text); } catch (error) {
        throw dshContract(`${method} 响应不是有效 JSON`, error);
      }
      requireRecord(envelope, `${method} envelope`);
      if (envelope.type !== 'server-response') throw dshContract(`${method} 响应 type 不是 server-response`);
      if (envelope.rpcId !== id) throw dshContract(`${method} rpcId 回显不匹配`);
      const result = requireRecord(envelope.result, `${method}.result`);
      if (result.ok === false) throw dshContract(`${method} 被 dsh 拒绝`);
      if (result.ok !== true || !Object.prototype.hasOwnProperty.call(result, 'value')) {
        throw dshContract(`${method}.result 形状无效`);
      }
      return result.value;
    } finally {
      clearTimeout(timer);
      activeControllers.delete(controller);
    }
  }

  function call(method, payload) {
    const pending = performCall(method, payload);
    inFlightCalls.add(pending);
    void pending.then(
      () => inFlightCalls.delete(pending),
      () => inFlightCalls.delete(pending)
    );
    return pending;
  }

  function validateDescribe(value) {
    const info = requireRecord(value, 'host.describe value');
    requireString(info.version, 'host.describe.version');
    requireString(info.cwd, 'host.describe.cwd');
    requireInteger(info.attachedSessions, 'host.describe.attachedSessions');
    if (typeof info.canOpenPath !== 'boolean') throw dshContract('host.describe.canOpenPath 必须是布尔值');
    for (const field of ['provider', 'model']) {
      if (info[field] !== undefined && typeof info[field] !== 'string') {
        throw dshContract(`host.describe.${field} 必须是字符串`);
      }
    }
    if (info.version !== expectedHostVersion) {
      throw dshEventsError(
        'ERR_DSH_EVENTS_VERSION',
        `dsh host 事件合约版本不匹配：期望 ${expectedHostVersion}，实际 ${info.version}`
      );
    }
    return { version: info.version };
  }

  function ensureVersion() {
    assertAdapterOpen();
    if (!describePromise) {
      const pending = call('host.describe', {}).then(validateDescribe);
      describePromise = pending;
      void pending.catch(() => {
        if (describePromise === pending) describePromise = null;
      });
    }
    return describePromise;
  }

  async function describe() {
    return { ...(await ensureVersion()) };
  }

  function validateSessionRow(value, index) {
    const row = requireRecord(value, `session.list.items[${index}]`);
    const rawSessionId = requireString(row.sessionId, `session.list.items[${index}].sessionId`);
    requireFinite(row.updatedAt, `session.list.items[${index}].updatedAt`);
    if (typeof row.running !== 'boolean' || typeof row.blank !== 'boolean') {
      throw dshContract(`session.list.items[${index}] running/blank 必须是布尔值`);
    }
    if (row.origin !== undefined && row.origin !== 'subagent') {
      throw dshContract(`session.list.items[${index}].origin 出现未知值`);
    }
    const sessionRef = registerSession(rawSessionId, row.origin);
    let parentRef = null;
    if (row.parentSessionId !== undefined) {
      parentRef = registerSession(
        requireString(row.parentSessionId, `session.list.items[${index}].parentSessionId`),
        undefined
      );
    }
    let lastSeq = -1;
    if (row.projections !== undefined) {
      const projections = requireRecord(row.projections, `session.list.items[${index}].projections`);
      lastSeq = requireInteger(projections.asOfSeq, `session.list.items[${index}].projections.asOfSeq`, -1);
    }
    return {
      sessionRef,
      parentRef,
      origin: row.origin === 'subagent' ? 'subagent' : 'unknown',
      updatedAt: row.updatedAt,
      running: row.running,
      blank: row.blank,
      lastSeq
    };
  }

  async function listSessions() {
    assertAdapterOpen();
    await ensureVersion();
    const value = requireRecord(await call('session.list', {}), 'session.list value');
    if (!Array.isArray(value.items)) throw dshContract('session.list.items 必须是数组');
    if (value.items.length > 500) throw dshContract('session.list.items 超过 500 条上限');
    return value.items.map(validateSessionRow);
  }

  function eventEnvelope(raw, label) {
    const item = requireRecord(raw, label);
    const type = requireString(item.type, `${label}.type`);
    const seq = requireInteger(item.seq, `${label}.seq`);
    const time = requireFinite(item.time, `${label}.time`);
    return { item, type, seq, time };
  }

  function eventBase(sessionRef, seq, time) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) throw dshContract('session event.time 超出有效日期范围');
    return {
      sessionRef,
      origin: originBySessionRef.get(sessionRef) || 'unknown',
      seq,
      at: date.toISOString()
    };
  }

  function normalizeSessionEvent(rawSessionId, rawEvent, label = 'session event') {
    const sessionRef = registerSession(rawSessionId, undefined);
    const { item, type, seq, time } = eventEnvelope(rawEvent, label);
    const base = eventBase(sessionRef, seq, time);
    const data = isRecord(item.data) ? item.data : null;

    if (type === 'turn/start') {
      if (!data) throw dshContract(`${label}.data 必须是对象`);
      requireInteger(data.turn, `${label}.data.turn`);
      return { kind: 'projection', ...base };
    }
    if (type === 'user/message') {
      if (!data) throw dshContract(`${label}.data 必须是对象`);
      // rc.6 当前 host 仍会从旧会话历史返回早期的直接 message 形状：
      // data={id,role,content,source}，其中没有可验证的 turn。它是已实测的
      // 只读兼容形状；丢弃全部正文并降为 projection，仅用于连续推进 seq。
      if (data.message === undefined) {
        requireString(data.id, `${label}.data.id`);
        if (data.role !== 'user' || !Array.isArray(data.content)
            || data.content.length > 10000
            || (data.source !== undefined && !isRecord(data.source))) {
          throw dshContract(`${label}.data 旧版 user/message 形状无效`);
        }
        return { kind: 'projection', ...base };
      }
      const message = requireRecord(data.message, `${label}.data.message`);
      return {
        kind: 'message',
        ...base,
        turn: requireInteger(data.turn, `${label}.data.turn`),
        role: 'user',
        messageRef: refFor('message', requireString(message.id, `${label}.data.message.id`))
      };
    }
    if (type === 'assistant/chunk') {
      if (!data) throw dshContract(`${label}.data 必须是对象`);
      const chunk = requireRecord(data.chunk, `${label}.data.chunk`);
      if (chunk.type !== 'usage') return { kind: 'projection', ...base };
      return {
        kind: 'message',
        ...base,
        turn: requireInteger(data.turn, `${label}.data.turn`),
        step: requireInteger(data.step, `${label}.data.step`),
        role: 'other',
        usageMode: 'chunk',
        usage: normalizeObservedUsage(chunk.usage, `${label}.data.chunk.usage`)
      };
    }
    if (type === 'assistant/message') {
      if (!data) throw dshContract(`${label}.data 必须是对象`);
      const message = requireRecord(data.message, `${label}.data.message`);
      const normalized = {
        kind: 'message',
        ...base,
        turn: requireInteger(data.turn, `${label}.data.turn`),
        step: requireInteger(data.step, `${label}.data.step`),
        role: 'assistant',
        usageMode: 'final',
        messageRef: refFor('message', requireString(message.id, `${label}.data.message.id`))
      };
      if (data.usage !== undefined) {
        normalized.usage = normalizeObservedUsage(data.usage, `${label}.data.usage`);
      }
      return normalized;
    }
    if (type === 'step/end') {
      if (!data) throw dshContract(`${label}.data 必须是对象`);
      requireInteger(data.turn, `${label}.data.turn`);
      requireInteger(data.step, `${label}.data.step`);
      return { kind: 'projection', ...base };
    }
    if (type === 'turn/end') {
      if (!data) throw dshContract(`${label}.data 必须是对象`);
      const reason = requireRecord(data.reason, `${label}.data.reason`);
      const outcome = requireString(reason.kind, `${label}.data.reason.kind`);
      if (!DSH_TERMINAL_OUTCOMES.has(outcome)) {
        throw dshContract(`${label}.data.reason.kind 出现未知终态`);
      }
      return {
        kind: 'turn-terminal',
        ...base,
        turn: requireInteger(data.turn, `${label}.data.turn`),
        reason: outcome
      };
    }
    // merge-extensible dsh 事件可以添加新 type；保留无正文的 seq 游标，
    // 让中性层连续推进，同时绝不把未知 data 带出适配边界。
    return { kind: 'projection', ...base };
  }

  async function readHistory(sessionRef, page = {}) {
    assertAdapterOpen();
    await ensureVersion();
    const rawSessionId = rawBySessionRef.get(sessionRef);
    if (!rawSessionId) throw dshContract('未知 sessionRef；请先通过 listSessions 建立映射');
    if (!isRecord(page)) throw dshContract('history 分页参数必须是对象');
    const payload = { sessionId: rawSessionId };
    if (page.beforeSeq !== undefined) {
      payload.beforeSeq = requireInteger(page.beforeSeq, 'beforeSeq');
    }
    // rc.6 的 maxMessages 按“消息数”分页，一条消息仍可展开上万个 chunk 事件。
    // 生产 backfill 固定为 1，再用 beforeSeq 逐页向前补洞。
    const maxMessages = page.maxMessages === undefined ? 1 : page.maxMessages;
    if (maxMessages !== 1) {
      throw dshContract('maxMessages 固定为 1');
    }
    payload.maxMessages = maxMessages;
    const value = requireRecord(await call('session.history', payload), 'session.history value');
    if (!Array.isArray(value.events)) throw dshContract('session.history.events 必须是数组');
    if (value.events.length > 50000) throw dshContract('session.history.events 超过 50000 条上限');
    if (typeof value.hasMore !== 'boolean') throw dshContract('session.history.hasMore 必须是布尔值');

    const rows = [];
    const seenSeq = new Set();
    for (let index = 0; index < value.events.length; index += 1) {
      const entry = requireRecord(value.events[index], `session.history.events[${index}]`);
      const parsed = eventEnvelope(entry.event, `session.history.events[${index}].event`);
      if (seenSeq.has(parsed.seq)) throw dshContract(`session.history 出现重复 seq ${parsed.seq}`);
      seenSeq.add(parsed.seq);
      rows.push({ seq: parsed.seq, event: entry.event });
    }
    rows.sort((a, b) => a.seq - b.seq);
    if (value.hasMore && rows.length === 0) {
      throw dshContract('session.history hasMore=true 但没有可推进的事件');
    }
    const events = [];
    for (const row of rows) {
      const normalized = normalizeSessionEvent(rawSessionId, row.event, `session.history seq=${row.seq}`);
      if (normalized) events.push(normalized);
    }
    const minSeq = rows.length ? rows[0].seq : null;
    const maxSeq = rows.length ? rows[rows.length - 1].seq : null;
    if (payload.beforeSeq !== undefined && maxSeq !== null && maxSeq >= payload.beforeSeq) {
      throw dshContract('session.history 返回了不小于 beforeSeq 的事件，分页无法推进');
    }
    if (value.hasMore && (minSeq === null || minSeq <= 0)) {
      throw dshContract('session.history hasMore=true 但 nextBeforeSeq 无法严格递减');
    }
    return {
      events,
      hasMore: value.hasMore,
      nextBeforeSeq: value.hasMore ? minSeq : null,
      minSeq,
      maxSeq
    };
  }

  function normalizeMuxFrame(method, rpc) {
    const payload = requireRecord(rpc.payload, `${method} payload`);
    if (payload.type !== method) throw dshContract(`${method} payload.type 不匹配`);

    if (method === 'session/event') {
      const rawSessionId = requireString(payload.sessionId, 'session/event.sessionId');
      return normalizeSessionEvent(rawSessionId, payload.event, 'session/event.event');
    }
    if (method === 'session/subscribed') {
      const rawSessionId = requireString(payload.sessionId, 'session/subscribed.sessionId');
      const sessionRef = registerSession(rawSessionId, undefined);
      return {
        kind: 'subscribed',
        sessionRef,
        origin: originBySessionRef.get(sessionRef) || 'unknown',
        lastSeq: requireInteger(payload.lastSeq, 'session/subscribed.lastSeq', -1)
      };
    }
    if (method === 'approval/requested' || method === 'approval/resolved') {
      const rawSessionId = requireString(payload.sessionId, `${method}.sessionId`);
      const sessionRef = registerSession(rawSessionId, undefined);
      const requestRef = refFor('request', requireString(payload.approvalId, `${method}.approvalId`));
      const result = {
        kind: method === 'approval/requested' ? 'approval-open' : 'approval-close',
        sessionRef,
        origin: originBySessionRef.get(sessionRef) || 'unknown',
        requestRef
      };
      if (method === 'approval/resolved') {
        const allowed = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);
        if (!allowed.has(payload.outcome)) throw dshContract('approval/resolved.outcome 无效');
        result.outcome = payload.outcome;
      }
      return result;
    }
    if (method === 'question/requested' || method === 'question/resolved') {
      const rawSessionId = requireString(payload.sessionId, `${method}.sessionId`);
      const sessionRef = registerSession(rawSessionId, undefined);
      let rawRequestId;
      if (method === 'question/requested') {
        if (!Array.isArray(payload.questions) || payload.questions.length < 1 || payload.questions.length > 50) {
          throw dshContract('question/requested.questions 必须是 1–50 项数组');
        }
        for (let index = 0; index < payload.questions.length; index += 1) {
          const question = requireRecord(payload.questions[index], `question/requested.questions[${index}]`);
          requireString(question.id, `question/requested.questions[${index}].id`);
          requireString(question.question, `question/requested.questions[${index}].question`);
        }
        rawRequestId = requireString(rpc.rpcId, 'question/requested rpcId');
      } else {
        rawRequestId = requireString(payload.questionRpcId, 'question/resolved.questionRpcId');
        if (!['answered', 'cancelled'].includes(payload.outcome)) {
          throw dshContract('question/resolved.outcome 无效');
        }
      }
      return {
        kind: method === 'question/requested' ? 'question-open' : 'question-close',
        sessionRef,
        origin: originBySessionRef.get(sessionRef) || 'unknown',
        requestRef: refFor('request', rawRequestId),
        ...(method === 'question/resolved' ? { outcome: payload.outcome } : {})
      };
    }
    if (method === 'session/jobs') {
      const rawSessionId = requireString(payload.sessionId, 'session/jobs.sessionId');
      if (!Array.isArray(payload.jobs) || payload.jobs.length > 1000) {
        throw dshContract('session/jobs.jobs 必须是不超过 1000 项的数组');
      }
      let runningCount = 0;
      let stoppingCount = 0;
      for (const job of payload.jobs) {
        const row = requireRecord(job, 'session/jobs job');
        requireString(row.id, 'session/jobs job.id');
        requireString(row.kind, 'session/jobs job.kind');
        requireString(row.label, 'session/jobs job.label');
        const statuses = new Set(['running', 'stopping', 'completed', 'killed', 'failed']);
        if (!statuses.has(row.status)) throw dshContract('session/jobs job.status 无效');
        requireInteger(row.startedAt, 'session/jobs job.startedAt');
        if (row.finishedAt !== undefined) requireInteger(row.finishedAt, 'session/jobs job.finishedAt');
        if (row.status === 'running') runningCount += 1;
        else if (row.status === 'stopping') stoppingCount += 1;
      }
      const sessionRef = registerSession(rawSessionId, undefined);
      return {
        kind: 'jobs',
        sessionRef,
        origin: originBySessionRef.get(sessionRef) || 'unknown',
        runningCount,
        stoppingCount,
        total: payload.jobs.length
      };
    }
    if (method === 'session/queue') {
      requireString(payload.sessionId, 'session/queue.sessionId');
      if (!Array.isArray(payload.items) || payload.items.length > 1000) {
        throw dshContract('session/queue.items 必须是不超过 1000 项的数组');
      }
      for (const item of payload.items) {
        const row = requireRecord(item, 'session/queue item');
        requireString(row.id, 'session/queue item.id');
        if (!['queued', 'steering', 'context'].includes(row.placement)) {
          throw dshContract('session/queue item.placement 无效');
        }
        const message = requireRecord(row.message, 'session/queue item.message');
        requireString(message.id, 'session/queue item.message.id');
        if (!['system', 'user', 'assistant'].includes(message.role)) {
          throw dshContract('session/queue item.message.role 无效');
        }
        if (!Array.isArray(message.content)) throw dshContract('session/queue item.message.content 必须是数组');
        requireRecord(message.source, 'session/queue item.message.source');
        requireString(message.source.kind, 'session/queue item.message.source.kind');
      }
      return null;
    }
    if (method === 'session/projection') {
      requireString(payload.sessionId, 'session/projection.sessionId');
      requireString(payload.key, 'session/projection.key');
      requireInteger(payload.seq, 'session/projection.seq');
      if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
        throw dshContract('session/projection.value 缺失');
      }
      return null;
    }
    if (method === 'stream/error') {
      const remote = requireRecord(payload.error, 'stream/error.error');
      requireString(remote.code, 'stream/error.error.code');
      if (typeof remote.message !== 'string') throw dshContract('stream/error.error.message 必须是字符串');
      requireRecord(remote.details, 'stream/error.error.details');
      return {
        kind: 'stream-error',
        code: typeof remote.code === 'string' ? remote.code : 'unknown'
      };
    }
    return null;
  }

  function subscribe(handlers = {}) {
    assertAdapterOpen();
    if (subscriptions.size >= maxSubscriptions) {
      throw dshContract(`WebSocket 订阅超过 ${maxSubscriptions} 条上限`);
    }
    if (!isRecord(handlers)) throw dshContract('subscribe handlers 必须是对象');
    const onEvent = handlers.onEvent;
    const onStatus = handlers.onStatus;
    if (onEvent !== undefined && typeof onEvent !== 'function') throw dshContract('onEvent 必须是函数');
    if (onStatus !== undefined && typeof onStatus !== 'function') throw dshContract('onStatus 必须是函数');
    let socket = null;
    let closeRequested = false;
    let openedSettled = false;
    let closedSettled = false;
    let socketOpened = false;
    let unknownMethods = 0;
    let handshakeTimer = null;
    let localCloseTimer = null;
    let consumerQueue = Promise.resolve();
    let pendingEvents = 0;
    let pendingEventBytes = 0;
    let resolveOpened;
    let rejectOpened;
    let resolveClosed;
    let rejectClosed;
    const opened = new Promise((resolve, reject) => {
      resolveOpened = resolve;
      rejectOpened = reject;
    });
    const closed = new Promise((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    });
    // 内部观察拒绝，避免调用方仅持有 adapter、未 await opened 时触发 unhandledRejection；
    // 原 Promise 仍保持拒绝语义，外部 await/assert.rejects 不受影响。
    void opened.catch(() => {});
    const clearTimers = () => {
      if (handshakeTimer) clearTimeout(handshakeTimer);
      if (localCloseTimer) clearTimeout(localCloseTimer);
      handshakeTimer = null;
      localCloseTimer = null;
    };
    const reportStatus = (value) => {
      if (!onStatus) return;
      try {
        const result = onStatus(value);
        if (result && typeof result.then === 'function') {
          void result.catch(() => { /* 状态观察者失败不能形成未处理 rejection */ });
        }
      } catch (_e) { /* 状态观察者不能击穿传输层 */ }
    };
    const settleOpened = (error) => {
      if (openedSettled) return;
      openedSettled = true;
      if (error) rejectOpened(error);
      else resolveOpened({ url: `${baseWs}/api/events.mux` });
    };
    const settleClosed = (error) => {
      if (closedSettled) return;
      closedSettled = true;
      clearTimers();
      if (error) rejectClosed(error);
      else resolveClosed();
    };
    const fail = (error) => {
      clearTimers();
      settleOpened(error);
      reportStatus({ kind: 'error', code: error.code || 'ERR_DSH_EVENTS_TRANSPORT' });
      settleClosed(error);
      if (socket) {
        try { socket.close(); } catch (_e) { /* ignore */ }
      }
    };
    const listen = (target, name, listener) => {
      if (target && typeof target.addEventListener === 'function') target.addEventListener(name, listener);
      else if (target && typeof target.on === 'function') target.on(name, listener);
      else throw dshContract('WebSocket 实现不支持事件监听');
    };

    const deliver = (value) => {
      if (!onEvent || closedSettled) return;
      const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
      if (pendingEvents >= maxPendingEvents
          || pendingEventBytes + bytes > maxPendingEventBytes) {
        fail(dshEventsError('ERR_DSH_EVENTS_CONSUMER_BACKLOG', '事件消费者积压超过安全上限'));
        return;
      }
      pendingEvents += 1;
      pendingEventBytes += bytes;
      consumerQueue = consumerQueue.then(async () => {
        try {
          if (!closedSettled) await onEvent(value);
        } finally {
          pendingEvents -= 1;
          pendingEventBytes -= bytes;
        }
      }).catch((error) => {
        if (!closedSettled) {
          fail(dshEventsError('ERR_DSH_EVENTS_CONSUMER', '事件消费者处理失败', error));
        }
      });
    };

    void ensureVersion().then(() => {
      if (closeRequested) {
        const error = dshEventsError('ERR_DSH_EVENTS_CLOSED', '订阅在打开前已关闭');
        settleOpened(error);
        reportStatus({ kind: 'closed', code: 1000, reason: 'closed-before-open' });
        settleClosed();
        return;
      }
      if (typeof WebSocketImpl !== 'function') {
        fail(dshContract('当前 Node 运行时缺少 WebSocket'));
        return;
      }
      try { socket = new WebSocketImpl(`${baseWs}/api/events.mux`); } catch (error) {
        fail(dshEventsError('ERR_DSH_EVENTS_TRANSPORT', 'WebSocket 创建失败', error));
        return;
      }
      handshakeTimer = setTimeout(() => {
        fail(dshEventsError('ERR_DSH_EVENTS_TIMEOUT', 'WebSocket 握手超时'));
      }, timeoutMs);
      try {
        listen(socket, 'open', () => {
          socketOpened = true;
          if (handshakeTimer) clearTimeout(handshakeTimer);
          handshakeTimer = null;
          reportStatus({ kind: 'open' });
          settleOpened();
        });
        listen(socket, 'message', (message) => {
          try {
            if (!message || typeof message.data !== 'string') {
              throw dshContract('WebSocket 帧必须是文本');
            }
            if (Buffer.byteLength(message.data, 'utf8') > maxFrameBytes) {
              throw dshEventsError('ERR_DSH_EVENTS_FRAME_TOO_LARGE', 'WebSocket 帧超过字节上限');
            }
            let rpc;
            try { rpc = JSON.parse(message.data); } catch (error) {
              throw dshContract('WebSocket 帧不是有效 JSON', error);
            }
            requireRecord(rpc, 'WebSocket envelope');
            if (rpc.type !== 'server-request') throw dshContract('WebSocket envelope.type 必须是 server-request');
            requireString(rpc.rpcId, 'WebSocket envelope.rpcId');
            const method = requireString(rpc.method, 'WebSocket envelope.method');
            if (!DSH_EVENTS_WS_METHODS.has(method)) {
              unknownMethods += 1;
              reportStatus({ kind: 'unknown-method', count: unknownMethods });
              if (unknownMethods > maxUnknownMethods) {
                throw dshContract('WebSocket 未知 method 超过容忍上限');
              }
              return;
            }
            const normalized = normalizeMuxFrame(method, rpc);
            if (normalized && normalized.kind === 'stream-error') {
              reportStatus({ kind: 'remote-error' });
            } else if (normalized) {
              deliver(normalized);
            }
          } catch (error) {
            fail(error && error.code ? error : dshContract('WebSocket 已知帧解析失败', error));
          }
        });
        listen(socket, 'error', (event) => {
          const error = dshEventsError('ERR_DSH_EVENTS_TRANSPORT', 'WebSocket 传输错误', event && event.error);
          fail(error);
        });
        listen(socket, 'close', (event = {}) => {
          clearTimers();
          const code = Number.isInteger(event.code) ? event.code : 0;
          let error = null;
          if (!closeRequested && !socketOpened) {
            error = dshEventsError('ERR_DSH_EVENTS_TRANSPORT', 'WebSocket 在打开前关闭');
          } else if (!closeRequested) {
            error = dshEventsError('ERR_DSH_EVENTS_TRANSPORT', `WebSocket 远端关闭 code=${code}`);
          }
          settleOpened(error || (closeRequested
            ? dshEventsError('ERR_DSH_EVENTS_CLOSED', '订阅已关闭') : null));
          reportStatus({
            kind: 'closed',
            code,
            reason: closeRequested ? 'local-close' : 'remote-close'
          });
          settleClosed(error);
        });
      } catch (error) {
        fail(error && error.code ? error : dshContract('WebSocket 事件监听安装失败', error));
      }
    }, (error) => fail(error));

    const subscription = {
      opened,
      closed,
      close() {
        if (closeRequested || closedSettled) return;
        closeRequested = true;
        clearTimers();
        settleOpened(dshEventsError('ERR_DSH_EVENTS_CLOSED', '订阅已关闭'));
        if (socket) {
          localCloseTimer = setTimeout(() => settleClosed(), Math.min(timeoutMs, 1000));
          try { socket.close(); } catch (error) {
            settleClosed(dshEventsError('ERR_DSH_EVENTS_TRANSPORT', '关闭 WebSocket 失败', error));
            return;
          }
        } else settleClosed();
      }
    };
    subscriptions.add(subscription);
    void closed.then(
      () => subscriptions.delete(subscription),
      () => subscriptions.delete(subscription)
    );
    return subscription;
  }

  function close() {
    if (closePromise) return closePromise;
    adapterClosed = true;
    closePromise = (async () => {
      for (const controller of activeControllers) controller.abort();
      const pending = [];
      for (const subscription of subscriptions) {
        subscription.close();
        pending.push(subscription.closed);
      }
      await Promise.allSettled(pending);
      await Promise.allSettled([...inFlightCalls]);
      activeControllers.clear();
      inFlightCalls.clear();
      subscriptions.clear();
      rawBySessionRef.clear();
      originBySessionRef.clear();
      describePromise = null;
    })();
    return closePromise;
  }

  return Object.freeze({ describe, listSessions, readHistory, subscribe, close });
}

function normalizeCommand(command, platform) {
  const windowsShim = platform === 'win32' && /\.(?:cmd|bat)$/i.test(command.file);
  return { ...command, shell: windowsShim || Boolean(command.shell) };
}

function bundledCommand(config = {}, info = runtimeInfo) {
  const execPath = String(info && info.execPath || '');
  const resourcesPath = String(info && info.resourcesPath || '');
  if (!execPath || !resourcesPath) return null;
  const root = path.join(resourcesPath, 'dsh-runtime');
  const entryPath = path.join(root, ...BUNDLED_DSH_BIN_PARTS);
  const manifestPath = path.join(root, 'manifest.json');
  try {
    if (!fs.statSync(entryPath).isFile()) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const requested = String(config.dshVersion || DEFAULTS.dshVersion).trim();
    if (manifest.dshVersion !== DEFAULTS.dshVersion || requested !== manifest.dshVersion) return null;
    return {
      file: execPath,
      // rc.6 的 HMR 服务明确要求此 Node 启动参数；属于 dsh 启动契约，仅收口在这里。
      args: ['--expose-internals', entryPath, 'web', '--port', configuredPort(config)],
      shell: false,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      bundled: true,
      label: `内置 dsh@${manifest.dshVersion} web --port ${configuredPort(config)}`,
      version: manifest.dshVersion
    };
  } catch (_e) {
    return null;
  }
}

// 决定用什么命令启动后端。第二参数兼容旧的 findCommand 函数，也支持 runtime 注入。
function resolveCommand(config = {}, options = {}) {
  const runtime = typeof options === 'function' ? { findCommand: options } : (options || {});
  const platform = runtime.platform || process.platform;
  const findCommand = runtime.findCommand || ((name) => which(name, runtime));
  if (config.command && String(config.command).trim()) {
    return normalizeCommand({
      file: String(config.command).trim(),
      args: [],
      shell: true,
      label: String(config.command).trim(),
      version: '由自定义命令决定'
    }, platform);
  }
  const bundled = () => bundledCommand(config, runtime.runtimeInfo || runtimeInfo);
  if (config.preferBundled) {
    const preferred = bundled();
    if (preferred) return normalizeCommand(preferred, platform);
  }
  const dsh = findCommand('dsh');
  if (dsh) {
    return normalizeCommand({
      file: dsh,
      args: ['web', '--port', configuredPort(config)],
      shell: false,
      label: `dsh web --port ${configuredPort(config)}`,
      version: 'PATH 中的已安装版本'
    }, platform);
  }
  const npx = findCommand('npx');
  if (npx) {
    const configured = config.dshVersion == null ? '' : String(config.dshVersion).trim();
    const version = configured || DEFAULTS.dshVersion;
    const pkg = `@deepseek-ai/dsh@${version}`;
    return normalizeCommand({
      file: npx,
      args: ['-y', pkg, 'web', '--port', configuredPort(config)],
      shell: false,
      label: `npx -y ${pkg} web --port ${configuredPort(config)}`,
      version
    }, platform);
  }
  const fallback = bundled();
  return fallback ? normalizeCommand(fallback, platform) : null;
}

function envWithPath(baseEnv, pathValue, platform) {
  const env = { ...(baseEnv || {}) };
  const pathKeys = Object.keys(env).filter((key) => key.toUpperCase() === 'PATH');
  const targetKey = platform === 'win32' && pathKeys.length ? pathKeys[0] : 'PATH';
  for (const key of pathKeys) {
    if (key !== targetKey) delete env[key];
  }
  env[targetKey] = pathValue;
  return env;
}

function spawnFile(command, platform) {
  if (platform === 'win32' && command.shell && /\.(?:cmd|bat)$/i.test(command.file)) {
    return `"${command.file}"`;
  }
  return command.file;
}

// 启动后端。runtime 可注入 platform/env/path/spawn，保持纯 Node 可测。
function start(config, hooks = {}, runtime = {}) {
  const { onLine = null, onExit = null } = hooks;
  const platform = runtime.platform || process.platform;
  const baseEnv = runtime.env || process.env;
  const homeDir = runtime.homeDir || envValue(baseEnv, 'USERPROFILE') || HOME;
  const pathValue = runtime.pathValue == null ? fullPath(false, runtime) : String(runtime.pathValue);
  const findCommand = runtime.findCommand || ((name) => which(name, {
    ...runtime,
    platform,
    env: baseEnv,
    homeDir,
    pathValue
  }));
  const command = resolveCommand(config, {
    platform,
    findCommand,
    runtimeInfo: runtime.runtimeInfo
  });
  if (!command) {
    const error = new Error('找不到 dsh / npx（未安装 Node.js？）');
    error.code = 'NODE_NOT_FOUND';
    throw error;
  }
  const spawnImpl = runtime.spawn || spawn;
  const child = spawnImpl(spawnFile(command, platform), command.args, {
    cwd: config.workdir || homeDir,
    env: envWithPath({ ...baseEnv, ...(command.env || {}) }, pathValue, platform),
    shell: command.shell,
    detached: platform !== 'win32',
    windowsHide: platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = {
    child,
    label: command.label,
    version: command.version,
    exited: false,
    code: null
  };

  const wire = (stream) => {
    if (!stream || typeof stream.on !== 'function') return;
    let buf = '';
    stream.on('data', (data) => {
      buf += data.toString();
      let index;
      while ((index = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, index).trimEnd();
        buf = buf.slice(index + 1);
        if (line && onLine) onLine(line);
      }
    });
  };
  wire(child.stdout);
  wire(child.stderr);

  let exitReported = false;
  const reportExit = (code, signal) => {
    if (exitReported) return;
    exitReported = true;
    state.exited = true;
    state.code = code;
    if (onExit) onExit(code, signal);
  };
  child.on('exit', reportExit);
  child.on('error', (error) => {
    if (onLine) onLine('[spawn error] ' + error.message);
    reportExit(-1, null);
  });
  return state;
}

// 只描述停止步骤，不碰进程。执行器与平台行为因此可以分开验证。
function killPlan(pid, platform = process.platform, graceMs = 4000) {
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError('pid 必须是正整数');
  if (platform === 'win32') {
    return [
      { action: 'spawn', file: 'taskkill', args: ['/PID', String(pid), '/T'] },
      { action: 'wait', ms: graceMs },
      { action: 'spawn', file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
    ];
  }
  return [
    { action: 'signal', target: 'group', pid, signal: 'SIGTERM' },
    { action: 'wait', ms: graceMs },
    { action: 'signal', target: 'group', pid, signal: 'SIGKILL' }
  ];
}

function runProcess(command, runtime) {
  return new Promise((resolve) => {
    let child;
    try {
      child = runtime.spawn(command.file, command.args, {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (_e) {
      resolve();
      return;
    }
    if (!child || typeof child.once !== 'function') {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('close', finish);
    child.once('error', finish);
  });
}

async function executeKillPlan(state, plan, opts = {}) {
  const runtime = {
    spawn: opts.spawn || spawn,
    kill: opts.kill || process.kill
  };

  const waitUntilDelayOrExit = (ms) => new Promise((resolve, reject) => {
    if (state.exited || ms <= 0) {
      resolve();
      return;
    }

    const child = state.child;
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (child && typeof child.removeListener === 'function') {
        child.removeListener('exit', onExit);
        child.removeListener('error', onExit);
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = () => {
      state.exited = true;
      finish();
    };

    if (child && typeof child.once === 'function') {
      child.once('exit', onExit);
      child.once('error', onExit);
    }
    if (typeof opts.wait === 'function') {
      Promise.resolve().then(() => opts.wait(ms)).then(finish, fail);
    } else {
      timer = setTimeout(finish, ms);
    }
    // 防止退出事件恰好发生在监听器注册之前。
    if (state.exited) finish();
  });

  for (const step of plan) {
    if (state.exited) break;
    if (step.action === 'wait') {
      await waitUntilDelayOrExit(step.ms);
      continue;
    }
    if (step.action === 'spawn') {
      await runProcess(step, runtime);
      continue;
    }
    if (step.action === 'signal') {
      try {
        runtime.kill(step.target === 'group' ? -step.pid : step.pid, step.signal);
      } catch (_e) {
        try { state.child.kill(step.signal); } catch (_e2) { /* ignore */ }
      }
    }
  }
}

// 按 killPlan 温和停止，宽限期后强杀；执行细节保持薄层。
async function stop(state, opts = {}) {
  if (!state || !state.child || state.exited) return;
  const platform = opts.platform || process.platform;
  const graceMs = opts.graceMs == null ? 4000 : opts.graceMs;
  const settleMs = opts.settleMs == null ? 300 : opts.settleMs;
  const plan = killPlan(state.child.pid, platform, graceMs);
  await executeKillPlan(state, plan, opts);
  if (settleMs > 0 && !state.exited) {
    await executeKillPlan(state, [{ action: 'wait', ms: settleMs }], opts);
  }
}

module.exports = {
  setRuntimeInfo,
  fullPath,
  execCandidates,
  which,
  isPortOpen,
  waitForPort,
  classifyHarnessResponse,
  probeHarness,
  proveManagedWorkdir,
  DSH_PROMPT_LIMITS,
  createDshPromptAdapter,
  createDshEventsAdapter,
  bundledCommand,
  resolveCommand,
  start,
  killPlan,
  executeKillPlan,
  stop,
  loginShellPath
};
