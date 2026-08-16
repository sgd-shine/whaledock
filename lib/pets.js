'use strict';

// v0.5 桌面宠物包：纯静态资源解析（manifest.json + PNG）。
// 绝不 require / eval / 以任何方式执行宠物包内的内容；只读数据字段。
// 保持纯 Node：不依赖 Electron，也不关心窗口、CSS 或动效实现。
const fs = require('fs');
const path = require('path');
const { normalizeRealPath, nativeRealpathSync } = require('./config');

const LIMITS = Object.freeze({
  maxPackages: 200,
  maxFrames: 24,
  maxEntries: 512,
  maxManifestBytes: 64 * 1024,
  maxPngBytes: 4 * 1024 * 1024,
  maxSide: 2048,
  maxNameChars: 40,
  maxAuthorChars: 80,
  minFrameRate: 1,
  maxFrameRate: 24,
  minSize: 16,
  maxSize: 512
});

const PET_STATES = Object.freeze(['idle', 'busy', 'waiting', 'celebrate', 'error']);
const PET_ANCHORS = Object.freeze(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
const DEFAULTS = Object.freeze({
  frameRate: 6,
  width: 128,
  height: 128,
  anchor: 'bottom-right'
});
const PACKAGE_ID_RE = /^(?!\.{1,2}$)[^\\/:*?"<>|\u0000-\u001f]{1,64}$/;
const PNG_NAME_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,120}\.png$/i;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function plainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function safeText(value, maxChars) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maxChars) : null;
}

function boundedInteger(value, min, max) {
  if (!Number.isSafeInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

// 纯函数：把任意 JSON 值收敛成 manifest 数据。
// 单个字段不合法就当它没写（回落默认值），不让整包报废——这是容错的关键。
function parseManifest(value) {
  let raw = value;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxManifestBytes) {
      return { ok: false, reason: 'manifest-too-large' };
    }
    try { raw = JSON.parse(raw); } catch (_error) {
      return { ok: false, reason: 'invalid-json' };
    }
  }
  if (raw === undefined || raw === null) raw = {};
  if (!plainRecord(raw)) return { ok: false, reason: 'not-an-object' };

  const size = plainRecord(raw.size) ? raw.size : {};
  const states = {};
  if (plainRecord(raw.states)) {
    for (const state of PET_STATES) {
      const list = raw.states[state];
      if (!Array.isArray(list)) continue;
      const frames = [];
      for (const item of list.slice(0, LIMITS.maxFrames)) {
        if (typeof item !== 'string' || !PNG_NAME_RE.test(item)) continue;
        if (!frames.includes(item)) frames.push(item);
      }
      if (frames.length) states[state] = frames;
    }
  }

  return {
    ok: true,
    manifest: {
      name: safeText(raw.name, LIMITS.maxNameChars),
      author: safeText(raw.author, LIMITS.maxAuthorChars),
      license: safeText(raw.license, LIMITS.maxAuthorChars),
      frameRate: boundedInteger(raw.frameRate, LIMITS.minFrameRate, LIMITS.maxFrameRate)
        || DEFAULTS.frameRate,
      width: boundedInteger(size.width, LIMITS.minSize, LIMITS.maxSize) || DEFAULTS.width,
      height: boundedInteger(size.height, LIMITS.minSize, LIMITS.maxSize) || DEFAULTS.height,
      anchor: PET_ANCHORS.includes(raw.anchor) ? raw.anchor : DEFAULTS.anchor,
      states
    }
  };
}

function statePrefixOf(fileName) {
  const lower = fileName.toLowerCase();
  for (const state of PET_STATES) {
    if (lower === `${state}.png` || lower.startsWith(`${state}-`) || lower.startsWith(`${state}_`)) {
      return state;
    }
  }
  return null;
}

// 纯函数：只给一堆实际存在的 PNG 文件名，也要推出一只能用的宠物。
// 这是「丢一张图就是一只宠物」的零门槛路径。
function resolvePetStates(options = {}) {
  const manifest = plainRecord(options.manifest) ? options.manifest : {};
  const available = [];
  for (const name of (Array.isArray(options.pngFiles) ? options.pngFiles : [])) {
    if (typeof name === 'string' && PNG_NAME_RE.test(name) && !available.includes(name)) {
      available.push(name);
    }
  }
  available.sort((a, b) => a.localeCompare(b, 'en'));
  if (!available.length) return { ok: false, reason: 'no-png' };

  const states = {};
  const dropped = [];
  const declared = plainRecord(manifest.states) ? manifest.states : {};
  for (const state of PET_STATES) {
    const list = Array.isArray(declared[state]) ? declared[state] : [];
    const frames = list.filter((name) => {
      const exists = available.includes(name);
      if (!exists) dropped.push({ state, frame: name, reason: 'missing-file' });
      return exists;
    }).slice(0, LIMITS.maxFrames);
    if (frames.length) states[state] = frames;
  }

  if (!Object.keys(states).length) {
    // manifest 没有可用声明：按文件名前缀分组；一个都认不出就整包当 idle 逐帧。
    const grouped = {};
    for (const name of available) {
      const state = statePrefixOf(name);
      if (!state) continue;
      if (!grouped[state]) grouped[state] = [];
      if (grouped[state].length < LIMITS.maxFrames) grouped[state].push(name);
    }
    if (Object.keys(grouped).length) Object.assign(states, grouped);
    else states.idle = available.slice(0, LIMITS.maxFrames);
  }

  // 缺哪个状态就回落 idle；idle 自己缺就借第一个有帧的状态兜底。
  if (!states.idle) {
    const donor = PET_STATES.find((state) => Array.isArray(states[state]) && states[state].length);
    if (!donor) return { ok: false, reason: 'no-usable-frames' };
    states.idle = states[donor];
  }
  return { ok: true, states, dropped };
}

// 只读 PNG 头：签名 + IHDR 尺寸上限。不解码像素，也不接受其他格式。
function inspectPngFile(filePath, fsImpl) {
  let handle;
  try {
    const stat = fsImpl.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, reason: 'not-a-regular-file' };
    if (stat.size < 24 || stat.size > LIMITS.maxPngBytes) return { ok: false, reason: 'bad-size' };
    handle = fsImpl.openSync(filePath, 'r');
    const head = Buffer.alloc(24);
    const read = fsImpl.readSync(handle, head, 0, 24, 0);
    if (read < 24 || !head.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return { ok: false, reason: 'not-a-png' };
    }
    if (head.toString('ascii', 12, 16) !== 'IHDR') return { ok: false, reason: 'not-a-png' };
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    if (width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide) {
      return { ok: false, reason: 'dimensions-out-of-range' };
    }
    return { ok: true, width, height };
  } catch (_error) {
    return { ok: false, reason: 'unreadable-file' };
  } finally {
    if (handle !== undefined) { try { fsImpl.closeSync(handle); } catch (_error) { /* ignore */ } }
  }
}

// 解析后的真实路径必须仍在包目录内，挡住 symlink/junction 逃逸。
function containedIn(rootDir, candidate, fsImpl) {
  try {
    const realRoot = normalizeRealPath(nativeRealpathSync(fsImpl)(rootDir));
    const realCandidate = normalizeRealPath(nativeRealpathSync(fsImpl)(candidate));
    const relative = path.relative(realRoot, realCandidate);
    return relative !== '' && !path.isAbsolute(relative)
      && relative !== '..' && !relative.startsWith(`..${path.sep}`);
  } catch (_error) {
    return false;
  }
}

function readPetPackage(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const dir = options.dir;
  const id = safeText(options.id, LIMITS.maxNameChars);
  if (typeof dir !== 'string' || !dir || !id || !PACKAGE_ID_RE.test(id)) {
    return { ok: false, id: id || String(options.id || ''), reason: 'invalid-id' };
  }
  let entries;
  try { entries = fsImpl.readdirSync(dir); } catch (_error) {
    return { ok: false, id, reason: 'unreadable-dir' };
  }

  let manifest = { ok: true, manifest: parseManifest({}).manifest };
  if (entries.includes('manifest.json')) {
    try {
      const manifestPath = path.join(dir, 'manifest.json');
      const stat = fsImpl.lstatSync(manifestPath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > LIMITS.maxManifestBytes) {
        manifest = { ok: false, reason: 'manifest-unreadable' };
      } else {
        manifest = parseManifest(String(fsImpl.readFileSync(manifestPath, 'utf8')));
      }
    } catch (_error) {
      manifest = { ok: false, reason: 'manifest-unreadable' };
    }
  }
  // 坏 manifest 不废掉整包：退回「目录里有什么图就用什么图」。
  const manifestData = manifest.ok ? manifest.manifest : parseManifest({}).manifest;
  const manifestIssue = manifest.ok ? null : manifest.reason;

  const pngFiles = [];
  const dropped = [];
  for (const name of entries.slice(0, LIMITS.maxEntries)) {
    if (typeof name !== 'string' || !PNG_NAME_RE.test(name)) continue;
    const filePath = path.join(dir, name);
    if (!containedIn(dir, filePath, fsImpl)) {
      dropped.push({ frame: name, reason: 'outside-package' });
      continue;
    }
    const inspected = inspectPngFile(filePath, fsImpl);
    if (!inspected.ok) { dropped.push({ frame: name, reason: inspected.reason }); continue; }
    pngFiles.push(name);
    if (pngFiles.length >= LIMITS.maxEntries) break;
  }

  const resolved = resolvePetStates({ manifest: manifestData, pngFiles });
  if (!resolved.ok) return { ok: false, id, reason: resolved.reason };

  const states = {};
  for (const state of PET_STATES) {
    if (resolved.states[state]) {
      states[state] = Object.freeze(resolved.states[state].map((name) => path.join(dir, name)));
    }
  }

  return {
    ok: true,
    package: Object.freeze({
      id,
      dir,
      source: options.source === 'builtin' ? 'builtin' : 'user',
      name: manifestData.name || id,
      author: manifestData.author,
      license: manifestData.license,
      frameRate: manifestData.frameRate,
      width: manifestData.width,
      height: manifestData.height,
      anchor: manifestData.anchor,
      singleImage: pngFiles.length === 1,
      states: Object.freeze(states),
      issues: Object.freeze([
        ...(manifestIssue ? [{ reason: manifestIssue }] : []),
        ...dropped,
        ...(resolved.dropped || [])
      ])
    })
  };
}

// 扫描内置与用户目录；单个包失败只影响它自己。
function listPetPackages(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const packages = [];
  const skipped = [];
  const seen = new Set();

  for (const root of roots) {
    if (!plainRecord(root) || typeof root.dir !== 'string' || !root.dir) continue;
    const source = root.source === 'builtin' ? 'builtin' : 'user';
    let names;
    try { names = fsImpl.readdirSync(root.dir); } catch (error) {
      // 目录不存在是正常状态（用户还没建 pets/），不算跳过。
      if (!error || error.code !== 'ENOENT') skipped.push({ id: root.dir, reason: 'unreadable-dir' });
      continue;
    }
    for (const name of names.slice(0, LIMITS.maxPackages).sort()) {
      if (packages.length >= LIMITS.maxPackages) break;
      if (typeof name !== 'string' || !PACKAGE_ID_RE.test(name)) continue;
      const id = `${source === 'builtin' ? 'builtin:' : 'user:'}${name}`;
      if (seen.has(id)) continue;
      const dir = path.join(root.dir, name);
      try {
        const stat = fsImpl.lstatSync(dir);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      } catch (_error) { continue; }
      const result = readPetPackage({ dir, id: name, source, fsImpl });
      if (!result.ok) { skipped.push({ id, reason: result.reason }); continue; }
      seen.add(id);
      packages.push(Object.freeze({ ...result.package, id }));
    }
  }
  return { packages, skipped };
}

// 缺帧回落 idle；返回渲染层需要的最小描述。
function petFrames(petPackage, state) {
  if (!petPackage || !plainRecord(petPackage.states)) return null;
  const wanted = PET_STATES.includes(state) ? state : 'idle';
  const frames = petPackage.states[wanted] || petPackage.states.idle;
  if (!Array.isArray(frames) || !frames.length) return null;
  return {
    state: petPackage.states[wanted] ? wanted : 'idle',
    requested: wanted,
    frames: [...frames],
    frameRate: petPackage.frameRate || DEFAULTS.frameRate
  };
}

function selectPetPackage(packages, petId) {
  const list = Array.isArray(packages) ? packages : [];
  const wanted = typeof petId === 'string' ? petId : null;
  return list.find((item) => item && item.id === wanted) || list[0] || null;
}

module.exports = {
  LIMITS,
  PET_STATES,
  PET_ANCHORS,
  DEFAULTS,
  parseManifest,
  resolvePetStates,
  readPetPackage,
  listPetPackages,
  petFrames,
  selectPetPackage,
  inspectPngFile
};
