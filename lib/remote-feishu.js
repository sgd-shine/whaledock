'use strict';

// 飞书长连接 adapter：模块载入时不 require SDK，通道真正 connect 才惰性加载。
// SDK 仅用 WSClient + EventDispatcher；凭据、持久去重、绑定回读与 REST 发信均由主进程注入。

const MAX_OPAQUE_LENGTH = 512;
const MAX_TEXT_BYTES = 150 * 1024;
const SDK_PACKAGE = '@larksuiteoapi/node-sdk';
const APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/;
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const TERMINAL_RECEIPT_REASONS = new Set([
  'binding-required', 'not-bound', 'customer-web-only'
]);
const RETRYABLE_RECEIPT_REASONS = new Set([
  'stale-connection', 'connection-not-ready', 'channel-offline', 'backpressure',
  'classification-failed', 'binding-unavailable'
]);
const OWN_ERROR = Symbol('whaledock-feishu-error');

function feishuError(message, code) {
  const error = new Error(message);
  error.code = code;
  Object.defineProperty(error, OWN_ERROR, { value: true });
  return error;
}

function isOwnError(error, code = null) {
  return Boolean(error && error[OWN_ERROR] && (!code || error.code === code));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value, maximum = MAX_OPAQUE_LENGTH) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !value.includes('\0');
}

function assertFunction(value, label) {
  if (typeof value !== 'function') {
    throw feishuError(`${label} 未配置`, 'ERR_FEISHU_CONFIG');
  }
  return value;
}

function abortError() {
  return feishuError('飞书连接已取消', 'ERR_FEISHU_ABORTED');
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

function waitWithAbort(work, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, abortError());
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

function credentialsFrom(value) {
  if (!isObject(value) || !APP_ID_PATTERN.test(value.appId)
      || !nonEmptyString(value.appSecret, 1024)) {
    throw feishuError('飞书凭据未配置', 'ERR_FEISHU_CREDENTIALS');
  }
  return Object.freeze({ appId: value.appId, appSecret: value.appSecret });
}

function silentLogger() {
  const discard = () => {};
  return Object.freeze({
    error: discard,
    warn: discard,
    info: discard,
    debug: discard,
    trace: discard
  });
}

function receiptCanCommit(value) {
  if (!isObject(value)) return false;
  if (value.accepted === true) return true;
  if (value.accepted !== false || typeof value.reasonCode !== 'string') return false;
  if (TERMINAL_RECEIPT_REASONS.has(value.reasonCode)) return true;
  if (RETRYABLE_RECEIPT_REASONS.has(value.reasonCode)) return false;
  return false;
}

function eventPayload(data) {
  if (!isObject(data) || !isObject(data.sender) || !isObject(data.sender.sender_id)
      || !isObject(data.message)) return null;
  const { sender, message } = data;
  if (sender.sender_type !== 'user' || message.chat_type !== 'p2p'
      || message.message_type !== 'text') return null;
  const actorId = sender.sender_id.open_id;
  if (!nonEmptyString(actorId, 256) || !nonEmptyString(message.message_id)) return null;
  if (typeof message.create_time !== 'string' || !/^\d{13}$/.test(message.create_time)) return null;
  const receivedMs = Number(message.create_time);
  if (!Number.isSafeInteger(receivedMs)) return null;
  const receivedDate = new Date(receivedMs);
  if (Number.isNaN(receivedDate.getTime())) return null;
  if (typeof message.content !== 'string'
      || Buffer.byteLength(message.content, 'utf8') > MAX_TEXT_BYTES + 1024) return null;

  let parsed;
  try { parsed = JSON.parse(message.content); }
  catch (_error) { return null; }
  if (!isObject(parsed) || typeof parsed.text !== 'string' || !parsed.text
      || parsed.text.includes('\0')
      || Buffer.byteLength(parsed.text, 'utf8') > MAX_TEXT_BYTES) return null;

  const trimmed = parsed.text.trim();
  let kind = 'text';
  let content = parsed.text;
  try {
    const url = new URL(trimmed);
    if (HTTP_PROTOCOLS.has(url.protocol)) {
      kind = 'link';
      content = trimmed;
    }
  } catch (_error) {
    // 普通文字不是异常；只有整条消息是精确 HTTP(S) URL 时才当独立链接。
  }
  return Object.freeze({
    messageId: message.message_id,
    inbound: Object.freeze({
      actorId,
      kind,
      content,
      sourceId: message.message_id,
      receivedAt: receivedDate.toISOString()
    })
  });
}

function validateHooks(value) {
  if (!isObject(value) || !value.signal
      || typeof value.signal.addEventListener !== 'function'
      || typeof value.signal.removeEventListener !== 'function'
      || typeof value.onReceive !== 'function'
      || typeof value.onClose !== 'function'
      || typeof value.onError !== 'function') {
    throw feishuError('飞书连接参数无效', 'ERR_FEISHU_CONTRACT');
  }
  return value;
}

function validateSdk(value) {
  if (!isObject(value) || typeof value.WSClient !== 'function'
      || typeof value.EventDispatcher !== 'function') {
    throw feishuError('飞书 SDK 不可用', 'ERR_FEISHU_SDK');
  }
  return value;
}

function createFeishuAdapter(options = {}) {
  if (!isObject(options)) throw feishuError('飞书 adapter 参数无效', 'ERR_FEISHU_CONFIG');
  const sdkLoader = options.sdkLoader === undefined
    ? () => require(SDK_PACKAGE) : assertFunction(options.sdkLoader, 'sdkLoader');
  const readCredentials = assertFunction(options.readCredentials, 'readCredentials');
  const hasMessage = assertFunction(options.hasMessage, 'hasMessage');
  const rememberMessage = assertFunction(options.rememberMessage, 'rememberMessage');
  const readBoundOpenId = assertFunction(options.readBoundOpenId, 'readBoundOpenId');
  const sendText = assertFunction(options.sendText, 'sendText');

  return Object.freeze({
    async connect(rawHooks) {
      const hooks = validateHooks(rawHooks);
      const { signal } = hooks;
      throwIfAborted(signal);

      let credentials;
      try {
        credentials = credentialsFrom(await waitWithAbort(readCredentials(), signal));
      } catch (error) {
        if (isOwnError(error, 'ERR_FEISHU_ABORTED')
            || isOwnError(error, 'ERR_FEISHU_CREDENTIALS')) throw error;
        throw feishuError('飞书凭据读取失败', 'ERR_FEISHU_CREDENTIALS');
      }

      let sdk;
      try { sdk = validateSdk(sdkLoader()); }
      catch (error) {
        if (isOwnError(error, 'ERR_FEISHU_SDK')) throw error;
        throw feishuError('飞书 SDK 不可用', 'ERR_FEISHU_SDK');
      }
      throwIfAborted(signal);

      let wsClient = null;
      let connected = false;
      let closed = false;
      let lifecycleReported = false;
      const inboundFlights = new Map();
      let eventGateSettled = false;
      let eventGateResolve;
      const eventGate = new Promise((resolve) => { eventGateResolve = resolve; });
      const settleEventGate = (accepting) => {
        if (eventGateSettled) return;
        eventGateSettled = true;
        eventGateResolve(accepting);
      };
      let readyResolve;
      let readyReject;
      const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });

      const reportLifecycle = (kind, reasonCode) => {
        if (closed || lifecycleReported) return;
        lifecycleReported = true;
        connected = false;
        // SDK 自动重连只负责发现掉线；一旦上报核心就立即收回原始 WS，
        // 避免核心已显示断开时 SDK 又在背景复活成不可达的「假连接」。
        closeRaw(true);
        Promise.resolve().then(() => hooks[kind](reasonCode)).catch(() => {});
      };
      const closeRaw = (force) => {
        if (closed) return null;
        closed = true;
        connected = false;
        settleEventGate(false);
        signal.removeEventListener('abort', onAbort);
        if (!wsClient) return null;
        try {
          wsClient.close({ force });
          return null;
        } catch (_error) {
          return feishuError('飞书连接断开失败', 'ERR_FEISHU_DISCONNECT');
        }
      };
      const onAbort = () => {
        const wasConnected = connected;
        closeRaw(true);
        if (!wasConnected) readyReject(abortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });

      try {
        const dispatcher = new sdk.EventDispatcher({
          logger: silentLogger(),
          loggerLevel: sdk.LoggerLevel && sdk.LoggerLevel.error !== undefined
            ? sdk.LoggerLevel.error : 1
        }).register({
          'im.message.receive_v1': async (data) => {
            // SDK 可能在 onReady 同一轮就投递首帧；等 adapter.connect
            // 的 Promise 已被核心消费并建立 session lease，避免首帧进入早于连接句柄。
            if (!await eventGate) return {};
            if (closed || !connected || signal.aborted) return {};
            const payload = eventPayload(data);
            if (!payload) return {};
            const existing = inboundFlights.get(payload.messageId);
            if (existing) return existing;
            const flight = (async () => {
              let committed;
              try {
                committed = await hasMessage(Object.freeze({
                  appId: credentials.appId,
                  messageId: payload.messageId
                }));
              } catch (_error) {
                throw feishuError('飞书消息去重失败', 'ERR_FEISHU_DEDUPE');
              }
              if (committed === true) return {};
              if (committed !== false) {
                throw feishuError('飞书消息去重失败', 'ERR_FEISHU_DEDUPE');
              }
              let receipt;
              try {
                receipt = await hooks.onReceive(payload.inbound);
              } catch (_error) {
                // 不在交付前提前提交去重；抛错让飞书重投。收件端用 sourceId
                // 作确定性文件名，可覆盖 crash-after-write-before-remember 窗口。
                throw feishuError('飞书收件交付失败', 'ERR_FEISHU_RECEIVE');
              }
              if (!receiptCanCommit(receipt)) {
                throw feishuError('飞书收件交付失败', 'ERR_FEISHU_RECEIVE');
              }
              try {
                await rememberMessage(Object.freeze({
                  appId: credentials.appId,
                  messageId: payload.messageId
                }));
              } catch (_error) {
                throw feishuError('飞书消息去重失败', 'ERR_FEISHU_DEDUPE');
              }
              return {};
            })();
            inboundFlights.set(payload.messageId, flight);
            try { return await flight; }
            finally {
              if (inboundFlights.get(payload.messageId) === flight) {
                inboundFlights.delete(payload.messageId);
              }
            }
          }
        });

        wsClient = new sdk.WSClient({
          appId: credentials.appId,
          appSecret: credentials.appSecret,
          autoReconnect: true,
          logger: silentLogger(),
          loggerLevel: sdk.LoggerLevel && sdk.LoggerLevel.error !== undefined
            ? sdk.LoggerLevel.error : 1,
          source: 'whaledock',
          handshakeTimeoutMs: 15_000,
          wsConfig: { pingTimeout: 15 },
          onReady: () => {
            if (closed || signal.aborted) return;
            connected = true;
            readyResolve();
          },
          onError: () => {
            if (!connected) {
              closeRaw(true);
              readyReject(feishuError('飞书连接失败', 'ERR_FEISHU_CONNECT'));
              return;
            }
            reportLifecycle('onError', 'transport-error');
          },
          onReconnecting: () => reportLifecycle('onClose', 'transport-lost')
        });
        await wsClient.start({ eventDispatcher: dispatcher });
      } catch (error) {
        const known = isOwnError(error);
        closeRaw(true);
        readyReject(known ? error : feishuError('飞书连接失败', 'ERR_FEISHU_CONNECT'));
      }

      try { await waitWithAbort(ready, signal); }
      catch (error) {
        closeRaw(true);
        if (isOwnError(error, 'ERR_FEISHU_ABORTED')) throw error;
        throw feishuError('飞书连接失败', 'ERR_FEISHU_CONNECT');
      }
      if (!connected || closed) throw abortError();

      const ensureOnline = (operationSignal) => {
        throwIfAborted(operationSignal);
        throwIfAborted(signal);
        if (!connected || closed) {
          throw feishuError('飞书通道未连接', 'ERR_FEISHU_OFFLINE');
        }
      };
      const deliverText = async (openId, text, dedupeKey, operationSignal) => {
        ensureOnline(operationSignal);
        try {
          await sendText(Object.freeze({
            openId,
            text,
            dedupeKey,
            signal: operationSignal || signal
          }));
        } catch (error) {
          if (isOwnError(error, 'ERR_FEISHU_ABORTED')) throw error;
          if ((operationSignal && operationSignal.aborted) || signal.aborted) throw abortError();
          throw feishuError('飞书文字发送失败', 'ERR_FEISHU_SEND');
        }
        ensureOnline(operationSignal);
      };

      const session = Object.freeze({
        async disconnect() {
          const error = closeRaw(false);
          if (error) throw error;
        },
        async push(payload, context = {}) {
          const operationSignal = isObject(context) ? context.signal : null;
          ensureOnline(operationSignal);
          if (!isObject(payload) || !nonEmptyString(payload.body, MAX_TEXT_BYTES)
              || Buffer.byteLength(payload.body, 'utf8') > MAX_TEXT_BYTES
              || (payload.dedupeKey !== null && payload.dedupeKey !== undefined
                && !nonEmptyString(payload.dedupeKey, 256))) {
            throw feishuError('飞书推送参数无效', 'ERR_FEISHU_CONTRACT');
          }
          let openId;
          try { openId = await waitWithAbort(readBoundOpenId(), operationSignal || signal); }
          catch (error) {
            if (isOwnError(error, 'ERR_FEISHU_ABORTED')) throw error;
            throw feishuError('飞书绑定回读失败', 'ERR_FEISHU_UNBOUND');
          }
          if (!nonEmptyString(openId, 256)) {
            throw feishuError('飞书未完成权威绑定', 'ERR_FEISHU_UNBOUND');
          }
          await deliverText(openId, payload.body, payload.dedupeKey || null, operationSignal);
        },
        async approve() {
          throw feishuError('本批次不支持远程审批', 'ERR_FEISHU_UNSUPPORTED');
        },
        async challengeBinding(payload, context = {}) {
          const operationSignal = isObject(context) ? context.signal : null;
          ensureOnline(operationSignal);
          if (!isObject(payload) || !nonEmptyString(payload.actorId, 256)
              || typeof payload.challengeCode !== 'string'
              || !/^\d{6}$/.test(payload.challengeCode)) {
            throw feishuError('飞书绑定挑战无效', 'ERR_FEISHU_CONTRACT');
          }
          await deliverText(
            payload.actorId,
            `鲸坞绑定码：${payload.challengeCode}\n请回到电脑端核对并确认。`,
            null,
            operationSignal
          );
        }
      });
      setImmediate(() => settleEventGate(!closed && connected && !signal.aborted));
      return session;
    }
  });
}

module.exports = Object.freeze({ createFeishuAdapter });
