'use strict';

// v0.4 dsh prompt adapter 合约测试；全程 fake fetch，不启动 dsh、不发真实 prompt。
const assert = require('assert/strict');
const backend = require('../lib/backend');
const config = require('../lib/config');

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

function serverResponse(request, value, options = {}) {
  return response({
    type: options.type || 'server-response',
    rpcId: options.rpcId || request.rpcId,
    result: options.result || { ok: true, value }
  }, options.response || {});
}

function fixtureFetch(requests, behavior = {}) {
  return async (url, init) => {
    const request = JSON.parse(init.body);
    requests.push({ url: String(url), init, request });
    if (request.method === 'host.describe') {
      return serverResponse(request, behavior.describe || {
        version: '0.0.1', cwd: '/private/workspace',
        attachedSessions: 3, canOpenPath: true,
        provider: 'private-provider', model: 'private-model'
      });
    }
    if (request.method === 'session.list') {
      const listed = typeof behavior.list === 'function'
        ? behavior.list(request, url, init)
        : (behavior.list || { items: [{
        sessionId: 'raw-session-root', updatedAt: 3000,
        running: true, blank: false, cwd: '/private/workspace',
        agentPreset: 'private-preset', projections: { asOfSeq: 9, values: { title: 'secret' } }
      }, {
        sessionId: 'raw-session-blank', updatedAt: 2000, running: false, blank: true
      }, {
        sessionId: 'raw-session-subagent', parentSessionId: 'raw-session-root',
        origin: 'subagent', updatedAt: 1900, running: true, blank: false
      }, {
        sessionId: 'raw-session-fork', parentSessionId: 'raw-session-root',
        updatedAt: 1800, running: false, blank: false
      }] });
      return serverResponse(request, listed);
    }
    if (request.method === 'session.prompt') {
      if (typeof behavior.prompt === 'function') return behavior.prompt(request, url, init);
      if (behavior.promptResult) return serverResponse(request, null, { result: behavior.promptResult });
      return serverResponse(request, { accepted: true }, {
        response: { url: 'http://127.0.0.1:4319/api/session.prompt' }
      });
    }
    throw new Error(`unexpected method ${request.method}`);
  };
}

function adapterOptions(fetch, overrides = {}) {
  let rpc = 0;
  let target = 0;
  return {
    port: 4319,
    expectedHostVersion: config.DSH_CONTRACT.hostVersion,
    packageVersionProof: config.DSH_CONTRACT.packageVersion,
    fetch,
    mintRpcId: () => `rpc-${++rpc}`,
    mintTargetToken: () => `target-${++target}`,
    ...overrides
  };
}

const DELIVERY_TARGET_SECRET = 'ab'.repeat(32);
const DELIVERY_TARGET_HOST = 'host-delivery-target01';

async function main() {
  await test('根包 proof 默认锁 rc.6，候选只接受显式精确 SemVer 与字节级等值', async () => {
    assert.equal(backend.hasExactDshPackageProof({
      packageVersionProof: config.DSH_CONTRACT.packageVersion
    }), true);
    assert.equal(backend.hasExactDshPackageProof({
      expectedPackageVersion: '0.1.1-rc.2',
      packageVersionProof: '0.1.1-rc.2'
    }), true);
    for (const proof of [null, 'latest', 'system:/usr/local/bin/dsh', '0.1.0-rc.6']) {
      assert.equal(backend.hasExactDshPackageProof({
        expectedPackageVersion: '0.1.1-rc.2',
        packageVersionProof: proof
      }), false, String(proof));
    }
    assert.equal(backend.hasExactDshPackageProof({
      expectedPackageVersion: '0.1.1-rc.2+probe',
      packageVersionProof: '0.1.1-rc.2'
    }), false);
    for (const expectedPackageVersion of [
      '', 'latest', 'v0.1.1-rc.2', ' 0.1.1-rc.2', '0.1.1-rc.02', '0.1.1-'
    ]) {
      assert.throws(() => backend.hasExactDshPackageProof({
        expectedPackageVersion,
        packageVersionProof: expectedPackageVersion
      }), (error) => error.code === 'ERR_DSH_PACKAGE_CONTRACT');
    }
  });

  await test('根包版本无法证明时 detect/list 零请求且自动写入不可用', async () => {
    let fetchCalls = 0;
    const adapter = backend.createDshPromptAdapter(adapterOptions(async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    }, { packageVersionProof: null }));
    assert.deepEqual(await adapter.detect(), { available: false, reason: 'package-unproven' });
    assert.deepEqual(await adapter.listTargets(), {
      available: false, reason: 'package-unproven', targets: []
    });
    assert.equal(fetchCalls, 0);
    await adapter.close();
  });

  await test('候选 rc.2 错版或缺 proof 时在任何 fetch 前 fail-closed', async () => {
    for (const packageVersionProof of [undefined, null, 'latest', '0.1.0-rc.6']) {
      let fetchCalls = 0;
      const candidate = backend.createDshPromptAdapter(adapterOptions(async () => {
        fetchCalls += 1;
        throw new Error('must not fetch');
      }, {
        expectedPackageVersion: '0.1.1-rc.2',
        packageVersionProof
      }));
      assert.deepEqual(await candidate.detect(), {
        available: false, reason: 'package-unproven'
      });
      assert.deepEqual(await candidate.listTargets(), {
        available: false, reason: 'package-unproven', targets: []
      });
      assert.equal(fetchCalls, 0);
      await candidate.close();
    }
  });

  await test('非法候选版本在构造时失败且零 fetch', async () => {
    let fetchCalls = 0;
    assert.throws(() => backend.createDshPromptAdapter(adapterOptions(async () => {
      fetchCalls += 1;
    }, {
      expectedPackageVersion: 'latest',
      packageVersionProof: 'latest'
    })), (error) => error.code === 'ERR_DSH_PACKAGE_CONTRACT');
    assert.equal(fetchCalls, 0);
  });

  await test('显式精确 rc.2 proof 复用同一 describe/list/queue 合约', async () => {
    const candidateRequests = [];
    const candidate = backend.createDshPromptAdapter(adapterOptions(
      fixtureFetch(candidateRequests, {
        describe: {
          version: '0.0.1', cwd: '/private/workspace',
          home: '/private/rc2-home', attachedSessions: 3, canOpenPath: true
        }
      }),
      {
        expectedPackageVersion: '0.1.1-rc.2',
        packageVersionProof: '0.1.1-rc.2'
      }
    ));
    assert.deepEqual(await candidate.detect(), { available: true, reason: 'ready' });
    const listed = await candidate.listTargets();
    assert.equal(listed.available, true);
    assert.equal(listed.targets.length, 1);
    assert.equal(JSON.stringify(listed).includes('/private/rc2-home'), false);
    assert.deepEqual(await candidate.submitText({
      targetToken: listed.targets[0].targetToken,
      text: 'RC2_CONTRACT_FIXTURE',
      clientTimeZone: 'Etc/UTC'
    }), { state: 'accepted', reason: 'accepted' });
    assert.deepEqual(candidateRequests.map((item) => item.request.method), [
      'host.describe', 'session.list', 'session.prompt'
    ]);
    assert.deepEqual(candidateRequests[2].request.payload, {
      sessionId: 'raw-session-root',
      mode: 'queue',
      content: [{ type: 'text', text: 'RC2_CONTRACT_FIXTURE' }],
      clientTimeZone: 'UTC'
    });
    await candidate.close();
  });

  const requests = [];
  const adapter = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(requests)));
  let targets;
  await test('detect/list 只走 loopback 精确 envelope，并只返回匿名顶层普通会话', async () => {
    assert.deepEqual(await adapter.detect(), { available: true, reason: 'ready' });
    const listed = await adapter.listTargets();
    targets = listed.targets;
    assert.equal(listed.available, true);
    assert.equal(targets.length, 1);
    assert.deepEqual(targets[0], {
      targetToken: 'target-1', label: '会话 01', running: true, updatedAt: 3000
    });
    assert.deepEqual(requests.map((item) => new URL(item.url).pathname), [
      '/api/host.describe', '/api/session.list'
    ]);
    for (const item of requests) {
      assert.equal(new URL(item.url).hostname, '127.0.0.1');
      assert.equal(item.init.method, 'POST');
      assert.equal(item.init.redirect, 'error');
      assert.equal(item.request.type, 'client-request');
      assert.deepEqual(Object.keys(item.request).sort(), ['method', 'payload', 'rpcId', 'type']);
    }
    const serialized = JSON.stringify(listed);
    for (const secret of [
      'raw-session', '/private/', 'private-provider', 'private-model', 'private-preset', 'secret'
    ]) assert.equal(serialized.includes(secret), false, secret);
    assert.deepEqual(adapter.inspectTarget(targets[0].targetToken), {
      targetToken: 'target-1',
      label: '会话 01',
      running: true,
      updatedAt: 3000,
      cwd: '/private/workspace'
    });
  });

  await test('精确 target ref 可匿名解析已选 root blank，普通列表仍排除 blank', async () => {
    const seen = [];
    const exact = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen), {
      deliveryTargetSecret: DELIVERY_TARGET_SECRET,
      deliveryTargetHostInstanceId: DELIVERY_TARGET_HOST
    }));
    const listed = await exact.listTargets();
    assert.equal(listed.targets.length, 1);
    assert.equal(JSON.stringify(listed).includes('blank'), false);
    const deliveryTargetRef = backend.dshDeliveryTargetRef(
      DELIVERY_TARGET_SECRET,
      DELIVERY_TARGET_HOST,
      'raw-session-blank'
    );
    assert.match(deliveryTargetRef, /^delivery-target-[a-f0-9]{64}$/);
    const resolved = await exact.resolveTarget(deliveryTargetRef);
    assert.deepEqual(resolved, {
      targetToken: 'target-2',
      label: '当前会话',
      running: false,
      updatedAt: 2000,
      cwd: null
    });
    assert.deepEqual(await exact.revalidateTarget(resolved.targetToken), resolved);
    const result = await exact.submitText({
      targetToken: resolved.targetToken,
      text: '精确投递给已选空会话'
    });
    assert.deepEqual(result, { state: 'accepted', reason: 'accepted' });
    const prompt = seen.find((item) => item.request.method === 'session.prompt');
    assert.deepEqual(prompt.request.payload, {
      sessionId: 'raw-session-blank',
      mode: 'queue',
      content: [{ type: 'text', text: '精确投递给已选空会话' }]
    });
    const publicValues = JSON.stringify({ listed, resolved, result });
    assert.equal(publicValues.includes('raw-session-blank'), false);
    assert.equal(publicValues.includes(deliveryTargetRef), false);
    await exact.close();
  });

  await test('未知、篡改、跨 host 与非 root target ref 全部 fail-closed 且零 prompt', async () => {
    assert.throws(() => backend.createDshPromptAdapter(adapterOptions(async () => {
      throw new Error('must not fetch');
    }, {
      deliveryTargetSecret: DELIVERY_TARGET_SECRET
    })), (error) => error.code === 'ERR_DSH_PROMPT_CONTRACT');

    const seen = [];
    const exact = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen), {
      deliveryTargetSecret: DELIVERY_TARGET_SECRET,
      deliveryTargetHostInstanceId: DELIVERY_TARGET_HOST
    }));
    await assert.rejects(
      exact.resolveTarget('delivery-target-short'),
      (error) => error.code === 'ERR_DSH_PROMPT_TARGET'
    );
    assert.equal(seen.length, 0);
    const rejectedRefs = [
      `delivery-target-${'0'.repeat(64)}`,
      backend.dshDeliveryTargetRef(
        DELIVERY_TARGET_SECRET,
        'host-delivery-target02',
        'raw-session-blank'
      ),
      backend.dshDeliveryTargetRef(
        DELIVERY_TARGET_SECRET,
        DELIVERY_TARGET_HOST,
        'raw-session-subagent'
      ),
      backend.dshDeliveryTargetRef(
        DELIVERY_TARGET_SECRET,
        DELIVERY_TARGET_HOST,
        'raw-session-fork'
      )
    ];
    for (const deliveryTargetRef of rejectedRefs) {
      await assert.rejects(
        exact.resolveTarget(deliveryTargetRef),
        (error) => error.code === 'ERR_DSH_PROMPT_TARGET'
      );
    }
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 0);
    assert.equal(JSON.stringify(seen).includes(DELIVERY_TARGET_SECRET), false);
    await exact.close();

    const ordinarySeen = [];
    const ordinary = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(ordinarySeen)));
    await assert.rejects(
      ordinary.resolveTarget(backend.dshDeliveryTargetRef(
        DELIVERY_TARGET_SECRET,
        DELIVERY_TARGET_HOST,
        'raw-session-root'
      )),
      (error) => error.code === 'ERR_DSH_PROMPT_TARGET'
    );
    assert.equal(ordinarySeen.length, 0);
    await ordinary.close();
  });

  await test('精确 blank token 的 revalidate 仅接受同一 root/non-subagent 会话', async () => {
    const seen = [];
    let listCalls = 0;
    const exact = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
      list: () => {
        listCalls += 1;
        if (listCalls < 3) {
          return { items: [{
            sessionId: 'raw-exact-blank', updatedAt: 10,
            running: false, blank: true, cwd: '/workspace/exact'
          }] };
        }
        return { items: [{
          sessionId: 'raw-exact-blank', parentSessionId: 'raw-parent',
          updatedAt: 11, running: false, blank: true, cwd: '/workspace/exact'
        }] };
      }
    }), {
      deliveryTargetSecret: DELIVERY_TARGET_SECRET,
      deliveryTargetHostInstanceId: DELIVERY_TARGET_HOST
    }));
    const resolved = await exact.resolveTarget(backend.dshDeliveryTargetRef(
      DELIVERY_TARGET_SECRET,
      DELIVERY_TARGET_HOST,
      'raw-exact-blank'
    ));
    assert.equal(resolved.label, 'exact', '精确目标应以工作区目录名对应右栏当前工作区');
    assert.equal((await exact.revalidateTarget(resolved.targetToken)).cwd, '/workspace/exact');
    await assert.rejects(
      exact.revalidateTarget(resolved.targetToken),
      (error) => error.code === 'ERR_DSH_PROMPT_TARGET'
    );
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 0);
    await exact.close();
  });

  await test('revalidate 重读 cwd 仍锁定原会话，排序竞态不改投', async () => {
    const seen = [];
    let listCalls = 0;
    const racing = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
      list: () => {
        listCalls += 1;
        return listCalls === 1
          ? { items: [{
            sessionId: 'race-original', updatedAt: 3000,
            running: true, blank: false, cwd: '/workspace/original'
          }, {
            sessionId: 'race-other', updatedAt: 2000,
            running: false, blank: false, cwd: '/workspace/other'
          }] }
          : { items: [{
            sessionId: 'race-other', updatedAt: 9000,
            running: true, blank: false, cwd: '/workspace/other-new'
          }, {
            sessionId: 'race-original', updatedAt: 1000,
            running: false, blank: false, cwd: '/workspace/original-new'
          }] };
      }
    })));
    const listed = await racing.listTargets();
    assert.equal(Object.hasOwn(listed.targets[0], 'cwd'), false);
    const token = listed.targets[0].targetToken;
    assert.deepEqual(await racing.revalidateTarget(token), {
      targetToken: token,
      label: '会话 01',
      running: false,
      updatedAt: 1000,
      cwd: '/workspace/original-new'
    });
    await racing.submitText({ targetToken: token, text: '仍投递给原会话' });
    const prompt = seen.find((item) => item.request.method === 'session.prompt');
    assert.equal(prompt.request.payload.sessionId, 'race-original');
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 1);
    await racing.close();
  });

  await test('cwd 严格校验，目标消失时 revalidate 不清 token 也不改投', async () => {
    const malformed = backend.createDshPromptAdapter(adapterOptions(fixtureFetch([], {
      list: { items: [{
        sessionId: 'bad-cwd', updatedAt: 1, running: false, blank: false, cwd: '../relative'
      }] }
    })));
    assert.deepEqual(await malformed.listTargets(), {
      available: false, reason: 'contract', targets: []
    });
    await malformed.close();

    let listCalls = 0;
    const missing = backend.createDshPromptAdapter(adapterOptions(fixtureFetch([], {
      list: () => (++listCalls === 1
        ? { items: [{
          sessionId: 'gone-session', updatedAt: 1, running: false,
          blank: false, cwd: '/workspace/gone'
        }] }
        : { items: [{
          sessionId: 'different-session', updatedAt: 2, running: false,
          blank: false, cwd: '/workspace/different'
        }] })
    })));
    const listed = await missing.listTargets();
    const token = listed.targets[0].targetToken;
    await assert.rejects(
      missing.revalidateTarget(token),
      (error) => error.code === 'ERR_DSH_PROMPT_TARGET'
    );
    assert.equal(missing.inspectTarget(token).cwd, '/workspace/gone');
    await missing.close();
  });

  await test('submit 只发一次 rc.6 queue + 单 text block，并验证 clientTimeZone', async () => {
    const result = await adapter.submitText({
      targetToken: targets[0].targetToken,
      text: '请根据下面这张截图协助我。\n\n图片路径：/work/a.png',
      clientTimeZone: 'America/Los_Angeles'
    });
    assert.deepEqual(result, { state: 'accepted', reason: 'accepted' });
    const prompt = requests.at(-1);
    assert.equal(new URL(prompt.url).pathname, '/api/session.prompt');
    assert.equal(prompt.request.method, 'session.prompt');
    assert.deepEqual(prompt.request.payload, {
      sessionId: 'raw-session-root',
      mode: 'queue',
      content: [{
        type: 'text',
        text: '请根据下面这张截图协助我。\n\n图片路径：/work/a.png'
      }],
      clientTimeZone: 'America/Los_Angeles'
    });
    assert.equal(requests.filter((item) => item.request.method === 'session.prompt').length, 1);
  });

  await test('tracking 在唯一 prompt fetch 前 awaited，匿名 refs 与预分配 rpcId 精确绑定', async () => {
    const seen = [];
    const prepared = [];
    let callbackFinished = false;
    const tracking = backend.createDshPromptAdapter(adapterOptions(
      fixtureFetch(seen, {
        prompt: (request) => {
          assert.equal(callbackFinished, true);
          return serverResponse(request, { accepted: true });
        }
      }),
      {
        sessionSalt: 'tracking-salt',
        onDeliveryPrepared: async (value) => {
          await new Promise((resolve) => setImmediate(resolve));
          prepared.push(value);
          callbackFinished = true;
        }
      }
    ));
    const listed = await tracking.listTargets();
    assert.equal(JSON.stringify(listed).includes('/private/workspace'), false);
    assert.equal(JSON.stringify(listed).includes('session-'), false);
    const inspected = tracking.inspectTarget(listed.targets[0].targetToken);
    assert.equal(inspected.cwd, '/private/workspace');
    assert.equal(
      inspected.sessionRef,
      backend.dshOpaqueRef('tracking-salt', 'session', 'raw-session-root')
    );
    const result = await tracking.submitText({
      targetToken: listed.targets[0].targetToken,
      text: '可跟踪投递'
    });
    const prompt = seen.find((item) => item.request.method === 'session.prompt');
    assert.equal(prepared.length, 1);
    assert.equal(result.state, 'accepted');
    assert.deepEqual(result.tracking, {
      available: true,
      sessionRef: backend.dshOpaqueRef('tracking-salt', 'session', 'raw-session-root'),
      deliveryRef: backend.dshOpaqueRef('tracking-salt', 'delivery', prompt.request.rpcId)
    });
    assert.deepEqual(prepared[0], {
      sessionRef: result.tracking.sessionRef,
      deliveryRef: result.tracking.deliveryRef,
      targetToken: listed.targets[0].targetToken,
      label: '会话 01',
      running: true,
      updatedAt: 3000,
      cwd: '/private/workspace'
    });
    assert.equal(Object.hasOwn(prepared[0], 'available'), false);
    const serialized = JSON.stringify({ prepared, result });
    assert.equal(serialized.includes('raw-session-root'), false);
    assert.equal(serialized.includes(prompt.request.rpcId), false);
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 1);
    await tracking.close();
  });

  await test('非法 token、slash command 与超长文本在 fetch 前 fail-closed', async () => {
    const before = requests.length;
    await assert.rejects(
      adapter.submitText({ targetToken: 'target-missing', text: 'hello' }),
      (error) => error.code === 'ERR_DSH_PROMPT_TARGET'
    );
    await assert.rejects(
      adapter.submitText({ targetToken: targets[0].targetToken, text: '/goal hidden command' }),
      (error) => error.code === 'ERR_DSH_PROMPT_INPUT'
    );
    await assert.rejects(
      adapter.submitText({
        targetToken: targets[0].targetToken,
        text: 'x'.repeat(backend.DSH_PROMPT_LIMITS.maxTextBytes + 1)
      }),
      (error) => error.code === 'ERR_DSH_PROMPT_INPUT'
    );
    assert.equal(requests.length, before);
  });

  await test('明确业务拒绝归为 rejected，零自动 retry 且不透传服务端正文', async () => {
    const seen = [];
    const rejected = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
      promptResult: {
        ok: false,
        error: {
          code: 'agent-busy',
          message: 'raw-session-secret prompt rejected',
          details: { reason: '/private/path' }
        }
      }
    })));
    const list = await rejected.listTargets();
    const result = await rejected.submitText({
      targetToken: list.targets[0].targetToken,
      text: '普通截图交付文本'
    });
    assert.deepEqual(result, { state: 'rejected', reason: 'agent-busy' });
    assert.equal(JSON.stringify(result).includes('raw-session'), false);
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 1);
    await rejected.close();
  });

  await test('timeout 是 unknown、只请求一次且不会自动重试', async () => {
    const seen = [];
    const timed = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
      prompt: (_request, _url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    }), { timeoutMs: 5 }));
    const list = await timed.listTargets();
    const result = await timed.submitText({
      targetToken: list.targets[0].targetToken,
      text: '普通截图交付文本'
    });
    assert.deepEqual(result, { state: 'unknown', reason: 'timeout' });
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 1);
    await timed.close();
  });

  await test('rejected/timeout 均保留匿名 refs，callback 失败只降级 tracking 不阻断投递', async () => {
    const cases = [
      {
        name: 'rejected',
        prompt: (request) => serverResponse(request, null, {
          result: { ok: false, error: { code: 'busy', message: 'secret' } }
        }),
        expectedState: 'rejected',
        callback: async () => { throw new Error('local tracker unavailable'); }
      },
      {
        name: 'timeout',
        prompt: (_request, _url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
        expectedState: 'unknown',
        callback: async () => {}
      }
    ];
    for (const item of cases) {
      const seen = [];
      const tracked = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
        prompt: item.prompt
      }), {
        timeoutMs: item.name === 'timeout' ? 5 : 3000,
        sessionSalt: 'tracking-result-salt',
        onDeliveryPrepared: item.callback
      }));
      const listed = await tracked.listTargets();
      const result = await tracked.submitText({
        targetToken: listed.targets[0].targetToken,
        text: `跟踪 ${item.name}`
      });
      const prompt = seen.find((request) => request.request.method === 'session.prompt');
      assert.equal(result.state, item.expectedState, item.name);
      assert.equal(result.tracking.available, item.name !== 'rejected', item.name);
      assert.equal(
        result.tracking.sessionRef,
        backend.dshOpaqueRef('tracking-result-salt', 'session', 'raw-session-root')
      );
      assert.equal(
        result.tracking.deliveryRef,
        backend.dshOpaqueRef('tracking-result-salt', 'delivery', prompt.request.rpcId)
      );
      assert.equal(JSON.stringify(result).includes('raw-session-root'), false);
      assert.equal(JSON.stringify(result).includes(prompt.request.rpcId), false);
      assert.equal(seen.filter((request) => request.request.method === 'session.prompt').length, 1);
      await tracked.close();
    }
  });

  await test('严格回执注册失败时零 prompt，注册完成后才允许唯一 fetch', async () => {
    for (const item of [
      { name: 'throws', callback: async () => { throw new Error('tracker down'); }, sent: false },
      { name: 'not-registered', callback: async () => ({ registered: false }), sent: false },
      {
        name: 'registered-unavailable',
        callback: async () => ({ registered: true, available: false }),
        sent: true
      }
    ]) {
      const seen = [];
      const strict = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen), {
        sessionSalt: `strict-${item.name}`,
        onDeliveryPrepared: item.callback,
        requireDeliveryPrepared: true
      }));
      const listed = await strict.listTargets();
      const result = await strict.submitText({
        targetToken: listed.targets[0].targetToken,
        text: `严格投递 ${item.name}`
      });
      assert.equal(
        seen.filter((request) => request.request.method === 'session.prompt').length,
        item.sent ? 1 : 0,
        item.name
      );
      assert.equal(result.state, item.sent ? 'accepted' : 'rejected', item.name);
      assert.equal(result.reason, item.sent ? 'accepted' : 'delivery-registration', item.name);
      assert.equal(result.tracking.available, false, item.name);
      await strict.close();
    }
  });

  await test('rpcId mismatch/坏成功 shape 均为 unknown，绝不冒充 accepted', async () => {
    for (const kind of ['rpc', 'shape']) {
      const seen = [];
      const broken = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
        prompt: (request) => kind === 'rpc'
          ? serverResponse(request, { accepted: true }, { rpcId: 'wrong-rpc' })
          : serverResponse(request, { accepted: false })
      })));
      const list = await broken.listTargets();
      const result = await broken.submitText({
        targetToken: list.targets[0].targetToken,
        text: '普通截图交付文本'
      });
      assert.equal(result.state, 'unknown');
      assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 1);
      await broken.close();
    }
  });

  await test('host 版本不符时 list unavailable 且零 prompt', async () => {
    const seen = [];
    const mismatched = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
      describe: {
        version: '9.9.9', cwd: '/private', attachedSessions: 0, canOpenPath: false
      }
    })));
    assert.deepEqual(await mismatched.listTargets(), {
      available: false, reason: 'host-version', targets: []
    });
    assert.equal(seen.some((item) => item.request.method === 'session.prompt'), false);
    await mismatched.close();
  });

  await test('close 会 abort 在途 prompt、等待落定并清空 target token', async () => {
    const seen = [];
    let promptStarted;
    const started = new Promise((resolve) => { promptStarted = resolve; });
    const closing = backend.createDshPromptAdapter(adapterOptions(fixtureFetch(seen, {
      prompt: (_request, _url, init) => new Promise((_resolve, reject) => {
        promptStarted();
        init.signal.addEventListener('abort', () => reject(new Error('closed')), { once: true });
      })
    }), { timeoutMs: 5000 }));
    const list = await closing.listTargets();
    const pending = closing.submitText({
      targetToken: list.targets[0].targetToken,
      text: '普通截图交付文本'
    });
    await started;
    await closing.close();
    assert.deepEqual(await pending, { state: 'unknown', reason: 'closed' });
    await assert.rejects(closing.detect(), (error) => error.code === 'ERR_DSH_PROMPT_CLOSED');
    await assert.rejects(
      closing.submitText({ targetToken: list.targets[0].targetToken, text: '不会发送' }),
      (error) => error.code === 'ERR_DSH_PROMPT_CLOSED'
    );
    assert.equal(seen.filter((item) => item.request.method === 'session.prompt').length, 1);
  });

  await adapter.close();
  console.log(`\nBACKEND PROMPT ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('BACKEND PROMPT FAIL:', error && error.stack || error);
  process.exit(1);
});
