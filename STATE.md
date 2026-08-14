# STATE.md — 项目当前状态

更新：2026-08-14（发布候选收口）

## 阶段

**v0.1.1 本地发布候选已完成，尚未推送、打 tag 或发布。** 产品已更名为“鲸坞 WhaleDock”，默认 npx 回退锁定 `@deepseek-ai/dsh@0.1.0-rc.6`，旧 Harness Desktop 配置首启自动迁移；审计遗留的重试所有权、PATH 缓存、加载重试与隐藏窗口后台自愈问题均已修复。GitHub 仓库已改名为 `sgd-shine/whaledock`，旧地址可自动重定向，本地 `origin` 已同步。

v0.1.0（旧名 Harness Desktop）已发布。下列 v0.1.1 结果均来自本轮重新执行，不沿用旧版本证据。

## 本轮已验证

- `npm ci` 成功；`npm run smoke` 14/14 ALL PASS；全部 JavaScript `node --check` 与 `git diff --check` 通过。
- macOS 源码态真实启动通过：旧 `config.json` 已逐字节迁移到 WhaleDock 用户目录，日志显示锁定命令 `npx -y @deepseek-ai/dsh@0.1.0-rc.6 web`，真实 Harness 界面和“鲸坞 WhaleDock”原生窗口标题正常；Cmd+Q 后 dsh、npx、Electron 与 3080 监听均清零。
- 后端 ownership 与恢复通过：重试前会停掉仍存活的自有子进程；attach 到自有子进程不会丢失清理责任；真正的外部 dsh 在 WhaleDock 退出后仍存活；隐藏窗口下退出会按 1/2/4 秒最多恢复三次，逐次记日志，恢复成功不抢焦点。
- 加载重试通过代码与回归测试验证：只处理主框架，忽略 `ERR_ABORTED(-3)`，同一计时窗口不重复排队；端口探通后再次校验进程 ownership，避免“已退出却报成功”。
- 三次后台恢复全部失败时已请求 Electron Notification；当前未签名构建因 macOS 拒绝投递而记录错误，并成功回退到错误对话框，不再静默。
- `npm run dist` 成功生成 `WhaleDock-0.1.1-arm64.dmg` 与 `WhaleDock-0.1.1-arm64-mac.zip`。旧 `/Applications/Harness Desktop.app` 已可恢复地移入废纸篓，新版已从 dmg 安装为 `/Applications/WhaleDock.app` 并由 Finder 启动。
- 安装版 spawned 与 attach 两条路径均通过：锁定版 dsh 自动拉起、中文菜单/新名称/新图标/原生标题正常；Cmd+Q 会清理自有进程且不会误杀外部 dsh。
- `.github/workflows/ci.yml` 已配置为 push / PR 到 `main` 时在 Ubuntu + Node 22 执行 `npm ci` 与 `npm run smoke`；本地等价命令已通过，云端 job 要等本次提交推送后才会运行。
- `package.json` 无运行时依赖，devDependencies 仍只有 Electron 与 electron-builder；`lib/backend.js`、`lib/config.js`、`lib/log.js` 不依赖 Electron；未新增遥测。

## 待办 / 人工门槛

1. 桌面自动化无法操作 macOS SystemUIServer 状态项，也无法从另一个前台应用发送真正的系统级组合键。因此仍需 SGD 人工确认：托盘鲸鱼模板图在深浅色菜单栏都清晰且点击可唤回；在其他应用前台按 `⌘⇧H` 可呼出/隐藏 WhaleDock。代码、资源与注册日志已核对，但不冒充人工视觉/触发结果。
2. Notification Center 的真实投递需要有效 Apple 签名；v0.1.1 维持未签名分发，已验证失败日志与错误对话框兜底。签名后的通知投递留待后续版本。
3. 本轮完成英文提交后仍不自动 push、打 tag 或发布。由 SGD 决定何时推送 `main` 和 `v0.1.1`；推送后再以 GitHub Actions 实际结果闭环 CI 与 Release。

## 环境与产物备忘

- 真机：Apple Silicon `arm64`，macOS 26.5；Node v22.22.2，npm 10.9.7。
- dmg SHA-256：`0ab0350ae49e06791b15c913d6669c0372e29fd06e34323f432ea2d8e068d2f9`。
- zip SHA-256：`0d0b6b969963cd0dbbb3d9edfc941c463f3b23fc645a387a494ab0dfd69b7700`。
- 旧用户数据目录为 `~/Library/Application Support/Harness Desktop/`，新目录为 `WhaleDock`；首启只迁移 `config.json`，不迁移日志。
