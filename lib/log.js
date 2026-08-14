'use strict';
// 简单文件日志 + 内存环形缓冲。不依赖 Electron，纯 Node 可测。
const fs = require('fs');
const path = require('path');
const os = require('os');

let logDir = path.join(os.tmpdir(), 'harness-desktop-logs');
let logFile = null;
const ring = [];
const RING_MAX = 400;

function init(dir) {
  logDir = dir;
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_e) { /* ignore */ }
  logFile = path.join(logDir, 'harness-desktop.log');
  rotate();
}

function rotate() {
  try {
    const st = fs.statSync(logFile);
    if (st.size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
  } catch (_e) { /* 文件不存在等，忽略 */ }
}

function line(tag, msg) {
  const s = `[${new Date().toISOString()}] [${tag}] ${String(msg)}`;
  ring.push(s);
  if (ring.length > RING_MAX) ring.shift();
  if (logFile) {
    try { fs.appendFileSync(logFile, s + '\n'); } catch (_e) { /* ignore */ }
  }
  return s;
}

function recent(n = 150) {
  return ring.slice(-n).join('\n');
}

function filePath() { return logFile; }
function dirPath() { return logDir; }

module.exports = { init, line, recent, filePath, dirPath };
