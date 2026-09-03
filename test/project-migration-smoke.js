'use strict';

// v0.11 旧 config.workdir/workbenchId -> 默认 user 项目的幂等迁移。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projects = require('../lib/projects');
const migration = require('../lib/project-migration');

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  project-migration: ${name}`);
}

function mkdir(value) {
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function openStore(baseDir, forbiddenRoots = []) {
  let tick = 0;
  return projects.createProjectStore({
    baseDir,
    forbiddenRoots,
    now: () => new Date(Date.UTC(2026, 8, 2, 0, 0, tick++))
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-project-migration-'));
  try {
    await test('首次迁移创建 user 项目，控制室固定首位且旧配置不变', async () => {
      const workdir = mkdir(path.join(tmp, 'legacy-video'));
      const config = {
        workdir,
        workbenchId: 'builtin:短视频创作台',
        lastWorkbenchId: 'builtin:电商客服',
        unrelated: { keep: true }
      };
      const before = JSON.stringify(config);
      const store = openStore(mkdir(path.join(tmp, 'user-data-first')));
      const result = migration.migrateLegacyProject({ config, projectStore: store });
      assert.equal(result.status, 'created');
      assert.equal(result.reason, null);
      assert.equal(result.project.folderTail, 'legacy-video');
      assert.equal(result.project.templateId, 'builtin:短视频创作台');
      assert.equal(result.templatePreserved, false);
      assert.equal(JSON.stringify(config), before, '迁移不得清理或改写旧 config');
      const list = store.list();
      assert.equal(list.length, 2);
      assert.equal(list[0].id, projects.CONSOLE_PROJECT_ID);
      assert.equal(list[0].kind, 'builtin');
      assert.equal(list[1].kind, 'user');
      assert.equal(list[1].id, result.project.projectId);
      assert.equal(list[1].templateId, config.workbenchId);
      assert(!JSON.stringify(result).includes(workdir), '迁移回执不泄漏绝对路径');
    });

    await test('重复执行复用同一 id，不新建第二个项目', async () => {
      const workdir = path.join(tmp, 'legacy-video');
      const config = { workdir, workbenchId: 'builtin:短视频创作台' };
      const store = openStore(path.join(tmp, 'user-data-first'));
      const before = store.list().find((entry) => entry.kind === 'user');
      const revision = store.revision;
      const result = migration.migrateLegacyProject({ config, projectStore: store });
      assert.equal(result.status, 'reused');
      assert.equal(result.project.projectId, before.id);
      assert.equal(store.list().length, 2);
      assert.equal(store.revision, revision, '纯复用不得写注册表');
    });

    await test('同文件夹已是项目时保留用户名称与原模板绑定', async () => {
      const workdir = mkdir(path.join(tmp, 'existing-folder'));
      const store = openStore(mkdir(path.join(tmp, 'user-data-existing')));
      store.ensureConsole();
      const existing = store.create({
        folder: workdir,
        name: '我的项目',
        icon: '🛍️',
        templateId: 'builtin:电商客服'
      });
      const revision = store.revision;
      const config = { workdir, workbenchId: 'builtin:短视频创作台' };
      const result = migration.migrateLegacyProject({ config, projectStore: store });
      assert.equal(result.status, 'reused');
      assert.equal(result.project.projectId, existing.id);
      assert.equal(result.project.name, '我的项目');
      assert.equal(result.project.templateId, 'builtin:电商客服');
      assert.equal(result.templatePreserved, true);
      assert.equal(store.revision, revision);
    });

    await test('无旧 workdir 只幂等初始化控制室，不创建 user 项目', async () => {
      const store = openStore(mkdir(path.join(tmp, 'user-data-empty')));
      const config = { workdir: null, workbenchId: 'builtin:短视频创作台' };
      const result = migration.migrateLegacyProject({ config, projectStore: store });
      assert.deepEqual(result, {
        kind: 'legacy-project-migration',
        status: 'skipped',
        reason: 'no-workdir',
        project: null,
        templatePreserved: false
      });
      assert.deepEqual(store.list().map((entry) => entry.id), [projects.CONSOLE_PROJECT_ID]);
    });

    await test('duplicate-folder 竞态回读已有身份并收敛为 reused', async () => {
      const existing = {
        id: `proj_${'a'.repeat(32)}`,
        kind: 'user',
        name: '竞态项目',
        icon: '🧱',
        folderTail: 'race',
        templateId: null
      };
      let finds = 0;
      let creates = 0;
      const projectStore = {
        ensureConsole: () => ({
          id: projects.CONSOLE_PROJECT_ID,
          kind: 'builtin', pinned: true, hasFolder: false
        }),
        findByFolder: () => {
          finds += 1;
          return finds === 1 ? null : existing;
        },
        create: () => {
          creates += 1;
          const error = new Error('race');
          error.code = 'ERR_PROJECT_DUPLICATE_FOLDER';
          throw error;
        }
      };
      const result = migration.migrateLegacyProject({
        config: { workdir: path.join(tmp, 'race'), workbenchId: null },
        projectStore
      });
      assert.equal(result.status, 'reused');
      assert.equal(result.reason, 'duplicate-race');
      assert.equal(result.project.projectId, existing.id);
      assert.equal(finds, 2);
      assert.equal(creates, 1);
    });

    await test('受保护根、不存在目录与非法模板失败时保留旧配置', async () => {
      const protectedRoot = mkdir(path.join(tmp, 'home', '.dsh'));
      const store = openStore(
        mkdir(path.join(tmp, 'user-data-failure')),
        [protectedRoot]
      );
      const protectedConfig = {
        workdir: protectedRoot,
        workbenchId: 'builtin:短视频创作台',
        keep: '原样'
      };
      const protectedBefore = JSON.stringify(protectedConfig);
      assert.throws(() => migration.migrateLegacyProject({
        config: protectedConfig, projectStore: store
      }), assertCode('ERR_PROJECT_PROTECTED'));
      assert.equal(JSON.stringify(protectedConfig), protectedBefore);
      assert.deepEqual(store.list().map((entry) => entry.id), [projects.CONSOLE_PROJECT_ID]);

      const missingConfig = {
        workdir: path.join(tmp, 'missing'),
        workbenchId: null,
        keep: '仍保留'
      };
      const missingBefore = JSON.stringify(missingConfig);
      assert.throws(() => migration.migrateLegacyProject({
        config: missingConfig, projectStore: store
      }), assertCode('ERR_PROJECT_FOLDER'));
      assert.equal(JSON.stringify(missingConfig), missingBefore);

      const validFolder = mkdir(path.join(tmp, 'invalid-template-folder'));
      const invalidConfig = { workdir: validFolder, workbenchId: 'evil:template' };
      const invalidBefore = JSON.stringify(invalidConfig);
      assert.throws(() => migration.migrateLegacyProject({
        config: invalidConfig, projectStore: store
      }), assertCode('ERR_PROJECT_MIGRATION_INVALID'));
      assert.equal(JSON.stringify(invalidConfig), invalidBefore);
      assert.equal(store.list().filter((entry) => entry.kind === 'user').length, 0);
    });

    await test('输入与 store 依赖精确收窄，模块保持纯 Node', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'project-migration.js'), 'utf8'
      );
      assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
      assert.doesNotMatch(source, /require\(['"]fs['"]\)/);
      assert.doesNotMatch(source, /require\(['"]path['"]\)/);
      assert.throws(() => migration.migrateLegacyProject({}), TypeError);
      assert.throws(() => migration.migrateLegacyProject({
        config: {}, projectStore: {}, extra: true
      }), TypeError);

      const folder = mkdir(path.join(tmp, 'colon-template'));
      const store = openStore(mkdir(path.join(tmp, 'user-data-colon-template')));
      const result = migration.migrateLegacyProject({
        config: { workdir: folder, workbenchId: 'user:team:template' },
        projectStore: store
      });
      assert.equal(result.project.templateId, 'user:team:template', '须与现有 config 合法 id 口径一致');
    });

    console.log(`PROJECT MIGRATION ALL PASS (${passed})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL  project-migration:', error && error.stack ? error.stack : error);
  process.exit(1);
});
