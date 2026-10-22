# Z0-LIVE 编辑器空段落诊断与复现边界（2026-10-22）

**状态：UNSIGNED / PARTIAL。** 本文件是根据用户提交的本机 PROGRESS/BLOCKED 脱敏报告与独立 GitHub CI 记录整理的证据索引，不是现实账号人工签署，不是正式计划。

## 本机报告发现

- 本机真实 Edge 的 ProseMirror 编辑器使用顶层 P；连续空行对应空 `<p><br></p>`。在受测的旧加载版中，该空 P 的 `innerText` 返回 `"\\n"`，随后 `editorText()` 用 `"\\n"` 连接顶层块而重复计数。
- 不含用户数据的最小复现：输入 `A\\n\\nB`，旧结构回读为 `A\\n\\n\\nB`。本机 T4 的 6 个空 P 多 6 个 LF，替代综合 T6s 的 3 个空 P 多 3 个 LF。
- **版本不一致：** 用户测试时 Edge 载入的 handoff.js SHA-256 前缀为 `872c7b96`，而当时 PR HEAD `55f4ea49` 的同文件前缀为 `ce0968a4`。这一阶段的真实 Edge 结果仅能证明加载版行为，不能代替现行 PR 代码验收。
- 历史完整综合载荷无法找回，原样 23,569 字节 T6 未复测；旧 T2–T6 正式 NEW_CHAT 尝试被 ChatGPT 恢复的自有测试草稿挡住，并正确保持占用、不覆盖和零自动发送。

## 已提交的针对性修复

- 负向用例提交：`fdd172ef29230e89ec7a82108322da86ad943b5a`；[Linux CI 红灯](https://github.com/siskosun/ThreadLine/actions/runs/39775625769)，原因锁定为空 P 双计，而非测试环境缺依赖。
- 生产修复：`9d23426dc2c149bc3e6c492a99d9485303ed930a`，严格判断 P 是否只含一个占位 BR；符合条件则其块文本为空，保留由块间连接表达的换行。不删除真实额外空行、不调整 `canonicalization-v1`、不默认提高成功等级。
- [Linux CI 39775655808](https://github.com/siskosun/ThreadLine/actions/runs/39775655808) 与 [Windows CI 39775655955](https://github.com/siskosun/ThreadLine/actions/runs/39775655955) 均成功，Windows Node 125/125，原扩展与 handoff 合成浏览器测试通过。两套合成 E2E 不是登录 Edge。
- 尚缺：在与 `9d23426d` 代码一致的真实 Edge 测试标签中对可复现新载荷重新取证，包括 CRLF 规范化与占位空段落、代码围栏/尾部空白、ACK 和零自动发送；并继续未完成的第零步其他异常及可信消息验收。

**结论：** 空 P 双计这个代码问题已修复并通过 CI，但真实网页复验、原始 T6 以及 Z0-LIVE 的人工审批均未完成。
