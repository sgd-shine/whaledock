'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const stateListeners = new Set();
const inputErrorListeners = new Set();

function emitInputError(error) {
  const message = error && typeof error.message === 'string'
    ? error.message.slice(0, 240) : '图片读取失败';
  for (const listener of inputErrorListeners) {
    try { listener(message); } catch (_error) { /* 不影响其他监听者 */ }
  }
}

async function acceptSingleDrop(files) {
  if (!files || files.length !== 1) throw new Error('一次只能拖入一张本地图片');
  const filePath = webUtils.getPathForFile(files[0]);
  if (!filePath) throw new Error('无法取得该本地图片的路径');
  await ipcRenderer.invoke('capture:accept-drop', filePath);
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    void acceptSingleDrop(event.dataTransfer && event.dataTransfer.files).catch(emitInputError);
  });
  document.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData && event.clipboardData.items || []);
    if (!items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
    event.preventDefault();
    void ipcRenderer.invoke('capture:read-clipboard', 'paste').catch(emitInputError);
  });
});

ipcRenderer.on('capture:state', (_event, value) => {
  for (const listener of stateListeners) {
    try { listener(value); } catch (_error) { /* 不影响其他监听者 */ }
  }
});

contextBridge.exposeInMainWorld('whaleCapture', Object.freeze({
  getState: () => ipcRenderer.invoke('capture:get'),
  readClipboard: () => ipcRenderer.invoke('capture:read-clipboard', 'explicit'),
  confirmSave: (captureId) => ipcRenderer.invoke('capture:confirm-save', captureId),
  deliver: (request) => ipcRenderer.invoke('capture:deliver', request),
  cancel: (captureId) => ipcRenderer.invoke('capture:cancel', captureId),
  showInFolder: (captureId) => ipcRenderer.invoke('capture:show-in-folder', captureId),
  onState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  onInputError: (listener) => {
    if (typeof listener !== 'function') return () => {};
    inputErrorListeners.add(listener);
    return () => inputErrorListeners.delete(listener);
  }
}));
