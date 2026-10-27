# ThreadLine（研线） · main 开发预览版

> **main 已合并 UI-D0 / UI-D1 / UI-D2 / UI-D3（PR #77–#80），尚未发布新的正式 Release。** 这是可侧载测试的主干源码，不等于经过真人可用性验收。已安装的开发预览在侧栏标题下显示「UI-D3 开发预览 · main」。

多条 ChatGPT 对话同时研究同一课题时，在不同窗口显示统一的有效结论、已收口状态和需核对的字段差异，避免误在旧分支继续工作。辅助提供按需对话采集、AI 整理、宽页研究资料库、宽页思维导图，以及手动触发的网页项目/归档操作。

## 下载并安装当前 main 开发预览版

**[下载最新 main 源码 ZIP（包含宽页、侧栏减负及导图）](https://github.com/siskosun/ThreadLine/archive/refs/heads/main.zip)**

1. 解压 ZIP，在 Chrome/Edge 的 `chrome://extensions` 或 `edge://extensions` 中开启开发者模式。
2. 选择“加载已解压的扩展程序”，**指定 `ThreadLine-main/threadline-extension` 文件夹**（该文件夹直接包含 `manifest.json` 和 `research-map.js`），不要选择仓库根目录。
3. 关闭之前打开的研线侧栏，重新通过该扩展打开。侧栏标题应显示「UI-D3 开发预览 · main」；三个主标签下方有“在宽页打开资料库”按钮；完成一次采集后可通过“在宽页查看本次思维导图”打开只读地图。
4. 原版和开发版的基础版本号同为 `0.8.2`，请以**版本名称、已解压加载路径和侧栏开发预览标识**区别。可能同时有多个同名研线；排查时可临时禁用旧版，但**不要卸载、清空旧版本地数据或删除原扩展目录**。

[详细安装、存储隔离及故障处理](threadline-extension/INSTALL_MAIN_PREVIEW.md)。

### 正式 v0.8.2 Release（不包含这轮 UI-D1–D3）

[下载已正式发布的 v0.8.2](https://github.com/siskosun/ThreadLine/releases/download/v0.8.2/ThreadLine-v0.8.2.zip) · [SHA256 校验](https://github.com/siskosun/ThreadLine/releases/download/v0.8.2/SHA256SUMS.txt)。

正式版不会因 main 合并而自动更新；当前开发源码未通过完整 5+2 真人可用性、真实登录 ChatGPT AI 自动整理、读屏验收，**不得描述为新发布版本或完全修复深度整理无回复问题**。原本需要手动发送的结构化提示，仍需用户主动发送。

**v0.8.2 兼容性：** 旧版本地证据数据不承诺迁移或兼容，升级后请以新版重新建立的证据为准；如需保留旧证据，请自行留存 v0.8.1 安装包与本地数据副本。课题备份 JSON 的导出/导入不受影响。

**从 v0.5.0 升级：** 使用相同扩展目录覆盖并重新加载，先在新版「全部课题与管理 → 课题备份与恢复」导出一次 JSON。v0.6.0 没有强行添加 `manifest.key`，避免改变旧扩展 ID 导致原状态不可见。以后迁移到其他安装路径，应先从原扩展导出 JSON，安装后导入。备份不包含短期采集全文。

## Fork 双分支对照 Beta

对照实验能力（默认关闭，独立 IndexedDB，不影响原有课题）：冻结共同材料与指令 → 发起 K（2–4）个独立新聊天标签、同一文本逐字预填（**永不自动发送**）→ 你手动发送后自动绑定各分支会话身份并对照真实用户消息分类 → 全部分支完成后生成去标签对照（映射由记录的随机种子决定，可独立复算）→ 裁决前需通过隐藏校准题（服务端门禁）→ 提交裁决后揭盲 → 自包含 JSON 导出，并支持经严格验证的导入（哈希与映射重算，不覆盖既有实验）。浏览器重启可从持久身份恢复；未确认的操作永不自动重放。完整契约见 `docs/PLAN.md`。

> 2026-10-24 真人 K=4 实测（v0.8.0、无调试器、OS 级真实输入）：冻结 → 发起 → 逐字预填 → 人工发送 ×4 → 会话绑定与 exact 分类全链路打通；采集环节的两个实测缺陷已在 v0.8.1 修复其一（C/D 白名单），另一（采集静默停滞）登记待复现。证据与截图哈希见 `docs/ff/evidence/P4-LIVE-K4-V080.json`；对照/裁决/导出链路的线上验收另计。

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

界面开发先读 [UI 与体验标准](DESIGN.md)、[v0.8.2 现状基线](docs/ui/BASELINE_20261026.md)及[验收清单](docs/ui/CHECKLIST.md)。[视觉参考样张](docs/ui/reference.html)可下载后在浏览器打开；它展示建议方向，尚未应用到生产界面。任务状态仍以正式计划为准。

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
