'use strict';
// dsh 后端进程管理：命令探测、启动、端口等待、停止。
// 不依赖 Electron，纯 Node 可测。

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { DEFAULTS } = require('./config');

const HOME = os.homedir();
const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';

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

function normalizeCommand(command, platform) {
  const windowsShim = platform === 'win32' && /\.(?:cmd|bat)$/i.test(command.file);
  return { ...command, shell: windowsShim || Boolean(command.shell) };
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
  const dsh = findCommand('dsh');
  if (dsh) {
    return normalizeCommand({
      file: dsh,
      args: ['web'],
      shell: false,
      label: 'dsh web',
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
      args: ['-y', pkg, 'web'],
      shell: false,
      label: `npx -y ${pkg} web`,
      version
    }, platform);
  }
  return null;
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
  const command = resolveCommand(config, { platform, findCommand });
  if (!command) {
    const error = new Error('找不到 dsh / npx（未安装 Node.js？）');
    error.code = 'NODE_NOT_FOUND';
    throw error;
  }
  const spawnImpl = runtime.spawn || spawn;
  const child = spawnImpl(spawnFile(command, platform), command.args, {
    cwd: config.workdir || homeDir,
    env: envWithPath(baseEnv, pathValue, platform),
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
    kill: opts.kill || process.kill,
    wait: opts.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  };
  for (const step of plan) {
    if (step.action === 'wait') {
      await runtime.wait(step.ms);
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
  if (settleMs > 0) {
    const wait = opts.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    await wait(settleMs);
  }
}

module.exports = {
  fullPath,
  execCandidates,
  which,
  isPortOpen,
  waitForPort,
  resolveCommand,
  start,
  killPlan,
  executeKillPlan,
  stop,
  loginShellPath
};
