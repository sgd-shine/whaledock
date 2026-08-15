'use strict';

// v0.4 工作区路径、recent、journal 与切换事务。
// 保持纯 Node：不依赖 Electron，不包含 dsh wire/method 假设。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOURNAL_SCHEMA_VERSION = 1;
const JOURNAL_PHASES = new Set(['prepared', 'config-applied']);
const MAX_RECENT_WORKDIRS = 10;
const MAX_PATH_LENGTH = 4096;

function workspaceError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = clone(item);
    return result;
  }
  return value;
}

function pathTools(platform, supplied) {
  if (supplied) return supplied;
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizedPath(value, options = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PATH_LENGTH) {
    throw workspaceError('ERR_WORKSPACE_PATH', '工作区路径无效');
  }
  const tools = pathTools(options.platform || process.platform, options.pathImpl);
  return tools.resolve(value.trim());
}

function comparisonKey(value, options = {}) {
  const platform = options.platform || process.platform;
  const normalized = normalizedPath(value, options);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function assertWorkspaceNotForbidden(value, options = {}) {
  const roots = options.forbiddenRoots;
  if (roots === undefined) return;
  if (!Array.isArray(roots)) {
    throw workspaceError('ERR_WORKSPACE_PROTECTED', '工作区保护根策略无效');
  }
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const candidate = comparisonKey(value, { platform, pathImpl: tools });
  for (const root of roots) {
    let protectedRoot;
    try { protectedRoot = comparisonKey(root, { platform, pathImpl: tools }); }
    catch (error) { throw workspaceError('ERR_WORKSPACE_PROTECTED', '工作区保护根策略无效', error); }
    const prefix = protectedRoot.endsWith(tools.sep)
      ? protectedRoot : `${protectedRoot}${tools.sep}`;
    if (candidate === protectedRoot || candidate.startsWith(prefix)) {
      throw workspaceError('ERR_WORKSPACE_PROTECTED', '该路径属于鲸坞禁止使用的受保护目录');
    }
  }
}

function canonicalWorkspace(value, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const resolved = normalizedPath(value, { platform, pathImpl: tools });
  // 先做字面 containment，选择受保护根本身/后代时不触碰其文件系统元数据。
  assertWorkspaceNotForbidden(resolved, { ...options, platform, pathImpl: tools });
  let stat;
  try { stat = fsImpl.statSync(resolved); } catch (error) {
    throw workspaceError('ERR_WORKSPACE_NOT_DIRECTORY', '工作区不存在或无法访问', error);
  }
  if (!stat || typeof stat.isDirectory !== 'function' || !stat.isDirectory()) {
    throw workspaceError('ERR_WORKSPACE_NOT_DIRECTORY', '工作区不是文件夹');
  }
  let real;
  try { real = fsImpl.realpathSync(resolved); } catch (error) {
    throw workspaceError('ERR_WORKSPACE_REALPATH', '无法验证工作区真实路径', error);
  }
  const canonicalPath = tools.resolve(String(real));
  // 再检查 realpath，阻断工作区 symlink/junction 落入受保护根。
  assertWorkspaceNotForbidden(canonicalPath, { ...options, platform, pathImpl: tools });
  return Object.freeze({
    path: canonicalPath,
    key: platform === 'win32' ? canonicalPath.toLocaleLowerCase('en-US') : canonicalPath
  });
}

function defaultWorkspacePath(documentsDir, options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  return tools.join(normalizedPath(documentsDir, { platform, pathImpl: tools }), '鲸坞工作台', '默认工作区');
}

function ensureDefaultWorkspace(documentsDir, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const documentsPath = normalizedPath(documentsDir, { platform, pathImpl: tools });
  assertWorkspaceNotForbidden(documentsPath, { ...options, platform, pathImpl: tools });
  let effectiveDocuments = documentsPath;
  try {
    effectiveDocuments = tools.resolve(String(fsImpl.realpathSync(documentsPath)));
    assertWorkspaceNotForbidden(effectiveDocuments, { ...options, platform, pathImpl: tools });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      if (error && error.code === 'ERR_WORKSPACE_PROTECTED') throw error;
      throw workspaceError('ERR_WORKSPACE_DEFAULT_CREATE', '无法验证文档目录真实路径', error);
    }
  }
  const target = tools.join(effectiveDocuments, '鲸坞工作台', '默认工作区');
  assertWorkspaceNotForbidden(target, { ...options, platform, pathImpl: tools });
  let created = false;
  let existing = null;
  try { existing = fsImpl.lstatSync(target); } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw workspaceError('ERR_WORKSPACE_DEFAULT_CREATE', '无法检查默认工作区', error);
    }
  }
  if (existing) {
    let followed;
    try { followed = fsImpl.statSync(target); } catch (error) {
      throw workspaceError('ERR_WORKSPACE_NOT_DIRECTORY', '默认工作区无法访问', error);
    }
    if (!followed.isDirectory()) {
      throw workspaceError('ERR_WORKSPACE_NOT_DIRECTORY', '默认工作区同名路径不是文件夹');
    }
  } else {
    try {
      fsImpl.mkdirSync(target, { recursive: true, mode: 0o700 });
      if (platform !== 'win32' && typeof fsImpl.chmodSync === 'function') fsImpl.chmodSync(target, 0o700);
      created = true;
    } catch (error) {
      throw workspaceError('ERR_WORKSPACE_DEFAULT_CREATE', '无法创建默认工作区', error);
    }
  }
  const canonical = canonicalWorkspace(target, {
    ...options, fsImpl, platform, pathImpl: tools
  });
  return Object.freeze({ canonicalPath: canonical.path, created });
}

function normalizeRecentWorkdirs(values, options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const limit = options.limit === undefined ? MAX_RECENT_WORKDIRS : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_WORKDIRS) {
    throw workspaceError('ERR_WORKSPACE_RECENT_LIMIT', '最近工作区上限无效');
  }
  if (!Array.isArray(values)) {
    throw workspaceError('ERR_WORKSPACE_RECENT', '最近工作区必须是数组');
  }
  const result = [];
  const keys = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_PATH_LENGTH) continue;
    const normalized = normalizedPath(value, { platform, pathImpl: tools });
    const key = platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function updateRecentWorkdirs(options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const target = normalizedPath(options.target, { platform, pathImpl: tools });
  const values = [target];
  if (typeof options.current === 'string' && options.current.trim()) values.push(options.current);
  if (Array.isArray(options.previous)) values.push(...options.previous);
  return normalizeRecentWorkdirs(values, {
    platform,
    pathImpl: tools,
    limit: options.limit === undefined ? MAX_RECENT_WORKDIRS : options.limit
  });
}

function boundedLabel(value, maximum = 80) {
  const clean = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maximum) return clean;
  return `…${clean.slice(-(maximum - 1))}`;
}

function workspaceMenuView(options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const home = normalizedPath(options.homeDir, { platform, pathImpl: tools });
  const configuredPath = options.workdir == null
    ? null : normalizedPath(options.workdir, { platform, pathImpl: tools });
  const effectivePath = configuredPath || home;
  const effectiveKey = comparisonKey(effectivePath, { platform, pathImpl: tools });
  const recentValues = normalizeRecentWorkdirs(Array.isArray(options.recentWorkdirs)
    ? options.recentWorkdirs : [], { platform, pathImpl: tools });
  const paths = [effectivePath, ...recentValues.filter((value) => (
    comparisonKey(value, { platform, pathImpl: tools }) !== effectiveKey
  ))];
  const baseCounts = new Map();
  for (const value of paths) {
    const base = tools.basename(value) || value;
    const key = platform === 'win32' ? base.toLocaleLowerCase('en-US') : base;
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }
  const preliminary = paths.map((value) => {
    const base = tools.basename(value) || value;
    const baseKey = platform === 'win32' ? base.toLocaleLowerCase('en-US') : base;
    const parent = tools.basename(tools.dirname(value));
    const label = (baseCounts.get(baseKey) || 0) > 1 && parent
      ? `${base} — ${parent}` : base;
    return { value, base, label };
  });
  const labelCounts = new Map();
  for (const item of preliminary) {
    const key = platform === 'win32' ? item.label.toLocaleLowerCase('en-US') : item.label;
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  }
  const menuItems = preliminary.map((item) => {
    const labelKey = platform === 'win32' ? item.label.toLocaleLowerCase('en-US') : item.label;
    let label = item.label;
    if ((labelCounts.get(labelKey) || 0) > 1) {
      const parent = tools.basename(tools.dirname(item.value));
      const grandparent = tools.basename(tools.dirname(tools.dirname(item.value)));
      label = `${item.base} — ${grandparent ? `${grandparent}${tools.sep}` : ''}${parent}`;
    }
    return Object.freeze({ path: item.value, label: boundedLabel(label) });
  });
  return Object.freeze({
    current: Object.freeze({
      configuredPath,
      effectivePath,
      label: configuredPath === null ? '主目录（旧配置）' : menuItems[0].label,
      legacyHome: configuredPath === null
    }),
    recent: Object.freeze(menuItems.slice(1))
  });
}

function exactKeys(value, allowed, label) {
  if (!isRecord(value)) throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', `${label} 必须是对象`);
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', `${label} 字段不符合合约`);
  }
}

function validateJournalPath(value, nullable, platform, tools, label) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH || !tools.isAbsolute(value)) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', `${label} 必须是绝对路径`);
  }
  return normalizedPath(value, { platform, pathImpl: tools });
}

function validateJournalRecent(value, platform, tools, label) {
  if (!Array.isArray(value) || value.length > MAX_RECENT_WORKDIRS) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', `${label} 必须是有界数组`);
  }
  const result = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry || entry.length > MAX_PATH_LENGTH || !tools.isAbsolute(entry)) {
      throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', `${label} 含无效路径`);
    }
    result.push(normalizedPath(entry, { platform, pathImpl: tools }));
  }
  const normalized = normalizeRecentWorkdirs(result, { platform, pathImpl: tools });
  if (normalized.length !== result.length) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', `${label} 含重复路径`);
  }
  return normalized;
}

function validateWorkspaceJournal(value, options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  exactKeys(value, ['schemaVersion', 'phase', 'startedAt', 'previous', 'target', 'previousRuntime'], 'journal');
  if (value.schemaVersion !== JOURNAL_SCHEMA_VERSION || !JOURNAL_PHASES.has(value.phase)) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', 'journal schemaVersion/phase 无效');
  }
  if (typeof value.startedAt !== 'string' || value.startedAt.length > 64
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt)
      || Number.isNaN(Date.parse(value.startedAt))) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', 'journal startedAt 无效');
  }
  exactKeys(value.previous, ['workdir', 'recentWorkdirs'], 'journal.previous');
  exactKeys(value.target, ['workdir', 'recentWorkdirs'], 'journal.target');
  exactKeys(value.previousRuntime, ['wasReady', 'wasManaged'], 'journal.previousRuntime');
  if (typeof value.previousRuntime.wasReady !== 'boolean'
      || typeof value.previousRuntime.wasManaged !== 'boolean'
      || (value.previousRuntime.wasManaged && !value.previousRuntime.wasReady)) {
    throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', 'journal previousRuntime 无效');
  }
  return Object.freeze({
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    phase: value.phase,
    startedAt: value.startedAt,
    previous: Object.freeze({
      workdir: validateJournalPath(value.previous.workdir, true, platform, tools, 'previous.workdir'),
      recentWorkdirs: Object.freeze(validateJournalRecent(
        value.previous.recentWorkdirs, platform, tools, 'previous.recentWorkdirs'
      ))
    }),
    target: Object.freeze({
      workdir: validateJournalPath(value.target.workdir, false, platform, tools, 'target.workdir'),
      recentWorkdirs: Object.freeze(validateJournalRecent(
        value.target.recentWorkdirs, platform, tools, 'target.recentWorkdirs'
      ))
    }),
    previousRuntime: Object.freeze({
      wasReady: value.previousRuntime.wasReady,
      wasManaged: value.previousRuntime.wasManaged
    })
  });
}

function createWorkspaceJournalStore(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const filePath = normalizedPath(options.filePath, { platform, pathImpl: tools });
  const completedPath = `${filePath}.completed`;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const randomId = typeof options.randomId === 'function'
    ? options.randomId : () => crypto.randomBytes(8).toString('hex');

  const atomicWrite = (value) => {
    const normalized = validateWorkspaceJournal(value, { platform, pathImpl: tools });
    fsImpl.mkdirSync(tools.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp-${process.pid}-${randomId()}`;
    try {
      fsImpl.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      if (platform !== 'win32' && typeof fsImpl.chmodSync === 'function') fsImpl.chmodSync(tmp, 0o600);
      fsImpl.renameSync(tmp, filePath);
    } catch (error) {
      try { fsImpl.unlinkSync(tmp); } catch (_cleanupError) { /* 原子写清理尽力而为 */ }
      throw workspaceError('ERR_WORKSPACE_JOURNAL_WRITE', '工作区 journal 写入失败', error);
    }
    return normalized;
  };

  const read = () => {
    let raw;
    try { raw = fsImpl.readFileSync(filePath, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw workspaceError('ERR_WORKSPACE_JOURNAL_READ', '工作区 journal 读取失败', error);
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) {
      throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', '工作区 journal JSON 无效', error);
    }
    return validateWorkspaceJournal(parsed, { platform, pathImpl: tools });
  };

  const exists = (target) => {
    try { fsImpl.lstatSync(target); return true; } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  };

  const remove = () => {
    try { fsImpl.unlinkSync(filePath); return true; } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw workspaceError('ERR_WORKSPACE_JOURNAL_REMOVE', '工作区 journal 删除失败', error);
    }
  };

  const cleanupCompleted = () => {
    try { fsImpl.unlinkSync(completedPath); return true; } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      return false;
    }
  };

  const finalize = () => {
    try {
      if (exists(completedPath)) fsImpl.unlinkSync(completedPath);
      fsImpl.renameSync(filePath, completedPath);
    } catch (error) {
      throw workspaceError('ERR_WORKSPACE_JOURNAL_FINALIZE', 'journal 无法移出活动恢复路径', error);
    }
    let cleanupPending = false;
    try { fsImpl.unlinkSync(completedPath); } catch (error) {
      if (!error || error.code !== 'ENOENT') cleanupPending = true;
    }
    return Object.freeze({ completed: true, cleanupPending });
  };

  const quarantineInvalid = (limit = 3) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', 'journal 诊断备份上限无效');
    }
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const target = `${filePath}.invalid-${stamp}-${randomId()}`;
    try { fsImpl.renameSync(filePath, target); } catch (error) {
      throw workspaceError('ERR_WORKSPACE_JOURNAL_QUARANTINE', '无法保留坏 journal 诊断备份', error);
    }
    try {
      const prefix = `${tools.basename(filePath)}.invalid-`;
      const rows = fsImpl.readdirSync(tools.dirname(filePath))
        .filter((name) => name.startsWith(prefix)).sort().reverse();
      for (const name of rows.slice(limit)) {
        try { fsImpl.unlinkSync(tools.join(tools.dirname(filePath), name)); } catch (_error) { /* 有界清理尽力 */ }
      }
    } catch (_error) { /* 备份已保留，列表失败不扩大 */ }
    return target;
  };

  return Object.freeze({
    filePath,
    completedPath,
    read,
    writePrepared(value) {
      if (!value || value.phase !== 'prepared') {
        throw workspaceError('ERR_WORKSPACE_JOURNAL_INVALID', 'prepared journal phase 无效');
      }
      return atomicWrite(value);
    },
    writeConfigApplied(value) {
      const next = { ...clone(value), phase: 'config-applied' };
      return atomicWrite(next);
    },
    finalize,
    remove,
    cleanupCompleted,
    quarantineInvalid
  });
}

function classifyBackendRuntime(runtime) {
  const source = isRecord(runtime) ? runtime : {};
  const ready = source.backendReady === true;
  const owned = source.spawnedByUs === true;
  const state = isRecord(source.state) ? source.state : null;
  const aliveState = Boolean(state && state.exited !== true);
  if (ready && owned && aliveState) return Object.freeze({ kind: 'managed', state });
  if (ready && !owned && state === null) return Object.freeze({ kind: 'external', state: null });
  if (!ready && !owned && state === null) return Object.freeze({ kind: 'stopped', state: null });
  return Object.freeze({ kind: 'unknown', state });
}

function workspaceState(value) {
  const source = isRecord(value) ? value : {};
  return {
    workdir: source.workdir == null ? null : source.workdir,
    recentWorkdirs: Array.isArray(source.recentWorkdirs) ? [...source.recentWorkdirs] : []
  };
}

function workspaceStateEqual(left, right, options = {}) {
  const a = workspaceState(left);
  const b = workspaceState(right);
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const pathEqual = (one, two) => {
    if (one === null || two === null) return one === two;
    return comparisonKey(one, { platform, pathImpl: tools })
      === comparisonKey(two, { platform, pathImpl: tools });
  };
  if (!pathEqual(a.workdir, b.workdir) || a.recentWorkdirs.length !== b.recentWorkdirs.length) return false;
  return a.recentWorkdirs.every((value, index) => pathEqual(value, b.recentWorkdirs[index]));
}

function createWorkspaceSwitchCoordinator(options = {}) {
  const required = [
    'canonicalize', 'getConfig', 'setWorkspaceConfig', 'getRuntime',
    'isBudgetPaused', 'journal', 'stopManaged', 'startAndConfirm'
  ];
  for (const key of required) {
    if ((key === 'journal' && !options.journal)
        || (key !== 'journal' && typeof options[key] !== 'function')) {
      throw workspaceError('ERR_WORKSPACE_COORDINATOR', `工作区协调器缺少 ${key}`);
    }
  }
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  const homeDir = normalizedPath(options.homeDir, { platform, pathImpl: tools });
  const journal = options.journal;
  const invalidateCaptures = typeof options.invalidateCaptures === 'function'
    ? options.invalidateCaptures : async () => {};
  const quiesceEvents = typeof options.quiesceEvents === 'function'
    ? options.quiesceEvents : async () => {};
  const recoveryPortClear = typeof options.recoveryPortClear === 'function'
    ? options.recoveryPortClear : async () => true;
  const onCommit = typeof options.onCommit === 'function' ? options.onCommit : async () => {};
  const onRollback = typeof options.onRollback === 'function' ? options.onRollback : async () => {};
  let generation = 0;
  let pendingOperations = 0;
  let serial = Promise.resolve();

  const canonical = (value) => {
    const result = options.canonicalize(value);
    if (!result || typeof result.path !== 'string' || typeof result.key !== 'string') {
      throw workspaceError('ERR_WORKSPACE_PATH', 'canonicalize 未返回有效工作区');
    }
    return { path: result.path, key: result.key };
  };

  const snapshotFrom = (value) => {
    const state = workspaceState(value);
    const effective = canonical(state.workdir || homeDir);
    return Object.freeze({
      workdir: state.workdir,
      effectiveWorkdir: effective.path,
      recentWorkdirs: Object.freeze([...state.recentWorkdirs]),
      generation
    });
  };

  let committed = snapshotFrom(options.getConfig());

  const enqueue = (operation) => {
    pendingOperations += 1;
    const invoke = async () => {
      try { return await operation(); } finally { pendingOperations -= 1; }
    };
    const run = serial.then(invoke, invoke);
    serial = run.catch(() => {});
    return run;
  };

  const removePreparedOrThrow = async () => {
    try { await journal.remove(); } catch (error) {
      throw workspaceError('ERR_WORKSPACE_JOURNAL_REMOVE', '无法清理未生效的切换 journal', error);
    }
  };

  const validateStarted = (started, expected) => {
    if (!started || !started.state || started.state.exited === true) {
      throw workspaceError('ERR_WORKSPACE_TARGET_START', '目标后端未保持运行');
    }
    if (typeof started.effectiveWorkdir !== 'string') {
      const error = workspaceError('ERR_WORKSPACE_TARGET_CWD', '目标后端未返回可证明的有效工作区');
      error.state = started.state;
      throw error;
    }
    const actual = canonical(started.effectiveWorkdir);
    if (actual.key !== expected.key) {
      const error = workspaceError('ERR_WORKSPACE_TARGET_CWD', '目标后端有效工作区不匹配');
      error.state = started.state;
      throw error;
    }
    return started;
  };

  const rollback = async ({ original, record, previousRuntime, oldStopped, configApplied, targetState }) => {
    if (targetState && targetState.exited !== true) {
      let stopError;
      try { await options.stopManaged(targetState); } catch (error) { stopError = error; }
      if (targetState.exited !== true) {
        const error = workspaceError(
          'ERR_WORKSPACE_ROLLBACK_TARGET_STOP',
          '目标后端未确认退出，保留目标配置与 journal 等待恢复',
          stopError
        );
        error.state = targetState;
        error.targetState = targetState;
        error.transactionError = original;
        throw error;
      }
    }
    if (configApplied) {
      try { await options.setWorkspaceConfig(clone(record.previous)); } catch (error) {
        throw workspaceError('ERR_WORKSPACE_ROLLBACK_CONFIG', '目标失败且原工作区配置恢复失败', error);
      }
    }
    if (oldStopped && previousRuntime.kind === 'managed') {
      try {
        const restored = await options.startAndConfirm({
          workdir: record.previous.workdir,
          recentWorkdirs: [...record.previous.recentWorkdirs],
          rollback: true
        });
        const previousEffective = canonical(record.previous.workdir || homeDir);
        validateStarted(restored, previousEffective);
      } catch (error) {
        throw workspaceError('ERR_WORKSPACE_ROLLBACK_BACKEND', '原工作区配置已恢复，但后端恢复失败', error);
      }
    }
    try { await journal.remove(); } catch (error) {
      throw workspaceError('ERR_WORKSPACE_ROLLBACK_JOURNAL', '原工作区已恢复，但 journal 保留待下次对账', error);
    }
    committed = snapshotFrom(record.previous);
    try { await onRollback(committed); } catch (_error) { /* UI 刷新不改变回滚事实 */ }
    if (original && typeof original === 'object') original.rolledBack = true;
    throw original;
  };

  const switchOnce = async (targetValue) => {
    const beforeConfig = workspaceState(options.getConfig());
    const beforeEffective = canonical(beforeConfig.workdir || homeDir);
    const target = canonical(targetValue);
    if (beforeEffective.key === target.key) {
      return Object.freeze({ status: 'noop', workspace: committed });
    }
    if (options.isBudgetPaused() === true) {
      throw workspaceError('ERR_WORKSPACE_BUDGET_PAUSED', '今日预算暂停中，未切换工作区');
    }
    const previousRuntime = classifyBackendRuntime(options.getRuntime());
    if (previousRuntime.kind === 'external') {
      throw workspaceError('ERR_WORKSPACE_EXTERNAL_ATTACH', '外部 dsh 正在运行，鲸坞未停止也未切换');
    }
    if (previousRuntime.kind === 'unknown') {
      throw workspaceError('ERR_WORKSPACE_RUNTIME_UNKNOWN', '后端归属不可证明，未切换工作区');
    }

    const targetState = {
      workdir: target.path,
      recentWorkdirs: updateRecentWorkdirs({
        previous: beforeConfig.recentWorkdirs,
        current: beforeConfig.workdir,
        target: target.path,
        platform,
        pathImpl: tools
      })
    };
    let record = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      phase: 'prepared',
      startedAt: new Date().toISOString(),
      previous: beforeConfig,
      target: targetState,
      previousRuntime: {
        wasReady: previousRuntime.kind === 'managed',
        wasManaged: previousRuntime.kind === 'managed'
      }
    };
    record = await journal.writePrepared(record);
    let oldStopped = false;
    let configApplied = false;
    let started = null;

    try {
      await invalidateCaptures();
      await quiesceEvents();
      if (options.isBudgetPaused() === true) {
        await removePreparedOrThrow();
        throw workspaceError('ERR_WORKSPACE_BUDGET_PAUSED', '事件落盘后今日预算已暂停，未切换工作区');
      }
      const runtimeAfterQuiesce = classifyBackendRuntime(options.getRuntime());
      if (runtimeAfterQuiesce.kind === 'external') {
        await removePreparedOrThrow();
        throw workspaceError('ERR_WORKSPACE_EXTERNAL_ATTACH', '切换前后端已变为外部服务，未改配置');
      }
      if (runtimeAfterQuiesce.kind === 'unknown'
          || (previousRuntime.kind === 'managed'
            && (runtimeAfterQuiesce.kind !== 'managed'
              || runtimeAfterQuiesce.state !== previousRuntime.state))) {
        await removePreparedOrThrow();
        throw workspaceError('ERR_WORKSPACE_RUNTIME_UNKNOWN', '切换前后端归属已变化，未改配置');
      }

      if (previousRuntime.kind === 'managed') {
        try {
          await options.stopManaged(previousRuntime.state);
          if (previousRuntime.state.exited !== true) {
            throw workspaceError('ERR_WORKSPACE_STOP', '原托管后端未确认退出');
          }
          oldStopped = true;
        } catch (error) {
          oldStopped = previousRuntime.state.exited === true;
          throw error;
        }
      }
      await options.setWorkspaceConfig(clone(targetState));
      configApplied = true;
      record = await journal.writeConfigApplied(record);
      try {
        started = await options.startAndConfirm({
          workdir: target.path,
          recentWorkdirs: [...targetState.recentWorkdirs],
          rollback: false
        });
        validateStarted(started, target);
      } catch (error) {
        if (!started && error && error.state) started = { state: error.state };
        throw error;
      }
      await journal.finalize();
    } catch (error) {
      // 二次 gate 已在任何 stop/config 前清理 journal，无需伪回滚。
      if (!oldStopped && !configApplied && !started
          && ['ERR_WORKSPACE_BUDGET_PAUSED', 'ERR_WORKSPACE_EXTERNAL_ATTACH', 'ERR_WORKSPACE_RUNTIME_UNKNOWN']
            .includes(error && error.code)) throw error;
      return rollback({
        original: error,
        record,
        previousRuntime,
        oldStopped,
        configApplied,
        targetState: started && started.state
      });
    }

    generation += 1;
    committed = snapshotFrom(targetState);
    let surfaceWarning = null;
    try { await onCommit(committed); } catch (_error) { surfaceWarning = 'surface-refresh-failed'; }
    return Object.freeze({
      status: 'committed',
      workspace: committed,
      ...(surfaceWarning ? { warning: surfaceWarning } : {})
    });
  };

  const recoverOnce = async () => {
    try { await journal.cleanupCompleted(); } catch (_error) { /* completed 不参与恢复 */ }
    const record = await journal.read();
    if (!record) return Object.freeze({ status: 'none', workspace: committed });
    const current = workspaceState(options.getConfig());
    if (!workspaceStateEqual(current, record.previous, { platform, pathImpl: tools })
        && !workspaceStateEqual(current, record.target, { platform, pathImpl: tools })) {
      throw workspaceError('ERR_WORKSPACE_RECOVERY_CONFIG_DRIFT', '配置已与未完成 journal 分叉，未覆盖用户修改');
    }
    if (!workspaceStateEqual(current, record.previous, { platform, pathImpl: tools })) {
      try { await options.setWorkspaceConfig(clone(record.previous)); } catch (error) {
        throw workspaceError('ERR_WORKSPACE_ROLLBACK_CONFIG', '启动时无法恢复原工作区配置', error);
      }
    }
    if (record.previousRuntime.wasReady && !record.previousRuntime.wasManaged) {
      throw workspaceError('ERR_WORKSPACE_RECOVERY_EXTERNAL', '未完成事务记录了外部服务，未 attach 也未停止');
    }
    if (record.previousRuntime.wasManaged) {
      if (await recoveryPortClear() !== true) {
        throw workspaceError('ERR_WORKSPACE_RECOVERY_PORT_OCCUPIED', '恢复时端口已被不明服务占用，未 attach 也未停止');
      }
      try {
        const restored = await options.startAndConfirm({
          workdir: record.previous.workdir,
          recentWorkdirs: [...record.previous.recentWorkdirs],
          rollback: true,
          recovery: true
        });
        validateStarted(restored, canonical(record.previous.workdir || homeDir));
      } catch (error) {
        throw workspaceError('ERR_WORKSPACE_ROLLBACK_BACKEND', '原工作区配置已恢复，但启动后端失败', error);
      }
    }
    try { await journal.remove(); } catch (error) {
      throw workspaceError('ERR_WORKSPACE_ROLLBACK_JOURNAL', '恢复已完成，但 journal 仍保留待下次对账', error);
    }
    generation += 1;
    committed = snapshotFrom(record.previous);
    try { await onRollback(committed); } catch (_error) { /* UI 刷新不改变恢复事实 */ }
    return Object.freeze({ status: 'rolled-back', workspace: committed });
  };

  return Object.freeze({
    switchTo(target) { return enqueue(() => switchOnce(target)); },
    recoverAtStartup() { return enqueue(recoverOnce); },
    snapshot() { return committed; },
    get generation() { return generation; },
    get busy() { return pendingOperations > 0; }
  });
}

module.exports = {
  JOURNAL_SCHEMA_VERSION,
  MAX_RECENT_WORKDIRS,
  canonicalWorkspace,
  defaultWorkspacePath,
  ensureDefaultWorkspace,
  normalizeRecentWorkdirs,
  updateRecentWorkdirs,
  workspaceMenuView,
  validateWorkspaceJournal,
  createWorkspaceJournalStore,
  classifyBackendRuntime,
  workspaceStateEqual,
  createWorkspaceSwitchCoordinator
};
