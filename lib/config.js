'use strict';
// 配置读写（userData/config.json）。不依赖 Electron，纯 Node 可测。
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Harness Web UI 端口（dsh web 默认 3080）
  port: 3080,
  // 是否由本 App 自动启动后端；设为 false 则只连接已在运行的服务
  autoStartBackend: true,
  // 自定义启动命令（高级用法），留空则自动探测 dsh / npx
  command: null,
  // 后端版本锁定：走 npx 回退路径时安装的 @deepseek-ai/dsh 版本。
  // 上游处于 rc 阶段可能有破坏性变更，默认锁定已验证版本；设为 latest 跟随最新
  dshVersion: '0.1.0-rc.6',
  // 后端进程的工作目录，留空则用用户主目录
  workdir: null,
  // 优先使用安装包内置的锁定版 dsh；默认仍尊重用户已有的 dsh / npx
  preferBundled: false,
  // 全局快捷键：呼出 / 隐藏窗口
  hotkey: 'CommandOrControl+Shift+H',
  // 窗口位置尺寸（App 自动记录）
  bounds: null,
  // v0.2 设置与更新选项
  openAtLogin: false,
  startMinimized: false,
  checkUpdates: true,
  skipVersion: null
};

const SETTINGS_FIELDS = new Set([
  'openAtLogin', 'startMinimized', 'hotkey', 'checkUpdates',
  'port', 'workdir', 'dshVersion', 'preferBundled', 'command'
]);
const RESTART_FIELDS = new Set([
  'port', 'workdir', 'dshVersion', 'preferBundled', 'command'
]);
const SEMVER_OR_LATEST = /^(?:latest|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

let file = null;
let data = { ...DEFAULTS };

function validationError(field, message) {
  const error = new Error(message);
  error.code = 'INVALID_CONFIG';
  error.field = field;
  return error;
}

function normalizeValue(key, value, options = {}) {
  if (key === 'port') {
    const port = typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim()) : value;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw validationError(key, '端口必须是 1024–65535 的整数');
    }
    return port;
  }
  if (['autoStartBackend', 'preferBundled', 'openAtLogin', 'startMinimized', 'checkUpdates'].includes(key)) {
    if (typeof value !== 'boolean') throw validationError(key, `${key} 必须是布尔值`);
    return value;
  }
  if (key === 'command') {
    if (value == null || String(value).trim() === '') return null;
    if (typeof value !== 'string' || value.length > 4096) {
      throw validationError(key, '自定义启动命令必须是 4096 字以内的字符串或留空');
    }
    return value.trim();
  }
  if (key === 'workdir') {
    if (value == null || String(value).trim() === '') return null;
    if (typeof value !== 'string' || value.length > 4096) {
      throw validationError(key, '工作目录必须是有效目录或留空');
    }
    const normalized = path.resolve(value.trim());
    if (options.requireExistingWorkdir) {
      let stat = null;
      try { stat = fs.statSync(normalized); } catch (_e) { /* 下面统一报错 */ }
      if (!stat || !stat.isDirectory()) throw validationError(key, '工作目录不存在或不是文件夹');
    }
    return normalized;
  }
  if (key === 'dshVersion') {
    if (typeof value !== 'string' || !SEMVER_OR_LATEST.test(value.trim())) {
      throw validationError(key, '后端版本必须是 latest 或有效 semver（可含 -rc 后缀）');
    }
    return value.trim();
  }
  if (key === 'hotkey') {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
      throw validationError(key, '全局快捷键不能为空');
    }
    return value.trim();
  }
  if (key === 'skipVersion') {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !SEMVER_OR_LATEST.test(value.trim()) || value.trim() === 'latest') {
      throw validationError(key, '跳过版本必须是有效 semver 或留空');
    }
    return value.trim();
  }
  if (key === 'bounds') {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw validationError(key, '窗口尺寸无效');
    }
    const bounds = {};
    for (const field of ['x', 'y', 'width', 'height']) {
      if (value[field] !== undefined && Number.isFinite(value[field])) bounds[field] = Math.round(value[field]);
    }
    if ((bounds.width !== undefined && bounds.width < 320)
        || (bounds.height !== undefined && bounds.height < 240)) {
      throw validationError(key, '窗口尺寸无效');
    }
    return bounds;
  }
  throw validationError(key, `不支持的配置字段：${key}`);
}

function normalizeStored(raw) {
  const normalized = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    try { normalized[key] = normalizeValue(key, raw[key]); } catch (_e) { /* 单字段回落默认值 */ }
  }
  return normalized;
}

function validatePatch(patch, options = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw validationError('', '设置补丁必须是对象');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(patch)) {
    if (options.settingsOnly && !SETTINGS_FIELDS.has(key)) {
      throw validationError(key, `设置页不允许修改字段：${key}`);
    }
    normalized[key] = normalizeValue(key, value, options);
  }
  return normalized;
}

function init(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  file = path.join(baseDir, 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置根节点不是对象');
    data = { ...DEFAULTS, ...normalizeStored(raw) };
  } catch (_e) {
    data = { ...DEFAULTS };
    persist(data);
  }
  return { ...data };
}

function get(key) {
  return key === undefined ? { ...data } : data[key];
}

function persist(next) {
  if (!file) return;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
    throw error;
  }
}

function set(patch) {
  const normalized = validatePatch(patch);
  const next = { ...data, ...normalized };
  persist(next);
  data = next;
  return { ...data };
}

function validateSettingsPatch(patch) {
  return validatePatch(patch, { settingsOnly: true, requireExistingWorkdir: true });
}

function restartRequired(before, patch) {
  return Object.keys(patch || {}).some((key) => RESTART_FIELDS.has(key)
    && before && before[key] !== patch[key]);
}

function filePath() { return file; }

module.exports = {
  init,
  get,
  set,
  filePath,
  validateSettingsPatch,
  restartRequired,
  SETTINGS_FIELDS,
  DEFAULTS
};
