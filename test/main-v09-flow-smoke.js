'use strict';

// v0.9 体验流畅度薄层直测：纯 Node 验证预检、严格投递包、贴卡回执与安全边界。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';
const main = require('../main');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-v09: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  main-v09: ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function sourceBlock(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, `缺少起点：${start}`);
  assert.ok(to > from, `缺少终点：${end}`);
  return text.slice(from, to);
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function directoryFs(options = {}) {
  const missing = new Set(options.missing || []);
  const files = new Set(options.files || []);
  const realpath = typeof options.realpath === 'function' ? options.realpath : (value) => value;
  const identity = (value) => {
    const source = options.foldCase ? String(value).toLowerCase() : String(value);
    let hash = 0;
    for (const character of source) hash = ((hash * 33) + character.codePointAt(0)) >>> 0;
    return hash;
  };
  return {
    statSync(value) {
      if (missing.has(value)) throw new Error('missing');
      return {
        dev: 1, ino: identity(value),
        isDirectory: () => !files.has(value),
        isSymbolicLink: () => false
      };
    },
    realpathSync: realpath
  };
}

async function run() {
  await check('deliveryWorkspaceFacts 只返回 match/mismatch/unknown 与私有 canonical key', async () => {
    const fsImpl = directoryFs();
    const matched = main.deliveryWorkspaceFacts('/workspace/video', '/workspace/video/', {
      platform: 'linux', pathImpl: path.posix, fsImpl
    });
    assert.equal(matched.workspaceMatch, 'match');
    assert.equal(matched.targetKey, '/workspace/video');
    assert.equal(matched.workspaceKey, '/workspace/video');
    assert.equal(matched.targetIdentity, matched.workspaceIdentity);
    const mismatched = main.deliveryWorkspaceFacts('/workspace/video', '/workspace/other', {
      platform: 'darwin', pathImpl: path.posix, fsImpl
    });
    assert.equal(mismatched.workspaceMatch, 'mismatch');
    assert.notEqual(mismatched.targetIdentity, mismatched.workspaceIdentity);
    const unknown = main.deliveryWorkspaceFacts(null, '/workspace/video', {
      platform: 'linux', pathImpl: path.posix, fsImpl
    });
    assert.equal(unknown.workspaceMatch, 'unknown');
    assert.equal(unknown.targetKey, null);
    assert.equal(unknown.targetIdentity, null);
    assert.deepEqual(main.deliveryWorkspaceFacts('relative/workspace', '/workspace/video', {
      platform: 'linux', pathImpl: path.posix, fsImpl
    }).workspaceMatch, 'unknown');
    assert.deepEqual(main.deliveryWorkspaceFacts('/workspace/file', '/workspace/video', {
      platform: 'linux', pathImpl: path.posix,
      fsImpl: directoryFs({ files: ['/workspace/file'] })
    }).workspaceMatch, 'unknown');
    let statCalls = 0;
    const replacedFs = {
      statSync: () => ({
        dev: 1, ino: ++statCalls <= 2 ? 10 : 11,
        isDirectory: () => true, isSymbolicLink: () => false
      }),
      realpathSync: (value) => value
    };
    assert.equal(main.deliveryWorkspaceFacts('/workspace/video', '/workspace/video', {
      platform: 'linux', pathImpl: path.posix, fsImpl: replacedFs
    }).workspaceMatch, 'unknown', '同路径实体替换必须要求重新预检');
  });

  await check('Windows cwd 对账按平台语义忽略大小写，不忽略真实目录差异', async () => {
    const fsImpl = directoryFs({ foldCase: true });
    const matched = main.deliveryWorkspaceFacts(
      'C:\\Work\\Video', 'c:\\work\\VIDEO\\',
      { platform: 'win32', pathImpl: path.win32, fsImpl }
    );
    assert.equal(matched.workspaceMatch, 'match');
    assert.equal(matched.targetKey, 'c:\\work\\video');
    assert.equal(matched.workspaceKey, 'c:\\work\\video');
    assert.equal(main.deliveryWorkspaceFacts(
      'C:\\Work\\Video', 'C:\\Work\\Other',
      { platform: 'win32', pathImpl: path.win32, fsImpl }
    ).workspaceMatch, 'mismatch');
  });

  await check('项目、块、灵感三种 dispatch envelope 严格区分首次预检与确认', async () => {
    const projectToken = `project-${'a'.repeat(24)}`;
    const blockToken = `block-${'b'.repeat(24)}`;
    const preflightToken = 'preflight-opaque-01';

    assert.deepEqual(main.videoProjectDispatchRequest({
      projectToken, actionId: 'write-script'
    }), {
      request: { projectToken, actionId: 'write-script' }, confirmation: null
    });
    assert.deepEqual(main.videoProjectDispatchRequest({
      projectToken, actionId: 'write-script', preflightToken, override: false
    }), {
      request: { projectToken, actionId: 'write-script' },
      confirmation: { preflightToken, override: false }
    });

    assert.deepEqual(main.videoBlockDispatchRequest({
      projectToken, blockToken, action: 'ask'
    }), {
      request: { projectToken, blockToken, action: 'ask' }, confirmation: null
    });
    assert.deepEqual(main.videoBlockDispatchRequest({
      projectToken, blockToken, action: 'ask', preflightToken, override: true
    }), {
      request: { projectToken, blockToken, action: 'ask' },
      confirmation: { preflightToken, override: true }
    });

    assert.deepEqual(main.videoSceneDispatchRequest({
      action: 'deposit-inspiration', text: '  一条灵感  ', askAgent: true
    }), {
      request: { action: 'deposit-inspiration', text: '一条灵感', askAgent: true },
      confirmation: null
    });
    assert.deepEqual(main.videoSceneDispatchRequest({
      action: 'deposit-inspiration', text: '一条灵感', askAgent: true,
      preflightToken, override: false
    }), {
      request: { action: 'deposit-inspiration', text: '一条灵感', askAgent: true },
      confirmation: { preflightToken, override: false }
    });
  });

  await check('三种 dispatch envelope 拒绝 extra、partial confirmation 和非法 token', async () => {
    const projectToken = `project-${'a'.repeat(24)}`;
    const blockToken = `block-${'b'.repeat(24)}`;
    const initial = [
      [main.videoProjectDispatchRequest, { projectToken, actionId: 'write-script' }],
      [main.videoBlockDispatchRequest, { projectToken, blockToken, action: 'ask' }],
      [main.videoSceneDispatchRequest, {
        action: 'deposit-inspiration', text: '灵感', askAgent: true
      }]
    ];
    for (const [validator, request] of initial) {
      assert.throws(() => validator({ ...request, extra: true }));
      assert.throws(() => validator({ ...request, preflightToken: 'preflight-opaque-01' }));
      assert.throws(() => validator({ ...request, override: true }));
      assert.throws(() => validator({
        ...request, preflightToken: 'bad', override: true
      }));
      assert.throws(() => validator({
        ...request, preflightToken: 'preflight-opaque-01', override: true, extra: true
      }));
    }
    assert.throws(() => main.videoSceneDispatchRequest({
      action: 'deposit-inspiration', text: '灵感', askAgent: false,
      preflightToken: 'preflight-opaque-01', override: true
    }));
  });

  await check('投递 fingerprint 同动作稳定，不同动作、对象与分段彼此隔离', async () => {
    const first = main.videoDeliveryFingerprint(
      'project-action', 'project-one', 'write-script', 'document-hash'
    );
    const repeated = main.videoDeliveryFingerprint(
      'project-action', 'project-one', 'write-script', 'document-hash'
    );
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(repeated, first);
    const variants = new Set([
      first,
      main.videoDeliveryFingerprint('project-action', 'project-one', 'write-shotlist', 'document-hash'),
      main.videoDeliveryFingerprint('project-action', 'project-two', 'write-script', 'document-hash'),
      main.videoDeliveryFingerprint('block-action', 'project-one', 'write-script', 'document-hash')
    ]);
    assert.equal(variants.size, 4);
    assert.throws(() => main.videoDeliveryFingerprint('', 'project-one'));
  });

  await check('event projection 诚实映射 rejected，unknown 不覆盖已知 admission', async () => {
    assert.deepEqual(main.deliveryReceiptUpdateFromProjection(
      { admission: 'rejected' },
      {
        state: 'error', result: 'rejected',
        updatedAt: '2026-08-23T12:00:00.000Z'
      }
    ), {
      status: 'rejected', tracking: 'unavailable', evidence: 'target-activity',
    });
    assert.deepEqual(main.deliveryReceiptUpdateFromProjection(
      { admission: 'unknown' }, { state: 'unknown', reason: 'events-not-live' }
    ), { status: 'unknown', tracking: 'unavailable' });
    assert.deepEqual(main.deliveryReceiptUpdateFromProjection(
      { admission: 'accepted' }, { state: 'unknown', reason: 'session-sequence-gap' }
    ), { tracking: 'unavailable' });
    assert.equal(main.deliveryReceiptUpdateFromProjection(null, { state: 'running' }), null);
  });

  await check('主进程静态链路锁定预检、二次对账、fetch 前注册与唯一提交', async () => {
    const mainSource = source('main.js');
    const backendSource = source('lib/backend.js');
    const prepare = sourceBlock(
      mainSource, 'async function prepareVideoPromptDelivery',
      'async function findFrozenPromptTarget'
    );
    assert.match(prepare, /adapter\.listTargets\(\)/);
    assert.match(prepare, /adapter\.inspectTarget\(target\.targetToken\)/);
    assert.match(prepare, /deliveryWorkspaceFacts\(inspected\.cwd, workspace\.cwd\)/);
    assert.match(prepare, /deliveryReceiptService\.createPreflight\(/);

    const frozen = sourceBlock(
      mainSource, 'async function findFrozenPromptTarget',
      'function videoReceiptWatcher'
    );
    assert.match(frozen, /inspected\.sessionRef === sessionRef/);
    assert.match(frozen, /adapter\.revalidateTarget\(matches\[0\]\.targetToken\)/);

    const submit = sourceBlock(
      mainSource, 'async function submitPreparedVideoPrompt',
      'function currentVideoRuntime'
    );
    assert.match(submit, /deliveryReceiptService\.consumePreflight\(/);
    assert.match(submit, /findFrozenPromptTarget\(adapter, consumed\.delivery\.sessionRef\)/);
    assert.match(submit, /currentFacts\.targetKey !== previousFacts\.targetKey/);
    assert.match(submit, /currentFacts\.workspaceKey !== previousFacts\.workspaceKey/);
    assert.match(submit, /currentFacts\.targetIdentity !== previousFacts\.targetIdentity/);
    assert.match(submit, /workspace\.generation !== consumed\.delivery\.context\.workspaceGeneration/);
    assert.match(submit, /videoDeliverySubmissions \+= 1/);
    assert.match(submit, /videoDeliverySubmissions = Math\.max\(0, videoDeliverySubmissions - 1\)/);
    assert.match(submit, /currentFacts\.workspaceMatch !== previousFacts\.workspaceMatch/);
    assert.ok(submit.indexOf('findFrozenPromptTarget') < submit.indexOf('adapter.submitText'));
    assert.equal(count(submit, /adapter\.submitText\(/g), 1);

    const receipt = sourceBlock(
      mainSource, 'async function createVideoDeliveryReceipt',
      'async function updateVideoDeliveryAdmission'
    );
    assert.ok(receipt.indexOf('await eventService.flush()')
      < receipt.indexOf('eventService.registerDelivery'));
    assert.match(receipt, /deliveryReceiptService\.createReceipt\(/);
    const admission = sourceBlock(
      mainSource, 'async function updateVideoDeliveryAdmission',
      'function deliveryReceiptUpdateFromProjection'
    );
    assert.match(admission, /projection = eventService\.settleDeliveryAdmission/);
    assert.match(admission, /const projectionPatch = projection && projection\.state !== 'unknown'/);
    const workspaceSwitch = sourceBlock(
      mainSource, 'async function switchWorkspace', 'async function chooseAndSwitchWorkspace'
    );
    assert.match(workspaceSwitch, /videoDeliverySubmissions > 0/);
    assert.match(workspaceSwitch, /ERR_WORKSPACE_DELIVERY_ACTIVE/);
    const backendSubmit = sourceBlock(
      backendSource, 'async function submitText', 'function close()'
    );
    assert.ok(backendSubmit.indexOf('await onDeliveryPrepared')
      < backendSubmit.indexOf("call('session.prompt'"));
    assert.match(backendSubmit, /if \(!deliveryRegistered\)/);
    assert.equal(count(backendSubmit, /call\('session\.prompt'/g), 1);
  });

  await check('watcher 落地后刷新卡片，shell state 不下发任何原始投递引用', async () => {
    const mainSource = source('main.js');
    assert.match(mainSource, /function videoReceiptWatcher/);
    assert.match(mainSource, /function noteVideoReceiptFileUpdates/);
    assert.match(mainSource, /fs\.watch\(candidate,[\s\S]*scheduleVideoWorkspaceRefresh/);
    assert.match(mainSource, /receiptFilesChanged[\s\S]*pushShellState\(\)/);
    assert.match(mainSource, /syncVideoDeliveryReceipts\(\)/);
    const fileUpdates = sourceBlock(
      mainSource, 'function noteVideoReceiptFileUpdates',
      'async function submitPreparedVideoPrompt'
    );
    assert.match(fileUpdates, /watcher\.rootIdentityKey !== runtime\.rootIdentityKey\) continue/);
    assert.match(fileUpdates, /workspaceRoot: watcher\.root/);
    assert.match(fileUpdates, /workspaceIdentityKey: watcher\.rootIdentityKey/);
    const openResult = sourceBlock(
      mainSource, 'async function openDeliveryResult', 'function registerShellIpc'
    );
    assert.match(openResult, /result\.workspaceRoot !== runtime\.root/);
    assert.match(openResult, /result\.workspaceIdentityKey !== runtime\.rootIdentityKey/);
    const shellState = sourceBlock(
      mainSource, 'function shellStateSnapshot', 'function pushShellState'
    );
    assert.match(shellState, /deliveries: deliveryReceiptSurface\(\)/);
    assert.doesNotMatch(
      shellState,
      /deliveryRef|sessionRef|taskKey|cwdFacts|targetKey|workspaceKey/
    );
    const rendererBoundary = `${source('shell.js')}\n${source('preload-shell.js')}`;
    assert.doesNotMatch(
      rendererBoundary,
      /deliveryRef|sessionRef|taskKey|cwdFacts|targetKey|workspaceKey/
    );
  });

  await check('renderer 可见预检默认不发，mismatch/unknown 只能显式选“仍然发”', async () => {
    const renderer = source('shell.js');
    const html = source('shell.html');
    const preflight = sourceBlock(
      renderer, 'function workspaceMatchLabel', 'function appendEmpty'
    );
    assert.match(preflight, /工作区匹配✓/);
    assert.match(preflight, /工作区不匹配⚠/);
    assert.match(preflight, /工作区无法确认⚠/);
    assert.match(preflight, /将发往 \$\{targetLabel\}/);
    assert.match(preflight, /const needsOverride = preflight\.workspaceMatch !== 'match'/);
    assert.match(preflight, /override: needsOverride/);
    assert.match(preflight, /needsOverride \? '仍然发' : '发送'/);
    assert.match(preflight, /askConfirm\('发送前确认'/);
    const confirm = sourceBlock(renderer, 'function askConfirm', 'function dismissConfirm');
    assert.match(confirm, /preferCancel \? confirmCancel : confirmOk/);
    assert.match(html, /id="confirm-cancel"[^>]*>取消</);
  });

  await check('renderer 三类锚点的回执、用时、刚更新和结果打开均可见', async () => {
    const renderer = source('shell.js');
    const html = source('shell.html');
    assert.match(renderer, /appendDeliveryReceipts\(drop, 'scene-inspiration'\)/);
    assert.match(renderer, /appendDeliveryReceipts\((?:node|main), project\.projectToken\)/);
    assert.match(renderer, /appendDeliveryReceipts\(block, item\.blockToken\)/);
    assert.match(renderer, /建议副本生成中/);
    assert.match(renderer, /已用 \$\{formatElapsed\(deliveryElapsedMs\(receipt\)\)\}/);
    assert.match(renderer, /setInterval\(updateDeliveryClocks, 1000\)/);
    assert.match(renderer, /text\('span', '刚更新', 'delivery-pulse'\)/);
    assert.match(renderer, /30_000 - \(now - pulseFirstSeen\.get\(pulseId\)\)/);
    assert.match(renderer, /text\('button', '打开 1 个结果', 'delivery-result'\)/);
    assert.match(renderer, /api\.openDeliveryResult\(\{ resultToken \}\)/);
    assert.match(
      renderer,
      /已发出；事件未接通，完成后文件会自动出现/
    );
    assert.match(html, /\.delivery-receipt\[data-status="running"\]/);
    assert.match(html, /\.delivery-receipt\[data-status="completed"\]/);
    assert.match(html, /\.delivery-receipt\[data-status="unknown"\]/);
  });

  await check('dsh WebContentsView 仍无 preload/注入，package 与 lock 直接依赖未扩张', async () => {
    const mainSource = source('main.js');
    const viewBlock = sourceBlock(
      mainSource, 'const view = new WebContentsView', 'win.contentView.addChildView(view)'
    );
    assert.doesNotMatch(viewBlock, /preload|executeJavaScript/);
    assert.doesNotMatch(mainSource, /executeJavaScript/);
    const pkg = JSON.parse(source('package.json'));
    const lock = JSON.parse(source('package-lock.json'));
    const expectedDependencies = { '@larksuiteoapi/node-sdk': '1.73.0' };
    const expectedDevDependencies = {
      electron: '^43.4.0',
      'electron-builder': '^26.15.3'
    };
    assert.deepEqual(pkg.dependencies, expectedDependencies);
    assert.deepEqual(pkg.devDependencies, expectedDevDependencies);
    assert.deepEqual(lock.packages[''].dependencies, expectedDependencies);
    assert.deepEqual(lock.packages[''].devDependencies, expectedDevDependencies);
  });

  console.log(`\n${passed}/${passed + failed} ${failed === 0 ? 'ALL PASS' : 'FAILED'}`);
  if (failed > 0) {
    const error = new Error(`${failed} main-v09 flow smoke checks failed`);
    error.code = 'MAIN_V09_FLOW_SMOKE_FAILED';
    throw error;
  }
  return { passed, failed };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { run };
