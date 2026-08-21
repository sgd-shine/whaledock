'use strict';

// v0.6 工作台包解析直测：纯 Node，不需要 Electron，也不读取用户真实目录。
// 覆盖开发方案 A-11 的十条安全校验（逐条一个用例名），外加三连 fixture
// （正常包 / 缺一半字段的包 / 恶意包）与 Windows 大小写撞车。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workbenches = require('../lib/workbenches');
const workspaces = require('../lib/workspaces');
const config = require('../lib/config');

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  workbenches: ${name}`);
  } catch (error) {
    console.error(`FAIL  workbenches: ${name}`);
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

function writePack(root, id, files) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  return dir;
}

// ---------- fixture 一：正常包，六个原语全都写齐 ----------
const GOOD_MANIFEST = {
  schemaVersion: 1,
  name: '短视频创作台',
  summary: '选题、脚本、口播稿、封面标题、素材清单，一条龙',
  version: '1.0.0',
  author: 'SGD',
  license: 'MIT',
  homepage: 'https://github.com/sgd-shine/whaledock',
  dshRange: '0.1.0-rc.6',
  accent: '#22d3ee'
};
const GOOD_WORKSPACE = {
  root: '短视频创作台',
  folders: [
    {
      path: '01_选题库',
      readme: '把你随手想到的选题丢进来。',
      files: [{ name: '示例-第一条选题.md', content: '这是示例，可删。' }]
    },
    { path: '02_脚本', readme: '分镜脚本落在这里。' }
  ]
};
const GOOD_ACTIONS = {
  actions: [
    { id: 'today', label: '今天做什么', hint: '读选题库', confirm: false, prompt: '读 01_选题库，给三个能今天开拍的选题。' },
    { id: 'script', label: '写脚本', prompt: '读 01_选题库，写一份分镜脚本。' }
  ]
};

function goodPackFiles(extra = {}) {
  return {
    'manifest.json': JSON.stringify(GOOD_MANIFEST),
    'workspace.json': JSON.stringify(GOOD_WORKSPACE),
    'actions.json': JSON.stringify(GOOD_ACTIONS),
    'skills.json': JSON.stringify({ skills: [] }),
    'onboarding.md': '# 短视频创作台\n\n- 先往 01_选题库 里丢东西\n',
    'theme.json': JSON.stringify({ base: 'dark', name: '暖橙', colors: { primary: '#f97316' } }),
    'icon.png': pngBytes(64, 64),
    'pet/idle.png': pngBytes(48, 48),
    ...extra
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whaledock-workbenches-'));
  const builtinRoot = path.join(tmp, 'builtin');
  const userRoot = path.join(tmp, 'user');
  fs.mkdirSync(builtinRoot);
  fs.mkdirSync(userRoot);

  // ============ fixture 三连 ============

  await test('fixture 正常包：六个原语全部解析出来，轻/重判定正确', async () => {
    const dir = writePack(builtinRoot, '短视频创作台', goodPackFiles());
    const result = workbenches.readWorkbenchPackage({ dir, id: '短视频创作台', source: 'builtin' });
    assert.equal(result.ok, true);
    const pkg = result.package;
    assert.equal(pkg.name, '短视频创作台');
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.homepage, 'https://github.com/sgd-shine/whaledock');
    assert.equal(pkg.accent, '#22d3ee');
    assert.equal(pkg.heavy, true, '写了 workspace.json 就是重工作台');
    assert.equal(pkg.workspace.folders.length, 2);
    assert.equal(pkg.workspace.folders[0].files[0].name, '示例-第一条选题.md');
    assert.equal(pkg.actions.length, 2);
    assert.equal(pkg.actions[1].confirm, false, 'confirm 缺省为 false');
    assert.deepEqual(pkg.skills, [], '空数组是合法状态，不是 null');
    assert.ok(pkg.onboarding.includes('先往 01_选题库'));
    assert.ok(pkg.theme && pkg.theme.colors.primary === '#f97316');
    assert.ok(pkg.pet && pkg.pet.states.idle.length === 1);
    assert.ok(pkg.icon && pkg.icon.width === 64);
    assert.equal(pkg.issues.length, 0, '正常包不该有 issues');
  });

  await test('fixture 缺一半字段的包：逐字段回落，包仍然可用', async () => {
    const dir = writePack(userRoot, '半个包', {
      // 只有 manifest，而且里面几乎什么都没写。
      'manifest.json': JSON.stringify({ name: '   ', summary: 42, version: '不合法的版本号!!', license: null })
    });
    const result = workbenches.readWorkbenchPackage({ dir, id: '半个包', source: 'user' });
    assert.equal(result.ok, true, '缺字段绝不整包报废');
    const pkg = result.package;
    assert.equal(pkg.name, '半个包', 'name 洗完为空 → 回落目录名');
    assert.equal(pkg.summary, null);
    assert.equal(pkg.version, null, '非法版本号丢弃成 null');
    assert.equal(pkg.license, null, 'UI 据此明写「未声明许可证」');
    assert.equal(pkg.accent, null);
    assert.equal(pkg.heavy, false, '没有 workspace.json = 轻工作台');
    assert.deepEqual(pkg.actions, [], '没有 actions.json = 不显示按钮栏');
    assert.equal(pkg.skills, null, 'null 表示没有 skills.json，与空数组区分');
    assert.equal(pkg.onboarding, null);
    assert.equal(pkg.theme, null);
    assert.equal(pkg.pet, null);
    assert.equal(pkg.agentPreset, null);
    assert.equal(workbenches.workspacePlan(pkg), null, '轻工作台没有建目录计划');
  });

  await test('fixture 恶意包：..、绝对路径、超大文件全部被明确拒绝', async () => {
    const dir = writePack(userRoot, '恶意包', {
      'manifest.json': JSON.stringify({ name: '恶意包' }),
      'workspace.json': JSON.stringify({
        root: '../../逃出去',
        folders: [
          { path: '../../../etc' },
          { path: '/etc/passwd' },
          { path: 'C:\\Windows\\System32' },
          { path: '正常目录', readme: '这条是好的' }
        ]
      }),
      // 超过 8 KiB 的提示词必须被丢掉，而不是截断后发出去。
      'actions.json': JSON.stringify({
        actions: [
          { id: 'huge', label: '超大', prompt: '啊'.repeat(4000) },
          { id: 'slash', label: '斜杠', prompt: '  /clear' },
          { id: 'nul', label: '空字节', prompt: `前${NUL}后` },
          { id: 'ok', label: '正常', prompt: '这条是好的' }
        ]
      })
    });
    const result = workbenches.readWorkbenchPackage({ dir, id: '恶意包', source: 'user' });
    assert.equal(result.ok, true, '恶意字段只丢字段，不让整包消失得不明不白');
    const pkg = result.package;
    assert.equal(pkg.workspace.folders.length, 1, '三条越界路径全部丢弃');
    assert.equal(pkg.workspace.folders[0].path, '正常目录');
    assert.equal(pkg.workspace.root, null, '非法 root 回落，不拒包');
    const reasons = pkg.issues.map((item) => item.reason);
    assert.equal(reasons.filter((r) => r === 'folder-path-invalid').length, 3);
    assert.ok(reasons.includes('root-invalid'));
    assert.equal(pkg.actions.length, 1, '超大 / 斜杠命令 / 含空字节的提示词各丢一条');
    assert.equal(pkg.actions[0].id, 'ok');
    assert.ok(reasons.includes('prompt-too-large'));
    assert.ok(reasons.includes('prompt-slash-command'));
    assert.ok(reasons.includes('prompt-control-char'));
    // workspacePlan 只会产出干净的相对段，绝不可能带出 .. 或绝对路径。
    const plan = workbenches.workspacePlan(pkg);
    for (const folder of plan.folders) {
      for (const segment of folder.segments) {
        assert.ok(segment !== '..' && !path.isAbsolute(segment));
      }
    }
  });

  // ============ A-11 逐条 ============

  await test('A-11-1 目录名合法：. / .. / 带分隔符的目录名一律 invalid-id', async () => {
    for (const bad of ['.', '..', 'a/b', 'a\\b', 'a:b', `a${NUL}b`, 'x'.repeat(65)]) {
      const result = workbenches.readWorkbenchPackage({ dir: tmp, id: bad, source: 'user' });
      assert.equal(result.ok, false, `应拒绝 ${JSON.stringify(bad)}`);
      assert.equal(result.reason, 'invalid-id');
    }
    assert.equal(workbenches.readWorkbenchPackage({ dir: tmp, id: '', source: 'user' }).reason, 'invalid-id');
  });

  await test('A-11-2 拒 ..：folders[].path 的每一段都做字面检查', async () => {
    const parsed = workbenches.parseWorkspace(JSON.stringify({
      folders: [{ path: '..' }, { path: 'a/../b' }, { path: '好目录/子目录' }]
    }));
    assert.equal(parsed.workspace.folders.length, 1);
    assert.equal(parsed.workspace.folders[0].path, '好目录/子目录');
    assert.equal(workbenches.parseFolderPath('..'), null);
    assert.equal(workbenches.parseFolderPath('a/../b'), null);
  });

  await test('A-11-3 拒绝对路径：POSIX 与 Windows 两种写法都拒', async () => {
    for (const bad of ['/etc', '/etc/passwd', 'C:\\Windows', '\\\\server\\share']) {
      assert.equal(workbenches.parseFolderPath(bad), null, `应拒绝 ${bad}`);
    }
    // 顺带确认：拒掉之后不会有任何一段能被 path.isAbsolute 判为绝对路径。
    const parsed = workbenches.parseWorkspace(JSON.stringify({ folders: [{ path: '/etc' }, { path: 'ok' }] }));
    assert.equal(parsed.workspace.folders.length, 1);
  });

  await test('A-11-4 拒符号链接：manifest 是软链时整包拒，其余文件是软链时该项拒', async () => {
    const linkTarget = path.join(tmp, '外部-manifest.json');
    fs.writeFileSync(linkTarget, JSON.stringify({ name: '外面来的' }));
    const dir = writePack(userRoot, '软链manifest', {});
    fs.symlinkSync(linkTarget, path.join(dir, 'manifest.json'));
    const linked = workbenches.readWorkbenchPackage({ dir, id: '软链manifest', source: 'user' });
    assert.equal(linked.ok, false);
    assert.equal(linked.reason, 'manifest-unreadable');

    const outsideYml = path.join(tmp, '外部.yml');
    fs.writeFileSync(outsideYml, 'name: outside');
    const dir2 = writePack(userRoot, '软链preset', { 'manifest.json': JSON.stringify({ name: '软链preset' }) });
    fs.symlinkSync(outsideYml, path.join(dir2, 'agent.cordis.yml'));
    const result = workbenches.readWorkbenchPackage({ dir: dir2, id: '软链preset', source: 'user' });
    assert.equal(result.ok, true, '单个文件是软链不该废掉整包');
    assert.equal(result.package.agentPreset, null, '软链的 preset 当它不存在');
    assert.ok(result.package.issues.some((item) => item.reason === 'not-a-regular-file'));
  });

  await test('A-11-5 拒 realpath 逃逸：包目录本身是软链时，包内文件仍必须落在包内', async () => {
    // 直接验证复用的 containedIn 判定：软链指向包外一律 false。
    const pets = require('../lib/pets');
    const outside = path.join(tmp, '包外目录');
    fs.mkdirSync(outside, { recursive: true });
    const dir = writePack(userRoot, '逃逸包', { 'manifest.json': JSON.stringify({ name: '逃逸包' }) });
    const escape = path.join(dir, '逃出去');
    fs.symlinkSync(outside, escape, process.platform === 'win32' ? 'junction' : undefined);
    assert.equal(pets.containedIn(dir, escape, fs), false, 'realpath 落在包外必须为 false');
    assert.equal(pets.containedIn(dir, path.join(dir, 'manifest.json'), fs), true);
  });

  await test('A-11-6 拒指向 ~/.dsh：字面与 realpath 两轮都拒（复用 v0.4 工作区校验）', async () => {
    const forbidden = config.protectedWorkspaceRoots();
    assert.ok(Array.isArray(forbidden) && forbidden.length >= 1);
    const dshRoot = forbidden[0];
    // 第一轮：字面路径落进受保护根。
    assert.throws(
      () => workspaces.canonicalWorkspace(dshRoot, { forbiddenRoots: forbidden }),
      (error) => error.code === 'ERR_WORKSPACE_PROTECTED'
    );
    assert.throws(
      () => workspaces.canonicalWorkspace(path.join(dshRoot, '子目录'), { forbiddenRoots: forbidden }),
      (error) => error.code === 'ERR_WORKSPACE_PROTECTED'
    );
    // 第二轮：字面路径干净、realpath 才落进受保护根。
    // 受保护根本身要用 realpath，否则 /var 与 /private/var 这类差异会让比较落空。
    fs.mkdirSync(path.join(tmp, '假装的dsh'), { recursive: true });
    // 必须用 realpathSync.native：Windows runner 的 tmpdir 是 8.3 短名，
    // 只有 native 会展开成长名，而生产代码里的 nativeRealpathSync 走的正是 native。
    // 用 JS 版取出来的根会和 native 解出来的候选路径对不上，第二轮就永远不会命中。
    const realpathNative = fs.realpathSync.native || fs.realpathSync;
    const lexicalDsh = path.join(tmp, '假装的dsh');
    const realDsh = realpathNative(lexicalDsh);
    // 生产代码里的 config.protectedWorkspaceRoots() 就是同时给出字面根与 realpath 根，
    // 这里照抄这个口径，免得平台差异（8.3 短名、/var 与 /private/var）让断言落空。
    const forbiddenDsh = realDsh === lexicalDsh ? [lexicalDsh] : [lexicalDsh, realDsh];
    const alias = path.join(tmp, '看起来无害');
    // Windows 上建目录符号链接要提权，junction 不用，而且它正是 Windows 侧的等价逃逸手段。
    fs.symlinkSync(realDsh, alias, process.platform === 'win32' ? 'junction' : undefined);
    // 先证明第一轮（字面）根本拦不住它——这正是为什么必须有第二轮。
    assert.doesNotThrow(() => workspaces.assertWorkspaceNotForbidden(alias, { forbiddenRoots: forbiddenDsh }));
    assert.throws(
      () => workspaces.canonicalWorkspace(alias, { forbiddenRoots: forbiddenDsh }),
      (error) => error.code === 'ERR_WORKSPACE_PROTECTED'
    );
  });

  await test('A-11-7 文件大小上限：每种文件超限都拒，且不拖垮同包其他文件', async () => {
    const big = 'x'.repeat(workbenches.LIMITS.maxWorkspaceBytes + 10);
    const dir = writePack(userRoot, '超大文件包', {
      'manifest.json': JSON.stringify({ name: '超大文件包' }),
      'workspace.json': big,
      'actions.json': big,
      'skills.json': big,
      'onboarding.md': 'y'.repeat(workbenches.LIMITS.maxOnboardingBytes + 10),
      'agent.cordis.yml': 'z'.repeat(workbenches.LIMITS.maxAgentPresetBytes + 10)
    });
    const result = workbenches.readWorkbenchPackage({ dir, id: '超大文件包', source: 'user' });
    assert.equal(result.ok, true);
    const pkg = result.package;
    assert.equal(pkg.workspace, null);
    assert.deepEqual(pkg.actions, []);
    assert.equal(pkg.skills, null);
    assert.equal(pkg.onboarding, null);
    assert.equal(pkg.agentPreset, null);
    const tooLarge = pkg.issues.filter((item) => item.reason === 'file-too-large');
    assert.equal(tooLarge.length, 5, '五种文件各记一条 file-too-large');
    // manifest 自己超限属于整包拒绝的四类之一。
    const dir2 = writePack(userRoot, '超大manifest', {
      'manifest.json': 'q'.repeat(workbenches.LIMITS.maxManifestBytes + 10)
    });
    const rejected = workbenches.readWorkbenchPackage({ dir: dir2, id: '超大manifest', source: 'user' });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'manifest-unreadable');
  });

  await test('A-11-8 包数量上限：超过 64 个不加载，并逐个记 too-many-packages', async () => {
    const manyRoot = path.join(tmp, 'many');
    fs.mkdirSync(manyRoot, { recursive: true });
    for (let i = 0; i < workbenches.LIMITS.maxPackages + 5; i += 1) {
      const id = `包${String(i).padStart(3, '0')}`;
      writePack(manyRoot, id, { 'manifest.json': JSON.stringify({ name: id }) });
    }
    const listed = workbenches.listWorkbenchPackages({ roots: [{ dir: manyRoot, source: 'user' }] });
    assert.equal(listed.packages.length, workbenches.LIMITS.maxPackages);
    assert.equal(listed.capped, true);
    const overflow = listed.skipped.filter((item) => item.reason === 'too-many-packages');
    assert.equal(overflow.length, 5);
  });

  await test('A-11-9 不执行：解析层源码里没有动态 require / eval / new Function / child_process', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'workbenches.js'), 'utf8');
    assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(source), false, '禁止 require Electron');
    assert.equal(/require\(\s*['"]child_process['"]\s*\)/.test(source), false);
    assert.equal(/\bchild_process\b/.test(source), false);
    assert.equal(/\bspawn(Sync)?\s*\(/.test(source), false);
    assert.equal(/\bexec(Sync|File)?\s*\(/.test(source), false);
    assert.equal(/\beval\s*\(/.test(source), false);
    assert.equal(/new\s+Function\s*\(/.test(source), false);
    // require 只允许写死的白名单，不允许把变量喂进 require。
    const requires = [...source.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert.deepEqual(requires.sort(), ["'./pets'", "'./themes'", "'crypto'", "'fs'", "'path'"].sort());
  });

  await test('A-11-10 不碰 Cordis 内部：lib/** 与 main.js 里没有对 cordis 的 require/import', async () => {
    const root = path.join(__dirname, '..');
    const targets = fs.readdirSync(path.join(root, 'lib'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(root, 'lib', name));
    targets.push(path.join(root, 'main.js'));
    for (const file of targets) {
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(/require\(\s*['"][^'"]*cordis[^'"]*['"]\s*\)/i.test(source), false, `${file} 不得 require cordis`);
      assert.equal(/^\s*import\s.*['"][^'"]*cordis[^'"]*['"]/im.test(source), false, `${file} 不得 import cordis`);
    }
  });

  // ============ 硬性要求 9 里点名的其余几条 ============

  await test('agent.cordis.yml 只查存在性：内容一个字节都不读进解析器', async () => {
    // 故意放一段「像 YAML 又像攻击」的内容：解析器读了就会出事，不读就什么都不会发生。
    const nasty = 'name: !!js/function "function(){return process.exit(1)}"\n';
    const dir = writePack(userRoot, '带预设的包', {
      'manifest.json': JSON.stringify({ name: '带预设的包' }),
      'agent.cordis.yml': nasty
    });
    const result = workbenches.readWorkbenchPackage({ dir, id: '带预设的包', source: 'user' });
    assert.equal(result.ok, true);
    const preset = result.package.agentPreset;
    assert.ok(preset && typeof preset.path === 'string', '只记路径');
    assert.equal(preset.size, Buffer.byteLength(nasty, 'utf8'), '只记大小');
    // 返回值里除了 path/size 不许出现任何来自文件内容的东西。
    assert.deepEqual(Object.keys(preset).sort(), ['path', 'size']);
    assert.equal(JSON.stringify(result.package).includes('js/function'), false, '内容不得出现在任何输出里');
    // 解析层源码里也不许出现 YAML 解析器。
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'workbenches.js'), 'utf8');
    assert.equal(
      /require\(\s*['"][^'"]*(?:yaml|yml)[^'"]*['"]\s*\)/i.test(source), false,
      '不引入 YAML 库'
    );
  });

  await test('skills.json 只展示不安装：解析结果里没有任何可执行路径', async () => {
    const dir = writePack(userRoot, 'skills包', {
      'manifest.json': JSON.stringify({ name: 'skills包' }),
      'skills.json': JSON.stringify({
        skills: [
          { name: '好 skill', why: '有用', install: 'dsh skills add demo', url: 'https://example.com/demo' },
          // 多行安装命令一律丢：避免展示成一串可整体粘贴的命令。
          { name: '多行', install: 'rm -rf /\ndsh skills add evil' },
          { name: '坏协议', install: 'dsh skills add x', url: 'javascript:alert(1)' },
          { name: '', install: 'dsh skills add y' }
        ]
      })
    });
    const result = workbenches.readWorkbenchPackage({ dir, id: 'skills包', source: 'user' });
    const skills = result.package.skills;
    assert.equal(skills.length, 2, '多行命令与空名字各丢一条');
    assert.equal(skills[0].install, 'dsh skills add demo');
    assert.equal(skills[0].url, 'https://example.com/demo');
    assert.equal(skills[1].url, null, '非 https 的 url 丢弃成 null');
    // 解析层没有任何执行入口，install 只是字符串。
    for (const skill of skills) assert.equal(typeof skill.install, 'string');
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'workbenches.js'), 'utf8');
    assert.equal(/skills[\s\S]{0,200}(spawn|exec|child_process)/i.test(source), false);
  });

  await test('actions 模板不被当代码执行：提示词原样返回，一个字符都不改写', async () => {
    const raw = '把 {{变量}} 原样发出去；`ls -la`；${process.exit(1)}；<script>alert(1)</script>';
    const parsed = workbenches.parseActions({
      actions: [{ id: 'raw', label: '原样', prompt: raw }]
    });
    assert.equal(parsed.actions.length, 1);
    assert.equal(parsed.actions[0].prompt, raw, '死文本：包里写什么就是什么');
    // 多行提示词的换行必须保留。
    const multi = `第一行${String.fromCharCode(10)}第二行${String.fromCharCode(9)}带制表`;
    const parsedMulti = workbenches.parseActions({ actions: [{ id: 'm', label: '多行', prompt: multi }] });
    assert.equal(parsedMulti.actions[0].prompt, multi);
    // 其余控制字符（这里用响铃）整条丢弃，而不是悄悄洗掉再发出去。
    const parsedBell = workbenches.parseActions({ actions: [{ id: 'b', label: '响铃', prompt: `前${BELL}后` }] });
    assert.equal(parsedBell.actions.length, 0);
    assert.equal(parsedBell.issues[0].reason, 'prompt-control-char');
  });

  await test('未知字段一律忽略：带未来字段的包照常加载，只记灰色计数', async () => {
    const dir = writePack(userRoot, '未来包', {
      'manifest.json': JSON.stringify({
        ...GOOD_MANIFEST,
        inputs: [{ id: 'order', label: '订单号' }],   // v0.7 才可能有的字段
        batch: { folder: '02_待筛简历' },
        experimentalFlag: true
      }),
      'workspace.json': JSON.stringify({
        root: '未来根',
        watched: true,
        folders: [{ path: '01_收件箱', readme: '说明', retention: '30d' }]
      }),
      'actions.json': JSON.stringify({
        version: 2,
        actions: [{ id: 'a', label: '按钮', prompt: '正文', icon: 'star', shortcut: 'cmd+1' }]
      }),
      'skills.json': JSON.stringify({ registry: 'x', skills: [{ name: 's', install: 'dsh skills add s', pinned: true }] })
    });
    const result = workbenches.readWorkbenchPackage({ dir, id: '未来包', source: 'user' });
    assert.equal(result.ok, true, '多了字段绝不能说包坏了');
    const pkg = result.package;
    assert.equal(pkg.name, '短视频创作台');
    assert.equal(pkg.workspace.folders.length, 1);
    assert.equal(pkg.actions.length, 1);
    assert.equal(pkg.skills.length, 1);
    // 3(manifest) + 1(workspace) + 1(folder) + 1(actions) + 2(action) + 1(skills) + 1(skill) = 10
    assert.equal(pkg.unknownFieldCount, 10);
    assert.equal(pkg.issues.length, 0, '未知字段不算 issue，只是灰色计数');
  });

  await test('Windows 大小写撞车：注入 platform 与假 fs 直测，同名只留先出现的那个', async () => {
    // 本机 macOS 的文件系统大小写不敏感，建不出 WorkbenchA 与 workbencha 两个目录，
    // 所以这里注入一个假 fs，让去重逻辑本身可被确定性地测到。
    // 根要用平台原生分隔符：假 fs 用 path.normalize 查表，Windows 上 '/fake/x' 会变成 '\\fake\\x'。
    const root = path.normalize('/fake/workbenches');
    const tree = {
      [root]: { type: 'dir', names: ['WorkbenchA', 'workbencha'] },
      [path.join(root, 'WorkbenchA')]: { type: 'dir', names: ['manifest.json'] },
      [path.join(root, 'WorkbenchA', 'manifest.json')]: { type: 'file', content: JSON.stringify({ name: '大写 A' }) },
      [path.join(root, 'workbencha')]: { type: 'dir', names: ['manifest.json'] },
      [path.join(root, 'workbencha', 'manifest.json')]: { type: 'file', content: JSON.stringify({ name: '小写 a' }) }
    };
    const missing = (target) => {
      const error = new Error(`ENOENT: ${target}`);
      error.code = 'ENOENT';
      throw error;
    };
    const node = (target) => tree[path.normalize(target)];
    const fakeFs = {
      readdirSync(target) {
        const item = node(target);
        if (!item || item.type !== 'dir') missing(target);
        return [...item.names];
      },
      lstatSync(target) {
        const item = node(target);
        if (!item) missing(target);
        return {
          isSymbolicLink: () => false,
          isDirectory: () => item.type === 'dir',
          isFile: () => item.type === 'file',
          size: item.content ? Buffer.byteLength(item.content, 'utf8') : 0
        };
      },
      readFileSync(target) {
        const item = node(target);
        if (!item || item.type !== 'file') missing(target);
        return item.content;
      },
      realpathSync: (target) => path.normalize(target)
    };

    const onWin = workbenches.listWorkbenchPackages({
      roots: [{ dir: root, source: 'user' }], platform: 'win32', fsImpl: fakeFs
    });
    assert.equal(onWin.packages.length, 1, 'Windows 上大小写不敏感，算同一个 id');
    assert.equal(onWin.packages[0].id, 'user:WorkbenchA', '保留先出现（排序后靠前）的那个');
    assert.equal(onWin.skipped.filter((item) => item.reason === 'duplicate-id').length, 1);

    const onPosix = workbenches.listWorkbenchPackages({
      roots: [{ dir: root, source: 'user' }], platform: 'darwin', fsImpl: fakeFs
    });
    assert.equal(onPosix.packages.length, 2, 'macOS/Linux 上是两个不同的包');
  });

  // ============ 其余字段表与扫描口径 ============

  await test('manifest：schemaVersion 不等于 1 是唯一「字段错就废整包」的字段', async () => {
    assert.equal(workbenches.parseManifest(JSON.stringify({ schemaVersion: 2 })).reason, 'schema-unsupported');
    assert.equal(workbenches.parseManifest(JSON.stringify({ schemaVersion: '1' })).reason, 'schema-unsupported');
    assert.equal(workbenches.parseManifest(JSON.stringify({ schemaVersion: 1 })).ok, true);
    assert.equal(workbenches.parseManifest(JSON.stringify({})).ok, true, '不写就当 1');
    assert.equal(workbenches.parseManifest('{坏 JSON').reason, 'invalid-json');
    assert.equal(workbenches.parseManifest('[]').reason, 'not-an-object');
    assert.equal(workbenches.parseManifest('"字符串"').reason, 'not-an-object');
  });

  await test('manifest：homepage 只收 https，其余 scheme 一律丢弃', async () => {
    for (const bad of ['http://x.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x']) {
      const parsed = workbenches.parseManifest(JSON.stringify({ homepage: bad }));
      assert.equal(parsed.manifest.homepage, null, `应丢弃 ${bad}`);
    }
    assert.equal(
      workbenches.parseManifest(JSON.stringify({ homepage: 'https://ok.example' })).manifest.homepage,
      'https://ok.example'
    );
  });

  await test('manifest：accent 只收 #RGB / #RRGGBB，其余回落 null', async () => {
    assert.equal(workbenches.parseManifest(JSON.stringify({ accent: '#0af' })).manifest.accent, '#0af');
    assert.equal(workbenches.parseManifest(JSON.stringify({ accent: '#22D3EE' })).manifest.accent, '#22d3ee');
    for (const bad of ['red', '#12345', 'rgb(0,0,0)', '#0af0', 12]) {
      assert.equal(workbenches.parseManifest(JSON.stringify({ accent: bad })).manifest.accent, null);
    }
  });

  await test('workspace：folders 不是数组或为空 → 退化成轻工作台而不是报错', async () => {
    for (const raw of [{ folders: [] }, { folders: 'x' }, { folders: null }, {}]) {
      const parsed = workbenches.parseWorkspace(JSON.stringify(raw));
      assert.equal(parsed.workspace, null);
      assert.equal(parsed.issues[0].reason, 'folders-missing');
    }
    // 有 folders 但一条都用不了，也是退化，不是半启用。
    const useless = workbenches.parseWorkspace(JSON.stringify({ folders: [{ path: '..' }] }));
    assert.equal(useless.workspace, null);
    assert.ok(useless.issues.some((item) => item.reason === 'no-usable-folders'));
  });

  await test('workspace：folders 超过 32 项截断，重复路径丢弃', async () => {
    const folders = [];
    for (let i = 0; i < 40; i += 1) folders.push({ path: `目录${i}` });
    folders.push({ path: '目录0' });
    const parsed = workbenches.parseWorkspace(JSON.stringify({ folders }));
    assert.equal(parsed.workspace.folders.length, workbenches.LIMITS.maxFolders);
    assert.ok(parsed.issues.some((item) => item.reason === 'folders-truncated'));
  });

  await test('workspace：files[] 只收 .md/.txt 单段文件名，且不许占用 说明.md', async () => {
    const parsed = workbenches.parseWorkspace(JSON.stringify({
      folders: [{
        path: '01_选题库',
        readme: '正文',
        files: [
          { name: '示例-一.md', content: '这是示例，可删' },
          { name: '示例-二.txt', content: '也可删' },
          { name: '说明.md', content: '想覆盖 readme' },
          { name: '../逃出去.md', content: 'x' },
          { name: '恶意.sh', content: 'rm -rf /' },
          { name: '空内容.md', content: '   ' }
        ]
      }]
    }));
    const files = parsed.workspace.folders[0].files;
    assert.deepEqual(files.map((item) => item.name), ['示例-一.md', '示例-二.txt']);
    const reasons = parsed.issues.map((item) => item.reason);
    assert.equal(reasons.filter((r) => r === 'seed-file-name-invalid').length, 3);
    assert.ok(reasons.includes('seed-file-content-invalid'));
  });

  await test('workspacePlan：readme 与 files 一起变成「要建的文件」，路径全是干净相对段', async () => {
    const dir = writePack(userRoot, '计划包', goodPackFiles());
    const pkg = workbenches.readWorkbenchPackage({ dir, id: '计划包', source: 'user' }).package;
    const plan = workbenches.workspacePlan(pkg);
    assert.equal(plan.root, '短视频创作台');
    assert.equal(plan.folders.length, 2);
    assert.deepEqual(plan.folders[0].files.map((item) => item.name), ['说明.md', '示例-第一条选题.md']);
    assert.deepEqual(plan.folders[1].files.map((item) => item.name), ['说明.md']);
    for (const folder of plan.folders) {
      assert.ok(folder.segments.length >= 1 && folder.segments.length <= 3);
      for (const segment of folder.segments) {
        assert.equal(path.isAbsolute(segment), false);
        assert.ok(segment !== '.' && segment !== '..');
      }
    }
    // root 缺失时依次回落到 manifest.name、目录名。
    const noRoot = workbenches.workspacePlan({
      id: '兜底包', name: '兜底名', workspace: { root: null, folders: pkg.workspace.folders }
    });
    assert.equal(noRoot.root, '兜底名');
  });

  await test('actions：id 非法或重复丢这一条，label 洗完为空也丢，超过 12 条截断', async () => {
    const actions = [
      { id: 'ok', label: '好按钮', prompt: '正文' },
      { id: 'ok', label: '重复 id', prompt: '正文' },
      { id: 'BadCase', label: '大写 id', prompt: '正文' },
      { id: '带空格 id', label: '空格', prompt: '正文' },
      { id: 'nolabel', label: '   ', prompt: '正文' },
      { id: 'noprompt', label: '没正文' }
    ];
    for (let i = 0; i < 14; i += 1) actions.push({ id: `x${i}`, label: `按钮${i}`, prompt: '正文' });
    const parsed = workbenches.parseActions(JSON.stringify({ actions }));
    assert.equal(parsed.actions.length <= workbenches.LIMITS.maxActions, true);
    assert.equal(parsed.actions[0].id, 'ok', '重复 id 保留先出现的那条');
    assert.equal(parsed.actions.filter((item) => item.id === 'ok').length, 1);
    const reasons = parsed.issues.map((item) => item.reason);
    assert.ok(reasons.includes('action-id-duplicate'));
    assert.ok(reasons.includes('action-id-invalid'));
    assert.ok(reasons.includes('action-label-invalid'));
    assert.ok(reasons.includes('prompt-missing'));
    assert.ok(reasons.includes('actions-truncated'));
  });

  await test('actions：label 超过 16 字符被截断而不是丢弃', async () => {
    const parsed = workbenches.parseActions(JSON.stringify({
      actions: [{ id: 'long', label: '一二三四五六七八九十一二三四五六七八', prompt: '正文' }]
    }));
    assert.equal(parsed.actions.length, 1);
    assert.equal(parsed.actions[0].label.length, workbenches.LIMITS.maxLabelChars);
  });

  await test('扫描：内置与自制同名包并存，坏包只跳过自己', async () => {
    const scanBuiltin = path.join(tmp, 'scan-builtin');
    const scanUser = path.join(tmp, 'scan-user');
    fs.mkdirSync(scanBuiltin, { recursive: true });
    fs.mkdirSync(scanUser, { recursive: true });
    writePack(scanBuiltin, '同名台', { 'manifest.json': JSON.stringify({ name: '内置版' }) });
    writePack(scanUser, '同名台', { 'manifest.json': JSON.stringify({ name: '自制版' }) });
    writePack(scanUser, '坏包', { 'manifest.json': '{不是 JSON' });
    writePack(scanUser, '不是包', { 'readme.txt': 'x' });

    const listed = workbenches.listWorkbenchPackages({
      roots: [{ dir: scanBuiltin, source: 'builtin' }, { dir: scanUser, source: 'user' }],
      platform: 'darwin'
    });
    const ids = listed.packages.map((item) => item.id).sort();
    assert.deepEqual(ids, ['builtin:同名台', 'user:同名台'], '同名包并存，各显示各的');
    const skippedIds = listed.skipped.map((item) => `${item.id}:${item.reason}`).sort();
    assert.deepEqual(skippedIds, ['user:不是包:manifest-unreadable', 'user:坏包:invalid-json']);
    assert.equal(listed.capped, false);
  });

  await test('扫描：根目录不存在是正常状态，不算跳过', async () => {
    const listed = workbenches.listWorkbenchPackages({
      roots: [{ dir: path.join(tmp, '根本没有这个目录'), source: 'user' }]
    });
    assert.deepEqual(listed.packages, []);
    assert.deepEqual(listed.skipped, []);
  });

  await test('主题 id：包 id 是中文也能生成合法且稳定的主题 id', async () => {
    const themes = require('../lib/themes');
    const id = workbenches.workbenchThemeId('短视频创作台');
    assert.equal(id, workbenches.workbenchThemeId('短视频创作台'), '同一个包 id 必须稳定');
    assert.notEqual(id, workbenches.workbenchThemeId('合同初审台'));
    const parsed = themes.parseTheme(JSON.stringify({ colors: { primary: '#f97316' } }), { id, source: 'user' });
    assert.equal(parsed.ok, true, '生成的 id 必须能过 themes.js 的 THEME_ID_RE');
    assert.equal(parsed.theme.id, id);
  });

  await test('selectWorkbench：选不到就返回 null，由调用方降级到默认工作台', async () => {
    const list = [{ id: 'user:甲' }, { id: 'builtin:乙' }];
    assert.equal(workbenches.selectWorkbench(list, 'user:甲').id, 'user:甲');
    assert.equal(workbenches.selectWorkbench(list, 'user:不存在'), null);
    assert.equal(workbenches.selectWorkbench(null, 'x'), null);
  });

  await test('内置短视频创作台真实存在，零 issue 解析，五个按钮与四个文件夹都在', async () => {
    const root = path.join(__dirname, '..');
    const listed = workbenches.listWorkbenchPackages({
      roots: [{ dir: path.join(root, 'assets', 'workbenches'), source: 'builtin' }]
    });
    assert.equal(listed.skipped.length, 0, '内置包一个都不许被跳过');
    const pkg = listed.packages.find((item) => item.id === 'builtin:短视频创作台');
    assert.notEqual(pkg, undefined);
    assert.equal(pkg.issues.length, 0, '内置包必须零 issue');
    assert.equal(pkg.unknownFieldCount, 0);
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.heavy, true, '短视频台是重工作台');
    assert.deepEqual(
      pkg.workspace.folders.map((item) => item.path),
      ['01_选题库', '02_脚本', '03_口播稿', '04_素材清单']
    );
    assert.deepEqual(
      pkg.actions.map((item) => item.label),
      ['今天做什么', '写脚本', '转口播稿', '出封面标题', '列素材清单']
    );
    // 五段提示词全文原样入包，且都远在 8 KiB 上限之内。
    for (const action of pkg.actions) {
      const bytes = Buffer.byteLength(action.prompt, 'utf8');
      assert.ok(bytes > 800 && bytes <= workbenches.LIMITS.maxPromptBytes, `${action.id} 提示词长度异常：${bytes}`);
      assert.ok(action.prompt.includes('第一步'), `${action.id} 提示词不像 B-4 原文`);
      assert.equal(action.confirm, false);
    }
    // v0.6 先发空 skills 清单：没实测过第三方 skill 的安装命令就不写。
    assert.deepEqual(pkg.skills, []);
    // 故意不放 agent.cordis.yml，顺便验证缺字段回落走得通。
    assert.equal(pkg.agentPreset, null);
    assert.equal(fs.existsSync(path.join(pkg.dir, 'agent.cordis.yml')), false);
    // theme/pet 素材后补，缺了就跟随全局，不阻塞发版。
    assert.equal(pkg.theme, null);
    assert.equal(pkg.pet, null);
    // SGD 2026-08-19 补充：01_选题库 预置三份示例，避免第一个按钮撞上空选题库。
    const topics = pkg.workspace.folders[0];
    assert.equal(topics.files.length, 3);
    for (const file of topics.files) {
      assert.ok(file.name.startsWith('示例-'), '示例文件名必须以「示例-」开头');
      assert.ok(file.content.includes('这是示例，可以直接删掉'), '示例文件必须自报是示例');
    }
    const plan = workbenches.workspacePlan(pkg);
    assert.equal(plan.root, '短视频创作台');
    assert.equal(plan.folders[0].files.length, 4, '说明.md + 三个示例');
    assert.equal(plan.folders[0].files[0].name, workbenches.README_FILE_NAME);
  });

  await test('内置电商客服是纯数据重工作台：22 条虚构话术、八个按钮与脱敏红线完整', async () => {
    const root = path.join(__dirname, '..');
    const listed = workbenches.listWorkbenchPackages({
      roots: [{ dir: path.join(root, 'assets', 'workbenches'), source: 'builtin' }]
    });
    assert.equal(listed.skipped.length, 0, '两个内置包都不许被跳过');
    const pkg = listed.packages.find((item) => item.id === 'builtin:电商客服');
    assert.notEqual(pkg, undefined);
    assert.equal(pkg.issues.length, 0, '电商客服包必须零 issue');
    assert.equal(pkg.unknownFieldCount, 0);
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.dshRange, '0.1.0-rc.6');
    assert.equal(pkg.heavy, true);
    assert.deepEqual(
      fs.readdirSync(pkg.dir).sort(),
      ['actions.json', 'manifest.json', 'onboarding.md', 'skills.json', 'workspace.json'],
      'v0.1 只交付五个声明式数据文件'
    );

    assert.deepEqual(pkg.workspace.folders.map((item) => item.path), ['话术库', '待入库']);
    const library = pkg.workspace.folders[0];
    assert.deepEqual(library.files.map((item) => item.name), ['示例-话术表.txt']);
    const lines = library.files[0].content.split(/\r?\n/);
    assert.equal(lines[0], '问题,答案');
    assert.equal(lines.length, 23, '表头之外必须恰好 22 条纯虚构话术');
    for (const [index, line] of lines.slice(1).entries()) {
      assert.equal((line.match(/,/g) || []).length, 1, `第 ${index + 1} 条只能有一个英文逗号`);
      assert.match(line, /^[^,\r\n]+,[^,\r\n]+$/, `第 ${index + 1} 条必须是非空的两列`);
    }
    for (const keyword of ['什么时候发货', '怎么还没到货', '尺寸怎么选', '我要退款']) {
      assert.ok(library.files[0].content.includes(keyword), `示例表缺少 ${keyword}`);
    }
    assert.equal(/圆通|中通/.test(library.files[0].content), false, '虚构示例不夹带真实快递品牌');
    const exampleAnswers = new Map(lines.slice(1).map((line) => line.split(',')));
    for (const question of ['质量有问题怎么办？', '发票怎么开？', '我要退款', '下错单了怎么办？']) {
      assert.match(exampleAnswers.get(question), /人工|专员/, `${question} 必须只做人工转接`);
    }
    assert.equal(exampleAnswers.get('可以改收货地址吗？').includes('把新地址发我'), false);
    assert.equal(exampleAnswers.get('怎么还没到货？').includes('把订单号发我'), false);
    assert.ok(library.readme.includes('另存为 CSV（UTF-8）'));
    assert.ok(library.readme.includes('虚构的演示数据'));
    assert.ok(library.readme.includes('删除或替换'));
    const inbox = pkg.workspace.folders[1];
    assert.ok(inbox.readme.includes('候选永远不会自动变成正式话术'));
    assert.ok(inbox.readme.includes('由人审核后'));

    assert.deepEqual(
      pkg.actions.map((item) => item.id),
      ['start', 'draft', 'polish', 'human', 'gap', 'collect', 'feed', 'report']
    );
    assert.deepEqual(
      pkg.actions.map((item) => item.label),
      ['开工上岗', '生成草稿', '改写得更礼貌', '给我转人工话术', '把这题登记为缺料', '收录这条', '批量喂', '值班小结']
    );
    for (const action of pkg.actions) {
      assert.equal(action.confirm, false);
      assert.ok(Buffer.byteLength(action.prompt, 'utf8') <= workbenches.LIMITS.maxPromptBytes);
    }
    const start = pkg.actions[0].prompt;
    assert.ok(start.includes('【草稿】') && start.includes('【依据】') && start.includes('【风险】'));
    assert.ok(start.includes('【依据】话术表《文件名》第 X 条：「答案原文开头约20字…」'));
    assert.ok(start.includes('表头不计入条目编号'));
    assert.ok(start.includes('.csv 或 .txt'));
    assert.ok(start.includes('表里没有的不许编'));
    assert.ok(start.includes('高风险一律转人工'));
    assert.ok(start.includes('含个人信息，注意脱敏'));
    assert.ok(start.includes('条目互相冲突或疑似过期时，答「待核」'));
    const gap = pkg.actions.find((item) => item.id === 'gap').prompt;
    assert.ok(gap.includes('缺料清单.md'));
    assert.ok(gap.includes('买家A／尾号4位／[已删]'));
    assert.ok(gap.includes('只登记，不要试图回答'));
    for (const id of ['collect', 'feed']) {
      const prompt = pkg.actions.find((item) => item.id === id).prompt;
      assert.ok(prompt.includes('待入库/候选语料.csv'));
      assert.ok(prompt.includes('绝不写入 话术库/'));
      assert.ok(prompt.includes('买家A／尾号4位／[已删]'));
    }
    assert.ok(pkg.actions.find((item) => item.id === 'feed').prompt.includes('等我回复「确认」后'));

    assert.deepEqual(pkg.skills, []);
    assert.equal(pkg.agentPreset, null);
    assert.equal(pkg.theme, null);
    assert.equal(pkg.pet, null);
    assert.equal(pkg.icon, null);
    assert.ok(pkg.onboarding.includes('会被交给 AI 处理'));
    assert.ok(pkg.onboarding.includes('买家昵称改成「买家A/B」'));
    assert.ok(pkg.onboarding.includes('订单号只留尾号 4 位'));
    assert.ok(pkg.onboarding.includes('手机号和地址整段删除'));

    const plan = workbenches.workspacePlan(pkg);
    assert.equal(plan.root, '电商客服');
    assert.deepEqual(plan.folders.map((item) => item.path), ['话术库', '待入库']);
    assert.deepEqual(plan.folders[0].files.map((item) => item.name), ['说明.md', '示例-话术表.txt']);
    assert.deepEqual(plan.folders[1].files.map((item) => item.name), ['说明.md']);
    assert.equal(
      plan.folders.some((folder) => folder.files.some((file) => file.name === '缺料清单.md')),
      false,
      '缺料清单由首次登记动作创建，不在包里预置'
    );
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nWORKBENCHES ALL PASS (${passed})`);
}

main().catch((error) => {
  console.error('WORKBENCHES FAIL:', error);
  process.exit(1);
});
