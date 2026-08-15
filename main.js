'use strict';
// 鲸坞 WhaleDock — 非官方 DeepSeek Harness 桌面客户端（原名 Harness Desktop）
// 职责：自动拉起本地 dsh 服务 → 原生窗口承载 Web UI → 托盘 / 全局快捷键 / 菜单

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  shell, ipcMain, dialog, clipboard, nativeImage, Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const config = require('./lib/config');
const backend = require('./lib/backend');
const log = require('./lib/log');
const update = require('./lib/update');

app.setName('WhaleDock');

const isMac = process.platform === 'darwin';
const SMOKE = !!process.env.HARNESS_SMOKE; // 无头自测模式（CI/沙箱用）
const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness';
const MANUAL_URL = 'https://github.com/sgd-shine/whaledock/blob/main/docs/%E6%93%8D%E4%BD%9C%E6%89%8B%E5%86%8C.md';
const BACKEND_RECOVERY_DELAYS_MS = [1000, 2000, 4000];
const BACKEND_RECOVERY_TIMEOUT_MS = 30 * 1000;
const UPDATE_START_DELAY_MS = 15 * 1000;
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let mainWindow = null;
let splash = null;
let settingsWindow = null;
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

// ---------- 单实例 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showApp());
  app.whenReady().then(onReady).catch((e) => {
    log.line('app', 'fatal: ' + (e && e.stack || e));
    if (SMOKE) { console.log('SMOKE_FAIL: ' + e); app.exit(1); }
  });
}

// 从旧名 "Harness Desktop" 迁移配置（v0.1.1 改名鲸坞 WhaleDock，见 DECISIONS D10）
function migrateLegacyConfig() {
  try {
    const ud = app.getPath('userData');
    const legacyCfg = path.join(path.dirname(ud), 'Harness Desktop', 'config.json');
    const newCfg = path.join(ud, 'config.json');
    if (!fs.existsSync(newCfg) && fs.existsSync(legacyCfg)) {
      fs.mkdirSync(ud, { recursive: true });
      fs.copyFileSync(legacyCfg, newCfg);
    }
  } catch (_e) { /* 迁移失败不阻塞启动，走默认配置 */ }
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

// ---------- 启动 ----------
async function onReady() {
  migrateLegacyConfig();
  backend.setRuntimeInfo({
    execPath: process.execPath,
    resourcesPath: process.resourcesPath
  });
  config.init(app.getPath('userData'));
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.line('app', `鲸坞 WhaleDock v${app.getVersion()} 启动 (${process.platform}/${process.arch})`);
  initialStartMinimized = config.get('startMinimized') && !SMOKE;

  if (SMOKE) setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 90 * 1000);

  ipcMain.on('splash-action', onSplashAction);
  registerSettingsIpc();
  reconcileLoginItem();
  if (!initialStartMinimized) createSplash();
  else log.line('app', '启动最小化已启用：后台启动期间不创建启动页或主窗口');
  createTray();
  createAppMenu();
  registerHotkey();
  configureUpdateSchedule();
  await ensureBackendAndShow(!initialStartMinimized);
}

function startManagedBackend() {
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

function stopManagedBackend(state) {
  const pending = backend.stop(state);
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
      if (showWindow) return openMainWindow();
      closeSplash();
      log.line('app', '服务已就绪，保持最小化到托盘');
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
      backendState = null;
      spawnedByUs = false;
      log.line('app', '检测到旧后端仍存活，停止后再重试');
      await stopManagedBackend(staleState);
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
        log.line('app', `后台恢复：第 ${attempt}/${total} 次成功，端口已有服务`);
        reloadMainWindowAfterRecovery();
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

      if (attemptState && backendState === attemptState) {
        backendState = null;
        spawnedByUs = false;
      }
      if (attemptState && !attemptState.exited) {
        await stopManagedBackend(attemptState);
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
  if (state !== backendState) {
    log.line('app', '忽略已失去所有权的旧后端退出事件');
    return;
  }
  const wasSpawnedByUs = spawnedByUs;
  backendState = null;
  spawnedByUs = false;
  backendReady = false;
  if (quitting || !wasSpawnedByUs) return;
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
    if (!mainWindow && !settingsWindow && !quitting) {
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
    title: '鲸坞 WhaleDock',
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
  // Harness Web UI 会把页面标题设为 "DeepSeek Harness"；保留鲸坞原生窗口品牌。
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    if (!win.isDestroyed()) win.setTitle('鲸坞 WhaleDock');
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

function switchHotkey(previous, next) {
  if (previous === next) return;
  if (previous) globalShortcut.unregister(previous);
  let registered = false;
  try { registered = globalShortcut.register(next, () => toggleWindow()); } catch (_e) { registered = false; }
  if (registered) return;

  let restored = !previous;
  if (previous) {
    try { restored = globalShortcut.register(previous, () => toggleWindow()); } catch (_e) { restored = false; }
  }
  throw new Error(restored
    ? '该组合键被占用，已恢复原快捷键'
    : '该组合键被占用，且原快捷键恢复失败；请重启鲸坞');
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
    logsUrl: pathToFileURL(log.dirPath()).href
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
    'settings:get', 'settings:apply', 'settings:choose-workdir',
    'settings:restart-backend', 'settings:check-update'
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('settings:get', trustedSettingsHandler(async () => ({
    settings: settingsSnapshot(),
    runtime: settingsRuntime()
  })));

  ipcMain.handle('settings:apply', trustedSettingsHandler(async (patch) => {
    const before = config.get();
    const normalized = config.validateSettingsPatch(patch);
    const needsRestart = config.restartRequired(before, normalized);
    const hotkeyChanged = Object.prototype.hasOwnProperty.call(normalized, 'hotkey')
      && normalized.hotkey !== before.hotkey;
    const loginChanged = Object.prototype.hasOwnProperty.call(normalized, 'openAtLogin')
      && normalized.openAtLogin !== before.openAtLogin;
    let login = loginItemStatus();
    let loginError = '';

    if (hotkeyChanged) switchHotkey(before.hotkey, normalized.hotkey);
    if (loginChanged) {
      // loginItemStatus 的 desired 来自配置；先按新期望写系统，保存后再做真实回读。
      try { app.setLoginItemSettings(loginItemOptions(normalized.openAtLogin)); }
      catch (error) { loginError = error.message; }
    }

    try {
      config.set(normalized);
    } catch (error) {
      if (hotkeyChanged) {
        try { switchHotkey(normalized.hotkey, before.hotkey); } catch (rollbackError) {
          log.line('app', `配置写入失败后快捷键回滚也失败：${rollbackError.message}`);
        }
      }
      if (loginChanged) applyLoginItem(before.openAtLogin);
      throw error;
    }

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

  ipcMain.handle('settings:choose-workdir', trustedSettingsHandler(async () => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: '选择 Harness 工作目录',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0] || null;
  }));

  ipcMain.handle('settings:restart-backend', trustedSettingsHandler(async () => {
    await restartBackend();
    return { ok: true, message: '后端已重启' };
  }));

  ipcMain.handle('settings:check-update', trustedSettingsHandler(async () => {
    return runUpdateCheck(true);
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
  for (const win of [settingsWindow, mainWindow, splash]) {
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
function createTray() {
  try {
    const iconName = isMac ? 'trayTemplate.png' : 'trayColor.png';
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', iconName));
    if (img.isEmpty()) return;
    img.setTemplateImage(isMac);
    tray = new Tray(img);
    tray.setToolTip('鲸坞 WhaleDock');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏窗口', click: () => toggleWindow() },
      { label: '设置…', click: () => openSettingsWindow() },
      { label: '在浏览器中打开', click: () => shell.openExternal(baseUrl()) },
      { label: '检查更新…', click: () => { void runUpdateCheck(true); } },
      { type: 'separator' },
      { label: '重启后端', click: () => restartBackend() },
      { label: '打开日志文件夹', click: () => shell.openPath(log.dirPath()) },
      { label: '打开配置文件', click: () => shell.openPath(config.filePath()) },
      { type: 'separator' },
      { label: '退出鲸坞', click: () => { quitting = true; app.quit(); } }
    ]));
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
        { label: '设置…', click: () => openSettingsWindow() },
        { type: 'separator' },
        { label: '退出鲸坞', click: () => { quitting = true; app.quit(); } }
      ]
    }]),
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

function registerHotkey() {
  const hk = config.get('hotkey');
  if (!hk) return;
  try {
    const ok = globalShortcut.register(hk, () => toggleWindow());
    log.line('app', `全局快捷键 ${hk} 注册${ok ? '成功' : '失败（可能被占用）'}`);
  } catch (e) {
    log.line('app', `全局快捷键注册异常: ${e.message}`);
  }
}

async function restartBackend() {
  log.line('app', '重启后端…');
  backendReady = false;
  cancelBackendRecovery('用户手动重启后端');
  cancelForegroundStartup('用户手动重启后端');
  const inFlightStartup = startupPromise;

  const currentState = backendState;
  backendState = null;
  spawnedByUs = false;
  if (currentState && !currentState.exited) {
    await stopManagedBackend(currentState);
  }

  // 若重启发生在首次端口探测期间，旧启动流程可能稍后才 spawn；等它结束后再清一次。
  if (inFlightStartup) await inFlightStartup;
  const laterState = backendState;
  backendState = null;
  spawnedByUs = false;
  if (laterState && laterState !== currentState && !laterState.exited) {
    await stopManagedBackend(laterState);
  }
  if (quitting) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
  if (!splash || splash.isDestroyed()) createSplash();
  else splash.show();
  await ensureBackendAndShow();
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
app.on('activate', () => showApp()); // 点 Dock 图标

app.on('window-all-closed', () => {
  // 常驻托盘，不因窗口关闭而退出
});

app.on('before-quit', () => {
  quitting = true;
  clearUpdateSchedule();
  cancelBackendRecovery('App 正在退出');
  cancelForegroundStartup('App 正在退出');
});

app.on('will-quit', (e) => {
  globalShortcut.unregisterAll();
  if (backendState && spawnedByUs && !backendState.exited) {
    const st = backendState;
    backendState = null;
    spawnedByUs = false;
    void stopManagedBackend(st);
  }
  const pending = [...pendingBackendStops];
  if (pending.length) {
    e.preventDefault();
    void Promise.allSettled(pending).then(() => app.quit());
  }
});
