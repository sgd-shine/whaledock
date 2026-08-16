'use strict';

// 宠物窗最小 preload：只暴露固定通道，不给渲染层任何 fs / 网络能力。
// 宠物包内容由主进程解析并以 data: URL 下发，渲染层永远拿不到本地路径。
const { contextBridge, ipcRenderer } = require('electron');

const petListeners = new Set();
const stateListeners = new Set();

function fanout(listeners, value) {
  for (const listener of listeners) {
    try { listener(value); } catch (_error) { /* 不影响其他监听者 */ }
  }
}

ipcRenderer.on('pet:package', (_event, value) => fanout(petListeners, value));
ipcRenderer.on('pet:state', (_event, value) => fanout(stateListeners, value));

contextBridge.exposeInMainWorld('whalePet', Object.freeze({
  ready: () => ipcRenderer.invoke('pet:ready'),
  contextMenu: () => ipcRenderer.invoke('pet:context-menu'),
  onPackage: (listener) => {
    if (typeof listener !== 'function') return () => {};
    petListeners.add(listener);
    return () => petListeners.delete(listener);
  },
  onState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }
}));
