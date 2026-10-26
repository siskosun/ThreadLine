# F3 主页面采集桥握手补丁（2026-10-25）

- 这是 #40 的下一次准确 HEAD 复验，不是新的真人 F3 PASS。用户点击“采集回复”后，`TL_CAPTURE_START` 过去在 isolated 脚本完成 `window.postMessage` 的那一刻就回复 `ok:true`；即使 MAIN 世界的采集脚本缺失、被旧版本单例挡住或未收到消息，后台仍然认为采集已启动。
- 现在 MAIN 先对同一 `requestId` 发送 `accepted/bridgeProtocol=3`，isolated 在明确收到之前**不回复成功、不接收来源页或结束信号**；五秒没有确认明确拒绝启动并提示人工刷新源标签页。失败时不自动重发或发送任何 ChatGPT 消息，`beginCapture` 将原始错误落到 run 且 `started:false`。
- 这只是桥接**活性检查**，不是对不可信页面脚本的身份或内容真实性证明。旧版 MAIN bridge 没有握手会被拒绝，须由用户主动刷新源会话标签页后再次操作。
- `test/f3-bridge-e2e.py` 在无账户合成 Chromium 中通过 MAIN-world 故障注入屏蔽主桥发出的确认（扩展 Manifest 本来会自动装载两端脚本，因此不能假设 MAIN 未注入），先复现旧版会误报已启动的场景，验证新版本五秒后明确失败，再安装 MAIN 并由测试者手动第二次触发，检查成功回包且页面 `submitCount=0`。
- 缺口不变：真实已登录 ChatGPT K=4 采集链路、三自然日十二次、selector 失效与 MV3 中断恢复、真实来源一致性以及用户人工签署。不要将该合成试验称为已修复线上根因。
## 2026-10-25 合成选择器失效与原始运行归属（续审）

- 运行 ID / 同标签页归属：完成时仅允许与当前 Fork attempt 的 `captureRunId`、tabId、会话 ID 全部一致的源记录推进分支。独立侧栏采集或旧运行不能替代该结果；同分支尚在 `capturing` 时重复请求明确拒绝，不覆盖原运行 ID。新增 Node 负向回归。
- 新增 `test/f3-selector-fallback-e2e.py` 并纳入 `npm run test:e2e`：在一次性 Chromium 扩展与 IndexedDB 中模拟历史 API 全部 404，先仅保存两条角色明确的 DOM 文字并标记 `complete:false`，再移除角色选择器并验证零消息仍 `complete:false`；欢迎语不被归为助手回复，页面表单发送 0 次。
- 本项为**合成故障注入**，不等于真实已登录 ChatGPT 选择器已经匹配，也不等于三自然日 12 次或 MV3 崩溃恢复人工验收。准确 HEAD 的 Linux/Windows CI 待核对，不得提前标通过。

## 2026-10-25 终态采集的人工恢复入口

- Fork 分支此前可能停留在 `phase=capturing`，尽管底层来源已经 `error` 或 `done` 但不满足完成条件；旧 UI 只显示「查看采集状态」，无法手动发起新的来源采集。
- 现在在有既有运行 ID 的待完成分支显示「核对后手动重新采集」；点击先读取绑定该分支与运行 ID 的 `FF_CAPTURE_STATUS`，只有 `error` 或 `needs_review` 才显示用户确认框，再**显式**调用 `FF_CAPTURE`。仍在运行、`stalled`、身份未知或 `integration_error` 一律拒绝重复启动。
- 后台单分支运行 ID 防覆盖与无自动重放规则继续生效。Node UI 测试覆盖仍在运行、来源关联错误、用户取消和用户同意四种情况。**本补丁未提供浏览器重启后失去 session marker 的自动恢复；此类来源仍需人工诊断，不得误记已修复。**

## 2026-10-26 浏览器重启后失联采集的人工恢复（PR #40）

- 新工程提交 `12d11a55221bfd24f17bcceaf14aeaaf32b44ea2`：[Linux verify](https://github.com/siskosun/ThreadLine/actions/runs/40252510913) 与 [Windows baseline](https://github.com/siskosun/ThreadLine/actions/runs/40252510938) 均 **success**；Linux 为 **241/241 Node** 与完整合成 Chromium/MV3 E2E 通过。
- 原问题：`IndexedDB` 会保留 `capturing` 运行，但完整浏览器重启可能清除 `chrome.storage.session` 的 `tl_capture_owner_<runId>` 临时标记。此前只禁止覆盖运行中采集，失联运行无法退出。
- 现在 `FF_CAPTURE_STATUS` 同时核对当前分支绑定的运行 ID/标签/会话与临时标记：仅当采集仍标记 `capturing`、标记缺失且至少 **30 秒无进度**，返回 `untracked` / `manualRecoveryAvailable:true`。该状态只表示无法确认运行活性，**不表示采集已失败、已成功或完整**。
- 用户先核对源标签页不再执行采集，再点击「核对后手动重新采集」，第一次确认只发送 `FF_CAPTURE_ABANDON` 并将旧运行标记 `error/manual-untracked`，保留已采页面与分支运行 ID，不推进实验完成态；不会打开、发送或重新抓取。之后需再次点击并单独确认，才调用 `FF_CAPTURE`。若源标签页在重启后丢失或 tabId 改变，新请求仍可能被拒绝，**不自动重绑其他标签**。
- 后台将 `CAPTURE_RESET/PROGRESS/END/FAIL` 的终态检查与人工解除放入同一串行区，禁止迟到的完成消息覆盖已解除状态；活动标记存在、30 秒内仍有活动、不同实验/分支/运行 ID、来源身份不符、已终结运行均不能被新命令误解除。重发同一已确认的解除请求仅返回此前状态。
- 合成测试覆盖无标记/有标记、30 秒门槛、错误分支、幂等重放、旧片段保留、迟到完成拒绝、第一次不自动发起第二次采集。新增 `test/f3-orphan-recovery-e2e.py` 在一次性真实 Chromium/MV3 环境执行**完整浏览器重启**，验证存储生命周期与两步人工确认；0 自动发送。
- 仍然 **NOT_EXECUTED**：登录真实 ChatGPT 的 3 自然日/≥12 次 K4 真实采集→对照→裁决→导出→导入，真实站点选择器退化、真实账户状态下的 worker 中断与 tabId 恢复、脱敏验收和真人签署。测试与代码修复不等于当时 F3 根因已确证或真实线上故障已经解除。保持 Draft，不合并/发布、不修改用户数据或唯一 PLAN 状态表。
