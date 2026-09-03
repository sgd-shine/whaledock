'use strict';

// v0.10 context-poc 的固定信任根生成与校验器。构建流程只允许调用
// assertCommittedBaseline() 对账；--bless 仅供人工显式更新，禁止进入构建流程。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTEXT_POC_ROOT = path.join(ROOT, 'context-poc');
const BASELINE_PATH = path.join(ROOT, 'lib', 'context-poc-baseline.json');
const SCHEMA = 1;
const PACKAGE_NAME = '@whaledock/context-bridge-poc';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SOURCE_FILES = Object.freeze([
  'context-bridge.patch.yml',
  'FORK-NOTICE.md',
  'plugin/package.json',
  'plugin/lib/index.js',
  'plugin/lib/client.js',
  'forks/ui-layout/package.json',
  'forks/ui-layout/LICENSE',
  'forks/ui-layout/lib/index.js',
  'forks/ui-layout/lib/invariant.js',
  'forks/ui-layout/lib/client.js',
  'forks/ui-conversation/package.json',
  'forks/ui-conversation/LICENSE',
  'forks/ui-conversation/lib/index.js',
  'forks/ui-conversation/lib/invariant.js',
  'forks/ui-conversation/lib/client.js'
]);
const HASH_RE = /^[a-f0-9]{64}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function manifestDigest(files) {
  return sha256(files.map((file) => (
    `${file.path}\0${file.size}\0${file.sha256}`
  )).join('\n'));
}

function canonicalBytes(manifest) {
  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function assertDirectory(directory, label) {
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch (_error) { throw new Error(`CONTEXT_POC_MANIFEST_MISSING ${label}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`CONTEXT_POC_MANIFEST_PATH ${label}`);
  }
}

function actualTree(rootDir) {
  const resolved = path.resolve(rootDir);
  assertDirectory(resolved, 'context-poc 根目录');
  const rows = [];
  const walk = (directory) => {
    assertDirectory(directory, 'context-poc 子目录');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error('CONTEXT_POC_MANIFEST_SYMLINK context-poc 不允许符号链接');
      }
      if (stat.isDirectory()) walk(filePath);
      else if (stat.isFile()) {
        rows.push(path.relative(resolved, filePath).split(path.sep).join('/'));
      } else {
        throw new Error('CONTEXT_POC_MANIFEST_PATH context-poc 不允许特殊文件');
      }
    }
  };
  walk(resolved);
  return rows.sort((left, right) => left.localeCompare(right));
}

function assertExactTree(rootDir) {
  const expected = [...SOURCE_FILES].sort((left, right) => left.localeCompare(right));
  const actual = actualTree(rootDir);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `CONTEXT_POC_MANIFEST_TREE expected=${expected.length} actual=${actual.length}`
    );
  }
  return path.resolve(rootDir);
}

function createManifest(rootDir = CONTEXT_POC_ROOT) {
  const resolved = assertExactTree(rootDir);
  const files = [];
  let totalBytes = 0;
  for (const relative of SOURCE_FILES) {
    const filePath = path.join(resolved, ...relative.split('/'));
    const statBefore = fs.lstatSync(filePath);
    if (!statBefore.isFile() || statBefore.isSymbolicLink()
        || !Number.isSafeInteger(statBefore.size) || statBefore.size < 1
        || statBefore.size > MAX_FILE_BYTES) {
      throw new Error(`CONTEXT_POC_MANIFEST_FILE ${relative}`);
    }
    const data = fs.readFileSync(filePath);
    const statAfter = fs.lstatSync(filePath);
    if (!statAfter.isFile() || statAfter.isSymbolicLink()
        || statAfter.size !== statBefore.size || data.length !== statBefore.size) {
      throw new Error(`CONTEXT_POC_MANIFEST_RACE ${relative}`);
    }
    totalBytes += data.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('CONTEXT_POC_MANIFEST_TOTAL context-poc 超过 8 MiB');
    }
    files.push(Object.freeze({
      path: relative,
      size: data.length,
      sha256: sha256(data)
    }));
  }
  return Object.freeze({
    schema: SCHEMA,
    package: PACKAGE_NAME,
    files: Object.freeze(files),
    totalBytes,
    digest: manifestDigest(files)
  });
}

function validateBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'digest,files,package,schema,totalBytes'
      || value.schema !== SCHEMA || value.package !== PACKAGE_NAME
      || !Array.isArray(value.files) || value.files.length !== SOURCE_FILES.length
      || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 1
      || value.totalBytes > MAX_TOTAL_BYTES || !HASH_RE.test(value.digest || '')) {
    throw new Error('CONTEXT_POC_BASELINE_SCHEMA 固定信任根无效');
  }
  let totalBytes = 0;
  const normalized = [];
  for (let index = 0; index < SOURCE_FILES.length; index += 1) {
    const file = value.files[index];
    if (!file || typeof file !== 'object' || Array.isArray(file)
        || Object.keys(file).sort().join(',') !== 'path,sha256,size'
        || file.path !== SOURCE_FILES[index]
        || !Number.isSafeInteger(file.size) || file.size < 1
        || file.size > MAX_FILE_BYTES || !HASH_RE.test(file.sha256 || '')) {
      throw new Error('CONTEXT_POC_BASELINE_SCHEMA 固定信任根文件记录无效');
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('CONTEXT_POC_BASELINE_SCHEMA 固定信任根超过 8 MiB');
    }
    normalized.push(Object.freeze({
      path: file.path,
      size: file.size,
      sha256: file.sha256
    }));
  }
  if (totalBytes !== value.totalBytes || manifestDigest(normalized) !== value.digest) {
    throw new Error('CONTEXT_POC_BASELINE_DIGEST 固定信任根摘要无效');
  }
  return Object.freeze({
    schema: SCHEMA,
    package: PACKAGE_NAME,
    files: Object.freeze(normalized),
    totalBytes,
    digest: value.digest
  });
}

function readBaseline(baselinePath = BASELINE_PATH) {
  let raw;
  let parsed;
  try {
    raw = fs.readFileSync(path.resolve(baselinePath));
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`CONTEXT_POC_BASELINE_READ ${error.message}`);
  }
  const baseline = validateBaseline(parsed);
  if (!raw.equals(canonicalBytes(baseline))) {
    throw new Error('CONTEXT_POC_BASELINE_BYTES 固定信任根不是规范字节');
  }
  return baseline;
}

function assertManifestMatches(baseline, actual) {
  const trusted = validateBaseline(baseline);
  const observed = validateBaseline(actual);
  if (!canonicalBytes(trusted).equals(canonicalBytes(observed))) {
    throw new Error(
      `CONTEXT_POC_BASELINE_MISMATCH expected=${trusted.digest} actual=${observed.digest}`
    );
  }
  return observed;
}

function assertCommittedBaseline(options = {}) {
  const baselinePath = path.resolve(options.baselinePath || BASELINE_PATH);
  const rootDir = path.resolve(options.rootDir || CONTEXT_POC_ROOT);
  const baseline = readBaseline(baselinePath);
  const actual = createManifest(rootDir);
  assertManifestMatches(baseline, actual);
  return Object.freeze({
    files: actual.files.length,
    totalBytes: actual.totalBytes,
    digest: actual.digest,
    baselinePath,
    rootDir
  });
}

function blessBaseline(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('CONTEXT_POC_BLESS_ARGS bless 参数无效');
  }
  const rootSpecified = Object.prototype.hasOwnProperty.call(options, 'rootDir');
  const baselineSpecified = Object.prototype.hasOwnProperty.call(options, 'baselinePath');
  if (rootSpecified !== baselineSpecified) {
    throw new Error('CONTEXT_POC_BLESS_ARGS --root 与 --baseline 必须成对提供');
  }
  if ((rootSpecified && (typeof options.rootDir !== 'string' || !options.rootDir.trim()))
      || (baselineSpecified
        && (typeof options.baselinePath !== 'string' || !options.baselinePath.trim()))) {
    throw new Error('CONTEXT_POC_BLESS_ARGS bless 路径不能为空');
  }

  const rootDir = path.resolve(options.rootDir || CONTEXT_POC_ROOT);
  const baselinePath = path.resolve(options.baselinePath || BASELINE_PATH);
  const baselineDir = path.dirname(baselinePath);
  assertDirectory(baselineDir, 'baseline 目录');
  const baselineStat = fs.lstatSync(baselinePath);
  if (!baselineStat.isFile() || baselineStat.isSymbolicLink()) {
    throw new Error('CONTEXT_POC_BLESS_PATH baseline 必须是普通文件');
  }

  const previous = readBaseline(baselinePath);
  const next = createManifest(rootDir);
  const bytes = canonicalBytes(next);
  const mode = baselineStat.mode & 0o777;
  const tempPath = path.join(
    baselineDir,
    `.${path.basename(baselinePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx', mode || 0o644);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;

    const staged = readBaseline(tempPath);
    assertManifestMatches(staged, next);
    const stillCurrent = readBaseline(baselinePath);
    if (!canonicalBytes(stillCurrent).equals(canonicalBytes(previous))) {
      throw new Error('CONTEXT_POC_BLESS_RACE baseline 在写入期间发生变化');
    }

    fs.renameSync(tempPath, baselinePath);
    const receipt = assertCommittedBaseline({ rootDir, baselinePath });
    return Object.freeze({
      oldDigest: previous.digest,
      newDigest: receipt.digest,
      files: receipt.files,
      totalBytes: receipt.totalBytes,
      baselinePath,
      rootDir
    });
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_error) {}
    }
    try { fs.rmSync(tempPath, { force: true }); } catch (_error) {}
  }
}

function verifyPackagedResources(resourcesPath) {
  if (typeof resourcesPath !== 'string' || !resourcesPath.trim()) {
    throw new Error('CONTEXT_POC_RESOURCES_ARGS 缺少成品 Resources 目录');
  }
  const resolvedResources = path.resolve(resourcesPath);
  assertDirectory(resolvedResources, '成品 Resources 目录');
  const baselinePath = BASELINE_PATH;
  const rootDir = path.join(resolvedResources, 'context-poc');
  const baseline = readBaseline(baselinePath);
  const actual = createManifest(rootDir);
  assertManifestMatches(baseline, actual);
  return Object.freeze({
    files: actual.files.length,
    totalBytes: actual.totalBytes,
    digest: actual.digest,
    baselinePath,
    resourcesPath: resolvedResources,
    rootDir
  });
}

function parseArgs(argv) {
  const result = {
    mode: 'check',
    rootDir: CONTEXT_POC_ROOT,
    baselinePath: BASELINE_PATH,
    resourcesPath: null
  };
  let explicitMode = null;
  let rootSpecified = false;
  let baselineSpecified = false;
  for (const value of argv) {
    if (value === '--check' || value === '--print' || value === '--bless') {
      if (explicitMode) {
        throw new Error('CONTEXT_POC_MANIFEST_ARGS 只能选择一种模式');
      }
      explicitMode = value;
      result.mode = value.slice(2);
    } else if (value.startsWith('--resources=')) {
      const resourcesPath = value.slice('--resources='.length);
      if (!resourcesPath || explicitMode) {
        throw new Error('CONTEXT_POC_MANIFEST_ARGS --resources 必须单独指定一次');
      }
      explicitMode = '--resources';
      result.mode = 'resources';
      result.resourcesPath = path.resolve(resourcesPath);
    } else if (value.startsWith('--root=')) {
      const rootDir = value.slice('--root='.length);
      if (rootSpecified || !rootDir.trim()) {
        throw new Error('CONTEXT_POC_MANIFEST_ARGS --root 必须且只能指定一次');
      }
      rootSpecified = true;
      result.rootDir = path.resolve(rootDir);
    }
    else if (value.startsWith('--baseline=')) {
      const baselinePath = value.slice('--baseline='.length);
      if (baselineSpecified || !baselinePath.trim()) {
        throw new Error('CONTEXT_POC_MANIFEST_ARGS --baseline 必须且只能指定一次');
      }
      baselineSpecified = true;
      result.baselinePath = path.resolve(baselinePath);
    }
    else throw new Error(`CONTEXT_POC_MANIFEST_ARGS 未知参数：${value}`);
  }
  if (result.mode === 'resources' && (rootSpecified || baselineSpecified)) {
    throw new Error('CONTEXT_POC_MANIFEST_ARGS --resources 只使用 committed baseline');
  }
  if (result.mode === 'bless' && rootSpecified !== baselineSpecified) {
    throw new Error('CONTEXT_POC_MANIFEST_ARGS --bless 的 --root 与 --baseline 必须成对提供');
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.mode === 'print') {
    process.stdout.write(canonicalBytes(createManifest(args.rootDir)));
    return;
  }
  if (args.mode === 'resources') {
    const result = verifyPackagedResources(args.resourcesPath);
    console.log(
      `CONTEXT_POC_RESOURCES_VERIFIED files=${result.files} bytes=${result.totalBytes} digest=${result.digest}`
    );
    return;
  }
  if (args.mode === 'bless') {
    const result = blessBaseline(args);
    console.log(`BLESS ${result.oldDigest} -> ${result.newDigest}`);
    return;
  }
  const result = assertCommittedBaseline(args);
  console.log(
    `CONTEXT_POC_BASELINE_PASS files=${result.files} bytes=${result.totalBytes} digest=${result.digest}`
  );
}

module.exports = Object.freeze({
  SCHEMA,
  PACKAGE_NAME,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  SOURCE_FILES,
  CONTEXT_POC_ROOT,
  BASELINE_PATH,
  sha256,
  manifestDigest,
  canonicalBytes,
  actualTree,
  assertExactTree,
  createManifest,
  validateBaseline,
  readBaseline,
  assertManifestMatches,
  assertCommittedBaseline,
  blessBaseline,
  verifyPackagedResources,
  parseArgs,
  main
});

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error && error.stack || error);
    process.exit(1);
  }
}
