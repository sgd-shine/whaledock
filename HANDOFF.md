# HANDOFF.md — 交接说明

更新：2026-08-14 · 交接方向：Claude（云端方案与实现）→ Codex（macOS 真机落地与发布完成）→ SGD（最终手动触发确认与拍视频）

## Codex 已完成

六阶段已执行：真实 dsh spawned/attach、错误态与日志、主窗口交互、窗口生命周期、进程清理、dmg/zip 构建、Finder 安装与 GUI PATH 探测均有本机证据；最终 smoke 12 项全过。公开仓库、`v0.1.0` 标签与 GitHub Release 已上线，云端 macOS job 的 smoke、构建、发布全部成功。唯一代码配置修复是禁止本地 `npm run dist` 自动选择 Keychain 中无关的签名身份，保持 v0.1 未签名分发边界。

## 给 SGD

公开仓库为 `https://github.com/sgd-shine/harness-desktop`，在线安装包见 `https://github.com/sgd-shine/harness-desktop/releases/tag/v0.1.0`。本地产物仍在 `release/Harness Desktop-0.1.0-arm64.dmg` 与 `release/Harness Desktop-0.1.0-arm64-mac.zip`，唯一正式安装版为 `/Applications/Harness Desktop.app`；重复的构建副本已移入废纸篓、dmg 已推出。先手动完成菜单栏 H 图标点击与其他应用前台 `⌘⇧H` 两个最终触发确认，再按 `docs/操作手册.md` 第 5 节拍视频；不要把 `release/` 或 `node_modules/` 提交进仓库。

## 边界与未决

真实 dsh 本次仍使用 `web` 子命令并监听 3080，无交互式初始化问题；未来 rc 行为若变化，修改仍须收敛到 `lib/backend.js` 与 `lib/config.js`。GitHub 用户名已设为 `sgd-shine`。签名公证、自动更新、Windows 支持均明确不在 v0.1 范围（见 `docs/开发方案.md` 第 2、12 节）。
