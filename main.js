'use strict';
// Harness Desktop — 非官方 DeepSeek Harness macOS 桌面端
// 职责：自动拉起本地 dsh 服务 → 原生窗口承载 Web UI → 托盘 / 全局快捷键 / 菜单

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  shell, ipcMain, dialog, clipboard, nativeImage
} = require('electron');
const path = require('path');
const config = require('./lib/config');
const backend = require('./lib/backend');
const log = require('./lib/log');

app.setName('Harness Desktop');

const isMac = process.platform === 'darwin';
const SMOKE = !!process.env.HARNESS_SMOKE; // 无头自测模式（CI/沙箱用）
const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness';

let mainWindow = null;
let splash = null;
let tray = null;
let backendState = null;
let spawnedByUs = false;
let quitting = false;
let startingUp = false;

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
  config.init(app.getPath('userData'));
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.line('app', `Harness Desktop v${app.getVersion()} 启动 (${process.platform}/${process.arch})`);

  if (SMOKE) setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 90 * 1000);

  ipcMain.on('splash-action', onSplashAction);
  createSplash();
  createTray();
  createAppMenu();
  registerHotkey();
  await ensureBackendAndShow();
}

async function ensureBackendAndShow() {
  if (startingUp) return;
  startingUp = true;
  try {
    const port = config.get('port');
    status('checking', '正在检查本地 Harness 服务…');

    // 已有服务在跑（比如你在终端里自己启动了）→ 直接接入，不重复启动
    if (await backend.isPortOpen(port)) {
      spawnedByUs = false;
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

    status('spawning', '正在启动 Harness 引擎…', cmd.label);
    spawnedByUs = true;
    backendState = backend.start(config.get(), {
      onLine: (l) => { log.line('dsh', l); sendSplash('log', l); },
      onExit: (code) => onBackendExit(code)
    });

    status('waiting', '等待服务就绪…', '首次启动会自动下载组件，可能需要几分钟');
    const ok = await backend.waitForPort(port, {
      timeoutMs: 5 * 60 * 1000,
      shouldAbort: () => quitting || (backendState && backendState.exited),
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

    if (!ok) {
      if (backendState && backendState.exited) {
        status('error', 'Harness 启动失败（进程退出了）',
          '点「复制日志」，把内容发给 AI 或提 issue 排查');
      } else if (!quitting) {
        status('error', '等待服务超时', '网络较慢或端口配置不对，可以点「重试」');
      }
      return;
    }

    status('ready', '服务已就绪，正在打开窗口…');
    openMainWindow();
  } catch (e) {
    log.line('app', 'ensureBackend error: ' + (e && e.stack || e));
    status('error', '启动出错', String(e && e.message || e));
  } finally {
    startingUp = false;
  }
}

function onBackendExit(code) {
  log.line('app', `dsh 进程退出 code=${code}`);
  if (quitting || !spawnedByUs) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: 'Harness 后端进程退出了',
      detail: '可以试试重启后端；若反复出现，请通过菜单「后端 → 打开日志文件夹」查看日志。',
      buttons: ['重启后端', '忽略']
    }).then(({ response }) => {
      if (response === 0) restartBackend();
    });
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
  mainWindow = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 820,
    x: b.x,
    y: b.y,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Harness Desktop',
    backgroundColor: '#0b0f19',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  let attempts = 0;
  const tryLoad = () => {
    attempts += 1;
    mainWindow.loadURL(baseUrl()).catch(() => { /* did-fail-load 里处理 */ });
  };
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log.line('app', `页面加载失败(${code} ${desc})，第 ${attempts} 次`);
    if (attempts < 6 && !quitting) setTimeout(tryLoad, 1500);
    else status('error', '无法加载 Harness 界面', '后端可能没在预期端口上，试试菜单「后端 → 重启后端」');
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    closeSplash();
    if (SMOKE) setTimeout(() => { console.log('SMOKE_OK'); app.exit(0); }, 1200);
  });

  // 关窗口 = 收进托盘，不退出（Cmd+Q 才是真退出）
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  const saveBounds = () => {
    try { config.set({ bounds: mainWindow.getBounds() }); } catch (_e) { /* ignore */ }
  };
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);

  // 站内新窗口允许；外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl())) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
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
    tray.setToolTip('Harness Desktop');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏窗口', click: () => toggleWindow() },
      { label: '在浏览器中打开', click: () => shell.openExternal(baseUrl()) },
      { type: 'separator' },
      { label: '重启后端', click: () => restartBackend() },
      { label: '打开日志文件夹', click: () => shell.openPath(log.dirPath()) },
      { label: '打开配置文件', click: () => shell.openPath(config.filePath()) },
      { type: 'separator' },
      { label: '退出 Harness Desktop', click: () => { quitting = true; app.quit(); } }
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
        { role: 'about', label: '关于 Harness Desktop' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Harness Desktop' }
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
  if (backendState) {
    await backend.stop(backendState);
    backendState = null;
  }
  spawnedByUs = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
  if (!splash || splash.isDestroyed()) createSplash();
  else splash.show();
  await ensureBackendAndShow();
}

function onSplashAction(_e, name) {
  if (name === 'retry') ensureBackendAndShow();
  else if (name === 'quit') { quitting = true; app.quit(); }
  else if (name === 'copy-logs') clipboard.writeText(log.recent() || '(暂无日志)');
  else if (name === 'open-logs') shell.openPath(log.dirPath());
}

// ---------- 生命周期 ----------
app.on('activate', () => showApp()); // 点 Dock 图标

app.on('window-all-closed', () => {
  // 常驻托盘，不因窗口关闭而退出
});

app.on('before-quit', () => { quitting = true; });

app.on('will-quit', (e) => {
  globalShortcut.unregisterAll();
  if (backendState && spawnedByUs && !backendState.exited) {
    e.preventDefault();
    const st = backendState;
    backendState = null;
    backend.stop(st).then(() => app.quit());
  }
});
