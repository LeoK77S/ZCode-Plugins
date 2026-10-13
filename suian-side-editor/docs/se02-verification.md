# SE-02 主 Composer 接入验证

2026-10-12 UTC，测试跨至本地 2026-10-13。对象为 Desktop `3.15.1.8093`、内置 CLI `0.16.9`。**完整诊断字段进入真实主对话、正常清理及模型运行中的排队受理已实测；H3 仍未满足**。发送尚未返回期间追加内容的确定性场景，没有找到满足契约的公开控制入口。SE-06／07／08 的 H3 条件继续阻塞；本票调查完成不等于 Issue 关闭或用户产品验收。

## 实际运行对象

本票使用新 SE-02 专用工作树；临时 marketplace、插件、脚本和原始证据均位于该树 `.scratch/`。生产只读插件、common、安装包和 sources 没有修改。临时页面只用公开 SDK `updateModelContext`，不实现 SE-06 评论业务，也没有文件工具。

原第四次测试实例的 GUI、Host 和控制器 PID 均已不存在，网关和 CDP 拒绝连接；原 TTY session 也不可用。旧控制器尾部仅启动两行，未看到 finally 收束输出；Desktop 尾部没有退出信号。CLI 的 workflow service closed 发生在已知 B2 读取成功之前，不能解释后来的退出。**退出原因未知**。首个安装探针因此在 `connectHost` 健康检查阶段失败，尚未调用安装接口，不能据此判宿主接口缺失。

第五次 GUI 由根协调任务启动并持有控制器。原装 EXE／ASAR／CLI 的版本和 SHA 与 SE-01 一致，白名单环境与原合成 profile 保留，直接打开工作区 B；网关和模型只绑定 localhost。启动前新鲜核对 Directory／Drive 两组 Explorer 菜单共八项类型及逐字值，语言为 zh-CN；启动后八项与启动前完全一致。没有恢复未知注册值或修改安装包。

根任务已在脚本的配置断言前移修改之前加载 launcher。实际配置验证通过；后保存的脚本字节不冒充已加载版本的精确快照。此生命周期调整不作为第四次实例退出原因的推断。

## 公开诊断插件与身份

公开 `zcode-agent.addPluginMarketplace` 加入本地临时 marketplace，`installPlugin` 安装单个诊断插件，`listPlugins` 与 `plugin-ui-bridge.listSurfaces` 均确认其可用，diagnostics 为空。虽然请求 scope=workspace，实际安装回执为 scope=user；缓存和配置仍明确归属于隔离 profile，不涉及真实用户设置。

插件有一个 session surface `probe`，资源来自新树的诊断 stdio 服务。实际页面通过原生侧栏选择，MCP 日志记录连接成功、toolCount=0；资源烟测也通过。页面没有调用模型或文件工具，发布上下文无需代理代点工具审批。

诊断数据含 commentId、workspaceIdentity、sessionId、sourcePath、sourceTitle、startLine、endLine、selectedText、comment、containsUnsavedEdits 十个字段。字段来自受控任务与合成数据，完整路径指向隔离工作区；**这是传输探针，不替代正式评论的服务端可信绑定或选区快照实现**。

## 首次失败与夹具修正

公开 `zcode-task.createTask` 创建的空 build 任务可选中、可打开 surface，也能发布 A。原生“插件上下文”胶囊悬停／点击显示 tooltip，完整 JSON 明细包含全部十个字段；不是原生评论专用布局。

15:43:05.527Z，第一次 Native 发送 A 被拒绝。页面显示“发送失败，请稍后重试”，详情为 `fault.command.executionFailed`；A 胶囊与输入正文仍在。15:43:05.581Z CLI 日志对应 `zcode_protocol.v4.gateway_error`，scope=`v4.command.execute`，error=`FOREIGN KEY constraint failed`。创建时还有同任务的 model selection FK 失败和 hydrate 的 persisted parent 缺失。模型 endpoint 请求为 0：**这是实际提交命令失败，不能算正文已提交，也不能算模型执行失败**。

不写 SQL 或修宿主。改用公开原生“新建任务”，在 Composer 选择已存在的工作区 B、已知合成 Provider 和关闭思考。15:49:51.943Z 仅发送一次无评论的初始化 prompt；实际用户正文和合成回复出现。当前 Native task-item 的明确身份与公开 `getTaskSnapshot` 对应，随后用这个实际 SID 重新生成 A。初始化请求单列，不与 A 评论提交混计；旧失败任务、A 和错误证据保留。

## 成功提交与排队

| 场景 | 实际结果 |
| --- | --- |
| A 发布 | 15:52:33.350Z 页面按钮发起 SDK update，15:52:33.354Z 正常完成 |
| A 正常发送 | 15:52:48.299Z Native Composer 点击；15:52:48.420Z 本地主 turn 收到完整 A，当前最后 userInput 与诊断文本逐字匹配；公开持久快照也匹配，胶囊自动清理 |
| 运行夹具 | 15:56:18.037Z 发送一次无评论占位 prompt；合成服务器只暂停模型 completion，Core admission 没有被扣住 |
| 运行期间准备 B | 15:57:03.445Z SDK 发布 B；Native 仍有“停止生成”，公开 snapshot activeTurnKind=regular |
| B 排队受理 | 15:58:05.994Z Native 的“加入队列”按钮发送 B；15:58:24.754Z 出现待发送队列项，输入与胶囊已清理，模型仍在 hold，模型计数仍为 4 |
| B 实际出队 | 释放合成 completion 后，15:58:25.081Z 本地主 turn 收到完整 B，当前最后 userInput 无 A；公开快照有对应正文，胶囊保持清理 |

模型总请求为 **5**：初始化主 turn 1、明确 title-generation 指令的标题请求 1、A 主 turn 1、无评论运行夹具主 turn 1、B 主 turn 1。全部进入自有 loopback Provider。标题请求未声明 stream；其余四条为 stream=true。原 H1/H2 的模型请求 0 属于原冻结时点，没有回写。

“B 不含 A”检查针对本次最后 userInput／评论内容。整个模型请求含正常聊天历史，旧 A 仍可存在于历史，不能把历史保留认作评论复活。

模型运行期间准备和排队已验证。**模型 completion hold 不控制 Composer 受理或 V4 ACK**，因此这组成功不证明“发送未返回时追加 B”的并发清理安全。legacy task snapshot 的 pendingCommands 为空也不代表 Native 队列不存在；队列观察与该字段分开留证。

## 同页替换与反向反馈

同一 surface 在草稿先发布 A，再发布 B。主 `plugin-ui-model-context-chip` 始终一枚，tooltip 变为完整 B，不含 A。16:03:43.343Z 通过原生按钮删除本探针胶囊后主 chip 为 0，模型计数仍为 5。

成功发送自动清理后，以及这次原生删除后，页面 subscribe 记录只有初始 notification、ready 和页面主动 update-request／update-result，没有 context 消费或删除反馈。该观察限于此页面公开 facade；源码核对也未发现发送清理通知。实际 alias 接受 `{content, structuredContent}`，但将 SDK 回执转为 void：页面 Promise 正常完成的 value type 为 undefined，不能当作消费批次 ACK。

Native 实测证明一枚胶囊的同页替换，不冒称直接读取 Renderer 内部 ID。固定 ID 的精确生成式、同 ID 替换和按 ID 清理来自已核对的公开源码及相同安装产物，见 [接口研究](main-composer-context-research.md)。原生删除只是反馈探针，不用手动清空充当产品完成方案。

## H3 缺口与完成边界

具名缺口如下：

- `fixed_surface_context_id_without_revision`：页面 batchUuid/commentId 不改变宿主附件 ID；旧成功清理按捕获 ID 删除，未核对 revision。
- `no_correlated_context_consumption_receipt`：更新只有设置完成回执，页面缺少关联到提交／删除批次的消费通知。
- `no_verified_public_admission_hold_release`：已核实公开接口范围内未找到可控 admission gate；V4 ACK 在 Core admission 后立即返回。模型／SessionStart 延迟、发送前权益推荐框均不能代替这个控制点。

没有执行不可控竞态碰运气、禁用追加、定时重发或私有 handler／DOM 补丁。A 等待返回时追加 B、失败时 A/B 并存、重连重复帧幂等及精确缓存消费仍未形成满足契约的证据。只读 snapshot 和实际 userInput 证明普通提交，不证明 Renderer 并发清理原子性；没有扩展 common 订阅。

本轮新增的是临时诊断与脱敏文档，未改变持久生产行为，因此不以 observer 修正宣称生产 TDD 红绿。诊断资源烟测、真实 UI／HTTP／公开快照断言、JSON／链接／脱敏和日志 SHA 检查分别记录。观察脚本曾出现文本替换、JSON 转义路径和 tooltip 复制按钮定位错误；均保留首次日志，修正后只消费对应状态，不循环重发生产操作。

总摘要见 [SE-02 JSON](se02-evidence.json)。原始日志、fixture 和脚本在新树忽略目录内；活动日志采用冻结副本，转移清单排除活动源。根任务继续持有 GUI／Host／网关／合成 Provider，未停止或归档；后续原生测试串行复用。

## 固定来源

并发边界已核对官方 3.15.1 / aac4755：[固定 surface ID](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiInteractions.ts#L88-L103)、[同 ID 替换／删除](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiModelContextEvents.ts#L50-L64)、[等待受理后清理](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L1503-L1525)、[SDK 空回执](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/app/pluginUiInteractionPorts.ts#L96-L110)。安装产物 SHA 与原始运行证据的归属在 JSON 中分别记录。
