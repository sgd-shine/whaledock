# HANDOFF.md — 交接说明

更新：2026-08-14 · 交接方向：Claude（云端方案与实现）→ Codex（macOS 真机落地完成）→ SGD（发布与拍视频）

## Codex 已完成

六阶段已执行：真实 dsh spawned/attach、错误态与日志、主窗口交互、窗口生命周期、进程清理、dmg/zip 构建、Finder 安装与 GUI PATH 探测均有本机证据；最终 smoke 12 项全过。唯一代码配置修复是禁止本地 `npm run dist` 自动选择 Keychain 中无关的签名身份，保持 v0.1 未签名分发边界。

## 给 SGD

本地产物在 `release/Harness Desktop-0.1.0-arm64.dmg` 与 `release/Harness Desktop-0.1.0-arm64-mac.zip`，安装版在 `/Applications/Harness Desktop.app`。先手动完成菜单栏 H 图标点击与其他应用前台 `⌘⇧H` 两个最终触发确认，再按 `docs/操作手册.md` 第 4、5 节发布与拍视频；不要把 `release/` 或 `node_modules/` 提交进仓库。

## 边界与未决

真实 dsh 本次仍使用 `web` 子命令并监听 3080，无交互式初始化问题；未来 rc 行为若变化，修改仍须收敛到 `lib/backend.js` 与 `lib/config.js`。GitHub 用户名已设为 `sgd-shine`。签名公证、自动更新、Windows 支持均明确不在 v0.1 范围（见 `docs/开发方案.md` 第 2、12 节）。
