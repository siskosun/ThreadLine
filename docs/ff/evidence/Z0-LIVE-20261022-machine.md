# Z0-LIVE 2026-10-22 真机无发送复测记录（未签署）

**状态：** `blocked / partial / NOT SIGNED`。本文件是机器与真机无发送证据，不是人工验收签署，也不把 Z0-LIVE 标为 done。

## 代码与环境

- 基线：PR #1 HEAD `1ba4465babcaa389dcb2ec1a12a0e249b411b90c`。
- 复测代码提交：`03cd62850a27697edd2c3da9c45c48ec8077bfa1`（本地修复分支；推送后以 GitHub head 为准）。
- 变更文件 SHA-256：
  - `threadline-extension/handoff.js`：`872c7b9609000b969fb0cebb0e19ca85fc5e404988de390503aa3b253adce9d8`
  - `threadline-extension/selectors.js`：`0bdeb077aacd8f508d5eb7fe0919900729700bd422cbb596db722862b2e29e5a`
- 已验证 Edge 加载目录中的上述两个文件与测试树逐字节一致；扩展版本 v0.6.1。
- 环境：Windows；Edge 155.0.4283.45；Node v26.10.0；Python 3.12.10；Playwright 可用。
- 人工发送预算：**3/3 已用尽；本记录 0 次发送、0 次自动发送、0 次重发。**

## 自动测试

| 测试 | 结果 |
| --- | --- |
| 基线 `npm run verify`（1ba4465） | 112/112 Node |
| 基线 `npm run test:e2e` | 通过 |
| 最终 `npm run verify` | **119/119 Node** |
| 最终 `npm run test:e2e` | **2/2 通过**：MV3 持久配置 + handoff 合成 E2E |
| `test/handoff.test.js` | 5/5 |
| `test/handoff-e2e.py` | 23,569 字节合成预填、精确回读、旧草稿不覆盖、0 发送 |

覆盖的新回归包括：

- 页面类型只允许普通聊天；Project、Temporary、未知查询/路径默认拒绝 Fork。
- 空 ProseMirror trailing break 不当作草稿；空格、换行文本节点、多段空白仍保护。
- ProseMirror 多段落结构回读（P/PRE）忽略渲染空行；单一包裹节点回退 `innerText`。
- 无角色欢迎语不进入采集；429/503 重试一次后失败关闭。

## 真实 Edge 无发送结果

### 页面类型

| 页面 | `pageType` | `forkAllowed` |
| --- | --- | --- |
| 普通新聊天 | `plain_chat` | `true` |
| `?temporary-chat=true` | `temporary_chat` | `false` |
| Project 路径 | `project_chat` | `false` |
| 未知路径/查询 | `unknown` | `false` |

Temporary/Project 页面未进入实际 Fork 工作流（P2 尚未实现），但页面分类与拒绝字段已在真实 Edge 返回并由合成回归覆盖。

### 预填

| 载荷 | 预期 | 实际 | 分类 | ACK |
| --- | --- | --- | --- | --- |
| 小文本 | 15 字符 / 21 字节；SHA-256 `91484607d159a539b15769d8b681c09f43de40d76a19db24c469979acf0d27d7` | 同左 | exact | true |
| 近 24KB 简单多行：CJK、emoji、NBSP、单反引号、LF | 23,558 字符 / 23,569 字节；SHA-256 `f219a5280f1186317df007261906ae1b26d61ae117657ed7076c79b6b2ea44a7` | 结构回读同左 | exact | true |
| 近 24KB 综合：代码围栏、CRLF、连续空行、首尾空白 | 23,558 字符 / 23,569 字节；SHA-256 `4b9abbfffa9542b5eb1fb9539b418cb63af25967d54d14eb8db29bf1d05defee` | 结构回读 23,559 字符；SHA-256 `dfac2fd59fca008bc35d13bb21e2f5ca0aff7bacdde6197fd555718f0d7c22f3` | `differs` | false |

综合载荷差异：

- CRLF 被 ChatGPT/ProseMirror 归一化为 LF（预期 1 个 CR，实际 0 个）。
- 代码围栏/连续空行附近产生额外空行；结构回读仍比原文多 1 个字符/字节（综合载荷）。
- 扩展显示“草稿填入结果不完整或与原文不一致，未确认成功”，未 ACK、未发送。该行为符合 fail-closed；不等于 24KB exact 门禁通过。

### 草稿保护与恢复

- ChatGPT 多次把先前测试草稿恢复到新聊天；扩展检测为 `occupied`，不覆盖、不 ACK、不发送，URL 保持根路径。
- 由测试者清空测试草稿并刷新后，handoff 重新读取记录并完成简单 24KB exact；页面刷新与扩展重载后未发生自动发送。
- 未执行：真实 Service Worker 单点暂停/恢复、旧监听器重复注入、同一标签关闭重开、真实断网/限流、真实角色标记/分页消息哈希、最终回复完整性。

## 证据边界

- 真实页面均未发送消息；未读取或上传真实会话正文、账号、Cookie、Token、扩展 ID 或 `/c/` 会话 ID。
- `innerText` 是渲染文本；本次 exact 指“顶层块级节点文本按单换行连接”后的结构回读，不指 DOM 字节或服务端上下文。
- 真实新聊天 `data-message-author-role` 计数为 0；`div.whitespace-pre-wrap` 只能作为无角色候选，不能证明用户/助手身份或完整性。
- A/B 页面级配对和生成重叠窗口仍是历史未复核证据；本记录不声称并发生成已通过。
- **没有用户签署。Z0-LIVE 仍为 `blocked / NOT SIGNED`；不得据此更新 `docs/PLAN.md` 的 done 状态、解锁 P2/P3 或发布 Release。**
