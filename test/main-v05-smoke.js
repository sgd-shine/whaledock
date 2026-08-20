'use strict';

// v0.5 Electron 薄层直测：宠物窗与主题注入的信任边界、静态资源约束与纯函数。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
const main = require('../main');
delete process.env.WHALEDOCK_MAIN_HELPER_TEST;

const themes = require('../lib/themes');
const root = path.join(__dirname, '..');
let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  main-v05: ${name}`);
}

function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

function pngBytes(size = 64) {
  const value = Buffer.alloc(Math.max(64, size));
  Buffer.from('89504e470d0a1a0a', 'hex').copy(value, 0);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(32, 16);
  value.writeUInt32BE(32, 20);
  return value;
}

async function run() {
  await test('主题只注入自有页面的既有 CSS 变量，且不覆盖 dsh 网页', async () => {
    const theme = themes.builtinFallbackTheme('dark');
    const css = main.themeCssFor('settings.html', theme);
    assert.equal(css.startsWith(':root{color-scheme:dark;'), true);
    assert.equal(css.includes(`--bg:${theme.colors.background};`), true);
    assert.equal(css.includes('--text:'), true);
    // 主 Harness 页面不在映射表内，拿不到任何注入。
    assert.equal(main.themeCssFor('index.html', theme), null);
    assert.equal(main.themeCssFor('../evil.html', theme), null);
    const pages = Object.keys(main.THEME_VARIABLE_MAP).sort();
    assert.deepEqual(pages, [
      'capture.html', 'dashboard.html', 'report-card.html',
      'settings.html', 'shell.html', 'splash.html'
    ]);
    // 注入内容只能是本地色值，不允许出现 url()/远程引用/脚本。
    for (const page of pages) {
      const value = main.themeCssFor(page, theme);
      assert.equal(/url\(|http|javascript:|<|expression\(/i.test(value), false, page);
    }
  });

  await test('宠物 payload 只下发 data: URL，不泄露任何本地路径', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-v05-payload-'));
    const idle = path.join(tmp, 'idle.png');
    const busy = path.join(tmp, 'busy.png');
    fs.writeFileSync(idle, pngBytes());
    fs.writeFileSync(busy, pngBytes());
    const payload = main.buildPetPayload({
      id: 'user:测试宠物', name: '测试宠物', frameRate: 6,
      width: 128, height: 128, anchor: 'bottom-left',
      states: { idle: [idle], busy: [busy] }
    });
    assert.equal(payload.id, 'user:测试宠物');
    assert.equal(payload.states.idle.length, 1);
    assert.equal(payload.states.idle[0].startsWith('data:image/png;base64,'), true);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(tmp), false);
    assert.equal(serialized.includes('idle.png'), false);
    assert.equal(serialized.includes('file:'), false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('读不到帧或超出总上限时丢帧而不是崩溃；idle 全丢则整包不可用', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-v05-limit-'));
    const ok = path.join(tmp, 'ok.png');
    fs.writeFileSync(ok, pngBytes());
    const missing = path.join(tmp, 'missing.png');
    const partial = main.buildPetPayload({
      id: 'user:部分', name: '部分', frameRate: 6, width: 128, height: 128,
      anchor: 'bottom-right', states: { idle: [ok, missing], busy: [missing] }
    });
    assert.equal(partial.states.idle.length, 1);
    assert.equal(partial.states.busy, undefined);
    assert.equal(main.buildPetPayload({
      id: 'user:空', name: '空', frameRate: 6, width: 128, height: 128,
      anchor: 'bottom-right', states: { idle: [missing] }
    }), null);
    assert.equal(main.buildPetPayload(null), null);
    assert.equal(main.PET_PAYLOAD_MAX_BYTES <= 8 * 1024 * 1024, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('宠物窗位置按 anchor 落在工作区内并收敛尺寸', async () => {
    const bounds = main.petWindowBounds({ width: 9999, height: 1, anchor: 'top-left' });
    assert.equal(bounds.width, 512);
    assert.equal(bounds.height, 48);
    assert.equal(bounds.x >= 0, true);
    assert.equal(bounds.y >= 0, true);
    // 缺尺寸（0/undefined）时回落到默认 128，而不是被夹到下限。
    const fallback = main.petWindowBounds({ width: 0, anchor: 'bottom-right' });
    assert.equal(fallback.width, 128);
    assert.equal(fallback.height, 128);
  });

  await test('宠物页面 CSP 禁止远程资源与内联脚本，图片只收 data:', async () => {
    const html = source('pet.html');
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/);
    assert.notEqual(csp, null);
    const policy = csp[1];
    assert.equal(policy.includes("default-src 'none'"), true);
    assert.equal(policy.includes("script-src 'self'"), true);
    assert.equal(policy.includes('img-src data:'), true);
    assert.equal(policy.includes("connect-src 'none'"), true);
    assert.equal(/img-src[^;]*(file:|https?:)/.test(policy), false);
    // 页面脚本必须外置，且不引用任何远程地址。
    assert.equal(/<script>[\s\S]*?<\/script>/.test(html), false);
    assert.equal(html.includes('<script src="pet.js"></script>'), true);
    assert.equal(/https?:\/\//.test(html), false);
  });

  await test('宠物窗使用 sandbox/contextIsolation 与窄 preload，并拒绝导航', async () => {
    const mainSource = source('main.js');
    const block = mainSource.slice(mainSource.indexOf('function openPetWindow()'));
    const body = block.slice(0, block.indexOf('\n}\n'));
    assert.equal(body.includes("preload: path.join(__dirname, 'preload-pet.js')"), true);
    assert.equal(body.includes('contextIsolation: true'), true);
    assert.equal(body.includes('nodeIntegration: false'), true);
    assert.equal(body.includes('sandbox: true'), true);
    assert.equal(body.includes('transparent: true'), true);
    assert.equal(body.includes('secureLocalWindow(win, expectedUrl)'), true);

    const preload = source('preload-pet.js');
    assert.equal(/contextBridge\.exposeInMainWorld\('whalePet'/.test(preload), true);
    // 只暴露固定通道；不得把 ipcRenderer、fs 或任意 invoke 泄露给页面。
    assert.equal(/exposeInMainWorld\([^)]*ipcRenderer/.test(preload), false);
    assert.equal(preload.includes("require('fs')"), false);
    const channels = [...preload.matchAll(/ipcRenderer\.(?:invoke|on)\('([^']+)'/g)]
      .map((item) => item[1]).sort();
    assert.deepEqual([...new Set(channels)], ['pet:context-menu', 'pet:package', 'pet:ready', 'pet:state']);
  });

  await test('宠物 IPC 只接受宠物窗主帧，资源目录入口是固定枚举', async () => {
    const mainSource = source('main.js');
    assert.equal(mainSource.includes("if (!trustedLocalEvent(event, petWindow, expectedUrl)) {"), true);
    // 打开资源目录只允许 pets/themes/workbenches 三个受控子目录，多一个都不行。
    assert.equal(mainSource.includes(
      "if (kind !== 'pets' && kind !== 'themes' && kind !== 'workbenches') return false;"
    ), true);
    assert.equal(mainSource.includes("path.join(app.getPath('userData'), kind)"), true);
    const preloadSettings = source('preload-settings.js');
    // 渲染层传进来的值必须被夹回固定枚举，不能原样透传。
    assert.equal(preloadSettings.includes(
      "const RESOURCE_DIRS = Object.freeze(['pets', 'themes', 'workbenches']);"
    ), true);
    assert.equal(preloadSettings.includes("RESOURCE_DIRS.includes(kind) ? kind : 'pets'"), true);
  });

  await test('宠物窗与主题都不触碰 dsh 私有目录，主 Harness 窗仍无 preload', async () => {
    const mainSource = source('main.js');
    assert.equal(/pets\.js[\s\S]{0,4000}\.dsh/.test(source('lib/pets.js')), false);
    assert.equal(source('lib/pets.js').includes('child_process'), false);
    assert.equal(source('lib/themes.js').includes('child_process'), false);
    // 承载 dsh 的视图不得出现 preload。
    // 注意：这条断言以前锚在并不存在的 createMainWindow 上，indexOf 返回 -1，整段被切成空串，
    // 于是永远真空通过。这里改成真实锚点，并断言锚点本身存在。
    const openMainIndex = mainSource.indexOf('function openMainWindow()');
    assert.notEqual(openMainIndex, -1, 'openMainWindow 锚点必须存在');
    const layoutIndex = mainSource.indexOf('function layoutMainWindow()');
    assert.notEqual(layoutIndex, -1, 'layoutMainWindow 锚点必须存在');
    const openMainBlock = mainSource.slice(openMainIndex, layoutIndex);
    const viewIndex = openMainBlock.indexOf('const view = new WebContentsView(');
    assert.notEqual(viewIndex, -1, 'dsh 视图创建点必须存在');
    const viewOptions = openMainBlock.slice(viewIndex, openMainBlock.indexOf('});', viewIndex) + 3);
    assert.equal(viewOptions.includes('preload'), false);
    assert.equal(/contextIsolation: true/.test(viewOptions), true);
    // 宠物包与主题包资源必须进入 electron-builder 的 files。
    const pkg = JSON.parse(source('package.json'));
    // 版本按当前大版本线校验；补丁号会随分发修复递增，不写死。
    assert.equal(/^0\.6\.\d+$/.test(pkg.version), true, pkg.version);
    for (const entry of [
      'pet.html', 'pet.js', 'preload-pet.js', 'assets/**/*',
      'shell.html', 'shell.js', 'preload-shell.js'
    ]) {
      assert.equal(pkg.build.files.includes(entry), true, entry);
    }
  });

  await test('内置宠物与主题资源真实存在且可被解析', async () => {
    const pets = require('../lib/pets');
    const listedPets = pets.listPetPackages({
      roots: [{ dir: path.join(root, 'assets', 'pets'), source: 'builtin' }]
    });
    assert.equal(listedPets.skipped.length, 0);
    assert.equal(listedPets.packages.length >= 2, true);
    const multi = listedPets.packages.find((item) => item.singleImage === false);
    const single = listedPets.packages.find((item) => item.singleImage === true);
    assert.notEqual(multi, undefined);
    assert.notEqual(single, undefined);
    // 单图宠物证明零门槛路径：没有 manifest 也能五态可用。
    assert.equal(fs.existsSync(path.join(single.dir, 'manifest.json')), false);
    for (const state of pets.PET_STATES) {
      assert.equal(pets.petFrames(single, state).frames.length, 1);
      assert.equal(pets.petFrames(multi, state).frames.length >= 1, true);
    }
    const listedThemes = themes.listThemes({
      roots: [{ dir: path.join(root, 'assets', 'themes'), source: 'builtin' }]
    });
    assert.equal(listedThemes.skipped.length, 0);
    assert.equal(listedThemes.themes.length, 4);
    assert.equal(listedThemes.themes.some((item) => item.id === themes.DEFAULT_THEME_ID), true);
    assert.equal(listedThemes.themes.some((item) => item.base === 'light'), true);
  });

  console.log(`\nMAIN V05 ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN V05 FAIL:', error);
  process.exit(1);
});
