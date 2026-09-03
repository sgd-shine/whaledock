# HANDOFF.md — WhaleDock v0.10.0 发布收口与 v0.11 alpha 当前交接

更新：2026-09-02 · SGD 已拍板 v0.11 路线 B 与 Q1–Q5，并授权批次 5、安装和上传；批次 1–5 源码实现已完成，`v0.11.0-alpha.1` 的回归、CI、签名/公证、安装与预发布上传须继续分层回读

## v0.11 批次 0（2026-09-02，Claude）：标杆审计与项目/控制室地基

- 标杆：[Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) v0.2.3（MIT）。SGD 明确其界面、交互与设计逻辑就是目标，并提出新愿景“桌面智能体，随时插入不同项目”。Codex 于 2026-09-01 完成一轮只读学习。
- 三份内部文档（均命中 exclude）：`docs/审计-以dsh-worktable为标杆的项目审计-Claude-2026-09-02.md`、`docs/开发方案-v0.11-桌面智能体项目工作台-2026-09-02.md`、`docs/接力提示词-v0.11-项目工作台-批次1-2026-09-02.md`。推荐路线 B：在鲸坞私有插件 + `whaledock.content-shell/v1` seam 上重建标杆的四个模型（项目一等对象、控制室、窗格容器、产物回流），不引入标杆代码。
- 当时已落地代码（分支 `claude/v011-project-workbench`，该批次交接时**未提交、未推送**）：`lib/projects.js`（app-owned 项目注册表：`proj_` 随机 id、文件夹 canonical 校验与受保护根、绑定会话、布局、排序/隐藏、控制室固定首位、原子写与坏文件隔离、可选 `.whaledock/project.json` 旁车认领）；`lib/control-room.js`（控制室纯函数：rc.2 快照收窄、need>done>busy>idle、子代理双通道聚合、ack 生命周期）；`test/projects-smoke.js` 14 项、`test/control-room-smoke.js` 8 项；`test/smoke.js` 新增 v0.11 组。本机 `npm run smoke`：`ALL PASS`，46 个 ALL PASS 标记（正式版基线 44）。
- 已核实的关键前提：rc.2 `session.create` 接受 `workspaceId` 或 `cwd`（`vendor/.../dsh-client-connection/lib/client.js:5267`），插件已在用 `workspaces.create({path})` + `connectWorkspace()`；因此“切项目 = 切会话，不重启后端”可行。
- SGD 已拍板（开发方案 §9）：Q1 明确选择“是”；Q2–Q5 全部采用 Claude 推荐——保留零概念首次路径并恢复项目抽屉、registry 为主 + 旁车可选、首批 1:1 绑定、控制室独立暗色蓝图视觉。路线 B 与总纲修订正式生效。
- Codex 随后按接力提示词完成批次 1，并继续完成批次 2–4；结果见下一节。候选批次 5 的终端窗格等安全面仍按方案要求另行批准。

## v0.11 批次 1–4（2026-09-02，Codex）：源码开发完成

- **批次 1**：21 个 legacy context operation 已抽入纯 Node `lib/context-workspace-ops.js`，8 个项目 operation 独立分域；主进程注册表、Host root authorize、HMAC 根证明、AEAD bootstrap ticket、prepare/open/commit 与 settle fallback 均已闭环。页面不传绝对路径，`~/.dsh` 仍不读写。
- **批次 2**：项目抽屉、固定控制室、项目管理、1:1 会话绑定/切换、三态主题、need/done/busy/idle 卡片与托盘文案已落地；控制室保留独立暗色蓝图视觉，右侧原生对话持续可达。
- **批次 3**：三个持久化预设、稳定「窗口N」、五类安全窗格、`widget-result.json` 双回读锁定回流和隔离 HTML 子窗已落地。响应式使用“中栏 720px + 单窗 600px”两层容器查询；1200×768 三预设的中栏 538px、单窗 508px、模板 482px，所有测点 `scrollWidth == clientWidth`。空窗收为明确的 Agent 产物落点。
- **批次 4**：模板+文件夹向导、只补缺失文件、项目动作只填草稿不发送、经典驾驶舱 Settings-only、⌘⇧1–9 切项目与旧配置 durable-once 迁移已落地。
- 全量 `npm run smoke` 实跑 **1007 PASS / 55 个 ALL PASS 标记**，末行 `ALL PASS`；定向回归为 plugin 28、main v0.11 25、project ops 22、projects 17、P0B 21、backend context 19。context 固定包为 **15 文件 / 998,730 B**，digest `4120ef87ecf588829de06b9424c1f7f89d9526148504fb43609a9c5a749db8b5`。App runtime 合规仍为 52 包 / 830 文件，closure `667da495556a76100d4a0530a3ce655882ae3fedf37548436aa3f30c8a522dc6`。
- 隔离源码 UI 证据位于 `docs/验收证据-v0.11-项目工作台-2026-09-02/`，完整记录为 `docs/验收记录-v0.11-项目工作台-批次1至4-2026-09-02.md`；两者均命中 `.git/info/exclude`。本批没有构建 v0.11 包、没有触碰正式安装、没有推送/PR/tag/Release，也没有程序化录屏；3 张 PNG 不能代替方案要求的 PR/录屏或 SGD 人工验收。

## v0.11 批次 5（2026-09-02，Codex）：源码实现完成，alpha 发布链收口中

- **终端窗格**：PTY 只由 Host 创建，以 Host 回读的项目根为 cwd，只传入环境白名单；open/read/write/SIGINT/close 使用与项目、窗格、Host、控制器、页面、选择和后端代次绑定的能力令牌，并在每次操作时重新校验。页面不接收 cwd、绝对路径、环境、shell 或 pid，输出先清控制序列再按私有缓冲上限分页。该接口不是 OS 文件系统或网络沙箱，命令仍能使用当前登录用户原有权限。
- **皮肤、旁车和跨机认领**：模板皮肤只把七个受校验的颜色值投影到鲸坞窗格，不执行包内代码；registry 继续是默认身份源，只有用户显式点击才写 `.whaledock/project.json`，旁车仅保存项目身份、名称、图标和模板，不含对话或绝对路径；选择已有文件夹后可按旁车 id 重新认领。
- **受限分离窗**：Markdown、文本、图片、浏览器地址等窗格可从当前项目分离查看；子窗保持 sandbox/context isolation、拒绝导航/弹窗/下载/权限和任意网络，HTML 只按文本显示，图片只接受校验过头部的 PNG/JPEG data URL。终端不以静态分离窗伪装成可交互终端。
- **控制室 recent 摘要**：近况来自 Host 已观察的用户/助手事件流，先做控制字符、URL、邮箱、路径、凭据形态与长度脱敏，再随控制室安全快照下发；不调用 `face.history`，不把完整历史交给页面。
- 源码版本已准备为 `0.11.0-alpha.1`，定位是给 SGD 真机验收的 prerelease；不得提前写成新的 `releases/latest` 或稳定版。当前文档不把尚未完成的 CI、签名、公证、正式安装替换和公开预发布上传记为通过。
- 批次 5 加入后的统一 `npm run smoke` 实跑 **1054 PASS / 56 个 ALL PASS 标记**，末行 `ALL PASS`；context-poc 固定包为 **15 文件 / 1,063,154 B**，digest `9a820510e6c63518a813c3dcd2c783cb662caed265c43db634fd3f293bbaa247`。App runtime 合规为 52 包 / 830 文件，closure `667da495556a76100d4a0530a3ce655882ae3fedf37548436aa3f30c8a522dc6`。

## v0.10.0 已公开发布与本机收口

- 合并与自动证据：发版 PR [#24](https://github.com/sgd-shine/whaledock/pull/24) 以 merge commit `1afcaa58d48029b2ae0322db8cd0a449a737b9c0` 进入 main；[PR CI 33266553784](https://github.com/sgd-shine/whaledock/actions/runs/33266553784) 与 [main CI 33266635690](https://github.com/sgd-shine/whaledock/actions/runs/33266635690) 均为 macOS、Ubuntu、Windows 全绿。正式版本地 smoke 为 **860 PASS / 44 个 ALL PASS**，末行 `ALL PASS`。
- tag 与发布：注解 tag `v0.10.0` 的 tag object `5162cc18991d8657585f4d880dc50ecfb76c5c21` 解引用到上述 merge commit。[Release run 33266723269](https://github.com/sgd-shine/whaledock/actions/runs/33266723269) attempt 1 只在空审批门按设计 fail-closed，未提前创建 Release；attempt 2 的 [publish job 99215920691](https://github.com/sgd-shine/whaledock/actions/runs/33266723269/job/99215920691) 成功。
- 公开状态：[v0.10.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.10.0) 已回读为 `releases/latest`、非 draft、非 prerelease，共 8 项资产。精确审批变量已删除，仓库变量数量回读为 0。
- 公开资产字节数：`WhaleDock-0.10.0-arm64.dmg` 176,876,415 B、`WhaleDock-0.10.0-arm64-mac.zip` 195,135,040 B、`WhaleDock-0.10.0-x64.dmg` 181,740,649 B、`WhaleDock-0.10.0-x64-mac.zip` 200,050,685 B、`WhaleDock-Setup-0.10.0.exe` 152,967,945 B、`WhaleDock-0.10.0-portable.exe` 152,780,107 B，另有 `SHA256SUMS-mac.txt` 376 B 与 `SHA256SUMS-win.txt` 191 B。
- macOS 发布链：arm64/x64 四项 Apple submission 均为 `Accepted`，两份 DMG 均完成 staple/validate，挂载 App 由 Gatekeeper 接受。DMG 有公证票据；安装后的裸 App 没有独立 stapled ticket，但 Gatekeeper 接受，必须继续分列报告。
- 正式本机成品：官方 arm64 公共 DMG 已从公开 Release 重新下载，安装到 `/Applications/WhaleDock.app` 并完成启动；版本/arm64、Developer ID、Hardened Runtime、Gatekeeper、固定 context **15 文件 / 810,828 B** 与 digest `16ffc4198355b93a1950965eece991d4b615d5005f63b3ab2da6933038496fb1`、内置 dsh 与根 App 两条成品合规链均通过。App / dsh runtime 占用为 `602,740 / 286,668 KiB`，`app.asar` SHA-256 为 `959947422e04f65fc237c7978471f2b62b541ae97bc92b731fcd4e2de1cf8e6f`。
- 数据与版本合同：受管数据根仍是 `userData/context-poc/v1/dsh-home`，跨后端/App 重启与工作区切换保留会话、设置、凭据、附件、存储和预设；`~/.dsh` 不读、不写、不迁移、不清理，也不自动导入，首次使用可能需要重新配置模型。布局/对话 refork 差异仍为 `42+/5-`、`19+/3-`，两条运行时合规身份继续分开。
- 更新提醒：SGD 已在官方 v0.9.1 中亲手点击「立即检查」并回复通过；日志于 `2026-08-30T06:11:52.320Z` 回读发现新版本 `0.10.0`。提示框截图没有留存，不得写成已有截图证据。
- 唯一安装边界：`/Applications` 文件系统顶层只有一个正式 `WhaleDock.app`；当前整个 `/Applications` 无法由 `mdls` 建立索引，LaunchServices 仍保留一条外置 no-index 证据归档登记，注销返回 `-10814`。因此 Spotlight/LaunchServices 完全清零未成立，系统 App 界面的唯一可见性保持 **NEEDS-HUMAN**。

## 已完成的人工作业与仍存边界

- Batch 1c 的四步 alpha 卡已由 SGD 回复通过；v0.9.1 到 v0.10.0 的线上更新提醒也已由 SGD 亲手点击通过。二者都不能外推成真实模型或正式版完整手感通过。
- Windows 仍只有 CI、公开资产与自动校验，安装器未签名且未做真机。macOS x64 的签名、公证与成品校验不等于 Intel 真机；历史 Apple Silicon + Rosetta 证据也不能代替。
- 正式 v0.10.0 尚未用真实模型完成整条创作链；完整视觉、滚动、长时间操作、真实会话与整体手感仍待人工。系统 App 界面唯一可见性也因上述索引边界保持 **NEEDS-HUMAN**。
- 后续功能从当前 main 新开独立 v0.11 分支；不得回到 v0.9.x，也不得在清理批次前擅自删除旧 worktree、已合并分支或 `docs/_to_delete/`。

## v0.11 剩余人工与授权闸门

1. 批次 2：SGD 用安装 alpha 建两个真实项目并分别绑定对话，制造一次 need 状态，确认黄灯、点卡切换与五分钟手感。
2. 批次 3：真实 Agent 在项目根生成 Markdown 与 `widget-result.json`，确认产物自动回到指定「窗口N」。
3. 批次 4：用真实 v0.10.0 用户数据升级，回读原短视频工作区只迁成一个项目且旧配置未被改写。
4. 批次 5 已获 SGD 授权并完成源码实现；仍需在安装 alpha 中检查终端边界、旁车显式写入/重新认领、原生皮肤、受限分离窗和控制室 recent 摘要的实际可见行为。
5. Windows/Intel 真机、真实模型、钥匙串/TCC 与系统 App 界面仍是独立 `NEEDS-HUMAN`；CI、签名/公证、安装与 prerelease 上传也必须以本次真实回读为准，不能由源码 smoke 或隔离 UI 代替。

## v0.9.1 历史恢复与更新提醒基线

- PR [#18](https://github.com/sgd-shine/whaledock/pull/18) 已合入 `main@670e32c1abd45f5cb355dfd6e6eeaa9ee18ff27c`；[main CI 32869008546](https://github.com/sgd-shine/whaledock/actions/runs/32869008546) 三平台全绿。
- [Release run 32869263514](https://github.com/sgd-shine/whaledock/actions/runs/32869263514) attempt 2 成功；[v0.9.1 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.9.1) 为非 draft、非 prerelease，共 8 项资产。macOS arm64 DMG/ZIP 为 176,646,943 / 194,888,771 B，x64 为 181,493,987 / 199,804,430 B，Windows Setup/portable 为 152,772,664 / 152,584,811 B。
- 官方 v0.9.1 arm64 此前已完成安装回读，并保留本地 ZIP/DMG 与 no-index App 恢复副本；它已用于真实点击「立即检查」并由日志确认发现 v0.10.0。当前 `/Applications/WhaleDock.app` 是官方 v0.10.0 arm64 正式版，v0.9.1 不再是公开稳定入口。

## v0.10 前置 P1 已合入历史

> 以下为前置 P1 当时的历史快照，其 688 PASS、旧资产字节数与 ad-hoc 包边界不是当前 Batch 1 最终值；当前值以本文顶部为准。

- 工作分支：`codex/v010-native-ui-recon`。开发前的最近可运行 P0B 为 `5e8cfa318c0d7d8fd0a58ea3b2a9254f14fcfe51`；备份分支 `codex/backup-v010-p0b-runnable-20260824`、tag `backup/v010-p0b-runnable-20260824` 与仓库外 bundle 均已验证回读到该 commit。
- 批次 0 的 stale external attach、可见 toast 与安全 remote 启动修复保持不变；旧批证据见 `docs/验收记录-v0.10-批次0修复与批次1侦察-2026-08-24.md`。
- P0A/P0B 已提交为 `eb76fbf` / `5e8cfa3`：纯 Node 上下文合同、isolated static Host/Client bridge、opaque selection、turn freeze、delivery proof 和 managed bundled rc.2 限域均通过；外部 dsh 不接管、不停止。
- P1 方案 B 只在 `WHALEDOCK_CONTEXT_POC=1`、鲸坞自行拉起、精确 bundled `0.1.1-rc.2` 时 shadow 两个 MIT 包：`ui-layout` 与 `ui-conversation`。根生产依赖未扩张，用户 `~/.dsh` 不读取、不写入、不迁移、不清理。
- 当前体验：默认“内容”态三栏显示原生 workspace 项目库、阶段面板和原生 dsh 对话；“会话”可返回原界面。零会话项目可见，第一次操作才通过官方 `connectWorkspace()` 建立会话；阶段动作只填入原生草稿，不自动发送，已有草稿拒绝覆盖。
- prompt admission 前新增 `context/preflight`；Client 等待最多 2.5 秒，Host 精确核对 page/controller/capability/revision/session/mode。未 ready 时发送被拦截、草稿保留，不产生伪 project-aware turn。
- 真实 isolated rc.2 已证明 package shadow：served layout `35,763 B`，SHA-256 与 fork 源码同为 `b942a0020abe8e3e730995c520cf63c87c928a7b339cb78ec749299475e1a542`。受控 GUI 已走完多项目无预绑定、填草稿、拒绝覆盖、preflight 拦截和 960/1024/1280 宽度。
- 定向回归为 P0B Host/Client `10/10`、资产/启动器 `8/8`、主进程 `12/12`；最终统一 `npm run smoke` 为 `688 PASS / 0 FAIL / 38 个 ALL PASS`，末行 `ALL PASS`。
- 本地 arm64 ad-hoc 测试 App 已构建并从 no-index 归档拉起；SGD 在测试入口检查后明确回复“测试通过”，因此 P1 可见界面与基础交互人工门为 `PASS`。测试实例使用独立临时 userData 和 `31990`，验收后已停止、清理；稳定安装版与 `3080` 始终保留。
- 本批 14 个隔离静态资产合计 `528,834 B`；本机 darwin/arm64 ignored runtime 约 `280 MiB`。本地 ZIP / DMG 为 `193,609,215 B` / `175,566,619 B`，归档内 `app.asar` 为 `19,577,756 B`，SHA-256 `5731ad898da481650b95876285e485f35ee2226077d06302f298a11ef87ad1d0`。这些文件沿用未升版的 0.9.0 名称，只是本分支测试包，不是公开或正式成品。
- 真实远端模型、长时间物理键盘与 13 英寸专项手感、多项目连续 queue/steer，以及 Windows/Intel 真机、Developer ID 签名、公证、正式安装版和 Release 仍需单独补证。[PR #16](https://github.com/sgd-shine/whaledock/pull/16) 已在 SGD 明确授权后通过 merge commit `585bb19` 进入 `main`；最终 PR head `29dbd13` 的 [CI 32821579972](https://github.com/sgd-shine/whaledock/actions/runs/32821579972) 与合并后的 [main CI 32823072121](https://github.com/sgd-shine/whaledock/actions/runs/32823072121) 均为 macOS、Ubuntu、Windows 全绿。本批没有打 tag 或发布。

## v0.9.0 已公开发布交接

- 功能提交为 `637c940`，发版准备 head 为 `7176330`，对应 PR [#14](https://github.com/sgd-shine/whaledock/pull/14)，最终合并提交/tag 目标为 `80009fed511a9345b0762fc564603b24d3361ff6`。本地最终统一 smoke 精确回读 **606 PASS / 31 个 ALL PASS**；[最终 PR CI 32634898329](https://github.com/sgd-shine/whaledock/actions/runs/32634898329) 与 [main CI 32634983004](https://github.com/sgd-shine/whaledock/actions/runs/32634983004) 均 Ubuntu、Windows、macOS 全绿。
- [Release run 32635087823](https://github.com/sgd-shine/whaledock/actions/runs/32635087823) attempt 2 已成功，[v0.9.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.9.0) 为非 draft、非 prerelease且有 8 项资产，`releases/latest` 已命中。首轮 publish 只因空审批变量按设计 fail-closed；精确摘要 `e1d196075c97b49d50a4ecc0695f2ea95f3e9b602996741612bcdf798237b0f9` 闭环后临时设值并只重跑 publish，成功后变量立即删除并回读不存在。
- **批次 2｜现场任务回执环**：项目动作、块动作、灵感拆条均先走目标会话与工作区预检；mismatch/unknown 默认不发送，显式选择“仍然发”才继续。提交后在灵感区、项目卡、脚本块三类锚点显示回执、运行用时和等待/完成/错误/拒绝/无法确认的诚实投影；事件未接通或投递 unknown 时不冒充完成，也不自动重试。目标文件落盘后 watcher 自动刷新，显示 30 秒“刚更新”并提供安全结果打开入口。
- **批次 3｜工作区去糊**：驾驶舱头部与普通工作台左栏显示安全工作区名称和复用 `openWorkspace` 的打开入口；首次引导和 README 解释“工作台 / 工作区 / 会话”，并明示全新用户的 `文稿（Documents）/鲸坞工作台/默认工作区`、重工作台同父目录落点。默认台/电商客服行为、主 dsh 视图隔离和运行时依赖闭包保持不变；发版准备只更新应用版本与由 lock SHA 绑定的合规身份。
- 隐私与架构边界：公开投递预检/回执不下发 `deliveryRef` / `sessionRef` / `taskKey`；renderer 不接收上游 raw rpcId、raw session/event ID、正文或 cwd 绝对路径。主 dsh `WebContentsView` 仍无 preload、无 `executeJavaScript`。未新增外部平台/网络协议或运行时依赖，只扩展鲸坞自有的窄 IPC 白名单。
- app-runtime 仍为 52 包 / 830 文件，closure SHA-256 仍是 `667da495556a76100d4a0530a3ce655882ae3fedf37548436aa3f30c8a522dc6`；0.9.0 版本更新后的根 lock SHA-256 为 `9f68b1e8c3efd3cc96fe0c06a81a03f37f4e26d3bed160d893eec1398c8cde40`。
- **受控 UI 证据已完成**：隔离源码 App 通过程序化真实 DOM 点击走完“灵感 → 选题 → 脚本 → 看到产出”，14 个实际界面状态均有 PNG/textContent 留档，关键帧 01/07/10/12/14 已目视核看并组成内部 MP4/GIF；去向预检、queued/running/completed、运行用时、“刚更新”、结果卡与脚本展开均可见。该证据锚定功能提交 `637c940`，当时应用版本字段仍为 v0.8.0；它使用独立 userData/工作区/端口和受控 dsh-compatible loopback fixture，不连接真实 dsh、模型或平台，不能当作 v0.9 成品验收。
- **官方 arm64 成品静态回读已完成**：公开 DMG SHA-256 为 `e731ea0f4e9fcb31293269a9c2cbce8a6754cfdfe696d5c2c6fd99c68e9b556b`，已安装到唯一 `/Applications/WhaleDock.app`；版本 0.9.0、arm64、Developer ID `wang jie (CS4NK76DA5)`、Hardened Runtime、DMG stapling、Gatekeeper `Notarized Developer ID`、dsh/app-runtime 两条成品 verifier 均通过。DMG 有票据，安装后的 App 本体无独立 stapled ticket，不能混写。首次启动新出现系统 `SecurityAgent` 且未产生 0.9 初始化日志；未代输或绕过钥匙串。
- **x64 Rosetta 抽查只部分完成**：公开 x64 DMG 在 Apple Silicon 上通过哈希、stapling、临时唯一安装、x86_64、Developer ID 与 Gatekeeper 回读；隔离 userData 下由 `arch -x86_64` 拉起进程，但仍停在同一 `SecurityAgent` 人工门，30 秒内没有初始化日志或 `SMOKE_OK`。只终止该精确测试进程后已恢复、复验 arm64 正式安装；因此不能写成功能启动/正常退出通过，更不是 Intel 真机。
- **仍需 SGD 人工完成**：先亲手处理钥匙串系统门，再在真实会话中复核同一剧本、cwd 不匹配默认不发、事件断开诚实降级、外部结果打开，以及视觉/滚动/手感；如要补齐 x64 Rosetta 抽查，还需在本人确认钥匙串后得到 `SMOKE_OK` 与正常退出。保持 `NEEDS-HUMAN`，不能由 smoke、CI、安装静态检查或受控 fixture 代报通过。Windows 与 Intel Mac 也仍无对应真机证据。

## v0.8.0 已公开发布结论

- 正式 tag 落在 `main@9c09ee8`；[main CI 32631081067](https://github.com/sgd-shine/whaledock/actions/runs/32631081067) 三平台全绿，[Release run 32631179655](https://github.com/sgd-shine/whaledock/actions/runs/32631179655) 完成发布，[v0.8.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.8.0) 共 8 项资产。
- 官方 macOS arm64 成品已完成安装回读。Windows 仍无真机验收；Intel x64 仍只有 Apple Silicon + Rosetta/云端证据；飞书真实企业租户、手机收发与人工绑定也仍待 SGD 验收。

- SGD 明确批准“合入 dsh 与飞书代码，升生产锁，并落独立 app-runtime inventory/NOTICE/licenses/成品验证”。dsh 预合并 head 为 `05e489f5b4ff67617ed522ec2f5de542b8bd305a`；飞书原提交 `8ef005872e6b87d09eaba8ae601d132380151640` → `257b8bb60eff8ac97c18037dec03147036ef96fa` 已顺序合入，本分支对应 `e668611…` → `c444bfb…`，patch-id 一致。
- 生产 dsh 已从 `0.1.0-rc.6` 精确切换到 `0.1.1-rc.2`，仅字节精确等于旧默认的持久配置一次性迁移；`latest`、其他版本、非规范值和 custom command 不动。正式 dsh lock SHA-256 `c084af82305715116ac5bd30d586be94e0fce9e00c31db0a309c3eecdd099527`，三平台 inventory 为 449 / 449 / 448 包，合规材料 214 份，与已验证 candidate capsule 精确一致。
- 根依赖只新增精确 `@larksuiteoapi/node-sdk@1.73.0`。最终 lock 生产可达闭包为 52 包（MIT 40 / BSD-3-Clause 11 / Apache-2.0 1）、830 个源文件 / 39,607,980 B、35 份去重许可文本；全量与生产 `npm audit` 五级均 0。app-runtime inventory lock SHA-256 `b377ea28421419ee831a76ea93d01f92b45d420532a604c6f3a809b7a7aa88bf`，closure `667da495556a76100d4a0530a3ce655882ae3fedf37548436aa3f30c8a522dc6`，成品预期树 `b363e6c80bca9296e566e0accae30143e6ce02dc53a660ec706bf8c9cfac1d02`。
- dsh 与根 App 合规身份严格分开：前者仍使用根 `THIRD_PARTY_NOTICES.md` / `licenses/`，后者只使用 `compliance/app-runtime/` 并通过 `extraResources` 随包。Release 与 resume workflow 已要求 macOS `.app-bundle` / ZIP / 挂载 DMG 及 Windows unpacked / Setup / portable 同时通过两套成品 verifier。
- 本地统一 `npm run smoke` 实跑 **579 PASS / ALL PASS**。本机 arm64 已实构建 ad-hoc `.app-bundle`：dsh 随包材料与 `codesign --deep --strict` 通过。首次真实 app-runtime probe 抓到 Electron 的 ASAR `fs` 虚拟目录及 electron-builder 的 hoist/manifest 重写差异；验证器现用 `original-fs` 验归档、按 name/version 多重集对账，并将经 builder 确定性清理的 manifest 与必需运行时文件集精确绑定 inventory，缺文件或运行字段漂移均 fail-closed。成品回执 `packages=52 files=449 tree=b363e6c8…`，SDK 在 adapter 构造前后未加载，仅显式 probe 时验证 `WSClient` / `EventDispatcher`。
- 发布闭环已完成：生产切换随 `main@9c09ee8` 落地，三平台 CI、正式 tag、Release workflow、8 项资产与官方 macOS arm64 安装回读均已取得。Windows 与 Intel 真机，以及飞书真实租户/手机收发，仍是独立缺口。

## v0.7.0 已发布结论

- SGD 已完成 5 分钟人工卡并回“过”。三处体验小修与版本材料由 PR [#9](https://github.com/sgd-shine/whaledock/pull/9) 合并；注解 tag `v0.7.0` 精确指向 `310654e412af38fd0d49f575c57ad9c166d3f7c4`，对应 [main CI 32566512173](https://github.com/sgd-shine/whaledock/actions/runs/32566512173) 三平台全绿。
- 首轮 [Release run 32567142239](https://github.com/sgd-shine/whaledock/actions/runs/32567142239) 整体为 failure，但完成了 macOS 两架构 Developer ID/Hardened Runtime、四项 Apple `Accepted`、DMG staple/Gatekeeper，以及 Windows Setup/portable 和三平台 inventory。首轮 publish 在审批前发现 pending/final mac 通配合并导致 arm64 DMG 校验失败，因此没有创建 Release、没有设置变量。
- 发布冲突由 PR [#10](https://github.com/sgd-shine/whaledock/pull/10) 修复：publish 只按精确名称下载 final mac 与 Windows，新增 smoke 防回归。本地统一 smoke 为 **453 PASS / ALL PASS**，合规、YAML 与 diff check 通过；merge `3ab59a` 的 [main CI 32567814738](https://github.com/sgd-shine/whaledock/actions/runs/32567814738) 三平台全绿。
- [Resume run 32567660070](https://github.com/sgd-shine/whaledock/actions/runs/32567660070) 复用同一批签名资产和四个 submission id；六项成品校验全部 `OK`。精确发布集摘要 `96b1a95db9e05f80e9fa68a69e95fde9bbd59d3e3cd8efa84ca8ee47924b162c` 只在 attempt 2 临时授权，发布成功后变量立即删除并回读不存在。
- 正式 [v0.7.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.7.0) 非 draft、非 prerelease，`releases/latest` 已命中，共 8 项资产（6 个安装产物 + 2 份校验和）：arm64 ZIP/DMG 207,232,507 / 187,641,890 B，x64 ZIP/DMG 212,147,973 / 192,480,811 B，Windows Setup/portable 161,594,468 / 161,406,619 B，校验和 372 / 189 B。
- macOS runtime 的 ZIP 清单未压缩字节为 arm64 264,826,757 B、x64 267,672,095 B；正式 arm64 安装内 runtime 磁盘占用 359,784,448 B。Windows runtime 只有 525 包 inventory，没有解包成品或真机，体积记 `N/A`。
- 本机 v0.6.0 已真实点击“立即检查”并回读“发现新版本 0.7.0”。随后从公开 Release 重下 arm64 DMG，SHA-256 `c9ebcad88191b2e9f9af18fc93f2a0773abd93f58e46af4cccb1c87951725c15`、Developer ID、Hardened Runtime、stapler、Gatekeeper、版本/架构与安装包 `SMOKE_OK` 均通过；`/Applications/WhaleDock.app` 是 Spotlight 唯一发现项，旧 v0.6.0 在废纸篓可恢复。
- `package-lock.json`、`compliance/`、`vendor/`、`licenses/`、`THIRD_PARTY_NOTICES.md` 相对 v0.6.0 零变化；root dependencies=0，dsh 仍锁定 `0.1.0-rc.6`，无 S1。Windows 未签名/未真机，Intel 未真机，边界不变。
- `v0.7.0` tag 已落地，dsh 跟版升级线与远程批次 2 的开工条件已满足；后续状态由各自线程维护，本发版线不代报进度。

## dsh 跟版升级｜批次 0–4 历史候选证据（已进入批次 5）

- 工作树/分支：`harness-desktop-v08-dsh-upgrade`，`codex/v08-dsh-upgrade`，基线 `main@29070d5`。
- 批次 0 把升级对象刷新为 npm `latest=0.1.1-rc.2`；tarball 33,675 B，registry SHA-1 为 `1a5112369f1c46b13a6e6f21de8af5e6afd45074`，SHA-1/SHA-512 与临时下载一致。内部六门与实施卡在 `docs/验收记录-dsh跟版升级-批次0-2026-08-22.md`（已 exclude）。
- 批次 1 只改 `lib/backend.js` 与纯 Node 测试：能力阈值固定在 rc.8；npx 由精确版本或显式 `latest` 判断，bundled 由已校验 manifest 判断，system 只有界读官方 npm shim/symlink 布局与 `package.json`，不起版本子进程；未知时沿用旧参数。该版本只控制 `--no-open`，不会进入 `packageVersionProof`。
- rc.6 的 system/npx/bundled 完整命令 fixture 未变化。`0.1.1-rc.2` 的 system/npx 可生成只在 web argv 末尾多 `--no-open` 的计划；bundled 在批次 5 切生产锁前仍明确拒绝 rc.2，本批只验证同样的纯 argv planner。Windows `.cmd/.bat` 启动仍经引号、`shell:true`、`windowsHide:true`；版本识别不运行 shim；custom 分支在 PATH/版本探针之前返回。
- 批次 2 把根包 proof 收口为纯 helper：默认 expected 仍取 `DSH_CONTRACT.packageVersion` 的 rc.6；候选只有显式严格 SemVer + 进程身份逐字节 proof 才开放。prompt 与 main 托管 events 门共用；workdir host/cwd 与外部 read-only attach 不误绑根包。
- rc.2 live contract 全套已过：fresh list=0；create 后 3 条稳定元数据；host/cwd/home 加法字段、WS 只下行、raw/candidate-adapter queue、两个 completed、history 六页回填、dump-config 与退出清理都已重证。provider 是只监听 loopback 的本地 SSE stub，child 环境不继承真实凭据；3080/50213 既有 PID `53336` / `48805` 未变。
- 批次 4 tip 为 `9e6dfdb7291d417d78f7ad42d0b6cc5f1d6acde3`；本地统一 `npm run smoke` 为 **511 PASS / ALL PASS**，聚合器 9/9、持久 verifier 15/15。候选 audited lock SHA-256 为 `c084af82305715116ac5bd30d586be94e0fce9e00c31db0a309c3eecdd099527`。
- 原生 inventory 为 macOS arm64 **449**、macOS x64 **449**、Windows x64 **448** 包；跨目标去重 458 个 name@version，比现行 535 少 77。新增 19 包名全 MIT、删除 97 包名，候选 `npm audit` 五级均 0。胶囊保存 214 份许可材料、NOTICE/SOURCES、三平台原生/树/清单证据；包级 GPL/AGPL/SSPL 为 0，4 个弱 copyleft 容器及 14 个 source components 已闭合。
- [candidate CI 32580171385](https://github.com/sgd-shine/whaledock/actions/runs/32580171385) 在精确 head 上的 macOS arm64、macOS Intel x64、Windows x64 与 aggregate 四个 job 全绿。完整 artifact 为 4,883,804 B，digest `sha256:cccb510e225ee5ad5dd516c2c329525b0112a16c9bb55234ea6064b172fdab8c`；独立下载后，本机 verifier 再次回读 3 targets / 214 license files / mirror verified `PASS`。
- 候选 runtime 逻辑字节为 209,815,821 / 212,451,977 / 211,785,126 B（arm64 / x64 / Windows）。macOS 相对 v0.7 已发布 runtime ZIP 清单未压缩基线分别为 -55,010,936 B（-20.77%）与 -55,220,118 B（-20.63%）；Windows 现行解包基线、最终应用包体与安装体积均为 `N/A`，留批次 5 现场量测。
- `scripts/bundle-dsh.js` 已新增显式 manifest 驱动、fail-closed 的 candidate mode，不能写成文件未变；候选当时仍为 rc.6 的生产锁已在批次 5 切换为 rc.2，最新生产事实以本文顶部交接为准。
- 42 个文件/3,221 次 rc.6 命中已分类：旧正式合规闭包已在批次 4 的独立候选胶囊全量重生；历史/兼容测试保留；生产锁、工作台 range 与当前用户文档留批次 5 原子更新。
- 批次 3 已证明默认 JSONL `sessions/` 为 `PASS_preserved_no_migration`：rc.6 的 36 events/2 completed 在 rc.2 两次冷读中 raw/physical/adapter 均完整保留、provider 零请求；另一副本继续后旧前缀不变，连续追加 15 events，最终 51/3。rc.6 原件与 readback 副本的 `sessions` 树均未改；full DSH_HOME 的 profile/cache 链接会重投影，不在“零变化”结论内。
- opt-in SQLite 不在放行范围：schema 15→17、rc.2 无 migration。批次 5 的用户提示必须要求手动配置 SQLite 的用户先备份并保留旧 runtime；鲸坞不自动迁移、覆盖或清理。
- **S1/G1 结论已进入生产闭环**：SGD 已批准批次 5；候选锁、三平台材料与 214 份许可文本已原子升为正式 dsh 身份。安装/签名/公证/公开发布的最终 G1 仍以顶部未完成清单为准。
- 飞书原父链已回读并合入；精确 SDK dependency/lock 及独立 app-runtime 52 包合规链已基于最终 lock 落地。真实平台租户、手机收发和人工绑定仍未验收，不由源码或成品 probe 代替。
- 内部完整记录：`docs/验收记录-dsh跟版升级-批次2-2026-08-22.md`、`docs/验收记录-dsh跟版升级-批次3-2026-08-22.md`、`docs/验收记录-dsh跟版升级-批次4-2026-08-22.md`（均已 exclude）；版本化主证据位于 `compliance/candidates/dsh-0.1.1-rc.2/`，远端主证据为上述 CI run。

## v0.6.0 已发布基线

v0.6.0 工作台包、内置短视频创作台、托盘五态与叫醒阶梯已完成实现和发布。在 v0.6.0 发布时，它是公开稳定版；macOS arm64/x64 已正式签名并通过 Apple 公证。

- PR [#1](https://github.com/sgd-shine/whaledock/pull/1) 已合并。
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 正式 tag `v0.6.0` 指向 `7ae619d8b7cbad81412e098706737d7e1490b9e8`；[main CI 32413185966](https://github.com/sgd-shine/whaledock/actions/runs/32413185966) 三平台全绿。
- 源 [Release run 32413319416](https://github.com/sgd-shine/whaledock/actions/runs/32413319416) 的 macOS 签名、两架构 inventory、包内合规材料、4 项 Apple 提交和待续跑 artifact 成功；Windows 构建、inventory、包内材料、校验和与 Actions artifact 成功。
- Apple 排队超过首个 5 小时窗口后，[Resume run 32440079107](https://github.com/sgd-shine/whaledock/actions/runs/32440079107) 使用同一批成品和 submission id，4 项全部 `Accepted`；未重新构建、重新签名或重复提交 Apple。DMG 已 staple，挂载后的 App 通过 `codesign` 与 Gatekeeper。
- 公开 Release 为非 draft、非 prerelease，`releases/latest` 回读 v0.6.0，8 项资产齐全。arm64 ZIP/DMG 为 207,138,248 / 187,568,944 B，x64 ZIP/DMG 为 212,053,773 / 192,382,327 B，Windows Setup/portable 为 161,526,040 / 161,338,194 B，两份校验和为 372 / 189 B。
- v0.6.0 没有修改 `package-lock.json` 或 `compliance/`，三平台 inventory 过门且没有新增再分发包，未触发 S1。精确批准值 `release:v0.6.0:sha256:1d72764798f78f070a12277f822e04ae5bc103d381cea8bed08ec883e3091832` 只用于 publish attempt 2；Release 和 8 项资产回读后已立即删除，仓库变量不存在。
- 本机从官方 Release 重新下载 arm64 DMG，通过 SHA-256、Developer ID、Hardened Runtime、stapler、Gatekeeper 并安装启动 `/Applications/WhaleDock.app`；Spotlight 只回读这一份正式安装。替换前的旧 App 已移到废纸篓，可恢复。
- Windows 仍未签名、未真机；Intel 仍未真机，只有 Apple Silicon + Rosetta/云端 x64 证据。

2026-08-15 SGD 的发布决定已覆盖旧的 beta-first 流程：不发 beta；Windows 真机验收不再阻断发布，改为“实验性支持（未真机验证）”；Intel 只保留 Rosetta 抽查边界；在没有 S1 冲突且 G1/成品材料闭环时，Codex 获预授权临时设置精确审批值、发布并立即删除变量。

## v0.7 远程板块｜批次 1 交接（已整合 main）

### 分支与改动

- 独立 worktree `harness-desktop-v07-remote` 的 `codex/v07-remote` 已经 PR [#6](https://github.com/sgd-shine/whaledock/pull/6) 合入 `main`，merge 为 `73bb4ce`。本线从含驾驶舱 PR #3–#5 的 `main@145ac1c` 起步，没有操作 PR #2。
- 代码面：`lib/remote.js`、`lib/config.js`、`main.js`、`preload-settings.js`、`settings.html`；回归面：`test/remote-smoke.js`、`test/main-remote-smoke.js`、`test/smoke.js`。工作台包 manifest 未加远程字段，远程仍是鲸坞本体底座。
- 核心是纯 Node/零新运行时依赖，只暴露受控收/推/批与生命周期，无通用命令入口。三通道默认全关；本批不注册真实 adapter，因此零平台网络、零凭据读写。
- 设置「远程」页已有三通道开关/状态/绑定、三类 IM 内容开关和全部断开；已放入面向所有用户的图文三步自助向导框架。随身网页以同一 Wi-Fi 为默认，Tailscale 仅作可选向导，账号注册/登录/授权留给用户本人。

### 安全合同

- 首次绑定必须比对双端六位码，持久化回执+权威 readback 后才转 bound；白名单外消息静默丢弃，只累加脱敏计数。
- 确认项只调一个权威 `applyApproval`，要求真实层原子完成「pending 校验 + 既有确认机制落定」，并依 `commitId` 跨重启幂等。迟到 receipt 只允许未知转已知，不能覆盖后续权威回读。
- 每个连接代持有精确 session lease 与 disconnect receipt：未确认断开不开新代，adapter 复用句柄也要逐代断开，迟到 cleanup 不得误杀新 session。断开显式拒绝可重试，超时只等同一 raw receipt。
- 平台 lifecycle 的原始原因永不进快照/审计，只映射 `transport-error` / `remote-closed`。快照与日志不含 actor、正文、token、绑定码、路径、secret 或原始异常。

### 证据与待做

- focused 实测：`REMOTE ALL PASS (42)`、`MAIN REMOTE ALL PASS (10)`；统一 `npm run smoke` 为 **450 PASS / ALL PASS**，同时执行驾驶舱五个套件与远程两个套件。Electron 43.4.0 已在隔离 userData 的 macOS 源码态回读 `SMOKE_OK`；PR #6 的 [CI run 32561913602](https://github.com/sgd-shine/whaledock/actions/runs/32561913602) 三平台全绿。
- 内部验收记录：`docs/验收记录-远程板块-批次1-2026-08-21.md`（`.git/info/exclude`）；SGD 已在 v0.7.0 打 tag 前完成远程页、色系与对话往返人工卡并回“过”。这仍不代表真实平台 adapter 已接通。
- PR #6 这个功能批次本身没有平台凭据框、真实飞书/钉钉连接、真手机收发、HTTP 随身页、二维码、Tailscale 安装，也没有独立打包或 Release；因此本批自身没有新包与 runtime 体积可报，不否定顶部最终 v0.7.0 发布证据。
- 精确 `@larksuiteoapi/node-sdk@1.73.0` 与低层 `WSClient + EventDispatcher` 实现已进入 v0.8 整合分支。SDK 只在飞书连接路径懒加载，关闭时零 SDK 加载/零平台网络；飞书父链 `8ef005872e6b87d09eaba8ae601d132380151640` → `257b8bb60eff8ac97c18037dec03147036ef96fa` 已按顺序回读并无损合入。
- 最终根 lock 的 52 包生产闭包已重跑 audit 并生成独立 `compliance/app-runtime/` inventory/NOTICE/licenses；本机 arm64 成品 Electron probe 已核对精确 449 文件成品树、懒加载与文件哈希，未混入 dsh-runtime inventory。真实租户/手机收发与三平台全载体仍待独立证据；真实事项上线前仍须保持权威来源 ID、持久 `dedupeKey`、真实 binding 恢复路径、`AbortSignal` 与幂等有界 disconnect 合同。

## v0.7 视频平台数据舱门｜纯文档侦察线

- 内部报告 `docs/侦察-视频平台数据舱门-2026-08-21.md` 已完成：430 行、40,870 B，SHA-256 `03f8993ed4bd3bd61cb302bec761bd95c8dd6b6648a117c63d29251a14e0d9b1`。它由 `.git/info/exclude` 排除、未进入公开 `main`，与代码交付刻意分开。
- 结论是：Phase II 只继续评估抖音自有账号经正式授权的累计作品指标/评论；小红书与视频号普通短视频自动取数暂不开发；三平台同行公开页自动采集为红灯。未查到的能力不靠登录、抓取或样例数据补齐。
- 本线没有代码、网络采集、平台写入或账号动作。只有 Phase II 真正启动时，账号所有人才需完成后台字段/导出、抖音 scope/quota 与 AI 标识入口回读；当前无新增人工动作。

## v0.5 批次 13 交接（已发布）

### 已实现

- `lib/pets.js`：宠物包发现、manifest 白名单解析、单图/前缀/无前缀三条零门槛路径、缺帧回落 idle、PNG 头校验、包内 symlink 越界拒绝、逐包容错与跳过原因。纯 Node，不 require Electron，不执行包内任何内容。
- `lib/themes.js`：主题 JSON 解析、七色 token 白名单、缺色回落、坏文件跳过、CSS 变量输出。同样纯 Node、纯数据。
- `lib/events.js`：新增 `snapshot().activity`（未结束 turn 计数）与纯函数 `derivePetState` / `petTransientFor`，五态优先级与瞬时态过期均可 fixture 直测。
- `main.js`：宠物窗生命周期（透明/无边框/置顶/穿透/右键菜单/托盘子菜单）、data: URL payload、主题按页面映射注入、设置窗宠物与外观区 IPC、退出清理。
- `pet.html` / `pet.js` / `preload-pet.js`：CSP `default-src 'none'`、外置脚本、`img-src data:`，preload 只暴露 `pet:ready` / `pet:context-menu` 与两个下行事件。
- 内置资源：`assets/pets/pixel-whale`（五态）、`assets/pets/极简鲸鱼`（单图无 manifest）、`assets/themes/*.json`（四套），生成脚本 `scripts/make-pet-sprites.js`。
- 文档：`docs/宠物包制作指南.md`、`docs/主题制作指南.md`（含可直接发给画图 AI 的提示词模板）、`community-pets/`、`community-themes/` 与 README 邀请 PR。

### 证据与边界

- 本地 `npm run smoke` **233 PASS / ALL PASS**（新增 21 + 9 项）。
- macOS arm64 源码态在隔离 userData 中真实启动，日志回读宠物窗已开启且五态齐全；退出后未停止 attach 到的外部 dsh。
- **未做目视验收**：宠物动效、透明背景、拖动、鼠标穿透、右键菜单、四套主题的实际配色、战报卡片跟随主题，均只有代码与日志证据，没有人工看过。
- Windows 与 Intel 全线未真机；macOS 仍未签名未公证。宠物包热重载、多只同屏、点击查看任务详情为 P2。
- v0.5.0 已正式公开发布：[Release v0.5.0](https://github.com/sgd-shine/whaledock/releases/tag/v0.5.0)，非 draft、非 prerelease，`releases/latest` 回读为 `v0.5.0`。正式注解 tag 指向提交 `19c84a4`。
- 该提交的 main CI [31932130219](https://github.com/sgd-shine/whaledock/actions/runs/31932130219) 三平台全绿；[Release run 31932206962](https://github.com/sgd-shine/whaledock/actions/runs/31932206962) 的 build-mac / build-windows 一次通过，publish job 首次按预期被审批门 fail-closed 阻止，设置精确批准值后重跑成功。
- 八项资产与精确字节数：`SHA256SUMS-mac.txt` 372 B、`SHA256SUMS-win.txt` 189 B、`WhaleDock-0.5.0-arm64-mac.zip` 204,815,588 B、`WhaleDock-0.5.0-arm64.dmg` 185,292,092 B、`WhaleDock-0.5.0-x64-mac.zip` 207,797,528 B、`WhaleDock-0.5.0-x64.dmg` 188,209,801 B、`WhaleDock-Setup-0.5.0.exe` 161,496,107 B、`WhaleDock-0.5.0-portable.exe` 161,308,254 B。发布前已把两个 Actions artifact 下载到本地，`shasum -a 256 -c` 六项产物全部 OK。
- 三平台 vendor 闭包与包数同 v0.4 完全一致（arm64 `9f5613cb…` 526 包、x64 `928f3fd6…` 526 包、win32/x64 `47ad1d95…` 525 包），没有新增包，按预授权直接发布，未触发 S1。
- 精确批准值 `release:v0.5.0:sha256:677674676d99c3f60cf76fb44b1ba9cf7491a0141b0986d4f7a99f31393ee4e8` 只在本次 publish 期间存在；Release 与八项资产回读后立即删除，仓库变量回读 `total_count=0`。
- 未做目视验收的项全部列在 `docs/第二阶段总验收清单-2026-08-16.md`；完整遗留清单见 `docs/遗留清单-2026-08-16.md`。

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
- 匿名看板已真实显示。内部深色样张 `WhaleDock-v03-dark-test.png`：357,713 B，SHA-256 `163732dc25f4f5eea8b4acc650a3281e643b95c6d9ba9abb9af01e2fb6055600`；浅色样张 `WhaleDock-v03-light-test.png`：336,785 B，SHA-256 `dac1ebce2fef2572a5bb23211109c99c3287ec81615ee6e1785472986e9f9f40`。两张都由 GUI 保存并回读为 1080×1440。
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

## v0.3 发布时的边界（历史记录）

- macOS 包未签名、未公证；首次通常需要右键 WhaleDock → 打开。
- Windows x64 是实验性支持，**没有做 Windows 真机验证**。SmartScreen 可选择“更多信息 → 仍要运行”；问题请从设置页复制日志后提交 issue。
- Intel x64 只在 Apple Silicon + Rosetta 抽查，未做 Intel Mac 真机。
- CI / 构建成功不等于 Windows、Intel 真机通过；这些缺口不阻断本次发布，但以后也不能改写成已验证。
- Apple/Windows 签名证书与公证触发 S3，不在本次范围。

## Windows 发布后补证清单

这些项目不阻塞 v0.3.0 的已完成发布，但任何结果都必须如实记录：Setup/SmartScreen、无 Node 的内置 dsh 首启、Ctrl+Shift+H、退出进程树、半自动更新、portable、自启路径自愈、启动最小化、升级后系统只保留一个 WhaleDock 入口。

失败时提供 `%APPDATA%\WhaleDock\logs\whaledock.log`、Windows 版本、资产名与 SHA-256、最后 50 行日志、相关父子进程/PID 和截图。不得删除或整理 `%USERPROFILE%\.dsh`，先区分 WhaleDock 兼容层、安装闭包与上游 dsh 行为。

## v0.4 历史发布前清单与现存人工缺口

- v0.4 后续已完成提交/推送、三平台 CI、tag/Release 和公开资产回读；当时发布前的稳定版是 v0.3.0。
- v0.4 在不触碰真实用户会话数据的前提下补完安装版图片保存/OCR/复制降级体验；真实 prompt 提交本轮未做，不得写成已验证。
- Windows 真机按上节清单补证；Windows 仍是实验性支持，任何失败先收集日志与进程证据。
- Intel Mac 真机尚未覆盖；现有 Apple Silicon + Rosetta 与云端 x64 签名/公证证据均不是 Intel 真机。
- macOS Developer ID 签名与 Apple 公证已从 v0.6.0 起完成；Windows 签名仍待后续决定，不能由 macOS 证据代替。

## v0.7 视频驾驶舱Ⅰ期交接（源码主线，2026-08-21）

### 用户可见交付

- 内置「短视频创作台」声明 `cockpit: "video"` 后进入第一方驾驶舱；默认台、电商客服与其他未声明工作台继续走原布局。驾驶舱顶部常驻九段航道与紧凑任务摘要，下面在创作现场与完整 dsh 对话现场之间切换，并保留一键退出驾驶舱的逃生门。
- 今日、选题、脚本、拍摄、灵感、打法、发布检查、数据/复盘/素材现场均已接线。没有平台通道的数据位只显示“侦察中，未接通”，没有示意播放量、漏斗或合规结论。
- Markdown 正文支持块级建议副本、对照、采用、退回与一次撤销；Agent 只改 `00_鲸坞建议/` 下的副本，原稿写回受 hash CAS、工作区实体与目录 inode 约束。
- 全屏拍摄窗提供清单、进度环、提词速度/字号、空格暂停与 `R` 重来；收工先预览，再把记录另建到 `05_拍摄记录/`、把未确认镜头另建到 `04_素材清单/`，原 `03_口播稿/` 不改。窗口离线、sandbox、无 Node/网络/剪贴板能力。
- 灵感投递只落本地文件；链接只当文字。发布检查的 AI 状态和“本人已发布”都来自人的显式确认，不冒充平台回读或代发。
- 顶栏「鲸坞色系」可在七套内置主题和用户主题间直接切换，双色样实时预览；选择是 WhaleDock 全局主题并跨重启保留，旁边「＋」进入现有自制主题设置。工作台包自带 `theme.json` 时选择器锁定，避免半套包配色。

### 文件合同与写入边界

- 驾驶舱只扫描七个批准位置内的普通 UTF-8 `.md/.txt`，拒绝软链接，单文件 512 KiB、扫描 512 文件/4096 目录项封顶。旧稿无 front matter 也可按目录/标题/文件名只读兼容。
- 支持的 front matter 与阶段集合已经追加到 `docs/工作台包制作指南.md`。未知字段、未知原始行与 BOM/CRLF 原样保留；目标字段重复、原文变化、工作区同路径换实体或恢复冲突时 fail-closed。
- 事务 journal 绑定精确 root、父目录、target/tmp inode；temp、journal 与目录均做 durability flush。每次成功受控替换都保留可见 `WhaleDock-recovery-*.bak` 接住旧文件实体与编辑器晚写；特殊 copy-only 冲突可能留下额外恢复证据。它不是第二份正式项目，损坏副本不会自动装入目标。
- 主 dsh `WebContentsView` 继续无 preload、无 DOM 注入；`⌘K` 只切换、移动并聚焦同一个完整视图，不复制或重写 Harness。切换不 reload，因此会话上下文和未发送草稿保持；顶部「返回现场」不依赖远端页面冒泡快捷键。
- `shell:cockpit-theme` 只接受精确 `{themeId}`，仍经过可信 shell sender、mainFrame 与 file URL 校验；渲染层只收到 id/name/source/base 与安全色样 token，不收到主题路径或原始 JSON。主题目录扫描有缓存，仅显式重载失效；窗口 generation 丢弃迟到 CSS，先插入新样式再移除旧 handle，快速连切不回跳。
- 根 `dependencies` 仍为空，`lib/video-cockpit.js` 与 `lib/video-shooting.js` 为纯 Node；不读写 `~/.dsh`，不新增遥测或平台请求。

### 批次、PR 与自动证据

1. 批次 0 按 SGD 授权合并 PR [#2](https://github.com/sgd-shine/whaledock/pull/2)，merge `07cbe73`，并从当时最新 `main` 开视频线。
2. 批次 1 的驾驶舱壳由 PR [#3](https://github.com/sgd-shine/whaledock/pull/3) 合并，merge `3747812`；[CI run 32504924783](https://github.com/sgd-shine/whaledock/actions/runs/32504924783) 三平台 smoke 全绿。
3. 批次 2–6 因共享的文件状态、token/CAS 与现场路由强耦合，作为一个自洽批次由 PR [#4](https://github.com/sgd-shine/whaledock/pull/4) 合并，merge `457074c`；[CI run 32509488084](https://github.com/sgd-shine/whaledock/actions/runs/32509488084) 的 macOS、Ubuntu、Windows 三项 CI 全绿。
4. 色系批次源码态 `npm run smoke` 实跑 **451 PASS / ALL PASS**；其中驾驶舱五个子套件为 **69 项**：壳 6、主进程运行时 15、文件合同 20、拍摄状态机 16、拍摄窗 12，远程套件为 42＋10 项。`git diff --check`、相关 JS `node --check` 与 runtime dependencies=0 均通过。
5. 安全只读复核最终为 **P0=0、P1=0**。仍保留 P2 证据边界：没有 Windows 真机/断电子进程崩溃测试，copy-only 异常卷可能留下上述可见恢复副本。

### 当前证据边界与已发布状态

- v0.7.0 已完成 package version、tag、签名、公证、Release、资产体积与本机官方 arm64 安装；精确证据见本文件顶部。源码态验收与安装/发布证据仍分开保留，不能用其中一类替代另一类。
- macOS Apple Silicon 的隔离源码 App 已经通过 Chromium 调试通道真实触发 DOM 点击并回读本地文件：进出驾驶舱、选题写回、灵感纯本地投递、脚本对照/采用/撤销、发布 AI 硬灯、提词 `Space`/`R` 与两阶段收工、默认台/电商客服旧布局均走通。测试只连接 loopback 假 dsh，未接生产配置、`~/.dsh` 或 `/Applications/WhaleDock.app`；截图与逐项回读在内部验收记录。
- SGD 已亲自通过基本操作、快捷键和工作台展开方式；唯一退回项是窄侧栏令 Harness 对话信息看不全。当前修订已移除该窄栏：顶部摘要不变，下面的完整 Harness 以全宽对话现场呈现，按钮和 `⌘K` 均可往返。
- 隔离源码 App 已用本地假 dsh 真点击验证全宽打开、按钮返回、dsh 获焦、`⌘K` 双向切换，以及未发送草稿在往返后仍存在；验收草稿随后已清空、未发送。Windows 当前只有 CI，不能写成真机 UI/dsh 通过；Intel Mac 仍无真机证据。
- 色系批次在 macOS Apple Silicon 隔离 userData 的源码 App 中真实切换潮汐靛蓝与日落珊瑚，并在重启后回读日落珊瑚仍被选中、整套鲸坞变量真实生效；`960×620` 与 `1280×820` 的现场、全宽对话及「＋」设置入口均通过。该源码态证据本身不覆盖 Windows/Intel；v0.7 安装包、签名、公证、tag 与 Release 另由顶部发布证据闭环。Harness 内容区仍由 dsh 自身决定外观。
