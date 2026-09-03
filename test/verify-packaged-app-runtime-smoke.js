'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appRuntimeCompliance = require('../scripts/app-runtime-compliance');
const contextPocManifest = require('../scripts/context-poc-manifest');

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

const FORK_FILES = [
  'package.json', 'LICENSE', 'lib/index.js', 'lib/invariant.js', 'lib/client.js'
];
const FIXTURE_MIT = 'MIT License\n\nCopyright (c) 2026 DeepSeek\n\nFixture permission text.\n';

function forkFileManifest(root, forkPath) {
  return Object.fromEntries(FORK_FILES.map((relative) => {
    const bytes = fs.readFileSync(path.join(root, forkPath, ...relative.split('/')));
    return [relative, { size: bytes.length, sha256: sha256(bytes) }];
  }));
}

function forkTreeSha256(files) {
  return sha256(FORK_FILES.map((relative) => (
    `${relative}\0${files[relative].size}\0${files[relative].sha256}`
  )).join('\n'));
}

function addRedistributedForks(value) {
  const specs = [
    ['ui-layout', '@deepseek-ai/dsh-client-ui-layout', 300],
    ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation', 50]
  ];
  for (const [key, name] of specs) {
    const forkPath = `context-poc/forks/${key}`;
    writeJson(path.join(value.root, forkPath, 'package.json'), {
      name, version: '0.1.1-rc.2', license: 'MIT', main: 'lib/index.js'
    });
    write(path.join(value.root, forkPath, 'LICENSE'), FIXTURE_MIT);
    write(path.join(value.root, forkPath, 'lib/index.js'), `module.exports='${key}';\n`);
    write(path.join(value.root, forkPath, 'lib/invariant.js'), `'use strict'; // ${key}\n`);
    write(path.join(value.root, forkPath, 'lib/client.js'), `'use strict'; // modified ${key}\n`);
    write(path.join(value.root, 'refork', 'dsh-ui', `${key}.patch`), `fixture patch ${key}\n`);
  }
  const packages = specs.map(([key, name, budget], index) => {
    const forkPath = `context-poc/forks/${key}`;
    const finalFiles = forkFileManifest(value.root, forkPath);
    const upstreamFiles = JSON.parse(JSON.stringify(finalFiles));
    for (const relative of ['package.json', 'lib/client.js']) {
      upstreamFiles[relative].sha256 = sha256(`upstream-${key}-${relative}`);
    }
    const patch = fs.readFileSync(path.join(value.root, 'refork', 'dsh-ui', `${key}.patch`));
    return {
      key,
      name,
      version: '0.1.1-rc.2',
      url: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-0.1.1-rc.2.tgz`,
      tarballBytes: 1000 + index,
      tarballSha256: sha256(`tarball-${key}`),
      integrity: 'sha512-Zml4dHVyZQ==',
      archiveBytes: 4096,
      archiveEntries: 8,
      archiveTreeSha256: sha256(`archive-${key}`),
      forkPath,
      budgetTotalChangedLines: budget,
      upstreamFiles,
      unchangedFiles: ['LICENSE', 'lib/index.js', 'lib/invariant.js'],
      modifiedFiles: ['package.json', 'lib/client.js'],
      patch: {
        format: 'unified-v1',
        path: `refork/dsh-ui/${key}.patch`,
        sha256: sha256(patch)
      },
      finalFiles,
      finalTreeSha256: forkTreeSha256(finalFiles)
    };
  });
  write(path.join(value.root, 'context-poc', 'context-bridge.patch.yml'), 'fixture: true\n');
  writeJson(path.join(value.root, 'context-poc', 'plugin', 'package.json'), {
    name: '@whaledock/context-bridge-poc', version: '1.0.0'
  });
  write(path.join(value.root, 'context-poc', 'plugin', 'lib/index.js'), 'module.exports={};\n');
  write(path.join(value.root, 'context-poc', 'plugin', 'lib/client.js'), 'module.exports={client:true};\n');
  write(path.join(value.root, 'context-poc', 'FORK-NOTICE.md'),
    appRuntimeCompliance.buildForkNotice({ version: '0.1.1-rc.2', packages }));
  const baseline = contextPocManifest.createManifest(path.join(value.root, 'context-poc'));
  const baselineBytes = contextPocManifest.canonicalBytes(baseline);
  write(path.join(value.root, 'lib', 'context-poc-baseline.json'), baselineBytes);
  writeJson(path.join(value.root, 'refork', 'dsh-ui', 'upstream-lock.json'), {
    schemaVersion: 1,
    redistributionFiles: FORK_FILES,
    versions: {
      '0.1.1-rc.2': {
        ready: true,
        contextPocBaseline: {
          path: 'lib/context-poc-baseline.json',
          schema: baseline.schema,
          package: baseline.package,
          fileOrder: baseline.files.map((file) => file.path)
        },
        packages
      }
    }
  });
  const redistributed = appRuntimeCompliance.buildRedistributedCompliance({ root: value.root });
  value.inventory.redistributedComponents = appRuntimeCompliance.buildRedistributedInventory(
    redistributed.sources
  );
  writeJson(path.join(value.sourceCompliance, 'inventory.json'), value.inventory);
  for (const [relative, bytes] of redistributed.files) {
    write(path.join(value.sourceCompliance, ...relative.split('/')), bytes);
  }
  const packagedCompliance = path.join(value.resources, 'compliance', 'app-runtime');
  fs.rmSync(packagedCompliance, { recursive: true, force: true });
  fs.cpSync(value.sourceCompliance, packagedCompliance, { recursive: true });
  fs.cpSync(path.join(value.root, 'context-poc'), path.join(value.resources, 'context-poc'), {
    recursive: true
  });
  const asarView = path.join(value.root, 'asar-view');
  write(path.join(asarView, 'lib', 'context-poc-baseline.json'), baselineBytes);
  return { ...value, redistributed, baseline, asarView };
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

test('成品 SOURCES/MIT 材料必须绑定 app.asar baseline 与 Resources 内两个 fork', () => {
  const value = addRedistributedForks(fixture());
  try {
    const receipt = verifier.verifyPackagedContextPoc({
      asar: value.asarView,
      resources: value.resources,
      inventory: value.inventory
    });
    assert.equal(receipt.contextPocBaselineVerified, true);
    assert.equal(receipt.redistributedForksVerified, true);
    assert.equal(receipt.redistributedForkCount, 2);
    assert.equal(receipt.redistributedLicenseSha256, value.redistributed.sources.license.sha256);
    assert.equal(receipt.redistributedSourcesSha256,
      sha256(fs.readFileSync(path.join(value.sourceCompliance, 'SOURCES.json'))));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('成品伪 SOURCES 或缺失 MIT 材料不能借 baseline 通过', () => {
  for (const mutate of [
    (value) => {
      const sourcesPath = path.join(
        value.resources, 'compliance', 'app-runtime', 'SOURCES.json'
      );
      const sources = JSON.parse(fs.readFileSync(sourcesPath));
      sources.components[0].files['lib/client.js'].sha256 = 'f'.repeat(64);
      sources.components[0].treeSha256 = forkTreeSha256(sources.components[0].files);
      writeJson(sourcesPath, sources);
    },
    (value) => fs.rmSync(path.join(
      value.resources, 'compliance', 'app-runtime',
      ...appRuntimeCompliance.REDISTRIBUTED_LICENSE_NAME.split('/')
    )),
    (value) => {
      value.inventory.redistributedComponents.components[0].modified = false;
    }
  ]) {
    const value = addRedistributedForks(fixture());
    try {
      mutate(value);
      assert.throws(() => verifier.verifyPackagedContextPoc({
        asar: value.asarView,
        resources: value.resources,
        inventory: value.inventory
      }), /PACKAGED_APP_RUNTIME_(?:PROBE|MISSING)/);
    } finally {
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('含 context-poc 的外层 verifier 必须回读再分发 receipt', () => {
  const value = addRedistributedForks(fixture());
  try {
    const contextReceipt = verifier.verifyPackagedContextPoc({
      asar: value.asarView,
      resources: value.resources,
      inventory: value.inventory
    });
    const report = {
      status: 'PASS', electronVersion: '43.4.0', appVersion: '1.0.0', sdkVersion: '1.73.0',
      packageCount: 1, lazyLoadVerified: true,
      sdkExportsVerified: ['EventDispatcher', 'WSClient'],
      fileCount: value.inventory.packagedFileCount,
      treeSha256: value.inventory.packagedTreeSha256,
      ...contextReceipt
    };
    const result = verifier.verifyApp({
      root: value.root,
      appRoot: value.appRoot,
      spawnSync: () => ({ status: 0, stdout: JSON.stringify(report) + '\n', stderr: '' })
    });
    assert.equal(result.redistributedForksVerified, true);
    assert.throws(() => verifier.verifyApp({
      root: value.root,
      appRoot: value.appRoot,
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({ ...report, redistributedForksVerified: false }) + '\n',
        stderr: ''
      })
    }), /PACKAGED_APP_RUNTIME_PROBE/);
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

test('v0.9.1 外层 verifier 在启动成品 Electron 前拒绝 context-poc', () => {
  const value = fixture();
  try {
    writeJson(path.join(value.root, 'package.json'), {
      name: 'whaledock-fixture', version: '0.9.1'
    });
    fs.mkdirSync(path.join(value.resources, 'context-poc'));
    let spawned = false;
    assert.throws(() => verifier.verifyApp({
      root: value.root,
      appRoot: value.appRoot,
      spawnSync: () => {
        spawned = true;
        return { status: 1, stdout: '', stderr: '' };
      }
    }), /v0\.9\.1 成品错误携带 context-poc/);
    assert.equal(spawned, false);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('CI、v0.11 alpha Release 与续公证覆盖两套合规和全部安装载体', () => {
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
  assert.match(release, /context-poc-manifest\.js --resources=release\/\.app-archives\.noindex/);
  assert.match(resume, /context-poc-manifest\.js --resources="\$mount_dir\/WhaleDock\.app\/Contents\/Resources"/);
  assert.equal(release.includes('hotfix-build-config.js --resources='), false);
  assert.equal(resume.includes('hotfix-build-config.js --resources='), false);
  assert.match(resume, /Resume tag\/package\/lock version mismatch/);
  assert.match(resume, /verify-packaged-compliance\.js --search="\$mount_dir\/WhaleDock\.app\/Contents\/Resources"/);
  assert.match(resume, /verify-packaged-app-runtime\.js --app="\$mount_dir\/WhaleDock\.app"/);
  const requiredIntroSentence = '这是 v0.11 项目工作台的预发布验收包，不是稳定版。项目成为一等对象，可绑定对话、从控制室查看需要处理的状态，并在三个布局预设的安全窗格中接收 Markdown 与 `widget-result.json` 产物。';
  const requiredSessionSentence = '本版继续使用鲸坞自己的受管 dsh 目录，`~/.dsh` 不读、不写、不迁移、不清理。真实旧数据升级、真实 Agent 产物回流与五分钟连续手感仍需用户本人完成。';
  const requiredWindowsSentence = 'Windows 仍为实验性支持（未签名、未真机验证）。';
  for (const value of [release, resume]) {
    assert.equal(value.includes('## v0.11.0-alpha.1 真机验收版'), true);
    assert.equal(value.includes(requiredIntroSentence), true);
    assert.equal(value.includes(requiredSessionSentence), true);
    assert.equal(value.includes(requiredWindowsSentence), true);
  }
  assert.equal((release.match(/--config electron-builder\.v0\.11-alpha\.1\.cjs/g) || []).length, 3);
  assert.equal((release.match(/Verify annotated tag is reachable from main/g) || []).length, 2);
  assert.match(resume, /git merge-base --is-ancestor "\$tag_commit" origin\/main/);
  assert.match(release, /Verify macOS release credentials are present/);
  assert.match(release, /MACOS_RELEASE_CREDENTIALS_PRESENT/);
  assert.match(release, /prerelease: \$\{\{ contains\(github\.ref_name, '-'\) \}\}/);
  assert.match(resume, /prerelease: \$\{\{ contains\(inputs\.release_tag, '-'\) \}\}/);
});

console.log(`PACKAGED APP RUNTIME ALL PASS (${passed})`);
