# 鲸坞 WhaleDock

**DeepSeek Harness（dsh）非官方桌面客户端**：给鲸鱼一个靠岸的坞。双击启动，把 Harness 从浏览器标签页变成一个真正的桌面应用。

*WhaleDock is an unofficial desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It starts or attaches to the local `dsh` backend and displays its Web UI in a native Electron window.*

> ⚠️ 本项目是社区作品，与 DeepSeek 官方无关（Unofficial）。DeepSeek Harness 本体以 MIT 协议开源。本项目原名 Harness Desktop，自 v0.1.1 起更名为鲸坞 WhaleDock。

## 当前状态（2026-08-29）

- **公开稳定版是 v0.9.1**：tag 精确指向 `main@670e32c`；[main CI 32869008546](https://github.com/sgd-shine/whaledock/actions/runs/32869008546) 三平台全绿，[Release run 32869263514](https://github.com/sgd-shine/whaledock/actions/runs/32869263514) attempt 2 成功，[正式 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.9.1) 为非 draft、非 prerelease，共 8 项资产。v0.9.1 是稳定与恢复入口，不再是新功能开发线。
- **新功能开发已经切到 v0.10+**：应用身份仍为 `0.10.0-alpha.2`。Batch 10、1b、1c 已进入 `main@5ca193a`；Batch 1c 独立 PR [#23](https://github.com/sgd-shine/whaledock/pull/23) 及合并后 main 的三平台 CI 全绿。本地预览包使用独立构建配置与 `release-preview/`，不会冒充正式 v0.10 Release。
- v0.10 的原生页面保留官方会话侧栏，同时加入内容视图、多项目对齐、受控草稿填充、发送前上下文闸门、偏好持久化和桥不可用时的可见降级。受管页面只在鲸坞自行拉起、精确内置 dsh `0.1.1-rc.2` 且固定资产清单逐文件通过时启用；外部或无法证明的 dsh 继续使用原生会话，不接管发送。
- v0.10 受管模式使用鲸坞自己的持久 dsh 数据目录，跨后端重启、App 重启与工作区切换保留会话、设置、凭据、附件、存储和预设。它不会读取、迁移、覆盖或清理 `~/.dsh`；旧环境数据不会自动导入，首次使用可能需要重新配置模型。
- **v0.10 Batch 1 已完成受管上下文与持久数据根收口**：真实 rc.2 双冷启动回读了 Host/HTTP、会话与 cwd 恢复、同一持久 home/asset root 复用，设置与凭据文件保持不变，退出后端口已关闭。
- **v0.10 Batch 2 已完成可复现 refork 与双合规闭环**：两个 dsh UI fork 均由锁定的 rc.2 上游 tarball 和精确 patch 重建，布局 fork 差异为 `42+/5-`，对话 fork 为 `19+/3-`；未知版本在网络前拒绝，下载、tar、patch、差异预算与原子更新均有 fail-closed 守门。
- **v0.10 创作链与首次路径已经接通**：真实内容卡与任务回执、概览决策、脚本块提案、发布检查单、复盘打法库、原生拍摄现场与浏览器页内提词均已接通。Batch 1c 让内容态只认工作台当前工作区：首次进入或从「对话记录」回来时，右栏会自动复用或打开对应会话，不再要求新用户理解或点击“对齐”；异常时才显示一句人话和明确按钮。统一 `npm run smoke` 实跑 **856 PASS / 44 个 ALL PASS**，layout **59/59 PASS**；当前 context 基线为 **15 个文件 / 810,828 B**，digest `16ffc4198355b93a1950965eece991d4b615d5005f63b3ab2da6933038496fb1`。
- **最终 main 的 arm64 alpha.2 已成为本机开发安装，但仍只是本地证据**：Developer ID Application + Hardened Runtime 与严格验签通过，回读根 App runtime `52 packages / 449 files`、单份内置 dsh 合规材料；Spotlight 只发现 `/Applications/WhaleDock.app`。ZIP / DMG 为 `193,768,735 B` / `175,736,069 B`，归档 App / 内置 dsh runtime 为 `615,724 / 300,776 KiB`，`app.asar` 为 `19,856,711 B`。Gatekeeper 明确回读 `Unnotarized Developer ID`，没有公证或 stapled ticket。
- 安装态沿用 macOS 受保护文稿目录作为 cwd 时，自动验收不代用户授予 TCC 文件访问权限；已有运行验证使用专用、非受保护测试工作区。这不代表文稿目录权限已通过。v0.10 仍未发布；当前只等待 SGD 4 步卡回复“过”，之后才允许开始版本切换、tag、公证与公开 Release。Windows/Intel 真机、真实模型与人工体验仍是独立证据门。

## v0.2 带来了什么

- **Windows 与双架构 Mac**：提供 Windows x64 安装器/便携版，以及 macOS arm64、x64 独立安装包
- **免装 Node**：安装包内置锁定版 dsh 运行环境；电脑没有 Node 也能启动
- **设置窗口**：可视化修改快捷键、端口、工作目录、后端版本、内置引擎优先级、开机自启、启动最小化与更新开关
- **更新提醒**：Windows 安装版可下载、校验并一键静默安装；Windows 便携版与 macOS 提醒后打开下载页
- **自动托管后端**：启动时拉起 `dsh web`，退出时清理整个进程树；若端口上已有 Harness，则直接接入
- **后台恢复**：窗口收入托盘后，托管的后端若意外退出，会按 1/2/4 秒自动重启三次
- **原生体验**：记住窗口位置与大小、全局快捷键、托盘菜单、刷新/缩放/全屏，站外链接交给系统浏览器
- **启动页与日志**：实时显示启动日志；端口上的服务不像 Harness 时先警告，不会默默接错网页

后端默认锁定 `@deepseek-ai/dsh@0.1.1-rc.2`。从 v0.8.0 起，只有旧配置中精确等于旧默认值 `0.1.0-rc.6` 的后端版本会一次性跟随到 `0.1.1-rc.2`；`latest`、其他版本和用户自定义值均原样保留。上游仍处于 rc 阶段，因此升级锁定版本前需要重新验证；鲸坞不会写入或清理 `~/.dsh`。

## v0.3.0 已公开发布

v0.3.0 已作为历史稳定版公开发布：[正式 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0) 为非 draft、非 prerelease。正式注解 tag 对象 `8af8f86a527a105c9dbe5a204e75afcdd9dba409` 指向提交 `fe2d4def7bb7ef1d9339b71b1e28236fd9e1eabf`；[main CI 31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 三平台全绿，[Release run 31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 的 attempt 2 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 已发布八项资产。

- **任务与用量看板**：独立本地窗口显示今日/本周已观测 token、估算费用、顶层/子代理聚合和最近匿名任务。固定口径是“**dsh 已观测用量，非账单**”。
- **任务通知**：完成、失败与等待人工事件在本地持久成功后才进入 Electron Notification，并可降级到 Dock、托盘与鲸坞自有 banner。
- **每日软预算**：预算锁存先落盘，再停止鲸坞当次自己拉起且仍能确认归属的后端。接入外部 dsh 时只告警，**绝不停止外部服务**。
- **1080×1440 任务战报**：主进程从规范快照重读匿名数据，在隐藏的本地窗口生成深/浅两种 PNG，可复制或保存。
- **不侵入 Harness**：主 Harness 窗口仍无 preload、无 Node、无 DOM/脚本注入；看板、banner 和战报是鲸坞自己持有的本地窗口。

终态通知会等待约 350ms 并回读 history 尾部，再按“history 确认 → 本地 ledger 持久 → 通知”执行。这会缩小但不消除约 200–400ms 的 hard-crash 窗口；系统断电、进程强杀或上游尚未落盘时仍可能漏一次，本项目不宣称 exactly-once。

### v0.3 当前本地实证

- macOS arm64 源码态已实际接入当前端口上的 dsh，看到 13 个会话并进入 live；该服务是外部 attach，只完成 rc.6 host/list/history/WS 形状探测，**没有证明对方 npm 根包版本**。
- rc.6 history 兼容与单会话 50,000 条尾部基线仍会如实标记 `history-gap`；看板不把局部数据写成完整账单。
- 匿名看板已真实显示，深/浅战报均已通过 GUI 保存并回读为 1080×1440。这两张是对比度修复前的流程/尺寸样张，不代表最终色彩验收。
- 系统通知、真实 managed 预算停止/恢复、Windows 与 Intel Mac 仍未做真机验收。

### v0.3.0 正式资产

| 资产 | 精确字节数 |
| --- | ---: |
| `WhaleDock-0.3.0-arm64-mac.zip` | 204,753,794 B |
| `WhaleDock-0.3.0-arm64.dmg` | 185,260,077 B |
| `WhaleDock-0.3.0-x64-mac.zip` | 207,735,735 B |
| `WhaleDock-0.3.0-x64.dmg` | 188,143,119 B |
| `WhaleDock-Setup-0.3.0.exe` | 161,448,096 B |
| `WhaleDock-0.3.0-portable.exe` | 161,260,244 B |
| `SHA256SUMS-mac.txt` | 372 B |
| `SHA256SUMS-win.txt` | 189 B |

发布门精确批准值 `release:v0.3.0:sha256:8a7e9f14cfdaee35eb5baaa016547ec0a5d32d110876436185f186a3257407ad` 只在本次 publish 中临时存在；Release 与资产回读后已删除，仓库变量回读不存在。

## v0.4.0 已发布

v0.4.0 的批次 12 已完成实现、三平台 CI 与公开发布，[`v0.4.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.4.0) 与 [`v0.3.0`](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0) 现均作为历史版本保留。

- **单工作区管理**：只有 `config.json` 确实不存在的新用户才会创建“文稿（Documents）/鲸坞工作台/默认工作区”（POSIX 尽量为 `0700`）；既有配置即使 `workdir:null` 也原样尊重，不暗中迁移。短视频创作台等重工作台会在同一个“鲸坞工作台”父目录下新建自己的子文件夹。
- **菜单、托盘与标题**：两处都有“工作区”子菜单，可切换最近目录或打开新文件夹；标题显示已提交的工作区名。切换使用串行 journal，必须完成旧后端停止、config 持久、新后端归属与实际 cwd 回读后才提交；失败回滚或 fail-closed。
- **截图与图片入口**：支持 macOS 系统框选快捷键、拖图进鲸坞自有窗口、显式读取/粘贴剪贴板三种入口。Windows 快捷键只引导 `Win+Shift+S`，完成后由用户主动读取剪贴板，不持续监听。
- **两次确认与本地降级**：第一次确认后才把图片安全保存到当前工作区的 `鲸坞截图/`，第二次确认后才交付文本。路由为官方视觉槽位 → vision 插件槽位 → macOS Vision / Windows.Media.Ocr 本地 OCR → 仅路径；锁定的 rc.6 prompt 合约不能精确证明时，复制同一份用户已检查文本并提示手动粘贴。
- **不侵入 Harness**：主 Harness BrowserWindow 仍无 preload、无 Node、无 DOM/脚本注入。工作区只是 dsh 默认 cwd，**不是文件读取沙箱**。

本地统一 `npm run smoke` 已回读 **201 PASS / ALL PASS**。工作区选择与图片保存还会在字面路径和 realpath 两层拒绝 `~/.dsh` 本身、后代及链接目标。隔离的 macOS arm64 源码态 GUI 已用真实 managed dsh 回读默认工作区标题、菜单、设置中的只读工作区/截图快捷键和自有图片窗口，并完成取消清理；退出后 dsh 与 3080 端口清零。真实 prompt 提交、完整图片保存/交付流、Windows、Intel、系统权限与安装包 GUI 仍待独立验证。

## v0.6.0 已发布：工作台包

v0.6.0 是已发布的历史版本，macOS arm64/x64 安装包已用
**Developer ID Application** 正式签名，开启 Hardened Runtime，并通过 Apple 公证；DMG 已附加离线公证票据。

**鲸坞从「一个能开 Harness 的壳」，变成「一个可以停不同船的坞」。**

换一个工作台，配色、桌面宠物、左侧常用按钮、工作文件夹全套一起换；而这些工作台
**只是几个文本文件**，不是代码，鲸坞永远不执行它们。

### 装一步，切一下

把工作台文件夹**拖进鲸坞窗口**，松手就装好了。鲸坞只做一件事：把它原样复制一份到自己的目录下——
**不解压、不执行、不联网、不改你原来的文件夹**。拖错了在设置里点「移除」，只删掉那份副本。

切换有四个入口，随便哪个都是点一下就换：窗口左上角的常驻工作台按钮、托盘菜单、菜单栏「工作台」、
以及 `⌘⇧1`~`⌘⇧9` / `⌘⇧0`（回到上一个）。

- **轻工作台**（没写 `workspace.json`）：换皮肤 + 换按钮，**瞬间完成，后端不重启，什么都不弹**。
- **重工作台**：要在硬盘上建文件夹并重启后端，所以**第一次启用会问一次**，之后再切什么都不弹。
  本机实测一次切换约 2.6 秒。

### 内置一个短视频创作台

选题 → 脚本 → 口播稿 → 封面标题 → 素材清单，左边五个按钮就是一条流水线，每一步的结果都是
工作区里一个**真实文件**，随时能改、能翻回去看，**同名文件永远不覆盖**。
装好就带三份示例选题，点第一个按钮马上有产出，不用先干瞪眼填素材。

### 包里只有数据

这是整版的地基，一条都没松：包里只有 JSON / Markdown / PNG，鲸坞**不 `require`、不 `eval`、不 `spawn`
包内任何东西**；`agent.cordis.yml` 只查存在性与路径，**内容一个字节都不读进解析器**（也就没引入 YAML 库）；
`skills.json` 只展示 + 给一个「复制安装命令」的按钮，**永不自动安装**；`onboarding.md` 按纯文本显示，
不解析 Markdown、不渲染 HTML、不生成可点链接；提示词是**死文本**，包含 `{{变量}}` 也原样发出去。

包内路径拒 `..`、拒绝对路径、拒符号链接逃逸，**字面路径与 realpath 两层都拒**，
任何指向 `~/.dsh` 的落点一律拒绝且**拒绝时连文件夹都不建**。老鲸坞遇到新包写的新字段一律忽略、
照常加载，只记一条灰色提示——包作者可以放心用将来才有的字段。

做法见 [工作台包制作指南](docs/工作台包制作指南.md)。

### 顺带：托盘现在看得出 AI 在干嘛

托盘图标跟桌面宠物用**同一个数据源**显示五态（空闲 / 思考中 / 等你拍板 / 已完成 / 出错），
连不上事件流时变灰并明写「连接不上，正在重试」——不猜、不装作空闲。

卡在「等你确认」时有一条逐级升高的叫醒阶梯：0 秒托盘 + Dock 角标 + 通知，8 秒宠物窗摆一下，
30 秒再通知一次并让 Dock 持续弹跳。**永远不做三件事：不抢焦点、不遮挡、不循环响铃**；
你一动就全停，每个待确认项只叫一遍。每一层都能单独关，还有一个「安静模式」总开关。

### 证据边界

本地统一 `npm run smoke` 为 **319 PASS / ALL PASS**，正式 tag 提交的三平台 CI 全绿。
公开 Release 的 8 项资产已回读；4 份 macOS 成品均获 Apple `Accepted`，arm64 DMG 已从 Release 重新下载并通过
SHA-256、Developer ID、Hardened Runtime、stapler 与 Gatekeeper 校验，安装到 `/Applications/WhaleDock.app` 后可正常启动，系统只索引这一份正式安装。
真机验过的：轻/重工作台切换、五个按钮全部提交成功、重工作台切换耗时。
**没验的**：托盘五态与叫醒阶梯的实际观感、Windows 真机、macOS 中文目录名 NFC/NFD。
托盘图标目前是**程序合成的占位角标**，20 张正式素材是单独一批。
详见 [v0.6 交付与验收清单](docs/v0.6交付与验收清单-2026-08-20.md)。

## v0.7.0 已发布：视频驾驶舱、全宽对话与色系快切

- **第一方视频驾驶舱**：今天、选题拍板、脚本块级建议/对照/采用/撤销、全屏拍摄提词器、两阶段收工、发布检查单与打法库连成一条本地创作线。平台数据没有接通时只显示“侦察中，未接通”，不使用示意数字。
- **全宽对话现场**：在创作现场与完整 dsh/Harness 之间用 `⌘K` / `Ctrl+K` 往返，切换不重载同一个视图，会话与未发送草稿继续保留。
- **鲸坞色系快切**：顶栏可直接选择七套内置色系和用户主题，选择会刷新鲸坞自有界面并跨重启保留；完整 Harness 对话区始终不注入 CSS 或 DOM。
- **远程板块批次 1**：设置页已有三通道骨架和自助向导，但飞书、钉钉、随身网页默认全关，本版没有接通任何真实平台。
- **电商客服工作台包**：随附示例话术版，继续遵守纯数据、纯本地和不执行包内内容的边界。

正式 [`v0.7.0` Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.7.0) 为非 draft、非 prerelease；注解 tag 精确指向 `310654e412af38fd0d49f575c57ad9c166d3f7c4`，[main CI 32566512173](https://github.com/sgd-shine/whaledock/actions/runs/32566512173) 三平台全绿。发布链的通配符冲突修复后，本地统一 `npm run smoke` 为 **453 PASS / ALL PASS**；公开 Release 共 8 项资产。Windows 仍未做真机验收，Intel Mac 仍只有 Apple Silicon + Rosetta 抽查，不能由 CI、签名或公证替代。

## v0.8.0 已公开发布：dsh 跟版与飞书远程桥

- **dsh 精确升锁**：内置 runtime 与 npx 回退统一锁定 `@deepseek-ai/dsh@0.1.1-rc.2`；仅旧默认 `0.1.0-rc.6` 会一次性迁移，用户自定义选择不被覆盖。
- **飞书远程桥**：接入自建应用的官方长连接，手机绑定后可进行受控的消息收发。根应用仅精确依赖 `@larksuiteoapi/node-sdk@1.73.0`，且只在飞书通道实际启用时懒加载；飞书关闭时不加载 SDK，也不建立平台网络连接。
- **双合规身份**：dsh 内置 runtime 继续使用根 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)；根应用 SDK 及其可达闭包单独使用 [`compliance/app-runtime/THIRD_PARTY_NOTICES.md`](compliance/app-runtime/THIRD_PARTY_NOTICES.md)、inventory 和内容哈希许可文本，两条链不混合。

> **手动启用 SQLite 的用户请先备份并保留旧 runtime。** dsh `0.1.1-rc.2` 的 opt-in SQLite schema 从 15 升到 17，当前没有迁移路径；鲸坞不会替你迁移、覆盖或清理这份数据。默认 JSONL 会话存储不受这条提示影响。

v0.8.0 已由 `main@9c09ee8` 完成三平台 [CI 32631081067](https://github.com/sgd-shine/whaledock/actions/runs/32631081067) 与 [Release workflow 32631179655](https://github.com/sgd-shine/whaledock/actions/runs/32631179655)，[公开 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.8.0) 共 8 项资产。官方 macOS arm64 成品已下载安装回读；飞书真实企业租户、手机收发与人工绑定仍未验收，Windows 与 Intel Mac 也仍无真机证据，不能由源码测试、CI 或成品 probe 代替。

## v0.9.0 已公开发布：原地任务回执与工作区去糊

- **投递前对账**：写脚本、块动作和灵感拆条先核对目标会话 cwd 与当前工作区；不匹配或无法确认时默认不发送，只有显式覆盖才继续。
- **原地回执环**：回执锚定灵感区、项目卡或脚本块，显示排队、进行中、等待、完成、错误、拒绝与无法确认，以及运行用时；watcher 看到结果落盘后自动刷新“刚更新”和结果入口。
- **工作区去糊**：驾驶舱和普通工作台常显安全工作区名称与打开入口；首次引导解释“工作台 / 工作区 / 会话”三层关系和默认落点。

正式 tag `v0.9.0` 指向合并提交 `80009fed511a9345b0762fc564603b24d3361ff6`。本地最终统一 smoke 为 **606 PASS / 31 个 ALL PASS**，[PR #14 最终 CI 32634898329](https://github.com/sgd-shine/whaledock/actions/runs/32634898329) 与 [main CI 32634983004](https://github.com/sgd-shine/whaledock/actions/runs/32634983004) 均三平台全绿。发布工作流首轮只在精确审批门按预期 fail-closed；六份成品闭环后用本 tag 唯一摘要重跑 publish，成功创建 [v0.9.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.9.0)，审批变量随即删除并回读不存在。

macOS arm64/x64 四项 Apple submission 均为 `Accepted`，两个 DMG 都通过 staple/validate，挂载 App 由 Gatekeeper 接受为 `Notarized Developer ID`。本机正式安装的 arm64 App 为 0.9.0、`com.sgd.whaledock`、Developer ID `wang jie (CS4NK76DA5)`、Hardened Runtime；DMG 有离线票据，安装后的 `.app` 本体没有独立 stapled ticket，但 Gatekeeper 仍接受，二者不混写。Windows 安装包仍未签名且未真机验证；Intel Mac 仍未做 Intel 真机验收。受控 loopback UI 证据也不代表真实 dsh、模型质量或 SGD 亲手体验。

## v0.5.0 已发布：桌面宠物与皮肤主题

v0.5 给鲸坞加了两件可以完全自定义的东西，**都不需要写代码**。

### 丢一张图就是一只桌面宠物

往宠物文件夹里新建一个文件夹、放一张 PNG，它就是一只会动的桌面宠物：漂浮、呼吸、AI 干活时动得更快、等你拍板时晃一晃、任务完成跳一下——这些动作由鲸坞统一实现，**任何一张图都能动**。想更讲究就放多帧 PNG 做逐帧动画，或写一个可选的 `manifest.json`。

宠物按 `lib/events.js` 的任务事件显示五种状态：空闲 / 干活中 / 等你拍板 / 完成庆祝 / 出错，缺帧自动回落空闲。默认关闭，在设置 →「外观与宠物」里开启，可拖动、可置顶、可鼠标穿透。

内置两只做示例：完整五态的**像素鲸鱼**，和只有一张图、连 manifest 都没有的**极简鲸鱼**。做法见 [宠物包制作指南](docs/宠物包制作指南.md)，里面有可以直接发给画图 AI 的提示词模板。

### 改七个颜色值就是一套皮肤

一个主题就是一个 JSON 文件，放进主题文件夹即被识别，选中立即生效。内置鲸坞深色 / 鲸坞浅色 / 极光 / 墨鲸四套当模板。做法见 [主题制作指南](docs/主题制作指南.md)。

主题只作用于鲸坞自己的界面（启动页、设置、看板、截图窗、战报卡片），**不会改动 Harness 网页本身**——引擎的脸不动。

### 安全边界

宠物包与主题包都是**纯静态资源**：鲸坞只解析 JSON 数据字段和 PNG 像素，**绝不执行包内任何内容**，也不接受 `.js` / `.html` / `.svg`。坏文件会被跳过并写进日志，不会崩溃、不影响其他包。鲸坞**不联网下载任何宠物包或主题**，全靠你手动放文件。

### 欢迎分享

做好了欢迎提 PR：宠物放 [`community-pets/`](community-pets/)，主题放 [`community-themes/`](community-themes/)。只接受你自己拥有版权、MIT 兼容的素材。

### 证据边界

本地统一 `npm run smoke` 为 **233 PASS / ALL PASS**，正式 tag 提交的三平台 CI 全绿，八项 Release 资产已回读。但**宠物动效、透明背景、鼠标穿透与四套主题的实际配色都还没有人工目视验收**，只有代码与启动日志证据；人工体验项见 [第二阶段总验收清单](docs/第二阶段总验收清单-2026-08-16.md)，完整遗留见 [遗留清单](docs/遗留清单-2026-08-16.md)。这里的签名/公证描述是 v0.5 的历史边界；当前 v0.6.0 的 macOS 成品已正式签名并通过 Apple 公证。

## 下载与安装

从 [GitHub Releases](https://github.com/sgd-shine/whaledock/releases) 按电脑选择产物：

| 电脑 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Apple Silicon Mac | `WhaleDock-<版本>-arm64.dmg` | 打开 dmg，拖入「应用程序」 |
| Intel Mac | `WhaleDock-<版本>-x64.dmg` | 打开 dmg，拖入「应用程序」；v0.9 在 Apple Silicon + Rosetta 仅抽查到钥匙串人工门，未完成 `SMOKE_OK`/正常退出，也未做 Intel 真机 |
| Windows 10/11 x64 | `WhaleDock-Setup-<版本>.exe` | 双击，按当前用户安装 |
| Windows 10/11 x64 便携使用 | `WhaleDock-<版本>-portable.exe` | 放到固定目录后直接双击；无需安装 |

安装版已经带有内置引擎，**普通用户不需要另装 Node.js，也不需要打开终端**。首次进入 Harness 后，仍需按[官方说明](https://github.com/deepseek-ai/deepseek-harness)配置所需的模型/API Key。

安装包包含第三方组件；dsh 内置 runtime 的逐包清单、源码地址与完整许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)，根应用运行时（含飞书 SDK）的独立清单与许可文本见 [`compliance/app-runtime/THIRD_PARTY_NOTICES.md`](compliance/app-runtime/THIRD_PARTY_NOTICES.md)。

### macOS 首次打开

从 v0.6.0 起，macOS 安装包已用 **Developer ID Application** 正式签名并通过 **Apple 公证**，
同时开启 Hardened Runtime，DMG 已附加公证票据。正常安装只需：

1. 打开 dmg，把 WhaleDock 拖进「应用程序」；
2. 双击 WhaleDock 正常启动。

不需要右键绕行、点「仍要打开」或删除系统隔离属性。如果 v0.6.0 仍出现「已损坏」或「无法验证开发者」，
请停止安装，先用 `SHA256SUMS-mac.txt` 核对下载，不要关闭 Gatekeeper。v0.5.1 的 ad-hoc 签名和 v0.5.0 及更早版本的无签名问题只作历史排障参考。

多语言版本（中文 / English / 日本語）见 [`docs/macOS-安装与已损坏提示.md`](docs/macOS-安装与已损坏提示.md)，可直接转发给用户。

### Windows SmartScreen

当前 Windows 安装器没有代码签名。SmartScreen 出现「Windows 已保护你的电脑」时：

1. 确认文件来自本仓库的 Releases 页面；
2. 点击「更多信息」；
3. 核对应用名后点击「仍要运行」。

请不要从第三方下载站获取安装包。Release 同时提供 `SHA256SUMS-win.txt` / `SHA256SUMS-mac.txt`，可用于核对下载文件。

> Windows x64 当前为**实验性支持，尚未做 Windows 真机验证**。CI 只证明构建与纯 Node 合约，不等于内置 dsh、安装/便携版或半自动更新已经真机通过。遇到问题请从设置页复制日志，并在本仓库提交 issue；不要清理用户的 `.dsh` 数据。

## 内置引擎如何工作

鲸坞按以下顺序寻找后端：

1. 你填写的自定义命令；
2. PATH 中已经安装的 `dsh`；
3. PATH 中的 `npx`，并锁定 `0.1.1-rc.2`；
4. 安装包自带的 dsh 运行环境。

因此，已有 Node/dsh 的开发者仍可沿用自己的环境；没有 Node 的电脑会自动落到内置引擎。若本机 Node 环境混乱，可在「设置 → 后端」勾选「优先使用内置引擎」，让内置引擎排到系统 PATH 探测之前。该开关默认关闭。

## 设置

从托盘菜单选择「设置…」。macOS 还可以按 `⌘,`，Windows 可从「文件 → 设置…」进入。

| 设置 | 默认值 | 生效方式 |
| --- | --- | --- |
| 开机自动启动 | 关闭 | 保存后立即与系统登录项对账 |
| 启动时最小化到托盘 | 关闭 | 下次启动生效；启动失败仍会弹出错误页 |
| 全局快捷键 | `CommandOrControl+Shift+H` | 保存后试注册；占用时回滚旧快捷键 |
| 自动检查新版本 | 开启 | 保存后立即生效 |
| 端口 | `3080` | 保存后需重启后端 |
| 工作区 | 仅新配置默认为“文稿（Documents）/鲸坞工作台/默认工作区”；重工作台在同父目录新建子文件夹 | 设置页只读；从菜单/托盘或“选择并切换…”执行完整后端事务 |
| 后端版本 | `0.1.1-rc.2` | 控制 npx 回退；内置引擎只在该值与包内版本一致时可用；保存后需重启后端 |
| 优先使用内置引擎 | 关闭 | 保存后需重启后端 |
| 自定义启动命令 | 留空 | 高级选项；保存后需重启后端 |
| 启用截图快捷键 | 开启 | 关闭时真实解除注册 |
| 截图快捷键 | `CommandOrControl+Shift+S` | 不得与主窗口快捷键相同；注册失败时回滚 |

Windows 便携版的开机自启指向当前 exe；移动文件后，下次启动会尝试把登录项修正到新路径。为了稳定自启，建议把便携版放到固定目录，或改用安装版。macOS 当前正式版已用 Developer ID 签名并公证；如系统仍拒绝登录项，以设置页的真实回读为准，到「系统设置 → 通用 → 登录项」复核。

配置文件位置：

- macOS：`~/Library/Application Support/WhaleDock/config.json`
- Windows：`%APPDATA%\WhaleDock\config.json`

正常使用优先通过设置窗口修改。旧版 Harness Desktop 的 macOS 配置会在首次启动时迁移。

## 更新检查与隐私

更新检查不是遥测。开启「自动检查新版本」后，鲸坞只会请求固定地址 `https://api.github.com/repos/sgd-shine/whaledock/releases/latest`，请求只带 GitHub API 所需的 `Accept` 和固定应用 `User-Agent`，**不会附加账号、设备号、安装 ID、配置内容或其他用户标识**。像任何网络请求一样，GitHub 仍会看到连接所必需的网络信息（例如来源 IP），但鲸坞不会额外生成或上报身份数据。

该功能由 `checkUpdates` 总开关控制：关闭后，启动后检查、每 24 小时检查和手动检查都不会发出更新请求。可随时重新开启。

- Windows 安装版：下载同一 Release 的 Setup 与 `SHA256SUMS-win.txt`，SHA-256 校验通过后才提供「重启并更新」；安装动作仍由用户确认
- Windows 便携版：不会覆盖正在运行的 exe，只提醒并打开 Releases 下载页
- macOS：只提醒新版并打开 Releases 下载页；在完成签名公证前不做应用内自动替换
- 两个平台都可「跳过此版本」或选择「稍后」

GitHub 的 `releases/latest` 默认不返回 prerelease，因此 beta Release 不会被推给正式版用户。

## 从源码运行与构建

只有**源码开发/构建**需要 Node.js 22.12 或更高版本；安装版用户不需要。

```bash
git clone https://github.com/sgd-shine/whaledock.git
cd whaledock
npm install
npm run smoke
npm start
```

构建命令：

```bash
npm run dist:mac:arm64   # Apple Silicon dmg + zip
npm run dist:mac:x64     # Intel Mac dmg + zip
npm run dist:win         # Windows x64 Setup + portable（建议在 Windows runner）
```

每个 dist 命令会先生成与目标平台/架构匹配的内置 dsh 运行环境，产物写入 `release/`。macOS 构建会先把该目录标记为不索引，再把 electron-builder 的裸 `WhaleDock.app` staging bundle 移入 `release/.app-archives.noindex/` 并改为 `.app-bundle` 后缀；每个架构只保留一个滚动裸包归档，历史版本继续由版本化 dmg/zip 保存。系统应用界面只应看到 `/Applications/WhaleDock.app`。不要把一个平台生成的 `vendor/dsh-runtime/` 直接拿去打另一个平台的包。

若要核对构建目录没有残留可索引的鲸坞裸包，可运行：

```bash
node scripts/macos-build-visibility.js --out-dir=release --check
```

`npm run smoke` 是不依赖图形界面的纯 Node 测试集。当前 v0.4 源码态本地回读为 **201 PASS / ALL PASS**，新增覆盖配置/默认工作区、串行切换与 journal 恢复、受保护目录拒绝、安全图片落盘、OCR 路由、rc.6 prompt fail-closed 适配和 Electron 薄层信任边界。这是本地纯 Node 证据；v0.4 正式 tag 提交的 [main CI 31930571815](https://github.com/sgd-shine/whaledock/actions/runs/31930571815) 三平台全绿是另一类证据，两者不互相替代。

## 常见问题

**启动很久没有进入主窗口** — 若正在走 npx 路径，首次下载 dsh 可能需要几分钟。想绕开本机 Node 环境，可在设置中启用「优先使用内置引擎」。

**端口 3080 上有服务，但提示不像 Harness** — 可能是其他程序占用了端口。优先打开设置改端口；确认确实是 Harness 时，也可以选择「仍然接入」。弱特征检查失败只提示，不会删除或停止端口上的外部进程。

**我已经在终端启动了 dsh** — 鲸坞会识别并接入已有 Harness；退出鲸坞时不会关闭这个外部服务。

**外部 dsh 达到每日预算会怎样** — v0.3 只标记超限并提醒“外部服务仍在运行”，不会停止不属于鲸坞的进程。只有鲸坞当次自己拉起且 generation/进程身份仍匹配的 managed backend 才可停止。

**切换工作区后，AI 就不能读其他目录了吗** — 不是。工作区是 dsh 的默认 cwd 和鲸坞截图的保存根，不是读取沙箱。请仍不要把不希望 AI 访问的敏感文件放在可访问路径。

**截图后为什么只提示复制粘贴** — 锁定的 DeepSeek 通道是 text-only。只有本地 loopback、当前锁定 dsh 根包/合约证明和目标会话都通过时，鲸坞才会在第二次确认后提交 OCR 文本+图片路径。任一条件不满足就复制已预览的同一份文本，请用户自己粘贴；超时/断线结果不确定时也不自动重试。

**Windows 退出后还有 node/dsh 进程** — 先从托盘选择「退出」，再查看设置页/日志。Windows 版用 `taskkill /T` 清理托管的进程树；若真机验收失败，第一步应复制日志定位，不要猜测性改命令。

**想跟随最新 dsh** — 可把后端版本改为 `latest`，但上游仍是 rc，可能出现破坏性变化，而且与包内锁定版本不一致时不会走内置引擎。稳定使用建议保留默认 `0.1.1-rc.2`。

## 文档

- [操作手册](docs/操作手册.md)
- [v0.2 开发方案](docs/开发方案-v0.2-2026-08-15.md)
- [v0.3 开发方案](docs/开发方案-v0.3-2026-08-15.md)
- [v0.4 开发方案](docs/开发方案-v0.4-2026-08-15.md)
- [v0.5 开发方案](docs/开发方案-v0.5-2026-08-16.md)
- [v0.6 开发方案：工作台包](docs/开发方案-v0.6-工作台包.md)
- [v0.6 交付与验收清单](docs/v0.6交付与验收清单-2026-08-20.md)
- [工作台包制作指南](docs/工作台包制作指南.md)
- [工作台包底座通用性验证：四个纸面包](docs/纸面包验证-2026-08-19.md)
- [宠物包制作指南](docs/宠物包制作指南.md)
- [主题制作指南](docs/主题制作指南.md)
- [第二阶段总验收清单](docs/第二阶段总验收清单-2026-08-16.md)
- [遗留清单](docs/遗留清单-2026-08-16.md)
- [产品审计与路线图](docs/产品审计与路线图-2026-08-14.md)
- [AI 编码代理工程约定](AGENTS.md)

## 版本路线图

- **v0.2.0**：已发布的历史稳定版。
- **v0.3.0**：批次 11 已实现并公开发布；通知、真实 managed 预算停止/恢复、Windows 与 Intel 真机仍是发布后补证边界。
- **v0.4.0**：批次 12 的单工作区切换与截图入口 v1 已实现、过三平台 CI 并公开发布。并行多开（独立端口/多后端/多主窗口）明确保留为 P2，本版未实现。
- **v0.5.0**：批次 13 的桌面宠物与皮肤主题，已实现、过三平台 CI 并公开发布。宠物包与主题包都是纯静态资源，不执行包内代码、不联网下载。宠物包热重载、多只同屏与点击查看任务详情保留为 P2。
- **v0.6.0**：工作台包机制、内置短视频创作台、托盘五态与叫醒阶梯，已实现、过三平台 CI 并公开发布；macOS 成品已正式签名并通过 Apple 公证。社区包目录、`.whaledock` 一键装、提示词输入表单与批量执行仍留待后续版本；`agent.cordis.yml` 继续**只检测不接通**。
- **v0.7.0**：第一方视频驾驶舱、全宽对话现场、鲸坞全局色系快切、远程板块批次 1 骨架与电商客服示例包已公开发布；Windows/Intel 真机与 Windows 签名仍是独立边界。
- **v0.8.0**：dsh 默认锁定升至 `0.1.1-rc.2`，飞书自建应用长连接与独立 app-runtime 合规链已完成并公开发布；正式 Release 共 8 项资产，官方 macOS arm64 成品已安装回读。飞书真租户/手机、Windows 真机与 Intel 真机仍待补证。
- **v0.9.0**：体验流畅度批次 2/3 已实现、过最终三平台 CI 并公开发布，共 8 项资产；官方 macOS arm64 成品已完成静态安装回读，受控源码流程 MP4/GIF 已完成。钥匙串确认后的成品 GUI、真实 dsh/模型、cwd mismatch、断线降级与 SGD 亲手体验仍为 `NEEDS-HUMAN`。
- **v1.0**：macOS 签名/公证已在 v0.6.0 提前完成；v1.0 的范围不再把它当作未完前置项。Windows 签名与双平台真机覆盖仍需独立决策和证据。

## License

[MIT](LICENSE) © 2026 SGD。DeepSeek Harness 归 DeepSeek 所有并以 MIT 协议开源；本项目未使用 DeepSeek 的商标与素材，「鲸坞」名称与鲸鱼图标均为原创几何设计。
