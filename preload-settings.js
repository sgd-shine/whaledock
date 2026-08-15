'use strict';

// 设置窗专用桥接：只暴露固定 IPC，不向页面泄露 Electron。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whaleSettings', Object.freeze({
  get: () => ipcRenderer.invoke('settings:get'),
  apply: (patch) => ipcRenderer.invoke('settings:apply', patch),
  switchWorkspace: () => ipcRenderer.invoke('settings:switch-workspace'),
  restartBackend: () => ipcRenderer.invoke('settings:restart-backend'),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update')
}));
