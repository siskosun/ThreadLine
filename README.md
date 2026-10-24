# ThreadLine（研线）

> **v0.8.0 测试版** · Chrome / Edge 右侧栏研究工作台

多条 ChatGPT 对话同时研究同一课题时，在不同窗口显示统一的有效结论、已收口状态和需核对的字段差异，避免误在旧分支继续工作。辅助提供按需对话采集、AI 整理、思维导图，以及手动触发的网页项目/归档操作。

## 下载安装包

**[下载 ThreadLine v0.7.0 安装 ZIP（GitHub Release）](https://github.com/siskosun/ThreadLine/releases/download/v0.7.0/ThreadLine-v0.7.0.zip)**

不需要构建工具。下载 ZIP → 解压 → 打开 `edge://extensions/` 或 `chrome://extensions/` → 启用开发人员模式 →「加载解压缩的扩展程序」→ 选中包含 `manifest.json` 的 `threadline-extension` 文件夹。

正式安装包由 GitHub Actions 在全部测试通过后构建并发布；[下载 SHA256 校验文件](https://github.com/siskosun/ThreadLine/releases/download/v0.7.0/SHA256SUMS.txt)。如 Release 尚未完成，可使用[旧版 v0.6.1 仓库压缩包](dist/ThreadLine-v0.6.0.zip)。侧载扩展不会自动更新。

**从 v0.5.0 升级：** 使用相同扩展目录覆盖并重新加载，先在新版「全部课题与管理 → 课题备份与恢复」导出一次 JSON。v0.6.0 没有强行添加 `manifest.key`，避免改变旧扩展 ID 导致原状态不可见。以后迁移到其他安装路径，应先从原扩展导出 JSON，安装后导入。备份不包含短期采集全文。

## Fork 双分支对照 Beta

新增第一期能力（默认关闭，独立 IndexedDB，不影响原有课题）：冻结共同材料与指令 → 发起双分支（两个独立新聊天、同一文本预填、**永不自动发送**）→ 人工发送后自动绑定会话身份并读取真实用户消息对照分类 → 两分支完成后生成 X/Y 去标签对照（映射可由记录的随机种子独立复算）→ 提交裁决后揭盲 → 自包含 JSON 导出（仅导出）。浏览器重启可从持久身份恢复；未确认的操作永不自动重放。完整契约见 `docs/PLAN.md`。

## 核心功能

- **对话切换：** 当前课题、已核实结论、同课题分支一键跳转；关闭课题后旧页面尝试阻止新发送。
- **具体版本差异：** 以字段级历史显示目标、有效结论或状态从什么改成什么。仅调整标点和空白不生成新版本；仍由人决定是否核对或收口。
- **可恢复的本地状态：** `schema:2` 显式迁移、JSON 导出/导入、最近五份滚动快照；浏览器关闭后数据仍在该扩展的本地存储中。
- **网页适配自检：** 只读检查当前 ChatGPT 页面上的输入框等控件；显示可证实的历史操作成功时间。未做过真实操作的功能不标记为通过。
- **研究整理：** 按需采集、AI 分析、思维导图、审核结论后发布，以及创建 ChatGPT 项目、移入和归档原对话。

## 可靠性与现实边界

**核心状态管理有自动化测试，但 ChatGPT 真实登录网页的采集、项目创建、移入、归档和网页 AI 自动分析均尚待真实账号验收。** 后者依赖网页结构和使用权限，界面变更时可能失效。扩展提供实验模式及失败后人工处理，不能把 DOM 探针的“输入框可见”理解为自动化功能已通过。

网页自动模型分析并非 OpenAI 官方 API；正式使用可选授权模型服务。网页操作不在后台默默重试。仅在主动开启采集时读取指定对话正文；研究内容保存在本地，点击模型分析时才按界面确认发送。**GitHub 仓库公开，不能在源码或 Issues 中上传内部研究文本和凭据。**

## 正式开发计划

**[GitHub 唯一正式计划：docs/PLAN.md](docs/PLAN.md)** 记录开发目标、分阶段任务、当前状态、依赖和验收条件。任何 Agent 应先阅读 [AGENTS.md](AGENTS.md) 再执行；[证据规范](docs/ff/EVIDENCE.md) 说明何时可以把任务标记为完成。

GitHub Actions 会执行计划状态、实际 PR 合并/检查结果核验，以及全部既有回归测试。**自动化通过不代替真实登录 ChatGPT 的人工验收**。旧版计划文件和外部资料库副本不再作为当前状态来源。

## 验证与开发

源码位于 [`threadline-extension/`](threadline-extension/)，不需要 Node 才能安装；Node 22+ 用于开发和测试：

```bash
cd threadline-extension
npm run verify
```

浏览器持久化集成检查（合成网页，**不使用真实账号**）：

```bash
python -m pip install playwright==1.60.0
python -m playwright install chromium
python test/extension-e2e.py
```

仓库包含 `.github/workflows/verify.yml` 自动执行测试。详见 [验收范围与真实账号检查清单](threadline-extension/VERIFY.md)。测试通过不等于生产兼容性已验收。

## 本机推送前检查（Git Bash）

为避免代码未验证就推送，仓库提供可版本管理的 [pre-push 钩子](.githooks/pre-push) 和[安装脚本](scripts/install-pre-push.sh)。**克隆或下载仓库不会自动启用 Git hooks**。在本机仓库根目录的 Git Bash 中运行一次：

```sh
sh scripts/install-pre-push.sh
```

安装脚本会把钩子复制到本仓库的 `.git/hooks/pre-push` 并赋予执行权限；再次运行是幂等的。遇到已有钩子或 `core.hooksPath` 自定义配置时会停止，**不会覆盖已有逻辑**。此钩子在每次 `git push` 前运行 `threadline-extension/npm run verify`，包括所有 JavaScript 语法、版本一致性和 Node 单元回归测试；失败时阻止推送。它不重复运行需要 Chromium 的完整 E2E，后者保留给 CI。

可先手工测试：`sh .githooks/pre-push`。**不要用 `git diff --cached` 检测“即将推送的代码”**，因为已提交但未暂存的改动不会出现在这个差异中。本钩子检查整个被跟踪的扩展源码。运行钩子要求本机安装 Node.js 22+ 与 npm。

## 许可证

项目自有代码按 [MIT License](LICENSE) 发布；第三方许可及版权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `threadline-extension/licenses/`。
