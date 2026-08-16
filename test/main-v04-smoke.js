'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
const main = require('../main');
delete process.env.WHALEDOCK_MAIN_HELPER_TEST;

const root = path.join(__dirname, '..');
let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  main-v04: ${name}`);
}

function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

async function run() {
  await test('committed workspace surface 清理标题并保留有界 recent', async () => {
    const value = main.workspaceSurfaceSnapshot({
      current: {
        configuredPath: '/work/current', effectivePath: '/work/current',
        label: '\u0000 项目\nA '
      },
      recent: Array.from({ length: 15 }, (_item, index) => ({
        path: `/work/${index}`, label: `项目 ${index}`
      }))
    }, { generation: 7, busy: false });
    assert.equal(value.generation, 7);
    assert.equal(value.current.label, '项目 A');
    assert.equal(value.title, '鲸坞 WhaleDock — 项目 A');
    assert.equal(value.recent.length, 10);
    assert.equal(JSON.stringify(value).includes('\u0000'), false);
  });

  await test('双快捷键任一注册失败会恢复两个旧绑定', async () => {
    const active = new Map([
      ['CommandOrControl+Shift+H', 'main'],
      ['CommandOrControl+Shift+S', 'capture']
    ]);
    const calls = [];
    assert.throws(() => main.applyHotkeyBindings({
      hotkey: 'CommandOrControl+Shift+H', screenshotHotkeyEnabled: true,
      screenshotHotkey: 'CommandOrControl+Shift+S'
    }, {
      hotkey: 'CommandOrControl+Alt+H', screenshotHotkeyEnabled: true,
      screenshotHotkey: 'CommandOrControl+Alt+S'
    }, {
      unregister: (key) => { calls.push(`unregister:${key}`); active.delete(key); },
      register: (key, kind) => {
        calls.push(`register:${kind}:${key}`);
        if (key === 'CommandOrControl+Alt+S') return false;
        active.set(key, kind);
        return true;
      }
    }), /恢复旧快捷键/);
    assert.deepEqual([...active.entries()].sort(), [
      ['CommandOrControl+Shift+H', 'main'],
      ['CommandOrControl+Shift+S', 'capture']
    ]);
    assert(calls.includes('unregister:CommandOrControl+Alt+H'));
  });

  await test('快捷键事务可在 config 写失败后显式 rollback', async () => {
    const active = new Map();
    const runtime = {
      unregister: (key) => active.delete(key),
      register: (key, kind) => { active.set(key, kind); return true; }
    };
    runtime.register('OldMain', 'main');
    runtime.register('OldCapture', 'capture');
    const transaction = main.applyHotkeyBindings({
      hotkey: 'OldMain', screenshotHotkeyEnabled: true, screenshotHotkey: 'OldCapture'
    }, {
      hotkey: 'NewMain', screenshotHotkeyEnabled: true, screenshotHotkey: 'NewCapture'
    }, runtime);
    assert.deepEqual([...active.keys()].sort(), ['NewCapture', 'NewMain']);
    transaction.rollback();
    assert.deepEqual([...active.entries()].sort(), [
      ['OldCapture', 'capture'], ['OldMain', 'main']
    ]);
  });

  await test('capture delivery IPC 只接受有界枚举与临时 token', async () => {
    assert.deepEqual(main.captureDeliveryRequest({
      captureId: 'capture_01', action: 'send', targetToken: 'target_01'
    }), { captureId: 'capture_01', action: 'send', targetToken: 'target_01' });
    assert.deepEqual(main.captureDeliveryRequest({
      captureId: 'capture_01', action: 'copy'
    }), { captureId: 'capture_01', action: 'copy', targetToken: null });
    assert.throws(() => main.captureDeliveryRequest({
      captureId: 'capture_01', action: 'send', targetToken: 'x', text: 'renderer forged'
    }));
    assert.throws(() => main.captureDeliveryRequest({ captureId: '../bad', action: 'upload' }));
  });

  await test('启动先做 fresh config 与 journal recovery，再启 backend', async () => {
    const value = source('main.js');
    const ready = value.slice(value.indexOf('async function onReady()'), value.indexOf('function startManagedBackend'));
    assert(ready.indexOf('initializeWorkspaceConfig') >= 0);
    assert(ready.indexOf('recoverWorkspaceAtStartup') >= 0);
    assert(ready.indexOf('initializeWorkspaceConfig') < ready.indexOf('recoverWorkspaceAtStartup'));
    assert(ready.indexOf('recoverWorkspaceAtStartup') < ready.indexOf('ensureBackendAndShow'));
  });

  await test('唯一 coordinator 接线 runtime/budget/quiesce 与切换入口', async () => {
    const value = source('main.js');
    assert.equal((value.match(/createWorkspaceSwitchCoordinator\s*\(/g) || []).length, 1);
    assert.match(value, /getRuntime:\s*\(\)\s*=>\s*\(\{[\s\S]*backendReady[\s\S]*spawnedByUs[\s\S]*state:\s*backendState/);
    assert.match(value, /isBudgetPaused:\s*\(\)\s*=>\s*budgetIsPaused\(\)/);
    assert.match(value, /quiesceEvents:[\s\S]*stopEventLayer\([^\n]+flushBatch:\s*true/);
    assert.match(value, /workspaceCoordinator\.switchTo\(/);
    assert.match(value, /workspaceCoordinator\.recoverAtStartup\(\)/);
    assert.match(value, /backend\.proveManagedWorkdir\(/);
    assert.match(value, /workspaces\.canonicalWorkspace\(proof\.cwd,/);
    assert.match(value, /config\.protectedWorkspaceRoots\(/);
    assert.match(value, /ensureDefaultWorkspace\([\s\S]*?forbiddenRoots:\s*forbiddenWorkspaceRoots\(\)/);
    assert.match(value, /pendingWorkspaceOperations/);
    assert.match(value, /stopManaged:[\s\S]*?stopEventLayer\('\u5de5\u4f5c\u533a\u4e8b\u52a1\u505c\u6b62\u6258\u7ba1\u540e\u7aef'/);
    const startWorkspace = value.slice(value.indexOf('async function startWorkspaceBackend'), value.indexOf('async function launchCommittedWorkspaceEventLayer'));
    assert(!startWorkspace.includes('launchEventLayer('));
    assert.match(startWorkspace, /await stopOwnedBackend\(started/);
    assert(!/backendState\s*=\s*null[\s\S]*?await stopOwnedBackend\(started/.test(startWorkspace));
    const coordinator = value.slice(value.indexOf('function initializeWorkspaceCoordinator'), value.indexOf('function trackWorkspaceOperation'));
    assert.match(coordinator, /onCommit:[\s\S]*?await launchCommittedWorkspaceEventLayer\('工作区提交',\s*\{ expectedManaged: true \}\)/);
    assert.match(coordinator, /onRollback:[\s\S]*?await launchCommittedWorkspaceEventLayer\('工作区回滚',\s*\{ expectedManaged \}\)/);
    const committedEvent = value.slice(value.indexOf('async function launchCommittedWorkspaceEventLayer'), value.indexOf('function initializeWorkspaceCoordinator'));
    assert.match(committedEvent, /await launchEventLayer\(identity\)/);
    assert.match(committedEvent, /workspaceCommittedRecoveryPending\s*=\s*true/);
    const ownedStop = value.slice(value.indexOf('function stopOwnedBackend'), value.indexOf('async function waitForPendingBackendStops'));
    assert.match(ownedStop, /ERR_BACKEND_STOP_UNCONFIRMED/);
    assert(ownedStop.indexOf("if (state.exited !== true)") < ownedStop.indexOf('backendState = null'));
    assert(!value.includes('stopManagedBackend('));
    assert.equal(main.workspaceJournalBlocksStartup({ read: () => null }), false);
    assert.equal(main.workspaceJournalBlocksStartup({ read: () => ({ phase: 'config-applied' }) }), true);
    assert.equal(main.workspaceJournalBlocksStartup({ read: () => { throw new Error('bad schema'); } }), true);
    assert.match(startWorkspace, /startManagedBackend\(\{[\s\S]*?WORKSPACE_COORDINATOR_START_TOKEN/);
    assert.match(startWorkspace, /canonicalWorkspace\(proof\.cwd,\s*\{ forbiddenRoots \}\)/);
    assert.match(coordinator, /canonicalWorkspace\(value,\s*\{[\s\S]*?forbiddenRoots:\s*forbiddenWorkspaceRoots\(\)/);
    const foreground = value.slice(value.indexOf('async function ensureBackendAndShowOnce'), value.indexOf('function recoveryIsCurrent'));
    assert(foreground.indexOf('workspaceJournalBlocksStartup()') < foreground.indexOf('waitForPendingBackendStops()'));
    const recovery = value.slice(value.indexOf('async function recoverBackendInBackground'), value.indexOf('function onBackendExit'));
    assert(recovery.indexOf('workspaceJournalBlocksStartup()') < recovery.indexOf('recoveringBackend = true'));
    const restart = value.slice(value.indexOf('async function restartBackend'), value.indexOf('async function retryBackendFromSplash'));
    assert(restart.indexOf('workspaceJournalBlocksStartup()') < restart.indexOf("stopEventLayer('重启后端'"));
    const captureSave = value.slice(value.indexOf('async function confirmCaptureSave'), value.indexOf('async function deliverCapture'));
    assert.match(captureSave, /forbiddenRoots:\s*forbiddenWorkspaceRoots\(\)/);
    const backendExit = value.slice(value.indexOf('function onBackendExit'), value.indexOf('// ---------- \u7a97\u53e3'));
    assert.match(backendExit, /workspaceCoordinator\s*&&\s*workspaceCoordinator\.busy/);
    const switchBlock = value.slice(value.indexOf('async function switchWorkspace'), value.indexOf('async function chooseAndSwitchWorkspace'));
    assert.match(switchBlock, /finally\s*\{[\s\S]*?refreshWorkspaceSurfaces\(\)/);
  });

  await test('设置窗工作区只读且使用事务切换，截图快捷键可配置', async () => {
    const html = source('settings.html');
    const preload = source('preload-settings.js');
    assert.match(html, /id="workdir"[^>]*readonly/);
    assert.match(html, /id="screenshotHotkeyEnabled"/);
    assert.match(html, /id="screenshotHotkey"/);
    assert.match(preload, /switchWorkspace:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('settings:switch-workspace'\)/);
    assert(!/chooseWorkdir:\s*\(\)/.test(preload));
  });

  await test('capture 窗口使用 sandbox、精确 IPC 且拒绝导航', async () => {
    const value = source('main.js');
    const offset = value.indexOf('preload-capture.js');
    assert(offset > 0);
    const block = value.slice(offset - 320, offset + 1100);
    assert.match(block, /contextIsolation:\s*true/);
    assert.match(block, /nodeIntegration:\s*false/);
    assert.match(block, /sandbox:\s*true/);
    assert.match(block, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{ action: 'deny' \}\)\)/);
    assert.match(value, /trustedLocalEvent\([^,]+,\s*captureWindow,\s*captureFileUrl/);
  });

  await test('capture 页面 CSP/外置脚本/窄 preload 无远程资源', async () => {
    const html = source('capture.html');
    const renderer = source('capture.js');
    const preload = source('preload-capture.js');
    assert.match(html, /default-src 'self'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, />本地图片交付</);
    assert(!html.includes('Local image handoff'));
    assert.match(html, /<script src="capture\.js"><\/script>/);
    assert(!/<script(?!\s+src=)/.test(html));
    assert(!/(https?:\/\/|innerHTML)/.test(renderer));
    assert(!/contextBridge\.exposeInMainWorld\([^,]+,\s*ipcRenderer/.test(preload));
    assert(!/require\(['"](?:fs|child_process|shell|clipboard)['"]\)/.test(preload));
  });

  await test('capture renderer 首次回读真实代并用同一 captureId 取消', async () => {
    const html = source('capture.html');
    assert.match(html, /id="cancel"[^>]*disabled/);
    assert.match(source('main.js'), /if \(!captureState \|\| captureState\.captureId !== captureId\) throw new Error\('图片处理代已失效'\)/);
    const listeners = new Map();
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert(ids.includes('dropzone'));
    const elements = new Map(ids.map((id) => [id, {
      id,
      textContent: '',
      value: '',
      disabled: false,
      hidden: false,
      style: {},
      classList: { toggle() {} },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      replaceChildren() {},
      append() {},
      removeAttribute() {}
    }]));
    let cancelledId = null;
    let stateSubscriptions = 0;
    let getStateCalls = 0;
    const live = Object.freeze({
      stage: 'acquiring', captureId: 'capture_live_01', workspaceLabel: '真实工作区'
    });
    const api = {
      getState: async () => { getStateCalls += 1; return live; },
      onState: (listener) => {
        assert.equal(typeof listener, 'function');
        stateSubscriptions += 1;
        return () => {};
      },
      onInputError: () => () => {},
      cancel: async (captureId) => { cancelledId = captureId; return { ok: true }; },
      readClipboard: async () => ({}),
      confirmSave: async () => ({}),
      deliver: async () => ({}),
      showInFolder: async () => ({})
    };
    vm.runInNewContext(source('capture.js'), {
      window: { whaleCapture: api },
      document: {
        getElementById: (id) => elements.get(id),
        createElement: () => ({ value: '', textContent: '' })
      },
      console
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stateSubscriptions, 1);
    assert.equal(getStateCalls, 1);
    assert.equal(elements.get('workspace').textContent, '真实工作区');
    assert.equal(elements.get('cancel').disabled, false);
    await listeners.get('cancel:click')();
    assert.equal(cancelledId, 'capture_live_01');
  });

  await test('mac 只用 execFile screencapture，Windows 只引导并显式读剪贴板', async () => {
    const value = source('main.js');
    assert.match(value, /execFile\(plan\.file,\s*plan\.args/);
    assert.match(value, /Win\+Shift\+S/);
    assert.match(value, /capture:read-clipboard/);
    assert.match(value, /clipboard\.readImage\(\)/);
    assert(!/(keyTap|sendInput|robotjs|powershell.*Win\+Shift\+S)/i.test(value));
  });

  await test('nativeImage 解码后仍走像素限界与双确认', async () => {
    const value = source('main.js');
    assert.match(value, /nativeImage\.createFrom/);
    assert.match(value, /imageInput\.validateDecodedImage\(/);
    assert.match(value, /capture:confirm-save/);
    assert.match(value, /capture:deliver/);
    assert.match(value, /imageInput\.buildDeliveryText\(/);
    assert.match(value, /captureEpoch/);
    assert.match(value, /requireCaptureOwner\(owner\)/);
    const clipboardRead = value.slice(value.indexOf('async function readClipboardImage'), value.indexOf('function hiddenOwnedWindows'));
    assert(clipboardRead.indexOf('image.getSize()') < clipboardRead.indexOf('image.toPNG()'));
    const macRead = value.slice(value.indexOf('async function acquireMacScreenshot'), value.indexOf('function handleScreenshotHotkey'));
    assert(macRead.indexOf('lstat(planned.path)') < macRead.indexOf('readFile(planned.path)'));
    const dropRead = value.slice(value.indexOf('async function acquireDroppedFile'), value.indexOf('async function readClipboardImage'));
    assert.match(dropRead, /acquireDroppedFile\(filePath, owner\)/);
    assert((dropRead.match(/requireCaptureOwner\(owner\)/g) || []).length >= 3);
    assert.match(dropRead, /acquireImageBuffer\(value, 'drop', filePath, owner\)/);
    const captureIpc = value.slice(value.indexOf('function registerCaptureIpc'), value.indexOf('function beginCaptureShutdown'));
    assert.match(captureIpc, /const owner = currentCaptureOwner\(\);[\s\S]*?queueCaptureMutation\(\(\) => acquireDroppedFile\(filePath, owner\)\)/);
  });

  await test('主 Harness 仍无 preload/DOM 注入，capture 资源纳入 builder', async () => {
    const value = source('main.js');
    const openMain = value.slice(value.indexOf('function openMainWindow()'), value.indexOf('function showApp()'));
    assert(!/preload\s*:/.test(openMain));
    assert(!/(executeJavaScript|insertCSS|querySelector|innerHTML)/.test(openMain));
    const pkg = require('../package.json');
    // 版本号只在当前版本的直测里精确钉住；这里只保证形状合法。
    assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    for (const file of ['capture.html', 'capture.js', 'preload-capture.js']) {
      assert(pkg.build.files.includes(file), file);
    }
    assert(pkg.build.files.includes('assets/**/*'));
    const devRoot = path.resolve(root, 'fixture-dev-app');
    const resourcesRoot = path.resolve(root, 'fixture-resources');
    assert.equal(main.ocrScriptsRoot({ packaged: false, appDir: devRoot }),
      path.join(devRoot, 'assets', 'ocr'));
    assert.equal(main.ocrScriptsRoot({ packaged: true, resourcesPath: resourcesRoot }),
      path.join(resourcesRoot, 'ocr'));
    assert(pkg.build.extraResources.some((entry) => entry.from === 'assets/ocr'
      && entry.to === 'ocr' && entry.filter.includes('**/*')));
  });

  await test('退出会终止 capture/OCR、关闭 prompt adapter 并清 staging', async () => {
    const value = source('main.js');
    assert.match(value, /beginCaptureShutdown\(\)/);
    assert.match(value, /promptAdapter\.close\(\)/);
    assert.match(value, /imageInput\.cleanupOwnedStaging\(/);
    assert.match(value, /(?:screenshotProcess|captureChild)\.kill\(/);
    assert.match(value, /\.\.\.pendingWorkspaceOperations/);
    assert.match(value, /前台启动重试清理旧后端/);
    assert.match(value, /用户重启清理当前后端/);
    assert.match(value, /App 退出停止托管后端/);
    assert(!value.includes("path.join(os.homedir(), '.dsh'"));
  });

  console.log(`\nMAIN V04 ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN V04 FAIL:', error && error.stack || error);
  process.exit(1);
});
