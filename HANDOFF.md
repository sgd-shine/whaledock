# HANDOFF.md — WhaleDock v0.9.0 体验流畅度批次 2/3 交接

更新：2026-08-23 · v0.8.0 已公开发布；v0.9.0 当前在 PR #14 收口（功能提交 `637c940`），自动证据已通过，人工体验仍为 `NEEDS-HUMAN`

## v0.9.0 当前交接

- 功能提交为 `637c940`，对应 PR [#14](https://github.com/sgd-shine/whaledock/pull/14)。0.9.0 版本号、发布说明与 app-runtime 合规身份冻结后的发版准备工作树已本地精确回读 **606 PASS / 31 个 ALL PASS**；功能 head 的首轮三平台 [CI run 32633856103](https://github.com/sgd-shine/whaledock/actions/runs/32633856103) 全绿，最终 PR head 与 main CI 仍待精确回读。
- **批次 2｜现场任务回执环**：项目动作、块动作、灵感拆条均先走目标会话与工作区预检；mismatch/unknown 默认不发送，显式选择“仍然发”才继续。提交后在灵感区、项目卡、脚本块三类锚点显示回执、运行用时和等待/完成/错误/拒绝/无法确认的诚实投影；事件未接通或投递 unknown 时不冒充完成，也不自动重试。目标文件落盘后 watcher 自动刷新，显示 30 秒“刚更新”并提供安全结果打开入口。
- **批次 3｜工作区去糊**：驾驶舱头部与普通工作台左栏显示安全工作区名称和复用 `openWorkspace` 的打开入口；首次引导和 README 解释“工作台 / 工作区 / 会话”，并明示全新用户的 `文稿（Documents）/鲸坞工作台/默认工作区`、重工作台同父目录落点。默认台/电商客服行为、主 dsh 视图隔离和运行时依赖闭包保持不变；发版准备只更新应用版本与由 lock SHA 绑定的合规身份。
- 隐私与架构边界：renderer 不接收原始 `deliveryRef` / `sessionRef` / `taskKey`，快照不带正文；主 dsh `WebContentsView` 仍无 preload、无 `executeJavaScript`，未新增协议或依赖。
- app-runtime 仍为 52 包 / 830 文件，closure SHA-256 仍是 `667da495556a76100d4a0530a3ce655882ae3fedf37548436aa3f30c8a522dc6`；0.9.0 版本更新后的根 lock SHA-256 为 `9f68b1e8c3efd3cc96fe0c06a81a03f37f4e26d3bed160d893eec1398c8cde40`。
- **受控 UI 证据已完成**：隔离源码 App 通过程序化真实 DOM 点击走完“灵感 → 选题 → 脚本 → 看到产出”，14 个实际界面状态已生成内部 MP4/GIF并逐帧核看；去向预检、queued/running/completed、运行用时、“刚更新”、结果卡与脚本展开均可见。该证据使用独立 userData/工作区/端口和受控 loopback，不连接模型或平台。
- **仍需 SGD 人工完成**：在真实会话中亲手复核同一剧本、cwd 不匹配默认不发、事件断开诚实降级，以及视觉/滚动/手感。保持 `NEEDS-HUMAN`，不能由 smoke、CI 或受控 fixture 代报通过。

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

- 路径/分支：`/Users/shine/AI工作台/02_AI项目/02_产品实验室/30_桌面App/harness-desktop-v08-dsh-upgrade`，`codex/v08-dsh-upgrade`，基线 `main@29070d5`。
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

- 独立 worktree `/Users/shine/AI工作台/02_AI项目/02_产品实验室/30_桌面App/harness-desktop-v07-remote` 的 `codex/v07-remote` 已经 PR [#6](https://github.com/sgd-shine/whaledock/pull/6) 合入 `main`，merge 为 `73bb4ce`。本线从含驾驶舱 PR #3–#5 的 `main@145ac1c` 起步，没有操作 PR #2。
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
