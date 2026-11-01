# ThreadLine（研线）— ChatGPT 对话本地保全与新窗口接续

> **重建计划评审中。** 当前 main / v0.8.2 仍是旧版研线；本分支提出以 ChatGPT Markdown Export 为保全基座、MoveChat 为接续交互参考的新路线。新产品尚未实现、安装或发布。

## 产品目标

将一个 ChatGPT 对话的可见消息、分支、上传附件和助手生成文件保存到浏览器本地；之后打开一个新的 ChatGPT 普通对话，自动准备历史附件、短接续提示和用户选定的原始文件。

核心原则：
- 纯浏览器扩展，无本地常驻程序、无本地 HTTP 服务、无云端后端。
- IndexedDB 保存工作副本，用户可下载自包含 ZIP 档案。
- 保存文件必须有实际字节、SHA-256 和来源消息关联；下载失败明确标记。
- 助手生成的沙盒文件支持单对话显式实时缓存，降低临时文件过期风险。
- 历史对话以附件接续，不把长 transcript 塞进输入框。
- 新窗口只预填和上传；永不自动发送，不覆盖已有草稿。
- 不提供删除 ChatGPT 源对话的功能。

## 开源基础

- [ChatGPT Markdown Export](https://github.com/thekester/chatgpt-export)：MIT，固定 v0.6.59 作为采集、附件和 ZIP 基座。
- [MoveChat](https://github.com/VC067/MoveChat)：MIT，仅借鉴新聊天打开与文件注入交互。
- [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter)：MIT，参考 sediment:// 指针解析和图片缓存。

上游版本固定，不自动跟随更新；复制代码时保留许可与来源。

## 正式计划与状态

唯一正式开发计划：[docs/PLAN.md](docs/PLAN.md)。

技术架构：[docs/architecture/REBUILD_ARCHITECTURE_20261101.md](docs/architecture/REBUILD_ARCHITECTURE_20261101.md)。

端到端验收：[docs/acceptance/REBUILD_ACCEPTANCE_20261101.md](docs/acceptance/REBUILD_ACCEPTANCE_20261101.md)。

UX 指引：[DESIGN.md](DESIGN.md)。

任何实现任务必须先读 [AGENTS.md](AGENTS.md)。新路线所有任务目前均为 planned；旧版 PR #82/#83 不属于新架构实现，不得直接合并。

## 真实限制

ChatGPT 网页接口和文件注入依赖非公开网页协议，可能随产品更新变化。文件缓存无法追回在启用缓存前已经过期且服务端不再提供的文件。浏览器本地存储也可能受用户清理和磁盘配额影响，因此 ZIP 下载是独立备份，不应只依赖 IndexedDB。

## 当前版本

正式 v0.8.2 仍是旧版 ThreadLine，包含旧课题管理与研究整理功能，不包含本次重建方案。新路线通过计划评审、实现、真实 Edge 验收和单独发布授权前，不应把此分支作为可用安装包。
