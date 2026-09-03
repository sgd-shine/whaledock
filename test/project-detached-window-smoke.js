'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const detached = require('../lib/project-detached-window');

const ROOT = path.join(__dirname, '..');
const PROJECT_ID = `proj_${'a'.repeat(32)}`;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  project-detached-window: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-detached-window: ${name}`);
    throw error;
  }
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function input(tab, overrides = {}) {
  return {
    project: { projectId: PROJECT_ID, name: '旅行图鉴', icon: '🌍' },
    window: 2,
    tab,
    appVersion: '0.11.0-alpha.1',
    ...overrides
  };
}

function textTab(type = 'markdown') {
  return {
    id: `${type}-main`, type, title: type === 'markdown' ? '项目说明' : '纯文本',
    relativeRef: 'docs/readme.md', text: '# 标题\n\n安全正文'
  };
}

function main() {
  test('纯 Node 输出严格 CSP、data HTML、四类身份与 scrollTop sessionStorage', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'lib', 'project-detached-window.js'), 'utf8'
    );
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    const result = detached.createDetachedWindowDocument(input(textTab()));
    assert.deepEqual(Object.keys(result), ['title', 'html', 'dataUrl']);
    assert(Object.isFrozen(result));
    assert(result.title.includes('旅行图鉴') && result.title.includes('窗口2'));
    assert(result.html.includes('default-src &#39;none&#39;'));
    assert(result.html.includes('connect-src &#39;none&#39;'));
    assert.match(result.html, /script-src &#39;nonce-[A-Za-z0-9_-]+&#39;/);
    assert.match(result.html, /<script nonce="[A-Za-z0-9_-]+">/);
    assert(result.html.includes(`data-project-id="${PROJECT_ID}"`));
    assert(result.html.includes('data-window="2"'));
    assert(result.html.includes('data-tab-id="markdown-main"'));
    assert(result.html.includes('data-app-version="0.11.0-alpha.1"'));
    assert(result.html.includes('sessionStorage.getItem(key)'));
    assert(result.html.includes('sessionStorage.setItem(key'));
    assert(result.html.includes('root.scrollTop=value'));
    assert(result.dataUrl.startsWith('data:text/html;charset=utf-8,'));
    assert.equal(decodeURIComponent(result.dataUrl.split(',').slice(1).join(',')), result.html);
  });

  test('项目、标题与正文一律 HTML 转义，不生成注入节点或事件属性', () => {
    const malicious = input({
      id: 'text-main', type: 'text', title: '</title><script>alert(1)</script>',
      relativeRef: 'notes/a&b.txt', text: '<img src=x onerror=alert(1)> & "正文"'
    }, {
      project: { projectId: PROJECT_ID, name: '<b>项目</b>', icon: '<&>' }
    });
    const result = detached.createDetachedWindowDocument(malicious);
    assert(result.html.includes('&lt;b&gt;项目&lt;/b&gt;'));
    assert(result.html.includes('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert(result.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert(result.html.includes('notes/a&amp;b.txt'));
    assert(!result.html.includes('<b>项目</b>'));
    assert(!result.html.includes('<script>alert(1)</script>'));
    assert(!result.html.includes('<img src=x onerror='));
  });

  test('精确字段、相对引用、版本与控制字符全部 fail-closed', () => {
    assert.throws(() => detached.createDetachedWindowDocument({
      ...input(textTab()), surprise: true
    }), assertCode(detached.ERROR_CODES.input));
    assert.throws(() => detached.createDetachedWindowDocument(input(textTab(), {
      project: { projectId: PROJECT_ID, name: '项目', icon: '🌍', folder: '/tmp/project' }
    })), assertCode(detached.ERROR_CODES.project));
    assert.throws(() => detached.createDetachedWindowDocument(input({
      ...textTab(), path: 'docs/readme.md'
    })), assertCode(detached.ERROR_CODES.tab));
    for (const ref of ['/private/tmp/a.md', '../a.md', 'a/../b.md', 'C:/secret.txt', 'a\\b.txt']) {
      assert.throws(() => detached.createDetachedWindowDocument(input({
        ...textTab(), relativeRef: ref
      })), assertCode(detached.ERROR_CODES.path), ref);
    }
    assert.throws(() => detached.createDetachedWindowDocument(input({
      ...textTab(), text: 'ok\u0000bad'
    })), assertCode(detached.ERROR_CODES.tab));
    assert.throws(() => detached.createDetachedWindowDocument(input(textTab(), {
      appVersion: 'latest<script>'
    })), assertCode(detached.ERROR_CODES.input));
  });

  test('browser 只接受无凭据 http/https 且不嵌入或请求远程页面', () => {
    const safe = detached.createDetachedWindowDocument(input({
      id: 'web', type: 'browser', title: '参考网页', url: 'https://example.com/a?q=1'
    }));
    assert(safe.html.includes('远程内容未载入'));
    assert(safe.html.includes('https://example.com/a?q=1'));
    assert(!/<(?:iframe|webview|embed|object)\b/i.test(safe.html));
    assert(!/href="https:\/\//i.test(safe.html));
    for (const url of [
      'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd', 'ftp://example.com/a', 'https://user:secret@example.com/'
    ]) {
      assert.throws(() => detached.createDetachedWindowDocument(input({
        id: 'web', type: 'browser', title: '危险网页', url
      })), assertCode(detached.ERROR_CODES.url), url);
    }
  });

  test('image 仅接受 MIME 与内容头一致的 PNG/JPEG data URL', () => {
    const png = detached.createDetachedWindowDocument(input({
      id: 'cover', type: 'image', title: '封面', relativeRef: 'assets/cover.png', dataUrl: PNG
    }));
    assert(png.html.includes(`src="${PNG}"`));
    const jpegData = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;
    assert(detached.createDetachedWindowDocument(input({
      id: 'photo', type: 'image', title: '照片', relativeRef: 'assets/photo.jpg', dataUrl: jpegData
    })).html.includes('data:image/jpeg;base64,'));
    for (const dataUrl of [
      'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PjE8L3NjcmlwdD48L3N2Zz4=',
      'data:text/html;base64,PHNjcmlwdD4xPC9zY3JpcHQ+',
      'data:image/png;base64,PGh0bWw+',
      'data:image/png;base64,%%%%'
    ]) {
      assert.throws(() => detached.createDetachedWindowDocument(input({
        id: 'bad-image', type: 'image', title: '危险图片',
        relativeRef: 'assets/bad.png', dataUrl
      })), assertCode(detached.ERROR_CODES.image), dataUrl);
    }
  });

  test('markdown/text/terminal 只渲染转义文本，模板只保留安全 id', () => {
    for (const type of ['markdown', 'text']) {
      const result = detached.createDetachedWindowDocument(input({
        ...textTab(type), text: '<script>not executable</script>'
      }));
      assert(result.html.includes('&lt;script&gt;not executable&lt;/script&gt;'));
      assert(!result.html.includes('<script>not executable</script>'));
    }
    const terminal = detached.createDetachedWindowDocument(input({
      id: 'terminal-main', type: 'terminal', title: '终端', text: '$ pwd\nproject'
    }));
    assert(terminal.html.includes('只显示已授权的文本快照'));
    assert(!terminal.html.includes('cwd='));
    const template = detached.createDetachedWindowDocument(input({
      id: 'video', type: 'video-template', title: '短视频',
      templateId: 'builtin:短视频创作台'
    }));
    assert(template.html.includes('builtin:短视频创作台'));
  });

  test('artifact 必须锁定；HTML 永不接收或执行项目正文', () => {
    const base = {
      id: 'artifact', type: 'artifact', title: '最终报告', locked: true,
      artifactKind: 'html', relativeRef: 'output/report.html'
    };
    assert.throws(() => detached.createDetachedWindowDocument(input({
      ...base, locked: false
    })), assertCode(detached.ERROR_CODES.artifact));
    assert.throws(() => detached.createDetachedWindowDocument(input({
      ...base, html: '<script>alert(1)</script>'
    })), assertCode(detached.ERROR_CODES.artifact));
    const html = detached.createDetachedWindowDocument(input(base));
    assert(html.html.includes('锁定产物'));
    assert(html.html.includes('HTML 产物未执行'));
    assert(html.html.includes('output/report.html'));
    assert(!html.html.includes('<script>alert(1)</script>'));

    const text = detached.createDetachedWindowDocument(input({
      id: 'artifact-text', type: 'artifact', title: '锁定文本', locked: true,
      artifactKind: 'text', relativeRef: 'output/final.txt', text: '<b>最终版</b>'
    }));
    assert(text.html.includes('&lt;b&gt;最终版&lt;/b&gt;'));
  });

  test('未知窗格类型、模板 id 和越界窗口拒绝', () => {
    assert.throws(() => detached.createDetachedWindowDocument(input({
      id: 'html', type: 'html', title: '原始 HTML'
    })), assertCode(detached.ERROR_CODES.tab));
    assert.throws(() => detached.createDetachedWindowDocument(input({
      id: 'video', type: 'video-template', title: '模板', templateId: '../bad'
    })), assertCode(detached.ERROR_CODES.tab));
    assert.throws(() => detached.createDetachedWindowDocument(input(textTab(), {
      window: 17
    })), assertCode(detached.ERROR_CODES.input));
  });

  console.log(`\nPROJECT DETACHED WINDOW ALL PASS (${passed})`);
}

try { main(); } catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
