# app-mcp 领域文档入口

沿用当前项目文档布局，不另建术语表或 Context Map。

- **术语**：根 [CONTEXT.md](../../../CONTEXT.md)。讨论、规格与票正文使用其中的定义；拟议功能必须标明尚未实现。
- **架构决策**：本项目 [docs/adr/](../adr/)。只记录已确定的选择，提议与已接受的决定分开表达。
- **研究证据**：本项目 `docs/`。引用固定版本的原始源码，区分静态核查、运行时验证与产品验收。
- **规格与票**：本项目 `docs/`。规格列明行为、状态所有者、接口与验收；票只补充本次交付范围、依赖和具体检查。

local-only 产品接入：[设计澄清](../local-only-design.md)、[规格](../local-only-spec.md)、[开票索引](../local-only-tickets.md)、[ADR 0003](../adr/0003-local-only-desktop-patch.md)。固定 Windows 3.16.2.8769 包已完成[隔离开发验收](../local-only/09-development-acceptance.md)，用户日常安装验收另计。后续自动路由见[规格](../local-only-routing-spec.md)和 [ADR 0004](../adr/0004-local-only-patch-routing.md)。

工件区入口：[设计澄清](../artifact-zone-design.md)、[ADR 0001](../adr/0001-session-artifact-projection.md)、[已确认规格](../artifact-zone-spec.md)、[开票索引](../artifact-zone-tickets.md)、[发行版核验](../artifact-host-capabilities.md)。

2026-10-11 的 demo 阶段决定见 [ADR 0002](../adr/0002-artifact-demo-summary.md)；3.15.1 的历史断点分叉已通过隔离验证，范围和 [脱敏证据](../artifact-turn-snapshot-evidence.json)见 [分叉核查](../artifact-host-fork-audit.md)。摘要、侧栏、SQLite 快照和缺失时不阻断操作的规则已明确；生产功能尚未实施。
