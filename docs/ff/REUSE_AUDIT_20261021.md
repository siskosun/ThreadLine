# Fork 双分支模式：开发前复用与 Fork 审计

日期：2026-10-21；范围：仅公开代码与公开故障报告；未安装第三方软件，未执行这些项目的测试，未进行真实登录 ChatGPT 网页验收。
ThreadLine 基线：main d40d13f，v0.6.1；既有 Draft PR-0：https://github.com/siskosun/ThreadLine/pull/1 。

## 一、结论与投资门禁

决定：**EXTEND EXISTING + 小范围借鉴源代码/测试**。不整体替换 ThreadLine、不引入 Electron 本地服务或自定义 MCP、不把网页自动发送加入第一期。

判断依据：
- Chat On Steroids（CoS）已有成熟度相对更高的多会话归属、持久化交付、恢复和 completion 判定，但桌面 Electron + companion extension + 自定义 MCP/tunnel 的系统边界与 ThreadLine 纯浏览器扩展不一致。整个 Fork 的常驻同步与维护成本过高。
- Panelize 提供更轻量、与 PR-0 极其接近的「已登录真实网页，默认只填草稿、不发送、主动清理」验收体系，以及 ChatGPT 当前/旧版 composer 选择器。适合借鉴测试结构。
- Codexless 的浏览器能力通过本地 Codex/runtime 与应用/MCP 连接提供，不是可直接嵌入 ThreadLine 的浏览器多会话运行器。
- AI Chat Sync 以跨站同步发送为核心，不满足第一期用户手动发送的硬约束。
- 官方 ChatGPT Work 能在自己的浏览器环境中操作多个标签页，但没有证据表明可向 ThreadLine 暴露等价的、独立普通 ChatGPT 会话执行记录和受控上下文比较协议。

**最重要的前置门禁仍是 PR-0 真人登录网页验收。** 这里发现的代码和测试不能替代该门禁。

## 二、候选项目与验证过的源码

1. Chat On Steroids（MIT，2026-10-21 API 快照：约 5,052 stars、655 forks，仍活跃）
   - 源：https://github.com/totec448-spec/chat-on-steroids
   - docs/setup.md：需要独立桌面程序、浏览器伴随扩展和本地 MCP/tunnel，不能作为 ThreadLine 的即插即用扩展包。
   - docs/tool-surface.md：agents spawn/message/status/finish 与 worker 的睡眠/唤醒策略；browser 控制权归属由本地服务协调。
   - src/main/session/correlation.ts：请求归属必须依赖明确证据，不能由当前活跃 tab、时间或工具名推测，重启后需保留确定性归属。
   - src/main/session/resume-gate.ts：先持久化即将创建/发送的归属，再打开目标会话；已经发生不确定 dispatch 时不能按超时自动再次发送。
   - docs/chatgpt-turn-signals.md：明确「沉默不是完成」，一条响应必须有模型终止证据；仅 Stop 按钮消失不可靠。该文档基于较早版本，须用最新实现复核细节。
   - Issue #71：https://github.com/totec448-spec/chat-on-steroids/issues/71 。多分支窗口抢占焦点、单份 placement offer 覆盖多 worker；上游已有 per-command 修复和测试，仍非全环境验收保证。
   - Issue #407 和 #414：https://github.com/totec448-spec/chat-on-steroids/issues/407 以及 https://github.com/totec448-spec/chat-on-steroids/issues/414 。网页 SSE 事件布局变化造成 request ID 无法正确关联；修复需同一响应内的有证据关联，不能跨会话猜测。
   - Issue #1438 仍开放：https://github.com/totec448-spec/chat-on-steroids/issues/1438 。长时运行出现模型消息丢失的用户报告，说明尚不能认定长期稳定。

2. Panelize（MIT，2026-10-21 快照：约 46 stars、14 forks）
   - 源：https://github.com/Manho/Panelize
   - content-scripts/chatgpt-composer.js：约 50 行的当前/旧版 composer 检测与正确所属 form 查找；可作为 ThreadLine handoff.js 的 selector/安全回读改进参考。
   - tests/chatgpt-composer-scripts.test.js：覆盖当前/旧布局、多 composer 存在、正确聚焦和不误触其他输入框。
   - tests/live/live-harness.js、tests/live/providers.live.test.js：独立浏览器登录 profile、真实站点预填、检测控件、保护用户既有草稿、非发送默认行为、清理测试草稿。环境变量 PANELIZE_LIVE_SEND 才允许发送。该测试在 iframe 运行，移植到 ThreadLine 普通标签页时必须调整。
   - tests/e2e/focus-protection.e2e.test.js：焦点抢占的合成 E2E 与反向验证用例。
   - 警告：其测试中为解析源码选择器表使用 new Function；ThreadLine 生产代码不得沿用动态执行。优先导出/引用明确的选择器数据。

3. Codexless（Apache-2.0，2026-10-21 API 快照：约 120 stars、24 forks）
   - 源：https://github.com/liyana31811/Codexless
   - README：Chrome/Edge 读写及键盘操作依赖既有浏览器 profile 与 ChatGPT 自定义应用 / MCP 连接；仍是技术预览；没有核实有完整的子会话编排执行接口。
   - 仅作浏览器权限与不确定执行防重放的参考，不用于第一期底座。

4. AI Chat Sync（较早的浏览器多站同步问答）
   - 源：https://github.com/legendjw/ai-chat-sync
   - 核心是同步发送，不符合双分支人工发送与独立状态审计；不移植。

## 三、针对 Chat On Steroids 的 Fork 实查

通过 GitHub 比较当前上游 main 与 Fork 默认分支、阅读 Fork 开发日志、浏览 Fork PR 具体补丁和测试确认：

**A. Haz4rdovisk/chat-on-steroids-mainstream（真实 Fork）**
- https://github.com/Haz4rdovisk/chat-on-steroids-mainstream
- 比较上游当前 main 时为 ahead 69 / behind 2750；并非当前可直接 cherry-pick 的完整候选底座。
- docs/worklog-2026-09-23-first-send-receipt.md：冷启动大草稿的用户消息先于会话 URL 出现；确认前原文可能被 Markdown 转义或自动链接。该 Fork 的解决方式包括路由出现后重新触发证据核对、限定的 provider serialization 等价校验、仅在有原始消息身份和 app ACK 时承认发送、用户修改草稿后撤销原租约。
- docs/worklog-2026-09-25-send-listener-lifetime.md：旧 content recorder 退休后仍监听发送事件，继任监听器可能重复处理。修正为可注销监听器和 alive 检查。适合借鉴重复监听与扩展重载回归测试。
- docs/worklog-2026-09-26-worker-report-acknowledgment.md：worker 结果仅写入队列时不得告诉主会话「已收到」，要分别记录「已存储、已提供、已确认」。
- 判断：**借鉴验收场景与状态边界，不直接复制其老版本桥接实现。** 文档中的测试成绩是作者记录，本次未独立重跑。

**B. Repcoders/chat-on-steroids（真实 Fork；Fork 内未合并 PR）**
- https://github.com/Repcoders/chat-on-steroids
- Fork 默认 main 相对上游当前 main 落后；改进位于单独 PR 分支，不能把 issue #1721 所列的 82 项当作上游已发布功能。
- Fork PR #25：https://github.com/Repcoders/chat-on-steroids/pull/25 。新增 src/renderer/composer-drafts.ts 与测试；按会话键持久化未发送草稿，限制数量与序列化大小，离开页面时刷新保存。适合借鉴「只恢复原草稿、不重新发送」及草稿隔离测试。该实现基于 Electron renderer/localStorage，ThreadLine 应用 IndexedDB 并保持后台唯一写入者。
- Fork PR #35：https://github.com/Repcoders/chat-on-steroids/pull/35 。在发送前检测常见凭据形状，并配套测试。可借鉴导出/日志中的秘密扫描；正则识别并不等于全面安全检测，且不应静默改动被冻结的 W0/P。
- Fork PR #44：https://github.com/Repcoders/chat-on-steroids/pull/44 。增加中文逐字拆分的差异比较和对应测试，但依赖 @codemirror/merge；第一期只需双栏去标签对照，不引入此依赖，若后续确有需要再评估。
- 三个 PR 截至查询时均仍 open、未 merge。发现「有源码和测试」不等于「测试在本次环境通过」，更不等于上游已发布。

**C. Maximapple/chat-on-steroids / Inmerson/chat-on-steroids**
- 两者均为真实 Fork，但相对 2026-10-21 上游 main 的 behind 数量很大（分别约 2934、2945），且有较多长期分叉变更。
- 可选择单个 Issue/PR 的回归测试，不应作为 ThreadLine 的框架替代。上游已吸收的修复优先以最新上游实现为基准。

上述审查是**定向高价值 Fork 抽查**，不是对全部 655 个 Fork 的完整审计。

## 四、具体移植决策：哪个模块从哪里学

| ThreadLine 任务 | 学习源 | 行动 | 不照搬什么 |
|---|---|---|---|
| PR-0 实际网页填入与检测 | Panelize chatgpt-composer + live tests | 引入短/24 KB 草稿、两版 composer、用户草稿保护、默认不发送、自动清理属于测试本身的草稿等测试规范 | iframe、其全部多模型 UI、动态执行选择器 |
| PR-0 提交文本一致性 | Haz Fork first-send receipt | 为「草稿回读」「实际用户消息」「会话 URL/身份」分别留证，先完成输入比较规范再开发 | 它的私有消息框架与 app ACK 协议 |
| PR-1 四态/重试 | CoS resume-gate/correlation | 明确发送前后权属、exact identity、unknown 不自动重新发送 | CoS 的 Electron/MCP 运行时 |
| PR-2 双 tab 生命周期 | CoS Issue #71 与监听器 Fork 修复 | per-branch 操作 ID；不抢焦点；同标签多监听器不重复消费；worker 重启重建 IDB 映射 | chrome.debugger、背景自动发消息与多 Agent 无人值守 |
| PR-3 最终回复 | CoS turn-signals + Issue #407/#414 | 最终回合结束证据 + 完整采集；身份矛盾降级 unknown，拒绝交叉配对 | 仅固定等候/Stop 消失即 done |
| 后续草稿恢复 | Repcoders Fork #25 | 独立草稿快照、有限保留和清理；不重复发送 | Electron localStorage 接口原样移植 |
| 后续差异视图 | Repcoders Fork #44 | 用户需求证实后再考虑逐字 diff | 重型 CodeMirror 依赖（第一期不需要） |

## 五、当前项目状态与后续门禁

- ThreadLine Draft PR-0：https://github.com/siskosun/ThreadLine/pull/1 —— Windows 跨平台语法路径修复与真实网页验收清单；**未合并，真实网页未验收**。
- feat/ff-core-pr1-20261021 是先前创建的开发分支，尚未提交第一期功能代码；不要把分支存在误判为 PR-1 完成。
- 本次研究不修改任何自动发送能力，不接入自定义 MCP，不安装第三方软件。
- 后续先把 Panelize 的 live fill 核验方法及 CoS 的 identity/completion 不变量加入 PR-0 的验收矩阵，再由用户在真实登录 ChatGPT 的 Windows 浏览器验证。
- 只有 PR-0 证实「创建、完整填入、人工发送、真实消息比对、最终完成及两标签归属」的可靠性后，才推进 PR-2/3。
- 对具体第三方代码的直接复制必须核验许可证、保留来源与相应版权声明；优先借鉴逻辑和复现用例，由本仓编写相容的精简模块。
- CoS 长时执行仍有开放问题，不把其功能演示视为稳定性证明。
