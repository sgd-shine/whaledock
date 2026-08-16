'use strict';

// v0.5 宠物包与主题包直测：纯 Node，不需要 Electron，也不读取用户真实目录。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pets = require('../lib/pets');
const themes = require('../lib/themes');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  pets/themes: ${name}`);
  } catch (error) {
    console.error(`FAIL  pets/themes: ${name}`);
    throw error;
  }
}

function pngBytes(width = 32, height = 32) {
  const value = Buffer.alloc(64);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(value, 0);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  value[24] = 8;
  value[25] = 6;
  return value;
}

function writePackage(root, id, files) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), value);
  }
  return dir;
}

function frameNames(result, state) {
  return (result.package.states[state] || []).map((item) => path.basename(item));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-pets-themes-'));
  const petsRoot = path.join(tmp, 'pets');
  const themesRoot = path.join(tmp, 'themes');
  fs.mkdirSync(petsRoot);
  fs.mkdirSync(themesRoot);

  await test('manifest 全字段合法时逐字段解析，未知字段忽略', async () => {
    const parsed = pets.parseManifest(JSON.stringify({
      name: '像素鲸鱼', author: 'SGD', license: 'MIT',
      frameRate: 8, size: { width: 96, height: 64 }, anchor: 'top-left',
      states: { idle: ['idle-1.png', 'idle-2.png'], busy: ['busy.png'] },
      onLoad: 'require("fs")', script: 'evil.js'
    }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.manifest.name, '像素鲸鱼');
    assert.equal(parsed.manifest.author, 'SGD');
    assert.equal(parsed.manifest.frameRate, 8);
    assert.equal(parsed.manifest.width, 96);
    assert.equal(parsed.manifest.height, 64);
    assert.equal(parsed.manifest.anchor, 'top-left');
    assert.deepEqual(parsed.manifest.states.idle, ['idle-1.png', 'idle-2.png']);
    assert.equal('onLoad' in parsed.manifest, false);
    assert.equal('script' in parsed.manifest, false);
  });

  await test('manifest 越界字段收敛为默认值而不是抛错', async () => {
    const parsed = pets.parseManifest({
      frameRate: 999, size: { width: 4, height: 99999 }, anchor: 'center',
      name: 'x'.repeat(200), states: { idle: 'not-an-array', busy: ['a.js', '../escape.png'] }
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.manifest.frameRate, pets.DEFAULTS.frameRate);
    assert.equal(parsed.manifest.width, pets.DEFAULTS.width);
    assert.equal(parsed.manifest.height, pets.DEFAULTS.height);
    assert.equal(parsed.manifest.anchor, pets.DEFAULTS.anchor);
    assert.equal(parsed.manifest.name.length, pets.LIMITS.maxNameChars);
    assert.deepEqual(parsed.manifest.states, {});
  });

  await test('坏 JSON 与非对象 manifest 报明确原因，不抛异常', async () => {
    assert.equal(pets.parseManifest('{bad').reason, 'invalid-json');
    assert.equal(pets.parseManifest('[1,2]').reason, 'not-an-object');
    assert.equal(pets.parseManifest('"x"').reason, 'not-an-object');
    assert.equal(pets.parseManifest(undefined).ok, true);
  });

  await test('单图宠物：一张 PNG 即五态可用', async () => {
    const dir = writePackage(petsRoot, '单图鲸鱼', { 'whale.png': pngBytes() });
    const result = pets.readPetPackage({ dir, id: '单图鲸鱼' });
    assert.equal(result.ok, true);
    assert.equal(result.package.singleImage, true);
    assert.equal(result.package.name, '单图鲸鱼');
    for (const state of pets.PET_STATES) {
      const frames = pets.petFrames(result.package, state);
      assert.equal(frames.frames.length, 1);
      assert.equal(path.basename(frames.frames[0]), 'whale.png');
      assert.equal(frames.state, 'idle');
    }
  });

  await test('无 manifest 多图按状态前缀分组，缺失态回落 idle', async () => {
    const dir = writePackage(petsRoot, '前缀宠物', {
      'idle-1.png': pngBytes(), 'idle-2.png': pngBytes(),
      'busy-1.png': pngBytes(), 'error.png': pngBytes()
    });
    const result = pets.readPetPackage({ dir, id: '前缀宠物' });
    assert.deepEqual(frameNames(result, 'idle'), ['idle-1.png', 'idle-2.png']);
    assert.deepEqual(frameNames(result, 'busy'), ['busy-1.png']);
    assert.deepEqual(frameNames(result, 'error'), ['error.png']);
    assert.equal(result.package.states.waiting, undefined);
    const waiting = pets.petFrames(result.package, 'waiting');
    assert.equal(waiting.state, 'idle');
    assert.equal(waiting.requested, 'waiting');
    assert.deepEqual(waiting.frames.map((item) => path.basename(item)),
      ['idle-1.png', 'idle-2.png']);
  });

  await test('无 manifest 且文件名无法辨识时全部进 idle 逐帧', async () => {
    const dir = writePackage(petsRoot, '无前缀宠物', {
      'b.png': pngBytes(), 'a.png': pngBytes(), 'c.png': pngBytes()
    });
    const result = pets.readPetPackage({ dir, id: '无前缀宠物' });
    assert.deepEqual(frameNames(result, 'idle'), ['a.png', 'b.png', 'c.png']);
    assert.equal(result.package.singleImage, false);
  });

  await test('manifest 引用不存在/非法的帧被丢弃并记录原因', async () => {
    const dir = writePackage(petsRoot, '缺帧宠物', {
      'idle.png': pngBytes(),
      'manifest.json': JSON.stringify({
        states: { idle: ['idle.png', 'missing.png'], busy: ['gone.png'] }
      })
    });
    const result = pets.readPetPackage({ dir, id: '缺帧宠物' });
    assert.deepEqual(frameNames(result, 'idle'), ['idle.png']);
    assert.equal(result.package.states.busy, undefined);
    assert.equal(result.package.issues.some((item) => item.reason === 'missing-file'), true);
  });

  await test('坏 manifest 不废掉整包，退回目录扫描', async () => {
    const dir = writePackage(petsRoot, '坏manifest宠物', {
      'idle.png': pngBytes(), 'manifest.json': '{不是 JSON'
    });
    const result = pets.readPetPackage({ dir, id: '坏manifest宠物' });
    assert.equal(result.ok, true);
    assert.deepEqual(frameNames(result, 'idle'), ['idle.png']);
    assert.equal(result.package.issues.some((item) => item.reason === 'invalid-json'), true);
  });

  await test('非 PNG、伪 PNG 与超尺寸图被跳过；无可用帧的包整体跳过', async () => {
    const fake = Buffer.alloc(64, 0x41);
    const huge = pngBytes(4096, 4096);
    const dir = writePackage(petsRoot, '坏图宠物', {
      'evil.js.png': fake, 'huge.png': huge, 'ok.png': pngBytes()
    });
    const result = pets.readPetPackage({ dir, id: '坏图宠物' });
    assert.deepEqual(frameNames(result, 'idle'), ['ok.png']);
    assert.equal(result.package.issues.some((item) => item.reason === 'not-a-png'), true);
    assert.equal(result.package.issues.some(
      (item) => item.reason === 'dimensions-out-of-range'
    ), true);

    const emptyDir = writePackage(petsRoot, '空宠物', { 'readme.txt': 'nothing' });
    const empty = pets.readPetPackage({ dir: emptyDir, id: '空宠物' });
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, 'no-png');
  });

  await test('包内 symlink 越界的帧被拒绝，且不影响同包其他帧', async () => {
    const outside = path.join(tmp, 'outside-frame.png');
    fs.writeFileSync(outside, pngBytes());
    const dir = writePackage(petsRoot, '越界宠物', { 'ok.png': pngBytes() });
    fs.symlinkSync(outside, path.join(dir, 'link.png'),
      process.platform === 'win32' ? 'file' : 'file');
    const result = pets.readPetPackage({ dir, id: '越界宠物' });
    assert.deepEqual(frameNames(result, 'idle'), ['ok.png']);
    assert.equal(result.package.issues.some(
      (item) => item.frame === 'link.png' && item.reason !== undefined
    ), true);
  });

  await test('扫描：坏包只跳过自己，好包照常返回并带来源', async () => {
    const listed = pets.listPetPackages({
      roots: [{ dir: petsRoot, source: 'user' }, { dir: path.join(tmp, 'missing-root') }]
    });
    const ids = listed.packages.map((item) => item.id).sort();
    assert.equal(ids.includes('user:单图鲸鱼'), true);
    assert.equal(ids.includes('user:前缀宠物'), true);
    assert.equal(ids.includes('user:空宠物'), false);
    assert.equal(listed.skipped.some((item) => item.id === 'user:空宠物'), true);
    // 目录不存在是正常状态，不算跳过。
    assert.equal(listed.skipped.some((item) => item.id.includes('missing-root')), false);
    assert.equal(listed.packages.every((item) => item.source === 'user'), true);
    assert.equal(pets.selectPetPackage(listed.packages, 'user:前缀宠物').id, 'user:前缀宠物');
    assert.equal(pets.selectPetPackage(listed.packages, 'user:不存在').id, listed.packages[0].id);
    assert.equal(pets.selectPetPackage([], 'x'), null);
  });

  await test('宠物模块不 require electron，也不执行包内内容', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pets.js'), 'utf8');
    assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(source), false);
    assert.equal(/\beval\s*\(/.test(source), false);
    assert.equal(/new\s+Function\s*\(/.test(source), false);
    assert.equal(/child_process/.test(source), false);
  });

  await test('主题：合法 JSON 解析，短色值展开，未知键忽略', async () => {
    const parsed = themes.parseTheme(JSON.stringify({
      name: '极光', author: 'SGD', base: 'dark',
      colors: {
        background: '#071021', surface: '#0F1B30', border: '#1e3350',
        primary: '#4f46e5', accent: '#0cf', text: '#e6edf7', textMuted: '#93a4bd'
      },
      script: 'alert(1)'
    }), { id: 'aurora' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.theme.name, '极光');
    assert.equal(parsed.theme.base, 'dark');
    assert.equal(parsed.theme.colors.surface, '#0f1b30');
    assert.equal(parsed.theme.colors.accent, '#00ccff');
    assert.equal('script' in parsed.theme, false);
  });

  await test('主题：缺色回落同基调内置值，非法色值不采纳', async () => {
    const parsed = themes.parseTheme({
      base: 'light', colors: { primary: '#123456', accent: 'red', text: 42 }
    }, { id: 'partial' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.theme.colors.primary, '#123456');
    assert.equal(parsed.theme.colors.accent, themes.FALLBACK_COLORS.light.accent);
    assert.equal(parsed.theme.colors.text, themes.FALLBACK_COLORS.light.text);
    assert.equal(parsed.theme.colors.background, themes.FALLBACK_COLORS.light.background);
  });

  await test('主题：坏 JSON、非对象、全非法色值与坏 id 都给出原因', async () => {
    assert.equal(themes.parseTheme('{bad', { id: 'x' }).reason, 'invalid-json');
    assert.equal(themes.parseTheme('[1]', { id: 'x' }).reason, 'not-an-object');
    assert.equal(themes.parseTheme({ colors: { primary: 'nope' } }, { id: 'x' }).reason,
      'no-valid-colors');
    assert.equal(themes.parseTheme({ colors: { primary: '#fff' } }, { id: '../evil' }).reason,
      'invalid-id');
    assert.equal(themes.parseTheme({ base: 'neon', colors: { primary: '#fff' } },
      { id: 'x' }).theme.base, 'dark');
  });

  await test('主题扫描：坏文件跳过，好文件保留，非 json 忽略', async () => {
    fs.writeFileSync(path.join(themesRoot, 'good.json'), JSON.stringify({
      name: '墨鲸', base: 'dark', colors: { background: '#05070c', primary: '#4f46e5' }
    }));
    fs.writeFileSync(path.join(themesRoot, 'broken.json'), '{oops');
    fs.writeFileSync(path.join(themesRoot, 'notes.txt'), 'ignored');
    const listed = themes.listThemes({ roots: [{ dir: themesRoot, source: 'user' }] });
    assert.deepEqual(listed.themes.map((item) => item.id), ['good']);
    assert.equal(listed.themes[0].name, '墨鲸');
    assert.equal(listed.skipped.some((item) => item.id === 'broken'), true);
    assert.equal(listed.skipped.some((item) => item.id === 'notes'), false);
  });

  await test('主题选择与 CSS 变量：缺主题回落内置深色', async () => {
    const listed = themes.listThemes({ roots: [{ dir: themesRoot, source: 'user' }] });
    assert.equal(themes.selectTheme(listed.themes, 'good').id, 'good');
    assert.equal(themes.selectTheme([], 'good').id, themes.DEFAULT_THEME_ID);
    const vars = themes.cssVariables(themes.builtinFallbackTheme('dark'));
    assert.equal(vars['--wd-base'], 'dark');
    assert.equal(vars['--wd-background'], themes.FALLBACK_COLORS.dark.background);
    assert.equal(vars['--wd-text-muted'], themes.FALLBACK_COLORS.dark.textMuted);
    assert.equal(Object.keys(vars).length, themes.COLOR_KEYS.length + 1);
  });

  await test('五态推导：瞬时态优先于等待，等待优先于干活', async () => {
    const events = require('../lib/events');
    const base = {
      availability: { state: 'live' },
      waiting: { approvals: 0, questions: 0 },
      activity: { openTurns: 0, openSessions: 0 }
    };
    const at = 1_000_000;
    assert.equal(events.derivePetState({ snapshot: base, now: at }), 'idle');
    assert.equal(events.derivePetState({
      snapshot: { ...base, activity: { openTurns: 2, openSessions: 1 } }, now: at
    }), 'busy');
    assert.equal(events.derivePetState({
      snapshot: {
        ...base,
        waiting: { approvals: 1, questions: 0 },
        activity: { openTurns: 3, openSessions: 1 }
      },
      now: at
    }), 'waiting');
    assert.equal(events.derivePetState({
      snapshot: { ...base, waiting: { approvals: 1, questions: 2 } },
      transient: { kind: 'celebrate', until: at + 1 },
      now: at
    }), 'celebrate');
    assert.equal(events.derivePetState({
      snapshot: base, transient: { kind: 'error', until: at + 1 }, now: at
    }), 'error');
  });

  await test('五态推导：瞬时态过期与事件层不可用都回落 idle', async () => {
    const events = require('../lib/events');
    const snapshot = {
      availability: { state: 'live' },
      waiting: { approvals: 0, questions: 0 },
      activity: { openTurns: 0, openSessions: 0 }
    };
    const at = 2_000_000;
    assert.equal(events.derivePetState({
      snapshot, transient: { kind: 'celebrate', until: at }, now: at
    }), 'idle');
    assert.equal(events.derivePetState({
      snapshot, transient: { kind: 'busy', until: at + 999 }, now: at
    }), 'idle');
    assert.equal(events.derivePetState({
      snapshot: {
        ...snapshot,
        availability: { state: 'unavailable' },
        waiting: { approvals: 5, questions: 5 },
        activity: { openTurns: 5, openSessions: 5 }
      },
      transient: { kind: 'error', until: at + 999 },
      now: at
    }), 'idle');
    assert.equal(events.derivePetState({ snapshot: null, now: at }), 'idle');
    assert.equal(events.derivePetState({}), 'idle');
  });

  await test('终态到瞬时态的翻译只认已知结果', async () => {
    const events = require('../lib/events');
    assert.deepEqual(events.petTransientFor('completed', 100, 2500),
      { kind: 'celebrate', until: 2600 });
    assert.deepEqual(events.petTransientFor('error', 100, 2500),
      { kind: 'error', until: 2600 });
    assert.deepEqual(events.petTransientFor('aborted', 100, 2500),
      { kind: 'error', until: 2600 });
    assert.equal(events.petTransientFor('unknown', 100), null);
    assert.equal(events.petTransientFor('incomplete', 100), null);
  });

  await test('主题模块不 require electron，也不执行主题内容', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'themes.js'), 'utf8');
    assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(source), false);
    assert.equal(/\beval\s*\(/.test(source), false);
    assert.equal(/new\s+Function\s*\(/.test(source), false);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nPETS/THEMES ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('PETS/THEMES FAIL:', error);
  process.exit(1);
});
