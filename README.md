# 鲸坞 WhaleDock

**DeepSeek Harness (dsh) 非官方桌面客户端** — 给鲸鱼一个靠岸的坞：一键启动，把 Harness 从浏览器标签页变成一个真正的桌面应用。

*WhaleDock — unofficial desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): auto-starts the local `dsh` backend and wraps its Web UI in a native window, with tray icon and global hotkey.*

> ⚠️ 本项目是社区作品，与 DeepSeek 官方无关（Unofficial）。DeepSeek Harness 本体是 DeepSeek 开源的 AI Agent 运行框架（MIT 协议）。本项目原名 Harness Desktop，自 v0.1.1 起更名为鲸坞 WhaleDock。

## 为什么需要它

Harness 目前只提供网页界面：每次使用都要先开终端敲 `npx @deepseek-ai/dsh web`，再去浏览器里找 `127.0.0.1:3080` 那个标签页。鲸坞把这两步合成一次点击——打开 App，它自动帮你把本地 `dsh` 服务拉起来，然后用原生窗口承载整个界面。

## 功能

- **自动托管后端**：启动 App 时自动运行 `dsh web`，退出时干净地关掉整个进程组；如果检测到你已经在终端里跑了服务，会直接接入而不是重复启动
- **后台自动恢复**：窗口收进托盘后若后端意外退出，会按 1/2/4 秒自动重启三次；失败后提醒查看日志
- **后端版本锁定**：默认锁定经过验证的 dsh 版本，上游 rc 阶段的破坏性变更不会让 App 一夜变砖（可在配置中改为 `latest` 跟随最新）
- **原生窗口**：独立 Dock 图标、记住窗口位置大小、⌘R 刷新、缩放、全屏，站外链接自动跳系统浏览器
- **菜单栏托盘**：常驻菜单栏，关窗口不退出，随点随用
- **全局快捷键**：默认 `⌘⇧H` 在任何应用里一键呼出 / 隐藏
- **启动页与日志**：启动过程实时显示后端日志，出错时一键复制日志排查
- **智能找 Node**：自动兼容 Homebrew / nvm / volta 安装的 Node（GUI 应用继承不到终端 PATH 的经典坑已处理）

## 环境要求

macOS 13+（Apple Silicon），已安装 [Node.js](https://nodejs.org) 22.12 或更高版本。源码安装/构建需要 Node 22.12+（Electron 43 的要求）；安装版仍会调用系统里的 Node/npx 来运行 dsh。首次使用 Harness 需要在其界面中配置 DeepSeek API Key（见[官方仓库](https://github.com/deepseek-ai/deepseek-harness)说明）。Windows 与免装 Node 版本在 v0.2 路线图中（见 docs/）。

## 安装

**方式一：下载安装包。** 从 [Releases](https://github.com/sgd-shine/whaledock/releases) 页面下载最新的 `.dmg`，拖入「应用程序」。安装包未做 Apple 签名公证，首次打开请**右键点击 App → 打开**（只需一次）。

**方式二：源码运行。**

```bash
git clone https://github.com/sgd-shine/whaledock.git
cd whaledock
npm install
npm start
```

## 配置

配置文件在 `~/Library/Application Support/WhaleDock/config.json`（也可通过菜单「后端 → 打开配置文件」直达；从旧版 Harness Desktop 升级时会自动迁移原配置）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `3080` | Harness Web UI 端口 |
| `autoStartBackend` | `true` | 是否由 App 自动启动后端 |
| `command` | `null` | 自定义启动命令（如 `dsh web`），留空自动探测 |
| `dshVersion` | `0.1.0-rc.6` | npx 回退路径安装的 dsh 版本；设为 `latest` 跟随最新 |
| `workdir` | `null` | 后端工作目录，留空为用户主目录 |
| `hotkey` | `CommandOrControl+Shift+H` | 全局呼出快捷键 |

> 注：若配置了自定义 `command`，或自行全局安装了 `dsh`（`npm i -g @deepseek-ai/dsh`），其版本由用户维护；`dshVersion` 仅对 npx 自动回退路径生效。

## 从源码打包

```bash
npm run dist        # 产物在 release/ 目录（.dmg 和 .zip）
npm run smoke       # 纯 Node 冒烟测试，14 项断言（不需要图形界面）
```

打 tag 推送到 GitHub 会由 Actions 自动构建并发布 Release：

```bash
git tag v0.1.1 && git push origin v0.1.1
```

## 工作原理

App 启动后先探测 `127.0.0.1:3080` 是否已有服务：有则直接接入；没有则解析出可用的 `dsh`（或回退到 `npx -y @deepseek-ai/dsh@<锁定版本> web`）并作为独立进程组启动，等端口就绪后用 Electron 窗口加载界面。退出时向整个进程组发 SIGTERM 优雅关停。核心进程管理逻辑在 `lib/backend.js`，不依赖 Electron，可以用 `npm run smoke` 单独测试。

## 常见问题

**打开时提示"无法验证开发者"** — 安装包未签名（签名公证需要 Apple 开发者账号）。右键 App → 打开，之后就正常了。

**提示"找不到 Node.js / dsh"** — 去 [nodejs.org](https://nodejs.org) 下载 LTS 安装包装好，再点「重试」。

**首次启动等很久** — 第一次运行 `npx` 需要下载 Harness 组件，取决于网速，之后就快了。也可以先在终端 `npm i -g @deepseek-ai/dsh` 装好再用。

**我自己在终端里已经启动了 dsh** — 没关系，App 会检测到并直接接入，不会重复启动，退出时也不会关掉你终端里的服务。

**想用最新版 dsh** — 把配置里的 `dshVersion` 改成 `latest`（上游为 rc 阶段，新版可能有破坏性变更，出问题改回默认值即可）。

## 文档

完整设计文档见 [docs/开发方案.md](docs/开发方案.md)，从零上手的图文指南见 [docs/操作手册.md](docs/操作手册.md)，历史产品审计见 [docs/产品审计与路线图-2026-08-14.md](docs/产品审计与路线图-2026-08-14.md)，当前版本路线见 [docs/路线图定稿-2026-08-14.md](docs/路线图定稿-2026-08-14.md)，AI 编码代理的工程约定见 [AGENTS.md](AGENTS.md)。

## License

[MIT](LICENSE) © 2026 SGD。DeepSeek Harness 归 DeepSeek 所有并以 MIT 协议开源；本项目未使用 DeepSeek 的商标与素材，"鲸坞"名称与鲸鱼图标均为原创几何设计。
