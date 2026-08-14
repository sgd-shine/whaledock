# DECISIONS.md — 决策记录

## 2026-08-14 · 立项与首版实现（Claude）

**D1 · 选 Electron 43，弃 Tauri / Pake / 自研 UI。** 项目所有者不写代码：Electron 只要求 Node（跑 Harness 本来就要装），Tauri 需要 Rust + Xcode 工具链；Pake 无法托管后端进程；headless/JSON-RPC 自研 UI 工作量以周计，列为远期。代价：包体 100MB+，可接受。

**D2 · 后端"先探测后启动"。** 启动时先 TCP 探测端口：已有服务→直接接入（attach，退出不杀）；没有→自动 spawn（spawned，退出时清理）。避免与用户手动启动的服务打架，也是启动失败时最稳的兜底路径。

**D3 · dsh 以独立进程组启动（detached），退出对整组 SIGTERM，4 秒后 SIGKILL。** npx → dsh → 内部子进程是一棵树，只杀直接子进程会留孤儿。

**D4 · PATH 主动发现。** Finder 启动的 GUI 拿不到终端 PATH（Homebrew/nvm 的 node 不可见），`lib/backend.js` 合并登录 shell PATH（-ilc/-lc，4 秒超时）+ 常见安装目录。这是本项目最容易在真机翻车的点，列为验收重点。

**D5 · 零运行时依赖；`lib/` 三模块禁止依赖 Electron。** 保证 `npm run smoke` 用纯 Node 就能测核心逻辑，也把对 dsh 的全部假设收敛在 backend/config 两处。

**D6 · 仅 macOS arm64、不签名。** 所有者机器是 Apple Silicon；签名公证需 $99/年 开发者账号，v0.1 用"右键→打开"方案并写入文档。CI 用 `CSC_IDENTITY_AUTO_DISCOVERY=false` 免证书构建。

**D7 · `提示词-给Codex.md` 放项目根但加入 .gitignore。** 本地随手可用，公开仓库不带协作元信息。

**D8 · 图标原创几何设计（H + 连接件母题）。** 不使用 DeepSeek 鲸鱼 logo 与官方素材，规避商标风险；命名与 README 明示 Unofficial。

**D9 · 本地打包也显式关闭签名身份自动发现。** 真机首次运行 `npm run dist` 时 electron-builder 自动选中了 Keychain 里的无关本地开发身份，既偏离 v0.1 未签名边界，也让产物不可复现；因此 `dist` 命令固定使用 `CSC_IDENTITY_AUTO_DISCOVERY=false`，与 CI 策略一致。
