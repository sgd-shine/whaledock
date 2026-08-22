'use strict';

const assert = require('assert/strict');

const MODULE_PATH = require.resolve('../lib/remote-feishu');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  feishu remote: ${name}`);
  } catch (error) {
    console.error(`FAIL  feishu remote: ${name}`);
    throw error;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function hooks(overrides = {}) {
  return {
    signal: overrides.signal || new AbortController().signal,
    onReceive: overrides.onReceive || (async () => ({ accepted: true })),
    onDecision: overrides.onDecision || (async () => ({ accepted: false })),
    onClose: overrides.onClose || (async () => {}),
    onError: overrides.onError || (async () => {})
  };
}

function fakeSdk(options = {}) {
  const instances = [];
  class EventDispatcher {
    constructor(params) {
      this.params = params;
      this.handles = null;
    }

    register(handles) {
      this.handles = handles;
      return this;
    }
  }

  class WSClient {
    constructor(params) {
      if (options.constructorError) throw options.constructorError;
      this.params = params;
      this.dispatcher = null;
      this.closeCalls = [];
      this.closeSawReconnectTimer = [];
      this.reconnectTimer = null;
      instances.push(this);
    }

    async start({ eventDispatcher }) {
      this.dispatcher = eventDispatcher;
      if (options.startError) throw options.startError;
      if (options.ready !== false) {
        queueMicrotask(() => {
          this.params.onReady();
          if (options.earlyEvent) this.earlyHandling = this.emit(options.earlyEvent);
        });
      }
    }

    close(value) {
      this.closeCalls.push(value);
      this.closeSawReconnectTimer.push(this.reconnectTimer !== null);
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (options.closeError) throw options.closeError;
    }

    reConnectAfterCallback() {
      this.params.onReconnecting();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
      }, 60_000);
      this.reconnectTimer.unref();
    }

    clearFakeReconnectTimer() {
      if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    emit(data) {
      return this.dispatcher.handles['im.message.receive_v1'](data);
    }
  }

  return {
    sdk: { EventDispatcher, WSClient, LoggerLevel: { error: 1 } },
    instances
  };
}

function event(overrides = {}) {
  return {
    sender: {
      sender_type: 'user',
      sender_id: { open_id: 'ou_owner' },
      ...(overrides.sender || {})
    },
    message: {
      message_id: 'om_1',
      create_time: '1787356800000',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: '你好' }),
      ...(overrides.message || {})
    }
  };
}

function fixture(overrides = {}) {
  const fake = overrides.fake || fakeSdk();
  const calls = {
    loadSdk: 0,
    credentials: 0,
    hasChecks: [],
    remembers: [],
    sent: [],
    boundReads: 0
  };
  const committed = new Set();
  const { createFeishuAdapter } = require(MODULE_PATH);
  const adapter = createFeishuAdapter({
    sdkLoader: () => {
      calls.loadSdk += 1;
      return fake.sdk;
    },
    readCredentials: async () => {
      calls.credentials += 1;
      return { appId: 'cli_0123456789abcdef', appSecret: 'super-secret-value' };
    },
    hasMessage: async ({ appId, messageId }) => {
      calls.hasChecks.push({ appId, messageId });
      return committed.has(messageId);
    },
    rememberMessage: async ({ appId, messageId }) => {
      calls.remembers.push({ appId, messageId });
      committed.add(messageId);
    },
    readBoundOpenId: async () => {
      calls.boundReads += 1;
      return 'ou_owner';
    },
    sendText: async (value) => { calls.sent.push(value); },
    ...overrides.adapterOptions
  });
  return { adapter, fake, calls, committed };
}

(async () => {
  await test('模块载入与 adapter 构造都不加载 SDK、不读凭据且不发网', async () => {
    delete require.cache[MODULE_PATH];
    let touched = 0;
    const { createFeishuAdapter } = require(MODULE_PATH);
    createFeishuAdapter({
      sdkLoader: () => { touched += 1; throw new Error('不应加载'); },
      readCredentials: async () => { touched += 1; throw new Error('不应读取'); },
      hasMessage: async () => { touched += 1; return true; },
      rememberMessage: async () => { touched += 1; },
      readBoundOpenId: async () => { touched += 1; return 'ou_owner'; },
      sendText: async () => { touched += 1; }
    });
    createFeishuAdapter({
      readCredentials: async () => ({ appId: 'unused', appSecret: 'unused' }),
      hasMessage: async () => true,
      rememberMessage: async () => {},
      readBoundOpenId: async () => 'unused',
      sendText: async () => {}
    });
    assert.equal(touched, 0);
  });

  await test('connect 只使用 WSClient + EventDispatcher，并等 onReady 后才权威返回', async () => {
    const ready = fakeSdk({ ready: false });
    const owner = fixture({ fake: ready });
    let settled = false;
    const connecting = owner.adapter.connect(hooks()).then((value) => {
      settled = true;
      return value;
    });
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(owner.calls.loadSdk, 1);
    assert.equal(owner.calls.credentials, 1);
    assert.equal(ready.instances.length, 1);
    assert.deepEqual(Object.keys(ready.instances[0].dispatcher.handles), ['im.message.receive_v1']);
    assert.equal(ready.instances[0].params.appId, 'cli_0123456789abcdef');
    assert.equal(ready.instances[0].params.appSecret, 'super-secret-value');
    assert.equal(ready.instances[0].params.autoReconnect, true);
    ready.instances[0].params.onReady();
    const session = await connecting;
    assert.deepEqual(Object.keys(session), ['disconnect', 'push', 'approve', 'challengeBinding']);
    await session.disconnect('test');
  });

  await test('onReady 同轮早到首帧会等 session 被核心接管后再交付', async () => {
    const early = fakeSdk({ earlyEvent: event() });
    const owner = fixture({ fake: early });
    let connectReturned = false;
    let delivered = 0;
    const session = await owner.adapter.connect(hooks({
      onReceive: async () => {
        assert.equal(connectReturned, true);
        delivered += 1;
        return { accepted: true };
      }
    }));
    connectReturned = true;
    await early.instances[0].earlyHandling;
    assert.equal(delivered, 1);
    await session.disconnect('test');
  });

  await test('只接收用户本人单聊文字和独立 HTTP(S) 链接，不扩展群聊或其他类型', async () => {
    const owner = fixture();
    const received = [];
    const session = await owner.adapter.connect(hooks({
      onReceive: async (value) => { received.push(value); return { accepted: true }; }
    }));
    const ws = owner.fake.instances[0];
    await ws.emit(event());
    await ws.emit(event({ message: {
      message_id: 'om_2', content: JSON.stringify({ text: '  https://example.com  ' })
    } }));
    await ws.emit(event({ message: {
      message_id: 'om_group', chat_type: 'group', content: JSON.stringify({ text: '群聊' })
    } }));
    await ws.emit(event({ sender: { sender_type: 'bot' }, message: { message_id: 'om_bot' } }));
    await ws.emit(event({ message: { message_id: 'om_file', message_type: 'file' } }));
    await ws.emit(event({ message: {
      message_id: 'om_mixed', content: JSON.stringify({ text: '看 https://example.com' })
    } }));
    assert.deepEqual(received, [
      {
        actorId: 'ou_owner', kind: 'text', content: '你好', sourceId: 'om_1',
        receivedAt: '2026-08-22T00:00:00.000Z'
      },
      {
        actorId: 'ou_owner', kind: 'link', content: 'https://example.com', sourceId: 'om_2',
        receivedAt: '2026-08-22T00:00:00.000Z'
      },
      {
        actorId: 'ou_owner', kind: 'text', content: '看 https://example.com',
        sourceId: 'om_mixed', receivedAt: '2026-08-22T00:00:00.000Z'
      }
    ]);
    assert.deepEqual(owner.calls.hasChecks.map((value) => value.messageId), ['om_1', 'om_2', 'om_mixed']);
    assert.deepEqual(owner.calls.remembers.map((value) => value.messageId), ['om_1', 'om_2', 'om_mixed']);
    await session.disconnect('test');
  });

  await test('message_id 同进程串行且只在入件成功后持久提交，重推不二次入件', async () => {
    const owner = fixture();
    const received = [];
    const session = await owner.adapter.connect(hooks({
      onReceive: async (value) => { received.push(value); return { accepted: true }; }
    }));
    const ws = owner.fake.instances[0];
    await Promise.all([ws.emit(event()), ws.emit(event())]);
    await ws.emit(event());
    assert.equal(received.length, 1);
    assert.equal(owner.calls.hasChecks.length, 2);
    assert.equal(owner.calls.remembers.length, 1);
    assert.deepEqual(owner.calls.remembers[0], {
      appId: 'cli_0123456789abcdef', messageId: 'om_1'
    });
    await session.disconnect('test');
  });

  await test('onReceive 失败时不提交去重，同 message_id 重投仍能成功入件', async () => {
    const owner = fixture();
    let attempts = 0;
    const session = await owner.adapter.connect(hooks({
      onReceive: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('local inbox transient failure');
        return { accepted: true };
      }
    }));
    const ws = owner.fake.instances[0];
    await assert.rejects(() => ws.emit(event()), (error) => (
      error.code === 'ERR_FEISHU_RECEIVE' && error.message === '飞书收件交付失败'
    ));
    assert.equal(owner.calls.remembers.length, 0);
    await ws.emit(event());
    assert.equal(attempts, 2);
    assert.deepEqual(owner.calls.remembers, [{
      appId: 'cli_0123456789abcdef', messageId: 'om_1'
    }]);
    await session.disconnect('test');
  });

  await test('瞬态、未知与畸形 receipt 不提交去重，同 message_id 可重投成功', async () => {
    const owner = fixture();
    const receipts = new Map();
    const session = await owner.adapter.connect(hooks({
      onReceive: async (value) => receipts.get(value.sourceId)
    }));
    const ws = owner.fake.instances[0];
    const cases = [
      ['om_stale', { accepted: false, reasonCode: 'stale-connection' }],
      ['om_not_ready', { accepted: false, reasonCode: 'connection-not-ready' }],
      ['om_offline', { accepted: false, reasonCode: 'channel-offline' }],
      ['om_pressure', { accepted: false, reasonCode: 'backpressure' }],
      ['om_classify', { accepted: false, reasonCode: 'classification-failed' }],
      ['om_binding_down', { accepted: false, reasonCode: 'binding-unavailable' }],
      ['om_unknown', { accepted: false, reasonCode: 'future-unknown' }],
      ['om_malformed', null]
    ];
    for (const [messageId, receipt] of cases) {
      receipts.set(messageId, receipt);
      await assert.rejects(
        () => ws.emit(event({ message: { message_id: messageId } })),
        (error) => error.code === 'ERR_FEISHU_RECEIVE'
          && error.message === '飞书收件交付失败'
      );
    }
    assert.equal(owner.calls.remembers.length, 0);

    receipts.set('om_stale', { accepted: true });
    await ws.emit(event({ message: { message_id: 'om_stale' } }));
    assert.deepEqual(owner.calls.remembers, [{
      appId: 'cli_0123456789abcdef', messageId: 'om_stale'
    }]);
    await session.disconnect('test');
  });

  await test('绑定与客服策略终态 receipt 会提交，同 message_id 重推只处理一次', async () => {
    const owner = fixture();
    const reasons = new Map([
      ['om_binding_required', 'binding-required'],
      ['om_not_bound', 'not-bound'],
      ['om_customer', 'customer-web-only']
    ]);
    const attempts = new Map();
    const session = await owner.adapter.connect(hooks({
      onReceive: async (value) => {
        attempts.set(value.sourceId, (attempts.get(value.sourceId) || 0) + 1);
        return { accepted: false, reasonCode: reasons.get(value.sourceId) };
      }
    }));
    const ws = owner.fake.instances[0];
    for (const messageId of reasons.keys()) {
      const incoming = event({ message: { message_id: messageId } });
      await ws.emit(incoming);
      await ws.emit(incoming);
      assert.equal(attempts.get(messageId), 1);
    }
    assert.deepEqual(owner.calls.remembers.map((value) => value.messageId), [
      'om_binding_required', 'om_not_bound', 'om_customer'
    ]);
    await session.disconnect('test');
  });

  await test('飞书事件回调等本地 onReceive 交付完成再 ACK', async () => {
    const owner = fixture();
    const receipt = deferred();
    const session = await owner.adapter.connect(hooks({ onReceive: () => receipt.promise }));
    let acked = false;
    const handling = owner.fake.instances[0].emit(event()).then(() => { acked = true; });
    await nextTurn();
    assert.equal(acked, false);
    receipt.resolve({ accepted: true });
    await handling;
    assert.equal(acked, true);
    await session.disconnect('test');
  });

  await test('push 仅向权威持久绑定 open_id 发一条文字，并透传 dedupeKey 与 AbortSignal', async () => {
    const owner = fixture();
    const session = await owner.adapter.connect(hooks());
    const controller = new AbortController();
    await session.push({ body: '任务完成', dedupeKey: 'push-1' }, { signal: controller.signal });
    assert.equal(owner.calls.boundReads, 1);
    assert.equal(owner.calls.sent.length, 1);
    assert.equal(owner.calls.sent[0].openId, 'ou_owner');
    assert.equal(owner.calls.sent[0].text, '任务完成');
    assert.equal(owner.calls.sent[0].dedupeKey, 'push-1');
    assert.equal(owner.calls.sent[0].signal, controller.signal);
    await session.disconnect('test');
  });

  await test('challengeBinding 只向本次发信人发六位码，不读旧绑定', async () => {
    const owner = fixture();
    const session = await owner.adapter.connect(hooks());
    await session.challengeBinding({
      actorId: 'ou_candidate', challengeCode: '123456', expiresAt: 123_000
    }, { signal: new AbortController().signal });
    assert.equal(owner.calls.boundReads, 0);
    assert.equal(owner.calls.sent.length, 1);
    assert.deepEqual({
      openId: owner.calls.sent[0].openId,
      text: owner.calls.sent[0].text,
      dedupeKey: owner.calls.sent[0].dedupeKey
    }, {
      openId: 'ou_candidate',
      text: '鲸坞绑定码：123456\n请回到电脑端核对并确认。',
      dedupeKey: null
    });
    await session.disconnect('test');
  });

  await test('本批次不扩展远程审批，approve 固定 fail-closed', async () => {
    const owner = fixture();
    const session = await owner.adapter.connect(hooks());
    await assert.rejects(() => session.approve({}), (error) => (
      error.code === 'ERR_FEISHU_UNSUPPORTED' && !/secret|token|open_id/i.test(error.message)
    ));
    await session.disconnect('test');
  });

  await test('AbortSignal 会强制收回 WS，disconnect 幂等且不重复 close', async () => {
    const owner = fixture();
    const controller = new AbortController();
    const session = await owner.adapter.connect(hooks({ signal: controller.signal }));
    const ws = owner.fake.instances[0];
    controller.abort();
    await nextTurn();
    await session.disconnect('one');
    await session.disconnect('two');
    assert.deepEqual(ws.closeCalls, [{ force: true }]);
  });

  await test('连接期取消立即回收并返回固定错误，不等假 ready', async () => {
    const fake = fakeSdk({ ready: false });
    const owner = fixture({ fake });
    const controller = new AbortController();
    const connecting = owner.adapter.connect(hooks({ signal: controller.signal }));
    await nextTurn();
    controller.abort();
    await assert.rejects(() => connecting, (error) => (
      error.code === 'ERR_FEISHU_ABORTED' && error.message === '飞书连接已取消'
    ));
    assert.deepEqual(fake.instances[0].closeCalls, [{ force: true }]);
  });

  await test('SDK 初始化与生命周期错误均脱敏，不回传 SDK 原文', async () => {
    const fake = fakeSdk({ constructorError: new Error('super-secret-value leaked') });
    const owner = fixture({ fake });
    await assert.rejects(() => owner.adapter.connect(hooks()), (error) => (
      error.code === 'ERR_FEISHU_CONNECT' && error.message === '飞书连接失败'
        && !error.message.includes('super-secret-value')
    ));

    const lifecycle = fakeSdk({ ready: false });
    const second = fixture({ fake: lifecycle });
    const errorReasons = [];
    const connecting = second.adapter.connect(hooks({
      onError: async (reason) => { errorReasons.push(reason); }
    }));
    await nextTurn();
    lifecycle.instances[0].params.onError(new Error('super-secret-value leaked again'));
    await assert.rejects(() => connecting, /\u98de\u4e66\u8fde\u63a5\u5931\u8d25/);
    assert.deepEqual(errorReasons, []);
  });

  await test('已连接后掉线只上报固定 reasonCode，不把平台错误或凭据交给核心', async () => {
    const owner = fixture();
    const closed = [];
    const session = await owner.adapter.connect(hooks({
      onClose: async (reason) => { closed.push(reason); }
    }));
    owner.fake.instances[0].params.onReconnecting(new Error('super-secret-value'));
    await nextTurn();
    assert.deepEqual(closed, ['transport-lost']);
    await session.disconnect('test');
  });

  await test('SDK 回调返回后才创建的重连 timer 会由核心 cleanup 收回', async () => {
    const owner = fixture();
    const lifecycleReasons = [];
    let session;
    session = await owner.adapter.connect(hooks({
      onClose: async (reason) => {
        lifecycleReasons.push(reason);
        await session.disconnect('core-lifecycle');
      }
    }));
    const ws = owner.fake.instances[0];
    try {
      ws.reConnectAfterCallback();
      await nextTurn();
      assert.deepEqual(lifecycleReasons, ['transport-lost']);
      assert.deepEqual(ws.closeSawReconnectTimer, [true]);
      assert.equal(ws.reconnectTimer, null);
    } finally {
      ws.clearFakeReconnectTimer();
      await session.disconnect('test');
    }
  });

  await test('核心 lifecycle hook 挂起时仍有延后关闭兜底，且不重复上报', async () => {
    const owner = fixture();
    const hookRelease = deferred();
    let lifecycleCalls = 0;
    const session = await owner.adapter.connect(hooks({
      onClose: () => {
        lifecycleCalls += 1;
        return hookRelease.promise;
      }
    }));
    const ws = owner.fake.instances[0];
    try {
      ws.reConnectAfterCallback();
      ws.params.onReconnecting();
      await nextTurn();
      assert.equal(lifecycleCalls, 1);
      assert.deepEqual(ws.closeSawReconnectTimer, [true]);
      assert.equal(ws.reconnectTimer, null);
    } finally {
      hookRelease.resolve();
      ws.clearFakeReconnectTimer();
      await session.disconnect('test');
    }
  });

  await test('未持久绑定、已取消或去重存储失败均 fail-closed', async () => {
    const unbound = fixture({ adapterOptions: { readBoundOpenId: async () => null } });
    const unboundSession = await unbound.adapter.connect(hooks());
    await assert.rejects(() => unboundSession.push({ body: '不应发出', dedupeKey: null }), (error) => (
      error.code === 'ERR_FEISHU_UNBOUND'
    ));
    assert.equal(unbound.calls.sent.length, 0);
    await unboundSession.disconnect('test');

    const aborted = fixture();
    const abortedSession = await aborted.adapter.connect(hooks());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => abortedSession.push({ body: '不应发出', dedupeKey: null }, { signal: controller.signal }),
      (error) => error.code === 'ERR_FEISHU_ABORTED'
    );
    assert.equal(aborted.calls.sent.length, 0);
    await abortedSession.disconnect('test');

    const broken = fixture({
      adapterOptions: { hasMessage: async () => { throw new Error('secret storage path'); } }
    });
    const brokenSession = await broken.adapter.connect(hooks());
    await assert.rejects(() => broken.fake.instances[0].emit(event()), (error) => (
      error.code === 'ERR_FEISHU_DEDUPE' && error.message === '飞书消息去重失败'
    ));
    await brokenSession.disconnect('test');
  });

  console.log(`FEISHU REMOTE ALL PASS (${passed})`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
