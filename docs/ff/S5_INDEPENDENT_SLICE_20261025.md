# S5 可选 Argdown 互通切片（2026-10-25）

层叠在 [S4 PR #43](https://github.com/siskosun/ThreadLine/pull/43)；对应 `S5-INTEROP`。不改正式任务状态，不合并或发布。

直接复用原 [PR #37](https://github.com/siskosun/ThreadLine/pull/37) 中已固定的官方 `@argdown/core@2.0.1`、MIT 许可与可复现静态 MV3 解析器，保留 Node 构建/重现测试。生产运行只使用离线 `vendor/argdown-adapter.js`，不装载 Node、外部脚本或使用 eval。

S5 定位为按需二级工具，不重建依赖工作台。新增 `argdown-loader.js`，只有用户主动点击才载入大体积解析器。导入关系只预览，支持关系不自动等同必要前提，反对关系只供人工参考。登记必须逐条映射现有两条结论、勾选人工核查并填写理由，受 S2 CAS 和当前版本身份控制。

测试：官方 Argdown 解析器原有 Node 测试；新增合成 `s5-interop-e2e.py` 验证懒加载、预览零写入、明确用户确认、导出再解析。CI 需安装锁定依赖并重新生成/核对打包结果。真人工效、真实登录、三臂 pilot/2 仍未执行。
