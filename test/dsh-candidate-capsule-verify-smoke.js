'use strict';

// 候选胶囊 verifier 的纯 Node fixture；只在系统临时目录读写。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const verifier = require('../scripts/dsh-candidate-capsule-verify');

const TARGET_OBJECTS = [
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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyFile(source, destination) {
  writeFile(destination, fs.readFileSync(source));
}

function suffix(target) {
  return `${target.platform}-${target.arch}`;
}

function manifest(target, generatedAt) {
  return {
    schemaVersion: 3,
    dshVersion: verifier.VERSION,
    packageIntegrity: 'sha512-Zml4dHVyZQ==',
    auditedLockSha256: '1'.repeat(64),
    installScriptsIgnored: true,
    installScriptPackages: ['fixture'],
    platform: target.platform,
    arch: target.arch,
    hostPlatform: target.platform,
    hostArch: target.arch,
    generatedAt
  };
}

function rawEvidence(target, manifestSha) {
  return {
    schemaVersion: 1,
    runtime: {
      version: verifier.VERSION,
      platform: target.platform,
      arch: target.arch,
      hostPlatform: target.platform,
      hostArch: target.arch,
      manifestSha256: manifestSha,
      packageSha256: '2'.repeat(64),
      lockSha256: '1'.repeat(64),
      installedPackageSha256: '3'.repeat(64),
      packageIntegrity: 'sha512-Zml4dHVyZQ==',
      lockPackages: 3,
      installScriptsIgnored: true,
      exactBinRelative: 'node_modules/@deepseek-ai/dsh/bin.js'
    },
    tree: {
      directoryCount: 4,
      fileCount: 3,
      symlinkCount: 0,
      logicalBytes: 100,
      symlinkTargetBytes: 0,
      canonicalBytes: 200,
      canonicalSha256: '6'.repeat(64),
      compression: 'gzip',
      compressionNodeVersion: 'v22.0.0',
      compressionZlibVersion: '1.3.1',
      compressedBytes: 90,
      compressedSha256: '8'.repeat(64),
      entries: []
    },
    nativeBinaries: [],
    targetNativeProofs: [],
    dumpConfig: { exit: 0, bytes: 10, lines: 1, sha256: '4'.repeat(64), stderrBytes: 0, stderrSha256: '5'.repeat(64) }
  };
}

function nativeSummary(volatile) {
  return {
    schemaVersion: 1,
    candidateVersion: verifier.VERSION,
    expectedCommit: volatile ? 'a'.repeat(40) : 'b'.repeat(40),
    auditedLockSha256: '1'.repeat(64),
    targets: TARGET_OBJECTS.map((target, index) => ({
      ...target,
      inventorySha256: `${index + 6}`.repeat(64),
      fullEvidenceSha256: volatile ? 'a'.repeat(64) : 'b'.repeat(64),
      runtimeManifestSha256: volatile ? 'c'.repeat(64) : 'd'.repeat(64),
      materialManifestSha256: volatile ? '0'.repeat(64) : '1'.repeat(64),
      runtime: {
        version: verifier.VERSION,
        platform: target.platform,
        arch: target.arch,
        hostPlatform: target.platform,
        hostArch: target.arch,
        manifestSha256: volatile ? 'e'.repeat(64) : 'f'.repeat(64),
        packageSha256: '2'.repeat(64),
        lockSha256: '1'.repeat(64),
        installedPackageSha256: '3'.repeat(64),
        packageIntegrity: 'sha512-Zml4dHVyZQ==',
        lockPackages: 3,
        installScriptsIgnored: true,
        exactBinRelative: 'node_modules/@deepseek-ai/dsh/bin.js'
      },
      tree: {
        directoryCount: 4,
        fileCount: 3,
        symlinkCount: 0,
        logicalBytes: 100,
        symlinkTargetBytes: 0,
        canonicalBytes: 200,
        canonicalSha256: volatile ? '6'.repeat(64) : '7'.repeat(64),
        compression: 'gzip',
        compressionNodeVersion: 'v22.0.0',
        compressionZlibVersion: '1.3.1',
        compressedBytes: volatile ? 90 : 91,
        compressedSha256: volatile ? '8'.repeat(64) : '9'.repeat(64)
      },
      nativeBinaries: [{ path: `native-${index}.node`, machines: [target.arch === 'x64' ? 'x86_64' : 'arm64'], sha256: 'a'.repeat(64) }],
      targetNativeProofs: [{ label: 'fixture', path: `native-${index}.node`, machines: [target.arch === 'x64' ? 'x86_64' : 'arm64'], sha256: 'a'.repeat(64) }],
      dumpConfig: {
        exit: 0,
        bytes: 10,
        lines: 1,
        sha256: '4'.repeat(64),
        stderrBytes: 0,
        stderrSha256: '5'.repeat(64)
      }
    }))
  };
}

function capsuleManifest(volatile) {
  return {
    schemaVersion: 1,
    candidateVersion: verifier.VERSION,
    expectedCommit: volatile ? 'a'.repeat(40) : 'b'.repeat(40),
    auditedLockSha256: '1'.repeat(64),
    runtimePackageIntegrity: 'sha512-Zml4dHVyZQ==',
    targets: TARGET_OBJECTS.map((target, index) => ({
      ...target,
      inventorySha256: `${index + 6}`.repeat(64),
      evidenceSha256: volatile ? 'a'.repeat(64) : 'b'.repeat(64),
      runtimeManifestSha256: volatile ? 'c'.repeat(64) : 'd'.repeat(64),
      materialManifestSha256: volatile ? '0'.repeat(64) : '1'.repeat(64)
    })),
    compliance: {
      embeddedLicenseMaterialsSha256: 'e'.repeat(64),
      sourcesSha256: 'f'.repeat(64),
      packageLicenseOverridesSha256: '0'.repeat(64),
      nativeEvidenceSummarySha256: volatile ? '1'.repeat(64) : '2'.repeat(64),
      overrideKeys: [],
      licenseFiles: ['licenses/SPDX-MIT.txt', 'licenses/package-texts/fixture.txt']
    },
    wasm: { present: true, requiresThirdPartyInventoryConditionalCheck: false }
  };
}

function fixture(options = {}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-capsule-verify-repo-'));
  const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-dsh-capsule-generated-'));
  const mirrorDir = options.mirror
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-dsh-capsule-mirror-')) : null;
  const candidateDir = path.join(repositoryRoot, 'compliance', 'candidates', 'dsh-rc2');
  const capsuleDir = path.join(candidateDir, 'capsule');
  fs.mkdirSync(capsuleDir, { recursive: true });

  const lock = {
    name: 'whaledock-dsh-runtime',
    version: '0.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'whaledock-dsh-runtime', version: '0.0.0', dependencies: { '@deepseek-ai/dsh': verifier.VERSION } },
      'node_modules/@deepseek-ai/dsh': { version: verifier.VERSION, integrity: 'sha512-Zml4dHVyZQ==' }
    }
  };
  const lockContent = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
  const candidateManifest = {
    schemaVersion: 1,
    packageVersion: verifier.VERSION,
    auditedLock: { path: 'dsh-runtime-package-lock.json', sha256: verifier.sha256(lockContent) },
    targets: TARGET_OBJECTS,
    installScriptAllowlist: []
  };
  const overrides = { schemaVersion: 1, packages: {} };
  writeJson(path.join(candidateDir, 'candidate-manifest.json'), candidateManifest);
  writeFile(path.join(candidateDir, 'dsh-runtime-package-lock.json'), lockContent);
  writeJson(path.join(candidateDir, 'package-license-overrides.json'), overrides);
  copyFile(path.join(candidateDir, 'candidate-manifest.json'), path.join(generatedDir, 'candidate', 'candidate-manifest.json'));
  copyFile(path.join(candidateDir, 'dsh-runtime-package-lock.json'), path.join(generatedDir, 'candidate', 'dsh-runtime-package-lock.json'));

  for (const target of TARGET_OBJECTS) {
    writeJson(path.join(generatedDir, 'compliance', `inventory-${suffix(target)}.json`), {
      schemaVersion: 2,
      target,
      runtimeVersion: verifier.VERSION,
      packageCount: 0,
      packages: []
    });
  }
  writeJson(path.join(generatedDir, 'compliance', 'embedded-license-materials.json'), { schemaVersion: 1, targets: [] });
  writeJson(path.join(generatedDir, 'compliance', 'SOURCES.json'), { schemaVersion: 1, containers: [] });
  writeJson(path.join(generatedDir, 'compliance', 'package-license-overrides.json'), overrides);
  for (const file of verifier.COMPLIANCE_FILES) {
    copyFile(path.join(generatedDir, 'compliance', file), path.join(capsuleDir, 'compliance', file));
  }

  writeFile(path.join(generatedDir, 'licenses', 'SPDX-MIT.txt'), 'MIT fixture\n');
  writeFile(path.join(generatedDir, 'licenses', 'package-texts', 'fixture.txt'), 'package fixture\n');
  copyFile(path.join(generatedDir, 'licenses', 'SPDX-MIT.txt'), path.join(capsuleDir, 'licenses', 'SPDX-MIT.txt'));
  copyFile(path.join(generatedDir, 'licenses', 'package-texts', 'fixture.txt'), path.join(capsuleDir, 'licenses', 'package-texts', 'fixture.txt'));

  for (const target of TARGET_OBJECTS) {
    const file = `runtime-manifest-${suffix(target)}.json`;
    const evidenceFile = `evidence-${suffix(target)}.json`;
    const materialFile = `material-manifest-${suffix(target)}.json`;
    const generatedManifest = manifest(target, '2026-08-22T01:02:03.000Z');
    const approvedManifest = manifest(target, '2026-08-22T00:00:00.000Z');
    writeJson(path.join(generatedDir, 'evidence', file), generatedManifest);
    writeJson(path.join(capsuleDir, 'runtime-manifests', file), approvedManifest);
    writeJson(
      path.join(generatedDir, 'evidence', evidenceFile),
      rawEvidence(target, verifier.sha256(Buffer.from(`${JSON.stringify(generatedManifest, null, 2)}\n`)))
    );
    const candidateManifestPath = path.join(candidateDir, 'candidate-manifest.json');
    const inventoryPath = path.join(generatedDir, 'compliance', `inventory-${suffix(target)}.json`);
    const evidencePath = path.join(generatedDir, 'evidence', evidenceFile);
    const runtimePath = path.join(generatedDir, 'evidence', file);
    const bound = (filePath, relative) => {
      const content = fs.readFileSync(filePath);
      return { path: relative, bytes: content.length, sha256: verifier.sha256(content) };
    };
    const generatedMaterial = {
      schemaVersion: 1,
      candidateVersion: verifier.VERSION,
      target,
      gitCommit: 'a'.repeat(40),
      candidateManifest: bound(candidateManifestPath, 'compliance/candidates/dsh-rc2/candidate-manifest.json'),
      inventory: bound(inventoryPath, `inventory-${suffix(target)}.json`),
      evidence: bound(evidencePath, evidenceFile),
      runtimeManifest: bound(runtimePath, file),
      referencedLicenseMaterials: [
        { path: 'licenses/SPDX-MIT.txt', bytes: 12, sha256: verifier.sha256(Buffer.from('MIT fixture\n')), uploaded: false },
        { path: 'licenses/package-texts/fixture.txt', bytes: 16, sha256: verifier.sha256(Buffer.from('package fixture\n')), uploaded: true }
      ]
    };
    const approvedMaterial = JSON.parse(JSON.stringify(generatedMaterial));
    approvedMaterial.gitCommit = 'b'.repeat(40);
    approvedMaterial.evidence.bytes += 7;
    approvedMaterial.evidence.sha256 = 'c'.repeat(64);
    approvedMaterial.runtimeManifest.bytes += 9;
    approvedMaterial.runtimeManifest.sha256 = 'd'.repeat(64);
    writeJson(path.join(generatedDir, 'evidence', materialFile), generatedMaterial);
    writeJson(path.join(capsuleDir, 'material-manifests', materialFile), approvedMaterial);
  }
  const generatedSummary = nativeSummary(true);
  for (const target of TARGET_OBJECTS) {
    const targetSuffix = suffix(target);
    const inventoryPath = path.join(generatedDir, 'compliance', `inventory-${targetSuffix}.json`);
    const evidencePath = path.join(generatedDir, 'evidence', `evidence-${targetSuffix}.json`);
    const runtimePath = path.join(generatedDir, 'evidence', `runtime-manifest-${targetSuffix}.json`);
    const materialPath = path.join(generatedDir, 'evidence', `material-manifest-${targetSuffix}.json`);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const summaryTarget = generatedSummary.targets.find((row) => suffix(row) === targetSuffix);
    const { entries: _entries, ...aggregateTree } = evidence.tree;
    summaryTarget.inventorySha256 = verifier.sha256(fs.readFileSync(inventoryPath));
    summaryTarget.fullEvidenceSha256 = verifier.sha256(fs.readFileSync(evidencePath));
    summaryTarget.runtimeManifestSha256 = verifier.sha256(fs.readFileSync(runtimePath));
    summaryTarget.materialManifestSha256 = verifier.sha256(fs.readFileSync(materialPath));
    summaryTarget.runtime = evidence.runtime;
    summaryTarget.tree = aggregateTree;
    summaryTarget.nativeBinaries = evidence.nativeBinaries;
    summaryTarget.targetNativeProofs = evidence.targetNativeProofs;
    summaryTarget.dumpConfig = evidence.dumpConfig;
  }
  const approvedSummary = JSON.parse(JSON.stringify(generatedSummary));
  approvedSummary.expectedCommit = 'b'.repeat(40);
  for (const target of approvedSummary.targets) {
    target.fullEvidenceSha256 = 'b'.repeat(64);
    target.runtimeManifestSha256 = 'd'.repeat(64);
    target.materialManifestSha256 = '1'.repeat(64);
    target.runtime.manifestSha256 = 'f'.repeat(64);
    target.tree.canonicalSha256 = '7'.repeat(64);
    target.tree.compressedBytes = 91;
    target.tree.compressedSha256 = '9'.repeat(64);
  }
  writeJson(path.join(generatedDir, 'native-evidence-summary.json'), generatedSummary);
  writeJson(path.join(capsuleDir, 'native-evidence-summary.json'), approvedSummary);

  const generatedCapsule = capsuleManifest(true);
  for (const target of TARGET_OBJECTS) {
    const targetSuffix = suffix(target);
    const capsuleTarget = generatedCapsule.targets.find((row) => suffix(row) === targetSuffix);
    capsuleTarget.inventorySha256 = verifier.sha256(fs.readFileSync(
      path.join(generatedDir, 'compliance', `inventory-${targetSuffix}.json`)
    ));
    capsuleTarget.evidenceSha256 = verifier.sha256(fs.readFileSync(
      path.join(generatedDir, 'evidence', `evidence-${targetSuffix}.json`)
    ));
    capsuleTarget.runtimeManifestSha256 = verifier.sha256(fs.readFileSync(
      path.join(generatedDir, 'evidence', `runtime-manifest-${targetSuffix}.json`)
    ));
    capsuleTarget.materialManifestSha256 = verifier.sha256(fs.readFileSync(
      path.join(generatedDir, 'evidence', `material-manifest-${targetSuffix}.json`)
    ));
  }
  generatedCapsule.compliance.embeddedLicenseMaterialsSha256 = verifier.sha256(fs.readFileSync(
    path.join(generatedDir, 'compliance', 'embedded-license-materials.json')
  ));
  generatedCapsule.compliance.sourcesSha256 = verifier.sha256(fs.readFileSync(
    path.join(generatedDir, 'compliance', 'SOURCES.json')
  ));
  generatedCapsule.compliance.packageLicenseOverridesSha256 = verifier.sha256(fs.readFileSync(
    path.join(generatedDir, 'compliance', 'package-license-overrides.json')
  ));
  generatedCapsule.compliance.nativeEvidenceSummarySha256 = verifier.sha256(fs.readFileSync(
    path.join(generatedDir, 'native-evidence-summary.json')
  ));
  const approvedCapsule = JSON.parse(JSON.stringify(generatedCapsule));
  approvedCapsule.expectedCommit = 'b'.repeat(40);
  for (const target of approvedCapsule.targets) {
    target.evidenceSha256 = 'b'.repeat(64);
    target.runtimeManifestSha256 = 'd'.repeat(64);
    target.materialManifestSha256 = '1'.repeat(64);
  }
  approvedCapsule.compliance.nativeEvidenceSummarySha256 = '2'.repeat(64);
  writeJson(path.join(generatedDir, 'capsule-manifest.json'), generatedCapsule);
  writeJson(path.join(capsuleDir, 'capsule-manifest.json'), approvedCapsule);
  writeFile(path.join(capsuleDir, 'README.md'), 'approved capsule metadata\n');
  writeJson(path.join(capsuleDir, 'evidence-provenance.json'), { schemaVersion: 1, run: 123 });

  if (mirrorDir) {
    writeFile(path.join(mirrorDir, 'compliance', 'SOURCES.md'), '# Sources fixture\n');
    writeFile(path.join(mirrorDir, 'THIRD_PARTY_NOTICES.md'), '# Notices fixture\n');
    writeFile(path.join(mirrorDir, 'unrelated-build-input.txt'), 'allowed mirror input\n');
    copyFile(path.join(mirrorDir, 'compliance', 'SOURCES.md'), path.join(capsuleDir, 'compliance', 'SOURCES.md'));
    copyFile(path.join(mirrorDir, 'THIRD_PARTY_NOTICES.md'), path.join(capsuleDir, 'THIRD_PARTY_NOTICES.md'));
  }

  function verify(overridesValue = {}) {
    return verifier.verifyCapsule({
      repositoryRoot,
      candidateDir,
      generatedDir,
      ...(mirrorDir ? { mirrorDir } : {}),
      ...overridesValue
    });
  }
  function cleanup() {
    for (const exact of [repositoryRoot, generatedDir, mirrorDir].filter(Boolean)) {
      if (exact.startsWith(os.tmpdir() + path.sep) && fs.existsSync(exact)) {
        fs.rmSync(exact, { recursive: true, force: true });
      }
    }
  }
  return { repositoryRoot, candidateDir, capsuleDir, generatedDir, mirrorDir, verify, cleanup };
}

function withFixture(fn, options) {
  const value = fixture(options);
  try { fn(value); } finally { value.cleanup(); }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code, code);
}

function main() {
  check('批准子集通过，忽略 fresh commit/明确挥发哈希/generatedAt，并允许两份非生成元数据', () => {
    withFixture((value) => {
      const result = value.verify();
      assert.deepEqual(result, {
        status: 'PASS',
        candidateVersion: verifier.VERSION,
        targets: verifier.TARGETS,
        licenseFiles: 2,
        mirrorVerified: false
      });
    });
  });

  check('可选 mirror 精确核对 SOURCES.md/NOTICE，正文漂移即失败', () => {
    withFixture((value) => {
      assert.equal(value.verify().mirrorVerified, true);
      fs.appendFileSync(path.join(value.mirrorDir, 'THIRD_PARTY_NOTICES.md'), 'drift\n');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    }, { mirror: true });
  });

  check('inventory 与 licenses 任一字节漂移均 fail-closed', () => {
    withFixture((value) => {
      fs.appendFileSync(path.join(value.capsuleDir, 'compliance', 'inventory-darwin-arm64.json'), ' ');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
    withFixture((value) => {
      fs.appendFileSync(path.join(value.capsuleDir, 'licenses', 'SPDX-MIT.txt'), ' ');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
  });

  check('generated/capsule 的额外或缺失文件均拒绝', () => {
    withFixture((value) => {
      writeFile(path.join(value.generatedDir, 'compliance', 'extra.json'), '{}\n');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_EXTRA');
    });
    withFixture((value) => {
      fs.unlinkSync(path.join(value.capsuleDir, 'runtime-manifests', verifier.RUNTIME_MANIFEST_FILES[0]));
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_MISSING');
    });
  });

  check('material manifest 额外目标与稳定材料向量漂移均拒绝', () => {
    withFixture((value) => {
      writeJson(path.join(value.generatedDir, 'evidence', 'material-manifest-linux-x64.json'), {
        schemaVersion: 1,
        candidateVersion: verifier.VERSION,
        target: { platform: 'linux', arch: 'x64' }
      });
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_EXTRA');
    });
    withFixture((value) => {
      const file = path.join(value.capsuleDir, 'material-manifests', verifier.MATERIAL_MANIFEST_FILES[0]);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.referencedLicenseMaterials[0].sha256 = 'f'.repeat(64);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
  });

  check('generated material 的 commit 与四类文件摘要必须同侧闭合', () => {
    withFixture((value) => {
      const file = path.join(value.generatedDir, 'evidence', verifier.MATERIAL_MANIFEST_FILES[0]);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.gitCommit = 'c'.repeat(40);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
    for (const field of ['candidateManifest', 'inventory', 'evidence', 'runtimeManifest']) {
      withFixture((value) => {
        const file = path.join(value.generatedDir, 'evidence', verifier.MATERIAL_MANIFEST_FILES[0]);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data[field].sha256 = 'f'.repeat(64);
        writeJson(file, data);
        expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
      });
    }
  });

  check('referenced license material 必须绑定 generated licenses 的真实字节', () => {
    withFixture((value) => {
      const file = path.join(value.generatedDir, 'evidence', verifier.MATERIAL_MANIFEST_FILES[0]);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.referencedLicenseMaterials[0].sha256 = 'f'.repeat(64);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
    withFixture((value) => {
      const file = path.join(value.generatedDir, 'evidence', verifier.MATERIAL_MANIFEST_FILES[0]);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.referencedLicenseMaterials[0].path = 'licenses/../candidate/candidate-manifest.json';
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
  });

  check('raw evidence 换包与跨文件目标混用均拒绝', () => {
    withFixture((value) => {
      const file = path.join(value.generatedDir, 'evidence', verifier.RAW_EVIDENCE_FILES[0]);
      writeJson(file, {
        schemaVersion: 1,
        runtime: { version: verifier.VERSION, platform: 'darwin', arch: 'arm64' }
      });
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
    withFixture((value) => {
      const first = path.join(value.generatedDir, 'evidence', verifier.RAW_EVIDENCE_FILES[0]);
      const second = path.join(value.generatedDir, 'evidence', verifier.RAW_EVIDENCE_FILES[1]);
      const left = fs.readFileSync(first);
      const right = fs.readFileSync(second);
      writeFile(first, right);
      writeFile(second, left);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_TARGET');
    });
  });

  check('generated capsule/summary 摘要与 raw evidence 语义必须同侧闭合', () => {
    withFixture((value) => {
      const file = path.join(value.generatedDir, 'capsule-manifest.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.targets[0].evidenceSha256 = 'f'.repeat(64);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
    withFixture((value) => {
      const file = path.join(value.generatedDir, 'native-evidence-summary.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.targets[0].runtime.packageSha256 = 'f'.repeat(64);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
  });

  check('dump-config stdout/stderr SHA 是稳定证据，漂移必须拒绝', () => {
    withFixture((value) => {
      const file = path.join(value.capsuleDir, 'native-evidence-summary.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.targets[0].dumpConfig.sha256 = 'f'.repeat(64);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
    withFixture((value) => {
      const file = path.join(value.capsuleDir, 'native-evidence-summary.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.targets[0].dumpConfig.stderrSha256 = 'f'.repeat(64);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
  });

  check('批准侧 material commit 也必须与批准 capsule/native 同侧闭合', () => {
    withFixture((value) => {
      const file = path.join(value.capsuleDir, 'material-manifests', verifier.MATERIAL_MANIFEST_FILES[0]);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.gitCommit = 'c'.repeat(40);
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_BINDING');
    });
  });

  check('可选元数据必须是普通文件，provenance schema 必须有效', () => {
    withFixture((value) => {
      const readme = path.join(value.capsuleDir, 'README.md');
      fs.unlinkSync(readme);
      fs.mkdirSync(readme);
      writeFile(path.join(readme, 'extra.bin'), 'extra\n');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_FILE');
    });
    withFixture((value) => {
      writeJson(path.join(value.capsuleDir, 'evidence-provenance.json'), { schemaVersion: 2 });
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_IDENTITY');
    });
  });

  check('任一树出现 symlink 均拒绝', () => {
    withFixture((value) => {
      const link = path.join(value.capsuleDir, 'licenses', 'license-link');
      try {
        fs.symlinkSync('SPDX-MIT.txt', link);
      } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') return;
        throw error;
      }
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_SYMLINK');
    });
  });

  check('candidate 顶层 manifest/lock/override 必须与 generated 身份字节一致', () => {
    withFixture((value) => {
      fs.appendFileSync(path.join(value.candidateDir, 'package-license-overrides.json'), ' ');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
    withFixture((value) => {
      fs.appendFileSync(path.join(value.candidateDir, 'dsh-runtime-package-lock.json'), ' ');
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
    });
  });

  check('稳定字段漂移仍拒绝，临时路径和 CLI 参数严格', () => {
    withFixture((value) => {
      const file = path.join(value.capsuleDir, 'runtime-manifests', verifier.RUNTIME_MANIFEST_FILES[0]);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.packageIntegrity = 'sha512-c3RhYmxlLWRyaWZ0';
      writeJson(file, data);
      expectCode(() => value.verify(), 'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_DRIFT');
      expectCode(
        () => value.verify({ generatedDir: value.repositoryRoot }),
        'ERR_DSH_CANDIDATE_CAPSULE_VERIFY_PATH'
      );
    });
    assert.throws(() => verifier.parseArgs(['--candidate-dir=x']), /必须提供/);
  });

  console.log(`\n${passed} PASS / ALL PASS`);
}

main();
