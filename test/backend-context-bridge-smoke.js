'use strict';

// v0.10 A2.1 context bridge 资格与假 transport seam。
// 全程不启动 dsh、不发 HTTP，也不增加任何真实 bridge RPC。
const assert = require('assert/strict');
const backend = require('../lib/backend');
const config = require('../lib/config');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  backend-context-bridge: ${name}`);
  } catch (error) {
    console.error(`FAIL  backend-context-bridge: ${name}`);
    throw error;
  }
}

function eligibleFacts(overrides = {}) {
  return {
    enabled: true,
    spawnedByUs: true,
    packageVersionProof: config.DSH_CONTRACT.packageVersion,
    bridgeMounted: true,
    handshake: true,
    ...overrides
  };
}

async function main() {
  await test('纯资格判定按固定优先级 fail-closed', async () => {
    assert.deepEqual(backend.contextBridgeEligibility(eligibleFacts()), {
      eligible: true,
      reason: 'ready'
    });
    assert.deepEqual(backend.contextBridgeEligibility(eligibleFacts({ enabled: false })), {
      eligible: false,
      reason: 'disabled'
    });
    assert.deepEqual(backend.contextBridgeEligibility(eligibleFacts({ spawnedByUs: false })), {
      eligible: false,
      reason: 'external-unproven'
    });
    for (const packageVersionProof of [undefined, null, 'latest', '0.1.0-rc.6']) {
      assert.deepEqual(backend.contextBridgeEligibility(eligibleFacts({
        packageVersionProof
      })), {
        eligible: false,
        reason: 'unsupported-version'
      });
    }
    assert.deepEqual(backend.contextBridgeEligibility(eligibleFacts({ bridgeMounted: false })), {
      eligible: false,
      reason: 'bridge-unavailable'
    });
    assert.deepEqual(backend.contextBridgeEligibility(eligibleFacts({ handshake: false })), {
      eligible: false,
      reason: 'bridge-unavailable'
    });
  });

  await test('disabled/external/错版/缺桥都保持 transport 零调用', async () => {
    const cases = [
      [eligibleFacts({ enabled: false }), 'disabled'],
      [eligibleFacts({ spawnedByUs: false }), 'external-unproven'],
      [eligibleFacts({ packageVersionProof: '0.1.0-rc.6' }), 'unsupported-version'],
      [eligibleFacts({ bridgeMounted: false }), 'bridge-unavailable']
    ];
    for (const [facts, reason] of cases) {
      let calls = 0;
      const result = await backend.probeContextBridge({
        ...facts,
        transport: async () => {
          calls += 1;
          throw new Error('静态门未通过时不应调用 transport');
        }
      });
      assert.deepEqual(result, { eligible: false, reason });
      assert.equal(calls, 0, reason);
    }
  });

  await test('通过静态门后只做一次注入握手且请求不带运行时私密事实', async () => {
    const requests = [];
    const result = await backend.probeContextBridge({
      ...eligibleFacts({ handshake: false }),
      transport: async (request) => {
        requests.push(request);
        return {
          ok: true,
          protocol: 'whaledock.context-bridge/v1'
        };
      }
    });
    assert.deepEqual(result, { eligible: true, reason: 'ready' });
    assert.deepEqual(requests, [{
      type: 'handshake',
      protocol: 'whaledock.context-bridge/v1'
    }]);
    assert.equal(Object.isFrozen(requests[0]), true);
    assert.equal(JSON.stringify(requests).includes('packageVersionProof'), false);
    assert.equal(JSON.stringify(requests).includes('spawnedByUs'), false);
  });

  await test('缺 transport、异常与伪握手统一收口为 bridge-unavailable', async () => {
    assert.deepEqual(await backend.probeContextBridge(
      eligibleFacts({ handshake: false })
    ), {
      eligible: false,
      reason: 'bridge-unavailable'
    });

    let calls = 0;
    for (const reply of [
      true,
      { ok: true },
      { ok: false, protocol: 'whaledock.context-bridge/v1' },
      { ok: true, protocol: 'whaledock.context-bridge/v2' }
    ]) {
      const result = await backend.probeContextBridge({
        ...eligibleFacts({ handshake: false }),
        transport: async () => {
          calls += 1;
          return reply;
        }
      });
      assert.deepEqual(result, { eligible: false, reason: 'bridge-unavailable' });
    }
    const thrown = await backend.probeContextBridge({
      ...eligibleFacts({ handshake: false }),
      transport: async () => {
        calls += 1;
        throw new Error('fake transport down');
      }
    });
    assert.deepEqual(thrown, { eligible: false, reason: 'bridge-unavailable' });
    assert.equal(calls, 5);
  });

  console.log(`\nBACKEND CONTEXT BRIDGE ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
