'use strict';

// 设置窗专用桥接：只暴露方案约定的五条 IPC，不向页面泄露 Electron。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whaleSettings', Object.freeze({
  get: () => ipcRenderer.invoke('settings:get'),
  apply: (patch) => ipcRenderer.invoke('settings:apply', patch),
  chooseWorkdir: () => ipcRenderer.invoke('settings:choose-workdir'),
  restartBackend: () => ipcRenderer.invoke('settings:restart-backend'),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update')
}));
