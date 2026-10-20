# ThreadLine（研线）

> **v0.6.0 测试版** · Chrome / Edge 右侧栏研究工作台

多条 ChatGPT 对话同时研究同一课题时，在不同窗口显示统一的有效结论、已收口状态和需核对的字段差异，避免误在旧分支继续工作。辅助提供按需对话采集、AI 整理、思维导图，以及手动触发的网页项目/归档操作。

## 下载安装包

**[下载 ThreadLine v0.6.0 安装 ZIP](https://github.com/siskosun/ThreadLine/raw/refs/heads/main/dist/ThreadLine-v0.6.0.zip)**

不需要构建工具。下载 ZIP → 解压 → 打开 `edge://extensions/` 或 `chrome://extensions/` → 启用开发人员模式 →「加载解压缩的扩展程序」→ 选中包含 `manifest.json` 的 `threadline-extension` 文件夹。

直接下载地址也位于仓库 `dist/ThreadLine-v0.6.0.zip`。当前 GitHub 连接无法创建 Releases；这里是 **仓库内 ZIP 分发**，不是 GitHub Release，更没有自动更新承诺。[校验 SHA256](dist/SHA256SUMS.txt)。

**从 v0.5.0 升级：** 使用相同扩展目录覆盖并重新加载，先在新版「全部课题与管理 → 课题备份与恢复」导出一次 JSON。v0.6.0 没有强行添加 `manifest.key`，避免改变旧扩展 ID 导致原状态不可见。以后迁移到其他安装路径，应先从原扩展导出 JSON，安装后导入。备份不包含短期采集全文。

## 核心功能

- **对话切换：** 当前课题、已核实结论、同课题分支一键跳转；关闭课题后旧页面尝试阻止新发送。
- **具体版本差异：** 以字段级历史显示目标、有效结论或状态从什么改成什么。仅调整标点和空白不生成新版本；仍由人决定是否核对或收口。
- **可恢复的本地状态：** `schema:2` 显式迁移、JSON 导出/导入、最近五份滚动快照；浏览器关闭后数据仍在该扩展的本地存储中。
- **网页适配自检：** 只读检查当前 ChatGPT 页面上的输入框等控件；显示可证实的历史操作成功时间。未做过真实操作的功能不标记为通过。
- **研究整理：** 按需采集、AI 分析、思维导图、审核结论后发布，以及创建 ChatGPT 项目、移入和归档原对话。

## 可靠性与现实边界

**核心状态管理有自动化测试，但 ChatGPT 真实登录网页的采集、项目创建、移入、归档和网页 AI 自动分析均尚待真实账号验收。** 后者依赖网页结构和使用权限，界面变更时可能失效。扩展提供实验模式及失败后人工处理，不能把 DOM 探针的“输入框可见”理解为自动化功能已通过。

网页自动模型分析并非 OpenAI 官方 API；正式使用可选授权模型服务。网页操作不在后台默默重试。仅在主动开启采集时读取指定对话正文；研究内容保存在本地，点击模型分析时才按界面确认发送。**GitHub 仓库公开，不能在源码或 Issues 中上传内部研究文本和凭据。**

## 验证与开发

源码位于 [`threadline-extension/`](threadline-extension/)，不需要 Node 才能安装；Node 22+ 用于开发和测试：

```bash
cd threadline-extension
npm run verify
```

浏览器持久化集成检查（合成网页，**不使用真实账号**）：

```bash
python -m pip install playwright==1.55.0
python -m playwright install chromium
python test/extension-e2e.py
```

仓库包含 `.github/workflows/verify.yml` 自动执行测试。详见 [验收范围与真实账号检查清单](threadline-extension/VERIFY.md)。测试通过不等于生产兼容性已验收。

## 许可证

项目自有代码按 [MIT License](LICENSE) 发布；第三方许可及版权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `threadline-extension/licenses/`。
