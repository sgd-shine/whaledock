# AGENTS.md — 给 AI 编码代理的工程说明

本仓库是 **鲸坞 WhaleDock**（原名 Harness Desktop，v0.1.1 起更名）：非官方 DeepSeek Harness 桌面客户端（Electron 43）。基础设计在 `docs/开发方案.md`；v0.2 的当前方案与验收边界以 `docs/开发方案-v0.2-2026-08-15.md` 为准，动手前至少通读其第 4、6、7、8 节。

## 项目状态一句话

v0.1.1 已发布。当前开发目标为 v0.2.0：Windows x64（NSIS 安装器 + 便携版）、免装 Node 内置引擎、Intel/Apple Silicon Mac 分包、设置窗（含开机自启/启动最小化）与自研更新器。macOS 本地验证、三平台 CI、Windows/Intel 产物与人工验收必须分开报告；尤其不能把 Windows CI 构建成功写成 dsh Windows 真机已通过。正式发布权在 SGD。

## 常用命令

```bash
npm install               # 安装源码依赖（仓库带 package-lock.json）
npm run smoke             # 纯 Node 跨平台冒烟测试，v0.2 当前 31 项；必须 ALL PASS
npm start                 # 启动源码态 App（真机验证入口）
npm run bundle:dsh        # 构建目标平台的 vendor/dsh-runtime/
npm run dist:mac:arm64    # Apple Silicon dmg + zip
npm run dist:mac:x64      # Intel Mac dmg + zip
npm run dist:win          # Windows x64 NSIS Setup + portable
```

各 `dist:*` 命令必须先为目标平台/架构生成内置 dsh runtime；`vendor/` 是构建产物，不提交 Git，也不能跨平台/架构混用。GitHub Actions 的 smoke 矩阵覆盖 Ubuntu、Windows、macOS；Release workflow 的 macOS/Windows job 各自在本平台 bundle、构建并生成校验和。

调试技巧：`HARNESS_SMOKE=1 npm start` 是无头自测模式（窗口就绪打印 `SMOKE_OK` 后退出）。日志与配置位于 Electron 的 WhaleDock userData 目录：macOS 为 `~/Library/Application Support/WhaleDock/`，Windows 通常为 `%APPDATA%\WhaleDock\`。旧版 macOS `Harness Desktop/config.json` 首启会迁移。手动验证接入已有服务：先运行 `npx -y @deepseek-ai/dsh@0.1.0-rc.6 web`，再 `npm start`。

## 硬性约束（违反即返工）

1. `lib/backend.js`、`lib/config.js`、`lib/log.js`、`lib/update.js` 及今后 `lib/` 下所有模块**禁止 require Electron**；它们必须能被纯 Node 的 `test/smoke.js` 加载。Electron 相关逻辑只放 `main.js` / preload。
2. 不新增运行时依赖。devDependencies 保持只有 electron、electron-builder；不得引入 electron-updater。更新器按 v0.2 方案用纯 Node 自研。
3. 不引入遥测、统计或任何用户数据上报。唯一批准的更新请求是固定 GitHub `releases/latest` GET：只带固定 UA/Accept，不带账号、设备号、安装 ID、配置或其他用户标识；启动、定时、手动三种触发全部受 `checkUpdates` 总开关控制。
4. 对 dsh 的假设只允许写在 `lib/backend.js` 与 `lib/config.js`：包括端口、子命令、启动行为、Windows 探测目录、内置引擎 bin 相对路径和版本锁。`scripts/bundle-dsh.js` 必须读取 `DEFAULTS.dshVersion`，不得复制一份版本常量。当前锁定 `0.1.0-rc.6`，未经侦察/contract probes 不升级。
5. 永远不写入、迁移或清理 `~/.dsh`。鲸坞只管理自己的配置、日志、临时更新文件和自己拉起的进程树。
6. 保持 MIT 协议与「Unofficial / 非官方」定位；不使用 DeepSeek 商标素材。「鲸坞 / WhaleDock」名称与鲸鱼图标为原创设计。
7. 界面与用户文档用中文，代码注释中文为主；提交信息用英文。
8. 每次代码改动后运行 `npm run smoke`，必须 `ALL PASS`。本地 smoke、打包成功、真机安装、人工 UI、Windows/Intel、签名与发布合规是不同证据，不得互相替代。

## 已知的坑（修问题前先看这里）

- **macOS GUI 拿不到终端 PATH**：Finder/Dock 启动的 App 找不到 Homebrew/nvm Node 是经典问题。`lib/backend.js` 的 `fullPath()` 已合并登录 shell 与常见目录；仍失败时先采日志和小实验，再扩展目录列表，不要在业务逻辑写死路径。
- **Windows PATH 与 PATHEXT**：npm 全局命令通常是 `.cmd` 垫片。候选必须由 `execCandidates(name, 'win32', PATHEXT)` 展开；不要假设 `dsh` 是无扩展名可执行文件，也不要把 Windows 探测目录散落到 main/UI。
- **Windows `.cmd/.bat` 必须经 shell**：Node 针对 CVE-2024-27980 收紧了启动行为。只对已解析为 `.cmd/.bat` 的命令使用 `shell:true`；Windows spawn 保持 `windowsHide:true`，避免黑色控制台闪现。
- **Windows 要清理整棵进程树**：不能只杀父 PID。温和阶段用 `taskkill /PID <pid> /T`，4 秒后仍未退才用 `/T /F`；计划由纯函数 `killPlan` 生成、薄执行器执行。SGD 真机若发现残留，第一动作是收集日志与父子进程信息，不做猜测性大改。
- **Windows 便携版开机自启依赖 exe 路径**：登录项必须指向 `PORTABLE_EXECUTABLE_FILE`；移动 exe 后启动时对账并自愈。关闭自启要真实移除登录项。系统拒绝时如实回报，不能只保存配置就宣称成功。
- **Windows 产物未签名**：SmartScreen 的「更多信息 → 仍要运行」是当前预期摩擦，不得通过关闭系统安全功能绕过。Windows dsh 与半自动更新只有 SGD 真机验收后才能声称支持通过。
- **macOS 产物未签名/公证**：首次安装通常要右键 → 打开；未签名构建注册登录项可能被系统拒绝，设置页必须读取系统真实状态并提示手动处理。
- **内置 runtime 必须原生构建**：各平台 runner 现场运行 bundle；x64/arm64 不复用 `vendor/dsh-runtime/`。Electron 的 `execPath/resourcesPath` 由 main 注入 backend；`lib/` 不得为此 require Electron。
- **内置引擎是末级兜底**：默认仍先尊重用户自定义命令、系统 dsh、系统 npx；只有 `preferBundled=true` 时才把内置引擎提前。不要把「免装 Node」误写成强制忽略系统环境。
- **首次启动可能慢**：走 npx 路径时会现场下载 Harness，最长可能几分钟；内置引擎冷启动也需等待 dsh 自身就绪。用日志确认实际探测路径，不凭等待时长判断故障。
- **端口已占用可能是特性**：探测到端口服务后会做 HTML 标题弱校验；像 Harness 则 attach，不像则黄条提示并让用户选择。attach 的外部进程退出时不杀；弱校验超时本身不阻塞。
- **HTTP 就绪晚于 TCP**：`did-fail-load` 有有限次数重试。不要因为端口已监听就删除加载重试。
- **更新检查必须非遥测且可关**：固定请求 GitHub latest，不得增加机器信息、随机 ID、配置参数或分析 SDK。`checkUpdates=false` 时连手动检查也不能 fetch；用可注入 fetch 的纯 Node smoke 证明零请求。
- **更新资产名与校验和强耦合**：更新器按平台/架构精确挑选 `WhaleDock-Setup-<v>.exe` 等资产；`SHA256SUMS-*.txt` 必须记录 Release 中的裸文件名。改 electron-builder artifactName 时同步改 updater fixture/workflow，并跑 smoke。
- **beta 与正式版本号要可比较**：`v0.2.0-beta` 构建必须把应用版本写成 `0.2.0-beta`，不能内嵌成 `0.2.0`，否则 beta 用户不会收到正式 `0.2.0` 提醒。prerelease Release 不能被正式用户的 `releases/latest` 命中。
- **内置 runtime 的公开发布须 fail-closed**：Release workflow 先生成 Actions artifacts，再用 `WHALEDOCK_BUNDLED_COMPLIANCE_APPROVAL` 校验精确 tag 与产物集 SHA-256。默认为空时公开 Release 必须失败；只有 SGD 完成 G1、第三方许可/源码材料和人工验收后才能设置本次日志给出的精确值。

## v0.2 验收边界

- macOS arm64：安装版全量真机验收；
- macOS x64：Intel 真机或 Apple Silicon Rosetta 做安装、启动、退出抽查，必须单独标明环境；
- Windows：GitHub Actions 只能证明构建/自动化；Setup、便携版、内置 dsh、托盘、快捷键、进程清理、开机自启与半自动更新由 SGD Windows 真机验收；
- 更新：macOS 可用本地假 Release/fetch 注入验证提醒；不得把假数据验证写成线上 Release 已验证；
- 发布：代理只准备提交与命令，不替 SGD 打正式 tag、签名、公证或发布正式 Release。

完整双平台人工清单见 `docs/开发方案-v0.2-2026-08-15.md` 第 8 节和当前 `HANDOFF.md`。

## 汇报要求

每完成一个批次，用几句话报告：做了什么、发现什么、怎么修、`npm run smoke` 的实际通过数。最终交付必须包含：改动文件清单、方案第 8 节逐项结果、各平台/架构证据边界、包与 runtime 体积、CI/Release 链接，以及仍需 SGD 人工完成的事项。
