'use strict';

// v0.6 Electron 薄层直测：不启动 Electron，只加载 main.js 的可测导出并对源码做结构断言。
// 这一层要证明的是「壳」的安全性质：dsh 页面拿不到 IPC、包内容不被执行、
// actions 提交只走 v0.4 适配器且 unknown 绝不自动重试、拖入安装只复制不解压不执行。
process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const main = require('../main.js');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v06: ${name}`);
  } catch (error) {
    console.error(`FAIL  main-v06: ${name}`);
    throw error;
  }
}

async function main06() {
  await test('外壳页带房规 CSP、脚本外置、没有内联脚本', async () => {
    const html = source('shell.html');
    assert.match(html, /default-src 'self'/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /<script src="shell\.js"><\/script>/);
    // 除了那一行外置引用，不许有任何内联 <script>。
    assert.equal(/<script(?!\s+src=)/.test(html), false);
    // 页面本身不许引任何远程资源。
    assert.equal(/https?:\/\//.test(html), false);
  });

  await test('外壳渲染层不用 HTML 字符串赋值，也不碰网络', async () => {
    const renderer = source('shell.js');
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(renderer), false);
    assert.equal(/https?:\/\//.test(renderer), false);
    assert.equal(/\beval\s*\(|new\s+Function\s*\(/.test(renderer), false);
    // 渲染层只认 actionId，拿不到提示词全文。
    assert.match(renderer, /api\.runAction\(action\.id\)/);
    assert.equal(/\.prompt\b/.test(renderer), false, '渲染层不该出现 prompt 字段');
    // unknown 时明确不重试，只给文案。
    assert.match(renderer, /已提交，但没收到确认/);
    // 点击后 5 秒禁用自己，防连点重复排队。
    assert.match(renderer, /button\.disabled = true/);
    assert.match(renderer, /5000/);
  });

  await test('外壳 preload 只暴露固定通道，不泄露 ipcRenderer，也不 require fs', async () => {
    const preload = source('preload-shell.js');
    assert.match(preload, /contextBridge\.exposeInMainWorld\('whaleShell'/);
    assert.equal(/exposeInMainWorld\([^,]+,\s*ipcRenderer/.test(preload), false);
    assert.equal(/require\(['"](?:fs|child_process|shell|clipboard|path)['"]\)/.test(preload), false);
    const channels = [...preload.matchAll(/ipcRenderer\.(?:invoke|on)\('([^']+)'/g)]
      .map((item) => item[1]).sort();
    assert.deepEqual([...new Set(channels)], [
      'shell:action', 'shell:get', 'shell:install', 'shell:notice',
      'shell:onboarding-seen', 'shell:open-settings', 'shell:open-workspace',
      'shell:remove', 'shell:state', 'shell:switch'
    ]);
    // 拖入的路径只由 webUtils 解析后交给主进程；webUtils 本身绝不暴露给页面。
    assert.match(preload, /webUtils\.getPathForFile\(file\)/);
    assert.equal(/exposeInMainWorld\([\s\S]*webUtils/.test(preload), false);
  });

  await test('外壳 IPC 全部走三重校验，且通道集合与 preload 完全对上', async () => {
    const value = source('main.js');
    assert.match(value, /function trustedShellEvent\(event\) \{\n\s*return trustedLocalEvent\(event, mainWindow, pathToFileURL/);
    const block = value.slice(value.indexOf('function registerShellIpc()'), value.indexOf('function registerSettingsIpc()'));
    const handled = [...block.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((item) => item[1]).sort();
    assert.deepEqual(handled, [
      'shell:action', 'shell:get', 'shell:install', 'shell:onboarding-seen',
      'shell:open-settings', 'shell:open-workspace', 'shell:remove', 'shell:switch'
    ]);
    // 每一个 handle 都必须裹在 trustedShellHandler 里，一个都不能漏。
    const guarded = (block.match(/trustedShellHandler\(/g) || []).length;
    assert.equal(guarded, handled.length);
    // 注册前先清旧 handler，跟其他窗口一个套路。
    assert.match(block, /for \(const channel of channels\) ipcMain\.removeHandler\(channel\);/);
  });

  await test('unknown 假适配器：只发一次，绝不自动重试、不重复发', async () => {
    let listCalls = 0;
    let submitCalls = 0;
    const seen = [];
    const adapter = {
      async listTargets() {
        listCalls += 1;
        return {
          available: true,
          reason: 'ready',
          targets: [
            { targetToken: 'tok-old', label: '会话 01', running: false, updatedAt: '2026-08-01T00:00:00.000Z' },
            { targetToken: 'tok-new', label: '会话 02', running: true, updatedAt: '2026-08-19T00:00:00.000Z' }
          ]
        };
      },
      async submitText(request) {
        submitCalls += 1;
        seen.push(request);
        return { state: 'unknown', reason: 'transport' };
      }
    };
    const result = await main.submitPromptOnce(adapter, '读 01_选题库，给三个选题。');
    assert.equal(result.state, 'unknown');
    assert.equal(result.reason, 'transport');
    assert.equal(submitCalls, 1, 'unknown 时不允许自动重试');
    assert.equal(listCalls, 1);
    // 发给最近更新过的那个会话，且提示词一个字符都没被改写。
    assert.equal(seen[0].targetToken, 'tok-new');
    assert.equal(seen[0].text, '读 01_选题库，给三个选题。');
    assert.equal(result.target, '会话 02');
    // 源码层面再钉一次：这条路径上没有任何重试或循环。
    const value = source('main.js');
    const block = value.slice(value.indexOf('async function submitPromptOnce('), value.indexOf('// ---------- actions 按钮'));
    assert.equal(/for\s*\(|while\s*\(|retry|setTimeout/i.test(block), false);
    assert.equal((block.match(/adapter\.submitText\(/g) || []).length, 1);
  });

  await test('rejected 与无会话都如实回传，不伪装成成功', async () => {
    const rejected = await main.submitPromptOnce({
      async listTargets() {
        return { available: true, reason: 'ready', targets: [{ targetToken: 't', label: '会话 01', updatedAt: 'x' }] };
      },
      async submitText() { return { state: 'rejected', reason: 'ERR_BUSY' }; }
    }, '正文');
    assert.equal(rejected.state, 'rejected');
    assert.equal(rejected.reason, 'ERR_BUSY');

    const unproven = await main.submitPromptOnce({
      async listTargets() { return { available: false, reason: 'package-unproven', targets: [] }; },
      async submitText() { throw new Error('不该走到这里'); }
    }, '正文');
    assert.equal(unproven.state, 'error');
    assert.match(unproven.text, /版本不可证明/);
  });

  await test('actions 提交只走 v0.4 适配器：loopback + 精确版本证明 + 单条纯文本', async () => {
    const value = source('main.js');
    const block = value.slice(value.indexOf('async function submitWorkbenchAction('), value.indexOf('// ---------- v0.6 工作台包 ----------') + 1 || undefined);
    const submit = value.slice(value.indexOf('async function submitWorkbenchAction('));
    const body = submit.slice(0, submit.indexOf('\n}\n') + 3);
    assert.match(body, /backend\.createDshPromptAdapter\(\{/);
    assert.match(body, /expectedHostVersion: config\.DSH_CONTRACT\.hostVersion/);
    assert.match(body, /packageVersionProof: spawnedByUs && backendState/);
    // 提示词原样交出去：没有拼接、没有模板求值、没有和输入框内容合并。
    assert.match(body, /submitPromptOnce\(adapter, action\.prompt\)/);
    assert.equal(/action\.prompt\s*\+|`\$\{action\.prompt\}`/.test(body), false);
    // 用完必须关掉适配器。
    assert.match(body, /await adapter\.close\(\)/);
    assert.ok(block.length >= 0);
  });

  await test('拖入安装只复制：没有解压、没有执行、没有联网', async () => {
    const value = source('main.js');
    const block = value.slice(
      value.indexOf('function collectInstallEntries('),
      value.indexOf('// 移除只删鲸坞自己复制的那一份副本')
    );
    assert.ok(block.length > 400);
    // 只用 copyFileSync 逐个文件复制。
    assert.match(block, /fs\.copyFileSync\(item\.absolute, target\)/);
    // 断言用 API 形状匹配，避免被 target/startsWith 这类普通标识符误伤。
    assert.equal(
      /\bunzip\b|createUnzip|createGunzip|require\(['"](?:zlib|tar|adm-zip|yauzl|unzipper)['"]\)/i.test(block),
      false, '不解压'
    );
    assert.equal(
      /\bspawn(?:Sync)?\s*\(|\bexec(?:File|Sync)?\s*\(|child_process|\bfork\s*\(/.test(block),
      false, '不执行'
    );
    assert.equal(
      /\bfetch\s*\(|https?:\/\/|require\(['"](?:http|https|net|dns)['"]\)/.test(block),
      false, '不联网'
    );
    // 符号链接一律拒绝，不跟着走也不复制。
    assert.match(block, /entry\.isSymbolicLink\(\)/);
    assert.match(block, /出于安全没有安装/);
    // 先解析、再复制：装不进来的包一个字节都不落到用户目录。
    assert.match(block, /workbenches\.readWorkbenchPackage\(\{ dir: source, id: name, source: 'user' \}\)/);
    const parseIndex = block.indexOf('readWorkbenchPackage');
    const copyIndex = block.indexOf('fs.copyFileSync');
    assert.ok(parseIndex > -1 && copyIndex > parseIndex, '必须先解析后复制');
    // 已存在同名包时拒绝覆盖。
    assert.match(block, /已经装过一个叫/);
    // 先写临时目录再整体改名，中途失败不留半个包。
    assert.match(block, /fs\.renameSync\(staging, destination\)/);
    // 上限是硬的。
    assert.equal(main.WORKBENCH_INSTALL_LIMITS.maxTotalBytes, 32 * 1024 * 1024);
    assert.equal(main.WORKBENCH_INSTALL_LIMITS.maxEntries, 512);
  });

  await test('移除只删 userData 下的副本，且字面与 realpath 都核过', async () => {
    const value = source('main.js');
    const block = value.slice(
      value.indexOf('async function removeWorkbenchPack('),
      value.indexOf('// ---------- actions 按钮')
    );
    assert.match(block, /workbenchId\.startsWith\('user:'\)/, '内置包不可删');
    assert.match(block, /const realRoot = fs\.realpathSync\(root\);/);
    assert.match(block, /relative\.startsWith\('\.\.'\)/);
    assert.match(block, /path\.isAbsolute\(relative\)/);
    // 只删自己复制的副本，不碰用户原来的文件夹。
    assert.match(block, /你原来的文件夹一个字没动/);
  });

  await test('skills 与 agent 预设：主进程里没有任何安装或解析路径', async () => {
    const value = source('main.js');
    // 全文范围内，skills / agentPreset 附近不允许出现执行入口。
    assert.equal(/skills[\s\S]{0,300}?(spawn|execFile|child_process)/.test(value), false);
    assert.equal(/agentPreset[\s\S]{0,300}?(spawn|execFile|readFileSync|yaml)/i.test(value), false);
    // 只传出「有没有」，不传内容。
    assert.match(value, /hasAgentPreset: Boolean\(pkg\.agentPreset\)/);
    // 文案口径：只能说已检测到、尚未接通。
    const settings = source('settings.html');
    assert.match(settings, /已检测到，尚未接通/);
    assert.equal(/支持 agent 预设|已接通/.test(settings), false);
    // 空 skills 清单整栏隐藏（SGD 2026-08-19）。
    assert.match(settings, /Array\.isArray\(pkg\.skills\) && pkg\.skills\.length/);
    assert.equal(/没有推荐 skill/.test(settings), false);
    // skills 只有复制按钮，没有任何一键安装。
    assert.match(settings, /复制安装命令/);
    assert.equal(/一键安装|自动安装/.test(settings), false);
  });

  await test('切换工作台的三个入口都在，且快捷键不抢系统级', async () => {
    const value = source('main.js');
    // 入口一：窗口左上角常驻按钮（外壳页里）。
    assert.match(source('shell.html'), /id="switcher-button"/);
    // 入口二：托盘菜单。
    assert.match(value, /\{ label: '工作台', submenu: workbenchSubmenuTemplate\(\) \}/);
    // 入口三：应用菜单加速键。
    assert.match(value, /\{ label: '工作台', submenu: workbenchMenuTemplate\(\) \}/);
    assert.match(value, /accelerator: `CommandOrControl\+Shift\+\$\{index \+ 1\}`/);
    assert.match(value, /accelerator: 'CommandOrControl\+Shift\+0'/);
    // 刻意不走 globalShortcut：那是系统级抢占，而 macOS 的 ⌘⇧3/4/5 是系统截屏。
    const menuBlock = value.slice(value.indexOf('function workbenchMenuTemplate()'), value.indexOf('function createAppMenu()'));
    assert.equal(/globalShortcut/.test(menuBlock), false);
    assert.match(value, /这里刻意\*\*不用 globalShortcut\*\*/);
  });

  await test('工作台自带主题优先，且只注入自有页面', async () => {
    const value = source('main.js');
    assert.match(value, /const active = currentWorkbench\(\);\n  if \(active && active\.theme\) return active\.theme;/);
    // 外壳页在主题映射表里，dsh 页面永远不在。
    assert.ok(Object.prototype.hasOwnProperty.call(main.THEME_VARIABLE_MAP, 'shell.html'));
    assert.equal(main.themeCssFor('index.html', { colors: {}, base: 'dark' }), null);
    const css = main.themeCssFor('shell.html', {
      base: 'dark',
      colors: {
        background: '#010203', surface: '#040506', border: '#070809',
        primary: '#0a0b0c', accent: '#0d0e0f', text: '#101112', textMuted: '#131415'
      }
    });
    assert.match(css, /^:root\{color-scheme:dark;/);
    assert.equal(/url\(|@import|javascript:/.test(css), false);
  });

  await test('工作台详情把许可证与字段问题如实展示，且不下发提示词全文', async () => {
    const detail = main.workbenchDetail({
      id: 'user:样例台',
      name: '样例台',
      summary: null,
      source: 'user',
      heavy: true,
      unknownFieldCount: 2,
      version: '1.0.0',
      author: null,
      license: null,
      homepage: null,
      dshRange: null,
      workspace: { root: '样例台', folders: [{ path: '01_一', segments: ['01_一'], readme: null, files: [] }] },
      actions: [{ id: 'a', label: '按钮', hint: null, confirm: false, prompt: '这段绝不该出现在下发结果里' }],
      skills: [],
      agentPreset: { path: '/x/agent.cordis.yml', size: 10 },
      onboarding: '# 标题\n- 条目',
      issues: [{ file: 'workspace.json', reason: 'root-invalid', detail: '../x' }]
    });
    assert.equal(detail.license, null, '未声明许可证要如实为 null，由 UI 明写');
    assert.deepEqual(detail.folders, ['01_一']);
    assert.deepEqual(detail.skills, []);
    assert.equal(detail.hasAgentPreset, true);
    assert.equal(detail.issues[0].reason, 'root-invalid');
    // 提示词全文绝不出现在下发结构里。
    assert.equal(JSON.stringify(detail).includes('这段绝不该出现在下发结果里'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(detail.actions[0], 'prompt'), false);
  });

  await test('重工作台建目录：只新建不覆盖，用户改过的文件一个字都不动', async () => {
    const os = require('os');
    const workbenches = require('../lib/workbenches');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-heavy-'));
    const pkg = workbenches.readWorkbenchPackage({
      dir: path.join(ROOT, 'assets', 'workbenches', '短视频创作台'),
      id: '短视频创作台',
      source: 'builtin'
    }).package;
    const plan = workbenches.workspacePlan(pkg);

    // 先手工建好一个文件夹并写一份用户自己改过的说明，模拟「第二次启用」。
    const mine = path.join(tmp, '鲸坞工作台', plan.root, '01_选题库');
    fs.mkdirSync(mine, { recursive: true });
    fs.writeFileSync(path.join(mine, '说明.md'), '我自己改过的说明，不许动。', 'utf8');

    const first = main.ensureWorkbenchWorkspace(plan, { documentsDir: tmp, forbiddenRoots: [] });
    assert.equal(
      fs.readFileSync(path.join(mine, '说明.md'), 'utf8'),
      '我自己改过的说明，不许动。',
      '已存在的说明必须一个字都不动'
    );
    assert.ok(first.kept.includes('01_选题库/说明.md'));
    // 其余文件夹与预置示例照建。
    for (const folder of plan.folders) {
      assert.equal(fs.existsSync(path.join(first.path, folder.path)), true, folder.path);
    }
    assert.ok(first.created.some((item) => item.startsWith('01_选题库/示例-')));
    assert.equal(first.created.length, 6, '说明.md ×3 + 示例 ×3');

    // 再跑一次：全部已存在，一个新文件都不该产生。
    const second = main.ensureWorkbenchWorkspace(plan, { documentsDir: tmp, forbiddenRoots: [] });
    assert.deepEqual(second.created, [], '第二次启用不该再建任何文件');
    assert.equal(second.kept.length, 7);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('重工作台落点被受保护目录拦下时，连一个文件夹都不建', async () => {
    const os = require('os');
    const workbenches = require('../lib/workbenches');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-forbid-'));
    const pkg = workbenches.readWorkbenchPackage({
      dir: path.join(ROOT, 'assets', 'workbenches', '短视频创作台'),
      id: '短视频创作台',
      source: 'builtin'
    }).package;
    const plan = workbenches.workspacePlan(pkg);
    // 第一轮：字面路径就落在受保护根里。
    assert.throws(
      () => main.ensureWorkbenchWorkspace(plan, { documentsDir: tmp, forbiddenRoots: [fs.realpathSync(tmp)] }),
      (error) => error.code === 'ERR_WORKSPACE_PROTECTED'
    );
    assert.equal(fs.existsSync(path.join(tmp, '鲸坞工作台')), false, '拒绝时连父目录都不该建');

    // 第二轮：字面路径干净，realpath 才落进受保护根。
    const docs = path.join(tmp, 'docs');
    const secret = path.join(tmp, 'secret');
    fs.mkdirSync(docs, { recursive: true });
    fs.mkdirSync(secret, { recursive: true });
    fs.symlinkSync(fs.realpathSync(secret), path.join(docs, '鲸坞工作台'));
    assert.throws(
      () => main.ensureWorkbenchWorkspace(plan, { documentsDir: docs, forbiddenRoots: [fs.realpathSync(secret)] }),
      (error) => error.code === 'ERR_WORKSPACE_PROTECTED'
    );
    assert.deepEqual(fs.readdirSync(secret), [], '被 realpath 拦下时目标目录里不许多出任何东西');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('建目录这条路径上没有任何删除用户文件的代码', async () => {
    const value = source('main.js');
    const block = value.slice(
      value.indexOf('function ensureWorkbenchWorkspace('),
      value.indexOf('// A-3 的确认卡')
    );
    assert.ok(block.length > 600);
    assert.equal(/\brmSync\b|\bunlinkSync\b|\brmdirSync\b|\brm\s*\(|\btrashItem\b/.test(block), false);
    // 写文件一律 wx：同名存在直接 EEXIST，不覆盖。
    assert.match(block, /flag: 'wx'/);
    assert.match(block, /error\.code === 'EEXIST'/);
    // 字面与 realpath 两轮都在。
    assert.ok((block.match(/assertWorkspaceNotForbidden/g) || []).length >= 4);
    assert.ok((block.match(/canonicalWorkspace/g) || []).length >= 3);
  });

  await test('重工作台切换复用 v0.4 事务，且提交后才写 workbenchId', async () => {
    const value = source('main.js');
    const block = value.slice(
      value.indexOf('async function switchToHeavyWorkbench('),
      value.indexOf('function heavyWorkbenchSwitchMessage(')
    );
    // 事务一行不新写：直接调用既有的 switchWorkspace。
    assert.match(block, /await switchWorkspace\(ensured\.path\)/);
    assert.equal(/createWorkspaceSwitchCoordinator|journal|writePrepared/.test(block), false);
    // 顺序：先建目录 → 再切工作区 → 事务成功后才落 workbenchId。
    const ensureIndex = block.indexOf('ensureWorkbenchWorkspace(plan');
    const switchIndex = block.indexOf('await switchWorkspace(');
    const configIndex = block.indexOf("config.set({ workbenchId: target.id");
    assert.ok(ensureIndex > -1 && switchIndex > ensureIndex && configIndex > switchIndex);
    // 切换期间界面必须显示在忙。
    assert.match(block, /pushShellState\(\{ busy: true/);
    // 确认卡只问一次。
    assert.match(block, /workbenchHeavyConfirmed\.has\(target\.id\)/);
  });

  await test('外部 attach 拒绝切换时有专门的解释文案', async () => {
    const target = { id: 'user:x', name: '短视频创作台' };
    const external = main.heavyWorkbenchSwitchMessage({ code: 'ERR_WORKSPACE_EXTERNAL_ATTACH' }, target);
    assert.match(external, /外部 dsh/);
    assert.match(external, /不会去停别人的服务/);
    assert.match(external, /短视频创作台/);
    assert.match(
      main.heavyWorkbenchSwitchMessage({ code: 'ERR_WORKSPACE_BUDGET_PAUSED' }, target),
      /今日预算暂停中/
    );
    assert.match(
      main.heavyWorkbenchSwitchMessage({ code: 'ERR_WORKSPACE_RUNTIME_UNKNOWN' }, target),
      /fail-closed/
    );
    assert.match(
      main.heavyWorkbenchSwitchMessage({ rolledBack: true }, target),
      /已经回滚到原来的工作区/
    );
  });

  await test('内置工作台包进入 electron-builder 产物，且外壳三件套也在', async () => {
    const pkg = JSON.parse(source('package.json'));
    for (const entry of ['shell.html', 'shell.js', 'preload-shell.js', 'assets/**/*']) {
      assert.ok(pkg.build.files.includes(entry), entry);
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'workbenches', '短视频创作台', 'manifest.json')));
  });

  console.log(`\nMAIN V06 ALL PASS (${passed})`);
}

main06().catch((error) => {
  console.error('MAIN V06 FAIL:', error);
  process.exit(1);
});
