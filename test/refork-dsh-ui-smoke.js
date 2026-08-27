'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const refork = require('../scripts/refork-dsh-ui');

const VERSION = '0.1.1-rc.2';
const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const FILES = refork.REDISTRIBUTION_FILES;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  refork-dsh-ui: ${name}`);
  } catch (error) {
    console.error(`FAIL  refork-dsh-ui: ${name}`);
    throw error;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function writeJson(filePath, value) {
  write(filePath, JSON.stringify(value, null, 2) + '\n');
}

function tarField(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  assert.ok(bytes.length <= length);
  bytes.copy(header, offset);
}

function tarOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  tarField(header, offset, length, text);
}

function tarHeader(entry) {
  const header = Buffer.alloc(512);
  tarField(header, 0, 100, entry.path);
  tarOctal(header, 100, 8, entry.mode || 0o644);
  tarOctal(header, 108, 8, 0);
  tarOctal(header, 116, 8, 0);
  const content = Buffer.from(entry.content || '');
  tarOctal(header, 124, 12, entry.type === '5' ? 0 : content.length);
  tarOctal(header, 136, 12, 1);
  header.fill(0x20, 148, 156);
  header[156] = Buffer.from(entry.type || '0')[0];
  if (entry.linkname) tarField(header, 157, 100, entry.linkname);
  tarField(header, 257, 6, 'ustar\0');
  tarField(header, 263, 2, '00');
  tarField(header, 265, 32, 'fixture');
  tarField(header, 297, 32, 'fixture');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  tarField(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
  return { header, content };
}

function makeTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const { header, content } = tarHeader(entry);
    chunks.push(header, content);
    const remainder = content.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  const archive = Buffer.concat(chunks);
  return { archive, tarball: zlib.gzipSync(archive, { level: 9, mtime: 0 }) };
}

function fullReplacement(relative, before, after) {
  const oldLines = before.endsWith('\n') ? before.slice(0, -1).split('\n') : before.split('\n');
  const newLines = after.endsWith('\n') ? after.slice(0, -1).split('\n') : after.split('\n');
  return [
    `diff --git a/${relative} b/${relative}`,
    `--- a/${relative}`,
    `+++ b/${relative}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    ''
  ].join('\n');
}

function fileMetadata(files) {
  return Object.fromEntries(FILES.map((relative) => {
    const content = files.get(relative);
    return [relative, { size: content.length, sha256: sha256(content) }];
  }));
}

function finalTreeHash(files) {
  return refork.treeSha256(FILES.map((relative) => ({
    path: relative,
    size: files.get(relative).length,
    sha256: sha256(files.get(relative))
  })));
}

function packageFixture(key, options = {}) {
  const spec = refork.PACKAGE_SPECS[key];
  const upstreamManifest = `${JSON.stringify({ name: spec.name, version: VERSION, main: 'lib/index.js' })}\n`;
  const finalManifest = `${JSON.stringify({
    name: spec.name,
    version: VERSION,
    main: 'lib/index.js',
    whaledockFork: { purpose: `fixture-${key}` }
  })}\n`;
  const upstreamClient = `${key}: alpha\n${key}: beta\n${key}: omega\n`;
  const additions = options.additions || 1;
  const extra = Array.from({ length: additions }, (_value, index) => `${key}: added-${index + 1}`);
  const finalClient = [
    `${key}: alpha`,
    `${key}: beta`,
    ...extra,
    `${key}: omega`,
    ''
  ].join('\n');
  const upstream = new Map([
    ['package.json', Buffer.from(upstreamManifest)],
    ['LICENSE', Buffer.from('MIT fixture license\n')],
    ['lib/index.js', Buffer.from(`module.exports = '${key}';\n`)],
    ['lib/invariant.js', Buffer.from(`module.exports = '${key}-invariant';\n`)],
    ['lib/client.js', Buffer.from(upstreamClient)]
  ]);
  const final = new Map([...upstream].map(([name, content]) => [name, Buffer.from(content)]));
  final.set('package.json', Buffer.from(finalManifest));
  final.set('lib/client.js', Buffer.from(finalClient));
  const patchText = fullReplacement('package.json', upstreamManifest, finalManifest)
    + fullReplacement('lib/client.js', upstreamClient, finalClient);
  const tar = makeTar([
    ...FILES.map((relative) => ({ path: `package/${relative}`, content: upstream.get(relative) })),
    { path: 'package/README.md', content: Buffer.from('not redistributed\n') }
  ]);
  return {
    key,
    spec,
    upstream,
    final,
    patchText,
    tar,
    plan: {
      key,
      name: spec.name,
      version: VERSION,
      url: refork.expectedTarballUrl(spec.name, VERSION),
      tarballBytes: tar.tarball.length,
      tarballSha256: sha256(tar.tarball),
      integrity: refork.sha512Integrity(tar.tarball),
      archiveBytes: tar.archive.length,
      archiveEntries: FILES.length + 1,
      archiveTreeSha256: refork.parseNpmTarball(tar.tarball).treeSha256,
      forkPath: spec.forkPath,
      budgetTotalChangedLines: spec.budget,
      upstreamFiles: fileMetadata(upstream),
      unchangedFiles: ['LICENSE', 'lib/index.js', 'lib/invariant.js'],
      modifiedFiles: ['package.json', 'lib/client.js'],
      patch: {
        format: 'unified-v1',
        path: `refork/dsh-ui/${key}.patch`,
        sha256: sha256(Buffer.from(patchText))
      },
      finalFiles: fileMetadata(final),
      finalTreeSha256: finalTreeHash(final)
    }
  };
}

function writeFork(root, pkg, files) {
  const directory = path.join(root, ...pkg.spec.forkPath.split('/'));
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: false });
  for (const relative of FILES) write(path.join(directory, ...relative.split('/')), files.get(relative));
}

function baselineOrder() {
  return [
    'context-bridge.patch.yml',
    'FORK-NOTICE.md',
    'plugin/package.json',
    'plugin/lib/index.js',
    'plugin/lib/client.js',
    ...FILES.map((relative) => `forks/ui-layout/${relative}`),
    ...FILES.map((relative) => `forks/ui-conversation/${relative}`)
  ];
}

function baselineForRoot(root, order = baselineOrder()) {
  const rows = order.map((relative) => {
    const content = fs.readFileSync(path.join(root, 'context-poc', ...relative.split('/')));
    return { path: relative, size: content.length, sha256: sha256(content) };
  });
  const totalBytes = rows.reduce((sum, row) => sum + row.size, 0);
  const digest = sha256(Buffer.from(rows.map((row) => (
    `${row.path}\0${row.size}\0${row.sha256}`
  )).join('\n')));
  const manifest = {
    schema: 1,
    package: '@whaledock/context-bridge-poc',
    files: rows,
    totalBytes,
    digest
  };
  const bytes = refork.canonicalJson(manifest);
  return {
    manifest,
    bytes,
    lock: {
      path: 'lib/context-poc-baseline.json',
      schema: 1,
      package: '@whaledock/context-bridge-poc',
      fileOrder: order
    }
  };
}

function repositoryFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-refork-dsh-ui-'));
  const layout = packageFixture('ui-layout', { additions: options.layoutAdditions || 1 });
  const conversation = packageFixture('ui-conversation');
  const packages = [layout, conversation];
  write(path.join(root, 'context-poc', 'context-bridge.patch.yml'), 'fixture: true\n');
  write(path.join(root, 'context-poc', 'FORK-NOTICE.md'), 'fixture fork notice\n');
  write(path.join(root, 'context-poc', 'plugin', 'package.json'), '{"name":"fixture-plugin"}\n');
  write(path.join(root, 'context-poc', 'plugin', 'lib', 'index.js'), 'module.exports = {};\n');
  write(path.join(root, 'context-poc', 'plugin', 'lib', 'client.js'), 'window.fixture = true;\n');
  for (const pkg of packages) writeFork(root, pkg, pkg.final);
  const expectedBaseline = baselineForRoot(root);
  const lock = {
    schemaVersion: 1,
    redistributionFiles: FILES,
    versions: {
      [VERSION]: {
        ready: true,
        contextPocBaseline: expectedBaseline.lock,
        packages: packages.map((pkg) => pkg.plan)
      }
    }
  };
  const lockPath = path.join(root, 'refork', 'dsh-ui', 'upstream-lock.json');
  for (const pkg of packages) {
    write(path.join(root, pkg.plan.patch.path), pkg.patchText);
  }
  writeJson(lockPath, lock);
  if (options.current !== 'final') {
    for (const pkg of packages) writeFork(root, pkg, pkg.upstream);
    write(path.join(root, 'lib', 'context-poc-baseline.json'), baselineForRoot(root).bytes);
  } else {
    write(path.join(root, 'lib', 'context-poc-baseline.json'), expectedBaseline.bytes);
  }
  const tarballs = new Map(packages.map((pkg) => [pkg.plan.url, pkg.tar.tarball]));
  const download = async (url) => Buffer.from(tarballs.get(url));
  function saveLock() { writeJson(lockPath, lock); }
  function cleanup() { if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: false }); }
  return { root, layout, conversation, packages, lock, lockPath, expectedBaseline, tarballs, download, saveLock, cleanup };
}

function fileSnapshot(root) {
  const rows = [];
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(filePath);
      if (stat.isDirectory()) walk(filePath, relative);
      else if (stat.isFile()) rows.push({
        path: relative,
        size: stat.size,
        sha256: sha256(fs.readFileSync(filePath)),
        mtimeMs: stat.mtimeMs
      });
      else rows.push({ path: relative, type: stat.isSymbolicLink() ? 'link' : 'special' });
    }
  };
  walk(root);
  return rows;
}

function contentSnapshot(root) {
  return fileSnapshot(root).map(({ mtimeMs, ...row }) => row);
}

function assertNoStage(root) {
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith('.refork-dsh-ui-stage-')), []);
}

async function expectReject(fn, pattern) {
  await assert.rejects(fn, pattern);
}

(async () => {
  await test('byte-bound refork/context 路径由 .gitattributes 禁止换行改写', () => {
    const attributes = fs.readFileSync(path.join(REPOSITORY_ROOT, '.gitattributes'), 'utf8')
      .split(/\r?\n/).map((line) => line.trim());
    for (const expected of [
      'refork/dsh-ui/** -text -whitespace',
      'context-poc/** -text -whitespace',
      'lib/context-poc-baseline.json -text -whitespace'
    ]) {
      assert.equal(attributes.filter((line) => line === expected).length, 1, expected);
    }
  });

  await test('--check 默认机械绑定 config DSH_CONTRACT，显式版本仍可用', () => {
    const { DSH_CONTRACT } = require('../lib/config');
    assert.deepEqual(refork.parseArgs(['--check']), {
      version: DSH_CONTRACT.packageVersion,
      check: true
    });
    assert.deepEqual(refork.parseArgs(['--check'], {
      dshContract: { packageVersion: 'fixture-version' }
    }), { version: 'fixture-version', check: true });
    assert.deepEqual(refork.parseArgs([`--version=${VERSION}`]), {
      version: VERSION,
      check: false
    });
    assert.throws(() => refork.parseArgs([]), /REFORK_DSH_UI_ARGS/);
    assert.throws(() => refork.parseArgs(['--version=', '--check']), /REFORK_DSH_UI_ARGS/);
  });

  await test('下载绝对期限覆盖连接停滞与持续慢滴流，并安全取消', async () => {
    const stalledRequest = new EventEmitter();
    stalledRequest.destroyed = false;
    stalledRequest.destroy = () => { stalledRequest.destroyed = true; };
    await expectReject(() => refork.downloadTarball('https://fixture.invalid/stalled.tgz', {
      maxBytes: 100,
      deadlineMs: 20,
      httpsImpl: { get: () => stalledRequest }
    }), /REFORK_DSH_UI_DOWNLOAD_TIMEOUT/);
    assert.equal(stalledRequest.destroyed, true);

    const dripRequest = new EventEmitter();
    dripRequest.destroyed = false;
    dripRequest.destroy = () => { dripRequest.destroyed = true; };
    const dripResponse = new EventEmitter();
    dripResponse.statusCode = 200;
    dripResponse.headers = {};
    dripResponse.destroyed = false;
    let interval = null;
    dripResponse.destroy = () => {
      dripResponse.destroyed = true;
      if (interval) clearInterval(interval);
    };
    const httpsImpl = {
      get(_url, _options, callback) {
        setImmediate(() => {
          callback(dripResponse);
          interval = setInterval(() => dripResponse.emit('data', Buffer.from('x')), 4);
        });
        return dripRequest;
      }
    };
    await expectReject(() => refork.downloadTarball('https://fixture.invalid/drip.tgz', {
      maxBytes: 100,
      deadlineMs: 25,
      httpsImpl
    }), /REFORK_DSH_UI_DOWNLOAD_TIMEOUT/);
    assert.equal(dripRequest.destroyed, true);
    assert.equal(dripResponse.destroyed, true);
  });

  await test('成功重建两个精确五文件 fork，并同步 baseline', async () => {
    const value = repositoryFixture({ current: 'upstream' });
    try {
      const result = await refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: value.download
      });
      assert.equal(result.check, false);
      assert.deepEqual(result.builds.map((build) => build.diff.total), [1, 1]);
      for (const pkg of value.packages) {
        for (const relative of FILES) {
          assert.deepEqual(
            fs.readFileSync(path.join(value.root, ...pkg.spec.forkPath.split('/'), ...relative.split('/'))),
            pkg.final.get(relative)
          );
        }
      }
      assert.deepEqual(
        fs.readFileSync(path.join(value.root, 'lib', 'context-poc-baseline.json')),
        value.expectedBaseline.bytes
      );
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('--check 下载重建但不写文件、不改 hash/mtime', async () => {
    const value = repositoryFixture({ current: 'final' });
    let calls = 0;
    const before = fileSnapshot(value.root);
    try {
      const result = await refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        check: true,
        download: async (url) => {
          calls += 1;
          return Buffer.from(value.tarballs.get(url));
        }
      });
      assert.equal(result.check, true);
      assert.equal(calls, 2);
      assert.deepEqual(fileSnapshot(value.root), before);
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('未知版本在 patch 读取和网络前 fail-closed', async () => {
    const value = repositoryFixture({ current: 'final' });
    let calls = 0;
    try {
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: '9.9.9',
        download: async () => { calls += 1; return Buffer.alloc(1); }
      }), /REFORK_DSH_UI_UNKNOWN_VERSION/);
      assert.equal(calls, 0);
    } finally { value.cleanup(); }
  });

  await test('tarball、上游文件、patch 与最终 hash 任一漂移均拒绝', async () => {
    const value = repositoryFixture({ current: 'upstream' });
    const before = contentSnapshot(value.root);
    try {
      const badTar = Buffer.from(value.layout.tar.tarball);
      badTar[badTar.length - 8] ^= 0x01;
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: async (url) => url === value.layout.plan.url ? badTar : value.tarballs.get(url)
      }), /REFORK_DSH_UI_TARBALL_IDENTITY/);
      assert.deepEqual(contentSnapshot(value.root), before);

      const unexpectedTree = makeTar([
        ...FILES.map((relative) => ({
          path: `package/${relative}`,
          content: value.layout.upstream.get(relative)
        })),
        { path: 'package/README.md', content: 'not redistributed\n' },
        { path: 'package/unexpected.js', content: 'unexpected\n' }
      ]);
      const unexpectedPlan = {
        ...value.layout.plan,
        tarballBytes: unexpectedTree.tarball.length,
        tarballSha256: sha256(unexpectedTree.tarball),
        integrity: refork.sha512Integrity(unexpectedTree.tarball),
        archiveBytes: unexpectedTree.archive.length,
        archiveEntries: FILES.length + 2
      };
      assert.throws(
        () => refork.verifyTarball(unexpectedPlan, unexpectedTree.tarball),
        /REFORK_DSH_UI_TAR_TREE/
      );

      const changedUpstream = new Map(value.layout.upstream);
      changedUpstream.set('lib/client.js', Buffer.from('upstream tamper\n'));
      const changedTar = makeTar([
        ...FILES.map((relative) => ({
          path: `package/${relative}`,
          content: changedUpstream.get(relative)
        })),
        { path: 'package/README.md', content: 'not redistributed\n' }
      ]);
      const parsedChanged = refork.parseNpmTarball(changedTar.tarball);
      const changedPlan = {
        ...value.layout.plan,
        tarballBytes: changedTar.tarball.length,
        tarballSha256: sha256(changedTar.tarball),
        integrity: refork.sha512Integrity(changedTar.tarball),
        archiveBytes: changedTar.archive.length,
        archiveEntries: FILES.length + 1,
        archiveTreeSha256: parsedChanged.treeSha256
      };
      assert.throws(
        () => refork.verifyTarball(changedPlan, changedTar.tarball),
        /REFORK_DSH_UI_UPSTREAM_FILE/
      );

      const badFinalPlan = {
        ...value.layout.plan,
        patch: { ...value.layout.plan.patch, text: value.layout.patchText },
        finalFiles: {
          ...value.layout.plan.finalFiles,
          'lib/client.js': {
            ...value.layout.plan.finalFiles['lib/client.js'],
            sha256: '0'.repeat(64)
          }
        }
      };
      assert.throws(
        () => refork.buildPackage(badFinalPlan, value.layout.tar.tarball),
        /REFORK_DSH_UI_FINAL_HASH/
      );

      fs.appendFileSync(path.join(value.root, value.layout.plan.patch.path), '# drift\n');
      let calls = 0;
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: async () => { calls += 1; return Buffer.alloc(1); }
      }), /REFORK_DSH_UI_PATCH_IDENTITY/);
      assert.equal(calls, 0);
    } finally { value.cleanup(); }
  });

  await test('安全 tar parser 拒绝穿越、绝对路径、链接、重复、异常树和超限', () => {
    const cases = [
      [makeTar([{ path: 'package/../escape', content: 'x' }]).tarball, /REFORK_DSH_UI_TAR_TREE/],
      [makeTar([{ path: '/absolute', content: 'x' }]).tarball, /REFORK_DSH_UI_TAR_PATH/],
      [makeTar([{ path: 'package/link', type: '2', linkname: '../../outside' }]).tarball, /REFORK_DSH_UI_TAR_LINK/],
      [makeTar([
        { path: 'package/duplicate', content: 'a' },
        { path: 'package/duplicate', content: 'b' }
      ]).tarball, /REFORK_DSH_UI_TAR_DUPLICATE/],
      [makeTar([{ path: 'other/file', content: 'x' }]).tarball, /REFORK_DSH_UI_TAR_TREE/]
    ];
    for (const [tarball, pattern] of cases) {
      assert.throws(() => refork.parseNpmTarball(tarball), pattern);
    }
    const oversized = makeTar([{ path: 'package/large', content: '12345' }]).tarball;
    assert.throws(() => refork.parseNpmTarball(oversized, { maxFileBytes: 4 }), /REFORK_DSH_UI_TAR_FILE_SIZE/);
    const broken = makeTar([{ path: 'package/file', content: 'x' }]);
    broken.archive[0] ^= 1;
    assert.throws(
      () => refork.parseNpmTarball(zlib.gzipSync(broken.archive)),
      /REFORK_DSH_UI_TAR_CHECKSUM/
    );
  });

  await test('zero-fuzz patch 不按相似上下文偏移套用，并保留 EOF newline 语义', async () => {
    const value = repositoryFixture({ current: 'upstream' });
    const before = contentSnapshot(value.root);
    try {
      const marker = 'diff --git a/lib/client.js b/lib/client.js';
      const start = value.layout.patchText.indexOf(marker);
      assert.ok(start > 0);
      const prefix = value.layout.patchText.slice(0, start);
      const clientPatch = value.layout.patchText.slice(start)
        .replace('@@ -1,3 +1,4 @@', '@@ -2,3 +1,4 @@');
      value.layout.patchText = prefix + clientPatch;
      value.lock.versions[VERSION].packages[0].patch.sha256 = sha256(Buffer.from(value.layout.patchText));
      write(path.join(value.root, value.layout.plan.patch.path), value.layout.patchText);
      value.saveLock();
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: value.download
      }), /REFORK_DSH_UI_PATCH_ZERO_FUZZ/);
      assert.deepEqual(contentSnapshot(value.root), before.map((row) => {
        if (row.path === value.layout.plan.patch.path) {
          return { ...row, size: Buffer.byteLength(value.layout.patchText), sha256: sha256(Buffer.from(value.layout.patchText)) };
        }
        if (row.path === path.relative(value.root, value.lockPath).split(path.sep).join('/')) {
          const content = fs.readFileSync(value.lockPath);
          return { ...row, size: content.length, sha256: sha256(content) };
        }
        return row;
      }));

      const eofPatch = [
        'diff --git a/lib/client.js b/lib/client.js',
        '--- a/lib/client.js',
        '+++ b/lib/client.js',
        '@@ -2 +2 @@',
        '-two',
        '\\ No newline at end of file',
        '+TWO',
        ''
      ].join('\n');
      const section = refork.parseUnifiedPatch(eofPatch)[0];
      assert.equal(refork.applyPatchSection(Buffer.from('one\ntwo'), section).toString(), 'one\nTWO\n');
      assert.deepEqual(
        refork.changedLineCounts(Buffer.from('same'), Buffer.from('same\nadded\n'), 'EOF fixture'),
        { insertions: 2, deletions: 1, total: 3, exceeds: false }
      );
    } finally { value.cleanup(); }
  });

  await test('client 总增删行预算超限时不写工作树', async () => {
    const value = repositoryFixture({ current: 'upstream', layoutAdditions: 301 });
    const before = contentSnapshot(value.root);
    try {
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: value.download
      }), /REFORK_DSH_UI_BUDGET .*total>300 budget=300/);
      assert.deepEqual(contentSnapshot(value.root), before);
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('提交阶段故障回滚 forks 与 baseline，不留 staging', async () => {
    const value = repositoryFixture({ current: 'upstream' });
    const before = contentSnapshot(value.root);
    try {
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: value.download,
        transactionHook(step) {
          if (step === 'after-forks-install') throw new Error('fixture commit fault');
        }
      }), /fixture commit fault/);
      assert.deepEqual(contentSnapshot(value.root), before);
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('before-commit fork 并发改动 fail-closed 且原样恢复', async () => {
    const value = repositoryFixture({ current: 'upstream' });
    const target = path.join(
      value.root, ...value.layout.spec.forkPath.split('/'), 'lib', 'client.js'
    );
    const baselinePath = path.join(value.root, 'lib', 'context-poc-baseline.json');
    const beforeTarget = fs.readFileSync(target);
    const beforeBaseline = fs.readFileSync(baselinePath);
    try {
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: value.download,
        transactionHook(step) {
          if (step === 'before-commit') fs.appendFileSync(target, 'concurrent fork edit\n');
        }
      }), /REFORK_DSH_UI_RACE/);
      assert.deepEqual(
        fs.readFileSync(target),
        Buffer.concat([beforeTarget, Buffer.from('concurrent fork edit\n')])
      );
      assert.deepEqual(fs.readFileSync(baselinePath), beforeBaseline);
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('before-commit plugin/FORK-NOTICE 并发改动均保留且不提交旧 baseline', async () => {
    for (const relative of ['plugin/lib/client.js', 'FORK-NOTICE.md']) {
      const value = repositoryFixture({ current: 'upstream' });
      const target = path.join(value.root, 'context-poc', ...relative.split('/'));
      const baselinePath = path.join(value.root, 'lib', 'context-poc-baseline.json');
      const beforeTarget = fs.readFileSync(target);
      const beforeBaseline = fs.readFileSync(baselinePath);
      const beforeFork = fs.readFileSync(path.join(
        value.root, ...value.layout.spec.forkPath.split('/'), 'lib', 'client.js'
      ));
      try {
        await expectReject(() => refork.runRefork({
          root: value.root,
          lockPath: value.lockPath,
          version: VERSION,
          download: value.download,
          transactionHook(step) {
            if (step === 'before-commit') fs.appendFileSync(target, `concurrent ${relative}\n`);
          }
        }), /REFORK_DSH_UI_RACE/);
        assert.deepEqual(
          fs.readFileSync(target),
          Buffer.concat([beforeTarget, Buffer.from(`concurrent ${relative}\n`)])
        );
        assert.deepEqual(fs.readFileSync(baselinePath), beforeBaseline);
        assert.deepEqual(fs.readFileSync(path.join(
          value.root, ...value.layout.spec.forkPath.split('/'), 'lib', 'client.js'
        )), beforeFork);
        assertNoStage(value.root);
      } finally { value.cleanup(); }
    }
  });

  await test('plugin 合法改动可由 update 原子重算 baseline，lock/patch 不变且随后 check 通过', async () => {
    const value = repositoryFixture({ current: 'final' });
    const pluginPath = path.join(value.root, 'context-poc', 'plugin', 'lib', 'client.js');
    const baselinePath = path.join(value.root, 'lib', 'context-poc-baseline.json');
    const immutablePaths = [
      value.lockPath,
      ...value.packages.map((pkg) => path.join(value.root, pkg.plan.patch.path))
    ];
    const immutableBytes = immutablePaths.map((filePath) => fs.readFileSync(filePath));
    try {
      fs.appendFileSync(pluginPath, 'window.fixtureBatch3 = true;\n');
      const expected = baselineForRoot(value.root);
      await refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        download: value.download
      });
      assert.deepEqual(fs.readFileSync(baselinePath), expected.bytes);
      immutablePaths.forEach((filePath, index) => {
        assert.deepEqual(fs.readFileSync(filePath), immutableBytes[index]);
      });
      const checked = await refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        check: true,
        download: value.download
      });
      assert.equal(checked.check, true);
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('plugin 改动直接 check 失败且全树 byte/mtime 绝对只读', async () => {
    const value = repositoryFixture({ current: 'final' });
    try {
      fs.appendFileSync(
        path.join(value.root, 'context-poc', 'plugin', 'lib', 'client.js'),
        'window.fixtureBatch3 = true;\n'
      );
      const before = fileSnapshot(value.root);
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        check: true,
        download: value.download
      }), /REFORK_DSH_UI_CURRENT_BASELINE/);
      assert.deepEqual(fileSnapshot(value.root), before);
      assertNoStage(value.root);
    } finally { value.cleanup(); }
  });

  await test('--check 对当前 fork 与 baseline 篡改均 fail-closed', async () => {
    const value = repositoryFixture({ current: 'final' });
    try {
      fs.appendFileSync(
        path.join(value.root, ...value.layout.spec.forkPath.split('/'), 'lib', 'client.js'),
        'tamper\n'
      );
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        check: true,
        download: value.download
      }), /REFORK_DSH_UI_FINAL_HASH/);
      writeFork(value.root, value.layout, value.layout.final);
      fs.appendFileSync(path.join(value.root, 'lib', 'context-poc-baseline.json'), ' ');
      await expectReject(() => refork.runRefork({
        root: value.root,
        lockPath: value.lockPath,
        version: VERSION,
        check: true,
        download: value.download
      }), /REFORK_DSH_UI_CURRENT_BASELINE/);
    } finally { value.cleanup(); }
  });

  console.log(`REFORK DSH UI ALL PASS (${passed})`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
