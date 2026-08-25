'use strict';

const assert = require('assert/strict');
const { createHmac } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

let passed = 0;
const CONTRACT = 'whaledock.context-bridge/v1';
const BRIDGE_TOKEN = 'ab'.repeat(32);
const SELECTION_TOKEN = 'cd'.repeat(32);

function bridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return createHmac('sha256', secret)
    .update(`${label}\0${CONTRACT}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

function rpcSession(secret, clientNonce, hostInstanceId) {
  return bridgeHmac(secret, 'rpc-session', clientNonce, hostInstanceId);
}

function handshakeRequest(clientNonce, secret = BRIDGE_TOKEN) {
  return {
    type: 'handshake',
    protocol: CONTRACT,
    clientNonce,
    requestProof: bridgeHmac(secret, 'handshake-request', clientNonce, '')
  };
}

function selectionRequest(value) {
  return { ...value, selectionToken: SELECTION_TOKEN };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  context-poc-plugin: ${name}`);
  } catch (error) {
    console.error(`FAIL  context-poc-plugin: ${name}`);
    throw error;
  }
}

async function main() {
  const root = path.join(__dirname, '..');
  const sourceRoot = path.join(root, 'context-poc');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'plugin', 'package.json'), 'utf8'
  ));

  await test('静态包无生产依赖且 Host/Client/package exports 完整', async () => {
    assert.equal(manifest.name, '@whaledock/context-bridge-poc');
    assert.equal(manifest.type, 'module');
    assert.equal(manifest.private, true);
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'dependencies'), false);
    assert.equal(manifest.exports['.'], './lib/index.js');
    assert.equal(manifest.exports['./client'], './lib/client.js');
    assert.equal(manifest.exports['./package.json'], './package.json');
    assert.deepEqual(manifest.dsh.client.inject, [
      '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime'
    ]);
    const patch = fs.readFileSync(path.join(sourceRoot, 'context-bridge.patch.yml'), 'utf8');
    assert.match(patch, /id: whaledock-context-bridge-poc/);
    assert.match(patch, /name: '@whaledock\/context-bridge-poc'/);
    const layoutManifest = JSON.parse(fs.readFileSync(
      path.join(sourceRoot, 'forks', 'ui-layout', 'package.json'), 'utf8'
    ));
    const conversationManifest = JSON.parse(fs.readFileSync(
      path.join(sourceRoot, 'forks', 'ui-conversation', 'package.json'), 'utf8'
    ));
    assert.equal(layoutManifest.name, '@deepseek-ai/dsh-client-ui-layout');
    assert.equal(conversationManifest.name, '@deepseek-ai/dsh-client-ui-conversation');
    const layoutFork = fs.readFileSync(path.join(
      sourceRoot, 'forks', 'ui-layout', 'lib', 'client.js'
    ), 'utf8');
    assert.match(layoutFork, /data-whaledock-layout/);
    assert.match(layoutFork, /useWorkspaces/);
    assert.match(layoutFork, /workspaces\.connectWorkspace\(workspaceId\)/);
    assert.match(layoutFork, /右侧已有未发送内容/);
    const conversationFork = fs.readFileSync(path.join(
      sourceRoot, 'forks', 'ui-conversation', 'lib', 'client.js'
    ), 'utf8');
    assert.match(conversationFork, /whaledockContextGate/);
    assert.match(conversationFork, /工作台上下文尚未准备好/);
  });

  await test('Client 静态 bundle 从正式 sessions.list 上报选择并维持同 revision 心跳', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    const storage = new Map();
    const timers = new Map();
    let timerId = 0;
    const replacedUrls = [];
    const sandbox = {
      window: { __ModuleLoader__: { load(value) { definition = value; } } },
      location: {
        hash: `#whaledockController=controller-12345678&whaledockSelectionToken=${SELECTION_TOKEN}`,
        pathname: '/',
        search: '?native=preserved'
      },
      history: {
        state: { native: true },
        replaceState(state, title, url) { replacedUrls.push({ state, title, url }); }
      },
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value))
      },
      setInterval(fn) { const id = ++timerId; timers.set(id, fn); return id; },
      clearInterval(id) { timers.delete(id); },
      setTimeout,
      clearTimeout,
      URLSearchParams,
      AbortController,
      Date,
      Symbol,
      Object,
      Number,
      Promise
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'context-poc/client.js' });
    assert.equal(definition.id, '@whaledock/context-bridge-poc');
    const plugin = definition.factory(() => { throw new Error('no imports expected'); });
    assert.deepEqual(Array.from(plugin.inject), ['connection', 'sessions']);

    const calls = [];
    let current = 'raw-session-a';
    let sessionListener = null;
    let hostListener = null;
    let dispose = null;
    let gate = null;
    let gateDisposed = false;
    const connection = {
      isLoopback: true,
      rpc: {
        call: async (channel, endpoint, payload) => {
          calls.push({ channel, endpoint, payload });
          if (calls.length === 3) {
            return {
              ok: true,
              value: {
                state: 'ignored-stale',
                code: 'selection-revision-stale',
                selectionRevision: 5
              }
            };
          }
          return { ok: true, value: {} };
        }
      },
      hostDescription: {
        subscribe(listener) { hostListener = listener; return () => { hostListener = null; }; }
      }
    };
    const sessions = {
      list: {
        getSnapshot: () => ({ phase: 'ready', current }),
        subscribe(listener) { sessionListener = listener; return () => { sessionListener = null; }; }
      }
    };
    plugin.apply({
      get: (name) => (name === 'connection' ? connection : sessions),
      reflect: {
        provide(name, value) {
          assert.equal(name, 'whaledockContextGate');
          gate = value;
          return () => { gateDisposed = true; };
        }
      },
      effect: (factory) => { dispose = factory(); }
    });
    await Promise.resolve();
    assert.deepEqual(replacedUrls, [{
      state: { native: true }, title: '', url: '/?native=preserved'
    }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, 'selection/register');
    assert.equal(calls[0].payload.currentSessionId, 'raw-session-a');
    assert.equal(calls[0].payload.selectionRevision, 1);
    assert.equal(calls[0].payload.managed, true);
    assert.equal(calls[0].payload.selectionToken, SELECTION_TOKEN);

    current = 'raw-session-b';
    sessionListener();
    await Promise.resolve();
    assert.equal(calls[1].payload.selectionRevision, 2);
    assert.equal(calls[1].payload.currentSessionId, 'raw-session-b');
    hostListener();
    await Promise.resolve();
    assert.equal(calls[2].payload.selectionRevision, 2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls[3].payload.selectionRevision, 6);
    assert.equal(storage.get('whaledock.context.selection.controller-12345678'), '6');
    assert.equal(timers.size, 1);
    assert.equal(typeof gate.beforeSend, 'function');
    dispose();
    assert.equal(timers.size, 0);
    assert.equal(gateDisposed, true);
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-context-plugin-'));
  const oldToken = process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
  const oldSelectionToken = process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN;
  try {
    const nodeModules = path.join(tmp, 'node_modules');
    const packageRoot = path.join(nodeModules, '@whaledock', 'context-bridge-poc');
    fs.mkdirSync(path.dirname(packageRoot), { recursive: true });
    fs.cpSync(path.join(sourceRoot, 'plugin'), packageRoot, { recursive: true });
    const llmFixtureRoot = path.join(nodeModules, '@deepseek-ai', 'dsh-llm');
    fs.mkdirSync(path.join(llmFixtureRoot, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(llmFixtureRoot, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      version: '0.1.1-rc.2',
      type: 'module',
      exports: { '.': './lib/index.js' }
    }));
    fs.writeFileSync(path.join(llmFixtureRoot, 'lib', 'index.js'), [
      'export function isAgentLoopRequest(value) {',
      "  return Boolean(value && value.__agentLoop === 'fixture');",
      '}',
      'export function markAgentLoopRequest(value) {',
      "  return { ...value, __agentLoop: 'fixture' };",
      '}'
    ].join('\n'));
    process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN = BRIDGE_TOKEN;
    process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN = SELECTION_TOKEN;
    const hostPlugin = await import(`${pathToFileURL(path.join(packageRoot, 'lib', 'index.js')).href}?t=${Date.now()}`);
    const llm = await import(pathToFileURL(path.join(
      llmFixtureRoot, 'lib', 'index.js'
    )).href);

    await test('Host RPC 真实执行 handshake→selection→stage→turn→delivery 事件序列', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: {
          rpc: {
            handle(channel, handler, options) {
              assert.equal(channel, '/whaledock.context');
              assert.deepEqual(options, { authority: 'loopback' });
              rpcHandler = handler;
            }
          }
        },
        systemPrompt: {
          context(provider) { contextProvider = provider; }
        },
        on(name, handler, options) {
          listeners.set(name, { handler, options });
        }
      });
      assert.equal(typeof rpcHandler, 'function');
      assert.equal(contextProvider.name, 'whaledock:workspace-context');

      const secret = 'ab'.repeat(32);
      const clientNonce = '01'.repeat(32);
      const handshake = await rpcHandler('handshake', handshakeRequest(clientNonce));
      assert.equal(handshake.ok, true);
      assert.equal(handshake.value.ok, true);
      assert.match(handshake.value.hostInstanceId, /^host-/);
      assert.equal(handshake.value.capabilities.includes('delivery-proof'), true);
      const hostInstanceId = handshake.value.hostInstanceId;
      assert.equal(handshake.value.clientNonce, clientNonce);
      assert.equal(
        handshake.value.proof,
        bridgeHmac(secret, 'handshake-proof', clientNonce, hostInstanceId)
      );
      const authToken = rpcSession(secret, clientNonce, hostInstanceId);

      const selection = await rpcHandler('selection/register', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        currentSessionId: 'raw-session-a',
        managed: true,
        selectionToken: SELECTION_TOKEN
      });
      assert.equal(selection.ok, true);
      assert.equal(selection.value.state, 'selected');
      assert.match(selection.value.sessionRef, /^session-[a-f0-9]{64}$/);
      const sessionRef = selection.value.sessionRef;
      const preflight = (overrides = {}) => rpcHandler('context/preflight', {
        contract: CONTRACT,
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        currentSessionId: 'raw-session-a',
        mode: 'queue',
        managed: true,
        selectionToken: SELECTION_TOKEN,
        ...overrides
      });
      assert.deepEqual((await preflight()).value, {
        ready: false, code: 'context-not-effective'
      });
      assert.equal((await preflight({ currentSessionId: 'raw-session-other' })).value.ready, false);
      assert.equal((await preflight({ selectionToken: 'ef'.repeat(32) })).ok, false);

      const resolved = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-12345678',
        authToken
      });
      assert.equal(resolved.value.sessionRef, sessionRef);
      assert.equal(JSON.stringify(resolved).includes('raw-session-a'), false);

      const envelope = {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: 'client-12345678',
        hostInstanceId,
        sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'1'.repeat(32)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title: '视频项目 A',
          projectRevision: null
        }
      };
      const staged = await rpcHandler('context/stage', {
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        envelope,
        authToken
      });
      assert.equal(staged.value.accepted, true);
      assert.equal(staged.value.state, 'effective');
      assert.deepEqual((await preflight()).value, { ready: true, code: null });

      for (const relativePath of [
        '/Users/example/private', '../../private', 'C:/private', 'C:private', 'file:/private'
      ]) {
        const invalidPath = await rpcHandler('context/stage', {
          controllerId: 'controller-12345678',
          pageInstanceId: 'page-123456789012',
          selectionRevision: 1,
          envelope: {
            ...envelope,
            revision: 2,
            project: { ...envelope.project, relativePath }
          },
          authToken
        });
        assert.equal(invalidPath.ok, false);
      }

      const sessionEvent = listeners.get('session/event').handler;
      sessionEvent({ id: 'raw-session-a' }, { type: 'turn/start', data: { turn: 7 } });
      assert.deepEqual((await preflight({ mode: 'steer' })).value, {
        ready: true, code: null
      });
      const contextText = contextProvider.text({ agent: { id: 'raw-session-a' } });
      assert.match(contextText, /contextRevision/);
      assert.match(contextText, /视频项目 A/);

      const message = {
        id: 'message-12345678',
        role: 'user',
        content: [{ type: 'text', text: contextText }],
        source: {
          kind: 'plugin',
          plugin: '@deepseek-ai/dsh-system-prompt',
          form: 'snapshot',
          sections: [{ name: 'whaledock:workspace-context', text: contextText }]
        }
      };
      const options = llm.markAgentLoopRequest({
        provider: 'fixture', model: 'fixture', sessionId: 'raw-session-a', messages: [message]
      });
      const llmListener = listeners.get('llm/stream');
      assert.deepEqual(llmListener.options, { global: true, prepend: true });
      assert.equal(llmListener.handler(options, () => 'native-stream'), 'native-stream');
      sessionEvent({ id: 'raw-session-a' }, {
        type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } }
      });

      const events = await rpcHandler('events/read', {
        contract: 'whaledock.context-bridge/v1',
        hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(events.value.events.map((event) => event.type), [
        'ack', 'turn-start', 'delivery', 'turn-end'
      ]);
      assert.deepEqual(events.value.events.map((event) => event.eventSeq), [1, 2, 3, 4]);
      assert.equal(events.value.events[2].proof.boundary, 'llm-stream-local');
      assert.equal(JSON.stringify(events.value).includes('raw-session-a'), false);
    });

    await test('同 raw session 多 controller 冲突，错误 auth 与未知字段均拒绝', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      let sessionEvent = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) {
          if (name === 'session/event') sessionEvent = handler;
        }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '02'.repeat(32);
      const handshake = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, handshake.value.hostInstanceId);
      const register = (controllerId, managed) => rpcHandler('selection/register', {
        contract: 'whaledock.context-bridge/v1',
        controllerId,
        pageInstanceId: `page-${controllerId.slice(-8)}`,
        selectionRevision: 1,
        currentSessionId: 'same-raw-session',
        managed,
        selectionToken: SELECTION_TOKEN
      });
      const first = await register('controller-11111111', true);
      assert.equal(first.value.state, 'selected');
      const duplicatePage = () => rpcHandler('selection/register', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        pageInstanceId: 'page-second1111',
        selectionRevision: 1,
        currentSessionId: 'same-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      });
      assert.equal((await duplicatePage()).value.state, 'conflict');
      assert.equal((await register('controller-11111111', true)).value.state, 'selected');
      assert.equal((await duplicatePage()).value.state, 'conflict');
      const staged = await rpcHandler('context/stage', {
        controllerId: 'controller-11111111',
        pageInstanceId: 'page-11111111',
        selectionRevision: 1,
        envelope: {
          contract: 'whaledock.context-bridge/v1',
          clientInstanceId: 'client-conflict1',
          hostInstanceId: handshake.value.hostInstanceId,
          sessionRef: first.value.sessionRef,
          revision: 1,
          project: {
            projectId: `wdp1_${'3'.repeat(32)}`,
            relativePath: '.',
            workbenchId: 'builtin:video',
            title: '冲突上下文',
            projectRevision: null
          }
        },
        authToken
      });
      assert.equal(staged.value.accepted, true);
      assert.equal((await register('observer-22222222', false)).value.state, 'conflict');
      const conflicted = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        authToken
      });
      assert.equal(conflicted.value.state, 'conflict');
      assert.equal(conflicted.value.sessionRef, null);

      sessionEvent({ id: 'same-raw-session' }, { type: 'turn/start', data: { turn: 1 } });
      assert.equal(contextProvider.text({ agent: { id: 'same-raw-session' } }), '');
      const missed = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: handshake.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(missed.value.events.map((event) => event.type), ['ack', 'turn-miss']);
      assert.equal(missed.value.events[1].reason, 'session-unavailable');

      const wrongAuth = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        authToken: 'cd'.repeat(32)
      });
      assert.equal(wrongAuth.ok, false);
      const wrongSelection = await rpcHandler('selection/register', {
        contract: CONTRACT,
        controllerId: 'controller-unauth001',
        pageInstanceId: 'page-unauth000001',
        selectionRevision: 1,
        currentSessionId: null,
        managed: false,
        selectionToken: 'ef'.repeat(32)
      });
      assert.equal(wrongSelection.ok, false);
      for (let index = 0; index < 6; index += 1) {
        const refusedHandshake = await rpcHandler(
          'handshake', handshakeRequest(`${index}`.padStart(64, '0'), 'ef'.repeat(32))
        );
        assert.equal(refusedHandshake.ok, false);
      }
      const stillAuthenticated = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-11111111',
        authToken
      });
      assert.equal(stillAuthenticated.ok, true,
        '未认证 handshake 不得挤出已有 RPC session');
      const unknown = await rpcHandler('handshake', {
        ...handshakeRequest(clientNonce), unexpected: true
      });
      assert.equal(unknown.ok, false);
      assert.notEqual(handshake.value.hostInstanceId, undefined);
    });

    await test('两活页面中较高 revision 一次接管，heartbeat 不往返夺权', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const register = (pageInstanceId, selectionRevision) => (
        rpcHandler('selection/register', {
          contract: CONTRACT,
          controllerId: 'controller-two-pages',
          pageInstanceId,
          selectionRevision,
          currentSessionId: 'two-pages-raw',
          managed: true,
          selectionToken: SELECTION_TOKEN
        })
      );
      const first = await register('page-two-pages-a1', 1);
      const second = await register('page-two-pages-b2', 2);
      assert.equal(first.value.state, 'selected');
      assert.equal(second.value.state, 'selected');
      for (let index = 0; index < 4; index += 1) {
        const oldPage = await register('page-two-pages-a1', 1);
        const ownerPage = await register('page-two-pages-b2', 2);
        assert.equal(oldPage.value.state, 'conflict');
        assert.equal(oldPage.value.selectionRevision, 2);
        assert.equal(ownerPage.value.state, 'selected');
        assert.equal(ownerPage.value.sessionRef, second.value.sessionRef);
      }
    });

    await test('重复 stage 返回可消费 ACK，无需污染有序事件 journal', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '03'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, hello.value.hostInstanceId);
      const selected = await rpcHandler('selection/register', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-duplicate1',
        pageInstanceId: 'page-duplicate0001',
        selectionRevision: 1,
        currentSessionId: 'duplicate-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      });
      const envelope = {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: 'client-duplicate01',
        hostInstanceId: hello.value.hostInstanceId,
        sessionRef: selected.value.sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'d'.repeat(32)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title: '幂等恢复',
          projectRevision: null
        }
      };
      const payload = {
        controllerId: 'controller-duplicate1',
        pageInstanceId: 'page-duplicate0001',
        selectionRevision: 1,
        envelope,
        authToken
      };
      assert.equal((await rpcHandler('context/stage', payload)).value.state, 'effective');
      const duplicate = await rpcHandler('context/stage', payload);
      assert.equal(duplicate.value.state, 'duplicate');
      assert.deepEqual(duplicate.value.ack, {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: envelope.clientInstanceId,
        hostInstanceId: envelope.hostInstanceId,
        sessionRef: envelope.sessionRef,
        revision: 1,
        state: 'effective'
      });
      const events = await rpcHandler('events/read', {
        contract: 'whaledock.context-bridge/v1',
        hostInstanceId: envelope.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(events.value.events.map((event) => event.type), ['ack']);
    });

    await test('两 session 快速 A→B→A 每次轮换 opaque ref 且 turn 上下文不串线', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) { listeners.set(name, handler); }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '06'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, hello.value.hostInstanceId);
      const controllerId = 'controller-abaswitch';
      const pageInstanceId = 'page-abaswitch0001';
      const select = (raw, revision) => rpcHandler('selection/register', {
        contract: CONTRACT,
        controllerId,
        pageInstanceId,
        selectionRevision: revision,
        currentSessionId: raw,
        managed: true,
        selectionToken: SELECTION_TOKEN
      });
      const stage = (selection, revision, title, digit) => rpcHandler('context/stage', {
        controllerId,
        pageInstanceId,
        selectionRevision: revision,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-abaswitch1',
          hostInstanceId: hello.value.hostInstanceId,
          sessionRef: selection.value.sessionRef,
          revision: 1,
          project: {
            projectId: `wdp1_${digit.repeat(32)}`,
            relativePath: '.',
            workbenchId: 'builtin:video',
            title,
            projectRevision: null
          }
        },
        authToken
      });
      const firstA = await select('raw-session-a-fast', 1);
      await stage(firstA, 1, 'A-first', 'a');
      const selectedB = await select('raw-session-b-fast', 2);
      await stage(selectedB, 2, 'B-only', 'b');
      const sessionEvent = listeners.get('session/event');
      sessionEvent({ id: 'raw-session-b-fast' }, { type: 'turn/start', data: { turn: 1 } });
      const bText = contextProvider.text({ agent: { id: 'raw-session-b-fast' } });
      assert.match(bText, /B-only/);
      assert.doesNotMatch(bText, /A-first/);
      sessionEvent({ id: 'raw-session-b-fast' }, { type: 'turn/end', data: { turn: 1 } });

      const secondA = await select('raw-session-a-fast', 3);
      assert.notEqual(secondA.value.sessionRef, firstA.value.sessionRef);
      await stage(secondA, 3, 'A-returned', 'c');
      sessionEvent({ id: 'raw-session-a-fast' }, { type: 'turn/start', data: { turn: 2 } });
      const aText = contextProvider.text({ agent: { id: 'raw-session-a-fast' } });
      assert.match(aText, /A-returned/);
      assert.doesNotMatch(aText, /B-only|A-first/);
    });

    await test('controller/record 有硬上限，lease 过期后可回收并重用容量', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;
      try {
        for (let index = 0; index < 128; index += 1) {
          const reply = await rpcHandler('selection/register', {
            contract: CONTRACT,
            controllerId: `observer-capacity-${String(index).padStart(3, '0')}`,
            pageInstanceId: `page-capacity-${String(index).padStart(3, '0')}`,
            selectionRevision: 1,
            currentSessionId: null,
            managed: false,
            selectionToken: SELECTION_TOKEN
          });
          assert.notEqual(reply.value.code, 'controller-capacity');
        }
        const full = await rpcHandler('selection/register', {
          contract: CONTRACT,
          controllerId: 'observer-capacity-overflow',
          pageInstanceId: 'page-capacity-overflow',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          selectionToken: SELECTION_TOKEN
        });
        assert.equal(full.value.code, 'controller-capacity');
        now += 16000;
        const recovered = await rpcHandler('selection/register', {
          contract: CONTRACT,
          controllerId: 'observer-capacity-reused',
          pageInstanceId: 'page-capacity-reused',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          selectionToken: SELECTION_TOKEN
        });
        assert.equal(recovered.value.state, 'none');
      } finally {
        Date.now = originalNow;
      }
    });

    await test('冲突方 lease 过期后立即恢复唯一活跃 owner 的 turn 上下文', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      let sessionEvent = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) {
          if (name === 'session/event') sessionEvent = handler;
        }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '05'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(secret, clientNonce, hello.value.hostInstanceId);
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;
      try {
        const register = (controllerId, pageInstanceId) => rpcHandler('selection/register', {
          contract: CONTRACT,
          controllerId,
          pageInstanceId,
          selectionRevision: 1,
          currentSessionId: 'lease-recovery-raw',
          managed: true,
          selectionToken: SELECTION_TOKEN
        });
        const owner = await register('controller-leaseowner', 'page-leaseowner01');
        await rpcHandler('context/stage', {
          controllerId: 'controller-leaseowner',
          pageInstanceId: 'page-leaseowner01',
          selectionRevision: 1,
          envelope: {
            contract: CONTRACT,
            clientInstanceId: 'client-leaseowner1',
            hostInstanceId: hello.value.hostInstanceId,
            sessionRef: owner.value.sessionRef,
            revision: 1,
            project: {
              projectId: `wdp1_${'5'.repeat(32)}`,
              relativePath: '.',
              workbenchId: 'builtin:video',
              title: 'Lease 恢复',
              projectRevision: null
            }
          },
          authToken
        });
        now += 1000;
        assert.equal((await register(
          'controller-leaseother', 'page-leaseother01'
        )).value.state, 'conflict');
        now += 13000;
        assert.equal((await register(
          'controller-leaseowner', 'page-leaseowner01'
        )).value.state, 'conflict');
        now += 3000;
        sessionEvent({ id: 'lease-recovery-raw' }, {
          type: 'turn/start', data: { turn: 1 }
        });
        assert.match(contextProvider.text({ agent: { id: 'lease-recovery-raw' } }), /Lease 恢复/);
      } finally {
        Date.now = originalNow;
      }
    });

    await test('页面刷新会轮换 sessionRef，但已开启 turn 保持旧上下文直到结束', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler) { listeners.set(name, handler); }
      });
      const secret = 'ab'.repeat(32);
      const clientNonce = '04'.repeat(32);
      const handshakeReply = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = handshakeReply.value.hostInstanceId;
      const authToken = rpcSession(secret, clientNonce, hostInstanceId);
      const register = (pageInstanceId, selectionRevision) => rpcHandler('selection/register', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-refresh1',
        pageInstanceId,
        selectionRevision,
        currentSessionId: 'refresh-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      });
      const first = await register('page-refresh0001', 1);
      const envelope = (sessionRef, clientInstanceId, title) => ({
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId,
        hostInstanceId,
        sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${title === 'A' ? 'a' : 'b'.repeat(1)}${'0'.repeat(31)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title,
          projectRevision: null
        }
      });
      const stage = (selection, pageInstanceId, selectionRevision, context) => (
        rpcHandler('context/stage', {
          controllerId: 'controller-refresh1',
          pageInstanceId,
          selectionRevision,
          envelope: context,
          authToken
        })
      );
      await stage(first.value, 'page-refresh0001', 1,
        envelope(first.value.sessionRef, 'client-refresh01', 'A'));
      const sessionEvent = listeners.get('session/event');
      sessionEvent({ id: 'refresh-raw-session' }, { type: 'turn/start', data: { turn: 1 } });
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"A"/);

      const second = await register('page-refresh0002', 2);
      assert.equal(second.value.state, 'selected');
      assert.notEqual(second.value.sessionRef, first.value.sessionRef);
      await stage(second.value, 'page-refresh0002', 2,
        envelope(second.value.sessionRef, 'client-refresh02', 'B'));
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"A"/);
      sessionEvent({ id: 'refresh-raw-session' }, {
        type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }
      });
      sessionEvent({ id: 'refresh-raw-session' }, { type: 'turn/start', data: { turn: 2 } });
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"B"/);
    });
  } finally {
    if (oldToken === undefined) delete process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
    else process.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN = oldToken;
    if (oldSelectionToken === undefined) delete process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN;
    else process.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN = oldSelectionToken;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nCONTEXT POC PLUGIN ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
