'use strict';
// 在 electron-builder 输出中回读 resources/compliance，证明通知与许可证没有只停留在源码树。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const result = {};
  for (const value of argv) {
    if (!value.startsWith('--') || !value.includes('=')) continue;
    const index = value.indexOf('=');
    result[value.slice(2, index)] = value.slice(index + 1);
  }
  return result;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function treeManifest(rootDir) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) rows.push([
        path.relative(rootDir, filePath).split(path.sep).join('/'),
        fs.statSync(filePath).size,
        sha256(filePath)
      ]);
    }
  };
  walk(rootDir);
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

function findComplianceDirs(searchRoot) {
  const matches = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (entry.name === 'compliance'
          && fs.existsSync(path.join(child, 'THIRD_PARTY_NOTICES.md'))
          && fs.existsSync(path.join(child, 'SOURCES.md'))
          && fs.existsSync(path.join(child, 'SOURCES.json'))
          && fs.existsSync(path.join(child, 'licenses'))) {
        matches.push(child);
        continue;
      }
      if (entry.name === 'node_modules' || entry.name === 'dsh-runtime') continue;
      walk(child);
    }
  };
  walk(searchRoot);
  return matches.sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const searchRoot = path.resolve(ROOT, args.search || 'release');
  const minimum = Number(args.minimum || 1);
  if (!fs.existsSync(searchRoot)) throw new Error(`打包输出不存在：${searchRoot}`);
  const expectedNotice = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');
  const expectedSourcesMarkdown = path.join(ROOT, 'compliance', 'SOURCES.md');
  const expectedSourcesJson = path.join(ROOT, 'compliance', 'SOURCES.json');
  const expectedLicenses = path.join(ROOT, 'licenses');
  const noticeHash = sha256(expectedNotice);
  const sourcesMarkdownHash = sha256(expectedSourcesMarkdown);
  const sourcesJsonHash = sha256(expectedSourcesJson);
  const licenseManifest = JSON.stringify(treeManifest(expectedLicenses));
  const matches = findComplianceDirs(searchRoot);
  if (matches.length < minimum) {
    throw new Error(`PACKAGED_COMPLIANCE_MISSING expected>=${minimum} actual=${matches.length}`);
  }
  for (const complianceDir of matches) {
    const packagedNotice = path.join(complianceDir, 'THIRD_PARTY_NOTICES.md');
    const packagedSourcesMarkdown = path.join(complianceDir, 'SOURCES.md');
    const packagedSourcesJson = path.join(complianceDir, 'SOURCES.json');
    const packagedLicenses = path.join(complianceDir, 'licenses');
    if (sha256(packagedNotice) !== noticeHash) {
      throw new Error(`打包通知哈希不一致：${packagedNotice}`);
    }
    if (sha256(packagedSourcesMarkdown) !== sourcesMarkdownHash
        || sha256(packagedSourcesJson) !== sourcesJsonHash) {
      throw new Error(`打包源码映射哈希不一致：${complianceDir}`);
    }
    if (JSON.stringify(treeManifest(packagedLicenses)) !== licenseManifest) {
      throw new Error(`打包许可证目录不一致：${packagedLicenses}`);
    }
  }
  console.log(`PACKAGED_COMPLIANCE_VERIFIED copies=${matches.length} notice=${noticeHash} sources=${sourcesJsonHash}`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack || error);
  process.exit(1);
}
