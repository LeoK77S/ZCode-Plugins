---
name: debug
description: 诊断 ZCode 公共网关、启动任务、Desktop、上游和手机共存故障，不改命名或 MCP 业务规则。
---

# 公共网关排障

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与数据](../paths.md)，固定启动目录、启动方式和实际公共根，确认 ZCode 应用版本后再执行 Status。CLI 版本不能代替应用版本。

**公共插件 0.3.0 起支持 ZCode 3.16 在线模式，local-only 暂不可用**。在线模式需要已登录账号、可达的官方远控服务和 V2 配置；现有 Windows 默认安装流程尚未接入 V2。先按[configuration](../configuration/SKILL.md)核对版本与配置，不能建议通过切换本地模式解决 3.16 连接失败。

| 层次 | 证据 |
| --- | --- |
| 配置与环境 | configured、user_env_matches；不回显完整 config |
| 网关 | gateway_running、health_status、mode、rpc_available |
| 启动任务 | task_running、vbs_launcher、launcher_update_required；Ready 不代表已停止 |
| Desktop | desktop_connected、desktop_ready；TCP 连入不等于原 Host 就绪 |
| 官方链路 | upstream_connected、upstream_paired；仅在已支持旧版的 local-only 模式中，上游 false 属正常 |
| 配对与调用 | paired、local_clients；paired 不能证明手机身份或手机仍在线 |

健康检查默认单次 5 秒，只对超时重试一次；连续超时报未知。必要时用 -HealthTimeoutSec {{seconds}}，不以历史 LastTaskResult 代替当前健康证据。

网关可达但任务未运行时修复启动链，不另开实例。任务运行而健康不可达时先读数据目录中的 gateway.error.log 等启动日志；Restart/Remove 会拒绝在未知状态下修改配置。缺少 rpc_available 可能是旧进程，按[setup](../setup/SKILL.md)安全重载，不回退官方独立 terminal。

Desktop 未连接时，先检查远控面板的状态与错误，再结合日志核对登录、模式、网络和启动环境。3.16 还需区分官方 HTTP 鉴权与 WebSocket 连接是否成功。面板停在“启动中”不能直接证明网络不可达，desktop_connected 为 false 也不能直接证明环境继承错误。首次环境修改按[configuration](../configuration/SKILL.md)在配置完成后安排重开。

手机远端工作区忙时本地 RPC 返回 remote_workspace_busy，等待用户主动切回。隔离测试不等于真实手机共存，重新开启后需实际验收。不要创建真实任务探活，不擅自杀进程、提权或修改其他插件。

日志与报告不含消息正文、链接、sid/hash/mid 或 control_token，分别报告已核实、未核实和待用户验收事项。
