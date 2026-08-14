'use strict';
// 配置读写（userData/config.json）。不依赖 Electron，纯 Node 可测。
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Harness Web UI 端口（dsh web 默认 3080）
  port: 3080,
  // 是否由本 App 自动启动后端；设为 false 则只连接已在运行的服务
  autoStartBackend: true,
  // 自定义启动命令（高级用法），例如 "dsh web"。留空则自动探测 dsh / npx
  command: null,
  // 后端版本锁定：走 npx 回退路径时安装的 @deepseek-ai/dsh 版本。
  // 上游处于 rc 阶段可能有破坏性变更，默认锁定已验证版本；设为 "latest" 跟随最新
  dshVersion: '0.1.0-rc.6',
  // 后端进程的工作目录，留空则用用户主目录
  workdir: null,
  // 全局快捷键：呼出 / 隐藏窗口
  hotkey: 'CommandOrControl+Shift+H',
  // 窗口位置尺寸（App 自动记录）
  bounds: null
};

let file = null;
let data = { ...DEFAULTS };

function init(baseDir) {
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch (_e) { /* ignore */ }
  file = path.join(baseDir, 'config.json');
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (_e) {
    data = { ...DEFAULTS };
    save();
  }
  return { ...data };
}

function get(key) {
  return key === undefined ? { ...data } : data[key];
}

function set(patch) {
  data = { ...data, ...patch };
  save();
}

function save() {
  if (!file) return;
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); } catch (_e) { /* ignore */ }
}

function filePath() { return file; }

module.exports = { init, get, set, filePath, DEFAULTS };
