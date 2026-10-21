# [local-only][LO-03] 完成离线冷启动、重连和账号事件隔离

**范围**：首轮。**状态**：规格及粒度已确认，尚未实施。

## 问题

只解除首次启动检查不足以支持 local-only：每次重连会重新取令牌，账号通知也可能撤销连接。需要明确本地分支与原 relay 生命周期的边界。

## 交付行为

无 ZCode 登录态且官方远控不可达时可冷启动，网关重启后恢复；显式关闭本地开关时保留官方鉴权链。

## 负责模块

公共补丁工具维护的 Desktop 远控生命周期补丁及其契约/原生证据；保留原 Host、会话和消息协议。

## Blocked by

LO-02（[#145](https://github.com/ONEGAYI/ZCode-Plugins/issues/145)）。

**运行条件**：固定补丁包与原网关的最小 Host 接入真实就绪；LO-02 失败或仅有夹具结果时，原生生命周期验收保持阻塞。

## 验收条件

- [ ] 先建立原版失败契约，覆盖远控启动前无登录态、HTTP 注册/取令牌不得被调用；补丁后本地分支通过，非本地分支仍执行原授权流程。
- [ ] 在真实隔离 Desktop 上从完全停止状态冷启动，证明没有 ZCode 登录态也能完成本地握手及原 Host 调用，不用联网后存续代替。
- [ ] 重启本次网关、主动断开本次链路和重开本次 Desktop 后恢复连接；重连不得重新请求官方 token、创建官方上游或静默切为 relay。
- [ ] 验证登录态同步、退出账号/账号变化不会误撤销本地链路；这些分支不改变 relay 模式的原撤销、授权和恢复语义。
- [ ] 本地开关只允许匹配回环目标，不把 loopback URL 本身当模式标识；网关 RPC 继续要求 control_token 并拒绝浏览器 Origin。
- [ ] 测试 local-only → relay → local-only，记录补丁存在与模式启用的不同状态；保留原账号/官方连接所需检查。实际在线 relay 验收缺少账号/网络时标未验，不以夹具冒充。
- [ ] 确认已有会话仍归属原 Host，未另起 app-server 或复制会话状态；提交有效补丁版本、受测包/网关摘要与失败/通过/未验记录。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#146](https://github.com/ONEGAYI/ZCode-Plugins/issues/146)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
