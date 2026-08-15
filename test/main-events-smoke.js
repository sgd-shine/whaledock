'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
const main = require('../main');
delete process.env.WHALEDOCK_MAIN_HELPER_TEST;

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  main-events: ${name}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function run() {
  await test('看板快照只暴露匿名聚合与预算字段', async () => {
    const safe = main.dashboardSnapshot({
      availability: { state: 'live', detail: null },
      coverage: { status: 'complete', sessions: 2, gapSessions: 0 },
      disclaimer: 'dsh 已观测用量，非账单',
      today: {
        tokens: { input: 10, cacheRead: 2, output: 3, total: 15 },
        origins: { user: 11, subagent: 4 },
        estimatedCost: 0.12
      },
      week: {
        tokens: { input: 20, cacheRead: 4, output: 6, total: 30 },
        origins: { user: 22, subagent: 8 },
        estimatedCost: 0.24
      },
      budget: { enabled: true, observedTokens: 15, limitTokens: 100, paused: false, resumed: false },
      pricing: { inputPerMillion: 1, cacheReadPerMillion: 0.02, outputPerMillion: 2 },
      waiting: { approvals: 1, questions: 0 },
      recentTasks: [{
        taskKey: 'a'.repeat(64), ordinal: 7, label: '任务 07', result: 'completed',
        origin: 'user', completedAt: '2026-08-15T01:02:03.000Z', terminalSeq: 9,
        tokens: { input: 10, cacheRead: 2, output: 3, total: 15 }, estimatedCost: 0.12,
        rawSessionId: 'must-not-leak', content: 'must-not-leak'
      }],
      rawSessionId: 'must-not-leak', cwd: '/secret', frame: { payload: 'secret' }
    });
    assert.equal(safe.availability.status, 'available');
    assert.equal(safe.today.tokens, 15);
    assert.equal(safe.today.topLevelTokens, 11);
    assert.equal(safe.today.subagentTokens, 4);
    assert.equal(safe.costAvailable, true);
    assert.equal(safe.recentTasks[0].taskKey, 'a'.repeat(64));
    assert.equal(safe.recentTasks[0].tokens, 15);
    const encoded = JSON.stringify(safe);
    for (const forbidden of ['must-not-leak', '/secret', 'rawSessionId', 'content', 'frame', 'terminalSeq']) {
      assert(!encoded.includes(forbidden), forbidden);
    }
  });

  await test('缺口覆盖不展示伪精确费用', async () => {
    const safe = main.dashboardSnapshot({
      availability: { state: 'backfilling' },
      coverage: { status: 'gap', sessions: 1, gapSessions: 1 },
      today: { tokens: { total: 3 }, origins: { user: 3, subagent: 0 }, estimatedCost: 99 },
      week: { tokens: { total: 3 }, origins: { user: 3, subagent: 0 }, estimatedCost: 99 },
      budget: {}, pricing: {}, recentTasks: []
    });
    assert.equal(safe.availability.status, 'loading');
    assert.equal(safe.coverage.status, 'gap');
    assert.equal(safe.costAvailable, false);
    assert.equal(safe.today.estimatedCost, null);
  });

  await test('外部 attach 超限不冒充已停止服务', async () => {
    const safe = main.dashboardSnapshot({
      availability: { state: 'live' }, coverage: { status: 'complete' },
      today: { tokens: { total: 200 }, origins: {}, estimatedCost: 1 },
      week: { tokens: { total: 200 }, origins: {}, estimatedCost: 1 },
      budget: { enabled: true, observedTokens: 200, limitTokens: 100, paused: true },
      recentTasks: []
    }, { externalService: true });
    assert.equal(safe.budget.paused, false);
    assert.equal(safe.budget.enforcement, 'external-warning');
    assert.equal(safe.budget.resumeAvailable, true);
    assert.equal(safe.budget.used, 200);
  });

  await test('战报请求只接受白名单主题与动作', async () => {
    assert.deepEqual(main.reportRequest({ taskKey: 'x'.repeat(64), theme: 'light', action: 'copy' }), {
      taskKey: 'x'.repeat(64), theme: 'light', action: 'copy'
    });
    assert.throws(() => main.reportRequest({ taskKey: '<script>', theme: 'violet', action: 'upload' }));
    assert.throws(() => main.reportRequest(Object.create({ taskKey: 'x' })));
  });

  await test('战报数值从主进程规范快照重读', async () => {
    const payload = main.reportPayload({
      coverage: { status: 'complete' },
      recentTasks: [{
        taskKey: 'b'.repeat(64), ordinal: 2, label: '任务 02', result: 'completed',
        completedAt: '2026-08-15T01:02:03.000Z',
        tokens: { input: 7, cacheRead: 2, output: 4, total: 13 }, estimatedCost: 0.8,
        durationMs: 4321
      }]
    }, { taskKey: 'b'.repeat(64), theme: 'dark', action: 'save' }, '0.3.0');
    assert.equal(payload.totalTokens, 13);
    assert.equal(payload.inputTokens, 7);
    assert.equal(payload.estimatedCost, 0.8);
    assert.equal(payload.durationMs, 4321);
    assert.equal(payload.theme, 'dark');
    assert.equal(payload.appVersion, 'WhaleDock 0.3.0');
  });

  await test('战报恶意长文本、缺口和未知结果安全降级', async () => {
    const key = 'c'.repeat(64);
    const payload = main.reportPayload({
      coverage: { status: 'gap' },
      recentTasks: [{
        taskKey: key,
        label: `\u0000<script>${'x'.repeat(200)}`,
        result: 'future-result',
        completedAt: 'bad-date',
        durationMs: Number.POSITIVE_INFINITY,
        tokens: { input: 1, cacheRead: 2, output: 3, total: 6 },
        estimatedCost: 999
      }]
    }, { taskKey: key, theme: 'light', action: 'copy' }, '0.3.0');
    assert(!payload.taskLabel.includes('\u0000'));
    assert(payload.taskLabel.length <= 86);
    assert.equal(payload.result, 'failed');
    assert.equal(payload.estimatedCost, null);
    assert.equal(payload.costAvailable, false);
    assert.equal(payload.durationMs, null);
  });

  await test('看板与战报拒绝非整数和超大有限数', async () => {
    const key = 'd'.repeat(64);
    const snapshot = {
      coverage: { status: 'complete' },
      today: {
        tokens: { input: 1.5, cacheRead: Number.MAX_SAFE_INTEGER + 1, output: 3, total: 1e308 },
        origins: { user: 1e308, subagent: 4 },
        estimatedCost: 1e308
      },
      week: { tokens: { total: 1e308 }, origins: {}, estimatedCost: 1e308 },
      budget: { enabled: true, observedTokens: 1e308, limitTokens: 1e308 },
      pricing: { inputPerMillion: 1e308, cacheReadPerMillion: 0.02, outputPerMillion: 2 },
      recentTasks: [{
        taskKey: key, ordinal: 1, label: '任务 01', result: 'completed',
        durationMs: 1e308,
        tokens: { input: 1.5, cacheRead: Number.MAX_SAFE_INTEGER + 1, output: 3, total: 1e308 },
        estimatedCost: 1e308
      }]
    };
    const dashboard = main.dashboardSnapshot(snapshot);
    assert.equal(dashboard.today.tokens, 0);
    assert.equal(dashboard.today.tokenDetails.input, 0);
    assert.equal(dashboard.today.tokenDetails.cacheRead, 0);
    assert.equal(dashboard.today.topLevelTokens, 0);
    assert.equal(dashboard.today.estimatedCost, null);
    assert.equal(dashboard.budget.used, 0);
    assert.equal(dashboard.budget.limit, null);
    assert.equal(dashboard.pricing.inputPerMillion, null);
    assert.equal(dashboard.recentTasks[0].durationMs, null);

    const report = main.reportPayload(snapshot, {
      taskKey: key, theme: 'dark', action: 'copy'
    }, '0.3.0');
    assert.equal(report.totalTokens, 0);
    assert.equal(report.inputTokens, 0);
    assert.equal(report.cacheReadTokens, 0);
    assert.equal(report.outputTokens, 3);
    assert.equal(report.durationMs, null);
    assert.equal(report.estimatedCost, null);
  });

  await test('IPC 同时校验 sender、mainFrame 与精确 file URL', async () => {
    const contents = { mainFrame: {} };
    const win = { isDestroyed: () => false, webContents: contents };
    const good = { sender: contents, senderFrame: contents.mainFrame };
    contents.mainFrame.url = 'file:///app/dashboard.html';
    assert.equal(main.trustedLocalEvent(good, win, 'file:///app/dashboard.html'), true);
    assert.equal(main.trustedLocalEvent(good, win, 'file:///app/settings.html'), false);
    assert.equal(main.trustedLocalEvent({ sender: contents, senderFrame: {} }, win, 'file:///app/dashboard.html'), false);
    assert.equal(main.trustedLocalEvent(good, { isDestroyed: () => true, webContents: contents }, 'file:///app/dashboard.html'), false);
  });

  await test('实时队列按条数与字节双重限界并保持 FIFO', async () => {
    const queue = main.createBoundedEventQueue({ maxEvents: 2, maxBytes: 100 });
    queue.push({ kind: 'projection', sessionRef: 's', seq: 1 });
    queue.push({ kind: 'projection', sessionRef: 's', seq: 2 });
    assert.deepEqual(queue.drain().map((event) => event.seq), [1, 2]);
    queue.push({ kind: 'projection', sessionRef: 's', seq: 3 });
    queue.push({ kind: 'projection', sessionRef: 's', seq: 4 });
    assert.throws(
      () => queue.push({ kind: 'projection', sessionRef: 's', seq: 5 }),
      (error) => error && error.code === 'ERR_EVENT_LIVE_BACKLOG'
    );
  });

  await test('200ms 批处理只在 ingestMany 持久成功后执行 effect', async () => {
    const timers = [];
    const persistence = deferred();
    const order = [];
    const batcher = main.createPersistedEventBatcher({
      service: {
        ingestMany: async (events, options) => {
          order.push(['ingest', events.map((event) => event.seq), options.generation]);
          await persistence.promise;
          return [{ type: 'task-terminal' }];
        }
      },
      generation: 7,
      delayMs: 200,
      setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
      clearTimer: () => {},
      onEffects: async (effects) => { order.push(['effects', effects.map((effect) => effect.type)]); }
    });
    batcher.push({ kind: 'projection', sessionRef: 's', seq: 1 });
    batcher.push({ kind: 'projection', sessionRef: 's', seq: 2 });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 200);
    timers[0].fn();
    const flushing = batcher.flush();
    await Promise.resolve();
    assert.deepEqual(order, [['ingest', [1, 2], 7]]);
    persistence.resolve();
    await flushing;
    assert.deepEqual(order, [
      ['ingest', [1, 2], 7],
      ['effects', ['task-terminal']]
    ]);
  });

  await test('live terminal 先等 history 确认再持久 ledger 与执行 effect', async () => {
    const history = deferred();
    const order = [];
    const monitor = {
      serviceGeneration: 11,
      batcher: {
        flush: async () => { order.push('flush'); },
        push: () => { throw new Error('terminal 不应进普通批次'); }
      }
    };
    const pending = main.ingestLiveEvent(monitor, {
      kind: 'turn-terminal', sessionRef: 'session-safe', seq: 9, turn: 1, reason: 'completed'
    }, {
      isCurrent: () => true,
      confirmTerminal: async () => {
        order.push('history');
        return history.promise;
      },
      service: {
        ingest: async (_event, options) => {
          order.push(['ingest', options]);
          return [{ type: 'task-terminal' }];
        }
      },
      onEffects: async () => { order.push('effects'); }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['flush', 'history']);
    history.resolve(true);
    await pending;
    assert.deepEqual(order, [
      'flush', 'history', ['ingest', { generation: 11 }], 'effects'
    ]);
  });

  await test('live terminal 确认失败只静默记录，换代后连 ingest 也不执行', async () => {
    const calls = [];
    let current = true;
    const monitor = {
      serviceGeneration: 12,
      batcher: { flush: async () => {}, push: () => {} }
    };
    await main.ingestLiveEvent(monitor, {
      kind: 'turn-terminal', sessionRef: 'session-safe', seq: 10, turn: 1, reason: 'error'
    }, {
      isCurrent: () => true,
      confirmTerminal: async () => false,
      service: {
        ingest: async (_event, options) => {
          calls.push(options);
          return [{ type: 'task-terminal' }];
        }
      },
      onEffects: async () => { calls.push('effects'); }
    });
    assert.deepEqual(calls, [{ generation: 12, suppressNotifications: true }]);

    calls.length = 0;
    await main.ingestLiveEvent(monitor, {
      kind: 'turn-terminal', sessionRef: 'session-safe', seq: 11, turn: 2, reason: 'error'
    }, {
      isCurrent: () => current,
      confirmTerminal: async () => { current = false; return true; },
      service: {
        ingest: async () => { calls.push('ingest'); return []; }
      },
      onEffects: async () => { calls.push('effects'); }
    });
    assert.deepEqual(calls, []);
  });

  await test('live terminal 生产确认路径按 sessionRef 与 seq 匹配 history', async () => {
    const calls = [];
    const monitor = {
      serviceGeneration: 13,
      batcher: { flush: async () => { calls.push('flush'); }, push: () => {} },
      adapter: {
        readHistory: async (sessionRef, options) => {
          calls.push(['history', sessionRef, options]);
          return {
            events: [{ kind: 'turn-terminal', sessionRef: 'session-safe', seq: 23 }]
          };
        }
      }
    };
    await main.ingestLiveEvent(monitor, {
      kind: 'turn-terminal', sessionRef: 'session-safe', seq: 23, turn: 4, reason: 'completed'
    }, {
      isCurrent: () => true,
      service: {
        ingest: async (_event, options) => {
          calls.push(['ingest', options]);
          return [{ type: 'task-terminal' }];
        }
      },
      onEffects: async () => { calls.push('effects'); }
    });
    assert.deepEqual(calls, [
      'flush',
      ['history', 'session-safe', { maxMessages: 1 }],
      ['ingest', { generation: 13 }],
      'effects'
    ]);
  });

  await test('批处理持久失败时零副作用并 fail-closed', async () => {
    let effects = 0;
    let failed = 0;
    const batcher = main.createPersistedEventBatcher({
      service: { ingestMany: async () => { throw new Error('disk full'); } },
      generation: 1,
      delayMs: 200,
      setTimer: () => 1,
      clearTimer: () => {},
      onEffects: async () => { effects += 1; },
      onFailure: async () => { failed += 1; }
    });
    batcher.push({ kind: 'projection', sessionRef: 's', seq: 0 });
    await assert.rejects(batcher.flush(), /disk full/);
    assert.equal(effects, 0);
    assert.equal(failed, 1);
  });

  await test('定时 flush 失败被内部消费而手动 flush 仍拒绝', async () => {
    let timerCallback = null;
    let failed = 0;
    const batcher = main.createPersistedEventBatcher({
      service: { ingestMany: async () => { throw new Error('timer disk full'); } },
      generation: 2,
      setTimer: (callback) => { timerCallback = callback; return 1; },
      clearTimer: () => {},
      onFailure: async () => { failed += 1; }
    });
    batcher.push({ kind: 'projection', sessionRef: 's', seq: 0 });
    assert.equal(timerCallback(), undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(failed, 1);
    batcher.push({ kind: 'projection', sessionRef: 's', seq: 1 });
    await assert.rejects(batcher.flush(), /timer disk full/);
    assert.equal(failed, 2);
  });

  await test('优雅退出 close flush 持久最后 200ms 队列', async () => {
    const persisted = [];
    const batcher = main.createPersistedEventBatcher({
      service: {
        ingestMany: async (batch) => { persisted.push(...batch); return []; }
      },
      generation: 3,
      setTimer: () => 1,
      clearTimer: () => {}
    });
    batcher.push({ kind: 'projection', sessionRef: 's', seq: 8 });
    await batcher.close({ flush: true });
    assert.deepEqual(persisted.map((event) => event.seq), [8]);
  });

  await test('预算 stop 要求同一连接代、同一进程对象且必须由鲸坞拉起', async () => {
    const owned = { exited: false };
    const identity = { generation: 9, state: owned, spawnedByUs: true };
    assert.equal(main.canStopForBudget(identity, {
      generation: 9, state: owned, spawnedByUs: true, backendReady: true
    }), true);
    assert.equal(main.canStopForBudget(identity, {
      generation: 10, state: owned, spawnedByUs: true, backendReady: true
    }), false);
    assert.equal(main.canStopForBudget(identity, {
      generation: 9, state: {}, spawnedByUs: true, backendReady: true
    }), false);
    assert.equal(main.canStopForBudget({ generation: 9, state: null, spawnedByUs: false }, {
      generation: 9, state: null, spawnedByUs: false, backendReady: true
    }), false);
  });

  await test('持久预算 latch 阻止 managed 自动重启，仅显式 resume 放行', async () => {
    assert.equal(main.backendStartAllowed(false), true);
    assert.equal(main.backendStartAllowed(true), false);
    assert.equal(main.backendStartAllowed(true, true), true);
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert((source.match(/backendStartAllowed\(budgetIsPaused\(\)\)/g) || []).length >= 3);
    assert.match(source, /restartBackend\(\{ allowBudgetResume: true \}\)/);
  });

  await test('主窗口仍无 preload 且无 DOM 注入路径', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const openMain = source.slice(source.indexOf('function openMainWindow()'), source.indexOf('function showApp()'));
    assert.match(openMain, /webPreferences:\s*\{\s*contextIsolation:\s*true,\s*nodeIntegration:\s*false\s*\}/);
    assert(!/preload\s*:/.test(openMain));
    assert(!/(executeJavaScript|insertCSS|webFrame|querySelector|innerHTML)/.test(openMain));
  });

  await test('事件状态仅路由 WhaleDock userData', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(source, /path\.join\(app\.getPath\('userData'\),\s*'events-state\.json'\)/);
    assert(!source.includes("path.join(os.homedir(), '.dsh'"));
    assert(!source.includes("path.join(os.homedir(), \".dsh\""));
  });

  await test('新增本地窗口资源全部进入 builder files', async () => {
    const pkg = require('../package.json');
    for (const file of [
      'dashboard.html', 'dashboard.js', 'preload-dashboard.js',
      'notice.html', 'notice.js', 'preload-notice.js',
      'report-card.html', 'report-card.js', 'preload-report.js'
    ]) assert(pkg.build.files.includes(file), file);
  });

  await test('三个自有窗口 sandbox 开启、拒绝导航且看板有菜单入口', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    for (const preload of ['preload-dashboard.js', 'preload-notice.js', 'preload-report.js']) {
      const offset = source.indexOf(preload);
      assert(offset > 0, preload);
      const windowBlock = source.slice(offset, offset + 260);
      assert.match(windowBlock, /contextIsolation:\s*true/);
      assert.match(windowBlock, /nodeIntegration:\s*false/);
      assert.match(windowBlock, /sandbox:\s*true/);
    }
    assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
    assert.match(source, /任务与用量看板/);
    assert.match(source, /function refreshTrayMenu\(\)/);
    assert.match(source, /app\.setAppUserModelId\('com\.sgd\.whaledock'\)/);
  });

  await test('退出时等待适配器关闭与事件状态 flush', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(source, /await stopEventLayer\('App 正在退出'/);
    assert.match(source, /await eventService\.close\(\)/);
    assert.match(source, /void beginEventShutdown\(\)\.catch/);
    assert.match(source, /!eventShutdownComplete && eventShutdownPromise/);
    assert(!source.includes('eventShutdownPromise.finally'));
  });

  await test('订阅先于 history，连接代贯穿 ingest/availability/disconnect', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const bootstrap = source.slice(
      source.indexOf('async function bootstrapEventLayer'),
      source.indexOf('async function activateEventLayerForBackend')
    );
    assert(bootstrap.indexOf('monitor.adapter.subscribe') < bootstrap.indexOf('monitor.adapter.listSessions'));
    assert(bootstrap.indexOf('monitor.adapter.listSessions') < bootstrap.indexOf('backfillSession(monitor, row)'));
    assert.match(source, /ingestMany\(batch, \{ generation: options\.generation \}\)/);
    assert.match(source, /setAvailability\(state, detail, monitor\.serviceGeneration\)/);
    assert.match(source, /disconnect\(monitor\.serviceGeneration\)/);
    assert.match(source, /initialContiguousSeq/);
    assert.match(source, /async function handleEventEffects\(value, monitor\) \{\n  if \(!eventLayerCurrent\(monitor\)\) return;/);
    assert.match(source, /for \(const effect of effects\) \{\n    if \(!eventLayerCurrent\(monitor\)\) return;/);
    assert.match(source, /const page = await monitor\.adapter\.readHistory[\s\S]+if \(!currentCheck\(\)\) return false;/);
  });

  console.log(`\nMAIN EVENTS ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN EVENTS FAIL:', error && error.stack || error);
  process.exit(1);
});
