'use strict';

// 飞书收件箱只把已通过远程核心策略的文字/链接落进权威工作区。
// 不知道 Electron，不下载链接，也不接受调用方指定路径或文件名。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_TEXT_BYTES = 150 * 1024;
const MAX_LINK_LENGTH = 4096;
const APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/;

function inboxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function onlyKeys(value, allowed) {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件参数无效');
  }
}

function createRemoteInbox(options = {}) {
  onlyKeys(options, ['workspacePath', 'now']);
  if (typeof options.workspacePath !== 'string' || !path.isAbsolute(options.workspacePath)
      || options.workspacePath.includes('\0')
      || (options.now !== undefined && typeof options.now !== 'function')) {
    throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件箱参数无效');
  }
  const now = options.now || (() => new Date());
  const suppliedWorkspace = path.resolve(options.workspacePath);
  let workspacePath;
  try {
    const suppliedStat = fs.lstatSync(suppliedWorkspace);
    if (!suppliedStat.isDirectory() || suppliedStat.isSymbolicLink()) throw new Error('unsafe');
    workspacePath = (fs.realpathSync.native || fs.realpathSync)(suppliedWorkspace);
  } catch (_error) {
    throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法验证飞书收件工作区');
  }
  const expectedInbox = path.join(workspacePath, '收件箱');

  function verifyInbox(create) {
    let stat;
    try {
      stat = fs.lstatSync(expectedInbox);
    } catch (error) {
      if (!create || !error || error.code !== 'ENOENT') {
        throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法验证飞书收件箱');
      }
      try {
        fs.mkdirSync(expectedInbox, { mode: 0o700 });
        stat = fs.lstatSync(expectedInbox);
      } catch (mkdirError) {
        if (!mkdirError || mkdirError.code !== 'EEXIST') {
          throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法创建飞书收件箱');
        }
        try { stat = fs.lstatSync(expectedInbox); } catch (_error) {
          throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法验证飞书收件箱');
        }
      }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法验证飞书收件箱');
    }
    let actual;
    try { actual = (fs.realpathSync.native || fs.realpathSync)(expectedInbox); } catch (_error) {
      throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法验证飞书收件箱');
    }
    if (actual !== expectedInbox || path.dirname(actual) !== workspacePath) {
      throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '飞书收件箱越出当前工作区');
    }
    if (process.platform !== 'win32') {
      try { fs.chmodSync(actual, 0o700); } catch (_error) {
        throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '无法保护飞书收件箱');
      }
    }
    return actual;
  }

  const inboxPath = verifyInbox(true);

  function normalizedTime(value) {
    let date;
    if (value === undefined) {
      try { date = now(); } catch (_error) {
        throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件时间无效');
      }
    } else {
      if (typeof value !== 'string' || !value || value.length > 64 || value.includes('\0')) {
        throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件时间无效');
      }
      date = new Date(value);
    }
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件时间无效');
    }
    return date.toISOString();
  }

  function normalizedContent(kind, value) {
    if (typeof value !== 'string' || !value || value.includes('\0')) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件正文无效');
    }
    if (kind === 'text') {
      if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
        throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件正文无效');
      }
      return value;
    }
    if (value.length > MAX_LINK_LENGTH || value !== value.trim()
        || /[\u0000-\u0020\u007f]/.test(value)) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书链接无效');
    }
    let parsed;
    try { parsed = new URL(value); } catch (_error) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书链接无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname
        || parsed.username || parsed.password) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书链接无效');
    }
    return value;
  }

  function receive(value) {
    onlyKeys(value, ['appId', 'kind', 'content', 'messageId', 'receivedAt']);
    if (typeof value.appId !== 'string' || !APP_ID_PATTERN.test(value.appId)) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书应用标识无效');
    }
    if (!['text', 'link'].includes(value.kind)) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书收件类型无效');
    }
    const content = normalizedContent(value.kind, value.content);
    const receivedAt = normalizedTime(value.receivedAt);
    if (typeof value.messageId !== 'string' || !value.messageId
        || value.messageId.length > 512 || value.messageId.includes('\0')) {
      throw inboxError('ERR_REMOTE_INBOX_CONTRACT', '飞书消息标识无效');
    }
    // 文件身份按应用与 message_id 隔离；明文 App ID/消息 ID 都不会进入文件名。
    const identity = crypto.createHash('sha256')
      .update(value.appId, 'utf8')
      .update('\0')
      .update(value.messageId, 'utf8')
      .digest('hex');
    const fileName = `feishu-${identity.slice(0, 24)}.md`;
    const currentInbox = verifyInbox(false);
    if (currentInbox !== inboxPath) {
      throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '飞书收件箱身份已变化');
    }
    const target = path.join(currentInbox, fileName);
    if (path.dirname(target) !== currentInbox) {
      throw inboxError('ERR_REMOTE_INBOX_WORKSPACE', '飞书收件路径越界');
    }
    const markdown = `---\nsource: feishu\nkind: ${value.kind}\nreceivedAt: ${receivedAt}\n---\n\n${content}\n`;
    const result = () => Object.freeze({
      path: target, fileName, kind: value.kind, receivedAt
    });
    const matchesExisting = () => {
      let descriptor = null;
      try {
        const existing = fs.lstatSync(target);
        if (!existing.isFile() || existing.isSymbolicLink()
            || existing.size !== Buffer.byteLength(markdown, 'utf8')) return false;
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
        descriptor = fs.openSync(target, flags);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.size !== existing.size) return false;
        const raw = fs.readFileSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        return raw.equals(Buffer.from(markdown, 'utf8'));
      } catch (_error) {
        return false;
      } finally {
        if (descriptor !== null) {
          try { fs.closeSync(descriptor); } catch (_closeError) { /* best effort */ }
        }
      }
    };
    let descriptor = null;
    let created = false;
    try {
      descriptor = fs.openSync(target, 'wx', 0o600);
      created = true;
      fs.writeFileSync(descriptor, markdown, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_closeError) { /* best effort */ }
      }
      if (created) {
        try { fs.unlinkSync(target); } catch (_unlinkError) { /* best effort */ }
      }
      if (error && error.code === 'EEXIST') {
        if (matchesExisting()) return result();
        throw inboxError('ERR_REMOTE_INBOX_CONFLICT', '飞书收件文件冲突');
      }
      throw inboxError('ERR_REMOTE_INBOX_WRITE', '无法写入飞书收件箱');
    }
    return result();
  }

  return Object.freeze({ receive });
}

module.exports = { createRemoteInbox };
