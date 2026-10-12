# ZCode-Plugins 开发术语表

ZCode 会话工具 monorepo（自动命名插件、会话操控 MCP、公共层）的核心术语与边界。本文面向开发者维护词汇一致性；给 Agent 的操作入口与流程见各 SKILL.md，两者职责不重叠、内容允许重复。

## 原生插件与公共包

**原生插件**：由 ZCode 加载 .zcode-plugin/plugin.json 及标准 skills、hooks、MCP 组件的安装单元。市场 dependencies 负责下载依赖，不自动执行 npm 或系统初始化，也不强制依赖永久启用。

**公共包入口**：link.mjs 维护的稳定目录链接，业务插件按 Node 包名 suian-zcode-common 导入。它共享一份实现，不是第二个常驻进程；更新入口后运行中的模块缓存仍需重载。

**技能拆分**：setup 负责安装与迁移，configuration 负责配置，debug 负责诊断；命名 control 与 MCP sessions/glm 负责日常业务。根 SKILL.md 只为源码兼容安装路由。

## 标题策略

**固定（lock）**:
把某会话的公共标题策略置为 locked:true，命名插件此后跳过该会话的自动命名。不改标题本身。
_Avoid_: 锁定（与手动保护混淆）、置顶、pin

**解除固定（unlock）**:
把公共标题策略置为 locked:false，恢复滚动命名。写策略文件而非删除它。
_Avoid_: 解锁

**公共标题策略（title policy）**:
两个插件共享的跨进程约定，存于 `~/.zcode/tools/suian-zcode-common/session-titles/<session_id>.json`（v1：`{version,locked}`）。写入入口：命名插件 CLI 的 lock/unlock、app-mcp 创建会话的 lock_title 参数。
_Avoid_: 会话锁、命名开关（与全局 enabled 混淆）

**手动保护（manual guard）**:
无公共策略时，命名轮从"标题相对基线变化且来源非 generated"推断出的旧式锁定，存于命名插件 `.local/<session_id>.json`。删除该状态文件即解除，但它解除不了公共策略的锁。
_Avoid_: 手动锁定（与固定混淆）、旧锁

**滚动命名（rolling rename）**:
默认命名行为：每轮 Stop 对照内容指纹与现有标题，内容变了才调模型演进标题，不逐轮翻新。

**存在性校验（existence check）**:
lock/unlock/policy 写或查策略前，确认目标 session_id 在 CLI 会话库或任务索引中真实存在（任一命中即存在）；查不到即报错退出，不静默写策略。

## 工件区

**工件引用（artifact reference）**:
工件区中由 `kind/ref/label/purpose` 描述的资源定位记录，kind 固定为 pr、session、file、link 四类。Agent 按后续用途管理引用的生命周期。
_Avoid_: 文件正文、聊天摘要、待办事项（这些不等同于工件引用）

**工件区（artifact zone）**:
每个会话独立持有、通过 get_artifacts 读取、由增量 set_artifacts 维护的工件引用集合。存储不设置数量或完整表示字符数上限；自动注入的工件简表另受 20 条/9000 字符限制。两个工具只操作宿主上下文确定的当前会话；真实状态单独持久化，分叉时继承所选历史断点后各自维护。get 省略 ref 返回列表，填写 ref 返回单条详情；GUI 与模型共用详情入口。
_Avoid_: 全局附件列表、工作区共享工件库

**工件 demo（artifact demo）**:
允许简略工件摘要在运行时上下文中累积的阶段性交付；用户提交时生成摘要，工具回执更新统计，get_artifacts 每次读取最新真实状态，并包含原生工件侧栏。分叉按所选已完成生成轮的历史快照继承；完整版唯一投影留待上游。原版工具、历史断点与侧栏已实施并通过 3.15.1 隔离验证；开发分支新增详情交互的验证边界见工件规格。

**简略工件摘要（artifact summary）**:
在用户提交时生成的自动上下文，包含登记入口、分类统计和最多 20 条的部分简表，整体最多 9000 个 Unicode 码点。简表按更新时间选择，各非空类别有最多 3 条保底，字符不足时至少保留各类最新 1 条；裁剪不改变工件存储。允许历史摘要在运行时上下文中累积；工具回执更新当前统计，get_artifacts 每次读取最新 revision 与完整工件列表。
_Avoid_: 最新完整工件列表、唯一状态投影

**工件状态投影（artifact state projection）**:
完整版的目标：由当前会话工件状态生成、在每个模型请求的 messages 数组末端附加的临时上下文，完整投影最多 12000 个 Unicode 字符。同一请求只含一份自动投影；投影不写入 ZCode 聊天历史，也不提交 Git，工具调用记录及正常聊天仍按原有机制保留。完整版继续等待上游，demo 的简略工件摘要不受这项唯一性约束。
_Avoid_: 历史消息、持久化工件状态、一次性 Hook 提醒

**工件状态版本（artifact revision）**:
与工件状态一起读取的版本号。增量 set 必须携带读取时的版本，服务在同一原子更新中检查版本与保存新状态；版本冲突时拒绝覆盖。

**分叉工件副本（forked artifact snapshot）**:
分叉时读取父会话所选历史完成轮的工件快照，作为子会话独立初始状态。分叉后的父子会话互不自动同步；恢复和压缩保留自身状态，回退聊天不自动回滚工件。工件时间与创建关系保留，但会话方向以当前持有者判断。

**轮结束工件快照（turn-end artifact snapshot）**:
在同步 Stop Hook 中预先保存的不可变工件版本，由插件自有 SQLite 保存并映射到父会话和对应完成消息断点。分叉子会话按选中历史断点读取该版本；同轮多次 Stop 各绑定实际消息，无变化内容可以复用快照但仍登记断点。该接入已实施并通过契约测试与 3.15.1 隔离 Desktop 验证。

**工件继承缺失（snapshot_missing）**:
原生分叉的目标断点没有工件快照时给出的明确诊断。不复制父最新状态，不把空集合称为准确继承；保留子会话，且不阻断该分支或子会话后续的工件读写。

demo 工具、摘要、历史断点和原生侧栏已实施；开发分支增加分组详情、服务记录时间与自动创建关系。完整版唯一投影继续等待上游。交付规则见 [工件区规格](suian-zcode-app-mcp/docs/artifact-zone-spec.md) 和 [ADR 0002](suian-zcode-app-mcp/docs/adr/0002-artifact-demo-summary.md)。
