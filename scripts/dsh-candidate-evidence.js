'use strict';

// 候选 dsh runtime 原生证据收集器：只读 runtime，不执行其中的原生文件。
// 唯一允许的执行是用当前精确 Node 调用根包精确 bin 的 web --dump-config。
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REPORT_SCHEMA_VERSION = 1;
const RUNTIME_MANIFEST_SCHEMA_VERSION = 3;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DUMP_BYTES = 64 * 1024 * 1024;
const CANDIDATE_PREFIX = 'whaledock-dsh-candidate-';
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'binary');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compareNames(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function containedIn(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function existsNoFollow(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function regularFile(filePath, label, maximum = null) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (_error) { /* 统一报错 */ }
  if (!stat || !stat.isFile()) throw new Error(`${label}必须是普通文件`);
  if (maximum !== null && stat.size > maximum) throw new Error(`${label}超过字节上限`);
  return stat;
}

function readJson(filePath, label) {
  regularFile(filePath, label, MAX_JSON_BYTES);
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_error) {
    throw new Error(`${label}不是有效 JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}顶层必须是对象`);
  }
  return value;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    let name;
    let value;
    const equal = token.match(/^--(runtime|output)=(.+)$/s);
    if (equal) {
      [, name, value] = equal;
    } else if (token === '--runtime' || token === '--output') {
      name = token.slice(2);
      value = argv[++index];
    } else {
      throw new Error(`不支持的参数：${String(token)}`);
    }
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
      throw new Error(`--${name} 缺少有效值`);
    }
    if (values.has(name)) throw new Error(`--${name} 不能重复`);
    values.set(name, value);
  }
  if (!values.has('runtime') || !values.has('output')) {
    throw new Error('必须同时提供 --runtime 与 --output');
  }
  return { runtime: values.get('runtime'), output: values.get('output') };
}

function resolveRuntime(requested) {
  const resolved = path.resolve(requested);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('runtime 必须是真实目录');
  return fs.realpathSync(resolved);
}

function resolveOutput(requested, runtime) {
  const output = path.resolve(requested);
  if (existsNoFollow(output)) throw new Error('output 必须尚不存在');
  const parent = fs.realpathSync(path.dirname(output));
  const canonical = path.join(parent, path.basename(output));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temporaryRoot, canonical);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..'
      || path.isAbsolute(relative) || segments.length < 2
      || !segments[0].startsWith(CANDIDATE_PREFIX)
      || segments[0].length === CANDIDATE_PREFIX.length) {
    throw new Error(`output 必须位于系统临时目录的 ${CANDIDATE_PREFIX}* 根内`);
  }
  const candidateRoot = path.join(temporaryRoot, segments[0]);
  const rootStat = fs.lstatSync(candidateRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
      || fs.realpathSync(candidateRoot) !== candidateRoot) {
    throw new Error('候选证据根必须是真实目录');
  }
  if (!containedIn(candidateRoot, canonical)) throw new Error('output 逃离候选证据根');
  if (containedIn(runtime, canonical)) throw new Error('output 不得写入 runtime 树');
  return { output: canonical, candidateRoot };
}

const CPU_NAMES = new Map([
  [0x00000007, 'x86'],
  [0x01000007, 'x86_64'],
  [0x0000000c, 'arm'],
  [0x0100000c, 'arm64']
]);

const PE_MACHINE_NAMES = new Map([
  [0x014c, 'x86'],
  [0x01c0, 'arm'],
  [0x01c4, 'armv7'],
  [0x8664, 'x86_64'],
  [0xaa64, 'arm64']
]);

function machineName(value, map) {
  return map.get(value >>> 0) || `unknown-0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function machoInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  const magic = buffer.readUInt32BE(0);
  const thin = new Map([
    [0xfeedface, 'BE'], [0xfeedfacf, 'BE'],
    [0xcefaedfe, 'LE'], [0xcffaedfe, 'LE']
  ]);
  if (thin.has(magic)) {
    const cpu = thin.get(magic) === 'BE' ? buffer.readUInt32BE(4) : buffer.readUInt32LE(4);
    return { format: 'mach-o', kind: 'thin', machines: [machineName(cpu, CPU_NAMES)] };
  }

  const fat = new Map([
    [0xcafebabe, { endian: 'BE', width: 20 }],
    [0xbebafeca, { endian: 'LE', width: 20 }],
    [0xcafebabf, { endian: 'BE', width: 32 }],
    [0xbfbafeca, { endian: 'LE', width: 32 }]
  ]);
  const layout = fat.get(magic);
  if (!layout) return null;
  const read = layout.endian === 'BE'
    ? (offset) => buffer.readUInt32BE(offset)
    : (offset) => buffer.readUInt32LE(offset);
  const count = read(4);
  // cafebabe 也是 Java class 魔数；只接受边界内且头部完整的 arch 数。
  if (count < 1 || count >= 32 || 8 + count * layout.width > buffer.length) return null;
  const machines = [];
  for (let index = 0; index < count; index += 1) {
    const cpu = read(8 + index * layout.width);
    const name = machineName(cpu, CPU_NAMES);
    if (!machines.includes(name)) machines.push(name);
  }
  return { format: 'mach-o', kind: layout.width === 32 ? 'fat64' : 'fat', machines };
}

function peInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64
      || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null;
  const offset = buffer.readUInt32LE(0x3c);
  if (offset > buffer.length - 6
      || buffer.subarray(offset, offset + 4).compare(Buffer.from([0x50, 0x45, 0, 0])) !== 0) return null;
  const machine = buffer.readUInt16LE(offset + 4);
  return { format: 'pe', kind: 'image', machines: [machineName(machine, PE_MACHINE_NAMES)] };
}

function nativeInfo(buffer) {
  return machoInfo(buffer) || peInfo(buffer);
}

function installScriptPackages(lock) {
  const observed = new Set();
  for (const [lockPath, entry] of Object.entries(lock.packages || {})) {
    if (!entry || entry.hasInstallScript !== true) continue;
    const marker = 'node_modules/';
    const offset = lockPath.lastIndexOf(marker);
    if (offset < 0 || offset + marker.length >= lockPath.length) {
      throw new Error(`runtime lock 带安装脚本的条目无法识别：${lockPath}`);
    }
    observed.add(lockPath.slice(offset + marker.length));
  }
  return [...observed].sort(compareNames);
}

function walkRuntime(runtime) {
  const entries = [];
  const nativeBinaries = [];
  let logicalBytes = 0;
  let symlinkTargetBytes = 0;
  let fileCount = 0;
  let symlinkCount = 0;
  let directoryCount = 0;

  function visit(fullPath, relative) {
    const stat = fs.lstatSync(fullPath);
    const mode = `0o${(stat.mode & 0o7777).toString(8).padStart(4, '0')}`;
    const portablePath = relative === '.' ? '.' : relative.split(path.sep).join('/');
    if (stat.isDirectory()) {
      directoryCount += 1;
      entries.push({ path: portablePath, type: 'directory', mode });
      const names = fs.readdirSync(fullPath).sort(compareNames);
      for (const name of names) visit(path.join(fullPath, name), relative === '.' ? name : path.join(relative, name));
      return;
    }
    if (stat.isSymbolicLink()) {
      symlinkCount += 1;
      const target = fs.readlinkSync(fullPath);
      const bytes = Buffer.byteLength(target, 'utf8');
      symlinkTargetBytes += bytes;
      entries.push({
        path: portablePath, type: 'symlink', mode, target,
        targetBytes: bytes, sha256: sha256(Buffer.from(target, 'utf8'))
      });
      return;
    }
    if (!stat.isFile()) throw new Error(`runtime 包含不支持的文件类型：${portablePath}`);
    const content = fs.readFileSync(fullPath);
    if (content.length !== stat.size) throw new Error(`runtime 文件读取期间变化：${portablePath}`);
    const digest = sha256(content);
    fileCount += 1;
    logicalBytes += content.length;
    entries.push({ path: portablePath, type: 'file', mode, bytes: content.length, sha256: digest });
    const native = nativeInfo(content);
    if (native) nativeBinaries.push({
      path: portablePath, format: native.format, kind: native.kind,
      machines: native.machines, bytes: content.length, sha256: digest
    });
  }

  visit(runtime, '.');
  const canonical = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  const compressed = zlib.gzipSync(canonical, {
    level: 9,
    strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    mtime: 0
  });
  return {
    entries,
    summary: {
      directoryCount, fileCount, symlinkCount, logicalBytes, symlinkTargetBytes,
      canonicalBytes: canonical.length,
      canonicalSha256: sha256(canonical),
      compression: 'node:zlib-gzip-level-9-mtime-0',
      compressionNodeVersion: process.version,
      compressionZlibVersion: process.versions.zlib,
      compressedBytes: compressed.length,
      compressedSha256: sha256(compressed)
    },
    nativeBinaries
  };
}

function targetNativeProofs(nativeBinaries, platform, arch) {
  if (platform !== 'darwin' && platform !== 'win32') return [];
  const targetMachine = arch === 'x64' ? 'x86_64' : arch;
  const escapedPlatform = platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedArch = arch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specs = [
    ['sharp-addon', new RegExp(`^node_modules/@img/sharp-${escapedPlatform}-${escapedArch}/lib/sharp-${escapedPlatform}-${escapedArch}-.+\\.node$`)],
    ['koffi-addon', new RegExp(`^node_modules/@koromix/koffi-${escapedPlatform}-${escapedArch}/${escapedPlatform}_${escapedArch}/koffi\\.node$`)],
    ['ripgrep', new RegExp(`^node_modules/@vscode/ripgrep-${escapedPlatform}-${escapedArch}/bin/rg(?:\\.exe)?$`)],
    ['builtin-addon', new RegExp(`^node_modules/node-addon-require-builtin-${escapedPlatform}-${escapedArch}${platform === 'win32' ? '-msvc' : ''}/prebuilt/${escapedPlatform}-${escapedArch}${platform === 'win32' ? '-msvc' : ''}-.+\\.node$`)]
  ];
  if (platform === 'darwin') {
    specs.push(
      ['sharp-libvips', new RegExp(`^node_modules/@img/sharp-libvips-darwin-${escapedArch}/lib/libvips-cpp\\..+\\.dylib$`)],
      ['node-pty', new RegExp(`^node_modules/node-pty/prebuilds/darwin-${escapedArch}/pty\\.node$`)],
      ['node-pty-spawn-helper', new RegExp(`^node_modules/node-pty/prebuilds/darwin-${escapedArch}/spawn-helper$`)]
    );
  } else {
    const prefix = `^node_modules/node-pty/prebuilds/win32-${escapedArch}/`;
    specs.push(
      ['node-pty-conpty', new RegExp(`${prefix}conpty\\.node$`)],
      ['node-pty-console-list', new RegExp(`${prefix}conpty_console_list\\.node$`)],
      ['node-pty-open-console', new RegExp(`${prefix}conpty/OpenConsole\\.exe$`)],
      ['node-pty-conpty-dll', new RegExp(`${prefix}conpty/conpty\\.dll$`)]
    );
  }
  return specs.map(([label, pattern]) => {
    const matches = nativeBinaries.filter((item) => pattern.test(item.path));
    assert.equal(matches.length, 1, `目标原生文件 ${label} 数量不是 1`);
    assert(
      matches[0].machines.includes(targetMachine),
      `目标原生文件 ${label} 机器类型不匹配 ${targetMachine}`
    );
    return { label, ...matches[0] };
  });
}

function runtimeConsistency(runtime) {
  const manifestPath = path.join(runtime, 'manifest.json');
  const packagePath = path.join(runtime, 'package.json');
  const lockPath = path.join(runtime, 'package-lock.json');
  const installedPath = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  const manifest = readJson(manifestPath, 'runtime manifest');
  const rootPackage = readJson(packagePath, 'runtime package.json');
  regularFile(lockPath, 'runtime package-lock.json', MAX_JSON_BYTES);
  const lockBytes = fs.readFileSync(lockPath);
  let lock;
  try { lock = JSON.parse(lockBytes); } catch (_error) { throw new Error('runtime package-lock.json 不是有效 JSON'); }
  const installed = readJson(installedPath, 'installed dsh package.json');

  assert.equal(manifest.schemaVersion, RUNTIME_MANIFEST_SCHEMA_VERSION, 'runtime manifest schemaVersion 不匹配');
  for (const [field, expected] of [
    ['platform', process.platform], ['hostPlatform', process.platform],
    ['arch', process.arch], ['hostArch', process.arch]
  ]) assert.equal(manifest[field], expected, `runtime manifest ${field} 不匹配`);

  const version = manifest.dshVersion;
  assert.equal(typeof version, 'string');
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.installScriptsIgnored, true);
  const lockRoot = lock.packages && lock.packages[''];
  const lockDsh = lock.packages && lock.packages['node_modules/@deepseek-ai/dsh'];
  assert(lockRoot && lockDsh, 'runtime lock 缺少根或 dsh 条目');
  assert.equal(rootPackage.name, lock.name);
  assert.equal(rootPackage.name, lockRoot.name);
  assert.equal(rootPackage.version, lock.version);
  assert.equal(rootPackage.version, lockRoot.version);
  assert.equal(rootPackage.dependencies && rootPackage.dependencies['@deepseek-ai/dsh'], version);
  assert.equal(lockRoot.dependencies && lockRoot.dependencies['@deepseek-ai/dsh'], version);
  assert.equal(lockDsh.version, version);
  assert.equal(installed.name, '@deepseek-ai/dsh');
  assert.equal(installed.version, version);
  assert.equal(typeof lockDsh.integrity, 'string');
  assert.equal(manifest.packageIntegrity, lockDsh.integrity);
  assert.equal(manifest.auditedLockSha256, sha256(lockBytes));
  assert(Array.isArray(manifest.installScriptPackages), 'runtime manifest installScriptPackages 必须是数组');
  const observedInstallScripts = installScriptPackages(lock);
  assert.deepEqual(
    manifest.installScriptPackages,
    observedInstallScripts,
    'runtime manifest installScriptPackages 与 lock 不一致'
  );

  const binRelative = typeof installed.bin === 'string' ? installed.bin : installed.bin && installed.bin.dsh;
  assert.equal(typeof binRelative, 'string');
  const packageRoot = fs.realpathSync(path.dirname(installedPath));
  const bin = fs.realpathSync(path.resolve(packageRoot, binRelative));
  assert(containedIn(packageRoot, bin), 'dsh bin 逃离已安装包');
  regularFile(bin, 'dsh bin');
  return {
    manifest,
    bin,
    report: {
      version,
      platform: manifest.platform,
      arch: manifest.arch,
      hostPlatform: manifest.hostPlatform,
      hostArch: manifest.hostArch,
      manifestSha256: sha256(fs.readFileSync(manifestPath)),
      packageSha256: sha256(fs.readFileSync(packagePath)),
      lockSha256: sha256(lockBytes),
      installedPackageSha256: sha256(fs.readFileSync(installedPath)),
      packageIntegrity: lockDsh.integrity,
      lockPackages: Object.keys(lock.packages).length,
      installScriptsIgnored: true,
      installScriptPackages: observedInstallScripts,
      exactBinRelative: path.relative(runtime, bin).split(path.sep).join('/')
    }
  };
}

function dumpEnvironment(sandbox) {
  const home = path.join(sandbox, 'home');
  const dshHome = path.join(sandbox, 'dsh-home');
  const config = path.join(sandbox, 'xdg-config');
  const cache = path.join(sandbox, 'xdg-cache');
  const data = path.join(sandbox, 'xdg-data');
  const temp = path.join(sandbox, 'tmp');
  for (const directory of [home, dshHome, config, cache, data, temp]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const searchPath = process.platform === 'win32'
    ? [path.dirname(process.execPath), path.join(systemRoot, 'System32')]
    : [path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const env = {
    PATH: searchPath.filter((item, index, list) => item && list.indexOf(item) === index).join(path.delimiter),
    HOME: home,
    DSH_HOME: dshHome,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    LANG: 'C',
    LC_ALL: 'C',
    TERM: 'dumb',
    NO_COLOR: '1',
    DSH_TELEMETRY_MODE: 'DISABLED',
    DSH_TELEMETRY_DISABLED: '1'
  };
  if (process.platform === 'win32') {
    env.USERPROFILE = home;
    env.APPDATA = path.join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    env.SystemRoot = systemRoot;
  }
  return env;
}

function dumpConfig(bin, runtime, candidateRoot) {
  const sandbox = path.join(candidateRoot, '.dsh-candidate-evidence-sandbox');
  if (existsNoFollow(sandbox)) throw new Error('隔离 dump-config 目录已存在');
  fs.mkdirSync(sandbox, { mode: 0o700 });
  try {
    const result = spawnSync(fs.realpathSync(process.execPath), [bin, 'web', '--dump-config'], {
      cwd: runtime,
      env: dumpEnvironment(sandbox),
      encoding: null,
      timeout: 60000,
      maxBuffer: MAX_DUMP_BYTES,
      windowsHide: true,
      shell: false
    });
    if (result.error) throw new Error(`dump-config 执行失败：${result.error.code || result.error.name}`);
    if (result.signal) throw new Error(`dump-config 被信号终止：${result.signal}`);
    assert.equal(result.status, 0, 'dump-config 退出码非 0');
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
    const text = stdout.toString('utf8');
    const newlineCount = (text.match(/\n/g) || []).length;
    return {
      exit: result.status,
      bytes: stdout.length,
      lines: stdout.length === 0 ? 0 : newlineCount + (text.endsWith('\n') ? 0 : 1),
      sha256: sha256(stdout),
      stderrBytes: stderr.length,
      stderrSha256: sha256(stderr)
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: false });
  }
}

function collectEvidence(options) {
  const runtime = resolveRuntime(options.runtime);
  const destination = resolveOutput(options.output, runtime);
  const consistency = runtimeConsistency(runtime);
  const tree = walkRuntime(runtime);
  const nativeProofs = targetNativeProofs(
    tree.nativeBinaries,
    consistency.manifest.platform,
    consistency.manifest.arch
  );
  const dump = dumpConfig(consistency.bin, runtime, destination.candidateRoot);
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runtime: consistency.report,
    tree: { ...tree.summary, entries: tree.entries },
    nativeBinaries: tree.nativeBinaries,
    targetNativeProofs: nativeProofs,
    dumpConfig: dump
  };
  const outputBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(destination.output, outputBytes, { flag: 'wx', mode: 0o600 });
  return { report, output: destination.output, outputBytes: outputBytes.length, outputSha256: sha256(outputBytes) };
}

function main(argv = process.argv.slice(2)) {
  const result = collectEvidence(parseArgs(argv));
  console.log(JSON.stringify({
    status: 'PASS',
    outputBytes: result.outputBytes,
    outputSha256: result.outputSha256,
    files: result.report.tree.fileCount,
    nativeBinaries: result.report.nativeBinaries.length
  }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`DSH_CANDIDATE_EVIDENCE_FAIL ${error && error.message ? error.message : 'unknown'}`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectEvidence,
  containedIn,
  machoInfo,
  nativeInfo,
  parseArgs,
  peInfo,
  resolveOutput,
  targetNativeProofs,
  walkRuntime
};
