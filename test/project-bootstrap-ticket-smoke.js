'use strict';

const assert = require('assert/strict');
const path = require('path');
const ticketModel = require('../lib/project-bootstrap-ticket');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  project-bootstrap-ticket: ${name}`);
  } catch (error) {
    console.error(`FAIL  project-bootstrap-ticket: ${name}`);
    throw error;
  }
}

const secret = 'ab'.repeat(32);
const base = Object.freeze({
  secret,
  hostInstanceId: 'host-bootstrap0001',
  controllerId: 'controller-bootstrap0001',
  pageInstanceId: 'page-bootstrap000001',
  selectionRevision: 7,
  projectId: `proj_${'1'.repeat(32)}`,
  openToken: `project-open-${'2'.repeat(64)}`,
  root: path.resolve('fixture-project-bootstrap')
});

function deterministicRandom() {
  const values = [Buffer.alloc(12, 3), Buffer.alloc(16, 4)];
  return (size) => {
    const value = values.shift();
    assert.equal(value.length, size);
    return value;
  };
}

test('ticket 仅暴露有界 AEAD 密文并可由同 owner 解开', () => {
  const value = ticketModel.sealProjectBootstrapTicket(base, {
    now: () => 1000,
    randomBytes: deterministicRandom()
  });
  assert.match(value, ticketModel.TICKET_RE);
  assert.ok(Buffer.byteLength(value, 'utf8') <= ticketModel.MAX_TICKET_BYTES);
  assert.equal(value.includes(base.root), false);
  assert.equal(value.includes(base.projectId), false);
  assert.deepEqual(ticketModel.openProjectBootstrapTicket(value, base, {
    now: () => 1001
  }), {
    projectId: base.projectId,
    openToken: base.openToken,
    root: base.root,
    nonce: '04'.repeat(16),
    expiresAtMs: 11000
  });
});

test('Host/page/revision/project/openToken/secret 任一变化都 fail closed', () => {
  const value = ticketModel.sealProjectBootstrapTicket(base, {
    now: () => 2000,
    randomBytes: deterministicRandom()
  });
  const mutations = [
    { hostInstanceId: 'host-bootstrap0002' },
    { controllerId: 'controller-bootstrap0002' },
    { pageInstanceId: 'page-bootstrap000002' },
    { selectionRevision: 8 },
    { projectId: `proj_${'3'.repeat(32)}` },
    { openToken: `project-open-${'4'.repeat(64)}` },
    { secret: 'cd'.repeat(32) }
  ];
  for (const mutation of mutations) {
    assert.equal(ticketModel.openProjectBootstrapTicket(
      value, { ...base, ...mutation }, { now: () => 2001 }
    ), null);
  }
});

test('篡改、过期、未来票据与超预算根均拒绝', () => {
  const value = ticketModel.sealProjectBootstrapTicket(base, {
    now: () => 3000,
    ttlMs: 20,
    randomBytes: deterministicRandom()
  });
  const parts = value.split('.');
  const tail = parts[2].at(-1) === 'A' ? 'B' : 'A';
  parts[2] = `${parts[2].slice(0, -1)}${tail}`;
  assert.equal(ticketModel.openProjectBootstrapTicket(parts.join('.'), base, {
    now: () => 3001
  }), null);
  assert.equal(ticketModel.openProjectBootstrapTicket(value, base, {
    now: () => 3020
  }), null);

  const future = ticketModel.sealProjectBootstrapTicket(base, {
    now: () => 10_000,
    randomBytes: deterministicRandom()
  });
  assert.equal(ticketModel.openProjectBootstrapTicket(future, base, {
    now: () => 8999
  }), null);
  assert.throws(() => ticketModel.sealProjectBootstrapTicket({
    ...base,
    root: path.resolve(`fixture-${'x'.repeat(5000)}`)
  }), /input invalid/);
});

console.log(`PROJECT BOOTSTRAP TICKET ALL PASS (${passed})`);
