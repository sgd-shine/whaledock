'use strict';

// 将三个原生 runner 的候选 artifact 聚合成一次性合规胶囊。
// 本工具只读仓库与 artifact；所有输出必须落在系统临时目录的新目录中。

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const VERSION = '0.1.1-rc.2';
const OUTPUT_PREFIX = 'whaledock-dsh-capsule-';
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const EXPECTED_TARGETS = Object.freeze([
  'darwin/arm64',
  'darwin/x64',
  'win32/x64'
]);
const SPDX_IDS = Object.freeze([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'FTL',
  'GPL-3.0-only',
  'IJG',
  'ISC',
  'LGPL-2.0-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'Libpng',
  'MIT',
  'MPL-1.1',
  'MPL-2.0',
  'Python-2.0',
  'Zlib',
  'libtiff'
]);

function capsuleError(code, message) {
  const error = new Error(`DSH_CANDIDATE_CAPSULE_${code} ${message}`);
  error.code = `ERR_DSH_CANDIDATE_CAPSULE_${code}`;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compareNames(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function portable(value) {
  return value.split(path.sep).join('/');
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function realDirectory(requested, label) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0')) {
    throw capsuleError('PATH', `${label}路径无效`);
  }
  const resolved = path.resolve(requested);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw capsuleError('PATH', `${label}必须是真实目录：${resolved}`);
  }
  // macOS 的 os.tmpdir() 常以 /var 开头，而其规范路径是 /private/var；目录本身
  // 不是符号链接即可，后续边界判断统一使用 realpath 后的规范路径。
  return fs.realpathSync(resolved);
}

function readRegular(filePath, label, maximum = MAX_FILE_BYTES) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw capsuleError('FILE', `${label}必须是普通文件：${filePath}`);
  }
  if (stat.size < 1 || stat.size > maximum) {
    throw capsuleError('FILE', `${label}字节数异常：${stat.size}`);
  }
  const content = fs.readFileSync(filePath);
  if (content.length !== stat.size) throw capsuleError('FILE', `${label}读取期间发生变化`);
  return content;
}

function parseJson(content, label) {
  let value;
  try { value = JSON.parse(content.toString('utf8')); } catch (_error) {
    throw capsuleError('JSON', `${label}不是有效 JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw capsuleError('JSON', `${label}顶层必须是对象`);
  }
  return value;
}

function readJson(filePath, label) {
  const content = readRegular(filePath, label);
  return { content, data: parseJson(content, label) };
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const artifacts = [];
  const values = new Map();
  const supported = new Set(['artifact', 'candidate-dir', 'expected-commit', 'output-dir', 'repository-root']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    let name;
    let value;
    const equal = token.match(/^--([^=]+)=(.+)$/s);
    if (equal) {
      [, name, value] = equal;
    } else if (/^--[^=]+$/.test(token)) {
      name = token.slice(2);
      value = argv[++index];
    } else {
      throw capsuleError('ARGS', `不支持的参数：${String(token)}`);
    }
    if (!supported.has(name)) throw capsuleError('ARGS', `不支持的参数：--${name}`);
    if (typeof value !== 'string' || !value || value.includes('\0')) {
      throw capsuleError('ARGS', `--${name} 缺少有效值`);
    }
    if (name === 'artifact') artifacts.push(value);
    else {
      if (values.has(name)) throw capsuleError('ARGS', `--${name} 不能重复`);
      values.set(name, value);
    }
  }
  if (artifacts.length !== 3 || !values.has('candidate-dir') || !values.has('expected-commit')
      || !values.has('output-dir')) {
    throw capsuleError('ARGS', '必须提供恰好三个 --artifact、--candidate-dir、--expected-commit 与 --output-dir');
  }
  const expectedCommit = values.get('expected-commit');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw capsuleError('ARGS', '--expected-commit 必须是 40 位小写 Git commit');
  }
  return {
    artifacts,
    candidateDir: values.get('candidate-dir'),
    expectedCommit,
    outputDir: values.get('output-dir'),
    repositoryRoot: values.get('repository-root')
  };
}

function validateOutputDir(requested) {
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) {
    throw capsuleError('OUTPUT', 'output-dir 必须是绝对路径');
  }
  const output = path.resolve(requested);
  if (fs.existsSync(output)) throw capsuleError('OUTPUT', `output-dir 必须尚不存在：${output}`);
  const parent = realDirectory(path.dirname(output), 'output-dir 父目录');
  const normalized = path.join(parent, path.basename(output));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temporaryRoot, normalized);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..'
      || path.isAbsolute(relative) || !segments.length
      || !segments[0].startsWith(OUTPUT_PREFIX)
      || segments[0].length === OUTPUT_PREFIX.length) {
    throw capsuleError('OUTPUT', `output-dir 必须位于系统临时目录的 ${OUTPUT_PREFIX}* 根内`);
  }
  if (segments.length > 1) {
    const capsuleRoot = path.join(temporaryRoot, segments[0]);
    const root = realDirectory(capsuleRoot, '候选胶囊临时根');
    if (!inside(root, normalized)) throw capsuleError('OUTPUT', 'output-dir 逃离候选胶囊临时根');
  }
  return normalized;
}

function walkFiles(root, label) {
  const rows = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareNames(left.name, right.name));
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      const relative = portable(path.relative(root, filePath));
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw capsuleError('FILE', `${label}含符号链接：${relative}`);
      if (stat.isDirectory()) visit(filePath);
      else if (stat.isFile()) rows.push({ filePath, relative, size: stat.size });
      else throw capsuleError('FILE', `${label}含不支持的文件类型：${relative}`);
      if (rows.length > 50000) throw capsuleError('FILE', `${label}文件数超过上限`);
    }
  }
  visit(root);
  return rows;
}

function uniqueStructuralJson(files, matcher, predicate, label) {
  const matches = [];
  for (const file of files) {
    if (!matcher.test(path.basename(file.relative))) continue;
    const content = readRegular(file.filePath, `${label}候选 ${file.relative}`);
    const data = parseJson(content, `${label}候选 ${file.relative}`);
    if (predicate(data)) matches.push({ ...file, content, data });
  }
  if (matches.length !== 1) {
    throw capsuleError('ARTIFACT', `${label}必须恰好一份，实际 ${matches.length}`);
  }
  return matches[0];
}

function licenseRelative(relative) {
  const segments = relative.split('/');
  const offset = segments.indexOf('licenses');
  if (offset < 0 || offset === segments.length - 1) return '';
  return segments.slice(offset).join('/');
}

function discoverArtifact(requested) {
  const root = realDirectory(requested, 'artifact');
  const files = walkFiles(root, `artifact ${root}`);
  const inventory = uniqueStructuralJson(
    files,
    /^inventory(?:-.+)?\.json$/,
    (data) => data.schemaVersion === 2 && data.target && Array.isArray(data.packages)
      && typeof data.runtimeVersion === 'string',
    'inventory'
  );
  const evidence = uniqueStructuralJson(
    files,
    /^.*evidence.*\.json$/,
    (data) => data.schemaVersion === 1 && data.runtime && data.tree && data.dumpConfig,
    'evidence'
  );
  const runtimeManifest = uniqueStructuralJson(
    files,
    /^(?:runtime-)?manifest(?:-.+)?\.json$/,
    (data) => data.schemaVersion === 3 && typeof data.dshVersion === 'string'
      && typeof data.platform === 'string' && typeof data.arch === 'string',
    'runtime manifest'
  );
  const materialManifest = uniqueStructuralJson(
    files,
    /^material-manifest(?:-.+)?\.json$/,
    (data) => data.schemaVersion === 1 && data.target
      && typeof data.candidateVersion === 'string' && typeof data.gitCommit === 'string'
      && data.candidateManifest && data.inventory && data.evidence && data.runtimeManifest
      && Array.isArray(data.referencedLicenseMaterials),
    'material manifest'
  );
  const materials = [];
  for (const file of files) {
    const relative = licenseRelative(file.relative);
    if (!relative) continue;
    materials.push({ relative, content: readRegular(file.filePath, `artifact 许可证 ${relative}`), source: file.filePath });
  }
  return { root, inventory, evidence, runtimeManifest, materialManifest, materials };
}

function targetKey(target) {
  return target && `${target.platform}/${target.arch}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareNames);
}

function sameSet(actual, expected) {
  return JSON.stringify(sortedUnique(actual)) === JSON.stringify(sortedUnique(expected));
}

function stableManifestHash(manifest) {
  return sha256(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    dshVersion: manifest.dshVersion,
    packageIntegrity: manifest.packageIntegrity,
    auditedLockSha256: manifest.auditedLockSha256,
    installScriptsIgnored: manifest.installScriptsIgnored,
    installScriptPackages: manifest.installScriptPackages,
    platform: manifest.platform,
    arch: manifest.arch
  }));
}

function installScriptPackages(lock) {
  const observed = new Set();
  for (const [lockPath, entry] of Object.entries(lock.packages || {})) {
    if (!entry || entry.hasInstallScript !== true) continue;
    const marker = 'node_modules/';
    const offset = lockPath.lastIndexOf(marker);
    if (offset < 0 || offset + marker.length >= lockPath.length) {
      throw capsuleError('CANDIDATE', `带安装脚本的 lock 路径无法识别：${lockPath}`);
    }
    observed.add(lockPath.slice(offset + marker.length));
  }
  return [...observed].sort(compareNames);
}

function shaRow(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.path !== 'string' || !value.path
      || !Number.isInteger(value.bytes) || value.bytes < 1
      || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) {
    throw capsuleError('ARTIFACT', `${label} path/bytes/sha256 无效`);
  }
  return value;
}

function assertBoundFile(reference, file, label) {
  shaRow(reference, label);
  if (reference.path !== file.relative || reference.bytes !== file.content.length
      || reference.sha256 !== sha256(file.content)) {
    throw capsuleError('STALE', `${label} 与 artifact 文件不一致`);
  }
}

function treeSha256(rows) {
  return sha256(rows.map((row) => JSON.stringify(row)).join('\n'));
}

function evidenceRuntimeRows(entries) {
  return entries.flatMap((entry) => {
    if (entry.path === 'manifest.json' || entry.path === 'node_modules/.package-lock.json') return [];
    if (entry.type === 'file') return [{ path: entry.path, size: entry.bytes, sha256: entry.sha256 }];
    if (entry.type === 'symlink') return [{ path: entry.path, symlink: entry.target }];
    return [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function packageTreeRows(entries, packagePath) {
  const prefix = `${packagePath}/`;
  const directories = new Set(entries.filter((entry) => entry.type === 'directory').map((entry) => entry.path));
  return entries.flatMap((entry) => {
    if (!entry.path.startsWith(prefix)) return [];
    const relative = entry.path.slice(prefix.length);
    if (!relative) return [];
    const segments = relative.split('/');
    const nested = segments.indexOf('node_modules');
    if (nested >= 0 && directories.has(`${prefix}${segments.slice(0, nested + 1).join('/')}`)) return [];
    if (entry.type === 'file') return [{ path: relative, size: entry.bytes, sha256: entry.sha256 }];
    if (entry.type === 'symlink') return [{ path: relative, symlink: entry.target }];
    return [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateEvidenceTree(evidence, target) {
  const tree = evidence.tree;
  if (!tree || !Array.isArray(tree.entries)) {
    throw capsuleError('EVIDENCE', `${target} evidence.tree.entries 缺失`);
  }
  const seen = new Set();
  let directoryCount = 0;
  let fileCount = 0;
  let symlinkCount = 0;
  let logicalBytes = 0;
  let symlinkTargetBytes = 0;
  for (const entry of tree.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\')
        || (entry.path !== '.' && (entry.path.startsWith('/') || entry.path.split('/').includes('..')))
        || seen.has(entry.path) || !/^0o[0-7]{4}$/.test(entry.mode || '')) {
      throw capsuleError('EVIDENCE', `${target} tree entry 无效或重复`);
    }
    seen.add(entry.path);
    if (entry.type === 'directory') {
      if (!sameJson(Object.keys(entry), ['path', 'type', 'mode'])) {
        throw capsuleError('EVIDENCE', `${target} directory entry schema 漂移：${entry.path}`);
      }
      directoryCount += 1;
    } else if (entry.type === 'file') {
      if (!sameJson(Object.keys(entry), ['path', 'type', 'mode', 'bytes', 'sha256'])
          || !Number.isInteger(entry.bytes) || entry.bytes < 0
          || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) {
        throw capsuleError('EVIDENCE', `${target} file entry schema 漂移：${entry.path}`);
      }
      fileCount += 1;
      logicalBytes += entry.bytes;
    } else if (entry.type === 'symlink') {
      const bytes = typeof entry.target === 'string' ? Buffer.byteLength(entry.target, 'utf8') : -1;
      if (!sameJson(Object.keys(entry), ['path', 'type', 'mode', 'target', 'targetBytes', 'sha256'])
          || entry.targetBytes !== bytes
          || entry.sha256 !== sha256(Buffer.from(entry.target || '', 'utf8'))) {
        throw capsuleError('EVIDENCE', `${target} symlink entry schema 漂移：${entry.path}`);
      }
      symlinkCount += 1;
      symlinkTargetBytes += bytes;
    } else {
      throw capsuleError('EVIDENCE', `${target} tree entry 类型无效：${entry.path}`);
    }
  }
  if (!seen.has('.') || tree.entries.find((entry) => entry.path === '.').type !== 'directory') {
    throw capsuleError('EVIDENCE', `${target} tree 缺少根目录 entry`);
  }
  const canonical = Buffer.from(tree.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  const compressed = zlib.gzipSync(canonical, {
    level: 9,
    strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    mtime: 0
  });
  // gzip 头第 10 字节由生成平台写入：macOS=19、Windows=10、Linux=3。
  // 聚合作业固定跑在 Linux，但必须复算原生 runner 的完整压缩流，因此只把
  // 这个标准 OS 标记投影为目标平台；deflate payload、长度和完整 SHA 仍逐字节校验。
  compressed[9] = target.startsWith('darwin/') ? 19 : target.startsWith('win32/') ? 10 : 3;
  const expected = {
    directoryCount, fileCount, symlinkCount, logicalBytes, symlinkTargetBytes,
    canonicalBytes: canonical.length,
    canonicalSha256: sha256(canonical),
    compression: 'node:zlib-gzip-level-9-mtime-0',
    compressedBytes: compressed.length,
    compressedSha256: sha256(compressed)
  };
  for (const [field, value] of Object.entries(expected)) {
    if (tree[field] !== value) throw capsuleError('EVIDENCE', `${target} tree.${field} 漂移`);
  }
  if (tree.compressionNodeVersion !== process.version
      || tree.compressionZlibVersion !== process.versions.zlib) {
    throw capsuleError('EVIDENCE', `${target} tree 压缩运行时版本与聚合作业不一致`);
  }
  return new Map(tree.entries.map((entry) => [entry.path, entry]));
}

function nativeProofSpecs(platform, arch) {
  const escapedPlatform = platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedArch = arch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specs = [
    ['sharp-addon', new RegExp(`^node_modules/@img/sharp-${escapedPlatform}-${escapedArch}/lib/sharp-${escapedPlatform}-${escapedArch}-.+\\.node$`)],
    ['koffi-addon', new RegExp(`^node_modules/@koromix/koffi-${escapedPlatform}-${escapedArch}/${escapedPlatform}_${escapedArch}/koffi\\.node$`)],
    ['ripgrep', new RegExp(`^node_modules/@vscode/ripgrep-${escapedPlatform}-${escapedArch}/bin/rg(?:\\.exe)?$`)],
    ['builtin-addon', new RegExp(`^node_modules/node-addon-require-builtin-${escapedPlatform}-${escapedArch}${platform === 'win32' ? '-msvc' : ''}/prebuilt/${escapedPlatform}-${escapedArch}${platform === 'win32' ? '-msvc' : ''}-.+\\.node$`)]
  ];
  if (platform === 'darwin') {
    specs.push(
      ['sharp-libvips', new RegExp(`^node_modules/@img/sharp-libvips-darwin-${escapedArch}/lib/libvips-cpp\\..+\\.dylib$`)],
      ['node-pty', new RegExp(`^node_modules/node-pty/prebuilds/darwin-${escapedArch}/pty\\.node$`)],
      ['node-pty-spawn-helper', new RegExp(`^node_modules/node-pty/prebuilds/darwin-${escapedArch}/spawn-helper$`)]
    );
  } else {
    const prefix = `^node_modules/node-pty/prebuilds/win32-${escapedArch}/`;
    specs.push(
      ['node-pty-conpty', new RegExp(`${prefix}conpty\\.node$`)],
      ['node-pty-console-list', new RegExp(`${prefix}conpty_console_list\\.node$`)],
      ['node-pty-open-console', new RegExp(`${prefix}conpty/OpenConsole\\.exe$`)],
      ['node-pty-conpty-dll', new RegExp(`${prefix}conpty/conpty\\.dll$`)]
    );
  }
  return specs;
}

function validateNativeEvidence(evidence, target, entryMap) {
  if (!Array.isArray(evidence.nativeBinaries) || !Array.isArray(evidence.targetNativeProofs)) {
    throw capsuleError('EVIDENCE', `${target} nativeBinaries/targetNativeProofs 缺失`);
  }
  for (const binary of evidence.nativeBinaries) {
    const entry = binary && entryMap.get(binary.path);
    if (!entry || entry.type !== 'file' || entry.bytes !== binary.bytes || entry.sha256 !== binary.sha256
        || !['mach-o', 'pe'].includes(binary.format) || !Array.isArray(binary.machines)
        || !binary.machines.length) {
      throw capsuleError('EVIDENCE', `${target} native binary 无法回指 tree：${binary && binary.path}`);
    }
  }
  const [platform, arch] = target.split('/');
  const expectedMachine = arch === 'x64' ? 'x86_64' : arch;
  const specs = nativeProofSpecs(platform, arch);
  if (evidence.targetNativeProofs.length !== specs.length) {
    throw capsuleError('EVIDENCE', `${target} targetNativeProofs 数量漂移`);
  }
  for (const [label, pattern] of specs) {
    const matches = evidence.nativeBinaries.filter((binary) => pattern.test(binary.path));
    const proofs = evidence.targetNativeProofs.filter((proof) => proof && proof.label === label);
    if (matches.length !== 1 || proofs.length !== 1 || !matches[0].machines.includes(expectedMachine)) {
      throw capsuleError('EVIDENCE', `${target} 原生证明缺失或机器类型错误：${label}`);
    }
    const { label: _label, ...proofBinary } = proofs[0];
    if (!sameJson(proofBinary, matches[0])) {
      throw capsuleError('EVIDENCE', `${target} 原生证明与扫描记录不一致：${label}`);
    }
  }
}

function spdxIds(expression) {
  const operators = new Set(['AND', 'OR', 'WITH']);
  return [...new Set((String(expression).match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) || [])
    .filter((value) => !operators.has(value)))];
}

function licenseFindingEntry(entryMap, packagePath, findingPath, target) {
  const requested = `${packagePath}/${findingPath}`;
  const exact = entryMap.get(requested);
  if (exact) return exact;
  const [platform] = target.split('/');
  if (!['darwin', 'win32'].includes(platform)) return null;
  const packageEntry = entryMap.get(packagePath);
  if (!packageEntry || packageEntry.type !== 'directory'
      || !['README.md', 'readme.md'].includes(findingPath)) return null;
  // npm 的许可候选同时包含 README.md/readme.md；macOS 与 Windows runner
  // 的文件系统大小写不敏感时，两次读取会指向同一真实文件。证据树只记录
  // 一条真实路径。package 目录必须精确命中，仅对其顶层 README basename
  // 允许唯一的 case-fold 回指；其他路径或歧义仍 fail-closed。
  const prefix = `${packagePath}/`;
  const folded = findingPath.toLowerCase();
  const matches = [...entryMap.entries()].filter(([name]) => {
    if (!name.startsWith(prefix)) return false;
    const relative = name.slice(prefix.length);
    return !relative.includes('/') && relative.toLowerCase() === folded;
  });
  return matches.length === 1 ? matches[0][1] : null;
}

function validateInventoryClosure(inventory, evidence, candidate, target, entryMap) {
  const packages = inventory.packages;
  const keys = new Set();
  const installedPaths = new Set();
  const licenseCounts = {};
  for (const pkg of packages) {
    const key = packageKey(pkg);
    if (!pkg || typeof pkg.name !== 'string' || !pkg.name || typeof pkg.version !== 'string' || !pkg.version
        || typeof pkg.license !== 'string' || !pkg.license || typeof pkg.resolved !== 'string'
        || typeof pkg.integrity !== 'string' || !pkg.integrity || keys.has(key)
        || !Array.isArray(pkg.paths) || !pkg.paths.length || !Array.isArray(pkg.licenseFiles)
        || !Array.isArray(pkg.weakCopyleft) || !Array.isArray(pkg.embeddedComponents)
        || !Array.isArray(pkg.licenseTextFindings) || !pkg.licenseTextFindings.length
        || !Array.isArray(pkg.binaryFiles) || !/^[a-f0-9]{64}$/.test(pkg.packageTreeSha256 || '')) {
      throw capsuleError('INVENTORY', `${target} package row schema/唯一性无效：${key}`);
    }
    keys.add(key);
    if (!sameJson(pkg.paths, [...new Set(pkg.paths)].sort())
        || !sameJson(pkg.licenseFiles, [...new Set(pkg.licenseFiles)].sort())
        || !sameJson(pkg.weakCopyleft, [...new Set(pkg.weakCopyleft)].sort())) {
      throw capsuleError('INVENTORY', `${target} package 集合未按 inventory 算法规范化：${key}`);
    }
    const ids = spdxIds(pkg.license);
    if (ids.some((id) => /^(?:AGPL|GPL|SSPL)-/i.test(id))) {
      throw capsuleError('INVENTORY', `${target} 强 copyleft package：${key}`);
    }
    if (pkg.embeddedComponents.some((component) => /^(?:AGPL|GPL)$/.test(component.license || '')
        || /\b(?:AGPL|GPL|SSPL)-\d/i.test(component.materialLicenseExpression || ''))) {
      throw capsuleError('INVENTORY', `${target} 强 copyleft embedded component：${key}`);
    }
    for (const finding of pkg.licenseTextFindings) {
      if (!finding || typeof finding.path !== 'string' || !finding.path
          || !/^[a-f0-9]{64}$/.test(finding.sha256 || '') || !Array.isArray(finding.detected)) {
        throw capsuleError('INVENTORY', `${target} licenseTextFinding 无效：${key}`);
      }
      const unexpected = finding.detected.filter((value) => /^(?:AGPL|SSPL)$/.test(value)
        || (value === 'GPL' && !ids.some((id) => /^LGPL-/i.test(id))));
      if (unexpected.length) throw capsuleError('INVENTORY', `${target} hidden strong license：${key}`);
      if (finding.origin) {
        if (!pkg.licenseFiles.includes(finding.path)) {
          throw capsuleError('INVENTORY', `${target} override finding 未绑定 licenseFiles：${key}`);
        }
      } else {
        for (const packagePath of pkg.paths) {
          const entry = licenseFindingEntry(entryMap, packagePath, finding.path, target);
          if (!entry || entry.type !== 'file' || entry.sha256 !== finding.sha256) {
            throw capsuleError('INVENTORY', `${target} package license finding 无法回指 tree：${key}`);
          }
        }
        if (!pkg.licenseFiles.includes(`licenses/package-texts/${finding.sha256}.txt`)) {
          throw capsuleError('INVENTORY', `${target} package license finding 未绑定提取文本：${key}`);
        }
      }
    }
    for (const packagePath of pkg.paths) {
      if (installedPaths.has(packagePath)) {
        throw capsuleError('INVENTORY', `${target} 安装路径重复归属：${packagePath}`);
      }
      installedPaths.add(packagePath);
      const lockEntry = candidate.lock.packages && candidate.lock.packages[packagePath];
      if (!lockEntry || lockEntry.version !== pkg.version || lockEntry.integrity !== pkg.integrity
          || (lockEntry.resolved || '') !== pkg.resolved) {
        throw capsuleError('INVENTORY', `${target} package 与 candidate lock 不一致：${packagePath}`);
      }
      const rows = packageTreeRows(evidence.tree.entries, packagePath);
      const binaryFiles = rows.filter((row) => /\.(?:node|wasm|dll|dylib|exe|so(?:\.\d+)*)$/i.test(row.path));
      if (treeSha256(rows) !== pkg.packageTreeSha256 || !sameJson(binaryFiles, pkg.binaryFiles)) {
        throw capsuleError('INVENTORY', `${target} package tree/binary 漂移：${key}`);
      }
    }
    licenseCounts[pkg.license] = (licenseCounts[pkg.license] || 0) + 1;
  }
  const packageOrder = [...packages].sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  if (!sameJson(packages.map(packageKey), packageOrder.map(packageKey))) {
    throw capsuleError('INVENTORY', `${target} package 顺序漂移`);
  }
  const expectedCounts = Object.fromEntries(Object.entries(licenseCounts).sort());
  if (!sameJson(inventory.licenseCounts, expectedCounts)) {
    throw capsuleError('INVENTORY', `${target} licenseCounts 漂移`);
  }
  const closureMaterial = packages.map((pkg) => [
    pkg.name, pkg.version, pkg.license, pkg.integrity, pkg.paths.join(','),
    pkg.packageTreeSha256, JSON.stringify(pkg.binaryFiles), JSON.stringify(pkg.licenseTextFindings),
    JSON.stringify(pkg.embeddedComponents), pkg.licenseFiles.join(',')
  ].join('\0')).join('\n');
  if (inventory.closureSha256 !== sha256(closureMaterial)) {
    throw capsuleError('INVENTORY', `${target} closureSha256 漂移`);
  }
  if (inventory.runtimeTreeSha256 !== treeSha256(evidenceRuntimeRows(evidence.tree.entries))) {
    throw capsuleError('INVENTORY', `${target} runtimeTreeSha256 与 evidence tree 不一致`);
  }
  const rootPackage = entryMap.get('package.json');
  if (!rootPackage || rootPackage.type !== 'file'
      || inventory.runtimePackageJsonSha256 !== rootPackage.sha256) {
    throw capsuleError('INVENTORY', `${target} runtime package.json hash 漂移`);
  }
  const lockInstalled = Object.keys(candidate.lock.packages || {}).filter((lockPath) =>
    lockPath && entryMap.has(`${lockPath}/package.json`)).sort();
  if (!sameJson([...installedPaths].sort(), lockInstalled)) {
    throw capsuleError('INVENTORY', `${target} inventory 安装路径闭包不完整`);
  }
}

function loadCandidate(repositoryRoot, candidateDir) {
  const root = realDirectory(repositoryRoot, '仓库根');
  const candidatesRoot = realDirectory(path.join(root, 'compliance', 'candidates'), '候选合规根');
  const candidate = realDirectory(candidateDir, 'repository candidate dir');
  if (candidate === candidatesRoot || !inside(candidatesRoot, candidate)) {
    throw capsuleError('PATH', 'candidate-dir 必须是 compliance/candidates 下的具体候选目录');
  }
  const manifestRow = readJson(path.join(candidate, 'candidate-manifest.json'), 'candidate manifest');
  const manifest = manifestRow.data;
  if (manifest.schemaVersion !== 1 || manifest.packageVersion !== VERSION
      || !manifest.auditedLock || typeof manifest.auditedLock.path !== 'string'
      || !/^[a-f0-9]{64}$/.test(manifest.auditedLock.sha256 || '')) {
    throw capsuleError('CANDIDATE', `candidate manifest 必须精确锁定 ${VERSION}`);
  }
  const manifestTargets = (manifest.targets || []).map(targetKey);
  if (!sameSet(manifestTargets, EXPECTED_TARGETS) || manifestTargets.length !== EXPECTED_TARGETS.length) {
    throw capsuleError('TARGET', 'candidate manifest 目标集不等于三个批准目标');
  }
  if (path.isAbsolute(manifest.auditedLock.path) || manifest.auditedLock.path.includes('\0')) {
    throw capsuleError('PATH', 'candidate audited lock 路径必须相对当前候选目录');
  }
  const lockRequested = path.resolve(candidate, manifest.auditedLock.path);
  const lockRow = readJson(lockRequested, 'candidate audited lock');
  const lockPath = fs.realpathSync(lockRequested);
  if (!inside(candidate, lockPath)) throw capsuleError('PATH', 'candidate audited lock 逃离候选目录');
  const lockSha256 = sha256(lockRow.content);
  if (lockSha256 !== manifest.auditedLock.sha256) {
    throw capsuleError('STALE', `candidate lock SHA 漂移：${lockSha256}`);
  }
  const lock = lockRow.data;
  const rootEntry = lock.packages && lock.packages[''];
  const dsh = lock.packages && lock.packages['node_modules/@deepseek-ai/dsh'];
  if (lock.lockfileVersion !== 3 || !rootEntry || !dsh
      || JSON.stringify(rootEntry.dependencies) !== JSON.stringify({ '@deepseek-ai/dsh': VERSION })
      || dsh.version !== VERSION || typeof dsh.integrity !== 'string' || !dsh.integrity) {
    throw capsuleError('CANDIDATE', 'candidate lock 根依赖、版本或 integrity 不精确');
  }
  const observedInstallScripts = installScriptPackages(lock);
  if (!Array.isArray(manifest.installScriptAllowlist)
      || !sameJson(manifest.installScriptAllowlist, observedInstallScripts)
      || new Set(manifest.installScriptAllowlist).size !== manifest.installScriptAllowlist.length) {
    throw capsuleError('CANDIDATE', 'candidate installScriptAllowlist 与 audited lock 不一致');
  }
  const overridesRow = readJson(path.join(candidate, 'package-license-overrides.json'), 'candidate overrides');
  if (overridesRow.data.schemaVersion !== 1 || !overridesRow.data.packages
      || typeof overridesRow.data.packages !== 'object' || Array.isArray(overridesRow.data.packages)) {
    throw capsuleError('OVERRIDES', 'candidate overrides schema 无效');
  }
  return {
    repositoryRoot: root,
    candidateDir: candidate,
    manifestPath: path.join(candidate, 'candidate-manifest.json'),
    manifestRelative: portable(path.relative(root, path.join(candidate, 'candidate-manifest.json'))),
    manifest,
    manifestContent: manifestRow.content,
    lock,
    lockContent: lockRow.content,
    lockPath,
    lockSha256,
    packageIntegrity: dsh.integrity,
    installScriptPackages: observedInstallScripts,
    overrides: overridesRow.data
  };
}

function validateMaterialManifest(artifact, candidate, expectedCommit, target, inventory) {
  const material = artifact.materialManifest.data;
  if (material.candidateVersion !== VERSION || targetKey(material.target) !== target
      || material.gitCommit !== expectedCommit || !/^[a-f0-9]{40}$/.test(material.gitCommit)) {
    throw capsuleError('ARTIFACT', `${target} material manifest candidate/target/commit 漂移`);
  }
  shaRow(material.candidateManifest, `${target} candidateManifest`);
  if (material.candidateManifest.path !== candidate.manifestRelative
      || material.candidateManifest.bytes !== candidate.manifestContent.length
      || material.candidateManifest.sha256 !== sha256(candidate.manifestContent)) {
    throw capsuleError('STALE', `${target} material manifest 未绑定当前 candidate manifest`);
  }
  assertBoundFile(material.inventory, artifact.inventory, `${target} inventory binding`);
  assertBoundFile(material.evidence, artifact.evidence, `${target} evidence binding`);
  assertBoundFile(material.runtimeManifest, artifact.runtimeManifest, `${target} runtime manifest binding`);

  const expected = sortedUnique(inventory.packages.flatMap((pkg) => pkg.licenseFiles || []));
  const rows = new Map();
  for (const row of material.referencedLicenseMaterials) {
    shaRow(row, `${target} referenced license material`);
    if (typeof row.uploaded !== 'boolean' || !/^licenses\/[A-Za-z0-9._@/+~-]+$/.test(row.path)
        || row.path.includes('/../') || rows.has(row.path)) {
      throw capsuleError('ARTIFACT', `${target} material row 无效或重复：${row.path}`);
    }
    const packageText = /^licenses\/package-texts\/[a-f0-9]{64}\.txt$/.test(row.path);
    if (row.uploaded !== packageText) {
      throw capsuleError('ARTIFACT', `${target} material uploaded 边界漂移：${row.path}`);
    }
    rows.set(row.path, row);
  }
  if (!sameJson([...rows.keys()].sort(compareNames), expected)) {
    throw capsuleError('ARTIFACT', `${target} material manifest 未精确覆盖 inventory licenseFiles`);
  }
  const uploaded = new Map();
  for (const item of artifact.materials) {
    if (uploaded.has(item.relative)) throw capsuleError('ARTIFACT', `${target} artifact license 路径重复：${item.relative}`);
    uploaded.set(item.relative, item);
  }
  for (const row of rows.values()) {
    if (!row.uploaded) continue;
    const item = uploaded.get(row.path);
    if (!item || item.content.length !== row.bytes || sha256(item.content) !== row.sha256) {
      throw capsuleError('STALE', `${target} uploaded material 未绑定：${row.path}`);
    }
  }
  if (!sameJson([...uploaded.keys()].sort(compareNames), [...rows.values()]
    .filter((row) => row.uploaded).map((row) => row.path).sort(compareNames))) {
    throw capsuleError('ARTIFACT', `${target} artifact 含未声明 license material`);
  }
  return rows;
}

function validateArtifact(artifact, candidate, expectedCommit) {
  const inventory = artifact.inventory.data;
  const evidence = artifact.evidence.data;
  const manifest = artifact.runtimeManifest.data;
  const target = targetKey(inventory.target);
  if (!EXPECTED_TARGETS.includes(target)) throw capsuleError('TARGET', `artifact 目标未批准：${target}`);
  for (const [label, actual] of [
    ['inventory runtimeVersion', inventory.runtimeVersion],
    ['runtime manifest dshVersion', manifest.dshVersion],
    ['evidence runtime.version', evidence.runtime.version]
  ]) {
    if (actual !== VERSION) throw capsuleError('STALE', `${target} ${label}=${String(actual)}`);
  }
  if (targetKey(manifest) !== target || targetKey(evidence.runtime) !== target
      || manifest.hostPlatform !== inventory.target.platform || manifest.hostArch !== inventory.target.arch
      || evidence.runtime.hostPlatform !== inventory.target.platform
      || evidence.runtime.hostArch !== inventory.target.arch) {
    throw capsuleError('TARGET', `${target} inventory/manifest/evidence 或 host/target 不一致`);
  }
  for (const [label, actual] of [
    ['inventory packageLockSha256', inventory.packageLockSha256],
    ['manifest auditedLockSha256', manifest.auditedLockSha256],
    ['evidence lockSha256', evidence.runtime.lockSha256]
  ]) {
    if (actual !== candidate.lockSha256) throw capsuleError('STALE', `${target} ${label} 漂移`);
  }
  for (const [label, actual] of [
    ['inventory runtimePackageIntegrity', inventory.runtimePackageIntegrity],
    ['manifest packageIntegrity', manifest.packageIntegrity],
    ['evidence packageIntegrity', evidence.runtime.packageIntegrity]
  ]) {
    if (actual !== candidate.packageIntegrity) throw capsuleError('STALE', `${target} ${label} 漂移`);
  }
  if (evidence.runtime.manifestSha256 !== sha256(artifact.runtimeManifest.content)
      || inventory.manifestStableSha256 !== stableManifestHash(manifest)) {
    throw capsuleError('STALE', `${target} runtime manifest 证据哈希漂移`);
  }
  if (!Array.isArray(inventory.packages) || inventory.packageCount !== inventory.packages.length) {
    throw capsuleError('INVENTORY', `${target} packageCount 与 packages 不一致`);
  }
  const dsh = inventory.packages.filter((pkg) => pkg.name === '@deepseek-ai/dsh');
  if (dsh.length !== 1 || dsh[0].version !== VERSION || dsh[0].integrity !== candidate.packageIntegrity) {
    throw capsuleError('INVENTORY', `${target} inventory 缺少精确 dsh 包`);
  }
  if (manifest.installScriptsIgnored !== true || evidence.runtime.installScriptsIgnored !== true
      || !sameJson(manifest.installScriptPackages, candidate.installScriptPackages)
      || !sameJson(evidence.runtime.installScriptPackages, candidate.installScriptPackages)
      || evidence.runtime.lockPackages !== Object.keys(candidate.lock.packages).length) {
    throw capsuleError('EVIDENCE', `${target} install-script/lock closure 漂移`);
  }
  const entryMap = validateEvidenceTree(evidence, target);
  const requiredFileHash = (relative, expected, label) => {
    const entry = entryMap.get(relative);
    if (!entry || entry.type !== 'file' || entry.sha256 !== expected) {
      throw capsuleError('EVIDENCE', `${target} ${label} 无法回指 tree`);
    }
  };
  requiredFileHash('manifest.json', evidence.runtime.manifestSha256, 'manifest');
  requiredFileHash('package.json', evidence.runtime.packageSha256, 'root package');
  requiredFileHash('package-lock.json', evidence.runtime.lockSha256, 'lock');
  requiredFileHash('node_modules/@deepseek-ai/dsh/package.json', evidence.runtime.installedPackageSha256, 'installed dsh');
  if (typeof evidence.runtime.exactBinRelative !== 'string'
      || !entryMap.has(evidence.runtime.exactBinRelative)
      || entryMap.get(evidence.runtime.exactBinRelative).type !== 'file') {
    throw capsuleError('EVIDENCE', `${target} exact dsh bin 未绑定 tree`);
  }
  const dump = evidence.dumpConfig;
  if (!dump || dump.exit !== 0 || !Number.isInteger(dump.bytes) || dump.bytes < 0
      || !Number.isInteger(dump.lines) || dump.lines < 0 || !/^[a-f0-9]{64}$/.test(dump.sha256 || '')
      || !Number.isInteger(dump.stderrBytes) || dump.stderrBytes < 0
      || !/^[a-f0-9]{64}$/.test(dump.stderrSha256 || '')) {
    throw capsuleError('EVIDENCE', `${target} dump-config 证据无效`);
  }
  validateNativeEvidence(evidence, target, entryMap);
  validateInventoryClosure(inventory, evidence, candidate, target, entryMap);
  const materialBindings = validateMaterialManifest(artifact, candidate, expectedCommit, target, inventory);
  return { ...artifact, target, inventoryData: inventory, materialBindings };
}

function packageKey(pkg) {
  return `${pkg.name}@${pkg.version}`;
}

function validateSharedPackages(artifacts) {
  const seen = new Map();
  for (const artifact of artifacts) {
    for (const pkg of artifact.inventoryData.packages) {
      if (!pkg || typeof pkg.name !== 'string' || typeof pkg.version !== 'string'
          || typeof pkg.integrity !== 'string') {
        throw capsuleError('INVENTORY', `${artifact.target} 包身份字段缺失`);
      }
      const key = packageKey(pkg);
      const identity = JSON.stringify({
        license: pkg.license,
        resolved: pkg.resolved,
        integrity: pkg.integrity
      });
      if (seen.has(key) && seen.get(key) !== identity) {
        throw capsuleError('CONFLICT', `同名包元数据冲突：${key}`);
      }
      seen.set(key, identity);
    }
  }
}

function originFindings(artifacts) {
  const byKey = new Map();
  for (const artifact of artifacts) {
    for (const pkg of artifact.inventoryData.packages) {
      const rows = (pkg.licenseTextFindings || []).filter((row) =>
        row && typeof row.origin === 'string' && row.origin);
      if (!rows.length) continue;
      const key = packageKey(pkg);
      const normalized = rows.map((row) => ({
        path: row.path,
        sha256: row.sha256,
        sourceUrl: row.origin,
        ...(row.sourceCommit ? { sourceCommit: row.sourceCommit } : {})
      })).sort((left, right) => compareNames(JSON.stringify(left), JSON.stringify(right)));
      const encoded = JSON.stringify(normalized);
      if (byKey.has(key) && byKey.get(key).encoded !== encoded) {
        throw capsuleError('CONFLICT', `同名包 origin 许可材料冲突：${key}`);
      }
      byKey.set(key, { encoded, rows: normalized });
    }
  }
  return byKey;
}

function trimOverrides(source, artifacts) {
  const origins = originFindings(artifacts);
  const expectedKeys = [...origins.keys()].sort(compareNames);
  const actualKeys = Object.keys(source.packages || {}).sort(compareNames);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw capsuleError('OVERRIDES', `override key 与实际 origin 包不一致：expected=${expectedKeys.join(',') || '空'} actual=${actualKeys.join(',') || '空'}`);
  }
  const packages = {};
  for (const key of expectedKeys) {
    const record = source.packages[key];
    if (!record || !Array.isArray(record.licenseFiles) || !record.licenseFiles.length) {
      throw capsuleError('OVERRIDES', `override 缺少 licenseFiles：${key}`);
    }
    const actual = record.licenseFiles.map((row) => ({
      path: row.path,
      sha256: row.sha256,
      sourceUrl: row.sourceUrl,
      ...(row.sourceCommit ? { sourceCommit: row.sourceCommit } : {})
    })).sort((left, right) => compareNames(JSON.stringify(left), JSON.stringify(right)));
    if (JSON.stringify(actual) !== origins.get(key).encoded) {
      throw capsuleError('STALE', `override 材料与 inventory origin 不一致：${key}`);
    }
    packages[key] = record;
  }
  return { schemaVersion: 1, packages };
}

function isWeakCopyleft(value) {
  return /^(?:LGPL|MPL)-/i.test(String(value || ''));
}

function actualEmbeddedPackages(artifacts) {
  const packages = new Map();
  for (const artifact of artifacts) {
    for (const pkg of artifact.inventoryData.packages) {
      if (!Array.isArray(pkg.embeddedComponents) || !pkg.embeddedComponents.length) continue;
      const key = packageKey(pkg);
      const identity = JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        resolved: pkg.resolved,
        integrity: pkg.integrity,
        embeddedComponents: pkg.embeddedComponents,
        licenseFiles: pkg.licenseFiles
      });
      if (packages.has(key) && packages.get(key).identity !== identity) {
        throw capsuleError('CONFLICT', `内嵌组件披露冲突：${key}`);
      }
      packages.set(key, { pkg, identity });
    }
  }
  return new Map([...packages.entries()].map(([key, value]) => [key, value.pkg]));
}

function trimEmbedded(source, artifacts, inventoryOutputRows) {
  if (source.schemaVersion !== 1 || !Array.isArray(source.targets)
      || !Array.isArray(source.components) || !Array.isArray(source.materials)) {
    throw capsuleError('EMBEDDED', 'production embedded-license-materials schema 无效');
  }
  const actualPackages = actualEmbeddedPackages(artifacts);
  const sourceTargetsByPackage = new Map();
  for (const target of source.targets) {
    if (!target.id || !target.package || sourceTargetsByPackage.has(target.package)) {
      throw capsuleError('EMBEDDED', `production embedded target 重复或缺字段：${target.package || '?'}`);
    }
    sourceTargetsByPackage.set(target.package, target);
  }
  const sourceComponents = new Map((source.components || []).map((row) => [row.id, row]));
  const sourceMaterials = new Map((source.materials || []).map((row) => [row.id, row]));
  if (sourceComponents.size !== source.components.length || sourceMaterials.size !== source.materials.length) {
    throw capsuleError('EMBEDDED', 'production embedded component/material id 重复');
  }

  const retainedTargets = [];
  const targetUsage = new Map();
  const allInventoryLicenseFiles = new Set();
  for (const artifact of artifacts) {
    for (const pkg of artifact.inventoryData.packages) {
      for (const relative of pkg.licenseFiles || []) allInventoryLicenseFiles.add(relative);
    }
  }
  for (const [key, pkg] of actualPackages) {
    const target = sourceTargetsByPackage.get(key);
    if (!target || target.packageUrl !== pkg.resolved) {
      throw capsuleError('STALE', `embedded target 缺失或二进制来源漂移：${key}`);
    }
    const actualIds = sortedUnique(pkg.embeddedComponents.map((row) => row.materialComponentId));
    if (actualIds.some((id) => !id)
        || JSON.stringify(actualIds) !== JSON.stringify(sortedUnique(target.componentIds || []))) {
      throw capsuleError('STALE', `embedded target 组件向量漂移：${key}`);
    }
    for (const component of pkg.embeddedComponents) {
      const record = sourceComponents.get(component.materialComponentId);
      if (!record || record.licenseExpression !== component.materialLicenseExpression) {
        throw capsuleError('STALE', `embedded component 许可映射漂移：${component.materialComponentId}`);
      }
      const expectedFiles = sortedUnique((record.materialIds || []).map((id) => {
        const material = sourceMaterials.get(id);
        if (!material) throw capsuleError('STALE', `embedded material 缺失：${id}`);
        return material.repositoryPath;
      }));
      if (JSON.stringify(expectedFiles) !== JSON.stringify(sortedUnique(component.materialFiles || []))) {
        throw capsuleError('STALE', `embedded component 材料向量漂移：${component.materialComponentId}`);
      }
    }
    retainedTargets.push({ ...target, componentIds: actualIds });
    targetUsage.set(target.id, new Set(actualIds));
  }
  retainedTargets.sort((left, right) => {
    const a = source.targets.findIndex((row) => row.id === left.id);
    const b = source.targets.findIndex((row) => row.id === right.id);
    return a - b;
  });

  const componentIds = new Set([...targetUsage.values()].flatMap((set) => [...set]));
  const components = source.components.filter((row) => componentIds.has(row.id)).map((row) => {
    const targets = retainedTargets.filter((target) => targetUsage.get(target.id).has(row.id))
      .map((target) => target.id);
    if (!sameSet((row.targets || []).filter((id) => targetUsage.has(id)), targets)) {
      throw capsuleError('STALE', `embedded component target 映射漂移：${row.id}`);
    }
    return { ...row, targets };
  });
  if (components.length !== componentIds.size) throw capsuleError('STALE', 'embedded component 记录不完整');

  const declarationMaterialIds = new Set();
  const declarations = [];
  for (const declaration of source.evidenceBasis && source.evidenceBasis.declarations || []) {
    if (declaration.materialId) {
      const material = sourceMaterials.get(declaration.materialId);
      if (!material) throw capsuleError('STALE', `embedded declaration material 缺失：${declaration.materialId}`);
      if (allInventoryLicenseFiles.has(material.repositoryPath)) {
        declarationMaterialIds.add(declaration.materialId);
        declarations.push(declaration);
      }
      continue;
    }
    if (Array.isArray(declaration.targets)) {
      const targets = declaration.targets.filter((id) => targetUsage.has(id));
      if (targets.length) declarations.push({ ...declaration, targets });
      continue;
    }
    declarations.push(declaration);
  }

  const materialIds = new Set(declarationMaterialIds);
  for (const component of components) {
    for (const id of component.materialIds || []) materialIds.add(id);
  }
  const materials = source.materials.filter((row) => materialIds.has(row.id)).map((row) => {
    if (!Array.isArray(row.upstreamCopies)) return row;
    const upstreamCopies = row.upstreamCopies.map((copy) => {
      if (!Array.isArray(copy.componentIds)) return copy;
      const ids = copy.componentIds.filter((id) => componentIds.has(id));
      return ids.length ? { ...copy, componentIds: ids } : null;
    }).filter(Boolean);
    return { ...row, upstreamCopies };
  });
  if (materials.length !== materialIds.size) throw capsuleError('STALE', 'embedded material 记录不完整');

  const unknown = (source.coverage && source.coverage.exactVendoredButIndependentVersionUnknown || [])
    .filter((id) => componentIds.has(id));
  const discrepancies = (source.coverage && source.coverage.confirmedAttributionDiscrepancies || [])
    .filter((id) => components.some((row) => row.id === id || row.id.startsWith(`${id}@`)));
  const targetCounts = {};
  for (const target of retainedTargets) targetCounts[target.id] = target.componentIds.length;
  const evidenceInventories = inventoryOutputRows.map((row) => ({
    path: row.path,
    sha256: sha256(row.content)
  }));
  const result = {
    ...source,
    scope: `WhaleDock dsh ${VERSION} candidate bundled runtime: reachable embedded components only`,
    evidenceBasis: {
      ...(source.evidenceBasis || {}),
      inventories: evidenceInventories,
      declarations
    },
    targets: retainedTargets,
    components,
    materials,
    coverage: {
      ...(source.coverage || {}),
      targetCounts,
      componentOccurrences: Object.values(targetCounts).reduce((sum, count) => sum + count, 0),
      uniqueComponentRecords: components.length,
      materialFilesReferenced: materials.length,
      exactVersionOrCommitRecords: components.length - unknown.length,
      exactVendoredButIndependentVersionUnknown: unknown,
      confirmedAttributionDiscrepancies: discrepancies,
      status: 'complete for components reachable from the three pinned candidate inventories'
    }
  };
  return { result, retainedTargetIds: new Set(retainedTargets.map((row) => row.id)), componentIds, materialIds };
}

function requiredSourceContainers(artifacts) {
  const required = new Map();
  for (const artifact of artifacts) {
    for (const pkg of artifact.inventoryData.packages) {
      if (!Array.isArray(pkg.weakCopyleft) || !pkg.weakCopyleft.length) continue;
      const key = packageKey(pkg);
      const row = required.get(key) || { pkg, targets: new Set(), componentIds: new Set() };
      row.targets.add(artifact.target);
      for (const component of pkg.embeddedComponents || []) {
        if (isWeakCopyleft(component.license) || isWeakCopyleft(component.officialLicense)
            || String(component.license || '').includes('LicenseRef-AOM-Patent-1.0')) {
          row.componentIds.add(component.materialComponentId);
        }
      }
      required.set(key, row);
    }
  }
  return required;
}

function officialWeakLicense(expression) {
  const value = String(expression || '').trim();
  // 只裁掉诸如 “LGPL-3.0-only for library” 的说明后缀；不得把
  // “LGPL-2.1-only OR MPL-1.1” 这类完整双许可证表达式截成单一许可。
  const match = value.match(/^(LGPL-\d\.\d-(?:only|or-later)|MPL-\d\.\d)(?:\s+for\b.*)?$/);
  return match ? match[1] : '';
}

function trimSources(source, embedded, artifacts) {
  if (source.schemaVersion !== 1 || !Array.isArray(source.containers)
      || !Array.isArray(source.components) || !Array.isArray(source.buildRecipes)
      || !Array.isArray(source.buildInputPackages)) {
    throw capsuleError('SOURCES', 'production SOURCES schema 无效');
  }
  const required = requiredSourceContainers(artifacts);
  const containers = new Map(source.containers.map((row) => [packageKey(row), row]));
  const recipes = new Map(source.buildRecipes.map((row) => [row.id, row]));
  const inputs = new Map(source.buildInputPackages.map((row) => [packageKey(row), row]));
  const components = new Map(source.components.map((row) => [row.id, row]));
  const embeddedComponents = new Map(embedded.result.components.map((row) => [row.id, row]));
  const retainedContainers = [];
  const recipeIds = new Set();
  const inputIds = new Set();
  const componentIds = new Set();

  for (const [key, actual] of required) {
    const row = containers.get(key);
    if (!row || row.resolved !== actual.pkg.resolved || row.integrity !== actual.pkg.integrity) {
      throw capsuleError('STALE', `SOURCES 容器缺失或二进制身份漂移：${key}`);
    }
    const targets = sortedUnique([...actual.targets]);
    if (!sameSet(row.targets || [], targets)) {
      throw capsuleError('STALE', `SOURCES 容器目标集漂移：${key}`);
    }
    for (const id of row.buildRecipes || []) {
      if (!recipes.has(id)) throw capsuleError('STALE', `SOURCES 构建配方缺失：${key} -> ${id}`);
      recipeIds.add(id);
    }
    for (const id of row.buildInputPackages || []) {
      if (!inputs.has(id)) throw capsuleError('STALE', `SOURCES 构建输入缺失：${key} -> ${id}`);
      inputIds.add(id);
    }
    const mapped = new Set(row.componentSources || []);
    for (const id of actual.componentIds) {
      if (!id || !mapped.has(id) || !components.has(id) || !embeddedComponents.has(id)) {
        throw capsuleError('STALE', `SOURCES 组件源码映射缺失：${key} -> ${id || '?'}`);
      }
      const sourceComponent = components.get(id);
      const embeddedComponent = embeddedComponents.get(id);
      const expectedLicense = officialWeakLicense(embeddedComponent.licenseExpression)
        || embeddedComponent.licenseExpression;
      if (sourceComponent.license !== expectedLicense) {
        throw capsuleError('STALE', `SOURCES 组件许可证漂移：${id}`);
      }
      componentIds.add(id);
    }
    retainedContainers.push({
      ...row,
      targets,
      componentSources: (row.componentSources || []).filter((id) => actual.componentIds.has(id))
    });
  }

  for (const id of inputIds) {
    const recipe = inputs.get(id).recipe;
    if (recipe) {
      if (!recipes.has(recipe)) throw capsuleError('STALE', `SOURCES 输入配方缺失：${id} -> ${recipe}`);
      recipeIds.add(recipe);
    }
  }
  const retainedComponents = source.components.filter((row) => componentIds.has(row.id));
  const retainedRecipes = source.buildRecipes.filter((row) => recipeIds.has(row.id));
  const retainedInputs = source.buildInputPackages.filter((row) => inputIds.has(packageKey(row)));

  const originText = [];
  for (const record of originFindings(artifacts).values()) {
    for (const row of record.rows) originText.push(JSON.stringify(row));
  }
  const retainedAttributions = (source.attributionSources || []).filter((row) => {
    if (componentIds.has(row.id)) return true;
    const encoded = JSON.stringify(row);
    return originText.some((origin) => {
      const commits = origin.match(/[a-f0-9]{7,40}/g) || [];
      return commits.some((commit) => encoded.includes(commit));
    });
  });
  return {
    ...source,
    scope: `WhaleDock dsh ${VERSION} candidate reachable weak-copyleft source closure`,
    buildRecipes: retainedRecipes,
    buildInputPackages: retainedInputs,
    components: retainedComponents,
    containers: retainedContainers,
    attributionSources: retainedAttributions
  };
}

function addMaterial(pool, relative, content, source) {
  if (!/^licenses\/[A-Za-z0-9._@/+~-]+$/.test(relative) || relative.includes('/../')) {
    throw capsuleError('MATERIAL', `许可证相对路径无效：${relative}`);
  }
  const digest = sha256(content);
  if (pool.has(relative) && pool.get(relative).digest !== digest) {
    throw capsuleError('CONFLICT', `同名许可证材料字节冲突：${relative}`);
  }
  if (!pool.has(relative)) pool.set(relative, { content, digest, source });
}

function addLicenseTree(pool, root, label) {
  if (!fs.existsSync(root)) return;
  const real = realDirectory(root, `${label} licenses`);
  for (const file of walkFiles(real, `${label} licenses`)) {
    addMaterial(pool, `licenses/${file.relative}`, readRegular(file.filePath, `${label} ${file.relative}`), file.filePath);
  }
}

function materialPlan(candidate, artifacts, embedded, sources, overrides) {
  const pool = new Map();
  addLicenseTree(pool, path.join(candidate.repositoryRoot, 'licenses'), 'repository');
  addLicenseTree(pool, path.join(candidate.candidateDir, 'licenses'), 'candidate');
  for (const artifact of artifacts) {
    for (const material of artifact.materials) {
      addMaterial(pool, material.relative, material.content, material.source);
    }
  }
  for (const artifact of artifacts) {
    for (const row of artifact.materialBindings.values()) {
      const material = pool.get(row.path);
      if (!material || material.content.length !== row.bytes || material.digest !== row.sha256) {
        throw capsuleError('STALE', `${artifact.target} material pool 未满足 runner binding：${row.path}`);
      }
    }
  }

  const required = new Set(SPDX_IDS.map((id) => `licenses/SPDX-${id}.txt`));
  for (const artifact of artifacts) {
    for (const pkg of artifact.inventoryData.packages) {
      for (const relative of pkg.licenseFiles || []) required.add(relative);
    }
  }
  for (const record of Object.values(overrides.packages)) {
    for (const row of record.licenseFiles || []) required.add(row.path);
  }
  for (const material of embedded.result.materials) required.add(material.repositoryPath);
  for (const component of sources.components) {
    for (const relative of component.licenseFiles || []) required.add(relative);
  }
  for (const row of sources.attributionSources || []) {
    if (row.licenseFile) required.add(row.licenseFile);
  }

  const plan = new Map();
  for (const relative of [...required].sort(compareNames)) {
    const source = pool.get(relative);
    if (!source) throw capsuleError('MATERIAL', `被引用许可证材料缺失：${relative}`);
    if (/^licenses\/package-texts\/([a-f0-9]{64})\.txt$/.test(relative)) {
      const expected = relative.match(/([a-f0-9]{64})\.txt$/)[1];
      if (source.digest !== expected) throw capsuleError('STALE', `package text 文件名哈希漂移：${relative}`);
    }
    plan.set(relative, source.content);
  }
  for (const record of Object.values(overrides.packages)) {
    for (const row of record.licenseFiles || []) {
      const material = pool.get(row.path);
      if (!material || material.digest !== row.sha256) {
        throw capsuleError('STALE', `override material SHA 漂移：${row.path}`);
      }
    }
  }
  for (const material of embedded.result.materials) {
    const pooled = pool.get(material.repositoryPath);
    if (!pooled || pooled.digest !== material.repositorySha256) {
      throw capsuleError('STALE', `embedded material SHA 漂移：${material.id}`);
    }
  }
  for (const row of sources.attributionSources || []) {
    if (!row.licenseFile) continue;
    const pooled = pool.get(row.licenseFile);
    if (!pooled || (row.licenseSha256 && pooled.digest !== row.licenseSha256)) {
      throw capsuleError('STALE', `SOURCES attribution material SHA 漂移：${row.id}`);
    }
  }
  for (const id of SPDX_IDS) {
    const relative = `licenses/SPDX-${id}.txt`;
    if (!plan.has(relative)) throw capsuleError('MATERIAL', `固定 SPDX 全集缺失：${id}`);
  }
  return plan;
}

function writeExclusive(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
}

function aggregateCapsule(options) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, '..');
  if (!/^[a-f0-9]{40}$/.test(options.expectedCommit || '')) {
    throw capsuleError('ARGS', 'expectedCommit 必须是 40 位小写 Git commit');
  }
  const candidate = loadCandidate(repositoryRoot, options.candidateDir);
  const outputDir = validateOutputDir(options.outputDir);
  const roots = options.artifacts.map((item) => realDirectory(item, 'artifact'));
  if (new Set(roots).size !== 3) throw capsuleError('ARTIFACT', '三个 artifact 目录必须互不相同');
  const artifacts = roots.map(discoverArtifact)
    .map((item) => validateArtifact(item, candidate, options.expectedCommit));
  const observedTargets = artifacts.map((item) => item.target);
  if (!sameSet(observedTargets, EXPECTED_TARGETS) || new Set(observedTargets).size !== 3) {
    throw capsuleError('TARGET', `artifact 目标缺失或重复：${observedTargets.join(',')}`);
  }
  artifacts.sort((left, right) => EXPECTED_TARGETS.indexOf(left.target) - EXPECTED_TARGETS.indexOf(right.target));
  validateSharedPackages(artifacts);

  const inventoryOutputRows = artifacts.map((artifact) => ({
    target: artifact.target,
    path: `compliance/inventory-${artifact.target.replace('/', '-')}.json`,
    content: artifact.inventory.content
  }));
  const embeddedSource = readJson(
    path.join(candidate.repositoryRoot, 'compliance', 'embedded-license-materials.json'),
    'production embedded-license-materials'
  ).data;
  const sourcesSource = readJson(
    path.join(candidate.repositoryRoot, 'compliance', 'SOURCES.json'),
    'production SOURCES'
  ).data;
  const overrides = trimOverrides(candidate.overrides, artifacts);
  const embedded = trimEmbedded(embeddedSource, artifacts, inventoryOutputRows);
  const sources = trimSources(sourcesSource, embedded, artifacts);
  const materials = materialPlan(candidate, artifacts, embedded, sources, overrides);
  const wasmPresent = [...actualEmbeddedPackages(artifacts).keys()]
    .some((key) => key.startsWith('@img/sharp-wasm32@'));
  const inventorySource = fs.readFileSync(path.join(candidate.repositoryRoot, 'scripts', 'third-party-inventory.js'), 'utf8');
  const hardcodedWasmBoundary = inventorySource.includes("recipes.get('wasm-vips@");
  const requiresWasmCondition = !wasmPresent && hardcodedWasmBoundary;
  if (requiresWasmCondition) {
    throw capsuleError('WASM', 'third-party-inventory.js 仍无条件要求 wasm-vips，拒绝生成不可复验胶囊');
  }

  const files = new Map();
  for (const row of inventoryOutputRows) files.set(row.path, row.content);
  files.set('compliance/embedded-license-materials.json', jsonBytes(embedded.result));
  files.set('compliance/SOURCES.json', jsonBytes(sources));
  files.set('compliance/package-license-overrides.json', jsonBytes(overrides));
  files.set('candidate/candidate-manifest.json', candidate.manifestContent);
  files.set(`candidate/${path.basename(candidate.lockPath)}`, candidate.lockContent);
  for (const artifact of artifacts) {
    const suffix = artifact.target.replace('/', '-');
    files.set(`evidence/evidence-${suffix}.json`, artifact.evidence.content);
    files.set(`evidence/runtime-manifest-${suffix}.json`, artifact.runtimeManifest.content);
    files.set(`evidence/material-manifest-${suffix}.json`, artifact.materialManifest.content);
  }
  for (const [relative, content] of materials) files.set(relative, content);

  const nativeEvidenceSummary = {
    schemaVersion: 1,
    candidateVersion: VERSION,
    expectedCommit: options.expectedCommit,
    auditedLockSha256: candidate.lockSha256,
    targets: artifacts.map((artifact) => {
      const { entries: _entries, ...tree } = artifact.evidence.data.tree;
      return {
        platform: artifact.inventoryData.target.platform,
        arch: artifact.inventoryData.target.arch,
        inventorySha256: sha256(artifact.inventory.content),
        fullEvidenceSha256: sha256(artifact.evidence.content),
        runtimeManifestSha256: sha256(artifact.runtimeManifest.content),
        materialManifestSha256: sha256(artifact.materialManifest.content),
        runtime: artifact.evidence.data.runtime,
        tree,
        nativeBinaries: artifact.evidence.data.nativeBinaries,
        targetNativeProofs: artifact.evidence.data.targetNativeProofs,
        dumpConfig: artifact.evidence.data.dumpConfig
      };
    })
  };
  files.set('native-evidence-summary.json', jsonBytes(nativeEvidenceSummary));

  const capsuleManifest = {
    schemaVersion: 1,
    candidateVersion: VERSION,
    expectedCommit: options.expectedCommit,
    auditedLockSha256: candidate.lockSha256,
    runtimePackageIntegrity: candidate.packageIntegrity,
    targets: artifacts.map((artifact) => ({
      platform: artifact.inventoryData.target.platform,
      arch: artifact.inventoryData.target.arch,
      inventorySha256: sha256(artifact.inventory.content),
      evidenceSha256: sha256(artifact.evidence.content),
      runtimeManifestSha256: sha256(artifact.runtimeManifest.content),
      materialManifestSha256: sha256(artifact.materialManifest.content)
    })),
    compliance: {
      embeddedLicenseMaterialsSha256: sha256(files.get('compliance/embedded-license-materials.json')),
      sourcesSha256: sha256(files.get('compliance/SOURCES.json')),
      packageLicenseOverridesSha256: sha256(files.get('compliance/package-license-overrides.json')),
      nativeEvidenceSummarySha256: sha256(files.get('native-evidence-summary.json')),
      overrideKeys: Object.keys(overrides.packages),
      licenseFiles: [...materials.keys()],
      licenseMaterials: [...materials].map(([relative, content]) => ({
        path: relative,
        bytes: content.length,
        sha256: sha256(content)
      }))
    },
    wasm: {
      present: wasmPresent,
      requiresThirdPartyInventoryConditionalCheck: requiresWasmCondition
    }
  };
  files.set('capsule-manifest.json', jsonBytes(capsuleManifest));

  const parent = path.dirname(outputDir);
  const staging = fs.mkdtempSync(path.join(parent, '.dsh-capsule-stage-'));
  try {
    for (const [relative, content] of [...files.entries()].sort((left, right) => compareNames(left[0], right[0]))) {
      const destination = path.resolve(staging, relative);
      if (!inside(staging, destination)) throw capsuleError('OUTPUT', `输出路径逃逸：${relative}`);
      writeExclusive(destination, content);
    }
    fs.renameSync(staging, outputDir);
  } catch (error) {
    if (fs.existsSync(staging) && inside(parent, staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    outputDir,
    capsuleManifest,
    fileCount: files.size,
    requiresWasmCondition
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = aggregateCapsule(options);
  if (result.requiresWasmCondition) {
    console.error('DSH_CANDIDATE_CAPSULE_WASM_CONDITION_REQUIRED third-party-inventory.js 的 wasm-vips 边界检查必须先按实际容器条件化');
  }
  console.log(JSON.stringify({
    status: 'PASS',
    outputDir: result.outputDir,
    files: result.fileCount,
    wasmPresent: result.capsuleManifest.wasm.present,
    requiresWasmCondition: result.requiresWasmCondition
  }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.message ? error.message : 'DSH_CANDIDATE_CAPSULE_UNKNOWN');
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_TARGETS,
  SPDX_IDS,
  VERSION,
  aggregateCapsule,
  licenseFindingEntry,
  parseArgs,
  sha256,
  validateOutputDir
};
