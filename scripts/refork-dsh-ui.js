'use strict';

// 从固定 npm tarball 机械重建 v0.10 的两个 dsh UI fork。
// 本脚本只使用 Node 标准库：先在内存/临时目录完成全部校验，再替换 forks。

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOCK_PATH = path.join(DEFAULT_ROOT, 'refork', 'dsh-ui', 'upstream-lock.json');
const REDISTRIBUTION_FILES = Object.freeze([
  'package.json',
  'LICENSE',
  'lib/index.js',
  'lib/invariant.js',
  'lib/client.js'
]);
const PACKAGE_SPECS = Object.freeze({
  'ui-layout': Object.freeze({
    name: '@deepseek-ai/dsh-client-ui-layout',
    forkPath: 'context-poc/forks/ui-layout',
    budget: 300
  }),
  'ui-conversation': Object.freeze({
    name: '@deepseek-ai/dsh-client-ui-conversation',
    forkPath: 'context-poc/forks/ui-conversation',
    budget: 50
  })
});
const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_ARCHIVE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_CONTEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_DEADLINE_MS = 15000;
const HASH_RE = /^[a-f0-9]{64}$/;

function reforkError(kind, message) {
  const error = new Error(`REFORK_DSH_UI_${kind} ${message}`);
  error.code = `REFORK_DSH_UI_${kind}`;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha512Integrity(value) {
  return `sha512-${crypto.createHash('sha512').update(value).digest('base64')}`;
}

function canonicalJson(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.startsWith('/')
      || value.startsWith('\\') || /^[A-Za-z]:/.test(value) || value.includes('\\')) {
    throw reforkError('PATH', `${label} 不是安全相对路径：${String(value)}`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw reforkError('PATH', `${label} 含空段或穿越段：${value}`);
  }
  return value;
}

function assertRealDirectory(directory, label, fsImpl = fs) {
  let stat;
  try { stat = fsImpl.lstatSync(directory); }
  catch (_error) { throw reforkError('PATH', `${label} 不存在：${directory}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw reforkError('PATH', `${label} 必须是真实目录：${directory}`);
  }
}

function assertRealFile(filePath, label, fsImpl = fs) {
  let stat;
  try { stat = fsImpl.lstatSync(filePath); }
  catch (_error) { throw reforkError('PATH', `${label} 不存在：${filePath}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw reforkError('PATH', `${label} 必须是普通文件：${filePath}`);
  }
  return stat;
}

function stableFileBytes(filePath, label, fsImpl = fs) {
  const before = assertRealFile(filePath, label, fsImpl);
  const bytes = fsImpl.readFileSync(filePath);
  const after = assertRealFile(filePath, label, fsImpl);
  const sameInode = !Number.isSafeInteger(before.ino) || !Number.isSafeInteger(after.ino)
    || !before.ino || !after.ino || before.ino === after.ino;
  const sameDevice = !Number.isSafeInteger(before.dev) || !Number.isSafeInteger(after.dev)
    || before.dev === after.dev;
  if (!sameInode || !sameDevice || before.size !== after.size || bytes.length !== before.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw reforkError('RACE', `${label} 在读取期间变化：${filePath}`);
  }
  return bytes;
}

function readJson(filePath, label, fsImpl = fs) {
  try { return JSON.parse(fsImpl.readFileSync(filePath, 'utf8')); }
  catch (error) { throw reforkError('LOCK', `${label} 无法读取：${error.message}`); }
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reforkError('LOCK', `${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw reforkError('LOCK', `${label} 字段不精确 expected=${wanted.join(',')} actual=${actual.join(',')}`);
  }
}

function expectedTarballUrl(packageName, version) {
  const base = packageName.split('/').at(-1);
  return `https://registry.npmjs.org/${packageName}/-/${base}-${version}.tgz`;
}

function validateFileManifest(value, label) {
  exactKeys(value, REDISTRIBUTION_FILES, label);
  const result = {};
  for (const relative of REDISTRIBUTION_FILES) {
    const row = value[relative];
    exactKeys(row, ['size', 'sha256'], `${label}.${relative}`);
    if (!Number.isSafeInteger(row.size) || row.size < 1 || row.size > MAX_ARCHIVE_FILE_BYTES
        || !HASH_RE.test(row.sha256 || '')) {
      throw reforkError('LOCK', `${label}.${relative} 的 size/hash 无效`);
    }
    result[relative] = Object.freeze({ size: row.size, sha256: row.sha256 });
  }
  return Object.freeze(result);
}

function validateBaselineLock(value) {
  exactKeys(value, ['path', 'schema', 'package', 'fileOrder'], 'contextPocBaseline');
  if (value.path !== 'lib/context-poc-baseline.json' || value.schema !== 1
      || value.package !== '@whaledock/context-bridge-poc'
      || !Array.isArray(value.fileOrder) || value.fileOrder.length < 10
      || value.fileOrder.length > 1024) {
    throw reforkError('LOCK', 'contextPocBaseline 元数据无效');
  }
  const seen = new Set();
  for (const relative of value.fileOrder) {
    safeRelative(relative, 'contextPocBaseline.fileOrder');
    if (seen.has(relative)) throw reforkError('LOCK', `baseline 路径重复：${relative}`);
    seen.add(relative);
  }
  for (const key of Object.keys(PACKAGE_SPECS)) {
    for (const relative of REDISTRIBUTION_FILES) {
      const expected = `${PACKAGE_SPECS[key].forkPath.slice('context-poc/'.length)}/${relative}`;
      if (!seen.has(expected)) throw reforkError('LOCK', `baseline 缺少 fork 文件：${expected}`);
    }
  }
  return Object.freeze({ ...value, fileOrder: Object.freeze([...value.fileOrder]) });
}

function validatePackageLock(value, version) {
  exactKeys(value, [
    'key', 'name', 'version', 'url', 'tarballBytes', 'tarballSha256', 'integrity',
    'archiveBytes', 'archiveEntries', 'archiveTreeSha256', 'forkPath', 'budgetTotalChangedLines',
    'upstreamFiles', 'unchangedFiles', 'modifiedFiles', 'patch',
    'finalFiles', 'finalTreeSha256'
  ], 'packages[]');
  const spec = PACKAGE_SPECS[value.key];
  if (!spec || value.name !== spec.name || value.version !== version
      || value.forkPath !== spec.forkPath
      || value.budgetTotalChangedLines !== spec.budget
      || value.url !== expectedTarballUrl(value.name, version)) {
    throw reforkError('LOCK', `包身份/URL/预算不符合固定合同：${String(value.key)}`);
  }
  try {
    const parsed = new URL(value.url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'registry.npmjs.org'
        || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('not exact registry URL');
    }
  } catch (_error) {
    throw reforkError('LOCK', `${value.key} tarball URL 非固定 npm HTTPS URL`);
  }
  if (!Number.isSafeInteger(value.tarballBytes) || value.tarballBytes < 1
      || value.tarballBytes > MAX_DOWNLOAD_BYTES || !HASH_RE.test(value.tarballSha256 || '')
      || typeof value.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity)
      || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes < 1024
      || value.archiveBytes > MAX_EXPANDED_BYTES || value.archiveBytes % 512 !== 0
      || !Number.isSafeInteger(value.archiveEntries) || value.archiveEntries < 5
      || value.archiveEntries > MAX_ARCHIVE_ENTRIES
      || !HASH_RE.test(value.archiveTreeSha256 || '')) {
    throw reforkError('LOCK', `${value.key} tarball/archive 固定身份无效`);
  }
  const unchanged = value.unchangedFiles;
  const modified = value.modifiedFiles;
  if (!Array.isArray(unchanged) || !Array.isArray(modified)
      || JSON.stringify([...unchanged].sort()) !== JSON.stringify([
        'LICENSE', 'lib/index.js', 'lib/invariant.js'
      ].sort())
      || JSON.stringify([...modified].sort()) !== JSON.stringify([
        'package.json', 'lib/client.js'
      ].sort())) {
    throw reforkError('LOCK', `${value.key} changed/unchanged 文件合同无效`);
  }
  exactKeys(value.patch, ['format', 'path', 'sha256'], `${value.key}.patch`);
  const expectedPatchPath = `refork/dsh-ui/${value.key}.patch`;
  if (value.patch.format !== 'unified-v1' || value.patch.path !== expectedPatchPath
      || !HASH_RE.test(value.patch.sha256 || '')) {
    throw reforkError('LOCK', `${value.key} patch 路径或摘要无效`);
  }
  const upstreamFiles = validateFileManifest(value.upstreamFiles, `${value.key}.upstreamFiles`);
  const finalFiles = validateFileManifest(value.finalFiles, `${value.key}.finalFiles`);
  if (!HASH_RE.test(value.finalTreeSha256 || '')) {
    throw reforkError('LOCK', `${value.key}.finalTreeSha256 无效`);
  }
  return Object.freeze({
    ...value,
    upstreamFiles,
    finalFiles,
    unchangedFiles: Object.freeze([...unchanged]),
    modifiedFiles: Object.freeze([...modified]),
    patch: Object.freeze({ ...value.patch })
  });
}

function hydratePatches(root, versionPlan, fsImpl = fs) {
  const packages = versionPlan.packages.map((packagePlan) => {
    const patchPath = path.join(root, ...packagePlan.patch.path.split('/'));
    const stat = assertRealFile(patchPath, `${packagePlan.key} patch`, fsImpl);
    if (stat.size < 1 || stat.size > MAX_PATCH_BYTES) {
      throw reforkError('PATCH_IDENTITY', `${packagePlan.key} patch 大小无效：${stat.size}`);
    }
    const bytes = fsImpl.readFileSync(patchPath);
    const after = assertRealFile(patchPath, `${packagePlan.key} patch`, fsImpl);
    if (bytes.length !== stat.size || after.size !== stat.size
        || (Number.isSafeInteger(stat.ino) && Number.isSafeInteger(after.ino) && after.ino !== stat.ino)
        || after.mtimeMs !== stat.mtimeMs || sha256(bytes) !== packagePlan.patch.sha256) {
      throw reforkError('PATCH_IDENTITY', `${packagePlan.key} patch SHA-256 漂移`);
    }
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw reforkError('PATCH_UTF8', `${packagePlan.key} patch 不是 UTF-8`);
    }
    return Object.freeze({
      ...packagePlan,
      patch: Object.freeze({ ...packagePlan.patch, text })
    });
  });
  return Object.freeze({ ...versionPlan, packages: Object.freeze(packages) });
}

function validateVersionLock(lock, version) {
  exactKeys(lock, ['schemaVersion', 'redistributionFiles', 'versions'], 'upstream lock');
  if (!lock || lock.schemaVersion !== 1
      || JSON.stringify(lock.redistributionFiles) !== JSON.stringify(REDISTRIBUTION_FILES)
      || !lock.versions || typeof lock.versions !== 'object' || Array.isArray(lock.versions)) {
    throw reforkError('LOCK', 'upstream lock schema/redistributionFiles 无效');
  }
  // 必须先完成未知版本判定，之后才允许做任何网络动作。
  const value = lock.versions[version];
  if (!value) throw reforkError('UNKNOWN_VERSION', `未锁定版本：${version}`);
  if (value.ready !== true) {
    throw reforkError('LOCK_INCOMPLETE', `${version} 的 patch/final/baseline 尚未冻结`);
  }
  exactKeys(value, ['ready', 'contextPocBaseline', 'packages'], `versions.${version}`);
  if (!Array.isArray(value.packages) || value.packages.length !== 2) {
    throw reforkError('LOCK', `${version} 必须精确包含两个 UI 包`);
  }
  const packages = value.packages.map((entry) => validatePackageLock(entry, version));
  if (JSON.stringify(packages.map((entry) => entry.key).sort())
      !== JSON.stringify(Object.keys(PACKAGE_SPECS).sort())) {
    throw reforkError('LOCK', `${version} UI 包集合不精确`);
  }
  return Object.freeze({
    version,
    packages: Object.freeze(packages),
    contextPocBaseline: validateBaselineLock(value.contextPocBaseline)
  });
}

function tarString(block, offset, length, label) {
  const bytes = block.subarray(offset, offset + length);
  const zero = bytes.indexOf(0);
  const content = bytes.subarray(0, zero < 0 ? bytes.length : zero);
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) {
    throw reforkError('TAR_HEADER', `${label} 不是 UTF-8`);
  }
  return text;
}

function tarOctal(block, offset, length, label) {
  const raw = tarString(block, offset, length, label).trim();
  if (!/^[0-7]+$/.test(raw)) throw reforkError('TAR_HEADER', `${label} 不是八进制`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw reforkError('TAR_HEADER', `${label} 数值越界`);
  }
  return value;
}

function assertTarChecksum(block) {
  const expected = tarOctal(block, 148, 8, 'header checksum');
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  if (actual !== expected) throw reforkError('TAR_CHECKSUM', 'tar header checksum 不匹配');
}

function safeArchivePath(value) {
  if (value.endsWith('/')) value = value.slice(0, -1);
  if (!value || value.startsWith('/') || value.startsWith('\\')
      || /^[A-Za-z]:/.test(value) || value.includes('\\')) {
    throw reforkError('TAR_PATH', `tar 路径不是安全相对路径：${value}`);
  }
  const parts = value.split('/');
  if (parts[0] !== 'package' || parts.length < 2
      || parts.some((part) => !part || part === '.' || part === '..')) {
    throw reforkError('TAR_TREE', `tar 只能包含 package/ 子树：${value}`);
  }
  return parts.slice(1).join('/');
}

function archiveTreeSha256(rows) {
  const material = [...rows]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map((row) => `${row.path}\0${row.type}\0${row.size}\0${row.sha256 || ''}`)
    .join('\n');
  return sha256(Buffer.from(material, 'utf8'));
}

function parseNpmTarball(tarball, options = {}) {
  if (!Buffer.isBuffer(tarball)) throw reforkError('TARBALL', 'tarball 必须是 Buffer');
  const maxExpandedBytes = options.maxExpandedBytes || MAX_EXPANDED_BYTES;
  const maxEntries = options.maxEntries || MAX_ARCHIVE_ENTRIES;
  const maxFileBytes = options.maxFileBytes || MAX_ARCHIVE_FILE_BYTES;
  let archive;
  try { archive = zlib.gunzipSync(tarball, { maxOutputLength: maxExpandedBytes }); }
  catch (error) { throw reforkError('GZIP', `gzip 解压失败或超限：${error.message}`); }
  if (!archive.length || archive.length > maxExpandedBytes || archive.length % 512 !== 0) {
    throw reforkError('TAR_SIZE', `tar 展开大小无效：${archive.length}`);
  }
  const seen = new Set();
  const files = new Map();
  const rows = [];
  let offset = 0;
  let entries = 0;
  let ended = false;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (offset + 1024 > archive.length
          || !archive.subarray(offset + 512, offset + 1024).every((byte) => byte === 0)
          || !archive.subarray(offset).every((byte) => byte === 0)) {
        throw reforkError('TAR_END', 'tar 缺少规范双零块或含尾随数据');
      }
      ended = true;
      break;
    }
    assertTarChecksum(header);
    if (tarString(header, 257, 6, 'magic') !== 'ustar'
        || tarString(header, 263, 2, 'version') !== '00') {
      throw reforkError('TAR_HEADER', 'tar 不是受支持的 ustar 格式');
    }
    const name = tarString(header, 0, 100, 'name');
    const prefix = tarString(header, 345, 155, 'prefix');
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const relative = safeArchivePath(archivePath);
    if (seen.has(relative)) throw reforkError('TAR_DUPLICATE', `tar 路径重复：${relative}`);
    seen.add(relative);
    entries += 1;
    if (entries > maxEntries) throw reforkError('TAR_ENTRIES', `tar 条目超过 ${maxEntries}`);
    const size = tarOctal(header, 124, 12, 'file size');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (type === '1' || type === '2') throw reforkError('TAR_LINK', `tar 禁止链接：${relative}`);
    if (type !== '0' && type !== '5') {
      throw reforkError('TAR_TYPE', `tar 禁止特殊条目 type=${type} path=${relative}`);
    }
    if (type === '5' && size !== 0) throw reforkError('TAR_TYPE', `目录含数据：${relative}`);
    if (type === '0' && size > maxFileBytes) {
      throw reforkError('TAR_FILE_SIZE', `tar 文件超限：${relative} size=${size}`);
    }
    const dataOffset = offset + 512;
    const padded = Math.ceil(size / 512) * 512;
    if (dataOffset + padded > archive.length) {
      throw reforkError('TAR_TRUNCATED', `tar 文件越过归档边界：${relative}`);
    }
    if (type === '0') {
      const content = Buffer.from(archive.subarray(dataOffset, dataOffset + size));
      files.set(relative, content);
      rows.push(Object.freeze({ path: relative, type, size, sha256: sha256(content) }));
    } else {
      rows.push(Object.freeze({ path: relative, type, size: 0, sha256: '' }));
    }
    offset = dataOffset + padded;
  }
  if (!ended) throw reforkError('TAR_END', 'tar 未正常结束');
  return Object.freeze({
    files,
    rows: Object.freeze(rows),
    entryCount: entries,
    expandedBytes: archive.length,
    treeSha256: archiveTreeSha256(rows)
  });
}

function verifyTarball(packagePlan, tarball) {
  if (!Buffer.isBuffer(tarball) || tarball.length !== packagePlan.tarballBytes
      || sha256(tarball) !== packagePlan.tarballSha256
      || sha512Integrity(tarball) !== packagePlan.integrity) {
    throw reforkError('TARBALL_IDENTITY', `${packagePlan.key} tarball size/SHA-256/SRI 不匹配`);
  }
  const parsed = parseNpmTarball(tarball);
  if (parsed.expandedBytes !== packagePlan.archiveBytes
      || parsed.entryCount !== packagePlan.archiveEntries
      || parsed.treeSha256 !== packagePlan.archiveTreeSha256) {
    throw reforkError('TAR_TREE', `${packagePlan.key} tar 展开大小/条目/tree hash 漂移`);
  }
  const selected = new Map();
  for (const relative of REDISTRIBUTION_FILES) {
    const content = parsed.files.get(relative);
    const expected = packagePlan.upstreamFiles[relative];
    if (!content || content.length !== expected.size || sha256(content) !== expected.sha256) {
      throw reforkError('UPSTREAM_FILE', `${packagePlan.key}/${relative} 上游文件漂移`);
    }
    selected.set(relative, content);
  }
  let manifest;
  try { manifest = JSON.parse(selected.get('package.json').toString('utf8')); }
  catch (error) { throw reforkError('UPSTREAM_IDENTITY', `${packagePlan.key} package.json 无效：${error.message}`); }
  if (manifest.name !== packagePlan.name || manifest.version !== packagePlan.version) {
    throw reforkError('UPSTREAM_IDENTITY', `${packagePlan.key} 包名/版本不匹配`);
  }
  return selected;
}

function splitPatchLines(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw reforkError('PATCH_PARSE', 'patch 不是文本');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function patchPath(value, expectedPrefix) {
  const raw = value.split('\t')[0];
  if (!raw.startsWith(expectedPrefix)) throw reforkError('PATCH_PATH', `patch 路径前缀无效：${raw}`);
  return safeRelative(raw.slice(expectedPrefix.length), 'patch path');
}

function parseUnifiedPatch(text) {
  const lines = splitPatchLines(text);
  const sections = [];
  let index = 0;
  while (index < lines.length) {
    const diff = /^diff --git a\/([^ ]+) b\/([^ ]+)$/.exec(lines[index]);
    if (!diff) throw reforkError('PATCH_PARSE', `缺少 diff --git：line=${index + 1}`);
    const diffOld = safeRelative(diff[1], 'diff old path');
    const diffNew = safeRelative(diff[2], 'diff new path');
    if (diffOld !== diffNew) throw reforkError('PATCH_PATH', '禁止 rename/copy patch');
    index += 1;
    if (index < lines.length && lines[index].startsWith('index ')) index += 1;
    if (index >= lines.length || !lines[index].startsWith('--- ')) {
      throw reforkError('PATCH_PARSE', `缺少 --- header：${diffOld}`);
    }
    const oldPath = patchPath(lines[index].slice(4), 'a/');
    index += 1;
    if (index >= lines.length || !lines[index].startsWith('+++ ')) {
      throw reforkError('PATCH_PARSE', `缺少 +++ header：${diffOld}`);
    }
    const newPath = patchPath(lines[index].slice(4), 'b/');
    index += 1;
    if (oldPath !== diffOld || newPath !== diffOld) {
      throw reforkError('PATCH_PATH', `diff/header 路径不一致：${diffOld}`);
    }
    const hunks = [];
    while (index < lines.length && !lines[index].startsWith('diff --git ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[index]);
      if (!match) throw reforkError('PATCH_PARSE', `hunk header 无效：line=${index + 1}`);
      const hunk = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        rows: []
      };
      if (![hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]
        .every(Number.isSafeInteger)
          || hunk.oldStart < 0 || hunk.oldCount < 0 || hunk.newStart < 0 || hunk.newCount < 0
          || (hunk.oldCount === 0 && hunk.newCount === 0)) {
        throw reforkError('PATCH_PARSE', `hunk 范围无效：${lines[index]}`);
      }
      index += 1;
      let oldSeen = 0;
      let newSeen = 0;
      while (oldSeen < hunk.oldCount || newSeen < hunk.newCount) {
        if (index >= lines.length) throw reforkError('PATCH_PARSE', 'hunk 被截断');
        const line = lines[index];
        const kind = line[0];
        if (![' ', '+', '-'].includes(kind)) {
          throw reforkError('PATCH_PARSE', `hunk 行前缀无效：line=${index + 1}`);
        }
        const row = { kind, text: line.slice(1), oldNoNewline: false, newNoNewline: false };
        hunk.rows.push(row);
        if (kind !== '+') oldSeen += 1;
        if (kind !== '-') newSeen += 1;
        if (oldSeen > hunk.oldCount || newSeen > hunk.newCount) {
          throw reforkError('PATCH_PARSE', 'hunk 行数超过 header');
        }
        index += 1;
        if (index < lines.length && lines[index] === '\\ No newline at end of file') {
          if (kind !== '+') row.oldNoNewline = true;
          if (kind !== '-') row.newNoNewline = true;
          index += 1;
        }
      }
      hunks.push(hunk);
    }
    if (!hunks.length) throw reforkError('PATCH_PARSE', `${diffOld} 没有 hunk`);
    sections.push(Object.freeze({ path: diffOld, hunks: Object.freeze(hunks) }));
  }
  const seen = new Set();
  for (const section of sections) {
    if (seen.has(section.path)) throw reforkError('PATCH_PARSE', `patch 文件重复：${section.path}`);
    seen.add(section.path);
  }
  return Object.freeze(sections);
}

function textLines(buffer, label) {
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) throw reforkError('PATCH_UTF8', `${label} 不是 UTF-8`);
  const finalNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

function applyPatchSection(sourceBuffer, section) {
  const source = textLines(sourceBuffer, section.path);
  const output = [];
  let cursor = 0;
  let previousOldEnd = 0;
  let previousNewEnd = 0;
  let sawOldNoNewline = false;
  let sawNewNoNewline = false;
  let newNoNewlineIndex = -1;
  for (const hunk of section.hunks) {
    const oldIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    const newIndex = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
    if (oldIndex < previousOldEnd || newIndex < previousNewEnd
        || oldIndex < cursor || oldIndex > source.lines.length) {
      throw reforkError('PATCH_ZERO_FUZZ', `${section.path} hunk 坐标越界或重叠`);
    }
    while (cursor < oldIndex) output.push(source.lines[cursor++]);
    if (output.length !== newIndex) {
      throw reforkError('PATCH_ZERO_FUZZ', `${section.path} new hunk 坐标不精确`);
    }
    let oldConsumed = 0;
    let newProduced = 0;
    for (const row of hunk.rows) {
      if (row.kind !== '+') {
        if (cursor >= source.lines.length || source.lines[cursor] !== row.text) {
          throw reforkError('PATCH_ZERO_FUZZ', `${section.path} line=${cursor + 1} 上下文不精确`);
        }
        cursor += 1;
        oldConsumed += 1;
      }
      if (row.kind !== '-') {
        output.push(row.text);
        newProduced += 1;
      }
      if (row.oldNoNewline) {
        if (sawOldNoNewline || source.finalNewline || cursor !== source.lines.length) {
          throw reforkError('PATCH_NEWLINE', `${section.path} old EOF marker 无效`);
        }
        sawOldNoNewline = true;
      }
      if (row.newNoNewline) {
        if (sawNewNoNewline || row.kind === '-') {
          throw reforkError('PATCH_NEWLINE', `${section.path} new EOF marker 无效`);
        }
        sawNewNoNewline = true;
        newNoNewlineIndex = output.length - 1;
      }
    }
    if (oldConsumed !== hunk.oldCount || newProduced !== hunk.newCount) {
      throw reforkError('PATCH_PARSE', `${section.path} hunk 行数不匹配`);
    }
    previousOldEnd = oldIndex + hunk.oldCount;
    previousNewEnd = newIndex + hunk.newCount;
  }
  while (cursor < source.lines.length) output.push(source.lines[cursor++]);
  const touchedOldEof = section.hunks.some((hunk) => {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    return hunk.oldCount > 0 && start + hunk.oldCount === source.lines.length;
  });
  if (!source.finalNewline && touchedOldEof && !sawOldNoNewline) {
    throw reforkError('PATCH_NEWLINE', `${section.path} 缺少 old EOF marker`);
  }
  if (sawNewNoNewline && newNoNewlineIndex !== output.length - 1) {
    throw reforkError('PATCH_NEWLINE', `${section.path} new EOF marker 不在末行`);
  }
  let finalNewline = source.finalNewline;
  if (sawNewNoNewline) finalNewline = false;
  else if (sawOldNoNewline) finalNewline = true;
  return Buffer.from(output.join('\n') + (finalNewline ? '\n' : ''), 'utf8');
}

function applyUnifiedPatch(upstreamFiles, packagePlan) {
  if (sha256(Buffer.from(packagePlan.patch.text, 'utf8')) !== packagePlan.patch.sha256) {
    throw reforkError('PATCH_IDENTITY', `${packagePlan.key} patch SHA-256 漂移`);
  }
  const sections = parseUnifiedPatch(packagePlan.patch.text);
  const actualPaths = sections.map((section) => section.path).sort();
  const expectedPaths = [...packagePlan.modifiedFiles].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw reforkError('PATCH_SCOPE', `${packagePlan.key} patch 文件集合不精确`);
  }
  const output = new Map([...upstreamFiles].map(([name, content]) => [name, Buffer.from(content)]));
  for (const section of sections) {
    if (!output.has(section.path)) throw reforkError('PATCH_SCOPE', `patch 路径不在再分发清单：${section.path}`);
    output.set(section.path, applyPatchSection(output.get(section.path), section));
  }
  for (const relative of packagePlan.unchangedFiles) {
    if (!output.get(relative).equals(upstreamFiles.get(relative))) {
      throw reforkError('UNCHANGED', `${packagePlan.key}/${relative} 非改动文件发生变化`);
    }
  }
  return output;
}

function fileRows(files) {
  return REDISTRIBUTION_FILES.map((relative) => {
    const content = files.get(relative);
    if (!content) throw reforkError('TREE', `缺少再分发文件：${relative}`);
    return Object.freeze({ path: relative, size: content.length, sha256: sha256(content) });
  });
}

function treeSha256(rows) {
  return sha256(Buffer.from(rows.map((row) => `${row.path}\0${row.size}\0${row.sha256}`).join('\n')));
}

function verifyFinalFiles(packagePlan, files) {
  if (!(files instanceof Map) || files.size !== REDISTRIBUTION_FILES.length) {
    throw reforkError('FINAL_TREE', `${packagePlan.key} 最终文件集合不精确`);
  }
  for (const relative of REDISTRIBUTION_FILES) {
    const content = files.get(relative);
    const expected = packagePlan.finalFiles[relative];
    if (!content || content.length !== expected.size || sha256(content) !== expected.sha256) {
      throw reforkError('FINAL_HASH', `${packagePlan.key}/${relative} 最终 hash 不匹配`);
    }
  }
  const rows = fileRows(files);
  if (treeSha256(rows) !== packagePlan.finalTreeSha256) {
    throw reforkError('FINAL_TREE', `${packagePlan.key} 最终 tree hash 不匹配`);
  }
  let manifest;
  try { manifest = JSON.parse(files.get('package.json').toString('utf8')); }
  catch (error) { throw reforkError('FINAL_IDENTITY', `${packagePlan.key} 最终 package.json 无效：${error.message}`); }
  if (manifest.name !== packagePlan.name || manifest.version !== packagePlan.version) {
    throw reforkError('FINAL_IDENTITY', `${packagePlan.key} 最终包名/版本漂移`);
  }
  return rows;
}

function lineTokens(buffer, label) {
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) throw reforkError('PATCH_UTF8', `${label} 不是 UTF-8`);
  const tokens = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      tokens.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) tokens.push(text.slice(start));
  return tokens;
}

function myersDistance(left, right, maxDistance = left.length + right.length) {
  const maximum = left.length + right.length;
  let frontier = new Map([[1, 0]]);
  for (let distance = 0; distance <= Math.min(maximum, maxDistance); distance += 1) {
    const next = new Map();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.has(diagonal + 1) ? frontier.get(diagonal + 1) : -1;
      const across = frontier.has(diagonal - 1) ? frontier.get(diagonal - 1) : -1;
      let x = diagonal === -distance || (diagonal !== distance && across < down)
        ? down : across + 1;
      if (x < 0) x = 0;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      next.set(diagonal, x);
      if (x >= left.length && y >= right.length) return distance;
    }
    frontier = next;
  }
  return null;
}

function changedLineCounts(upstream, final, label, maxTotal) {
  const left = lineTokens(upstream, `${label} upstream client`);
  const right = lineTokens(final, `${label} final client`);
  const total = myersDistance(
    left,
    right,
    Number.isSafeInteger(maxTotal) && maxTotal >= 0 ? maxTotal : left.length + right.length
  );
  if (total === null) {
    return Object.freeze({ insertions: null, deletions: null, total: maxTotal + 1, exceeds: true });
  }
  const insertions = (total + right.length - left.length) / 2;
  const deletions = total - insertions;
  if (!Number.isInteger(insertions) || !Number.isInteger(deletions)) {
    throw reforkError('DIFF', `${label} diff 计数非整数`);
  }
  return Object.freeze({ insertions, deletions, total, exceeds: false });
}

function buildPackage(packagePlan, tarball) {
  const upstream = verifyTarball(packagePlan, tarball);
  const final = applyUnifiedPatch(upstream, packagePlan);
  verifyFinalFiles(packagePlan, final);
  const diff = changedLineCounts(
    upstream.get('lib/client.js'),
    final.get('lib/client.js'),
    packagePlan.key,
    packagePlan.budgetTotalChangedLines
  );
  if (diff.exceeds || diff.total > packagePlan.budgetTotalChangedLines) {
    const detail = diff.exceeds
      ? `total>${packagePlan.budgetTotalChangedLines}`
      : `${diff.insertions}+/${diff.deletions}- total=${diff.total}`;
    throw reforkError('BUDGET', `${packagePlan.key} client diff ${detail} budget=${packagePlan.budgetTotalChangedLines}`);
  }
  return Object.freeze({ packagePlan, upstream, final, diff });
}

function readExactFork(root, packagePlan, fsImpl = fs) {
  const directory = path.join(root, ...packagePlan.forkPath.split('/'));
  assertRealDirectory(directory, `${packagePlan.key} fork`, fsImpl);
  const actual = [];
  const walk = (current, prefix = '') => {
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fsImpl.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw reforkError('CURRENT_TREE', `${packagePlan.key} fork 含符号链接`);
      if (stat.isDirectory()) walk(filePath, relative);
      else if (stat.isFile()) actual.push(relative);
      else throw reforkError('CURRENT_TREE', `${packagePlan.key} fork 含特殊文件`);
    }
  };
  walk(directory);
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...REDISTRIBUTION_FILES].sort())) {
    throw reforkError('CURRENT_TREE', `${packagePlan.key} fork 文件集合不精确`);
  }
  const files = new Map();
  for (const relative of REDISTRIBUTION_FILES) {
    const filePath = path.join(directory, ...relative.split('/'));
    assertRealFile(filePath, `${packagePlan.key}/${relative}`, fsImpl);
    files.set(relative, fsImpl.readFileSync(filePath));
  }
  return files;
}

function scanContextPoc(root, builds, fsImpl = fs) {
  const contextRoot = path.join(root, 'context-poc');
  assertRealDirectory(contextRoot, 'context-poc', fsImpl);
  const replacements = new Map();
  const skippedDirectories = new Set();
  for (const build of builds) {
    const relativeRoot = build.packagePlan.forkPath.slice('context-poc/'.length);
    skippedDirectories.add(relativeRoot);
    for (const [relative, content] of build.final) {
      replacements.set(`${relativeRoot}/${relative}`, content);
    }
  }
  const files = new Map(replacements);
  const walk = (directory, prefix = '') => {
    for (const entry of fsImpl.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skippedDirectories.has(relative)) continue;
      const filePath = path.join(directory, entry.name);
      const stat = fsImpl.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw reforkError('BASELINE_TREE', `context-poc 含符号链接：${relative}`);
      if (stat.isDirectory()) walk(filePath, relative);
      else if (stat.isFile()) {
        if (stat.size < 1 || stat.size > MAX_CONTEXT_FILE_BYTES) {
          throw reforkError('BASELINE_TREE', `context-poc 文件大小无效：${relative}`);
        }
        files.set(relative, stableFileBytes(filePath, `context-poc/${relative}`, fsImpl));
      } else throw reforkError('BASELINE_TREE', `context-poc 含特殊文件：${relative}`);
    }
  };
  walk(contextRoot);
  return files;
}

function buildContextBaseline(root, builds, baselineLock, fsImpl = fs) {
  const files = scanContextPoc(root, builds, fsImpl);
  const actualPaths = [...files.keys()].sort();
  const expectedPaths = [...baselineLock.fileOrder].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw reforkError('BASELINE_TREE', `context-poc 文件集合漂移 expected=${expectedPaths.length} actual=${actualPaths.length}`);
  }
  let totalBytes = 0;
  const rows = baselineLock.fileOrder.map((relative) => {
    const content = files.get(relative);
    if (!content || content.length < 1 || content.length > MAX_CONTEXT_FILE_BYTES) {
      throw reforkError('BASELINE_TREE', `baseline 文件无效：${relative}`);
    }
    totalBytes += content.length;
    if (totalBytes > MAX_CONTEXT_TOTAL_BYTES) throw reforkError('BASELINE_TREE', 'context-poc 超过 8 MiB');
    return { path: relative, size: content.length, sha256: sha256(content) };
  });
  const digest = sha256(Buffer.from(rows.map((row) => (
    `${row.path}\0${row.size}\0${row.sha256}`
  )).join('\n')));
  const manifest = {
    schema: baselineLock.schema,
    package: baselineLock.package,
    files: rows,
    totalBytes,
    digest
  };
  const bytes = canonicalJson(manifest);
  return Object.freeze({ manifest, bytes });
}

function contextInputSnapshot(root, versionPlan, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const contextRoot = path.join(root, 'context-poc');
  const forksRoot = options.forksPath || path.join(contextRoot, 'forks');
  const baselinePath = options.baselinePath
    || path.join(root, ...versionPlan.contextPocBaseline.path.split('/'));
  assertRealDirectory(contextRoot, 'context-poc', fsImpl);
  assertRealDirectory(forksRoot, 'context-poc forks snapshot', fsImpl);
  const files = new Map();
  let totalBytes = 0;
  const addFile = (filePath, relative) => {
    const stat = fsImpl.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw reforkError('BASELINE_TREE', `context-poc 含符号链接：${relative}`);
    }
    if (!stat.isFile()) throw reforkError('BASELINE_TREE', `context-poc 含特殊文件：${relative}`);
    if (stat.size < 1 || stat.size > MAX_CONTEXT_FILE_BYTES) {
      throw reforkError('BASELINE_TREE', `context-poc 文件大小无效：${relative}`);
    }
    const bytes = stableFileBytes(filePath, `context-poc snapshot/${relative}`, fsImpl);
    totalBytes += bytes.length;
    if (totalBytes > MAX_CONTEXT_TOTAL_BYTES) {
      throw reforkError('BASELINE_TREE', 'context-poc 超过 8 MiB');
    }
    files.set(relative, bytes);
  };
  const walk = (directory, prefix, skipForks) => {
    for (const entry of fsImpl.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filePath = path.join(directory, entry.name);
      const stat = fsImpl.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw reforkError('BASELINE_TREE', `context-poc 含符号链接：${relative}`);
      }
      if (skipForks && !prefix && entry.name === 'forks') {
        if (!stat.isDirectory()) throw reforkError('BASELINE_TREE', 'context-poc/forks 必须是真实目录');
        continue;
      }
      if (stat.isDirectory()) walk(filePath, relative, false);
      else addFile(filePath, relative);
    }
  };
  walk(contextRoot, '', true);
  walk(forksRoot, 'forks', false);
  const actualPaths = [...files.keys()].sort();
  const expectedPaths = [...versionPlan.contextPocBaseline.fileOrder].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw reforkError('BASELINE_TREE', `context-poc snapshot 文件集合漂移 expected=${expectedPaths.length} actual=${actualPaths.length}`);
  }
  const rows = versionPlan.contextPocBaseline.fileOrder.map((relative) => {
    const bytes = files.get(relative);
    return Object.freeze({ path: relative, size: bytes.length, sha256: sha256(bytes) });
  });
  const baselineBytes = stableFileBytes(baselinePath, 'context-poc baseline snapshot', fsImpl);
  const material = rows.map((row) => `${row.path}\0${row.size}\0${row.sha256}`);
  material.push(`@baseline\0${baselineBytes.length}\0${sha256(baselineBytes)}`);
  return Object.freeze({
    digest: sha256(Buffer.from(material.join('\n'))),
    rows: Object.freeze(rows),
    baselineSha256: sha256(baselineBytes)
  });
}

function assertContextSnapshot(root, versionPlan, expected, options = {}) {
  const actual = contextInputSnapshot(root, versionPlan, options);
  if (!expected || actual.digest !== expected.digest) {
    throw reforkError('RACE', '提交绑定的完整 context-poc 输入已变化');
  }
  return actual;
}

function verifyCurrentForks(root, builds, fsImpl = fs) {
  for (const build of builds) {
    const current = readExactFork(root, build.packagePlan, fsImpl);
    verifyFinalFiles(build.packagePlan, current);
    for (const relative of REDISTRIBUTION_FILES) {
      if (!current.get(relative).equals(build.final.get(relative))) {
        throw reforkError('CURRENT_HASH', `${build.packagePlan.key}/${relative} 与重建结果不一致`);
      }
    }
  }
}

function verifyCurrent(root, builds, baselineLock, expectedBaseline, fsImpl = fs) {
  verifyCurrentForks(root, builds, fsImpl);
  const observedBaseline = buildContextBaseline(root, [], baselineLock, fsImpl);
  if (!observedBaseline.bytes.equals(expectedBaseline.bytes)) {
    throw reforkError('CURRENT_CONTEXT', '当前完整 context-poc 输入与重建 baseline 不一致');
  }
  const baselinePath = path.join(root, ...baselineLock.path.split('/'));
  const actualBaseline = stableFileBytes(baselinePath, 'context-poc baseline', fsImpl);
  if (!actualBaseline.equals(expectedBaseline.bytes)) {
    throw reforkError('CURRENT_BASELINE', '当前 context-poc baseline 与重建预期不一致');
  }
  return Object.freeze({ baselineSha256: sha256(actualBaseline) });
}

function writeStage(root, builds, baseline, fsImpl = fs) {
  const stageRoot = fsImpl.mkdtempSync(path.join(root, '.refork-dsh-ui-stage-'));
  const stageForks = path.join(stageRoot, 'forks');
  fsImpl.mkdirSync(stageForks);
  for (const build of builds) {
    const directory = path.join(stageForks, build.packagePlan.key);
    fsImpl.mkdirSync(directory, { recursive: true });
    for (const relative of REDISTRIBUTION_FILES) {
      const destination = path.join(directory, ...relative.split('/'));
      fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
      fsImpl.writeFileSync(destination, build.final.get(relative), { flag: 'wx', mode: 0o644 });
    }
  }
  fsImpl.writeFileSync(path.join(stageRoot, 'context-poc-baseline.json'), baseline.bytes, {
    flag: 'wx', mode: 0o644
  });
  return Object.freeze({ stageRoot, stageForks });
}

function commitStage(root, versionPlan, builds, baseline, stage, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const hook = typeof options.transactionHook === 'function' ? options.transactionHook : () => {};
  const liveForks = path.join(root, 'context-poc', 'forks');
  const liveBaseline = path.join(root, ...versionPlan.contextPocBaseline.path.split('/'));
  const backupForks = path.join(stage.stageRoot, 'backup-forks');
  const backupBaseline = path.join(stage.stageRoot, 'backup-baseline.json');
  const failedForks = path.join(stage.stageRoot, 'failed-forks');
  const failedBaseline = path.join(stage.stageRoot, 'failed-baseline.json');
  const stagedBaseline = path.join(stage.stageRoot, 'context-poc-baseline.json');
  const before = options.snapshot;
  assertContextSnapshot(root, versionPlan, before, { fsImpl });
  let forksMoved = false;
  let forksInstalled = false;
  let baselineMoved = false;
  let baselineInstalled = false;
  try {
    hook('before-commit');
    fsImpl.renameSync(liveForks, backupForks);
    forksMoved = true;
    assertContextSnapshot(root, versionPlan, before, { fsImpl, forksPath: backupForks });
    hook('after-live-forks-moved');
    assertContextSnapshot(root, versionPlan, before, { fsImpl, forksPath: backupForks });
    fsImpl.renameSync(stage.stageForks, liveForks);
    forksInstalled = true;
    hook('after-forks-install');
    assertContextSnapshot(root, versionPlan, before, { fsImpl, forksPath: backupForks });
    verifyCurrentForks(root, builds, fsImpl);
    fsImpl.renameSync(liveBaseline, backupBaseline);
    baselineMoved = true;
    assertContextSnapshot(root, versionPlan, before, {
      fsImpl, forksPath: backupForks, baselinePath: backupBaseline
    });
    hook('after-live-baseline-moved');
    assertContextSnapshot(root, versionPlan, before, {
      fsImpl, forksPath: backupForks, baselinePath: backupBaseline
    });
    fsImpl.renameSync(stagedBaseline, liveBaseline);
    baselineInstalled = true;
    hook('after-baseline-install');
    assertContextSnapshot(root, versionPlan, before, {
      fsImpl, forksPath: backupForks, baselinePath: backupBaseline
    });
    verifyCurrent(root, builds, versionPlan.contextPocBaseline, baseline, fsImpl);
    hook('after-verify');
    assertContextSnapshot(root, versionPlan, before, {
      fsImpl, forksPath: backupForks, baselinePath: backupBaseline
    });
    verifyCurrent(root, builds, versionPlan.contextPocBaseline, baseline, fsImpl);
  } catch (error) {
    let preserveConcurrentOutput = false;
    try {
      if (baselineInstalled && fsImpl.existsSync(liveBaseline)) {
        try {
          if (!stableFileBytes(liveBaseline, '已安装 baseline', fsImpl).equals(baseline.bytes)) {
            preserveConcurrentOutput = true;
          }
        } catch (_identityError) {
          preserveConcurrentOutput = true;
        }
        fsImpl.renameSync(liveBaseline, failedBaseline);
        baselineInstalled = false;
      }
      if (baselineMoved && fsImpl.existsSync(backupBaseline)) {
        fsImpl.renameSync(backupBaseline, liveBaseline);
        baselineMoved = false;
      }
      if (forksInstalled && fsImpl.existsSync(liveForks)) {
        try { verifyCurrentForks(root, builds, fsImpl); }
        catch (_identityError) { preserveConcurrentOutput = true; }
        fsImpl.renameSync(liveForks, failedForks);
        forksInstalled = false;
      }
      if (forksMoved && fsImpl.existsSync(backupForks)) {
        fsImpl.renameSync(backupForks, liveForks);
        forksMoved = false;
      }
    } catch (rollbackError) {
      const failure = reforkError('ROLLBACK', `${error.message}; rollback=${rollbackError.message}`);
      // 回滚不完整时保留 staging/backup，禁止 finally 再删除唯一恢复材料。
      failure.preserveStage = true;
      throw failure;
    }
    if (preserveConcurrentOutput) {
      const failure = reforkError(
        'RACE',
        `${error.message}; 并发写入的替换树已保留在 ${stage.stageRoot}`
      );
      failure.preserveStage = true;
      throw failure;
    }
    throw error;
  }
}

async function downloadTarball(url, options = {}) {
  const maxBytes = Math.min(options.maxBytes || MAX_DOWNLOAD_BYTES, MAX_DOWNLOAD_BYTES);
  const expectedBytes = options.expectedBytes;
  const deadlineMs = options.deadlineMs === undefined
    ? DOWNLOAD_DEADLINE_MS : options.deadlineMs;
  const httpsImpl = options.httpsImpl || https;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000) {
    throw reforkError('DOWNLOAD_DEADLINE', `无效 wall-clock deadline：${deadlineMs}`);
  }
  return new Promise((resolve, reject) => {
    let request = null;
    let response = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        if (response && typeof response.destroy === 'function' && !response.destroyed) {
          response.destroy();
        }
        if (request && typeof request.destroy === 'function' && !request.destroyed) {
          request.destroy();
        }
        reject(error);
      } else resolve(value);
    };
    // 绝对期限从发起 get 前开始，覆盖 DNS、TLS、connect 和持续慢滴流。
    const deadline = setTimeout(() => {
      finish(reforkError('DOWNLOAD_TIMEOUT', `${url} 超过 ${deadlineMs}ms`));
    }, deadlineMs);
    try {
      request = httpsImpl.get(url, {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': 'WhaleDock-refork-dsh-ui/1'
        }
      }, (incoming) => {
        if (settled) {
          if (incoming && typeof incoming.destroy === 'function') incoming.destroy();
          return;
        }
        response = incoming;
        if (response.statusCode !== 200) {
          if (typeof response.resume === 'function') response.resume();
          finish(reforkError('DOWNLOAD_STATUS', `${url} HTTP ${response.statusCode}`));
          return;
        }
        const declared = Number(response.headers && response.headers['content-length']);
        if (Number.isFinite(declared) && (declared > maxBytes
            || (Number.isSafeInteger(expectedBytes) && declared !== expectedBytes))) {
          finish(reforkError('DOWNLOAD_SIZE', `${url} Content-Length=${declared}`));
          return;
        }
        const chunks = [];
        let total = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.length;
          if (total > maxBytes) {
            finish(reforkError('DOWNLOAD_SIZE', `${url} 超过 ${maxBytes} bytes`));
            return;
          }
          chunks.push(bytes);
        });
        response.once('error', (error) => finish(error));
        response.once('aborted', () => finish(reforkError('DOWNLOAD_ABORTED', url)));
        response.once('end', () => {
          if (Number.isSafeInteger(expectedBytes) && total !== expectedBytes) {
            finish(reforkError('DOWNLOAD_SIZE', `${url} bytes=${total} expected=${expectedBytes}`));
            return;
          }
          finish(null, Buffer.concat(chunks, total));
        });
      });
      if (!request || typeof request.once !== 'function') {
        finish(reforkError('DOWNLOAD_REQUEST', `${url} 未返回有效 request`));
        return;
      }
      request.once('error', (error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

async function runRefork(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const lockPath = path.resolve(options.lockPath || DEFAULT_LOCK_PATH);
  const version = String(options.version || '');
  const check = options.check === true;
  const fsImpl = options.fsImpl || fs;
  const downloader = options.download || downloadTarball;
  assertRealDirectory(root, '仓库根', fsImpl);
  const lock = readJson(lockPath, 'upstream lock', fsImpl);
  const lockedVersionPlan = validateVersionLock(lock, version);
  // patch 文件路径与摘要也必须在任何网络请求前闭环。
  const versionPlan = hydratePatches(root, lockedVersionPlan, fsImpl);
  const tarballs = [];
  // validateVersionLock 已完成未知/未冻结版本判定；网络只能出现在此后。
  for (const packagePlan of versionPlan.packages) {
    const value = await downloader(packagePlan.url, {
      maxBytes: packagePlan.tarballBytes,
      expectedBytes: packagePlan.tarballBytes,
      packagePlan
    });
    if (!Buffer.isBuffer(value) || value.length > packagePlan.tarballBytes) {
      throw reforkError('DOWNLOAD_SIZE', `${packagePlan.key} downloader 返回无效数据`);
    }
    tarballs.push(value);
  }
  const builds = versionPlan.packages.map((packagePlan, index) => (
    buildPackage(packagePlan, tarballs[index])
  ));
  const baseline = buildContextBaseline(root, builds, versionPlan.contextPocBaseline, fsImpl);
  if (check) {
    verifyCurrent(root, builds, versionPlan.contextPocBaseline, baseline, fsImpl);
    return Object.freeze({ version, check: true, builds, baseline: baseline.manifest });
  }
  // 绑定完整旧 context 输入（含 plugin、FORK-NOTICE、forks 与旧 baseline）。
  const snapshot = contextInputSnapshot(root, versionPlan, { fsImpl });
  const confirmedBaseline = buildContextBaseline(
    root, builds, versionPlan.contextPocBaseline, fsImpl
  );
  if (!confirmedBaseline.bytes.equals(baseline.bytes)) {
    throw reforkError('RACE', 'context-poc 在 baseline 生成与提交绑定之间变化');
  }
  const stage = writeStage(root, builds, baseline, fsImpl);
  let failure = null;
  try {
    for (const build of builds) {
      const stagedPlan = {
        ...build.packagePlan,
        forkPath: `forks/${build.packagePlan.key}`
      };
      const staged = readExactFork(stage.stageRoot, stagedPlan, fsImpl);
      verifyFinalFiles(build.packagePlan, staged);
    }
    commitStage(root, versionPlan, builds, baseline, stage, {
      fsImpl,
      transactionHook: options.transactionHook,
      snapshot
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!failure?.preserveStage && fsImpl.existsSync(stage.stageRoot)) {
      fsImpl.rmSync(stage.stageRoot, { recursive: true, force: false });
    }
  }
  return Object.freeze({ version, check: false, builds, baseline: baseline.manifest });
}

function parseArgs(argv, options = {}) {
  const result = { version: '', check: false };
  let sawVersion = false;
  let sawCheck = false;
  for (const value of argv) {
    if (value === '--check') {
      if (sawCheck) throw reforkError('ARGS', '--check 不得重复');
      sawCheck = true;
      result.check = true;
    } else if (value.startsWith('--version=')) {
      if (sawVersion) throw reforkError('ARGS', '--version 不得重复');
      sawVersion = true;
      result.version = value.slice('--version='.length);
      if (!result.version) throw reforkError('ARGS', '--version 不能为空');
    }
    else throw reforkError('ARGS', `未知参数：${value}`);
  }
  if (!result.version) {
    if (!result.check) {
      throw reforkError('ARGS', '用法：refork-dsh-ui.js --version=x.y.z [--check]');
    }
    const contract = options.dshContract || require('../lib/config').DSH_CONTRACT;
    if (!contract || typeof contract.packageVersion !== 'string' || !contract.packageVersion) {
      throw reforkError('ARGS', 'lib/config.DSH_CONTRACT.packageVersion 无效');
    }
    result.version = contract.packageVersion;
  }
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runRefork(args);
  const summary = result.builds.map((build) => (
    `${build.packagePlan.key}=${build.diff.insertions}+/${build.diff.deletions}-`
  )).join(' ');
  console.log(`REFORK_DSH_UI_${result.check ? 'CHECKED' : 'READY'} version=${result.version} ${summary} baseline=${result.baseline.digest}`);
}

module.exports = Object.freeze({
  REDISTRIBUTION_FILES,
  PACKAGE_SPECS,
  MAX_DOWNLOAD_BYTES,
  MAX_EXPANDED_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_FILE_BYTES,
  MAX_PATCH_BYTES,
  reforkError,
  sha256,
  sha512Integrity,
  canonicalJson,
  expectedTarballUrl,
  validateVersionLock,
  hydratePatches,
  parseNpmTarball,
  verifyTarball,
  parseUnifiedPatch,
  applyPatchSection,
  applyUnifiedPatch,
  treeSha256,
  changedLineCounts,
  buildPackage,
  buildContextBaseline,
  verifyCurrent,
  downloadTarball,
  runRefork,
  parseArgs,
  main
});

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
