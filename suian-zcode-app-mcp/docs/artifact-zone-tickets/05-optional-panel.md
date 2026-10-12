# 工件 demo：按版本启用的原生只读侧栏

GitHub Issue：[#31](https://github.com/ONEGAYI/ZCode-Plugins/issues/31)。完整版唯一投影另见 [#36](https://github.com/ONEGAYI/ZCode-Plugins/issues/36)，不阻塞本票。

本地标识：AZ-05。状态：demo 必需的原生只读侧栏已本地实施，并完成隔离 Desktop 接线和代理视觉自检，待用户验收和发布。实现依赖：#29，已在本地接入。宿主条件：ZCode 应用版本至少 3.15.1、所需 MCP Apps UI 能力，以及目标会话的 MCP 连接就绪。

## 问题与交付

用户在 Desktop 本地会话的原生侧栏查看当前会话工件，打开或刷新时获取最新 revision、分类统计和完整条目；读取和展示不调用模型。

负责范围：原生 manifest surface、MCP UI 工具/资源元数据和 service 接线、只读页面、版本/能力门控、隔离契约测试及真实 Desktop UI 验收。复用同一工件存储与子初始化入口，不增加外置网页进程。

## 验收条件

- [ ] 使用正式 ui.surfaces、availability=session 和 _meta.ui.surface/_meta.ui.resourceUri 接线，侧栏绑定宿主会话身份，不猜最近会话。
- [ ] 版本至少 3.15.1 且 MCP 初始化声明支持对应 UI MIME 类型时提供 UI；旧版、未知版本或能力不足保留普通工件工具与摘要，不暴露失效 UI 元数据。
- [ ] 应用版本优先取 Desktop 提供的 ZCODE_APP_VERSION，缺失时才取 name=zcode 的 MCP clientInfo.version；不能用页面 getHostVersion()/hostInfo.version 的桥接版本比较 ZCode 应用版本，也不虚构 manifest minZCodeVersion 字段。
- [ ] 页面只读，显示 revision、总数、分类计数、label/purpose/ref；空状态和存储错误呈现清楚。
- [ ] 打开或显式刷新读取最新状态；切换两个会话不串读，不建立第二份状态。
- [ ] 原生历史分叉侧栏读取对应快照；snapshot_missing 明确提示继承缺失，同时允许正常查看和刷新子会话后续工件。
- [ ] 页面无需调用模型、不访问网关 token、不提供工件编辑或资源写操作；跨会话跳转、系统打开文件等未验证能力不预先承诺。
- [ ] 从正式 UI 资源/service 边界测试门控、当前会话、刷新和诊断，并在真实 3.15.1+ Desktop 本地会话进行视觉验收；AgentServer 或 HTML 单测不冒充 Desktop 验收。

## 固定依据

3.15.1 官方 [UI_PLUGIN.md](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/UI_PLUGIN.md)、[surface 解析器](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/plugins/ui-surfaces.ts#L18)、[MCP 客户端版本与能力](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/mcp/index.ts#L1531)、[UI bridge version](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/shared/src/mcp-apps/contract.ts#L26)。

真实原生侧栏已完成最新刷新、父子会话绑定、历史快照、缺快照后继续读写、空状态和存储错误验证，见 [开发验证与截图](../artifact-demo-verification.md)。冷会话首开仍可能因宿主尚未建立 MCP 连接而失败；目标连接就绪后重试成功，不把该路径计为首开即用。父规格：[demo 规格](https://github.com/ONEGAYI/ZCode-Plugins/issues/28)，见可折叠全文。
