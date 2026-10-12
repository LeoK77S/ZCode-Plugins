# 工件状态分叉继承：宿主与插件入口静态核查

核查日期：2026-10-10。本次只读审查安装包 CJS 与官方 3.14.3 钉定源码，没有启动真实或隔离 CLI，没有读取用户配置和聊天数据库，没有修改安装目录或 sources。

后续隔离运行已完成，V4 稳定分叉与事件时点的实际反例见 [发行版核验报告](artifact-host-capabilities.md)。本文保留静态阶段的协议依据与待验证项，不代表后续验证尚未进行。

## 2026-10-11：3.15.1 分叉能力边界

**范围**：先只读核对官方 3.15.1 源码快照 `aac4755666d09fdcd70272fcf063c077a639015f`、原生插件封装和公共网关入口，随后运行本机 3.15.1.8093 的隔离 AgentServer 验证历史断点路线。未操作真实活动会话或点击 Desktop UI；2026-10-10 的 3.14.5 证据不冒充新版结果。

**以执行分叉操作时的父状态为继承基准，原生 UI 分叉仍未取得准确工件快照保证**。新版 Hook 枚举仍只有七项，SessionStart 输入也没有分叉来源或外置修订绑定。stable fork 先提交子数据和命令事实，再追加 SessionForked，事件中没有插件工件 revision。仅监听通知后读取父最新状态，仍然不能确定分叉操作时的工件。

**插件发起分叉是可继续验证的候选路线**。V4 的 forkAssistant 命令已有父会话、命令 ID 和稳定聊天目标；core 在提交子数据的同一 bundle 中写入 sourceCommandId、父 ID 和包含子 ID 的 accepted 命令事实。插件若在发起命令前冻结自身工件修订，可以研究按这份命令事实绑定副本。它仅覆盖经插件发起的分叉，不能据此宣称原生按钮也会自动冻结工件。

| 路径 | 已核实事实 | 能力边界 |
| --- | --- | --- |
| 原生 Desktop 的 forkAssistant | 允许父会话继续运行；子数据提交后才产生父分叉事件 | 未见插件分叉边界，也没有外置工件 revision；不承诺原生按钮的准确快照 |
| 插件经原 Host 发起 V4 分叉 | 命令可与子 ID 关联，命令事实随 fork bundle 持久化 | 有关联依据，冻结、子初始化和并发写入约束仍需实现及隔离验证 |
| SessionStart 补做子初始化 | 子 resume 会运行现有 SessionStart；Hook 只给当前 sessionId 等通用字段 | 需要只读解析可靠父子/命令事实，并在子首次读状态前完成初始化；不能只按 parentID 猜测普通子会话是分叉 |
| 分叉响应后才复制 | 宿主注册子 record 后 await 子 app.resume，再返回分叉结果 | 可能晚于子启动 Hook，简单的“调用 → 收响应 → 复制”不是完整方案 |
| 外置版本历史加时间匹配 | 宿主没有把插件 revision 绑定到分叉命令 | 不能仅靠时间戳或通知到达顺序证明精确修订 |

### 受控分叉的验证条件

下面是候选路线的验证条件，不是已批准的实现规格，也没有新增 fork 工具：

1. 发命令前，插件持久冻结父工件 revision，并以实际命令 ID 记录分叉意图。所有父工件更新需遵守这段受控操作的边界，否则冻结值不能称为分叉时状态。
2. 只读获取宿主持久命令事实，准确绑定该命令的 child ID；不能将同时发生的原生按钮分叉或普通子会话套用为同一次操作。
3. 子首次 Hook、摘要、get/set 或 UI 读取前完成独立状态初始化。要验证是否能在响应返回前从持久事实完成接线，且不把等待父操作与等待子 Hook 组成循环。
4. 副本采用冻结修订；父状态随后更新不影响子状态。重复 Hook、重复查询或恢复不得覆盖子会话已经维护的状态。
5. 分叉提交后宿主注册失败、RPC 超时或插件退出时，保留可识别的部分完成事实。不能把已经持久化的子会话当作未创建，也不能盲目再发分叉命令。
6. 使用隔离 Host、合成聊天和隔离工件数据库捕获命令、持久事实、Hook 与第一次工件读取顺序。须覆盖父并发更新、子立即启动、插件重启和重复处理；mock 的自设执行顺序不算宿主验证。

**针对操作时快照的结论**：已审查的 3.15.1 接口仍不足以覆盖原生 UI 分叉的准确外置快照；插件受控分叉具有命令身份关联依据，仍是待验证候选。用户本轮要求先探索能力边界再决定方案，尚未接受更换分叉入口、放宽快照语义或把分叉移出 demo。后续提出的历史断点方案见下一节。

### 历史断点快照方案

**用户提出新的继承基准**：以所选已完成生成轮的工件快照初始化子会话。每次 Stop 提前保存不可变版本，分叉按该断点的快照 ID 读取；父会话之后的变化不影响它。这区别于前文讨论的“点击分叉操作时冻结父当前状态”。旧结论不能直接用于否定新路线。

源码支持的常规链路为：持久化已完成 assistant step → 等待 Stop Hook → 固定最终消息断点 → 发布成功 TurnComplete → 该轮最终 assistant 获得 canFork。因快照预先保存，分叉通知的晚到不再要求插件重新猜测父当时状态。

已核实的候选身份链：

| 环节 | 源码中的可靠字段 | 对快照绑定的用途 |
| --- | --- | --- |
| Stop 输入 | sessionId、turnId | 定位父会话与运行时生成轮 |
| 最终稳定断点 | 消息 anchor.turnId、boundaryMessageId | 将 Stop 的运行时轮身份对应到实际聊天断点 |
| 子分叉来源 | forkOrigin.parentSessionId、forkOrigin.targetMessageId | 只读定位父历史断点，再读取对应不可变版本 |

以父会话 ID 和断点消息 ID 建立快照索引，并保留 turnId 作对应证据。不要使用 renderer rowId、时间戳或父“最新一份快照”作为替代标识。Stop 输入没有直接给出 boundaryMessageId；隔离运行已通过只读宿主消息的 anchor.turnId 定位完成消息，Hook transcript 本身没有稳定消息 ID。

关键边界：

- 快照 Hook 应采用同步落盘方式；命名插件当前的 async Stop 注册不能直接作为此处的快照完成保证。
- Stop 可要求同一轮继续生成，因此可能执行多次。一次 Stop 不等于一个最终可分叉断点；必须绑定消息身份，并以最终稳定断点选取对应版本。
- 工件没变化时可以复用同一快照内容 ID，但仍必须记录该聊天断点的映射。Git 默认不产生无变化提交，不能因此漏掉断点。
- 3.15.1 的 automationCreateLimitReached 分支显式跳过 Stop 后仍把轮状态标为 success，故不能概括“所有 canFork 目标必有 Stop 快照”。旧会话或 Hook 失败也可能缺少快照；缺失时不得回退父最新状态或把空集合称为准确继承。
- 快照不可变，子状态只初始化一次；重复 Hook、恢复和父后续更新不得改变历史快照或覆盖子已经维护的状态。

**存储方案已确认**：在插件自有 SQLite 内保存不可变快照和断点映射。内容无变化时复用快照，但仍登记每个断点，不引入独立 Git 仓库。

**缺失规则已确认**：原生分叉创建的子会话保留，首次工件 get/UI 明确报告 snapshot_missing。提示不阻断分支，也不影响子会话后续独立工件读写；不复制父最新状态，不将未继承状态冒充准确快照。

**运行验证**：本轮已执行同步快照 Hook 和原生稳定分叉，A→B→从 A 分叉的子首次插件读取仍为 A；无变化、多 Stop、缺失诊断和正常子生成均通过隔离探针。生产 get/UI 尚未验收，详细范围见下一节。

固定来源：[常规 Stop 及续跑](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/turn-stop.ts#L201)、[跳过 Stop 的特殊分支](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/turn-stop.ts#L176)、[最终边界在 TurnComplete 前落盘](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/turn.ts#L672)、[断点 anchor 与运行时 turnId](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/stable-fork-boundary.ts#L83)、[canFork 成功轮资格](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts#L930)、[子 forkOrigin](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/session-fork.ts#L414)。

### 3.15.1 历史断点路线的隔离运行

**结论**：在本机 3.15.1.8093 发行包的隔离 AgentServer 中，同步 Stop 可以保存工件历史快照，原生稳定分叉的子 SessionStart 可以在分叉响应前定位并读取所选旧断点。该路线足以继续 demo 实施；生产工具与真实 Desktop 侧栏尚未验收。

| 场景 | 实际结果 |
| --- | --- |
| 第一轮保存 A，父后续改为 B，再从第一轮原生分叉 | 子首次读取 A，父仍为 B |
| 两个完成轮的工件内容相同 | 内容 ID 复用，两条完成消息各有映射 |
| 同一运行时轮两次 Stop，第一次 C、第二次 D | 不同消息分别映射；仅最终消息有稳定断点，分叉读取 D |
| 子更新为 C 后在同一 Host 恢复 | 子仍为 C，没有被历史 A 覆盖 |
| 人为删除 B 断点映射后原生分叉 | 宿主接受分叉，首次读取报告 snapshot_missing |
| 缺快照子会话随后更新夹具工件并发送新输入 | 存储读写成功，新一轮正常完成 |

**身份接线已实测**：Stop 运行时只读消息库中已有对应 turnId 的已完成 assistant response 和原始消息 ID，最终完成后 anchor.boundaryMessageId 与它对应。Hook transcript 只含对话内容，不能从它提取稳定消息身份。子 task_type=fork，隐藏 fork_notice 的 metadata.forkOrigin 包含原始父 ID 和目标消息 ID；不能使用子复制后重映射的 ID。

快照注册使用原生同步 Stop；子初始化使用原生 SessionStart。工件夹具为独立 SQLite，不写 ZCode 会话库。父 A 子 SessionStart 的首次读取早于 forkAssistant accepted 响应；既往“通知到达后读取父最新状态”的竞态不参与这条路径。

**固定产物**：EXE ProductVersion 为 3.15.1.8093，随包 CLI --version 为 0.16.9，Electron Node 为 v24.14.0。CLI 15,126,820 字节，SHA-256 为 B816E38656E70FB585FE2AB1EA010DA89CDA928DAC1CCB5D83255FD18796DA6E；app.asar 340,511,069 字节，SHA-256 为 C98B4B2A80E5EA46CE93F934F9580EFF11BC487570C87478FA36A3F4BD3D101F。运行后两者哈希均未变化。

使用安装 EXE 的 Electron Node 模式运行原封不动的 resources/glm/zcode.cjs app-server --stdio --surface desktop。工作区、配置、Provider、数据库及临时文件均位于独立工作树的忽略目录；子环境采用白名单，只复制安装包公开的 Provider 配置。模型是本地合成 OpenAI SSE，未复制用户凭据、连接真实活动会话、调用线上模型或修改上游源码。

**验证限度**：get/set 是直接操作独立 SQLite 的测试夹具，尚未通过生产 MCP 工具验收；探针的 revision 用于标记状态，不定义生产子版本规则。未点击真实 Desktop UI、测试冷进程恢复、多窗口并发或真实 Agent 主动维护；缺快照由删除映射模拟，未执行 automationCreateLimitReached 或真实 Hook 失败路径。

每次运行首次保存日志与退出码；早期协议入口、偏好回执、响应字段和 CAS 水位的夹具错误已修正，并在证据中列为排除的设置失败。后续运行及 Stop/anchor 回读断言通过，不把前述失败算作产品缺陷。已核对最后两次探针的已知 PID 及直接子进程无残留。

完整脱敏时序、产物哈希、场景与限制见 [JSON 运行证据](artifact-turn-snapshot-evidence.json)。原始探针、配置、数据库与日志按项目约定清理；可实施行为汇总到 [demo 规格](artifact-zone-spec.md)。

### 3.15.1 固定来源

- [Hook 枚举与输入](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/contracts/src/hooks/index.ts#L7)；[SessionStart 实际输入装配](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/hooks.ts#L20)。
- [forkAssistant 的稳定目标及命令 ID](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/fork-edit-retry.ts#L327)。
- [命令事实、子 bundle 提交与后续分叉事件](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/session-fork.ts#L721)。
- [V4 子注册在返回结果之前](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/v4-bridge.ts#L1340)；[子 resume 在分叉响应之前](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts#L2193)；[resume 实际等待 SessionStart Hook](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/resume.ts#L250)。
- 当前 [公共网关客户端](../../suian-zcode-common/gateway-client.mjs#L52)只公开 call/probe/close；[已有 V4 原 Host 调用](../control.mjs#L163)展示 hello、initialize 与 sendConversationCommandV4 接线。通用 call 的存在不等于受控分叉或事件订阅已经实现。

## 2026-10-10：操作时快照的静态结论

**现有实现能产生父子会话 ID，但没有核实到纯插件可在原生分叉操作中冻结外置工件状态的入口**。插件 Hook 没有分叉事件；宿主的 `SessionForked` 是子会话数据提交后产生的运行时事实。对外事件通知没有等待外挂完成持久快照的回执。

**首次启动时读取父状态不能满足分叉快照语义**。例如，父状态在分叉时为 revision 5，分叉后更新为 revision 6，子会话再启动。子 Hook 读取到 revision 6，不是分叉时的 revision 5。仅发现父子关系，不能确定需要复制的外置状态修订。

因此，本核查不支持把“子会话启动后补读父状态”写成分叉继承的验收通过。严格继承仍需上游提供可绑定外置状态修订的分叉入口，或另行确认覆盖范围更窄的插件控制分叉方案。

## 证据对象与可复核定位

安装包对象为 `{{ZCodeInstallDir}}/resources/glm/zcode.cjs`，本次实际读取文件大小为 **14820968 字节**，SHA-256 为：

```text
FAD4C35C4C36EC210D8A06D3FA0E77DE23C8545E2EB6FF90AEA1EB38D1E6275F
```

以下偏移均为原始 UTF-8 文件的零基字节位置；区间采用 `[开始, 结束)`。先读取完整相关函数和上下游调用，再按关键结构定位，没有执行 CJS。不同文件哈希不能直接沿用这些偏移。

| 安装包位置 | 已读结构 | 对照公开源码 |
| --- | --- | --- |
| `[1309699,1309906)` | `Tl` Hook 枚举只有七项，无 fork Hook | [hooks/index.ts，7–15 行][hook-enum] |
| `4148647` 附近 | 插件 Hook 事件检查使用 `new Set(Object.values(Tl))`；未知事件产生 `plugin_hook_unsupported_event` 并跳过 | [hook-sources.ts，129–142 行][hook-source] |
| `[12988871,12989387)` | `gAo` 为 `runSessionStartHooks`，只传当前 `sessionId`、source、时间、trace 等；有 `sessionStartHookRan` 门控 | [methods/hooks.ts，20–47 行][hook-start] |
| `[13121587,13125409)` | `fTn` stable fork：分配 child ID、构建副本、提交 bundle、追加父 fork 事件、返回父子 ID | [session-fork.ts，737–796 行][stable-commit] |
| `13124201` / `13124588` | 前者为 `commitForkBundle({child:…})`；后者为随后创建 `lt.SessionForked` 的位置 | [session-fork.ts，737–775 行][stable-commit] |
| `[14497716,14498146)` | `ZKo` legacy `forkSession`：检查 revision 与无活跃轮、调用 `forkFromCheckpoint`、注册 child | [server-operations.ts，2229–2249 行][legacy-fork] |
| `[14498146,14499260)`；其中 `14499050` | `TRn` 注册 child，继承父运行配置，然后 `await g.app.resume()`，最后返回父子 ID | [server-operations.ts，2274–2326 行][register-child] |
| `[13175362,13175661)` | `qRo` 内部事件 sink 被 await，异常只记 warning；它不是插件配置回调 | [methods/events.ts，528–546 行][event-sinks] |
| `756181` / `761091` | 安装包 `session/subscribe` / `session/fork` 的严格参数 schema，与下文公开契约字段一致 | [订阅 schema][subscribe-schema]、[分叉 schema][fork-schema] |

该对照只证明已读函数的结构与字段一致，不宣称安装包与公开源码全部相同。官方参考提交为 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`。

## 插件 Hook 与运行时事件的不同边界

**插件 Hook 配置受七项事件枚举约束**：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`。插件加载器拒绝其他事件名，见 [枚举][hook-enum] 与 [加载器][hook-source]。

`SessionStart` 输入的 source 只有 `startup/resume/clear/compact`，没有父 ID 或分叉点字段，见 [Hook 输入契约，67–75、127–131 行][hook-input]。安装包的 `gAo` 同样只构造当前会话的输入。公开插件加载结果只有 commands、hooks、MCP、skills 等配置，见 [PluginLoadOutcome，248–256 行][plugin-load]；隐藏 plugin-host 命令执行插件模块 `main()`，并未向它注入 Agent Runtime 对象，见 [plugin-host-command.ts，49–63 行][plugin-host]。这些已审查入口均未提供注册 `SessionForked` 回调的方式。

**运行时确有 `SessionForked` 事件**，payload 包含 `originalSessionId`、`forkedSessionId`、`targetMessageId` 等，见 [事件契约，198–207 行][fork-event]。stable fork 先原子提交 child/message/entries，随后向父会话追加该事件；父事件追加失败后只记 warning，分叉子会话已持久化，见 [提交与事件顺序][stable-commit]。`selection_side_chat` 分支在这里不产生相同的父 fork 事件，不能把本结论泛化为所有子会话创建。

内部 `appendEvent()` 会等待存储和内部 sink，见 [events.ts，103–109 行][event-append]。但协议 sink 调用的是 `onSessionEvent()` 的 void 转发路径，最终 `notify({method:"session/event",params:…})`；没有外部客户端“已保存工件快照”的 ACK，见 [事件转发，3047–3082 行][event-forward]。安装包对应 `kXa/iZo` 位于 `14508262/14509860`，同样是通知发送。因此内部 await 不等于等待插件处理完成。

## 分叉时序对外置状态的影响

公开 stable fork 的时序为：**固定会话历史边界 → 提交子数据 → 产生父分叉事件 → 尝试注册并 resume 子会话**。V4 bridge 在 core copy 后调用 `registerCommittedForkBestEffort`，见 [v4-bridge.ts，1189–1209 行][v4-register]；子注册失败时保留已提交的分叉并记录启动失败，见 [540–568 行][v4-register-failure]。外置工件状态不在现有 `commitForkBundle` 输入中，分叉事件也不携带工件 revision，见 [bundle 参数与事件][stable-commit]。

legacy `session/fork` 在子 `resume()` 后才返回父子 ID，见 [registerForkedSession][register-child]。`resume()` 又会调用 `runSessionStartHooks("resume")`，见 [resume.ts，253–261 行][resume-hook]。插件若只在 fork 响应返回后复制状态，可能已晚于子启动 Hook。

桌面 V4 `forkAssistant` 使用稳定的历史目标，允许 running parent，不走 legacy 的“父空闲 + 工作区回退”路径，见 [fork-edit-retry.ts，276–309 行][v4-fork]。固定 transcript 边界不等于固定外置工件状态；父 Agent 的后续 `set` 与外挂接收 fork 通知之间仍缺少已核实的同步契约。

现有运行时事件可以作为**关系发现**的证据：知道哪段会话由哪段分叉。它不能单独作为**状态冻结**的证据：不能保证外置存储复制的是分叉时的 revision。即便外部维护版本历史，也需要可靠的宿主边界与外置 revision 绑定，不能用接收事件时的“最新状态”代替。

## 给隔离运行时验证的协议入口

以下是已核查的 AppServer 协议格式，供独立验证使用；本轮没有发送这些请求。帧是 NDJSON，严格 schema 为 `id/method/params/trace?`，**不含 `jsonrpc` 字段**，见 [请求 schema，286–293 行][request-schema]。

```json
{"id":"fork-test","method":"session/fork","params":{"sessionId":"{{ParentSessionId}}","target":{"kind":"message","messageId":"{{MessageId}}"}}}
{"id":"watch-parent","method":"session/subscribe","params":{"sessionId":"{{ParentSessionId}}","deliveryKind":"web-remote-replayable","afterSeq":0,"includeSnapshot":false}}
```

`session/fork` 支持 message、checkpoint 和默认 latestCheckpoint 目标，以及可选 `expectedRevision`。结果包含 `forkedSessionId/parentSessionId/targetMessageId/targetCheckpointId/response/snapshot`，见 [目标与分叉 schema][fork-schema]。此 legacy 入口可能涉及工作区文件回退，不能据一次 legacy 测试宣称覆盖桌面 V4 stable fork。

`session/subscribe` 的 deliveryKind 可用 `desktop-continuous` 或 `web-remote-replayable`，见 [deliveryKind 定义][delivery-kind]；它可以通过 `afterSeq` 获取缺口。实时通知为 `session/event`。原始 `SessionForked` 在 legacy mapper 中落到 **`type:"session.updated"`**，payload 保留原始字段，不能等待一个并不存在的 `type:"session.forked"`，见 [payload 映射，395–426 行][payload-map] 与 [type 映射，1478–1528 行][type-map]。

Host 的旧事件面为 `zcode-agent.onDynamicSessionEvent()`，参数含会话目标、deliveryKind、afterSeq 与 includeSnapshot；Host 会转成 CLI `session/subscribe` 请求，见 [Host 接口，339–346 行][host-subscribe] 与 [转发，4818–4842 行][host-subscribe-send]。当前公共 `connectHost()` 包装只暴露 call/probe/close，没有 listen，见 [gateway-client.mjs，52–59 行](../../suian-zcode-common/gateway-client.mjs#L52-L59)。需要事件观察时不能声称现有包装已经提供订阅，更不能把新观察通道称为 fork 快照 Hook。

隔离运行时还需核对以下实际路径，不能只替换数据库：

- CLI 支持 `app-server/agent-server` 命令分支，见 [run.ts，537–545 行][cli-command]；具体二进制与安装包依赖需由运行时验证确认。
- 存储 override 为 `ZCODE_STORAGE_DIR` 与 `ZCODE_SESSION_DB_PATH`（或 `ZCODE_SESSION_DB`），见 [env-config.adapter.ts，24–32 行][storage-env]。
- `ZCODE_DATA_BASE_DIR` 影响 provider 的 v2 基目录，见 [provider-runtime-env.ts，58–81 行][provider-env]；它不能独自证明所有用户配置隔离。`createConfig()` 默认仍加载用户配置，见 [config-factory.ts，135–138 行][user-config]，应同时核实隔离的 homedir、cwd 与数据库绝对路径。

## 对 #27 的建议与未验证项

**把“精确的 fork 状态继承”保留为前置能力问题**。上游最小能力需明确：分叉操作绑定哪份外置工件 revision，插件能取得 parent/child ID，以及 child 首次使用状态前如何等待继承完成。普通通知和首次启动读取都不满足这三个条件。

如果以后限定所有分叉经插件控制，插件可以在自身操作边界冻结修订并建立父子映射；这会缩小对原生 UI 分叉的覆盖，需独立产品决策，本轮不实施或默认为用户已接受。

本轮成功标准已完成：读取安装包相关函数与相邻调用、固定哈希与字节偏移、对照公开 Hook/分叉/事件契约、识别时序缺口。**未完成的验证**是隔离 CLI 的实际 fork 与事件订阅、插件 Hook 触发记录、真实 Host/桌面分叉行为。静态核查不替代这些验收。

[hook-enum]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/contracts/src/hooks/index.ts#L7-L15
[hook-source]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/adapters/src/plugins/hook-sources.ts#L129-L142
[hook-start]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/core/src/runtime/methods/hooks.ts#L20-L47
[hook-input]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/contracts/src/hooks/index.ts#L67-L131
[stable-commit]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/core/src/runtime/methods/session-fork.ts#L737-L796
[legacy-fork]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts#L2229-L2249
[register-child]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts#L2274-L2326
[event-sinks]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/core/src/runtime/methods/events.ts#L528-L546
[subscribe-schema]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/shared/src/zcode-protocol/index.ts#L1497-L1513
[fork-schema]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/shared/src/zcode-protocol/index.ts#L1788-L1828
[plugin-load]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/contracts/src/plugins/index.ts#L248-L256
[plugin-host]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/cli/src/plugin-host-command.ts#L49-L63
[fork-event]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/contracts/src/events/session.events.ts#L198-L207
[event-append]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/core/src/runtime/methods/events.ts#L103-L109
[event-forward]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts#L3047-L3082
[resume-hook]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/core/src/runtime/methods/resume.ts#L253-L261
[v4-fork]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/fork-edit-retry.ts#L276-L309
[v4-register]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/v4-bridge.ts#L1189-L1209
[v4-register-failure]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/v4-bridge.ts#L540-L568
[request-schema]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/shared/src/zcode-protocol/index.ts#L286-L293
[delivery-kind]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/shared/src/zcode-protocol-legacy-types.ts#L14
[payload-map]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-mapper.ts#L395-L426
[type-map]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-mapper.ts#L1478-L1528
[host-subscribe]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/services/src/zcode-agent/zcodeAgent.ts#L339-L346
[host-subscribe-send]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/services/src/zcode-agent/zcodeAgentService.ts#L4818-L4842
[cli-command]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/cli/src/run.ts#L537-L545
[storage-env]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/adapters/src/config/env-config.adapter.ts#L24-L32
[provider-env]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/cli/src/provider-runtime-env.ts#L58-L81
[user-config]: https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/adapters/src/config/config-factory.ts#L135-L138
