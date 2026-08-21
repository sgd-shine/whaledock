'use strict';

// 批次 4 拍摄窗口直检：不启动 Electron，但同时核对 main.js 的真实沙箱接线。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  shooting-window: ${name}`);
  } catch (error) {
    console.error(`FAIL  shooting-window: ${name}`);
    throw error;
  }
}

function main() {
  const html = source('shooting.html');
  const css = source('shooting.css');
  const renderer = source('shooting.js');
  const preload = source('preload-shooting.js');
  const mainSource = source('main.js');

  test('页面使用严格离线 CSP，CSS/JS 全部外链且没有内联执行入口', () => {
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /style-src 'self'/);
    assert.match(html, /img-src 'none'/);
    assert.match(html, /font-src 'none'/);
    assert.match(html, /media-src 'none'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /base-uri 'none'/);
    assert.match(html, /form-action 'none'/);
    assert.match(html, /frame-ancestors 'none'/);
    assert.match(html, /<link rel="stylesheet" href="shooting\.css">/);
    assert.match(html, /<script src="shooting\.js" defer><\/script>/);
    assert.equal(/<style(?:\s|>)/i.test(html), false);
    assert.equal(/<script(?!\s+src=)/i.test(html), false);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, '不允许内联事件处理器');
    assert.equal(/https?:\/\//i.test(`${html}\n${css}\n${renderer}`), false, '页面不引用网络资源');
  });

  test('HTML 与 main BrowserWindow 的沙箱契约一致且已真实接线', () => {
    assert.match(html, /whaledock-window-policy/);
    assert.match(html, /contextIsolation:true; nodeIntegration:false; sandbox:true/);
    assert.match(preload, /main\.js 接线时必须使用：contextIsolation:true、nodeIntegration:false、sandbox:true/);
    assert.equal(/BrowserWindow|ipcMain/.test(renderer), false);
    const block = mainSource.slice(
      mainSource.indexOf('function openShootingWindowForProject('),
      mainSource.indexOf('function writeShootingOutputs(')
    );
    assert.match(block, /contextIsolation:\s*true/);
    assert.match(block, /nodeIntegration:\s*false/);
    assert.match(block, /sandbox:\s*true/);
    assert.match(block, /fullscreen:\s*true/);
  });

  test('清单与提词两个模式都具备主交互和中文可访问标签', () => {
    assert.match(html, /id="mode-checklist"[^>]*>清单<\/button>/);
    assert.match(html, /id="mode-teleprompter"[^>]*>提词<\/button>/);
    assert.match(html, /id="shot-list"[^>]*aria-label="镜头清单"/);
    assert.match(html, /id="progress-ring"[^>]*aria-label="拍摄进度 0%"/);
    assert.match(html, /id="prompt-scroll"[^>]*aria-label="当前镜头提词正文"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-live="assertive"/);
    assert.match(html, /收工并写回/);
    assert.match(html, /id="finish-preview"/);
    assert.match(html, /id="prompt-progress"/);
    assert.match(renderer, /set-shot-complete/);
    assert.match(renderer, /retry-shot/);
  });

  test('速度与字号只有批准档位，不能由 renderer 注入任意 CSS', () => {
    assert.match(renderer, /Object\.freeze\(\[0\.6, 0\.8, 1, 1\.2, 1\.5\]\)/);
    assert.match(renderer, /new Set\(\['small', 'medium', 'large'\]\)/);
    for (const speed of ['0.6', '0.8', '1', '1.2', '1.5']) {
      assert.match(html, new RegExp(`data-speed="${speed.replace('.', '\\.')}"`));
    }
    for (const size of ['small', 'medium', 'large']) {
      assert.match(html, new RegExp(`data-font-size="${size}"`));
      assert.match(css, new RegExp(`data-font="${size}"`));
    }
    assert.equal(/\.style\s*=|setAttribute\(['"]style|cssText/.test(renderer), false);
  });

  test('空格和 R 只在提词模式生效，忽略长按、输入控件与输入法组合态', () => {
    assert.match(renderer, /event\.repeat/);
    assert.match(renderer, /event\.isComposing/);
    assert.match(renderer, /event\.metaKey \|\| event\.ctrlKey \|\| event\.altKey/);
    assert.match(renderer, /current\.mode !== 'teleprompter'/);
    assert.match(renderer, /interactiveTarget\(event\.target\)/);
    assert.match(renderer, /event\.code === 'Space' \|\| event\.key === ' '/);
    assert.match(renderer, /event\.key\.toLowerCase\(\) === 'r'/);
    assert.match(renderer, /event\.preventDefault\(\)/);
    assert.match(html, /aria-keyshortcuts="Space"/);
    assert.match(html, /aria-keyshortcuts="R"/);
  });

  test('提词滚动使用受限速度、封顶帧差并在窗口不可见时停下', () => {
    assert.match(renderer, /BASE_SCROLL_PIXELS_PER_SECOND = 42/);
    assert.match(renderer, /Math\.min\(48, Math\.max\(0, timestamp - previousFrameTime\)\)/);
    assert.match(renderer, /requestAnimationFrame\(stepAutoScroll\)/);
    assert.match(renderer, /document\.hidden/);
    assert.match(renderer, /visibilitychange/);
    assert.match(renderer, /type: 'set-playing', value: false/);
  });

  test('renderer 所有不可信文案走 textContent，不使用 HTML 注入或动态执行', () => {
    assert.match(renderer, /\.textContent\s*=/);
    assert.match(renderer, /replaceChildren\(\)/);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(renderer), false);
    assert.equal(/\beval\s*\(|new\s+Function\s*\(|executeJavaScript/.test(renderer), false);
    assert.equal(/ipcRenderer|contextBridge|require\s*\(/.test(renderer), false);
    assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(renderer), false);
  });

  test('preload 只暴露 getState、command、finish、onState 四个能力', () => {
    assert.match(preload, /contextBridge\.exposeInMainWorld\('whaleShooting', Object\.freeze\(\{/);
    const exposedBlock = preload.slice(preload.indexOf("contextBridge.exposeInMainWorld('whaleShooting'"));
    const exposed = [...exposedBlock.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)(?::|,|\n)/gm)]
      .map((match) => match[1]);
    assert.deepEqual(exposed, ['getState', 'command', 'finish', 'onState']);
    assert.equal(/exposeInMainWorld\([^,]+,\s*ipcRenderer/.test(preload), false);
  });

  test('preload IPC 白名单精确等于四条 shooting 通道', () => {
    const channels = [...preload.matchAll(/['"](shooting:[a-z-]+)['"]/g)]
      .map((match) => match[1]);
    assert.deepEqual([...new Set(channels)].sort(), [
      'shooting:command', 'shooting:finish', 'shooting:get', 'shooting:state'
    ]);
    assert.match(preload, /ipcRenderer\.invoke\(CHANNELS\.get\)/);
    assert.match(preload, /ipcRenderer\.invoke\(CHANNELS\.command, validateCommand\(value\)\)/);
    assert.match(preload, /ipcRenderer\.invoke\(CHANNELS\.finish\)/);
    assert.match(preload, /ipcRenderer\.on\(CHANNELS\.state, wrapped\)/);
    assert.match(preload, /ipcRenderer\.removeListener\(CHANNELS\.state, wrapped\)/);
  });

  test('command 在 preload 逐类型校验精确键，未知动作 fail-closed', () => {
    for (const command of [
      'set-mode', 'set-playing', 'set-speed', 'set-font-size',
      'select-shot', 'retry-shot', 'set-shot-complete', 'set-gap'
    ]) {
      assert.match(preload, new RegExp(`case '${command}'`));
    }
    assert.match(preload, /function exactKeys\(/);
    assert.match(preload, /throw new TypeError\('未知拍摄命令'\)/);
    assert.match(preload, /SHOT_ID = \/\^\[A-Za-z0-9\]/);
    assert.equal(/ipcRenderer\.send\(|sendSync|sendTo|postMessage/.test(preload), false);
  });

  test('preload 不取得文件、路径、剪贴板、Shell、网络或进程能力', () => {
    assert.equal(/require\(['"](?:fs|fs\/promises|path|child_process|http|https|net|dns|os)['"]\)/.test(preload), false);
    assert.equal(/webUtils|clipboard|shell\.|process\.|Buffer\.|fetch\s*\(/.test(preload), false);
    assert.equal(/window\.|document\.|localStorage|sessionStorage/.test(preload), false);
  });

  test('深海全屏舞台包含焦点态、响应式与减少动画策略', () => {
    assert.match(css, /--abyss:\s*#020608/);
    assert.match(css, /width:\s*100%;\s*\n\s*height:\s*100%/);
    assert.match(css, /overflow:\s*hidden/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media \(max-width:/);
    assert.match(css, /@media \(max-height:/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /@media \(forced-colors: active\)/);
  });

  console.log(`\n${passed} shooting-window tests passed`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}
