# 结论证据与研究接续：开源复用审计

核查日期：2026-10-24。此文件是 [正式计划第十一节](../PLAN.md) 的证据附录，不授予实施或合并权限。结论为 EXTEND EXISTING；本次仅编写文档，没有将下列上游代码导入产品。

## 1. 取证范围

本地研线基线为 `a66e9b09f43986c6e2ae1b4219df4a95c2cc317a`（v0.8.0）。读取现有采集、采纳、版本、备份、Fork 与治理代码，并核对四个公开开源仓库的许可证及相关文件。沿用 [2026-10-21 复用审计](REUSE_AUDIT_20261021.md) 的先复用现有适配器、禁止未知状态重放和人工发送约束。

用户提供的其他产品界面、用户评论及 Issue 摘要作为设计线索；本次没有复测 11 个产品，也没有验证评分、产品更名、发行时间或故障频率。代码可读不等于适合移植，参考服务可运行不等于适合公开部署。

## 2. 固定源码与许可

| 项目 | 本次固定提交 | 已读许可与源码 | 决策 |
| --- | --- | --- | --- |
| GPT Conversation Toolkit | `119d3728bc4cb583d75da72b067a74b1dce90d60` | [MIT](https://github.com/bujue3709/GPT-Conversation-Toolkit/blob/119d3728bc4cb583d75da72b067a74b1dce90d60/LICENSE)；`utils/dom.js`、`features/virtualized-jump.js`、`features/timeline.js`、`features/conversation-index.js`、`features/export-dom-fallback.js`、反向滚动测试 | 计划直接摘取 DOM 滚动函数与测试并适配；不引入完整扩展 |
| Argdown | `27f412a68f7f4c23ea3afc13793c151ad22d534e` | [core MIT](https://github.com/argdown/argdown/blob/27f412a68f7f4c23ea3afc13793c151ad22d534e/packages/argdown-core/License)；[package.json](https://github.com/argdown/argdown/blob/27f412a68f7f4c23ea3afc13793c151ad22d534e/packages/argdown-core/package.json)，源码包版本 2.0.2，声明 Node >=22.11.0 | 有格式互通需求时直接用 core 包，不自写语法解析器；源码版本不等于已验证 npm 发布或浏览器可运行 |
| Graphiti | `8ce6d633bdcd3d178b3a47bc25b105dce106a754` | [Apache-2.0](https://github.com/getzep/graphiti/blob/8ce6d633bdcd3d178b3a47bc25b105dce106a754/LICENSE)；[graphiti_core/edges.py](https://github.com/getzep/graphiti/blob/8ce6d633bdcd3d178b3a47bc25b105dce106a754/graphiti_core/edges.py) | 参考实体边的 created_at、valid_at、invalid_at、expired_at 区分；本轮无代码复制或框架集成 |
| LangGraph | `4c52e129eb1ab69a3da58b799f67929f77d81149` | [MIT](https://github.com/langchain-ai/langgraph/blob/4c52e129eb1ab69a3da58b799f67929f77d81149/LICENSE)；仓库目录及检查点模块位置 | 当前对象是研究状态而非 Agent 执行图；保留检查点/分支身份设计参考，不集成执行引擎 |

许可证结论针对所列固定源码与文件；其他资源及依赖必须单独核对。采用 MIT 代码时保留版权及许可文本；采用 Apache-2.0 代码时保留许可证、适用 NOTICE 和修改说明。Argdown 的字体等资源另有许可，不能因为 core 为 MIT 就随意打包整个 monorepo。

## 3. Toolkit 的具体移植单元

上游 [utils/dom.js](https://github.com/bujue3709/GPT-Conversation-Toolkit/blob/119d3728bc4cb583d75da72b067a74b1dce90d60/utils/dom.js) 的 `isConversationDocumentScrollRoot`、`isConversationReverseScrollRoot`、`scrollElementIntoConversationView`，以及 [virtualized-jump.js](https://github.com/bujue3709/GPT-Conversation-Toolkit/blob/119d3728bc4cb583d75da72b067a74b1dce90d60/features/virtualized-jump.js) 的 `getVirtualJumpScrollController` 可构成候选小模块。上游处理 column-reverse 的负 scrollTop；研线不必另写一套未经验证的坐标算法。

拟移植到 `threadline-extension/vendor/toolkit-scroll.js`，由新增薄适配器提供滚动根和 DOM 能力。路径为候选设计，不表示文件已存在。直接带入并适配 [tests/timeline-reverse-scroll.test.js](https://github.com/bujue3709/GPT-Conversation-Toolkit/blob/119d3728bc4cb583d75da72b067a74b1dce90d60/tests/timeline-reverse-scroll.test.js) 的三个行为用例：反向坐标、负滚动位置、普通滚动坐标；测试必须运行实际移植模块，不能仅测试另写的模型。

适配时必须完成：

1. 用研线既有选择器探针提供滚动根；移除上游全局状态耦合。上游根查找的宽泛兜底不能误选侧栏。
2. 会话身份与消息 ID 先校验，再比对角色和必要文本；定位失败返回原因。模糊相似度仅可推荐候选，重复文字不能算精确命中。
3. 用户滚动、页面切换、目标分支变化或取消后停止定位；计时器和 MutationObserver 清理；迭代/超时有界。
4. 适配用例增加普通文档滚动、未挂载消息、相同文本不同角色、目标删除和中途切换会话。不依赖真实 ChatGPT 私有接口进行自动验证。
5. 首次移植同一 PR 增加 `threadline-extension/licenses/MIT-GPT-Conversation-Toolkit.txt` 并更新根 `THIRD_PARTY_NOTICES.md`，登记上游 SHA、原文件/符号、改动与本地测试。若小样不通过，明确移植失败和原因，再评审替代方案，不能悄悄重写。

上游 `conversation-index.js` 的加载流程依赖 `fetchConversationByIdCandidates`；`virtualized-jump.js` 还带有命令式 virtualizer 跳转。上述完整模块不直接加载。禁止把上游私有接口、页面响应采集桥、会话认证处理或发送能力随函数一起移入。

[DOM fallback 实现](https://github.com/bujue3709/GPT-Conversation-Toolkit/blob/119d3728bc4cb583d75da72b067a74b1dce90d60/features/export-dom-fallback.js) 显式将加载/缓存消息范围标为 partial。研线复用这一完整性契约，但不需要为复制几行字段引入整套导出器。虚拟列表滚到某处或来源可定位，均不能证明完整对话已采集。

## 4. 先复用研线现有代码

| 现有文件 | 可复用责任 | 仍需新增的领域行为 |
| --- | --- | --- |
| `ai-core.js`、`ai-providers.js` | 候选结构化、消息来源编号、模型连接及不可信输出处理 | 绑定采集运行和来源快照；关系仅推荐，不自动确认 |
| `capture-core.js`、`capture-ui.js` | 消息整理、人工采纳入口 | 逐条来源选择与版本化采纳；不能继续只保存拼接后的 decision |
| `core.js`、`handoff.js`、`panel.js` | 课题关联、变化提示、草稿保护、既有接续交互 | 结论版本清单、撤回与缺证差异；不将 seenVersion 解释为模型理解 |
| `ff-core.js`、`ff-db.js`、`background.js` | 冻结/哈希、attempt 身份、单写者和未知状态约束 | 复核与结论版本关联；旧 Fork 实验保持原样 |
| `backup-core.js`、现有测试 | 验证优先、恢复预览、备份错误处理模式 | 增量证据库备份协议、跨存储提交对账、缺失引用和兼容验证 |

复用模式不等于强行合并数据库。证据库和 Fork 库职责不同；不复制整个 ff-db 后各自维护两套相似错误。S0 先确定可共享的事务/校验边界，再决定提取小型公共函数是否比局部调用更可靠。

## 5. 为什么暂不装框架

Argdown 解决语法解析和论证表达；研线首期只有少量已确认依赖，不需要用户输入专门语言。其 core 声明多项依赖及构建工具，尚未做 MV3 包体与 CSP 验证。S5 如立项互通，直接用其实现，并对不支持的关系显式拒绝或标注信息损失，不能静默把“反对”转成“必要前提”。

Graphiti 的边模型可存储时间字段，但事实自动失效与必要前提的影响传播不是同一个问题；引入其服务不会替代人工核验、扩展存储和来源回溯。LangGraph 面向执行流程，其检查点也不提供研究结论真伪判断。两者均不构成首期最小依赖。

调研中提到的“误失效、漏失效、删除残留、检查点过期”等作为通用负向测试场景使用；本次未复现所列 Issue，不能将其状态写成对当前框架版本的验收结论。

## 6. 开始复制代码前的清单

S0 产出固定版本清单、源码与许可哈希、依赖边界、候选小样测试结果；S1 实施时将真正采用的内容登记到 THIRD_PARTY_NOTICES。上游升级先看差异与许可，再跑本地契约测试，避免跟随 main 自动更新。新增域名权限、私有端点、远程脚本加载和后台服务不属于本路线。

规划完成不等于移植完成。本次状态：源码/许可审计完成；Toolkit 接入小样未执行；Argdown 包安装、浏览器验证未执行；Graphiti/LangGraph 集成未立项。
