# STATE.md — 鲸坞 WhaleDock 当前状态

更新：2026-08-22（v0.7.0 发版候选已完成三处体验小修与版本/Release 材料准备；公开稳定版仍为 v0.6.0）

## 阶段结论

**v0.7.0 发版候选已在独立发布分支完成；在 SGD 5 分钟人工卡回“过”、合入 main 且三平台 CI 全绿以前，不创建 tag。**

- `package.json` 已升至 `0.7.0`；`package-lock.json`、`compliance/`、`vendor/`、`licenses/` 与 `THIRD_PARTY_NOTICES.md` 未改，本轮不升级 Electron/dsh，也没有新增运行时依赖或再分发闭包。
- 三处小修已完成：灵感成功存入后立即清空输入框且失败保留草稿；建议对照卡黄牌 kicker 与标题分行；页面级 `⌘K` / `Ctrl+K` 明确排除 Shift 组合键，菜单加速器保持不变。
- 新增最小回归后，本地统一 `npm run smoke` 为 **452 PASS / ALL PASS**；`npm run compliance:verify`、`git diff --check`、runtime dependencies=0 与 `lib/` Electron require=0 均通过。
- 两条发布路径（Release 与 Resume Notarization）已同步 v0.7.0 用户说明。当前 `v0.7.0` tag/Release 不存在，审批变量为空，v0.7.0 安装包、签名、公证、资产体积与本机安装验收仍为 `N/A`。

**v0.6.0 工作台包已实现、通过三平台 CI，macOS arm64/x64 成品已用 Developer ID Application 正式签名、开启 Hardened Runtime 并获 Apple 公证；公开稳定版已是 v0.6.0。**

- 当前稳定版：[`v0.6.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.6.0)；非 draft、非 prerelease，`releases/latest` 已命中 v0.6.0，正式 tag 指向 `7ae619d8b7cbad81412e098706737d7e1490b9e8`。
- 正式 tag 的 [main CI 32413185966](https://github.com/sgd-shine/whaledock/actions/runs/32413185966) 三平台全绿。源 [Release run 32413319416](https://github.com/sgd-shine/whaledock/actions/runs/32413319416) 构建并保存已签名成品；[Resume run 32440079107](https://github.com/sgd-shine/whaledock/actions/runs/32440079107) 续用同一批成品和 Apple submission id 完成 staple、Gatekeeper 与公开发布，没有重新构建或重复提交。
- 4 份 macOS 成品均回读 Apple `Accepted`。公开 Release 有 8 项资产：`SHA256SUMS-mac.txt` 372 B、`SHA256SUMS-win.txt` 189 B、arm64 ZIP/DMG 207,138,248 / 187,568,944 B、x64 ZIP/DMG 212,053,773 / 192,382,327 B、Windows Setup/portable 161,526,040 / 161,338,194 B。两份 Actions artifact 已独立下载并通过 6 份成品校验和。
- v0.6.0 与 v0.5.1 比较没有 `package-lock.json` 或 `compliance/` 变化；源 run 的三平台 inventory、已提交与包内合规材料均成功，没有新增再分发闭包，未触发 S1。
- 精确批准值 `release:v0.6.0:sha256:1d72764798f78f070a12277f822e04ae5bc103d381cea8bed08ec883e3091832` 只在 publish attempt 2 期间存在；Release 和 8 项资产回读成功后立即删除，仓库变量当前不存在。
- 官方 arm64 DMG 已从 Release 重新下载，通过 SHA-256、Developer ID、Hardened Runtime、stapler 与 Gatekeeper，已安装并启动 `/Applications/WhaleDock.app`；Spotlight 只回读这一份正式安装。
- Windows 仍未签名且只有 CI 证据；Intel x64 只有 Apple Silicon + Rosetta/云端构建证据，不得写成 Windows 或 Intel 真机已通过。

以下 v0.2–v0.5 记录保留为历史证据：

- PR [#1](https://github.com/sgd-shine/whaledock/pull/1) 已合并；正式 tag 指向 main 提交 `d8a8a774…`。
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 当前稳定版：[`v0.5.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.5.0)；非 draft、非 prerelease，`releases/latest` 已命中 v0.5 正式版。[`v0.4.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.4.0) 与 [`v0.3.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0) 保留为历史版本。
- 当前源码版本：`0.5.0` 已发布。
- v0.5.0 已正式公开发布：[Release v0.5.0](https://github.com/sgd-shine/whaledock/releases/tag/v0.5.0)，非 draft、非 prerelease，`releases/latest` 回读为 `v0.5.0`。正式注解 tag 指向提交 `19c84a4`。
- 该提交的 main CI [31932130219](https://github.com/sgd-shine/whaledock/actions/runs/31932130219) 三平台全绿；[Release run 31932206962](https://github.com/sgd-shine/whaledock/actions/runs/31932206962) 的 build-mac / build-windows 一次通过，publish job 首次按预期被审批门 fail-closed 阻止，设置精确批准值后重跑成功。
- 八项资产与精确字节数：`SHA256SUMS-mac.txt` 372 B、`SHA256SUMS-win.txt` 189 B、`WhaleDock-0.5.0-arm64-mac.zip` 204,815,588 B、`WhaleDock-0.5.0-arm64.dmg` 185,292,092 B、`WhaleDock-0.5.0-x64-mac.zip` 207,797,528 B、`WhaleDock-0.5.0-x64.dmg` 188,209,801 B、`WhaleDock-Setup-0.5.0.exe` 161,496,107 B、`WhaleDock-0.5.0-portable.exe` 161,308,254 B。发布前已把两个 Actions artifact 下载到本地，`shasum -a 256 -c` 六项产物全部 OK。
- 三平台 vendor 闭包与包数同 v0.4 完全一致（arm64 `9f5613cb…` 526 包、x64 `928f3fd6…` 526 包、win32/x64 `47ad1d95…` 525 包），没有新增包，按预授权直接发布，未触发 S1。
- 精确批准值 `release:v0.5.0:sha256:677674676d99c3f60cf76fb44b1ba9cf7491a0141b0986d4f7a99f31393ee4e8` 只在本次 publish 期间存在；Release 与八项资产回读后立即删除，仓库变量回读 `total_count=0`。
- v0.4.0 已正式公开发布：[Release v0.4.0](https://github.com/sgd-shine/whaledock/releases/tag/v0.4.0)，非 draft、非 prerelease，`releases/latest` 回读为 `v0.4.0`。正式注解 tag 对象 `4cd0a1f0e33201ba8b478a9869730a6177bbbcdd` 指向提交 `3a8913be6900dc8a1b64ee0a61bc03c8ba256443`。
- 该提交的 main CI [31930571815](https://github.com/sgd-shine/whaledock/actions/runs/31930571815) 三平台全绿；[Release run 31930662943](https://github.com/sgd-shine/whaledock/actions/runs/31930662943) 的 build-mac / build-windows 一次通过，publish job 首次按预期被审批门 fail-closed 阻止，设置精确批准值后重跑成功。
- 八项资产与精确字节数：`SHA256SUMS-mac.txt` 372 B、`SHA256SUMS-win.txt` 189 B、`WhaleDock-0.4.0-arm64-mac.zip` 204,794,555 B、`WhaleDock-0.4.0-arm64.dmg` 185,282,665 B、`WhaleDock-0.4.0-x64-mac.zip` 207,776,496 B、`WhaleDock-0.4.0-x64.dmg` 188,209,037 B、`WhaleDock-Setup-0.4.0.exe` 161,480,303 B、`WhaleDock-0.4.0-portable.exe` 161,292,453 B。发布前已把两个 Actions artifact 下载到本地，`shasum -a 256 -c` 六项产物全部 OK，这是独立于 CI 的成品回读。
- 三平台 vendor 闭包与包数同 v0.3 完全一致（arm64 `9f5613cb…` 526 包、x64 `928f3fd6…` 526 包、win32/x64 `47ad1d95…` 525 包），没有新增包，因此按预授权直接发布，没有触发 S1。
- 精确批准值 `release:v0.4.0:sha256:d9ed43878b3bb8c3aa4167c3c176d26c18d13dffa21b1bb9bdd3a549bd00a301` 只在本次 publish 期间存在；Release 与八项资产回读后立即删除，仓库变量回读 `total_count=0`。
- 正式注解 tag 对象 `8af8f86a527a105c9dbe5a204e75afcdd9dba409` 指向提交 `fe2d4def7bb7ef1d9339b71b1e28236fd9e1eabf`；[main CI 31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 的 Ubuntu、Windows、macOS 全绿。
- [Release run 31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 的构建与成品回读通过；attempt 2 的 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 成功发布八项资产。
- 精确批准值 `release:v0.3.0:sha256:8a7e9f14cfdaee35eb5baaa016547ec0a5d32d110876436185f186a3257407ad` 仅用于本次 publish；Release 回读后已删除，仓库变量回读不存在。
- 2026-08-15 SGD 决定：不发 beta；Windows 以“实验性支持（未真机验证）”发布；Intel 仅保留 Rosetta 抽查边界；无 S1 且 G1/成品材料闭环后，由 Codex 执行正式发布并临时设置、随即清除精确审批变量。

Windows/Intel 真机、Windows 签名与线上更新仍是独立证据边界。它们不阻断本次发布，但不得改写为已经通过。

## v0.7 远程板块｜批次 1（已整合 main）

### 已实现

- 远程线经 PR [#6](https://github.com/sgd-shine/whaledock/pull/6) 合入 `main`，merge 为 `73bb4ce`；该线从含驾驶舱 PR #3–#5 的 `main@145ac1c` 起步，没有删改驾驶舱功能。
- `lib/remote.js` 为纯 Node、零运行时依赖的三通道核心：只有收/推/批固定原语与生命周期，没有通用命令/RPC 入口。三通道默认全关；未配 adapter 只显示「未配置」，不伪造在线。
- 单人绑定使用双端六位码、五分钟 TTL 与权威 store 回读合同；确认项要求权威层原子/持久/幂等 apply。公开快照与审计不含 actor、正文、token、绑定码、路径或平台原始异常。
- 连接代、`AbortSignal`、连接与断开硬超时、按通道串行/跨通道隔离、操作数+字节双背压已固定。旧 session 未确认断开前不得开新代假绿；adapter lifecycle 的原始原因只映射为自有固定枚举。
- 设置窗已新增「远程」页：飞书/钉钉/随身网页的开关、真实状态灯、绑定状态、三类 IM 内容开关与「全部断开」。内置面向所有鲸坞用户的图文三步向导框架，明写凭据只存本机、同一 Wi-Fi 默认可用、Tailscale 只是可选加装且账号操作由用户本人完成。

### 当前证据与边界

- 整合后的本地 `npm run smoke` 实际为 **450 PASS / ALL PASS**；其中 `remote-smoke.js` 42 项、`main-remote-smoke.js` 10 项，并包含驾驶舱五个套件。Electron 43.4.0 在隔离 userData 的 macOS 源码态回读 `SMOKE_OK`。
- PR #6 的 [CI run 32561913602](https://github.com/sgd-shine/whaledock/actions/runs/32561913602) 已回读 macOS、Ubuntu、Windows 三项全绿。根 `dependencies` 仍为空，本批没有 SDK、新许可闭包、dsh runtime 变化、打包、Release 或新增产物体积；Windows/Intel 真机、安装包、签名/公证仍为 `N/A`。
- 本批不含真实飞书/钉钉 adapter、凭据输入/本地安全存储、真手机收发、随身网页 HTTP 监听、二维码或 Tailscale 安装。设置页向导是批次 1 信息架构，不得写成平台已可绑定。
- SGD 人工目视卡待执行：预计 3–5 分钟，检查三通道默认关闭、向导文案、未配置不假绿与全部断开回读。内部记录为 `docs/验收记录-远程板块-批次1-2026-08-21.md`（已 exclude）。

### 下批硬门

- 批次 2 真实飞书长连接前，若确需官方 Node SDK，必须先以 S1 口径报许可证、体积和依赖闭包，获 SGD 批准后才能加依赖。
- 批次 4 接真实事项前，内容分级必须接可回查的受信 event/approval/workspace ID，客服来源缺失时 fail-closed；`dedupeKey` 必须接持久去重。
- 真实 adapter/store 必须完整实现核心合同：权威幂等 apply、同一绑定 store、网络方法响应 `AbortSignal`、断开幂等；回调不得反向等待同通道 service 操作。

## v0.7 视频平台数据舱门侦察（内部只读线）

- 纯文档侦察已完成，内部报告为 `docs/侦察-视频平台数据舱门-2026-08-21.md`，共 430 行、40,870 B，SHA-256 `03f8993ed4bd3bd61cb302bec761bd95c8dd6b6648a117c63d29251a14e0d9b1`。报告按约定由 `.git/info/exclude` 排除，未进入公开 `main`；这不是漏提交。
- 当前只把“抖音自有账号、经正式授权的作品累计指标与评论”列为 Phase II 候选。小红书、视频号普通短视频自动取数未获得足够官方证据，三平台同行公开页自动采集均为红灯，不实现、不试跑灰色通道。
- 本线没有代码、网络采集、登录、凭据、平台写入或发布动作。Phase II 若启动，账号所有人还需回读当前后台字段/导出能力、抖音 scope 与 quota、三平台 AI 内容标识入口；在此之前均为 `NEEDS-HUMAN`，不阻断当前Ⅰ期源码闭环。

## v0.5 批次 13 已实现并发布

### 桌面宠物

- 宠物包是纯静态资源：`lib/pets.js` 只 `JSON.parse` manifest 的白名单字段并读 PNG 头，**绝不 require/eval/执行包内任何内容**，也不接受 `.js`/`.html`/`.svg`。坏 JSON、假 PNG、超尺寸、越界文件名与包内 symlink 逃逸都逐项跳过并给出原因，单个坏包不影响其他包。
- 零门槛「单图宠物」：文件夹里只有一张 PNG（连 manifest 都可省）即五态可用；多张带 `idle/busy/waiting/celebrate/error` 前缀的按前缀分组；前缀一个都认不出时全部作为 idle 逐帧。缺帧一律回落 idle，idle 也无帧才判定整包不可用。
- 漂浮、摇摆、呼吸缩放、事件弹跳/抖动全部由壳用 CSS 变换统一实现，任何一张图都会动；多帧包在此之上叠加逐帧播放。`prefers-reduced-motion` 时关闭动画。
- 五态由 `lib/events.js` 驱动：新增 `snapshot().activity.openTurns`（未结束的 turn 计数）与纯函数 `derivePetState`，优先级为 出错/庆祝瞬时态 → 等你拍板 → 干活中 → 空闲；瞬时态自带过期，事件层 `unavailable` 时固定 idle，不用「看起来在忙」冒充真实状态。
- 宠物窗是透明无边框独立窗口，`contextIsolation`/`sandbox`/精确 sender 校验、拒绝导航，preload 只暴露四个固定通道。主进程把帧读成 data: URL 下发（总量上限 8 MiB，超出丢帧并记日志），**渲染层拿不到任何本地路径**。可拖动、可置顶、可鼠标穿透；穿透开启时托盘「桌面宠物」子菜单仍可操作。默认关闭。
- 内置两只：完整五态的 `pixel-whale` 与只有一张图、无 manifest 的 `极简鲸鱼`，都由 `scripts/make-pet-sprites.js` 程序化生成（原创像素画，未使用任何第三方或官方素材）。

### 皮肤主题

- 主题是一个 JSON：`base` + 七个颜色 token。缺色回落同基调内置值，非法色值不采纳，坏文件跳过并记日志。只解析数据字段，不执行内容。
- 作用域限鲸坞自有界面：主进程按页面映射表用 `insertCSS` 覆盖各页面**已有的** CSS 变量，不改页面源码。主 Harness BrowserWindow 继续无 preload、无 CSS/DOM 注入——引擎的脸不动。
- 战报卡片自带深/浅两套配色，只有主题基调与本次导出基调一致时才套用，避免出现半套皮肤。
- 内置四套：鲸坞深色、鲸坞浅色、极光、墨鲸。

### 批次 13 当前实证

- 源码版本 `0.5.0` 已发布；本地 `npm run smoke` 实际为 **233 PASS / ALL PASS**，新增 `pets-themes-smoke.js`（21 项）与 `main-v05-smoke.js`（9 项）两个子套件，均由统一 smoke 真实执行。
- 隔离 userData `/private/tmp/whaledock-v05-gui` 的 macOS arm64 源码态已真实启动，日志回读「桌面宠物已开启：builtin:pixel-whale（idle/busy/waiting/celebrate/error）」，事件层就绪 13 个会话；本轮走的是 attach 外部 dsh 路径，退出后外部服务与 3080 端口按设计未被停止。
- **宠物窗与主题的视觉表现未做目视验收**：上述只是启动与窗口创建的日志证据，不等于人工看过宠物动效、透明背景、鼠标穿透或四套主题的实际配色。这些列入《第二阶段总验收清单》。
- 根 `dependencies` 仍为空，devDependencies 仍只有 electron/electron-builder；`lib/` 仍无 Electron require；没有新增运行时依赖或许可闭包。
- 宠物包热重载、多只同屏、点击宠物查看任务详情保留为 P2，本版未实现。

## v0.4 批次 12 已实现并发布

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

- 当前源码版本 `0.4.0`；本地 `npm run smoke` 实际为 **201 PASS / ALL PASS**。新增回归证明路径身份统一走原生 realpath（Windows 展开 8.3 别名并去掉 `\\?\` 前缀），工作区 canonicalize 与图片保存都会拒绝 `~/.dsh` 本身、后代及 realpath/link 入口。`npm run compliance:verify` 通过；darwin/x64 inventory 仍是 526 包，closure `928f3fd6cf6a876eeeff8fedb0df8d2864265279da7e7cf6636c2a03d87afdde`。根 `dependencies` 仍为空，devDependencies 仍只有 electron/electron-builder，没有新许可闭包。
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
- 当前 v0.4.0 源码态 `npm run smoke`：**201 PASS / ALL PASS**；新增工作区事务/journal、受保护目录拒绝、原生 realpath 路径身份、图片状态/受控文件、dsh prompt fail-closed 适配与 Electron 工作区/图片薄层，四个子套件全部纳入统一 smoke。v0.4 首轮 main CI [31898800355](https://github.com/sgd-shine/whaledock/actions/runs/31898800355) 的 Windows smoke 暴露了受保护根的真实路径身份缺口；一轮修复后 [31930427567](https://github.com/sgd-shine/whaledock/actions/runs/31930427567) 三平台全绿。
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

1. v0.6.0 正式签名、Apple 公证、Release、官方 arm64 安装与唯一安装回读已完成；线上「检查更新」按钮仍未做本轮人工点击验收。
2. v0.4 未对真实会话提交 prompt，未走完图片保存→OCR→复制/提交的全量 GUI 链；Windows.Media.Ocr、Windows `Win+Shift+S`/剪贴板、macOS 屏幕录制权限和安装包 GUI 仍待真机。
3. v0.4 并行多开保留为 P2；官方视觉 API 与 vision 插件只保留可探测槽位。
4. v0.3 Electron 系统通知权限及 Notification→Dock/托盘/banner 可见降级链尚未真机；真实 managed backend 跨预算线后的进程树停止、App 重启 latch 和“今日继续”恢复也未做 GUI+真进程闭环。
5. 现有深/浅战报为对比度修复前样张；修复后色彩、对比度、中文排版与剪贴板真实读回仍需最终人工验收。
6. Windows 全线真机与 Intel 真机均未做；Intel 仍只有 Apple Silicon + Rosetta，未签名 x64 成品回读也不是 Intel 真机；Windows 仍是未签名、未真机的实验性支持。
7. macOS 签名与 Apple 公证已在 v0.6.0 完成；Windows 签名仍未做。

详细发布证据与人工体验边界见 `HANDOFF.md`。

## v0.7 视频驾驶舱Ⅰ期源码状态（2026-08-21）

- 视频线 PR [#3](https://github.com/sgd-shine/whaledock/pull/3)、[#4](https://github.com/sgd-shine/whaledock/pull/4) 与验收文档 PR [#5](https://github.com/sgd-shine/whaledock/pull/5) 均已合入 `main`。公开稳定版仍是 v0.6.0，v0.7 尚未改版本、打包、打 tag 或发布。
- 内置短视频创作台已接通第一方驾驶舱：航道/今天、脚本块级建议、全屏拍摄、灵感/选题/打法、发布灯和离线数据占位均来自本地文件真相。普通工作台继续走原布局；电商客服包零改动。SGD 已通过基本操作、快捷键与工作台展开手感；唯一退回项“窄侧栏对话”已改成顶部摘要常驻、下方完整 Harness 全宽切换，返回现场不刷新对话或草稿。
- 驾驶舱顶栏新增「鲸坞色系」下拉与自定义主题入口。当前源码内置鲸坞深色、鲸坞浅色、极光、墨鲸、日落珊瑚、竹影青黛、潮汐靛蓝七套，也列出用户主题。选择复用并持久化 WhaleDock 的全局 `config.theme`，重启保留并同步刷新鲸坞自有界面；它不是驾驶舱私有配色。工作台自带 `theme.json` 时顶栏只读锁定，完整 dsh 对话 `WebContentsView` 仍不注入 CSS/DOM。
- 写入受 opaque token、源 hash CAS、root/父目录 inode 与恢复 journal 约束；未知 front matter 原样保留，平台数据未接通就不显示数字。主 dsh 视图继续无 preload/注入，根运行时依赖仍为 0。
- 本地最新 `npm run smoke` 为 **451 PASS / ALL PASS**；驾驶舱壳套件现为 6 项，新增精确主题请求、七套资源与三组 WCAG 对比度回归。全宽对话布局、IPC 白名单、快捷键与“不注入 dsh DOM”均继续通过；PR #3/#4/#6/#7 的既有三平台 CI 全绿，本色系批次的 CI 以对应 PR 回读为准。
- macOS Apple Silicon 隔离源码 App 已真实点击进入/返回全宽对话，并用未发送草稿证明切换未重载同一个 dsh 视图；⌘K 从 dsh 焦点返回现场、再次打开均通过。本色系批次另在隔离 userData 下真实选择潮汐靛蓝与日落珊瑚，修复旧 `:root` 优先级后确认整页换色，重启回读仍为日落珊瑚；`960×620`、`1280×820` 的创作现场、全宽对话和自定义设置入口均走通。尚未闭环：Windows/Intel 真机、Windows 断电/子进程崩溃恢复，以及 v0.7 安装包、体积、签名、公证、tag 与 Release。成功受控替换会保留 `WhaleDock-recovery-*.bak`，特殊 copy-only 冲突可能留下额外恢复证据，均需人核对后处理。
