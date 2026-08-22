'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const remote = require('../lib/remote');

const ROOT = path.join(__dirname, '..');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  remote: ${name}`);
  } catch (error) {
    console.error(`FAIL  remote: ${name}`);
    throw error;
  }
}

function harness(options = {}) {
  let sensitivity = options.initialSensitivity || 'ordinary';
  const allowedApprovals = new Set(options.allowedApprovals || []);
  const approvalRecords = options.approvalRecords || new Map();
  const bindingRecords = options.bindingRecords || new Map(Object.entries(options.initialBindings || {}));
  const bindingRequests = [];
  const callerBindingHook = options.onBindingRequested;
  const service = remote.createRemoteService({
    operationTimeoutMs: options.operationTimeoutMs || 100,
    disconnectTimeoutMs: options.disconnectTimeoutMs || 100,
    receiveSink: options.receiveSink,
    applyApproval: options.applyApproval || (async (request) => {
      const previous = approvalRecords.get(request.requestToken);
      if (previous && (previous.status === 'applied' || previous.status === 'duplicate')) {
        return { status: 'duplicate', decision: previous.decision };
      }
      if (previous && previous.status === 'uncertain') return { status: 'uncertain' };
      if (!allowedApprovals.has(request.requestToken)) return { status: 'not-pending' };
      allowedApprovals.delete(request.requestToken);
      approvalRecords.set(request.requestToken, { status: 'processing', decision: request.decision });
      try {
        if (typeof options.approvalSink === 'function') await options.approvalSink(request);
      } catch (error) {
        approvalRecords.set(request.requestToken, { status: 'uncertain', decision: request.decision });
        throw error;
      }
      approvalRecords.set(request.requestToken, { status: 'applied', decision: request.decision });
      return { status: 'applied', decision: request.decision };
    }),
    auditEvent: options.auditEvent,
    onStateChanged: options.onStateChanged,
    classifyContent: options.classifyContent || (async () => sensitivity),
    persistBinding: options.persistBinding || (async ({ channelId, actorId, commitId }) => {
      bindingRecords.set(channelId, actorId);
      return commitId;
    }),
    readBinding: options.readBinding || (async ({ channelId }) => bindingRecords.get(channelId) || null),
    initialBindings: options.initialBindings,
    bindingTtlMs: options.bindingTtlMs,
    now: options.now,
    onBindingRequested: (value) => {
      bindingRequests.push(value);
      return typeof callerBindingHook === 'function' ? callerBindingHook(value) : true;
    }
  });
  return {
    service,
    bindingRequests,
    approvalRecords,
    setSensitivity: (value) => { sensitivity = value; },
    allowApproval: (value) => allowedApprovals.add(value)
  };
}

function session(overrides = {}) {
  return {
    disconnect: overrides.disconnect || (async () => {}),
    push: overrides.push || (async () => {}),
    approve: overrides.approve || (async () => {}),
    challengeBinding: overrides.challengeBinding || (async () => {})
  };
}

function confirmation(request) {
  return {
    bindingToken: request.bindingToken,
    challengeCode: request.challengeCode
  };
}

async function bind(owner, loopback, channelId, actorId = `${channelId}-owner`) {
  owner.service.registerAdapter(channelId, loopback.adapter);
  await owner.service.setEnabled(channelId, true);
  const before = owner.bindingRequests.length;
  const first = await loopback.emitReceive({ actorId, kind: 'text', content: '首次绑定消息' });
  assert.equal(first.accepted, false);
  assert.equal(owner.service.snapshot().channels[channelId].binding, 'pending');
  assert.equal(owner.bindingRequests.length, before + 1);
  const request = owner.bindingRequests.at(-1);
  assert.equal(request.channelId, channelId);
  assert.match(request.challengeCode, /^\d{6}$/);
  assert.ok(Number.isSafeInteger(request.expiresAt));
  assert.equal(loopback.snapshot().bindingChallenges.at(-1).challengeCode, request.challengeCode);
  await owner.service.confirmBinding(channelId, confirmation(request));
  assert.equal(owner.service.snapshot().channels[channelId].binding, 'bound');
  return actorId;
}

async function within(promise, timeoutMs = 800) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('测试等待超时')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor(check, timeoutMs = 300) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('测试条件未出现');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function run() {
  await test('固定三通道、三种推送与纯 Node 边界', async () => {
    assert.deepEqual(remote.CHANNELS, ['feishu', 'dingtalk', 'web']);
    assert.deepEqual(remote.PUSH_KINDS, ['approval', 'task-completed', 'report-ready']);
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'remote.js'), 'utf8');
    assert.equal(/require\(['"]electron['"]\)|child_process|\beval\s*\(|new\s+Function/.test(source), false);
    assert.equal(/remoteImCustomerService|genericRpc/.test(source), false);
  });

  await test('默认快照全关、分级 fail-closed，且所有公开快照不含账号正文路径凭据', async () => {
    const owner = harness({ initialSensitivity: 'customer' });
    const snapshot = owner.service.snapshot();
    assert.deepEqual(Object.keys(snapshot.channels), ['feishu', 'dingtalk', 'web']);
    for (const value of Object.values(snapshot.channels)) {
      assert.equal(value.enabled, false);
      assert.equal(value.state, 'disabled');
      assert.equal(value.binding, 'unbound');
      assert.equal(value.setupState, 'not-configured');
    }
    assert.equal(/actor|openid|userId|content|body|path|secret|token/i.test(JSON.stringify(snapshot)), false);
    await owner.service.close();
  });

  await test('启用未注册平台只显示 unavailable，不假装在线', async () => {
    const owner = harness();
    await owner.service.setEnabled('feishu', true);
    const value = owner.service.snapshot().channels.feishu;
    assert.equal(value.enabled, true);
    assert.equal(value.state, 'unavailable');
    assert.equal(value.reasonCode, 'adapter-missing');
    await owner.service.close();
  });

  await test('回环收件先桌面绑定，确认后才把正文交给固定 sink', async () => {
    const received = [];
    const owner = harness({ receiveSink: async (value) => received.push(value) });
    const loopback = remote.createLoopbackAdapter();
    const actorId = await bind(owner, loopback, 'feishu');
    assert.equal(received.length, 0, '首次绑定消息不得顺便入件');
    const result = await loopback.emitReceive({
      actorId, kind: 'link', content: 'https://example.invalid/idea'
    });
    assert.equal(result.accepted, true);
    assert.deepEqual(received, [{
      channelId: 'feishu', kind: 'link', sensitivity: 'ordinary', content: 'https://example.invalid/idea'
    }]);
    assert.equal(owner.service.snapshot().channels.feishu.counters.received, 1);
    await owner.service.close();
  });

  await test('真实平台 sourceId/receivedAt 只交受信 sink 做持久幂等，不进入公开快照', async () => {
    const received = [];
    const owner = harness({ receiveSink: async (value) => received.push(value) });
    const loopback = remote.createLoopbackAdapter();
    const actorId = await bind(owner, loopback, 'feishu');
    const result = await loopback.emitReceive({
      actorId,
      kind: 'text',
      content: '带来源标识',
      sourceId: 'om_message_123',
      receivedAt: '2026-08-22T00:00:00.000Z'
    });
    assert.equal(result.accepted, true);
    assert.equal(received[0].sourceId, 'om_message_123');
    assert.equal(received[0].receivedAt, '2026-08-22T00:00:00.000Z');
    assert.equal(JSON.stringify(owner.service.snapshot()).includes('om_message_123'), false);
    await assert.rejects(() => loopback.emitReceive({
      actorId,
      kind: 'text',
      content: '坏时间',
      sourceId: 'om_bad_time',
      receivedAt: '2026-08-22'
    }), /平台收件时间无效/);
    await owner.service.close();
  });

  await test('并发首绑只锁定第一人，拒绝后下一人须重发；旧确认卡不能跨连接使用', async () => {
    const owner = harness();
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('feishu', loopback.adapter);
    await owner.service.setEnabled('feishu', true);
    const [first, second] = await Promise.all([
      loopback.emitReceive({ actorId: 'actor-a', kind: 'text', content: 'A' }),
      loopback.emitReceive({ actorId: 'actor-b', kind: 'text', content: 'B' })
    ]);
    assert.equal(first.accepted, false);
    assert.equal(second.accepted, false);
    assert.equal(owner.bindingRequests.length, 1);
    const firstToken = owner.bindingRequests[0].bindingToken;
    await owner.service.rejectBinding('feishu', firstToken);
    await loopback.emitReceive({ actorId: 'actor-b', kind: 'text', content: 'B 再发' });
    assert.equal(owner.bindingRequests.length, 2);
    const secondRequest = owner.bindingRequests[1];
    await owner.service.setEnabled('feishu', false);
    await assert.rejects(() => owner.service.confirmBinding('feishu', confirmation(secondRequest)), /没有匹配/);
    assert.equal(/actor-a|actor-b/.test(JSON.stringify(owner.service.snapshot())), false);
    await owner.service.close();
  });

  await test('绑定码须双端一致且有 TTL，只在受信存储持久化后生效', async () => {
    let clock = 1_000;
    const persisted = [];
    const owner = harness({
      now: () => clock,
      bindingTtlMs: 20,
      persistBinding: async (value) => { persisted.push(value); return value.commitId; }
    });
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('feishu', loopback.adapter);
    await owner.service.setEnabled('feishu', true);
    await loopback.emitReceive({ actorId: 'attacker', kind: 'text', content: '抢首条' });
    const attackerRequest = owner.bindingRequests[0];
    await assert.rejects(() => owner.service.confirmBinding('feishu', {
      bindingToken: attackerRequest.bindingToken,
      challengeCode: '000000'
    }), /没有匹配/);
    clock += 21;
    await assert.rejects(
      () => owner.service.confirmBinding('feishu', confirmation(attackerRequest)),
      /没有匹配/
    );
    await loopback.emitReceive({ actorId: 'actual-owner', kind: 'text', content: '我的绑定' });
    const ownerRequest = owner.bindingRequests[1];
    await owner.service.confirmBinding('feishu', confirmation(ownerRequest));
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].channelId, 'feishu');
    assert.equal(persisted[0].actorId, 'actual-owner');
    assert.match(persisted[0].commitId, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(owner.service.snapshot()).includes('actual-owner'), false);
    await owner.service.close();

    const restored = harness({ initialBindings: { feishu: 'actual-owner' } });
    const restoredLoop = remote.createLoopbackAdapter();
    restored.service.registerAdapter('feishu', restoredLoop.adapter);
    await restored.service.setEnabled('feishu', true);
    const accepted = await restoredLoop.emitReceive({
      actorId: 'actual-owner', kind: 'text', content: '重启后仍是本人'
    });
    assert.equal(accepted.accepted, true);
    assert.equal(restored.bindingRequests.length, 0);
    await restored.service.close();
  });

  await test('绑定已写盘但回执超时时保持 pending，不会假报 unbound', async () => {
    const persistRelease = deferred();
    let durableActor = null;
    const owner = harness({
      operationTimeoutMs: 20,
      persistBinding: async ({ actorId, commitId }) => {
        durableActor = actorId;
        await persistRelease.promise;
        return commitId;
      }
    });
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('web', loopback.adapter);
    await owner.service.setEnabled('web', true);
    await loopback.emitReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
    const request = owner.bindingRequests[0];
    await assert.rejects(
      () => owner.service.confirmBinding('web', confirmation(request)),
      (error) => error.code === 'ERR_REMOTE_BINDING_PENDING'
    );
    assert.equal(durableActor, 'owner');
    assert.equal(owner.service.snapshot().channels.web.binding, 'pending');
    await assert.rejects(
      () => owner.service.rejectBinding('web', request.bindingToken),
      (error) => error.code === 'ERR_REMOTE_BINDING_PENDING'
    );

    const restarted = harness({ initialBindings: { web: durableActor } });
    assert.equal(restarted.service.snapshot().channels.web.binding, 'bound');
    await restarted.service.close();

    persistRelease.resolve();
    await waitFor(() => owner.service.snapshot().channels.web.binding === 'bound');
    assert.equal(JSON.stringify(owner.service.snapshot()).includes('owner'), false);
    await owner.service.close();
  });

  await test('绑定写盘后抛错会用权威 readback 对账，不依赖布尔猜测', async () => {
    let durableActor = null;
    const owner = harness({
      persistBinding: async ({ actorId }) => {
        durableActor = actorId;
        throw new Error('commit 后回执丢失');
      },
      readBinding: async () => durableActor
    });
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('web', loopback.adapter);
    await owner.service.setEnabled('web', true);
    await loopback.emitReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
    await owner.service.confirmBinding('web', confirmation(owner.bindingRequests[0]));
    assert.equal(owner.service.snapshot().channels.web.binding, 'bound');
    assert.equal(JSON.stringify(owner.service.snapshot()).includes('owner'), false);
    await owner.service.close();
  });

  await test('绑定 readback 瞬时失败后可用同一确认卡重试对账，不永久卡 pending', async () => {
    let durableActor = null;
    let reads = 0;
    const owner = harness({
      persistBinding: async ({ actorId }) => {
        durableActor = actorId;
        throw new Error('commit 后回执丢失');
      },
      readBinding: async () => {
        reads += 1;
        if (reads === 1) throw new Error('transient read');
        return durableActor;
      }
    });
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('web', loopback.adapter);
    await owner.service.setEnabled('web', true);
    await loopback.emitReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
    const card = confirmation(owner.bindingRequests[0]);
    await assert.rejects(
      () => owner.service.confirmBinding('web', card),
      (error) => error.code === 'ERR_REMOTE_BINDING_PENDING'
    );
    await owner.service.confirmBinding('web', card);
    assert.equal(reads, 2);
    assert.equal(owner.service.snapshot().channels.web.binding, 'bound');
    await owner.service.close();
  });

  await test('close 可抢占挂起的绑定写入/回读，同时保留 pending 未知态', async () => {
    for (const phase of ['persist', 'read']) {
      const blocked = deferred();
      const started = deferred();
      const owner = harness({
        operationTimeoutMs: 1_000,
        disconnectTimeoutMs: 40,
        persistBinding: phase === 'persist'
          ? async ({ commitId }) => { started.resolve(); await blocked.promise; return commitId; }
          : async () => { throw new Error('receipt lost'); },
        readBinding: phase === 'read'
          ? async () => { started.resolve(); await blocked.promise; return null; }
          : async () => null
      });
      const loopback = remote.createLoopbackAdapter();
      owner.service.registerAdapter('web', loopback.adapter);
      await owner.service.setEnabled('web', true);
      await loopback.emitReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
      const confirming = owner.service.confirmBinding('web', confirmation(owner.bindingRequests[0]));
      await started.promise;
      const closing = owner.service.close();
      const results = await within(Promise.allSettled([confirming, closing]), 250);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'fulfilled');
      assert.equal(owner.service.snapshot().channels.web.binding, 'pending');
      blocked.resolve();
    }
  });

  await test('桌面绑定卡异步失败会清掉 pending，不留永久占位', async () => {
    const owner = harness({
      onBindingRequested: async () => { throw new Error('renderer gone'); }
    });
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('dingtalk', loopback.adapter);
    await owner.service.setEnabled('dingtalk', true);
    const result = await loopback.emitReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
    assert.equal(result.reasonCode, 'binding-unavailable');
    assert.equal(owner.service.snapshot().channels.dingtalk.binding, 'unbound');
    await owner.service.close();
  });

  await test('白名单外消息静默丢弃，只增加脱敏计数', async () => {
    let calls = 0;
    const audit = [];
    const owner = harness({
      receiveSink: async () => { calls += 1; },
      auditEvent: (value) => audit.push(value)
    });
    const loopback = remote.createLoopbackAdapter();
    await bind(owner, loopback, 'dingtalk', 'owner');
    const value = await loopback.emitReceive({
      actorId: 'outsider', kind: 'text', content: '不该泄露的正文'
    });
    assert.deepEqual(value, { accepted: false, reasonCode: 'not-bound' });
    assert.equal(calls, 0);
    assert.equal(owner.service.snapshot().channels.dingtalk.counters.unauthorizedDropped, 2);
    assert.equal(JSON.stringify(audit).includes('outsider'), false);
    assert.equal(JSON.stringify(audit).includes('不该泄露'), false);
    await owner.service.close();
  });

  await test('消息不能自报分级；受信策略默认把客服内容硬锁为 web-only', async () => {
    const received = [];
    const bindingRequests = [];
    const service = remote.createRemoteService({
      operationTimeoutMs: 100,
      disconnectTimeoutMs: 100,
      receiveSink: async (value) => received.push(value),
      persistBinding: async ({ commitId }) => commitId,
      readBinding: async () => null,
      onBindingRequested: (value) => { bindingRequests.push(value); return true; }
    });
    const feishu = remote.createLoopbackAdapter();
    const web = remote.createLoopbackAdapter();
    service.registerAdapter('feishu', feishu.adapter);
    service.registerAdapter('web', web.adapter);
    await service.setEnabled('feishu', true);
    await service.setEnabled('web', true);
    await feishu.emitReceive({ actorId: 'f-owner', kind: 'text', content: '绑定' });
    await service.confirmBinding('feishu', confirmation(bindingRequests.find((v) => v.channelId === 'feishu')));
    await web.emitReceive({ actorId: 'w-owner', kind: 'text', content: '绑定' });
    await service.confirmBinding('web', confirmation(bindingRequests.find((v) => v.channelId === 'web')));
    const blocked = await feishu.emitReceive({ actorId: 'f-owner', kind: 'text', content: '客户原话' });
    assert.equal(blocked.reasonCode, 'customer-web-only');
    const accepted = await web.emitReceive({ actorId: 'w-owner', kind: 'text', content: '客户原话' });
    assert.equal(accepted.accepted, true);
    await assert.rejects(() => web.emitReceive({
      actorId: 'w-owner', kind: 'text', content: '正文', sensitivity: 'ordinary'
    }), /不支持的字段/);
    assert.equal(received.length, 1);
    await service.close();
  });

  await test('未知或故障的受信分级也 fail-closed，不把正文交给 sink', async () => {
    let calls = 0;
    const owner = harness({
      classifyContent: async () => 'mystery',
      receiveSink: async () => { calls += 1; }
    });
    const loopback = remote.createLoopbackAdapter();
    const actor = await bind(owner, loopback, 'web');
    const result = await loopback.emitReceive({ actorId: actor, kind: 'text', content: '正文' });
    assert.equal(result.reasonCode, 'classification-failed');
    assert.equal(calls, 0);
    await owner.service.close();
  });

  await test('推送服从三类开关、安静模式与客服私网边界', async () => {
    const owner = harness();
    const feishu = remote.createLoopbackAdapter();
    const web = remote.createLoopbackAdapter();
    await bind(owner, feishu, 'feishu');
    await bind(owner, web, 'web');
    await owner.service.configurePolicy({
      allowApprovals: true,
      allowTaskCompletions: true,
      allowReports: true,
      notificationsEnabled: true,
      quietMode: true
    });
    const quiet = await owner.service.push({ kind: 'approval', body: '等你确认', dedupeKey: 'a-1' });
    assert.deepEqual(quiet.delivered, ['web']);
    owner.setSensitivity('customer');
    await owner.service.configurePolicy({
      allowApprovals: true,
      allowTaskCompletions: true,
      allowReports: true,
      notificationsEnabled: true,
      quietMode: false
    });
    const customer = await owner.service.push({ kind: 'report-ready', body: '客服报告', dedupeKey: 'r-1' });
    assert.deepEqual(customer.delivered, ['web']);
    owner.setSensitivity('anonymous');
    await owner.service.configurePolicy({
      allowApprovals: true,
      allowTaskCompletions: false,
      allowReports: true,
      notificationsEnabled: true,
      quietMode: false
    });
    const disabled = await owner.service.push({ kind: 'task-completed', body: '任务完成' });
    assert.deepEqual(disabled.delivered, []);
    await owner.service.close();
  });

  await test('平台测试通知只投指定通道，不会广播到其他已连接通道', async () => {
    const localSelfTestContext = Object.freeze({});
    const classified = [];
    const owner = harness({
      initialSensitivity: 'customer',
      classifyContent: async (request) => {
        classified.push(request);
        return request.classificationContext === localSelfTestContext
          ? 'anonymous' : 'customer';
      }
    });
    const feishu = remote.createLoopbackAdapter();
    const web = remote.createLoopbackAdapter();
    await bind(owner, feishu, 'feishu');
    await bind(owner, web, 'web');
    const result = await owner.service.pushTo('feishu', {
      kind: 'report-ready', body: '鲸坞飞书连接测试', dedupeKey: 'feishu-test-1'
    }, { classificationContext: localSelfTestContext });
    assert.deepEqual(result.delivered, ['feishu']);
    assert.deepEqual(result.skipped, []);
    assert.equal(feishu.snapshot().pushed.length, 1);
    assert.equal(web.snapshot().pushed.length, 0);
    assert.equal(classified[0].classificationContext, localSelfTestContext);
    const ordinaryCustomerReport = await owner.service.pushTo('feishu', {
      kind: 'report-ready', body: '真实客服报告', dedupeKey: 'customer-report-1'
    });
    assert.equal(ordinaryCustomerReport.skipped[0].reasonCode, 'customer-web-only');
    assert.equal(feishu.snapshot().pushed.length, 1);
    await assert.rejects(() => owner.service.pushTo('wechat', {
      kind: 'report-ready', body: '不能发送'
    }), /不支持的远程通道/);
    await assert.rejects(() => owner.service.pushTo('feishu', {
      kind: 'report-ready', body: '不能旁路'
    }, { sensitivity: 'anonymous' }), /不支持的字段/);
    await owner.service.close();
  });

  await test('异步分级期间关闭通知会用 policy epoch 拦下在途推送', async () => {
    const classifyStarted = deferred();
    const classifyRelease = deferred();
    const owner = harness({
      initialBindings: { web: 'owner' },
      classifyContent: async ({ operation }) => {
        if (operation === 'push') {
          classifyStarted.resolve();
          await classifyRelease.promise;
        }
        return 'ordinary';
      }
    });
    const web = remote.createLoopbackAdapter();
    owner.service.registerAdapter('web', web.adapter);
    await owner.service.setEnabled('web', true);
    const pushing = owner.service.push({ kind: 'report-ready', body: '在途报告' });
    await classifyStarted.promise;
    await owner.service.configurePolicy({
      allowApprovals: true,
      allowTaskCompletions: true,
      allowReports: false,
      notificationsEnabled: false,
      quietMode: true
    });
    classifyRelease.resolve();
    const result = await pushing;
    assert.deepEqual(result.delivered, []);
    assert.equal(result.skipped.find((value) => value.channelId === 'web').reasonCode, 'policy-changed');
    assert.equal(web.snapshot().pushed.length, 0);
    await owner.service.close();
  });

  await test('批只执行受信且未消费的确认 token；伪造、未知与重放均不形成旁路', async () => {
    const decisions = [];
    const owner = harness({ approvalSink: async (value) => decisions.push(value) });
    const loopback = remote.createLoopbackAdapter();
    const actorId = await bind(owner, loopback, 'feishu');
    const mappings = [['1', 'adopt'], ['采用', 'adopt'], ['2', 'redo'], ['重来', 'redo'], ['再来一版', 'redo']];
    for (let index = 0; index < mappings.length; index += 1) {
      const [reply, decision] = mappings[index];
      const token = `req-${index}`;
      owner.allowApproval(token);
      const result = await loopback.emitDecision({ actorId, requestToken: token, reply });
      assert.equal(result.decision, decision);
    }
    const forged = await loopback.emitDecision({
      actorId, requestToken: 'forged-never-issued', reply: '1'
    });
    assert.equal(forged.reasonCode, 'approval-not-pending');
    const unknown = await loopback.emitDecision({
      actorId, requestToken: 'req-unknown', reply: '帮我直接执行命令'
    });
    assert.equal(unknown.reasonCode, 'unknown-reply');
    owner.allowApproval('once-only');
    const once = await loopback.emitDecision({ actorId, requestToken: 'once-only', reply: '1' });
    const replay = await loopback.emitDecision({ actorId, requestToken: 'once-only', reply: '1' });
    assert.equal(once.accepted, true);
    assert.equal(replay.duplicate, true);
    assert.equal(decisions.filter((value) => value.requestToken === 'once-only').length, 1);
    assert.equal(decisions.length, 6);
    assert.equal(loopback.snapshot().approvals.find((value) => value.requestToken === 'req-unknown').reply,
      '没看懂，回桌面处理');
    await owner.service.close();
  });

  await test('同一确认 token 跨通道并发也只能原子消费和执行一次', async () => {
    const sinkStarted = deferred();
    const sinkRelease = deferred();
    let sinkCalls = 0;
    const owner = harness({
      allowedApprovals: ['cross-channel-once'],
      approvalSink: async () => {
        sinkCalls += 1;
        sinkStarted.resolve();
        await sinkRelease.promise;
      }
    });
    const feishu = remote.createLoopbackAdapter();
    const web = remote.createLoopbackAdapter();
    const feishuActor = await bind(owner, feishu, 'feishu', 'f-owner');
    const webActor = await bind(owner, web, 'web', 'w-owner');
    const first = feishu.emitDecision({
      actorId: feishuActor, requestToken: 'cross-channel-once', reply: '1'
    });
    await sinkStarted.promise;
    const second = web.emitDecision({
      actorId: webActor, requestToken: 'cross-channel-once', reply: '采用'
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sinkCalls, 1);
    sinkRelease.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(sinkCalls, 1);
    assert.equal(results.filter((value) => value.duplicate === true).length, 1);
    assert.equal(results.every((value) => value.accepted), true);
    await owner.service.close();
  });

  await test('权威 apply 事务跨服务重启返回 duplicate，不会重做既有确认', async () => {
    const approvalRecords = new Map();
    let sinkCalls = 0;
    const options = {
      initialBindings: { web: 'owner' },
      allowedApprovals: ['restart-once'],
      approvalRecords,
      approvalSink: async () => { sinkCalls += 1; }
    };
    const firstOwner = harness(options);
    const firstLoop = remote.createLoopbackAdapter();
    firstOwner.service.registerAdapter('web', firstLoop.adapter);
    await firstOwner.service.setEnabled('web', true);
    const first = await firstLoop.emitDecision({
      actorId: 'owner', requestToken: 'restart-once', reply: '1'
    });
    assert.equal(first.accepted, true);
    await firstOwner.service.close();

    const secondOwner = harness(options);
    const secondLoop = remote.createLoopbackAdapter();
    secondOwner.service.registerAdapter('web', secondLoop.adapter);
    await secondOwner.service.setEnabled('web', true);
    const replay = await secondLoop.emitDecision({
      actorId: 'owner', requestToken: 'restart-once', reply: '1'
    });
    assert.equal(replay.accepted, true);
    assert.equal(replay.duplicate, true);
    assert.equal(sinkCalls, 1);
    await secondOwner.service.close();
  });

  await test('权威 apply 已落定但回执丢失时先报未知，重启后回读 duplicate 不丢也不重做', async () => {
    const durable = new Map();
    let actionCalls = 0;
    let loseFirstReceipt = true;
    const applyApproval = async (request) => {
      const previous = durable.get(request.commitId);
      if (previous) return { status: 'duplicate', decision: previous };
      actionCalls += 1;
      durable.set(request.commitId, request.decision);
      if (loseFirstReceipt) {
        loseFirstReceipt = false;
        throw new Error('durable commit 后回执丢失');
      }
      return { status: 'applied', decision: request.decision };
    };
    const firstOwner = harness({
      initialBindings: { web: 'owner' },
      applyApproval
    });
    const firstLoop = remote.createLoopbackAdapter();
    firstOwner.service.registerAdapter('web', firstLoop.adapter);
    await firstOwner.service.setEnabled('web', true);
    const uncertain = await firstLoop.emitDecision({
      actorId: 'owner', requestToken: 'commit-then-throw', reply: '1'
    });
    assert.equal(uncertain.reasonCode, 'approval-uncertain');
    await firstOwner.service.close();

    const secondOwner = harness({
      initialBindings: { web: 'owner' },
      applyApproval
    });
    const secondLoop = remote.createLoopbackAdapter();
    secondOwner.service.registerAdapter('web', secondLoop.adapter);
    await secondOwner.service.setEnabled('web', true);
    const reconciled = await secondLoop.emitDecision({
      actorId: 'owner', requestToken: 'commit-then-throw', reply: '1'
    });
    assert.equal(reconciled.accepted, true);
    assert.equal(reconciled.duplicate, true);
    assert.equal(actionCalls, 1);
    await secondOwner.service.close();
  });

  await test('迟到旧 approval receipt 只能未知转已知，不得覆盖后续权威回读', async () => {
    const firstReceipt = deferred();
    let targetCalls = 0;
    const targetToken = 'late-monotonic-target';
    const owner = harness({
      operationTimeoutMs: 20,
      initialBindings: { web: 'owner' },
      applyApproval: async (request) => {
        if (request.requestToken === targetToken) {
          targetCalls += 1;
          if (targetCalls === 1) return firstReceipt.promise;
          return { status: 'duplicate', decision: 'adopt' };
        }
        return { status: 'applied', decision: request.decision };
      }
    });
    const loopback = remote.createLoopbackAdapter();
    owner.service.registerAdapter('web', loopback.adapter);
    await owner.service.setEnabled('web', true);
    const first = await loopback.emitDecision({
      actorId: 'owner', requestToken: targetToken, reply: '1'
    });
    assert.equal(first.reasonCode, 'approval-uncertain');

    // 超过有界本地 ledger，迫使 target 下次回到权威层对账。
    for (let index = 0; index < 10_000; index += 1) {
      const filler = await loopback.emitDecision({
        actorId: 'owner', requestToken: `ledger-filler-${index}`, reply: '1'
      });
      assert.equal(filler.accepted, true);
    }
    const reconciled = await loopback.emitDecision({
      actorId: 'owner', requestToken: targetToken, reply: '1'
    });
    assert.equal(reconciled.accepted, true);
    assert.equal(reconciled.duplicate, true);
    assert.equal(targetCalls, 2);

    firstReceipt.reject(new Error('old receipt lost'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterLateFailure = await loopback.emitDecision({
      actorId: 'owner', requestToken: targetToken, reply: '1'
    });
    assert.equal(afterLateFailure.accepted, true);
    assert.equal(afterLateFailure.duplicate, true);
    assert.equal(targetCalls, 2);
    await owner.service.close();
  });

  await test('receive/approval sink 原始异常被净化并亮固定故障灯', async () => {
    const receiveOwner = harness({
      receiveSink: async () => { throw new Error('APP_SECRET=top-secret /Users/private/raw 正文'); }
    });
    const receiveLoop = remote.createLoopbackAdapter();
    const receiveActor = await bind(receiveOwner, receiveLoop, 'feishu');
    await assert.rejects(
      () => receiveLoop.emitReceive({ actorId: receiveActor, kind: 'text', content: '正文' }),
      (error) => error.code === 'ERR_REMOTE_RECEIVE' && !/secret|private|正文/i.test(error.message)
    );
    assert.equal(receiveOwner.service.snapshot().channels.feishu.reasonCode, 'receive-failed');
    await receiveOwner.service.close();

    let approvalCalls = 0;
    const approvalOwner = harness({
      approvalSink: async () => {
        approvalCalls += 1;
        throw new Error('APP_SECRET=top-secret platform raw');
      },
      allowedApprovals: ['uncertain-token']
    });
    const approvalLoop = remote.createLoopbackAdapter();
    const approvalActor = await bind(approvalOwner, approvalLoop, 'web');
    const uncertain = await approvalLoop.emitDecision({
      actorId: approvalActor, requestToken: 'uncertain-token', reply: '1'
    });
    assert.equal(uncertain.reasonCode, 'approval-uncertain');
    assert.equal(JSON.stringify(uncertain).includes('top-secret'), false);
    assert.equal(approvalOwner.service.snapshot().channels.web.state, 'connected');
    const retry = await approvalOwner.service.approve('web', {
      actorId: approvalActor, requestToken: 'uncertain-token', reply: '1'
    });
    assert.equal(retry.reasonCode, 'approval-uncertain');
    assert.equal(approvalCalls, 1);
    await approvalOwner.service.close();
  });

  await test('确认回执失败不透传原始错误，也不把已落定动作重做', async () => {
    let hooks;
    let sinkCalls = 0;
    const owner = harness({
      approvalSink: async () => { sinkCalls += 1; },
      allowedApprovals: ['ack-fails']
    });
    const adapter = {
      async connect(value) {
        hooks = value;
        return session({
          approve: async () => { throw new Error('APP_SECRET=top-secret raw ack'); }
        });
      }
    };
    owner.service.registerAdapter('web', adapter);
    await owner.service.setEnabled('web', true);
    await hooks.onReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
    await owner.service.confirmBinding('web', confirmation(owner.bindingRequests[0]));
    const result = await hooks.onDecision({ actorId: 'owner', requestToken: 'ack-fails', reply: '1' });
    assert.equal(result.accepted, true);
    assert.equal(result.acknowledged, false);
    assert.equal(sinkCalls, 1);
    assert.equal(owner.service.snapshot().channels.web.reasonCode, 'approval-reply-failed');
    assert.equal(JSON.stringify(result).includes('top-secret'), false);
    await owner.service.close();
  });

  await test('连接失败只暴露固定 reasonCode，不泄露原始异常', async () => {
    const audit = [];
    const owner = harness({ auditEvent: (value) => audit.push(value) });
    owner.service.registerAdapter('feishu', {
      async connect() { throw new Error('APP_SECRET=top-secret 原始平台报错'); }
    });
    await owner.service.setEnabled('feishu', true);
    const serialized = JSON.stringify({ snapshot: owner.service.snapshot(), audit });
    assert.match(serialized, /connect-failed/);
    assert.equal(serialized.includes('top-secret'), false);
    assert.equal(serialized.includes('APP_SECRET'), false);
    await owner.service.close();
  });

  await test('挂起 connect 时 disable 会先 abort，但未回收连接不会虚假报已关闭', async () => {
    let hooks;
    const owner = harness({ operationTimeoutMs: 1_000, disconnectTimeoutMs: 40 });
    owner.service.registerAdapter('feishu', {
      connect(value) { hooks = value; return new Promise(() => {}); }
    });
    const enabling = owner.service.setEnabled('feishu', true);
    await waitFor(() => Boolean(hooks));
    const disabling = owner.service.setEnabled('feishu', false);
    const results = await within(Promise.allSettled([enabling, disabling]), 300);
    assert.equal(hooks.signal.aborted, true);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(owner.service.snapshot().channels.feishu.state, 'error');
    assert.equal(owner.service.snapshot().channels.feishu.reasonCode, 'disconnect-failed');
    await assert.rejects(() => within(owner.service.close(), 300), /关闭不完整/);
  });

  await test('挂起 connect 时 close 也可抢占，不会永久卡住 App quit', async () => {
    let hooks;
    const owner = harness({ operationTimeoutMs: 1_000, disconnectTimeoutMs: 40 });
    owner.service.registerAdapter('dingtalk', {
      connect(value) { hooks = value; return new Promise(() => {}); }
    });
    const enabling = owner.service.setEnabled('dingtalk', true);
    await waitFor(() => Boolean(hooks));
    const closing = owner.service.close();
    const results = await within(Promise.allSettled([enabling, closing]), 300);
    assert.equal(hooks.signal.aborted, true);
    assert.equal(results[1].status, 'rejected');
    assert.equal(owner.service.snapshot().channels.dingtalk.reasonCode, 'disconnect-failed');
  });

  await test('connect 内误 await 首帧会立即 fail-closed，不与通道串行队列互锁', async () => {
    let earlyResult;
    const owner = harness();
    owner.service.registerAdapter('feishu', {
      async connect(hooks) {
        earlyResult = await hooks.onReceive({
          actorId: 'owner', kind: 'text', content: '连接完成前的帧'
        });
        return session();
      }
    });
    await within(owner.service.setEnabled('feishu', true), 300);
    assert.equal(earlyResult.reasonCode, 'connection-not-ready');
    assert.equal(owner.service.snapshot().channels.feishu.state, 'connected');
    await owner.service.close();
  });

  await test('旧 connect 超时后不允许新一代假绿；迟到只回收自己的 session', async () => {
    const firstConnect = deferred();
    let connectCalls = 0;
    let oldDisconnects = 0;
    let newDisconnects = 0;
    const owner = harness({ operationTimeoutMs: 20, disconnectTimeoutMs: 30 });
    owner.service.registerAdapter('web', {
      async connect() {
        connectCalls += 1;
        if (connectCalls === 1) return firstConnect.promise;
        return session({ disconnect: async () => { newDisconnects += 1; } });
      }
    });
    await owner.service.setEnabled('web', true);
    assert.equal(owner.service.snapshot().channels.web.reasonCode, 'connect-cleanup-pending');
    await owner.service.setEnabled('web', true);
    assert.equal(connectCalls, 1, '旧代未回收前不得开新连接');
    assert.notEqual(owner.service.snapshot().channels.web.state, 'connected');
    firstConnect.resolve(session({
      disconnect: async () => {
        oldDisconnects += 1;
        if (oldDisconnects === 1) throw new Error('transient disconnect');
      }
    }));
    await waitFor(() => owner.service.snapshot().channels.web.reasonCode === 'disconnect-failed');
    assert.equal(oldDisconnects, 1);
    await owner.service.setEnabled('web', false);
    assert.equal(oldDisconnects, 2, '显式停用必须重试瞬时断开失败');
    await owner.service.setEnabled('web', true);
    assert.equal(connectCalls, 2);
    assert.equal(owner.service.snapshot().channels.web.state, 'connected');
    assert.equal(newDisconnects, 0);
    await owner.service.close();
    assert.equal(newDisconnects, 1);
  });

  await test('挂起 disconnect 有硬超时并如实报错，不把未确认断开画成已关闭', async () => {
    const owner = harness({ operationTimeoutMs: 100, disconnectTimeoutMs: 20 });
    owner.service.registerAdapter('web', {
      async connect() {
        return session({ disconnect: () => new Promise(() => {}) });
      }
    });
    await owner.service.setEnabled('web', true);
    await assert.rejects(() => within(owner.service.disconnectAll(), 300), /部分远程通道未确认断开/);
    const state = owner.service.snapshot().channels.web;
    assert.equal(state.enabled, false);
    assert.equal(state.state, 'error');
    assert.equal(state.reasonCode, 'disconnect-failed');
    await assert.rejects(() => within(owner.service.close(), 300), /关闭不完整/);
  });

  await test('disconnect 首次超时后迟到成功的 receipt 会复用，close 不二次调平台', async () => {
    const disconnectRelease = deferred();
    let disconnectCalls = 0;
    const owner = harness({ operationTimeoutMs: 100, disconnectTimeoutMs: 20 });
    owner.service.registerAdapter('web', {
      async connect() {
        return session({
          disconnect: async () => {
            disconnectCalls += 1;
            await disconnectRelease.promise;
          }
        });
      }
    });
    await owner.service.setEnabled('web', true);
    await assert.rejects(() => owner.service.disconnectAll(), /未确认断开/);
    assert.equal(disconnectCalls, 1);
    disconnectRelease.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await owner.service.close();
    assert.equal(disconnectCalls, 1);
  });

  await test('adapter 误复用同一 session 对象时，每个连接代仍必须真实断开', async () => {
    let active = false;
    let connectCalls = 0;
    let disconnectCalls = 0;
    const reused = session({
      disconnect: async () => {
        active = false;
        disconnectCalls += 1;
      }
    });
    const owner = harness();
    owner.service.registerAdapter('web', {
      async connect() {
        active = true;
        connectCalls += 1;
        return reused;
      }
    });
    await owner.service.setEnabled('web', true);
    await owner.service.setEnabled('web', false);
    assert.equal(active, false);
    assert.equal(disconnectCalls, 1);
    await owner.service.setEnabled('web', true);
    await owner.service.setEnabled('web', false);
    assert.equal(active, false);
    assert.equal(connectCalls, 2);
    assert.equal(disconnectCalls, 2);
    assert.equal(owner.service.snapshot().channels.web.state, 'disabled');
    await owner.service.close();
    assert.equal(disconnectCalls, 2);
  });

  await test('旧 session 未确认断开前禁止新代假绿，迟到 receipt 后才可重连', async () => {
    const firstDisconnectRelease = deferred();
    let connectCalls = 0;
    let firstDisconnectCalls = 0;
    let secondDisconnectCalls = 0;
    const owner = harness({ operationTimeoutMs: 100, disconnectTimeoutMs: 20 });
    owner.service.registerAdapter('web', {
      async connect() {
        connectCalls += 1;
        if (connectCalls === 1) {
          return session({
            disconnect: async () => {
              firstDisconnectCalls += 1;
              await firstDisconnectRelease.promise;
            }
          });
        }
        return session({ disconnect: async () => { secondDisconnectCalls += 1; } });
      }
    });
    await owner.service.setEnabled('web', true);
    await assert.rejects(() => owner.service.setEnabled('web', false), /未确认断开/);
    await owner.service.setEnabled('web', true);
    let state = owner.service.snapshot().channels.web;
    assert.equal(connectCalls, 1, '旧代未回收不得调新 connect');
    assert.equal(firstDisconnectCalls, 1, '超时后必须继续等同一 receipt');
    assert.equal(state.state, 'error');
    assert.equal(state.reasonCode, 'disconnect-failed');
    firstDisconnectRelease.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await owner.service.setEnabled('web', true);
    state = owner.service.snapshot().channels.web;
    assert.equal(connectCalls, 2);
    assert.equal(state.state, 'connected');
    assert.equal(firstDisconnectCalls, 1);
    await owner.service.close();
    assert.equal(secondDisconnectCalls, 1);
  });

  await test('close 显式断开拒绝后可重试同一代，不永久缓存失败', async () => {
    let disconnectCalls = 0;
    const owner = harness();
    owner.service.registerAdapter('web', {
      async connect() {
        return session({
          disconnect: async () => {
            disconnectCalls += 1;
            if (disconnectCalls === 1) throw new Error('transient disconnect');
          }
        });
      }
    });
    await owner.service.setEnabled('web', true);
    await assert.rejects(() => owner.service.close(), /关闭不完整/);
    assert.equal(owner.service.snapshot().channels.web.reasonCode, 'disconnect-failed');
    const snapshot = await owner.service.close();
    assert.equal(disconnectCalls, 2);
    assert.equal(snapshot.channels.web.state, 'disabled');
  });

  await test('挂起 receive/approval sink 遇到断开失败时，停用和 close 都不会虚假成功', async () => {
    for (const kind of ['receive', 'approval']) {
      const sinkStarted = deferred();
      let hooks;
      const owner = harness({
        operationTimeoutMs: 40,
        disconnectTimeoutMs: 20,
        initialBindings: { web: 'owner' },
        allowedApprovals: ['hung-approval'],
        receiveSink: kind === 'receive' ? async () => {
          sinkStarted.resolve();
          return new Promise(() => {});
        } : undefined,
        approvalSink: kind === 'approval' ? async () => {
          sinkStarted.resolve();
          return new Promise(() => {});
        } : undefined
      });
      owner.service.registerAdapter('web', {
        async connect(value) {
          hooks = value;
          return session({ disconnect: () => new Promise(() => {}) });
        }
      });
      await owner.service.setEnabled('web', true);
      const operation = kind === 'receive'
        ? hooks.onReceive({ actorId: 'owner', kind: 'text', content: '挂起' })
        : hooks.onDecision({ actorId: 'owner', requestToken: 'hung-approval', reply: '1' });
      await sinkStarted.promise;
      const disabling = owner.service.setEnabled('web', false);
      const results = await within(Promise.allSettled([operation, disabling]), 300);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'rejected');
      const state = owner.service.snapshot().channels.web;
      assert.equal(state.state, 'error');
      assert.equal(state.reasonCode, 'disconnect-failed');
      await assert.rejects(() => within(owner.service.close(), 300), /关闭不完整/);
    }
  });

  await test('连接代阻止旧 socket 迟到写入；adapter 掉线/故障会实时撤掉假绿', async () => {
    const generations = [];
    const received = [];
    let disconnectCalls = 0;
    const owner = harness({ receiveSink: async (value) => received.push(value) });
    const adapter = {
      async connect(value) {
        generations.push(value);
        return session({ disconnect: async () => { disconnectCalls += 1; } });
      }
    };
    owner.service.registerAdapter('feishu', adapter);
    await owner.service.setEnabled('feishu', true);
    await generations[0].onReceive({ actorId: 'owner', kind: 'text', content: '绑定' });
    await owner.service.confirmBinding('feishu', confirmation(owner.bindingRequests[0]));
    await owner.service.setEnabled('feishu', false);
    await owner.service.setEnabled('feishu', true);
    const stale = await generations[0].onReceive({ actorId: 'owner', kind: 'text', content: '旧帧' });
    assert.equal(stale.reasonCode, 'stale-connection');
    const fresh = await generations[1].onReceive({ actorId: 'owner', kind: 'text', content: '新帧' });
    assert.equal(fresh.accepted, true);
    assert.equal(received.length, 1);
    await generations[1].onError('transport-error');
    assert.equal(owner.service.snapshot().channels.feishu.state, 'error');
    assert.ok(disconnectCalls >= 2);
    await owner.service.close();
  });

  await test('adapter lifecycle 原始原因永不进快照或审计，只映射固定枚举', async () => {
    const audit = [];
    const states = [];
    const hooks = {};
    const owner = harness({
      auditEvent: (value) => audit.push(value),
      onStateChanged: (value) => states.push(value)
    });
    for (const id of ['feishu', 'dingtalk']) {
      owner.service.registerAdapter(id, {
        async connect(value) {
          hooks[id] = value;
          return session();
        }
      });
      await owner.service.setEnabled(id, true);
    }
    await hooks.feishu.onError('appsecret1234567890');
    await hooks.dingtalk.onClose('token-deadbeef12345678');
    const snapshot = owner.service.snapshot();
    assert.equal(snapshot.channels.feishu.reasonCode, 'transport-error');
    assert.equal(snapshot.channels.dingtalk.reasonCode, 'remote-closed');
    const publicEvidence = JSON.stringify({ snapshot, audit, states });
    assert.equal(publicEvidence.includes('appsecret1234567890'), false);
    assert.equal(publicEvidence.includes('token-deadbeef12345678'), false);
    await owner.service.close();
  });

  await test('lifecycle 状态回调同步要求重连时，也必须先回收精确旧代', async () => {
    const active = new Set();
    const disconnects = [];
    const hooks = [];
    let service;
    let reconnectPromise = null;
    let reconnectRequested = false;
    const owner = harness({
      onStateChanged: (snapshot) => {
        if (!reconnectRequested && service
            && snapshot.channels.web.state === 'disconnected') {
          reconnectRequested = true;
          reconnectPromise = service.setEnabled('web', true);
        }
      }
    });
    service = owner.service;
    service.registerAdapter('web', {
      async connect(value) {
        const id = hooks.length + 1;
        hooks.push(value);
        active.add(id);
        return session({
          disconnect: async () => {
            disconnects.push(id);
            active.delete(id);
          }
        });
      }
    });
    await service.setEnabled('web', true);
    const lifecycle = hooks[0].onClose('platform-input-is-ignored');
    await lifecycle;
    await reconnectPromise;
    assert.deepEqual(disconnects, [1]);
    assert.deepEqual([...active], [2]);
    assert.equal(service.snapshot().channels.web.state, 'connected');
    await service.close();
    assert.deepEqual(disconnects, [1, 2]);
    assert.deepEqual([...active], []);
  });

  await test('lifecycle 前已排队的 enable 意图会失效，迟后 cleanup 不得误杀新 session', async () => {
    const sinkStarted = deferred();
    const active = new Set();
    const disconnects = [];
    const hooks = [];
    let connectCalls = 0;
    const owner = harness({
      initialBindings: { web: 'owner' },
      receiveSink: async () => {
        sinkStarted.resolve();
        return new Promise(() => {});
      }
    });
    owner.service.registerAdapter('web', {
      async connect(value) {
        connectCalls += 1;
        const id = connectCalls;
        hooks.push(value);
        active.add(id);
        return session({
          disconnect: async () => {
            disconnects.push(id);
            active.delete(id);
          }
        });
      }
    });
    await owner.service.setEnabled('web', true);
    const receiving = hooks[0].onReceive({
      actorId: 'owner', kind: 'text', content: '在途收件'
    });
    await sinkStarted.promise;
    const queuedEnable = owner.service.setEnabled('web', true);
    const lifecycle = hooks[0].onClose('platform-input-is-ignored');
    const results = await within(Promise.allSettled([
      receiving, queuedEnable, lifecycle
    ]), 300);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(connectCalls, 1, '事件前排队的 enable 不得跨 lifecycle 生效');
    assert.deepEqual(disconnects, [1]);
    assert.deepEqual([...active], []);
    assert.notEqual(owner.service.snapshot().channels.web.state, 'connected');
    await owner.service.close();
  });

  await test('三通道按通道串行；一个挂起 push 不冻结其他通道或断开意图', async () => {
    let feishuHooks;
    const owner = harness({ operationTimeoutMs: 50, disconnectTimeoutMs: 40 });
    owner.service.registerAdapter('feishu', {
      async connect(value) {
        feishuHooks = value;
        return session({ push: () => new Promise(() => {}) });
      }
    });
    const web = remote.createLoopbackAdapter();
    owner.service.registerAdapter('web', web.adapter);
    await owner.service.setEnabled('feishu', true);
    await feishuHooks.onReceive({ actorId: 'f-owner', kind: 'text', content: '绑定' });
    await owner.service.confirmBinding('feishu', confirmation(owner.bindingRequests.find((v) => v.channelId === 'feishu')));
    await owner.service.setEnabled('web', true);
    await web.emitReceive({ actorId: 'w-owner', kind: 'text', content: '绑定' });
    await owner.service.confirmBinding('web', confirmation(owner.bindingRequests.find((v) => v.channelId === 'web')));
    const pushing = owner.service.push({ kind: 'report-ready', body: '报告好了' });
    await waitFor(() => web.snapshot().pushed.length === 1);
    const disconnecting = owner.service.disconnectAll();
    await within(Promise.all([pushing, disconnecting]), 300);
    assert.equal(feishuHooks.signal.aborted, true);
    assert.equal(web.snapshot().connected, false);
    await owner.service.close();
  });

  await test('出站 push 队列也有操作数和字节背压，不能无界占内存', async () => {
    const pushStarted = deferred();
    const pushRelease = deferred();
    const owner = harness({
      operationTimeoutMs: 1_000,
      initialBindings: { web: 'owner' }
    });
    owner.service.registerAdapter('web', {
      async connect() {
        return session({
          push: async () => {
            pushStarted.resolve();
            await pushRelease.promise;
          }
        });
      }
    });
    await owner.service.setEnabled('web', true);
    const pushes = Array.from({ length: 66 }, (_, index) => owner.service.push({
      kind: 'report-ready', body: `报告 ${index}`
    }));
    await pushStarted.promise;
    const overflow = await within(pushes[65], 300);
    assert.equal(
      overflow.skipped.find((value) => value.channelId === 'web').reasonCode,
      'backpressure'
    );
    pushRelease.resolve();
    await within(Promise.all(pushes), 800);
    await owner.service.close();
  });

  await test('全部断开逐通道并行等待，完成后 enabled=false 且不留连接', async () => {
    const owner = harness();
    const first = remote.createLoopbackAdapter();
    const second = remote.createLoopbackAdapter();
    await bind(owner, first, 'feishu');
    await bind(owner, second, 'web');
    const snapshot = await owner.service.disconnectAll();
    assert.equal(first.snapshot().connected, false);
    assert.equal(second.snapshot().connected, false);
    for (const value of Object.values(snapshot.channels)) {
      assert.equal(value.enabled, false);
      assert.equal(value.state, 'disabled');
    }
    await owner.service.close();
  });

  await test('严格拒绝任意通道、消息自报分级、secret 字段旁路和超界输入', async () => {
    assert.throws(
      () => remote.createRemoteService({ persistBinding: async () => null }),
      /必须成对提供/
    );
    assert.throws(
      () => remote.createRemoteService({ approvalSink: async () => {} }),
      /不支持的字段/
    );
    assert.throws(
      () => remote.createRemoteService({ receiveSink: true }),
      /必须是函数/
    );
    const owner = harness();
    assert.throws(() => owner.service.registerAdapter('wechat', {}), /不支持/);
    await assert.rejects(() => owner.service.setEnabled('feishu', 'yes'), /布尔值/);
    await assert.rejects(() => owner.service.receive('feishu', {
      actorId: 'a', kind: 'command', content: 'rm -rf'
    }), /收件类型无效/);
    await assert.rejects(() => owner.service.push({
      kind: 'report-ready', body: 'x', appSecret: 'secret'
    }), /不支持的字段/);
    await assert.rejects(() => owner.service.push({
      kind: 'report-ready', body: 'x', sensitivity: 'ordinary'
    }), /不支持的字段/);
    await assert.rejects(() => owner.service.approve('web', {
      actorId: 'a', requestToken: 'oversized-reply', reply: 'x'.repeat(65)
    }), /确认回复无效/);
    await owner.service.close();
    await assert.rejects(() => owner.service.setEnabled('web', true), /已关闭/);
  });

  console.log(`\nREMOTE ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('REMOTE FAIL:', error);
  process.exit(1);
});
