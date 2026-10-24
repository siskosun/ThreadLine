# ThreadLine v0.8.0 实现及开源复用

扩展仍然是 Chromium MV3 原生 HTML/CSS/JavaScript，无 Node 运行依赖、服务器或第三方模型服务作为 Core 的必需组件。Node 22+ 只用于开发和验证。

保留原有对话采集、实验性 ChatGPT 网页分析、可选 Ollama / OpenAI API、结构化报告、思维导图、创建 ChatGPT 项目并移入及归档。新增显式迁移、快照与导入导出、字段差异、运行锁和只读健康探测。

重要函数：`ThreadLineCore.migrate`（向 schema2 迁移）；`ThreadLineCore.changesSince`（字段差异）；`ThreadLineBackup.parse/create`（有上限的 JSON 校验）；后台 `writeState/importBackup/recoverCaptures/acquireOrganizeLock`；页面 `ThreadLineSelectors.probe`。

原先 v0.5.0 的 DOM 选择器仍分布于 `content.js`、`organize-page.js` 和 `web-analyzer.js`，本轮仅抽取只读健康探测选择器，**不能声称整个写操作适配层已集中**。

开源策略：CGO 的分页采集思路、ChatGPT Shadow 的页面辅助逻辑，Dichrome 的网页可见控件创建项目流程、AI Page Summarizer 的标签页任务协调思想。请查阅仓库根目录 `THIRD_PARTY_NOTICES.md` 及扩展内许可证文本。根 MIT 许可证不覆盖他人的 Apache-2.0 源文件。

**暂缓的建议：** 无凭据安全约束的 ChatGPT 订阅 OAuth 接入；网页内容自动语义冲突裁决；真实登录下的反向自动化测试；固定 manifest key 导致旧版 ID 迁移；在没有性能瓶颈前迁移整个状态库到 IndexedDB。理由和测试边界见 VERIFY.md。

## v0.6.1 修复与打包

面板来源校验 `inspectPanelSender` / `requirePanelSender` 允许合法的扩展 `panel.html` 在侧边栏或独立标签页中访问共享状态，对冲突容器要求浏览器独立证明同一活跃面板文档，拒绝 ChatGPT 网页和伪造来源；新增正反权限测试。`scripts/build-release.py` 使用确定性文件顺序、固定 ZIP 时间和 SHA256 清单，通过 GitHub Actions 自动发布。

## v0.7.0 Fork 双分支对照（P2/P3）

新增独立模块：`ff-core.js`（冻结、规范化比较、四态状态机、X/Y 映射与裁决校验）、`ff-db.js`（独立 IndexedDB、CAS 修订、创建身份不可变）、`ff-page.js`/`ff.html`（Fork 页面 UI）、`background.js` 内 `FF_*` 消息族（发起双分支、重新预填、采集、对照、裁决、导出）。双分支标签经两段式创建（先建空标签再导航）以避免初始文档逃逸；预填复用生产 handoff 通道，ACK 即逐字回读证明；完成判定要求采集完整且两类独立信号。X/Y 映射为记录种子的纯函数；导出为自包含快照，仅导出不导入。
