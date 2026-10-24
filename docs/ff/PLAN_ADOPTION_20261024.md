# 结论证据计划评审处置

对象：[PR #21](https://github.com/siskosun/ThreadLine/pull/21) 阅读副本，对应修改前提交 `de27077b691e9eafd1986940943f989a677e16db`；产品源码基线 `a66e9b09f43986c6e2ae1b4219df4a95c2cc317a`。日期：2026-10-24。以下为 ROOT 的事实核对与建议采纳，不是外部评审者直接检查源码的证明。

外部意见由用户在当前会话提交，结论为“有条件通过，S0–S1 可以推进”，列出四项计划阻塞。评审者明确只读阅读副本，未核对仓库；Evidence Mode 为 PACKET。回复未包含机器绑定的 SHA/签名，本仓库也无 handoff helper，因此不编造 FRESH 元数据。ROOT 重新打开当前计划、源码与官方文档核对其适用性。

## 阻塞项

| 编号 | 事实判定与证据 | 建议处置 | 落地位置 |
| --- | --- | --- | --- |
| B1 依赖版本 | CONFIRMED：旧 PLAN 第5节把边连到上下游版本，但未定义改版继承、确认指针或事件去重。不存在已实现的依赖引擎，不能将推测的重复触发当作已复现 bug | ACCEPTED：稳定结论 ID 之间一条边，加 acknowledgedUpstreamVersion；ROOT 补 confirmedForDownstreamVersion 和不可变确认历史，覆盖下游改写、措辞继承、过期复核与移除 | PLAN 第5节版本事件表，第8节回归 |
| B2 权威方向 | CONFIRMED：`panel.js:updatePayload/save-details` 仍提交可编辑 decision，`core.js:updateProject` 接受它；旧计划没封闭该路径。`background.js:serialize` 是进程内队列，不能替代持久并发控制；`ff-db.js:update` 已有单事务 CAS 范式 | ACCEPTED：结论、版本、来源、证据连接及 operationId 同事务提交；worker 唯一写入 + 事务 CAS；IDB→storage 单向幂等投影，旧编辑/恢复入口也受保护；项目删除等跨库生命周期另列 S0 崩溃点 | PLAN 第6节，第8节 |
| B3 试点标准 | CONFIRMED：旧计划没有预注册数值阈值，S2 不测传播潜在收益，指标没有必要前提登记完整率；“一到三条”会造成范围歧义 | ACCEPTED：取消三条业务上限；独立冻结 E*/G*，2例第二人标注；离线闭包与真值对比；预设完整率/召回/精确率/总耗时门槛，记录漏登记和超过3条前提占比；意愿仅作定性 | PLAN 第9节，第7节 S2 |
| B4 S0 耦合 | CONFIRMED：旧 S1a 依赖完整 S0，而 S0 同时要求 Toolkit 定位通过；与“可查看片段”的降级承诺矛盾 | ACCEPTED：S0a 存储/恢复及采纳摩擦为关键路径；S0b 定位最多8小时，失败不阻塞 S1a；S0a 增加原型计时与带区间估算 | PLAN 第7节，复用审计第6节 |

四项文档缺口已处理；小样、容量、用户原型、独立标注和真实数据收益尚未执行。S0–S1 的有条件建议已采纳，S1 前必须完成 S0a 证据；未批准 S2–S5 实施，也未变更机器任务表。此次任务仍为 L2 规划；持久化/兼容/删除实施按 L3。

## 其他建议

| 项目 | 处置与边界 |
| --- | --- |
| 简化数据契约 | ACCEPTED：S1 只落地 adopted/withdrawn 与来源连接；类型不强制，依赖/核验按阶段加入。普通字段不必改变 IDB store 结构，但验证器和备份语义仍须演进；新增 store/index 需要升级 |
| 修改类型 | ACCEPTED：用户可选仅措辞/实质/适用条件变化，缺省实质；只有明确确认才继承依赖范围，上游旧提醒不能被措辞标记清除 |
| 复核结果映射 | ACCEPTED：补四种结果映射；scopeManifestHash 指向范围清单。材料哈希只能绑定字节，不能单独解释核验范围 |
| 容量默认值 | ACCEPTED：给出结论/片段/课题/版本/导入导出和总预算的候选数值，按 UTF-8 字节或明确 code point 计数；S0 实测冻结，超限不静默截断 |
| 淘汰和备份 | ACCEPTED：首次采纳提示备份，检查配额/持久授权及异常丢失。FALSE_POSITIVE（仅事实子项）：普通“清除浏览数据会删除扩展 IndexedDB”与 Chrome 官方说明相反；不因此否定卸载或显式清库风险，不扩大到全部浏览器和操作 |
| 工期 | ACCEPTED：S0a 必须交付 S1a/S1b/S2 的人日区间、假设和验证成本，当前不编造已知工期 |
| 复用成本 | ACCEPTED：比较整体维护成本，默认优先已有/开源实现；“自写约100行”为未验证估算，不能据此放弃复用，也不为比较制造三套实现。适配不合适须保留证据 |
| 补充验收 | ACCEPTED：加入 DOM 改版降级、3,000消息取消/超时、含原文备份隐私范围、下游版本推进、旧面板/备份反写与投影中断用例 |

没有需要人类仲裁的 material DISPUTED 项。未进行的行为测试标为未执行；有条件的工程验证不能靠本处置表替代。

## 已核对来源

- [当前源代码 background.js](https://github.com/siskosun/ThreadLine/blob/a66e9b09f43986c6e2ae1b4219df4a95c2cc317a/threadline-extension/background.js)：serialize/mutate/importBackup 与原状态写入路径。
- [ff-db.js](https://github.com/siskosun/ThreadLine/blob/a66e9b09f43986c6e2ae1b4219df4a95c2cc317a/threadline-extension/ff-db.js)：事务 oncomplete、abort 与 revision CAS；[panel.js](https://github.com/siskosun/ThreadLine/blob/a66e9b09f43986c6e2ae1b4219df4a95c2cc317a/threadline-extension/panel.js) / [core.js](https://github.com/siskosun/ThreadLine/blob/a66e9b09f43986c6e2ae1b4219df4a95c2cc317a/threadline-extension/core.js)：旧 decision 可直接编辑。
- [Chrome 扩展存储](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)：普通清除浏览数据不删除扩展 web storage；配额、淘汰、persist 与扩展 origin 边界。
- [MV3 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：worker 停止后全局变量丢失，需持久恢复状态。
- [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)：事务可覆盖多个 store，readwrite 与结构升级、事务生命周期不同。

源码与文档支持的是设计约束，不证明新实现已正确运行。此次验证结果与提交信息记入 PROGRESS；后续以准确提交 CI 为准。
