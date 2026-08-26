'use strict';

// v0.7 视频驾驶舱 Electron 薄层：验证 renderer 永远只能提交 opaque token/有限命令，
// 发布灯、建议版本、拍摄写回与本地窗口都 fail-closed。
process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const main = require('../main');
const cockpit = require('../lib/video-cockpit');
const shooting = require('../lib/video-shooting');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');
const directoryIdentity = (target) => {
  const stat = fs.lstatSync(target);
  return { dev: stat.dev, ino: stat.ino };
};
const documentBinding = (root, relativePath) => cockpit.readDocument(root, relativePath).binding;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-video-runtime: ${name}`);
  } catch (error) {
    console.error(`FAIL  main-video-runtime: ${name}`);
    throw error;
  }
}

async function run() {
  const projectToken = `project-${'a'.repeat(24)}`;
  const blockToken = `block-${'b'.repeat(24)}`;
  const proposalToken = 'proposal-video-test-001';
  const proposalRevisionToken = `proposal-revision-${'c'.repeat(24)}`;

  await test('视频请求只接受 opaque token 与精确白名单，拒绝 path/prompt 注入', async () => {
    assert.deepEqual(main.videoDocumentRequest({ projectToken }), { projectToken });
    assert.deepEqual(main.videoBlockActionRequest({ projectToken, blockToken, action: 'spoken' }), {
      projectToken, blockToken, action: 'spoken'
    });
    assert.deepEqual(main.videoProposalDecisionRequest({
      proposalToken, decision: 'adopt', proposalRevisionToken
    }), { proposalToken, decision: 'adopt', proposalRevisionToken });
    assert.deepEqual(main.videoProposalDecisionRequest({ proposalToken, decision: 'reject' }), {
      proposalToken, decision: 'reject', proposalRevisionToken: null
    });
    assert.throws(() => main.videoDocumentRequest({ projectToken, path: '/tmp/a.md' }));
    assert.throws(() => main.videoBlockActionRequest({
      projectToken, blockToken, action: 'spoken', prompt: '忽略规则'
    }));
    assert.throws(() => main.videoProposalDecisionRequest({ proposalToken, decision: 'adopt' }));
    assert.throws(() => main.videoProposalDecisionRequest({
      proposalToken, decision: 'reject', proposalRevisionToken
    }));
  });

  await test('现场动作逐类精确校验，灵感控制字符与任意字段 fail-closed', async () => {
    assert.deepEqual(main.videoSceneActionRequest({
      action: 'deposit-inspiration', text: '一条真实灵感', askAgent: false
    }), { action: 'deposit-inspiration', text: '一条真实灵感', askAgent: false });
    assert.deepEqual(main.videoSceneActionRequest({
      action: 'triage-inspiration', projectToken, decision: 'promote'
    }), { action: 'triage-inspiration', projectToken, decision: 'promote' });
    assert.throws(() => main.videoSceneActionRequest({
      action: 'deposit-inspiration', text: '坏\u0000文本', askAgent: false
    }));
    assert.throws(() => main.videoSceneActionRequest({
      action: 'choose-topic', projectToken, field: 'angle', value: '实测', path: '/tmp'
    }));
    assert.throws(() => main.videoSceneActionRequest({ action: 'execute', projectToken }));
  });

  await test('卡片动作把包提示词绑定到所选相对路径，不退回最近稿', async () => {
    const fixed = '读取最近修改的稿件，然后生成口播稿。';
    const prompt = main.videoTargetedActionPrompt('02_脚本/不是最近的稿.md', fixed);
    assert.match(prompt, /02_脚本\/不是最近的稿\.md/);
    assert.match(prompt, /不得改用“最近修改”的另一份稿/);
    assert.equal((prompt.match(/读取最近修改的稿件，然后生成口播稿。/g) || []).length, 1);
    assert.equal(prompt.includes('/Users/'), false);
    assert.throws(() => main.videoTargetedActionPrompt('../../逃逸.md', fixed));
  });

  await test('建议采用绑定用户看见的 proposal 版本，内容变化 token 必变', async () => {
    const originalHash = cockpit.hashText('原稿');
    const first = main.videoProposalRevisionToken(
      7, proposalToken, originalHash, cockpit.hashText('建议 A')
    );
    const second = main.videoProposalRevisionToken(
      7, proposalToken, originalHash, cockpit.hashText('建议 B')
    );
    assert.match(first, /^proposal-revision-[a-f0-9]{24}$/);
    assert.notEqual(first, second);
    assert.equal(first, main.videoProposalRevisionToken(
      7, proposalToken, originalHash, cockpit.hashText('建议 A')
    ));
    const originalBinding = {
      rootDev: '1', rootIno: '2', parentDev: '3', parentIno: '4', fileDev: '5', fileIno: '6'
    };
    const proposalBinding = {
      rootDev: '1', rootIno: '2', parentDev: '7', parentIno: '8', fileDev: '9', fileIno: '10'
    };
    const bound = main.videoProposalRevisionToken(
      7, proposalToken, originalHash, cockpit.hashText('建议 A'),
      originalBinding, proposalBinding
    );
    assert.notEqual(bound, first);
    assert.notEqual(bound, main.videoProposalRevisionToken(
      7, proposalToken, originalHash, cockpit.hashText('建议 A'),
      { ...originalBinding, fileIno: '11' }, proposalBinding
    ));
    assert.throws(() => main.videoProposalRevisionToken(
      7, proposalToken, originalHash, cockpit.hashText('建议 A'), originalBinding
    ));
  });

  await test('发布灯区分 ready 与 published，AI 状态不能被假绿灯绕过', async () => {
    const checklist = [
      '- [x] 封面 <!-- whaledock:cover -->',
      '- [x] 标题 <!-- whaledock:title -->',
      '- [x] 话题 <!-- whaledock:topics -->',
      '- [x] 时间 <!-- whaledock:timing -->',
      '- [x] 置顶 <!-- whaledock:pinned-comment -->',
      '- [ ] AI 标识 <!-- whaledock:ai-label -->',
      '- [ ] 本人发布 <!-- whaledock:published -->', ''
    ].join('\n');
    const unknown = main.publishChecklistSurface(checklist, 'unknown');
    assert.equal(unknown.structureValid, true);
    assert.deepEqual(unknown.lights.map((light) => light.id), [
      'cover', 'title', 'topics', 'timing', 'pinned-comment', 'ai-label', 'published'
    ]);
    assert.equal(unknown.ready, false);
    assert.equal(unknown.lights.find((light) => light.id === 'ai-label').satisfied, false);
    const notAi = main.publishChecklistSurface(checklist, 'not-ai');
    assert.equal(notAi.ready, true);
    assert.equal(notAi.published, false);
    assert.equal(notAi.lights.find((light) => light.id === 'ai-label').checked, false);
    assert.equal(notAi.lights.find((light) => light.id === 'ai-label').satisfied, true);
    assert.equal(main.publishChecklistSurface(checklist, 'ai').ready, false);
    const aiChecked = main.patchPublishLight(
      checklist, 'ai-label', true, cockpit.hashText(checklist)
    );
    assert.equal(main.publishChecklistSurface(aiChecked, 'ai').ready, true);
    assert.equal(main.publishChecklistSurface(aiChecked, 'ai').published, false);
  });

  await test('单灯写回只改目标 marker，错误 hash 原文不动', async () => {
    const text = [
      '- [ ] 封面 <!-- whaledock:cover -->',
      '- [ ] 标题 <!-- whaledock:title -->',
      '- [ ] 话题 <!-- whaledock:topics -->',
      '- [ ] 时间 <!-- whaledock:timing -->',
      '- [ ] 置顶 <!-- whaledock:pinned-comment -->',
      '- [ ] AI 标识 <!-- whaledock:ai-label -->',
      '- [ ] 本人发布 <!-- whaledock:published -->', ''
    ].join('\n');
    const patched = main.patchPublishLight(text, 'cover', true, cockpit.hashText(text));
    assert.equal(patched.split('\n')[0], '- [x] 封面 <!-- whaledock:cover -->');
    assert.equal(patched.split('\n').slice(1).join('\n'), text.split('\n').slice(1).join('\n'));
    assert.throws(() => main.patchPublishLight(text, 'cover', true, '0'.repeat(64)), (error) => (
      error && error.code === 'ERR_CAS_MISMATCH'
    ));
  });

  await test('七灯 marker 缺失、重复、空白变体与同行双 marker 均 fail-closed', async () => {
    const lines = [
      '- [ ] 封面 <!-- whaledock:cover -->',
      '- [ ] 标题 <!-- whaledock:title -->',
      '- [ ] 话题 <!-- whaledock:topics -->',
      '- [ ] 时间 <!-- whaledock:timing -->',
      '- [ ] 置顶 <!-- whaledock:pinned-comment -->',
      '- [ ] AI 标识 <!-- whaledock:ai-label -->',
      '- [ ] 本人发布 <!-- whaledock:published -->', ''
    ];
    const missing = lines.filter((line) => !line.includes('whaledock:title')).join('\n');
    const duplicate = `${lines.join('\n')}- [ ] 封面备份 <!--  whaledock: cover  -->\n`;
    const unknown = `${lines.join('\n')}- [ ] 未知 <!-- whaledock:extra -->\n`;
    const doubleOnOneLine = lines.join('\n').replace(
      '- [ ] 封面 <!-- whaledock:cover -->\n- [ ] 标题 <!-- whaledock:title -->',
      '- [ ] 封面与标题 <!-- whaledock:cover --> <!-- whaledock:title -->'
    );
    for (const text of [missing, duplicate, unknown, doubleOnOneLine]) {
      assert.equal(main.publishChecklistSurface(text, 'unknown').structureValid, false);
      assert.throws(() => main.patchPublishLight(
        text, 'cover', true, cockpit.hashText(text)
      ));
    }
  });

  await test('脏 published 不假绿且任一前置灯或 AI 状态变化都清除原始勾选', async () => {
    const makeDocument = (aiDisclosure, cover = false, aiLabel = false) => {
      const text = [
        '---', 'title: 发布检查', 'stage: publish', `aiDisclosure: ${aiDisclosure}`,
        'updated: 2026-08-25T10:00:00.000Z', '---', '',
        `- [${cover ? 'x' : ' '}] 封面 <!-- whaledock:cover -->`,
        '- [x] 标题 <!-- whaledock:title -->',
        '- [x] 话题 <!-- whaledock:topics -->',
        '- [x] 时间 <!-- whaledock:timing -->',
        '- [x] 置顶 <!-- whaledock:pinned-comment -->',
        `- [${aiLabel ? 'x' : ' '}] AI 标识 <!-- whaledock:ai-label -->`,
        '- [x] 本人发布 <!-- whaledock:published -->', ''
      ].join('\n');
      return {
        stage: 'publish', text, hash: cockpit.hashText(text),
        fields: cockpit.parseFrontMatter(text).fields
      };
    };
    const dirty = makeDocument('not-ai', false);
    const dirtySurface = main.publishChecklistSurface(dirty.text, 'not-ai');
    assert.equal(dirtySurface.structureValid, true);
    assert.equal(dirtySurface.lights.find((light) => light.id === 'published').checked, true);
    assert.equal(dirtySurface.published, false, '原始勾选不得绕过 ready');
    const completed = main.patchVideoPublishDocument(dirty, {
      action: 'toggle-publish-light', lightId: 'cover', checked: true
    }, Date.parse('2026-08-25T10:00:01.000Z'));
    assert.equal(completed.surface.ready, true);
    assert.equal(completed.surface.published, false);
    assert.equal(completed.surface.lights.find((light) => light.id === 'published').checked, false,
      '补最后一盏灯不得自动复活旧 published');
    assert.equal(cockpit.parseFrontMatter(completed.text).fields.updated,
      '2026-08-25T10:00:01.000Z');

    const unknown = makeDocument('unknown', true);
    const disclosed = main.patchVideoPublishDocument(unknown, {
      action: 'set-ai-disclosure', value: 'not-ai'
    }, Date.parse('2026-08-25T10:00:02.000Z'));
    assert.equal(disclosed.surface.ready, true);
    assert.equal(disclosed.surface.published, false);
    assert.equal(disclosed.surface.lights.find((light) => light.id === 'published').checked, false,
      'AI 状态变化也必须清旧 published');
    const dirtyNotAi = makeDocument('not-ai', true, true);
    const normalizedNotAi = main.patchVideoPublishDocument(dirtyNotAi, {
      action: 'set-ai-disclosure', value: 'not-ai'
    }, Date.parse('2026-08-25T10:00:03.000Z'));
    assert.equal(normalizedNotAi.surface.aiDisclosure, 'not-ai');
    assert.equal(normalizedNotAi.surface.lights.find(
      (light) => light.id === 'ai-label'
    ).checked, false, 'not-ai 同值写回也必须清理外部脏 AI 灯');
    assert.equal(normalizedNotAi.surface.lights.find(
      (light) => light.id === 'published'
    ).checked, false, '同值披露引发前置 AI 灯变化时也必须清 raw published');
    assert.equal(normalizedNotAi.surface.published, false);
    assert.throws(() => main.patchVideoPublishDocument(makeDocument('ai', false), {
      action: 'toggle-publish-light', lightId: 'published', checked: true
    }));
  });

  await test('发布检查单终态回读再次验证 08 目录与 canonical source', async () => {
    const runtime = { epoch: 9 };
    const relativePath = '08_发布检查/项目A-发布检查.md';
    const sourceRelativePath = '02_脚本/项目A.md';
    const identity = {
      projectToken: `project-${'a'.repeat(24)}`,
      contentRef: main.videoContentRef(runtime.epoch, relativePath)
    };
    const read = () => ({
      record: { relativePath },
      document: { stage: 'publish', fields: { source: sourceRelativePath } }
    });
    assert.equal(main.assertVideoPublishIdentitySource(
      runtime, identity, sourceRelativePath, read
    ), true);
    for (const changed of [
      { record: { relativePath }, document: { stage: 'publish', fields: { source: '02_脚本/B.md' } } },
      { record: { relativePath: '02_脚本/假发布.md' }, document: { stage: 'publish', fields: { source: sourceRelativePath } } },
      { record: { relativePath }, document: { stage: 'script', fields: { source: sourceRelativePath } } }
    ]) {
      assert.throws(() => main.assertVideoPublishIdentitySource(
        runtime, identity, sourceRelativePath, () => changed
      ), (error) => error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN');
    }

    const longSource = `02_脚本/${'a'.repeat(150)}/${'b'.repeat(150)}/${'c'.repeat(80)}  two  spaces---x.md`;
    assert.equal(longSource.length > 400, true);
    assert.equal(cockpit.safeRelativePath(longSource), longSource);
    const longText = main.videoPublishChecklistText({
      stage: 'script', relativePath: longSource, title: '长路径项目'
    }, Date.parse('2026-08-25T10:00:03.000Z'));
    const parsed = cockpit.parseFrontMatter(longText);
    assert.equal(parsed.fields.source, longSource,
      'source 身份字段不得裁剪、折叠空格或改写 ---');
    assert.equal(main.publishChecklistSurface(
      longText, parsed.fields.aiDisclosure
    ).structureValid, true);
    assert.equal(main.assertVideoPublishIdentitySource(
      runtime, identity, longSource,
      () => ({
        record: { relativePath },
        document: {
          stage: 'publish', fields: { source: longSource }, issues: []
        }
      })
    ), true, '长 canonical source 必须能在创建后终态回读');
    const lossyWhitespaceSource = `\u00a0script.md`;
    assert.equal(cockpit.safeRelativePath(lossyWhitespaceSource), lossyWhitespaceSource,
      '回归覆盖 safeRelativePath 仍放行但 front matter 会 trim 的边界');
    assert.throws(() => main.videoPublishChecklistText({
      stage: 'script', relativePath: lossyWhitespaceSource, title: '空白路径'
    }), /无法无损写入/,
    'source 不能 front matter 无损往返时必须在创建前拒绝');
  });

  await test('复盘打法 revision key、确定性正文与 UTF-8 摘要精确收口', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-tactic-pure-')));
    const relativePath = '07_打法库/复盘  two---spaces.md';
    const target = path.join(root, relativePath);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, [
        '---', 'title: 真实复盘', 'stage: review',
        'updated: 2026-08-25T12:00:00.000Z', '---', '',
        '第一段是实际可复用经验。', '', '第二段不应进入首屏摘要。', ''
      ].join('\n'), 'utf8');
      const document = cockpit.readDocument(root, relativePath);
      const expected = crypto.createHash('sha256')
        .update(`review-tactic/v1\0${relativePath}\0${document.hash}`, 'utf8')
        .digest('hex');
      assert.equal(main.videoTacticRevisionKey(relativePath, document.hash), expected);
      assert.equal(main.videoTacticRelativePath(relativePath, document.hash),
        `07_打法库/打法-${expected}.md`);
      assert.equal(main.videoTacticRelativePath(relativePath, document.hash),
        main.videoTacticRelativePath(relativePath, document.hash),
      '目标不得依赖时钟或 title');
      const first = main.videoTacticText(document);
      const second = main.videoTacticText({ ...document, title: document.title });
      assert.equal(second, first, '同 source revision 必须字节级确定');
      const parsed = cockpit.parseFrontMatter(first);
      assert.equal(parsed.fields.source, relativePath);
      assert.equal(parsed.fields.topicId, `tactic-${expected}`);
      assert.equal(parsed.fields.updated, '2026-08-25T12:00:00.000Z');
      const summary = main.videoTacticSummary(parsed.body);
      assert.equal(summary.summary, '第一段是实际可复用经验。');
      assert.equal(summary.summaryTruncated, false);
      const clipped = main.videoTacticSummary(`\n# 标题\n\n${'鲸'.repeat(200)}\n`);
      assert.equal(Buffer.byteLength(clipped.summary, 'utf8') <= 240, true);
      assert.equal(clipped.summaryTruncated, true);
      assert.deepEqual(main.videoTacticSummary('\n# 只有标题\n\n> 只有说明\n'), {
        summary: null, summaryTruncated: false
      });

      const longUpdated = {
        ...document,
        fields: { ...document.fields, updated: 'u'.repeat(65) }
      };
      assert.equal(cockpit.parseFrontMatter(
        main.videoTacticText(longUpdated)
      ).fields.updated, undefined, '超过 64 字符的 source updated 必须省略');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('打法库 collection 只绑定有序 asset 版本，漂移与 A→B→A 可精确识别', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-tactic-list-')));
    const rootStat = fs.lstatSync(root);
    const sourceRelativePath = '02_脚本/复盘源.md';
    const sourcePath = path.join(root, sourceRelativePath);
    const assetTexts = new Map([
      ['07_打法库/z-last.md', [
        '---', 'title: Z 打法', 'stage: asset', 'status: active',
        `source: ${sourceRelativePath}`, '---', '', '# 标题', '', '第二条经验。', ''
      ].join('\n')],
      ['07_打法库/a-first.md', [
        '---', 'title: A 打法', 'stage: asset', 'status: active',
        `source: ${sourceRelativePath}`, '---', '', '# 标题', '', '第一条经验。', ''
      ].join('\n')]
    ]);
    const runtime = {
      root, epoch: 13, rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
      closed: false, projectTokens: new Map(), recoveryIssues: []
    };
    const scan = () => {
      const scanned = cockpit.scanWorkspace(root, { expectedRootIdentity: runtime.rootIdentity });
      runtime.projectTokens = new Map(scanned.items.map((item) => [
        main.videoProjectToken(runtime.epoch, item.relativePath, item.hash),
        { relativePath: item.relativePath, hash: item.hash, stage: item.stage }
      ]));
      return scanned;
    };
    try {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, [
        '---', 'title: 复盘源 A', 'stage: review', '---', '', '真实复盘正文。', ''
      ].join('\n'), 'utf8');
      for (const [relativePath, text] of assetTexts) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text, 'utf8');
      }
      let scanned = scan();
      const initial = main.videoTacticCollection(runtime, { refresh: false, scanned });
      assert.match(initial.collectionToken, /^collection-[a-f0-9]{24}$/);
      assert.equal(initial.complete, true);
      assert.deepEqual(initial.tactics.map((item) => item.title), ['A 打法', 'Z 打法'],
        '页面资产必须按 canonical relativePath 稳定排序');
      assert.deepEqual(initial.tactics.map((item) => item.sourceTitle), ['复盘源 A', '复盘源 A']);

      fs.writeFileSync(sourcePath, [
        '---', 'title: 复盘源 B', 'stage: review', '---', '', '真实复盘正文。', ''
      ].join('\n'), 'utf8');
      scanned = scan();
      const sourceTitleChanged = main.videoTacticCollection(runtime, {
        refresh: false, scanned
      });
      assert.equal(sourceTitleChanged.collectionToken, initial.collectionToken,
        'authoritative token 只绑定 asset(path,hash)，不混入 sourceTitle');
      assert.deepEqual(sourceTitleChanged.tactics.map((item) => item.sourceTitle),
        ['复盘源 B', '复盘源 B']);

      runtime.recoveryIssues = [{ relativePath: null }];
      const partial = main.videoTacticCollection(runtime, { refresh: false, scanned });
      assert.equal(partial.complete, false);
      assert.equal(partial.collectionToken, initial.collectionToken,
        'complete 由页面独立对账，不扩进 asset-only digest');
      runtime.recoveryIssues = [];

      const changedAsset = '07_打法库/a-first.md';
      fs.writeFileSync(path.join(root, changedAsset), `${assetTexts.get(changedAsset)}\nB revision\n`,
        'utf8');
      scanned = scan();
      const changed = main.videoTacticCollection(runtime, { refresh: false, scanned });
      assert.notEqual(changed.collectionToken, initial.collectionToken,
        '任一 asset hash 变化必须使后页 token 过期');

      fs.writeFileSync(path.join(root, changedAsset), assetTexts.get(changedAsset), 'utf8');
      scanned = scan();
      const restored = main.videoTacticCollection(runtime, { refresh: false, scanned });
      assert.equal(restored.collectionToken, initial.collectionToken,
        'A→B→A 回到同一有序 asset 快照时 token 也回到 A');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('打法语义去重兼容唯一 legacy，重复、冲突与不完整扫描全部停写', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-tactic-dedupe-')));
    const sourceRelativePath = '02_脚本/复盘.md';
    const sourcePath = path.join(root, sourceRelativePath);
    const rootStat = fs.lstatSync(root);
    const runtime = {
      root, epoch: 12, rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
      closed: false, projectTokens: new Map(), recoveryIssues: []
    };
    try {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.mkdirSync(path.join(root, '07_打法库'), { recursive: true });
      fs.writeFileSync(sourcePath, [
        '---', 'title: 复盘 A', 'stage: review', '---', '', '真实打法内容。', ''
      ].join('\n'), 'utf8');
      const sourceDocument = cockpit.readDocument(root, sourceRelativePath);
      const deterministicText = main.videoTacticText(sourceDocument);
      const legacyRelative = '07_打法库/旧随机打法.md';
      const legacyText = deterministicText
        .replace(/^topicId:.*\n/m, '')
        .replace(/^---\n# 从复盘固化/m, '---\n\n# 从复盘固化');
      fs.writeFileSync(path.join(root, legacyRelative), legacyText, 'utf8');
      assert.equal(cockpit.readDocument(root, legacyRelative).body,
        main.videoTacticLegacyBodyText(sourceDocument),
      '旧随机 writer 的 closing --- 后精确多一个空行');
      let matches = main.findVideoTacticDocumentsByRevision(runtime, sourceDocument);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].classification, 'legacy');

      const deterministicRelative = main.videoTacticRelativePath(
        sourceRelativePath, sourceDocument.hash
      );
      fs.writeFileSync(path.join(root, deterministicRelative), deterministicText, 'utf8');
      assert.throws(() => main.findVideoTacticDocumentsByRevision(runtime, sourceDocument),
        /\u591a份打法/);
      fs.unlinkSync(path.join(root, legacyRelative));
      matches = main.findVideoTacticDocumentsByRevision(runtime, sourceDocument);
      assert.equal(matches[0].classification, 'current');

      fs.writeFileSync(path.join(root, deterministicRelative),
        deterministicText.replace('真实打法内容。', '被外部改坏的内容。'), 'utf8');
      assert.throws(() => main.findVideoTacticDocumentsByRevision(runtime, sourceDocument),
        /\u6b63文冲突/);

      assert.throws(() => main.findVideoTacticDocumentsByRevision(
        runtime, sourceDocument, { scanned: { items: [], issues: [], truncated: true } }
      ), /\u626b描不完整/);
      assert.throws(() => main.findVideoTacticDocumentsByRevision(
        runtime, sourceDocument, {
          scanned: {
            items: [], truncated: false,
            issues: [{ relativePath: '07_打法库/坏链接.md', reason: 'path-symlink' }]
          }
        }
      ), /\u626b描不完整/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('打法固化 0→1 与重试幂等，可能写入后 source 漂移只能 outcome-unknown', async () => {
    const makeFixture = (sourceRelativePath = '02_脚本/复盘.md') => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-tactic-write-')));
      const sourcePath = path.join(root, sourceRelativePath);
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, [
        '---', 'title: 复盘固化', 'stage: review',
        'updated: 2026-08-25T12:30:00.000Z', '---', '', '已验证的打法正文。', ''
      ].join('\n'), 'utf8');
      const stat = fs.lstatSync(root);
      const runtime = {
        root, epoch: 21, rootIdentity: { dev: stat.dev, ino: stat.ino },
        closed: false, projectTokens: new Map(), recoveryIssues: []
      };
      const sourceDocument = cockpit.readDocument(root, sourceRelativePath);
      const sourceToken = main.videoProjectToken(
        runtime.epoch, sourceRelativePath, sourceDocument.hash
      );
      const rebuild = () => {
        const scanned = cockpit.scanWorkspace(root, { expectedRootIdentity: runtime.rootIdentity });
        runtime.projectTokens = new Map(scanned.items.map((item) => [
          main.videoProjectToken(runtime.epoch, item.relativePath, item.hash),
          { relativePath: item.relativePath, hash: item.hash, stage: item.stage }
        ]));
      };
      const readByToken = (token) => {
        const record = runtime.projectTokens.get(token);
        if (!record) {
          const error = new Error('过期'); error.code = 'ERR_CONTEXT_PROJECT_STALE'; throw error;
        }
        return { runtime, record, document: cockpit.readDocument(root, record.relativePath) };
      };
      rebuild();
      return { root, runtime, sourceDocument, sourceToken, rebuild, readByToken, sourcePath };
    };

    const fixture = makeFixture();
    try {
      const options = {
        refresh: fixture.rebuild,
        readSource: fixture.readByToken,
        readTactic: fixture.readByToken
      };
      const first = main.solidifyVideoTactic(
        fixture.runtime, fixture.sourceDocument, fixture.sourceToken, options
      );
      const second = main.solidifyVideoTactic(
        fixture.runtime, fixture.sourceDocument, fixture.sourceToken, options
      );
      assert.deepEqual([first.created, second.created], [true, false]);
      assert.equal(first.contentRef, second.contentRef);
      assert.equal(first.projectToken, second.projectToken);
      assert.equal(fs.readdirSync(path.join(fixture.root, '07_打法库')).length, 1);
      const created = cockpit.readDocument(
        fixture.root,
        main.videoTacticRelativePath(
          fixture.sourceDocument.relativePath, fixture.sourceDocument.hash
        )
      );
      assert.equal(created.fields.source, fixture.sourceDocument.relativePath);
      assert.equal(created.fields.topicId,
        `tactic-${main.videoTacticRevisionKey(
          fixture.sourceDocument.relativePath, fixture.sourceDocument.hash
        )}`);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }

    const sameDirectoryFixture = makeFixture('07_打法库/真实复盘.md');
    try {
      const options = {
        refresh: sameDirectoryFixture.rebuild,
        readSource: sameDirectoryFixture.readByToken,
        readTactic: sameDirectoryFixture.readByToken
      };
      const result = main.solidifyVideoTactic(
        sameDirectoryFixture.runtime,
        sameDirectoryFixture.sourceDocument,
        sameDirectoryFixture.sourceToken,
        options
      );
      const reused = main.solidifyVideoTactic(
        sameDirectoryFixture.runtime,
        sameDirectoryFixture.sourceDocument,
        sameDirectoryFixture.sourceToken,
        options
      );
      assert.equal(result.created, true);
      assert.equal(reused.created, false);
      assert.equal(reused.contentRef, result.contentRef);
      assert.equal(reused.projectToken, result.projectToken);
      assert.notEqual(result.contentRef, main.videoContentRef(
        sameDirectoryFixture.runtime.epoch,
        sameDirectoryFixture.sourceDocument.relativePath
      ));
      assert.notEqual(result.projectToken, sameDirectoryFixture.sourceToken);
      const created = cockpit.readDocument(
        sameDirectoryFixture.root,
        main.videoTacticRelativePath(
          sameDirectoryFixture.sourceDocument.relativePath,
          sameDirectoryFixture.sourceDocument.hash
        )
      );
      assert.equal(created.fields.source, sameDirectoryFixture.sourceDocument.relativePath);
      assert.equal(fs.readdirSync(path.join(
        sameDirectoryFixture.root, '07_打法库'
      )).length, 2, '同目录中复盘源与打法资产必须按 stage 共存');
      const scanned = cockpit.scanWorkspace(sameDirectoryFixture.root, {
        expectedRootIdentity: sameDirectoryFixture.runtime.rootIdentity
      });
      sameDirectoryFixture.rebuild();
      const collection = main.videoTacticCollection(sameDirectoryFixture.runtime, {
        refresh: false, scanned
      });
      assert.equal(collection.tactics.length, 1,
        '同在 07 的 review 源不得进入 asset 打法 collection');
      assert.equal(collection.tactics[0].contentRef, result.contentRef);
      assert.equal(collection.tactics[0].projectToken, result.projectToken);
    } finally {
      fs.rmSync(sameDirectoryFixture.root, { recursive: true, force: true });
    }

    const unknownFixture = makeFixture();
    try {
      let mutated = false;
      const refreshAfterWrite = () => {
        if (!mutated) {
          mutated = true;
          fs.appendFileSync(unknownFixture.sourcePath, '\n外部并发变化\n', 'utf8');
        }
        unknownFixture.rebuild();
      };
      assert.throws(() => main.solidifyVideoTactic(
        unknownFixture.runtime, unknownFixture.sourceDocument,
        unknownFixture.sourceToken, {
          refresh: refreshAfterWrite,
          readSource: unknownFixture.readByToken,
          readTactic: unknownFixture.readByToken
        }
      ), (error) => error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN');
      assert.equal(fs.readdirSync(path.join(unknownFixture.root, '07_打法库')).length, 1,
        '写后 source 漂移不得说成未执行，也不得重试');
    } finally {
      fs.rmSync(unknownFixture.root, { recursive: true, force: true });
    }

    const racedFixture = makeFixture();
    try {
      const won = main.solidifyVideoTactic(
        racedFixture.runtime, racedFixture.sourceDocument,
        racedFixture.sourceToken, {
          refresh: racedFixture.rebuild,
          readSource: racedFixture.readByToken,
          readTactic: racedFixture.readByToken,
          beforeTacticExclusiveWrite: ({ relativePath, content }) => {
            const target = path.join(racedFixture.root, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content, { flag: 'wx' });
          }
        }
      );
      assert.equal(won.created, false,
        'EEXIST 只有精确同字节的当前 revision 才可复用');
    } finally {
      fs.rmSync(racedFixture.root, { recursive: true, force: true });
    }

    const conflictingRace = makeFixture();
    try {
      assert.throws(() => main.solidifyVideoTactic(
        conflictingRace.runtime, conflictingRace.sourceDocument,
        conflictingRace.sourceToken, {
          refresh: conflictingRace.rebuild,
          readSource: conflictingRace.readByToken,
          readTactic: conflictingRace.readByToken,
          beforeTacticExclusiveWrite: ({ relativePath, content }) => {
            const target = path.join(conflictingRace.root, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content.replace('status: active', 'status: archived'), {
              flag: 'wx'
            });
          }
        }
      ), /并发创建冲突/,
      'EEXIST 下即使 revision/source/body 相同，非 exact bytes 也必须冲突停写');
    } finally {
      fs.rmSync(conflictingRace.root, { recursive: true, force: true });
    }

    const guardedFixture = makeFixture();
    try {
      const emptySource = { ...guardedFixture.sourceDocument, body: '\n \t\n' };
      assert.throws(() => main.solidifyVideoTactic(
        guardedFixture.runtime, emptySource, guardedFixture.sourceToken, {
          refresh: guardedFixture.rebuild,
          readSource: guardedFixture.readByToken,
          readTactic: guardedFixture.readByToken
        }
      ), /显式固化/);
      assert.equal(fs.existsSync(path.join(guardedFixture.root, '07_打法库')), false,
        '空复盘正文不得绕过 UI 直接创建打法');
      guardedFixture.runtime.recoveryIssues = [{ relativePath: null }];
      assert.throws(() => main.solidifyVideoTactic(
        guardedFixture.runtime, guardedFixture.sourceDocument,
        guardedFixture.sourceToken, {
          refresh: guardedFixture.rebuild,
          readSource: guardedFixture.readByToken,
          readTactic: guardedFixture.readByToken
        }
      ), (error) => error && error.code === 'ERR_VIDEO_RECOVERY_REQUIRED');
      assert.equal(fs.existsSync(path.join(guardedFixture.root, '07_打法库')), false,
        '工作区恢复未裁决时底层也必须零写入');
    } finally {
      fs.rmSync(guardedFixture.root, { recursive: true, force: true });
    }
    const mainSource = source('main.js');
    const solidifyBlock = mainSource.slice(
      mainSource.indexOf('function solidifyVideoTactic'),
      mainSource.indexOf('function videoIssueSummary')
    );
    assert.match(solidifyBlock,
      /writeVideoExclusive\(runtime\.root, relativePath, content, \{[\s\S]*rootIdentity/,
    '打法固化必须复用 root\/parent\/fd 绑定的独占写');
    assert.doesNotMatch(solidifyBlock, /randomBytes|Date\.now/,
      '同 source revision 不得保留随机或时钟文件语义');
  });

  await test('独占创建绑定父目录与新 fd，open 后失败一律 outcome-unknown', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-exclusive-')));
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-outside-')));
    const stat = fs.lstatSync(root, { bigint: true });
    const rootIdentity = { dev: String(stat.dev), ino: String(stat.ino) };
    const outcomeUnknown = (error) => error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN';
    try {
      const sameSource = '02_脚本/同一来源.md';
      const oldTitleDocument = { stage: 'script', relativePath: sameSource, title: '旧标题' };
      const newTitleDocument = { stage: 'script', relativePath: sameSource, title: '新标题' };
      const oldTitleTarget = main.videoPublishChecklistRelativePath(
        oldTitleDocument.relativePath
      );
      const newTitleTarget = main.videoPublishChecklistRelativePath(
        newTitleDocument.relativePath
      );
      assert.equal(newTitleTarget, oldTitleTarget,
        '同一 canonical source 的独占目标不得随 title 变化');
      main.writeVideoExclusive(root, oldTitleTarget,
        main.videoPublishChecklistText(oldTitleDocument), { rootIdentity });
      assert.throws(() => main.writeVideoExclusive(root, newTitleTarget,
        main.videoPublishChecklistText(newTitleDocument), { rootIdentity }),
      (error) => error && error.code === 'EEXIST');
      assert.equal(fs.readdirSync(path.join(root, '08_发布检查'))
        .filter((name) => name === path.basename(oldTitleTarget)).length, 1,
      '标题竞态只能争用同一 wx 目标');

      const success = main.writeVideoExclusive(
        root, '08_发布检查/success.md', '# success\n', { rootIdentity }
      );
      assert.equal(fs.readFileSync(success, 'utf8'), '# success\n');

      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/post-open.md', '# must-not-write\n', {
          rootIdentity,
          afterExclusiveOpen() { throw new Error('模拟 open 后失败'); }
        }
      ), outcomeUnknown);
      assert.equal(fs.statSync(path.join(root, '08_发布检查/post-open.md')).size, 0,
        'open 后复验失败前不得写入内容');

      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/fsync-failure.md', '# written-before-fsync\n', {
          rootIdentity,
          fsyncExclusiveFile() { throw new Error('模拟文件 fsync 失败'); }
        }
      ), outcomeUnknown);
      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/close-failure.md', '# written-before-close\n', {
          rootIdentity,
          closeExclusiveFile(fd) {
            fs.closeSync(fd);
            throw new Error('模拟 close 结果不可确认');
          }
        }
      ), outcomeUnknown);
      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/directory-fsync-failure.md', '# written-before-dir-fsync\n', {
          rootIdentity,
          fsyncExclusiveDirectory() { throw new Error('模拟目录 fsync 失败'); }
        }
      ), outcomeUnknown);

      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/post-write.md', '# maybe-written\n', {
          rootIdentity,
          afterExclusiveWrite() { throw new Error('模拟 fsync 后失败'); }
        }
      ), outcomeUnknown);

      const finalTarget = path.join(root, '08_发布检查/final-swap.md');
      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/final-swap.md', '# original\n', {
          rootIdentity,
          beforeExclusiveFinalVerify(target) {
            fs.renameSync(target, `${target}.opened`);
            fs.writeFileSync(target, '# replaced\n', 'utf8');
          }
        }
      ), outcomeUnknown);
      assert.equal(fs.readFileSync(finalTarget, 'utf8'), '# replaced\n',
        '同盘、等长 regular file 替换也不得返回成功');
      assert.equal(Buffer.byteLength('# original\n'), Buffer.byteLength('# replaced\n'),
        '回归必须排除仅由 size 差异拦截的假阳性');

      const controlled = path.join(root, '08_发布检查');
      const beforeMoved = path.join(root, '08_发布检查-before-old');
      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/before-parent-swap.md', '# never-created\n', {
          rootIdentity,
          beforeExclusiveOpen() {
            fs.renameSync(controlled, beforeMoved);
            fs.symlinkSync(outside, controlled);
          }
        }
      ), (error) => error && error.code === 'ERR_PATH_CHANGED');
      assert.equal(fs.existsSync(path.join(outside, 'before-parent-swap.md')), false);
      assert.equal(fs.existsSync(path.join(beforeMoved, 'before-parent-swap.md')), false,
        'open 前 parent swap 必须零目标文件副作用');
      fs.unlinkSync(controlled);
      fs.renameSync(beforeMoved, controlled);

      const moved = path.join(root, '08_发布检查-after-old');
      assert.throws(() => main.writeVideoExclusive(
        root, '08_发布检查/parent-swap.md', '# outside-forbidden\n', {
          rootIdentity,
          afterExclusiveOpen() {
            fs.renameSync(controlled, moved);
            fs.symlinkSync(outside, controlled);
          }
        }
      ), outcomeUnknown);
      assert.equal(fs.existsSync(path.join(outside, 'parent-swap.md')), false,
        '父目录 swap 在内容写入前必须被拒绝');
      assert.equal(fs.statSync(path.join(moved, 'parent-swap.md')).size, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  await test('拍摄命令支持缺口且拒绝额外键，重复设置模式保持幂等', async () => {
    assert.deepEqual(main.shootingRendererCommand({
      type: 'set-gap', shotId: 'shot-001', value: '缺一段数据画面'
    }), { type: 'set-gap', shotId: 'shot-001', value: '缺一段数据画面' });
    assert.throws(() => main.shootingRendererCommand({
      type: 'set-gap', shotId: 'shot-001', value: '缺素材', path: '/tmp'
    }));
    const state = shooting.createShootingSession('第一段口播。', {
      sessionId: 'shoot-runtime-test', sourceRelativePath: '03_口播稿/测试.md',
      sourceHash: cockpit.hashText('第一段口播。'), speed: 1, fontSize: 64
    });
    const teleprompter = main.reduceShootingRendererCommand(state, {
      type: 'set-mode', value: 'teleprompter'
    });
    assert.equal(teleprompter.mode, 'teleprompter');
    assert.equal(main.reduceShootingRendererCommand(teleprompter, {
      type: 'set-mode', value: 'teleprompter'
    }), teleprompter);
  });

  await test('拍摄 surface 不泄露工作区路径，并显式给出两阶段收工摘要', async () => {
    let state = shooting.createShootingSession('第一段口播。', {
      sessionId: 'shoot-surface-test', sourceRelativePath: '03_口播稿/测试.md',
      sourceHash: cockpit.hashText('第一段口播。'), speed: 1, fontSize: 64
    });
    state = shooting.reduceSession(state, { type: 'finish-preview' });
    const surface = main.shootingSurface(state);
    assert.equal(surface.phase, 'preview');
    assert.equal(surface.sourceLabel, '测试.md');
    assert.deepEqual(surface.finishSummary, {
      total: 1, confirmed: 0, missing: 1, retakes: 0, gapsProvided: 0
    });
    assert.equal(JSON.stringify(surface).includes('03_口播稿/'), false);
  });

  await test('拍摄历史只投影自有摘要，降序 token、partial 与 A→B→A 精确绑定', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-history-main-')));
    const rootStat = fs.lstatSync(root);
    const runtime = {
      root, epoch: 31,
      rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
      rootIdentityKey: `${String(rootStat.dev)}:${String(rootStat.ino)}`,
      generation: 9, closed: false, recoveryIssues: [], projectTokens: new Map()
    };
    const recordText = (title, confirmed, retakes) => {
      const text = '[镜头 1 · 约 8 秒]\n第一段。\n\n[镜头 2 · 约 9 秒]\n第二段。';
      let state = shooting.createShootingSession({ text, title }, {
        sessionId: `history_${confirmed}_${retakes}`,
        sourceRelativePath: `03_口播稿/来源-${confirmed}-${retakes}.md`,
        sourceHash: shooting.hashText(text), speed: 1, fontSize: 64
      });
      for (let index = 0; index < confirmed; index += 1) {
        state = shooting.reduceSession(state, {
          type: 'confirm', shotId: `shot-${String(index + 1).padStart(3, '0')}`
        });
      }
      for (let index = 0; index < retakes; index += 1) {
        state = shooting.reduceSession(state, { type: 'retake', shotId: 'shot-002' });
      }
      state = shooting.reduceSession(state, { type: 'finish-preview' });
      state = shooting.reduceSession(state, { type: 'finish-confirm' });
      return shooting.planWriteback(shooting.buildSummary(state)).record.content;
    };
    const files = new Map([
      ['05_拍摄记录/A.md', recordText('A 旧记录', 0, 2)],
      ['05_拍摄记录/C.md', recordText('C 新记录', 2, 0)],
      ['05_拍摄记录/B.md', recordText('鲸'.repeat(100), 1, 1)]
    ]);
    try {
      for (const [relativePath, text] of files) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text, 'utf8');
      }
      let scanned = cockpit.scanShootingRecords(root, {
        expectedRootIdentity: runtime.rootIdentity
      });
      const initial = main.videoShootingHistoryCollection(runtime, { scanned });
      assert.match(initial.collectionToken, /^collection-[a-f0-9]{24}$/);
      assert.equal(initial.complete, true);
      assert.equal(initial.records.length, 3);
      assert.deepEqual(initial.records.map((record) => record.title), [
        'C 新记录', '鲸'.repeat(40), 'A 旧记录'
      ], 'A/C/B 三份记录必须按 relativePath 字节序降序投影为 C/B/A');
      assert(initial.records.every((record) => /^[a-f0-9]{24}$/.test(record.recordRef)));
      assert.deepEqual(initial.records[0], {
        recordRef: initial.records[0].recordRef,
        title: 'C 新记录', confirmedCount: 2, totalShots: 2,
        missingCount: 0, retakeCount: 0, allConfirmed: true
      });
      assert.doesNotMatch(JSON.stringify(initial.records),
        /session|source|sha256|relativePath|root|platform|metrics|completedAt/i);

      const invalidOwnedPath = path.join(root, '05_拍摄记录/q-invalid.md');
      fs.writeFileSync(invalidOwnedPath, '# 不是 WhaleDock 自有拍摄记录\n', 'utf8');
      let invalidScanned = cockpit.scanShootingRecords(root, {
        expectedRootIdentity: runtime.rootIdentity
      });
      const invalidOwned = main.videoShootingHistoryCollection(runtime, {
        scanned: invalidScanned
      });
      assert.equal(invalidOwned.complete, false);
      assert.equal(invalidOwned.records.length, 3,
        '非自有记录不得投影，但必须让集合诚实标记 partial');
      assert.notEqual(invalidOwned.collectionToken, initial.collectionToken,
        '无法投影的安全资产仍必须进 \(path,hash\) digest');
      fs.unlinkSync(invalidOwnedPath);
      invalidScanned = cockpit.scanShootingRecords(root, {
        expectedRootIdentity: runtime.rootIdentity
      });
      assert.equal(main.videoShootingHistoryCollection(runtime, {
        scanned: invalidScanned
      }).collectionToken, initial.collectionToken);

      const emptyHistory = main.videoShootingHistoryCollection(runtime, {
        scanned: { items: [], issues: [], truncated: false }
      });
      const emptyTactics = main.videoTacticCollection(runtime, {
        refresh: false, scanned: { items: [], issues: [], truncated: false }
      });
      assert.notEqual(emptyHistory.collectionToken, emptyTactics.collectionToken,
        '拍摄历史与打法库的空 collection 也必须 HMAC 域分离');

      const issuePartial = main.videoShootingHistoryCollection(runtime, {
        scanned: {
          items: scanned.items,
          issues: [{ relativePath: '05_拍摄记录/linked.md', reason: 'path-symlink' }],
          truncated: false
        }
      });
      assert.equal(issuePartial.complete, false);
      assert.equal(issuePartial.collectionToken, initial.collectionToken);
      const truncated = main.videoShootingHistoryCollection(runtime, {
        scanned: { items: scanned.items, issues: [], truncated: true }
      });
      assert.equal(truncated.complete, false);
      runtime.recoveryIssues = [{ relativePath: null }];
      assert.equal(main.videoShootingHistoryCollection(runtime, { scanned }).complete, false);
      runtime.recoveryIssues = [];
      assert.throws(() => main.videoShootingHistoryCollection(runtime, {
        scanned: { items: [], issues: [] }
      }), /扫描结果无效/);
      assert.throws(() => main.videoShootingHistoryCollection(runtime, {
        scanned: {
          items: Array.from({ length: 513 }, () => scanned.items[0]),
          issues: [], truncated: true
        }
      }), /扫描结果无效/);

      const changedPath = '05_拍摄记录/C.md';
      fs.writeFileSync(path.join(root, changedPath), `${files.get(changedPath)}\n`, 'utf8');
      scanned = cockpit.scanShootingRecords(root, {
        expectedRootIdentity: runtime.rootIdentity
      });
      const changed = main.videoShootingHistoryCollection(runtime, { scanned });
      assert.notEqual(changed.collectionToken, initial.collectionToken);
      fs.writeFileSync(path.join(root, changedPath), files.get(changedPath), 'utf8');
      scanned = cockpit.scanShootingRecords(root, {
        expectedRootIdentity: runtime.rootIdentity
      });
      const restored = main.videoShootingHistoryCollection(runtime, { scanned });
      assert.equal(restored.collectionToken, initial.collectionToken,
        'A→B→A 回到同一降序 \(path,hash\) 快照时 token 必须回到 A');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('拍摄窗 disposition 绑定 runtime，只声明 requested 且副作后失败为 unknown', async () => {
    const sourceText = '真实口播稿。';
    const hash = cockpit.hashText(sourceText);
    const document = {
      stage: 'shoot', relativePath: '03_口播稿/当前.md', hash,
      text: sourceText, title: '当前口播稿'
    };
    const runtimeA = {
      root: '/workspace-a', generation: 2, epoch: 3, rootIdentityKey: '1:2'
    };
    const runtimeB = {
      root: '/workspace-b', generation: 2, epoch: 3, rootIdentityKey: '4:5'
    };
    const active = {
      status: 'active', sourceRelativePath: document.relativePath, sourceHash: document.hash
    };
    const contextA = { ...runtimeA };
    assert.equal(main.shootingOpenDisposition(null, false, document, null, runtimeA), 'opened');
    assert.equal(main.shootingOpenDisposition(active, true, document, contextA, runtimeA),
      'focused');
    assert.equal(main.shootingOpenDisposition(active, true, document, contextA, runtimeB),
      'busy', '同 path/hash 跨 runtime 也不得冒充复用');
    assert.equal(main.shootingOpenDisposition(active, true, {
      ...document, relativePath: '03_口播稿/另一份.md'
    }, contextA, runtimeA), 'busy');
    assert.equal(main.shootingOpenDisposition(null, false, {
      ...document, relativePath: '04_素材清单/不是台词.md'
    }, null, runtimeA), 'unavailable');

    class FakeWindow {
      constructor() {
        FakeWindow.last = this;
        this.destroyed = false;
        this.handlers = {};
        this.showCalls = 0;
        this.focusCalls = 0;
        this.webContents = { on: () => {} };
      }
      isDestroyed() { return this.destroyed; }
      show() { this.showCalls += 1; }
      focus() { this.focusCalls += 1; }
      once(name, handler) { this.handlers[name] = handler; }
      on(name, handler) { this.handlers[name] = handler; }
      loadFile() { return Promise.resolve(); }
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.handlers.closed) this.handlers.closed();
      }
    }
    const projectTokenForOpen = `project-${'f'.repeat(24)}`;
    const readDocument = () => ({ runtime: runtimeA, document });
    const openOptions = {
      readDocument, BrowserWindowClass: FakeWindow, secureWindow: () => {},
      now: () => 1, randomBytes: () => Buffer.alloc(5, 1)
    };
    const requested = main.openShootingWindowForProject({
      projectToken: projectTokenForOpen
    }, openOptions);
    assert.deepEqual(requested, { kind: 'shoot-open', state: 'opened' });
    assert.match(main.shootingOpenMessage('opened'), /仍需在本机确认/);
    assert.deepEqual(main.openShootingWindowForProject({
      projectToken: projectTokenForOpen
    }, openOptions), { kind: 'shoot-open', state: 'focused' });
    assert.deepEqual(main.openShootingWindowForProject({
      projectToken: projectTokenForOpen
    }, { ...openOptions, readDocument: () => ({ runtime: runtimeB, document }) }), {
      kind: 'shoot-open', state: 'busy'
    });
    FakeWindow.last.destroy();

    class ThrowingWindow { constructor() { throw new Error('原生窗口构造失败'); } }
    assert.throws(() => main.openShootingWindowForProject({
      projectToken: projectTokenForOpen
    }, { ...openOptions, BrowserWindowClass: ThrowingWindow }), (error) => (
      error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN'
    ));

    class LoadThrowWindow extends FakeWindow {
      loadFile() { throw new Error('加载已开始后失败'); }
    }
    assert.throws(() => main.openShootingWindowForProject({
      projectToken: projectTokenForOpen
    }, { ...openOptions, BrowserWindowClass: LoadThrowWindow }), (error) => (
      error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN'
    ));
  });

  await test('拍摄收工部分写入保留证据，不再 read→unlink 误删用户文件', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-shoot-partial-')));
    const rootIdentity = directoryIdentity(root);
    try {
      fs.mkdirSync(path.join(root, '04_素材清单'), { recursive: true });
      fs.writeFileSync(path.join(root, '04_素材清单/已存在.md'), '# 用户文件\n', 'utf8');
      const plan = {
        files: [
          { kind: 'record', relativePath: '05_拍摄记录/部分.md', content: '# 已创建记录\n' },
          { kind: 'gaps', relativePath: '04_素材清单/已存在.md', content: '# 不得覆盖\n' }
        ]
      };
      assert.throws(() => main.writeShootingOutputs(root, plan, rootIdentity), (error) => (
        error && error.code === 'ERR_OPERATION_OUTCOME_UNKNOWN'
      ));
      assert.equal(fs.readFileSync(path.join(root, '05_拍摄记录/部分.md'), 'utf8'),
        '# 已创建记录\n', '第一份 partial 证据必须保留供核对');
      assert.equal(fs.readFileSync(path.join(root, '04_素材清单/已存在.md'), 'utf8'),
        '# 用户文件\n', '碰撞的用户文件不得被覆盖或删除');
      const flow = source('main.js').slice(
        source('main.js').indexOf('function writeShootingOutputs'),
        source('main.js').indexOf('function registerShootingIpc')
      );
      assert.doesNotMatch(flow, /readFileSync|unlinkSync|sameOwnedOutput/,
        '收工失败不得再用 bytes-equal 代替 inode 绑定后删除');
      const finishFlow = source('main.js').slice(
        source('main.js').indexOf('function registerShootingIpc'),
        source('main.js').indexOf('// ---------- v0.10 P0B')
      );
      assert.match(finishFlow, /shootingRuntimeContext\.writeLocked\s*=\s*true;[\s\S]*?pushShootingState\(\)/,
        '部分写入 outcome unknown 后必须锁定当前 session 并立即投影');
      assert.match(finishFlow, /shootingRuntimeContext\s*&&\s*shootingRuntimeContext\.writeLocked[\s\S]*?避免重复写入/,
        '锁定后的再次收工必须在进入写入路径前明确拒绝');
      const surfaceFlow = source('main.js').slice(
        source('main.js').indexOf('function shootingSurface'),
        source('main.js').indexOf('function shootingRendererCommand')
      );
      assert.match(surfaceFlow, /canFinish:\s*!writeLocked/,
        '未知终态锁必须让拍摄面板停止提供可重复写入的收工动作');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('文本写回不覆盖并发版本，CAS 错误保留对方原文', async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-main-video-')));
    fs.mkdirSync(path.join(tmp, '02_脚本'));
    const target = path.join(tmp, '02_脚本', '稿.md');
    fs.writeFileSync(target, '# 原稿\n');
    const originalHash = cockpit.hashText('# 原稿\n');
    const rootIdentity = directoryIdentity(tmp);
    const delayedEditorFd = fs.openSync(target, 'r+');
    try {
      main.atomicReplaceVideoText(
        tmp, '02_脚本/稿.md', originalHash, '# 新稿\n', {
          rootIdentity,
          expectedBinding: documentBinding(tmp, '02_脚本/稿.md'),
          afterBackupPreserved() {
            const delayed = Buffer.from('# 编辑器延迟写入\n');
            fs.ftruncateSync(delayedEditorFd, 0);
            fs.writeSync(delayedEditorFd, delayed, 0, delayed.length, 0);
          }
        }
      );
    } finally { fs.closeSync(delayedEditorFd); }
    assert.equal(fs.readFileSync(target, 'utf8'), '# 新稿\n');
    const preserved = fs.readdirSync(path.dirname(target))
      .filter((name) => name.startsWith('WhaleDock-recovery-'));
    assert.equal(preserved.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(target), preserved[0]), 'utf8'), '# 编辑器延迟写入\n');

    const ownershipTarget = path.join(tmp, '02_脚本', 'journal-所有权.md');
    fs.writeFileSync(ownershipTarget, '# 所有权原稿\n');
    let collidedJournal = null;
    const thirdPartyJournal = '{"thirdParty":true}\n';
    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/journal-所有权.md', cockpit.hashText('# 所有权原稿\n'), '# 不应写入\n', {
        rootIdentity,
        expectedBinding: documentBinding(tmp, '02_脚本/journal-所有权.md'),
        beforeJournalOpen(journalPath) {
          collidedJournal = journalPath;
          fs.writeFileSync(journalPath, thirdPartyJournal, { flag: 'wx' });
        }
      }
    ), (error) => error && error.code === 'EEXIST');
    assert.equal(fs.readFileSync(collidedJournal, 'utf8'), thirdPartyJournal);
    assert.equal(fs.readFileSync(ownershipTarget, 'utf8'), '# 所有权原稿\n');
    assert.equal(fs.readdirSync(path.dirname(target))
      .some((name) => name.startsWith('.whaledock-') && name.endsWith('.tmp')), false);
    fs.unlinkSync(collidedJournal);

    const copyTarget = path.join(tmp, '02_脚本', '复制回退.md');
    fs.writeFileSync(copyTarget, '# 复制原稿\n');
    const copyWrite = main.atomicReplaceVideoText(
      tmp, '02_脚本/复制回退.md', cockpit.hashText('# 复制原稿\n'), '# 复制新稿\n', {
        rootIdentity,
        expectedBinding: documentBinding(tmp, '02_脚本/复制回退.md'),
        forceCopy: true
      }
    );
    assert.equal(fs.readFileSync(copyTarget, 'utf8'), '# 复制新稿\n');
    assert.deepEqual(copyWrite.binding, documentBinding(tmp, '02_脚本/复制回退.md'));

    const fsyncTarget = path.join(tmp, '02_脚本', 'fsync-故障.md');
    fs.writeFileSync(fsyncTarget, '# fsync 原稿\n');
    const realFsyncSync = fs.fsyncSync;
    try {
      assert.throws(() => main.atomicReplaceVideoText(
        tmp, '02_脚本/fsync-故障.md', cockpit.hashText('# fsync 原稿\n'), '# fsync 新稿\n', {
          rootIdentity,
          expectedBinding: documentBinding(tmp, '02_脚本/fsync-故障.md'),
          beforeBackup() {
            fs.fsyncSync = () => {
              fs.fsyncSync = realFsyncSync;
              const error = new Error('注入目录 fsync 故障');
              error.code = 'EIO';
              throw error;
            };
          }
        }
      ), (error) => error && error.code === 'EIO');
    } finally { fs.fsyncSync = realFsyncSync; }
    assert.equal(fs.readFileSync(fsyncTarget, 'utf8'), '# fsync 原稿\n');
    assert.equal(fs.readdirSync(path.dirname(target))
      .some((name) => name.startsWith('.whaledock-')), false);

    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/稿.md', originalHash, '# 不该写入\n', {
        rootIdentity, expectedBinding: documentBinding(tmp, '02_脚本/稿.md')
      }
    ));
    assert.equal(fs.readFileSync(target, 'utf8'), '# 新稿\n');

    const external = path.join(tmp, '02_脚本', '外部并发.md');
    fs.writeFileSync(external, '# 外部并发稿\n');
    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/稿.md', cockpit.hashText('# 新稿\n'), '# 鲸坞不该覆盖\n', {
        rootIdentity,
        expectedBinding: documentBinding(tmp, '02_脚本/稿.md'),
        beforeBackup(currentTarget) {
          // 在最后复验与提交之间模拟另一个编辑器换入新 inode。
          fs.unlinkSync(currentTarget);
          fs.renameSync(external, currentTarget);
        }
      }
    ), (error) => error && error.code === 'ERR_CAS_MISMATCH');
    assert.equal(fs.readFileSync(target, 'utf8'), '# 外部并发稿\n');
    assert.equal(fs.readdirSync(path.dirname(target))
      .some((name) => name.startsWith('.whaledock-cas-')), false);

    const sameHashTarget = path.join(tmp, '02_脚本', '同内容换实体.md');
    const sameHashIncoming = path.join(tmp, '02_脚本', '同内容换实体-外部.md');
    const sameHashText = '# 内容完全相同\n';
    fs.writeFileSync(sameHashTarget, sameHashText);
    const staleBinding = documentBinding(tmp, '02_脚本/同内容换实体.md');
    fs.writeFileSync(sameHashIncoming, sameHashText);
    fs.unlinkSync(sameHashTarget);
    fs.renameSync(sameHashIncoming, sameHashTarget);
    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/同内容换实体.md', cockpit.hashText(sameHashText), '# 不应覆盖同 hash 新实体\n', {
        rootIdentity, expectedBinding: staleBinding
      }
    ), (error) => error && error.code === 'ERR_CAS_MISMATCH');
    assert.equal(fs.readFileSync(sameHashTarget, 'utf8'), sameHashText);

    const readRaceTarget = path.join(tmp, '02_脚本', '读取窗口换实体.md');
    const readRaceIncoming = path.join(tmp, '02_脚本', '读取窗口换实体-外部.md');
    fs.writeFileSync(readRaceTarget, sameHashText);
    fs.writeFileSync(readRaceIncoming, sameHashText);
    const readRaceBinding = documentBinding(tmp, '02_脚本/读取窗口换实体.md');
    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/读取窗口换实体.md', cockpit.hashText(sameHashText), '# 不应覆盖读取窗口新实体\n', {
        rootIdentity,
        expectedBinding: readRaceBinding,
        beforeBoundRead(currentTarget) {
          fs.unlinkSync(currentTarget);
          fs.renameSync(readRaceIncoming, currentTarget);
        }
      }
    ), (error) => error && error.code === 'ERR_CAS_MISMATCH');
    assert.equal(fs.readFileSync(readRaceTarget, 'utf8'), sameHashText);

    const boundParent = path.join(tmp, '02_脚本', '绑定父目录');
    const oldBoundParent = path.join(tmp, '02_脚本', '绑定父目录-旧');
    fs.mkdirSync(boundParent);
    fs.writeFileSync(path.join(boundParent, '稿.md'), sameHashText);
    const staleParentBinding = documentBinding(tmp, '02_脚本/绑定父目录/稿.md');
    fs.renameSync(boundParent, oldBoundParent);
    fs.mkdirSync(boundParent);
    fs.writeFileSync(path.join(boundParent, '稿.md'), sameHashText);
    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/绑定父目录/稿.md', cockpit.hashText(sameHashText), '# 不应覆盖新父目录\n', {
        rootIdentity, expectedBinding: staleParentBinding
      }
    ), (error) => error && error.code === 'ERR_CAS_MISMATCH');
    assert.equal(fs.readFileSync(path.join(boundParent, '稿.md'), 'utf8'), sameHashText);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('启动恢复在经批准目录内还原中断提交，冲突证据则原样保留', async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-cas-recovery-')));
    const directory = path.join(tmp, '02_脚本', '分组');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, '稿.md');
    const oldText = '# 恢复前原稿\n';
    const replacementText = '# 未完成的新稿\n';
    const createJournal = (nonce) => {
      const journal = path.join(directory, `.whaledock-cas-${nonce}.json`);
      const tmpFile = path.join(directory, `.whaledock-${nonce}.tmp`);
      const backup = path.join(directory, `.whaledock-recovery-${nonce}.bak`);
      fs.writeFileSync(tmpFile, replacementText);
      fs.writeFileSync(backup, oldText);
      const rootStat = fs.lstatSync(tmp);
      const directoryStat = fs.lstatSync(directory);
      const targetStat = fs.lstatSync(backup);
      const tmpStat = fs.lstatSync(tmpFile);
      fs.writeFileSync(journal, `${JSON.stringify({
        schemaVersion: 2,
        targetName: '稿.md',
        expectedHash: cockpit.hashText(oldText),
        replacementHash: cockpit.hashText(replacementText),
        rootDepth: 2,
        rootDev: String(rootStat.dev), rootIno: String(rootStat.ino),
        directoryDev: String(directoryStat.dev), directoryIno: String(directoryStat.ino),
        targetDev: String(targetStat.dev), targetIno: String(targetStat.ino),
        tmpDev: String(tmpStat.dev), tmpIno: String(tmpStat.ino)
      })}\n`);
      return { journal, backup };
    };

    createJournal('1'.repeat(24));
    assert.deepEqual(main.recoverVideoCasWorkspace(tmp, directoryIdentity(tmp)), []);
    assert.equal(fs.readFileSync(target, 'utf8'), oldText);
    assert.equal(fs.readdirSync(directory).some((name) => name.startsWith('.whaledock-')), false);

    const { journal } = createJournal('2'.repeat(24));
    fs.writeFileSync(target, '# 第三方已换稿\n');
    assert.deepEqual(main.recoverVideoCasJournal(journal, directoryIdentity(tmp)), {
      recovered: false, issue: 'external-target-present'
    });
    assert.equal(fs.readFileSync(target, 'utf8'), '# 第三方已换稿\n');
    assert.equal(fs.readFileSync(path.join(
      directory, `.whaledock-recovery-${'2'.repeat(24)}.bak`
    ), 'utf8'), oldText);

    fs.rmSync(target);
    const corrupt = createJournal('3'.repeat(24));
    fs.writeFileSync(corrupt.backup, '# 损坏的恢复副本\n');
    assert.deepEqual(main.recoverVideoCasJournal(corrupt.journal, directoryIdentity(tmp)), {
      recovered: false, issue: 'untrusted-backup-preserved'
    });
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(corrupt.backup), true);
    assert.equal(fs.existsSync(corrupt.journal), true);

    const oversized = path.join(directory, `.whaledock-cas-${'4'.repeat(24)}.json`);
    fs.writeFileSync(oversized, Buffer.alloc(4097, 0x61));
    assert.deepEqual(main.recoverVideoCasJournal(oversized, directoryIdentity(tmp)), {
      recovered: false, issue: 'journal-invalid'
    });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('CAS 绑定 root/父目录 inode，提交窗口换根不移动新工作区文件', async () => {
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-cas-root-')));
    const root = path.join(parent, 'workspace');
    const oldRoot = path.join(parent, 'old-workspace');
    fs.mkdirSync(path.join(root, '02_脚本'), { recursive: true });
    const target = path.join(root, '02_脚本', '稿.md');
    fs.writeFileSync(target, '# 原工作区稿\n');
    const rootIdentity = directoryIdentity(root);
    assert.throws(() => main.atomicReplaceVideoText(
      root, '02_脚本/稿.md', cockpit.hashText('# 原工作区稿\n'), '# 鲸坞新稿\n', {
        rootIdentity,
        expectedBinding: documentBinding(root, '02_脚本/稿.md'),
        beforeBackup() {
          fs.renameSync(root, oldRoot);
          fs.mkdirSync(path.join(root, '02_脚本'), { recursive: true });
          fs.writeFileSync(path.join(root, '02_脚本', '稿.md'), '# 第三方新工作区稿\n');
        }
      }
    ), (error) => error && error.code === 'ERR_VIDEO_ROOT_CHANGED');
    assert.equal(fs.readFileSync(path.join(root, '02_脚本', '稿.md'), 'utf8'), '# 第三方新工作区稿\n');
    assert.deepEqual(fs.readdirSync(path.join(root, '02_脚本')), ['稿.md']);
    assert.equal(fs.readFileSync(path.join(oldRoot, '02_脚本', '稿.md'), 'utf8'), '# 原工作区稿\n');

    const raceRoot = path.join(parent, 'race-workspace');
    const raceOldRoot = path.join(parent, 'race-old-workspace');
    fs.mkdirSync(path.join(raceRoot, '02_脚本'), { recursive: true });
    const raceTarget = path.join(raceRoot, '02_脚本', '稿.md');
    fs.writeFileSync(raceTarget, '# 竞态前原稿\n');
    const realRenameSync = fs.renameSync;
    try {
      assert.throws(() => main.atomicReplaceVideoText(
        raceRoot, '02_脚本/稿.md', cockpit.hashText('# 竞态前原稿\n'), '# 鲸坞竞态新稿\n', {
          rootIdentity: directoryIdentity(raceRoot),
          expectedBinding: documentBinding(raceRoot, '02_脚本/稿.md'),
          beforeBackup() {
            fs.renameSync = (sourcePath, destinationPath) => {
              fs.renameSync = realRenameSync;
              if (sourcePath === raceTarget) {
                realRenameSync(raceRoot, raceOldRoot);
                fs.mkdirSync(path.join(raceRoot, '02_脚本'), { recursive: true });
                fs.writeFileSync(raceTarget, '# rename 瞬间的第三方稿\n');
              }
              return realRenameSync(sourcePath, destinationPath);
            };
          }
        }
      ), (error) => error && error.code === 'ERR_VIDEO_RECOVERY_REQUIRED');
    } finally { fs.renameSync = realRenameSync; }
    assert.equal(fs.readFileSync(raceTarget, 'utf8'), '# rename 瞬间的第三方稿\n');
    assert.deepEqual(fs.readdirSync(path.dirname(raceTarget)).sort(), ['稿.md']);
    assert.equal(fs.readFileSync(path.join(raceOldRoot, '02_脚本', '稿.md'), 'utf8'), '# 竞态前原稿\n');
    fs.rmSync(parent, { recursive: true, force: true });
  });

  await test('root 同路径换实体时同步失效，不等 4 秒 watcher 才拒写', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-root-id-'));
    const root = path.join(parent, 'workspace');
    fs.mkdirSync(root);
    const stat = fs.lstatSync(root);
    const runtime = {
      root: fs.realpathSync(root), closed: false,
      rootIdentity: { dev: stat.dev, ino: stat.ino }
    };
    assert.equal(main.assertVideoRuntimeIdentity(runtime), true);
    fs.renameSync(root, path.join(parent, 'old-workspace'));
    fs.mkdirSync(root);
    assert.throws(() => main.assertVideoRuntimeIdentity(runtime), (error) => (
      error && error.code === 'ERR_VIDEO_ROOT_CHANGED'
    ));
    fs.rmSync(parent, { recursive: true, force: true });
  });

  await test('拍摄窗口实际沙箱接线、工作区绑定与安全错误映射都在 main', async () => {
    const value = source('main.js');
    const windowBlock = value.slice(
      value.indexOf('function openShootingWindowForProject('),
      value.indexOf('function writeShootingOutputs(')
    );
    assert.match(windowBlock, /fullscreen:\s*true/);
    assert.match(windowBlock, /contextIsolation:\s*true/);
    assert.match(windowBlock, /nodeIntegration:\s*false/);
    assert.match(windowBlock, /sandbox:\s*true/);
    assert.match(windowBlock, /secureLocalWindow\(win, shootingFileUrl\)/);
    assert.match(windowBlock, /const nextRuntimeContext = \{/);
    assert.match(windowBlock, /rootIdentityKey: runtime\.rootIdentityKey/);
    assert.match(windowBlock, /shootingRuntimeContext = nextRuntimeContext/);
    const ipcBlock = value.slice(
      value.indexOf('function registerShootingIpc('),
      value.indexOf('function budgetIsPaused(')
    );
    assert.match(ipcBlock, /activeRuntime\.root !== shootingRuntimeContext\.root/);
    assert.match(ipcBlock, /source\.hash !== shootingRuntimeContext\.sourceHash/);
    assert.match(ipcBlock, /本次收工已经写回，不会重复创建文件/);
    assert.match(ipcBlock, /拍摄操作没有完成；未确认写回成功/);
  });

  await test('建议与撤销生产链绑定原稿、建议和采用后实体，不再路径直读', async () => {
    const value = source('main.js');
    const proposalSurfaceBlock = value.slice(
      value.indexOf('function videoProposalSurface('),
      value.indexOf('function videoTargetedActionPrompt(')
    );
    assert.match(proposalSurfaceBlock, /documents\.original\.binding/);
    assert.match(proposalSurfaceBlock, /documents\.proposal\.binding/);
    assert.match(proposalSurfaceBlock, /sameVideoFileBinding\(adopted\.binding, videoUndo\.adoptedBinding\)/);
    assert.equal(/fs\.readFileSync|resolveWorkspaceFile/.test(proposalSurfaceBlock), false);
    const decisionBlock = value.slice(
      value.indexOf('function decideVideoProposal('),
      value.indexOf('function shootingSurface(')
    );
    assert.match(decisionBlock, /expectedBinding: documents\.original\.binding/);
    assert.match(decisionBlock, /adoptedBinding: adoptedWrite\.binding/);
    assert.match(decisionBlock, /expectedBinding: videoUndo\.adoptedBinding/);
  });

  await test('watcher 有固定目录、去抖/兜底与 root 实体复验，不复用空旧数据', async () => {
    const value = source('main.js');
    assert.match(value, /VIDEO_WATCH_DEBOUNCE_MS = 220/);
    assert.match(value, /VIDEO_WATCH_FALLBACK_MS = 4000/);
    assert.match(value, /fs\.watch\(candidate, \{ persistent: false \}/);
    assert.match(value, /String\(rootStat\.dev\) !== String\(runtime\.rootIdentity\.dev\)/);
    assert.match(value, /String\(rootStat\.ino\) !== String\(runtime\.rootIdentity\.ino\)/);
    assert.match(value, /runtime\.projectTokens = new Map\(\)/);
    assert.match(value, /未使用旧数据/);
    assert.match(value, /videoCockpit\.scanWorkspace\(runtime\.root, \{ expectedRootIdentity: runtime\.rootIdentity \}\)/);
    assert.equal(/executeJavaScript/.test(value), false);
  });

  await test('产物清单含完整驾驶舱，运行时依赖仅保留精确飞书 SDK', async () => {
    const pkg = JSON.parse(source('package.json'));
    for (const entry of [
      'preload-shell.js', 'shell.html', 'shell.js', 'preload-shooting.js',
      'shooting.html', 'shooting.css', 'shooting.js', 'lib/**/*'
    ]) assert.ok(pkg.build.files.includes(entry), entry);
    assert.deepEqual(pkg.dependencies || {}, {
      '@larksuiteoapi/node-sdk': '1.73.0'
    });
  });

  console.log(`\nMAIN VIDEO RUNTIME ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN VIDEO RUNTIME FAIL:', error);
  process.exitCode = 1;
});
