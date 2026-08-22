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
  await test('经典、创作现场、全宽对话现场与原生逃生门有明确边界', async () => {
    assert.deepEqual(main.mainViewLayout({ width: 1280, height: 820 }), {
      mode: 'classic', visible: true, bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, cockpit: 'video', cockpitMode: 'cockpit'
    }), {
      mode: 'cockpit', visible: false,
      bounds: { x: 0, y: 136, width: 1280, height: 684 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, cockpit: 'video', cockpitMode: 'cockpit', chatOpen: true
    }), {
      mode: 'cockpit-chat', visible: true,
      bounds: { x: 0, y: 136, width: 1280, height: 684 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 960, height: 620, cockpit: 'video', cockpitMode: 'cockpit', chatOpen: true
    }), {
      mode: 'cockpit-chat', visible: true,
      bounds: { x: 0, y: 136, width: 960, height: 484 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, cockpit: 'video', cockpitMode: 'native'
    }), {
      mode: 'classic', visible: true, bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    assert.equal(main.mainViewLayout({
      width: 960, height: 120, cockpit: 'video', cockpitMode: 'cockpit', chatOpen: true
    }).visible, false, '顶部控件区不能被 child view 覆盖');
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
      mode: 'native', chatOpen: null, focusChat: false
    });
    assert.deepEqual(main.cockpitViewRequest({ chatOpen: true }), {
      mode: null, chatOpen: true, focusChat: false
    });
    assert.deepEqual(main.cockpitViewRequest({ focusChat: true }), {
      mode: null, chatOpen: null, focusChat: true
    });
    assert.throws(() => main.cockpitViewRequest({ mode: 'evil' }));
    assert.throws(() => main.cockpitViewRequest({ focusChat: false }));
    assert.throws(() => main.cockpitViewRequest({ mode: 'cockpit', chatOpen: true }));
    assert.throws(() => main.cockpitViewRequest({ mode: 'cockpit', command: 'executeJavaScript' }));
  });

  await test('鲸坞色系请求只接受单个安全主题 id', async () => {
    assert.deepEqual(main.cockpitThemeRequest({ themeId: 'sunset-coral' }), {
      themeId: 'sunset-coral'
    });
    assert.throws(() => main.cockpitThemeRequest('sunset-coral'));
    assert.throws(() => main.cockpitThemeRequest({ themeId: '../evil' }));
    assert.throws(() => main.cockpitThemeRequest({ themeId: 'aurora', path: '/tmp/theme' }));
  });

  await test('驾驶舱仍是本地壳，dsh 子视图无 preload/注入', async () => {
    const html = source('shell.html');
    const renderer = source('shell.js');
    const preload = source('preload-shell.js');
    const mainSource = source('main.js');
    assert.match(html, /id="video-cockpit"/);
    assert.match(html, /id="cockpit-route"/);
    assert.match(html, /id="cockpit-task-flow"/);
    assert.match(html, /id="toggle-chat"/);
    assert.match(html, /id="cockpit-theme-select"/);
    assert.match(html, /id="cockpit-theme-swatch"/);
    assert.match(html, /id="open-theme-settings"/);
    assert.doesNotMatch(html, /id="cockpit-panel"|id="cockpit-chat-placeholder"/);
    assert.doesNotMatch(html, /clamp\(340px,31vw,420px\)/);
    assert.match(html, /#cockpit-route[\s\S]*?height:136px/);
    assert.match(html, /#cockpit-scene[\s\S]*?top:136px/);
    assert.match(html, /body\.cockpit-active\.chat-open #toast[\s\S]*?top:98px; bottom:auto; height:30px/);
    assert.match(html, /connect-src 'none'/);
    assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(renderer), false);
    assert.match(renderer, /event\.key\.toLowerCase\(\) === 'k'/);
    assert.match(renderer, /chatOpen/);
    assert.match(preload, /shell:cockpit-view/);
    assert.match(preload, /shell:cockpit-theme/);
    assert.match(renderer, /api\.setCockpitTheme\(\{ themeId \}\)/);
    assert.match(mainSource, /theme: cockpitThemeSurface\(active\)/);
    assert.match(mainSource, /active\.theme[\s\S]*不能从顶栏覆盖/);
    assert.doesNotMatch(html, /#22d3ee(?:1c|aa|33|0b|18|88)/);
    assert.match(mainSource, /const COCKPIT_HEADER_HEIGHT = 136/);
    assert.doesNotMatch(mainSource, /COCKPIT_PANEL_|COCKPIT_DSH_TOP|cockpitChatCollapsed/);
    const viewBlock = mainSource.slice(
      mainSource.indexOf('const view = new WebContentsView'),
      mainSource.indexOf('win.contentView.addChildView(view)')
    );
    assert.equal(/preload|executeJavaScript/.test(viewBlock), false);
    assert.equal(/executeJavaScript/.test(mainSource), false);
  });

  await test('Cmd/Ctrl+K 先打开全宽对话再聚焦 dsh，未伪称定位远程输入框', async () => {
    const value = source('main.js');
    const block = value.slice(
      value.indexOf('function focusCockpitChat('),
      value.indexOf('function cockpitViewRequest(')
    );
    assert.match(block, /cockpitChatOpen = true[\s\S]*layoutMainWindow\(\)[\s\S]*dshView\.webContents\.focus\(\)/);
    assert.equal(/executeJavaScript|sendInputEvent|click\(/.test(block), false);
    assert.match(value, /accelerator: 'CommandOrControl\+K'/);
    const nativeToggle = value.slice(
      value.indexOf("label: cockpitNativeMode ? '返回视频驾驶舱'"),
      value.indexOf("{ type: 'separator' },", value.indexOf("label: cockpitNativeMode ? '返回视频驾驶舱'"))
    );
    assert.match(nativeToggle, /dshView\.webContents\.focus\(\)/);
    assert.match(nativeToggle, /mainWindow\.webContents\.focus\(\)/);
  });

  console.log(`\nMAIN V07 ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN V07 FAIL:', error);
  process.exit(1);
});
