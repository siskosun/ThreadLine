# 2026-10-25 S0/S1 复验与修复范围

**结论：当前 S1 不通过复验，先修复现有契约，不进入 S2。** 基线为 main `f43fd072eb6f85dc78bddcc9853899c103293b73`；此前机器表登记 12/12 done。已合并 PR 和已有签署是历史事实，但不能覆盖本轮发现的失败行为。

## 已执行的检查

- 对照 `AGENTS.md`、`docs/PLAN.md` 第十一节、S0A/S1A/S1B 证据、当前源码和测试。
- 基线本机 Windows 日志显示 `npm run verify` 233/233、四组 `npm run test:e2e` 合成 Chromium 测试通过。首轮工具输出截断，未保留下顶层进程 exit code；不伪造为完整 Gate 收据。最终候选另行运行原生命令并保存退出码、运行前后源码指纹。
- 尝试全局 `tools/verify-run.ps1` 被本机未签名脚本策略拒绝，包装器 NOT_EXECUTED；未修改执行策略。原生测试收据不能冒充该 helper 的 FRESH Gate 记录，后续需要解决工具执行条件后按工作流重新取证。
- 两个只读 LOCAL_PRE_REVIEW 分别检查证据存储与采纳/定位；ROOT 对每项重新读取源码并执行独立探针。内部复核不是外部 Plan/Final Gate。
- `evidence/S1-AUDIT-20261025/probe.cjs` 使用实际核心模块、实际 `DB.snapshot` 转换和现有后台 VM harness；输出见同目录 `probe-results.json`。它是历史缺陷复现器，exit 0 表示观察到记录中的缺陷，**不表示产品验收通过**。执行：仓库根目录 `node docs/ff/evidence/S1-AUDIT-20261025/probe.cjs .`。后台 harness 使用内存 DB，不能把它说成真实磁盘恢复试验。
- 单独新增真实 MV3 面板回归：`python test/evidence-e2e.py`，修复前 exit 1，报 `ReferenceError: div is not defined`；修复后 exit 0。所有数据均为合成，不连接真实 ChatGPT、不读取账户、不发送消息。
- Release `v0.8.1` 标签指向 `bad3b4966ab71702e2a595e059f7d0382b0910e1`，发布时间 2026-10-24 15:23:04 UTC，早于 S0/S1。该标签没有 `evidence-core.js`。main 的 S0/S1 代码不能视为已发布；本次不改版本、不发布。

## 复验发现

以下位置为基线文件及函数；修复只涉及 R01。事实判定均为 CONFIRMED。

| 编号 | 等级 | 触发及后果 | 位置 | 当前处置 |
| --- | --- | --- | --- | --- |
| R01 | P1 | 带 conversationId 的片段触发未定义标识符，整条结论和修订/撤回控件不显示 | `panel.js:482–498` `renderEvidenceProject` | 已补字符串引号；真实面板红/绿回归；待 PR 审阅合并 |
| R02 | P1 | operations 以 operationId 存储，却以 id 建快照，重试无法命中持久台账，同 ID 可用于不同内容 | `evidence-db.js:52` `snapshot` | 未修复；L3 修复计划 |
| R03 | P1 | 导入只检查 conclusion ID；同 source/version/link ID 可被 put 覆盖，不验原文哈希及完整引用 | `evidence-core.js:342–379` `importPackage`；`evidence-db.js:90–93` | 未修复；L3 修复计划 |
| R04 | P1 | 正常导出/恢复遗漏 takeover、legacyNote，已有正式结论的旧 decision 又可直接编辑 | `evidence-core.js:330–335,374–378` | 未修复；L3 修复计划 |
| R05 | P1 | 删除课题或恢复遗漏该课题的旧备份成功，但证据原文留在库中、正常入口消失 | `background.js:1128–1165` | 未修复；先评审禁止危险路径的临时方案和完整删除协议 |
| R06 | P1 | 权威库缺失/读取失败被视作空库或未接管，兼容投影仍在却可重新编辑旧结论 | `background.js:901–906,943–951` | 未修复；必须明确报错并阻止不可靠写入/交接 |
| R07 | P1 | 证据更新只写独立 summary key，旧 decision、knowledgeVersion 不更新，旧分支不提示更正/撤回 | `background.js:873–890`；`content.js:179–188` | 未修复；统一单向投影与旧分支通知 |
| R08 | P1 | 旧表单始终带 decision 字段，首次采纳后连只改目标、名字和收口状态也被拒绝 | `panel.js:247–248,378–382`；`background.js:1163–1165` | 未修复；接管后只读旧结论并省略旧写字段，后台继续封口 |
| R09 | P1 | 同摘录来自另一会话、消息、关系或条件时仍被当重复，静默丢失新来源 | `evidence-core.js:224–243` `findDuplicateAdoption` | 未修复；定义包含来源身份和条件的去重指纹 |
| R10 | P2 | 修改正文时条件清空，来源 kind/captureRunId/url/capturedAt 被丢弃或重写 | `panel.js:516–520`；`evidence-core.js:189,198–204` | 未修复；保留来源快照身份与未修改字段 |

## 为何现有绿灯不足

核心/后台测试用自建 Map 正确映射 operationId，替代了有问题的真实 snapshot；导入测试只覆盖 conclusion ID 冲突；旧恢复测试仍包含被接管课题；重启测试保持整个库完整。新增 UI 回归前，E2E 仅检查消息层和原型页，未渲染带会话来源的正式面板列表。

状态纠偏后的本机检查：`check-plan.mjs` 结构验证通过（12 项、8 项历史 done）；`npm run verify` exit 1（232 通过、1 失败），唯一失败为 `plan-governance.test.js` 将 done 列表固定为全部 12 项，并限制 S0 状态。`npm run test:e2e` exit 0（四组通过）。按仓库禁止为绿灯改断言的约定，本次保留该失败；预期状态和合法回退的测试应随治理变更人工评审，不能据此称全套通过。测试失败与产品 R02–R10 未修复是两个独立问题。

另有未完成范围：普通整理页仍发布旧 decision，未提供逐条证据采纳；Fork 采纳截取整段回复，未保存 messageId/captureRunId；原型的毫秒计时是自动化提交链路时延，不能证明真人采纳摩擦达标。S1A 证据自述 D5 删除对账未交付，S1B 证据自述整理页入口和真人工效未覆盖。本轮不推断既有代理签署是否获其他会话授权，也不抹掉历史签署；这些记录不能消除当前确定性缺陷。

## 本次继续开发与门禁

- **已实施 L1：** R01 字符串修复和真实面板回归，不改变数据库、权限、定位匹配算法或发送行为。
- **待评审 L3：** R02–R10 的持久化/恢复/兼容修复。包中明确副作用、历史错误数据如何处理、旧备份格式、回滚限制和独立验收。外部 Plan Gate 未过，不实施这些数据路径。
- 计划表将 S0A-PROTOTYPE、S1A-PERSIST、S1B-ADOPT 重新标为 blocked；S0B-LOCATE 因前置 S0A 不再 done 一并 blocked，并非认定其滚动算法失败。原 JSON、PR、签署完整保留。
- 下一步：外部 Plan Review → ROOT 核验采纳 → 分批修复及真实 IDB 失败路径测试 → 新鲜 External Final Review → L3 人工风险确认 → 用户授权合并/新版本发布。S2 继续等待 S1 和真实试点前置条件。

本次未确认修复版在登录后的真实 ChatGPT 页面生效；已有 K=4 采集停滞 F3 也不在本轮修复范围内，继续保留其阻塞记录。
