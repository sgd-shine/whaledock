'use strict';

// v0.11.0-alpha.1 真机验收与预发布专用配置。构建必须携带与 committed
// baseline 精确一致的 context-poc，并在打包前完成信任根与 macOS 可见性对账。
const packageJson = require('./package.json');
const contextPocManifest = require('./scripts/context-poc-manifest');
const macosBuildVisibility = require('./scripts/macos-build-visibility');

const ALPHA_VERSION = '0.11.0-alpha.1';

function isContextPocResource(entry) {
  return Boolean(entry)
    && entry.from === 'context-poc'
    && entry.to === 'context-poc';
}

if (packageJson.version !== ALPHA_VERSION) {
  throw new Error(`v0.11 alpha 配置拒绝版本 ${packageJson.version || 'unknown'}`);
}
if (!packageJson.build || !Array.isArray(packageJson.build.extraResources)) {
  throw new Error('v0.11 alpha 配置缺少 build.extraResources');
}
const contextResources = packageJson.build.extraResources.filter(isContextPocResource);
if (contextResources.length !== 1) {
  throw new Error(`v0.11 alpha 配置必须精确携带一项 context-poc，实际 ${contextResources.length}`);
}
if (JSON.stringify(contextResources[0].filter)
    !== JSON.stringify(contextPocManifest.SOURCE_FILES)) {
  throw new Error('v0.11 alpha 配置的 context-poc 载体文件集未锁定为固定 15 文件');
}

async function alphaBeforePack(context) {
  const receipt = contextPocManifest.assertCommittedBaseline();
  console.log(
    `CONTEXT_POC_BUILD_ROOT_VERIFIED files=${receipt.files} bytes=${receipt.totalBytes} digest=${receipt.digest}`
  );
  return macosBuildVisibility(context);
}

module.exports = {
  ...packageJson.build,
  beforePack: alphaBeforePack,
  directories: {
    ...packageJson.build.directories,
    output: 'release'
  }
};
