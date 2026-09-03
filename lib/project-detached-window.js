'use strict';

// v0.11 批次 5：把已在 Host 边界内收窄的项目 / 窗格快照生成为可分离窗口文档。
//
// 本模块只生成静态 data HTML，不持有 BrowserWindow，不读取文件，不发起网络请求，也不
// 执行项目 HTML。调用方必须先在 Host 完成项目根授权与内容读取，再把这里声明的最小字段
// 传入。所有对象采用精确字段白名单，路径只能是 POSIX 相对引用。
const crypto = require('crypto');

const TAB_TYPES = Object.freeze([
  'markdown', 'text', 'image', 'browser', 'video-template', 'artifact', 'terminal'
]);
const ARTIFACT_KINDS = Object.freeze(['markdown', 'text', 'image', 'html']);
const LIMITS = Object.freeze({
  maxNameChars: 40,
  maxIconChars: 8,
  maxTabIdChars: 128,
  maxTabTitleChars: 120,
  maxRelativeRefBytes: 4096,
  maxTextBytes: 64 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  maxUrlChars: 4096,
  maxTemplateIdChars: 96,
  maxVersionChars: 64,
  maxHtmlBytes: 3 * 1024 * 1024
});
const ERROR_CODES = Object.freeze({
  input: 'ERR_PROJECT_DETACHED_INPUT',
  project: 'ERR_PROJECT_DETACHED_PROJECT',
  tab: 'ERR_PROJECT_DETACHED_TAB',
  path: 'ERR_PROJECT_DETACHED_PATH',
  url: 'ERR_PROJECT_DETACHED_URL',
  image: 'ERR_PROJECT_DETACHED_IMAGE',
  artifact: 'ERR_PROJECT_DETACHED_ARTIFACT',
  size: 'ERR_PROJECT_DETACHED_SIZE'
});

const PROJECT_ID_RE = /^proj_[a-f0-9]{32}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const TEMPLATE_ID_RE = /^(?:builtin|user):[^\\/:*?"<>|\u0000-\u001f\u007f]{1,64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const BLOCK_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function detachedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => keys.includes(key));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function displayText(value, maximum, code, field) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || value.length > maximum || CONTROL_RE.test(value)) {
    throw detachedError(code, `${field}无效`);
  }
  return value;
}

function contentText(value) {
  if (typeof value !== 'string' || BLOCK_CONTROL_RE.test(value)
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxTextBytes) {
    throw detachedError(ERROR_CODES.tab, '窗格文本无效或过大');
  }
  return value.replace(/\r\n?/g, '\n');
}

function relativeRef(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || Buffer.byteLength(value, 'utf8') > LIMITS.maxRelativeRefBytes
      || CONTROL_RE.test(value) || value.includes('\\') || value.startsWith('/')
      || /^[A-Za-z]:\//.test(value)) {
    throw detachedError(ERROR_CODES.path, '窗格文件引用必须是安全的相对路径');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw detachedError(ERROR_CODES.path, '窗格文件引用不能含空段、. 或 ..');
  }
  return value;
}

function browserUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || value.length > LIMITS.maxUrlChars || CONTROL_RE.test(value)) {
    throw detachedError(ERROR_CODES.url, '浏览器链接无效');
  }
  let parsed;
  try { parsed = new URL(value); } catch (_error) {
    throw detachedError(ERROR_CODES.url, '浏览器链接无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw detachedError(ERROR_CODES.url, '浏览器链接只允许无凭据的 http/https');
  }
  return parsed.href;
}

function canonicalBase64(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function dataImage(value) {
  if (typeof value !== 'string' || value.length > (LIMITS.maxImageBytes * 4 / 3) + 128) {
    throw detachedError(ERROR_CODES.image, '窗格图片无效或过大');
  }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw detachedError(ERROR_CODES.image, '窗格图片只允许 PNG 或 JPEG data URL');
  const bytes = canonicalBase64(match[2]);
  if (!bytes || bytes.length === 0 || bytes.length > LIMITS.maxImageBytes) {
    throw detachedError(ERROR_CODES.image, '窗格图片编码无效或过大');
  }
  const png = match[1] === 'png';
  const hasPngHeader = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const hasJpegHeader = bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((png && !hasPngHeader) || (!png && !hasJpegHeader)) {
    throw detachedError(ERROR_CODES.image, '窗格图片内容与声明类型不一致');
  }
  return value;
}

function baseTab(tab) {
  if (!plain(tab) || !TAB_TYPES.includes(tab.type)) {
    throw detachedError(ERROR_CODES.tab, '窗格标签无效');
  }
  return {
    id: displayText(tab.id, LIMITS.maxTabIdChars, ERROR_CODES.tab, '标签 id'),
    type: tab.type,
    title: displayText(tab.title, LIMITS.maxTabTitleChars, ERROR_CODES.tab, '标签标题')
  };
}

function validateTab(tab) {
  const base = baseTab(tab);
  const common = ['id', 'type', 'title'];
  if (base.type === 'markdown' || base.type === 'text') {
    if (!exactKeys(tab, [...common, 'relativeRef', 'text'])) {
      throw detachedError(ERROR_CODES.tab, '文件窗格字段无效');
    }
    return Object.freeze({
      ...base, relativeRef: relativeRef(tab.relativeRef), text: contentText(tab.text)
    });
  }
  if (base.type === 'terminal') {
    if (!exactKeys(tab, [...common, 'text'])) {
      throw detachedError(ERROR_CODES.tab, '终端窗格字段无效');
    }
    return Object.freeze({ ...base, text: contentText(tab.text) });
  }
  if (base.type === 'image') {
    if (!exactKeys(tab, [...common, 'relativeRef', 'dataUrl'])) {
      throw detachedError(ERROR_CODES.tab, '图片窗格字段无效');
    }
    return Object.freeze({
      ...base, relativeRef: relativeRef(tab.relativeRef), dataUrl: dataImage(tab.dataUrl)
    });
  }
  if (base.type === 'browser') {
    if (!exactKeys(tab, [...common, 'url'])) {
      throw detachedError(ERROR_CODES.tab, '浏览器窗格字段无效');
    }
    return Object.freeze({ ...base, url: browserUrl(tab.url) });
  }
  if (base.type === 'video-template') {
    if (!exactKeys(tab, [...common, 'templateId'])
        || typeof tab.templateId !== 'string' || tab.templateId.length > LIMITS.maxTemplateIdChars
        || !TEMPLATE_ID_RE.test(tab.templateId)) {
      throw detachedError(ERROR_CODES.tab, '短视频模板窗格字段无效');
    }
    return Object.freeze({ ...base, templateId: tab.templateId });
  }

  if (tab.locked !== true || !ARTIFACT_KINDS.includes(tab.artifactKind)) {
    throw detachedError(ERROR_CODES.artifact, '产物窗格必须是受支持的锁定产物');
  }
  const artifactCommon = [...common, 'locked', 'artifactKind', 'relativeRef'];
  const ref = relativeRef(tab.relativeRef);
  if (tab.artifactKind === 'markdown' || tab.artifactKind === 'text') {
    if (!exactKeys(tab, [...artifactCommon, 'text'])) {
      throw detachedError(ERROR_CODES.artifact, '文本产物窗格字段无效');
    }
    return Object.freeze({
      ...base, locked: true, artifactKind: tab.artifactKind,
      relativeRef: ref, text: contentText(tab.text)
    });
  }
  if (tab.artifactKind === 'image') {
    if (!exactKeys(tab, [...artifactCommon, 'dataUrl'])) {
      throw detachedError(ERROR_CODES.artifact, '图片产物窗格字段无效');
    }
    return Object.freeze({
      ...base, locked: true, artifactKind: 'image',
      relativeRef: ref, dataUrl: dataImage(tab.dataUrl)
    });
  }
  if (!exactKeys(tab, artifactCommon)) {
    throw detachedError(ERROR_CODES.artifact, 'HTML 产物窗格字段无效');
  }
  return Object.freeze({
    ...base, locked: true, artifactKind: 'html', relativeRef: ref
  });
}

function validateDetachedWindowInput(input) {
  if (!exactKeys(input, ['project', 'window', 'tab', 'appVersion'])) {
    throw detachedError(ERROR_CODES.input, '可分离窗口输入字段无效');
  }
  if (!exactKeys(input.project, ['projectId', 'name', 'icon'])
      || typeof input.project.projectId !== 'string'
      || !PROJECT_ID_RE.test(input.project.projectId)) {
    throw detachedError(ERROR_CODES.project, '项目详情无效');
  }
  const project = Object.freeze({
    projectId: input.project.projectId,
    name: displayText(
      input.project.name, LIMITS.maxNameChars, ERROR_CODES.project, '项目名称'
    ),
    icon: displayText(
      input.project.icon, LIMITS.maxIconChars, ERROR_CODES.project, '项目图标'
    )
  });
  if (!Number.isSafeInteger(input.window) || input.window < 1 || input.window > 16) {
    throw detachedError(ERROR_CODES.input, '窗口编号必须在 1–16 之间');
  }
  if (typeof input.appVersion !== 'string' || input.appVersion.length > LIMITS.maxVersionChars
      || !VERSION_RE.test(input.appVersion)) {
    throw detachedError(ERROR_CODES.input, '应用版本无效');
  }
  return Object.freeze({
    project, window: input.window, tab: validateTab(input.tab), appVersion: input.appVersion
  });
}

function referenceRow(relative) {
  return `<p class="reference"><span>项目内引用</span><code>${escapeHtml(relative)}</code></p>`;
}

function textPane(tab, className = '') {
  return `${Object.prototype.hasOwnProperty.call(tab, 'relativeRef')
    ? referenceRow(tab.relativeRef) : ''}<pre class="document ${className}">${escapeHtml(tab.text)}</pre>`;
}

function imagePane(tab) {
  return `${referenceRow(tab.relativeRef)}<figure><img src="${escapeHtml(tab.dataUrl)}" alt="${escapeHtml(tab.title)}"><figcaption>仅显示 Host 已收窄的 PNG/JPEG data 图片。</figcaption></figure>`;
}

function renderTab(tab) {
  if (tab.type === 'markdown') return textPane(tab, 'markdown');
  if (tab.type === 'text') return textPane(tab, 'plain-text');
  if (tab.type === 'terminal') {
    return `<p class="notice">终端窗格在此窗口中只显示已授权的文本快照；命令输入仍由 Host 控制。</p>${textPane(tab, 'terminal')}`;
  }
  if (tab.type === 'image') return imagePane(tab);
  if (tab.type === 'browser') {
    return `<section class="notice browser"><strong>远程内容未载入</strong><p>可分离窗口不会嵌入或请求这个网页。请返回鲸坞主窗口使用受控浏览器窗格。</p><code data-browser-url="true">${escapeHtml(tab.url)}</code></section>`;
  }
  if (tab.type === 'video-template') {
    return `<section class="notice"><strong>短视频模板</strong><p>模板交互保留在鲸坞主窗口；此处只保留安全身份。</p><code>${escapeHtml(tab.templateId)}</code></section>`;
  }
  if (tab.artifactKind === 'markdown' || tab.artifactKind === 'text') {
    return `<p class="artifact-lock">锁定产物</p>${textPane(tab, tab.artifactKind)}`;
  }
  if (tab.artifactKind === 'image') {
    return `<p class="artifact-lock">锁定产物</p>${imagePane(tab)}`;
  }
  return `<p class="artifact-lock">锁定产物</p>${referenceRow(tab.relativeRef)}<section class="notice"><strong>HTML 产物未执行</strong><p>项目 HTML 只能回到鲸坞主窗口，通过隔离的受控子窗口打开。</p></section>`;
}

const STYLE = `
:root{color-scheme:dark light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#07111b;color:#e9f4fb}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:flex;flex-direction:column;background:radial-gradient(circle at 8% 4%,#17334a 0,#07111b 42%)}
header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 20px;border-bottom:1px solid #ffffff1f;background:#0b1926e8}
.identity{min-width:0;display:flex;align-items:center;gap:11px}.icon{font-size:24px}.identity-text{min-width:0}.identity h1{overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap;font-size:16px}.identity p,.version{margin:3px 0 0;color:#9cb3c3;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
main{min-height:0;flex:1;overflow:auto;padding:20px;outline:none}.reference{display:flex;gap:10px;align-items:center;margin:0 0 12px;color:#9cb3c3;font-size:12px}.reference code{overflow-wrap:anywhere;color:#c8e7fa}
.document{min-height:calc(100% - 42px);margin:0;padding:18px;border:1px solid #ffffff20;border-radius:12px;background:#091722d9;color:#e9f4fb;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.terminal{color:#bceccf;background:#06110c}
.notice{max-width:760px;margin:20px auto;padding:18px;border:1px solid #ffffff24;border-radius:12px;background:#0c1e2bd9;line-height:1.6}.notice strong{display:block;margin-bottom:7px}.notice p{color:#b3c5d0}.notice code{display:block;overflow-wrap:anywhere;padding:10px;border-radius:7px;background:#07111b;color:#c8e7fa}
figure{margin:0;text-align:center}figure img{display:block;max-width:100%;max-height:calc(100vh - 190px);margin:auto;border-radius:10px;background:#fff}figcaption{margin-top:10px;color:#9cb3c3;font-size:12px}.artifact-lock{display:inline-block;margin:0 0 12px;padding:4px 9px;border-radius:999px;background:#123d30;color:#8af0bd;font-size:12px;font-weight:650}
footer{flex:none;padding:7px 20px;border-top:1px solid #ffffff17;color:#7892a4;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
@media(prefers-color-scheme:light){:root{background:#eff6fa;color:#102b3b}body{background:#eff6fa}header{background:#ffffffed;border-color:#17334a22}.identity p,.version,.reference,figcaption,footer{color:#5d7788}.reference code,.notice code{color:#174c6b}.document,.notice{background:#fff;color:#102b3b;border-color:#17334a26}.terminal{background:#10251b;color:#d9ffe9}.notice code{background:#e6f0f6}}
`;

const SCROLL_SCRIPT = `(()=>{'use strict';const root=document.getElementById('wd-detached-scroll');const key=root&&root.dataset.scrollKey;if(!root||!key)return;const save=()=>{try{sessionStorage.setItem(key,String(Math.max(0,Math.floor(root.scrollTop))))}catch(_error){}};try{const saved=sessionStorage.getItem(key);if(saved!==null){const value=Number(saved);if(Number.isFinite(value)&&value>=0)root.scrollTop=value}}catch(_error){}let queued=false;root.addEventListener('scroll',()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;save()})},{passive:true});addEventListener('pagehide',save)})();`;

function nonce() {
  return crypto.randomBytes(18).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createDetachedWindowDocument(input) {
  const value = validateDetachedWindowInput(input);
  const token = nonce();
  const csp = [
    "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'",
    "child-src 'none'", "connect-src 'none'", "font-src 'none'", "media-src 'none'",
    "worker-src 'none'", "manifest-src 'none'", "form-action 'none'", "navigate-to 'none'",
    'img-src data:', `style-src 'nonce-${token}'`, `script-src 'nonce-${token}'`
  ].join('; ');
  const title = `鲸坞 · ${value.project.name} · 窗口${value.window} · ${value.tab.title}`;
  const scrollKey = [
    'whaledock.detached-scroll.v1', value.project.projectId,
    `window-${value.window}`, `tab-${value.tab.id}`, `version-${value.appVersion}`
  ].join(':');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><title>${escapeHtml(title)}</title><style nonce="${token}">${STYLE}</style></head>
<body data-project-id="${escapeHtml(value.project.projectId)}" data-window="${value.window}" data-tab-id="${escapeHtml(value.tab.id)}" data-tab-type="${escapeHtml(value.tab.type)}" data-app-version="${escapeHtml(value.appVersion)}">
<header><div class="identity"><span class="icon" aria-hidden="true">${escapeHtml(value.project.icon)}</span><div class="identity-text"><h1>${escapeHtml(value.project.name)} · 窗口${value.window}</h1><p>${escapeHtml(value.tab.title)} · ${escapeHtml(value.tab.type)}</p></div></div><span class="version">WhaleDock ${escapeHtml(value.appVersion)}</span></header>
<main id="wd-detached-scroll" data-scroll-key="${escapeHtml(scrollKey)}" tabindex="0">${renderTab(value.tab)}</main>
<footer>${escapeHtml(value.project.projectId)} · window=${value.window} · tab=${escapeHtml(value.tab.id)} · version=${escapeHtml(value.appVersion)}</footer>
<script nonce="${token}">${SCROLL_SCRIPT}</script></body></html>`;
  if (Buffer.byteLength(html, 'utf8') > LIMITS.maxHtmlBytes) {
    throw detachedError(ERROR_CODES.size, '可分离窗口文档过大');
  }
  return Object.freeze({
    title,
    html,
    dataUrl: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  });
}

module.exports = Object.freeze({
  TAB_TYPES,
  ARTIFACT_KINDS,
  LIMITS,
  ERROR_CODES,
  escapeHtml,
  validateDetachedWindowInput,
  createDetachedWindowDocument
});
