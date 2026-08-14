'use strict';
// 纯 Node 冒烟测试：不需要 Electron。共 14 项断言。
// 覆盖：PATH 探测、which、端口探测、用自定义命令启动/停止后端（连进程组一起停）。
const os = require('os');
const path = require('path');
const fs = require('fs');

const backend = require('../lib/backend');
const config = require('../lib/config');
const log = require('../lib/log');

const PORT = 3123;
let failed = 0;

function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failed += 1;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-smoke-'));

  // config
  const data = config.init(tmp);
  check('config: 默认值加载', data.port === 3080 && data.autoStartBackend === true);
  check('config: 默认锁定后端版本', data.dshVersion === '0.1.0-rc.6');
  config.set({ port: PORT, command: `node "${path.join(__dirname, 'fake-backend.js')}"` });
  check('config: 写入并读取', config.get('port') === PORT);
  check('config: 文件已落盘', fs.existsSync(config.filePath()));

  // log
  log.init(path.join(tmp, 'logs'));
  log.line('test', 'hello');
  check('log: 写入与读取', log.recent().includes('hello') && fs.existsSync(log.filePath()));

  // PATH / which
  check('backend: fullPath 非空', backend.fullPath().split(':').length > 3);
  check('backend: which(node) 找得到', !!backend.which('node'), backend.which('node') || '');

  // 端口应当未开
  check('backend: 端口初始未开', !(await backend.isPortOpen(PORT)));

  // 启动假后端（走 config.command 自定义命令分支，shell:true）
  process.env.HARNESS_FAKE_PORT = String(PORT);
  const lines = [];
  let exited = false;
  const state = backend.start(config.get(), {
    onLine: (l) => lines.push(l),
    onExit: () => { exited = true; }
  });
  const up = await backend.waitForPort(PORT, { timeoutMs: 15000, intervalMs: 300 });
  let abortChecks = 0;
  const abortedAfterProbe = await backend.waitForPort(PORT, {
    timeoutMs: 1000,
    intervalMs: 50,
    shouldAbort: () => ++abortChecks > 1
  });
  check('backend: 启动后端口就绪', up && !abortedAfterProbe,
    `ready=${up} postProbeAbort=${!abortedAfterProbe}`);
  check('backend: 收到子进程输出', lines.some((l) => l.includes('fake harness listening')));

  // 停止并确认端口关闭
  await backend.stop(state);
  await new Promise((r) => setTimeout(r, 500));
  check('backend: 停止后进程已退出', exited || state.exited);
  check('backend: 停止后端口关闭', !(await backend.isPortOpen(PORT)));

  // resolveCommand 自动探测分支（清掉 command 覆盖后应能找到 dsh 或 npx）
  config.set({ command: null });
  const cmd = backend.resolveCommand(config.get());
  check('backend: resolveCommand 能自动探测', !!cmd, cmd ? cmd.label : 'null');
  const onlyNpx = (name) => name === 'npx' ? '/test/bin/npx' : null;
  const pinned = backend.resolveCommand({ dshVersion: '0.1.0-rc.6' }, onlyNpx);
  const latest = backend.resolveCommand({ dshVersion: 'latest' }, onlyNpx);
  const empty = backend.resolveCommand({ dshVersion: '  ' }, onlyNpx);
  check('backend: npx 回退命令带版本锁',
    pinned.file === '/test/bin/npx'
      && pinned.shell === false
      && pinned.version === '0.1.0-rc.6'
      && JSON.stringify(pinned.args) === JSON.stringify(['-y', '@deepseek-ai/dsh@0.1.0-rc.6', 'web'])
      && pinned.label === 'npx -y @deepseek-ai/dsh@0.1.0-rc.6 web'
      && latest.args[1] === '@deepseek-ai/dsh@latest'
      && latest.version === 'latest'
      && empty.args[1] === '@deepseek-ai/dsh@0.1.0-rc.6',
    pinned.label);

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(1);
});
