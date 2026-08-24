'use strict';

// v0.10 上下文桥契约：只测纯状态机、脱敏投影与 fake transport effects。
// 本文件不启动 Electron/dsh，不读写文件，也不占用端口。
const assert = require('assert/strict');
const bridge = require('../lib/context-bridge');

const SESSION_A = `session-${'a'.repeat(64)}`;
const SESSION_B = `session-${'b'.repeat(64)}`;
const CLIENT = 'client-instance-0001';
const HOST = 'host-instance-0001';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  context-bridge: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  context-bridge: ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function project(overrides = {}) {
  return {
    workspaceKey: '/Users/test/鲸坞项目',
    relativePath: '02_脚本/样片.md',
    workbenchId: 'builtin:video-cockpit',
    title: '样片',
    projectRevision: 'c'.repeat(64),
    ...overrides
  };
}

function handshake(hostInstanceId = HOST) {
  return {
    contract: bridge.CONTRACT_VERSION,
    hostInstanceId,
    capabilities: [...bridge.CAPABILITIES]
  };
}

function ack(sessionRef, revision, state, overrides = {}) {
  return {
    contract: bridge.CONTRACT_VERSION,
    clientInstanceId: CLIENT,
    hostInstanceId: HOST,
    sessionRef,
    revision,
    state,
    ...overrides
  };
}

async function run() {
  await check('公开导出与环境门有限且只接受精确 1', async () => {
    assert.equal(bridge.CONTRACT_VERSION, 'whaledock.context-bridge/v1');
    assert.equal(bridge.FEATURE_ENV, 'WHALEDOCK_CONTEXT_POC');
    assert.deepEqual([...bridge.CAPABILITIES], [
      'per-session-revision', 'turn-freeze', 'revision-ack', 'delivery-proof'
    ]);
    assert.equal(bridge.LIMITS.maxSessions, 64);
    assert.equal(bridge.isContextPocEnabled({ WHALEDOCK_CONTEXT_POC: '1' }), true);
    for (const value of ['0', 'true', 'TRUE', ' 1', '1 ', '', undefined, 1, true]) {
      assert.equal(bridge.isContextPocEnabled({ WHALEDOCK_CONTEXT_POC: value }), false);
    }
    assert.equal(bridge.isContextPocEnabled(null), false);
    const previous = process.env.WHALEDOCK_CONTEXT_POC;
    try {
      process.env.WHALEDOCK_CONTEXT_POC = '1';
      assert.equal(bridge.isContextPocEnabled(), true, '默认参数必须真实支持 process.env');
    } finally {
      if (previous === undefined) delete process.env.WHALEDOCK_CONTEXT_POC;
      else process.env.WHALEDOCK_CONTEXT_POC = previous;
    }
  });

  await check('projectId 对同一 canonical 位置稳定，内容/工作台变化不改 ID', async () => {
    const first = bridge.deriveProjectId({
      workspaceKey: '/Users/test/鲸坞项目', relativePath: '02_脚本/样片.md'
    });
    const again = bridge.deriveProjectId({
      workspaceKey: '/Users/test/鲸坞项目', relativePath: '02_脚本/样片.md'
    });
    const normalizedSlash = bridge.deriveProjectId({
      workspaceKey: '/Users/test/鲸坞项目', relativePath: '02_脚本\\样片.md'
    });
    const moved = bridge.deriveProjectId({
      workspaceKey: '/Users/test/鲸坞项目-已移动', relativePath: '02_脚本/样片.md'
    });
    assert.match(first, /^wdp1_[a-f0-9]{32}$/);
    assert.equal(first, again);
    assert.equal(first, normalizedSlash);
    assert.notEqual(first, moved, '路径移动/重命名不保证保持同一 ID');

    const contextA = bridge.normalizeProjectContext(project());
    const contextB = bridge.normalizeProjectContext(project({
      workbenchId: 'user:another-workbench',
      title: '改名后的样片',
      projectRevision: 'd'.repeat(64)
    }));
    assert.equal(contextA.projectId, contextB.projectId);
  });

  await check('规范化上下文不泄露绝对路径并严格拒绝越界输入', async () => {
    const normalized = bridge.normalizeProjectContext(project());
    assert.deepEqual(Object.keys(normalized).sort(), [
      'projectId', 'projectRevision', 'relativePath', 'title', 'workbenchId'
    ]);
    assert.equal(JSON.stringify(normalized).includes('/Users/test'), false);
    assert.equal(normalized.relativePath, '02_脚本/样片.md');
    assert.equal(Object.isFrozen(normalized), true);

    const workspaceAtLimit = `/${'a'.repeat(bridge.LIMITS.maxWorkspaceBytes - 1)}`;
    const relativeAtLimit = 'a'.repeat(bridge.LIMITS.maxRelativePathBytes);
    assert.doesNotThrow(() => bridge.normalizeProjectContext(project({
      workspaceKey: workspaceAtLimit
    })));
    assert.doesNotThrow(() => bridge.normalizeProjectContext(project({
      relativePath: relativeAtLimit
    })));

    for (const invalid of [
      project({ workspaceKey: `${workspaceAtLimit}a` }),
      project({ relativePath: `${relativeAtLimit}a` }),
      project({ relativePath: '../秘密.md' }),
      project({ relativePath: '/tmp/秘密.md' }),
      project({ relativePath: '02_脚本/../秘密.md' }),
      project({ title: '坏\u0000标题' }),
      project({ title: '字'.repeat(bridge.LIMITS.maxTitleChars + 1) }),
      project({ projectRevision: 'not-a-hash' }),
      { ...project(), extra: true }
    ]) {
      assert.throws(
        () => bridge.normalizeProjectContext(invalid),
        (error) => error && error.code === 'ERR_CONTEXT_BRIDGE_CONTRACT'
      );
    }
    assert.throws(
      () => bridge.normalizeProjectContext(project({
        relativePath: '"'.repeat(bridge.LIMITS.maxRelativePathBytes)
      })),
      (error) => error && error.code === 'ERR_CONTEXT_BRIDGE_CONTRACT'
        && error.field === 'project',
      'JSON escaping 后的聚合上下文也必须受 maxContextBytes 限制'
    );
  });

  await check('handshake 必须包含全部能力且总数不得超过上限', async () => {
    const missingDelivery = bridge.createContextBridgeState({
      enabled: true, clientInstanceId: CLIENT
    });
    const missing = missingDelivery.connect({
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: HOST,
      capabilities: ['per-session-revision', 'turn-freeze', 'revision-ack']
    });
    assert.equal(missing.kind, 'degraded');
    assert.equal(missing.reason, 'handshake-invalid');

    const tooMany = bridge.createContextBridgeState({
      enabled: true, clientInstanceId: CLIENT
    });
    const extras = Array.from(
      { length: bridge.LIMITS.maxCapabilities - bridge.CAPABILITIES.length + 1 },
      (_value, index) => `extra-capability-${index}`
    );
    const overflow = tooMany.connect({
      contract: bridge.CONTRACT_VERSION,
      hostInstanceId: HOST,
      capabilities: [...bridge.CAPABILITIES, ...extras]
    });
    assert.equal(overflow.kind, 'degraded');
    assert.equal(overflow.reason, 'handshake-invalid');
    assert.deepEqual(overflow.effects, []);
  });

  await check('默认关闭时所有动作零 transport effect，公开面保持 disabled', async () => {
    const state = bridge.createContextBridgeState({ clientInstanceId: CLIENT });
    assert.deepEqual(state.snapshot(), {
      contract: bridge.CONTRACT_VERSION,
      enabled: false,
      connection: { state: 'disabled', reason: 'feature-disabled' },
      sessionCount: 0
    });
    assert.deepEqual(state.connect(handshake()).effects, []);
    assert.deepEqual(state.stage({ sessionRef: SESSION_A, project: project() }).effects, []);
    assert.deepEqual(bridge.publicContextBridgeSurface(state.snapshot()), {
      state: 'disabled',
      reason: 'feature-disabled',
      projectId: null,
      effectiveRevision: null,
      deliveredRevision: null,
      pendingRevision: null,
      frozen: false
    });
  });

  await check('未连接先保存 desired，握手后只回放最新 revision 的脱敏 effect', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    const staged = state.stage({ sessionRef: SESSION_A, project: project() });
    assert.equal(staged.kind, 'queued');
    assert.deepEqual(staged.effects, []);
    assert.equal(staged.snapshot.session.desiredRevision, 1);
    assert.equal(staged.snapshot.session.sentRevision, null);

    const connected = state.connect(handshake());
    assert.equal(connected.kind, 'connected');
    assert.equal(connected.effects.length, 1);
    assert.deepEqual(Object.keys(connected.effects[0]).sort(), ['envelope', 'type']);
    assert.equal(connected.effects[0].type, 'context-stage');
    assert.equal(connected.effects[0].envelope.revision, 1);
    assert.equal(connected.effects[0].envelope.sessionRef, SESSION_A);
    assert.equal(JSON.stringify(connected.effects[0]).includes('/Users/test'), false);
    assert.equal(connected.snapshot.session.sentRevision, 1);
  });

  await check('每个 session 独立递增，重复 payload 是 noop', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    const a1 = state.stage({ sessionRef: SESSION_A, project: project() });
    const aNoop = state.stage({ sessionRef: SESSION_A, project: project() });
    const a2 = state.stage({
      sessionRef: SESSION_A,
      project: project({ title: '样片第二版', projectRevision: 'd'.repeat(64) })
    });
    const b1 = state.stage({ sessionRef: SESSION_B, project: project() });
    assert.equal(a1.snapshot.session.desiredRevision, 1);
    assert.equal(aNoop.kind, 'noop');
    assert.equal(aNoop.effects.length, 0);
    assert.equal(aNoop.snapshot.session.desiredRevision, 1);
    assert.equal(a2.snapshot.session.desiredRevision, 2);
    assert.equal(b1.snapshot.session.desiredRevision, 1);
  });

  await check('session 总量与重连回放严格有界', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    for (let index = 0; index < bridge.LIMITS.maxSessions; index += 1) {
      const sessionRef = `session-${index.toString(16).padStart(64, '0')}`;
      state.stage({
        sessionRef,
        project: project({ relativePath: `02_脚本/${index}.md` })
      });
    }
    assert.equal(state.snapshot().sessionCount, bridge.LIMITS.maxSessions);
    assert.throws(
      () => state.stage({
        sessionRef: `session-${bridge.LIMITS.maxSessions.toString(16).padStart(64, '0')}`,
        project: project({ relativePath: '02_脚本/overflow.md' })
      }),
      (error) => error && error.code === 'ERR_CONTEXT_BRIDGE_CONTRACT'
    );
    state.disconnect('bridge-disconnected');
    const replayed = state.connect(handshake('host-instance-0002'));
    assert.equal(replayed.effects.length, bridge.LIMITS.maxSessions);
  });

  await check('turn freeze 阻止中途 effect，多次切换在 turn end 合并为最新项', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    const first = state.stage({ sessionRef: SESSION_A, project: project() });
    assert.equal(first.effects.length, 1);
    const firstProjectId = first.effects[0].envelope.project.projectId;
    const effective = state.ack(ack(SESSION_A, 1, 'effective'));
    assert.equal(effective.kind, 'accepted');
    assert.equal(effective.snapshot.session.effectiveRevision, 1);

    const started = state.observeTurnStart({ sessionRef: SESSION_A, turn: 7 });
    assert.equal(started.snapshot.session.frozenRevision, 1);
    const second = state.stage({
      sessionRef: SESSION_A,
      project: project({ title: '轮内第二版', projectRevision: 'd'.repeat(64) })
    });
    const third = state.stage({
      sessionRef: SESSION_A,
      project: project({
        relativePath: '02_脚本/轮内新项目.md',
        title: '轮内最终版',
        projectRevision: 'e'.repeat(64)
      })
    });
    assert.deepEqual(second.effects, []);
    assert.deepEqual(third.effects, []);
    assert.equal(third.snapshot.session.desiredRevision, 3);
    assert.equal(third.snapshot.session.effectiveRevision, 1);
    assert.equal(third.snapshot.session.pendingRevision, 3);
    const frozenSurface = bridge.publicContextBridgeSurface(third.snapshot);
    assert.equal(frozenSurface.state, 'awaiting-delivery');
    assert.equal(frozenSurface.frozen, true);
    assert.equal(frozenSurface.projectId, firstProjectId,
      '轮内 desired 项目变化不得覆盖 frozen 项目身份');
    assert.notEqual(third.snapshot.session.project.projectId, firstProjectId);

    const delivered = state.observeDelivery({
      contract: bridge.CONTRACT_VERSION,
      clientInstanceId: CLIENT,
      hostInstanceId: HOST,
      sessionRef: SESSION_A,
      openTurn: 7,
      frozenRevision: 1
    });
    assert.equal(delivered.kind, 'delivered');
    assert.equal(bridge.publicContextBridgeSurface(delivered.snapshot).projectId, firstProjectId,
      'A/rev1 的 delivery 不得显示成 pending 的 B 项目');

    const ended = state.observeTurnEnd({ sessionRef: SESSION_A, turn: 7 });
    assert.equal(ended.effects.length, 1);
    assert.equal(ended.effects[0].envelope.revision, 3);
    assert.equal(
      bridge.publicContextBridgeSurface(ended.snapshot).projectId,
      ended.effects[0].envelope.project.projectId,
      'turn end 后 queued surface 才切到最新 desired 项目'
    );
    assert.equal(ended.snapshot.session.sentRevision, 3);
    assert.equal(ended.snapshot.session.effectiveRevision, 1);
  });

  await check('queued/effective ACK 有限；stale 忽略，future 与实例错配不生效', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    const queued = state.ack(ack(SESSION_A, 1, 'queued'));
    assert.equal(queued.kind, 'accepted');
    assert.equal(queued.snapshot.session.ackedRevision, 1);
    assert.equal(queued.snapshot.session.effectiveRevision, null);
    const effective = state.ack(ack(SESSION_A, 1, 'effective'));
    assert.equal(effective.snapshot.session.effectiveRevision, 1);

    state.stage({
      sessionRef: SESSION_A,
      project: project({ projectRevision: 'd'.repeat(64) })
    });
    assert.equal(state.ack(ack(SESSION_A, 1, 'effective')).kind, 'ignored-stale');
    const wrongHost = state.ack(ack(SESSION_A, 2, 'effective', {
      hostInstanceId: 'host-instance-old0'
    }));
    assert.equal(wrongHost.kind, 'ignored-instance');
    assert.equal(wrongHost.snapshot.session.effectiveRevision, 1);

    const future = state.ack(ack(SESSION_A, 3, 'effective'));
    assert.equal(future.kind, 'rejected');
    assert.equal(future.reason, 'ack-future-revision');
    assert.equal(future.snapshot.connection.state, 'degraded');
    assert.equal(future.snapshot.session.effectiveRevision, 1);
  });

  await check('ACK 状态只单调前进，未知 host code 统一脱敏', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    assert.equal(state.ack(ack(SESSION_A, 1, 'queued')).kind, 'accepted');
    assert.equal(state.ack(ack(SESSION_A, 1, 'queued')).kind, 'noop');
    assert.equal(state.ack(ack(SESSION_A, 1, 'effective')).kind, 'accepted');
    assert.equal(state.ack(ack(SESSION_A, 1, 'effective')).kind, 'noop');
    assert.equal(state.ack(ack(SESSION_A, 1, 'queued')).kind, 'ignored-stale');
    assert.equal(state.ack(ack(SESSION_A, 1, 'rejected', {
      code: 'private-host-stack-code'
    })).kind, 'ignored-stale');
    assert.equal(state.snapshot(SESSION_A).session.effectiveRevision, 1);
    assert.equal(state.snapshot(SESSION_A).session.lastError, null);

    state.stage({
      sessionRef: SESSION_A,
      project: project({ title: '会被拒绝的第二版', projectRevision: 'd'.repeat(64) })
    });
    assert.equal(state.ack(ack(SESSION_A, 2, 'queued')).kind, 'accepted');
    const rejected = state.ack(ack(SESSION_A, 2, 'rejected', {
      code: 'private-host-stack-code'
    }));
    assert.equal(rejected.kind, 'rejected');
    assert.equal(rejected.reason, 'host-rejected');
    assert.equal(rejected.snapshot.session.ackedState, 'rejected');
    assert.equal(state.ack(ack(SESSION_A, 2, 'effective')).kind, 'ignored-stale');
    assert.equal(bridge.publicContextBridgeSurface(rejected.snapshot).reason, 'host-rejected');
    assert.equal(JSON.stringify(rejected).includes('private-host-stack-code'), false);
  });

  await check('pending 未生效时禁止开 turn，ACK 后只冻结最新项目', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    state.ack(ack(SESSION_A, 1, 'effective'));
    const pending = state.stage({
      sessionRef: SESSION_A,
      project: project({ relativePath: '02_脚本/B.md', title: '项目 B' })
    });
    const blocked = state.observeTurnStart({ sessionRef: SESSION_A, turn: 8 });
    assert.equal(blocked.kind, 'blocked');
    assert.equal(blocked.reason, 'context-not-effective');
    assert.equal(blocked.snapshot.session.openTurn, null);
    state.ack(ack(SESSION_A, 2, 'effective'));
    const started = state.observeTurnStart({ sessionRef: SESSION_A, turn: 8 });
    assert.equal(started.kind, 'turn-started');
    assert.equal(started.snapshot.session.frozenRevision, 2);
    assert.equal(started.snapshot.session.frozenProject.projectId,
      pending.snapshot.session.project.projectId);
  });

  await check('100 次双 session 乱序 ACK 不串线，stale/future/wrong-instance 全部 fail-closed', async () => {
    for (let index = 0; index < 100; index += 1) {
      const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
      state.connect(handshake());
      state.stage({ sessionRef: SESSION_A, project: project() });
      state.stage({ sessionRef: SESSION_B, project: project({ relativePath: '02_脚本/B.md' }) });
      state.stage({
        sessionRef: SESSION_A,
        project: project({ title: `A-${index}`, projectRevision: 'd'.repeat(64) })
      });

      const acceptB = () => state.ack(ack(SESSION_B, 1, 'effective'));
      const staleA = () => state.ack(ack(SESSION_A, 1, 'effective'));
      const firstPair = index % 2 === 0 ? [acceptB(), staleA()] : [staleA(), acceptB()];
      assert.equal(firstPair.find((item) => item.kind === 'accepted').kind, 'accepted');
      assert.equal(firstPair.find((item) => item.kind === 'ignored-stale').kind, 'ignored-stale');
      assert.equal(state.ack(ack(SESSION_A, 2, 'effective', {
        hostInstanceId: 'host-instance-old0'
      })).kind, 'ignored-instance');
      assert.equal(state.ack(ack(SESSION_A, 2, 'effective', {
        clientInstanceId: 'client-instance-old0'
      })).kind, 'ignored-instance');
      assert.equal(state.ack(ack(SESSION_A, 2, 'effective')).kind, 'accepted');
      assert.equal(state.snapshot(SESSION_A).session.effectiveRevision, 2);
      assert.equal(state.snapshot(SESSION_B).session.effectiveRevision, 1);

      const future = state.ack(ack(SESSION_A, 3, 'effective'));
      assert.equal(future.kind, 'rejected');
      assert.equal(future.reason, 'ack-future-revision');
      assert.equal(future.snapshot.session.effectiveRevision, 2);
      assert.equal(state.snapshot(SESSION_B).session.effectiveRevision, 1);
    }
  });

  await check('delivered 只接受匹配实例、session、openTurn 与 frozenRevision 的消息级回读', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    state.ack(ack(SESSION_A, 1, 'effective'));
    assert.equal(bridge.publicContextBridgeSurface(state.snapshot(SESSION_A)).state, 'effective');
    state.observeTurnStart({ sessionRef: SESSION_A, turn: 9 });
    assert.equal(
      bridge.publicContextBridgeSurface(state.snapshot(SESSION_A)).state,
      'awaiting-delivery'
    );

    const evidence = {
      contract: bridge.CONTRACT_VERSION,
      clientInstanceId: CLIENT,
      hostInstanceId: HOST,
      sessionRef: SESSION_A,
      openTurn: 9,
      frozenRevision: 1
    };
    assert.equal(state.observeDelivery({ ...evidence, openTurn: 8 }).kind, 'ignored-stale');
    assert.equal(state.observeDelivery({ ...evidence, frozenRevision: 2 }).kind, 'ignored-stale');
    assert.equal(state.observeDelivery({
      ...evidence, clientInstanceId: 'client-instance-old0'
    }).kind, 'ignored-instance');
    assert.equal(state.observeDelivery({
      ...evidence, hostInstanceId: 'host-instance-old0'
    }).kind, 'ignored-instance');
    assert.equal(state.observeDelivery({ ...evidence, sessionRef: SESSION_B }).kind, 'ignored-stale');
    assert.equal(state.snapshot(SESSION_A).session.deliveredRevision, null);

    const delivered = state.observeDelivery(evidence);
    assert.equal(delivered.kind, 'delivered');
    assert.equal(delivered.snapshot.session.deliveredRevision, 1);
    assert.equal(delivered.snapshot.session.deliveredTurn, 9);
    assert.deepEqual(bridge.publicContextBridgeSurface(delivered.snapshot), {
      state: 'delivered',
      reason: null,
      projectId: delivered.snapshot.session.project.projectId,
      effectiveRevision: 1,
      deliveredRevision: 1,
      pendingRevision: null,
      frozen: true
    });

    state.observeTurnEnd({ sessionRef: SESSION_A, turn: 9 });
    const disconnected = state.disconnect('bridge-disconnected');
    assert.equal(disconnected.snapshot.session.deliveredRevision, null);
    assert.equal(disconnected.snapshot.session.deliveredTurn, null);

    const wrongContract = bridge.createContextBridgeState({
      enabled: true, clientInstanceId: CLIENT
    });
    wrongContract.connect(handshake());
    wrongContract.stage({ sessionRef: SESSION_A, project: project() });
    wrongContract.ack(ack(SESSION_A, 1, 'effective'));
    wrongContract.observeTurnStart({ sessionRef: SESSION_A, turn: 9 });
    const refused = wrongContract.observeDelivery({
      ...evidence, contract: 'whaledock.context-bridge/v0'
    });
    assert.equal(refused.kind, 'rejected');
    assert.equal(refused.reason, 'delivery-protocol-mismatch');
    assert.equal(refused.snapshot.connection.state, 'degraded');
    assert.equal(refused.snapshot.session.deliveredRevision, null);
  });

  await check('turn 单调且新 turn 清除旧 delivery，迟到回读不能冒充新轮次', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    state.ack(ack(SESSION_A, 1, 'effective'));
    state.observeTurnStart({ sessionRef: SESSION_A, turn: 9 });
    const oldEvidence = {
      contract: bridge.CONTRACT_VERSION,
      clientInstanceId: CLIENT,
      hostInstanceId: HOST,
      sessionRef: SESSION_A,
      openTurn: 9,
      frozenRevision: 1
    };
    state.observeDelivery(oldEvidence);
    state.observeTurnEnd({ sessionRef: SESSION_A, turn: 9 });
    const reused = state.observeTurnStart({ sessionRef: SESSION_A, turn: 9 });
    assert.equal(reused.kind, 'ignored-stale');
    assert.equal(reused.reason, 'turn-stale');

    const next = state.observeTurnStart({ sessionRef: SESSION_A, turn: 10 });
    assert.equal(next.snapshot.session.deliveredRevision, null);
    assert.equal(bridge.publicContextBridgeSurface(next.snapshot).state, 'awaiting-delivery');
    assert.equal(state.observeDelivery(oldEvidence).kind, 'ignored-stale');
    assert.equal(state.snapshot(SESSION_A).session.deliveredRevision, null);
  });

  await check('turn 中断线会保持 fence-lost，结束后才允许向新 host 重放', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    const first = state.stage({ sessionRef: SESSION_A, project: project() });
    const frozenProjectId = first.snapshot.session.project.projectId;
    state.ack(ack(SESSION_A, 1, 'effective'));
    state.observeTurnStart({ sessionRef: SESSION_A, turn: 11 });
    const pending = state.stage({
      sessionRef: SESSION_A,
      project: project({ relativePath: '02_脚本/断线时的新项目.md', title: '项目 B' })
    });
    assert.notEqual(pending.snapshot.session.project.projectId, frozenProjectId);
    const disconnected = state.disconnect('bridge-disconnected');
    assert.equal(
      bridge.publicContextBridgeSurface(disconnected.snapshot).projectId,
      frozenProjectId,
      '断线降级时也必须显示真实 frozen 项目，不能显示 pending 项目'
    );
    const newHost = 'host-instance-0002';
    const reconnected = state.connect(handshake(newHost));
    assert.deepEqual(reconnected.effects, []);
    assert.deepEqual(bridge.publicContextBridgeSurface(reconnected.snapshot), {
      state: 'degraded',
      reason: 'turn-fence-lost',
      projectId: reconnected.snapshot.session.frozenProject.projectId,
      effectiveRevision: null,
      deliveredRevision: null,
      pendingRevision: 2,
      frozen: true
    });
    const lostDelivery = state.observeDelivery({
      contract: bridge.CONTRACT_VERSION,
      clientInstanceId: CLIENT,
      hostInstanceId: newHost,
      sessionRef: SESSION_A,
      openTurn: 11,
      frozenRevision: 1
    });
    assert.equal(lostDelivery.kind, 'rejected');
    assert.equal(lostDelivery.reason, 'turn-fence-lost');

    const ended = state.observeTurnEnd({ sessionRef: SESSION_A, turn: 11 });
    assert.equal(ended.effects.length, 1);
    assert.equal(ended.effects[0].envelope.hostInstanceId, newHost);
    assert.equal(ended.effects[0].envelope.revision, 2);
    assert.equal(ended.snapshot.session.turnFenceLost, false);
    assert.equal(ended.snapshot.session.lastError, null);
  });

  await check('断线清除旧 host 证明但保留 desired，新实例重放且旧 ACK 无效', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    state.ack(ack(SESSION_A, 1, 'effective'));
    const disconnected = state.disconnect('external-unproven');
    assert.equal(disconnected.snapshot.connection.state, 'degraded');
    assert.equal(disconnected.snapshot.session.desiredRevision, 1);
    assert.equal(disconnected.snapshot.session.effectiveRevision, null);
    assert.deepEqual(bridge.publicContextBridgeSurface(disconnected.snapshot), {
      state: 'degraded',
      reason: 'external-unproven',
      projectId: disconnected.snapshot.session.project.projectId,
      effectiveRevision: null,
      deliveredRevision: null,
      pendingRevision: 1,
      frozen: false
    });

    const newHost = 'host-instance-0002';
    const replayed = state.connect(handshake(newHost));
    assert.equal(replayed.effects.length, 1);
    assert.equal(replayed.effects[0].envelope.hostInstanceId, newHost);
    const oldAck = state.ack(ack(SESSION_A, 1, 'effective'));
    assert.equal(oldAck.kind, 'ignored-instance');
    assert.equal(oldAck.snapshot.session.effectiveRevision, null);
  });

  await check('turn 与 revision 边界 fail-closed，公开投影不透出 session/路径/标题', async () => {
    const state = bridge.createContextBridgeState({ enabled: true, clientInstanceId: CLIENT });
    state.connect(handshake());
    state.stage({ sessionRef: SESSION_A, project: project() });
    state.ack(ack(SESSION_A, 1, 'effective'));
    state.observeTurnStart({ sessionRef: SESSION_A, turn: 1 });
    assert.throws(
      () => state.observeTurnEnd({ sessionRef: SESSION_A, turn: 2 }),
      (error) => error && error.code === 'ERR_CONTEXT_BRIDGE_CONTRACT'
    );
    const surface = bridge.publicContextBridgeSurface(state.snapshot(SESSION_A));
    assert.deepEqual(Object.keys(surface).sort(), [
      'deliveredRevision', 'effectiveRevision', 'frozen', 'pendingRevision',
      'projectId', 'reason', 'state'
    ]);
    const text = JSON.stringify(surface);
    assert.equal(text.includes(SESSION_A), false);
    assert.equal(text.includes('/Users/test'), false);
    assert.equal(text.includes('样片'), false);

    const invalid = bridge.publicContextBridgeSurface({ unexpected: 'secret' });
    assert.deepEqual(invalid, {
      state: 'degraded',
      reason: 'invalid-snapshot',
      projectId: null,
      effectiveRevision: null,
      deliveredRevision: null,
      pendingRevision: null,
      frozen: false
    });

    const malformedProject = bridge.publicContextBridgeSurface({
      contract: bridge.CONTRACT_VERSION,
      enabled: true,
      connection: { state: 'ready', reason: null, hostInstanceId: HOST },
      session: {
        effectiveRevision: 1,
        deliveredRevision: null,
        pendingRevision: null,
        openTurn: null,
        lastError: null,
        effectiveProject: { projectId: Symbol('private-project') }
      }
    });
    assert.deepEqual(malformedProject, invalid,
      'malformed contract-shaped snapshot 必须安全降级，不能抛 TypeError');
  });

  console.log(failed === 0
    ? `\nCONTEXT BRIDGE ALL PASS (${passed})`
    : `\nCONTEXT BRIDGE FAILED (${failed}/${passed + failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { run };
