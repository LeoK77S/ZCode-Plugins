---
name: debug
description: 排查 ZCode 自动命名不触发、标题异常、模型错误和 Windows 通知，区分配置就绪与真实 Stop 执行。
---

# 自动命名排障

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与数据](../paths.md)，固定启动目录、注册方式和实际配置。

先 status，再 doctor，再 probe，stdin 传明确目标。status 看暂停、模型、通知资产和最近结果；doctor 查双库、模型和 Hook。原生模式检查 hooks/hooks.json，activation/execution 为 not_verified；源码模式查用户级 Stop。ready 只是静态检查通过，不证明宿主已加载或执行。

目标 ID 与工作区优先取宿主实际会话上下文。其他指定会话可用会话 MCP 的 list_sessions 按 query/workspace_path 检索，使用返回的 session_id 与 workspace_path；多条候选让用户选定。未安装 MCP 且宿主未提供标识时，请用户提供目标 ID 与工作区，取得前只核对配置和注册；不猜最近会话，也不为排障强制安装可选 MCP。

原生模式另核对本插件和 common 的 enabled、全局 hooks.enabled，以及是否残留旧全局命令。缺配置返回 not_configured，enabled:false 返回 disabled，均不派发 worker；先按 setup/configuration 初始化。

| 现象或 reasonCode | 排查方向 |
| --- | --- |
| 公共包无法导入 | 公共 setup 在 npm ci 后重建链接，不复制公共模块 |
| gateway_not_configured / invalid_config | 公共配置缺失或无效，不回显完整文件 |
| gateway_upgrade_required | 文件已新、进程仍旧，按公共 setup 安全重载 |
| unreachable / connection_failed / desktop_offline | 公共 debug 分别检查任务、健康、连接与模式 |
| remote_workspace_busy | 手机远端工作区占用，等用户主动切回 |
| bridge_timeout / rpc_protocol_error | 核对版本和原窗口，不重试已提交写操作 |
| stale_result / outdated_event | 内容、运行状态或标题已变化，候选被丢弃 |
| index_title_mismatch / host_title_mismatch | 标题存储不一致；不直接写库，明确授权后经官方改名链路对齐 |

Hook 在会话创建时快照；变更注册后用新会话或重开后的会话验证。Stop → Hook → 延迟 8 秒 → 后台 worker；先看 state/hook.log.jsonl，再看 runner.log.jsonl 和 usage.jsonl，不把旧会话无触发当新配置无效。

静默探针只用 stop_hook_active:true，不用有效事件冒充静默检查。真实触发仅对用户指定测试会话完成一轮 Stop 后观察；手机共存需用户确认。

通知问题看 status 的 protocolRegistered/vbsInstalled/cooldown 与 toast-action-log.jsonl，核对 Windows 通知权限和勿扰。冷却两小时，OIL_ZCODE_TITLE_DISABLE_TOAST=1 可静音。自动测试不激活 suian-zcode-title://，该链路会打开宿主确认框。

默认调用不读取远控链接；明确管理旧凭据时才以 stdin 使用 auth/unauth。不输出链接、sid/hash/mid 或 control_token，不直接写会话数据库。
