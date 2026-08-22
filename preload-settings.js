'use strict';

// 设置窗专用桥接：只暴露固定 IPC，不向页面泄露 Electron。
const { contextBridge, ipcRenderer } = require('electron');

// 打开资源目录的参数是固定枚举，渲染层传别的一律夹回 pets。
const RESOURCE_DIRS = Object.freeze(['pets', 'themes', 'workbenches']);

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
    'settings:open-resource-dir', RESOURCE_DIRS.includes(kind) ? kind : 'pets'
  ),
  // v0.6 工作台包：列表、切换、移除都只走主进程，渲染层拿不到任何路径或提示词全文。
  listWorkbenches: () => ipcRenderer.invoke('settings:list-workbenches'),
  switchWorkbench: (workbenchId) => ipcRenderer.invoke('settings:switch-workbench', workbenchId),
  removeWorkbench: (workbenchId) => ipcRenderer.invoke('settings:remove-workbench', workbenchId),
  rescanWorkbenches: () => ipcRenderer.invoke('settings:rescan-workbenches'),
  // 飞书凭据是三条固定动作：保存、清除、自检。渲染层不能传通道名、路径或命令。
  saveFeishuCredentials: (value) => ipcRenderer.invoke('settings:remote-feishu-credentials-save', value),
  clearFeishuCredentials: () => ipcRenderer.invoke('settings:remote-feishu-credentials-clear'),
  testFeishuNotification: () => ipcRenderer.invoke('settings:remote-feishu-test-notification'),
  // v0.7 远程板块：一键断开是独立的受控动作，不接受通道名或任意命令。
  disconnectRemote: () => ipcRenderer.invoke('settings:remote-disconnect-all'),
  // 状态变化只订阅主进程固定的脱敏 runtime 快照；返回清理函数，窗口卸载即去重解绑。
  onRuntime: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('settings:runtime', listener);
    return () => ipcRenderer.removeListener('settings:runtime', listener);
  }
}));
