'use strict';
// 为实际打包的 vendor runtime 生成/核验第三方包清单与许可证材料。
// 纯 Node 构建期工具，不依赖 Electron，也不触碰用户目录。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPDX_REVISION = '5bf6d9610255540bfbee6890765a616042bf1e11';
const SPDX_IDS = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'FTL',
  'GPL-3.0-only',
  'IJG',
  'ISC',
  'LGPL-2.0-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'Libpng',
  'MIT',
  'MPL-1.1',
  'MPL-2.0',
  'Python-2.0',
  'Zlib',
  'libtiff'
]);
const LICENSE_DIR = path.join(ROOT, 'licenses');
const PACKAGE_TEXT_DIR = path.join(LICENSE_DIR, 'package-texts');
const PACKAGE_LICENSE_OVERRIDES_PATH = path.join(ROOT, 'compliance', 'package-license-overrides.json');
const EMBEDDED_LICENSE_MATERIALS_PATH = path.join(ROOT, 'compliance', 'embedded-license-materials.json');
const EMBEDDED_LICENSE_FILES = {
  'LicenseRef-AOM-Patent-1.0': [
    'licenses/embedded/AOM-LICENSE.txt',
    'licenses/embedded/AOM-PATENTS.txt'
  ],
  'LicenseRef-fontconfig': ['licenses/embedded/fontconfig-COPYING.txt']
};
let embeddedLicenseCatalogCache = null;

function parseArgs(argv) {
  const values = {};
  for (const value of argv) {
    if (!value.startsWith('--')) continue;
    if (!value.includes('=')) {
      values[value.slice(2)] = true;
      continue;
    }
    const index = value.indexOf('=');
    values[value.slice(2, index)] = value.slice(index + 1);
  }
  return values;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function failS1(message) {
  const error = new Error(`S1_LICENSE_CONFLICT ${message}`);
  error.code = 'S1_LICENSE_CONFLICT';
  throw error;
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function normalizeLicense(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value.type === 'string' && value.type.trim()) return value.type.trim();
  return '';
}

function spdxIds(expression) {
  const operators = new Set(['AND', 'OR', 'WITH']);
  return [...new Set((String(expression).match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) || [])
    .filter((value) => !operators.has(value)))];
}

function isStrongCopyleft(id) {
  return /^(?:AGPL|GPL|SSPL)-/i.test(id);
}

function isWeakCopyleft(id) {
  return /^(?:LGPL|MPL)-/i.test(id);
}

function authorText(author) {
  if (!author) return '';
  if (typeof author === 'string') return author;
  return [author.name, author.email && `<${author.email}>`, author.url]
    .filter(Boolean).join(' ');
}

function repositoryText(repository) {
  if (!repository) return '';
  const raw = typeof repository === 'string' ? repository : repository.url;
  if (!raw) return '';
  const url = String(raw).replace(/^git\+/, '').replace(/^git:\/\//, 'https://');
  const directory = typeof repository === 'object' && repository.directory
    ? `#${repository.directory}` : '';
  return `${url}${directory}`;
}

function canonicalPathsFor(expression) {
  const ids = spdxIds(expression);
  const paths = [];
  for (const id of ids) {
    if (!SPDX_IDS.has(id)) throw new Error(`没有固定全文来源的许可证标识：${id}`);
    paths.push(`licenses/SPDX-${id}.txt`);
    // LGPLv3 是 GPLv3 条款加附加许可；两份全文必须一起分发。
    if (/^LGPL-3\.0-/.test(id)) paths.push('licenses/SPDX-GPL-3.0-only.txt');
  }
  return [...new Set(paths)].sort();
}

function embeddedLicenseCatalog() {
  if (embeddedLicenseCatalogCache) return embeddedLicenseCatalogCache;
  if (!fs.existsSync(EMBEDDED_LICENSE_MATERIALS_PATH)) {
    throw new Error(`缺少内嵌组件许可 manifest：${EMBEDDED_LICENSE_MATERIALS_PATH}`);
  }
  const data = readJson(EMBEDDED_LICENSE_MATERIALS_PATH);
  if (data.schemaVersion !== 1) throw new Error(`内嵌组件许可 manifest schema 不支持：${data.schemaVersion}`);
  const materials = new Map();
  for (const material of data.materials || []) {
    if (!material.id || materials.has(material.id)) throw new Error(`内嵌许可材料 id 缺失或重复：${material.id || '空'}`);
    const filePath = path.join(ROOT, material.repositoryPath || '');
    if (!material.repositoryPath || !fs.existsSync(filePath)
        || sha256(fs.readFileSync(filePath)) !== material.repositorySha256) {
      throw new Error(`内嵌许可材料缺失或哈希不符：${material.id}`);
    }
    materials.set(material.id, material);
  }
  const components = new Map();
  for (const component of data.components || []) {
    if (!component.id || components.has(component.id)) throw new Error(`内嵌组件 id 缺失或重复：${component.id || '空'}`);
    if (/\b(?:AGPL|GPL|SSPL)-\d/i.test(component.licenseExpression || '')) {
      failS1(`内嵌组件官方材料出现强 copyleft ${component.id} ${component.licenseExpression}`);
    }
    for (const materialId of component.materialIds || []) {
      if (!materials.has(materialId)) throw new Error(`内嵌组件引用未知材料：${component.id} -> ${materialId}`);
    }
    if (!(component.materialIds || []).length) throw new Error(`内嵌组件缺少许可原文：${component.id}`);
    components.set(component.id, component);
  }
  for (const target of data.targets || []) {
    for (const componentId of target.componentIds || []) {
      if (!components.has(componentId)) throw new Error(`内嵌目标引用未知组件：${target.id} -> ${componentId}`);
    }
  }
  for (const declaration of data.evidenceBasis && data.evidenceBasis.declarations || []) {
    if (declaration.materialId && !materials.has(declaration.materialId)) {
      throw new Error(`内嵌声明引用未知材料：${declaration.materialId}`);
    }
  }
  embeddedLicenseCatalogCache = { data, materials, components };
  return embeddedLicenseCatalogCache;
}

function normalizeEmbeddedName(name) {
  return ({ lcms: 'little-cms' })[String(name).toLowerCase()] || String(name).toLowerCase();
}

function officialWeakLicense(expression) {
  const value = String(expression || '').trim();
  if (/^(?:LGPL-\d\.\d-(?:only|or-later)|MPL-\d\.\d)(?: OR (?:LGPL-\d\.\d-(?:only|or-later)|MPL-\d\.\d))*$/.test(value)) {
    return value;
  }
  const match = value.match(/^(LGPL-\d\.\d-(?:only|or-later)|MPL-\d\.\d)\b/);
  return match ? match[1] : '';
}

function embeddedAttribution(component) {
  const catalog = embeddedLicenseCatalog();
  const wantedName = normalizeEmbeddedName(component.name);
  const nameMatches = [...catalog.components.values()].filter((candidate) =>
    normalizeEmbeddedName(candidate.displayName) === wantedName);
  const wantedVersion = String(component.version || '');
  const versionMatches = wantedVersion ? nameMatches.filter((candidate) => {
    const candidateVersion = candidate.id.slice(candidate.id.lastIndexOf('@') + 1);
    return candidateVersion === wantedVersion
      || candidateVersion.startsWith(wantedVersion)
      || wantedVersion.startsWith(candidateVersion);
  }) : nameMatches;
  if (versionMatches.length !== 1) {
    failS1(`内嵌组件许可材料无法唯一匹配 ${component.name}@${wantedVersion || '?'} matches=${versionMatches.length}`);
  }
  const record = versionMatches[0];
  const materialFiles = record.materialIds.map((id) => catalog.materials.get(id).repositoryPath).sort();
  return { record, materialFiles };
}

function embeddedDeclarationMaterialPaths(packageName) {
  const catalog = embeddedLicenseCatalog();
  let materialId = '';
  if (packageName === '@img/sharp-wasm32') materialId = 'wasm-vips-third-party-notices';
  else if (packageName === '@img/sharp-libvips-darwin-arm64'
      || packageName === '@img/sharp-libvips-darwin-x64'
      || packageName === '@img/sharp-win32-x64') {
    materialId = 'sharp-libvips-third-party-notices';
  }
  if (!materialId) return [];
  const declaration = (catalog.data.evidenceBasis.declarations || [])
    .find((item) => item.materialId === materialId);
  const material = catalog.materials.get(materialId);
  if (!declaration || !material) throw new Error(`内嵌组件声明材料缺失：${packageName} -> ${materialId}`);
  return [material.repositoryPath];
}

function embeddedMaterialPaths(components, packageName) {
  const paths = [];
  for (const component of components) {
    for (const expression of [component.license, component.officialLicense].filter(Boolean)) {
      for (const id of spdxIds(expression)) {
        if (SPDX_IDS.has(id)) paths.push(...canonicalPathsFor(id));
        else if (EMBEDDED_LICENSE_FILES[id]) paths.push(...EMBEDDED_LICENSE_FILES[id]);
        else failS1(`内嵌组件许可证材料未知 ${component.name}@${component.version || '?'} ${id}`);
      }
    }
    paths.push(...(component.materialFiles || []));
  }
  paths.push(...embeddedDeclarationMaterialPaths(packageName));
  for (const relative of paths) {
    const filePath = path.join(ROOT, relative);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1) {
      throw new Error(`缺少内嵌组件许可证材料：${relative}`);
    }
  }
  return [...new Set(paths)].sort();
}

async function ensureCanonicalTexts(writeMissing) {
  if (writeMissing) fs.mkdirSync(LICENSE_DIR, { recursive: true });
  for (const id of [...SPDX_IDS].sort()) {
    const filePath = path.join(LICENSE_DIR, `SPDX-${id}.txt`);
    if (!fs.existsSync(filePath)) {
      if (!writeMissing) throw new Error(`缺少 SPDX 许可证全文：${filePath}`);
      const url = `https://raw.githubusercontent.com/spdx/license-list-data/${SPDX_REVISION}/text/${id}.txt`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'WhaleDock-license-inventory/1.0' }
      });
      if (!response.ok) throw new Error(`下载 SPDX ${id} 失败：HTTP ${response.status}`);
      fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    }
    if (fs.statSync(filePath).size < 100) throw new Error(`SPDX 许可证全文异常：${filePath}`);
  }
  if (writeMissing) {
    fs.writeFileSync(path.join(LICENSE_DIR, 'README.md'), [
      '# 第三方许可证全文',
      '',
      `- \`SPDX-*.txt\` 固定取自 SPDX license-list-data 提交 \`${SPDX_REVISION}\`。`,
      '- `package-texts/` 是从实际进入 vendor runtime 的 npm 包顶层许可证、NOTICE、COPYING 或许可说明 README 中逐字节提取并按 SHA-256 去重的文本。',
      '- `embedded-components/` 保存 sharp/libvips 内嵌组件对应版本的上游 LICENSE、COPYING、NOTICE；结构化来源与哈希见 `../compliance/embedded-license-materials.json`。',
      '- 包、版本、许可证表达式、lock integrity、原始 tarball 与文本映射见 `../compliance/` 和 `../THIRD_PARTY_NOTICES.md`。',
      ''
    ].join('\n'));
  }
}

function enumeratePackageDirs(runtimeDir) {
  const rows = [];
  const visited = new Set();

  function walkNodeModules(nodeModulesDir) {
    if (!fs.existsSync(nodeModulesDir)) return;
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(nodeModulesDir, entry.name);
        for (const child of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (child.isDirectory()) visitPackage(path.join(scopeDir, child.name));
        }
      } else {
        visitPackage(path.join(nodeModulesDir, entry.name));
      }
    }
  }

  function visitPackage(packageDir) {
    let real;
    try { real = fs.realpathSync(packageDir); } catch (_error) { return; }
    if (visited.has(real)) return;
    visited.add(real);
    const manifestPath = path.join(packageDir, 'package.json');
    if (fs.existsSync(manifestPath)) rows.push({ packageDir, manifest: readJson(manifestPath) });
    walkNodeModules(path.join(packageDir, 'node_modules'));
  }

  walkNodeModules(path.join(runtimeDir, 'node_modules'));
  return rows;
}

function licenseCandidateFiles(packageDir, expression) {
  const files = [];
  const seen = new Set();
  const matchesLicenseName = (name) => /^(?:licen[sc]e|copying|notice|copyright|patents|third[-_]?party(?:[-_]?notices?)?)(?:[._-].*)?$/i.test(name);
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { return; }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') walk(filePath);
      } else if (entry.isFile() && matchesLicenseName(entry.name)) {
        const real = fs.realpathSync(filePath);
        if (!seen.has(real)) {
          seen.add(real);
          files.push(filePath);
        }
      }
    }
  };
  walk(packageDir);
  if (spdxIds(expression).some((id) => isWeakCopyleft(id))) {
    for (const readme of ['README.md', 'README', 'readme.md']) {
      const filePath = path.join(packageDir, readme);
      if (fs.existsSync(filePath) && !seen.has(fs.realpathSync(filePath))) files.push(filePath);
    }
  }
  return files.sort();
}

function embeddedVersion(versions, name) {
  const aliases = {
    libarchive: 'archive',
    libexif: 'exif',
    libffi: 'ffi',
    libheif: 'heif',
    libpng: 'png',
    librsvg: 'rsvg',
    libtiff: 'tiff',
    libultrahdr: 'uhdr',
    libvips: 'vips',
    libwebp: 'webp',
    libxml2: 'xml2'
  };
  return versions[name] || versions[aliases[name]] || versions[name.replace(/^lib/, '')] || '';
}

// 预编译 npm 包可能在 README 的 Licensing 表中披露其内嵌原生库；仅解析结构化表格，
// 避免把普通文本里的“GPL-compatible”等字样误判为包许可证。
function embeddedLicense(label) {
  if (/Alliance for Open Media Patent License/i.test(label)) {
    return 'BSD-2-Clause AND LicenseRef-AOM-Patent-1.0';
  }
  if (/Mozilla Public License\s*2\.0|\bMPL[- v]*2(?:\.0)?\b/i.test(label)) return 'MPL-2.0';
  if (/\bLGPLv?3\b|LGPL-3\.0/i.test(label)) return 'LGPL-3.0-or-later';
  if (/GNU Affero General Public License|\bAGPLv?[123]\b/i.test(label)) return 'AGPL';
  if (/GNU General Public License|\bGPLv?[123]\b/i.test(label)) return 'GPL';
  if (/zlib License.*IJG License.*BSD 3-Clause/i.test(label)) return 'Zlib AND IJG AND BSD-3-Clause';
  if (/fontconfig License/i.test(label)) return 'LicenseRef-fontconfig';
  if (/freetype License/i.test(label)) return 'FTL';
  if (/libpng License/i.test(label)) return 'Libpng';
  if (/libtiff License/i.test(label)) return 'libtiff';
  if (/zlib License/i.test(label)) return 'Zlib';
  if (/New BSD License|BSD 3-Clause/i.test(label)) return 'BSD-3-Clause';
  if (/BSD 2-Clause/i.test(label)) return 'BSD-2-Clause';
  if (/MIT License/i.test(label)) return 'MIT';
  if (/Apache License/i.test(label)) return 'Apache-2.0';
  return '';
}

function embeddedComponents(packageDir) {
  const readme = ['README.md', 'README', 'readme.md']
    .map((name) => path.join(packageDir, name)).find((filePath) => fs.existsSync(filePath));
  if (!readme) return [];
  let versions = {};
  const versionsPath = path.join(packageDir, 'versions.json');
  if (fs.existsSync(versionsPath)) {
    try { versions = readJson(versionsPath); } catch (_error) { /* inventory 仍保留 README 原文 */ }
  }
  const readmeLines = fs.readFileSync(readme, 'utf8').split(/\r?\n/);
  const licensingStart = readmeLines.findIndex((line) => /^##\s+Licensing\s*$/i.test(line));
  if (licensingStart < 0) return [];
  const nextHeadingOffset = readmeLines.slice(licensingStart + 1)
    .findIndex((line) => /^##\s+/.test(line));
  const licensingLines = readmeLines.slice(
    licensingStart + 1,
    nextHeadingOffset < 0 ? undefined : licensingStart + 1 + nextHeadingOffset
  );
  const details = [];
  for (const line of licensingLines) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!match || /^-+$/.test(match[1].trim()) || /^(?:Library|Component)$/i.test(match[1].trim())) continue;
    const name = match[1].trim();
    const label = match[2].trim();
    const declaredLicense = embeddedLicense(label);
    if (!declaredLicense) failS1(`无法识别内嵌组件许可证 ${name}: ${label}`);
    const version = embeddedVersion(versions, name);
    // sharp-libvips 1.3.2 的表格把 cairo 1.18.4 写成 MPL-2.0；官方 COPYING
    // 明确是 LGPL-2.1 或 MPL-1.1。保留上游原标签，同时按官方原文入清单。
    if (name.toLowerCase() === 'cairo' && version === '1.18.4') {
      details.push({
        name,
        version,
        license: 'LGPL-2.1-only OR MPL-1.1',
        upstreamLabel: label,
        declaredLicense,
        licenseDiscrepancy: 'sharp-libvips README says MPL-2.0; cairo 1.18.4 COPYING says LGPL-2.1 OR MPL-1.1'
      });
      continue;
    }
    details.push({ name, version, license: declaredLicense, upstreamLabel: label });
  }
  return details.map((component) => {
    const attribution = embeddedAttribution(component);
    const officialLicense = officialWeakLicense(attribution.record.licenseExpression);
    return {
      ...component,
      ...(officialLicense && officialLicense !== component.license ? { officialLicense } : {}),
      materialComponentId: attribution.record.id,
      materialLicenseExpression: attribution.record.licenseExpression,
      materialSourceRepository: attribution.record.sourceRepository,
      materialSourceRef: attribution.record.sourceRef,
      materialFiles: attribution.materialFiles
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function licenseTextFingerprint(content) {
  const text = content.toString('utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const findings = [];
  if (/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s*$/im.test(text)) findings.push('AGPL');
  if (/^\s*GNU GENERAL PUBLIC LICENSE\s*$/im.test(text)) findings.push('GPL');
  if (/^\s*Server Side Public License\s*$/im.test(text)) findings.push('SSPL');
  if (/^\s*GNU (?:LESSER|LIBRARY) GENERAL PUBLIC LICENSE\s*$/im.test(text)) findings.push('LGPL');
  if (/^\s*Mozilla Public License(?: Version)? 2\.0\s*$/im.test(text)) findings.push('MPL-2.0');
  return [...new Set(findings)].sort();
}

function strongLicenseFingerprint(content) {
  const head = content.subarray(0, 16 * 1024);
  if (head.includes(0)) return [];
  const text = head.toString('utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const findings = [];
  if (/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s*$/im.test(text)) findings.push('AGPL');
  if (/^\s*GNU GENERAL PUBLIC LICENSE\s*$/im.test(text)) findings.push('GPL');
  if (/^\s*Server Side Public License\s*$/im.test(text)) findings.push('SSPL');
  for (const match of text.matchAll(/SPDX-License-Identifier:\s*([^\n]+)/gi)) {
    for (const id of spdxIds(match[1])) {
      if (/^AGPL-/i.test(id)) findings.push('AGPL');
      else if (/^GPL-/i.test(id)) findings.push('GPL');
      else if (/^SSPL-/i.test(id)) findings.push('SSPL');
    }
  }
  return [...new Set(findings)].sort();
}

function storePackageText(filePath, writeFiles) {
  const content = fs.readFileSync(filePath);
  if (content.length > 2 * 1024 * 1024) throw new Error(`许可证文本过大：${filePath}`);
  const digest = sha256(content);
  const relative = `licenses/package-texts/${digest}.txt`;
  const destination = path.join(ROOT, relative);
  if (writeFiles) {
    fs.mkdirSync(PACKAGE_TEXT_DIR, { recursive: true });
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, content);
  }
  if (!fs.existsSync(destination) || sha256(fs.readFileSync(destination)) !== digest) {
    throw new Error(`许可证提取文本缺失或哈希不符：${relative}`);
  }
  return { relative, digest, findings: licenseTextFingerprint(content) };
}

function fileTree(rootDir, options = {}) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      const relative = posixRelative(rootDir, filePath);
      if (options.skip && options.skip(relative, entry)) continue;
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) {
        let digest = options.cache && options.cache.get(filePath);
        if (!digest) {
          const content = fs.readFileSync(filePath);
          digest = { size: content.length, sha256: sha256(content) };
          if (options.scanLicenses) {
            const findings = strongLicenseFingerprint(content);
            if (findings.length) digest.strongLicenseFindings = findings;
          }
          if (options.cache) options.cache.set(filePath, digest);
        }
        rows.push({ path: relative, ...digest });
      } else if (entry.isSymbolicLink()) {
        rows.push({ path: relative, symlink: fs.readlinkSync(filePath) });
      }
    }
  };
  walk(rootDir);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function treeSha256(rows) {
  return sha256(rows.map((row) => JSON.stringify(row)).join('\n'));
}

function buildInventory(runtimeDir, writeFiles) {
  const manifest = readJson(path.join(runtimeDir, 'manifest.json'));
  const lockPath = path.join(runtimeDir, 'package-lock.json');
  const lockContent = fs.readFileSync(lockPath);
  const lock = JSON.parse(lockContent.toString('utf8'));
  const grouped = new Map();
  const fileDigestCache = new Map();
  const overrides = fs.existsSync(PACKAGE_LICENSE_OVERRIDES_PATH)
    ? readJson(PACKAGE_LICENSE_OVERRIDES_PATH).packages || {}
    : {};

  for (const item of enumeratePackageDirs(runtimeDir)) {
    const pkg = item.manifest;
    if (!pkg.name || !pkg.version) throw new Error(`包 manifest 缺少 name/version：${item.packageDir}`);
    const lockKey = posixRelative(runtimeDir, item.packageDir);
    const lockEntry = lock.packages && lock.packages[lockKey];
    if (!lockEntry) throw new Error(`package-lock 缺少实际安装路径：${lockKey}`);
    if (lockEntry.version !== pkg.version) {
      throw new Error(`版本与 lock 不一致：${pkg.name} ${pkg.version} != ${lockEntry.version}`);
    }
    if (!lockEntry.integrity) throw new Error(`lock integrity 缺失：${pkg.name}@${pkg.version}`);
    const license = normalizeLicense(pkg.license || lockEntry.license);
    if (!license || /^(?:UNKNOWN|UNLICENSED|SEE LICENSE)/i.test(license)) {
      failS1(`许可证未知 ${pkg.name}@${pkg.version} (${license || '空'})`);
    }
    const lockLicense = normalizeLicense(lockEntry.license);
    if (lockLicense && lockLicense !== license) {
      failS1(`manifest/lock 许可证不一致 ${pkg.name}@${pkg.version} ${license} != ${lockLicense}`);
    }
    const ids = spdxIds(license);
    const strong = ids.filter(isStrongCopyleft);
    if (strong.length) {
      failS1(`${pkg.name}@${pkg.version} ${strong.join(',')}`);
    }
    const embedded = embeddedComponents(item.packageDir);
    const embeddedStrong = embedded.filter((component) => /^(?:AGPL|GPL)$/.test(component.license));
    if (embeddedStrong.length) {
      failS1(`${pkg.name}@${pkg.version} embedded=${embeddedStrong.map((item) => item.name).join(',')}`);
    }
    const embeddedWeak = embedded.flatMap((component) => [component.license, component.officialLicense])
      .filter(Boolean)
      .filter((id) => isWeakCopyleft(id));
    const licenseFiles = [
      ...canonicalPathsFor(license),
      ...embeddedMaterialPaths(embedded, pkg.name)
    ];
    const licenseTextFindings = [];
    for (const candidate of licenseCandidateFiles(item.packageDir, license)) {
      const stored = storePackageText(candidate, writeFiles);
      licenseFiles.push(stored.relative);
      const unexpectedStrong = stored.findings.filter((finding) =>
        /^(?:AGPL|SSPL)$/.test(finding)
          || (finding === 'GPL' && !ids.some((id) => /^LGPL-/i.test(id))));
      if (unexpectedStrong.length) {
        failS1(`${pkg.name}@${pkg.version} hidden=${unexpectedStrong.join(',')} path=${posixRelative(item.packageDir, candidate)}`);
      }
      licenseTextFindings.push({
        path: posixRelative(item.packageDir, candidate),
        sha256: stored.digest,
        detected: stored.findings
      });
    }

    const override = overrides[`${pkg.name}@${pkg.version}`];
    if (override) {
      for (const source of override.licenseFiles || []) {
        const filePath = path.join(ROOT, source.path);
        if (!fs.existsSync(filePath) || sha256(fs.readFileSync(filePath)) !== source.sha256) {
          throw new Error(`上游许可证材料缺失或哈希不符：${pkg.name}@${pkg.version} ${source.path}`);
        }
        licenseFiles.push(source.path);
        licenseTextFindings.push({
          path: source.path,
          sha256: source.sha256,
          detected: licenseTextFingerprint(fs.readFileSync(filePath)),
          origin: source.sourceUrl,
          sourceCommit: source.sourceCommit
        });
      }
    }
    if (!licenseTextFindings.length) {
      failS1(`缺少带版权声明的包级许可证原文 ${pkg.name}@${pkg.version}`);
    }

    const packageFiles = fileTree(item.packageDir, {
      skip: (relative, entry) => entry.isDirectory() && relative.split('/').includes('node_modules'),
      scanLicenses: true,
      cache: fileDigestCache
    });
    const hiddenStrong = packageFiles.filter((file) => file.strongLicenseFindings);
    if (hiddenStrong.length) {
      failS1(`${pkg.name}@${pkg.version} hidden=${hiddenStrong.map((file) =>
        `${file.strongLicenseFindings.join('+')}:${file.path}`).join(',')}`);
    }
    const binaryFiles = packageFiles.filter((file) =>
      /\.(?:node|wasm|dll|dylib|exe|so(?:\.\d+)*)$/i.test(file.path));

    const key = `${pkg.name}@${pkg.version}`;
    const row = grouped.get(key) || {
      name: pkg.name,
      version: pkg.version,
      license,
      author: authorText(pkg.author),
      repository: repositoryText(pkg.repository),
      resolved: lockEntry.resolved || '',
      integrity: lockEntry.integrity,
      paths: [],
      licenseFiles: [],
      weakCopyleft: [...ids.filter(isWeakCopyleft), ...embeddedWeak],
      embeddedComponents: embedded,
      licenseTextFindings,
      packageTreeSha256: treeSha256(packageFiles),
      binaryFiles
    };
    if (row.license !== license || row.integrity !== lockEntry.integrity) {
      throw new Error(`同一包版本出现不一致元数据：${key}`);
    }
    row.paths.push(lockKey);
    row.licenseFiles.push(...licenseFiles);
    if (JSON.stringify(row.embeddedComponents) !== JSON.stringify(embedded)) {
      throw new Error(`同一包版本出现不一致的内嵌组件披露：${key}`);
    }
    if (row.packageTreeSha256 !== treeSha256(packageFiles)
        || JSON.stringify(row.binaryFiles) !== JSON.stringify(binaryFiles)
        || JSON.stringify(row.licenseTextFindings) !== JSON.stringify(licenseTextFindings)) {
      throw new Error(`同一包版本出现不一致的文件字节：${key}`);
    }
    grouped.set(key, row);
  }

  const packages = [...grouped.values()].map((row) => ({
    ...row,
    paths: [...new Set(row.paths)].sort(),
    licenseFiles: [...new Set(row.licenseFiles)].sort(),
    weakCopyleft: [...new Set(row.weakCopyleft)].sort(),
    embeddedComponents: row.embeddedComponents,
    licenseTextFindings: row.licenseTextFindings,
    packageTreeSha256: row.packageTreeSha256,
    binaryFiles: row.binaryFiles
  })).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const licenseCounts = {};
  for (const pkg of packages) licenseCounts[pkg.license] = (licenseCounts[pkg.license] || 0) + 1;
  const closureMaterial = packages.map((pkg) => [
    pkg.name, pkg.version, pkg.license, pkg.integrity, pkg.paths.join(','),
    pkg.packageTreeSha256, JSON.stringify(pkg.binaryFiles), JSON.stringify(pkg.licenseTextFindings),
    JSON.stringify(pkg.embeddedComponents), pkg.licenseFiles.join(',')
  ].join('\0')).join('\n');

  const runtimeFiles = fileTree(runtimeDir, {
    skip: (relative) => relative === 'manifest.json' || relative === 'node_modules/.package-lock.json',
    scanLicenses: true,
    cache: fileDigestCache
  });
  const stableManifest = {
    schemaVersion: manifest.schemaVersion,
    dshVersion: manifest.dshVersion,
    packageIntegrity: manifest.packageIntegrity,
    auditedLockSha256: manifest.auditedLockSha256,
    installScriptsIgnored: manifest.installScriptsIgnored,
    installScriptPackages: manifest.installScriptPackages,
    platform: manifest.platform,
    arch: manifest.arch
  };

  return {
    schemaVersion: 2,
    target: { platform: manifest.platform, arch: manifest.arch },
    runtimeVersion: manifest.dshVersion,
    runtimePackageIntegrity: manifest.packageIntegrity,
    packageLockSha256: sha256(lockContent),
    runtimePackageJsonSha256: sha256(fs.readFileSync(path.join(runtimeDir, 'package.json'))),
    manifestStableSha256: sha256(JSON.stringify(stableManifest)),
    runtimeTreeSha256: treeSha256(runtimeFiles),
    closureSha256: sha256(closureMaterial),
    packageCount: packages.length,
    licenseCounts: Object.fromEntries(Object.entries(licenseCounts).sort()),
    packages
  };
}

function comparableInventory(inventory) {
  return JSON.parse(JSON.stringify(inventory));
}

function writeInventory(filePath, inventory) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(inventory, null, 2) + '\n');
}

function markdownEscape(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function markdownLink(label, url) {
  return url ? `[${label}](${String(url).replace(/\)/g, '%29')})` : 'N/A';
}

function inventorySet(inventoryDir) {
  const files = fs.readdirSync(inventoryDir)
    .filter((name) => /^inventory-.+\.json$/.test(name)).sort();
  if (!files.length) throw new Error(`没有 inventory：${inventoryDir}`);
  return files.map((file) => ({ file, data: readJson(path.join(inventoryDir, file)) }));
}

function embeddedTargetId(pkg) {
  if (pkg.name === '@img/sharp-wasm32') return 'wasm32-all-runtime-targets';
  if (pkg.name === '@img/sharp-libvips-darwin-arm64') return 'native-darwin-arm64';
  if (pkg.name === '@img/sharp-libvips-darwin-x64') return 'native-darwin-x64';
  if (pkg.name === '@img/sharp-win32-x64') return 'native-win32-x64';
  return '';
}

function verifyEmbeddedInventoryEvidence(inventories) {
  const catalog = embeddedLicenseCatalog();
  const targets = new Map((catalog.data.targets || []).map((target) => [target.id, target]));
  const boundMaterialPaths = new Set();
  for (const { data } of inventories) {
    for (const pkg of data.packages || []) {
      for (const relative of pkg.licenseFiles || []) boundMaterialPaths.add(relative);
      if (!(pkg.embeddedComponents || []).length) continue;
      const targetId = embeddedTargetId(pkg);
      const target = targets.get(targetId);
      if (!target) throw new Error(`内嵌许可 manifest 缺少目标：${pkg.name}`);
      const actualIds = [];
      for (const component of pkg.embeddedComponents) {
        const attribution = embeddedAttribution(component);
        actualIds.push(attribution.record.id);
        if (component.materialComponentId !== attribution.record.id
            || component.materialLicenseExpression !== attribution.record.licenseExpression
            || JSON.stringify(component.materialFiles) !== JSON.stringify(attribution.materialFiles)) {
          throw new Error(`inventory 内嵌许可映射漂移：${pkg.name} -> ${component.name}`);
        }
        for (const relative of attribution.materialFiles) {
          if (!(pkg.licenseFiles || []).includes(relative)) {
            throw new Error(`inventory 未绑定内嵌许可原文：${pkg.name} -> ${relative}`);
          }
        }
      }
      if (JSON.stringify([...new Set(actualIds)].sort())
          !== JSON.stringify([...new Set(target.componentIds || [])].sort())) {
        throw new Error(`inventory 与内嵌目标声明向量不一致：${pkg.name}`);
      }
      for (const relative of embeddedDeclarationMaterialPaths(pkg.name)) {
        if (!(pkg.licenseFiles || []).includes(relative)) {
          throw new Error(`inventory 未绑定内嵌组件总声明：${pkg.name} -> ${relative}`);
        }
      }
    }
  }
  for (const material of catalog.materials.values()) {
    if (!boundMaterialPaths.has(material.repositoryPath)) {
      throw new Error(`内嵌许可材料未绑定到任何 inventory/NOTICE：${material.id}`);
    }
  }

  const evidence = new Map((catalog.data.evidenceBasis && catalog.data.evidenceBasis.inventories || [])
    .map((item) => [path.basename(item.path), item.sha256]));
  if (evidence.size !== inventories.length) throw new Error('内嵌许可 manifest 的 inventory 证据集不完整');
  for (const item of inventories) {
    const expected = evidence.get(item.file);
    const actual = sha256(fs.readFileSync(path.join(ROOT, 'compliance', item.file)));
    if (expected !== actual) throw new Error(`内嵌许可 manifest 的 inventory 哈希漂移：${item.file}`);
  }
  return catalog;
}

function sourceArtifactMap(items, label) {
  const map = new Map();
  for (const item of items || []) {
    if (!item.id || map.has(item.id)) throw new Error(`${label} id 缺失或重复：${item.id || '空'}`);
    if (!/^https:\/\//.test(item.sourceUrl || '') || !/^[a-f0-9]{64}$/.test(item.sourceSha256 || '')) {
      throw new Error(`${label} 源码地址或 SHA-256 无效：${item.id}`);
    }
    map.set(item.id, item);
  }
  return map;
}

function verifySourceMappings(inventoryDir, sourcePath) {
  const inventories = inventorySet(inventoryDir);
  const embeddedCatalog = verifyEmbeddedInventoryEvidence(inventories);
  const sources = readJson(sourcePath);
  if (sources.schemaVersion !== 1) throw new Error(`SOURCES schema 不支持：${sources.schemaVersion}`);
  const recipes = sourceArtifactMap(sources.buildRecipes, '构建配方');
  const components = sourceArtifactMap(sources.components, '组件');
  const buildInputs = new Map((sources.buildInputPackages || [])
    .map((item) => [`${item.name}@${item.version}`, item]));
  const containers = new Map((sources.containers || [])
    .map((item) => [`${item.name}@${item.version}`, item]));
  const required = new Map();

  for (const { data } of inventories) {
    const target = `${data.target.platform}/${data.target.arch}`;
    for (const pkg of data.packages) {
      if (!(pkg.weakCopyleft || []).length) continue;
      const key = `${pkg.name}@${pkg.version}`;
      const row = required.get(key) || { pkg, targets: new Set(), componentIds: new Set() };
      row.targets.add(target);
      for (const component of pkg.embeddedComponents || []) {
        if (isWeakCopyleft(component.license) || isWeakCopyleft(component.officialLicense)
            || component.license.includes('LicenseRef-AOM-Patent-1.0')) {
          row.componentIds.add(component.materialComponentId || `${component.name}@${component.version}`);
        }
      }
      required.set(key, row);
    }
  }

  for (const [key, row] of required) {
    const mapping = containers.get(key);
    if (!mapping) throw new Error(`SOURCES 缺少弱 copyleft 容器：${key}`);
    if (mapping.resolved !== row.pkg.resolved || mapping.integrity !== row.pkg.integrity) {
      throw new Error(`SOURCES 二进制来源与 inventory 不一致：${key}`);
    }
    if (!/^https:\/\//.test(mapping.provenanceUrl || '')
        || !/^[a-f0-9]{64}$/.test(mapping.tarballSha256 || '')) {
      throw new Error(`SOURCES provenance/tarball SHA 无效：${key}`);
    }
    const actualTargets = [...row.targets].sort();
    const mappedTargets = [...new Set(mapping.targets || [])].sort();
    if (JSON.stringify(actualTargets) !== JSON.stringify(mappedTargets)) {
      throw new Error(`SOURCES 目标集不一致：${key}`);
    }
    if (!(mapping.buildRecipes || []).length) throw new Error(`SOURCES 缺少重建配方：${key}`);
    for (const recipe of mapping.buildRecipes) {
      if (!recipes.has(recipe)) throw new Error(`SOURCES 构建配方不存在：${key} -> ${recipe}`);
    }
    for (const input of mapping.buildInputPackages || []) {
      if (!buildInputs.has(input)) throw new Error(`SOURCES 构建输入不存在：${key} -> ${input}`);
    }
    const mappedComponents = new Set(mapping.componentSources || []);
    for (const componentId of row.componentIds) {
      if (!mappedComponents.has(componentId) || !components.has(componentId)) {
        throw new Error(`SOURCES 缺少对应组件源码：${key} -> ${componentId}`);
      }
      const sourceComponent = components.get(componentId);
      const materialComponent = embeddedCatalog.components.get(componentId);
      const expectedLicense = officialWeakLicense(materialComponent.licenseExpression)
        || materialComponent.licenseExpression;
      if (sourceComponent.license !== expectedLicense) {
        throw new Error(`SOURCES 组件许可与官方材料不一致：${componentId}`);
      }
      const expectedMaterials = materialComponent.materialIds
        .map((id) => embeddedCatalog.materials.get(id).repositoryPath).sort();
      const mappedMaterials = [...new Set(sourceComponent.licenseFiles || [])].sort();
      if (JSON.stringify(expectedMaterials) !== JSON.stringify(mappedMaterials)) {
        throw new Error(`SOURCES 组件许可原文映射不完整：${componentId}`);
      }
    }
  }

  for (const component of components.values()) {
    for (const relative of component.licenseFiles || []) {
      const filePath = path.join(ROOT, relative);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1) {
        throw new Error(`SOURCES 许可证材料缺失：${component.id} -> ${relative}`);
      }
    }
  }
  const inferredWasm = recipes.get('wasm-vips@9ff73c569c91ded6f8d8c7570967d0dadcf0134d');
  if (!inferredWasm || inferredWasm.upstreamAttestation !== false
      || !/inferred/i.test(inferredWasm.verificationMethod || '') || !inferredWasm.caveat) {
    throw new Error('SOURCES 必须如实保留 wasm-vips 未获上游证明的边界');
  }
  return { sources, inventories, requiredCount: required.size };
}

function buildSourcesMarkdown(inventoryDir, sourcePath) {
  const { sources, requiredCount } = verifySourceMappings(inventoryDir, sourcePath);
  const lines = [
    '# WhaleDock 内置 runtime 源码与重建材料',
    '',
    '本文件给出 WhaleDock 再分发的 sharp/libvips 弱 copyleft 二进制容器、不可变源码归档、校验值和替换/重新链接路径。npm tarball 是被再分发的二进制来源，不等于对应源码。',
    '',
    '> 重要边界：`sharp-libvips@1.3.2` 的 wasm 构建脚本读取 `wasm-vips:HEAD`，上游 SLSA 没有记录解析后的 commit。这里的 `9ff73c…` 由 workflow 时间窗口与完整版本向量唯一吻合而推断，可信度高，但不是上游 attestation。',
    '',
    `结构化映射见 \`compliance/SOURCES.json\`；共覆盖 ${requiredCount} 个弱 copyleft 二进制容器。`,
    '',
    '## 二进制容器与构建链',
    '',
    '| 容器 | 目标 | 再分发 tarball | npm provenance | 构建配方 |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const item of sources.containers) {
    lines.push(`| ${markdownEscape(item.name)}@${item.version} | ${(item.targets || []).join(', ')} | ${markdownLink('精确二进制', item.resolved)} | ${markdownLink('SLSA', item.provenanceUrl)} | ${(item.buildRecipes || []).map((id) => `\`${id}\``).join(' + ')} |`);
  }
  lines.push('', '## 不可变源码归档', '', '| 源码 | 许可证 | SHA-256 | 获取方式 |', '| --- | --- | --- | --- |');
  for (const item of sources.components) {
    lines.push(`| ${markdownEscape(item.id)} | ${markdownEscape(item.license)} | \`${item.sourceSha256}\` | ${markdownLink('源码归档', item.sourceUrl)} |`);
  }
  lines.push('', '## 构建配方源码', '', '| 配方 | commit | SHA-256 | 证据 |', '| --- | --- | --- | --- |');
  for (const item of sources.buildRecipes) {
    const evidence = item.upstreamAttestation ? 'tag / provenance' : (item.caveat ? '时间与版本向量推断' : 'tag / archive');
    lines.push(`| ${markdownEscape(item.id)} | \`${item.commit}\` | \`${item.sourceSha256}\` | ${markdownLink(evidence, item.sourceUrl)} |`);
  }
  lines.push(
    '',
    '## 修改、替换与重新链接',
    '',
    '1. 按上表下载源码归档并先核对 SHA-256；同时下载结构化映射中的精确 npm 构建输入。',
    '2. macOS 原生包按 `sharp-libvips@1.3.2` 的 `build.sh`/`build/posix.sh` 重建；Windows 先按 `build-win64-mxe@8.18.3` 生成 libvips，再经 `sharp-libvips@1.3.2` 与 `sharp@0.35.3` 生成目标包。',
    '3. wasm 包按固定候选 `wasm-vips@9ff73c…` 重建静态库，再经 `sharp-libvips@1.3.2` 与 `sharp@0.35.3` 生成 `.node.wasm`。如取得上游更精确证明，应以该证明替换候选并重新核验版本向量。',
    '4. 在 `npm run bundle:dsh -- --platform=<platform> --arch=<arch>` 之后，把重建出的同名 `@img/...` 包目录替换到 `vendor/dsh-runtime/node_modules/`；不要再次运行 `bundle:dsh`，否则 registry 原包会覆盖修改。',
    '5. 直接调用对应的 `electron-builder` 命令重新打包 WhaleDock。WhaleDock 自有代码为 MIT，未对这些库做源码级修改；原生 dylib/DLL 与单体 wasm 的实际 SHA-256 已锁入各目标 inventory。',
    '',
    '许可证全文、包内原始许可/NOTICE 与 AOM 专利许可随安装包放在 `resources/compliance/licenses/`。本材料不是法律意见。',
    ''
  );
  return lines.join('\n');
}

function buildNotices(inventoryDir, sourcePath) {
  verifySourceMappings(inventoryDir, sourcePath);
  const inventories = inventorySet(inventoryDir);
  const union = new Map();
  for (const { data } of inventories) {
    const target = `${data.target.platform}/${data.target.arch}`;
    for (const pkg of data.packages) {
      const key = `${pkg.name}@${pkg.version}`;
      const row = union.get(key) || { ...pkg, targets: [] };
      if (row.license !== pkg.license || row.integrity !== pkg.integrity) {
        throw new Error(`跨平台包元数据不一致：${key}`);
      }
      row.targets.push(target);
      row.licenseFiles = [...new Set([...row.licenseFiles, ...pkg.licenseFiles])].sort();
      row.weakCopyleft = [...new Set([...row.weakCopyleft, ...pkg.weakCopyleft])].sort();
      union.set(key, row);
    }
  }
  const packages = [...union.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const counts = {};
  for (const pkg of packages) counts[pkg.license] = (counts[pkg.license] || 0) + 1;
  const weak = packages.filter((pkg) => pkg.weakCopyleft.length);
  const lines = [
    '# WhaleDock 第三方组件通知',
    '',
    'WhaleDock 本体使用 MIT 许可证。安装包另外包含锁定版 dsh runtime 及其第三方 npm 闭包；以下清单来自三个目标平台实际安装快照，不把开发依赖计入再分发包。',
    '',
    '本文件不是法律意见。许可证表达式取自各包 `package.json` 并与 lockfile 的实际路径、版本和 integrity 绑定；标准许可证全文、上游包内原文、AOM 专利许可与补齐的版权声明集中保存在 [`licenses/`](licenses/) 目录。',
    '',
    '弱 copyleft 的不可变源码、npm provenance、构建输入和重新链接步骤见仓库 `compliance/SOURCES.md`（安装包内与本文件同目录的 `SOURCES.md`）。',
    '',
    '## 快照',
    '',
    '| 目标 | 包数 | 闭包 SHA-256 | runtime tree SHA-256 | package-lock SHA-256 | inventory |',
    '| --- | ---: | --- | --- | --- | --- |'
  ];
  for (const item of inventories) {
    const data = item.data;
    lines.push(`| ${data.target.platform}/${data.target.arch} | ${data.packageCount} | \`${data.closureSha256}\` | \`${data.runtimeTreeSha256}\` | \`${data.packageLockSha256}\` | [${item.file}](compliance/${item.file}) |`);
  }
  lines.push('', '## 许可证家族（跨目标去重包）', '', '| 许可证表达式 | 包数 |', '| --- | ---: |');
  for (const [license, count] of Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`| ${markdownEscape(license)} | ${count} |`);
  }
  lines.push('', '扫描未发现包级 GPL / AGPL / SSPL 许可证；发现的 LGPL/MPL 条目列在下一节，不能把它们当作普通 MIT 包略过。', '');
  lines.push('## LGPL / MPL 条目与源码获取', '');
  if (!weak.length) {
    lines.push('本次三个目标快照没有 LGPL 或 MPL 包。', '');
  } else {
    lines.push('这些包按 npm 原包不修改地放在 `resources/dsh-runtime/node_modules/`，没有并入 WhaleDock 自有源码。精确 npm 二进制来源、完整内嵌组件披露与许可证材料如下；对应源码及重建/替换步骤单列在 `SOURCES.md`，不能把 npm 二进制 tarball 冒充源码。', '');
    for (const pkg of weak) {
      const texts = pkg.licenseFiles.map((file, index) => markdownLink(`文本${index + 1}`, file)).join('、');
      const embedded = (pkg.embeddedComponents || []).length
        ? `；内嵌披露：${pkg.embeddedComponents.map((item) => {
          const official = item.officialLicense && item.officialLicense !== item.license
            ? `（组件上游原文：${item.officialLicense}）` : '';
          const discrepancy = item.licenseDiscrepancy ? '（已确认容器 README 标注与官方原文不一致）' : '';
          return `${item.name}${item.version ? `@${item.version}` : ''} ${item.license}${official}${discrepancy}`;
        }).join('、')}`
        : '';
      lines.push(`- **${pkg.name}@${pkg.version}**（${pkg.license}；${[...new Set(pkg.targets)].sort().join(', ')}${embedded}）：${markdownLink('精确 npm 二进制 tarball', pkg.resolved)}；${texts}`);
    }
    lines.push('', '其中 LGPL-3.0-or-later 的分发文本同时包含 LGPLv3 与其引用的 GPLv3 全文；列出 GPLv3 文本不代表 WhaleDock 闭包中存在 GPL 包。', '');
    lines.push('Cairo 1.18.4 官方 `COPYING` 明确为 `LGPL-2.1-only OR MPL-1.1`；sharp-libvips 1.3.2 README 的 `MPL-2.0` 标注与官方原文不一致。本清单采用并随包携带 Cairo 官方原文，同时保留该差异证据。', '');
  }
  lines.push('## 逐包清单', '', '| 包 | 版本 | 许可证 | 作者/版权线索 | 目标 | 精确包 | 许可证全文/原文 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const pkg of packages) {
    const texts = pkg.licenseFiles.map((file, index) => markdownLink(`文本${index + 1}`, file)).join('、');
    lines.push(`| ${markdownEscape(pkg.name)} | ${markdownEscape(pkg.version)} | ${markdownEscape(pkg.license)} | ${markdownEscape(pkg.author)} | ${[...new Set(pkg.targets)].sort().join(', ')} | ${markdownLink('tarball', pkg.resolved)} | ${texts} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const command = process.argv[2];
  const options = parseArgs(process.argv.slice(3));
  if (!['generate', 'verify', 'notices', 'sources'].includes(command)) {
    throw new Error('用法：third-party-inventory.js <generate|verify|notices|sources> --runtime=... --inventory=...');
  }
  const inventories = path.resolve(ROOT, options.inventories || 'compliance');
  const sourcePath = path.resolve(ROOT, options.sources || 'compliance/SOURCES.json');
  if (command === 'sources') {
    const output = path.resolve(ROOT, options.output || 'compliance/SOURCES.md');
    const content = buildSourcesMarkdown(inventories, sourcePath);
    if (options.check) {
      if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) {
        throw new Error(`SOURCES_MARKDOWN_MISMATCH ${posixRelative(ROOT, output)}`);
      }
      console.log(`SOURCES_VERIFIED ${posixRelative(ROOT, output)}`);
    } else {
      fs.writeFileSync(output, content);
      console.log(`SOURCES_READY ${posixRelative(ROOT, output)}`);
    }
    return;
  }
  if (command === 'notices') {
    const output = path.resolve(ROOT, options.output || 'THIRD_PARTY_NOTICES.md');
    const content = buildNotices(inventories, sourcePath);
    if (options.check) {
      if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) {
        throw new Error(`THIRD_PARTY_NOTICES_MISMATCH ${posixRelative(ROOT, output)}`);
      }
      console.log(`THIRD_PARTY_NOTICES_VERIFIED ${posixRelative(ROOT, output)}`);
    } else {
      fs.writeFileSync(output, content);
      console.log(`THIRD_PARTY_NOTICES_READY ${posixRelative(ROOT, output)}`);
    }
    return;
  }

  const runtime = path.resolve(ROOT, options.runtime || 'vendor/dsh-runtime');
  const inventoryPath = path.resolve(ROOT, options.inventory || 'compliance/inventory.json');
  await ensureCanonicalTexts(command === 'generate');
  const actual = buildInventory(runtime, command === 'generate');
  if (command === 'generate') {
    writeInventory(inventoryPath, actual);
    console.log(`THIRD_PARTY_INVENTORY_READY ${actual.target.platform}/${actual.target.arch} packages=${actual.packageCount} closure=${actual.closureSha256}`);
    return;
  }

  const expected = readJson(inventoryPath);
  if (JSON.stringify(comparableInventory(actual)) !== JSON.stringify(comparableInventory(expected))) {
    throw new Error(`THIRD_PARTY_INVENTORY_MISMATCH ${actual.target.platform}/${actual.target.arch}`);
  }
  console.log(`THIRD_PARTY_INVENTORY_VERIFIED ${actual.target.platform}/${actual.target.arch} packages=${actual.packageCount} closure=${actual.closureSha256}`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(error && error.code === 'S1_LICENSE_CONFLICT' ? 2 : 1);
});
