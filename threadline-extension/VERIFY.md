# v0.6.0 验收范围及限制

## 已有离线检查

- `npm run verify` 执行全部 Node 单元/回归测试、静态语法和版本一致性检查。
- `test/send-matrix-smoke.py`：Enter/Ctrl+Enter/主发送按钮/表单提交拦截矩阵；Shift+Enter、输入法组合输入、重新生成操作不作为新发送阻止。
- `test/extension-e2e.py`：真实 MV3 扩展使用 Playwright persistent Chromium profile、在合成 ChatGPT 页面中检查持久存储、页面监听、只读健康探测、备份和后台重启。该项必须在允许加载扩展的环境运行。

## 当前执行环境限制

当前容器的 `/etc/chromium/policies/managed/` 配置包含 `ExtensionInstallBlocklist:["*"]` 及 `URLBlocklist:["*"]`。Chromium 因系统策略不能加载扩展，因此**这里不能把 persistent E2E 算作成功**。GitHub Actions 工作流提供没有这项管理策略的独立测试环境；须检查实际 CI 结果才能写已通过。

## 尚未执行的真实 ChatGPT 账号测试

1. 登录 Windows Edge/Chrome，在真实 `/c/<UUID>` 对话建立两个分支并核对迁移后的同一个 UUID。
2. 在 A 更新结论，B 切回看到字段具体差异，按已核对后提醒消失。
3. 对无敏感数据的长对话采集，核对是否完整覆盖历史，失败时显示不完整。
4. 分别尝试新建 ChatGPT 项目并移入、归档，检查其真实完成状态并演练无法核实时不重试。
5. 可选实验性网页 AI 分析，检查真实页面的输入、长时间等待和 JSON 返回稳定性。
6. 用真实扩展目录导出备份、覆盖升级、重新导入、回滚，确认原有数据仍在；避免先卸载旧版。

真实网页操作需要用户授权且可能受使用条款或网站变化限制。真实历史数据脱敏后才可作为 DOM fixture，不应将登录凭据、Token、原始内部研究文字上传 GitHub。

## 仍待开发的项目

- 固定签名扩展 ID/商店发布和自动更新；避免在当前仍有旧数据时直接改 manifest key。
- 精确消息级未读、跨分支语义依赖和冲突检测。
- 把 Labs 进一步拆到可选权限/单独发布的扩展包。
- 大型采集记录使用 IndexedDB cursor 增量遍历及后台事件驱动进度。
- 真人使用度量（切换完成时间和误警比）与真实已登录网页回归自动化。
