# ThreadLine 重建架构说明（2026-11-01）

本文件是唯一正式开发计划的技术设计补充。它定义目标结构，不表示代码已实现。

## 1. 组件边界

1. **采集层**：以 ChatGPT Markdown Export 固定版本的内部 API 解析为起点；保留原始 JSON、消息 mapping 和可访问分支。DOM 仅作可见性校验/降级，降级必须标记 partial。
2. **资产解析层**：从消息 parts、metadata、引用和可见沙盒链接提取文件引用；统一解析 file-service://、sediment://、sandbox: 和受信 HTTPS 下载地址。
3. **下载层**：同源请求使用当前 ChatGPT 页面会话；外部签名 URL 通过最小化权限的扩展后台下载，不转发 Cookie、Authorization 或 Referer。URL 重定向逐跳校验协议和主机。
4. **本地存储层**：IndexedDB 保存元数据、任务和 Blob/分块；ZIP 导出生成独立档案。大文件不在 content-script 消息中一次性传递 Base64。
5. **实时缓存层**：用户对单个对话显式开启后，观察该对话中新出现的可见生成文件，尽快缓存沙盒字节。
6. **接续编译层**：把历史整理为附件，将短提示与用户选定的原始附件组成接续包。
7. **注入层**：复用 MoveChat 的 DataTransfer/File 机制，但仅对空白的新普通 ChatGPT 对话执行；上传状态未知即停止，不自动发送。
8. **界面层**：扩展侧栏承担当前对话保存和接续；宽页承担长历史阅读、文件检查和档案管理。具体页面可在 UI 实测后调整，不继承旧证据库的三导航。

## 2. 本地数据模型

建议的逻辑实体：

### CaptureRun
- id、sourceConversationId、sourceUrl、startedAt、completedAt
- status: capturing | complete | partial | error | cancelled
- branchStatus: valid | partial | invalid | unknown
- messageCount、branchCount、assetCount
- errorSummary、capabilities

### Message
- messageId、nodeId、parentNodeId、childNodeIds
- role、timestamp、contentParts
- branchMembership、isVisible、sourceType
- 不把隐藏系统消息、隐藏推理或内部提示写入用户档案。

### Asset
- assetKey、messageId、originalName、mimeType、expectedSize
- sourceKind: user_upload | generated_sandbox | image_pointer | audio_video | external_reference
- pointerScheme、sourcePointer（签名 URL 不持久化为长期引用）
- status: discovered | queued | downloading | saved | missing | expired | rejected | unknown
- actualSize、sha256、blobKey、lastErrorCode、lastAttemptAt

### ArchiveManifest
- schema version、source conversation identity hash、capture time
- messages/branches/assets 统计
- capture completeness 与 branch integrity
- 每个资产的原名、归属消息、保存路径、MIME、大小、SHA-256、状态
- 失败原因及能力探测结果（不含敏感内容）

## 3. 分支保真

ChatGPT mapping 是消息节点关系图，不可只按 DOM 当前顺序推断。采集时：
- 验证 current_node 与 mapping 对应。
- 从 current_node 沿 parent 回溯当前路径，检测环和断链。
- 保留 children 和可访问的替代分支，不把 regenerate/fork 节点覆盖为同一条消息。
- 输出时区分当前分支和替代分支；原始 JSON 是最终核对依据。
- 对照官方导出时，以 conversation ID、message ID、node ID 和文件映射进行匹配；标题与时间仅作辅助。

## 4. 资产下载与缓存

### 4.1 即时采集
当前用户点击“保存对话”时，枚举本次对话可见消息中的资产引用，按去重键下载。每次下载先记录 discovered，再记录 queued/downloading，最终写 saved 或明确失败状态。

### 4.2 实时沙盒缓存
用户开启单对话缓存后：
- 绑定源 tab ID、conversation ID 和 cache run ID；任一身份改变立即停止。
- 只观察该对话中新出现的消息与文件链接；不扫描其他 tab。
- 发现 sandbox: 或可验证生成文件引用后立即排队；先写任务记录，再下载字节，分块落 IndexedDB，完成后计算 SHA-256 并原子标记 saved。
- 重复事件按资产 ID/消息 ID/路径幂等去重。
- 取消、浏览器关闭、service worker 重启后可恢复未完成队列；不对未知下载结果自动重放。
- 若原始沙盒已经过期，记录 HTTP 状态和失败阶段；不能把远端路径作为本地文件替代。

### 4.3 资源上限
OpenAI [当前文件上传帮助](https://help.openai.com/en/articles/8555545-uploading-files-and-audio-to-chatgpt)列出单文件 512MB、图片 20MB、文本/文档 2M tokens、CSV/表格约 50MB；实际仍受计划、账号、浏览器和峰值限额影响。扩展不应简单照搬所有上限：需用流式下载、IndexedDB 配额测量和 ZIP 构建基准确定自身安全阈值。超限必须在下载前/下载中显式拒绝并记为 missing/rejected，不允许静默截断。

## 5. ZIP 档案布局

建议：
- conversation.json：原始 JSON 和 branch mapping。
- conversation.md：可阅读的消息记录，包含分支标签、时间和附件引用。
- manifest.json：完整性、文件哈希和失败明细。
- assets/<content-hash>.<ext>：二进制资产；manifest 保留原始文件名和消息关系。
- diagnostics.json：脱敏诊断。

同一二进制文件可按 SHA-256 去重，但 manifest 必须保留每条消息的独立引用。文件名需安全规范化，不能通过路径穿越写出 ZIP 目录。解压后再次计算哈希，确保与归档清单一致。

## 6. 接续包与注入状态机

接续状态建议：
prepared → target_opened → draft_filled → files_queued → files_uploading → files_confirmed | upload_unknown → ready_for_user_review → user_sent（仅用户可确认）

- conversation_history.md 是完整上下文载体；短提示仅负责导航模型读取目标、进度和文件索引。
- 原始附件按用户选择注入。默认不上传全部资产。
- 当前官方发布说明报告单条消息最多 20 个文件，但页面能力会变化；启动时探测当前文件输入和页面反馈，按真实限制分批。
- 选择目标文件输入时排除 accept="image/*" 的相机/图片专用输入，优先确认通用 Attach files 控件。
- 使用 DataTransfer 构造 File；仅在新普通聊天、composer 为空、页面身份未变化时注入。
- 不点击 Send。上传进度可识别则等待实际完成；无法识别时标 upload_unknown 并让用户检查。
- 自动注入在有界时间内无法确认时，释放控制权并显示侧栏文件暂存区；优先验证拖拽单个/多个 File 条目到 ChatGPT composer 的可行性，失败时退回下载接续包和人工上传。
- 注入失败后保留本地档案和接续包，不覆盖用户输入；不得自动重试未知操作。

## 7. 权限和隐私

- Manifest host permissions 仅限 ChatGPT 页面及经验证的文件下载主机。
- 不使用 <all_urls> 作为默认权限，不为采集请求额外云服务。
- 认证 token 仅内存使用；日志不得包含 token、Cookie、Authorization、签名 URL、消息正文或文件内容。
- 文件 URL 可能带短期签名，不作为档案唯一定位方式，也不导出到诊断。
- 所有跨上下文消息绑定 source tab、conversation ID、run ID；源对话切换或 tab 关闭时取消任务。
- 用户删除本地档案与源对话删除完全分离；扩展没有删除 ChatGPT 源对话能力。

## 8. 开发实现边界

优先沿用 ChatGPT Markdown Export 的 vanilla JS、ZIP、Python 构建方式；不为重建引入 React/Vue、常驻后台服务器或额外数据库服务。Node 22 用于单元测试和 CI，不是扩展运行时依赖。每个阶段先补纯函数测试，再补合成 Chromium MV3 E2E，最后进行真实 Edge 登录验收。
