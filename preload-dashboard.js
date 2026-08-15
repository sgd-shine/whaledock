'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, listener) {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, snapshot) => listener(snapshot);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function reportRequest(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const taskKey = typeof source.taskKey === 'string' ? source.taskKey.slice(0, 128) : '';
  const theme = source.theme === 'light' ? 'light' : 'dark';
  const action = source.action === 'copy' ? 'copy' : 'save';
  return { taskKey, theme, action };
}

contextBridge.exposeInMainWorld('whaleDashboard', Object.freeze({
  get: () => ipcRenderer.invoke('dashboard:get'),
  onChanged: (listener) => subscribe('dashboard:state', listener),
  resume: () => ipcRenderer.invoke('dashboard:resume-budget'),
  export: (request) => ipcRenderer.invoke('dashboard:export-report', reportRequest(request)),
  showMain: () => ipcRenderer.invoke('dashboard:show-main')
}));
