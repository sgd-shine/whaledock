'use strict';

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
process.env.WHALEDOCK_CONTEXT_POC = '1';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const main = require('../main.js');
const bridge = require('../lib/context-bridge');
const cockpit = require('../lib/video-cockpit');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v10-context-p0b: ${name}`);
  } catch (error) {
    console.error(`FAIL  main-v10-context-p0b: ${name}`);
    throw error;
  }
}

function handshake() {
  return {
    contract: bridge.CONTRACT_VERSION,
    hostInstanceId: 'host-12345678',
    capabilities: [...bridge.CAPABILITIES]
  };
}

async function mainTest() {
  await test('只有受管 mounted backend 的 dsh URL 才携带 controller 与限域选择能力', async () => {
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' }, bridgeModel: bridge
    });
    const origin = 'http://127.0.0.1:3080';
    const managed = main.contextPocHarnessUrl(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        contextBridgeMounted: true,
        contextBridgeSelectionToken: 'ab'.repeat(32)
      }
    }, origin);
    const parsed = new URL(managed);
    assert.equal(parsed.origin, origin);
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    assert.equal(fragment.get('whaledockController'), controller.controllerId);
    assert.equal(fragment.get('whaledockSelectionToken'), 'ab'.repeat(32));
    assert.equal(parsed.search, '', 'selection capability 不得进入 HTTP query');
    assert.equal(managed.includes('authToken'), false);
    assert.equal(managed.includes('BRIDGE_TOKEN'), false);
    assert.equal(main.contextPocHarnessUrl(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: { exited: false, contextBridgeMounted: true }
    }, origin), origin, '缺选择能力时不得激活 Client reporter');
    assert.equal(main.contextPocHarnessUrl(controller, {
      backendReady: true, spawnedByUs: false, state: null
    }, origin), origin);
    assert.equal(main.contextPocHarnessUrl({ enabled: false }, {
      backendReady: true, spawnedByUs: true,
      state: { exited: false, contextBridgeMounted: true }
    }, origin), origin);
  });

  await test('tryLoad/手动刷新/后台恢复共用受管 fence，缺能力时 loadURL=0', async () => {
    const loaded = [];
    const stateStore = new WeakMap();
    let currentUrl = 'http://127.0.0.1:3080/session/current?native=preserved#cleared';
    const view = {
      webContents: {
        isDestroyed: () => false,
        getURL: () => currentUrl,
        async loadURL(value) { loaded.push(value); currentUrl = value; }
      }
    };
    const controller = { enabled: true, controllerId: 'controller-refresh01' };
    const firstBackend = {
      exited: false,
      contextBridgeMounted: true,
      contextBridgeSelectionToken: 'ab'.repeat(32)
    };
    const firstRuntime = {
      backendReady: true,
      spawnedByUs: true,
      state: firstBackend,
      generation: 11
    };
    const options = {
      owned: true,
      transition: 'initial',
      controller,
      runtime: firstRuntime,
      stateStore,
      fallbackOrigin: 'http://127.0.0.1:3080/',
      onBlocked() { throw new Error('valid managed load must not block'); }
    };
    assert.equal(await main.reloadHarnessView(view, options), true,
      '初载必须经 fence 签发');
    assert.equal(await main.reloadHarnessView(view, { ...options, transition: null }), true,
      '菜单刷新必须复用已受管模式');
    assert.equal(loaded.length, 2, '每次刷新都必须重新签发 capability');
    assert.equal(loaded.every((value) => value.includes('whaledockSelectionToken=')), true);
    assert.equal(new URL(loaded[0]).pathname, '/session/current');
    assert.equal(new URL(loaded[0]).search, '?native=preserved');
    assert.deepEqual(stateStore.get(view), {
      mode: 'managed', backendState: firstBackend, generation: 11
    }, 'WeakMap 必须保留 mode/backend identity/generation');

    let blocked = 0;
    const unavailableRuntime = {
      ...firstRuntime,
      state: { ...firstBackend, contextBridgeSelectionToken: null }
    };
    assert.equal(await main.reloadHarnessView(view, {
      ...options,
      transition: null,
      runtime: unavailableRuntime,
      onBlocked() { blocked += 1; }
    }), false);
    assert.equal(blocked, 1);
    assert.equal(loaded.length, 2,
      '已受管 view 当前不能签发时必须 loadURL=0，不得降成 plain');
    assert.equal(stateStore.get(view).mode, 'managed');

    const recoveredBackend = {
      exited: false,
      contextBridgeMounted: true,
      contextBridgeSelectionToken: 'cd'.repeat(32)
    };
    assert.equal(await main.reloadHarnessView(view, {
      ...options,
      transition: 'runtime',
      runtime: {
        backendReady: true, spawnedByUs: true, state: recoveredBackend, generation: 12
      }
    }), true, '后台恢复应使用新 backend identity 重签');
    assert.equal(loaded.length, 3);
    assert.equal(new URLSearchParams(new URL(loaded[2]).hash.slice(1))
      .get('whaledockSelectionToken'), 'cd'.repeat(32));
    assert.deepEqual(stateStore.get(view), {
      mode: 'managed', backendState: recoveredBackend, generation: 12
    });

    assert.equal(await main.reloadHarnessView(view, {
      ...options,
      transition: 'runtime',
      runtime: { backendReady: true, spawnedByUs: false, state: null, generation: 13 }
    }), true, '只有 main 明确的 external runtime transition 才可重置受管模式');
    assert.equal(stateStore.get(view).mode, 'external');
    assert.equal(new URL(loaded.at(-1)).hash, '');

    const blockedInitialLoads = [];
    const blockedInitialStore = new WeakMap();
    const blockedInitialView = {
      webContents: {
        isDestroyed: () => false,
        getURL: () => '',
        async loadURL(value) { blockedInitialLoads.push(value); }
      }
    };
    assert.equal(await main.reloadHarnessView(blockedInitialView, {
      ...options,
      stateStore: blockedInitialStore,
      runtime: unavailableRuntime,
      onBlocked() { blocked += 1; }
    }), false, '初载已选择 managed 但缺 token 也必须 fail-closed');
    assert.equal(blockedInitialLoads.length, 0);
    assert.equal(blockedInitialStore.get(blockedInitialView).mode, 'managed');

    const externalLoads = [];
    const externalStore = new WeakMap();
    const externalView = {
      webContents: {
        isDestroyed: () => false,
        getURL: () => '',
        async loadURL(value) { externalLoads.push(value); }
      }
    };
    assert.equal(await main.reloadHarnessView(externalView, {
      ...options,
      stateStore: externalStore,
      runtime: { backendReady: true, spawnedByUs: false, state: null, generation: 1 }
    }), true, '明确 external 初载仍保持原生 dsh');
    assert.equal(externalStore.get(externalView).mode, 'external');
    assert.equal(new URL(externalLoads[0]).hash, '');

    assert.equal(main.contextPocReloadOrigin(
      'http://malicious.invalid/path?token=1', 'http://127.0.0.1:3080/'
    ), 'http://127.0.0.1:3080/', '跨源当前页不得进入刷新 URL');

    const sourceValue = source('main.js');
    const menu = sourceValue.slice(
      sourceValue.indexOf("label: '刷新界面'"),
      sourceValue.indexOf("{ role: 'toggleDevTools'", sourceValue.indexOf("label: '刷新界面'"))
    );
    assert.match(menu, /reloadHarnessView\(\)/);
    assert.doesNotMatch(menu, /\.reload\(\)/);
    const recovery = sourceValue.slice(
      sourceValue.indexOf('function reloadMainWindowAfterRecovery()'),
      sourceValue.indexOf('function showBackendRecoveryFailureFallback')
    );
    assert.match(recovery, /reloadHarnessView\(dshView, \{ transition: 'runtime' \}\)/,
      '后台恢复也必须重新签发一次性 fragment capability');
    assert.match(recovery, /后台恢复后重载界面失败（详情已脱敏）/);
    assert.doesNotMatch(recovery, /\.message|String\(|loadURL\(|harnessViewUrl\(/,
      '恢复失败日志不得拼接可能含完整 URL 的导航异常');
  });

  await test('已受管 dshView 的同源主框架导航必须重签，不能静默降成 unmanaged', async () => {
    const token = 'ab'.repeat(32);
    const controller = { enabled: true, controllerId: 'controller-navigation1' };
    const runtime = {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        contextBridgeMounted: true,
        contextBridgeSelectionToken: token
      }
    };
    const baseOrigin = 'http://127.0.0.1:3080/';
    const currentUrl = 'http://127.0.0.1:3080/session/current?native=preserved';
    const unsignedTarget = 'http://127.0.0.1:3080/session/next?native=kept';
    const resign = main.contextPocManagedNavigationDecision({
      owned: true,
      managed: true,
      isMainFrame: true,
      isSameDocument: false,
      currentUrl,
      targetUrl: unsignedTarget,
      baseOrigin,
      controller,
      runtime
    });
    assert.equal(resign.action, 'resign');
    assert.equal(new URL(resign.url).pathname, '/session/next');
    assert.equal(new URL(resign.url).search, '?native=kept');
    assert.equal(main.contextPocNavigationFragmentValid(resign.url, controller, runtime), true);

    const allowed = main.contextPocManagedNavigationDecision({
      owned: true,
      managed: true,
      isMainFrame: true,
      isSameDocument: false,
      currentUrl,
      targetUrl: resign.url,
      baseOrigin,
      controller,
      runtime
    });
    assert.deepEqual(allowed, { action: 'allow', url: null });
    const staleFragment = new URL(resign.url);
    staleFragment.hash = `whaledockController=${controller.controllerId}`
      + `&whaledockSelectionToken=${'cd'.repeat(32)}`;
    const rotated = main.contextPocManagedNavigationDecision({
      owned: true,
      managed: true,
      isMainFrame: true,
      isSameDocument: false,
      currentUrl,
      targetUrl: staleFragment.href,
      baseOrigin,
      controller,
      runtime
    });
    assert.equal(rotated.action, 'resign', '旧 token 不能冒充合法 fragment');
    assert.equal(main.contextPocNavigationFragmentValid(
      `${resign.url}&extra=1`, controller, runtime
    ), false, '合法 fragment 必须是精确双字段');

    for (const overrides of [
      { owned: false },
      { managed: false },
      { isMainFrame: false },
      { isSameDocument: true },
      { targetUrl: 'https://example.invalid/' },
      { currentUrl: 'https://example.invalid/' }
    ]) {
      assert.equal(main.contextPocManagedNavigationDecision({
        owned: true,
        managed: true,
        isMainFrame: true,
        isSameDocument: false,
        currentUrl,
        targetUrl: unsignedTarget,
        baseOrigin,
        controller,
        runtime,
        ...overrides
      }).action, 'ignore', '非自有/非受管/非同源/非主框架不应被重签');
    }
    const unavailable = main.contextPocManagedNavigationDecision({
      owned: true,
      managed: true,
      isMainFrame: true,
      isSameDocument: false,
      currentUrl,
      targetUrl: unsignedTarget,
      baseOrigin,
      controller,
      runtime: { ...runtime, state: { ...runtime.state, contextBridgeSelectionToken: null } }
    });
    assert.deepEqual(unavailable, { action: 'block', url: null },
      '已受管页面当前无法签发时必须阻止导航');

    const value = source('main.js');
    const windowBlock = value.slice(
      value.indexOf('function openMainWindow()'),
      value.indexOf('function layoutMainWindow()')
    );
    assert.match(windowBlock, /contextPocManagedViews\.get\(view\)\?\.mode === 'managed'/);
    assert.match(value, /const contextPocManagedViews = new WeakMap\(\)/,
      '受管 view 必须保留显式 mode/backend identity/generation');
    assert.match(windowBlock, /contextPocManagedNavigationDecision\(\{/);
    assert.match(windowBlock,
      /decision\.action === 'resign' \|\| decision\.action === 'block'[\s\S]*event\.preventDefault\(\)/);
    assert.match(windowBlock, /view\.webContents\.loadURL\(decision\.url\)/);
    assert.match(windowBlock, /if \(managedNavigationResignPending\) return;/,
      '重签进行中必须去重，避免 reload 循环');
    assert.match(value,
      /context-poc navigation stage=resign reason=capability-unavailable action=blocked/);
    assert.match(value, /受管对话页面未能刷新安全凭据，本次重新加载已阻止/);
    assert.match(windowBlock, /warnContextPocManagedNavigationBlocked\(\)/);
    assert.doesNotMatch(value,
      /navigation stage=resign[^\n]*(?:targetUrl|selectionToken|controllerId|\.message)/,
      '阻断日志不得拼接 URL、token、controller 或异常正文');
  });

  await test('握手、binding 与有序事件批在进入 P0A 前严格校验', async () => {
    const rawHandshake = {
      ok: true,
      type: 'handshake',
      protocol: bridge.CONTRACT_VERSION,
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: 'host-12345678',
      capabilities: [...bridge.CAPABILITIES, 'ordered-events']
    };
    assert.deepEqual(main.contextPocHandshakeValue(rawHandshake), {
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: 'host-12345678',
      capabilities: [...bridge.CAPABILITIES, 'ordered-events']
    });
    assert.equal(main.contextPocHandshakeValue({ ...rawHandshake, extra: true }), null);

    const controller = { controllerId: 'controller-12345678' };
    const runtime = { handshake: handshake(), cursor: 0 };
    const selected = main.contextPocBindingValue({
      state: 'selected',
      hostInstanceId: 'host-12345678',
      sessionRef: `session-${'a'.repeat(64)}`,
      code: null,
      controllerId: controller.controllerId,
      pageInstanceId: 'page-123456789012',
      selectionRevision: 1
    }, runtime, controller);
    assert.equal(selected.sessionRef, `session-${'a'.repeat(64)}`);
    assert.equal(main.contextPocBindingValue({
      state: 'selected',
      hostInstanceId: 'host-12345678',
      sessionRef: `session-${'a'.repeat(64)}`,
      code: null,
      controllerId: 'controller-wrong000',
      pageInstanceId: 'page-123456789012',
      selectionRevision: 1
    }, runtime, controller), null);

    const batch = {
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: 'host-12345678',
      oldestEventSeq: 1,
      throughEventSeq: 2,
      resyncRequired: false,
      events: [
        {
          contract: bridge.CONTRACT_VERSION,
          hostInstanceId: 'host-12345678',
          eventSeq: 1,
          type: 'turn-start',
          controllerId: controller.controllerId,
          sessionRef: `session-${'a'.repeat(64)}`,
          turn: 1,
          frozenRevision: 1
        },
        {
          contract: bridge.CONTRACT_VERSION,
          hostInstanceId: 'host-12345678',
          eventSeq: 2,
          type: 'turn-end',
          controllerId: controller.controllerId,
          sessionRef: `session-${'a'.repeat(64)}`,
          turn: 1
        }
      ]
    };
    assert.equal(main.contextPocEventsValue(batch, runtime), batch);
    assert.equal(main.contextPocEventsValue({
      ...batch,
      events: [{ ...batch.events[0], eventSeq: 2 }]
    }, runtime), null);
    assert.equal(main.contextPocEventsValue({ ...batch, unknown: true }, runtime), null);

    const envelope = {
      contract: bridge.CONTRACT_VERSION,
      clientInstanceId: 'client-12345678',
      hostInstanceId: 'host-12345678',
      sessionRef: `session-${'a'.repeat(64)}`,
      revision: 1,
      project: {
        projectId: `wdp1_${'1'.repeat(32)}`,
        relativePath: '.',
        workbenchId: 'builtin:video',
        title: '视频项目',
        projectRevision: null
      }
    };
    const duplicate = {
      accepted: true,
      state: 'duplicate',
      eventSeq: 4,
      ack: {
        contract: bridge.CONTRACT_VERSION,
        clientInstanceId: envelope.clientInstanceId,
        hostInstanceId: envelope.hostInstanceId,
        sessionRef: envelope.sessionRef,
        revision: envelope.revision,
        state: 'effective'
      }
    };
    assert.equal(main.contextPocStageResponseValue(duplicate, runtime, envelope), duplicate);
    assert.equal(main.contextPocStageResponseValue({
      accepted: true, state: 'duplicate', eventSeq: 4
    }, runtime, envelope), null);
    assert.equal(main.contextPocStageResponseValue({
      ...duplicate, ack: { ...duplicate.ack, revision: 2 }
    }, runtime, envelope), null);
  });

  await test('UI preferences 校验、配置落盘与 sync/settle 失败均不破坏 context core', async () => {
    assert.equal(main.CONTEXT_POC_PREFERENCE_WRITE_MARGIN_MS, 500);
    assert.deepEqual(main.contextPocPreferencePatchValue({
      contentViewMode: 'sessions', contentViewHintSeen: true
    }), { contentViewMode: 'sessions', contentViewHintSeen: true });
    assert.equal(main.contextPocPreferencePatchValue({}), null);
    assert.equal(main.contextPocPreferencePatchValue({ contentViewMode: 'invalid' }), null);
    assert.equal(main.contextPocPreferencePatchValue({ token: 'secret' }), null);
    assert.equal(main.contextPocPreferenceSnapshotValue({
      revision: 1_000_000_000,
      contentViewMode: 'content',
      contentViewHintSeen: false
    }).revision, 1_000_000_000);
    assert.equal(main.contextPocPreferenceSnapshotValue({
      revision: 1_000_000_001,
      contentViewMode: 'content',
      contentViewHintSeen: false
    }), null);
    assert.equal(bridge.CAPABILITIES.includes('ui-preferences-v1'), false,
      'preferences 是可选能力，不得加入 context core');

    const hello = main.contextPocHandshakeValue({
      ok: true,
      type: 'handshake',
      protocol: bridge.CONTRACT_VERSION,
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: 'host-preference001',
      capabilities: [...bridge.CAPABILITIES, 'ui-preferences-v1']
    });
    assert.equal(hello.capabilities.includes('ui-preferences-v1'), true);
    const runtime = {
      handshake: hello,
      binding: {
        controllerId: 'controller-preference1',
        pageInstanceId: 'page-preference00001',
        selectionRevision: 7
      },
      transport: { call: null }
    };
    let stored = { contentViewMode: 'content', contentViewHintSeen: false };
    let writes = 0;
    const calls = [];
    let preferenceReadRequests = [];
    runtime.transport.call = async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      if (endpoint === 'ui/preferences/sync') {
        return { accepted: true, code: null, snapshot: payload.snapshot };
      }
      if (endpoint === 'ui/preferences/read') {
        return {
          contract: bridge.CONTRACT_VERSION,
          hostInstanceId: hello.hostInstanceId,
          requests: preferenceReadRequests
        };
      }
      return { settled: true };
    };
    const coordinator = main.createContextPocPreferenceCoordinator({
      read: () => ({ ...stored }),
      write: (patch) => { writes += 1; stored = { ...stored, ...patch }; }
    });
    assert.equal(await coordinator.sync(runtime, { isCurrent: () => true }), true);
    assert.deepEqual(Object.keys(calls[0].payload), ['contract', 'snapshot']);
    assert.equal(JSON.stringify(calls[0].payload).includes('session-'), false);
    assert.equal(JSON.stringify(calls[0].payload).includes('authToken'), false);

    const request = {
      controllerId: runtime.binding.controllerId,
      pageInstanceId: runtime.binding.pageInstanceId,
      selectionRevision: runtime.binding.selectionRevision,
      requestToken: 'ab'.repeat(32),
      baseRevision: 1,
      issuedAtMs: 1_000_000,
      deadlineMs: 1_003_000,
      patch: { contentViewMode: 'sessions' }
    };
    assert.deepEqual(main.contextPocPreferenceRequestValue(request), request);
    const readResponse = {
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: hello.hostInstanceId,
      requests: [request]
    };
    assert.equal(main.contextPocPreferenceReadResponseValue(readResponse, runtime).requests[0]
      .requestToken, request.requestToken);
    assert.equal(main.contextPocPreferenceReadResponseValue({
      ...readResponse, cursor: 1
    }, runtime), null, '独立偏好队列不得伪装成 cursor/journal');
    assert.equal(main.contextPocPreferenceReadResponseValue({
      ...readResponse, requests: [request, request]
    }, runtime), null, '同一批不得重复 request token');

    const legacyPreferenceEvent = {
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: hello.hostInstanceId,
      eventSeq: 1,
      type: 'ui-preferences-write',
      ...request
    };
    assert.equal(main.contextPocEventsValue({
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: hello.hostInstanceId,
      oldestEventSeq: 1,
      throughEventSeq: 1,
      resyncRequired: false,
      events: [legacyPreferenceEvent]
    }, { handshake: hello, cursor: 0 }), null,
    'core event schema 必须拒绝旧 ui-preferences-write 类型');
    assert.equal(main.contextPocPreferenceRequestValue({
      ...request, selectionToken: 'cd'.repeat(32)
    }), null, '偏好请求不得夹带页面令牌');
    assert.equal(main.contextPocPreferenceRequestValue({
      ...request, deadlineMs: request.deadlineMs + 1
    }), null, '偏好请求只能使用精确 3 秒绝对时限');
    preferenceReadRequests = [request];
    const drainedPreferences = await coordinator.drain(runtime, {
      isCurrent: () => true,
      now: () => request.issuedAtMs + 1
    });
    assert.equal(drainedPreferences, true);
    assert.equal(stored.contentViewMode, 'sessions');
    assert.equal(writes, 1);
    const read = calls.find((call) => call.endpoint === 'ui/preferences/read');
    assert.deepEqual(read.payload, {
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: hello.hostInstanceId
    });
    const settle = calls.find((call) => call.endpoint === 'ui/preferences/settle');
    assert.deepEqual(Object.keys(settle.payload).sort(), [
      'code', 'contract', 'requestToken', 'snapshot', 'status'
    ]);
    assert.equal(settle.payload.status, 'applied');
    assert.equal(settle.payload.snapshot.revision, 2);

    for (const [requestToken, remainingMs] of [
      ['ad'.repeat(32), 1],
      ['ae'.repeat(32), main.CONTEXT_POC_PREFERENCE_WRITE_MARGIN_MS - 1]
    ]) {
      const late = await coordinator.applyWrite(runtime, {
        ...request,
        requestToken,
        baseRevision: 2,
        issuedAtMs: 2_000_000,
        deadlineMs: 2_003_000,
        patch: { contentViewHintSeen: true }
      }, {
        isCurrent: () => true,
        now: () => 2_003_000 - remainingMs
      });
      assert.equal(late.applied, false);
      assert.equal(late.code, 'preferences-timeout');
      assert.equal(late.settled, true, '安全余量不足仍尽力发送 rejected settle');
    }
    assert.equal(stored.contentViewHintSeen, false, '超时后迟到 drain 绝不落盘');
    assert.equal(writes, 1, 'deadline-1 与剩余 margin-1 都不得调用 options.write');
    const lateSettle = calls.filter((call) => call.endpoint === 'ui/preferences/settle').at(-1);
    assert.equal(lateSettle.payload.status, 'rejected');
    assert.equal(lateSettle.payload.code, 'preferences-timeout');
    assert.equal(lateSettle.payload.snapshot.revision, 2);

    const wrongSelection = await coordinator.applyWrite(runtime, {
      ...request,
      requestToken: 'bc'.repeat(32),
      baseRevision: 2,
      selectionRevision: 8,
      patch: { contentViewHintSeen: true }
    }, { isCurrent: () => true, now: () => request.issuedAtMs + 1 });
    assert.equal(wrongSelection.applied, false);
    assert.equal(wrongSelection.code, 'preferences-invalid');
    assert.equal(writes, 1);

    runtime.transport.call = async (endpoint) => {
      if (endpoint === 'ui/preferences/settle') throw new Error('fixture transport failed');
      throw new Error('unexpected endpoint');
    };
    const isolated = await coordinator.applyWrite(runtime, {
      ...request,
      requestToken: 'cd'.repeat(32),
      baseRevision: 2,
      patch: { contentViewHintSeen: true }
    }, { isCurrent: () => true, now: () => request.issuedAtMs + 1 });
    assert.equal(isolated.applied, true);
    assert.equal(isolated.settled, false);
    assert.equal(stored.contentViewHintSeen, true);
    assert.equal(coordinator.configChanged().revision, 4,
      'settings 成功另增一次；Host-origin write 不重复走 settings 分支');

    const writesBeforeReadFailure = writes;
    runtime.transport.call = async (endpoint) => {
      if (endpoint === 'ui/preferences/read') throw new Error('preference read failed');
      throw new Error('unexpected preference endpoint');
    };
    assert.equal(await coordinator.drain(runtime, { isCurrent: () => true }), false);
    assert.equal(writes, writesBeforeReadFailure,
      '偏好读取失败只能让该偏好超时，不能制造配置写入');
    const coreRuntime = {
      cursor: 0,
      handshake: { hostInstanceId: 'host-core-isolated1' },
      transport: {
        async call(endpoint) {
          assert.equal(endpoint, 'events/read');
          return {
            throughEventSeq: 1,
            resyncRequired: false,
            events: [{ eventSeq: 1, type: 'fixture' }]
          };
        }
      }
    };
    const coreApplied = [];
    const coreDrain = await main.contextPocDrainEventPages(coreRuntime, {
      isCurrent: () => true,
      parse: (value) => value,
      applyEvent: async (_runtime, item) => coreApplied.push(item.eventSeq),
      onCursor: () => {}
    });
    assert.deepEqual(coreDrain, { caughtUp: true, changed: true });
    assert.deepEqual(coreApplied, [1]);
    assert.equal(coreRuntime.cursor, 1,
      '偏好读取失败后 core journal 仍须独立连续推进');

    const retrySnapshots = [];
    let failNextSync = false;
    const retryRuntime = {
      handshake: hello,
      binding: runtime.binding,
      transport: {
        async call(endpoint, payload) {
          if (endpoint === 'ui/preferences/sync') {
            retrySnapshots.push(payload.snapshot);
            if (failNextSync) {
              failNextSync = false;
              throw new Error('one-shot sync failure');
            }
            return { accepted: true, code: null, snapshot: payload.snapshot };
          }
          if (endpoint === 'ui/preferences/read') {
            return {
              contract: bridge.CONTRACT_VERSION,
              hostInstanceId: hello.hostInstanceId,
              requests: []
            };
          }
          throw new Error('unexpected retry endpoint');
        }
      }
    };
    let retryStored = { contentViewMode: 'content', contentViewHintSeen: false };
    const retryCoordinator = main.createContextPocPreferenceCoordinator({
      read: () => ({ ...retryStored }),
      write: (patch) => { retryStored = { ...retryStored, ...patch }; }
    });
    assert.equal(await retryCoordinator.sync(retryRuntime, { isCurrent: () => true }), true);
    retryStored = { ...retryStored, contentViewMode: 'sessions' };
    assert.equal(retryCoordinator.configChanged().revision, 2);
    failNextSync = true;
    assert.equal(await retryCoordinator.sync(retryRuntime, { isCurrent: () => true }), false);
    assert.equal(retryRuntime.preferencesSyncedRevision, 1,
      '失败 sync 不得把旧 revision 永久标成已同步');
    assert.equal(await retryCoordinator.drain(retryRuntime, { isCurrent: () => true }), true,
      '下一次 sidecar drain 必须重试当前 revision');
    assert.equal(retryRuntime.preferencesSyncedRevision, 2);
    assert.deepEqual(retrySnapshots.map((item) => item.revision), [1, 2, 2]);
    assert.deepEqual(retrySnapshots.at(-1), {
      revision: 2,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    });

    const value = source('main.js');
    const settingsApply = value.slice(
      value.indexOf("ipcMain.handle('settings:apply'"),
      value.indexOf("ipcMain.handle('settings:switch-workspace'")
    );
    assert.ok(settingsApply.indexOf('eventService.configure')
      < settingsApply.indexOf('contextPocPreferences.configChanged()'));
    const bridgeStart = value.slice(
      value.indexOf('async function startContextPocBridge'),
      value.indexOf('function budgetIsPaused')
    );
    assert.doesNotMatch(bridgeStart, /contextPocPreferences\.sync\(runtime\)/,
      '首次偏好 sync 也必须由 core tick 收口后的 sidecar drain 发起');
  });

  await test('workspace files 主进程闭环绑定页面/上下文/工作区，过期与执行后换绑不伪报', async () => {
    assert.equal(main.CONTEXT_POC_WORKSPACE_FILE_EXECUTION_MARGIN_MS, 750);
    const issuedAtMs = 1_000_000;
    const request = {
      requestToken: 'ab'.repeat(32),
      requestSeq: 17,
      controllerId: 'controller-files-0001',
      pageInstanceId: 'page-files-00000001',
      selectionRevision: 3,
      projectId: `wdp1_${'b'.repeat(32)}`,
      projectRevision: 'c'.repeat(64),
      contextRevision: 5,
      operation: 'catalog.read',
      input: { cursor: 0, limit: 4 },
      issuedAtMs,
      deadlineMs: issuedAtMs + 10_000
    };
    assert.deepEqual(main.contextPocWorkspaceFileRequestValue(request), request);
    assert.equal(main.contextPocWorkspaceFileRequestValue({ ...request, extra: true }), null);
    assert.equal(main.contextPocWorkspaceFileRequestValue({
      ...request, deadlineMs: request.deadlineMs + 1
    }), null, 'Host 不得漂移绝对 deadline');
    const clip = main.contextPocUtf8Clip('鲸'.repeat(1000), 1800);
    assert.equal(Buffer.byteLength(clip.text, 'utf8') <= 1800, true);
    assert.equal(clip.truncated, true);

    const worstProjects = Array.from({ length: 4 }, (_item, index) => ({
      projectToken: `project-${String(index + 1).repeat(24)}`,
      contentRef: `content-${String(index + 1).repeat(24)}`,
      title: '标题'.repeat(100), stage: 'topic', stageLabel: '选题',
      status: '待确认'.repeat(40), updated: '2026-08-25T12:00:00.000Z',
      decision: '决策'.repeat(100), angle: '角度'.repeat(100), hook: '钩子'.repeat(120),
      angles: Array(8).fill('候选角度'.repeat(40)),
      hooks: Array(8).fill('候选钩子'.repeat(40)), canShoot: false, publish: null
    }));
    const boundedOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({ generation: 9, projects: worstProjects }),
      document: (projectToken) => ({
        projectToken, title: '中文稿', stage: 'script', stageLabel: '脚本',
        blockCount: 2, truncated: false,
        blocks: [1, 2].map((value) => ({
          blockToken: `block-${String(value).repeat(24)}`,
          kind: 'paragraph', text: '中文段落'.repeat(500), startLine: value, endLine: value
        }))
      })
    });
    const rawCatalog = await boundedOps['catalog.read'].handle({
      input: { cursor: 0, limit: 4 }, context: { assertCurrent: () => true }
    });
    const catalog = boundedOps['catalog.read'].redact(rawCatalog);
    assert.equal(catalog.projects.length >= 1 && catalog.projects.length <= 4, true);
    assert.equal(Buffer.byteLength(JSON.stringify(catalog), 'utf8') <= 5600, true,
      '中文内容卡必须在 Host 6KiB 前主动分页');
    const projectToken = `project-${'d'.repeat(24)}`;
    const rawDocument = await boundedOps['document.read'].handle({
      input: { projectToken, cursor: 0, limit: 2 },
      context: { assertCurrent: () => true }
    });
    const document = boundedOps['document.read'].redact(rawDocument);
    assert.equal(document.blocks.every((block) => (
      Buffer.byteLength(block.text, 'utf8') <= 1800 && block.textTruncated
    )), true);
    assert.equal(Buffer.byteLength(JSON.stringify(document), 'utf8') < 6144, true);

    const binding = {
      hostInstanceId: 'host-files-0001',
      controllerId: request.controllerId,
      pageInstanceId: request.pageInstanceId,
      selectionRevision: request.selectionRevision,
      projectId: request.projectId,
      contextRevision: request.contextRevision,
      workspaceGeneration: 11,
      rootIdentity: { dev: '101', ino: '202' }
    };
    const runCoordinator = async ({ bindingFor, catalogHandler, claimDeadline }) => {
      const calls = [];
      const broker = main.contextPocWorkspaceFileBroker({ operations: {
        catalog: catalogHandler || (() => ({
          generation: 11,
          projects: [{
            projectToken: `project-${'e'.repeat(24)}`,
            contentRef: `content-${'e'.repeat(24)}`,
            title: '真实项目', stage: 'topic', stageLabel: '选题',
            status: 'needs-decision', updated: '2026-08-25T12:00:00.000Z',
            angles: [], hooks: [], canShoot: false, publish: null
          }]
        }))
      } });
      const runtime = {
        handshake: {
          hostInstanceId: binding.hostInstanceId,
          capabilities: ['workspace-files-v1']
        },
        binding: {
          controllerId: binding.controllerId,
          pageInstanceId: binding.pageInstanceId,
          selectionRevision: binding.selectionRevision
        },
        workspaceFilesBusy: false,
        transport: {
          async call(endpoint, payload) {
            calls.push({ endpoint, payload });
            if (endpoint === 'workspace/files/read') {
              return {
                contract: bridge.CONTRACT_VERSION,
                hostInstanceId: binding.hostInstanceId,
                requests: [request]
              };
            }
            if (endpoint === 'workspace/files/claim') {
              return {
                claimed: true, code: null, claimToken: 'ef'.repeat(32),
                runningDeadlineMs: claimDeadline === undefined
                  ? request.deadlineMs - 100 : claimDeadline
              };
            }
            if (endpoint === 'workspace/files/settle') return { settled: true, code: null };
            throw new Error('unexpected workspace endpoint');
          }
        }
      };
      const coordinator = main.createContextPocWorkspaceFileCoordinator({
        broker, bindingFor, isCurrent: () => true, now: () => issuedAtMs + 100
      });
      assert.equal(await coordinator.drain(runtime), true);
      assert.equal(runtime.workspaceFilesBusy, false);
      return calls;
    };

    const successCalls = await runCoordinator({ bindingFor: () => binding });
    const successSettle = successCalls.find((call) => call.endpoint === 'workspace/files/settle');
    assert.equal(successSettle.payload.status, 'fulfilled');
    assert.equal(successSettle.payload.result.kind, 'catalog');
    assert.doesNotMatch(JSON.stringify(successSettle.payload.result),
      /(?:absolutePath|relativePath|workspaceKey|sessionRef|claimToken|hash)/);

    let staleRuns = 0;
    const staleCalls = await runCoordinator({
      bindingFor: () => null,
      catalogHandler: () => { staleRuns += 1; return { generation: 1, projects: [] }; }
    });
    assert.equal(staleRuns, 0, '执行前 binding 失效不得进入 handler');
    const staleSettle = staleCalls.find((call) => call.endpoint === 'workspace/files/settle');
    assert.deepEqual({ status: staleSettle.payload.status, code: staleSettle.payload.code }, {
      status: 'rejected', code: 'operation-stale'
    });

    let bindingChecks = 0;
    const afterCalls = await runCoordinator({
      bindingFor: () => (++bindingChecks <= 2 ? binding : {
        ...binding, selectionRevision: binding.selectionRevision + 1
      })
    });
    const afterSettle = afterCalls.find((call) => call.endpoint === 'workspace/files/settle');
    assert.deepEqual({ status: afterSettle.payload.status, code: afterSettle.payload.code }, {
      status: 'rejected', code: 'outcome-unknown'
    }, 'handler 取得执行权后换绑只能报告结果未知');

    const deadlineCalls = await runCoordinator({
      bindingFor: () => binding,
      claimDeadline: request.deadlineMs + 1
    });
    const deadlineSettle = deadlineCalls.find((call) => call.endpoint === 'workspace/files/settle');
    assert.deepEqual({ status: deadlineSettle.payload.status, code: deadlineSettle.payload.code }, {
      status: 'rejected', code: 'operation-timeout'
    }, 'Host 不能通过 claim 重置原始绝对 deadline');
  });

  await test('workspace files 高层动作与回执只返回有限安全投影', async () => {
    const projectToken = `project-${'a'.repeat(24)}`;
    const actionId = 'script';
    const preflightToken = 'preflight-opaque-01';
    const receiptId = 'receipt-opaque-01';
    const pulseId = 'pulse-opaque-01';
    const resultToken = 'result-opaque-01';
    const sourceRelativePath = '02_脚本/稳定项目.md';
    const blockReceiptId = 'receipt-opaque-2';
    const unrelatedReceiptId = 'receipt-opaque-4';
    const otherWorkspaceReceiptId = 'receipt-opaque-6';
    const rootIdentityKey = '101:202';
    const calls = [];
    const ops = main.contextPocWorkspaceFileOperations({
      catalog: () => ({
        generation: 12,
        projects: [
          ['inspiration', null], ['topic', null], ['script', null], ['shoot', null],
          ['edit', null], ['publish', { ready: false, published: false, aiDisclosure: 'unknown' }],
          ['publish', { ready: true, published: true, aiDisclosure: 'not-ai' }], ['data', null]
        ].map(([stage, publish], index) => ({
          projectToken: `project-${index.toString(16).repeat(24)}`,
          contentRef: `content-${index.toString(16).repeat(24)}`,
          title: `项目 ${index}`, stage, stageLabel: '内部标签', status: null,
          updated: null, decision: null, angles: [], hooks: [], canShoot: false,
          publish,
          actions: Array.from({ length: 6 }, (_unused, actionIndex) => ({
            id: `action_${actionIndex}`, label: `动作 ${actionIndex}`, hint: `提示 ${actionIndex}`
          }))
        }))
      }),
      projectAction: async (input) => {
        calls.push(['projectAction', input]);
        if (!Object.prototype.hasOwnProperty.call(input, 'preflightToken')) {
          return {
            kind: 'preflight', preflightToken,
            targetLabel: '目标会话', workspaceLabel: '视频工作区',
            workspaceMatch: 'match', targetRunning: true,
            eventTracking: 'ready', expiresAt: '2026-08-25T12:01:00.000Z'
          };
        }
        return { state: 'accepted', reason: 'queued', target: '目标会话', receiptId };
      },
      verifyProject: (token) => {
        calls.push(['verifyProject', token]);
        return {
          runtime: { rootIdentityKey },
          record: { relativePath: sourceRelativePath }
        };
      },
      receiptSnapshot: () => {
        calls.push(['receiptSnapshot']);
        const receipt = {
          receiptId, anchorRef: `project-${'b'.repeat(24)}`,
          targetLabel: '目标会话'.repeat(96),
          tracking: 'ready', trackingText: '事件已接通'.repeat(96),
          expectedStage: '写稿产出'.repeat(96),
          status: 'completed', statusText: '已完成'.repeat(160),
          createdAt: '2026-08-25T12:00:00.000Z',
          updatedAt: '2026-08-25T12:00:02.000Z',
          terminalAt: '2026-08-25T12:00:02.000Z', elapsedMs: 2000, durationMs: 2000,
          resultCount: 1, resultToken,
          pulseAt: '2026-08-25T12:00:02.000Z', pulseId,
          relativePath: 'private/project.md', hash: 'f'.repeat(64),
          sessionRef: `session-${'b'.repeat(64)}`, rawPrompt: 'SECRET PROMPT'
        };
        return {
          receipts: Array.from({ length: 6 }, (_unused, index) => ({
            ...receipt,
            receiptId: index === 0 ? receiptId : `receipt-opaque-${index + 1}`,
            resultToken: index === 0 ? resultToken : `result-opaque-${index + 1}`,
            pulseId: index === 0 ? pulseId : `pulse-opaque-${index + 1}`,
            anchorRef: index === 0 ? `project-${'b'.repeat(24)}`
              : (index === 1 ? `block-${'c'.repeat(24)}`
                : (index === 3 ? `block-${'d'.repeat(24)}` : projectToken))
          }))
        };
      },
      receiptProjectBinding: (id) => {
        calls.push(['receiptProjectBinding', id]);
        if (id === receiptId || id === blockReceiptId) {
          return { relativePath: sourceRelativePath, rootIdentityKey };
        }
        if (id === unrelatedReceiptId) {
          return { relativePath: '02_脚本/其他项目.md', rootIdentityKey };
        }
        if (id === otherWorkspaceReceiptId) {
          return { relativePath: sourceRelativePath, rootIdentityKey: '303:404' };
        }
        return null;
      },
      ackReceipt: (input) => { calls.push(['ackReceipt', input]); return true; },
      openReceipt: async (input) => { calls.push(['openReceipt', input]); return { kind: 'ok' }; }
    });
    assert.deepEqual(Object.keys(ops).sort(), [
      'block.action.prepare', 'block.action.submit', 'catalog.read', 'document.read',
      'overview.read', 'project.action.prepare', 'project.action.submit',
      'proposal.decide', 'proposal.read', 'proposal.undo', 'publish.create',
      'publish.read', 'publish.update', 'receipts.ack', 'receipts.open',
      'receipts.read', 'review.solidify', 'review.tactics.read',
      'shoot.history.read', 'shoot.open', 'topic.choose'
    ]);
    const mainSource = source('main.js');
    assert.equal((mainSource.match(
      /projectRelativePath: (?:record|document)\.relativePath/g
    ) || []).length >= 3, true,
    '项目动作与两种块动作都必须把源文档绑定留在主进程');
    assert.match(mainSource,
      /projectRelativePath: context && typeof context\.projectRelativePath === 'string'/,
      '创建回执时必须把私有文档绑定转存到 delivery binding');
    assert.match(mainSource,
      /projectRootIdentityKey: context && typeof context\.projectRootIdentityKey === 'string'/,
      '回执必须同时绑定工作区实体身份');
    assert.match(mainSource,
      /videoContentRef\(runtime\.epoch, item\.relativePath\)/,
      '真实工作区刷新必须按 runtime 与路径生成内容身份');

    const stablePath = '02_脚本/同一项目.md';
    const stableContentRef = main.videoContentRef(7, stablePath);
    assert.match(stableContentRef, /^content-[a-f0-9]{24}$/);
    assert.equal(main.videoContentRef(7, stablePath), stableContentRef,
      '同 runtime 同路径修改内容后 contentRef 必须稳定');
    assert.notEqual(main.videoContentRef(7, '02_脚本/另一项目.md'), stableContentRef,
      '不同文件不得共用 contentRef');
    assert.notEqual(main.videoContentRef(8, stablePath), stableContentRef,
      '新 runtime 代际不得重用旧 capability');
    assert.throws(() => main.videoContentRef(7, '../逃逸.md'));

    let identityProjectToken = `project-${'1'.repeat(24)}`;
    const identityOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({
        generation: 7,
        projects: [{
          projectToken: identityProjectToken,
          contentRef: stableContentRef,
          relativePath: stablePath,
          title: '同一项目', stage: 'script', stageLabel: '写稿',
          status: null, updated: null, decision: null, angles: [], hooks: [],
          canShoot: false, publish: null, actions: []
        }]
      })
    });
    const readIdentityCard = async () => {
      const raw = await identityOps['catalog.read'].handle({
        input: { cursor: 0, limit: 1 }, context: { assertCurrent: () => true }
      });
      return identityOps['catalog.read'].redact(raw).projects[0];
    };
    const firstIdentity = await readIdentityCard();
    identityProjectToken = `project-${'2'.repeat(24)}`;
    const secondIdentity = await readIdentityCard();
    assert.notEqual(firstIdentity.projectToken, secondIdentity.projectToken,
      '内容版本改变后 projectToken 应变化');
    assert.equal(firstIdentity.contentRef, secondIdentity.contentRef,
      '新 projectToken 必须保留同一 contentRef');
    assert.equal(JSON.stringify(secondIdentity).includes(stablePath), false,
      'contentRef 投影不得夹带相对路径');
    assert.throws(() => identityOps['catalog.read'].redact({
      kind: 'catalog', generation: 7, projectCount: 1, cursor: 0, nextCursor: null,
      projects: [{ ...secondIdentity, contentRef: 'content-not-opaque' }]
    }));

    const cards = [];
    for (const cursor of [0, 4]) {
      const raw = await ops['catalog.read'].handle({
        input: { cursor, limit: 4 }, context: { assertCurrent: () => true }
      });
      cards.push(...ops['catalog.read'].redact(raw).projects);
    }
    assert.deepEqual(cards.map((card) => [card.workflowStatus, card.workflowLabel]), [
      ['inspiration', '灵感'], ['topic', '选题'], ['script', '写稿'], ['shoot', '拍摄'],
      ['shoot', '拍摄'], ['unpublished', '待发布'], ['published', '已发布'],
      ['uncategorized', '未分类']
    ]);
    assert.equal(cards.every((card) => card.actions.length === 4), true);
    assert.deepEqual(Object.keys(cards[0].actions[0]).sort(), ['hint', 'id', 'label']);

    assert.deepEqual(ops['project.action.prepare'].validate({ projectToken, actionId }), {
      projectToken, actionId
    });
    assert.throws(() => ops['project.action.prepare'].validate({
      projectToken, actionId, extra: true
    }));
    const prepareRaw = await ops['project.action.prepare'].handle({
      input: { projectToken, actionId }, context: { assertCurrent: () => true }
    });
    const prepared = ops['project.action.prepare'].redact(prepareRaw);
    assert.equal(prepared.kind, 'preflight');
    assert.equal(prepared.preflightToken, preflightToken);
    assert.doesNotMatch(JSON.stringify(prepared), /(?:path|hash|session|prompt)/i);

    const submitInput = { projectToken, actionId, preflightToken, override: false };
    assert.deepEqual(ops['project.action.submit'].validate(submitInput), submitInput);
    assert.throws(() => ops['project.action.submit'].validate({
      projectToken, actionId, preflightToken
    }));
    assert.throws(() => ops['project.action.submit'].validate({
      ...submitInput, extra: true
    }));
    const submitRaw = await ops['project.action.submit'].handle({
      input: submitInput, context: { assertCurrent: () => true }
    });
    assert.deepEqual(ops['project.action.submit'].redact(submitRaw), {
      state: 'accepted', reason: 'queued', target: '目标会话', receiptId
    });
    assert.throws(() => ops['project.action.submit'].redact({
      ...submitRaw, sessionRef: `session-${'c'.repeat(64)}`
    }));

    assert.deepEqual(ops['receipts.read'].validate({ projectToken, limit: 6 }), {
      projectToken, limit: 6
    });
    for (const invalid of [
      { projectToken, limit: 0 }, { projectToken, limit: 7 },
      { projectToken, limit: 1, extra: true }
    ]) assert.throws(() => ops['receipts.read'].validate(invalid));
    const receiptsRaw = await ops['receipts.read'].handle({
      input: { projectToken, limit: 6 }, context: { assertCurrent: () => true }
    });
    const receipts = ops['receipts.read'].redact(receiptsRaw);
    assert.equal(receipts.receipts.length >= 1 && receipts.receipts.length <= 6, true);
    assert.equal(Buffer.byteLength(JSON.stringify(receipts), 'utf8') <= 5600, true,
      '回执批次必须在 Host 6KiB 之前主动截断');
    assert.equal(receipts.receipts.some((receipt) => receipt.receiptId === receiptId), true,
      '旧 projectToken 回执必须按主进程私有路径绑定保留');
    assert.equal(receipts.receipts.some((receipt) => receipt.receiptId === blockReceiptId), true,
      'blockToken 回执必须归并到当前项目');
    assert.equal(receipts.receipts.some((receipt) => receipt.receiptId === unrelatedReceiptId), false,
      '其他项目回执不得串入');
    assert.equal(receipts.receipts.some((receipt) => receipt.receiptId === otherWorkspaceReceiptId), false,
      '同名相对路径的其他工作区回执不得串入');
    assert.deepEqual(Object.keys(receipts.receipts[0]).sort(), [
      'createdAt', 'durationMs', 'elapsedMs', 'expectedStage', 'pulseAt', 'pulseId',
      'receiptId', 'resultCount', 'resultToken', 'status', 'statusText', 'targetLabel',
      'terminalAt', 'tracking', 'trackingText', 'updatedAt'
    ]);
    assert.doesNotMatch(JSON.stringify(receipts),
      /(?:relativePath|anchorRef|hash|sessionRef|rawPrompt|SECRET)/);

    assert.throws(() => ops['receipts.ack'].validate({ receiptId, pulseId, extra: true }));
    const ackRaw = await ops['receipts.ack'].handle({
      input: { receiptId, pulseId }, context: { assertCurrent: () => true }
    });
    assert.deepEqual(ops['receipts.ack'].redact(ackRaw), { kind: 'ok' });
    assert.throws(() => ops['receipts.open'].validate({ resultToken: 'bad token' }));
    const openRaw = await ops['receipts.open'].handle({
      input: { resultToken }, context: { assertCurrent: () => true }
    });
    assert.deepEqual(ops['receipts.open'].redact(openRaw), { kind: 'ok' });
    assert.deepEqual(ops['receipts.open'].redact({ kind: 'error', text: '结果已过期' }), {
      kind: 'error', message: '结果已过期'
    });
    assert.throws(() => ops['receipts.open'].redact({
      kind: 'error', text: '打开失败', path: '/private/result.md'
    }));
    assert.deepEqual(calls.filter((call) => call[0] !== 'receiptProjectBinding')
      .map((call) => call[0]), [
      'projectAction', 'projectAction', 'verifyProject', 'receiptSnapshot',
      'ackReceipt', 'openReceipt'
    ]);

    let staleSideEffects = 0;
    const staleOps = main.contextPocWorkspaceFileOperations({
      projectAction: async () => { staleSideEffects += 1; },
      verifyProject: () => { staleSideEffects += 1; },
      receiptSnapshot: () => { staleSideEffects += 1; return { receipts: [] }; },
      ackReceipt: () => { staleSideEffects += 1; return true; },
      openReceipt: async () => { staleSideEffects += 1; return { kind: 'ok' }; }
    });
    const staleContext = { assertCurrent: () => false };
    await assert.rejects(staleOps['project.action.prepare'].handle({
      input: { projectToken, actionId }, context: staleContext
    }));
    await assert.rejects(staleOps['project.action.submit'].handle({
      input: submitInput, context: staleContext
    }));
    await assert.rejects(staleOps['receipts.read'].handle({
      input: { projectToken, limit: 1 }, context: staleContext
    }));
    await assert.rejects(staleOps['receipts.ack'].handle({
      input: { receiptId, pulseId }, context: staleContext
    }));
    await assert.rejects(staleOps['receipts.open'].handle({
      input: { resultToken }, context: staleContext
    }));
    assert.equal(staleSideEffects, 0, '换绑后不得进入预检/提交/回执副作用');
  });

  await test('概览分页返回完整候选，连续拍板只接受刷新后的项目身份', async () => {
    const mainSource = source('main.js');
    assert.match(mainSource,
      /function videoProjectCard[\s\S]*?angle: safeText\(fields\.angle, '', 240\)/,
      '生产 catalog 不得截短 overview 已接受的 240 字角度');
    assert.match(mainSource,
      /function readVideoDocumentByToken[\s\S]*?error\.code = 'ERR_CONTEXT_PROJECT_STALE'[\s\S]*?error\.code = 'ERR_CONTEXT_PROJECT_STALE'/,
      '缺 token 与 hash 变化都必须按 stale 映射');
    const contentRef = `content-${'7'.repeat(24)}`;
    const siblingContentRef = `content-${'8'.repeat(24)}`;
    const angles = Array.from({ length: 32 }, (_unused, index) => (
      `角度 ${String(index + 1).padStart(2, '0')} · ${'真实候选'.repeat(12)}`
    ));
    const hooks = Array.from({ length: 32 }, (_unused, index) => (
      `钩子 ${String(index + 1).padStart(2, '0')} · ${'不编造'.repeat(12)}`
    ));
    const versions = [
      `project-${'3'.repeat(24)}`,
      `project-${'4'.repeat(24)}`,
      `project-${'5'.repeat(24)}`
    ];
    let version = 0;
    let selectedAngle = angles[0];
    let selectedHook = hooks[0];
    let updated = '2026-08-25T12:00:00.000Z';
    let chooseCalls = 0;
    const siblingToken = `project-${'6'.repeat(24)}`;
    const catalog = () => ({
      generation: 21 + version,
      projects: [{
        projectToken: versions[version], contentRef,
        title: '同名项目', stage: 'topic', stageLabel: '选题',
        status: 'needs-decision', updated, decision: '只用真实候选',
        angle: selectedAngle, hook: selectedHook,
        angles: angles.slice(0, 8), hooks: hooks.slice(0, 8),
        canShoot: false, publish: null, actions: []
      }, {
        projectToken: siblingToken, contentRef: siblingContentRef,
        title: '同名项目', stage: 'topic', stageLabel: '选题',
        status: 'needs-decision', updated: '2026-08-25T11:00:00.000Z',
        decision: null, angle: '另一个文件的角度', hook: '另一个文件的钩子',
        angles: [], hooks: [], canShoot: false, publish: null, actions: []
      }]
    });
    const overview = (projectToken) => {
      if (projectToken !== versions[version]) {
        const error = new Error('这张项目卡已过期');
        error.code = 'ERR_CONTEXT_PROJECT_STALE';
        throw error;
      }
      return {
        contentRef, projectToken, title: '同名项目', stage: 'topic', stageLabel: '选题',
        status: 'needs-decision', updated, decision: '只用真实候选',
        angle: selectedAngle, hook: selectedHook, angles, hooks,
        absolutePath: '/private/同名项目.md', hash: 'a'.repeat(64),
        rawPrompt: 'SECRET OVERVIEW PROMPT'
      };
    };
    const chooseTopic = async (input) => {
      chooseCalls += 1;
      assert.equal(input.projectToken, versions[version]);
      if (input.field === 'angle') selectedAngle = input.value;
      else selectedHook = input.value;
      version += 1;
      updated = `2026-08-25T12:00:0${version}.000Z`;
      return { kind: 'ok', text: `已写回${input.field}` };
    };
    const ops = main.contextPocWorkspaceFileOperations({ catalog, overview, chooseTopic });
    const current = { assertCurrent: () => true };

    assert.deepEqual(ops['overview.read'].validate({
      projectToken: versions[0], cursor: 0, limit: 4
    }), { projectToken: versions[0], cursor: 0, limit: 4 });
    for (const invalid of [
      { projectToken: versions[0] },
      { projectToken: versions[0], cursor: 0 },
      { projectToken: versions[0], cursor: 0, limit: 5 },
      { projectToken: versions[0], cursor: 65, limit: 4 },
      { projectToken: versions[0], cursor: 0, limit: 4, path: '/private/leak' },
      { projectToken: 'project-not-opaque', cursor: 0, limit: 4 }
    ]) assert.throws(() => ops['overview.read'].validate(invalid));

    const received = [];
    let cursor = 0;
    let pageCount = 0;
    do {
      const raw = await ops['overview.read'].handle({
        input: { projectToken: versions[0], cursor, limit: 4 }, context: current
      });
      const page = ops['overview.read'].redact(raw);
      pageCount += 1;
      assert.equal(page.candidateCount, 64);
      assert.equal(page.cursor, cursor);
      assert.equal(page.candidates.length, 4);
      assert.equal(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 5600, true);
      assert.doesNotMatch(JSON.stringify(page),
        /(?:absolutePath|relativePath|hash|sessionRef|rawPrompt|SECRET)/);
      received.push(...page.candidates);
      cursor = page.nextCursor;
    } while (cursor !== null && pageCount <= 16);
    assert.equal(pageCount, 16);
    assert.equal(received.length, 64);
    assert.deepEqual(received.slice(0, 32).map((candidate) => candidate.field),
      Array(32).fill('angle'));
    assert.deepEqual(received.slice(32).map((candidate) => candidate.field),
      Array(32).fill('hook'));
    assert.deepEqual(received.map((candidate) => candidate.value), [...angles, ...hooks]);
    assert.equal(received[0].selected, true);
    assert.equal(received[32].selected, true);
    assert.throws(() => ops['overview.read'].redact({
      kind: 'overview', contentRef, projectToken: versions[0], title: '项目',
      stage: 'topic', stageLabel: '选题', status: null, updated: null,
      decision: null, angle: null, hook: null, candidateCount: 1,
      cursor: 0, nextCursor: null,
      candidates: [{ field: 'angle', value: angles[0], selected: false, hash: 'x' }]
    }));

    const angleInput = {
      projectToken: versions[0], field: 'angle', value: angles[17]
    };
    const angleRaw = await ops['topic.choose'].handle({ input: angleInput, context: current });
    const angleResult = ops['topic.choose'].redact(angleRaw);
    assert.deepEqual(angleResult, {
      kind: 'mutation', changed: true, contentRef,
      projectToken: versions[1], field: 'angle', value: angles[17],
      updated: '2026-08-25T12:00:01.000Z', message: '已写回angle'
    });
    assert.notEqual(angleResult.projectToken, angleInput.projectToken,
      '拍板后必须返回刷新快照里的 replacement token');
    assert.throws(() => ops['topic.choose'].redact({
      ...angleRaw, relativePath: '01_选题库/同名项目.md'
    }));
    assert.throws(() => ops['topic.choose'].validate({
      ...angleInput, value: `${angles[17]}\n越权`
    }));
    assert.throws(() => ops['topic.choose'].validate({ ...angleInput, extra: true }));

    const hookInput = {
      projectToken: angleResult.projectToken, field: 'hook', value: hooks[23]
    };
    const hookRaw = await ops['topic.choose'].handle({ input: hookInput, context: current });
    const hookResult = ops['topic.choose'].redact(hookRaw);
    assert.deepEqual(hookResult, {
      kind: 'mutation', changed: true, contentRef,
      projectToken: versions[2], field: 'hook', value: hooks[23],
      updated: '2026-08-25T12:00:02.000Z', message: '已写回hook'
    });
    assert.equal(hookResult.contentRef, angleResult.contentRef,
      '同一文件连续写回必须保留稳定 contentRef');
    assert.equal(catalog().projects[1].projectToken, siblingToken,
      '同名文件必须保持独立身份，不能按标题误命中');
    assert.equal(catalog().projects[1].angle, '另一个文件的角度');

    const longAngle = '长角度'.repeat(66) + '收';
    assert.equal(Array.from(longAngle).length, 199);
    const longTokens = [`project-${'a'.repeat(24)}`, `project-${'b'.repeat(24)}`];
    const longContentRef = `content-${'c'.repeat(24)}`;
    let longVersion = 0;
    let longSelected = null;
    const longOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({
        generation: longVersion,
        projects: [{
          projectToken: longTokens[longVersion], contentRef: longContentRef,
          angle: longSelected, updated: `2026-08-25T13:00:0${longVersion}.000Z`
        }]
      }),
      chooseTopic: async (input) => {
        longSelected = input.value;
        longVersion = 1;
        return { text: '长角度已完整写回' };
      }
    });
    const longResult = longOps['topic.choose'].redact(await longOps['topic.choose'].handle({
      input: { projectToken: longTokens[0], field: 'angle', value: longAngle },
      context: current
    }));
    assert.equal(longResult.projectToken, longTokens[1]);
    assert.equal(longResult.value, longAngle);
    assert.equal(Array.from(longResult.value).length, 199,
      '161–240 字的合法角度不得在写后确认时被截短');

    const sameToken = `project-${'d'.repeat(24)}`;
    const sameContentRef = `content-${'e'.repeat(24)}`;
    let sameSelected = angles[0];
    const sameTokenOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({ generation: 1, projects: [{
        projectToken: sameToken, contentRef: sameContentRef,
        angle: sameSelected, updated: '2026-08-25T13:30:00.000Z'
      }] }),
      chooseTopic: async (input) => {
        sameSelected = input.value;
        return { text: '底层声称成功但身份没轮换' };
      }
    });
    let sameTokenError;
    try {
      await sameTokenOps['topic.choose'].handle({
        input: { projectToken: sameToken, field: 'angle', value: angles[2] },
        context: current
      });
    } catch (error) { sameTokenError = error; }
    assert.equal(sameTokenOps['topic.choose'].errorCode(sameTokenError), 'outcome-unknown',
      '写后仍是旧 token 时主进程不得返回成功 mutation');

    let staleError;
    try {
      await ops['topic.choose'].handle({ input: angleInput, context: current });
    } catch (error) { staleError = error; }
    assert.equal(ops['topic.choose'].errorCode(staleError), 'operation-stale');
    assert.equal(chooseCalls, 2, '旧 token 必须在任何写回动作前被拒绝');

    let staleSideEffects = 0;
    const staleOps = main.contextPocWorkspaceFileOperations({
      catalog: () => { staleSideEffects += 1; return catalog(); },
      overview: () => { staleSideEffects += 1; return overview(versions[2]); },
      chooseTopic: async () => { staleSideEffects += 1; return { text: '不应执行' }; }
    });
    const staleContext = { assertCurrent: () => false };
    await assert.rejects(staleOps['overview.read'].handle({
      input: { projectToken: versions[2], cursor: 0, limit: 4 }, context: staleContext
    }));
    await assert.rejects(staleOps['topic.choose'].handle({
      input: { projectToken: versions[2], field: 'hook', value: hooks[1] },
      context: staleContext
    }));
    assert.equal(staleSideEffects, 0, '换绑后不得读取概览或进入拍板写回');

    const casOps = main.contextPocWorkspaceFileOperations({
      catalog,
      chooseTopic: async () => {
        const error = new Error('文件已变化');
        error.code = 'ERR_CAS_MISMATCH';
        throw error;
      }
    });
    let casError;
    try {
      await casOps['topic.choose'].handle({
        input: { projectToken: versions[2], field: 'hook', value: hooks[1] },
        context: current
      });
    } catch (error) { casError = error; }
    assert.equal(casOps['topic.choose'].errorCode(casError), 'operation-stale');

    const uncertainOps = main.contextPocWorkspaceFileOperations({
      catalog: (() => {
        let reads = 0;
        return () => (++reads === 1 ? catalog() : { generation: 99, projects: [] });
      })(),
      chooseTopic: async () => ({ text: '已执行但刷新失败' })
    });
    let uncertainError;
    try {
      await uncertainOps['topic.choose'].handle({
        input: { projectToken: versions[2], field: 'hook', value: hooks[2] },
        context: current
      });
    } catch (error) { uncertainError = error; }
    assert.equal(uncertainOps['topic.choose'].errorCode(uncertainError), 'outcome-unknown',
      '写回返回后无法取得 replacement token 时不得诱导自动重试');
  });

  await test('脚本块动作与建议卡按 contentRef 隔离，采用/退回/撤销保持 CAS 语义', async () => {
    const contentRef = `content-${'a'.repeat(24)}`;
    const otherContentRef = `content-${'b'.repeat(24)}`;
    const projectVersions = [
      `project-${'7'.repeat(24)}`,
      `project-${'8'.repeat(24)}`,
      `project-${'9'.repeat(24)}`
    ];
    const otherProjectToken = `project-${'c'.repeat(24)}`;
    const blockToken = `block-${'d'.repeat(24)}`;
    const preflightToken = 'preflight-batch6-01';
    const receiptId = 'receipt-batch6-01';
    const proposalToken = 'proposal-video-batch6_01';
    const proposalRevisionToken = `proposal-revision-${'e'.repeat(24)}`;
    const revisionToken = `revision-${'f'.repeat(24)}`;
    let projectVersion = 0;
    let mode = 'ready';
    let originalWrites = 0;
    let rejectWrites = 0;
    let undoWrites = 0;
    const blockCalls = [];
    const decisionCalls = [];
    const undoCalls = [];
    const catalog = () => ({
      generation: 40 + projectVersion,
      projects: [{
        projectToken: projectVersions[projectVersion], contentRef,
        title: '脚本 A', stage: 'script', stageLabel: '写稿', actions: []
      }, {
        projectToken: otherProjectToken, contentRef: otherContentRef,
        title: '脚本 B', stage: 'script', stageLabel: '写稿', actions: []
      }]
    });
    const longBefore = `原稿：${'这是一段只读原稿。'.repeat(260)}`;
    const longAfter = `建议：${'这是一段建议改写。'.repeat(260)}`;
    let useLongComparison = true;
    const surfaceFor = (requestedContentRef) => {
      if (mode === null) return null;
      const common = {
        // 故意在 B 请求时仍返回 A 的绑定；主进程必须把它当作空卡，不能串卡。
        contentRef,
        title: '脚本 A',
        before: useLongComparison ? longBefore : '原来的目标块。',
        after: useLongComparison ? longAfter : '新的目标块。',
        absolutePath: '/private/脚本A.md', hash: 'a'.repeat(64),
        rawPrompt: 'SECRET BLOCK PROMPT'
      };
      if (mode === 'adopted') {
        return {
          ...common, status: 'adopted', reason: null,
          proposalToken: null, proposalRevisionToken: null, revisionToken,
          intentLabel: '已采用，可撤销一次', canAdopt: false,
          canReject: false, canUndo: true, submitted: null, target: null
        };
      }
      return {
        ...common, status: 'ready', reason: null,
        proposalToken, proposalRevisionToken, revisionToken: null,
        intentLabel: '更口语', canAdopt: true, canReject: true, canUndo: false,
        submitted: 'accepted', target: '目标会话'
      };
    };
    const blockAction = async (input) => {
      blockCalls.push(input);
      if (!Object.prototype.hasOwnProperty.call(input, 'preflightToken')) {
        return {
          kind: 'preflight', preflightToken,
          targetLabel: '目标会话', workspaceLabel: '脚本工作区',
          workspaceMatch: 'match', targetRunning: true,
          eventTracking: 'ready', expiresAt: '2026-08-25T12:20:00.000Z'
        };
      }
      return { state: 'accepted', reason: 'queued', target: '目标会话', receiptId };
    };
    const proposalDecision = async (input) => {
      decisionCalls.push(input);
      if (input.decision === 'reject') {
        rejectWrites += 1;
        mode = null;
        return { kind: 'ok', text: '已退回建议，原稿从未改动。' };
      }
      originalWrites += 1;
      projectVersion = 1;
      mode = 'adopted';
      return { kind: 'ok', text: '已采用这一块；原稿其他部分不动。' };
    };
    const proposalUndo = async (input) => {
      undoCalls.push(input);
      undoWrites += 1;
      projectVersion = 2;
      mode = null;
      return { kind: 'ok', text: '已撤销上一次块级采用。' };
    };
    const ops = main.contextPocWorkspaceFileOperations({
      catalog, blockAction, proposalSurface: surfaceFor,
      proposalDecision, proposalUndo
    });
    const current = { assertCurrent: () => true };

    for (const action of ['revise', 'spoken', 'shorten', 'ask']) {
      assert.deepEqual(ops['block.action.prepare'].validate({
        projectToken: projectVersions[0], blockToken, action
      }), { projectToken: projectVersions[0], blockToken, action });
    }
    for (const invalid of [
      { projectToken: projectVersions[0], blockToken, action: 'delete' },
      { projectToken: projectVersions[0], blockToken, action: 'revise', extra: true }
    ]) assert.throws(() => ops['block.action.prepare'].validate(invalid));
    const submitInput = {
      projectToken: projectVersions[0], blockToken, action: 'spoken',
      preflightToken, override: false
    };
    assert.deepEqual(ops['block.action.submit'].validate(submitInput), submitInput);
    assert.throws(() => ops['block.action.submit'].validate({
      projectToken: projectVersions[0], blockToken, action: 'spoken', override: false
    }));
    assert.throws(() => ops['block.action.submit'].validate({ ...submitInput, extra: true }));

    const prepareRaw = await ops['block.action.prepare'].handle({
      input: { projectToken: projectVersions[0], blockToken, action: 'spoken' },
      context: current
    });
    const prepared = ops['block.action.prepare'].redact(prepareRaw);
    assert.deepEqual(prepared, {
      kind: 'preflight', contentRef, projectToken: projectVersions[0],
      blockToken, action: 'spoken', state: 'ready', preflightToken,
      targetLabel: '目标会话', workspaceLabel: '脚本工作区',
      workspaceMatch: 'match', targetRunning: true, eventTracking: 'ready',
      expiresAt: '2026-08-25T12:20:00.000Z', message: null
    });
    const submitRaw = await ops['block.action.submit'].handle({
      input: submitInput, context: current
    });
    assert.deepEqual(ops['block.action.submit'].redact(submitRaw), {
      kind: 'submission', contentRef, projectToken: projectVersions[0],
      blockToken, action: 'spoken', state: 'accepted', reason: 'queued',
      target: '目标会话', receiptId, message: null
    });
    assert.deepEqual(blockCalls, [
      { projectToken: projectVersions[0], blockToken, action: 'spoken' }, submitInput
    ]);

    assert.deepEqual(ops['proposal.read'].validate({ contentRef }), { contentRef });
    assert.throws(() => ops['proposal.read'].validate({ contentRef, path: '/private/a.md' }));
    assert.deepEqual(ops['proposal.decide'].validate({
      contentRef, proposalToken, decision: 'adopt', proposalRevisionToken
    }), { contentRef, proposalToken, decision: 'adopt', proposalRevisionToken });
    assert.deepEqual(ops['proposal.decide'].validate({
      contentRef, proposalToken, decision: 'reject'
    }), { contentRef, proposalToken, decision: 'reject' });
    assert.throws(() => ops['proposal.decide'].validate({
      contentRef, proposalToken, decision: 'reject', proposalRevisionToken
    }), 'reject 不得携带 revision');
    assert.throws(() => ops['proposal.decide'].validate({
      contentRef, proposalToken, decision: 'adopt'
    }));
    assert.deepEqual(ops['proposal.undo'].validate({ contentRef, revisionToken }), {
      contentRef, revisionToken
    });
    assert.throws(() => ops['proposal.undo'].validate({
      contentRef, revisionToken, extra: true
    }));

    const readyRaw = await ops['proposal.read'].handle({
      input: { contentRef }, context: current
    });
    const ready = ops['proposal.read'].redact(readyRaw);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.projectToken, projectVersions[0]);
    assert.equal(ready.proposalRevisionToken, null,
      '对照文本被截断时不得向页面下发可采用 revision');
    assert.equal(ready.canAdopt, false,
      '对照文本被截断时主进程必须关闭采用，不依赖 UI 自律');
    assert.equal(ready.canReject, true, '截断建议仍允许安全退回');
    assert.equal(Buffer.byteLength(ready.before, 'utf8') <= 1600, true);
    assert.equal(Buffer.byteLength(ready.after, 'utf8') <= 1600, true);
    assert.equal(ready.beforeTruncated, true);
    assert.equal(ready.afterTruncated, true);
    assert.equal(Buffer.byteLength(JSON.stringify(ready), 'utf8') <= 5600, true);
    assert.doesNotMatch(JSON.stringify(ready),
      /(?:absolutePath|relativePath|hash|binding|rawPrompt|SECRET)/);
    assert.throws(() => ops['proposal.read'].redact({
      ...readyRaw, relativePath: '02_脚本/脚本A.md'
    }));

    const otherRaw = await ops['proposal.read'].handle({
      input: { contentRef: otherContentRef }, context: current
    });
    const other = ops['proposal.read'].redact(otherRaw);
    assert.deepEqual({
      contentRef: other.contentRef, projectToken: other.projectToken,
      status: other.status, proposalToken: other.proposalToken
    }, {
      contentRef: otherContentRef, projectToken: otherProjectToken,
      status: null, proposalToken: null
    }, '全局 A 建议卡不得串到 B 内容');

    const baseProposal = {
      contentRef, title: '脚本 A', intentLabel: '改这段', before: '原块', after: null,
      proposalToken, proposalRevisionToken: null, revisionToken: null,
      canAdopt: false, canReject: true, canUndo: false,
      submitted: null, target: null
    };
    const variants = [
      { status: 'queued', reason: null },
      { status: 'unchanged', reason: 'target-unchanged' },
      { status: 'stale', reason: 'original-changed' },
      { status: 'invalid', reason: 'outside-target-changed' },
      { status: 'invalid', reason: 'proposal-too-large' },
      { status: 'invalid', reason: 'ERR_PATH_NOT_FOUND' },
      {
        status: 'ready', reason: null, proposalRevisionToken,
        after: '新块', canAdopt: true
      },
      {
        status: 'adopted', reason: null, proposalToken: null,
        revisionToken, after: '新块', canReject: false, canUndo: true
      },
      {
        status: 'conflict', reason: 'adopted-file-changed', proposalToken: null,
        revisionToken, after: '新块', canReject: false, canUndo: false
      }
    ];
    const observedStatuses = new Set();
    const observedReasons = new Set();
    for (const variant of variants) {
      const statusOps = main.contextPocWorkspaceFileOperations({
        catalog,
        proposalSurface: () => ({ ...baseProposal, ...variant })
      });
      const raw = await statusOps['proposal.read'].handle({
        input: { contentRef }, context: current
      });
      const projected = statusOps['proposal.read'].redact(raw);
      observedStatuses.add(projected.status);
      if (projected.reason) observedReasons.add(projected.reason);
    }
    assert.deepEqual([...observedStatuses].sort(), [
      'adopted', 'conflict', 'invalid', 'queued', 'ready', 'stale', 'unchanged'
    ]);
    assert.deepEqual([...observedReasons].sort(), [
      'adopted-file-changed', 'original-changed', 'outside-target-changed',
      'proposal-too-large', 'read-failed', 'target-unchanged'
    ]);

    let clippedBypassError;
    try {
      await ops['proposal.decide'].handle({
        input: { contentRef, proposalToken, decision: 'adopt', proposalRevisionToken },
        context: current
      });
    } catch (error) { clippedBypassError = error; }
    assert.equal(ops['proposal.decide'].errorCode(clippedBypassError), 'operation-stale');
    assert.equal(decisionCalls.length, 0,
      '直接调用 adopt 也必须复验当前完整投影，不能持旧 revision 绕过 UI');
    useLongComparison = false;
    const completeReadyRaw = await ops['proposal.read'].handle({
      input: { contentRef }, context: current
    });
    const completeReady = ops['proposal.read'].redact(completeReadyRaw);
    assert.equal(completeReady.canAdopt, true);
    assert.equal(completeReady.proposalRevisionToken, proposalRevisionToken);

    const rejectRaw = await ops['proposal.decide'].handle({
      input: { contentRef, proposalToken, decision: 'reject' }, context: current
    });
    assert.deepEqual(ops['proposal.decide'].redact(rejectRaw), {
      kind: 'decision', contentRef, projectToken: projectVersions[0],
      decision: 'reject', changed: false, revisionToken: null,
      message: '已退回建议，原稿从未改动。'
    });
    assert.equal(originalWrites, 0);
    assert.equal(rejectWrites, 1, '退回只删除建议，不得写原稿');
    assert.deepEqual(decisionCalls[0], { proposalToken, decision: 'reject' },
      'contentRef 只用于主进程绑定，不下沉成路径或通用写接口');

    mode = 'ready';
    let staleRevisionError;
    try {
      await ops['proposal.decide'].handle({
        input: {
          contentRef, proposalToken, decision: 'adopt',
          proposalRevisionToken: `proposal-revision-${'0'.repeat(24)}`
        },
        context: current
      });
    } catch (error) { staleRevisionError = error; }
    assert.equal(ops['proposal.decide'].errorCode(staleRevisionError), 'operation-stale');
    assert.equal(decisionCalls.length, 1, '旧 revision 不得进入采用写回');

    const adoptRaw = await ops['proposal.decide'].handle({
      input: { contentRef, proposalToken, decision: 'adopt', proposalRevisionToken },
      context: current
    });
    assert.deepEqual(ops['proposal.decide'].redact(adoptRaw), {
      kind: 'decision', contentRef, projectToken: projectVersions[1],
      decision: 'adopt', changed: true, revisionToken,
      message: '已采用这一块；原稿其他部分不动。'
    });
    assert.equal(originalWrites, 1, '采用只能发生一次原稿写回');
    assert.deepEqual(decisionCalls[1], {
      proposalToken, decision: 'adopt', proposalRevisionToken
    });

    const undoRaw = await ops['proposal.undo'].handle({
      input: { contentRef, revisionToken }, context: current
    });
    assert.deepEqual(ops['proposal.undo'].redact(undoRaw), {
      kind: 'undo', contentRef, projectToken: projectVersions[2], changed: true,
      message: '已撤销上一次块级采用。'
    });
    assert.equal(undoWrites, 1);
    assert.deepEqual(undoCalls, [{ revisionToken }]);
    let secondUndoError;
    try {
      await ops['proposal.undo'].handle({
        input: { contentRef, revisionToken }, context: current
      });
    } catch (error) { secondUndoError = error; }
    assert.equal(ops['proposal.undo'].errorCode(secondUndoError), 'operation-stale');
    assert.equal(undoWrites, 1, '一次性撤销 token 不得二次写回');

    let oldTokenError;
    try {
      await ops['block.action.prepare'].handle({
        input: { projectToken: projectVersions[0], blockToken, action: 'revise' },
        context: current
      });
    } catch (error) { oldTokenError = error; }
    assert.equal(ops['block.action.prepare'].errorCode(oldTokenError), 'operation-stale');
    assert.equal(blockCalls.length, 2, '旧 projectToken 不得进入块动作');

    let staleSideEffects = 0;
    const staleOps = main.contextPocWorkspaceFileOperations({
      catalog: () => { staleSideEffects += 1; return catalog(); },
      blockAction: async () => { staleSideEffects += 1; return {}; },
      proposalSurface: async () => { staleSideEffects += 1; return null; },
      proposalDecision: async () => { staleSideEffects += 1; return {}; },
      proposalUndo: async () => { staleSideEffects += 1; return {}; }
    });
    const staleContext = { assertCurrent: () => false };
    await assert.rejects(staleOps['block.action.prepare'].handle({
      input: { projectToken: projectVersions[2], blockToken, action: 'ask' },
      context: staleContext
    }));
    await assert.rejects(staleOps['block.action.submit'].handle({
      input: {
        projectToken: projectVersions[2], blockToken, action: 'ask',
        preflightToken, override: false
      }, context: staleContext
    }));
    await assert.rejects(staleOps['proposal.read'].handle({
      input: { contentRef }, context: staleContext
    }));
    await assert.rejects(staleOps['proposal.decide'].handle({
      input: { contentRef, proposalToken, decision: 'reject' }, context: staleContext
    }));
    await assert.rejects(staleOps['proposal.undo'].handle({
      input: { contentRef, revisionToken }, context: staleContext
    }));
    assert.equal(staleSideEffects, 0, '换绑后五个脚本 operation 都必须零副作用');

    let uncertainMode = 'ready';
    const unchangedToken = `project-${'1'.repeat(24)}`;
    const uncertainOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({ projects: [{ projectToken: unchangedToken, contentRef }] }),
      proposalSurface: () => uncertainMode === 'ready'
        ? {
          contentRef, status: 'ready', reason: null, proposalToken,
          proposalRevisionToken, revisionToken: null, title: '脚本', intentLabel: '改这段',
          before: '原块', after: '新块', canAdopt: true, canReject: true,
          canUndo: false, submitted: null, target: null
        } : {
          contentRef, status: 'adopted', reason: null, proposalToken: null,
          proposalRevisionToken: null, revisionToken, title: '脚本',
          intentLabel: '已采用', before: '原块', after: '新块',
          canAdopt: false, canReject: false, canUndo: true,
          submitted: null, target: null
        },
      proposalDecision: async () => {
        uncertainMode = 'adopted';
        return { kind: 'ok', text: '已写回' };
      }
    });
    let uncertainError;
    try {
      await uncertainOps['proposal.decide'].handle({
        input: { contentRef, proposalToken, decision: 'adopt', proposalRevisionToken },
        context: current
      });
    } catch (error) { uncertainError = error; }
    assert.equal(uncertainOps['proposal.decide'].errorCode(uncertainError), 'outcome-unknown',
      '采用后 projectToken 未轮换时不得宣称成功或诱导重试');

    const mainSource = source('main.js');
    assert.match(mainSource,
      /videoProposalMatchesContent\([\s\S]*runtime, videoProposal\.plan\.record\.sourceRelativePath/,
      'proposal 必须用当前 runtime、源相对路径与 contentRef 共同绑定');
    assert.match(mainSource, /expectedBinding: documents\.original\.binding/,
      '采用必须保留原稿 inode binding');
    assert.match(mainSource, /expectedBinding: videoUndo\.adoptedBinding/,
      '撤销必须保留采用后 inode binding');
    assert.match(mainSource, /videoUndo = null;\n    videoProposal = \{/,
      '只有建议副本实际建立后才清旧 undo');
    assert.equal(main.requireVideoProposalRemoval(true, false), true);
    assert.throws(() => main.requireVideoProposalRemoval(false, false), (error) => (
      error && error.code === 'ERR_PROPOSAL_REMOVE_FAILED'
    ), 'reject 删除失败必须保留全局建议并如实报错');
    assert.throws(() => main.requireVideoProposalRemoval(false, true), (error) => (
      error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN'
    ), 'adopt 写后清理失败必须报告 outcome unknown');
    const adoptionFlow = mainSource.slice(
      mainSource.indexOf('const previous = videoProposal;',
        mainSource.indexOf('function decideVideoProposal')),
      mainSource.indexOf("return { kind: 'ok', text: '已采用这一块",
        mainSource.indexOf('function decideVideoProposal'))
    );
    assert.ok(adoptionFlow.indexOf('videoUndo = {')
      < adoptionFlow.indexOf('videoProposal = null;'));
    assert.ok(adoptionFlow.indexOf('videoProposal = null;')
      < adoptionFlow.indexOf('removeOwnedVideoProposal('));
    assert.match(adoptionFlow,
      /catch \(error\) \{\n    refreshVideoWorkspaceSnapshot\(\);/,
      'adopt 清理失败也必须刷新出 adopted + canUndo，再返回结果未知');

    const visibleProposal = {
      proposalToken,
      plan: { text: '# 建议副本\n' },
      proposalHash: null,
      proposalBinding: null,
      submitState: 'sending'
    };
    let bindingReads = 0;
    const bindingFailure = main.bindEstablishedVideoProposal(visibleProposal, () => {
      bindingReads += 1;
      const error = new Error('模拟 inode 回读失败');
      error.code = 'ERR_PATH_CHANGED';
      throw error;
    });
    assert.deepEqual(bindingFailure, { bound: false, code: 'ERR_PATH_CHANGED' });
    assert.equal(bindingReads, 1);
    assert.equal(visibleProposal.proposalToken, proposalToken,
      '写成功后的建议状态必须保留，不能留下无状态 orphan');
    assert.equal(visibleProposal.submitState, 'unknown');
    assert.equal(visibleProposal.proposalBinding, null);
    assert.equal(visibleProposal.proposalHash, cockpit.hashText(visibleProposal.plan.text));
    const blockSubmitSource = mainSource.slice(
      mainSource.indexOf('async function submitVideoBlockAction'),
      mainSource.indexOf('function decideVideoProposal')
    );
    assert.ok(blockSubmitSource.indexOf('videoProposal = {')
      < blockSubmitSource.indexOf('bindEstablishedVideoProposal('),
    '建议文件成功后必须先建立可见状态，再尝试 binding 回读');
    assert.match(blockSubmitSource,
      /if \(!binding\.bound\) \{[\s\S]*pushVideoWorkspaceState\(\);[\s\S]*throw new Error/,
      'binding 回读失败必须保持 unknown 卡并在模型提交前停止');

    const cleanupTmp = fs.realpathSync(fs.mkdtempSync(
      path.join(os.tmpdir(), 'whaledock-proposal-cleanup-')
    ));
    try {
      fs.mkdirSync(path.join(cleanupTmp, '00_鲸坞建议'));
      const cleanupRootStat = fs.lstatSync(cleanupTmp, { bigint: true });
      const cleanupRootIdentity = {
        dev: String(cleanupRootStat.dev), ino: String(cleanupRootStat.ino)
      };
      const cleanupRelative = '00_鲸坞建议/cleanup.md';
      const cleanupPath = path.join(cleanupTmp, cleanupRelative);
      const cleanupProposal = {
        plan: { record: { proposalRelativePath: cleanupRelative } }
      };
      fs.writeFileSync(cleanupPath, '# 原建议\n', 'utf8');
      const unchanged = cockpit.readDocument(cleanupTmp, cleanupRelative);
      assert.equal(main.removeOwnedVideoProposal(
        cleanupTmp, cleanupProposal, cleanupRootIdentity,
        unchanged.hash, unchanged.binding
      ), true, 'error/rejected 时未变化的受管建议必须能精确清理');
      assert.equal(fs.existsSync(cleanupPath), false);

      fs.writeFileSync(cleanupPath, '# 新建议\n', 'utf8');
      const beforeChange = cockpit.readDocument(cleanupTmp, cleanupRelative);
      fs.writeFileSync(cleanupPath, '# 已被外部改动\n', 'utf8');
      assert.equal(main.removeOwnedVideoProposal(
        cleanupTmp, cleanupProposal, cleanupRootIdentity,
        beforeChange.hash, beforeChange.binding
      ), false, '建议内容变化后必须保留并进入 unknown，不能误删');
      assert.equal(fs.existsSync(cleanupPath), true);

      fs.renameSync(cleanupPath, `${cleanupPath}.old`);
      fs.writeFileSync(cleanupPath, '# 新建议\n', 'utf8');
      const rebound = cockpit.readDocument(cleanupTmp, cleanupRelative);
      assert.equal(rebound.hash, beforeChange.hash, '测试替换实体保持同 hash');
      assert.equal(main.removeOwnedVideoProposal(
        cleanupTmp, cleanupProposal, cleanupRootIdentity,
        beforeChange.hash, beforeChange.binding
      ), false, '同 hash 换 inode 也必须保留，不能按路径误删');
    } finally {
      fs.rmSync(cleanupTmp, { recursive: true, force: true });
    }
  });

  await test('发布页绑定 source/checklist 身份，七灯、AI、去重与写后回读 fail-closed', async () => {
    const sourceContentRef = `content-${'1'.repeat(24)}`;
    const sourceProjectToken = `project-${'2'.repeat(24)}`;
    const publishContentRef = `content-${'3'.repeat(24)}`;
    const publishTokens = Array.from({ length: 20 }, (_unused, index) => (
      `project-${(index + 3).toString(16).repeat(24).slice(0, 24)}`
    ));
    let publishVersion = 0;
    let publishExists = false;
    let createWrites = 0;
    let actionCalls = 0;
    let nowMs = Date.parse('2026-08-25T12:00:00.000Z');
    const checklistText = () => [
      '---', 'title: 项目 A · 发布检查', 'stage: publish',
      'status: needs-decision', 'aiDisclosure: unknown',
      'source: 02_脚本/项目A.md',
      'updated: 2026-08-25T11:59:59.000Z', '---', '',
      '- [ ] 封面已确认 <!-- whaledock:cover -->',
      '- [ ] 标题已确认 <!-- whaledock:title -->',
      '- [ ] 标签话题已确认 <!-- whaledock:topics -->',
      '- [ ] 发布时间由本人确认 <!-- whaledock:timing -->',
      '- [ ] 置顶评论已准备 <!-- whaledock:pinned-comment -->',
      '- [ ] 平台 AI 内容标识已准备 <!-- whaledock:ai-label -->',
      '- [ ] 已由本人在平台发布 <!-- whaledock:published -->', ''
    ].join('\n');
    let publishText = checklistText();
    const publishDocument = () => ({
      stage: 'publish', text: publishText, hash: cockpit.hashText(publishText),
      fields: cockpit.parseFrontMatter(publishText).fields
    });
    const card = (contentRef, projectToken, stage, title) => ({
      contentRef, projectToken, stage, title,
      stageLabel: stage === 'publish' ? '发布' : '写稿'
    });
    const catalog = () => ({
      generation: 70 + publishVersion,
      projects: [
        card(sourceContentRef, sourceProjectToken, 'script', '项目 A'),
        ...(publishExists
          ? [card(publishContentRef, publishTokens[publishVersion], 'publish', '项目 A · 发布检查')]
          : [])
      ]
    });
    const publishSurface = (contentRef, projectToken) => {
      if (contentRef === sourceContentRef && projectToken === sourceProjectToken) {
        return {
          kind: 'publish', contentRef, projectToken, title: '项目 A',
          stage: 'script', stageLabel: '写稿',
          updated: '2026-08-25T11:00:00.000Z', canCreate: true, checklist: null
        };
      }
      if (!publishExists || contentRef !== publishContentRef
          || projectToken !== publishTokens[publishVersion]) {
        const error = new Error('项目已变化');
        error.code = 'ERR_CONTEXT_PROJECT_STALE';
        throw error;
      }
      const document = publishDocument();
      return {
        kind: 'publish', contentRef, projectToken, title: '项目 A · 发布检查',
        stage: 'publish', stageLabel: '发布', updated: document.fields.updated,
        canCreate: false,
        checklist: main.publishChecklistSurface(document.text, document.fields.aiDisclosure)
      };
    };
    const publishAction = async (input) => {
      actionCalls += 1;
      if (input.type === 'create') {
        const created = !publishExists;
        if (created) {
          publishExists = true;
          createWrites += 1;
        }
        return {
          kind: 'ok', created, contentRef: publishContentRef,
          projectToken: publishTokens[publishVersion],
          text: created ? '已创建发布检查单。' : '已复用唯一检查单。'
        };
      }
      nowMs += 1000;
      const request = input.type === 'light'
        ? { action: 'toggle-publish-light', lightId: input.lightId, checked: input.checked }
        : { action: 'set-ai-disclosure', value: input.value };
      const mutation = main.patchVideoPublishDocument(publishDocument(), request, nowMs);
      publishText = mutation.text;
      publishVersion += 1;
      return { kind: 'ok', text: '已写回发布检查单。' };
    };
    const ops = main.contextPocWorkspaceFileOperations({
      catalog, publishSurface, publishAction
    });
    const current = { assertCurrent: () => true };

    const identityInput = { contentRef: sourceContentRef, projectToken: sourceProjectToken };
    assert.deepEqual(ops['publish.read'].validate(identityInput), identityInput);
    assert.deepEqual(ops['publish.create'].validate(identityInput), identityInput);
    assert.throws(() => ops['publish.read'].validate({ ...identityInput, path: '/private/a.md' }));
    assert.deepEqual(ops['publish.update'].validate({
      contentRef: publishContentRef, projectToken: publishTokens[0],
      type: 'light', lightId: 'cover', checked: true
    }), {
      contentRef: publishContentRef, projectToken: publishTokens[0],
      type: 'light', lightId: 'cover', checked: true
    });
    assert.deepEqual(ops['publish.update'].validate({
      contentRef: publishContentRef, projectToken: publishTokens[0],
      type: 'ai-disclosure', value: 'ai'
    }), {
      contentRef: publishContentRef, projectToken: publishTokens[0],
      type: 'ai-disclosure', value: 'ai'
    });
    for (const invalid of [
      { contentRef: publishContentRef, projectToken: publishTokens[0], type: 'light', lightId: 'cover' },
      { contentRef: publishContentRef, projectToken: publishTokens[0], type: 'light', lightId: 'cover', checked: true, value: 'ai' },
      { contentRef: publishContentRef, projectToken: publishTokens[0], type: 'ai-disclosure', value: 'yes' },
      { contentRef: publishContentRef, projectToken: publishTokens[0], type: 'ai-disclosure', value: 'ai', checked: true }
    ]) assert.throws(() => ops['publish.update'].validate(invalid));

    const sourceRead = ops['publish.read'].redact(await ops['publish.read'].handle({
      input: identityInput, context: current
    }));
    assert.deepEqual(sourceRead, {
      kind: 'publish', contentRef: sourceContentRef, projectToken: sourceProjectToken,
      title: '项目 A', stage: 'script', stageLabel: '写稿',
      updated: '2026-08-25T11:00:00.000Z', canCreate: true, checklist: null
    });

    const createdPair = await Promise.all([1, 2].map(async () => {
      const raw = await ops['publish.create'].handle({ input: identityInput, context: current });
      return ops['publish.create'].redact(raw);
    }));
    assert.deepEqual(createdPair.map((result) => result.created).sort(), [false, true]);
    assert.equal(createWrites, 1, '同源并发创建不得双写');
    for (const result of createdPair) {
      assert.equal(result.sourceContentRef, sourceContentRef);
      assert.equal(result.sourceProjectToken, sourceProjectToken);
      assert.equal(result.surface.contentRef, publishContentRef);
      assert.equal(result.surface.stage, 'publish');
      assert.equal(result.surface.checklist.structureValid, true);
      assert.equal(result.surface.checklist.ready, false);
      assert.deepEqual(result.surface.checklist.lights.map((light) => light.id), [
        'cover', 'title', 'topics', 'timing', 'pinned-comment', 'ai-label', 'published'
      ]);
      assert.equal(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 5600, true);
      assert.doesNotMatch(JSON.stringify(result),
        /(?:source:|relativePath|absolutePath|frontmatter|binding|root|hash|rawPrompt|SECRET)/i);
    }

    let token = publishTokens[publishVersion];
    const mutate = async (patch) => {
      const raw = await ops['publish.update'].handle({
        input: { contentRef: publishContentRef, projectToken: token, ...patch },
        context: current
      });
      const result = ops['publish.update'].redact(raw);
      assert.notEqual(result.surface.projectToken, token);
      token = result.surface.projectToken;
      assert.equal(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 5600, true);
      return result;
    };
    let mutation = await mutate({ type: 'ai-disclosure', value: 'ai' });
    assert.equal(mutation.surface.checklist.aiDisclosure, 'ai');
    assert.equal(mutation.surface.checklist.ready, false,
      'ai + AI 灯未勾是合法未 ready 态');
    mutation = await mutate({ type: 'light', lightId: 'ai-label', checked: true });
    assert.equal(mutation.surface.checklist.lights[5].checked, true);
    mutation = await mutate({ type: 'ai-disclosure', value: 'not-ai' });
    assert.equal(mutation.surface.checklist.aiDisclosure, 'not-ai');
    assert.equal(mutation.surface.checklist.lights[5].checked, false,
      'not-ai 不得伪装成已打平台 AI 标识');
    assert.equal(mutation.surface.checklist.lights[5].satisfied, true);
    for (const lightId of ['cover', 'title', 'topics', 'timing', 'pinned-comment']) {
      mutation = await mutate({ type: 'light', lightId, checked: true });
    }
    assert.equal(mutation.surface.checklist.ready, true);
    mutation = await mutate({ type: 'light', lightId: 'published', checked: true });
    assert.equal(mutation.surface.checklist.published, true);
    publishText = main.patchPublishLight(
      publishText, 'ai-label', true, cockpit.hashText(publishText)
    );
    publishVersion += 1;
    token = publishTokens[publishVersion];
    assert.equal(publishSurface(publishContentRef, token).checklist.published, true,
      '外部脏 not-ai + AI 灯不得使结构整体失效');
    mutation = await mutate({ type: 'ai-disclosure', value: 'not-ai' });
    assert.equal(mutation.surface.checklist.lights[5].checked, false);
    assert.equal(mutation.surface.checklist.lights[6].checked, false,
      '同值披露清理脏 AI 灯时，operation 终态也必须确认 raw published 已清');
    assert.equal(mutation.surface.checklist.published, false);
    mutation = await mutate({ type: 'light', lightId: 'published', checked: true });
    assert.equal(mutation.surface.checklist.published, true);
    mutation = await mutate({ type: 'light', lightId: 'cover', checked: false });
    assert.equal(mutation.surface.checklist.published, false);
    assert.equal(mutation.surface.checklist.lights[6].checked, false,
      '任一前置灯改变必须清 raw published');

    const callsBeforeStale = actionCalls;
    let staleError;
    try {
      await ops['publish.update'].handle({
        input: {
          contentRef: publishContentRef, projectToken: publishTokens[0],
          type: 'light', lightId: 'cover', checked: true
        }, context: current
      });
    } catch (error) { staleError = error; }
    assert.equal(ops['publish.update'].errorCode(staleError), 'operation-stale');
    assert.equal(actionCalls, callsBeforeStale, '旧 token 不得进入写回');

    const malformedText = publishText.replace(
      '<!-- whaledock:cover -->',
      '<!-- whaledock:cover --> <!--  whaledock: title -->'
    );
    const malformedToken = token;
    const malformedOps = main.contextPocWorkspaceFileOperations({
      catalog,
      publishSurface: (contentRef, projectToken) => {
        const base = publishSurface(contentRef, projectToken);
        if (contentRef !== publishContentRef) return base;
        const fields = cockpit.parseFrontMatter(malformedText).fields;
        return {
          ...base,
          checklist: main.publishChecklistSurface(malformedText, fields.aiDisclosure)
        };
      },
      publishAction: async () => { throw new Error('不应写入'); }
    });
    const malformed = malformedOps['publish.read'].redact(
      await malformedOps['publish.read'].handle({
        input: { contentRef: publishContentRef, projectToken: malformedToken },
        context: current
      })
    );
    assert.equal(malformed.checklist.structureValid, false);
    let malformedError;
    try {
      await malformedOps['publish.update'].handle({
        input: {
          contentRef: publishContentRef, projectToken: malformedToken,
          type: 'light', lightId: 'cover', checked: true
        }, context: current
      });
    } catch (error) { malformedError = error; }
    assert.equal(malformedOps['publish.update'].errorCode(malformedError), 'operation-failed');

    let uncertainCalls = 0;
    const uncertainOps = main.contextPocWorkspaceFileOperations({
      catalog,
      publishSurface,
      publishAction: async () => {
        uncertainCalls += 1;
        return { kind: 'ok', text: '已写回但 token 未轮换' };
      }
    });
    let uncertainError;
    try {
      await uncertainOps['publish.update'].handle({
        input: {
          contentRef: publishContentRef, projectToken: token,
          type: 'light', lightId: 'cover', checked: true
        }, context: current
      });
    } catch (error) { uncertainError = error; }
    assert.equal(uncertainOps['publish.update'].errorCode(uncertainError), 'outcome-unknown');
    assert.equal(uncertainCalls, 1, '写后不确定绝不重试');

    let staleSideEffects = 0;
    const staleOps = main.contextPocWorkspaceFileOperations({
      catalog: () => { staleSideEffects += 1; return catalog(); },
      publishSurface: () => { staleSideEffects += 1; return sourceRead; },
      publishAction: () => { staleSideEffects += 1; return {}; }
    });
    for (const operation of ['publish.read', 'publish.create']) {
      await assert.rejects(staleOps[operation].handle({
        input: identityInput, context: { assertCurrent: () => false }
      }));
    }
    await assert.rejects(staleOps['publish.update'].handle({
      input: {
        contentRef: publishContentRef, projectToken: token,
        type: 'light', lightId: 'cover', checked: true
      }, context: { assertCurrent: () => false }
    }));
    assert.equal(staleSideEffects, 0, '换绑后三个发布 operation 都必须零副作用');

    for (const code of ['ERR_ROOT_CHANGED', 'ERR_ROOT_UNREADABLE',
      'ERR_PATH_SYMLINK', 'ERR_PATH_OUTSIDE', 'ERR_PATH_NOT_FILE', 'ERR_CAS_MISMATCH']) {
      assert.equal(ops['publish.update'].errorCode({ code }), 'operation-stale', code);
    }
    assert.throws(() => ops['publish.read'].redact({
      ...sourceRead, relativePath: '02_脚本/项目A.md'
    }));
    assert.throws(() => ops['publish.create'].redact({
      ...createdPair[0], rawPrompt: 'SECRET'
    }));

    const mainSource = source('main.js');
    const sceneActionStart = mainSource.indexOf('async function runVideoSceneAction');
    const createFlow = mainSource.slice(
      mainSource.indexOf("if (request.action === 'create-publish-checklist')", sceneActionStart),
      mainSource.indexOf("if (request.action === 'toggle-publish-light')", sceneActionStart)
    );
    assert.match(createFlow, /\['script', 'shoot', 'edit'\]\.includes\(document\.stage\)/);
    assert.match(createFlow, /findVideoPublishDocumentsBySource/);
    assert.match(createFlow,
      /videoPublishChecklistRelativePath\(document\.relativePath\)[\s\S]*writeVideoExclusive/,
      '仅由 canonical source 定位的独占目标 + wx 才能将并发创建收口到一份');
    assert.doesNotMatch(createFlow, /videoFileStem\(document\.title\)/,
      '创建 claim 不得依赖可变 title');
    const publishTargetFlow = mainSource.slice(
      mainSource.indexOf('function videoPublishChecklistRelativePath'),
      mainSource.indexOf('function videoTacticRevisionKey')
    );
    assert.match(publishTargetFlow,
      /safeRelativePath\(sourceRelativePath\)[\s\S]*createHash\('sha256'\)[\s\S]*digest\('hex'\)/);
    assert.doesNotMatch(publishTargetFlow, /\.slice\(/,
      '独占 claim 使用完整 source hash，不得使用可碰撞的短后缀');
    assert.match(createFlow, /error\.code !== 'EEXIST'[\s\S]*findVideoPublishDocumentsBySource/);
    assert.equal((createFlow.match(/assertVideoPublishIdentitySource/g) || []).length, 4,
      '新建、首读/写前复用与 EEXIST 竞态均必须终态回读 source 绑定');
    const dedupeFlow = mainSource.slice(
      mainSource.indexOf('function findVideoPublishDocumentsBySource'),
      mainSource.indexOf('function videoPublishIdentityForRelativePath')
    );
    assert.match(dedupeFlow, /scanned\.truncated/);
    assert.match(dedupeFlow, /08_发布检查/);
  });

  await test('复盘打法库分页绑定 collection，固化终态与安全投影 fail-closed', async () => {
    const reviewContentRef = `content-${'a'.repeat(24)}`;
    const reviewProjectToken = `project-${'b'.repeat(24)}`;
    const changedReviewToken = `project-${'c'.repeat(24)}`;
    const collectionA = `collection-${'d'.repeat(24)}`;
    const collectionB = `collection-${'e'.repeat(24)}`;
    const current = { assertCurrent: () => true };
    const tactic = (index, override = {}) => ({
      contentRef: `content-${String(index + 1).repeat(24).slice(0, 24)}`,
      projectToken: `project-${String(index + 4).repeat(24).slice(0, 24)}`,
      title: `打法 ${index + 1}`,
      summary: index === 0 ? '鲸'.repeat(80) : `已验证的第 ${index + 1} 条经验。`,
      summaryTruncated: index === 0,
      sourceTitle: '复盘来源',
      updated: '2026-08-25T12:00:00.000Z',
      ...override
    });
    const tactics = Array.from({ length: 5 }, (_unused, index) => tactic(index));
    let activeReviewToken = reviewProjectToken;
    let activeReviewStage = 'review';
    let activeCollectionToken = collectionA;
    let activeComplete = true;
    let collectionCalls = 0;
    let solidifyCalls = 0;
    let solidifyCreated = true;
    const catalog = () => ({
      generation: 81,
      projects: [
        {
          contentRef: reviewContentRef, projectToken: activeReviewToken,
          title: '真实复盘', stage: activeReviewStage, stageLabel: '复盘'
        },
        ...tactics.map((item) => ({
          contentRef: item.contentRef, projectToken: item.projectToken,
          title: item.title, stage: 'asset', stageLabel: '打法资产'
        }))
      ]
    });
    const tacticsCollection = () => {
      collectionCalls += 1;
      return {
        collectionToken: activeCollectionToken,
        complete: activeComplete,
        tactics
      };
    };
    const solidifyAction = async () => {
      solidifyCalls += 1;
      return {
        kind: 'ok', created: solidifyCreated,
        contentRef: tactics[0].contentRef,
        projectToken: tactics[0].projectToken,
        text: '底层已完成唯一固化'
      };
    };
    const tacticSurface = (identity) => {
      const result = tactics.find((item) => item.contentRef === identity.contentRef
        && item.projectToken === identity.projectToken);
      if (!result) throw new Error('打法已变化');
      return result;
    };
    const ops = main.contextPocWorkspaceFileOperations({
      catalog, tacticsCollection, solidifyAction, tacticSurface
    });
    const identity = {
      contentRef: reviewContentRef, projectToken: reviewProjectToken
    };
    const page0Input = {
      ...identity, cursor: 0, limit: 4, collectionToken: null
    };
    assert.deepEqual(ops['review.tactics.read'].validate(page0Input), page0Input);
    assert.deepEqual(ops['review.solidify'].validate(identity), identity);
    for (const invalid of [
      { ...page0Input, cursor: -1 },
      { ...page0Input, cursor: 513 },
      { ...page0Input, limit: 0 },
      { ...page0Input, limit: 5 },
      { ...page0Input, collectionToken: collectionA },
      { ...page0Input, cursor: 1, collectionToken: null },
      { ...page0Input, cursor: 1, collectionToken: 'collection-not-opaque' },
      { ...page0Input, relativePath: '07_打法库/私有.md' }
    ]) assert.throws(() => ops['review.tactics.read'].validate(invalid));
    assert.throws(() => ops['review.solidify'].validate({
      ...identity, sourceHash: 'f'.repeat(64)
    }));

    const first = ops['review.tactics.read'].redact(
      await ops['review.tactics.read'].handle({ input: page0Input, context: current })
    );
    assert.deepEqual(Object.keys(first).sort(), [
      'collectionToken', 'complete', 'contentRef', 'cursor', 'itemCount',
      'kind', 'nextCursor', 'projectToken', 'tactics'
    ]);
    assert.equal(first.kind, 'tactics');
    assert.equal(first.contentRef, reviewContentRef);
    assert.equal(first.projectToken, reviewProjectToken);
    assert.equal(first.collectionToken, collectionA);
    assert.equal(first.itemCount, 5);
    assert.equal(first.complete, true);
    assert.equal(first.cursor, 0);
    assert.equal(first.nextCursor, 4);
    assert.equal(first.tactics.length, 4);
    assert.equal(Buffer.byteLength(first.tactics[0].summary, 'utf8'), 240,
      '中文摘要上限按 UTF-8 bytes 计算');
    for (const item of first.tactics) {
      assert.deepEqual(Object.keys(item).sort(), [
        'contentRef', 'projectToken', 'sourceTitle', 'summary',
        'summaryTruncated', 'title', 'updated'
      ]);
    }
    assert.equal(Buffer.byteLength(JSON.stringify(first), 'utf8') <= 5600, true);
    assert.doesNotMatch(JSON.stringify(first),
      /relativePath|absolutePath|sourceHash|topicId|frontmatter|\"body\"|metrics|rawPrompt|\/private/i);

    const second = ops['review.tactics.read'].redact(
      await ops['review.tactics.read'].handle({
        input: {
          ...identity, cursor: 4, limit: 4, collectionToken: collectionA
        }, context: current
      })
    );
    assert.equal(second.collectionToken, collectionA);
    assert.equal(second.cursor, 4);
    assert.equal(second.tactics.length, 1);
    assert.equal(second.nextCursor, null);
    const terminalEmpty = ops['review.tactics.read'].redact(
      await ops['review.tactics.read'].handle({
        input: {
          ...identity, cursor: 5, limit: 4, collectionToken: collectionA
        }, context: current
      })
    );
    assert.equal(terminalEmpty.collectionToken, collectionA);
    assert.deepEqual(terminalEmpty.tactics, []);
    assert.equal(terminalEmpty.nextCursor, null);

    const emptyOps = main.contextPocWorkspaceFileOperations({
      catalog,
      tacticsCollection: () => ({
        collectionToken: collectionA, complete: true, tactics: []
      })
    });
    const empty = emptyOps['review.tactics.read'].redact(
      await emptyOps['review.tactics.read'].handle({ input: page0Input, context: current })
    );
    assert.equal(empty.collectionToken, collectionA,
      '空打法库也必须返回合法 collection token');
    assert.deepEqual(empty.tactics, []);
    assert.equal(empty.itemCount, 0);
    assert.equal(empty.complete, true);

    activeComplete = false;
    const partial = ops['review.tactics.read'].redact(
      await ops['review.tactics.read'].handle({ input: page0Input, context: current })
    );
    assert.equal(partial.complete, false);
    assert.equal(partial.itemCount, 5,
      'partial 时 itemCount 只表示本次安全可见资产');
    activeComplete = true;

    activeCollectionToken = collectionB;
    let collectionDrift;
    try {
      await ops['review.tactics.read'].handle({
        input: {
          ...identity, cursor: 4, limit: 4, collectionToken: collectionA
        }, context: current
      });
    } catch (error) { collectionDrift = error; }
    assert.equal(ops['review.tactics.read'].errorCode(collectionDrift), 'operation-stale');
    activeCollectionToken = collectionA;

    const duplicateAcrossPages = tactics.map((item) => ({ ...item }));
    duplicateAcrossPages[4].projectToken = duplicateAcrossPages[0].projectToken;
    const duplicateOps = main.contextPocWorkspaceFileOperations({
      catalog,
      tacticsCollection: () => ({
        collectionToken: collectionA, complete: true, tactics: duplicateAcrossPages
      })
    });
    let duplicateError;
    try {
      await duplicateOps['review.tactics.read'].handle({
        input: page0Input, context: current
      });
    } catch (error) { duplicateError = error; }
    assert.equal(duplicateOps['review.tactics.read'].errorCode(duplicateError),
      'operation-failed');

    const tooManyOps = main.contextPocWorkspaceFileOperations({
      catalog,
      tacticsCollection: () => ({
        collectionToken: collectionA, complete: false,
        tactics: Array.from({ length: 513 }, (_unused, index) => tactic(index))
      })
    });
    let tooManyError;
    try {
      await tooManyOps['review.tactics.read'].handle({
        input: page0Input, context: current
      });
    } catch (error) { tooManyError = error; }
    assert.equal(tooManyOps['review.tactics.read'].errorCode(tooManyError),
      'operation-failed');

    const solidified = ops['review.solidify'].redact(
      await ops['review.solidify'].handle({ input: identity, context: current })
    );
    assert.deepEqual(Object.keys(solidified).sort(), [
      'created', 'kind', 'message', 'sourceContentRef',
      'sourceProjectToken', 'tactic'
    ]);
    assert.equal(solidified.kind, 'review-solidify');
    assert.equal(solidified.created, true);
    assert.equal(solidified.sourceContentRef, reviewContentRef);
    assert.equal(solidified.sourceProjectToken, reviewProjectToken);
    assert.notEqual(solidified.tactic.contentRef, reviewContentRef);
    assert.notEqual(solidified.tactic.projectToken, reviewProjectToken);
    assert.equal(typeof solidified.message, 'string');
    assert.equal(Boolean(solidified.message), true);
    assert.equal(Buffer.byteLength(solidified.message, 'utf8') <= 240, true);
    assert.equal(Buffer.byteLength(JSON.stringify(solidified), 'utf8') <= 5600, true);
    solidifyCreated = false;
    const reused = ops['review.solidify'].redact(
      await ops['review.solidify'].handle({ input: identity, context: current })
    );
    assert.equal(reused.created, false);
    assert.equal(solidifyCalls, 2);

    for (const malformed of [
      { ...first, relativePath: '07_打法库/泄漏.md' },
      { ...first, tactics: [{ ...first.tactics[0], body: 'SECRET' }] },
      { ...first, tactics: [{ ...first.tactics[0], title: 'x'.repeat(121) }] },
      { ...first, tactics: [{ ...first.tactics[0], summary: '鲸'.repeat(81) }] }
    ]) assert.throws(() => ops['review.tactics.read'].redact(malformed));
    for (const malformed of [
      { ...solidified, sourceHash: 'f'.repeat(64) },
      { ...solidified, message: '' },
      { ...solidified, message: '鲸'.repeat(81) },
      { ...solidified, tactic: {
        ...solidified.tactic, contentRef: reviewContentRef
      } },
      { ...solidified, tactic: {
        ...solidified.tactic, projectToken: reviewProjectToken
      } }
    ]) assert.throws(() => ops['review.solidify'].redact(malformed));

    let drifted = false;
    const sourceDriftOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({
        projects: [
          {
            contentRef: reviewContentRef,
            projectToken: drifted ? changedReviewToken : reviewProjectToken,
            stage: 'review'
          },
          {
            contentRef: tactics[0].contentRef,
            projectToken: tactics[0].projectToken,
            stage: 'asset'
          }
        ]
      }),
      solidifyAction: async () => {
        drifted = true;
        return {
          kind: 'ok', created: true,
          contentRef: tactics[0].contentRef,
          projectToken: tactics[0].projectToken,
          text: '已可能写入'
        };
      },
      tacticSurface
    });
    let sourceDriftError;
    try {
      await sourceDriftOps['review.solidify'].handle({ input: identity, context: current });
    } catch (error) { sourceDriftError = error; }
    assert.equal(sourceDriftOps['review.solidify'].errorCode(sourceDriftError),
      'outcome-unknown');

    const malformedActionOps = main.contextPocWorkspaceFileOperations({
      catalog,
      solidifyAction: async () => ({
        kind: 'ok', created: true,
        contentRef: tactics[0].contentRef,
        projectToken: tactics[0].projectToken,
        text: '已可能写入', relativePath: '07_打法库/泄漏.md'
      })
    });
    let malformedActionError;
    try {
      await malformedActionOps['review.solidify'].handle({
        input: identity, context: current
      });
    } catch (error) { malformedActionError = error; }
    assert.equal(malformedActionOps['review.solidify'].errorCode(malformedActionError),
      'outcome-unknown');

    const unknownOps = main.contextPocWorkspaceFileOperations({
      catalog,
      solidifyAction: async () => {
        const error = new Error('写后无法确认');
        error.code = 'ERR_OPERATION_OUTCOME_UNKNOWN';
        throw error;
      }
    });
    let unknownError;
    try {
      await unknownOps['review.solidify'].handle({ input: identity, context: current });
    } catch (error) { unknownError = error; }
    assert.equal(unknownOps['review.solidify'].errorCode(unknownError), 'outcome-unknown');

    activeReviewStage = 'script';
    const beforeWrongStage = solidifyCalls;
    let wrongStageError;
    try {
      await ops['review.solidify'].handle({ input: identity, context: current });
    } catch (error) { wrongStageError = error; }
    assert.equal(ops['review.solidify'].errorCode(wrongStageError), 'operation-failed');
    assert.equal(solidifyCalls, beforeWrongStage,
      '非 review 卡不得进入底层固化');
    activeReviewStage = 'review';

    let staleSideEffects = 0;
    const staleOps = main.contextPocWorkspaceFileOperations({
      catalog: () => { staleSideEffects += 1; return catalog(); },
      tacticsCollection: () => { staleSideEffects += 1; return {}; },
      solidifyAction: () => { staleSideEffects += 1; return {}; }
    });
    await assert.rejects(staleOps['review.tactics.read'].handle({
      input: page0Input, context: { assertCurrent: () => false }
    }));
    await assert.rejects(staleOps['review.solidify'].handle({
      input: identity, context: { assertCurrent: () => false }
    }));
    assert.equal(staleSideEffects, 0);

    for (const code of ['ERR_ROOT_CHANGED', 'ERR_ROOT_UNREADABLE',
      'ERR_PATH_SYMLINK', 'ERR_PATH_OUTSIDE', 'ERR_PATH_NOT_FILE',
      'ERR_CONTEXT_PROJECT_STALE']) {
      assert.equal(ops['review.tactics.read'].errorCode({ code }), 'operation-stale', code);
    }
    assert.equal(ops['review.solidify'].errorCode({
      code: 'ERR_VIDEO_RECOVERY_REQUIRED'
    }), 'outcome-unknown');
    assert.equal(collectionCalls >= 5, true);

    const mainSource = source('main.js');
    const sceneActionStart = mainSource.indexOf('async function runVideoSceneAction');
    const solidifyScene = mainSource.slice(
      mainSource.indexOf("if (request.action === 'solidify-tactic')", sceneActionStart),
      mainSource.indexOf("throw new Error('视频现场动作未实现')", sceneActionStart)
    );
    assert.match(solidifyScene, /solidifyVideoTactic\(runtime, document, request\.projectToken\)/,
      '旧 scene action 也必须共用确定性固化 helper');
    assert.doesNotMatch(solidifyScene, /randomBytes|Date\.now|writeFile/);
    const collectionFlow = mainSource.slice(
      mainSource.indexOf('function videoTacticCollection'),
      mainSource.indexOf('function videoTacticWorkspaceSurface')
    );
    assert.match(collectionFlow,
      /records\.map\(\(record\) => \[record\.relativePath, record\.hash\]\)/,
      'collection token 只能绑定 epoch + ordered asset\(path,hash\)');
    assert.doesNotMatch(collectionFlow, /sourceTitleChanged|complete\s*,\s*records/);
  });

  await test('拍摄打开与历史同时绑定真实 03 口播稿，分页与副作终态 fail-closed', async () => {
    const epoch = 91;
    const sourceRelativePath = '03_口播稿/真实口播.md';
    const sourceText = '这是真实口播稿。';
    const sourceHash = cockpit.hashText(sourceText);
    const contentRef = main.videoContentRef(epoch, sourceRelativePath);
    const projectToken = main.videoProjectToken(epoch, sourceRelativePath, sourceHash);
    const changedHash = cockpit.hashText(`${sourceText}\n已变化`);
    const collectionA = `collection-${'a'.repeat(24)}`;
    const collectionB = `collection-${'b'.repeat(24)}`;
    const current = { assertCurrent: () => true };
    const records = Array.from({ length: 5 }, (_unused, index) => ({
      recordRef: (index + 1).toString(16).padStart(24, '0'),
      title: index === 0 ? '鲸'.repeat(40) : `拍摄记录 ${index + 1}`,
      confirmedCount: index % 3,
      totalShots: 2,
      missingCount: 2 - (index % 3),
      retakeCount: index,
      allConfirmed: index % 3 === 2
    }));
    let cardStage = 'shoot';
    let activeCollectionToken = collectionA;
    let activeComplete = true;
    let openState = 'opened';
    let sourceReads = 0;
    let openCalls = 0;
    let historyCalls = 0;
    const catalog = () => ({
      generation: 91,
      projects: [{
        contentRef, projectToken, title: '真实口播',
        stage: cardStage, stageLabel: '拍摄'
      }]
    });
    const shootSource = () => {
      sourceReads += 1;
      return {
        runtime: { epoch },
        record: {
          relativePath: sourceRelativePath, hash: sourceHash, stage: 'shoot'
        },
        document: {
          relativePath: sourceRelativePath, hash: sourceHash,
          stage: 'shoot', text: sourceText
        }
      };
    };
    const shootOpenAction = async () => {
      openCalls += 1;
      return { kind: 'shoot-open', state: openState };
    };
    const shootHistoryCollection = () => {
      historyCalls += 1;
      return {
        collectionToken: activeCollectionToken,
        complete: activeComplete,
        records
      };
    };
    const ops = main.contextPocWorkspaceFileOperations({
      catalog, shootSource, shootOpenAction, shootHistoryCollection
    });
    const identity = { contentRef, projectToken };
    const page0Input = {
      ...identity, cursor: 0, limit: 4, collectionToken: null
    };
    assert.deepEqual(ops['shoot.open'].validate(identity), identity);
    assert.deepEqual(ops['shoot.history.read'].validate(page0Input), page0Input);
    assert.throws(() => ops['shoot.open'].validate({
      ...identity, relativePath: sourceRelativePath
    }));
    for (const invalid of [
      { ...page0Input, cursor: -1 },
      { ...page0Input, cursor: 513 },
      { ...page0Input, limit: 0 },
      { ...page0Input, limit: 5 },
      { ...page0Input, collectionToken: collectionA },
      { ...page0Input, cursor: 1, collectionToken: null },
      { ...page0Input, cursor: 1, collectionToken: 'collection-not-opaque' },
      { ...page0Input, sourceHash }
    ]) assert.throws(() => ops['shoot.history.read'].validate(invalid));

    const openResults = [];
    for (const state of ['opened', 'focused', 'busy', 'unavailable']) {
      openState = state;
      const result = ops['shoot.open'].redact(await ops['shoot.open'].handle({
        input: identity, context: current
      }));
      openResults.push(result);
      assert.deepEqual(Object.keys(result).sort(), [
        'contentRef', 'kind', 'message', 'projectToken', 'state'
      ]);
      assert.equal(result.kind, 'shoot-open');
      assert.equal(result.contentRef, contentRef);
      assert.equal(result.projectToken, projectToken);
      assert.equal(result.state, state);
      assert.equal(result.message, main.shootingOpenMessage(state));
      assert.equal(Buffer.byteLength(result.message, 'utf8') <= 240, true);
      assert.doesNotMatch(JSON.stringify(result),
        /03_口播稿|relativePath|sourceHash|session|root|control|windowId|\/private/i);
    }
    assert.equal(openCalls, 4);
    assert.equal(sourceReads, 8, '每次打开必须在 disposition 前后各重读一次源 capability');
    assert.throws(() => ops['shoot.open'].redact({
      ...openResults[0], message: '/private/workspace/不得泄漏'
    }));
    assert.throws(() => ops['shoot.open'].redact({
      ...openResults[0], windowId: 123
    }));

    const page0 = ops['shoot.history.read'].redact(
      await ops['shoot.history.read'].handle({ input: page0Input, context: current })
    );
    assert.deepEqual(Object.keys(page0).sort(), [
      'collectionToken', 'complete', 'contentRef', 'cursor', 'itemCount',
      'kind', 'nextCursor', 'projectToken', 'records'
    ]);
    assert.equal(page0.kind, 'shoot-history');
    assert.equal(page0.contentRef, contentRef);
    assert.equal(page0.projectToken, projectToken);
    assert.equal(page0.collectionToken, collectionA);
    assert.equal(page0.itemCount, 5);
    assert.equal(page0.complete, true);
    assert.equal(page0.cursor, 0);
    assert.equal(page0.nextCursor, 4);
    assert.equal(page0.records.length, 4);
    assert.equal(Buffer.byteLength(page0.records[0].title, 'utf8'), 120);
    for (const record of page0.records) {
      assert.deepEqual(Object.keys(record).sort(), [
        'allConfirmed', 'confirmedCount', 'missingCount', 'recordRef',
        'retakeCount', 'title', 'totalShots'
      ]);
      assert.match(record.recordRef, /^[a-f0-9]{24}$/);
      assert.equal(record.confirmedCount + record.missingCount, record.totalShots);
      assert.equal(record.allConfirmed, record.missingCount === 0);
    }
    assert.equal(Buffer.byteLength(JSON.stringify(page0), 'utf8') <= 5600, true);
    assert.doesNotMatch(JSON.stringify(page0),
      /relativePath|sourceHash|session|root|platform|metrics|completedAt|createdAt|updatedAt|\/private/i);

    const page1 = ops['shoot.history.read'].redact(
      await ops['shoot.history.read'].handle({
        input: {
          ...identity, cursor: 4, limit: 4, collectionToken: collectionA
        }, context: current
      })
    );
    assert.equal(page1.records.length, 1);
    assert.equal(page1.nextCursor, null);
    const terminal = ops['shoot.history.read'].redact(
      await ops['shoot.history.read'].handle({
        input: {
          ...identity, cursor: 5, limit: 4, collectionToken: collectionA
        }, context: current
      })
    );
    assert.deepEqual(terminal.records, []);
    assert.equal(terminal.collectionToken, collectionA);
    assert.equal(terminal.nextCursor, null);

    const emptyOps = main.contextPocWorkspaceFileOperations({
      catalog, shootSource,
      shootHistoryCollection: () => ({
        collectionToken: collectionA, complete: true, records: []
      })
    });
    const empty = emptyOps['shoot.history.read'].redact(
      await emptyOps['shoot.history.read'].handle({ input: page0Input, context: current })
    );
    assert.equal(empty.collectionToken, collectionA);
    assert.equal(empty.itemCount, 0);
    assert.deepEqual(empty.records, []);
    assert.equal(empty.nextCursor, null);

    activeComplete = false;
    const partial = ops['shoot.history.read'].redact(
      await ops['shoot.history.read'].handle({ input: page0Input, context: current })
    );
    assert.equal(partial.complete, false);
    assert.equal(partial.itemCount, 5);
    activeComplete = true;

    activeCollectionToken = collectionB;
    let collectionDrift;
    try {
      await ops['shoot.history.read'].handle({
        input: {
          ...identity, cursor: 4, limit: 4, collectionToken: collectionA
        }, context: current
      });
    } catch (error) { collectionDrift = error; }
    assert.equal(ops['shoot.history.read'].errorCode(collectionDrift), 'operation-stale');
    activeCollectionToken = collectionA;
    assert.equal((await ops['shoot.history.read'].handle({
      input: {
        ...identity, cursor: 4, limit: 4, collectionToken: collectionA
      }, context: current
    })).records.length, 1, 'A→B→A 回到同一集合后可继续读 A 的后页');

    const duplicateRecords = records.map((record) => ({ ...record }));
    duplicateRecords[4].recordRef = duplicateRecords[0].recordRef;
    const duplicateOps = main.contextPocWorkspaceFileOperations({
      catalog, shootSource,
      shootHistoryCollection: () => ({
        collectionToken: collectionA, complete: true, records: duplicateRecords
      })
    });
    let duplicateError;
    try {
      await duplicateOps['shoot.history.read'].handle({
        input: page0Input, context: current
      });
    } catch (error) { duplicateError = error; }
    assert.equal(duplicateOps['shoot.history.read'].errorCode(duplicateError),
      'operation-failed');
    const tooManyOps = main.contextPocWorkspaceFileOperations({
      catalog, shootSource,
      shootHistoryCollection: () => ({
        collectionToken: collectionA, complete: false,
        records: Array.from({ length: 513 }, () => records[0])
      })
    });
    let tooManyError;
    try {
      await tooManyOps['shoot.history.read'].handle({
        input: page0Input, context: current
      });
    } catch (error) { tooManyError = error; }
    assert.equal(tooManyOps['shoot.history.read'].errorCode(tooManyError),
      'operation-failed');

    for (const malformed of [
      { ...page0, completedAt: '2026-08-25' },
      { ...page0, records: [{ ...page0.records[0], sourceHash }] },
      { ...page0, records: [{ ...page0.records[0], recordRef: `record-${'a'.repeat(24)}` }] },
      { ...page0, records: [{ ...page0.records[0], title: '鲸'.repeat(41) }] },
      { ...page0, records: [{ ...page0.records[0], missingCount: 1 }] },
      { ...page0, records: [{ ...page0.records[0], allConfirmed: false }] }
    ]) assert.throws(() => ops['shoot.history.read'].redact(malformed));

    const path04 = '04_素材清单/不是台词.md';
    const contentRef04 = main.videoContentRef(epoch, path04);
    const projectToken04 = main.videoProjectToken(epoch, path04, sourceHash);
    let forbiddenOpenCalls = 0;
    const pathOps = main.contextPocWorkspaceFileOperations({
      catalog: () => ({ projects: [{
        contentRef: contentRef04, projectToken: projectToken04, stage: 'shoot'
      }] }),
      shootSource: () => ({
        runtime: { epoch },
        record: { relativePath: path04, hash: sourceHash, stage: 'shoot' },
        document: { relativePath: path04, hash: sourceHash, stage: 'shoot' }
      }),
      shootOpenAction: () => {
        forbiddenOpenCalls += 1;
        return { kind: 'shoot-open', state: 'opened' };
      }
    });
    let pathError;
    try {
      await pathOps['shoot.open'].handle({
        input: { contentRef: contentRef04, projectToken: projectToken04 }, context: current
      });
    } catch (error) { pathError = error; }
    assert.equal(pathOps['shoot.open'].errorCode(pathError), 'operation-failed');
    assert.equal(forbiddenOpenCalls, 0, '04 素材清单即使 stage=shoot 也不得打开拍摄窗');

    cardStage = 'script';
    const callsBeforeWrongStage = openCalls;
    let stageError;
    try {
      await ops['shoot.open'].handle({ input: identity, context: current });
    } catch (error) { stageError = error; }
    assert.equal(ops['shoot.open'].errorCode(stageError), 'operation-failed');
    assert.equal(openCalls, callsBeforeWrongStage);
    cardStage = 'shoot';

    let driftReads = 0;
    const openDriftOps = main.contextPocWorkspaceFileOperations({
      catalog,
      shootSource: () => {
        driftReads += 1;
        const hash = driftReads === 1 ? sourceHash : changedHash;
        return {
          runtime: { epoch },
          record: { relativePath: sourceRelativePath, hash, stage: 'shoot' },
          document: { relativePath: sourceRelativePath, hash, stage: 'shoot' }
        };
      },
      shootOpenAction: () => ({ kind: 'shoot-open', state: 'opened' })
    });
    let openDriftError;
    try {
      await openDriftOps['shoot.open'].handle({ input: identity, context: current });
    } catch (error) { openDriftError = error; }
    assert.equal(openDriftOps['shoot.open'].errorCode(openDriftError), 'outcome-unknown');

    driftReads = 0;
    const historyDriftOps = main.contextPocWorkspaceFileOperations({
      catalog,
      shootSource: () => {
        driftReads += 1;
        const hash = driftReads === 1 ? sourceHash : changedHash;
        return {
          runtime: { epoch },
          record: { relativePath: sourceRelativePath, hash, stage: 'shoot' },
          document: { relativePath: sourceRelativePath, hash, stage: 'shoot' }
        };
      },
      shootHistoryCollection
    });
    let historyDriftError;
    try {
      await historyDriftOps['shoot.history.read'].handle({
        input: page0Input, context: current
      });
    } catch (error) { historyDriftError = error; }
    assert.equal(historyDriftOps['shoot.history.read'].errorCode(historyDriftError),
      'operation-stale', '只读历史后源漂移没有副作，应该 stale');

    const malformedOpenOps = main.contextPocWorkspaceFileOperations({
      catalog, shootSource,
      shootOpenAction: () => ({
        kind: 'shoot-open', state: 'opened', path: '/private/window'
      })
    });
    let malformedOpenError;
    try {
      await malformedOpenOps['shoot.open'].handle({ input: identity, context: current });
    } catch (error) { malformedOpenError = error; }
    assert.equal(malformedOpenOps['shoot.open'].errorCode(malformedOpenError),
      'outcome-unknown');
    const unknownOpenOps = main.contextPocWorkspaceFileOperations({
      catalog, shootSource,
      shootOpenAction: () => { throw new Error('聚焦后适配器失败'); }
    });
    let unknownOpenError;
    try {
      await unknownOpenOps['shoot.open'].handle({ input: identity, context: current });
    } catch (error) { unknownOpenError = error; }
    assert.equal(unknownOpenOps['shoot.open'].errorCode(unknownOpenError), 'outcome-unknown');

    let staleSideEffects = 0;
    const staleOps = main.contextPocWorkspaceFileOperations({
      catalog: () => { staleSideEffects += 1; return catalog(); },
      shootSource: () => { staleSideEffects += 1; return {}; },
      shootOpenAction: () => { staleSideEffects += 1; return {}; },
      shootHistoryCollection: () => { staleSideEffects += 1; return {}; }
    });
    await assert.rejects(staleOps['shoot.open'].handle({
      input: identity, context: { assertCurrent: () => false }
    }));
    await assert.rejects(staleOps['shoot.history.read'].handle({
      input: page0Input, context: { assertCurrent: () => false }
    }));
    assert.equal(staleSideEffects, 0);
    for (const code of ['ERR_ROOT_CHANGED', 'ERR_VIDEO_ROOT_CHANGED',
      'ERR_ROOT_UNREADABLE', 'ERR_PATH_SYMLINK', 'ERR_PATH_OUTSIDE',
      'ERR_PATH_NOT_FILE', 'ERR_CONTEXT_PROJECT_STALE']) {
      assert.equal(ops['shoot.history.read'].errorCode({ code }), 'operation-stale', code);
    }
    assert.equal(historyCalls >= 6, true);

    const mainSource = source('main.js');
    const openFlow = mainSource.slice(
      mainSource.indexOf('function openShootingWindowForProject'),
      mainSource.indexOf('function writeShootingOutputs')
    );
    assert.match(openFlow, /shootingRuntimeContext, runtime/);
    assert.match(openFlow, /rootIdentityKey: runtime\.rootIdentityKey/);
    assert.match(openFlow, /ERR_OPERATION_OUTCOME_UNKNOWN/);
    const historyFlow = mainSource.slice(
      mainSource.indexOf('function videoShootingHistoryCollection'),
      mainSource.indexOf('function shootingRuntimeBindingMatches')
    );
    assert.match(historyFlow, /scanShootingRecords/);
    assert.match(historyFlow, /parseOwnedRecord/);
    assert.match(historyFlow, /shooting-history\/v1/);
    assert.match(historyFlow,
      /left\.relativePath > right\.relativePath \? -1/,
      '历史资产必须按 relativePath 降序确定排列');
    const contextOpsFlow = mainSource.slice(
      mainSource.indexOf("'shoot.open': Object.freeze"),
      mainSource.indexOf("'project.action.prepare': Object.freeze")
    );
    assert.doesNotMatch(contextOpsFlow,
      /shooting:get|shooting:command|shooting:finish|sourceRelativePath|sourceHash|\.text/,
      '远端 workspace-files 不得直连本地拍摄窗 IPC 或脚本正文');
  });

  await test('shell 公开面按当前 sessionRef 投影，不泄露 ref、路径或标题', async () => {
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' }, bridgeModel: bridge
    });
    const ready = handshake();
    controller.state.connect(ready);
    controller.runtime.bridgeMounted = true;
    controller.runtime.handshake = ready;
    const sessionRef = `session-${'b'.repeat(64)}`;
    const staged = controller.state.stage({
      sessionRef,
      project: {
        workspaceKey: '/private/workspace/never-render',
        relativePath: '.',
        workbenchId: 'builtin:video',
        title: '不可下发的标题',
        projectRevision: null
      }
    });
    const envelope = staged.effects[0].envelope;
    controller.state.ack({
      contract: envelope.contract,
      clientInstanceId: envelope.clientInstanceId,
      hostInstanceId: envelope.hostInstanceId,
      sessionRef: envelope.sessionRef,
      revision: envelope.revision,
      state: 'effective'
    });
    controller.runtime.currentSessionRef = sessionRef;
    const surface = main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        packageVersionProof: '0.1.1-rc.2',
        contextBridgeMounted: true
      }
    });
    assert.equal(surface.state, 'effective');
    assert.match(surface.projectId, /^wdp1_/);
    const text = JSON.stringify(surface);
    assert.equal(text.includes('session-'), false);
    assert.equal(text.includes('/private/workspace'), false);
    assert.equal(text.includes('不可下发'), false);
    main.contextPocRememberTurnMiss(controller, {
      sessionRef: `session-${'c'.repeat(64)}`,
      turn: 1,
      reason: 'context-not-effective'
    });
    assert.equal(main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        packageVersionProof: '0.1.1-rc.2',
        contextBridgeMounted: true
      }
    }).state, 'effective', '其他 session 的 miss 不得污染当前 session');
    main.contextPocRememberTurnMiss(controller, {
      sessionRef,
      turn: 1,
      reason: 'context-not-effective'
    });
    const missed = main.contextPocShellSurface(controller, {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        packageVersionProof: '0.1.1-rc.2',
        contextBridgeMounted: true
      }
    });
    assert.equal(missed.state, 'degraded');
    assert.equal(missed.reason, 'context-not-effective');
    assert.equal(JSON.stringify(missed).includes('turn'), false);
  });

  await test('新 session 先发生 turn-miss、后首次 stage 仍持续显示未注入事实', async () => {
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' }, bridgeModel: bridge
    });
    const ready = handshake();
    controller.state.connect(ready);
    controller.runtime.bridgeMounted = true;
    controller.runtime.handshake = ready;
    const sessionA = `session-${'a'.repeat(64)}`;
    const sessionRef = `session-${'d'.repeat(64)}`;
    const project = (workspaceKey) => ({
      workspaceKey, relativePath: '.', workbenchId: 'builtin:video',
      title: '新会话项目', projectRevision: null
    });
    const stagedA = controller.state.stage({
      sessionRef: sessionA, project: project('/workspace/previous-session')
    });
    const envelopeA = stagedA.effects[0].envelope;
    controller.state.ack({
      contract: envelopeA.contract,
      clientInstanceId: envelopeA.clientInstanceId,
      hostInstanceId: envelopeA.hostInstanceId,
      sessionRef: sessionA,
      revision: envelopeA.revision,
      state: 'effective'
    });
    controller.runtime.currentSessionRef = sessionA;

    const unknownMiss = controller.state.observeTurnMiss({
      sessionRef,
      turn: 1,
      reason: 'context-not-effective'
    });
    assert.equal(unknownMiss.kind, 'ignored-stale');
    assert.equal(unknownMiss.reason, 'session-unavailable');
    assert.equal(main.contextPocShouldRememberTurnMiss(
      unknownMiss, sessionRef, sessionRef, 'selected'
    ), true);
    assert.equal(main.contextPocShouldRememberTurnMiss(
      unknownMiss, sessionRef, sessionA, 'selected'
    ), true, 'resolve(A) 后 journal 到达的 B miss 必须先按 session 保留');
    assert.equal(main.contextPocRememberTurnMiss(controller, {
      sessionRef,
      turn: 1,
      reason: 'context-not-effective'
    }), true);

    const runtime = {
      backendReady: true,
      spawnedByUs: true,
      state: {
        exited: false,
        packageVersionProof: '0.1.1-rc.2',
        contextBridgeMounted: true
      }
    };
    assert.equal(main.contextPocShellSurface(controller, runtime).state, 'effective',
      'B 的私有 miss 不得污染仍是当前选择的 A');
    controller.runtime.currentSessionRef = sessionRef;

    const staged = controller.state.stage({
      sessionRef,
      project: project('/workspace/new-session')
    });
    const envelope = staged.effects[0].envelope;
    controller.state.ack({
      contract: envelope.contract,
      clientInstanceId: envelope.clientInstanceId,
      hostInstanceId: envelope.hostInstanceId,
      sessionRef,
      revision: envelope.revision,
      state: 'effective'
    });
    assert.equal(main.contextPocShellSurface(controller, runtime).state, 'degraded');

    main.contextPocRememberTurnMiss(controller, {
      sessionRef: `session-${'e'.repeat(64)}`,
      turn: 9,
      reason: 'session-unavailable'
    });
    assert.equal(main.contextPocShellSurface(controller, runtime).state, 'degraded',
      '其他 session 的新 miss 不得覆盖当前 session 的历史事实');
    assert.equal(main.contextPocClearTurnMiss(controller, sessionRef, 1), false,
      '同一 turn 不能冒充后续 delivery 清除 miss');
    assert.equal(main.contextPocClearTurnMiss(controller, sessionRef, 2), true);
    assert.equal(main.contextPocShellSurface(controller, runtime).state, 'effective');

    const bounded = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' }, bridgeModel: bridge
    });
    for (let index = 0; index <= bridge.LIMITS.maxSessions; index += 1) {
      main.contextPocRememberTurnMiss(bounded, {
        sessionRef: `session-${index.toString(16).padStart(64, '0')}`,
        turn: 1,
        reason: 'context-not-effective'
      });
    }
    assert.equal(bounded.runtime.turnMisses.size, bridge.LIMITS.maxSessions);
    assert.equal(bounded.runtime.turnMisses.has(`session-${'0'.repeat(64)}`), false,
      '最旧的 miss 必须按固定上限淘汰');
  });

  await test('同 Host 重连保留状态，65 个 Host 代际不累积失效 opaque session', async () => {
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' }, bridgeModel: bridge
    });
    const project = {
      workspaceKey: '/workspace/host-generation', relativePath: '.',
      workbenchId: null, title: '代际回归', projectRevision: null
    };
    for (let index = 0; index <= bridge.LIMITS.maxSessions; index += 1) {
      const host = {
        ...handshake(),
        hostInstanceId: `host-generation-${index.toString(16).padStart(4, '0')}`
      };
      if (index > 0) controller.state.suspend('bridge-disconnected');
      const before = controller.state;
      const generation = main.contextPocConnectHost(controller, host);
      assert.equal(generation.hostChanged, index > 0);
      if (index > 0) assert.notEqual(controller.state, before);
      const sessionRef = `session-${index.toString(16).padStart(64, '0')}`;
      controller.runtime.currentSessionRef = sessionRef;
      controller.state.stage({ sessionRef, project });
      assert.equal(controller.state.snapshot().sessionCount, 1);

      if (index === 0) {
        const sameState = controller.state;
        controller.runtime.availabilityReason = 'bridge-disconnected';
        controller.state.suspend('bridge-disconnected');
        const reconnected = main.contextPocConnectHost(controller, host);
        assert.equal(reconnected.hostChanged, false);
        assert.equal(controller.state, sameState);
        assert.equal(controller.state.snapshot().sessionCount, 1);
        assert.equal(reconnected.connected.effects.length, 1,
          '同 Host transport 重连必须保留并重放当前 desired');
        controller.runtime.bridgeMounted = true;
        controller.runtime.handshake = host;
        const eligibleRuntime = {
          backendReady: true,
          spawnedByUs: true,
          state: {
            exited: false,
            packageVersionProof: '0.1.1-rc.2',
            contextBridgeMounted: true
          }
        };
        assert.equal(main.contextPocShellSurface(controller, eligibleRuntime).state, 'degraded',
          'handshake 后、selection/journal 未确认前不得重画旧 ref 绿态');
        controller.runtime.availabilityReason = null;
        assert.equal(main.contextPocShellSurface(controller, eligibleRuntime).state, 'queued');
      }
    }
    assert.equal(controller.state.snapshot().sessionCount, 1);
  });

  await test('待退役 turn 跨同 Host 断线保留，尾事件后精确释放', async () => {
    const controller = main.createContextPocController({
      env: { WHALEDOCK_CONTEXT_POC: '1' }, bridgeModel: bridge
    });
    const ready = { ...handshake(), hostInstanceId: 'host-retirement-reconnect' };
    main.contextPocConnectHost(controller, ready);
    const sessionA = `session-${'a'.repeat(64)}`;
    const sessionB = `session-${'b'.repeat(64)}`;
    const project = (workspaceKey) => ({
      workspaceKey, relativePath: '.', workbenchId: null,
      title: null, projectRevision: null
    });
    const stagedA = controller.state.stage({
      sessionRef: sessionA, project: project('/workspace/retired-a')
    });
    const envelopeA = stagedA.effects[0].envelope;
    controller.state.ack({
      contract: envelopeA.contract,
      clientInstanceId: envelopeA.clientInstanceId,
      hostInstanceId: envelopeA.hostInstanceId,
      sessionRef: sessionA,
      revision: envelopeA.revision,
      state: 'effective'
    });
    controller.state.observeHostTurnStart({
      sessionRef: sessionA, turn: 1, frozenRevision: 1
    });
    controller.runtime.currentSessionRef = sessionB;
    controller.runtime.retiredSessionRefs.add(sessionA);
    controller.state.stage({
      sessionRef: sessionB, project: project('/workspace/current-b')
    });

    controller.state.suspend('bridge-disconnected');
    const reconnected = main.contextPocConnectHost(controller, ready);
    assert.equal(reconnected.hostChanged, false);
    assert.equal(controller.runtime.currentSessionRef, sessionB);
    assert.equal(controller.runtime.retiredSessionRefs.has(sessionA), true);
    controller.state.observeTurnEnd({ sessionRef: sessionA, turn: 1 });
    assert.equal(main.contextPocReleaseRetiredSession(sessionA, controller), true);
    controller.runtime.retiredSessionRefs.delete(sessionA);
    assert.equal(controller.state.snapshot().sessionCount, 1);
    assert.equal(controller.state.snapshot(sessionA).session, null);

    const neverStaged = `session-${'c'.repeat(64)}`;
    controller.runtime.retiredSessionRefs.add(neverStaged);
    assert.equal(main.contextPocReleaseRetiredSession(neverStaged, controller), true,
      '首次 stage 前已切走的 ref 应以 noop 视作收口');
    controller.runtime.retiredSessionRefs.delete(neverStaged);
    assert.equal(controller.runtime.retiredSessionRefs.size, 0);
  });

  await test('主进程只消费 opaque selection 与事件，不读取 raw session 或注入 dsh DOM', async () => {
    const value = source('main.js');
    const start = value.indexOf('// ---------- v0.10 P0B：受管 rc.2 上下文桥 ----------');
    const end = value.indexOf('function budgetIsPaused()', start);
    assert.ok(start >= 0 && end > start);
    const block = value.slice(start, end);
    assert.match(block, /selection\/resolve/);
    assert.match(block, /context\/stage/);
    assert.match(block, /events\/read/);
    assert.match(block, /state\.ack\(event\.ack\)/);
    assert.match(block, /state\.observeHostTurnStart/);
    assert.match(block, /state\.observeTurnMiss/);
    assert.match(block, /state\.observeDelivery/);
    assert.match(block, /state\.observeTurnEnd/);
    assert.match(value, /state\.releaseSession/);
    assert.doesNotMatch(block, /currentSessionId|rawSessionId|executeJavaScript|insertCSS|ipcRenderer/);
    const viewBlock = value.slice(
      value.indexOf('// dsh 的远程页面'),
      value.indexOf('let attempts = 0;', value.indexOf('// dsh 的远程页面'))
    );
    assert.match(viewBlock, /new WebContentsView/);
    const view = viewBlock.slice(viewBlock.indexOf('const view = new WebContentsView'));
    assert.doesNotMatch(view, /preload|executeJavaScript|insertCSS/);
    const mainWindowBlock = value.slice(
      value.indexOf('function openMainWindow()'), value.indexOf('function layoutMainWindow()')
    );
    assert.match(mainWindowBlock,
      /const tryLoad = \(\) => \{[\s\S]*reloadHarnessView\(view, \{[\s\S]*transition: 'initial'/,
      '初载也必须走与菜单/恢复相同的 capability fence');
    assert.doesNotMatch(mainWindowBlock, /const target = harnessViewUrl\(\)/,
      '初载不得绕过 fence 直接取可降级的 plain URL');
  });

  await test('退役 turn 尾事件按序消费，但 effect 不借新 binding 串投', async () => {
    const state = bridge.createContextBridgeState({
      enabled: true,
      clientInstanceId: 'client-retirement01'
    });
    const ready = handshake();
    state.connect(ready);
    const sessionA = `session-${'a'.repeat(64)}`;
    const sessionB = `session-${'b'.repeat(64)}`;
    const first = state.stage({
      sessionRef: sessionA,
      project: {
        workspaceKey: '/workspace/a', relativePath: '.', workbenchId: null,
        title: 'A1', projectRevision: null
      }
    });
    state.ack({
      contract: bridge.CONTRACT_VERSION,
      clientInstanceId: first.effects[0].envelope.clientInstanceId,
      hostInstanceId: ready.hostInstanceId,
      sessionRef: sessionA,
      revision: 1,
      state: 'effective'
    });
    state.observeHostTurnStart({ sessionRef: sessionA, turn: 1, frozenRevision: 1 });
    state.stage({
      sessionRef: sessionA,
      project: {
        workspaceKey: '/workspace/a', relativePath: 'next', workbenchId: null,
        title: 'A2', projectRevision: null
      }
    });
    const currentB = state.stage({
      sessionRef: sessionB,
      project: {
        workspaceKey: '/workspace/b', relativePath: '.', workbenchId: null,
        title: 'B1', projectRevision: null
      }
    });
    assert.equal(currentB.effects.length, 1);
    const endedA = state.observeTurnEnd({ sessionRef: sessionA, turn: 1 });
    assert.equal(endedA.effects.length, 1);
    assert.deepEqual(main.contextPocCurrentEffects(endedA, sessionA, sessionB), [],
      'A 的 turn-end effect 不得通过 B 的 binding 发送');
    assert.deepEqual(main.contextPocCurrentEffects(
      endedA, sessionA, sessionA, 'none'
    ), [], 'selection 已失效时不得借旧 binding 发送尾部 effect');
    assert.equal(state.releaseSession({ sessionRef: sessionA }).kind, 'released');
    assert.deepEqual(
      main.contextPocCurrentEffects(currentB, sessionB, sessionB),
      currentB.effects
    );
  });

  await test('超过 64 条的 Host journal 必须追到 through cursor 才允许收口', async () => {
    const requested = [];
    const applied = [];
    const events = Array.from({ length: 65 }, (_value, index) => ({
      eventSeq: index + 1,
      type: 'fixture'
    }));
    const runtime = {
      cursor: 0,
      handshake: { hostInstanceId: 'host-pagination1' },
      transport: {
        async call(endpoint, payload) {
          assert.equal(endpoint, 'events/read');
          requested.push(payload.afterEventSeq);
          return {
            throughEventSeq: 65,
            resyncRequired: false,
            events: events.slice(payload.afterEventSeq, payload.afterEventSeq + 64)
          };
        }
      }
    };
    const drained = await main.contextPocDrainEventPages(runtime, {
      isCurrent: () => true,
      parse: (value) => value,
      applyEvent: async (_runtime, event) => { applied.push(event.eventSeq); },
      onCursor: () => {}
    });
    assert.deepEqual(requested, [0, 64]);
    assert.equal(drained.caughtUp, true);
    assert.equal(drained.changed, true);
    assert.equal(runtime.cursor, 65);
    assert.deepEqual(applied, Array.from({ length: 65 }, (_value, index) => index + 1));

    const cappedRuntime = {
      ...runtime,
      cursor: 0,
      transport: runtime.transport
    };
    const capped = await main.contextPocDrainEventPages(cappedRuntime, {
      isCurrent: () => true,
      parse: (value) => value,
      applyEvent: async () => {},
      onCursor: () => {},
      maxPages: 1
    });
    assert.equal(capped.caughtUp, false);
    assert.equal(cappedRuntime.cursor, 64);

    let current = true;
    let releaseApply;
    let applyStarted;
    const started = new Promise((resolve) => { applyStarted = resolve; });
    const release = new Promise((resolve) => { releaseApply = resolve; });
    const staleCursors = [];
    const staleRuntime = {
      cursor: 0,
      handshake: { hostInstanceId: 'host-stale-page1' },
      transport: {
        async call() {
          return {
            throughEventSeq: 1,
            resyncRequired: false,
            events: [{ eventSeq: 1, type: 'fixture' }]
          };
        }
      }
    };
    const staleDrain = main.contextPocDrainEventPages(staleRuntime, {
      isCurrent: () => current,
      parse: (value) => value,
      applyEvent: async () => {
        applyStarted();
        await release;
      },
      onCursor: (cursor) => staleCursors.push(cursor)
    });
    await started;
    current = false;
    releaseApply();
    const staleResult = await staleDrain;
    assert.deepEqual(staleResult, { caughtUp: false, changed: false });
    assert.equal(staleRuntime.cursor, 0);
    assert.deepEqual(staleCursors, [], '旧代 apply 返回后不得污染新代 cursor');
  });

  await test('生命周期先 drain 再 stage，重连保留身份/游标并对 gap 终止降级', async () => {
    const value = source('main.js');
    const tick = value.slice(
      value.indexOf('async function contextPocTick'),
      value.indexOf('async function startContextPocBridge')
    );
    assert.ok(tick.indexOf('contextPocDrainEventPages(runtime)')
      < tick.indexOf('state.stage({'));
    assert.ok(tick.indexOf('contextPocDrainEventPages(runtime)')
      < tick.indexOf('contextPocReleaseRetiredSession'));
    assert.ok(tick.indexOf('contextPocDrainEventPages(runtime)')
      < tick.indexOf('void contextPocPreferences.drain(runtime)'));
    assert.ok(tick.indexOf('contextPocSendEffects(runtime, staged.effects)')
      < tick.indexOf('void contextPocPreferences.drain(runtime)'),
    '偏好 sidecar 只能在本轮 core drain/stage 后后台启动');
    assert.ok(tick.indexOf('contextPocSendEffects(runtime, staged.effects)')
      < tick.indexOf('void contextPocWorkspaceFiles.drain(runtime)'),
    '文件 sidecar 只能在本轮 core drain/stage 后后台启动');
    assert.ok(tick.indexOf('contextPocDrainEventPages(runtime)')
      < tick.indexOf('void contextPocWorkspaceFiles.drain(runtime)'));
    assert.doesNotMatch(tick, /resetState\(/);
    assert.match(tick, /ERR_CONTEXT_POC_EVENT_GAP/);
    assert.match(tick, /runtime\.terminal = true/);
    assert.match(tick, /retiredSessionRefs/);
    assert.match(tick,
      /if \(!await contextPocSendEffects\(runtime, resumeEffects\)\) return;/);
    assert.match(tick,
      /if \(!await contextPocSendEffects\(runtime, staged\.effects\)\) return;/);
    assert.match(tick,
      /if \(!drained\.caughtUp\)[\s\S]*scheduleContextPocTick\(runtime, 0\);[\s\S]*return;/,
      '单轮未追平 journal 时必须安排下一拍，不能在 finally 后静默停轮询');
    const beforeCaughtUp = tick.slice(0, tick.indexOf('if (!drained.caughtUp)'));
    assert.doesNotMatch(beforeCaughtUp, /availabilityReason = null/,
      'selection resolve 后仍须等 journal caughtUp 才能恢复绿色公开态');
    const drain = value.slice(
      value.indexOf('async function contextPocDrainEventPages'),
      value.indexOf('async function wakeContextPocBridge')
    );
    assert.match(drain, /transport\.call\('events\/read'/);
    assert.match(drain, /eventHostInstanceId = runtime\.handshake\.hostInstanceId/);
    assert.match(drain, /runtime\.cursor === batch\.throughEventSeq/);
    assert.match(value, /frozenRevision !== event\.frozenRevision/);
    const sendEffects = value.slice(
      value.indexOf('async function contextPocSendEffects'),
      value.indexOf('async function contextPocApplyEvent')
    );
    assert.match(sendEffects,
      /await runtime\.transport\.call\('context\/stage'[\s\S]*if \(!contextPocRuntimeCurrent\(runtime\)\) return false;/,
      '旧代 stage response 不得进入新代 ACK/state');

    const start = value.slice(
      value.indexOf('async function startContextPocBridge'),
      value.indexOf('function budgetIsPaused')
    );
    assert.match(start, /contextPocConnectHost\(contextPocController, handshake\)/);
    assert.match(start, /resumeEffects: \[\.\.\.connected\.effects\]/);
    assert.match(start, /workspaceFilesBusy: false/);
    assert.doesNotMatch(start,
      /contextPocConnectHost\(contextPocController, handshake\)[\s\S]{0,180}availabilityReason = null/,
      'handshake 本身不能提前恢复旧 selection 的绿色状态');
    const connectHost = value.slice(
      value.indexOf('function contextPocConnectHost'),
      value.indexOf('function contextPocShellStateField')
    );
    assert.match(connectHost, /previousHost !== handshake\.hostInstanceId/);
    assert.match(connectHost, /controller\.resetState\(\)/);
    assert.match(connectHost, /controller\.runtime\.eventCursor = 0/);
    assert.match(connectHost, /controller\.runtime\.retiredSessionRefs\.clear\(\)/);

    const stop = value.slice(
      value.indexOf('function stopContextPocBridge'),
      value.indexOf('async function contextPocSendEffects')
    );
    assert.doesNotMatch(stop, /currentSessionRef\s*=\s*null/,
      '同 Host transport 暂停不能丢失当前 ref，否则无法识别断线期间的切换');
    assert.match(stop, /contextPocSuspend\(reason\)/);
    assert.doesNotMatch(tick,
      /contextPocDisconnect\('bridge-disconnected'\)[\s\S]{0,240}currentSessionRef\s*=\s*null/);
    assert.match(tick, /contextPocSuspend\('bridge-disconnected'\)/);

    const launch = value.slice(
      value.indexOf('async function launchEventLayer'),
      value.indexOf('async function handleEventTransportClosed')
    );
    assert.ok(launch.indexOf('await activateEventLayerForBackend')
      < launch.indexOf('startContextPocBridge(identity.state)'));
    const activate = value.slice(
      value.indexOf('async function activateEventLayerForBackend'),
      value.indexOf('async function launchEventLayer')
    );
    assert.match(activate, /disconnectContext: false/);

    const switcher = value.slice(
      value.indexOf('async function applyWorkbench'),
      value.indexOf('async function switchToHeavyWorkbench')
    );
    assert.match(switcher, /await wakeContextPocBridge\(\)/);

    const workspaceBinding = value.slice(
      value.indexOf('function contextPocWorkspaceFileBindingFor'),
      value.indexOf('function contextPocRuntimeCurrent')
    );
    assert.match(workspaceBinding, /selectionRevision !== runtime\.binding\.selectionRevision/);
    assert.match(workspaceBinding, /session\.effectiveRevision !== request\.contextRevision/);
    assert.match(workspaceBinding, /JSON\.stringify\(session\.effectiveProject\)/);
    assert.match(workspaceBinding, /videoRuntime\.generation !== identity\.workspaceGeneration/);
    assert.match(workspaceBinding, /rootIdentity\.dev/);
    assert.match(workspaceBinding, /assertVideoRuntimeIdentity\(videoRuntime\)/);
  });

  await test('打包独立携带 POC 资产且根生产依赖没有扩张', async () => {
    const pkg = JSON.parse(source('package.json'));
    const contextResource = pkg.build.extraResources.find((entry) => (
      entry.from === 'context-poc' && entry.to === 'context-poc'
    ));
    assert.deepEqual(contextResource.filter, [
      'context-bridge.patch.yml',
      'FORK-NOTICE.md',
      'plugin/package.json',
      'plugin/lib/index.js',
      'plugin/lib/client.js',
      'forks/ui-layout/package.json',
      'forks/ui-layout/LICENSE',
      'forks/ui-layout/lib/index.js',
      'forks/ui-layout/lib/invariant.js',
      'forks/ui-layout/lib/client.js',
      'forks/ui-conversation/package.json',
      'forks/ui-conversation/LICENSE',
      'forks/ui-conversation/lib/index.js',
      'forks/ui-conversation/lib/invariant.js',
      'forks/ui-conversation/lib/client.js'
    ]);
    assert.deepEqual(pkg.dependencies, {
      '@larksuiteoapi/node-sdk': '1.73.0'
    });
    const value = source('main.js');
    assert.match(value, /userDataPath: app\.getPath\('userData'\)/);
    assert.match(value, /const bundledResourcesPath = app\.isPackaged\s*\? process\.resourcesPath\s*: path\.join\(__dirname, 'vendor'\)/,
      '源码预览必须使用仓库已构建的 vendor/dsh-runtime，打包版继续使用 Resources');
    assert.match(value, /resourcesPath: bundledResourcesPath/);
    assert.match(value, /contextPocAssetRoot: app\.isPackaged/);
    assert.match(value, /contextPocEnabled: contextPocController\.enabled/);
  });

  console.log(`\nMAIN V0.10 CONTEXT P0B ALL PASS (${passed})`);
}

mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
