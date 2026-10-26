# S3 单独交付切片（2026-10-25）

基础为 [S2 PR #41](https://github.com/siskosun/ThreadLine/pull/41)，对应唯一机器任务 `S3-IMPACTS`；PR 保持 Draft，正式状态不在这里更新。

新增：实质修订/撤回记录稳定版本事件、同一 `triggerEventId` 不重复传播；`Research.notifications` 找出已登记必要依赖的直接/传递影响；`EV_IMPACT_CONTEXT` 提供上游旧/新版和下游依据的只读核查材料；独立 `impact-ui.js` 仅显示待核查路径和人工逐事件确认。

**比原 PR #37 更严格：** `confirmDependency` 不再自动把该边所有历史变更纳入 `coveredChanges`。只有用户查阅特定变更材料、明确指定 `triggerEventId` 并提供理由时，该事件才可被覆盖；研究纯逻辑层逐项验证它与关系边及影响目标确实对应。无法核实的事件保持待核查。

显式声明仅措辞且承接原输入依赖时，不自动向下游传播实质影响，但下游版本确认也**不会因此自动升级**。其余修订正常记录变化。无依赖时不能宣称“所有结论均正确”。

兼容 S1/S2 /3 备份；S4 冻结复核历史仍保守拒绝，避免 S3 版本静默丢失。借用 [PR #37](https://github.com/siskosun/ThreadLine/pull/37) 的 `scripts/evaluate-dependencies.mjs` 同一 `Research.impacts` 实现，不接受用户填入预测集合作为已发生结果。此为合成离线工程评估，不是六案例真实产品试点。

测试：沿用 S1/S2 集成、纯研究逻辑全套；新增 `test/s3-impacts-e2e.py` 涵盖 A→B→C、独立逐事件终端边确认、核查材料身份、重复修订幂等。未进行用户登录和真人试点。
