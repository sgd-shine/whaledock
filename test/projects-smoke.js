'use strict';

// v0.11 项目注册表：稳定身份、文件夹契约、绑定、排序、原子持久化与旁车认领纯 Node 直测。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projects = require('../lib/projects');

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  projects: ${name}`);
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function mkdir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function bindingRef(hex = 'a') { return `session-binding-${hex.repeat(64)}`; }

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-projects-'));
  const userData = mkdir(path.join(tmp, 'userData'));
  const protectedRoot = mkdir(path.join(tmp, 'home', '.dsh'));
  const folderA = mkdir(path.join(tmp, 'work', '旅行图鉴'));
  const folderB = mkdir(path.join(tmp, 'work', '自媒体工作台'));
  const folderC = mkdir(path.join(tmp, 'work', '第三个'));
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++));
  const openStore = (extra = {}) => projects.createProjectStore({
    baseDir: userData,
    forbiddenRoots: [protectedRoot],
    now,
    ...extra
  });

  let store = openStore();

  await test('公开 canonical 解析器与 store 共用双向受保护根隔离', async () => {
    assert.strictEqual(typeof projects.canonicalProjectFolder, 'function');
    const safe = projects.canonicalProjectFolder(folderA, { forbiddenRoots: [protectedRoot] });
    assert.strictEqual(safe.path, fs.realpathSync.native(folderA));
    assert.throws(
      () => projects.canonicalProjectFolder(protectedRoot, { forbiddenRoots: [protectedRoot] }),
      assertCode('ERR_PROJECT_PROTECTED')
    );
    assert.throws(
      () => projects.canonicalProjectFolder(path.join(protectedRoot, 'child'), {
        forbiddenRoots: [protectedRoot]
      }),
      assertCode('ERR_PROJECT_PROTECTED')
    );
    assert.throws(
      () => projects.canonicalProjectFolder(path.dirname(protectedRoot), {
        forbiddenRoots: [protectedRoot]
      }),
      assertCode('ERR_PROJECT_PROTECTED')
    );
  });

  await test('空注册表可用，控制室幂等且固定首位不可删除', async () => {
    assert.strictEqual(store.list().length, 0);
    const console1 = store.ensureConsole();
    const console2 = store.ensureConsole();
    assert.strictEqual(console1.id, projects.CONSOLE_PROJECT_ID);
    assert.strictEqual(console2.id, console1.id);
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(console1.kind, 'builtin');
    assert.strictEqual(console1.pinned, true);
    assert.strictEqual(console1.hasFolder, false);
    assert.throws(() => store.remove(projects.CONSOLE_PROJECT_ID), assertCode('ERR_PROJECT_BUILTIN'));
    assert.throws(() => store.update(projects.CONSOLE_PROJECT_ID, { folder: folderA }), assertCode('ERR_PROJECT_INVALID'));
  });

  let a;
  let b;
  await test('新建项目：名称默认取文件夹名，字段逐项校验', async () => {
    a = store.create({ folder: folderA });
    assert.strictEqual(a.name, '旅行图鉴');
    assert.strictEqual(a.icon, '🧱');
    assert.match(a.id, projects.PROJECT_ID_RE);
    assert.strictEqual(a.folderTail, '旅行图鉴');
    assert.strictEqual(a.hasFolder, true);
    b = store.create({ folder: folderB, name: ' 自媒体 ', icon: '🎨', templateId: 'builtin:短视频创作台', layoutPreset: 'l13' });
    assert.strictEqual(b.name, '自媒体');
    assert.strictEqual(b.templateId, 'builtin:短视频创作台');
    assert.strictEqual(b.order, a.order + 1);
    assert.throws(() => store.create({ folder: folderC, name: '' }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ folder: folderC, name: 'x'.repeat(41) }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ folder: folderC, name: 'a\nb' }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ folder: folderC, icon: 'a b' }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ folder: folderC, templateId: 'evil:x' }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ folder: folderC, layoutPreset: 'L13' }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ folder: folderC, unknown: 1 }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.create({ name: '没文件夹' }), assertCode('ERR_PROJECT_INVALID'));
  });

  await test('文件夹契约：必须存在、不能落入受保护根、不能重复', async () => {
    assert.throws(() => store.create({ folder: path.join(tmp, 'not-exist') }), assertCode('ERR_PROJECT_FOLDER'));
    assert.throws(() => store.create({ folder: path.join(tmp, 'work', 'file.txt') }), assertCode('ERR_PROJECT_FOLDER'));
    assert.throws(() => store.create({ folder: protectedRoot }), assertCode('ERR_PROJECT_PROTECTED'));
    assert.throws(() => store.create({ folder: mkdir(path.join(protectedRoot, 'profiles')) }), assertCode('ERR_PROJECT_PROTECTED'));
    assert.throws(() => store.create({ folder: path.dirname(protectedRoot) }), assertCode('ERR_PROJECT_PROTECTED'));
    const ancestorLink = path.join(tmp, 'work', '受保护祖先链接');
    fs.symlinkSync(path.dirname(protectedRoot), ancestorLink, 'dir');
    assert.throws(() => store.create({ folder: ancestorLink }), assertCode('ERR_PROJECT_PROTECTED'));
    assert.throws(() => store.create({ folder: folderA }), assertCode('ERR_PROJECT_DUPLICATE_FOLDER'));
    assert.throws(() => store.update(b.id, { folder: folderA }), assertCode('ERR_PROJECT_DUPLICATE_FOLDER'));
    assert.strictEqual(store.findByFolder(folderA).id, a.id);
    assert.strictEqual(store.findByFolder(folderC), null);
  });

  await test('folderExists 每次重做 canonical，祖先漂入受保护根祖先时 fail-closed', async () => {
    const driftData = mkdir(path.join(tmp, 'userData-drift'));
    const driftFolder = mkdir(path.join(tmp, 'drift-work', 'project'));
    const driftProtected = mkdir(path.join(tmp, 'protected-drift', '.dsh'));
    let drifted = false;
    let registeredCanonical = null;
    const statPaths = [];
    const realpathSync = (value) => {
      const resolved = path.resolve(value);
      if (drifted && registeredCanonical !== null
          && resolved === path.resolve(registeredCanonical)) {
        return path.dirname(driftProtected);
      }
      return fs.realpathSync.native(value);
    };
    realpathSync.native = realpathSync;
    const statSync = (value) => {
      if (drifted) statPaths.push(path.resolve(value));
      return fs.statSync(value);
    };
    const driftStore = projects.createProjectStore({
      baseDir: driftData,
      forbiddenRoots: [driftProtected],
      fsImpl: { ...fs, realpathSync, statSync },
      now
    });
    const driftProject = driftStore.create({ folder: driftFolder });
    registeredCanonical = driftStore.folderOf(driftProject.id);
    assert.strictEqual(driftStore.folderExists(driftProject.id), true);
    drifted = true;
    assert.strictEqual(driftStore.folderExists(driftProject.id), false);
    assert(statPaths.length > 0);
    assert(statPaths.every((entry) => entry === path.resolve(registeredCanonical)));
  });

  await test('身份稳定：改名、换图标、换文件夹都不改 id；未知字段拒绝', async () => {
    const renamed = store.update(a.id, { name: '旅行 Atlas', icon: '🌍' });
    assert.strictEqual(renamed.id, a.id);
    assert.strictEqual(renamed.name, '旅行 Atlas');
    const moved = store.update(a.id, { folder: folderC });
    assert.strictEqual(moved.id, a.id);
    assert.strictEqual(moved.folderTail, '第三个');
    assert.strictEqual(store.folderOf(a.id), fs.realpathSync.native(folderC));
    assert.strictEqual(store.findByFolder(folderA), null);
    assert.throws(() => store.update(a.id, { id: 'proj_' + 'a'.repeat(32) }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.update(a.id, { order: 3 }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.update('proj_' + 'f'.repeat(32), { name: 'x' }), assertCode('ERR_PROJECT_NOT_FOUND'));
    assert.throws(() => store.update('bad-id', { name: 'x' }), assertCode('ERR_PROJECT_INVALID'));
    // 换回 A，后面的测试继续用 folderA
    store.update(a.id, { folder: folderA });
  });

  await test('绑定会话：绑定、查找、解绑，非法引用拒绝', async () => {
    const bound = store.bindSession(a.id, bindingRef('a'));
    assert.strictEqual(bound.boundSession, bindingRef('a'));
    assert.strictEqual(store.findBySession(bindingRef('a')).id, a.id);
    assert.strictEqual(store.findBySession(null), null);
    assert.throws(() => store.findBySession('nobody'), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.bindSession(b.id, bindingRef('a')), assertCode('ERR_PROJECT_SESSION_BOUND'));
    assert.throws(() => store.bindSession(projects.CONSOLE_PROJECT_ID, bindingRef('b')), assertCode('ERR_PROJECT_BUILTIN'));
    assert.throws(() => store.bindSession(a.id, 'bad session'), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.bindSession(a.id, 'x'.repeat(129)), assertCode('ERR_PROJECT_INVALID'));
    const unbound = store.bindSession(a.id, null);
    assert.strictEqual(unbound.boundSession, null);
    store.bindSession(a.id, bindingRef('a'));
  });

  await test('排序：控制室永远第一，用户项目按显式顺序，未列出的顺延', async () => {
    const c = store.create({ folder: folderC, name: '第三个' });
    const ordered = store.reorder([c.id, a.id]);
    assert.deepStrictEqual(ordered.map((p) => p.id), [projects.CONSOLE_PROJECT_ID, c.id, a.id, b.id]);
    assert.throws(() => store.reorder([projects.CONSOLE_PROJECT_ID]), assertCode('ERR_PROJECT_BUILTIN'));
    assert.throws(() => store.reorder([a.id, a.id]), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.reorder([]), assertCode('ERR_PROJECT_INVALID'));
    store.remove(c.id);
    assert.strictEqual(store.get(c.id), null);
  });

  await test('隐藏与打开计数', async () => {
    store.update(b.id, { hidden: true });
    assert.strictEqual(store.list({ includeHidden: false }).some((p) => p.id === b.id), false);
    assert.strictEqual(store.list().some((p) => p.id === b.id), true);
    const opened = store.touchOpened(a.id);
    assert.strictEqual(opened.openCount, 1);
    assert.match(opened.lastOpenedAt, /^2026-09-01T/);
    store.update(b.id, { hidden: false });
  });

  await test('布局状态：普通 JSON 且有界', async () => {
    const updated = store.update(a.id, { paneState: { preset: 'l13', panes: [{ tabs: ['explorer'] }] } });
    assert.deepStrictEqual(updated.paneState, { preset: 'l13', panes: [{ tabs: ['explorer'] }] });
    assert.throws(() => store.update(a.id, { paneState: [] }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.update(a.id, { paneState: { fn: () => 1 } }), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => store.update(a.id, { paneState: { big: 'x'.repeat(17 * 1024) } }), assertCode('ERR_PROJECT_INVALID'));
    let nested = {};
    let cursor = nested;
    for (let i = 0; i < 12; i++) { cursor.n = {}; cursor = cursor.n; }
    assert.throws(() => store.update(a.id, { paneState: nested }), assertCode('ERR_PROJECT_INVALID'));
  });

  await test('公开视图不泄漏绝对路径', async () => {
    const text = JSON.stringify(store.snapshot());
    assert.ok(!text.includes(tmp), '快照里不应出现临时根路径');
    assert.ok(text.includes('"folderTail":"旅行图鉴"'));
  });

  await test('原子持久化：落盘、权限、重新加载一致、revision 与订阅', async () => {
    const file = store.filePath;
    assert.ok(fs.existsSync(file));
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.ok(!fs.readdirSync(path.dirname(file)).some((n) => n.includes('.tmp-')));
    const before = store.revision;
    const events = [];
    const unsubscribe = store.subscribe((snap) => events.push(snap.revision));
    store.update(a.id, { icon: '🗺️' });
    assert.strictEqual(store.revision, before + 1);
    assert.deepStrictEqual(events, [before + 1]);
    unsubscribe();
    store.update(a.id, { icon: '🌍' });
    assert.strictEqual(events.length, 1);
    const reopened = openStore();
    assert.deepStrictEqual(reopened.list().map((p) => [p.id, p.name, p.icon, p.boundSession]),
      store.list().map((p) => [p.id, p.name, p.icon, p.boundSession]));
    assert.strictEqual(reopened.lastRecovery, null);
  });

  await test('坏文件隔离：损坏的注册表被移成诊断备份，入口继续可用', async () => {
    const file = store.filePath;
    fs.writeFileSync(file, '{ not json');
    const recovered = openStore();
    assert.ok(recovered.lastRecovery && recovered.lastRecovery.quarantined.includes('.invalid-'));
    assert.strictEqual(recovered.list().length, 0);
    assert.ok(fs.existsSync(recovered.lastRecovery.quarantined));
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, projects: [{ id: 'proj_x' }] }));
    const recovered2 = openStore();
    assert.ok(recovered2.lastRecovery);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, projects: [], extra: true }));
    openStore();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, projects: [] }));
    openStore();
    const backups = fs.readdirSync(path.dirname(file)).filter((n) => n.includes('.invalid-'));
    assert.ok(backups.length <= projects.LIMITS.maxQuarantineFiles, `诊断备份应有界，实际 ${backups.length}`);
    // 恢复到可用状态供后续测试
    store = openStore();
    store.ensureConsole();
    a = store.create({ folder: folderA, name: '旅行 Atlas', icon: '🌍' });
    store.bindSession(a.id, bindingRef('a'));
  });

  await test('旁车目录拒绝 symlink/junction 越出项目根', async () => {
    const sidecarFolder = mkdir(path.join(tmp, 'work', '旁车越界'));
    const sidecarProject = store.create({ folder: sidecarFolder, name: '旁车越界' });
    fs.symlinkSync(protectedRoot, path.join(sidecarFolder, projects.MANIFEST_DIRNAME), 'dir');
    assert.throws(() => store.readManifest(sidecarFolder), assertCode('ERR_PROJECT_PROTECTED'));
    assert.throws(() => store.writeManifest(sidecarProject.id), assertCode('ERR_PROJECT_PROTECTED'));
    assert.strictEqual(fs.existsSync(path.join(protectedRoot, projects.MANIFEST_FILENAME)), false);
  });

  await test('旁车：写入、读取、认领复用 id，搬家后重新连上', async () => {
    assert.strictEqual(store.readManifest(folderA), null);
    const file = store.writeManifest(a.id);
    assert.strictEqual(path.basename(path.dirname(file)), projects.MANIFEST_DIRNAME);
    const manifest = store.readManifest(folderA);
    assert.strictEqual(manifest.id, a.id);
    assert.strictEqual(manifest.name, '旅行 Atlas');
    assert.throws(() => store.writeManifest(projects.CONSOLE_PROJECT_ID), assertCode('ERR_PROJECT_BUILTIN'));

    // 同一文件夹再认领 → existing
    assert.strictEqual(store.adoptFolder(folderA).adopted, 'existing');

    // 复制旁车不能在旧项目根仍有效时静默劫持同一个项目 id。
    const copiedFolder = mkdir(path.join(tmp, 'work', '旅行图鉴-复制旁车'));
    const copiedSidecar = mkdir(path.join(copiedFolder, projects.MANIFEST_DIRNAME));
    // Node 22.17+ 的 Windows cpSync 目录原生 fast path 遇到文件系统错误时
    // 可能直接以 0xC0000409 终止进程，无法由测试捕获。这里要模拟的事实只是
    // “同一份合法旁车被复制到另一项目根”，逐文件复制也避免意外跟随目录链接。
    fs.copyFileSync(
      path.join(folderA, projects.MANIFEST_DIRNAME, projects.MANIFEST_FILENAME),
      path.join(copiedSidecar, projects.MANIFEST_FILENAME)
    );
    assert.throws(
      () => store.adoptFolder(copiedFolder),
      assertCode('ERR_PROJECT_IDENTITY_CONFLICT')
    );
    assert.strictEqual(store.get(a.id).folderTail, '旅行图鉴');

    // 搬家：把带旁车的文件夹移到新位置再认领 → relinked，id 不变
    const movedFolder = path.join(tmp, 'work', '旅行图鉴-搬家');
    fs.renameSync(folderA, movedFolder);
    const relinked = store.adoptFolder(movedFolder);
    assert.strictEqual(relinked.adopted, 'relinked');
    assert.strictEqual(relinked.project.id, a.id);
    assert.strictEqual(relinked.project.folderTail, '旅行图鉴-搬家');

    // 全新机器：注册表为空，旁车里的 id 被沿用 → manifest
    const freshData = mkdir(path.join(tmp, 'userData-fresh'));
    const fresh = projects.createProjectStore({ baseDir: freshData, forbiddenRoots: [protectedRoot], now });
    const adopted = fresh.adoptFolder(movedFolder, { icon: '🧭' });
    assert.strictEqual(adopted.adopted, 'manifest');
    assert.strictEqual(adopted.project.id, a.id);
    assert.strictEqual(adopted.project.icon, '🧭');
    assert.strictEqual(adopted.project.name, '旅行 Atlas');

    // 没旁车 → new
    const plain = fresh.adoptFolder(folderB);
    assert.strictEqual(plain.adopted, 'new');
    assert.strictEqual(plain.project.name, '自媒体工作台');

    // 坏旁车 fail-closed
    const badFolder = mkdir(path.join(tmp, 'work', '坏旁车'));
    mkdir(path.join(badFolder, projects.MANIFEST_DIRNAME));
    fs.writeFileSync(path.join(badFolder, projects.MANIFEST_DIRNAME, projects.MANIFEST_FILENAME), '{"schemaVersion":1,"id":"nope"}');
    assert.throws(() => fresh.adoptFolder(badFolder), assertCode('ERR_PROJECT_INVALID'));
    fs.writeFileSync(path.join(badFolder, projects.MANIFEST_DIRNAME, projects.MANIFEST_FILENAME), 'x'.repeat(5000));
    assert.throws(() => fresh.adoptFolder(badFolder), assertCode('ERR_PROJECT_MANIFEST'));
  });

  await test('数量上限 fail-closed', async () => {
    const smallData = mkdir(path.join(tmp, 'userData-small'));
    const small = projects.createProjectStore({ baseDir: smallData, forbiddenRoots: [protectedRoot], now, maxProjects: 3 });
    small.ensureConsole();
    small.create({ folder: mkdir(path.join(tmp, 'small', 'one')) });
    small.create({ folder: mkdir(path.join(tmp, 'small', 'two')) });
    assert.throws(() => small.create({ folder: mkdir(path.join(tmp, 'small', 'three')) }), assertCode('ERR_PROJECT_LIMIT'));
  });

  await test('注册表校验：重复 id / 重复文件夹 / builtin 与 id 不匹配全部拒绝', async () => {
    const base = {
      id: 'proj_' + 'a'.repeat(32), kind: 'user', name: 'x', icon: '🧱', folder: path.resolve(tmp, 'x'),
      boundSession: null, templateId: null, layoutPreset: null, paneState: null, order: 0, hidden: false,
      pinned: false, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      lastOpenedAt: null, openCount: 0
    };
    const opts = { platform: process.platform };
    assert.doesNotThrow(() => projects.normalizeRegistry({ schemaVersion: 1, projects: [base] }, opts));
    assert.throws(() => projects.normalizeRegistry({ schemaVersion: 1, projects: [base, base] }, opts), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => projects.normalizeRegistry({ schemaVersion: 1, projects: [base, { ...base, id: 'proj_' + 'b'.repeat(32) }] }, opts), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => projects.normalizeRecord({ ...base, kind: 'builtin' }, opts), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => projects.normalizeRecord({ ...base, folder: 'relative/path' }, opts), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => projects.normalizeRecord({ ...base, createdAt: 'yesterday' }, opts), assertCode('ERR_PROJECT_INVALID'));
    assert.throws(() => projects.normalizeRecord({ ...base, extra: 1 }, opts), assertCode('ERR_PROJECT_INVALID'));
  });

  console.log(`\nPROJECTS ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('FAIL  projects:', error && error.stack ? error.stack : error);
  process.exit(1);
});
