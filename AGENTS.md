# ThreadLine Agent 执行约定

## 唯一权威来源
- 唯一正式开发计划为 docs/PLAN.md。
- 开工、切换分支和中断恢复时，重新读取 AGENTS.md、docs/PLAN.md、docs/architecture/REBUILD_ARCHITECTURE_20261101.md、当前 main SHA、相关 PR 和当前任务证据。
- docs/ff/PROGRESS.md、docs/ff/BLOCKED.md 和旧版 docs/ui 文档仅为历史记录；不能覆盖新计划状态。
- 旧版 13 项任务的 done 证据不得转移给新路线。

## 产品硬约束
1. 纯浏览器扩展，Chrome/Edge MV3；无本地常驻服务、无本地 HTTP 服务、无云端后端。
2. 主基座固定为 ChatGPT Markdown Export v0.6.59 / 13568bf75688de74a5af563b20d5ccd28f4ad532；MoveChat v1.2.1 / c4fdb698c09c8be4fbe572ab8a7420bd1e0deb0f 仅作接续参考；pionxzh exporter 仅作协议参考。上游升级必须单独审计。
3. 必须移除所有删除 ChatGPT 源对话的 UI、函数、请求路径和测试。不得添加源对话删除功能。
4. 永不自动发送 ChatGPT 消息。删除 autoSend 和点击 Send 的实现；新对话注入后由用户检查并手动发送。
5. 只保存实际文件字节。没有内容的文件对象不能标 saved；失败必须在 manifest 和 UI 显示。
6. 大文件存 IndexedDB Blob/分块，不以 Base64 长期保存；chrome.storage.local 只存小型设置。
7. 实时沙盒缓存必须由用户针对单个源对话明确开启；禁止全局监控或采集未选定对话。
8. 不覆盖用户草稿，不在非空 composer、已有对话、Project、Temporary 或未知页面执行接续。未知结果不自动重试。
9. 真实用户对话、附件、截图、导出 ZIP、Cookie、Token、签名 URL 不得进入公开仓库或诊断日志。

## 开发顺序
1. 先核对 main SHA、PR 和 docs/PLAN.md 当前任务状态。
2. 一次只选一个无依赖阻塞的任务；先查上游源码、当前实现、测试和实际命令。
3. 独立功能分支、聚焦 PR。不得直推 main、代用户审批、自动合并或发布 Release。
4. 修改计划、校验器、CI 或许可文件属于治理变更，PR 必须明确说明并独立复核。
5. 不得以旧路线历史 CI、临时目录原型或 Agent 自评作为新路线完成证据。
6. 不得通过删除测试、放宽断言、吞掉失败或将 unknown 改成 success 来让 CI 变绿。
7. 不确定的网页操作、上传状态、发送状态和采集结果禁止自动重放；永不因静默超时推断成功。

## 验证与完成状态
- Node 22+ 执行 threadline-extension/npm run verify。
- 有合成 Chromium 能力时执行 npm run test:e2e。
- 新扩展构建执行锁定基座的 Python build 流程，并检查生成 ZIP 可解压、manifest 正确、SHA-256 可复算。
- Windows/Edge 真实环境独立验收；合成 Chromium 不代表真实登录 ChatGPT 已通过。
- done 必须有 docs/ff/evidence/<TASK_ID>.json、已合并 PR、准确 HEAD 自动测试；人工门禁 yes 的任务还需所有者真实签署。具体格式见 docs/ff/EVIDENCE.md。
- PR Draft/Open、代码已写、CI 绿灯或自动化模拟都不等于 done。
- 连续三次复现同一失败后停止盲目重试，检查根因和原始日志；不能完成的环节记录为 blocked/unknown。

## UX 与质量
- 继承 DESIGN.md 的低噪音蓝灰视觉、360px 侧栏优先、宽页阅读、单任务主操作、持续错误、键盘焦点和无障碍目标。
- 保存、ZIP 下载、文件上传和用户发送是四种不同状态，不能合并为一个“完成”。
- 部分采集、缺失文件和上传未知必须就近可见；失败后保留草稿和本地档案。
- 每个 UI PR 附 320/360/480/768/1280px 截图或测量、空/加载/成功/失败/取消状态和键盘检查。真人 UX 未测时不得声称 UX 达标。
