'use strict';
// 鲸坞 WhaleDock — 非官方 DeepSeek Harness 桌面客户端（原名 Harness Desktop）
// 职责：自动拉起本地 dsh 服务 → 原生窗口承载 Web UI → 托盘 / 全局快捷键 / 菜单

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  shell, ipcMain, dialog, clipboard, nativeImage, Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./lib/config');
const backend = require('./lib/backend');
const log = require('./lib/log');

app.setName('WhaleDock');

const isMac = process.platform === 'darwin';
const SMOKE = !!process.env.HARNESS_SMOKE; // 无头自测模式（CI/沙箱用）
const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness';
const BACKEND_RECOVERY_DELAYS_MS = [1000, 2000, 4000];
const BACKEND_RECOVERY_TIMEOUT_MS = 30 * 1000;

let mainWindow = null;
let splash = null;
let tray = null;
let backendState = null;
let spawnedByUs = false;
let quitting = false;
let startupPromise = null;
let startupGeneration = 0;
let recoveringBackend = false;
let backendRecoveryGeneration = 0;
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
  log.line('app', `${phase}: ${text}${detail ? ' — ' + detail : ''}`);
  sendSplash('status', { phase, text, detail });
  if (phase === 'error' && SMOKE) {
    console.log('SMOKE_FAIL: ' + text);
    app.exit(1);
  }
}

// ---------- 启动 ----------
async function onReady() {
  migrateLegacyConfig();
  config.init(app.getPath('userData'));
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.line('app', `鲸坞 WhaleDock v${app.getVersion()} 启动 (${process.platform}/${process.arch})`);

  if (SMOKE) setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 90 * 1000);

  ipcMain.on('splash-action', onSplashAction);
  createSplash();
  createTray();
  createAppMenu();
  registerHotkey();
  await ensureBackendAndShow();
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

function ensureBackendAndShow() {
  if (startupPromise) return startupPromise;
  const generation = ++startupGeneration;
  const run = ensureBackendAndShowOnce(generation);
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
}

async function ensureBackendAndShowOnce(generation) {
  try {
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
      status('attach', `检测到端口 ${port} 已有服务，直接接入`);
      return openMainWindow();
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

    status('ready', '服务已就绪，正在打开窗口…');
    openMainWindow();
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
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    void recoverBackendInBackground();
  }
}

// ---------- 窗口 ----------
function createSplash() {
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
  splash.loadFile('splash.html');
  splash.on('closed', () => {
    splash = null;
    // 主窗口还没出来就关掉启动页 = 用户想退出
    if (!mainWindow && !quitting) {
      quitting = true;
      app.quit();
    }
  });
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
    if (SMOKE) setTimeout(() => { console.log('SMOKE_OK'); app.exit(0); }, 1200);
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
  } else if (splash && !splash.isDestroyed()) {
    splash.show();
    splash.focus();
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

// ---------- 托盘 / 菜单 / 快捷键 ----------
function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
    if (img.isEmpty()) return;
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('鲸坞 WhaleDock');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏窗口', click: () => toggleWindow() },
      { label: '在浏览器中打开', click: () => shell.openExternal(baseUrl()) },
      { type: 'separator' },
      { label: '重启后端', click: () => restartBackend() },
      { label: '打开日志文件夹', click: () => shell.openPath(log.dirPath()) },
      { label: '打开配置文件', click: () => shell.openPath(config.filePath()) },
      { type: 'separator' },
      { label: '退出鲸坞', click: () => { quitting = true; app.quit(); } }
    ]));
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
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: '退出鲸坞 WhaleDock' }
      ]
    }] : []),
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
}

// ---------- 生命周期 ----------
app.on('activate', () => showApp()); // 点 Dock 图标

app.on('window-all-closed', () => {
  // 常驻托盘，不因窗口关闭而退出
});

app.on('before-quit', () => {
  quitting = true;
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
