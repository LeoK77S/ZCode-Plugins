# 侧栏编辑器开票约定

使用本仓库 [ONEGAYI/ZCode-Plugins 的 GitHub Issues](https://github.com/ONEGAYI/ZCode-Plugins/issues)，沿用已有 [app-mcp 开票流程](../../../suian-zcode-app-mcp/docs/agents/issue-tracker.md)。

- 中文规格和票草稿先保存在本项目 `docs/`。设计、粒度和顺序确认后，按明确发布指令创建 Issues。
- 票围绕可验收的行为贯穿必要层级，写明责任模块、依赖与完成条件；不机械拆成存储、接口和 UI 三层票。
- 新插件责任归 `suian-side-editor`；共享实现变更明确列出 `suian-zcode-common` 和实际受影响的既有调用方。
- 远程工作区与新建、重命名、删除文件列为后续待做特性，不计入首版完成条件。
- 实施基于开发分支，在独立工作树完成验证。正式分支仍为 master，推送、PR 与正式合并遵循根规则及当前会话授权边界。
- 发布前读取已有标签，不为套用流程创建新标签体系，不使用尚未推送的本地文档作为 GitHub 票的唯一规格来源。
- 宿主没有提供的能力单独写明前置条件。集成探针通过不等于用户验收；源码支持不等于已通过实际安装和 Desktop 验证。
