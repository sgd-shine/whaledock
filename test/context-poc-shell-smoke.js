'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function functionSource(value, name) {
  const start = value.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `缺少 ${name}`);
  const brace = value.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  throw new Error(`${name} 未闭合`);
}

function main() {
  const renderer = source('shell.js');
  const html = source('shell.html');
  const sandbox = {};
  vm.runInNewContext(`${functionSource(renderer, 'contextBridgeNotice')};this.notice=contextBridgeNotice;`, sandbox);

  assert.equal(sandbox.notice(null), null);
  assert.equal(sandbox.notice({ state: 'disabled', reason: 'feature-disabled' }), null);
  assert.equal(sandbox.notice({ state: 'ready', reason: null }), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.notice({ state: 'degraded', reason: 'bridge-unavailable' }))),
    {
      title: '工作台信息暂未接通',
      text: '受管页面会阻止本次发送，工作台信息不会注入。请等待连接恢复；仍未恢复时请重启后端，并到设置中查看日志。'
    }
  );
  assert.match(sandbox.notice({ state: 'degraded', reason: 'bridge-unavailable' }).text,
    /阻止本次发送/);
  assert.match(sandbox.notice({ state: 'degraded', reason: 'external-unproven' }).title, /外部 dsh/);
  assert.match(sandbox.notice({ state: 'degraded', reason: 'session-unavailable' }).text,
    /阻止本次发送/, 'session-unavailable 也可能来自 lease/冲突，不能假定局部横幅已覆盖');
  for (const reason of ['invalid-snapshot', 'turn-fence-lost', 'host-rejected', 'future-reason']) {
    assert.match(sandbox.notice({ state: 'degraded', reason }).title, /工作台信息暂未接通/,
      `${reason} 不得静默`);
  }
  assert.match(sandbox.notice({ state: 'unavailable', reason: 'not-connected' }).title,
    /工作台信息暂未接通/);
  assert.equal(sandbox.notice({ state: 'effective', reason: 'awaiting-delivery' }), null);

  assert.match(html, /id="context-bridge-banner"[^>]+aria-live="polite"[^>]+hidden/);
  assert.match(html, /id="cockpit-context-bridge-banner"[^>]+aria-live="polite"[^>]+hidden/);
  assert.match(renderer, /contextPoc:\s*next\.contextPoc/);
  assert.match(renderer, /renderContextBridgeNotice\(\);/);
  assert.match(renderer, /banner\.replaceChildren\(\)/);
  assert.doesNotMatch(functionSource(renderer, 'contextBridgeNotice'),
    /secretPath|authToken|selectionToken|sessionRef|assetDigest/i,
    '公开提示不能枚举敏感调试字段');
  console.log('CONTEXT POC SHELL ALL PASS (17)');
}

main();
