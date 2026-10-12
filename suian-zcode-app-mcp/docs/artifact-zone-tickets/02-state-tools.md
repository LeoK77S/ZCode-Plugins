# 工件 demo：当前会话持久状态与增量工具

GitHub Issue：[#28](https://github.com/ONEGAYI/ZCode-Plugins/issues/28)。完整版唯一投影另见 [#36](https://github.com/ONEGAYI/ZCode-Plugins/issues/36)，不阻塞本票。

本地标识：AZ-02。状态：已本地实施，公开 MCP/stdio 契约与隔离 Desktop 接线通过，待用户验收和发布。Blocked by：无。完整版唯一投影已拆为独立等待上游事项，不作为本票前置条件。开发结果见 [验证记录](../artifact-demo-verification.md)。

## 问题与交付

Agent 通过 get_artifacts 每次读取当前会话最新工件，通过 set_artifacts 原子提交增量变化；工具回执提供当前分类统计，状态重启后仍在。

负责范围：app-mcp 工件存储及容量、server/cli 注册与外置配置、caller 接线、工具契约测试和说明。复用既有 caller，不重构公共网关或会话控制。

## 验收条件

- [ ] 新增 get_artifacts/set_artifacts，只绑定唯一定位的当前会话，不接受 session_id；缺失或歧义来源明确失败。
- [ ] 四类、四字段和按 ref 精确匹配；增量批次全部原子生效，保留既有条目顺序。
- [ ] get 每次读取最新 revision、完整 items 和 stats，不返回旧摘要或进程缓存作为当前状态。
- [ ] set 在同一真实 SQLite 事务中检查 expected_revision、应用变化、检查容量并提交；冲突、无效输入和超限不改旧状态。
- [ ] 变化才增加 revision；set 回执含 revision、changed、upserted、removed、stats，不重发完整列表。
- [ ] stats 给出总条数及 pr/session/file/link 各类条数，包括零值；两个会话不串读。
- [ ] 20/21 条及完整表示 12000/12001 Unicode 码点边界符合契约，包含中文/emoji；完整表示只用于容量检查，不自动注入请求。
- [ ] 普通空状态读取不创建写存储；已存在而损坏/不可读的存储不能伪装为空。重启仍能读取独立状态。
- [ ] 使用插件自有 SQLite 和外置数据路径，不写 ZCode 会话库或业务资源；并发验证使用独立连接/进程。
- [ ] 从 MCP 公开工具入口先写契约测试观察红灯，再实现。测试路径均隔离，首次测试落盘保存日志和退出码。

## 阶段依据

2026-10-11 已确认 demo：用户提交时生成管理提示词和统计，允许累积；get 最新；原生只读侧栏；分叉按历史完成轮的 SQLite 快照继承。缺快照提示 snapshot_missing，但不阻断分支和后续工件操作。

3.15.1.8093 隔离 AgentServer 已验证历史 A→父 B→从 A 原生分叉，子 SessionStart 首次读 A；无变化断点、多 Stop、缺快照后的正常子生成也通过。验证使用临时 SQLite 和本地合成 SSE，不是生产 MCP 工具或 Desktop UI 验收。

本票附 demo 规格；#27 保留原始严格目标及 3.14.5 调研历史，不能用其旧阻塞条件否定已调整的 demo 范围。
