'use strict';

// v0.3 事件中性层的独立纯 Node 测试；由统一 smoke 子进程执行。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createEventService,
  SCHEMA_VERSION,
  USAGE_DISCLAIMER
} = require('../lib/events');

const HISTORY_FIXTURE = require('./fixtures/events/neutral-history.json');
const TERMINAL_MATRIX = require('./fixtures/events/terminal-matrix.json');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function makeClock(iso) {
  let value = new Date(iso);
  return {
    now: () => new Date(value),
    set(next) { value = new Date(next); }
  };
}

function makeService(tmp, name, clock, config = {}, onChanged) {
  return createEventService({
    stateFile: path.join(tmp, `${name}.json`),
    now: clock.now,
    config: {
      taskNotifications: true,
      budgetEnabled: false,
      dailyTokenBudget: 1000000,
      priceInputPerMillion: 1,
      priceCacheReadPerMillion: 0.02,
      priceOutputPerMillion: 2,
      timeZone: 'UTC',
      ...config
    },
    onChanged
  });
}

function effectsOfType(effects, type) {
  return effects.filter((effect) => effect.type === type);
}

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

function assertPrivateMode(file) {
  if (process.platform !== 'win32') assert.equal(modeOf(file), 0o600);
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-events-'));
  const clock = makeClock('2026-08-19T12:00:00.000Z');

  await check('模块是纯 Node，且不含原始协议路径或帧名', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'events.js'), 'utf8');
    assert.equal(SCHEMA_VERSION, 1);
    assert.equal(source.includes("require('electron')"), false);
    assert.equal(source.includes('events.mux'), false);
    assert.equal(source.includes('server-request'), false);
    assert.equal(source.includes('/api/'), false);
    assert.equal(source.includes('session/event'), false);
  });

  await check('session 注册、cursor 与 availability 只暴露中性状态', async () => {
    let changed = 0;
    const service = makeService(tmp, 'cursor', clock, {}, () => { changed += 1; });
    assert.deepEqual(service.getCursor('opaque-a'), {
      known: false,
      lastContiguousSeq: -1,
      notificationFloorSeq: null,
      origin: null
    });
    await service.registerSession('opaque-a', {
      origin: 'user',
      parentRef: 'opaque-parent',
      notificationFloorSeq: 4
    });
    assert.deepEqual(service.getCursor('opaque-a'), {
      known: true,
      lastContiguousSeq: -1,
      notificationFloorSeq: 4,
      origin: 'user'
    });
    const generation = await service.beginConnection();
    await service.setAvailability('backfilling', 'history-gap', generation);
    const view = service.snapshot();
    assert.deepEqual(view.availability, {
      state: 'backfilling',
      detail: 'history-gap'
    });
    assert.ok(changed >= 2);
    await service.close();
  });

  await check('schema 1 原子 0600 写入，所有敏感输入只落 HMAC', async () => {
    const stateFile = path.join(tmp, 'private.json');
    const service = makeService(tmp, 'private', clock);
    const salt = service.getSalt();
    assert.match(salt, /^[A-Za-z0-9+/]+={0,2}$/);
    await service.registerSession('raw-session-secret', {
      origin: 'user',
      parentRef: 'raw-parent-secret',
      notificationFloorSeq: -1
    });
    await service.ingest({
      kind: 'message',
      sessionRef: 'raw-session-secret',
      seq: 0,
      turn: 7,
      step: 'private-step',
      role: 'assistant',
      messageRef: 'raw-message-secret',
      usageMode: 'final',
      usage: { inputTokens: 1, cacheReadTokens: 2, outputTokens: 3 },
      body: 'DO-NOT-PERSIST-BODY',
      cwd: '/DO-NOT-PERSIST-CWD',
      toolArgs: { password: 'DO-NOT-PERSIST-TOOL' }
    });
    await service.flush();
    assertPrivateMode(stateFile);
    const serialized = fs.readFileSync(stateFile, 'utf8');
    const state = JSON.parse(serialized);
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.salt, salt);
    for (const secret of [
      'raw-session-secret', 'raw-parent-secret', 'raw-message-secret',
      'private-step', 'DO-NOT-PERSIST-BODY', 'DO-NOT-PERSIST-CWD',
      'DO-NOT-PERSIST-TOOL'
    ]) assert.equal(serialized.includes(secret), false, secret);
    assert.equal(Object.keys(state.sessions).length, 1);
    assert.equal(fs.readdirSync(tmp).some((name) => name.startsWith('private.json.tmp-')), false);
    await service.close();
  });

  await check('seq 乱序形成 gap，补齐后按连续顺序一次释放', async () => {
    const service = makeService(tmp, 'gap', clock);
    await service.registerSession('gap-session', { origin: 'user', notificationFloorSeq: -1 });
    assert.deepEqual(await service.ingest({
      kind: 'turn-terminal', sessionRef: 'gap-session', seq: 2,
      turn: 1, reason: 'completed'
    }), []);
    assert.equal(service.snapshot().coverage.gapSessions, 1);
    assert.deepEqual(await service.ingest({
      kind: 'message', sessionRef: 'gap-session', seq: 0,
      turn: 1, step: 'prompt', role: 'user'
    }), []);
    const effects = await service.ingest({
      kind: 'message', sessionRef: 'gap-session', seq: 1,
      turn: 1, step: 'answer', role: 'assistant'
    });
    assert.equal(effectsOfType(effects, 'task-terminal').length, 1);
    assert.equal(effects[0].sessionRef, 'gap-session');
    assert.equal(service.getCursor('gap-session').lastContiguousSeq, 2);
    assert.equal(service.snapshot().coverage.gapSessions, 0);
    assert.deepEqual(await service.ingest({
      kind: 'turn-terminal', sessionRef: 'gap-session', seq: 2,
      turn: 1, reason: 'completed'
    }), []);
    await service.close();
  });

  await check('baseline floor 与显式 suppressNotifications 导入历史但不旧通知', async () => {
    const service = makeService(tmp, 'baseline', clock);
    await service.registerSession('fixture-session', {
      origin: 'user', notificationFloorSeq: 1
    });
    const oldEffects = await service.ingestMany(HISTORY_FIXTURE, {
      suppressNotifications: true
    });
    assert.equal(oldEffects.length, 0);
    assert.equal(service.snapshot().today.tokens.total, 100);
    assert.equal(service.snapshot().recentTasks.length, 1);
    assert.equal(service.snapshot().recentTasks[0].durationMs, 1000);
    const liveEffects = await service.ingestMany([
      {
        kind: 'message', sessionRef: 'fixture-session', seq: 2,
        turn: 2, step: 'answer', role: 'assistant'
      },
      {
        kind: 'turn-terminal', sessionRef: 'fixture-session', seq: 3,
        turn: 2, reason: 'completed'
      }
    ]);
    assert.equal(effectsOfType(liveEffects, 'task-terminal').length, 1);
    await service.close();

    const reloaded = makeService(tmp, 'baseline', clock);
    await reloaded.registerSession('fixture-session', { origin: 'user' });
    assert.equal(reloaded.getSalt(), service.getSalt());
    assert.equal(
      reloaded.snapshot().recentTasks.find((task) => task.turn === 1).durationMs,
      1000
    );
    assert.deepEqual(await reloaded.ingest({
      kind: 'turn-terminal', sessionRef: 'fixture-session', seq: 3,
      turn: 2, reason: 'completed'
    }), []);
    await reloaded.close();
  });

  await check('超长首次历史可从已取证尾部建基线且保持缺口后的 live 连续', async () => {
    const service = makeService(tmp, 'long-baseline', clock);
    await service.registerSession('long-session', {
      origin: 'user', notificationFloorSeq: 10001
    });
    await service.registerSession('long-session', { initialContiguousSeq: 9999 });
    assert.equal(service.getCursor('long-session').lastContiguousSeq, 9999);
    const historyEffects = await service.ingestMany([
      {
        kind: 'message', sessionRef: 'long-session', seq: 10000,
        turn: 1, step: 'answer', role: 'assistant'
      },
      {
        kind: 'turn-terminal', sessionRef: 'long-session', seq: 10001,
        turn: 1, reason: 'completed'
      }
    ], { suppressNotifications: true });
    assert.deepEqual(historyEffects, []);
    assert.equal(service.getCursor('long-session').lastContiguousSeq, 10001);
    await service.ingest({
      kind: 'message', sessionRef: 'long-session', seq: 10002,
      turn: 2, step: 'answer', role: 'assistant'
    });
    const liveEffects = await service.ingest({
      kind: 'turn-terminal', sessionRef: 'long-session', seq: 10003,
      turn: 2, reason: 'completed'
    });
    assert.equal(effectsOfType(liveEffects, 'task-terminal').length, 1);
    await service.close();
  });

  await check('尾部基线的 history gap 持久且 reload 后 ready 不得清除', async () => {
    const stateFile = path.join(tmp, 'persistent-history-gap.json');
    const service = makeService(tmp, 'persistent-history-gap', clock);
    const generation = await service.beginConnection();
    await service.registerSession('persistent-gap-session', {
      origin: 'user', notificationFloorSeq: 10001
    });
    await service.registerSession('persistent-gap-session', { initialContiguousSeq: 9999 });
    await service.ingestMany([
      { kind: 'projection', sessionRef: 'persistent-gap-session', seq: 10000 },
      { kind: 'projection', sessionRef: 'persistent-gap-session', seq: 10001 }
    ], { suppressNotifications: true, generation });
    await service.setAvailability('live', 'history-gap', generation);
    assert.equal(service.snapshot().coverage.status, 'gap');
    await service.close();

    const stored = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(Object.values(stored.sessions)[0].coverageGap, true);

    const reloaded = makeService(tmp, 'persistent-history-gap', clock);
    const nextGeneration = await reloaded.beginConnection();
    await reloaded.setAvailability('live', 'ready', nextGeneration);
    assert.equal(reloaded.snapshot().coverage.status, 'gap');
    assert.equal(reloaded.snapshot().coverage.historyGap, true);
    assert.equal(reloaded.snapshot().coverage.gapSessions, 1);
    await reloaded.registerSession('persistent-gap-session', { origin: 'user' });
    assert.equal(reloaded.snapshot().coverage.status, 'gap');
    await reloaded.close();
  });

  await check('terminal 矩阵与 completed 的 assistant 条件严格执行', async () => {
    const service = makeService(tmp, 'terminal', clock);
    for (let index = 0; index < TERMINAL_MATRIX.length; index += 1) {
      const item = TERMINAL_MATRIX[index];
      const sessionRef = `terminal-${index}`;
      await service.registerSession(sessionRef, { origin: 'user', notificationFloorSeq: -1 });
      let seq = 0;
      if (item.assistant) {
        await service.ingest({
          kind: 'message', sessionRef, seq, turn: 1,
          step: 'answer', role: 'assistant'
        });
        seq += 1;
      }
      const effects = await service.ingest({
        kind: 'turn-terminal', sessionRef, seq, turn: 1, reason: item.reason
      });
      const terminalEffects = effectsOfType(effects, 'task-terminal');
      assert.equal(terminalEffects.length, item.notify ? 1 : 0, item.reason);
      if (item.notify) assert.equal(terminalEffects[0].result, item.result);
      const task = service.snapshot().recentTasks.find((row) => row.sessionKey === undefined
        && row.result === item.result && row.ordinal === index + 1);
      assert.ok(task, `${item.reason}:${item.result}`);
      if (!item.assistant) assert.equal(task.durationMs, null, item.reason);
    }
    await service.close();
  });

  await check('approval/question 幂等，断线清 pending，重放不重复提醒', async () => {
    const service = makeService(tmp, 'waiting', clock);
    await service.registerSession('wait-session', { origin: 'user', notificationFloorSeq: -1 });
    let effects = await service.ingest({
      kind: 'approval-open', sessionRef: 'wait-session', requestRef: 'raw-approval'
    });
    assert.equal(effectsOfType(effects, 'waiting-human').length, 1);
    assert.deepEqual(await service.ingest({
      kind: 'approval-open', sessionRef: 'wait-session', requestRef: 'raw-approval'
    }), []);
    effects = await service.ingest({
      kind: 'question-open', sessionRef: 'wait-session', requestRef: 'raw-question'
    });
    assert.equal(effectsOfType(effects, 'waiting-human').length, 1);
    assert.deepEqual(service.snapshot().waiting, { approvals: 1, questions: 1 });
    const disconnectGeneration = await service.beginConnection();
    await service.setAvailability('live', 'ready', disconnectGeneration);
    await service.disconnect(disconnectGeneration);
    assert.deepEqual(service.snapshot().waiting, { approvals: 0, questions: 0 });
    await assert.rejects(service.ingest({
      kind: 'approval-open', sessionRef: 'wait-session', requestRef: 'raw-approval'
    }), (error) => error.code === 'ERR_EVENT_GENERATION');
    const generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    assert.deepEqual(await service.ingest({
      kind: 'approval-open', sessionRef: 'wait-session', requestRef: 'raw-approval'
    }, { generation }), []);
    assert.deepEqual(service.snapshot().waiting, { approvals: 1, questions: 0 });
    await service.ingest({
      kind: 'approval-close', sessionRef: 'wait-session', requestRef: 'raw-approval'
    }, { generation });
    assert.deepEqual(service.snapshot().waiting, { approvals: 0, questions: 0 });
    await service.flush();
    const serialized = fs.readFileSync(path.join(tmp, 'waiting.json'), 'utf8');
    assert.equal(serialized.includes('raw-approval'), false);
    assert.equal(serialized.includes('raw-question'), false);
    await service.close();

    const generationOne = makeService(tmp, 'waiting-generation', clock);
    await generationOne.registerSession('generation-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    assert.equal(effectsOfType(await generationOne.ingest({
      kind: 'question-open', sessionRef: 'generation-session',
      requestRef: 'generation-question'
    }), 'waiting-human').length, 1);
    assert.deepEqual(generationOne.snapshot().waiting, { approvals: 0, questions: 1 });
    await generationOne.close();
    const generationTwo = makeService(tmp, 'waiting-generation', clock);
    assert.deepEqual(generationTwo.snapshot().waiting, { approvals: 0, questions: 1 });
    const stalePersisted = JSON.parse(fs.readFileSync(
      path.join(tmp, 'waiting-generation.json'), 'utf8'
    ));
    assert.equal(Object.keys(Object.values(stalePersisted.sessions)[0].pendingQuestions).length, 1);
    assert.equal(JSON.stringify(stalePersisted).includes('generation-question'), false);
    const originalRename = fs.promises.rename;
    let renameCalls = 0;
    fs.promises.rename = async (...args) => {
      renameCalls += 1;
      return originalRename(...args);
    };
    let liveGeneration;
    try {
      liveGeneration = await generationTwo.beginConnection();
      assert.deepEqual(generationTwo.snapshot().waiting, { approvals: 0, questions: 0 });
      assert.equal(renameCalls, 1);
      const persisted = JSON.parse(fs.readFileSync(
        path.join(tmp, 'waiting-generation.json'), 'utf8'
      ));
      assert.deepEqual(Object.values(persisted.sessions)[0].pendingQuestions, {});
      liveGeneration = await generationTwo.beginConnection();
      assert.equal(renameCalls, 1);
    } finally {
      fs.promises.rename = originalRename;
    }
    await generationTwo.close();

    const generationThree = makeService(tmp, 'waiting-generation', clock);
    assert.deepEqual(generationThree.snapshot().waiting, { approvals: 0, questions: 0 });
    liveGeneration = await generationThree.beginConnection();
    assert.deepEqual(await generationThree.ingest({
      kind: 'question-open', sessionRef: 'generation-session',
      requestRef: 'generation-question'
    }, { generation: liveGeneration }), []);
    assert.deepEqual(generationThree.snapshot().waiting, { approvals: 0, questions: 1 });
    await generationThree.close();
  });

  await check('effect 只在原子持久化成功后交付，失败事务可重试', async () => {
    const parent = path.join(tmp, 'persist-parent');
    fs.mkdirSync(parent);
    const service = createEventService({
      stateFile: path.join(parent, 'state.json'),
      now: clock.now,
      config: {
        taskNotifications: true,
        budgetEnabled: false,
        dailyTokenBudget: 100,
        priceInputPerMillion: 1,
        priceCacheReadPerMillion: 0.02,
        priceOutputPerMillion: 2,
        timeZone: 'UTC'
      }
    });
    await service.registerSession('durable-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    await service.ingest({
      kind: 'message', sessionRef: 'durable-session', seq: 0,
      turn: 1, step: 'answer', role: 'assistant'
    });
    fs.rmSync(path.join(parent, 'state.json'));
    fs.rmdirSync(parent);
    fs.writeFileSync(parent, 'blocks-directory');
    await assert.rejects(service.ingest({
      kind: 'turn-terminal', sessionRef: 'durable-session', seq: 1,
      turn: 1, reason: 'completed'
    }));
    fs.rmSync(parent);
    fs.mkdirSync(parent);
    const effects = await service.ingest({
      kind: 'turn-terminal', sessionRef: 'durable-session', seq: 1,
      turn: 1, reason: 'completed'
    });
    assert.equal(effectsOfType(effects, 'task-terminal').length, 1);
    assert.equal(service.getCursor('durable-session').lastContiguousSeq, 1);
    await service.close();
  });

  await check('subagent 抑制任务通知但完整计入 usage', async () => {
    const service = makeService(tmp, 'subagent', clock);
    await service.registerSession('child-secret', {
      origin: 'subagent', parentRef: 'parent-secret', notificationFloorSeq: -1
    });
    const effects = await service.ingestMany([
      {
        kind: 'message', sessionRef: 'child-secret', seq: 0,
        turn: 1, step: 'answer', role: 'assistant', messageRef: 'child-message',
        usageMode: 'final',
        usage: { inputTokens: 10, cacheReadTokens: 5, outputTokens: 20 }
      },
      {
        kind: 'turn-terminal', sessionRef: 'child-secret', seq: 1,
        turn: 1, reason: 'completed'
      }
    ]);
    assert.equal(effectsOfType(effects, 'task-terminal').length, 0);
    assert.equal(service.snapshot().today.tokens.total, 35);
    assert.equal(service.snapshot().today.origins.subagent, 35);
    await service.close();
  });

  await check('chunk/final 替换、reasoning 不双计、fork message 全局去重', async () => {
    const service = makeService(tmp, 'usage', clock);
    await service.registerSession('usage-root', { origin: 'user', notificationFloorSeq: -1 });
    await service.ingestMany([
      {
        kind: 'message', sessionRef: 'usage-root', seq: 0,
        turn: 1, step: 'answer', role: 'assistant', usageMode: 'chunk',
        usage: { inputTokens: 5, cacheReadTokens: 1, outputTokens: 7, reasoningTokens: 500 }
      },
      {
        kind: 'message', sessionRef: 'usage-root', seq: 1,
        turn: 1, step: 'answer', role: 'assistant', messageRef: 'shared-final-message',
        usageMode: 'final',
        usage: { inputTokens: 20, cacheReadTokens: 5, outputTokens: 30, reasoningTokens: 999 }
      }
    ]);
    await service.registerSession('usage-child', {
      origin: 'subagent', parentRef: 'usage-root', notificationFloorSeq: -1
    });
    await service.ingest({
      kind: 'message', sessionRef: 'usage-child', seq: 0,
      turn: 1, step: 'forked-answer', role: 'assistant', messageRef: 'shared-final-message',
      usageMode: 'final',
      usage: { inputTokens: 20, cacheReadTokens: 5, outputTokens: 30, reasoningTokens: 999 }
    });
    const today = service.snapshot().today;
    assert.deepEqual(today.tokens, {
      input: 20, cacheRead: 5, output: 30, total: 55
    });
    assert.equal(today.estimatedCost, 0.0000801);
    await service.close();
  });

  await check('今日/周一周按注入时区计算，价格 configure 后重新估算', async () => {
    const dateClock = makeClock('2026-08-19T12:00:00.000Z');
    const service = makeService(tmp, 'calendar', dateClock);
    await service.registerSession('monday', { origin: 'user', notificationFloorSeq: -1 });
    await service.ingest({
      kind: 'message', sessionRef: 'monday', seq: 0, turn: 1, step: 'one',
      role: 'assistant', usageMode: 'final', messageRef: 'monday-message',
      usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 },
      at: '2026-08-17T12:00:00.000Z'
    });
    await service.registerSession('sunday', { origin: 'user', notificationFloorSeq: -1 });
    await service.ingest({
      kind: 'message', sessionRef: 'sunday', seq: 0, turn: 1, step: 'one',
      role: 'assistant', usageMode: 'final', messageRef: 'sunday-message',
      usage: { inputTokens: 20, cacheReadTokens: 0, outputTokens: 0 },
      at: '2026-08-16T12:00:00.000Z'
    });
    await service.registerSession('today', { origin: 'user', notificationFloorSeq: -1 });
    await service.ingest({
      kind: 'message', sessionRef: 'today', seq: 0, turn: 1, step: 'one',
      role: 'assistant', usageMode: 'final', messageRef: 'today-message',
      usage: { inputTokens: 5, cacheReadTokens: 0, outputTokens: 0 }
    });
    let view = service.snapshot();
    assert.equal(view.today.date, '2026-08-19');
    assert.equal(view.today.tokens.total, 5);
    assert.equal(view.week.startDate, '2026-08-17');
    assert.equal(view.week.tokens.total, 15);
    await service.configure({ priceInputPerMillion: 2 });
    view = service.snapshot();
    assert.equal(view.today.estimatedCost, 0.00001);
    assert.equal(view.week.estimatedCost, 0.00003);
    await service.close();
  });

  await check('预算 disabled/cross/latch/resume/次日均为持久软熔断', async () => {
    const budgetClock = makeClock('2026-08-19T10:00:00.000Z');
    const service = makeService(tmp, 'budget', budgetClock, {
      budgetEnabled: false,
      dailyTokenBudget: 100
    });
    await service.registerSession('budget-a', { origin: 'user', notificationFloorSeq: -1 });
    let effects = await service.ingest({
      kind: 'message', sessionRef: 'budget-a', seq: 0, turn: 1, step: 'one',
      role: 'assistant', usageMode: 'final', messageRef: 'budget-one',
      usage: { inputTokens: 120, cacheReadTokens: 0, outputTokens: 0 }
    });
    assert.equal(effectsOfType(effects, 'budget-crossed').length, 0);
    effects = await service.configure({ budgetEnabled: true });
    const crossed = effectsOfType(effects, 'budget-crossed');
    assert.equal(crossed.length, 1);
    assert.equal(crossed[0].requiresSpawnedByUs, true);
    assert.equal(crossed[0].sessionRef, null);
    assert.equal(service.snapshot().budget.paused, true);
    assert.equal(effectsOfType(await service.configure({ budgetEnabled: true }), 'budget-crossed').length, 0);
    effects = await service.resumeBudget();
    assert.equal(effectsOfType(effects, 'budget-resumed').length, 1);
    assert.equal(service.snapshot().budget.paused, false);
    await service.registerSession('budget-b', { origin: 'user', notificationFloorSeq: -1 });
    effects = await service.ingest({
      kind: 'message', sessionRef: 'budget-b', seq: 0, turn: 1, step: 'two',
      role: 'assistant', usageMode: 'final', messageRef: 'budget-two',
      usage: { inputTokens: 100, cacheReadTokens: 0, outputTokens: 0 }
    });
    assert.equal(effectsOfType(effects, 'budget-crossed').length, 0);

    budgetClock.set('2026-08-20T10:00:00.000Z');
    await service.registerSession('budget-next', { origin: 'user', notificationFloorSeq: -1 });
    effects = await service.ingest({
      kind: 'message', sessionRef: 'budget-next', seq: 0, turn: 1, step: 'next',
      role: 'assistant', usageMode: 'final', messageRef: 'budget-next-message',
      usage: { inputTokens: 100, cacheReadTokens: 0, outputTokens: 0 }
    });
    assert.equal(effectsOfType(effects, 'budget-crossed').length, 1);
    assert.equal(service.snapshot().budget.date, '2026-08-20');
    assert.equal(service.snapshot().budget.paused, true);
    await service.close();
  });

  await check('floor 未确认时序列事件暂存，subscribed 后历史回放且不通知', async () => {
    const service = makeService(tmp, 'unset-floor', clock);
    await service.registerSession('unset-floor-session', { origin: 'user' });
    const effects = await service.ingestMany([
      {
        kind: 'message', sessionRef: 'unset-floor-session', seq: 0,
        turn: 1, step: 'answer', role: 'assistant'
      },
      {
        kind: 'turn-terminal', sessionRef: 'unset-floor-session', seq: 1,
        turn: 1, reason: 'completed'
      },
      {
        kind: 'approval-open', sessionRef: 'unset-floor-session', requestRef: 'approval-before-floor'
      }
    ]);
    assert.equal(effects.length, 0);
    assert.equal(service.getCursor('unset-floor-session').lastContiguousSeq, -1);
    assert.equal(service.snapshot().recentTasks.length, 0);
    assert.equal(service.snapshot().coverage.status, 'gap');
    const replayEffects = await service.ingest({
      kind: 'subscribed', sessionRef: 'unset-floor-session', lastSeq: 1
    });
    assert.equal(replayEffects.length, 0);
    assert.equal(service.getCursor('unset-floor-session').lastContiguousSeq, 1);
    assert.equal(service.snapshot().recentTasks[0].result, 'completed');
    assert.deepEqual(service.snapshot().waiting, { approvals: 1, questions: 0 });
    await service.close();
  });

  await check('unknown 不覆盖 subagent，fallback 只在 lineage 内去重且归属不迁移', async () => {
    const service = makeService(tmp, 'origin-fork', clock);
    await service.registerSession('fork-parent', {
      origin: 'user', notificationFloorSeq: -1
    });
    await service.registerSession('fork-child', {
      origin: 'subagent', parentRef: 'fork-parent', notificationFloorSeq: -1
    });
    await service.registerSession('fork-child', { origin: 'unknown' });
    assert.equal(service.getCursor('fork-child').origin, 'subagent');
    const sameAt = '2026-08-19T12:01:00.000Z';
    await service.ingest({
      kind: 'message', sessionRef: 'fork-parent', origin: 'unknown', seq: 0,
      turn: 1, step: 1, role: 'other', usageMode: 'final', at: sameAt,
      usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 }
    });
    await service.registerSession('independent-root', {
      origin: 'user', notificationFloorSeq: -1
    });
    await service.ingest({
      kind: 'message', sessionRef: 'independent-root', seq: 0,
      turn: 1, step: 1, role: 'other', usageMode: 'final', at: sameAt,
      usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 }
    });
    await service.ingest({
      kind: 'message', sessionRef: 'fork-child', origin: 'unknown', seq: 0,
      turn: 1, step: 1, role: 'other', usageMode: 'final', at: sameAt,
      usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 }
    });
    await service.ingest({
      kind: 'message', sessionRef: 'fork-parent', seq: 1,
      turn: 2, step: 1, role: 'other', messageRef: 'shared-upgrade',
      usageMode: 'chunk', usage: { inputTokens: 5, cacheReadTokens: 0, outputTokens: 0 }
    });
    await service.ingest({
      kind: 'message', sessionRef: 'fork-child', origin: 'unknown', seq: 1,
      turn: 2, step: 1, role: 'assistant', messageRef: 'shared-upgrade',
      usageMode: 'final', usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 }
    });
    const view = service.snapshot();
    assert.equal(view.today.tokens.total, 30);
    assert.equal(view.today.origins.user, 30);
    assert.equal(view.today.origins.subagent, 0);
    assert.equal(service.getCursor('fork-child').origin, 'subagent');
    await service.close();
  });

  await check('事务未提交时读者只见 committed state，chmod/rename 失败可原位重试', async () => {
    const service = makeService(tmp, 'transaction-visibility', clock);
    const stateFile = path.join(tmp, 'transaction-visibility.json');
    await service.registerSession('transaction-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    await service.ingest({
      kind: 'message', sessionRef: 'transaction-session', seq: 0,
      turn: 1, step: 1, role: 'assistant'
    });

    const originalRename = fs.promises.rename;
    let releaseRename;
    let renameEntered;
    const entered = new Promise((resolve) => { renameEntered = resolve; });
    const release = new Promise((resolve) => { releaseRename = resolve; });
    fs.promises.rename = async () => {
      renameEntered();
      await release;
      throw new Error('rename-injected');
    };
    const pending = service.ingest({
      kind: 'turn-terminal', sessionRef: 'transaction-session', seq: 1,
      turn: 1, reason: 'completed'
    });
    await entered;
    assert.equal(service.getCursor('transaction-session').lastContiguousSeq, 0);
    assert.equal(service.snapshot().recentTasks.length, 0);
    releaseRename();
    await assert.rejects(pending, /rename-injected/);
    fs.promises.rename = originalRename;
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions[
      Object.keys(JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions)[0]
    ].lastContiguousSeq, 0);

    const originalChmod = fs.promises.chmod;
    fs.promises.chmod = async () => { throw new Error('chmod-injected'); };
    await assert.rejects(service.ingest({
      kind: 'turn-terminal', sessionRef: 'transaction-session', seq: 1,
      turn: 1, reason: 'completed'
    }), /chmod-injected/);
    fs.promises.chmod = originalChmod;
    assert.equal(service.getCursor('transaction-session').lastContiguousSeq, 0);
    const effects = await service.ingest({
      kind: 'turn-terminal', sessionRef: 'transaction-session', seq: 1,
      turn: 1, reason: 'completed'
    });
    assert.equal(effectsOfType(effects, 'task-terminal').length, 1);
    await service.close();
  });

  await check('连接 generation 拒绝断线旧帧并保护新连接', async () => {
    const service = makeService(tmp, 'generation-fence', clock);
    await service.registerSession('generation-fence-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    const first = await service.beginConnection();
    await service.setAvailability('live', 'ready', first);
    await service.ingest({
      kind: 'projection', sessionRef: 'generation-fence-session', seq: 0
    }, { generation: first });
    await service.disconnect(first);
    await assert.rejects(
      service.disconnect(),
      (error) => error.code === 'ERR_EVENT_GENERATION'
    );
    await assert.rejects(service.ingest({
      kind: 'approval-open', sessionRef: 'generation-fence-session', requestRef: 'late-old-frame'
    }, { generation: first }), (error) => error.code === 'ERR_EVENT_GENERATION');
    const second = await service.beginConnection();
    await service.setAvailability('live', 'ready', second);
    await assert.rejects(
      service.disconnect(first),
      (error) => error.code === 'ERR_EVENT_GENERATION'
    );
    await assert.rejects(
      service.setAvailability('disconnected', 'closed'),
      (error) => error.code === 'ERR_EVENT_GENERATION'
    );
    await assert.rejects(
      service.setAvailability('unavailable', 'transport-error', first),
      (error) => error.code === 'ERR_EVENT_GENERATION'
    );
    assert.equal(service.snapshot().availability.state, 'live');
    const effects = await service.ingest({
      kind: 'approval-open', sessionRef: 'generation-fence-session', requestRef: 'new-frame'
    }, { generation: second });
    assert.equal(effectsOfType(effects, 'waiting-human').length, 1);
    await service.close();
  });

  await check('失败 ingest 后 lifecycle 按队列提交且新 generation 不被回滚', async () => {
    const service = makeService(tmp, 'generation-serial', clock);
    await service.registerSession('generation-serial-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    const first = await service.beginConnection();
    await service.setAvailability('live', 'ready', first);
    const originalRename = fs.promises.rename;
    try {
      fs.promises.rename = async () => { throw new Error('ingest-availability-injected'); };
      const failingAvailability = service.ingest({
        kind: 'projection', sessionRef: 'generation-serial-session', seq: 0
      }, { generation: first });
      const queuedAvailability = service.setAvailability(
        'backfilling', 'history-gap', first
      );
      await assert.rejects(failingAvailability, /ingest-availability-injected/);
      await queuedAvailability;
      assert.deepEqual(service.snapshot().availability, {
        state: 'backfilling', detail: 'history-gap'
      });
      assert.equal(service.getCursor('generation-serial-session').lastContiguousSeq, -1);

      fs.promises.rename = async () => { throw new Error('ingest-generation-injected'); };
      const failingGeneration = service.ingest({
        kind: 'projection', sessionRef: 'generation-serial-session', seq: 0
      }, { generation: first });
      const secondPromise = service.beginConnection();
      await assert.rejects(failingGeneration, /ingest-generation-injected/);
      const second = await secondPromise;
      assert.ok(second > first);
      assert.deepEqual(service.snapshot().availability, { state: 'probing', detail: null });
      fs.promises.rename = originalRename;
      await assert.rejects(
        service.ingest({
          kind: 'projection', sessionRef: 'generation-serial-session', seq: 0
        }, { generation: first }),
        (error) => error.code === 'ERR_EVENT_GENERATION'
      );
      await service.setAvailability('live', 'ready', second);
      await service.ingest({
        kind: 'projection', sessionRef: 'generation-serial-session', seq: 0
      }, { generation: second });
      assert.equal(service.getCursor('generation-serial-session').lastContiguousSeq, 0);
    } finally {
      fs.promises.rename = originalRename;
    }
    await service.close();
  });

  await check('disconnect 失败全量回滚；disconnect→begin 并发不丢 pending 清理', async () => {
    const service = makeService(tmp, 'disconnect-atomic', clock);
    await service.registerSession('disconnect-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    const first = await service.beginConnection();
    await service.setAvailability('live', 'ready', first);
    await service.ingest({
      kind: 'approval-open', sessionRef: 'disconnect-session', requestRef: 'pending-before-disconnect'
    }, { generation: first });
    assert.deepEqual(service.snapshot().waiting, { approvals: 1, questions: 0 });

    const originalRename = fs.promises.rename;
    fs.promises.rename = async () => { throw new Error('disconnect-injected'); };
    try {
      await assert.rejects(service.disconnect(first), /disconnect-injected/);
    } finally {
      fs.promises.rename = originalRename;
    }
    assert.deepEqual(service.snapshot().availability, { state: 'live', detail: 'ready' });
    assert.deepEqual(service.snapshot().waiting, { approvals: 1, questions: 0 });
    await service.setAvailability('backfilling', 'history-gap', first);

    const disconnectPromise = service.disconnect(first);
    const secondPromise = service.beginConnection();
    await disconnectPromise;
    const second = await secondPromise;
    assert.ok(second > first);
    assert.deepEqual(service.snapshot().waiting, { approvals: 0, questions: 0 });
    assert.deepEqual(service.snapshot().availability, { state: 'probing', detail: null });
    await service.setAvailability('live', 'ready', second);
    await service.close();
  });

  await check('损坏 schema1 有界备份并新建基线，未来 schema 保持 fail-closed', async () => {
    const corruptPath = path.join(tmp, 'corrupt-state.json');
    const recoverySecret = '{not-json-RECOVERY-SECRET';
    fs.writeFileSync(corruptPath, recoverySecret);
    fs.chmodSync(corruptPath, 0o644);
    const recovered = createEventService({ stateFile: corruptPath, now: clock.now });
    assert.deepEqual(recovered.snapshot().availability, {
      state: 'probing', detail: 'state-recovered'
    });
    const corruptBackup = fs.readdirSync(tmp)
      .find((name) => name.startsWith('corrupt-state.json.corrupt-'));
    assert.ok(corruptBackup);
    assertPrivateMode(path.join(tmp, corruptBackup));
    assert.equal(fs.readFileSync(path.join(tmp, corruptBackup), 'utf8'), recoverySecret);
    assert.equal(recovered.getCursor('old-session').notificationFloorSeq, null);
    await recovered.close();

    const chmodFailurePath = path.join(tmp, 'chmod-failure-state.json');
    fs.writeFileSync(chmodFailurePath, '{not-json-CHMOD-SECRET');
    fs.chmodSync(chmodFailurePath, 0o644);
    const originalChmodSync = fs.chmodSync;
    fs.chmodSync = (target, mode) => {
      if (path.resolve(target) === path.resolve(chmodFailurePath)) {
        throw new Error('recovery-chmod-injected');
      }
      return originalChmodSync(target, mode);
    };
    try {
      assert.throws(
        () => createEventService({ stateFile: chmodFailurePath, now: clock.now }),
        /recovery-chmod-injected/
      );
    } finally {
      fs.chmodSync = originalChmodSync;
    }
    assert.equal(fs.existsSync(chmodFailurePath), true);
    assert.equal(fs.readdirSync(tmp)
      .some((name) => name.startsWith('chmod-failure-state.json.corrupt-')), false);

    const partialPath = path.join(tmp, 'partial-corrupt-state.json');
    const seeded = createEventService({ stateFile: partialPath, now: clock.now });
    await seeded.registerSession('partial-old-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    await seeded.ingestMany([
      {
        kind: 'message', sessionRef: 'partial-old-session', seq: 0,
        turn: 1, step: 1, role: 'assistant'
      },
      {
        kind: 'turn-terminal', sessionRef: 'partial-old-session', seq: 1,
        turn: 1, reason: 'completed'
      }
    ]);
    await seeded.close();
    const partial = JSON.parse(fs.readFileSync(partialPath, 'utf8'));
    const ledgerKey = Object.keys(partial.notificationLedger)[0];
    partial.notificationLedger[ledgerKey] = { invalid: true };
    const corruptSerialized = `${JSON.stringify(partial, null, 2)}\n`;
    fs.writeFileSync(partialPath, corruptSerialized);
    const partialRecovered = createEventService({ stateFile: partialPath, now: clock.now });
    assert.deepEqual(partialRecovered.snapshot().availability, {
      state: 'probing', detail: 'state-recovered'
    });
    assert.equal(partialRecovered.getCursor('partial-old-session').known, false);
    const partialBackup = fs.readdirSync(tmp)
      .find((name) => name.startsWith('partial-corrupt-state.json.corrupt-'));
    assert.ok(partialBackup);
    assert.equal(fs.readFileSync(path.join(tmp, partialBackup), 'utf8'), corruptSerialized);
    await partialRecovered.close();

    const futurePath = path.join(tmp, 'future-state.json');
    fs.writeFileSync(futurePath, JSON.stringify({ schemaVersion: 999, salt: 'A'.repeat(64) }));
    assert.throws(
      () => createEventService({ stateFile: futurePath, now: clock.now }),
      (error) => error.code === 'ERR_EVENT_STATE_SCHEMA'
    );
    assert.equal(fs.existsSync(futurePath), true);
  });

  await check('时区切换按 UTC at 重新分桶，预算下限严格为 1', async () => {
    const zoneClock = makeClock('2026-08-19T00:30:00.000Z');
    assert.throws(
      () => makeService(tmp, 'invalid-zero-budget', zoneClock, { dailyTokenBudget: 0 }),
      (error) => error.code === 'ERR_EVENT_CONFIG'
    );
    const service = makeService(tmp, 'timezone-rebucket', zoneClock, {
      timeZone: 'UTC', dailyTokenBudget: 1, budgetEnabled: false
    });
    await service.registerSession('zone-session', { origin: 'user', notificationFloorSeq: -1 });
    await service.ingest({
      kind: 'message', sessionRef: 'zone-session', seq: 0,
      turn: 1, step: 1, role: 'assistant', messageRef: 'zone-message',
      usageMode: 'final', usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 0 },
      at: '2026-08-19T00:15:00.000Z'
    });
    assert.equal(service.snapshot().today.tokens.total, 10);
    await service.configure({ timeZone: 'America/Los_Angeles' });
    assert.equal(service.snapshot().today.date, '2026-08-18');
    assert.equal(service.snapshot().today.tokens.total, 10);
    await assert.rejects(
      service.configure({ dailyTokenBudget: 0 }),
      (error) => error.code === 'ERR_EVENT_CONFIG'
    );
    const effects = await service.configure({ budgetEnabled: true });
    assert.equal(effectsOfType(effects, 'budget-crossed').length, 1);
    await service.close();
  });

  await check('gap 缓冲与 availability detail 均有界且不伪报完整覆盖', async () => {
    const service = makeService(tmp, 'bounded-gap', clock);
    await service.registerSession('bounded-gap-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    assert.equal(service.snapshot().coverage.status, 'partial');
    const generation = await service.beginConnection();
    await service.setAvailability('live', 'history-gap', generation);
    assert.equal(service.snapshot().coverage.status, 'gap');
    assert.equal(service.snapshot().coverage.gapSessions, 0);
    const events = [];
    for (let seq = 2; seq <= 10002; seq += 1) {
      events.push({ kind: 'projection', sessionRef: 'bounded-gap-session', seq });
    }
    await assert.rejects(
      service.ingestMany(events, { generation }),
      (error) => error.code === 'ERR_EVENT_BUFFER_LIMIT'
    );
    assert.equal(service.snapshot().coverage.gapSessions, 0);
    await assert.rejects(
      service.setAvailability(
        'unavailable', '/Users/private/raw-session-token', generation
      ),
      (error) => error.code === 'ERR_EVENT_INPUT'
    );
    await service.close();
  });

  await check('delivery 精确回执走 submitting→queued→running↔waiting→completed', async () => {
    const localClock = makeClock('2026-08-23T10:00:00.000Z');
    const service = makeService(tmp, 'delivery-happy', localClock);
    await service.registerSession('receipt-session-secret', {
      origin: 'user', notificationFloorSeq: -1
    });
    const generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    const aggregateKeys = Object.keys(service.snapshot()).sort();

    assert.equal(service.registerDelivery({
      deliveryRef: 'delivery-happy-secret',
      sessionRef: 'receipt-session-secret',
      at: '2026-08-23T10:00:01.000Z'
    }).state, 'submitting');
    assert.equal(service.settleDeliveryAdmission({
      deliveryRef: 'delivery-happy-secret', state: 'accepted',
      at: '2026-08-23T10:00:02.000Z'
    }).state, 'queued');
    await service.ingest({
      kind: 'turn-start', sessionRef: 'receipt-session-secret', seq: 0, turn: 7,
      origin: 'user', at: '2026-08-23T10:00:03.000Z'
    }, { generation });
    await service.ingest({
      kind: 'message', sessionRef: 'receipt-session-secret', seq: 1, turn: 7,
      role: 'user', deliveryRef: 'delivery-happy-secret',
      at: '2026-08-23T10:00:04.000Z'
    }, { generation });
    let receipt = service.deliverySnapshot('delivery-happy-secret');
    assert.equal(receipt.state, 'running');
    assert.equal(receipt.startedAt, '2026-08-23T10:00:03.000Z');
    assert.equal(receipt.turn, 7);
    assert.deepEqual(Object.keys(receipt).sort(), [
      'finishedAt', 'placement', 'queuedAt', 'reason', 'result',
      'startedAt', 'state', 'submittedAt', 'turn', 'updatedAt'
    ].sort());
    assert.equal(JSON.stringify(receipt).includes('delivery-happy-secret'), false);
    assert.equal(Object.hasOwn(receipt, 'deliveryRef'), false);
    assert.equal(Object.hasOwn(receipt, 'sessionRef'), false);
    assert.equal(Object.hasOwn(receipt, 'taskKey'), false);

    await service.ingest({
      kind: 'approval-open', sessionRef: 'receipt-session-secret',
      requestRef: 'delivery-approval-secret'
    }, { generation });
    assert.equal(service.deliverySnapshot('delivery-happy-secret').state, 'waiting');
    await service.ingest({
      kind: 'question-open', sessionRef: 'receipt-session-secret',
      requestRef: 'delivery-question-secret'
    }, { generation });
    await service.ingest({
      kind: 'approval-close', sessionRef: 'receipt-session-secret',
      requestRef: 'delivery-approval-secret'
    }, { generation });
    assert.equal(service.deliverySnapshot('delivery-happy-secret').state, 'waiting');
    await service.ingest({
      kind: 'question-close', sessionRef: 'receipt-session-secret',
      requestRef: 'delivery-question-secret'
    }, { generation });
    assert.equal(service.deliverySnapshot('delivery-happy-secret').state, 'running');

    await service.ingest({
      kind: 'message', sessionRef: 'receipt-session-secret', seq: 2, turn: 7,
      role: 'assistant', at: '2026-08-23T10:00:05.000Z'
    }, { generation });
    await service.ingest({
      kind: 'turn-terminal', sessionRef: 'receipt-session-secret', seq: 3, turn: 7,
      reason: 'completed', at: '2026-08-23T10:00:06.000Z'
    }, { generation });
    receipt = service.deliverySnapshot('delivery-happy-secret');
    assert.equal(receipt.state, 'completed');
    assert.equal(receipt.result, 'completed');
    assert.equal(receipt.finishedAt, '2026-08-23T10:00:06.000Z');
    assert.equal(service.snapshot().recentTasks[0].durationMs, 3000);

    // 终态单调：迟到 admission 和 queue 不得倒退。
    service.settleDeliveryAdmission({
      deliveryRef: 'delivery-happy-secret', state: 'accepted',
      at: '2026-08-23T10:00:07.000Z'
    });
    service.observeDeliveryQueue({
      kind: 'queue-snapshot', sessionRef: 'receipt-session-secret',
      observedAt: '2026-08-23T10:00:08.000Z',
      items: [{ deliveryRef: 'delivery-happy-secret', placement: 0 }]
    });
    assert.equal(service.deliverySnapshot('delivery-happy-secret').state, 'completed');
    assert.deepEqual(Object.keys(service.snapshot()).sort(), aggregateKeys);
    assert.equal(JSON.stringify(service.snapshot()).includes('delivery-happy-secret'), false);
    await service.close();
  });

  await check('delivery admission/queue 竞态幂等，缺席、错 session 与外部 id 不扩容', async () => {
    const localClock = makeClock('2026-08-23T11:00:00.000Z');
    const service = makeService(tmp, 'delivery-admission', localClock);
    await service.registerSession('delivery-session-a', {
      origin: 'user', notificationFloorSeq: -1
    });
    await service.registerSession('delivery-session-b', {
      origin: 'user', notificationFloorSeq: -1
    });
    const generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    service.registerDelivery({ deliveryRef: 'delivery-admission-a', sessionRef: 'delivery-session-a' });
    const unknownAdmission = service.settleDeliveryAdmission({
      deliveryRef: 'delivery-admission-a', state: 'unknown', reason: 'transport-unknown'
    });
    assert.equal(unknownAdmission.state, 'unknown');
    assert.equal(unknownAdmission.reason, 'admission-unknown');
    assert.equal(JSON.stringify(unknownAdmission).includes('transport-unknown'), false);
    assert.equal(service.observeDeliveryQueue({
      kind: 'queue-snapshot', sessionRef: 'delivery-session-a', items: []
    }).observed, 0);
    assert.equal(service.deliverySnapshot('delivery-admission-a').state, 'unknown');
    assert.equal(service.observeDeliveryQueue({
      kind: 'queue-snapshot', sessionRef: 'delivery-session-b',
      items: [{ deliveryRef: 'delivery-admission-a', placement: 3 }]
    }).observed, 0);
    assert.equal(service.deliverySnapshot('delivery-admission-a').state, 'unknown');
    assert.equal(service.observeDeliveryQueue({
      kind: 'queue-snapshot', sessionRef: 'delivery-session-a',
      items: [
        { deliveryRef: 'external-delivery-secret', placement: 1 },
        { deliveryRef: 'delivery-admission-a', placement: { raw: 'ignore' } }
      ]
    }).observed, 1);
    assert.equal(service.deliverySnapshot('external-delivery-secret').reason, 'not-tracked');
    assert.equal(service.deliverySnapshot('delivery-admission-a').state, 'queued');
    assert.equal(service.deliverySnapshot('delivery-admission-a').placement, null);
    assert.equal(service.settleDeliveryAdmission({
      deliveryRef: 'delivery-admission-a', state: 'rejected', reason: 'late-reject'
    }).state, 'queued');

    service.registerDelivery({ deliveryRef: 'delivery-rejected', sessionRef: 'delivery-session-a' });
    let rejected = service.settleDeliveryAdmission({
      deliveryRef: 'delivery-rejected', state: 'rejected', reason: 'policy-rejected'
    });
    assert.equal(rejected.state, 'error');
    assert.equal(rejected.result, 'rejected');
    assert.equal(rejected.reason, 'admission-rejected');
    assert.equal(JSON.stringify(rejected).includes('policy-rejected'), false);
    service.settleDeliveryAdmission({ deliveryRef: 'delivery-rejected', state: 'accepted' });
    service.observeDeliveryQueue({
      kind: 'queue-snapshot', sessionRef: 'delivery-session-a',
      items: [{ deliveryRef: 'delivery-rejected', placement: 'front' }]
    });
    rejected = service.deliverySnapshot('delivery-rejected');
    assert.equal(rejected.state, 'error');
    assert.equal(rejected.result, 'rejected');

    service.registerDelivery({ deliveryRef: 'delivery-ingested-queue', sessionRef: 'delivery-session-a' });
    await service.ingest({
      kind: 'queue-snapshot', sessionRef: 'delivery-session-a',
      items: [{ deliveryRef: 'delivery-ingested-queue', placement: 'pending' }]
    }, { generation });
    assert.equal(service.deliverySnapshot('delivery-ingested-queue').state, 'queued');
    await assert.rejects(service.ingest({
      kind: 'queue-snapshot', sessionRef: 'delivery-session-a', seq: 9, items: []
    }, { generation }), /queue snapshot 不得带 seq/);
    await service.close();
  });

  await check('delivery 只绑定同 session 的唯一 turn，双活动投递不猜 waiting', async () => {
    const localClock = makeClock('2026-08-23T12:00:00.000Z');
    const service = makeService(tmp, 'delivery-binding', localClock);
    for (const sessionRef of ['binding-session', 'wrong-binding-session']) {
      await service.registerSession(sessionRef, { origin: 'user', notificationFloorSeq: -1 });
    }
    const generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    for (const deliveryRef of ['binding-delivery-a', 'binding-delivery-b']) {
      service.registerDelivery({ deliveryRef, sessionRef: 'binding-session' });
      service.settleDeliveryAdmission({ deliveryRef, state: 'accepted' });
    }
    service.registerDelivery({
      deliveryRef: 'wrong-binding-delivery', sessionRef: 'binding-session'
    });
    service.settleDeliveryAdmission({ deliveryRef: 'wrong-binding-delivery', state: 'accepted' });

    await service.ingestMany([
      { kind: 'turn-start', sessionRef: 'binding-session', seq: 0, turn: 1 },
      {
        kind: 'message', sessionRef: 'binding-session', seq: 1, turn: 1,
        role: 'user', deliveryRef: 'binding-delivery-a'
      },
      {
        kind: 'message', sessionRef: 'binding-session', seq: 2, turn: 1,
        role: 'user', deliveryRef: 'binding-delivery-b'
      }
    ], { generation });
    assert.equal(service.deliverySnapshot('binding-delivery-a').state, 'running');
    assert.equal(service.deliverySnapshot('binding-delivery-b').state, 'queued');
    await service.ingest({
      kind: 'approval-open', sessionRef: 'binding-session', requestRef: 'binding-approval'
    }, { generation });
    assert.equal(service.deliverySnapshot('binding-delivery-a').state, 'waiting');
    await service.ingest({
      kind: 'approval-close', sessionRef: 'binding-session', requestRef: 'binding-approval'
    }, { generation });

    await service.ingestMany([
      { kind: 'turn-start', sessionRef: 'binding-session', seq: 3, turn: 2 },
      {
        kind: 'message', sessionRef: 'binding-session', seq: 4, turn: 2,
        role: 'user', deliveryRef: 'binding-delivery-b'
      }
    ], { generation });
    await service.ingest({
      kind: 'question-open', sessionRef: 'binding-session', requestRef: 'ambiguous-question'
    }, { generation });
    assert.equal(service.deliverySnapshot('binding-delivery-a').state, 'running');
    assert.equal(service.deliverySnapshot('binding-delivery-b').state, 'running');

    await service.ingestMany([
      {
        kind: 'message', sessionRef: 'binding-session', seq: 5, turn: 1,
        role: 'assistant'
      },
      {
        kind: 'turn-terminal', sessionRef: 'binding-session', seq: 6, turn: 1,
        reason: 'completed'
      }
    ], { generation });
    assert.equal(service.deliverySnapshot('binding-delivery-a').state, 'completed');
    assert.equal(service.deliverySnapshot('binding-delivery-b').state, 'waiting');
    await service.ingest({
      kind: 'question-close', sessionRef: 'binding-session', requestRef: 'ambiguous-question'
    }, { generation });
    assert.equal(service.deliverySnapshot('binding-delivery-b').state, 'running');

    await service.ingestMany([
      { kind: 'turn-start', sessionRef: 'wrong-binding-session', seq: 0, turn: 1 },
      {
        kind: 'message', sessionRef: 'wrong-binding-session', seq: 1, turn: 1,
        role: 'user', deliveryRef: 'wrong-binding-delivery'
      }
    ], { generation });
    assert.equal(service.deliverySnapshot('wrong-binding-delivery').state, 'queued');
    await service.close();
  });

  await check('delivery 在断线和本 session gap 时投影 unknown，恢复后回读且终态不倒退', async () => {
    const localClock = makeClock('2026-08-23T13:00:00.000Z');
    const service = makeService(tmp, 'delivery-coverage', localClock);
    await service.registerSession('coverage-session', {
      origin: 'user', notificationFloorSeq: -1
    });
    let generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    service.registerDelivery({ deliveryRef: 'coverage-delivery', sessionRef: 'coverage-session' });
    service.settleDeliveryAdmission({ deliveryRef: 'coverage-delivery', state: 'accepted' });
    await service.ingestMany([
      { kind: 'turn-start', sessionRef: 'coverage-session', seq: 0, turn: 1 },
      {
        kind: 'message', sessionRef: 'coverage-session', seq: 1, turn: 1,
        role: 'user', deliveryRef: 'coverage-delivery'
      }
    ], { generation });
    assert.equal(service.deliverySnapshot('coverage-delivery').state, 'running');
    await service.ingest({
      kind: 'projection', sessionRef: 'coverage-session', seq: 3
    }, { generation });
    assert.deepEqual(
      [service.deliverySnapshot('coverage-delivery').state,
        service.deliverySnapshot('coverage-delivery').reason],
      ['unknown', 'session-sequence-gap']
    );
    await service.ingest({
      kind: 'projection', sessionRef: 'coverage-session', seq: 2
    }, { generation });
    assert.equal(service.deliverySnapshot('coverage-delivery').state, 'running');
    await service.setAvailability('backfilling', 'history-gap', generation);
    assert.equal(service.deliverySnapshot('coverage-delivery').state, 'unknown');
    await service.setAvailability('live', 'history-gap', generation);
    assert.equal(service.deliverySnapshot('coverage-delivery').reason, 'history-gap');
    await service.setAvailability('live', 'ready', generation);
    assert.equal(service.deliverySnapshot('coverage-delivery').state, 'running');
    await service.ingestMany([
      {
        kind: 'message', sessionRef: 'coverage-session', seq: 4, turn: 1,
        role: 'assistant'
      },
      {
        kind: 'turn-terminal', sessionRef: 'coverage-session', seq: 5, turn: 1,
        reason: 'completed'
      }
    ], { generation });
    assert.equal(service.deliverySnapshot('coverage-delivery').state, 'completed');
    await service.disconnect(generation);
    assert.equal(service.deliverySnapshot('coverage-delivery').state, 'completed');

    generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    service.registerDelivery({ deliveryRef: 'coverage-incomplete', sessionRef: 'coverage-session' });
    service.settleDeliveryAdmission({ deliveryRef: 'coverage-incomplete', state: 'accepted' });
    await service.ingestMany([
      { kind: 'turn-start', sessionRef: 'coverage-session', seq: 6, turn: 2 },
      {
        kind: 'message', sessionRef: 'coverage-session', seq: 7, turn: 2,
        role: 'user', deliveryRef: 'coverage-incomplete'
      },
      {
        kind: 'turn-terminal', sessionRef: 'coverage-session', seq: 8, turn: 2,
        reason: 'completed'
      }
    ], { generation });
    const incomplete = service.deliverySnapshot('coverage-incomplete');
    assert.equal(incomplete.state, 'error');
    assert.equal(incomplete.result, 'incomplete');
    await service.close();
  });

  await check('delivery tracker 有 TTL/容量上限，不持久化原始 id 或正文', async () => {
    const localClock = makeClock('2026-08-23T14:00:00.000Z');
    const service = makeService(tmp, 'delivery-bounded', localClock);
    await service.registerSession('bounded-delivery-session-secret', {
      origin: 'user', notificationFloorSeq: -1
    });
    let generation = await service.beginConnection();
    await service.setAvailability('live', 'ready', generation);
    service.registerDelivery({
      deliveryRef: 'ttl-delivery-secret', sessionRef: 'bounded-delivery-session-secret'
    });
    await service.flush();
    let serialized = fs.readFileSync(path.join(tmp, 'delivery-bounded.json'), 'utf8');
    assert.equal(serialized.includes('ttl-delivery-secret'), false);
    assert.equal(serialized.includes('deliveryTracker'), false);
    assert.equal(JSON.stringify(service.snapshot()).includes('ttl-delivery-secret'), false);
    localClock.set('2026-08-24T14:00:00.001Z');
    assert.equal(service.deliverySnapshot('ttl-delivery-secret').reason, 'not-tracked');

    for (let index = 0; index <= 1000; index += 1) {
      service.registerDelivery({
        deliveryRef: `capacity-delivery-secret-${index}`,
        sessionRef: 'bounded-delivery-session-secret'
      });
    }
    assert.equal(service.deliverySnapshot('capacity-delivery-secret-0').reason, 'not-tracked');
    assert.equal(service.deliverySnapshot('capacity-delivery-secret-1000').state, 'submitting');
    await service.flush();
    serialized = fs.readFileSync(path.join(tmp, 'delivery-bounded.json'), 'utf8');
    assert.equal(serialized.includes('capacity-delivery-secret'), false);
    await service.close();
  });

  await check('recentTasks 匿名、有限、无 sessionRef，snapshot 固定免责声明', async () => {
    const service = makeService(tmp, 'snapshot', clock, { recentTaskLimit: 2 });
    for (let index = 0; index < 3; index += 1) {
      const sessionRef = `recent-raw-${index}`;
      await service.registerSession(sessionRef, { origin: 'user', notificationFloorSeq: -1 });
      await service.ingestMany([
        {
          kind: 'message', sessionRef, seq: 0, turn: 1, step: 'answer',
          role: 'assistant', title: `RAW-TITLE-${index}`
        },
        {
          kind: 'turn-terminal', sessionRef, seq: 1, turn: 1,
          reason: 'completed', title: `RAW-TITLE-${index}`
        }
      ]);
    }
    const view = service.snapshot();
    assert.equal(view.disclaimer, USAGE_DISCLAIMER);
    assert.equal(view.disclaimer, 'dsh 已观测用量，非账单');
    assert.equal(view.recentTasks.length, 2);
    for (const task of view.recentTasks) {
      assert.match(task.label, /^任务 \d{2}$/);
      assert.equal(Object.hasOwn(task, 'sessionRef'), false);
      assert.match(task.taskKey, /^[a-f0-9]{64}$/);
    }
    assert.equal(JSON.stringify(view).includes('RAW-TITLE'), false);
    await service.close();
  });

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_error) {
    // 测试结果不因临时目录清理失败而改变。
  }

  console.log(`\n${passed}/${passed + failed} ${failed === 0 ? 'ALL PASS' : 'FAILED'}`);
  if (failed > 0) {
    const error = new Error(`${failed} events smoke checks failed`);
    error.code = 'EVENTS_SMOKE_FAILED';
    throw error;
  }
  return { passed, failed };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { run };
