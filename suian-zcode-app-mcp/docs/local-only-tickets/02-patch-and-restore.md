# [local-only][LO-02] 交付固定运行包的可还原补丁并接入现有网关

**范围**：首轮。**状态**：规格及粒度已确认，尚未实施。

## 问题

只改 relay WebSocket 地址仍会被 Desktop 的账号/HTTP 注册与取令牌阻断，需要固定运行包上的显式本地分支和可安全撤销的工具。

## 交付行为

通过公开脚本完成状态/预检、准备、备份、应用、还原，并在隔离包中用原网关建立最小原 Host 连接。

## 负责模块

suian-zcode-common 的新安装期补丁工具、必要构建资源与公开入口契约；隔离 Desktop 运行包副本。业务插件不复制实现，不修改 sources。

## Blocked by

LO-01（[#144](https://github.com/ONEGAYI/ZCode-Plugins/issues/144)）。

**运行条件**：LO-01 的隔离检查通过；目标发行包、原始摘要和实际加载产物可用。最小接入失败时，下游继续受阻，不能仅以完成调查解除依赖。

## 验收条件

- [ ] 先用公开工具入口写行为契约并观察红灯；核对发行包实际编译产物，记录原包/补丁包/补丁版本摘要，不猜压缩变量或仅靠模糊替换。
- [ ] 原包匹配后才生成候选；准备阶段不改运行中的应用。未知版本、摘要不符、运行包准备后变化以及权限/写入失败明确失败，不吞错、不默默降级。
- [ ] 外部应用前重新确认指定安装目录的相关运行实例已退出；不强退进程。备份完成且验证可还原后才应用；重复应用识别同补丁，不覆盖原备份。
- [ ] 显式本地分支跳过远控账号/官方设备注册和取令牌依赖，采用本地设备身份连接匹配的回环网关；未启用开关时保留原 relay 行为，不改模型或套餐授权。
- [ ] 不修改网关运行代码和 connectHost 契约，使用现有 local-only 握手/心跳取得 desktop_ready 并成功调用原 Host 探针；提供网关字节未变及无官方远控连接证据。
- [ ] 独立还原命令恢复匹配原包与本功能管理的配置；当前包已被其它工具或升级修改时拒绝覆盖。注入应用失败验证本次拥有状态的恢复，恢复失败如实报告。
- [ ] 工具和必要资源纳入 common 正式构建及安装期入口，发布包不携带 Desktop 完整包、备份或个人数据，不依赖发布缓存 npm ci/link.mjs。
- [ ] 若原网关无法复用，提交具名失败、受影响契约和最小调整建议；不得把静态接入判断或另起 CLI app-server 当作原 Host 验证。

## 公共约定

Windows 3.16.2 单个明确运行包；无 ZCode 登录态、官方远控不可达时冷启动及恢复；产品 setup 选 local-only，Agent 准备，用户退出后外部应用到指定原安装目录。显式开关控制本地分支，切回 relay 保留补丁，另提供完整还原。首轮复用原网关与业务运行代码作为验证目标；命名与评论为后续。

实施从 dev 的独立 worktree 进行。应用包副本、备份、控制令牌与原始日志不入库；长流程首次落盘日志与退出码，不重复流程性全量。当前只发布规划文档，不授权执行补丁或功能开发。

GitHub：[#145](https://github.com/ONEGAYI/ZCode-Plugins/issues/145)。本地规格见 [已确认规格](../local-only-spec.md)，票间顺序见 [开票索引](../local-only-tickets.md)。

## 固定源码依据

- [现有网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)
- [现有安装入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1)
- [Desktop 3.16.2 公开快照](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)；实际运行包仍须独立核对。
