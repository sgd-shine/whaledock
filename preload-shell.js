'use strict';

// 主窗外壳专用桥接：只暴露固定 IPC，不向页面泄露 Electron。
// 这一页是 file:// 本地页，主进程用 trustedLocalEvent 做「同一 webContents + 主帧 + URL 精确匹配」三重校验；
// dsh 的远程页面在另一个 WebContentsView 里，那边没有 preload，拿不到这里的任何东西。
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const stateListeners = new Set();
const noticeListeners = new Set();

function emit(listeners, value) {
  for (const listener of listeners) {
    try { listener(value); } catch (_error) { /* 不影响其他监听者 */ }
  }
}

// 拖入安装：只取路径交给主进程，渲染层永远拿不到 webUtils 本身。
// 主进程负责判断它是不是目录、能不能装，这里不做任何文件系统判断。
async function acceptDrop(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const paths = [];
  for (const file of list.slice(0, 8)) {
    const value = webUtils.getPathForFile(file);
    if (typeof value === 'string' && value) paths.push(value);
  }
  if (!paths.length) {
    emit(noticeListeners, { kind: 'error', text: '没能取到拖进来的文件夹路径' });
    return;
  }
  const result = await ipcRenderer.invoke('shell:install', paths);
  emit(noticeListeners, result);
}

window.addEventListener('DOMContentLoaded', () => {
  let depth = 0;
  const setDrag = (on) => emit(noticeListeners, { kind: 'drag', dragging: on });
  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
    event.preventDefault();
    depth += 1;
    if (depth === 1) setDrag(true);
  });
  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDrag(false);
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    setDrag(false);
    void acceptDrop(event.dataTransfer && event.dataTransfer.files)
      .catch((error) => emit(noticeListeners, {
        kind: 'error',
        text: error && typeof error.message === 'string' ? error.message.slice(0, 240) : '安装失败'
      }));
  });
});

ipcRenderer.on('shell:state', (_event, value) => emit(stateListeners, value));
ipcRenderer.on('shell:notice', (_event, value) => emit(noticeListeners, value));

contextBridge.exposeInMainWorld('whaleShell', Object.freeze({
  getState: () => ipcRenderer.invoke('shell:get'),
  switchTo: (workbenchId) => ipcRenderer.invoke('shell:switch', workbenchId),
  removePack: (workbenchId) => ipcRenderer.invoke('shell:remove', workbenchId),
  runAction: (actionId) => ipcRenderer.invoke('shell:action', actionId),
  setCockpitView: (request) => ipcRenderer.invoke('shell:cockpit-view', request),
  openWorkspace: () => ipcRenderer.invoke('shell:open-workspace'),
  openSettings: () => ipcRenderer.invoke('shell:open-settings'),
  markOnboardingSeen: (workbenchId) => ipcRenderer.invoke('shell:onboarding-seen', workbenchId),
  onState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  onNotice: (listener) => {
    if (typeof listener !== 'function') return () => {};
    noticeListeners.add(listener);
    return () => noticeListeners.delete(listener);
  }
}));
