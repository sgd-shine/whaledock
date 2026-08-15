'use strict';
// 构建期准备锁定版 dsh 运行时；运行期不调用 npm，也不修改用户目录。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DEFAULTS } = require('../lib/config');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'vendor', 'dsh-runtime');
const version = String(DEFAULTS.dshVersion || '').trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('DEFAULTS.dshVersion 必须是可复现的固定版本');
}

try {
  const current = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  const installed = JSON.parse(fs.readFileSync(path.join(
    outputDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'
  ), 'utf8'));
  if (current.dshVersion === version
      && current.platform === process.platform
      && current.arch === process.arch
      && current.packageIntegrity
      && installed.version === version) {
    console.log(`BUNDLED_DSH_REUSE ${version} ${process.platform}/${process.arch}`);
    process.exit(0);
  }
} catch (_e) { /* 缓存缺失或损坏时重新生成 */ }

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify({
  name: 'whaledock-dsh-runtime',
  private: true,
  version: '0.0.0',
  dependencies: {
    '@deepseek-ai/dsh': version
  }
}, null, 2) + '\n');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, [
  'install',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
  '--save-exact'
], {
  cwd: outputDir,
  stdio: 'inherit',
  env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false' }
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);

const installedManifestPath = path.join(
  outputDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'
);
const installed = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'));
if (installed.name !== '@deepseek-ai/dsh' || installed.version !== version) {
  throw new Error(`内置 dsh 校验失败：得到 ${installed.name}@${installed.version}，预期 @deepseek-ai/dsh@${version}`);
}

const lock = JSON.parse(fs.readFileSync(path.join(outputDir, 'package-lock.json'), 'utf8'));
const lockEntry = lock.packages && lock.packages['node_modules/@deepseek-ai/dsh'];
if (!lockEntry || lockEntry.version !== version || !lockEntry.integrity) {
  throw new Error('package-lock.json 缺少锁定版 dsh 的完整性信息');
}

const manifest = {
  schemaVersion: 1,
  dshVersion: version,
  packageIntegrity: lockEntry.integrity,
  platform: process.platform,
  arch: process.arch,
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log(`BUNDLED_DSH_READY ${version} ${process.platform}/${process.arch}`);
