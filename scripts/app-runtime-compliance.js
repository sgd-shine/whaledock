'use strict';

// 根 App 运行时依赖的独立合规链。它只遍历 package-lock 中从根
// dependencies 可达的闭包，不读写 vendor/dsh-runtime，也不生成 dsh NOTICE。

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SDK_NAME = '@larksuiteoapi/node-sdk';
const SDK_VERSION = '1.73.0';
const COMPLIANCE_RELATIVE = 'compliance/app-runtime';
const INVENTORY_NAME = 'inventory.json';
const NOTICE_NAME = 'THIRD_PARTY_NOTICES.md';
const OVERRIDES_NAME = 'package-license-overrides.json';
const INSTALL_ALLOWLIST_NAME = 'install-script-allowlist.json';
const LICENSE_PREFIX = 'licenses/package-texts';
const ALLOWED_LICENSES = new Set(['MIT', 'BSD-3-Clause', 'Apache-2.0']);
const REQUIRED_OVERRIDE_KEYS = new Set([
  'agent-base@6.0.2',
  'https-proxy-agent@5.0.1'
]);
const INSTALL_LIFECYCLES = ['preinstall', 'install', 'postinstall'];
const APPROVED_INSTALL_SCRIPT = Object.freeze({
  name: 'protobufjs',
  version: '7.6.5',
  lockPath: 'node_modules/protobufjs',
  lifecycle: 'postinstall',
  command: 'node scripts/postinstall',
  scriptPath: 'scripts/postinstall.js',
  sha256: '5af8463b97ee8e309b4a2111f9479bacdf0c180de0ca0155527679b1fc6d9e6c'
});
const PACKAGING_POLICY_VERSION = 1;
const CLEANED_PACKAGE_METADATA = new Set([
  'dist', 'gitHead', 'build', 'jspm', 'ava', 'xo', 'nyc', 'eslintConfig',
  'contributors', 'bundleDependencies', 'tags'
]);
const PACKAGED_EXCLUDED_NAMES = new Set([
  '.git', '.hg', '.svn', 'CVS', 'RCS', 'SCCS', '__pycache__', '.DS_Store',
  'thumbs.db', '.gitignore', '.gitkeep', '.gitattributes', '.npmignore', '.idea',
  '.vs', '.flowconfig', '.jshintrc', '.eslintrc', '.circleci', '.yarn-integrity',
  '.yarn-metadata.json', 'yarn-error.log', 'yarn.lock', 'package-lock.json',
  'npm-debug.log', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'appveyor.yml',
  '.travis.yml', 'circle.yml', '.nyc_output', '.husky', '.github',
  'electron-builder.env', '.DS_Store', 'node_modules', 'CHANGELOG.md', 'ChangeLog',
  'changelog.md', 'Changelog.md', 'Changelog', 'binding.gyp', 'node_gyp_bins'
]);
const PACKAGED_TOP_LEVEL_EXCLUDED = new Set([
  'karma.conf.js', '.coveralls.yml', 'README.md', 'readme.markdown', 'README',
  'readme.md', 'Readme.md', 'Readme', 'readme', 'test', 'tests', '__tests__',
  'powered-test', 'example', 'examples', '.bin'
]);
const PACKAGED_EXCLUDED_SUFFIXES = [
  '.iml', '.hprof', '.orig', '.pyc', '.pyo', '.rbc', '.swp', '.csproj', '.sln',
  '.suo', '.xproj', '.cc', '.d.ts', '.mk', '.a', '.o', '.obj', '.forge-meta', '.pdb'
];

function appError(kind, message) {
  const error = new Error(`APP_RUNTIME_${kind} ${message}`);
  error.code = `APP_RUNTIME_${kind}`;
  return error;
}

function readJson(filePath, label = filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw appError('INPUT', `${label} 无法读取：${error.message}`);
  }
  return data;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n');
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) =>
    left.localeCompare(right)));
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\')
      || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw appError('PATH', `${label} 路径无效：${String(value)}`);
  }
  return value;
}

function packageNameValid(value) {
  return typeof value === 'string'
    && /^(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9._~-]+$/.test(value);
}

function assertRealDirectory(dirPath, label) {
  let stat;
  try { stat = fs.lstatSync(dirPath); }
  catch (_error) { throw appError('MISSING', `${label} 不存在：${dirPath}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw appError('PATH', `${label} 必须是真实目录：${dirPath}`);
  }
}

function assertInside(root, target, label) {
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw appError('PATH', `${label} 越界：${target}`);
  }
  return realTarget;
}

function resolveDependencyPath(lock, fromLockPath, dependencyName) {
  if (!lock || !lock.packages || !packageNameValid(dependencyName)) {
    throw appError('LOCK', `依赖名无效：${String(dependencyName)}`);
  }
  let base = fromLockPath || '';
  for (;;) {
    const candidate = base
      ? `${base}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (Object.prototype.hasOwnProperty.call(lock.packages, candidate)) return candidate;
    if (!base) break;
    const marker = base.lastIndexOf('/node_modules/');
    base = marker < 0 ? '' : base.slice(0, marker);
  }
  throw appError('LOCK', `无法解析依赖边：${fromLockPath || '<root>'} -> ${dependencyName}`);
}

function platformRestriction(entry) {
  const flags = [];
  if (entry.optional === true) flags.push('optional');
  if (entry.devOptional === true) flags.push('devOptional');
  for (const name of ['os', 'cpu', 'libc']) {
    if (Object.prototype.hasOwnProperty.call(entry, name)) flags.push(name);
  }
  if (entry.optionalDependencies && Object.keys(entry.optionalDependencies).length) {
    flags.push('optionalDependencies');
  }
  return flags;
}

function reachableLockPaths(lock) {
  if (!lock || lock.lockfileVersion !== 3 || !lock.packages || !lock.packages['']) {
    throw appError('LOCK', '只支持 npm lockfileVersion 3');
  }
  const rootEntry = lock.packages[''];
  if (rootEntry.optionalDependencies && Object.keys(rootEntry.optionalDependencies).length) {
    throw appError('PLATFORM', '根 optionalDependencies 未获批准');
  }
  const queue = Object.keys(rootEntry.dependencies || {}).sort()
    .map((name) => resolveDependencyPath(lock, '', name));
  const visited = new Set();
  while (queue.length) {
    const lockPath = queue.shift();
    if (visited.has(lockPath)) continue;
    visited.add(lockPath);
    const entry = lock.packages[lockPath];
    if (!entry || entry.dev === true) {
      throw appError('LOCK', `生产边指向缺失或 dev 包：${lockPath}`);
    }
    const restrictions = platformRestriction(entry);
    if (restrictions.length) {
      throw appError('PLATFORM', `${lockPath} 含未批准的平台/可选字段：${restrictions.join(',')}`);
    }
    for (const name of Object.keys(entry.dependencies || {}).sort()) {
      queue.push(resolveDependencyPath(lock, lockPath, name));
    }
  }
  return [...visited].sort();
}

function nativeKind(buffer, relative) {
  const lower = relative.toLowerCase();
  if (/\.(?:node|wasm|dll|dylib|exe)$/.test(lower) || /\.so(?:\.|$)/.test(lower)) {
    return 'extension';
  }
  if (buffer.length >= 4) {
    const first = buffer.subarray(0, 4).toString('hex');
    if (first === '0061736d') return 'wasm';
    if (first === '7f454c46') return 'elf';
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']
      .includes(first)) return 'mach-o';
  }
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return 'pe';
  return '';
}

function packageFiles(packageDir) {
  const rows = [];
  const walk = (dir, relativeDir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!relativeDir && entry.name === 'node_modules') continue;
      const filePath = path.join(dir, entry.name);
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw appError('SYMLINK', `包内符号链接未获批准：${relative}`);
      if (stat.isDirectory()) {
        walk(filePath, relative);
        continue;
      }
      if (!stat.isFile()) throw appError('FILE', `包内特殊文件未获批准：${relative}`);
      const content = fs.readFileSync(filePath);
      const kind = nativeKind(content, relative);
      if (kind) throw appError('NATIVE', `${relative} 检出 ${kind} 原生/wasm 材料`);
      rows.push({ path: relative, size: content.length, sha256: sha256(content) });
    }
  };
  walk(packageDir, '');
  return rows;
}

function packageTreeSha256(files) {
  return sha256(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join('\n'));
}

function assertPackagingPolicy(rootPackage, lock) {
  const build = rootPackage.build || {};
  if (build.asar === false || build.removePackageScripts === false
      || build.removePackageKeywords === false || build.disableDefaultIgnoredFiles === true
      || build.includePdb === true) {
    throw appError('PACKAGING_POLICY', 'electron-builder 生产依赖清理策略不符合锁定模型');
  }
  for (const value of [build.files, build.mac && build.mac.files,
    build.win && build.win.files, build.linux && build.linux.files]) {
    for (const pattern of Array.isArray(value) ? value : value == null ? [] : [value]) {
      if (typeof pattern !== 'string' || pattern.startsWith('!')) {
        throw appError('PACKAGING_POLICY', 'node_modules 不允许自定义排除或对象式 files 规则');
      }
    }
  }
  const builder = lock.packages && lock.packages['node_modules/electron-builder'];
  if (!builder || typeof builder.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(builder.version)) {
    throw appError('PACKAGING_POLICY', 'package-lock 缺少精确 electron-builder 版本');
  }
  return Object.freeze({
    schemaVersion: PACKAGING_POLICY_VERSION,
    electronBuilderVersion: builder.version,
    removePackageScripts: true,
    removePackageKeywords: true,
    disableDefaultIgnoredFiles: false,
    includePdb: false
  });
}

function cleanedDependencyManifest(content) {
  const original = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let data;
  try { data = JSON.parse(original.toString('utf8')); }
  catch (error) { throw appError('PACKAGING_POLICY', `package.json 无法清理：${error.message}`); }
  const dependencies = data.dependencies;
  const removeBabel = dependencies != null && typeof dependencies === 'object'
    && !Object.getOwnPropertyNames(dependencies).some((name) => name.startsWith('babel'));
  let changed = false;
  for (const prop of Object.getOwnPropertyNames(data)) {
    if (prop[0] === '_' || CLEANED_PACKAGE_METADATA.has(prop)
        || prop === 'scripts' || prop === 'keywords' || prop === 'bugs'
        || (removeBabel && prop === 'babel')) {
      delete data[prop];
      changed = true;
    }
  }
  return changed ? Buffer.from(JSON.stringify(data, null, 2)) : original;
}

function isPackagedRuntimeFile(relative, packageName = '') {
  const parts = relative.split('/');
  const name = parts[parts.length - 1];
  if (parts.some((part) => PACKAGED_EXCLUDED_NAMES.has(part) || part.startsWith('._'))
      || PACKAGED_TOP_LEVEL_EXCLUDED.has(parts[0])
      || PACKAGED_EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  if (parent === 'build' && (name === 'gyp-mac-tool' || name === 'Makefile'
      || name.endsWith('.mk') || name.endsWith('.gypi') || name.endsWith('.Makefile'))) return false;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === 'Release' && ['.deps', 'obj.target'].includes(parts[index + 1])) return false;
  }
  if (parts[0] === 'src' && ['keytar', 'keytar-prebuild'].includes(packageName)) return false;
  if (['build', 'deps'].includes(parts[0]) && packageName === 'lzma-native') return false;
  if (['build', 'docs', 'src'].includes(parts[0]) && packageName === 'libui-node') return false;
  return true;
}

function expectedPackagedFiles(packageDir, packageName, files) {
  return files.filter((file) => isPackagedRuntimeFile(file.path, packageName)).map((file) => {
    if (file.path !== 'package.json') return file;
    const content = cleanedDependencyManifest(fs.readFileSync(path.join(packageDir, 'package.json')));
    return { path: file.path, size: content.length, sha256: sha256(content) };
  });
}

function packagedClosureRows(packages) {
  return packages.flatMap((pkg) => pkg.packagedFiles.map((file) => ({
    path: `${pkg.lockPath}/${file.path}`,
    size: file.size,
    sha256: file.sha256
  }))).sort((left, right) => left.path.localeCompare(right.path));
}

function readOverrides(complianceDir) {
  const filePath = path.join(complianceDir, OVERRIDES_NAME);
  const data = readJson(filePath, OVERRIDES_NAME);
  if (data.schemaVersion !== 1 || !data.packages || Array.isArray(data.packages)
      || typeof data.packages !== 'object') {
    throw appError('OVERRIDE', `${OVERRIDES_NAME} schema 无效`);
  }
  const keys = Object.keys(data.packages).sort();
  const expected = [...REQUIRED_OVERRIDE_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw appError('OVERRIDE', `README override 必须恰好为 ${expected.join(',')}`);
  }
  return { filePath, data };
}

function readInstallAllowlist(complianceDir) {
  const filePath = path.join(complianceDir, INSTALL_ALLOWLIST_NAME);
  const data = readJson(filePath, INSTALL_ALLOWLIST_NAME);
  if (data.schemaVersion !== 1 || !Array.isArray(data.packages) || data.packages.length !== 1) {
    throw appError('INSTALL_SCRIPT', `${INSTALL_ALLOWLIST_NAME} 必须只有一项`);
  }
  const actual = data.packages[0];
  for (const [name, expected] of Object.entries(APPROVED_INSTALL_SCRIPT)) {
    if (actual[name] !== expected) {
      throw appError('INSTALL_SCRIPT', `allowlist ${name} 不匹配：${String(actual[name])}`);
    }
  }
  if (Object.keys(actual).sort().join(',') !== Object.keys(APPROVED_INSTALL_SCRIPT).sort().join(',')) {
    throw appError('INSTALL_SCRIPT', 'allowlist 字段集不精确');
  }
  return { filePath, data };
}

function licenseCandidateNames(packageDir) {
  return fs.readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => entry.name).sort();
}

function licenseMaterialsForPackage(context, pkg) {
  const key = `${pkg.name}@${pkg.version}`;
  const override = context.overrides.packages[key];
  let names;
  let isOverride = false;
  if (override) {
    if (!override || typeof override !== 'object' || Array.isArray(override)
        || Object.keys(override).sort().join(',') !== 'packagePath,sha256') {
      throw appError('OVERRIDE', `${key} override 字段集不精确`);
    }
    const packagePath = safeRelative(override.packagePath, `${key} override`);
    if (!/^readme(?:[._-].*)?$/i.test(path.basename(packagePath))
        || packagePath.includes('/')) {
      throw appError('OVERRIDE', `${key} 只允许顶层 README override`);
    }
    if (!/^[a-f0-9]{64}$/.test(override.sha256 || '')) {
      throw appError('OVERRIDE', `${key} override SHA-256 无效`);
    }
    names = [packagePath];
    isOverride = true;
    context.usedOverrides.add(key);
  } else {
    names = licenseCandidateNames(pkg.packageDir);
    if (!names.length) throw appError('LICENSE', `${key} 缺少顶层许可原文`);
  }
  return names.map((name) => {
    const filePath = path.join(pkg.packageDir, name);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw appError('LICENSE', `${key} 许可材料不是普通文件：${name}`);
    }
    const content = fs.readFileSync(filePath);
    if (!content.length) throw appError('LICENSE', `${key} 许可材料为空：${name}`);
    const digest = sha256(content);
    if (isOverride && context.overrides.packages[key].sha256 !== digest) {
      throw appError('OVERRIDE', `${key} README SHA-256 漂移`);
    }
    const repositoryPath = `${LICENSE_PREFIX}/${digest}.txt`;
    const existing = context.materials.get(repositoryPath);
    if (existing && !existing.equals(content)) {
      throw appError('LICENSE', `内容哈希冲突：${repositoryPath}`);
    }
    context.materials.set(repositoryPath, content);
    return { packagePath: name, repositoryPath, sha256: digest, override: isOverride };
  });
}

function manifestPlatformRestrictions(manifest) {
  const flags = [];
  for (const name of ['os', 'cpu', 'libc']) {
    if (Object.prototype.hasOwnProperty.call(manifest, name)) flags.push(name);
  }
  if (manifest.optionalDependencies && Object.keys(manifest.optionalDependencies).length) {
    flags.push('optionalDependencies');
  }
  return flags;
}

function validateInstallScripts(context, pkg, lockEntry, manifest) {
  const records = [];
  for (const lifecycle of INSTALL_LIFECYCLES) {
    if (!manifest.scripts || !Object.prototype.hasOwnProperty.call(manifest.scripts, lifecycle)) continue;
    const command = manifest.scripts[lifecycle];
    if (typeof command !== 'string' || !command) {
      throw appError('INSTALL_SCRIPT', `${pkg.name}@${pkg.version} ${lifecycle} 无效`);
    }
    const allow = context.installAllowlist.packages.find((item) =>
      item.name === pkg.name && item.version === pkg.version
      && item.lockPath === pkg.lockPath && item.lifecycle === lifecycle);
    if (!allow || allow.command !== command) {
      throw appError('INSTALL_SCRIPT', `${pkg.name}@${pkg.version} ${lifecycle} 未在 allowlist`);
    }
    const scriptPath = safeRelative(allow.scriptPath, `${pkg.name} install script`);
    const fullPath = path.join(pkg.packageDir, ...scriptPath.split('/'));
    if (!fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) {
      throw appError('INSTALL_SCRIPT', `${pkg.name}@${pkg.version} 脚本不存在：${scriptPath}`);
    }
    const digest = sha256(fs.readFileSync(fullPath));
    if (digest !== allow.sha256) {
      throw appError('INSTALL_SCRIPT', `${pkg.name}@${pkg.version} 脚本 SHA-256 漂移`);
    }
    context.usedInstallScripts.add(`${pkg.lockPath}\0${lifecycle}`);
    records.push({ ...allow });
  }
  const hasLifecycle = records.length > 0;
  if ((lockEntry.hasInstallScript === true) !== hasLifecycle) {
    throw appError('INSTALL_SCRIPT', `${pkg.lockPath} hasInstallScript 与实际生命周期不一致`);
  }
  return records;
}

function buildNotice(inventory) {
  const lines = [
    '# WhaleDock 根 App 运行时第三方组件通知',
    '',
    '本文件只披露 WhaleDock 根 `dependencies` 的生产可达闭包；`vendor/dsh-runtime` 拥有独立 inventory、NOTICE、SOURCES 与许可材料，两者不混合。',
    '',
    `本次根运行时精确锁定 \`${SDK_NAME}@${SDK_VERSION}\`，生产可达包 ${inventory.packageCount} 个。本文件不是法律意见。`,
    '',
    '## 闭包快照',
    '',
    `- 根 package-lock SHA-256：\`${inventory.packageLockSha256}\``,
    `- 闭包 SHA-256：\`${inventory.closureSha256}\``,
    `- 包数：${inventory.packageCount}`,
    `- 安装树文件：${inventory.fileCount}`,
    `- 安装树字节：${inventory.totalBytes}`,
    `- electron-builder 成品预期文件：${inventory.packagedFileCount}`,
    `- electron-builder 成品树 SHA-256：\`${inventory.packagedTreeSha256}\``,
    '',
    '## 许可证分布',
    '',
    '| 许可证 | 包数 |',
    '| --- | ---: |'
  ];
  for (const [license, count] of Object.entries(inventory.licenseCounts)) {
    lines.push(`| ${license} | ${count} |`);
  }
  lines.push(
    '',
    '本闭包仅允许 MIT、BSD-3-Clause 和 Apache-2.0；未知许可、强/弱 copyleft、原生二进制、wasm 或平台限定都会使生成失败。',
    '',
    '## 安装生命周期放行',
    ''
  );
  for (const item of inventory.installScripts) {
    lines.push(`- \`${item.name}@${item.version}\` \`${item.lifecycle}\`：\`${item.command}\`；\`${item.scriptPath}\` SHA-256 \`${item.sha256}\``);
  }
  lines.push(
    '',
    '## 逐包清单',
    '',
    '| 包 | 版本 | 许可证 | lock 路径 | 精确 tarball | 许可原文 |',
    '| --- | --- | --- | --- | --- | --- |'
  );
  for (const pkg of inventory.packages) {
    const materials = pkg.licenseFiles.map((item, index) =>
      `[${item.override ? 'README 许可声明' : `原文${index + 1}`}](./${item.repositoryPath})`).join('、');
    lines.push(`| ${pkg.name} | ${pkg.version} | ${pkg.license} | \`${pkg.lockPath}\` | [tarball](${pkg.resolved}) | ${materials} |`);
  }
  lines.push('');
  return Buffer.from(lines.join('\n'));
}

function buildCompliance(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  assertRealDirectory(root, '仓库根');
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const complianceDir = path.join(root, COMPLIANCE_RELATIVE);
  assertRealDirectory(complianceDir, 'app-runtime 合规目录');
  const rootPackage = readJson(packagePath, 'package.json');
  const lockContent = fs.readFileSync(lockPath);
  const lock = readJson(lockPath, 'package-lock.json');
  const rootDependencies = sortedObject(rootPackage.dependencies || {});
  const lockRootDependencies = sortedObject(lock.packages && lock.packages['']
    && lock.packages[''].dependencies || {});
  if (rootDependencies[SDK_NAME] !== SDK_VERSION
      || lockRootDependencies[SDK_NAME] !== SDK_VERSION) {
    throw appError('SDK_VERSION', `${SDK_NAME} 必须在 package/lock 精确锁定 ${SDK_VERSION}`);
  }
  if (JSON.stringify(rootDependencies) !== JSON.stringify(lockRootDependencies)) {
    throw appError('LOCK', '根 package.json dependencies 与 lock packages[""] 不一致');
  }
  const packagingPolicy = assertPackagingPolicy(rootPackage, lock);

  const lockPaths = reachableLockPaths(lock);
  const overrideInput = readOverrides(complianceDir);
  const allowlistInput = readInstallAllowlist(complianceDir);
  const context = {
    overrides: overrideInput.data,
    installAllowlist: allowlistInput.data,
    usedOverrides: new Set(),
    usedInstallScripts: new Set(),
    materials: new Map()
  };
  const rootReal = fs.realpathSync(root);
  const packages = [];
  const installScripts = [];
  let fileCount = 0;
  let totalBytes = 0;
  for (const currentLockPath of lockPaths) {
    safeRelative(currentLockPath, 'lock package');
    const lockEntry = lock.packages[currentLockPath];
    const packageDir = path.join(root, ...currentLockPath.split('/'));
    assertRealDirectory(packageDir, `npm 包 ${currentLockPath}`);
    const packageReal = assertInside(rootReal, packageDir, `npm 包 ${currentLockPath}`);
    const manifestPath = path.join(packageReal, 'package.json');
    const manifest = readJson(manifestPath, `${currentLockPath}/package.json`);
    if (!packageNameValid(manifest.name) || typeof manifest.version !== 'string'
        || manifest.version !== lockEntry.version) {
      throw appError('IDENTITY', `${currentLockPath} 包名/版本与 lock 不一致`);
    }
    if (manifest.name === SDK_NAME && manifest.version !== SDK_VERSION) {
      throw appError('SDK_VERSION', `安装树 SDK 不是 ${SDK_VERSION}`);
    }
    if (!ALLOWED_LICENSES.has(manifest.license)) {
      throw appError('LICENSE', `${manifest.name}@${manifest.version} 许可证未批准：${String(manifest.license)}`);
    }
    const manifestRestrictions = manifestPlatformRestrictions(manifest);
    if (manifestRestrictions.length) {
      throw appError('PLATFORM', `${manifest.name}@${manifest.version} manifest 含平台/可选字段：${manifestRestrictions.join(',')}`);
    }
    if (typeof lockEntry.resolved !== 'string' || !/^https:\/\//.test(lockEntry.resolved)
        || typeof lockEntry.integrity !== 'string' || !/^sha512-/.test(lockEntry.integrity)) {
      throw appError('LOCK', `${currentLockPath} 缺少精确 https tarball/integrity`);
    }
    const files = packageFiles(packageReal);
    if (!files.some((file) => file.path === 'package.json')) {
      throw appError('FILE', `${currentLockPath} 缺少 package.json`);
    }
    fileCount += files.length;
    totalBytes += files.reduce((sum, file) => sum + file.size, 0);
    const packagedFiles = expectedPackagedFiles(packageReal, manifest.name, files);
    if (!packagedFiles.some((file) => file.path === 'package.json')) {
      throw appError('PACKAGING_POLICY', `${currentLockPath} 成品预期集缺少 package.json`);
    }
    const pkg = {
      lockPath: currentLockPath,
      packageDir: packageReal,
      name: manifest.name,
      version: manifest.version,
      resolved: lockEntry.resolved,
      integrity: lockEntry.integrity,
      license: manifest.license,
      dependencies: sortedObject(lockEntry.dependencies || {}),
      packageTreeSha256: packageTreeSha256(files),
      files,
      packagedFileCount: packagedFiles.length,
      packagedTreeSha256: packageTreeSha256(packagedFiles),
      packagedFiles
    };
    pkg.licenseFiles = licenseMaterialsForPackage(context, pkg);
    const scripts = validateInstallScripts(context, pkg, lockEntry, manifest);
    installScripts.push(...scripts);
    delete pkg.packageDir;
    packages.push(pkg);
  }
  if (!packages.some((pkg) => pkg.name === SDK_NAME && pkg.version === SDK_VERSION)) {
    throw appError('SDK_VERSION', `闭包未包含 ${SDK_NAME}@${SDK_VERSION}`);
  }
  if (JSON.stringify([...context.usedOverrides].sort())
      !== JSON.stringify([...REQUIRED_OVERRIDE_KEYS].sort())) {
    throw appError('OVERRIDE', '存在未消费 README override');
  }
  const expectedInstallKeys = allowlistInput.data.packages
    .map((item) => `${item.lockPath}\0${item.lifecycle}`).sort();
  if (JSON.stringify([...context.usedInstallScripts].sort()) !== JSON.stringify(expectedInstallKeys)) {
    throw appError('INSTALL_SCRIPT', '存在未消费 install-script allowlist');
  }
  packages.sort((left, right) => left.lockPath.localeCompare(right.lockPath));
  installScripts.sort((left, right) => left.lockPath.localeCompare(right.lockPath));
  const licenseCounts = {};
  for (const pkg of packages) licenseCounts[pkg.license] = (licenseCounts[pkg.license] || 0) + 1;
  const rootDependencyLockPaths = {};
  for (const name of Object.keys(rootDependencies)) {
    rootDependencyLockPaths[name] = resolveDependencyPath(lock, '', name);
  }
  const closureMaterial = packages.map((pkg) => [
    pkg.lockPath, pkg.name, pkg.version, pkg.resolved, pkg.integrity, pkg.license,
    JSON.stringify(pkg.dependencies), pkg.packageTreeSha256, pkg.packagedTreeSha256,
    JSON.stringify(pkg.licenseFiles)
  ].join('\0')).join('\n');
  const packagedRows = packagedClosureRows(packages);
  const inventory = {
    schemaVersion: 2,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    packageLockSha256: sha256(lockContent),
    packagingPolicy,
    rootDependencies,
    rootDependencyLockPaths: sortedObject(rootDependencyLockPaths),
    packageCount: packages.length,
    fileCount,
    totalBytes,
    packagedFileCount: packagedRows.length,
    packagedTotalBytes: packagedRows.reduce((sum, file) => sum + file.size, 0),
    packagedTreeSha256: packageTreeSha256(packagedRows),
    licenseCounts: sortedObject(licenseCounts),
    closureSha256: sha256(closureMaterial),
    installScripts,
    packages
  };
  const files = new Map([
    [INVENTORY_NAME, jsonBytes(inventory)],
    [NOTICE_NAME, buildNotice(inventory)]
  ]);
  for (const [relative, content] of [...context.materials.entries()].sort(([left], [right]) =>
    left.localeCompare(right))) files.set(relative, content);
  return {
    root,
    complianceDir,
    inventory,
    files,
    inputs: new Map([
      [OVERRIDES_NAME, fs.readFileSync(overrideInput.filePath)],
      [INSTALL_ALLOWLIST_NAME, fs.readFileSync(allowlistInput.filePath)]
    ])
  };
}

function expectedTree(plan) {
  return new Map([...plan.inputs, ...plan.files]);
}

function actualRegularFiles(rootDir) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(dir, entry.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw appError('SYMLINK', `合规目录含符号链接：${filePath}`);
      if (stat.isDirectory()) walk(filePath);
      else if (stat.isFile()) files.set(posixRelative(rootDir, filePath), fs.readFileSync(filePath));
      else throw appError('FILE', `合规目录含特殊文件：${filePath}`);
    }
  };
  walk(rootDir);
  return files;
}

function compareTree(expected, actual) {
  const expectedNames = [...expected.keys()].sort();
  const actualNames = [...actual.keys()].sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    throw appError('COMPLIANCE_MISMATCH', `文件集不一致 expected=${expectedNames.length} actual=${actualNames.length}`);
  }
  for (const name of expectedNames) {
    if (!expected.get(name).equals(actual.get(name))) {
      throw appError('COMPLIANCE_MISMATCH', `字节漂移：${name}`);
    }
  }
}

function generateCompliance(options = {}) {
  const plan = buildCompliance(options);
  const parentDir = path.dirname(plan.complianceDir);
  const staging = fs.mkdtempSync(path.join(parentDir, '.app-runtime-stage-'));
  try {
    for (const [relative, content] of expectedTree(plan)) {
      const destination = path.join(staging, ...relative.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
    compareTree(expectedTree(plan), actualRegularFiles(staging));
    const generatedTargets = [
      path.join(plan.complianceDir, INVENTORY_NAME),
      path.join(plan.complianceDir, NOTICE_NAME),
      path.join(plan.complianceDir, 'licenses')
    ];
    for (const target of generatedTargets) {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: false });
    }
    for (const [relative, content] of plan.files) {
      const destination = path.join(plan.complianceDir, ...relative.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
    compareTree(expectedTree(plan), actualRegularFiles(plan.complianceDir));
    return plan;
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: false });
  }
}

function verifyCompliance(options = {}) {
  const plan = buildCompliance(options);
  compareTree(expectedTree(plan), actualRegularFiles(plan.complianceDir));
  return plan;
}

function parseArgs(argv) {
  if (argv.length !== 1 || !['generate', 'verify'].includes(argv[0])) {
    throw appError('ARGS', '用法：app-runtime-compliance.js <generate|verify>');
  }
  return argv[0];
}

function main(argv = process.argv.slice(2)) {
  const command = parseArgs(argv);
  const result = command === 'generate' ? generateCompliance() : verifyCompliance();
  const marker = command === 'generate'
    ? 'APP_RUNTIME_COMPLIANCE_READY' : 'APP_RUNTIME_COMPLIANCE_VERIFIED';
  console.log(`${marker} packages=${result.inventory.packageCount} files=${result.inventory.fileCount} closure=${result.inventory.closureSha256}`);
}

module.exports = Object.freeze({
  SDK_NAME,
  SDK_VERSION,
  resolveDependencyPath,
  reachableLockPaths,
  packageFiles,
  packageTreeSha256,
  assertPackagingPolicy,
  cleanedDependencyManifest,
  isPackagedRuntimeFile,
  expectedPackagedFiles,
  packagedClosureRows,
  buildCompliance,
  generateCompliance,
  verifyCompliance,
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
