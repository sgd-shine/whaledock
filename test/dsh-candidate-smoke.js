'use strict';
// dsh 升级候选入口纯 Node 测试：只造临时 manifest/lock，绝不启动 npm。
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const candidateRuntime = require('../scripts/dsh-runtime-candidate');

const VERSION = '0.1.1-rc.2';
const INTEGRITY = 'sha512-Y2FuZGlkYXRlLXJ1bnRpbWU=';
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function baseLock(installScriptPackages = ['protobufjs']) {
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
    }
  };
  for (const name of installScriptPackages) {
    packages[`node_modules/${name}`] = {
      version: '1.0.0',
      resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-1.0.0.tgz`,
      integrity: 'sha512-aW5zdGFsbC1zY3JpcHQ=',
      hasInstallScript: true,
      license: 'MIT'
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

function fixture(options = {}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-candidate-repo-'));
  const candidateDir = path.join(repositoryRoot, 'compliance', 'candidates', 'dsh-rc2');
  fs.mkdirSync(candidateDir, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-dsh-runtime-smoke-'));
  const outputDir = path.join(workspace, 'runtime');
  const lockPath = path.join(candidateDir, 'dsh-runtime-package-lock.json');
  const manifestPath = path.join(candidateDir, 'candidate-manifest.json');
  const target = { platform: process.platform, arch: process.arch };
  const state = {
    lock: options.lock || baseLock(options.installScriptPackages),
    manifest: null
  };

  function write() {
    const lockContent = Buffer.from(JSON.stringify(state.lock, null, 2) + '\n');
    fs.writeFileSync(lockPath, lockContent);
    state.manifest = state.manifest || {
      schemaVersion: 1,
      packageVersion: VERSION,
      auditedLock: {
        path: 'dsh-runtime-package-lock.json',
        sha256: sha256(lockContent)
      },
      targets: [target],
      installScriptAllowlist: [...(options.installScriptPackages || ['protobufjs'])].sort()
    };
    state.manifest.auditedLock.sha256 = sha256(lockContent);
    fs.writeFileSync(manifestPath, JSON.stringify(state.manifest, null, 2) + '\n');
  }
  write();

  function load(overrides = {}) {
    return candidateRuntime.loadCandidateRuntime({
      repositoryRoot,
      manifestPath,
      targetPlatform: target.platform,
      targetArch: target.arch,
      hostPlatform: target.platform,
      hostArch: target.arch,
      outputDir,
      ...overrides
    });
  }

  function cleanup() {
    for (const exact of [repositoryRoot, workspace]) {
      if (exact.startsWith(os.tmpdir() + path.sep)) {
        fs.rmSync(exact, { recursive: true, force: true });
      }
    }
  }

  return { repositoryRoot, candidateDir, workspace, outputDir, lockPath, manifestPath, target, state, write, load, cleanup };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code, code);
}

async function withFixture(fn, options) {
  const value = fixture(options);
  try { await fn(value); } finally { value.cleanup(); }
}

async function main() {
  await test('精确 manifest + lock + 原生目标只读通过，不创建 output', async () => {
    await withFixture(async (value) => {
      const beforeManifest = fs.readFileSync(value.manifestPath);
      const beforeLock = fs.readFileSync(value.lockPath);
      const result = value.load();
      assert.equal(result.packageVersion, VERSION);
      assert.equal(result.packageIntegrity, INTEGRITY);
      assert.equal(result.auditedLockSha256, sha256(beforeLock));
      assert.deepEqual(result.installScriptAllowlist, ['protobufjs']);
      assert.equal(result.outputDir, path.join(fs.realpathSync(value.workspace), 'runtime'));
      assert.equal(fs.existsSync(value.outputDir), false);
      assert.deepEqual(fs.readFileSync(value.manifestPath), beforeManifest);
      assert.deepEqual(fs.readFileSync(value.lockPath), beforeLock);
    });
  });

  await test('install-script allowlist 来自候选 manifest 且必须与 lock 精确相等', async () => {
    await withFixture(async (value) => {
      assert.deepEqual(value.load().installScriptAllowlist, ['@scope/native', 'protobufjs']);
      value.state.manifest.installScriptAllowlist = ['protobufjs'];
      value.write();
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_INSTALL_SCRIPTS');
      value.state.manifest.installScriptAllowlist = ['@scope/native', 'not-observed', 'protobufjs'];
      value.write();
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_INSTALL_SCRIPTS');
    }, { installScriptPackages: ['@scope/native', 'protobufjs'] });
  });

  await test('allowlist 和 targets 拒绝重复、乱序与未知字段', async () => {
    await withFixture(async (value) => {
      value.state.manifest.installScriptAllowlist = ['protobufjs', '@scope/native'];
      value.write();
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_MANIFEST');
      value.state.manifest.installScriptAllowlist = ['@scope/native', 'protobufjs'];
      value.state.manifest.targets = [
        { platform: 'win32', arch: 'x64' },
        { platform: 'darwin', arch: 'arm64' }
      ];
      value.write();
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_MANIFEST');
      value.state.manifest.targets = [value.target];
      value.state.manifest.extra = true;
      value.write();
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_MANIFEST');
    }, { installScriptPackages: ['@scope/native', 'protobufjs'] });
  });

  await test('候选版本只接受严格 SemVer，拒绝 tag、前后空白和前导零', async () => {
    for (const invalid of ['latest', 'next', `v${VERSION}`, ` ${VERSION}`, `${VERSION} `, '0.1.1-rc.02', '01.1.1']) {
      await withFixture(async (value) => {
        value.state.manifest.packageVersion = invalid;
        value.write();
        expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_VERSION');
      });
    }
    for (const valid of ['0.1.1-rc.2', '1.0.0', '1.0.0+build.7']) {
      assert.equal(candidateRuntime.STRICT_SEMVER.test(valid), true, valid);
    }
  });

  await test('manifest 只能位于 compliance/candidates 下', async () => {
    await withFixture(async (value) => {
      const outside = path.join(value.repositoryRoot, 'candidate-manifest.json');
      fs.copyFileSync(value.manifestPath, outside);
      expectCode(() => value.load({ manifestPath: outside }), 'ERR_DSH_CANDIDATE_PATH');
    });
  });

  await test('audited lock 不得越出当前 candidate 目录', async () => {
    await withFixture(async (value) => {
      const sibling = path.join(value.candidateDir, '..', 'outside-lock.json');
      fs.copyFileSync(value.lockPath, sibling);
      value.state.manifest.auditedLock.path = '../outside-lock.json';
      const content = fs.readFileSync(sibling);
      value.state.manifest.auditedLock.sha256 = sha256(content);
      fs.writeFileSync(value.manifestPath, JSON.stringify(value.state.manifest, null, 2) + '\n');
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_PATH');
    });
  });

  await test('lock SHA 稍有漂移就在 npm 前 fail-closed', async () => {
    await withFixture(async (value) => {
      fs.appendFileSync(value.lockPath, ' ');
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_LOCK_SHA256');
    });
  });

  await test('lock 根不得多依赖、错版本或缺官方 integrity', async () => {
    for (const mutate of [
      (lock) => { lock.packages[''].dependencies.extra = '1.0.0'; },
      (lock) => { lock.packages[''].dependencies['@deepseek-ai/dsh'] = '0.1.0-rc.6'; },
      (lock) => { delete lock.packages['node_modules/@deepseek-ai/dsh'].integrity; },
      (lock) => { lock.packages['node_modules/@deepseek-ai/dsh'].resolved = 'https://example.invalid/dsh.tgz'; }
    ]) {
      await withFixture(async (value) => {
        mutate(value.state.lock);
        value.write();
        expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_LOCK');
      });
    }
  });

  await test('候选取证拒绝 host/target 不同和 manifest 未批准目标', async () => {
    await withFixture(async (value) => {
      const otherArch = value.target.arch === 'arm64' ? 'x64' : 'arm64';
      expectCode(() => value.load({ hostArch: otherArch }), 'ERR_DSH_CANDIDATE_HOST_TARGET');
      value.state.manifest.targets = [{ platform: value.target.platform, arch: otherArch }];
      value.write();
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_TARGET');
    });
  });

  await test('output 必须是临时 whaledock-dsh-runtime-* 下的不存在路径', async () => {
    await withFixture(async (value) => {
      const outside = path.join(value.repositoryRoot, 'runtime');
      expectCode(() => value.load({ outputDir: outside }), 'ERR_DSH_CANDIDATE_OUTPUT');
      fs.mkdirSync(value.outputDir);
      expectCode(() => value.load(), 'ERR_DSH_CANDIDATE_OUTPUT');
    });
  });

  await test('纯校验模块不引入子进程、网络或文件写入 API', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dsh-runtime-candidate.js'), 'utf8');
    for (const forbidden of [
      "require('child_process')", 'spawnSync(', 'execFileSync(', 'fetch(',
      'writeFileSync(', 'appendFileSync(', 'rmSync(', 'mkdirSync('
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });

  await test('bundle 默认仍只读 DEFAULTS/production lock，输出 manifest 字段零变化', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'bundle-dsh.js'), 'utf8');
    assert.match(source, /const productionVersion = String\(DEFAULTS\.dshVersion \|\| ''\)\.trim\(\);/);
    assert.match(source, /candidate \? candidate\.packageVersion : productionVersion/);
    assert.match(source, /candidate \? candidate\.auditedLockPath : productionAuditedLockPath/);
    const manifestBlock = source.slice(source.indexOf('const manifest = {'), source.indexOf("fs.writeFileSync(\n  path.join(outputDir, 'manifest.json')"));
    assert.deepEqual(
      [...manifestBlock.matchAll(/^  ([A-Za-z][A-Za-z0-9]*)(?::|,)/gm)].map((match) => match[1]),
      [
        'schemaVersion', 'dshVersion', 'packageIntegrity', 'auditedLockSha256',
        'installScriptsIgnored', 'installScriptPackages', 'platform', 'arch',
        'hostPlatform', 'hostArch', 'generatedAt'
      ]
    );
    assert.doesNotMatch(manifestBlock, /candidate/i);
    // rc.6 的 node-pty 1.1.0 和候选版的 1.2.0-beta.15 各自要求完整 Windows 布局。
    assert.match(source, /fs\.existsSync\(path\.join\(nodePtyDir, 'pty\.node'\)\)/);
    for (const required of [
      "'winpty-agent.exe'", "'winpty.dll'", "path.join('conpty', 'OpenConsole.exe')",
      "path.join('conpty', 'conpty.dll')"
    ]) assert(source.includes(required), required);
  });

  console.log(`\nDSH CANDIDATE ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('DSH CANDIDATE FAIL:', error && error.stack || error);
  process.exit(1);
});
