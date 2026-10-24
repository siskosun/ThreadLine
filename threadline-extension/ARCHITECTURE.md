# ThreadLine v0.8.0 架构

## 两层工作流

**Core（默认第一屏）**：`panel.html/panel.js`（切换面板）→ `background.js`（权限、串行状态变更）→ `core.js`（纯函数 schema2 状态、版本差异、对话 UUID）。只写入本地 `chrome.storage.local`，自动轮转五份前态快照。`backup-core.js` 校验导入/导出。`content.js` 为当前 ChatGPT 页显示非阻塞的待核对状态；只有人工收口、完成分支才尝试拦截新发送。

**Labs（按需触发）**：`capture-*.js`、`ai-core.js`、`ai-providers.js`、`web-analyzer.js`、`organize-*.js`。按需采集 ChatGPT 网页文本、整理研究及执行指定来源对话的项目创建/移入、归档；不自动进行或重试不可确认的外部写操作。实验性 ChatGPT 网页模型自动分析不是官方 API。

目前 Core/Labs 是**逻辑分层**，没有拆成单独发布的浏览器扩展，第三方站点权限仍由 manifest 声明。不要把该层次描述成已完成 optional-permissions 隔离。

## 状态与一致性

- `schema:2` 是显式、幂等迁移：v1 补足知识版本、分支已读版本和历史数组；未来 schema 会拒绝回退操作而非清空状态。
- `revision` 为后台串行更新的单调序号；编辑课题时可提交 `expectedRevision`，遇到其他窗口已变更即拒绝旧值覆盖。
- `knowledgeVersion` 只由人工修改目标/有效结论/状态的实质变更推进；只改常见标点和空白不推进。历史 `history[]` 限额 30 条并保留字段 `before/after`。
- `seenVersion` 记录每条分支已人工核对的进展；`changesSince` 显示具体差异。分支尚未声明依赖的结论项，不应把本机制称为精确语义冲突检测。
- 已保存的对话键从 URL 提取 conversation UUID；移入项目不会改变键。未正式保存的新对话暂用 `tab:<id>`，随后迁移。
- `chrome.storage.local` 单键状态与五份独立快照是短期小规模方案，不提供真正跨服务工作线程崩溃的事务性 CAS 保证。

## MV3 与采集生命周期

`background.js` 将 `tl_capture_owner_*` 与 `tl_org_lock_*` 记录到 `chrome.storage.session`，从面板快照、服务工作线程启动和标签页关闭时检查过期记录。采集中断时标错；网页组织操作中断时要求人工核实，不会再次点击创建或归档。

`capture-db.js` 仍用 IndexedDB 持久化短期采集文本；目前 `pages()` 使用 getAll 汇总，超大规模单对话的游标流式读取是后续性能工作。

## 网页可观测性和限度

`selectors.js` 提供只读 DOM 健康探测。只有真正在扩展中明确成功的采集、移入和归档操作才更新 `tl_health_successes`；没有尝试的项目仍列为未验证。网页菜单、项目新建和非公开分页接口无法仅凭 DOM 探测证明成功。

## 验收层

- Node 纯函数/模拟后台回归。
- 无网络离线 DOM 模拟检查发送拦截和面板。
- Playwright Chromium `launch_persistent_context` 真实加载未登录扩展 + 合成 ChatGPT 页面；测试存储真实持久化、真实消息协议，但不宣称生产网页兼容。
- 用户授权的已登录 Edge 真实验收（尚未执行）。

## v0.6.1 补充：扩展页面身份验证

后台对由扩展侧栏发送的消息继续信任无 `sender.tab` 的内部上下文，同时通过运行时扩展 ID、`sender.url` 和内部 `panel.html` 路径显式识别独立打开的受信任面板标签页；其它网页标签页无权执行 `MUTATE`、`SNAPSHOT`、备份和组织操作。
