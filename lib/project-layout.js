'use strict';

// v0.11 批次 3：项目窗格的纯 Node 状态合同。
// 这里只描述可持久化布局；不持有 BrowserWindow、WebContents 或绝对路径。

const SCHEMA_VERSION = 1;
const LIMITS = Object.freeze({
  maxWindows: 16,
  maxTabsPerWindow: 32,
  maxPaneStateBytes: 16 * 1024,
  maxTabIdChars: 128,
  maxTitleChars: 120,
  maxRelativePathBytes: 4096,
  maxTemplateIdChars: 96
});

const PANE_TYPES = Object.freeze([
  'markdown', 'text', 'image', 'browser', 'video-template', 'terminal', 'artifact'
]);
const ARTIFACT_KINDS = Object.freeze(['markdown', 'text', 'image', 'html']);
const ERROR_CODES = Object.freeze({
  invalid: 'ERR_PROJECT_LAYOUT_INVALID',
  preset: 'ERR_PROJECT_LAYOUT_PRESET',
  size: 'ERR_PROJECT_LAYOUT_SIZE',
  artifact: 'ERR_PROJECT_LAYOUT_ARTIFACT'
});
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const PRESETS = deepFreeze({
  'split-two': [
    { window: 1, label: '窗口1', slot: 'left' },
    { window: 2, label: '窗口2', slot: 'right' }
  ],
  'left-stack': [
    { window: 1, label: '窗口1', slot: 'left-top' },
    { window: 2, label: '窗口2', slot: 'left-bottom' },
    { window: 3, label: '窗口3', slot: 'right' }
  ],
  'grid-four': [
    { window: 1, label: '窗口1', slot: 'left-top' },
    { window: 2, label: '窗口2', slot: 'left-bottom' },
    { window: 3, label: '窗口3', slot: 'right-top' },
    { window: 4, label: '窗口4', slot: 'right-bottom' }
  ]
});

function layoutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalid(message) {
  throw layoutError(ERROR_CODES.invalid, message);
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

function windowNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > LIMITS.maxWindows) {
    invalid('窗口编号必须在 1–16 之间');
  }
  return value;
}

function windowLabel(value) {
  return `窗口${windowNumber(value)}`;
}

function presetName(value) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(PRESETS, value)) {
    throw layoutError(ERROR_CODES.preset, '布局预设无效');
  }
  return value;
}

function safeText(value, field, maximum) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || value.length > maximum || CONTROL_RE.test(value)) {
    invalid(`${field} 无效`);
  }
  return value;
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxRelativePathBytes
      || CONTROL_RE.test(value) || value.includes('\\') || value.startsWith('/')
      || /^[A-Za-z]:\//.test(value)) {
    invalid('窗格相对路径无效');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    invalid('窗格相对路径无效');
  }
  return value;
}

function browserUrl(value) {
  safeText(value, '浏览器地址', 4096);
  let parsed;
  try { parsed = new URL(value); } catch (_error) { invalid('浏览器地址无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) invalid('浏览器只允许 http/https');
  return value;
}

function templateId(value) {
  safeText(value, '短视频模板 id', LIMITS.maxTemplateIdChars);
  if (!/^(?:builtin|user):[^\\/]+$/.test(value)) invalid('短视频模板 id 无效');
  return value;
}

function validateFingerprint(value) {
  if (!exactKeys(value, ['size', 'mtime', 'sha256'])
      || !Number.isSafeInteger(value.size) || value.size < 0
      || typeof value.mtime !== 'number' || !Number.isFinite(value.mtime) || value.mtime < 0
      || typeof value.sha256 !== 'string' || !SHA256_RE.test(value.sha256)) {
    throw layoutError(ERROR_CODES.artifact, '产物指纹无效');
  }
  return Object.freeze({
    size: value.size,
    mtime: value.mtime,
    sha256: value.sha256
  });
}

function validateArtifactDescriptor(value) {
  if (!isPlainObject(value) || !ARTIFACT_KINDS.includes(value.kind)) {
    throw layoutError(ERROR_CODES.artifact, '产物描述无效');
  }
  const html = value.kind === 'html';
  if (!exactKeys(value, ['window', 'path', 'kind', 'fingerprint'], html ? ['openMode'] : [])
      || (html && value.openMode !== 'electron-child')) {
    throw layoutError(ERROR_CODES.artifact, '产物描述字段无效');
  }
  let safePath;
  try { safePath = relativePath(value.path); }
  catch (_error) { throw layoutError(ERROR_CODES.artifact, '产物相对路径无效'); }
  return deepFreeze({
    window: windowNumber(value.window),
    path: safePath,
    kind: value.kind,
    fingerprint: validateFingerprint(value.fingerprint),
    ...(html ? { openMode: 'electron-child' } : {})
  });
}

function validateTab(value, expectedWindow) {
  if (!isPlainObject(value) || !PANE_TYPES.includes(value.type)) invalid('窗格标签无效');
  const base = ['id', 'type', 'title'];
  const id = safeText(value.id, '标签 id', LIMITS.maxTabIdChars);
  const title = safeText(value.title, '标签标题', LIMITS.maxTitleChars);
  if (['markdown', 'text', 'image'].includes(value.type)) {
    if (!exactKeys(value, [...base, 'path'])) invalid('文件标签字段无效');
    return Object.freeze({ id, type: value.type, title, path: relativePath(value.path) });
  }
  if (value.type === 'browser') {
    if (!exactKeys(value, [...base, 'url'])) invalid('浏览器标签字段无效');
    return Object.freeze({ id, type: 'browser', title, url: browserUrl(value.url) });
  }
  if (value.type === 'video-template') {
    if (!exactKeys(value, [...base, 'templateId'])) invalid('短视频模板标签字段无效');
    return Object.freeze({
      id, type: 'video-template', title, templateId: templateId(value.templateId)
    });
  }
  if (value.type === 'terminal') {
    if (!exactKeys(value, base)) invalid('终端标签字段无效');
    return Object.freeze({ id, type: 'terminal', title });
  }
  if (!exactKeys(value, [...base, 'descriptor', 'locked']) || value.locked !== true) {
    throw layoutError(ERROR_CODES.artifact, '产物标签必须锁定');
  }
  const descriptor = validateArtifactDescriptor(value.descriptor);
  if (descriptor.window !== expectedWindow) {
    throw layoutError(ERROR_CODES.artifact, '产物与目标窗口不匹配');
  }
  return deepFreeze({ id, type: 'artifact', title, descriptor, locked: true });
}

function validateWindow(value) {
  if (!exactKeys(value, ['window', 'label', 'tabs', 'active', 'collapsed'])) {
    invalid('窗口状态字段无效');
  }
  const number = windowNumber(value.window);
  if (value.label !== windowLabel(number) || !Array.isArray(value.tabs)
      || value.tabs.length > LIMITS.maxTabsPerWindow
      || typeof value.collapsed !== 'boolean') {
    invalid('窗口状态无效');
  }
  const tabs = value.tabs.map((tab) => validateTab(tab, number));
  if (new Set(tabs.map((tab) => tab.id)).size !== tabs.length) invalid('窗口标签 id 重复');
  if (tabs.length === 0 ? value.active !== null
    : typeof value.active !== 'string' || !tabs.some((tab) => tab.id === value.active)) {
    invalid('窗口 active 标签无效');
  }
  const locked = tabs.filter((tab) => tab.type === 'artifact' && tab.locked === true);
  if (locked.length && (locked.length !== 1 || tabs.length !== 1 || value.active !== locked[0].id)) {
    throw layoutError(ERROR_CODES.artifact, '锁定产物必须是窗口唯一活动标签');
  }
  return deepFreeze({
    window: number,
    label: windowLabel(number),
    tabs,
    active: value.active,
    collapsed: value.collapsed
  });
}

function emptyWindow(number) {
  return deepFreeze({
    window: windowNumber(number),
    label: windowLabel(number),
    tabs: [],
    active: null,
    collapsed: false
  });
}

function validatePaneState(value) {
  if (!exactKeys(value, ['schemaVersion', 'preset', 'windows'])
      || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.windows)
      || value.windows.length < 1 || value.windows.length > LIMITS.maxWindows) {
    invalid('项目窗格状态无效');
  }
  const preset = presetName(value.preset);
  const windows = value.windows.map(validateWindow).sort((left, right) => left.window - right.window);
  const numbers = windows.map((item) => item.window);
  if (new Set(numbers).size !== numbers.length
      || PRESETS[preset].some((slot) => !numbers.includes(slot.window))) {
    invalid('项目窗格缺少预设窗口或编号重复');
  }
  const result = { schemaVersion: SCHEMA_VERSION, preset, windows };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LIMITS.maxPaneStateBytes) {
    throw layoutError(ERROR_CODES.size, '项目窗格状态超过 16 KiB');
  }
  return deepFreeze(result);
}

function createPaneState(preset = 'split-two') {
  const name = presetName(preset);
  return validatePaneState({
    schemaVersion: SCHEMA_VERSION,
    preset: name,
    windows: PRESETS[name].map((slot) => emptyWindow(slot.window))
  });
}

function applyPreset(value, preset) {
  const current = validatePaneState(value);
  const name = presetName(preset);
  const windows = [...current.windows];
  const existing = new Set(windows.map((item) => item.window));
  for (const slot of PRESETS[name]) {
    if (!existing.has(slot.window)) windows.push(emptyWindow(slot.window));
  }
  return validatePaneState({ schemaVersion: SCHEMA_VERSION, preset: name, windows });
}

function ensureTargetWindow(value, target, fallbackPreset = 'split-two') {
  const number = windowNumber(target);
  const current = value === null || value === undefined
    ? createPaneState(fallbackPreset)
    : validatePaneState(value);
  if (current.windows.some((item) => item.window === number)) {
    if (Object.isFrozen(value) && JSON.stringify(value) === JSON.stringify(current)) return value;
    return current;
  }
  const windows = [...current.windows];
  const existing = new Set(windows.map((item) => item.window));
  // 窗口编号是用户可见且稳定的；补到目标编号，避免出现跳号。
  for (let candidate = 1; candidate <= number; candidate += 1) {
    if (!existing.has(candidate)) windows.push(emptyWindow(candidate));
  }
  return validatePaneState({
    schemaVersion: SCHEMA_VERSION,
    preset: current.preset,
    windows
  });
}

function artifactTitle(descriptor) {
  const leaf = descriptor.path.split('/').at(-1);
  const available = LIMITS.maxTitleChars - 3;
  return `产物：${leaf.length > available ? `${leaf.slice(0, available - 1)}…` : leaf}`;
}

function lockArtifact(window, descriptor) {
  const current = validateWindow(window);
  const artifact = validateArtifactDescriptor(descriptor);
  if (current.window !== artifact.window) {
    throw layoutError(ERROR_CODES.artifact, '产物与目标窗口不匹配');
  }
  const id = `artifact-${artifact.fingerprint.sha256.slice(0, 32)}`;
  const next = deepFreeze({
    window: current.window,
    label: windowLabel(current.window),
    tabs: [deepFreeze({
      id,
      type: 'artifact',
      title: artifactTitle(artifact),
      descriptor: artifact,
      locked: true
    })],
    active: id,
    collapsed: false
  });
  if (Object.isFrozen(window) && JSON.stringify(window) === JSON.stringify(next)) return window;
  return next;
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  LIMITS,
  PRESETS,
  PANE_TYPES,
  ARTIFACT_KINDS,
  ERROR_CODES,
  windowLabel,
  validateArtifactDescriptor,
  validateWindow,
  validatePaneState,
  createPaneState,
  applyPreset,
  ensureTargetWindow,
  lockArtifact
});
