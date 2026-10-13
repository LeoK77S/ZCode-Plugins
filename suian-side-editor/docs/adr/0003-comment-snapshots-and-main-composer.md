# 评论保留创建时快照，采用正常主对话发送与清理体验

**状态**：2026-10-12 已接受评论快照、正常主对话发送清理及首版并发追加行为。原生发送期间可追加附件已核实；插件常规缓存同步已有源码支持的候选方案，尚待集成验证。并发能力是必须满足的前置条件，不宣称整条链路已实现。

## 背景

评论来自可继续编辑的文本页面。用户要求路径、行号、所选正文和评论完整进入主对话，回复也留在主对话；发送后的清理应沿用正常聊天体验。

宿主在主对话提交成功后删除本次捕获的插件上下文胶囊，但没有直接通知插件清空其缓存。此接口边界不能被混同为“主对话胶囊不会自动清理”。

来源：[成功发送后的胶囊清理](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L1503-L1525)、[本地上下文删除](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiModelContextEvents.ts#L60-L65)。

## 决定

- 每条评论保留创建时文件路径、标题、起止行号、所选正文、评论及未保存标记。
- 后续编辑不改写已创建的评论快照。
- 主对话发送成功后清除评论胶囊；失败或被阻止时保留，用户可以继续正常处理。
- 不要求用户为完成发送另行手动清空插件评论列表，不增加辅助问答或插件内回复。
- 下一次评论不得自动重新带入已经发送的旧评论。
- 首版允许发送等待期间继续添加评论；旧发送成功时只清理旧评论，新增评论保留给下一条消息。接口验证不通过时明确阻塞，不自动降级或转为后续功能。

## 影响与待验证条件

原生输入框的附件状态与插件缓存不能假定自动一致。必须核实可用于确认提交的公开信息及评论批次关联方式，覆盖追加多条评论、发送后继续评论、发送失败后重试和发送过程中更新。

### 常规同步的候选方案

插件在 structuredContent 中写入明确的 batchUuid 和 commentIds；宿主将完整 JSON 序列化进正常发送正文。公共 Host 连接只读订阅当前会话，在权威 queue 或 real-user userInput 中按会话、插件、批次和评论 ID 集合精确确认受理，移除该批旧缓存。

正常发送可能排队，应确认 queue 的受理而不是等待模型完成或出队。排队受理与已经生成持久 user 消息是不同事实。重复帧和重连快照按批次幂等确认。

来源：[完整结构序列化](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/domain/pluginUiModelContext.ts#L34-L85)、[会话订阅](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/zcode-agent/zcodeAgentConnectionScope.ts#L812-L855)、[实际用户正文](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts#L2120-L2146)、[队列正文](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts#L3639-L3654)。

此方案需要真实隔离集成验证，不以固定延迟、模型运行状态或最近消息推测受理，也不增加用户必须手动清空的步骤。

### 原生如何处理发送期间追加

提交请求等待响应期间，Composer 的 pending 只禁再次提交，不统一禁止草稿编辑；主时间线选区、Markdown 选区与代码评论入口均没有按 pending 禁用。代码评论每次生成独立 ID。

发送开始捕获本次评论和选区数组，成功后按捕获的各条 ID 删除，等待期间新添的不同 ID 仍保留。因此原生可以在发送期间继续选中文本并添加附件；胶囊聚合显示不影响各条独立身份。请求响应后模型继续运行是另一阶段，后续草稿仍可继续准备。

来源：[编辑与提交门禁](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L2400-L2418)、[选区门禁](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/SessionPane.tsx#L5698-L5711)、[Markdown 选区](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/MarkdownSelectionTooltip.tsx#L55-L103)、[评论新 ID](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/PreviewPane.tsx#L711-L758)、[逐条清理捕获 ID](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L1512-L1520)。

### 插件同一胶囊的并发清理边界

发送开始捕获旧 context；发送成功后仍按相同 context ID 清理。期间同页新发布的聚合内容可能被这次旧发送一并移除。只读 Host 订阅不能原子控制 Renderer 清理时序；持续重发或固定延迟不能给出完整保证。

现有同页 updateModelContext 路径无法直接沿用原生独立附件 ID。按捕获版本清理或可关联批次的提交／清理回执可解决这个边界；是否另有可用的公开接入路径仍须验证。Q13 已确认并发追加是首版必验项，不以固定延迟或当前限制代替原生语义，不默认将该要求降为后续票。

可先准备并验证不依赖此能力的文本编辑、保存与恢复路径；评论完整验收和首版完成声明仍被该能力条件阻塞。若当前接口不满足，记录具名能力缺口及上游接入需要，不能以“调研已完成”将实现票标为就绪。
