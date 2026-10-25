# ThreadLine 开发进度记录

任务定义和正式状态唯一来源：[docs/PLAN.md](../PLAN.md)。本文件只记录发生过的事件与证据，不自行认定任务完成。

## 2026-10-25 当前状态复验与面板修复候选

- 基线 main `f43fd072eb6f85dc78bddcc9853899c103293b73`，既有 233 项测试及 4 组合成 E2E 绿灯；ROOT 与两个只读复核发现十项缺陷，并以独立探针确认。完整事实、复现器及边界见 [复验记录](ACCEPTANCE_20261025.md)。
- 已实施 R01（L1）：面板定位控件字符串缺少引号导致列表崩溃；真实 MV3 面板回归修复前 exit 1、修复后 exit 0。其余 R02–R10 不在本次产品修改内，进入 L3 修复计划；未合并、未发布、未升级用户配置。
- 治理变更明确提请人工审阅：PLAN 中 S0A/S1A/S1B 从 done 改 blocked；S0B 因依赖同步 blocked。保留原证据 JSON、历史签署及完成条件，不修改校验器、工作流或放宽断言。
- 外部 Plan Review 待完成；真实研究工效、登录页面定位和已有 K=4 F3 采集停滞仍未被本次测试覆盖。S2 不启动。
- 候选验证：计划结构 12 项/8 done 通过；完整 verify 232/233，唯一失败是旧测试固定全部 done（保留断言，提请人工处理）；四组合成 E2E exit 0。全局 verify-run helper 被未签名策略拒绝，使用原生命令留存结果但未声明 helper FRESH。

## 2026-10-24 外部有条件计划评审采纳

- 收到用户提供的阅读副本评审（有条件通过 S0–S1）；以 PR #21 `de27077b691e9eafd1986940943f989a677e16db` 及 main `a66e9b09f43986c6e2ae1b4219df4a95c2cc317a` 重新核对。外部未直接看源码，回复没有 helper SHA 签名；不虚构 FRESH。ROOT 的四项事实缺口判定为 CONFIRMED，对应建议 ACCEPTED；完整处置见 `PLAN_ADOPTION_20261024.md`。
- PLAN 补稳定依赖边及上下游版本确认历史、单事务 IDB 权威写入和单向只读 decision 投影、worker 单写者及持久 CAS/操作去重；旧编辑/备份/删除入口也纳入一致性约束。
- S0a 存储/恢复与采纳摩擦成为关键路径，S0b 定位最多8小时且可降级；S2 预注册完整率≥90%、潜在召回≥90%、精确率≥80%、配对耗时改善中位数≥15%，增加独立冻结真值、2例第二人标注、离线闭包和操作日志。这些为提议的门槛，不是测得结果。
- 其余建议已补入：分阶段字段、修改类型/结果映射、容量默认值、原文备份提示、工期区间和维护成本比较。根据 Chrome 官方文档纠正普通清除浏览数据会清除扩展 IndexedDB 的事实子项；备份与淘汰验证要求保留。
- 本次 Windows `npm run verify` 207/207 PASS、`npm run test:e2e` 3/3 合成 MV3 PASS，exit 0；日志位于本地工作区 `work/plan-review-logs`。计划结构、相对链接和机器表不变检查通过；产品源码/权限/工作流/检查器相对 main 无差异。精确提交的远端 CI 以 PR 检查为准。
- CLASSIFICATION=L2 planning，阶段为 PLAN_ADOPTED（S0–S1 有条件范围）；同一轮评审不重复索取批准。S0 原型、容量/恢复探针、定位小样和 S2 试点均未执行；当前任务仅完成计划修订。S1 仍须 S0a 证据，实施登记及后续 L3/Final Review 门禁保持。未新增产品代码、合并 main、发送真实消息或发布版本。

## 2026-10-24 调研转开发计划（Draft PR #21 更新）

- 核对 main `a66e9b09f43986c6e2ae1b4219df4a95c2cc317a`、v0.8.0 与现有 8/8 done 登记；同步最新 main，替换旧 Draft 中过期的 v0.7 状态及 v0.8 路线名称。历史进度按当时快照保留。
- 正式 PLAN 第十一节增加 S0–S5 候选路线，首轮仅建议 S0–S2：来源/结论版本、人工采纳、少量人工依赖和可编辑交接；试点通过后再做影响传播与局部复核。备份恢复前置，不让已采纳依据依赖三天缓存。
- 新增 `REUSE_AUDIT_20261024.md`：核实 Toolkit MIT、Argdown core MIT、Graphiti Apache-2.0、LangGraph MIT；明确 Toolkit 函数/测试移植与 Argdown 条件采用方案。本次没有第三方代码导入，没有产品实现。
- CLASSIFICATION=L2（跨模块设计与规划）；后续持久化/兼容/删除实施触发 L3。当前 PLAN_GATE_READY；Global Workflow 的外部计划评审待提供，不把本次文档自检替代该 Gate。机器表、检查器、证据 JSON 与运行时文件相对上述 main 不变。
- Windows 本机验证：Node v26.10.0、Python 3.12.10、Playwright 1.64.0；`npm run verify` 207/207 PASS，`npm run test:e2e` 三套合成 MV3 PASS，均 exit 0；机器任务表与 main 逐字一致，`git diff --check` 通过。完整日志保存本地工作区，准确提交 CI 以 PR 检查为准。
- 仓库没有 `tools/verify-run.ps1`，上述为直接命令证据，不伪装成该 helper 的 FRESH Gate 记录。External Plan Gate 的 Required Verification Labels 为 NONE，运行时实施尚未开始。本轮未进行真实 ChatGPT 网页操作、发送、合并 main 或发布。

## 2026-10-24 P2/P3/BETA 完成登记：真实双分支闭环由所有者执行

- **P2-FORK（PR #17 合并）**：双分支发起/精确预填/会话绑定/重启恢复/显式重预填；8 个后台测试 + 全链路合成 E2E；0 自动发送代码级断言。
- **P3-REPORT（PR #18 合并）**：X/Y 盲对照（种子纯函数映射）/裁决记录/揭盲/自包含导出；门禁、幂等、无凭据断言齐备。
- **BETA-RELEASE（PR #19 合并）**：v0.7.0 版本升级与文档；CI publish 已创建 [Release v0.7.0](https://github.com/siskosun/ThreadLine/releases/tag/v0.7.0)。
- **真实双分支闭环**（所有者 + 受托 Agent，详见 [evidence/BETA_LIVE_LOOP_20261024.md](evidence/BETA_LIVE_LOOP_20261024.md)）：所有者在无调试器浏览器手动发送两分支（生成正常），扩展绑定两个独立会话并完成 exact 分类；采集后两分支 done（双信号）；X/Y 盲对照后所有者裁决 Y 更好（语句更通顺，置信度高），揭盲 Y=分支 B；导出 rev 10 快照。
- **环境发现**：Chromium 缓存扩展 SW 脚本，磁盘更新不随浏览器重启生效，须显式 `chrome.runtime.reload()`（已记入 VERIFY/IMPLEMENTATION 由代码注释承担）。
- 签署：P2-FORK/P3-REPORT/BETA-RELEASE 三个 MANUAL_ACCEPT 分别留于 PR #17/#18/#19，受托 Agent 代留（所有者会话内明确授权）。
- **第一期全部完成**：计划表 7/8 done（P4-AUTO 保持 deferred）。


## 2026-10-24 Z0-LIVE 关闭：隔离实验 + 人工清单 + 签署登记

- **隔离实验（决定性）**：S6 由所有者在 CDP 附加窗口真实点击发送——消息持久化但生成中止（排除合成点击假设）；随后在无 `--remote-debugging-port` 窗口（扩展已加载）手发消息——**正常生成**。结论：生成中止由调试器附加触发，与扩展无关；机器观测生成循环在本站点技术上不可行。此发现同时排除了一个潜在的 P0 产品缺陷嫌疑。
- **人工清单（所有者本人，无调试器窗口）**：双标签 A/B 同文本发送对照（独立生成、无串线）；面板完整采集成功；刷新无重复发送。2026-10-22 以来缺失的"双标签生成重叠"以所有者人工确认记录（机器不可观测项）。
- **签署与登记**：`MANUAL_ACCEPT Z0-LIVE` 留于 PR #10（comment 6381193169，head `3598442…`，所有者委托代留）；`Z0-LIVE.json`（test_cases 空——Z0-LIVE 非 CODE_TASKS；manual 块含委托与范围声明）；计划表 `blocked→done`；快照测试更新（done 集合 4 项，P2-FORK/P3-REPORT/BETA 断言保持 planned/not-done；依赖负向控制改用 P3-REPORT→PR#99，因 P2-FORK 依赖已全部解除）。
- **门禁状态**：R-REUSE、Z0-BASE、P1-CORE、Z0-LIVE 均 done；**P2-FORK 依赖解除，进入可开发状态**；P3-REPORT 等待 P2-FORK。无 blocked 任务。
- 隔离实验所用临时 profile（含 cookie）验证后删除；无凭据落盘。

## 2026-10-24 委托验收执行轮：Z0-BASE 登记；Z0-LIVE 零发送 4/4、生成循环账号侧阻塞

- 所有者全权委托执行。PR #11、#12 已按授权合并（`d7161ea`、`3f17af7`）。PR #1 因登记提交信息中的 "close #1" 关键字被 GitHub 在 PR #12 合并时自动关闭（与既定 superseded 处置一致，已如实记录）；main 因此短暂红色，本登记 PR 合并后恢复。
- **Z0-BASE 登记**：完成载体由 PR#1 改为 PR #10（Windows 基线内容随 #10 入 main）；所有者委托签署 `MANUAL_ACCEPT Z0-BASE 3598442…` 已留于 PR #10（comment 6380321705）；`Z0-BASE.json`（pr_number=10、merge `b0d470b3…`、2 个测试用例）随本 PR 提交；表 `in_review→done`、快照测试同步。
- **Z0-LIVE 真实站点（委托执行，详见 [REAL_SITE_DELEGATED_20261024.md](evidence/REAL_SITE_DELEGATED_20261024.md)）**：
  - Edge 156 临时 profile + CDP：扩展 worker 运行时指纹 6/6 = main `b0d470b`（首次达成运行时级核验）；`tl_ff_enabled_v1` 非 true（默认关确认）。登录态经本地回环 cookie 注入，值不落盘不记录；临时 profile 已删除。
  - 零发送套件 **4/4 PASS**（生产交付路径）：既有草稿保护、132 字节 exact、23,569 字节 exact（SHA-256 与 PR#7 历史真实站点记录一致）、`?temporary-chat=true` 拒绝。全程 0 发送。
  - 委托发送 3 次（Tabbit×2、Edge×1）：用户消息均持久化（S4 exact+canonical 双通过），但 `POST /backend-api/f/conversation` 均 `ERR_ABORTED`、零助手回合（40+ 分钟复检）。判定账号侧条件（持续 429、排除扩展干扰）。按契约记 unknown/failed，未重试。
  - **未签署 Z0-LIVE**：生成循环验证未完成，虚假签署违反证据契约；Z0-LIVE 保持 `blocked`，P2-FORK 不放行。
- 本轮全部浏览器操作由受托 Agent 在所有者明确授权下执行；未记录/未持久化任何凭据或会话令牌。

## 2026-10-24 验收委托轮：Z0-BASE 路径事实 + 真实站点复验中止于 429

- 仓库所有者明确委托本轮验收。**签署留言未代留**：EVIDENCE.md 明文禁止 Agent 代替用户留下 `MANUAL_ACCEPT`，本轮也未合并任何 PR、未发送任何消息。
- Z0-BASE 路径事实：Draft PR #1 与 main 冲突（内容已随 PR #10 进入 main）；核实 PR #10 head `359844286f7bf52e71e30faaddedd6642c29d9d1`、merge `b0d470b3...` 且 verify success，PR #10 可作为 Z0-BASE 完成载体（其文件含 windows-baseline.yml 与 check-syntax.mjs）。建议在 PR #10 留 `MANUAL_ACCEPT Z0-BASE 359844286f7bf52e71e30faaddedd6642c29d9d1`，登记 PR 中的证据 JSON 以 pr_number=10、merge_commit=b0d470b3d7a386f2243f1bafb26aa54c7fcc26a0 编写；PR #1 随后关闭为 superseded。计划表变更随登记 PR 人工复核。
- 真实站点（已登录 Tabbit 浏览器）零发送复验：Tabbit 加载路径已同步为 main `b0d470b` 扩展（6 文件磁盘指纹，其中 4 个与 PR #7 历史证据一致作交叉验证）；chatgpt.com 一次导航确认已登录、无登录墙；随后出现 429（composer/telemetry POST `ERR_ABORTED` + `SITE_RATE_LIMITED`），**按停止规则立即中止，未执行任何用例，0 发送**。运行中扩展仍为旧构建（MV3 worker 不暴露给 Playwright、无 CDP 端口、computer use 不可用，`chrome.runtime.reload()` 无法远程触发）。详见 [REAL_SITE_429_20261024.md](evidence/REAL_SITE_429_20261024.md)；BLOCKED.md 已登记 429 项与 PR #1 冲突事实。
- 本轮只新增事实与证据，未改计划表状态、依赖或签署契约；随本 PR 人工复核。

## 2026-10-24 browser/real-Edge 验证轮（门禁不变）

- PR 状态浏览器级核对（GitHub 页面 DOM + 截图）：[#12](https://github.com/siskosun/ThreadLine/pull/12) 与 [#11](https://github.com/siskosun/ThreadLine/pull/11) 均 `Open` 且已 `ready for review`，徽标 `2 / 3 checks OK`（第三项为 publish 作业 `skipping`，非失败），与 CLI 核对一致。
- 真实安装 Edge（155.0.4283.62，`THREADLINE_CHROMIUM_PATH` 覆盖 `executable_path`）运行仓库自有三套合成 MV3 E2E：**3/3 PASS**，与捆绑 Chromium CI 结果一致。零发送、无认证账号、合成页面；日志见 [REAL_EDGE_E2E_20261024.txt](evidence/REAL_EDGE_E2E_20261024.txt)。同树 `npm run verify` 190/190。这不构成 Z0-LIVE 真实站点验收，未改任何门禁。
- 计算机操作（computer use）通道在本会话由宿主标记不可用（`Computer Use is unavailable for this node_repl session`）；browser use 仅注册 IAB 后端，无法加载 MV3 扩展或 `chrome-extension://` 页面。两者均按技能规则停止，未绕过、未改系统权限。真实登录 ChatGPT 的 Z0-LIVE 仍需用户操作。
- 本轮仅新增证据与进度记录，不改计划表、依赖或签署契约；随本 PR 人工复核。

## 2026-10-24 P1-CORE 合并对账、完成证据与 Release 符号修复

- 核对 GitHub：PR [#10](https://github.com/siskosun/ThreadLine/pull/10)（P1-CORE，续作自 #9）已于 2026-10-24T03:56:34Z 合并入 main，merge 提交 `b0d470b3d7a386f2243f1bafb26aa54c7fcc26a0`；该提交 GitHub Actions `verify` check-run 结论 success。PR #1 仍 Draft/open；Z0-LIVE 无新签署。
- Windows 本机实测 main `b0d470b`（Node v26.10.0、Python 3.12.10、Playwright 1.64.0 + Chromium）：`cd threadline-extension && npm run verify` **190/190 Node PASS**；`npm run test:e2e` 三套合成 MV3 全 PASS（持久扩展 + 子框架 NEW_CHAT 拒绝；23,569 字节 exact 零发送；Fork P1 默认关闭、24KB、CAS/重放/XSS/重启）。全程 0 自动发送；合成结果不冒充 Z0-LIVE。
- 发现并修复合并回归：merge 提交上 publish 作业失败（run 40060353674）——`scripts/build-release.py:44` 仍断言 PR#10 之前的旧符号 `isTrustedPanelSender`。修复分支 `fix/release-marker-20261024`：断言现行 `inspectPanelSender` / `requirePanelSender`，并将 `SHA256SUMS.txt` 写入固定为 LF（Windows 本机此前会写出 CRLF 使 `sha256sum -c` 失败）。本机复验：ZIP 200179 字节、sha256 `76089e37156fbb7d3bdcdea456e0f90b62b3ba15c67a699159b55305bb638c80`、`sha256sum -c` OK；测试后已还原 dist 跟踪文件。以独立修复 PR 提交评审。
- 新增 [evidence/P1-CORE.json](evidence/P1-CORE.json)：pr_number=10、merge SHA、9 个真实回归用例（ff-core 冻结/24KB/SHA-256/幂等/未知不重放/双信号、ff-db 创建身份与 CAS、ff-background-toggle 过期操作拒绝）。P1-CORE 人工门禁为 `no`；计划表 `in_review` → `done` 随本 PR 人工复核生效。
- **明确未完成：** Z0-BASE 所有者 `MANUAL_ACCEPT`（PR #1 或按证据契约改挂的 PR）、Z0-LIVE 全部真人项、P2-FORK/P3-REPORT 未启动。本 PR 不解除这些门禁。

## 2026-10-23 验收对账 + P1 创建身份加固

- 核对 main `f3109ebb6e5e76f4c34670b10654bd0127471bea`：治理 PR [#2](https://github.com/siskosun/ThreadLine/pull/2) 已合并且 merge 提交 verify success；开放 Draft [#1](https://github.com/siskosun/ThreadLine/pull/1)、[#3](https://github.com/siskosun/ThreadLine/pull/3)、[#5](https://github.com/siskosun/ThreadLine/pull/5)、[#6](https://github.com/siskosun/ThreadLine/pull/6)、[#7](https://github.com/siskosun/ThreadLine/pull/7)、[#8](https://github.com/siskosun/ThreadLine/pull/8)、[#9](https://github.com/siskosun/ThreadLine/pull/9) 均仍 Draft。
- 以 [#9](https://github.com/siskosun/ThreadLine/pull/9) 为最强 main 目标集成候选（含 #1/#3/#5/#6/#7/#8 血统）。续作分支 `cursor/p1-core-acceptance-54b2`：`ff-db.js` 拒绝篡改 `createOperationId` / `createdAt`；新增 `test/ff-db.test.js` 回归。
- 计划表纠偏：R-REUSE → `done` + [evidence/R-REUSE.json](evidence/R-REUSE.json)；Z0-BASE 保持 `in_review`/PR#1；Z0-LIVE 保持 `blocked`；P1-CORE 保持 `in_review`/[PR#10](https://github.com/siskosun/ThreadLine/pull/10)（未合并，不写 done）。未启动 P2/P3/P4。
- 本机 `cd threadline-extension && npm run verify`：**190/190 Node PASS**。本 VM 无 Python `playwright`，合成 E2E 未在本机跑。
- 准确 HEAD `8f46aee14581ba64d09bfc97609ab3bca138e442` 的 GitHub CI 已完成：[Linux checks](https://github.com/siskosun/ThreadLine/actions/runs/39987223477) 与 [Windows baseline](https://github.com/siskosun/ThreadLine/actions/runs/39987223315) 均为 success。两边 Node **190/190**；三套合成 MV3（原扩展、handoff 23,569 字节零发送、Fork P1 IndexedDB）均 PASS。线上计划门禁：`8 tasks, 2 linked review PRs, 1 externally verified done`（R-REUSE）。Release 作业 skipped。这不是 Z0-LIVE 或 P1 `done`。
- **明确未通过：** 所有者 Windows `MANUAL_ACCEPT Z0-BASE`、完整真实登录 ChatGPT Z0-LIVE 签署、P1 合并后的 `P1-CORE.json`。

## 2026-10-23 PR7 实际 Tabbit 零发送证据归档

- 实测绑定 PR #7 `07b37731326517fa8c70fca3c7676eaaac526edd`；真实扩展面板六个资源指纹与 Windows 候选匹配。实际 NEW_CHAT 建立普通测试标签，已知文字草稿得到保护；原始来源拒绝的具体接收端原因仍未定位。
- 实际原生附件位于编辑器外、同一 form 内时拒绝预填；修正后的 attemptedAt 观察器记录成功预留/ACK 为 **0/0**。移除虚构附件、确认未尝试后显式刷新，记录 **1/1**；23,569 UTF-8 字节和 2,139 个 LF 逐字/哈希一致，0 发送。正常 93 字符多行预填亦通过。
- [脱敏证据及剩余验收](evidence/TABBIT_ZERO_SEND_20261023.md) 保留早期错误计数字段、一次 429 后多执行虚构上传的操作偏差及后续纠正记录。最后一次 429 后停止站点操作；本次归档没有重试网页。
- 本增量仅发布文档，不改变源码或已安装候选。根据用户新增进度管理要求，在正式 PLAN 追加事实、验证范围和下一步；状态表/依赖/签署契约不变，该治理文档增量随 PR 人工复核。PR #7 的文档提交需重新执行 Windows 回归及准确 HEAD 双平台 CI；最终结果见 PR 检查，不能用旧 CI 冒充新提交验证。
- 真实 Tabbit 局部 PASS 不等于 Edge 或完整 Z0-LIVE；P1 合并/最终风险确认与 Z0-LIVE 人工项仍待完成，P2/P3 依赖门禁未解除。

## 2026-10-23 NEW_CHAT 面板来源兼容与授权收紧（独立修复，待人工风险确认）

- 交付快照：[`c10dc1134b29ef6d274aa2795b1a8daea6f09e00`](https://github.com/siskosun/ThreadLine/commit/c10dc1134b29ef6d274aa2795b1a8daea6f09e00)，stacked [Draft PR #6](https://github.com/siskosun/ThreadLine/pull/6)。该提交关联 [Linux CI](https://github.com/siskosun/ThreadLine/actions/runs/39936910564) 与 [Windows CI](https://github.com/siskosun/ThreadLine/actions/runs/39936910447)，远程结果以运行页为准；后续仅补记证据链接，不改变已测源码/测试。最终 HEAD 检查见 PR #6。

- 以 PR #5 `93a88d834f74ebf486a8f4572b42a5d87b008fc7` 为基线，独立分支 `codex/fix-panel-source-20261023`；PR #1/#5 仍 Draft、未合并，main 仍 `f3109ebb6e5e76f4c34670b10654bd0127471bea`。不改原附件修复、正式计划或浏览器权限。
- 用户报告：三个文件指纹与 PR #5 一致，面板运行上下文检查 true，但两次 `NEW_CHAT` 均被来源校验拒绝。**没有实际后台 MessageSender 字段**，故具体现场不匹配项仍未确定；未继续重试真实 NEW_CHAT、未发送真实消息。
- 先写新增来源回归：原代码 **4 PASS / 7 FAIL**。确认旧规则对无 tab 来源无条件放行，并对浏览器独立证明的同一面板文档仍按容器 URL 拒绝。后者仅为合成候选兼容模式，不能写成现场根因。
- 后台统一要求本扩展 ID、精确 panel.html 发送文档 URL，origin/frame 有值时不得矛盾；容器 URL 冲突仅在 `runtime.getContexts()` 返回同一活跃文档 ID、精确面板 URL/origin、顶层 SIDE_PANEL 或相同 tabId 的 TAB 时可用。缺 API/缺文档 ID/失配/异常/1 秒超时均拒绝，未认证来源不得执行任何业务副作用。
- 拒绝响应保留原错误文本，增添固定 `PANEL_SOURCE_REJECTED` 原因码及布尔匹配信息，不记录 URL、ID、Token、正文或底层错误。无自动重放。
- 本机 Windows：Node 基线 **138/138**，新回归 **149/149**；两套合成 MV3 E2E PASS，包含真实浏览器面板上下文、真实子框架 NEW_CHAT 拒绝且不建标签、原 23,569 字节 exact/附件草稿/不重放门禁。全程真实发送 0。
- 原单测夹具使用空 sender 冒充面板，改成真实的 own-ID/panel-URL 元数据，保留业务断言；首轮完整 E2E 记录到横幅先显示、ACK 尚未完成的时序失败，改为 5 秒内只读等待真实存储 ACK，仍强制最终无 pending 记录。失败日志保留，未改变生产 handoff.js。
- 详见 [脱敏证据与 Human Stop Gate](evidence/PANEL_SOURCE_20261023.md)。现场来源拒绝修复尚未真人复验，三项真实附件验收仍 BLOCKED，Z0-LIVE `blocked / NOT SIGNED`，不合并、不发布、不进入 P2/P3。

## 2026-10-23 原生附件草稿保护修复（待真人验收）

- 交付：修复提交 [`1cba735154658391ecd5cd1a8e134fedbc236987`](https://github.com/siskosun/ThreadLine/commit/1cba735154658391ecd5cd1a8e134fedbc236987)，独立 stacked [Draft PR #5](https://github.com/siskosun/ThreadLine/pull/5)（base 为 PR #1 分支）。该源码快照 [Linux CI](https://github.com/siskosun/ThreadLine/actions/runs/39918631630) 与 [Windows CI](https://github.com/siskosun/ThreadLine/actions/runs/39918631633) 均 success：138/138 Node + 2 套 MV3 E2E；Release skipped。后续证据链接补记不改变已测源码/测试。

- 本次实时核对 main `f3109ebb6e5e76f4c34670b10654bd0127471bea`、Draft PR #1 HEAD `93199fbee134f74ff45fc21df86674025f833be0`；本机初始无未提交修改。独立修复分支基于 PR #1，不推 main、不合并、不发布。
- 既有真实失败记录明确为 **FAIL**：空 contenteditable 外、同一 form 内已有虚构 TXT 原生附件，旧版仍插入并 ACK；附件虽未删除，草稿已被修改，发送 0 次。不覆盖该历史记录。
- 先新增回归：旧生产代码运行定向 Node 测试为 **17 PASS / 4 FAIL**（附件、外部预览、迟到附件、未知范围）；原基线为 **132/132**。修复为检查整个所属 form，并在登记后及 focus 后再次检查；文件选择、媒体/芯片/移除控件、未知附件标记拒绝，空上传控件允许。
- 独立本地审查另发现 focus 转移会使 document.execCommand 写入另一草稿；ROOT 红灯复现为 **21 PASS / 1 FAIL**，随后增加焦点和折叠选区归属检查。该审查不是外部 Gate；两道外部 Gate 由用户明确豁免。
- Windows Node v26.10.0 / Python 3.12.10 / Playwright 1.64.0：在实际 extension 目录运行 `npm run verify` **138/138 PASS**；`npm run test:e2e` **2/2 PASS**，含真实 MV3、23,569 字节 exact、空段落保护、附件/选中文件/焦点竞态、未选上传控件、一次登记后刷新不重放；**0 自动发送**。
- 完整证据及失败夹具调整原因见 [脱敏记录](evidence/NATIVE_ATTACHMENT_20261023.md)。真实登录 Edge 复测 **BLOCKED / NOT RUN**，当前规则要求用户操作 ChatGPT Web；合成结果不等于 Edge PASS。Z0-LIVE 仍 `blocked / NOT SIGNED`，Beta 未完成，正式计划不改。

## 2026-10-21 基线与复用
- main：`d40d13f2918c33961ced333a9884af9c853157ad`；应用 v0.6.1。
- Windows 跨平台路径修复和第零步验收清单：Draft PR [#1](https://github.com/siskosun/ThreadLine/pull/1)，自动 CI 成功，真实 Windows/ChatGPT 登录流程未完成。
- 开源复用调查：Draft PR [#2](https://github.com/siskosun/ThreadLine/pull/2)，有 [复用审计](REUSE_AUDIT_20261021.md)，合成 CI 成功，尚未合并。
- `feat/ff-core-pr1-20261021` 仅创建开发分支，未提交 P1-CORE 功能代码。
- 当前执行：将唯一计划迁入 GitHub `docs/PLAN.md` 并建立 GitHub 校验门禁；本治理 PR 的检查结果以 GitHub Actions 实际输出为准。
- 未完成：Z0-LIVE 人工真实网页验收；P1-CORE、P2-FORK、P3-REPORT 和 Beta 发布。

任何后续日志必须包含实际 commit/PR、测试命令与结果，并区分合成验收和真实登录验收。

## 2026-10-21 GitHub 唯一计划与证据门禁验收
- 当前 Draft PR：[ #2 ](https://github.com/siskosun/ThreadLine/pull/2)；**本项治理代码尚未合并进 main**，未发布新安装包。
- 权威计划已迁至 `docs/PLAN.md`；`AGENTS.md` 作为执行入口；旧 `docs/ff/DEVELOPMENT_PLAN.md` 改为非权威指引。原 ChatGPT Library 副本也改为 GitHub 指引。
- GitHub Actions [run 39603026937](https://github.com/siskosun/ThreadLine/actions/runs/39603026937) 的 verify 作业成功：**104 项 Node 测试通过**，不低于 94 项基线；计划本地状态校验通过（8 项、0 done）；GitHub 线上校验通过（2 个待验收 PR、0 个 done）；合成 Chromium MV3 集成通过；发布作业跳过。
- 反向测试覆盖：缺少状态表/任务、伪造 done 但缺 JSON、依赖未解除、阻塞无记录、已关闭未合并 PR、假人工签署，以及已合并 PR 尚未签署时保持 in_review 的合法情形。
- 真实登录 Windows Chrome/Edge 验收仍未执行；Z0-LIVE 保持 blocked。GitHub API 可以核查验收留言账号，但无法独立证明真人操作；仓库规则保护/必需评审尚未确认为已启用。
- GitHub 治理 PR 合并和分支保护设置需人审；不得仅因本次 104 项自动检查通过就将 Fork Beta 标为完成。

## 2026-10-21 PR #1 Windows 实测记录
- Windows 真机测试替代通道为 GitHub 托管 Windows runner；PR #1 HEAD `81597d5c169c48226c09adb661f7a09041fded86`，包含已合并主线的计划治理文件。
- [Windows run 39612233835](https://github.com/siskosun/ThreadLine/actions/runs/39612233835) 成功：`npm run verify` 105/105 Node 用例、路径从非仓库工作目录扫描 39 个 JS 文件、`npm run test:e2e` 合成 Chromium 真实扩展持久配置通过。
- [原始日志](https://github.com/siskosun/ThreadLine/actions/runs/39612233835/artifacts/12350647387) 已由 CI 保存，30 天留存。
- 真实已登录 ChatGPT、人工发送和真实用户设备没有测试，Z0-BASE 不升级为 done，Z0-LIVE 未解锁；勿混淆托管 Windows runner 与用户登录浏览器。


## 2026-10-22 已登录 Edge / 本机合成 E2E / 双标签观测（附件同步，未签署）
- **证据来源：** 操作者上传的 `PROGRESS(1).md` 与 `BLOCKED(1).md`。本次保存的是脱敏摘要；原始 Windows 日志、原始分页响应和截图未上传 GitHub，不能视为独立哈希核算。
- 环境：Windows 10（build 26300）、Edge 155、Node v26.10.0、Python 3.12.10；扩展 0.6.1。原始会话、浏览器扩展 ID 与本机用户路径不入公开证据。
- 初始 PR #1 `cd04e46` 本机 `npm run verify` 105/105、异目录语法扫描 39 个文件；真实 Edge 单次人工发送 S1，操作者报告 DOM 原样回读 98/98 字节，研究整理分页 1 页（约 4 条消息）完成。分页提要是截断/trim 投影，**不是独立完整原文**。
- 接续通过 `execCommand('insertText')` 填入 829 UTF-8 字节、37 个换行，仍未发送；直接 `textContent` 注入曾出现换行折叠，不归咎于扩展正式路径。另有 23,569 字节的测试输入通过页面级填入/未发送，但不是经扩展近 24KB 自身路径的验证，需继续区分。
- 更新为修复版 `11b81a5` 后，操作者报告本机 `npm run verify` **108/108**、异目录扫描 39 个文件、Playwright **1.64.0** + Chromium 合成 `python test/extension-e2e.py` PASS（MV3、storage.local、IndexedDB、只读探针、备份、重启）。扩展页单击重新加载未显出新行为，停用→启用后真实网页自检确认发送控件已识别、普通正文只标候选。**手动覆盖源代码后 Git 元数据仍是旧 HEAD，本机实测源树未另行计算 SHA。**
- A/B 双标签：分别手动发送 S2-A 与 S2-B，各一条（总预算 **3/3** 耗尽）。操作者报告两个不同会话，分别回读 **83/83** 与 **84/84** UTF-8 字节 exact（来源为按内容核对的渲染用户气泡，未作规范化）；助手答复分别对应各自标记，A 页面无 S2-B、B 页面无 S2-A；双方回复 5.2 秒稳定、无可见停止控件且具备定稿操作行，composer 已清空。
- **证据边界：** 这些是操作者对两个页面的身份与内容配对检查；生成重叠窗口没有机器记录（第一次机器快照时两页已空闲）；角色来源未通过原始分页用户消息再做字节哈希验证；以上结束现象不能独立保证完整可信的终止信号。扩展层 A/B 与会话 ID 的持久绑定尚未实现，不能把页面级配对当作 P2 完成。
- 新的选择器陷阱：`div.whitespace-pre-wrap` 在空态可能优先匹配欢迎语。**不可使用第一条、最后一条或仅按内容包含匹配就认定消息身份。** PR #1 的只读自检只提供未归属页面文本提示；源码层可靠配对仍需会话 ID、角色、未损全文与完成信号。
- 本次 PR #1 补强了只读探针与回归，禁止从欢迎语类页面文字推断用户消息，测试结论以每个提交 SHA 对应的 GitHub CI 为准。Z0-LIVE 仍 `blocked / NOT SIGNED`，`docs/PLAN.md` 不变；不补发、不自动合并、不解锁 P2/P3。


## 2026-10-22 接续草稿真实性与无发送保护（合成网页验证）
- PR #1 的 `handoff.js` 删除原先“填入字符数达到 40 即算成功”的宽松确认。现通过实际编辑器 `innerText` / `value` **全文逐字回读相等**才发送 `HANDOFF_ACK`。任何部分插入、换行变形均显示未确认提示并保留原待处理记录；不会重复插入或自动发送。
- 已有草稿连纯空白文本都视为用户数据，不清除、不覆盖；操作结束时提供复制提示。新增 Node 虚拟 DOM 测试模拟“只插入原文前 40 字符但 execCommand 返回 true”，要求不 ACK。
- 合成浏览器用 Playwright 加载真实 MV3 扩展，后台调用原有 `NEW_CHAT` 创建标签页，`handoff.js` 经过 `execCommand('insertText')` 填入含中文、emoji、NBSP、Markdown 代码块与换行的 **23,569 UTF-8 字节**文本，并逐字回读相等；分别验证空白草稿及普通多行已有草稿不覆盖。连续空行场景允许等价结果被逐字核对后 ACK，或不一致时拒绝 ACK，且全部场景 0 次自动发送。
- [Linux CI 39711053880](https://github.com/siskosun/ThreadLine/actions/runs/39711053880)、[Windows CI 39711053863](https://github.com/siskosun/ThreadLine/actions/runs/39711053863) 均成功：Node **112/112**、既有合成 Chromium MV3 集成、新增 `test/handoff-e2e.py` 通过。
- 以上不代表登录的 Edge 网页已验证近 24KB 输入，也没有验证真实 Project/Temporary 拒绝、断网/限流、扩展层双会话身份持久化或最终回复数据可信结束。Z0-LIVE 继续 `blocked / unsigned`。PR 不合并、无 Release。

## 2026-10-22 真机 Edge 无发送复测与 handoff 结构回读修复（未签署）
- 代码提交：`03cd62850a27697edd2c3da9c45c48ec8077bfa1`（本地分支 `fix/ff-phase0-live-guards-20261022`，基于 PR #1 HEAD `1ba4465`）。改动文件：`handoff.js`、`selectors.js` 及对应测试；未改后台路由、课题 schema、备份格式或 Release。
- 关键修复：
  - 空 ProseMirror 的 `innerText` 是 `"\n"`，旧逻辑误判为已有草稿；现用 `textContent`、段落/换行结构和非换行渲染文本综合判定为空，同时继续保护空格、换行文本节点和多段空白草稿。
  - ProseMirror 的 `innerText` 会在顶层段落之间加入视觉空行；现仅在多个块级节点（`P/PRE/LI/BLOCKQUOTE`）时按单换行连接块文本，单一包裹节点和普通编辑器仍回退 `innerText`。这使真实多行文本的结构化回读可逐字比较。
  - 新增页面类型 guard：`plain_chat / project_chat / temporary_chat / unknown`；仅普通聊天 `forkAllowed=true`，未知页面默认拒绝；自检 note 显示类型与拒绝原因。
  - `div.whitespace-pre-wrap` 只作为无角色候选，不提升为用户/助手消息；分页采集 429/503 重试一次后失败关闭；无角色欢迎语不进入采集。
- 本机测试（Windows，Node v26.10.0，Python 3.12.10，Edge 155.0.4283.45）：
  - 基线 PR #1 HEAD：`npm run verify` **112/112**；`npm run test:e2e` 原有合成 MV3 + 新增 handoff E2E 通过。
  - 最终代码：`npm run verify` **119/119**；`npm run test:e2e` **2/2 PASS**（`extension-e2e.py`、`handoff-e2e.py`）。
  - 最终 `handoff.js` SHA-256 `872c7b9609000b969fb0cebb0e19ca85fc5e404988de390503aa3b253adce9d8`；`selectors.js` `0bdeb077aacd8f508d5eb7fe0919900729700bd422cbb596db722862b2e29e5a`；已核对 Edge 加载目录与测试树逐字节一致。
- 真实 Edge 无发送结果（人工预算仍为 **3/3 已用尽，0 新增发送**）：
  - 普通新聊天：`plain_chat` / `forkAllowed=true`；Temporary Chat 与实际临时 URL：`temporary_chat` / `false`；Project 路径：`project_chat` / `false`。
  - 小文本：实际与预期均为 15 字符 / 21 字节，SHA-256 `91484607d159a539b15769d8b681c09f43de40d76a19db24c469979acf0d27d7`，结构回读 exact，横幅逐字核对，ACK=true。
  - 近 24KB 简单多行（CJK、emoji、NBSP、单反引号）：23,558 字符 / 23,569 字节，SHA-256 `f219a5280f1186317df007261906ae1b26d61ae117657ed7076c79b6b2ea44a7`，结构回读 exact，ACK=true，URL 仍为根路径，0 条角色消息。
  - 近 24KB 综合载荷（代码围栏、CRLF、连续空行、首尾空白）：预期 23,558 字符 / 23,569 字节、SHA-256 `4b9abbfffa9542b5eb1fb9539b418cb63af25967d54d14eb8db29bf1d05defee`；实际结构回读 23,559 字符、SHA-256 `dfac2fd59fca008bc35d13bb21e2f5ca0aff7bacdde6197fd555718f0d7c22f3`，CRLF 被编辑器归一化为 LF 且代码围栏/空行多出空行；分类为 `differs`，横幅未确认，ACK=false，未发送。
  - 已有草稿保护：ChatGPT 多次把先前测试草稿恢复到新聊天；扩展识别为 occupied，不覆盖、不 ACK、不发送，URL 保持根路径。随后由测试者清空测试草稿并刷新，handoff 重新读取记录后完成简单 24KB exact。
  - 页面刷新、扩展重载后重新打开 panel 均未发送；未验证 Service Worker 单点暂停、旧监听器重复注入、同一标签关闭重开、真实断网/限流。
- 证据边界：真实页面均未发送消息，测试标签由测试者创建并清理；未读取或上传真实会话正文、账号、Cookie、Token、扩展 ID 或会话 ID。`innerText` 的视觉空行不等于文档字节；结构回读只证明编辑器顶层块文本一致，不证明服务端上下文或最终回复完整性。Z0-LIVE 仍 `blocked / NOT SIGNED`；本轮不更新 `docs/PLAN.md` 状态。

## 2026-10-22 PR #1 综合格式风险针对性复核与执行端防护

- 根据用户提供的 `Z0-LIVE-20261022-machine.md` 与 PR #1 真机记录，综合输入含代码围栏、CRLF、连续空行和首尾空白时，结构化回读仍为 `differs`（记录的原文 23,569 字节；实读比原文多 1 个字符，原始 SHA-256 不一致）。CRLF→LF 是预设允许的规范化；**额外空行尚不满足 canonicalization-v1**。缺少原始编辑器结构快照，尚不能断定多余换行究竟是插入后内容还是读取映射误差，不将它静默删除。
- 独立复核发现 `selectors.js` 的页面类型识别只影响只读自检，`handoff.js` 此前未执行相同的拒绝门禁；本次在真正预填入口强制要求 HTTPS + ChatGPT 官方域名 + `/` 新聊天根路径 + 无查询/片段。Project、Temporary、已保存会话、未知路由和非官方站点均停止预填；不请求 HANDOFF_GET，不覆盖草稿，不发送消息。
- 预填失败横幅现在只披露预计/回读字节数与换行数，并区分“仅 CRLF 等行尾编码变化”与“还有不能忽略的文本差异”；不显示原文内容、不自动 ACK。原有严格全文一致判定维持不变，既有合成 23,569 字节正常文本验收保留。
- 功能提交 `78d6d6f9cca26a4e8af0d286059d5b81f1702b03`（包含修复测试沙箱 URL 构造器）；[Linux CI 39732527414](https://github.com/siskosun/ThreadLine/actions/runs/39732527414) 与 [Windows CI 39732527403](https://github.com/siskosun/ThreadLine/actions/runs/39732527403) 均成功，`npm run verify` **122/122 Node、0 fail**，原有 MV3 持久化与接续合成 E2E 通过（0 自动发送）。
- 此提交解决的是**执行端页面类型拒绝和差异可诊断性**，未解决真实 Edge 综合格式的无损预填；真实环境尚需在无发送测试标签采集去内容化的编辑器块级节点结构、首个差异位置及变换前后 CR/LF 计数，才能决定是否需要改变填入实现。Z0-LIVE 保持 `blocked / unsigned`；`docs/PLAN.md` 不变，PR 不合并、不发布。


## 2026-10-22 编辑器空段落双计修复（根据本机脱敏报告；CI 已复核）

- 本机 Agent 新报告确认 ProseMirror 编辑器在空段落创建 `<p><br></p>`，该元素的 `innerText` 为一个 LF；原 `editorText()` 对每个顶层块再 `join("\\n")`，将每个占位空段落计算两次。最小用例 `A\\n\\nB` 原本错误回读 `A\\n\\n\\nB`；此观察来自用户本机加载的较早代码，不等于最新 PR 实机验收。
- 独立负向测试先在 GitHub Linux [run 39775625769](https://github.com/siskosun/ThreadLine/actions/runs/39775625769) 复现失败（125 项中 124 通过，唯一失败为 `one ProseMirror trailing BR is an empty paragraph`）。随后 PR #1 提交 `9d23426dc2c149bc3e6c492a99d9485303ed930a`：仅把严格单 BR 占位的空 P 映射为空字符串，再交由顶层 `join("\\n")` 连接；不忽略两个 BR、PRE、嵌套节点或实际额外空段落。
- [Linux run 39775655808](https://github.com/siskosun/ThreadLine/actions/runs/39775655808) 与 [Windows run 39775655955](https://github.com/siskosun/ThreadLine/actions/runs/39775655955) 已通过；Windows 原始日志记录 Node **125/125**、0 fail，原 MV3 持久配置和 handoff 合成 Chromium E2E 通过，0 自动发送。
- 原 23,569 字节综合载荷未找回，因此**原样 T6 NOT RUN**。本地版本与 PR 代码曾不一致；真实已登录 Edge 必须在加载这次提交且文件指纹核对后，重测受影响用例。上次 T2–T6 正式预填均被 ChatGPT 恢复的自有测试草稿挡住（未覆盖、不发送），不可记为成功。
- 本轮不变更 `docs/PLAN.md`、不签署 Z0-LIVE、不合并或发布。扩展层双分支与异常恢复等任务仍依正式计划门禁。


## 2026-10-22 预填草稿保护与单次尝试恢复（合成环境已验证）

- **非文字草稿防覆盖**：已有文字检测之外，`handoff.js` 对可编辑节点的真实子节点结构采取保守判断。纯空编辑器或单个 P/DIV + 占位 BR 可预填；图片、附件芯片、嵌入、未知结构等即使无文本也视为占用。测试先以 `4a0d1cb` 在 Linux/Windows 复现旧判断错误（红灯），随后 `8d61b86` 修正。边界：尚未取得真实登录 Edge 中外置于编辑器的附件布局证据。
- **不明预填不自动重放**：背景新增 `HANDOFF_BEGIN`，以后台单写队列及 `chrome.storage.session` 的 `attemptedAt` 记录，在实际 `execCommand` 前独占一次自动预填机会。`HANDOFF_GET` 可读取待处理材料供用户手动复制；已尝试或无法确认状态不会自动再次插入。只有页面仍在普通新聊天根路径，且存在已登记的尝试时才允许 `HANDOFF_ACK` 清理。重载/重复监听器、失败回执无法改变此规则。
- 新增后台测试：两次并发 `HANDOFF_BEGIN` 只有一次 `autoFill=true`，错误页面及未预留的 ACK 不得消费材料。真实 MV3 合成测试：编辑器故意不可写引发不确定预填，随后同标签重载为空编辑器，必须展示“停止自动重试”、仍保留人工复制入口且不再次插入、不发送。
- 代码最新提交 `8863e638d7973ca85958bfce5b25d2bb78b88e7b`。[Linux CI 39779493270](https://github.com/siskosun/ThreadLine/actions/runs/39779493270) 与 [Windows CI 39779493156](https://github.com/siskosun/ThreadLine/actions/runs/39779493156)：`npm run verify` **132/132**，两套合成 Chromium MV3 E2E 全部通过，0 次自动发送。
- **证据边界**：这证明合成页面的失败不重放与保护策略，不是用户已登录的 Edge 对同一提交的验收。远程 Windows `sunzc` 仍离线，真实 SW 暂停、旧监听器、页面异常、分页原文/最终回复证据及真人签署仍未完成。Z0-LIVE 继续 `blocked / unsigned`；`docs/PLAN.md`、main 与 PR 合并状态未变。
## 2026-10-21 P1-CORE 启动
- 已核对 main `f3109ebb6e5e76f4c34670b10654bd0127471bea` 和唯一 `docs/PLAN.md`，发现 PR #2 已合并；PR #1 仍 Draft。
- 将既有 `feat/ff-core-pr1-20261021` 快进至上述 main，然后提交 `ff-core.js`、`ff-db.js`、`test/ff-core.test.js`、独立预览页及后台禁用门禁。尚未实现自动发送、双会话编排或结果对照。
- 实际运行环境：GitHub 工具写入源码；当前容器不能直连 GitHub 下载完整仓库，故尚未执行本机 `npm run verify` 与 Chromium E2E。以本 PR GitHub Actions 的真实结果为准；不能以模型自检当作通过。
- 仍待完成：后台受限创建及原子更新操作、真实 IndexedDB 和旧数据兼容回归、Windows 验收；Z0-LIVE 保持 blocked。

## 2026-10-21 P1-CORE 待评审提交与 CI 记录
- [Draft PR #3](https://github.com/siskosun/ThreadLine/pull/3) 本轮最终测试提交：`98961a8b69e985ce1d3a608d5c8a2c2bb7732d8d`，基于 main `f3109ebb6e5e76f4c34670b10654bd0127471bea`。
- GitHub Actions [run 39611141838](https://github.com/siskosun/ThreadLine/actions/runs/39611141838)：`npm run verify` 118 项 Node 测试通过，0 失败；`npm run test:e2e` 原 MV3/旧数据合成集成与新增 Fork P1 真正 IndexedDB / 权限 / 24KB / 幂等 / XSS / 重启合成集成均通过。
- 显式功能开关默认关闭；冻结文本和独立数据库可存读；后台承担唯一写入口，FF_CREATE 和 FF_RECORD 有操作 ID / revision；缺少回执不生成第二条实验；不自动开标签、新建 ChatGPT 会话、填入或发送任何消息。
- 失败修复记录：冻结对象测试改为克隆后伪造哈希；陈旧版本断言使用新操作 ID；扩展 CSP 下弃用 Playwright 动态执行式轮询，改为 Locator 断言。均在上述 CI 最终验证。
- **证据边界：** 运行环境为 GitHub Ubuntu Chromium + Node 22；Windows 本机、登录真实 ChatGPT 网页、模型回复完整性及双标签交错未验收。PR #3 不应自动合并，P1-CORE 保持 `in_review`，Z0-LIVE 保持 `blocked`。

## 2026-10-22 P1 冻结/身份审计补强（待评审）
- PR #3 功能提交 `1cd2fda63f0110572fc1610789feebf7f3bd45ce`：冻结与哈希拒绝 Unicode 单独高/低代理项（TextEncoder 会将其无提示替换为 U+FFFD，可能产生相同哈希）；规范 emoji 代理项仍合法。
- 独立 A/B 分支不得复用同一个 attempt ID，避免后续采集归属混淆。相关负向测试在 `test/ff-core.test.js`。
- [GitHub CI 39710678989](https://github.com/siskosun/ThreadLine/actions/runs/39710678989) 完成，结论 success；本次验证没有真实登录 ChatGPT、没有发送或复制用户数据。
- P1-CORE 依然是 PR 评审状态：依正式计划必须完成相应评审/合并及证据核验，不能仅凭 CI success 宣称 done。


## 2026-10-22 P1 开关与排队写入竞态修复（待评审）

- 发现 `FF_CREATE` 与 `FF_RECORD` 在进入串行写队列**之前**检查 `tl_ff_enabled_v1`；若关闭功能的操作已经排队并等待写入，后续请求可能读到旧的 enabled=true，等关闭写入完成后仍提交实验/状态更新。
- 新增 `test/ff-background-toggle.test.js`：在关闭请求被模拟存储延迟阻塞期间，让 CREATE 与 RECORD 读取旧开启状态并加入队列；要求关闭完成后不得再写。反向测试提交 `2f1b7655` 复现问题，修复提交 `f8558952619fbddc2f29a1f2a644f28fd7a22cf2` 在串行临界区内再次检查开关。不是依靠取消队列或超时重放。
- [GitHub CI 39779914170](https://github.com/siskosun/ThreadLine/actions/runs/39779914170) success：Node **122/122**，真实 MV3 扩展/IndexedDB 合成 E2E 通过；没有真实 ChatGPT 发送，也没有更改旧课题 schema。
- P1-CORE 仍仅作为 PR #3 待评审源码，GitHub main 的正式任务状态保持 `planned`，无任何自动放行 P2/P3 的含义。


## 2026-10-22 P1 单一活动尝试与错误归属防护（待评审）

- 代码复核发现：在同一分支已有 `pending` 尝试时，`ff-core.advance()` 原可使用一个**新的** attempt ID 插入第二个活动尝试；旧/新尝试之后的状态回报可能交替覆盖单一分支的状态，破坏接续与归属。
- 新增失败用例 `3ee3299ea08ff36c5e6f36cc72bda4753fb4accb`；[run 39786233409](https://github.com/siskosun/ThreadLine/actions/runs/39786233409) 仅新增这一项 FAIL（122/123 Node），准确复现第二个未完成尝试被错误接受。
- 修复 `520048a5e261b9bede1983dd8e81185ff77dc682`：同分支已经存在活动 attempt 时只准用它原有 ID 推进；人工重试必须在前次 `unknown/failed` 终止后、用新 ID 和显式 `manualNewAttempt`。对已经成功终止的 attempt 保持不可改写。
- 后续 `73d4962b6f3a291156d377663aa87accaf0bc9ad` 增加 MV3/IndexedDB 接口级反向验证；[GitHub run 39786783682](https://github.com/siskosun/ThreadLine/actions/runs/39786783682) success：123/123 Node，合成 Fork P1 E2E 通过。未使用真实 ChatGPT、未发送消息或修改旧课题数据。
- 仍未完成：PR #3 人工评审与授权合并、合并后准确 SHA 的正式验证，且 P2 仍依赖 Z0-LIVE 已签署。保持 PR Draft，正式 `docs/PLAN.md` 未修改。



## 2026-10-23 P1-CORE 独立审查与恢复安全修复（仍待正式验收）

- 来源：GitHub main 唯一计划 `docs/PLAN.md`、根 `AGENTS.md` 和最新 PR #3。审查 `ff-core.js`、`ff-db.js`、`ff-page.js`、后台 FF 门禁、Node/合成 MV3 回归。未修改 main、正式计划、旧课题 schema、浏览器权限；不启动 P2/P3、不自动发送。
- **问题 1：丢回执后手动重试重复创建。** 原 UI 仅在内存保留 `pendingCreate`，后台实际保存成功但回执丢失，刷新同一标签再手动用同一输入点击保存会产生新 UUID 和第二条实验。[旧代码 run 39947872853](https://github.com/siskosun/ThreadLine/actions/runs/39947872853) 的真实 MV3/合成页面中直接观察到重复记录（测试按预期红灯）。新 `ff-page.js` 把同标签未确认创建意图的原文 SHA-256 和操作 ID 存 `sessionStorage`，后续人工操作对同样 W₀/P 复用 ID；收到真实成功回执才清除，不保存 W₀/P 副本、不自动重试。[修复绿色 run 39948497591](https://github.com/siskosun/ThreadLine/actions/runs/39948497591) 123/123 Node、合成 Fork E2E PASS。
- **问题 2：IndexedDB onblocked 以后晚到 onsuccess 的无主连接泄漏。** 新测试旧源码 [run 39948659902](https://github.com/siskosun/ThreadLine/actions/runs/39948659902) 123/124，通过其余用例但该项 FAIL（预期 closeCount=1，实际=0）。`ff-db.js` 现在对已拒绝的打开请求关闭晚到的 DB handle，并在晚到升级事件中取消升级事务。[绿灯 run 39948779597](https://github.com/siskosun/ThreadLine/actions/runs/39948779597) 124/124 Node，合成 Fork E2E PASS。
- **最终保护复核：** `test/ff-core-e2e.py` 额外验证未确认 ID 经页面重载保留、成功 ACK 后删除、`sessionStorage` 不含明文 W₀/P、损坏的意图拒绝新建、旧课题与网页发送均未受影响。[最终代码 run 39949015216](https://github.com/siskosun/ThreadLine/actions/runs/39949015216) success：**124/124 Node**，实际 MV3 + IndexedDB/持久浏览器环境中的合成 Fork 核心 E2E PASS、Release skipped。
- **修复范围：** `threadline-extension/ff-page.js`、`ff-db.js`、`test/ff-core-e2e.py`、`test/ff-db.test.js`；此前持续通过的 SHA、24KB 限制、单写者/版本、单活动尝试、XSS、默认关闭、独立 DB、旧数据回归均保留。
- **差异与门禁：** main `docs/PLAN.md` 仍将 P1-CORE 记为 `planned`；PR #3 有待审源码和自动证据，但**不满足 `done` 所需合并 PR/正式证据及适用人工批准**。不擅自修改状态。Z0-LIVE 仍 `blocked/NOT SIGNED`，本轮所有网页仅为无账号合成，不涉及实际 ChatGPT 发送。
- 具体边界与独立取证索引：`docs/ff/evidence/P1_CORE_REVIEW_20261023.md`。

## 2026-10-23 P1 四项修复与当前安全分支组合候选

- 复用 PR #3 `b8b73e7` 和 PR #6 `cee3e58`（包含 #1/#5），形成独立候选，不修改原 PR、不合并 main。正式 PLAN 与 main 相同。
- 修复保存成功后显示失败导致再次保存重复创建、attempt 会话身份可变、无效结束信号充数、reducer 修改旧记录绕过数据库校验四项问题。均有先红后绿证据，原失败记录保留。
- Windows 本次 `npm run verify`：183/183，`npm run test:e2e`：3/3。真实 MV3/IndexedDB 仍使用合成页面，0 实际发送。源码指纹、红绿日志哈希、精确命令和 L3 人工待确认项见 `evidence/P1_RECOVERY_20261023.md`。
- 当前提交的准确 SHA、独立本地审查和 Linux/Windows 最终 CI 结果以本次 Draft PR 为准；本机结果不能替代准确提交的 CI、真实 Edge 或人工批准。Z0-LIVE BLOCKED / NOT SIGNED，P2/P3 未启动。

## 2026-10-23 实测驱动的接续提示恢复修复（Draft PR8）

- 本轮真实 Tabbit 纯空白/多行草稿保护通过；真实登记后中断、刷新不自动重放，预留/ACK 保持 1/0、编辑器空、消息 0。但观察到未知提示于 1722 ms 插入、1905 ms 被移除，手动恢复提示丢失，明确记 FAIL。
- [PR8](https://github.com/siskosun/ThreadLine/pull/8) 基于 PR7，修复提示节点被移除后的有限恢复；最多 3 次，显式关闭不复活，恢复不进入预填/ACK/发送路径。原源码新增测试先红：Node 3 项新断言失败、合成 MV3 找不到恢复提示。修复后 Windows 189/189 Node、3/3 合成套件 PASS；独立只读本地审查无实质问题。
- 代码提交 `1f7578f73ca184f464f96c9542cd458842170682` 的 [Linux](https://github.com/siskosun/ThreadLine/actions/runs/39978366347) / [Windows](https://github.com/siskosun/ThreadLine/actions/runs/39978366339) CI 均通过；随后证据/测试加强提交以 PR 最新 HEAD 检查为准。
- 修复版真实复测 BLOCKED：原生检查器激活失败，Tabbit 禁止扩展页面导航。只确认磁盘候选更新，未假称扩展已重载。未重放未知意图、未改权限；关闭新建空白页，保留四个测试页和历史失败日志。完整脱敏记录/红绿日志见 [证据](evidence/HANDOFF_NOTICE_RECOVERY_20261023.md)。
- 本轮遵照最新用户指令对 429 暂停 30 秒后先检查状态，不覆盖此前记录。0 新增发送、0 合并、0 发布。PLAN 只增加实际进度，状态表及依赖保持不变；Z0-LIVE BLOCKED / NOT SIGNED。

## 2026-10-23 用户验收后：收敛 main 集成候选（PR9）

- 用户明确确认“当前所有修复与 P1 核心验收”，作为该范围的人工风险接受记录。原有 Agent 控制失败日志和测试结果不被改写；完整 Z0-LIVE 的真实消息、完整回复及异常并发签署仍单列。
- [Draft PR9](https://github.com/siskosun/ThreadLine/pull/9) 将 PR1/3/5/6/7/8 当前代码收敛到 main 目标分支，生产源码与已验收 `102185b` 一致。旧 PR 保留，main 未变。
- PLAN 的 P1-CORE 由 planned 改为 in_review/PR9；这是状态纠偏，未更改完成条件、依赖或校验器。合并、合并后准确提交的 CI 与完成 JSON 尚待正式执行，因此未写 done。
- 本集成的回归和准确提交 CI 以 PR9 检查及 [集成证据](evidence/ACCEPTED_INTEGRATION_20261023.md) 为准。后续先完成该集成，再依正式 Z0-LIVE/P1 放行进入 P2；本次无新增网页发送、无 P2/P3 实现。
