# [local-only][LO-06][后续] 验收真实 Stop 自动命名与标题保护

**范围**：后续，不计入首轮完成条件。**状态**：规格及粒度已确认，尚未实施。

## 问题

MCP 改名或手动执行 Hook 不能证明真实 Stop 自动触发的历史读取、辅助生成和标题保护在 local-only 下正常。

## 交付行为

在专用隔离会话中完成真实 Stop 自动命名、固定/解除固定与必要失败反馈的端到端验收。

## 负责模块

suian-zcode-title 的隔离安装/真实 Hook 验证与脱敏证据；仅在证实需要时最小修正业务适配，公共实现仍归 common。

## Blocked by

LO-05（[#148](https://github.com/ONEGAYI/ZCode-Plugins/issues/148)）。

**运行条件**：首轮 local-only/MCP 基础交付通过，隔离命名插件与可达模型服务可用；不阻塞 LO-01 至 LO-05。

## 验收条件

- [ ] 通过受控会话真实生成轮触发已安装 Stop Hook，验证历史读取、辅助生成、改名与读回；手动调用入口或 MCP 改名不得代替触发链。
- [ ] 验证受测会话 ID、标题规则、公共 lock/unlock 和当前已交付手动保护行为，防止跨会话或覆盖用户已固定标题。
- [ ] 网关暂不可用或模型服务不可达时保留正确失败反馈与恢复边界，不吞错、不把官方远控离线和模型离线混为一谈。
- [ ] 记录 local-only 无官方上游连接，模型请求来源及真实/合成模型边界明确；不消耗重置卡或操作日常会话。
- [ ] 新增行为或修复先红后绿，复用首轮有效基础记录；独立报告真实 Hook 与模型证据，不自动关闭其他业务或完整首版议题。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#149](https://github.com/ONEGAYI/ZCode-Plugins/issues/149)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
