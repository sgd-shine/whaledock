'use strict';

// 拍摄现场的纯 Node 核心。这里不读写文件、不联网，也不依赖 Electron；
// main 只负责把受信任的命令送进来，并按 planWriteback 的 wx 计划落盘。
const crypto = require('crypto');
const path = require('path');

const LIMITS = Object.freeze({
  sourceBytes: 512 * 1024,
  shots: 200,
  shotBytes: 64 * 1024,
  gapChars: 160,
  titleChars: 120,
  sessionIdChars: 80,
  relativePathChars: 512,
  durationSeconds: 3600
});

const SPEEDS = Object.freeze([0.6, 0.8, 1, 1.2, 1.5]);
const FONT_SIZES = Object.freeze([40, 48, 56, 64, 72, 84, 96]);
const MODES = Object.freeze(['checklist', 'teleprompter']);
const STATUSES = Object.freeze(['active', 'preview', 'finished']);
const OWNERSHIP_MARKER = '<!-- whaledock-owned: video-shooting/v1 -->';

function shootingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    throw shootingError(code, message);
  }
}

function utf8Bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function hasUnsafeControls(value) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function countCharacters(value) {
  return Array.from(value).length;
}

function hashText(text) {
  if (typeof text !== 'string') {
    throw shootingError('ERR_SHOOTING_TEXT', '待哈希内容必须是字符串');
  }
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function stripLeadingFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return text;
  const closing = lines.slice(1, 202).findIndex((line) => line === '---');
  if (closing < 0) return text;
  return lines.slice(closing + 2).join('\n').replace(/^\s+/, '');
}

function validateSourceText(text) {
  if (typeof text !== 'string') {
    throw shootingError('ERR_SHOOTING_TEXT', '口播稿必须是字符串');
  }
  if (utf8Bytes(text) > LIMITS.sourceBytes) {
    throw shootingError('ERR_SHOOTING_SOURCE_LIMIT', '口播稿超过本地拍摄现场上限');
  }
  if (hasUnsafeControls(text)) {
    throw shootingError('ERR_SHOOTING_CONTROL_CHAR', '口播稿含不安全控制字符');
  }
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) {
    throw shootingError('ERR_SHOOTING_EMPTY_SOURCE', '口播稿不能为空');
  }
  return normalized;
}

function validateShotText(text) {
  const normalized = text.trim();
  if (!normalized) {
    throw shootingError('ERR_SHOOTING_EMPTY_SHOT', '镜头内容不能为空');
  }
  if (utf8Bytes(normalized) > LIMITS.shotBytes) {
    throw shootingError('ERR_SHOOTING_SHOT_LIMIT', '单个镜头内容超过上限');
  }
  return normalized;
}

function validateLabel(value) {
  if (typeof value !== 'string' || !value.trim() || hasUnsafeControls(value)) {
    throw shootingError('ERR_SHOOTING_LABEL', '镜头标题无效');
  }
  const label = value.trim();
  if (countCharacters(label) > LIMITS.titleChars) {
    throw shootingError('ERR_SHOOTING_LABEL_LIMIT', '镜头标题超过上限');
  }
  return label;
}

function makeShot(index, label, text, options = {}) {
  return Object.freeze({
    id: `shot-${String(index + 1).padStart(3, '0')}`,
    ordinal: index + 1,
    sourceNumber: options.sourceNumber === undefined ? null : options.sourceNumber,
    label: validateLabel(label),
    text: validateShotText(text),
    durationSeconds: options.durationSeconds === undefined ? null : options.durationSeconds
  });
}

function ensureShotCount(count) {
  if (count > LIMITS.shots) {
    throw shootingError('ERR_SHOOTING_SHOT_COUNT', '镜头数量超过拍摄现场上限');
  }
}

function parseStructuredShots(text) {
  const markerPattern = /^\s*\[镜头\s+([1-9]\d{0,3})\s*[·•・]\s*约\s*([1-9]\d{0,3})\s*秒\s*\]\s*$/;
  const sections = [];
  let current = null;
  const numbers = new Set();

  for (const line of text.split('\n')) {
    const match = line.match(markerPattern);
    if (match) {
      if (current) sections.push(current);
      ensureShotCount(sections.length + 1);
      const sourceNumber = Number(match[1]);
      const durationSeconds = Number(match[2]);
      if (numbers.has(sourceNumber)) {
        throw shootingError('ERR_SHOOTING_DUPLICATE_NUMBER', `镜头编号 ${sourceNumber} 重复`);
      }
      if (durationSeconds > LIMITS.durationSeconds) {
        throw shootingError('ERR_SHOOTING_DURATION_LIMIT', `镜头 ${sourceNumber} 预计时长超过上限`);
      }
      numbers.add(sourceNumber);
      current = { sourceNumber, durationSeconds, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  if (!sections.length) return null;
  ensureShotCount(sections.length);

  return sections.map((section, index) => makeShot(
    index,
    `镜头 ${section.sourceNumber}`,
    section.lines.join('\n'),
    section
  ));
}

function parseHeadingShots(text) {
  const headingPattern = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
  const sections = [];
  let current = null;

  for (const line of text.split('\n')) {
    const match = line.match(headingPattern);
    if (match) {
      if (current) sections.push(current);
      ensureShotCount(sections.length + 1);
      current = { label: match[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  if (!sections.length) return null;
  ensureShotCount(sections.length);

  return sections.map((section, index) => {
    const label = validateLabel(section.label);
    const body = section.lines.join('\n').trim();
    // 空标题段仍是一条明确的稿件结构；使用标题原文，不凭空补口播内容。
    return makeShot(index, label, body || label);
  });
}

function parseVoiceScript(text) {
  const normalized = stripLeadingFrontMatter(validateSourceText(text));
  if (!normalized.trim()) {
    throw shootingError('ERR_SHOOTING_EMPTY_SOURCE', '口播稿正文不能为空');
  }

  const structured = parseStructuredShots(normalized);
  if (structured) {
    return Object.freeze({ format: 'structured', shots: Object.freeze(structured) });
  }

  const headings = parseHeadingShots(normalized);
  if (headings) {
    return Object.freeze({ format: 'headings', shots: Object.freeze(headings) });
  }

  return Object.freeze({
    format: 'whole',
    shots: Object.freeze([makeShot(0, '整稿', normalized)])
  });
}

function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || countCharacters(value) > LIMITS.relativePathChars || hasUnsafeControls(value)
      || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw shootingError('ERR_SHOOTING_SOURCE_PATH', '稿件路径必须是安全的 POSIX 相对路径');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw shootingError('ERR_SHOOTING_SOURCE_PATH', '稿件路径不能含空段、. 或 ..');
  }
  return value;
}

function validateSessionId(value) {
  if (typeof value !== 'string' || countCharacters(value) > LIMITS.sessionIdChars
      || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw shootingError('ERR_SHOOTING_SESSION_ID', 'sessionId 只允许字母、数字、下划线和短横线');
  }
  return value;
}

function validateSourceHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw shootingError('ERR_SHOOTING_SOURCE_HASH', 'sourceHash 必须是 SHA-256 十六进制串');
  }
  return value.toLowerCase();
}

function validateDocumentTitle(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || hasUnsafeControls(value)
      || countCharacters(value.trim()) > LIMITS.titleChars) {
    throw shootingError('ERR_SHOOTING_TITLE', '稿件标题无效或超过上限');
  }
  return value.trim();
}

function normalizeParsedDocument(document) {
  if (typeof document === 'string') return { parsed: parseVoiceScript(document), title: null };
  assertPlainObject(document, 'ERR_SHOOTING_DOCUMENT', 'document 必须是口播稿文本或解析结果');
  if (typeof document.text === 'string') {
    return { parsed: parseVoiceScript(document.text), title: validateDocumentTitle(document.title) };
  }
  if (!['structured', 'headings', 'whole'].includes(document.format)
      || !Array.isArray(document.shots) || !document.shots.length) {
    throw shootingError('ERR_SHOOTING_DOCUMENT', '解析结果缺少合法 format 或 shots');
  }
  ensureShotCount(document.shots.length);
  const shots = document.shots.map((shot, index) => {
    assertPlainObject(shot, 'ERR_SHOOTING_DOCUMENT', '解析结果含无效镜头');
    let durationSeconds = null;
    if (shot.durationSeconds !== null && shot.durationSeconds !== undefined) {
      if (!Number.isInteger(shot.durationSeconds) || shot.durationSeconds < 1
          || shot.durationSeconds > LIMITS.durationSeconds) {
        throw shootingError('ERR_SHOOTING_DURATION_LIMIT', '镜头预计时长无效');
      }
      durationSeconds = shot.durationSeconds;
    }
    return makeShot(index, shot.label, shot.text, {
      sourceNumber: Number.isInteger(shot.sourceNumber) ? shot.sourceNumber : null,
      durationSeconds
    });
  });
  return {
    parsed: Object.freeze({ format: document.format, shots: Object.freeze(shots) }),
    title: validateDocumentTitle(document.title)
  };
}

function sourceTitleFromPath(sourceRelativePath) {
  return path.posix.basename(sourceRelativePath).replace(/\.[^.]*$/, '') || '未命名稿件';
}

function createShootingSession(document, options) {
  assertPlainObject(options, 'ERR_SHOOTING_OPTIONS', '拍摄 session 参数缺失');
  const sessionId = validateSessionId(options.sessionId);
  const sourceRelativePath = validateRelativePath(options.sourceRelativePath);
  const sourceHash = validateSourceHash(options.sourceHash);
  const normalized = normalizeParsedDocument(document);
  const speed = options.speed === undefined ? 1 : options.speed;
  const fontSize = options.fontSize === undefined ? 64 : options.fontSize;
  if (!SPEEDS.includes(speed)) {
    throw shootingError('ERR_SHOOTING_SPEED', '提词速度不在允许档位');
  }
  if (!FONT_SIZES.includes(fontSize)) {
    throw shootingError('ERR_SHOOTING_FONT', '提词字号不在允许档位');
  }
  const sourceTitle = validateDocumentTitle(
    normalized.title || sourceTitleFromPath(sourceRelativePath)
  );

  const shots = normalized.parsed.shots.map((shot) => ({
    ...shot,
    confirmed: false,
    retakes: 0,
    gapReason: null
  }));
  return {
    schemaVersion: 1,
    sessionId,
    sourceRelativePath,
    sourceHash,
    sourceTitle,
    sourceFormat: normalized.parsed.format,
    status: 'active',
    mode: 'checklist',
    paused: true,
    speed,
    fontSize,
    currentIndex: 0,
    shots
  };
}

const COMMAND_KEYS = Object.freeze({
  mode: Object.freeze(['type']),
  pause: Object.freeze(['type']),
  next: Object.freeze(['type']),
  prev: Object.freeze(['type']),
  confirm: Object.freeze(['shotId', 'type']),
  unconfirm: Object.freeze(['shotId', 'type']),
  retake: Object.freeze(['repeat', 'shotId', 'type']),
  'set-speed': Object.freeze(['speed', 'type']),
  'set-font': Object.freeze(['fontSize', 'type']),
  'set-gap': Object.freeze(['reason', 'shotId', 'type']),
  'finish-preview': Object.freeze(['type']),
  'finish-confirm': Object.freeze(['type'])
});

function hasExactKeys(value, allowed, optional = []) {
  const keys = Object.keys(value).sort();
  const allowedSet = new Set(allowed);
  if (keys.some((key) => !allowedSet.has(key))) return false;
  return allowed.filter((key) => !optional.includes(key)).every((key) => keys.includes(key));
}

function validateShotId(value) {
  if (typeof value !== 'string' || !/^shot-\d{3}$/.test(value)) {
    throw shootingError('ERR_SHOOTING_SHOT_ID', 'shotId 格式无效');
  }
  return value;
}

function validateCommand(value) {
  assertPlainObject(value, 'ERR_SHOOTING_COMMAND', '拍摄命令必须是普通对象');
  if (typeof value.type !== 'string' || !Object.hasOwn(COMMAND_KEYS, value.type)) {
    throw shootingError('ERR_SHOOTING_COMMAND_TYPE', '拍摄命令不在白名单');
  }
  const optional = value.type === 'retake' ? ['repeat'] : [];
  if (!hasExactKeys(value, COMMAND_KEYS[value.type], optional)) {
    throw shootingError('ERR_SHOOTING_COMMAND_KEYS', '拍摄命令字段不符合精确白名单');
  }

  const command = { type: value.type };
  if (['confirm', 'unconfirm', 'retake', 'set-gap'].includes(value.type)) {
    command.shotId = validateShotId(value.shotId);
  }
  if (value.type === 'retake') {
    if (value.repeat !== undefined && typeof value.repeat !== 'boolean') {
      throw shootingError('ERR_SHOOTING_REPEAT', 'repeat 必须是布尔值');
    }
    command.repeat = value.repeat === true;
  }
  if (value.type === 'set-speed') {
    if (!SPEEDS.includes(value.speed)) {
      throw shootingError('ERR_SHOOTING_SPEED', '提词速度不在允许档位');
    }
    command.speed = value.speed;
  }
  if (value.type === 'set-font') {
    if (!FONT_SIZES.includes(value.fontSize)) {
      throw shootingError('ERR_SHOOTING_FONT', '提词字号不在允许档位');
    }
    command.fontSize = value.fontSize;
  }
  if (value.type === 'set-gap') {
    if (typeof value.reason !== 'string' || hasUnsafeControls(value.reason)
        || countCharacters(value.reason.trim()) > LIMITS.gapChars) {
      throw shootingError('ERR_SHOOTING_GAP', '素材缺口原因无效或超过上限');
    }
    command.reason = value.reason.trim();
  }
  return Object.freeze(command);
}

function assertSessionState(state) {
  assertPlainObject(state, 'ERR_SHOOTING_STATE', '拍摄 session 状态无效');
  validateSessionId(state.sessionId);
  validateRelativePath(state.sourceRelativePath);
  validateSourceHash(state.sourceHash);
  validateDocumentTitle(state.sourceTitle);
  if (!['structured', 'headings', 'whole'].includes(state.sourceFormat)
      || !STATUSES.includes(state.status) || !MODES.includes(state.mode)
      || typeof state.paused !== 'boolean' || !SPEEDS.includes(state.speed)
      || !FONT_SIZES.includes(state.fontSize) || !Array.isArray(state.shots)
      || !state.shots.length || state.shots.length > LIMITS.shots
      || !Number.isInteger(state.currentIndex) || state.currentIndex < 0
      || state.currentIndex >= state.shots.length) {
    throw shootingError('ERR_SHOOTING_STATE', '拍摄 session 状态字段无效');
  }
  const ids = new Set();
  for (const shot of state.shots) {
    if (!shot || typeof shot !== 'object') {
      throw shootingError('ERR_SHOOTING_STATE', '拍摄 session 含无效镜头');
    }
    validateShotId(shot.id);
    validateLabel(shot.label);
    validateShotText(shot.text);
    if (ids.has(shot.id) || !Number.isSafeInteger(shot.ordinal) || shot.ordinal < 1
        || typeof shot.confirmed !== 'boolean' || !Number.isSafeInteger(shot.retakes)
        || shot.retakes < 0 || (shot.gapReason !== null
          && (typeof shot.gapReason !== 'string' || hasUnsafeControls(shot.gapReason)
            || countCharacters(shot.gapReason) > LIMITS.gapChars))) {
      throw shootingError('ERR_SHOOTING_STATE', '拍摄 session 镜头状态无效');
    }
    ids.add(shot.id);
  }
}

function editableState(state) {
  if (state.status === 'finished') {
    throw shootingError('ERR_SHOOTING_FINISHED', '已收工的 session 不再接受拍摄命令');
  }
  return state.status === 'preview' ? { ...state, status: 'active' } : state;
}

function shotIndex(state, shotId) {
  const index = state.shots.findIndex((shot) => shot.id === shotId);
  if (index < 0) {
    throw shootingError('ERR_SHOOTING_UNKNOWN_SHOT', `session 中不存在 ${shotId}`);
  }
  return index;
}

function updateShot(state, index, updater, patch = {}) {
  const shots = state.shots.map((shot, shotPosition) => (
    shotPosition === index ? updater(shot) : shot
  ));
  return { ...state, ...patch, shots };
}

function reduceSession(state, rawCommand) {
  assertSessionState(state);
  const command = validateCommand(rawCommand);

  if (command.type === 'finish-confirm') {
    if (state.status === 'finished') return state;
    if (state.status !== 'preview') {
      throw shootingError('ERR_SHOOTING_FINISH_PHASE', '必须先预览收工摘要再确认收工');
    }
    return { ...state, status: 'finished', paused: true };
  }
  if (command.type === 'finish-preview') {
    if (state.status === 'finished') {
      throw shootingError('ERR_SHOOTING_FINISHED', '已收工的 session 不能重新预览');
    }
    if (state.status === 'preview') return state;
    return { ...state, status: 'preview', paused: true };
  }

  const editable = editableState(state);
  switch (command.type) {
    case 'mode':
      return {
        ...editable,
        mode: editable.mode === 'checklist' ? 'teleprompter' : 'checklist'
      };
    case 'pause':
      return { ...editable, paused: !editable.paused };
    case 'next':
      return {
        ...editable,
        currentIndex: Math.min(editable.currentIndex + 1, editable.shots.length - 1)
      };
    case 'prev':
      return { ...editable, currentIndex: Math.max(editable.currentIndex - 1, 0) };
    case 'confirm': {
      const index = shotIndex(editable, command.shotId);
      return updateShot(editable, index, (shot) => ({ ...shot, confirmed: true }));
    }
    case 'unconfirm': {
      const index = shotIndex(editable, command.shotId);
      return updateShot(editable, index, (shot) => ({ ...shot, confirmed: false }));
    }
    case 'retake': {
      if (command.repeat) return state;
      const index = shotIndex(editable, command.shotId);
      return updateShot(editable, index, (shot) => ({
        ...shot,
        confirmed: false,
        retakes: shot.retakes + 1
      }), { currentIndex: index, paused: true });
    }
    case 'set-speed':
      return { ...editable, speed: command.speed };
    case 'set-font':
      return { ...editable, fontSize: command.fontSize };
    case 'set-gap': {
      const index = shotIndex(editable, command.shotId);
      return updateShot(editable, index, (shot) => ({
        ...shot,
        gapReason: command.reason || null
      }));
    }
    default:
      // validateCommand 已封死白名单；这里是防止未来新增命令时忘记实现 reducer。
      throw shootingError('ERR_SHOOTING_COMMAND_UNHANDLED', '拍摄命令尚未实现');
  }
}

function progress(state) {
  assertSessionState(state);
  const total = state.shots.length;
  const confirmed = state.shots.filter((shot) => shot.confirmed).length;
  const ratio = total === 0 ? 0 : confirmed / total;
  return Object.freeze({
    total,
    confirmed,
    missing: total - confirmed,
    ratio,
    percent: Math.round(ratio * 100)
  });
}

function shotSummary(shot) {
  return Object.freeze({
    shotId: shot.id,
    ordinal: shot.ordinal,
    label: shot.label,
    retakes: shot.retakes
  });
}

function buildSummary(state) {
  assertSessionState(state);
  const confirmed = state.shots.filter((shot) => shot.confirmed).map(shotSummary);
  const missingShots = state.shots.filter((shot) => !shot.confirmed);
  const missing = missingShots.map(shotSummary);
  const retakes = state.shots.filter((shot) => shot.retakes > 0).map((shot) => Object.freeze({
    ...shotSummary(shot),
    count: shot.retakes
  }));
  const gaps = missingShots.map((shot) => Object.freeze({
    ...shotSummary(shot),
    reason: shot.gapReason,
    provided: shot.gapReason !== null
  }));
  const shootingProgress = progress(state);

  return Object.freeze({
    schemaVersion: 1,
    sessionId: state.sessionId,
    sourceRelativePath: state.sourceRelativePath,
    sourceHash: state.sourceHash,
    sourceTitle: state.sourceTitle,
    sourceFormat: state.sourceFormat,
    status: state.status,
    totalShots: shootingProgress.total,
    confirmedCount: shootingProgress.confirmed,
    missingCount: shootingProgress.missing,
    allConfirmed: shootingProgress.missing === 0,
    confirmed: Object.freeze(confirmed),
    missing: Object.freeze(missing),
    retakes: Object.freeze(retakes),
    gaps: Object.freeze(gaps)
  });
}

function safeFileStem(value) {
  let stem = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
    .replace(/\.+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[- ]+|[- ]+$/g, '');
  if (!stem || stem === '.' || stem === '..') stem = '未命名稿件';
  return Array.from(stem).slice(0, 60).join('').replace(/[- ]+$/g, '') || '未命名稿件';
}

function markdownCell(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function renderShotRows(shots, includeGap) {
  if (!shots.length) {
    return includeGap ? '| — | 无 | 0 | — |' : '| — | 无 | 0 |';
  }
  return shots.map((shot) => {
    const cells = [shot.ordinal, markdownCell(shot.label), shot.retakes];
    if (includeGap) cells.push(markdownCell(shot.reason === null ? '原因未填写' : shot.reason));
    return `| ${cells.join(' | ')} |`;
  }).join('\n');
}

function validateSummary(summary) {
  assertPlainObject(summary, 'ERR_SHOOTING_SUMMARY', '收工摘要无效');
  validateSessionId(summary.sessionId);
  validateRelativePath(summary.sourceRelativePath);
  validateSourceHash(summary.sourceHash);
  validateDocumentTitle(summary.sourceTitle);
  if (!['structured', 'headings', 'whole'].includes(summary.sourceFormat)
      || !STATUSES.includes(summary.status)
      || !Number.isSafeInteger(summary.totalShots) || summary.totalShots < 1
      || !Number.isSafeInteger(summary.confirmedCount) || summary.confirmedCount < 0
      || !Number.isSafeInteger(summary.missingCount) || summary.missingCount < 0
      || summary.confirmedCount + summary.missingCount !== summary.totalShots
      || !Array.isArray(summary.confirmed) || !Array.isArray(summary.missing)
      || !Array.isArray(summary.retakes) || !Array.isArray(summary.gaps)
      || summary.confirmed.length !== summary.confirmedCount
      || summary.missing.length !== summary.missingCount
      || summary.gaps.length !== summary.missingCount) {
    throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要计数不一致');
  }
  if (typeof summary.allConfirmed !== 'boolean'
      || summary.allConfirmed !== (summary.missingCount === 0)) {
    throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要完成状态不一致');
  }

  const validateEntry = (entry) => {
    if (!entry || typeof entry !== 'object') {
      throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要含无效镜头');
    }
    validateShotId(entry.shotId);
    validateLabel(entry.label);
    if (!Number.isSafeInteger(entry.ordinal) || entry.ordinal < 1
        || !Number.isSafeInteger(entry.retakes) || entry.retakes < 0) {
      throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要镜头字段无效');
    }
  };
  const shotIds = new Set();
  for (const entry of [...summary.confirmed, ...summary.missing]) {
    validateEntry(entry);
    if (shotIds.has(entry.shotId)) {
      throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要镜头重复');
    }
    shotIds.add(entry.shotId);
  }
  const missingIds = new Set(summary.missing.map((entry) => entry.shotId));
  const gapIds = new Set();
  for (const gap of summary.gaps) {
    validateEntry(gap);
    if (!missingIds.has(gap.shotId) || gapIds.has(gap.shotId)
        || (gap.reason !== null && (typeof gap.reason !== 'string'
          || hasUnsafeControls(gap.reason) || countCharacters(gap.reason) > LIMITS.gapChars))
        || typeof gap.provided !== 'boolean' || gap.provided !== (gap.reason !== null)) {
      throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要缺口字段无效');
    }
    gapIds.add(gap.shotId);
  }
  const retakeIds = new Set();
  for (const retake of summary.retakes) {
    validateEntry(retake);
    if (!shotIds.has(retake.shotId) || retakeIds.has(retake.shotId)
        || !Number.isSafeInteger(retake.count) || retake.count < 1
        || retake.count !== retake.retakes) {
      throw shootingError('ERR_SHOOTING_SUMMARY', '收工摘要重来字段无效');
    }
    retakeIds.add(retake.shotId);
  }
}

function planWriteback(summary) {
  validateSummary(summary);
  if (summary.status !== 'finished') {
    throw shootingError('ERR_SHOOTING_SUMMARY_STATUS', '只有确认收工后才能规划写回');
  }
  const sourceBase = path.posix.basename(summary.sourceRelativePath).replace(/\.[^.]*$/, '');
  const stem = safeFileStem(sourceBase);
  const sessionStem = safeFileStem(summary.sessionId);
  const recordPath = `05_拍摄记录/${stem}-${sessionStem}.md`;
  const gapsPath = `04_素材清单/${stem}-素材缺口-${sessionStem}.md`;
  if ([recordPath, gapsPath].some((relativePath) => relativePath.includes('..')
      || relativePath.startsWith('/') || relativePath.includes('\\'))) {
    throw shootingError('ERR_SHOOTING_OUTPUT_PATH', '写回计划生成了不安全路径');
  }

  const totalRetakes = summary.retakes.reduce((total, shot) => total + shot.count, 0);
  const recordMarkdown = [
    OWNERSHIP_MARKER,
    '---',
    'whaledock-schema: 1',
    'kind: shooting-session',
    `session-id: ${yamlString(summary.sessionId)}`,
    `source: ${yamlString(summary.sourceRelativePath)}`,
    `source-sha256: ${yamlString(summary.sourceHash)}`,
    '---',
    '',
    `# 拍摄收工记录 · ${markdownCell(summary.sourceTitle)}`,
    '',
    `- 已确认：${summary.confirmedCount}/${summary.totalShots}`,
    `- 未确认或缺拍：${summary.missingCount}`,
    `- 重来次数：${totalRetakes}`,
    '',
    '## 已确认镜头',
    '',
    '| 镜头 | 标题 | 重来次数 |',
    '| ---: | --- | ---: |',
    renderShotRows(summary.confirmed, false),
    '',
    '## 未确认或缺拍',
    '',
    '| 镜头 | 标题 | 重来次数 | 缺口原因 |',
    '| ---: | --- | ---: | --- |',
    renderShotRows(summary.gaps, true),
    '',
    '> 原口播稿未修改；本记录由拍摄现场收工确认后另建。',
    ''
  ].join('\n');

  const gapMarkdown = [
    OWNERSHIP_MARKER,
    '---',
    'whaledock-schema: 1',
    'kind: material-gaps',
    `session-id: ${yamlString(summary.sessionId)}`,
    `source: ${yamlString(summary.sourceRelativePath)}`,
    `source-sha256: ${yamlString(summary.sourceHash)}`,
    '---',
    '',
    `# 素材缺口 · ${markdownCell(summary.sourceTitle)}`,
    '',
    summary.gaps.length
      ? '以下镜头在本次收工时仍未确认；没有填写原因的条目保持“原因未填写”，不代替人猜。'
      : '本次收工没有未确认镜头。',
    '',
    '| 镜头 | 标题 | 重来次数 | 缺口原因 |',
    '| ---: | --- | ---: | --- |',
    renderShotRows(summary.gaps, true),
    '',
    '> 原口播稿未修改；本清单由拍摄现场收工确认后另建。',
    ''
  ].join('\n');

  const record = Object.freeze({
    kind: 'shooting-record',
    relativePath: recordPath,
    content: recordMarkdown,
    encoding: 'utf8',
    flag: 'wx'
  });
  const gaps = Object.freeze({
    kind: 'material-gaps',
    relativePath: gapsPath,
    content: gapMarkdown,
    encoding: 'utf8',
    flag: 'wx'
  });
  return Object.freeze({ record, gaps, files: Object.freeze([record, gaps]) });
}

function contentBuffer(value) {
  let content = value;
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)
      && !(value instanceof Uint8Array)) {
    if (!Object.hasOwn(value, 'content')) return null;
    content = value.content;
  }
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  return null;
}

function sameOwnedOutput(existing, planned) {
  const existingBytes = contentBuffer(existing);
  const plannedBytes = contentBuffer(planned);
  return existingBytes !== null && plannedBytes !== null && existingBytes.equals(plannedBytes);
}

module.exports = {
  LIMITS,
  SPEEDS,
  FONT_SIZES,
  hashText,
  parseVoiceScript,
  createShootingSession,
  validateCommand,
  reduceSession,
  progress,
  buildSummary,
  planWriteback,
  sameOwnedOutput
};
