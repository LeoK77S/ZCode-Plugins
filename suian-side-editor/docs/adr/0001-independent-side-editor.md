# 独立侧栏编辑插件与共享层职责

**状态**：2026-10-12 已接受。仅确定产品载体、首版边界与共享方向；尚未实施。

## 背景

用户需要在 ZCode 侧栏直接编辑文本，并将包含文件路径、行号、所选正文和评论的附件加入当前主对话。现有原生文件预览器没有公开的插件编辑扩展接口；官方 UI Plugin 已允许插件注册独立侧栏页面。

来源：[UI Plugin 编辑器入口](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/UI_PLUGIN.md#L296-L358)。现有本仓库原生接入与运行证据见 [工件开发验证](../../../suian-zcode-app-mcp/docs/artifact-demo-verification.md)，不据此宣称新编辑器已验证。

## 决定

- 新建独立插件 `suian-side-editor`，文件页签放在插件内部顶栏。
- 第一版仅支持当前本机工作区内已有的 UTF-8 文本文件，不包含 PPT、远程工作区或文件管理操作。
- 编辑与评论业务归新插件；实际可复用的基础实现归 `suian-zcode-common`。具体模块和抽取范围在后续规格中确定。
- 评论通过宿主公开的 `updateModelContext` 进入主对话输入区的聚合胶囊，逐条完整保留定位与正文信息；用户按正常主对话流程发送并接收回复。
- 不创建辅助问答，不在插件内展示模型回复，不修改研究用宿主源码。

## 影响与取舍

独立插件可以维护自己的编辑、文件列表与页签行为，同时复用既有公共包入口。插件上下文胶囊使用宿主现有聚合形式，不能将其描述为原生行评论接口的直接复用。

宿主胶囊显示、删除和发送归主对话输入区；插件评论列表的清理规则必须另行定义，不能假定宿主会回调插件。

来源：[上下文提交](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiInteractions.ts#L93-L108)、[聚合胶囊组件](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/PluginUiModelContextChip.tsx#L14-L59)。
