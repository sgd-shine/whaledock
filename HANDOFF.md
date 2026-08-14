# HANDOFF.md — v0.1.1 发布交接

更新：2026-08-14 · Codex（macOS 真机回归与发布准备）→ SGD（最终人工触发与发布时机）

## 已完成

鲸坞 WhaleDock v0.1.1 的改名、原创鲸鱼与坞图标、旧配置迁移、dsh 默认版本锁定、审计遗留修复和 main push/PR CI 已收口。14 项 smoke、源码态真实 dsh、隐藏窗口后台恢复、外部服务 attach、Finder 安装版 spawned/attach、Cmd+Q 进程清理与 dmg/zip 构建均已在本机重新验证；这不是沿用 v0.1.0 的历史结果。

GitHub 仓库现为 `https://github.com/sgd-shine/whaledock`，旧地址自动重定向，本地 `origin` 已同步。代码只做本地英文提交，不会自动 push、打 tag 或发布。

## 本地产物与安装状态

- 安装版：`/Applications/WhaleDock.app`（v0.1.1，arm64，bundle ID `com.sgd.whaledock`，按既定边界未签名）。
- 产物：`release/WhaleDock-0.1.1-arm64.dmg`、`release/WhaleDock-0.1.1-arm64-mac.zip`。
- 旧 `/Applications/Harness Desktop.app` 已移到废纸篓，仍可恢复；dmg 已推出。
- `release/` 与 `node_modules/` 继续由 `.gitignore` 排除，不进入提交。

## 给 SGD 的两个最终人工触发

1. 分别在浅色与深色菜单栏目视鲸鱼托盘图，并在关窗后点击它确认窗口唤回。
2. 保持另一个应用在前台，按 `⌘⇧H`，确认 WhaleDock 能呼出并再次隐藏。

桌面自动化无法直接控制 SystemUIServer 状态项，也不能替代另一个前台应用发出真正的全局快捷键，因此这两项保留人工门槛。快捷键注册日志、template image 设置、16×16/32×32 托盘资源与关窗常驻均已验证。

## 发布边界

当前未签名构建无法让 Electron Notification 进入 macOS 通知中心；三次恢复失败时的发送失败日志与错误对话框兜底已通过。签名公证、通知中心真投递和 Mac 自动更新不在 v0.1.1 范围。上游 dsh 仍是 rc 版本；其端口、子命令与版本假设继续只允许维护在 `lib/backend.js` 与 `lib/config.js`。

人工确认后，由 SGD 决定何时 push `main` 并推送 `v0.1.1` tag；tag 会触发 `.github/workflows/release.yml` 的云端 smoke、构建与 GitHub Release。
