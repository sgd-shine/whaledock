'use strict';

// v0.7 驾驶舱壳直测：纯 Node 验证布局、匿名任务条、IPC 白名单与安全边界。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
const main = require('../main');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v07: ${name}`);
  } catch (error) {
    console.error(`FAIL  main-v07: ${name}`);
    throw error;
  }
}

async function run() {
  await test('经典、驾驶舱、原生逃生门与折叠对话四种布局有明确边界', async () => {
    assert.deepEqual(main.mainViewLayout({ width: 1280, height: 820 }), {
      mode: 'classic', visible: true, bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    const cockpit = main.mainViewLayout({
      width: 1280, height: 820, cockpit: 'video', cockpitMode: 'cockpit'
    });
    assert.equal(cockpit.mode, 'cockpit');
    assert.equal(cockpit.visible, true);
    assert.ok(cockpit.bounds.x >= 860 && cockpit.bounds.x <= 940);
    assert.ok(cockpit.bounds.y >= 200, '任务条与对话标题必须留在 dsh 上方');
    assert.equal(cockpit.bounds.x + cockpit.bounds.width, 1280);
    assert.equal(cockpit.bounds.y + cockpit.bounds.height, 820);
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, cockpit: 'video', cockpitMode: 'native'
    }), {
      mode: 'classic', visible: true, bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    assert.equal(main.mainViewLayout({
      width: 1280, height: 820, cockpit: 'video', cockpitMode: 'cockpit', chatCollapsed: true
    }).visible, false);
  });

  await test('任务条只接收匿名五态、计数与最近结果', async () => {
    const value = main.cockpitTaskFlow({
      availability: { state: 'live', detail: null },
      waiting: { approvals: 2, questions: 1 },
      activity: { openTurns: 4, openSessions: 2 },
      recentTasks: [
        { taskKey: 'abcdefghijklmnop', ordinal: 7, label: '任务 07', result: 'completed', completedAt: '2026-08-21T16:00:00Z' },
        { taskKey: 'qrstuvwxyzABCDEF', ordinal: 8, label: '任务 08', result: 'error', completedAt: '2026-08-21T16:01:00Z' }
      ]
    });
    assert.deepEqual(value.activity, { state: 'waiting', label: '等你拍板' });
    assert.deepEqual(value.counts, { active: 4, waiting: 3, completed: 1 });
    assert.deepEqual(value.recent.map((item) => Object.keys(item).sort()), [
      ['completedAt', 'label', 'result'], ['completedAt', 'label', 'result']
    ]);
    assert.equal(JSON.stringify(value).includes('taskKey'), false);
    assert.equal(JSON.stringify(value).includes('session'), false);
  });

  await test('驾驶舱视图请求严格白名单且不接受任意命令', async () => {
    assert.deepEqual(main.cockpitViewRequest({ mode: 'native' }), {
      mode: 'native', chatCollapsed: null, focusChat: false
    });
    assert.deepEqual(main.cockpitViewRequest({ chatCollapsed: true }), {
      mode: null, chatCollapsed: true, focusChat: false
    });
    assert.deepEqual(main.cockpitViewRequest({ focusChat: true }), {
      mode: null, chatCollapsed: null, focusChat: true
    });
    assert.throws(() => main.cockpitViewRequest({ mode: 'evil' }));
    assert.throws(() => main.cockpitViewRequest({ focusChat: false }));
    assert.throws(() => main.cockpitViewRequest({ mode: 'cockpit', command: 'executeJavaScript' }));
  });

  await test('驾驶舱仍是本地壳，dsh 子视图无 preload/注入', async () => {
    const html = source('shell.html');
    const renderer = source('shell.js');
    const preload = source('preload-shell.js');
    const mainSource = source('main.js');
    assert.match(html, /id="video-cockpit"/);
    assert.match(html, /id="cockpit-route"/);
    assert.match(html, /id="cockpit-task-flow"/);
    assert.match(html, /id="cockpit-chat-placeholder"/);
    assert.match(html, /connect-src 'none'/);
    assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(renderer), false);
    assert.match(renderer, /event\.key\.toLowerCase\(\) === 'k'/);
    assert.match(preload, /shell:cockpit-view/);
    const viewBlock = mainSource.slice(
      mainSource.indexOf('const view = new WebContentsView'),
      mainSource.indexOf('win.contentView.addChildView(view)')
    );
    assert.equal(/preload|executeJavaScript/.test(viewBlock), false);
    assert.equal(/executeJavaScript/.test(mainSource), false);
  });

  await test('Cmd/Ctrl+K 只聚焦 dsh 视图，未伪称定位远程输入框', async () => {
    const value = source('main.js');
    const block = value.slice(
      value.indexOf('function focusCockpitChat('),
      value.indexOf('function cockpitViewRequest(')
    );
    assert.match(block, /dshView\.webContents\.focus\(\)/);
    assert.equal(/executeJavaScript|sendInputEvent|click\(/.test(block), false);
    assert.match(value, /accelerator: 'CommandOrControl\+K'/);
  });

  console.log(`\nMAIN V07 ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN V07 FAIL:', error);
  process.exit(1);
});
