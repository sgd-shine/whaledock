'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = path.join(__dirname, '..', 'scripts', 'verify-packaged-app-runtime.js');
let passed = 0;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function treeSha256(files) {
  return sha256(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join('\n'));
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function writeJson(filePath, value) {
  write(filePath, JSON.stringify(value, null, 2) + '\n');
}

function fixture(platform = 'win32') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-packaged-runtime-'));
  writeJson(path.join(root, 'package.json'), { name: 'whaledock-fixture', version: '1.0.0' });
  const sourceCompliance = path.join(root, 'compliance', 'app-runtime');
  const packageJson = Buffer.from(JSON.stringify({
    name: '@larksuiteoapi/node-sdk', version: '1.73.0'
  }));
  const indexJs = Buffer.from('module.exports={WSClient:class{},EventDispatcher:class{}};\n');
  const files = [
    { path: 'index.js', size: indexJs.length, sha256: sha256(indexJs) },
    { path: 'package.json', size: packageJson.length, sha256: sha256(packageJson) }
  ];
  const lockPath = 'node_modules/@larksuiteoapi/node-sdk';
  const packagedRows = files.map((file) => ({ ...file, path: `${lockPath}/${file.path}` }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const inventory = {
    schemaVersion: 2,
    sdk: { name: '@larksuiteoapi/node-sdk', version: '1.73.0' },
    packagingPolicy: {
      schemaVersion: 1,
      electronBuilderVersion: '26.15.3',
      removePackageScripts: true,
      removePackageKeywords: true,
      disableDefaultIgnoredFiles: false,
      includePdb: false
    },
    packageCount: 1,
    packagedFileCount: files.length,
    packagedTotalBytes: files.reduce((sum, file) => sum + file.size, 0),
    packagedTreeSha256: treeSha256(packagedRows),
    packages: [{
      lockPath,
      name: '@larksuiteoapi/node-sdk',
      version: '1.73.0',
      files,
      packagedFileCount: files.length,
      packagedTreeSha256: treeSha256(files),
      packagedFiles: files
    }]
  };
  writeJson(path.join(sourceCompliance, 'inventory.json'), inventory);
  write(path.join(sourceCompliance, 'THIRD_PARTY_NOTICES.md'), '# fixture\n');
  writeJson(path.join(sourceCompliance, 'package-license-overrides.json'), { schemaVersion: 1, packages: {} });
  writeJson(path.join(sourceCompliance, 'install-script-allowlist.json'), { schemaVersion: 1, packages: [] });
  write(path.join(sourceCompliance, 'licenses', 'package-texts', `${sha256('license\n')}.txt`), 'license\n');

  const appRoot = platform === 'darwin'
    ? path.join(root, 'WhaleDock.app-bundle') : path.join(root, 'win-unpacked');
  const resources = platform === 'darwin'
    ? path.join(appRoot, 'Contents', 'Resources') : path.join(appRoot, 'resources');
  const executable = platform === 'darwin'
    ? path.join(appRoot, 'Contents', 'MacOS', 'WhaleDock') : path.join(appRoot, 'WhaleDock.exe');
  write(executable, 'fixture executable\n');
  write(path.join(resources, 'app.asar'), 'fixture asar\n');
  fs.cpSync(sourceCompliance, path.join(resources, 'compliance', 'app-runtime'), { recursive: true });
  return { root, sourceCompliance, appRoot, resources, executable, inventory };
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const verifier = require(MODULE_PATH);

test('ASAR 物理归档检查使用可注入的原始文件系统视图', () => {
  let seen = null;
  assert.doesNotThrow(() => verifier.assertAsarArchive('/fixture/app.asar', {
    fsImpl: {
      lstatSync(filePath) {
        seen = filePath;
        return { isFile: () => true, isSymbolicLink: () => false };
      }
    }
  }));
  assert.equal(seen, '/fixture/app.asar');
  assert.throws(() => verifier.assertAsarArchive('/fixture/app.asar', {
    fsImpl: {
      lstatSync: () => ({ isFile: () => false, isSymbolicLink: () => false })
    }
  }), /PACKAGED_APP_RUNTIME_PATH/);
});

test('electron-builder 只改变依赖放置路径时仍按包名与版本精确对账', () => {
  const expected = {
    lockPath: 'node_modules/axios/node_modules/agent-base',
    name: 'agent-base',
    version: '6.0.2',
    files: []
  };
  const queues = verifier.expectedPackageQueues([expected]);
  assert.equal(verifier.takeExpectedPackage(queues, 'agent-base', '6.0.2'), expected);
  assert.equal(verifier.takeExpectedPackage(queues, 'agent-base', '7.1.4'), null);
  assert.equal(verifier.takeExpectedPackage(queues, 'agent-base', '6.0.2'), null);
});

test('成品文件集必须精确：manifest 运行字段漂移或缺少 JS 都 fail-closed', () => {
  const expected = [
    { path: 'index.js', size: 10, sha256: 'a'.repeat(64) },
    { path: 'package.json', size: 20, sha256: 'b'.repeat(64) }
  ];
  assert.doesNotThrow(() => verifier.assertExactPackagedFiles(expected, [...expected]));
  assert.throws(() => verifier.assertExactPackagedFiles(expected, [expected[1]]),
    /PACKAGED_APP_RUNTIME_PROBE/);
  assert.throws(() => verifier.assertExactPackagedFiles(expected, [
    expected[0], { ...expected[1], sha256: 'c'.repeat(64) }
  ]), /PACKAGED_APP_RUNTIME_PROBE/);
});

test('macOS .app-bundle 与 Windows unpacked 共用一个布局发现合同', () => {
  for (const platform of ['darwin', 'win32']) {
    const value = fixture(platform);
    try {
      const layout = verifier.findAppLayout(value.appRoot);
      assert.equal(layout.executable, value.executable);
      assert.equal(layout.resources, value.resources);
      assert.equal(layout.asar, path.join(value.resources, 'app.asar'));
    } finally {
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('成品必须携带与仓库逐字节相同的独立 app-runtime 树', () => {
  const value = fixture();
  try {
    assert.doesNotThrow(() => verifier.verifyPackagedMaterials({
      root: value.root,
      resources: value.resources
    }));
    fs.appendFileSync(path.join(value.resources, 'compliance', 'app-runtime', 'THIRD_PARTY_NOTICES.md'), 'drift\n');
    assert.throws(() => verifier.verifyPackagedMaterials({
      root: value.root,
      resources: value.resources
    }), /PACKAGED_APP_RUNTIME_MISMATCH/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('probe receipt 必须回读精确 SDK、闭包数、惰性载入与文件树', () => {
  const value = fixture();
  try {
    const report = {
      status: 'PASS',
      electronVersion: '43.4.0',
      appVersion: '1.0.0',
      sdkVersion: '1.73.0',
      packageCount: 1,
      lazyLoadVerified: true,
      sdkExportsVerified: ['EventDispatcher', 'WSClient'],
      fileCount: value.inventory.packagedFileCount,
      treeSha256: value.inventory.packagedTreeSha256
    };
    assert.doesNotThrow(() => verifier.validateProbeReport(report, value.inventory));
    assert.throws(() => verifier.validateProbeReport({ ...report, lazyLoadVerified: false }, value.inventory), /PACKAGED_APP_RUNTIME_PROBE/);
    assert.throws(() => verifier.validateProbeReport({ ...report, packageCount: 2 }, value.inventory), /PACKAGED_APP_RUNTIME_PROBE/);
    assert.throws(() => verifier.validateProbeReport({ ...report, fileCount: report.fileCount - 1 }, value.inventory), /PACKAGED_APP_RUNTIME_PROBE/);
    assert.throws(() => verifier.validateProbeReport({ ...report, treeSha256: 'f'.repeat(64) }, value.inventory), /PACKAGED_APP_RUNTIME_PROBE/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('外层 verifier 用成品 Electron + ELECTRON_RUN_AS_NODE 发起私有 probe', () => {
  const value = fixture();
  try {
    let invocation = null;
    const report = {
      status: 'PASS', electronVersion: '43.4.0', appVersion: '1.0.0', sdkVersion: '1.73.0',
      packageCount: 1, lazyLoadVerified: true,
      sdkExportsVerified: ['EventDispatcher', 'WSClient'],
      fileCount: value.inventory.packagedFileCount,
      treeSha256: value.inventory.packagedTreeSha256
    };
    const result = verifier.verifyApp({
      root: value.root,
      appRoot: value.appRoot,
      spawnSync: (command, args, options) => {
        invocation = { command, args, options };
        return { status: 0, stdout: JSON.stringify(report) + '\n', stderr: '' };
      }
    });
    assert.equal(result.treeSha256, report.treeSha256);
    assert.equal(invocation.command, value.executable);
    assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(invocation.options.timeout, 120_000);
    assert(invocation.args.includes('--probe'));
    assert(invocation.args.some((item) => item === `--asar=${path.join(value.resources, 'app.asar')}`));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('CI、Release 与续公证覆盖两套合规和全部安装载体', () => {
  const root = path.join(__dirname, '..');
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const resume = fs.readFileSync(path.join(root, '.github', 'workflows', 'resume-notarization.yml'), 'utf8');
  assert.match(ci, /npm ci[\s\S]*npm run compliance:verify[\s\S]*npm run app-runtime:verify/);
  assert.equal((release.match(/npm run app-runtime:verify/g) || []).length, 2);
  assert.equal(release.includes('npm version --no-git-tag-version'), false);
  assert.match(release, /Verify tag matches committed package and lock versions/);
  for (const expected of [
    '--app=release/.app-archives.noindex/WhaleDock-arm64.app-bundle',
    '--app=release/.app-archives.noindex/WhaleDock-x64.app-bundle',
    '--app="$app"',
    '--app="$mount_dir/WhaleDock.app"',
    '--app=release/win-unpacked',
    'app-*.7z',
    'WhaleDock-Setup-$version.exe',
    'WhaleDock-$version-portable.exe'
  ]) assert.equal(release.includes(expected), true, expected);
  assert.equal((release.match(/verify-packaged-compliance\.js/g) || []).length >= 9, true);
  assert.equal((release.match(/verify-packaged-app-runtime\.js/g) || []).length >= 8, true);
  assert.match(resume, /Resume tag\/package\/lock version mismatch/);
  assert.match(resume, /verify-packaged-compliance\.js --search="\$mount_dir\/WhaleDock\.app\/Contents\/Resources"/);
  assert.match(resume, /verify-packaged-app-runtime\.js --app="\$mount_dir\/WhaleDock\.app"/);
  assert.match(release, /## v0\.9\.0 更新/);
  assert.match(resume, /## v0\.9\.0 更新/);
});

console.log(`PACKAGED APP RUNTIME ALL PASS (${passed})`);
