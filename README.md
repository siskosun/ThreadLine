# ThreadLine（研线）

ThreadLine 是一个 Edge / Chrome 浏览器扩展，用于跨多个 ChatGPT 对话维护临时研究课题状态、核对分支进度、采集对话并生成研究交接材料。

**当前版本：v0.5.0（测试版）**。部分依赖 ChatGPT 网页界面的采集、自动分析、项目创建及归档操作尚未在真实登录会话下完成兼容性验收。

## 安装

1. 下载或克隆仓库。
2. 打开 `edge://extensions/` 或 `chrome://extensions/`，启用开发人员模式。
3. 选择 **加载解压缩的扩展程序**，指向 [`threadline-extension/`](threadline-extension/)（该目录内含 `manifest.json`）。
4. 刷新 ChatGPT 标签页，点击扩展图标打开侧栏。

## 文档

- [使用说明](threadline-extension/README.md)
- [架构与数据流程](threadline-extension/ARCHITECTURE.md)
- [实现细节](threadline-extension/IMPLEMENTATION.md)
- [更新记录](threadline-extension/CHANGELOG.md)
- [测试与未验收范围](threadline-extension/VERIFY.md)

本仓库不包含用户对话记录、认证凭据或 API Key。采用的第三方代码对应许可证位于 [`licenses/`](threadline-extension/licenses/)，来源说明位于扩展文档。

## 本地测试

在 `threadline-extension/` 下运行：

```bash
node --test test/*.test.js
```

网页自动分析是实验性功能，不应视为 OpenAI 官方支持的模型 API。使用前请核对适用条款及数据发送范围。
