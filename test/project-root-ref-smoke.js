'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const rootRef = require('../lib/project-root-ref');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  project-root-ref: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-root-ref: ${name}`);
    throw error;
  }
}

const secretA = 'ab'.repeat(32);
const secretB = 'cd'.repeat(32);
const hostA = 'host-project-root-0001';
const hostB = 'host-project-root-0002';

test('POSIX canonical root 字面归一', () => {
  assert.equal(rootRef.canonicalRootKey('/tmp/project/../project'), '/tmp/project');
  assert.match(rootRef.sessionRootRef(secretA, hostA, '/tmp/project'),
    rootRef.SESSION_ROOT_REF_RE);
});

test('Windows extended path、大小写与分隔符归一', () => {
  const first = rootRef.canonicalRootKey('\\\\?\\C:\\Users\\Shine\\Project', {
    platform: 'win32', pathImpl: path.win32
  });
  const second = rootRef.canonicalRootKey('c:\\users\\shine\\project\\', {
    platform: 'win32', pathImpl: path.win32
  });
  assert.equal(first, second);
  assert.equal(
    rootRef.sessionRootRef(secretA, hostA, first, { platform: 'win32', pathImpl: path.win32 }),
    rootRef.sessionRootRef(secretA, hostA, second, { platform: 'win32', pathImpl: path.win32 })
  );
});

test('secret 与 Host 域分离', () => {
  const base = rootRef.sessionRootRef(secretA, hostA, '/tmp/project');
  assert.notEqual(base, rootRef.sessionRootRef(secretB, hostA, '/tmp/project'));
  assert.notEqual(base, rootRef.sessionRootRef(secretA, hostB, '/tmp/project'));
  assert.notEqual(base, rootRef.sessionRootRef(secretA, hostA, '/tmp/other'));
});

test('相对路径、控制字符与非法身份拒绝', () => {
  assert.throws(() => rootRef.canonicalRootKey('../project'));
  assert.throws(() => rootRef.canonicalRootKey('/tmp/bad\nroot'));
  assert.throws(() => rootRef.sessionRootRef('bad', hostA, '/tmp/project'));
  assert.throws(() => rootRef.sessionRootRef(secretA, 'host', '/tmp/project'));
});

test('模块保持纯 Node，不依赖 Electron 或文件系统', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'project-root-ref.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:electron|fs)['"]\)/);
});

console.log(`\nPROJECT ROOT REF ALL PASS (${passed})`);
