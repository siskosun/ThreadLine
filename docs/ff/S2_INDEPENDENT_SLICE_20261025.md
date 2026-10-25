# S2 单独交付切片（2026-10-25）

- 基础：[S1 独立切片 PR #39](https://github.com/siskosun/ThreadLine/pull/39)，HEAD `aad7d0d6`，并非与未修复 main 平行合并。对应唯一机器任务 `S2-DEPENDENCIES`；不修改其正式状态。
- 复用原 [PR #37](https://github.com/siskosun/ThreadLine/pull/37) 的 `research-core.js` 纯逻辑、完整 Node 回归，并保留 S1 的 IndexedDB 单向投影与备份/恢复 API。
- **S2 唯一新增写能力：** 人工登记必要依赖、删除依赖、对照当前版本再次确认。绑定精确当前版本与理由，拒绝环、跨课题和旧版本。AI 建议只允许生成提示词和预览，必须逐条人工确认；不自动写入。
- 本 PR 不注册 `EV_REVIEW_*`，不实现 S3 变化事件/影响提醒，不载入 S4 工作台或 S5 Argdown。底层纯 `research-core.js` 包含后续可复用函数，但 **S3–S5 的写入入口和 UI 仍未开放**。
- S2 对含 S3/S4 历史的 /3 备份保守拒绝，不隐式降级/覆盖；仅必要边与确认记录的 /3 包可保真导入。
- 继承 `AGENTS.md` 的真实账号操作、旧库兼容和人工审批门禁；Node/Chromium 绿灯不能标记完成。
- 新增合成 E2E `test/s2-dependencies-e2e.py`；既有 S1 /3 交接与删除/恢复测试不得删除。准确当前 HEAD 的 CI 才可作为本 PR 验证。
