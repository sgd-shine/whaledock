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
const { CONTRACT_VERSION: CONTEXT_BRIDGE_PROTOCOL } = require('./context-bridge');
const { compareVersions } = require('./update');
const CONTEXT_POC_BASELINE_RAW = require('./context-poc-baseline.json');

const HOME = os.homedir();
const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const BUNDLED_DSH_BIN_PARTS = [
  'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'
];
// rc.8 起 dsh web 默认打开系统浏览器；旧版不认识 --no-open。
// 版本阈值、探针与最终参数必须都留在 backend，不能散到 main/UI。
const DSH_NO_OPEN_MIN_VERSION = '0.1.0-rc.8';
const DSH_WINDOWS_SHIM_MAX_BYTES = 16 * 1024;
const DSH_PACKAGE_JSON_MAX_BYTES = 64 * 1024;
const DSH_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const CONTEXT_POC_PACKAGE = '@whaledock/context-bridge-poc';
const CONTEXT_POC_CHANNEL = '/whaledock.context';
const CONTEXT_POC_SOURCE_FILES = Object.freeze([
  'context-bridge.patch.yml',
  'FORK-NOTICE.md',
  'plugin/package.json',
  'plugin/lib/index.js',
  'plugin/lib/client.js',
  'forks/ui-layout/package.json',
  'forks/ui-layout/LICENSE',
  'forks/ui-layout/lib/index.js',
  'forks/ui-layout/lib/invariant.js',
  'forks/ui-layout/lib/client.js',
  'forks/ui-conversation/package.json',
  'forks/ui-conversation/LICENSE',
  'forks/ui-conversation/lib/index.js',
  'forks/ui-conversation/lib/invariant.js',
  'forks/ui-conversation/lib/client.js'
]);
const CONTEXT_POC_LIMITS = Object.freeze({
  maxAssetFileBytes: 2 * 1024 * 1024,
  maxAssetBytes: 8 * 1024 * 1024,
  maxRequestBytes: 8 * 1024,
  maxResponseBytes: 64 * 1024,
  timeoutMs: 3000
});
const CONTEXT_POC_MARKER_MAX_BYTES = 4096;
const CONTEXT_POC_RUN_SCAN_MAX_ENTRIES = 1024;
const CONTEXT_POC_ENDPOINTS = new Set([
  'handshake', 'selection/resolve', 'context/stage', 'events/read',
  'ui/preferences/read', 'ui/preferences/sync', 'ui/preferences/settle'
]);
const CONTEXT_POC_TOKEN_RE = /^[a-f0-9]{64}$/;
const CONTEXT_POC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTEXT_POC_PACKAGE_LINKS = Object.freeze([
  Object.freeze({ scope: '@whaledock', name: 'context-bridge-poc' }),
  Object.freeze({ scope: '@deepseek-ai', name: 'dsh-client-ui-layout' }),
  Object.freeze({ scope: '@deepseek-ai', name: 'dsh-client-ui-conversation' })
]);
// rc.2 默认组合会在 DSH_HOME 下直接读取或写入这些已知入口。启动前只做
// lstat 形状检查，不读取内容、不跟随链接，也不删除用户数据。
const CONTEXT_POC_DATA_DIRECTORIES = Object.freeze([
  'profiles', 'sessions', 'attachments', 'storages', '.agent-presets',
  'skills', 'llm-deepseek'
]);
const CONTEXT_POC_DATA_FILES = Object.freeze([
  'settings.yaml', '.credentials.yaml', '.env', 'cordis.patch.yml',
  'AGENTS.md', '.anonymous-user-id'
]);
const CONTEXT_POC_PROFILE_FILES = Object.freeze([
  'package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml',
  'cordis.yml', 'cordis.snapshot.yml'
]);
const CONTEXT_POC_PROFILE_SCOPE_SCAN_MAX_ENTRIES = 1024;
const CONTEXT_POC_BASELINE = contextPocValidateBaseline(CONTEXT_POC_BASELINE_RAW);
let runtimeInfo = {
  execPath: '',
  resourcesPath: '',
  userDataPath: '',
  contextPocAssetRoot: '',
  contextPocEnabled: false
};

function setRuntimeInfo(info = {}) {
  runtimeInfo = {
    execPath: String(info.execPath || ''),
    resourcesPath: String(info.resourcesPath || ''),
    userDataPath: String(info.userDataPath || ''),
    contextPocAssetRoot: String(info.contextPocAssetRoot || ''),
    contextPocEnabled: info.contextPocEnabled === true
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

function dshPackageContract(message) {
  const error = new Error(message);
  error.code = 'ERR_DSH_PACKAGE_CONTRACT';
  return error;
}

// 根包版本证明不做 trim、v 前缀移除或 SemVer 优先级比较。只有调用者给出的
// 精确期望版本与已持有的进程身份逐字节相等才算命中；省略期望版本时仍锁生产默认。
function hasExactDshPackageProof(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw dshPackageContract('dsh 根包版本证明参数必须是对象');
  }
  const expected = options.expectedPackageVersion === undefined
    ? DSH_CONTRACT.packageVersion : options.expectedPackageVersion;
  if (typeof expected !== 'string' || !expected || expected.length > 64
      || expected.trim() !== expected || !DSH_SEMVER_RE.test(expected)) {
    throw dshPackageContract('expectedPackageVersion 必须是精确 SemVer');
  }
  try {
    compareVersions(expected, expected);
  } catch (_error) {
    throw dshPackageContract('expectedPackageVersion 必须是精确 SemVer');
  }
  return options.packageVersionProof === expected;
}

// ---------- v0.10 context bridge 资格与假 transport seam ----------
//
// 这里只判断调用者已经持有的本地事实，并提供一个可注入的握手缝。它不定义
// 真实 dsh RPC、不访问网络，也不把 context 方法加入 prompt adapter 白名单。
const CONTEXT_BRIDGE_RESULTS = Object.freeze({
  disabled: Object.freeze({ eligible: false, reason: 'disabled' }),
  external: Object.freeze({ eligible: false, reason: 'external-unproven' }),
  version: Object.freeze({ eligible: false, reason: 'unsupported-version' }),
  unavailable: Object.freeze({ eligible: false, reason: 'bridge-unavailable' }),
  ready: Object.freeze({ eligible: true, reason: 'ready' })
});
const CONTEXT_BRIDGE_HANDSHAKE_REQUEST = Object.freeze({
  type: 'handshake',
  protocol: CONTEXT_BRIDGE_PROTOCOL
});

function contextPocPathApi(platform, injected) {
  return injected || (platform === 'win32' ? path.win32 : path.posix);
}

function contextPocPlan(command, info = runtimeInfo, runtime = {}) {
  const facts = info && typeof info === 'object' && !Array.isArray(info) ? info : {};
  if (facts.contextPocEnabled !== true) {
    return Object.freeze({ eligible: false, reason: 'disabled' });
  }
  if (!command || command.bundled !== true
      || !hasExactDshPackageProof({ packageVersionProof: command.packageVersionProof })) {
    return Object.freeze({ eligible: false, reason: 'bridge-unavailable' });
  }
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  const sourceRoot = String(facts.contextPocAssetRoot || '');
  const userDataPath = String(facts.userDataPath || '');
  const resourcesPath = String(facts.resourcesPath || '');
  if (!sourceRoot || !userDataPath || !resourcesPath
      || !pathImpl.isAbsolute(sourceRoot) || !pathImpl.isAbsolute(userDataPath)
      || !pathImpl.isAbsolute(resourcesPath) || sourceRoot.includes('\0')
      || userDataPath.includes('\0') || resourcesPath.includes('\0')) {
    return Object.freeze({ eligible: false, reason: 'bridge-unavailable' });
  }
  return Object.freeze({
    eligible: true,
    reason: 'ready',
    sourceRoot: pathImpl.resolve(sourceRoot),
    userDataPath: pathImpl.resolve(userDataPath),
    runtimeModulesPath: pathImpl.resolve(
      resourcesPath, 'dsh-runtime', 'node_modules'
    ),
    platform
  });
}

function contextPocRelativeTarget(relative) {
  if (relative === 'context-bridge.patch.yml') return 'context-bridge.patch.yml';
  if (relative === 'FORK-NOTICE.md') return 'FORK-NOTICE.md';
  if (relative.startsWith('forks/ui-layout/')) {
    return path.posix.join(
      'packages', '@deepseek-ai',
      'dsh-client-ui-layout', relative.slice('forks/ui-layout/'.length)
    );
  }
  if (relative.startsWith('forks/ui-conversation/')) {
    return path.posix.join(
      'packages', '@deepseek-ai',
      'dsh-client-ui-conversation', relative.slice('forks/ui-conversation/'.length)
    );
  }
  return path.posix.join(
    'packages', '@whaledock',
    'context-bridge-poc', relative.slice('plugin/'.length)
  );
}

function contextPocSha256(data, cryptoImpl = crypto) {
  return cryptoImpl.createHash('sha256').update(data).digest('hex');
}

function contextPocManifestDigest(files) {
  return contextPocSha256(files.map((file) => (
    `${file.path}\0${file.size}\0${file.sha256}`
  )).join('\n'), crypto);
}

function contextPocValidateBaseline(value) {
  const hashPattern = /^[a-f0-9]{64}$/;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'digest,files,package,schema,totalBytes'
      || value.schema !== 1 || value.package !== CONTEXT_POC_PACKAGE
      || !Array.isArray(value.files)
      || value.files.length !== CONTEXT_POC_SOURCE_FILES.length
      || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 1
      || value.totalBytes > CONTEXT_POC_LIMITS.maxAssetBytes
      || !hashPattern.test(value.digest || '')) {
    throw new Error('context POC fixed baseline is invalid');
  }
  const files = [];
  let totalBytes = 0;
  for (let index = 0; index < CONTEXT_POC_SOURCE_FILES.length; index += 1) {
    const file = value.files[index];
    if (!file || typeof file !== 'object' || Array.isArray(file)
        || Object.keys(file).sort().join(',') !== 'path,sha256,size'
        || file.path !== CONTEXT_POC_SOURCE_FILES[index]
        || !Number.isSafeInteger(file.size) || file.size < 1
        || file.size > CONTEXT_POC_LIMITS.maxAssetFileBytes
        || !hashPattern.test(file.sha256 || '')) {
      throw new Error('context POC fixed baseline file is invalid');
    }
    totalBytes += file.size;
    if (totalBytes > CONTEXT_POC_LIMITS.maxAssetBytes) {
      throw new Error('context POC fixed baseline exceeds total byte limit');
    }
    files.push(Object.freeze({
      path: file.path,
      size: file.size,
      sha256: file.sha256
    }));
  }
  if (totalBytes !== value.totalBytes
      || contextPocManifestDigest(files) !== value.digest) {
    throw new Error('context POC fixed baseline digest is invalid');
  }
  return Object.freeze({
    schema: 1,
    package: CONTEXT_POC_PACKAGE,
    files: Object.freeze(files),
    totalBytes,
    digest: value.digest
  });
}

function contextPocReadAssets(plan, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(plan.platform, runtime.pathModule);
  const rootStat = fsImpl.lstatSync(plan.sourceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('context POC source root is not a regular directory');
  }
  const exactEntries = (directory, allowed) => {
    const names = fsImpl.readdirSync(directory);
    if (names.length !== allowed.size || names.some((name) => !allowed.has(name))) {
      throw new Error('context POC source contains unknown entries');
    }
  };
  exactEntries(plan.sourceRoot, new Set([
    'context-bridge.patch.yml', 'FORK-NOTICE.md', 'plugin', 'forks'
  ]));
  const pluginRoot = pathImpl.join(plan.sourceRoot, 'plugin');
  contextPocAssertDirectory(pluginRoot, fsImpl);
  exactEntries(pluginRoot, new Set(['package.json', 'lib']));
  const sourceLibRoot = pathImpl.join(pluginRoot, 'lib');
  contextPocAssertDirectory(sourceLibRoot, fsImpl);
  exactEntries(sourceLibRoot, new Set(['index.js', 'client.js']));
  const forksRoot = pathImpl.join(plan.sourceRoot, 'forks');
  contextPocAssertDirectory(forksRoot, fsImpl);
  exactEntries(forksRoot, new Set(['ui-layout', 'ui-conversation']));
  for (const packageName of ['ui-layout', 'ui-conversation']) {
    const forkRoot = pathImpl.join(forksRoot, packageName);
    contextPocAssertDirectory(forkRoot, fsImpl);
    exactEntries(forkRoot, new Set(['package.json', 'LICENSE', 'lib']));
    const forkLibRoot = pathImpl.join(forkRoot, 'lib');
    contextPocAssertDirectory(forkLibRoot, fsImpl);
    exactEntries(forkLibRoot, new Set(['index.js', 'invariant.js', 'client.js']));
  }
  const assets = [];
  let total = 0;
  for (let index = 0; index < CONTEXT_POC_SOURCE_FILES.length; index += 1) {
    const relative = CONTEXT_POC_SOURCE_FILES[index];
    const trusted = CONTEXT_POC_BASELINE.files[index];
    const source = pathImpl.join(plan.sourceRoot, ...relative.split('/'));
    const stat = fsImpl.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size)
        || stat.size < 1 || stat.size > CONTEXT_POC_LIMITS.maxAssetFileBytes) {
      throw new Error('context POC asset is not a bounded regular file');
    }
    const data = fsImpl.readFileSync(source);
    if (data.length !== stat.size) throw new Error('context POC asset changed while reading');
    total += data.length;
    if (total > CONTEXT_POC_LIMITS.maxAssetBytes) {
      throw new Error('context POC assets exceed total byte limit');
    }
    // 固定信任根禁止走可注入摘要实现；runtime 注入只用于文件系统/路径测试。
    const sha256 = contextPocSha256(data, crypto);
    if (trusted.path !== relative || trusted.size !== data.length
        || trusted.sha256 !== sha256) {
      throw new Error('context POC asset does not match fixed baseline');
    }
    assets.push(Object.freeze({
      relative,
      targetRelative: contextPocRelativeTarget(relative),
      data,
      sha256
    }));
  }
  if (total !== CONTEXT_POC_BASELINE.totalBytes) {
    throw new Error('context POC asset total does not match fixed baseline');
  }
  return Object.freeze({
    assets: Object.freeze(assets),
    digest: CONTEXT_POC_BASELINE.digest
  });
}

function contextPocAssertDirectory(directory, fsImpl) {
  const stat = fsImpl.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('context POC path is not an owned regular directory');
  }
}

function contextPocEnsureDirectory(directory, fsImpl) {
  try { fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  catch (error) {
    if (error && error.code !== 'EEXIST') throw error;
  }
  contextPocAssertDirectory(directory, fsImpl);
}

function contextPocEnsureChildDirectory(parent, name, fsImpl, pathImpl) {
  contextPocAssertDirectory(parent, fsImpl);
  const child = pathImpl.join(parent, name);
  try { fsImpl.mkdirSync(child, { mode: 0o700 }); }
  catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  }
  contextPocAssertDirectory(child, fsImpl);
  return child;
}

function contextPocPackageLinkPlan(assetRoot, homePath, runtime = {}) {
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  if (typeof assetRoot !== 'string' || typeof homePath !== 'string'
      || assetRoot.includes('\0') || homePath.includes('\0')
      || !pathImpl.isAbsolute(assetRoot) || !pathImpl.isAbsolute(homePath)) {
    throw new Error('context POC package link roots invalid');
  }
  const assets = pathImpl.resolve(assetRoot);
  const home = pathImpl.resolve(homePath);
  return Object.freeze(CONTEXT_POC_PACKAGE_LINKS.map(({ scope, name }) => Object.freeze({
    linkPath: pathImpl.join(home, 'profiles', 'web', 'node_modules', scope, name),
    targetPath: pathImpl.join(assets, 'packages', scope, name),
    type: platform === 'win32' ? 'junction' : 'dir'
  })));
}

function contextPocResolverLinkPlan(assetRoot, runtimeModulesPath, runtime = {}) {
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  if (typeof assetRoot !== 'string' || typeof runtimeModulesPath !== 'string'
      || assetRoot.includes('\0') || runtimeModulesPath.includes('\0')
      || !pathImpl.isAbsolute(assetRoot)
      || !pathImpl.isAbsolute(runtimeModulesPath)) {
    throw new Error('context POC resolver link roots invalid');
  }
  return Object.freeze({
    linkPath: pathImpl.join(pathImpl.resolve(assetRoot), 'node_modules'),
    targetPath: pathImpl.resolve(runtimeModulesPath),
    type: platform === 'win32' ? 'junction' : 'dir'
  });
}

function contextPocPathEqual(left, right, platform, pathImpl) {
  const normalize = (value) => {
    const resolved = pathImpl.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function contextPocUnsafeRuntime(error, message) {
  const failure = error instanceof Error ? error : new Error(message);
  failure.code = 'CONTEXT_POC_RUNTIME_UNSAFE';
  return failure;
}

function contextPocAssertRuntimeModules(runtimeModulesPath, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  if (typeof runtimeModulesPath !== 'string' || runtimeModulesPath.includes('\0')
      || !pathImpl.isAbsolute(runtimeModulesPath)) {
    throw contextPocUnsafeRuntime(null, 'context POC runtime modules path is unsafe');
  }
  const resolved = pathImpl.resolve(runtimeModulesPath);
  let stat;
  try { stat = fsImpl.lstatSync(resolved); }
  catch (error) {
    throw contextPocUnsafeRuntime(error, 'context POC runtime modules path is unsafe');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw contextPocUnsafeRuntime(null, 'context POC runtime modules path is unsafe');
  }
  return resolved;
}

function contextPocCreateResolverLink(assetRoot, runtimeModulesPath, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  const targetPath = contextPocAssertRuntimeModules(runtimeModulesPath, {
    ...runtime, platform, pathModule: pathImpl
  });
  const link = contextPocResolverLinkPlan(assetRoot, targetPath, {
    platform, pathModule: pathImpl
  });
  let existing;
  try { existing = fsImpl.lstatSync(link.linkPath); }
  catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw contextPocUnsafeRuntime(error, 'context POC resolver link is unsafe');
    }
  }
  if (existing) {
    throw contextPocUnsafeRuntime(null, 'context POC resolver link path is occupied');
  }
  try { fsImpl.symlinkSync(link.targetPath, link.linkPath, link.type); }
  catch (error) {
    throw contextPocUnsafeRuntime(error, 'context POC resolver link cannot be created');
  }
  return link;
}

function contextPocVerifyResolverLink(assetRoot, runtimeModulesPath, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  const targetPath = contextPocAssertRuntimeModules(runtimeModulesPath, {
    ...runtime, platform, pathModule: pathImpl
  });
  const link = contextPocResolverLinkPlan(assetRoot, targetPath, {
    platform, pathModule: pathImpl
  });
  let stat;
  try { stat = fsImpl.lstatSync(link.linkPath); }
  catch (error) {
    throw contextPocUnsafeRuntime(error, 'context POC resolver link is unsafe');
  }
  if (!stat.isSymbolicLink()) {
    throw contextPocUnsafeRuntime(null, 'context POC resolver link is unsafe');
  }
  let linkedTarget;
  let expectedTarget;
  try {
    linkedTarget = fsImpl.realpathSync(link.linkPath);
    expectedTarget = fsImpl.realpathSync(targetPath);
  } catch (error) {
    throw contextPocUnsafeRuntime(error, 'context POC resolver link is unsafe');
  }
  if (!contextPocPathEqual(linkedTarget, expectedTarget, platform, pathImpl)) {
    throw contextPocUnsafeRuntime(null, 'context POC resolver link target mismatch');
  }
  return link;
}

function contextPocPrepareDataHome(plan, runtime = {}) {
  if (!plan || plan.eligible !== true) throw new Error('context POC plan is not eligible');
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(plan.platform, runtime.pathModule);
  contextPocAssertDirectory(plan.userDataPath, fsImpl);
  const contextRoot = contextPocEnsureChildDirectory(
    plan.userDataPath, 'context-poc', fsImpl, pathImpl
  );
  const versionRoot = contextPocEnsureChildDirectory(contextRoot, 'v1', fsImpl, pathImpl);
  const homePath = contextPocEnsureChildDirectory(versionRoot, 'dsh-home', fsImpl, pathImpl);
  return Object.freeze({ contextRoot, versionRoot, homePath });
}

function contextPocUnsafeHome(error, message) {
  const failure = error instanceof Error ? error : new Error(message);
  failure.code = 'CONTEXT_POC_HOME_UNSAFE';
  return failure;
}

function contextPocPreparePersistentHome(versionRoot, assetRoot, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  let current;
  try {
    current = contextPocEnsureChildDirectory(versionRoot, 'dsh-home', fsImpl, pathImpl);
  } catch (error) {
    throw contextPocUnsafeHome(error, 'context POC data home is unsafe');
  }
  const homePath = current;
  try {
    for (const name of ['profiles', 'web', 'node_modules']) {
      current = contextPocEnsureChildDirectory(current, name, fsImpl, pathImpl);
    }
    for (const scope of ['@whaledock', '@deepseek-ai']) {
      contextPocEnsureChildDirectory(current, scope, fsImpl, pathImpl);
    }
  } catch (error) {
    throw contextPocUnsafeHome(error, 'context POC profile ancestors are unsafe');
  }
  const links = contextPocPackageLinkPlan(assetRoot, homePath, {
    platform, pathModule: pathImpl
  });
  for (const link of links) {
    contextPocAssertDirectory(link.targetPath, fsImpl);
    let existing = null;
    try { existing = fsImpl.lstatSync(link.linkPath); }
    catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      const stat = existing;
      if (!stat.isSymbolicLink()) {
        throw contextPocUnsafeHome(null, 'context POC package link path is occupied');
      }
      // 只解除链接自身；无论旧链接指向哪里，都不得遍历或删除目标。
      try { fsImpl.unlinkSync(link.linkPath); }
      catch (error) {
        throw contextPocUnsafeHome(error, 'context POC package link cannot be replaced');
      }
    }
    try { fsImpl.symlinkSync(link.targetPath, link.linkPath, link.type); }
    catch (error) {
      throw contextPocUnsafeHome(error, 'context POC package link cannot be created');
    }
    const linkedStat = fsImpl.lstatSync(link.linkPath);
    if (!linkedStat.isSymbolicLink()) {
      throw new Error('context POC package link was not created');
    }
    const linkedTarget = fsImpl.realpathSync(link.linkPath);
    const expectedTarget = fsImpl.realpathSync(link.targetPath);
    if (!contextPocPathEqual(linkedTarget, expectedTarget, platform, pathImpl)) {
      throw new Error('context POC package link target mismatch');
    }
  }
  return Object.freeze({ homePath, links });
}

// 受管静态资产不可用时可以退回 rc.2 原生页面，但必须先解除 profile-local
// shadow。这里只检查固定祖先并 unlink 三个链接本身；绝不解析、遍历或删除
// 链接目标。任一祖先/占位不是普通目录或符号链接时，宁可拒绝启动。
function contextPocClearPersistentPackageLinks(homePath, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  if (typeof homePath !== 'string' || homePath.includes('\0')
      || !pathImpl.isAbsolute(homePath)) {
    throw contextPocUnsafeHome(null, 'context POC data home is unsafe');
  }
  const optionalDirectory = (directory) => {
    let stat;
    try { stat = fsImpl.lstatSync(directory); }
    catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw contextPocUnsafeHome(error, 'context POC profile ancestors are unsafe');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw contextPocUnsafeHome(null, 'context POC profile ancestors are unsafe');
    }
    return true;
  };
  let current = pathImpl.resolve(homePath);
  if (!optionalDirectory(current)) {
    throw contextPocUnsafeHome(null, 'context POC data home is unsafe');
  }
  for (const name of ['profiles', 'web', 'node_modules']) {
    current = pathImpl.join(current, name);
    if (!optionalDirectory(current)) return 0;
  }
  const removable = [];
  for (const { scope, name } of CONTEXT_POC_PACKAGE_LINKS) {
    const scopePath = pathImpl.join(current, scope);
    if (!optionalDirectory(scopePath)) continue;
    const linkPath = pathImpl.join(scopePath, name);
    let stat;
    try { stat = fsImpl.lstatSync(linkPath); }
    catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw contextPocUnsafeHome(error, 'context POC package link is unsafe');
    }
    if (!stat.isSymbolicLink()) {
      throw contextPocUnsafeHome(null, 'context POC package link path is occupied');
    }
    removable.push(linkPath);
  }
  for (const linkPath of removable) {
    try {
      const stat = fsImpl.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        throw contextPocUnsafeHome(null, 'context POC package link changed while clearing');
      }
      fsImpl.unlinkSync(linkPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      if (error && error.code === 'CONTEXT_POC_HOME_UNSAFE') throw error;
      throw contextPocUnsafeHome(error, 'context POC package link cannot be cleared');
    }
  }
  return removable.length;
}

function contextPocValidatePersistentDataRoot(homePath, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  if (typeof homePath !== 'string' || homePath.includes('\0')
      || !pathImpl.isAbsolute(homePath)) {
    throw contextPocUnsafeHome(null, 'context POC data home is unsafe');
  }
  const resolved = pathImpl.resolve(homePath);
  try { contextPocAssertDirectory(resolved, fsImpl); }
  catch (error) { throw contextPocUnsafeHome(error, 'context POC data home is unsafe'); }
  const optionalShape = (entry, kind) => {
    let stat;
    try { stat = fsImpl.lstatSync(entry); }
    catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw contextPocUnsafeHome(error, 'context POC data entry is unsafe');
    }
    const valid = kind === 'directory'
      ? stat.isDirectory() && !stat.isSymbolicLink()
      : stat.isFile() && !stat.isSymbolicLink();
    if (!valid) throw contextPocUnsafeHome(null, 'context POC data entry is unsafe');
    return true;
  };
  for (const name of CONTEXT_POC_DATA_DIRECTORIES) {
    optionalShape(pathImpl.join(resolved, name), 'directory');
  }
  for (const name of CONTEXT_POC_DATA_FILES) {
    optionalShape(pathImpl.join(resolved, name), 'file');
  }
  const validateModuleScopes = (modulesRoot) => {
    if (!optionalShape(modulesRoot, 'directory')) return;
    let names;
    try { names = fsImpl.readdirSync(modulesRoot); }
    catch (error) {
      throw contextPocUnsafeHome(error, 'context POC profile modules are unsafe');
    }
    if (names.length > CONTEXT_POC_PROFILE_SCOPE_SCAN_MAX_ENTRIES) {
      throw contextPocUnsafeHome(null, 'context POC profile modules are unsafe');
    }
    for (const name of names) {
      if (!name.startsWith('@')) continue;
      optionalShape(pathImpl.join(modulesRoot, name), 'directory');
    }
  };
  const profiles = pathImpl.join(resolved, 'profiles');
  if (optionalShape(profiles, 'directory')) {
    const webProfile = pathImpl.join(profiles, 'web');
    if (optionalShape(webProfile, 'directory')) {
      for (const name of CONTEXT_POC_PROFILE_FILES) {
        optionalShape(pathImpl.join(webProfile, name), 'file');
      }
      validateModuleScopes(pathImpl.join(webProfile, 'node_modules'));
    }
    // rc.2 会在这里为整套安装闭包维护大量 package symlink；link 本身
    // 可由上游原子替换，但写入它们的普通目录与所有 scope 父目录不能是链接。
    validateModuleScopes(pathImpl.join(profiles, 'node_modules'));
  }
  const attachments = pathImpl.join(resolved, 'attachments');
  if (optionalShape(attachments, 'directory')) {
    optionalShape(pathImpl.join(attachments, 'v1'), 'directory');
  }
  return true;
}

function contextPocWalkAssetTree(root, runtime, visit) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  const pathImpl = contextPocPathApi(platform, runtime.pathModule);
  const assetRoot = pathImpl.resolve(root);
  const resolverLink = pathImpl.join(assetRoot, 'node_modules');
  const walk = (entry) => {
    const stat = fsImpl.lstatSync(entry);
    if (stat.isSymbolicLink()) {
      // 唯一例外是根级、固定名字的 runtime resolver。只 lstat 后跳过，
      // 绝不递归或 chmod（两者都可能跟随到签名包外的真实目标）。
      if (contextPocPathEqual(entry, resolverLink, platform, pathImpl)) return;
      throw new Error('context POC asset tree contains non-regular entry');
    }
    if (!stat.isDirectory() && !stat.isFile()) {
      throw new Error('context POC asset tree contains non-regular entry');
    }
    if (stat.isDirectory()) {
      for (const name of fsImpl.readdirSync(entry)) {
        walk(pathImpl.join(entry, name));
      }
    }
    visit(entry, stat);
  };
  walk(assetRoot);
}

function contextPocSealAssetRoot(root, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  contextPocWalkAssetTree(root, runtime, (entry, stat) => {
    fsImpl.chmodSync(entry, stat.isDirectory() ? 0o500 : 0o400);
  });
}

function contextPocVerifyAssetSealed(root, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const platform = runtime.platform || process.platform;
  contextPocWalkAssetTree(root, runtime, (_entry, stat) => {
    if (platform !== 'win32' && (stat.mode & 0o222) !== 0) {
      throw new Error('context POC asset root is not read-only');
    }
  });
}

function contextPocMakeTreeRemovable(root, fsImpl) {
  const stat = fsImpl.lstatSync(root);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fsImpl.chmodSync(root, 0o700);
    for (const name of fsImpl.readdirSync(root)) {
      contextPocMakeTreeRemovable(path.join(root, name), fsImpl);
    }
  } else if (stat.isFile()) {
    fsImpl.chmodSync(root, 0o600);
  }
}

function contextPocVerifyTarget(root, inventory, expectedOwner, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(inventory.platform || process.platform, runtime.pathModule);
  contextPocAssertDirectory(root, fsImpl);
  const markerPath = pathImpl.join(root, '.whaledock-context-poc.json');
  const markerStat = fsImpl.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()
      || markerStat.size < 1
      || markerStat.size > CONTEXT_POC_MARKER_MAX_BYTES) {
    throw new Error('context POC marker invalid');
  }
  const marker = JSON.parse(fsImpl.readFileSync(markerPath, 'utf8'));
  if (!marker || Object.keys(marker).sort().join(',') !== 'digest,ownerToken,package,schema'
      || marker.schema !== 1 || marker.digest !== inventory.digest
      || marker.package !== CONTEXT_POC_PACKAGE
      || typeof expectedOwner !== 'string' || !CONTEXT_POC_TOKEN_RE.test(expectedOwner)
      || marker.ownerToken !== expectedOwner) throw new Error('context POC marker mismatch');

  const exactEntries = (directory, allowed) => {
    const names = fsImpl.readdirSync(directory);
    if (names.length !== allowed.size || names.some((name) => !allowed.has(name))) {
      throw new Error('context POC staged profile contains unknown entries');
    }
  };
  exactEntries(root, new Set([
    '.whaledock-context-poc.json', 'context-bridge.patch.yml', 'FORK-NOTICE.md',
    'packages', 'node_modules'
  ]));
  contextPocVerifyResolverLink(root, inventory.runtimeModulesPath, {
    ...runtime,
    platform: inventory.platform || process.platform,
    pathModule: pathImpl
  });
  let sealedRoot = pathImpl.join(root, 'packages');
  contextPocAssertDirectory(sealedRoot, fsImpl);
  exactEntries(sealedRoot, new Set(['@whaledock', '@deepseek-ai']));
  const whaledockScope = pathImpl.join(sealedRoot, '@whaledock');
  contextPocAssertDirectory(whaledockScope, fsImpl);
  exactEntries(whaledockScope, new Set(['context-bridge-poc']));
  const deepseekScope = pathImpl.join(sealedRoot, '@deepseek-ai');
  contextPocAssertDirectory(deepseekScope, fsImpl);
  exactEntries(deepseekScope, new Set([
    'dsh-client-ui-layout', 'dsh-client-ui-conversation'
  ]));

  for (const asset of inventory.assets) {
    const target = pathImpl.join(root, ...asset.targetRelative.split('/'));
    const stat = fsImpl.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()
        || stat.size !== asset.data.length) throw new Error('context POC staged asset invalid');
    const data = fsImpl.readFileSync(target);
    if (contextPocSha256(data, crypto) !== asset.sha256) {
      throw new Error('context POC staged asset hash mismatch');
    }
  }

  let packageRoot = root;
  for (const part of [
    'packages', '@whaledock', 'context-bridge-poc'
  ]) {
    packageRoot = pathImpl.join(packageRoot, part);
    contextPocAssertDirectory(packageRoot, fsImpl);
  }
  const allowed = new Set(['package.json', 'lib']);
  if (fsImpl.readdirSync(packageRoot).some((name) => !allowed.has(name))) {
    throw new Error('context POC plugin directory contains unknown entries');
  }
  const libRoot = pathImpl.join(packageRoot, 'lib');
  contextPocAssertDirectory(libRoot, fsImpl);
  const allowedLib = new Set(['index.js', 'client.js']);
  if (fsImpl.readdirSync(libRoot).some((name) => !allowedLib.has(name))) {
    throw new Error('context POC plugin lib contains unknown entries');
  }
  for (const forkName of ['dsh-client-ui-layout', 'dsh-client-ui-conversation']) {
    const forkRoot = pathImpl.join(
      root, 'packages', '@deepseek-ai', forkName
    );
    contextPocAssertDirectory(forkRoot, fsImpl);
    exactEntries(forkRoot, new Set(['package.json', 'LICENSE', 'lib']));
    const forkLibRoot = pathImpl.join(forkRoot, 'lib');
    contextPocAssertDirectory(forkLibRoot, fsImpl);
    exactEntries(forkLibRoot, new Set(['index.js', 'invariant.js', 'client.js']));
  }
  return true;
}

function contextPocOwnTemp(tempRoot, parent, fsImpl, pathImpl) {
  try {
    const relative = pathImpl.relative(parent, tempRoot);
    if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)
        || relative.includes(pathImpl.sep)) return false;
    const rootStat = fsImpl.lstatSync(tempRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    const stagingMarker = pathImpl.join(tempRoot, '.whaledock-context-poc-staging');
    if (fsImpl.existsSync(stagingMarker)) {
      const stat = fsImpl.lstatSync(stagingMarker);
      if (!stat.isFile() || stat.isSymbolicLink()
          || stat.size < 1 || stat.size > CONTEXT_POC_MARKER_MAX_BYTES) return false;
      const value = JSON.parse(fsImpl.readFileSync(stagingMarker, 'utf8'));
      return value
        && Object.keys(value).sort().join(',') === 'digest,ownerToken,package,schema,state'
        && value.schema === 1 && value.package === CONTEXT_POC_PACKAGE
        && value.state === 'staging'
        && value.digest === CONTEXT_POC_BASELINE.digest
        && typeof value.ownerToken === 'string' && CONTEXT_POC_TOKEN_RE.test(value.ownerToken)
        && pathImpl.basename(tempRoot) === (
          `.staging-${value.digest}-${value.ownerToken.slice(0, 16)}`
        );
    }
    const finalMarker = pathImpl.join(tempRoot, '.whaledock-context-poc.json');
    const stat = fsImpl.lstatSync(finalMarker);
    if (!stat.isFile() || stat.isSymbolicLink()
        || stat.size < 1 || stat.size > CONTEXT_POC_MARKER_MAX_BYTES) return false;
    const value = JSON.parse(fsImpl.readFileSync(finalMarker, 'utf8'));
    return value
      && Object.keys(value).sort().join(',') === 'digest,ownerToken,package,schema'
      && value.schema === 1 && value.package === CONTEXT_POC_PACKAGE
      && value.digest === CONTEXT_POC_BASELINE.digest
      && typeof value.ownerToken === 'string' && CONTEXT_POC_TOKEN_RE.test(value.ownerToken)
      && pathImpl.basename(tempRoot) === (
        `.staging-${value.digest}-${value.ownerToken.slice(0, 16)}`
      );
  } catch (_error) {
    return false;
  }
}

function contextPocCleanupTemp(tempRoot, parent, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(runtime.platform || process.platform, runtime.pathModule);
  if (!contextPocOwnTemp(tempRoot, parent, fsImpl, pathImpl)) return;
  contextPocMakeTreeRemovable(tempRoot, fsImpl);
  fsImpl.rmSync(tempRoot, { recursive: true, force: true });
}

function contextPocOwnMount(mountRoot, parent, expectedOwner, fsImpl, pathImpl) {
  try {
    contextPocAssertDirectory(parent, fsImpl);
    const relative = pathImpl.relative(parent, mountRoot);
    if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)
        || relative.includes(pathImpl.sep)
        || typeof expectedOwner !== 'string' || !CONTEXT_POC_TOKEN_RE.test(expectedOwner)) return false;
    const rootStat = fsImpl.lstatSync(mountRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    const markerPath = pathImpl.join(mountRoot, '.whaledock-context-poc.json');
    const markerStat = fsImpl.lstatSync(markerPath);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()
        || markerStat.size < 1 || markerStat.size > CONTEXT_POC_MARKER_MAX_BYTES) return false;
    const marker = JSON.parse(fsImpl.readFileSync(markerPath, 'utf8'));
    return marker && Object.keys(marker).sort().join(',') === 'digest,ownerToken,package,schema'
      && marker.schema === 1 && marker.package === CONTEXT_POC_PACKAGE
      && marker.digest === CONTEXT_POC_BASELINE.digest
      && marker.ownerToken === expectedOwner
      && pathImpl.basename(mountRoot) === (
        `asset-${marker.digest}-${expectedOwner.slice(0, 16)}`
      );
  } catch (_error) {
    return false;
  }
}

function cleanupContextPocRuns(userDataPath, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(runtime.platform || process.platform, runtime.pathModule);
  if (typeof userDataPath !== 'string' || userDataPath.includes('\0')
      || !pathImpl.isAbsolute(userDataPath)) {
    throw new Error('context POC userData path invalid');
  }
  const empty = () => Object.freeze({ scanned: 0, removed: 0, skipped: 0 });
  let current = pathImpl.resolve(userDataPath);
  for (const name of ['', 'context-poc', 'v1', 'assets']) {
    if (name) current = pathImpl.join(current, name);
    let stat;
    try { stat = fsImpl.lstatSync(current); }
    catch (error) {
      if (error && error.code === 'ENOENT') return empty();
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return Object.freeze({ scanned: 0, removed: 0, skipped: 1 });
    }
  }
  const parent = current;
  const names = fsImpl.readdirSync(parent);
  const selected = names.slice(0, CONTEXT_POC_RUN_SCAN_MAX_ENTRIES);
  let removed = 0;
  let skipped = names.length - selected.length;
  for (const name of selected) {
    const candidate = pathImpl.join(parent, name);
    // sealed asset 会跨启动复用，稳定 DSH_HOME 更不能进入清理范围。启动时
    // 只清从未对 dsh 可见、且仍由固定基线和 marker 双重证明的 staging。
    const owned = name.startsWith('.staging-')
      && contextPocOwnTemp(candidate, parent, fsImpl, pathImpl);
    if (!owned) {
      skipped += 1;
      continue;
    }
    try {
      fsImpl.rmSync(candidate, { recursive: true, force: true });
      removed += 1;
    } catch (_error) {
      skipped += 1;
    }
  }
  return Object.freeze({ scanned: selected.length, removed, skipped });
}

function cleanupContextPocMount(mountRoot, parent, expectedOwner, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(runtime.platform || process.platform, runtime.pathModule);
  if (!contextPocOwnMount(mountRoot, parent, expectedOwner, fsImpl, pathImpl)) return false;
  contextPocMakeTreeRemovable(mountRoot, fsImpl);
  fsImpl.rmSync(mountRoot, { recursive: true, force: true });
  return true;
}

function contextPocReadAssetOwner(assetRoot, inventory, runtime = {}) {
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(inventory.platform || process.platform, runtime.pathModule);
  contextPocAssertDirectory(assetRoot, fsImpl);
  const markerPath = pathImpl.join(assetRoot, '.whaledock-context-poc.json');
  const markerStat = fsImpl.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()
      || markerStat.size < 1 || markerStat.size > CONTEXT_POC_MARKER_MAX_BYTES) {
    throw new Error('context POC asset marker invalid');
  }
  const marker = JSON.parse(fsImpl.readFileSync(markerPath, 'utf8'));
  if (!marker || Object.keys(marker).sort().join(',') !== 'digest,ownerToken,package,schema'
      || marker.schema !== 1 || marker.package !== CONTEXT_POC_PACKAGE
      || marker.digest !== inventory.digest
      || typeof marker.ownerToken !== 'string' || !CONTEXT_POC_TOKEN_RE.test(marker.ownerToken)
      || pathImpl.basename(assetRoot) !== (
        `asset-${inventory.digest}-${marker.ownerToken.slice(0, 16)}`
      )) {
    throw new Error('context POC asset marker mismatch');
  }
  return marker.ownerToken;
}

function prepareContextPocAssets(plan, runtime = {}) {
  if (!plan || plan.eligible !== true) throw new Error('context POC plan is not eligible');
  const fsImpl = runtime.fs || fs;
  const pathImpl = contextPocPathApi(plan.platform, runtime.pathModule);
  const runtimeModulesPath = contextPocAssertRuntimeModules(
    plan.runtimeModulesPath,
    { ...runtime, platform: plan.platform, pathModule: pathImpl }
  );
  const inventory = {
    ...contextPocReadAssets(plan, runtime),
    platform: plan.platform,
    runtimeModulesPath
  };
  const { versionRoot } = contextPocPrepareDataHome(plan, runtime);
  const parent = contextPocEnsureChildDirectory(versionRoot, 'assets', fsImpl, pathImpl);
  const randomBytes = runtime.randomBytes || crypto.randomBytes;
  const verifyTarget = runtime.verifyContextPocTarget || contextPocVerifyTarget;
  const prefix = `asset-${inventory.digest}-`;
  const candidates = fsImpl.readdirSync(parent)
    .filter((name) => name.startsWith(prefix))
    .slice(0, CONTEXT_POC_RUN_SCAN_MAX_ENTRIES);
  let targetRoot = null;
  let mountOwner = null;
  for (const name of candidates) {
    const candidate = pathImpl.join(parent, name);
    try {
      const owner = contextPocReadAssetOwner(candidate, inventory, runtime);
      verifyTarget(candidate, inventory, owner, runtime);
      contextPocVerifyAssetSealed(candidate, { ...runtime, platform: plan.platform });
      targetRoot = candidate;
      mountOwner = owner;
      break;
    } catch (_error) {
      // 不信任也不删除自报 marker 的旧根；从固定源重新构建另一棵 sealed root。
    }
  }
  if (!targetRoot) {
    mountOwner = randomBytes(32).toString('hex');
    targetRoot = pathImpl.join(
      parent, `asset-${inventory.digest}-${mountOwner.slice(0, 16)}`
    );
    const tempRoot = pathImpl.join(
      parent, `.staging-${inventory.digest}-${mountOwner.slice(0, 16)}`
    );
    const occupied = (candidate) => {
      try { fsImpl.lstatSync(candidate); return true; }
      catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    };
    if (occupied(targetRoot) || occupied(tempRoot)) {
      throw new Error('context POC asset id collision');
    }
    fsImpl.mkdirSync(tempRoot, { mode: 0o700 });
    let promoted = false;
    try {
      fsImpl.writeFileSync(
        pathImpl.join(tempRoot, '.whaledock-context-poc-staging'),
        JSON.stringify({
          schema: 1,
          package: CONTEXT_POC_PACKAGE,
          digest: inventory.digest,
          ownerToken: mountOwner,
          state: 'staging'
        }),
        { flag: 'wx', mode: 0o600 }
      );
      for (const asset of inventory.assets) {
        const target = pathImpl.join(tempRoot, ...asset.targetRelative.split('/'));
        contextPocEnsureDirectory(pathImpl.dirname(target), fsImpl);
        fsImpl.writeFileSync(target, asset.data, { flag: 'wx', mode: 0o600 });
      }
      fsImpl.writeFileSync(
        pathImpl.join(tempRoot, '.whaledock-context-poc.json'),
        JSON.stringify({
          schema: 1,
          digest: inventory.digest,
          package: CONTEXT_POC_PACKAGE,
          ownerToken: mountOwner
        }),
        { flag: 'wx', mode: 0o600 }
      );
      contextPocCreateResolverLink(tempRoot, runtimeModulesPath, {
        ...runtime, platform: plan.platform, pathModule: pathImpl
      });
      fsImpl.unlinkSync(pathImpl.join(tempRoot, '.whaledock-context-poc-staging'));
      verifyTarget(tempRoot, inventory, mountOwner, runtime);
      fsImpl.renameSync(tempRoot, targetRoot);
      promoted = true;
      verifyTarget(targetRoot, inventory, mountOwner, runtime);
      contextPocSealAssetRoot(targetRoot, { ...runtime, platform: plan.platform });
      contextPocVerifyAssetSealed(targetRoot, { ...runtime, platform: plan.platform });
    } catch (error) {
      contextPocCleanupTemp(tempRoot, parent, { ...runtime, platform: plan.platform });
      if (promoted) {
        cleanupContextPocMount(
          targetRoot, parent, mountOwner, { ...runtime, platform: plan.platform }
        );
      }
      throw error;
    }
  }
  const persistent = contextPocPreparePersistentHome(
    versionRoot, targetRoot, { ...runtime, platform: plan.platform }
  );
  return Object.freeze({
    mounted: true,
    assetDigest: inventory.digest,
    mountRoot: targetRoot,
    mountParent: parent,
    mountOwner,
    homePath: persistent.homePath,
    patchPath: pathImpl.join(targetRoot, 'context-bridge.patch.yml'),
    authToken: randomBytes(32).toString('hex'),
    selectionToken: randomBytes(32).toString('hex')
  });
}

function contextPocEnv(base, overrides) {
  const result = { ...(base || {}) };
  for (const [name, value] of Object.entries(overrides)) {
    for (const key of Object.keys(result)) {
      if (key.toUpperCase() === name.toUpperCase()) delete result[key];
    }
    result[name] = value;
  }
  return result;
}

function applyContextPocCommand(command, prepared) {
  if (!command || command.bundled !== true || !Array.isArray(command.args)
      || !prepared || prepared.mounted !== true
      || typeof prepared.authToken !== 'string'
      || !CONTEXT_POC_TOKEN_RE.test(prepared.authToken)
      || typeof prepared.selectionToken !== 'string'
      || !CONTEXT_POC_TOKEN_RE.test(prepared.selectionToken)
      || typeof prepared.mountRoot !== 'string' || !prepared.mountRoot
      || typeof prepared.mountParent !== 'string' || !prepared.mountParent
      || typeof prepared.mountOwner !== 'string'
      || !CONTEXT_POC_TOKEN_RE.test(prepared.mountOwner)) {
    throw new Error('context POC command inputs invalid');
  }
  const webIndexes = command.args.reduce((list, value, index) => (
    value === 'web' ? [...list, index] : list
  ), []);
  const portIndexes = command.args.reduce((list, value, index) => (
    value === '--port' ? [...list, index] : list
  ), []);
  if (webIndexes.length !== 1 || portIndexes.length !== 1
      || portIndexes[0] <= webIndexes[0] || command.args.includes('--patch')
      || command.args.includes('--profile')) {
    throw new Error('context POC refused malformed bundled arguments');
  }
  const rawContextBridgePort = command.args[portIndexes[0] + 1];
  const contextBridgePort = Number(rawContextBridgePort);
  if (typeof rawContextBridgePort !== 'string'
      || String(contextBridgePort) !== rawContextBridgePort
      || !Number.isInteger(contextBridgePort)
      || contextBridgePort < 1024 || contextBridgePort > 65535) {
    throw new Error('context POC refused malformed bundled port');
  }
  const args = [...command.args];
  // web alias 禁止混用 launcher 的 --patch。换成等价的 --profile web
  // 形式，才能让 patch 由 dsh launcher 解析，并把 --port 继续传给 web app。
  args.splice(
    webIndexes[0], 1, '--profile', 'web', '--patch', prepared.patchPath
  );
  return {
    ...command,
    args,
    env: contextPocEnv(command.env, {
      DSH_HOME: prepared.homePath,
      WHALEDOCK_CONTEXT_BRIDGE_TOKEN: prepared.authToken,
      WHALEDOCK_CONTEXT_SELECTION_TOKEN: prepared.selectionToken
    }),
    contextBridgeMounted: true,
    contextBridgeReason: 'ready',
    contextBridgeAssetDigest: prepared.assetDigest,
    contextBridgeMountRoot: prepared.mountRoot,
    contextBridgeMountParent: prepared.mountParent,
    contextBridgeMountOwner: prepared.mountOwner,
    contextBridgeHomePath: prepared.homePath,
    contextBridgePatchPath: prepared.patchPath,
    contextBridgeAuthToken: prepared.authToken,
    contextBridgeSelectionToken: prepared.selectionToken,
    contextBridgePort
  };
}

function contextBridgeBindingValid(state, binding) {
  return Boolean(state) && typeof state === 'object'
    && state.contextBridgeMounted === true
    && state.exited === false
    && state.contextBridgeSpawnChild === binding.child
    && state.child === binding.child
    && state.contextBridgePort === binding.port
    && binding.requestedPort === binding.port
    && Number.isInteger(binding.port)
    && binding.port >= 1024 && binding.port <= 65535
    && state.contextBridgeAuthToken === binding.secret
    && typeof binding.secret === 'string'
    && CONTEXT_POC_TOKEN_RE.test(binding.secret);
}

function contextBridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return crypto.createHmac('sha256', secret)
    .update(`${label}\0${CONTEXT_BRIDGE_PROTOCOL}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

function contextBridgeProofMatches(actual, expected) {
  if (typeof actual !== 'string' || !CONTEXT_POC_TOKEN_RE.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function contextBridgeRpc(state, endpoint, payload, binding, options = {}) {
  const handshake = endpoint === 'handshake';
  const sessionTokenValid = typeof binding.authToken === 'string'
    && CONTEXT_POC_TOKEN_RE.test(binding.authToken);
  if (!contextBridgeBindingValid(state, binding)
      || !CONTEXT_POC_ENDPOINTS.has(endpoint)
      || (handshake ? binding.authToken !== null : !sessionTokenValid)
      || !workdirRecord(payload) || Object.prototype.hasOwnProperty.call(payload, 'authToken')) {
    return Promise.reject(new Error('context bridge RPC unavailable'));
  }
  const port = binding.port;
  const rpcId = `wd-${crypto.randomUUID()}`;
  const body = JSON.stringify({
    type: 'client-request',
    rpcId,
    method: endpoint,
    payload: binding.authToken === null
      ? { ...payload }
      : { ...payload, authToken: binding.authToken }
  });
  if (Buffer.byteLength(body, 'utf8') > CONTEXT_POC_LIMITS.maxRequestBytes) {
    return Promise.reject(new Error('context bridge RPC request too large'));
  }
  const requestImpl = options.request || http.request;
  const timeoutMs = options.timeoutMs == null
    ? CONTEXT_POC_LIMITS.timeoutMs : Number(options.timeoutMs);
  if (typeof requestImpl !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    return Promise.reject(new Error('context bridge RPC options invalid'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;
    let deadlineTimer = null;
    let childListenersBound = false;
    const detachChildListeners = () => {
      if (!childListenersBound || !binding.child
          || typeof binding.child.removeListener !== 'function') return;
      binding.child.removeListener('exit', onChildEnd);
      binding.child.removeListener('error', onChildEnd);
      childListenersBound = false;
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      detachChildListeners();
      if (error) reject(error); else resolve(value);
    };
    const failAndDestroy = (error) => {
      if (settled) return;
      finish(error);
      if (request && typeof request.destroy === 'function') {
        try { request.destroy(); } catch (_error) { /* 尽力 */ }
      }
    };
    function onChildEnd() {
      failAndDestroy(new Error('context bridge RPC unavailable'));
    }

    deadlineTimer = setTimeout(() => {
      failAndDestroy(new Error('context bridge RPC timeout'));
    }, timeoutMs);
    if (binding.child && typeof binding.child.once === 'function') {
      binding.child.once('exit', onChildEnd);
      binding.child.once('error', onChildEnd);
      childListenersBound = true;
    }
    try {
      request = requestImpl({
        hostname: '127.0.0.1',
        port,
        path: `${CONTEXT_POC_CHANNEL}/${endpoint}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body, 'utf8')
        }
      }, (response) => {
        if (!response || typeof response.on !== 'function') {
          failAndDestroy(new Error('context bridge RPC response invalid'));
          return;
        }
        if (!contextBridgeBindingValid(state, binding)) {
          failAndDestroy(new Error('context bridge RPC unavailable'));
          return;
        }
        let bytes = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > CONTEXT_POC_LIMITS.maxResponseBytes) {
            failAndDestroy(new Error('context bridge RPC response too large'));
          } else chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          if (!contextBridgeBindingValid(state, binding)) {
            failAndDestroy(new Error('context bridge RPC unavailable'));
            return;
          }
          if (response.statusCode !== 200) {
            finish(new Error('context bridge RPC HTTP failure'));
            return;
          }
          let envelope;
          try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch (_error) {
            finish(new Error('context bridge RPC response invalid'));
            return;
          }
          if (!workdirRecord(envelope) || envelope.type !== 'server-response'
              || envelope.rpcId !== rpcId || !workdirRecord(envelope.result)) {
            finish(new Error('context bridge RPC envelope invalid'));
          } else if (envelope.result.ok !== true) {
            finish(new Error('context bridge RPC rejected'));
          } else {
            finish(null, envelope.result.value);
          }
        });
        response.once('aborted', () => {
          failAndDestroy(new Error('context bridge RPC response invalid'));
        });
        response.once('error', () => {
          failAndDestroy(new Error('context bridge RPC response invalid'));
        });
      });
      if (!request || typeof request.on !== 'function' || typeof request.end !== 'function') {
        throw new Error('invalid request');
      }
      request.once('error', () => finish(new Error('context bridge RPC request failed')));
      if (!contextBridgeBindingValid(state, binding)) {
        failAndDestroy(new Error('context bridge RPC unavailable'));
        return;
      }
      request.end(body);
    } catch (_error) {
      failAndDestroy(new Error('context bridge RPC request failed'));
    }
  });
}

function createContextBridgeTransport(state, options = {}) {
  const rpcOptions = { ...options };
  const binding = Object.freeze({
    child: state && state.contextBridgeSpawnChild,
    port: state && state.contextBridgePort,
    requestedPort: rpcOptions.port === undefined
      ? state && state.contextBridgePort : Number(rpcOptions.port),
    secret: state && state.contextBridgeAuthToken
  });
  let handshakePending = false;
  let sessionToken = null;
  const call = (endpoint, payload) => {
    if (endpoint === 'handshake' || sessionToken === null) {
      return Promise.reject(new Error('context bridge RPC unavailable'));
    }
    return contextBridgeRpc(state, endpoint, payload, {
      ...binding,
      authToken: sessionToken
    }, rpcOptions);
  };
  const transport = async (request) => {
    if (!contextBridgeBindingValid(state, binding)
        || sessionToken !== null || handshakePending
        || !workdirRecord(request)
        || Object.keys(request).length !== 2
        || request.type !== 'handshake'
        || request.protocol !== CONTEXT_BRIDGE_PROTOCOL) {
      throw new Error('context bridge RPC unavailable');
    }
    const randomBytes = rpcOptions.randomBytes || crypto.randomBytes;
    if (typeof randomBytes !== 'function') throw new Error('context bridge RPC unavailable');
    let clientNonce;
    try {
      const bytes = randomBytes(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
        throw new Error('invalid nonce');
      }
      clientNonce = bytes.toString('hex');
    } catch (_error) {
      throw new Error('context bridge RPC unavailable');
    }
    handshakePending = true;
    try {
      const reply = await contextBridgeRpc(state, 'handshake', {
        ...request,
        clientNonce,
        requestProof: contextBridgeHmac(
          binding.secret, 'handshake-request', clientNonce, ''
        )
      }, { ...binding, authToken: null }, rpcOptions);
      if (!workdirRecord(reply)
          || reply.clientNonce !== clientNonce
          || typeof reply.hostInstanceId !== 'string'
          || !CONTEXT_POC_ID_RE.test(reply.hostInstanceId)) {
        throw new Error('context bridge RPC proof invalid');
      }
      const expectedProof = contextBridgeHmac(
        binding.secret, 'handshake-proof', clientNonce, reply.hostInstanceId
      );
      if (!contextBridgeProofMatches(reply.proof, expectedProof)
          || !contextBridgeBindingValid(state, binding)) {
        throw new Error('context bridge RPC proof invalid');
      }
      sessionToken = contextBridgeHmac(
        binding.secret, 'rpc-session', clientNonce, reply.hostInstanceId
      );
      const cleanReply = { ...reply };
      delete cleanReply.clientNonce;
      delete cleanReply.proof;
      return cleanReply;
    } finally {
      handshakePending = false;
    }
  };
  Object.defineProperty(transport, 'call', { value: call, enumerable: false });
  return Object.freeze(transport);
}

function contextBridgeEligibility(options = {}) {
  if (!workdirRecord(options) || options.enabled !== true) {
    return CONTEXT_BRIDGE_RESULTS.disabled;
  }
  if (options.spawnedByUs !== true) return CONTEXT_BRIDGE_RESULTS.external;
  if (!hasExactDshPackageProof({ packageVersionProof: options.packageVersionProof })) {
    return CONTEXT_BRIDGE_RESULTS.version;
  }
  if (options.bridgeMounted !== true || options.handshake !== true) {
    return CONTEXT_BRIDGE_RESULTS.unavailable;
  }
  return CONTEXT_BRIDGE_RESULTS.ready;
}

async function probeContextBridge(options = {}) {
  const facts = workdirRecord(options) ? options : {};
  // handshake:true 只用于完成纯静态门判定；真正的握手结果仍必须来自下面唯一
  // 一次注入调用。前四道门任一道失败，都不会读取或调用 transport。
  const preflight = contextBridgeEligibility({
    enabled: facts.enabled,
    spawnedByUs: facts.spawnedByUs,
    packageVersionProof: facts.packageVersionProof,
    bridgeMounted: facts.bridgeMounted,
    handshake: true
  });
  if (!preflight.eligible) return preflight;
  if (typeof facts.transport !== 'function') return CONTEXT_BRIDGE_RESULTS.unavailable;

  let reply;
  try {
    reply = await facts.transport(CONTEXT_BRIDGE_HANDSHAKE_REQUEST);
  } catch (_error) {
    return CONTEXT_BRIDGE_RESULTS.unavailable;
  }
  const handshake = workdirRecord(reply)
    && reply.ok === true
    && reply.protocol === CONTEXT_BRIDGE_PROTOCOL;
  return contextBridgeEligibility({
    enabled: facts.enabled,
    spawnedByUs: facts.spawnedByUs,
    packageVersionProof: facts.packageVersionProof,
    bridgeMounted: facts.bridgeMounted,
    handshake
  });
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

// ---------- dsh prompt 适配器（写入合约与根包证明只收口在 backend） ----------

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

// prompt 与 events 必须对同一 dsh opaque id 生成字节级相同的引用。
// 这个纯函数不保存 raw id，也不把任何一方的内部映射暴露给另一方。
function dshOpaqueRef(sessionSalt, kind, raw) {
  if (!(typeof sessionSalt === 'string' || Buffer.isBuffer(sessionSalt))
      || Buffer.byteLength(sessionSalt) < 1) {
    throw new TypeError('sessionSalt 必须是非空字符串或 Buffer');
  }
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(kind)) {
    throw new TypeError('opaque ref kind 无效');
  }
  if (typeof raw !== 'string' || !raw) throw new TypeError('opaque ref raw id 无效');
  const digest = crypto.createHmac('sha256', sessionSalt)
    .update(`whaledock-events-v1\0${kind}\0${raw}`)
    .digest('hex');
  return `${kind}-${digest}`;
}

function createDshPromptAdapter(options = {}) {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw promptContract('dsh prompt 端口必须是 1024–65535 的整数');
  }
  // 根包版本与 host.describe.version 是两个不同信号；两个都必须精确命中。
  // 生产调用省略 expectedPackageVersion 时仍锁 DSH_CONTRACT；隔离候选探针可显式
  // 给出精确 SemVer，但 proof 仍必须来自它已经持有的进程身份，不能由 wire 推导。
  const expectedHostVersion = promptNonEmptyString(
    options.expectedHostVersion,
    'expectedHostVersion',
    64
  );
  if (expectedHostVersion !== DSH_CONTRACT.hostVersion) {
    throw promptContract('expectedHostVersion 不等于当前锁定的 dsh host 合约版本');
  }
  const packageProven = hasExactDshPackageProof({
    expectedPackageVersion: options.expectedPackageVersion,
    packageVersionProof: options.packageVersionProof
  });
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
  const sessionSalt = options.sessionSalt;
  const trackingConfigured = sessionSalt !== undefined;
  if (trackingConfigured
      && (!(typeof sessionSalt === 'string' || Buffer.isBuffer(sessionSalt))
        || Buffer.byteLength(sessionSalt) < 1)) {
    throw promptContract('sessionSalt 必须是非空字符串或 Buffer');
  }
  const onDeliveryPrepared = options.onDeliveryPrepared;
  const requireDeliveryPrepared = options.requireDeliveryPrepared === true;
  if (options.requireDeliveryPrepared !== undefined
      && typeof options.requireDeliveryPrepared !== 'boolean') {
    throw promptContract('requireDeliveryPrepared 必须是布尔值');
  }
  if (onDeliveryPrepared !== undefined && typeof onDeliveryPrepared !== 'function') {
    throw promptContract('onDeliveryPrepared 必须是函数');
  }
  if (onDeliveryPrepared !== undefined && !trackingConfigured) {
    throw promptContract('onDeliveryPrepared 需要 sessionSalt');
  }
  if (requireDeliveryPrepared && typeof onDeliveryPrepared !== 'function') {
    throw promptContract('严格投递注册需要 onDeliveryPrepared');
  }
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

  async function performCall(method, payload, fixedRpcId) {
    assertOpen();
    if (!DSH_PROMPT_METHODS.has(method)) {
      throw promptContract('拒绝未授权的 dsh prompt RPC');
    }
    const id = fixedRpcId === undefined ? rpcId() : fixedRpcId;
    if (typeof id !== 'string' || !id || id.length > DSH_PROMPT_LIMITS.maxRpcIdChars) {
      throw promptContract('session.prompt 预分配 rpcId 无效');
    }
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

  function call(method, payload, fixedRpcId) {
    const pending = performCall(method, payload, fixedRpcId);
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
    let cwd = null;
    if (value.cwd !== undefined) {
      cwd = promptNonEmptyString(value.cwd, `session.list.items[${index}].cwd`);
      if (Buffer.byteLength(cwd, 'utf8') > 16 * 1024
          || /[\u0000-\u001f\u007f]/.test(cwd)
          || !(path.isAbsolute(cwd) || path.win32.isAbsolute(cwd))) {
        throw promptContract(`session.list.items[${index}].cwd 无效`);
      }
    }
    return {
      sessionId,
      updatedAt: value.updatedAt,
      running: value.running,
      cwd,
      selectable: value.blank === false
        && value.origin !== 'subagent'
        && value.parentSessionId === undefined
    };
  }

  async function fetchSessionRows() {
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
    return rows;
  }

  function requireTargetEntry(value) {
    if (typeof value !== 'string' || value.length < 1
        || value.length > DSH_PROMPT_LIMITS.maxTokenChars) {
      throw dshPromptError('ERR_DSH_PROMPT_TARGET', '未知目标，请刷新会话列表');
    }
    const entry = rawByTargetToken.get(value);
    if (!entry) throw dshPromptError('ERR_DSH_PROMPT_TARGET', '未知目标，请刷新会话列表');
    return entry;
  }

  function inspectedTarget(targetTokenValue, entry) {
    const result = {
      targetToken: targetTokenValue,
      label: entry.label,
      running: entry.running,
      updatedAt: entry.updatedAt,
      cwd: entry.cwd
    };
    if (trackingConfigured) {
      result.sessionRef = dshOpaqueRef(sessionSalt, 'session', entry.rawSessionId);
    }
    return Object.freeze(result);
  }

  async function listTargets() {
    assertOpen();
    const availability = await detect();
    if (!availability.available) {
      rawByTargetToken.clear();
      return { ...availability, targets: [] };
    }
    try {
      const rows = await fetchSessionRows();
      const selectable = rows.filter((row) => row.selectable)
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const nextMap = new Map();
      const occupiedTokens = new Set(rawByTargetToken.keys());
      const targets = selectable.map((row, index) => {
        const token = targetToken(occupiedTokens);
        occupiedTokens.add(token);
        const target = {
          targetToken: token,
          label: `会话 ${String(index + 1).padStart(2, '0')}`,
          running: row.running,
          updatedAt: row.updatedAt
        };
        nextMap.set(token, {
          rawSessionId: row.sessionId,
          label: target.label,
          running: row.running,
          updatedAt: row.updatedAt,
          cwd: row.cwd
        });
        return target;
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

  function inspectTarget(targetTokenValue) {
    assertOpen();
    return inspectedTarget(targetTokenValue, requireTargetEntry(targetTokenValue));
  }

  async function revalidateTarget(targetTokenValue) {
    assertOpen();
    const entry = requireTargetEntry(targetTokenValue);
    if (!packageProven) {
      throw dshPromptError('ERR_DSH_PROMPT_UNAVAILABLE', 'dsh 根包身份无法证明');
    }
    await ensureDescribe();
    const rows = await fetchSessionRows();
    if (rawByTargetToken.get(targetTokenValue) !== entry) {
      throw dshPromptError('ERR_DSH_PROMPT_TARGET', '目标列表已刷新，请重新预检');
    }
    const row = rows.find((candidate) => candidate.sessionId === entry.rawSessionId);
    if (!row || !row.selectable) {
      throw dshPromptError('ERR_DSH_PROMPT_TARGET', '目标会话已不可投递，请刷新会话列表');
    }
    // 原 token 始终锁定列表时的 raw session；排序变化不得改投。
    entry.running = row.running;
    entry.updatedAt = row.updatedAt;
    entry.cwd = row.cwd;
    return inspectedTarget(targetTokenValue, entry);
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
    const entry = requireTargetEntry(value.targetToken);
    if (typeof value.text !== 'string' || !value.text.trim()
        || value.text.trimStart().startsWith('/')
        || value.text.includes('\0')
        || Buffer.byteLength(value.text, 'utf8') > DSH_PROMPT_LIMITS.maxTextBytes) {
      throw dshPromptError('ERR_DSH_PROMPT_INPUT', '只允许有限的普通文本 prompt');
    }
    const payload = {
      sessionId: entry.rawSessionId,
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
    return { payload, entry };
  }

  function rejectedReason(result) {
    if (!promptRecord(result) || result.ok !== false || !promptRecord(result.error)) return null;
    const code = result.error.code;
    return typeof code === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(code)
      ? code : 'rejected';
  }

  async function submitText(value) {
    assertOpen();
    const { payload, entry } = validatePromptInput(value);
    if (!packageProven) return { state: 'unknown', reason: 'package-unproven' };
    let tracking = null;
    try {
      await ensureDescribe();
      const promptRpcId = rpcId();
      if (trackingConfigured) {
        let deliveryRegistered = !requireDeliveryPrepared;
        tracking = {
          available: typeof onDeliveryPrepared === 'function',
          sessionRef: dshOpaqueRef(sessionSalt, 'session', entry.rawSessionId),
          deliveryRef: dshOpaqueRef(sessionSalt, 'delivery', promptRpcId)
        };
        if (typeof onDeliveryPrepared === 'function') {
          try {
            const prepared = await onDeliveryPrepared(Object.freeze({
              sessionRef: tracking.sessionRef,
              deliveryRef: tracking.deliveryRef,
              targetToken: value.targetToken,
              label: entry.label,
              running: entry.running,
              updatedAt: entry.updatedAt,
              cwd: entry.cwd
            }));
            if (prepared === false
                || (promptRecord(prepared) && prepared.available === false)) {
              tracking.available = false;
            }
            if (requireDeliveryPrepared && promptRecord(prepared)
                && prepared.registered === true) deliveryRegistered = true;
          } catch (_error) {
            tracking.available = false;
          }
          // 只读回调是跟踪增强；它失败不得改变唯一一次 prompt 投递。
        }
        if (!deliveryRegistered) tracking.available = false;
        tracking = Object.freeze(tracking);
        if (!deliveryRegistered) {
          return { state: 'rejected', reason: 'delivery-registration', tracking };
        }
      }
      const result = await call('session.prompt', payload, promptRpcId);
      const rejected = rejectedReason(result);
      if (rejected) {
        return tracking
          ? { state: 'rejected', reason: rejected, tracking }
          : { state: 'rejected', reason: rejected };
      }
      if (!promptRecord(result) || result.ok !== true
          || !promptRecord(result.value) || result.value.accepted !== true) {
        throw promptContract('session.prompt 成功结果 shape 无效');
      }
      return tracking
        ? { state: 'accepted', reason: 'accepted', tracking }
        : { state: 'accepted', reason: 'accepted' };
    } catch (error) {
      return tracking
        ? { state: 'unknown', reason: unavailableReason(error), tracking }
        : { state: 'unknown', reason: unavailableReason(error) };
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

  return Object.freeze({
    detect,
    listTargets,
    inspectTarget,
    revalidateTarget,
    submitText,
    close
  });
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
    return dshOpaqueRef(sessionSalt, kind, value);
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
      return {
        kind: 'turn-start',
        ...base,
        turn: requireInteger(data.turn, `${label}.data.turn`)
      };
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
      const normalized = {
        kind: 'message',
        ...base,
        turn: requireInteger(data.turn, `${label}.data.turn`),
        role: 'user',
        messageRef: refFor('message', requireString(message.id, `${label}.data.message.id`))
      };
      if (message.source !== undefined) {
        const source = requireRecord(message.source, `${label}.data.message.source`);
        const sourceKind = requireString(source.kind, `${label}.data.message.source.kind`);
        if (sourceKind === 'user') {
          normalized.deliveryRef = refFor(
            'delivery',
            requireString(source.rpcId, `${label}.data.message.source.rpcId`)
          );
        }
      }
      return normalized;
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
      const sessionRef = registerSession(
        requireString(payload.sessionId, 'session/queue.sessionId'),
        undefined
      );
      if (!Array.isArray(payload.items) || payload.items.length > 1000) {
        throw dshContract('session/queue.items 必须是不超过 1000 项的数组');
      }
      const items = [];
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
        const source = requireRecord(message.source, 'session/queue item.message.source');
        const sourceKind = requireString(source.kind, 'session/queue item.message.source.kind');
        if (message.role === 'user' && sourceKind === 'user') {
          items.push({
            deliveryRef: refFor(
              'delivery',
              requireString(source.rpcId, 'session/queue item.message.source.rpcId')
            ),
            placement: row.placement
          });
        }
      }
      return { kind: 'queue-snapshot', sessionRef, items };
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

function dshSupportsNoOpen(version) {
  const normalized = String(version || '').trim();
  // latest 是用户主动选择的漂移通道；批次 0 已确认当前 latest 晚于能力阈值。
  if (normalized === 'latest') return true;
  try {
    return compareVersions(normalized, DSH_NO_OPEN_MIN_VERSION) >= 0;
  } catch (_error) {
    return false;
  }
}

function dshWebArgs(port, version) {
  const args = ['web', '--port', String(port)];
  if (dshSupportsNoOpen(version)) args.push('--no-open');
  return args;
}

function dshWebLabel(prefix, port, version) {
  return `${prefix} web --port ${port}${dshSupportsNoOpen(version) ? ' --no-open' : ''}`;
}

function boundedFileText(file, maxBytes, fsImpl) {
  const constants = fsImpl.constants || fs.constants;
  const flags = constants.O_RDONLY
    | (constants.O_NONBLOCK || 0)
    | (constants.O_NOFOLLOW || 0);
  let fd = null;
  try {
    fd = fsImpl.openSync(file, flags);
    const stat = fsImpl.fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)
        || stat.size < 0 || stat.size > maxBytes) return null;
    // 即使同用户在 fstat 后追加文件，也只分配/读取 max+1，
    // 多出的一字节只用来 fail-closed，不存在无界 readFile 窗口。
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytes = 0;
    while (bytes <= maxBytes) {
      const count = fsImpl.readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    return bytes <= maxBytes ? buffer.subarray(0, bytes).toString('utf8') : null;
  } finally {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); } catch (_error) { /* 尽力关闭只读 fd */ }
    }
  }
}

function dshPackageVersion(packageRoot, fsImpl, pathImpl) {
  let manifest;
  try {
    const text = boundedFileText(
      pathImpl.join(packageRoot, 'package.json'), DSH_PACKAGE_JSON_MAX_BYTES, fsImpl
    );
    if (text == null) return null;
    manifest = JSON.parse(text);
  } catch (_error) {
    return null;
  }
  if (!manifest || manifest.name !== '@deepseek-ai/dsh'
      || !manifest.bin || typeof manifest.bin !== 'object'
      || manifest.bin.dsh !== 'lib/bin.js'
      || typeof manifest.version !== 'string'
      || manifest.version !== manifest.version.trim()
      || !DSH_SEMVER_RE.test(manifest.version)) return null;
  try {
    compareVersions(manifest.version, manifest.version);
    return manifest.version;
  } catch (_error) {
    return null;
  }
}

function officialWindowsDshShim(shim) {
  // npm cmd-shim v9/v7 与 legacy 的官方模板。整个非空行集合必须对上，
  // 不允许只在注释或不可达行中塞一段官方路径来伪造版本证明。
  const lines = String(shim || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n|\r/)
    .map((line) => line.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
  const modernTarget = '"%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"';
  const modernHeadAndBranch = [
    '@echo off',
    'goto start',
    ':find_dp0',
    'set dp0=%~dp0',
    'exit /b',
    ':start',
    'setlocal',
    'call :find_dp0',
    'if exist "%dp0%\\node.exe" (',
    'set "_prog=%dp0%\\node.exe"',
    ') else (',
    'set "_prog=node"'
  ];
  const modernV9 = [
    ...modernHeadAndBranch,
    ')',
    'endlocal & goto #_undefined_# 2>nul || title %comspec% & '
      + `set pathext=%pathext:;.js;=;% & "%_prog%" ${modernTarget} %*`
  ];
  const modernV7 = [
    ...modernHeadAndBranch,
    'set pathext=%pathext:;.js;=;%',
    ')',
    `endlocal & goto #_undefined_# 2>nul || title %comspec% & "%_prog%" ${modernTarget} %*`
  ];
  if ([modernV9, modernV7].some((template) => lines.length === template.length
      && template.every((line, index) => lines[index] === line))) return true;

  const legacyTarget = '"%~dp0\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"';
  const legacy = [
    '@if exist "%~dp0\\node.exe" (',
    `"%~dp0\\node.exe" ${legacyTarget} %*`,
    ') else (',
    '@setlocal',
    '@set pathext=%pathext:;.js;=;%',
    `node ${legacyTarget} %*`,
    ')'
  ];
  return lines.length === legacy.length
    && legacy.every((line, index) => lines[index] === line);
}

// PATH 中的 dsh 不受 config.dshVersion 控制。只认官方 npm 安装布局：
// POSIX 跟随 bin symlink 到 @deepseek-ai/dsh/lib/bin.js；Windows 读取有界 .cmd/.bat shim。
// 全程不起子进程；无法证明就回退旧参数。
// 此结果只决定 --no-open，绝不能冒充事件/prompt 所需的根包版本证明。
function probeSystemDshVersion(file, options = {}) {
  if (typeof file !== 'string' || !file || file.includes('\0')) return null;
  const platform = options.platform || process.platform;
  const fsImpl = options.fsImpl || options.fs || fs;
  const pathImpl = pathApi(platform, options.pathImpl || options.pathModule);
  let packageRoot;
  try {
    if (platform === 'win32') {
      if (!/\.(?:cmd|bat)$/i.test(file)) return null;
      const shim = boundedFileText(file, DSH_WINDOWS_SHIM_MAX_BYTES, fsImpl);
      if (shim == null) return null;
      if (!officialWindowsDshShim(shim)) return null;
      packageRoot = pathImpl.join(
        pathImpl.dirname(file), 'node_modules', '@deepseek-ai', 'dsh'
      );
    } else {
      const entryPath = String(fsImpl.realpathSync(file));
      const libDir = pathImpl.dirname(entryPath);
      packageRoot = pathImpl.dirname(libDir);
      if (pathImpl.basename(entryPath) !== 'bin.js'
          || pathImpl.basename(libDir) !== 'lib'
          || pathImpl.basename(packageRoot) !== 'dsh'
          || pathImpl.basename(pathImpl.dirname(packageRoot)) !== '@deepseek-ai') return null;
    }
  } catch (_error) {
    return null;
  }
  return dshPackageVersion(packageRoot, fsImpl, pathImpl);
}

function buildBundledCommandPlan(execPath, entryPath, version, port) {
  return {
    file: execPath,
    // rc.6 的 HMR 服务明确要求此 Node 启动参数；属于 dsh 启动契约。
    args: ['--expose-internals', entryPath, ...dshWebArgs(port, version)],
    shell: false,
    env: { ELECTRON_RUN_AS_NODE: '1' },
    bundled: true,
    label: dshWebLabel(`内置 dsh@${version}`, port, version),
    version,
    packageVersionProof: version
  };
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
    const port = configuredPort(config);
    // 只有上面的生产默认 + manifest + requested 三重精确门通过后，
    // 才把已校验的值交给纯 planner；planner 本身不是 runtime 版本覆盖面。
    return buildBundledCommandPlan(execPath, entryPath, manifest.dshVersion, port);
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
    let installedVersion = null;
    try {
      if (typeof runtime.probeDshVersion === 'function') {
        installedVersion = runtime.probeDshVersion(dsh);
      }
    } catch (_error) { /* 未知版本保持旧命令 */ }
    const port = configuredPort(config);
    return normalizeCommand({
      file: dsh,
      args: dshWebArgs(port, installedVersion),
      shell: false,
      label: dshWebLabel('dsh', port, installedVersion),
      version: 'PATH 中的已安装版本'
    }, platform);
  }
  const npx = findCommand('npx');
  if (npx) {
    const configured = config.dshVersion == null ? '' : String(config.dshVersion).trim();
    const version = configured || DEFAULTS.dshVersion;
    const pkg = `@deepseek-ai/dsh@${version}`;
    const port = configuredPort(config);
    return normalizeCommand({
      file: npx,
      args: ['-y', pkg, ...dshWebArgs(port, version)],
      shell: false,
      label: dshWebLabel(`npx -y ${pkg}`, port, version),
      version,
      packageVersionProof: version
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
// v0.6 只读探测：dsh --profile <name> --dump-config
//
// 用途只有一个：把「我们理解的配置」与「dsh 实际配置」做一次对账，供日志与将来的
// agent preset 侦察使用。它**不参与任何决策**——失败就当「没有这个信息」，
// 绝不因此阻断启动、绝不改变端口/工作区/版本的任何判断。
//
// 边界：只读子进程、3 秒超时、只读 stdout、输出有上限、不传任何用户数据。
// 这是全仓第一处引用 --dump-config，按硬约束 4 只能写在 lib/backend.js 里。
const DUMP_CONFIG_LIMITS = Object.freeze({
  timeoutMs: 3000,
  maxStdoutBytes: 256 * 1024,
  maxProfileChars: 64
});
const DUMP_CONFIG_PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/;

async function probeDshConfig(config = {}, options = {}) {
  const profile = options.profile === undefined ? 'web' : options.profile;
  if (typeof profile !== 'string' || !DUMP_CONFIG_PROFILE_RE.test(profile)) {
    return { available: false, reason: 'bad-profile' };
  }
  let resolved;
  try { resolved = resolveCommand(config, options.runtime || {}); } catch (_error) {
    return { available: false, reason: 'no-command' };
  }
  if (!resolved || !resolved.file) return { available: false, reason: 'no-command' };
  // 自定义命令是一整条 shell 字符串，拼不出可信的 --dump-config 调用；直接放弃探测。
  if (resolved.shell === true) return { available: false, reason: 'custom-command' };
  // 把 `web --port N` 换成 `--profile <name> --dump-config`，其余前缀参数原样保留
  // （npx 路径下前面还有 -y 与包名）。
  const webIndex = resolved.args.indexOf('web');
  if (webIndex < 0) return { available: false, reason: 'no-subcommand' };
  const args = [...resolved.args.slice(0, webIndex), '--profile', profile, '--dump-config'];

  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let stdout = '';
    let bytes = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (child && !child.killed) child.kill('SIGKILL'); } catch (_error) { /* 尽力 */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish({ available: false, reason: 'timeout' }),
      DUMP_CONFIG_LIMITS.timeoutMs);
    try {
      child = spawnImpl(resolved.file, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        env: options.env || process.env
      });
    } catch (_error) {
      finish({ available: false, reason: 'spawn-failed' });
      return;
    }
    child.on('error', () => finish({ available: false, reason: 'spawn-failed' }));
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > DUMP_CONFIG_LIMITS.maxStdoutBytes) {
          finish({ available: false, reason: 'output-too-large' });
          return;
        }
        stdout += String(chunk);
      });
    }
    child.on('close', (code) => {
      if (code !== 0) { finish({ available: false, reason: 'non-zero-exit' }); return; }
      const text = stdout.trim();
      if (!text) { finish({ available: false, reason: 'empty-output' }); return; }
      // 只报告「拿到了、多长、能不能当 JSON 解」，绝不把内容当成事实来源。
      let shape = 'text';
      try {
        const parsed = JSON.parse(text);
        shape = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? 'object' : 'json';
      } catch (_error) { shape = 'text'; }
      finish({ available: true, reason: 'ok', profile, bytes: Buffer.byteLength(text, 'utf8'), shape });
    });
  });
}

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
  const probeDshVersion = runtime.probeDshVersion || ((file) => probeSystemDshVersion(file, {
    platform,
    fsImpl: runtime.fs || fs,
    pathImpl: runtime.pathModule
  }));
  const resolvedCommand = resolveCommand(config, {
    platform,
    findCommand,
    runtimeInfo: runtime.runtimeInfo,
    probeDshVersion
  });
  if (!resolvedCommand) {
    const error = new Error('找不到 dsh / npx（未安装 Node.js？）');
    error.code = 'NODE_NOT_FOUND';
    throw error;
  }
  let command = resolvedCommand;
  const contextPlan = contextPocPlan(
    resolvedCommand, runtime.runtimeInfo || runtimeInfo, runtime
  );
  let contextBridgeReason = contextPlan.reason;
  let contextDataHome = null;
  if (contextPlan.eligible) {
    // 合格 bundled 路径即使静态桥接失败，也必须锁定 app-owned 稳定 home；
    // 不能退回继承 custom DSH_HOME，更不能让 dsh 默认写入 ~/.dsh。
    const stableDataHome = contextPocPrepareDataHome(contextPlan, runtime).homePath;
    contextDataHome = stableDataHome;
    command = {
      ...resolvedCommand,
      env: contextPocEnv(resolvedCommand.env, { DSH_HOME: stableDataHome })
    };
    try {
      const preparer = runtime.prepareContextPocAssets || prepareContextPocAssets;
      const prepared = preparer(contextPlan, runtime);
      command = applyContextPocCommand(command, prepared);
      contextBridgeReason = 'ready';
    } catch (error) {
      if (error && [
        'CONTEXT_POC_HOME_UNSAFE', 'CONTEXT_POC_RUNTIME_UNSAFE'
      ].includes(error.code)) throw error;
      // 原生降级不能继续解析上一次成功留下的 shadow。若固定祖先或链接
      // 形状不再可信，直接拒绝 spawn，避免执行未验证/被替换的旧 fork。
      contextPocClearPersistentPackageLinks(stableDataHome, runtime);
      // 可信静态资产与持久 DSH_HOME 均可跨启动复用；装饰失败不能清理二者。
      // 回退 bundled 原生聊天时仍保留 app-owned DSH_HOME。
      contextBridgeReason = 'bridge-unavailable';
    }
  }
  if (contextPlan.eligible) {
    // 这是 spawn 前最后一道边界：默认 rc.2 会直接消费这些 home 入口，
    // 因而任何 symlink/特殊文件都必须在 child 启动前 fail-closed。
    contextPocValidatePersistentDataRoot(contextDataHome, runtime);
  }
  const spawnImpl = runtime.spawn || spawn;
  const commandEnv = contextPlan.eligible === true
    ? contextPocEnv(baseEnv, command.env || {})
    : { ...baseEnv, ...(command.env || {}) };
  const child = spawnImpl(spawnFile(command, platform), command.args, {
    cwd: config.workdir || homeDir,
    env: envWithPath(commandEnv, pathValue, platform),
    shell: command.shell,
    detached: platform !== 'win32',
    windowsHide: platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = {
    child,
    label: command.label,
    version: command.version,
    packageVersionProof: command.packageVersionProof || null,
    contextBridgeMounted: command.contextBridgeMounted === true,
    contextBridgeReason,
    exited: false,
    code: null
  };
  if (command.contextBridgeMounted === true) {
    // 这些事实只供主进程的 loopback transport 使用；日志和 renderer 投影不枚举。
    Object.defineProperties(state, {
      contextBridgeAuthToken: {
        value: command.contextBridgeAuthToken,
        enumerable: false
      },
      contextBridgeSelectionToken: {
        value: command.contextBridgeSelectionToken,
        enumerable: false
      },
      contextBridgeSpawnChild: {
        value: child,
        enumerable: false
      },
      contextBridgePort: {
        value: command.contextBridgePort,
        enumerable: false
      },
      contextBridgeHomePath: {
        value: command.contextBridgeHomePath,
        enumerable: false
      },
      contextBridgePatchPath: {
        value: command.contextBridgePatchPath,
        enumerable: false
      },
      contextBridgeAssetDigest: {
        value: command.contextBridgeAssetDigest,
        enumerable: false
      },
      contextBridgeMountRoot: {
        value: command.contextBridgeMountRoot,
        enumerable: false
      },
      contextBridgeMountParent: {
        value: command.contextBridgeMountParent,
        enumerable: false
      },
      contextBridgeMountOwner: {
        value: command.contextBridgeMountOwner,
        enumerable: false
      }
    });
  }

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
  hasExactDshPackageProof,
  contextBridgeEligibility,
  probeContextBridge,
  contextPocPlan,
  contextPocReadAssets,
  contextPocValidateBaseline,
  contextPocPackageLinkPlan,
  contextPocResolverLinkPlan,
  prepareContextPocAssets,
  cleanupContextPocMount,
  cleanupContextPocRuns,
  applyContextPocCommand,
  createContextBridgeTransport,
  CONTEXT_POC_LIMITS,
  DSH_PROMPT_LIMITS,
  dshOpaqueRef,
  createDshPromptAdapter,
  createDshEventsAdapter,
  probeDshConfig,
  DUMP_CONFIG_LIMITS,
  dshSupportsNoOpen,
  probeSystemDshVersion,
  buildBundledCommandPlan,
  bundledCommand,
  resolveCommand,
  start,
  killPlan,
  executeKillPlan,
  stop,
  loginShellPath
};
