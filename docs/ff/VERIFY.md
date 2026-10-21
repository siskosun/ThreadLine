# Fork 双分支 - 第零步验收（未通过）
基线：main d40d13f2918c33961ced333a9884af9c853157ad，v0.6.1。
本分支仅修复 Windows 上 check-syntax.mjs 对 file: URL 路径的错误处理，并补充异目录运行回归。
CI 是合成 ChatGPT 页面，不是已登录网页。

## 真实网页门禁
状态：BLOCKED / NOT RUN。远程设备 sunzc 离线；当前容器无法直接访问 GitHub，无法替用户在真实登录网页操作。**严禁把本项标记为通过。**
待用户参与的检查：新建普通会话；短文本及近 24 KB 的 Unicode/Markdown 草稿回读；人工发送后实际用户消息准确性（exact、canonical_equivalent、unverified、differs）；生成结束双信号；结果身份绑定；双标签交错完成；Project/Temporary 拒绝；限流/断网/重启；非文本回复保守 unknown。
完整输入比对仅在可信非有损文本源可用时可认定 exact；采集本身的 trim/规范化不得用于声称字节一致。
观察到停止生成控件消失 + 文本稳定 5s 仍不能单独证明完成，需结合可验证的会话数据和完整性。
采集 legacy 和 DOM 回退必须保留来源和 incomplete 风险。
PR-2/3 在用户签署此门禁通过前不得开展真实网页自动化集成。
