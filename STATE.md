# STATE.md — 鲸坞 WhaleDock 当前状态

更新：2026-08-15（v0.2 工程候选收口）

## 阶段结论

**v0.2.0 的工程实现与 macOS 本地验收已完成，尚未合并、打 beta tag 或发布。**

- 开发分支：`codex/v0.2-production`
- 批次 5 实现提交：`8c7080382af6b4e2bdb94f8b657bd8998b372e1b`
- PR：<https://github.com/sgd-shine/whaledock/pull/1>（OPEN）
- 批次 5 对应 CI：<https://github.com/sgd-shine/whaledock/actions/runs/31878506184>（Ubuntu / Windows / macOS 全绿）
- 当前稳定版：`v0.1.1`，tag 与 Release 已存在。
- `v0.2.0-beta` tag / Release 均不存在；正式发布权仍在 SGD。

这里的“工程候选完成”不等于“可公开发布”：Windows dsh 真机、Intel 真机、签名公证与内置 runtime 的再分发合规是独立门槛。

## 已实现

### 批次 0–1：仓库与 Windows 兼容层

- v0.2 方案、侦察/取舍/竞品/设计/路线图文档已入库；`docs/video-evidence/` 保持本地忽略。
- PATH 使用 `path.delimiter`；Windows 跳过 login shell，合并 NVM、Program Files、npm、Volta、Scoop、Chocolatey 常见目录。
- `execCandidates` 按 `PATHEXT` 展开；`.cmd/.bat` 使用 `shell:true`，Windows spawn 固定 `windowsHide:true`。
- `killPlan` 为纯函数：macOS 进程组 TERM → 4 秒 → KILL；Windows `taskkill /T` → 4 秒 → `/T /F`。

### 批次 2：免装 Node 内置引擎

- `scripts/bundle-dsh.js` 从 `DEFAULTS.dshVersion` 读取唯一版本源，锁定 `@deepseek-ai/dsh@0.1.0-rc.6`。
- runtime 由目标平台/架构现场生成到忽略目录 `vendor/dsh-runtime/`；manifest 记录版本、完整性、目标与宿主架构。
- build 忽略未经审核的安装脚本，并 fail-closed 校验安装脚本闭包、node-pty、ConPTY/winpty、Koffi、sharp、ripgrep 与 node-addon 原生目标资产。
- backend 由 main 注入 `execPath/resourcesPath`，用 Electron 自带 Node 与 `ELECTRON_RUN_AS_NODE=1` 启动包内 dsh；`preferBundled` 默认关闭。
- Windows x64 目标在 arm64 Mac 上完成交叉闭包校验：关键文件均为 PE x86-64。这不是 Windows 可运行证明。

### 批次 3：设置、自启与启动最小化

- 新增中文三标签设置窗与五条受限 IPC：get / apply / choose-workdir / restart-backend / check-update。
- 端口、目录、版本、命令、快捷键等按方案校验；快捷键先试注册，冲突时回滚旧值。
- 登录项读 desired/actual/error 三态；关闭会真实移除。Windows portable 使用 `PORTABLE_EXECUTABLE_FILE` 并在启动时对账路径。
- `startMinimized` 正常时不创建启动页/主窗，后端失败才显示错误；第二实例或托盘可唤出。
- attach 前做 HTML 标题弱特征检查；不匹配时由黄色提示交给用户选择，探测失败不阻塞。

### 批次 4：非遥测更新器

- `lib/update.js` 为纯 Node，无 Electron、无新依赖、无 electron-updater。
- 固定 GET GitHub `releases/latest`，只带固定 UA/Accept，不带安装 ID、设备号、配置或其他用户标识。
- 启动后约 15 秒、每 24 小时、手动三种触发全部受 `checkUpdates` 总开关控制；`skipVersion` 生效。
- SemVer 含 prerelease、平台/架构资产匹配、SHA-256、下载上限/总超时/长度核对、独占落盘与失败清理均有纯 Node 回归。
- macOS 与 Windows portable 提醒下载；Windows 安装版下载 Setup 与校验和，二次校验后才允许静默安装。

### 批次 5：打包矩阵与文档

- 版本为 `0.2.0`；Mac arm64/x64 分别生成 dmg + zip，Windows x64 生成 per-user one-click NSIS + portable。
- Release workflow 从 tag 投影包内版本；`v0.2.0-beta` 会生成 `0.2.0-beta` 资产并标记 prerelease。
- 校验和按平台生成，行内只使用 Release 资产裸文件名，并由更新器解析器反向验真。
- 构建 job 只有 `contents:read`；公开 Release 单独使用写权限，并受精确 tag + 产物集 SHA-256 的人工批准值门控。
- Windows 使用 32×32 RGBA 彩色鲸鱼托盘图，macOS 继续使用 template 图。
- README、操作手册与 AGENTS 已同步 Windows、SmartScreen、免装 Node、设置、自启/最小化、非遥测更新和平台证据边界。
- 最终 App 的 `app.asar` 已实际核对包含项目 MIT `/LICENSE`。

## 自动验证

- 本地 `npm run smoke`：31/31，`ALL PASS`。
- `node --check`：main、preload、scripts、全部 `lib/*.js` 通过。
- `git diff --check` 与 Release YAML 解析通过。
- 根 `dependencies` 为空；devDependencies 仍只有 Electron 与 electron-builder。
- `lib/backend.js`、`lib/config.js`、`lib/log.js`、`lib/update.js` 均不 require Electron。
- CI run `31878506184`：Ubuntu、Windows、macOS smoke 全绿。它证明跨平台纯 Node 合约，不证明 Windows dsh GUI/安装链已通过。

## macOS 真机证据

环境：Apple Silicon arm64，macOS 26.5，Node v22.22.2，npm 10.9.7。

- arm64 dmg 已安装到 `/Applications/WhaleDock.app`，版本 `0.2.0`、Mach-O arm64、未签名。
- 隔离 `HOME` / `DSH_HOME`、空 PATH、独立端口下，安装版由包内 dsh rc.6 冷启动到真实 Harness；退出后端口与进程树清零。
- 设置字段已走查；快捷键改为 `⌘⇧J` 后从 Finder 前台真实呼出/隐藏，再改回 `⌘⇧H`。
- 未签名 macOS 登录项注册被系统拒绝时，设置页显示 actual=false 与错误；关闭后系统登录项已清理。
- `startMinimized=true` 重启后端口就绪但 DevTools 页面目标为空；第二实例成功唤出 Harness 主窗；随后恢复为 false。
- x64 dmg 在 Apple Silicon + Rosetta 下完成安装、包内 dsh 冷启动、`SMOKE_OK` 与退出清理；二进制及关键原生模块为 x86_64。**未做 Intel 真机。**
- 本地假 Release/fetch 注入走通 macOS“稍后”与“跳过此版本”；这不是线上 Release 证据。
- 受控测试使用临时 DSH_HOME；没有直接读取、迁移或清理 `~/.dsh`。非隔离的普通 App 启动日志不纳入内置引擎证据。
- 收尾时 WhaleDock、托管 dsh、3080/3250 监听均已正常退出；v0.2.0 App 保留在 `/Applications`。

## 最终本地产物与体积

构建目录 `release/`、`vendor/` 均受 gitignore，不进入提交。

| 产物 | 字节 | 约 MiB | SHA-256 |
| --- | ---: | ---: | --- |
| `WhaleDock-0.2.0-arm64.dmg` | 185,175,516 | 176.6 | `ecee60a0f162c6d6d3f257136f949db630b4fb2e3d3163c06492d18919772e6b` |
| `WhaleDock-0.2.0-arm64-mac.zip` | 204,186,442 | 194.7 | `c9413346e9014399fb1d5544e49189654625ac16f62e5f9d1ed5b14b112d66f1` |
| `WhaleDock-0.2.0-x64.dmg` | 188,031,380 | 179.3 | `49ec1e8f86a6561828318222cf67fd0ec6e0223253b933bb2666bd31524cc420` |
| `WhaleDock-0.2.0-x64-mac.zip` | 207,168,381 | 197.6 | `d21fccd7e624b8c05b506c42b6f90fe6765137bbd64c82143ff0689c0243abf8` |

- 最终一次 build-time vendor（darwin/x64）：355,572 KiB（347.2 MiB）。
- 四个单包都低于 500 MB，没有触发暂停决策门。

## 仍未完成 / 人工与合规门

1. **公开再分发合规（阻断 Release）：** 内置 runtime 是第三方闭包；当前仓库尚无完整 THIRD_PARTY_NOTICES、GPL/LGPL/MPL 文本、Corresponding Source/替换重链说明与三平台 inventory，G1 也未获 SGD 最终批准。公开 Release 默认被 workflow 拦截。
2. **Windows 真机：** Setup、portable、无 Node 内置 dsh、彩色托盘、快捷键、开机自启/路径自愈、启动最小化、进程树清理与半自动更新均待 SGD。
3. **Intel 真机：** x64 已在 Rosetta 抽查通过，但 Intel Mac 未测。
4. **签名/公证：** macOS 与 Windows 均未签名；Gatekeeper/SmartScreen 摩擦仍在。
5. **发布候选链：** PR 未合并，beta tag 未打，Release workflow 未实际运行，线上更新链未验证。
6. Windows 验收若失败，第一动作必须收集日志与进程信息；不得猜测性大改，也不得清理用户的 dsh 数据目录。

详细下一步见 `HANDOFF.md`.
