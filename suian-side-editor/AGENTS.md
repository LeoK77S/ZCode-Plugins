# suian-side-editor — 独立侧栏文本编辑器

当前阶段：需求、规格与票粒度已批准，11 张 GitHub Issues 已发布，依据 implement-spec 开始本地实施；宿主能力条件与完整验收尚未通过。

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
- 已接受的架构决定：`docs/adr/`。
- 文档组织与开票：`docs/agents/domain.md`、`docs/agents/issue-tracker.md`。

## 文件职责

| 路径 | 职责 |
| --- | --- |
| AGENTS.md / CLAUDE.md | 本插件规则与 Claude 导入入口 |
| .zcode-plugin/plugin.json / .mcp.json | session 侧栏声明、stdio 注册及宿主工作区的显式环境绑定 |
| package.json / package-lock.json | 独立插件的精确运行依赖、测试和语法检查入口 |
| cli.mjs / server.mjs | stdio 服务、app-only 工具与本地 UI 资源；可信工作区和宿主 session meta 验证 |
| text-files.mjs | 相对路径及真实目标检查、UTF-8 只读正文和字节版本 |
| ui/editor.html | SE-01 的相对路径输入与只读预览，后续编辑业务尚未实施 |
| tests/ | 公开 MCP/stdio 文件边界契约与实际资源浏览器烟测 |
| README.md / docs/se01-verification.md / docs/se01-evidence.json | 开发使用、脱敏验证证据与仍未通过的真实宿主条件 |
| docs/design-discussion.md | 已确认交互、问题轮次、宿主能力边界与后续特性范围 |
| docs/text-editor-spec.md | 首版行为、工程接口边界、能力门槛与验证标准 |
| docs/text-editor-tickets.md / docs/issues/ | 实施依赖图、原子票草稿和后续待做特性 |
| docs/adr/ | 已接受且影响后续实现的架构决定 |
| docs/agents/ | 领域文档和 GitHub 开票入口 |
