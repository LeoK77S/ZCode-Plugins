# 并发写修复独立审查记录

记录 `zcode/mcp-concurrent-writes` 分支（并发写修复）的 review-loops 独立审查过程与结论，供后续追溯。审查由未参与修复编写的独立子代理执行两轮，主代理逐项核实。

## 审查范围

- 基线：dev@d3d50a3；被审提交：b2df7d3（并发写修复：control.mjs 移除全局 busy、测试改写与新增、write-tools.md 并发语义同步）。
- 第二轮复核增量（b770f11）：审查处置带来的测试防线与文档边界限定，无生产代码改动。
- 覆盖层：需求与范围、局部正确性、调用链与并发兼容（control → gateway-client → gateway → rpc-broker → vendor ChannelClient）、安全与运行风险、测试有效性。

## 发现与处置台账

| 编号 | 发现 | 严重度 | 处置 | 状态 |
|------|------|--------|------|------|
| P3-1 | rpc-broker 握手本地校验拒绝路径疑似不消费排队队列 | P3 | 核实为误报：早退 return 只回到 drainInitializations 的 while 循环体，条件重评估后继续消费；第二调用点中该分支的 initializing 比较恒为假。保留真实网关集成测试作为回归防线 | 已关闭（误报） |
| P3-2 | 并发写连接数无上限，依赖宿主自律 | P3 | 接受现状：每连接 120 秒超时兜底、finally 必然关闭，宿主单轮并发为个位数 | 接受 |
| P3-3 | 单飞声明缺「同一 MCP 进程」限定，跨进程并发重置无互斥 | P3 | 文档补回限定；跨进程无互斥为基线既有边界（旧 busy 同为进程内），防线是每次调用的用户确认与卡片对账 | 已关闭 |
| 测试缺口 | glm 单飞测试未锁定 resetting 失败后释放 | - | 补第三次调用断言（应到达 glm 校验而非 remote_busy） | 已关闭 |
| P3 备注 | 新集成测试的 30ms 放闸前等待是软时序屏障 | P3 | 复核者评估失效模式为覆盖退化而非假绿，不阻塞 | 接受 |

## 验证结果

- common 全量 `npm test`：93/93 通过。
- app-mcp 全量 `npm test`：120/120 通过（含并发归档回归测试：修复前以 remote_busy 变红）。
- 第二轮增量由独立子代理复核通过（2026-10-12，两轮共 2 名独立审查者）。

## 验收边界

- 真实 Desktop Host 对并发 v4 握手（同桥多 peer、drainInitializations 串行）与并发 archiveTask 的行为未实机验证；本地证据为 broker 设计注释与三客户端并发握手集成测试。
- 同一会话并发归档的 Host 幂等性未知；读回确认兜底，最坏报 archive_not_confirmed 不误报成功。
- 正式集成进 master 时需同步 suian-zcode-app-mcp 版本与 CHANGELOG（用户可感知行为变化）。
