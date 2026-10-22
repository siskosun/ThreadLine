# ThreadLine 开发进度记录

任务定义和正式状态唯一来源：[docs/PLAN.md](../PLAN.md)。本文件只记录发生过的事件与证据，不自行认定任务完成。

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
