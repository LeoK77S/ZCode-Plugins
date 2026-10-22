# [local-only][LO-04] 将补丁准备与外部应用流程集成到产品 setup

**范围**：首轮。**状态**：规格及粒度已确认，尚未实施。

## 问题

用户希望在产品 setup 选择 local-only 后由 Agent 调用脚本。当前安装器拒绝该组合，且 Agent 不能强退承载当前会话的 ZCode 来原位修改。

## 交付行为

完成模式选择、预检准备、外部应用命令、普通快捷方式重开，以及切回 relay/完整还原的产品流程。

## 负责模块

suian-zcode-common 的 setup.ps1、必要安装期工具/构建、setup/configuration/debug 技能；业务 setup 仅作必要路由和说明。

## Blocked by

LO-03（[#146](https://github.com/ONEGAYI/ZCode-Plugins/issues/146)）。

**运行条件**：支持包清单、补丁工具及离线生命周期已通过各自验收；不能仅删除 setup 中 V2 + local-only 的拒绝条件。

## 验收条件

- [ ] setup 明确区分原版/已 patch、受支持/未知运行包和 relay/local-only；仅对匹配支持包放行，版本未知或需要适配时明确报错，不泛化支持所有 3.16。
- [ ] Agent 定位用户指定的原安装目录，调用工具预检和准备后给出精确外部命令及预期结果；不关闭或重启当前 Desktop，不启动后台等待助手。
- [ ] 外部命令在用户关闭目标实例后应用并激活所需配置；用户通过原快捷方式重开后检查实际模式/端点、desktop_ready 和原 Host。准备成功不宣称已应用或已生效。
- [ ] 模式开关和网关配置保持一致；保留既有端口、control_token、原环境备份和暂停远控/重载纪律。失败不得把配置写成已就绪，回退失败如实报告。
- [ ] 切回 relay 保留补丁并关闭本地分支；完整还原通过独立外部命令执行。升级改变包摘要后旧补丁停止套用，并给出可执行诊断。
- [ ] common 正式构建含补丁入口与资源，业务独立缓存可按现有安装记录定位；发布缓存不执行 npm ci/link.mjs，不把研究源或 Desktop 完整包塞入发布物。
- [ ] 使用隔离文件、系统调用桩和实际构建包验证首次/重复准备、未退出拒绝、应用成功/失败、切换和还原；系统桩不得修改真实用户环境、任务或通知。
- [ ] 技能解释用户需择时退出和重开，区分预检、准备、待应用、已应用未生效与验证就绪等实际回执，不暴露个人路径、令牌或内部实现细节。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#147](https://github.com/ONEGAYI/ZCode-Plugins/issues/147)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
