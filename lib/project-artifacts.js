'use strict';

// v0.11 批次 3：项目根内 widget-result.json 与单一产物的纯 Node 安全解析。
// 返回值把仅供 main 使用的 absolutePath 与可持久化 descriptor 分开。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_FILENAME = 'widget-result.json';
const KINDS = Object.freeze(['markdown', 'text', 'image', 'html']);
const PREVIEW_KINDS = Object.freeze(['markdown', 'text', 'image']);
const LIMITS = Object.freeze({
  maxManifestBytes: 16 * 1024,
  maxRelativePathBytes: 4096,
  hashChunkBytes: 64 * 1024,
  artifactBytes: Object.freeze({
    // 文本跟现有 video-cockpit bound read 对齐；图片跟 image-input 源图门对齐。
    markdown: 512 * 1024,
    text: 512 * 1024,
    image: 20 * 1024 * 1024,
    html: 5 * 1024 * 1024
  }),
  previewBytes: Object.freeze({
    markdown: 64 * 1024,
    text: 64 * 1024,
    image: 2 * 1024 * 1024
  })
});
const ERROR_CODES = Object.freeze({
  root: 'ERR_PROJECT_ARTIFACT_ROOT',
  manifest: 'ERR_PROJECT_ARTIFACT_MANIFEST',
  path: 'ERR_PROJECT_ARTIFACT_PATH',
  symlink: 'ERR_PROJECT_ARTIFACT_SYMLINK',
  size: 'ERR_PROJECT_ARTIFACT_SIZE',
  file: 'ERR_PROJECT_ARTIFACT_FILE',
  read: 'ERR_PROJECT_ARTIFACT_READ',
  changed: 'ERR_PROJECT_ARTIFACT_CHANGED'
});
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SENSITIVE_PREVIEW_SEGMENT_RE = /^(?:node_modules|vendor|credentials?|secrets?|tokens?|passwords?|private[-_]?keys?|id_rsa(?:\.pub)?|keychain)(?:\..*)?$/i;
const PREVIEW_EXTENSION_RE = Object.freeze({
  markdown: /\.(?:md|markdown)$/i,
  text: /\.(?:txt|log|csv)$/i,
  image: /\.(?:png|jpe?g|gif|webp)$/i
});

function artifactError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required) {
  return isPlainObject(value)
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => required.includes(key));
}

function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxRelativePathBytes
      || CONTROL_RE.test(value) || value.includes('\\') || value.startsWith('/')
      || /^[A-Za-z]:\//.test(value)) {
    throw artifactError(ERROR_CODES.path, '产物 path 必须是安全的 POSIX 相对路径');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw artifactError(ERROR_CODES.path, '产物 path 不能含空段、. 或 ..');
  }
  return value;
}

function validateManifest(value) {
  if (!exactKeys(value, ['window', 'path', 'kind'])
      || !Number.isSafeInteger(value.window) || value.window < 1 || value.window > 16
      || !KINDS.includes(value.kind)) {
    throw artifactError(ERROR_CODES.manifest, 'widget-result.json 合同无效');
  }
  let relative;
  try { relative = validateRelativePath(value.path); }
  catch (error) {
    if (error && error.code === ERROR_CODES.path) throw error;
    throw artifactError(ERROR_CODES.manifest, 'widget-result.json path 无效', error);
  }
  return Object.freeze({ window: value.window, path: relative, kind: value.kind });
}

function realpath(fsImpl, value, code, message) {
  try {
    const implementation = fsImpl.realpathSync.native || fsImpl.realpathSync;
    return implementation(value);
  } catch (error) {
    throw artifactError(code, message, error);
  }
}

function lstat(fsImpl, value, code, message) {
  try { return fsImpl.lstatSync(value); }
  catch (error) { throw artifactError(code, message, error); }
}

function sameIdentity(left, right) {
  if (!left || !right) return false;
  const comparable = ['dev', 'ino'].filter((key) => (
    left[key] !== undefined && right[key] !== undefined
  ));
  if (comparable.length && comparable.some((key) => String(left[key]) !== String(right[key]))) {
    return false;
  }
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && (left.ctimeMs === undefined || right.ctimeMs === undefined
      || left.ctimeMs === right.ctimeMs);
}

function isWithin(root, candidate, pathImpl) {
  const relative = pathImpl.relative(root, candidate);
  return relative === '' || (relative !== '..'
    && !relative.startsWith(`..${pathImpl.sep}`)
    && !pathImpl.isAbsolute(relative));
}

function canonicalProjectRoot(projectRoot, options) {
  if (typeof projectRoot !== 'string' || !projectRoot || CONTROL_RE.test(projectRoot)
      || !options.pathImpl.isAbsolute(projectRoot)) {
    throw artifactError(ERROR_CODES.root, '项目根必须是绝对路径');
  }
  const suppliedStat = lstat(
    options.fsImpl, projectRoot, ERROR_CODES.root, '项目根无法检查'
  );
  if (suppliedStat.isSymbolicLink()) {
    throw artifactError(ERROR_CODES.symlink, '项目根不能是符号链接');
  }
  if (!suppliedStat.isDirectory()) {
    throw artifactError(ERROR_CODES.root, '项目根不是目录');
  }
  const resolved = options.pathImpl.resolve(realpath(
    options.fsImpl, projectRoot, ERROR_CODES.root, '项目根真实路径无法验证'
  ));
  const resolvedStat = lstat(
    options.fsImpl, resolved, ERROR_CODES.root, '项目根真实目录无法检查'
  );
  if (resolvedStat.isSymbolicLink()) {
    throw artifactError(ERROR_CODES.symlink, '项目根真实目录不能是符号链接');
  }
  if (!resolvedStat.isDirectory()) {
    throw artifactError(ERROR_CODES.root, '项目根真实路径不是目录');
  }
  if (!sameIdentity(suppliedStat, resolvedStat)) {
    throw artifactError(ERROR_CODES.changed, '项目根在验证期间发生变化');
  }
  return Object.freeze({ path: resolved, stat: resolvedStat });
}

function assertRegularFile(stat, kind) {
  if (stat.isSymbolicLink()) {
    throw artifactError(ERROR_CODES.symlink, `${kind} 不能是符号链接`);
  }
  if (!stat.isFile()) {
    throw artifactError(
      kind === 'manifest' ? ERROR_CODES.manifest : ERROR_CODES.file,
      `${kind} 必须是普通文件`
    );
  }
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
    throw artifactError(ERROR_CODES.size, `${kind} 文件大小无效`);
  }
}

function assertInsideRoot(root, candidate, options) {
  const normalized = options.pathImpl.resolve(candidate);
  if (!isWithin(root, normalized, options.pathImpl)) {
    throw artifactError(ERROR_CODES.path, '产物真实路径越出项目根');
  }
  return normalized;
}

function inspectArtifactPath(root, relative, options) {
  const parts = relative.split('/');
  let candidate = root;
  let finalStat = null;
  let finalReal = null;
  for (let index = 0; index < parts.length; index += 1) {
    candidate = options.pathImpl.join(candidate, parts[index]);
    const final = index === parts.length - 1;
    const stat = lstat(
      options.fsImpl,
      candidate,
      final ? ERROR_CODES.file : ERROR_CODES.path,
      final ? '产物文件无法检查' : '产物中间目录无法检查'
    );
    if (stat.isSymbolicLink()) {
      throw artifactError(
        ERROR_CODES.symlink,
        final ? '产物文件不能是符号链接' : '产物路径不能经过符号链接'
      );
    }
    if (final) {
      assertRegularFile(stat, 'artifact');
      finalStat = stat;
    } else if (!stat.isDirectory()) {
      throw artifactError(ERROR_CODES.path, '产物中间路径不是目录');
    }
    const resolved = realpath(
      options.fsImpl,
      candidate,
      ERROR_CODES.path,
      final ? '产物真实路径无法验证' : '产物中间目录真实路径无法验证'
    );
    assertInsideRoot(root, resolved, options);
    if (final) finalReal = options.pathImpl.resolve(resolved);
  }
  return Object.freeze({ absolutePath: finalReal, stat: finalStat });
}

function checkedFileDescriptorStat(fsImpl, descriptor, kind, maximum) {
  let stat;
  try { stat = fsImpl.fstatSync(descriptor); }
  catch (error) { throw artifactError(ERROR_CODES.read, `${kind} 文件句柄无法检查`, error); }
  assertRegularFile(stat, kind);
  if (stat.size > maximum) {
    throw artifactError(ERROR_CODES.size, `${kind} 超过大小上限`);
  }
  return stat;
}

function openReadOnly(fsImpl, file, kind) {
  const constants = fsImpl.constants || fs.constants;
  let flags = constants.O_RDONLY;
  if (process.platform !== 'win32' && Number.isInteger(constants.O_NOFOLLOW)) {
    flags |= constants.O_NOFOLLOW;
  }
  try { return fsImpl.openSync(file, flags); }
  catch (error) {
    if (error && error.code === 'ELOOP') {
      throw artifactError(ERROR_CODES.symlink, `${kind} 不能是符号链接`, error);
    }
    throw artifactError(ERROR_CODES.read, `${kind} 无法打开`, error);
  }
}

function readFromDescriptor(fsImpl, descriptor, size, consume) {
  const buffer = Buffer.alloc(Math.min(LIMITS.hashChunkBytes, Math.max(size, 1)));
  let offset = 0;
  while (offset < size) {
    const wanted = Math.min(buffer.length, size - offset);
    let count;
    try { count = fsImpl.readSync(descriptor, buffer, 0, wanted, null); }
    catch (error) { throw artifactError(ERROR_CODES.read, '产物读取失败', error); }
    if (count <= 0) throw artifactError(ERROR_CODES.changed, '文件在读取期间被截断');
    consume(buffer.subarray(0, count));
    offset += count;
  }
  let extra;
  try { extra = fsImpl.readSync(descriptor, buffer, 0, 1, null); }
  catch (error) { throw artifactError(ERROR_CODES.read, '文件尾验证失败', error); }
  if (extra !== 0) throw artifactError(ERROR_CODES.changed, '文件在读取期间增长');
}

function stableRead(file, initialStat, root, kind, maximum, options, collect) {
  assertRegularFile(initialStat, kind);
  if (initialStat.size > maximum) {
    throw artifactError(ERROR_CODES.size, `${kind} 超过大小上限`);
  }
  const initialReal = assertInsideRoot(root, realpath(
    options.fsImpl, file, ERROR_CODES.path, `${kind} 真实路径无法验证`
  ), options);
  const descriptor = openReadOnly(options.fsImpl, file, kind);
  let openedStat;
  let finishedStat;
  let collected = collect ? [] : null;
  const digest = crypto.createHash('sha256');
  let pendingError = null;
  try {
    openedStat = checkedFileDescriptorStat(options.fsImpl, descriptor, kind, maximum);
    if (!sameIdentity(initialStat, openedStat)) {
      throw artifactError(ERROR_CODES.changed, `${kind} 在打开前发生变化`);
    }
    readFromDescriptor(options.fsImpl, descriptor, openedStat.size, (chunk) => {
      if (collect) collected.push(Buffer.from(chunk));
      digest.update(chunk);
    });
    finishedStat = checkedFileDescriptorStat(options.fsImpl, descriptor, kind, maximum);
    if (!sameIdentity(openedStat, finishedStat)) {
      throw artifactError(ERROR_CODES.changed, `${kind} 在读取期间发生变化`);
    }
  } catch (error) {
    pendingError = error;
  } finally {
    try { options.fsImpl.closeSync(descriptor); }
    catch (error) {
      if (!pendingError) pendingError = artifactError(ERROR_CODES.read, `${kind} 无法关闭`, error);
    }
  }
  if (pendingError) throw pendingError;

  const finalStat = lstat(options.fsImpl, file, ERROR_CODES.changed, `${kind} 终态无法检查`);
  assertRegularFile(finalStat, kind);
  const finalReal = assertInsideRoot(root, realpath(
    options.fsImpl, file, ERROR_CODES.path, `${kind} 终态真实路径无法验证`
  ), options);
  if (initialReal !== finalReal || !sameIdentity(finishedStat, finalStat)) {
    throw artifactError(ERROR_CODES.changed, `${kind} 在终态回读时发生变化`);
  }
  return Object.freeze({
    buffer: collect ? Buffer.concat(collected, finishedStat.size) : null,
    fingerprint: Object.freeze({
      size: finishedStat.size,
      mtime: finishedStat.mtimeMs,
      sha256: digest.digest('hex')
    }),
    absolutePath: finalReal,
    stat: finalStat
  });
}

function validatePreviewRelativePath(value, kind) {
  if (!PREVIEW_KINDS.includes(kind)) {
    throw artifactError(ERROR_CODES.file, '预览类型无效');
  }
  const relative = validateRelativePath(value);
  const parts = relative.split('/');
  if (parts.some((part) => part.startsWith('.')
      || SENSITIVE_PREVIEW_SEGMENT_RE.test(part))
      || !PREVIEW_EXTENSION_RE[kind].test(parts.at(-1))) {
    throw artifactError(ERROR_CODES.path, '预览路径或扩展名不在白名单');
  }
  return relative;
}

function readProjectFile(projectRoot, relativePath, kind, supplied = {}) {
  const options = {
    fsImpl: supplied.fsImpl || fs,
    pathImpl: supplied.pathImpl || path
  };
  const relative = validatePreviewRelativePath(relativePath, kind);
  const root = canonicalProjectRoot(projectRoot, options);
  const first = inspectArtifactPath(root.path, relative, options);
  const maximum = LIMITS.previewBytes[kind];
  if (first.stat.size > maximum) {
    throw artifactError(ERROR_CODES.size, `${kind} 预览源超过大小上限`);
  }
  const read = stableRead(
    first.absolutePath, first.stat, root.path, 'preview', maximum, options, true
  );
  const second = inspectArtifactPath(root.path, relative, options);
  if (second.absolutePath !== read.absolutePath || !sameIdentity(read.stat, second.stat)) {
    throw artifactError(ERROR_CODES.changed, '预览路径在终态回读时发生变化');
  }
  const rootAfter = canonicalProjectRoot(projectRoot, options);
  if (rootAfter.path !== root.path || !sameIdentity(root.stat, rootAfter.stat)) {
    throw artifactError(ERROR_CODES.changed, '项目根在预览读取期间发生变化');
  }
  return Object.freeze({ buffer: read.buffer, fingerprint: read.fingerprint });
}

function parseManifest(buffer) {
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); }
  catch (error) {
    throw artifactError(ERROR_CODES.manifest, 'widget-result.json 不是合法 JSON', error);
  }
  return validateManifest(parsed);
}

function readProjectArtifact(projectRoot, supplied = {}) {
  const options = {
    fsImpl: supplied.fsImpl || fs,
    pathImpl: supplied.pathImpl || path
  };
  const root = canonicalProjectRoot(projectRoot, options);
  const manifestPath = options.pathImpl.join(root.path, MANIFEST_FILENAME);
  const manifestStat = lstat(
    options.fsImpl, manifestPath, ERROR_CODES.manifest, 'widget-result.json 无法检查'
  );
  assertRegularFile(manifestStat, 'manifest');
  const manifestRead = stableRead(
    manifestPath, manifestStat, root.path, 'manifest', LIMITS.maxManifestBytes, options, true
  );
  const manifest = parseManifest(manifestRead.buffer);
  const first = inspectArtifactPath(root.path, manifest.path, options);
  const maximum = LIMITS.artifactBytes[manifest.kind];
  if (first.stat.size > maximum) {
    throw artifactError(ERROR_CODES.size, `${manifest.kind} 产物超过大小上限`);
  }
  const read = stableRead(
    first.absolutePath, first.stat, root.path, 'artifact', maximum, options, false
  );
  const second = inspectArtifactPath(root.path, manifest.path, options);
  if (second.absolutePath !== read.absolutePath || !sameIdentity(read.stat, second.stat)) {
    throw artifactError(ERROR_CODES.changed, '产物路径在终态回读时发生变化');
  }
  const rootAfter = canonicalProjectRoot(projectRoot, options);
  if (rootAfter.path !== root.path || !sameIdentity(root.stat, rootAfter.stat)) {
    throw artifactError(ERROR_CODES.changed, '项目根在产物读取期间发生变化');
  }
  const descriptor = Object.freeze({
    window: manifest.window,
    path: manifest.path,
    kind: manifest.kind,
    fingerprint: read.fingerprint,
    ...(manifest.kind === 'html' ? { openMode: 'electron-child' } : {})
  });
  return Object.freeze({
    internal: Object.freeze({ absolutePath: read.absolutePath }),
    descriptor
  });
}

module.exports = Object.freeze({
  MANIFEST_FILENAME,
  KINDS,
  PREVIEW_KINDS,
  LIMITS,
  ERROR_CODES,
  validateRelativePath,
  validateManifest,
  validatePreviewRelativePath,
  readProjectFile,
  readProjectArtifact
});
