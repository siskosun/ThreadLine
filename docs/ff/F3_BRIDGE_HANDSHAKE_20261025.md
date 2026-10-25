# F3 主页面采集桥握手补丁（2026-10-25）

- 这是 #40 的下一次准确 HEAD 复验，不是新的真人 F3 PASS。用户点击“采集回复”后，`TL_CAPTURE_START` 过去在 isolated 脚本完成 `window.postMessage` 的那一刻就回复 `ok:true`；即使 MAIN 世界的采集脚本缺失、被旧版本单例挡住或未收到消息，后台仍然认为采集已启动。
- 现在 MAIN 先对同一 `requestId` 发送 `accepted/bridgeProtocol=3`，isolated 在明确收到之前**不回复成功、不接收来源页或结束信号**；五秒没有确认明确拒绝启动并提示人工刷新源标签页。失败时不自动重发或发送任何 ChatGPT 消息，`beginCapture` 将原始错误落到 run 且 `started:false`。
- 这只是桥接**活性检查**，不是对不可信页面脚本的身份或内容真实性证明。旧版 MAIN bridge 没有握手会被拒绝，须由用户主动刷新源会话标签页后再次操作。
- `test/f3-bridge-e2e.py` 在无账户合成 Chromium 中故意只注入 isolated 脚本，先复现旧版会误报已启动的场景，验证新版本五秒后明确失败，再安装 MAIN 并由测试者手动第二次触发，检查成功回包且页面 `submitCount=0`。
- 缺口不变：真实已登录 ChatGPT K=4 采集链路、三自然日十二次、selector 失效与 MV3 中断恢复、真实来源一致性以及用户人工签署。不要将该合成试验称为已修复线上根因。