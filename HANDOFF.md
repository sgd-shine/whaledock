# HANDOFF.md — WhaleDock v0.2 发布后交接

更新：2026-08-15 · v0.2.0 正式 Release 闭环

## 当前结论

v0.2 工程、macOS 本地验收、G1 第三方材料与正式公开发布已经闭环。

- PR [#1](https://github.com/sgd-shine/whaledock/pull/1) 已合并。
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 当前稳定版：[`v0.2.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.2.0)；正式注解 tag 对象 `9c9022eb…` 指向 `d8a8a774…`。
- Release run [31887672606](https://github.com/sgd-shine/whaledock/actions/runs/31887672606) 成功；attempt 2 的 publish job [95020360258](https://github.com/sgd-shine/whaledock/actions/runs/31887672606/job/95020360258) 已发布八项资产。
- 本机 `/Applications/WhaleDock.app` 为 v0.2.0 arm64；Spotlight 只发现这一份正式安装。

2026-08-15 SGD 的发布决定已覆盖旧的 beta-first 流程：不发 beta；Windows 真机验收不再阻断发布，改为“实验性支持（未真机验证）”；Intel 只保留 Rosetta 抽查边界；在没有 S1 冲突且 G1/成品材料闭环时，Codex 获预授权临时设置精确审批值、发布并立即删除变量。

## G1 已完成

- 三目标 runtime inventory：darwin/arm64 526 包、darwin/x64 526 包、win32/x64 525 包；共同 lock SHA-256 `7806698906c1…`。
- 跨目标 535 个去重包的包级强许可扫描未发现 GPL / AGPL / SSPL，因此没有触发 S1。
- `THIRD_PARTY_NOTICES.md`、`compliance/SOURCES.json/.md`、236 份许可材料已入库；sharp/libvips 的 36/36 份内嵌许可材料同时绑定到 inventory 与 NOTICE。
- Cairo 1.18.4 使用官方 `LGPL-2.1-only OR MPL-1.1`，并保留 sharp-libvips README 错写 `MPL-2.0` 的差异记录。
- `wasm-vips@9ff73c…` 仍明确标为时间与版本向量推断，不冒充上游 attestation；`libnsgif` 固定为 libvips 8.18.3 vendored 字节，不猜独立版本。
- `npm run compliance:verify`、当前 x64 inventory 回读与隔离未签名 x64 Electron 成品回读均通过；成品输出 `PACKAGED_COMPLIANCE_VERIFIED copies=1`。

审批门保持 fail-closed。本次精确值 `release:v0.2.0:sha256:fb1ef01f2567b33fd1ed91aed5e50fa02c8bb4c4db06d2eb8f26acbe08551347` 仅在 attempt 2 发布时临时存在，Release 与资产回读后已立即删除；仓库变量 `WHALEDOCK_BUNDLED_COMPLIANCE_APPROVAL` 当前不存在。

## 正式 v0.2.0 发布证据

1. 初始候选 tag 指向 `f4070f5…`；Release run [31886840491](https://github.com/sgd-shine/whaledock/actions/runs/31886840491) 在 Windows 原生 inventory 门按预期失败，没有创建 Release 或设置审批变量。
2. Windows 原生取证 run [31887203247](https://github.com/sgd-shine/whaledock/actions/runs/31887203247) 证明 525/525 包、closure 和全部原生二进制一致，只有 npm 平台胶水改变完整 runtime tree；修复后原生 tree `783388d0…` 被完整纳入 inventory，没有排除 `.bin`。
3. 在无 Release、变量为空的窗口回收失败候选 tag；正式注解 tag 对象 `9c9022eb…` 重建到已通过 main CI [31887550725](https://github.com/sgd-shine/whaledock/actions/runs/31887550725) 的提交 `d8a8a774…`。旧 tag SHA 与失败 run 仍保留在开发日志中。
4. Release run 的 macOS/Windows build job 均成功；首次 publish 因审批变量为空被精确门阻止，没有提前公开 Release。
5. 六个安装资产校验通过后，精确批准值只临时用于 attempt 2；publish job `95020360258` 成功后立即删除变量并回读为空。
6. GitHub Release 为非 draft、非 prerelease；`releases/latest` 已返回 `v0.2.0`。安装版“检查更新 → 已是最新”仍单列为 GUI 人工回读，不用 API 结果冒充。

已发布八项资产：

- [x] `WhaleDock-0.2.0-arm64.dmg`（185,231,877 B）
- [x] `WhaleDock-0.2.0-arm64-mac.zip`（204,705,540 B）
- [x] `WhaleDock-0.2.0-x64.dmg`（188,139,015 B）
- [x] `WhaleDock-0.2.0-x64-mac.zip`（207,687,481 B）
- [x] `WhaleDock-Setup-0.2.0.exe`（161,411,992 B）
- [x] `WhaleDock-0.2.0-portable.exe`（161,224,150 B）
- [x] `SHA256SUMS-mac.txt`（372 B）
- [x] `SHA256SUMS-win.txt`（189 B）

## 已完成的 macOS 证据

- [x] arm64 dmg 安装、内置 dsh rc.6 冷启动、真实 Harness、设置、快捷键、启动最小化与退出清理。
- [x] 未签名登录项被系统拒绝时如实显示 actual=false；关闭后真实移除。
- [x] x64 dmg 在 Apple Silicon + Rosetta 下完成装、跑、退；这不是 Intel 真机。
- [x] 本地假 Release/fetch 走通 macOS“稍后/跳过”；这不是线上更新证据。
- [x] 构建裸 App 归入 `.app-archives.noindex/*.app-bundle`；`staging=0 unexpected=0 visible=1`。
- [x] 最终稳定材料树重新做隔离 x64 未签名成品回读，NOTICE/SOURCES/licenses 字节全部一致。

## Release 已公开的边界

- macOS 包未签名、未公证；首次通常需要右键 WhaleDock → 打开。
- Windows x64 是实验性支持，**没有做 Windows 真机验证**。SmartScreen 可选择“更多信息 → 仍要运行”；问题请从设置页复制日志后提交 issue。
- Intel x64 只在 Apple Silicon + Rosetta 抽查，未做 Intel Mac 真机。
- CI / 构建成功不等于 Windows、Intel 真机通过；这些缺口不阻断本次发布，但以后也不能改写成已验证。
- Apple/Windows 签名证书与公证触发 S3，不在本次范围。

## Windows 发布后补证清单

这些项目不阻塞 v0.2.0，但任何结果都必须如实记录：Setup/SmartScreen、无 Node 的内置 dsh 首启、Ctrl+Shift+H、退出进程树、半自动更新、portable、自启路径自愈、启动最小化、升级后系统只保留一个 WhaleDock 入口。

失败时提供 `%APPDATA%\WhaleDock\logs\whaledock.log`、Windows 版本、资产名与 SHA-256、最后 50 行日志、相关父子进程/PID 和截图。不得删除或整理 `%USERPROFILE%\.dsh`，先区分 WhaleDock 兼容层、安装闭包与上游 dsh 行为。

## 仍待人工体验

- 本机正式安装版点击“检查更新”，确认显示“已是最新”；当前只有 `releases/latest` API 回读，不能代替 GUI。
- Windows 真机按上节清单补证；Windows 仍是实验性支持，任何失败先收集日志与进程证据。
- Intel Mac 真机尚未覆盖；当前只有 Apple Silicon + Rosetta 抽查。
- macOS/Windows 签名与 Apple 公证属于 S3，留待 SGD 后续决定，不在本次执行范围。
