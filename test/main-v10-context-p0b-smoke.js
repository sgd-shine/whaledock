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

  await test('手动刷新重新签发 fragment，并保留同源 path/query', async () => {
    const loaded = [];
    const factoryOrigins = [];
    const view = {
      webContents: {
        isDestroyed: () => false,
        getURL: () => 'http://127.0.0.1:3080/session/current?native=preserved#cleared',
        async loadURL(value) { loaded.push(value); }
      }
    };
    const factory = (origin) => {
      factoryOrigins.push(origin);
      return `${origin}#whaledockController=controller-refresh01&whaledockSelectionToken=${'ab'.repeat(32)}`;
    };
    assert.equal(await main.reloadHarnessView(
      view, factory, 'http://127.0.0.1:3080/'
    ), true);
    assert.equal(await main.reloadHarnessView(
      view, factory, 'http://127.0.0.1:3080/'
    ), true);
    assert.deepEqual(factoryOrigins, [
      'http://127.0.0.1:3080/session/current?native=preserved',
      'http://127.0.0.1:3080/session/current?native=preserved'
    ]);
    assert.equal(loaded.length, 2, '每次刷新都必须重新调用 capability URL factory');
    assert.equal(loaded.every((value) => value.includes('whaledockSelectionToken=')), true);
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
    assert.match(recovery, /reloadHarnessView\(\)/,
      '后台恢复也必须重新签发一次性 fragment capability');
    assert.match(recovery, /后台恢复后重载界面失败（详情已脱敏）/);
    assert.doesNotMatch(recovery, /\.message|String\(|loadURL\(|harnessViewUrl\(/,
      '恢复失败日志不得拼接可能含完整 URL 的导航异常');
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
    assert.equal((value.match(/loadURL\(harnessViewUrl\(\)\)/g) || []).length, 1,
      '仅初次建 view 直接加载；菜单与后台恢复统一走 capability-aware reload');
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
      'plugin/package.json',
      'plugin/lib/index.js',
      'plugin/lib/client.js'
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
