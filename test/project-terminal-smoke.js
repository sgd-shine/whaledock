'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const terminal = require('../lib/project-terminal');

const ROOT = path.join(__dirname, '..');
const PROJECT_ID = `proj_${'a'.repeat(32)}`;
const ROOT_REF = `session-root-${'b'.repeat(64)}`;
const HOST_ID = 'host-terminal-fixture-0001';
const CONTROLLER_ID = 'controller-terminal-fixture-0001';
const PAGE_ID = 'page-terminal-fixture-0001';
let passed = 0;

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  project-terminal: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-terminal: ${name}`);
    throw error;
  }
}

function authority(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    paneRef: 'pane-window-1-terminal',
    rootRef: ROOT_REF,
    hostInstanceId: HOST_ID,
    controllerId: CONTROLLER_ID,
    pageInstanceId: PAGE_ID,
    selectionRevision: 7,
    backendGeneration: 3,
    ...overrides
  };
}

function deterministicRandom() {
  let next = 1;
  return (size) => Buffer.alloc(size, next++);
}

async function mainTest() {
  await test('公开合同完整且模块保持纯 Node', () => {
    assert.equal(terminal.LIMITS.maxSessionBytes, 512 * 1024);
    assert.equal(typeof terminal.validate.open, 'function');
    assert.equal(typeof terminal.plan.launch, 'function');
    assert.equal(typeof terminal.sanitizer.sanitize, 'function');
    assert.equal(typeof terminal.buffer.Utf8RingBuffer, 'function');
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'project-terminal.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:electron|fs|node-pty)['"]\)/);
    assert.doesNotMatch(source, /process\.env/);
  });

  await test('open 只接受项目与窗格身份，页面不能传 cwd/path/env/shell', () => {
    const opened = terminal.validate.open({
      projectId: PROJECT_ID,
      paneRef: 'pane-window-1-terminal',
      cols: 120,
      rows: 36
    });
    assert.equal(Object.isFrozen(opened), true);
    for (const [field, value] of [
      ['cwd', '/private/tmp/project'],
      ['path', '/private/tmp/project'],
      ['env', { TOKEN: 'fixture' }],
      ['shell', '/bin/zsh'],
      ['args', ['-c', 'whoami']]
    ]) {
      assert.throws(() => terminal.validate.open({ ...opened, [field]: value }),
        assertCode(terminal.ERROR_CODES.request));
    }
    assert.throws(() => terminal.validate.open({
      projectId: PROJECT_ID, paneRef: 'pane', cols: 2, rows: 36
    }), assertCode(terminal.ERROR_CODES.dimensions));
  });

  await test('write/read/resize/signal/close 精确字段、大小与 SIGINT 限制', () => {
    const record = terminal.createTerminalBinding(authority(), {
      randomBytes: deterministicRandom()
    });
    const publicBinding = terminal.publicTerminalBinding(record);
    const base = { terminalRef: publicBinding.terminalRef, capability: publicBinding.capability };
    assert.equal(terminal.validate.write({ ...base, data: 'printf "ok\\n"\n' }).data,
      'printf "ok\\n"\n');
    assert.throws(() => terminal.validate.write({ ...base, data: 'a\u0000b' }),
      assertCode(terminal.ERROR_CODES.input));
    assert.throws(() => terminal.validate.write({ ...base, data: '\u001b[A' }),
      assertCode(terminal.ERROR_CODES.input));
    assert.throws(() => terminal.validate.write({
      ...base, data: 'x'.repeat(terminal.LIMITS.maxInputBytes + 1)
    }), assertCode(terminal.ERROR_CODES.input));
    assert.deepEqual(terminal.validate.read({
      ...base, afterSeq: 0, maxBytes: 4096, waitMs: 250
    }), { ...base, afterSeq: 0, maxBytes: 4096, waitMs: 250 });
    assert.throws(() => terminal.validate.read({
      ...base, afterSeq: 0, maxBytes: terminal.LIMITS.maxReadBytes + 1, waitMs: 0
    }), assertCode(terminal.ERROR_CODES.output));
    assert.equal(terminal.validate.resize({ ...base, cols: 80, rows: 24 }).cols, 80);
    assert.throws(() => terminal.validate.resize({ ...base, cols: 80, rows: 24, cwd: '/tmp' }),
      assertCode(terminal.ERROR_CODES.request));
    assert.equal(terminal.validate.signal({ ...base, signal: 'SIGINT' }).signal, 'SIGINT');
    assert.throws(() => terminal.validate.signal({ ...base, signal: 'SIGKILL' }),
      assertCode(terminal.ERROR_CODES.signal));
    assert.deepEqual(terminal.validate.close(base), base);
  });

  await test('terminalRef + capability 与 Host/page/project/root/代际全绑定', () => {
    const record = terminal.createTerminalBinding(authority(), {
      randomBytes: deterministicRandom()
    });
    const publicBinding = terminal.publicTerminalBinding(record);
    const request = terminal.validate.close(publicBinding);
    assert.equal(terminal.assertTerminalBinding(record, request, authority()), true);
    for (const changed of [
      authority({ projectId: `proj_${'c'.repeat(32)}` }),
      authority({ rootRef: `session-root-${'d'.repeat(64)}` }),
      authority({ pageInstanceId: 'page-terminal-fixture-9999' }),
      authority({ selectionRevision: 8 }),
      authority({ backendGeneration: 4 })
    ]) {
      assert.throws(() => terminal.assertTerminalBinding(record, request, changed),
        assertCode(terminal.ERROR_CODES.authority));
    }
    assert.throws(() => terminal.assertTerminalBinding(record, {
      ...request, capability: 'f'.repeat(64)
    }, authority()), assertCode(terminal.ERROR_CODES.authority));
    assert.deepEqual(Object.keys(publicBinding).sort(), ['capability', 'terminalRef']);
  });

  await test('清洗 CSI/OSC 8/OSC 52/DCS/APC/PM 且 HTML 只保留为文本', () => {
    const attack = [
      '<img src=x onerror=alert(1)>',
      '\u001b[31mRED\u001b[0m',
      '\u001b]52;c;Y2xpcGJvYXJk\u0007',
      '\u001b]8;;https://evil.invalid\u001b\\LINK\u001b]8;;\u001b\\',
      '\u001bP1;2|DCS-PAYLOAD\u001b\\',
      '\u001b_APC-PAYLOAD\u001b\\',
      '\u001b^PM-PAYLOAD\u001b\\'
    ].join('');
    const cleaned = terminal.sanitizer.sanitize(attack);
    assert.equal(cleaned, '<img src=x onerror=alert(1)>REDLINK');
    assert.doesNotMatch(cleaned, /clipboard|evil|PAYLOAD|\u001b/);

    const stream = new terminal.sanitizer.TerminalSanitizer();
    const pieces = [
      stream.write('A\u001b]5'),
      stream.write('2;c;hidden\u001b'),
      stream.write('\\B\r'),
      stream.write('\nC'),
      stream.finish()
    ];
    assert.equal(pieces.join(''), 'AB\nC');
  });

  await test('UTF-8 ring 严格封顶 512 KiB，从不留半个字符', () => {
    const ring = new terminal.buffer.Utf8RingBuffer({ maxBytes: 64 });
    assert.equal(Object.prototype.hasOwnProperty.call(ring, 'chunks'), false);
    assert.equal(typeof ring.appendClean, 'undefined');
    ring.append('head:');
    ring.append('中文🙂'.repeat(20));
    assert.ok(ring.retainedBytes <= 64);
    const page = ring.page({ afterSeq: 0, maxBytes: 64 });
    assert.equal(page.contentType, 'text/plain');
    assert.equal(page.renderMode, 'text-only');
    assert.equal(Object.isFrozen(page), true);
    assert.equal(Buffer.byteLength(page.text, 'utf8') <= 64, true);
    assert.doesNotMatch(page.text, /\ufffd/);
    assert.equal(page.truncated, true);
    assert.equal(page.nextSeq <= page.endSeq, true);

    const maximum = new terminal.buffer.Utf8RingBuffer();
    maximum.append('x'.repeat(terminal.LIMITS.maxSessionBytes + 100));
    assert.equal(maximum.retainedBytes, terminal.LIMITS.maxSessionBytes);
  });

  await test('ring 在分块控制序列和洪泛下仍只返回安全有界页', () => {
    const ring = new terminal.buffer.Utf8RingBuffer({ maxBytes: 128 });
    ring.append('before\u001b]52;c;');
    ring.append('secret\u0007after<script>alert(1)</script>');
    const first = ring.page({ afterSeq: 0, maxBytes: 32 });
    const second = ring.page({ afterSeq: first.nextSeq, maxBytes: 128 });
    assert.equal(first.text + second.text, 'beforeafter<script>alert(1)</script>');
    assert.doesNotMatch(first.text + second.text, /secret|\u001b/);
    assert.equal(Object.prototype.hasOwnProperty.call(first, 'html'), false);
  });

  await test('POSIX plan 固定 env -i + bash 无 profile，cwd 不插值进 argv', () => {
    const cwd = '/tmp/WhaleDock terminal fixture;not-a-command';
    const launch = terminal.plan.launch({
      platform: 'darwin',
      cwd,
      tempHome: '/tmp/whaledock-terminal-home-fixture',
      tempDir: '/tmp/whaledock-terminal-tmp-fixture'
    });
    assert.equal(launch.file, '/usr/bin/env');
    assert.equal(launch.args[0], '-i');
    assert.deepEqual(launch.args.slice(-4), [
      '/bin/bash', '--noprofile', '--norc', '-i'
    ]);
    assert.equal(launch.cwd, cwd);
    assert.equal(launch.args.includes(cwd), false);
    assert.equal(Object.keys(launch.env).some((key) => /TOKEN|SECRET|DSH|WHALEDOCK/.test(key)), false);
    assert.throws(() => terminal.plan.launch({
      platform: 'darwin', cwd: '/tmp/project', tempHome: '/tmp/home', tempDir: '/tmp',
      env: { WHALEDOCK_CONTEXT_BRIDGE_TOKEN: 'fixture-only' }
    }), assertCode(terminal.ERROR_CODES.plan));
  });

  await test('POSIX env canary 只回读存在性，不回显任何值', () => {
    if (process.platform === 'win32') return;
    const launch = terminal.plan.launch({
      platform: 'linux', cwd: '/tmp', tempHome: '/tmp/wd-home', tempDir: '/tmp/wd-tmp'
    });
    const shellAt = launch.args.indexOf('/bin/bash');
    const probe = spawnSync(launch.file, [
      ...launch.args.slice(0, shellAt),
      '/bin/bash', '--noprofile', '--norc', '-c',
      '[[ ${WHALEDOCK_CONTEXT_BRIDGE_TOKEN+x} ]] && printf 1 || printf 0; '
        + '[[ ${ODDLY_NAMED_CANARY+x} ]] && printf 1 || printf 0'
    ], {
      cwd: '/tmp',
      env: {
        WHALEDOCK_CONTEXT_BRIDGE_TOKEN: 'never-print-this-fixture',
        ODDLY_NAMED_CANARY: 'never-print-this-either'
      },
      encoding: 'utf8'
    });
    assert.equal(probe.status, 0);
    assert.equal(probe.stdout, '00');
    assert.equal(probe.stderr, '');
  });

  await test('Windows plan 固定 NoProfile/EncodedCommand，先清空 Env 再恢复白名单', () => {
    const launch = terminal.plan.launch({
      platform: 'win32',
      cwd: 'C:\\work\\project & not-a-command',
      tempHome: 'C:\\Temp\\wd-home',
      tempDir: 'C:\\Temp\\wd-tmp',
      systemRoot: 'C:\\Windows'
    });
    assert.equal(launch.file.toLowerCase(), 'powershell.exe');
    assert.deepEqual(launch.args.slice(0, 4), [
      '-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand'
    ]);
    const script = Buffer.from(launch.args[4], 'base64').toString('utf16le');
    const clearAt = script.indexOf('Get-ChildItem Env:');
    const restoreAt = script.indexOf('SetEnvironmentVariable');
    assert.ok(clearAt >= 0 && restoreAt > clearAt);
    assert.doesNotMatch(script, /never-print|CONTEXT_BRIDGE|ODDLY_NAMED_CANARY/);
    assert.equal(launch.args.some((arg) => arg.includes(launch.cwd)), false);
    assert.equal(Object.keys(launch.env).some((key) => /TOKEN|SECRET|DSH|WHALEDOCK/.test(key)), false);
    const description = terminal.plan.describe(launch);
    assert.equal(Object.prototype.hasOwnProperty.call(description, 'env'), false);
    assert.deepEqual(description.environmentKeys, Object.keys(launch.env).sort());
  });

  console.log(`\nPROJECT TERMINAL ALL PASS (${passed})`);
}

mainTest().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
