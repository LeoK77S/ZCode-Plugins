# 工件 demo：可累积摘要与历史断点分叉快照

GitHub Issue：[#29](https://github.com/ONEGAYI/ZCode-Plugins/issues/29)。完整版唯一投影另见 [#36](https://github.com/ONEGAYI/ZCode-Plugins/issues/36)，不阻塞本票。

本地标识：AZ-03。状态：已本地实施，正式同步 Hook 和历史断点原生分叉通过隔离验证，待用户验收和发布。实现依赖：#28，已在本地接入。本票采用现有正式 Hook，不等待每请求唯一投影槽。开发结果见 [验证记录](../artifact-demo-verification.md)。

## 问题与交付

每次用户提交提醒 Agent 管理工件并给出当前分类统计。原生分叉从所选历史完成轮的不可变快照初始化独立子状态，父后续变化不混入旧断点。

负责范围：原生 Hook 注册和入口、SQLite 快照/断点映射、只读宿主消息身份适配、幂等子初始化、get/set/摘要读取前接线和隔离宿主验证。

## 验收条件

- [ ] UserPromptSubmit 输出管理提示词和分类统计，可含 revision；不自动附完整 ref/label/purpose/items，明确摘要可能过时。
- [ ] 同轮工具续跑/重试保留旧摘要是接受的行为；下次用户提交读取当前统计，get/set 回执保持最新。
- [ ] 同步 Stop 在返回前原子保存不可变内容和父会话＋完成消息 ID 的映射；不照搬命名插件的 async Stop。
- [ ] 通过 Hook turnId 和只读宿主 anchor 精确定位完成 assistant response，不用 renderer rowId、时间戳或父最新状态猜断点。
- [ ] 无变化内容复用快照，仍登记每个断点；同轮多 Stop 各绑定不同消息，所选最终断点继承对应版本。
- [ ] 子身份只读核对 task_type=fork 与 fork_notice.metadata.forkOrigin；使用原始父 ID/目标消息 ID，不以 parent_id 或子重映射消息 ID 代替。
- [ ] SessionStart 及首次摘要/get/set/UI 前共用一次性初始化；已有子状态和子独立版本不被重复 Hook、恢复或父更新覆盖。
- [ ] A 完成后父变 B，从 A 旧断点原生分叉，子首次插件读取仍为 A；普通子会话为空，不误判为分叉。
- [ ] 旧断点或缺映射时明确提示 snapshot_missing，保留宿主子会话；不复制父最新状态，不冒充成功继承，也不阻断后续工件操作或正常聊天。
- [ ] 使用真实隔离 SQLite 与发行包 Hook/V4 入口做 TDD 和宿主验收；补验进程冷恢复及并发，不能把已有临时探针算作生产验收。

## 已验证入口与限制

本机 3.15.1.8093，原封不动随包 zcode.cjs，Electron Node 模式 app-server --stdio --surface desktop。隔离运行已通过 A/B、无变化、同轮两次 Stop、子 warm resume、缺快照后读写与正常子生成；子 SessionStart 读取早于分叉响应。Hook transcript 没有稳定消息 ID，实际接线读取宿主消息库的 anchor。

源码另有 automationCreateLimitReached 跳过 Stop 后以 success 收口；不能宣称所有 canFork 目标必有快照。该特殊分支或真实 Hook 故障未实跑，缺失场景用删除映射模拟。

固定源码：[常规 Stop](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/turn-stop.ts#L201)、[特殊成功分支](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/turn-stop.ts#L176)、[稳定边界](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/stable-fork-boundary.ts#L83)、[子 forkOrigin](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/session-fork.ts#L414)。

父规格：[demo 规格](https://github.com/ONEGAYI/ZCode-Plugins/issues/28)，见可折叠全文。
