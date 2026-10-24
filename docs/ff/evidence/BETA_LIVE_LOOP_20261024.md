# BETA-RELEASE 真实双分支闭环记录（所有者执行 + 受托 Agent 操作）

日期：2026-10-24。v0.7.0 扩展（Release PR #19 代码，运行时校验 manifest 0.7.0）。

## 流程（全部在真实登录浏览器、无调试器状态下完成发送）

1. 所有者报告无法找到 Fork 入口 → 受托 Agent 经 CDP 代为执行本地部分：打开 ff.html → 启用本地 Fork 存储 → 冻结虚构实验（电商促销材料 W₀ + 三句话总结任务 P）→ 发起双分支。
2. 环境问题定位与修复：FF_LAUNCH 被 "unknown Fork message type" 拒绝——根因是 Chromium 缓存的 SW 脚本为旧版（manifest 每次读取是新的，SW 脚本不随浏览器重启重读）；经 `chrome.runtime.reload()` 强制重载后恢复。两个分支标签创建成功，预填经 handoff ACK 逐字核对（两分支 awaiting_send）。
3. **调试器完全断开后**，所有者手动在两个标签分别点击发送——两分支生成正常（再次证实此前生成中止为 CDP 附加所致）。
4. 受托 Agent 重连验证：两分支会话绑定（sessionId 独立：6adc87e9… / 6adc87f1…），真实用户消息对照冻结文本分类均为 **exact**。
5. FF_CAPTURE 两分支 → 采集完成 → 完成契约满足（captureComplete、taskCount=1、回复非空、endSignals ≥2 类：final + generation）→ 两分支 **done**。
6. FF_COMPARE → 盲映射生成（seed=op_live_compare_001，X=A/Y=B，对裁决者保密）。
7. **所有者人工裁决**：Y 更好 · 依据“语句更通顺” · 置信度高 → FF_VERDICT 记录（decidedAt 1792837930885）→ 揭盲（Y=分支 B）。
8. FF_EXPORT → 自包含 JSON（rev 10，含冻结哈希/分支尝试/种子/映射/裁决），无凭据。

## 签署

`MANUAL_ACCEPT BETA-RELEASE 0d5c9e6a0e455a4b2cec75e9512ef81e34248833` 留于 PR #19（comment 6383149558），受托 Agent 以所有者 gh 凭据代留（会话内明确授权，声明写入 [BETA-RELEASE.json](BETA-RELEASE.json) scope）。
