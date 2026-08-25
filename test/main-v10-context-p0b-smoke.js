'use strict';

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
process.env.WHALEDOCK_CONTEXT_POC = '1';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const main = require('../main.js');
const bridge = require('../lib/context-bridge');

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
    assert.match(value, /contextPocAssetRoot: app\.isPackaged/);
    assert.match(value, /contextPocEnabled: contextPocController\.enabled/);
  });

  console.log(`\nMAIN V0.10 CONTEXT P0B ALL PASS (${passed})`);
}

mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
