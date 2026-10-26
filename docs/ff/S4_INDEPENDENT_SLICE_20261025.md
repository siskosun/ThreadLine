# S4 独立切片（2026-10-25）

基线为 [S3 PR #42](https://github.com/siskosun/ThreadLine/pull/42)，任务为 `S4-REVIEWS`。本 PR 只是层叠 Draft；正式状态/发布门禁未变化。

复用原 [PR #37](https://github.com/siskosun/ThreadLine/pull/37) 已实现的冻结祖先版本、来源哈希与拓扑、盲材料、独立结论比对、过期结果留史与四种复核处理。新增独立折叠 `review-ui.js`，避免整体搬运 S5 Argdown UI。

`EV_REVIEW_PREPARE` 冻结范围和旧版本身份；`EV_REVIEW_REFERENCE` 需要用户明确查看；`EV_REVIEW_COMPLETE` 判断祖先/入边/来源变化。过期结果只能留史，不能改写现行结论。keep 通过当前版本与冻结事件清单确认必要依赖；revise/withdraw 在同一权威事务中与复核记录一起保存，不丢原片段及条件。用户手动复制材料到新对话，扩展不自动发送。

兼容完整 /3 研究备份并验证复核范围哈希；任何研究真实效果仍需 `pilot/2` 三臂试点。新增合成 E2E：两次修改导致旧复核过期、创建新复核后保留、实质修订保留条件、完整研究备份与重复提交拒绝。真人登录、人工工效、L3 签署未做，绝不标 done。
