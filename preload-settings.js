'use strict';

// 设置窗专用桥接：只暴露固定 IPC，不向页面泄露 Electron。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whaleSettings', Object.freeze({
  get: () => ipcRenderer.invoke('settings:get'),
  apply: (patch) => ipcRenderer.invoke('settings:apply', patch),
  switchWorkspace: () => ipcRenderer.invoke('settings:switch-workspace'),
  restartBackend: () => ipcRenderer.invoke('settings:restart-backend'),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),
  // v0.5：只重扫受控目录并打开鲸坞自己的 userData 子目录，参数是固定枚举。
  rescanPets: () => ipcRenderer.invoke('settings:rescan-pets'),
  reloadThemes: () => ipcRenderer.invoke('settings:reload-themes'),
  openResourceDir: (kind) => ipcRenderer.invoke(
    'settings:open-resource-dir', kind === 'themes' ? 'themes' : 'pets'
  )
}));
