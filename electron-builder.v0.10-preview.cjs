'use strict';

// v0.10 本地预览与持续开发专用配置。它必须携带 context-poc，且只输出到
// 独立 preview 目录；公开 Release 在信任根闭环前仍由 v0.9.1 发布门 fail-closed。
const packageJson = require('./package.json');
const contextPocManifest = require('./scripts/context-poc-manifest');
const macosBuildVisibility = require('./scripts/macos-build-visibility');

const PREVIEW_VERSION = '0.10.0-alpha.2';

function isContextPocResource(entry) {
  return Boolean(entry)
    && entry.from === 'context-poc'
    && entry.to === 'context-poc';
}

if (packageJson.version !== PREVIEW_VERSION) {
  throw new Error(`v0.10 preview 配置拒绝版本 ${packageJson.version || 'unknown'}`);
}
if (!packageJson.build || !Array.isArray(packageJson.build.extraResources)) {
  throw new Error('v0.10 preview 配置缺少 build.extraResources');
}
const contextResources = packageJson.build.extraResources.filter(isContextPocResource);
if (contextResources.length !== 1) {
  throw new Error(`v0.10 preview 必须精确携带一项 context-poc，实际 ${contextResources.length}`);
}
if (JSON.stringify(contextResources[0].filter)
    !== JSON.stringify(contextPocManifest.SOURCE_FILES)) {
  throw new Error('v0.10 preview 的 context-poc 载体文件集未锁定为固定 15 文件');
}

async function previewBeforePack(context) {
  const receipt = contextPocManifest.assertCommittedBaseline();
  console.log(
    `CONTEXT_POC_BUILD_ROOT_VERIFIED files=${receipt.files} bytes=${receipt.totalBytes} digest=${receipt.digest}`
  );
  return macosBuildVisibility(context);
}

module.exports = {
  ...packageJson.build,
  beforePack: previewBeforePack,
  directories: {
    ...packageJson.build.directories,
    output: 'release-preview'
  }
};
