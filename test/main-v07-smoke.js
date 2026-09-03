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
  await test('默认项目全宽；显式经典、创作现场、全宽对话与原生逃生门边界明确', async () => {
    assert.deepEqual(main.mainViewLayout({ width: 1280, height: 820 }), {
      mode: 'projects', visible: true, bounds: { x: 0, y: 0, width: 1280, height: 820 }
    });
    assert.deepEqual(main.mainViewLayout({ width: 1280, height: 820, classicMode: true }), {
      mode: 'classic', visible: true, bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, classicMode: true,
      cockpit: 'video', cockpitMode: 'cockpit'
    }), {
      mode: 'cockpit', visible: false,
      bounds: { x: 0, y: 136, width: 1280, height: 684 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, classicMode: true,
      cockpit: 'video', cockpitMode: 'cockpit', chatOpen: true
    }), {
      mode: 'cockpit-chat', visible: true,
      bounds: { x: 0, y: 96, width: 1280, height: 724 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 960, height: 620, classicMode: true,
      cockpit: 'video', cockpitMode: 'cockpit', chatOpen: true
    }), {
      mode: 'cockpit-chat', visible: true,
      bounds: { x: 0, y: 96, width: 960, height: 524 }
    });
    assert.deepEqual(main.mainViewLayout({
      width: 1280, height: 820, classicMode: true,
      cockpit: 'video', cockpitMode: 'native'
    }), {
      mode: 'classic', visible: true, bounds: { x: 132, y: 0, width: 1148, height: 820 }
    });
    assert.equal(main.mainViewLayout({
      width: 960, height: 96, classicMode: true,
      cockpit: 'video', cockpitMode: 'cockpit', chatOpen: true
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
    assert.match(html, /id="cockpit-workspace"/);
    assert.match(html, /id="rail-workspace"/);
    assert.doesNotMatch(html, /id="cockpit-panel"|id="cockpit-chat-placeholder"/);
    assert.doesNotMatch(html, /clamp\(340px,31vw,420px\)/);
    assert.match(html, /#cockpit-route[\s\S]*?height:136px/);
    assert.match(html, /body\.cockpit-active\.chat-open #cockpit-route[\s\S]*?height:96px/);
    assert.match(html, /body\.cockpit-active\.chat-open #route-stages[\s\S]*?display:none/);
    assert.match(html, /body\.cockpit-active\.chat-open #cockpit-task-flow[\s\S]*?display:none/);
    assert.match(html,
      /body\.cockpit-active\.chat-open \.cockpit-brand \.eyebrow[\s\S]*?display:none/);
    assert.match(html,
      /body\.cockpit-active\.chat-open #cockpit-context-bridge-banner:not\(\[hidden\]\) strong[\s\S]*?display:inline/);
    assert.match(html,
      /body\.cockpit-active\.chat-open #cockpit-context-bridge-banner:not\(\[hidden\]\)[\s\S]*?top:50px; left:18px; right:18px; height:38px;[\s\S]*?white-space:normal/);
    assert.match(html, /#cockpit-scene[\s\S]*?top:136px/);
    assert.match(html,
      /body\.cockpit-active\.chat-open #toast[\s\S]*?top:50px; bottom:auto;[\s\S]*?height:38px/);
    assert.match(html,
      /id="cockpit-workbench-guide" role="status" aria-live="polite"[\s\S]*创作文件推进内容 · 对话记录继续沟通/);
    assert.match(html, /connect-src 'none'/);
    assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(renderer), false);
    assert.match(renderer, /event\.key\.toLowerCase\(\) === 'k'/);
    assert.match(renderer, /chatOpen/);
    assert.match(renderer, /chatOpen \? '返回创作流程' : 'AI 工作台 ⌘K'/);
    assert.match(preload, /shell:cockpit-view/);
    assert.match(preload, /shell:cockpit-theme/);
    assert.match(renderer, /api\.setCockpitTheme\(\{ themeId \}\)/);
    assert.match(mainSource, /theme: cockpitThemeSurface\(active\)/);
    assert.match(mainSource, /active\.theme[\s\S]*不能从顶栏覆盖/);
    assert.doesNotMatch(html, /#22d3ee(?:1c|aa|33|0b|18|88)/);
    assert.match(mainSource, /const COCKPIT_HEADER_HEIGHT = 136/);
    assert.match(mainSource, /const COCKPIT_CHAT_HEADER_HEIGHT = 96/);
    assert.doesNotMatch(mainSource, /COCKPIT_PANEL_|COCKPIT_DSH_TOP|cockpitChatCollapsed/);
    const viewBlock = mainSource.slice(
      mainSource.indexOf('const view = new WebContentsView'),
      mainSource.indexOf('win.contentView.addChildView(view)')
    );
    assert.equal(/preload|executeJavaScript/.test(viewBlock), false);
    assert.equal(/executeJavaScript/.test(mainSource), false);
  });

  await test('工作区标签只下发名称和可打开状态，经典台与驾驶舱复用安全打开入口', async () => {
    assert.deepEqual(main.workspaceIdentitySurface({
      busy: false,
      current: { label: '\u0000 项目\nA ', effectivePath: '/private/work/project-a' }
    }), { label: '项目 A', available: true });
    assert.deepEqual(main.workspaceIdentitySurface({
      busy: true,
      current: { label: '切换中', effectivePath: '/private/work/project-b' }
    }), { label: '切换中', available: false });
    assert.equal(JSON.stringify(main.workspaceIdentitySurface({
      current: { label: '项目 A', effectivePath: '/private/work/secret' }
    })).includes('/private/work'), false, '渲染层不得拿到绝对路径');

    const renderer = source('shell.js');
    assert.match(renderer, /railWorkspace\.addEventListener\('click',[\s\S]*api\.openWorkspace\(\)/);
    assert.match(renderer, /cockpitWorkspace\.addEventListener\('click',[\s\S]*api\.openWorkspace\(\)/);
    assert.match(renderer, /button\.textContent = `工作区：\$\{workspaceLabel\}`/);
    assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(renderer), false);

    const onboarding = source('assets/workbenches/短视频创作台/onboarding.md');
    assert.match(onboarding, /\[示意图\].*工作台.*会话.*工作区/);
    assert.match(onboarding, /工作台 = 玩法界面/);
    assert.match(onboarding, /工作区 = 它读写的文件夹/);
    assert.match(onboarding, /会话 = 真正干活的 agent，任务写进它所在的文件夹/);
    assert.match(onboarding, /文稿（Documents）\/鲸坞工作台\/默认工作区/);
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
      value.indexOf("label: cockpitNativeMode ? '返回视频创作流程'"),
      value.indexOf("{ type: 'separator' },",
        value.indexOf("label: cockpitNativeMode ? '返回视频创作流程'"))
    );
    assert.match(nativeToggle, /dshView\.webContents\.focus\(\)/);
    assert.match(nativeToggle, /mainWindow\.webContents\.focus\(\)/);
  });

  await test('发布前体验小修：灵感即时清空、建议标题分行且 Cmd/Ctrl+Shift+K 不误触', async () => {
    const renderer = source('shell.js');
    const html = source('shell.html');
    const inspiration = renderer.slice(
      renderer.indexOf('function renderInspirationScene()'),
      renderer.indexOf('function renderTopicScene()')
    );
    assert.match(inspiration,
      /if \(result && \(result\.kind === 'ok' \|\| result\.stored === true\)\) \{\s*inspirationDraft = '';\s*renderScene\(\);\s*\}/);
    assert.equal((inspiration.match(/inspirationDraft\s*=\s*''/g) || []).length, 1);

    const proposal = renderer.slice(
      renderer.indexOf('function renderProposal()'),
      renderer.indexOf('function renderScriptScene()')
    );
    assert.match(proposal, /title\.className = 'proposal-title'/);
    assert.match(html, /\.proposal-title\s*\{[^}]*display:grid;[^}]*gap:/);

    const shortcut = renderer.slice(renderer.indexOf("document.addEventListener('keydown'"));
    assert.match(shortcut,
      /\(event\.metaKey \|\| event\.ctrlKey\) && !event\.altKey\s*&& !event\.shiftKey\s*&& event\.key\.toLowerCase\(\) === 'k'/);
  });

  console.log(`\nMAIN V07 ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN V07 FAIL:', error);
  process.exit(1);
});
