给 ZCode 做的插件与公共工具集合。ZCode 是智谱推出的 Agentic Coding 工具（桌面端 + CLI），这个仓库放会话自动命名插件、会话 MCP、本机侧栏文本编辑器，以及业务插件共用的基础能力。

## 原生插件安装

仓库的 [marketplace.json](./marketplace.json) 提供四个原生插件并登记各自版本。公共插件是三个业务插件的依赖，自动命名、会话 MCP 和文本编辑器可分别选择。

| 插件 | 独立技能 |
| --- | --- |
| suian-zcode-common | setup、configuration、debug |
| suian-zcode-title | setup、configuration、control、debug |
| suian-zcode-app-mcp | setup、configuration、sessions、artifacts、glm、debug |
| suian-side-editor | setup |

在 ZCode 桌面端按以下步骤安装：

1. 打开左侧栏的 **插件市场**，点击 **添加** → **插件市场**，填入本仓库的 GitHub 地址：[https://github.com/ONEGAYI/ZCode-Plugins.git](https://github.com/ONEGAYI/ZCode-Plugins.git)。
2. 添加成功后，安装所需的业务插件：`suian-zcode-title`、`suian-zcode-app-mcp` 或 `suian-side-editor`。它们会自动安装公共依赖 `suian-zcode-common`。
3. 安装完成后，**新开一个对话**，发送下面的提示词：

   ```text
   帮我配置已安装的 suian 插件
   ```

安装任一业务插件会自动安装 common；已有显式停用状态仍会保留。市场安装只获取插件代码，依赖和配置由 Agent 按各插件的 setup 技能完成。只使用文本编辑器时无需初始化远控网关；`0.2.0` 在编辑、保存和恢复之外增加选区评论。评论另需既有网关与 Desktop 远控连接，采用发送状态尽力保护，原 #47 缓存缺口及最终可见 guest 验收仍未通过。

公共代码经一个稳定目录入口共享；业务插件不复制实现。个人配置与状态留在版本缓存外。原生 Hook/MCP 由宿主加载，迁移旧源码安装时只清理对应的旧全局注册，保留其他配置。具体步骤见各插件的 skills/setup/SKILL.md。

三插件封装、宿主隔离安装与技能发现的验证结果见[脱敏验证记录](./suian-zcode-app-mcp/docs/native-plugin-evidence.json)。该记录区分本轮已执行的检查与尚未执行的真实 Stop、网关及用户安装迁移。

### 旧源码安装迁移

已经通过桌面端安装原生插件、希望接替旧源码安装时，把下面这段粘给 ZCode。公共插件必需，两个业务插件按原有选择迁移。

```text
我已在 ZCode 桌面端安装了 ZCode-Plugins 原生插件，请迁移已有的源码安装：
https://github.com/ONEGAYI/ZCode-Plugins.git

先查询实际插件清单，核对 common 和所选业务插件的启用状态与实际路径；
旧安装位置可从旧 Hook、MCP 配置和技能中的根路径确定，选择或位置不明确时再询问我。
读取实际插件根下的 setup 技能，公共层统一按 common 的 setup 迁移流程执行，
业务插件按各自 setup 的迁移步骤处理，完成后按技能核对并分别报告结果。
```

### 原生插件升级

原生插件升级分为**更新代码**和**重新配置**两步：先更新插件版本缓存，再让 Agent 按 setup 技能刷新依赖、公共链接与运行入口，新功能才可用。

**第一步：更新插件代码**

- **在桌面端更新**：打开插件市场，点击刷新更新市场目录，再升级 common 和已安装的业务插件。刷新市场和升级插件代码是两个操作。
- **让 ZCode 更新**：把下面这段粘给 ZCode，市场副本与 CLI 的具体操作见 common setup 技能的升级流程：

```text
请更新我已安装的 ZCode-Plugins 原生插件，保留插件选择、启用或暂停状态和个人配置。
按 common 插件 setup 技能的升级流程更新市场副本与版本缓存，
完成后核对各插件的新版本和实际 rootPath 并报告结果。
```

**第二步：更新后重新配置**

通过任一种方式更新后，新开一个对话发送"帮我配置已安装的 suian 插件"，Agent 会以新的插件路径读取 setup 技能并完成升级配置。只使用 suian-side-editor 时没有网关步骤，Agent 会按其 setup 跳过。

## 源码安装或升级

下面适用于继续使用源码安装的用户；原生安装请使用上方的迁移或升级提示词。直接把这段粘给 ZCode，**无需先手动克隆仓库**。Agent 会先询问操作和插件选择，按下方的代码获取范围取得代码，再读取 setup 技能完成配置。

```text
请帮我安装或升级 ZCode-Plugins（源码模式）：
https://github.com/ONEGAYI/ZCode-Plugins.git

先询问我：首次安装还是升级；选择哪些插件；源码放在哪里。
先检查已有源码和安装位置，优先复用现有仓库；没有时再确定克隆目录。
首次安装优先用稀疏检出，不初始化 sources 子模块；
已有仓库保留其他已安装插件的目录，更新遇到本地修改或分叉时先说明，不强制覆盖。

获取代码后，读取所选插件和 suian-zcode-common 的 setup 技能，
按技能完成安装或升级与本机检查；模型选择、网关重载和重开时机都按技能执行。
```

### 代码获取范围

两个插件都依赖公共层；公共层内的网关按统一流程配置。只选一个插件时，可以通过 **稀疏检出**，让本地工作目录只包含需要的子项目；根目录的 README、AGENTS、许可证等文件仍会保留。

| 用户选择 | 需要检出的子目录 |
| --- | --- |
| 自动命名 | `suian-zcode-title`、`suian-zcode-common` |
| 会话 MCP | `suian-zcode-app-mcp`、`suian-zcode-common` |
| 两个都要 | 上述三个目录，公共层只获取一份、网关只配置一次 |

下面是 Agent 首次安装自动命名时可用的命令；`{{repo_dir}}` 由 Agent 和用户确定。只装 MCP 时，将 `suian-zcode-title` 换成 `suian-zcode-app-mcp`；全装则在 `set` 后列出三个目录。

```powershell
git clone --filter=blob:none --sparse --no-recurse-submodules https://github.com/ONEGAYI/ZCode-Plugins.git "{{repo_dir}}"
git -C "{{repo_dir}}" sparse-checkout set suian-zcode-title suian-zcode-common
```

`--filter=blob:none` 按需获取文件内容，仍使用同一个 Git 仓库和它的元数据。[Git clone 文档](https://git-scm.com/docs/git-clone)

**已有安装优先复用同一仓库**：完整检出的仓库保持原范围；已有稀疏检出需要新增插件时使用 `sparse-checkout add` 扩展范围，保留其他已安装插件，不能用 `set` 缩掉其源码。[稀疏检出文档](https://git-scm.com/docs/git-sparse-checkout)

升级时保留源码目录和已有配置；稀疏检出需要包含 `suian-zcode-common`，从旧版升级时使用 `sparse-checkout add suian-zcode-common` 补齐，不能删掉其他已安装插件。网关会继续运行旧代码，Agent 按公共 skill 安排安全的 `Restart`，同时迁移旧网关目录的启动配置；不要更新后就宣称运行中网关已经升级。

普通安装和升级不需要 `sources/` 的研究用子模块；研究上游源码时再按 [sources/README.md](./sources/README.md) 获取。

## suian-zcode-title — 会话自动命名（可用）

每轮对话结束后，自动把会话标题更新成「类别 emoji + 对象｜目标」，会话再多也一眼能找到：

| 原来的标题 | 自动命名后 |
| --- | --- |
| C:/Users/…/handoff-zcode-title-202610…（被截断的临时文件路径） | 🧩 远控 Hook 插件｜授权失效排查 |
| 帮我看看这个报错 | 🧪 发布流水线｜超时排查 |

它通过 ZCode 官方的 Web 远控通道连接当前窗口，用你自己账号里的模型生成标题，不往对话里插消息，也不直接改数据库；标题会跟随工作主线缓慢更新，手动改过的标题不会再被覆盖。安装时把一段话粘给 ZCode 就行，详见 [suian-zcode-title/README.md](./suian-zcode-title/README.md)。

## suian-zcode-app-mcp — 会话 MCP

通过四个本机只读工具检索会话、聊天历史、置顶列表与自身会话信息；八个写工具经公共网关调用原 Host 改名、创建、发信、压缩上下文、归档、复原与置顶。另提供 GLM 套餐额度和重置卡查询，以及经用户许可消耗一张卡重置额度。stdio 接入，消息包装来源标识；原 Host 调用不另占官方席位，重置仍需要客户端确认表单。接入与边界见 [suian-zcode-app-mcp](./suian-zcode-app-mcp/)。

工件 demo 提供当前会话的 get/set 增量工具、提交时管理摘要、Stop 历史快照与原生侧栏。提交摘要含有类别保底的部分简表，最多 20 条、整体 9000 字符；工件存储仍不限制数量。侧栏按类型折叠，统一详情含时间和会话实时状态，登记变化后自动刷新；PR 与议题显示实时状态图标和行尾的增删行数或评论数，文件条目区分文件与文件夹，详情页可用资源管理器打开。start_session 自动登记双方关系。原生分叉继承选中断点；缺快照会提示，子会话仍可独立维护。UI 按应用版本和 MCP Apps 能力启用。验证范围及首开连接条件见[开发验证](./suian-zcode-app-mcp/docs/artifact-demo-verification.md)，完整版唯一请求投影继续等待上游。

## suian-side-editor — 侧栏文本编辑器

在当前本机工作区浏览已有 UTF-8 文本，使用内部临时／固定页签编辑，再以保存按钮或 Ctrl+S 写回。目录按层展开，保存前检查磁盘内容版本；版本冲突时拒绝覆盖并保留编辑。保存支持手动与自动两种模式；打开的文件订阅外部变化，外部更新后自动刷新干净内容，不重复触发权限审批。页签顺序、阅读位置和未保存内容按会话保存，编辑器关闭重开、页面被宿主回收重建、应用重启后都能恢复。

当前版本 `0.2.0` 新增选区评论：在编辑器中选择文本撰写评论，评论以胶囊形式进入当前主对话；依赖初始化与打开方法见 [编辑器说明](./suian-side-editor/README.md)。评论要求网关与 Desktop 远控连接可达；模型回复等待期间尽力禁用发送，但不提供完整的并发保证——已被插件受理、随后被外部取消的评论，在少数时序窗口下可能随新评论一起再次发送给模型。

各阶段的开发验证过程与全部已知限制记录在[实施总记录](./suian-side-editor/docs/development-verification.md)；编辑器尚未通过完整首版和用户验收。

## suian-zcode-common — 公共基础能力

统一维护网关、远控协议与探活、DPAPI 授权存取、Toast 通知、消息投影和依赖完整性检查。公共层包含可导入的模块，只有网关是常驻后台进程；命名规则和 MCP 工具契约留在各插件。网关的 Windows 启动、环境变量与恢复只维护一份。操作拆成[安装升级](./suian-zcode-common/skills/setup/SKILL.md)、[连接配置](./suian-zcode-common/skills/configuration/SKILL.md)与[排障](./suian-zcode-common/skills/debug/SKILL.md)，原 SKILL.md 保留为源码兼容路由。

common 当前为 `0.2.2`，本版补充 Agent 代为更新原生插件的操作口径（市场副本、先 common 后业务插件）；`0.2.1` 补充远控开关操作说明；`0.2.0` 新增 Stop 依赖完整性检查钩子与修复提示词 Toast，既有网关、Channel 监听入口和 V4 decoder 保持。官方代码按 Apache-2.0 保留完整许可与 NOTICE，内含 Zod 的 MIT 许可另存；来源与职责见 [公共模块说明](./suian-zcode-common/README.md)。app-mcp 当前为 `0.7.2`，精简工具说明并以关键简报配合完整结构化结果，减少上下文重复；title `0.1.3` 识别宿主 CronCreate 冻结的会话标题并接管自动命名。

**可以在 ZCode 当前会话里完成安装或升级**。重载网关时，只需暂时关闭 ZCode 内的移动端远控（面板内点"停止"），让 Agent 继续配置。首次接入或修改启动地址时，Agent 也会先完成配置和本机检查，最后再提示你择时重启生效；已经连接正确网关且地址未变时，重新开启远控即可。

命名与 MCP 的原 Host 调用已接入网关本地 RPC，复用一个本地 Host 桥并隔离客户端编号，不另占官方席位。已实测本地工作区的 MCP 发信、改名和回复读取与官方手机共存，用户确认无需重连仍可操作；完整 Stop Hook 命名与手机同用尚未实测。手机使用远端工作区时本地 RPC 让位。说明与配置入口见 [suian-zcode-common](./suian-zcode-common/)。

**内网机器可以选择本地模式**。当官方远控服务器不可达时（默认模式下远控面板会一直停在"启动中"），让 Agent 按公共 skill 配置 local-only，网关会在本机处理启动与心跳，供两个插件调用当前窗口。该模式不支持官方手机远控；模型生成和套餐查询仍需相应服务可达。首次配置仍先完成安装，最后才提示重启生效。

## 找到你想要的

- **安装或升级自动命名** → [suian-zcode-title](./suian-zcode-title/)，提示词会让 Agent 询问操作并获取代码
- **安装或升级会话查询 MCP** → [suian-zcode-app-mcp](./suian-zcode-app-mcp/)，提示词与原生 MCP 接入说明
- **配置公共层与共用网关** → [公共网关 skill](./suian-zcode-common/SKILL.md)，端口、启动、重启生效和恢复只维护一处
- **了解实现**（远控协议、Stop Hook、探活分层）→ [suian-zcode-title/AGENTS.md](./suian-zcode-title/AGENTS.md) 的技术参考
- **做会话操控 / MCP** → [research-findings.md](./suian-zcode-app-mcp/docs/research-findings.md)，含已核实能力表与首批工具设计
- **读 ZCode 源码** → [sources/](./sources/)，官方公开快照与社区桥接项目，submodule 引用、按需获取

## 许可证

自有代码以 [MIT](./LICENSE) 发布；`vendor/` 与 `sources/` 内的第三方代码保留其原始许可与来源声明（见各目录 NOTICE）。
