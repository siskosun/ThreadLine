# 第三方许可与借鉴

仓库根目录的 MIT License 适用于 ThreadLine 自行编写的扩展代码；不替代第三方作品的许可。所有发行包保留 `threadline-extension/licenses/` 内的许可副本。

- `threadline-extension/vendor/shadow-helpers.js` 包含从 ChatGPT Shadow 授权来源经修改的页面适配逻辑（Apache-2.0），详情见 `threadline-extension/vendor/NOTICE.txt` 和 `licenses/Apache-2.0.txt`。
- ChatGPT Conversation Optimizer (CGO) 的分页设计及相关许可：`licenses/MIT-CGO.txt`。
- Chat Organizer 与 Dichrome 的项目创建、归档方法仅用于研究和借鉴；不声明复制了受其许可限制的实现。
- `threadline-extension/vendor/toolkit-scroll.js`（S0b，2026-10-25）：从 GPT Conversation Toolkit commit `119d3728bc4cb583d75da72b067a74b1dce90d60`（MIT，副本 `licenses/MIT-GPT-Conversation-Toolkit.txt`）的 `utils/dom.js` 与 `features/virtualized-jump.js` 移植坐标算法（isConversationDocumentScrollRoot、isConversationReverseScrollRoot、scrollElementIntoConversationView 滚动数学、getVirtualJumpScrollController）。改动：滚动根由注入的 resolveScrollRoot 提供（移除上游全局状态与宽泛兜底，避免误选侧栏）；无模块级可变状态。上游三个反向滚动行为用例已移植为针对本文件的测试（test/toolkit-scroll.test.js）。上游升级须先比对差异与许可并跑本地契约测试，不跟随 main 自动更新。

如进一步复用第三方原始代码，须检查文件级版权声明，并更新本文件。
