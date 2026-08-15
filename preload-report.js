'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on('report:render', wrapped);
  return () => ipcRenderer.removeListener('report:render', wrapped);
}

function readyReceipt(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ok: source.ok === true,
    theme: source.theme === 'light' ? 'light' : 'dark'
  };
}

contextBridge.exposeInMainWorld('whaleReport', Object.freeze({
  render: (listener) => subscribe(listener),
  ready: (receipt) => ipcRenderer.send('report:ready', readyReceipt(receipt))
}));
