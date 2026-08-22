'use strict';

// 精确核对 fresh CI 聚合结果与仓库中批准的 dsh 候选胶囊。
// 纯 Node、只读；不执行 runtime，不联网，也不写任何目录。

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = '0.1.1-rc.2';
const TEMP_PREFIX = 'whaledock-dsh-capsule-';
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const TARGETS = Object.freeze(['darwin/arm64', 'darwin/x64', 'win32/x64']);
const SUFFIXES = Object.freeze(['darwin-arm64', 'darwin-x64', 'win32-x64']);
const TARGET_BY_SUFFIX = Object.freeze({
  'darwin-arm64': 'darwin/arm64',
  'darwin-x64': 'darwin/x64',
  'win32-x64': 'win32/x64'
});
const COMPLIANCE_FILES = Object.freeze([
  'SOURCES.json',
  'embedded-license-materials.json',
  'inventory-darwin-arm64.json',
  'inventory-darwin-x64.json',
  'inventory-win32-x64.json',
  'package-license-overrides.json'
]);
const RUNTIME_MANIFEST_FILES = Object.freeze(
  SUFFIXES.map((suffix) => `runtime-manifest-${suffix}.json`)
);
const RAW_EVIDENCE_FILES = Object.freeze(
  SUFFIXES.map((suffix) => `evidence-${suffix}.json`)
);
const MATERIAL_MANIFEST_FILES = Object.freeze(
  SUFFIXES.map((suffix) => `material-manifest-${suffix}.json`)
);

function verifyError(code, message) {
  const error = new Error(`DSH_CANDIDATE_CAPSULE_VERIFY_${code} ${message}`);
  error.code = `ERR_DSH_CANDIDATE_CAPSULE_VERIFY_${code}`;
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
    throw verifyError('PATH', `${label}路径无效`);
  }
  const resolved = path.resolve(requested);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw verifyError('PATH', `${label}必须是真实目录：${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function temporaryDirectory(requested, label) {
  const directory = realDirectory(requested, label);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temporaryRoot, directory);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..'
      || path.isAbsolute(relative) || !segments.length
      || !segments[0].startsWith(TEMP_PREFIX)
      || segments[0].length === TEMP_PREFIX.length) {
    throw verifyError('PATH', `${label}必须位于系统临时目录的 ${TEMP_PREFIX}* 根内`);
  }
  return directory;
}

function parseArgs(argv) {
  const values = new Map();
  const supported = new Set(['candidate-dir', 'generated-dir', 'mirror-dir', 'repository-root']);
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
      throw verifyError('ARGS', `不支持的参数：${String(token)}`);
    }
    if (!supported.has(name)) throw verifyError('ARGS', `不支持的参数：--${name}`);
    if (typeof value !== 'string' || !value || value.includes('\0')) {
      throw verifyError('ARGS', `--${name} 缺少有效值`);
    }
    if (values.has(name)) throw verifyError('ARGS', `--${name} 不能重复`);
    values.set(name, value);
  }
  if (!values.has('candidate-dir') || !values.has('generated-dir')) {
    throw verifyError('ARGS', '必须提供 --candidate-dir 与 --generated-dir');
  }
  return {
    candidateDir: values.get('candidate-dir'),
    generatedDir: values.get('generated-dir'),
    mirrorDir: values.get('mirror-dir'),
    repositoryRoot: values.get('repository-root')
  };
}

function scanTree(root, label) {
  const directories = [];
  const files = new Map();
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareNames(left.name, right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relative = portable(path.relative(root, fullPath));
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw verifyError('SYMLINK', `${label}含符号链接：${relative}`);
      if (stat.isDirectory()) {
        directories.push(relative);
        visit(fullPath);
      } else if (stat.isFile()) {
        if (stat.size < 1 || stat.size > MAX_FILE_BYTES) {
          throw verifyError('FILE', `${label}文件字节数异常：${relative} bytes=${stat.size}`);
        }
        const content = fs.readFileSync(fullPath);
        if (content.length !== stat.size) throw verifyError('FILE', `${label}文件读取期间变化：${relative}`);
        files.set(relative, { fullPath, content, bytes: content.length, sha256: sha256(content) });
      } else {
        throw verifyError('FILE', `${label}含不支持的文件类型：${relative}`);
      }
      if (files.size + directories.length > 100000) throw verifyError('FILE', `${label}项目数超过上限`);
    }
  }
  visit(root);
  directories.sort(compareNames);
  return { root, directories, files };
}

function immediateNames(directory, label) {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(directory, entry.name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) throw verifyError('SYMLINK', `${label}含符号链接：${entry.name}`);
    if (!stat.isDirectory() && !stat.isFile()) throw verifyError('FILE', `${label}含不支持的项目：${entry.name}`);
    return entry.name;
  }).sort(compareNames);
}

function exactNames(directory, expected, label) {
  const actual = immediateNames(directory, label);
  const wanted = [...expected].sort(compareNames);
  const missing = wanted.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !wanted.includes(name));
  if (missing.length) throw verifyError('MISSING', `${label}缺少：${missing.join(',')}`);
  if (extra.length) throw verifyError('EXTRA', `${label}额外：${extra.join(',')}`);
}

function exactSubsetNames(directory, required, allowedOptional, label) {
  const actual = immediateNames(directory, label);
  const missing = required.filter((name) => !actual.includes(name));
  const allowed = new Set([...required, ...allowedOptional]);
  const extra = actual.filter((name) => !allowed.has(name));
  if (missing.length) throw verifyError('MISSING', `${label}缺少：${missing.join(',')}`);
  if (extra.length) throw verifyError('EXTRA', `${label}额外：${extra.join(',')}`);
}

function readJsonRow(filePath, label) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES) {
    throw verifyError('FILE', `${label}必须是非空普通 JSON 文件`);
  }
  const content = fs.readFileSync(filePath);
  let data;
  try { data = JSON.parse(content.toString('utf8')); } catch (_error) {
    throw verifyError('JSON', `${label}不是有效 JSON`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw verifyError('JSON', `${label}顶层必须是对象`);
  }
  return { content, data };
}

function targetKey(value) {
  return value && `${value.platform}/${value.arch}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareNames);
}

function exactTargetSet(values, label) {
  const actual = values.map(targetKey);
  if (actual.length !== TARGETS.length
      || JSON.stringify(sortedUnique(actual)) !== JSON.stringify(TARGETS)) {
    throw verifyError('TARGET', `${label}目标集不精确：${actual.join(',')}`);
  }
}

function exactSuffixTarget(value, suffix, label) {
  const actual = targetKey(value);
  if (actual !== TARGET_BY_SUFFIX[suffix]) {
    throw verifyError('TARGET', `${label}目标与文件名不匹配：expected=${TARGET_BY_SUFFIX[suffix]} actual=${actual}`);
  }
}

function targetMap(values, label) {
  exactTargetSet(values, label);
  return new Map(values.map((value) => [targetKey(value), value]));
}

function equalBytes(leftPath, rightPath, label) {
  const left = readJsonOrBytes(leftPath, `${label} approved`);
  const right = readJsonOrBytes(rightPath, `${label} generated`);
  if (left.length !== right.length || !left.equals(right)) {
    throw verifyError('DRIFT', `${label}字节漂移 approved=${sha256(left)} generated=${sha256(right)}`);
  }
}

function readJsonOrBytes(filePath, label) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES) {
    throw verifyError('FILE', `${label}必须是非空普通文件`);
  }
  return fs.readFileSync(filePath);
}

function assertBoundFile(row, filePath, expectedPath, label) {
  const content = readJsonOrBytes(filePath, label);
  if (!row || typeof row !== 'object' || Array.isArray(row)
      || row.path !== expectedPath || row.bytes !== content.length
      || row.sha256 !== sha256(content)) {
    throw verifyError('BINDING', `${label}未精确绑定实际文件：${expectedPath}`);
  }
  return content;
}

function assertHash(value, content, label) {
  const actual = sha256(content);
  if (value !== actual) throw verifyError('BINDING', `${label} SHA 漂移 expected=${actual} actual=${value}`);
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw verifyError('BINDING', `${label}未绑定 raw evidence`);
  }
}

function compareTrees(leftRoot, rightRoot, label) {
  const left = scanTree(leftRoot, `${label} approved`);
  const right = scanTree(rightRoot, `${label} generated`);
  if (JSON.stringify(left.directories) !== JSON.stringify(right.directories)) {
    const missing = right.directories.filter((name) => !left.directories.includes(name));
    const extra = left.directories.filter((name) => !right.directories.includes(name));
    throw verifyError(missing.length ? 'MISSING' : 'EXTRA', `${label}目录树不一致 missing=${missing.join(',') || '空'} extra=${extra.join(',') || '空'}`);
  }
  const leftFiles = [...left.files.keys()];
  const rightFiles = [...right.files.keys()];
  const missing = rightFiles.filter((name) => !left.files.has(name));
  const extra = leftFiles.filter((name) => !right.files.has(name));
  if (missing.length) throw verifyError('MISSING', `${label}缺少文件：${missing.join(',')}`);
  if (extra.length) throw verifyError('EXTRA', `${label}额外文件：${extra.join(',')}`);
  for (const relative of rightFiles) {
    const approved = left.files.get(relative);
    const generated = right.files.get(relative);
    if (approved.bytes !== generated.bytes || approved.sha256 !== generated.sha256) {
      throw verifyError('DRIFT', `${label}字节漂移：${relative} approved=${approved.sha256} generated=${generated.sha256}`);
    }
  }
  return { files: rightFiles.length, directories: right.directories.length };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeManifestProjection(value) {
  const projected = clone(value);
  delete projected.generatedAt;
  return projected;
}

function capsuleManifestProjection(value) {
  const projected = clone(value);
  // fresh CI 必须由聚合器先绑定本次 GITHUB_SHA；批准胶囊跨提交持久化时，
  // 只忽略这个已在 material manifest 入口强校验过的运行批次身份。
  delete projected.expectedCommit;
  for (const target of projected.targets || []) {
    delete target.evidenceSha256;
    delete target.runtimeManifestSha256;
    delete target.materialManifestSha256;
  }
  if (projected.compliance) delete projected.compliance.nativeEvidenceSummarySha256;
  return projected;
}

function nativeSummaryProjection(value) {
  const projected = clone(value);
  delete projected.expectedCommit;
  for (const target of projected.targets || []) {
    delete target.fullEvidenceSha256;
    delete target.runtimeManifestSha256;
    delete target.materialManifestSha256;
    if (target.runtime) delete target.runtime.manifestSha256;
    if (target.tree) {
      delete target.tree.canonicalSha256;
      delete target.tree.compressedBytes;
      delete target.tree.compressedSha256;
    }
  }
  return projected;
}

function materialManifestProjection(value) {
  const projected = clone(value);
  delete projected.gitCommit;
  for (const field of ['evidence', 'runtimeManifest']) {
    if (!projected[field]) continue;
    delete projected[field].bytes;
    delete projected[field].sha256;
  }
  return projected;
}

function compareProjection(approvedPath, generatedPath, projector, label) {
  const approved = readJsonRow(approvedPath, `${label} approved`).data;
  const generated = readJsonRow(generatedPath, `${label} generated`).data;
  const left = JSON.stringify(projector(approved));
  const right = JSON.stringify(projector(generated));
  if (left !== right) {
    throw verifyError('DRIFT', `${label}稳定投影漂移 approved=${sha256(left)} generated=${sha256(right)}`);
  }
  return { approved, generated };
}

function validateCandidateRoot(repositoryRoot, candidateDir, generatedDir) {
  const candidatesRoot = realDirectory(path.join(repositoryRoot, 'compliance', 'candidates'), '候选合规根');
  if (candidateDir === candidatesRoot || !inside(candidatesRoot, candidateDir)) {
    throw verifyError('PATH', 'candidate-dir 必须是 compliance/candidates 下的具体候选目录');
  }
  const manifestPath = path.join(candidateDir, 'candidate-manifest.json');
  const manifest = readJsonRow(manifestPath, 'candidate manifest').data;
  if (manifest.schemaVersion !== 1 || manifest.packageVersion !== VERSION
      || !manifest.auditedLock || typeof manifest.auditedLock.path !== 'string'
      || path.isAbsolute(manifest.auditedLock.path) || manifest.auditedLock.path.includes('\0')
      || path.dirname(manifest.auditedLock.path) !== '.') {
    throw verifyError('IDENTITY', `candidate manifest 必须在顶层精确锁定 ${VERSION}`);
  }
  exactTargetSet(manifest.targets || [], 'candidate manifest');
  const lockName = manifest.auditedLock.path;
  exactNames(candidateDir, [
    'candidate-manifest.json',
    lockName,
    'package-license-overrides.json',
    'capsule'
  ], 'candidate 顶层');
  const generatedCandidate = realDirectory(path.join(generatedDir, 'candidate'), 'generated candidate');
  exactNames(generatedCandidate, ['candidate-manifest.json', lockName], 'generated candidate');
  equalBytes(manifestPath, path.join(generatedCandidate, 'candidate-manifest.json'), 'candidate manifest');
  equalBytes(path.join(candidateDir, lockName), path.join(generatedCandidate, lockName), 'candidate audited lock');
  const lock = readJsonRow(path.join(candidateDir, lockName), 'candidate audited lock');
  if (sha256(lock.content) !== manifest.auditedLock.sha256) throw verifyError('IDENTITY', 'candidate audited lock SHA 漂移');
  equalBytes(
    path.join(candidateDir, 'package-license-overrides.json'),
    path.join(generatedDir, 'compliance', 'package-license-overrides.json'),
    'candidate package overrides'
  );
  return { manifest, lockName };
}

function validateGeneratedBindings(repositoryRoot, candidateDir, generatedDir) {
  const generatedCapsule = readJsonRow(
    path.join(generatedDir, 'capsule-manifest.json'),
    'generated capsule manifest'
  );
  const generatedSummary = readJsonRow(
    path.join(generatedDir, 'native-evidence-summary.json'),
    'generated native evidence summary'
  );
  const capsule = generatedCapsule.data;
  const summary = generatedSummary.data;
  if (capsule.schemaVersion !== 1 || capsule.candidateVersion !== VERSION
      || summary.schemaVersion !== 1 || summary.candidateVersion !== VERSION
      || !/^[a-f0-9]{40}$/.test(capsule.expectedCommit || '')
      || capsule.expectedCommit !== summary.expectedCommit) {
    throw verifyError('BINDING', 'generated capsule/native summary commit 或身份未闭合');
  }
  const capsuleTargets = targetMap(capsule.targets || [], 'generated capsule manifest');
  const summaryTargets = targetMap(summary.targets || [], 'generated native evidence summary');
  const candidateManifestRelative = portable(path.relative(
    repositoryRoot,
    path.join(candidateDir, 'candidate-manifest.json')
  ));
  const generatedCandidateManifest = path.join(generatedDir, 'candidate', 'candidate-manifest.json');

  for (const suffix of SUFFIXES) {
    const expectedTarget = TARGET_BY_SUFFIX[suffix];
    const inventoryPath = path.join(generatedDir, 'compliance', `inventory-${suffix}.json`);
    const evidencePath = path.join(generatedDir, 'evidence', `evidence-${suffix}.json`);
    const runtimePath = path.join(generatedDir, 'evidence', `runtime-manifest-${suffix}.json`);
    const materialPath = path.join(generatedDir, 'evidence', `material-manifest-${suffix}.json`);
    const inventory = readJsonRow(inventoryPath, `generated inventory ${suffix}`);
    const evidence = readJsonRow(evidencePath, `generated evidence ${suffix}`);
    const runtime = readJsonRow(runtimePath, `generated runtime manifest ${suffix}`);
    const material = readJsonRow(materialPath, `generated material manifest ${suffix}`);
    exactSuffixTarget(inventory.data.target, suffix, `inventory-${suffix}.json`);
    exactSuffixTarget(evidence.data.runtime, suffix, `evidence-${suffix}.json`);
    exactSuffixTarget(runtime.data, suffix, `runtime-manifest-${suffix}.json`);
    exactSuffixTarget(material.data.target, suffix, `material-manifest-${suffix}.json`);
    if (inventory.data.schemaVersion !== 2 || inventory.data.runtimeVersion !== VERSION
        || evidence.data.schemaVersion !== 1 || evidence.data.runtime.version !== VERSION
        || runtime.data.schemaVersion !== 3 || runtime.data.dshVersion !== VERSION
        || material.data.schemaVersion !== 1 || material.data.candidateVersion !== VERSION
        || material.data.gitCommit !== capsule.expectedCommit
        || !Array.isArray(material.data.referencedLicenseMaterials)) {
      throw verifyError('BINDING', `${suffix} generated candidate/evidence/material 身份未闭合`);
    }

    assertBoundFile(
      material.data.candidateManifest,
      generatedCandidateManifest,
      candidateManifestRelative,
      `${suffix} material candidate manifest`
    );
    assertBoundFile(
      material.data.inventory,
      inventoryPath,
      `inventory-${suffix}.json`,
      `${suffix} material inventory`
    );
    assertBoundFile(
      material.data.evidence,
      evidencePath,
      `evidence-${suffix}.json`,
      `${suffix} material evidence`
    );
    assertBoundFile(
      material.data.runtimeManifest,
      runtimePath,
      `runtime-manifest-${suffix}.json`,
      `${suffix} material runtime manifest`
    );

    const referenced = new Set();
    for (const row of material.data.referencedLicenseMaterials) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
          || typeof row.path !== 'string' || typeof row.uploaded !== 'boolean'
          || !row.path.startsWith('licenses/') || path.posix.isAbsolute(row.path)
          || path.posix.normalize(row.path) !== row.path || /[\\\0\r\n]/.test(row.path)
          || row.path.split('/').some((part) => !part || part === '.' || part === '..')
          || referenced.has(row.path)) {
        throw verifyError('BINDING', `${suffix} referenced license material 路径无效或重复`);
      }
      referenced.add(row.path);
      assertBoundFile(
        row,
        path.join(generatedDir, ...row.path.split('/')),
        row.path,
        `${suffix} referenced license material`
      );
    }

    const capsuleTarget = capsuleTargets.get(expectedTarget);
    const summaryTarget = summaryTargets.get(expectedTarget);
    assertHash(capsuleTarget.inventorySha256, inventory.content, `${suffix} capsule inventory`);
    assertHash(capsuleTarget.evidenceSha256, evidence.content, `${suffix} capsule evidence`);
    assertHash(capsuleTarget.runtimeManifestSha256, runtime.content, `${suffix} capsule runtime manifest`);
    assertHash(capsuleTarget.materialManifestSha256, material.content, `${suffix} capsule material manifest`);
    assertHash(summaryTarget.inventorySha256, inventory.content, `${suffix} summary inventory`);
    assertHash(summaryTarget.fullEvidenceSha256, evidence.content, `${suffix} summary evidence`);
    assertHash(summaryTarget.runtimeManifestSha256, runtime.content, `${suffix} summary runtime manifest`);
    assertHash(summaryTarget.materialManifestSha256, material.content, `${suffix} summary material manifest`);
    if (!evidence.data.tree || typeof evidence.data.tree !== 'object'
        || Array.isArray(evidence.data.tree)) {
      throw verifyError('BINDING', `${suffix} raw evidence tree 无效`);
    }
    const { entries: _entries, ...aggregateTree } = evidence.data.tree;
    assertJsonEqual(summaryTarget.runtime, evidence.data.runtime, `${suffix} summary runtime`);
    assertJsonEqual(summaryTarget.tree, aggregateTree, `${suffix} summary tree`);
    assertJsonEqual(summaryTarget.nativeBinaries, evidence.data.nativeBinaries, `${suffix} summary native binaries`);
    assertJsonEqual(summaryTarget.targetNativeProofs, evidence.data.targetNativeProofs, `${suffix} summary target proofs`);
    assertJsonEqual(summaryTarget.dumpConfig, evidence.data.dumpConfig, `${suffix} summary dump-config`);
  }

  if (!capsule.compliance || typeof capsule.compliance !== 'object') {
    throw verifyError('BINDING', 'generated capsule compliance 身份缺失');
  }
  assertHash(
    capsule.compliance.embeddedLicenseMaterialsSha256,
    readJsonOrBytes(path.join(generatedDir, 'compliance', 'embedded-license-materials.json'), 'generated embedded materials'),
    'capsule embedded materials'
  );
  assertHash(
    capsule.compliance.sourcesSha256,
    readJsonOrBytes(path.join(generatedDir, 'compliance', 'SOURCES.json'), 'generated SOURCES'),
    'capsule SOURCES'
  );
  assertHash(
    capsule.compliance.packageLicenseOverridesSha256,
    readJsonOrBytes(path.join(generatedDir, 'compliance', 'package-license-overrides.json'), 'generated overrides'),
    'capsule package overrides'
  );
  assertHash(
    capsule.compliance.nativeEvidenceSummarySha256,
    generatedSummary.content,
    'capsule native evidence summary'
  );
}

function validateJsonTargets(capsuleDir, generatedDir) {
  const inventories = [];
  for (const suffix of SUFFIXES) {
    const row = readJsonRow(
      path.join(generatedDir, 'compliance', `inventory-${suffix}.json`),
      `generated inventory ${suffix}`
    ).data;
    if (row.schemaVersion !== 2 || row.runtimeVersion !== VERSION) {
      throw verifyError('IDENTITY', `inventory ${suffix} 版本/schema 不匹配`);
    }
    exactSuffixTarget(row.target, suffix, `inventory-${suffix}.json`);
    inventories.push(row.target);
  }
  exactTargetSet(inventories, 'generated inventories');

  const manifests = [];
  for (const suffix of SUFFIXES) {
    const file = `runtime-manifest-${suffix}.json`;
    const approvedPath = path.join(capsuleDir, 'runtime-manifests', file);
    const generatedPath = path.join(generatedDir, 'evidence', file);
    const compared = compareProjection(approvedPath, generatedPath, runtimeManifestProjection, file);
    if (compared.approved.schemaVersion !== 3 || compared.approved.dshVersion !== VERSION) {
      throw verifyError('IDENTITY', `${file} 版本/schema 不匹配`);
    }
    exactSuffixTarget(compared.approved, suffix, `${file} approved`);
    exactSuffixTarget(compared.generated, suffix, `${file} generated`);
    manifests.push(compared.approved);
  }
  exactTargetSet(manifests, 'runtime manifests');

  const materialManifests = [];
  for (const suffix of SUFFIXES) {
    const file = `material-manifest-${suffix}.json`;
    const compared = compareProjection(
      path.join(capsuleDir, 'material-manifests', file),
      path.join(generatedDir, 'evidence', file),
      materialManifestProjection,
      file
    );
    if (compared.approved.schemaVersion !== 1
        || compared.approved.candidateVersion !== VERSION
        || !Array.isArray(compared.approved.referencedLicenseMaterials)) {
      throw verifyError('IDENTITY', `${file} 版本/schema/materials 不匹配`);
    }
    exactSuffixTarget(compared.approved.target, suffix, `${file} approved`);
    exactSuffixTarget(compared.generated.target, suffix, `${file} generated`);
    materialManifests.push(compared.approved);
  }
  exactTargetSet(materialManifests.map((row) => row.target), 'material manifests');

  const capsuleManifest = compareProjection(
    path.join(capsuleDir, 'capsule-manifest.json'),
    path.join(generatedDir, 'capsule-manifest.json'),
    capsuleManifestProjection,
    'capsule manifest'
  );
  if (capsuleManifest.approved.schemaVersion !== 1
      || capsuleManifest.approved.candidateVersion !== VERSION) {
    throw verifyError('IDENTITY', 'capsule manifest 版本/schema 不匹配');
  }
  exactTargetSet(capsuleManifest.approved.targets || [], 'capsule manifest');

  const summary = compareProjection(
    path.join(capsuleDir, 'native-evidence-summary.json'),
    path.join(generatedDir, 'native-evidence-summary.json'),
    nativeSummaryProjection,
    'native evidence summary'
  );
  if (summary.approved.schemaVersion !== 1 || summary.approved.candidateVersion !== VERSION) {
    throw verifyError('IDENTITY', 'native evidence summary 版本/schema 不匹配');
  }
  exactTargetSet(summary.approved.targets || [], 'native evidence summary');
  if (!/^[a-f0-9]{40}$/.test(capsuleManifest.approved.expectedCommit || '')
      || capsuleManifest.approved.expectedCommit !== summary.approved.expectedCommit
      || materialManifests.some((row) => row.gitCommit !== capsuleManifest.approved.expectedCommit)) {
    throw verifyError('BINDING', 'approved capsule/native/material commit 身份未闭合');
  }
}

function validateGeneratedLayout(generatedDir) {
  exactNames(generatedDir, [
    'candidate',
    'capsule-manifest.json',
    'compliance',
    'evidence',
    'licenses',
    'native-evidence-summary.json'
  ], 'generated 根');
  exactNames(path.join(generatedDir, 'compliance'), COMPLIANCE_FILES, 'generated compliance');
  exactNames(
    path.join(generatedDir, 'evidence'),
    [...RAW_EVIDENCE_FILES, ...RUNTIME_MANIFEST_FILES, ...MATERIAL_MANIFEST_FILES],
    'generated evidence'
  );
  const rawTargets = [];
  for (const file of RAW_EVIDENCE_FILES) {
    const evidence = readJsonRow(path.join(generatedDir, 'evidence', file), `generated ${file}`).data;
    if (evidence.schemaVersion !== 1 || !evidence.runtime || evidence.runtime.version !== VERSION) {
      throw verifyError('IDENTITY', `${file} 版本/schema 不匹配`);
    }
    exactSuffixTarget(evidence.runtime, file.slice('evidence-'.length, -'.json'.length), file);
    rawTargets.push(evidence.runtime);
  }
  exactTargetSet(rawTargets, 'generated raw evidence');
  scanTree(generatedDir, 'generated 根');
}

function validateCapsuleLayout(capsuleDir, withMirror) {
  const required = [
    'capsule-manifest.json',
    'compliance',
    'licenses',
    'material-manifests',
    'native-evidence-summary.json',
    'runtime-manifests'
  ];
  if (withMirror) required.push('THIRD_PARTY_NOTICES.md');
  exactSubsetNames(
    capsuleDir,
    required,
    ['README.md', 'evidence-provenance.json'],
    'approved capsule 根'
  );
  const readmePath = path.join(capsuleDir, 'README.md');
  if (fs.existsSync(readmePath)) readJsonOrBytes(readmePath, 'approved capsule README.md');
  const provenancePath = path.join(capsuleDir, 'evidence-provenance.json');
  if (fs.existsSync(provenancePath)) {
    const provenance = readJsonRow(provenancePath, 'approved capsule evidence provenance').data;
    if (provenance.schemaVersion !== 1) {
      throw verifyError('IDENTITY', 'approved capsule evidence provenance schema 无效');
    }
  }
  exactNames(
    path.join(capsuleDir, 'compliance'),
    withMirror ? [...COMPLIANCE_FILES, 'SOURCES.md'] : COMPLIANCE_FILES,
    'approved capsule compliance'
  );
  exactNames(path.join(capsuleDir, 'runtime-manifests'), RUNTIME_MANIFEST_FILES, 'approved runtime manifests');
  exactNames(path.join(capsuleDir, 'material-manifests'), MATERIAL_MANIFEST_FILES, 'approved material manifests');
  scanTree(capsuleDir, 'approved capsule 根');
}

function compareExactPersistentSubset(capsuleDir, generatedDir) {
  for (const file of COMPLIANCE_FILES) {
    equalBytes(
      path.join(capsuleDir, 'compliance', file),
      path.join(generatedDir, 'compliance', file),
      `compliance/${file}`
    );
  }
  const licenses = compareTrees(
    path.join(capsuleDir, 'licenses'),
    path.join(generatedDir, 'licenses'),
    'licenses'
  );
  equalBytes(
    path.join(capsuleDir, 'compliance', 'package-license-overrides.json'),
    path.join(generatedDir, 'compliance', 'package-license-overrides.json'),
    'capsule package overrides'
  );
  return licenses;
}

function verifyMirror(capsuleDir, mirrorDir) {
  scanTree(mirrorDir, 'mirror 根');
  equalBytes(
    path.join(capsuleDir, 'compliance', 'SOURCES.md'),
    path.join(mirrorDir, 'compliance', 'SOURCES.md'),
    'generated SOURCES.md'
  );
  equalBytes(
    path.join(capsuleDir, 'THIRD_PARTY_NOTICES.md'),
    path.join(mirrorDir, 'THIRD_PARTY_NOTICES.md'),
    'generated THIRD_PARTY_NOTICES.md'
  );
}

function verifyCapsule(options) {
  const repositoryRoot = realDirectory(options.repositoryRoot || path.resolve(__dirname, '..'), '仓库根');
  const candidateDir = realDirectory(options.candidateDir, 'candidate-dir');
  const generatedDir = temporaryDirectory(options.generatedDir, 'generated-dir');
  const mirrorDir = options.mirrorDir ? temporaryDirectory(options.mirrorDir, 'mirror-dir') : null;
  const capsuleDir = realDirectory(path.join(candidateDir, 'capsule'), 'approved capsule');

  validateGeneratedLayout(generatedDir);
  const candidate = validateCandidateRoot(repositoryRoot, candidateDir, generatedDir);
  validateGeneratedBindings(repositoryRoot, candidateDir, generatedDir);
  validateCapsuleLayout(capsuleDir, Boolean(mirrorDir));
  const licenses = compareExactPersistentSubset(capsuleDir, generatedDir);
  validateJsonTargets(capsuleDir, generatedDir);
  if (mirrorDir) verifyMirror(capsuleDir, mirrorDir);

  return {
    status: 'PASS',
    candidateVersion: candidate.manifest.packageVersion,
    targets: [...TARGETS],
    licenseFiles: licenses.files,
    mirrorVerified: Boolean(mirrorDir)
  };
}

function main(argv = process.argv.slice(2)) {
  const result = verifyCapsule(parseArgs(argv));
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.message ? error.message : 'DSH_CANDIDATE_CAPSULE_VERIFY_UNKNOWN');
    process.exitCode = 1;
  }
}

module.exports = {
  COMPLIANCE_FILES,
  MATERIAL_MANIFEST_FILES,
  RAW_EVIDENCE_FILES,
  RUNTIME_MANIFEST_FILES,
  TARGETS,
  VERSION,
  capsuleManifestProjection,
  materialManifestProjection,
  nativeSummaryProjection,
  parseArgs,
  runtimeManifestProjection,
  sha256,
  temporaryDirectory,
  verifyCapsule
};
