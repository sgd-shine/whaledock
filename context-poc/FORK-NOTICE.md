# WhaleDock dsh UI Fork Notice

WhaleDock 再分发两个从 DeepSeek dsh `0.1.1-rc.2` 精确来源修改的 UI fork。两者均保持 MIT 许可与 DeepSeek 归属，并明确标记 `modified=true`。

这两个 fork 不计入根 App npm 生产依赖闭包的包数，也不计入 `vendor/dsh-runtime` 的独立 inventory。

## 精确来源与修改记录

| 组件 | 精确 npm tarball | tarball SHA-256 | npm integrity | patch | patch SHA-256 | 最终文件树 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-layout@0.1.1-rc.2` | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-layout/-/dsh-client-ui-layout-0.1.1-rc.2.tgz) | `42145ca99ad1e87ee35585b25697a350a9fad9a474d8c4e205f2b86a33f0a4db` | `sha512-y7xSQyQYGuahLyJcSXpB+JbH1F5lGEc3L9K8cjLy5vd/L9N6gLFLWyeGdlGxxM4jxRt1+rAHDDZ/zl7b8GC5zQ==` | `refork/dsh-ui/ui-layout.patch` | `eb88c973abeaca460cf9628a2d147e4bfe457aea2fe70bfa0e8f8c08a6e82200` | `14a4594b08b7620ba5cf411274524982bc92c9cb48aeca5c6a783e1e30e98208` |
| `@deepseek-ai/dsh-client-ui-conversation@0.1.1-rc.2` | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-conversation/-/dsh-client-ui-conversation-0.1.1-rc.2.tgz) | `9403b33b02f9d5daf564764f9a615dc5eb31cc1b449384c0a793b0bc5a9354bd` | `sha512-5PCyHw2Y7nz9geEUT23et3h2XghJm7/3iWDAKa1/4ldIfCnjfxiZ5ZNRdZ9Xxpj32tBmh2lc6yxIJwrtepIyTg==` | `refork/dsh-ui/ui-conversation.patch` | `89117fac21f7a27b573579abcd483fadd03b699c7413144dfe80e35cfe75e681` | `ba596cc232017d32b15d785618e62066ec580cd274fbdf8cd458dbdcbfb78b72` |

## 逐文件改动清单

本副本已被修改。再分发 allowlist 精确为 `package.json`、`LICENSE`、`lib/index.js`、`lib/invariant.js`、`lib/client.js` 五个文件；不再分发上游包内其他文件。

### `@deepseek-ai/dsh-client-ui-layout`

- `package.json`：新增 `whaledockFork` 来源字段，记录同屏创作布局 seam 用途与上游 client SHA-256。
- `lib/client.js`：新增版本化 `whaledock.content-shell/v1` 视觉组装 seam；保留上游根注册、尺寸、拖拽与 slot 权限，扩展缺失或合同不匹配时回退上游视图。
- `LICENSE`、`lib/index.js`、`lib/invariant.js`：与精确上游 tarball 字节完全相同，未修改。

### `@deepseek-ai/dsh-client-ui-conversation`

- `package.json`：新增 `whaledockFork` 来源字段，记录发送前上下文闸门 seam 用途与上游 client SHA-256。
- `lib/client.js`：在真实 `sink` 发送路径接入 `whaledockContextGate.beforeSend`；受管页面闸门缺失或未就绪时 fail-closed，非受管上游页面保持原始直接发送路径。
- `LICENSE`、`lib/index.js`、`lib/invariant.js`：与精确上游 tarball 字节完全相同，未修改。

## 许可与归属

- 许可证：MIT
- 原始归属：Copyright (c) 2026 DeepSeek
- 成品许可原文：`compliance/app-runtime/licenses/redistributed-forks/DeepSeek-MIT.txt`
- 机器可读来源与最终文件摘要：`compliance/app-runtime/SOURCES.json`
