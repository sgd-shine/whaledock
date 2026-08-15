'use strict';

// v0.4 图片入口纯 Node 合约测试；不需要 Electron，也不读取真实剪贴板或屏幕。
const assert = require('assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const config = require('../lib/config');
const imageInput = require('../lib/image-input');

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

function pngHeader(width, height) {
  const value = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(value, 0);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  value[24] = 8;
  value[25] = 6;
  return value;
}

function jpegHeader(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
}

function existingPathIdentity(value, options = {}) {
  const platform = options.platform || process.platform;
  const realpathSync = options.realpathSync
    || fs.realpathSync.native
    || fs.realpathSync;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let resolved = pathApi.normalize(realpathSync(value));
  if (platform === 'win32') {
    if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`;
    else if (resolved.startsWith('\\\\?\\')) resolved = resolved.slice(4);
    resolved = resolved.toLowerCase();
  }
  return resolved;
}

function assertSameExistingPath(actual, expected, options = {}) {
  assert.equal(existingPathIdentity(actual, options), existingPathIdentity(expected, options));
}

function fakeChild({ stdout = '', stderr = '', code = 0, waitForKill = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  queueMicrotask(() => {
    if (waitForKill) return;
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code, null);
  });
  return child;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-image-input-'));
  const stagingRoot = path.join(tmp, 'capture-staging');
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(workspace);

  await test('既有路径身份先 realpath：Windows 长路径/8.3 别名统一，POSIX 大小写精确', async () => {
    const shortAlias = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\stage';
    const longAlias = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\stage';
    const fakeRealpathSync = (value) => {
      if (value === shortAlias) return 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\stage';
      if (value === longAlias) return '\\\\?\\C:\\Users\\RUNNERADMIN\\AppData\\Local\\Temp\\stage';
      return value;
    };
    assertSameExistingPath(shortAlias, longAlias, {
      platform: 'win32',
      realpathSync: fakeRealpathSync
    });
    assert.notEqual(
      existingPathIdentity('/tmp/Stage', { platform: 'linux', realpathSync: (value) => value }),
      existingPathIdentity('/tmp/stage', { platform: 'linux', realpathSync: (value) => value })
    );
  });

  await test('PNG/JPEG header 精确识别，伪格式与坏尺寸 fail-closed', async () => {
    assert.deepEqual(imageInput.inspectImageHeader(pngHeader(800, 600)), {
      format: 'png', width: 800, height: 600
    });
    assert.deepEqual(imageInput.inspectImageHeader(jpegHeader(1024, 768)), {
      format: 'jpeg', width: 1024, height: 768
    });
    assert.throws(
      () => imageInput.inspectImageHeader(Buffer.from('not-an-image')),
      (error) => error.code === 'ERR_IMAGE_FORMAT'
    );
    assert.throws(
      () => imageInput.inspectImageHeader(pngHeader(0, 10)),
      (error) => error.code === 'ERR_IMAGE_DIMENSIONS'
    );
  });

  await test('decoded limits 同时约束源字节、边长、像素与 header 一致性', async () => {
    assert.deepEqual(imageInput.validateDecodedImage({
      source: 'drop', sourceBytes: 1024,
      header: { format: 'png', width: 1000, height: 900 },
      width: 1000, height: 900
    }), { source: 'drop', format: 'png', width: 1000, height: 900, sourceBytes: 1024 });
    assert.throws(() => imageInput.validateDecodedImage({
      source: 'drop', sourceBytes: imageInput.LIMITS.maxSourceBytes + 1,
      header: { format: 'png', width: 1, height: 1 }, width: 1, height: 1
    }), (error) => error.code === 'ERR_IMAGE_TOO_LARGE');
    assert.throws(() => imageInput.validateDecodedImage({
      source: 'paste', sourceBytes: 100,
      header: { format: 'png', width: 10000, height: 5000 }, width: 10000, height: 5000
    }), (error) => error.code === 'ERR_IMAGE_PIXELS');
    assert.throws(() => imageInput.validateDecodedImage({
      source: 'mac-capture', sourceBytes: 100,
      header: { format: 'png', width: 20, height: 20 }, width: 21, height: 20
    }), (error) => error.code === 'ERR_IMAGE_DECODE_MISMATCH');
  });

  await test('三入口共用 reducer，非法跃迁拒绝且 renderer snapshot 去除私有路径', async () => {
    for (const source of ['mac-capture', 'windows-clipboard', 'paste', 'drop']) {
      const initial = imageInput.createCapture({
        captureId: `capture-${source}`,
        source,
        workspaceGeneration: 7,
        workspaceLabel: '示例工作区'
      });
      const preview = imageInput.reduceCapture(initial, {
        type: 'acquired',
        stagingPath: `/private/staging/${source}.png`,
        sourcePath: `/private/source/${source}.png`,
        thumbnail: 'data:image/png;base64,AA==',
        width: 40,
        height: 30
      });
      assert.equal(preview.stage, 'preview');
      const snapshot = imageInput.captureRendererSnapshot(preview);
      assert.equal(snapshot.source, source);
      assert.equal(snapshot.workspaceLabel, '示例工作区');
      assert.equal(JSON.stringify(snapshot).includes('/private/'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'stagingPath'), false);
      assert.throws(
        () => imageInput.reduceCapture(preview, { type: 'recognized', route: 'path-only' }),
        (error) => error.code === 'ERR_CAPTURE_TRANSITION'
      );
    }
  });

  await test('保存后的 reducer 暴露确认路径/文本但不泄露 raw session id', async () => {
    let state = imageInput.createCapture({
      captureId: 'capture-flow', source: 'drop',
      workspaceGeneration: 9, workspaceLabel: '工位 A'
    });
    state = imageInput.reduceCapture(state, {
      type: 'acquired', stagingPath: '/tmp/private-stage.png',
      thumbnail: 'data:image/png;base64,AA==', width: 10, height: 10
    });
    state = imageInput.reduceCapture(state, { type: 'confirm-save' });
    state = imageInput.reduceCapture(state, { type: 'saved', savedPath: '/work/鲸坞截图/a.png' });
    state = imageInput.reduceCapture(state, {
      type: 'recognized', route: 'local-ocr', ocrText: '识别文本',
      ocrTruncated: false,
      deliveryText: '交付文本',
      targets: [{ targetToken: 'target-safe', label: '会话 01', running: true }],
      rawSessionId: 'must-not-pass'
    });
    const snapshot = imageInput.captureRendererSnapshot(state);
    assert.equal(snapshot.stage, 'delivery-ready');
    assert.equal(snapshot.savedPath, '/work/鲸坞截图/a.png');
    assert.equal(snapshot.targets[0].targetToken, 'target-safe');
    assert.equal(JSON.stringify(snapshot).includes('must-not-pass'), false);
  });

  let randomCounter = 0;
  const randomBytes = (length) => {
    randomCounter += 1;
    return Buffer.alloc(length, randomCounter);
  };
  await test('mac capture staging plan 创建 0700 受控目录并返回尚不存在的随机 PNG 路径', async () => {
    const plannedRoot = path.join(tmp, 'mac-capture-staging');
    const plan = await imageInput.planMacCaptureStaging({
      stagingRoot: plannedRoot,
      captureId: 'capture-mac-plan',
      randomBytes
    });
    assert.deepEqual(Object.keys(plan), ['path']);
    assertSameExistingPath(path.dirname(plan.path), plannedRoot);
    assert.match(path.basename(plan.path), /^whaledock-capture-[a-f0-9]+\.png$/);
    assert.equal(fs.existsSync(plan.path), false);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(plannedRoot).mode & 0o777, 0o700);
    }
  });
  let stagingPath;
  await test('staging 使用受控目录、随机名、exclusive create 与 0600', async () => {
    stagingPath = await imageInput.writeStagingPng({
      stagingRoot,
      captureId: 'capture-stage',
      pngBuffer: pngHeader(16, 16),
      randomBytes
    });
    assertSameExistingPath(path.dirname(stagingPath), stagingRoot);
    assert.match(path.basename(stagingPath), /^whaledock-capture-[a-f0-9]+\.png$/);
    assert.equal(fs.lstatSync(stagingPath).isFile(), true);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(stagingRoot).mode & 0o777, 0o700);
      assert.equal(fs.statSync(stagingPath).mode & 0o777, 0o600);
    }
  });

  await test('staging 随机名碰撞绝不删除或覆盖既有文件', async () => {
    const fixedRandom = (length) => Buffer.alloc(length, 0xaa);
    const occupied = path.join(stagingRoot, `whaledock-capture-${'aa'.repeat(12)}.png`);
    fs.writeFileSync(occupied, 'existing-owner-data');
    await assert.rejects(imageInput.writeStagingPng({
      stagingRoot,
      captureId: 'capture-collision',
      pngBuffer: pngHeader(8, 8),
      randomBytes: fixedRandom
    }), (error) => error.code === 'ERR_CAPTURE_STAGING_WRITE');
    assert.equal(fs.readFileSync(occupied, 'utf8'), 'existing-owner-data');
  });

  let savedPath;
  await test('确认保存做 generation、containment、随机 wx 与已保存文件 0600', async () => {
    savedPath = await imageInput.saveStagedImage({
      stagingPath,
      workspacePath: workspace,
      workspaceGeneration: 11,
      currentWorkspaceGeneration: 11,
      now: new Date('2026-08-15T12:34:56.000Z'),
      randomBytes
    });
    assertSameExistingPath(path.dirname(savedPath), path.join(workspace, '鲸坞截图'));
    assert.match(path.basename(savedPath), /^鲸坞截图-20260815-123456-[a-f0-9]+\.png$/);
    assert.equal(fs.readFileSync(savedPath).equals(fs.readFileSync(stagingPath)), true);
    if (process.platform !== 'win32') assert.equal(fs.statSync(savedPath).mode & 0o777, 0o600);
    await assert.rejects(imageInput.saveStagedImage({
      stagingPath,
      workspacePath: workspace,
      workspaceGeneration: 11,
      currentWorkspaceGeneration: 12,
      randomBytes
    }), (error) => error.code === 'ERR_CAPTURE_WORKSPACE_CHANGED');
  });

  await test('已存在的用户鲸坞截图目录不被擅自改权限', async () => {
    if (process.platform === 'win32') return;
    const existingWorkspace = path.join(tmp, 'existing-screenshot-workspace');
    const existingScreenshots = path.join(existingWorkspace, '鲸坞截图');
    fs.mkdirSync(existingScreenshots, { recursive: true, mode: 0o755 });
    fs.chmodSync(existingScreenshots, 0o755);
    await imageInput.saveStagedImage({
      stagingPath,
      workspacePath: existingWorkspace,
      workspaceGeneration: 12,
      currentWorkspaceGeneration: 12,
      randomBytes
    });
    assert.equal(fs.statSync(existingScreenshots).mode & 0o777, 0o755);
  });

  await test('鲸坞截图目录 symlink/junction 时保存 fail-closed 且不改 staging', async () => {
    const unsafeWorkspace = path.join(tmp, 'unsafe-workspace');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(unsafeWorkspace);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(unsafeWorkspace, '鲸坞截图'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(imageInput.saveStagedImage({
      stagingPath,
      workspacePath: unsafeWorkspace,
      workspaceGeneration: 1,
      currentWorkspaceGeneration: 1,
      randomBytes
    }), (error) => error.code === 'ERR_CAPTURE_UNSAFE_PATH');
    assert.equal(fs.existsSync(stagingPath), true);
    assert.equal(fs.readdirSync(outside).length, 0);
  });

  await test('保存层拒绝 fake home/.dsh 与 realpath 落入链接且不创建截图目录', async () => {
    const fakeHome = path.join(tmp, 'fake-home-image');
    const protectedWorkspace = path.join(fakeHome, '.dsh', 'project');
    const protectedLink = path.join(tmp, 'image-link-into-fake-dsh');
    fs.mkdirSync(protectedWorkspace, { recursive: true });
    fs.symlinkSync(protectedWorkspace, protectedLink,
      process.platform === 'win32' ? 'junction' : 'dir');
    const forbiddenRoots = config.protectedWorkspaceRoots({ homeDir: fakeHome });
    for (const workspacePath of [protectedWorkspace, protectedLink]) {
      await assert.rejects(imageInput.saveStagedImage({
        stagingPath,
        workspacePath,
        forbiddenRoots,
        workspaceGeneration: 15,
        currentWorkspaceGeneration: 15,
        randomBytes
      }), (error) => error.code === 'ERR_CAPTURE_PROTECTED_ROOT');
    }
    const symlinkHome = path.join(tmp, 'fake-home-image-link');
    const symlinkTarget = path.join(tmp, 'fake-image-dsh-real-target');
    fs.mkdirSync(symlinkHome);
    fs.mkdirSync(symlinkTarget);
    fs.symlinkSync(symlinkTarget, path.join(symlinkHome, '.dsh'),
      process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(imageInput.saveStagedImage({
      stagingPath,
      workspacePath: symlinkTarget,
      forbiddenRoots: config.protectedWorkspaceRoots({ homeDir: symlinkHome }),
      workspaceGeneration: 16,
      currentWorkspaceGeneration: 16,
      randomBytes
    }), (error) => error.code === 'ERR_CAPTURE_PROTECTED_ROOT');
    assert.equal(fs.existsSync(path.join(protectedWorkspace, '鲸坞截图')), false);
    assert.equal(fs.existsSync(path.join(symlinkTarget, '鲸坞截图')), false);
    assert.equal(fs.existsSync(stagingPath), true);
  });

  await test('staging cleanup 只删除固定前缀普通文件，不跟随 symlink', async () => {
    const owned = path.join(stagingRoot, 'whaledock-capture-owned.png');
    const foreign = path.join(stagingRoot, 'keep-me.png');
    const outside = path.join(tmp, 'outside-owned.png');
    const link = path.join(stagingRoot, 'whaledock-capture-link.png');
    fs.writeFileSync(owned, pngHeader(2, 2));
    fs.writeFileSync(foreign, 'keep');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, link, 'file');
    const result = await imageInput.cleanupOwnedStaging({ stagingRoot });
    assert.equal(result.removed >= 2, true); // owned + earlier capture-stage
    assert.equal(fs.existsSync(foreign), true);
    assert.equal(fs.existsSync(outside), true);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  });

  await test('route 固定为 official → plugin → local OCR → path-only，unknown 跳过', async () => {
    assert.equal(imageInput.selectImageRoute({
      official: 'available', plugin: 'available', localOcr: 'available'
    }).route, 'official');
    assert.equal(imageInput.selectImageRoute({
      official: 'unavailable', plugin: 'available', localOcr: 'available'
    }).route, 'plugin');
    assert.equal(imageInput.selectImageRoute({
      official: 'unknown', plugin: 'unknown', localOcr: 'available'
    }).route, 'local-ocr');
    assert.equal(imageInput.selectImageRoute({
      official: 'unknown', plugin: 'unavailable', localOcr: 'unavailable'
    }).route, 'path-only');
  });

  await test('mac capture 与 OCR command 只使用 argv，Windows 不带 Bypass', async () => {
    const macCapture = imageInput.macCaptureCommand('/tmp/whaledock-capture-x.png');
    assert.deepEqual(macCapture, {
      available: true,
      file: '/usr/sbin/screencapture',
      args: ['-i', '-x', '/tmp/whaledock-capture-x.png'],
      shell: false,
      windowsHide: false
    });
    const macOcr = imageInput.ocrCommand('darwin', {
      scriptsRoot: '/Applications/WhaleDock.app/Contents/Resources/assets/ocr',
      imagePath: '/tmp/a.png'
    });
    assert.equal(macOcr.file, '/usr/bin/osascript');
    assert.deepEqual(macOcr.args.slice(0, 2), ['-l', 'JavaScript']);
    assert.equal(macOcr.shell, false);
    const windowsOcr = imageInput.ocrCommand('win32', {
      scriptsRoot: 'C:\\WhaleDock\\resources\\assets\\ocr',
      imagePath: 'C:\\work\\a.png'
    });
    assert.equal(windowsOcr.file, 'powershell.exe');
    assert.equal(windowsOcr.args.includes('-NoProfile'), true);
    assert.equal(windowsOcr.args.includes('-NonInteractive'), true);
    assert.equal(windowsOcr.args.some((item) => /bypass/i.test(item)), false);
    assert.equal(imageInput.ocrCommand('linux', {
      scriptsRoot: '/app/assets/ocr', imagePath: '/tmp/a.png'
    }).available, false);
  });

  await test('bounded OCR runner 接受受控 JSON、截断正文且不返回 stderr', async () => {
    const longText = '鲸'.repeat(30000);
    let call;
    const result = await imageInput.runBoundedOcr({
      available: true, file: '/fake/ocr', args: ['/fake/image'], shell: false, windowsHide: true
    }, {
      spawn: (file, args, options) => {
        call = { file, args, options };
        return fakeChild({
          stdout: JSON.stringify({ schemaVersion: 1, ok: true, text: longText }),
          stderr: 'private path must not escape'
        });
      },
      timeoutMs: 1000
    });
    assert.equal(call.options.shell, false);
    assert.equal(result.ok, true);
    assert.equal(result.truncated, true);
    assert(Buffer.byteLength(result.text, 'utf8') <= imageInput.LIMITS.maxOcrTextBytes);
    assert.equal(JSON.stringify(result).includes('private path'), false);
  });

  await test('OCR timeout 会终止 child，坏 JSON 与 unavailable 均有限降级', async () => {
    let timedChild;
    const timeout = await imageInput.runBoundedOcr({
      available: true, file: '/fake/ocr', args: [], shell: false, windowsHide: true
    }, {
      spawn: () => {
        timedChild = fakeChild({ waitForKill: true });
        return timedChild;
      },
      timeoutMs: 5,
      settleTimeoutMs: 50
    });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.reason, 'timeout');
    assert.equal(timedChild.killed, true);
    const invalid = await imageInput.runBoundedOcr({
      available: true, file: '/fake/ocr', args: [], shell: false, windowsHide: true
    }, { spawn: () => fakeChild({ stdout: '{bad json' }), timeoutMs: 100 });
    assert.deepEqual(invalid, { ok: false, reason: 'invalid-output' });
    assert.deepEqual(await imageInput.runBoundedOcr({ available: false, reason: 'unsupported-platform' }), {
      ok: false, reason: 'unsupported-platform'
    });
  });

  await test('delivery text 有界、path-only 不伪造 OCR 且不会触发 slash command', async () => {
    const withOcr = imageInput.buildDeliveryText({
      savedPath,
      route: 'local-ocr',
      ocrText: '按钮报错',
      ocrTruncated: false
    });
    assert.match(withOcr, /^请根据下面这张截图协助我。/);
    assert.match(withOcr, /OCR 文本：\n按钮报错/);
    assert.equal(withOcr.trimStart().startsWith('/'), false);
    const pathOnly = imageInput.buildDeliveryText({
      savedPath,
      route: 'path-only',
      ocrText: ''
    });
    assert.equal(pathOnly.includes('OCR 文本'), false);
    assert(Buffer.byteLength(withOcr, 'utf8') <= imageInput.LIMITS.maxDeliveryBytes);
  });

  await test('OCR 脚本只输出 schema JSON，Windows 不绕执行策略', async () => {
    const mac = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ocr', 'macos-vision.jxa'), 'utf8');
    const win = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ocr', 'windows-media-ocr.ps1'), 'utf8');
    assert.match(mac, /VNRecognizeTextRequest/);
    assert.match(mac, /schemaVersion/);
    assert(!/(curl|fetch\(|http:|https:)/i.test(mac));
    assert.match(win, /Windows\.Media\.Ocr/);
    assert.match(win, /ConvertTo-Json/);
    assert(!/ExecutionPolicy|Bypass/i.test(win));
    assert(!/(Invoke-WebRequest|curl|http:|https:)/i.test(win));
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nIMAGE INPUT ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('IMAGE INPUT FAIL:', error && error.stack || error);
  process.exit(1);
});
