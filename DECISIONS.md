# DECISIONS.md — 决策记录

## 2026-08-14 · 立项与首版实现（Claude）

**D1 · 选 Electron 43，弃 Tauri / Pake / 自研 UI。** 项目所有者不写代码：Electron 只要求 Node（跑 Harness 本来就要装），Tauri 需要 Rust + Xcode 工具链；Pake 无法托管后端进程；headless/JSON-RPC 自研 UI 工作量以周计，列为远期。代价：包体 100MB+，可接受。

**D2 · 后端"先探测后启动"。** 启动时先 TCP 探测端口：已有服务→直接接入；没有→自动 spawn。真正的外部服务按 attach 处理，退出时不杀；若端口由 WhaleDock 仍持有的存活子进程打开，则保留 spawned ownership，退出时继续清理。避免与用户手动启动的服务打架，也避免重试竞态把自己的进程误当外部服务而漏清理。

**D3 · dsh 以独立进程组启动（detached），退出对整组 SIGTERM，4 秒后 SIGKILL。** npx → dsh → 内部子进程是一棵树，只杀直接子进程会留孤儿。

**D4 · PATH 主动发现。** Finder 启动的 GUI 拿不到终端 PATH（Homebrew/nvm 的 node 不可见），`lib/backend.js` 合并登录 shell PATH（-ilc/-lc，4 秒超时）+ 常见安装目录。这是本项目最容易在真机翻车的点，列为验收重点。

**D5 · 零运行时依赖；`lib/` 三模块禁止依赖 Electron。** 保证 `npm run smoke` 用纯 Node 就能测核心逻辑，也把对 dsh 的全部假设收敛在 backend/config 两处。

**D6 · 仅 macOS arm64、不签名。** 所有者机器是 Apple Silicon；签名公证需 $99/年 开发者账号，v0.1 用"右键→打开"方案并写入文档。CI 用 `CSC_IDENTITY_AUTO_DISCOVERY=false` 免证书构建。

**D7 · `提示词-给Codex.md` 放项目根但加入 .gitignore。** 本地随手可用，公开仓库不带协作元信息。

**D8 · v0.1.0 图标原创几何设计（H + 连接件母题，已由 D10 替代）。** 不使用 DeepSeek 鲸鱼 logo 与官方素材，规避商标风险；命名与 README 明示 Unofficial。

**D9 · 本地打包也显式关闭签名身份自动发现。** 真机首次运行 `npm run dist` 时 electron-builder 自动选中了 Keychain 里的无关本地开发身份，既偏离 v0.1 未签名边界，也让产物不可复现；因此 `dist` 命令固定使用 `CSC_IDENTITY_AUTO_DISCOVERY=false`，与 CI 策略一致。

## 2026-08-14 · 改名与版本锁（SGD 决策，Claude 执行）

**D10 · 产品更名"鲸坞 WhaleDock"。** 原名 Harness Desktop 两头翻车：社区竞品已占用"DSH Desktop"（连 dshdesktop.com 都有），Harness 又是 DevOps 公司 harness.io 的商标词。命名策略：主名独特有故事（坞=给本地跑的鲸鱼一个靠岸处），搜索流量交给仓库描述与 topics（deepseek-harness、dsh 等）。候选项鲸坞/马镫 Stirrup/缰绳 Reins/小白鲸 Beluga，SGD 定鲸坞。图标同步换为原创"鲸鱼+坞"几何设计，继续不使用 DeepSeek 官方素材。旧配置目录首启自动迁移 config.json。

**D11 · npx 回退路径锁定 dsh 版本（config.dshVersion，默认 0.1.0-rc.6）。** 原实现 `npx -y @deepseek-ai/dsh` 永远拉最新版，上游 rc 阶段明示可能破坏兼容——等于把所有用户的可用性押在上游每一次发版上。默认锁定已验证版本，用户可设 `latest` 跟随；全局安装的 dsh 不受影响。升级路径：真机验证新 rc 后改默认值发新版本。

**D12 · 隐藏窗口时后端退出采用有上限自愈。** 主窗口可见时继续让用户决定是否重启；窗口隐藏时按 1/2/4 秒最多尝试三次，成功后只重载隐藏窗口，不抢焦点，全部失败后发系统通知。未签名 macOS 构建若 Notification 投递失败，必须记录失败并回退错误对话框，不能静默。

## 2026-08-22 · v0.8 dsh 晋升与飞书运行时（SGD 批准，Codex 执行）

**D13 · 经六门侦察把默认 dsh 从 `0.1.0-rc.6` 晋升到 `0.1.1-rc.2`。** 生产只接受已核验的精确 lock、三平台原生 inventory、NOTICE/SOURCES 与 214 份许可材料；若 npm `latest` 在发版前漂移，不自动追新，停止并重走侦察。旧配置只有字节精确等于历史默认 rc.6 时一次性迁移，`latest`、其他版本、自定义命令和非规范值全部保留。dsh 自有 SQLite schema 15→17 由上游负责，鲸坞仍不读写、迁移或清理 `~/.dsh`。

**D14 · 为飞书低层长连接批准唯一根运行时依赖例外。** `@larksuiteoapi/node-sdk` 精确锁定 `1.73.0`，只使用 `WSClient` 与 `EventDispatcher`，仅在用户启用并连接飞书时惰性加载；关闭态必须零 SDK 加载、零平台网络。该 52 包生产闭包使用独立 `compliance/app-runtime/` inventory、NOTICE、内容哈希许可原文和成品 verifier，不得混入 `vendor/dsh-runtime` 的 inventory/NOTICE/licenses。以后新增或升级根运行时依赖必须重新通过同一 fail-closed 合规门。

## 2026-09-02 · v0.11 以 dsh-worktable 为标杆重定产品模型（SGD 已拍板，Codex 执行）

**D15 · 产品主语改为「项目（含文件夹）→ 绑定对话 → 窗口N → 产物回到窗口」，走路线 B。** 标杆 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable)（MIT）在“多 Agent 项目工作台”上的四个模型（项目一等对象并绑定会话、控制室回答“谁在干活哪里等我”、布局只是容器、产物回到工作处）是差距所在。不采用其代码：服务端文件路由不限项目根、终端继承全部环境、硬读 `~/.dsh`、localStorage 单点、DOM 探测挤压、无 CI、macOS 未验证，均与硬性约束冲突。在鲸坞私有插件 + `whaledock.content-shell/v1` seam 上重建，项目状态落 `userData/projects/registry.json`（`lib/projects.js`），控制室由 `lib/control-room.js` 纯函数镜像 rc.2 会话快照。SGD 已明确选择“是”：用“桌面智能体随时插入不同项目”替代总纲第 3 层“视频驾驶舱版”完成态；同时按 Claude 推荐推翻 D8 一半，保留零概念首次路径，并让项目抽屉作为切换入口回归。首批项目与会话保持 1:1，控制室独立采用作用域内的暗色蓝图视觉。依据见 `docs/审计-以dsh-worktable为标杆的项目审计-Claude-2026-09-02.md`。

**D16 · 项目身份采用 app-owned registry 为主、旁车可选（A2.1 §5 二选一，SGD 已拍板）。** `proj_` + 32 hex 随机 id，永不由路径派生；默认不在用户文件夹写任何文件；用户显式选择后写 `.whaledock/project.json`，跨机器或搬家后按旁车 id 重新认领。改名、换文件夹、移动都不改 id。

**D17 · 批次 5 采用 Host 限权能力，不宣称 OS 级沙箱（SGD 已授权执行）。** 项目终端由 Host 创建 PTY，cwd 取 Host 已校验的项目根，只传环境白名单；页面只持有与项目/窗格/Host/控制器/页面/选择/后端代次绑定的随机能力令牌，不接收 cwd、绝对路径、环境、shell 或 pid，每次操作重验身份并限制、净化输出，相关生命周期结束即失效。这个设计缩小鲸坞暴露面，但终端命令仍以当前登录用户权限运行，能读取该用户可读文件并访问系统允许的网络，不得写成文件系统或网络沙箱。模板原生皮肤继续是七色数据投影；registry 为默认、旁车只在显式操作后写入并用于跨机认领；分离窗只呈现受限本地内容；控制室 recent 只使用 Host 事件流的脱敏、截断摘要，不读取 `face.history`。`v0.11.0-alpha.1` 只作为真机验收 prerelease，不能晋升为稳定版，Windows/Intel、真实模型、钥匙串/TCC 与系统 App 界面仍各自保持 `NEEDS-HUMAN`。
