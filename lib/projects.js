'use strict';

// v0.11 项目注册表：鲸坞自有的「项目」一等对象。
//
// 项目 = 稳定 id + 名称/图标 + 项目文件夹 + 绑定的 dsh 会话 + 布局 + 排序/隐藏。
// 产品模型学自 dsh-worktable（项目↔对话绑定、项目文件夹、布局按项目持久化、
// 固定首位不可删除的「控制室」），但状态不放浏览器 localStorage，而是 app-owned JSON：
// 原子写、fail-closed 校验、坏文件隔离、可订阅 revision。
//
// 身份规则：id 由鲸坞随机生成，改名 / 换文件夹 / 移动都不改 id。这是
// docs/开发方案-v0.10-A2.1 §5 要求的「app-owned UUID registry」路线。
// 可选的 `.whaledock/project.json` 旁车让文件夹带着身份走，换机器也能被重新认领。
//
// 边界：
// - 保持纯 Node：不依赖 Electron，不含 dsh wire 假设，必须能被 test/smoke.js 直接加载；
// - 项目文件夹复用 workspaces.canonicalWorkspace 的口径：必须存在、是目录、realpath 后
//   不落入受保护根（~/.dsh）；
// - publicView 不含绝对路径，只给最后一段目录名；
// - 本模块不执行任何东西，不读项目文件夹里除旁车之外的任何文件。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const workspaces = require('./workspaces');

const SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_DIRNAME = '.whaledock';
const MANIFEST_FILENAME = 'project.json';

const LIMITS = Object.freeze({
  maxProjects: 128,
  maxNameChars: 40,
  maxIconChars: 8,
  maxSessionRefChars: 128,
  maxLayoutPresetChars: 32,
  maxPaneStateBytes: 16 * 1024,
  maxPaneStateDepth: 8,
  maxManifestBytes: 4 * 1024,
  maxRegistryBytes: 4 * 1024 * 1024,
  maxOrder: 1000000,
  maxQuarantineFiles: 3
});

const PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
const CONSOLE_PROJECT_ID = `proj_${'0'.repeat(31)}1`;
const CONSOLE_DEFAULTS = Object.freeze({ name: '控制室', icon: '🖥️' });
const KINDS = Object.freeze(['user', 'builtin']);
const SESSION_REF_RE = /^session-binding-[a-f0-9]{64}$/;
const LAYOUT_PRESET_RE = /^[a-z][a-z0-9-]{0,31}$/;
// 与 lib/config.js normalizeWorkbenchId 同口径：builtin:/user: 前缀，≤96 字符，
// 不含控制字符与路径分隔符；包 id 本身允许中文目录名（如 builtin:短视频创作台）。
const WORKBENCH_ID_RE = /^(?:builtin|user):[^\u0000-\u001f\u007f\\/]{1,88}$/;
const SINGLE_LINE_BAD_RE = /[\u0000-\u001f\u007f]/;
const ICON_BAD_RE = /[\s\u0000-\u001f\u007f]/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const RECORD_REQUIRED = Object.freeze([
  'id', 'kind', 'name', 'icon', 'folder', 'boundSession', 'templateId', 'layoutPreset',
  'paneState', 'order', 'hidden', 'pinned', 'createdAt', 'updatedAt', 'lastOpenedAt', 'openCount'
]);
const UPDATABLE_USER_KEYS = Object.freeze([
  'name', 'icon', 'folder', 'templateId', 'layoutPreset', 'paneState', 'hidden', 'pinned'
]);
const UPDATABLE_BUILTIN_KEYS = Object.freeze(['name', 'icon', 'layoutPreset', 'paneState']);

function projectError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function invalid(field, message) {
  const error = projectError('ERR_PROJECT_INVALID', message);
  error.field = field;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (plainRecord(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = clone(item);
    return result;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function pathTools(platform, supplied) {
  if (supplied) return supplied;
  return platform === 'win32' ? path.win32 : path.posix;
}

function isoNow(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('now', '时间源无效');
  return date.toISOString();
}

// ---------- 字段校验 ----------

function validateId(value, field = 'id') {
  if (typeof value !== 'string' || !PROJECT_ID_RE.test(value)) {
    throw invalid(field, `${field} 不是合法的项目 id`);
  }
  return value;
}

function validateKind(value) {
  if (!KINDS.includes(value)) throw invalid('kind', 'kind 只能是 user 或 builtin');
  return value;
}

function validateName(value) {
  if (typeof value !== 'string') throw invalid('name', '项目名称必须是字符串');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > LIMITS.maxNameChars || SINGLE_LINE_BAD_RE.test(trimmed)) {
    throw invalid('name', `项目名称必须是 1–${LIMITS.maxNameChars} 个字符的单行文本`);
  }
  return trimmed;
}

function validateIcon(value) {
  if (value === undefined || value === null || value === '') return '🧱';
  if (typeof value !== 'string' || value.length > LIMITS.maxIconChars || ICON_BAD_RE.test(value)) {
    throw invalid('icon', `项目图标必须是不含空白的 1–${LIMITS.maxIconChars} 个字符`);
  }
  return value;
}

function validateSessionRef(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > LIMITS.maxSessionRefChars || !SESSION_REF_RE.test(value)) {
    throw invalid('boundSession', '绑定会话引用无效');
  }
  return value;
}

function validateTemplateId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !WORKBENCH_ID_RE.test(value)) {
    throw invalid('templateId', '项目模板必须是 builtin:<id> 或 user:<id>');
  }
  return value;
}

function validateLayoutPreset(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > LIMITS.maxLayoutPresetChars || !LAYOUT_PRESET_RE.test(value)) {
    throw invalid('layoutPreset', '布局预设 id 无效');
  }
  return value;
}

function assertJsonValue(value, depth, field) {
  if (depth > LIMITS.maxPaneStateDepth) throw invalid(field, '布局状态嵌套过深');
  if (value === null) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw invalid(field, '布局状态含非有限数字');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1, field);
    return;
  }
  if (plainRecord(value)) {
    for (const item of Object.values(value)) assertJsonValue(item, depth + 1, field);
    return;
  }
  throw invalid(field, '布局状态只能是普通 JSON 值');
}

function validatePaneState(value) {
  if (value === null || value === undefined) return null;
  if (!plainRecord(value)) throw invalid('paneState', '布局状态必须是普通对象');
  assertJsonValue(value, 1, 'paneState');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > LIMITS.maxPaneStateBytes) {
    throw invalid('paneState', `布局状态超过 ${LIMITS.maxPaneStateBytes} 字节`);
  }
  return clone(value);
}

function validateOrder(value) {
  if (!Number.isInteger(value) || value < 0 || value > LIMITS.maxOrder) {
    throw invalid('order', '排序值无效');
  }
  return value;
}

function validateBoolean(value, field) {
  if (typeof value !== 'boolean') throw invalid(field, `${field} 必须是布尔值`);
  return value;
}

function validateIso(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalid(field, `${field} 必须是 ISO 时间`);
  }
  return value;
}

function validateCount(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw invalid(field, `${field} 必须是非负整数`);
  }
  return value;
}

// 已存储的文件夹只做字面校验（磁盘可能暂时不在），认领 / 新建时才做 canonical 校验。
function validateStoredFolder(value, platform, tools) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value || value.includes('\0') || !tools.isAbsolute(value)
      || SINGLE_LINE_BAD_RE.test(value) || value.length > 4096) {
    throw invalid('folder', '项目文件夹必须是绝对路径');
  }
  return config.normalizeRealPath(value, { platform, pathImpl: tools });
}

function folderKey(folder, platform) {
  if (folder === null) return null;
  return platform === 'win32' ? folder.toLocaleLowerCase('en-US') : folder;
}

function canonicalFolder(value, options) {
  const assertIsolated = (candidate) => {
    const roots = options.forbiddenRoots;
    if (!Array.isArray(roots)) return;
    const tools = options.pathImpl;
    const keyOf = (entry) => {
      const normalized = config.normalizeRealPath(tools.resolve(entry), {
        platform: options.platform,
        pathImpl: tools
      });
      return options.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
    };
    const contains = (parent, child) => (
      child === parent || child.startsWith(parent.endsWith(tools.sep) ? parent : `${parent}${tools.sep}`)
    );
    let candidateKey;
    try { candidateKey = keyOf(candidate); } catch (_error) { return; }
    for (const rawRoot of roots) {
      const variants = [];
      try { variants.push(keyOf(rawRoot)); } catch (_error) { /* canonicalWorkspace 会拒绝坏策略 */ }
      // 不读取受保护根本身；只 canonicalize 它的父目录，覆盖 home/userData 自身为 symlink 的情况。
      try {
        const parent = config.nativeRealpathSync(options.fsImpl)(tools.dirname(tools.resolve(rawRoot)));
        variants.push(keyOf(tools.join(parent, tools.basename(rawRoot))));
      } catch (_error) { /* 父目录不存在时保留字面保护 */ }
      if (variants.some((root) => contains(root, candidateKey) || contains(candidateKey, root))) {
        throw projectError('ERR_PROJECT_PROTECTED', '项目文件夹不能包含或位于鲸坞受保护目录');
      }
    }
  };

  let canonical;
  try {
    assertIsolated(value);
    canonical = workspaces.canonicalWorkspace(value, {
      fsImpl: options.fsImpl,
      platform: options.platform,
      pathImpl: options.pathImpl,
      forbiddenRoots: options.forbiddenRoots
    });
    assertIsolated(canonical.path);
  } catch (error) {
    if (error && (error.code === 'ERR_WORKSPACE_PROTECTED' || error.code === 'ERR_PROJECT_PROTECTED')) {
      throw projectError('ERR_PROJECT_PROTECTED', '项目文件夹不能位于鲸坞禁止使用的受保护目录', error);
    }
    throw projectError('ERR_PROJECT_FOLDER', '项目文件夹不存在、不是目录或无法访问', error);
  }
  return canonical;
}

// 给 main-only 运行时回读复用的公开解析器。项目创建/认领与每次读取前的
// live revalidation 必须共用同一个“候选不得位于或包含受保护根”口径。
// 保持纯 Node：返回值与 workspaces.canonicalWorkspace 一致，不暴露 store 内部状态。
function canonicalProjectFolder(value, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const forbiddenRoots = options.forbiddenRoots === undefined
    ? config.protectedWorkspaceRoots({
      platform,
      pathImpl: tools,
      fsImpl,
      homeDir: options.homeDir
    })
    : options.forbiddenRoots;
  return canonicalFolder(value, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
}

function normalizeRecord(raw, options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  if (!plainRecord(raw)) throw invalid('project', '项目记录必须是普通对象');
  for (const key of RECORD_REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) throw invalid(`project.${key}`, `项目记录缺少 ${key}`);
  }
  for (const key of Object.keys(raw)) {
    if (!RECORD_REQUIRED.includes(key)) throw invalid(`project.${key}`, `项目记录含未知字段 ${key}`);
  }
  const kind = validateKind(raw.kind);
  const id = validateId(raw.id);
  if ((kind === 'builtin') !== (id === CONSOLE_PROJECT_ID)) {
    throw invalid('project.kind', '只有控制室可以是 builtin 项目');
  }
  const folder = validateStoredFolder(raw.folder, platform, tools);
  if (kind === 'builtin' && folder !== null) throw invalid('project.folder', '控制室没有项目文件夹');
  return {
    id,
    kind,
    name: validateName(raw.name),
    icon: validateIcon(raw.icon),
    folder,
    boundSession: validateSessionRef(raw.boundSession),
    templateId: validateTemplateId(raw.templateId),
    layoutPreset: validateLayoutPreset(raw.layoutPreset),
    paneState: validatePaneState(raw.paneState),
    order: validateOrder(raw.order),
    hidden: validateBoolean(raw.hidden, 'hidden'),
    pinned: validateBoolean(raw.pinned, 'pinned'),
    createdAt: validateIso(raw.createdAt, 'createdAt'),
    updatedAt: validateIso(raw.updatedAt, 'updatedAt'),
    lastOpenedAt: validateIso(raw.lastOpenedAt, 'lastOpenedAt', true),
    openCount: validateCount(raw.openCount, 'openCount')
  };
}

function normalizeRegistry(raw, options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  options = { ...options, platform, pathImpl: tools };
  if (!plainRecord(raw)) throw invalid('registry', '注册表必须是普通对象');
  if (raw.schemaVersion !== SCHEMA_VERSION) throw invalid('registry.schemaVersion', '注册表 schema 不受支持');
  if (!Array.isArray(raw.projects)) throw invalid('registry.projects', '注册表 projects 必须是数组');
  for (const key of Object.keys(raw)) {
    if (key !== 'schemaVersion' && key !== 'projects') throw invalid(`registry.${key}`, `注册表含未知字段 ${key}`);
  }
  const maxProjects = options.maxProjects || LIMITS.maxProjects;
  if (raw.projects.length > maxProjects) throw invalid('registry.projects', '注册表项目数超过上限');
  const ids = new Set();
  const folders = new Set();
  const sessions = new Set();
  const projects = raw.projects.map((item) => {
    const record = normalizeRecord(item, options);
    if (ids.has(record.id)) throw invalid('registry.projects', `项目 id 重复：${record.id}`);
    ids.add(record.id);
    const key = folderKey(record.folder, options.platform);
    if (key !== null) {
      if (folders.has(key)) throw invalid('registry.projects', '两个项目指向同一个文件夹');
      folders.add(key);
    }
    if (record.kind === 'builtin' && record.boundSession !== null) {
      throw invalid('registry.projects', '控制室不能绑定会话');
    }
    if (record.boundSession !== null) {
      if (sessions.has(record.boundSession)) throw invalid('registry.projects', '两个项目不能绑定同一会话');
      sessions.add(record.boundSession);
    }
    return record;
  });
  return { schemaVersion: SCHEMA_VERSION, projects };
}

function compareProjects(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function folderTail(folder, tools) {
  if (folder === null) return null;
  const base = tools.basename(folder);
  return base || folder;
}

function publicProject(record, tools) {
  return deepFreeze({
    id: record.id,
    kind: record.kind,
    name: record.name,
    icon: record.icon,
    hasFolder: record.folder !== null,
    folderTail: folderTail(record.folder, tools),
    boundSession: record.boundSession,
    templateId: record.templateId,
    layoutPreset: record.layoutPreset,
    paneState: clone(record.paneState),
    order: record.order,
    hidden: record.hidden,
    pinned: record.pinned,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    openCount: record.openCount
  });
}

// ---------- 旁车 manifest（可选，显式写入） ----------

function normalizeManifest(raw) {
  if (!plainRecord(raw)) throw invalid('manifest', '项目旁车必须是普通对象');
  if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw invalid('manifest.schemaVersion', '项目旁车 schema 不受支持');
  const allowed = new Set(['schemaVersion', 'id', 'name', 'icon', 'templateId', 'createdAt']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw invalid(`manifest.${key}`, `项目旁车含未知字段 ${key}`);
  }
  const id = validateId(raw.id, 'manifest.id');
  if (id === CONSOLE_PROJECT_ID) throw invalid('manifest.id', '控制室不能作为旁车项目');
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id,
    name: validateName(raw.name),
    icon: validateIcon(raw.icon),
    templateId: validateTemplateId(raw.templateId),
    createdAt: validateIso(raw.createdAt, 'manifest.createdAt')
  };
}

function manifestPath(folder, tools) {
  return tools.join(folder, MANIFEST_DIRNAME, MANIFEST_FILENAME);
}

function newProjectId(randomBytes = crypto.randomBytes) {
  return `proj_${randomBytes(16).toString('hex')}`;
}

// ---------- 存储 ----------

function createProjectStore(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const randomId = typeof options.randomId === 'function'
    ? options.randomId : () => crypto.randomBytes(8).toString('hex');
  const maxProjects = options.maxProjects || LIMITS.maxProjects;
  const forbiddenRoots = Array.isArray(options.forbiddenRoots)
    ? options.forbiddenRoots
    : config.protectedWorkspaceRoots({ platform, pathImpl: tools, fsImpl, homeDir: options.homeDir });

  let filePath;
  if (typeof options.filePath === 'string' && options.filePath) {
    filePath = tools.resolve(options.filePath);
  } else if (typeof options.baseDir === 'string' && options.baseDir) {
    filePath = tools.join(tools.resolve(options.baseDir), 'projects', 'registry.json');
  } else {
    throw invalid('filePath', '必须提供 filePath 或 baseDir');
  }
  const normalizeOptions = { platform, pathImpl: tools, maxProjects };

  let state = { schemaVersion: SCHEMA_VERSION, projects: [] };
  let revision = 0;
  let lastRecovery = null;
  const listeners = new Set();

  const notify = () => {
    for (const listener of listeners) {
      try { listener(snapshot()); } catch (_error) { /* 监听者异常不影响存储 */ }
    }
  };

  const atomicWrite = (value) => {
    const normalized = normalizeRegistry(value, normalizeOptions);
    fsImpl.mkdirSync(tools.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp-${process.pid}-${randomId()}`;
    try {
      fsImpl.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      if (platform !== 'win32' && typeof fsImpl.chmodSync === 'function') fsImpl.chmodSync(tmp, 0o600);
      fsImpl.renameSync(tmp, filePath);
    } catch (error) {
      try { fsImpl.unlinkSync(tmp); } catch (_cleanupError) { /* 原子写清理尽力而为 */ }
      throw projectError('ERR_PROJECT_STORE_WRITE', '项目注册表写入失败', error);
    }
    return normalized;
  };

  const quarantineInvalid = () => {
    const stamp = isoNow(now).replace(/[:.]/g, '-');
    const target = `${filePath}.invalid-${stamp}-${randomId()}`;
    try { fsImpl.renameSync(filePath, target); } catch (error) {
      throw projectError('ERR_PROJECT_STORE_QUARANTINE', '无法保留坏注册表诊断备份', error);
    }
    try {
      const prefix = `${tools.basename(filePath)}.invalid-`;
      const rows = fsImpl.readdirSync(tools.dirname(filePath))
        .filter((name) => name.startsWith(prefix)).sort().reverse();
      for (const name of rows.slice(LIMITS.maxQuarantineFiles)) {
        try { fsImpl.unlinkSync(tools.join(tools.dirname(filePath), name)); } catch (_error) { /* 有界清理尽力 */ }
      }
    } catch (_error) { /* 备份已保留，列表失败不扩大 */ }
    return target;
  };

  const readFromDisk = () => {
    let raw;
    try { raw = fsImpl.readFileSync(filePath, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw projectError('ERR_PROJECT_STORE_READ', '项目注册表读取失败', error);
    }
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxRegistryBytes) {
      throw invalid('registry', '项目注册表文件过大');
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) {
      throw invalid('registry', '项目注册表 JSON 无效');
    }
    return normalizeRegistry(parsed, normalizeOptions);
  };

  const load = () => {
    let loaded = null;
    try {
      loaded = readFromDisk();
    } catch (error) {
      if (!error || error.code !== 'ERR_PROJECT_INVALID') throw error;
      // 坏文件：隔离为诊断备份并从空表继续，不让一次坏写毁掉整个入口。
      const target = quarantineInvalid();
      lastRecovery = Object.freeze({ at: isoNow(now), quarantined: target, reason: error.message });
      loaded = null;
    }
    state = loaded || { schemaVersion: SCHEMA_VERSION, projects: [] };
    revision += 1;
  };

  const persist = (nextProjects) => {
    const next = { schemaVersion: SCHEMA_VERSION, projects: nextProjects };
    state = atomicWrite(next);
    revision += 1;
    notify();
  };

  const findIndex = (id) => state.projects.findIndex((item) => item.id === id);

  const requireRecord = (id) => {
    validateId(id);
    const index = findIndex(id);
    if (index < 0) throw projectError('ERR_PROJECT_NOT_FOUND', '项目不存在');
    return { index, record: state.projects[index] };
  };

  const assertFolderFree = (canonicalKey, exceptId) => {
    for (const item of state.projects) {
      if (item.id === exceptId) continue;
      if (folderKey(item.folder, platform) === canonicalKey) {
        throw projectError('ERR_PROJECT_DUPLICATE_FOLDER', '这个文件夹已经是另一个项目');
      }
    }
  };

  const assertSessionFree = (sessionRef, exceptId) => {
    if (sessionRef === null) return;
    for (const item of state.projects) {
      if (item.id !== exceptId && item.boundSession === sessionRef) {
        throw projectError('ERR_PROJECT_SESSION_BOUND', '这个对话已经绑定到另一个项目');
      }
    }
  };

  const safeSidecarDirectory = (canonicalPath, create) => {
    const dir = tools.join(canonicalPath, MANIFEST_DIRNAME);
    let stat;
    try { stat = fsImpl.lstatSync(dir); } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw projectError('ERR_PROJECT_MANIFEST', '项目旁车目录无法检查', error);
      }
      if (!create) return null;
      try {
        fsImpl.mkdirSync(dir, { mode: 0o700 });
        stat = fsImpl.lstatSync(dir);
      } catch (mkdirError) {
        throw projectError('ERR_PROJECT_MANIFEST', '项目旁车目录无法创建', mkdirError);
      }
    }
    if (!stat || typeof stat.isDirectory !== 'function' || !stat.isDirectory()
        || (typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink())) {
      throw projectError('ERR_PROJECT_PROTECTED', '项目旁车目录不能是 symlink、junction 或普通文件');
    }
    let real;
    try { real = config.nativeRealpathSync(fsImpl)(dir); } catch (error) {
      throw projectError('ERR_PROJECT_MANIFEST', '项目旁车目录真实路径无法验证', error);
    }
    const expected = config.normalizeRealPath(dir, { platform, pathImpl: tools });
    const actual = config.normalizeRealPath(real, { platform, pathImpl: tools });
    if (folderKey(expected, platform) !== folderKey(actual, platform)) {
      throw projectError('ERR_PROJECT_PROTECTED', '项目旁车目录越出项目文件夹');
    }
    return dir;
  };

  const nextOrder = () => {
    let max = -1;
    for (const item of state.projects) if (item.kind === 'user' && item.order > max) max = item.order;
    return max + 1;
  };

  function snapshot() {
    return deepFreeze({
      revision,
      projects: state.projects.slice().sort(compareProjects).map((item) => publicProject(item, tools))
    });
  }

  function list(listOptions = {}) {
    const includeHidden = listOptions.includeHidden !== false;
    return state.projects.slice().sort(compareProjects)
      .filter((item) => includeHidden || !item.hidden)
      .map((item) => publicProject(item, tools));
  }

  function get(id) {
    validateId(id);
    const index = findIndex(id);
    return index < 0 ? null : publicProject(state.projects[index], tools);
  }

  function folderOf(id) {
    return requireRecord(id).record.folder;
  }

  function folderExists(id) {
    const folder = requireRecord(id).record.folder;
    if (folder === null) return false;
    // 持久化路径不是永久能力：祖先 symlink/junction 可在登记后漂移。
    // 与创建/认领/main 读前回读共用双向隔离解析，失败时只回报不可用。
    try {
      canonicalProjectFolder(folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
      return true;
    } catch (_error) {
      return false;
    }
  }

  function ensureConsole() {
    const index = findIndex(CONSOLE_PROJECT_ID);
    if (index >= 0) return publicProject(state.projects[index], tools);
    const stamp = isoNow(now);
    const record = {
      id: CONSOLE_PROJECT_ID,
      kind: 'builtin',
      name: CONSOLE_DEFAULTS.name,
      icon: CONSOLE_DEFAULTS.icon,
      folder: null,
      boundSession: null,
      templateId: null,
      layoutPreset: null,
      paneState: null,
      order: 0,
      hidden: false,
      pinned: true,
      createdAt: stamp,
      updatedAt: stamp,
      lastOpenedAt: null,
      openCount: 0
    };
    persist([record, ...state.projects]);
    return publicProject(record, tools);
  }

  function createWithId(id, input) {
    if (!plainRecord(input)) throw invalid('project', '新建项目必须是普通对象');
    const allowed = new Set(['name', 'icon', 'folder', 'templateId', 'layoutPreset', 'paneState', 'boundSession']);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) throw invalid(`project.${key}`, `新建项目不接受字段 ${key}`);
    }
    if (state.projects.filter((item) => item.kind === 'user').length >= maxProjects - 1) {
      throw projectError('ERR_PROJECT_LIMIT', `项目数量已达上限 ${maxProjects - 1}`);
    }
    if (findIndex(id) >= 0) throw projectError('ERR_PROJECT_DUPLICATE_ID', '项目 id 已存在');
    if (input.folder === undefined || input.folder === null) throw invalid('folder', '新建项目必须指定项目文件夹');
    const canonical = canonicalFolder(input.folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
    assertFolderFree(canonical.key, null);
    const stamp = isoNow(now);
    const boundSession = validateSessionRef(input.boundSession);
    assertSessionFree(boundSession, null);
    const record = {
      id,
      kind: 'user',
      name: validateName(input.name === undefined ? tools.basename(canonical.path) : input.name),
      icon: validateIcon(input.icon),
      folder: canonical.path,
      boundSession,
      templateId: validateTemplateId(input.templateId),
      layoutPreset: validateLayoutPreset(input.layoutPreset),
      paneState: validatePaneState(input.paneState),
      order: nextOrder(),
      hidden: false,
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp,
      lastOpenedAt: null,
      openCount: 0
    };
    persist([...state.projects, record]);
    return publicProject(record, tools);
  }

  function create(input) {
    return createWithId(newProjectId(randomBytes), input);
  }

  function update(id, patch) {
    const { index, record } = requireRecord(id);
    if (!plainRecord(patch)) throw invalid('patch', '更新内容必须是普通对象');
    const allowed = record.kind === 'builtin' ? UPDATABLE_BUILTIN_KEYS : UPDATABLE_USER_KEYS;
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) throw invalid(`patch.${key}`, `项目不接受更新字段 ${key}`);
    }
    const next = { ...record };
    if ('name' in patch) next.name = validateName(patch.name);
    if ('icon' in patch) next.icon = validateIcon(patch.icon);
    if ('templateId' in patch) next.templateId = validateTemplateId(patch.templateId);
    if ('layoutPreset' in patch) next.layoutPreset = validateLayoutPreset(patch.layoutPreset);
    if ('paneState' in patch) next.paneState = validatePaneState(patch.paneState);
    if ('hidden' in patch) next.hidden = validateBoolean(patch.hidden, 'hidden');
    if ('pinned' in patch) next.pinned = validateBoolean(patch.pinned, 'pinned');
    if ('folder' in patch) {
      if (patch.folder === null) throw invalid('folder', '项目不能没有文件夹');
      const canonical = canonicalFolder(patch.folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
      assertFolderFree(canonical.key, id);
      next.folder = canonical.path;
    }
    next.updatedAt = isoNow(now);
    const projects = state.projects.slice();
    projects[index] = next;
    persist(projects);
    return publicProject(next, tools);
  }

  function remove(id) {
    const { index, record } = requireRecord(id);
    if (record.kind === 'builtin') throw projectError('ERR_PROJECT_BUILTIN', '控制室不能删除');
    const projects = state.projects.slice();
    projects.splice(index, 1);
    persist(projects);
    return true;
  }

  function bindSession(id, sessionRef) {
    const { index, record } = requireRecord(id);
    if (record.kind === 'builtin') throw projectError('ERR_PROJECT_BUILTIN', '控制室不能绑定会话');
    const validated = validateSessionRef(sessionRef);
    assertSessionFree(validated, id);
    const next = { ...record, boundSession: validated, updatedAt: isoNow(now) };
    const projects = state.projects.slice();
    projects[index] = next;
    persist(projects);
    return publicProject(next, tools);
  }

  function reorder(ids) {
    if (!Array.isArray(ids) || ids.length === 0) throw invalid('ids', '排序列表必须是非空数组');
    const seen = new Set();
    for (const id of ids) {
      const { record } = requireRecord(id);
      if (record.kind === 'builtin') throw projectError('ERR_PROJECT_BUILTIN', '控制室固定在首位，不参与排序');
      if (seen.has(id)) throw invalid('ids', `排序列表重复：${id}`);
      seen.add(id);
    }
    const stamp = isoNow(now);
    const orderOf = new Map(ids.map((id, index) => [id, index]));
    const rest = state.projects
      .filter((item) => item.kind === 'user' && !seen.has(item.id))
      .sort(compareProjects);
    rest.forEach((item, index) => orderOf.set(item.id, ids.length + index));
    const projects = state.projects.map((item) => (
      item.kind === 'user' ? { ...item, order: orderOf.get(item.id), updatedAt: stamp } : item
    ));
    persist(projects);
    return list();
  }

  function touchOpened(id) {
    const { index, record } = requireRecord(id);
    const stamp = isoNow(now);
    const next = { ...record, lastOpenedAt: stamp, openCount: record.openCount + 1 };
    const projects = state.projects.slice();
    projects[index] = next;
    persist(projects);
    return publicProject(next, tools);
  }

  function findByFolder(folder) {
    const canonical = canonicalFolder(folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
    const hit = state.projects.find((item) => folderKey(item.folder, platform) === canonical.key);
    return hit ? publicProject(hit, tools) : null;
  }

  function findBySession(sessionRef) {
    const ref = validateSessionRef(sessionRef);
    if (ref === null) return null;
    const hit = state.projects.find((item) => item.boundSession === ref);
    return hit ? publicProject(hit, tools) : null;
  }

  function readManifest(folder) {
    const canonical = canonicalFolder(folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
    const dir = safeSidecarDirectory(canonical.path, false);
    if (dir === null) return null;
    const file = tools.join(dir, MANIFEST_FILENAME);
    let stat;
    try { stat = fsImpl.lstatSync(file); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw projectError('ERR_PROJECT_MANIFEST', '项目旁车无法读取', error);
    }
    if (!stat.isFile() || stat.size > LIMITS.maxManifestBytes) {
      throw projectError('ERR_PROJECT_MANIFEST', '项目旁车不是普通文件或过大');
    }
    let parsed;
    try { parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch (error) {
      throw projectError('ERR_PROJECT_MANIFEST', '项目旁车 JSON 无效', error);
    }
    return deepFreeze(normalizeManifest(parsed));
  }

  function writeManifest(id) {
    const { record } = requireRecord(id);
    if (record.kind === 'builtin') throw projectError('ERR_PROJECT_BUILTIN', '控制室没有旁车');
    const canonical = canonicalFolder(record.folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
    const dir = safeSidecarDirectory(canonical.path, true);
    const file = tools.join(dir, MANIFEST_FILENAME);
    const manifest = normalizeManifest({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: record.id,
      name: record.name,
      icon: record.icon,
      templateId: record.templateId,
      createdAt: record.createdAt
    });
    const tmp = `${file}.tmp-${process.pid}-${randomId()}`;
    try {
      fsImpl.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      safeSidecarDirectory(canonical.path, false);
      fsImpl.renameSync(tmp, file);
    } catch (error) {
      try { fsImpl.unlinkSync(tmp); } catch (_cleanupError) { /* 尽力清理 */ }
      throw projectError('ERR_PROJECT_MANIFEST', '项目旁车写入失败', error);
    }
    return file;
  }

  // 认领文件夹：有旁车就沿用旁车 id；同 id 仅在旧项目根已经失效时视为搬家。
  // 旧根仍有效时，复制旁车不得静默劫持现有身份。没旁车就当新项目；任何情况下不写用户文件夹。
  function adoptFolder(folder, overrides = {}) {
    if (!plainRecord(overrides)) throw invalid('overrides', '认领参数必须是普通对象');
    const canonical = canonicalFolder(folder, { fsImpl, platform, pathImpl: tools, forbiddenRoots });
    const existing = state.projects.find((item) => folderKey(item.folder, platform) === canonical.key);
    if (existing) return { project: publicProject(existing, tools), adopted: 'existing' };
    const manifest = readManifest(canonical.path);
    if (manifest) {
      const index = findIndex(manifest.id);
      if (index >= 0) {
        const record = state.projects[index];
        if (folderExists(record.id)) {
          throw projectError(
            'ERR_PROJECT_IDENTITY_CONFLICT',
            '项目旁车 id 已由另一个仍有效的文件夹使用'
          );
        }
        const next = { ...record, folder: canonical.path, updatedAt: isoNow(now) };
        const projects = state.projects.slice();
        projects[index] = next;
        persist(projects);
        return { project: publicProject(next, tools), adopted: 'relinked' };
      }
      const project = createWithId(manifest.id, {
        name: overrides.name === undefined ? manifest.name : overrides.name,
        icon: overrides.icon === undefined ? manifest.icon : overrides.icon,
        templateId: overrides.templateId === undefined ? manifest.templateId : overrides.templateId,
        folder: canonical.path
      });
      return { project, adopted: 'manifest' };
    }
    const project = create({
      name: overrides.name,
      icon: overrides.icon,
      templateId: overrides.templateId,
      folder: canonical.path
    });
    return { project, adopted: 'new' };
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw invalid('listener', '监听者必须是函数');
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  load();

  return Object.freeze({
    filePath,
    get revision() { return revision; },
    get lastRecovery() { return lastRecovery; },
    reload: load,
    snapshot,
    list,
    get,
    folderOf,
    folderExists,
    ensureConsole,
    create,
    update,
    remove,
    bindSession,
    reorder,
    touchOpened,
    findByFolder,
    findBySession,
    readManifest,
    writeManifest,
    adoptFolder,
    subscribe
  });
}

module.exports = {
  SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_DIRNAME,
  MANIFEST_FILENAME,
  LIMITS,
  PROJECT_ID_RE,
  CONSOLE_PROJECT_ID,
  CONSOLE_DEFAULTS,
  newProjectId,
  canonicalProjectFolder,
  normalizeRecord,
  normalizeRegistry,
  normalizeManifest,
  createProjectStore
};
