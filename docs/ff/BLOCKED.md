# ThreadLine 当前阻塞

该文件登记事实及解除条件，不是第二份计划。官方任务状态见 [docs/PLAN.md](../PLAN.md)。

## Z0-LIVE — 真实 ChatGPT 页面验收

- 状态：未执行、未通过；截至 2026-10-21 尚无用户真人签署的完整流程。
- 已知原因：本次无法使用用户已登录的 Windows Chrome/Edge 完成真实新建、草稿填入、人工发送、读取和双分支验收；合成 MV3 测试不能代替。
- 解除条件：PR-0 Windows 基线验收后，用户操作真实会话，对 24KB 长输入、提交文本 exact/canonical_equivalent、不丢回复、双 tab 归属和失败不重放逐项签署，附脱敏记录与绑定 HEAD 的 GitHub 人工确认。
- 影响：P2-FORK 和 P3-REPORT 的依赖网页交互开发不得宣称可发布；P1-CORE 不依赖该门禁，可继续进行。
- 当前工作参考：Draft [PR #1](https://github.com/siskosun/ThreadLine/pull/1)。

遇到其他阻塞应按任务 ID 追加原因、复现方法、已尝试处理、下一次解除条件，不覆盖历史证据。
