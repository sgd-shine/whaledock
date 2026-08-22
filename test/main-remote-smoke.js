'use strict';

// v0.7 远程板块 Electron 薄层：纯 Node 检查配置、设置窄桥、生命周期与安全文案。
// 平台协议与回环行为由 remote-smoke.js 覆盖，这里只钉主进程不能长出通用命令后门。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  main-remote: ${name}`);
  } catch (error) {
    console.error(`FAIL  main-remote: ${name}`);
    throw error;
  }
}

async function run() {
  await test('升级默认零联网且客服内容没有可放宽的 IM 开关', async () => {
    const configPath = path.join(ROOT, 'lib', 'config.js');
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-remote-config-'));
    const value = config.init(dir);
    assert.equal(value.remoteFeishuEnabled, false);
    assert.equal(value.remoteDingtalkEnabled, false);
    assert.equal(value.remoteWebEnabled, false);
    assert.equal(value.remoteImApprovals, true);
    assert.equal(value.remoteImTaskCompletions, true);
    assert.equal(value.remoteImReports, true);
    assert.equal(Object.hasOwn(value, 'remoteImCustomerService'), false);
    assert.throws(() => config.validateSettingsPatch({ remoteImCustomerService: true }), /不允许修改/);
    assert.throws(() => config.validateSettingsPatch({ remoteAppSecret: '不应进入配置' }), /不允许修改/);
  });

  await test('远程设置页含三通道、真实状态灯、内容分级与一键断开', async () => {
    const html = source('settings.html');
    for (const token of [
      'tab-remote', 'panel-remote', 'remoteFeishuEnabled', 'remoteDingtalkEnabled',
      'remoteWebEnabled', 'remoteImApprovals', 'remoteImTaskCompletions',
      'remoteImReports', 'remote-disconnect-all'
    ]) assert.match(html, new RegExp(`id="${token}"`));
    assert.match(html, /状态以真实连接为准/);
    assert.match(html, /固定禁止走飞书\/钉钉/);
    assert.match(html, /此安全边界不可在设置里放宽/);
    assert.equal(html.includes('id="remoteImCustomerService"'), false);
    assert.match(html, /不经过第三方服务器/);
  });

  await test('设置页内置面向所有用户的图文三步向导，Wi-Fi 默认且 Tailscale 仅可选', async () => {
    const html = source('settings.html');
    for (const id of ['remote-guide-feishu', 'remote-guide-dingtalk', 'remote-guide-web']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /这是给每位鲸坞用户的自助向导/);
    assert.match(html, /鲸坞官方永远不经手任何用户凭据/);
    assert.match(html, /同一 Wi-Fi 默认可用/);
    assert.match(html, /无需安装其他 App/);
    assert.match(html, /可选：Tailscale/);
    assert.match(html, /注册、登录和设备授权必须由你本人/);
    assert.equal((html.match(/<ol class="remote-guide-steps">/g) || []).length, 3);
    assert.equal((html.match(/<li class="remote-guide-step">/g) || []).length, 9);
    assert.equal(html.includes('<div class="remote-guide-step">'), false);
    assert.ok((html.match(/<svg/g) || []).length >= 10);
    assert.equal(/SGD|第一个用户/.test(html.slice(html.indexOf('id="panel-remote"'), html.indexOf('id="panel-look"'))), false);
  });

  await test('远程状态用单一 live note 播报，故障只显示固定中文且断开文案不做绝对承诺', async () => {
    const html = source('settings.html');
    const panel = html.slice(html.indexOf('id="panel-remote"'), html.indexOf('id="panel-look"'));
    assert.equal((panel.match(/class="row-note" role="status" aria-live="polite" aria-atomic="true"/g) || []).length, 3);
    assert.equal((panel.match(/class="remote-state" data-state="disabled" aria-hidden="true"/g) || []).length, 3);
    assert.equal(/不会留下后台残连接|不留下后台连接/.test(panel), false);
    assert.match(panel, /若有通道未确认，会提示你退出鲸坞彻底结束/);
    assert.match(panel, /未确认时会明确提示/);
    assert.match(html, /#panel-remote \.switch \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
    assert.match(html, /\.remote-guide-step p \{[^}]*font-size: 11px;/);

    const render = html.slice(
      html.indexOf('const remoteStateText = Object.freeze('),
      html.indexOf('function fillSelect(')
    );
    assert.match(render, /const remoteReasonText = Object\.freeze\(/);
    assert.match(render, /'disconnect-failed': '未确认断开，请退出鲸坞彻底结束'/);
    assert.match(render, /unknownRemoteReasonText = '通道暂不可用，请回桌面检查'/);
    assert.match(render, /Object\.prototype\.hasOwnProperty\.call\(remoteReasonText, reasonCode\)/);
    assert.match(render, /if \(noteElement\.textContent !== nextNote\) noteElement\.textContent = nextNote/);
    assert.equal(/textContent\s*=\s*channel\.reasonCode|\$\{channel\.reasonCode\}/.test(render), false);
  });

  await test('设置 preload 只暴露固定飞书凭据、自检与断开动作，没有通用 IPC', async () => {
    const preload = source('preload-settings.js');
    assert.match(preload, /disconnectRemote: \(\) => ipcRenderer\.invoke\('settings:remote-disconnect-all'\)/);
    assert.match(preload, /saveFeishuCredentials: \(value\) => ipcRenderer\.invoke\('settings:remote-feishu-credentials-save', value\)/);
    assert.match(preload, /clearFeishuCredentials: \(\) => ipcRenderer\.invoke\('settings:remote-feishu-credentials-clear'\)/);
    assert.match(preload, /testFeishuNotification: \(\) => ipcRenderer\.invoke\('settings:remote-feishu-test-notification'\)/);
    assert.match(preload, /onRuntime: \(callback\)/);
    assert.match(preload, /ipcRenderer\.on\('settings:runtime', listener\)/);
    assert.match(preload, /ipcRenderer\.removeListener\('settings:runtime', listener\)/);
    const remoteChannels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']*remote[^']*)'/g)]
      .map((match) => match[1]);
    assert.deepEqual(remoteChannels, [
      'settings:remote-feishu-credentials-save',
      'settings:remote-feishu-credentials-clear',
      'settings:remote-feishu-test-notification',
      'settings:remote-disconnect-all'
    ]);
    assert.equal(/remoteChannel|channelId|command|execute/.test(preload), false);
    assert.equal(/require\(['"](?:fs|child_process|http|https|net)['"]\)/.test(preload), false);
  });

  await test('飞书凭据使用独立只写表单，Secret 不进入通用设置快照或回填', async () => {
    const html = source('settings.html');
    for (const id of [
      'feishu-app-id', 'feishu-app-secret', 'feishu-credential-status',
      'feishu-credentials-save', 'feishu-credentials-clear', 'feishu-test-notification'
    ]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, /id="feishu-app-secret"[^>]*type="password"[^>]*autocomplete="new-password"/);
    const fields = html.slice(html.indexOf('const fieldNames = ['), html.indexOf('const booleanFields'));
    assert.equal(/feishu-app|appSecret|AppSecret/.test(fields), false);
    assert.match(html, /feishuEls\.appSecret\.value = ''/);
    const save = html.slice(
      html.indexOf('async function saveFeishuCredentials()'),
      html.indexOf('async function clearFeishuCredentials()')
    );
    const invokeAt = save.indexOf('api.saveFeishuCredentials');
    const clearAt = save.indexOf("feishuEls.appSecret.value = ''");
    const awaitAt = save.indexOf('const result = await pending');
    const readbackAt = save.indexOf('if (result && result.settings)');
    const failureAt = save.indexOf('if (responseFailed(result))');
    assert.ok(invokeAt >= 0 && invokeAt < clearAt && clearAt < awaitAt);
    assert.ok(awaitAt < readbackAt && readbackAt < failureAt);
    assert.match(html, /鲸坞官方永远不经手任何用户凭据/);
    assert.match(html, /im\.message\.receive_v1/);
    assert.match(html, /im:message\.p2p_msg:readonly/);
    assert.match(html, /im:message:send_as_bot/);
  });

  await test('状态灯订阅脱敏 runtime，全部断开失败也先应用磁盘与运行态回读', async () => {
    const html = source('settings.html');
    assert.match(html, /api\.onRuntime\(\(payload\) =>/);
    assert.match(html, /renderRemoteRuntime\(remoteValue\)/);
    assert.match(html, /beforeunload/);
    const disconnect = html.slice(
      html.indexOf('async function disconnectRemote()'),
      html.indexOf('function activateTab(')
    );
    const renderSettingsAt = disconnect.indexOf('snapshot = normalizedConfig(result.settings)');
    const renderRuntimeAt = disconnect.indexOf('renderRemoteRuntime(result.remote)');
    const failureAt = disconnect.indexOf('if (responseFailed(result))');
    assert.ok(renderSettingsAt > 0 && renderSettingsAt < failureAt);
    assert.ok(renderRuntimeAt > 0 && renderRuntimeAt < failureAt);
  });

  await test('主进程只在受信设置 IPC 中暴露全部断开并回读脱敏快照', async () => {
    const main = source('main.js');
    const block = main.slice(main.indexOf('function registerSettingsIpc()'), main.indexOf('function openSettingsWindow()'));
    assert.match(block, /'settings:remote-disconnect-all'/);
    assert.match(block, /ipcMain\.handle\('settings:remote-disconnect-all', trustedSettingsHandler/);
    assert.match(block, /disconnectAllRemote/);
    assert.match(main, /remote: remoteRuntimeSnapshot\(\)/);
    assert.equal(/ipcMain\.(?:handle|on)\('remote:[^']*(?:command|exec|rpc)/.test(main), false);
  });

  await test('主进程凭据接线使用 safeStorage 且 SDK 只在 connect 路径惰性 require', async () => {
    const main = source('main.js');
    assert.match(main, /safeStorage/);
    assert.match(main, /remote-secure-state\.json/);
    assert.equal(/const\s+\w+\s*=\s*require\(['"]@larksuiteoapi\/node-sdk['"]\)/.test(main), false);
    assert.match(main, /sdkLoader:\s*\(\)\s*=>\s*require\(['"]@larksuiteoapi\/node-sdk['"]\)/);
    const block = main.slice(main.indexOf('function registerSettingsIpc()'), main.indexOf('function openSettingsWindow()'));
    for (const channel of [
      'settings:remote-feishu-credentials-save',
      'settings:remote-feishu-credentials-clear',
      'settings:remote-feishu-test-notification'
    ]) assert.match(block, new RegExp(channel));
    assert.equal(/log\.line\([^\n]*(?:appSecret|credentials\.appSecret)/.test(main), false);
    const settingsWindow = main.slice(main.indexOf('function openSettingsWindow()'), main.indexOf('// ---------- 更新检查'));
    assert.match(settingsWindow, /contextIsolation:\s*true/);
    assert.match(settingsWindow, /nodeIntegration:\s*false/);
    assert.match(settingsWindow, /sandbox:\s*true/);
  });

  await test('远程生命周期从启动同步到退出，退出要等待 close 真正落定', async () => {
    const main = source('main.js');
    const ready = main.slice(main.indexOf('async function onReady()'), main.indexOf('function registerPetIpc()'));
    assert.match(ready, /initRemoteService\(\)/);
    assert.match(ready, /await syncRemoteConfig\(config\.get\(\)\)/);
    assert.ok(ready.indexOf('initializeWorkspaceCoordinator()') < ready.indexOf('await recoverWorkspaceAtStartup()'));
    assert.ok(ready.indexOf('await recoverWorkspaceAtStartup()') < ready.indexOf('initRemoteService()'));
    assert.ok(ready.indexOf('initRemoteService()') < ready.indexOf('await syncRemoteConfig(config.get())'));
    const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("app.on('will-quit'"));
    assert.match(beforeQuit, /beginRemoteShutdown\(\)/);
    assert.match(main, /remoteShutdownRequested = true/);
    assert.match(main, /if \(remoteShutdownRequested\) \{[\s\S]*?ERR_REMOTE_CLOSED/);
    const willQuit = main.slice(main.indexOf("app.on('will-quit'"), main.indexOf('if \(MAIN_HELPER_TEST\)'));
    assert.match(willQuit, /remoteShutdownPromise/);
  });

  await test('飞书断线仅在开关与凭据仍有效时做有限退避重连', async () => {
    const main = source('main.js');
    assert.match(main, /REMOTE_FEISHU_RECONNECT_DELAYS_MS = Object\.freeze\(\[1000, 2000, 5000, 15000, 30000\]\)/);
    const reconnect = main.slice(
      main.indexOf('function clearRemoteReconnect('),
      main.indexOf('function queueFeishuBindingDialog(')
    );
    assert.match(reconnect, /remoteShutdownRequested/);
    assert.match(reconnect, /remoteFeishuEnabled/);
    assert.match(reconnect, /activeFeishuAppId\(\)/);
    assert.match(reconnect, /remoteReconnectAttempt >= REMOTE_FEISHU_RECONNECT_DELAYS_MS\.length/);
    assert.match(reconnect, /owner\.setEnabled\('feishu', true\)/);
    const service = main.slice(main.indexOf('function initRemoteService()'), main.indexOf('async function replaceRemoteService('));
    assert.match(service, /onStateChanged:[\s\S]*?scheduleRemoteReconnect\(service, service\.snapshot\(\)\)/);
    assert.match(main, /function beginRemoteShutdown\([\s\S]*?clearRemoteReconnect\(\)/);
  });

  await test('飞书收件只写恢复后的权威工作区，并按 App 命名空间幂等', async () => {
    const main = source('main.js');
    const receive = main.slice(
      main.indexOf('function receiveRemoteItem('),
      main.indexOf('function clearRemoteReconnect(')
    );
    assert.match(receive, /workspaceCoordinator\.busy/);
    assert.match(receive, /workspaceJournalBlocksStartup\(\)/);
    assert.match(receive, /workspaceCoordinator\.snapshot\(\)/);
    assert.match(receive, /canonicalWorkspace\(committed\.effectiveWorkdir,[\s\S]*?forbiddenRoots:\s*forbiddenWorkspaceRoots\(\)/);
    assert.match(receive, /\.receive\(\{\s*appId,/);
    const service = main.slice(main.indexOf('function initRemoteService()'), main.indexOf('async function replaceRemoteService('));
    assert.match(service, /receiveRemoteItem\(value, appId\)/);
  });

  await test('固定本机自检可穿过客服工作台，但真实客服内容仍由受信分级锁住', async () => {
    const main = source('main.js');
    assert.match(main, /REMOTE_LOCAL_SELF_TEST_CONTEXT = Object\.freeze\(\{\}\)/);
    assert.match(main, /request\.classificationContext === REMOTE_LOCAL_SELF_TEST_CONTEXT[\s\S]*?\? 'anonymous' : remoteContentSensitivity\(\)/);
    const handler = main.slice(
      main.indexOf("ipcMain.handle('settings:remote-feishu-test-notification'"),
      main.indexOf("ipcMain.handle('settings:remote-disconnect-all'")
    );
    assert.match(handler, /classificationContext:\s*REMOTE_LOCAL_SELF_TEST_CONTEXT/);
    assert.match(handler, /customer-web-only/);
    assert.match(handler, /result\.skipped\[0\].*reasonCode/);
  });

  await test('飞书保存与清除共用串行重配临界区，失败文案按权威开关回读', async () => {
    const main = source('main.js');
    const block = main.slice(main.indexOf('function registerSettingsIpc()'), main.indexOf('function openSettingsWindow()'));
    const save = block.slice(
      block.indexOf("ipcMain.handle('settings:remote-feishu-credentials-save'"),
      block.indexOf("ipcMain.handle('settings:remote-feishu-credentials-clear'")
    );
    const clear = block.slice(
      block.indexOf("ipcMain.handle('settings:remote-feishu-credentials-clear'"),
      block.indexOf("ipcMain.handle('settings:remote-feishu-test-notification'")
    );
    assert.match(save, /reconfigureRemoteService\(async \(\) => \{[\s\S]*?rotateCredentials[\s\S]*?remoteFeishuEnabled:\s*true/);
    assert.match(clear, /reconfigureRemoteService\(async \(\) => \{[\s\S]*?remoteFeishuEnabled:\s*false[\s\S]*?clearCredentials\(\)/);
    assert.equal(clear.indexOf('config.set(') < clear.indexOf('reconfigureRemoteService('), false);
    assert.match(clear, /settings\.remoteFeishuEnabled === false/);
  });

  await test('日志接线只接收固定审计字段，不记录正文、账号、凭据或原始异常', async () => {
    const main = source('main.js');
    const block = main.slice(
      main.indexOf('function remoteAuditEvent('),
      main.indexOf('function remoteMainError(')
    );
    assert.ok(block.length > 100, '缺少远程审计收口');
    assert.match(block, /event\.event/);
    assert.match(block, /event\.channelId/);
    assert.match(block, /event\.count/);
    assert.match(block, /event\.reasonCode/);
    assert.equal(/message|content|text|openid|userId|secret|stack|error\.message/.test(block), false);
  });

  await test('工作台包与远程配置彼此独立，构建仍由 lib 通配符收录', async () => {
    const packageJson = JSON.parse(source('package.json'));
    assert.ok(packageJson.build.files.includes('lib/**/*'));
    assert.deepStrictEqual(packageJson.dependencies || {}, {
      '@larksuiteoapi/node-sdk': '1.73.0'
    });
    assert.equal(source('lib/workbenches.js').includes('remoteFeishuEnabled'), false);
    assert.equal(source('assets/workbenches/短视频创作台/manifest.json').includes('remote'), false);
  });

  console.log(`\nMAIN REMOTE ALL PASS (${passed})`);
}

run().catch((error) => {
  console.error('MAIN REMOTE FAIL:', error);
  process.exit(1);
});
