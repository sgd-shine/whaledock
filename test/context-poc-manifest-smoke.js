'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifest = require('../scripts/context-poc-manifest');
const packagedVerifier = require('../scripts/verify-packaged-app-runtime');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  context-poc-manifest: ${name}`);
  } catch (error) {
    console.error(`FAIL  context-poc-manifest: ${name}`);
    throw error;
  }
}

function copySource(target) {
  fs.cpSync(manifest.CONTEXT_POC_ROOT, target, { recursive: true });
  return target;
}

function fileAt(root, relative) {
  return path.join(root, ...relative.split('/'));
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-context-root-'));
  try {
    test('committed baseline 为规范字节并锁定精确 15 文件', () => {
      const baseline = manifest.readBaseline();
      const receipt = manifest.assertCommittedBaseline();
      assert.equal(baseline.files.length, 15);
      assert.equal(receipt.files, 15);
      assert.equal(receipt.digest, baseline.digest);
      assert.deepEqual(
        baseline.files.map((file) => file.path),
        [...manifest.SOURCE_FILES]
      );
      const packageJson = require('../package.json');
      const resource = packageJson.build.extraResources.find((entry) => (
        entry.from === 'context-poc' && entry.to === 'context-poc'
      ));
      assert(resource);
      assert.deepEqual(resource.filter, [...manifest.SOURCE_FILES]);
    });

    test('源树增加、删除、改字节与 symlink 全部 fail-closed', () => {
      const extra = copySource(path.join(tmp, 'extra'));
      fs.writeFileSync(path.join(extra, 'unknown.txt'), 'reject');
      assert.throws(() => manifest.createManifest(extra), /MANIFEST_TREE/);

      const missing = copySource(path.join(tmp, 'missing'));
      fs.rmSync(fileAt(missing, 'plugin/lib/client.js'));
      assert.throws(() => manifest.createManifest(missing), /MANIFEST_TREE/);

      const changed = copySource(path.join(tmp, 'changed'));
      const changedPath = fileAt(changed, 'plugin/package.json');
      const bytes = fs.readFileSync(changedPath);
      bytes[0] ^= 0xff;
      fs.writeFileSync(changedPath, bytes);
      assert.throws(() => manifest.assertManifestMatches(
        manifest.readBaseline(), manifest.createManifest(changed)
      ), /BASELINE_MISMATCH/);

      const linked = copySource(path.join(tmp, 'linked'));
      const linkedPath = fileAt(linked, 'plugin/lib/client.js');
      fs.rmSync(linkedPath);
      fs.symlinkSync(fileAt(manifest.CONTEXT_POC_ROOT, 'plugin/lib/client.js'), linkedPath);
      assert.throws(() => manifest.createManifest(linked), /MANIFEST_SYMLINK/);
    });

    test('单文件 2 MiB 与聚合 8 MiB 精确边界通过，+1 拒绝', () => {
      const single = copySource(path.join(tmp, 'single'));
      const first = fileAt(single, manifest.SOURCE_FILES[0]);
      fs.writeFileSync(first, Buffer.alloc(manifest.MAX_FILE_BYTES, 0x61));
      assert.equal(manifest.createManifest(single).files[0].size, manifest.MAX_FILE_BYTES);
      fs.appendFileSync(first, Buffer.from([0x62]));
      assert.throws(() => manifest.createManifest(single), /MANIFEST_FILE/);

      const total = copySource(path.join(tmp, 'total'));
      for (let index = 0; index < manifest.SOURCE_FILES.length; index += 1) {
        const size = index < 3
          ? manifest.MAX_FILE_BYTES
          : (index === 3
            ? manifest.MAX_FILE_BYTES - (manifest.SOURCE_FILES.length - 4)
            : 1);
        fs.writeFileSync(fileAt(total, manifest.SOURCE_FILES[index]), Buffer.alloc(size, 0x63));
      }
      assert.equal(manifest.createManifest(total).totalBytes, manifest.MAX_TOTAL_BYTES);
      fs.appendFileSync(fileAt(total, manifest.SOURCE_FILES[3]), Buffer.from([0x64]));
      assert.throws(() => manifest.createManifest(total), /MANIFEST_TOTAL/);
    });

    test('伪 baseline 即使自洽也不能替换 committed root', () => {
      const baseline = manifest.readBaseline();
      const forgedFiles = baseline.files.map((file, index) => (
        index === 0 ? { ...file, sha256: 'a'.repeat(64) } : { ...file }
      ));
      const forged = {
        ...baseline,
        files: forgedFiles,
        digest: manifest.manifestDigest(forgedFiles)
      };
      assert.doesNotThrow(() => manifest.validateBaseline(forged));
      assert.throws(() => manifest.assertManifestMatches(baseline, forged), /BASELINE_MISMATCH/);
      assert.throws(() => manifest.validateBaseline({
        ...baseline,
        digest: '0'.repeat(64)
      }), /BASELINE_DIGEST/);
      assert.throws(() => manifest.parseArgs(['--write']), /MANIFEST_ARGS/);
    });

    test('成品 verifier 从 app.asar 基线对账 Resources exact tree', () => {
      const asar = path.join(tmp, 'fake-app.asar');
      const resources = path.join(tmp, 'resources');
      fs.mkdirSync(path.join(asar, 'lib'), { recursive: true });
      fs.copyFileSync(
        manifest.BASELINE_PATH,
        path.join(asar, 'lib', 'context-poc-baseline.json')
      );
      copySource(path.join(resources, 'context-poc'));
      fs.cpSync(
        path.join(__dirname, '..', 'compliance', 'app-runtime'),
        path.join(resources, 'compliance', 'app-runtime'),
        { recursive: true }
      );
      const inventory = require('../compliance/app-runtime/inventory.json');
      const receipt = packagedVerifier.verifyPackagedContextPoc({ asar, resources, inventory });
      assert.equal(receipt.contextPocBaselineVerified, true);
      assert.equal(receipt.contextPocFiles, 15);

      fs.appendFileSync(
        path.join(resources, 'context-poc', 'plugin', 'lib', 'client.js'),
        '\n// tampered'
      );
      assert.throws(() => packagedVerifier.verifyPackagedContextPoc({
        asar, resources
      }), /BASELINE_MISMATCH/);
    });

    test('外层成品 receipt 必须带回 app.asar 信任根摘要', () => {
      const baseline = manifest.readBaseline();
      const inventory = require('../compliance/app-runtime/inventory.json');
      const sources = require('../compliance/app-runtime/SOURCES.json');
      const sourcesBytes = fs.readFileSync(path.join(
        __dirname, '..', 'compliance', 'app-runtime', 'SOURCES.json'
      ));
      const report = {
        status: 'PASS',
        electronVersion: '43.4.0',
        appVersion: require('../package.json').version,
        sdkVersion: '1.73.0',
        packageCount: inventory.packageCount,
        lazyLoadVerified: true,
        sdkExportsVerified: ['EventDispatcher', 'WSClient'],
        fileCount: inventory.packagedFileCount,
        treeSha256: inventory.packagedTreeSha256,
        contextPocBaselineVerified: true,
        contextPocFiles: baseline.files.length,
        contextPocBytes: baseline.totalBytes,
        contextPocDigest: baseline.digest,
        redistributedForksVerified: true,
        redistributedForkCount: sources.components.length,
        redistributedForksTreeSha256: packagedVerifier.redistributedForksTreeSha256(sources),
        redistributedSourcesSha256: crypto.createHash('sha256').update(sourcesBytes).digest('hex'),
        redistributedLicenseSha256: sources.license.sha256
      };
      assert.doesNotThrow(() => packagedVerifier.validateProbeReport(
        report, inventory, report.appVersion, baseline, sources
      ));
      assert.throws(() => packagedVerifier.validateProbeReport(
        { ...report, contextPocDigest: 'f'.repeat(64) },
        inventory,
        report.appVersion,
        baseline,
        sources
      ), /context-poc receipt/);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`CONTEXT POC MANIFEST ALL PASS (${passed})`);
}

main();
