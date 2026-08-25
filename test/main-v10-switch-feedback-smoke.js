'use strict';

// v0.10 批次 0：工作台/工作区切换必须立刻给可见反馈，并能从已经离线的
// 外部 attach 状态恢复。纯 Node 只验证状态判定与 Electron/renderer 接线；
// 真实窗口点击另留受控 GUI 证据，不能用本文件冒充。
process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const main = require('../main.js');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v10: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  main-v10: ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function block(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, `缺少起点：${start}`);
  assert.ok(to > from, `缺少终点：${end}`);
  return text.slice(from, to);
}

function functionBlock(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `缺少函数：${signature}`);
  const brace = text.indexOf('{', start);
  assert.ok(brace > start, `函数缺少左花括号：${signature}`);
  let depth = 0;
  for (let index = brace; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`函数缺少右花括号：${signature}`);
}

async function run() {
  await check('只有已确认的 external attach 且端口已离线才退休陈旧运行态', async () => {
    assert.equal(main.shouldRetireExternalAttach({
      backendReady: true, spawnedByUs: false, state: null
    }, false), true);
    assert.equal(main.shouldRetireExternalAttach({
      backendReady: true, spawnedByUs: false, state: null
    }, true), false);
    assert.equal(main.shouldRetireExternalAttach({
      backendReady: true, spawnedByUs: true, state: { exited: false }
    }, false), false, '鲸坞自己拉起的后端不能被 external 探针退休');
    assert.equal(main.shouldRetireExternalAttach({
      backendReady: false, spawnedByUs: false, state: null
    }, false), false);
  });

  await check('切换前先复核外部端口；离线只清鲸坞运行态，不停止未知进程', async () => {
    const value = source('main.js');
    const revalidate = block(
      value,
      'async function revalidateExternalAttachBeforeWorkspaceSwitch',
      'async function switchWorkspace'
    );
    assert.match(revalidate, /await confirmExternalAttachRetirement/);
    assert.match(revalidate, /backendReady = false/);
    assert.match(revalidate, /await stopEventLayer/);
    assert.doesNotMatch(revalidate, /stopOwnedBackend|backend\.stop|taskkill|SIGTERM|SIGKILL/);

    const coordinator = block(value, 'function initializeWorkspaceCoordinator', 'function trackWorkspaceOperation');
    assert.match(coordinator, /beforeSwitch:\s*\(\)\s*=>\s*revalidateExternalAttachBeforeWorkspaceSwitch\(\)/);
    const switching = block(value, 'async function switchWorkspace', 'async function chooseAndSwitchWorkspace');
    assert.doesNotMatch(switching, /revalidateExternalAttachBeforeWorkspaceSwitch/,
      '外部复核不得游离在 coordinator 串行边界之外');
  });

  await check('外部端口探针等待期间若后端身份已变，不误退休新身份', async () => {
    const captured = { backendReady: true, spawnedByUs: false, state: null };
    let current = captured;
    let resolveProbe;
    const probe = new Promise((resolve) => { resolveProbe = resolve; });
    const pending = main.confirmExternalAttachRetirement(captured, 3080, {
      isPortOpen: async () => probe,
      getRuntime: () => current,
      getPort: () => 3080
    });
    current = { backendReady: true, spawnedByUs: true, state: { exited: false } };
    resolveProbe(false);
    assert.equal(await pending, false);

    assert.equal(await main.confirmExternalAttachRetirement(captured, 3080, {
      isPortOpen: async () => false,
      getRuntime: () => captured,
      getPort: () => 3081
    }), false, '端口配置在探针期间变化也不能清理新运行态');

    assert.equal(await main.confirmExternalAttachRetirement(captured, 3080, {
      isPortOpen: async () => false,
      getRuntime: () => captured,
      getPort: () => 3080
    }), true);
  });

  await check('busy 来自权威协调器，不能被 v0.9 事件刷新写回 false', async () => {
    const snapshot = block(source('main.js'), 'function shellStateSnapshot', 'function pushShellState');
    assert.match(snapshot, /busy:\s*Boolean\(\(workspaceCoordinator\s*&&\s*workspaceCoordinator\.busy\)/);
    assert.doesNotMatch(snapshot, /busy:\s*false/);
  });

  await check('主窗点击先显示反馈再发 IPC，且成功、取消、失败都有终态文案', async () => {
    const renderer = source('shell.js');
    const switching = block(renderer, 'function switchTo(', '// ---------- onboarding');
    assert.ok(switching.indexOf('showToast(') < switching.indexOf('api.switchTo('));
    assert.ok(switching.indexOf('state.busy = true') < switching.indexOf('api.switchTo('));
    assert.match(switching, /result\.kind === 'error'/);
    assert.match(switching, /result\.kind === 'cancelled'/);
    assert.match(switching, /已切换到/);
    assert.match(switching, /api\.getState\(\)\.then\(applyState\)/);
    assert.match(renderer, /switchTo\(row\.id, row\.name\)/);
  });

  await check('可控 pending IPC 下进度文案立即出现且 3 秒时仍保持，settle 后切到终态', async () => {
    const renderer = source('shell.js');
    const switchSource = functionBlock(renderer, 'function switchTo(');
    const calls = [];
    let resolveSwitch;
    const pendingIpc = new Promise((resolve) => { resolveSwitch = resolve; });
    const context = {
      state: { busy: false },
      renderRail: () => calls.push(['render', context.state.busy]),
      showToast: (message, duration) => calls.push(['toast', message, duration]),
      api: {
        switchTo: () => {
          calls.push(['ipc']);
          return pendingIpc;
        },
        getState: async () => ({})
      },
      applyState: () => calls.push(['state-refresh'])
    };
    vm.runInNewContext(`${switchSource}\nthis.runSwitch = switchTo;`, context);
    const settling = context.runSwitch('builtin:test', '测试台');
    assert.deepEqual(calls.slice(0, 3), [
      ['render', true],
      ['toast', '正在切换到「测试台」…', 12000],
      ['ipc']
    ]);
    assert.equal(context.state.busy, true);
    assert.ok(calls[1][2] >= 3000, '进度提示的留存时间必须覆盖 3 秒验收点');
    await Promise.resolve();
    assert.equal(calls.filter((item) => item[0] === 'toast').length, 1,
      'IPC 未落定时不得提前用终态覆盖进度');
    resolveSwitch({ kind: 'ok' });
    await settling;
    assert.equal(calls.filter((item) => item[0] === 'toast').at(-1)[1], '已切换到「测试台」。');
    assert.equal(context.state.busy, false);
  });

  await check('经典台反馈留在 132px 自有左栏，不再画到 dsh WebContentsView 下方', async () => {
    const html = source('shell.html');
    assert.match(html, /<div id="toast" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
    const css = block(html, '#toast {', '#toast.open');
    assert.match(css, /left:\s*10px/);
    assert.match(css, /max-width:\s*calc\(var\(--rail\)\s*-\s*20px\)/);
    assert.doesNotMatch(css, /left:\s*calc\(var\(--rail\)/);
    assert.match(html, /body\.cockpit-active #toast\s*\{[^}]*left:\s*18px/);
  });

  await check('设置页的工作台与工作区切换也在调用前显示进行中', async () => {
    const settings = source('settings.html');
    const workbench = block(settings, "use.addEventListener('click'", 'actions.appendChild(use)');
    assert.ok(workbench.indexOf("setStatus('正在切换工作台") < workbench.indexOf('api.switchWorkbench('));
    assert.match(workbench, /result\.kind === 'cancelled'/);
    const workspace = block(settings, 'async function chooseWorkdir', 'async function restartBackend');
    assert.ok(workspace.indexOf("setStatus('正在选择并切换工作区") < workspace.indexOf('api.switchWorkspace()'));
    assert.match(workspace, /已取消工作区切换/);
  });

  await check('远程关闭时启动不触发安全仓；已启用时先绘制可见提示并可降级', async () => {
    assert.equal(main.shouldInitializeRemoteSecureState({ remoteFeishuEnabled: false }), false);
    assert.equal(main.shouldInitializeRemoteSecureState({ remoteFeishuEnabled: true }), true);
    const value = source('main.js');
    const ready = block(value, 'async function onReady()', 'function registerPetIpc');
    assert.ok(ready.indexOf('await showStartupSurfaceBeforeSecureStorage()')
      < ready.indexOf('initRemoteSecureState()'));
    const afterSurface = ready.slice(ready.indexOf('await showStartupSurfaceBeforeSecureStorage()'));
    assert.ok(afterSurface.indexOf('if (quitting) return;') < afterSurface.indexOf('initRemoteSecureState()'),
      '用户关掉早期启动页后不得再触发钥匙串');
    const afterSecure = afterSurface.slice(afterSurface.indexOf('initRemoteSecureState()'));
    assert.ok(afterSecure.indexOf('if (quitting) return;') < afterSecure.indexOf('initRemoteService()'),
      '安全仓返回时若已退出，不得重建远程服务');
    assert.match(ready, /shouldInitializeRemoteSecureState\(config\.get\(\),\s*secureStateExists\)/);
    assert.match(ready, /secure-store-deferred-while-disabled/);
    assert.match(ready, /try\s*\{\s*await syncRemoteConfig\(config\.get\(\)\)/);
    assert.match(ready, /远程通道初始化失败/);
    assert.ok(ready.indexOf('initRemoteService()') < ready.indexOf('await syncRemoteConfig(config.get())'));
  });

  await check('启动钥匙串失败和顶层 fatal 都会打开可见错误面', async () => {
    const value = source('main.js');
    const ready = block(value, 'async function onReady()', 'function registerPetIpc');
    assert.match(ready, /系统安全存储不可用/);
    const startup = block(value, '// ---------- 单实例 ----------', '// 从旧名');
    assert.match(startup, /status\('error', '鲸坞启动没有完成'/);
    assert.match(startup, /createSplash\(\)/);
  });

  console.log(failed === 0
    ? `\nMAIN V0.10 SWITCH FEEDBACK ALL PASS (${passed})`
    : `\nMAIN V0.10 SWITCH FEEDBACK ${failed} FAILED / ${passed} PASSED`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
