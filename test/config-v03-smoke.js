'use strict';

// v0.3 配置与自有窗口的独立静态 smoke；不接入公共 smoke，不需要 Electron。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const config = require('../lib/config');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

function read(relative) {
  try { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); }
  catch (_error) { return ''; }
}

function sorted(values) {
  return [...values].sort();
}

function ipcChannels(source, prefix) {
  const matches = source.matchAll(new RegExp(`["'](${prefix}:[a-z-]+)["']`, 'g'));
  return sorted(new Set([...matches].map((match) => match[1])));
}

function assertThrowsField(fn, field) {
  assert.throws(fn, (error) => error && error.code === 'INVALID_CONFIG' && error.field === field);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-v03-config-'));

try {
  test('config: dsh 包版本与 host 协议版本分开锁定', () => {
    assert(Object.isFrozen(config.DSH_CONTRACT));
    assert.deepStrictEqual(config.DSH_CONTRACT, {
      packageVersion: '0.1.1-rc.2',
      hostVersion: '0.0.1'
    });
    assert.strictEqual(config.DEFAULTS.dshVersion, config.DSH_CONTRACT.packageVersion);
    assert(!Object.prototype.hasOwnProperty.call(config.DEFAULTS, 'hostVersion'));
    assert(!config.SETTINGS_FIELDS.has('hostVersion'));
    assertThrowsField(() => config.validateSettingsPatch({ hostVersion: '0.0.1' }), 'hostVersion');
    const contractDir = path.join(tmp, 'contract');
    config.init(contractDir);
    const persisted = JSON.parse(fs.readFileSync(path.join(contractDir, 'config.json'), 'utf8'));
    assert(!Object.prototype.hasOwnProperty.call(persisted, 'hostVersion'));
  });

  test('config: 只把精确旧默认 rc.6 一次性迁移到 rc.2', () => {
    const migrationDir = path.join(tmp, 'dsh-default-migration');
    fs.mkdirSync(migrationDir, { recursive: true });
    const migrationFile = path.join(migrationDir, 'config.json');
    fs.writeFileSync(migrationFile, JSON.stringify({
      dshVersion: '0.1.0-rc.6',
      command: 'node custom-backend.js',
      port: 4314,
      checkUpdates: false
    }, null, 2) + '\n');

    const migrated = config.init(migrationDir);
    assert.strictEqual(migrated.dshVersion, '0.1.1-rc.2');
    assert.strictEqual(migrated.command, 'node custom-backend.js');
    assert.strictEqual(migrated.port, 4314);
    assert.strictEqual(migrated.checkUpdates, false);
    const persisted = JSON.parse(fs.readFileSync(migrationFile, 'utf8'));
    assert.deepStrictEqual(persisted, {
      dshVersion: '0.1.1-rc.2',
      command: 'node custom-backend.js',
      port: 4314,
      checkUpdates: false
    });

    for (const [label, stored, normalized] of [
      ['latest', 'latest', 'latest'],
      ['custom-version', '0.1.1-rc.1', '0.1.1-rc.1'],
      ['non-exact-old-default', ' 0.1.0-rc.6 ', '0.1.0-rc.6']
    ]) {
      const dir = path.join(tmp, `dsh-default-preserve-${label}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'config.json');
      const original = JSON.stringify({ dshVersion: stored, port: 4315 }, null, 2) + '\n';
      fs.writeFileSync(file, original);
      assert.strictEqual(config.init(dir).dshVersion, normalized, label);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), original, `${label} 不应重写`);
    }
  });

  test('config: v0.3 默认通知、预算与单价', () => {
    const value = config.init(tmp);
    assert.strictEqual(value.taskNotifications, true);
    assert.strictEqual(value.budgetEnabled, false);
    assert.strictEqual(value.dailyTokenBudget, 1_000_000);
    assert.strictEqual(value.priceInputPerMillion, 1);
    assert.strictEqual(value.priceCacheReadPerMillion, 0.02);
    assert.strictEqual(value.priceOutputPerMillion, 2);
  });

  test('config: 旧配置无损补齐 v0.3 默认值', () => {
    const oldDir = path.join(tmp, 'old');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'config.json'), JSON.stringify({
      port: 4312,
      hotkey: 'CommandOrControl+Shift+J',
      checkUpdates: false
    }));
    const value = config.init(oldDir);
    assert.strictEqual(value.port, 4312);
    assert.strictEqual(value.hotkey, 'CommandOrControl+Shift+J');
    assert.strictEqual(value.checkUpdates, false);
    assert.strictEqual(value.taskNotifications, true);
    assert.strictEqual(value.budgetEnabled, false);
    assert.strictEqual(value.dailyTokenBudget, 1_000_000);
    assert.strictEqual(value.priceCacheReadPerMillion, 0.02);
  });

  test('config: v0.6 工作台首次确认记忆跨重启持久化且不是设置项', () => {
    const oldDir = path.join(tmp, 'workbench-first-use-old');
    fs.mkdirSync(oldDir, { recursive: true });
    const oldFile = path.join(oldDir, 'config.json');
    const oldText = JSON.stringify({ port: 4313, workbenchId: null }, null, 2) + '\n';
    fs.writeFileSync(oldFile, oldText);
    const oldValue = config.init(oldDir);
    assert.deepStrictEqual(oldValue.workbenchOnboardingSeenIds, []);
    assert.deepStrictEqual(oldValue.workbenchHeavyConfirmedIds, []);
    assert.strictEqual(fs.readFileSync(oldFile, 'utf8'), oldText, '读旧配置时不顺手重写文件');

    const nfdId = 'user:Cafe\u0301组合名工作台';
    const heavyId = 'builtin:短视频创作台';
    config.set({
      workbenchOnboardingSeenIds: [nfdId, nfdId],
      workbenchHeavyConfirmedIds: [heavyId]
    });
    const reloaded = config.init(oldDir);
    assert.deepStrictEqual(reloaded.workbenchOnboardingSeenIds, [nfdId], '去重但不得改写 NFD id');
    assert.strictEqual(reloaded.workbenchOnboardingSeenIds[0], nfdId);
    assert.deepStrictEqual(reloaded.workbenchHeavyConfirmedIds, [heavyId]);
    const copy = config.get('workbenchOnboardingSeenIds');
    copy.push('user:不能污染内部值');
    assert.deepStrictEqual(config.get('workbenchOnboardingSeenIds'), [nfdId], 'get 必须深拷贝');

    for (const field of ['workbenchOnboardingSeenIds', 'workbenchHeavyConfirmedIds']) {
      assert(!config.SETTINGS_FIELDS.has(field), field);
      assertThrowsField(() => config.validateSettingsPatch({ [field]: [] }), field);
      assertThrowsField(() => config.set({ [field]: 'not-an-array' }), field);
      assertThrowsField(() => config.set({ [field]: ['user:../escape'] }), field);
      assertThrowsField(() => config.set({
        [field]: Array.from({ length: 65 }, (_, index) => `user:fixture-${index}`)
      }), field);
    }
  });

  test('config/settings: v0.10 只公开内容视图枚举，提示记忆保持内部', () => {
    const dir = path.join(tmp, 'v10-content-preferences');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 4316 }));
    const defaults = config.init(dir);
    assert.strictEqual(defaults.contentViewMode, 'content');
    assert.strictEqual(defaults.contentViewHintSeen, false);
    assert(config.SETTINGS_FIELDS.has('contentViewMode'));
    assert(!config.SETTINGS_FIELDS.has('contentViewHintSeen'));
    assert.deepStrictEqual(config.validateSettingsPatch({
      contentViewMode: 'sessions'
    }), { contentViewMode: 'sessions' });
    for (const value of ['', 'session', 'CONTENT', true, null]) {
      assertThrowsField(() => config.validateSettingsPatch({ contentViewMode: value }), 'contentViewMode');
    }
    assertThrowsField(() => config.validateSettingsPatch({
      contentViewHintSeen: true
    }), 'contentViewHintSeen');
    config.set({ contentViewHintSeen: true });
    assert.strictEqual(config.get('contentViewHintSeen'), true);

    const html = read('settings.html');
    assert(html.includes('id="contentViewMode"'));
    assert(html.includes('AI 工作台默认页'));
    assert(html.includes('<option value="content">创作文件</option>'));
    assert(html.includes('<option value="sessions">对话记录</option>'));
    assert(!html.includes('id="contentViewHintSeen"'));
    assert(html.includes("source.contentViewMode === 'sessions' ? 'sessions' : 'content'"));
    assert(html.includes("querySelectorAll('input, button, select')"));
  });

  test('config: 设置白名单包含六个 v0.3 字段', () => {
    const fields = [
      'taskNotifications', 'budgetEnabled', 'dailyTokenBudget',
      'priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion'
    ];
    for (const field of fields) assert(config.SETTINGS_FIELDS.has(field), field);
    assertThrowsField(() => config.validateSettingsPatch({ bounds: {} }), 'bounds');
  });

  test('config: 通知与预算开关只接受布尔值', () => {
    assertThrowsField(() => config.validateSettingsPatch({ taskNotifications: 1 }), 'taskNotifications');
    assertThrowsField(() => config.validateSettingsPatch({ budgetEnabled: 'true' }), 'budgetEnabled');
    assert.deepStrictEqual(config.validateSettingsPatch({
      taskNotifications: false,
      budgetEnabled: true
    }), { taskNotifications: false, budgetEnabled: true });
  });

  test('config: token 预算只接受 1–10 亿整数', () => {
    for (const value of [-1, 0, 0.5, Infinity, NaN, 1_000_000_001, '']) {
      assertThrowsField(() => config.validateSettingsPatch({ dailyTokenBudget: value }), 'dailyTokenBudget');
    }
    assert.strictEqual(config.validateSettingsPatch({ dailyTokenBudget: '2500000' }).dailyTokenBudget, 2_500_000);
    assert.strictEqual(config.validateSettingsPatch({ dailyTokenBudget: 1 }).dailyTokenBudget, 1);
  });

  test('config: 单价只接受 0–100 万的有限数值', () => {
    for (const field of ['priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion']) {
      for (const value of [-0.01, Infinity, NaN, 1_000_000.01, '']) {
        assertThrowsField(() => config.validateSettingsPatch({ [field]: value }), field);
      }
    }
    const normalized = config.validateSettingsPatch({
      priceInputPerMillion: '1.5',
      priceCacheReadPerMillion: 0,
      priceOutputPerMillion: 2.75
    });
    assert.deepStrictEqual(normalized, {
      priceInputPerMillion: 1.5,
      priceCacheReadPerMillion: 0,
      priceOutputPerMillion: 2.75
    });
  });

  test('settings: 六字段与真实边界文案已接入', () => {
    const html = read('settings.html');
    for (const id of [
      'taskNotifications', 'budgetEnabled', 'dailyTokenBudget',
      'priceInputPerMillion', 'priceCacheReadPerMillion', 'priceOutputPerMillion'
    ]) assert(html.includes(`id="${id}"`), id);
    for (const text of [
      'deepseek-v4-flash', '2026-08-15', '官网默认价，可修改',
      'dsh 已观测用量，非账单', '事后熔断', '无法追回'
    ]) assert(html.includes(text), text);
  });

  const htmlFiles = ['dashboard.html', 'notice.html', 'report-card.html'];
  const jsFiles = ['dashboard.js', 'notice.js', 'report-card.js'];
  const preloadFiles = ['preload-dashboard.js', 'preload-notice.js', 'preload-report.js'];

  test('windows: CSP、本地外部脚本与零远程资源', () => {
    for (const file of htmlFiles) {
      const html = read(file);
      assert(/http-equiv="Content-Security-Policy"/i.test(html), `${file}: CSP`);
      assert(/default-src 'none'/i.test(html), `${file}: default-src`);
      assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${file}: inline script`);
      assert(!/https?:\/\//i.test(html), `${file}: remote URL`);
      assert(!/\son[a-z]+\s*=/i.test(html), `${file}: inline event handler`);
    }
    assert(/<script src="dashboard\.js" defer><\/script>/i.test(read('dashboard.html')));
    assert(/<script src="notice\.js" defer><\/script>/i.test(read('notice.html')));
    assert(/<script src="report-card\.js" defer><\/script>/i.test(read('report-card.html')));
  });

  test('windows: 渲染只写 textContent，不执行不可信 HTML', () => {
    for (const file of jsFiles) {
      const source = read(file);
      assert(source.includes('textContent'), `${file}: textContent`);
      assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/i.test(source), file);
    }
  });

  test('dashboard: 状态、覆盖、用量、费用、匿名任务与预算齐全', () => {
    const html = read('dashboard.html');
    const js = read('dashboard.js');
    for (const id of [
      'availability', 'coverage', 'today-tokens', 'week-tokens', 'today-cost',
      'recent-tasks', 'budget-state', 'budget-progress', 'resume-budget', 'export-report'
    ]) assert(html.includes(`id="${id}"`), id);
    assert(html.includes('dsh 已观测用量，非账单'));
    assert(html.includes('匿名最近任务'));
    assert(js.includes('已达预算，外部服务仍在运行'));
    assert(js.includes('鲸坞不会停止外部服务'));
    assert(js.includes('允许今日后续托管启动'));
    assert(js.includes('budget.resumeAvailable === true'));
  });

  test('preload: API 冻结且只暴露固定 IPC 通道', () => {
    const dashboard = read('preload-dashboard.js');
    const notice = read('preload-notice.js');
    const report = read('preload-report.js');
    for (const [file, source] of [
      ['preload-dashboard.js', dashboard], ['preload-notice.js', notice], ['preload-report.js', report]
    ]) {
      assert(source.includes('Object.freeze'), `${file}: frozen API`);
      assert(!/\binvoke\s*:\s*|send\s*:\s*|on\s*:\s*/.test(source), `${file}: generic bridge`);
    }
    assert.deepStrictEqual(ipcChannels(dashboard, 'dashboard'), sorted([
      'dashboard:get', 'dashboard:state', 'dashboard:resume-budget',
      'dashboard:export-report', 'dashboard:show-main'
    ]));
    assert.deepStrictEqual(ipcChannels(notice, 'notice'), sorted([
      'notice:show', 'notice:activate', 'notice:dismiss'
    ]));
    assert.deepStrictEqual(ipcChannels(report, 'report'), sorted([
      'report:render', 'report:ready'
    ]));
  });

  test('report: 固定 1080×1440、深浅主题、免责声明与 ready 回执', () => {
    const html = read('report-card.html');
    const js = read('report-card.js');
    const preload = read('preload-report.js');
    assert(/width:\s*1080px/.test(html));
    assert(/height:\s*1440px/.test(html));
    assert(html.includes('data-theme="dark"'));
    assert(html.includes('dsh 已观测用量，非账单'));
    assert(html.includes('--subtle: #94a3b8'));
    assert(/data-theme="light"[\s\S]*--subtle:\s*#6b7280/.test(html));
    assert(js.includes("new Set(['dark', 'light'])"));
    assert(js.includes('api.ready'));
    assert(preload.includes("'report:ready'"));
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
