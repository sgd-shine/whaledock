'use strict';

// 候选 runtime 证据脚本纯 Node fixture；只执行临时假 dsh bin，不执行真实 dsh。
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'dsh-candidate-evidence.js');
let passed = 0;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

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

function macho(machine) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(machine, 4);
  return buffer;
}

function pe(machine) {
  const buffer = Buffer.alloc(128);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(64, 0x3c);
  buffer.write('PE\0\0', 64, 'binary');
  buffer.writeUInt16LE(machine, 68);
  return buffer;
}

function targetNativeFixturePaths() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') return [
    `node_modules/@img/sharp-darwin-${arch}/lib/sharp-darwin-${arch}-fixture.node`,
    `node_modules/@koromix/koffi-darwin-${arch}/darwin_${arch}/koffi.node`,
    `node_modules/@vscode/ripgrep-darwin-${arch}/bin/rg`,
    `node_modules/node-addon-require-builtin-darwin-${arch}/prebuilt/darwin-${arch}-napi-v9.node`,
    `node_modules/@img/sharp-libvips-darwin-${arch}/lib/libvips-cpp.8.fixture.dylib`,
    `node_modules/node-pty/prebuilds/darwin-${arch}/pty.node`,
    `node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`
  ];
  if (platform === 'win32') return [
    `node_modules/@img/sharp-win32-${arch}/lib/sharp-win32-${arch}-fixture.node`,
    `node_modules/@koromix/koffi-win32-${arch}/win32_${arch}/koffi.node`,
    `node_modules/@vscode/ripgrep-win32-${arch}/bin/rg.exe`,
    `node_modules/node-addon-require-builtin-win32-${arch}-msvc/prebuilt/win32-${arch}-msvc-napi-v9.node`,
    `node_modules/node-pty/prebuilds/win32-${arch}/conpty.node`,
    `node_modules/node-pty/prebuilds/win32-${arch}/conpty_console_list.node`,
    `node_modules/node-pty/prebuilds/win32-${arch}/conpty/OpenConsole.exe`,
    `node_modules/node-pty/prebuilds/win32-${arch}/conpty/conpty.dll`
  ];
  return [];
}

function nativeFixtureContent(arch = process.arch) {
  if (process.platform === 'darwin') return macho(arch === 'x64' ? 0x01000007 : 0x0100000c);
  if (process.platform === 'win32') return pe(arch === 'x64' ? 0x8664 : 0xaa64);
  return Buffer.from('no native proof on this platform');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(root, name, overrides = {}) {
  const runtime = path.join(root, name);
  const version = '1.2.3-fixture.1';
  const packageJson = {
    name: 'whaledock-dsh-runtime', private: true, version: '0.0.0',
    dependencies: { '@deepseek-ai/dsh': version }
  };
  const lock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    packages: {
      '': { name: packageJson.name, version: packageJson.version,
        dependencies: { '@deepseek-ai/dsh': version } },
      'node_modules/@deepseek-ai/dsh': {
        version, integrity: 'sha512-fixture-integrity', license: 'MIT',
        bin: { dsh: 'lib/bin.js' }
      }
    }
  };
  const installed = {
    name: '@deepseek-ai/dsh', version, license: 'MIT', bin: { dsh: 'lib/bin.js' }
  };
  fs.mkdirSync(runtime, { recursive: true });
  writeJson(path.join(runtime, 'package.json'), packageJson);
  writeJson(path.join(runtime, 'package-lock.json'), lock);
  writeJson(path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), installed);
  const bin = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, [
    "'use strict';",
    "if (!process.argv.includes('--dump-config')) process.exit(9);",
    "process.stdout.write('fixture: true\\nprofile: web\\n');",
    ''
  ].join('\n'));
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(runtime, 'native-x64.node'), macho(0x01000007));
  fs.writeFileSync(path.join(runtime, 'helper-arm64.exe'), pe(0xaa64));
  fs.writeFileSync(path.join(runtime, 'ordinary.txt'), 'ordinary fixture\n');
  for (const relative of targetNativeFixturePaths()) {
    const target = path.join(runtime, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, nativeFixtureContent());
  }
  try { fs.symlinkSync('ordinary.txt', path.join(runtime, 'ordinary-link')); } catch (_error) { /* Windows 可无权建链 */ }

  const lockBytes = fs.readFileSync(path.join(runtime, 'package-lock.json'));
  writeJson(path.join(runtime, 'manifest.json'), {
    schemaVersion: 3,
    dshVersion: version,
    packageIntegrity: 'sha512-fixture-integrity',
    auditedLockSha256: sha256(lockBytes),
    installScriptsIgnored: true,
    installScriptPackages: [],
    platform: process.platform,
    arch: process.arch,
    hostPlatform: process.platform,
    hostArch: process.arch,
    generatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides
  });
  return runtime;
}

function run(runtime, output, splitArgs = false) {
  const args = splitArgs
    ? [SCRIPT, '--runtime', runtime, '--output', output]
    : [SCRIPT, `--runtime=${runtime}`, `--output=${output}`];
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
}

function main() {
  const goodRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-dsh-candidate-test-'));
  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-candidate-bad-'));
  try {
    const runtime = fixture(goodRoot, 'runtime-good');
    const firstOutput = path.join(goodRoot, 'evidence-first.json');
    const first = run(runtime, firstOutput, true);

    check('候选证据 CLI 写入新 JSON，且只执行 fixture dump-config', () => {
      assert.equal(first.status, 0, first.stderr);
      assert.equal(fs.existsSync(firstOutput), true);
      const report = JSON.parse(fs.readFileSync(firstOutput, 'utf8'));
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.runtime.version, '1.2.3-fixture.1');
      assert.deepEqual(report.runtime.installScriptPackages, []);
      assert.deepEqual(report.dumpConfig, {
        exit: 0,
        bytes: Buffer.byteLength('fixture: true\nprofile: web\n'),
        lines: 2,
        sha256: sha256(Buffer.from('fixture: true\nprofile: web\n')),
        stderrBytes: 0,
        stderrSha256: sha256(Buffer.alloc(0))
      });
      assert(report.tree.fileCount >= 7);
      assert(report.tree.logicalBytes > 0);
      assert.equal(report.targetNativeProofs.length, targetNativeFixturePaths().length);
    });

    const firstReport = JSON.parse(fs.readFileSync(firstOutput, 'utf8'));
    check('Mach-O/PE 机器类型仅读识别并记录路径/哈希', () => {
      const machoRow = firstReport.nativeBinaries.find((row) => row.path === 'native-x64.node');
      const peRow = firstReport.nativeBinaries.find((row) => row.path === 'helper-arm64.exe');
      assert(machoRow && machoRow.format === 'mach-o' && machoRow.machines.includes('x86_64'));
      assert(peRow && peRow.format === 'pe' && peRow.machines.includes('arm64'));
      assert.match(machoRow.sha256, /^[0-9a-f]{64}$/);
      assert.match(peRow.sha256, /^[0-9a-f]{64}$/);
    });

    const wrongNativeRuntime = fixture(goodRoot, 'runtime-wrong-target-native');
    const targetPaths = targetNativeFixturePaths();
    if (targetPaths.length) {
      const wrongArch = process.arch === 'arm64' ? 'x64' : 'arm64';
      fs.writeFileSync(
        path.join(wrongNativeRuntime, ...targetPaths[0].split('/')),
        nativeFixtureContent(wrongArch)
      );
    }
    const wrongNativeOutput = path.join(goodRoot, 'wrong-target-native.json');
    const wrongNativeRun = run(wrongNativeRuntime, wrongNativeOutput);
    check('目标关键原生文件机器类型不匹配时 fail-closed', () => {
      if (!targetPaths.length) {
        assert.equal(wrongNativeRun.status, 0, wrongNativeRun.stderr);
        return;
      }
      assert.notEqual(wrongNativeRun.status, 0);
      assert.equal(fs.existsSync(wrongNativeOutput), false);
      assert.match(wrongNativeRun.stderr, /机器类型不匹配/);
    });

    check('cafebabe Java class 头不误报为胖 Mach-O', () => {
      const evidence = require('../scripts/dsh-candidate-evidence');
      const java = Buffer.alloc(2048);
      java.writeUInt32BE(0xcafebabe, 0);
      java.writeUInt32BE(0x34, 4);
      assert.equal(evidence.machoInfo(java), null);
    });

    const secondOutput = path.join(goodRoot, 'evidence-second.json');
    const second = run(runtime, secondOutput);
    check('canonical stream 的 zlib 压缩字节与哈希可重复', () => {
      assert.equal(second.status, 0, second.stderr);
      const next = JSON.parse(fs.readFileSync(secondOutput, 'utf8'));
      for (const field of ['canonicalBytes', 'canonicalSha256', 'compressedBytes', 'compressedSha256']) {
        assert.equal(next.tree[field], firstReport.tree[field], field);
      }
      assert.equal(next.tree.compression, 'node:zlib-gzip-level-9-mtime-0');
    });

    const mismatch = fixture(goodRoot, 'runtime-host-mismatch', {
      hostArch: process.arch === 'arm64' ? 'x64' : 'arm64'
    });
    const mismatchOutput = path.join(goodRoot, 'host-mismatch.json');
    const mismatchRun = run(mismatch, mismatchOutput);
    check('manifest host/target 不等于当前平台时 fail-closed', () => {
      assert.notEqual(mismatchRun.status, 0);
      assert.equal(fs.existsSync(mismatchOutput), false);
      assert.match(mismatchRun.stderr, /hostArch/);
    });

    const installScriptMismatch = fixture(goodRoot, 'runtime-install-script-mismatch', {
      installScriptPackages: ['protobufjs']
    });
    const installScriptMismatchOutput = path.join(goodRoot, 'install-script-mismatch.json');
    const installScriptMismatchRun = run(installScriptMismatch, installScriptMismatchOutput);
    check('manifest install-script 列表与 lock 闭包不同时 fail-closed', () => {
      assert.notEqual(installScriptMismatchRun.status, 0);
      assert.equal(fs.existsSync(installScriptMismatchOutput), false);
      assert.match(installScriptMismatchRun.stderr, /installScriptPackages/);
    });

    const outside = path.join(badRoot, 'outside.json');
    const outsideRun = run(runtime, outside);
    check('output 拒绝离开 whaledock-dsh-candidate-* 临时根', () => {
      assert.notEqual(outsideRun.status, 0);
      assert.equal(fs.existsSync(outside), false);
    });

    const existing = path.join(goodRoot, 'existing.json');
    fs.writeFileSync(existing, 'KEEP');
    const existingRun = run(runtime, existing);
    check('output 已存在时拒绝覆盖', () => {
      assert.notEqual(existingRun.status, 0);
      assert.equal(fs.readFileSync(existing, 'utf8'), 'KEEP');
    });

    console.log(`\nDSH_CANDIDATE_EVIDENCE_SMOKE ALL PASS (${passed})`);
  } finally {
    fs.rmSync(goodRoot, { recursive: true, force: true });
    fs.rmSync(badRoot, { recursive: true, force: true });
  }
}

try { main(); } catch (error) {
  console.error('DSH_CANDIDATE_EVIDENCE_SMOKE FAIL:', error);
  process.exitCode = 1;
}
