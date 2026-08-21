'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// main.js 接线时必须使用：contextIsolation:true、nodeIntegration:false、sandbox:true。
// preload 只保留下列四条固定通道，不向 renderer 暴露 ipcRenderer 或任何文件能力。
const CHANNELS = Object.freeze({
  get: 'shooting:get',
  command: 'shooting:command',
  finish: 'shooting:finish',
  state: 'shooting:state'
});
const MODES = new Set(['checklist', 'teleprompter']);
const SPEEDS = new Set([0.6, 0.8, 1, 1.2, 1.5]);
const FONT_SIZES = new Set(['small', 'medium', 'large']);
const SHOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function requireShotId(value) {
  if (typeof value !== 'string' || !SHOT_ID.test(value)) {
    throw new TypeError('shotId 必须是有限的 opaque id');
  }
  return value;
}

function validateCommand(value) {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new TypeError('拍摄命令必须是有限对象');
  }
  switch (value.type) {
    case 'set-mode':
      if (!exactKeys(value, ['type', 'value']) || !MODES.has(value.value)) {
        throw new TypeError('set-mode 参数无效');
      }
      return { type: value.type, value: value.value };
    case 'set-playing':
      if (!exactKeys(value, ['type', 'value']) || typeof value.value !== 'boolean') {
        throw new TypeError('set-playing 参数无效');
      }
      return { type: value.type, value: value.value };
    case 'set-speed':
      if (!exactKeys(value, ['type', 'value']) || !SPEEDS.has(value.value)) {
        throw new TypeError('set-speed 参数无效');
      }
      return { type: value.type, value: value.value };
    case 'set-font-size':
      if (!exactKeys(value, ['type', 'value']) || !FONT_SIZES.has(value.value)) {
        throw new TypeError('set-font-size 参数无效');
      }
      return { type: value.type, value: value.value };
    case 'select-shot':
    case 'retry-shot':
      if (!exactKeys(value, ['type', 'shotId'])) {
        throw new TypeError(`${value.type} 参数无效`);
      }
      return { type: value.type, shotId: requireShotId(value.shotId) };
    case 'set-shot-complete':
      if (!exactKeys(value, ['type', 'shotId', 'value']) || typeof value.value !== 'boolean') {
        throw new TypeError('set-shot-complete 参数无效');
      }
      return { type: value.type, shotId: requireShotId(value.shotId), value: value.value };
    case 'set-gap':
      if (!exactKeys(value, ['type', 'shotId', 'value']) || typeof value.value !== 'string'
          || Array.from(value.value.trim()).length > 160
          || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.value)) {
        throw new TypeError('set-gap 参数无效');
      }
      return { type: value.type, shotId: requireShotId(value.shotId), value: value.value.trim() };
    default:
      throw new TypeError('未知拍摄命令');
  }
}

function onState(listener) {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => {
    try { listener(payload); } catch (_error) { /* 不影响后续状态推送 */ }
  };
  ipcRenderer.on(CHANNELS.state, wrapped);
  return () => ipcRenderer.removeListener(CHANNELS.state, wrapped);
}

contextBridge.exposeInMainWorld('whaleShooting', Object.freeze({
  getState: () => ipcRenderer.invoke(CHANNELS.get),
  command: (value) => ipcRenderer.invoke(CHANNELS.command, validateCommand(value)),
  finish: () => ipcRenderer.invoke(CHANNELS.finish),
  onState
}));
