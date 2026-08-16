'use strict';

// v0.4 图片入口核心：只处理纯 Node 状态、受控文件与系统命令计划。
// Electron nativeImage / clipboard / BrowserWindow 只允许由 main 薄层调用。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
// 与工作区/受保护根共用同一套 realpath 身份口径。
const { normalizeRealPath } = require('./config');

const LIMITS = Object.freeze({
  maxSourceBytes: 20 * 1024 * 1024,
  maxPixels: 40_000_000,
  maxSide: 32_768,
  maxThumbnailBytes: 2 * 1024 * 1024,
  maxOcrStdoutBytes: 1024 * 1024,
  maxOcrStderrBytes: 64 * 1024,
  maxOcrTextBytes: 50 * 1024,
  maxDeliveryBytes: 64 * 1024,
  maxPathChars: 4096
});

const STAGING_PREFIX = 'whaledock-capture-';
const SCREENSHOT_DIRNAME = '鲸坞截图';
const CAPTURE_SOURCES = new Set([
  'mac-capture', 'windows-clipboard', 'paste', 'drop'
]);
const CAPTURE_STAGES = new Set([
  'acquiring', 'preview', 'saving', 'recognizing', 'delivery-ready',
  'submitting', 'copied', 'done', 'failed', 'cancelled'
]);
const IMAGE_ROUTES = new Set(['official', 'plugin', 'local-ocr', 'path-only']);
const CAPABILITY_STATES = new Set(['available', 'unavailable', 'unknown']);
const OCR_FAILURE_REASONS = new Set([
  'framework-unavailable', 'decode-failed', 'recognition-failed',
  'language-unavailable', 'no-text', 'unsupported-platform', 'script-error'
]);

function imageError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function plainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function finitePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw imageError('ERR_IMAGE_DIMENSIONS', `${label} 必须是正整数`);
  }
  return value;
}

function validateDimensions(widthValue, heightValue) {
  const width = finitePositiveInteger(widthValue, '图片宽度');
  const height = finitePositiveInteger(heightValue, '图片高度');
  if (width > LIMITS.maxSide || height > LIMITS.maxSide) {
    throw imageError('ERR_IMAGE_DIMENSIONS', '图片边长超过安全上限');
  }
  if (width * height > LIMITS.maxPixels) {
    throw imageError('ERR_IMAGE_PIXELS', '图片像素数超过安全上限');
  }
  return { width, height };
}

function inspectPngHeader(buffer) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw imageError('ERR_IMAGE_HEADER', 'PNG 缺少规范 IHDR');
  }
  const { width, height } = validateDimensions(
    buffer.readUInt32BE(16),
    buffer.readUInt32BE(20)
  );
  return { format: 'png', width, height };
}

function inspectJpegHeader(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const sof = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (sof.has(marker)) {
      if (length < 7) throw imageError('ERR_IMAGE_HEADER', 'JPEG SOF 长度无效');
      const { width, height } = validateDimensions(
        buffer.readUInt16BE(offset + 5),
        buffer.readUInt16BE(offset + 3)
      );
      return { format: 'jpeg', width, height };
    }
    offset += length;
  }
  throw imageError('ERR_IMAGE_HEADER', 'JPEG 缺少可识别的 SOF');
}

function inspectImageHeader(value) {
  if (!Buffer.isBuffer(value)) throw imageError('ERR_IMAGE_FORMAT', '图片头必须是 Buffer');
  const png = inspectPngHeader(value);
  if (png) return png;
  const jpeg = inspectJpegHeader(value);
  if (jpeg) return jpeg;
  throw imageError('ERR_IMAGE_FORMAT', '只接受实际解码为 PNG/JPEG 的单张图片');
}

function validateDecodedImage(value) {
  if (!plainRecord(value) || !CAPTURE_SOURCES.has(value.source)) {
    throw imageError('ERR_IMAGE_SOURCE', '图片来源无效');
  }
  if (!Number.isSafeInteger(value.sourceBytes) || value.sourceBytes < 1
      || value.sourceBytes > LIMITS.maxSourceBytes) {
    throw imageError('ERR_IMAGE_TOO_LARGE', '图片源字节超过安全上限');
  }
  if (!plainRecord(value.header) || !['png', 'jpeg'].includes(value.header.format)) {
    throw imageError('ERR_IMAGE_HEADER', '图片 header 无效');
  }
  const headerSize = validateDimensions(value.header.width, value.header.height);
  const decodedSize = validateDimensions(value.width, value.height);
  if (headerSize.width !== decodedSize.width || headerSize.height !== decodedSize.height) {
    throw imageError('ERR_IMAGE_DECODE_MISMATCH', 'header 与实际解码尺寸不一致');
  }
  return {
    source: value.source,
    format: value.header.format,
    width: decodedSize.width,
    height: decodedSize.height,
    sourceBytes: value.sourceBytes
  };
}

function captureId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw imageError('ERR_CAPTURE_ID', 'captureId 无效');
  }
  return value;
}

function workspaceGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw imageError('ERR_CAPTURE_WORKSPACE', '工作区 generation 无效');
  }
  return value;
}

function safeLabel(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 120) || fallback;
}

function createCapture(options = {}) {
  const id = captureId(options.captureId);
  if (!CAPTURE_SOURCES.has(options.source)) throw imageError('ERR_IMAGE_SOURCE', '图片来源无效');
  return Object.freeze({
    captureId: id,
    source: options.source,
    stage: 'acquiring',
    workspaceGeneration: workspaceGeneration(options.workspaceGeneration),
    workspaceLabel: safeLabel(options.workspaceLabel, '当前工作区'),
    deliveryState: 'not-attempted'
  });
}

function requireStage(state, expected, action) {
  if (!plainRecord(state) || !CAPTURE_STAGES.has(state.stage) || !expected.includes(state.stage)) {
    throw imageError('ERR_CAPTURE_TRANSITION', `${action} 不允许从当前阶段执行`);
  }
}

function thumbnail(value) {
  if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxThumbnailBytes) {
    throw imageError('ERR_CAPTURE_THUMBNAIL', '缩略图无效或超过上限');
  }
  return value;
}

function normalizedTarget(value, index) {
  if (!plainRecord(value)
      || typeof value.targetToken !== 'string' || value.targetToken.length < 1
      || value.targetToken.length > 256) {
    throw imageError('ERR_CAPTURE_TARGET', `目标 ${index} 无效`);
  }
  return {
    targetToken: value.targetToken,
    label: safeLabel(value.label, `会话 ${String(index + 1).padStart(2, '0')}`),
    running: value.running === true,
    ...(Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {})
  };
}

function reduceCapture(state, action) {
  if (!plainRecord(action) || typeof action.type !== 'string') {
    throw imageError('ERR_CAPTURE_TRANSITION', 'capture action 无效');
  }
  if (action.type === 'acquired') {
    requireStage(state, ['acquiring'], action.type);
    const dimensions = validateDimensions(action.width, action.height);
    if (typeof action.stagingPath !== 'string' || !action.stagingPath) {
      throw imageError('ERR_CAPTURE_TRANSITION', 'acquired 缺少 stagingPath');
    }
    return Object.freeze({
      ...state,
      stage: 'preview',
      stagingPath: action.stagingPath,
      ...(typeof action.sourcePath === 'string' ? { sourcePath: action.sourcePath } : {}),
      thumbnail: thumbnail(action.thumbnail),
      ...dimensions
    });
  }
  if (action.type === 'confirm-save') {
    requireStage(state, ['preview'], action.type);
    return Object.freeze({ ...state, stage: 'saving' });
  }
  if (action.type === 'saved') {
    requireStage(state, ['saving'], action.type);
    if (typeof action.savedPath !== 'string' || !action.savedPath) {
      throw imageError('ERR_CAPTURE_TRANSITION', 'saved 缺少 savedPath');
    }
    return Object.freeze({ ...state, stage: 'recognizing', savedPath: action.savedPath });
  }
  if (action.type === 'recognized') {
    requireStage(state, ['recognizing'], action.type);
    if (!IMAGE_ROUTES.has(action.route)) throw imageError('ERR_IMAGE_ROUTE', '图片 route 无效');
    const bounded = truncateUtf8(typeof action.ocrText === 'string' ? action.ocrText : '', LIMITS.maxOcrTextBytes);
    const targets = Array.isArray(action.targets)
      ? action.targets.slice(0, 500).map(normalizedTarget) : [];
    if (typeof action.deliveryText !== 'string'
        || Buffer.byteLength(action.deliveryText, 'utf8') > LIMITS.maxDeliveryBytes) {
      throw imageError('ERR_CAPTURE_TRANSITION', 'deliveryText 无效');
    }
    return Object.freeze({
      ...state,
      stage: 'delivery-ready',
      route: action.route,
      ocrText: bounded.text,
      ocrTruncated: action.ocrTruncated === true || bounded.truncated,
      deliveryText: action.deliveryText,
      targets,
      deliveryState: 'not-attempted'
    });
  }
  if (action.type === 'submit') {
    requireStage(state, ['delivery-ready'], action.type);
    return Object.freeze({ ...state, stage: 'submitting', deliveryState: 'submitting' });
  }
  if (action.type === 'accepted') {
    requireStage(state, ['submitting'], action.type);
    return Object.freeze({ ...state, stage: 'done', deliveryState: 'accepted' });
  }
  if (action.type === 'copied') {
    requireStage(state, ['delivery-ready', 'submitting'], action.type);
    return Object.freeze({ ...state, stage: 'copied', deliveryState: 'copied' });
  }
  if (action.type === 'save-only') {
    requireStage(state, ['delivery-ready'], action.type);
    return Object.freeze({ ...state, stage: 'done', deliveryState: 'not-attempted' });
  }
  if (action.type === 'cancel') {
    requireStage(state, [
      'acquiring', 'preview', 'saving', 'recognizing', 'delivery-ready', 'submitting'
    ], action.type);
    return Object.freeze({ ...state, stage: 'cancelled' });
  }
  if (action.type === 'fail') {
    requireStage(state, [
      'acquiring', 'preview', 'saving', 'recognizing', 'delivery-ready', 'submitting'
    ], action.type);
    return Object.freeze({
      ...state,
      stage: 'failed',
      errorCode: safeLabel(action.errorCode, 'unknown').slice(0, 64)
    });
  }
  throw imageError('ERR_CAPTURE_TRANSITION', `未知 capture action：${action.type}`);
}

function captureRendererSnapshot(state) {
  if (!plainRecord(state) || !CAPTURE_STAGES.has(state.stage)) {
    throw imageError('ERR_CAPTURE_STATE', 'capture state 无效');
  }
  return {
    captureId: captureId(state.captureId),
    source: CAPTURE_SOURCES.has(state.source) ? state.source : 'drop',
    stage: state.stage,
    workspaceLabel: safeLabel(state.workspaceLabel, '当前工作区'),
    ...(typeof state.thumbnail === 'string' ? { thumbnail: thumbnail(state.thumbnail) } : {}),
    ...(Number.isSafeInteger(state.width) ? { width: state.width } : {}),
    ...(Number.isSafeInteger(state.height) ? { height: state.height } : {}),
    ...(typeof state.savedPath === 'string' ? { savedPath: state.savedPath.slice(0, LIMITS.maxPathChars) } : {}),
    ...(IMAGE_ROUTES.has(state.route) ? { route: state.route } : {}),
    ...(typeof state.ocrText === 'string' ? { ocrText: state.ocrText } : {}),
    ...(state.ocrTruncated === true ? { ocrTruncated: true } : {}),
    ...(typeof state.deliveryText === 'string' ? { deliveryText: state.deliveryText } : {}),
    ...(Array.isArray(state.targets) ? { targets: state.targets.map(normalizedTarget) } : {}),
    deliveryState: typeof state.deliveryState === 'string' ? state.deliveryState : 'not-attempted',
    ...(typeof state.errorCode === 'string' ? { errorCode: state.errorCode.slice(0, 64) } : {})
  };
}

function randomHex(randomBytes, bytes = 12) {
  const value = randomBytes(bytes);
  if (!Buffer.isBuffer(value) || value.length !== bytes) {
    throw imageError('ERR_CAPTURE_RANDOM', 'randomBytes 返回值无效');
  }
  return value.toString('hex');
}

async function safeOwnedDirectory(directory, options = {}) {
  const fsImpl = options.fs || fs.promises;
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '受控目录必须是绝对路径');
  }
  await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsImpl.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '受控目录不是普通目录');
  }
  if (process.platform !== 'win32' && typeof fsImpl.chmod === 'function') {
    await fsImpl.chmod(directory, 0o700);
  }
  return realIdentity(fsImpl, directory);
}

async function writeExclusive(filePath, value, fsImpl, mode = 0o600) {
  let handle;
  let created = false;
  try {
    handle = await fsImpl.open(filePath, 'wx', mode);
    created = true;
    await handle.writeFile(value);
    if (typeof handle.sync === 'function') await handle.sync();
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch (_error) { /* ignore */ }
      handle = null;
    }
    // `wx` 的 EEXIST 绝不能删除别人已存在的文件；仅清理本次确实创建的半成品。
    if (created) {
      try { await fsImpl.unlink(filePath); } catch (_error) { /* ignore */ }
    }
    throw error;
  } finally {
    if (handle) await handle.close();
  }
  if (process.platform !== 'win32' && typeof fsImpl.chmod === 'function') {
    await fsImpl.chmod(filePath, mode);
  }
}

// `screencapture` 自己创建目标文件，因此这里只准备受控目录并选择一个
// 当下尚不存在的随机路径；main 在进程退出后仍须解码并规范化该文件。
async function planMacCaptureStaging(options = {}) {
  const fsImpl = options.fs || fs.promises;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  captureId(options.captureId);
  const root = await safeOwnedDirectory(options.stagingRoot, { fs: fsImpl });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = path.join(root, `${STAGING_PREFIX}${randomHex(randomBytes)}.png`);
    try {
      await fsImpl.lstat(target);
    } catch (error) {
      if (error && error.code === 'ENOENT') return Object.freeze({ path: target });
      throw imageError('ERR_CAPTURE_STAGING_PLAN', '无法检查截图 staging 路径', error);
    }
  }
  throw imageError('ERR_CAPTURE_STAGING_PLAN', '截图 staging 随机文件名连续冲突');
}

async function writeStagingPng(options = {}) {
  const fsImpl = options.fs || fs.promises;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  captureId(options.captureId);
  if (!Buffer.isBuffer(options.pngBuffer) || options.pngBuffer.length < 1
      || options.pngBuffer.length > LIMITS.maxSourceBytes) {
    throw imageError('ERR_IMAGE_TOO_LARGE', '规范化 PNG 无效或超过上限');
  }
  const header = inspectImageHeader(options.pngBuffer);
  if (header.format !== 'png') throw imageError('ERR_IMAGE_FORMAT', 'staging 只接受规范化 PNG');
  const root = await safeOwnedDirectory(options.stagingRoot, { fs: fsImpl });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = path.join(root, `${STAGING_PREFIX}${randomHex(randomBytes)}.png`);
    try {
      await writeExclusive(target, options.pngBuffer, fsImpl);
      return target;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw imageError('ERR_CAPTURE_STAGING_WRITE', '写入 staging 失败', error);
    }
  }
  throw imageError('ERR_CAPTURE_STAGING_WRITE', 'staging 随机文件名连续冲突');
}

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

// fs.promises.realpath 是原生实现，Windows 上会把 8.3 短名展开为最终路径；
// 归一化后与 lib/config.js、lib/workspaces.js 得到同一个路径身份。
async function realIdentity(fsImpl, target) {
  return normalizeRealPath(await fsImpl.realpath(target));
}

function assertNotForbiddenWorkspace(value, forbiddenRoots) {
  if (forbiddenRoots === undefined) return;
  if (!Array.isArray(forbiddenRoots)) {
    throw imageError('ERR_CAPTURE_PROTECTED_ROOT', '工作区保护根策略无效');
  }
  const key = (item) => process.platform === 'win32'
    ? path.resolve(item).toLocaleLowerCase('en-US') : path.resolve(item);
  const candidate = key(value);
  for (const root of forbiddenRoots) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) {
      throw imageError('ERR_CAPTURE_PROTECTED_ROOT', '工作区保护根策略无效');
    }
    const protectedRoot = key(root);
    const prefix = protectedRoot.endsWith(path.sep)
      ? protectedRoot : `${protectedRoot}${path.sep}`;
    if (candidate === protectedRoot || candidate.startsWith(prefix)) {
      throw imageError('ERR_CAPTURE_PROTECTED_ROOT', '拒绝把截图写入受保护目录');
    }
  }
}

function timestampName(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw imageError('ERR_CAPTURE_TIME', '截图时间无效');
  return date.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
}

async function screenshotDirectory(workspaceReal, fsImpl, forbiddenRoots) {
  assertNotForbiddenWorkspace(workspaceReal, forbiddenRoots);
  const target = path.join(workspaceReal, SCREENSHOT_DIRNAME);
  let stat;
  let created = false;
  try {
    stat = await fsImpl.lstat(target);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw imageError('ERR_CAPTURE_UNSAFE_PATH', '无法检查截图目录', error);
    try {
      await fsImpl.mkdir(target, { recursive: false, mode: 0o700 });
      created = true;
    }
    catch (mkdirError) {
      if (!mkdirError || mkdirError.code !== 'EEXIST') {
        throw imageError('ERR_CAPTURE_UNSAFE_PATH', '无法创建截图目录', mkdirError);
      }
    }
    stat = await fsImpl.lstat(target);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '鲸坞截图目标不是普通目录');
  }
  const real = await realIdentity(fsImpl, target);
  if (!contained(workspaceReal, real)) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '鲸坞截图目标越出当前工作区');
  }
  // 工作区内同名目录可能早已由用户创建；只收紧鲸坞本次新建目录，
  // 不擅自修改用户已有目录的权限。
  if (created && process.platform !== 'win32' && typeof fsImpl.chmod === 'function') {
    await fsImpl.chmod(real, 0o700);
  }
  return real;
}

async function saveStagedImage(options = {}) {
  const fsImpl = options.fs || fs.promises;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  if (options.workspaceGeneration !== options.currentWorkspaceGeneration) {
    throw imageError('ERR_CAPTURE_WORKSPACE_CHANGED', '工作区已切换，请重新确认图片');
  }
  workspaceGeneration(options.workspaceGeneration);
  if (typeof options.stagingPath !== 'string' || !path.isAbsolute(options.stagingPath)) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', 'stagingPath 必须是绝对路径');
  }
  const stagingStat = await fsImpl.lstat(options.stagingPath).catch((error) => {
    throw imageError('ERR_CAPTURE_STAGING_READ', 'staging 文件不可读', error);
  });
  if (stagingStat.isSymbolicLink() || !stagingStat.isFile()
      || stagingStat.size < 1 || stagingStat.size > LIMITS.maxSourceBytes) {
    throw imageError('ERR_CAPTURE_STAGING_READ', 'staging 不是受控普通文件');
  }
  if (typeof options.workspacePath !== 'string' || !path.isAbsolute(options.workspacePath)
      || options.workspacePath.includes('\0')) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '工作区路径无效');
  }
  // 字面路径先拒绝，避免对受保护根本身或后代执行 realpath/stat。
  assertNotForbiddenWorkspace(options.workspacePath, options.forbiddenRoots);
  const workspaceReal = await realIdentity(fsImpl, options.workspacePath).catch((error) => {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '工作区不可解析', error);
  });
  // 再检查 realpath，阻断 symlink/junction 落入受保护根或其真实目标。
  assertNotForbiddenWorkspace(workspaceReal, options.forbiddenRoots);
  const workspaceStat = await fsImpl.stat(workspaceReal).catch((error) => {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '工作区不可访问', error);
  });
  if (!workspaceStat.isDirectory()) throw imageError('ERR_CAPTURE_UNSAFE_PATH', '工作区不是目录');
  const screenshotsReal = await screenshotDirectory(
    workspaceReal, fsImpl, options.forbiddenRoots
  );
  const value = await fsImpl.readFile(options.stagingPath);
  const header = inspectImageHeader(value);
  if (header.format !== 'png') throw imageError('ERR_IMAGE_FORMAT', 'staging 必须是 PNG');
  const stem = `鲸坞截图-${timestampName(options.now)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = path.join(screenshotsReal, `${stem}-${randomHex(randomBytes, 8)}.png`);
    try {
      await writeExclusive(target, value, fsImpl);
      const after = await realIdentity(fsImpl, screenshotsReal);
      if (after !== screenshotsReal || !contained(workspaceReal, after)) {
        try { await fsImpl.unlink(target); } catch (_error) { /* ignore */ }
        throw imageError('ERR_CAPTURE_UNSAFE_PATH', '保存期间截图目录发生变化');
      }
      return target;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      if (error && error.code === 'ERR_CAPTURE_UNSAFE_PATH') throw error;
      throw imageError('ERR_CAPTURE_SAVE', '保存截图失败', error);
    }
  }
  throw imageError('ERR_CAPTURE_SAVE', '截图随机文件名连续冲突');
}

async function cleanupOwnedStaging(options = {}) {
  const fsImpl = options.fs || fs.promises;
  const root = options.stagingRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', 'stagingRoot 必须是绝对路径');
  }
  let rootStat;
  try { rootStat = await fsImpl.lstat(root); }
  catch (error) {
    if (error && error.code === 'ENOENT') return { removed: 0 };
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', '无法检查 stagingRoot', error);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', 'stagingRoot 不是普通目录');
  }
  const names = await fsImpl.readdir(root);
  let removed = 0;
  for (const name of names.slice(0, 10000)) {
    if (!name.startsWith(STAGING_PREFIX) || !name.endsWith('.png')) continue;
    const candidate = path.join(root, name);
    let stat;
    try { stat = await fsImpl.lstat(candidate); } catch (_error) { continue; }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    try {
      await fsImpl.unlink(candidate);
      removed += 1;
    } catch (_error) { /* 单文件失败不扩大清理范围 */ }
  }
  return { removed };
}

async function cleanupStagingFile(filePath, stagingRoot, options = {}) {
  const fsImpl = options.fs || fs.promises;
  const root = await realIdentity(fsImpl, stagingRoot);
  if (typeof filePath !== 'string' || path.dirname(filePath) !== root
      || !path.basename(filePath).startsWith(STAGING_PREFIX)) return false;
  const stat = await fsImpl.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  await fsImpl.unlink(filePath);
  return true;
}

function capability(value) {
  return CAPABILITY_STATES.has(value) ? value : 'unknown';
}

function selectImageRoute(capabilities = {}) {
  if (capability(capabilities.official) === 'available') return { route: 'official' };
  if (capability(capabilities.plugin) === 'available') return { route: 'plugin' };
  if (capability(capabilities.localOcr) === 'available') return { route: 'local-ocr' };
  return { route: 'path-only' };
}

function absoluteForPlatform(value, platform) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  return typeof value === 'string' && value.length <= LIMITS.maxPathChars
    && !value.includes('\0') && api.isAbsolute(value);
}

function macCaptureCommand(stagingPath) {
  if (!absoluteForPlatform(stagingPath, 'darwin')) {
    throw imageError('ERR_CAPTURE_UNSAFE_PATH', 'macOS 截图目标必须是绝对路径');
  }
  return {
    available: true,
    file: '/usr/sbin/screencapture',
    args: ['-i', '-x', stagingPath],
    shell: false,
    windowsHide: false
  };
}

function ocrCommand(platform, options = {}) {
  if (!['darwin', 'win32'].includes(platform)) {
    return { available: false, reason: 'unsupported-platform' };
  }
  if (!absoluteForPlatform(options.scriptsRoot, platform)
      || !absoluteForPlatform(options.imagePath, platform)) {
    throw imageError('ERR_OCR_PATH', 'OCR 脚本与图片必须是绝对路径');
  }
  const api = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') {
    return {
      available: true,
      file: '/usr/bin/osascript',
      args: ['-l', 'JavaScript', api.join(options.scriptsRoot, 'macos-vision.jxa'), options.imagePath],
      shell: false,
      windowsHide: false
    };
  }
  return {
    available: true,
    file: 'powershell.exe',
    args: [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      api.join(options.scriptsRoot, 'windows-media-ocr.ps1'),
      '-ImagePath', options.imagePath
    ],
    shell: false,
    windowsHide: true
  };
}

function truncateUtf8(value, maximum) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= maximum) return { text, truncated: false };
  const suffix = '\n[OCR 文本已截断]';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  let result = '';
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size + suffixBytes > maximum) break;
    result += character;
    bytes += size;
  }
  return { text: result + suffix, truncated: true };
}

function parseOcrOutput(raw) {
  let value;
  try { value = JSON.parse(raw); } catch (_error) { return { ok: false, reason: 'invalid-output' }; }
  if (!plainRecord(value) || value.schemaVersion !== 1 || typeof value.ok !== 'boolean') {
    return { ok: false, reason: 'invalid-output' };
  }
  if (value.ok === false) {
    return {
      ok: false,
      reason: OCR_FAILURE_REASONS.has(value.reason) ? value.reason : 'invalid-output'
    };
  }
  if (typeof value.text !== 'string') return { ok: false, reason: 'invalid-output' };
  const bounded = truncateUtf8(value.text, LIMITS.maxOcrTextBytes);
  return { ok: true, text: bounded.text, truncated: bounded.truncated };
}

function runBoundedOcr(plan, options = {}) {
  if (!plainRecord(plan) || plan.available !== true) {
    const reason = plainRecord(plan) && typeof plan.reason === 'string'
      ? safeLabel(plan.reason, 'unsupported-platform').slice(0, 64)
      : 'unsupported-platform';
    return Promise.resolve({ ok: false, reason });
  }
  if (typeof plan.file !== 'string' || !Array.isArray(plan.args) || plan.shell !== false) {
    return Promise.resolve({ ok: false, reason: 'invalid-plan' });
  }
  const spawnImpl = options.spawn || spawn;
  const timeoutMs = options.timeoutMs == null ? 30000 : Number(options.timeoutMs);
  const settleTimeoutMs = options.settleTimeoutMs == null ? 1000 : Number(options.settleTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
      || !Number.isFinite(settleTimeoutMs) || settleTimeoutMs < 1 || settleTimeoutMs > 10000) {
    return Promise.resolve({ ok: false, reason: 'invalid-plan' });
  }
  return new Promise((resolve) => {
    let child;
    let timer = null;
    let settleTimer = null;
    let settled = false;
    let forcedReason = null;
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (settleTimer) clearTimeout(settleTimer);
      timer = null;
      settleTimer = null;
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const terminate = (reason) => {
      if (forcedReason) return;
      forcedReason = reason;
      try { if (child && typeof child.kill === 'function') child.kill('SIGTERM'); } catch (_error) { /* ignore */ }
      settleTimer = setTimeout(() => finish({ ok: false, reason }), settleTimeoutMs);
    };

    try {
      child = spawnImpl(plan.file, plan.args.slice(), {
        shell: false,
        windowsHide: plan.windowsHide === true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (_error) {
      finish({ ok: false, reason: 'process-error' });
      return;
    }
    if (!child || !child.stdout || !child.stderr || typeof child.once !== 'function') {
      finish({ ok: false, reason: 'process-error' });
      return;
    }
    child.stdout.on('data', (chunkValue) => {
      if (settled || forcedReason) return;
      const chunk = Buffer.from(chunkValue);
      stdoutBytes += chunk.length;
      if (stdoutBytes > LIMITS.maxOcrStdoutBytes) {
        terminate('output-too-large');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunkValue) => {
      if (settled || forcedReason) return;
      stderrBytes += Buffer.byteLength(chunkValue);
      if (stderrBytes > LIMITS.maxOcrStderrBytes) terminate('process-error');
    });
    child.once('error', () => finish({ ok: false, reason: forcedReason || 'process-error' }));
    child.once('close', (code) => {
      if (forcedReason) {
        finish({ ok: false, reason: forcedReason });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, reason: 'process-exit' });
        return;
      }
      finish(parseOcrOutput(Buffer.concat(stdout, stdoutBytes).toString('utf8').trim()));
    });
    timer = setTimeout(() => terminate('timeout'), timeoutMs);
  });
}

function buildDeliveryText(options = {}) {
  if (typeof options.savedPath !== 'string' || options.savedPath.length < 1
      || options.savedPath.length > LIMITS.maxPathChars || options.savedPath.includes('\0')
      || !(path.isAbsolute(options.savedPath) || path.win32.isAbsolute(options.savedPath))) {
    throw imageError('ERR_DELIVERY_PATH', '交付图片路径无效');
  }
  if (!IMAGE_ROUTES.has(options.route)) throw imageError('ERR_IMAGE_ROUTE', '图片 route 无效');
  const lines = [
    '请根据下面这张截图协助我。',
    '',
    `图片路径：${options.savedPath}`
  ];
  if (typeof options.ocrText === 'string' && options.ocrText) {
    const bounded = truncateUtf8(options.ocrText, LIMITS.maxOcrTextBytes);
    lines.push('', 'OCR 文本：', bounded.text);
  }
  const result = lines.join('\n');
  if (result.trimStart().startsWith('/') || Buffer.byteLength(result, 'utf8') > LIMITS.maxDeliveryBytes) {
    throw imageError('ERR_DELIVERY_TEXT', '交付文本无效或超过上限');
  }
  return result;
}

module.exports = {
  LIMITS,
  STAGING_PREFIX,
  SCREENSHOT_DIRNAME,
  inspectImageHeader,
  validateDecodedImage,
  createCapture,
  reduceCapture,
  captureRendererSnapshot,
  planMacCaptureStaging,
  writeStagingPng,
  saveStagedImage,
  cleanupOwnedStaging,
  cleanupStagingFile,
  selectImageRoute,
  macCaptureCommand,
  ocrCommand,
  runBoundedOcr,
  buildDeliveryText
};
