# Fork 双分支 - 第零步验收（未通过）
基线：main d40d13f2918c33961ced333a9884af9c853157ad，v0.6.1。
本分支原始工作为修复 Windows 上 check-syntax.mjs 的 file: URL 路径处理与异目录回归；2026-10-22 追加只读网页选择器兼容、隐藏停止按钮修复与合成回归。
CI 是合成 ChatGPT 页面，不是已登录网页。

## 真实网页门禁
状态：BLOCKED / PARTIAL / NOT SIGNED。2026-10-21 尚未执行真实网页登录；2026-10-22 收到操作者真实 Edge 单会话部分验收报告，但原始本机日志/截图尚未在当前工具会话中复核，双标签与异常门禁未完成。远程设备 sunzc 离线。**严禁把本项标记为通过。**
待用户参与的检查：新建普通会话；短文本及近 24 KB 的 Unicode/Markdown 草稿回读；人工发送后实际用户消息准确性（exact、canonical_equivalent、unverified、differs）；生成结束双信号；结果身份绑定；双标签交错完成；Project/Temporary 拒绝；限流/断网/重启；非文本回复保守 unknown。
完整输入比对仅在可信非有损文本源可用时可认定 exact；采集本身的 trim/规范化不得用于声称字节一致。
观察到停止生成控件消失 + 文本稳定 5s 仍不能单独证明完成，需结合可验证的会话数据和完整性。
采集 legacy 和 DOM 回退必须保留来源和 incomplete 风险。
PR-2/3 在用户签署此门禁通过前不得开展真实网页自动化集成。


## 2026-10-21 Windows GitHub Runner 实测（不等于真人网页验收）
- PR #1 HEAD：`81597d5c169c48226c09adb661f7a09041fded86`。
- [GitHub Windows Actions run 39612233835](https://github.com/siskosun/ThreadLine/actions/runs/39612233835)，Windows runner + Node 22 + Python 3.12 + Playwright Chromium。
- 执行 `npm run verify`：105 项 Node 测试，105 通过、0 失败；从非仓库目录执行 `node scripts/check-syntax.mjs`：39 个 JS 文件通过扫描。
- 执行 `npm run test:e2e`：合成 ChatGPT 网页下真实 MV3 Chromium 持久配置测试成功，包括本地存储、侧栏 UI、IDB、重启恢复和只读探针。**并未登录真实 ChatGPT，也未人工发送。**
- [原始 Windows 日志附件](https://github.com/siskosun/ThreadLine/actions/runs/39612233835/artifacts/12350647387)；CI 自动保留 30 天。
- 首次 Windows run 39611864566 曾因计划负向测试的 CRLF fixture 不兼容失败，随后在 PR 分支引入最新 main 并修正行匹配，未放宽正式计划校验断言；此修订之后的完整 Windows 测试全部通过。
- 尚缺：用户自己的 Windows 环境与真实 ChatGPT 已登录双标签验收；Z0-BASE 仍为 `in_review`（人工门禁未签署），Z0-LIVE 为 `blocked`。不得标为 `done`。


## 2026-10-22 补充验收记录与后续操作（仍未签署）

详见 [单会话真实网页验收初步记录](evidence/Z0-LIVE-20261022-preliminary.md)。该记录基于操作者提交的脱敏摘要；本次未读取本机原始日志/截图。**不是签署、不是 Z0-LIVE done，不能用于解锁 P2/P3。**

### 修复后需要先核对

- 使用 PR #1 最新 HEAD 而非先前 `cd04e46` 验收代码；重新加载真实 Edge 扩展，先运行「网页适配自检」，确认输入框所属 form 内的普通提交按钮能被识别。仅有用户气泡 `div.whitespace-pre-wrap` 和助手 `main p` 时只标「消息文本候选」，不把普通文字当可信完整回复。
- 隐藏的停止按钮应被忽略，但「停止按钮不可见」仍不证明生成完成；聊天 URL /c/ 只证明会话路由，不是结束标记。
- 填写既有草稿后的预填检查以 **不覆盖既有草稿、没有自动发送** 为成功条件；近 24,000 UTF-8 字节与代码块/换行用 execCommand 预填并原样回读；失败不自动重试。
- 独立用本机 Python + Playwright 验证合成 MV3，不以 GitHub Windows runner 成功代替本人设备环境。在 `threadline-extension` 目录运行：
  
  ```powershell
  python -m pip install playwright==1.60.0
  python -m playwright install chromium
  npm run test:e2e
  ```

### 剩余两次真实人工发送的双标签验收

在上述无发送准备检查通过、两个普通非 Project/非 Temporary 的空白对话均已确认后，使用两个可区分的无敏感材料探针：

| 人工动作 | 判定 |
| --- | --- |
| A 标签手动发送 S2-A（仅包含标记 `TL-S2-A`，要求分 40 行输出其标记） | 记录发送前 tab ID、发送后 /c/ 会话 ID 和原文哈希，不应改变 B 草稿 |
| A 仍在生成时，切至 B 标签手动发送 S2-B（仅包含标记 `TL-S2-B`，要求分 40 行输出其标记） | 分别记录两个回复的会话身份；若 A 在 B 发送前已经完成，则仅证明双标签独立，不宣称交错生成 |
| 分别采集 A/B，再刷新及重新打开原页 | A/B 捕获不得串线，任务数分别为 1，正文与输入来源须匹配；证据不足一律 unknown |
| 重复注入、短暂断线或其他中断 | 不自动重新发送；同一发送的归属不明时标 unknown，而非推断成功 |

**不增加自动发送。** 每次发送都由真人点击。两次预算用尽后，不为了宣称交错通过而补发。出现身份冲突、发送状态不明、真实草稿被覆盖或误发时立即停止。

### 重要判定边界

- DOM 文本回读与历史分页摘要不是天然独立的字节级证据，除非保留原始用户消息、同规则的哈希和来源字段。
- 网页分页「全部返回」只能证明历史提取的覆盖范围，不单独证明该轮助手回答已经最终结束。
- 「停止按钮消失」「回复稳定 5.2 秒」「获得 /c/ URL」不能简单累加成三个独立的最终完成证明。至少还要核查可信完成信号、同一会话、一次任务、回复完整性与持久化。
- v0.6.1 没有 Project/Temporary 进入限制；应记录为未实现/未验收，不可将这两项签为通过。
- Edge 自带 Copilot 侧栏抢占显示时，可在单独标签打开扩展自身 `panel.html` 作为只读/操作面板的替代路径，但仍需确认它没有向 ChatGPT 自动发送。

若后续各项通过，由用户将对应脱敏证据、具体 PR HEAD 和验收范围在 GitHub 留言签署；再按唯一 `docs/PLAN.md` 的证据门禁推进。