'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const layout = require('../lib/project-layout');

const ROOT = path.join(__dirname, '..');
const SHA = 'a'.repeat(64);
let passed = 0;

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  project-layout: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-layout: ${name}`);
    throw error;
  }
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function descriptor(window, kind = 'markdown') {
  return {
    window,
    path: kind === 'html' ? 'output/report.html' : 'output/report.md',
    kind,
    fingerprint: { size: 12, mtime: 1720000000123, sha256: SHA },
    ...(kind === 'html' ? { openMode: 'electron-child' } : {})
  };
}

async function mainTest() {
  await test('纯 Node 模块不依赖 Electron，三预设槽位固定', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'project-layout.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.deepEqual(layout.PRESETS['split-two'].map((item) => [item.window, item.slot]), [
      [1, 'left'], [2, 'right']
    ]);
    assert.deepEqual(layout.PRESETS['left-stack'].map((item) => [item.window, item.slot]), [
      [1, 'left-top'], [2, 'left-bottom'], [3, 'right']
    ]);
    assert.deepEqual(layout.PRESETS['grid-four'].map((item) => [item.window, item.slot]), [
      [1, 'left-top'], [2, 'left-bottom'], [3, 'right-top'], [4, 'right-bottom']
    ]);
  });

  await test('新布局按预设生成固定“窗口N”和 tabs/active/collapsed', () => {
    const state = layout.createPaneState('grid-four');
    assert.equal(Object.isFrozen(state), true);
    assert.deepEqual(state.windows.map((item) => item.label), [
      '窗口1', '窗口2', '窗口3', '窗口4'
    ]);
    assert.equal(state.windows.every((item) => (
      Array.isArray(item.tabs) && item.tabs.length === 0
        && item.active === null && item.collapsed === false
    )), true);
    assert.throws(() => layout.validatePaneState({
      ...mutable(state),
      windows: [{ ...mutable(state.windows[0]), label: '左窗' }, ...mutable(state.windows.slice(1))]
    }), assertCode(layout.ERROR_CODES.invalid));
  });

  await test('切预设只追加缺窗，来回切换不删除旧窗口或 tabs', () => {
    const first = mutable(layout.createPaneState('split-two'));
    first.windows[0].tabs = [{
      id: 'draft-tab', type: 'markdown', title: '项目草稿', path: 'drafts/brief.md'
    }];
    first.windows[0].active = 'draft-tab';
    first.windows[1].tabs = [{
      id: 'site-tab', type: 'browser', title: '参考网页', url: 'https://example.com/a'
    }];
    first.windows[1].active = 'site-tab';
    const validated = layout.validatePaneState(first);
    const originalWindows = mutable(validated.windows);

    const stacked = layout.applyPreset(validated, 'left-stack');
    assert.deepEqual(stacked.windows.slice(0, 2), validated.windows);
    assert.equal(stacked.windows[2].label, '窗口3');
    const grid = layout.applyPreset(stacked, 'grid-four');
    assert.equal(grid.windows[3].label, '窗口4');
    const back = layout.applyPreset(grid, 'split-two');
    assert.equal(back.windows.length, 4, '缩回双窗预设也不得删除 3/4 号窗口');
    assert.deepEqual(back.windows.slice(0, 2), originalWindows);
  });

  await test('ensureTargetWindow 连续补齐目标窗且不删除既有 tabs', () => {
    const state = mutable(layout.createPaneState('split-two'));
    state.windows[0].tabs = [{
      id: 'draft', type: 'text', title: '草稿', path: 'drafts/one.txt'
    }];
    state.windows[0].active = 'draft';
    const ensured = layout.ensureTargetWindow(state, 6);
    assert.deepEqual(ensured.windows.map((item) => item.window), [1, 2, 3, 4, 5, 6]);
    assert.equal(ensured.windows[0].tabs[0].id, 'draft');
    assert.equal(ensured.preset, 'split-two');
    assert.strictEqual(layout.ensureTargetWindow(ensured, 6), ensured);
    assert.equal(layout.ensureTargetWindow(null, 4, 'grid-four').windows.length, 4);
  });

  await test('paneState 接受七种受控内容，terminal 无路径且 browser 只允许 http/https', () => {
    const state = mutable(layout.createPaneState('split-two'));
    const tabs = [
      { id: 'md', type: 'markdown', title: 'Markdown', path: 'a/readme.md' },
      { id: 'txt', type: 'text', title: '文本', path: 'a/note.txt' },
      { id: 'img', type: 'image', title: '图片', path: 'a/cover.png' },
      { id: 'web', type: 'browser', title: '网页', url: 'http://127.0.0.1:3000/' },
      {
        id: 'video', type: 'video-template', title: '短视频',
        templateId: 'builtin:短视频创作台'
      },
      { id: 'terminal', type: 'terminal', title: '终端' },
      {
        id: 'artifact', type: 'artifact', title: '产物', descriptor: descriptor(1), locked: true
      }
    ];
    for (const [index, tab] of tabs.entries()) {
      const candidate = mutable(state);
      candidate.windows[0].tabs = [tab];
      candidate.windows[0].active = tab.id;
      assert.equal(layout.validatePaneState(candidate).windows[0].tabs[0].type, tab.type,
        `必须接受 ${tab.type}`);
    }
    const invalid = mutable(state);
    invalid.windows[0].tabs = [{
      id: 'ftp', type: 'browser', title: 'FTP', url: 'ftp://example.com/file'
    }];
    invalid.windows[0].active = 'ftp';
    assert.throws(() => layout.validatePaneState(invalid),
      assertCode(layout.ERROR_CODES.invalid));

    const terminalWithPath = mutable(state);
    terminalWithPath.windows[0].tabs = [{
      id: 'terminal', type: 'terminal', title: '终端', path: '/private/project'
    }];
    terminalWithPath.windows[0].active = 'terminal';
    assert.throws(() => layout.validatePaneState(terminalWithPath),
      assertCode(layout.ERROR_CODES.invalid));
  });

  await test('paneState 只接受普通 JSON 且总量不超过 16 KiB', () => {
    const invalid = mutable(layout.createPaneState());
    invalid.windows[0].tabs = [{
      id: 'bad', type: 'text', title: '坏值', path: 'notes/a.txt', extra: new Date()
    }];
    invalid.windows[0].active = 'bad';
    assert.throws(() => layout.validatePaneState(invalid),
      assertCode(layout.ERROR_CODES.invalid));

    const oversized = {
      schemaVersion: layout.SCHEMA_VERSION,
      preset: 'split-two',
      windows: Array.from({ length: 16 }, (_item, windowIndex) => {
        const tabs = Array.from({ length: 32 }, (_tab, tabIndex) => ({
          id: `tab-${windowIndex + 1}-${tabIndex + 1}`,
          type: 'text',
          title: '标'.repeat(layout.LIMITS.maxTitleChars),
          path: `notes/${'x'.repeat(80)}-${windowIndex + 1}-${tabIndex + 1}.txt`
        }));
        return {
          window: windowIndex + 1,
          label: `窗口${windowIndex + 1}`,
          tabs,
          active: tabs[0].id,
          collapsed: false
        };
      })
    };
    assert.throws(() => layout.validatePaneState(oversized),
      assertCode(layout.ERROR_CODES.size));
  });

  await test('lockArtifact 清空目标窗并锁为唯一活动 artifact，重复调用幂等', () => {
    const state = mutable(layout.createPaneState());
    const window = {
      ...state.windows[0],
      collapsed: true,
      tabs: [
        { id: 'old-a', type: 'text', title: '旧 A', path: 'old/a.txt' },
        { id: 'old-b', type: 'image', title: '旧 B', path: 'old/b.png' }
      ],
      active: 'old-b'
    };
    const locked = layout.lockArtifact(window, descriptor(1));
    assert.equal(locked.tabs.length, 1);
    assert.equal(locked.tabs[0].type, 'artifact');
    assert.equal(locked.tabs[0].locked, true);
    assert.equal(locked.active, locked.tabs[0].id);
    assert.equal(locked.collapsed, false);
    assert.equal(Object.prototype.hasOwnProperty.call(
      locked.tabs[0].descriptor, 'absolutePath'
    ), false);
    const again = layout.lockArtifact(locked, descriptor(1));
    assert.strictEqual(again, locked, '同一产物重复锁定应返回同一冻结状态');
  });

  await test('产物窗口错配、绝对路径混入与 html 非子窗模式均 fail-closed', () => {
    const window = layout.createPaneState().windows[0];
    assert.throws(() => layout.lockArtifact(window, descriptor(2)),
      assertCode(layout.ERROR_CODES.artifact));
    assert.throws(() => layout.validateArtifactDescriptor({
      ...descriptor(1), absolutePath: '/private/tmp/result.md'
    }), assertCode(layout.ERROR_CODES.artifact));
    assert.throws(() => layout.validateArtifactDescriptor({
      ...descriptor(1, 'html'), openMode: 'iframe'
    }), assertCode(layout.ERROR_CODES.artifact));
  });

  await test('未知预设与越界窗口返回稳定错误码', () => {
    assert.throws(() => layout.createPaneState('unknown'),
      assertCode(layout.ERROR_CODES.preset));
    assert.throws(() => layout.lockArtifact({
      window: 17, label: '窗口17', tabs: [], active: null, collapsed: false
    }, descriptor(17)), assertCode(layout.ERROR_CODES.invalid));
  });

  console.log(`\nPROJECT LAYOUT ALL PASS (${passed})`);
}

mainTest().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
