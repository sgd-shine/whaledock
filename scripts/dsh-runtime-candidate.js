'use strict';
// dsh 升级候选只读入口：校验候选 manifest、audited lock、原生目标和临时输出边界。
// 本模块不启动 npm、不加载候选包代码，也不修改任何文件。
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATE_SCHEMA_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_LOCK_BYTES = 32 * 1024 * 1024;
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const SUPPORTED_ARCHES = new Set(['arm64', 'x64']);

function candidateError(code, message) {
  const error = new Error(`DSH_CANDIDATE_${code} ${message}`);
  error.code = `ERR_DSH_CANDIDATE_${code}`;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw candidateError('MANIFEST', `${label}必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw candidateError('MANIFEST', `${label}字段不精确：${actual.join(',') || '空'}`);
  }
}

function readRegularFile(filePath, maximumBytes, label) {
  let lstat;
  try { lstat = fs.lstatSync(filePath); } catch (error) {
    throw candidateError('PATH', `${label}不可读：${filePath} (${error.code || error.message})`);
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw candidateError('PATH', `${label}必须是非符号链接的普通文件：${filePath}`);
  }
  if (lstat.size < 2 || lstat.size > maximumBytes) {
    throw candidateError('PATH', `${label}大小异常：${lstat.size}`);
  }
  return fs.readFileSync(filePath);
}

function inside(rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function realDirectory(dirPath, label) {
  let resolved;
  try { resolved = fs.realpathSync(dirPath); } catch (error) {
    throw candidateError('PATH', `${label}不存在：${dirPath} (${error.code || error.message})`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw candidateError('PATH', `${label}必须是目录：${resolved}`);
  }
  return resolved;
}

function validateTemporaryOutputDir(outputDir, temporaryDir = os.tmpdir()) {
  if (typeof outputDir !== 'string' || !outputDir || outputDir.includes('\0')
      || !path.isAbsolute(outputDir)) {
    throw candidateError('OUTPUT', '候选 output-dir 必须是绝对路径');
  }
  if (fs.existsSync(outputDir)) {
    throw candidateError('OUTPUT', `候选 output-dir 必须尚不存在：${outputDir}`);
  }
  const temporaryRoot = realDirectory(temporaryDir, '系统临时目录');
  const parent = realDirectory(path.dirname(outputDir), 'output-dir 父目录');
  const normalized = path.join(parent, path.basename(outputDir));
  const relative = path.relative(temporaryRoot, normalized);
  const workspace = relative.split(path.sep)[0];
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !workspace.startsWith('whaledock-dsh-runtime-')) {
    throw candidateError('OUTPUT', `候选 output-dir 必须位于系统临时目录的 whaledock-dsh-runtime-* 工作区：${outputDir}`);
  }
  return normalized;
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const offset = lockPath.lastIndexOf(marker);
  return offset < 0 ? null : lockPath.slice(offset + marker.length);
}

function observedInstallScriptPackages(lock) {
  const observed = new Set();
  for (const [lockPath, entry] of Object.entries(lock.packages || {})) {
    if (!entry || entry.hasInstallScript !== true) continue;
    const name = packageNameFromLockPath(lockPath);
    if (!name || !PACKAGE_NAME.test(name)) {
      throw candidateError('LOCK', `无法识别带安装脚本的 lock 条目：${lockPath}`);
    }
    observed.add(name);
  }
  return [...observed].sort();
}

function validateAllowlist(value, lock) {
  if (!Array.isArray(value)) {
    throw candidateError('MANIFEST', 'installScriptAllowlist 必须是数组');
  }
  const normalized = value.map((name) => {
    if (typeof name !== 'string' || name.length > 214 || !PACKAGE_NAME.test(name)) {
      throw candidateError('MANIFEST', `安装脚本包名不合法：${String(name)}`);
    }
    return name;
  });
  const sorted = [...new Set(normalized)].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(sorted)) {
    throw candidateError('MANIFEST', 'installScriptAllowlist 必须去重并按字节排序');
  }
  const observed = observedInstallScriptPackages(lock);
  if (JSON.stringify(observed) !== JSON.stringify(sorted)) {
    throw candidateError('INSTALL_SCRIPTS', [
      '候选安装脚本闭包与已审核 allowlist 不一致',
      `observed=${observed.join(',') || '空'}`,
      `allowlist=${sorted.join(',') || '空'}`
    ].join('；'));
  }
  return sorted;
}

function validateTargets(value, targetPlatform, targetArch, hostPlatform, hostArch) {
  if (!SUPPORTED_PLATFORMS.has(targetPlatform) || !SUPPORTED_ARCHES.has(targetArch)) {
    throw candidateError('TARGET', `不支持的候选目标：${targetPlatform}/${targetArch}`);
  }
  if (hostPlatform !== targetPlatform || hostArch !== targetArch) {
    throw candidateError('HOST_TARGET', `候选正式取证必须原生执行：host=${hostPlatform}/${hostArch} target=${targetPlatform}/${targetArch}`);
  }
  if (!Array.isArray(value) || value.length < 1) {
    throw candidateError('MANIFEST', 'targets 必须是非空数组');
  }
  const keys = value.map((target, index) => {
    exactKeys(target, ['platform', 'arch'], `targets[${index}]`);
    if (!SUPPORTED_PLATFORMS.has(target.platform) || !SUPPORTED_ARCHES.has(target.arch)) {
      throw candidateError('MANIFEST', `targets[${index}] 不受支持：${target.platform}/${target.arch}`);
    }
    return `${target.platform}/${target.arch}`;
  });
  const sorted = [...new Set(keys)].sort();
  if (JSON.stringify(keys) !== JSON.stringify(sorted)) {
    throw candidateError('MANIFEST', 'targets 必须去重并按 platform/arch 排序');
  }
  const requested = `${targetPlatform}/${targetArch}`;
  if (!sorted.includes(requested)) {
    throw candidateError('TARGET', `候选 manifest 未批准目标：${requested}`);
  }
  return value.map((target) => Object.freeze({ ...target }));
}

function validateCandidateLock(lock, version) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)
      || lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw candidateError('LOCK', '候选 audited lock 必须是 lockfileVersion=3 的 npm lock');
  }
  const root = lock.packages[''];
  const expectedDependencies = { '@deepseek-ai/dsh': version };
  if (!root || root.name !== 'whaledock-dsh-runtime' || root.version !== '0.0.0'
      || JSON.stringify(root.dependencies) !== JSON.stringify(expectedDependencies)) {
    throw candidateError('LOCK', '候选 lock 根必须只精确依赖目标 dsh 版本');
  }
  const dsh = lock.packages['node_modules/@deepseek-ai/dsh'];
  const expectedResolved = `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`;
  if (!dsh || dsh.version !== version || dsh.resolved !== expectedResolved
      || typeof dsh.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dsh.integrity)) {
    throw candidateError('LOCK', '候选 lock 缺少官方 registry 的精确 dsh version/resolved/integrity');
  }
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (!lockPath || !lockPath.includes('node_modules/') || !entry || entry.link === true) continue;
    if (typeof entry.version !== 'string' || !entry.version
        || typeof entry.integrity !== 'string' || !entry.integrity) {
      throw candidateError('LOCK', `lock 条目缺少 version/integrity：${lockPath}`);
    }
  }
  return dsh;
}

function loadCandidateRuntime(options = {}) {
  const repositoryRoot = realDirectory(options.repositoryRoot || path.resolve(__dirname, '..'), '仓库根');
  const candidatesRoot = realDirectory(
    path.join(repositoryRoot, 'compliance', 'candidates'), '候选合规根'
  );
  if (typeof options.manifestPath !== 'string' || !options.manifestPath
      || options.manifestPath.includes('\0')) {
    throw candidateError('PATH', '必须提供 candidate manifest 路径');
  }
  const requestedManifest = path.isAbsolute(options.manifestPath)
    ? path.resolve(options.manifestPath) : path.resolve(repositoryRoot, options.manifestPath);
  const manifestContent = readRegularFile(requestedManifest, MAX_MANIFEST_BYTES, '候选 manifest');
  const manifestPath = fs.realpathSync(requestedManifest);
  if (!inside(candidatesRoot, manifestPath)) {
    throw candidateError('PATH', `候选 manifest 只允许位于 compliance/candidates 下：${manifestPath}`);
  }

  let manifest;
  try { manifest = JSON.parse(manifestContent.toString('utf8')); } catch (error) {
    throw candidateError('MANIFEST', `候选 manifest JSON 无效：${error.message}`);
  }
  exactKeys(manifest, [
    'schemaVersion', 'packageVersion', 'auditedLock', 'targets', 'installScriptAllowlist'
  ], '候选 manifest');
  if (manifest.schemaVersion !== CANDIDATE_SCHEMA_VERSION) {
    throw candidateError('MANIFEST', `不支持的 schemaVersion：${manifest.schemaVersion}`);
  }
  if (typeof manifest.packageVersion !== 'string'
      || !STRICT_SEMVER.test(manifest.packageVersion)) {
    throw candidateError('VERSION', `候选版本必须是严格 SemVer：${String(manifest.packageVersion)}`);
  }
  exactKeys(manifest.auditedLock, ['path', 'sha256'], 'auditedLock');
  if (typeof manifest.auditedLock.path !== 'string' || !manifest.auditedLock.path
      || manifest.auditedLock.path.includes('\0') || path.isAbsolute(manifest.auditedLock.path)) {
    throw candidateError('MANIFEST', 'auditedLock.path 必须是 manifest 目录下的相对路径');
  }
  if (typeof manifest.auditedLock.sha256 !== 'string'
      || !SHA256.test(manifest.auditedLock.sha256)) {
    throw candidateError('MANIFEST', 'auditedLock.sha256 必须是小写 SHA-256');
  }

  const manifestDir = fs.realpathSync(path.dirname(manifestPath));
  const requestedLock = path.resolve(manifestDir, manifest.auditedLock.path);
  const lockContent = readRegularFile(requestedLock, MAX_LOCK_BYTES, '候选 audited lock');
  const auditedLockPath = fs.realpathSync(requestedLock);
  if (!inside(manifestDir, auditedLockPath) || !inside(candidatesRoot, auditedLockPath)) {
    throw candidateError('PATH', `audited lock 必须位于当前候选 manifest 目录下：${auditedLockPath}`);
  }
  const actualLockSha256 = sha256(lockContent);
  if (actualLockSha256 !== manifest.auditedLock.sha256) {
    throw candidateError('LOCK_SHA256', `候选 lock SHA-256 不一致：${actualLockSha256}`);
  }
  let auditedLock;
  try { auditedLock = JSON.parse(lockContent.toString('utf8')); } catch (error) {
    throw candidateError('LOCK', `候选 audited lock JSON 无效：${error.message}`);
  }
  const dsh = validateCandidateLock(auditedLock, manifest.packageVersion);
  const installScriptAllowlist = validateAllowlist(manifest.installScriptAllowlist, auditedLock);
  const targets = validateTargets(
    manifest.targets,
    options.targetPlatform,
    options.targetArch,
    options.hostPlatform || process.platform,
    options.hostArch || process.arch
  );
  const outputDir = validateTemporaryOutputDir(options.outputDir, options.temporaryDir || os.tmpdir());

  return Object.freeze({
    manifestPath,
    manifestSha256: sha256(manifestContent),
    packageVersion: manifest.packageVersion,
    packageIntegrity: dsh.integrity,
    auditedLockPath,
    auditedLockContent: lockContent,
    auditedLock,
    auditedLockSha256: actualLockSha256,
    installScriptAllowlist: Object.freeze(installScriptAllowlist),
    targets: Object.freeze(targets),
    outputDir
  });
}

module.exports = {
  CANDIDATE_SCHEMA_VERSION,
  STRICT_SEMVER,
  loadCandidateRuntime,
  observedInstallScriptPackages,
  validateTemporaryOutputDir
};
