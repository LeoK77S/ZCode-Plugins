# [local-only][LO-05] 验收原生 MCP 闭环并交付环境搭建与操作指南

**范围**：首轮。**状态**：规格及粒度已确认，尚未实施。

## 问题

回环协议或直接控制器测试不能证明产品 setup、原生 stdio MCP 与用户可复现步骤全部成立，需要首轮端到端证据和完整指导。

## 交付行为

以无 ZCode 登录态/官方远控不可达的隔离 Desktop 完成 MCP 创建、输入提交、改名、读取和重连，并交付可复现指南与脱敏验收包。

## 负责模块

app-mcp 原生 MCP/stdio 验证、公共 setup/补丁的产品联调、docs 指南和最终证据；网关及业务运行代码优先复用。

## Blocked by

LO-04（[#147](https://github.com/ONEGAYI/ZCode-Plugins/issues/147)）。

**运行条件**：固定包、补丁工具、setup 流程与隔离插件安装可用，实际 Desktop 原 Host 已就绪；不得用关闭环境调查票代替这些运行条件。

## 验收条件

- [ ] 固定实际加载的插件发布包、common、网关、Desktop/CLI 入口和摘要；从产品 setup 选 local-only 开始，按外部命令应用、普通快捷方式重开完成检查。
- [ ] 通过实际 stdio MCP 执行 start_session（含首次受控输入）、send_message、rename_session、list_sessions/read_session，核对来源、目标原 Host、标题读回与内容；不只直接调用控制器。
- [ ] 无 ZCode 登录态且官方远控不可达；保留请求/连接证据，不能仅凭 health.upstream_connected=false 判断未联网。网关重启后再次读取与提交成功。
- [ ] 测试会话只存在于隔离索引和 CLI 库，未进入日常库；插件配置、令牌、工作区和网关进程归属清晰。
- [ ] Host 受理 ACK、合成模型回复、真实模型最终回复分别记录。首轮不要求真实 Stop 命名或评论，不调用额度重置，不以受理回执宣称模型完成。
- [ ] 指南覆盖支持包/依赖、目录与数据隔离、原版失败基线、模式选择、准备/应用/重开、MCP 检查、故障分层、切回 relay、完整还原和清理；提供参数模板和预期回执。
- [ ] 针对指南可复现性执行一次新的干净隔离环境定向演练，复用有效底层测试日志，不因收尾重复全量。支持包、未验条件与故障定位有明确说明。
- [ ] 首轮结果明确区分代理验证和用户验收。LO-01 至 LO-05 全部满足后才记首轮通过，原始敏感物料不入库；后续命名/评论票保持独立。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#148](https://github.com/ONEGAYI/ZCode-Plugins/issues/148)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
