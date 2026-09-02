'use strict';

// v0.11 全局项目与控制室 operation。模块只编排注入的项目存储、目录选择器和
// 控制室纯函数，不依赖 Electron、文件系统或 dsh 私有协议。
const crypto = require('crypto');
const projectLayout = require('./project-layout');

const PROJECT_OPERATION_NAMES = new Set([
  'projects.list', 'projects.create', 'projects.update', 'projects.remove',
  'projects.bind', 'projects.reorder', 'projects.open', 'console.read'
]);

const PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
const BINDING_REF_RE = /^session-binding-[a-f0-9]{64}$/;
const SESSION_ROOT_REF_RE = /^session-root-[a-f0-9]{64}$/;
const OPEN_TOKEN_RE = /^project-open-[a-f0-9]{64}$/;
const BOOTSTRAP_TICKET_RE = /^project-bootstrap-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{16,10923}\.[A-Za-z0-9_-]{22}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TEMPLATE_ID_RE = /^(?:builtin|user):[^\u0000-\u001f\u007f\\/]{1,88}$/;
const LAYOUT_PRESET_RE = /^[a-z][a-z0-9-]{0,31}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const BLOCK_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ICON_BAD_RE = /[\s\u0000-\u001f\u007f]/;
const GLOBAL_BINDING_KEYS = Object.freeze([
  'hostInstanceId', 'controllerId', 'pageInstanceId', 'selectionRevision'
]);
const PROJECT_UPDATE_KEYS = Object.freeze([
  'name', 'icon', 'hidden', 'layoutPreset', 'paneState'
]);
const STATUSES = new Set(['need', 'done', 'busy', 'idle']);
const MAX_PROJECTS = 128;
const MAX_PAGE = 32;
const MAX_NAME_CHARS = 40;
const MAX_ICON_CHARS = 8;
const MAX_PANE_BYTES = 16 * 1024;
const MAX_CONSOLE_INPUT_BYTES = 48 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 8192;
const CACHE_TTL_MS = 30_000;
const MAX_BINDING_CACHES = 64;
const MAX_OPEN_TOKENS = 128;
const MAX_TOKEN_ATTEMPTS = 8;
const MAX_TEMPLATE_ACTIONS = 12;
const MAX_TEMPLATE_ACTION_BYTES = 12 * 1024;
const MAX_TEMPLATE_CATALOG = 16;
const MAX_TEMPLATE_CATALOG_BYTES = 4 * 1024;
const MAX_PANE_PREVIEWS = 8;
const MAX_PANE_PREVIEW_BYTES = 8 * 1024;
const MAX_PANE_PREVIEW_TEXT_BYTES = 6 * 1024;
const MAX_PROJECT_DETAIL_BYTES = 20 * 1024;
const MAX_PROJECT_OPEN_RESULT_BYTES = 24 * 1024;
const MAX_PROJECT_BOOTSTRAP_TICKET_BYTES = 8 * 1024;
const ACTION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function operationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalid(message) {
  throw operationError('ERR_PROJECT_INVALID', message);
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function checkedNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目 operation 时钟无效');
  }
  return value;
}

function deadline(at) {
  const value = at + CACHE_TTL_MS;
  if (!Number.isSafeInteger(value) || value < at) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目 operation 截止时间无效');
  }
  return value;
}

function jsonBytes(value) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch (_error) { invalid('项目 operation JSON 无法序列化'); }
  if (typeof serialized !== 'string') invalid('项目 operation JSON 无法序列化');
  return Buffer.byteLength(serialized, 'utf8');
}

function cloneJson(value, options, depth = 0, counter = { value: 0 }) {
  counter.value += 1;
  if (counter.value > options.maxNodes || depth > options.maxDepth) {
    invalid('项目 operation JSON 超过复杂度上限');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (CONTROL_RE.test(value)) invalid('项目 operation 文本含控制字符');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('项目 operation 数字无效');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item, options, depth + 1, counter));
  }
  if (!isPlainObject(value)) invalid('项目 operation 只接受普通 JSON');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    // 稳定 session-binding 引用长 80 字符；控制室 map key 与 control-room.safeId
    // 同步限制为最多 128，而不是普通 operation 字段名的 64。
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)
        || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      invalid('项目 operation JSON 字段无效');
    }
    result[key] = cloneJson(item, options, depth + 1, counter);
  }
  return result;
}

function projectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_RE.test(value)) invalid('项目 id 无效');
  return value;
}

function bindingRef(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !BINDING_REF_RE.test(value)) invalid('项目会话绑定无效');
  return value;
}

function requiredBindingRef(value) {
  const normalized = bindingRef(value);
  if (normalized === null) invalid('项目会话绑定不能为空');
  return normalized;
}

function safeName(value) {
  if (typeof value !== 'string') invalid('项目名称无效');
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_NAME_CHARS || CONTROL_RE.test(normalized)) {
    invalid('项目名称无效');
  }
  return normalized;
}

function safeIcon(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_ICON_CHARS
      || ICON_BAD_RE.test(value)) invalid('项目图标无效');
  return value;
}

function templateId(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !TEMPLATE_ID_RE.test(value)) invalid('项目模板无效');
  return value;
}

function layoutPreset(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !LAYOUT_PRESET_RE.test(value)) invalid('项目布局预设无效');
  return value;
}

function layoutPresetFromPage(value) {
  if (typeof value !== 'string'
      || !Object.prototype.hasOwnProperty.call(projectLayout.PRESETS, value)) {
    invalid('页面布局预设无效');
  }
  return value;
}

function paneStateFromPage(value) {
  if (value === null) return null;
  let validated;
  try { validated = projectLayout.validatePaneState(value); }
  catch (_error) { invalid('项目窗格状态无效'); }
  const forbidden = validated.windows.some((window) => window.tabs.some((tab) => (
    tab.type === 'artifact' || Object.prototype.hasOwnProperty.call(tab, 'locked')
  )));
  if (forbidden) invalid('页面不能写入锁定产物窗格');
  return validated;
}

function paneStateFromStore(value) {
  if (value === null) return null;
  try { return projectLayout.validatePaneState(value); }
  catch (_error) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目窗格状态无效');
  }
}

function previewValue(value) {
  if (!isPlainObject(value)) throw new Error('invalid pane preview');
  if (value.kind === 'markdown' || value.kind === 'text') {
    if (!exactKeys(value, ['kind', 'text', 'truncated'])
        || typeof value.text !== 'string' || BLOCK_CONTROL_RE.test(value.text)
        || Buffer.byteLength(value.text, 'utf8') > MAX_PANE_PREVIEW_TEXT_BYTES
        || typeof value.truncated !== 'boolean') throw new Error('invalid text preview');
    return Object.freeze({ kind: value.kind, text: value.text, truncated: value.truncated });
  }
  if (value.kind === 'image') {
    if (!exactKeys(value, ['kind', 'dataUrl', 'width', 'height'])
        || typeof value.dataUrl !== 'string'
        || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl)
        || Buffer.byteLength(value.dataUrl, 'utf8') > MAX_PANE_PREVIEW_BYTES
        || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 2048
        || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 2048) {
      throw new Error('invalid image preview');
    }
    const encoded = value.dataUrl.slice(value.dataUrl.indexOf(',') + 1);
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 6 * 1024
        || bytes.toString('base64') !== encoded) throw new Error('invalid image preview bytes');
    return Object.freeze({
      kind: 'image', dataUrl: value.dataUrl, width: value.width, height: value.height
    });
  }
  throw new Error('invalid pane preview kind');
}

function panePreviewSurface(value) {
  if (!Array.isArray(value) || value.length > MAX_PANE_PREVIEWS) return Object.freeze([]);
  try {
    const seen = new Set();
    const previews = value.map((entry) => {
      if (!exactKeys(entry, ['window', 'tabId', 'preview'])
          || !Number.isSafeInteger(entry.window) || entry.window < 1 || entry.window > 16
          || typeof entry.tabId !== 'string' || !entry.tabId
          || entry.tabId.length > 128 || CONTROL_RE.test(entry.tabId)) {
        throw new Error('invalid pane preview entry');
      }
      const key = `${entry.window}\0${entry.tabId}`;
      if (seen.has(key)) throw new Error('duplicate pane preview entry');
      seen.add(key);
      return Object.freeze({
        window: entry.window, tabId: entry.tabId, preview: previewValue(entry.preview)
      });
    });
    if (jsonBytes(previews) > MAX_PANE_PREVIEW_BYTES) return Object.freeze([]);
    return Object.freeze(previews);
  } catch (_error) {
    return Object.freeze([]);
  }
}

function paneStateForDisplay(value, previewsValue = []) {
  const validated = paneStateFromStore(value);
  if (validated === null) return null;
  const previews = panePreviewSurface(previewsValue);
  const byTab = new Map(previews.map((entry) => (
    [`${entry.window}\0${entry.tabId}`, entry.preview]
  )));
  return deepFreeze({
    schemaVersion: validated.schemaVersion,
    preset: validated.preset,
    windows: validated.windows.map((window) => ({
      window: window.window,
      label: window.label,
      tabs: window.tabs.map((tab) => {
        const preview = byTab.get(`${window.window}\0${tab.id}`);
        if (['markdown', 'text', 'image'].includes(tab.type)) {
          return {
            id: tab.id, type: tab.type, title: tab.title, relativeRef: tab.path,
            ...(preview && preview.kind === tab.type ? { preview } : {})
          };
        }
        if (tab.type === 'artifact') {
          const descriptor = tab.descriptor;
          return {
            id: tab.id,
            type: 'artifact',
            title: tab.title,
            descriptor: {
              window: descriptor.window,
              relativeRef: descriptor.path,
              kind: descriptor.kind,
              fingerprint: { ...descriptor.fingerprint },
              ...(preview && preview.kind === descriptor.kind ? { preview } : {}),
              ...(descriptor.kind === 'html' ? { openMode: 'electron-child' } : {})
            },
            locked: true
          };
        }
        return { ...tab };
      }),
      active: window.active,
      collapsed: window.collapsed
    }))
  });
}

function templateActionSurface(value) {
  if (!Array.isArray(value) || value.length > MAX_TEMPLATE_ACTIONS) {
    return Object.freeze({ actions: Object.freeze([]), capped: true });
  }
  try {
    const actions = value.map((action) => {
      if (!exactKeys(action, ['id', 'label', 'hint', 'confirm', 'prompt'])
          || typeof action.id !== 'string' || !ACTION_ID_RE.test(action.id)
          || typeof action.label !== 'string' || !action.label
          || action.label.length > 16 || CONTROL_RE.test(action.label)
          || !(action.hint === null || (typeof action.hint === 'string'
            && action.hint.length <= 80 && !CONTROL_RE.test(action.hint)))
          || typeof action.confirm !== 'boolean'
          || typeof action.prompt !== 'string' || !action.prompt.trim()
          || action.prompt.trim().startsWith('/') || BLOCK_CONTROL_RE.test(action.prompt)
          || Buffer.byteLength(action.prompt, 'utf8') > 8 * 1024) {
        throw new Error('invalid template action');
      }
      return Object.freeze({
        id: action.id,
        label: action.label,
        hint: action.hint,
        confirm: action.confirm,
        prompt: action.prompt
      });
    });
    if (jsonBytes(actions) > MAX_TEMPLATE_ACTION_BYTES) {
      return Object.freeze({ actions: Object.freeze([]), capped: true });
    }
    return Object.freeze({ actions: Object.freeze(actions), capped: false });
  } catch (_error) {
    return Object.freeze({ actions: Object.freeze([]), capped: true });
  }
}

function switchCommand(value) {
  if (value === null || value === undefined) return null;
  if (!exactKeys(value, ['seq', 'projectId'])
      || !Number.isSafeInteger(value.seq) || value.seq < 1) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目快捷切换命令无效');
  }
  return Object.freeze({ seq: value.seq, projectId: projectId(value.projectId) });
}

function templateCatalogSurface(value) {
  if (!Array.isArray(value) || value.length > MAX_TEMPLATE_CATALOG) {
    return Object.freeze([]);
  }
  try {
    const seen = new Set();
    const catalog = value.map((entry) => {
      if (!exactKeys(entry, ['id', 'label', 'hint'])
          || typeof entry.label !== 'string' || !entry.label.trim()
          || entry.label.length > MAX_NAME_CHARS || CONTROL_RE.test(entry.label)
          || !(entry.hint === null || (typeof entry.hint === 'string'
            && entry.hint.length <= 80 && !CONTROL_RE.test(entry.hint)))) {
        throw new Error('invalid template catalog entry');
      }
      const id = templateId(entry.id);
      if (seen.has(id)) throw new Error('duplicate template catalog entry');
      seen.add(id);
      return Object.freeze({ id, label: entry.label.trim(), hint: entry.hint });
    });
    if (jsonBytes(catalog) > MAX_TEMPLATE_CATALOG_BYTES) return Object.freeze([]);
    return Object.freeze(catalog);
  } catch (_error) {
    return Object.freeze([]);
  }
}

function validateList(input) {
  if (!exactKeys(input, [], ['cursor', 'limit', 'includeHidden'])) invalid('项目列表参数无效');
  const cursor = input.cursor === undefined ? 0 : input.cursor;
  const limit = input.limit === undefined ? MAX_PAGE : input.limit;
  const includeHidden = input.includeHidden === undefined ? false : input.includeHidden;
  if (!Number.isSafeInteger(cursor) || cursor < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE
      || typeof includeHidden !== 'boolean') invalid('项目列表参数无效');
  return Object.freeze({ cursor, limit, includeHidden });
}

function validateCreate(input) {
  if (!exactKeys(input, [], ['name', 'icon', 'templateId'])) invalid('新建项目参数无效');
  const result = {};
  if (Object.prototype.hasOwnProperty.call(input, 'name')) result.name = safeName(input.name);
  if (Object.prototype.hasOwnProperty.call(input, 'icon')) result.icon = safeIcon(input.icon);
  if (Object.prototype.hasOwnProperty.call(input, 'templateId')) {
    result.templateId = templateId(input.templateId);
  }
  return Object.freeze(result);
}

function validateUpdate(input) {
  if (!exactKeys(input, ['projectId', 'changes']) || !isPlainObject(input.changes)) {
    invalid('更新项目参数无效');
  }
  const keys = Object.keys(input.changes);
  if (keys.length === 0 || keys.some((key) => !PROJECT_UPDATE_KEYS.includes(key))) {
    invalid('更新项目字段无效');
  }
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(input.changes, 'name')) {
    changes.name = safeName(input.changes.name);
  }
  if (Object.prototype.hasOwnProperty.call(input.changes, 'icon')) {
    changes.icon = safeIcon(input.changes.icon);
  }
  if (Object.prototype.hasOwnProperty.call(input.changes, 'hidden')) {
    if (typeof input.changes.hidden !== 'boolean') invalid('项目隐藏状态无效');
    changes.hidden = input.changes.hidden;
  }
  if (Object.prototype.hasOwnProperty.call(input.changes, 'layoutPreset')) {
    changes.layoutPreset = layoutPresetFromPage(input.changes.layoutPreset);
  }
  if (Object.prototype.hasOwnProperty.call(input.changes, 'paneState')) {
    changes.paneState = paneStateFromPage(input.changes.paneState);
  }
  return deepFreeze({ projectId: projectId(input.projectId), changes });
}

function preserveLockedArtifactWindows(current, candidate) {
  if (current === null) return candidate;
  const locked = current.windows.filter((window) => (
    window.tabs.length === 1
      && window.tabs[0].type === 'artifact'
      && window.tabs[0].locked === true
  ));
  if (!locked.length) return candidate;
  if (candidate === null) invalid('页面不能清除锁定产物窗格');
  let next = candidate;
  for (const lockedWindow of locked) {
    next = projectLayout.ensureTargetWindow(next, lockedWindow.window);
  }
  const byWindow = new Map(locked.map((window) => [window.window, window]));
  return projectLayout.validatePaneState({
    schemaVersion: projectLayout.SCHEMA_VERSION,
    preset: next.preset,
    windows: next.windows.map((window) => byWindow.get(window.window) || window)
  });
}

function updateChangesForStore(project, input) {
  const changes = { ...input };
  const hasPane = Object.prototype.hasOwnProperty.call(changes, 'paneState');
  const hasPreset = Object.prototype.hasOwnProperty.call(changes, 'layoutPreset');
  if (!hasPane && !hasPreset) return changes;
  const currentPane = paneStateFromStore(project.paneState);
  let nextPane = hasPane ? changes.paneState : currentPane;
  if (hasPreset) {
    nextPane = nextPane === null
      ? projectLayout.createPaneState(changes.layoutPreset)
      : projectLayout.applyPreset(nextPane, changes.layoutPreset);
  } else if (nextPane !== null) {
    changes.layoutPreset = nextPane.preset;
  }
  nextPane = preserveLockedArtifactWindows(currentPane, nextPane);
  changes.paneState = nextPane;
  return changes;
}

function validateProjectOnly(input) {
  if (!exactKeys(input, ['projectId'])) invalid('项目参数无效');
  return Object.freeze({ projectId: projectId(input.projectId) });
}

function validateBind(input) {
  if (!exactKeys(input, ['projectId', 'bindingRef'], ['openToken'])
      || (Object.prototype.hasOwnProperty.call(input, 'openToken')
        && (typeof input.openToken !== 'string' || !OPEN_TOKEN_RE.test(input.openToken)))) {
    invalid('绑定项目参数无效');
  }
  return Object.freeze({
    projectId: projectId(input.projectId),
    bindingRef: requiredBindingRef(input.bindingRef),
    ...(Object.prototype.hasOwnProperty.call(input, 'openToken')
      ? { openToken: input.openToken } : {})
  });
}

function validateReorder(input) {
  if (!exactKeys(input, ['ids']) || !Array.isArray(input.ids)
      || input.ids.length < 1 || input.ids.length > MAX_PROJECTS) {
    invalid('项目排序参数无效');
  }
  const ids = input.ids.map(projectId);
  if (new Set(ids).size !== ids.length) invalid('项目排序 id 重复');
  return Object.freeze({ ids: Object.freeze(ids) });
}

function validateOpen(input) {
  if (!isPlainObject(input) || !['prepare', 'commit'].includes(input.phase)) {
    invalid('打开项目参数无效');
  }
  if (input.phase === 'prepare') {
    if (!exactKeys(input, ['phase', 'projectId'])) invalid('打开项目 prepare 参数无效');
    return Object.freeze({ phase: 'prepare', projectId: projectId(input.projectId) });
  }
  if (!exactKeys(input, ['phase', 'projectId', 'openToken'])
      || typeof input.openToken !== 'string' || !OPEN_TOKEN_RE.test(input.openToken)) {
    invalid('打开项目 commit 参数无效');
  }
  return Object.freeze({
    phase: 'commit',
    projectId: projectId(input.projectId),
    openToken: input.openToken
  });
}

function validateConsole(input) {
  if (!exactKeys(input, ['snapshot']) || !isPlainObject(input.snapshot)
      || !exactKeys(input.snapshot, [
        'byId', 'subagentsByParent', 'jobsBySession', 'current'
      ])) invalid('控制室快照参数无效');
  const snapshot = cloneJson(input.snapshot, {
    maxDepth: MAX_JSON_DEPTH,
    maxNodes: MAX_JSON_NODES
  });
  if (!isPlainObject(snapshot.byId) || !isPlainObject(snapshot.subagentsByParent)
      || !isPlainObject(snapshot.jobsBySession)
      || !(snapshot.current === null || typeof snapshot.current === 'string')
      || jsonBytes({ snapshot }) > MAX_CONSOLE_INPUT_BYTES) {
    invalid('控制室快照参数无效或过大');
  }
  return deepFreeze({ snapshot });
}

function assertCurrent(context) {
  if (!context || typeof context.assertCurrent !== 'function'
      || context.assertCurrent() !== true) {
    throw operationError('ERR_WORKSPACE_BINDING_STALE', '项目 operation 作用域已变化');
  }
}

function assertProjectSessionRoot(context) {
  const sessionRef = context && context.sessionRootRef;
  const projectRef = context && context.projectRootRef;
  const valid = typeof sessionRef === 'string' && SESSION_ROOT_REF_RE.test(sessionRef)
    && typeof projectRef === 'string' && SESSION_ROOT_REF_RE.test(projectRef);
  const matches = valid && crypto.timingSafeEqual(
    Buffer.from(sessionRef, 'utf8'), Buffer.from(projectRef, 'utf8')
  );
  if (!matches) {
    throw operationError('ERR_PROJECT_ROOT_MISMATCH', '当前会话与项目文件夹不一致');
  }
}

async function authorizeProjectSessionRoot(context) {
  if (!context || typeof context.authorizeProjectRoot !== 'function') {
    throw operationError('ERR_PROJECT_ROOT_MISMATCH', '项目根最终授权不可用');
  }
  let authorized = false;
  try { authorized = await context.authorizeProjectRoot(); }
  catch (_error) { authorized = false; }
  if (authorized !== true) {
    throw operationError('ERR_PROJECT_ROOT_MISMATCH', '当前会话根已变化');
  }
}

function normalizeGlobalBinding(value) {
  if (!exactKeys(value, GLOBAL_BINDING_KEYS)
      || typeof value.hostInstanceId !== 'string' || !REQUEST_ID_RE.test(value.hostInstanceId)
      || typeof value.controllerId !== 'string' || !REQUEST_ID_RE.test(value.controllerId)
      || typeof value.pageInstanceId !== 'string' || !REQUEST_ID_RE.test(value.pageInstanceId)
      || !Number.isSafeInteger(value.selectionRevision) || value.selectionRevision < 1) {
    throw operationError('ERR_WORKSPACE_BINDING_STALE', '项目 operation binding 无效');
  }
  return value;
}

function controlCacheKey(value) {
  const binding = normalizeGlobalBinding(value);
  return JSON.stringify([
    binding.hostInstanceId, binding.controllerId, binding.pageInstanceId
  ]);
}

function openOwnerKey(value) {
  const binding = normalizeGlobalBinding(value);
  return JSON.stringify([
    binding.hostInstanceId, binding.controllerId, binding.pageInstanceId
  ]);
}

function revisionOf(store) {
  const revision = store.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目注册表 revision 无效');
  }
  return revision;
}

function summaryFromStore(value, hasFolderOverride) {
  if (!isPlainObject(value)) throw operationError('ERR_PROJECT_RUNTIME', '项目摘要无效');
  const hasFolder = hasFolderOverride === undefined ? value.hasFolder : hasFolderOverride;
  const hasBinding = value.boundSession !== null;
  if (hasBinding) bindingRef(value.boundSession);
  if (!['user', 'builtin'].includes(value.kind)
      || typeof hasFolder !== 'boolean'
      || typeof value.hidden !== 'boolean' || typeof value.pinned !== 'boolean') {
    throw operationError('ERR_PROJECT_RUNTIME', '项目摘要无效');
  }
  return Object.freeze({
    projectId: projectId(value.id),
    kind: value.kind,
    name: safeName(value.name),
    icon: safeIcon(value.icon),
    hasFolder,
    hasBinding,
    hidden: value.hidden,
    pinned: value.pinned
  });
}

function summaryFromResult(value) {
  if (!exactKeys(value, [
    'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned'
  ]) || !['user', 'builtin'].includes(value.kind)
      || typeof value.hasFolder !== 'boolean'
      || typeof value.hasBinding !== 'boolean'
      || typeof value.hidden !== 'boolean' || typeof value.pinned !== 'boolean') {
    throw operationError('ERR_PROJECT_RUNTIME', '项目结果摘要无效');
  }
  return Object.freeze({
    projectId: projectId(value.projectId),
    kind: value.kind,
    name: safeName(value.name),
    icon: safeIcon(value.icon),
    hasFolder: value.hasFolder,
    hasBinding: value.hasBinding,
    hidden: value.hidden,
    pinned: value.pinned
  });
}

function safeFolderTail(value, hasFolder) {
  // hasFolder 是当前目录是否存在，不是是否配置过目录。目录临时丢失时
  // 仍返回安全 basename，便于页面解释与恢复；无目录的 builtin 才返回 null。
  if (value === null && hasFolder === false) return null;
  if (typeof value !== 'string' || !value || value.length > 255
      || CONTROL_RE.test(value) || /[\\/]/.test(value)
      || value === '.' || value === '..') {
    throw operationError('ERR_PROJECT_RUNTIME', '项目文件夹摘要无效');
  }
  return value;
}

function detailFromStore(value, hasFolderOverride, actionsValue, previewsValue = [],
    maxBytes = MAX_PROJECT_DETAIL_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1
      || maxBytes > MAX_PROJECT_DETAIL_BYTES) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目详情预算无效');
  }
  const summary = summaryFromStore(value, hasFolderOverride);
  let actionSurface = templateActionSurface(actionsValue);
  let panePreviews = panePreviewSurface(previewsValue);
  const build = () => ({
    ...summary,
    folderTail: safeFolderTail(value.folderTail, summary.hasFolder),
    templateId: templateId(value.templateId),
    layoutPreset: layoutPreset(value.layoutPreset),
    paneState: paneStateFromStore(value.paneState),
    panePreviews,
    templateActions: actionSurface.actions,
    templateActionsCapped: actionSurface.capped
  });
  let detail = build();
  if (jsonBytes(detail) > maxBytes) {
    panePreviews = Object.freeze([]);
    detail = build();
  }
  if (jsonBytes(detail) > maxBytes) {
    actionSurface = Object.freeze({ actions: Object.freeze([]), capped: true });
    detail = build();
  }
  if (jsonBytes(detail) > maxBytes) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目详情超过安全上限');
  }
  return deepFreeze(detail);
}

function detailFromResult(value) {
  if (!exactKeys(value, [
    'projectId', 'kind', 'name', 'icon', 'hasFolder', 'hasBinding', 'hidden', 'pinned',
    'folderTail', 'templateId', 'layoutPreset', 'paneState',
    'panePreviews', 'templateActions', 'templateActionsCapped'
  ])) throw operationError('ERR_PROJECT_RUNTIME', '项目详情结果无效');
  const summary = summaryFromResult({
    projectId: value.projectId,
    kind: value.kind,
    name: value.name,
    icon: value.icon,
    hasFolder: value.hasFolder,
    hasBinding: value.hasBinding,
    hidden: value.hidden,
    pinned: value.pinned
  });
  const actionSurface = templateActionSurface(value.templateActions);
  if (typeof value.templateActionsCapped !== 'boolean') {
    throw operationError('ERR_PROJECT_RUNTIME', '项目模板 action 状态无效');
  }
  return Object.freeze({
    ...summary,
    folderTail: safeFolderTail(value.folderTail, summary.hasFolder),
    templateId: templateId(value.templateId),
    layoutPreset: layoutPreset(value.layoutPreset),
    paneState: paneStateForDisplay(value.paneState, value.panePreviews),
    templateActions: actionSurface.actions,
    templateActionsCapped: value.templateActionsCapped || actionSurface.capped
  });
}

function controlProject(value) {
  const summary = summaryFromStore(value);
  return Object.freeze({
    id: summary.projectId,
    name: summary.name,
    icon: summary.icon,
    pinned: summary.pinned,
    hidden: summary.hidden,
    boundSession: value.boundSession === null ? null : bindingRef(value.boundSession)
  });
}

function countsResult(value) {
  if (!isPlainObject(value)) throw operationError('ERR_PROJECT_RUNTIME', '控制室计数无效');
  const result = {};
  for (const key of ['need', 'done', 'busy', 'idle', 'total', 'glowing']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > MAX_PROJECTS) {
      throw operationError('ERR_PROJECT_RUNTIME', '控制室计数无效');
    }
    result[key] = value[key];
  }
  if (result.need + result.done + result.busy + result.idle !== result.total) {
    throw operationError('ERR_PROJECT_RUNTIME', '控制室计数不一致');
  }
  return Object.freeze(result);
}

function cardResult(value) {
  if (!isPlainObject(value) || !STATUSES.has(value.status)
      || typeof value.statusLabel !== 'string' || value.statusLabel.length > 32
      || CONTROL_RE.test(value.statusLabel)
      || typeof value.glow !== 'boolean'
      || !(value.runtimeMs === null
        || (Number.isFinite(value.runtimeMs) && value.runtimeMs >= 0))
      || !Number.isSafeInteger(value.kids) || value.kids < 0 || value.kids > 512
      || typeof value.sessionTitle !== 'string' || value.sessionTitle.length > 120
      || CONTROL_RE.test(value.sessionTitle)
      || typeof value.pinned !== 'boolean' || typeof value.hidden !== 'boolean') {
    throw operationError('ERR_PROJECT_RUNTIME', '控制室卡片无效');
  }
  return Object.freeze({
    projectId: projectId(value.projectId),
    name: safeName(value.name),
    icon: safeIcon(value.icon),
    pinned: value.pinned,
    hidden: value.hidden,
    status: value.status,
    statusLabel: value.statusLabel,
    glow: value.glow,
    runtimeMs: value.runtimeMs,
    kids: value.kids,
    sessionTitle: value.sessionTitle
  });
}

function redactList(value) {
  if (!exactKeys(value, [
    'kind', 'revision', 'cursor', 'nextCursor', 'projects',
    'switchCommand', 'templateCatalog'
  ])
      || value.kind !== 'projects' || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || !Number.isSafeInteger(value.cursor) || value.cursor < 0
      || !(value.nextCursor === null
        || (Number.isSafeInteger(value.nextCursor) && value.nextCursor > value.cursor))
      || !Array.isArray(value.projects) || value.projects.length > MAX_PAGE) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目列表结果无效');
  }
  return Object.freeze({
    kind: 'projects',
    revision: value.revision,
    cursor: value.cursor,
    nextCursor: value.nextCursor,
    projects: Object.freeze(value.projects.map(summaryFromResult)),
    switchCommand: switchCommand(value.switchCommand),
    templateCatalog: templateCatalogSurface(value.templateCatalog)
  });
}

function redactProject(value) {
  if (!exactKeys(value, ['kind', 'revision', 'project']) || value.kind !== 'project'
      || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目结果无效');
  }
  return Object.freeze({
    kind: 'project', revision: value.revision, project: summaryFromResult(value.project)
  });
}

function redactRemoved(value) {
  if (!exactKeys(value, ['kind', 'revision', 'projectId']) || value.kind !== 'removed'
      || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw operationError('ERR_PROJECT_RUNTIME', '删除项目结果无效');
  }
  return Object.freeze({
    kind: 'removed', revision: value.revision, projectId: projectId(value.projectId)
  });
}

function redactBinding(value) {
  if (!exactKeys(value, ['kind', 'revision', 'projectId', 'bindingRef'])
      || value.kind !== 'binding' || !Number.isSafeInteger(value.revision)
      || value.revision < 0) {
    throw operationError('ERR_PROJECT_RUNTIME', '绑定项目结果无效');
  }
  return Object.freeze({
    kind: 'binding',
    revision: value.revision,
    projectId: projectId(value.projectId),
    bindingRef: bindingRef(value.bindingRef)
  });
}

function redactOrder(value) {
  if (!exactKeys(value, ['kind', 'revision', 'projectIds']) || value.kind !== 'order'
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.projectIds) || value.projectIds.length > MAX_PROJECTS) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目排序结果无效');
  }
  const ids = value.projectIds.map(projectId);
  if (new Set(ids).size !== ids.length) {
    throw operationError('ERR_PROJECT_RUNTIME', '项目排序结果重复');
  }
  return Object.freeze({
    kind: 'order', revision: value.revision, projectIds: Object.freeze(ids)
  });
}

function redactOpen(value) {
  if (!isPlainObject(value)) throw operationError('ERR_PROJECT_RUNTIME', '打开项目结果无效');
  if (value.kind === 'open-prepared') {
    const hasBootstrapTicket = Object.prototype.hasOwnProperty.call(value, 'bootstrapTicket');
    if (!exactKeys(value, ['kind', 'project', 'bindingRef', 'openToken'], ['bootstrapTicket'])
        || typeof value.openToken !== 'string' || !OPEN_TOKEN_RE.test(value.openToken)) {
      throw operationError('ERR_PROJECT_RUNTIME', '打开项目 prepare 结果无效');
    }
    const safeBinding = bindingRef(value.bindingRef);
    if (hasBootstrapTicket && (safeBinding !== null
        || typeof value.bootstrapTicket !== 'string'
        || !BOOTSTRAP_TICKET_RE.test(value.bootstrapTicket)
        || Buffer.byteLength(value.bootstrapTicket, 'utf8')
          > MAX_PROJECT_BOOTSTRAP_TICKET_BYTES)) {
      throw operationError('ERR_PROJECT_RUNTIME', '打开项目 bootstrap 凭据无效');
    }
    const result = Object.freeze({
      kind: 'open-prepared',
      project: detailFromResult(value.project),
      bindingRef: safeBinding,
      openToken: value.openToken,
      ...(hasBootstrapTicket ? { bootstrapTicket: value.bootstrapTicket } : {})
    });
    if (jsonBytes(result) > MAX_PROJECT_OPEN_RESULT_BYTES) {
      throw operationError('ERR_PROJECT_RUNTIME', '打开项目 prepare 结果超过安全上限');
    }
    return result;
  }
  if (value.kind === 'open-committed') {
    if (!exactKeys(value, ['kind', 'project', 'bindingRef'])) {
      throw operationError('ERR_PROJECT_RUNTIME', '打开项目 commit 结果无效');
    }
    const result = Object.freeze({
      kind: 'open-committed',
      project: detailFromResult(value.project),
      bindingRef: bindingRef(value.bindingRef)
    });
    if (jsonBytes(result) > MAX_PROJECT_OPEN_RESULT_BYTES) {
      throw operationError('ERR_PROJECT_RUNTIME', '打开项目 commit 结果超过安全上限');
    }
    return result;
  }
  throw operationError('ERR_PROJECT_RUNTIME', '打开项目结果无效');
}

function redactConsole(value) {
  if (!exactKeys(value, ['kind', 'revision', 'cards', 'counts'])
      || value.kind !== 'console' || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || !Array.isArray(value.cards)
      || value.cards.length > MAX_PROJECTS) {
    throw operationError('ERR_PROJECT_RUNTIME', '控制室结果无效');
  }
  const counts = countsResult(value.counts);
  const cards = Object.freeze(value.cards.map(cardResult));
  if (cards.length !== counts.total) {
    throw operationError('ERR_PROJECT_RUNTIME', '控制室卡片数量不一致');
  }
  return Object.freeze({ kind: 'console', revision: value.revision, cards, counts });
}

function consoleStatuses(cards) {
  const result = Object.create(null);
  for (const card of cards) result[card.projectId] = card.status;
  return Object.freeze(result);
}

function newlyDoneProjectIds(previousStatuses, cards, boundProjectIds) {
  const previous = previousStatuses && typeof previousStatuses === 'object'
    ? previousStatuses : Object.create(null);
  return Object.freeze(cards
    .filter((card) => card.status === 'done'
      && boundProjectIds.has(card.projectId)
      && previous[card.projectId] !== 'done')
    .map((card) => card.projectId));
}

function publicErrorCode(error) {
  const code = error && error.code;
  if (code === 'ERR_PROJECT_NOT_FOUND') return 'project-not-found';
  if (code === 'ERR_PROJECT_FOLDER') return 'project-folder-invalid';
  if (code === 'ERR_PROJECT_PROTECTED') return 'project-protected';
  if (code === 'ERR_PROJECT_DUPLICATE_FOLDER') return 'project-duplicate-folder';
  if (code === 'ERR_PROJECT_LIMIT') return 'project-limit';
  if (code === 'ERR_PROJECT_CANCELLED') return 'cancelled';
  if (code === 'ERR_PROJECT_ROOT_MISMATCH') return 'workspace-mismatch';
  // 模板文件已按“只补缺失”落地、但 registry 最终提交失败时，不能对页面
  // 谎称完全未执行；复用既有公开码要求用户按同一目录安全重试。
  if (code === 'ERR_PROJECT_REGISTRY_AFTER_TEMPLATE') return 'outcome-unknown';
  // projects.open 的 runtime 激活是同步副作用。从该回调开始后，
  // 无论是激活本身部分成功后抛错，还是后续 registry/ACK/投影
  // 失败，都不能对页面声称原状态未改变。
  if (code === 'ERR_PROJECT_OPEN_OUTCOME_UNKNOWN') return 'outcome-unknown';
  if (typeof code === 'string' && code.startsWith('ERR_PROJECT_TEMPLATE_')) {
    return 'operation-invalid';
  }
  if (code === 'ERR_WORKSPACE_BINDING_STALE' || code === 'ERR_PROJECT_OPEN_STALE') {
    return 'operation-stale';
  }
  if (['ERR_PROJECT_BUILTIN', 'ERR_PROJECT_INVALID', 'ERR_PROJECT_DUPLICATE_ID',
    'ERR_PROJECT_SESSION_BOUND'].includes(code)) {
    return 'operation-invalid';
  }
  return 'operation-failed';
}

function createProjectOperations(options = {}) {
  if (!isPlainObject(options)
      || Object.keys(options).some((key) => ![
        'projectStore', 'chooseFolder', 'controlRoom', 'now', 'randomBytes',
        'onNeedCount', 'onConsoleResult', 'createProject', 'templateActionsFor',
        'templateCatalogFor', 'previewForProject', 'readSwitchCommand', 'onProjectOpened',
        'onProjectOpenOutcomeUnknown', 'bootstrapTicketFor'
      ].includes(key))) {
    throw new TypeError('project operation options invalid');
  }
  const projectStore = options.projectStore;
  const chooseFolder = options.chooseFolder;
  const controlRoom = options.controlRoom;
  const now = options.now === undefined ? Date.now : options.now;
  const randomBytes = options.randomBytes === undefined ? crypto.randomBytes : options.randomBytes;
  const onNeedCount = options.onNeedCount === undefined ? () => {} : options.onNeedCount;
  const onConsoleResult = options.onConsoleResult === undefined
    ? () => {} : options.onConsoleResult;
  const createProject = options.createProject === undefined
    ? (input, folder) => projectStore.create({ ...input, folder })
    : options.createProject;
  const templateActionsFor = options.templateActionsFor === undefined
    ? () => [] : options.templateActionsFor;
  const templateCatalogFor = options.templateCatalogFor === undefined
    ? () => [] : options.templateCatalogFor;
  const previewForProject = options.previewForProject === undefined
    ? () => [] : options.previewForProject;
  const readSwitchCommand = options.readSwitchCommand === undefined
    ? () => null : options.readSwitchCommand;
  const onProjectOpened = options.onProjectOpened === undefined
    ? () => {} : options.onProjectOpened;
  const onProjectOpenOutcomeUnknown = options.onProjectOpenOutcomeUnknown === undefined
    ? null : options.onProjectOpenOutcomeUnknown;
  const bootstrapTicketFor = options.bootstrapTicketFor === undefined
    ? () => null : options.bootstrapTicketFor;
  const storeMethods = [
    'list', 'get', 'create', 'update', 'remove', 'bindSession',
    'reorder', 'folderExists', 'touchOpened'
  ];
  if (!projectStore || storeMethods.some((name) => typeof projectStore[name] !== 'function')
      || typeof chooseFolder !== 'function'
      || !controlRoom || ['sanitizeSnapshot', 'buildCards', 'ackSession']
        .some((name) => typeof controlRoom[name] !== 'function')
      || typeof now !== 'function' || typeof randomBytes !== 'function'
      || typeof onNeedCount !== 'function' || typeof onConsoleResult !== 'function'
      || typeof createProject !== 'function' || typeof templateActionsFor !== 'function'
      || typeof templateCatalogFor !== 'function'
      || typeof previewForProject !== 'function'
      || typeof readSwitchCommand !== 'function' || typeof onProjectOpened !== 'function'
      || !(onProjectOpenOutcomeUnknown === null
        || typeof onProjectOpenOutcomeUnknown === 'function')
      || typeof bootstrapTicketFor !== 'function') {
    throw new TypeError('project operation dependencies invalid');
  }

  const controlCaches = new Map();
  const openTokens = new Map();

  const sweep = (at) => {
    for (const [key, record] of controlCaches) {
      if (record.expiresAt <= at) controlCaches.delete(key);
    }
    for (const [token, record] of openTokens) {
      if (record.expiresAt <= at) openTokens.delete(token);
    }
  };

  const insertBounded = (map, key, value, maximum) => {
    map.delete(key);
    while (map.size >= maximum) map.delete(map.keys().next().value);
    map.set(key, value);
  };

  const mintOpenToken = () => {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
      let bytes;
      try { bytes = randomBytes(32); }
      catch (_error) { throw operationError('ERR_PROJECT_RUNTIME', '打开项目随机源失败'); }
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
        throw operationError('ERR_PROJECT_RUNTIME', '打开项目随机源无效');
      }
      const token = `project-open-${bytes.toString('hex')}`;
      if (!openTokens.has(token)) return token;
    }
    throw operationError('ERR_PROJECT_RUNTIME', '无法生成唯一打开凭据');
  };

  const descriptor = (validate, handle, redact, limits) => Object.freeze({
    validate,
    handle,
    redact,
    errorCode: publicErrorCode,
    ...(limits ? { limits: Object.freeze(limits) } : {})
  });

  return Object.freeze({
    'projects.list': descriptor(validateList, async ({ input, binding, context }) => {
      assertCurrent(context);
      const all = projectStore.list({ includeHidden: input.includeHidden });
      if (!Array.isArray(all) || all.length > MAX_PROJECTS) {
        throw operationError('ERR_PROJECT_RUNTIME', '项目列表无效');
      }
      const page = all.slice(input.cursor, input.cursor + input.limit)
        .map((item) => summaryFromStore(item));
      const next = input.cursor + page.length;
      let command = null;
      let catalog = [];
      if (input.cursor === 0) {
        command = switchCommand(await readSwitchCommand(binding));
        assertCurrent(context);
        try { catalog = await templateCatalogFor(); }
        catch (_error) { catalog = []; }
        assertCurrent(context);
      }
      return Object.freeze({
        kind: 'projects',
        revision: revisionOf(projectStore),
        cursor: input.cursor,
        nextCursor: next < all.length ? next : null,
        projects: Object.freeze(page),
        switchCommand: command,
        templateCatalog: input.cursor === 0 ? templateCatalogSurface(catalog) : Object.freeze([])
      });
    }, redactList, { maxResultBytes: 16 * 1024, maxJsonNodes: 2048 }),

    'projects.create': descriptor(validateCreate, async ({ input, context }) => {
      assertCurrent(context);
      const folder = await chooseFolder();
      assertCurrent(context);
      if (folder === null || folder === undefined) {
        throw operationError('ERR_PROJECT_CANCELLED', '用户取消选择项目文件夹');
      }
      if (typeof folder !== 'string' || !folder.trim() || CONTROL_RE.test(folder)) {
        throw operationError('ERR_PROJECT_FOLDER', '目录选择器返回无效项目文件夹');
      }
      const created = await createProject(input, folder);
      assertCurrent(context);
      return Object.freeze({
        kind: 'project',
        revision: revisionOf(projectStore),
        project: summaryFromStore(created)
      });
    }, redactProject),

    'projects.update': descriptor(validateUpdate, async ({ input, context }) => {
      assertCurrent(context);
      const current = projectStore.get(input.projectId);
      if (!current) throw operationError('ERR_PROJECT_NOT_FOUND', '项目不存在');
      const changes = updateChangesForStore(current, input.changes);
      const updated = projectStore.update(input.projectId, changes);
      return Object.freeze({
        kind: 'project',
        revision: revisionOf(projectStore),
        project: summaryFromStore(updated)
      });
    }, redactProject, {
      maxInputBytes: 20 * 1024,
      maxJsonDepth: 12,
      maxJsonNodes: 4096
    }),

    'projects.remove': descriptor(validateProjectOnly, async ({ input, context }) => {
      assertCurrent(context);
      projectStore.remove(input.projectId);
      return Object.freeze({
        kind: 'removed', revision: revisionOf(projectStore), projectId: input.projectId
      });
    }, redactRemoved),

    'projects.bind': descriptor(validateBind, async ({ input, binding, context }) => {
      assertCurrent(context);
      const current = projectStore.get(input.projectId);
      if (!current) throw operationError('ERR_PROJECT_NOT_FOUND', '项目不存在');
      const bootstrapBind = Object.prototype.hasOwnProperty.call(input, 'openToken');
      let prepared = null;
      if (bootstrapBind) {
        prepared = openTokens.get(input.openToken);
        if (!prepared || prepared.ownerKey !== openOwnerKey(binding)
            || prepared.projectId !== input.projectId || prepared.bindingRef !== null
            || current.boundSession !== null) {
          throw operationError('ERR_PROJECT_OPEN_STALE', '未绑定项目的打开凭据已失效');
        }
      }
      assertProjectSessionRoot(context);
      // Host 在此刻重读当前 session cwd；这一步之后直到 bindSession
      // 不再 await，令授权快照成为持久副作用的线性化点。
      await authorizeProjectSessionRoot(context);
      assertCurrent(context);
      if (bootstrapBind) {
        const latestPrepared = openTokens.get(input.openToken);
        const latestProject = projectStore.get(input.projectId);
        const currentToken = latestPrepared === prepared;
        if (currentToken) openTokens.delete(input.openToken);
        if (!currentToken || !latestProject || latestProject.boundSession !== null) {
          throw operationError('ERR_PROJECT_OPEN_STALE', '项目在 bootstrap 绑定前已被更新');
        }
      }
      const bound = projectStore.bindSession(input.projectId, input.bindingRef);
      return Object.freeze({
        kind: 'binding',
        revision: revisionOf(projectStore),
        projectId: projectId(bound.id),
        bindingRef: bindingRef(bound.boundSession)
      });
    }, redactBinding),

    'projects.reorder': descriptor(validateReorder, async ({ input, context }) => {
      assertCurrent(context);
      const ordered = projectStore.reorder(input.ids);
      if (!Array.isArray(ordered) || ordered.length > MAX_PROJECTS) {
        throw operationError('ERR_PROJECT_RUNTIME', '项目排序结果无效');
      }
      return Object.freeze({
        kind: 'order',
        revision: revisionOf(projectStore),
        projectIds: Object.freeze(ordered.map((item) => projectId(item.id)))
      });
    }, redactOrder, { maxInputBytes: 8 * 1024, maxResultBytes: 8 * 1024 }),

    'projects.open': descriptor(validateOpen, async ({ input, binding, context }) => {
      assertCurrent(context);
      const at = checkedNow(now);
      sweep(at);
      const ownerKey = openOwnerKey(binding);
      const cacheKey = controlCacheKey(binding);
      if (input.phase === 'prepare') {
        const current = projectStore.get(input.projectId);
        if (!current) throw operationError('ERR_PROJECT_NOT_FOUND', '项目不存在');
        const currentBindingRef = current.boundSession === null
          ? null : bindingRef(current.boundSession);
        let actions = [];
        try { actions = await templateActionsFor(current.templateId); }
        catch (_error) { actions = null; }
        assertCurrent(context);
        let previews = [];
        try { previews = await previewForProject(current); }
        catch (_error) { previews = []; }
        assertCurrent(context);
        const command = switchCommand(await readSwitchCommand(binding));
        assertCurrent(context);
        const token = mintOpenToken();
        let bootstrapTicket = null;
        if (currentBindingRef === null) {
          bootstrapTicket = await bootstrapTicketFor(Object.freeze({
            projectId: input.projectId,
            openToken: token,
            binding: Object.freeze({ ...binding })
          }));
          assertCurrent(context);
          if (!(bootstrapTicket === null || (typeof bootstrapTicket === 'string'
              && BOOTSTRAP_TICKET_RE.test(bootstrapTicket)
              && Buffer.byteLength(bootstrapTicket, 'utf8')
                <= MAX_PROJECT_BOOTSTRAP_TICKET_BYTES))) {
            throw operationError('ERR_PROJECT_RUNTIME', '项目 bootstrap 凭据生成失败');
          }
        }
        const scaffold = Object.freeze({
          kind: 'open-prepared',
          project: Object.freeze({}),
          bindingRef: currentBindingRef,
          openToken: token,
          ...(bootstrapTicket === null ? {} : { bootstrapTicket })
        });
        const fixedEnvelopeBytes = jsonBytes(scaffold) - jsonBytes(scaffold.project);
        const detailBudget = Math.min(
          MAX_PROJECT_DETAIL_BYTES,
          MAX_PROJECT_OPEN_RESULT_BYTES - fixedEnvelopeBytes
        );
        const result = Object.freeze({
          ...scaffold,
          project: detailFromStore(
            current, projectStore.folderExists(input.projectId), actions, previews,
            detailBudget
          )
        });
        if (jsonBytes(result) > MAX_PROJECT_OPEN_RESULT_BYTES) {
          throw operationError('ERR_PROJECT_RUNTIME', '打开项目 prepare 结果超过安全上限');
        }
        insertBounded(openTokens, token, Object.freeze({
          ownerKey,
          cacheKey,
          projectId: input.projectId,
          bindingRef: currentBindingRef,
          switchCommandSeq: command && command.projectId === input.projectId
            ? command.seq : null,
          expiresAt: deadline(at)
        }), MAX_OPEN_TOKENS);
        return result;
      }

      const prepared = openTokens.get(input.openToken);
      if (!prepared || prepared.ownerKey !== ownerKey
          || prepared.projectId !== input.projectId) {
        throw operationError('ERR_PROJECT_OPEN_STALE', '打开项目凭据已失效');
      }
      openTokens.delete(input.openToken);
      const current = projectStore.get(input.projectId);
      if (!current) throw operationError('ERR_PROJECT_NOT_FOUND', '项目不存在');
      const currentBindingRef = current.boundSession === null
        ? null : bindingRef(current.boundSession);
      if (currentBindingRef !== prepared.bindingRef) {
        throw operationError('ERR_PROJECT_OPEN_STALE', '项目会话绑定已经变化');
      }
      if (prepared.bindingRef === null || !context
          || context.currentBindingRef !== prepared.bindingRef) {
        throw operationError('ERR_PROJECT_OPEN_STALE', '当前页面没有打开项目绑定的会话');
      }
      // root proof 必须在模板读取、控制室 ACK、touchOpened 与激活项目前通过。
      assertProjectSessionRoot(context);

      let actions = [];
      try { actions = await templateActionsFor(current.templateId); }
      catch (_error) { actions = null; }
      assertCurrent(context);
      let previews = [];
      try { previews = await previewForProject(current); }
      catch (_error) { previews = []; }
      assertCurrent(context);
      // 所有潜在异步读取先完成，再由 Host 当场重验 session cwd。
      // 授权成功后到 activate/touch/ACK 之间不得再出现 await。
      await authorizeProjectSessionRoot(context);
      assertCurrent(context);
      // 项目根/runtime 是 commit 的安全前置条件。激活回调一旦开始，
      // 就可能已切换 main 的权威根；因此后续任一失败只能回报
      // outcome-unknown。可选清理钩子仅表示“已尝试 fail-closed
      // 清理”，此处绝不声称已回滚或恢复原状态。
      let activationStarted = false;
      try {
        activationStarted = true;
        const activated = onProjectOpened(input.projectId, prepared.switchCommandSeq);
        if (activated && typeof activated.then === 'function') {
          // main adapter 必须同步完成 root/runtime 切换，异步 callback 会重新
          // 打开授权后的竞态窗口，因此 fail-closed。
          Promise.resolve(activated).catch(() => {});
          throw operationError('ERR_PROJECT_RUNTIME', '项目激活回调必须同步完成');
        }
        const memory = controlCaches.get(prepared.cacheKey);
        let acknowledged = null;
        if (memory && currentBindingRef !== null) {
          acknowledged = controlRoom.ackSession(
            memory.acks, memory.snapshot, currentBindingRef
          );
        }
        const opened = projectStore.touchOpened(input.projectId);
        if (memory) {
          insertBounded(controlCaches, prepared.cacheKey, Object.freeze({
            snapshot: memory.snapshot,
            acks: acknowledged === null ? memory.acks : acknowledged,
            seen: memory.seen,
            statuses: memory.statuses,
            expiresAt: deadline(at)
          }), MAX_BINDING_CACHES);
        }
        return Object.freeze({
          kind: 'open-committed',
          project: detailFromStore(
            opened, projectStore.folderExists(input.projectId), actions, previews
          ),
          bindingRef: currentBindingRef
        });
      } catch (error) {
        if (!activationStarted) throw error;
        if (onProjectOpenOutcomeUnknown !== null) {
          try {
            const cleanup = onProjectOpenOutcomeUnknown(input.projectId, error);
            if (cleanup && typeof cleanup.then === 'function') {
              // 失败路径不再 await，避免把一次未知结果扩大为新竞态。
              // 异步钩子只能 best effort，仍然保持 outcome-unknown。
              Promise.resolve(cleanup).catch(() => {});
            }
          } catch (_cleanupError) { /* best effort，不伪报回滚 */ }
        }
        const unknown = operationError(
          'ERR_PROJECT_OPEN_OUTCOME_UNKNOWN', '项目打开已开始，最终状态无法确认'
        );
        unknown.cause = error;
        throw unknown;
      }
    }, redactOpen, {
      maxResultBytes: MAX_PROJECT_OPEN_RESULT_BYTES,
      maxJsonDepth: 12,
      maxJsonNodes: 4096
    }),

    'console.read': descriptor(validateConsole, async ({ input, binding, context }) => {
      assertCurrent(context);
      const at = checkedNow(now);
      sweep(at);
      const key = controlCacheKey(binding);
      const previous = controlCaches.get(key);
      const sanitized = controlRoom.sanitizeSnapshot(input.snapshot);
      const projects = projectStore.list({ includeHidden: true });
      if (!Array.isArray(projects) || projects.length > MAX_PROJECTS) {
        throw operationError('ERR_PROJECT_RUNTIME', '控制室项目列表无效');
      }
      const built = controlRoom.buildCards({
        snapshot: sanitized,
        projects: projects.map(controlProject),
        acks: previous && previous.acks,
        seen: previous && previous.seen,
        now: at
      });
      if (!isPlainObject(built) || !Array.isArray(built.cards)) {
        throw operationError('ERR_PROJECT_RUNTIME', '控制室内核结果无效');
      }
      const result = redactConsole({
        kind: 'console',
        revision: revisionOf(projectStore),
        cards: built.cards,
        counts: built.counts
      });
      const boundProjectIds = new Set(projects
        .filter((item) => item.kind === 'user' && item.boundSession !== null)
        .map((item) => item.id));
      const doneProjectIds = newlyDoneProjectIds(
        previous && previous.statuses, result.cards, boundProjectIds
      );
      insertBounded(controlCaches, key, Object.freeze({
        snapshot: sanitized,
        acks: built.acks,
        seen: built.seen,
        statuses: consoleStatuses(result.cards),
        expiresAt: deadline(at)
      }), MAX_BINDING_CACHES);
      try {
        const callback = onNeedCount(result.counts.need);
        if (callback && typeof callback.then === 'function') callback.catch(() => {});
      } catch (_error) { /* 托盘回调故障不污染控制室读结果 */ }
      try {
        const callback = onConsoleResult(Object.freeze({
          binding: Object.freeze({ ...normalizeGlobalBinding(binding) }),
          doneProjectIds
        }));
        if (callback && typeof callback.then === 'function') callback.catch(() => {});
      } catch (_error) { /* 产物扫描回调故障不污染控制室读结果 */ }
      return result;
    }, redactConsole, {
      maxInputBytes: 48 * 1024,
      maxResultBytes: 64 * 1024,
      maxJsonDepth: 16,
      maxJsonNodes: 8192,
      maxJsonKeyChars: 128
    })
  });
}

module.exports = Object.freeze({
  PROJECT_OPERATION_NAMES,
  newlyDoneProjectIds,
  templateActionSurface,
  templateCatalogSurface,
  panePreviewSurface,
  switchCommand,
  createProjectOperations
});
