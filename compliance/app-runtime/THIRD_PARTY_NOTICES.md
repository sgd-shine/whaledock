# WhaleDock 根 App 运行时第三方组件通知

本文件只披露 WhaleDock 根 `dependencies` 的生产可达闭包；`vendor/dsh-runtime` 拥有独立 inventory、NOTICE、SOURCES 与许可材料，两者不混合。

本次根运行时精确锁定 `@larksuiteoapi/node-sdk@1.73.0`，生产可达包 52 个。本文件不是法律意见。

## 闭包快照

- 根 package-lock SHA-256：`3e9469413ad49f09f280c645f0e086d553ef1a80e589e1af519f6797cc75318a`
- 闭包 SHA-256：`667da495556a76100d4a0530a3ce655882ae3fedf37548436aa3f30c8a522dc6`
- 包数：52
- 安装树文件：830
- 安装树字节：39607980
- electron-builder 成品预期文件：449
- electron-builder 成品树 SHA-256：`b363e6c80bca9296e566e0accae30143e6ce02dc53a660ec706bf8c9cfac1d02`

## 许可证分布

| 许可证 | 包数 |
| --- | ---: |
| Apache-2.0 | 1 |
| BSD-3-Clause | 11 |
| MIT | 40 |

本闭包仅允许 MIT、BSD-3-Clause 和 Apache-2.0；未知许可、强/弱 copyleft、原生二进制、wasm 或平台限定都会使生成失败。

## 安装生命周期放行

- `protobufjs@7.6.5` `postinstall`：`node scripts/postinstall`；`scripts/postinstall.js` SHA-256 `5af8463b97ee8e309b4a2111f9479bacdf0c180de0ca0155527679b1fc6d9e6c`

## 逐包清单

| 包 | 版本 | 许可证 | lock 路径 | 精确 tarball | 许可原文 |
| --- | --- | --- | --- | --- | --- |
| @larksuiteoapi/node-sdk | 1.73.0 | MIT | `node_modules/@larksuiteoapi/node-sdk` | [tarball](https://registry.npmjs.org/@larksuiteoapi/node-sdk/-/node-sdk-1.73.0.tgz) | [原文1](./licenses/package-texts/f9bfd5e309b1523a2dd3937b44f516e6018605eb05b35336485b0a34cbd9f373.txt) |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | `node_modules/@protobufjs/aspromise` | [tarball](https://registry.npmjs.org/@protobufjs/aspromise/-/aspromise-1.1.2.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | `node_modules/@protobufjs/base64` | [tarball](https://registry.npmjs.org/@protobufjs/base64/-/base64-1.1.2.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | `node_modules/@protobufjs/codegen` | [tarball](https://registry.npmjs.org/@protobufjs/codegen/-/codegen-2.0.5.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | `node_modules/@protobufjs/eventemitter` | [tarball](https://registry.npmjs.org/@protobufjs/eventemitter/-/eventemitter-1.1.1.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | `node_modules/@protobufjs/fetch` | [tarball](https://registry.npmjs.org/@protobufjs/fetch/-/fetch-1.1.1.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | `node_modules/@protobufjs/float` | [tarball](https://registry.npmjs.org/@protobufjs/float/-/float-1.0.2.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | `node_modules/@protobufjs/path` | [tarball](https://registry.npmjs.org/@protobufjs/path/-/path-1.1.2.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | `node_modules/@protobufjs/pool` | [tarball](https://registry.npmjs.org/@protobufjs/pool/-/pool-1.1.0.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | `node_modules/@protobufjs/utf8` | [tarball](https://registry.npmjs.org/@protobufjs/utf8/-/utf8-1.1.2.tgz) | [原文1](./licenses/package-texts/a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794.txt) |
| @types/node | 24.13.3 | MIT | `node_modules/@types/node` | [tarball](https://registry.npmjs.org/@types/node/-/node-24.13.3.tgz) | [原文1](./licenses/package-texts/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| asynckit | 0.4.0 | MIT | `node_modules/asynckit` | [tarball](https://registry.npmjs.org/asynckit/-/asynckit-0.4.0.tgz) | [原文1](./licenses/package-texts/1953150d5d4b10c7542cee6f6e0c613b2682545233f069d75cfff1936386ce10.txt) |
| axios | 1.19.0 | MIT | `node_modules/axios` | [tarball](https://registry.npmjs.org/axios/-/axios-1.19.0.tgz) | [原文1](./licenses/package-texts/82761059eaedacb3356803aea8a170d8298609f91b14fc32ee1bfb40d690183c.txt) |
| agent-base | 6.0.2 | MIT | `node_modules/axios/node_modules/agent-base` | [tarball](https://registry.npmjs.org/agent-base/-/agent-base-6.0.2.tgz) | [README 许可声明](./licenses/package-texts/f1425c3b72330fe4fb2aa5a2fb152e939bdf534692a32b5f0b38f74147b98556.txt) |
| https-proxy-agent | 5.0.1 | MIT | `node_modules/axios/node_modules/https-proxy-agent` | [tarball](https://registry.npmjs.org/https-proxy-agent/-/https-proxy-agent-5.0.1.tgz) | [README 许可声明](./licenses/package-texts/32f0856d2c43df7d05cca960fdee84e1e38ab545bd7b2186433dfa41aa90a712.txt) |
| call-bind-apply-helpers | 1.0.2 | MIT | `node_modules/call-bind-apply-helpers` | [tarball](https://registry.npmjs.org/call-bind-apply-helpers/-/call-bind-apply-helpers-1.0.2.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| call-bound | 1.0.4 | MIT | `node_modules/call-bound` | [tarball](https://registry.npmjs.org/call-bound/-/call-bound-1.0.4.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| combined-stream | 1.0.8 | MIT | `node_modules/combined-stream` | [tarball](https://registry.npmjs.org/combined-stream/-/combined-stream-1.0.8.tgz) | [原文1](./licenses/package-texts/47eb8ca82c798246774946d1be0f9aa08f025fa8325ced0947aeeb4c05fe5547.txt) |
| debug | 4.4.3 | MIT | `node_modules/debug` | [tarball](https://registry.npmjs.org/debug/-/debug-4.4.3.tgz) | [原文1](./licenses/package-texts/3a61c6c96caf5c1d9b623fb9b04c822b783dfcb78aa7e49c76a3f643e6ed7f95.txt) |
| delayed-stream | 1.0.0 | MIT | `node_modules/delayed-stream` | [tarball](https://registry.npmjs.org/delayed-stream/-/delayed-stream-1.0.0.tgz) | [原文1](./licenses/package-texts/47eb8ca82c798246774946d1be0f9aa08f025fa8325ced0947aeeb4c05fe5547.txt) |
| dunder-proto | 1.0.1 | MIT | `node_modules/dunder-proto` | [tarball](https://registry.npmjs.org/dunder-proto/-/dunder-proto-1.0.1.tgz) | [原文1](./licenses/package-texts/2b770a704c15de238c3f622b01b0044ddd60b49ee30608ea6991ebf19db7a7a1.txt) |
| es-define-property | 1.0.1 | MIT | `node_modules/es-define-property` | [tarball](https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.1.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| es-errors | 1.3.0 | MIT | `node_modules/es-errors` | [tarball](https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| es-object-atoms | 1.1.2 | MIT | `node_modules/es-object-atoms` | [tarball](https://registry.npmjs.org/es-object-atoms/-/es-object-atoms-1.1.2.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| es-set-tostringtag | 2.1.0 | MIT | `node_modules/es-set-tostringtag` | [tarball](https://registry.npmjs.org/es-set-tostringtag/-/es-set-tostringtag-2.1.0.tgz) | [原文1](./licenses/package-texts/1a3aeb1f1398bd697d57c3c585faadf59d825aca6e3162cd7eeb72ff76eb2466.txt) |
| follow-redirects | 1.16.0 | MIT | `node_modules/follow-redirects` | [tarball](https://registry.npmjs.org/follow-redirects/-/follow-redirects-1.16.0.tgz) | [原文1](./licenses/package-texts/bfa8a54bb952ccda79f0f1889721d108f5b605babbb2b8a3705ffb52f4132eb7.txt) |
| form-data | 4.0.6 | MIT | `node_modules/form-data` | [tarball](https://registry.npmjs.org/form-data/-/form-data-4.0.6.tgz) | [原文1](./licenses/package-texts/e5b780d4f38d1d3328e3e53186c4e62d3fa149ea6f2bacd5de5ad0c30ac85343.txt) |
| function-bind | 1.1.2 | MIT | `node_modules/function-bind` | [tarball](https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz) | [原文1](./licenses/package-texts/773e131a7684726005a7e4688a80b4620033bc08499bc1404dd1a1eb3bca725e.txt) |
| get-intrinsic | 1.3.0 | MIT | `node_modules/get-intrinsic` | [tarball](https://registry.npmjs.org/get-intrinsic/-/get-intrinsic-1.3.0.tgz) | [原文1](./licenses/package-texts/39c5ec504cf6bd5cd782a7c695828e09189df79f5d94840e4f08feb97b9fd416.txt) |
| get-proto | 1.0.1 | MIT | `node_modules/get-proto` | [tarball](https://registry.npmjs.org/get-proto/-/get-proto-1.0.1.tgz) | [原文1](./licenses/package-texts/be46ce1e3b0479af9ce82d22b465a6d7d2ff084fca0aaf3d54172da2b5eb5781.txt) |
| gopd | 1.2.0 | MIT | `node_modules/gopd` | [tarball](https://registry.npmjs.org/gopd/-/gopd-1.2.0.tgz) | [原文1](./licenses/package-texts/d90bf0a089da4cf43d644ed240a0b3825dcdb705e64e38371d56995a4cc9e4c5.txt) |
| has-symbols | 1.1.0 | MIT | `node_modules/has-symbols` | [tarball](https://registry.npmjs.org/has-symbols/-/has-symbols-1.1.0.tgz) | [原文1](./licenses/package-texts/206c1adcf206dc0031b11232f5b054ec5f1662407ab1ca415247921cab2068ab.txt) |
| has-tostringtag | 1.0.2 | MIT | `node_modules/has-tostringtag` | [tarball](https://registry.npmjs.org/has-tostringtag/-/has-tostringtag-1.0.2.tgz) | [原文1](./licenses/package-texts/e2560e002e13281578c75c850061d9255c33d16d732939e8c2db64c2506642fa.txt) |
| hasown | 2.0.4 | MIT | `node_modules/hasown` | [tarball](https://registry.npmjs.org/hasown/-/hasown-2.0.4.tgz) | [原文1](./licenses/package-texts/bf9b0d665be2a689851eea667ca9f42066ea1d903b38349c51e6a44b2577680a.txt) |
| lodash.identity | 3.0.0 | MIT | `node_modules/lodash.identity` | [tarball](https://registry.npmjs.org/lodash.identity/-/lodash.identity-3.0.0.tgz) | [原文1](./licenses/package-texts/2b61a34ef17beffb1e555efa8b46110d25398d47f2e88b2cacc46f8bd382c639.txt) |
| lodash.merge | 4.6.2 | MIT | `node_modules/lodash.merge` | [tarball](https://registry.npmjs.org/lodash.merge/-/lodash.merge-4.6.2.tgz) | [原文1](./licenses/package-texts/f71e8ed126b46346494aad5486874cd8f0aafe95092ed67d2e3cb6110f939abc.txt) |
| lodash.pickby | 4.6.0 | MIT | `node_modules/lodash.pickby` | [tarball](https://registry.npmjs.org/lodash.pickby/-/lodash.pickby-4.6.0.tgz) | [原文1](./licenses/package-texts/ffd8b33b354585f4ce119f19c53728281e48a97b074491eb6bf6d5c5ff305272.txt) |
| long | 5.3.2 | Apache-2.0 | `node_modules/long` | [tarball](https://registry.npmjs.org/long/-/long-5.3.2.tgz) | [原文1](./licenses/package-texts/cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30.txt) |
| math-intrinsics | 1.1.0 | MIT | `node_modules/math-intrinsics` | [tarball](https://registry.npmjs.org/math-intrinsics/-/math-intrinsics-1.1.0.tgz) | [原文1](./licenses/package-texts/2b770a704c15de238c3f622b01b0044ddd60b49ee30608ea6991ebf19db7a7a1.txt) |
| mime-db | 1.52.0 | MIT | `node_modules/mime-db` | [tarball](https://registry.npmjs.org/mime-db/-/mime-db-1.52.0.tgz) | [原文1](./licenses/package-texts/cc1dfd4dafa27271e8212cd3b274eeb3f262e40a6fdab36ddc3f9696f706f58b.txt) |
| mime-types | 2.1.35 | MIT | `node_modules/mime-types` | [tarball](https://registry.npmjs.org/mime-types/-/mime-types-2.1.35.tgz) | [原文1](./licenses/package-texts/71f83c4c0621102a56d9853812777b85751bce7e9726f686f5b056c1f8a4b0e6.txt) |
| ms | 2.1.3 | MIT | `node_modules/ms` | [tarball](https://registry.npmjs.org/ms/-/ms-2.1.3.tgz) | [原文1](./licenses/package-texts/1662fae9b5314d11cf51284e2dcd1f006a354f7343f08712a730fcff9a359801.txt) |
| object-inspect | 1.13.4 | MIT | `node_modules/object-inspect` | [tarball](https://registry.npmjs.org/object-inspect/-/object-inspect-1.13.4.tgz) | [原文1](./licenses/package-texts/bd40cc437e28a3ad7bef2ad34e6b72e757b182e67bda1acadbab4ef0476f8232.txt) |
| protobufjs | 7.6.5 | BSD-3-Clause | `node_modules/protobufjs` | [tarball](https://registry.npmjs.org/protobufjs/-/protobufjs-7.6.5.tgz) | [原文1](./licenses/package-texts/49d6a1c9a623784c61c6cb70f773f3457faceb1914a13c8560a9823b7631950c.txt) |
| proxy-from-env | 2.1.0 | MIT | `node_modules/proxy-from-env` | [tarball](https://registry.npmjs.org/proxy-from-env/-/proxy-from-env-2.1.0.tgz) | [原文1](./licenses/package-texts/f55828df4b8752c48e765a806465b76a103e3cb363379c569b15a1df2ba2d79e.txt) |
| qs | 6.15.3 | BSD-3-Clause | `node_modules/qs` | [tarball](https://registry.npmjs.org/qs/-/qs-6.15.3.tgz) | [原文1](./licenses/package-texts/e7dc37bf662d7f786efcb46c545615e70c1daf458a38385521c63cf6607cdfe1.txt) |
| side-channel | 1.1.1 | MIT | `node_modules/side-channel` | [tarball](https://registry.npmjs.org/side-channel/-/side-channel-1.1.1.tgz) | [原文1](./licenses/package-texts/cfc3f455254c0af0655cc3ff46a41ed644b67599f6043346169d285bf2b3cf3b.txt) |
| side-channel-list | 1.0.1 | MIT | `node_modules/side-channel-list` | [tarball](https://registry.npmjs.org/side-channel-list/-/side-channel-list-1.0.1.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| side-channel-map | 1.0.1 | MIT | `node_modules/side-channel-map` | [tarball](https://registry.npmjs.org/side-channel-map/-/side-channel-map-1.0.1.tgz) | [原文1](./licenses/package-texts/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| side-channel-weakmap | 1.0.2 | MIT | `node_modules/side-channel-weakmap` | [tarball](https://registry.npmjs.org/side-channel-weakmap/-/side-channel-weakmap-1.0.2.tgz) | [原文1](./licenses/package-texts/cfc3f455254c0af0655cc3ff46a41ed644b67599f6043346169d285bf2b3cf3b.txt) |
| undici-types | 7.18.2 | MIT | `node_modules/undici-types` | [tarball](https://registry.npmjs.org/undici-types/-/undici-types-7.18.2.tgz) | [原文1](./licenses/package-texts/a6db8096b2707bc0102d256917d4d33f298ba36d8c3f25de067a2b5bb379db27.txt) |
| ws | 8.21.3 | MIT | `node_modules/ws` | [tarball](https://registry.npmjs.org/ws/-/ws-8.21.3.tgz) | [原文1](./licenses/package-texts/2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef.txt) |
