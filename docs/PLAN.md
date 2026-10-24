# ThreadLine 开发计划

**唯一正式计划：** 本文件 `docs/PLAN.md`。其他 ChatGPT 资料库、对话、PR 说明和 `docs/ff/` 附录仅作为参考或证据，均不能覆盖本文件的任务状态。
**事实核查日：** 2026-10-24。
**基线：** main `b0d470b3d7a386f2243f1bafb26aa54c7fcc26a0`（含已合并治理 PR #2 与 P1-CORE PR #10），应用仍为 v0.6.1。
**实施授权范围：** 第零步与第一期；第二期暂缓。不得仅凭 Agent 声称完成而更新状态。

## 执行任务与验收门禁

以下表格是任务状态的**唯一机器可读登记**。每个 ID 只能出现一次，状态只能是 `planned`、`in_progress`、`in_review`、`blocked`、`done`、`deferred`。不要使用 Markdown 单元格中的竖线。证据状态不可由 AI 自行认定；`done` 需要合并 PR、测试证据以及适用的人工验收。

<!-- PLAN_TASKS_START -->
| ID | 阶段与目标 | 状态 | 依赖 | 完成条件 | 证据 | 人工门禁 |
| --- | --- | --- | --- | --- | --- | --- |
| R-REUSE | 复用调研与 Fork 审计 | done | - | 上游代码、Fork 差异及移植边界经评审 | docs/ff/evidence/R-REUSE.json | no |
| Z0-BASE | Windows 测试基线与路径修复 | in_review | - | Windows npm run verify 和合成 E2E 有原始日志 | PR#1 | yes |
| Z0-LIVE | 真实登录 ChatGPT 的页面适配验收 | blocked | Z0-BASE | 双标签创建、长草稿回读、人工发送核实、完整采集、异常恢复由用户验收 | docs/ff/BLOCKED.md | yes |
| P1-CORE | 冻结材料、独立存储及四态状态机 | done | - | 24KB 输入和 SHA-256、attempts、单写者与原有功能回归经测试 | docs/ff/evidence/P1-CORE.json | no |
| P2-FORK | 双会话创建与人工发送工作流 | planned | Z0-LIVE,P1-CORE | 两边输入完整且相同，0 自动发送，分支身份和重启恢复经测试 | - | yes |
| P3-REPORT | 完整结果采集、去标签对照及 JSON 导出 | planned | P2-FORK | 双 done 才可对照，用户裁决持久化，不重放未知状态，导出可独立复算 | - | yes |
| BETA-RELEASE | 安装升级与正式 Beta 验收 | planned | P3-REPORT | 真实双分支闭环、同路径旧数据升级、CI 与用户验收均通过 | - | yes |
| P4-AUTO | 第二期多分支和自动 Flush | deferred | BETA-RELEASE | 另行审批并补齐等预算对照及裁判校准要求 | - | yes |
<!-- PLAN_TASKS_END -->

### 状态与证据契约

- `planned`：尚未开始；创建空分支、生成计划、模型自评均不算执行完成。
- `in_progress`：已有具体代码和实验记录，仍未验收；不得因存在提交就标 `done`。
- `in_review`：已提交 PR 但尚未获得本任务的完整验收证据；PR 可以仍开放，也可能已合并，仍不等于本任务 `done`。被关闭而未合并的 PR 不能作为有效证据。
- `blocked`：需要在 `docs/ff/BLOCKED.md` 记录原因、解除条件和真实事实。
- `done`：提交 `docs/ff/evidence/<任务ID>.json`，由 CI 检查合并 PR 的真实状态、合并 SHA、测试用例和必要人工批准；子任务的依赖必须先 `done`。不允许拿 PR 自述、模拟网页或空白附件代替证据。
- `deferred`：当前未立项。第二期改为执行态必须经人工重新批准并修改本计划。
- 每次状态变更记录在 `docs/ff/PROGRESS.md`；实施阻塞写入 `docs/ff/BLOCKED.md`。其中的描述不覆盖本表状态。
- 数据与网页执行证据可以脱敏后记录于 `docs/ff/evidence/`；严禁存储 Token、Cookie、账号凭据及内部研究正文。
- CI 只能核查自动测试和公开 GitHub 证据。真人登录界面的验收仍须人在 PR 中确认，并留下脱敏的验收范围；自动检查无法替代人工真实操作。

## 一、结论与目标

在现有 ThreadLine 中扩展独立的「Fork 双分支对照（Beta）」，不重新开发浏览器工作台，也不引入桌面常驻服务、自定义 MCP 或自动发送。第一期完成可追溯的双聊天对照：冻结共同材料 W₀ 与指令 P、计算 SHA-256、创建两个独立空白会话并填入同一文本、用户人工发送、采集完整纯文本回复、显示去标签 X/Y 对照、记录用户裁决并导出自包含 JSON。

第一期**不实现自动 Flush、不自动提交消息、不自动重发、不运行 LLM 裁判、不提供 JSON 导入、不宣称验证 Fork-and-Flush 的因果收益**。功能入口默认关闭，原有 ThreadLine 课题管理与研究整理流程保持不变。

## 二、已核实的当前进展

### 2026-10-24 P1-CORE 合并对账与完成证据登记

独立核对 GitHub 事实后的结论（不信任聊天快照）：

| 项目 | 事实 | 计划表状态 |
| --- | --- | --- |
| main | `b0d470b3d7a386f2243f1bafb26aa54c7fcc26a0`；P1-CORE PR [#10](https://github.com/siskosun/ThreadLine/pull/10) 于 2026-10-24T03:56:34Z 合并；merge 提交 `verify` 检查 success（check-run `b0d470b3`） | P1-CORE → `done`（新增 canonical JSON） |
| P1-CORE 证据 | 新增 [evidence/P1-CORE.json](ff/evidence/P1-CORE.json)：PR#10、merge SHA、9 个 ff-core/ff-db/ff-background-toggle 回归用例；无人工门禁（`no`） | 线上由 `check-plan.mjs --github` 复核 |
| 合并后回归 | Windows 本机（Node v26.10.0、Python 3.12.10、Playwright 1.64.0）：`npm run verify` **190/190**、`npm run test:e2e` **3/3** 合成 MV3 全 PASS，0 自动发送 | 不等于 Z0-LIVE 真实验收 |
| Release 作业 | merge 提交上 publish 作业失败：`build-release.py` 仍断言 PR#10 之前的旧守卫符号 `isTrustedPanelSender`；修复 PR 已单独提交 | 不阻塞 P1-CORE `done`（证据契约只要求 `verify` success） |
| Z0-BASE | PR #1 仍 Draft/open；其实现血统已随 PR #10 进入 main；所有者 `MANUAL_ACCEPT Z0-BASE <PR_HEAD_SHA>` 仍缺 | 保持 `in_review` / PR#1 |
| Z0-LIVE | 无变化：无绑定 HEAD 的完整真人签署 | 保持 `blocked`；P2-FORK 继续不得执行/评审 |

### 2026-10-23 验收对账（main 与开放 Draft PR）

独立核对 GitHub 事实后的结论（不信任聊天快照）：

| 项目 | 事实 | 计划表状态 |
| --- | --- | --- |
| main | `f3109ebb6e5e76f4c34670b10654bd0127471bea`；治理 PR [#2](https://github.com/siskosun/ThreadLine/pull/2) 已于 2026-10-21 合并；merge 提交 verify CI success | R-REUSE → `done`（新增 canonical JSON） |
| Z0-BASE | Draft [#1](https://github.com/siskosun/ThreadLine/pull/1) 仍 open；Windows runner + 合成 E2E CI 绿；所有者 `MANUAL_ACCEPT` 未出现 | 保持 `in_review` / PR#1 |
| Z0-LIVE | 仅有部分脱敏 Edge/Tabbit 零发送记录；无绑定 HEAD 的完整真人签署 | 保持 `blocked`；**不得标 done** |
| P1-CORE | Draft [#3](https://github.com/siskosun/ThreadLine/pull/3)、收敛 [#9](https://github.com/siskosun/ThreadLine/pull/9)、续作 [#10](https://github.com/siskosun/ThreadLine/pull/10) 均有冻结/IDB/四态/单写者实现与测试 | 保持 `in_review` / PR#10（未合并 ≠ done） |
| 叠加修复 Draft | [#5](https://github.com/siskosun/ThreadLine/pull/5) 附件草稿、[#6](https://github.com/siskosun/ThreadLine/pull/6) 面板来源、[#7](https://github.com/siskosun/ThreadLine/pull/7) 恢复不变量、[#8](https://github.com/siskosun/ThreadLine/pull/8) 提示恢复；均 Draft、CI 绿、已并入 #9 候选 | 不单独改任务表；以 #9 为 main 目标评审面 |
| P2/P3/P4 | 无授权实现；依赖 Z0-LIVE/P1 正式完成 | 保持 planned / deferred |

自动测试通过 ≠ 真人 Windows 签署 ≠ 真实登录 ChatGPT 验收 ≠ 任务 `done`。本轮继续在 #9 血统上加固 P1（创建身份不可篡改）并提交 Draft 评审；不启动 P2-FORK / P3-REPORT / P4-AUTO。

### 2026-10-23 已验收修复与 P1 核心的 main 集成候选

- 用户已明确确认验收范围为“当前所有修复与 P1 核心验收”。这份确认作为用户报告记录；此前 Agent 未能完成的 Edge 控制预检日志保留，未改写为 Agent 实测成功。
- [Draft PR9](https://github.com/siskosun/ThreadLine/pull/9) 收敛 PR1/3/5/6/7/8；续作 [Draft PR10](https://github.com/siskosun/ThreadLine/pull/10) 增加 IndexedDB 创建身份不可变保护与本次对账。集成回归见 [集成记录](ff/evidence/ACCEPTED_INTEGRATION_20261023.md)。
- P1-CORE 保持 `in_review` 并关联 PR10；仍需授权合并后的准确提交、CI 与 `P1-CORE.json` 才能按证据契约登记 `done`。Z0-LIVE 维持 blocked。
- 下一步：评审 Draft PR10；人审决定是否合并；合并后补 P1 完成证据；完整 Z0-LIVE 签署前不进入 P2-FORK。计划表变更须随 PR 人工复核。

### 2026-10-23 开发接续核对（证据更新，任务状态未放行）

- GitHub 本次核对：main `f3109ebb6e5e76f4c34670b10654bd0127471bea`；PR #1/#3/#5/#6/#7 均仍 Draft/open、未合并。下方 2026-10-21 表格是历史快照，不代表最新 PR 开发情况。
- PR #7 代码候选 `07b37731326517fa8c70fca3c7676eaaac526edd` 已组合 P1 核心与来源/草稿保护修复；对应 Windows 本机 183/183 Node、3/3 合成 Chromium E2E 通过。准确提交的 [Linux CI](https://github.com/siskosun/ThreadLine/actions/runs/39957077821) 与 [Windows CI](https://github.com/siskosun/ThreadLine/actions/runs/39957077788) 均通过。这些结果不替代正式合并或真人验收。
- 实际 Tabbit 对该代码的六个资源指纹、普通预填、外置原生附件保护及移除后显式恢复已有脱敏证据。长文本 23,569 字节逐字/哈希一致，附件拒绝预留/ACK 为 0/0，恢复成功为 1/1；新增发送 0 次。详见 [本次实测与剩余门禁](ff/evidence/TABBIT_ZERO_SEND_20261023.md)。Edge 当前候选 NOT RUN，Z0-LIVE 仍 BLOCKED / NOT SIGNED。
- 本阶段只归档证据和更新进度，未新增 P2/P3 代码。此文档提交的回归与 CI 以 [PR #7](https://github.com/siskosun/ThreadLine/pull/7) 最终 HEAD 检查为准；旧代码提交的测试不会冒充新 HEAD 验证。
- 下一步：完成剩余真实验收及用户最终风险确认，明确授权集成/合并并收集合并 SHA 证据；在 Z0-LIVE 和 P1-CORE 满足正式完成契约前，P2-FORK 不启动，P3-REPORT 继续依赖 P2-FORK。状态表、依赖、签署与发布规则均未修改。本计划新增的事实记录须随 PR 人工复核。

### 2026-10-23 真实测试驱动的提示恢复修复

后续零发送验收确认纯空白、多行草稿与未知预填不重放，但发现未知状态提示被页面移除后丢失。已先红后绿补充最小、有次数上限的提示恢复，Windows 189/189 Node、3/3 合成 MV3 通过；不改变预填/来源/存储规则。[Draft PR8](https://github.com/siskosun/ThreadLine/pull/8) 代码提交 `1f7578f` 的双平台 CI 通过。真实修复版复测受扩展检查器激活失败、Tabbit 扩展 URL 导航拒绝阻塞；仅磁盘更新不算加载验证。证据及红绿日志见 [提示恢复记录](ff/evidence/HANDOFF_NOTICE_RECOVERY_20261023.md)。下一步是恢复可验证的扩展控制通道并复测、完成剩余真人门禁；真实 Edge 和完整 Z0-LIVE 仍未签署，P2/P3 不放行。本段只更新实际进度，不修改任务表或依赖，计划文件变动仍需人工复核。

以下为 2026-10-21 历史快照（**已被上方 2026-10-23 对账取代**；保留供审计，勿当现状）：

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 主仓基线 | 当时 main `d40d13f`，v0.6.1 | 历史 |
| Windows 修复及第零步文档 | Draft PR #1 | https://github.com/siskosun/ThreadLine/pull/1 |
| 开发前开源复用/Fork 审计 | 当时 Draft PR #2；现已合并 | https://github.com/siskosun/ThreadLine/pull/2 |
| PR-1 功能开发 | 当时仅分支；现见 Draft #3/#9 | 历史 |
| 真实登录 ChatGPT 网页验收 | **未通过（仍成立）** | docs/ff/BLOCKED.md |

GitHub CI 成功只证明相应分支的现有自动化检查通过，不代表 Windows 本地验收、真实网页登录验收或新功能可用。不得把无法执行的人工环节写成通过。

## 三、复用结论：扩展现有项目，避免造轮子

**最终选型：EXTEND EXISTING + 少量复用代码思想及回归测试。** 不把 Chat On Steroids 整套 Electron + 浏览器扩展 + 本地 MCP 架构替换成 ThreadLine，也不因其具备多 Agent 演示就跳过真实网页验收。

| 来源 | 已识别的可借鉴部分 | 本项目决定 |
| --- | --- | --- |
| [Panelize](https://github.com/Manho/Panelize)（MIT） | `content-scripts/chatgpt-composer.js` 当前/旧版编辑器定位；`tests/live/providers.live.test.js` 真实站点默认只填入不发送、保护用户草稿、事后清理；焦点保护测试 | **第零步主要测试参照**；复用设计与用例，不整包引入多模型面板及 iframe 架构 |
| [Chat On Steroids](https://github.com/totec448-spec/chat-on-steroids)（MIT） | `src/main/session/correlation.ts` 的确切归属证据、`resume-gate.ts` 的发送/接续排他门禁、`docs/chatgpt-turn-signals.md` 的完整结束判断；Issue [#71](https://github.com/totec448-spec/chat-on-steroids/issues/71)、[#407](https://github.com/totec448-spec/chat-on-steroids/issues/407)、[#414](https://github.com/totec448-spec/chat-on-steroids/issues/414) | 借鉴会话身份、逐命令状态和故障测试；不移植桌面/自定义 MCP 控制层 |
| [Haz4rdovisk Fork](https://github.com/Haz4rdovisk/chat-on-steroids-mainstream) | 2026-09-23 首次发送回执：用户消息早于会话路由、Markdown 序列化、可信回执；2026-09-25 退休监听器取消注册；2026-09-26 工作报告已存/已提供/已确认分层 | 重点移植**验收不变量**，不可机械复制旧版桥接逻辑 |
| [Repcoders Fork](https://github.com/Repcoders/chat-on-steroids) | PR [#25](https://github.com/Repcoders/chat-on-steroids/pull/25) 未发送草稿持久化；[#35](https://github.com/Repcoders/chat-on-steroids/pull/35) 密钥形状检查；[#44](https://github.com/Repcoders/chat-on-steroids/pull/44) 中文文本差异比较 | #25 可供第一期参考；#35、#44 后置。三项截至本次检查均未合并，不等于上游已发布 |
| [Codexless](https://github.com/liyana31811/Codexless)（Apache-2.0） | 已授权浏览器工具、未知结果防重放 | 辅助参考，不作为底座 |
| [AI Chat Sync](https://github.com/legendjw/ai-chat-sync) | 跨站同步发送 | 与第一期人工发送要求冲突，不采用 |

**复用限制：** 开源许可证不等于 ChatGPT 网页自动化操作授权；复制代码时单独核查原文件许可证、保留署名。两个大型 CoS Fork 与当前上游主线分歧很大，不能直接以 Fork 默认分支代替主仓。详细比对见 PR #2 的 `docs/ff/REUSE_AUDIT_20261021.md`。

## 四、硬性架构与数据约束

1. **唯一写入者：** 扩展后台 `background.js` 承担实验状态变更入口；`ff.html` 只负责界面和发起操作。MV3 Service Worker 可暂停，任何关键进度都要持久化，并以操作幂等键和版本号防止重复写入。
2. **独立存储：** 新建 IndexedDB `threadline_ff_v1`，保留实验、A/B 分支、attempts[]、状态历史、捕获来源、裁决。原课题 schema、原备份格式、三天采集缓存不改变；第一期 JSON 可导出但**不可导入恢复**。
3. **权限最小化：** 独立 `FF_*` 消息接口，精准校验扩展页面来源、实验/分支/尝试/标签页归属。实验页面不得继承 `MUTATE`、任意备份或任意标签页采集权限；不得扩大 host permissions。
4. **实验隔离：** 两个新会话不得自动关联普通 ThreadLine 课题，不继承课题同步或收口拦截。默认仅支持非 Project 的普通新聊天；不以 Temporary Chat 为已支持路径。
5. **输入及输出安全：** W₀/P、采集回复通过 `textContent` 等安全纯文本方法展示，不执行其中的 HTML/脚本；导出与日志不得含 Cookie、Token、认证头。现有采集器读取同源授权头的事实应如实记录，不能声称链路完全不接触凭据。
6. **人工隔离确认：** 记忆、引用聊天历史、两边自定义指令、模型、思考强度、工具配置和项目归属分别记录 `yes/no/unknown`，并记录人工确认时间。人工确认不等于已验证服务端隔离。第一期不宣称受控因果实验。
7. **长度限制：** 冻结的最终发送文本不超过 24,000 UTF-8 字节，拒绝而非静默截断。必须验证 ProseMirror 编辑器在近上限长度、中文、emoji、代码块和换行情况下的实际填入/回读。

## 五、输入一致性契约

冻结 W₀ 与 P 后，按固定模板组合**同一份**最终发送文本，分别保存冻结原文和 SHA-256。规范化规则版本固定为 `canonicalization-v1`：

- `frozen_hash`：移除开头 BOM，将 CRLF/CR 改为 LF；**不**修剪首尾空白、**不**合并内部连续空格、**不**删除 Markdown 或代码缩进。
- `compare_hash`：基于上述文本，再将 NBSP 变为普通空格，并修剪整段首尾空白；内部空格与换行不变。
- 用户实际发送的消息应从可信完整的来源读取，不能把已经经过 `trim()` 的有损采集投影宣称为逐字一致。网页渲染或 Markdown 自动转义导致的等价关系必须经针对性测试确认，不能任意放宽。

四级比较：`exact`（可信来源完全一致）、`canonical_equivalent`（按已冻结规则一致）、`unverified`（文本源不可信或不完整）、`differs`（有实证的输入差异）。仅前两级允许完成判定；`unverified` 对应 `unknown`，`differs` 对应失败/排除。分别比对 A/冻结、B/冻结及 A/B 两两一致性，持久保存原始哈希、比较哈希、规则版本及来源说明。

## 六、完成与失败状态契约

四种主状态：`pending`、`done`、`failed`、`unknown`。用附加执行阶段标明 `created`、`draft_ready`、`awaiting_send`、`generating`、`capturing`；每次转换写入时间、原因、尝试 ID 与证据。

只有**同一会话 ID**、**输入一致性合格**、**确认只有一次用户任务**、**对应的最终纯文本回复完整**、**生成结束有至少两类可检查的信号**、**数据已成功保存**，才能将该分支标记为 `done`。`captureComplete=false`、旧版采集回退、文本截断、工具/非文本内容无法抽取、重新生成、额外追问、会话身份冲突均不得自动认定成功。

可用信号包括页面从生成转为结束、最后回复稳定不少于 5 秒、以及会话数据中的可信结束标记。停止按钮消失或固定等待时长**不能单独证明完成**。

未知是否发送、发送后丢失回执、浏览器关闭/重启、页面结构变化、限流状态无法确定等，一律 `unknown`，**不得自动重发**；人工新运行使用新 attempt ID，不覆盖先前失败记录。双分支只有两个指定 attempt 均 `done` 才能进入正式对照。

## 七、实施阶段与放行条件

### 任务 0：Windows 开发基线

- 修复 `threadline-extension/scripts/check-syntax.mjs` 的 Windows URL 路径转换：使用 `fileURLToPath`；从非仓库工作目录运行仍应扫描正确 JS 文件。
- 实际在 Windows 跑 `npm run verify`；装好 Playwright 及 Chromium 后运行 `python test/extension-e2e.py`。记录 Git SHA、浏览器和运行环境、原始测试计数与日志；不得以先前评审声称的 94 个通过代替本次实测。
- 当前相关代码在 Draft PR #1；CI 已绿但 Windows 和真实账号门禁仍未验收。

### 第零步 / PR-0：真实网页登录能力验收

用户在已登录的 Chrome/Edge 上配合，Agent 负责准备与记录。测试：

1. 创建普通新聊天；明确拒绝 Project 和未验收的 Temporary Chat。
2. 短文本及接近 24KB 的长文本填入后回读，核查多编辑器、中文、emoji、代码、换行、已存在草稿与清理；**不自动发送**。
3. 用户人工发送后读取真实用户消息，记录 exact / canonical_equivalent / unverified / differs；处理用户消息先出现、会话 URL 后生成、Markdown 序列化。
4. 等待回复结束，至少两类信号互证；核查最终回复与会话身份；非文本/复杂工具回复保守 `unknown`。
5. 双 tab 同时执行、交错结束，绝不串线；刷新、扩展重载、网络断开、限流、选择器变化、旧监听器再注入等异常均不可无依据重发。

真实发送预算原则上不超过 12 次，优先使用无敏感信息的测试文本。用户在 PR-0 留下有环境版本和脱敏证据的验收确认前，PR-2/PR-3 不启动依赖真实网页的交互开发；失败则先修浏览器适配器。

### PR-1：冻结与状态模型（可与 PR-0 并行）

- 新建 `ff-core.js` 与 `ff-db.js`，实现 UTF-8 长度门槛、SHA-256、不可变冻结、规范化比较、四态状态转换、独立 IDB、attempts 历史、revision 防并发覆盖。
- 增加功能开关（默认关闭）及实验入口的基础结构；不进行真实发送。
- 单元测试覆盖 BOM/CRLF/NBSP/尾随空白、代码块、CJK/emoji、伪造哈希、重复状态更新、持久化失败、旧数据兼容。
- **四态状态机在 PR-1 落地**，不留到 PR-3。

### PR-2：双分支创建与人工发送

- 依赖 PR-0 人工签署通过；后台登记意图后才创建两个不同新标签，填入相同冻结文本，回读核对且永不点击 Send。
- 发送后确认实际用户消息与会话 ID；标签页 ID 仅作临时标识，导航/重启可恢复正确身份；不同实验分支不得同步普通课题结论。
- 并发创建、发消息前刷新、worker 暂停与恢复、过期监听器、重复上报、焦点抢占均有测试；代码级断言填入过程 `click/submit` 次数为 0。

### PR-3：结果采集、X/Y 对照与导出

- 按完整性和身份核查完成采集。A/B 同时生成、交错完成、单侧失败、部分截断、接口回退与数据库写入失败均明确记录。
- 只有双方 `done` 且输入比对通过后才生成 X/Y 随机映射；首次用户裁决前不泄露对应关系。记录随机种子及用户 `preference`（X/Y/tie/inconclusive）、criteria、confidence、notes、decided_at；用户裁决后可揭盲。
- 简单双栏纯文本展示，不自动判断赢家，不宣称严格盲评；导出自包含 JSON，含 W₀/P、规则与哈希、分支、attempts、完整性和裁决；不含凭据。
- 对外说明 JSON 第一期开启**仅导出、不导入**，也不替代原有备份功能。

## 八、测试、发布与止损

每个 PR 运行仓库现有 `npm run verify` 及可执行的合成 Chromium E2E；最终再做真实登录网页闭环验收。新回归至少覆盖：长文本、两种编辑器、多标签交错、重复事件、Service Worker 重启、非法 FF 消息来源、不可信输出/XSS、凭据泄漏、单侧失败不对照、unknown 不重发、旧课题数据同目录升级。

所有 PR 先 Draft/评审，不直推 main、不自动合并、不自动发布 Release。发布前统一检查 `manifest.json`、`package.json`、README/CHANGELOG/VERIFY 与 `scripts/build-release.py` 既有版本/来源校验；正式 Beta 版号拟定 v0.7.0，**尚未发布**。

出现真实网页门禁无法通过、会话归属无法确认或发送状态不可判定时，停止 PR-2/3；不允许删除测试、放宽断言、用合成页面冒充真实验收。过程与阻塞仅记录于 `docs/ff/PROGRESS.md` 和 `docs/ff/BLOCKED.md`，不得将计划口号当成执行结果。

## 九、第二期候选（当前不实施）

在第一期至少一次真实可复核双分支试验产生可验证价值后，再评估 K=4 多会话编排、自动 Flush、三次独立预检、best-of-N、等预算对照、隐藏校准题、独立评审和 JSON 导入。比较既有工作流与隔离工作流时明确记忆/历史等混杂，不凭一次 LLM 裁判认定因果收益。

如果第一期的主要风险仍是 ChatGPT 网页适配与回执可靠性，则先改善稳定性而非扩大自动化。

## 十、下一步与维护规则

当前顺序：R-REUSE 与 P1-CORE 均已合并且登记 canonical 证据；P1-CORE 完成登记与 Release 打包符号修复各自以独立 PR 提交人工复核；PR #1 的 Windows 基线仍待所有者 `MANUAL_ACCEPT`；Z0-LIVE 保持 blocked，未签署前不得执行/评审 P2-FORK；P3-REPORT 等待 P2-FORK；第二期保持 `deferred`。

**GitHub 是唯一权威持久位置。** 本文件负责目标、阶段、任务状态及验收标准。根目录 `AGENTS.md` 约束执行者；`docs/ff/REUSE_AUDIT_20261021.md` 是复用证据，不是计划；`docs/ff/DEVELOPMENT_PLAN.md` 只保留重定向。ChatGPT Library 中的历史副本只供查看，不能作为当前状态来源。

所有 Agent 开工及中断恢复时重新读取本文件及最新 main/PR，先核对真实状态；更新状态必须与测试、合并和人工批准证据一致。测试失败或真人验收未过时，不能宣称发布完成。维护者应在合并 PR 后核对 GitHub Actions 与计划中的实际进展。
