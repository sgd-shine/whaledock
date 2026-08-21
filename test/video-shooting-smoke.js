'use strict';

// 拍摄现场纯 Node smoke：不启动 Electron，不读写磁盘，也不发网络请求。
const assert = require('assert');
const shooting = require('../lib/video-shooting');

const {
  LIMITS,
  SPEEDS,
  FONT_SIZES,
  hashText,
  parseVoiceScript,
  createShootingSession,
  validateCommand,
  reduceSession,
  progress,
  buildSummary,
  planWriteback,
  sameOwnedOutput
} = shooting;

const STRUCTURED_SCRIPT = [
  '# 这个标题不应抢走镜头标记优先级',
  '',
  '[镜头 1 · 约 8 秒]',
  '第一段口播。',
  '',
  '[镜头 2 · 约 12 秒]',
  '第二段口播。'
].join('\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  video-shooting: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  video-shooting: ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => Boolean(error && error.code === code));
}

function sessionFor(text = STRUCTURED_SCRIPT, sourceRelativePath = '03_口播稿/鲸坞实测.md') {
  return createShootingSession(text, {
    sessionId: 'take_20260821_001',
    sourceRelativePath,
    sourceHash: hashText(text)
  });
}

test('结构化镜头标记优先于 Markdown 标题', () => {
  const parsed = parseVoiceScript(STRUCTURED_SCRIPT);
  assert.strictEqual(parsed.format, 'structured');
  assert.deepStrictEqual(parsed.shots.map((shot) => shot.id), ['shot-001', 'shot-002']);
  assert.deepStrictEqual(parsed.shots.map((shot) => shot.sourceNumber), [1, 2]);
  assert.deepStrictEqual(parsed.shots.map((shot) => shot.durationSeconds), [8, 12]);
  assert.strictEqual(parsed.shots[0].text, '第一段口播。');
  assert(!parsed.shots[0].text.includes('这个标题'));
});

test('无镜头标记时按 Markdown 标题分镜', () => {
  const parsed = parseVoiceScript('# 开场\n第一句。\n\n## 演示\n第二句。');
  assert.strictEqual(parsed.format, 'headings');
  assert.deepStrictEqual(parsed.shots.map((shot) => shot.label), ['开场', '演示']);
  assert.deepStrictEqual(parsed.shots.map((shot) => shot.text), ['第一句。', '第二句。']);
});

test('无结构时整稿一镜并剥离首段 front matter', () => {
  const source = '---\ntitle: 测试\n---\n这是完整的一段口播。';
  const parsed = parseVoiceScript(source);
  assert.strictEqual(parsed.format, 'whole');
  assert.strictEqual(parsed.shots.length, 1);
  assert.strictEqual(parsed.shots[0].label, '整稿');
  assert.strictEqual(parsed.shots[0].text, '这是完整的一段口播。');
});

test('超长、超量、控制字符与空镜头全部拒绝', () => {
  throwsCode(
    () => parseVoiceScript('字'.repeat(Math.floor(LIMITS.sourceBytes / 3) + 2)),
    'ERR_SHOOTING_SOURCE_LIMIT'
  );
  const tooMany = Array.from(
    { length: LIMITS.shots + 1 },
    (_, index) => `# 镜头 ${index + 1}\n内容`
  ).join('\n');
  throwsCode(() => parseVoiceScript(tooMany), 'ERR_SHOOTING_SHOT_COUNT');
  throwsCode(() => parseVoiceScript('正常\u0000恶意'), 'ERR_SHOOTING_CONTROL_CHAR');
  throwsCode(
    () => parseVoiceScript('[镜头 1 · 约 8 秒]\n\n[镜头 2 · 约 9 秒]\n有内容'),
    'ERR_SHOOTING_EMPTY_SHOT'
  );
});

test('session 使用调用方身份且默认暂停清单模式', () => {
  const state = sessionFor();
  assert.strictEqual(state.sessionId, 'take_20260821_001');
  assert.strictEqual(state.sourceRelativePath, '03_口播稿/鲸坞实测.md');
  assert.strictEqual(state.sourceHash, hashText(STRUCTURED_SCRIPT));
  assert.strictEqual(state.mode, 'checklist');
  assert.strictEqual(state.paused, true);
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(state.speed, 1);
  assert.strictEqual(state.fontSize, 64);
  assert(state.shots.every((shot) => !shot.confirmed && shot.retakes === 0));
  throwsCode(() => createShootingSession(STRUCTURED_SCRIPT, {
    sessionId: '../escape',
    sourceRelativePath: '稿.md',
    sourceHash: hashText(STRUCTURED_SCRIPT)
  }), 'ERR_SHOOTING_SESSION_ID');
  throwsCode(() => createShootingSession(STRUCTURED_SCRIPT, {
    sessionId: 'safe',
    sourceRelativePath: '../稿.md',
    sourceHash: hashText(STRUCTURED_SCRIPT)
  }), 'ERR_SHOOTING_SOURCE_PATH');
});

test('命令采用精确白名单并拒绝非法 shotId', () => {
  assert.deepStrictEqual(validateCommand({ type: 'mode' }), { type: 'mode' });
  assert.deepStrictEqual(
    validateCommand({ type: 'retake', shotId: 'shot-001', repeat: true }),
    { type: 'retake', shotId: 'shot-001', repeat: true }
  );
  throwsCode(() => validateCommand({ type: 'mode', value: 'teleprompter' }),
    'ERR_SHOOTING_COMMAND_KEYS');
  throwsCode(() => validateCommand({ type: 'delete', shotId: 'shot-001' }),
    'ERR_SHOOTING_COMMAND_TYPE');
  throwsCode(() => validateCommand({ type: 'confirm', shotId: '../../evil' }),
    'ERR_SHOOTING_SHOT_ID');
  throwsCode(() => reduceSession(sessionFor(), { type: 'confirm', shotId: 'shot-099' }),
    'ERR_SHOOTING_UNKNOWN_SHOT');
});

test('R 重来只计首次 keydown，repeat 事件完全忽略', () => {
  const initial = sessionFor();
  const ignored = reduceSession(initial, { type: 'retake', shotId: 'shot-001', repeat: true });
  assert.strictEqual(ignored, initial);
  const once = reduceSession(initial, { type: 'retake', shotId: 'shot-001' });
  assert.strictEqual(once.shots[0].retakes, 1);
  const ignoredAgain = reduceSession(once, {
    type: 'retake', shotId: 'shot-001', repeat: true
  });
  assert.strictEqual(ignoredAgain, once);
  const twice = reduceSession(once, { type: 'retake', shotId: 'shot-001', repeat: false });
  assert.strictEqual(twice.shots[0].retakes, 2);
});

test('翻到段尾不算完成，只有显式确认才进入进度', () => {
  const initial = sessionFor();
  const atEnd = reduceSession(reduceSession(initial, { type: 'next' }), { type: 'next' });
  assert.strictEqual(atEnd.currentIndex, 1);
  assert.deepStrictEqual(progress(atEnd), {
    total: 2, confirmed: 0, missing: 2, ratio: 0, percent: 0
  });
  const confirmed = reduceSession(atEnd, { type: 'confirm', shotId: 'shot-002' });
  assert.deepStrictEqual(progress(confirmed), {
    total: 2, confirmed: 1, missing: 1, ratio: 0.5, percent: 50
  });
});

test('已确认镜头可以反勾且重来会撤销确认', () => {
  const initial = sessionFor();
  const checked = reduceSession(initial, { type: 'confirm', shotId: 'shot-001' });
  assert.strictEqual(checked.shots[0].confirmed, true);
  const unchecked = reduceSession(checked, { type: 'unconfirm', shotId: 'shot-001' });
  assert.strictEqual(unchecked.shots[0].confirmed, false);
  const checkedAgain = reduceSession(unchecked, { type: 'confirm', shotId: 'shot-001' });
  const retaken = reduceSession(checkedAgain, { type: 'retake', shotId: 'shot-001' });
  assert.strictEqual(retaken.shots[0].confirmed, false);
  assert.strictEqual(retaken.shots[0].retakes, 1);
});

test('模式、空格暂停、速度与字号都只走有限状态', () => {
  let state = sessionFor();
  state = reduceSession(state, { type: 'mode' });
  assert.strictEqual(state.mode, 'teleprompter');
  state = reduceSession(state, { type: 'pause' });
  assert.strictEqual(state.paused, false);
  state = reduceSession(state, { type: 'set-speed', speed: SPEEDS[0] });
  state = reduceSession(state, { type: 'set-font', fontSize: FONT_SIZES.at(-1) });
  assert.strictEqual(state.speed, SPEEDS[0]);
  assert.strictEqual(state.fontSize, FONT_SIZES.at(-1));
  throwsCode(() => validateCommand({ type: 'set-speed', speed: 0.61 }),
    'ERR_SHOOTING_SPEED');
  throwsCode(() => validateCommand({ type: 'set-font', fontSize: 41 }),
    'ERR_SHOOTING_FONT');
});

test('部分收工摘要分开 confirmed、missing、retakes 与 gaps', () => {
  let state = sessionFor();
  state = reduceSession(state, { type: 'confirm', shotId: 'shot-001' });
  state = reduceSession(state, { type: 'retake', shotId: 'shot-002' });
  state = reduceSession(state, {
    type: 'set-gap', shotId: 'shot-002', reason: '缺数据画面'
  });
  state = reduceSession(state, { type: 'finish-preview' });
  const summary = buildSummary(state);
  assert.strictEqual(summary.confirmedCount, 1);
  assert.strictEqual(summary.missingCount, 1);
  assert.deepStrictEqual(summary.confirmed.map((shot) => shot.shotId), ['shot-001']);
  assert.deepStrictEqual(summary.missing.map((shot) => shot.shotId), ['shot-002']);
  assert.strictEqual(summary.retakes[0].count, 1);
  assert.strictEqual(summary.gaps[0].reason, '缺数据画面');
  assert.strictEqual(summary.gaps[0].provided, true);
});

test('全部确认也保留独立空缺口清单', () => {
  let state = sessionFor();
  for (const shot of state.shots) {
    state = reduceSession(state, { type: 'confirm', shotId: shot.id });
  }
  state = reduceSession(state, { type: 'finish-preview' });
  state = reduceSession(state, { type: 'finish-confirm' });
  const summary = buildSummary(state);
  assert.strictEqual(summary.status, 'finished');
  assert.strictEqual(summary.allConfirmed, true);
  assert.strictEqual(summary.confirmedCount, 2);
  assert.strictEqual(summary.missingCount, 0);
  assert.deepStrictEqual(summary.gaps, []);
  const plan = planWriteback(summary);
  assert(plan.gaps.content.includes('本次收工没有未确认镜头。'));
});

test('未填缺口原因保持 null，写回时明确标成原因未填写', () => {
  let state = sessionFor();
  state = reduceSession(state, { type: 'set-gap', shotId: 'shot-001', reason: '   ' });
  state = reduceSession(state, { type: 'finish-preview' });
  state = reduceSession(state, { type: 'finish-confirm' });
  const summary = buildSummary(state);
  assert.strictEqual(summary.gaps[0].reason, null);
  assert.strictEqual(summary.gaps[0].provided, false);
  const plan = planWriteback(summary);
  assert(plan.record.content.includes('原因未填写'));
  assert(plan.gaps.content.includes('原因未填写'));
  throwsCode(() => validateCommand({
    type: 'set-gap', shotId: 'shot-001', reason: '缺'.repeat(LIMITS.gapChars + 1)
  }), 'ERR_SHOOTING_GAP');
});

test('写回只规划两个安全、确定性、wx 相对文件', () => {
  let state = sessionFor(STRUCTURED_SCRIPT, '03_口播稿/..恶意:稿件?.md');
  state = reduceSession(state, { type: 'finish-preview' });
  state = reduceSession(state, { type: 'finish-confirm' });
  const summary = buildSummary(state);
  const first = planWriteback(summary);
  const second = planWriteback(summary);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.files.length, 2);
  assert(first.record.relativePath.startsWith('05_拍摄记录/'));
  assert(first.gaps.relativePath.startsWith('04_素材清单/'));
  for (const output of first.files) {
    assert.strictEqual(output.flag, 'wx');
    assert.strictEqual(output.encoding, 'utf8');
    assert(!output.relativePath.startsWith('/'));
    assert(!output.relativePath.includes('..'));
    assert(!/[\\:*?"<>|]/.test(output.relativePath));
    assert(output.content.startsWith('<!-- whaledock-owned: video-shooting/v1 -->'));
    assert(output.content.endsWith('\n'));
  }
  assert(first.record.content.includes('原口播稿未修改'));
});

test('收工必须先预览，预览后编辑会回到 active', () => {
  const initial = sessionFor();
  throwsCode(() => planWriteback(buildSummary(initial)), 'ERR_SHOOTING_SUMMARY_STATUS');
  throwsCode(() => reduceSession(initial, { type: 'finish-confirm' }),
    'ERR_SHOOTING_FINISH_PHASE');
  const preview = reduceSession(initial, { type: 'finish-preview' });
  assert.strictEqual(preview.status, 'preview');
  assert.strictEqual(preview.paused, true);
  const edited = reduceSession(preview, {
    type: 'set-gap', shotId: 'shot-001', reason: '需要补录'
  });
  assert.strictEqual(edited.status, 'active');
  const finished = reduceSession(
    reduceSession(edited, { type: 'finish-preview' }),
    { type: 'finish-confirm' }
  );
  assert.strictEqual(finished.status, 'finished');
  throwsCode(() => reduceSession(finished, { type: 'pause' }), 'ERR_SHOOTING_FINISHED');
});

test('幂等只认完整内容字节一致，任何冲突都不冒充相同', () => {
  let state = sessionFor();
  state = reduceSession(state, { type: 'finish-preview' });
  state = reduceSession(state, { type: 'finish-confirm' });
  const planned = planWriteback(buildSummary(state)).record;
  assert.strictEqual(sameOwnedOutput(planned.content, planned), true);
  assert.strictEqual(sameOwnedOutput(Buffer.from(planned.content, 'utf8'), planned), true);
  assert.strictEqual(sameOwnedOutput(`${planned.content}篡改`, planned), false);
  assert.strictEqual(sameOwnedOutput({ content: planned.content.slice(0, -1) }, planned), false);
  assert.strictEqual(sameOwnedOutput('é', 'e\u0301'), false);
  assert.strictEqual(sameOwnedOutput({ wrong: planned.content }, planned), false);
});

if (failed) {
  console.error(`VIDEO SHOOTING FAIL  (${passed} passed, ${failed} failed)`);
  process.exitCode = 1;
} else {
  console.log(`VIDEO SHOOTING ALL PASS (${passed})`);
}
