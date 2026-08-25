'use strict';

const fs = require('fs');
const path = require('path');

const HOTFIX_VERSION = '0.9.1';

function isContextPocResource(entry) {
  return Boolean(entry)
    && entry.from === 'context-poc'
    && entry.to === 'context-poc';
}

function createHotfixBuildConfig(packageJson) {
  if (!packageJson || packageJson.version !== HOTFIX_VERSION) {
    throw new Error(`v${HOTFIX_VERSION} 独立打包配置拒绝版本 ${packageJson && packageJson.version || 'unknown'}`);
  }
  if (!packageJson.build || !Array.isArray(packageJson.build.extraResources)) {
    throw new Error('v0.9.1 独立打包配置缺少 build.extraResources');
  }

  const matches = packageJson.build.extraResources.filter(isContextPocResource);
  if (matches.length !== 1) {
    throw new Error(`v0.9.1 必须精确排除一项 context-poc，实际 ${matches.length}`);
  }

  const extraResources = packageJson.build.extraResources.filter(
    (entry) => !isContextPocResource(entry)
  );
  if (extraResources.some(isContextPocResource)) {
    throw new Error('v0.9.1 context-poc 排除失败');
  }

  return {
    ...packageJson.build,
    extraResources
  };
}

function entryExists(filePath, fsImpl = fs) {
  try {
    fsImpl.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function verifyHotfixResources(resourcesPath, fsImpl = fs) {
  const resolved = path.resolve(String(resourcesPath || ''));
  if (!resourcesPath || !fsImpl.statSync(resolved).isDirectory()) {
    throw new Error(`v0.9.1 Resources 目录无效：${resolved}`);
  }
  const forbidden = path.join(resolved, 'context-poc');
  if (entryExists(forbidden, fsImpl)) {
    throw new Error(`v0.9.1 成品错误携带 context-poc：${forbidden}`);
  }
  return resolved;
}

function parseResourcesArg(argv) {
  const matches = argv.filter((arg) => arg.startsWith('--resources='));
  if (matches.length !== 1 || matches[0].slice('--resources='.length).length === 0) {
    throw new Error('用法：node scripts/hotfix-build-config.js --resources=<成品 Resources 目录>');
  }
  return matches[0].slice('--resources='.length);
}

if (require.main === module) {
  try {
    const resourcesPath = verifyHotfixResources(parseResourcesArg(process.argv.slice(2)));
    console.log(`HOTFIX_CONTEXT_POC_EXCLUDED ${resourcesPath}`);
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  HOTFIX_VERSION,
  createHotfixBuildConfig,
  entryExists,
  isContextPocResource,
  parseResourcesArg,
  verifyHotfixResources
};
