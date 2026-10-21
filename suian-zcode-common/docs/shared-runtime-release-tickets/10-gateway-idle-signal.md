# GUL-01：网关空闲信号与升级关闭的服务端确认

**状态**：用户已确认（2026-10-21）；已发布为 #134；已在 feat/gateway-upgrade-backoff-lock 实施完成（2026-10-21，含审查修复），待正式集成。

> GUL（Gateway Upgrade Lifecycle）系列：网关升级从"要求用户手动暂停远控"演进为"忙时自动退避、空闲闪断切换、幂等防重入"。本系列共四票，规格依据 2026-10-21 会话调查：Desktop V2 连接层自带断线自愈（指数退避 1s–30s 无上限、重连重取 token、恢复后重放未确认 RPC 批次，见 official-zcode 快照 webRemoteControlTransport.ts 与 retry.ts），网关闪断对 Desktop 等价于网络抖动；要改的是网关侧闸门而非宿主。

## 问题与交付行为

`/health` 只能回答"有没有连接"（desktop_connected 等），不能回答"有没有操作在飞"；`/shutdown` 只要有 Desktop 连接一律 409，升级方无法区分"闲置可闪断"与"操作进行中"。而网关进程内的 rpc-broker 已维护每个 peer 的进行中请求表（peer.ids）与桥请求集合（bridgeRequests），只是未暴露。

本票交付：网关在 `/health` 暴露 `rpc_in_flight`（所有 peer 进行中请求计数，含本地 RPC 客户端与手机桥请求）；`/shutdown` 新增升级关闭模式（请求携带 idle 标志）：有连接但无飞行中操作时接受关闭，有飞行中操作时 409 且响应体明确 busy 原因。不带 idle 标志的既有语义保持不变（有 Desktop 连接一律 409），旧消费方不受影响。

## 负责模块

common 的 gateway.mjs（健康字段、shutdown 分流）、rpc-broker.mjs（in-flight 计数导出）；gateway.test.mjs / gateway-rpc.test.mjs 新增回环契约测试。

## Blocked by

无（可立即开始）。

## 接口与约束

- `rpc_in_flight` 计数覆盖所有 peer：本地 RPC 客户端（/rpc）与手机侧桥（workspace-bridge、RPC 帧）都计入；计的是"请求在飞"，不含纯连接与心跳。
- 升级关闭（idle 模式）仍要求 control_token 鉴权；接受后走既有 closeGateway 路径，不新增静默 terminate；409 响应体带可区分的 busy 标识，供升级方回到退避循环。
- 无 idle 标志的 `/shutdown` 行为逐字节不变；`/health` 仅新增字段，不改动既有字段名与语义。
- 旧网关没有 `rpc_in_flight` 字段——该字段的消费方降级策略在 GUL-03 定义，本票只负责网关侧事实准确。

## 验收条件

- [x] 回环测试：本地客户端发起飞行中 RPC 期间 `/health` 的 `rpc_in_flight > 0`，应答完成后归零。
- [x] 回环测试：手机侧桥请求进行中同样计入 `rpc_in_flight`。
- [x] 回环测试：desktop_connected 且 `rpc_in_flight == 0` 时升级关闭被接受，网关进程退出。
- [x] 回环测试：飞行中操作存在时升级关闭返回 409 且网关不退出，响应体带 busy 标识；不带 idle 标志的旧语义保持（有 Desktop 连接一律 409）。
- [x] 既有测试全绿：新增字段不破坏 setup Status、cli、deploy 等既有健康消费方。

## 验证与完成边界

验证全部在回环测试内完成，不需要真实手机或 Desktop；真实 Desktop 闪断恢复验收属 GUL-03 的升级链路范畴，本票不宣称。手机 App 侧行为是外部黑盒，本票不承诺。
