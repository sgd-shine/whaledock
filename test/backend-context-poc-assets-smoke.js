'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const backend = require('../lib/backend');
const config = require('../lib/config');

let passed = 0;
const CONTEXT_BRIDGE_PROTOCOL = 'whaledock.context-bridge/v1';

function bridgeHmac(secret, label, clientNonce, hostInstanceId) {
  return crypto.createHmac('sha256', secret)
    .update(`${label}\0${CONTEXT_BRIDGE_PROTOCOL}\0${clientNonce}\0${hostInstanceId}`)
    .digest('hex');
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  backend-context-poc-assets: ${name}`);
  } catch (error) {
    console.error(`FAIL  backend-context-poc-assets: ${name}`);
    throw error;
  }
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 42420;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

function runtimeFixture(root, enabled = true) {
  const resourcesPath = path.join(root, 'resources');
  const runtimeRoot = path.join(resourcesPath, 'dsh-runtime');
  const entry = path.join(
    runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'
  );
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '// fixture');
  fs.writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify({
    dshVersion: config.DSH_CONTRACT.packageVersion
  }));
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(userDataPath, { recursive: true });
  return {
    execPath: path.join(root, 'WhaleDock'),
    resourcesPath,
    userDataPath,
    contextPocAssetRoot: path.join(__dirname, '..', 'context-poc'),
    contextPocEnabled: enabled
  };
}

function bundledPlan() {
  return backend.buildBundledCommandPlan(
    '/Applications/WhaleDock.app/Contents/MacOS/WhaleDock',
    '/Applications/WhaleDock.app/Contents/Resources/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    config.DSH_CONTRACT.packageVersion,
    3080
  );
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-context-poc-assets-'));
  try {
    const info = runtimeFixture(tmp);

    await test('planner 只放行 flag + managed bundled + 精确根包证明', async () => {
      assert.deepEqual(backend.contextPocPlan(bundledPlan(), { ...info, contextPocEnabled: false }), {
        eligible: false,
        reason: 'disabled'
      });
      for (const command of [
        { ...bundledPlan(), bundled: false },
        { ...bundledPlan(), packageVersionProof: '0.1.0-rc.6' },
        { ...bundledPlan(), packageVersionProof: null }
      ]) {
        assert.deepEqual(backend.contextPocPlan(command, info), {
          eligible: false,
          reason: 'bridge-unavailable'
        });
      }
      const plan = backend.contextPocPlan(bundledPlan(), info);
      assert.equal(plan.eligible, true);
      assert.equal(plan.sourceRoot, path.resolve(info.contextPocAssetRoot));
      assert.equal(plan.userDataPath, path.resolve(info.userDataPath));
      assert.equal(Object.isFrozen(plan), true);

      const winPlan = backend.contextPocPlan(bundledPlan(), {
        ...info,
        contextPocAssetRoot: 'C:\\WhaleDock\\resources\\context-poc',
        userDataPath: 'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock'
      }, { platform: 'win32', pathModule: path.win32 });
      assert.equal(winPlan.eligible, true);
      assert.equal(winPlan.sourceRoot, 'C:\\WhaleDock\\resources\\context-poc');
      assert.equal(winPlan.userDataPath,
        'C:\\Users\\fixture\\AppData\\Roaming\\WhaleDock');
    });

    await test('每次启动使用新隔离 home，静态资产逐文件回读', async () => {
      const plan = backend.contextPocPlan(bundledPlan(), info);
      const first = backend.prepareContextPocAssets(plan);
      const second = backend.prepareContextPocAssets(plan);
      assert.equal(first.mounted, true);
      assert.equal(first.assetDigest, second.assetDigest);
      assert.notEqual(first.homePath, second.homePath);
      assert.notEqual(first.mountRoot, second.mountRoot);
      assert.notEqual(first.authToken, second.authToken);
      assert.notEqual(first.selectionToken, second.selectionToken);
      assert.match(first.authToken, /^[a-f0-9]{64}$/);
      assert.match(first.selectionToken, /^[a-f0-9]{64}$/);
      assert.equal(fs.statSync(first.patchPath).isFile(), true);
      const packageRoot = path.join(
        first.homePath, 'profiles', 'web', 'node_modules',
        '@whaledock', 'context-bridge-poc'
      );
      assert.equal(fs.statSync(path.join(packageRoot, 'package.json')).isFile(), true);
      assert.equal(fs.statSync(path.join(packageRoot, 'lib', 'index.js')).isFile(), true);
      assert.equal(fs.statSync(path.join(packageRoot, 'lib', 'client.js')).isFile(), true);
      assert.equal(first.homePath.startsWith(path.resolve(info.userDataPath) + path.sep), true);
      assert.equal(first.homePath.includes(`${path.sep}.dsh${path.sep}`), false);
    });

    await test('命令只在 web 后插 patch，并大小写无关覆盖隔离环境', async () => {
      const prepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info),
        { randomBytes: (size) => Buffer.alloc(size, 0xab) }
      );
      const decorated = backend.applyContextPocCommand({
        ...bundledPlan(),
        env: { ELECTRON_RUN_AS_NODE: '1', dsh_home: '/untrusted', Dsh_Home: '/old' }
      }, prepared);
      const web = decorated.args.indexOf('web');
      assert.deepEqual(decorated.args.slice(web, web + 5), [
        'web', '--patch', prepared.patchPath, '--port', '3080'
      ]);
      assert.equal(decorated.env.DSH_HOME, prepared.homePath);
      assert.equal(decorated.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN, 'ab'.repeat(32));
      assert.equal(decorated.env.WHALEDOCK_CONTEXT_SELECTION_TOKEN, 'ab'.repeat(32));
      assert.equal(decorated.contextBridgePort, 3080);
      assert.equal(Object.keys(decorated.env).filter((key) => key.toUpperCase() === 'DSH_HOME').length, 1);
      for (const args of [
        ['web', '--patch', '/already', '--port', '3080'],
        ['web', 'web', '--port', '3080'],
        ['web', '--port', '3080', '--port', '3081'],
        ['--port', '3080'],
        ['web', '--port'],
        ['web', '--port', '65536'],
        ['web', '--port', 'not-a-port'],
        ['web', '--port', '0x0c08'],
        ['web', '--port', ' 3080 ']
      ]) {
        assert.throws(() => backend.applyContextPocCommand({
          ...bundledPlan(), args
        }, prepared));
      }
    });

    await test('源/目标篡改与 symlink 都 fail-closed 且不覆盖', async () => {
      const sourceCopy = path.join(tmp, 'source-copy');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), sourceCopy, { recursive: true });
      fs.writeFileSync(path.join(sourceCopy, 'unknown.txt'), 'reject');
      const badSourceInfo = { ...info, contextPocAssetRoot: sourceCopy };
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), badSourceInfo)
      ), /unknown entries/);

      const symlinkSource = path.join(tmp, 'source-symlink');
      fs.cpSync(path.join(__dirname, '..', 'context-poc'), symlinkSource, { recursive: true });
      const client = path.join(symlinkSource, 'plugin', 'lib', 'client.js');
      fs.rmSync(client);
      fs.symlinkSync(path.join(__dirname, '..', 'context-poc', 'plugin', 'lib', 'client.js'), client);
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), { ...info, contextPocAssetRoot: symlinkSource })
      ), /bounded regular file/);

      const prepared = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info)
      );
      const targetClient = path.join(
        prepared.homePath, 'profiles', 'web', 'node_modules', '@whaledock',
        'context-bridge-poc', 'lib', 'client.js'
      );
      fs.appendFileSync(targetClient, '\n// tampered');
      fs.writeFileSync(path.join(prepared.homePath, 'profiles', 'web', 'cordis.patch.yml'), 'poison');
      const fresh = backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info)
      );
      assert.notEqual(fresh.mountRoot, prepared.mountRoot);
      assert.equal(fs.existsSync(path.join(
        fresh.homePath, 'profiles', 'web', 'cordis.patch.yml'
      )), false, '上一次 runtime 生成或篡改的 profile 文件不得复用');
      assert.doesNotMatch(fs.readFileSync(path.join(
        fresh.homePath, 'profiles', 'web', 'node_modules', '@whaledock',
        'context-bridge-poc', 'lib', 'client.js'
      ), 'utf8'), /tampered/);

      let verifyCalls = 0;
      let promotedRoot = null;
      assert.throws(() => backend.prepareContextPocAssets(
        backend.contextPocPlan(bundledPlan(), info),
        {
          verifyContextPocTarget(root) {
            verifyCalls += 1;
            if (verifyCalls === 2) {
              promotedRoot = root;
              throw new Error('post-rename verification fixture');
            }
            return true;
          }
        }
      ), /post-rename verification fixture/);
      assert.equal(verifyCalls, 2);
      assert.equal(fs.existsSync(promotedRoot), false,
        'rename 后二次回读失败也必须凭 state-held owner 回收本次 mount');
    });

    await test('start 对非 bundled 零准备，合格 bundled 失败也完整回退', async () => {
      let prepareCalls = 0;
      const customSpawn = [];
      const custom = backend.start({
        command: 'fixture command', port: 3080, workdir: info.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: info,
        prepareContextPocAssets() { prepareCalls += 1; throw new Error('must not run'); },
        spawn(file, args, options) {
          customSpawn.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(prepareCalls, 0);
      assert.equal(custom.contextBridgeMounted, false);
      assert.equal(customSpawn[0].options.env.DSH_HOME, undefined);

      const bundledSpawn = [];
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: info.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin', dsh_home: '/must-survive-fallback' },
        pathValue: '/usr/bin', runtimeInfo: info,
        prepareContextPocAssets() { prepareCalls += 1; throw new Error('fixture failure'); },
        spawn(file, args, options) {
          bundledSpawn.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(prepareCalls, 1);
      assert.equal(state.contextBridgeMounted, false);
      assert.equal(state.contextBridgeReason, 'bridge-unavailable');
      assert.equal(bundledSpawn[0].args.includes('--patch'), false);
      assert.equal(bundledSpawn[0].options.env.dsh_home, '/must-survive-fallback');
      assert.equal(bundledSpawn[0].options.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN, undefined);
    });

    await test('每次受管 child 退出后只清理自己的隔离 mount', async () => {
      const fallbackIsolated = runtimeFixture(path.join(tmp, 'cleanup-fallback'));
      let rejectedMount = null;
      const fallbackState = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: fallbackIsolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: fallbackIsolated,
        prepareContextPocAssets(plan, runtime) {
          const prepared = backend.prepareContextPocAssets(plan, runtime);
          rejectedMount = prepared.mountRoot;
          return { ...prepared, selectionToken: 'invalid' };
        },
        spawn() { return fakeChild(); }
      });
      assert.equal(fallbackState.contextBridgeMounted, false);
      assert.equal(fs.existsSync(rejectedMount), false,
        'prepare 成功但命令装饰拒绝时也必须回收 mount');

      const isolated = runtimeFixture(path.join(tmp, 'cleanup-start'));
      let child = null;
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' }, pathValue: '/usr/bin',
        runtimeInfo: isolated,
        spawn() {
          child = fakeChild();
          return child;
        }
      });
      const mountRoot = state.contextBridgeMountRoot;
      assert.equal(fs.statSync(mountRoot).isDirectory(), true);
      child.emit('exit', 0, null);
      assert.equal(state.exited, true);
      assert.equal(fs.existsSync(mountRoot), false);
      assert.equal(backend.cleanupContextPocMount(
        isolated.userDataPath,
        path.dirname(isolated.userDataPath),
        '00'.repeat(32),
        { platform: process.platform }
      ), false, '宽目标必须拒绝清理');
      assert.equal(fs.statSync(isolated.userDataPath).isDirectory(), true);

      const forgedParent = path.join(tmp, 'forged-parent');
      const forgedOwner = 'ef'.repeat(32);
      const forgedDigest = 'cd'.repeat(32);
      const forgedRoot = path.join(
        forgedParent, `run-${forgedDigest.slice(0, 16)}-${forgedOwner.slice(0, 16)}`
      );
      fs.mkdirSync(forgedRoot, { recursive: true });
      fs.writeFileSync(path.join(forgedRoot, '.whaledock-context-poc.json'), JSON.stringify({
        schema: 1,
        digest: forgedDigest,
        package: '@whaledock/context-bridge-poc',
        ownerToken: forgedOwner
      }));
      assert.equal(backend.cleanupContextPocMount(
        forgedRoot, forgedParent, 'ab'.repeat(32), { platform: process.platform }
      ), false, 'marker 自报 owner 与 state-held owner 不符时不得删除');
      assert.equal(fs.statSync(forgedRoot).isDirectory(), true);
    });

    await test('首包用 nonce 请求 MAC，验 PoP 后才派生 session token', async () => {
      const spawned = [];
      const isolated = runtimeFixture(path.join(tmp, 'eligible-start'));
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin', Dsh_Home: '/old' },
        pathValue: '/usr/bin', runtimeInfo: isolated,
        spawn(file, args, options) {
          spawned.push({ file, args, options });
          return fakeChild();
        }
      });
      assert.equal(state.contextBridgeMounted, true);
      assert.equal(spawned[0].args.includes('--patch'), true);
      assert.equal(Object.keys(spawned[0].options.env)
        .filter((key) => key.toUpperCase() === 'DSH_HOME').length, 1);
      assert.equal(JSON.stringify(state).includes('contextBridgeAuthToken'), false);
      assert.equal(JSON.stringify(state).includes(isolated.userDataPath), false);
      assert.equal(Object.keys(state).includes('contextBridgePort'), false);
      assert.equal(Object.keys(state).includes('contextBridgeSpawnChild'), false);
      assert.equal(Object.keys(state).includes('contextBridgeSelectionToken'), false);

      const secret = spawned[0].options.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
      const hostInstanceId = 'host-12345678';
      const requestBodies = [];
      let swapDuringReply = false;
      const request = (options, callback) => {
        assert.equal(options.hostname, '127.0.0.1');
        assert.equal(options.port, 3080);
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = (body) => {
          const requestBody = JSON.parse(body);
          requestBodies.push(requestBody);
          const response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          let value;
          if (requestBody.method === 'handshake') {
            assert.equal(Object.prototype.hasOwnProperty.call(
              requestBody.payload, 'authToken'
            ), false);
            assert.match(requestBody.payload.clientNonce, /^[a-f0-9]{64}$/);
            assert.equal(requestBody.payload.requestProof, bridgeHmac(
              secret, 'handshake-request', requestBody.payload.clientNonce, ''
            ));
            value = {
              ok: true,
              type: 'handshake',
              protocol: CONTEXT_BRIDGE_PROTOCOL,
              contract: CONTEXT_BRIDGE_PROTOCOL,
              hostInstanceId,
              capabilities: ['selection-authority'],
              clientNonce: requestBody.payload.clientNonce,
              proof: bridgeHmac(
                secret, 'handshake-proof', requestBody.payload.clientNonce, hostInstanceId
              )
            };
          } else {
            if (swapDuringReply) state.child = fakeChild();
            value = {
              state: 'none', hostInstanceId, sessionRef: null, code: null
            };
          }
          response.end(JSON.stringify({
            type: 'server-response',
            rpcId: requestBody.rpcId,
            result: { ok: true, value }
          }));
        };
        return req;
      };
      const transport = backend.createContextBridgeTransport(state, {
        request,
        randomBytes: (size) => Buffer.alloc(size, 0x11)
      });
      const input = Object.freeze({
        type: 'handshake', protocol: CONTEXT_BRIDGE_PROTOCOL
      });
      const reply = await transport(input);
      assert.deepEqual(reply, {
        ok: true,
        type: 'handshake',
        protocol: CONTEXT_BRIDGE_PROTOCOL,
        contract: CONTEXT_BRIDGE_PROTOCOL,
        hostInstanceId,
        capabilities: ['selection-authority']
      });
      const handshakeBody = requestBodies[0];
      assert.equal(handshakeBody.method, 'handshake');
      assert.deepEqual(Object.keys(handshakeBody.payload).sort(), [
        'clientNonce', 'protocol', 'requestProof', 'type'
      ]);
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'authToken'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'clientNonce'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'proof'), false);
      assert.equal(typeof transport.call, 'function');

      const resolved = await transport.call('selection/resolve', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        controllerId: 'controller-12345678'
      });
      assert.deepEqual(resolved, {
        state: 'none', hostInstanceId, sessionRef: null, code: null
      });
      const sessionBody = requestBodies[1];
      const expectedSessionToken = bridgeHmac(
        secret, 'rpc-session', handshakeBody.payload.clientNonce, hostInstanceId
      );
      assert.equal(sessionBody.payload.authToken, expectedSessionToken);
      assert.notEqual(sessionBody.payload.authToken, secret);

      await assert.rejects(() => transport.call('unknown', {}));
      await assert.rejects(() => transport.call('context/stage', {
        text: 'x'.repeat(backend.CONTEXT_POC_LIMITS.maxRequestBytes)
      }), /too large/);

      let refusedRequests = 0;
      const refusedRequest = () => {
        refusedRequests += 1;
        throw new Error('must not request');
      };
      const wrongPort = backend.createContextBridgeTransport(state, {
        port: 3081, request: refusedRequest
      });
      await assert.rejects(() => wrongPort(input), /unavailable/);
      assert.equal(refusedRequests, 0);

      const requestCount = requestBodies.length;
      state.exited = true;
      await assert.rejects(() => transport.call('selection/resolve', {}), /unavailable/);
      state.exited = false;
      assert.equal(requestBodies.length, requestCount);

      const spawnedChild = state.child;
      state.child = fakeChild();
      await assert.rejects(() => transport.call('selection/resolve', {}), /unavailable/);
      state.child = spawnedChild;
      assert.equal(requestBodies.length, requestCount);

      swapDuringReply = true;
      await assert.rejects(() => transport.call('selection/resolve', {
        contract: CONTEXT_BRIDGE_PROTOCOL,
        controllerId: 'controller-12345678'
      }), /unavailable/);
      state.child = spawnedChild;
      swapDuringReply = false;

      let badHandshakeBody = null;
      const badProofRequest = (_options, callback) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = (body) => {
          badHandshakeBody = JSON.parse(body);
          const response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          response.end(JSON.stringify({
            type: 'server-response',
            rpcId: badHandshakeBody.rpcId,
            result: { ok: true, value: {
              ok: true,
              type: 'handshake',
              protocol: CONTEXT_BRIDGE_PROTOCOL,
              contract: CONTEXT_BRIDGE_PROTOCOL,
              hostInstanceId,
              capabilities: [],
              clientNonce: badHandshakeBody.payload.clientNonce,
              proof: '00'.repeat(32)
            } }
          }));
        };
        return req;
      };
      const badProof = backend.createContextBridgeTransport(state, {
        request: badProofRequest,
        randomBytes: (size) => Buffer.alloc(size, 0x22)
      });
      await assert.rejects(() => badProof(input), /proof invalid/);
      assert.equal(Object.prototype.hasOwnProperty.call(
        badHandshakeBody.payload, 'authToken'
      ), false);
      await assert.rejects(() => badProof.call('selection/resolve', {}), /unavailable/);
    });

    await test('持续回流量也不能续期 RPC 的绝对总 deadline', async () => {
      const spawned = [];
      const isolated = runtimeFixture(path.join(tmp, 'deadline-start'));
      const state = backend.start({
        preferBundled: true,
        dshVersion: config.DSH_CONTRACT.packageVersion,
        port: 3080,
        workdir: isolated.userDataPath
      }, {}, {
        platform: process.platform, env: { PATH: '/usr/bin' },
        pathValue: '/usr/bin', runtimeInfo: isolated,
        spawn(file, args, options) {
          spawned.push({ file, args, options });
          return fakeChild();
        }
      });
      const secret = spawned[0].options.env.WHALEDOCK_CONTEXT_BRIDGE_TOKEN;
      const hostInstanceId = 'host-deadline1';
      let slowChunks = 0;
      let cleanupSlowResponse = () => {};
      const request = (_options, callback) => {
        const req = new EventEmitter();
        let response = null;
        let interval = null;
        req.destroy = () => {
          if (interval !== null) clearInterval(interval);
          interval = null;
          if (response && !response.destroyed) response.destroy();
        };
        req.end = (body) => {
          const requestBody = JSON.parse(body);
          response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          if (requestBody.method === 'handshake') {
            const clientNonce = requestBody.payload.clientNonce;
            response.end(JSON.stringify({
              type: 'server-response',
              rpcId: requestBody.rpcId,
              result: { ok: true, value: {
                ok: true,
                type: 'handshake',
                protocol: CONTEXT_BRIDGE_PROTOCOL,
                contract: CONTEXT_BRIDGE_PROTOCOL,
                hostInstanceId,
                capabilities: [],
                clientNonce,
                proof: bridgeHmac(
                  secret, 'handshake-proof', clientNonce, hostInstanceId
                )
              } }
            }));
            return;
          }
          interval = setInterval(() => {
            slowChunks += 1;
            response.write(' ');
          }, 3);
          cleanupSlowResponse = req.destroy;
        };
        return req;
      };
      const transport = backend.createContextBridgeTransport(state, {
        request,
        timeoutMs: 45,
        randomBytes: (size) => Buffer.alloc(size, 0x33)
      });
      await transport({ type: 'handshake', protocol: CONTEXT_BRIDGE_PROTOCOL });

      const startedAt = Date.now();
      let watchdog = null;
      try {
        await assert.rejects(Promise.race([
          transport.call('events/read', {
            contract: CONTEXT_BRIDGE_PROTOCOL,
            hostInstanceId,
            afterEventSeq: 0
          }),
          new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('deadline test watchdog')), 750);
          })
        ]), /context bridge RPC timeout/);
      } finally {
        if (watchdog !== null) clearTimeout(watchdog);
        cleanupSlowResponse();
      }
      const elapsedMs = Date.now() - startedAt;
      assert.equal(slowChunks >= 2, true);
      assert.equal(elapsedMs < 500, true);
    });

    console.log(`\nBACKEND CONTEXT POC ASSETS ALL PASS (${passed})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
