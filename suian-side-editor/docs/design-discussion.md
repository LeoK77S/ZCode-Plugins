# suian-side-editor 首版设计澄清

日期：2026-10-12。阶段：用户已确认最终共识并批准规格、票粒度及发布，11 张 GitHub Issues 已创建；尚未实现运行代码。本地规划从 dev 基线 `403f877` 开始。

## 已确认的目标

- 新建独立插件 `suian-side-editor`。真实可复用的基础能力放在 `suian-zcode-common`，具体抽取边界在规格中明确。
- 第一版提供文本编辑器，编辑当前本机工作区内已有的 UTF-8 文本文件，例如 Markdown、代码和 TXT；不含 PPT 编辑。
- 选区与评论完整进入当前主对话的上下文附件；用户在主对话正常发送并接收模型回复。没有辅助问答或插件内聊天。

## 已确认的布局与文件页签

插件侧栏页面的主体为编辑器。顶部文件夹按钮开关右侧文件子侧栏，点击列表文件后在编辑主区域显示正文。

文件列表使用按需展开的目录树，不隐藏 node_modules。规格没有新增其他目录过滤规则。

右侧列表占用自己的宽度，编辑主区域使用其余宽度；主区域的居中以扣除右侧列表后的可用宽度为准。文件页签位于插件内部顶栏，不使用 ZCode 外层原生页签。

- 单击文件：临时打开，文件页签标题使用斜体。
- 同时只有一个临时页；后续单击可替换未编辑的临时页。
- 双击文件：固定打开，标题使用正体。
- 首次编辑临时页：自动固定，不被下一次单击替换。
- 关闭有未保存编辑的内部文件页签时，提供“保存并关闭／放弃修改／取消”。关闭整个原生插件面板依靠恢复副本，不承诺拦截宿主关闭。

## 已确认的保存与恢复

- 内部 UI 可以选择自动或手动保存，首次默认为手动。
- A 会话改变模式时，持久化 A 的选择并更新全局默认；已有 B 会话保持自己的选择。
- 新会话首次使用编辑器读取最新全局默认；重开 A 恢复 A 的选择。
- 自动模式：停止输入 800 ms 后保存；切换内部文件页签时立即尝试保存；从手动切换为自动时保存已有未保存内容。手动模式通过保存按钮或 Ctrl+S 写回。
- 关闭重开恢复文件页签、未保存正文、当前页面和各文件阅读滚动位置。
- 主对话模型或外部编辑器修改当前文件时：没有未保存编辑则自动刷新；存在未保存编辑则保留本地正文、提示冲突、暂停自动写回。

保存原文件和保存恢复副本是两件事。已批准规格采用插件自有 SQLite，并以持久化回执确认恢复副本已同步，见 [ADR 0004](adr/0004-editor-owned-sqlite-state.md)；不将宿主内存 widgetState 当作重启恢复保证。

## 已确认的评论数据

每条评论完整保存以下核心信息；胶囊摘要可简短，实际附件不能省略它们。

| 信息 | 字段 |
| --- | --- |
| 文件路径 | sourcePath |
| 文件标题 | sourceTitle |
| 起止行号 | startLine、endLine |
| 所选正文 | selectedText |
| 评论内容 | comment |

来自未保存编辑的选区允许评论，但须明确标记“包含未保存编辑”。数据还需要评论标识及正确工作区、会话归属；具体插件结构在规格阶段确定。

评论保持创建时的行号、所选正文和未保存标记，作为固定快照；继续编辑文件不改写已创建的评论。

接受宿主现有聚合形式：主输入区上方一个插件上下文胶囊，展开后含各条完整评论。它等待用户发送；发送结果仍在主对话。

发送受理后主对话胶囊自动清除，包括正常排队受理；发送失败或被阻止时保留。产品流程不要求用户另行手动清空插件评论列表。后续创建评论不得重新带入已发送的旧评论。插件缓存可按精确批次在权威 userInput 或 queue 中确认受理，仍需集成验证；不能把缺少反向通知直接解释为必须增加手动清空步骤。

首版必须与原生保持一致：发送等待期间允许继续添加选区评论；成功只清理本次提交的旧评论，新评论留给下一条消息。这是首版必验项，接口验证失败时明确报告阻塞，不自动降低要求或转为后续特性。

原生只读评论的完整字段与模型正文见 [CodeCommentPayload](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/lib/codeCommentContext.ts#L6-L25)、[序列化](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/lib/codeCommentContext.ts#L124-L155)。插件胶囊默认只渲染 label 和 text，不能假定 structuredContent 自动按原生评论布局显示，见 [插件胶囊](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/PluginUiModelContextChip.tsx#L38-L48)。

## 宿主事实与验证前置

以下为官方 `aac4755` / 3.15.1 源码核实，尚未进行新编辑器的真实运行验证。

1. 插件 UI 的 hostContext 不包含 sessionId 或 workspacePath。页面调用工具时由宿主绑定归属，适配器可以提供 session_id，但 UI 调用不保证提供 workspace_path。工作区定位必须结合经核实的启动环境，并通过只读 context 工具返回页面，不能信任页面随意填写目标路径或会话。
2. 页面不能取消关闭原生面板；teardown 默认 500 ms，失败或超时也继续释放。内部文件页签关闭可以由插件处理，但整个面板的恢复副本必须在编辑过程中保存。
3. widgetState 是 Renderer 内存状态，离屏页面可能回收，应用重启清空；插件自行承担要求的持久化恢复。
4. 同一页面 updateModelContext 使用固定 context ID，更新会替换同一聚合胶囊。主对话删除胶囊或成功发送后清理胶囊，没有反向通知插件。不能自动声称插件评论已发送或据此删除其列表。
5. 主对话发送期间若插件替换同 ID 胶囊，宿主成功清理仍按 ID 删除；新更新不保证保留。评论提交和清理规则必须体现这一公开接口边界。
6. 插件 structuredContent 的完整 JSON 会进入提交正文，可以自带 batchUuid 和 commentIds。v4 userInput 与 queue 都保留实际正文；因此常规顺序流程可按精确批次确认受理并清理插件缓存，不需要等待模型结束。发送期间替换同 ID 胶囊的原子性仍需上游能力支持。

来源：[hostContext](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/domain/buildPluginUiHostContext.ts#L10-L47)、[UI 工具调用](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts#L503-L511)、[请求元数据](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/mcp/index.ts#L2291-L2313)、[本地胶囊状态](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiModelContextEvents.ts#L48-L65)、[发送后清理](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L1503-L1525)。

批次关联的具体来源与未验证边界见 [ADR 0003](adr/0003-comment-snapshots-and-main-composer.md)。

## 编辑器选型勘察（已批准规格采用，尚未实施）

CodeMirror 6 提供浏览器文本编辑、选区访问、1-based 行号与自定义行号栏，可用于选区评论。文件页切换的内存滚动快照可以利用 EditorView.scrollSnapshot；跨重启恢复仍需保存可序列化的位置，而不是保存该临时 effect 对象。

来源：[选区与正文访问](https://github.com/codemirror/website/blob/main/site/docs/migration/index.md)、[自定义行号栏](https://github.com/codemirror/website/blob/main/site/examples/gutter/index.md)、[滚动快照](https://github.com/codemirror/view/blob/main/_autodocs/api-reference/editorview.md)。具体依赖版本、构建入口与持久化位置须在实施前核实。

## 澄清轮次

### 第一轮：已确认

| 问题 | 用户决定 |
| --- | --- |
| Q1 文件页签位置 | 插件内部顶栏 |
| Q2 首版文件范围 | 本机工作区已有 UTF-8 文本文件；远程与文件管理后续开特性票 |
| Q3 保存方式 | 自动、手动可切换；持久化并更新全局默认，不改变其他已有会话 |
| Q4 临时页替换 | 一个临时页，首次编辑自动固定 |
| Q5 主对话胶囊 | 接受聚合形式，每条数据完整 |

### 第二轮：已确认

| 问题 | 用户决定 |
| --- | --- |
| Q6 模式生命周期 | 新会话继承默认，已有会话独立，重开恢复；首次手动 |
| Q7 未保存内容评论 | 允许，并标记未保存 |
| Q8 恢复范围 | 页签、未保存正文、当前页面和阅读滚动位置 |
| Q9 外部文件修改 | 无未保存编辑自动刷新；有未保存编辑保留并提示冲突 |

### 第三轮：产品行为已确认，缓存同步待技术核实

| 问题 | 用户决定 |
| --- | --- |
| Q10 评论清理 | 使用正常主对话的发送后自动清理体验，不增加必须手动清空的操作；插件缓存同步待技术核实 |
| Q11 内部页签关闭 | 未保存时提供保存并关闭／放弃修改／取消 |
| Q12 评论随编辑变化 | 保持创建时的行号、正文与未保存标记快照 |

### 第四轮：全部已确认

| 问题 | 用户决定或追问 |
| --- | --- |
| Q13 发送期间追加评论 | 核实原生后，用户确认首版必须与原生一致；旧发送只清理旧评论，新评论保留，不能自动降级 |
| Q14 文件列表 | 目录树，不过滤 node_modules |
| Q15 自动保存触发 | 接受停止输入 800 ms、内部切页立即尝试保存、切换自动模式时保存已有修改；冲突时暂停自动写回 |

原生实现允许在提交请求等待响应期间继续添加选区和代码评论。发送时捕获本次附件集合，成功后按其中各个 ID 删除；新添的不同 ID 保留给下一条消息。模型继续运行与提交请求等待响应是两个阶段；前者不意味着后续草稿必须禁用。

插件胶囊的视觉聚合不是问题；同一页面的固定 context ID 才是并发清理差异。实现可行性必须验证当前公开接口是否能保持原生的“只清理已提交附件”语义。探针关闭或调研完成不能单独解除这个能力前置条件。

来源：[编辑与发送控制](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L2400-L2418)、[时间线选区入口](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/SessionPane.tsx#L5698-L5711)、[Markdown 选区入口](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/MarkdownSelectionTooltip.tsx#L55-L103)、[评论生成独立 ID](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/PreviewPane.tsx#L711-L758)、[只删除本次提交附件](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L1512-L1520)。以上为源码核实，不代表新插件已通过真实宿主验证。

外部冲突沿用 Q9 已接受的行为：保留本地正文并暂停自动写回，由用户选择重新读取或保留编辑。具体实现不得悄悄覆盖磁盘修改。恢复副本确认方式、评论同步的运行验证、编辑器库及共享模块选择由代码与宿主事实核实，不让用户代答可检索的事实。

## 最终共识摘要（用户已整体确认）

1. 独立 `suian-side-editor`，首版编辑本机工作区已有 UTF-8 文本；远程与文件管理后续开特性票，PPT 不计入首版。
2. 编辑器占侧栏主体，顶部按钮开关右侧目录树，node_modules 可见；主区域按剩余宽度居中。内部页签单击临时斜体、双击固定正体，首次编辑自动固定。
3. 手动保存为初始默认；自动模式停止输入 800 ms、切页或切自动模式时尝试保存。模式按会话持久化，同时更新新会话的全局默认。
4. 关闭重开恢复页签、未保存正文、焦点页面和阅读位置；内部关闭未保存页提供三种选择。外部修改无未保存内容时刷新，有未保存内容时保留并提示冲突、暂停写回。
5. 评论保存完整路径、标题、起止行号、选文、评论和未保存标记，采用创建时快照；通过聚合胶囊进入主对话。成功自动清理、失败保留；发送期间新添评论必须保留给下一条消息，不增加辅助问答或手动清空步骤。

宿主能力调查和运行验证继续是工程工作。产品目标已明确不等于实现可行性已经证明。

## 后续待做特性

- 远程工作区文本编辑：在首版之后开特性票，范围和 Host 文件读写路径另行核实。
- 文件管理：新建、重命名、删除文件，在首版之后开特性票；不得默认纳入首版实施。

## 开票与实施入口

最终共识、[首版规格](text-editor-spec.md) 与 [票粒度](text-editor-tickets.md) 已获用户批准，并授权发布 11 张 Issues。公开规格见 [#40](https://github.com/ONEGAYI/ZCode-Plugins/issues/40)。后续发布仍遵循 [开票约定](agents/issue-tracker.md)；工程实现、推送与正式合并遵循当前会话授权及根规则。

已接受的架构方向见 [ADR 0001](adr/0001-independent-side-editor.md)、[ADR 0002](adr/0002-session-settings-and-recovery.md)。规划文档不代替集成验证或用户验收。
