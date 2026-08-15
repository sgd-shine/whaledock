'use strict';
// WhaleDock 更新检查与下载校验。纯 Node、零依赖，不包含 Electron 或用户标识。

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const RELEASE_API = 'https://api.github.com/repos/sgd-shine/whaledock/releases/latest';
const RELEASE_PAGE = 'https://github.com/sgd-shine/whaledock/releases/latest';
// 这是固定的产品 UA：不加版本、设备、配置、会话或任何用户标识。
const UPDATE_USER_AGENT = 'WhaleDock-Update';
const DEFAULT_CHECK_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

function updateError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function normalizedVersionInput(value, label = '版本号') {
  if (typeof value !== 'string' || !value.trim()) {
    throw updateError('ERR_INVALID_VERSION', `${label}必须是非空 SemVer 字符串`);
  }
  const trimmed = value.trim();
  return /^[vV]/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

// 严格 SemVer 2.0.0：核心三段必须完整，数字段不允许前导零。
// Git tag 常见的单个 v/V 前缀仅在输入边界被移除。
function parseVersion(value, label = '版本号') {
  const normalized = normalizedVersionInput(value, label);
  const match = normalized.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
  );
  if (!match) {
    throw updateError('ERR_INVALID_VERSION', `${label}不是合法 SemVer：${value}`);
  }

  const prerelease = match[4] ? match[4].split('.') : [];
  const build = match[5] ? match[5].split('.') : [];
  for (const identifier of [...prerelease, ...build]) {
    if (!identifier || !/^[0-9A-Za-z-]+$/.test(identifier)) {
      throw updateError('ERR_INVALID_VERSION', `${label}不是合法 SemVer：${value}`);
    }
  }
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && !/^(?:0|[1-9]\d*)$/.test(identifier)) {
      throw updateError('ERR_INVALID_VERSION', `${label}的预发布数字不能有前导零：${value}`);
    }
  }

  return {
    source: value,
    version: normalized,
    core: [match[1], match[2], match[3]],
    prerelease,
    build
  };
}

function compareNumericStrings(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumericStrings(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// 返回 -1 / 0 / 1；构建元数据不参与优先级比较。非法输入明确抛错。
function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue, '左侧版本号');
  const right = parseVersion(rightValue, '右侧版本号');

  for (let index = 0; index < left.core.length; index += 1) {
    const coreResult = compareNumericStrings(left.core[index], right.core[index]);
    if (coreResult) return coreResult;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const result = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result) return result;
  }
  return 0;
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw updateError('ERR_INVALID_URL', `${label}不是合法 URL`, error);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw updateError('ERR_INVALID_URL', `${label}必须是不含账号信息的 HTTPS URL`);
  }
  return parsed;
}

function normalizeAsset(asset, index) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw updateError('ERR_INVALID_RELEASE', `Release assets[${index}] 格式不正确`);
  }
  if (typeof asset.name !== 'string' || !asset.name) {
    throw updateError('ERR_INVALID_RELEASE', `Release assets[${index}] 缺少 name`);
  }
  const sourceUrl = asset.browser_download_url || asset.url;
  const parsedUrl = requireHttpsUrl(sourceUrl, `Release 资产 ${asset.name}`);
  const size = asset.size == null ? null : Number(asset.size);
  if (size !== null && (!Number.isSafeInteger(size) || size < 0)) {
    throw updateError('ERR_INVALID_RELEASE', `Release 资产 ${asset.name} 的 size 无效`);
  }
  return {
    name: asset.name,
    url: parsedUrl.href,
    browser_download_url: parsedUrl.href,
    size,
    contentType: typeof asset.content_type === 'string' ? asset.content_type : null
  };
}

function normalizeRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw updateError('ERR_INVALID_RELEASE', 'GitHub Release 必须是对象');
  }
  if (typeof release.tag_name !== 'string') {
    throw updateError('ERR_INVALID_RELEASE', 'GitHub Release 缺少 tag_name');
  }
  const parsedVersion = parseVersion(release.tag_name, 'Release tag_name');
  if (!Array.isArray(release.assets)) {
    throw updateError('ERR_INVALID_RELEASE', 'GitHub Release 缺少 assets 数组');
  }

  const releaseUrl = release.html_url == null
    ? RELEASE_PAGE
    : requireHttpsUrl(release.html_url, 'Release 页面').href;
  return {
    tag: release.tag_name,
    version: parsedVersion.version,
    url: releaseUrl,
    name: typeof release.name === 'string' ? release.name : '',
    notes: typeof release.body === 'string' ? release.body : '',
    draft: release.draft === true,
    prerelease: release.prerelease === true,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    assets: release.assets.map(normalizeAsset)
  };
}

function normalizePlatform(platform) {
  if (platform === 'darwin' || platform === 'mac') return 'mac';
  if (platform === 'win32' || platform === 'windows' || platform === 'win') return 'win';
  throw updateError('ERR_UNSUPPORTED_PLATFORM', `不支持的更新平台：${platform}`);
}

function expectedAssetNames(versionValue, platformValue, arch, options = {}) {
  const version = parseVersion(versionValue).version;
  const platform = normalizePlatform(platformValue);
  if (platform === 'mac') {
    if (arch !== 'arm64' && arch !== 'x64') {
      throw updateError('ERR_UNSUPPORTED_ARCH', `macOS 不支持的架构：${arch}`);
    }
    const kind = options.kind || 'dmg';
    if (kind !== 'dmg' && kind !== 'zip') {
      throw updateError('ERR_UNSUPPORTED_ASSET_KIND', `macOS 不支持的资产类型：${kind}`);
    }
    return {
      version,
      platform,
      arch,
      kind,
      assetName: kind === 'dmg'
        ? `WhaleDock-${version}-${arch}.dmg`
        : `WhaleDock-${version}-${arch}-mac.zip`,
      checksumName: 'SHA256SUMS-mac.txt'
    };
  }

  if (arch !== 'x64') {
    throw updateError('ERR_UNSUPPORTED_ARCH', `Windows 不支持的架构：${arch}`);
  }
  const kind = options.kind || 'installer';
  if (kind !== 'installer' && kind !== 'portable') {
    throw updateError('ERR_UNSUPPORTED_ASSET_KIND', `Windows 不支持的资产类型：${kind}`);
  }
  return {
    version,
    platform,
    arch,
    kind,
    assetName: kind === 'installer'
      ? `WhaleDock-Setup-${version}.exe`
      : `WhaleDock-${version}-portable.exe`,
    checksumName: 'SHA256SUMS-win.txt'
  };
}

function exactAsset(assets, name) {
  const matches = assets.filter((asset) => asset.name === name);
  if (!matches.length) {
    throw updateError('ERR_ASSET_NOT_FOUND', `Release 缺少资产：${name}`);
  }
  if (matches.length > 1) {
    throw updateError('ERR_DUPLICATE_ASSET', `Release 存在重名资产：${name}`);
  }
  return matches[0];
}

// 默认挑 macOS DMG 或 Windows NSIS Setup；kind=zip/portable 可精确选另一个产物。
function pickAsset(release, platform, arch, options = {}) {
  const normalized = normalizeRelease(release);
  const expected = expectedAssetNames(normalized.version, platform, arch, options);
  const asset = exactAsset(normalized.assets, expected.assetName);
  const checksumAsset = exactAsset(normalized.assets, expected.checksumName);
  return {
    ...expected,
    tag: normalized.tag,
    releaseUrl: normalized.url,
    releaseNotes: normalized.notes,
    asset,
    checksumAsset,
    // 兼容调用端偏好的简称，两者指向同一个不可变语义对象。
    checksum: checksumAsset
  };
}

function parseSha256Sums(text) {
  if (typeof text !== 'string') {
    throw updateError('ERR_INVALID_CHECKSUMS', '校验和内容必须是字符串');
  }
  const entries = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    let digest;
    let filename;
    const bsd = line.match(/^SHA256 \((.+)\) = ([a-fA-F0-9]{64})$/);
    if (bsd) {
      filename = bsd[1];
      digest = bsd[2];
    } else {
      const gnu = line.match(/^([a-fA-F0-9]{64})[ \t]+\*?(.+?)$/);
      if (!gnu) {
        throw updateError('ERR_INVALID_CHECKSUMS', `无法解析校验和行：${rawLine}`);
      }
      digest = gnu[1];
      filename = gnu[2].trim();
    }
    if (!filename) {
      throw updateError('ERR_INVALID_CHECKSUMS', '校验和条目缺少文件名');
    }
    if (entries.has(filename)) {
      throw updateError('ERR_INVALID_CHECKSUMS', `校验和文件存在重名条目：${filename}`);
    }
    entries.set(filename, digest.toLowerCase());
  }
  if (!entries.size) {
    throw updateError('ERR_INVALID_CHECKSUMS', '校验和文件中没有有效条目');
  }
  return entries;
}

function checksumForAsset(textOrEntries, filename) {
  const entries = textOrEntries instanceof Map ? textOrEntries : parseSha256Sums(textOrEntries);
  const digest = entries.get(filename);
  if (!digest) {
    throw updateError('ERR_CHECKSUM_NOT_FOUND', `校验和文件缺少资产：${filename}`);
  }
  return digest;
}

function normalizeSha256(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw updateError('ERR_INVALID_SHA256', 'SHA-256 必须是 64 位十六进制字符串');
  }
  return value.toLowerCase();
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (error) => reject(updateError(
      'ERR_READ_UPDATE_FILE', `无法读取待校验文件：${filePath}`, error
    )));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifySha256(filePath, expectedDigest) {
  const expected = Buffer.from(normalizeSha256(expectedDigest), 'hex');
  const actual = Buffer.from(await sha256File(filePath), 'hex');
  return crypto.timingSafeEqual(actual, expected);
}

function fixedRequestHeaders(accept) {
  return {
    Accept: accept,
    'User-Agent': UPDATE_USER_AGENT
  };
}

function responseContentLength(response) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
  const value = response.headers.get('content-length');
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function boundedResponseText(response, maxBytes) {
  const declaredLength = responseContentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw updateError('ERR_RESPONSE_TOO_LARGE', `GitHub 版本响应超过 ${maxBytes} 字节`);
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        bytes += chunk.length;
        if (bytes > maxBytes) {
          try { await reader.cancel(); } catch (_error) { /* 已决定拒绝响应 */ }
          throw updateError('ERR_RESPONSE_TOO_LARGE', `GitHub 版本响应超过 ${maxBytes} 字节`);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      try { reader.releaseLock(); } catch (_error) { /* ignore */ }
    }
  }

  if (typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw updateError('ERR_RESPONSE_TOO_LARGE', `GitHub 版本响应超过 ${maxBytes} 字节`);
    }
    return text;
  }
  return null;
}

async function responseJson(response, maxBytes) {
  const text = await boundedResponseText(response, maxBytes);
  if (text !== null) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw updateError('ERR_INVALID_RELEASE_RESPONSE', 'GitHub 版本响应不是合法 JSON', error);
    }
  }
  // 便于 smoke 注入最小 fetch fixture；真实 Fetch Response 会走上面的限长文本分支。
  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch (error) {
      throw updateError('ERR_INVALID_RELEASE_RESPONSE', 'GitHub 版本响应不是合法 JSON', error);
    }
  }
  throw updateError('ERR_INVALID_RELEASE_RESPONSE', 'fetch 响应缺少 text/json 方法');
}

function fetchImplementation(options) {
  const implementation = options.fetchImpl || options.fetch || globalThis.fetch;
  if (typeof implementation !== 'function') {
    throw updateError('ERR_FETCH_UNAVAILABLE', '当前 Node 环境无 fetch，且未注入 fetchImpl');
  }
  return implementation;
}

// 只请求固定 releases/latest 端点。调用方不能追加查询参数或自定义头。
async function fetchLatestRelease(options = {}) {
  const fetchImpl = fetchImplementation(options);
  const timeoutMs = options.timeoutMs == null ? DEFAULT_CHECK_TIMEOUT_MS : Number(options.timeoutMs);
  const maxBytes = options.maxResponseBytes == null
    ? DEFAULT_MAX_RESPONSE_BYTES
    : Number(options.maxResponseBytes);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw updateError('ERR_INVALID_OPTION', 'timeoutMs 必须是正数');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw updateError('ERR_INVALID_OPTION', 'maxResponseBytes 必须是正整数');
  }

  const controller = new AbortController();
  let timer = null;
  const operation = Promise.resolve().then(async () => {
    const response = await fetchImpl(RELEASE_API, {
      method: 'GET',
      headers: fixedRequestHeaders('application/vnd.github+json'),
      redirect: 'error',
      signal: controller.signal
    });
    if (!response || typeof response !== 'object') {
      throw updateError('ERR_INVALID_RELEASE_RESPONSE', 'fetch 未返回响应对象');
    }
    const status = Number(response.status);
    if (status !== 200 || response.ok === false) {
      throw updateError(
        'ERR_RELEASE_HTTP',
        `GitHub 版本检查返回 HTTP ${Number.isFinite(status) ? status : '未知'}`
      );
    }
    const data = await responseJson(response, maxBytes);
    const release = normalizeRelease(data);
    if (release.draft || release.prerelease) {
      throw updateError('ERR_INVALID_RELEASE', 'releases/latest 返回了草稿或预发布版本');
    }
    return release;
  });
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(updateError('ERR_UPDATE_TIMEOUT', `检查更新超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error && error.code) throw error;
    if (controller.signal.aborted) {
      throw updateError('ERR_UPDATE_TIMEOUT', `检查更新超过 ${timeoutMs}ms`, error);
    }
    throw updateError('ERR_UPDATE_FETCH', `检查更新失败：${error && error.message ? error.message : error}`, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// checkUpdates/enabled=false 时在调用 fetch 之前返回，便于主进程与 smoke 双重证明关闭后零请求。
async function checkForUpdate(currentVersionValue, options = {}) {
  const currentVersion = parseVersion(currentVersionValue, '当前版本号').version;
  const enabled = options.enabled !== false && options.checkUpdates !== false;
  if (!enabled) {
    return {
      checked: false,
      reason: 'disabled',
      currentVersion,
      latestVersion: null,
      newerVersionAvailable: false,
      updateAvailable: false,
      skipped: false,
      release: null,
      selection: null
    };
  }

  const release = await fetchLatestRelease(options);
  const newerVersionAvailable = compareVersions(release.version, currentVersion) > 0;
  let skipped = false;
  if (options.skipVersion !== null && options.skipVersion !== undefined && options.skipVersion !== '') {
    skipped = newerVersionAvailable && compareVersions(release.version, options.skipVersion) === 0;
  }
  const updateAvailable = newerVersionAvailable && !skipped;
  const selection = updateAvailable && options.platform
    ? pickAsset({
      tag_name: release.tag,
      html_url: release.url,
      name: release.name,
      body: release.notes,
      draft: release.draft,
      prerelease: release.prerelease,
      published_at: release.publishedAt,
      assets: release.assets.map((asset) => ({
        name: asset.name,
        browser_download_url: asset.url,
        size: asset.size,
        content_type: asset.contentType
      }))
    }, options.platform, options.arch || process.arch, { kind: options.kind })
    : null;

  return {
    checked: true,
    reason: updateAvailable ? 'update-available' : (skipped ? 'skipped' : 'up-to-date'),
    currentVersion,
    latestVersion: release.version,
    newerVersionAvailable,
    updateAvailable,
    skipped,
    release,
    selection
  };
}

function retryDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Windows 上 WriteStream close 后杀毒软件仍可能短暂占用文件。
// 只对典型占用错误做小步、有上限的重试，不吞其他文件系统错误。
async function unlinkIfPresent(filePath, options = {}) {
  const attempts = options.attempts == null ? 6 : options.attempts;
  const retryable = new Set(['EBUSY', 'EPERM', 'EACCES']);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.promises.unlink(filePath);
      return;
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      if (!error || !retryable.has(error.code) || attempt === attempts - 1) throw error;
      await retryDelay(Math.min(200, 25 * (2 ** attempt)));
    }
  }
}

function waitForWriterClose(stream) {
  if (!stream || stream.closed === true) return Promise.resolve();
  return new Promise((resolve) => stream.once('close', resolve));
}

// 资产下载只允许 HTTPS，最多跟随 5 次 HTTPS 重定向，且用 .part 文件避免暴露半包。
// expectedSha256 可选；传入时在同一次流式下载中计算并核对。
async function downloadFile(urlValue, destinationValue, options = {}) {
  const initialUrl = requireHttpsUrl(urlValue, '下载地址');
  if (typeof destinationValue !== 'string' || !destinationValue) {
    throw updateError('ERR_INVALID_DESTINATION', '下载目标路径不能为空');
  }
  const destination = path.resolve(destinationValue);
  const timeoutMs = options.timeoutMs == null
    ? DEFAULT_DOWNLOAD_TIMEOUT_MS
    : Number(options.timeoutMs);
  const maxBytes = options.maxBytes == null ? DEFAULT_DOWNLOAD_MAX_BYTES : Number(options.maxBytes);
  const maxRedirects = options.maxRedirects == null
    ? DEFAULT_MAX_REDIRECTS
    : Number(options.maxRedirects);
  const idleTimeoutMs = options.idleTimeoutMs == null ? 30000 : Number(options.idleTimeoutMs);
  const requestImpl = options.request || https.get;
  const expected = options.expectedSha256 == null ? null : normalizeSha256(options.expectedSha256);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw updateError('ERR_INVALID_OPTION', '下载超时必须是正数');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw updateError('ERR_INVALID_OPTION', 'maxBytes 必须是正整数');
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw updateError('ERR_INVALID_OPTION', 'maxRedirects 必须是 0–10 的整数');
  }
  if (typeof requestImpl !== 'function') {
    throw updateError('ERR_INVALID_OPTION', 'request 必须是 https.get 兼容函数');
  }

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  if (!options.overwrite) {
    try {
      await fs.promises.access(destination, fs.constants.F_OK);
      throw updateError('ERR_DESTINATION_EXISTS', `下载目标已存在：${destination}`);
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }
  const partial = `${destination}.part-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;
    let response = null;
    let writer = null;
    let totalTimer = null;
    let finalUrl = initialUrl.href;
    let bytes = 0;
    let totalBytes = null;
    let responseEnded = false;
    const hash = crypto.createHash('sha256');

    const stopIo = () => {
      try { if (request) request.destroy(); } catch (_error) { /* ignore */ }
      try { if (response) response.destroy(); } catch (_error) { /* ignore */ }
      try { if (writer) writer.destroy(); } catch (_error) { /* ignore */ }
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      // 必须在 destroy 之前订阅 close，否则 Windows 上立即 unlink
      // 可因句柄未释放而 EBUSY/EPERM。
      const writerClosed = waitForWriterClose(writer);
      stopIo();
      const finalError = error && error.code ? error : updateError(
          'ERR_DOWNLOAD_FAILED',
          `下载更新失败：${error && error.message ? error.message : error}`,
          error
      );
      writerClosed.then(() => unlinkIfPresent(partial)).catch((cleanupError) => {
        // 不用清理错误覆盖真正的下载失败，但保留它供日志定位。
        finalError.cleanupError = cleanupError;
      }).finally(() => {
        reject(finalError);
      });
    };
    const succeed = async () => {
      if (settled) return;
      let digest;
      try {
        digest = hash.digest('hex');
        if (expected && digest !== expected) {
          throw updateError(
            'ERR_SHA256_MISMATCH',
            `更新包 SHA-256 校验失败（期望 ${expected}，实际 ${digest}）`
          );
        }
        if (options.overwrite) {
          await unlinkIfPresent(destination);
          await fs.promises.rename(partial, destination);
        } else {
          // access() 只用于早失败；真正提交由 COPYFILE_EXCL 独占创建，
          // 避免检查后到 rename 前被其他进程抢占并覆盖。
          try {
            await fs.promises.copyFile(partial, destination, fs.constants.COPYFILE_EXCL);
          } catch (error) {
            if (error && error.code === 'EEXIST') {
              throw updateError('ERR_DESTINATION_EXISTS', `下载目标已存在：${destination}`, error);
            }
            throw error;
          }
          await unlinkIfPresent(partial);
        }
      } catch (error) {
        fail(error);
        return;
      }
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      resolve({ path: destination, bytes, sha256: digest, url: finalUrl });
    };

    const requestUrl = (url, redirectCount) => {
      finalUrl = url.href;
      try {
        request = requestImpl(url, {
          method: 'GET',
          headers: fixedRequestHeaders('application/octet-stream')
        }, (incoming) => {
          response = incoming;
          const status = Number(incoming.statusCode);
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = incoming.headers && incoming.headers.location;
            incoming.resume();
            if (!location) {
              fail(updateError('ERR_DOWNLOAD_REDIRECT', '下载重定向缺少 Location'));
              return;
            }
            if (redirectCount >= maxRedirects) {
              fail(updateError('ERR_DOWNLOAD_REDIRECT', `下载重定向超过 ${maxRedirects} 次`));
              return;
            }
            let nextUrl;
            try {
              nextUrl = requireHttpsUrl(new URL(location, url).href, '下载重定向');
            } catch (error) {
              fail(error);
              return;
            }
            requestUrl(nextUrl, redirectCount + 1);
            return;
          }
          if (status !== 200) {
            incoming.resume();
            fail(updateError('ERR_DOWNLOAD_HTTP', `下载返回 HTTP ${Number.isFinite(status) ? status : '未知'}`));
            return;
          }

          const rawContentLength = incoming.headers && incoming.headers['content-length'];
          if (rawContentLength !== undefined) {
            if (Array.isArray(rawContentLength) || !/^(?:0|[1-9]\d*)$/.test(String(rawContentLength))) {
              fail(updateError('ERR_INVALID_CONTENT_LENGTH', '下载响应的 Content-Length 无效'));
              return;
            }
            totalBytes = Number(rawContentLength);
            if (!Number.isSafeInteger(totalBytes)) {
              fail(updateError('ERR_INVALID_CONTENT_LENGTH', '下载响应的 Content-Length 过大'));
              return;
            }
            if (totalBytes > maxBytes) {
              fail(updateError('ERR_DOWNLOAD_TOO_LARGE', `更新包超过 ${maxBytes} 字节`));
              return;
            }
          }
          writer = fs.createWriteStream(partial, { flags: 'wx' });
          writer.on('error', fail);
          incoming.on('error', fail);
          incoming.on('aborted', () => fail(updateError('ERR_DOWNLOAD_ABORTED', '更新包下载中断')));
          incoming.once('end', () => {
            responseEnded = true;
            if (totalBytes !== null && bytes !== totalBytes) {
              fail(updateError(
                'ERR_DOWNLOAD_LENGTH_MISMATCH',
                `更新包长度不符（Content-Length ${totalBytes}，实际 ${bytes}）`
              ));
            }
          });
          incoming.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              fail(updateError('ERR_DOWNLOAD_TOO_LARGE', `更新包超过 ${maxBytes} 字节`));
              return;
            }
            hash.update(chunk);
            if (typeof options.onProgress === 'function') {
              try {
                options.onProgress({
                  received: bytes,
                  total: totalBytes,
                  percent: totalBytes ? Math.min(100, bytes / totalBytes * 100) : null
                });
              } catch (_error) { /* 进度日志不能打断下载 */ }
            }
          });
          writer.once('close', () => {
            if (!responseEnded) {
              fail(updateError('ERR_DOWNLOAD_INCOMPLETE', '更新包未完整下载'));
              return;
            }
            succeed();
          });
          incoming.pipe(writer);
        });
        if (!request || typeof request.on !== 'function') {
          fail(updateError('ERR_DOWNLOAD_FAILED', 'request 未返回 ClientRequest'));
          return;
        }
        if (typeof request.setTimeout === 'function') {
          request.setTimeout(idleTimeoutMs, () => fail(updateError(
            'ERR_DOWNLOAD_TIMEOUT', `下载连续 ${idleTimeoutMs}ms 无响应`
          )));
        }
        request.on('error', fail);
      } catch (error) {
        fail(error);
      }
    };

    totalTimer = setTimeout(() => fail(updateError(
      'ERR_DOWNLOAD_TIMEOUT', `下载总时长超过 ${timeoutMs}ms`
    )), timeoutMs);
    requestUrl(initialUrl, 0);
  });
}

module.exports = {
  RELEASE_API,
  RELEASE_PAGE,
  UPDATE_USER_AGENT,
  parseVersion,
  compareVersions,
  normalizeRelease,
  expectedAssetNames,
  pickAsset,
  parseSha256Sums,
  parseChecksumFile: parseSha256Sums,
  checksumForAsset,
  sha256File,
  verifySha256,
  fetchLatestRelease,
  checkForUpdate,
  check: checkForUpdate,
  downloadFile
};
