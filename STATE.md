# STATE.md — 鲸坞 WhaleDock 当前状态

更新：2026-08-15（v0.2 G1 闭环，正式发布执行中）

## 阶段结论

**v0.2.0 的工程实现、macOS 本地验收与公开再分发材料已经完成；当前在 PR 合并与正式 Release 阶段。**

- 开发分支：`codex/v0.2-production`
- PR：<https://github.com/sgd-shine/whaledock/pull/1>
- 批次 7 审计修复：`591f6c1`
- 批次 9 合规与构建可见性：`4e0c04c`
- 当前稳定版：`v0.1.1`；`v0.2.0` tag / Release 尚不存在。
- 2026-08-15 SGD 决定：不发 beta；Windows 以“实验性支持（未真机验证）”发布；Intel 仅保留 Rosetta 抽查边界；无 S1 且 G1/成品材料闭环后，由 Codex 执行正式发布并临时设置、随即清除精确审批变量。

Windows/Intel 真机、签名与线上更新仍是独立证据边界。它们不阻断本次发布，但不得改写为已经通过。

## v0.2 已实现

### Windows 与后端生命周期

- Windows PATH/PATHEXT、`.cmd/.bat` shell、`windowsHide`、`taskkill /T` 进程树清理与 portable 路径自愈已实现。
- `executeKillPlan` 的 4 秒宽限等待可被子进程退出打断，速退后跳过强杀；mismatch 决策页有就地显式 splash 保障。
- smoke 保留两平台 killPlan 形状，并覆盖子进程速退、Windows shim 与真实假后端生命周期。

### 免装 Node 内置引擎

- dsh 唯一版本源仍是 `lib/config.js` 的 `0.1.0-rc.6`；没有升级版本锁。
- `scripts/bundle-dsh.js` 使用审计 lock + `npm ci --ignore-scripts`，按目标 runner 原生生成 runtime，并 fail-closed 检查安装脚本闭包与原生资产。
- 默认仍优先用户自定义/系统 dsh/系统 npx；内置引擎按 `preferBundled` 策略兜底。

### 设置、更新与打包

- 中文设置窗、自启/启动最小化、快捷键、工作目录、内置引擎偏好、更新开关均已接线。
- 更新器为纯 Node、零新运行时依赖；固定 GitHub `releases/latest` 请求不带用户标识，所有触发都受 `checkUpdates` 控制。
- macOS arm64/x64 分包，Windows x64 提供 per-user NSIS Setup + portable；校验和与更新资产名精确耦合。
- macOS 构建前写 no-index 标记，完成后把裸 `WhaleDock.app` 注销并归入 `.app-archives.noindex/*.app-bundle`；历史版本由 dmg/zip/校验和保存。

### 批次 9 G1 合规材料

- 审计 lock SHA-256：`7806698906c19ac7260958a398e96606c3d7f53a3c7151ccbbef5da36a2d0c75`。
- inventory：darwin/arm64 526 包、darwin/x64 526 包、win32/x64 525 包；跨目标去重 535 包。
- 包级许可证分布：MIT 439、Apache-2.0 62、BSD-3-Clause 15、ISC 11、BSD-2-Clause 2、LGPL-3.0-or-later 2、0BSD 1、Apache+LGPL 1、Apache+LGPL+MIT 1、Python-2.0 1。
- 对运行时文本开头的 GPL/AGPL/SSPL 标题与 SPDX 指纹扫描为 0 命中；没有 S1 冲突。
- `THIRD_PARTY_NOTICES.md`、`compliance/SOURCES.json/.md`、三平台 inventory 与 236 份许可材料已入库；36/36 份 sharp/libvips 内嵌材料绑定到 inventory 与 NOTICE。
- Cairo 1.18.4 使用官方 `LGPL-2.1-only OR MPL-1.1`；sharp-libvips README 的 `MPL-2.0` 错标被保留为差异证据。
- wasm-vips commit 仍如实标为时间+版本向量推断；libnsgif 固定为 libvips 8.18.3 vendored 字节，均未夸大来源证明。

## 自动与成品验证

- 本地 `npm run smoke`：34/34，`ALL PASS`。
- `npm run compliance:verify`：SOURCES 与 THIRD_PARTY_NOTICES 确定性检查通过。
- 当前 darwin/x64 runtime inventory 回读：526 包，closure `928f3fd6cf6a876eeeff8fedb0df8d2864265279da7e7cf6636c2a03d87afdde`。
- 三目标 closure：arm64 `9f5613cb…`、x64 `928f3fd6…`、Windows `47ad1d95…`；runtime tree 分别 `4faee9c6…`、`6900f36a…`、`a3114001…`。
- 隔离未签名 x64 `electron-builder --mac dir` 实构建成功；成品回读 `PACKAGED_COMPLIANCE_VERIFIED copies=1`，NOTICE SHA-256 `3126a904…`；App 可见性 `staging=0 unexpected=0 visible=1`。临时构建已删除。
- `node --check`、Release/CI YAML 解析与 `git diff --check` 通过；根 `dependencies` 为空，devDependencies 仍只有 electron 与 electron-builder；`lib/` 无 Electron require。
- 远端 PR 的最终 head CI 尚待本轮文档提交后确认；旧 run 只证明旧 head，不用于合并判断。

## macOS 真机证据

环境：Apple Silicon arm64，macOS 26.5，Node v22.22.2，npm 10.9.7。

- arm64 dmg 已安装到 `/Applications/WhaleDock.app`，版本 0.2.0、Mach-O arm64、未签名；隔离 DSH_HOME + 空 PATH 下由包内 dsh 冷启动到真实 Harness，退出后进程与端口清零。
- 设置/快捷键/启动最小化已真机走查；未签名登录项被系统拒绝时如实回报，关闭后真实移除。
- x64 dmg 在 Apple Silicon + Rosetta 下完成安装、冷启动、`SMOKE_OK` 与退出清理；**未做 Intel 真机**。
- 本地假 Release/fetch 走通 macOS“稍后/跳过”；这不是线上 Release 证据。
- Spotlight bundle-id 当前只返回 `/Applications/WhaleDock.app`；构建归档不是安装项。

## 本地 v0.2 产物（历史候选证据）

| 产物 | 字节 | 约 MiB | SHA-256 |
| --- | ---: | ---: | --- |
| `WhaleDock-0.2.0-arm64.dmg` | 185,175,516 | 176.6 | `ecee60a0f162c6d6d3f257136f949db630b4fb2e3d3163c06492d18919772e6b` |
| `WhaleDock-0.2.0-arm64-mac.zip` | 204,186,442 | 194.7 | `c9413346e9014399fb1d5544e49189654625ac16f62e5f9d1ed5b14b112d66f1` |
| `WhaleDock-0.2.0-x64.dmg` | 188,031,380 | 179.3 | `49ec1e8f86a6561828318222cf67fd0ec6e0223253b933bb2666bd31524cc420` |
| `WhaleDock-0.2.0-x64-mac.zip` | 207,168,381 | 197.6 | `d21fccd7e624b8c05b506c42b6f90fe6765137bbd64c82143ff0689c0243abf8` |

这些本地哈希不替代即将由 GitHub Actions 生成的正式云端资产。最终 build-time darwin/x64 runtime 约 347.2 MiB；单个本地候选包均低于 500 MB。

## 尚未完成

1. PR 最终 head CI、合并与 main CI。
2. `v0.2.0` Release workflow、精确审批值、八项云端资产与 `releases/latest` 回读。
3. 本机安装版“检查更新 → 已是最新”的 GUI 回读。
4. Windows 全线真机与 Intel 真机均未做；Windows 按实验性支持发布，后续失败先取日志，不做猜测性大改。
5. macOS/Windows 签名与 Apple 公证未做，属于 S3，本次明确不执行。

详细发布顺序与证据边界见 `HANDOFF.md`。
