'use strict';

// v0.11 项目模板：真实内置包投影、只新建不覆盖、路径/软链边界。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workbenches = require('../lib/workbenches');
const templates = require('../lib/project-templates');

let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  project-templates: ${name}`);
}

function mkdir(value) {
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function assertCode(code) {
  return (error) => Boolean(error && error.code === code);
}

function builtins() {
  const root = path.join(__dirname, '..', 'assets', 'workbenches');
  const listed = workbenches.listWorkbenchPackages({
    roots: [{ dir: root, source: 'builtin' }]
  });
  assert.deepEqual(listed.skipped, []);
  return listed.packages;
}

function templateById(id) {
  const pkg = builtins().find((entry) => entry.id === id);
  assert(pkg, `找不到内置工作台 ${id}`);
  return templates.projectTemplateFromWorkbench(pkg);
}

function simpleTemplate(folders) {
  return {
    templateId: 'user:test-template',
    name: '测试模板',
    folders,
    actions: []
  };
}

function folder(pathName, files = []) {
  const segments = pathName.split('/');
  return { segments, path: pathName, files };
}

function seed(name, content = '种子\n') {
  return { name, content };
}

function linkDirectory(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-project-templates-'));
  try {
    await test('真实内置包投影为冻结相对路径与死文本 actions', async () => {
      const packages = builtins();
      const video = templates.projectTemplateFromWorkbench(
        packages.find((entry) => entry.id === 'builtin:短视频创作台')
      );
      const support = templates.projectTemplateFromWorkbench(
        packages.find((entry) => entry.id === 'builtin:电商客服')
      );
      assert.deepEqual(Object.keys(video), ['templateId', 'name', 'folders', 'actions']);
      assert.equal(video.folders.length, 4);
      assert.equal(video.folders.reduce((sum, item) => sum + item.files.length, 0), 7);
      assert.equal(video.actions.length, 5);
      assert.equal(support.folders.length, 2);
      assert.equal(support.folders.reduce((sum, item) => sum + item.files.length, 0), 3);
      assert.equal(support.actions.length, 8);
      assert(Object.isFrozen(video));
      assert(Object.isFrozen(video.folders[0].files[0]));
      for (const action of [...video.actions, ...support.actions]) {
        assert.deepEqual(Object.keys(action), ['id', 'label', 'hint', 'confirm', 'prompt']);
        assert.equal(typeof action.prompt, 'string');
        assert(Object.isFrozen(action));
      }
      const serialized = JSON.stringify(video);
      assert(!serialized.includes(path.join(__dirname, '..', 'assets')));
      assert(!serialized.includes('agent.cordis.yml'));
    });

    await test('新建落地保留旧文件，只创建缺失内容且不额外套 root', async () => {
      const video = templateById('builtin:短视频创作台');
      const root = mkdir(path.join(tmp, 'video-project'));
      const topic = mkdir(path.join(root, '01_选题库'));
      const readme = path.join(topic, '说明.md');
      const original = Buffer.from('我的旧说明，不能改\n', 'utf8');
      fs.writeFileSync(readme, original);

      const result = templates.applyProjectTemplate({
        root,
        template: video,
        reason: 'create'
      });
      assert.equal(result.kind, 'project-template-applied');
      assert.equal(result.created.length, 6);
      assert.deepEqual(result.kept, ['01_选题库/说明.md']);
      assert.deepEqual(fs.readFileSync(readme), original);
      assert.equal(fs.existsSync(path.join(root, '短视频创作台')), false);
      for (const directory of ['01_选题库', '02_脚本', '03_口播稿', '04_素材清单']) {
        assert.equal(fs.statSync(path.join(root, directory)).isDirectory(), true);
      }
      if (process.platform !== 'win32') {
        const created = path.join(root, '02_脚本', '说明.md');
        assert.equal(fs.statSync(created).mode & 0o777, 0o600);
      }
      const serialized = JSON.stringify(result);
      assert(!serialized.includes(root), '落地回执只能返回相对路径');
      assert.equal(result.actions.length, 5);
    });

    await test('显式重复应用幂等，所有用户字节原样保留', async () => {
      const video = templateById('builtin:短视频创作台');
      const root = path.join(tmp, 'video-project');
      const before = new Map();
      for (const templateFolder of video.folders) {
        for (const file of templateFolder.files) {
          const target = path.join(root, ...templateFolder.segments, file.name);
          before.set(target, fs.readFileSync(target));
        }
      }
      const result = templates.applyProjectTemplate({
        root,
        template: video,
        reason: 'explicit'
      });
      assert.equal(result.created.length, 0);
      assert.equal(result.kept.length, 7);
      for (const [target, bytes] of before) assert.deepEqual(fs.readFileSync(target), bytes);
      assert(Object.isFrozen(result));
      assert(Object.isFrozen(result.actions));
    });

    await test('非新建/非显式调用拒绝，actions 不作为代码执行', async () => {
      const root = mkdir(path.join(tmp, 'reason-gate'));
      const video = templateById('builtin:短视频创作台');
      assert.throws(() => templates.applyProjectTemplate({
        root, template: video, reason: 'open'
      }), assertCode('ERR_PROJECT_TEMPLATE_INVALID'));
      assert.deepEqual(fs.readdirSync(root), []);

      global.__whaledockTemplateExecuted = false;
      const inert = {
        id: 'user:inert',
        name: '死文本',
        workspace: null,
        actions: [{
          id: 'inert', label: '死文本', hint: null, confirm: false,
          prompt: 'global.__whaledockTemplateExecuted = true'
        }]
      };
      const projected = templates.projectTemplateFromWorkbench(inert);
      const result = templates.applyProjectTemplate({
        root, template: projected, reason: 'explicit'
      });
      assert.equal(global.__whaledockTemplateExecuted, false);
      assert.equal(result.actions[0].prompt, inert.actions[0].prompt);
      delete global.__whaledockTemplateExecuted;
    });

    await test('越界、绝对段、Windows 设备名与未知参数全部 fail-closed', async () => {
      const root = mkdir(path.join(tmp, 'invalid-paths'));
      const base = simpleTemplate([folder('safe', [seed('seed.md')])]);
      for (const value of [
        simpleTemplate([folder('../escape', [seed('seed.md')])]),
        simpleTemplate([{ segments: ['/absolute'], path: '/absolute', files: [] }]),
        simpleTemplate([folder('CON', [seed('seed.md')])]),
        { ...base, folders: [{ ...base.folders[0], path: 'mismatch' }] },
        simpleTemplate([
          folder('docs', [seed('child.md')]),
          folder('docs/child.md')
        ])
      ]) {
        assert.throws(() => templates.applyProjectTemplate({
          root, template: value, reason: 'explicit'
        }), assertCode('ERR_PROJECT_TEMPLATE_INVALID'));
      }
      assert.throws(() => templates.applyProjectTemplate({
        root, template: base, reason: 'explicit', extra: true
      }), assertCode('ERR_PROJECT_TEMPLATE_INVALID'));
      assert.deepEqual(fs.readdirSync(root), []);
      assert.equal(fs.existsSync(path.join(tmp, 'escape')), false);
    });

    await test('目录软链在全量预检阶段拒绝，失败不创建先前的缺失目录', async () => {
      const root = mkdir(path.join(tmp, 'directory-link-root'));
      const outside = mkdir(path.join(tmp, 'outside-directory'));
      const sentinel = path.join(outside, 'sentinel.md');
      fs.writeFileSync(sentinel, '原始\n');
      linkDirectory(outside, path.join(root, 'linked'));
      const value = simpleTemplate([
        folder('would-be-created', [seed('new.md')]),
        folder('linked', [seed('sentinel.md', '改写\n')])
      ]);
      assert.throws(() => templates.applyProjectTemplate({
        root, template: value, reason: 'explicit'
      }), assertCode('ERR_PROJECT_TEMPLATE_SYMLINK'));
      assert.equal(fs.existsSync(path.join(root, 'would-be-created')), false);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), '原始\n');
    });

    await test('文件软链和软链项目根均拒绝，链接目标不变', async () => {
      const outside = mkdir(path.join(tmp, 'outside-files'));
      const sentinel = path.join(outside, 'sentinel.md');
      fs.writeFileSync(sentinel, '不能改\n');

      const root = mkdir(path.join(tmp, 'file-link-root'));
      const docs = mkdir(path.join(root, 'docs'));
      fs.symlinkSync(sentinel, path.join(docs, 'seed.md'), 'file');
      const value = simpleTemplate([folder('docs', [seed('seed.md', '新内容\n')])]);
      assert.throws(() => templates.applyProjectTemplate({
        root, template: value, reason: 'explicit'
      }), assertCode('ERR_PROJECT_TEMPLATE_SYMLINK'));
      assert.equal(fs.readFileSync(sentinel, 'utf8'), '不能改\n');

      const targetRoot = mkdir(path.join(tmp, 'real-root'));
      const linkedRoot = path.join(tmp, 'linked-root');
      linkDirectory(targetRoot, linkedRoot);
      assert.throws(() => templates.applyProjectTemplate({
        root: linkedRoot, template: value, reason: 'explicit'
      }), assertCode('ERR_PROJECT_TEMPLATE_SYMLINK'));
      assert.deepEqual(fs.readdirSync(targetRoot), []);
    });

    await test('已有同名目录不伪装成文件，失败保留原内容', async () => {
      const root = mkdir(path.join(tmp, 'wrong-file-type'));
      const docs = mkdir(path.join(root, 'docs'));
      mkdir(path.join(docs, 'seed.md'));
      const untouched = path.join(root, 'untouched.txt');
      fs.writeFileSync(untouched, '保留\n');
      const value = simpleTemplate([folder('docs', [seed('seed.md')])]);
      assert.throws(() => templates.applyProjectTemplate({
        root, template: value, reason: 'explicit'
      }), assertCode('ERR_PROJECT_TEMPLATE_APPLY'));
      assert.equal(fs.readFileSync(untouched, 'utf8'), '保留\n');
      assert.equal(fs.statSync(path.join(docs, 'seed.md')).isDirectory(), true);
    });

    await test('模块保持纯 Node 且零执行原语', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'project-templates.js'), 'utf8'
      );
      assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
      assert.doesNotMatch(source, /require\(['"]child_process['"]\)/);
      assert.doesNotMatch(source, /\beval\s*\(/);
      assert.doesNotMatch(source, /new\s+Function\s*\(/);
    });

    console.log(`PROJECT TEMPLATES ALL PASS (${passed})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL  project-templates:', error && error.stack ? error.stack : error);
  process.exit(1);
});
