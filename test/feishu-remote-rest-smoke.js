'use strict';

// 飞书 REST 薄客户端合同：全程 fake fetch，不访问真实飞书。
const assert = require('assert/strict');
const { createFeishuRestClient } = require('../lib/remote-feishu-rest');

const AUTH_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  feishu-rest: ${name}`);
  } catch (error) {
    console.error(`FAIL  feishu-rest: ${name}`);
    throw error;
  }
}

function fakeResponse(value, options = {}) {
  const text = options.raw === true ? String(value) : JSON.stringify(value);
  const headers = new Map(Object.entries(options.headers || {}).map(([key, item]) => (
    [key.toLowerCase(), String(item)]
  )));
  if (!headers.has('content-length')) headers.set('content-length', String(Buffer.byteLength(text)));
  return {
    ok: options.ok !== undefined ? options.ok : true,
    status: options.status === undefined ? 200 : options.status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    text: async () => text
  };
}

function queuedFetch(responses, calls) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    if (!responses.length) throw new Error('unexpected fake fetch');
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, options);
    return next;
  };
}

function credentials() {
  return { appId: 'cli_0123456789abcdef', appSecret: 'APP_SECRET_never_echo' };
}

async function expectCode(work, code, forbidden = []) {
  await assert.rejects(work, (error) => {
    assert.equal(error && error.code, code);
    const serialized = `${error && error.message || ''}\n${error && error.stack || ''}`;
    for (const value of forbidden) assert.equal(serialized.includes(value), false, value);
    return true;
  });
}

async function run() {
  await test('创建客户端零请求，首发只向固定 HTTPS 端点取 token 并发 text', async () => {
    const calls = [];
    const client = createFeishuRestClient({
      getCredentials: async () => credentials(),
      fetchImpl: queuedFetch([
        fakeResponse({ code: 0, msg: 'ok', tenant_access_token: 'tenant-token-1', expire: 7200 }),
        fakeResponse({ code: 0, msg: 'ok', data: { message_id: 'om_message_1' } })
      ], calls),
      now: () => 1_000
    });
    assert.equal(calls.length, 0);

    const controller = new AbortController();
    const result = await client.sendText({
      openId: 'ou_owner123',
      text: '一条本机测试通知',
      dedupeKey: 'event-0001',
      signal: controller.signal
    });
    assert.deepEqual(result, { messageId: 'om_message_1' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, AUTH_URL);
    assert.equal(calls[1].url, MESSAGE_URL);
    assert.equal(calls.every((call) => call.options.method === 'POST'), true);
    assert.equal(calls.every((call) => call.options.redirect === 'error'), true);
    assert.equal(calls.every((call) => call.options.signal === controller.signal), true);
    assert.equal(calls.some((call) => /cli_0123456789abcdef|APP_SECRET_never_echo/.test(call.url)), false);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      app_id: 'cli_0123456789abcdef',
      app_secret: 'APP_SECRET_never_echo'
    });
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      receive_id: 'ou_owner123',
      msg_type: 'text',
      content: JSON.stringify({ text: '一条本机测试通知' }),
      uuid: 'event-0001'
    });
    assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-token-1');
  });

  await test('dedupeKey 为 null 时生成 UUID，保证每条消息仍有幂等键', async () => {
    const calls = [];
    const client = createFeishuRestClient({
      getCredentials: async () => credentials(),
      fetchImpl: queuedFetch([
        fakeResponse({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
        fakeResponse({ code: 0, data: { message_id: 'om_generated_uuid' } })
      ], calls)
    });
    await client.sendText({
      openId: 'ou_owner123', text: '绑定挑战', dedupeKey: null
    });
    const body = JSON.parse(calls[1].options.body);
    assert.match(body.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  await test('tenant token 只缓存在内存，并在 expire 前 60 秒失效', async () => {
    let clock = 10_000;
    const calls = [];
    const client = createFeishuRestClient({
      getCredentials: async () => credentials(),
      fetchImpl: queuedFetch([
        fakeResponse({ code: 0, tenant_access_token: 'tenant-token-old', expire: 7200 }),
        fakeResponse({ code: 0, data: { message_id: 'om_1' } }),
        fakeResponse({ code: 0, data: { message_id: 'om_2' } }),
        fakeResponse({ code: 0, tenant_access_token: 'tenant-token-new', expire: 7200 }),
        fakeResponse({ code: 0, data: { message_id: 'om_3' } })
      ], calls),
      now: () => clock
    });
    const payload = (dedupeKey) => ({
      openId: 'ou_owner123', text: '通知', dedupeKey, signal: new AbortController().signal
    });
    await client.sendText(payload('event-1'));
    clock += 7_139_000;
    await client.sendText(payload('event-2'));
    assert.equal(calls.filter((call) => call.url === AUTH_URL).length, 1);
    clock += 1_000;
    await client.sendText(payload('event-3'));
    assert.equal(calls.filter((call) => call.url === AUTH_URL).length, 2);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer tenant-token-new');
  });

  await test('已取消或非法输入在读凭据和 fetch 之前拒绝', async () => {
    let credentialReads = 0;
    const calls = [];
    const client = createFeishuRestClient({
      getCredentials: async () => { credentialReads += 1; return credentials(); },
      fetchImpl: queuedFetch([], calls)
    });
    const controller = new AbortController();
    controller.abort();
    await expectCode(() => client.sendText({
      openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1', signal: controller.signal
    }), 'ERR_FEISHU_ABORTED');
    await expectCode(() => client.sendText({
      openId: 'ou_owner123', text: '', dedupeKey: 'event-1'
    }), 'ERR_FEISHU_INPUT');
    await expectCode(() => client.sendText({
      openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1', extra: true
    }), 'ERR_FEISHU_INPUT');
    await expectCode(() => client.sendText({
      openId: 'owner-without-prefix', text: '消息', dedupeKey: 'event-1'
    }), 'ERR_FEISHU_INPUT');
    await expectCode(() => client.sendText({
      openId: 'ou_owner123', text: 'x'.repeat(150 * 1024 + 1), dedupeKey: 'event-1'
    }), 'ERR_FEISHU_INPUT');
    assert.equal(credentialReads, 0);
    assert.equal(calls.length, 0);
  });

  await test('凭据读取与格式故障只返回固定错误，不泄漏 secret', async () => {
    const rawSecret = 'APP_SECRET_from_throw';
    const throwing = createFeishuRestClient({
      getCredentials: async () => { throw new Error(`credential failed ${rawSecret}`); },
      fetchImpl: async () => { throw new Error('must not fetch'); }
    });
    await expectCode(() => throwing.sendText({
      openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1'
    }), 'ERR_FEISHU_CREDENTIALS', [rawSecret]);

    let calls = 0;
    const invalid = createFeishuRestClient({
      getCredentials: async () => ({ appId: 'cli_0123456789abcdef', appSecret: '' }),
      fetchImpl: async () => { calls += 1; }
    });
    await expectCode(() => invalid.sendText({
      openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1'
    }), 'ERR_FEISHU_CREDENTIALS');
    assert.equal(calls, 0);
  });

  await test('飞书鉴权非零 code、HTTP 和网络异常均映射固定错误', async () => {
    for (const [response, code] of [
      [fakeResponse({ code: 10003, msg: 'APP_SECRET leaked by platform' }), 'ERR_FEISHU_AUTH_REJECTED'],
      [fakeResponse('gateway APP_SECRET raw', { raw: true, ok: false, status: 502 }), 'ERR_FEISHU_AUTH_HTTP'],
      [new Error('network APP_SECRET raw'), 'ERR_FEISHU_AUTH_NETWORK']
    ]) {
      const client = createFeishuRestClient({
        getCredentials: async () => credentials(),
        fetchImpl: queuedFetch([response], [])
      });
      await expectCode(() => client.sendText({
        openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1'
      }), code, ['APP_SECRET']);
    }
  });

  await test('飞书发送非零 code、HTTP 和网络异常均映射固定错误', async () => {
    for (const [sendOutcome, code] of [
      [fakeResponse({ code: 230001, msg: 'raw private text' }), 'ERR_FEISHU_SEND_REJECTED'],
      [fakeResponse('raw private text', { raw: true, ok: false, status: 429 }), 'ERR_FEISHU_SEND_HTTP'],
      [new Error('raw private text'), 'ERR_FEISHU_SEND_NETWORK']
    ]) {
      const client = createFeishuRestClient({
        getCredentials: async () => credentials(),
        fetchImpl: queuedFetch([
          fakeResponse({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
          sendOutcome
        ], [])
      });
      await expectCode(() => client.sendText({
        openId: 'ou_owner123', text: 'raw private text', dedupeKey: 'event-1'
      }), code, ['raw private text']);
    }
  });

  await test('鉴权与发送响应都严格校验 schema 和有界体积', async () => {
    const cases = [
      {
        responses: [fakeResponse({ code: 0, tenant_access_token: '', expire: 7200 })],
        code: 'ERR_FEISHU_AUTH_SCHEMA'
      },
      {
        responses: [fakeResponse({ code: 0, tenant_access_token: 'token', expire: '7200' })],
        code: 'ERR_FEISHU_AUTH_SCHEMA'
      },
      {
        responses: [fakeResponse('{}', {
          raw: true,
          headers: { 'content-length': String(64 * 1024 + 1) }
        })],
        code: 'ERR_FEISHU_AUTH_RESPONSE_TOO_LARGE'
      },
      {
        responses: [
          fakeResponse({ code: 0, tenant_access_token: 'token', expire: 7200 }),
          fakeResponse({ code: 0, data: {} })
        ],
        code: 'ERR_FEISHU_SEND_SCHEMA'
      },
      {
        responses: [
          fakeResponse({ code: 0, tenant_access_token: 'token', expire: 7200 }),
          fakeResponse('{}', {
            raw: true,
            headers: { 'content-length': String(256 * 1024 + 1) }
          })
        ],
        code: 'ERR_FEISHU_SEND_RESPONSE_TOO_LARGE'
      }
    ];
    for (const item of cases) {
      const client = createFeishuRestClient({
        getCredentials: async () => credentials(),
        fetchImpl: queuedFetch(item.responses.slice(), [])
      });
      await expectCode(() => client.sendText({
        openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1'
      }), item.code);
    }
  });

  await test('AbortSignal 原样传给鉴权与发送 fetch', async () => {
    const signals = [];
    const controller = new AbortController();
    const client = createFeishuRestClient({
      getCredentials: async () => credentials(),
      fetchImpl: queuedFetch([
        (_url, options) => {
          signals.push(options.signal);
          return fakeResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        },
        (_url, options) => {
          signals.push(options.signal);
          return fakeResponse({ code: 0, data: { message_id: 'om_signal' } });
        }
      ], [])
    });
    await client.sendText({
      openId: 'ou_owner123', text: '消息', dedupeKey: 'event-1', signal: controller.signal
    });
    assert.deepEqual(signals, [controller.signal, controller.signal]);
  });

  console.log(`\nFEISHU REST ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('FEISHU REST FAIL:', error);
  process.exit(1);
});
