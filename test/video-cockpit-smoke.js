'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cockpit = require('../lib/video-cockpit');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  video-cockpit: ${name}`);
  } catch (error) {
    console.error(`FAIL  video-cockpit: ${name}`);
    throw error;
  }
}

function write(root, relative, value) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, 'utf8');
  return target;
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => Boolean(error) && error.code === code);
}

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-video-cockpit-'));
  const root = path.join(tmp, 'workspace');
  fs.mkdirSync(root);

  test('公开常量与 hash 稳定且不暴露可变集合', () => {
    assert.equal(cockpit.LIMITS.maxFileBytes, 512 * 1024);
    assert.ok(Object.isFrozen(cockpit.LIMITS));
    assert.ok(Object.isFrozen(cockpit.STAGES));
    assert.deepEqual(cockpit.STAGES, [
      'inspiration', 'topic', 'script', 'shoot', 'edit', 'publish', 'data', 'review', 'asset'
    ]);
    assert.match(cockpit.hashText('鲸坞'), /^[a-f0-9]{64}$/);
    assert.equal(cockpit.hashText('鲸坞'), cockpit.hashText('鲸坞'));
    assert.notEqual(cockpit.hashText('鲸坞'), cockpit.hashText('鲸坞。'));
  });

  test('旧文件无 front matter 时原文只读兼容', () => {
    const text = '# 老选题\n\n这是旧文件。\n';
    const parsed = cockpit.parseFrontMatter(text);
    assert.equal(parsed.hasFrontMatter, false);
    assert.deepEqual(parsed.fields, {});
    assert.equal(parsed.body, text);
    assert.equal(parsed.bodyLine, 1);
    assert.deepEqual(parsed.rawLines, []);
    assert.deepEqual(parsed.issues, []);
  });

  test('front matter 只暴露白名单平面字段，列表用竖线，未知行原样保留', () => {
    const text = [
      '---',
      'title: 一条视频',
      'stage: script',
      'platforms: 抖音 | 小红书 | 视频号',
      'angles: 实测 | 避坑',
      'futureKey: 未来字段',
      '# keep this comment',
      '---',
      '# 正文',
      ''
    ].join('\n');
    const parsed = cockpit.parseFrontMatter(text);
    assert.equal(parsed.hasFrontMatter, true);
    assert.equal(parsed.fields.title, '一条视频');
    assert.equal(parsed.fields.stage, 'script');
    assert.deepEqual(parsed.fields.platforms, ['抖音', '小红书', '视频号']);
    assert.deepEqual(parsed.fields.angles, ['实测', '避坑']);
    assert.equal(Object.hasOwn(parsed.fields, 'futureKey'), false);
    assert.ok(parsed.rawLines.includes('futureKey: 未来字段'));
    assert.ok(parsed.rawLines.includes('# keep this comment'));
    assert.equal(parsed.body, '# 正文\n');
    assert.equal(parsed.bodyLine, 9);
    assert.ok(parsed.issues.some((item) => item.code === 'unknown-field' && item.key === 'futureKey'));
  });

  test('patchFrontMatter 保留未知键与正文，只改白名单字段', () => {
    const text = [
      '---',
      'title: 旧标题',
      'futureKey: 原样保留 : 仍保留',
      'decision: 待定',
      '---',
      '',
      '# 正文',
      '正文一个字不能丢。',
      ''
    ].join('\n');
    const patched = cockpit.patchFrontMatter(text, {
      title: '新标题',
      platforms: ['抖音', '小红书'],
      decision: null
    }, cockpit.hashText(text));
    assert.ok(patched.includes('title: 新标题'));
    assert.ok(patched.includes('platforms: 抖音 | 小红书'));
    assert.ok(patched.includes('futureKey: 原样保留 : 仍保留'));
    assert.equal(patched.includes('decision:'), false);
    assert.ok(patched.endsWith('\n# 正文\n正文一个字不能丢。\n'));
    const parsed = cockpit.parseFrontMatter(patched);
    assert.equal(parsed.fields.title, '新标题');
    assert.deepEqual(parsed.fields.platforms, ['抖音', '小红书']);
  });

  test('patchFrontMatter 以原文 hash 做 CAS，并拒绝非白名单键', () => {
    const text = '# 原文\n';
    throwsCode(() => cockpit.patchFrontMatter(text, { title: '新' }, '0'.repeat(64)), 'ERR_CAS_MISMATCH');
    throwsCode(() => cockpit.patchFrontMatter(text, { command: 'rm -rf /' }, cockpit.hashText(text)), 'ERR_PATCH_FIELD');
    const patched = cockpit.patchFrontMatter(text, { title: '新增头部', stage: 'topic' }, cockpit.hashText(text));
    assert.ok(patched.startsWith('---\ntitle: 新增头部\nstage: topic\n---\n\n# 原文\n'));
    throwsCode(
      () => cockpit.patchFrontMatter(patched, { stage: 'future-stage' }, cockpit.hashText(patched)),
      'ERR_FRONT_MATTER_VALUE'
    );
  });

  test('patchFrontMatter 遇到待改字段重复时 fail-closed，不静默删行', () => {
    const text = [
      '---', 'title: 原标题', 'title: 另一个标题', 'stage: script', '---', '# 正文', ''
    ].join('\n');
    throwsCode(
      () => cockpit.patchFrontMatter(text, { title: '新标题' }, cockpit.hashText(text)),
      'ERR_FRONT_MATTER_DUPLICATE'
    );
  });

  test('UTF-8 BOM 纳入 hash/CAS 且 front matter 写回原样保留', () => {
    const text = '\uFEFF---\ntitle: BOM 稿\nstage: script\n---\n# 正文\n';
    write(root, '02_脚本/BOM.md', text);
    const document = cockpit.readDocument(root, '02_脚本/BOM.md');
    assert.equal(document.text.charCodeAt(0), 0xFEFF);
    assert.equal(document.hash, cockpit.hashText(text));
    const patched = cockpit.patchFrontMatter(
      document.text, { title: 'BOM 新稿' }, document.hash
    );
    assert.equal(patched.charCodeAt(0), 0xFEFF);
    assert.equal(cockpit.parseFrontMatter(patched).fields.title, 'BOM 新稿');
  });

  test('safeRelativePath 只收 1–4 段相对 md/txt', () => {
    assert.equal(cockpit.safeRelativePath('01_选题库/题目.md'), '01_选题库/题目.md');
    assert.equal(cockpit.safeRelativePath('06_灵感收件箱/待分拣/一条.txt'), '06_灵感收件箱/待分拣/一条.txt');
    for (const bad of [
      '/tmp/a.md', '../a.md', 'a/../../b.md', 'C:\\Temp\\a.md', 'a\\b.md',
      'a/b/c/d/e.md', 'a.json', '.hidden.md', 'a//b.md', 'a/./b.md', 'a/尾部. /b.md',
      'a/伪换行\u2028注入.md', 'a/方向\u202E反转.md'
    ]) assert.equal(cockpit.safeRelativePath(bad), null, bad);
  });

  test('resolveWorkspaceFile 拒文件软链、realpath 越界与超限文件', () => {
    const normal = write(root, '01_选题库/正常.md', '# 正常\n');
    assert.equal(cockpit.resolveWorkspaceFile(root, '01_选题库/正常.md'), fs.realpathSync(normal));

    const fakeFs = {
      realpathSync(value) { return path.resolve(value); },
      lstatSync() {
        return { isSymbolicLink: () => true, isFile: () => false, size: 1 };
      }
    };
    throwsCode(
      () => cockpit.resolveWorkspaceFile(root, '01_选题库/link.md', { fsImpl: fakeFs }),
      'ERR_PATH_SYMLINK'
    );

    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    write(outside, 'leak.md', '# 不许读\n');
    const junction = path.join(root, '01_选题库', 'escape');
    fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
    throwsCode(
      () => cockpit.resolveWorkspaceFile(root, '01_选题库/escape/leak.md'),
      'ERR_PATH_OUTSIDE'
    );

    fs.writeFileSync(path.join(root, '01_选题库', '太大.md'), Buffer.alloc(cockpit.LIMITS.maxFileBytes + 1));
    throwsCode(
      () => cockpit.resolveWorkspaceFile(root, '01_选题库/太大.md'),
      'ERR_FILE_TOO_LARGE'
    );
  });

  test('parseDocumentBlocks 按标题、空段、表格行切块且 id 不受空行位移影响', () => {
    const text = [
      '---',
      'title: 分块',
      'future: keep',
      '---',
      '# 第一幕',
      '',
      '第一段第一行',
      '第一段第二行',
      '',
      '| 镜头 | 台词 |',
      '| --- | --- |',
      '| 1 | 开场 |',
      '',
      '## 收尾',
      '最后一句',
      ''
    ].join('\n');
    const blocks = cockpit.parseDocumentBlocks(text);
    assert.deepEqual(blocks.map((item) => item.kind), [
      'heading', 'paragraph', 'table-row', 'table-row', 'table-row', 'heading', 'paragraph'
    ]);
    for (const block of blocks) {
      assert.equal(text.slice(block.startOffset, block.endOffset), block.text);
      assert.match(block.id, /^block-[a-f0-9]{16}-\d+$/);
      assert.ok(block.startLine <= block.endLine);
    }
    const shifted = text.replace('---\n# 第一幕', '---\n\n\n# 第一幕');
    const shiftedBlocks = cockpit.parseDocumentBlocks(shifted);
    assert.deepEqual(shiftedBlocks.map((item) => [item.kind, item.text, item.id]),
      blocks.map((item) => [item.kind, item.text, item.id]));
  });

  test('readDocument 不返回绝对路径，旧文件从目录推导 stage', () => {
    write(root, '02_脚本/旧稿.md', '# 旧稿标题\n\n第一段。\n');
    const document = cockpit.readDocument(root, '02_脚本/旧稿.md');
    assert.equal(document.relativePath, '02_脚本/旧稿.md');
    assert.equal(document.title, '旧稿标题');
    assert.equal(document.stage, 'script');
    assert.deepEqual(document.fields, {});
    assert.equal(document.hash, cockpit.hashText(document.text));
    assert.ok(document.blocks.length >= 2);
    assert.equal(JSON.stringify(document).includes(root), false);
  });

  test('scanWorkspace 只读批准目录、有限输出并推导 today', () => {
    write(root, '01_选题库/待拍板.md', [
      '---', 'title: 要不要拍这个', 'decision: 需要 SGD 选角度', '---', '# 选题', ''
    ].join('\n'));
    write(root, '06_灵感收件箱/待分拣/灵感.txt', [
      '---', 'status: needs-decision', '---', '一条灵感', ''
    ].join('\n'));
    write(root, '07_打法库/开场.md', '# 三秒开场\n');
    write(root, '05_禁止扫描/秘密.md', '# 绝不能出现\n');

    let writes = 0;
    const guardedFs = new Proxy(fs, {
      get(target, property) {
        if (['writeFileSync', 'appendFileSync', 'renameSync', 'rmSync', 'mkdirSync'].includes(property)) {
          return () => { writes += 1; throw new Error('scan attempted write'); };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const scanned = cockpit.scanWorkspace(root, { fsImpl: guardedFs });
    assert.equal(writes, 0);
    assert.equal(scanned.items.some((item) => item.relativePath.includes('05_禁止扫描')), false);
    assert.equal(scanned.items.some((item) => item.title === '绝不能出现'), false);
    assert.equal(scanned.stageCounts.topic >= 1, true);
    assert.equal(scanned.stageCounts.inspiration >= 1, true);
    assert.equal(scanned.stageCounts.asset >= 1, true);
    assert.deepEqual(scanned.today.map((item) => item.relativePath).sort(), [
      '01_选题库/待拍板.md', '06_灵感收件箱/待分拣/灵感.txt'
    ]);
    assert.ok(scanned.items.length <= cockpit.LIMITS.maxScanItems);
    assert.equal(JSON.stringify(scanned).includes(root), false);
  });

  test('scanWorkspace 在根目录消失时报告不可读，不冒充空工作区', () => {
    const gone = path.join(root, 'gone-workspace');
    fs.mkdirSync(gone);
    fs.rmdirSync(gone);
    throwsCode(() => cockpit.scanWorkspace(gone), 'ERR_ROOT_UNREADABLE');
  });

  const proposalSource = [
    '---',
    'title: 脚本样例',
    'stage: script',
    'futureKey: 必须留下',
    '---',
    '# 开场',
    '',
    '原来的第一段。',
    '',
    '## 第二段',
    '',
    '第二段不能动。',
    ''
  ].join('\n');
  write(root, '02_脚本/提案稿.md', proposalSource);
  const document = cockpit.readDocument(root, '02_脚本/提案稿.md');
  const target = document.blocks.find((item) => item.text === '原来的第一段。');
  const plan = cockpit.createProposalPlan(document, target.id, '把这段改得更口语，保持事实不变。', 'proposal-001');

  test('createProposalPlan 生成完整副本与不含绝对路径的 CAS record', () => {
    assert.equal(plan.kind, 'create-proposal');
    assert.equal(plan.relativePath, '00_鲸坞建议/proposal-001.md');
    assert.equal(plan.text, proposalSource);
    assert.equal(plan.expectedAbsent, true);
    assert.equal(plan.record.originalHash, document.hash);
    assert.equal(plan.record.sourceRelativePath, '02_脚本/提案稿.md');
    assert.equal(plan.record.proposalRelativePath, plan.relativePath);
    assert.equal(plan.record.prefix + plan.record.originalBlock + plan.record.suffix, proposalSource);
    assert.equal(JSON.stringify(plan).includes(root), false);
  });

  test('proposal 原样未改目标块时不 ready', () => {
    const compared = cockpit.proposalComparison(plan.record, plan.text, proposalSource);
    assert.equal(compared.ready, false);
    assert.equal(compared.status, 'unchanged');
  });

  test('proposal 修改 prefix 或 suffix 属于越界 invalid', () => {
    const changedBlock = '新的第一段，更口语。';
    const proposal = plan.record.prefix + changedBlock + plan.record.suffix;
    const invalidPrefix = `越界${proposal}`;
    const invalidSuffix = `${proposal}越界`;
    assert.equal(cockpit.proposalComparison(plan.record, invalidPrefix, proposalSource).status, 'invalid');
    assert.equal(cockpit.proposalComparison(plan.record, invalidSuffix, proposalSource).status, 'invalid');
  });

  test('原稿并发变化时 proposal stale', () => {
    const proposal = plan.record.prefix + '新的第一段。' + plan.record.suffix;
    const compared = cockpit.proposalComparison(plan.record, proposal, `${proposalSource}\n并发修改`);
    assert.equal(compared.ready, false);
    assert.equal(compared.status, 'stale');
  });

  test('adoptProposal 只替换目标块并生成可验证 undo', () => {
    const replacement = '新的第一段，更口语。';
    const proposal = plan.record.prefix + replacement + plan.record.suffix;
    const compared = cockpit.proposalComparison(plan.record, proposal, proposalSource);
    assert.equal(compared.ready, true);
    assert.equal(compared.status, 'ready');
    const adopted = cockpit.adoptProposal(plan.record, proposal, proposalSource);
    assert.equal(adopted.text, proposal);
    assert.equal(adopted.text.startsWith(plan.record.prefix), true);
    assert.equal(adopted.text.endsWith(plan.record.suffix), true);
    assert.ok(adopted.text.includes('第二段不能动。'));
    assert.equal(adopted.adoptedHash, cockpit.hashText(adopted.text));
    assert.equal(adopted.undo.adoptedHash, adopted.adoptedHash);
  });

  test('undoAdoption 只在 adoptedHash 匹配时恢复', () => {
    const proposal = plan.record.prefix + '新的第一段，更口语。' + plan.record.suffix;
    const adopted = cockpit.adoptProposal(plan.record, proposal, proposalSource);
    throwsCode(() => cockpit.undoAdoption(adopted.undo, `${adopted.text}\n又被改了`), 'ERR_CAS_MISMATCH');
    const restored = cockpit.undoAdoption(adopted.undo, adopted.text);
    assert.equal(restored.text, proposalSource);
    assert.equal(restored.hash, document.hash);
  });

  test('buildBlockPrompt 是固定第一方边界，只指向 proposal 与目标块', () => {
    const prompt = cockpit.buildBlockPrompt(plan, '把这段压到 15 秒内。');
    assert.ok(prompt.includes('00_鲸坞建议/proposal-001.md'));
    assert.ok(prompt.includes(target.id));
    assert.ok(prompt.includes('只修改建议副本'));
    assert.ok(prompt.includes('不得修改原稿'));
    assert.ok(prompt.includes('把这段压到 15 秒内。'));
    assert.equal(prompt.includes(root), false);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nVIDEO COCKPIT ALL PASS (${passed})`);
}

try {
  run();
} catch (error) {
  console.error('VIDEO COCKPIT FAIL:', error);
  process.exitCode = 1;
}
