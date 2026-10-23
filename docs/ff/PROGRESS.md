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

## 2026-10-21 P1-CORE 启动
- 已核对 main `f3109ebb6e5e76f4c34670b10654bd0127471bea` 和唯一 `docs/PLAN.md`，发现 PR #2 已合并；PR #1 仍 Draft。
- 将既有 `feat/ff-core-pr1-20261021` 快进至上述 main，然后提交 `ff-core.js`、`ff-db.js`、`test/ff-core.test.js`、独立预览页及后台禁用门禁。尚未实现自动发送、双会话编排或结果对照。
- 实际运行环境：GitHub 工具写入源码；当前容器不能直连 GitHub 下载完整仓库，故尚未执行本机 `npm run verify` 与 Chromium E2E。以本 PR GitHub Actions 的真实结果为准；不能以模型自检当作通过。
- 仍待完成：后台受限创建及原子更新操作、真实 IndexedDB 和旧数据兼容回归、Windows 验收；Z0-LIVE 保持 blocked。

## 2026-10-21 P1-CORE 待评审提交与 CI 记录
- [Draft PR #3](https://github.com/siskosun/ThreadLine/pull/3) 本轮最终测试提交：`98961a8b69e985ce1d3a608d5c8a2c2bb7732d8d`，基于 main `f3109ebb6e5e76f4c34670b10654bd0127471bea`。
- GitHub Actions [run 39611141838](https://github.com/siskosun/ThreadLine/actions/runs/39611141838)：`npm run verify` 118 项 Node 测试通过，0 失败；`npm run test:e2e` 原 MV3/旧数据合成集成与新增 Fork P1 真正 IndexedDB / 权限 / 24KB / 幂等 / XSS / 重启合成集成均通过。
- 显式功能开关默认关闭；冻结文本和独立数据库可存读；后台承担唯一写入口，FF_CREATE 和 FF_RECORD 有操作 ID / revision；缺少回执不生成第二条实验；不自动开标签、新建 ChatGPT 会话、填入或发送任何消息。
- 失败修复记录：冻结对象测试改为克隆后伪造哈希；陈旧版本断言使用新操作 ID；扩展 CSP 下弃用 Playwright 动态执行式轮询，改为 Locator 断言。均在上述 CI 最终验证。
- **证据边界：** 运行环境为 GitHub Ubuntu Chromium + Node 22；Windows 本机、登录真实 ChatGPT 网页、模型回复完整性及双标签交错未验收。PR #3 不应自动合并，P1-CORE 保持 `in_review`，Z0-LIVE 保持 `blocked`。

## 2026-10-22 P1 冻结/身份审计补强（待评审）
- PR #3 功能提交 `1cd2fda63f0110572fc1610789feebf7f3bd45ce`：冻结与哈希拒绝 Unicode 单独高/低代理项（TextEncoder 会将其无提示替换为 U+FFFD，可能产生相同哈希）；规范 emoji 代理项仍合法。
- 独立 A/B 分支不得复用同一个 attempt ID，避免后续采集归属混淆。相关负向测试在 `test/ff-core.test.js`。
- [GitHub CI 39710678989](https://github.com/siskosun/ThreadLine/actions/runs/39710678989) 完成，结论 success；本次验证没有真实登录 ChatGPT、没有发送或复制用户数据。
- P1-CORE 依然是 PR 评审状态：依正式计划必须完成相应评审/合并及证据核验，不能仅凭 CI success 宣称 done。


## 2026-10-22 P1 开关与排队写入竞态修复（待评审）

- 发现 `FF_CREATE` 与 `FF_RECORD` 在进入串行写队列**之前**检查 `tl_ff_enabled_v1`；若关闭功能的操作已经排队并等待写入，后续请求可能读到旧的 enabled=true，等关闭写入完成后仍提交实验/状态更新。
- 新增 `test/ff-background-toggle.test.js`：在关闭请求被模拟存储延迟阻塞期间，让 CREATE 与 RECORD 读取旧开启状态并加入队列；要求关闭完成后不得再写。反向测试提交 `2f1b7655` 复现问题，修复提交 `f8558952619fbddc2f29a1f2a644f28fd7a22cf2` 在串行临界区内再次检查开关。不是依靠取消队列或超时重放。
- [GitHub CI 39779914170](https://github.com/siskosun/ThreadLine/actions/runs/39779914170) success：Node **122/122**，真实 MV3 扩展/IndexedDB 合成 E2E 通过；没有真实 ChatGPT 发送，也没有更改旧课题 schema。
- P1-CORE 仍仅作为 PR #3 待评审源码，GitHub main 的正式任务状态保持 `planned`，无任何自动放行 P2/P3 的含义。


## 2026-10-22 P1 单一活动尝试与错误归属防护（待评审）

- 代码复核发现：在同一分支已有 `pending` 尝试时，`ff-core.advance()` 原可使用一个**新的** attempt ID 插入第二个活动尝试；旧/新尝试之后的状态回报可能交替覆盖单一分支的状态，破坏接续与归属。
- 新增失败用例 `3ee3299ea08ff36c5e6f36cc72bda4753fb4accb`；[run 39786233409](https://github.com/siskosun/ThreadLine/actions/runs/39786233409) 仅新增这一项 FAIL（122/123 Node），准确复现第二个未完成尝试被错误接受。
- 修复 `520048a5e261b9bede1983dd8e81185ff77dc682`：同分支已经存在活动 attempt 时只准用它原有 ID 推进；人工重试必须在前次 `unknown/failed` 终止后、用新 ID 和显式 `manualNewAttempt`。对已经成功终止的 attempt 保持不可改写。
- 后续 `73d4962b6f3a291156d377663aa87accaf0bc9ad` 增加 MV3/IndexedDB 接口级反向验证；[GitHub run 39786783682](https://github.com/siskosun/ThreadLine/actions/runs/39786783682) success：123/123 Node，合成 Fork P1 E2E 通过。未使用真实 ChatGPT、未发送消息或修改旧课题数据。
- 仍未完成：PR #3 人工评审与授权合并、合并后准确 SHA 的正式验证，且 P2 仍依赖 Z0-LIVE 已签署。保持 PR Draft，正式 `docs/PLAN.md` 未修改。



## 2026-10-23 P1-CORE 独立审查与恢复安全修复（仍待正式验收）

- 来源：GitHub main 唯一计划 `docs/PLAN.md`、根 `AGENTS.md` 和最新 PR #3。审查 `ff-core.js`、`ff-db.js`、`ff-page.js`、后台 FF 门禁、Node/合成 MV3 回归。未修改 main、正式计划、旧课题 schema、浏览器权限；不启动 P2/P3、不自动发送。
- **问题 1：丢回执后手动重试重复创建。** 原 UI 仅在内存保留 `pendingCreate`，后台实际保存成功但回执丢失，刷新同一标签再手动用同一输入点击保存会产生新 UUID 和第二条实验。[旧代码 run 39947872853](https://github.com/siskosun/ThreadLine/actions/runs/39947872853) 的真实 MV3/合成页面中直接观察到重复记录（测试按预期红灯）。新 `ff-page.js` 把同标签未确认创建意图的原文 SHA-256 和操作 ID 存 `sessionStorage`，后续人工操作对同样 W₀/P 复用 ID；收到真实成功回执才清除，不保存 W₀/P 副本、不自动重试。[修复绿色 run 39948497591](https://github.com/siskosun/ThreadLine/actions/runs/39948497591) 123/123 Node、合成 Fork E2E PASS。
- **问题 2：IndexedDB onblocked 以后晚到 onsuccess 的无主连接泄漏。** 新测试旧源码 [run 39948659902](https://github.com/siskosun/ThreadLine/actions/runs/39948659902) 123/124，通过其余用例但该项 FAIL（预期 closeCount=1，实际=0）。`ff-db.js` 现在对已拒绝的打开请求关闭晚到的 DB handle，并在晚到升级事件中取消升级事务。[绿灯 run 39948779597](https://github.com/siskosun/ThreadLine/actions/runs/39948779597) 124/124 Node，合成 Fork E2E PASS。
- **最终保护复核：** `test/ff-core-e2e.py` 额外验证未确认 ID 经页面重载保留、成功 ACK 后删除、`sessionStorage` 不含明文 W₀/P、损坏的意图拒绝新建、旧课题与网页发送均未受影响。[最终代码 run 39949015216](https://github.com/siskosun/ThreadLine/actions/runs/39949015216) success：**124/124 Node**，实际 MV3 + IndexedDB/持久浏览器环境中的合成 Fork 核心 E2E PASS、Release skipped。
- **修复范围：** `threadline-extension/ff-page.js`、`ff-db.js`、`test/ff-core-e2e.py`、`test/ff-db.test.js`；此前持续通过的 SHA、24KB 限制、单写者/版本、单活动尝试、XSS、默认关闭、独立 DB、旧数据回归均保留。
- **差异与门禁：** main `docs/PLAN.md` 仍将 P1-CORE 记为 `planned`；PR #3 有待审源码和自动证据，但**不满足 `done` 所需合并 PR/正式证据及适用人工批准**。不擅自修改状态。Z0-LIVE 仍 `blocked/NOT SIGNED`，本轮所有网页仅为无账号合成，不涉及实际 ChatGPT 发送。
- 具体边界与独立取证索引：`docs/ff/evidence/P1_CORE_REVIEW_20261023.md`。
