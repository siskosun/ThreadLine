# ThreadLine Agent 执行约定

## 权威来源
本项目**唯一正式开发计划**是 [docs/PLAN.md](docs/PLAN.md)，包括目标、阶段、任务状态、依赖和验收标准。开工、切换分支及中断恢复时，都须重新读取它与当前 GitHub main/PR。聊天消息、ChatGPT 资料库、旧版 `docs/ff/DEVELOPMENT_PLAN.md` 和其他附录不得覆盖正式计划。

## 执行顺序
1. 核对 main SHA、已有 PR 与 `docs/PLAN.md` 当前状态；检查既有研究证据 `docs/ff/REUSE_AUDIT_20261021.md`，优先复用，不重复造轮子。
2. 选择一个未被依赖门禁阻断的任务；先定位源码、现有测试和实际命令。提交前执行回归，不把先前 CI 结果当成本次测试。
3. 独立功能分支、聚焦 PR。不得直推 main、代用户审批、自动合并或擅自发布 Release；第二期未获批准不开发。
4. 在 `docs/ff/PROGRESS.md` 记录提交、实际命令/运行链接、结果及未完项；在 `docs/ff/BLOCKED.md` 登记阻塞及解锁证据。只有和验收证据一致时才更新计划表状态。
5. PR 处于 Draft/Open、仅有代码、CI 绿灯或 Agent 自评都**不等于 `done`**。`done` 需 `docs/ff/evidence/<TASK_ID>.json`、已经合并的 PR、自动测试和适用的真人签署；由 GitHub CI 复核。程序无法核实的项目明确标为未完成。
6. 每个任务提供真实代码/文件 diff、Node 单元测试与可适用的合成 Chromium E2E；真实登录 ChatGPT 网页需用户操作并留下脱敏验收，不得把合成页面说成真实验收。PR 只提交评审，合并需用户授权。
7. 未确定的消息发送、会话归属、网页操作和采集结果**禁止自动重放**；永不因静默超时推断成功。

## 状态与测试
- 唯一机器状态表在 `docs/PLAN.md` 的 `PLAN_TASKS_START/END` 标记之间。状态仅使用 `planned/in_progress/in_review/blocked/done/deferred`。
- 工具：在 `threadline-extension/` 运行 `npm run verify`（Node 22+）；具有合成 Chromium 能力时运行 `npm run test:e2e`。必须另外核实 Windows 真实环境；不可更改断言、删除测试或吞掉失败来让 CI 变绿。
- `npm run verify` 包含计划状态/结构检查；GitHub Action 还调用 `node scripts/check-plan.mjs --github` 核对已声称 `done` 的合并 PR、CI 检查、真人批准记录。所需 JSON 格式见 `docs/ff/EVIDENCE.md`。
- 任务依赖及真人验收门禁**先于**进度优化：Z0-LIVE 未被真人验收并标 `done` 之前，P2-FORK 不得进入执行或评审；P3-REPORT 依赖 P2-FORK。P1-CORE 可独立进行纯逻辑开发。
- 不同 Agent 可以独立评审，但共享状态只由一个集成人修改；发现源码与计划不一致，保留代码与错误记录供审核，不猜测。
- 计划、校验器和工作流本身属于关键治理文件；修改这些文件必须在 PR 明示并经人工复核。没有仓库规则保护时，CI 不是防篡改保证。

## 安全边界
Fork Beta 默认关闭，第一期手动发送、仅两个普通非 Project 会话。实验数据独立 IndexedDB，`unknown` 不自动重发；只允许经验证的纯文本最终结果进入 X/Y 对照。绝不把内部资料、登录凭据、Token、Cookie 或未脱敏的对话/截图提交到公开 GitHub。

如失败连续复现三次，停止盲目重复，检查根因和原始日志；无法完成的环节如实写入 BLOCKED，不伪造通过。
