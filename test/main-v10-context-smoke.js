'use strict';

// v0.10 A2.1 P0A：只验证主进程的 feature flag 与脱敏状态接线。
// 这里不冒充真实 bridge RPC、活动会话或 dsh 插件已连接证据。
process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const main = require('../main.js');
const contextBridgeModel = require('../lib/context-bridge');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v10-context: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  main-v10-context: ${name}`);
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

function bridgeFixture() {
  const calls = { create: 0, disconnect: [], surfaces: 0 };
  const model = {
    isContextPocEnabled: (env) => Boolean(
      env && env.WHALEDOCK_CONTEXT_POC === '1'
    ),
    createContextBridgeState: ({ enabled }) => {
      calls.create += 1;
      let snapshot = {
        contract: 'fixture-v1',
        enabled: enabled === true,
        connection: {
          state: enabled === true ? 'disconnected' : 'disabled',
          reason: enabled === true ? 'not-connected' : 'feature-disabled'
        },
        sessionCount: 0,
        secretPath: '/must/not/reach/renderer',
        sessionRef: 'must-not-reach-renderer'
      };
      return {
        disconnect: (reason) => {
          calls.disconnect.push(reason);
          snapshot = {
            ...snapshot,
            connection: { state: 'degraded', reason }
          };
          return snapshot;
        },
        snapshot: () => snapshot
      };
    },
    publicContextBridgeSurface: (value) => {
      calls.surfaces += 1;
      return {
        state: value.connection.state,
        reason: value.connection.reason,
        projectId: null,
        effectiveRevision: null,
        deliveredRevision: null,
        pendingRevision: null,
        frozen: false
      };
    }
  };
  return { calls, model };
}

async function run() {
  await check('flag 默认关闭且不初始化 bridge state', async () => {
    const fixture = bridgeFixture();
    for (const env of [
      {},
      { WHALEDOCK_CONTEXT_POC: '' },
      { WHALEDOCK_CONTEXT_POC: '0' },
      { WHALEDOCK_CONTEXT_POC: 'true' },
      { WHALEDOCK_CONTEXT_POC: ' 1 ' }
    ]) {
      const controller = main.createContextPocController({
        env,
        bridgeModel: fixture.model
      });
      assert.equal(controller.enabled, false);
      const runtime = {
        backendReady: true, spawnedByUs: true, state: { exited: false }
      };
      assert.equal(main.contextPocShellSurface(controller, runtime), null);
      const shellField = main.contextPocShellStateField(controller, runtime);
      assert.deepEqual(shellField, {});
      assert.equal(Object.prototype.hasOwnProperty.call(shellField, 'contextPoc'), false);
    }
    assert.equal(fixture.calls.create, 0, '关闭时不得创建 bridge state');
    assert.equal(fixture.calls.surfaces, 0, '关闭时不得制造可见状态');
  });

  await check('flag 仅精确 1 开启，P0A 无桥时如实降级', async () => {
    const fixture = bridgeFixture();
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' },
      bridgeModel: fixture.model
    });
    assert.equal(controller.enabled, true);
    assert.equal(fixture.calls.create, 1);
    const surface = main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: { exited: false, packageVersionProof: '0.1.1-rc.2' }
    });
    assert.deepEqual(surface, {
      state: 'degraded',
      reason: 'bridge-unavailable',
      projectId: null,
      effectiveRevision: null,
      deliveredRevision: null,
      pendingRevision: null,
      frozen: false
    });
    assert.equal(['registered', 'staged', 'delivered'].includes(surface.state), false);
    assert.deepEqual(main.contextPocShellStateField(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: { exited: false, packageVersionProof: '0.1.1-rc.2' }
    }), { contextPoc: surface });
  });

  await check('展示 version 不能冒充 package proof', async () => {
    const fixture = bridgeFixture();
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' },
      bridgeModel: fixture.model
    });
    const unproven = main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: { exited: false, version: '0.1.1-rc.2' }
    });
    assert.equal(unproven.reason, 'unsupported-version');

    const proven = main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        version: '仅供展示',
        packageVersionProof: '0.1.1-rc.2'
      }
    });
    assert.equal(proven.reason, 'bridge-unavailable');
  });

  await check('external 与 unavailable 只降级 context，不制造投递', async () => {
    for (const [runtime, reason] of [
      [{ backendReady: true, spawnedByUs: false, state: null }, 'external-unproven'],
      [{ backendReady: false, spawnedByUs: false, state: null }, 'bridge-unavailable'],
      [{ backendReady: true, spawnedByUs: true, state: { exited: true } }, 'bridge-unavailable']
    ]) {
      const fixture = bridgeFixture();
      const controller = main.createContextPocController({
        env: { WHALEDOCK_CONTEXT_POC: '1' },
        bridgeModel: fixture.model
      });
      const surface = main.contextPocShellSurface(controller, runtime);
      assert.equal(surface.state, 'degraded');
      assert.equal(surface.reason, reason);
      assert.equal(fixture.calls.disconnect.length, 0,
        '公开降级投影不得反向破坏同 Host 的内部 turn fence');
      assert.equal(['registered', 'staged', 'delivered'].includes(surface.state), false);
    }
  });

  await check('shell surface 必须经 lib/context-bridge 脱敏', async () => {
    const fixture = bridgeFixture();
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' },
      bridgeModel: fixture.model
    });
    const surface = main.contextPocShellSurface(controller, {
      backendReady: true, spawnedByUs: true, state: { exited: false }
    });
    assert.equal(fixture.calls.surfaces, 1);
    assert.equal(JSON.stringify(surface).includes('/must/not/reach/renderer'), false);
    assert.equal(JSON.stringify(surface).includes('must-not-reach-renderer'), false);
  });

  await check('真实 context-bridge 投影合同与 main 薄接线一致', async () => {
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' },
      bridgeModel: contextBridgeModel
    });
    assert.deepEqual(main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: false,
      state: null
    }), {
      state: 'degraded',
      reason: 'external-unproven',
      projectId: null,
      effectiveRevision: null,
      deliveredRevision: null,
      pendingRevision: null,
      frozen: false
    });
  });

  await check('flag 关闭不改现有 layout，context 降级也不控制 dsh view', async () => {
    assert.deepEqual(main.mainViewLayout({ width: 1280, height: 820 }), {
      mode: 'classic', visible: true,
      bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    const value = source('main.js');
    const contextBlock = block(
      value,
      'function createContextPocController',
      'function hotkeyBindings'
    );
    assert.doesNotMatch(contextBlock,
      /latestPromptTarget|stopOwnedBackend|backend\.stop|dshView|setBounds|setVisible|loadURL|executeJavaScript|insertCSS/);
    assert.equal(/ipcMain\.handle\(['"]shell:context/.test(value), false,
      'P0A 不得新增 context IPC');
    const dshView = block(value, '// dsh 的远程页面', 'let attempts = 0;');
    assert.match(dshView, /new WebContentsView\(\{[\s\S]*contextIsolation:\s*true,[\s\S]*nodeIntegration:\s*false/);
    const webPreferences = block(dshView, 'const view = new WebContentsView', 'dshView = view');
    assert.doesNotMatch(webPreferences, /preload|executeJavaScript|insertCSS/);
  });

  await check('shell 快照仅在 flag 开启时条件增加脱敏 contextPoc surface', async () => {
    const value = source('main.js');
    assert.match(value, /const contextBridgeModel = require\('\.\/lib\/context-bridge'\)/);
    const shellState = block(value, 'function shellStateSnapshot', 'function pushShellState');
    assert.match(shellState, /\.\.\.contextPocShellStateField\(/);
    assert.doesNotMatch(shellState, /contextPoc:\s*contextPocShellSurface\(/);
    const fieldHelper = block(
      value,
      'function contextPocShellStateField',
      'function hotkeyBindings'
    );
    assert.match(fieldHelper, /controller\.enabled !== true\) return Object\.freeze\(\{\}\)/);
    assert.doesNotMatch(shellState,
      /sessionRef|targetKey|workspaceKey|secretPath|effectivePath|prompt/);
    for (const match of value.matchAll(/packageVersionProof:/g)) {
      const proofUse = value.slice(match.index, match.index + 180);
      assert.doesNotMatch(
        proofUse,
        /(?:backendState|runtime\.state|monitor\.identity\.state)\.version\b/,
        '任何 package proof 调用都不得回退读取展示用 version'
      );
    }
  });

  console.log(failed === 0
    ? `\nMAIN V0.10 CONTEXT P0A ALL PASS (${passed})`
    : `\nMAIN V0.10 CONTEXT P0A ${failed} FAILED / ${passed} PASSED`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
