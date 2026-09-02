'use strict';

process.env.WHALEDOCK_MAIN_HELPER_TEST = '1';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const workspaceOps = require('../lib/context-workspace-ops');
const main = require('../main.js');

const ROOT = path.join(__dirname, '..');
const EXPECTED_OPERATIONS = Object.freeze([
  'catalog.read', 'document.read', 'overview.read', 'topic.choose',
  'block.action.prepare', 'block.action.submit',
  'proposal.read', 'proposal.decide', 'proposal.undo',
  'publish.read', 'publish.create', 'publish.update',
  'review.tactics.read', 'review.solidify',
  'shoot.open', 'shoot.history.read',
  'project.action.prepare', 'project.action.submit',
  'receipts.read', 'receipts.ack', 'receipts.open'
]);
const FACTORY_ORDER = Object.freeze([
  'catalog.read', 'document.read',
  'block.action.prepare', 'block.action.submit',
  'overview.read', 'topic.choose',
  'proposal.read', 'proposal.decide', 'proposal.undo',
  'publish.read', 'publish.create', 'publish.update',
  'review.tactics.read', 'review.solidify',
  'shoot.open', 'shoot.history.read',
  'project.action.prepare', 'project.action.submit',
  'receipts.read', 'receipts.ack', 'receipts.open'
]);

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  context-workspace-ops: ${name}`);
  } catch (error) {
    console.error(`FAIL  context-workspace-ops: ${name}`);
    throw error;
  }
}

async function mainTest() {
  await test('模块保持纯 Node，Electron、fs 与真实 runtime adapter 留在 main', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'lib', 'context-workspace-ops.js'), 'utf8'
    );
    const mainSource = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:electron|fs)['"]\)/);
    assert.doesNotMatch(source,
      /currentVideoWorkspaceSnapshot|deliveryReceiptService|openShootingWindowForProject/);
    assert.match(mainSource,
      /contextWorkspaceOps\.configureContextPocWorkspaceOperationDefaults\(\{/);
    assert.match(mainSource,
      /\.\.\.contextPocWorkspaceFileOperations\(options\.operations\)/,
      'broker 必须继续把 legacy operations overrides 原样交给 factory');
    assert.doesNotMatch(mainSource, /^function contextPocWorkspaceFileOperations\(/m,
      'factory 实现不得在 main 留第二份');
  });

  await test('21 个旧 operation 名称精确且无增删', () => {
    assert.equal(workspaceOps.CONTEXT_POC_WORKSPACE_FILE_OPERATIONS.size, 21);
    assert.deepEqual(
      [...workspaceOps.CONTEXT_POC_WORKSPACE_FILE_OPERATIONS], EXPECTED_OPERATIONS
    );
  });

  await test('main helper 导出直接复用 lib 函数引用', () => {
    for (const name of [
      'contextPocWorkspaceFileInputValue',
      'contextPocWorkspaceFileRequestValue',
      'contextPocWorkspaceFileReadResponseValue',
      'contextPocWorkspaceFileClaimValue',
      'contextPocWorkspaceFileRootAuthorizationValue',
      'contextPocWorkspaceFileSettleValue',
      'contextPocUtf8Clip',
      'contextPocWorkspaceFileOperations'
    ]) {
      assert.equal(main[name], workspaceOps[name], `${name} 必须为同一函数引用`);
    }
  });

  await test('root 最终授权与 late settle 只接受有界私有合同', () => {
    const token = 'a'.repeat(64);
    assert.deepEqual(workspaceOps.contextPocWorkspaceFileRootAuthorizationValue({
      authorized: true, code: null, authorizationToken: token
    }), { authorized: true, code: null, authorizationToken: token });
    assert.deepEqual(workspaceOps.contextPocWorkspaceFileRootAuthorizationValue({
      authorized: false, code: 'workspace-mismatch'
    }), { authorized: false, code: 'workspace-mismatch' });
    assert.equal(workspaceOps.contextPocWorkspaceFileRootAuthorizationValue({
      authorized: true, code: null, authorizationToken: token, cwd: '/secret'
    }), null);
    assert.deepEqual(workspaceOps.contextPocWorkspaceFileSettleValue({
      settled: false, code: 'outcome-unknown'
    }), { settled: false, code: 'outcome-unknown' });
  });

  await test('factory 保留 21 项 descriptor 与局部 override 行为', async () => {
    let catalogCalls = 0;
    let currentChecks = 0;
    const operations = workspaceOps.contextPocWorkspaceFileOperations({
      catalog: () => {
        catalogCalls += 1;
        return { generation: 41, projects: [] };
      }
    });
    assert.equal(Object.isFrozen(operations), true);
    assert.deepEqual(Object.keys(operations), FACTORY_ORDER);
    for (const [name, descriptor] of Object.entries(operations)) {
      assert.equal(Object.isFrozen(descriptor), true, `${name} descriptor 必须冻结`);
      assert.equal(typeof descriptor.validate, 'function');
      assert.equal(typeof descriptor.handle, 'function');
      assert.equal(typeof descriptor.redact, 'function');
      assert.equal(typeof descriptor.errorCode, 'function');
    }

    const input = operations['catalog.read'].validate({ cursor: 0, limit: 4 });
    assert.deepEqual(input, { cursor: 0, limit: 4 });
    assert.equal(Object.isFrozen(input), true);
    assert.throws(() => operations['catalog.read'].validate({
      cursor: 0, limit: 4, path: '/private/tmp/forbidden'
    }));
    const raw = await operations['catalog.read'].handle({
      input,
      context: {
        assertCurrent() {
          currentChecks += 1;
          return true;
        }
      }
    });
    assert.deepEqual(operations['catalog.read'].redact(raw), {
      kind: 'catalog', generation: 41, projectCount: 0,
      cursor: 0, nextCursor: null, projects: []
    });
    assert.equal(catalogCalls, 1);
    assert.equal(currentChecks, 1);
    await assert.rejects(operations['catalog.read'].handle({
      input,
      context: { assertCurrent: () => false }
    }), (error) => error && error.code === 'ERR_WORKSPACE_BINDING_STALE');
  });

  console.log(`\nCONTEXT WORKSPACE OPS ALL PASS (${passed})`);
}

mainTest().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
