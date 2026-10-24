# ThreadLine Fork Beta（P1 核心）使用与验证

当前是 **Draft PR #3 的开发测试版**，不是正式 Beta 安装包；原有正式版本仍为 v0.6.1。不要将本页所述本地测试称为 ChatGPT 真实双分支验收。

## 这一步能做什么

- 打开独立的「Fork 双分支对照 · 基础开发版」，手动启用本地实验功能。
- 输入共同材料 W₀ 和同一任务指令 P；最终文本按固定模板组合。
- 最终文本须不超过 **24,000 UTF-8 字节**，超过时会拒绝保存，不截断。
- 冻结并保存 SHA-256、原始文本和两条初始分支状态于独立 IndexedDB `threadline_ff_v1`；重启后仍可读取。
- 相同创建操作重复回报时只返回同一实验；已知或未知发送状态不会触发后台自动发送或自动重试。

**不能做：** 新建 ChatGPT 会话、填充草稿、发送消息、自动 Flush、判断最终回复、盲评、导入 JSON 或正式发布。这些属于需要独立验收的后续阶段。

## 体验未发布源码（只用于隔离浏览器配置）

1. 下载或检出 GitHub Draft PR #3 的对应分支 `feat/ff-core-pr1-20261021`。
2. 在 Chrome 或 Edge 打开扩展管理页，启用「开发者模式」，选择「加载已解压的扩展程序」，选中仓库的 `threadline-extension` 文件夹。
3. 打开 ThreadLine 侧栏，在「全部课题与管理」区域找到「Fork 双分支实验」入口，打开独立页面。
4. 勾选「启用本地 Fork 实验存储」，输入测试用的非敏感 W₀ / P，点击「冻结并保存在本地」。
5. 核对实验编号、字节数、SHA-256 和原始文本；关闭并重新打开实验页，确认列表及内容仍在。取消勾选可关闭实验功能，但 **不会删除实验数据**。

此功能不改变原有课题和 JSON 备份；实验数据不包含在原有备份中。不要将实验数据视为已备份。

## 自动测试

在仓库 `threadline-extension` 文件夹中使用 Node 22+：

```sh
npm run verify
python -m pip install playwright==1.60.0
python -m playwright install chromium
npm run test:e2e
```

- `verify`：校验计划、语法、版本及 Node 回归。
- `test:e2e`：加载真实 MV3 扩展 + Chromium IndexedDB，但 **ChatGPT 页面是离线合成页面**，没有真实账户。
- GitHub Actions run 39611141838：118 项 Node 通过，两套合成 E2E 通过。
- PR #1 的 [Windows 托管 Runner 验证](https://github.com/siskosun/ThreadLine/actions/runs/39612233835) 已通过；用户自己的 Windows 已登录 ChatGPT 网页仍须按 `docs/PLAN.md` 第零步单独验收。本阶段不允许用合成结果签署 Z0-LIVE。

## 发现异常时

不要重复点击真实网页上的发送按钮。本阶段根本没有此按钮。开发实验遇到错误时保留错误消息、扩展版本和复现步骤，勿提交真实聊天文本、Token、Cookie 或账号数据到公开仓库。

正式计划与完成判定只看 [docs/PLAN.md](../PLAN.md)，进度记录见 [PROGRESS.md](PROGRESS.md)。


## 2026-10-22 单一活动尝试约束

每个 A/B 分支可以保留多次执行的历史，但**同一时刻最多只有一个未完成的 attempt**。一次执行还处于 `pending` 时，后台不允许用另一个 attempt ID 开始新一轮，也不允许替换当前执行。原尝试进入 `failed` 或 `unknown` 后，用户明确选择新运行、提供新的 attempt ID，才允许下一次 `pending/created`。

- 这只约束独立 Fork 状态和存储，不接管普通课题，不自动发送消息，也不提前实施 P2/Fork 网页自动化。
- 新增单元与真实 MV3 合成集成负向检查。先提交测试 `3ee3299e`，[红灯 run 39786233409](https://github.com/siskosun/ThreadLine/actions/runs/39786233409)：123 项中 122 通过、1 项按预期失败；提交状态机修复 `520048a5`，[绿灯 run 39786365758](https://github.com/siskosun/ThreadLine/actions/runs/39786365758)：123/123；补充后台/IndexedDB E2E `73d4962b`，[完整 run 39786783682](https://github.com/siskosun/ThreadLine/actions/runs/39786783682)：123/123 Node、合成 Chromium MV3 成功。
- 该自动结果不替代真实 Edge 测试、合并批准或人工签署。当前 GitHub `docs/PLAN.md` 仍登记 P1-CORE 为 `planned`，PR #3 为 Draft；尚未放行 P2/P3。



## 2026-10-23 P1 审查：回执丢失后的手动恢复

创建实验是**本地保存**，不是发送 ChatGPT 消息。如果点击保存时后台已写入 IndexedDB、但扩展页面没有收到成功回执，请保留同一 `ff.html` 标签。该标签刷新后，可重新填入**完全相同**的 W₀ 和 P，再由用户明确点击一次保存；系统复用上一次操作 ID，返回已保存记录，而不是创建第二条。**不会自动重试。**

- 这个创建意图仅在同一浏览器标签页的 `sessionStorage` 中保存 SHA-256 摘要和操作 ID，不保存 W₀/P 正文；收到真实成功回执且已成功显示列表和详情后，才删除临时意图。
- 若标签已关闭、新开另一个标签、会话存储丢失或被清空，无法保证自动找回原操作 ID。请**先核对已有实验列表**，不要把同样输入重新点击保存视为安全恢复。
- 若本标签的临时记录损坏或无法读取，系统拒绝新建以避免无意重复；需人工核对历史实验，而不是绕过保护。
- IndexedDB 因升级阻塞而拒绝时，即使浏览器稍后交付打开成功，也会关闭无主数据库句柄，并阻止已放弃的升级操作继续提交。无自动重新尝试。
- 验证：[旧代码合成红灯](https://github.com/siskosun/ThreadLine/actions/runs/39947872853)、[恢复修复绿灯](https://github.com/siskosun/ThreadLine/actions/runs/39948497591)；[数据库资源泄漏红灯](https://github.com/siskosun/ThreadLine/actions/runs/39948659902)、[修复绿灯](https://github.com/siskosun/ThreadLine/actions/runs/39948779597)；[最终新增防损坏测试绿灯](https://github.com/siskosun/ThreadLine/actions/runs/39949015216)：124/124 Node，合成 Chromium MV3 成功。

这仍是独立 Draft PR #3，未合并，不代表真实 Windows 用户环境或 Z0-LIVE 通过；GitHub main 的唯一正式计划未改。

## 2026-10-23 独立修复候选：已保存但显示失败

当前候选组合包含 PR #1/#5/#6 和 PR #3 的核心代码，原 PR 均未因此合并。正式计划与 main 保持一致。

- 若数据库已经保存，但列表或详情读取失败，提示会明确说“实验已保存”。在同一标签保留相同输入再次点击保存，或刷新标签再输入相同材料，仍复用原操作 ID。后台返回原记录，列表恢复不会创建第二条实验。
- 完整显示成功后，该意图结束；再次点击保存是新的显式创建。保存执行期间，输入事件不会重新启用保存按钮。
- 同一 attempt 的会话身份一旦建立就不得改变；暂未携带身份的状态事件保留旧绑定。人工新 attempt 可以使用新的会话身份，历史 attempt 不变。
- 核心结束信号仅接受字符串 `generation`（已观察生成结束）、`stable`（回复稳定至少 5 秒）、`final`（可信最终结束标记），至少两个不同种类。未知字符串、对象、空值和布尔值不能充数。这些名称是上游已验证事实的声明，不会自行证明真实网页事件；当前 P1 消息入口仍禁止提交完成或网页证据，未实现 P2/P3 适配器。
- 数据库 reducer 必须是纯转换；修改传入旧记录会被拒绝，包括伪装成不写入的重复回执。真实未变的幂等重放仍受支持。数据库名称、版本及保存格式不变。

同标签意图恢复仍不覆盖标签关闭、会话存储清除或换用不同输入的情况。真实 Edge、旧用户配置升级和最终人工风险接受继续单独验收。

## 2026-10-23 用户验收与综合集成候选

用户已明确接受“当前所有修复与 P1 核心验收”。现由面向 main 的 [Draft PR9](https://github.com/siskosun/ThreadLine/pull/9) 汇集已验收代码，PLAN 的 P1-CORE 为 `in_review`。前文的 `planned` 和未接受风险描述属于当时快照；原始测试/浏览器失败记录继续保留。PR9 生产源码与已验收 `102185b` 相同，保持本地冻结/存储能力和默认关闭。完成状态仍待实际合并和对应 CI；完整 Z0-LIVE 的消息/回复与异常并发验收须单独满足，P2/P3 未实施。
