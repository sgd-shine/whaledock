'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const secureStore = require('../lib/remote-secure-store');

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  remote-secure-store: ${name}`);
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function cryptoFixture() {
  let failEncrypt = false;
  return {
    encrypt(value) {
      if (failEncrypt) throw new Error(`不得外泄:${value}`);
      return Buffer.from(`sealed:${value}`, 'utf8');
    },
    decrypt(value) {
      const raw = Buffer.from(value).toString('utf8');
      if (!raw.startsWith('sealed:')) throw new Error(`坏密文:${raw}`);
      return raw.slice('sealed:'.length);
    },
    setFailEncrypt(value) { failEncrypt = value; }
  };
}

function openStore(filePath, crypto) {
  return secureStore.createRemoteSecureStore({
    filePath,
    encrypt: crypto.encrypt,
    decrypt: crypto.decrypt
  });
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-remote-store-'));
  try {
    await test('纯 Node 模块不依赖 Electron，参数严格 fail-closed', async () => {
      const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'remote-secure-store.js'), 'utf8');
      assert.equal(/require\(['"]electron['"]\)/.test(source), false);
      assert.throws(
        () => secureStore.createRemoteSecureStore({ filePath: path.join(tmp, 'bad.json') }),
        assertCode('ERR_REMOTE_STORE_CONTRACT')
      );
      assert.throws(
        () => secureStore.createRemoteSecureStore({
          filePath: 'relative.json', encrypt() {}, decrypt() {}
        }),
        assertCode('ERR_REMOTE_STORE_CONTRACT')
      );
      const strictStore = openStore(path.join(tmp, 'strict-app', 'remote-state.json'), cryptoFixture());
      for (const appId of ['', 'cli_invalid!', 'cli_0123456789abcde', 'cli_0123456789abcdef0']) {
        assert.throws(
          () => strictStore.hasMessage({ appId, messageId: 'om_strict' }),
          assertCode('ERR_REMOTE_STORE_CONTRACT')
        );
      }
    });

    await test('凭据密文原子落盘为 0600，公开状态绝不返回 Secret', async () => {
      const file = path.join(tmp, 'credentials', 'remote-state.json');
      const crypto = cryptoFixture();
      const store = openStore(file, crypto);
      assert.deepEqual(store.credentialStatus(), { configured: false, appIdHint: null });
      assert.equal(store.readActiveAppId(), null);
      const status = store.rotateCredentials({
        appId: 'cli_aaaaaaaaaaaa1234',
        appSecret: 'alpha-secret-never-plain'
      });
      assert.deepEqual(status, { configured: true, appIdHint: 'cli_…1234' });
      assert.equal(JSON.stringify(status).includes('secret'), false);
      assert.deepEqual(store.readCredentials(), {
        appId: 'cli_aaaaaaaaaaaa1234',
        appSecret: 'alpha-secret-never-plain'
      });
      assert.equal(store.readActiveAppId(), 'cli_aaaaaaaaaaaa1234');
      const raw = fs.readFileSync(file, 'utf8');
      assert.equal(raw.includes('alpha-secret-never-plain'), false);
      assert.equal(raw.includes('appSecret'), false);
      if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);

      const reopened = openStore(file, crypto);
      assert.deepEqual(reopened.readCredentials(), {
        appId: 'cli_aaaaaaaaaaaa1234',
        appSecret: 'alpha-secret-never-plain'
      });
    });

    await test('坏 schema、未知字段与坏密文全部拒绝，不猜测修复', async () => {
      const crypto = cryptoFixture();
      for (const [name, value] of [
        ['version', { schemaVersion: 99, activeAppId: null, apps: {} }],
        ['unknown', { schemaVersion: 1, activeAppId: null, apps: {}, extra: true }],
        ['bad-app', {
          schemaVersion: 1,
          activeAppId: 'cli_0000000000000000',
          apps: {
            cli_0000000000000000: { credential: { ciphertext: '*' }, binding: null, messages: [] }
          }
        }]
      ]) {
        const file = path.join(tmp, `schema-${name}.json`);
        fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        assert.throws(() => openStore(file, crypto), assertCode('ERR_REMOTE_STORE_SCHEMA'), name);
      }
    });

    await test('凭据轮换失败保留旧值，清除只清当前应用及其身份账本', async () => {
      const file = path.join(tmp, 'rotate', 'remote-state.json');
      const crypto = cryptoFixture();
      const store = openStore(file, crypto);
      store.rotateCredentials({ appId: 'cli_aaaaaaaaaaaaaaaa', appSecret: 'old-secret' });
      store.commitBinding({
        appId: 'cli_aaaaaaaaaaaaaaaa', actorId: 'ou_owner_A', commitId: 'a'.repeat(64)
      });
      assert.equal(store.rememberMessage({ appId: 'cli_aaaaaaaaaaaaaaaa', messageId: 'om_A' }), true);
      store.commitBinding({
        appId: 'cli_bbbbbbbbbbbbbbbb', actorId: 'ou_owner_B', commitId: 'b'.repeat(64)
      });
      assert.equal(store.rememberMessage({ appId: 'cli_bbbbbbbbbbbbbbbb', messageId: 'om_B' }), true);

      crypto.setFailEncrypt(true);
      assert.throws(
        () => store.rotateCredentials({ appId: 'cli_aaaaaaaaaaaaaaaa', appSecret: 'new-secret' }),
        (error) => error && error.code === 'ERR_REMOTE_STORE_CRYPTO'
          && !/new-secret|不得外泄/.test(error.message)
      );
      crypto.setFailEncrypt(false);
      assert.equal(store.readCredentials().appSecret, 'old-secret');

      store.clearCredentials();
      assert.deepEqual(store.credentialStatus(), { configured: false, appIdHint: null });
      assert.equal(store.readCredentials(), null);
      assert.equal(store.readBinding('cli_aaaaaaaaaaaaaaaa'), null);
      assert.equal(store.hasMessage({ appId: 'cli_aaaaaaaaaaaaaaaa', messageId: 'om_A' }), false);
      assert.equal(store.readBinding('cli_bbbbbbbbbbbbbbbb'), 'ou_owner_B');
      assert.equal(store.hasMessage({ appId: 'cli_bbbbbbbbbbbbbbbb', messageId: 'om_B' }), true);
    });

    await test('绑定按 appId 做 CAS，同 commitId 幂等且绝不明文落 actor', async () => {
      const file = path.join(tmp, 'binding', 'remote-state.json');
      const crypto = cryptoFixture();
      const store = openStore(file, crypto);
      const first = {
        appId: 'cli_cccccccccccccccc', actorId: 'ou_private_owner_A', commitId: 'c'.repeat(64)
      };
      assert.equal(store.commitBinding(first), first.commitId);
      assert.equal(store.commitBinding(first), first.commitId);
      assert.equal(store.readBinding('cli_cccccccccccccccc'), 'ou_private_owner_A');
      assert.throws(() => store.commitBinding({
        ...first, actorId: 'ou_attacker'
      }), assertCode('ERR_REMOTE_STORE_BINDING_CONFLICT'));
      assert.throws(() => store.commitBinding({
        ...first, commitId: 'd'.repeat(64)
      }), assertCode('ERR_REMOTE_STORE_BINDING_CONFLICT'));
      assert.equal(store.commitBinding({
        appId: 'cli_dddddddddddddddd', actorId: 'ou_private_owner_B', commitId: 'e'.repeat(64)
      }), 'e'.repeat(64));
      const raw = fs.readFileSync(file, 'utf8');
      assert.equal(raw.includes('ou_private_owner_A'), false);
      assert.equal(raw.includes('ou_private_owner_B'), false);
      assert.equal(raw.includes('ou_attacker'), false);
    });

    await test('message_id 只持久化哈希并按 appId 去重，重启后仍有效', async () => {
      const file = path.join(tmp, 'dedupe', 'remote-state.json');
      const crypto = cryptoFixture();
      const store = openStore(file, crypto);
      assert.equal(store.rememberMessage({ appId: 'cli_eeeeeeeeeeeeeeee', messageId: 'om_private_1' }), true);
      assert.equal(store.rememberMessage({ appId: 'cli_eeeeeeeeeeeeeeee', messageId: 'om_private_1' }), false);
      assert.equal(store.hasMessage({ appId: 'cli_eeeeeeeeeeeeeeee', messageId: 'om_private_1' }), true);
      assert.equal(store.hasMessage({ appId: 'cli_ffffffffffffffff', messageId: 'om_private_1' }), false);
      assert.equal(store.rememberMessage({ appId: 'cli_ffffffffffffffff', messageId: 'om_private_1' }), true);
      const raw = fs.readFileSync(file, 'utf8');
      assert.equal(raw.includes('om_private_1'), false);
      const persisted = JSON.parse(raw);
      const appAHash = persisted.apps.cli_eeeeeeeeeeeeeeee.messages[0];
      const appBHash = persisted.apps.cli_ffffffffffffffff.messages[0];
      assert.notEqual(appAHash, appBHash);

      const reopened = openStore(file, crypto);
      assert.equal(reopened.rememberMessage({
        appId: 'cli_eeeeeeeeeeeeeeee', messageId: 'om_private_1'
      }), false);
      assert.equal(reopened.rememberMessage({
        appId: 'cli_ffffffffffffffff', messageId: 'om_private_1'
      }), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`REMOTE SECURE STORE ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
