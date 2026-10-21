# Fork 双分支 - 第零步验收（未通过）
基线：main d40d13f2918c33961ced333a9884af9c853157ad，v0.6.1。
本分支仅修复 Windows 上 check-syntax.mjs 对 file: URL 路径的错误处理，并补充异目录运行回归。
CI 是合成 ChatGPT 页面，不是已登录网页。

## 真实网页门禁
状态：BLOCKED / NOT RUN。远程设备 sunzc 离线；当前容器无法直接访问 GitHub，无法替用户在真实登录网页操作。**严禁把本项标记为通过。**
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
