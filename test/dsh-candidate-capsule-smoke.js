'use strict';

// 候选胶囊聚合器的纯 Node fixture；不联网、不执行 npm、不写仓库工作树。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const capsule = require('../scripts/dsh-candidate-capsule');

const VERSION = capsule.VERSION;
const INTEGRITY = 'sha512-Y2FuZGlkYXRlLWZpeHR1cmU=';
const EXPECTED_COMMIT = 'a'.repeat(40);
const WASM_NAME = '@img/sharp-wasm32';
const WASM_VERSION = '0.35.3';
const WASM_INTEGRITY = 'sha512-d2FzbS1maXh0dXJl';
const TARGETS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' }
];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function key(target) {
  return `${target.platform}/${target.arch}`;
}

function suffix(target) {
  return key(target).replace('/', '-');
}

function nativeName(target) {
  return `@fixture/native-${suffix(target)}`;
}

function componentId(target) {
  return `component-${suffix(target)}@1.0.0`;
}

function materialId(target) {
  return `material-${suffix(target)}`;
}

function materialPath(target) {
  return `licenses/embedded-components/${suffix(target)}-COPYING.txt`;
}

function wasmMaterialPath() {
  return 'licenses/embedded-components/wasm-COPYING.txt';
}

function resolved(target) {
  const name = nativeName(target).split('/').at(-1);
  return `https://registry.npmjs.org/${nativeName(target)}/-/${name}-1.0.0.tgz`;
}

function nativeIntegrity(target) {
  return `sha512-${Buffer.from(`native-${suffix(target)}`).toString('base64')}`;
}

function runtimeManifest(target, lockSha) {
  return {
    schemaVersion: 3,
    dshVersion: VERSION,
    packageIntegrity: INTEGRITY,
    auditedLockSha256: lockSha,
    installScriptsIgnored: true,
    installScriptPackages: [],
    platform: target.platform,
    arch: target.arch,
    hostPlatform: target.platform,
    hostArch: target.arch,
    generatedAt: '2026-08-22T00:00:00.000Z'
  };
}

function stableManifestHash(manifest) {
  return capsule.sha256(JSON.stringify({
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

function makeLock() {
  const packages = {
    '': {
      name: 'whaledock-dsh-runtime',
      version: '0.0.0',
      dependencies: { '@deepseek-ai/dsh': VERSION }
    },
    'node_modules/@deepseek-ai/dsh': {
      version: VERSION,
      resolved: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${VERSION}.tgz`,
      integrity: INTEGRITY,
      license: 'MIT'
    },
    'node_modules/@fixture/origin': {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/@fixture/origin/-/origin-1.0.0.tgz',
      integrity: 'sha512-b3JpZ2lu',
      license: 'MIT'
    },
    [`node_modules/${WASM_NAME}`]: {
      version: WASM_VERSION,
      resolved: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
      integrity: WASM_INTEGRITY,
      license: 'Apache-2.0'
    }
  };
  for (const target of TARGETS) {
    packages[`node_modules/${nativeName(target)}`] = {
      version: '1.0.0',
      resolved: resolved(target),
      integrity: nativeIntegrity(target),
      license: 'LGPL-2.1-only'
    };
  }
  return {
    name: 'whaledock-dsh-runtime',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages
  };
}

function makeEmbedded() {
  const targets = TARGETS.map((target) => ({
    id: `native-${suffix(target)}`,
    package: `${nativeName(target)}@1.0.0`,
    packageUrl: resolved(target),
    packageSha256: 'a'.repeat(64),
    versionsJsonSha256: 'b'.repeat(64),
    readmeSha256: 'c'.repeat(64),
    componentIds: [componentId(target)]
  }));
  targets.push({
    id: 'wasm32-all-runtime-targets',
    package: `${WASM_NAME}@${WASM_VERSION}`,
    packageUrl: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
    packageSha256: 'd'.repeat(64),
    versionsJsonSha256: 'e'.repeat(64),
    readmeSha256: 'f'.repeat(64),
    componentIds: ['wasm-component@1.0.0']
  }, {
    id: 'unused-target',
    package: '@fixture/unused@1.0.0',
    packageUrl: 'https://registry.npmjs.org/@fixture/unused/-/unused-1.0.0.tgz',
    packageSha256: '1'.repeat(64),
    versionsJsonSha256: '2'.repeat(64),
    readmeSha256: '3'.repeat(64),
    componentIds: ['unused@1.0.0']
  });
  const components = TARGETS.map((target) => ({
    id: componentId(target),
    displayName: `component-${suffix(target)}`,
    versionEvidence: { versionsJsonValue: '1.0.0' },
    licenseExpression: target.platform === 'win32'
      ? 'LGPL-2.1-only OR MPL-1.1' : 'LGPL-2.1-only',
    sourceRepository: 'https://example.invalid/component',
    sourceRef: 'v1.0.0',
    materialIds: [materialId(target)],
    targets: [`native-${suffix(target)}`, 'unused-target']
  }));
  components.push({
    id: 'wasm-component@1.0.0',
    displayName: 'wasm-component',
    versionEvidence: { versionsJsonValue: '1.0.0' },
    licenseExpression: 'LGPL-2.1-only',
    sourceRepository: 'https://example.invalid/wasm-component',
    sourceRef: 'v1.0.0',
    materialIds: ['wasm-material'],
    targets: ['wasm32-all-runtime-targets', 'unused-target']
  }, {
    id: 'unused@1.0.0',
    displayName: 'unused',
    versionEvidence: { versionsJsonValue: '1.0.0' },
    licenseExpression: 'MIT',
    sourceRepository: 'https://example.invalid/unused',
    sourceRef: 'v1.0.0',
    materialIds: ['unused-material'],
    targets: ['unused-target']
  });
  const materials = TARGETS.map((target) => ({
    id: materialId(target),
    repositoryPath: materialPath(target),
    repositorySha256: capsule.sha256(Buffer.from(`copying ${suffix(target)}\n`)),
    upstreamCopies: [{ componentIds: [componentId(target)], upstreamUrl: 'https://example.invalid/source.tar.gz' }]
  }));
  materials.push({
    id: 'wasm-material',
    repositoryPath: wasmMaterialPath(),
    repositorySha256: capsule.sha256(Buffer.from('copying wasm\n')),
    upstreamCopies: [{ componentIds: ['wasm-component@1.0.0'], upstreamUrl: 'https://example.invalid/wasm.tar.gz' }]
  }, {
    id: 'unused-material',
    repositoryPath: 'licenses/embedded-components/unused.txt',
    repositorySha256: capsule.sha256(Buffer.from('unused\n')),
    upstreamCopies: []
  });
  return {
    schemaVersion: 1,
    auditedAt: '2026-08-15',
    scope: 'production fixture including unused records',
    evidenceBasis: {
      inventories: [],
      declarations: [{ scope: 'fixture vectors', targets: targets.map((target) => target.id) }]
    },
    targets,
    components,
    materials,
    coverage: {
      targetCounts: Object.fromEntries(targets.map((target) => [target.id, target.componentIds.length])),
      componentOccurrences: targets.length,
      uniqueComponentRecords: components.length,
      materialFilesReferenced: materials.length,
      exactVersionOrCommitRecords: components.length,
      exactVendoredButIndependentVersionUnknown: [],
      confirmedAttributionDiscrepancies: [],
      status: 'fixture'
    },
    verificationRules: ['fixture']
  };
}

function makeSources() {
  const buildRecipes = TARGETS.map((target) => ({
    id: `recipe-${suffix(target)}@1`,
    sourceUrl: 'https://example.invalid/recipe.tar.gz',
    sourceSha256: '1'.repeat(64),
    commit: '1'.repeat(40),
    verificationMethod: 'fixture',
    upstreamAttestation: true
  }));
  buildRecipes.push({
    id: 'wasm-vips@fixture',
    sourceUrl: 'https://example.invalid/wasm-recipe.tar.gz',
    sourceSha256: '2'.repeat(64),
    commit: '2'.repeat(40),
    verificationMethod: 'inferred fixture',
    upstreamAttestation: false,
    caveat: 'fixture caveat'
  }, {
    id: 'unused-recipe@1',
    sourceUrl: 'https://example.invalid/unused-recipe.tar.gz',
    sourceSha256: '3'.repeat(64),
    commit: '3'.repeat(40),
    verificationMethod: 'fixture',
    upstreamAttestation: true
  });
  const components = TARGETS.map((target) => ({
    id: componentId(target),
    license: target.platform === 'win32'
      ? 'LGPL-2.1-only OR MPL-1.1' : 'LGPL-2.1-only',
    sourceUrl: 'https://example.invalid/component.tar.gz',
    sourceSha256: '4'.repeat(64),
    verificationMethod: 'fixture',
    licenseFiles: [materialPath(target)]
  }));
  components.push({
    id: 'wasm-component@1.0.0',
    license: 'LGPL-2.1-only',
    sourceUrl: 'https://example.invalid/wasm-component.tar.gz',
    sourceSha256: '5'.repeat(64),
    verificationMethod: 'fixture',
    licenseFiles: [wasmMaterialPath()]
  }, {
    id: 'unused@1.0.0',
    license: 'MIT',
    sourceUrl: 'https://example.invalid/unused.tar.gz',
    sourceSha256: '6'.repeat(64),
    verificationMethod: 'fixture',
    licenseFiles: ['licenses/embedded-components/unused.txt']
  });
  const containers = TARGETS.map((target) => ({
    name: nativeName(target),
    version: '1.0.0',
    targets: [key(target)],
    resolved: resolved(target),
    integrity: nativeIntegrity(target),
    tarballSha256: '7'.repeat(64),
    provenanceUrl: 'https://example.invalid/provenance',
    buildRecipes: [`recipe-${suffix(target)}@1`],
    componentSources: [componentId(target), 'unused@1.0.0']
  }));
  containers.push({
    name: WASM_NAME,
    version: WASM_VERSION,
    targets: TARGETS.map(key),
    resolved: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
    integrity: WASM_INTEGRITY,
    tarballSha256: '8'.repeat(64),
    provenanceUrl: 'https://example.invalid/wasm-provenance',
    buildRecipes: ['wasm-vips@fixture'],
    buildInputPackages: ['@fixture/wasm-input@1.0.0'],
    componentSources: ['wasm-component@1.0.0', 'unused@1.0.0']
  }, {
    name: '@fixture/unused',
    version: '1.0.0',
    targets: ['linux/x64'],
    resolved: 'https://example.invalid/unused.tgz',
    integrity: 'sha512-dW51c2Vk',
    tarballSha256: '9'.repeat(64),
    provenanceUrl: 'https://example.invalid/provenance',
    buildRecipes: ['unused-recipe@1'],
    componentSources: ['unused@1.0.0']
  });
  return {
    schemaVersion: 1,
    scope: 'production fixture including unused records',
    verifiedAt: '2026-08-15',
    buildRecipes,
    buildInputPackages: [{
      name: '@fixture/wasm-input', version: '1.0.0',
      resolved: 'https://example.invalid/wasm-input.tgz', integrity: 'sha512-aW5wdXQ=',
      tarballSha256: 'a'.repeat(64), provenanceUrl: 'https://example.invalid/input',
      recipe: 'wasm-vips@fixture'
    }],
    components,
    containers,
    attributionSources: [{ id: 'unused@1.0.0', sourceUrl: 'https://example.invalid/unused.tar.gz', sourceSha256: 'b'.repeat(64) }]
  };
}

function treeRows(entries) {
  return entries.flatMap((entry) => {
    if (entry.path === 'manifest.json' || entry.path === 'node_modules/.package-lock.json') return [];
    if (entry.type === 'file') return [{ path: entry.path, size: entry.bytes, sha256: entry.sha256 }];
    if (entry.type === 'symlink') return [{ path: entry.path, symlink: entry.target }];
    return [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function packageRows(entries, packagePath) {
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

function treeHash(rows) {
  return capsule.sha256(rows.map((row) => JSON.stringify(row)).join('\n'));
}

function buildEvidenceEntries(files) {
  const directories = new Set(['.']);
  for (const relative of files.keys()) {
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'));
  }
  const nodes = [...directories].map((relative) => ({ path: relative, type: 'directory', mode: '0o0755' }));
  for (const [relative, content] of files) {
    nodes.push({ path: relative, type: 'file', mode: '0o0644', bytes: content.length, sha256: capsule.sha256(content) });
  }
  return nodes.sort((left, right) => left.path === '.' ? -1 : right.path === '.' ? 1
    : Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function treeReport(entries, target) {
  const summary = { directoryCount: 0, fileCount: 0, symlinkCount: 0, logicalBytes: 0, symlinkTargetBytes: 0 };
  for (const entry of entries) {
    if (entry.type === 'directory') summary.directoryCount += 1;
    else if (entry.type === 'file') { summary.fileCount += 1; summary.logicalBytes += entry.bytes; }
    else { summary.symlinkCount += 1; summary.symlinkTargetBytes += entry.targetBytes; }
  }
  const canonical = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const compressed = zlib.gzipSync(canonical, { level: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY, mtime: 0 });
  compressed[9] = target.platform === 'darwin' ? 19 : target.platform === 'win32' ? 10 : 3;
  return {
    ...summary,
    canonicalBytes: canonical.length,
    canonicalSha256: capsule.sha256(canonical),
    compression: 'node:zlib-gzip-level-9-mtime-0',
    compressionNodeVersion: process.version,
    compressionZlibVersion: process.versions.zlib,
    compressedBytes: compressed.length,
    compressedSha256: capsule.sha256(compressed),
    entries
  };
}

function nativeProofDefinitions(target) {
  const platform = target.platform;
  const arch = target.arch;
  const base = [
    ['sharp-addon', `node_modules/@img/sharp-${platform}-${arch}/lib/sharp-${platform}-${arch}-v1.node`],
    ['koffi-addon', `node_modules/@koromix/koffi-${platform}-${arch}/${platform}_${arch}/koffi.node`],
    ['ripgrep', `node_modules/@vscode/ripgrep-${platform}-${arch}/bin/rg${platform === 'win32' ? '.exe' : ''}`],
    ['builtin-addon', `node_modules/node-addon-require-builtin-${platform}-${arch}${platform === 'win32' ? '-msvc' : ''}/prebuilt/${platform}-${arch}${platform === 'win32' ? '-msvc' : ''}-v1.node`]
  ];
  if (platform === 'darwin') base.push(
    ['sharp-libvips', `node_modules/@img/sharp-libvips-darwin-${arch}/lib/libvips-cpp.1.dylib`],
    ['node-pty', `node_modules/node-pty/prebuilds/darwin-${arch}/pty.node`],
    ['node-pty-spawn-helper', `node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`]
  );
  else base.push(
    ['node-pty-conpty', `node_modules/node-pty/prebuilds/win32-${arch}/conpty.node`],
    ['node-pty-console-list', `node_modules/node-pty/prebuilds/win32-${arch}/conpty_console_list.node`],
    ['node-pty-open-console', `node_modules/node-pty/prebuilds/win32-${arch}/conpty/OpenConsole.exe`],
    ['node-pty-conpty-dll', `node_modules/node-pty/prebuilds/win32-${arch}/conpty/conpty.dll`]
  );
  return base;
}

function finalizePackage(pkg, entries) {
  const rows = packageRows(entries, pkg.paths[0]);
  return {
    ...pkg,
    packageTreeSha256: treeHash(rows),
    binaryFiles: rows.filter((row) => /\.(?:node|wasm|dll|dylib|exe|so(?:\.\d+)*)$/i.test(row.path))
  };
}

function closureHash(packages) {
  return capsule.sha256(packages.map((pkg) => [
    pkg.name, pkg.version, pkg.license, pkg.integrity, pkg.paths.join(','),
    pkg.packageTreeSha256, JSON.stringify(pkg.binaryFiles), JSON.stringify(pkg.licenseTextFindings),
    JSON.stringify(pkg.embeddedComponents), pkg.licenseFiles.join(',')
  ].join('\0')).join('\n'));
}

function writeArtifact(options) {
  const { root, target, lock, lockContent, lockSha, packageText, repositoryRoot,
    candidateDir, includeWasm, gitCommit = EXPECTED_COMMIT } = options;
  fs.mkdirSync(root, { recursive: true });
  const manifest = runtimeManifest(target, lockSha);
  const manifestContent = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const rootPackage = Buffer.from('{"name":"whaledock-dsh-runtime","version":"0.0.0"}\n');
  const dshPackage = Buffer.from(`{"name":"@deepseek-ai/dsh","version":"${VERSION}"}\n`);
  const originPackage = Buffer.from('{"name":"@fixture/origin","version":"1.0.0"}\n');
  const nativePackage = Buffer.from(`{"name":"${nativeName(target)}","version":"1.0.0"}\n`);
  const wasmPackage = Buffer.from(`{"name":"${WASM_NAME}","version":"${WASM_VERSION}"}\n`);
  const files = new Map([
    ['manifest.json', manifestContent], ['package.json', rootPackage], ['package-lock.json', lockContent],
    ['node_modules/@deepseek-ai/dsh/package.json', dshPackage],
    ['node_modules/@deepseek-ai/dsh/bin.js', Buffer.from('#!/usr/bin/env node\n')],
    ['node_modules/@deepseek-ai/dsh/LICENSE', packageText],
    ['node_modules/@fixture/origin/package.json', originPackage],
    [`node_modules/${nativeName(target)}/package.json`, nativePackage],
    [`node_modules/${nativeName(target)}/LICENSE`, packageText],
    [`node_modules/${nativeName(target)}/README.md`, packageText]
  ]);
  if (includeWasm) {
    files.set(`node_modules/${WASM_NAME}/package.json`, wasmPackage);
    files.set(`node_modules/${WASM_NAME}/LICENSE`, packageText);
  }
  for (const [label, relative] of nativeProofDefinitions(target)) {
    files.set(relative, Buffer.from(`native ${label} ${key(target)}\n`));
  }
  const entries = buildEvidenceEntries(files);
  const textSha = capsule.sha256(packageText);
  const packageTextPath = `licenses/package-texts/${textSha}.txt`;
  const packages = [{
    name: '@deepseek-ai/dsh', version: VERSION, license: 'MIT',
    resolved: lock.packages['node_modules/@deepseek-ai/dsh'].resolved, integrity: INTEGRITY,
    paths: ['node_modules/@deepseek-ai/dsh'],
    licenseFiles: ['licenses/SPDX-MIT.txt', packageTextPath].sort(), weakCopyleft: [], embeddedComponents: [],
    licenseTextFindings: [{ path: 'LICENSE', sha256: textSha, detected: [] }]
  }, {
    name: '@fixture/origin', version: '1.0.0', license: 'MIT',
    resolved: lock.packages['node_modules/@fixture/origin'].resolved, integrity: 'sha512-b3JpZ2lu',
    paths: ['node_modules/@fixture/origin'],
    licenseFiles: ['licenses/SPDX-MIT.txt', packageTextPath].sort(), weakCopyleft: [], embeddedComponents: [],
    licenseTextFindings: [{
      path: packageTextPath, sha256: textSha, detected: [],
      origin: 'https://example.invalid/origin/LICENSE',
      sourceCommit: '1234567890abcdef1234567890abcdef12345678'
    }]
  }, {
    name: nativeName(target), version: '1.0.0', license: 'LGPL-2.1-only',
    resolved: resolved(target), integrity: nativeIntegrity(target), paths: [`node_modules/${nativeName(target)}`],
    licenseFiles: ['licenses/SPDX-LGPL-2.1-only.txt', materialPath(target), packageTextPath].sort(),
    weakCopyleft: ['LGPL-2.1-only'],
    embeddedComponents: [{
      name: `component-${suffix(target)}`, version: '1.0.0', license: 'LGPL-2.1-only', upstreamLabel: 'LGPL 2.1',
      materialComponentId: componentId(target),
      materialLicenseExpression: target.platform === 'win32' ? 'LGPL-2.1-only OR MPL-1.1' : 'LGPL-2.1-only',
      materialSourceRepository: 'https://example.invalid/component', materialSourceRef: 'v1.0.0',
      materialFiles: [materialPath(target)]
    }],
    // npm 在大小写不敏感的 macOS/Windows runner 上会同时报告
    // README.md/readme.md；证据树只应保存一条真实文件路径。
    licenseTextFindings: [
      { path: 'LICENSE', sha256: textSha, detected: ['LGPL'] },
      { path: 'README.md', sha256: textSha, detected: ['LGPL'] },
      { path: 'readme.md', sha256: textSha, detected: ['LGPL'] }
    ]
  }];
  if (includeWasm) packages.push({
    name: WASM_NAME, version: WASM_VERSION, license: 'Apache-2.0',
    resolved: lock.packages[`node_modules/${WASM_NAME}`].resolved, integrity: WASM_INTEGRITY,
    paths: [`node_modules/${WASM_NAME}`],
    licenseFiles: ['licenses/SPDX-Apache-2.0.txt', wasmMaterialPath(), packageTextPath].sort(),
    weakCopyleft: ['LGPL-2.1-only'],
    embeddedComponents: [{
      name: 'wasm-component', version: '1.0.0', license: 'LGPL-2.1-only', upstreamLabel: 'LGPL 2.1',
      materialComponentId: 'wasm-component@1.0.0', materialLicenseExpression: 'LGPL-2.1-only',
      materialSourceRepository: 'https://example.invalid/wasm-component', materialSourceRef: 'v1.0.0',
      materialFiles: [wasmMaterialPath()]
    }],
    licenseTextFindings: [{ path: 'LICENSE', sha256: textSha, detected: [] }]
  });
  const finalized = packages.map((pkg) => finalizePackage(pkg, entries))
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const licenseCounts = {};
  for (const pkg of finalized) licenseCounts[pkg.license] = (licenseCounts[pkg.license] || 0) + 1;
  const inventory = {
    schemaVersion: 2, target, runtimeVersion: VERSION, runtimePackageIntegrity: INTEGRITY,
    packageLockSha256: lockSha, runtimePackageJsonSha256: capsule.sha256(rootPackage),
    manifestStableSha256: stableManifestHash(manifest), runtimeTreeSha256: treeHash(treeRows(entries)),
    closureSha256: closureHash(finalized), packageCount: finalized.length,
    licenseCounts: Object.fromEntries(Object.entries(licenseCounts).sort()), packages: finalized
  };
  const nativeBinaries = nativeProofDefinitions(target).map(([_label, relative]) => {
    const entry = entries.find((row) => row.path === relative);
    return {
      path: relative, format: target.platform === 'darwin' ? 'mach-o' : 'pe',
      kind: target.platform === 'darwin' ? 'thin' : 'image',
      machines: [target.arch === 'x64' ? 'x86_64' : target.arch], bytes: entry.bytes, sha256: entry.sha256
    };
  });
  const targetNativeProofs = nativeProofDefinitions(target).map(([label, relative]) => ({
    label, ...nativeBinaries.find((row) => row.path === relative)
  }));
  const evidence = {
    schemaVersion: 1,
    runtime: {
      version: VERSION, platform: target.platform, arch: target.arch,
      hostPlatform: target.platform, hostArch: target.arch,
      manifestSha256: capsule.sha256(manifestContent), packageSha256: capsule.sha256(rootPackage),
      lockSha256: lockSha, installedPackageSha256: capsule.sha256(dshPackage),
      packageIntegrity: INTEGRITY, lockPackages: Object.keys(lock.packages).length,
      installScriptsIgnored: true, installScriptPackages: [],
      exactBinRelative: 'node_modules/@deepseek-ai/dsh/bin.js'
    },
    tree: treeReport(entries, target), nativeBinaries, targetNativeProofs,
    dumpConfig: {
      exit: 0, bytes: 0, lines: 0, sha256: capsule.sha256(Buffer.alloc(0)),
      stderrBytes: 0, stderrSha256: capsule.sha256(Buffer.alloc(0))
    }
  };
  const inventoryName = `inventory-${suffix(target)}.json`;
  const evidenceName = `evidence-${suffix(target)}.json`;
  const manifestName = `runtime-manifest-${suffix(target)}.json`;
  writeJson(path.join(root, inventoryName), inventory);
  writeJson(path.join(root, evidenceName), evidence);
  writeFile(path.join(root, manifestName), manifestContent);
  writeFile(path.join(root, packageTextPath), packageText);
  const candidateManifestPath = path.join(candidateDir, 'candidate-manifest.json');
  const candidateManifestBytes = fs.readFileSync(candidateManifestPath);
  const inventoryBytes = fs.readFileSync(path.join(root, inventoryName));
  const evidenceBytes = fs.readFileSync(path.join(root, evidenceName));
  const referenced = [...new Set(finalized.flatMap((pkg) => pkg.licenseFiles))].sort();
  const referencedLicenseMaterials = referenced.map((relative) => {
    const uploaded = /^licenses\/package-texts\/[a-f0-9]{64}\.txt$/.test(relative);
    const content = uploaded ? fs.readFileSync(path.join(root, relative)) : fs.readFileSync(path.join(repositoryRoot, relative));
    return { path: relative, bytes: content.length, sha256: capsule.sha256(content), uploaded };
  });
  writeJson(path.join(root, `material-manifest-${suffix(target)}.json`), {
    schemaVersion: 1, candidateVersion: VERSION, target, gitCommit,
    candidateManifest: {
      path: path.relative(repositoryRoot, candidateManifestPath).split(path.sep).join('/'),
      bytes: candidateManifestBytes.length, sha256: capsule.sha256(candidateManifestBytes)
    },
    inventory: { path: inventoryName, bytes: inventoryBytes.length, sha256: capsule.sha256(inventoryBytes) },
    evidence: { path: evidenceName, bytes: evidenceBytes.length, sha256: capsule.sha256(evidenceBytes) },
    runtimeManifest: { path: manifestName, bytes: manifestContent.length, sha256: capsule.sha256(manifestContent) },
    referencedLicenseMaterials
  });
}

function fixture(options = {}) {
  const includeWasm = options.includeWasm !== false;
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-capsule-repo-'));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-capsule-artifacts-'));
  const candidateDir = path.join(repositoryRoot, 'compliance', 'candidates', 'dsh-rc2');
  fs.mkdirSync(candidateDir, { recursive: true });
  const lock = makeLock();
  const lockContent = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
  const lockSha = capsule.sha256(lockContent);
  writeFile(path.join(candidateDir, 'dsh-runtime-package-lock.json'), lockContent);
  writeJson(path.join(candidateDir, 'candidate-manifest.json'), {
    schemaVersion: 1, packageVersion: VERSION,
    auditedLock: { path: 'dsh-runtime-package-lock.json', sha256: lockSha },
    targets: TARGETS, installScriptAllowlist: []
  });
  const packageText = Buffer.from('fixture origin license\n');
  writeJson(path.join(candidateDir, 'package-license-overrides.json'), {
    schemaVersion: 1,
    packages: {
      '@fixture/origin@1.0.0': {
        licenseFiles: [{
          path: `licenses/package-texts/${capsule.sha256(packageText)}.txt`,
          sha256: capsule.sha256(packageText), sourceUrl: 'https://example.invalid/origin/LICENSE',
          sourceCommit: '1234567890abcdef1234567890abcdef12345678'
        }]
      }
    }
  });
  writeJson(path.join(repositoryRoot, 'compliance', 'embedded-license-materials.json'), makeEmbedded());
  writeJson(path.join(repositoryRoot, 'compliance', 'SOURCES.json'), makeSources());
  writeFile(path.join(repositoryRoot, 'scripts', 'third-party-inventory.js'), "const inferredWasm = recipes.get('wasm-vips@fixture');\n");
  for (const id of capsule.SPDX_IDS) writeFile(path.join(repositoryRoot, 'licenses', `SPDX-${id}.txt`), `SPDX fixture ${id}\n`);
  for (const target of TARGETS) writeFile(path.join(repositoryRoot, materialPath(target)), `copying ${suffix(target)}\n`);
  writeFile(path.join(repositoryRoot, wasmMaterialPath()), 'copying wasm\n');
  writeFile(path.join(repositoryRoot, 'licenses', 'embedded-components', 'unused.txt'), 'unused\n');
  const artifacts = TARGETS.map((target) => {
    const root = path.join(artifactRoot, suffix(target));
    writeArtifact({ root, target, lock, lockContent, lockSha, packageText, repositoryRoot, candidateDir, includeWasm });
    return root;
  });
  function output(name) {
    return path.join(os.tmpdir(), `whaledock-dsh-capsule-${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }
  function aggregate(outputDir) {
    return capsule.aggregateCapsule({
      repositoryRoot, candidateDir, artifacts, expectedCommit: EXPECTED_COMMIT, outputDir
    });
  }
  function cleanup(outputs = []) {
    for (const exact of [repositoryRoot, artifactRoot, ...outputs]) {
      if (exact.startsWith(os.tmpdir() + path.sep) && fs.existsSync(exact)) fs.rmSync(exact, { recursive: true, force: true });
    }
  }
  return {
    repositoryRoot, artifactRoot, candidateDir, artifacts, lock, lockContent, lockSha,
    packageText, includeWasm, output, aggregate, cleanup
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code, code);
}

function compressedTreeHash(entries, osByte) {
  const canonical = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const compressed = zlib.gzipSync(canonical, {
    level: 9,
    strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    mtime: 0
  });
  compressed[9] = osByte;
  return capsule.sha256(compressed);
}

function resealArtifactJson(artifact, kind, mutate) {
  const targetSuffix = path.basename(artifact);
  const name = `${kind}-${targetSuffix}.json`;
  const filePath = path.join(artifact, name);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  writeJson(filePath, value);
  const bytes = fs.readFileSync(filePath);
  const materialPathname = path.join(artifact, `material-manifest-${targetSuffix}.json`);
  const material = JSON.parse(fs.readFileSync(materialPathname, 'utf8'));
  const field = kind === 'inventory' ? 'inventory' : 'evidence';
  material[field] = { path: name, bytes: bytes.length, sha256: capsule.sha256(bytes) };
  writeJson(materialPathname, material);
}

function main() {
  check('三目标 material/commit/evidence/closure 深绑定并保留 wasm 闭包', () => {
    const value = fixture();
    const output = value.output('deep');
    try {
      const result = value.aggregate(output);
      assert.equal(result.requiresWasmCondition, false);
      assert.equal(result.capsuleManifest.wasm.present, true);
      assert.equal(result.capsuleManifest.expectedCommit, EXPECTED_COMMIT);
      assert.deepEqual(result.capsuleManifest.compliance.overrideKeys, ['@fixture/origin@1.0.0']);
      assert.equal(
        result.capsuleManifest.compliance.licenseMaterials.length,
        result.capsuleManifest.compliance.licenseFiles.length
      );
      const summary = JSON.parse(fs.readFileSync(path.join(output, 'native-evidence-summary.json')));
      assert.equal(summary.targets.length, 3);
      assert(summary.targets.every((target) => target.targetNativeProofs.length >= 7));
      assert.equal(Object.hasOwn(summary.targets[0].tree, 'entries'), false);
      const embedded = JSON.parse(fs.readFileSync(path.join(output, 'compliance', 'embedded-license-materials.json')));
      const sources = JSON.parse(fs.readFileSync(path.join(output, 'compliance', 'SOURCES.json')));
      assert.equal(embedded.targets.length, 4);
      assert.equal(embedded.components.length, 4);
      assert.equal(embedded.materials.length, 4);
      assert.equal(sources.containers.length, 4);
      assert.equal(sources.components.length, 4);
      assert.equal(sources.buildRecipes.length, 4);
      assert.equal(sources.buildInputPackages.length, 1);
      assert.equal(fs.existsSync(path.join(output, 'evidence', 'material-manifest-darwin-arm64.json')), true);
    } finally { value.cleanup([output]); }
  });

  check('case-fold 只容许精确 package 顶层 README 唯一别名', () => {
    const packagePath = 'node_modules/@fixture/native';
    const directory = { path: packagePath, type: 'directory' };
    const readme = { path: `${packagePath}/ReadMe.md`, type: 'file', sha256: '1'.repeat(64) };
    const unique = new Map([[packagePath, directory], [readme.path, readme]]);
    assert.equal(capsule.licenseFindingEntry(unique, packagePath, 'README.md', 'darwin/arm64'), readme);
    assert.equal(capsule.licenseFindingEntry(unique, packagePath, 'readme.md', 'win32/x64'), readme);
    assert.equal(capsule.licenseFindingEntry(unique, packagePath, 'licenSE', 'darwin/arm64'), null);
    assert.equal(capsule.licenseFindingEntry(unique, packagePath, 'README.md', 'linux/x64'), null);
    assert.equal(capsule.licenseFindingEntry(new Map([[readme.path, readme]]), packagePath,
      'README.md', 'darwin/arm64'), null);

    const alternate = { path: `${packagePath}/READme.md`, type: 'file', sha256: '2'.repeat(64) };
    const ambiguous = new Map([
      [packagePath, directory],
      [readme.path, readme],
      [alternate.path, alternate]
    ]);
    assert.equal(capsule.licenseFindingEntry(ambiguous, packagePath, 'README.md', 'darwin/arm64'), null);
  });

  check('evidence 压缩工具链与目标 gzip OS hash 均精确绑定', () => {
    for (const field of ['compressionNodeVersion', 'compressionZlibVersion']) {
      const value = fixture();
      const output = value.output(`compression-${field}`);
      try {
        resealArtifactJson(value.artifacts[0], 'evidence', (evidence) => {
          evidence.tree[field] = `drifted-${field}`;
        });
        expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_EVIDENCE');
        assert.equal(fs.existsSync(output), false);
      } finally { value.cleanup([output]); }
    }

    const value = fixture();
    const output = value.output('compression-wrong-os');
    try {
      resealArtifactJson(value.artifacts[0], 'evidence', (evidence) => {
        // darwin runner 应为 OS_CODE=19；改成 Windows OS_CODE=10 后必须拒绝。
        evidence.tree.compressedSha256 = compressedTreeHash(evidence.tree.entries, 10);
      });
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_EVIDENCE');
      assert.equal(fs.existsSync(output), false);
    } finally { value.cleanup([output]); }
  });

  check('混用 commit 与 candidate manifest hash 均 fail-closed', () => {
    const value = fixture();
    const output = value.output('mixed');
    try {
      const materialPathname = path.join(value.artifacts[1], 'material-manifest-darwin-x64.json');
      const material = JSON.parse(fs.readFileSync(materialPathname, 'utf8'));
      material.gitCommit = 'b'.repeat(40);
      writeJson(materialPathname, material);
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_ARTIFACT');
      material.gitCommit = EXPECTED_COMMIT;
      material.candidateManifest.sha256 = '0'.repeat(64);
      writeJson(materialPathname, material);
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_STALE');
      assert.equal(fs.existsSync(output), false);
    } finally { value.cleanup([output]); }
  });

  check('runner material pool 全量 bytes/hash 漂移 fail-closed', () => {
    const value = fixture();
    const output = value.output('material');
    try {
      fs.writeFileSync(path.join(value.repositoryRoot, 'licenses', 'SPDX-MIT.txt'), 'drifted SPDX fixture\n');
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_STALE');
      assert.equal(fs.existsSync(output), false);
    } finally { value.cleanup([output]); }
  });

  check('inventory closure 与 native proof 篡改即使重封 artifact hash 仍拒绝', () => {
    const closureValue = fixture();
    const closureOutput = closureValue.output('closure');
    try {
      resealArtifactJson(closureValue.artifacts[0], 'inventory', (inventory) => {
        inventory.closureSha256 = '0'.repeat(64);
      });
      expectCode(() => closureValue.aggregate(closureOutput), 'ERR_DSH_CANDIDATE_CAPSULE_INVENTORY');
    } finally { closureValue.cleanup([closureOutput]); }
    const nativeValue = fixture();
    const nativeOutput = nativeValue.output('native');
    try {
      resealArtifactJson(nativeValue.artifacts[0], 'evidence', (evidence) => {
        evidence.targetNativeProofs[0].machines = ['x86_64'];
      });
      expectCode(() => nativeValue.aggregate(nativeOutput), 'ERR_DSH_CANDIDATE_CAPSULE_EVIDENCE');
    } finally { nativeValue.cleanup([nativeOutput]); }
  });

  check('wasm 不在实际 runtime 且 verifier 仍无条件时 staging 前非零拒绝', () => {
    const value = fixture({ includeWasm: false });
    const output = value.output('wasm-absent');
    try {
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_WASM');
      assert.equal(fs.existsSync(output), false);
    } finally { value.cleanup([output]); }
  });

  check('production SOURCES stale identity fail-closed', () => {
    const value = fixture();
    const output = value.output('sources');
    try {
      const sourcePath = path.join(value.repositoryRoot, 'compliance', 'SOURCES.json');
      const sources = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      sources.containers[0].integrity = 'sha512-c3RhbGU=';
      writeJson(sourcePath, sources);
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_STALE');
    } finally { value.cleanup([output]); }
  });

  check('批准目标重复与 CLI expected-commit/output 边界均拒绝', () => {
    assert.throws(() => capsule.parseArgs(['--artifact=a']), /恰好三个/);
    const args = [
      '--artifact=a', '--artifact=b', '--artifact=c', '--candidate-dir=x',
      '--output-dir=/tmp/whaledock-dsh-capsule-x', '--expected-commit=BAD'
    ];
    assert.throws(() => capsule.parseArgs(args), /40 位/);
    const value = fixture();
    const output = value.output('target');
    const existing = value.output('existing');
    fs.mkdirSync(existing);
    try {
      fs.rmSync(value.artifacts[2], { recursive: true });
      fs.cpSync(value.artifacts[1], value.artifacts[2], { recursive: true });
      expectCode(() => value.aggregate(output), 'ERR_DSH_CANDIDATE_CAPSULE_TARGET');
      expectCode(() => capsule.validateOutputDir(value.repositoryRoot), 'ERR_DSH_CANDIDATE_CAPSULE_OUTPUT');
      expectCode(() => capsule.validateOutputDir(existing), 'ERR_DSH_CANDIDATE_CAPSULE_OUTPUT');
    } finally { value.cleanup([output, existing]); }
  });

  console.log(`\n${passed} PASS / ALL PASS`);
}

main();
