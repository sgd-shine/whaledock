# HANDOFF.md — WhaleDock v0.2 发布候选交接

更新：2026-08-15 · Codex（实现与 macOS 验证）→ SGD（合规批准、Windows/Intel 验收与发布决定）

## 交接结论

v0.2 的工程候选已完成并推送到 PR：

- PR：<https://github.com/sgd-shine/whaledock/pull/1>
- 批次 5 实现提交：`8c7080382af6b4e2bdb94f8b657bd8998b372e1b`
- 批次 5 对应 CI：<https://github.com/sgd-shine/whaledock/actions/runs/31878506184>（Ubuntu / Windows / macOS 全绿）
- `v0.2.0-beta`：尚未打 tag，尚无 Release。
- 本机安装：`/Applications/WhaleDock.app` 为 v0.2.0 arm64，当前已退出。

自动化、macOS arm64 全量与 x64 Rosetta 抽查已完成；Windows 真机、Intel 真机和公开再分发合规没有被自动化替代。

## 先处理公开发布合规门

内置 dsh 不是“零依赖”的法律例外，而是会随安装包再分发的第三方运行时闭包。当前仓库仍缺：

- SGD 对 G1 的明确批准；
- `THIRD_PARTY_NOTICES` 与完整许可证文本；
- LGPL/MPL/GPL 等条目的对应源码、替换或重链说明；
- macOS arm64、macOS x64、Windows x64 的成品 inventory 与解包验真。

因此，不要绕过 Release workflow 的审批门。仓库变量 `WHALEDOCK_BUNDLED_COMPLIANCE_APPROVAL` 只是 SGD 对**某一批精确二进制**的人工批准凭据，不会自动完成许可证审查；默认必须为空。

## beta tag：仅由 SGD 在前置条件满足后执行

前置条件：PR 已合并；main 的最终 CI 全绿；G1 与通用许可材料已闭环；远端没有同名 tag。

```bash
git fetch origin --tags
git switch main
git pull --ff-only origin main

git tag --list v0.2.0-beta
git ls-remote --tags origin refs/tags/v0.2.0-beta
# 上两条均无结果时才继续

git tag -a v0.2.0-beta -m "WhaleDock v0.2.0 beta"
git push origin refs/tags/v0.2.0-beta
```

不要 force，不要移动已有 tag。tag workflow 会把包内版本投影为 `0.2.0-beta`，并把最终 Release 标记为 prerelease，因此正式用户的 `releases/latest` 不会命中它。

## tag workflow 的预期状态

首次运行时：

1. macOS build job 生成 arm64/x64 dmg + zip + `SHA256SUMS-mac.txt`。
2. Windows build job 生成 Setup + portable + `SHA256SUMS-win.txt`。
3. 两个 build job 与 Actions artifacts 应成功。
4. publish job 会校验全部文件后计算 `release:<tag>:sha256:<digest>`。
5. 审批变量为空时，publish job **应失败**，且不创建公开 Release；日志摘要会给出本次精确批准值。

workflow 中 Actions artifacts 保留 7 天。SGD 应在时限内完成下载、验收与批准；超期后不能只重跑 publish job，需要重跑整套构建并用新的产物集哈希重新批准。

只有许可材料、平台 inventory 和双平台人工验收全部通过后，SGD 才设置该值并只重跑失败 job：

```bash
gh variable set WHALEDOCK_BUNDLED_COMPLIANCE_APPROVAL --body 'release:v0.2.0-beta:sha256:<workflow 给出的 digest>'
gh run rerun <run-id> --failed
```

确认 prerelease 创建成功后，立即清空该变量，避免误用于后续 tag：

```bash
gh variable delete WHALEDOCK_BUNDLED_COMPLIANCE_APPROVAL
```

## beta 预期资产

- `WhaleDock-0.2.0-beta-arm64.dmg`
- `WhaleDock-0.2.0-beta-arm64-mac.zip`
- `WhaleDock-0.2.0-beta-x64.dmg`
- `WhaleDock-0.2.0-beta-x64-mac.zip`
- `WhaleDock-Setup-0.2.0-beta.exe`
- `WhaleDock-0.2.0-beta-portable.exe`
- `SHA256SUMS-mac.txt`
- `SHA256SUMS-win.txt`

先用两份校验和核对下载文件，再安装。不要把本地 v0.2.0 包的哈希用于 beta 云端产物。

## macOS 已完成清单

- [x] arm64 dmg 安装到 `/Applications`，版本/架构/真实 Harness 正常。
- [x] 空 PATH + 隔离 DSH_HOME 下走包内 `dsh@0.1.0-rc.6` 冷启动。
- [x] 设置快捷键改为 `⌘⇧J`，在 Finder 前台真实呼出/隐藏，再恢复 `⌘⇧H`。
- [x] 开机自启：未签名构建被系统拒绝时，App 如实显示 actual=false；关闭后登录项真实移除。
- [x] 启动最小化：首次无启动页/主窗且后端就绪；第二实例/托盘可唤出；设置已恢复关闭。
- [x] 退出后 WhaleDock、自有 dsh 与 3080/3250 监听清零。
- [x] x64 dmg 在 Apple Silicon + Rosetta 下完成装、跑、退；此项不是 Intel 真机。
- [x] 本地假 Release/fetch 走通 macOS“稍后/跳过”提醒，不冒充线上更新。

## SGD Windows 5–10 分钟人工验收

请把结果逐项写为 PASS / FAIL，并保留资产名与日志。

1. [ ] **Setup / SmartScreen**：双击 `WhaleDock-Setup-0.2.0-beta.exe`；若拦截，选择“更多信息 → 仍要运行”；按当前用户安装，不要求管理员权限，完成后自动启动。
2. [ ] **无 Node 首启**：最好在没有 Node 的机器上测试。日志必须显示“内置 dsh@0.1.0-rc.6”；托盘出现彩色鲸鱼，主窗口进入 Harness。若失败，先收日志，不猜测性大改。
3. [ ] **全局快捷键**：在其他应用前台用 `Ctrl+Shift+H` 呼出并再次隐藏。
4. [ ] **退出清理**：从托盘选择“退出”；任务管理器中不残留 WhaleDock 托管的 node/dsh 子进程。
5. [ ] **半自动更新**：从上一测试版到一个受控的更高版本 Release，验证提醒 → 下载 → SHA-256 →“重启并更新”→ 静默安装 → 进入新版。注意固定 API 使用 `releases/latest`，GitHub prerelease 不会被返回；安排非 prerelease 测试资产前先确认不会干扰其他测试用户。
6. [ ] **portable**：把 `WhaleDock-0.2.0-beta-portable.exe` 放到固定目录（方案原清单可用桌面）后双击，内置引擎与退出清理正常。
7. [ ] **开机自启**：安装版在 Windows 启动应用中真实出现；关闭后真实移除。portable 开启后移动 exe，再手动启动一次，登录项应自愈到新路径。
8. [ ] **启动最小化**：开启后重启，不显示启动页/主窗；托盘可唤出。后端故障时仍应弹错误页。

Windows 的第 2 项是 dsh 在 Windows 的首次真机验证。失败时第一动作是取证，不是修改探测策略。

## Windows 失败取证包

请提供：

- `%APPDATA%\WhaleDock\logs\whaledock.log`（或设置页“打开日志目录/复制日志”）；
- Windows 版本、安装版/portable、完整资产文件名和 SHA-256；
- 失败前最后 50 行日志；
- 任务管理器中相关父子进程、PID、命令行与是否残留；
- 是否安装 Node、`preferBundled` 状态、端口与工作目录；
- SmartScreen/安装器/设置页错误截图。

不要删除或整理 `%USERPROFILE%\.dsh`，不要先做大范围路径重构。先判断是 WhaleDock 兼容层、安装包闭包还是上游 dsh Windows 行为。

## Intel Mac 与签名边界

- Intel Mac 真机仍待抽查：安装 x64 dmg、启动到 Harness、退出无残留。
- 当前 Mac 与 Windows 产物均未签名；Gatekeeper/SmartScreen 是已知摩擦。
- Apple 签名、公证、Windows 代码签名不在本候选中。

## 正式版决定

beta 的 Windows、Intel、许可/源码材料、成品 inventory、更新链与回归问题全部关闭后，由 SGD 决定是否打正式 `v0.2.0`。正式 tag 同样必须使用新的精确产物审批值，不能复用 beta 值。
