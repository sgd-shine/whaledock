'use strict';

// v0.11 项目模板地基：把已由 workbenches.js 收窄过的静态包投影为
// 项目模板，并且只在“新建项目”或“用户显式应用”时落地缺失内容。
// 包仍只是数据：actions.prompt 从不执行、插值或 require。
//
// 模块保持纯 Node，不依赖 Electron，不增加第三方依赖。
const fs = require('fs');
const path = require('path');
const workbenches = require('./workbenches');

const APPLY_REASONS = Object.freeze(['create', 'explicit']);
const LIMITS = Object.freeze({
  maxFolders: workbenches.LIMITS.maxFolders,
  maxSegments: workbenches.LIMITS.maxPathSegments,
  maxFilesPerFolder: workbenches.LIMITS.maxFolderFiles + 1,
  maxActions: workbenches.LIMITS.maxActions,
  maxFileBytes: 32 * 1024,
  maxTemplateBytes: 128 * 1024
});

const TEMPLATE_ID_RE = /^(?:builtin|user):[^\\/:*?"<>|\u0000-\u001f]{1,64}$/;
const ACTION_ID_RE = workbenches.ACTION_ID_RE;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const BLOCK_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SEED_FILE_RE = /\.(?:md|txt)$/i;
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function templateError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function invalid(message) {
  throw templateError('ERR_PROJECT_TEMPLATE_INVALID', message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return isPlainObject(value)
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => keys.includes(key));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function templateId(value) {
  if (typeof value !== 'string' || value.length > 96 || !TEMPLATE_ID_RE.test(value)) {
    invalid('项目模板 id 无效');
  }
  return value;
}

function templateName(value) {
  if (typeof value !== 'string') invalid('项目模板名称无效');
  const normalized = value.trim();
  if (!normalized || normalized.length > workbenches.LIMITS.maxNameChars
      || CONTROL_RE.test(normalized)) invalid('项目模板名称无效');
  return normalized;
}

function safeSegment(value, maximum) {
  const normalized = workbenches.validSegment(value, maximum);
  if (!normalized || WINDOWS_DEVICE_RE.test(normalized)) {
    invalid('项目模板路径段无效');
  }
  return normalized;
}

function safeFile(value) {
  if (!exactKeys(value, ['name', 'content'])) invalid('项目模板文件无效');
  const name = safeSegment(value.name, workbenches.LIMITS.maxFileNameChars);
  if (!SEED_FILE_RE.test(name)) invalid('项目模板只允许 Markdown 或文本种子文件');
  if (typeof value.content !== 'string' || !value.content
      || BLOCK_CONTROL_RE.test(value.content)
      || Buffer.byteLength(value.content, 'utf8') > LIMITS.maxFileBytes) {
    invalid('项目模板文件内容无效或过大');
  }
  return Object.freeze({ name, content: value.content });
}

function safeFolder(value) {
  if (!exactKeys(value, ['segments', 'path', 'files'])
      || !Array.isArray(value.segments) || value.segments.length < 1
      || value.segments.length > LIMITS.maxSegments
      || !Array.isArray(value.files) || value.files.length > LIMITS.maxFilesPerFolder) {
    invalid('项目模板目录无效');
  }
  const segments = value.segments.map((entry) => (
    safeSegment(entry, workbenches.LIMITS.maxSegmentChars)
  ));
  const relative = segments.join('/');
  if (value.path !== relative) invalid('项目模板目录路径不一致');
  const names = new Set();
  const files = value.files.map((entry) => {
    const normalized = safeFile(entry);
    const key = normalized.name.toLocaleLowerCase('en-US');
    if (names.has(key)) invalid('项目模板文件名重复');
    names.add(key);
    return normalized;
  });
  return Object.freeze({
    segments: Object.freeze(segments),
    path: relative,
    files: Object.freeze(files)
  });
}

function safeAction(value) {
  if (!exactKeys(value, ['id', 'label', 'hint', 'confirm', 'prompt'])
      || typeof value.id !== 'string' || !ACTION_ID_RE.test(value.id)
      || typeof value.label !== 'string' || !value.label
      || value.label.length > workbenches.LIMITS.maxLabelChars
      || CONTROL_RE.test(value.label)
      || !(value.hint === null || (typeof value.hint === 'string'
        && value.hint.length <= workbenches.LIMITS.maxHintChars
        && !CONTROL_RE.test(value.hint)))
      || typeof value.confirm !== 'boolean'
      || typeof value.prompt !== 'string' || !value.prompt.trim()
      || value.prompt.trim().startsWith('/') || BLOCK_CONTROL_RE.test(value.prompt)
      || Buffer.byteLength(value.prompt, 'utf8') > workbenches.LIMITS.maxPromptBytes) {
    invalid('项目模板 action 无效');
  }
  return Object.freeze({
    id: value.id,
    label: value.label,
    hint: value.hint,
    confirm: value.confirm,
    prompt: value.prompt
  });
}

function normalizeTemplate(value) {
  if (!exactKeys(value, ['templateId', 'name', 'folders', 'actions'])
      || !Array.isArray(value.folders) || value.folders.length > LIMITS.maxFolders
      || !Array.isArray(value.actions) || value.actions.length > LIMITS.maxActions) {
    invalid('项目模板数据无效');
  }
  const folders = value.folders.map(safeFolder);
  const folderKeys = new Set();
  for (const folder of folders) {
    const key = folder.path.toLocaleLowerCase('en-US');
    if (folderKeys.has(key)) invalid('项目模板目录重复');
    folderKeys.add(key);
  }
  const actions = value.actions.map(safeAction);
  const actionIds = new Set();
  for (const action of actions) {
    if (actionIds.has(action.id)) invalid('项目模板 action id 重复');
    actionIds.add(action.id);
  }
  const result = {
    templateId: templateId(value.templateId),
    name: templateName(value.name),
    folders: Object.freeze(folders),
    actions: Object.freeze(actions)
  };
  let serialized;
  try { serialized = JSON.stringify(result); }
  catch (_error) { invalid('项目模板无法序列化'); }
  if (Buffer.byteLength(serialized, 'utf8') > LIMITS.maxTemplateBytes) {
    invalid('项目模板过大');
  }
  return deepFreeze(result);
}

// 只消费 workbenches.js 的解析结果；绝不携带包目录、图标路径或 preset 路径。
function projectTemplateFromWorkbench(workbenchPackage) {
  if (!isPlainObject(workbenchPackage) || !Array.isArray(workbenchPackage.actions)) {
    invalid('工作台包无法投影为项目模板');
  }
  let plan;
  try { plan = workbenches.workspacePlan(workbenchPackage); }
  catch (error) {
    throw templateError('ERR_PROJECT_TEMPLATE_INVALID', '工作台 workspace 计划无效', error);
  }
  const reparsed = workbenches.parseActions({ actions: workbenchPackage.actions });
  if (reparsed.actions.length !== workbenchPackage.actions.length
      || reparsed.issues.length !== 0) {
    invalid('工作台 actions 无法安全投影');
  }
  return normalizeTemplate({
    templateId: workbenchPackage.id,
    name: workbenchPackage.name,
    folders: plan ? plan.folders : [],
    actions: reparsed.actions.map((action) => ({
      id: action.id,
      label: action.label,
      hint: action.hint,
      confirm: action.confirm,
      prompt: action.prompt
    }))
  });
}

function realpathSync(fsImpl, value) {
  const resolver = fsImpl.realpathSync;
  if (typeof resolver !== 'function') {
    throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '文件系统不支持 realpath');
  }
  const call = typeof resolver.native === 'function' ? resolver.native : resolver;
  try { return call.call(fsImpl, value); }
  catch (error) {
    throw templateError('ERR_PROJECT_TEMPLATE_ROOT', '无法验证项目根目录', error);
  }
}

function lstatMaybe(fsImpl, value) {
  try { return fsImpl.lstatSync(value); }
  catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '无法检查项目模板落点', error);
  }
}

function within(root, candidate, pathImpl) {
  const relative = pathImpl.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${pathImpl.sep}`)
    && !pathImpl.isAbsolute(relative)
  );
}

function assertWithin(root, candidate, pathImpl) {
  if (!within(root, candidate, pathImpl)) {
    throw templateError('ERR_PROJECT_TEMPLATE_BOUNDARY', '项目模板落点越出项目根');
  }
}

function inspectDirectory(fsImpl, pathImpl, root, candidate, allowMissing) {
  assertWithin(root, candidate, pathImpl);
  const stat = lstatMaybe(fsImpl, candidate);
  if (!stat) {
    if (allowMissing) return false;
    throw templateError('ERR_PROJECT_TEMPLATE_ROOT', '项目根目录不存在');
  }
  if (stat.isSymbolicLink()) {
    throw templateError('ERR_PROJECT_TEMPLATE_SYMLINK', '项目模板拒绝符号链接目录');
  }
  if (!stat.isDirectory()) {
    throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '项目模板目录落点不是目录');
  }
  let effective;
  try { effective = pathImpl.resolve(realpathSync(fsImpl, candidate)); }
  catch (error) {
    if (error && error.code === 'ERR_PROJECT_TEMPLATE_ROOT') {
      throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '无法验证项目模板目录', error);
    }
    throw error;
  }
  assertWithin(root, effective, pathImpl);
  return true;
}

function inspectFile(fsImpl, pathImpl, root, candidate) {
  assertWithin(root, candidate, pathImpl);
  const stat = lstatMaybe(fsImpl, candidate);
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    throw templateError('ERR_PROJECT_TEMPLATE_SYMLINK', '项目模板拒绝符号链接文件');
  }
  if (!stat.isFile()) {
    throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '项目模板文件落点不是普通文件');
  }
  let effective;
  try { effective = pathImpl.resolve(realpathSync(fsImpl, candidate)); }
  catch (error) {
    if (error && error.code === 'ERR_PROJECT_TEMPLATE_ROOT') {
      throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '无法验证项目模板文件', error);
    }
    throw error;
  }
  assertWithin(root, effective, pathImpl);
  return true;
}

function normalizeApplyOptions(options) {
  if (!isPlainObject(options)) invalid('项目模板落地参数无效');
  const allowed = new Set(['root', 'template', 'reason', 'fsImpl', 'pathImpl']);
  if (!Object.prototype.hasOwnProperty.call(options, 'root')
      || !Object.prototype.hasOwnProperty.call(options, 'template')
      || !Object.prototype.hasOwnProperty.call(options, 'reason')
      || Object.keys(options).some((key) => !allowed.has(key))) {
    invalid('项目模板落地参数无效');
  }
  if (!APPLY_REASONS.includes(options.reason)) {
    invalid('项目模板只能在新建或显式应用时落地');
  }
  const fsImpl = options.fsImpl === undefined ? fs : options.fsImpl;
  const pathImpl = options.pathImpl === undefined ? path : options.pathImpl;
  if (!fsImpl || ['lstatSync', 'realpathSync', 'mkdirSync', 'writeFileSync']
    .some((name) => typeof fsImpl[name] !== 'function')
      || !pathImpl || ['resolve', 'join', 'relative', 'isAbsolute']
        .some((name) => typeof pathImpl[name] !== 'function')
      || typeof pathImpl.sep !== 'string') {
    invalid('项目模板运行时注入无效');
  }
  if (typeof options.root !== 'string' || !options.root || options.root.includes('\0')
      || !pathImpl.isAbsolute(options.root)) invalid('项目根必须是绝对路径');
  return {
    root: options.root,
    template: normalizeTemplate(options.template),
    reason: options.reason,
    fsImpl,
    pathImpl
  };
}

function applyProjectTemplate(options) {
  const normalized = normalizeApplyOptions(options);
  const { fsImpl, pathImpl, template } = normalized;
  const suppliedRoot = pathImpl.resolve(normalized.root);
  const suppliedStat = lstatMaybe(fsImpl, suppliedRoot);
  if (!suppliedStat) {
    throw templateError('ERR_PROJECT_TEMPLATE_ROOT', '项目根目录不存在或不是目录');
  }
  if (suppliedStat.isSymbolicLink()) {
    throw templateError('ERR_PROJECT_TEMPLATE_SYMLINK', '项目根目录不能是符号链接');
  }
  if (!suppliedStat.isDirectory()) {
    throw templateError('ERR_PROJECT_TEMPLATE_ROOT', '项目根目录不存在或不是目录');
  }
  const root = pathImpl.resolve(realpathSync(fsImpl, suppliedRoot));
  inspectDirectory(fsImpl, pathImpl, root, root, false);

  // 模板必须能在三平台往返：用 NFC + 大小写不敏感键预先拒绝
  // macOS/Windows 上会合并、但 Linux 上看似不同的路径。
  const pathKey = (value) => value.normalize('NFC').toLocaleLowerCase('en-US');
  const directories = new Map();
  const files = [];
  for (const folder of template.folders) {
    let current = root;
    for (const segment of folder.segments) {
      current = pathImpl.join(current, segment);
      assertWithin(root, current, pathImpl);
      directories.set(pathKey(current), current);
    }
    for (const file of folder.files) {
      const target = pathImpl.join(current, file.name);
      assertWithin(root, target, pathImpl);
      files.push({
        target,
        parent: current,
        relative: `${folder.path}/${file.name}`,
        content: file.content
      });
    }
  }
  const fileTargets = new Set();
  for (const file of files) {
    const key = pathKey(file.target);
    if (directories.has(key)) {
      throw templateError('ERR_PROJECT_TEMPLATE_INVALID', '项目模板落点同时被声明为目录和文件');
    }
    if (fileTargets.has(key)) {
      throw templateError('ERR_PROJECT_TEMPLATE_INVALID', '项目模板文件落点重复');
    }
    fileTargets.add(key);
  }

  // 先预检全部落点：已知的软链、越界或类型冲突不会留下半套新文件。
  const directoryRows = [...directories.values()].sort((left, right) => (
    left.split(pathImpl.sep).length - right.split(pathImpl.sep).length
  ));
  for (const directory of directoryRows) {
    inspectDirectory(fsImpl, pathImpl, root, directory, true);
  }
  const kept = [];
  const missing = [];
  for (const file of files) {
    if (inspectFile(fsImpl, pathImpl, root, file.target)) kept.push(file.relative);
    else missing.push(file);
  }

  for (const directory of directoryRows) {
    if (lstatMaybe(fsImpl, directory)) {
      inspectDirectory(fsImpl, pathImpl, root, directory, false);
      continue;
    }
    try { fsImpl.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '项目模板目录创建失败', error);
      }
    }
    inspectDirectory(fsImpl, pathImpl, root, directory, false);
  }

  const created = [];
  for (const file of missing) {
    inspectDirectory(fsImpl, pathImpl, root, file.parent, false);
    try {
      fsImpl.writeFileSync(file.target, file.content, {
        encoding: 'utf8', flag: 'wx', mode: 0o600
      });
      inspectFile(fsImpl, pathImpl, root, file.target);
      created.push(file.relative);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        inspectFile(fsImpl, pathImpl, root, file.target);
        kept.push(file.relative);
        continue;
      }
      if (error && /^ERR_PROJECT_TEMPLATE_/.test(String(error.code || ''))) throw error;
      throw templateError('ERR_PROJECT_TEMPLATE_APPLY', '项目模板文件创建失败', error);
    }
  }

  return deepFreeze({
    kind: 'project-template-applied',
    templateId: template.templateId,
    reason: normalized.reason,
    created,
    kept,
    // 返回的 action 仍是只含白名单字段的静态数据。
    actions: template.actions.map((action) => ({
      id: action.id,
      label: action.label,
      hint: action.hint,
      confirm: action.confirm,
      prompt: action.prompt
    }))
  });
}

module.exports = Object.freeze({
  APPLY_REASONS,
  LIMITS,
  projectTemplateFromWorkbench,
  applyProjectTemplate
});
