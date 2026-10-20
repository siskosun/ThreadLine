# ThreadLine v0.2 架构与技术决策

## 本轮目标

在 v0.1 的“课题—多个独立对话—统一收口”基础上增加一次性跨标签采集与可视化：点采集、选择来源、显示可追溯提要与思维导图，并无须文件上传下载地开启新对话。

## 最小架构

- `chrome.tabs.query`：列出当前浏览器已保存的 ChatGPT 对话（含项目内部的 `/g/.../c/...` URL）。
- `chrome.sidePanel`：既有右/左侧原生分屏；在 Chromium 141+ 使用 `close({windowId})`。
- 两世界消息桥：`capture-page.js`（isolated content script）只响应用户明确启动的任务，经 `postMessage` 调用 `capture-main.js`（main world）；主世界可沿同源网页接口读取历史数据。
- `capture-main.js`：小型 CGO 分页适配器。首次 `/backend-api/conversations/:id`，按 `page_info.start_cursor` 调用 `/messages?before=...`，以 `has_previous_page` 作为分页终止条件；去重检查、分页上限、异常回退到旧 `/backend-api/conversation/:id`；最后才是可见 DOM 降级。
- `background.js`：只允许选中的源标签页写入指定 capture run，负责 IndexedDB 写入和启动新对话。项目状态沿用原串行 mutation 机制。
- `capture-db.js`：IndexedDB 的 `runs/pages`，按 `pageIndex` 降序、同页 chunkIndex 升序回放，不在 Chrome storage 同步正文。
- `capture-core.js`：纯函数组装消息、提取“目标/结论线索/未解决/下一步”、生成可核对接续提示、构建思维导图数据。
- `capture-ui.js`：现有侧边栏加一块跨对话采集与报告模块，不引入 React、Mermaid、Canvas 或远端服务；用 SVG 贝塞尔曲线 + DOM 卡片渲染交互导图。
- `handoff.js`：对新 ChatGPT 草稿尝试使用普通页面文本编辑操作预填；失败则提供用户主动复制。不会替用户点击发送。

## CGO 代码复用决策

源：[nao-pon/chatgpt-conversation-optimizer](https://github.com/nao-pon/chatgpt-conversation-optimizer)，MIT。实际源码 2026 年 10 月版 `page-hook.js` 中的 `parsePaginatedConversationRequest`、`fetchInitialPaginatedHistory`、`fetchNextPaginatedHistoryPage` 与消息去重/分页终止机制经检查可复用其算法思路。CGO 原实现超过 200KB 的主页面钩子还包含 WebSocket/流剪枝、文件下载、导出器等；直接搬运会显著增大维护复杂度。本版只独立实现几十行分页状态循环与兼容降级逻辑，保留许可证与贡献者信息。

## 为什么不“直接调用 ChatGPT 的 Chrome 标签页读取功能”

第一方 ChatGPT Chrome/浏览器能力不是第三方 MV3 扩展可直接调用的公开 JS API。ChatGPT 产品页面可读取浏览器标签页，不能推导出第三方扩展可把那套能力嵌到 sidePanel 内。首版使用扩展页面权限读取用户明确选择的 ChatGPT 对话；“ChatGPT 深度整理”改为**预填待发送草稿**，不冒称实现了无提示的模型 API 调用。

## 风险与边界

- ChatGPT 的网页内部接口未经稳定公开承诺；版本变化时必须降级并告知未完成，不能保证 100% 采集。
- 若在源标签页尚未完成回答时采集，结果可能不是最终版本，因此在检测到停止按钮时拒绝采集。
- 规则提取不等于真实语义总结，会重复、误判或遗漏；输出全部标记候选，并保留消息来源编号。
- 收口状态以用户维护的 ThreadLine 课题为准，不用一个新采集报告覆盖权威收口决定。
- 未取得用户同意不把研究文本送给 ChatGPT 之外的服务；用户主动发送后由 ChatGPT 按其服务规则处理。

## 后续如果要升级为真正一键 AI 摘要

优先查证官方是否提供合适的 API / 浏览器集成；若没有，需要用户明确选择 AI 提供者、凭证和可接受的数据处理方式。也可以在支持 Prompt API 的 Chrome 设备上试行本地模型，但不应把它默认视为 Edge 已支持。测试后才决定是否增加增量分段总结或自动生成可编辑 Mermaid。

## v0.5 新增机制（2026-10-20）

- UI：将高频「对话切换」作为默认入口；低频采集分析归档放至第二页，课题管理折叠。
- 数据：添加每项目知识版本和每分支核对版本，修改报告发布操作时才通知其它分支。AI 候选结论经人工编辑确认再写入项目状态。
- 防误操作：旧分支有更新只提醒，收口仍需人工确认；页面只能核对自己对应的对话；结论不同不会自动裁决真实与否。
- 技术复用：沿用原版 Chrome 侧边栏、Chrome Storage、CGO 风格采集逻辑和原有组织自动化代码，不新增服务、权限或重型 UI 框架。
- 限制：没有改变 ChatGPT 网页自动化的使用授权、真实网页兼容性及其验证状态，绝不将单元测试结果冒充上线实测。
