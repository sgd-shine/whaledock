'use strict';

// 项目文件夹只允许 main 与受管 Host 看见明文。页面拿到的 ticket 是
// AES-256-GCM 密文，并同时绑定 Host、页面 owner、项目与本次 openToken；
// 它不是通用路径 capability，也不能跨页面、跨 Host 或跨 prepare 重放。
const crypto = require('crypto');
const path = require('path');

const PREFIX = 'project-bootstrap-v1';
const TICKET_RE = /^project-bootstrap-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{16,10923}\.[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
const OPEN_TOKEN_RE = /^project-open-[a-f0-9]{64}$/;
const NONCE_RE = /^[a-f0-9]{32}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_ROOT_BYTES = 4096;
const MAX_TICKET_BYTES = 8192;
const DEFAULT_TTL_MS = 10_000;
const MAX_CLOCK_SKEW_MS = 1_000;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validOwner(value) {
  return plain(value)
    && ID_RE.test(String(value.hostInstanceId || ''))
    && ID_RE.test(String(value.controllerId || ''))
    && ID_RE.test(String(value.pageInstanceId || ''))
    && Number.isSafeInteger(value.selectionRevision)
    && value.selectionRevision >= 1;
}

function validRoot(value) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= MAX_ROOT_BYTES
    && !CONTROL_RE.test(value) && path.isAbsolute(value);
}

function checkedNow(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('project bootstrap ticket clock invalid');
  }
  return value;
}

function keyFor(secret) {
  if (typeof secret !== 'string' || !TOKEN_RE.test(secret)) {
    throw new TypeError('project bootstrap ticket secret invalid');
  }
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update('whaledock-project-bootstrap-key/v1')
    .digest();
}

function aadFor(hostInstanceId) {
  if (!ID_RE.test(String(hostInstanceId || ''))) {
    throw new TypeError('project bootstrap ticket Host invalid');
  }
  return Buffer.from(`${PREFIX}\0${hostInstanceId}`, 'utf8');
}

function sealProjectBootstrapTicket(input, supplied = {}) {
  if (!plain(input) || !validOwner(input)
      || !PROJECT_ID_RE.test(String(input.projectId || ''))
      || !OPEN_TOKEN_RE.test(String(input.openToken || ''))
      || !validRoot(input.root)) {
    throw new TypeError('project bootstrap ticket input invalid');
  }
  const now = checkedNow((supplied.now || Date.now)());
  const ttlMs = supplied.ttlMs === undefined ? DEFAULT_TTL_MS : supplied.ttlMs;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_TTL_MS
      || !Number.isSafeInteger(now + ttlMs)) {
    throw new TypeError('project bootstrap ticket ttl invalid');
  }
  const randomBytes = supplied.randomBytes || crypto.randomBytes;
  const iv = randomBytes(12);
  const nonceBytes = randomBytes(16);
  if (!Buffer.isBuffer(iv) || iv.length !== 12
      || !Buffer.isBuffer(nonceBytes) || nonceBytes.length !== 16) {
    throw new TypeError('project bootstrap ticket random source invalid');
  }
  const payload = Object.freeze({
    version: 1,
    hostInstanceId: input.hostInstanceId,
    controllerId: input.controllerId,
    pageInstanceId: input.pageInstanceId,
    selectionRevision: input.selectionRevision,
    projectId: input.projectId,
    openToken: input.openToken,
    root: input.root,
    issuedAtMs: now,
    expiresAtMs: now + ttlMs,
    nonce: nonceBytes.toString('hex')
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(input.secret), iv);
  cipher.setAAD(aadFor(input.hostInstanceId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()
  ]);
  const ticket = [
    PREFIX,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url')
  ].join('.');
  if (!TICKET_RE.test(ticket) || Buffer.byteLength(ticket, 'utf8') > MAX_TICKET_BYTES) {
    throw new TypeError('project bootstrap ticket exceeds budget');
  }
  return ticket;
}

function openProjectBootstrapTicket(ticket, expected, supplied = {}) {
  try {
    if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)
        || Buffer.byteLength(ticket, 'utf8') > MAX_TICKET_BYTES
        || !plain(expected) || !validOwner(expected)
        || !PROJECT_ID_RE.test(String(expected.projectId || ''))
        || !OPEN_TOKEN_RE.test(String(expected.openToken || ''))) return null;
    const now = checkedNow((supplied.now || Date.now)());
    const parts = ticket.split('.');
    const iv = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const authTag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || encrypted.length < 1 || authTag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(expected.secret), iv);
    decipher.setAAD(aadFor(expected.hostInstanceId));
    decipher.setAuthTag(authTag);
    const decoded = Buffer.concat([
      decipher.update(encrypted), decipher.final()
    ]).toString('utf8');
    if (Buffer.byteLength(decoded, 'utf8') > MAX_ROOT_BYTES + 2048) return null;
    const value = JSON.parse(decoded);
    const keys = [
      'version', 'hostInstanceId', 'controllerId', 'pageInstanceId',
      'selectionRevision', 'projectId', 'openToken', 'root',
      'issuedAtMs', 'expiresAtMs', 'nonce'
    ];
    if (!exact(value, keys) || value.version !== 1 || !validOwner(value)
        || value.hostInstanceId !== expected.hostInstanceId
        || value.controllerId !== expected.controllerId
        || value.pageInstanceId !== expected.pageInstanceId
        || value.selectionRevision !== expected.selectionRevision
        || value.projectId !== expected.projectId
        || value.openToken !== expected.openToken
        || !validRoot(value.root) || !NONCE_RE.test(String(value.nonce || ''))
        || !Number.isSafeInteger(value.issuedAtMs) || value.issuedAtMs < 0
        || !Number.isSafeInteger(value.expiresAtMs)
        || value.expiresAtMs <= value.issuedAtMs
        || value.expiresAtMs - value.issuedAtMs > DEFAULT_TTL_MS
        || value.issuedAtMs > now + MAX_CLOCK_SKEW_MS
        || now >= value.expiresAtMs) return null;
    return Object.freeze({
      projectId: value.projectId,
      openToken: value.openToken,
      root: value.root,
      nonce: value.nonce,
      expiresAtMs: value.expiresAtMs
    });
  } catch (_error) {
    return null;
  }
}

module.exports = Object.freeze({
  PREFIX,
  TICKET_RE,
  MAX_TICKET_BYTES,
  DEFAULT_TTL_MS,
  sealProjectBootstrapTicket,
  openProjectBootstrapTicket
});
