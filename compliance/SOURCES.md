# WhaleDock 内置 runtime 源码与重建材料

本文件给出 WhaleDock 再分发的 sharp/libvips 弱 copyleft 二进制容器、不可变源码归档、校验值和替换/重新链接路径。npm tarball 是被再分发的二进制来源，不等于对应源码。

> 重要边界：`sharp-libvips@1.3.2` 的 wasm 构建脚本读取 `wasm-vips:HEAD`，上游 SLSA 没有记录解析后的 commit。这里的 `9ff73c…` 由 workflow 时间窗口与完整版本向量唯一吻合而推断，可信度高，但不是上游 attestation。

结构化映射见 `compliance/SOURCES.json`；共覆盖 4 个弱 copyleft 二进制容器。

## 二进制容器与构建链

| 容器 | 目标 | 再分发 tarball | npm provenance | 构建配方 |
| --- | --- | --- | --- | --- |
| @img/sharp-libvips-darwin-arm64@1.3.2 | darwin/arm64 | [精确二进制](https://registry.npmjs.org/@img/sharp-libvips-darwin-arm64/-/sharp-libvips-darwin-arm64-1.3.2.tgz) | [SLSA](https://registry.npmjs.org/-/npm/v1/attestations/@img%2fsharp-libvips-darwin-arm64@1.3.2) | `sharp-libvips@1.3.2` |
| @img/sharp-libvips-darwin-x64@1.3.2 | darwin/x64 | [精确二进制](https://registry.npmjs.org/@img/sharp-libvips-darwin-x64/-/sharp-libvips-darwin-x64-1.3.2.tgz) | [SLSA](https://registry.npmjs.org/-/npm/v1/attestations/@img%2fsharp-libvips-darwin-x64@1.3.2) | `sharp-libvips@1.3.2` |
| @img/sharp-win32-x64@0.35.3 | win32/x64 | [精确二进制](https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.35.3.tgz) | [SLSA](https://registry.npmjs.org/-/npm/v1/attestations/@img%2fsharp-win32-x64@0.35.3) | `sharp@0.35.3` + `sharp-libvips@1.3.2` + `build-win64-mxe@8.18.3` |
| @img/sharp-wasm32@0.35.3 | darwin/arm64, darwin/x64, win32/x64 | [精确二进制](https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz) | [SLSA](https://registry.npmjs.org/-/npm/v1/attestations/@img%2fsharp-wasm32@0.35.3) | `sharp@0.35.3` + `sharp-libvips@1.3.2` + `wasm-vips@9ff73c569c91ded6f8d8c7570967d0dadcf0134d` |

## 不可变源码归档

| 源码 | 许可证 | SHA-256 | 获取方式 |
| --- | --- | --- | --- |
| aom@3.14.1 | BSD-2-Clause AND LicenseRef-AOM-Patent-1.0 | `44bf90dbd23e734d50e70a8c41c285193922938bd0d3bc2ee56764d181d55ef5` | [源码归档](https://storage.googleapis.com/aom-releases/libaom-3.14.1.tar.gz) |
| cairo@1.18.4 | LGPL-2.1-only OR MPL-1.1 | `445ed8208a6e4823de1226a74ca319d3600e83f6369f99b14265006599c32ccb` | [源码归档](https://cairographics.org/releases/cairo-1.18.4.tar.xz) |
| fribidi@1.0.16 | LGPL-2.1-or-later | `1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c` | [源码归档](https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz) |
| glib@2.89.0 | LGPL-2.1-or-later | `205bf5dab175de68f11e33be7bb36d4ad4c5a5097d8c0c88a8682b257b6293dc` | [源码归档](https://download.gnome.org/sources/glib/2.89/glib-2.89.0.tar.xz) |
| glib@2.89.1 | LGPL-2.1-or-later | `74447129c31afe141810f995626e8b99ab677413dae76ee3cf5a9cc6e75a486e` | [源码归档](https://download.gnome.org/sources/glib/2.89/glib-2.89.1.tar.xz) |
| libexif@0.6.26 | LGPL-2.1-or-later | `4a055ed6575e61ca46c3172be3c753cc16c9becd0f99ec71d58dd0e471476c0c` | [源码归档](https://github.com/libexif/libexif/releases/download/v0.6.26/libexif-0.6.26.tar.xz) |
| libheif@1.23.0 | LGPL-3.0-only | `4c9182b18897617182eed12ab5eb9f9d855b3aa3a736d6bdb31abc034ec7d393` | [源码归档](https://github.com/strukturag/libheif/releases/download/v1.23.0/libheif-1.23.0.tar.gz) |
| libheif@1.23.1 | LGPL-3.0-only | `0de0327f60fcd47de90d5654c6fe152232738d60d84fe084ec3e0f35e03b166a` | [源码归档](https://github.com/strukturag/libheif/releases/download/v1.23.1/libheif-1.23.1.tar.gz) |
| librsvg@2.62.3 | LGPL-2.1-or-later | `7eb449b2722a768021356f66dfee3202c229b54ed4e6a70ce40c090e97ff16f2` | [源码归档](https://download.gnome.org/sources/librsvg/2.62/librsvg-2.62.3.tar.xz) |
| librsvg@2.62.90 | LGPL-2.1-or-later | `5d108758255c225590d862d94f2591ee1f8cc976dc7b25b06eaba74f21850f08` | [源码归档](https://download.gnome.org/sources/librsvg/2.62/librsvg-2.62.90.tar.xz) |
| libvips@8.18.3 | LGPL-2.1-or-later | `f41285b61bfb495605494f074ca341f7791a1d406e2f157dcea606ef1ae1b146` | [源码归档](https://github.com/libvips/libvips/releases/download/v8.18.3/vips-8.18.3.tar.xz) |
| pango@1.57.1 | LGPL-2.0-or-later | `e65d6d117080dc3aeeb7d8b4b3b518f7383aa2e6cfce23117c623cd624764c2f` | [源码归档](https://download.gnome.org/sources/pango/1.57/pango-1.57.1.tar.xz) |
| pango@1.58.0 | LGPL-2.0-or-later | `bc5bad6213ad4886a47d1e80292fd850b64159b50db67917a43d9ea80ee2298a` | [源码归档](https://download.gnome.org/sources/pango/1.58/pango-1.58.0.tar.xz) |
| proxy-libintl@0.5 | LGPL-2.0-or-later | `4ab5af85ec6124cb526a15c58bbc0877d241807e30855779808dbf9292d861aa` | [源码归档](https://github.com/frida/proxy-libintl/archive/33934de09af6a6627eb44e310a8079df009abdbb.tar.gz) |

## 构建配方源码

| 配方 | commit | SHA-256 | 证据 |
| --- | --- | --- | --- |
| sharp-libvips@1.3.2 | `4da6d14c0d59866adfb9d8cf52bcaa53846dc4f6` | `4f438a108427ed9054c62c134c559af10522815ea42892a9ca31f655d97fc806` | [tag / provenance](https://github.com/lovell/sharp-libvips/archive/4da6d14c0d59866adfb9d8cf52bcaa53846dc4f6.tar.gz) |
| sharp@0.35.3 | `1018449164723ba0203c1beffaba0e21f7829c18` | `c9559a4ada7e98bfa0d6208a1f04f58ac8ddde466e6d7ae23fe9fd437e19047b` | [tag / provenance](https://github.com/lovell/sharp/archive/1018449164723ba0203c1beffaba0e21f7829c18.tar.gz) |
| wasm-vips@9ff73c569c91ded6f8d8c7570967d0dadcf0134d | `9ff73c569c91ded6f8d8c7570967d0dadcf0134d` | `ce1859a4e2dca584d5dd35af9de6ab9f4d3b76a0ac0027fd5b62ad8b194124b3` | [时间与版本向量推断](https://github.com/kleisauke/wasm-vips/archive/9ff73c569c91ded6f8d8c7570967d0dadcf0134d.tar.gz) |
| build-win64-mxe@8.18.3 | `bca68727eb1df12c5d2b204a13a392989d505774` | `01d63c45d5406b80c38cc4fc5e8a0630a5eeac2e45fae2c676979a4cb1d365fd` | [tag / archive](https://github.com/libvips/build-win64-mxe/archive/bca68727eb1df12c5d2b204a13a392989d505774.tar.gz) |

## 修改、替换与重新链接

1. 按上表下载源码归档并先核对 SHA-256；同时下载结构化映射中的精确 npm 构建输入。
2. macOS 原生包按 `sharp-libvips@1.3.2` 的 `build.sh`/`build/posix.sh` 重建；Windows 先按 `build-win64-mxe@8.18.3` 生成 libvips，再经 `sharp-libvips@1.3.2` 与 `sharp@0.35.3` 生成目标包。
3. wasm 包按固定候选 `wasm-vips@9ff73c…` 重建静态库，再经 `sharp-libvips@1.3.2` 与 `sharp@0.35.3` 生成 `.node.wasm`。如取得上游更精确证明，应以该证明替换候选并重新核验版本向量。
4. 在 `npm run bundle:dsh -- --platform=<platform> --arch=<arch>` 之后，把重建出的同名 `@img/...` 包目录替换到 `vendor/dsh-runtime/node_modules/`；不要再次运行 `bundle:dsh`，否则 registry 原包会覆盖修改。
5. 直接调用对应的 `electron-builder` 命令重新打包 WhaleDock。WhaleDock 自有代码为 MIT，未对这些库做源码级修改；原生 dylib/DLL 与单体 wasm 的实际 SHA-256 已锁入各目标 inventory。

许可证全文、包内原始许可/NOTICE 与 AOM 专利许可随安装包放在 `resources/compliance/licenses/`。本材料不是法律意见。
