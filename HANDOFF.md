# HANDOFF.md — WhaleDock v0.2 正式发布交接

更新：2026-08-15 · Codex 连续发布执行

## 当前结论

v0.2 工程、macOS 本地验收与 G1 第三方材料已经闭环；正式发布正在执行中。

- PR：<https://github.com/sgd-shine/whaledock/pull/1>
- 当前候选分支：`codex/v0.2-production`
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 当前稳定版仍为 `v0.1.1`；`v0.2.0` tag / Release 尚未创建。
- 本机 `/Applications/WhaleDock.app` 为 v0.2.0 arm64，当前已退出；Spotlight 只发现这一份正式安装。

2026-08-15 SGD 的发布决定已覆盖旧的 beta-first 流程：不发 beta；Windows 真机验收不再阻断发布，改为“实验性支持（未真机验证）”；Intel 只保留 Rosetta 抽查边界；在没有 S1 冲突且 G1/成品材料闭环时，Codex 获预授权临时设置精确审批值、发布并立即删除变量。

## G1 已完成

- 三目标 runtime inventory：darwin/arm64 526 包、darwin/x64 526 包、win32/x64 525 包；共同 lock SHA-256 `7806698906c1…`。
- 跨目标 535 个去重包的包级强许可扫描未发现 GPL / AGPL / SSPL，因此没有触发 S1。
- `THIRD_PARTY_NOTICES.md`、`compliance/SOURCES.json/.md`、236 份许可材料已入库；sharp/libvips 的 36/36 份内嵌许可材料同时绑定到 inventory 与 NOTICE。
- Cairo 1.18.4 使用官方 `LGPL-2.1-only OR MPL-1.1`，并保留 sharp-libvips README 错写 `MPL-2.0` 的差异记录。
- `wasm-vips@9ff73c…` 仍明确标为时间与版本向量推断，不冒充上游 attestation；`libnsgif` 固定为 libvips 8.18.3 vendored 字节，不猜独立版本。
- `npm run compliance:verify`、当前 x64 inventory 回读与隔离未签名 x64 Electron 成品回读均通过；成品输出 `PACKAGED_COMPLIANCE_VERIFIED copies=1`。

审批门仍保持 fail-closed。仓库变量 `WHALEDOCK_BUNDLED_COMPLIANCE_APPROVAL` 平时必须不存在，只能绑定本次云端精确 tag + 产物集哈希临时设置。

## 正式 v0.2.0 发布顺序

1. 把全部候选提交推到 PR，确认 PR head 的 Ubuntu / Windows / macOS CI 全绿。
2. 用 `--match-head-commit` 合并 PR #1，不删除分支、不使用 `--admin`。
3. 等 main push CI 全绿；确认远端没有 `v0.2.0` tag / Release，审批变量为空。
4. 在 merge commit 上创建并推送注解 tag `v0.2.0`，绝不 force 或移动同名 tag。
5. 首次 Release workflow 的两个 build job 应成功，publish job 只因审批变量为空而失败；此时不得已有公开 Release。
6. 下载本次 Actions artifacts，逐项核对校验和并独立复算 `release:v0.2.0:sha256:<digest>`；必须与 workflow summary 完全相同。
7. 临时设置审批变量，只重跑失败的 publish job；确认正式 Release 与八项资产后立即删除变量，并回读确认变量不存在。
8. 验证 GitHub `releases/latest` 返回 `v0.2.0`、README 下载入口可用；安装版“检查更新 → 已是最新”单列为 GUI 回读，不用 API 结果冒充。

预期八项资产：

- `WhaleDock-0.2.0-arm64.dmg`
- `WhaleDock-0.2.0-arm64-mac.zip`
- `WhaleDock-0.2.0-x64.dmg`
- `WhaleDock-0.2.0-x64-mac.zip`
- `WhaleDock-Setup-0.2.0.exe`
- `WhaleDock-0.2.0-portable.exe`
- `SHA256SUMS-mac.txt`
- `SHA256SUMS-win.txt`

## 已完成的 macOS 证据

- [x] arm64 dmg 安装、内置 dsh rc.6 冷启动、真实 Harness、设置、快捷键、启动最小化与退出清理。
- [x] 未签名登录项被系统拒绝时如实显示 actual=false；关闭后真实移除。
- [x] x64 dmg 在 Apple Silicon + Rosetta 下完成装、跑、退；这不是 Intel 真机。
- [x] 本地假 Release/fetch 走通 macOS“稍后/跳过”；这不是线上更新证据。
- [x] 构建裸 App 归入 `.app-archives.noindex/*.app-bundle`；`staging=0 unexpected=0 visible=1`。
- [x] 最终稳定材料树重新做隔离 x64 未签名成品回读，NOTICE/SOURCES/licenses 字节全部一致。

## 发布时必须公开的边界

- macOS 包未签名、未公证；首次通常需要右键 WhaleDock → 打开。
- Windows x64 是实验性支持，**没有做 Windows 真机验证**。SmartScreen 可选择“更多信息 → 仍要运行”；问题请从设置页复制日志后提交 issue。
- Intel x64 只在 Apple Silicon + Rosetta 抽查，未做 Intel Mac 真机。
- CI / 构建成功不等于 Windows、Intel 真机通过；这些缺口不阻断本次发布，但以后也不能改写成已验证。
- Apple/Windows 签名证书与公证触发 S3，不在本次范围。

## Windows 发布后补证清单

这些项目不阻塞 v0.2.0，但任何结果都必须如实记录：Setup/SmartScreen、无 Node 的内置 dsh 首启、Ctrl+Shift+H、退出进程树、半自动更新、portable、自启路径自愈、启动最小化、升级后系统只保留一个 WhaleDock 入口。

失败时提供 `%APPDATA%\WhaleDock\logs\whaledock.log`、Windows 版本、资产名与 SHA-256、最后 50 行日志、相关父子进程/PID 和截图。不得删除或整理 `%USERPROFILE%\.dsh`，先区分 WhaleDock 兼容层、安装闭包与上游 dsh 行为。
