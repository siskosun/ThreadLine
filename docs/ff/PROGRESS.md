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
