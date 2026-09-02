'use strict';

// v0.11 控制室：dsh 会话快照镜像、状态优先级、子代理聚合与 ack 生命周期纯函数直测。
const assert = require('assert');

const room = require('../lib/control-room');

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  control-room: ${name}`);
}

// rc.2 dsh-client-runtime projectList() 产出的 byId 形状（见 vendor 的 dsh-client-runtime）。
function rawSnapshot() {
  return {
    byId: {
      s_parent: { id: 's_parent', displayTitle: '自媒体工作台', running: true, blank: false, updatedAt: 10, cwd: '/Users/x/secret' },
      s_kid: { id: 's_kid', displayTitle: '子代理·选题', running: true, blank: false, updatedAt: 11, parentId: 's_parent', origin: 'subagent', pendingInteraction: 'question' },
      s_done: { id: 's_done', displayTitle: '旅行 Atlas', running: false, completed: true, blank: false, updatedAt: 12 },
      s_idle: { id: 's_idle', displayTitle: '健身记录', running: false, blank: false, updatedAt: 13 },
      s_busy: { id: 's_busy', displayTitle: '建筑审图', running: true, blank: false, updatedAt: 14 },
      s_need: { id: 's_need', displayTitle: '助理机器人', running: true, pendingInteraction: 'approval', blank: false, updatedAt: 15 }
    },
    subagentsByParent: {
      s_parent: { entries: [{ kind: 'child', id: 's_kid', label: '选题', activity: 'running' }, { kind: 'summary', id: 'x' }] },
      s_busy: [{ sessionId: 's_grandkid' }]
    },
    jobsBySession: {
      s_busy: [{ status: 'running', startedAt: 1000 }, { status: 'running', startedAt: 400 }, { status: 'done', startedAt: 1 }],
      s_parent: [{ status: 'queued', startedAt: 50 }]
    },
    current: 's_parent'
  };
}

function projectsFixture() {
  return [
    { id: 'proj_console', name: '控制室', icon: '🖥️', pinned: true, hidden: false, boundSession: 's_parent' },
    { id: 'proj_atlas', name: '旅行 Atlas', icon: '🌍', pinned: false, hidden: false, boundSession: 's_done' },
    { id: 'proj_fit', name: '健身记录', icon: '✏️', pinned: false, hidden: false, boundSession: 's_idle' },
    { id: 'proj_arch', name: '建筑审图', icon: '📐', pinned: false, hidden: true, boundSession: 's_busy' },
    { id: 'proj_bot', name: '助理机器人', icon: '🤖', pinned: false, hidden: false, boundSession: 's_need' },
    { id: 'proj_unbound', name: '未绑定', icon: '🧱', pinned: false, hidden: false, boundSession: null }
  ];
}

async function main() {
  await test('sanitizeSnapshot：垃圾输入退化为空快照，三种子代理形状归一，路径不进镜像', async () => {
    assert.deepStrictEqual(room.sanitizeSnapshot(null), room.EMPTY_SNAPSHOT);
    assert.deepStrictEqual(room.sanitizeSnapshot('x'), room.EMPTY_SNAPSHOT);
    assert.deepStrictEqual(room.sanitizeSnapshot({ byId: 'nope' }).byId, {});
    const snap = room.sanitizeSnapshot(rawSnapshot());
    assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.byId.s_parent));
    assert.strictEqual(snap.byId.s_parent.cwd, undefined, 'cwd 不得进入镜像');
    assert.ok(!JSON.stringify(snap).includes('/Users/x/secret'));
    assert.deepStrictEqual(snap.subagentsByParent.s_parent, ['s_kid']);
    assert.deepStrictEqual(snap.subagentsByParent.s_busy, ['s_grandkid']);
    assert.strictEqual(snap.byId.s_kid.pending, true);
    assert.strictEqual(snap.byId.s_kid.pendingKind, 'question');
    assert.strictEqual(snap.byId.s_idle.pending, false);
    assert.strictEqual(snap.current, 's_parent');
    const items = room.sanitizeSnapshot({ items: [{ sessionId: 'i1', running: true, parentSessionId: 'p', title: 't', pendingInteraction: 'approval' }] });
    assert.strictEqual(items.byId.i1.parentId, 'p');
    assert.strictEqual(items.byId.i1.pending, true);
    assert.strictEqual(items.byId.i1.displayTitle, 't');
    const children = room.sanitizeSnapshot({ subagentsByParent: { p: { children: ['c1', 'c2', 'bad\u0000id'] } } });
    assert.deepStrictEqual(children.subagentsByParent.p, ['c1', 'c2']);
  });

  await test('sanitizeSnapshot：会话数与子代理数有界', async () => {
    const byId = {};
    for (let i = 0; i < room.LIMITS.maxSessions + 20; i++) byId[`s${i}`] = { running: false };
    const snap = room.sanitizeSnapshot({ byId });
    assert.strictEqual(Object.keys(snap.byId).length, room.LIMITS.maxSessions);
    const kids = [];
    for (let i = 0; i < room.LIMITS.maxKidsPerParent + 5; i++) kids.push(`k${i}`);
    const snap2 = room.sanitizeSnapshot({ subagentsByParent: { p: kids } });
    assert.strictEqual(snap2.subagentsByParent.p.length, room.LIMITS.maxKidsPerParent);
  });

  await test('状态优先级：need > done > busy > idle，pending 与 running 同时为真判 need', async () => {
    const snap = room.sanitizeSnapshot(rawSnapshot());
    assert.strictEqual(room.statusOf(snap, 's_need'), 'need');
    assert.strictEqual(room.statusOf(snap, 's_done'), 'done');
    assert.strictEqual(room.statusOf(snap, 's_busy'), 'busy');
    assert.strictEqual(room.statusOf(snap, 's_idle'), 'idle');
    assert.strictEqual(room.statusOf(snap, 'missing'), 'idle');
    assert.strictEqual(room.statusOf(snap, null), 'idle');
    assert.strictEqual(room.statusOf(snap, 's_idle', { s_idle: { pending: true } }), 'need', '会话面兜底通道');
    const both = room.sanitizeSnapshot({ byId: { s: { running: false, completed: true, pendingInteraction: 'question' } } });
    assert.strictEqual(room.statusOf(both, 's'), 'need');
  });

  await test('子代理聚合：子会话待决点亮父项目；双通道、防环、有界', async () => {
    const snap = room.sanitizeSnapshot(rawSnapshot());
    assert.deepStrictEqual([...room.collectKids(snap, 's_parent')], ['s_kid']);
    assert.strictEqual(room.statusOf(snap, 's_parent'), 'need', '父会话只有 running，子代理 pending 应聚合成 need');
    const cyclic = room.sanitizeSnapshot({
      byId: { a: { running: true, parentId: 'b' }, b: { running: true, parentId: 'a' } },
      subagentsByParent: { a: ['b'], b: ['a'] }
    });
    assert.deepStrictEqual([...room.collectKids(cyclic, 'a')], ['b']);
    const deep = { byId: {} };
    let parent = 'root';
    deep.byId.root = { running: true };
    for (let i = 0; i < 10; i++) { deep.byId[`d${i}`] = { running: true, parentId: parent }; parent = `d${i}`; }
    deep.byId.d9.pendingInteraction = 'question';
    const deepSnap = room.sanitizeSnapshot(deep);
    assert.strictEqual(room.collectKids(deepSnap, 'root').size, room.LIMITS.maxKidsDepth, '深度有界');
    assert.strictEqual(room.statusOf(deepSnap, 'root'), 'busy', '超出深度的待决不再向上传播');
  });

  await test('运行时长：取最早运行中任务；无任务用会话面本轮开始时间；不运行为 null', async () => {
    const snap = room.sanitizeSnapshot(rawSnapshot());
    assert.strictEqual(room.runtimeOf(snap, 's_busy', 10000), 9600);
    assert.strictEqual(room.runtimeOf(snap, 's_parent', 10000), null, 'queued 任务不算');
    assert.strictEqual(room.runtimeOf(snap, 's_parent', 10000, { s_parent: { turnStartedAt: 7000 } }), 3000);
    assert.strictEqual(room.runtimeOf(snap, 's_idle', 10000, { s_idle: { turnStartedAt: 1 } }), null);
    assert.strictEqual(room.runtimeOf(snap, 's_busy', 100), 0, '时钟倒退不出负数');
    assert.strictEqual(room.formatRuntime(3000), '0:03');
    assert.strictEqual(room.formatRuntime(65000), '1:05');
    assert.strictEqual(room.formatRuntime(3661000), '1:01:01');
    assert.strictEqual(room.formatRuntime(-1), '');
  });

  await test('buildCards：卡片、计数、光效、隐藏标记与未绑定项目', async () => {
    const result = room.buildCards({ snapshot: rawSnapshot(), projects: projectsFixture(), now: 10000 });
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.cards[0]));
    const byId = Object.fromEntries(result.cards.map((c) => [c.projectId, c]));
    assert.strictEqual(byId.proj_console.status, 'need');
    assert.strictEqual(byId.proj_console.kids, 1);
    assert.strictEqual(byId.proj_console.glow, true);
    assert.strictEqual(byId.proj_atlas.status, 'done');
    assert.strictEqual(byId.proj_atlas.glow, true);
    assert.strictEqual(byId.proj_fit.status, 'idle');
    assert.strictEqual(byId.proj_arch.status, 'busy');
    assert.strictEqual(byId.proj_arch.glow, false);
    assert.strictEqual(byId.proj_arch.runtimeMs, 9600);
    assert.strictEqual(byId.proj_arch.hidden, true);
    assert.strictEqual(byId.proj_bot.status, 'need');
    assert.strictEqual(byId.proj_unbound.status, 'idle');
    assert.strictEqual(byId.proj_unbound.glow, false);
    assert.strictEqual(byId.proj_unbound.boundSession, null);
    assert.strictEqual(byId.proj_console.statusLabel, room.STATUS_LABELS.need);
    assert.strictEqual(byId.proj_console.sessionTitle, '自媒体工作台');
    assert.deepStrictEqual(result.counts, { need: 2, done: 1, busy: 1, idle: 2, total: 6, glowing: 3 });
    assert.deepStrictEqual(Object.keys(result.seen).sort(), ['s_busy', 's_done', 's_idle', 's_need', 's_parent']);
    assert.match(result.seen.s_parent, /^need:[a-f0-9]{64}$/);
    assert.match(result.seen.s_done, /^done:[a-f0-9]{64}$/);
    assert.strictEqual(result.seen.s_idle, null);
    assert.strictEqual(result.seen.s_busy, null);
    assert.match(result.seen.s_need, /^need:[a-f0-9]{64}$/);
    assert.deepStrictEqual(result.acks, {});
  });

  await test('ack 生命周期：确认后熄光不改事实；need 转移时旧 ack 自动清除并重新点亮', async () => {
    const raw = rawSnapshot();
    const projectsList = projectsFixture();
    let round = room.buildCards({ snapshot: raw, projects: projectsList, now: 10000 });
    // 点开助理机器人 = ack need
    let acks = room.ackSession(round.acks, room.sanitizeSnapshot(raw), 's_need');
    assert.deepStrictEqual(acks, {
      s_need: room.notificationSignature(room.sanitizeSnapshot(raw), 's_need')
    });
    round = room.buildCards({ snapshot: raw, projects: projectsList, acks, seen: round.seen, now: 10000 });
    let bot = round.cards.find((c) => c.projectId === 'proj_bot');
    assert.strictEqual(bot.status, 'need', '事实状态不变');
    assert.strictEqual(bot.glow, false, 'ack 后熄光');
    assert.match(round.acks.s_need, /^need:[a-f0-9]{64}$/, '同一轮内 ack 保留');

    // 问题被回答：need → 无
    const answered = rawSnapshot();
    delete answered.byId.s_need.pendingInteraction;
    round = room.buildCards({ snapshot: answered, projects: projectsList, acks: round.acks, seen: round.seen, now: 10000 });
    assert.strictEqual(round.acks.s_need, undefined, '状态转移清除旧 ack');
    bot = round.cards.find((c) => c.projectId === 'proj_bot');
    assert.strictEqual(bot.status, 'busy');

    // 新问题：无 → need，必须重新点亮
    round = room.buildCards({ snapshot: raw, projects: projectsList, acks: round.acks, seen: round.seen, now: 10000 });
    bot = round.cards.find((c) => c.projectId === 'proj_bot');
    assert.strictEqual(bot.glow, true, '新一轮待决重新点亮');

    // ack 父项目时连带子代理
    acks = room.ackSession({}, room.sanitizeSnapshot(raw), 's_parent');
    assert.deepStrictEqual(acks, {
      s_parent: room.notificationSignature(room.sanitizeSnapshot(raw), 's_parent'),
      s_kid: room.notificationSignature(room.sanitizeSnapshot(raw), 's_kid')
    });

    // done 的 ack
    acks = room.ackSession({}, room.sanitizeSnapshot(raw), 's_done');
    assert.deepStrictEqual(acks, {
      s_done: room.notificationSignature(room.sanitizeSnapshot(raw), 's_done')
    });
    round = room.buildCards({ snapshot: raw, projects: projectsList, acks, now: 10000 });
    assert.strictEqual(round.cards.find((c) => c.projectId === 'proj_atlas').glow, false);

    // idle/busy 不产生 ack；非法 ack 被清洗
    assert.deepStrictEqual(room.ackSession({ junk: 'x', s_idle: 'need' }, room.sanitizeSnapshot(raw), 's_idle'), {});
    assert.deepStrictEqual(room.ackSession({ s_x: 'weird' }, room.sanitizeSnapshot(raw), 's_busy'), {});
  });

  await test('ack 事件签名：done→busy→done 与新增待决子代理都会重新点亮', async () => {
    const projectsList = projectsFixture();
    const first = rawSnapshot();
    let round = room.buildCards({ snapshot: first, projects: projectsList, now: 10000 });
    let acks = room.ackSession({}, room.sanitizeSnapshot(first), 's_done');
    round = room.buildCards({ snapshot: first, projects: projectsList, acks, seen: round.seen, now: 10000 });
    assert.strictEqual(round.cards.find((card) => card.projectId === 'proj_atlas').glow, false);

    const busy = rawSnapshot();
    busy.byId.s_done.completed = false;
    busy.byId.s_done.running = true;
    busy.byId.s_done.updatedAt = 20;
    round = room.buildCards({ snapshot: busy, projects: projectsList, acks: round.acks, seen: round.seen, now: 10000 });
    assert.strictEqual(round.acks.s_done, undefined);
    const doneAgain = rawSnapshot();
    doneAgain.byId.s_done.updatedAt = 21;
    round = room.buildCards({ snapshot: doneAgain, projects: projectsList, acks: round.acks, seen: round.seen, now: 10000 });
    assert.strictEqual(round.cards.find((card) => card.projectId === 'proj_atlas').glow, true);

    acks = room.ackSession({}, room.sanitizeSnapshot(first), 's_parent');
    round = room.buildCards({ snapshot: first, projects: projectsList, acks, now: 10000 });
    assert.strictEqual(round.cards.find((card) => card.projectId === 'proj_console').glow, false);
    const added = rawSnapshot();
    added.byId.s_new = {
      id: 's_new', running: true, parentId: 's_parent', pendingInteraction: 'question', updatedAt: 22
    };
    added.subagentsByParent.s_parent.entries.push({ kind: 'child', id: 's_new' });
    round = room.buildCards({ snapshot: added, projects: projectsList, acks: round.acks, seen: round.seen, now: 10000 });
    assert.strictEqual(round.cards.find((card) => card.projectId === 'proj_console').glow, true);
  });

  await test('纯函数：不修改输入', async () => {
    const raw = rawSnapshot();
    const projectsList = projectsFixture();
    const acks = { s_need: `need:${'a'.repeat(64)}` };
    const seen = { s_need: `need:${'a'.repeat(64)}` };
    const before = JSON.stringify([raw, projectsList, acks, seen]);
    room.buildCards({ snapshot: raw, projects: projectsList, acks, seen, now: 5 });
    room.ackSession(acks, room.sanitizeSnapshot(raw), 's_parent');
    room.transitionAcks({ acks, seen }, room.sanitizeSnapshot(raw), ['s_need', 's_done']);
    assert.strictEqual(JSON.stringify([raw, projectsList, acks, seen]), before);
    assert.throws(() => room.buildCards(null), TypeError);
    const empty = room.buildCards({});
    assert.deepStrictEqual(empty.cards, []);
    assert.strictEqual(empty.counts.total, 0);
  });

  console.log(`\nCONTROL ROOM ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('FAIL  control-room:', error && error.stack ? error.stack : error);
  process.exit(1);
});
