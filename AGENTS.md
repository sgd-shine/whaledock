# AGENTS.md — 给 AI 编码代理的工程说明

本仓库是 **鲸坞 WhaleDock**（原名 Harness Desktop，v0.1.1 起更名）：非官方 DeepSeek Harness 桌面客户端（Electron 43）。完整设计文档在 `docs/开发方案.md`，**动手前先读它**，尤其第 7 节（当前状态）和第 8 节（工程约束与验收清单）。

## 项目状态一句话

v0.1.0 已完成 macOS 真机验证并发布。当前为 v0.1.1：改名、后端版本锁定、审计遗留修复、main push/PR CI、真机回归与安装包构建均已完成，冒烟测试为 14 项；待两项人工 UI 触发确认并重新发布。

## 常用命令

```bash
npm install        # 安装依赖（仓库带 package-lock.json）
npm run smoke      # 纯 Node 冒烟测试，14 项，必须 ALL PASS —— 每次改动后都要跑
npm start          # 启动 App（真机验证入口）
npm run dist       # 打包 .dmg / .zip 到 release/
```

调试技巧：`HARNESS_SMOKE=1 npm start` 是无头自测模式（窗口就绪打印 SMOKE_OK 自动退出）；后端日志在 `~/Library/Application Support/WhaleDock/logs/`（旧版目录为 Harness Desktop，首启会自动迁移 config.json）；配置文件在同目录 `config.json`，改 `command` 字段可强制指定后端启动命令。手动验证"接入已有服务"路径：先在终端 `npx -y @deepseek-ai/dsh@0.1.0-rc.6 web`，再 `npm start`。

## 硬性约束（违反即返工）

1. `lib/backend.js`、`lib/config.js`、`lib/log.js` **禁止 require Electron**——它们必须能被纯 Node 的 `test/smoke.js` 加载。Electron 相关逻辑只放 `main.js` / `preload.js`。
2. 不新增运行时依赖。devDependencies 保持只有 electron、electron-builder；确有必要先在汇报中说明理由。
3. 不引入遥测、统计、任何形式的网络上报。
4. 对 dsh 的假设（端口、子命令、版本、启动行为）只允许写在 `lib/backend.js` 的命令解析和 `lib/config.js` 的默认值里（含 `dshVersion` 版本锁），不得散落在业务逻辑中写死。dsh 目前是 rc 版本（0.1.0-rc.x），行为可能变化。
5. 保持 MIT 协议、"Unofficial / 非官方"定位表述、不使用 DeepSeek 商标素材；"鲸坞 / WhaleDock"名称与鲸鱼图标为原创设计。
6. 界面与文档语言是中文，代码注释中文为主；提交信息用英文。

## 已知的坑（修问题前先看这里）

- **GUI 应用拿不到终端 PATH**：Finder/Dock 启动的 App 找不到 Homebrew/nvm 的 node 是 macOS 经典问题，`lib/backend.js` 的 `fullPath()` 已处理（登录 shell + 常见目录合并）。如果真机上仍找不到，优先扩展 `fullPath()` 的目录列表，不要改成写死路径。
- **首次启动很慢**：走 npx 路径要现场下载 Harness 组件，可能几分钟，这不是 bug；等待超时已设 5 分钟。
- **端口已被占用**：是特性不是 bug——探测到 3080 有服务就直接接入（attach 模式），退出时不杀它。
- **加载页面偶发失败**：端口 TCP 通了但 HTTP 层未就绪的窗口期，`did-fail-load` 已带 6 次自动重试。
- 打包产物未签名，安装后首次启动必须**右键 → 打开**，否则 Gatekeeper 拦截；这是预期行为。

## 汇报要求

每完成一个阶段（见任务提示词）用几句话汇报：做了什么、发现什么问题、怎么修的、smoke 是否仍全过。最终交付：改动文件清单 + 验收清单（方案第 8 节）逐项勾选结果 + 遗留问题。
