'use strict';
// 配置读写（userData/config.json）。不依赖 Electron，纯 Node 可测。
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_DAILY_TOKEN_BUDGET = 1_000_000_000;
const MAX_PRICE_PER_MILLION = 1_000_000;
const PRICE_FIELDS = new Set([
  'priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion'
]);
// npm 包版本与 host.describe.version 是两个独立的 dsh 合约信号。
// hostVersion 只用于协议能力判断，不是用户设置，也不写入 config.json。
const DSH_CONTRACT = Object.freeze({
  packageVersion: '0.1.0-rc.6',
  hostVersion: '0.0.1'
});
const DSH_PRIVATE_DIRNAME = '.dsh';

function protectedPathTools(platform, supplied) {
  if (supplied) return supplied;
  return platform === 'win32' ? path.win32 : path.posix;
}

// 路径身份唯一口径：realpath 之后再去掉 Windows 的 \\?\ / \\?\UNC\ 前缀。
// Windows 的 8.3 短名（RUNNER~1）与长名指向同一目录，必须归一到同一个字符串，
// 否则受保护根的前缀比较会被别名路径绕过。
function normalizeRealPath(value, options = {}) {
  const platform = options.platform || process.platform;
  const tools = protectedPathTools(platform, options.pathImpl);
  let resolved = String(value);
  if (platform === 'win32') {
    if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`;
    else if (/^\\\\\?\\[A-Za-z]:/.test(resolved)) resolved = resolved.slice(4);
  }
  return tools.resolve(resolved);
}

// 原生 realpath 会把 Windows 短名展开成最终路径；注入的假 fs 没有 native 时回落。
function nativeRealpathSync(fsImpl) {
  const impl = fsImpl.realpathSync;
  if (typeof impl !== 'function') return impl;
  return typeof impl.native === 'function' ? impl.native : impl;
}

function protectedWorkspaceRoots(options = {}) {
  const platform = options.platform || process.platform;
  const tools = protectedPathTools(platform, options.pathImpl);
  const fsImpl = options.fsImpl || fs;
  const homeDir = options.homeDir === undefined ? os.homedir() : options.homeDir;
  if (typeof homeDir !== 'string' || !homeDir || homeDir.includes('\0')
      || !tools.isAbsolute(homeDir)) {
    throw validationError('workdir', '用户主目录必须是绝对路径');
  }
  const lexicalRoot = tools.join(tools.resolve(homeDir), DSH_PRIVATE_DIRNAME);
  const roots = [lexicalRoot];
  try {
    const realRoot = normalizeRealPath(nativeRealpathSync(fsImpl)(lexicalRoot),
      { platform, pathImpl: tools });
    const key = (value) => platform === 'win32'
      ? value.toLocaleLowerCase('en-US') : value;
    if (!roots.some((value) => key(value) === key(realRoot))) roots.push(realRoot);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw configReadError('无法验证受保护的 dsh 状态目录', error);
    }
  }
  return Object.freeze(roots);
}

function isProtectedWorkspacePath(value, options = {}) {
  const platform = options.platform || process.platform;
  const tools = protectedPathTools(platform, options.pathImpl);
  if (typeof value !== 'string' || !value || value.includes('\0') || !tools.isAbsolute(value)) {
    return false;
  }
  const key = (item) => {
    const normalized = tools.resolve(item);
    return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  };
  const candidate = key(value);
  return protectedWorkspaceRoots(options).some((root) => {
    const protectedRoot = key(root);
    const prefix = protectedRoot.endsWith(tools.sep)
      ? protectedRoot : `${protectedRoot}${tools.sep}`;
    return candidate === protectedRoot || candidate.startsWith(prefix);
  });
}

const DEFAULTS = {
  // Harness Web UI 端口（dsh web 默认 3080）
  port: 3080,
  // 是否由本 App 自动启动后端；设为 false 则只连接已在运行的服务
  autoStartBackend: true,
  // 自定义启动命令（高级用法），留空则自动探测 dsh / npx
  command: null,
  // 后端版本锁定：走 npx 回退路径时安装的 @deepseek-ai/dsh 版本。
  // 上游处于 rc 阶段可能有破坏性变更，默认锁定已验证版本；设为 latest 跟随最新
  dshVersion: DSH_CONTRACT.packageVersion,
  // 后端进程的工作目录，留空则用用户主目录
  workdir: null,
  // 最近工作区由 main/工作区事务维护，不允许设置 renderer 通用直写
  recentWorkdirs: [],
  // 优先使用安装包内置的锁定版 dsh；默认仍尊重用户已有的 dsh / npx
  preferBundled: false,
  // 全局快捷键：呼出 / 隐藏窗口
  hotkey: 'CommandOrControl+Shift+H',
  // v0.4 截图入口快捷键（实际注册仍由 Electron main 负责）
  screenshotHotkeyEnabled: true,
  screenshotHotkey: 'CommandOrControl+Shift+S',
  // 窗口位置尺寸（App 自动记录）
  bounds: null,
  // v0.2 设置与更新选项
  openAtLogin: false,
  startMinimized: false,
  checkUpdates: true,
  skipVersion: null,
  // v0.3 任务事件层消费者；价格是可修改的静态默认值，不在运行时联网刷新。
  taskNotifications: true,
  budgetEnabled: false,
  dailyTokenBudget: 1_000_000,
  priceInputPerMillion: 1,
  priceCacheReadPerMillion: 0.02,
  priceOutputPerMillion: 2,
  // v0.5 桌面宠物与皮肤主题；宠物默认关闭，由用户在设置里主动开启。
  petEnabled: false,
  petPackageId: 'builtin:pixel-whale',
  petAlwaysOnTop: true,
  petClickThrough: false,
  theme: 'whaledock-dark'
};

const SETTINGS_FIELDS = new Set([
  'openAtLogin', 'startMinimized', 'hotkey', 'checkUpdates',
  'port', 'dshVersion', 'preferBundled', 'command',
  'screenshotHotkeyEnabled', 'screenshotHotkey',
  'taskNotifications', 'budgetEnabled', 'dailyTokenBudget',
  'priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion',
  'petEnabled', 'petPackageId', 'petAlwaysOnTop', 'petClickThrough', 'theme'
]);
const RESTART_FIELDS = new Set([
  'port', 'workdir', 'dshVersion', 'preferBundled', 'command'
]);
const SEMVER_OR_LATEST = /^(?:latest|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

let file = null;
let data = clone(DEFAULTS);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = clone(item);
    return result;
  }
  return value;
}

function configReadError(message, cause) {
  const error = new Error(message);
  error.code = 'CONFIG_READ_FAILED';
  if (cause !== undefined) error.cause = cause;
  return error;
}

function validationError(field, message) {
  const error = new Error(message);
  error.code = 'INVALID_CONFIG';
  error.field = field;
  return error;
}

function finiteNumber(key, value, minimum, maximum, integer) {
  const number = typeof value === 'string' && value.trim()
    ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)
      || number < minimum || number > maximum || (integer && !Number.isInteger(number))) {
    const range = integer
      ? `${minimum}–${maximum} 的整数`
      : `${minimum}–${maximum} 的有限数值`;
    throw validationError(key, `${key} 必须是${range}`);
  }
  return Object.is(number, -0) ? 0 : number;
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
  if ([
    'autoStartBackend', 'preferBundled', 'openAtLogin', 'startMinimized', 'checkUpdates',
    'taskNotifications', 'budgetEnabled', 'screenshotHotkeyEnabled',
    'petEnabled', 'petAlwaysOnTop', 'petClickThrough'
  ].includes(key)) {
    if (typeof value !== 'boolean') throw validationError(key, `${key} 必须是布尔值`);
    return value;
  }
  // 宠物包 id 与主题 id 都只是选择标识；真正的路径限界由 lib/pets.js / lib/themes.js 负责。
  if (key === 'petPackageId' || key === 'theme') {
    if (value == null || String(value).trim() === '') {
      return key === 'theme' ? DEFAULTS.theme : DEFAULTS.petPackageId;
    }
    const text = String(value).trim();
    if (text.length > 96 || /[\u0000-\u001f\u007f\\/]/.test(text)
        || (key === 'petPackageId' && !/^(?:builtin|user):/.test(text))) {
      throw validationError(key, `${key} 不是合法标识`);
    }
    return text;
  }
  if (key === 'dailyTokenBudget') {
    return finiteNumber(key, value, 1, MAX_DAILY_TOKEN_BUDGET, true);
  }
  if (PRICE_FIELDS.has(key)) {
    return finiteNumber(key, value, 0, MAX_PRICE_PER_MILLION, false);
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
  if (key === 'recentWorkdirs') {
    if (!Array.isArray(value) || value.length > 10) {
      throw validationError(key, 'recentWorkdirs 必须是不超过 10 项的路径数组');
    }
    return value.map((entry) => {
      if (typeof entry !== 'string' || !entry.trim() || entry.length > 4096) {
        throw validationError(key, 'recentWorkdirs 只能包含有效路径');
      }
      return path.resolve(entry.trim());
    });
  }
  if (key === 'dshVersion') {
    if (typeof value !== 'string' || !SEMVER_OR_LATEST.test(value.trim())) {
      throw validationError(key, '后端版本必须是 latest 或有效 semver（可含 -rc 后缀）');
    }
    return value.trim();
  }
  if (key === 'hotkey' || key === 'screenshotHotkey') {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
      throw validationError(key, `${key} 不能为空且不得超过 128 字符`);
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

function validateShortcutPair(value) {
  const source = value && typeof value === 'object' ? value : {};
  if (source.screenshotHotkeyEnabled !== true) return true;
  const mainHotkey = typeof source.hotkey === 'string' ? source.hotkey.trim().toLowerCase() : '';
  const screenshotHotkey = typeof source.screenshotHotkey === 'string'
    ? source.screenshotHotkey.trim().toLowerCase() : '';
  if (mainHotkey && screenshotHotkey && mainHotkey === screenshotHotkey) {
    throw validationError('screenshotHotkey', '截图快捷键不能与主窗口快捷键相同');
  }
  return true;
}

function touchesShortcutPair(patch) {
  return ['hotkey', 'screenshotHotkeyEnabled', 'screenshotHotkey']
    .some((key) => Object.prototype.hasOwnProperty.call(patch || {}, key));
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

function init(baseDir, options = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  file = path.join(baseDir, 'config.json');
  let rawText;
  try {
    rawText = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw configReadError('已有配置文件无法读取，未覆盖原文件', error);
    }
    const suppliedFreshDefaults = options && typeof options.freshDefaults === 'function'
      ? options.freshDefaults() : options && options.freshDefaults;
    const freshDefaults = suppliedFreshDefaults !== undefined
      ? validatePatch(suppliedFreshDefaults) : {};
    const next = { ...clone(DEFAULTS), ...freshDefaults };
    validateShortcutPair(next);
    persist(next);
    data = clone(next);
    return clone(data);
  }

  let raw;
  try {
    raw = JSON.parse(rawText);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置根节点不是对象');
  } catch (error) {
    throw configReadError('已有配置文件格式无效，未覆盖原文件', error);
  }
  // freshDefaults 严格只用于 ENOENT；已有 null/缺字段均保留旧用户语义。
  data = { ...clone(DEFAULTS), ...normalizeStored(raw) };
  return clone(data);
}

function get(key) {
  return key === undefined ? clone(data) : clone(data[key]);
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
  // 旧用户可能已把主快捷键设成 v0.4 新截图默认键。
  // 无关的 bounds/workspace 写入不应因升级默认冲突被锁死；
  // 只在用户或内部实际修改这三个字段时严格校验。
  if (touchesShortcutPair(normalized)) validateShortcutPair(next);
  persist(next);
  data = clone(next);
  return clone(data);
}

function validateSettingsPatch(patch) {
  const normalized = validatePatch(patch, { settingsOnly: true, requireExistingWorkdir: true });
  if (touchesShortcutPair(normalized)) validateShortcutPair({ ...data, ...normalized });
  return normalized;
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
  validateShortcutPair,
  SETTINGS_FIELDS,
  DEFAULTS,
  DSH_CONTRACT,
  protectedWorkspaceRoots,
  isProtectedWorkspacePath,
  normalizeRealPath,
  nativeRealpathSync
};
