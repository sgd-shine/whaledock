'use strict';

// v0.3 dsh 事件适配器直接合约测试；由统一 smoke 子进程执行，不需要 Electron。
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backend = require('../lib/backend');
const config = require('../lib/config');
const events = require('../lib/events');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

function response(body, options = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Map([
    ['content-type', options.contentType || 'application/json; charset=utf-8'],
    ['content-length', String(Buffer.byteLength(text))]
  ]);
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    redirected: Boolean(options.redirected),
    url: options.url || 'http://127.0.0.1:4319/api/test',
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    text: async () => text
  };
}

function serverResponse(request, value, overrides = {}) {
  return response({
    type: overrides.type || 'server-response',
    rpcId: overrides.rpcId || request.rpcId,
    result: overrides.result || { ok: true, value }
  }, overrides.response || {});
}

function event(type, seq, data, extra = {}) {
  return { type, seq, time: 1_800_000_000_000 + seq, data, ...extra };
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name, value) {
    for (const listener of this.listeners.get(name) || []) listener(value);
  }

  message(value) {
    this.emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) });
  }

  send(value) { this.sent.push(value); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', { code: 1000, reason: 'test-close' });
  }
}

async function main() {
  const rawSession = 'session-sensitive-A';
  const rawParent = 'session-sensitive-parent';
  const rawMessage = 'message-sensitive-A';
  const rawQuestionRpc = 'question-sensitive-A';
  const rawDeliveryRpc = 'delivery-sensitive-A';
  const requests = [];
  let nextRpc = 0;
  let largeHistoryResult = null;

  const fetchImpl = async (url, init) => {
    const request = JSON.parse(init.body);
    requests.push({ url: String(url), init, request });
    if (request.method === 'host.describe') {
      return serverResponse(request, {
        version: '0.0.1',
        cwd: '/Users/private/workspace',
        home: '/Users/private/dsh-home',
        attachedSessions: 2,
        canOpenPath: true
      });
    }
    if (request.method === 'session.list') {
      return serverResponse(request, { items: [{
        sessionId: rawSession,
        parentSessionId: rawParent,
        updatedAt: 1_800_000_000_000,
        running: false,
        blank: false,
        cwd: '/Users/private/workspace',
        agentPreset: 'private-preset',
        projections: { asOfSeq: 11, values: { private: 'discard-me' } }
      }, {
        sessionId: rawParent,
        updatedAt: 1_799_000_000_000,
        running: true,
        blank: false,
        origin: 'subagent'
      }] });
    }
    if (request.method === 'session.history') {
      return serverResponse(request, {
        events: [
          { event: event('turn/end', 9, { turn: 2, reason: { kind: 'completed' } }) },
          // rc.6 会返回旧会话中直接 message 形状；它没有 turn，必须丢正文并
          // 降为 projection 以保持 seq 连续，不能让一个旧会话关闭整个事件层。
          { event: event('user/message', 6, {
            id: 'legacy-user-message-sensitive', role: 'user',
            content: [{ type: 'text', text: 'legacy secret prompt' }],
            source: { kind: 'user', form: 'legacy' }
          }) },
          { event: event('user/message', 7, {
            turn: 2,
            message: {
              id: 'user-message-sensitive',
              content: [{ type: 'text', text: 'secret prompt' }],
              source: { kind: 'user', rpcId: rawDeliveryRpc }
            }
          }) },
          { event: event('assistant/message', 8, {
            turn: 2,
            step: 1,
            message: { id: rawMessage, content: [{ type: 'text', text: 'secret answer' }] },
            usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3, reasoningTokens: 2 }
          }) }
        ],
        hasMore: true,
        projections: { asOfSeq: 9, values: { title: 'private title' } }
      });
    }
    throw new Error(`unexpected method: ${request.method}`);
  };

  await test('managed workdir proof 要求仍存活的鲸坞 child，坏 state 零请求', async () => {
    let fetchCalls = 0;
    const prove = (state) => backend.proveManagedWorkdir({
      port: 4319,
      state,
      fetch: async () => {
        fetchCalls += 1;
        throw new Error('invalid state must not fetch');
      }
    });
    for (const state of [null, {}, { child: {}, exited: true }]) {
      await assert.rejects(prove(state), (error) => error.code === 'ERR_DSH_WORKDIR_STATE');
    }
    assert.equal(fetchCalls, 0);
  });

  await test('managed workdir proof 使用锁定 host.describe loopback wire 并只返回 cwd', async () => {
    const state = { child: { pid: 321 }, exited: false };
    const seen = [];
    const result = await backend.proveManagedWorkdir({
      port: 4319,
      state,
      mintRpcId: () => 'workdir-rpc-1',
      fetch: async (url, init) => {
        const request = JSON.parse(init.body);
        seen.push({ url: String(url), init, request });
        return serverResponse(request, {
          version: config.DSH_CONTRACT.hostVersion,
          cwd: '/private/managed-workspace',
          home: '/private/must-not-leak-home',
          attachedSessions: 2,
          canOpenPath: true,
          provider: 'must-not-leak',
          model: 'must-not-leak'
        }, { response: { url: 'http://127.0.0.1:4319/api/host.describe' } });
      }
    });
    assert.deepEqual(result, { proven: true, cwd: '/private/managed-workspace' });
    assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'http://127.0.0.1:4319/api/host.describe');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.redirect, 'error');
    assert.deepEqual(seen[0].request, {
      type: 'client-request',
      rpcId: 'workdir-rpc-1',
      method: 'host.describe',
      payload: {}
    });
  });

  await test('managed workdir proof 对版本/cwd/redirect/超限/timeout/state 漂移均 fail-closed', async () => {
    const baseState = () => ({ child: { pid: 654 }, exited: false });
    const proveWith = (fetch, overrides = {}) => backend.proveManagedWorkdir({
      port: 4319,
      state: baseState(),
      mintRpcId: () => 'workdir-rpc-bad',
      fetch,
      ...overrides
    });
    await assert.rejects(proveWith(async (_url, init) => {
      const request = JSON.parse(init.body);
      return serverResponse(request, {
        version: '9.9.9', cwd: '/managed', attachedSessions: 0, canOpenPath: true
      });
    }), (error) => error.code === 'ERR_DSH_WORKDIR_VERSION');
    await assert.rejects(proveWith(async (_url, init) => {
      const request = JSON.parse(init.body);
      return serverResponse(request, {
        version: config.DSH_CONTRACT.hostVersion,
        cwd: '../relative', attachedSessions: 0, canOpenPath: true
      });
    }), (error) => error.code === 'ERR_DSH_WORKDIR_CONTRACT');
    await assert.rejects(proveWith(async (_url, init) => {
      const request = JSON.parse(init.body);
      return serverResponse(request, {
        version: config.DSH_CONTRACT.hostVersion,
        cwd: '/managed', attachedSessions: 0, canOpenPath: true
      }, { response: { url: 'http://example.test/api/host.describe' } });
    }), (error) => error.code === 'ERR_DSH_WORKDIR_REDIRECT');
    await assert.rejects(proveWith(async (_url, init) => {
      const request = JSON.parse(init.body);
      return serverResponse(request, {
        version: config.DSH_CONTRACT.hostVersion,
        cwd: '/managed', attachedSessions: 0, canOpenPath: true,
        padding: 'x'.repeat(2048)
      });
    }, { maxResponseBytes: 256 }), (error) => error.code === 'ERR_DSH_WORKDIR_RESPONSE_TOO_LARGE');

    let timeoutCalls = 0;
    await assert.rejects(proveWith((_url, init) => {
      timeoutCalls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }, { timeoutMs: 5 }), (error) => error.code === 'ERR_DSH_WORKDIR_TIMEOUT');
    assert.equal(timeoutCalls, 1);
    await assert.rejects(proveWith(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Promise((resolve) => {
        setTimeout(() => resolve(serverResponse(request, {
          version: config.DSH_CONTRACT.hostVersion,
          cwd: '/late-managed', attachedSessions: 0, canOpenPath: true
        })), 10);
      });
    }, { timeoutMs: 5 }), (error) => error.code === 'ERR_DSH_WORKDIR_TIMEOUT');

    const changed = baseState();
    const childAtStart = changed.child;
    await assert.rejects(backend.proveManagedWorkdir({
      port: 4319,
      state: changed,
      mintRpcId: () => 'workdir-rpc-changed',
      fetch: async (_url, init) => {
        changed.exited = true;
        const request = JSON.parse(init.body);
        return serverResponse(request, {
          version: config.DSH_CONTRACT.hostVersion,
          cwd: '/managed', attachedSessions: 0, canOpenPath: true
        });
      }
    }), (error) => error.code === 'ERR_DSH_WORKDIR_STATE');
    assert.equal(changed.child, childAtStart);
  });

  const adapter = backend.createDshEventsAdapter({
    port: 4319,
    expectedHostVersion: '0.0.1',
    sessionSalt: 'test-only-session-salt',
    fetch: fetchImpl,
    WebSocket: FakeWebSocket,
    mintRpcId: () => `rpc-${++nextRpc}`
  });

  let sessions;
  await test('list 只连 loopback，使用精确 envelope 且不泄露敏感字段', async () => {
    sessions = await adapter.listSessions();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((item) => new URL(item.url).pathname), [
      '/api/host.describe', '/api/session.list'
    ]);
    for (const item of requests) {
      assert.equal(new URL(item.url).hostname, '127.0.0.1');
      assert.equal(new URL(item.url).port, '4319');
      assert.equal(item.init.method, 'POST');
      assert.equal(item.init.redirect, 'error');
      assert.equal(item.request.type, 'client-request');
      assert.equal(item.request.rpcId.startsWith('rpc-'), true);
      assert.deepEqual(Object.keys(item.request).sort(), ['method', 'payload', 'rpcId', 'type']);
    }
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].origin, 'unknown');
    assert.equal(sessions[1].origin, 'subagent');
    assert.equal(sessions[0].lastSeq, 11);
    assert.notEqual(sessions[0].sessionRef, rawSession);
    assert.notEqual(sessions[0].parentRef, rawParent);
    assert.equal(
      sessions[0].sessionRef,
      backend.dshOpaqueRef('test-only-session-salt', 'session', rawSession)
    );
    const legacyDigest = crypto.createHmac('sha256', 'test-only-session-salt')
      .update(`whaledock-events-v1\0session\0${rawSession}`)
      .digest('hex');
    assert.equal(sessions[0].sessionRef, `session-${legacyDigest}`);
    const serialized = JSON.stringify(sessions);
    for (const secret of [
      rawSession, rawParent, '/Users/private', 'private-preset', 'discard-me', 'dsh-home'
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
  });

  await test('history 仅读分页且只返回中性事件', async () => {
    const result = await adapter.readHistory(sessions[0].sessionRef, {
      beforeSeq: 12,
      maxMessages: 1
    });
    const request = requests.at(-1);
    assert.equal(new URL(request.url).pathname, '/api/session.history');
    assert.deepEqual(request.request.payload, {
      sessionId: rawSession,
      beforeSeq: 12,
      maxMessages: 1
    });
    assert.equal(result.hasMore, true);
    assert.equal(result.nextBeforeSeq, 6);
    assert.equal(result.minSeq, 6);
    assert.equal(result.maxSeq, 9);
    assert.deepEqual(result.events.map((item) => item.kind), [
      'projection', 'message', 'message', 'turn-terminal'
    ]);
    assert.equal(result.events[2].usage.reasoningTokens, undefined);
    assert.equal(result.events[2].usage.outputTokens, 4);
    assert.notEqual(result.events[2].messageRef, rawMessage);
    assert.equal(
      result.events[1].deliveryRef,
      backend.dshOpaqueRef('test-only-session-salt', 'delivery', rawDeliveryRpc)
    );
    const serialized = JSON.stringify(result);
    for (const secret of [
      rawSession, rawMessage, 'legacy-user-message-sensitive', 'legacy secret prompt',
      'secret prompt', 'secret answer', 'private title', rawDeliveryRpc
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
  });

  await test('history 分页上限在发请前 fail-closed', async () => {
    const before = requests.length;
    await assert.rejects(
      adapter.readHistory(sessions[0].sessionRef, { maxMessages: 2 }),
      (error) => error.code === 'ERR_DSH_EVENTS_CONTRACT'
    );
    assert.equal(requests.length, before);
  });

  await test('WebSocket 仅 downlink，不调用 send', async () => {
    const received = [];
    const statuses = [];
    const subscription = adapter.subscribe({
      onEvent: (value) => received.push(value),
      onStatus: (value) => statuses.push(value)
    });
    await subscription.opened;
    const socket = FakeWebSocket.instances.at(-1);
    assert.equal(socket.url, 'ws://127.0.0.1:4319/api/events.mux');
    socket.message({
      type: 'server-request',
      rpcId: 'server-push-1',
      method: 'future/unknown',
      payload: { private: 'bounded-ignore' }
    });
    socket.message({
      type: 'server-request',
      rpcId: 'server-push-2',
      method: 'session/event',
      payload: {
        type: 'session/event',
        sessionId: rawSession,
        event: event('assistant/chunk', 10, {
          turn: 2,
          step: 2,
          chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 } }
        })
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(socket.sent.length, 0);
    assert.equal(received.length, 1);
    assert.equal(received[0].kind, 'message');
    assert.equal(received[0].role, 'other');
    assert.equal(received[0].usageMode, 'chunk');
    assert.equal(received[0].sessionRef, sessions[0].sessionRef);
    assert.equal(statuses.some((item) => item.kind === 'unknown-method'), true);
    subscription.close();
    await subscription.closed;
    assert.equal(statuses.some((item) => item.kind === 'closed'), true);
  });

  await test('同一持久 salt 跨 adapter 重启产生稳定 sessionRef', async () => {
    let stableRpc = 0;
    const restarted = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'test-only-session-salt',
      fetch: fetchImpl,
      WebSocket: FakeWebSocket,
      mintRpcId: () => `stable-rpc-${++stableRpc}`
    });
    const restartedSessions = await restarted.listSessions();
    assert.equal(restartedSessions[0].sessionRef, sessions[0].sessionRef);
    assert.equal(restartedSessions[0].parentRef, sessions[0].parentRef);
    const history = await restarted.readHistory(restartedSessions[0].sessionRef, { maxMessages: 1 });
    assert.equal(history.events[1].sessionRef, sessions[0].sessionRef);
  });

  await test('question request ID 会 HMAC，问题正文被丢弃', async () => {
    const received = [];
    const subscription = adapter.subscribe({ onEvent: (value) => received.push(value) });
    await subscription.opened;
    const socket = FakeWebSocket.instances.at(-1);
    socket.message({
      type: 'server-request',
      rpcId: rawQuestionRpc,
      method: 'question/requested',
      payload: {
        type: 'question/requested',
        sessionId: rawSession,
        questions: [{ id: 'raw-question-id', question: 'private question body' }]
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(received.length, 1);
    assert.equal(received[0].kind, 'question-open');
    assert.notEqual(received[0].requestRef, rawQuestionRpc);
    assert.equal(JSON.stringify(received[0]).includes('private question body'), false);
    subscription.close();
    await subscription.closed;
  });

  await test('session/queue 只输出绑定 deliveryRef 的脱敏快照', async () => {
    const received = [];
    const subscription = adapter.subscribe({ onEvent: (value) => received.push(value) });
    await subscription.opened;
    const socket = FakeWebSocket.instances.at(-1);
    socket.message({
      type: 'server-request',
      rpcId: 'queue-frame-rpc',
      method: 'session/queue',
      payload: {
        type: 'session/queue',
        sessionId: rawSession,
        items: [{
          id: 'raw-queue-item',
          placement: 'queued',
          message: {
            id: 'raw-queue-message',
            role: 'user',
            content: [{ type: 'text', text: 'private queued prompt' }],
            source: { kind: 'user', rpcId: rawDeliveryRpc }
          }
        }, {
          id: 'raw-context-item',
          placement: 'context',
          message: {
            id: 'raw-context-message',
            role: 'assistant',
            content: [{ type: 'text', text: 'private context' }],
            source: { kind: 'agent' }
          }
        }]
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(received, [{
      kind: 'queue-snapshot',
      sessionRef: sessions[0].sessionRef,
      items: [{
        deliveryRef: backend.dshOpaqueRef(
          'test-only-session-salt', 'delivery', rawDeliveryRpc
        ),
        placement: 'queued'
      }]
    }]);
    const serialized = JSON.stringify(received);
    for (const secret of [
      rawSession, rawDeliveryRpc, 'raw-queue-item', 'raw-queue-message',
      'private queued prompt', 'raw-context-message', 'private context'
    ]) assert.equal(serialized.includes(secret), false, secret);
    subscription.close();
    await subscription.closed;
  });

  await test('known WebSocket method 坏 shape 关闭并拒绝 closed', async () => {
    const subscription = adapter.subscribe({});
    await subscription.opened;
    const socket = FakeWebSocket.instances.at(-1);
    socket.message({
      type: 'server-request',
      rpcId: 'server-push-bad',
      method: 'session/event',
      payload: { type: 'session/event', sessionId: rawSession, event: { type: 'turn/end' } }
    });
    await assert.rejects(subscription.closed, (error) => error.code === 'ERR_DSH_EVENTS_CONTRACT');
    assert.equal(socket.closed, true);
    assert.equal(socket.sent.length, 0);
  });

  await test('误把 rc.6 根包版本当 host version 会 fail-closed', async () => {
    const bad = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        return serverResponse(request, {
          version: '0.1.0-rc.6', cwd: '/', attachedSessions: 0, canOpenPath: true
        });
      },
      WebSocket: FakeWebSocket
    });
    await assert.rejects(bad.listSessions(), (error) => error.code === 'ERR_DSH_EVENTS_VERSION');
  });

  await test('HTTP rpcId 不回显或响应 shape 错误 fail-closed', async () => {
    const mismatch = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        return serverResponse(request, {}, { rpcId: 'different-rpc-id' });
      },
      WebSocket: FakeWebSocket
    });
    await assert.rejects(mismatch.listSessions(), (error) => error.code === 'ERR_DSH_EVENTS_CONTRACT');
  });

  await test('history 接受 2.4MB 级合法单消息页并立即丢弃无关 chunk 正文', async () => {
    const largeRawSession = 'large-sensitive-session';
    const largeEvents = [{ event: event('turn/start', 0, { turn: 1 }) }];
    for (let seq = 1; seq <= 9888; seq += 1) {
      largeEvents.push({ event: event('assistant/chunk', seq, {
        turn: 1,
        step: 1,
        chunk: { type: 'text', text: `private-${seq}-` + 'x'.repeat(180) }
      }) });
    }
    largeEvents.push({ event: event('assistant/message', 9889, {
      turn: 1,
      step: 1,
      message: { id: 'large-sensitive-message', content: [{ type: 'text', text: 'private final' }] },
      usage: { inputTokens: 8, outputTokens: 2 }
    }) });
    largeEvents.push({ event: event('turn/end', 9890, {
      turn: 1, reason: { kind: 'completed' }
    }) });
    const largeValue = { events: largeEvents, hasMore: false };
    const encodedBytes = Buffer.byteLength(JSON.stringify({
      type: 'server-response', rpcId: 'measure', result: { ok: true, value: largeValue }
    }));
    assert.equal(encodedBytes > 2_400_000, true, `bytes=${encodedBytes}`);
    assert.equal(encodedBytes < 8 * 1024 * 1024, true, `bytes=${encodedBytes}`);

    const large = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'large-page-salt',
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.method === 'host.describe') {
          return serverResponse(request, {
            version: '0.0.1', cwd: '/', attachedSessions: 1, canOpenPath: true
          });
        }
        if (request.method === 'session.list') {
          return serverResponse(request, { items: [{
            sessionId: largeRawSession,
            updatedAt: 1,
            running: false,
            blank: false,
            projections: { asOfSeq: 9890, values: {} }
          }] });
        }
        assert.equal(request.method, 'session.history');
        assert.equal(request.payload.maxMessages, 1);
        return serverResponse(request, largeValue);
      },
      WebSocket: FakeWebSocket
    });
    const [listed] = await large.listSessions();
    const history = await large.readHistory(listed.sessionRef, { maxMessages: 1 });
    largeHistoryResult = history;
    assert.equal(history.events.length, 9891);
    assert.equal(history.events[0].kind, 'turn-start');
    assert.equal(history.events[0].turn, 1);
    assert.equal(history.events[9888].kind, 'projection');
    assert.equal(history.events[9889].kind, 'message');
    assert.equal(history.events[9890].kind, 'turn-terminal');
    assert.equal(history.minSeq, 0);
    assert.equal(history.maxSeq, 9890);
    assert.equal(JSON.stringify(history).includes('private-'), false);
  });

  await test('adapter 输出可被事件核心直接消费且普通 chunk 不制造 seq gap', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-adapter-events-'));
    const service = events.createEventService({
      stateFile: path.join(directory, 'events-state.json'),
      now: () => new Date(1_800_000_100_000)
    });
    try {
      const sessionRef = largeHistoryResult.events[0].sessionRef;
      await service.registerSession(sessionRef, { notificationFloorSeq: -1 });
      const effects = await service.ingestMany(largeHistoryResult.events);
      assert.equal(effects.filter((item) => item.type === 'task-terminal').length, 1);
      const snapshot = service.snapshot();
      assert.equal(snapshot.coverage.gapSessions, 0);
      assert.equal(snapshot.recentTasks.length, 1);
      assert.equal(snapshot.recentTasks[0].result, 'completed');
      assert.equal(snapshot.recentTasks[0].tokens.total, 10);
      await service.close();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await test('HTTP redirect 和超过 byte 上限均 fail-closed', async () => {
    for (const mode of ['redirect', 'bytes']) {
      const limited = backend.createDshEventsAdapter({
        port: 4319,
        expectedHostVersion: '0.0.1',
        sessionSalt: 'salt',
        maxResponseBytes: 256,
        fetch: async (_url, init) => {
          const request = JSON.parse(init.body);
          if (mode === 'redirect') {
            return serverResponse(request, {}, {
              response: { redirected: true, url: 'http://example.test/stolen' }
            });
          }
          return response('x'.repeat(300));
        },
        WebSocket: FakeWebSocket
      });
      await assert.rejects(limited.listSessions(), (error) => (
        mode === 'redirect'
          ? error.code === 'ERR_DSH_EVENTS_REDIRECT'
          : error.code === 'ERR_DSH_EVENTS_RESPONSE_TOO_LARGE'
      ));
    }
  });

  await test('HTTP timeout 覆盖响应头与 body 读取全程', async () => {
    for (const phase of ['headers', 'body']) {
      let aborted = false;
      const timed = backend.createDshEventsAdapter({
        port: 4319,
        expectedHostVersion: '0.0.1',
        sessionSalt: 'salt',
        timeoutMs: 20,
        fetch: async (_url, init) => {
          if (phase === 'headers') {
            return new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => {
                aborted = true;
                reject(init.signal.reason || new Error('aborted'));
              });
            });
          }
          return {
            ok: true,
            status: 200,
            redirected: false,
            url: 'http://127.0.0.1:4319/api/host.describe',
            headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/json' : null },
            text: async () => new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => {
                aborted = true;
                reject(init.signal.reason || new Error('aborted'));
              });
            })
          };
        },
        WebSocket: FakeWebSocket
      });
      await assert.rejects(timed.listSessions(), (error) => error.code === 'ERR_DSH_EVENTS_TIMEOUT');
      assert.equal(aborted, true, phase);
    }
  });

  await test('无 Content-Length 的流式响应在字节上限处立即中止', async () => {
    let reads = 0;
    let cancelled = false;
    const limited = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      maxResponseBytes: 128,
      fetch: async () => ({
        ok: true,
        status: 200,
        redirected: false,
        url: 'http://127.0.0.1:4319/api/host.describe',
        headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/json' : null },
        text: async () => { throw new Error('不应退回全量 text()'); },
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1;
              return { done: false, value: new Uint8Array(100) };
            },
            cancel: async () => { cancelled = true; },
            releaseLock: () => {}
          })
        }
      }),
      WebSocket: FakeWebSocket
    });
    await assert.rejects(limited.describe(), (error) => error.code === 'ERR_DSH_EVENTS_RESPONSE_TOO_LARGE');
    assert.equal(reads, 2);
    assert.equal(cancelled, true);
  });

  await test('describe 瞬时失败可重试，adapter close 后统一拒绝新请求', async () => {
    let calls = 0;
    const retrying = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      fetch: async (_url, init) => {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        const request = JSON.parse(init.body);
        return serverResponse(request, {
          version: '0.0.1', cwd: '/', attachedSessions: 0, canOpenPath: true
        });
      },
      WebSocket: FakeWebSocket
    });
    await assert.rejects(retrying.describe(), (error) => error.code === 'ERR_DSH_EVENTS_TRANSPORT');
    assert.deepEqual(await retrying.describe(), { version: '0.0.1' });
    assert.equal(calls, 2);
    await retrying.close();
    await assert.rejects(retrying.describe(), (error) => error.code === 'ERR_DSH_EVENTS_CLOSED');
  });

  await test('history beforeSeq 必须严格递减，拒绝回填死循环', async () => {
    const paging = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.method === 'host.describe') {
          return serverResponse(request, {
            version: '0.0.1', cwd: '/', attachedSessions: 1, canOpenPath: true
          });
        }
        if (request.method === 'session.list') {
          return serverResponse(request, { items: [{
            sessionId: 'paging-session', updatedAt: 1, running: false, blank: false
          }] });
        }
        return serverResponse(request, {
          events: [{ event: event('turn/start', 5, { turn: 1 }) }], hasMore: true
        });
      },
      WebSocket: FakeWebSocket
    });
    const [session] = await paging.listSessions();
    await assert.rejects(
      paging.readHistory(session.sessionRef, { beforeSeq: 5 }),
      (error) => error.code === 'ERR_DSH_EVENTS_CONTRACT'
    );
    await paging.close();
  });

  await test('WebSocket 握手、监听器与异常关闭都 fail-closed', async () => {
    const hostFetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      return serverResponse(request, {
        version: '0.0.1', cwd: '/', attachedSessions: 0, canOpenPath: true
      });
    };
    class SilentSocket {
      addEventListener() {}
      close() {}
    }
    const timeoutAdapter = backend.createDshEventsAdapter({
      port: 4319, expectedHostVersion: '0.0.1', sessionSalt: 'salt',
      timeoutMs: 20, fetch: hostFetch, WebSocket: SilentSocket
    });
    const timedSubscription = timeoutAdapter.subscribe();
    await Promise.all([
      assert.rejects(timedSubscription.opened, (error) => error.code === 'ERR_DSH_EVENTS_TIMEOUT'),
      assert.rejects(timedSubscription.closed, (error) => error.code === 'ERR_DSH_EVENTS_TIMEOUT')
    ]);

    class InvalidSocket { close() {} }
    const invalidAdapter = backend.createDshEventsAdapter({
      port: 4319, expectedHostVersion: '0.0.1', sessionSalt: 'salt',
      fetch: hostFetch, WebSocket: InvalidSocket
    });
    const invalidSubscription = invalidAdapter.subscribe();
    await Promise.all([
      assert.rejects(invalidSubscription.opened, (error) => error.code === 'ERR_DSH_EVENTS_CONTRACT'),
      assert.rejects(invalidSubscription.closed, (error) => error.code === 'ERR_DSH_EVENTS_CONTRACT')
    ]);

    const abnormalAdapter = backend.createDshEventsAdapter({
      port: 4319, expectedHostVersion: '0.0.1', sessionSalt: 'salt',
      fetch: hostFetch, WebSocket: FakeWebSocket
    });
    const abnormalSubscription = abnormalAdapter.subscribe();
    await abnormalSubscription.opened;
    const abnormalClosed = assert.rejects(
      abnormalSubscription.closed,
      (error) => error.code === 'ERR_DSH_EVENTS_TRANSPORT'
    );
    FakeWebSocket.instances.at(-1).emit('close', { code: 1006, reason: 'remote secret' });
    await abnormalClosed;
    await Promise.all([timeoutAdapter.close(), invalidAdapter.close(), abnormalAdapter.close()]);
  });

  await test('异步事件消费者失败被串行捕获且 stream/error 不进入事件核心', async () => {
    const statuses = [];
    const seen = [];
    const consuming = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        return serverResponse(request, {
          version: '0.0.1', cwd: '/', attachedSessions: 0, canOpenPath: true
        });
      },
      WebSocket: FakeWebSocket
    });
    const subscription = consuming.subscribe({
      onStatus: async (status) => { statuses.push(status); },
      onEvent: async (value) => {
        seen.push(value.kind);
        throw new Error('consumer failed');
      }
    });
    await subscription.opened;
    const socket = FakeWebSocket.instances.at(-1);
    socket.message({
      type: 'server-request', rpcId: 'remote-error', method: 'stream/error',
      payload: { type: 'stream/error', error: { code: 'SECRET_CODE', message: 'secret', details: {} } }
    });
    assert.deepEqual(seen, []);
    assert.equal(statuses.some((item) => item.kind === 'remote-error'), true);
    const closed = assert.rejects(subscription.closed, (error) => error.code === 'ERR_DSH_EVENTS_CONSUMER');
    socket.message({
      type: 'server-request', rpcId: 'event-after-error', method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'consumer-session', lastSeq: -1 }
    });
    await closed;
    assert.deepEqual(seen, ['subscribed']);
    assert.equal(JSON.stringify(statuses).includes('SECRET_CODE'), false);
    await consuming.close();
  });

  await test('消费者 backlog 有界，远端正常码关闭也触发重连语义', async () => {
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    const bounded = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      maxPendingEvents: 2,
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        return serverResponse(request, {
          version: '0.0.1', cwd: '/', attachedSessions: 0, canOpenPath: true
        });
      },
      WebSocket: FakeWebSocket
    });
    let delivered = 0;
    const subscription = bounded.subscribe({
      onEvent: async () => {
        delivered += 1;
        if (delivered === 1) await first;
      }
    });
    await subscription.opened;
    const socket = FakeWebSocket.instances.at(-1);
    const closed = assert.rejects(
      subscription.closed,
      (error) => error.code === 'ERR_DSH_EVENTS_CONSUMER_BACKLOG'
    );
    for (let index = 0; index < 3; index += 1) {
      socket.message({
        type: 'server-request', rpcId: `queued-${index}`, method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: `queued-session-${index}`, lastSeq: -1 }
      });
      if (index === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    await closed;
    assert.equal(delivered, 1);
    releaseFirst();
    await bounded.close();

    const remote = backend.createDshEventsAdapter({
      port: 4319, expectedHostVersion: '0.0.1', sessionSalt: 'salt',
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        return serverResponse(request, {
          version: '0.0.1', cwd: '/', attachedSessions: 0, canOpenPath: true
        });
      },
      WebSocket: FakeWebSocket
    });
    const remoteSubscription = remote.subscribe();
    await remoteSubscription.opened;
    const remoteClosed = assert.rejects(
      remoteSubscription.closed,
      (error) => error.code === 'ERR_DSH_EVENTS_TRANSPORT'
    );
    FakeWebSocket.instances.at(-1).emit('close', { code: 1000, reason: 'normal remote close' });
    await remoteClosed;
    await remote.close();
  });

  await test('adapter.close 消费 opened rejection 并等待 HTTP abort 真正落定', async () => {
    let requestSettled = false;
    let unhandled = null;
    const onUnhandled = (error) => { unhandled = error; };
    process.once('unhandledRejection', onUnhandled);
    const closing = backend.createDshEventsAdapter({
      port: 4319,
      expectedHostVersion: '0.0.1',
      sessionSalt: 'salt',
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          setTimeout(() => {
            requestSettled = true;
            reject(new Error('abort settled'));
          }, 25);
        });
      }),
      WebSocket: FakeWebSocket
    });
    closing.subscribe();
    const request = closing.describe().catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    await closing.close();
    const requestError = await request;
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener('unhandledRejection', onUnhandled);
    assert.equal(requestSettled, true);
    assert.equal(requestError.code, 'ERR_DSH_EVENTS_CLOSED');
    assert.equal(unhandled, null);
  });

  console.log(`\n${passed}/${passed} ALL PASS`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
