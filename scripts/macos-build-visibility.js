'use strict';
// 防止 electron-builder 的裸 .app 被 Spotlight / LaunchServices 当成额外安装版本。
// 正式安装始终只有 /Applications/WhaleDock.app；构建副本移入隐藏、非 .app 后缀归档。

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_BUNDLE_NAME = 'WhaleDock.app';
const ARCHIVE_DIR_NAME = '.app-archives.noindex';
const NOINDEX_MARKER = '.metadata_never_index';
const MAC_STAGE_DIRS = new Set(['mac', 'mac-arm64', 'mac-x64', 'mac-universal']);
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const MDFIND = '/usr/bin/mdfind';
const CANONICAL_APP = '/Applications/WhaleDock.app';
const BUNDLE_QUERY = 'kMDItemCFBundleIdentifier == "com.sgd.whaledock"c';

function touch(filePath) {
  const descriptor = fs.openSync(filePath, 'a');
  fs.closeSync(descriptor);
}

function safeDirectory(dirPath, label) {
  const stat = fs.lstatSync(dirPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label}必须是真实目录，不能是符号链接：${dirPath}`);
  }
}

function prepareOutput(outDir) {
  const resolved = path.resolve(outDir);
  fs.mkdirSync(resolved, { recursive: true });
  safeDirectory(resolved, '构建输出目录');
  touch(path.join(resolved, NOINDEX_MARKER));
  return resolved;
}

function findStagingApps(outDir) {
  const resolved = path.resolve(outDir);
  if (!fs.existsSync(resolved)) return [];
  safeDirectory(resolved, '构建输出目录');

  const matches = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!MAC_STAGE_DIRS.has(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const stageDir = path.join(resolved, entry.name);
    const bundlePath = path.join(stageDir, APP_BUNDLE_NAME);
    if (!fs.existsSync(bundlePath)) continue;
    const stat = fs.lstatSync(bundlePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;

    const realBundle = fs.realpathSync(bundlePath);
    const realOutput = fs.realpathSync(resolved);
    if (path.dirname(path.dirname(realBundle)) !== realOutput
        || path.basename(path.dirname(realBundle)) !== entry.name
        || path.basename(realBundle) !== APP_BUNDLE_NAME) {
      throw new Error(`构建 App 路径越界：${bundlePath}`);
    }
    matches.push(bundlePath);
  }
  return matches.sort();
}

function rollingArchivePath(archiveDir, stageName) {
  const arch = stageName === 'mac' ? 'x64' : stageName.slice('mac-'.length);
  return path.join(archiveDir, `WhaleDock-${arch}.app-bundle`);
}

function unregisterBundle(bundlePath, options = {}) {
  if (options.unregister === false || process.platform !== 'darwin' || !fs.existsSync(LSREGISTER)) {
    return { attempted: false, ok: true };
  }
  const result = spawnSync(LSREGISTER, ['-u', bundlePath], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
  const detail = String(result.stderr || '').trim();
  // -10814 表示这个刚生成的裸包尚未进入 LaunchServices；无需把“没有可注销记录”当成失败。
  const notRegistered = /-10814/.test(detail);
  return {
    attempted: true,
    ok: !result.error && (result.status === 0 || notRegistered),
    error: result.error || (result.status === 0 || notRegistered ? null : new Error(
      detail || `lsregister exit ${result.status}`
    ))
  };
}

function visibleWhaleDockApps(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'darwin') return [];
  const run = options.spawnSync || spawnSync;
  const result = run(MDFIND, [BUNDLE_QUERY], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(String(result.stderr || `mdfind exit ${result.status}`).trim());
  }
  return String(result.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort();
}

function unexpectedVisibleApps(appPaths, canonicalApp = CANONICAL_APP) {
  const canonical = path.resolve(canonicalApp);
  return appPaths.filter((appPath) => path.resolve(appPath) !== canonical);
}

function buildIncludesMac(context) {
  if (!(context && context.platformToTargets instanceof Map)) return false;
  return [...context.platformToTargets.keys()].some((platform) => platform
    && (platform.nodeName === 'darwin' || platform.name === 'mac'));
}

function archiveMacAppBundles(outDir, options = {}) {
  const resolved = prepareOutput(outDir);
  const bundles = findStagingApps(resolved);
  if (!bundles.length) return [];

  const archiveDir = path.join(resolved, ARCHIVE_DIR_NAME);
  fs.mkdirSync(archiveDir, { recursive: true });
  safeDirectory(archiveDir, 'App 归档目录');
  touch(path.join(archiveDir, NOINDEX_MARKER));

  const archived = [];
  for (const source of bundles) {
    const unregister = unregisterBundle(source, options);
    if (unregister.attempted && !unregister.ok) {
      console.warn(`MACOS_APP_UNREGISTER_WARNING ${source}: ${unregister.error.message}`);
    }
    const destination = rollingArchivePath(archiveDir, path.basename(path.dirname(source)));
    if (fs.existsSync(destination)) {
      safeDirectory(destination, '已有 App 归档');
      fs.rmSync(destination, { recursive: true });
      console.log(`MACOS_BUILD_APP_ARCHIVE_REPLACED ${destination}`);
    }
    fs.renameSync(source, destination);
    archived.push({ source, destination });
    console.log(`MACOS_BUILD_APP_ARCHIVED ${source} -> ${destination}`);
  }
  return archived;
}

// 同一个模块同时承接 electron-builder 的 beforePack 与 afterAllArtifactBuild。
// beforePack 先写 no-index 标记，失败构建也不会新增系统 App；全部产物完成后再归档裸包。
async function electronBuilderHook(context) {
  if (!context || typeof context.outDir !== 'string') {
    throw new Error('electron-builder hook 缺少 outDir');
  }
  if (Array.isArray(context.artifactPaths)) {
    if (buildIncludesMac(context)) archiveMacAppBundles(context.outDir);
  } else if (context.electronPlatformName === 'darwin') {
    prepareOutput(context.outDir);
  }
  return [];
}

function parseArgs(argv) {
  const result = { check: false, outDir: path.join(ROOT, 'release') };
  for (const value of argv) {
    if (value === '--check') result.check = true;
    else if (value.startsWith('--out-dir=')) {
      result.outDir = path.resolve(ROOT, value.slice('--out-dir='.length));
    } else {
      throw new Error(`未知参数：${value}`);
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.check) {
    const remaining = findStagingApps(args.outDir);
    const visible = visibleWhaleDockApps();
    const unexpected = unexpectedVisibleApps(visible);
    if (remaining.length || unexpected.length) {
      throw new Error(
        `MACOS_APP_VISIBILITY_FAIL staging=${remaining.length} unexpected=${unexpected.length} `
        + [...remaining, ...unexpected].join(',')
      );
    }
    console.log(`MACOS_APP_VISIBILITY_PASS staging=0 unexpected=0 visible=${visible.length}`);
    return;
  }
  const archived = archiveMacAppBundles(args.outDir);
  console.log(`MACOS_APP_VISIBILITY_CLEAN archived=${archived.length}`);
}

module.exports = electronBuilderHook;
module.exports.prepareOutput = prepareOutput;
module.exports.findStagingApps = findStagingApps;
module.exports.archiveMacAppBundles = archiveMacAppBundles;
module.exports.visibleWhaleDockApps = visibleWhaleDockApps;
module.exports.unexpectedVisibleApps = unexpectedVisibleApps;
module.exports.buildIncludesMac = buildIncludesMac;

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exit(1);
  }
}
