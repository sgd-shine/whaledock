# 鲸坞 WhaleDock

**DeepSeek Harness（dsh）非官方桌面客户端**：给鲸鱼一个靠岸的坞。双击启动，把 Harness 从浏览器标签页变成一个真正的桌面应用。

*WhaleDock is an unofficial desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It starts or attaches to the local `dsh` backend and displays its Web UI in a native Electron window.*

> ⚠️ 本项目是社区作品，与 DeepSeek 官方无关（Unofficial）。DeepSeek Harness 本体以 MIT 协议开源。本项目原名 Harness Desktop，自 v0.1.1 起更名为鲸坞 WhaleDock。

## v0.2 带来了什么

- **Windows 与双架构 Mac**：提供 Windows x64 安装器/便携版，以及 macOS arm64、x64 独立安装包
- **免装 Node**：安装包内置锁定版 dsh 运行环境；电脑没有 Node 也能启动
- **设置窗口**：可视化修改快捷键、端口、工作目录、后端版本、内置引擎优先级、开机自启、启动最小化与更新开关
- **更新提醒**：Windows 安装版可下载、校验并一键静默安装；Windows 便携版与 macOS 提醒后打开下载页
- **自动托管后端**：启动时拉起 `dsh web`，退出时清理整个进程树；若端口上已有 Harness，则直接接入
- **后台恢复**：窗口收入托盘后，托管的后端若意外退出，会按 1/2/4 秒自动重启三次
- **原生体验**：记住窗口位置与大小、全局快捷键、托盘菜单、刷新/缩放/全屏，站外链接交给系统浏览器
- **启动页与日志**：实时显示启动日志；端口上的服务不像 Harness 时先警告，不会默默接错网页

后端默认锁定 `@deepseek-ai/dsh@0.1.0-rc.6`。上游仍处于 rc 阶段，因此升级锁定版本前需要重新验证；鲸坞不会写入或清理 `~/.dsh`。

## v0.3.0 已公开发布

v0.3.0 已作为当前稳定版公开发布：[正式 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.3.0) 为非 draft、非 prerelease，`releases/latest` 已命中 v0.3 正式版（tag `v0.3.0`）。正式注解 tag 对象 `8af8f86a527a105c9dbe5a204e75afcdd9dba409` 指向提交 `fe2d4def7bb7ef1d9339b71b1e28236fd9e1eabf`；[main CI 31893926627](https://github.com/sgd-shine/whaledock/actions/runs/31893926627) 三平台全绿，[Release run 31894036652](https://github.com/sgd-shine/whaledock/actions/runs/31894036652) 的 attempt 2 publish job [95035294975](https://github.com/sgd-shine/whaledock/actions/runs/31894036652/job/95035294975) 已发布八项资产。

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

## 下载与安装

从 [GitHub Releases](https://github.com/sgd-shine/whaledock/releases) 按电脑选择产物：

| 电脑 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Apple Silicon Mac | `WhaleDock-<版本>-arm64.dmg` | 打开 dmg，拖入「应用程序」 |
| Intel Mac | `WhaleDock-<版本>-x64.dmg` | 打开 dmg，拖入「应用程序」；当前仅在 Apple Silicon + Rosetta 抽查，未做 Intel 真机 |
| Windows 10/11 x64 | `WhaleDock-Setup-<版本>.exe` | 双击，按当前用户安装 |
| Windows 10/11 x64 便携使用 | `WhaleDock-<版本>-portable.exe` | 放到固定目录后直接双击；无需安装 |

安装版已经带有内置引擎，**普通用户不需要另装 Node.js，也不需要打开终端**。首次进入 Harness 后，仍需按[官方说明](https://github.com/deepseek-ai/deepseek-harness)配置所需的模型/API Key。

安装包包含第三方组件；逐包清单、源码地址与完整许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

### macOS 首次打开

当前安装包没有 Apple 签名与公证。首次打开若被 Gatekeeper 拦截，请在「应用程序」中**右键 WhaleDock → 打开 → 打开**；之后可正常双击。

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
3. PATH 中的 `npx`，并锁定 `0.1.0-rc.6`；
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
| 工作目录 | 用户主目录 | 保存后需重启后端 |
| 后端版本 | `0.1.0-rc.6` | 控制 npx 回退；内置引擎只在该值与包内版本一致时可用；保存后需重启后端 |
| 优先使用内置引擎 | 关闭 | 保存后需重启后端 |
| 自定义启动命令 | 留空 | 高级选项；保存后需重启后端 |

Windows 便携版的开机自启指向当前 exe；移动文件后，下次启动会尝试把登录项修正到新路径。为了稳定自启，建议把便携版放到固定目录，或改用安装版。macOS 未签名版若不能注册登录项，设置页会如实提示到「系统设置 → 通用 → 登录项」手动处理。

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

`npm run smoke` 是不依赖图形界面的纯 Node 测试集。当前 v0.3 源码态本地回读为 **119 PASS / ALL PASS**：基础 34 项、config 13 项、events 24 项、backend adapter 20 项、main 24 项，加 4 项统一纳入检查。这是本地纯 Node 证据；正式 tag 提交的 main CI 31893926627 另行证明 Ubuntu、Windows 与 macOS 三平台全绿。

## 常见问题

**启动很久没有进入主窗口** — 若正在走 npx 路径，首次下载 dsh 可能需要几分钟。想绕开本机 Node 环境，可在设置中启用「优先使用内置引擎」。

**端口 3080 上有服务，但提示不像 Harness** — 可能是其他程序占用了端口。优先打开设置改端口；确认确实是 Harness 时，也可以选择「仍然接入」。弱特征检查失败只提示，不会删除或停止端口上的外部进程。

**我已经在终端启动了 dsh** — 鲸坞会识别并接入已有 Harness；退出鲸坞时不会关闭这个外部服务。

**外部 dsh 达到每日预算会怎样** — v0.3 只标记超限并提醒“外部服务仍在运行”，不会停止不属于鲸坞的进程。只有鲸坞当次自己拉起且 generation/进程身份仍匹配的 managed backend 才可停止。

**Windows 退出后还有 node/dsh 进程** — 先从托盘选择「退出」，再查看设置页/日志。Windows 版用 `taskkill /T` 清理托管的进程树；若真机验收失败，第一步应复制日志定位，不要猜测性改命令。

**想跟随最新 dsh** — 可把后端版本改为 `latest`，但上游仍是 rc，可能出现破坏性变化，而且与包内锁定版本不一致时不会走内置引擎。稳定使用建议保留默认 `0.1.0-rc.6`。

## 文档

- [操作手册](docs/操作手册.md)
- [v0.2 开发方案](docs/开发方案-v0.2-2026-08-15.md)
- [v0.3 开发方案](docs/开发方案-v0.3-2026-08-15.md)
- [产品审计与路线图](docs/产品审计与路线图-2026-08-14.md)
- [AI 编码代理工程约定](AGENTS.md)

## 版本路线图

- **v0.2.0**：已发布的历史稳定版。
- **v0.3.0**：批次 11 已实现并公开发布，是当前稳定下载版；通知、真实 managed 预算停止/恢复、Windows 与 Intel 真机仍是发布后补证边界。

## License

[MIT](LICENSE) © 2026 SGD。DeepSeek Harness 归 DeepSeek 所有并以 MIT 协议开源；本项目未使用 DeepSeek 的商标与素材，「鲸坞」名称与鲸鱼图标均为原创几何设计。
