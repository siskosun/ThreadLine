# 任务完成证据格式

此文档只说明 CI 如何核查证据，不替代 [docs/PLAN.md](../PLAN.md) 的任务定义、状态和放行条件。

将某任务从 `in_review` 改成 `done` 之前，必须确认**该任务的实现 PR 已合并，且该合并提交的 GitHub 自动校验通过**。在同一次状态变更中新增 `docs/ff/evidence/<TASK_ID>.json`。

JSON 示例（用真实值替换占位符）：

```json
{
  "schema": 1,
  "task_id": "P1-CORE",
  "pr_number": 12,
  "merge_commit": "0000000000000000000000000000000000000000",
  "test_cases": [
    {"file": "threadline-extension/test/ff-core.test.js", "name": "freeze keeps SHA-256 consistent"}
  ]
}
```

`pr_number` 必须指向合并入本仓库 main 的 PR，`merge_commit` 必须与 GitHub 返回的合并提交一致，且该提交的 GitHub Actions verify 检查结论为 success。每个声明的自动测试文件须真实存在，`name` 必须能在源码中找到；对应测试需纳入 `npm run verify` / E2E 的实际执行范围。文档调查型 R-REUSE 可使用空 `test_cases`，但必须通过状态/结构校验且 PR 已合并。

人工门禁标记为 `yes` 的任务，须额外写：

```json
{
  "manual": {
    "comment_id": 123456789,
    "accepted_head_sha": "0000000000000000000000000000000000000000",
    "scope": "在 Windows 登录 Chrome 上验收了真实双分支，不包括其他账号"
  }
}
```

以上 `manual` 字段合并到同一份 JSON，不替换基本字段。用户需以仓库所有者身份在任务 PR 下亲自留言，内容**仅为**：

```text
MANUAL_ACCEPT <TASK_ID> <PR_HEAD_SHA>
```

CI 会通过 GitHub API 核查该评论是否真实存在、留言者是否为仓库所有者、内容是否与具体任务及 PR HEAD 一致。说明验收范围的脱敏证据需保留在 PR 或 `docs/ff/VERIFY.md`。

**重要限制：** GitHub API 能验证账号与留言内容，不能证明操作者是人、不能测量 Windows 浏览器是否真的执行了动作。GitHub required reviews/branch protection 和人工抽样是额外保障；当前未宣称已启用这些保护。不允许 Agent 代替用户留下上述签署留言。

任何证据因权限或 API 不可读时，CI 必须失败关闭，不凭本地 JSON 声称任务通过。没有 `GITHUB_TOKEN` 的离线本机校验只能确认格式和文件存在，不能代替 GitHub 在线核查。
