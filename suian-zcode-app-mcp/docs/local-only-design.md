# ZCode 3.16 local-only 设计澄清

**状态**：2026-10-21 用户已确认全部范围、退出安排和开票粒度，7 张 Issues 已发布；文档已获推送及通过 PR 合入 dev 的授权。本文不是兼容性通过记录，尚未实施补丁。

## 本轮任务

- 用户要求开票，并明确覆盖 local-only 测试环境的搭建与指导。
- 讨论方向是 patch Desktop，优先直接复用现有网关与业务插件；尚未通过运行验证，不预设网关必须修改。
- 本轮完成设计、文档和开票，并按授权推送文档、通过 PR 合入 dev；不执行 Desktop patch，不修改已安装插件、用户环境或会话数据。

术语沿用根 [CONTEXT.md](../../CONTEXT.md)。原始实验边界见 [3.16 网关验证](zcode-3.16-gateway-validation.md)；旧版 local-only 的隔离传输类验证不构成 3.16 证明。

## 已核实的接入条件

| 条件 | 已核实事实 | 对任务票的约束 |
| --- | --- | --- |
| Desktop 启动 | 主进程检查账号登录态；按需注册设备，每次连接申请令牌后再建立 WebSocket | 本地模式须覆盖启动、重连中的授权依赖，不能只改 WebSocket 地址 |
| 账号生命周期 | 主进程收到退出账号通知时撤销远控连接；登录通知也重新读取账号状态 | 本地模式与账号事件的关系需要明确并验证 |
| 网关运行入口 | startGateway 接受 local-only，未禁止与 V2 组合；CLI 支持 --config | 实验可直接使用隔离配置启动既有网关，不必先修改安装器 |
| 本地协议 | 现有分支接受不含 role 的 auth_init，回复带 device_sid 的 matched ACK，回应心跳并转发 Host RPC | 优先用原网关字节验证；源码静态可接入不等于真机已通过 |
| 插件客户端 | local-only 按 desktop_ready 判断就绪，不要求 upstream_connected | 业务插件保持原 connectHost 接口作为初始验证目标 |
| 安装入口 | setup.ps1 拒绝 V2 + local-only | 区分实验启动与正式安装支持；不以删除限制代替兼容验证 |
| 原 Host | 已有附着通过 Electron 内部 MessagePort 实现 | 验证目标是已有 Desktop Host，不另起 CLI app-server 冒充复用 |

固定源码依据：

- Desktop 公开快照 [`3c5b2276`](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)，package.json 自报 3.16.2；公开快照不等于发行包字节一致。
- [启动授权流程](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/webRemoteControlManager.ts#L1511-L1640)与[账号生命周期](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/webRemoteControlManager.ts#L1762-L1814)。
- [取令牌与 WebSocket 建连顺序](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/web-remote-relay/webRemoteControlTransport.ts#L98-L129)。
- [原 Host 附着](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts#L76-L105)。
- 我方源码以本次 dev 基线 `747adcb3c2eee894f5c85663859be17313f65cf5` 为准备基准：[网关](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway.mjs)、[客户端](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/gateway-client.mjs)、[安装限制](https://github.com/ONEGAYI/ZCode-Plugins/blob/747adcb3c2eee894f5c85663859be17313f65cf5/suian-zcode-common/setup.ps1#L65)。

## 环境搭建票必须解决的问题

此前 3.16 实验只隔离 Desktop 数据目录时，内嵌 CLI 仍写入默认会话库并执行迁移。新环境不能复制这条启动路径；具体设置必须按目标发行包重新核对。

| 层 | 已知隔离入口或核对项 | 需要留下的证据 |
| --- | --- | --- |
| 运行包 | 实际 Desktop exe、resources/app.asar、实际加载的 main/host 与内嵌 CLI 路径 | 应用版本、包摘要、原包与补丁包归属 |
| Desktop | ZCODE_DATA_BASE_DIR、ZCODE_DESKTOP_HOME_DIR、ZCODE_DESKTOP_USER_DATA_DIR；应用名和 sessionData 的独立性 | 实际解析路径、独立实例身份、未接管日常窗口 |
| CLI | HOME、USERPROFILE、APPDATA、LOCALAPPDATA，以及 ZCODE_STORAGE_DIR、ZCODE_SESSION_DB_PATH | 任务索引和 CLI 库均在实验根内；受控测试会话不在日常库 |
| 网关 | 独立 config.json、回环端口、control_token 和进程 | mode=local-only，Desktop 就绪；没有官方上游连接 |
| 插件 | 独立安装记录、外置配置、数据目录及 Hook/MCP 加载路径 | 使用的发布包/源码与摘要，未加载用户真实运行配置 |
| 网络与模型 | 官方远控可达性、ZCode 登录态与模型服务分别记录 | 远控离线证据不以模型失败替代，也不以模型服务在线推断远控在线 |

环境变量仅传给实验启动进程。探针、运行包副本、配置和原始日志放在忽略的实验目录；入库仅保留脱敏文档与必要最终证据。不得记录 control_token 或复制个人登录凭据作为默认步骤。

长耗时检查首次执行即保存日志和退出码；有效记录绑定代码/包摘要、配置、环境与测试范围，不因开票、提交或收尾阶段切换重复全量。

## 用户已裁决的范围

1. **版本范围**：首轮限定 Windows 3.16.2 的一个明确运行包，按包摘要匹配；其它版本另行核对。
2. **离线标准**：无 ZCode 登录态且官方远控不可达时可冷启动，网关重启后可恢复；模型服务可达性独立。
3. **产品入口**：融入现有 setup，用户选择 local-only 后，Agent 调用脚本准备补丁。安装技能与脚本属于实现范围，网关及业务运行代码优先复用。
4. **应用目标**：对用户明确指定的原安装目录备份后 patch，继续使用原快捷方式；隔离副本用于测试。
5. **模式切换**：保留补丁，通过显式开关启用本地模式；relay 继续走原账号和官方远控流程，另提供完整还原命令。
6. **退出安排**：Agent 完成预检与补丁准备，交付外部命令；用户关闭 ZCode 后执行，再自行重开。不由 Agent 强退宿主，不增加后台等待助手。
7. **业务范围**：首轮完成 MCP 创建、提交消息、改名、历史读取与重连；真实 Stop 自动命名与侧栏评论单独后续开票，不阻塞首轮交付。

产品取舍与维护责任见 [ADR 0003](adr/0003-local-only-desktop-patch.md)。不支持的运行包拒绝应用；测试证明需要改网关或业务运行代码时，先列明具体失败与新增范围，不把“零改动”目标写成已实现事实。

## 已确认的开票顺序

以下粒度与依赖已由用户确认；GitHub 实际编号和逐票验收见 [开票索引](local-only-tickets.md)，完整行为契约见 [产品规格](local-only-spec.md)。

| 本地票 | 交付行为 | Blocked by | 范围 |
| --- | --- | --- | --- |
| LO-01 | 搭建隔离环境、证明两套会话库及运行配置隔离，并复现原版离线阻断 | 无 | 首轮 |
| LO-02 | 固定运行包的补丁预检、准备、应用和还原，使用原网关建立最小本地连接 | LO-01，目标运行包实物与摘要 | 首轮 |
| LO-03 | 完成本地冷启动、网关重启恢复和账号事件隔离，核对 relay 原流程 | LO-02，本地最小连接能力真实就绪 | 首轮 |
| LO-04 | setup 模式选择、Agent 准备、用户退出后外部应用，以及切回 relay/完整还原 | LO-03 | 首轮 |
| LO-05 | 原生 MCP 首轮闭环与可复现指南，形成脱敏验收包 | LO-04，实际原 Host 和隔离插件可用 | 首轮 |
| LO-06 | 真实 Stop 自动命名在本地模式下的验收与最小必要修正 | LO-05 | 后续，不阻塞首轮 |
| LO-07 | 侧栏评论在本地模式下的验收与最小必要修正 | LO-05，现有评论能力及其独立已知限制 | 后续，不阻塞首轮 |

原版与补丁包、未启用补丁开关与 local-only、合成模型与真实模型、协议夹具与原生 Desktop 分别记录。Host 提交回执只证明输入受理，不宣称已取得模型最终回复。

用户已完成最终共识复核，并另行授权文档推送和通过 PR 合入 dev。已按上述范围生成规格和票正文，按依赖顺序创建 GitHub Issues；本轮未授权执行补丁、功能开发或正式分支合并。
