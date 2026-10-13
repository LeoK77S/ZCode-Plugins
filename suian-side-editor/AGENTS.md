# suian-side-editor — 独立侧栏文本编辑器

当前阶段：需求、规格与票粒度已批准，11 张 GitHub Issues 已发布，依据 implement-spec 本地实施。只读切片与 H1/H2 已经人工原生审批实测及两轴复核通过；SE-03 的目录、页签与手动保存通过整合 SDK／浏览器、独立两轴和限定 Native 烟测。H3/H4、SE-08 正式缓存安装与完整首版验收尚未通过，工具审批不等于用户产品验收。

SE-04 的模式、自动触发及订阅修正通过本地契约、统一执行等同性与独立代码复核，浏览器 42 项／组通过，未改 SDK 复用 33/33。旧 Native 的重复读审批失败保留；固定新产物的限定 Native 行为已闭合，记录见 `docs/se04-watch-native-verification.md`，尚待文档及本票门槛两轴复核。新轮视觉未验，不与 SE-03 图像或旧数据根模式链混称。SE-05 未解锁；模式数据库写回与源文件写回是两个独立回执。

## 范围与约定

- 首版编辑当前本机工作区内已有的 UTF-8 文本文件。远程工作区和新建、重命名、删除文件另列后续特性；首版不包含 PPT 编辑。
- 编辑器使用插件内部界面和文件页签；选区评论进入当前主对话，模型回复留在主对话。不得扩展辅助问答或插件内聊天。
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
| package.json / package-lock.json | 独立插件的精确运行依赖、测试和语法检查入口 |
| cli.mjs / server.mjs | stdio 服务、app-only 工具与本地 UI 资源；可信工作区和宿主 session meta 验证 |
| text-files.mjs | 工作区边界、按层目录、UTF-8/BOM/换行特征、字节版本与拒绝旧基线的写回 |
| text-resources.mjs | 首次可信受审读取登记的只读资源关联、按内容版本通知、退订／连接关闭释放；资源请求无对话 meta |
| editor-settings.mjs | 插件外置 SQLite schema 1、全局默认／会话模式事务、跨进程初始化及明确失败；不保存正文 |
| ui/editor-template.html / ui/editor.css / ui/editor.mjs | 页面结构和主题、目录树、CodeMirror 页签、手动／自动保存、打开文件版本检测及冲突确认 |
| build-ui.mjs / ui/dist/ | 唯一本地 UI 构建入口、随插件返回的自包含 HTML 与第三方许可；不手改生成文件 |
| tests/ | 公开 MCP/stdio 文件边界契约与实际资源浏览器烟测 |
| README.md / docs/se01-verification.md / docs/se01-evidence.json | 开发使用、首次验证轨迹与总证据索引 |
| docs/se01-native-verification.md / docs/se01-native-evidence.json | 实际 Desktop 首开、关闭重开、会话／工作区归属与原生审批的限定证据 |
| docs/se03-verification.md / docs/se03-evidence.json | 目录／保存 SDK 契约、真实构建浏览器与独立两轴；链接后续限定 Native 证据 |
| docs/se03-native-verification.md / docs/se03-native-evidence.json | 固定产物的原生目录／读取／编辑／保存、人工审批、磁盘字节与完整 guest 图像；单列失败尝试和能力边界 |
| docs/se04-verification.md / docs/se04-evidence.json | 模式真实数据库、自动计时与外部修改契约、首次失败轨迹及待 Native 交接；不代表整票验收 |
| docs/se04-review-fix-verification.md / docs/se04-review-fix-evidence.json | 固定初版后的三项时序问题红绿、新增浏览器契约、历史证据保护与 Native 补充；不代替复核 |
| docs/se04-watch-fix-verification.md / docs/se04-watch-fix-evidence.json | 原生重复审批问题、公开资源通路的红绿／时序／错误与生命周期边界；新 Native 尚待验 |
| docs/se04-watch-review-verification.md / docs/se04-watch-review-evidence.json | 订阅通路两轴四项 P2 的公开红绿、重绑定／独立同步失败／通知拒绝／同版本旧错误与新固定产物；复核及 Native 待验 |
| docs/se04-watch-round2-verification.md / docs/se04-watch-round2-evidence.json | 第二轮规范目标页唯一性／脏正文保留、同字节改指保存的公开红绿与固定产物；独立复核及 Native 待验 |
| docs/se04-watch-round3-verification.md / docs/se04-watch-round3-evidence.json | 第三轮整合时钟驱动失败、三页瞬时激活的提前保存红绿与固定产物；独立复核及 Native 待验 |
| docs/se04-watch-native-verification.md / docs/se04-watch-native-evidence.json | 固定订阅产物的真实 Native 请求、单次 UI 授权、保存／冲突／退订／故障恢复与分层限制；本票门槛待两轴判定 |
| docs/design-discussion.md | 已确认交互、问题轮次、宿主能力边界与后续特性范围 |
| docs/text-editor-spec.md | 首版行为、工程接口边界、能力门槛与验证标准 |
| docs/text-editor-tickets.md / docs/issues/ | 实施依赖图、原子票草稿和后续待做特性 |
| docs/development-verification.md / docs/native-ui-binding-research.md | 已执行验证与明确区分源码依据、宿主实测的能力记录 |
| docs/main-composer-context-research.md | 主对话插件附件身份、清理反馈与实际安装包的静态能力边界 |
| docs/adr/ | 已接受且影响后续实现的架构决定 |
| docs/agents/ | 领域文档和 GitHub 开票入口 |
