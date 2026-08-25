'use strict';

// 在 electron-builder 成品中回读根 App 运行时闭包。外层用系统 Node 校验
// resources/compliance/app-runtime；内层用成品 Electron + ELECTRON_RUN_AS_NODE
// 读 app.asar，不引入 asar 解包依赖，不建立任何飞书连接。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { HOTFIX_VERSION, verifyHotfixResources } = require('./hotfix-build-config');
const contextPocManifest = require('./context-poc-manifest');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SDK_NAME = '@larksuiteoapi/node-sdk';
const SDK_VERSION = '1.73.0';
const COMPLIANCE_RELATIVE = path.join('compliance', 'app-runtime');

function packagedError(kind, message) {
  const error = new Error(`PACKAGED_APP_RUNTIME_${kind} ${message}`);
  error.code = `PACKAGED_APP_RUNTIME_${kind}`;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(filePath, label = filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { throw packagedError('INPUT', `${label} 无法读取：${error.message}`); }
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function assertDirectory(dirPath, label) {
  let stat;
  try { stat = fs.lstatSync(dirPath); }
  catch (_error) { throw packagedError('MISSING', `${label} 不存在：${dirPath}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw packagedError('PATH', `${label} 必须是真实目录：${dirPath}`);
  }
}

function assertFile(filePath, label) {
  let stat;
  try { stat = fs.lstatSync(filePath); }
  catch (_error) { throw packagedError('MISSING', `${label} 不存在：${filePath}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw packagedError('PATH', `${label} 必须是普通文件：${filePath}`);
  }
}

function assertAsarArchive(filePath, options = {}) {
  // Electron 会把 fs 修补成 ASAR 虚拟文件系统，此时 lstatSync(app.asar)
  // 看到的是虚拟目录。成品 probe 必须用 original-fs 回读磁盘上的归档文件。
  const diskFs = options.fsImpl || (process.versions.electron ? require('original-fs') : fs);
  let stat;
  try { stat = diskFs.lstatSync(filePath); }
  catch (_error) { throw packagedError('MISSING', `app.asar 不存在：${filePath}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw packagedError('PATH', `app.asar 必须是磁盘上的普通归档文件：${filePath}`);
  }
}

function treeManifest(rootDir) {
  assertDirectory(rootDir, '材料目录');
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(dir, entry.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw packagedError('SYMLINK', `材料树含符号链接：${filePath}`);
      }
      if (stat.isDirectory()) walk(filePath);
      else if (stat.isFile()) {
        const content = fs.readFileSync(filePath);
        rows.push({
          path: posixRelative(rootDir, filePath),
          size: content.length,
          sha256: sha256(content)
        });
      } else {
        throw packagedError('FILE', `材料树含特殊文件：${filePath}`);
      }
    }
  };
  walk(rootDir);
  return rows;
}

function manifestSha256(rows) {
  return sha256(rows.map((row) => `${row.path}\0${row.size}\0${row.sha256}`).join('\n'));
}

function findAppLayout(appRoot) {
  const resolved = path.resolve(appRoot);
  assertDirectory(resolved, '成品 App 根');
  const macResources = path.join(resolved, 'Contents', 'Resources');
  if (fs.existsSync(path.join(macResources, 'app.asar'))) {
    const executable = path.join(resolved, 'Contents', 'MacOS', 'WhaleDock');
    const asar = path.join(macResources, 'app.asar');
    assertFile(executable, 'macOS 成品 Electron');
    assertFile(asar, 'macOS app.asar');
    return Object.freeze({ platform: 'darwin', appRoot: resolved, resources: macResources, executable, asar });
  }
  const winResources = path.join(resolved, 'resources');
  if (fs.existsSync(path.join(winResources, 'app.asar'))) {
    const executable = path.join(resolved, 'WhaleDock.exe');
    const asar = path.join(winResources, 'app.asar');
    assertFile(executable, 'Windows 成品 Electron');
    assertFile(asar, 'Windows app.asar');
    return Object.freeze({ platform: 'win32', appRoot: resolved, resources: winResources, executable, asar });
  }
  throw packagedError('LAYOUT', `不支持的成品布局：${resolved}`);
}

function verifyPackagedMaterials(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const resources = path.resolve(options.resources || '');
  const expectedDir = path.join(root, COMPLIANCE_RELATIVE);
  const actualDir = path.join(resources, COMPLIANCE_RELATIVE);
  const expected = treeManifest(expectedDir);
  const actual = treeManifest(actualDir);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw packagedError('MISMATCH',
      `app-runtime 材料树漂移 expected=${manifestSha256(expected)} actual=${manifestSha256(actual)}`);
  }
  return Object.freeze({
    files: expected.length,
    treeSha256: manifestSha256(expected),
    inventoryPath: path.join(actualDir, 'inventory.json')
  });
}

function inventoryContract(inventory) {
  if (!inventory || inventory.schemaVersion !== 2 || !inventory.sdk
      || inventory.sdk.name !== SDK_NAME || inventory.sdk.version !== SDK_VERSION
      || !Number.isInteger(inventory.packageCount) || inventory.packageCount < 1
      || !Number.isInteger(inventory.packagedFileCount)
      || inventory.packagedFileCount < inventory.packageCount
      || !Number.isInteger(inventory.packagedTotalBytes) || inventory.packagedTotalBytes < 1
      || !/^[a-f0-9]{64}$/.test(inventory.packagedTreeSha256 || '')
      || !inventory.packagingPolicy || inventory.packagingPolicy.schemaVersion !== 1
      || typeof inventory.packagingPolicy.electronBuilderVersion !== 'string'
      || inventory.packagingPolicy.removePackageScripts !== true
      || inventory.packagingPolicy.removePackageKeywords !== true
      || inventory.packagingPolicy.disableDefaultIgnoredFiles !== false
      || inventory.packagingPolicy.includePdb !== false
      || !Array.isArray(inventory.packages) || inventory.packages.length !== inventory.packageCount) {
    throw packagedError('INVENTORY', '成品 inventory schema/SDK 无效');
  }
  const paths = new Set();
  const packagedRows = [];
  for (const pkg of inventory.packages) {
    if (!pkg || typeof pkg.lockPath !== 'string' || !pkg.lockPath.startsWith('node_modules/')
        || paths.has(pkg.lockPath) || typeof pkg.name !== 'string'
        || typeof pkg.version !== 'string' || !Array.isArray(pkg.files)
        || !Array.isArray(pkg.packagedFiles) || !Number.isInteger(pkg.packagedFileCount)
        || pkg.packagedFileCount !== pkg.packagedFiles.length
        || !/^[a-f0-9]{64}$/.test(pkg.packagedTreeSha256 || '')) {
      throw packagedError('INVENTORY', '成品 inventory 包记录无效或重复');
    }
    paths.add(pkg.lockPath);
    const filePaths = new Set();
    for (const file of pkg.files) {
      if (!file || typeof file.path !== 'string' || !file.path
          || file.path.startsWith('/') || file.path.includes('\\')
          || file.path.split('/').some((part) => !part || part === '.' || part === '..')
          || filePaths.has(file.path) || !Number.isInteger(file.size) || file.size < 0
          || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
        throw packagedError('INVENTORY', `${pkg.lockPath} 文件记录无效或重复`);
      }
      filePaths.add(file.path);
    }
    const expectedPaths = new Set();
    for (const file of pkg.packagedFiles) {
      if (!file || typeof file.path !== 'string' || !filePaths.has(file.path)
          || expectedPaths.has(file.path) || !Number.isInteger(file.size) || file.size < 0
          || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
        throw packagedError('INVENTORY', `${pkg.lockPath} 成品文件记录无效或重复`);
      }
      const source = pkg.files.find((item) => item.path === file.path);
      if (file.path !== 'package.json'
          && (source.size !== file.size || source.sha256 !== file.sha256)) {
        throw packagedError('INVENTORY', `${pkg.lockPath}/${file.path} 成品预期与源 inventory 漂移`);
      }
      expectedPaths.add(file.path);
      packagedRows.push({
        path: `${pkg.lockPath}/${file.path}`,
        size: file.size,
        sha256: file.sha256
      });
    }
    if (!expectedPaths.has('package.json')
        || manifestSha256(pkg.packagedFiles) !== pkg.packagedTreeSha256) {
      throw packagedError('INVENTORY', `${pkg.lockPath} 成品文件树无效`);
    }
  }
  packagedRows.sort((left, right) => left.path.localeCompare(right.path));
  const packagedBytes = packagedRows.reduce((sum, file) => sum + file.size, 0);
  if (packagedRows.length !== inventory.packagedFileCount
      || packagedBytes !== inventory.packagedTotalBytes
      || manifestSha256(packagedRows) !== inventory.packagedTreeSha256) {
    throw packagedError('INVENTORY', '成品全局文件树与 inventory 摘要不一致');
  }
  return inventory;
}

function nodeModulesPackages(asarRoot) {
  const rows = [];
  const visitNodeModules = (nodeModulesDir, lockPrefix) => {
    if (!fs.existsSync(nodeModulesDir)) return;
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(nodeModulesDir, entry.name);
        for (const child of fs.readdirSync(scopeDir, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))) {
          if (!child.isDirectory()) continue;
          const name = `${entry.name}/${child.name}`;
          visitPackage(path.join(scopeDir, child.name), `${lockPrefix}node_modules/${name}`);
        }
      } else {
        visitPackage(path.join(nodeModulesDir, entry.name), `${lockPrefix}node_modules/${entry.name}`);
      }
    }
  };
  const visitPackage = (packageDir, lockPath) => {
    const manifestPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      throw packagedError('PROBE', `app.asar npm 包缺少 package.json：${lockPath}`);
    }
    rows.push({ lockPath, packageDir });
    visitNodeModules(path.join(packageDir, 'node_modules'), `${lockPath}/`);
  };
  visitNodeModules(path.join(asarRoot, 'node_modules'), '');
  return rows.sort((left, right) => left.lockPath.localeCompare(right.lockPath));
}

function packagedPackageFiles(packageDir) {
  const rows = [];
  const walk = (dir, relativeDir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relativeDir && entry.name === 'node_modules') continue;
      const filePath = path.join(dir, entry.name);
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw packagedError('PROBE', `app.asar 包内含符号链接：${relative}`);
      if (stat.isDirectory()) walk(filePath, relative);
      else if (stat.isFile()) {
        const content = fs.readFileSync(filePath);
        rows.push({ path: relative, size: content.length, sha256: sha256(content) });
      } else throw packagedError('PROBE', `app.asar 包内含特殊文件：${relative}`);
    }
  };
  walk(packageDir, '');
  return rows;
}

function sdkCacheEntries(sdkDirectory) {
  const normalized = path.resolve(sdkDirectory) + path.sep;
  return Object.keys(require.cache).filter((entry) => {
    const resolved = path.resolve(entry);
    return resolved === path.resolve(sdkDirectory) || resolved.startsWith(normalized);
  });
}

function packageIdentity(name, version) {
  return `${name}\0${version}`;
}

function expectedPackageQueues(packages) {
  const queues = new Map();
  for (const pkg of packages) {
    const identity = packageIdentity(pkg.name, pkg.version);
    if (!queues.has(identity)) queues.set(identity, []);
    queues.get(identity).push(pkg);
  }
  return queues;
}

function takeExpectedPackage(queues, name, version) {
  const queue = queues.get(packageIdentity(name, version));
  if (!queue || !queue.length) return null;
  return queue.shift();
}

function assertExactPackagedFiles(expected, actual, label = '成品包') {
  const expectedRows = [...expected].sort((left, right) => left.path.localeCompare(right.path));
  const actualRows = [...actual].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    throw packagedError('PROBE', `${label} 文件集或字节哈希与 inventory 不一致`);
  }
  return actualRows;
}

function verifyPackagedContextPoc(options = {}) {
  const asar = path.resolve(options.asar || '');
  const resources = path.resolve(options.resources || '');
  const baselinePath = path.join(asar, 'lib', 'context-poc-baseline.json');
  const baseline = contextPocManifest.readBaseline(baselinePath);
  const actual = contextPocManifest.createManifest(path.join(resources, 'context-poc'));
  contextPocManifest.assertManifestMatches(baseline, actual);
  return Object.freeze({
    contextPocBaselineVerified: true,
    contextPocFiles: actual.files.length,
    contextPocBytes: actual.totalBytes,
    contextPocDigest: actual.digest
  });
}

function probeAsar(options = {}) {
  if (options.requireElectron !== false && !process.versions.electron) {
    throw packagedError('PROBE', '私有 probe 必须由成品 Electron 执行');
  }
  const asar = path.resolve(options.asar || '');
  const inventory = inventoryContract(options.inventory
    || readJson(path.resolve(options.inventoryPath || ''), '成品 app-runtime inventory'));
  assertAsarArchive(asar);
  const rootManifest = readJson(path.join(asar, 'package.json'), 'app.asar/package.json');
  if (typeof rootManifest.version !== 'string' || !rootManifest.version) {
    throw packagedError('PROBE', 'app.asar 根版本缺失');
  }
  const packagedBaselinePath = path.join(asar, 'lib', 'context-poc-baseline.json');
  const hasPackagedContextPocBaseline = fs.existsSync(packagedBaselinePath);
  let contextPocReceipt = null;
  if (hasPackagedContextPocBaseline) {
    if (!options.resources) {
      throw packagedError('PROBE', 'app.asar 含 context-poc 信任根但未提供 Resources');
    }
    try {
      contextPocReceipt = verifyPackagedContextPoc({
        asar,
        resources: options.resources
      });
    } catch (error) {
      throw packagedError('PROBE', `context-poc 成品信任根失败：${error.message}`);
    }
  } else if (options.resources) {
    throw packagedError('PROBE', 'Resources 对账请求缺少 app.asar context-poc 信任根');
  }
  const expectedQueues = expectedPackageQueues(inventory.packages);
  const actualPackages = nodeModulesPackages(asar);
  if (actualPackages.length !== inventory.packageCount) {
    throw packagedError('PROBE', `app.asar 包数不一致 expected=${inventory.packageCount} actual=${actualPackages.length}`);
  }
  const treeRows = [];
  for (const actual of actualPackages) {
    const manifest = readJson(path.join(actual.packageDir, 'package.json'), `${actual.lockPath}/package.json`);
    const expected = takeExpectedPackage(expectedQueues, manifest.name, manifest.version);
    if (!expected) {
      throw packagedError('PROBE', `${actual.lockPath} 包名/版本未登记：${manifest.name}@${manifest.version}`);
    }
    const actualFiles = packagedPackageFiles(actual.packageDir);
    for (const file of assertExactPackagedFiles(
      expected.packagedFiles, actualFiles, `${actual.lockPath} (${expected.lockPath})`
    )) {
      treeRows.push({ path: `${expected.lockPath}/${file.path}`, size: file.size, sha256: file.sha256 });
    }
  }
  const missingPackages = [...expectedQueues.values()].reduce((count, queue) => count + queue.length, 0);
  if (missingPackages) {
    throw packagedError('PROBE', `app.asar 缺少 inventory 中的 ${missingPackages} 个包实例`);
  }

  const sdkDirectory = path.join(asar, 'node_modules', '@larksuiteoapi', 'node-sdk');
  if (sdkCacheEntries(sdkDirectory).length) {
    throw packagedError('PROBE', '惰性校验前 SDK 已进入 require.cache');
  }
  const remoteModulePath = path.join(asar, 'lib', 'remote-feishu.js');
  const remote = require(remoteModulePath);
  if (!remote || typeof remote.createFeishuAdapter !== 'function') {
    throw packagedError('PROBE', '成品缺少飞书 adapter 工厂');
  }
  remote.createFeishuAdapter({
    readCredentials: async () => ({ appId: 'unused', appSecret: 'unused' }),
    hasMessage: async () => true,
    rememberMessage: async () => {},
    readBoundOpenId: async () => 'unused',
    sendText: async () => {}
  });
  if (sdkCacheEntries(sdkDirectory).length) {
    throw packagedError('PROBE', 'adapter 模块载入/构造提前加载 SDK');
  }
  const sdkManifest = readJson(path.join(sdkDirectory, 'package.json'), 'app.asar SDK package.json');
  if (sdkManifest.name !== SDK_NAME || sdkManifest.version !== SDK_VERSION) {
    throw packagedError('PROBE', `app.asar SDK 不是 ${SDK_VERSION}`);
  }
  const sdk = require(sdkDirectory);
  if (!sdk || typeof sdk.WSClient !== 'function' || typeof sdk.EventDispatcher !== 'function') {
    throw packagedError('PROBE', '成品 SDK 缺少 WSClient/EventDispatcher');
  }
  treeRows.sort((left, right) => left.path.localeCompare(right.path));
  const treeSha256 = manifestSha256(treeRows);
  if (treeRows.length !== inventory.packagedFileCount
      || treeSha256 !== inventory.packagedTreeSha256) {
    throw packagedError('PROBE', 'app.asar 全局文件树与 inventory 不一致');
  }
  return Object.freeze({
    status: 'PASS',
    electronVersion: process.versions.electron || 'test-node',
    appVersion: rootManifest.version,
    sdkVersion: sdkManifest.version,
    packageCount: actualPackages.length,
    lazyLoadVerified: true,
    sdkExportsVerified: ['EventDispatcher', 'WSClient'],
    fileCount: treeRows.length,
    treeSha256,
    ...(contextPocReceipt || {})
  });
}

function validateProbeReport(
  report,
  inventory,
  expectedAppVersion = null,
  expectedContextPocBaseline = null
) {
  inventoryContract(inventory);
  const exportsExpected = ['EventDispatcher', 'WSClient'];
  if (!report || report.status !== 'PASS' || typeof report.electronVersion !== 'string'
      || !report.electronVersion || report.sdkVersion !== SDK_VERSION
      || report.packageCount !== inventory.packageCount || report.lazyLoadVerified !== true
      || JSON.stringify(report.sdkExportsVerified) !== JSON.stringify(exportsExpected)
      || report.fileCount !== inventory.packagedFileCount
      || report.treeSha256 !== inventory.packagedTreeSha256
      || (expectedAppVersion !== null && report.appVersion !== expectedAppVersion)) {
    throw packagedError('PROBE', '成品 probe receipt 无效或与 inventory 不一致');
  }
  if (expectedContextPocBaseline !== null) {
    const expected = contextPocManifest.validateBaseline(expectedContextPocBaseline);
    if (report.contextPocBaselineVerified !== true
        || report.contextPocFiles !== expected.files.length
        || report.contextPocBytes !== expected.totalBytes
        || report.contextPocDigest !== expected.digest) {
      throw packagedError('PROBE', '成品 context-poc receipt 无效或与固定信任根不一致');
    }
  }
  return report;
}

function verifyApp(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const layout = findAppLayout(options.appRoot);
  const materials = verifyPackagedMaterials({ root, resources: layout.resources });
  const inventory = inventoryContract(readJson(materials.inventoryPath, '成品 inventory'));
  const rootPackage = readJson(path.join(root, 'package.json'), '仓库 package.json');
  const repositoryBaselinePath = path.join(root, 'lib', 'context-poc-baseline.json');
  const expectedContextPocBaseline = fs.existsSync(repositoryBaselinePath)
    ? contextPocManifest.readBaseline(repositoryBaselinePath) : null;
  if (rootPackage.version === HOTFIX_VERSION) {
    verifyHotfixResources(layout.resources);
  }
  const run = options.spawnSync || spawnSync;
  const result = run(layout.executable, [
    __filename,
    '--probe',
    `--asar=${layout.asar}`,
    `--inventory=${materials.inventoryPath}`,
    ...(expectedContextPocBaseline ? [`--resources=${layout.resources}`] : [])
  ], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error && result.error.message || '').trim();
    throw packagedError('PROBE', `成品 Electron probe 失败 status=${String(result.status)} ${detail}`);
  }
  let report;
  try { report = JSON.parse(String(result.stdout || '').trim()); }
  catch (_error) { throw packagedError('PROBE', '成品 Electron probe 未返回单一 JSON receipt'); }
  validateProbeReport(
    report,
    inventory,
    rootPackage.version,
    expectedContextPocBaseline
  );
  return Object.freeze({
    ...report,
    platform: layout.platform,
    complianceFiles: materials.files,
    complianceTreeSha256: materials.treeSha256
  });
}

function parseArgs(argv) {
  const result = { probe: false };
  for (const value of argv) {
    if (value === '--probe') result.probe = true;
    else if (value.startsWith('--app=')) result.app = value.slice('--app='.length);
    else if (value.startsWith('--asar=')) result.asar = value.slice('--asar='.length);
    else if (value.startsWith('--inventory=')) result.inventory = value.slice('--inventory='.length);
    else if (value.startsWith('--resources=')) result.resources = value.slice('--resources='.length);
    else throw packagedError('ARGS', `未知参数：${value}`);
  }
  if (result.probe) {
    if (!result.asar || !result.inventory || result.app) {
      throw packagedError('ARGS', 'probe 必须提供 --asar/--inventory，可提供 --resources');
    }
  } else if (!result.app || result.asar || result.inventory || result.resources) {
    throw packagedError('ARGS', '用法：verify-packaged-app-runtime.js --app=<unpacked-app-root>');
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.probe) {
    process.stdout.write(JSON.stringify(probeAsar({
      asar: args.asar,
      inventoryPath: args.inventory,
      resources: args.resources
    })) + '\n');
    return;
  }
  const result = verifyApp({ appRoot: args.app });
  console.log(`PACKAGED_APP_RUNTIME_VERIFIED platform=${result.platform} packages=${result.packageCount} files=${result.fileCount} tree=${result.treeSha256} compliance=${result.complianceTreeSha256}`);
}

module.exports = Object.freeze({
  treeManifest,
  manifestSha256,
  assertAsarArchive,
  expectedPackageQueues,
  takeExpectedPackage,
  assertExactPackagedFiles,
  findAppLayout,
  verifyPackagedMaterials,
  inventoryContract,
  nodeModulesPackages,
  packagedPackageFiles,
  verifyPackagedContextPoc,
  probeAsar,
  validateProbeReport,
  verifyApp,
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
