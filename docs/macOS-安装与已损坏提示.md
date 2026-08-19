# macOS 安装说明 / macOS Installation / macOS インストール手順

> 这份文档可以直接整段转发给用户。三种语言内容一致。
> This document can be forwarded to users as-is. The three languages say the same thing.
> このドキュメントはそのままユーザーに転送できます。3 言語とも内容は同じです。

---

## 中文

### 为什么会提示「文件已损坏，无法打开，你应该将它移到废纸篓」

**不是文件下载损坏，也不是电脑有问题。**

- Apple Silicon（M 系列芯片）要求所有原生代码带有效的代码签名才能运行。
- 鲸坞 **v0.5.0 及更早**的安装包完全没有代码签名（打包工具在无证书时直接跳过了签名）。
- 在本机构建、本机打开不会有问题；但**从 GitHub 下载**的文件会被 macOS 打上
  `com.apple.quarantine` 隔离属性，Gatekeeper 这时会去校验包级签名，校验失败就报「已损坏」。
- 这条提示**用「右键 → 打开」是绕不过去的**（那条路只对"签了名但没公证"的 App 有效）。

### 解决办法

**办法一（推荐）：下载 v0.5.1 或更新的版本。**

从 v0.5.1 起，安装包带 ad-hoc 代码签名。首次打开的流程变成：

1. 打开 dmg，把 WhaleDock 拖进「应用程序」；
2. 双击打开，提示「无法验证开发者」→ 点「完成」；
3. 打开 **系统设置 → 隐私与安全性**，拉到最下面，点 **「仍要打开」**，再确认一次；
4. 之后正常双击即可。

> macOS 15 (Sequoia) 开始，Apple 移除了「右键 → 打开」的绕行入口，只能走系统设置。

**办法二：已经装好旧版、不想重下。** 打开「终端」，粘贴执行一次：

```bash
xattr -dr com.apple.quarantine /Applications/WhaleDock.app
```

这条命令只是移除这一个 App 的「从网上下载」标记，不改动系统设置，不影响其他软件。执行后正常双击打开。

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

### Why macOS says "the app is damaged and can't be opened. You should move it to the Trash"

**The download is not corrupted and your Mac is fine.**

- Apple Silicon requires every piece of native code to carry a valid code signature.
- WhaleDock **v0.5.0 and earlier** shipped with no code signature at all (the packaging tool skipped
  signing because no certificate was configured).
- A locally built copy runs fine. But a copy **downloaded from GitHub** gets the
  `com.apple.quarantine` attribute, so Gatekeeper validates the bundle signature — and fails.
- Right-click → Open does **not** help here. That workaround only applies to apps that are signed
  but not notarized, and macOS 15 removed it anyway.

### Fixes

**Option 1 (recommended): download v0.5.1 or later.**

From v0.5.1 the app is ad-hoc signed. First launch becomes:

1. Open the dmg and drag WhaleDock into Applications.
2. Double-click. When macOS says the developer cannot be verified, click **Done**.
3. Open **System Settings → Privacy & Security**, scroll to the bottom, click **Open Anyway**, confirm.
4. From then on it opens normally.

**Option 2: you already installed an older build.** Open Terminal and run once:

```bash
xattr -dr com.apple.quarantine /Applications/WhaleDock.app
```

This only removes the "downloaded from the internet" flag from that one app. It changes no system
setting and affects no other software.

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

### 「"WhaleDock"は壊れているため開けません。ゴミ箱に入れる必要があります。」と出る理由

**ダウンロードが壊れているわけでも、Mac に問題があるわけでもありません。**

- Apple Silicon（M シリーズ）では、すべてのネイティブコードに有効なコード署名が必要です。
- WhaleDock の **v0.5.0 以前**のパッケージにはコード署名が一切ありませんでした
  （証明書が未設定だったため、ビルドツールが署名を丸ごとスキップしていました）。
- 自分でビルドしたコピーは動きます。しかし **GitHub からダウンロード**したファイルには
  `com.apple.quarantine` 属性が付き、Gatekeeper がバンドル署名を検証して失敗するため、
  「壊れている」と表示されます。
- この表示は **「右クリック → 開く」では回避できません**。あの回避策は「署名済みだが公証なし」の
  アプリ用で、しかも macOS 15 以降は廃止されています。

### 対処方法

**方法 1（推奨）：v0.5.1 以降をダウンロードしてください。**

v0.5.1 から ad-hoc 署名が付きます。初回起動の手順は次のとおりです。

1. dmg を開き、WhaleDock を「アプリケーション」にドラッグします。
2. ダブルクリックし、「開発元を確認できません」と出たら「完了」を押します。
3. **システム設定 → プライバシーとセキュリティ** を開き、一番下までスクロールして
   **「このまま開く」** をクリックし、もう一度確認します。
4. 以降は普通にダブルクリックで起動できます。

**方法 2：すでに旧バージョンをインストール済みの場合。** ターミナルで一度だけ実行します。

```bash
xattr -dr com.apple.quarantine /Applications/WhaleDock.app
```

このコマンドは、そのアプリ 1 つから「インターネットからダウンロードした」という印を外すだけです。
システム設定は変更されず、他のソフトウェアにも影響しません。

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
- 升级为零提示（Developer ID + 公证）只需在仓库配 `MACOS_SIGN_CERTIFICATE`、
  `MACOS_SIGN_CERTIFICATE_PASSWORD`、`MACOS_SIGN_IDENTITY`、`MACOS_NOTARY_KEY`、
  `MACOS_NOTARY_KEY_ID`、`MACOS_NOTARY_ISSUER_ID` 六个 secret，workflow 会自动切换分支。
  需要 Apple Developer Program（99 美元/年）。
