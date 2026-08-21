# macOS 安装说明 / macOS Installation / macOS インストール手順

> 这份文档可以直接整段转发给用户。三种语言内容一致。
> This document can be forwarded to users as-is. The three languages say the same thing.
> このドキュメントはそのままユーザーに転送できます。3 言語とも内容は同じです。

---

## 中文

### v0.6.0 正常安装

鲸坞 v0.6.0 的 macOS arm64/x64 安装包已用 **Developer ID Application** 正式签名，开启
Hardened Runtime，并通过 **Apple 公证**。DMG 已附加公证票据。

1. 从 [官方 v0.6.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.6.0) 下载与芯片对应的 DMG。
2. 打开 DMG，把 WhaleDock 拖到「应用程序」。
3. 双击 WhaleDock 正常启动。

不需要右键绕行、点「仍要打开」、关闭 Gatekeeper 或删除系统隔离属性。

### 如果 v0.6.0 仍提示「已损坏」

先停止安装，不要绕过系统保护。请确认文件来自官方 Release，并用
`SHA256SUMS-mac.txt` 核对 SHA-256；不一致就删除下载并重新获取。哈希一致但系统仍拒绝时，请在 GitHub 提交 issue，附 macOS 版本、芯片类型和完整报错文案。

### 旧版历史说明

v0.5.1 只有 ad-hoc 签名、未公证；v0.5.0 及更早版本完全未签名。这些历史包可能出现「已损坏」或「无法验证开发者」，不再建议日常安装。确实必须打开已安装的旧版归档时，才可在明确核对来源和哈希后执行：

```bash
xattr -dr com.apple.quarantine /Applications/WhaleDock.app
```

这是旧版归档的特例排障，不适用于 v0.6.0。

### 建议先核对下载文件

每个 Release 都带 `SHA256SUMS-mac.txt`。核对方法：

```bash
cd ~/Downloads
shasum -a 256 WhaleDock-*.dmg
```

把输出的哈希与 `SHA256SUMS-mac.txt` 里对应文件名那一行比对，一致才安装。请只从
<https://github.com/sgd-shine/whaledock/releases> 下载，不要用第三方下载站。

---

## English

### Install v0.6.0 normally

WhaleDock v0.6.0 for macOS arm64/x64 is signed with **Developer ID Application**, uses the
Hardened Runtime, and is **notarized by Apple**. The notarization ticket is stapled to the DMG.

1. Download the correct DMG from the [official v0.6.0 release](https://github.com/sgd-shine/whaledock/releases/tag/v0.6.0).
2. Open the DMG and drag WhaleDock into Applications.
3. Double-click WhaleDock to launch it normally.

Do not bypass Gatekeeper, use Open Anyway, or remove quarantine attributes for v0.6.0.

### If v0.6.0 is still reported as damaged

Stop the installation. Confirm that the file came from the official release and verify it against
`SHA256SUMS-mac.txt`. Re-download it if the hash differs. If the hash matches but macOS still rejects
the app, open a GitHub issue with your macOS version, chip type, and the complete error message.

### Legacy releases

v0.5.1 was ad-hoc signed but not notarized; v0.5.0 and earlier were unsigned. Those archived builds
may show the old damaged/unverified warnings and are no longer recommended. Only when you must open
a verified legacy archive, you may run:

```bash
xattr -dr com.apple.quarantine /Applications/WhaleDock.app
```

This legacy workaround does not apply to v0.6.0.

### Verify your download

Every release ships `SHA256SUMS-mac.txt`:

```bash
cd ~/Downloads
shasum -a 256 WhaleDock-*.dmg
```

Compare with the matching line in `SHA256SUMS-mac.txt`. Download only from
<https://github.com/sgd-shine/whaledock/releases>.

---

## 日本語

### v0.6.0 の通常インストール

WhaleDock v0.6.0 の macOS arm64/x64 版は **Developer ID Application** で正式に署名され、
Hardened Runtime が有効で、**Apple の公証済み**です。DMG には公証チケットも付加されています。

1. [公式 v0.6.0 Release](https://github.com/sgd-shine/whaledock/releases/tag/v0.6.0) から Mac に合う DMG をダウンロードします。
2. DMG を開き、WhaleDock を「アプリケーション」にドラッグします。
3. WhaleDock をダブルクリックして通常起動します。

v0.6.0 で Gatekeeper を回避したり、隔離属性を削除したりする必要はありません。

### v0.6.0 でも「壊れている」と表示される場合

インストールを中止し、システム保護を回避しないでください。公式 Release から入手したことを確認し、
`SHA256SUMS-mac.txt` で SHA-256 を照合します。一致しなければ再ダウンロードしてください。一致しても拒否される場合は、macOS 版、チップ種別、エラー全文を GitHub issue に添えてください。

### 旧バージョン

v0.5.1 は ad-hoc 署名のみで未公証、v0.5.0 以前は未署名でした。これらのアーカイブは日常利用に推奨しません。入手先とハッシュを確認した旧版をどうしても開く場合だけ、次を実行できます。

```bash
xattr -dr com.apple.quarantine /Applications/WhaleDock.app
```

この旧版用の回避策は v0.6.0 には使用しません。

### ダウンロードファイルの照合

各リリースには `SHA256SUMS-mac.txt` が同梱されています。

```bash
cd ~/Downloads
shasum -a 256 WhaleDock-*.dmg
```

出力されたハッシュを `SHA256SUMS-mac.txt` の該当行と比較してください。入手先は
<https://github.com/sgd-shine/whaledock/releases> のみをご利用ください。

---

## 开发侧记录 / For maintainers

- 根因：`CSC_IDENTITY_AUTO_DISCOVERY=false` 让 electron-builder 跳过签名，
  产物里没有 `Contents/_CodeSignature/CodeResources`。已核实 v0.5.0 的 arm64 裸包确实缺这一目录。
- 修复：`scripts/macos-codesign.js` 作为 electron-builder `afterPack` 钩子，
  按「单体 Mach-O → 嵌套 bundle → 外层 .app」的顺序逐个 `codesign --force --sign -`，
  并在结束时 fail-closed 校验包级签名存在且 `codesign --verify --strict` 通过。
- Release workflow 在打包后解压 zip 复验签名，签名不合格直接让发布失败。
- v0.6.0 已使用仓库中的六个 GitHub Secrets 完成 Developer ID 签名和 Apple 公证；所有私钥、证书与密码只在 GitHub Actions 临时环境中使用，不进仓库和 Release 资产。
- Release workflow 会在 Apple `Accepted` 后先 staple DMG，再挂载 DMG 对内层 App 执行 `codesign` 与 Gatekeeper 验证；验证失败则 fail-closed。
