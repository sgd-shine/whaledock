# STATE.md — 项目当前状态

更新：2026-08-14

## 阶段

**v0.1.0 已完成 macOS 真机落地、打包与本地安装，待推送 GitHub 并发布。** 源码运行与 `/Applications` 安装版均已用真实 dsh 验证；本地仓库完成首次提交后，由 SGD 决定何时创建远端并 push/tag。

## 已验证 / 未验证

已验证（macOS 26.5 / Apple Silicon）：`npm install` 成功；每次改动后 `npm run smoke` 12 项全过；App 能自动启动真实 `npx -y @deepseek-ai/dsh web`，也能 attach 到外部服务且退出时不杀它；启动错误态与复制日志、主窗口复制粘贴、外链、⌘R、窗口尺寸记忆、关窗常驻、Cmd+Q 进程组清理均通过。

安装验证：`npm run dist` 产出 arm64 dmg/zip；dmg 已通过 Finder 安装到 `/Applications/Harness Desktop.app`，从 Finder 启动后成功通过 GUI App 的 PATH 探测找到 Hermes Node/npx、启动 dsh，Cmd+Q 后 App、dsh 与 3080 监听全部清零。

仍需一次人工触发确认：本机日志已确认 `⌘⇧H` 注册成功、托盘创建无错误且模板图在浅色/深色系统外观下加载；当前桌面自动化不能向其他前台应用发送真正的全局按键，也不能点击 SystemUIServer 状态项，因此这两项不能用自动化结果代替最终手按/手点。

## 待办

1. 手动点一次菜单栏 H 图标，并在其他应用前台手按一次 `⌘⇧H` 完成最终人工确认。
2. GitHub 建仓、推送、打 tag `v0.1.0` 触发自动发布。
3. 补 README 截图；按 `docs/操作手册.md` 第 5 节拍演示视频。

## 环境备忘

上游：DeepSeek Harness（开发者预览，rc 版本，行为可能变动）；本次真机实测 `dsh web` 仍监听 127.0.0.1:3080。Node v22.22.2 由 Hermes 安装在 `~/.hermes/node`，`~/.local/bin` 软链接与登录 shell PATH 均能被 App 发现。
