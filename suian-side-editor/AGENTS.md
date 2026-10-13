# suian-side-editor — 独立侧栏文本编辑器

当前版本 0.1.0 提供本机已有 UTF-8 文本编辑，登记原生市场并提供 `skills/setup/SKILL.md` 的依赖与公共包链接入口。既有 11 张 GitHub Issues 已发布，完整原生并发独立拆为 SE-11（GitHub #57），共 12 票。H1/H2、目录／页签／保存、外部冲突和 H4 三类生命周期均已取得限定验证；当前评论闭环、SE-08 正式缓存安装及用户产品验收尚未通过。2026-10-13 用户已接受发送边界残余风险，允许按已核公开会话状态尽力禁用后推进，见 `docs/adr/0005-temporary-comment-send-guard.md`、当前规格及票索引；旧验证记录保留原时点。

SE-04 的代码、统一执行等同性、分层 Native 证据与文档两轴复核已完成，本地限定条件通过；浏览器 42 项／组通过，未改 SDK 复用 33/33。旧 Native 重复读审批失败保留，新限定行为见 `docs/se04-watch-native-verification.md`，当前闭合见 `docs/development-verification.md`。该轮视觉未验，不与 SE-03 图像或旧数据根模式链混称。评论当前范围按 ADR 0005 推进，实际接口、临时限制和评论缓存闭环仍须验证，不能宣称原 H3 完整能力已满足；模式数据库写回与源文件写回仍是两个独立回执。

SE-05 已实现 schema 2 的会话恢复副本与独立回执；最终固定源 `20526764` 和统一 `77caa2a` 的代码两轴、统一完整 SDK 37/37、实际构建浏览器 55 项／组及构建／语法检查已通过。页签、阅读位置与脏正文在使用过程中持久化，重建重新通过受审工具取得文件和资源关联。正常关闭重开、自然回收新 guest、应用正常退出重启均有实际恢复证据，见 `docs/se05-native-verification.md`。本轮 Native 文档最终统一整合及 #45 本地条件见 `docs/development-verification.md`。

初版及三轮代码红绿记录保持原提交时点，分别见 `docs/se05-verification.md`、`docs/se05-review-fix-verification.md`、`docs/se05-round2-verification.md`、`docs/se05-round3-verification.md`。其中历史“待复核／H4 未验”不代表当前实测状态；不改写旧失败与冻结证据。评论 #42／46／47 与安装验收 #48 可按用户接受残余风险的尽力禁用范围继续，完整同步／批次及在途追加由 SE-11 独立验收，尚未完成。

## 范围与约定

- 首版编辑当前本机工作区内已有的 UTF-8 文本文件。远程工作区和新建、重命名、删除文件另列后续特性；首版不包含 PPT 编辑。
- 编辑器使用插件内部界面和文件页签；选区评论进入当前主对话，模型回复留在主对话。不得扩展辅助问答或插件内聊天。
- 当前评论采用已核公开会话状态尽力禁用全部提交入口、tooltip 与草稿保留；状态可能迟到、恢复可能早于 Renderer 清理的过渡风险已获用户接受。若用模型 running 保守代理，明确可能整个回复期间锁定，不能称为 admission pending；未知／断连不当空闲。完整原生并发完成后移除临时禁用。
- 沿用根 AGENTS.md 和 CONTEXT.md。真实可复用的实现归 `../suian-zcode-common/`，本插件保留编辑、页签与评论业务；具体抽取边界在规格中明确，不因可能复用而提前创建通用框架。
- `../sources/` 只读，不修改宿主源码或安装研究快照依赖。公开接口事实、集成验证和用户验收分别记录。
- 状态持久化与原文件保存分开；运行数据归本插件，用户文件正文、会话标识和个人路径不写入入库证据。
- 澄清阶段只记录已确定决定；待决问题明确标记，不将推荐方案记为已接受。
- 实施可执行行为时遵循契约测试先行，测试首次运行保存日志和退出码。当前仅文档变更采用内容与格式检查。
- 用户已要求使用规格工作树实施。该工作树作为统一集成分支，各实现者在自己的独立工作树完成单票并提交，由专门合并者集成；不切换用户主工作树。开发基线为 dev，正式分支为 master；本轮不自动授权推送、PR 或正式集成。

## 文档入口

- 领域术语：根 `../CONTEXT.md`。
- 设计澄清：`docs/design-discussion.md`。
- 首版规格与票草稿：`docs/text-editor-spec.md`、`docs/text-editor-tickets.md`。
- 实施证据与宿主预读：`docs/development-verification.md`、`docs/native-ui-binding-research.md`。
- 主对话上下文接口与安装包核对：`docs/main-composer-context-research.md`。
- 已接受的架构决定：`docs/adr/`。
- 文档组织与开票：`docs/agents/domain.md`、`docs/agents/issue-tracker.md`。

## 文件职责

| 路径 | 职责 |
| --- | --- |
| AGENTS.md / CLAUDE.md | 本插件规则与 Claude 导入入口 |
| .zcode-plugin/plugin.json / .mcp.json | session 侧栏声明、stdio 注册及宿主工作区的显式环境绑定 |
| skills/setup/SKILL.md | 原生实际 rootPath／dataPath 核对、锁定依赖与 common 包链接；不启动公共远控网关 |
| package.json / package-lock.json | 独立插件的精确运行依赖、测试和语法检查入口 |
| cli.mjs / server.mjs | stdio 服务、app-only 工具与本地 UI 资源；可信工作区和宿主 session meta 验证 |
| text-files.mjs | 工作区边界、按层目录、UTF-8/BOM/换行特征、字节版本与拒绝旧基线的写回 |
| text-resources.mjs | 首次可信受审读取登记的只读资源关联、按内容版本通知、退订／连接关闭释放；资源请求无对话 meta |
| editor-settings.mjs | 插件外置 SQLite schema 2、schema 1 无损迁移、模式事务与会话恢复副本、存储边界校验及独立回执 |
| ui/editor-template.html / ui/editor.css / ui/editor.mjs | 页面结构和主题、目录树、CodeMirror 页签、手动／自动保存、打开文件版本检测及冲突确认 |
| build-ui.mjs / ui/dist/ | 唯一本地 UI 构建入口、随插件返回的自包含 HTML 与第三方许可；不手改生成文件 |
| tests/ | 公开 MCP/stdio 文件边界契约与实际资源浏览器烟测 |
| README.md / CHANGELOG.md | 当前版本范围、原生安装／打开、本地开发与用户可感知更新 |
| docs/se01-verification.md / docs/se01-evidence.json | 首次验证轨迹与总证据索引 |
| docs/se01-native-verification.md / docs/se01-native-evidence.json | 实际 Desktop 首开、关闭重开、会话／工作区归属与原生审批的限定证据 |
| docs/se03-verification.md / docs/se03-evidence.json | 目录／保存 SDK 契约、真实构建浏览器与独立两轴；链接后续限定 Native 证据 |
| docs/se03-native-verification.md / docs/se03-native-evidence.json | 固定产物的原生目录／读取／编辑／保存、人工审批、磁盘字节与完整 guest 图像；单列失败尝试和能力边界 |
| docs/se04-verification.md / docs/se04-evidence.json | 模式真实数据库、自动计时与外部修改契约、首次失败轨迹及待 Native 交接；不代表整票验收 |
| docs/se04-review-fix-verification.md / docs/se04-review-fix-evidence.json | 固定初版后的三项时序问题红绿、新增浏览器契约、历史证据保护与 Native 补充；不代替复核 |
| docs/se04-watch-fix-verification.md / docs/se04-watch-fix-evidence.json | 原生重复审批问题、公开资源通路的红绿／时序／错误与生命周期边界；新 Native 尚待验 |
| docs/se04-watch-review-verification.md / docs/se04-watch-review-evidence.json | 订阅通路两轴四项 P2 的公开红绿、重绑定／独立同步失败／通知拒绝／同版本旧错误与新固定产物；复核及 Native 待验 |
| docs/se04-watch-round2-verification.md / docs/se04-watch-round2-evidence.json | 第二轮规范目标页唯一性／脏正文保留、同字节改指保存的公开红绿与固定产物；独立复核及 Native 待验 |
| docs/se04-watch-round3-verification.md / docs/se04-watch-round3-evidence.json | 第三轮整合时钟驱动失败、三页瞬时激活的提前保存红绿与固定产物；独立复核及 Native 待验 |
| docs/se04-watch-native-verification.md / docs/se04-watch-native-evidence.json | 固定订阅产物的真实 Native 请求、单次 UI 授权、保存／冲突／退订／故障恢复与分层限制；保留文档提交时点，闭合见实施总记录 |
| docs/se05-verification.md / docs/se05-evidence.json | 恢复副本/schema 迁移的真实数据库、新进程及实际构建页面契约，首次失败与修正记录；原生 H4 待验 |
| docs/se05-review-fix-verification.md / docs/se05-review-fix-evidence.json | 首轮两轴三项 P2 的真实 stdio／构建页面红绿、身份合流／重试重入／初始化交互修正与新固定产物；独立复核及 H4 待验 |
| docs/se05-round2-verification.md / docs/se05-round2-evidence.json | 规格轴新增合流读取代际问题、真实 ACL 迟到资源错误红绿及54组完整浏览器；新固定产物复核及 H4 待验 |
| docs/se05-round3-verification.md / docs/se05-round3-evidence.json | 同一旧回执问题的脏目标分支红绿、保留正文／读取确认分离与55组完整浏览器；新固定产物复核及 H4 待验 |
| docs/se05-native-verification.md / docs/se05-native-evidence.json | 固定恢复产物的三类真实生命周期、独立副本回执／源字节／焦点、首次失败与根冻结索引；保留提交时点，当前整合结论见实施总记录 |
| docs/design-discussion.md | 已确认交互、问题轮次、宿主能力边界与后续特性范围 |
| docs/text-editor-spec.md | 首版行为、工程接口边界、能力门槛与验证标准 |
| docs/text-editor-tickets.md / docs/issues/ | 实施依赖图、原子票草稿和后续待做特性 |
| docs/issues/11-native-concurrent-comment-feature.md | 独立完整原生并发、公开状态／批次需求、重连晚回执与移除临时禁用验收 |
| docs/adr/0005-temporary-comment-send-guard.md | 用户接受残余风险的尽力禁用、当前票范围与完整特性边界 |
| docs/development-verification.md / docs/native-ui-binding-research.md | 已执行验证与明确区分源码依据、宿主实测的能力记录 |
| docs/main-composer-context-research.md | 主对话插件附件身份、清理反馈与实际安装包的静态能力边界 |
| docs/adr/ | 已接受且影响后续实现的架构决定 |
| docs/agents/ | 领域文档和 GitHub 开票入口 |
