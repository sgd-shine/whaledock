# HANDOFF.md — WhaleDock v0.4.0 已发布交接

更新：2026-08-16 · v0.4.0 已正式公开发布；v0.5 批次 13 开发中

## 当前结论

v0.2 工程/macOS 验收/G1 与 v0.3.0 公开发布保留为历史证据。v0.4 的单工作区管理、安全截图/图片入口、本地 OCR 与 rc.6 prompt/复制降级已实现并**正式发布**，当前公开稳定版是 v0.4.0。

- PR [#1](https://github.com/sgd-shine/whaledock/pull/1) 已合并。
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 当前稳定版：[`v0.4.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.4.0)。[`v0.3.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0) 的 tag 对象 `8af8f86a527a105c9dbe5a204e75afcdd9dba409` → `fe2d4def7bb7ef1d9339b71b1e28236fd9e1eabf` 保留为历史证据。
- v0.4.0 已正式公开发布：[Release v0.4.0](https://github.com/sgd-shine/whaledock/releases/tag/v0.4.0)，非 draft、非 prerelease，`releases/latest` 回读为 `v0.4.0`。正式注解 tag 对象 `4cd0a1f0e33201ba8b478a9869730a6177bbbcdd` 指向提交 `3a8913be6900dc8a1b64ee0a61bc03c8ba256443`。
- 该提交的 main CI [31930571815](https://github.com/sgd-shine/whaledock/actions/runs/31930571815) 三平台全绿；[Release run 31930662943](https://github.com/sgd-shine/whaledock/actions/runs/31930662943) 的 build-mac / build-windows 一次通过，publish job 首次按预期被审批门 fail-closed 阻止，设置精确批准值后重跑成功。
- 八项资产与精确字节数：`SHA256SUMS-mac.txt` 372 B、`SHA256SUMS-win.txt` 189 B、`WhaleDock-0.4.0-arm64-mac.zip` 204,794,555 B、`WhaleDock-0.4.0-arm64.dmg` 185,282,665 B、`WhaleDock-0.4.0-x64-mac.zip` 207,776,496 B、`WhaleDock-0.4.0-x64.dmg` 188,209,037 B、`WhaleDock-Setup-0.4.0.exe` 161,480,303 B、`WhaleDock-0.4.0-portable.exe` 161,292,453 B。发布前已把两个 Actions artifact 下载到本地，`shasum -a 256 -c` 六项产物全部 OK，这是独立于 CI 的成品回读。
- 三平台 vendor 闭包与包数同 v0.3 完全一致（arm64 `9f5613cb…` 526 包、x64 `928f3fd6…` 526 包、win32/x64 `47ad1d95…` 525 包），没有新增包，因此按预授权直接发布，没有触发 S1。
- 精确批准值 `release:v0.4.0:sha256:d9ed43878b3bb8c3aa4167c3c176d26c18d13dffa21b1bb9bdd3a549bd00a301` 只在本次 publish 期间存在；Release 与八项资产回读后立即删除，仓库变量回读 `total_count=0`。
- v0.3 main CI [31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 三平台全绿；v0.3 Release run [31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 成功，attempt 2 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 已发布八项资产。
- 本机 `/Applications/WhaleDock.app` 为 v0.2.0 arm64；Spotlight 只发现这一份正式安装。

2026-08-15 SGD 的发布决定已覆盖旧的 beta-first 流程：不发 beta；Windows 真机验收不再阻断发布，改为“实验性支持（未真机验证）”；Intel 只保留 Rosetta 抽查边界；在没有 S1 冲突且 G1/成品材料闭环时，Codex 获预授权临时设置精确审批值、发布并立即删除变量。

## v0.4 批次 12 交接

### 已实现

- 新用户初始化严格以“`config.json` 实际不存在”为条件，只在这种情况创建 `~/Documents/鲸坞工作台/默认工作区`（POSIX 尽量 `0700`）。既有配置含 `workdir:null` 也不迁移；默认目录创建失败时让用户选目录或退出，不回落整个主目录。
- 菜单和托盘都有“工作区”子菜单，含当前项、最近目录和“打开新文件夹…”；标题始终从 committed workspace 快照显示。设置页不再通用直写 workdir，而是只读显示+完整切换入口。
- 工作区切换通过纯 Node 协调器串行化，以 0600 原子 journal 记录 `prepared/config-applied`。事务严格排空当前事件、停止可证归属的旧 backend、持久 config、启动目标 backend，并在同一 child/generation 归属和 adapter 归一化的有效 cwd 回读匹配后才 finalize。外部 attach、预算 latch、归属/cwd 不明、回滚不完整均 fail-closed。
- 并行多开明确保留为 P2；本版仍是单实例/单端口/单 backend/单主窗口。工作区是 dsh 默认 cwd，**不是文件读取沙箱**。
- 新增鲸坞自有“截图与图片”窗口，三入口为 macOS `screencapture -i` 框选、拖入/粘贴单图、显式读取剪贴板。Windows 快捷键只给 `Win+Shift+S` 引导，不持续监听剪贴板。截图快捷键默认 `CommandOrControl+Shift+S`，可改可关，与主快捷键冲突/注册失败时配置和注册一起回滚。
- 图片流程有两次明确确认：预览后第一次才以随机不覆盖名写入 `<current-workspace>/鲸坞截图/`，目标目录 symlink/junction、越界和 workspace generation 漂移都拒绝；展示实际路径/路由/OCR/目标后，第二次才提交或复制。取消/切工作区/退出清理鲸坞 staging，不删用户已确认保存的图片。
- 理解路由为官方视觉槽位 → vision 插件槽位 → macOS Vision/JXA 或 Windows.Media.Ocr/PowerShell 本地 OCR → path-only。前两项当前无稳定探测合约，正常跳过；OCR 失败不阻断图片保存。
- `lib/backend.js` 内的写适配器只接受临时 target token，仅 loopback + rc.6 根包证明 + feature/contract + 普通会话全通过时以固定 `queue`+单文本调用 prompt。任一不满足就复制同一份已确认 OCR+路径并提示手动粘贴；超时/断线的 unknown 不自动重试。
- 主 Harness BrowserWindow 仍无 preload、无 Node、无 DOM/脚本注入。新代码不扫描、写入、迁移或清理 `~/.dsh`。

### 当前自动、GUI 与合规证据

- 本地 `npm run smoke` 已实际回读 **201 PASS / ALL PASS**；四个 v0.4 子套件（workspace、image-input、backend-prompt、main-v04）已由统一 smoke 真实执行，且覆盖 Windows 长路径/8.3 路径身份、`~/.dsh` 本身、后代、链接入口及真实目标的工作区/保存拒绝。同一提交的 [main CI 31930427567](https://github.com/sgd-shine/whaledock/actions/runs/31930427567) 三平台全绿，Windows runner 侧同样回读 201 PASS / ALL PASS。
- `npm run compliance:verify` 通过；darwin/x64 inventory 仍为 526 包，closure `928f3fd6cf6a876eeeff8fedb0df8d2864265279da7e7cf6636c2a03d87afdde`。根 `dependencies` 仍为空，devDependencies 只有 electron/electron-builder，本版没有新增运行时依赖或许可闭包。
- macOS arm64 源码态在隔离 userData `/private/tmp/whaledock-v04-gui` 中真实启动 managed dsh。标题回读“默认工作区”；设置只读工作区/截图快捷键、应用菜单、capture 自有窗口真实标签和取消均已走查；退出后 dsh 和 3080 端口清零。
- 首轮 GUI 发现 dropzone 事件漏接使 `captureId:null`；新增静态/TDD 回归后重验，已在显示真实工作区标签的图片窗口中成功取消。未加载真实图片，因此不把它写成预览链已通过。
- macOS Vision/JXA 脚本已在 synthetic 图片上完成真实本地 OCR 回读。该证据不等于完整图片保存/交付 GUI 链已走完。

### 发布前与发布后待补证

- v0.4 的提交/推送、三平台 main CI、正式 tag、Release 双平台构建、成品回读、精确审批门与公开 Release 回读均已完成。本机安装版仍是 v0.2.0，v0.4 的线上「检查更新」提醒未真机验证。
- 未对真实用户会话提交 prompt，也未走完图片保存→OCR→复制/提交全量 GUI 流程。
- Windows 工作区、`Win+Shift+S`/剪贴板、Windows.Media.Ocr、Setup/portable GUI 未真机；Windows 继续是未签名、未真机的实验性支持。
- Intel Mac 未真机；未签名 x64 成品回读和 Apple Silicon + Rosetta 抽查都不是 Intel 真机。macOS 屏幕录制/剪贴板权限与安装包 GUI 也未做 v0.4 全量人工验收；签名/公证仍属 S3。

## v0.3 批次 11 交接

### 已实现

- `lib/backend.js` 的 rc.6 只读 adapter 只访问 loopback host.describe/session.list/session.history 与 events.mux，HTTP/WS 帧、数组、字符串、字节、超时与积压都有上限；WS 只 downlink，不 send。
- `lib/events.js` 为纯 Node 中性状态机；使用 HMAC 匿名任务/会话/请求键，按 seq/generation 去重、补洞、持久 notification ledger、统计 token/估算费用并管理当日预算 latch。
- 主进程按“先 WS 订阅、后 history 补洞”工作；backfill live buffer 为 10,000 条/4 MiB，普通 live 事件 200ms 串行批写，断线按 generation 重连。正常退出会 flush 最后批次及关闭 adapter/service，但抑制退出途中的通知/停机副作用。
- live terminal 先 flush 前序事件，等约 350ms 并以 `sessionRef+seq` 回读 history 确认，然后才持久 ledger 并执行 effect。未确认只静默记录；每个 await/effect 迭代重检当前代，旧代不得通知或停 backend。
- Electron Notification 可降级到 Dock badge/bounce、托盘待办和自有 banner。通知内容只有匿名状态；不向 Harness DOM 注入会话跳转。
- 预算 crossing 的 `pausedDate` 先原子持久，再只停止同 generation、`spawnedByUs=true`、进程对象仍匹配的 managed backend。所有 managed 自动启动/恢复/重启入口都受 latch 阻断；外部 attach 只告警、继续监控，绝不 stop。
- 看板、banner、战报是独立本地自有窗口，开启 context isolation/sandbox，精确校验 BrowserWindow sender + mainFrame + file URL，拒绝导航/window-open。主 Harness 窗口保持无 preload、无 Node、无 DOM 注入。
- 战报只接受 taskKey/白名单主题/复制或保存动作；主进程从规范快照重读匿名数据，离屏渲染 1080×1440，capture/save/copy 后 `finally destroy`。

### 当前自动与 GUI 证据

- 当前源码版本 `0.3.0`；`npm run smoke` 已实际回读 **119 PASS / ALL PASS**：基础 34、config 13、events 24、backend adapter 20、main 24，加 4 项 wrapper 纳入检查。这是本地纯 Node 证据，与远程 CI、打包与 Release 证据分开记录。
- macOS arm64 源码态已真实 attach 当前 dsh，看到 13 个会话并进入 live。因为是外部服务，只能证明 rc.6 host/list/history/WS 形状符合，**不能证明对方 npm 根包就是 `0.1.0-rc.6`**。
- rc.6 历史兼容与单会话 50,000 条尾部基线仍会标记 `history-gap`；当前看板对此如实显示，不用局部数据伪造完整账单。
- 匿名看板已真实显示。深色战报 `/Users/shine/Downloads/WhaleDock-v03-dark-test.png`：357,713 B，SHA-256 `163732dc25f4f5eea8b4acc650a3281e643b95c6d9ba9abb9af01e2fb6055600`；浅色战报 `/Users/shine/Downloads/WhaleDock-v03-light-test.png`：336,785 B，SHA-256 `dac1ebce2fef2572a5bb23211109c99c3287ec81615ee6e1785472986e9f9f40`。两张都由 GUI 保存并回读为 1080×1440。
- 上述战报是**对比度修复前样张**；它们只证明 GUI 保存流程、PNG 字节与像素尺寸，不代表修复后最终色彩/对比度验收。

### 必须保留的 v0.3 边界

- 通知只能做尽力去重；当 dsh 尚未落盘、WhaleDock 强杀或系统断电时，仍有约 200–400ms hard-crash 窗口，不宣称 exactly-once。
- 用量/费用固定是“dsh 已观测用量，非账单”；history gap 后费用 fail-closed，不显示伪精确总额。
- 系统通知权限及 Notification→Dock/托盘/banner 可见降级、真实 managed backend 预算 stop/resume 仍未真机闭环。
- Windows 仍是未签名、未真机的实验性支持；Intel x64 仍只有 Apple Silicon + Rosetta 抽查，不是 Intel 真机；macOS 仍未签名/公证。

## 正式 v0.3.0 发布证据

1. 首次 main CI [31893823255](https://github.com/sgd-shine/whaledock/actions/runs/31893823255) 的 macOS/Ubuntu 通过，Windows 唯一失败是静态测试写死 LF、无法匹配 CRLF；第一轮修复后 [31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 三平台全绿。
2. 正式注解 tag 对象 `8af8f86a527a105c9dbe5a204e75afcdd9dba409` 指向已通过 main CI 的提交 `fe2d4def7bb7ef1d9339b71b1e28236fd9e1eabf`。
3. Release run [31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 的构建与成品回读通过；attempt 2 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 成功。
4. 精确批准值 `release:v0.3.0:sha256:8a7e9f14cfdaee35eb5baaa016547ec0a5d32d110876436185f186a3257407ad` 只在本次 publish 中临时存在；Release 与资产回读后已删除，仓库变量回读不存在。
5. [`v0.3.0` Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0) 已公开，为非 draft、非 prerelease；`releases/latest` 已命中 v0.3 正式版（tag `v0.3.0`）。

已发布八项资产：

- [x] `WhaleDock-0.3.0-arm64-mac.zip`（204,753,794 B）
- [x] `WhaleDock-0.3.0-arm64.dmg`（185,260,077 B）
- [x] `WhaleDock-0.3.0-x64-mac.zip`（207,735,735 B）
- [x] `WhaleDock-0.3.0-x64.dmg`（188,143,119 B）
- [x] `WhaleDock-Setup-0.3.0.exe`（161,448,096 B）
- [x] `WhaleDock-0.3.0-portable.exe`（161,260,244 B）
- [x] `SHA256SUMS-mac.txt`（372 B）
- [x] `SHA256SUMS-win.txt`（189 B）

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
6. GitHub Release 为非 draft、非 prerelease；`releases/latest` 已返回 `v0.2.0`。本机 v0.2.0 安装版设置窗已实际点击“立即检查”，并回读弹窗“当前已是最新版本（0.2.0）”；这项 GUI 证据与 API 回读分开记录。

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
- [x] 正式 v0.2.0 发布后，本机安装版已点击“立即检查”并回读“当前已是最新版本（0.2.0）”。
- [x] 构建裸 App 归入 `.app-archives.noindex/*.app-bundle`；`staging=0 unexpected=0 visible=1`。
- [x] 最终稳定材料树重新做隔离 x64 未签名成品回读，NOTICE/SOURCES/licenses 字节全部一致。

## Release 已公开的边界

- macOS 包未签名、未公证；首次通常需要右键 WhaleDock → 打开。
- Windows x64 是实验性支持，**没有做 Windows 真机验证**。SmartScreen 可选择“更多信息 → 仍要运行”；问题请从设置页复制日志后提交 issue。
- Intel x64 只在 Apple Silicon + Rosetta 抽查，未做 Intel Mac 真机。
- CI / 构建成功不等于 Windows、Intel 真机通过；这些缺口不阻断本次发布，但以后也不能改写成已验证。
- Apple/Windows 签名证书与公证触发 S3，不在本次范围。

## Windows 发布后补证清单

这些项目不阻塞 v0.3.0 的已完成发布，但任何结果都必须如实记录：Setup/SmartScreen、无 Node 的内置 dsh 首启、Ctrl+Shift+H、退出进程树、半自动更新、portable、自启路径自愈、启动最小化、升级后系统只保留一个 WhaleDock 入口。

失败时提供 `%APPDATA%\WhaleDock\logs\whaledock.log`、Windows 版本、资产名与 SHA-256、最后 50 行日志、相关父子进程/PID 和截图。不得删除或整理 `%USERPROFILE%\.dsh`，先区分 WhaleDock 兼容层、安装闭包与上游 dsh 行为。

## 仍待发布与人工体验

- v0.4 按上文步骤完成提交/推送、三平台 CI、tag/Release 和公开资产回读；稳定版在此之前仍是 v0.3.0。
- v0.4 在不触碰真实用户会话数据的前提下补完安装版图片保存/OCR/复制降级体验；真实 prompt 提交本轮未做，不得写成已验证。
- Windows 真机按上节清单补证；Windows 仍是实验性支持，任何失败先收集日志与进程证据。
- Intel Mac 真机尚未覆盖；当前只有 Apple Silicon + Rosetta 抽查与未签名 x64 成品回读，两者均不是 Intel 真机。
- macOS/Windows 签名与 Apple 公证属于 S3，留待 SGD 后续决定，不在本次执行范围。
