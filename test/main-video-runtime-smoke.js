'use strict';

// v0.7 视频驾驶舱 Electron 薄层：验证 renderer 永远只能提交 opaque token/有限命令，
// 发布灯、建议版本、拍摄写回与本地窗口都 fail-closed。
process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';

const assert = require('assert/strict');
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
    assert.equal(main.publishChecklistSurface(checklist, 'unknown').ready, false);
    assert.equal(main.publishChecklistSurface(checklist, 'not-ai').ready, true);
    assert.equal(main.publishChecklistSurface(checklist, 'not-ai').published, false);
    assert.equal(main.publishChecklistSurface(checklist, 'ai').ready, false);
    const aiChecked = main.patchPublishLight(
      checklist, 'ai-label', true, cockpit.hashText(checklist)
    );
    assert.equal(main.publishChecklistSurface(aiChecked, 'ai').ready, true);
    assert.equal(main.publishChecklistSurface(aiChecked, 'ai').published, false);
  });

  await test('单灯写回只改目标 marker，错误 hash 原文不动', async () => {
    const text = '- [ ] 封面 <!-- whaledock:cover -->\n- [ ] 标题 <!-- whaledock:title -->\n';
    const patched = main.patchPublishLight(text, 'cover', true, cockpit.hashText(text));
    assert.equal(patched, '- [x] 封面 <!-- whaledock:cover -->\n- [ ] 标题 <!-- whaledock:title -->\n');
    assert.throws(() => main.patchPublishLight(text, 'cover', true, '0'.repeat(64)), (error) => (
      error && error.code === 'ERR_CAS_MISMATCH'
    ));
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
    main.atomicReplaceVideoText(
      tmp, '02_脚本/复制回退.md', cockpit.hashText('# 复制原稿\n'), '# 复制新稿\n', {
        rootIdentity, forceCopy: true
      }
    );
    assert.equal(fs.readFileSync(copyTarget, 'utf8'), '# 复制新稿\n');

    const fsyncTarget = path.join(tmp, '02_脚本', 'fsync-故障.md');
    fs.writeFileSync(fsyncTarget, '# fsync 原稿\n');
    const realFsyncSync = fs.fsyncSync;
    try {
      assert.throws(() => main.atomicReplaceVideoText(
        tmp, '02_脚本/fsync-故障.md', cockpit.hashText('# fsync 原稿\n'), '# fsync 新稿\n', {
          rootIdentity,
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
      tmp, '02_脚本/稿.md', originalHash, '# 不该写入\n', { rootIdentity }
    ));
    assert.equal(fs.readFileSync(target, 'utf8'), '# 新稿\n');

    const external = path.join(tmp, '02_脚本', '外部并发.md');
    fs.writeFileSync(external, '# 外部并发稿\n');
    assert.throws(() => main.atomicReplaceVideoText(
      tmp, '02_脚本/稿.md', cockpit.hashText('# 新稿\n'), '# 鲸坞不该覆盖\n', {
        rootIdentity,
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
    assert.match(windowBlock, /shootingRuntimeContext = \{/);
    const ipcBlock = value.slice(
      value.indexOf('function registerShootingIpc('),
      value.indexOf('function budgetIsPaused(')
    );
    assert.match(ipcBlock, /activeRuntime\.root !== shootingRuntimeContext\.root/);
    assert.match(ipcBlock, /source\.hash !== shootingRuntimeContext\.sourceHash/);
    assert.match(ipcBlock, /本次收工已经写回，不会重复创建文件/);
    assert.match(ipcBlock, /拍摄操作没有完成；未确认写回成功/);
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
    assert.equal(/executeJavaScript/.test(value), false);
  });

  await test('产物清单含完整驾驶舱，运行时依赖仍为空', async () => {
    const pkg = JSON.parse(source('package.json'));
    for (const entry of [
      'preload-shell.js', 'shell.html', 'shell.js', 'preload-shooting.js',
      'shooting.html', 'shooting.css', 'shooting.js', 'lib/**/*'
    ]) assert.ok(pkg.build.files.includes(entry), entry);
    assert.deepEqual(pkg.dependencies || {}, {});
  });

  console.log(`\nMAIN VIDEO RUNTIME ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN VIDEO RUNTIME FAIL:', error);
  process.exitCode = 1;
});
