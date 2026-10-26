# 2026-10-26 S5 低风险 UX 集成与真实验收边界

> 此文件是待评审候选的事实记录，不是第二份正式计划。唯一机器任务状态仍由 `docs/PLAN.md` 决定。

## 工程基线

- 集成候选 [PR #54](https://github.com/siskosun/ThreadLine/pull/54) 基于 S5 [PR #44](https://github.com/siskosun/ThreadLine/pull/44) 准确 HEAD `337187ceeca24313f7894b1c63ed1c62c9b10dba`；集成代码 HEAD `cac1688470e7528ad9d3178fa72a84b4c4f7b398`。
- [Linux CI](https://github.com/siskosun/ThreadLine/actions/runs/40264882986) **success**；[Windows CI](https://github.com/siskosun/ThreadLine/actions/runs/40264882976) **success**。执行原有 `npm run verify` 和合成 Chromium MV3 E2E，并加入证据空状态、接续负向用例、徽标用例。
- 从 #51 按局部功能移植第三页签 320–480px 单行布局、明确的无课题/无证据入口；从 #50 移植默认手动 AI 分析（仍保留可选网页分析）；从 #48 移植仅在存在待接续意图时展示非新聊天警告；从 #52 移植按课题实际版本差统计的待核对工具栏徽标。
- S5 的 S2 必要依赖、S3 受影响结论、S4 冻结复核、S5 Argdown 以及 S1 证据备份操作未被整个文件覆盖；最新 S2–S5 源码已含 #53 的 `safeTopicMetadata` 白名单与对应单测、六表不变 E2E，无须重复导入。
- 该集成曾发生一次文本移植失误，遗漏 `handoff.js` 页面资格判断；Linux/Windows 自动化均识别为两个错误并失败（旧 HEAD `d40e0dc` / `bff2cbb`）。在 `cac16884` 恢复准确判断后双平台全绿，失败记录保留作为审计依据。不得使用失败 HEAD 的结果签署。
- **范围**：仅合成浏览器和离线单测；无真实登录 ChatGPT、用户既有证据库迁移、无障碍人工测试，也无 Pilot/2 真实效果结论；不增加浏览器权限、不产生用户消息发送、不修改发布版本、不改正式 PLAN。

## 仍需单独处理

1. #36 的 S1 持久化/修复与 #39 的独立证据功能仍为 Draft；源码与 `main` 历史 done 记录存在需人工核对的差异。L3 用户数据安全、真实备份恢复与人工签署不能由合成验证替代。
2. F3 [#40](https://github.com/siskosun/ThreadLine/pull/40) 与人工取消 [#49](https://github.com/siskosun/ThreadLine/pull/49) 有独立通过的候选，**本 PR #54 尚未集成这些采集状态机改动**；跨 3 个自然日、至少 12 次真实 K=4 闭环依旧 NOT_EXECUTED。
3. 发布守卫 [#47](https://github.com/siskosun/ThreadLine/pull/47) 仍为独立 Draft，主分支的 v0.8.1 版本漂移尚未修正；任何正式发布须经所有者明确授权、准确 HEAD 审核及版本递增。
4. S2–S5 的多层依赖和真实人工测试尚需逐阶段审批；PR #54 不改变上述任何正式 Gate。用户未提供的个人资料不能推断为已验收。

## 条件式交接

- 审阅 #36/#39 的数据安全、恢复与真人签署，再按依赖关系评审 S2–S5；#54 仅在已批准的 S5 后续整合。
- 独立对 #40/#49 完成与 S5 的合成兼容测试及登录站点真人补测；未确定回执不得重放。
- 对正式发布执行 #47 的手动发布门禁，核实版本和可下载安装包的哈希；保留原始自动化和人工收据，方可调整机器状态。

