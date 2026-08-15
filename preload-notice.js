'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on('notice:show', wrapped);
  return () => ipcRenderer.removeListener('notice:show', wrapped);
}

contextBridge.exposeInMainWorld('whaleNotice', Object.freeze({
  show: (listener) => subscribe(listener),
  activate: () => ipcRenderer.invoke('notice:activate'),
  dismiss: () => ipcRenderer.invoke('notice:dismiss')
}));
