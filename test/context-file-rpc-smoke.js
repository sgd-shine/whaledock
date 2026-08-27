'use strict';

const assert = require('assert/strict');
const {
  STATES,
  DEFAULT_LIMITS,
  normalizeBinding,
  createContextFileRpcBroker
} = require('../lib/context-file-rpc');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  context-file-rpc: ${name}`);
  } catch (error) {
    console.error(`FAIL  context-file-rpc: ${name}`);
    throw error;
  }
}

function exact(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function binding(overrides = {}) {
  return {
    hostInstanceId: 'host-instance-0001',
    controllerId: 'controller-instance-0001',
    pageInstanceId: 'page-instance-0001',
    selectionRevision: 3,
    projectId: `wdp1_${'a'.repeat(32)}`,
    contextRevision: 7,
    workspaceGeneration: 11,
    rootIdentity: { dev: '101', ino: '202' },
    ...overrides
  };
}

function makeClock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms) { value += ms; },
    set(next) { value = next; }
  };
}

function makeRandom() {
  let counter = 0;
  return (size) => {
    counter += 1;
    const value = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) {
      value[index] = (counter * 37 + index * 13) & 0xff;
    }
    return value;
  };
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => Boolean(error) && error.code === code);
}

function topicDescriptor(overrides = {}) {
  return {
    validate(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).sort().join(',') !== 'field,projectToken,value'
          || !['angle', 'hook'].includes(value.field)
          || typeof value.projectToken !== 'string'
          || !/^project-[a-f0-9]{24}$/.test(value.projectToken)
          || typeof value.value !== 'string' || !value.value || value.value.length > 240) {
        throw new Error('invalid');
      }
      return { projectToken: value.projectToken, field: value.field, value: value.value };
    },
    async handle({ input, binding: requestBinding, context }) {
      assert.equal(Object.isFrozen(input), true);
      assert.equal(Object.isFrozen(requestBinding), true);
      return {
        kind: 'mutation',
        changed: true,
        projectToken: context.nextProjectToken,
        selected: `${input.field}:${input.value}`
      };
    },
    redact(value) {
      return {
        kind: value.kind,
        changed: value.changed,
        projectToken: value.projectToken,
        selected: value.selected
      };
    },
    errorCode(error) {
      return error && error.code === 'ERR_CAS_MISMATCH' ? 'cas-mismatch' : 'operation-failed';
    },
    ...overrides
  };
}

function brokerWithTopic(options = {}) {
  const clock = options.clock || makeClock();
  const broker = createContextFileRpcBroker({
    now: clock.now,
    randomBytes: options.randomBytes || makeRandom(),
    limits: options.limits,
    operations: { 'topic.choose': topicDescriptor(options.descriptor) }
  });
  return { broker, clock };
}

async function run() {
  await test('默认上限固化，binding 精确绑定 Host/页面/上下文/工作区实体', async () => {
    assert.equal(Object.isFrozen(DEFAULT_LIMITS), true);
    assert.deepEqual(DEFAULT_LIMITS, {
      maxActive: 32,
      maxTotal: 64,
      maxPerController: 4,
      maxReadBatch: 4,
      maxInputBytes: 4096,
      maxResultBytes: 6144,
      maxJsonDepth: 8,
      maxJsonNodes: 512,
      maxOperations: 32,
      maxTokenAttempts: 8,
      queueTtlMs: 10000,
      leaseTtlMs: 10000,
      resultTtlMs: 30000
    });
    const normalized = normalizeBinding(binding());
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.rootIdentity), true);
    assert.deepEqual(normalized, binding());
    for (const invalid of [
      binding({ hostInstanceId: 'short' }),
      binding({ controllerId: 12345678 }),
      binding({ selectionRevision: 0 }),
      binding({ projectId: 'project-a' }),
      binding({ contextRevision: 0 }),
      binding({ workspaceGeneration: -1 }),
      binding({ rootIdentity: { dev: '../1', ino: '2' } }),
      { ...binding(), extra: true }
    ]) throwsCode(() => normalizeBinding(invalid), 'ERR_BINDING_INVALID');
  });

  await test('只能登记高层 operation，通用路径/frontmatter patch 名称直接拒绝', async () => {
    const broker = createContextFileRpcBroker({ randomBytes: makeRandom() });
    assert.equal(broker.registerOperation('topic.choose', topicDescriptor()), 'topic.choose');
    throwsCode(() => broker.registerOperation('topic.choose', topicDescriptor()), 'ERR_OPERATION_EXISTS');
    for (const name of [
      'file.read', 'files.write', 'path.resolve', 'frontmatter.patch',
      'document.patch', 'document.file-path'
    ]) {
      throwsCode(() => broker.registerOperation(name, topicDescriptor()), 'ERR_OPERATION_INVALID');
    }
    throwsCode(() => broker.registerOperation('topic.bad', {
      validate() {}, handle() {}
    }), 'ERR_HANDLER_INVALID');
  });

  await test('入队只公开 requestToken/状态，random seq 与 claimToken 不泄露', async () => {
    const { broker } = brokerWithTopic();
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner,
      operation: 'topic.choose',
      input: { projectToken: `project-${'b'.repeat(24)}`, field: 'angle', value: '实测角度' }
    });
    exact(queued, ['requestToken', 'state', 'code', 'result']);
    assert.match(queued.requestToken, /^file-request-[a-f0-9]{64}$/);
    assert.deepEqual(queued, {
      requestToken: queued.requestToken, state: STATES.queued, code: null, result: null
    });
    const publicText = JSON.stringify(queued);
    for (const forbidden of [
      'requestSeq', 'claimToken', owner.hostInstanceId, owner.controllerId,
      owner.pageInstanceId, owner.rootIdentity.dev, owner.rootIdentity.ino
    ]) assert.equal(publicText.includes(forbidden), false, forbidden);

    const requests = broker.read({ binding: owner, limit: 1 });
    assert.equal(requests.length, 1);
    assert.equal(Number.isSafeInteger(requests[0].requestSeq), true);
    assert.equal(requests[0].requestSeq > 0, true);
    assert.deepEqual(requests[0].binding, owner);
    assert.equal(Object.isFrozen(requests[0].input), true);
    const claimed = broker.claim({
      binding: owner,
      requestToken: queued.requestToken,
      requestSeq: requests[0].requestSeq
    });
    assert.equal(claimed.claimed, true);
    assert.match(claimed.claimToken, /^file-claim-[a-f0-9]{64}$/);
    const running = broker.snapshot({ binding: owner, requestToken: queued.requestToken });
    exact(running, ['requestToken', 'state', 'code', 'result']);
    assert.equal(running.state, STATES.running);
    assert.equal(JSON.stringify(running).includes(claimed.claimToken), false);
    assert.equal(JSON.stringify(running).includes(String(requests[0].requestSeq)), false);
  });

  await test('binding 任一维变化都不可 read/claim/snapshot 跨界', async () => {
    const { broker } = brokerWithTopic();
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'c'.repeat(24)}`, field: 'hook', value: '真实钩子' }
    });
    const variants = [
      binding({ hostInstanceId: 'host-instance-0002' }),
      binding({ controllerId: 'controller-instance-0002' }),
      binding({ pageInstanceId: 'page-instance-0002' }),
      binding({ selectionRevision: 4 }),
      binding({ projectId: `wdp1_${'d'.repeat(32)}` }),
      binding({ contextRevision: 8 }),
      binding({ workspaceGeneration: 12 }),
      binding({ rootIdentity: { dev: '101', ino: '203' } })
    ];
    const privateRow = broker.read({ binding: owner, limit: 1 })[0];
    for (const wrong of variants) {
      assert.deepEqual(broker.read({ binding: wrong, limit: 1 }), []);
      assert.equal(broker.snapshot({ binding: wrong, requestToken: queued.requestToken }).code,
        'request-unavailable');
      assert.deepEqual(broker.claim({
        binding: wrong, requestToken: queued.requestToken, requestSeq: privateRow.requestSeq
      }), { claimed: false, code: 'request-unavailable' });
    }
    assert.equal(broker.snapshot({ binding: owner, requestToken: queued.requestToken }).state,
      STATES.queued);
  });

  await test('queued 可取消，running 只返回真实 running 不伪造取消', async () => {
    const { broker } = brokerWithTopic();
    const owner = binding();
    const first = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'d'.repeat(24)}`, field: 'angle', value: '取消' }
    });
    const cancelled = broker.cancel({ binding: owner, requestToken: first.requestToken });
    assert.deepEqual(cancelled, {
      requestToken: first.requestToken,
      state: STATES.rejected,
      code: 'request-cancelled',
      result: null
    });
    assert.deepEqual(broker.read({ binding: owner, limit: 4 }), []);

    const second = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'e'.repeat(24)}`, field: 'hook', value: '已取得执行权' }
    });
    const row = broker.read({ binding: owner, limit: 1 })[0];
    broker.claim({ binding: owner, requestToken: second.requestToken, requestSeq: row.requestSeq });
    const refused = broker.cancel({ binding: owner, requestToken: second.requestToken });
    assert.equal(refused.state, STATES.running);
    assert.equal(refused.code, null);
  });

  await test('claim 后执行注册 handler，只公开 redact 后的有界结果', async () => {
    const { broker } = brokerWithTopic();
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'f'.repeat(24)}`, field: 'angle', value: '正面实测' }
    });
    const row = broker.read({ binding: owner, limit: 1 })[0];
    const claim = broker.claim({ binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq });
    const settled = await broker.execute({
      binding: owner,
      requestToken: queued.requestToken,
      requestSeq: row.requestSeq,
      claimToken: claim.claimToken,
      context: { nextProjectToken: `project-${'1'.repeat(24)}`, privateAdapter: true }
    });
    assert.equal(settled.settled, true);
    assert.equal(settled.code, null);
    const snapshot = broker.snapshot({ binding: owner, requestToken: queued.requestToken });
    assert.deepEqual(snapshot, {
      requestToken: queued.requestToken,
      state: STATES.fulfilled,
      code: null,
      result: {
        kind: 'mutation', changed: true, projectToken: `project-${'1'.repeat(24)}`,
        selected: 'angle:正面实测'
      }
    });
    assert.equal(JSON.stringify(snapshot).includes('privateAdapter'), false);
    assert.equal(Object.isFrozen(snapshot.result), true);
    assert.deepEqual(broker.claim({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq
    }), { claimed: false, code: 'already-settled' });
  });

  await test('handler 错误只暴露稳定 code，不暴露 message/stack/路径', async () => {
    const secret = '/Users/example/secret-project.md';
    const descriptor = topicDescriptor({
      async handle() {
        const error = new Error(`CAS failed at ${secret}`);
        error.code = 'ERR_CAS_MISMATCH';
        throw error;
      }
    });
    const clock = makeClock();
    const broker = createContextFileRpcBroker({
      now: clock.now, randomBytes: makeRandom(),
      operations: { 'topic.choose': descriptor }
    });
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'2'.repeat(24)}`, field: 'hook', value: '并发' }
    });
    const row = broker.read({ binding: owner, limit: 1 })[0];
    const claim = broker.claim({ binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq });
    await broker.execute({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, context: {}
    });
    const snapshot = broker.snapshot({ binding: owner, requestToken: queued.requestToken });
    assert.equal(snapshot.state, STATES.rejected);
    assert.equal(snapshot.code, 'cas-mismatch');
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.equal(JSON.stringify(snapshot).includes('CAS failed'), false);
  });

  await test('同一 claim 不能并发执行 handler，重放不会二次调用', async () => {
    let runs = 0;
    let release;
    const deferred = new Promise((resolve) => { release = resolve; });
    const descriptor = topicDescriptor({
      async handle({ input }) {
        runs += 1;
        await deferred;
        return {
          kind: 'mutation', changed: true,
          projectToken: `project-${'3'.repeat(24)}`,
          selected: `${input.field}:${input.value}`
        };
      }
    });
    const broker = createContextFileRpcBroker({
      randomBytes: makeRandom(), operations: { 'topic.choose': descriptor }
    });
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'4'.repeat(24)}`, field: 'angle', value: '唯一执行' }
    });
    const row = broker.read({ binding: owner, limit: 1 })[0];
    const claim = broker.claim({ binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq });
    const first = broker.execute({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, context: {}
    });
    await Promise.resolve();
    assert.deepEqual(await broker.execute({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, context: {}
    }), { settled: false, code: 'already-running' });
    assert.deepEqual(broker.settle({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, status: 'rejected', code: 'operation-failed', result: null
    }), { settled: false, code: 'already-running' });
    assert.equal(runs, 1);
    release();
    assert.equal((await first).settled, true);
    assert.deepEqual(await broker.execute({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, context: {}
    }), { settled: false, code: 'claim-invalid' });
    assert.equal(runs, 1);
  });

  await test('queue TTL 会拒绝未执行请求，结果 TTL 后只返回 unavailable', async () => {
    const clock = makeClock(0);
    const { broker } = brokerWithTopic({ clock });
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'5'.repeat(24)}`, field: 'hook', value: '等待过期' }
    });
    clock.advance(DEFAULT_LIMITS.queueTtlMs);
    const expired = broker.snapshot({ binding: owner, requestToken: queued.requestToken });
    assert.deepEqual(expired, {
      requestToken: queued.requestToken, state: STATES.rejected,
      code: 'request-expired', result: null
    });
    assert.deepEqual(broker.read({ binding: owner, limit: 1 }), []);
    clock.advance(DEFAULT_LIMITS.resultTtlMs);
    assert.deepEqual(broker.snapshot({ binding: owner, requestToken: queued.requestToken }), {
      requestToken: queued.requestToken, state: STATES.rejected,
      code: 'request-unavailable', result: null
    });
  });

  await test('running lease 到期只记录 outcome-unknown，不伪造底层取消或成功', async () => {
    const clock = makeClock(0);
    const { broker } = brokerWithTopic({ clock });
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'6'.repeat(24)}`, field: 'angle', value: '超时' }
    });
    const row = broker.read({ binding: owner, limit: 1 })[0];
    const claim = broker.claim({ binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq });
    clock.advance(DEFAULT_LIMITS.leaseTtlMs);
    assert.deepEqual(broker.sweep(), { expired: 1, removed: 0 });
    assert.deepEqual(broker.snapshot({ binding: owner, requestToken: queued.requestToken }), {
      requestToken: queued.requestToken, state: STATES.rejected,
      code: 'outcome-unknown', result: null
    });
    assert.equal(broker.cancel({ binding: owner, requestToken: queued.requestToken }).code,
      'outcome-unknown');
    const late = broker.settle({
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, status: 'fulfilled', code: null,
      result: { kind: 'mutation', changed: true, projectToken: `project-${'7'.repeat(24)}`, selected: 'angle:超时' }
    });
    assert.deepEqual(late, { settled: false, code: 'claim-invalid' });
    assert.deepEqual(broker.snapshot({ binding: owner, requestToken: queued.requestToken }), {
      requestToken: queued.requestToken, state: STATES.rejected,
      code: 'outcome-unknown', result: null
    });
  });

  await test('全局/活跃/controller/批量/保留记录容量都有硬上限', async () => {
    const clock = makeClock(0);
    const { broker } = brokerWithTopic({
      clock,
      limits: {
        maxActive: 2,
        maxTotal: 3,
        maxPerController: 1,
        maxReadBatch: 2
      }
    });
    const input = (digit) => ({
      projectToken: `project-${digit.repeat(24)}`, field: 'angle', value: digit
    });
    const a = binding();
    const b = binding({ controllerId: 'controller-instance-0002' });
    const c = binding({ controllerId: 'controller-instance-0003' });
    const first = broker.enqueue({ binding: a, operation: 'topic.choose', input: input('8') });
    throwsCode(() => broker.enqueue({ binding: a, operation: 'topic.choose', input: input('9') }),
      'ERR_CAPACITY');
    const second = broker.enqueue({ binding: b, operation: 'topic.choose', input: input('a') });
    throwsCode(() => broker.enqueue({ binding: c, operation: 'topic.choose', input: input('b') }),
      'ERR_CAPACITY');
    throwsCode(() => broker.read({ binding: a, limit: 3 }), 'ERR_REQUEST_INVALID');
    broker.cancel({ binding: a, requestToken: first.requestToken });
    const third = broker.enqueue({ binding: c, operation: 'topic.choose', input: input('c') });
    broker.cancel({ binding: b, requestToken: second.requestToken });
    broker.cancel({ binding: c, requestToken: third.requestToken });
    throwsCode(() => broker.enqueue({ binding: a, operation: 'topic.choose', input: input('d') }),
      'ERR_CAPACITY');
    clock.advance(DEFAULT_LIMITS.resultTtlMs);
    assert.deepEqual(broker.sweep(), { expired: 0, removed: 3 });
    assert.equal(broker.enqueue({ binding: a, operation: 'topic.choose', input: input('e') }).state,
      STATES.queued);
  });

  await test('输入拒绝路径/frontmatter patch/超限，未登记 operation 不入队', async () => {
    const passthrough = topicDescriptor({
      validate(value) { return value; }
    });
    const broker = createContextFileRpcBroker({
      randomBytes: makeRandom(), operations: { 'topic.choose': passthrough }
    });
    const owner = binding();
    for (const input of [
      { path: '/tmp/escape.md' },
      { nested: { relativePath: '../escape.md' } },
      { nested: { relative_path: '../escape.md' } },
      { frontMatter: { status: 'published' } },
      { patch: { stage: 'publish' } },
      { Effective_Path: '/tmp/escape.md' },
      { Context: { private: true } },
      { Hash: 'a'.repeat(64) }
    ]) throwsCode(() => broker.enqueue({ binding: owner, operation: 'topic.choose', input }),
      'ERR_INPUT_INVALID');
    throwsCode(() => broker.enqueue({
      binding: owner, operation: 'catalog.unknown', input: {}
    }), 'ERR_OPERATION_UNAVAILABLE');
    throwsCode(() => broker.enqueue({
      binding: owner, operation: 'topic.choose', input: { value: 'x'.repeat(5000) }
    }), 'ERR_INPUT_TOO_LARGE');

    let validationRuns = 0;
    const dropping = createContextFileRpcBroker({
      randomBytes: makeRandom(),
      operations: {
        'topic.choose': topicDescriptor({
          validate() {
            validationRuns += 1;
            return { projectToken: `project-${'a'.repeat(24)}`, field: 'angle', value: 'x' };
          }
        })
      }
    });
    throwsCode(() => dropping.enqueue({
      binding: owner, operation: 'topic.choose', input: { absolute_path: '/tmp/escape.md' }
    }), 'ERR_INPUT_INVALID');
    assert.equal(validationRuns, 0);
  });

  await test('结果超过 6 KiB 或含私有字段时 fail-closed，不截断冒充成功', async () => {
    const run = async (redact, expectedCode, digit) => {
      const descriptor = topicDescriptor({
        async handle() { return { ignored: true }; },
        redact
      });
      const broker = createContextFileRpcBroker({
        randomBytes: makeRandom(), operations: { 'topic.choose': descriptor }
      });
      const owner = binding();
      const queued = broker.enqueue({
        binding: owner, operation: 'topic.choose',
        input: { projectToken: `project-${digit.repeat(24)}`, field: 'angle', value: digit }
      });
      const row = broker.read({ binding: owner, limit: 1 })[0];
      const claim = broker.claim({ binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq });
      await broker.execute({
        binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
        claimToken: claim.claimToken, context: {}
      });
      const snapshot = broker.snapshot({ binding: owner, requestToken: queued.requestToken });
      assert.equal(snapshot.state, STATES.rejected);
      assert.equal(snapshot.code, expectedCode);
      assert.equal(snapshot.result, null);
    };
    await run(() => ({ value: 'x'.repeat(DEFAULT_LIMITS.maxResultBytes + 1) }),
      'result-too-large', '1');
    await run(() => ({ relativePath: '02_脚本/秘密.md' }), 'result-invalid', '2');
    await run(() => ({ claimToken: `file-claim-${'a'.repeat(64)}` }), 'result-invalid', '3');
    await run(() => ({ Effective_Path: '/private/a.md' }), 'result-invalid', '4');
    await run(() => ({ Context: { private: true } }), 'result-invalid', '5');
    await run(() => ({ Hash: 'a'.repeat(64) }), 'result-invalid', '6');
  });

  await test('手动 settle 也必须精确对账 binding/seq/claim，终态不可重放改写', async () => {
    const { broker } = brokerWithTopic();
    const owner = binding();
    const queued = broker.enqueue({
      binding: owner, operation: 'topic.choose',
      input: { projectToken: `project-${'9'.repeat(24)}`, field: 'hook', value: '手动收口' }
    });
    const row = broker.read({ binding: owner, limit: 1 })[0];
    const claim = broker.claim({ binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq });
    const payload = {
      binding: owner, requestToken: queued.requestToken, requestSeq: row.requestSeq,
      claimToken: claim.claimToken, status: 'fulfilled', code: null,
      result: {
        kind: 'mutation', changed: true, projectToken: `project-${'0'.repeat(24)}`,
        selected: 'hook:手动收口'
      }
    };
    assert.deepEqual(broker.settle({ ...payload, requestSeq: row.requestSeq + 1 }), {
      settled: false, code: 'claim-invalid'
    });
    assert.deepEqual(broker.settle({ ...payload, claimToken: `file-claim-${'0'.repeat(64)}` }), {
      settled: false, code: 'claim-invalid'
    });
    throwsCode(() => broker.settle({
      ...payload, status: 'rejected', code: new String('operation-failed'), result: null
    }), 'ERR_REQUEST_INVALID');
    assert.equal(broker.settle(payload).settled, true);
    const before = broker.snapshot({ binding: owner, requestToken: queued.requestToken });
    assert.deepEqual(broker.settle(payload), { settled: false, code: 'claim-invalid' });
    assert.deepEqual(broker.snapshot({ binding: owner, requestToken: queued.requestToken }), before);
  });

  await test('随机源必须返回精确 Buffer，token/seq 冲突有界失败', async () => {
    const bad = createContextFileRpcBroker({
      randomBytes: () => 'not-buffer', operations: { 'topic.choose': topicDescriptor() }
    });
    throwsCode(() => bad.enqueue({
      binding: binding(), operation: 'topic.choose',
      input: { projectToken: `project-${'a'.repeat(24)}`, field: 'angle', value: 'x' }
    }), 'ERR_RANDOM_INVALID');

    const repeated = createContextFileRpcBroker({
      randomBytes: (size) => Buffer.alloc(size, 7),
      limits: { maxTokenAttempts: 2 },
      operations: { 'topic.choose': topicDescriptor() }
    });
    repeated.enqueue({
      binding: binding(), operation: 'topic.choose',
      input: { projectToken: `project-${'b'.repeat(24)}`, field: 'angle', value: 'x' }
    });
    throwsCode(() => repeated.enqueue({
      binding: binding(), operation: 'topic.choose',
      input: { projectToken: `project-${'c'.repeat(24)}`, field: 'hook', value: 'y' }
    }), 'ERR_RANDOM_COLLISION');
  });

  await test('模块不依赖 Electron/fs，对外 API 不提供任意文件读写入口', async () => {
    const source = require('fs').readFileSync(require.resolve('../lib/context-file-rpc'), 'utf8');
    assert.equal(/require\(['"]electron['"]\)/.test(source), false);
    assert.equal(/require\(['"]fs['"]\)/.test(source), false);
    const { broker } = brokerWithTopic();
    assert.deepEqual(Object.keys(broker).sort(), [
      'cancel', 'claim', 'enqueue', 'execute', 'limits', 'read',
      'registerOperation', 'settle', 'snapshot', 'sweep'
    ]);
  });

  console.log(`\nCONTEXT FILE RPC ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('CONTEXT FILE RPC FAIL:', error);
  process.exitCode = 1;
});
