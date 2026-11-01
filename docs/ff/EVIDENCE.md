# 任务完成证据格式

此文档说明 CI 如何核查新路线任务，不替代 [docs/PLAN.md](../PLAN.md) 的任务定义、状态和验收条件。

将某任务从 in_review 改成 done 之前，必须确认该任务实现 PR 已合并，且该合并提交的 GitHub 自动校验通过。在同一次状态变更中新增 docs/ff/evidence/<TASK_ID>.json。

JSON 示例（用真实值替换占位符）：

    {
      "schema": 1,
      "task_id": "CAPTURE-CORE",
      "pr_number": 123,
      "merge_commit": "0000000000000000000000000000000000000000",
      "test_cases": [
        {
          "file": "threadline-extension/test/capture-core.test.js",
          "name": "active branch rejects a broken parent chain"
        }
      ]
    }

pr_number 必须指向合并入本仓库 main 的 PR，merge_commit 必须与 GitHub 返回的合并提交一致，且该提交的 GitHub Actions verify 检查结论为 success。每个声明的自动测试文件须真实存在，name 必须能在源码中找到；对应测试需纳入 npm run verify / E2E 的实际执行范围。

人工门禁标记为 yes 的任务，须额外写入 manual 字段，包含 comment_id、accepted_head_sha 和 scope。用户需以仓库所有者身份在任务 PR 下亲自留言，内容仅为：

    MANUAL_ACCEPT <TASK_ID> <PR_HEAD_SHA>

CI 会核查评论账号、所属 PR、准确 HEAD 和内容。说明验收范围的脱敏证据需保留在 PR 或 docs/ff/VERIFY.md。

GitHub API 能验证账号与留言内容，不能证明操作者是人，也不能证明 Edge 页面真实执行了动作。真实登录网页、真人 UX、读屏和附件内容核验必须保留独立证据；Agent 不得代替用户签署。
