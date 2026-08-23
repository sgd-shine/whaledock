'use strict';

// v0.9 投递预检与贴卡回执的独立纯 Node 合约测试。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const { createFlowReceiptService } = require('../lib/delivery-receipts');

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

function makeClock(iso = '2026-08-23T12:00:00.000Z') {
  let value = new Date(iso).getTime();
  return {
    now: () => new Date(value),
    advance(ms) { value += ms; },
    set(isoValue) { value = new Date(isoValue).getTime(); }
  };
}

function makeService(clock, options = {}) {
  let ordinal = 0;
  return createFlowReceiptService({
    now: clock.now,
    mintToken: (kind) => `${kind}-opaque-${++ordinal}`,
    maxPreflights: 4,
    maxReceipts: 4,
    preflightTtlMs: 60_000,
    ...options
  });
}

function preflightInput(overrides = {}) {
  return {
    owner: 'video-workbench',
    actionFingerprint: 'sha256:action-one',
    targetToken: 'raw-target-token-secret',
    sessionRef: 'session-ref-secret',
    cwdFacts: {
      targetCwd: '/Users/private/target-workspace',
      workspaceCwd: '/Users/private/current-workspace'
    },
    context: {
      actionText: 'SECRET ACTION BODY',
      path: '/Users/private/result.mov'
    },
    targetLabel: '目标会话 01',
    workspaceLabel: '视频工作区',
    workspaceMatch: 'match',
    targetRunning: true,
    eventTracking: 'ready',
    ...overrides
  };
}

function receiptInput(overrides = {}) {
  return {
    owner: 'video-workbench',
    anchorRef: 'scene-card-01',
    deliveryRef: 'internal-session-ref-secret',
    targetLabel: '目标会话 01',
    tracking: 'ready',
    expectedStage: '脚本',
    ...overrides
  };
}

function assertNoSecrets(value, secrets) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `公开值泄漏：${secret}`);
  }
}

async function run() {
  await check('模块是纯 Node，不依赖 Electron 且不使用定时器', async () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'delivery-receipts.js'),
      'utf8'
    );
    assert.equal(source.includes("require('electron')"), false);
    assert.equal(source.includes('setTimeout('), false);
    assert.equal(typeof createFlowReceiptService, 'function');
  });

  await check('预检公开值只含白名单字段，所有内部路径与引用不外泄', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const view = service.createPreflight(preflightInput());
    assert.deepEqual(Object.keys(view).sort(), [
      'eventTracking', 'expiresAt', 'preflightToken', 'targetLabel',
      'targetRunning', 'workspaceLabel', 'workspaceMatch'
    ].sort());
    assert.match(view.preflightToken, /^preflight-opaque-/);
    assert.equal(view.expiresAt, '2026-08-23T12:01:00.000Z');
    assert.equal(view.workspaceMatch, 'match');
    assertNoSecrets(view, [
      'video-workbench', 'sha256:action-one', 'raw-target-token-secret',
      'session-ref-secret', '/Users/private', 'SECRET ACTION BODY'
    ]);
  });

  await check('match 预检可投递且只能消费一次，成功时才返回内部上下文', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const view = service.createPreflight(preflightInput());
    const consumed = service.consumePreflight({
      preflightToken: view.preflightToken,
      owner: 'video-workbench',
      actionFingerprint: 'sha256:action-one'
    });
    assert.equal(consumed.accepted, true);
    assert.equal(consumed.reason, 'workspace-match');
    assert.equal(consumed.overrideUsed, false);
    assert.equal(consumed.delivery.targetToken, 'raw-target-token-secret');
    assert.equal(consumed.delivery.sessionRef, 'session-ref-secret');
    assert.equal(consumed.delivery.cwdFacts.targetCwd, '/Users/private/target-workspace');
    assert.equal(consumed.delivery.context.actionText, 'SECRET ACTION BODY');
    assert.deepEqual(service.consumePreflight({
      preflightToken: view.preflightToken,
      owner: 'video-workbench',
      actionFingerprint: 'sha256:action-one'
    }), { accepted: false, reason: 'not-found' });
  });

  await check('所有拒绝均不返回 context，mismatch/unknown 只接受当次显式 true override', async () => {
    const clock = makeClock();
    const service = makeService(clock);

    for (const attempt of [
      { owner: 'wrong-owner', actionFingerprint: 'sha256:action-one', reason: 'owner-mismatch' },
      { owner: 'video-workbench', actionFingerprint: 'wrong-action', reason: 'action-mismatch' }
    ]) {
      const view = service.createPreflight(preflightInput());
      const rejected = service.consumePreflight({
        preflightToken: view.preflightToken,
        owner: attempt.owner,
        actionFingerprint: attempt.actionFingerprint
      });
      assert.deepEqual(rejected, { accepted: false, reason: attempt.reason });
      assertNoSecrets(rejected, ['SECRET ACTION BODY', 'raw-target-token-secret']);
      assert.equal(service.consumePreflight({
        preflightToken: view.preflightToken,
        owner: 'video-workbench',
        actionFingerprint: 'sha256:action-one',
        override: true
      }).accepted, false, '拒绝的消费尝试也不得重放');
    }

    for (const workspaceMatch of ['mismatch', 'unknown']) {
      for (const override of [undefined, 1, 'true']) {
        const view = service.createPreflight(preflightInput({ workspaceMatch }));
        const rejected = service.consumePreflight({
          preflightToken: view.preflightToken,
          owner: 'video-workbench',
          actionFingerprint: 'sha256:action-one',
          override
        });
        assert.deepEqual(rejected, {
          accepted: false,
          reason: `workspace-${workspaceMatch}`
        });
        assertNoSecrets(rejected, ['SECRET ACTION BODY', 'raw-target-token-secret']);
      }

      const view = service.createPreflight(preflightInput({ workspaceMatch }));
      const accepted = service.consumePreflight({
        preflightToken: view.preflightToken,
        owner: 'video-workbench',
        actionFingerprint: 'sha256:action-one',
        override: true
      });
      assert.equal(accepted.accepted, true);
      assert.equal(accepted.reason, 'workspace-override');
      assert.equal(accepted.overrideUsed, true);
      assert.equal(accepted.delivery.context.actionText, 'SECRET ACTION BODY');
    }
  });

  await check('预检 TTL 到点失效，容量满时裁掉最旧项', async () => {
    const clock = makeClock();
    const service = makeService(clock, { maxPreflights: 2, preflightTtlMs: 1000 });
    const first = service.createPreflight(preflightInput({ actionFingerprint: 'action-1' }));
    const second = service.createPreflight(preflightInput({ actionFingerprint: 'action-2' }));
    const third = service.createPreflight(preflightInput({ actionFingerprint: 'action-3' }));
    assert.deepEqual(service.consumePreflight({
      preflightToken: first.preflightToken,
      owner: 'video-workbench',
      actionFingerprint: 'action-1'
    }), { accepted: false, reason: 'not-found' });
    assert.equal(service.consumePreflight({
      preflightToken: second.preflightToken,
      owner: 'video-workbench',
      actionFingerprint: 'action-2'
    }).accepted, true);
    clock.advance(1000);
    assert.deepEqual(service.consumePreflight({
      preflightToken: third.preflightToken,
      owner: 'video-workbench',
      actionFingerprint: 'action-3'
    }), { accepted: false, reason: 'expired' });
    assert.deepEqual(service.prune(), { preflights: 0, receipts: 0 });
  });

  await check('无效创建输入先失败，不能为腾容量而误删现有预检或回执', async () => {
    const clock = makeClock();
    const service = makeService(clock, { maxPreflights: 1, maxReceipts: 1 });
    const preflight = service.createPreflight(preflightInput());
    assert.throws(
      () => service.createPreflight(preflightInput({ targetLabel: '' })),
      (error) => error.code === 'ERR_FLOW_RECEIPT_INPUT'
    );
    assert.equal(service.consumePreflight({
      preflightToken: preflight.preflightToken,
      owner: 'video-workbench',
      actionFingerprint: 'sha256:action-one'
    }).accepted, true);

    const receipt = service.createReceipt(receiptInput());
    assert.throws(
      () => service.createReceipt(receiptInput({ owner: '' })),
      (error) => error.code === 'ERR_FLOW_RECEIPT_INPUT'
    );
    assert.deepEqual(
      service.snapshot({ owner: 'video-workbench' }).receipts.map((item) => item.receiptId),
      [receipt.receiptId]
    );
  });

  await check('创建回执即建立无高亮 baseline，公开快照不含 owner 或投递引用', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const view = service.createReceipt(receiptInput());
    assert.equal(view.status, 'submitting');
    assert.equal(view.elapsedMs, 0);
    assert.equal(view.durationMs, null);
    assert.equal(Object.hasOwn(view, 'pulseAt'), false);
    assert.equal(Object.hasOwn(view, 'pulseId'), false);
    assert.deepEqual(service.snapshot({ owner: 'video-workbench' }).receipts, [view]);
    assert.deepEqual(service.snapshot({ owner: 'another-owner' }), { receipts: [] });
    assertNoSecrets(view, [
      'video-workbench', 'internal-session-ref-secret', 'deliveryRef', 'sessionRef'
    ]);
  });

  await check('中性状态只接受白名单，旧事件与终态后续更新不能回滚', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const receipt = service.createReceipt(receiptInput());
    clock.advance(5000);
    const running = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'running', at: clock.now()
    });
    assert.equal(running.status, 'running');
    assert.equal(running.elapsedMs, 5000);
    assert.equal(running.updatedAt, '2026-08-23T12:00:05.000Z');

    const stale = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'queued', at: '2026-08-23T12:00:04.000Z'
    });
    assert.equal(stale.status, 'running');
    assert.equal(stale.updatedAt, '2026-08-23T12:00:05.000Z');

    clock.advance(2000);
    const completed = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'completed', at: clock.now()
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.durationMs, 7000);
    assert.equal(completed.elapsedMs, 7000);
    assert.equal(completed.terminalAt, '2026-08-23T12:00:07.000Z');

    clock.advance(5000);
    const ignored = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'error', at: clock.now()
    });
    assert.equal(ignored.status, 'completed');
    assert.equal(ignored.durationMs, 7000);
    assert.equal(ignored.updatedAt, '2026-08-23T12:00:07.000Z');

    assert.throws(() => service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId, status: 'success'
    }), (error) => error.code === 'ERR_FLOW_RECEIPT_INPUT');
  });

  await check('completed 只允许后续补录一次非空文件结果，不重置终态时长且重复不抖动', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const receipt = service.createReceipt(receiptInput({ anchorRef: 'late-file' }));
    clock.advance(5000);
    const completed = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'completed', at: clock.now()
    });
    assert.equal(completed.durationMs, 5000);
    assert.equal(completed.resultCount, 0);
    const completionPulse = completed.pulseId;
    assert.equal(service.ackPulse({
      owner: 'video-workbench', receiptId: receipt.receiptId, pulseId: completionPulse
    }), true);

    clock.advance(3000);
    const supplemented = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'completed', at: clock.now(),
      fileResults: [{ path: '/Users/private/landed-after-terminal.mp4' }]
    });
    assert.equal(supplemented.status, 'completed');
    assert.equal(supplemented.terminalAt, '2026-08-23T12:00:05.000Z');
    assert.equal(supplemented.durationMs, 5000);
    assert.equal(supplemented.updatedAt, '2026-08-23T12:00:08.000Z');
    assert.equal(supplemented.resultCount, 1);
    assert.match(supplemented.resultToken, /^result-opaque-/);
    assert.match(supplemented.pulseId, /^pulse-opaque-/);
    assert.notEqual(supplemented.pulseId, completionPulse);
    assertNoSecrets(supplemented, ['/Users/private/landed-after-terminal.mp4']);
    assert.equal(service.ackPulse({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      pulseId: supplemented.pulseId
    }), true);

    clock.advance(1000);
    const repeated = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'completed', at: clock.now(),
      fileResults: [{ path: '/Users/private/repeated-must-not-replace.mp4' }]
    });
    assert.equal(repeated.updatedAt, '2026-08-23T12:00:08.000Z');
    assert.equal(repeated.resultToken, supplemented.resultToken);
    assert.equal(Object.hasOwn(repeated, 'pulseId'), false);
    assert.deepEqual(service.resolveResult({
      owner: 'video-workbench', resultToken: supplemented.resultToken
    }), { path: '/Users/private/landed-after-terminal.mp4' });
  });

  await check('事件不可用时文案如实说明无法自动跟踪，unknown 不冒充失败或成功', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const receipt = service.createReceipt(receiptInput({ tracking: 'unavailable' }));
    assert.equal(receipt.trackingText, '任务事件不可用，无法自动跟踪');
    assert.match(receipt.statusText, /事件不可用/);
    const unknown = service.updateReceipt({
      owner: 'video-workbench', receiptId: receipt.receiptId,
      status: 'unknown'
    });
    assert.equal(unknown.status, 'unknown');
    assert.match(unknown.statusText, /结果未知/);
    assert.match(unknown.statusText, /目标会话确认/);
    assert.doesNotMatch(unknown.statusText, /成功|失败/);
  });

  await check('unknown 不重试且拒绝弱回写，仅精确 target-activity 证据可恢复 queued/running', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const queuedCandidate = service.createReceipt(receiptInput({
      anchorRef: 'unknown-to-queued', deliveryRef: 'delivery-queued'
    }));
    clock.advance(1000);
    const unknown = service.updateReceipt({
      owner: 'video-workbench', receiptId: queuedCandidate.receiptId,
      status: 'unknown', at: clock.now()
    });
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.terminalAt, '2026-08-23T12:00:01.000Z');
    assert.equal(unknown.durationMs, 1000);
    assert.equal(service.ackPulse({
      owner: 'video-workbench', receiptId: queuedCandidate.receiptId,
      pulseId: unknown.pulseId
    }), true);

    clock.advance(1000);
    for (const attemptedStatus of ['submitting', 'queued', 'running']) {
      const weak = service.updateReceipt({
        owner: 'video-workbench', receiptId: queuedCandidate.receiptId,
        status: attemptedStatus, at: clock.now()
      });
      assert.equal(weak.status, 'unknown');
      assert.equal(weak.updatedAt, '2026-08-23T12:00:01.000Z');
      assert.equal(Object.hasOwn(weak, 'pulseId'), false);
    }
    const falseStrong = service.updateReceipt({
      owner: 'video-workbench', receiptId: queuedCandidate.receiptId,
      status: 'submitting', evidence: 'target-activity', at: clock.now()
    });
    assert.equal(falseStrong.status, 'unknown');

    const queued = service.updateReceipt({
      owner: 'video-workbench', receiptId: queuedCandidate.receiptId,
      status: 'queued', evidence: 'target-activity', at: clock.now()
    });
    assert.equal(queued.status, 'queued');
    assert.equal(queued.terminalAt, null);
    assert.equal(queued.durationMs, null);
    assert.match(queued.pulseId, /^pulse-opaque-/);

    const runningCandidate = service.createReceipt(receiptInput({
      anchorRef: 'unknown-to-running', deliveryRef: 'delivery-running'
    }));
    clock.advance(1000);
    service.updateReceipt({
      owner: 'video-workbench', receiptId: runningCandidate.receiptId,
      status: 'unknown', at: clock.now()
    });
    clock.advance(1000);
    const recovered = service.updateByDeliveryRef({
      owner: 'video-workbench', deliveryRef: 'delivery-running',
      status: 'running', evidence: 'target-activity', at: clock.now()
    });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, 'running');
    assert.equal(recovered[0].terminalAt, null);

    clock.advance(1000);
    const rollback = service.updateReceipt({
      owner: 'video-workbench', receiptId: runningCandidate.receiptId,
      status: 'queued', evidence: 'target-activity', at: clock.now()
    });
    assert.equal(rollback.status, 'running');
    assert.throws(() => service.updateReceipt({
      owner: 'video-workbench', receiptId: runningCandidate.receiptId,
      status: 'completed', evidence: 'manual-claim'
    }), (error) => error.code === 'ERR_FLOW_RECEIPT_INPUT');
  });

  await check('唯一文件结果给可解析令牌，多结果只给数量不猜主文件', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const one = service.createReceipt(receiptInput({ anchorRef: 'block-one' }));
    const oneView = service.updateReceipt({
      owner: 'video-workbench', receiptId: one.receiptId,
      status: 'completed',
      fileResults: [{ path: '/Users/private/unique.mp4', kind: 'video' }]
    });
    assert.equal(oneView.resultCount, 1);
    assert.match(oneView.resultToken, /^result-opaque-/);
    assertNoSecrets(oneView, ['/Users/private/unique.mp4', 'unique.mp4']);
    assert.deepEqual(service.resolveResult({
      owner: 'video-workbench', resultToken: oneView.resultToken
    }), { path: '/Users/private/unique.mp4', kind: 'video' });
    assert.equal(service.resolveResult({
      owner: 'wrong-owner', resultToken: oneView.resultToken
    }), null);

    const many = service.createReceipt(receiptInput({ anchorRef: 'block-many' }));
    const manyView = service.updateReceipt({
      owner: 'video-workbench', receiptId: many.receiptId,
      status: 'completed',
      fileResults: [
        { path: '/Users/private/a.png' },
        { path: '/Users/private/b.png' }
      ]
    });
    assert.equal(manyView.resultCount, 2);
    assert.equal(Object.hasOwn(manyView, 'resultToken'), false);
    assertNoSecrets(manyView, ['/Users/private/a.png', '/Users/private/b.png']);
  });

  await check('首次 baseline 不亮，后续更新产生可 ack 且 30 秒后自然消退的脉冲', async () => {
    const clock = makeClock();
    const service = makeService(clock);
    const first = service.createReceipt(receiptInput({ anchorRef: 'pulse-one' }));
    assert.equal(Object.hasOwn(first, 'pulseId'), false);
    clock.advance(1000);
    const updated = service.updateReceipt({
      owner: 'video-workbench', receiptId: first.receiptId, status: 'queued'
    });
    assert.match(updated.pulseId, /^pulse-opaque-/);
    assert.equal(updated.pulseAt, '2026-08-23T12:00:01.000Z');
    assert.equal(service.ackPulse({
      owner: 'video-workbench', receiptId: first.receiptId, pulseId: updated.pulseId
    }), true);
    assert.equal(Object.hasOwn(
      service.snapshot({ owner: 'video-workbench' }).receipts[0],
      'pulseId'
    ), false);

    const second = service.createReceipt(receiptInput({ anchorRef: 'pulse-two' }));
    clock.advance(1000);
    service.updateReceipt({
      owner: 'video-workbench', receiptId: second.receiptId, status: 'running'
    });
    clock.advance(29_999);
    let secondView = service.snapshot({ owner: 'video-workbench' })
      .receipts.find((item) => item.receiptId === second.receiptId);
    assert.equal(Object.hasOwn(secondView, 'pulseId'), true);
    clock.advance(1);
    secondView = service.snapshot({ owner: 'video-workbench' })
      .receipts.find((item) => item.receiptId === second.receiptId);
    assert.equal(Object.hasOwn(secondView, 'pulseId'), false);
  });

  await check('回执容量有界，优先裁掉旧终态并同步失效结果令牌', async () => {
    const clock = makeClock();
    const service = makeService(clock, { maxReceipts: 2 });
    const active = service.createReceipt(receiptInput({ anchorRef: 'active' }));
    clock.advance(1);
    const terminal = service.createReceipt(receiptInput({ anchorRef: 'terminal' }));
    const withResult = service.updateReceipt({
      owner: 'video-workbench', receiptId: terminal.receiptId,
      status: 'completed', fileResults: [{ path: '/private/evicted.mov' }]
    });
    clock.advance(1);
    service.createReceipt(receiptInput({ anchorRef: 'newest' }));
    const view = service.snapshot({ owner: 'video-workbench' });
    assert.deepEqual(view.receipts.map((item) => item.anchorRef), ['newest', 'active']);
    assert.equal(service.resolveResult({
      owner: 'video-workbench', resultToken: withResult.resultToken
    }), null);
    assert.equal(view.receipts.some((item) => item.receiptId === active.receiptId), true);
    assertNoSecrets(view, ['internal-session-ref-secret', '/private/evicted.mov']);
  });

  console.log(`\n${passed}/${passed + failed} ${failed === 0 ? 'ALL PASS' : 'FAILED'}`);
  if (failed > 0) {
    const error = new Error(`${failed} delivery receipt smoke checks failed`);
    error.code = 'DELIVERY_RECEIPT_SMOKE_FAILED';
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
