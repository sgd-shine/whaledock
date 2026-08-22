'use strict';

// 飞书远程通道的本机安全状态仓。保持纯 Node，由 main 注入系统加/解密能力；
// 公开状态与密文文件都不能反推出 App Secret、绑定账号或原始 message_id。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_APPS = 32;
const MAX_MESSAGES = 10_000;
// 飞书自建应用标识固定以 cli_ 开头；收紧后也不会让 __proto__ 一类键进入状态对象。
const APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/;
const COMMIT_ID_PATTERN = /^[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function onlyKeys(value, allowed, code = 'ERR_REMOTE_STORE_CONTRACT') {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw storeError(code, '远程安全状态参数无效');
  }
}

function fixedString(value, maximum = 512) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) {
    throw storeError('ERR_REMOTE_STORE_CONTRACT', '远程安全状态参数无效');
  }
  return value;
}

function appId(value) {
  const normalized = fixedString(value, 20);
  if (!APP_ID_PATTERN.test(normalized)) {
    throw storeError('ERR_REMOTE_STORE_CONTRACT', '飞书应用标识无效');
  }
  return normalized;
}

function canonicalBase64(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_FILE_BYTES
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch (_error) {
    return false;
  }
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, activeAppId: null, apps: {} };
}

function validateState(value) {
  const fail = () => { throw storeError('ERR_REMOTE_STORE_SCHEMA', '远程安全状态格式无效'); };
  if (!isRecord(value)) fail();
  if (Object.keys(value).some((key) => !['schemaVersion', 'activeAppId', 'apps'].includes(key))) fail();
  if (value.schemaVersion !== SCHEMA_VERSION || !isRecord(value.apps)) fail();
  if (value.activeAppId !== null && !APP_ID_PATTERN.test(value.activeAppId || '')) fail();
  const entries = Object.entries(value.apps);
  if (entries.length > MAX_APPS) fail();
  for (const [id, entry] of entries) {
    if (!APP_ID_PATTERN.test(id) || !isRecord(entry)) fail();
    if (Object.keys(entry).some((key) => !['credential', 'binding', 'messages'].includes(key))) fail();
    if (!Object.hasOwn(entry, 'credential') || !Object.hasOwn(entry, 'binding')
        || !Object.hasOwn(entry, 'messages')) fail();
    if (entry.credential !== null) {
      if (!isRecord(entry.credential)
          || Object.keys(entry.credential).length !== 1
          || !canonicalBase64(entry.credential.ciphertext)) fail();
    }
    if (entry.binding !== null) {
      if (!isRecord(entry.binding)
          || Object.keys(entry.binding).some((key) => !['ciphertext', 'commitId'].includes(key))
          || Object.keys(entry.binding).length !== 2
          || !canonicalBase64(entry.binding.ciphertext)
          || !COMMIT_ID_PATTERN.test(entry.binding.commitId || '')) fail();
    }
    if (!Array.isArray(entry.messages) || entry.messages.length > MAX_MESSAGES) fail();
    const seen = new Set();
    for (const hash of entry.messages) {
      if (!HASH_PATTERN.test(hash || '') || seen.has(hash)) fail();
      seen.add(hash);
    }
  }
  if (value.activeAppId !== null) {
    const active = value.apps[value.activeAppId];
    if (!active || active.credential === null) fail();
  }
  return value;
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function newAppState() {
  return { credential: null, binding: null, messages: [] };
}

function createRemoteSecureStore(options = {}) {
  onlyKeys(options, ['filePath', 'encrypt', 'decrypt']);
  if (typeof options.filePath !== 'string' || !path.isAbsolute(options.filePath)
      || options.filePath.includes('\0') || typeof options.encrypt !== 'function'
      || typeof options.decrypt !== 'function') {
    throw storeError('ERR_REMOTE_STORE_CONTRACT', '远程安全状态参数无效');
  }
  const filePath = path.resolve(options.filePath);
  const parentPath = path.dirname(filePath);

  function load() {
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyState();
      throw storeError('ERR_REMOTE_STORE_READ', '无法读取远程安全状态');
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
      throw storeError('ERR_REMOTE_STORE_READ', '无法读取远程安全状态');
    }
    let descriptor = null;
    let raw;
    try {
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(filePath, flags);
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.size > MAX_FILE_BYTES) throw new Error('unsafe-open');
      raw = fs.readFileSync(descriptor, 'utf8');
      fs.closeSync(descriptor);
      descriptor = null;
    } catch (_error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_closeError) { /* best effort */ }
      }
      throw storeError('ERR_REMOTE_STORE_READ', '无法读取远程安全状态');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      throw storeError('ERR_REMOTE_STORE_SCHEMA', '远程安全状态格式无效');
    }
    return validateState(parsed);
  }

  function ensureParent() {
    try {
      fs.mkdirSync(parentPath, { recursive: true, mode: 0o700 });
      const parent = fs.lstatSync(parentPath);
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('unsafe-parent');
      if (process.platform !== 'win32') fs.chmodSync(parentPath, 0o700);
      try {
        const current = fs.lstatSync(filePath);
        if (!current.isFile() || current.isSymbolicLink()) throw new Error('unsafe-file');
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    } catch (_error) {
      throw storeError('ERR_REMOTE_STORE_WRITE', '无法保存远程安全状态');
    }
  }

  function write(next) {
    validateState(next);
    ensureParent();
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
      throw storeError('ERR_REMOTE_STORE_WRITE', '无法保存远程安全状态');
    }
    const temporary = path.join(
      parentPath,
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`
    );
    let descriptor = null;
    let renamed = false;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, filePath);
      renamed = true;
    } catch (_error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_closeError) { /* best effort */ }
      }
      if (!renamed) {
        try { fs.unlinkSync(temporary); } catch (_unlinkError) { /* best effort */ }
      }
      throw storeError('ERR_REMOTE_STORE_WRITE', '无法保存远程安全状态');
    }
  }

  function seal(value, purpose, id) {
    let encrypted;
    try {
      encrypted = options.encrypt(value, Object.freeze({ purpose, appId: id }));
    } catch (_error) {
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法保护远程安全状态');
    }
    if (!Buffer.isBuffer(encrypted) && !(encrypted instanceof Uint8Array)) {
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法保护远程安全状态');
    }
    const buffer = Buffer.from(encrypted);
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法保护远程安全状态');
    }
    return buffer.toString('base64');
  }

  function unseal(value, purpose, id) {
    let decrypted;
    try {
      decrypted = options.decrypt(
        Buffer.from(value, 'base64'), Object.freeze({ purpose, appId: id })
      );
    } catch (_error) {
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法解开远程安全状态');
    }
    if (Buffer.isBuffer(decrypted) || decrypted instanceof Uint8Array) {
      decrypted = Buffer.from(decrypted).toString('utf8');
    }
    if (typeof decrypted !== 'string' || !decrypted || decrypted.includes('\0')) {
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法解开远程安全状态');
    }
    return decrypted;
  }

  function hint(id) {
    return id.length <= 9 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
  }

  function credentialStatus() {
    const state = load();
    return Object.freeze(state.activeAppId === null
      ? { configured: false, appIdHint: null }
      : { configured: true, appIdHint: hint(state.activeAppId) });
  }

  // 关闭态只需应用标识来回读绑定；不要为此提前解密 Secret。
  function readActiveAppId() {
    return load().activeAppId;
  }

  function readCredentials() {
    const state = load();
    if (state.activeAppId === null) return null;
    const id = state.activeAppId;
    let value;
    try {
      value = JSON.parse(unseal(state.apps[id].credential.ciphertext, 'credential', id));
    } catch (error) {
      if (error && error.code === 'ERR_REMOTE_STORE_CRYPTO') throw error;
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法解开远程安全状态');
    }
    if (!isRecord(value) || Object.keys(value).some((key) => !['appId', 'appSecret'].includes(key))
        || Object.keys(value).length !== 2 || value.appId !== id
        || typeof value.appSecret !== 'string' || !value.appSecret
        || value.appSecret.length > 1024 || /[\u0000-\u001f\u007f]/.test(value.appSecret)) {
      throw storeError('ERR_REMOTE_STORE_CRYPTO', '无法解开远程安全状态');
    }
    // 这是唯一返回 Secret 的接口，只供 main 内部连接适配器使用。
    return Object.freeze({ appId: id, appSecret: value.appSecret });
  }

  function rotateCredentials(value) {
    onlyKeys(value, ['appId', 'appSecret']);
    const id = appId(value.appId);
    const secret = fixedString(value.appSecret, 1024);
    if (/[\u0000-\u001f\u007f]/.test(secret)) {
      throw storeError('ERR_REMOTE_STORE_CONTRACT', '飞书应用凭据无效');
    }
    const ciphertext = seal(JSON.stringify({ appId: id, appSecret: secret }), 'credential', id);
    const state = cloneState(load());
    if (state.activeAppId && state.activeAppId !== id) {
      state.apps[state.activeAppId].credential = null;
    }
    if (!state.apps[id]) state.apps[id] = newAppState();
    state.apps[id].credential = { ciphertext };
    state.activeAppId = id;
    write(state);
    return credentialStatus();
  }

  function clearCredentials() {
    const state = cloneState(load());
    if (state.activeAppId === null) return credentialStatus();
    delete state.apps[state.activeAppId];
    state.activeAppId = null;
    write(state);
    return Object.freeze({ configured: false, appIdHint: null });
  }

  function commitBinding(value) {
    onlyKeys(value, ['appId', 'actorId', 'commitId']);
    const id = appId(value.appId);
    const actorId = fixedString(value.actorId, 512);
    const commitId = fixedString(value.commitId, 64);
    if (!COMMIT_ID_PATTERN.test(commitId)) {
      throw storeError('ERR_REMOTE_STORE_CONTRACT', '绑定提交标识无效');
    }
    const state = cloneState(load());
    const entry = state.apps[id] || newAppState();
    if (entry.binding) {
      if (entry.binding.commitId !== commitId
          || unseal(entry.binding.ciphertext, 'binding', id) !== actorId) {
        throw storeError('ERR_REMOTE_STORE_BINDING_CONFLICT', '飞书绑定状态冲突');
      }
      return commitId;
    }
    entry.binding = { ciphertext: seal(actorId, 'binding', id), commitId };
    state.apps[id] = entry;
    write(state);
    return commitId;
  }

  function readBinding(value) {
    const id = appId(value);
    const state = load();
    const binding = state.apps[id] && state.apps[id].binding;
    if (!binding) return null;
    const actorId = unseal(binding.ciphertext, 'binding', id);
    return fixedString(actorId, 512);
  }

  function messageHash(id, messageId) {
    const message = fixedString(messageId, 512);
    return crypto.createHash('sha256').update(id).update('\0').update(message).digest('hex');
  }

  function hasMessage(value) {
    onlyKeys(value, ['appId', 'messageId']);
    const id = appId(value.appId);
    const hash = messageHash(id, value.messageId);
    const state = load();
    const entry = state.apps[id];
    return Boolean(entry && entry.messages.includes(hash));
  }

  function rememberMessage(value) {
    onlyKeys(value, ['appId', 'messageId']);
    const id = appId(value.appId);
    const hash = messageHash(id, value.messageId);
    const state = cloneState(load());
    const entry = state.apps[id] || newAppState();
    if (entry.messages.includes(hash)) return false;
    if (entry.messages.length >= MAX_MESSAGES) entry.messages.shift();
    entry.messages.push(hash);
    state.apps[id] = entry;
    write(state);
    return true;
  }

  // 构造时即回读，坏 schema 不得拖到通道开启后才暴露。
  load();
  return Object.freeze({
    credentialStatus,
    readActiveAppId,
    readCredentials,
    rotateCredentials,
    clearCredentials,
    commitBinding,
    readBinding,
    hasMessage,
    rememberMessage
  });
}

module.exports = { SCHEMA_VERSION, createRemoteSecureStore };
