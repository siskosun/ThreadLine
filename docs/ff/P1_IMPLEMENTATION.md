# ThreadLine Fork Beta（P1 核心）使用与验证

当前是 **Draft PR #3 的开发测试版**，不是正式 Beta 安装包；原有正式版本仍为 v0.6.1。不要将本页所述本地测试称为 ChatGPT 真实双分支验收。

## 这一步能做什么

- 打开独立的「Fork 双分支对照 · 基础开发版」，手动启用本地实验功能。
- 输入共同材料 W₀ 和同一任务指令 P；最终文本按固定模板组合。
- 最终文本须不超过 **24,000 UTF-8 字节**，超过时会拒绝保存，不截断。
- 冻结并保存 SHA-256、原始文本和两条初始分支状态于独立 IndexedDB \`threadline_ff_v1\`；重启后仍可读取。
- 相同创建操作重复回报时只返回同一实验；已知或未知发送状态不会触发后台自动发送或自动重试。

**不能做：** 新建 ChatGPT 会话、填充草稿、发送消息、自动 Flush、判断最终回复、盲评、导入 JSON 或正式发布。这些属于需要独立验收的后续阶段。

## 体验未发布源码（只用于隔离浏览器配置）

1. 下载或检出 GitHub Draft PR #3 的对应分支 \`feat/ff-core-pr1-20261021\`。
2. 在 Chrome 或 Edge 打开扩展管理页，启用「开发者模式」，选择「加载已解压的扩展程序」，选中仓库的 \`threadline-extension\` 文件夹。
3. 打开 ThreadLine 侧栏，在「全部课题与管理」区域找到「Fork 双分支实验」入口，打开独立页面。
4. 勾选「启用本地 Fork 实验存储」，输入测试用的非敏感 W₀ / P，点击「冻结并保存在本地」。
5. 核对实验编号、字节数、SHA-256 和原始文本；关闭并重新打开实验页，确认列表及内容仍在。取消勾选可关闭实验功能，但 **不会删除实验数据**。

此功能不改变原有课题和 JSON 备份；实验数据不包含在原有备份中。不要将实验数据视为已备份。

## 自动测试

在仓库 \`threadline-extension\` 文件夹中使用 Node 22+：

\`\`\`sh
npm run verify
python -m pip install playwright==1.60.0
python -m playwright install chromium
npm run test:e2e
\`\`\`

- \`verify\`：校验计划、语法、版本及 Node 回归。
- \`test:e2e\`：加载真实 MV3 扩展 + Chromium IndexedDB，但 **ChatGPT 页面是离线合成页面**，没有真实账户。
- GitHub Actions run 39611141838：118 项 Node 通过，两套合成 E2E 通过。
- Windows 实机与真实 ChatGPT 网页验收仍须按 \`docs/PLAN.md\` 第零步单独执行；本阶段不允许用合成结果签署 Z0-LIVE。

## 发现异常时

不要重复点击真实网页上的发送按钮。本阶段根本没有此按钮。开发实验遇到错误时保留错误消息、扩展版本和复现步骤，勿提交真实聊天文本、Token、Cookie 或账号数据到公开仓库。

正式计划与完成判定只看 [docs/PLAN.md](../PLAN.md)，进度记录见 [PROGRESS.md](PROGRESS.md)。
