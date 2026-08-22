'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const remoteInbox = require('../lib/remote-inbox');

const APP_A = 'cli_0123456789abcdef';
const APP_B = 'cli_fedcba9876543210';

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  remote-inbox: ${name}`);
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function real(value) {
  return (fs.realpathSync.native || fs.realpathSync)(value);
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-remote-inbox-'));
  try {
    await test('文字与链接各排他写一个带固定来源标签的 Markdown', async () => {
      const workspace = path.join(tmp, 'workspace');
      fs.mkdirSync(workspace);
      const inbox = remoteInbox.createRemoteInbox({ workspacePath: workspace });
      const textResult = inbox.receive({
        appId: APP_A,
        kind: 'text',
        content: '第一条手机文字',
        messageId: 'om_text_1',
        receivedAt: '2026-08-22T12:34:56.000Z'
      });
      const linkResult = inbox.receive({
        appId: APP_A,
        kind: 'link',
        content: 'https://example.com/article?a=1',
        messageId: 'om_link_1',
        receivedAt: '2026-08-22T12:35:00.000Z'
      });
      assert.notEqual(textResult.path, linkResult.path);
      assert.equal(path.dirname(textResult.path), real(path.join(workspace, '收件箱')));
      assert.equal(path.dirname(linkResult.path), real(path.join(workspace, '收件箱')));
      const text = fs.readFileSync(textResult.path, 'utf8');
      const link = fs.readFileSync(linkResult.path, 'utf8');
      assert.match(text, /^---\nsource: feishu\nkind: text\nreceivedAt: 2026-08-22T12:34:56\.000Z\n---\n\n第一条手机文字\n$/);
      assert.match(link, /^---\nsource: feishu\nkind: link\nreceivedAt: 2026-08-22T12:35:00\.000Z\n---\n\nhttps:\/\/example\.com\/article\?a=1\n$/);
      for (const result of [textResult, linkResult]) {
        if (process.platform !== 'win32') assert.equal(fs.statSync(result.path).mode & 0o777, 0o600);
      }
      assert.equal(JSON.stringify([textResult, linkResult]).includes('om_'), false);
    });

    await test('链接只校验并保存，绝不访问网络', async () => {
      const workspace = path.join(tmp, 'no-fetch');
      fs.mkdirSync(workspace);
      const originalFetch = global.fetch;
      let fetched = false;
      global.fetch = async () => { fetched = true; throw new Error('不得访问'); };
      try {
        const inbox = remoteInbox.createRemoteInbox({ workspacePath: workspace });
        const result = inbox.receive({
          appId: APP_A,
          kind: 'link', content: 'https://example.invalid/no-network', messageId: 'om_no_fetch'
        });
        assert.equal(fetched, false);
        assert(fs.readFileSync(result.path, 'utf8').includes('https://example.invalid/no-network'));
      } finally {
        global.fetch = originalFetch;
      }
    });

    await test('只接 text/link，拒绝 actor、Secret 与额外字段旁路', async () => {
      const workspace = path.join(tmp, 'strict');
      fs.mkdirSync(workspace);
      const inbox = remoteInbox.createRemoteInbox({ workspacePath: workspace });
      for (const value of [
        { appId: APP_A, kind: 'file', content: 'x', messageId: 'om_file' },
        { appId: APP_A, kind: 'text', content: 'x', messageId: 'om_actor', actorId: 'ou_private' },
        { appId: APP_A, kind: 'text', content: 'x', messageId: 'om_secret', appSecret: 'secret' },
        { appId: APP_A, kind: 'link', content: 'file:///etc/passwd', messageId: 'om_file_url' },
        { appId: APP_A, kind: 'link', content: 'https://user:pass@example.com/', messageId: 'om_auth_url' },
        { kind: 'text', content: 'x', messageId: 'om_missing_app' },
        { appId: 'cli_invalid!', kind: 'text', content: 'x', messageId: 'om_invalid_app' }
      ]) {
        assert.throws(() => inbox.receive(value), assertCode('ERR_REMOTE_INBOX_CONTRACT'));
      }
      const inboxPath = path.join(workspace, '收件箱');
      assert.equal(fs.existsSync(inboxPath) ? fs.readdirSync(inboxPath).length : 0, 0);
    });

    await test('拒绝 workspace 或收件箱符号链接，不会被导向权威目录外', async () => {
      if (process.platform === 'win32') return;
      const outside = path.join(tmp, 'outside');
      fs.mkdirSync(outside);
      const realWorkspace = path.join(tmp, 'real-workspace');
      fs.mkdirSync(realWorkspace);
      const workspaceLink = path.join(tmp, 'workspace-link');
      fs.symlinkSync(realWorkspace, workspaceLink, 'dir');
      assert.throws(
        () => remoteInbox.createRemoteInbox({ workspacePath: workspaceLink }),
        assertCode('ERR_REMOTE_INBOX_WORKSPACE')
      );

      const poisonedWorkspace = path.join(tmp, 'poisoned-workspace');
      fs.mkdirSync(poisonedWorkspace);
      fs.symlinkSync(outside, path.join(poisonedWorkspace, '收件箱'), 'dir');
      assert.throws(
        () => remoteInbox.createRemoteInbox({ workspacePath: poisonedWorkspace }),
        assertCode('ERR_REMOTE_INBOX_WORKSPACE')
      );
      assert.deepEqual(fs.readdirSync(outside), []);
    });

    await test('messageId 决定文件身份；逐字相同重投幂等，冲突内容绝不覆盖', async () => {
      const workspace = path.join(tmp, 'exclusive');
      fs.mkdirSync(workspace);
      const inbox = remoteInbox.createRemoteInbox({ workspacePath: workspace });
      const value = {
        appId: APP_A,
        kind: 'text',
        content: '首个内容',
        messageId: '../../escape-attempt',
        receivedAt: '2026-08-22T13:00:00.000Z'
      };
      const first = inbox.receive(value);
      const before = fs.readFileSync(first.path, 'utf8');
      assert.equal(first.path.startsWith(`${real(path.join(workspace, '收件箱'))}${path.sep}`), true);
      assert.equal(path.basename(first.path).includes('escape'), false);
      const replay = inbox.receive(value);
      assert.deepEqual(replay, first);
      assert.equal(fs.readdirSync(path.join(workspace, '收件箱')).length, 1);
      assert.throws(
        () => inbox.receive({ ...value, content: '不得覆盖' }),
        assertCode('ERR_REMOTE_INBOX_CONFLICT')
      );
      assert.equal(fs.readFileSync(first.path, 'utf8'), before);
      assert.equal(fs.existsSync(path.join(tmp, 'escape-attempt')), false);
    });

    await test('相同 messageId 在不同 appId 命名空间各生成独立文件且不泄露 appId', async () => {
      const workspace = path.join(tmp, 'cross-app');
      fs.mkdirSync(workspace);
      const inbox = remoteInbox.createRemoteInbox({ workspacePath: workspace });
      const value = {
        kind: 'text',
        content: '跨应用同号消息',
        messageId: 'om_shared_private',
        receivedAt: '2026-08-22T13:10:00.000Z'
      };
      const first = inbox.receive({ ...value, appId: APP_A });
      const second = inbox.receive({ ...value, appId: APP_B });
      assert.notEqual(first.path, second.path);
      assert.equal(fs.readdirSync(path.join(workspace, '收件箱')).length, 2);
      for (const result of [first, second]) {
        const name = path.basename(result.path);
        const markdown = fs.readFileSync(result.path, 'utf8');
        assert.equal(name.includes(APP_A), false);
        assert.equal(name.includes(APP_B), false);
        assert.equal(name.includes(value.messageId), false);
        assert.equal(markdown.includes(APP_A), false);
        assert.equal(markdown.includes(APP_B), false);
      }
    });

    await test('缺 messageId 时拒绝落盘，不能退化成不可持久去重的随机文件', async () => {
      const workspace = path.join(tmp, 'message-id-required');
      fs.mkdirSync(workspace);
      const inbox = remoteInbox.createRemoteInbox({ workspacePath: workspace });
      assert.throws(
        () => inbox.receive({ appId: APP_A, kind: 'text', content: '没有权威消息标识' }),
        assertCode('ERR_REMOTE_INBOX_CONTRACT')
      );
      assert.deepEqual(fs.readdirSync(path.join(workspace, '收件箱')), []);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`REMOTE INBOX ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
