'use strict';
// 鲸坞 WhaleDock — 非官方 DeepSeek Harness 桌面客户端（原名 Harness Desktop）
// 职责：自动拉起本地 dsh 服务 → 原生窗口承载 Web UI → 托盘 / 全局快捷键 / 菜单

const MAIN_HELPER_TEST = process.env.WHALEDOCK_MAIN_HELPER_TEST === '1' && require.main !== module;
const electron = MAIN_HELPER_TEST ? {} : require('electron');
const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  shell, ipcMain, dialog, clipboard, nativeImage, Notification
} = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const config = require('./lib/config');
const backend = require('./lib/backend');
const events = require('./lib/events');
const workspaces = require('./lib/workspaces');
const imageInput = require('./lib/image-input');
const pets = require('./lib/pets');
const themes = require('./lib/themes');
const log = require('./lib/log');
const update = require('./lib/update');

if (!MAIN_HELPER_TEST) {
  app.setName('WhaleDock');
  if (process.platform === 'win32') app.setAppUserModelId('com.sgd.whaledock');
}

const isMac = process.platform === 'darwin';
const SMOKE = !!process.env.HARNESS_SMOKE; // 无头自测模式（CI/沙箱用）
const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness';
const MANUAL_URL = 'https://github.com/sgd-shine/whaledock/blob/main/docs/%E6%93%8D%E4%BD%9C%E6%89%8B%E5%86%8C.md';
const BACKEND_RECOVERY_DELAYS_MS = [1000, 2000, 4000];
const BACKEND_RECOVERY_TIMEOUT_MS = 30 * 1000;
const UPDATE_START_DELAY_MS = 15 * 1000;
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EVENT_BATCH_DELAY_MS = 200;
const EVENT_LIVE_MAX_EVENTS = 10000;
const EVENT_LIVE_MAX_BYTES = 4 * 1024 * 1024;
const WORKSPACE_COORDINATOR_START_TOKEN = Symbol('workspace-coordinator-start');
const MAX_RENDER_TOKEN_VALUE = 1_000_000_000_000;
const MAX_RENDER_BUDGET_VALUE = 1_000_000_000;
const MAX_RENDER_PRICE_VALUE = 1_000_000;
const MAX_RENDER_COST_VALUE = 1_000_000_000_000;
const MAX_RENDER_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedFinite(value, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value : null;
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function safeTokenGroup(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    input: boundedInteger(source.input, MAX_RENDER_TOKEN_VALUE) || 0,
    cacheRead: boundedInteger(source.cacheRead, MAX_RENDER_TOKEN_VALUE) || 0,
    output: boundedInteger(source.output, MAX_RENDER_TOKEN_VALUE) || 0,
    total: boundedInteger(source.total, MAX_RENDER_TOKEN_VALUE) || 0
  };
}

function safeText(value, fallback, maximum = 120) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function boundedPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !value.includes('\0') ? value : null;
}

// 所有标题/菜单/设置都从 coordinator 的 committed view 重建，
// 事务中 config 曾经写入 target 也不会提前改变用户可见状态。
function workspaceSurfaceSnapshot(view, runtime = {}) {
  const source = isPlainObject(view) ? view : {};
  const current = isPlainObject(source.current) ? source.current : {};
  const label = safeText(current.label, '当前工作区', 96);
  const recent = (Array.isArray(source.recent) ? source.recent : [])
    .filter(isPlainObject)
    .slice(0, 10)
    .map((item, index) => ({
      path: boundedPath(item.path),
      label: safeText(item.label, `最近工作区 ${index + 1}`, 96)
    }))
    .filter((item) => item.path);
  return {
    generation: Number.isSafeInteger(runtime.generation) && runtime.generation >= 0
      ? runtime.generation : 0,
    busy: runtime.busy === true,
    current: {
      configuredPath: boundedPath(current.configuredPath),
      effectivePath: boundedPath(current.effectivePath),
      label,
      legacyHome: current.legacyHome === true
    },
    recent,
    title: `鲸坞 WhaleDock — ${label}`
  };
}

function hotkeyBindings(value) {
  const source = isPlainObject(value) ? value : {};
  const result = [];
  if (typeof source.hotkey === 'string' && source.hotkey.trim()) {
    result.push({ key: source.hotkey.trim(), kind: 'main' });
  }
  if (source.screenshotHotkeyEnabled === true
      && typeof source.screenshotHotkey === 'string' && source.screenshotHotkey.trim()) {
    result.push({ key: source.screenshotHotkey.trim(), kind: 'capture' });
  }
  if (result.length === 2 && result[0].key.toLowerCase() === result[1].key.toLowerCase()) {
    throw new Error('截图快捷键不能与主窗口快捷键相同');
  }
  return result;
}

// 先把两个新绑定当成一笔运行时事务。返回的 rollback 供 config
// 持久失败时调用；任一 register 失败时函数内部已恢复两个旧绑定。
function applyHotkeyBindings(previous, next, runtime) {
  if (!runtime || typeof runtime.register !== 'function' || typeof runtime.unregister !== 'function') {
    throw new Error('快捷键运行时不可用');
  }
  const before = hotkeyBindings(previous);
  const after = hotkeyBindings(next);
  const unregister = (items) => {
    for (const item of items) {
      try { runtime.unregister(item.key); } catch (_error) { /* 继续恢复其他绑定 */ }
    }
  };
  const register = (items) => {
    const registered = [];
    for (const item of items) {
      let ok = false;
      try { ok = runtime.register(item.key, item.kind) === true; } catch (_error) { ok = false; }
      if (!ok) {
        unregister(registered);
        throw new Error(`快捷键 ${item.key} 被占用`);
      }
      registered.push(item);
    }
  };
  const restoreBefore = () => {
    try {
      register(before);
    } catch (error) {
      throw new Error(`旧快捷键恢复失败：${error.message}`);
    }
  };

  unregister(before);
  try {
    register(after);
  } catch (error) {
    unregister(after);
    try { restoreBefore(); }
    catch (restoreError) {
      throw new Error(`${error.message}，且${restoreError.message}`);
    }
    throw new Error(`${error.message}，已恢复旧快捷键`);
  }

  let active = true;
  return {
    commit() { active = false; },
    rollback() {
      if (!active) return;
      unregister(after);
      restoreBefore();
      active = false;
    }
  };
}

function captureDeliveryRequest(value) {
  if (!isPlainObject(value)) throw new Error('图片交付请求必须是 plain object');
  const allowed = new Set(['captureId', 'action', 'targetToken']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('图片交付请求含未批准字段');
  if (typeof value.captureId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.captureId)) {
    throw new Error('captureId 无效');
  }
  if (!['send', 'copy', 'save-only'].includes(value.action)) throw new Error('图片交付动作无效');
  const targetToken = value.targetToken == null ? null : value.targetToken;
  if (targetToken !== null && (typeof targetToken !== 'string' || targetToken.length < 1
      || targetToken.length > 256 || /[\u0000-\u001f\u007f]/.test(targetToken))) {
    throw new Error('会话临时 token 无效');
  }
  if (value.action === 'send' && !targetToken) throw new Error('发送前必须选择会话');
  return { captureId: value.captureId, action: value.action, targetToken };
}

// Renderer 只得到匿名聚合；不透传 event service 未来可能增加的字段。
function dashboardSnapshot(snapshot, runtime = {}) {
  const source = isPlainObject(snapshot) ? snapshot : {};
  const externalService = isPlainObject(runtime) && runtime.externalService === true;
  const rawAvailability = isPlainObject(source.availability) ? source.availability : {};
  const availabilityMap = {
    live: 'available', probing: 'loading', backfilling: 'loading',
    disconnected: 'degraded', unavailable: 'unavailable'
  };
  const availabilityStatus = availabilityMap[rawAvailability.state] || 'unavailable';
  const availabilityLabels = {
    available: '事件能力可用', loading: '正在校验事件能力',
    degraded: '事件连接已断开，正在重连', unavailable: '事件能力不可用'
  };
  const rawCoverage = isPlainObject(source.coverage) ? source.coverage : {};
  const coverageStatus = ['complete', 'partial', 'gap', 'unavailable'].includes(rawCoverage.status)
    ? rawCoverage.status : 'unavailable';
  const coverageMessages = {
    complete: '覆盖完整：可显示已观测 token 与估算费用。',
    partial: '覆盖有限：仅统计已观测样本。',
    gap: '存在覆盖缺口：费用不显示伪精确总额。',
    unavailable: '尚无可用覆盖数据，主 Harness 体验不受影响。'
  };
  const today = isPlainObject(source.today) ? source.today : {};
  const week = isPlainObject(source.week) ? source.week : {};
  const todayTokens = safeTokenGroup(today.tokens);
  const weekTokens = safeTokenGroup(week.tokens);
  const todayOrigins = isPlainObject(today.origins) ? today.origins : {};
  const budget = isPlainObject(source.budget) ? source.budget : {};
  const pricing = isPlainObject(source.pricing) ? source.pricing : {};
  const complete = coverageStatus === 'complete';
  const taskKeyPattern = /^[A-Za-z0-9_-]{16,128}$/;
  const recentTasks = (Array.isArray(source.recentTasks) ? source.recentTasks : [])
    .filter(isPlainObject)
    .slice(0, 100)
    .map((task, index) => {
      const key = typeof task.taskKey === 'string' && taskKeyPattern.test(task.taskKey)
        ? task.taskKey : '';
      const tokens = safeTokenGroup(task.tokens);
      return {
        taskKey: key,
        ordinal: Number.isSafeInteger(task.ordinal) && task.ordinal > 0 ? task.ordinal : index + 1,
        label: safeText(task.label, `任务 ${String(index + 1).padStart(2, '0')}`, 32),
        result: ({
          completed: 'completed', error: 'failed', blocked: 'failed', 'max-tokens': 'failed',
          incomplete: 'failed', unknown: 'failed', cancelled: 'cancelled',
          aborted: 'cancelled', interrupted: 'cancelled'
        })[task.result] || 'failed',
        origin: task.origin === 'subagent' ? 'subagent' : 'user',
        completedAt: typeof task.completedAt === 'string' ? task.completedAt.slice(0, 64) : null,
        durationMs: boundedInteger(task.durationMs, MAX_RENDER_DURATION_MS),
        tokens: tokens.total,
        tokenDetails: tokens,
        estimatedCost: complete ? boundedFinite(task.estimatedCost, MAX_RENDER_COST_VALUE) : null
      };
    })
    .filter((task) => task.taskKey);
  return {
    availability: {
      status: availabilityStatus,
      label: externalService && availabilityStatus === 'available'
        ? '外部服务合约已探测（根包版本未证明）'
        : availabilityLabels[availabilityStatus]
    },
    coverage: {
      status: coverageStatus,
      message: coverageMessages[coverageStatus],
      sessions: boundedInteger(rawCoverage.sessions, 1_000_000) || 0,
      gapSessions: boundedInteger(rawCoverage.gapSessions, 1_000_000) || 0
    },
    disclaimer: safeText(source.disclaimer, 'dsh 已观测用量，非账单', 80),
    costAvailable: complete,
    today: {
      date: typeof today.date === 'string' ? today.date.slice(0, 16) : null,
      tokens: todayTokens.total,
      tokenDetails: todayTokens,
      topLevelTokens: boundedInteger(todayOrigins.user, MAX_RENDER_TOKEN_VALUE) || 0,
      subagentTokens: boundedInteger(todayOrigins.subagent, MAX_RENDER_TOKEN_VALUE) || 0,
      estimatedCost: complete ? boundedFinite(today.estimatedCost, MAX_RENDER_COST_VALUE) : null
    },
    week: {
      startDate: typeof week.startDate === 'string' ? week.startDate.slice(0, 16) : null,
      endDate: typeof week.endDate === 'string' ? week.endDate.slice(0, 16) : null,
      tokens: weekTokens.total,
      tokenDetails: weekTokens,
      estimatedCost: complete ? boundedFinite(week.estimatedCost, MAX_RENDER_COST_VALUE) : null
    },
    waiting: {
      approvals: Number.isSafeInteger(source.waiting && source.waiting.approvals)
        ? source.waiting.approvals : 0,
      questions: Number.isSafeInteger(source.waiting && source.waiting.questions)
        ? source.waiting.questions : 0
    },
    budget: {
      enabled: budget.enabled === true,
      used: boundedInteger(budget.observedTokens, MAX_RENDER_TOKEN_VALUE) || 0,
      limit: boundedInteger(budget.limitTokens, MAX_RENDER_BUDGET_VALUE),
      paused: budget.paused === true && !externalService,
      // 外部 attach 不冒充已停止，但仍要允许用户清除持久预算 latch，
      // 否则外部服务退出后，当天的托管后端会被永久挡住且 UI 无恢复入口。
      resumeAvailable: budget.paused === true,
      resumed: budget.resumed === true,
      enforcement: budget.paused === true
        ? (externalService ? 'external-warning' : 'managed-paused') : 'none'
    },
    pricing: {
      model: 'deepseek-v4-flash',
      inputPerMillion: boundedFinite(pricing.inputPerMillion, MAX_RENDER_PRICE_VALUE),
      cacheReadPerMillion: boundedFinite(pricing.cacheReadPerMillion, MAX_RENDER_PRICE_VALUE),
      outputPerMillion: boundedFinite(pricing.outputPerMillion, MAX_RENDER_PRICE_VALUE)
    },
    recentTasks
  };
}

function reportRequest(value) {
  if (!isPlainObject(value)) throw new Error('战报请求必须是 plain object');
  const allowedKeys = new Set(['taskKey', 'theme', 'action']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('战报请求含未批准字段');
  if (typeof value.taskKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.taskKey)) {
    throw new Error('战报 taskKey 无效');
  }
  if (!['dark', 'light'].includes(value.theme)) throw new Error('战报主题无效');
  if (!['copy', 'save'].includes(value.action)) throw new Error('战报动作无效');
  return { taskKey: value.taskKey, theme: value.theme, action: value.action };
}

function reportPayload(snapshot, request, appVersion) {
  const safeRequest = reportRequest(request);
  const source = isPlainObject(snapshot) ? snapshot : {};
  const task = (Array.isArray(source.recentTasks) ? source.recentTasks : [])
    .find((candidate) => isPlainObject(candidate) && candidate.taskKey === safeRequest.taskKey);
  if (!task) throw new Error('战报对应的匿名任务不存在');
  const coverage = isPlainObject(source.coverage) ? source.coverage.status : 'unavailable';
  const tokens = safeTokenGroup(task.tokens);
  const resultMap = {
    completed: 'completed', error: 'failed', blocked: 'failed', 'max-tokens': 'failed',
    incomplete: 'failed', unknown: 'failed', cancelled: 'cancelled',
    aborted: 'cancelled', interrupted: 'cancelled'
  };
  return {
    theme: safeRequest.theme,
    taskLabel: safeText(task.label, '匿名任务已经靠岸。', 86),
    result: resultMap[task.result] || 'failed',
    coverage: ['complete', 'partial', 'gap', 'unavailable'].includes(coverage) ? coverage : 'unavailable',
    durationMs: boundedInteger(task.durationMs, MAX_RENDER_DURATION_MS),
    totalTokens: tokens.total,
    inputTokens: tokens.input,
    cacheReadTokens: tokens.cacheRead,
    outputTokens: tokens.output,
    estimatedCost: coverage === 'complete'
      ? boundedFinite(task.estimatedCost, MAX_RENDER_COST_VALUE) : null,
    costAvailable: coverage === 'complete',
    priceModel: 'deepseek-v4-flash',
    completedAt: typeof task.completedAt === 'string' ? task.completedAt.slice(0, 64) : null,
    appVersion: `WhaleDock ${safeText(appVersion, '', 32)}`.trim()
  };
}

function trustedLocalEvent(event, win, expectedUrl) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  if (!event || event.sender !== win.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  return event.senderFrame.url === expectedUrl;
}

function createBoundedEventQueue(options = {}) {
  const maxEvents = Number.isSafeInteger(options.maxEvents) ? options.maxEvents : EVENT_LIVE_MAX_EVENTS;
  const maxBytes = Number.isSafeInteger(options.maxBytes) ? options.maxBytes : EVENT_LIVE_MAX_BYTES;
  if (maxEvents < 1 || maxBytes < 1) throw new Error('事件队列上限无效');
  let values = [];
  let bytes = 0;
  return {
    push(value) {
      const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
      if (values.length >= maxEvents || bytes + size > maxBytes) {
        const error = new Error('实时事件队列超过安全上限');
        error.code = 'ERR_EVENT_LIVE_BACKLOG';
        throw error;
      }
      values.push(value);
      bytes += size;
    },
    drain() {
      const result = values;
      values = [];
      bytes = 0;
      return result;
    },
    get length() { return values.length; },
    get bytes() { return bytes; }
  };
}

function createPersistedEventBatcher(options) {
  if (!isPlainObject(options) || !options.service || typeof options.service.ingestMany !== 'function') {
    throw new Error('事件批处理器缺少 service.ingestMany');
  }
  const delayMs = options.delayMs === undefined ? EVENT_BATCH_DELAY_MS : options.delayMs;
  if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 1000) throw new Error('批处理延迟无效');
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const onEffects = typeof options.onEffects === 'function' ? options.onEffects : async () => {};
  const onFailure = typeof options.onFailure === 'function' ? options.onFailure : async () => {};
  const queue = createBoundedEventQueue({
    maxEvents: options.maxEvents || EVENT_LIVE_MAX_EVENTS,
    maxBytes: options.maxBytes || EVENT_LIVE_MAX_BYTES
  });
  let timer = null;
  let serial = Promise.resolve();
  let closed = false;

  const schedule = () => {
    if (closed || timer || queue.length === 0) return;
    timer = setTimer(() => {
      timer = null;
      void flush().catch(() => { /* onFailure 已记录，定时器不制造 unhandledRejection */ });
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };

  const flush = () => {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    const batch = queue.drain();
    if (!batch.length) return serial;
    const work = serial.then(async () => {
      try {
        const result = await options.service.ingestMany(batch, { generation: options.generation });
        if (!Array.isArray(result)) throw new Error('事件服务返回了无效 effects');
        // ingestMany 返回时事件状态已原子持久，此前绝不执行 Electron 副作用。
        await onEffects(result);
        return result;
      } catch (error) {
        await onFailure(error);
        throw error;
      } finally {
        schedule();
      }
    });
    serial = work.catch(() => {});
    return work;
  };

  return {
    push(value) { if (closed) throw new Error('事件批处理器已关闭'); queue.push(value); schedule(); },
    flush,
    async close({ flush: shouldFlush = true } = {}) {
      closed = true;
      if (timer) { clearTimer(timer); timer = null; }
      if (shouldFlush && queue.length) await flush();
      else queue.drain();
      await serial;
    },
    get length() { return queue.length; }
  };
}

// live terminal 不走 200ms 普通批次：先排空前序事件，再确认 dsh history，
// 然后才让 event service 持久通知 ledger 并交付 effect。
async function ingestLiveEvent(monitor, event, dependencies = {}) {
  const isCurrent = typeof dependencies.isCurrent === 'function'
    ? dependencies.isCurrent : () => eventLayerCurrent(monitor);
  if (!isCurrent()) return false;
  if (!event || event.kind !== 'turn-terminal') {
    monitor.batcher.push(event);
    return true;
  }

  await monitor.batcher.flush();
  if (!isCurrent()) return false;
  const confirmTerminal = typeof dependencies.confirmTerminal === 'function'
    ? dependencies.confirmTerminal : (value) => terminalConfirmedInHistory(value, monitor, isCurrent);
  const confirmed = await confirmTerminal(event);
  if (!isCurrent()) return false;

  const service = dependencies.service || eventService;
  if (!service || typeof service.ingest !== 'function') throw new Error('事件服务缺少 ingest');
  const ingestOptions = {
    generation: monitor.serviceGeneration,
    ...(!confirmed ? { suppressNotifications: true } : {})
  };
  const effects = effectsArray(await service.ingest(event, ingestOptions), 'live terminal ingest');
  if (!isCurrent()) return false;
  if (confirmed) {
    const onEffects = typeof dependencies.onEffects === 'function'
      ? dependencies.onEffects : (value) => handleEventEffects(value, monitor);
    await onEffects(effects);
  }
  return confirmed;
}

function canStopForBudget(identity, current) {
  return Boolean(identity && current
    && identity.spawnedByUs === true && current.spawnedByUs === true
    && identity.state && identity.state === current.state
    && !identity.state.exited && current.backendReady === true
    && Number.isSafeInteger(identity.generation)
    && identity.generation === current.generation);
}

function backendStartAllowed(paused, explicitResume = false) {
  return paused !== true || explicitResume === true;
}

let mainWindow = null;
let splash = null;
let settingsWindow = null;
let dashboardWindow = null;
let noticeWindow = null;
// v0.5 桌面宠物与主题
let petWindow = null;
let petPayload = null;
let petState = 'idle';
let petTransient = null;
let petTransientTimer = null;
const themedPages = new Map();
const themedWindows = new Map();
let tray = null;
let backendState = null;
let spawnedByUs = false;
let quitting = false;
let startupPromise = null;
let startupGeneration = 0;
let recoveringBackend = false;
let backendRecoveryGeneration = 0;
let backendReady = false;
let initialStartMinimized = false;
let lastStatus = { phase: 'checking', text: '正在启动…', detail: '' };
let pendingAttachDecision = null;
let updateStartTimer = null;
let updateIntervalTimer = null;
let updateCheckPromise = null;
const pendingBackendStops = new Set();
const intentionalBackendStops = new Set();
const pendingWorkspaceOperations = new Set();
let workspacePostFinalizeEventActivation = false;
let workspaceCommittedRecoveryPending = false;
let workspaceRollbackBackendExpected = false;
let eventService = null;
let eventServiceError = null;
let eventMonitor = null;
let eventBackendGeneration = 0;
let eventReconnectAttempt = 0;
let attentionCount = 0;
let lastNoticePayload = null;
let eventShutdownPromise = null;
let eventShutdownComplete = false;
let workspaceCoordinator = null;
let workspaceJournal = null;
let captureWindow = null;
let captureFileUrl = null;
let captureState = null;
let capturePromptAdapter = null;
let captureChild = null;
let ocrChild = null;
let captureSerial = Promise.resolve();
let captureShutdownPromise = null;
let captureShutdownComplete = false;
let captureEpoch = 0;
let captureShuttingDown = false;

// ---------- 单实例 ----------
if (!MAIN_HELPER_TEST) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', () => showApp());
    app.whenReady().then(onReady).catch((e) => {
      log.line('app', 'fatal: ' + (e && e.stack || e));
      if (SMOKE) { console.log('SMOKE_FAIL: ' + e); app.exit(1); }
    });
  }
}

// 从旧名 "Harness Desktop" 迁移配置（v0.1.1 改名鲸坞 WhaleDock，见 DECISIONS D10）
function migrateLegacyConfig() {
  const ud = app.getPath('userData');
  const legacyCfg = path.join(path.dirname(ud), 'Harness Desktop', 'config.json');
  const newCfg = path.join(ud, 'config.json');
  if (!fs.existsSync(newCfg) && fs.existsSync(legacyCfg)) {
    try {
      fs.mkdirSync(ud, { recursive: true });
      fs.copyFileSync(legacyCfg, newCfg);
    } catch (cause) {
      const error = new Error('旧版配置存在但迁移失败，未把该用户当成全新安装');
      error.code = 'CONFIG_MIGRATION_FAILED';
      error.cause = cause;
      throw error;
    }
  }
}

async function initializeWorkspaceConfig() {
  migrateLegacyConfig();
  const userData = app.getPath('userData');
  let freshWorkspaceError = null;
  try {
    return config.init(userData, {
      // factory 只在 config 真实 ENOENT 时调用；旧 null/缺字段不创建新目录。
      freshDefaults: () => {
        try {
          return {
            workdir: workspaces.ensureDefaultWorkspace(app.getPath('documents'), {
              forbiddenRoots: forbiddenWorkspaceRoots()
            }).canonicalPath
          };
        } catch (error) {
          freshWorkspaceError = error;
          throw error;
        }
      }
    });
  } catch (error) {
    if (!freshWorkspaceError || error !== freshWorkspaceError) throw error;
  }

  const choice = await dialog.showMessageBox({
    type: 'error',
    message: '无法创建鲸坞默认工作区',
    detail: '鲸坞不会回落到整个主目录启动。请选择一个其他文件夹，或退出后检查目录权限。',
    buttons: ['选择其他文件夹', '退出'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (choice.response !== 0) {
    const error = new Error('用户取消了全新工作区选择');
    error.code = 'ERR_WORKSPACE_BOOTSTRAP_CANCELLED';
    throw error;
  }
  const selected = await dialog.showOpenDialog({
    title: '选择鲸坞默认工作区',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selected.canceled || !selected.filePaths[0]) {
    const error = new Error('未选择可用工作区，未启动后端');
    error.code = 'ERR_WORKSPACE_BOOTSTRAP_CANCELLED';
    throw error;
  }
  const canonical = workspaces.canonicalWorkspace(selected.filePaths[0], {
    forbiddenRoots: forbiddenWorkspaceRoots()
  });
  return config.init(userData, { freshDefaults: { workdir: canonical.path } });
}

function forbiddenWorkspaceRoots() {
  return config.protectedWorkspaceRoots({
    homeDir: os.homedir(),
    platform: process.platform
  });
}

function currentWorkspaceSurface() {
  const committed = workspaceCoordinator
    ? workspaceCoordinator.snapshot()
    : {
        workdir: config.get('workdir'),
        recentWorkdirs: config.get('recentWorkdirs') || [],
        generation: 0
      };
  const view = workspaces.workspaceMenuView({
    workdir: committed.workdir,
    recentWorkdirs: committed.recentWorkdirs,
    homeDir: os.homedir(),
    platform: process.platform
  });
  return workspaceSurfaceSnapshot(view, {
    generation: committed.generation,
    busy: Boolean(workspaceCoordinator && workspaceCoordinator.busy)
  });
}

function workspaceWindowTitle() {
  try { return currentWorkspaceSurface().title; }
  catch (_error) { return '鲸坞 WhaleDock'; }
}

function refreshWorkspaceSurfaces() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(workspaceWindowTitle());
  if (app && typeof app.isReady === 'function' && app.isReady()) createAppMenu();
  refreshTrayMenu();
}

function workspaceJournalBlocksStartup(journal = workspaceJournal) {
  if (!journal || typeof journal.read !== 'function') return true;
  try {
    return journal.read() !== null;
  } catch (_error) {
    // 不可读、坏 JSON 或未来 schema 都必须保持 fail-closed；只有
    // coordinator 的 recover/startAndConfirm 私有 token 能继续取证。
    return true;
  }
}

async function startWorkspaceBackend({ workdir, rollback = false, recovery = false }) {
  backendReady = false;
  await waitForPendingBackendStops();
  const port = config.get('port');
  if (quitting) throw Object.assign(new Error('App 正在退出，未启动工作区后端'), {
    code: 'ERR_WORKSPACE_QUITTING'
  });
  if (await backend.isPortOpen(port)) {
    const error = new Error('目标启动前端口已被占用，未 attach 也未提交工作区');
    error.code = 'ERR_WORKSPACE_TARGET_PORT_OCCUPIED';
    throw error;
  }
  const started = startManagedBackend({
    workspaceJournalToken: WORKSPACE_COORDINATOR_START_TOKEN
  });
  try {
    const ready = await backend.waitForPort(port, {
      timeoutMs: 5 * 60 * 1000,
      shouldAbort: () => quitting || started.exited || backendState !== started
    });
    if (!ready || quitting || started.exited || backendState !== started || spawnedByUs !== true) {
      const error = new Error('切换后端未在目标工作区保持就绪');
      error.code = 'ERR_WORKSPACE_BACKEND_NOT_READY';
      error.state = started;
      throw error;
    }
    if (backendState !== started || spawnedByUs !== true || started.exited) {
      const error = new Error('工作区后端所有权在 cwd 取证前已变化');
      error.code = 'ERR_WORKSPACE_TARGET_OWNERSHIP';
      error.state = started;
      throw error;
    }
    const proof = await backend.proveManagedWorkdir({ port, state: started });
    if (!proof || proof.proven !== true || typeof proof.cwd !== 'string'
        || proof.cwd.length < 1 || proof.cwd.length > 4096 || proof.cwd.includes('\0')) {
      const error = new Error('无法证明目标后端的实际工作目录');
      error.code = 'ERR_WORKSPACE_TARGET_CWD';
      error.state = started;
      throw error;
    }
    const forbiddenRoots = forbiddenWorkspaceRoots();
    const actual = workspaces.canonicalWorkspace(proof.cwd, { forbiddenRoots });
    const expected = workspaces.canonicalWorkspace(workdir || os.homedir(), { forbiddenRoots });
    if (actual.key !== expected.key || backendState !== started
        || spawnedByUs !== true || started.exited || quitting) {
      const error = new Error('目标后端实际 cwd 与待提交工作区不一致');
      error.code = 'ERR_WORKSPACE_TARGET_CWD';
      error.state = started;
      throw error;
    }
    backendReady = true;
    if (rollback || recovery) workspaceRollbackBackendExpected = true;
    return { state: started, effectiveWorkdir: actual.path };
  } catch (error) {
    backendReady = false;
    try {
      await stopOwnedBackend(started, { reason: '工作区目标启动失败清理' });
    } catch (stopError) {
      if (!stopError.state) stopError.state = started;
      stopError.startError = error;
      throw stopError;
    }
    if (!error.state) error.state = started;
    throw error;
  }
}

async function launchCommittedWorkspaceEventLayer(reason, options = {}) {
  const state = backendState;
  if (quitting || !backendReady || !spawnedByUs || !state || state.exited) {
    if (!quitting && options.expectedManaged === true) {
      workspaceCommittedRecoveryPending = true;
    }
    log.line('workspace', `${reason}后无可证明的托管后端，未启动事件层`);
    return false;
  }
  const identity = { state, spawnedByUs: true };
  workspacePostFinalizeEventActivation = true;
  try {
    const established = await launchEventLayer(identity);
    if (!identityStillCurrent(identity)) {
      // journal 已 finalize/remove，coordinator 不会再回滚这一代；等事务
      // promise 退出 pending 集合后再走普通恢复，避免 busy 分支吞掉退出。
      workspaceCommittedRecoveryPending = true;
      log.line('workspace', `${reason}后端在事件层启动期间退出，事务结束后恢复`);
      return false;
    }
    if (!established) {
      log.line('events', `${reason}已完成，但事件层未建立；主 Harness 继续可用`);
    }
    return established;
  } finally {
    workspacePostFinalizeEventActivation = false;
  }
}

function maybeRecoverCommittedWorkspaceBackend() {
  if (!workspaceCommittedRecoveryPending || pendingWorkspaceOperations.size > 0) return;
  workspaceCommittedRecoveryPending = false;
  if (quitting || backendReady || backendState || startupPromise || recoveringBackend) return;
  void recoverBackendInBackground();
}

function initializeWorkspaceCoordinator() {
  workspaceJournal = workspaces.createWorkspaceJournalStore({
    filePath: path.join(app.getPath('userData'), 'workspace-switch.json')
  });
  workspaceCoordinator = workspaces.createWorkspaceSwitchCoordinator({
    platform: process.platform,
    homeDir: os.homedir(),
    canonicalize: (value) => workspaces.canonicalWorkspace(value, {
      forbiddenRoots: forbiddenWorkspaceRoots()
    }),
    getConfig: () => ({
      workdir: config.get('workdir'),
      recentWorkdirs: config.get('recentWorkdirs') || []
    }),
    setWorkspaceConfig: async (patch) => { config.set(patch); },
    getRuntime: () => ({ backendReady, spawnedByUs, state: backendState }),
    isBudgetPaused: () => budgetIsPaused(),
    journal: workspaceJournal,
    invalidateCaptures: async () => { await cancelCurrentCapture('工作区正在切换'); },
    quiesceEvents: async () => {
      workspaceRollbackBackendExpected = false;
      cancelBackendRecovery('切换工作区');
      cancelForegroundStartup('切换工作区');
      // 先在当前 generation 仍有效时落盘尾批，让 budget-crossed
      // 持久 latch 与托管停机 effect 都完成；随后再失效 transport。
      const monitor = eventMonitor;
      if (monitor && monitor.batcher) await monitor.batcher.flush();
      await stopEventLayer('切换工作区', { disconnect: true, flushBatch: true });
    },
    stopManaged: async (state) => {
      await stopEventLayer('工作区事务停止托管后端', {
        disconnect: true,
        flushBatch: true
      });
      await stopOwnedBackend(state, { reason: '工作区事务停止托管后端' });
    },
    startAndConfirm: (options) => startWorkspaceBackend(options),
    recoveryPortClear: async () => !(await backend.isPortOpen(config.get('port'))),
    onCommit: async () => {
      refreshWorkspaceSurfaces();
      await launchCommittedWorkspaceEventLayer('工作区提交', { expectedManaged: true });
    },
    onRollback: async () => {
      refreshWorkspaceSurfaces();
      const expectedManaged = workspaceRollbackBackendExpected;
      workspaceRollbackBackendExpected = false;
      await launchCommittedWorkspaceEventLayer('工作区回滚', { expectedManaged });
    }
  });
}

function trackWorkspaceOperation(value) {
  const pending = Promise.resolve(value);
  pendingWorkspaceOperations.add(pending);
  const remove = () => {
    pendingWorkspaceOperations.delete(pending);
    maybeRecoverCommittedWorkspaceBackend();
  };
  void pending.then(remove, remove);
  return pending;
}

async function recoverWorkspaceAtStartup() {
  if (!workspaceCoordinator) throw new Error('工作区协调器尚未初始化');
  workspaceRollbackBackendExpected = false;
  try {
    const result = await trackWorkspaceOperation(workspaceCoordinator.recoverAtStartup());
    if (result.status !== 'none') log.line('workspace', `启动恢复完成：${result.status}`);
    return result;
  } catch (error) {
    if (error && error.code === 'ERR_WORKSPACE_JOURNAL_INVALID' && workspaceJournal) {
      try { workspaceJournal.quarantineInvalid(); } catch (_quarantineError) { /* 保留原件仍 fail-closed */ }
    }
    log.line('workspace', `工作区 journal 恢复失败：${error && error.code || 'unknown'}`);
    throw error;
  }
}

async function switchWorkspace(target) {
  if (!workspaceCoordinator) throw new Error('工作区协调器不可用');
  if (quitting) throw new Error('App 正在退出，未开始新的工作区切换');
  try {
    const result = await trackWorkspaceOperation(workspaceCoordinator.switchTo(target));
    if (mainWindow && !mainWindow.isDestroyed() && backendReady) {
      mainWindow.destroy();
      mainWindow = null;
      openMainWindow();
    }
    return result;
  } finally {
    // coordinator 的 commit/rollback callback 仍处于 busy 队列内；
    // promise 落定后再刷新一次，避免失败后菜单永久停在“正在切换”。
    refreshWorkspaceSurfaces();
  }
}

async function chooseAndSwitchWorkspace(parentWindow) {
  const options = {
    title: '选择并切换工作区',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
  return switchWorkspace(result.filePaths[0]);
}

function baseUrl() {
  return `http://127.0.0.1:${config.get('port')}`;
}

function sendSplash(channel, payload) {
  if (splash && !splash.isDestroyed()) splash.webContents.send(channel, payload);
}

function status(phase, text, detail) {
  lastStatus = { phase, text, detail: detail || '' };
  log.line('app', `${phase}: ${text}${detail ? ' — ' + detail : ''}`);
  if ((phase === 'error' || phase === 'warning')
      && (!splash || splash.isDestroyed()) && app.isReady()) {
    createSplash();
  }
  sendSplash('status', lastStatus);
  if (phase === 'error' && SMOKE) {
    console.log('SMOKE_FAIL: ' + text);
    app.exit(1);
  }
}

// ---------- v0.3 事件服务与连续性编排 ----------
function eventConfigSnapshot(value = config.get()) {
  const current = value;
  return {
    taskNotifications: current.taskNotifications,
    budgetEnabled: current.budgetEnabled,
    dailyTokenBudget: current.dailyTokenBudget,
    priceInputPerMillion: current.priceInputPerMillion,
    priceCacheReadPerMillion: current.priceCacheReadPerMillion,
    priceOutputPerMillion: current.priceOutputPerMillion,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

function initEventService() {
  try {
    eventService = events.createEventService({
      stateFile: path.join(app.getPath('userData'), 'events-state.json'),
      config: eventConfigSnapshot(),
      onChanged: () => pushDashboardState()
    });
    eventServiceError = null;
  } catch (error) {
    eventService = null;
    eventServiceError = error && error.code === 'ERR_EVENT_STATE_SCHEMA'
      ? 'state-version' : 'state-unavailable';
    log.line('events', `事件状态服务不可用：${eventServiceError}`);
  }
}

function canonicalEventSnapshot() {
  if (!eventService) return null;
  try { return eventService.snapshot(); } catch (_error) { return null; }
}

function currentDashboardSnapshot() {
  const snapshot = canonicalEventSnapshot();
  if (snapshot) return dashboardSnapshot(snapshot, {
    externalService: backendReady && !spawnedByUs && backendState === null
  });
  return dashboardSnapshot({
    availability: { state: 'unavailable', detail: eventServiceError },
    coverage: { status: 'unavailable', sessions: 0, gapSessions: 0 },
    recentTasks: []
  });
}

function pushDashboardState() {
  // 宠物与看板共用同一个事件层快照，这里统一刷新，避免两套状态来源。
  pushPetState();
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  dashboardWindow.webContents.send('dashboard:state', currentDashboardSnapshot());
}

// ---------- v0.5 皮肤主题 ----------
// 主题只作用于鲸坞自有窗口：主进程把 token 注入各页面已有的 CSS 变量，
// 不改页面源码，也绝不注入 dsh 的 Web UI。
const THEME_VARIABLE_MAP = Object.freeze({
  'settings.html': (c) => ({
    '--bg': c.background, '--surface': c.surface, '--surface-raised': c.surface,
    '--field': c.background, '--line': c.border, '--line-strong': c.border,
    '--text': c.text, '--muted': c.textMuted, '--faint': c.textMuted,
    '--accent': c.accent, '--accent-strong': c.primary
  }),
  'dashboard.html': (c) => ({
    '--bg': c.background, '--panel': c.surface, '--panel-strong': c.surface,
    '--line': c.border, '--text': c.text, '--muted': c.textMuted,
    '--cyan': c.accent, '--indigo': c.primary
  }),
  'splash.html': (c) => ({
    '--bg': c.background, '--panel': c.surface, '--text': c.text,
    '--dim': c.textMuted, '--accent': c.primary, '--accent2': c.accent
  }),
  'capture.html': (c) => ({
    '--bg': c.background, '--panel': c.surface, '--line': c.border,
    '--text': c.text, '--muted': c.textMuted, '--cyan': c.accent
  }),
  'report-card.html': (c) => ({
    '--bg': c.background, '--glow': c.surface, '--text': c.text,
    '--muted': c.textMuted, '--subtle': c.textMuted,
    '--cyan': c.accent, '--indigo': c.primary
  })
});

function themeRoots() {
  const roots = [{ dir: path.join(__dirname, 'assets', 'themes'), source: 'builtin' }];
  try { roots.push({ dir: path.join(app.getPath('userData'), 'themes'), source: 'user' }); }
  catch (_error) { /* userData 不可用时只用内置主题 */ }
  return roots;
}

function listAvailableThemes() {
  try { return themes.listThemes({ roots: themeRoots() }); }
  catch (error) {
    log.line('app', `主题扫描失败：${error && error.message || 'unknown'}`);
    return { themes: [], skipped: [] };
  }
}

function currentTheme() {
  const listed = listAvailableThemes();
  if (listed.skipped.length) {
    log.line('app', `跳过 ${listed.skipped.length} 个主题文件：${listed.skipped
      .map((item) => `${item.id}(${item.reason})`).join('、').slice(0, 300)}`);
  }
  return themes.selectTheme(listed.themes, config.get().theme);
}

function themeCssFor(page, theme) {
  const build = THEME_VARIABLE_MAP[page];
  if (!build) return null;
  const declarations = Object.entries(build(theme.colors))
    .map(([name, value]) => `${name}:${value};`).join('');
  return `:root{color-scheme:${theme.base};${declarations}}`;
}

async function applyThemeToWindow(win, page, theme) {
  if (!win || win.isDestroyed()) return;
  const css = themeCssFor(page, theme || currentTheme());
  if (!css) return;
  const key = `whaledock-theme:${page}`;
  try {
    const previous = themedWindows.get(win);
    if (previous) await win.webContents.removeInsertedCSS(previous).catch(() => {});
    const handle = await win.webContents.insertCSS(css);
    themedWindows.set(win, handle);
    win.webContents.once('destroyed', () => themedWindows.delete(win));
  } catch (error) {
    log.line('app', `${key} 注入失败：${error && error.message || 'unknown'}`);
  }
}

function refreshAllThemes() {
  const theme = currentTheme();
  for (const [win, page] of themedPages.entries()) {
    if (!win || win.isDestroyed()) { themedPages.delete(win); continue; }
    void applyThemeToWindow(win, page, theme);
  }
  if (petWindow && !petWindow.isDestroyed()) {
    try { petWindow.setBackgroundColor('#00000000'); } catch (_error) { /* 透明窗保持透明 */ }
  }
  return theme;
}

// 页面注册：窗口创建时登记自己是哪个页面，加载完成后自动套用当前主题。
function registerThemedWindow(win, page) {
  if (!win || win.isDestroyed() || !THEME_VARIABLE_MAP[page]) return;
  themedPages.set(win, page);
  win.webContents.on('did-finish-load', () => { void applyThemeToWindow(win, page); });
  win.on('closed', () => { themedPages.delete(win); themedWindows.delete(win); });
}

// ---------- v0.5 桌面宠物 ----------
// 宠物包是纯静态资源：主进程解析 manifest/PNG，绝不执行包内任何内容，
// 并且只把 data: URL 下发给宠物窗，渲染层拿不到任何本地路径。
const PET_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;

function petRoots() {
  const roots = [{ dir: path.join(__dirname, 'assets', 'pets'), source: 'builtin' }];
  try { roots.push({ dir: path.join(app.getPath('userData'), 'pets'), source: 'user' }); }
  catch (_error) { /* userData 不可用时只用内置宠物 */ }
  return roots;
}

function listAvailablePets() {
  try { return pets.listPetPackages({ roots: petRoots() }); }
  catch (error) {
    log.line('app', `宠物包扫描失败：${error && error.message || 'unknown'}`);
    return { packages: [], skipped: [] };
  }
}

// 把选中的宠物包读成 data: URL；超出总上限的帧被丢弃并记日志，不静默截断。
function buildPetPayload(petPackage) {
  if (!petPackage) return null;
  const states = {};
  let total = 0;
  let dropped = 0;
  for (const state of pets.PET_STATES) {
    const frames = petPackage.states[state];
    if (!Array.isArray(frames) || !frames.length) continue;
    const encoded = [];
    for (const file of frames) {
      let bytes;
      try { bytes = fs.readFileSync(file); } catch (_error) { dropped += 1; continue; }
      if (total + bytes.length > PET_PAYLOAD_MAX_BYTES) { dropped += 1; continue; }
      total += bytes.length;
      encoded.push(`data:image/png;base64,${bytes.toString('base64')}`);
    }
    if (encoded.length) states[state] = encoded;
  }
  if (!states.idle) return null;
  if (dropped) {
    log.line('app', `宠物包 ${petPackage.id} 有 ${dropped} 帧因读取失败或超出总上限被丢弃`);
  }
  return {
    id: petPackage.id,
    name: petPackage.name,
    frameRate: petPackage.frameRate,
    width: petPackage.width,
    height: petPackage.height,
    anchor: petPackage.anchor,
    states
  };
}

function loadSelectedPet() {
  const listed = listAvailablePets();
  if (listed.skipped.length) {
    log.line('app', `跳过 ${listed.skipped.length} 个宠物包：${listed.skipped
      .map((item) => `${item.id}(${item.reason})`).join('、').slice(0, 300)}`);
  }
  const selected = pets.selectPetPackage(listed.packages, config.get().petPackageId);
  petPayload = buildPetPayload(selected);
  if (selected && !petPayload) log.line('app', `宠物包 ${selected.id} 没有可用帧，已跳过`);
  return petPayload;
}

function petWindowBounds(payload) {
  const width = Math.min(512, Math.max(48, (payload && payload.width) || 128));
  const height = Math.min(512, Math.max(48, (payload && payload.height) || 128));
  const anchor = (payload && payload.anchor) || 'bottom-right';
  let area = { x: 0, y: 0, width: 1280, height: 800 };
  try { area = electron.screen.getPrimaryDisplay().workArea; } catch (_error) { /* 用默认值 */ }
  const margin = 24;
  const right = area.x + area.width - width - margin;
  const bottom = area.y + area.height - height - margin;
  const left = area.x + margin;
  const top = area.y + margin;
  const position = {
    'bottom-right': { x: right, y: bottom },
    'bottom-left': { x: left, y: bottom },
    'top-right': { x: right, y: top },
    'top-left': { x: left, y: top }
  }[anchor] || { x: right, y: bottom };
  return { ...position, width, height };
}

function currentPetState() {
  return events.derivePetState({
    snapshot: canonicalEventSnapshot(),
    transient: petTransient,
    now: Date.now()
  });
}

function pushPetState() {
  const next = currentPetState();
  if (next === petState && petWindow && !petWindow.isDestroyed()) return;
  petState = next;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:state', { state: petState });
  }
}

// 终态 effect 只在宠物开启时翻译成一次性庆祝/出错表现。
function notePetTerminal(result) {
  if (!config.get().petEnabled) return;
  const transient = events.petTransientFor(result, Date.now());
  if (!transient) return;
  petTransient = transient;
  pushPetState();
  if (petTransientTimer) clearTimeout(petTransientTimer);
  petTransientTimer = setTimeout(() => {
    petTransient = null;
    petTransientTimer = null;
    pushPetState();
  }, Math.max(0, transient.until - Date.now()) + 20);
  if (petTransientTimer.unref) petTransientTimer.unref();
}

function applyPetWindowFlags(win) {
  if (!win || win.isDestroyed()) return;
  const current = config.get();
  try { win.setAlwaysOnTop(current.petAlwaysOnTop === true, 'floating'); }
  catch (_error) { /* 系统拒绝置顶时保持普通层级 */ }
  try { win.setIgnoreMouseEvents(current.petClickThrough === true, { forward: true }); }
  catch (_error) { /* 不支持穿透时保持可交互 */ }
}

function closePetWindow() {
  if (petTransientTimer) { clearTimeout(petTransientTimer); petTransientTimer = null; }
  petTransient = null;
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  petWindow = null;
}

function openPetWindow() {
  if (!loadSelectedPet()) {
    log.line('app', '没有可用宠物包，宠物窗未打开');
    return null;
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:package', petPayload);
    applyPetWindowFlags(petWindow);
    pushPetState();
    petWindow.showInactive();
    return petWindow;
  }
  const expectedUrl = pathToFileURL(path.join(__dirname, 'pet.html')).href;
  const win = new BrowserWindow({
    ...petWindowBounds(petPayload),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: '鲸坞宠物',
    webPreferences: {
      preload: path.join(__dirname, 'preload-pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  petWindow = win;
  secureLocalWindow(win, expectedUrl);
  applyPetWindowFlags(win);
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('pet:package', petPayload);
    win.webContents.send('pet:state', { state: currentPetState() });
  });
  win.on('closed', () => { if (petWindow === win) petWindow = null; });
  log.line('app', `桌面宠物已开启：${petPayload.id}（${Object.keys(petPayload.states).join('/')}）`);
  void win.loadFile('pet.html');
  return win;
}

// 开关、换包、置顶/穿透变更都走这一个入口，避免多处各自开窗。
function syncPetWindow() {
  const current = config.get();
  if (!current.petEnabled) { closePetWindow(); return; }
  if (petWindow && !petWindow.isDestroyed()) {
    const previousId = petPayload && petPayload.id;
    loadSelectedPet();
    if (!petPayload) { closePetWindow(); return; }
    if (petPayload.id !== previousId) {
      const bounds = petWindowBounds(petPayload);
      try { petWindow.setBounds(bounds); } catch (_error) { /* 保持原位置 */ }
    }
    petWindow.webContents.send('pet:package', petPayload);
    applyPetWindowFlags(petWindow);
    pushPetState();
    return;
  }
  openPetWindow();
}

function petContextMenuTemplate() {
  const current = config.get();
  const listed = listAvailablePets();
  const items = listed.packages.slice(0, 30).map((item) => ({
    label: item.name + (item.author ? ` · ${item.author}` : ''),
    type: 'radio',
    checked: item.id === current.petPackageId,
    click: () => { void applyPetSettings({ petPackageId: item.id }); }
  }));
  return [
    { label: '换一只宠物', enabled: false },
    ...(items.length ? items : [{ label: '没有可用宠物包', enabled: false }]),
    { type: 'separator' },
    {
      label: '总在最前',
      type: 'checkbox',
      checked: current.petAlwaysOnTop === true,
      click: () => { void applyPetSettings({ petAlwaysOnTop: !current.petAlwaysOnTop }); }
    },
    {
      label: '鼠标穿透',
      type: 'checkbox',
      checked: current.petClickThrough === true,
      click: () => { void applyPetSettings({ petClickThrough: !current.petClickThrough }); }
    },
    { type: 'separator' },
    { label: '打开宠物文件夹', click: () => { void openUserResourceDir('pets'); } },
    { label: '关闭宠物', click: () => { void applyPetSettings({ petEnabled: false }); } }
  ];
}

// 宠物相关设置的唯一写入路径：先持久 config，再同步窗口，失败如实记录。
async function applyPetSettings(patch) {
  try {
    config.set(config.validateSettingsPatch(patch));
  } catch (error) {
    log.line('app', `宠物设置写入失败：${error && error.message || 'unknown'}`);
    return false;
  }
  syncPetWindow();
  refreshTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:runtime', settingsRuntime());
  }
  return true;
}

// 只允许打开鲸坞自己在 userData 下的受控目录，不接受渲染层传入的任意路径。
async function openUserResourceDir(kind) {
  if (kind !== 'pets' && kind !== 'themes') return false;
  let dir;
  try { dir = path.join(app.getPath('userData'), kind); } catch (_error) { return false; }
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_error) { /* 已存在即可 */ }
  try { await shell.openPath(dir); return true; } catch (error) {
    log.line('app', `打开 ${kind} 目录失败：${error && error.message || 'unknown'}`);
    return false;
  }
}

function budgetIsPaused() {
  const snapshot = canonicalEventSnapshot();
  return Boolean(snapshot && snapshot.budget && snapshot.budget.paused === true);
}

function eventLayerCurrent(monitor) {
  return Boolean(monitor && !monitor.closed && eventMonitor === monitor
    && monitor.generation === eventBackendGeneration && !quitting);
}

async function setEventAvailability(monitor, state, detail = null) {
  if (!eventService || !eventLayerCurrent(monitor)) return false;
  try {
    await eventService.setAvailability(state, detail, monitor.serviceGeneration);
    return true;
  } catch (error) {
    log.line('events', `更新可用性被拒绝：${error && error.code || 'unknown'}`);
    return false;
  }
}

function effectsArray(value, operation) {
  if (!Array.isArray(value)) throw new Error(`${operation} 未返回 effects 数组`);
  return value;
}

function identityStillCurrent(identity) {
  if (!identity || !backendReady) return false;
  if (identity.spawnedByUs) {
    return spawnedByUs && identity.state && backendState === identity.state && !identity.state.exited;
  }
  return !spawnedByUs && backendState === null;
}

function retryableEventError(error) {
  return Boolean(error && ['ERR_DSH_EVENTS_TRANSPORT', 'ERR_DSH_EVENTS_TIMEOUT'].includes(error.code));
}

async function closeEventTransport(monitor, options = {}) {
  if (!monitor || monitor.transportClosed) return;
  monitor.transportClosed = true;
  if (monitor.reconnectTimer) clearTimeout(monitor.reconnectTimer);
  monitor.reconnectTimer = null;
  if (monitor.subscription) {
    try { monitor.subscription.close(); } catch (_error) { /* 关闭是尽力而为 */ }
  }
  if (monitor.batcher) {
    try { await monitor.batcher.close({ flush: options.flushBatch === true }); }
    catch (_error) { /* 关闭失败不允许旧代继续副作用 */ }
  }
  if (monitor.adapter) {
    try { await monitor.adapter.close(); } catch (_error) { /* 关闭不影响主窗口 */ }
  }
}

async function stopEventLayer(reason, options = {}) {
  const monitor = eventMonitor;
  if (!monitor) return;
  eventMonitor = null;
  eventBackendGeneration += 1;
  monitor.closed = true;
  if (monitor.reconnectTimer) clearTimeout(monitor.reconnectTimer);
  monitor.reconnectTimer = null;
  if (reason) log.line('events', `停止事件层：${safeText(reason, '未知原因', 80)}`);
  await closeEventTransport(monitor, { flushBatch: options.flushBatch === true });
  if (options.disconnect !== false && eventService) {
    try {
      effectsArray(await eventService.disconnect(monitor.serviceGeneration), 'disconnect');
    } catch (error) {
      if (error && error.code !== 'ERR_EVENT_GENERATION') {
        log.line('events', `事件层断开落盘失败：${error && error.code || 'unknown'}`);
      }
    }
  }
}

function beginEventShutdown() {
  if (eventShutdownPromise) return eventShutdownPromise;
  eventShutdownPromise = (async () => {
    await stopEventLayer('App 正在退出', { disconnect: true, flushBatch: true });
    if (eventService) await eventService.close();
  })();
  void eventShutdownPromise.then(
    () => { eventShutdownComplete = true; },
    () => { eventShutdownComplete = true; }
  );
  return eventShutdownPromise;
}

async function backfillSession(monitor, row) {
  const cursor = eventService.getCursor(row.sessionRef);
  const firstBaseline = cursor.notificationFloorSeq === null;
  const floor = cursor.notificationFloorSeq === null
    ? (monitor.notificationFloors.has(row.sessionRef)
      ? monitor.notificationFloors.get(row.sessionRef) : row.lastSeq)
    : undefined;
  const registrationEffects = effectsArray(await eventService.registerSession(row.sessionRef, {
    origin: row.origin,
    ...(row.parentRef ? { parentRef: row.parentRef } : {}),
    ...(floor !== undefined ? { notificationFloorSeq: floor } : {})
  }), 'registerSession');
  await handleEventEffects(registrationEffects, monitor);
  if (!eventLayerCurrent(monitor) || row.lastSeq < 0 || row.lastSeq <= cursor.lastContiguousSeq) {
    return false;
  }

  const targetSeq = cursor.lastContiguousSeq + 1;
  const collected = [];
  let beforeSeq;
  let covered = false;
  let pageCount = 0;
  while (eventLayerCurrent(monitor) && pageCount < 1000 && monitor.historyPages < 1000) {
    const page = await monitor.adapter.readHistory(row.sessionRef, {
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: 1
    });
    pageCount += 1;
    monitor.historyPages += 1;
    if (!page || !Array.isArray(page.events)) throw new Error('history 适配器返回异常');
    if (collected.length + page.events.length > 50000) break;
    collected.push(...page.events);
    if (page.minSeq !== null && page.minSeq <= targetSeq) {
      covered = true;
      break;
    }
    if (!page.hasMore) break;
    if (!Number.isSafeInteger(page.nextBeforeSeq)) throw new Error('history 缺少可推进游标');
    beforeSeq = page.nextBeforeSeq;
  }
  collected.sort((left, right) => (left.seq || 0) - (right.seq || 0));
  // 首次基线只导入订阅 floor 之前的旧事件；其后的 live 事件留给
  // ingestLiveEvent 按 history→ledger→effect 顺序处理，避免被历史 suppress 误杀。
  const eligible = firstBaseline
    ? collected.filter((event) => Number.isSafeInteger(event.seq) && event.seq <= floor)
    : collected;
  if (firstBaseline && !covered) {
    // 超长旧会话可能在 50k 安全上限内取不到 seq=0。以实际读到的
    // 最早尾部事件前一位建立一次性基线，既不伪造完整覆盖，也避免把
    // 数万条合法尾部误当 gap 塞爆内存；availability 仍返回 history-gap。
    const initialContiguousSeq = eligible.length ? eligible[0].seq - 1 : floor;
    const baselineEffects = effectsArray(await eventService.registerSession(row.sessionRef, {
      initialContiguousSeq
    }), 'registerSession initial baseline');
    await handleEventEffects(baselineEffects, monitor);
  }
  if (eligible.length) {
    const effects = effectsArray(await eventService.ingestMany(eligible, {
      ...(firstBaseline ? { suppressNotifications: true } : {}),
      generation: monitor.serviceGeneration
    }), 'history ingestMany');
    await handleEventEffects(effects, monitor);
  }
  return !covered;
}

async function bootstrapEventLayer(monitor) {
  // 先打开 WS 并有界缓冲，再读 list/history，避免两者之间永久丢事件。
  monitor.subscription = monitor.adapter.subscribe({
    onEvent: async (event) => {
      if (!eventLayerCurrent(monitor)) return;
      if (event && event.kind === 'subscribed' && typeof event.sessionRef === 'string'
          && Number.isSafeInteger(event.lastSeq)) {
        monitor.notificationFloors.set(event.sessionRef, event.lastSeq);
      }
      if (monitor.backfilling) monitor.liveQueue.push(event);
      else await ingestLiveEvent(monitor, event);
    },
    onStatus: (value) => {
      if (!eventLayerCurrent(monitor) || !value || typeof value.kind !== 'string') return;
      if (['remote-error', 'unknown-method'].includes(value.kind)) {
        log.line('events', `事件传输状态：${value.kind}`);
      }
    }
  });
  void monitor.subscription.closed.then(
    () => handleEventTransportClosed(monitor, null),
    (error) => handleEventTransportClosed(monitor, error)
  );
  await monitor.subscription.opened;
  if (!eventLayerCurrent(monitor)) return;
  await monitor.adapter.describe();
  if (!eventLayerCurrent(monitor)) return;
  await setEventAvailability(monitor, 'backfilling', null);
  const sessions = await monitor.adapter.listSessions();
  if (!Array.isArray(sessions)) throw new Error('session list 适配器返回异常');
  let hadGap = false;
  for (const row of sessions) {
    if (!eventLayerCurrent(monitor)) return;
    if (await backfillSession(monitor, row)) hadGap = true;
  }
  if (!eventLayerCurrent(monitor)) return;

  // 历史已先落盘；此时把 WS 重叠区交给 200ms 串行批处理，由 reducer 去重。
  while (monitor.liveQueue.length && eventLayerCurrent(monitor)) {
    for (const event of monitor.liveQueue.drain()) {
      if (!eventLayerCurrent(monitor)) return;
      await ingestLiveEvent(monitor, event);
    }
  }
  monitor.backfilling = false;
  await setEventAvailability(monitor, 'live', hadGap ? 'history-gap' : 'ready');
  eventReconnectAttempt = 0;
  log.line('events', `事件层已就绪：${sessions.length} 个会话${hadGap ? '，存在历史缺口' : ''}`);
}

async function activateEventLayerForBackend(identity, options = {}) {
  await stopEventLayer('切换后端连接代', { disconnect: true });
  if (!eventService || quitting || !backendReady) return;
  const generation = ++eventBackendGeneration;
  const serviceGeneration = await eventService.beginConnection(generation);
  if (generation !== eventBackendGeneration || quitting || !backendReady) {
    try { await eventService.disconnect(serviceGeneration); } catch (_error) { /* 新代已接管 */ }
    return;
  }
  const monitor = {
    generation,
    serviceGeneration,
    identity: {
      generation,
      state: identity && identity.state || null,
      spawnedByUs: Boolean(identity && identity.spawnedByUs)
    },
    adapter: null,
    subscription: null,
    batcher: null,
    liveQueue: createBoundedEventQueue(),
    notificationFloors: new Map(),
    historyPages: 0,
    backfilling: true,
    established: false,
    closed: false,
    transportClosed: false,
    disconnectScheduled: false,
    reconnectTimer: null,
    retryAttempt: Number.isSafeInteger(options.retryAttempt) ? options.retryAttempt : 0
  };
  eventMonitor = monitor;

  if (monitor.identity.spawnedByUs
      && (!monitor.identity.state
        || monitor.identity.state.version !== config.DSH_CONTRACT.packageVersion)) {
    await setEventAvailability(monitor, 'unavailable', 'contract-mismatch');
    log.line('events', '托管后端根包版本无法证明为锁定版，事件层 fail-closed');
    monitor.closed = true;
    return;
  }

  try {
    monitor.adapter = backend.createDshEventsAdapter({
      port: config.get('port'),
      expectedHostVersion: config.DSH_CONTRACT.hostVersion,
      sessionSalt: eventService.getSalt()
    });
    monitor.batcher = createPersistedEventBatcher({
      service: eventService,
      generation: monitor.serviceGeneration,
      delayMs: EVENT_BATCH_DELAY_MS,
      onEffects: (effects) => handleEventEffects(effects, monitor),
      onFailure: async (error) => {
        if (!eventLayerCurrent(monitor)) return;
        await setEventAvailability(monitor, 'unavailable', 'consumer-error');
        log.line('events', `事件批落盘失败：${error && error.code || 'unknown'}`);
      }
    });
    await bootstrapEventLayer(monitor);
    monitor.established = eventLayerCurrent(monitor);
  } catch (error) {
    if (!eventLayerCurrent(monitor)) return;
    if (retryableEventError(error)) {
      await handleEventTransportClosed(monitor, error);
    } else {
      await setEventAvailability(monitor, 'unavailable',
        error && error.code === 'ERR_DSH_EVENTS_CONTRACT' ? 'contract-mismatch' : 'consumer-error');
      log.line('events', `事件合约探测停止：${error && error.code || 'unknown'}`);
      monitor.closed = true;
      await closeEventTransport(monitor);
    }
  }
}

async function launchEventLayer(identity, options = {}) {
  try {
    await activateEventLayerForBackend(identity, options);
    return Boolean(eventMonitor && eventMonitor.established
      && eventLayerCurrent(eventMonitor) && identityStillCurrent(identity));
  } catch (error) {
    log.line('events', `事件层启动异常，主 Harness 继续可用：${error && error.code || 'unknown'}`);
    return false;
  }
}

async function handleEventTransportClosed(monitor, error) {
  if (!eventLayerCurrent(monitor) || monitor.disconnectScheduled) return;
  monitor.disconnectScheduled = true;
  if (error && !retryableEventError(error)) {
    await setEventAvailability(monitor, 'unavailable',
      error.code === 'ERR_DSH_EVENTS_CONTRACT' ? 'contract-mismatch' : 'consumer-error');
    monitor.closed = true;
    await closeEventTransport(monitor);
    log.line('events', `事件连接 fail-closed：${error.code || 'unknown'}`);
    return;
  }
  try {
    effectsArray(await eventService.disconnect(monitor.serviceGeneration), 'disconnect');
  } catch (disconnectError) {
    if (!disconnectError || disconnectError.code !== 'ERR_EVENT_GENERATION') {
      log.line('events', `断线状态落盘失败：${disconnectError && disconnectError.code || 'unknown'}`);
    }
  }
  await closeEventTransport(monitor);
  if (!eventLayerCurrent(monitor)) return;
  const retryAttempt = Math.min(monitor.retryAttempt + 1, 10);
  const delayMs = Math.min(30000, 1000 * (2 ** Math.min(retryAttempt - 1, 5)));
  eventReconnectAttempt = retryAttempt;
  log.line('events', `事件连接断开，${delayMs}ms 后重连：${error && error.code || 'closed'}`);
  monitor.reconnectTimer = setTimeout(() => {
    monitor.reconnectTimer = null;
    if (!eventLayerCurrent(monitor) || !identityStillCurrent(monitor.identity)
        || (monitor.identity.spawnedByUs && budgetIsPaused())) return;
    launchEventLayer({
      state: monitor.identity.state,
      spawnedByUs: monitor.identity.spawnedByUs
    }, { retryAttempt });
  }, delayMs);
  if (typeof monitor.reconnectTimer.unref === 'function') monitor.reconnectTimer.unref();
}

function refreshAttentionSurface() {
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(attentionCount > 0
      ? `鲸坞 WhaleDock · ${attentionCount} 个任务待查看`
      : `鲸坞 WhaleDock · 今日 ${currentDashboardSnapshot().today.tokens.toLocaleString('zh-CN')} tokens`);
    refreshTrayMenu();
  }
  if (isMac && app.dock) {
    try { app.dock.setBadge(attentionCount > 0 ? String(Math.min(attentionCount, 99)) : ''); }
    catch (_error) { /* Dock 降级不影响事件落盘 */ }
  }
}

function clearTaskAttention() {
  attentionCount = 0;
  lastNoticePayload = null;
  refreshAttentionSurface();
  if (noticeWindow && !noticeWindow.isDestroyed()) noticeWindow.hide();
}

function markTaskAttention(payload) {
  attentionCount = Math.min(99, attentionCount + 1);
  lastNoticePayload = payload;
  refreshAttentionSurface();
}

function showNotificationFallback(payload) {
  if (isMac && app.dock) {
    try { app.dock.bounce('informational'); } catch (_error) { /* 继续托盘/banner */ }
  }
  showNoticeWindow(payload);
}

function deliverTaskNotification(payload) {
  markTaskAttention(payload);
  const title = safeText(payload && payload.title, '鲸坞 WhaleDock', 48);
  const body = safeText(payload && payload.detail, '有一个任务状态已更新。', 100);
  let supported = false;
  try { supported = Notification.isSupported(); } catch (_error) { supported = false; }
  if (!supported) {
    showNotificationFallback(payload);
    return;
  }
  try {
    const notice = new Notification({ title, body });
    let failed = false;
    notice.on('click', () => showApp());
    notice.on('failed', () => {
      if (failed) return;
      failed = true;
      showNotificationFallback(payload);
    });
    notice.show();
  } catch (_error) {
    showNotificationFallback(payload);
  }
}

function terminalNoticePayload(effect) {
  const result = effect && effect.result;
  // aborted/interrupted 在本版没有中性 banner 视觉；选择不发，不误标为红色失败。
  if (result === 'cancelled' || result === 'interrupted') return null;
  const copies = {
    completed: { kind: 'completed', title: '一个任务已完成', detail: '鲸坞已记录该任务的匿名摘要。' },
    error: { kind: 'failed', title: '一个任务未完成', detail: '任务返回错误，请打开鲸坞查看当前状态。' },
    blocked: { kind: 'failed', title: '一个任务已阻塞', detail: '该终态不等同于等待人工输入。' },
    'max-tokens': { kind: 'failed', title: '任务已达输出上限', detail: '任务可能未完整，请打开鲸坞查看。' },
    interrupted: { kind: 'failed', title: '一个任务已中断', detail: '鲸坞已记录该终态。' }
  };
  return { ...(copies[result] || copies.error), anonymousLabel: '匿名任务' };
}

async function terminalConfirmedInHistory(effect, monitor, currentCheck = () => eventLayerCurrent(monitor)) {
  if (!effect || typeof effect.sessionRef !== 'string' || !effect.sessionRef
      || !Number.isSafeInteger(effect.seq) || effect.seq < 0) return false;
  await new Promise((resolve) => {
    setTimeout(resolve, 350);
  });
  if (!currentCheck() || !monitor.adapter) return false;
  try {
    const page = await monitor.adapter.readHistory(effect.sessionRef, { maxMessages: 1 });
    if (!currentCheck()) return false;
    return Boolean(page && Array.isArray(page.events) && page.events.some((event) => (
      event && event.kind === 'turn-terminal' && event.sessionRef === effect.sessionRef
        && event.seq === effect.seq
    )));
  } catch (error) {
    log.line('events', `终态 history tail 确认失败：${error && error.code || 'unknown'}`);
    return false;
  }
}

function invalidateMonitorFromPersistedEffect(monitor) {
  if (!eventLayerCurrent(monitor)) return;
  eventMonitor = null;
  eventBackendGeneration += 1;
  monitor.closed = true;
  if (monitor.reconnectTimer) clearTimeout(monitor.reconnectTimer);
  monitor.reconnectTimer = null;
  if (monitor.subscription) {
    try { monitor.subscription.close(); } catch (_error) { /* ignore */ }
  }
  if (monitor.adapter) void monitor.adapter.close().catch(() => {});
  // 当前 effect 位于 batcher 自己的 serial 中；异步关闭避免等待自身。
  setTimeout(() => {
    if (monitor.batcher) void monitor.batcher.close({ flush: false }).catch(() => {});
  }, 0);
}

async function applyBudgetCrossed(effect, monitor) {
  if (!eventLayerCurrent(monitor)) return;
  const current = {
    generation: eventBackendGeneration,
    state: backendState,
    spawnedByUs,
    backendReady
  };
  if (!canStopForBudget(monitor && monitor.identity, current)) {
    deliverTaskNotification({
      kind: 'waiting',
      title: '已达到日预算',
      detail: '当前服务不是鲸坞本次拉起，未自动停止。',
      anonymousLabel: '每日软预算'
    });
    return;
  }

  // budget latch 已在 ingestMany 返回前持久。再取消恢复、失效连接代和移交进程所有权。
  cancelBackendRecovery('今日预算已暂停');
  cancelForegroundStartup('今日预算已暂停');
  const ownedState = backendState;
  backendReady = false;
  invalidateMonitorFromPersistedEffect(monitor);
  await stopOwnedBackend(ownedState, { reason: '日预算暂停托管后端' });
  log.line('events', `日预算已暂停托管后端：${effect.observedTokens}/${effect.limitTokens} tokens`);
  deliverTaskNotification({
    kind: 'waiting',
    title: '已达到日预算',
    detail: '鲸坞已停止本次自己拉起的后端。可在看板确认今日继续。',
    anonymousLabel: '每日软预算'
  });
}

async function handleEventEffects(value, monitor) {
  if (!eventLayerCurrent(monitor)) return;
  const effects = effectsArray(value, 'event effects');
  for (const effect of effects) {
    if (!eventLayerCurrent(monitor)) return;
    if (!isPlainObject(effect) || typeof effect.type !== 'string') {
      throw new Error('事件服务产生了无效 effect');
    }
    if (effect.type === 'task-terminal') {
      const payload = terminalNoticePayload(effect);
      if (payload && eventLayerCurrent(monitor)) deliverTaskNotification(payload);
      notePetTerminal(effect.result);
    } else if (effect.type === 'waiting-human') {
      deliverTaskNotification({
        kind: 'waiting',
        title: '有任务等待你确认',
        detail: effect.requestKind === 'question'
          ? '有一个问题等待你回答。' : '有一个操作等待你批准。',
        anonymousLabel: '匿名任务'
      });
    } else if (effect.type === 'budget-crossed') {
      if (!eventLayerCurrent(monitor)) return;
      await applyBudgetCrossed(effect, monitor);
    }
  }
}

// ---------- 启动 ----------
async function onReady() {
  backend.setRuntimeInfo({
    execPath: process.execPath,
    resourcesPath: process.resourcesPath
  });
  await initializeWorkspaceConfig();
  log.init(path.join(app.getPath('userData'), 'logs'));
  initEventService();
  initializeWorkspaceCoordinator();
  log.line('app', `鲸坞 WhaleDock v${app.getVersion()} 启动 (${process.platform}/${process.arch})`);
  initialStartMinimized = config.get('startMinimized') && !SMOKE;

  if (SMOKE) setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 90 * 1000);

  ipcMain.on('splash-action', onSplashAction);
  registerSettingsIpc();
  registerEventIpc();
  registerCaptureIpc();
  registerPetIpc();
  try { await imageInput.cleanupOwnedStaging({ stagingRoot: captureStagingRoot() }); }
  catch (error) { log.line('capture', `启动清理 staging 失败：${error && error.code || 'unknown'}`); }
  await recoverWorkspaceAtStartup();
  reconcileLoginItem();
  if (!initialStartMinimized) createSplash();
  else log.line('app', '启动最小化已启用：后台启动期间不创建启动页或主窗口');
  createTray();
  createAppMenu();
  registerHotkeys();
  configureUpdateSchedule();
  // 宠物默认关闭；只有用户显式开启过才在启动时开窗。
  if (config.get().petEnabled && !SMOKE) syncPetWindow();
  await ensureBackendAndShow(!initialStartMinimized);
}

function registerPetIpc() {
  const expectedUrl = pathToFileURL(path.join(__dirname, 'pet.html')).href;
  const trusted = (handler) => async (event, ...args) => {
    if (!trustedLocalEvent(event, petWindow, expectedUrl)) {
      throw new Error('拒绝非宠物窗主帧的 IPC 请求');
    }
    return handler(...args);
  };
  for (const channel of ['pet:ready', 'pet:context-menu']) ipcMain.removeHandler(channel);
  ipcMain.handle('pet:ready', trusted(async () => ({
    package: petPayload,
    state: currentPetState()
  })));
  ipcMain.handle('pet:context-menu', trusted(async () => {
    const menu = Menu.buildFromTemplate(petContextMenuTemplate());
    if (petWindow && !petWindow.isDestroyed()) menu.popup({ window: petWindow });
    return { ok: true };
  }));
}

function startManagedBackend(options = {}) {
  if (options.workspaceJournalToken !== WORKSPACE_COORDINATOR_START_TOKEN
      && workspaceJournalBlocksStartup()) {
    const error = new Error('工作区 journal 尚未闭环，拒绝普通路径启动后端');
    error.code = 'ERR_WORKSPACE_JOURNAL_ACTIVE';
    throw error;
  }
  if (!backendStartAllowed(budgetIsPaused())) {
    const error = new Error('今日预算暂停中，拒绝自动拉起后端');
    error.code = 'BUDGET_PAUSED';
    throw error;
  }
  if (backendState && spawnedByUs && backendState.exited !== true) {
    const error = new Error('已有未确认退出的鲸坞托管后端，拒绝重复拉起');
    error.code = 'ERR_BACKEND_STOP_UNCONFIRMED';
    error.state = backendState;
    throw error;
  }
  let state = null;
  state = backend.start(config.get(), {
    onLine: (line) => { log.line('dsh', line); sendSplash('log', line); },
    onExit: (code) => onBackendExit(state, code)
  });
  backendState = state;
  spawnedByUs = true;
  log.line('app', `实际后端命令: ${state.label}；版本: ${state.version}`);
  return state;
}

function stopOwnedBackend(state, options = {}) {
  const reason = safeText(options.reason, '停止托管后端', 100);
  const pending = (async () => {
    if (!state || typeof state !== 'object') {
      const error = new Error(`${reason}：缺少可证明的托管进程`);
      error.code = 'ERR_BACKEND_STOP_OWNERSHIP';
      throw error;
    }
    backendReady = false;
    if (state.exited !== true && (backendState !== state || spawnedByUs !== true)) {
      const error = new Error(`${reason}：托管进程所有权已变化，拒绝停止未知进程`);
      error.code = 'ERR_BACKEND_STOP_OWNERSHIP';
      error.state = state;
      throw error;
    }
    let stopError = null;
    if (state.exited !== true) {
      intentionalBackendStops.add(state);
      try { await backend.stop(state); } catch (error) { stopError = error; }
    }
    if (state.exited !== true) {
      const error = new Error(`${reason}：无法确认托管进程已经退出`);
      error.code = 'ERR_BACKEND_STOP_UNCONFIRMED';
      error.state = state;
      if (stopError) error.cause = stopError;
      // 保留 backendState/spawnedByUs；所有启动入口都会看到仍存活的
      // owned identity，禁止在未确认退出时再拉起第二个后端。
      throw error;
    }
    intentionalBackendStops.delete(state);
    if (backendState === state) {
      backendState = null;
      spawnedByUs = false;
    }
    if (stopError) {
      log.line('app', `${reason}时 stop 返回异常，但已确认进程退出：${stopError.code || 'unknown'}`);
    }
    return true;
  })();
  pendingBackendStops.add(pending);
  const remove = () => pendingBackendStops.delete(pending);
  void pending.then(remove, remove);
  return pending;
}

async function waitForPendingBackendStops() {
  const pending = [...pendingBackendStops];
  if (!pending.length) return;
  log.line('app', '等待旧后端进程清理完成后再继续');
  await Promise.allSettled(pending);
}

function ensureBackendAndShow(showWindow = true) {
  if (startupPromise) return startupPromise;
  const generation = ++startupGeneration;
  const run = ensureBackendAndShowOnce(generation, showWindow);
  startupPromise = run;
  const clear = () => {
    if (startupPromise === run) startupPromise = null;
  };
  void run.then(clear, clear);
  return run;
}

function startupIsCurrent(generation) {
  return !quitting && generation === startupGeneration;
}

function cancelForegroundStartup(reason) {
  if (startupPromise && reason) log.line('app', `取消前台启动：${reason}`);
  startupGeneration += 1;
  if (pendingAttachDecision) {
    pendingAttachDecision.resolve(null);
    pendingAttachDecision = null;
  }
}

async function ensureBackendAndShowOnce(generation, showWindow) {
  try {
    backendReady = false;
    if (workspaceJournalBlocksStartup()) {
      status('error', '工作区切换尚未安全收口', '请重新启动鲸坞，让 journal 恢复流程先完成');
      return;
    }
    const port = config.get('port');
    status('checking', '正在检查本地 Harness 服务…');

    // 正在 TERM→KILL 清理的旧进程可能仍短暂占端口，先等清理完再判断归属。
    await waitForPendingBackendStops();
    if (!startupIsCurrent(generation)) return;

    // 已有服务在跑（比如你在终端里自己启动了）→ 直接接入，不重复启动
    const portOpen = await backend.isPortOpen(port);
    if (!startupIsCurrent(generation)) return;
    if (portOpen) {
      const ownProcessAlive = !!(backendState && !backendState.exited);
      spawnedByUs = ownProcessAlive;
      if (!ownProcessAlive) backendState = null;
      const probe = await backend.probeHarness(port);
      if (!startupIsCurrent(generation)) return;
      if (probe.status === 'mismatch') {
        // 启动最小化时也必须给用户一个可见的决策界面，不能静默等待。
        createSplash();
        status('warning', `端口 ${port} 上有服务但不像 Harness，可能是其他程序占用`,
          '你可以仍然接入，或打开设置修改端口');
        const decision = await new Promise((resolve) => {
          pendingAttachDecision = { generation, resolve };
        });
        if (pendingAttachDecision && pendingAttachDecision.generation === generation) {
          pendingAttachDecision = null;
        }
        if (!startupIsCurrent(generation) || decision !== 'attach') return;
        showWindow = true;
      } else if (probe.status === 'unknown') {
        log.line('app', `attach 弱特征判定失败，按原逻辑接入：${probe.reason || '未知原因'}`);
      }
      status('attach', `检测到端口 ${port} 已有服务，直接接入`);
      backendReady = true;
      launchEventLayer({ state: backendState, spawnedByUs });
      if (showWindow) return openMainWindow();
      closeSplash();
      log.line('app', '服务已就绪，保持最小化到托盘');
      return;
    }

    if (!backendStartAllowed(budgetIsPaused())) {
      status('warning', '已达到今日预算，鲸坞未自动启动后端',
        '请打开任务看板，明确确认“今日继续运行”');
      return;
    }

    if (!config.get('autoStartBackend')) {
      status('error', '未检测到运行中的 Harness 服务',
        '配置里关闭了自动启动。请先在终端运行 dsh web，再点「重试」');
      return;
    }

    const cmd = backend.resolveCommand(config.get());
    if (!cmd) {
      status('error', '找不到 Node.js / dsh',
        '请先安装 Node.js（nodejs.org 下载 LTS 版），装完后点「重试」');
      return;
    }

    // 重试前仍有自己拉起的旧进程时，必须先完整停掉，避免双开和退出漏清理。
    if (backendState && !backendState.exited) {
      const staleState = backendState;
      log.line('app', '检测到旧后端仍存活，停止后再重试');
      await stopOwnedBackend(staleState, { reason: '前台启动重试清理旧后端' });
      if (!startupIsCurrent(generation)) return;
    }

    await waitForPendingBackendStops();
    if (!startupIsCurrent(generation)) return;

    status('spawning', '正在启动 Harness 引擎…', cmd.label);
    const startedState = startManagedBackend();

    status('waiting', '等待服务就绪…', '首次启动会自动下载组件，可能需要几分钟');
    const ok = await backend.waitForPort(port, {
      timeoutMs: 5 * 60 * 1000,
      shouldAbort: () => !startupIsCurrent(generation) || startedState.exited,
      onTick: (elapsed) => {
        if (elapsed > 20000) {
          sendSplash('status', {
            phase: 'waiting',
            text: '仍在启动中…',
            detail: `已等待 ${Math.round(elapsed / 1000)} 秒（首次运行要下载组件，取决于网速）`
          });
        }
      }
    });
    if (!startupIsCurrent(generation)) return;

    const readyAndOwned = ok && !startedState.exited && backendState === startedState;
    if (!readyAndOwned) {
      if (startedState.exited || backendState !== startedState) {
        status('error', 'Harness 启动失败（进程未保持运行）',
          '点「复制日志」，把内容发给 AI 或提 issue 排查');
      } else if (startupIsCurrent(generation)) {
        status('error', '等待服务超时', '网络较慢或端口配置不对，可以点「重试」');
      }
      return;
    }

    backendReady = true;
    launchEventLayer({ state: startedState, spawnedByUs: true });
    if (showWindow) {
      status('ready', '服务已就绪，正在打开窗口…');
      openMainWindow();
    } else {
      status('ready', '服务已就绪，保持最小化到托盘');
      closeSplash();
    }
  } catch (e) {
    log.line('app', 'ensureBackend error: ' + (e && e.stack || e));
    if (startupIsCurrent(generation)) status('error', '启动出错', String(e && e.message || e));
  }
}

function recoveryIsCurrent(generation) {
  return !quitting && generation === backendRecoveryGeneration;
}

function cancelBackendRecovery(reason) {
  if (recoveringBackend && reason) log.line('app', `取消后台恢复：${reason}`);
  backendRecoveryGeneration += 1;
  recoveringBackend = false;
}

function reloadMainWindowAfterRecovery() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  void win.loadURL(baseUrl()).catch((e) => {
    log.line('app', '后台恢复后重载界面失败: ' + (e && e.message || e));
  });
}

function showBackendRecoveryFailureFallback(reason) {
  log.line('app', `系统通知不可用，改用错误对话框提醒：${reason}`);
  if (quitting) return;
  dialog.showErrorBox(
    '鲸坞后端自动重启失败',
    '后台已连续 3 次尝试恢复 Harness 服务但均失败。请打开鲸坞并通过「后端 → 打开日志文件夹」查看日志。'
  );
}

function notifyBackendRecoveryFailed() {
  const title = '鲸坞 WhaleDock';
  const body = 'Harness 后端连续 3 次自动重启失败，请打开鲸坞查看日志。';
  if (!Notification.isSupported()) {
    showBackendRecoveryFailureFallback('当前系统不支持 Electron Notification');
    return;
  }
  try {
    const notice = new Notification({ title, body });
    notice.on('click', () => showApp());
    notice.on('failed', (_event, error) => {
      showBackendRecoveryFailureFallback(String(error && error.message || error || '发送失败'));
    });
    notice.show();
    log.line('app', '已请求系统发送后端恢复失败通知');
  } catch (e) {
    showBackendRecoveryFailureFallback(String(e && e.message || e));
  }
}

async function recoverBackendInBackground() {
  if (recoveringBackend || quitting) return;
  if (workspaceJournalBlocksStartup()) {
    log.line('workspace', '活动 journal 尚未闭环，拒绝后台恢复或 attach');
    return;
  }
  recoveringBackend = true;
  const generation = ++backendRecoveryGeneration;
  const total = BACKEND_RECOVERY_DELAYS_MS.length;

  try {
    for (let index = 0; index < total; index += 1) {
      const attempt = index + 1;
      const delayMs = BACKEND_RECOVERY_DELAYS_MS[index];
      log.line('app', `后台恢复：第 ${attempt}/${total} 次将在 ${delayMs}ms 后执行`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!recoveryIsCurrent(generation)) return;

      await waitForPendingBackendStops();
      if (!recoveryIsCurrent(generation)) return;
      if (startupPromise) {
        log.line('app', '后台恢复：检测到前台启动流程，交由前台处理');
        return;
      }

      log.line('app', `后台恢复：开始第 ${attempt}/${total} 次尝试`);
      const portOpen = await backend.isPortOpen(config.get('port'));
      if (!recoveryIsCurrent(generation)) return;
      if (portOpen) {
        const ownProcessAlive = !!(backendState && !backendState.exited);
        spawnedByUs = ownProcessAlive;
        if (!ownProcessAlive) backendState = null;
        recoveringBackend = false;
        backendReady = true;
        launchEventLayer({ state: backendState, spawnedByUs });
        log.line('app', `后台恢复：第 ${attempt}/${total} 次成功，端口已有服务`);
        reloadMainWindowAfterRecovery();
        return;
      }

      if (!backendStartAllowed(budgetIsPaused())) {
        log.line('app', '后台恢复：今日预算暂停中，不自动拉起后端');
        return;
      }

      if (!config.get('autoStartBackend')) {
        log.line('app', `后台恢复：第 ${attempt}/${total} 次失败，配置已关闭自动启动`);
        continue;
      }

      const cmd = backend.resolveCommand(config.get());
      if (!cmd) {
        log.line('app', `后台恢复：第 ${attempt}/${total} 次失败，找不到 dsh / npx`);
        continue;
      }

      let attemptState = null;
      try {
        log.line('app', `后台恢复：第 ${attempt}/${total} 次启动 ${cmd.label}`);
        attemptState = startManagedBackend();
        const ready = await backend.waitForPort(config.get('port'), {
          timeoutMs: BACKEND_RECOVERY_TIMEOUT_MS,
          shouldAbort: () => !recoveryIsCurrent(generation) || attemptState.exited
        });
        if (!recoveryIsCurrent(generation)) return;
        const readyAndOwned = ready && !attemptState.exited && backendState === attemptState;
        if (readyAndOwned) {
          recoveringBackend = false;
          backendReady = true;
          launchEventLayer({ state: attemptState, spawnedByUs: true });
          log.line('app', `后台恢复：第 ${attempt}/${total} 次成功`);
          reloadMainWindowAfterRecovery();
          return;
        }
        const reason = ready
          ? '端口短暂就绪，但进程已退出或失去所有权'
          : (attemptState.exited ? '进程已退出' : '等待端口超时');
        log.line('app', `后台恢复：第 ${attempt}/${total} 次失败，${reason}`);
      } catch (e) {
        log.line('app', `后台恢复：第 ${attempt}/${total} 次异常：${e && e.stack || e}`);
      }

      if (attemptState) {
        await stopOwnedBackend(attemptState, { reason: `后台恢复第 ${attempt}/${total} 次清理` });
        if (!recoveryIsCurrent(generation)) return;
      }
    }

    if (!recoveryIsCurrent(generation)) return;
    recoveringBackend = false;
    log.line('app', '后台恢复：3 次尝试全部失败');
    notifyBackendRecoveryFailed();
  } catch (e) {
    if (!recoveryIsCurrent(generation)) return;
    recoveringBackend = false;
    log.line('app', '后台恢复异常: ' + (e && e.stack || e));
    notifyBackendRecoveryFailed();
  } finally {
    if (generation === backendRecoveryGeneration) recoveringBackend = false;
  }
}

function onBackendExit(state, code) {
  log.line('app', `dsh 进程退出 code=${code}`);
  const intentionallyStopped = intentionalBackendStops.delete(state);
  if (state !== backendState) {
    log.line('app', '忽略已失去所有权的旧后端退出事件');
    return;
  }
  const wasSpawnedByUs = spawnedByUs;
  backendState = null;
  spawnedByUs = false;
  backendReady = false;
  void stopEventLayer('后端进程已退出', { disconnect: true }).catch((error) => {
    log.line('events', `后端退出时关闭事件层失败：${error && error.code || 'unknown'}`);
  });
  if (intentionallyStopped) {
    log.line('app', '托管后端按鲸坞请求确认退出，不触发异常恢复');
    return;
  }
  if (quitting || !wasSpawnedByUs) return;
  if (workspaceCoordinator && workspaceCoordinator.busy) {
    if (workspacePostFinalizeEventActivation) {
      // onCommit/onRollback 只会在 journal finalize/remove 后运行；这时
      // 已没有可回滚事务，待 pending promise 移除后再走普通恢复。
      workspaceCommittedRecoveryPending = true;
      log.line('workspace', '工作区已提交后端退出，事务结束后恢复');
    } else {
      // 目标后端在 journal 提交前退出时，由该事务唯一地回滚
      // config/backend/journal，禁止另一条自动恢复链并发启动。
      log.line('workspace', '工作区事务中后端退出，交由 coordinator 回滚');
    }
    return;
  }
  if (startupPromise) {
    log.line('app', '后端在前台启动流程中退出，交由启动页处理');
    return;
  }
  if (recoveringBackend) {
    log.line('app', '后端在后台恢复尝试中退出，当前尝试继续处理');
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: '鲸坞后端进程退出了',
      detail: '可以试试重启后端；若反复出现，请通过菜单「后端 → 打开日志文件夹」查看日志。',
      buttons: ['重启后端', '忽略']
    }).then(({ response }) => {
      if (response === 0) void restartBackend();
    }).catch((e) => {
      log.line('app', '显示后端退出提示失败: ' + (e && e.message || e));
    });
  } else {
    void recoverBackendInBackground();
  }
}

// ---------- 窗口 ----------
function createSplash() {
  if (splash && !splash.isDestroyed()) return splash;
  splash = new BrowserWindow({
    width: 520,
    height: 440,
    frame: false,
    resizable: false,
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  registerThemedWindow(splash, 'splash.html');
  void splash.loadFile('splash.html');
  splash.webContents.once('did-finish-load', () => {
    sendSplash('status', lastStatus);
    for (const line of String(log.recent() || '').split('\n').slice(-40)) {
      if (line) sendSplash('log', line);
    }
  });
  splash.on('closed', () => {
    splash = null;
    // 主窗口还没出来就关掉启动页 = 用户想退出
    if (!mainWindow && !settingsWindow && !dashboardWindow && !quitting) {
      quitting = true;
      app.quit();
    }
  });
  return splash;
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) {
    const s = splash;
    splash = null;
    s.destroy();
  }
}

function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    closeSplash();
    return;
  }
  const b = config.get('bounds') || {};
  const win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 820,
    x: b.x,
    y: b.y,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: workspaceWindowTitle(),
    backgroundColor: '#0b0f19',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  mainWindow = win;

  let attempts = 0;
  let retryTimer = null;
  const tryLoad = () => {
    if (quitting || win.isDestroyed()) return;
    retryTimer = null;
    void win.loadURL(baseUrl()).catch(() => { /* did-fail-load 里处理 */ });
  };
  // 统一统计初次加载、后台恢复重载与用户手动刷新，避免直接 loadURL 时出现“第 0 次”。
  win.webContents.on('did-start-loading', () => { attempts += 1; });
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    log.line('app', `页面加载失败(${code} ${desc})，第 ${attempts} 次`);
    if (quitting) return;
    if (attempts >= 6) {
      status('error', '无法加载 Harness 界面', '后端可能没在预期端口上，试试菜单「后端 → 重启后端」');
    } else if (!retryTimer) {
      retryTimer = setTimeout(tryLoad, 1500);
    }
  });
  win.webContents.on('did-finish-load', () => {
    attempts = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  });
  // Harness Web UI 会改页面标题；永远从 committed workspace 重算鲸坞标题。
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    if (!win.isDestroyed()) win.setTitle(workspaceWindowTitle());
  });
  win.once('ready-to-show', () => {
    if (quitting || win.isDestroyed()) return;
    win.show();
    win.focus();
    closeSplash();
    if (SMOKE) setTimeout(() => {
      console.log('SMOKE_OK');
      // 走 before-quit / will-quit，确保由本 App 启动的 dsh 先被回收。
      app.quit();
    }, 1200);
  });

  // 关窗口 = 收进托盘，不退出（Cmd+Q 才是真退出）
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  const saveBounds = () => {
    try { config.set({ bounds: win.getBounds() }); } catch (_e) { /* ignore */ }
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);

  // 站内新窗口允许；外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl())) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(baseUrl())) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  tryLoad();
}

function showApp() {
  clearTaskAttention();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else if (backendReady) {
    openMainWindow();
  } else if (splash && !splash.isDestroyed()) {
    splash.show();
    splash.focus();
  } else {
    const win = createSplash();
    win.show();
    win.focus();
  }
}

function toggleWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showApp();
  } else {
    showApp();
  }
}

function secureLocalWindow(win, expectedUrl) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedUrl) event.preventDefault();
  });
}

function openDashboardWindow() {
  clearTaskAttention();
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    pushDashboardState();
    return;
  }
  const expectedUrl = pathToFileURL(path.join(__dirname, 'dashboard.html')).href;
  const win = new BrowserWindow({
    width: 760,
    height: 780,
    minWidth: 680,
    minHeight: 660,
    show: false,
    title: '鲸坞任务看板',
    backgroundColor: '#090e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload-dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  dashboardWindow = win;
  secureLocalWindow(win, expectedUrl);
  win.webContents.on('did-finish-load', () => pushDashboardState());
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) { win.show(); win.focus(); }
  });
  win.on('closed', () => { if (dashboardWindow === win) dashboardWindow = null; });
  registerThemedWindow(win, 'dashboard.html');
  void win.loadFile('dashboard.html');
}

function showNoticeWindow(payload) {
  lastNoticePayload = payload;
  if (noticeWindow && !noticeWindow.isDestroyed()) {
    noticeWindow.webContents.send('notice:show', payload);
    noticeWindow.showInactive();
    return;
  }
  const expectedUrl = pathToFileURL(path.join(__dirname, 'notice.html')).href;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const win = new BrowserWindow({
    width: 420,
    height: 132,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(parent ? { parent } : {}),
    backgroundColor: '#101722',
    webPreferences: {
      preload: path.join(__dirname, 'preload-notice.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  noticeWindow = win;
  secureLocalWindow(win, expectedUrl);
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed() && lastNoticePayload) {
      win.webContents.send('notice:show', lastNoticePayload);
      win.showInactive();
    }
  });
  win.on('closed', () => { if (noticeWindow === win) noticeWindow = null; });
  void win.loadFile('notice.html');
}

async function renderOffscreenReport(value) {
  const request = reportRequest(value);
  const canonical = canonicalEventSnapshot();
  if (!canonical) throw new Error('事件规范快照不可用');
  const payload = reportPayload(canonical, request, app.getVersion());
  const expectedUrl = pathToFileURL(path.join(__dirname, 'report-card.html')).href;
  let win = null;
  let readyListener = null;
  let readyTimer = null;
  try {
    win = new BrowserWindow({
      width: 1080,
      height: 1440,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      backgroundColor: request.theme === 'light' ? '#f3f1ea' : '#07111d',
      webPreferences: {
        preload: path.join(__dirname, 'preload-report.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    secureLocalWindow(win, expectedUrl);
    const currentWin = win;
    const rendered = new Promise((resolve, reject) => {
      readyListener = (event, receipt) => {
        if (!trustedLocalEvent(event, currentWin, expectedUrl)) return;
        if (!isPlainObject(receipt) || receipt.ok !== true || receipt.theme !== request.theme) {
          reject(new Error('战报 renderer 回执无效'));
          return;
        }
        resolve();
      };
      ipcMain.on('report:ready', readyListener);
      readyTimer = setTimeout(() => reject(new Error('战报 renderer 渲染超时')), 15000);
    });
    await win.loadFile('report-card.html');
    // 战报是要落盘的图片：主题必须在 capture 之前确定生效，不能依赖异步监听。
    // 战报卡片自带深/浅两套配色；只有用户主题基调与本次请求一致时才套用，
    // 避免深色主题的色值被浅色卡片的更高优先级规则盖掉、出现半套皮肤。
    const reportTheme = currentTheme();
    if (reportTheme.base === request.theme) {
      await applyThemeToWindow(win, 'report-card.html', reportTheme);
    }
    win.webContents.send('report:render', payload);
    await rendered;
    let image = await win.webContents.capturePage({ x: 0, y: 0, width: 1080, height: 1440 });
    const size = image.getSize();
    if (size.width !== 1080 || size.height !== 1440) {
      image = image.resize({ width: 1080, height: 1440, quality: 'best' });
    }
    const finalSize = image.getSize();
    if (finalSize.width !== 1080 || finalSize.height !== 1440) {
      throw new Error('战报 PNG 尺寸不是 1080×1440');
    }
    if (request.action === 'copy') {
      clipboard.writeImage(image);
      return { ok: true, message: '已复制 1080×1440 战报图片。' };
    }
    const saveOptions = {
      title: '保存鲸坞任务战报',
      defaultPath: `WhaleDock-report-${new Date().toISOString().slice(0, 10)}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    };
    const result = dashboardWindow && !dashboardWindow.isDestroyed()
      ? await dialog.showSaveDialog(dashboardWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true, message: '已取消保存。' };
    await fs.promises.writeFile(result.filePath, image.toPNG(), { flag: 'w' });
    return { ok: true, message: '战报图片已保存。' };
  } finally {
    if (readyTimer) clearTimeout(readyTimer);
    if (readyListener) ipcMain.removeListener('report:ready', readyListener);
    if (win && !win.isDestroyed()) win.destroy();
  }
}

function trustedDashboardHandler(handler) {
  const expectedUrl = pathToFileURL(path.join(__dirname, 'dashboard.html')).href;
  return async (event, ...args) => {
    if (!trustedLocalEvent(event, dashboardWindow, expectedUrl)) {
      throw new Error('拒绝非看板主帧的 IPC 请求');
    }
    return handler(...args);
  };
}

function trustedNoticeHandler(handler) {
  const expectedUrl = pathToFileURL(path.join(__dirname, 'notice.html')).href;
  return async (event, ...args) => {
    if (!trustedLocalEvent(event, noticeWindow, expectedUrl)) {
      throw new Error('拒绝非提示窗主帧的 IPC 请求');
    }
    return handler(...args);
  };
}

function registerEventIpc() {
  const channels = [
    'dashboard:get', 'dashboard:export-report', 'dashboard:resume-budget',
    'dashboard:show-main', 'notice:activate', 'notice:dismiss'
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('dashboard:get', trustedDashboardHandler(async () => currentDashboardSnapshot()));
  ipcMain.handle('dashboard:show-main', trustedDashboardHandler(async () => {
    showApp();
    return { ok: true };
  }));
  ipcMain.handle('dashboard:export-report', trustedDashboardHandler(async (request) => {
    return renderOffscreenReport(request);
  }));
  ipcMain.handle('dashboard:resume-budget', trustedDashboardHandler(async () => {
    if (!eventService) throw new Error('事件服务不可用');
    const effects = effectsArray(await eventService.resumeBudget(), 'resumeBudget');
    const resumed = effects.some((effect) => effect && effect.type === 'budget-resumed');
    if (!resumed) return { ok: true, resumed: false, message: '今日预算未处于暂停状态。' };
    clearTaskAttention();
    if (!backendReady) await restartBackend({ allowBudgetResume: true });
    return { ok: true, resumed: true, message: '已确认今日继续运行。' };
  }));
  ipcMain.handle('notice:activate', trustedNoticeHandler(async () => {
    showApp();
    return { ok: true };
  }));
  ipcMain.handle('notice:dismiss', trustedNoticeHandler(async () => {
    if (noticeWindow && !noticeWindow.isDestroyed()) noticeWindow.hide();
    return { ok: true };
  }));
}

// ---------- v0.4 截图与图片自有窗口 ----------
let captureNotice = '';

function captureStagingRoot() {
  return path.join(app.getPath('userData'), 'capture-staging');
}

function ocrScriptsRoot(runtime = {}) {
  const packaged = typeof runtime.packaged === 'boolean'
    ? runtime.packaged : Boolean(app && app.isPackaged);
  const base = packaged
    ? (runtime.resourcesPath || process.resourcesPath)
    : (runtime.appDir || __dirname);
  if (typeof base !== 'string' || !path.isAbsolute(base) || base.includes('\0')) {
    const error = new Error('OCR 脚本根目录不可证明');
    error.code = 'ERR_CAPTURE_OCR_ROOT';
    throw error;
  }
  return packaged ? path.join(base, 'ocr') : path.join(base, 'assets', 'ocr');
}

function captureTerminalStage(stage) {
  return ['copied', 'done', 'failed', 'cancelled'].includes(stage);
}

function captureRendererState() {
  if (!captureState) {
    return {
      stage: 'idle',
      platform: process.platform,
      instruction: process.platform === 'win32'
        ? '请按 Win+Shift+S 框选，然后明确点击“读取剪贴板”。'
        : '可拖入一张 PNG/JPEG，或显式读取剪贴板图片。'
    };
  }
  return {
    ...imageInput.captureRendererSnapshot(captureState),
    platform: process.platform,
    instruction: captureState.source === 'windows-clipboard' && captureState.stage === 'acquiring'
      ? '请按 Win+Shift+S 框选，然后点击“读取剪贴板”。鲸坞不会监听剪贴板。'
      : null,
    notice: safeText(captureNotice, '', 240)
  };
}

function sendCaptureState() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.webContents.send('capture:state', captureRendererState());
  }
}

function queueCaptureMutation(operation) {
  const run = captureSerial.then(operation, operation);
  captureSerial = run.catch(() => {});
  return run;
}

async function closeCapturePromptAdapter(target = capturePromptAdapter) {
  const promptAdapter = target;
  if (capturePromptAdapter === promptAdapter) capturePromptAdapter = null;
  if (promptAdapter) {
    try { await promptAdapter.close(); } catch (_error) { /* 截图结束继续清理 staging */ }
  }
}

function currentCaptureOwner() {
  return captureState ? { captureId: captureState.captureId, epoch: captureEpoch } : null;
}

function captureOwnerCurrent(owner) {
  return Boolean(owner && !quitting && !captureShuttingDown && captureState
    && captureState.captureId === owner.captureId && captureEpoch === owner.epoch);
}

function requireCaptureOwner(owner) {
  if (!captureOwnerCurrent(owner)) {
    const error = new Error('图片处理代已失效');
    error.code = 'ERR_CAPTURE_STALE';
    throw error;
  }
  return captureState;
}

async function cleanupCaptureStaging(state = captureState) {
  if (!state || typeof state.stagingPath !== 'string') return;
  try {
    await imageInput.cleanupStagingFile(state.stagingPath, captureStagingRoot());
  } catch (_error) { /* 只清理受控文件，失败留待下次启动 */ }
}

async function cancelCurrentCapture(reason = '') {
  // 先同步摘除所有全局所有权，再做任何 await。旧 OCR/prompt
  // 即使稍后落定，也无法污染新 capture 或在退出时写剪贴板。
  const state = captureState;
  const promptAdapter = capturePromptAdapter;
  const screenshotProcess = captureChild;
  const recognitionProcess = ocrChild;
  const win = captureWindow;
  captureEpoch += 1;
  captureState = null;
  capturePromptAdapter = null;
  captureChild = null;
  ocrChild = null;
  captureWindow = null;
  captureNotice = '';
  if (screenshotProcess && !screenshotProcess.killed) {
    try { screenshotProcess.kill(); } catch (_error) { /* child 可能已退出 */ }
  }
  if (recognitionProcess && !recognitionProcess.killed) {
    try { recognitionProcess.kill(); } catch (_error) { /* child 可能已退出 */ }
  }
  if (win && !win.isDestroyed()) win.destroy();
  await closeCapturePromptAdapter(promptAdapter);
  await cleanupCaptureStaging(state);
  if (reason) log.line('capture', `当前图片处理已取消：${safeText(reason, '用户取消', 80)}`);
}

function beginCaptureState(source) {
  if (quitting || captureShuttingDown) throw new Error('App 正在退出，未开始新的图片处理');
  const workspace = currentWorkspaceSurface();
  captureEpoch += 1;
  captureNotice = '';
  captureState = imageInput.createCapture({
    captureId: crypto.randomUUID().replace(/-/g, ''),
    source,
    workspaceGeneration: workspace.generation,
    workspaceLabel: workspace.current.label
  });
  return captureState;
}

function prepareCaptureAcquisition(source) {
  if (!captureState || captureState.stage !== 'acquiring') {
    const error = new Error('当前图片已进入确认流程，请先取消或完成');
    error.code = 'ERR_CAPTURE_BUSY';
    throw error;
  }
  // 在 IPC 入队前同步确定来源并换代；排队中的旧请求永远携带旧 owner，
  // 不得在任一 await 后重新读取全局状态并认领新的 capture。
  if (captureState.source !== source) beginCaptureState(source);
  return captureState;
}

function openCaptureWindow(options = {}) {
  const source = ['mac-capture', 'windows-clipboard', 'paste', 'drop'].includes(options.source)
    ? options.source : 'drop';
  if (!captureState || captureTerminalStage(captureState.stage)) beginCaptureState(source);
  if (captureWindow && !captureWindow.isDestroyed()) {
    if (options.show !== false) {
      captureWindow.show();
      captureWindow.focus();
    }
    sendCaptureState();
    return captureWindow;
  }
  captureFileUrl = pathToFileURL(path.join(__dirname, 'capture.html')).href;
  const win = new BrowserWindow({
    width: 760,
    height: 680,
    minWidth: 640,
    minHeight: 560,
    show: false,
    title: '截图与图片 · 鲸坞 WhaleDock',
    backgroundColor: '#09111a',
    webPreferences: {
      preload: path.join(__dirname, 'preload-capture.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  captureWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== captureFileUrl) event.preventDefault();
  });
  win.webContents.on('render-process-gone', () => {
    if (captureWindow === win) void cancelCurrentCapture('图片窗口异常退出');
  });
  win.webContents.on('did-finish-load', () => {
    if (captureWindow === win) sendCaptureState();
  });
  win.once('ready-to-show', () => {
    if (captureWindow === win && options.show !== false && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on('closed', () => {
    if (captureWindow !== win) return;
    captureWindow = null;
    if (captureState) void cancelCurrentCapture('图片窗口已关闭');
  });
  registerThemedWindow(win, 'capture.html');
  void win.loadFile('capture.html');
  return win;
}

function thumbnailDataUrl(image) {
  const size = image.getSize();
  const scale = Math.min(1, 720 / Math.max(size.width, size.height));
  let preview = scale < 1
    ? image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'good'
      })
    : image;
  let value = preview.toDataURL();
  if (Buffer.byteLength(value, 'utf8') > imageInput.LIMITS.maxThumbnailBytes) {
    const smaller = Math.min(1, 360 / Math.max(size.width, size.height));
    preview = image.resize({
      width: Math.max(1, Math.round(size.width * smaller)),
      height: Math.max(1, Math.round(size.height * smaller)),
      quality: 'good'
    });
    value = preview.toDataURL();
  }
  if (Buffer.byteLength(value, 'utf8') > imageInput.LIMITS.maxThumbnailBytes) {
    throw new Error('图片缩略图超过安全上限');
  }
  return value;
}

async function acquireImageBuffer(buffer, source, sourcePath, owner) {
  const ownerState = requireCaptureOwner(owner);
  if (ownerState.stage !== 'acquiring' || ownerState.source !== source) {
    const error = new Error('当前图片已进入确认流程，请先取消或完成');
    error.code = 'ERR_CAPTURE_BUSY';
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 1
      || buffer.length > imageInput.LIMITS.maxSourceBytes) {
    const error = new Error('图片为空或超过 20 MiB 上限');
    error.code = 'ERR_IMAGE_TOO_LARGE';
    throw error;
  }
  const header = imageInput.inspectImageHeader(buffer);
  const decoded = nativeImage.createFromBuffer(buffer);
  if (decoded.isEmpty()) {
    const error = new Error('图片无法解码');
    error.code = 'ERR_IMAGE_DECODE';
    throw error;
  }
  const dimensions = decoded.getSize();
  imageInput.validateDecodedImage({
    source,
    sourceBytes: buffer.length,
    header,
    width: dimensions.width,
    height: dimensions.height
  });
  const pngBuffer = decoded.toPNG();
  const stagingPath = await imageInput.writeStagingPng({
    stagingRoot: captureStagingRoot(),
    captureId: ownerState.captureId,
    pngBuffer
  });
  if (!captureOwnerCurrent(owner)) {
    await imageInput.cleanupStagingFile(stagingPath, captureStagingRoot()).catch(() => {});
    requireCaptureOwner(owner);
  }
  captureState = imageInput.reduceCapture(requireCaptureOwner(owner), {
    type: 'acquired',
    stagingPath,
    ...(sourcePath ? { sourcePath } : {}),
    thumbnail: thumbnailDataUrl(decoded),
    width: dimensions.width,
    height: dimensions.height
  });
  captureNotice = '图片已解码；请第一次确认是否保存并处理。';
  openCaptureWindow({ source, show: true });
  sendCaptureState();
  return captureRendererState();
}

async function acquireDroppedFile(filePath, owner) {
  requireCaptureOwner(owner);
  if (typeof filePath !== 'string' || !boundedPath(filePath) || !path.isAbsolute(filePath)) {
    throw new Error('只接受一个本地图片文件');
  }
  const stat = await fs.promises.lstat(filePath);
  requireCaptureOwner(owner);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1
      || stat.size > imageInput.LIMITS.maxSourceBytes) {
    throw new Error('拖入项不是可用的单张图片');
  }
  const value = await fs.promises.readFile(filePath);
  requireCaptureOwner(owner);
  return acquireImageBuffer(value, 'drop', filePath, owner);
}

async function readClipboardImage(source, owner) {
  requireCaptureOwner(owner);
  const image = clipboard.readImage();
  if (!image || image.isEmpty()) {
    const error = new Error('剪贴板里没有可读取的图片');
    error.code = 'ERR_CAPTURE_CLIPBOARD_EMPTY';
    throw error;
  }
  const size = image.getSize();
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)
      || size.width < 1 || size.height < 1
      || size.width > imageInput.LIMITS.maxSide || size.height > imageInput.LIMITS.maxSide
      || size.width * size.height > imageInput.LIMITS.maxPixels) {
    const error = new Error('剪贴板图片尺寸超过安全上限');
    error.code = 'ERR_IMAGE_DIMENSIONS';
    throw error;
  }
  return acquireImageBuffer(image.toPNG(), source, undefined, owner);
}

function hiddenOwnedWindows() {
  const hidden = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.isVisible()) {
      hidden.push(win);
      win.hide();
    }
  }
  return () => {
    for (const win of hidden) {
      if (!win.isDestroyed()) win.show();
    }
  };
}

async function acquireMacScreenshot() {
  const cancellation = cancelCurrentCapture();
  const cancellationEpoch = captureEpoch;
  await cancellation;
  if (captureEpoch !== cancellationEpoch || captureState !== null
      || quitting || captureShuttingDown) {
    const error = new Error('截图请求已被新的图片处理替代');
    error.code = 'ERR_CAPTURE_STALE';
    throw error;
  }
  beginCaptureState('mac-capture');
  const owner = currentCaptureOwner();
  const planned = await imageInput.planMacCaptureStaging({
    stagingRoot: captureStagingRoot(),
    captureId: requireCaptureOwner(owner).captureId
  });
  requireCaptureOwner(owner);
  const plan = imageInput.macCaptureCommand(planned.path);
  const restore = hiddenOwnedWindows();
  try {
    const result = await new Promise((resolve) => {
      const child = execFile(plan.file, plan.args, {
        shell: false,
        windowsHide: plan.windowsHide,
        timeout: 120000,
        maxBuffer: 64 * 1024
      }, (error) => {
        if (captureChild === child) captureChild = null;
        resolve({ error });
      });
      captureChild = child;
    });
    if (!captureOwnerCurrent(owner)) return { cancelled: true };
    let stat = null;
    try { stat = await fs.promises.lstat(planned.path); } catch (_error) { /* Esc/权限失败 */ }
    if (!captureOwnerCurrent(owner)) return { cancelled: true };
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1
        || stat.size > imageInput.LIMITS.maxSourceBytes) {
      await cancelCurrentCapture(result.error ? '系统截图失败或被拒绝' : '用户取消系统截图');
      return { cancelled: true };
    }
    const value = await fs.promises.readFile(planned.path);
    requireCaptureOwner(owner);
    return await acquireImageBuffer(value, 'mac-capture', undefined, owner);
  } finally {
    await imageInput.cleanupStagingFile(planned.path, captureStagingRoot()).catch(() => {});
    restore();
  }
}

function handleScreenshotHotkey() {
  if (workspaceCoordinator && workspaceCoordinator.busy) {
    log.line('capture', '工作区事务中，未开始新截图');
    return;
  }
  if (captureState && !captureTerminalStage(captureState.stage)) {
    openCaptureWindow({ source: captureState.source });
    return;
  }
  if (process.platform === 'darwin') {
    void queueCaptureMutation(acquireMacScreenshot).catch((error) => {
      log.line('capture', `macOS 截图失败：${error && error.code || 'unknown'}`);
      if (quitting || captureShuttingDown || (error && error.code === 'ERR_CAPTURE_STALE')) return;
      captureNotice = '截图失败。可检查“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”，或改用拖图。';
      openCaptureWindow({ source: 'mac-capture' });
      sendCaptureState();
    });
    return;
  }
  beginCaptureState(process.platform === 'win32' ? 'windows-clipboard' : 'drop');
  openCaptureWindow({ source: captureState.source });
}

async function recognizeSavedCapture(owner) {
  const savedState = requireCaptureOwner(owner);
  const savedPath = savedState.savedPath;
  const routeChoice = imageInput.selectImageRoute({
    official: 'unknown',
    plugin: 'unknown',
    localOcr: ['darwin', 'win32'].includes(process.platform) ? 'available' : 'unavailable'
  });
  let route = routeChoice.route;
  let ocrText = '';
  let ocrTruncated = false;
  if (route === 'local-ocr') {
    const plan = imageInput.ocrCommand(process.platform, {
      scriptsRoot: ocrScriptsRoot(),
      imagePath: savedPath
    });
    const result = await imageInput.runBoundedOcr(plan, {
      spawn: (file, args, options) => {
        const child = spawn(file, args, options);
        ocrChild = child;
        child.once('close', () => { if (ocrChild === child) ocrChild = null; });
        return child;
      },
      timeoutMs: 30000,
      settleTimeoutMs: 1000
    });
    requireCaptureOwner(owner);
    if (result.ok) {
      ocrText = result.text;
      ocrTruncated = result.truncated === true;
    } else {
      route = 'path-only';
    }
  }

  await closeCapturePromptAdapter();
  requireCaptureOwner(owner);
  let promptAdapter = null;
  let targets = [];
  try {
    promptAdapter = backend.createDshPromptAdapter({
      port: config.get('port'),
      expectedHostVersion: config.DSH_CONTRACT.hostVersion,
      packageVersionProof: spawnedByUs && backendState
        ? backendState.version : null
    });
    capturePromptAdapter = promptAdapter;
    const listed = await promptAdapter.listTargets();
    requireCaptureOwner(owner);
    if (listed && listed.available === true && Array.isArray(listed.targets)) targets = listed.targets;
  } catch (_error) { /* 会话写能力 fail-closed，保留复制 */ }
  if (!captureOwnerCurrent(owner)) {
    await closeCapturePromptAdapter(promptAdapter);
    requireCaptureOwner(owner);
  }
  const deliveryText = imageInput.buildDeliveryText({
    savedPath,
    route,
    ocrText,
    ocrTruncated
  });
  captureState = imageInput.reduceCapture(requireCaptureOwner(owner), {
    type: 'recognized',
    route,
    ocrText,
    ocrTruncated,
    deliveryText,
    targets
  });
  captureNotice = targets.length
    ? '图片已保存。请检查完整文本与目标会话，再做第二次确认。'
    : '自动提交能力不可证明；图片已保存，可复制确认内容后手动粘贴。';
  sendCaptureState();
}

async function failCaptureOwner(owner, error) {
  if (!captureOwnerCurrent(owner)) return;
  const state = captureState;
  if (!captureTerminalStage(state.stage)) {
    captureState = imageInput.reduceCapture(state, {
      type: 'fail',
      errorCode: error && error.code || 'capture-failed'
    });
    captureNotice = '本次图片处理未完成；已保存的图片不会被删除。';
  }
  await cleanupCaptureStaging(state);
  await closeCapturePromptAdapter();
  if (captureOwnerCurrent(owner)) sendCaptureState();
}

async function confirmCaptureSave(captureId) {
  if (!captureState || captureState.captureId !== captureId) throw new Error('图片处理代已失效');
  if (workspaceCoordinator && workspaceCoordinator.busy) throw new Error('工作区正在切换，请重新确认图片');
  const owner = currentCaptureOwner();
  captureState = imageInput.reduceCapture(requireCaptureOwner(owner), { type: 'confirm-save' });
  sendCaptureState();
  try {
    const workspace = currentWorkspaceSurface();
    const savingState = requireCaptureOwner(owner);
    const savedPath = await imageInput.saveStagedImage({
      stagingPath: savingState.stagingPath,
      workspacePath: workspace.current.effectivePath,
      forbiddenRoots: forbiddenWorkspaceRoots(),
      workspaceGeneration: savingState.workspaceGeneration,
      currentWorkspaceGeneration: workspace.generation
    });
    captureState = imageInput.reduceCapture(requireCaptureOwner(owner), { type: 'saved', savedPath });
    sendCaptureState();
    await recognizeSavedCapture(owner);
    requireCaptureOwner(owner);
    return captureRendererState();
  } catch (error) {
    await failCaptureOwner(owner, error);
    throw error;
  }
}

async function deliverCapture(value) {
  const request = captureDeliveryRequest(value);
  if (!captureState || captureState.captureId !== request.captureId) throw new Error('图片处理代已失效');
  const owner = currentCaptureOwner();
  if (request.action === 'save-only') {
    captureState = imageInput.reduceCapture(requireCaptureOwner(owner), { type: 'save-only' });
    captureNotice = '图片已保存，未发送也未写入剪贴板。';
  } else if (request.action === 'copy') {
    const state = requireCaptureOwner(owner);
    clipboard.writeText(state.deliveryText);
    captureState = imageInput.reduceCapture(state, { type: 'copied' });
    captureNotice = '已把用户确认的文本与图片路径复制到剪贴板；剪贴板可被其他应用读取。';
  } else {
    const readyState = requireCaptureOwner(owner);
    const promptAdapter = capturePromptAdapter;
    captureState = imageInput.reduceCapture(readyState, { type: 'submit' });
    sendCaptureState();
    let result = { state: 'unknown', reason: 'adapter-unavailable' };
    if (promptAdapter) {
      try {
        result = await promptAdapter.submitText({
          targetToken: request.targetToken,
          text: readyState.deliveryText,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
      } catch (_error) {
        result = { state: 'unknown', reason: 'adapter-error' };
      }
    }
    // 取消/切工作区/退出后，unknown 也不得写剪贴板或更改新 capture。
    const submittingState = requireCaptureOwner(owner);
    if (result.state === 'accepted') {
      captureState = imageInput.reduceCapture(submittingState, { type: 'accepted' });
      captureNotice = '已提交。回答请回主 Harness 窗口查看；这不代表模型已完成回答。';
    } else {
      clipboard.writeText(submittingState.deliveryText);
      captureState = imageInput.reduceCapture(submittingState, { type: 'copied' });
      captureNotice = result.state === 'unknown'
        ? '提交结果不确定，未自动重试。已复制确认内容；请先检查会话，避免重复。'
        : '会话未接纳该请求。已复制确认内容，可手动粘贴。';
    }
  }
  const finalState = requireCaptureOwner(owner);
  const promptAdapter = capturePromptAdapter;
  await cleanupCaptureStaging(finalState);
  await closeCapturePromptAdapter(promptAdapter);
  requireCaptureOwner(owner);
  sendCaptureState();
  return captureRendererState();
}

function trustedCaptureHandler(handler) {
  return async (event, ...args) => {
    if (!trustedLocalEvent(event, captureWindow, captureFileUrl)) {
      throw new Error('拒绝非图片窗的 IPC 请求');
    }
    return handler(...args);
  };
}

function registerCaptureIpc() {
  const channels = [
    'capture:get', 'capture:read-clipboard', 'capture:accept-drop',
    'capture:confirm-save', 'capture:deliver', 'capture:cancel', 'capture:show-in-folder'
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('capture:get', trustedCaptureHandler(async () => captureRendererState()));
  ipcMain.handle('capture:read-clipboard', trustedCaptureHandler(async (mode) => {
    if (!['explicit', 'paste'].includes(mode)) throw new Error('剪贴板读取动作无效');
    const source = mode === 'paste' || process.platform !== 'win32'
      ? 'paste' : 'windows-clipboard';
    prepareCaptureAcquisition(source);
    const owner = currentCaptureOwner();
    requireCaptureOwner(owner);
    return queueCaptureMutation(() => readClipboardImage(source, owner));
  }));
  ipcMain.handle('capture:accept-drop', trustedCaptureHandler(async (filePath) => {
    prepareCaptureAcquisition('drop');
    const owner = currentCaptureOwner();
    requireCaptureOwner(owner);
    return queueCaptureMutation(() => acquireDroppedFile(filePath, owner));
  }));
  ipcMain.handle('capture:confirm-save', trustedCaptureHandler(async (captureId) => (
    queueCaptureMutation(() => confirmCaptureSave(captureId))
  )));
  ipcMain.handle('capture:deliver', trustedCaptureHandler(async (request) => (
    queueCaptureMutation(() => deliverCapture(request))
  )));
  ipcMain.handle('capture:cancel', trustedCaptureHandler(async (captureId) => {
    if (!captureState || captureState.captureId !== captureId) throw new Error('图片处理代已失效');
    await cancelCurrentCapture('用户取消');
    return { ok: true };
  }));
  ipcMain.handle('capture:show-in-folder', trustedCaptureHandler(async (captureId) => {
    if (!captureState || captureState.captureId !== captureId || !captureState.savedPath) {
      throw new Error('当前没有已保存图片');
    }
    shell.showItemInFolder(captureState.savedPath);
    return { ok: true };
  }));
}

function beginCaptureShutdown() {
  if (captureShutdownPromise) return captureShutdownPromise;
  captureShuttingDown = true;
  captureShutdownPromise = (async () => {
    await cancelCurrentCapture('App 正在退出');
    // OCR / prompt 操作可能正在 captureSerial 里等待被 kill/abort 后落定。
    // 退出须等它真正结束，再做最后一次受控目录清理。
    await Promise.allSettled([captureSerial]);
    await closeCapturePromptAdapter();
    await imageInput.cleanupOwnedStaging({ stagingRoot: captureStagingRoot() });
  })();
  const markComplete = () => { captureShutdownComplete = true; };
  void captureShutdownPromise.then(markComplete, markComplete);
  return captureShutdownPromise;
}

// ---------- 设置窗 / 登录项 ----------
function portableExecutableFile() {
  const value = process.env.PORTABLE_EXECUTABLE_FILE;
  return value ? path.resolve(value) : null;
}

function isPortableBuild() {
  return Boolean(portableExecutableFile() || process.env.PORTABLE_EXECUTABLE_DIR);
}

function loginItemOptions(openAtLogin) {
  const options = { openAtLogin: Boolean(openAtLogin) };
  if (process.platform === 'win32') {
    options.path = portableExecutableFile() || process.execPath;
    options.args = [];
  }
  if (isMac) options.openAsHidden = Boolean(config.get('startMinimized'));
  return options;
}

function loginItemStatus(errorMessage = '') {
  const desired = Boolean(config.get('openAtLogin'));
  try {
    const query = loginItemOptions(desired);
    const actualState = app.getLoginItemSettings(query);
    const actual = typeof actualState.executableWillLaunchAtLogin === 'boolean'
      ? actualState.executableWillLaunchAtLogin
      : Boolean(actualState.openAtLogin);
    let error = errorMessage;
    if (!error && desired !== actual) {
      error = desired && isMac
        ? '系统未接受，请在 系统设置→通用→登录项 手动添加'
        : (desired ? '系统未接受开机自启设置' : '系统登录项仍在启用，请重试或手动移除');
    }
    return {
      desired,
      actual,
      error: error || null,
      path: process.platform === 'win32' ? query.path : null
    };
  } catch (error) {
    return { desired, actual: false, error: errorMessage || error.message, path: null };
  }
}

function applyLoginItem(desired) {
  try {
    app.setLoginItemSettings(loginItemOptions(desired));
    return loginItemStatus();
  } catch (error) {
    return loginItemStatus(error.message);
  }
}

function reconcileLoginItem() {
  const desired = Boolean(config.get('openAtLogin'));
  const before = loginItemStatus();
  if (before.actual !== desired || (desired && portableExecutableFile())) {
    const after = applyLoginItem(desired);
    if (desired && portableExecutableFile()) {
      log.line('app', `便携版登录项已对账为当前路径：${portableExecutableFile()}`);
    }
    if (after.error) log.line('app', `开机自启对账失败：${after.error}`);
    else log.line('app', `开机自启对账完成：${after.actual ? '已启用' : '已关闭'}`);
  }
}

function electronHotkeyRuntime() {
  return {
    unregister: (key) => globalShortcut.unregister(key),
    register: (key, kind) => globalShortcut.register(key, kind === 'capture'
      ? () => handleScreenshotHotkey()
      : () => toggleWindow())
  };
}

function settingsSnapshot() {
  const current = config.get();
  const result = {};
  for (const key of config.SETTINGS_FIELDS) result[key] = current[key];
  return result;
}

function settingsRuntime() {
  return {
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    portable: isPortableBuild(),
    loginItem: loginItemStatus(),
    manualUrl: MANUAL_URL,
    logsUrl: pathToFileURL(log.dirPath()).href,
    workspace: currentWorkspaceSurface(),
    pets: petsRuntimeSurface(),
    themes: themesRuntimeSurface()
  };
}

// 设置窗只拿到展示所需的最小信息：id/名字/作者/来源与被跳过的数量，
// 不下发任何本地路径，也不下发帧数据。
function petsRuntimeSurface() {
  const listed = listAvailablePets();
  return {
    selected: config.get().petPackageId,
    skipped: listed.skipped.length,
    packages: listed.packages.slice(0, 100).map((item) => ({
      id: item.id,
      name: item.name,
      author: item.author || null,
      source: item.source,
      singleImage: item.singleImage === true
    }))
  };
}

function themesRuntimeSurface() {
  const listed = listAvailableThemes();
  return {
    selected: config.get().theme,
    skipped: listed.skipped.length,
    themes: listed.themes.slice(0, 100).map((item) => ({
      id: item.id,
      name: item.name,
      author: item.author || null,
      source: item.source,
      base: item.base
    }))
  };
}

function trustedSettingsEvent(event) {
  if (!settingsWindow || settingsWindow.isDestroyed()) return false;
  if (event.sender !== settingsWindow.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  return event.senderFrame.url === pathToFileURL(path.join(__dirname, 'settings.html')).href;
}

function trustedSettingsHandler(handler) {
  return async (event, ...args) => {
    if (!trustedSettingsEvent(event)) throw new Error('拒绝非设置窗的 IPC 请求');
    return handler(...args);
  };
}

function registerSettingsIpc() {
  const channels = [
    'settings:get', 'settings:apply', 'settings:switch-workspace',
    'settings:restart-backend', 'settings:check-update',
    'settings:rescan-pets', 'settings:reload-themes', 'settings:open-resource-dir'
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('settings:get', trustedSettingsHandler(async () => ({
    settings: settingsSnapshot(),
    runtime: settingsRuntime(),
    workspace: currentWorkspaceSurface()
  })));

  ipcMain.handle('settings:apply', trustedSettingsHandler(async (patch) => {
    const before = config.get();
    const normalized = config.validateSettingsPatch(patch);
    const needsRestart = config.restartRequired(before, normalized);
    const hotkeyChanged = ['hotkey', 'screenshotHotkeyEnabled', 'screenshotHotkey']
      .some((key) => Object.prototype.hasOwnProperty.call(normalized, key)
        && normalized[key] !== before[key]);
    const loginChanged = Object.prototype.hasOwnProperty.call(normalized, 'openAtLogin')
      && normalized.openAtLogin !== before.openAtLogin;
    let login = loginItemStatus();
    let loginError = '';
    let configWritten = false;
    let hotkeyTransaction = null;
    let eventEffects = [];
    const eventFields = new Set([
      'taskNotifications', 'budgetEnabled', 'dailyTokenBudget',
      'priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion'
    ]);
    const eventConfigChanged = Object.keys(normalized).some((key) => eventFields.has(key));

    if (hotkeyChanged) {
      hotkeyTransaction = applyHotkeyBindings(before, { ...before, ...normalized }, electronHotkeyRuntime());
    }
    if (loginChanged) {
      // loginItemStatus 的 desired 来自配置；先按新期望写系统，保存后再做真实回读。
      try { app.setLoginItemSettings(loginItemOptions(normalized.openAtLogin)); }
      catch (error) { loginError = error.message; }
    }

    try {
      config.set(normalized);
      configWritten = true;
      if (eventService && eventConfigChanged) {
        eventEffects = effectsArray(await eventService.configure(eventConfigSnapshot({
          ...before,
          ...normalized
        })), 'configure');
      }
    } catch (error) {
      if (configWritten) {
        const rollbackPatch = {};
        for (const key of Object.keys(normalized)) rollbackPatch[key] = before[key];
        try { config.set(rollbackPatch); } catch (rollbackError) {
          log.line('app', `事件配置失败后 config 回滚也失败：${rollbackError.message}`);
        }
      }
      if (hotkeyTransaction) {
        try { hotkeyTransaction.rollback(); } catch (rollbackError) {
          log.line('app', `配置写入失败后快捷键回滚也失败：${rollbackError.message}`);
        }
      }
      if (loginChanged) applyLoginItem(before.openAtLogin);
      throw error;
    }

    if (hotkeyTransaction) hotkeyTransaction.commit();

    // 宠物与主题都是即时生效项：config 落盘成功后才动窗口。
    if (['petEnabled', 'petPackageId', 'petAlwaysOnTop', 'petClickThrough']
      .some((key) => Object.prototype.hasOwnProperty.call(normalized, key))) {
      syncPetWindow();
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'theme')) refreshAllThemes();

    if (eventEffects.length) await handleEventEffects(eventEffects, eventMonitor);
    if (loginChanged) login = loginItemStatus(loginError);
    if (Object.prototype.hasOwnProperty.call(normalized, 'checkUpdates')) configureUpdateSchedule();
    log.line('app', `设置已保存${needsRestart ? '（后端需重启）' : ''}`);
    return {
      ok: true,
      settings: settingsSnapshot(),
      restartRequired: needsRestart,
      message: needsRestart ? '已保存，重启后端生效' : '设置已保存',
      loginItem: login
    };
  }));

  ipcMain.handle('settings:switch-workspace', trustedSettingsHandler(async () => {
    const result = await chooseAndSwitchWorkspace(settingsWindow);
    return {
      ok: true,
      result,
      workspace: currentWorkspaceSurface()
    };
  }));

  ipcMain.handle('settings:restart-backend', trustedSettingsHandler(async () => {
    const restarted = await restartBackend();
    return restarted
      ? { ok: true, message: '后端已重启' }
      : { ok: false, message: '今日预算暂停中，请在任务看板确认继续' };
  }));

  ipcMain.handle('settings:check-update', trustedSettingsHandler(async () => {
    return runUpdateCheck(true);
  }));

  // 重新扫描只重读受控目录，不接受渲染层传入路径。
  ipcMain.handle('settings:rescan-pets', trustedSettingsHandler(async () => {
    syncPetWindow();
    return { ok: true, pets: petsRuntimeSurface() };
  }));
  ipcMain.handle('settings:reload-themes', trustedSettingsHandler(async () => {
    const theme = refreshAllThemes();
    return { ok: true, themes: themesRuntimeSurface(), applied: theme.id };
  }));
  ipcMain.handle('settings:open-resource-dir', trustedSettingsHandler(async (kind) => {
    const opened = await openUserResourceDir(kind === 'themes' ? 'themes' : 'pets');
    return { ok: opened };
  }));
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const settingsFileUrl = pathToFileURL(path.join(__dirname, 'settings.html')).href;
  const logsUrl = pathToFileURL(log.dirPath()).href;
  const win = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 520,
    minHeight: 560,
    show: false,
    title: '鲸坞设置',
    backgroundColor: '#090e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow = win;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === MANUAL_URL) void shell.openExternal(url);
    else if (url === logsUrl) void shell.openPath(log.dirPath());
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== settingsFileUrl) event.preventDefault();
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on('closed', () => { if (settingsWindow === win) settingsWindow = null; });
  registerThemedWindow(win, 'settings.html');
  void win.loadFile('settings.html');
}

// ---------- 更新检查（固定 GitHub latest；不携带用户标识） ----------
function clearUpdateSchedule() {
  if (updateStartTimer) clearTimeout(updateStartTimer);
  if (updateIntervalTimer) clearInterval(updateIntervalTimer);
  updateStartTimer = null;
  updateIntervalTimer = null;
}

function configureUpdateSchedule() {
  clearUpdateSchedule();
  if (!config.get('checkUpdates') || quitting) {
    log.line('app', '自动检查更新已关闭');
    return;
  }
  updateStartTimer = setTimeout(() => { void runUpdateCheck(false); }, UPDATE_START_DELAY_MS);
  updateIntervalTimer = setInterval(() => { void runUpdateCheck(false); }, UPDATE_INTERVAL_MS);
  if (typeof updateStartTimer.unref === 'function') updateStartTimer.unref();
  if (typeof updateIntervalTimer.unref === 'function') updateIntervalTimer.unref();
}

function updateFixtureFetch() {
  const fixturePath = process.env.WHALEDOCK_UPDATE_FIXTURE;
  if (!fixturePath || app.isPackaged) return null;
  const absolute = path.resolve(fixturePath);
  return async (url, options) => {
    log.line('app', `使用本地更新 fixture（仅开发模式）：${absolute}`);
    if (url !== update.RELEASE_API || options.method !== 'GET') throw new Error('fixture 收到非预期请求');
    const body = fs.readFileSync(absolute, 'utf8');
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(Buffer.byteLength(body, 'utf8')) },
      text: async () => body
    };
  };
}

function activeDialogParent() {
  for (const win of [settingsWindow, dashboardWindow, mainWindow, splash]) {
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

function showMessageBox(options) {
  const parent = activeDialogParent();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function releaseSummary(notes) {
  const first = String(notes || '').split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#+|[-*])\s*/, '').trim())
    .find(Boolean);
  if (!first) return '查看发布页了解本次更新内容。';
  return first.length > 240 ? `${first.slice(0, 237)}…` : first;
}

async function remindOnlyUpdate(result, portableWindows = false) {
  const detail = portableWindows
    ? `发现 WhaleDock ${result.latestVersion}。便携版不能原地安装，请到下载页获取新版。\n\n${releaseSummary(result.release.notes)}`
    : `发现 WhaleDock ${result.latestVersion}。macOS 当前版本会提醒你下载，不会自动安装。\n\n${releaseSummary(result.release.notes)}`;
  const { response } = await showMessageBox({
    type: 'info',
    title: '鲸坞有新版本',
    message: `发现新版本 ${result.latestVersion}`,
    detail,
    buttons: ['去下载', '跳过此版本', '稍后'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  if (response === 0) {
    await shell.openExternal(result.release.url || update.RELEASE_PAGE);
    return { ok: true, updateAvailable: true, version: result.latestVersion, message: '已打开下载页' };
  }
  if (response === 1) {
    config.set({ skipVersion: result.latestVersion });
    return { ok: true, updateAvailable: true, version: result.latestVersion, message: `已跳过版本 ${result.latestVersion}` };
  }
  return { ok: true, updateAvailable: true, version: result.latestVersion, message: '稍后再更新' };
}

async function removeUpdateTemp(dir) {
  try { await fs.promises.rm(dir, { recursive: true, force: true }); }
  catch (error) { log.line('app', `清理更新临时目录失败：${error.message}`); }
}

async function offerManualUpdateFallback(result, error) {
  const detail = `${String(error && error.message || error)}\n\n已停止自动安装。你可以前往 GitHub Releases 手动下载。`;
  const { response } = await showMessageBox({
    type: 'error',
    title: '自动更新未完成',
    message: '更新包下载或校验失败',
    detail,
    buttons: ['去下载', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (response === 0) await shell.openExternal(result.release.url || update.RELEASE_PAGE);
  return {
    ok: false,
    updateAvailable: true,
    version: result.latestVersion,
    message: `自动更新失败：${String(error && error.message || error)}`
  };
}

async function downloadAndInstallWindowsUpdate(result) {
  const selection = result.selection;
  if (!selection || !selection.asset || !selection.checksumAsset) {
    return offerManualUpdateFallback(result, new Error('Release 缺少 Windows 安装器或 SHA256SUMS-win.txt'));
  }
  const { response } = await showMessageBox({
    type: 'info',
    title: '鲸坞有新版本',
    message: `发现新版本 ${result.latestVersion}`,
    detail: `${releaseSummary(result.release.notes)}\n\n点击“立即更新”后会下载并校验安装包。`,
    buttons: ['立即更新', '跳过此版本', '稍后'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  if (response === 1) {
    config.set({ skipVersion: result.latestVersion });
    return { ok: true, updateAvailable: true, version: result.latestVersion, message: `已跳过 ${result.latestVersion}` };
  }
  if (response !== 0) {
    return { ok: true, updateAvailable: true, version: result.latestVersion, message: '稍后再更新' };
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'whaledock-update-'));
  const checksumPath = path.join(tempDir, selection.checksumAsset.name);
  const installerPath = path.join(tempDir, selection.asset.name);
  try {
    log.line('app', `开始下载更新校验和：${selection.checksumAsset.name}`);
    await update.downloadFile(selection.checksumAsset.url, checksumPath, { maxBytes: 2 * 1024 * 1024 });
    const checksumText = await fs.promises.readFile(checksumPath, 'utf8');
    const expectedSha256 = update.checksumForAsset(checksumText, selection.asset.name);
    log.line('app', `开始下载 Windows 更新：${selection.asset.name}`);
    await update.downloadFile(selection.asset.url, installerPath, {
      expectedSha256,
      onProgress: ({ received, total, percent }) => {
        const progress = percent == null ? `${received} bytes` : `${percent.toFixed(1)}%`;
        log.line('app', `更新下载进度：${progress}${total ? ` / ${total} bytes` : ''}`);
      }
    });

    const confirmed = await showMessageBox({
      type: 'info',
      title: '更新已下载并校验',
      message: `WhaleDock ${result.latestVersion} 已准备好`,
      detail: '点击“重启并更新”后，鲸坞会退出并静默安装新版。',
      buttons: ['重启并更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (confirmed.response !== 0) {
      await removeUpdateTemp(tempDir);
      return { ok: true, updateAvailable: true, version: result.latestVersion, message: '已取消安装' };
    }

    // 用户可以在确认框停留很久，启动安装器前再校验一次，缩小本地替换窗口。
    await update.verifySha256(installerPath, expectedSha256);
    const installer = spawn(installerPath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    });
    await new Promise((resolve, reject) => {
      installer.once('spawn', resolve);
      installer.once('error', reject);
    });
    installer.unref();
    log.line('app', `已启动静默安装器：${installerPath}`);
    quitting = true;
    app.quit();
    return { ok: true, updateAvailable: true, version: result.latestVersion, message: '正在重启并更新' };
  } catch (error) {
    await removeUpdateTemp(tempDir);
    return offerManualUpdateFallback(result, error);
  }
}

async function performUpdateCheck(manual) {
  if (!config.get('checkUpdates')) {
    return { ok: false, disabled: true, message: '更新检查已关闭，未发出网络请求' };
  }
  const fetchImpl = updateFixtureFetch();
  const result = await update.checkForUpdate(app.getVersion(), {
    checkUpdates: config.get('checkUpdates'),
    skipVersion: config.get('skipVersion'),
    platform: process.platform,
    arch: process.arch,
    ...(fetchImpl ? { fetchImpl } : {})
  });
  if (!result.updateAvailable) {
    const message = result.skipped
      ? `已跳过版本 ${result.latestVersion}`
      : `当前已是最新版本（${result.currentVersion}）`;
    if (manual) await showMessageBox({ type: 'info', message, buttons: ['好'], noLink: true });
    return { ok: true, updateAvailable: false, version: result.latestVersion, message };
  }

  log.line('app', `发现新版 ${result.latestVersion}`);
  if (process.platform === 'win32' && !isPortableBuild()) {
    return downloadAndInstallWindowsUpdate(result);
  }
  return remindOnlyUpdate(result, process.platform === 'win32' && isPortableBuild());
}

function runUpdateCheck(manual) {
  if (!config.get('checkUpdates')) {
    const disabled = Promise.resolve({ ok: false, disabled: true, message: '更新检查已关闭，未发出网络请求' });
    if (manual) void showMessageBox({
      type: 'info',
      message: '更新检查已关闭',
      detail: '请先在“设置 → 通用”中打开“自动检查新版本”。',
      buttons: ['好'],
      noLink: true
    });
    return disabled;
  }
  if (updateCheckPromise) return updateCheckPromise;
  const run = performUpdateCheck(manual).catch(async (error) => {
    log.line('app', `检查更新失败：${error && error.stack || error}`);
    if (manual) await showMessageBox({
      type: 'error',
      message: '检查更新失败',
      detail: String(error && error.message || error),
      buttons: ['好'],
      noLink: true
    });
    return { ok: false, message: `检查更新失败：${error && error.message || error}` };
  });
  updateCheckPromise = run;
  const clear = () => { if (updateCheckPromise === run) updateCheckPromise = null; };
  void run.then(clear, clear);
  return run;
}

// ---------- 托盘 / 菜单 / 快捷键 ----------
function reportWorkspaceSwitchError(error, parentWindow) {
  const messages = {
    ERR_WORKSPACE_BUDGET_PAUSED: '今日预算暂停中，请先在任务看板确认“今日继续”。',
    ERR_WORKSPACE_EXTERNAL_ATTACH: '当前接入的是外部 dsh。鲸坞不会停止外部服务，因此未切换工作区。',
    ERR_WORKSPACE_RUNTIME_UNKNOWN: '当前后端归属无法证明，已按 fail-closed 拒绝切换。'
  };
  const detail = messages[error && error.code]
    || '切换未完整提交，鲸坞已尽力恢复原工作区。请查看日志。';
  const options = {
    type: 'error', message: '工作区切换失败', detail,
    buttons: ['好'], noLink: true
  };
  void (parentWindow && !parentWindow.isDestroyed()
    ? dialog.showMessageBox(parentWindow, options) : dialog.showMessageBox(options));
}

function workspaceSubmenuTemplate() {
  let surface;
  try { surface = currentWorkspaceSurface(); }
  catch (_error) {
    return [{ label: '工作区状态不可用', enabled: false }];
  }
  const switchTo = (target) => {
    void switchWorkspace(target).catch((error) => reportWorkspaceSwitchError(error, mainWindow));
  };
  return [
    { label: `当前：${surface.current.label}`, type: 'checkbox', checked: true, enabled: false },
    ...surface.recent.map((item) => ({ label: item.label, enabled: !surface.busy, click: () => switchTo(item.path) })),
    { type: 'separator' },
    {
      label: surface.busy ? '正在切换工作区…' : '打开新文件夹…',
      enabled: !surface.busy,
      click: () => {
        void chooseAndSwitchWorkspace(mainWindow).catch((error) => reportWorkspaceSwitchError(error, mainWindow));
      }
    }
  ];
}

function trayMenuTemplate() {
  return [
    ...(attentionCount > 0 ? [{ label: `${attentionCount} 个任务待查看`, enabled: false }] : []),
    { label: '显示 / 隐藏窗口', click: () => toggleWindow() },
    { label: '任务与用量看板…', click: () => openDashboardWindow() },
    { label: '截图与图片…', click: () => openCaptureWindow({ source: 'drop' }) },
    { label: '工作区', submenu: workspaceSubmenuTemplate() },
    { label: '桌面宠物', submenu: petSubmenuTemplate() },
    { label: '设置…', click: () => openSettingsWindow() },
    { label: '在浏览器中打开', click: () => shell.openExternal(baseUrl()) },
    { label: '检查更新…', click: () => { void runUpdateCheck(true); } },
    { type: 'separator' },
    { label: '重启后端', click: () => { void restartBackend(); } },
    { label: '打开日志文件夹', click: () => shell.openPath(log.dirPath()) },
    { label: '打开配置文件', click: () => shell.openPath(config.filePath()) },
    { type: 'separator' },
    { label: '退出鲸坞', click: () => { quitting = true; app.quit(); } }
  ];
}

// 托盘入口在鼠标穿透打开时仍然可用，避免宠物窗右键菜单点不到。
function petSubmenuTemplate() {
  const current = config.get();
  return [
    {
      label: '显示桌面宠物',
      type: 'checkbox',
      checked: current.petEnabled === true,
      click: () => { void applyPetSettings({ petEnabled: !current.petEnabled }); }
    },
    { type: 'separator' },
    ...(current.petEnabled ? petContextMenuTemplate().slice(0, -2) : []),
    { label: '打开宠物文件夹', click: () => { void openUserResourceDir('pets'); } }
  ];
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function createTray() {
  try {
    const iconName = isMac ? 'trayTemplate.png' : 'trayColor.png';
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', iconName));
    if (img.isEmpty()) return;
    img.setTemplateImage(isMac);
    tray = new Tray(img);
    tray.setToolTip('鲸坞 WhaleDock');
    refreshTrayMenu();
    if (!isMac) tray.on('click', () => toggleWindow());
  } catch (e) {
    log.line('app', 'tray 创建失败: ' + e.message);
  }
}

function createAppMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于鲸坞 WhaleDock' },
        { type: 'separator' },
        { label: '任务与用量看板…', click: () => openDashboardWindow() },
        { label: '截图与图片…', click: () => openCaptureWindow({ source: 'drop' }) },
        { label: '设置…', accelerator: 'Command+,', click: () => openSettingsWindow() },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: '退出鲸坞 WhaleDock' }
      ]
    }] : [{
      label: '文件',
      submenu: [
        { label: '任务与用量看板…', click: () => openDashboardWindow() },
        { label: '截图与图片…', click: () => openCaptureWindow({ source: 'drop' }) },
        { label: '设置…', click: () => openSettingsWindow() },
        { type: 'separator' },
        { label: '退出鲸坞', click: () => { quitting = true; app.quit(); } }
      ]
    }]),
    { label: '工作区', submenu: workspaceSubmenuTemplate() },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '刷新界面', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '后端',
      submenu: [
        { label: '重启后端', click: () => restartBackend() },
        { label: '在浏览器中打开', click: () => shell.openExternal(baseUrl()) },
        { type: 'separator' },
        { label: '打开日志文件夹', click: () => shell.openPath(log.dirPath()) },
        { label: '打开配置文件', click: () => shell.openPath(config.filePath()) }
      ]
    },
    { role: 'windowMenu', label: '窗口' },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        { label: '检查更新…', click: () => { void runUpdateCheck(true); } },
        { type: 'separator' },
        { label: 'DeepSeek Harness 官方仓库', click: () => shell.openExternal(UPSTREAM_URL) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerHotkeys() {
  try {
    const transaction = applyHotkeyBindings({}, config.get(), electronHotkeyRuntime());
    transaction.commit();
    log.line('app', '主窗口与截图快捷键事务注册成功');
  } catch (e) {
    log.line('app', `全局快捷键事务注册失败: ${e.message}`);
  }
}

async function restartBackend(options = {}) {
  if (workspaceJournalBlocksStartup()) {
    log.line('workspace', '活动 journal 尚未闭环，拒绝普通重启或停止现有后端');
    return false;
  }
  const externalAttach = backendReady && !spawnedByUs && backendState === null;
  if (!backendStartAllowed(budgetIsPaused(), options.allowBudgetResume === true) && !externalAttach) {
    log.line('app', '今日预算暂停中，拒绝重新拉起托管后端');
    openDashboardWindow();
    return false;
  }
  log.line('app', '重启后端…');
  await stopEventLayer('重启后端', { disconnect: true });
  backendReady = false;
  cancelBackendRecovery('用户手动重启后端');
  cancelForegroundStartup('用户手动重启后端');
  const inFlightStartup = startupPromise;

  const currentState = backendState;
  if (currentState) {
    await stopOwnedBackend(currentState, { reason: '用户重启清理当前后端' });
  }

  // 若重启发生在首次端口探测期间，旧启动流程可能稍后才 spawn；等它结束后再清一次。
  if (inFlightStartup) await inFlightStartup;
  const laterState = backendState;
  if (laterState && laterState !== currentState) {
    await stopOwnedBackend(laterState, { reason: '用户重启清理迟到后端' });
  }
  if (quitting) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
  if (!splash || splash.isDestroyed()) createSplash();
  else splash.show();
  await ensureBackendAndShow();
  return true;
}

async function retryBackendFromSplash() {
  cancelBackendRecovery('用户从启动页重试');
  cancelForegroundStartup('用户从启动页重试');
  log.line('app', '重试：强制刷新 PATH 探测缓存');
  backend.fullPath(true);
  const inFlightStartup = startupPromise;
  if (inFlightStartup) await inFlightStartup;
  if (!quitting) await ensureBackendAndShow();
}

function onSplashAction(_e, name) {
  if (name === 'retry') {
    void retryBackendFromSplash().catch((e) => {
      log.line('app', '重试失败: ' + (e && e.stack || e));
    });
  }
  else if (name === 'quit') { quitting = true; app.quit(); }
  else if (name === 'copy-logs') clipboard.writeText(log.recent() || '(暂无日志)');
  else if (name === 'open-logs') shell.openPath(log.dirPath());
  else if (name === 'open-settings') openSettingsWindow();
  else if (name === 'attach-anyway' && pendingAttachDecision) {
    const pending = pendingAttachDecision;
    pendingAttachDecision = null;
    pending.resolve('attach');
  }
}

// ---------- 生命周期 ----------
if (!MAIN_HELPER_TEST) {
  app.on('activate', () => showApp()); // 点 Dock 图标

  app.on('window-all-closed', () => {
    // 常驻托盘，不因窗口关闭而退出
  });

  app.on('before-quit', () => {
    quitting = true;
    clearUpdateSchedule();
    cancelBackendRecovery('App 正在退出');
    cancelForegroundStartup('App 正在退出');
    void beginEventShutdown().catch((error) => {
      log.line('events', `事件层退出清理失败：${error && error.code || 'unknown'}`);
    });
    void beginCaptureShutdown().catch((error) => {
      log.line('capture', `图片资源退出清理失败：${error && error.code || 'unknown'}`);
    });
    // 宠物窗只是本地视觉层，退出时直接销毁并停掉瞬时态定时器。
    closePetWindow();
  });

  app.on('will-quit', (e) => {
    globalShortcut.unregisterAll();
    if (backendState && spawnedByUs && !backendState.exited) {
      const st = backendState;
      void stopOwnedBackend(st, { reason: 'App 退出停止托管后端' }).catch((error) => {
        log.line('app', `退出时未确认托管后端停止：${error && error.code || 'unknown'}`);
      });
    }
    const pending = [
      ...pendingBackendStops,
      ...pendingWorkspaceOperations,
      ...(!eventShutdownComplete && eventShutdownPromise ? [eventShutdownPromise] : []),
      ...(!captureShutdownComplete && captureShutdownPromise ? [captureShutdownPromise] : [])
    ];
    if (pending.length) {
      e.preventDefault();
      void Promise.allSettled(pending).then(() => app.quit());
    }
  });
}

if (MAIN_HELPER_TEST) {
  module.exports = {
    dashboardSnapshot,
    reportRequest,
    reportPayload,
    trustedLocalEvent,
    createBoundedEventQueue,
    createPersistedEventBatcher,
    ingestLiveEvent,
    canStopForBudget,
    backendStartAllowed,
    workspaceJournalBlocksStartup,
    workspaceSurfaceSnapshot,
    applyHotkeyBindings,
    ocrScriptsRoot,
    captureDeliveryRequest,
    themeCssFor,
    buildPetPayload,
    petWindowBounds,
    THEME_VARIABLE_MAP,
    PET_PAYLOAD_MAX_BYTES
  };
}
