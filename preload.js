'use strict';
// 仅用于启动页 splash.html 的桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harness', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, payload) => cb(payload)),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  action: (name) => ipcRenderer.send('splash-action', name)
});
