---
name: setup
description: 核对 suian-side-editor 正式包安装位置、公共依赖定位与外置状态目录；文本编辑即装即用，不启动网关。
---

# 文本编辑器安装与升级

适用于用户已选择的 suian-side-editor 0.4.0。要求 Node.js 24+、ZCode 应用版本至少 3.15.1，以及 MCP Apps 能力和可信会话归属。这些是运行条件，不代表后续应用版本均已通过兼容验证。

正式发布包自带 MCP SDK、zod 与实际构建的编辑器页面：**原生安装或更新后即可使用文本编辑，不需要 npm 安装、公共包链接或 UI 构建**。公共实现由已安装的 suian-zcode-common 按 PKG-01 契约定位加载；市场安装依赖时会一并安装公共插件。

文本编辑可独立使用。选区评论另需既有网关和桌面端远控连接，尚未完成 3.16 兼容验证，不能将公共网关 0.3.0 的在线共存结果视为评论兼容结论。3.16 暂不支持 local-only，详见[公共配置](../../../suian-zcode-common/skills/configuration/SKILL.md)。评论的尽力禁用保护仍有发送边界缺口，编辑器尚待完整首版验证与用户验收，详见[当前边界](../../docs/comment-guard-verification.md)。

## 确认实际安装位置

原生技能目录由宿主在 `${ZCODE_SKILL_DIR}` 注入，向上两级是当前技能所属的插件根。通过 `zcode plugins list --json` 按完整插件 id 核对 suian-side-editor 与 suian-zcode-common 的 `rootPath`、`dataPath` 和 `enabled`，确认二者启用；实际编辑器根须与本技能所属根一致。更新后如不一致，读取新 `rootPath` 下的本技能，不沿用旧缓存。

CLI 和 Desktop 须使用同一用户及配置目录。CLI 不在 PATH 时，使用用户实际安装的 Desktop `resources/glm/zcode.cjs`，由 Node.js 24+ 执行相同参数；先定位实际安装目录，不猜路径或下载另一份 CLI。未能确认 rootPath、启用状态或配置归属时，报告缺项，不向推测的目录安装。

`{{editor_root}}` 与 `{{common_root}}` 分别采用清单中的实际绝对 rootPath。`{{data_path}}` 为编辑器自己的 dataPath，保留在缓存之外；`editor-state.sqlite` 由宿主注入的 `ZCODE_PLUGIN_DATA` 指向该目录。不得将它改成 common 的数据目录、工作区或插件缓存，也不复制其他会话数据。

## 核对公共客户端定位

编辑器进程启动时以宿主注入的 `ZCODE_PLUGIN_DATA` 向上两级推导存储根，读取该根的 `installed_plugins.json` 定位 `suian-zcode-common@suian-zcode-plugins` 的安装条目并加载其公共客户端。定位失败会在服务任何会话前退出并报告错误分类（如 `anchor_missing`、`common_not_installed`、`release_invalid`），不自动 npm 安装、不修链接、不回退旧缓存。

依赖诊断可先运行公共插件的 `depcheck` 入口核对。缺公共插件或安装记录时，修复方式是原生重新安装/更新插件（不是 npm install）；不要在插件缓存内手工执行 npm、创建链接或复制 common 目录。

## 核对生效范围

原生 `.mcp.json` 与 `editor` 侧栏由宿主加载。在已有可信会话的侧栏“打开标签页”中选择“文本编辑器”，核对目录树与文件读取；读取、保存、设置和恢复副本工具均为 app-only，宿主的正常权限审批仍会出现。没有可信会话身份时保持禁用，不伪造 session_id 或工作区。

安装或更新插件缓存不等于既有 MCP 进程已加载新代码。需要重载时使用宿主公开的服务重连操作；未连接、旧进程或重启待生效部分单独报告，不自动退出用户的 ZCode。核对数据仍为编辑器自己的外置目录，不以页面显示成功代替文件保存和恢复副本的各自回执。

原生停用与卸载使用原生插件管理器，保留外置状态与其他业务插件。源码开发依赖、构建和隔离测试见 [README](../../README.md#本地开发)，不要把源码测试夹具当作正式缓存安装或用户验收。
