'use strict';

// 项目会话根的跨 Host/main opaque proof。本模块只对已经 realpath
// 的绝对路径做跨平台字面归一与 HMAC；真实文件系统校验由各端在调用前完成。
// 返回值仅允许出现在受信 job metadata/main handler context，不是公开项目字段。
const crypto = require('crypto');
const path = require('path');

const TOKEN_RE = /^[a-f0-9]{64}$/;
const HOST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SESSION_ROOT_REF_RE = /^session-root-[a-f0-9]{64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_ROOT_BYTES = 4096;

function pathTools(platform, supplied) {
  if (supplied) return supplied;
  return platform === 'win32' ? path.win32 : path.posix;
}

function canonicalRootKey(value, options = {}) {
  const platform = options.platform || process.platform;
  const tools = pathTools(platform, options.pathImpl);
  if (typeof value !== 'string' || !value || CONTROL_RE.test(value)
      || Buffer.byteLength(value, 'utf8') > MAX_ROOT_BYTES) {
    throw new TypeError('project session root invalid');
  }
  let normalized = value;
  if (platform === 'win32') {
    if (normalized.startsWith('\\\\?\\UNC\\')) normalized = `\\\\${normalized.slice(8)}`;
    else if (/^\\\\\?\\[A-Za-z]:/.test(normalized)) normalized = normalized.slice(4);
  }
  if (!tools.isAbsolute(normalized)) throw new TypeError('project session root invalid');
  normalized = tools.resolve(normalized);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function sessionRootRef(secret, hostInstanceId, canonicalRoot, options = {}) {
  if (typeof secret !== 'string' || !TOKEN_RE.test(secret)
      || typeof hostInstanceId !== 'string' || !HOST_ID_RE.test(hostInstanceId)) {
    throw new TypeError('project session root proof identity invalid');
  }
  const rootKey = canonicalRootKey(canonicalRoot, options);
  return `session-root-${crypto.createHmac('sha256', secret)
    .update(`whaledock-session-root/v1\0${hostInstanceId}\0${rootKey}`)
    .digest('hex')}`;
}

module.exports = Object.freeze({
  SESSION_ROOT_REF_RE,
  canonicalRootKey,
  sessionRootRef
});
