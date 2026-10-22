# Fork 双分支 - 第零步验收（未通过）
基线：main d40d13f2918c33961ced333a9884af9c853157ad，v0.6.1。
本分支原始工作为修复 Windows 上 check-syntax.mjs 的 file: URL 路径处理与异目录回归；2026-10-22 追加只读网页选择器兼容、隐藏停止按钮修复与合成回归。
CI 是合成 ChatGPT 页面，不是已登录网页。

## 真实网页门禁
状态：BLOCKED / PARTIAL / NOT SIGNED。2026-10-21 尚未执行真实网页登录；2026-10-22 已收到 S1 和后续 A/B 双标签页面级核对（按来源归属的文字比较、无跨页标记）；但原始日志/截图、生成重叠窗口、可信原始角色与消息哈希及异常门禁未全部复核或完成。远程设备 sunzc 离线。**严禁把本项标记为通过。**
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

### 双标签 S2-A/B 操作结果（2026-10-22，预算已用尽）

- 操作者已在人手控制下先 A 后 B 各发送一次，共计 2 次；连同 S1 共 **3/3**，本轮不追加发送。
- 两个普通对话 URL 的 /c/ 标识不同。操作者报告 A 的输入 83/83 字节 exact，B 的输入 84/84 字节 exact；每个页面只出现其对应的标记及回复，没有跨页内容混合。
- 双方快照均显示无可见停止控件、回复稳定约 5.2 秒并带定稿操作行；**未取得 A/B 真正同时生成的机器证据**，完整终止标记也未由可信数据源直接复核。
- Playwright 本机合成 E2E 已由操作者以 v1.64.0 执行成功。需继续完成真实网页已有草稿保护、扩展自身近 24KB 文本路径、Project/Temporary 拒绝、异常恢复、可信消息来源/哈希及用户签署。
- `div.whitespace-pre-wrap` 可能先选中欢迎语；禁止将 `querySelector` 第一项或 `querySelectorAll` 最后一项直接作为可信用户消息。应使用具有会话与角色归属的来源，读取完整未损原文。角色不可验证时保持 `unverified / unknown`。

### 重要判定边界

- DOM 文本回读与历史分页摘要不是天然独立的字节级证据，除非保留原始用户消息、同规则的哈希和来源字段。
- 网页分页「全部返回」只能证明历史提取的覆盖范围，不单独证明该轮助手回答已经最终结束。
- 「停止按钮消失」「回复稳定 5.2 秒」「获得 /c/ URL」不能简单累加成三个独立的最终完成证明。至少还要核查可信完成信号、同一会话、一次任务、回复完整性与持久化。
- v0.6.1 没有 Project/Temporary 进入限制；应记录为未实现/未验收，不可将这两项签为通过。
- Edge 自带 Copilot 侧栏抢占显示时，可在单独标签打开扩展自身 `panel.html` 作为只读/操作面板的替代路径，但仍需确认它没有向 ChatGPT 自动发送。

若后续各项通过，由用户将对应脱敏证据、具体 PR HEAD 和验收范围在 GitHub 留言签署；再按唯一 `docs/PLAN.md` 的证据门禁推进。

## 2026-10-22 接续草稿无发送门禁的 CI 增补（合成，非真实账号）
- `handoff.js` 的填入成功判定由原“长度达到前 40 字符”改为“编辑器完整原始文本与预填内容逐字相同”；遇到已有草稿（包括纯空白）、部分插入、连续空行变形均不得误报成功或 ACK，也不得自动发送。
- `test/handoff.test.js` 验证前缀 40 字符假成功被拒绝；`test/handoff-e2e.py` 在真实 MV3 扩展 + 离线合成 ChatGPT 编辑器下验证 23,569 字节含 Unicode、NBSP、代码块及换行的 exact 预填/回读；已有草稿保持原状、自动发送为 0。
- [Linux 39711053880](https://github.com/siskosun/ThreadLine/actions/runs/39711053880) 与 [Windows 39711053863](https://github.com/siskosun/ThreadLine/actions/runs/39711053863)：112/112 Node 与两项合成扩展 E2E 通过。没有真实用户账号操作。
- Z0-LIVE 当前仍是 `blocked / NOT SIGNED`。操作者已经使用 3/3 人工发送测试预算，不增加发送；余下真实网页无发送验收和适用人工签署仍要完成。
