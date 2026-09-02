'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const artifacts = require('../lib/project-artifacts');
const layout = require('../lib/project-layout');

const ROOT = path.join(__dirname, '..');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-project-artifacts-'));
let serial = 0;
let passed = 0;

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  project-artifacts: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-artifacts: ${name}`);
    throw error;
  }
}

function projectRoot() {
  serial += 1;
  const root = path.join(TEMP, `project-${serial}`);
  fs.mkdirSync(root);
  return root;
}

function writeManifest(root, value) {
  fs.writeFileSync(
    path.join(root, artifacts.MANIFEST_FILENAME),
    typeof value === 'string' ? value : JSON.stringify(value)
  );
}

function writeArtifact(root, relative, body) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}

function symlinkStat(stat) {
  return {
    ...stat,
    isSymbolicLink: () => true,
    isDirectory: () => stat.isDirectory(),
    isFile: () => stat.isFile()
  };
}

function lstatOverride(targetPath) {
  const expected = path.resolve(targetPath);
  return {
    ...fs,
    lstatSync(value) {
      const stat = fs.lstatSync(value);
      return path.resolve(value) === expected ? symlinkStat(stat) : stat;
    }
  };
}

async function mainTest() {
  await test('模块不依赖 Electron，manifest 与 kind 上限公开且冻结', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'project-artifacts.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(source, /iframe/i);
    assert.equal(artifacts.LIMITS.maxManifestBytes, 16 * 1024);
    assert.deepEqual(artifacts.KINDS, ['markdown', 'text', 'image', 'html']);
    assert.equal(Object.isFrozen(artifacts.LIMITS.artifactBytes), true);
  });

  await test('合法 Markdown 返回分离 internal 路径与可持久化 descriptor', () => {
    const root = projectRoot();
    const body = Buffer.from('# 完成\n\n这是项目产物。\n');
    const target = writeArtifact(root, 'output/result.md', body);
    writeManifest(root, { window: 3, path: 'output/result.md', kind: 'markdown' });
    const result = artifacts.readProjectArtifact(root);
    assert.deepEqual(Object.keys(result), ['internal', 'descriptor']);
    assert.equal(result.internal.absolutePath, fs.realpathSync.native(target));
    assert.deepEqual(result.descriptor, {
      window: 3,
      path: 'output/result.md',
      kind: 'markdown',
      fingerprint: {
        size: body.length,
        mtime: fs.lstatSync(target).mtimeMs,
        sha256: crypto.createHash('sha256').update(body).digest('hex')
      }
    });
    assert.equal(JSON.stringify(result.descriptor).includes(result.internal.absolutePath), false);
    assert.equal(Object.isFrozen(result.internal), true);
    assert.equal(Object.isFrozen(result.descriptor.fingerprint), true);
    assert.deepEqual(layout.validateArtifactDescriptor(result.descriptor), result.descriptor);
  });

  await test('html 只标记 Electron 子窗打开，不生成页内托管模式', () => {
    const root = projectRoot();
    writeArtifact(root, 'site/index.html', '<!doctype html><title>完成</title>');
    writeManifest(root, { window: 2, path: 'site/index.html', kind: 'html' });
    const result = artifacts.readProjectArtifact(root);
    assert.equal(result.descriptor.openMode, 'electron-child');
    assert.equal(Object.keys(result.descriptor).includes('url'), false);
    assert.equal(JSON.stringify(result.descriptor).includes('iframe'), false);
  });

  await test('manifest 必须是 ≤16 KiB 的非 symlink 普通文件且字段精确', () => {
    const extra = projectRoot();
    writeArtifact(extra, 'result.txt', 'ok');
    writeManifest(extra, {
      window: 1, path: 'result.txt', kind: 'text', absolutePath: '/tmp/leak'
    });
    assert.throws(() => artifacts.readProjectArtifact(extra),
      assertCode(artifacts.ERROR_CODES.manifest));

    const oversized = projectRoot();
    fs.writeFileSync(
      path.join(oversized, artifacts.MANIFEST_FILENAME),
      'x'.repeat(artifacts.LIMITS.maxManifestBytes + 1)
    );
    assert.throws(() => artifacts.readProjectArtifact(oversized),
      assertCode(artifacts.ERROR_CODES.size));

    const directory = projectRoot();
    fs.mkdirSync(path.join(directory, artifacts.MANIFEST_FILENAME));
    assert.throws(() => artifacts.readProjectArtifact(directory),
      assertCode(artifacts.ERROR_CODES.manifest));

    const linked = projectRoot();
    writeArtifact(linked, 'result.txt', 'ok');
    writeManifest(linked, { window: 1, path: 'result.txt', kind: 'text' });
    const canonicalManifest = path.join(fs.realpathSync.native(linked), artifacts.MANIFEST_FILENAME);
    assert.throws(() => artifacts.readProjectArtifact(linked, {
      fsImpl: lstatOverride(canonicalManifest)
    }), assertCode(artifacts.ERROR_CODES.symlink));
  });

  await test('相对 path 拒绝绝对、..、反斜线、控制字符与空段', () => {
    for (const candidate of [
      '/tmp/result.md', 'C:/temp/result.md', '../result.md', 'a/../result.md',
      'a\\result.md', 'a/\nresult.md', './result.md', 'a//result.md'
    ]) {
      assert.throws(() => artifacts.validateRelativePath(candidate),
        assertCode(artifacts.ERROR_CODES.path), candidate);
      const root = projectRoot();
      writeManifest(root, { window: 1, path: candidate, kind: 'markdown' });
      assert.throws(() => artifacts.readProjectArtifact(root),
        assertCode(artifacts.ERROR_CODES.path), candidate);
    }
  });

  await test('项目根、中间目录与最终文件 symlink 均由高层读取 fail-closed', () => {
    const rootLinked = projectRoot();
    assert.throws(() => artifacts.readProjectArtifact(rootLinked, {
      fsImpl: lstatOverride(rootLinked)
    }), assertCode(artifacts.ERROR_CODES.symlink));

    const middleLinked = projectRoot();
    const middleFile = writeArtifact(middleLinked, 'linked/result.md', 'middle');
    writeManifest(middleLinked, { window: 1, path: 'linked/result.md', kind: 'markdown' });
    const canonicalMiddle = path.dirname(fs.realpathSync.native(middleFile));
    assert.throws(() => artifacts.readProjectArtifact(middleLinked, {
      fsImpl: lstatOverride(canonicalMiddle)
    }), assertCode(artifacts.ERROR_CODES.symlink));

    const fileLinked = projectRoot();
    const linkedFile = writeArtifact(fileLinked, 'output/result.md', 'file');
    writeManifest(fileLinked, { window: 1, path: 'output/result.md', kind: 'markdown' });
    assert.throws(() => artifacts.readProjectArtifact(fileLinked, {
      fsImpl: lstatOverride(fs.realpathSync.native(linkedFile))
    }), assertCode(artifacts.ERROR_CODES.symlink));
  });

  await test('即使 lstat 显示普通项，中间或最终 realpath 越根仍拒绝', () => {
    const root = projectRoot();
    const target = writeArtifact(root, 'output/result.md', 'inside');
    writeManifest(root, { window: 1, path: 'output/result.md', kind: 'markdown' });
    const outside = path.join(TEMP, 'outside.md');
    const outsideDirectory = path.join(TEMP, 'outside-directory');
    fs.writeFileSync(outside, 'outside');
    fs.mkdirSync(outsideDirectory);
    const nativeRealpath = fs.realpathSync.native || fs.realpathSync;
    const canonicalTarget = nativeRealpath(target);
    const finalEscape = (value) => (
      path.resolve(value) === path.resolve(canonicalTarget)
        ? nativeRealpath(outside)
        : nativeRealpath(value)
    );
    assert.throws(() => artifacts.readProjectArtifact(root, {
      fsImpl: { ...fs, realpathSync: finalEscape }
    }), assertCode(artifacts.ERROR_CODES.path));

    const canonicalMiddle = nativeRealpath(path.dirname(target));
    const middleEscape = (value) => (
      path.resolve(value) === path.resolve(canonicalMiddle)
        ? nativeRealpath(outsideDirectory)
        : nativeRealpath(value)
    );
    assert.throws(() => artifacts.readProjectArtifact(root, {
      fsImpl: { ...fs, realpathSync: middleEscape }
    }), assertCode(artifacts.ERROR_CODES.path));
  });

  await test('artifact 必须是普通文件并使用 kind 独立大小上限', () => {
    const directory = projectRoot();
    fs.mkdirSync(path.join(directory, 'output'));
    writeManifest(directory, { window: 1, path: 'output', kind: 'text' });
    assert.throws(() => artifacts.readProjectArtifact(directory),
      assertCode(artifacts.ERROR_CODES.file));

    const sized = projectRoot();
    const target = writeArtifact(sized, 'output/blob.bin', '');
    fs.truncateSync(target, artifacts.LIMITS.artifactBytes.markdown + 1);
    writeManifest(sized, { window: 1, path: 'output/blob.bin', kind: 'markdown' });
    assert.throws(() => artifacts.readProjectArtifact(sized),
      assertCode(artifacts.ERROR_CODES.size));
    writeManifest(sized, { window: 1, path: 'output/blob.bin', kind: 'image' });
    assert.equal(artifacts.readProjectArtifact(sized).descriptor.fingerprint.size,
      artifacts.LIMITS.artifactBytes.markdown + 1,
      '同一大小对 image 合法，证明不是全 kind 共用一个上限');
  });

  await test('指纹读取按 64 KiB 分块且总读取有界', () => {
    const root = projectRoot();
    const body = Buffer.alloc(200 * 1024, 0x5a);
    writeArtifact(root, 'output/image.bin', body);
    const manifest = { window: 4, path: 'output/image.bin', kind: 'image' };
    writeManifest(root, manifest);
    const lengths = [];
    const fsImpl = {
      ...fs,
      readSync(descriptor, buffer, offset, length, position) {
        lengths.push(length);
        return fs.readSync(descriptor, buffer, offset, length, position);
      }
    };
    const result = artifacts.readProjectArtifact(root, { fsImpl });
    const manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
    assert.equal(Math.max(...lengths) <= artifacts.LIMITS.hashChunkBytes, true);
    assert.equal(lengths.reduce((sum, value) => sum + value, 0)
      <= manifestBytes + 1 + body.length + 1, true);
    assert.equal(result.descriptor.fingerprint.sha256,
      crypto.createHash('sha256').update(body).digest('hex'));
  });

  await test('普通窗格预览只返回有界 bytes/fingerprint，拒敏感路径与类型伪装', () => {
    const root = projectRoot();
    const body = Buffer.from('# 安全预览\n<script>只作为文本</script>\n');
    writeArtifact(root, 'drafts/current.md', body);
    const result = artifacts.readProjectFile(root, 'drafts/current.md', 'markdown');
    assert.deepEqual(Object.keys(result), ['buffer', 'fingerprint']);
    assert.deepEqual(result.buffer, body);
    assert.equal(result.fingerprint.sha256,
      crypto.createHash('sha256').update(body).digest('hex'));
    assert.equal(JSON.stringify(result).includes(fs.realpathSync.native(root)), false);

    for (const [relative, kind] of [
      ['../current.md', 'markdown'],
      ['.private/current.md', 'markdown'],
      ['credentials/current.md', 'markdown'],
      ['vendor/current.txt', 'text'],
      ['drafts/current.html', 'markdown'],
      ['drafts/current.md', 'image'],
      ['drafts/current.md', 'html']
    ]) {
      assert.throws(() => artifacts.readProjectFile(root, relative, kind),
        (error) => Boolean(error && [
          artifacts.ERROR_CODES.path, artifacts.ERROR_CODES.file
        ].includes(error.code)), `${kind}:${relative}`);
    }
  });

  await test('普通窗格预览对根/中间/文件 symlink、超限与读取竞态 fail-closed', () => {
    const rootLinked = projectRoot();
    writeArtifact(rootLinked, 'drafts/current.txt', 'root');
    assert.throws(() => artifacts.readProjectFile(rootLinked, 'drafts/current.txt', 'text', {
      fsImpl: lstatOverride(rootLinked)
    }), assertCode(artifacts.ERROR_CODES.symlink));

    const middleLinked = projectRoot();
    const middleTarget = writeArtifact(middleLinked, 'drafts/current.txt', 'middle');
    assert.throws(() => artifacts.readProjectFile(middleLinked, 'drafts/current.txt', 'text', {
      fsImpl: lstatOverride(path.dirname(fs.realpathSync.native(middleTarget)))
    }), assertCode(artifacts.ERROR_CODES.symlink));

    const fileLinked = projectRoot();
    const fileTarget = writeArtifact(fileLinked, 'drafts/current.txt', 'file');
    assert.throws(() => artifacts.readProjectFile(fileLinked, 'drafts/current.txt', 'text', {
      fsImpl: lstatOverride(fs.realpathSync.native(fileTarget))
    }), assertCode(artifacts.ERROR_CODES.symlink));

    const oversized = projectRoot();
    const oversizedTarget = writeArtifact(oversized, 'drafts/current.txt', '');
    fs.truncateSync(oversizedTarget, artifacts.LIMITS.previewBytes.text + 1);
    assert.throws(() => artifacts.readProjectFile(oversized, 'drafts/current.txt', 'text'),
      assertCode(artifacts.ERROR_CODES.size));

    const raced = projectRoot();
    writeArtifact(raced, 'drafts/current.txt', 'race');
    let fstatCalls = 0;
    const fsImpl = {
      ...fs,
      fstatSync(descriptor) {
        const stat = fs.fstatSync(descriptor);
        fstatCalls += 1;
        if (fstatCalls < 2) return stat;
        return new Proxy(stat, {
          get(target, key) {
            if (key === 'mtimeMs') return target.mtimeMs + 1;
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
    };
    assert.throws(() => artifacts.readProjectFile(raced, 'drafts/current.txt', 'text', {
      fsImpl
    }), assertCode(artifacts.ERROR_CODES.changed));
  });

  await test('窗口、kind 与 JSON 错误返回稳定 manifest 错误码', () => {
    for (const value of [
      '{not-json',
      { window: 0, path: 'result.md', kind: 'markdown' },
      { window: 17, path: 'result.md', kind: 'markdown' },
      { window: 1, path: 'result.md', kind: 'pdf' }
    ]) {
      const root = projectRoot();
      writeManifest(root, value);
      assert.throws(() => artifacts.readProjectArtifact(root),
        assertCode(artifacts.ERROR_CODES.manifest));
    }
  });

  console.log(`\nPROJECT ARTIFACTS ALL PASS (${passed})`);
}

mainTest().then(() => {
  fs.rmSync(TEMP, { recursive: true, force: true });
}).catch((error) => {
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_cleanupError) { /* ignore */ }
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
