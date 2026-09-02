'use strict';

// v0.11 旧工作区 -> 项目注册表的一次性兼容层。
// 只读 config 快照，不写、不清理 workdir/workbenchId；幂等性来自相同文件夹
// 必须复用已有项目。真正的路径 canonicalize/受保护根判定继续由 projects.js 权威执行。
// 模块保持纯 Node，不依赖 Electron，不增加第三方依赖。

const PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
// 与 config.normalizeWorkbenchId / projects.validateTemplateId 同口径。
const TEMPLATE_ID_RE = /^(?:builtin|user):[^\u0000-\u001f\u007f\\/]{1,88}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function migrationError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeTemplateId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 96 || !TEMPLATE_ID_RE.test(value)) {
    throw migrationError('ERR_PROJECT_MIGRATION_INVALID', '旧工作台 id 无效');
  }
  return value;
}

function safeProject(value) {
  if (!isPlainObject(value) || value.kind !== 'user'
      || typeof value.id !== 'string' || !PROJECT_ID_RE.test(value.id)
      || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40
      || CONTROL_RE.test(value.name)
      || typeof value.icon !== 'string' || !value.icon || value.icon.length > 8
      || /[\s\u0000-\u001f\u007f]/.test(value.icon)
      || typeof value.folderTail !== 'string' || !value.folderTail
      || value.folderTail.length > 255 || CONTROL_RE.test(value.folderTail)
      || /[\\/]/.test(value.folderTail)
      || value.folderTail === '.' || value.folderTail === '..') {
    throw migrationError('ERR_PROJECT_MIGRATION_RUNTIME', '项目注册表返回了无效项目');
  }
  return Object.freeze({
    projectId: value.id,
    name: value.name.trim(),
    icon: value.icon,
    folderTail: value.folderTail,
    templateId: safeTemplateId(value.templateId)
  });
}

function receipt(status, reason, value, requestedTemplateId) {
  const project = value === null ? null : safeProject(value);
  return deepFreeze({
    kind: 'legacy-project-migration',
    status,
    reason,
    project,
    templatePreserved: project !== null
      && project.templateId !== requestedTemplateId
  });
}

function migrateLegacyProject(options) {
  if (!isPlainObject(options)
      || !Object.prototype.hasOwnProperty.call(options, 'config')
      || !Object.prototype.hasOwnProperty.call(options, 'projectStore')
      || Object.keys(options).some((key) => !['config', 'projectStore'].includes(key))
      || !isPlainObject(options.config)) {
    throw new TypeError('legacy project migration options invalid');
  }
  const projectStore = options.projectStore;
  if (!projectStore || ['ensureConsole', 'findByFolder', 'create']
    .some((name) => typeof projectStore[name] !== 'function')) {
    throw new TypeError('legacy project migration store invalid');
  }

  // 不管旧配置是否有可迁移目录，控制室都先幂等就位。
  const consoleProject = projectStore.ensureConsole();
  if (!isPlainObject(consoleProject) || consoleProject.kind !== 'builtin'
      || consoleProject.pinned !== true || consoleProject.hasFolder !== false) {
    throw migrationError('ERR_PROJECT_MIGRATION_RUNTIME', '控制室项目初始化无效');
  }

  const rawWorkdir = options.config.workdir;
  if (rawWorkdir === null || rawWorkdir === undefined
      || (typeof rawWorkdir === 'string' && rawWorkdir.trim() === '')) {
    return receipt('skipped', 'no-workdir', null, null);
  }
  if (typeof rawWorkdir !== 'string' || rawWorkdir.includes('\0')) {
    throw migrationError('ERR_PROJECT_MIGRATION_INVALID', '旧工作目录无效');
  }
  const requestedTemplateId = safeTemplateId(options.config.workbenchId);

  const existing = projectStore.findByFolder(rawWorkdir);
  if (existing) return receipt('reused', null, existing, requestedTemplateId);

  try {
    const created = projectStore.create({
      folder: rawWorkdir,
      templateId: requestedTemplateId
    });
    return receipt('created', null, created, requestedTemplateId);
  } catch (error) {
    // 多窗口/多进程在 find 与 create 之间竞态时，相同文件夹仍必须收敛
    // 到已经落库的那一项，不生成第二个身份。
    if (error && error.code === 'ERR_PROJECT_DUPLICATE_FOLDER') {
      const raced = projectStore.findByFolder(rawWorkdir);
      if (raced) return receipt('reused', 'duplicate-race', raced, requestedTemplateId);
    }
    throw error;
  }
}

module.exports = Object.freeze({
  migrateLegacyProject
});
