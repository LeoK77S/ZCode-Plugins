# 原生侧栏冷启动与可信归属预读

2026-10-12，implement-spec 的只读预读。对象为官方 3.15.1 / aac4755；不修改 sources，不调用真实 Host 写操作。本记录指导 SE-01 的窄实现，不代表 H1/H2 已通过实际 Desktop 验收。

## 工作区与会话的来源

官方插件 resolver 注入 ZCODE_PROJECT_DIR=context.workingDirectory，并解析显式 cwd 与 env 模板。自有 manifest 应把 cwd 及插件专属工作区变量明确绑定到该值，服务端不猜 process.cwd()。缺失或异常时拒绝文件访问。

UI 实例凭证校验工作区、会话、插件、server 和连接代际。UI tools/call 带 trace，MCP adapter 据此提供 session_id；该 UI 分支没有传 workspacePath，不能要求它必含 workspace_path。工具不接受页面随意提供目标 session。

来源：[stdio 配置解析](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/plugins/mcp.ts#L209-L239)、[实际 spawn](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/mcp/index.ts#L1918-L1927)、[UI 实例绑定](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/instances.ts#L77-L108)、[UI 调用](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts#L503-L511)、[meta 注入](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/mcp/index.ts#L2291-L2313)。

## 冷启动连接的实际边界

AgentRuntime 构造时异步 startMcpStartup，会连接已配置 MCP，无须先向模型发消息。但 mcp/uiOpenInstance 只查目标会话已有连接快照，未连接时立即失败，不等待初始化。app-only visibility 的检查发生在取得连接快照之后，不能用 visibility 配置修复此前失败。

connectMcpServer 是内部 ZCodeApp 方法，CLI /mcp connect 可调用，但当前 zcode-agent channel 没有该方法。listMcpServerStatuses/mcp/list 使用独立 mcp-status 与 protocol-settings lease，不能把设置页刷新当作目标会话连接已建立。已有通用网关 call 不会增加不存在的 Host 方法。

来源：[runtime 构造](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/agent-runtime.ts#L332-L346)、[MCP 启动](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/mcp.ts#L41-L80)、[页面凭证](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/protocol.ts#L216-L236)、[内部连接方法](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts#L383-L394)、[Host service](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/zcode-agent/zcodeAgent.ts#L649-L675)、[status lease](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp.ts#L76-L104)。

新空白会话的 SessionStart startup Hook 在首轮 turn 内执行。已有持久会话真正冷恢复的 app.resume 可执行 resume Hook，无须模型请求；活跃会话复用 record 不再次执行。因此不能以 Hook 保证所有侧栏首开，更不能调用未暴露的 connectMcpServer。

来源：[startup Hook](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/turn.ts#L231-L254)、[冷恢复入口](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts#L1431-L1451)、[resume Hook](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/resume.ts#L259-L268)。

## SE-01 仍需验证

补查发现，公开 `IZCodeTaskService.createTask` 属于 `zcode-task` channel。它没有 initialMessage 参数，必填 workspacePath，可选 modelSelection、mcpServers、deferPersistenceUntilFirstPrompt 等，返回 taskId 与 initialSlashCommands。既有业务插件的 create 封装随后会发送消息，不能直接用于本票的无模型前置探针。

此入口在 createSession 后调用 syncTaskMeta、初始化分组排序并广播 task_created，比裸 CLI session/create 多了 Desktop 任务索引接入。普通分支在同一 Host 创建目标 Runtime 与按 session ID 绑定的 MCP lease，构造时异步连接 MCP；创建返回不等于连接已就绪。

来源：[公开任务契约](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/session/zcodeTaskService.ts#L220-L247)、[Host 创建实现](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts#L1966-L2054)。实际安装包 out/host/index.js 的对应实现已只读核实一致，SHA-256 为 3fc3c5b286d7871e87f257eb09ab8e7165e8705307c2ee6cb66b687cd4c7f4bc。

任务索引与 core session 主记录不同；这条创建链没有自动 ensureSessionPersisted，不能据此保证进程退出后的空会话冷恢复。SE-01 的 H1 验收是无模型前置的侧栏首开与面板关闭重开，不额外要求空 core 会话跨进程持久化。裸 CLI 关闭后 list 为空，也不能独自证明创建时没有持久化：关闭语义与任务索引是否建立都必须区分。

- 从实际 Desktop 的新测试会话无模型前置地首开侧栏、关闭重开。
- 实际 SDK handler 的 meta 位置与 session_id，不只模拟请求。
- 同一工作区多个会话的请求归属，以及两个工作区的 stdio env 隔离。
- 当前实际安装产物的连接时序；现有 demo 的冷会话失败反例不能抹去，见 [真实接线记录](../../suian-zcode-app-mcp/docs/artifact-demo-verification.md#宿主限制与版本修正)。

缺少可满足 H1 的接口或运行验证时，保留具体能力条件；不通过固定等待、偷偷发模型消息或修改宿主来宣称通过。
