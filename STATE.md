# STATE.md — 鲸坞 WhaleDock 当前状态

更新：2026-08-15（v0.4.0 实现完成，待发布）

## 阶段结论

**v0.2.0 的工程/合规与 v0.3.0 的公开发布闭环保留为历史证据；v0.4.0 批次 12 的工作区管理与截图入口已完成源码实现和本地验证，当前为 implementation complete / release pending。公开稳定版仍是 v0.3.0。**

- PR [#1](https://github.com/sgd-shine/whaledock/pull/1) 已合并；正式 tag 指向 main 提交 `d8a8a774…`。
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 当前稳定版：[`v0.3.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0)；非 draft、非 prerelease，`releases/latest` 已命中 v0.3 正式版（tag `v0.3.0`）。
- 当前源码版本：`0.4.0`；尚无 v0.4 正式 tag、tag CI 或公开 Release，不得写成已发布。
- 正式注解 tag 对象 `8af8f86a527a105c9dbe5a204e75afcdd9dba409` 指向提交 `fe2d4def7bb7ef1d9339b71b1e28236fd9e1eabf`；[main CI 31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 的 Ubuntu、Windows、macOS 全绿。
- [Release run 31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 的构建与成品回读通过；attempt 2 的 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 成功发布八项资产。
- 精确批准值 `release:v0.3.0:sha256:8a7e9f14cfdaee35eb5baaa016547ec0a5d32d110876436185f186a3257407ad` 仅用于本次 publish；Release 回读后已删除，仓库变量回读不存在。
- 2026-08-15 SGD 决定：不发 beta；Windows 以“实验性支持（未真机验证）”发布；Intel 仅保留 Rosetta 抽查边界；无 S1 且 G1/成品材料闭环后，由 Codex 执行正式发布并临时设置、随即清除精确审批变量。

Windows/Intel 真机、签名与线上更新仍是独立证据边界。它们不阻断本次发布，但不得改写为已经通过。

## v0.4 批次 12 已实现，待发布

### 工作区启动与切换

- 只有 `config.json` 确实缺失的新用户才创建 `~/Documents/鲸坞工作台/默认工作区`；POSIX 尽量以 `0700` 创建。既有配置即使 `workdir:null` 也不迁移；默认目录创建失败时要求选目录或退出，不回落主目录启动。
- 应用菜单和托盘都有“工作区”子菜单，显示当前/最近工作区与“打开新文件夹…”；主窗口标题从已提交快照显示工作区名。设置页中 workdir 改为只读状态+事务切换入口。
- 所有切换共用一条串行队列和严格 journal：排空事件并停止归属可证的旧后端、持久 config、启动目标后端，以同一 child/generation 归属和 adapter 归一化的实际 cwd 证明后才 commit。外部 attach、预算 latch、归属/cwd 不明或回滚失败都 fail-closed，不停外部进程、不伪报切换。
- 工作区是 dsh 默认 cwd，**不是文件读取沙箱**。并行多开（独立端口/多 backend/多主窗口）保留为 P2，本版未实现。

### 截图、OCR 与会话交付

- 三个入口进入同一个鲸坞自有图片窗口：macOS `screencapture -i` 系统框选，拖入/粘贴单图，以及显式读取剪贴板。Windows 快捷键只提示 `Win+Shift+S`，不持续监听或伪造跨平台框选。
- 自有图片窗口使用 context isolation/sandbox 和最小 IPC，要求两次确认。第一次才以随机不覆盖文件名写入当前工作区 `鲸坞截图/`，并对 symlink/junction、越界与 workspace generation 变化 fail-closed；第二次才提交或复制完整 payload。
- 理解路由固定为官方视觉槽位 → vision 插件槽位 → macOS Vision/JXA 或 Windows.Media.Ocr/PowerShell 本地 OCR → path-only。前两个槽位当前未发现可用合约，跳过不是故障；OCR 不可用也不阻断用户确认后保存图片。
- `lib/backend.js` 中的 rc.6 prompt adapter 只在 loopback、根包版本证明、feature/contract 和普通会话目标都通过时，以固定 `queue`+单文本提交用户已检查的 OCR+路径。任一不满足就复制降级；超时/断线的不确定结果不自动重试。
- 主 Harness BrowserWindow 继续无 preload、无 Node、无 DOM/脚本注入；不扫描、写入、迁移或清理 `~/.dsh`。

### 批次 12 当前实证

- 当前源码版本 `0.4.0`；本地 `npm run smoke` 实际为 **199 PASS / ALL PASS**。新增回归证明工作区 canonicalize 与图片保存都会拒绝 `~/.dsh` 本身、后代及 realpath/link 入口。`npm run compliance:verify` 通过；darwin/x64 inventory 仍是 526 包，closure `928f3fd6cf6a876eeeff8fedb0df8d2864265279da7e7cf6636c2a03d87afdde`。根 `dependencies` 仍为空，devDependencies 仍只有 electron/electron-builder，没有新许可闭包。
- 隔离 userData `/private/tmp/whaledock-v04-gui` 中的 macOS arm64 源码态 GUI 已真实拉起 managed dsh。标题回读“默认工作区”；设置只读工作区/截图快捷键、应用菜单、自有 capture 窗口标签和取消都实际回读。退出后 dsh 与 3080 端口清零。
- 首轮 GUI 发现 dropzone 事件漏接，导致 `captureId:null`；补入“dropzone 拖放”薄层静态/TDD 回归后，重验已在显示真实工作区标签的图片窗口中成功取消。该回读没有加载真实图片，不写成图片预览已通过。
- macOS Vision/JXA 脚本已在 synthetic 图片上回读 OCR 成功；这是真实本地 OCR 脚本证据，不等于完整图片保存/交付 GUI 已走完。
- 未向真实用户会话提交 prompt，未走完全量图片保存→OCR→复制/提交流。Windows、Intel Mac、系统权限和安装包 GUI 均未真机；macOS 仍未签名/公证。未签名 x64 成品回读不是 Intel 真机证据。

## v0.3 批次 11 已实现并发布

### 事件、连续性与持久化

- 事件层继续锁定 dsh `0.1.0-rc.6`；协议路径、host/list/history/WS 原始帧与超时/字节假设仍只在 backend/config 边界，中性 reducer 不 require Electron。
- 主进程使用 WhaleDock `userData/events-state.json`，按 schema 1、0600、临时文件+原子 rename 落盘；会话/任务/请求引用只以本地 salt HMAC 形式保留，不保存正文、cwd、工具数据或原始 frame。
- 每个 backend 连接代先订阅 WS，再 list/history 补洞；backfill 期间 live 事件在 10,000 条/4 MiB 双上限内缓冲，普通 live 事件 200ms 串行批写，断线按 generation 落盘并指数退避重连。
- 首次超长 history 可从已取证的 50,000 条尾部建基线并继续 live，但仍诚实标记 `history-gap`；不会把 rc.6 历史保留限制写成完整覆盖。
- live terminal 顺序为“排空前序批次 → 等约 350ms → history 以 `sessionRef+seq` 精确确认 → ledger 持久 → effect”；未确认终态只静默记录。换代/退出后旧 effect 在每个 await 边界都会失效。

### 看板、通知、预算与战报

- 任务看板只接收主进程 sanitize 后的可用性/覆盖、日周聚合、匿名任务、预算与价格快照，固定显示“dsh 已观测用量，非账单”。主 Harness 窗口仍无 preload、无 Node、无 DOM 注入。
- 新增看板/banner/战报均是本地自有窗口，IPC 同时校验精确 BrowserWindow sender、mainFrame 和 file URL，并拒绝导航/新窗口；preload 只暴露固定通道。
- 通知只在本地持久成功后执行，路径为 Electron Notification → Dock/托盘 → 自有 banner；通知文案不带会话 ID 或问题正文。
- 每日软预算先持久 `pausedDate`，仅可停止同 generation、`spawnedByUs=true`、进程对象仍相同的 managed backend。外部 attach 只告警“服务仍在运行”，绝不 stop；当日 latch 会阻止 managed 自动启动/恢复，只在“今日继续”持久后显式放行。
- 战报请求只接受 `taskKey`、`dark|light`、`copy|save`；主进程重读规范快照，在隐藏窗口渲染 1080×1440，capture/剪贴板/保存后无论成败都销毁窗口。
- 设置运行时修改任务通知、预算、token 上限和三类单价时，config 与 event service 持久串行对账；任一失败会回滚/明确报错，不会伪称立即生效。

### 批次 11 当前实证

- 当前源码版本为 `0.3.0`；本地 `npm run smoke` 实际为 **119 PASS / ALL PASS**，分解为基础 34 + config 13 + events 24 + backend adapter 20 + main 24 + 4 项 wrapper。这是本地纯 Node 证据，与正式 tag 提交的三平台 CI/Release 证据分开记录。
- macOS arm64 源码态已真实 attach 当前 dsh，探测 13 个会话并进入 live；只证明 rc.6 host/list/history/WS 合约形状，外部服务的 npm 根包版本未证明。
- 匿名看板已在真实 GUI 显示。对比度修复前的深/浅流程样张已经 GUI 保存，尺寸均为 1080×1440：深色 357,713 B / `163732dc25f4f5eea8b4acc650a3281e643b95c6d9ba9abb9af01e2fb6055600`，浅色 336,785 B / `dac1ebce2fef2572a5bb23211109c99c3287ec81615ee6e1785472986e9f9f40`。它们只证明保存流程/像素尺寸，不代表修复后最终色彩。
- 系统通知、真实 managed 预算 stop/resume、Windows 与 Intel 真机均未验证。约 200–400ms hard-crash 窗口仍是明确产品边界，不宣称 exactly-once。

## v0.2 已实现

### Windows 与后端生命周期

- Windows PATH/PATHEXT、`.cmd/.bat` shell、`windowsHide`、`taskkill /T` 进程树清理与 portable 路径自愈已实现。
- `executeKillPlan` 的 4 秒宽限等待可被子进程退出打断，速退后跳过强杀；mismatch 决策页有就地显式 splash 保障。
- smoke 保留两平台 killPlan 形状，并覆盖子进程速退、Windows shim 与真实假后端生命周期。

### 免装 Node 内置引擎

- dsh 唯一版本源仍是 `lib/config.js` 的 `0.1.0-rc.6`；没有升级版本锁。
- `scripts/bundle-dsh.js` 使用审计 lock + `npm ci --ignore-scripts`，按目标 runner 原生生成 runtime，并 fail-closed 检查安装脚本闭包与原生资产。
- 默认仍优先用户自定义/系统 dsh/系统 npx；内置引擎按 `preferBundled` 策略兜底。

### 设置、更新与打包

- 中文设置窗、自启/启动最小化、快捷键、工作目录、内置引擎偏好、更新开关均已接线。
- 更新器为纯 Node、零新运行时依赖；固定 GitHub `releases/latest` 请求不带用户标识，所有触发都受 `checkUpdates` 控制。
- macOS arm64/x64 分包，Windows x64 提供 per-user NSIS Setup + portable；校验和与更新资产名精确耦合。
- macOS 构建前写 no-index 标记，完成后把裸 `WhaleDock.app` 注销并归入 `.app-archives.noindex/*.app-bundle`；历史版本由 dmg/zip/校验和保存。

### 批次 9 G1 合规材料

- 审计 lock SHA-256：`7806698906c19ac7260958a398e96606c3d7f53a3c7151ccbbef5da36a2d0c75`。
- inventory：darwin/arm64 526 包、darwin/x64 526 包、win32/x64 525 包；跨目标去重 535 包。
- 包级许可证分布：MIT 439、Apache-2.0 62、BSD-3-Clause 15、ISC 11、BSD-2-Clause 2、LGPL-3.0-or-later 2、0BSD 1、Apache+LGPL 1、Apache+LGPL+MIT 1、Python-2.0 1。
- 对运行时文本开头的 GPL/AGPL/SSPL 标题与 SPDX 指纹扫描为 0 命中；没有 S1 冲突。
- `THIRD_PARTY_NOTICES.md`、`compliance/SOURCES.json/.md`、三平台 inventory 与 236 份许可材料已入库；36/36 份 sharp/libvips 内嵌材料绑定到 inventory 与 NOTICE。
- Cairo 1.18.4 使用官方 `LGPL-2.1-only OR MPL-1.1`；sharp-libvips README 的 `MPL-2.0` 错标被保留为差异证据。
- wasm-vips commit 仍如实标为时间+版本向量推断；libnsgif 固定为 libvips 8.18.3 vendored 字节，均未夸大来源证明。

## 自动与成品验证

- v0.2.0 正式 tag 当时的 `npm run smoke`：34/34，`ALL PASS`。
- v0.3.0 正式发布时的 `npm run smoke`：**119 PASS / ALL PASS**（基础 34 + config 13 + events 24 + backend adapter 20 + main 24 + wrapper 4）。
- 当前 v0.4.0 源码态 `npm run smoke`：**199 PASS / ALL PASS**；新增工作区事务/journal、受保护目录拒绝、图片状态/受控文件、dsh prompt fail-closed 适配与 Electron 工作区/图片薄层，四个子套件全部纳入统一 smoke。
- 首次 v0.3 main CI [31893823255](https://github.com/sgd-shine/whaledock/actions/runs/31893823255) 仅 Windows 因静态测试写死 LF、不兼容 CRLF 失败，功能套件已通过；第一轮修复后 [31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 三平台全绿。
- 正式 Release run [31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 与 attempt 2 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 成功；公开 Release 的八项资产为 `SHA256SUMS-mac.txt` 372 B、`SHA256SUMS-win.txt` 189 B、arm64 zip 204,753,794 B、arm64 dmg 185,260,077 B、portable 161,260,244 B、x64 zip 207,735,735 B、x64 dmg 188,143,119 B、Setup 161,448,096 B。
- `npm run compliance:verify`：SOURCES 与 THIRD_PARTY_NOTICES 确定性检查通过。
- 当前 darwin/x64 runtime inventory 回读：526 包，closure `928f3fd6cf6a876eeeff8fedb0df8d2864265279da7e7cf6636c2a03d87afdde`。
- 三目标 closure：arm64 `9f5613cb…`、x64 `928f3fd6…`、Windows `47ad1d95…`；runtime tree 分别 `4faee9c6…`、`6900f36a…`、`783388d0…`。Windows 值来自原生 Windows runner；它与 macOS 交叉安装的差异仅限 npm 根层平台胶水，525/525 包及全部原生二进制哈希一致。
- 隔离未签名 x64 `electron-builder --mac dir` 实构建成功；成品回读 `PACKAGED_COMPLIANCE_VERIFIED copies=1`，NOTICE SHA-256 `3126a904…`；App 可见性 `staging=0 unexpected=0 visible=1`。临时构建已删除。
- `node --check`、Release/CI YAML 解析与 `git diff --check` 通过；根 `dependencies` 为空，devDependencies 仍只有 electron 与 electron-builder；`lib/` 无 Electron require。
- 正式 tag 提交的 main CI [31887550725](https://github.com/sgd-shine/whaledock/actions/runs/31887550725) 三平台全绿；Release 两个构建 job 均为 success，Windows 使用原生完整 runtime tree `783388d0…` 精确过门。
- 首次失败候选的 Release run [31886840491](https://github.com/sgd-shine/whaledock/actions/runs/31886840491) 与 Windows 原生取证 run [31887203247](https://github.com/sgd-shine/whaledock/actions/runs/31887203247) 保留为审计链：前者没有创建 Release，后者证明差异仅来自 npm 平台胶水；没有删改或冒充首次成功。

## macOS 真机证据

环境：Apple Silicon arm64，macOS 26.5，Node v22.22.2，npm 10.9.7。

- arm64 dmg 已安装到 `/Applications/WhaleDock.app`，版本 0.2.0、Mach-O arm64、未签名；隔离 DSH_HOME + 空 PATH 下由包内 dsh 冷启动到真实 Harness，退出后进程与端口清零。
- 设置/快捷键/启动最小化已真机走查；未签名登录项被系统拒绝时如实回报，关闭后真实移除。
- x64 dmg 在 Apple Silicon + Rosetta 下完成安装、冷启动、`SMOKE_OK` 与退出清理；**未做 Intel 真机**。
- 本地假 Release/fetch 走通 macOS“稍后/跳过”；这不是线上 Release 证据。
- 正式 v0.2.0 发布后，本机安装版已真实点击“立即检查”，并回读“当前已是最新版本（0.2.0）”。
- Spotlight bundle-id 当前只返回 `/Applications/WhaleDock.app`；构建归档不是安装项。
- v0.3 macOS arm64 源码态已 attach 当前外部 dsh；13 个会话进入 live，但因 rc.6 history 兼容/50,000 条尾部基线仍标记 `history-gap`，且外部 npm 根包版本未证明。
- v0.3 匿名看板已真实显示；深/浅战报已通过 GUI 保存且尺寸回读为 1080×1440。两张现有文件是对比度修复前样张，只证明流程/尺寸，不代表最终色彩验收。

## 本地 v0.2 产物（历史候选证据）

| 产物 | 字节 | 约 MiB | SHA-256 |
| --- | ---: | ---: | --- |
| `WhaleDock-0.2.0-arm64.dmg` | 185,175,516 | 176.6 | `ecee60a0f162c6d6d3f257136f949db630b4fb2e3d3163c06492d18919772e6b` |
| `WhaleDock-0.2.0-arm64-mac.zip` | 204,186,442 | 194.7 | `c9413346e9014399fb1d5544e49189654625ac16f62e5f9d1ed5b14b112d66f1` |
| `WhaleDock-0.2.0-x64.dmg` | 188,031,380 | 179.3 | `49ec1e8f86a6561828318222cf67fd0ec6e0223253b933bb2666bd31524cc420` |
| `WhaleDock-0.2.0-x64-mac.zip` | 207,168,381 | 197.6 | `d21fccd7e624b8c05b506c42b6f90fe6765137bbd64c82143ff0689c0243abf8` |

这些本地候选哈希不替代 GitHub Release 的正式云端资产。正式 Release 已提供 arm64/x64 的 dmg+zip、Windows Setup+portable 及两份校验和，共八项；最终 build-time darwin/x64 runtime 约 347.2 MiB，单个正式安装资产均低于 500 MB。

## 尚未完成

1. v0.4 尚未走三平台 tag CI、正式 tag、Release 成品回读和公开发布；当前稳定版仍是 v0.3.0。
2. v0.4 未对真实会话提交 prompt，未走完图片保存→OCR→复制/提交的全量 GUI 链；Windows.Media.Ocr、Windows `Win+Shift+S`/剪贴板、macOS 屏幕录制权限和安装包 GUI 仍待真机。
3. v0.4 并行多开保留为 P2；官方视觉 API 与 vision 插件只保留可探测槽位。
4. v0.3 Electron 系统通知权限及 Notification→Dock/托盘/banner 可见降级链尚未真机；真实 managed backend 跨预算线后的进程树停止、App 重启 latch 和“今日继续”恢复也未做 GUI+真进程闭环。
5. 现有深/浅战报为对比度修复前样张；修复后色彩、对比度、中文排版与剪贴板真实读回仍需最终人工验收。
6. Windows 全线真机与 Intel 真机均未做；Intel 仍只有 Apple Silicon + Rosetta，未签名 x64 成品回读也不是 Intel 真机；Windows 仍是未签名、未真机的实验性支持。
7. macOS/Windows 签名与 Apple 公证未做，属于 S3，本次明确不执行。

详细发布证据与人工体验边界见 `HANDOFF.md`。
