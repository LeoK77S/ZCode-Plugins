# [local-only][LO-01] 搭建隔离测试环境并固定原版离线阻断基线

**范围**：首轮。**状态**：规格及粒度已确认，尚未实施。

## 问题

此前仅隔离 Desktop 的实验仍触及默认 CLI 会话库。后续补丁必须基于可证明隔离的环境，且需要相同条件下的原版失败基线。

## 交付行为

交付隔离启动/检查入口、搭建说明和原版离线阻断证据；不修改用户日常安装和运行配置。

## 负责模块

公共层实验环境与验证入口、app-mcp/docs 的搭建说明和脱敏证据；sources 保持只读。

## Blocked by

无 Issue 前置。

**运行条件**：无 Issue 前置；执行时必须先取得用户指定的 Windows 3.16.2 运行包。缺少运行包时只完成清单与搭建入口，原生能力仍未验。

## 验收条件

- [ ] 固定 Desktop exe、resources/app.asar、实际加载的 main/host 与内嵌 CLI 路径，记录应用/CLI/Node 版本及原包 SHA-256；只支持该单包，不以 3.16.2 字段代替字节身份。
- [ ] 同时隔离 Desktop 数据根、home、userData、sessionData/应用实例身份；核对 HOME/USERPROFILE/APPDATA/LOCALAPPDATA、ZCODE_STORAGE_DIR、ZCODE_SESSION_DB_PATH 等实际生效路径。不得被单实例锁转交到日常窗口。
- [ ] 任务索引与 CLI 会话库、插件安装记录/外置配置/数据、测试工作区、网关配置/端口/进程均在本次拥有的隔离范围；启动前后检查实际归属，不只断言环境变量已设置。
- [ ] 隔离环境不复制真实 ZCode 登录凭据、不加载日常 Hook/MCP 配置，不改用户环境变量、计划任务、默认应用或现有网关。
- [ ] 在无 ZCode 登录态且官方远控服务不可达条件下运行原版，保留准确阻断阶段、错误和网络/进程证据；已有失败是预期基线，不能伪报通过。
- [ ] 搭建指南包含路径参数模板、依赖、启动/检查/退出/清理步骤；证明本次测试标记未进入日常库，不因检查而写日常库。
- [ ] 原始包、副本、令牌与日志留在忽略的实验目录；长流程首次落盘日志与退出码，提交脱敏清单及未验项。调查关闭不等于补丁接入能力已具备。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#144](https://github.com/ONEGAYI/ZCode-Plugins/issues/144)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
