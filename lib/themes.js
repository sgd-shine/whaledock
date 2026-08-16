'use strict';

// v0.5 皮肤主题：纯静态 JSON 解析。
// 只解析数据字段，绝不执行主题文件里的任何内容；坏文件跳过并给出原因。
// 保持纯 Node：不依赖 Electron，也不决定具体页面用哪个 token。
const fs = require('fs');
const path = require('path');
const { normalizeRealPath, nativeRealpathSync } = require('./config');

const LIMITS = Object.freeze({
  maxThemes: 200,
  maxFileBytes: 64 * 1024,
  maxNameChars: 40,
  maxAuthorChars: 80,
  maxIdChars: 64
});

const THEME_BASES = Object.freeze(['dark', 'light']);
const COLOR_KEYS = Object.freeze([
  'background', 'surface', 'border', 'primary', 'accent', 'text', 'textMuted'
]);
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const THEME_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// 主题文件全部缺色时的兜底，等于当前出厂品牌配色；保证主题体系整体失效也不变丑。
const FALLBACK_COLORS = Object.freeze({
  dark: Object.freeze({
    background: '#090e17',
    surface: '#101a2c',
    border: '#1e2a5e',
    primary: '#4f46e5',
    accent: '#22d3ee',
    text: '#e6edf7',
    textMuted: '#93a4bd'
  }),
  light: Object.freeze({
    background: '#f3f1ea',
    surface: '#ffffff',
    border: '#d7d3c8',
    primary: '#4f46e5',
    accent: '#0e7490',
    text: '#1b2430',
    textMuted: '#5b6675'
  })
});

const DEFAULT_THEME_ID = 'whaledock-dark';

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

function expandColor(value) {
  if (typeof value !== 'string' || !COLOR_RE.test(value)) return null;
  const hex = value.slice(1).toLowerCase();
  if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  return `#${hex}`;
}

// 纯函数：把任意 JSON 值收敛成一套主题；不合法的字段回落而不是抛错。
function parseTheme(value, options = {}) {
  const id = safeText(options.id, LIMITS.maxIdChars);
  if (!id || !THEME_ID_RE.test(id)) {
    return { ok: false, reason: 'invalid-id' };
  }
  let raw = value;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.maxFileBytes) {
      return { ok: false, id, reason: 'file-too-large' };
    }
    try { raw = JSON.parse(raw); } catch (_error) {
      return { ok: false, id, reason: 'invalid-json' };
    }
  }
  if (!plainRecord(raw)) return { ok: false, id, reason: 'not-an-object' };

  const base = THEME_BASES.includes(raw.base) ? raw.base : 'dark';
  const fallback = FALLBACK_COLORS[base];
  const source = plainRecord(raw.colors) ? raw.colors : {};
  const colors = {};
  let accepted = 0;
  for (const key of COLOR_KEYS) {
    const parsed = expandColor(source[key]);
    if (parsed) { accepted += 1; colors[key] = parsed; }
    else colors[key] = fallback[key];
  }
  if (accepted === 0) return { ok: false, id, reason: 'no-valid-colors' };

  return {
    ok: true,
    theme: Object.freeze({
      id,
      name: safeText(raw.name, LIMITS.maxNameChars) || id,
      author: safeText(raw.author, LIMITS.maxAuthorChars),
      source: options.source === 'builtin' ? 'builtin' : 'user',
      base,
      colors: Object.freeze(colors)
    })
  };
}

function builtinFallbackTheme(base = 'dark') {
  const key = THEME_BASES.includes(base) ? base : 'dark';
  return Object.freeze({
    id: key === 'light' ? 'whaledock-light' : DEFAULT_THEME_ID,
    name: key === 'light' ? '鲸坞浅色' : '鲸坞深色',
    author: null,
    source: 'builtin',
    base: key,
    colors: FALLBACK_COLORS[key]
  });
}

function themeIdFromFile(fileName) {
  if (typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.json')) return null;
  return fileName.slice(0, -5);
}

// 目录扫描：每个文件独立失败，只影响该文件。
function listThemes(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const themes = [];
  const skipped = [];
  const seen = new Set();

  for (const root of roots) {
    if (!plainRecord(root) || typeof root.dir !== 'string' || !root.dir) continue;
    const source = root.source === 'builtin' ? 'builtin' : 'user';
    let names;
    try { names = fsImpl.readdirSync(root.dir); } catch (error) {
      // 目录不存在是正常状态（用户还没建 themes/），不算跳过。
      if (!error || error.code !== 'ENOENT') skipped.push({ id: root.dir, reason: 'unreadable-dir' });
      continue;
    }
    for (const fileName of names.slice(0, LIMITS.maxThemes).sort()) {
      if (themes.length >= LIMITS.maxThemes) break;
      const id = themeIdFromFile(fileName);
      if (!id || !THEME_ID_RE.test(id)) continue;
      if (seen.has(id)) continue;
      const filePath = path.join(root.dir, fileName);
      let text;
      try {
        const stat = fsImpl.lstatSync(filePath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          skipped.push({ id, reason: 'not-a-regular-file' });
          continue;
        }
        if (stat.size > LIMITS.maxFileBytes) {
          skipped.push({ id, reason: 'file-too-large' });
          continue;
        }
        text = String(fsImpl.readFileSync(filePath, 'utf8'));
      } catch (_error) {
        skipped.push({ id, reason: 'unreadable-file' });
        continue;
      }
      const parsed = parseTheme(text, { id, source });
      if (!parsed.ok) { skipped.push({ id, reason: parsed.reason }); continue; }
      seen.add(id);
      themes.push(parsed.theme);
    }
  }
  return { themes, skipped };
}

function selectTheme(themes, themeId) {
  const list = Array.isArray(themes) ? themes : [];
  const wanted = typeof themeId === 'string' ? themeId : null;
  return list.find((item) => item && item.id === wanted)
    || list.find((item) => item && item.id === DEFAULT_THEME_ID)
    || list[0]
    || builtinFallbackTheme('dark');
}

// 供渲染层直接写进 :root 的 CSS 变量名，页面里不再各自造名字。
function cssVariables(theme) {
  const value = theme && plainRecord(theme.colors) ? theme.colors : FALLBACK_COLORS.dark;
  const base = THEME_BASES.includes(theme && theme.base) ? theme.base : 'dark';
  const vars = { '--wd-base': base };
  for (const key of COLOR_KEYS) {
    const name = `--wd-${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
    vars[name] = expandColor(value[key]) || FALLBACK_COLORS[base][key];
  }
  return vars;
}

// 只允许读取受控根：解析后的真实路径必须仍在根内。
function containedThemeDir(dir, rootDir, options = {}) {
  const fsImpl = options.fsImpl || fs;
  try {
    const realRoot = normalizeRealPath(nativeRealpathSync(fsImpl)(rootDir));
    const realDir = normalizeRealPath(nativeRealpathSync(fsImpl)(dir));
    if (realDir === realRoot) return true;
    const relative = path.relative(realRoot, realDir);
    return relative !== '' && !path.isAbsolute(relative)
      && relative !== '..' && !relative.startsWith(`..${path.sep}`);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  LIMITS,
  THEME_BASES,
  COLOR_KEYS,
  DEFAULT_THEME_ID,
  FALLBACK_COLORS,
  parseTheme,
  builtinFallbackTheme,
  listThemes,
  selectTheme,
  cssVariables,
  containedThemeDir
};
