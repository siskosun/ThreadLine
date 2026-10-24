# Z0-LIVE 委托验收轮：零发送套件 4/4 PASS；生成循环被账号侧条件阻塞

日期：2026-10-24。候选：main `b0d470b3d7a386f2243f1bafb26aa54c7fcc26a0`（PR #10 合并后，含 #11/#12）。仓库所有者在会话中明确委托本轮验收并授权全过程处理；本文件所有浏览器操作均由受托 Agent 执行，未记录、未持久化任何凭据、Cookie 值或会话令牌；未修改系统权限。

## 通道

1. **Tabbit 浏览器**（实例 27CF1069C0A7CC9F，已登录会话）：可驱动站点页面，但扩展上下文不可达（`context.serviceWorkers()` 恒空、无 `--remote-debugging-port`、`chrome-extension://` 导航被拒）。已把其加载路径同步为 main 代码（见 [REAL_SITE_429_20261024.md](REAL_SITE_429_20261024.md)）并重启浏览器。
2. **Edge 156.0.4314.42 临时 profile**：最小复制（Local State + Network/Cookies + Preferences，1.7MB）后 CDP 可用；登录态经本地回环从 Tabbit 会话 cookie 注入（值仅在内存流转）；`--load-extension` 从同一同步路径加载扩展。验证结束已删除整个临时 profile。

## 扩展运行时核验（首次达成）

Edge CDP 下对运行中扩展的 Service Worker 求值：6 个资源 SHA-256 全部与 main `b0d470b` 磁盘文件一致（handoff `429b0e50…`、selectors `0bdeb077…`、background `f64ff703…`、ff-page `a53c448b…`、ff-core `2c25701a…`、ff-db `baee6a7f…`）。`tl_ff_enabled_v1` 不为 true → **Fork Beta 默认关闭**在运行时确认。`chrome.storage.session` 无遗留 `tl_handoff_*`。

## 零发送套件（真实登录站点，生产交付路径，4/4 PASS）

生产交付路径 = 后台写 `chrome.storage.session` 的 `tl_handoff_<tabId>`（`{text, createdAt}` 生产形状）+ `chrome.tabs.sendMessage(TL_HANDOFF_READY)`，与 `openChatWithDraft` 的调用一致；全程 0 次发送、0 个消息节点。

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 既有草稿保护 | PASS | 既有 175 字节草稿预填前后逐字节一致；横幅「输入框已有草稿，研线不会覆盖或自动发送。」 |
| 小型多行预填 | PASS | 132/132 字节 exact；横幅「研线已逐字核对预填草稿。检查内容后按发送；不会自动替你发送。」 |
| 23,569 字节预填 | PASS | 23,569/23,569 字节、2,139/2,139 LF、SHA-256 `dbe5d309…b711c2` 与 2026-10-23 PR#7 真实站点记录**逐字节一致**（跨两次真实活动复现） |
| 非普通新聊天拒绝 | PASS | `?temporary-chat=true` 触发「当前不是全新的普通 ChatGPT 对话，已停止预填」；零插入 |

行为观察：内容脚本在不合格页面自检后即显示拒绝横幅（含未播种意图的页面）；该行为偏保守方向，仅记录不改判。

## 委托发送验证（3 次，全部命中外部阻塞，按 unknown/failed 记录，不重试）

| 次序 | 通道 | 结果 |
| --- | --- | --- |
| S2 | Tabbit | 单击发送一次；URL 创建 `/c/<id>`；`POST /backend-api/f/conversation` `ERR_ABORTED`；用户消息持久化（刷新后仍在）；40 分钟后复检仍无助手回合 |
| S3 | Tabbit | 新 attempt 同模式；中止前安全检查曾正确拦截一次不精确草稿 |
| S4 | Edge | 生产预填 exact（56 字节）→ 单击发送 → URL `/c/<id>`、用户消息 prewrap-exact（exact 与 canonical-v1 均一致）→ 90 秒采样无停止按钮、无生成；15 分钟后复检无助手回合 |

判定：**生成循环的缺失是账号侧条件**（跨两个独立浏览器、跨约 40 分钟、伴随全会话持续 429 限流；扩展 fetch 包装为透明透传已排除扩展干扰嫌疑；页面无错误对话框）。三次尝试均按计划契约记为 unknown/failed，新尝试须另行授权。

其他事实：当前站点构建在新增聊天与会话页均未渲染 `data-message-author-role` 属性（历史发现复现）；用户消息可信回读经 `whitespace-pre-wrap` 精确匹配达成（exact + canonical 双通过）。

## Z0-LIVE 剩余门禁

生成结束双信号观察、可信最终回复完整性、双标签生成重叠、以及所有者对完整闭环的最终签署——全部依赖账号恢复可生成状态后重测。本文件不签署 Z0-LIVE；计划表保持 `blocked`。

## 末章（同日补记）：隔离实验定位外部限制；人工清单完成，Z0-LIVE 关闭

1. **S6（所有者真实点击，CDP 附加窗口）**：生产预填 exact、横幅确认后由所有者本人单击发送——URL 创建 `/c/<id>`、消息持久化（prewrap-exact），但生成循环依旧中止。排除"合成点击"假设。
2. **隔离实验（决定性）**：以无 `--remote-debugging-port` 的窗口（同一临时 profile、扩展已加载、cookie 已持久化）由所有者手发短消息——**回复正常生成**。结论：生成中止由调试器附加触发；扩展 fetch 包装为透明透传（代码审查佐证），**扩展与生成中止无关**。机器观测生成循环在本站点技术上不可行。
3. **人工清单（所有者本人在无调试器窗口执行）**：双标签 A/B 同文本发送对照（两会话独立生成、无串线）；研线面板对已完成会话完整采集成功；刷新后无重复发送。
4. **关闭**：`MANUAL_ACCEPT Z0-LIVE` 于 PR #10（comment 6381193169，head `3598442…`，所有者委托代留）；`Z0-LIVE.json` 登记；计划表 Z0-LIVE → `done`。双标签生成重叠窗口为机器不可观测项，以所有者人工确认记录——2026-10-22 以来缺失的最后一项就此补齐。
