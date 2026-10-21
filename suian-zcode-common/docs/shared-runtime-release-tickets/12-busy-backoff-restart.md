# GUL-03：升级忙退避重探与超时放弃

**状态**：用户已确认（2026-10-21）；已发布为 #136；等待 GUL-01（#134）、GUL-02（#135）。

## 问题与交付行为

现状是人工循环：技能引导"请用户暂停移动端远控 → Status 确认 desktop_connected:false → Restart"，脚本侧是一次性 throw 无重试。远控用户通常一直连着，纯连接判定几乎必然失败。

本票交付：Restart/Remove 在远控忙时自动退避重探——探测节奏 2 秒起步指数增长、15 秒封顶、默认总上限 60 秒（`-BusyTimeoutSec` 可注入小值供测试）。V2 协议下空闲判定为 desktop_connected 且 `rpc_in_flight == 0`（连接在但无操作在飞即放行闪断）；空闲后走 GUL-01 的升级关闭，若服务端 409（竞争窗口内新操作开始）则回到退避循环。超时仍忙则放弃本次切换：输出 `upgrade_deferred: 'remote_busy'` 结构化结果、活动记录与任务未动、候选保留待下次，与规格 7.2 第 2 步"只报待激活"语义衔接。

## 负责模块

common 的 setup.ps1（Restart/Remove 分支的退避循环、参数、deferred 输出）；setup.test.mjs 新增忙退避契约测试。

## Blocked by

- GUL-01（#134）：`rpc_in_flight` 字段与升级关闭端点。
- GUL-02（#135）：退避等待段必须在事务锁内。

## 接口与约束

- 冷启动降级：运行中的旧网关没有 `rpc_in_flight` 字段，升级它的第一次探测降级为保守判定（等 desktop_connected:false）；升级完成后的下一次起才启用"连接在但空闲放行"。
- V1 协议不启用"连接在但空闲放行"（旧版 Desktop 断线自愈无源码证据），保持保守等待连接断开；判定依据 config 的 relay_protocol_version。
- 本地 RPC 客户端（title 命名 worker 等）的飞行中请求同样构成"忙"（rpc_in_flight 已涵盖）；闪断会 reject 其 pending，技能文档的"等插件调用收尾"语义由本票的自动等待承接。
- 探测节奏不超过 Desktop 重连退避量级；超时放弃不强制切换、不回退候选部署（切换尚未发生，无回退对象）。
- Remove 复用同一退避逻辑，但超时语义与 Restart 一致：明确放弃并报告，不删除任何东西。

## 验收条件

- [ ] 测试：忙若干次探测后转为空闲，升级完成且活动记录切换正确。
- [ ] 测试：持续忙到超时，输出含 `upgrade_deferred: 'remote_busy'`，active-gateway.json、config.json 与计划任务均未变动。
- [ ] 测试：运行中网关无 `rpc_in_flight` 字段时按保守判定等待（冷启动降级）。
- [ ] 测试：升级关闭返回 409 时回到退避循环，不直接失败。
- [ ] 测试：`-BusyTimeoutSec` 注入 1 秒级小值生效，默认 60 秒。
- [ ] 既有 Restart/Remove 成功路径（desktop_connected:false 直通）测试全绿。

## 验证与完成边界

验证在隔离 fixture（模拟健康响应序列）内完成。真实 Desktop V2 闪断自愈、手机 App 重连表现不在本票承诺内——手机侧为外部黑盒，真实升级链路验收由用户在 GUL-04 文档化后按技能流程执行。
