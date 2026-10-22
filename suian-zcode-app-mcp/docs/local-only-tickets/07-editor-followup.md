# [local-only][LO-07][后续] 验收侧栏评论与连接恢复

**范围**：后续，不计入首轮完成条件。**状态**：规格及粒度已确认，尚未实施。

## 问题

MCP 基础链路通过不代表真实侧栏评论的归属、入主对话、受理反馈和重连状态正确，需要以当前已交付评论契约单独验收。

## 交付行为

在真实隔离 Desktop 与实际构建侧栏中检验 local-only 评论链路及恢复，明确既有评论限制。

## 负责模块

suian-side-editor 的原生页面/评论集成与证据；公共连接能力归 common，文件保存和恢复副本契约保持。

## Blocked by

LO-05（[#148](https://github.com/ONEGAYI/ZCode-Plugins/issues/148)）。

**运行条件**：首轮 local-only 基础通过；当前版本侧栏与已交付评论能力可用。完整并发评论 #57 继续独立，不因本票关闭而视为满足。

## 验收条件

- [ ] 使用真实 CodeMirror 选区和已构建页面，核对可信工作区/会话、文件路径、行号、选中文本、评论与未保存标记进入当前主对话。
- [ ] 验证正常受理、失败/阻止时的内容保留、已受理缓存处理和断连/重连后的实际状态，按当前已交付契约解释限制。
- [ ] 不以模型 running 冒充发送 admission pending，不把 local-only 适配当作完整原生并发评论的重做；#57 的独立需求和阻塞仍保留，历史 #47 结论不改写。
- [ ] 评论不得跨会话/工作区污染；原文件保存和恢复副本的独立回执保持，不因评论验证隐式写用户文件。
- [ ] 仅在证据表明需要时最小修正适配并先红后绿；不改只读 sources、不用合成 DOM 生命周期代替真实宿主验收。
- [ ] 独立提交所测包/插件/网关摘要、日志退出码及已验/失败/未验清单；本票不阻塞或反向改写首轮 MCP 完成条件。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#150](https://github.com/ONEGAYI/ZCode-Plugins/issues/150)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
