'use strict';

const assert = require('assert/strict');
const { createHash, createHmac } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

let passed = 0;
const CONTRACT = 'whaledock.context-bridge/v1';
const BRIDGE_TOKEN = 'ab'.repeat(32);
const SELECTION_TOKEN = 'cd'.repeat(32);
const controllerProofs = new Map();
let registerNonceSequence = 0;

function clientImport(specifier) {
  if (specifier === 'react') return {};
  if (specifier === 'react/jsx-runtime') return {};
  throw new Error(`unexpected client import: ${specifier}`);
}

function bridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return createHmac('sha256', secret)
    .update(`${label}\0${CONTRACT}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

function rpcSession(secret, clientNonce, hostInstanceId) {
  return bridgeHmac(secret, 'rpc-session', clientNonce, hostInstanceId);
}

function projectIdForCwd(cwd) {
  let normalized = cwd.replace(/\\/g, '/');
  while (normalized.length > 1 && normalized.endsWith('/')
      && !/^[A-Za-z]:\/$/.test(normalized)) normalized = normalized.slice(0, -1);
  const digest = createHash('sha256')
    .update(`whaledock-project/v1\0${normalized}\0.`)
    .digest('hex');
  return `wdp1_${digest.slice(0, 32)}`;
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
  let controllerProof = controllerProofs.get(value.controllerId);
  if (!controllerProof) {
    controllerProof = (++registerNonceSequence).toString(16).padStart(64, '0');
    controllerProofs.set(value.controllerId, controllerProof);
  }
  return {
    selectionToken: SELECTION_TOKEN,
    registerNonce: (++registerNonceSequence).toString(16).padStart(32, '0'),
    issuedAtMs: Date.now(),
    controllerProof,
    ...value
  };
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
    const pluginClient = fs.readFileSync(path.join(
      sourceRoot, 'plugin', 'lib', 'client.js'
    ), 'utf8');
    const pluginHost = fs.readFileSync(path.join(
      sourceRoot, 'plugin', 'lib', 'index.js'
    ), 'utf8');
    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(layoutFork, /whaledock\.content-shell\/v1/);
    assert.match(layoutFork, /getWhaleDockShell/);
    assert.match(layoutFork, /ctx\.get\("whaledockContentShell"\)/);
    assert.doesNotMatch(layoutFork, /creatorProjects|stageCopy|whaledockShellPreferences|wd10-/,
      '上游 layout fork 只能保留窄 mount seam，不再持有鲸坞业务 UI');
    assert.match(pluginClient, /data-whaledock-layout/);
    assert.match(pluginClient, /function creatorProjects/);
    assert.match(pluginClient, /archivedSessionIds/);
    assert.doesNotMatch(pluginClient, /const STAGE_COPY = new Map/);
    const workspaceOperations = [
      'catalog.read', 'overview.read', 'document.read', 'topic.choose',
      'project.action.prepare', 'project.action.submit',
      'block.action.prepare', 'block.action.submit',
      'proposal.read', 'proposal.decide', 'proposal.undo',
      'publish.read', 'publish.create', 'publish.update',
      'review.tactics.read', 'review.solidify',
      'shoot.open', 'shoot.history.read',
      'receipts.read', 'receipts.ack', 'receipts.open'
    ];
    const operationSet = (source, name) => {
      const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
      assert(match, `${name} missing`);
      return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
    };
    const assertOperationSet = (actual, message) => {
      assert.equal(new Set(actual).size, actual.length, `${message}: duplicate`);
      assert.deepEqual([...actual].sort(), [...workspaceOperations].sort(), message);
    };
    assertOperationSet(operationSet(pluginClient, 'WORKSPACE_FILE_OPERATIONS'), 'Client operation set');
    assertOperationSet(operationSet(pluginHost, 'WORKSPACE_FILE_OPERATIONS'), 'Host operation set');
    assertOperationSet(operationSet(mainSource, 'CONTEXT_POC_WORKSPACE_FILE_OPERATIONS'),
      'Main/Host/Client 三处 operation exact set 必须同步');
    assert.match(pluginClient, /contentRef/);
    assert.match(pluginClient, /function ReviewPanel/);
    assert.match(pluginClient, /function ShootPanel/);
    assert.match(pluginClient, /const MAX_TACTIC_PAGES = 512;/,
      '打法分页必须覆盖 backend 最多 512 条且允许因响应体积每页少于 4 条');
    assert.match(pluginClient, /const MAX_SHOOT_HISTORY_PAGES = 128;/,
      '拍摄记录分页最多 128 页，每页固定上限 4 条');
    assert.match(pluginClient, /const MAX_BROWSER_PROMPTER_BYTES = 64 \* 1024;/,
      'browserOnly 手动提词文本必须有 64 KiB 硬上限');
    assert.match(pluginClient, /function provideBrowserOnlyContentShell/);
    assert.match(pluginClient,
      /页内简版只在当前页面滚动，不记录镜头完成状态，也不会写入拍摄记录。/);
    assert.match(pluginClient,
      /以下是 WhaleDock 标记的本地收工记录；不是视频、设备或平台数据回读。/);
    assert.match(pluginClient, /page\.addEventListener\('visibilitychange', pauseWhenHidden\)/,
      '页内简版必须在页面隐藏时暂停');
    assert.match(pluginClient, /打法只能由你从真实复盘显式固化。/);
    assert.match(pluginClient,
      /一期没有平台数据通道；以下都是本地文件，不显示播放量、评论聚类、使用次数或胜率。/);
    assert.match(pluginClient, /这一格还没做/);
    assert.match(pluginClient, /workspaces\.connectWorkspace\(workspaceId\)/);
    assert.match(pluginClient, /async fillDraft\(sessionId, text, workspaceId, signal\)/,
      '旧填草稿守门能力保留，但新 UI 不再展示或调用');
    assert.doesNotMatch(pluginClient, /填入右侧草稿/);
    assert.match(pluginClient, /whaledockContentShell/);
    const conversationFork = fs.readFileSync(path.join(
      sourceRoot, 'forks', 'ui-conversation', 'lib', 'client.js'
    ), 'utf8');
    assert.match(conversationFork, /whaledockContextGate/);
    assert.match(conversationFork, /鲸坞受管会话：工作台上下文未就绪，本次未发送/);
    assert.match(conversationFork, /if \(gate === void 0\)/);
    assert.match(conversationFork,
      /__WHALEDOCK_CONTEXT_MANAGED__ !== true && !fragmentManaged\) return this\.conversation\(\)\.sendSession/,
      '无 gate 且 marker/fragment 均未证明受管时必须保持原生发送');
    assert.match(conversationFork, /这是鲸坞受管页面：上下文闸门没有加载，本次未发送/,
      'marker 或合法 loopback fragment 证明受管时，缺 gate 必须 fail-closed');
  });

  await test('browserOnly 无 fragment/非 loopback 只注册官方 shell，零 gate 与零 RPC', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    const scenarios = [
      { isLoopback: true, hash: '' },
      { isLoopback: false,
        hash: `#whaledockController=controller-12345678&whaledockSelectionToken=${SELECTION_TOKEN}` }
    ];
    for (const scenario of scenarios) {
      let definition = null;
      let rpcCalls = 0;
      let disposed = false;
      let cleanup = null;
      const provided = [];
      const sandbox = {
        window: { __ModuleLoader__: { load(value) { definition = value; } } },
        location: { hash: scenario.hash, pathname: '/', search: '' },
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(source, sandbox, { filename: 'context-poc/browser-client.js' });
      const plugin = definition.factory(clientImport);
      const connection = {
        isLoopback: scenario.isLoopback,
        rpc: { call() { rpcCalls += 1; throw new Error('browserOnly must not call RPC'); } }
      };
      const sessions = {};
      plugin.apply({
        get(name) { return name === 'connection' ? connection : sessions; },
        reflect: {
          provide(name, value) {
            provided.push({ name, value });
            return () => { disposed = true; };
          }
        },
        effect(factory, label) {
          assert.equal(label, 'whaledock-context-bridge: browser-only content shell');
          cleanup = factory();
        }
      });
      assert.deepEqual(provided.map((item) => item.name), ['whaledockContentShell']);
      const shell = provided[0].value;
      assert.equal(shell.contract, 'whaledock.content-shell/v1');
      assert.equal(shell.browserOnly, true);
      assert.equal(shell.preferences, undefined);
      assert.equal(shell.workspaceFiles, undefined);
      assert.equal(shell.projectActions, null);
      assert.equal(rpcCalls, 0);
      assert.equal(Object.prototype.hasOwnProperty.call(
        sandbox, '__WHALEDOCK_CONTEXT_MANAGED__'
      ), false);
      assert.equal(typeof cleanup, 'function');
      cleanup();
      assert.equal(disposed, true);
    }
  });

  await test('Client 静态 bundle 上报选择，并串行保留偏好写入的最后意图', async () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8');
    let definition = null;
    const storage = new Map();
    const timers = new Map();
    let timerId = 0;
    const replacedUrls = [];
    let uuidSequence = 0;
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
      crypto: { randomUUID: () => (
        `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
      ) },
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
    const plugin = definition.factory(clientImport);
    assert.deepEqual(Array.from(plugin.inject), ['connection', 'sessions']);

    const calls = [];
    let current = 'raw-session-a';
    let sessionListener = null;
    let hostListener = null;
    let dispose = null;
    let gate = null;
    let gateDisposed = false;
    let preferences = null;
    let preferencesDisposed = false;
    let workspaceFiles = null;
    let workspaceFilesDisposed = false;
    let contentShell = null;
    let contentShellDisposed = false;
    let registerCalls = 0;
    let failPreferenceGet = false;
    let preferenceHostSnapshot = {
      revision: 1,
      contentViewMode: 'content',
      contentViewHintSeen: false
    };
    let preferenceWriteHandler = null;
    let workspaceRequestSeq = 0;
    let loseWorkspaceAdmissionReply = false;
    let workspaceStatusHandler = null;
    let workspaceRealm = (value) => value;
    const preferenceProtocolEvents = [];
    const connection = {
      isLoopback: true,
      rpc: {
        call: async (channel, endpoint, payload) => {
          calls.push({ channel, endpoint, payload });
          if (endpoint === 'selection/register' && ++registerCalls === 3) {
            return {
              ok: true,
              value: {
                state: 'ignored-stale',
                code: 'selection-revision-stale',
                selectionRevision: 5
              }
            };
          }
          if (endpoint === 'selection/register') {
            return { ok: true, value: {
              state: 'selected', code: null, selectionRevision: payload.selectionRevision
            } };
          }
          if (endpoint === 'ui/preferences/get') {
            if (failPreferenceGet) throw new Error('preference fixture unavailable');
            preferenceProtocolEvents.push(`get:${preferenceHostSnapshot.revision}`);
            return { ok: true, value: { snapshot: { ...preferenceHostSnapshot } } };
          }
          if (endpoint === 'ui/preferences/write') {
            preferenceProtocolEvents.push(`write:${payload.baseRevision}`);
            if (preferenceWriteHandler) return preferenceWriteHandler(payload);
            return { ok: true, value: {
              accepted: true,
              code: null,
              snapshot: {
                revision: 2,
                contentViewMode: 'sessions',
                contentViewHintSeen: false
              }
            } };
          }
          if (endpoint === 'workspace/files/request') {
            workspaceRequestSeq += 1;
            if (loseWorkspaceAdmissionReply) throw new Error('admission reply lost');
            return workspaceRealm({ ok: true, value: {
              accepted: true,
              requestToken: workspaceRequestSeq.toString(16).padStart(64, '0'),
              state: 'queued',
              code: null,
              deadlineMs: Date.now() + 10000
            } });
          }
          if (endpoint === 'workspace/files/status') {
            if (workspaceStatusHandler) return workspaceStatusHandler(payload);
            return workspaceRealm({ ok: true, value: {
              requestToken: payload.requestToken,
              state: 'queued',
              code: null,
              result: null
            } });
          }
          if (endpoint === 'workspace/files/cancel') {
            return workspaceRealm({ ok: true, value: {
              cancelled: true,
              code: 'cancelled',
              snapshot: {
                requestToken: payload.requestToken,
                state: 'cancelled',
                code: 'cancelled',
                result: null
              }
            } });
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
          if (name === 'whaledockContextGate') {
            gate = value;
            return () => { gateDisposed = true; };
          }
          if (name === 'whaledockShellPreferences') {
            preferences = value;
            return () => { preferencesDisposed = true; };
          }
          if (name === 'whaledockWorkspaceFiles') {
            workspaceFiles = value;
            return () => { workspaceFilesDisposed = true; };
          }
          assert.equal(name, 'whaledockContentShell');
          contentShell = value;
          return () => { contentShellDisposed = true; };
        }
      },
      effect: (factory) => { dispose = factory(); }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(Object.getOwnPropertyDescriptor(
      sandbox, '__WHALEDOCK_CONTEXT_MANAGED__'
    ), {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    }, 'Client 受管 marker 必须不可覆写、不可重定义且不可枚举');
    assert.deepEqual(replacedUrls, [{
      state: { native: true }, title: '', url: '/?native=preserved'
    }]);
    let selectionCalls = calls.filter((call) => call.endpoint === 'selection/register');
    assert.equal(selectionCalls.length, 1);
    assert.equal(selectionCalls[0].payload.currentSessionId, 'raw-session-a');
    assert.equal(selectionCalls[0].payload.selectionRevision, 1);
    assert.equal(selectionCalls[0].payload.managed, true);
    assert.equal(selectionCalls[0].payload.selectionToken, SELECTION_TOKEN);
    assert.match(selectionCalls[0].payload.registerNonce, /^[a-f0-9]{32}$/);
    assert.match(selectionCalls[0].payload.controllerProof, /^[a-f0-9]{64}$/);
    assert.equal(selectionCalls[0].payload.issuedAtMs <= Date.now(), true);
    assert.equal(
      storage.get('whaledock.context.controller-proof.controller-12345678'),
      selectionCalls[0].payload.controllerProof
    );
    assert.deepEqual(JSON.parse(JSON.stringify(preferences.getSnapshot())), {
      revision: 1,
      contentViewMode: 'content',
      contentViewHintSeen: false
    });

    current = 'raw-session-b';
    sessionListener();
    await Promise.resolve();
    selectionCalls = calls.filter((call) => call.endpoint === 'selection/register');
    assert.equal(selectionCalls[1].payload.selectionRevision, 2);
    assert.equal(selectionCalls[1].payload.currentSessionId, 'raw-session-b');
    hostListener();
    await new Promise((resolve) => setImmediate(resolve));
    selectionCalls = calls.filter((call) => call.endpoint === 'selection/register');
    assert.equal(selectionCalls[2].payload.selectionRevision, 2);
    assert.equal(selectionCalls[3].payload.selectionRevision, 6);
    assert.equal(storage.get('whaledock.context.selection.controller-12345678'), '6');
    let notified = null;
    const unsubscribePreference = preferences.subscribe((value) => { notified = value; });
    let settleFirstWrite = null;
    preferenceProtocolEvents.length = 0;
    preferenceWriteHandler = (payload) => {
      if (payload.baseRevision === 1) {
        return new Promise((resolve) => {
          settleFirstWrite = () => {
            preferenceHostSnapshot = {
              revision: 2,
              contentViewMode: 'sessions',
              contentViewHintSeen: false
            };
            resolve({ ok: true, value: {
              accepted: true, code: null, snapshot: { ...preferenceHostSnapshot }
            } });
          };
        });
      }
      assert.equal(payload.baseRevision, 2, '第二次点击必须读取第一次 settle 后的新 revision');
      preferenceHostSnapshot = {
        revision: 3,
        contentViewMode: 'content',
        contentViewHintSeen: false
      };
      return { ok: true, value: {
        accepted: true, code: null, snapshot: { ...preferenceHostSnapshot }
      } };
    };
    const firstPreferenceWrite = preferences.write({ contentViewMode: 'sessions' });
    const lastPreferenceWrite = preferences.write({ contentViewMode: 'content' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof settleFirstWrite, 'function');
    assert.equal(calls.filter((call) => call.endpoint === 'ui/preferences/write').length, 1,
      '第一次 settle 前第二次点击必须留在队列，不能并发使用旧 revision');
    const preferenceCall = calls.find((call) => call.endpoint === 'ui/preferences/write');
    assert.deepEqual(Object.keys(preferenceCall.payload).sort(), [
      'baseRevision', 'contract', 'controllerId', 'controllerProof', 'pageInstanceId',
      'patch', 'selectionRevision', 'selectionToken'
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(preferenceCall.payload, 'sessionRef'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(preferenceCall.payload, 'currentSessionId'), false);
    settleFirstWrite();
    assert.deepEqual(JSON.parse(JSON.stringify(await firstPreferenceWrite)), {
      ok: true, code: null
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await lastPreferenceWrite)), {
      ok: true, code: null
    });
    const preferenceCalls = calls.filter((call) => call.endpoint === 'ui/preferences/write');
    assert.deepEqual(preferenceCalls.map((call) => call.payload.baseRevision), [1, 2]);
    assert.deepEqual(preferenceProtocolEvents, ['get:1', 'write:1', 'get:2', 'write:2']);
    assert.equal(notified.contentViewMode, 'content');
    assert.deepEqual(JSON.parse(JSON.stringify(preferences.getSnapshot())), {
      revision: 3,
      contentViewMode: 'content',
      contentViewHintSeen: false
    }, '快速 A→B 最终必须保留最后一次点击 B');

    let rejectFailedWrite = null;
    let failureAttempts = 0;
    preferenceProtocolEvents.length = 0;
    preferenceWriteHandler = (payload) => {
      failureAttempts += 1;
      if (failureAttempts === 1) {
        return new Promise((_resolve, reject) => { rejectFailedWrite = reject; });
      }
      assert.equal(payload.baseRevision, 3, '前一次失败不得虚增 revision');
      preferenceHostSnapshot = {
        revision: 4,
        contentViewMode: 'sessions',
        contentViewHintSeen: false
      };
      return { ok: true, value: {
        accepted: true, code: null, snapshot: { ...preferenceHostSnapshot }
      } };
    };
    const failedPreferenceWrite = preferences.write({ contentViewHintSeen: true });
    const recoveredPreferenceWrite = preferences.write({ contentViewMode: 'sessions' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof rejectFailedWrite, 'function');
    assert.equal(failureAttempts, 1, '失败写入未结束前后继点击仍必须排队');
    rejectFailedWrite(new Error('deferred preference failure'));
    assert.deepEqual(JSON.parse(JSON.stringify(await failedPreferenceWrite)), {
      ok: false, code: 'preferences-unavailable'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await recoveredPreferenceWrite)), {
      ok: true, code: null
    }, '失败必须释放串行队列');
    assert.equal(failureAttempts, 2);
    assert.deepEqual(preferenceProtocolEvents, ['get:3', 'write:3', 'get:3', 'write:3']);
    assert.deepEqual(JSON.parse(JSON.stringify(preferences.getSnapshot())), {
      revision: 4,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    });
    assert.equal(JSON.stringify(preferences.getSnapshot()).includes(SELECTION_TOKEN), false);
    failPreferenceGet = true;
    assert.equal((await preferences.refresh()).ok, false);
    assert.equal(typeof gate.beforeSend, 'function', 'preferences 失败不能移除 context gate');
    unsubscribePreference();
    assert.equal(timers.size, 1);
    assert.equal(typeof gate.beforeSend, 'function');
    assert.equal(contentShell.contract, 'whaledock.content-shell/v1');
    assert.equal(typeof contentShell.Component, 'function');
    assert.equal(contentShell.preferences, preferences);
    assert.equal(contentShell.workspaceFiles, workspaceFiles);
    // 前半段历史 fixture 显式注入了外层 Object；文件协议会构造
    // 安全深拷贝，这里切回浏览器实际的同 realm Object/response。
    delete sandbox.Object;
    workspaceRealm = (value) => vm.runInNewContext(
      `(${JSON.stringify(value)})`, sandbox
    );
    const workspaceInput = (source) => vm.runInNewContext(`(${source})`, sandbox);
    const beforeInvalidWorkspaceCall = calls.length;
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.request(
      'catalog.read', workspaceInput("{ cwd: '/private/forbidden' }")
    ))), {
      accepted: false, requestToken: null, state: 'rejected',
      code: 'operation-invalid', deadlineMs: null
    });
    assert.equal(calls.length, beforeInvalidWorkspaceCall,
      'Client 禁止键必须在本地拒绝，不得进入 RPC');
    assert.equal((await workspaceFiles.request(
      'catalog.read', workspaceInput("{ Absolute_Path: '/private/forbidden' }")
    )).code, 'operation-invalid', '禁止键大小写/分隔符变体也须本地拒绝');
    const queued = await workspaceFiles.request('catalog.read', workspaceInput('{}'));
    assert.equal(queued.accepted, true, JSON.stringify({ queued, calls: calls.slice(-3) }));
    const workspaceRequestCall = calls.find((call) => (
      call.endpoint === 'workspace/files/request'
    ));
    assert.deepEqual(Object.keys(workspaceRequestCall.payload).sort(), [
      'contract', 'controllerId', 'controllerProof', 'input', 'operation',
      'pageInstanceId', 'selectionRevision', 'selectionToken'
    ]);
    assert.equal(JSON.stringify(workspaceRequestCall.payload).includes('raw-session-b'), false);
    loseWorkspaceAdmissionReply = true;
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.request(
      'catalog.read', workspaceInput('{}')
    ))), {
      accepted: false, requestToken: null, state: 'rejected',
      code: 'outcome-unknown', deadlineMs: null
    }, 'Host 可能已入队但响应丢失时不得伪报确定未执行');
    loseWorkspaceAdmissionReply = false;
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.status(
      queued.requestToken
    ))), {
      requestToken: queued.requestToken, state: 'queued', code: null, result: null
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await workspaceFiles.cancel(
      queued.requestToken
    ))), {
      cancelled: true,
      code: 'cancelled',
      snapshot: {
        requestToken: queued.requestToken,
        state: 'cancelled',
        code: 'cancelled',
        result: null
      }
    });
    workspaceStatusHandler = (payload) => workspaceRealm({ ok: true, value: {
      requestToken: payload.requestToken,
      state: 'fulfilled',
      code: null,
      result: { projects: [{ projectToken: 'project-safe', title: '可见项目' }] }
    } });
    const executed = await workspaceFiles.execute('catalog.read', workspaceInput('{}'));
    assert.deepEqual(JSON.parse(JSON.stringify(executed)), {
      requestToken: '3'.padStart(64, '0'),
      state: 'fulfilled',
      code: null,
      result: { projects: [{ projectToken: 'project-safe', title: '可见项目' }] }
    });
    workspaceStatusHandler = (payload) => workspaceRealm({ ok: true, value: {
      requestToken: payload.requestToken,
      state: 'fulfilled',
      code: null,
      result: { cwd: '/private/leak' }
    } });
    assert.equal(await workspaceFiles.status(executed.requestToken), null,
      'Client 不得接纳 Host 回包中的工作区绝对路径');
    dispose();
    assert.equal(timers.size, 0);
    assert.equal(gateDisposed, true);
    assert.equal(preferencesDisposed, true);
    assert.equal(workspaceFilesDisposed, true);
    assert.equal(contentShellDisposed, true);
  });

  await test('Client revision 0 以 50/100/200/400/800ms 有界快速重试并立即采用 rev1', async () => {
    const clientSource = fs.readFileSync(
      path.join(sourceRoot, 'plugin', 'lib', 'client.js'), 'utf8'
    );
    assert.match(clientSource,
      /PREFERENCE_BOOTSTRAP_RETRY_MS = Object\.freeze\(\[50, 100, 200, 400, 800\]\)/);
    assert.match(clientSource,
      /preferenceBootstrapRetryIndex >= PREFERENCE_BOOTSTRAP_RETRY_MS\.length/,
      '启动重试必须在固定数组末尾停止');

    const createFixture = async () => {
      let definition = null;
      let uuidSequence = 0;
      let timerId = 0;
      let dispose = null;
      let preferences = null;
      const timeouts = new Map();
      const timeoutDelays = [];
      const intervals = new Map();
      const getRevisions = [];
      const host = {
        snapshot: {
          revision: 0,
          contentViewMode: 'content',
          contentViewHintSeen: false
        }
      };
      const storage = new Map();
      const sandbox = {
        window: { __ModuleLoader__: { load(value) { definition = value; } } },
        location: {
          hash: `#whaledockController=controller-bootstrap1&whaledockSelectionToken=${SELECTION_TOKEN}`,
          pathname: '/',
          search: ''
        },
        history: { state: null, replaceState() {} },
        crypto: { randomUUID: () => (
          `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
        ) },
        sessionStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value))
        },
        setTimeout(fn, delay) {
          const id = ++timerId;
          timeoutDelays.push(delay);
          timeouts.set(id, { fn, delay });
          return id;
        },
        clearTimeout(id) { timeouts.delete(id); },
        setInterval(fn, delay) {
          const id = ++timerId;
          intervals.set(id, { fn, delay });
          return id;
        },
        clearInterval(id) { intervals.delete(id); },
        URLSearchParams,
        AbortController,
        Date,
        Symbol,
        Object,
        Number,
        Promise
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(clientSource, sandbox, { filename: 'context-poc/bootstrap-client.js' });
      const plugin = definition.factory(clientImport);
      const connection = {
        isLoopback: true,
        rpc: {
          async call(_channel, endpoint) {
            if (endpoint === 'selection/register') {
              return { ok: true, value: {
                state: 'selected', code: null, selectionRevision: 1
              } };
            }
            assert.equal(endpoint, 'ui/preferences/get');
            getRevisions.push(host.snapshot.revision);
            return { ok: true, value: { snapshot: { ...host.snapshot } } };
          }
        },
        hostDescription: { subscribe() { return () => {}; } }
      };
      const sessions = {
        list: {
          getSnapshot: () => ({ phase: 'ready', current: 'raw-session-bootstrap' }),
          subscribe() { return () => {}; }
        }
      };
      plugin.apply({
        get: (name) => (name === 'connection' ? connection : sessions),
        reflect: {
          provide(name, value) {
            if (name === 'whaledockShellPreferences') preferences = value;
            return () => {};
          }
        },
        effect(factory) { dispose = factory(); }
      });
      const flush = async () => {
        await Promise.resolve();
        await new Promise((resolve) => setImmediate(resolve));
      };
      await flush();
      return {
        host,
        preferences,
        timeouts,
        timeoutDelays,
        intervals,
        getRevisions,
        dispose,
        async runNext(delay) {
          const next = timeouts.entries().next().value;
          assert.ok(next, `缺少 ${delay}ms 启动重试`);
          const [id, timer] = next;
          assert.equal(timer.delay, delay);
          timeouts.delete(id);
          timer.fn();
          await flush();
        }
      };
    };

    const adopting = await createFixture();
    assert.deepEqual(adopting.getRevisions, [0]);
    assert.deepEqual([...adopting.intervals.values()].map((item) => item.delay), [5000],
      '正常 heartbeat 仍保持 5s');
    for (const delay of [50, 100, 200, 400]) await adopting.runNext(delay);
    adopting.host.snapshot = {
      revision: 1,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    };
    await adopting.runNext(800);
    assert.deepEqual(adopting.timeoutDelays, [50, 100, 200, 400, 800]);
    assert.deepEqual(adopting.getRevisions, [0, 0, 0, 0, 0, 1]);
    assert.deepEqual(JSON.parse(JSON.stringify(adopting.preferences.getSnapshot())), {
      revision: 1,
      contentViewMode: 'sessions',
      contentViewHintSeen: false
    }, 'main sync rev1 后必须在 5s heartbeat 前采用 sessions');
    assert.equal(adopting.timeouts.size, 0, 'rev>=1 必须立即停止快速重试');
    adopting.dispose();
    assert.equal(adopting.intervals.size, 0);

    const bounded = await createFixture();
    for (const delay of [50, 100, 200, 400, 800]) await bounded.runNext(delay);
    assert.deepEqual(bounded.timeoutDelays, [50, 100, 200, 400, 800]);
    assert.equal(bounded.timeouts.size, 0, 'rev0 也不得进入无限轮询');
    assert.deepEqual(bounded.getRevisions, [0, 0, 0, 0, 0, 0]);
    bounded.dispose();
    assert.equal(bounded.intervals.size, 0);
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

    await test('register nonce/时效/接管 proof fail-closed，公共回包不含 sessionRef', async () => {
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
        const base = selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-proof0001',
          pageInstanceId: 'page-proof00000001',
          selectionRevision: 1,
          currentSessionId: 'proof-raw-session',
          managed: true
        });
        const first = await rpcHandler('selection/register', base);
        assert.equal(first.value.state, 'selected');
        assert.equal(Object.prototype.hasOwnProperty.call(first.value, 'sessionRef'), false);
        assert.equal(JSON.stringify(first).includes('proof-raw-session'), false);
        assert.equal((await rpcHandler('selection/register', base)).ok, false, 'nonce 不可重放');

        const forged = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: base.controllerId,
          pageInstanceId: 'page-proof00000002',
          selectionRevision: 2,
          currentSessionId: 'proof-raw-session',
          managed: true,
          controllerProof: 'ff'.repeat(32)
        }));
        assert.equal(forged.ok, false, '错误 proof 不得用高 revision 接管');
        const takeover = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: base.controllerId,
          pageInstanceId: 'page-proof00000002',
          selectionRevision: 2,
          currentSessionId: 'proof-raw-session',
          managed: true
        }));
        assert.equal(takeover.value.state, 'selected');
        assert.equal(Object.prototype.hasOwnProperty.call(takeover.value, 'sessionRef'), false);

        const expired = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-proof-old1',
          pageInstanceId: 'page-proof-old0001',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          issuedAtMs: now - 10001
        }));
        const future = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-proof-new1',
          pageInstanceId: 'page-proof-new0001',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          issuedAtMs: now + 1001
        }));
        assert.equal(expired.ok, false);
        assert.equal(future.ok, false);
      } finally {
        Date.now = originalNow;
      }
    });

    await test('无效鉴权不耗限速，endpoint 桶互相隔离且零 token 不可命中 padding', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const originalNow = Date.now;
      const now = originalNow();
      Date.now = () => now;
      try {
        assert.equal((await rpcHandler('selection/resolve', {
          contract: CONTRACT,
          controllerId: 'controller-ratelimit1',
          authToken: '00'.repeat(32)
        })).ok, false);
        for (let index = 0; index < 24; index += 1) {
          assert.equal((await rpcHandler(
            'handshake', handshakeRequest(index.toString(16).padStart(64, '0'), 'ef'.repeat(32))
          )).ok, false);
        }
        const clientNonce = '07'.repeat(32);
        const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
        assert.equal(hello.ok, true, '无效 handshake 不得耗掉 16/s 桶');
        const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
        await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-ratelimit1',
          pageInstanceId: 'page-ratelimit0001',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false
        }));
        for (let index = 0; index < 80; index += 1) {
          assert.equal((await rpcHandler('selection/resolve', {
            contract: CONTRACT,
            controllerId: 'controller-ratelimit1',
            authToken: 'ef'.repeat(32)
          })).ok, false);
        }
        assert.equal((await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId: 'controller-ratelimit1', authToken
        })).ok, true, '无效 auth 不得耗掉 resolve 桶');
        for (let index = 0; index < 64; index += 1) {
          assert.equal((await rpcHandler('events/read', {
            contract: CONTRACT,
            hostInstanceId: hello.value.hostInstanceId,
            afterEventSeq: 0,
            authToken
          })).ok, true);
        }
        assert.equal((await rpcHandler('events/read', {
          contract: CONTRACT,
          hostInstanceId: hello.value.hostInstanceId,
          afterEventSeq: 0,
          authToken
        })).ok, false);
        assert.equal((await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId: 'controller-ratelimit1', authToken
        })).ok, true, 'events 桶耗尽不得拖累 resolve');
      } finally {
        Date.now = originalNow;
      }
    });

    await test('UI preferences 双向协议严格认证、settle 后生效且 3 秒超时有界', async () => {
      let rpcHandler = null;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '09'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      assert.equal(hello.value.capabilities.includes('ui-preferences-v1'), true);
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
      const registration = selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-preference1',
        pageInstanceId: 'page-preference00001',
        selectionRevision: 1,
        currentSessionId: null,
        managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).ok, true);
      const pageAuth = {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: registration.selectionRevision,
        selectionToken: registration.selectionToken,
        controllerProof: registration.controllerProof
      };
      const initial = {
        revision: 1,
        contentViewMode: 'content',
        contentViewHintSeen: false
      };
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT,
        snapshot: initial,
        authToken: '00'.repeat(32)
      })).ok, false);
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT,
        snapshot: initial,
        authToken
      })).value.accepted, true);
      const firstGet = await rpcHandler('ui/preferences/get', pageAuth);
      assert.deepEqual(firstGet.value.snapshot, initial);
      assert.equal((await rpcHandler('ui/preferences/get', {
        ...pageAuth,
        selectionToken: '00'.repeat(32)
      })).ok, false);
      assert.equal((await rpcHandler('ui/preferences/get', {
        ...pageAuth,
        controllerProof: 'ff'.repeat(32)
      })).ok, false);

      const writePromise = rpcHandler('ui/preferences/write', {
        ...pageAuth,
        baseRevision: 1,
        patch: { contentViewMode: 'sessions' }
      });
      assert.deepEqual((await rpcHandler('ui/preferences/get', pageAuth)).value.snapshot, initial,
        'write 只进入独立偏好队列，settle 前不得改 Host snapshot');
      assert.equal((await rpcHandler('ui/preferences/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        authToken: '00'.repeat(32)
      })).ok, false, '独立偏好读取只接受 main-auth');
      const requestPage = await rpcHandler('ui/preferences/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        authToken
      });
      assert.deepEqual(Object.keys(requestPage.value).sort(), [
        'contract', 'hostInstanceId', 'requests'
      ]);
      assert.equal(requestPage.value.requests.length, 1);
      const request = requestPage.value.requests[0];
      assert.deepEqual(request.patch, { contentViewMode: 'sessions' });
      assert.match(request.requestToken, /^[a-f0-9]{64}$/);
      assert.equal(Number.isSafeInteger(request.issuedAtMs), true);
      assert.equal(request.deadlineMs - request.issuedAtMs, 3000);
      const serialized = JSON.stringify(request);
      assert.equal(serialized.includes(SELECTION_TOKEN), false);
      assert.equal(serialized.includes(registration.controllerProof), false);
      assert.equal(serialized.includes('sessionRef'), false);
      assert.equal(serialized.includes('eventSeq'), false);
      const untouchedCore = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(untouchedCore.value.events, []);
      assert.equal(untouchedCore.value.throughEventSeq, 0,
        '偏好请求绝不能占用 core journal 序号');
      assert.equal((await rpcHandler('ui/preferences/settle', {
        contract: CONTRACT,
        requestToken: request.requestToken,
        status: 'applied',
        code: null,
        snapshot: {
          revision: 2,
          contentViewMode: 'sessions',
          contentViewHintSeen: false
        },
        authToken: '00'.repeat(32)
      })).ok, false);
      const settled = await rpcHandler('ui/preferences/settle', {
        contract: CONTRACT,
        requestToken: request.requestToken,
        status: 'applied',
        code: null,
        snapshot: {
          revision: 2,
          contentViewMode: 'sessions',
          contentViewHintSeen: false
        },
        authToken
      });
      assert.deepEqual(settled.value, { settled: true });
      const written = await writePromise;
      assert.equal(written.value.accepted, true);
      assert.equal(written.value.snapshot.revision, 2);

      const originalSetTimeout = global.setTimeout;
      const originalDateNow = Date.now;
      let expire = null;
      try {
        global.setTimeout = (callback, delay) => {
          assert.equal(Number.isSafeInteger(delay) && delay >= 0 && delay <= 3000, true,
            'Host timer 不能越过事件绝对 deadline');
          expire = callback;
          return { unref() {} };
        };
        const timeoutPromise = rpcHandler('ui/preferences/write', {
          ...pageAuth,
          baseRevision: 2,
          patch: { contentViewHintSeen: true }
        });
        assert.equal(typeof expire, 'function');
        const timeoutRequestPage = await rpcHandler('ui/preferences/read', {
          contract: CONTRACT,
          hostInstanceId: hello.value.hostInstanceId,
          authToken
        });
        const timeoutRequest = timeoutRequestPage.value.requests[0];
        assert.equal(timeoutRequest.deadlineMs - timeoutRequest.issuedAtMs, 3000);
        global.setTimeout = originalSetTimeout;
        Date.now = () => timeoutRequest.deadlineMs;
        assert.equal((await rpcHandler('ui/preferences/settle', {
          contract: CONTRACT,
          requestToken: timeoutRequest.requestToken,
          status: 'rejected',
          code: 'preferences-timeout',
          snapshot: {
            revision: 2,
            contentViewMode: 'sessions',
            contentViewHintSeen: false
          },
          authToken
        })).ok, false, '绝对 deadline 到点后即使 timer 尚未回调也不得接纳 settle');
        Date.now = originalDateNow;
        const timedOut = await timeoutPromise;
        assert.equal(timedOut.value.accepted, false);
        assert.equal(timedOut.value.code, 'preferences-timeout');
        expire();
      } finally {
        global.setTimeout = originalSetTimeout;
        Date.now = originalDateNow;
      }
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT,
        snapshot: { ...initial, revision: 1_000_000_001 },
        authToken
      })).ok, false);
      assert.equal((await rpcHandler('ui/preferences/write', {
        ...pageAuth,
        baseRevision: 2,
        patch: { contentViewMode: 'invalid' }
      })).ok, false);
    });

    await test('workspace/files 同项目闭环不泄露路径，mismatch/cancel/越权全部 fail-closed', async () => {
      let rpcHandler = null;
      const workspaceCwd = '/Users/fixture/WhaleDock-Content';
      const otherCwd = '/Users/fixture/Other-Project';
      const rawSessionId = 'workspace-file-raw-session';
      let currentCwd = workspaceCwd;
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        sessions: {
          get(id) {
            return id === rawSessionId ? { header: { cwd: currentCwd } } : null;
          }
        },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '0b'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      assert.equal(hello.ok, true);
      assert.equal(hello.value.capabilities.includes('workspace-files-v1'), true);
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const registration = selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-workspace1',
        pageInstanceId: 'page-workspace000001',
        selectionRevision: 1,
        currentSessionId: rawSessionId,
        managed: true
      });
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'selected');
      const resolved = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        authToken
      });
      assert.match(resolved.value.sessionRef, /^session-[a-f0-9]{64}$/);
      const stage = await rpcHandler('context/stage', {
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-workspace01',
          hostInstanceId,
          sessionRef: resolved.value.sessionRef,
          revision: 1,
          project: {
            projectId: projectIdForCwd(workspaceCwd),
            relativePath: '.',
            workbenchId: 'builtin:video',
            title: '内容工作区',
            projectRevision: null
          }
        },
        authToken
      });
      assert.equal(stage.value.state, 'effective');
      const pageAuth = {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: 1,
        selectionToken: registration.selectionToken,
        controllerProof: registration.controllerProof
      };
      const coreBefore = await rpcHandler('events/read', {
        contract: CONTRACT, hostInstanceId, afterEventSeq: 0, authToken
      });
      const baselineEventSeq = coreBefore.value.throughEventSeq;

      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: {},
        unexpected: true
      })).ok, false, '未知字段不得被忽略');
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        controllerProof: 'ff'.repeat(32),
        operation: 'catalog.read',
        input: {}
      })).ok, false, '伪造页面 proof 不得入队');
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'document.read',
        input: { absolutePath: '/private/forbidden.md' }
      })).ok, false, '路径键不得穿过 Host 边界');
      for (const input of [
        { Absolute_Path: '/private/forbidden.md' },
        { Front_Matter: { status: 'done' } },
        { Hash: 'ab'.repeat(32) }
      ]) {
        assert.equal((await rpcHandler('workspace/files/request', {
          ...pageAuth, operation: 'catalog.read', input
        })).ok, false, '禁止键的大小写/分隔符变体也不得穿过 Host 边界');
      }
      assert.equal((await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'document.read',
        input: {
          chunkA: 'a'.repeat(1500),
          chunkB: 'b'.repeat(1500),
          chunkC: 'c'.repeat(1500)
        }
      })).ok, false, '超过 4KiB 的输入不得入队');

      const queued = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: { cursor: 0 }
      });
      assert.deepEqual(Object.keys(queued.value).sort(), [
        'accepted', 'code', 'deadlineMs', 'requestToken', 'state'
      ]);
      assert.equal(queued.value.accepted, true);
      assert.match(queued.value.requestToken, /^[a-f0-9]{64}$/);
      assert.equal(queued.value.deadlineMs > Date.now(), true);

      assert.equal((await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 4, authToken: '00'.repeat(32)
      })).ok, false, '伪造 main auth 不得读取队列');
      const read = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 4, authToken
      });
      assert.equal(read.value.requests.length, 1);
      const request = read.value.requests[0];
      assert.equal(request.requestToken, queued.value.requestToken);
      assert.equal(request.projectId, projectIdForCwd(workspaceCwd));
      assert.equal(request.contextRevision, 1);
      assert.equal(request.operation, 'catalog.read');
      assert.deepEqual(request.input, { cursor: 0 });
      const requestText = JSON.stringify(request);
      for (const forbidden of [
        workspaceCwd, rawSessionId, resolved.value.sessionRef,
        registration.selectionToken, registration.controllerProof,
        'absolutePath', 'relativePath', 'cwd', 'claimToken'
      ]) assert.equal(requestText.includes(forbidden), false, `main 请求泄露: ${forbidden}`);

      assert.equal((await rpcHandler('workspace/files/claim', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        authToken: '00'.repeat(32)
      })).ok, false);
      const claimed = await rpcHandler('workspace/files/claim', {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        authToken
      });
      assert.equal(claimed.value.claimed, true);
      assert.match(claimed.value.claimToken, /^[a-f0-9]{64}$/);
      assert.equal(claimed.value.runningDeadlineMs <= request.deadlineMs, true,
        'claim 不能重置页面看到的绝对 deadline');
      const runningCancel = await rpcHandler('workspace/files/cancel', {
        ...pageAuth,
        requestToken: request.requestToken
      });
      assert.equal(runningCancel.value.cancelled, false);
      assert.equal(runningCancel.value.code, 'already-running');

      const settleBase = {
        contract: CONTRACT,
        hostInstanceId,
        requestToken: request.requestToken,
        requestSeq: request.requestSeq,
        claimToken: claimed.value.claimToken,
        status: 'fulfilled',
        code: null,
        authToken
      };
      assert.equal((await rpcHandler('workspace/files/settle', {
        ...settleBase,
        result: { absolutePath: '/private/forbidden.md' }
      })).ok, false, '结果中的绝对路径必须拒绝');
      assert.equal((await rpcHandler('workspace/files/settle', {
        ...settleBase,
        result: {
          chunkA: 'a'.repeat(2048),
          chunkB: 'b'.repeat(2048),
          chunkC: 'c'.repeat(2048)
        }
      })).ok, false, '超过 6KiB 的结果必须拒绝');
      assert.deepEqual((await rpcHandler('workspace/files/settle', {
        ...settleBase,
        result: {
          projects: [{ projectToken: 'project-safe', title: '可见项目' }],
          count: 1
        }
      })).value, { settled: true, code: null });
      const fulfilled = await rpcHandler('workspace/files/status', {
        ...pageAuth,
        requestToken: request.requestToken
      });
      assert.deepEqual(fulfilled.value, {
        requestToken: request.requestToken,
        state: 'fulfilled',
        code: null,
        result: {
          projects: [{ projectToken: 'project-safe', title: '可见项目' }],
          count: 1
        }
      });
      assert.equal(JSON.stringify(fulfilled).includes(claimed.value.claimToken), false);
      assert.equal((await rpcHandler('workspace/files/status', {
        ...pageAuth,
        pageInstanceId: 'page-workspace-forged',
        requestToken: request.requestToken
      })).ok, false, '其他页不得读取结果');

      const cancelQueued = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'document.read',
        input: { projectToken: 'project-safe' }
      });
      const cancelled = await rpcHandler('workspace/files/cancel', {
        ...pageAuth,
        requestToken: cancelQueued.value.requestToken
      });
      assert.equal(cancelled.value.cancelled, true);
      assert.equal(cancelled.value.snapshot.state, 'cancelled');

      currentCwd = otherCwd;
      const mismatch = await rpcHandler('workspace/files/request', {
        ...pageAuth,
        operation: 'catalog.read',
        input: {}
      });
      assert.deepEqual(mismatch.value, {
        accepted: false,
        requestToken: null,
        state: 'rejected',
        code: 'workspace-mismatch',
        deadlineMs: null
      });
      const afterMismatch = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 4, authToken
      });
      assert.deepEqual(afterMismatch.value.requests, [],
        '工作区 mismatch 必须零入队');
      const coreAfter = await rpcHandler('events/read', {
        contract: CONTRACT, hostInstanceId, afterEventSeq: 0, authToken
      });
      assert.equal(coreAfter.value.throughEventSeq, baselineEventSeq,
        'workspace/files 不得占用 core journal 序号');
    });

    await test('workspace/files 在 A→B→A 后不可读取、取消或 claim 旧 selection 请求', async () => {
      let rpcHandler = null;
      const rawA = 'workspace-selection-raw-a';
      const rawB = 'workspace-selection-raw-b';
      const cwdA = '/Users/fixture/Workspace-A';
      const cwdB = '/Users/fixture/Workspace-B';
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        sessions: {
          get(id) {
            if (id === rawA) return { header: { cwd: cwdA } };
            if (id === rawB) return { header: { cwd: cwdB } };
            return null;
          }
        },
        systemPrompt: { context() {} },
        on() {}
      });
      const clientNonce = '1b'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const hostInstanceId = hello.value.hostInstanceId;
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hostInstanceId);
      const controllerId = 'controller-file-aba1';
      const pageInstanceId = 'page-file-aba000001';
      const select = async (raw, selectionRevision) => {
        const registration = selectionRequest({
          contract: CONTRACT, controllerId, pageInstanceId, selectionRevision,
          currentSessionId: raw, managed: true
        });
        const registered = await rpcHandler('selection/register', registration);
        assert.equal(registered.value.state, 'selected');
        const resolved = await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId, authToken
        });
        return { registration, sessionRef: resolved.value.sessionRef };
      };
      const selectedA = await select(rawA, 1);
      const stageA = await rpcHandler('context/stage', {
        controllerId, pageInstanceId, selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-file-aba001', hostInstanceId,
          sessionRef: selectedA.sessionRef, revision: 1,
          project: {
            projectId: projectIdForCwd(cwdA), relativePath: '.',
            workbenchId: 'builtin:video', title: 'A', projectRevision: null
          }
        },
        authToken
      });
      assert.equal(stageA.value.state, 'effective');
      const authFor = (selectionRevision) => ({
        contract: CONTRACT, controllerId, pageInstanceId, selectionRevision,
        selectionToken: selectedA.registration.selectionToken,
        controllerProof: selectedA.registration.controllerProof
      });
      const contextStale = await rpcHandler('workspace/files/request', {
        ...authFor(1), operation: 'catalog.read', input: {}
      });
      const firstRead = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 1, authToken
      });
      const contextStaleRequest = firstRead.value.requests[0];
      assert.equal(contextStaleRequest.requestToken, contextStale.value.requestToken);
      const stageA2 = await rpcHandler('context/stage', {
        controllerId, pageInstanceId, selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-file-aba001', hostInstanceId,
          sessionRef: selectedA.sessionRef, revision: 2,
          project: {
            projectId: projectIdForCwd(cwdA), relativePath: '.',
            workbenchId: 'builtin:video', title: 'A2', projectRevision: 'a'.repeat(64)
          }
        },
        authToken
      });
      assert.equal(stageA2.value.state, 'effective');
      assert.deepEqual((await rpcHandler('workspace/files/claim', {
        contract: CONTRACT, hostInstanceId,
        requestToken: contextStaleRequest.requestToken,
        requestSeq: contextStaleRequest.requestSeq, authToken
      })).value, { claimed: false, code: 'operation-stale' },
      '同 selection 下 context revision 更新也必须淘汰旧请求');
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(1), requestToken: contextStaleRequest.requestToken
      })).ok, false, '新 context 不得读取旧 context token');

      const queued = await rpcHandler('workspace/files/request', {
        ...authFor(1), operation: 'catalog.read', input: {}
      });
      const read = await rpcHandler('workspace/files/read', {
        contract: CONTRACT, hostInstanceId, limit: 1, authToken
      });
      const oldRequest = read.value.requests[0];
      assert.equal(oldRequest.requestToken, queued.value.requestToken);

      await select(rawB, 2);
      const staleClaim = await rpcHandler('workspace/files/claim', {
        contract: CONTRACT, hostInstanceId,
        requestToken: oldRequest.requestToken, requestSeq: oldRequest.requestSeq, authToken
      });
      assert.deepEqual(staleClaim.value, { claimed: false, code: 'operation-stale' });
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(1), requestToken: oldRequest.requestToken
      })).ok, false, '旧 revision 不得读旧 token');
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(2), requestToken: oldRequest.requestToken
      })).ok, false, '新 session 不得继承旧 token');

      await select(rawA, 3);
      assert.equal((await rpcHandler('workspace/files/status', {
        ...authFor(3), requestToken: oldRequest.requestToken
      })).ok, false, 'A 返回后也不得复活旧 token');
      assert.equal((await rpcHandler('workspace/files/cancel', {
        ...authFor(3), requestToken: oldRequest.requestToken
      })).ok, false, 'A 返回后也不得取消旧 token');
    });

    await test('513 次偏好尝试不占 core journal，后续 ACK→turn→delivery→end 连续可回放', async () => {
      let rpcHandler = null;
      let contextProvider = null;
      const listeners = new Map();
      hostPlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context(provider) { contextProvider = provider; } },
        on(name, handler, options) { listeners.set(name, { handler, options }); }
      });
      const clientNonce = '0a'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
      const selectionValue = {
        contract: CONTRACT,
        controllerId: 'controller-pref-flood1',
        pageInstanceId: 'page-pref-flood00001',
        selectionRevision: 1,
        currentSessionId: 'preference-flood-raw',
        managed: true
      };
      let registration = selectionRequest(selectionValue);
      assert.equal((await rpcHandler('selection/register', registration)).value.state, 'selected');
      const pageAuth = {
        contract: CONTRACT,
        controllerId: registration.controllerId,
        pageInstanceId: registration.pageInstanceId,
        selectionRevision: registration.selectionRevision,
        selectionToken: registration.selectionToken,
        controllerProof: registration.controllerProof
      };
      const initial = {
        revision: 1,
        contentViewMode: 'content',
        contentViewHintSeen: false
      };
      assert.equal((await rpcHandler('ui/preferences/sync', {
        contract: CONTRACT, snapshot: initial, authToken
      })).value.accepted, true);

      const originalNow = Date.now;
      let now = originalNow();
      const attempts = [];
      Date.now = () => now;
      try {
        for (let index = 0; index < 513; index += 1) {
          if (index > 0 && index % 10 === 0) {
            registration = selectionRequest(selectionValue);
            assert.equal((await rpcHandler('selection/register', registration)).value.state,
              'selected', '偏好洪泛夹具必须保持页面 lease 有效');
          }
          attempts.push(rpcHandler('ui/preferences/write', {
            ...pageAuth,
            baseRevision: 1,
            patch: { contentViewHintSeen: index % 2 === 0 }
          }));
          now += 1001;
        }
        now += 3000;
        const empty = await rpcHandler('ui/preferences/read', {
          contract: CONTRACT,
          hostInstanceId: hello.value.hostInstanceId,
          authToken
        });
        assert.deepEqual(empty.value.requests, []);
        const outcomes = await Promise.all(attempts);
        assert.equal(outcomes.length, 513);
        assert.equal(outcomes.every((outcome) => outcome.ok === true
          && outcome.value.accepted === false
          && outcome.value.code === 'preferences-timeout'), true);
      } finally {
        Date.now = originalNow;
      }

      const resolved = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: selectionValue.controllerId,
        authToken
      });
      const envelope = {
        contract: CONTRACT,
        clientInstanceId: 'client-pref-flood01',
        hostInstanceId: hello.value.hostInstanceId,
        sessionRef: resolved.value.sessionRef,
        revision: 1,
        project: {
          projectId: `wdp1_${'7'.repeat(32)}`,
          relativePath: '.',
          workbenchId: 'builtin:video',
          title: '偏好隔离回归',
          projectRevision: null
        }
      };
      assert.equal((await rpcHandler('context/stage', {
        controllerId: selectionValue.controllerId,
        pageInstanceId: selectionValue.pageInstanceId,
        selectionRevision: 1,
        envelope,
        authToken
      })).value.state, 'effective');
      const sessionEvent = listeners.get('session/event').handler;
      sessionEvent({ id: selectionValue.currentSessionId }, {
        type: 'turn/start', data: { turn: 1 }
      });
      const contextText = contextProvider.text({
        agent: { id: selectionValue.currentSessionId }
      });
      const message = {
        id: 'message-pref-flood1',
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
        provider: 'fixture', model: 'fixture',
        sessionId: selectionValue.currentSessionId, messages: [message]
      });
      assert.equal(listeners.get('llm/stream').handler(options, () => 'stream'), 'stream');
      sessionEvent({ id: selectionValue.currentSessionId }, {
        type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }
      });
      const core = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.equal(core.value.resyncRequired, false);
      assert.equal(core.value.oldestEventSeq, 1);
      assert.equal(core.value.throughEventSeq, 4);
      assert.deepEqual(core.value.events.map((event) => event.type), [
        'ack', 'turn-start', 'delivery', 'turn-end'
      ]);
      assert.deepEqual(core.value.events.map((event) => event.eventSeq), [1, 2, 3, 4]);
    });

    await test('超大事件被丢弃时 eventSeq 不留永久空洞', async () => {
      const oversizeRoot = path.join(nodeModules, '@whaledock', 'context-bridge-oversize');
      fs.cpSync(path.join(sourceRoot, 'plugin'), oversizeRoot, { recursive: true });
      const oversizeEntry = path.join(oversizeRoot, 'lib', 'index.js');
      const originalSource = fs.readFileSync(oversizeEntry, 'utf8');
      const boundedSource = originalSource.replace(
        'const MAX_EVENT_BYTES = 2048;', 'const MAX_EVENT_BYTES = 400;'
      );
      assert.notEqual(boundedSource, originalSource);
      fs.writeFileSync(oversizeEntry, boundedSource);
      const oversizePlugin = await import(
        `${pathToFileURL(oversizeEntry).href}?oversize=${Date.now()}`
      );
      let rpcHandler = null;
      const listeners = new Map();
      oversizePlugin.apply({
        connection: { rpc: { handle(_channel, handler) { rpcHandler = handler; } } },
        systemPrompt: { context() {} },
        on(name, handler) { listeners.set(name, handler); }
      });
      const clientNonce = '08'.repeat(32);
      const hello = await rpcHandler('handshake', handshakeRequest(clientNonce));
      const authToken = rpcSession(BRIDGE_TOKEN, clientNonce, hello.value.hostInstanceId);
      await rpcHandler('selection/register', selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-oversize01',
        pageInstanceId: 'page-oversize000001',
        selectionRevision: 1,
        currentSessionId: 'oversize-raw-session',
        managed: true
      }));
      const resolved = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-oversize01',
        authToken
      });
      const staged = await rpcHandler('context/stage', {
        controllerId: 'controller-oversize01',
        pageInstanceId: 'page-oversize000001',
        selectionRevision: 1,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: `client-${'b'.repeat(121)}`,
          hostInstanceId: hello.value.hostInstanceId,
          sessionRef: resolved.value.sessionRef,
          revision: 1,
          project: {
            projectId: `wdp1_${'8'.repeat(32)}`,
            relativePath: '.',
            workbenchId: 'builtin:video',
            title: '事件连号',
            projectRevision: null
          }
        },
        authToken
      });
      assert.equal(staged.value.state, 'effective');
      assert.equal(staged.value.eventSeq, 0, '超限 ACK 不得消耗序号');
      listeners.get('session/event')(
        { id: 'oversize-raw-session' }, { type: 'turn/start', data: { turn: 1 } }
      );
      const events = await rpcHandler('events/read', {
        contract: CONTRACT,
        hostInstanceId: hello.value.hostInstanceId,
        afterEventSeq: 0,
        authToken
      });
      assert.deepEqual(events.value.events.map((event) => event.eventSeq), [1]);
      assert.deepEqual(events.value.events.map((event) => event.type), ['turn-start']);
    });

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

      const selection = await rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-12345678',
        pageInstanceId: 'page-123456789012',
        selectionRevision: 1,
        currentSessionId: 'raw-session-a',
        managed: true,
        selectionToken: SELECTION_TOKEN
      }));
      assert.equal(selection.ok, true);
      assert.equal(selection.value.state, 'selected');
      assert.equal(Object.prototype.hasOwnProperty.call(selection.value, 'sessionRef'), false);
      assert.equal(JSON.stringify(selection).includes('raw-session-a'), false);
      const resolved = await rpcHandler('selection/resolve', {
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-12345678',
        authToken
      });
      const sessionRef = resolved.value.sessionRef;
      assert.match(sessionRef, /^session-[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(resolved).includes('raw-session-a'), false);
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
      const register = (controllerId, managed) => rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId,
        pageInstanceId: `page-${controllerId.slice(-8)}`,
        selectionRevision: 1,
        currentSessionId: 'same-raw-session',
        managed,
        selectionToken: SELECTION_TOKEN
      }));
      const first = await register('controller-11111111', true);
      assert.equal(first.value.state, 'selected');
      assert.equal(Object.prototype.hasOwnProperty.call(first.value, 'sessionRef'), false);
      const owned = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-11111111',
        authToken
      });
      const ownedSessionRef = owned.value.sessionRef;
      assert.match(ownedSessionRef, /^session-[a-f0-9]{64}$/);
      const duplicatePage = () => rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-11111111',
        pageInstanceId: 'page-second1111',
        selectionRevision: 1,
        currentSessionId: 'same-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      }));
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
          sessionRef: ownedSessionRef,
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
      const wrongSelection = await rpcHandler('selection/register', selectionRequest({
        contract: CONTRACT,
        controllerId: 'controller-unauth001',
        pageInstanceId: 'page-unauth000001',
        selectionRevision: 1,
        currentSessionId: null,
        managed: false,
        selectionToken: 'ef'.repeat(32)
      }));
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
        rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'controller-two-pages',
          pageInstanceId,
          selectionRevision,
          currentSessionId: 'two-pages-raw',
          managed: true,
          selectionToken: SELECTION_TOKEN
        }))
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
      const selected = await rpcHandler('selection/register', selectionRequest({
        contract: 'whaledock.context-bridge/v1',
        controllerId: 'controller-duplicate1',
        pageInstanceId: 'page-duplicate0001',
        selectionRevision: 1,
        currentSessionId: 'duplicate-raw-session',
        managed: true,
        selectionToken: SELECTION_TOKEN
      }));
      assert.equal(Object.prototype.hasOwnProperty.call(selected.value, 'sessionRef'), false);
      const selectedPrivate = await rpcHandler('selection/resolve', {
        contract: CONTRACT,
        controllerId: 'controller-duplicate1',
        authToken
      });
      const envelope = {
        contract: 'whaledock.context-bridge/v1',
        clientInstanceId: 'client-duplicate01',
        hostInstanceId: hello.value.hostInstanceId,
        sessionRef: selectedPrivate.value.sessionRef,
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
      const select = async (raw, revision) => {
        const reply = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId,
          pageInstanceId,
          selectionRevision: revision,
          currentSessionId: raw,
          managed: true,
          selectionToken: SELECTION_TOKEN
        }));
        const resolved = await rpcHandler('selection/resolve', {
          contract: CONTRACT, controllerId, authToken
        });
        return { reply, sessionRef: resolved.value.sessionRef };
      };
      const stage = (selection, revision, title, digit) => rpcHandler('context/stage', {
        controllerId,
        pageInstanceId,
        selectionRevision: revision,
        envelope: {
          contract: CONTRACT,
          clientInstanceId: 'client-abaswitch1',
          hostInstanceId: hello.value.hostInstanceId,
          sessionRef: selection.sessionRef,
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
      assert.notEqual(secondA.sessionRef, firstA.sessionRef);
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
          const reply = await rpcHandler('selection/register', selectionRequest({
            contract: CONTRACT,
            controllerId: `observer-capacity-${String(index).padStart(3, '0')}`,
            pageInstanceId: `page-capacity-${String(index).padStart(3, '0')}`,
            selectionRevision: 1,
            currentSessionId: null,
            managed: false,
            selectionToken: SELECTION_TOKEN
          }));
          assert.notEqual(reply.value.code, 'controller-capacity');
        }
        const full = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'observer-capacity-overflow',
          pageInstanceId: 'page-capacity-overflow',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          selectionToken: SELECTION_TOKEN
        }));
        assert.equal(full.value.code, 'controller-capacity');
        now += 16000;
        const recovered = await rpcHandler('selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId: 'observer-capacity-reused',
          pageInstanceId: 'page-capacity-reused',
          selectionRevision: 1,
          currentSessionId: null,
          managed: false,
          selectionToken: SELECTION_TOKEN
        }));
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
        const register = (controllerId, pageInstanceId) => rpcHandler(
          'selection/register', selectionRequest({
          contract: CONTRACT,
          controllerId,
          pageInstanceId,
          selectionRevision: 1,
          currentSessionId: 'lease-recovery-raw',
          managed: true,
            selectionToken: SELECTION_TOKEN
          })
        );
        const owner = await register('controller-leaseowner', 'page-leaseowner01');
        assert.equal(Object.prototype.hasOwnProperty.call(owner.value, 'sessionRef'), false);
        const ownerPrivate = await rpcHandler('selection/resolve', {
          contract: CONTRACT,
          controllerId: 'controller-leaseowner',
          authToken
        });
        await rpcHandler('context/stage', {
          controllerId: 'controller-leaseowner',
          pageInstanceId: 'page-leaseowner01',
          selectionRevision: 1,
          envelope: {
            contract: CONTRACT,
            clientInstanceId: 'client-leaseowner1',
            hostInstanceId: hello.value.hostInstanceId,
            sessionRef: ownerPrivate.value.sessionRef,
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
      const register = async (pageInstanceId, selectionRevision) => {
        const response = await rpcHandler('selection/register', selectionRequest({
          contract: 'whaledock.context-bridge/v1',
          controllerId: 'controller-refresh1',
          pageInstanceId,
          selectionRevision,
          currentSessionId: 'refresh-raw-session',
          managed: true,
          selectionToken: SELECTION_TOKEN
        }));
        const resolved = await rpcHandler('selection/resolve', {
          contract: CONTRACT,
          controllerId: 'controller-refresh1',
          authToken
        });
        return { response, sessionRef: resolved.value.sessionRef };
      };
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
      await stage(first.response.value, 'page-refresh0001', 1,
        envelope(first.sessionRef, 'client-refresh01', 'A'));
      const sessionEvent = listeners.get('session/event');
      sessionEvent({ id: 'refresh-raw-session' }, { type: 'turn/start', data: { turn: 1 } });
      assert.match(contextProvider.text({ agent: { id: 'refresh-raw-session' } }), /"title":"A"/);

      const second = await register('page-refresh0002', 2);
      assert.equal(second.response.value.state, 'selected');
      assert.notEqual(second.sessionRef, first.sessionRef);
      await stage(second.response.value, 'page-refresh0002', 2,
        envelope(second.sessionRef, 'client-refresh02', 'B'));
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
