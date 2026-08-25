'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const contextPocManifest = require('../scripts/context-poc-manifest');

const MODULE_PATH = path.join(__dirname, '..', 'scripts', 'app-runtime-compliance.js');
let passed = 0;

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

function packageEntry(name, version, license, extra = {}) {
  return {
    name,
    version,
    license,
    main: 'index.js',
    ...extra
  };
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

function addForkProvenance(root) {
  const specs = [
    ['ui-layout', '@deepseek-ai/dsh-client-ui-layout', 300],
    ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation', 50]
  ];
  for (const [key, name] of specs) {
    const forkPath = `context-poc/forks/${key}`;
    writeJson(path.join(root, forkPath, 'package.json'), {
      name, version: '0.1.1-rc.2', license: 'MIT', main: 'lib/index.js'
    });
    write(path.join(root, forkPath, 'LICENSE'), FIXTURE_MIT);
    write(path.join(root, forkPath, 'lib/index.js'), `module.exports='${key}';\n`);
    write(path.join(root, forkPath, 'lib/invariant.js'), `'use strict'; // ${key}\n`);
    write(path.join(root, forkPath, 'lib/client.js'), `'use strict'; // modified ${key}\n`);
    write(path.join(root, 'refork', 'dsh-ui', `${key}.patch`), `fixture patch ${key}\n`);
  }
  const packages = specs.map(([key, name, budget], index) => {
    const forkPath = `context-poc/forks/${key}`;
    const finalFiles = forkFileManifest(root, forkPath);
    const upstreamFiles = JSON.parse(JSON.stringify(finalFiles));
    for (const relative of ['package.json', 'lib/client.js']) {
      upstreamFiles[relative].sha256 = sha256(`upstream-${key}-${relative}`);
    }
    const patch = fs.readFileSync(path.join(root, 'refork', 'dsh-ui', `${key}.patch`));
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
  write(path.join(root, 'context-poc', 'context-bridge.patch.yml'), 'fixture: true\n');
  writeJson(path.join(root, 'context-poc', 'plugin', 'package.json'), {
    name: '@whaledock/context-bridge-poc', version: '1.0.0'
  });
  write(path.join(root, 'context-poc', 'plugin', 'lib/index.js'), 'module.exports={};\n');
  write(path.join(root, 'context-poc', 'plugin', 'lib/client.js'), 'module.exports={client:true};\n');
  write(path.join(root, 'context-poc', 'FORK-NOTICE.md'), runtime.buildForkNotice({
    version: '0.1.1-rc.2', packages
  }));
  const baseline = contextPocManifest.createManifest(path.join(root, 'context-poc'));
  const baselineBytes = contextPocManifest.canonicalBytes(baseline);
  write(path.join(root, 'lib', 'context-poc-baseline.json'), baselineBytes);
  writeJson(path.join(root, 'refork', 'dsh-ui', 'upstream-lock.json'), {
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
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-app-runtime-'));
  const sdk = 'node_modules/@larksuiteoapi/node-sdk';
  const protobuf = 'node_modules/protobufjs';
  const axios = 'node_modules/axios';
  const agent = 'node_modules/axios/node_modules/agent-base';
  const proxy = 'node_modules/axios/node_modules/https-proxy-agent';
  writeJson(path.join(root, 'package.json'), {
    name: 'whaledock-fixture',
    version: '1.0.0',
    dependencies: { '@larksuiteoapi/node-sdk': '1.73.0' }
  });
  writeJson(path.join(root, 'package-lock.json'), {
    name: 'whaledock-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'whaledock-fixture',
        version: '1.0.0',
        dependencies: { '@larksuiteoapi/node-sdk': '1.73.0' }
      },
      'node_modules/electron-builder': {
        version: '26.15.3',
        dev: true
      },
      [sdk]: {
        version: '1.73.0',
        resolved: 'https://registry.npmjs.org/@larksuiteoapi/node-sdk/-/node-sdk-1.73.0.tgz',
        integrity: 'sha512-U0RL',
        dependencies: {
          axios: '1.19.0',
          protobufjs: '7.6.5'
        }
      },
      [axios]: {
        version: '1.19.0',
        resolved: 'https://registry.npmjs.org/axios/-/axios-1.19.0.tgz',
        integrity: 'sha512-QVhJT1M=',
        dependencies: {
          'agent-base': '6.0.2',
          'https-proxy-agent': '5.0.1'
        }
      },
      [protobuf]: {
        version: '7.6.5',
        resolved: 'https://registry.npmjs.org/protobufjs/-/protobufjs-7.6.5.tgz',
        integrity: 'sha512-UFJPVE8=',
        hasInstallScript: true
      },
      [agent]: {
        version: '6.0.2',
        resolved: 'https://registry.npmjs.org/agent-base/-/agent-base-6.0.2.tgz',
        integrity: 'sha512-QUdFTlQ='
      },
      [proxy]: {
        version: '5.0.1',
        resolved: 'https://registry.npmjs.org/https-proxy-agent/-/https-proxy-agent-5.0.1.tgz',
        integrity: 'sha512-UFJPWFk=',
        dependencies: { 'agent-base': '6.0.2' }
      }
    }
  });
  writeJson(path.join(root, sdk, 'package.json'), packageEntry(
    '@larksuiteoapi/node-sdk', '1.73.0', 'MIT', {
      dependencies: {
        axios: '1.19.0',
        protobufjs: '7.6.5'
      }
    }
  ));
  write(path.join(root, sdk, 'LICENSE'), 'SDK MIT license\n');
  write(path.join(root, sdk, 'index.js'), 'module.exports={};\n');

  writeJson(path.join(root, axios, 'package.json'), packageEntry(
    'axios', '1.19.0', 'MIT', {
      dependencies: {
        'agent-base': '6.0.2',
        'https-proxy-agent': '5.0.1'
      }
    }
  ));
  write(path.join(root, axios, 'LICENSE'), 'axios MIT license\n');
  write(path.join(root, axios, 'index.js'), 'module.exports={};\n');

  writeJson(path.join(root, protobuf, 'package.json'), packageEntry(
    'protobufjs', '7.6.5', 'BSD-3-Clause', {
      scripts: { postinstall: 'node scripts/postinstall' }
    }
  ));
  write(path.join(root, protobuf, 'LICENSE'), 'protobuf BSD license\n');
  write(path.join(root, protobuf, 'index.js'), 'module.exports={};\n');
  write(
    path.join(root, protobuf, 'scripts', 'postinstall.js'),
    fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'protobufjs', 'scripts', 'postinstall.js'))
  );

  for (const [lockPath, name, version] of [
    [agent, 'agent-base', '6.0.2'],
    [proxy, 'https-proxy-agent', '5.0.1']
  ]) {
    writeJson(path.join(root, lockPath, 'package.json'), packageEntry(name, version, 'MIT',
      name === 'https-proxy-agent' ? { dependencies: { 'agent-base': '6.0.2' } } : {}));
    write(path.join(root, lockPath, 'README.md'), `${name} README license\n`);
    write(path.join(root, lockPath, 'index.js'), 'module.exports={};\n');
  }

  const compliance = path.join(root, 'compliance', 'app-runtime');
  writeJson(path.join(compliance, 'package-license-overrides.json'), {
    schemaVersion: 1,
    packages: {
      'agent-base@6.0.2': {
        packagePath: 'README.md',
        sha256: sha256(fs.readFileSync(path.join(root, agent, 'README.md')))
      },
      'https-proxy-agent@5.0.1': {
        packagePath: 'README.md',
        sha256: sha256(fs.readFileSync(path.join(root, proxy, 'README.md')))
      }
    }
  });
  writeJson(path.join(compliance, 'install-script-allowlist.json'), {
    schemaVersion: 1,
    packages: [{
      name: 'protobufjs',
      version: '7.6.5',
      lockPath: protobuf,
      lifecycle: 'postinstall',
      command: 'node scripts/postinstall',
      scriptPath: 'scripts/postinstall.js',
      sha256: sha256(fs.readFileSync(path.join(root, protobuf, 'scripts', 'postinstall.js')))
    }]
  });
  addForkProvenance(root);
  return { root, compliance, sdk, axios, protobuf, agent, proxy };
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

const runtime = require(MODULE_PATH);

test('Node 式解析 lock 路径、只遍历根生产依赖闭包且锁文件禁止换行改写', () => {
  const attributes = fs.readFileSync(path.join(__dirname, '..', '.gitattributes'), 'utf8');
  assert.match(attributes, /^package-lock\.json -text -whitespace$/m);
  const value = fixture();
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(value.root, 'package-lock.json')));
    assert.deepEqual(runtime.reachableLockPaths(lock), [
      value.sdk, value.axios, value.agent, value.proxy, value.protobuf
    ].sort());
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('generate 生成独立 inventory/NOTICE/内容哈希许可材料，verify 离线逐字节回读', () => {
  const value = fixture();
  try {
    const result = runtime.generateCompliance({ root: value.root });
    assert.equal(result.inventory.schemaVersion, 2);
    assert.equal(result.inventory.packageCount, 5);
    assert.equal(result.inventory.redistributedComponents.componentCount, 2);
    assert.equal(result.inventory.redistributedComponents.includedInRootNpmPackageCount, false);
    assert.equal(result.inventory.redistributedComponents.components.every((item) => (
      item.modified === true && item.license.expression === 'MIT'
    )), true);
    assert.equal(result.redistributed.sources.components.length, 2);
    assert.equal(result.redistributed.sources.separation.includedInRootNpmPackageCount, false);
    assert.equal(result.redistributed.sources.separation.includedInBundledDshRuntimeInventory, false);
    assert.equal(result.redistributed.sources.components.every((item) => item.modified === true), true);
    assert.equal(result.redistributed.sources.components[0].upstream.url,
      'https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-layout/-/dsh-client-ui-layout-0.1.1-rc.2.tgz');
    assert.equal(result.inventory.packagingPolicy.electronBuilderVersion, '26.15.3');
    assert.equal(result.inventory.packagedFileCount < result.inventory.fileCount, true);
    assert.match(result.inventory.packagedTreeSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.inventory.licenseCounts, {
      'BSD-3-Clause': 1,
      MIT: 4
    });
    assert.equal(result.inventory.installScripts.length, 1);
    assert.equal(result.inventory.packages.filter((item) => item.licenseFiles[0].override).length, 2);
    for (const pkg of result.inventory.packages) {
      assert.equal(pkg.packagedFileCount, pkg.packagedFiles.length);
      assert.equal(pkg.packagedFiles.some((file) => file.path === 'package.json'), true);
      assert.equal(pkg.packagedFiles.some((file) => file.path === 'README.md'), false);
    }
    const rootNotice = fs.readFileSync(path.join(value.compliance, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    assert.match(rootNotice, /agent-base \| 6\.0\.2/);
    assert.match(rootNotice, /Modified redistributed forks/);
    assert.match(rootNotice, /@deepseek-ai\/dsh-client-ui-layout/);
    assert.match(rootNotice, /@deepseek-ai\/dsh-client-ui-conversation/);
    assert.match(rootNotice, /SOURCES\.json/);
    const forkNotice = fs.readFileSync(path.join(value.root, 'context-poc', 'FORK-NOTICE.md'), 'utf8');
    assert.match(forkNotice, /本副本已被修改/);
    assert.match(forkNotice, /逐文件改动清单/);
    assert.match(forkNotice, /不再分发上游包内其他文件/);
    assert.doesNotMatch(forkNotice, /(?:\/Users\/|[A-Za-z]:\\)/);
    assert.match(fs.readFileSync(path.join(value.compliance, 'SOURCES.md'), 'utf8'), /modified/);
    assert.equal(
      fs.readFileSync(path.join(value.compliance, runtime.REDISTRIBUTED_LICENSE_NAME), 'utf8'),
      FIXTURE_MIT
    );
    assert.doesNotThrow(() => runtime.verifyCompliance({ root: value.root }));

    fs.appendFileSync(path.join(value.compliance, 'THIRD_PARTY_NOTICES.md'), 'drift\n');
    assert.throws(() => runtime.verifyCompliance({ root: value.root }), /APP_RUNTIME_COMPLIANCE_MISMATCH/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('upstream lock、notice、patch 或最终 fork 缺失/漂移都 fail-closed', () => {
  for (const mutate of [
    (value) => fs.rmSync(path.join(value.root, 'refork', 'dsh-ui', 'upstream-lock.json')),
    (value) => {
      const lockPath = path.join(value.root, 'refork', 'dsh-ui', 'upstream-lock.json');
      const lock = JSON.parse(fs.readFileSync(lockPath));
      lock.versions['0.1.1-rc.2'].ready = false;
      writeJson(lockPath, lock);
    },
    (value) => fs.appendFileSync(path.join(value.root, 'context-poc', 'FORK-NOTICE.md'), 'tamper\n'),
    (value) => fs.appendFileSync(path.join(value.root, 'refork', 'dsh-ui', 'ui-layout.patch'), 'tamper\n'),
    (value) => fs.appendFileSync(path.join(
      value.root, 'context-poc', 'forks', 'ui-conversation', 'lib', 'client.js'
    ), 'tamper\n')
  ]) {
    const value = fixture();
    try {
      mutate(value);
      assert.throws(() => runtime.buildCompliance({ root: value.root }),
        /APP_RUNTIME_FORK_PROVENANCE/);
    } finally {
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('SOURCES JSON/Markdown 与再分发 MIT 材料缺失或伪造都 fail-closed', () => {
  for (const [relative, remove] of [
    ['inventory.json', false],
    ['SOURCES.json', false],
    ['SOURCES.md', true],
    [runtime.REDISTRIBUTED_LICENSE_NAME, false]
  ]) {
    const value = fixture();
    try {
      runtime.generateCompliance({ root: value.root });
      const target = path.join(value.compliance, ...relative.split('/'));
      if (remove) fs.rmSync(target);
      else fs.appendFileSync(target, 'tamper\n');
      assert.throws(() => runtime.verifyCompliance({ root: value.root }),
        /APP_RUNTIME_(?:COMPLIANCE_MISMATCH|FORK_PROVENANCE)/);
    } finally {
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('builder 预期集只清理固定元数据，保留 main/dependencies 并严格哈希运行时文件', () => {
  const source = Buffer.from(JSON.stringify({
    name: 'fixture', version: '1.0.0', main: 'index.js', type: 'commonjs',
    dependencies: { child: '1.0.0' }, scripts: { test: 'node test.js' },
    keywords: ['fixture'], bugs: { url: 'https://example.invalid' }
  }));
  const cleaned = JSON.parse(runtime.cleanedDependencyManifest(source));
  assert.deepEqual(cleaned, {
    name: 'fixture', version: '1.0.0', main: 'index.js', type: 'commonjs',
    dependencies: { child: '1.0.0' }
  });
  assert.equal(runtime.isPackagedRuntimeFile('index.js', 'fixture'), true);
  assert.equal(runtime.isPackagedRuntimeFile('test/index.js', 'fixture'), false);
  assert.equal(runtime.isPackagedRuntimeFile('index.d.ts', 'fixture'), false);
  assert.equal(runtime.isPackagedRuntimeFile('LICENSE', 'fixture'), true);
});

test('未知许可证、平台限定、原生文件和未登记生命周期均 fail-closed', () => {
  for (const mutate of [
    (value) => {
      const file = path.join(value.root, value.sdk, 'package.json');
      const data = JSON.parse(fs.readFileSync(file));
      data.license = 'MPL-2.0';
      writeJson(file, data);
    },
    (value) => {
      const file = path.join(value.root, 'package-lock.json');
      const data = JSON.parse(fs.readFileSync(file));
      data.packages[value.sdk].os = ['darwin'];
      writeJson(file, data);
    },
    (value) => write(path.join(value.root, value.sdk, 'native.node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
    (value) => {
      const file = path.join(value.root, value.sdk, 'package.json');
      const data = JSON.parse(fs.readFileSync(file));
      data.scripts = { install: 'node install.js' };
      writeJson(file, data);
      write(path.join(value.root, value.sdk, 'install.js'), 'noop\n');
    }
  ]) {
    const value = fixture();
    try {
      mutate(value);
      assert.throws(() => runtime.buildCompliance({ root: value.root }), /APP_RUNTIME_/);
    } finally {
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  }
});

console.log(`APP RUNTIME COMPLIANCE ALL PASS (${passed})`);
