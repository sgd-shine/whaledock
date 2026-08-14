# STATE.md — 项目当前状态

更新：2026-08-14

## 阶段

**v0.1.0 已完成 macOS 真机落地、打包、本地安装与 GitHub 自动发布。** 公开仓库为 `https://github.com/sgd-shine/harness-desktop`；标签 `v0.1.0` 已触发 GitHub Actions，云端 smoke、dmg/zip 构建与 Release 发布全部成功。

## 已验证 / 未验证

已验证（macOS 26.5 / Apple Silicon）：`npm install` 成功；每次改动后 `npm run smoke` 12 项全过；App 能自动启动真实 `npx -y @deepseek-ai/dsh web`，也能 attach 到外部服务且退出时不杀它；启动错误态与复制日志、主窗口复制粘贴、外链、⌘R、窗口尺寸记忆、关窗常驻、Cmd+Q 进程组清理均通过。

安装验证：`npm run dist` 产出 arm64 dmg/zip；dmg 已通过 Finder 安装到 `/Applications/Harness Desktop.app`，从 Finder 启动后成功通过 GUI App 的 PATH 探测找到 Hermes Node/npx、启动 dsh，Cmd+Q 后 App、dsh 与 3080 监听全部清零。

本地副本已整理：`/Applications/Harness Desktop.app` 与本地构建、dmg 内版本的关键哈希一致，确认已是最新版；挂载的 dmg 已推出，`release/mac-arm64/Harness Desktop.app` 已移入废纸篓，Launch Services 只保留 `/Applications` 正式安装版。当前启动进程也来自 `/Applications`。

仍需一次人工触发确认：本机日志已确认 `⌘⇧H` 注册成功、托盘创建无错误且模板图在浅色/深色系统外观下加载；当前桌面自动化不能向其他前台应用发送真正的全局按键，也不能点击 SystemUIServer 状态项，因此这两项不能用自动化结果代替最终手按/手点。

## 待办

1. 手动点一次菜单栏 H 图标，并在其他应用前台手按一次 `⌘⇧H` 完成最终人工确认。
2. 补 README 截图；按 `docs/操作手册.md` 第 5 节拍演示视频。

## 环境备忘

上游：DeepSeek Harness（开发者预览，rc 版本，行为可能变动）；本次真机实测 `dsh web` 仍监听 127.0.0.1:3080。Node v22.22.2 由 Hermes 安装在 `~/.hermes/node`，`~/.local/bin` 软链接与登录 shell PATH 均能被 App 发现。
