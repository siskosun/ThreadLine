# 技术设计与源码复用审计（v0.4）

## 项目目标

同一浏览器中将多个 ChatGPT 对话关联到临时课题，按需总结；用户点击时，操作**指定源对话**在 ChatGPT 网页上的项目移动或归档，不使用隐藏的删除/移动后端接口，也不依赖外部云服务器。

## 主要模块

- `background.js`：运行锁、精确来源标签页验证、隔离的项目辅助标签页、分步状态持久化、异常恢复。
- `organize-core.js`：与 DOM 无关的 URL/名称验证、生成项目名。
- `organize-page.js`：只执行用户按钮触发的网页项目新建、移入与归档；找不到准确目标立即停止。
- `web-analyzer.js`：**仅在用户选择实验性网页模型并确认后**注入新建的辅助 ChatGPT 标签页；不使用隐藏后端或提取令牌。
- `capture-ui.js`、`capture-db.js`：报告按钮、状态显示和持久化；本地课题收口不因网页动作而改变。
- `capture-main.js` / `capture-page.js`：旧版对话采集。
- `ai-core.js`：JSON 归一化、分段合并、来源序号校验、有效结论与行动提取。

## 开源调研与复用选择

- [Chat Organizer](https://github.com/kayuling/chat-organizer-extension)：其仓库具备 ChatGPT 侧栏定位和“移至项目”的浏览器 UI 工作流，但未实现“新建项目”和“归档”。README 有 MIT 徽章，仓库当前没有可核对的 LICENSE 文件。**只参考实现思想，未复制其源码。**
- [Dichrome](https://github.com/SillySerpent/Dichrome)（Apache-2.0）：已有通过 ChatGPT 可见界面创建项目的实现。参考“新建按钮→对话框名称输入→确认→验证项目上下文”的设计；此版独立编写适配代码，避免导入其完整隐藏页面/iframe 组件。
- [AI Page Summarizer](https://github.com/ImagineBowl/AI-Page-Summarizer)（README 标注 MIT）：通过独立 ChatGPT 标签页发送提示词并取回结果；本版参考其标签页消息工作流，自行实现简化的 `web-analyzer.js`，不复制其代码。
- CGO/ChatGPT Shadow：原 v0.2 的分页/DOM 采集思路与通知已保留；许可证文件继续随包携带。

## 不复用的部分

- 不使用 Chat Organizer 的批量删除、自动接受删除确认框功能。
- 不使用 Dichrome 的 iframe 绕过、隐藏工作区、整套状态机。
- 不引入 Node 服务、MCP、WebSocket 或 Selenium 常驻进程。
- 不使用非公开 ChatGPT 项目创建/归档 API，正式使用需遵守适用条款。

## 状态模型

每条 capture run 中新增：

`remoteProject = {name,id,url,status,at,reused,error?,helperTabId?}`

`archiveWeb = {status,at,error?}`

状态 `moved`/`archived` 必须经过网页层的状态检测；操作结果无法确认则保存 `creation_unverified`、`move_unverified`、`submitted_unverified`，不自称成功。

## 测试边界

本次 Node 和离线 Chromium 可以证明：逻辑流程、UI 回显、数据隔离、失败恢复按预期运行。**无法证明真实登录账号的网页选择器当前可用，也没有真实创建任何 ChatGPT 项目或归档任何用户聊天。**

## v0.5：显式的课题版本和分支已读位置

`threadline_state_v1` 的 `schema` 仍为 1，不使用破坏性迁移。读取旧对象时，为每个项目补 `knowledgeVersion:0` 和 `lastChange:null`，为每条对话补 `seenVersion:<所属项目当前版本>`。无字段的旧数据不会立刻变成过期分支。

`updateProject` 仅在 `goal`、`decision` 或 `stage` 的值实际变化时增加一次版本。可选的 `sourceKey` 用于识别经人工发布新状态的源分支，将其 `seenVersion` 设为当前版本。其他分支保持已读版本；`acknowledgeProject` 用于用户明确确认。单纯 `observeChat` 或 `linkChat` 不得视为核对新知识。

内容脚本只能通过 `ACK_PAGE` 核对 `sender.tab.url` 与消息声明的同一对话，不能冒用别的标签页去确认其它分支。待核对仅显示差异提醒；手动收口和「已完成」仍按原有边界拦截发送。

默认面板 `workspace-switch` 呈现当前会话、核心结论、同课题直接跳转和按需展开的课题编辑。`workspace-research` 保留原采集和 AI 分析 UI。结构变化不改变采集数据库和外部自动化调用方式。
