'use strict';

// v0.6 工作台包：纯静态数据解析。
//
// 铁律（违反即返工）：**包里只有数据**。本模块绝不 require 包内任何东西、绝不 eval、
// 绝不 new Function、绝不起子进程。`agent.cordis.yml` 只做存在性与路径校验，
// 内容一个字节都不读进解析器（也因此不引入 YAML 库）。`skills.json` 只解析成清单，
// 本模块没有任何安装或执行路径。`actions[].prompt` 是死文本：要么原样返回，要么整条丢弃，
// 绝不做变量替换、拼接或模板求值。
//
// 容错口径继承 v0.5 宠物包/主题包：单个字段不合法就回落，不让整包报废；
// 整包拒绝只有四类（见 REJECT_REASONS）。被拒的包进 skipped[]，不拖垮其他包。
//
// 保持纯 Node：不依赖 Electron，必须能被 test/smoke.js 直接加载。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pets = require('./pets');
const themes = require('./themes');

const SCHEMA_VERSION = 1;

const LIMITS = Object.freeze({
  maxPackages: 64,
  maxEntries: 512,
  maxManifestBytes: 64 * 1024,
  maxWorkspaceBytes: 64 * 1024,
  maxActionsBytes: 64 * 1024,
  maxSkillsBytes: 64 * 1024,
  maxThemeBytes: 64 * 1024,
  maxOnboardingBytes: 64 * 1024,
  maxAgentPresetBytes: 256 * 1024,
  maxNameChars: 40,
  maxSummaryChars: 120,
  maxVersionChars: 32,
  maxAuthorChars: 80,
  maxLicenseChars: 80,
  maxHomepageChars: 300,
  maxDshRangeChars: 64,
  maxRootChars: 40,
  maxFolders: 32,
  maxPathSegments: 3,
  maxSegmentChars: 40,
  maxReadmeChars: 4000,
  maxFolderFiles: 8,
  maxFileNameChars: 60,
  maxFileContentChars: 8000,
  maxActions: 12,
  maxLabelChars: 16,
  maxHintChars: 80,
  maxPromptBytes: 8 * 1024,
  maxSkills: 24,
  maxSkillNameChars: 60,
  maxSkillWhyChars: 120,
  maxSkillInstallChars: 200,
  maxSkillUrlChars: 300
});

// 整包被拒绝的全部理由。除这几类之外一律「字段回落，包还能用」。
const REJECT_REASONS = Object.freeze([
  'invalid-id', 'manifest-unreadable', 'invalid-json', 'not-an-object', 'schema-unsupported'
]);

// 包 id = 目录名，口径与 v0.5 宠物包一致。
const PACKAGE_ID_RE = /^(?!\.{1,2}$)[^\\/:*?"<>|\u0000-\u001f]{1,64}$/;
const ACTION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const ACCENT_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SEED_FILE_RE = /\.(?:md|txt)$/i;
// 文件名/目录名里一律不接受的字符：路径分隔符、Windows 保留字符与控制字符。
const SEGMENT_BAD_RE = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
// 单行文本里不接受的字符（换行、回车、制表也不接受，因为那就不是单行）。
const SINGLE_LINE_BAD_RE = /[\u0000-\u001f\u007f]/;
// 多行文本里不接受的控制字符：保留 \n \r \t，其余全拒。
const BLOCK_BAD_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

// 文件名全部写死在鲸坞这一侧；manifest 里一个路径字段都没有，
// 包作者无法指定「我的主题在 ../../etc/passwd」——路径逃逸在结构上就不可能发生。
const FILES = Object.freeze({
  manifest: 'manifest.json',
  workspace: 'workspace.json',
  actions: 'actions.json',
  skills: 'skills.json',
  theme: 'theme.json',
  onboarding: 'onboarding.md',
  agentPreset: 'agent.cordis.yml',
  icon: 'icon.png',
  petDir: 'pet'
});
// readme 固定写进这个文件名，所以 files[] 不许再占用它。
const README_FILE_NAME = '说明.md';

const MANIFEST_KNOWN_KEYS = Object.freeze([
  'schemaVersion', 'name', 'summary', 'version', 'author', 'license', 'homepage', 'dshRange', 'accent'
]);
const WORKSPACE_KNOWN_KEYS = Object.freeze(['root', 'folders']);
const FOLDER_KNOWN_KEYS = Object.freeze(['path', 'readme', 'files']);
const SEED_FILE_KNOWN_KEYS = Object.freeze(['name', 'content']);
const ACTION_KNOWN_KEYS = Object.freeze(['id', 'label', 'hint', 'confirm', 'prompt']);
const SKILL_KNOWN_KEYS = Object.freeze(['name', 'why', 'install', 'url']);

function plainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

// 单行文本：清洗控制字符 → 压缩空白 → 截断；洗完为空返回 null。
function safeText(value, maxChars) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maxChars) : null;
}

// 多行文本：保留换行与制表；含其余控制字符时判失败而不是悄悄洗掉，再截断。
function safeBlock(value, maxChars) {
  if (typeof value !== 'string') return null;
  if (BLOCK_BAD_RE.test(value)) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : null;
}

// 统计包用了几个本版本不认识的字段。规则一：未知字段一律忽略、绝不报错，
// 只在 UI 里记一条灰色提示——否则包作者永远不敢用新字段，生态一次都升不了级。
function countUnknownKeys(value, known) {
  if (!plainRecord(value)) return 0;
  const allowed = new Set(known);
  let count = 0;
  for (const key of Object.keys(value)) if (!allowed.has(key)) count += 1;
  return count;
}

// 单段目录名/文件名校验：长度、`.`/`..`、分隔符与保留字符、首尾空格与点。
// 首尾的空格与点在 Windows 上根本创建不出来，早拒比建到一半再失败好。
function validSegment(value, maxChars) {
  if (typeof value !== 'string' || !value || value.length > maxChars) return null;
  if (value === '.' || value === '..') return null;
  if (SEGMENT_BAD_RE.test(value)) return null;
  if (value.startsWith(' ') || value.startsWith('.')) return null;
  if (value.endsWith(' ') || value.endsWith('.')) return null;
  return value;
}

// folders[].path：1–3 段，`/` 分隔，每一段单独校验。
function parseFolderPath(value) {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split('/');
  if (parts.length < 1 || parts.length > LIMITS.maxPathSegments) return null;
  const segments = [];
  for (const part of parts) {
    const segment = validSegment(part, LIMITS.maxSegmentChars);
    if (!segment) return null;
    segments.push(segment);
  }
  return segments;
}

function parseSeedFileName(value) {
  const name = validSegment(value, LIMITS.maxFileNameChars);
  if (!name || !SEED_FILE_RE.test(name) || name === README_FILE_NAME) return null;
  return name;
}

// 主题 id：themes.js 的 THEME_ID_RE 只收 ASCII，而包 id 通常是中文目录名，
// 所以用包 id 的摘要生成一个必然合法的稳定 id，解析仍然走 themes.parseTheme，不另写一套。
function workbenchThemeId(packageId) {
  const digest = crypto.createHash('sha256').update(String(packageId), 'utf8').digest('hex');
  return `wb.${digest.slice(0, 16)}`;
}

// ---------- 纯函数：给一段文本或 JSON 值，收敛成数据 ----------

function parseManifest(value, options = {}) {
  const fallbackName = safeText(options.fallbackName, LIMITS.maxNameChars);
  let raw = value;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxManifestBytes) {
      return { ok: false, reason: 'manifest-unreadable' };
    }
    try { raw = JSON.parse(raw); } catch (_error) { return { ok: false, reason: 'invalid-json' }; }
  }
  if (!plainRecord(raw)) return { ok: false, reason: 'not-an-object' };
  // 唯一一个「字段错就废掉整包」的字段：将来格式变了必须诚实拒绝，不能猜。
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: 'schema-unsupported' };
  }
  const homepage = safeText(raw.homepage, LIMITS.maxHomepageChars);
  const version = typeof raw.version === 'string' && VERSION_RE.test(raw.version.trim())
    ? raw.version.trim() : null;
  return {
    ok: true,
    unknownFieldCount: countUnknownKeys(raw, MANIFEST_KNOWN_KEYS),
    manifest: {
      name: safeText(raw.name, LIMITS.maxNameChars) || fallbackName,
      summary: safeText(raw.summary, LIMITS.maxSummaryChars),
      version,
      author: safeText(raw.author, LIMITS.maxAuthorChars),
      license: safeText(raw.license, LIMITS.maxLicenseChars),
      // 只收 https：挡掉 file:、javascript: 一类 scheme。
      homepage: homepage && homepage.startsWith('https://') ? homepage : null,
      // 只用于提示，永不阻断启用——我们不写版本比较器，那是猜。
      dshRange: safeText(raw.dshRange, LIMITS.maxDshRangeChars),
      accent: typeof raw.accent === 'string' && ACCENT_RE.test(raw.accent.trim())
        ? raw.accent.trim().toLowerCase() : null
    }
  };
}

// workspace.json：写了它就是「重工作台」。folders 不是数组或为空 → 当作没写这个文件，
// 整个包退化成轻工作台，而不是报错。
function parseWorkspace(value) {
  const issues = [];
  let raw = value;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxWorkspaceBytes) {
      return { workspace: null, issues: [{ file: FILES.workspace, reason: 'file-too-large' }] };
    }
    try { raw = JSON.parse(raw); } catch (_error) {
      return { workspace: null, issues: [{ file: FILES.workspace, reason: 'invalid-json' }] };
    }
  }
  if (!plainRecord(raw)) {
    return { workspace: null, issues: [{ file: FILES.workspace, reason: 'not-an-object' }] };
  }
  let unknownFieldCount = countUnknownKeys(raw, WORKSPACE_KNOWN_KEYS);
  if (!Array.isArray(raw.folders) || !raw.folders.length) {
    return {
      workspace: null,
      unknownFieldCount,
      issues: [{ file: FILES.workspace, reason: 'folders-missing' }]
    };
  }

  const list = raw.folders.slice(0, LIMITS.maxFolders);
  if (raw.folders.length > LIMITS.maxFolders) {
    issues.push({ file: FILES.workspace, reason: 'folders-truncated' });
  }
  const folders = [];
  const seen = new Set();
  for (const entry of list) {
    if (!plainRecord(entry)) {
      issues.push({ file: FILES.workspace, reason: 'folder-not-an-object' });
      continue;
    }
    unknownFieldCount += countUnknownKeys(entry, FOLDER_KNOWN_KEYS);
    const segments = parseFolderPath(entry.path);
    if (!segments) {
      issues.push({ file: FILES.workspace, reason: 'folder-path-invalid', detail: safeText(entry.path, 60) });
      continue;
    }
    const key = segments.join('/');
    if (seen.has(key)) {
      issues.push({ file: FILES.workspace, reason: 'folder-duplicate', detail: key });
      continue;
    }
    seen.add(key);

    const files = [];
    if (entry.files !== undefined) {
      if (!Array.isArray(entry.files)) {
        issues.push({ file: FILES.workspace, reason: 'folder-files-not-an-array', detail: key });
      } else {
        const fileList = entry.files.slice(0, LIMITS.maxFolderFiles);
        if (entry.files.length > LIMITS.maxFolderFiles) {
          issues.push({ file: FILES.workspace, reason: 'folder-files-truncated', detail: key });
        }
        const fileNames = new Set();
        for (const item of fileList) {
          if (!plainRecord(item)) {
            issues.push({ file: FILES.workspace, reason: 'seed-file-not-an-object', detail: key });
            continue;
          }
          unknownFieldCount += countUnknownKeys(item, SEED_FILE_KNOWN_KEYS);
          const name = parseSeedFileName(item.name);
          if (!name) {
            issues.push({ file: FILES.workspace, reason: 'seed-file-name-invalid', detail: safeText(item.name, 60) });
            continue;
          }
          const lower = name.toLocaleLowerCase('en-US');
          if (fileNames.has(lower)) {
            issues.push({ file: FILES.workspace, reason: 'seed-file-duplicate', detail: name });
            continue;
          }
          const content = safeBlock(item.content, LIMITS.maxFileContentChars);
          if (!content) {
            issues.push({ file: FILES.workspace, reason: 'seed-file-content-invalid', detail: name });
            continue;
          }
          fileNames.add(lower);
          files.push(Object.freeze({ name, content }));
        }
      }
    }

    folders.push(Object.freeze({
      segments: Object.freeze([...segments]),
      path: key,
      readme: safeBlock(entry.readme, LIMITS.maxReadmeChars),
      files: Object.freeze(files)
    }));
  }

  if (!folders.length) {
    return {
      workspace: null,
      unknownFieldCount,
      issues: [...issues, { file: FILES.workspace, reason: 'no-usable-folders' }]
    };
  }
  const root = validSegment(safeText(raw.root, LIMITS.maxRootChars), LIMITS.maxRootChars);
  if (raw.root !== undefined && !root) issues.push({ file: FILES.workspace, reason: 'root-invalid' });
  return {
    workspace: Object.freeze({ root, folders: Object.freeze(folders) }),
    unknownFieldCount,
    issues
  };
}

// actions[].prompt 是死文本：只做「收不收」的判断，绝不改写内容。
function parsePrompt(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'prompt-missing' };
  // 含 \0 或其他控制字符（换行/回车/制表除外）→ 整条丢弃，而不是悄悄洗掉再发出去。
  if (BLOCK_BAD_RE.test(value)) return { ok: false, reason: 'prompt-control-char' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: 'prompt-empty' };
  // 以 / 开头是斜杠命令，v0.4 的 prompt 适配器本来就拒；在解析期就拒掉，
  // 让用户看到的是「这个按钮没加载」而不是「点了没反应」。
  if (trimmed.startsWith('/')) return { ok: false, reason: 'prompt-slash-command' };
  if (Buffer.byteLength(value, 'utf8') > LIMITS.maxPromptBytes) {
    return { ok: false, reason: 'prompt-too-large' };
  }
  return { ok: true, prompt: value };
}

function parseActions(value) {
  const issues = [];
  let raw = value;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxActionsBytes) {
      return { actions: Object.freeze([]), issues: [{ file: FILES.actions, reason: 'file-too-large' }] };
    }
    try { raw = JSON.parse(raw); } catch (_error) {
      return { actions: Object.freeze([]), issues: [{ file: FILES.actions, reason: 'invalid-json' }] };
    }
  }
  if (!plainRecord(raw)) {
    return { actions: Object.freeze([]), issues: [{ file: FILES.actions, reason: 'not-an-object' }] };
  }
  let unknownFieldCount = countUnknownKeys(raw, ['actions']);
  if (!Array.isArray(raw.actions)) {
    return {
      actions: Object.freeze([]),
      unknownFieldCount,
      issues: [{ file: FILES.actions, reason: 'actions-missing' }]
    };
  }
  const list = raw.actions.slice(0, LIMITS.maxActions);
  if (raw.actions.length > LIMITS.maxActions) {
    issues.push({ file: FILES.actions, reason: 'actions-truncated' });
  }
  const actions = [];
  const seen = new Set();
  for (const entry of list) {
    if (!plainRecord(entry)) { issues.push({ file: FILES.actions, reason: 'action-not-an-object' }); continue; }
    unknownFieldCount += countUnknownKeys(entry, ACTION_KNOWN_KEYS);
    const id = typeof entry.id === 'string' && ACTION_ID_RE.test(entry.id) ? entry.id : null;
    if (!id) {
      issues.push({ file: FILES.actions, reason: 'action-id-invalid', detail: safeText(entry.id, 40) });
      continue;
    }
    // 重复 id 保留先出现的那条。
    if (seen.has(id)) { issues.push({ file: FILES.actions, reason: 'action-id-duplicate', detail: id }); continue; }
    const label = safeText(entry.label, LIMITS.maxLabelChars);
    if (!label) { issues.push({ file: FILES.actions, reason: 'action-label-invalid', detail: id }); continue; }
    const prompt = parsePrompt(entry.prompt);
    if (!prompt.ok) { issues.push({ file: FILES.actions, reason: prompt.reason, detail: id }); continue; }
    seen.add(id);
    actions.push(Object.freeze({
      id,
      label,
      hint: safeText(entry.hint, LIMITS.maxHintChars),
      confirm: entry.confirm === true,
      prompt: prompt.prompt
    }));
  }
  return { actions: Object.freeze(actions), unknownFieldCount, issues };
}

// skills.json 只解析成清单。本模块没有任何安装或执行路径，UI 也只允许「展示 + 复制命令」。
function parseSkills(value) {
  const issues = [];
  let raw = value;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxSkillsBytes) {
      return { skills: null, issues: [{ file: FILES.skills, reason: 'file-too-large' }] };
    }
    try { raw = JSON.parse(raw); } catch (_error) {
      return { skills: null, issues: [{ file: FILES.skills, reason: 'invalid-json' }] };
    }
  }
  if (!plainRecord(raw)) {
    return { skills: null, issues: [{ file: FILES.skills, reason: 'not-an-object' }] };
  }
  let unknownFieldCount = countUnknownKeys(raw, ['skills']);
  if (!Array.isArray(raw.skills)) {
    return { skills: null, unknownFieldCount, issues: [{ file: FILES.skills, reason: 'skills-missing' }] };
  }
  const list = raw.skills.slice(0, LIMITS.maxSkills);
  if (raw.skills.length > LIMITS.maxSkills) issues.push({ file: FILES.skills, reason: 'skills-truncated' });
  const skills = [];
  for (const entry of list) {
    if (!plainRecord(entry)) { issues.push({ file: FILES.skills, reason: 'skill-not-an-object' }); continue; }
    unknownFieldCount += countUnknownKeys(entry, SKILL_KNOWN_KEYS);
    const name = safeText(entry.name, LIMITS.maxSkillNameChars);
    if (!name) { issues.push({ file: FILES.skills, reason: 'skill-name-invalid' }); continue; }
    // install 必须是单行：含换行或控制字符一律丢，避免展示成一段可粘贴的多条命令。
    const install = typeof entry.install === 'string' ? entry.install.trim() : '';
    if (!install || install.length > LIMITS.maxSkillInstallChars || SINGLE_LINE_BAD_RE.test(install)) {
      issues.push({ file: FILES.skills, reason: 'skill-install-invalid', detail: name });
      continue;
    }
    const url = safeText(entry.url, LIMITS.maxSkillUrlChars);
    skills.push(Object.freeze({
      name,
      why: safeText(entry.why, LIMITS.maxSkillWhyChars),
      install,
      url: url && url.startsWith('https://') ? url : null
    }));
  }
  // 空数组是合法且有意义的状态（「本包不推荐任何 skill」），UI 据此整栏隐藏。
  return { skills: Object.freeze(skills), unknownFieldCount, issues };
}

// ---------- 读文件：每一个都走同一套安全校验 ----------

// A-11 第 4、5、7 条：非普通文件/符号链接一律拒；realpath 之后必须仍在包目录里；超过上限拒。
function inspectPackageFile(dir, name, maxBytes, fsImpl) {
  const filePath = path.join(dir, name);
  let stat;
  try { stat = fsImpl.lstatSync(filePath); } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'unreadable-file' };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, reason: 'not-a-regular-file' };
  if (stat.size > maxBytes) return { ok: false, reason: 'file-too-large' };
  if (!pets.containedIn(dir, filePath, fsImpl)) return { ok: false, reason: 'outside-package' };
  return { ok: true, path: filePath, size: stat.size };
}

function readPackageText(dir, name, maxBytes, fsImpl) {
  const inspected = inspectPackageFile(dir, name, maxBytes, fsImpl);
  if (!inspected.ok) return inspected;
  try {
    return { ok: true, path: inspected.path, text: String(fsImpl.readFileSync(inspected.path, 'utf8')) };
  } catch (_error) {
    return { ok: false, reason: 'unreadable-file' };
  }
}

// ---------- 读一个包 ----------

function readWorkbenchPackage(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const dir = options.dir;
  const rawId = typeof options.id === 'string' ? options.id : '';
  const source = options.source === 'builtin' ? 'builtin' : 'user';
  if (typeof dir !== 'string' || !dir || !rawId || !PACKAGE_ID_RE.test(rawId)) {
    return { ok: false, id: rawId, reason: 'invalid-id' };
  }

  const manifestRead = readPackageText(dir, FILES.manifest, LIMITS.maxManifestBytes, fsImpl);
  // 没有 manifest.json = 不是工作台包，整个目录跳过。
  if (!manifestRead.ok) return { ok: false, id: rawId, reason: 'manifest-unreadable' };
  const manifest = parseManifest(manifestRead.text, { fallbackName: rawId });
  if (!manifest.ok) return { ok: false, id: rawId, reason: manifest.reason };

  const issues = [];
  let unknownFieldCount = manifest.unknownFieldCount || 0;
  const note = (result) => {
    if (!result) return;
    if (Array.isArray(result.issues)) issues.push(...result.issues);
    if (Number.isSafeInteger(result.unknownFieldCount)) unknownFieldCount += result.unknownFieldCount;
  };

  // workspace.json —— 写了它就是重工作台。
  let workspace = null;
  const workspaceRead = readPackageText(dir, FILES.workspace, LIMITS.maxWorkspaceBytes, fsImpl);
  if (workspaceRead.ok) {
    const parsed = parseWorkspace(workspaceRead.text);
    note(parsed);
    workspace = parsed.workspace;
  } else if (workspaceRead.reason !== 'missing') {
    issues.push({ file: FILES.workspace, reason: workspaceRead.reason });
  }

  // actions.json —— 按钮清单。数据与渲染分离：这里只产出数据，怎么画由 UI 决定。
  let actions = Object.freeze([]);
  const actionsRead = readPackageText(dir, FILES.actions, LIMITS.maxActionsBytes, fsImpl);
  if (actionsRead.ok) {
    const parsed = parseActions(actionsRead.text);
    note(parsed);
    actions = parsed.actions;
  } else if (actionsRead.reason !== 'missing') {
    issues.push({ file: FILES.actions, reason: actionsRead.reason });
  }

  // skills.json —— 只展示，永不安装。null = 没有这个文件，[] = 明确声明「不推荐任何 skill」。
  let skills = null;
  const skillsRead = readPackageText(dir, FILES.skills, LIMITS.maxSkillsBytes, fsImpl);
  if (skillsRead.ok) {
    const parsed = parseSkills(skillsRead.text);
    note(parsed);
    skills = parsed.skills;
  } else if (skillsRead.reason !== 'missing') {
    issues.push({ file: FILES.skills, reason: skillsRead.reason });
  }

  // onboarding.md —— 原文交给渲染层按行 textContent 写入；这里不解析 Markdown、不生成链接。
  let onboarding = null;
  const onboardingRead = readPackageText(dir, FILES.onboarding, LIMITS.maxOnboardingBytes, fsImpl);
  if (onboardingRead.ok) {
    const text = safeBlock(onboardingRead.text, LIMITS.maxOnboardingBytes);
    if (text) onboarding = text;
    else issues.push({ file: FILES.onboarding, reason: 'unusable-text' });
  } else if (onboardingRead.reason !== 'missing') {
    issues.push({ file: FILES.onboarding, reason: onboardingRead.reason });
  }

  // theme.json —— 复用 lib/themes.js 的解析器，不复制一份。
  let theme = null;
  const themeRead = readPackageText(dir, FILES.theme, LIMITS.maxThemeBytes, fsImpl);
  if (themeRead.ok) {
    const parsed = themes.parseTheme(themeRead.text, { id: workbenchThemeId(rawId), source });
    if (parsed.ok) theme = parsed.theme;
    else issues.push({ file: FILES.theme, reason: parsed.reason });
  } else if (themeRead.reason !== 'missing') {
    issues.push({ file: FILES.theme, reason: themeRead.reason });
  }

  // pet/ —— 复用 lib/pets.js 的解析器，不复制一份。
  let pet = null;
  const petDir = path.join(dir, FILES.petDir);
  let petStat = null;
  try { petStat = fsImpl.lstatSync(petDir); } catch (_error) { petStat = null; }
  if (petStat) {
    if (petStat.isSymbolicLink() || !petStat.isDirectory()) {
      issues.push({ file: FILES.petDir, reason: 'not-a-regular-file' });
    } else if (!pets.containedIn(dir, petDir, fsImpl)) {
      issues.push({ file: FILES.petDir, reason: 'outside-package' });
    } else {
      const parsed = pets.readPetPackage({ dir: petDir, id: rawId, source, fsImpl });
      if (parsed.ok) pet = parsed.package;
      else issues.push({ file: FILES.petDir, reason: parsed.reason });
    }
  }

  // agent.cordis.yml —— 只查存在性与路径合法性，**内容一个字节都不读进解析器**。
  // 不引入 YAML 库：既是新依赖，也是新攻击面。UI 只能写「已检测到，尚未接通」。
  let agentPreset = null;
  const presetInspected = inspectPackageFile(dir, FILES.agentPreset, LIMITS.maxAgentPresetBytes, fsImpl);
  if (presetInspected.ok) {
    agentPreset = Object.freeze({ path: presetInspected.path, size: presetInspected.size });
  } else if (presetInspected.reason !== 'missing') {
    issues.push({ file: FILES.agentPreset, reason: presetInspected.reason });
  }

  // icon.png —— 走宠物包已有的 PNG 头校验（签名 + 尺寸上限），不解码像素。
  let icon = null;
  const iconInspected = inspectPackageFile(dir, FILES.icon, pets.LIMITS.maxPngBytes, fsImpl);
  if (iconInspected.ok) {
    const png = pets.inspectPngFile(iconInspected.path, fsImpl);
    if (png.ok) icon = Object.freeze({ path: iconInspected.path, width: png.width, height: png.height });
    else issues.push({ file: FILES.icon, reason: png.reason });
  } else if (iconInspected.reason !== 'missing') {
    issues.push({ file: FILES.icon, reason: iconInspected.reason });
  }

  return {
    ok: true,
    package: Object.freeze({
      id: rawId,
      dir,
      source,
      name: manifest.manifest.name || rawId,
      summary: manifest.manifest.summary,
      version: manifest.manifest.version,
      author: manifest.manifest.author,
      license: manifest.manifest.license,
      homepage: manifest.manifest.homepage,
      dshRange: manifest.manifest.dshRange,
      accent: manifest.manifest.accent,
      themeId: workbenchThemeId(rawId),
      // 轻工作台 = 没有 workspace.json：切换只换外观与按钮，后端不重启，什么都不弹。
      heavy: Boolean(workspace),
      workspace,
      actions,
      skills,
      onboarding,
      theme,
      pet,
      agentPreset,
      icon,
      unknownFieldCount,
      issues: Object.freeze(issues)
    })
  };
}

// ---------- 扫描 ----------

// 同名的内置包与自制包并存、各显示各的，不互相覆盖（与宠物包一致，
// 避免「我明明放进去了却没生效」）。Windows 上目录名大小写不敏感，
// 比较口径复用工作区那套 platform === 'win32' ? toLocaleLowerCase('en-US')。
function listWorkbenchPackages(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const packages = [];
  const skipped = [];
  const seen = new Set();
  let capped = false;

  const keyOf = (value) => (platform === 'win32' ? value.toLocaleLowerCase('en-US') : value);

  for (const root of roots) {
    if (!plainRecord(root) || typeof root.dir !== 'string' || !root.dir) continue;
    const source = root.source === 'builtin' ? 'builtin' : 'user';
    let names;
    try { names = fsImpl.readdirSync(root.dir); } catch (error) {
      // 目录不存在是正常状态（用户还没建 workbenches/），不算跳过。
      if (!error || error.code !== 'ENOENT') skipped.push({ id: root.dir, reason: 'unreadable-dir' });
      continue;
    }
    for (const name of names.slice(0, LIMITS.maxEntries).sort()) {
      if (typeof name !== 'string' || !PACKAGE_ID_RE.test(name)) continue;
      const id = `${source}:${name}`;
      const dedupeKey = keyOf(id);
      if (seen.has(dedupeKey)) { skipped.push({ id, reason: 'duplicate-id' }); continue; }
      if (packages.length >= LIMITS.maxPackages) {
        capped = true;
        skipped.push({ id, reason: 'too-many-packages' });
        continue;
      }
      const dir = path.join(root.dir, name);
      let stat;
      try { stat = fsImpl.lstatSync(dir); } catch (_error) { continue; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      const result = readWorkbenchPackage({ dir, id: name, source, fsImpl });
      if (!result.ok) { skipped.push({ id, reason: result.reason }); continue; }
      seen.add(dedupeKey);
      packages.push(Object.freeze({ ...result.package, id }));
    }
  }
  return { packages, skipped, capped };
}

function selectWorkbench(packages, workbenchId) {
  const list = Array.isArray(packages) ? packages : [];
  const wanted = typeof workbenchId === 'string' ? workbenchId : null;
  return list.find((item) => item && item.id === wanted) || null;
}

// ---------- 给重工作台的纯计划（不碰文件系统，落盘由 main.js 执行） ----------

// 只算「要建什么」，一个字节都不写。三条铁律里的「只新建不覆盖」「不删任何东西」
// 由执行侧保证；这里保证的是「算出来的相对路径本身是干净的」。
function workspacePlan(workbenchPackage) {
  const pkg = workbenchPackage;
  if (!pkg || !pkg.workspace) return null;
  const root = pkg.workspace.root
    || validSegment(safeText(pkg.name, LIMITS.maxRootChars), LIMITS.maxRootChars)
    || validSegment(pkg.id, LIMITS.maxRootChars);
  if (!root) return null;
  const folders = pkg.workspace.folders.map((folder) => {
    const files = [];
    if (folder.readme) files.push(Object.freeze({ name: README_FILE_NAME, content: `${folder.readme}\n` }));
    for (const seed of folder.files) files.push(Object.freeze({ name: seed.name, content: `${seed.content}\n` }));
    return Object.freeze({
      segments: Object.freeze([...folder.segments]),
      path: folder.path,
      files: Object.freeze(files)
    });
  });
  return Object.freeze({ root, folders: Object.freeze(folders) });
}

module.exports = {
  SCHEMA_VERSION,
  LIMITS,
  FILES,
  README_FILE_NAME,
  REJECT_REASONS,
  PACKAGE_ID_RE,
  ACTION_ID_RE,
  workbenchThemeId,
  validSegment,
  parseFolderPath,
  parseManifest,
  parseWorkspace,
  parseActions,
  parseSkills,
  parsePrompt,
  inspectPackageFile,
  readWorkbenchPackage,
  listWorkbenchPackages,
  selectWorkbench,
  workspacePlan
};
