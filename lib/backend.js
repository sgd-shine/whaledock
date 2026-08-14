'use strict';
// dsh 后端进程管理：命令探测、启动、端口等待、停止。
// 不依赖 Electron，纯 Node 可测。
//
// 关键点：macOS 上从 Finder/Dock 启动的 GUI 应用继承不到你在终端里的 PATH
// （nvm / Homebrew 安装的 node 都不在里面），所以这里会主动去登录 shell
// 和常见安装目录里把 PATH 找全，否则 App 一定会"找不到 node"。

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { DEFAULTS } = require('./config');

const HOME = os.homedir();

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// nvm 用户：~/.nvm/versions/node/vX.Y.Z/bin（取版本号最大的排前面）
function nvmBinDirs() {
  try {
    const dir = path.join(HOME, '.nvm', 'versions', 'node');
    return fs.readdirSync(dir)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => path.join(dir, v, 'bin'));
  } catch (_e) {
    return [];
  }
}

// 向登录 shell 要一份完整 PATH（zsh/bash 均可），带超时防卡死
function loginShellPath(timeoutMs = 4000) {
  const shell = process.env.SHELL || '/bin/zsh';
  for (const flag of ['-ilc', '-lc']) {
    try {
      const r = spawnSync(shell, [flag, 'printf "__PATH__%s" "$PATH"'], {
        timeout: timeoutMs,
        encoding: 'utf8'
      });
      const m = (r.stdout || '').match(/__PATH__(.*)$/s);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    } catch (_e) { /* 换下一种方式 */ }
  }
  return '';
}

let cachedPath = null;

function fullPath(refresh = false) {
  if (cachedPath && !refresh) return cachedPath;
  const parts = uniq([
    ...String(loginShellPath() || '').split(':'),
    ...String(process.env.PATH || '').split(':'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(HOME, '.volta', 'bin'),
    path.join(HOME, '.local', 'bin'),
    ...nvmBinDirs(),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin'
  ]);
  cachedPath = parts.join(':');
  return cachedPath;
}

function which(cmd) {
  for (const dir of fullPath().split(':')) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch (_e) { /* 下一个目录 */ }
  }
  return null;
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
    // 探测期间子进程可能刚好退出；返回成功前再确认一次，避免把瞬时端口当成可用后端。
    if (shouldAbort && shouldAbort()) return false;
    if (open) return true;
    if (onTick) onTick(Date.now() - start);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// 决定用什么命令启动后端
function resolveCommand(config = {}, findCommand = which) {
  if (config.command && String(config.command).trim()) {
    return {
      file: String(config.command).trim(),
      args: [],
      shell: true,
      label: String(config.command).trim(),
      version: '由自定义命令决定'
    };
  }
  const dsh = findCommand('dsh');
  if (dsh) {
    return {
      file: dsh,
      args: ['web'],
      shell: false,
      label: 'dsh web',
      version: 'PATH 中的已安装版本'
    };
  }
  const npx = findCommand('npx');
  if (npx) {
    // 版本锁定：避免上游 rc 破坏性变更导致所有用户"变砖"（见 DECISIONS D11）
    const configured = config.dshVersion == null ? '' : String(config.dshVersion).trim();
    const version = configured || DEFAULTS.dshVersion;
    const pkg = `@deepseek-ai/dsh@${version}`;
    return {
      file: npx,
      args: ['-y', pkg, 'web'],
      shell: false,
      label: `npx -y ${pkg} web`,
      version
    };
  }
  return null;
}

// 启动后端。返回 state 对象；onLine 收到每行输出，onExit 在进程退出时回调
function start(config, hooks = {}) {
  const { onLine = null, onExit = null } = hooks;
  const cmd = resolveCommand(config);
  if (!cmd) {
    const err = new Error('找不到 dsh / npx（未安装 Node.js？）');
    err.code = 'NODE_NOT_FOUND';
    throw err;
  }
  const env = { ...process.env, PATH: fullPath() };
  const child = spawn(cmd.file, cmd.args, {
    cwd: config.workdir || HOME,
    env,
    shell: cmd.shell,
    detached: process.platform !== 'win32', // 独立进程组，便于连子进程一起停掉
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = { child, label: cmd.label, version: cmd.version, exited: false, code: null };

  const wire = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (l && onLine) onLine(l);
      }
    });
  };
  wire(child.stdout);
  wire(child.stderr);

  child.on('exit', (code, signal) => {
    state.exited = true;
    state.code = code;
    if (onExit) onExit(code, signal);
  });
  child.on('error', (e) => {
    state.exited = true;
    if (onLine) onLine('[spawn error] ' + e.message);
    if (onExit) onExit(-1, null);
  });
  return state;
}

// 温和地停掉整个进程组；超时后强杀
function stop(state, opts = {}) {
  const { graceMs = 4000 } = opts;
  return new Promise((resolve) => {
    if (!state || !state.child || state.exited) return resolve();
    const pid = state.child.pid;
    const killGroup = (sig) => {
      try {
        process.kill(-pid, sig);
      } catch (_e) {
        try { state.child.kill(sig); } catch (_e2) { /* ignore */ }
      }
    };
    const timer = setTimeout(() => {
      killGroup('SIGKILL');
      setTimeout(resolve, 300);
    }, graceMs);
    state.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    killGroup('SIGTERM');
  });
}

module.exports = {
  fullPath,
  which,
  isPortOpen,
  waitForPort,
  resolveCommand,
  start,
  stop,
  loginShellPath
};
