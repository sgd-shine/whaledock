# WhaleDock 再分发 dsh UI Fork 来源

本文件对应 `SOURCES.json` schema 1，上游版本为 `0.1.1-rc.2`。

- 根 App inventory：`inventory.json` 在 `redistributedComponents` 独立登记下列 fork，但它们不计入 npm `packageCount`
- 内置 dsh runtime：`../SOURCES.json`（独立合规链，不包含下列 fork）
- fork 信任源：`refork/dsh-ui/upstream-lock.json` SHA-256 `72b22c244c1e9e55207f4a8cb0fd6f6bcfaf1c3780159235df097d556e4f3aab`
- context-poc 固定信任根：`lib/context-poc-baseline.json` digest `7c5e774f416eb0801a3abf4397f2ea8168b6f5858fe1f0aaa1db7f245f50ef78`
- MIT 原文：`licenses/redistributed-forks/DeepSeek-MIT.txt` SHA-256 `ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be`

## 组件

| 组件 | modified | 精确 tarball | tarball SHA-256 | integrity | patch SHA-256 | 最终树 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-layout@0.1.1-rc.2` | `true` | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-layout/-/dsh-client-ui-layout-0.1.1-rc.2.tgz) | `42145ca99ad1e87ee35585b25697a350a9fad9a474d8c4e205f2b86a33f0a4db` | `sha512-y7xSQyQYGuahLyJcSXpB+JbH1F5lGEc3L9K8cjLy5vd/L9N6gLFLWyeGdlGxxM4jxRt1+rAHDDZ/zl7b8GC5zQ==` | `eb88c973abeaca460cf9628a2d147e4bfe457aea2fe70bfa0e8f8c08a6e82200` | `14a4594b08b7620ba5cf411274524982bc92c9cb48aeca5c6a783e1e30e98208` |
| `@deepseek-ai/dsh-client-ui-conversation@0.1.1-rc.2` | `true` | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-conversation/-/dsh-client-ui-conversation-0.1.1-rc.2.tgz) | `9403b33b02f9d5daf564764f9a615dc5eb31cc1b449384c0a793b0bc5a9354bd` | `sha512-5PCyHw2Y7nz9geEUT23et3h2XghJm7/3iWDAKa1/4ldIfCnjfxiZ5ZNRdZ9Xxpj32tBmh2lc6yxIJwrtepIyTg==` | `89117fac21f7a27b573579abcd483fadd03b699c7413144dfe80e35cfe75e681` | `ba596cc232017d32b15d785618e62066ec580cd274fbdf8cd458dbdcbfb78b72` |

归属：Copyright (c) 2026 DeepSeek。两个 fork 均为已修改的 MIT 再分发组件。
