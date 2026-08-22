'use strict';

// 飞书官方 REST 的最小薄层。纯 Node，使用 Node/Electron 自带 fetch；
// 不记日志、不持久凭据、不透传平台原始错误。

const { randomUUID } = require('crypto');

const AUTH_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';
const AUTH_RESPONSE_MAX_BYTES = 64 * 1024;
const SEND_RESPONSE_MAX_BYTES = 256 * 1024;
const TEXT_MAX_BYTES = 150 * 1024;
const TOKEN_EARLY_EXPIRY_MS = 60 * 1000;

function feishuError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function onlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function abortError() {
  return feishuError('ERR_FEISHU_ABORTED', '飞书请求已取消');
}

function aborted(signal) {
  return Boolean(signal && signal.aborted);
}

function validSignal(signal) {
  return signal === undefined || (Boolean(signal) && typeof signal === 'object'
    && typeof signal.aborted === 'boolean'
    && typeof signal.addEventListener === 'function'
    && typeof signal.removeEventListener === 'function');
}

function withSignal(work, signal) {
  if (aborted(signal)) return Promise.reject(abortError());
  if (!signal) return Promise.resolve().then(work);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve().then(() => {
      if (settled || signal.aborted) throw abortError();
      return work();
    }).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

function fixedString(value, maximum, pattern = null) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !value.includes('\0') && (!pattern || pattern.test(value));
}

function normalizeSendRequest(value) {
  if (!isRecord(value) || !onlyKeys(value, ['openId', 'text', 'dedupeKey', 'signal'])) {
    throw feishuError('ERR_FEISHU_INPUT', '飞书发送参数无效');
  }
  const hasDedupeKey = value.dedupeKey !== null && value.dedupeKey !== undefined;
  if (!fixedString(value.openId, 256, /^ou_[A-Za-z0-9_-]+$/)
      || !fixedString(value.text, TEXT_MAX_BYTES)
      || Buffer.byteLength(value.text, 'utf8') > TEXT_MAX_BYTES
      || (hasDedupeKey && !fixedString(value.dedupeKey, 128, /^[A-Za-z0-9._:-]+$/))
      || !validSignal(value.signal)) {
    throw feishuError('ERR_FEISHU_INPUT', '飞书发送参数无效');
  }
  return Object.freeze({
    openId: value.openId,
    text: value.text,
    dedupeKey: hasDedupeKey ? value.dedupeKey : randomUUID(),
    signal: value.signal
  });
}

function normalizeCredentials(value) {
  if (!isRecord(value) || !onlyKeys(value, ['appId', 'appSecret'])
      || !fixedString(value.appId, 20, /^cli_[0-9a-fA-F]{16}$/)
      || !fixedString(value.appSecret, 1024)
      || /[\u0000-\u001f\u007f]/.test(value.appSecret)) {
    throw feishuError('ERR_FEISHU_CREDENTIALS', '飞书凭据不可用');
  }
  return Object.freeze({ appId: value.appId, appSecret: value.appSecret });
}

function responseLength(response, schemaCode) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
  const header = response.headers.get('content-length');
  if (header === null || header === undefined || header === '') return null;
  const text = String(header).trim();
  if (!/^\d+$/.test(text)) throw feishuError(schemaCode, '飞书响应格式无效');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw feishuError(schemaCode, '飞书响应格式无效');
  }
  return value;
}

async function readBoundedText(response, maximum, codes, signal) {
  const declared = responseLength(response, codes.schema);
  if (declared !== null && declared > maximum) {
    throw feishuError(codes.tooLarge, '飞书响应过大');
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const item = await withSignal(() => reader.read(), signal);
        if (!item || item.done) break;
        if (!(item.value instanceof Uint8Array)) {
          throw feishuError(codes.schema, '飞书响应格式无效');
        }
        size += item.value.byteLength;
        if (size > maximum) {
          try { await reader.cancel(); } catch (_error) { /* 超界已定性 */ }
          throw feishuError(codes.tooLarge, '飞书响应过大');
        }
        chunks.push(Buffer.from(item.value));
      }
    } finally {
      if (typeof reader.releaseLock === 'function') reader.releaseLock();
    }
    return Buffer.concat(chunks, size).toString('utf8');
  }
  if (typeof response.text !== 'function') {
    throw feishuError(codes.schema, '飞书响应格式无效');
  }
  const value = await withSignal(() => response.text(), signal);
  if (typeof value !== 'string') {
    throw feishuError(codes.schema, '飞书响应格式无效');
  }
  if (Buffer.byteLength(value, 'utf8') > maximum) {
    throw feishuError(codes.tooLarge, '飞书响应过大');
  }
  return value;
}

async function requestJson(fetchImpl, url, options, codes, maximum, signal) {
  let response;
  try {
    response = await withSignal(() => fetchImpl(url, options), signal);
  } catch (error) {
    if (aborted(signal) || (error && error.code === 'ERR_FEISHU_ABORTED')
        || (error && error.name === 'AbortError')) throw abortError();
    throw feishuError(codes.network, '飞书网络请求失败');
  }
  if (!response || typeof response !== 'object' || response.ok !== true) {
    throw feishuError(codes.http, '飞书服务暂不可用');
  }
  let text;
  try {
    text = await readBoundedText(response, maximum, codes, signal);
  } catch (error) {
    if (aborted(signal) || (error && error.code === 'ERR_FEISHU_ABORTED')
        || (error && error.name === 'AbortError')) throw abortError();
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (_error) {
    throw feishuError(codes.schema, '飞书响应格式无效');
  }
  if (!isRecord(parsed) || !Number.isSafeInteger(parsed.code)) {
    throw feishuError(codes.schema, '飞书响应格式无效');
  }
  return parsed;
}

function checkedNow(now) {
  let value;
  try { value = now(); } catch (_error) {
    throw feishuError('ERR_FEISHU_CLOCK', '飞书客户端时钟无效');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw feishuError('ERR_FEISHU_CLOCK', '飞书客户端时钟无效');
  }
  return value;
}

function createFeishuRestClient(options = {}) {
  if (!isRecord(options) || !onlyKeys(options, ['getCredentials', 'fetchImpl', 'now'])
      || typeof options.getCredentials !== 'function'
      || (options.fetchImpl !== undefined && typeof options.fetchImpl !== 'function')
      || (options.now !== undefined && typeof options.now !== 'function')) {
    throw feishuError('ERR_FEISHU_CLIENT', '飞书 REST 客户端参数无效');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw feishuError('ERR_FEISHU_CLIENT', '当前运行时不支持 fetch');
  }
  const now = options.now || Date.now;
  let cachedToken = null;

  async function readCredentials(signal) {
    let value;
    try {
      value = await withSignal(() => options.getCredentials(), signal);
    } catch (error) {
      if (aborted(signal) || (error && error.code === 'ERR_FEISHU_ABORTED')) throw abortError();
      throw feishuError('ERR_FEISHU_CREDENTIALS', '飞书凭据不可用');
    }
    try { return normalizeCredentials(value); } catch (_error) {
      throw feishuError('ERR_FEISHU_CREDENTIALS', '飞书凭据不可用');
    }
  }

  async function tenantToken(signal) {
    const current = checkedNow(now);
    if (cachedToken && current < cachedToken.validUntil) return cachedToken.value;
    const credentials = await readCredentials(signal);
    const value = await requestJson(fetchImpl, AUTH_URL, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        app_id: credentials.appId,
        app_secret: credentials.appSecret
      })
    }, {
      network: 'ERR_FEISHU_AUTH_NETWORK',
      http: 'ERR_FEISHU_AUTH_HTTP',
      schema: 'ERR_FEISHU_AUTH_SCHEMA',
      tooLarge: 'ERR_FEISHU_AUTH_RESPONSE_TOO_LARGE'
    }, AUTH_RESPONSE_MAX_BYTES, signal);
    if (value.code !== 0) {
      throw feishuError('ERR_FEISHU_AUTH_REJECTED', '飞书鉴权被拒绝');
    }
    if (!fixedString(value.tenant_access_token, 4096)
        || /[\u0000-\u0020\u007f]/.test(value.tenant_access_token)
        || !Number.isSafeInteger(value.expire) || value.expire < 1 || value.expire > 30 * 24 * 60 * 60) {
      throw feishuError('ERR_FEISHU_AUTH_SCHEMA', '飞书鉴权响应格式无效');
    }
    if (aborted(signal)) throw abortError();
    const receivedAt = checkedNow(now);
    const ttlMs = value.expire * 1000;
    const earlyExpiry = Math.min(TOKEN_EARLY_EXPIRY_MS, Math.max(1, Math.floor(ttlMs / 10)));
    cachedToken = Object.freeze({
      value: value.tenant_access_token,
      validUntil: receivedAt + ttlMs - earlyExpiry
    });
    return cachedToken.value;
  }

  async function sendText(raw) {
    let request;
    try { request = normalizeSendRequest(raw); } catch (_error) {
      throw feishuError('ERR_FEISHU_INPUT', '飞书发送参数无效');
    }
    if (aborted(request.signal)) throw abortError();
    const token = await tenantToken(request.signal);
    let value;
    try {
      value = await requestJson(fetchImpl, MESSAGE_URL, {
        method: 'POST',
        redirect: 'error',
        signal: request.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          receive_id: request.openId,
          msg_type: 'text',
          content: JSON.stringify({ text: request.text }),
          uuid: request.dedupeKey
        })
      }, {
        network: 'ERR_FEISHU_SEND_NETWORK',
        http: 'ERR_FEISHU_SEND_HTTP',
        schema: 'ERR_FEISHU_SEND_SCHEMA',
        tooLarge: 'ERR_FEISHU_SEND_RESPONSE_TOO_LARGE'
      }, SEND_RESPONSE_MAX_BYTES, request.signal);
    } catch (error) {
      if (error && (error.code === 'ERR_FEISHU_SEND_HTTP'
          || error.code === 'ERR_FEISHU_SEND_NETWORK')) cachedToken = null;
      throw error;
    }
    if (value.code !== 0) {
      cachedToken = null;
      throw feishuError('ERR_FEISHU_SEND_REJECTED', '飞书发送被拒绝');
    }
    if (!isRecord(value.data) || !fixedString(value.data.message_id, 512)
        || /[\u0000-\u001f\u007f]/.test(value.data.message_id)) {
      throw feishuError('ERR_FEISHU_SEND_SCHEMA', '飞书发送响应格式无效');
    }
    return Object.freeze({ messageId: value.data.message_id });
  }

  return Object.freeze({ sendText });
}

module.exports = { createFeishuRestClient };
