'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function methodSource(value, signature) {
  const start = value.indexOf(signature);
  assert.ok(start >= 0, `缺少方法：${signature}`);
  const brace = value.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  throw new Error(`${signature} 未闭合`);
}

async function main() {
  const source = fs.readFileSync(path.join(
    __dirname, '..', 'context-poc', 'forks', 'ui-conversation', 'lib', 'client.js'
  ), 'utf8');
  const sandbox = { URLSearchParams, location: { hash: '' } };
  vm.runInNewContext(`this.sink=({${methodSource(source, 'async sink(')}}).sink;`, sandbox);

  const session = { sessionId: 'session-a' };
  const signal = new AbortController().signal;
  const sent = [];
  const notices = [];
  let gate;
  const receiver = {
    rootCtx: { get(name) {
      if (name === 'whaledockContextGate') return gate;
      if (name === 'connection') return { isLoopback: true };
      return undefined;
    } },
    conversation: () => ({
      async sendSession(...args) {
        sent.push(args);
        return { kind: 'success' };
      }
    }),
    shell: () => ({ notify: (...args) => notices.push(args) })
  };

  assert.equal((await sandbox.sink.call(receiver, session, '', [], 'prompt', signal)).kind, 'success');
  assert.equal(sent.length, 0, '空输入不得触发原生发送');

  gate = undefined;
  assert.equal((await sandbox.sink.call(receiver, session, '浏览器原生消息', [], 'prompt', signal)).kind,
    'success');
  assert.equal(sent.length, 1, '无 gate 的非受管页面必须直接走原生发送');

  sandbox.__WHALEDOCK_CONTEXT_MANAGED__ = true;
  assert.equal((await sandbox.sink.call(receiver, session, '闸门缺失消息', [], 'prompt', signal)).kind,
    'error');
  assert.equal(sent.length, 1, '受管 marker 存在但 gate 缺失时必须 fail-closed');
  assert.match(notices.at(-1)[1], /上下文闸门没有加载/);
  delete sandbox.__WHALEDOCK_CONTEXT_MANAGED__;
  sandbox.location.hash = `#whaledockController=controller-12345678&whaledockSelectionToken=${'a'.repeat(64)}`;
  assert.equal((await sandbox.sink.call(receiver, session, 'fragment 受管消息', [], 'prompt', signal)).kind,
    'error');
  assert.equal(sent.length, 1, 'Client 尚未加载时，受管 fragment 也必须 fail-closed');
  sandbox.location.hash = '';

  gate = { beforeSend: async () => true };
  assert.equal((await sandbox.sink.call(receiver, session, '受管消息', [], 'prompt', signal)).kind,
    'success');
  assert.equal(sent.length, 2, '受管页面只有 preflight 通过后才发送');

  gate = { beforeSend: async () => false };
  assert.equal((await sandbox.sink.call(receiver, session, '被拦消息', [], 'prompt', signal)).kind,
    'error');
  assert.equal(sent.length, 2);
  assert.match(notices.at(-1)[1], /鲸坞受管会话/);
  assert.match(notices.at(-1)[1], /刷新页面 \/ 重启后端/);

  gate = { beforeSend: async () => { throw new Error('secret-path'); } };
  assert.equal((await sandbox.sink.call(receiver, session, '异常消息', [], 'prompt', signal)).kind,
    'error');
  assert.equal(sent.length, 2, 'preflight 异常必须 fail-closed');
  assert.equal(JSON.stringify(notices).includes('secret-path'), false, '内部异常不得进入可见文案');

  console.log('CONTEXT POC CONVERSATION RUNTIME ALL PASS (19)');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
