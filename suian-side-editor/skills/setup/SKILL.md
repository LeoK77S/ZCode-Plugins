---
name: setup
description: 初始化或升级 suian-side-editor 的锁定依赖与公共包链接，核对原生侧栏入口和外置状态目录。
---

# 文本编辑器安装与升级

适用于用户已选择的suian-side-editor 0.2.0。要求Node.js 24+、ZCode应用版本至少3.15.1，以及MCP Apps能力和可信会话归属。文本编辑可独立使用；选区评论另需既有网关与公开V4连接，采用尽力禁用。原#47缓存缺口、最终缓存／guest、完整首版与用户验收未通过，详见[当前边界](../../docs/comment-guard-verification.md)。

## 确认实际安装位置

原生技能目录由宿主在 `${ZCODE_SKILL_DIR}` 注入，向上两级是当前技能所属的插件根。通过 `zcode plugins list --json` 按完整插件 id 核对 suian-side-editor 与 suian-zcode-common 的 `rootPath`、`dataPath` 和 `enabled`，确认二者启用；实际编辑器根须与本技能所属根一致。更新后如不一致，读取新 `rootPath` 下的本技能，不沿用旧缓存。

CLI 和 Desktop 须使用同一用户及配置目录。CLI 不在 PATH 时，使用用户实际安装的 Desktop `resources/glm/zcode.cjs`，由 Node.js 24+ 执行相同参数；先定位实际安装目录，不猜路径或下载另一份 CLI。未能确认 rootPath、启用状态或配置归属时，报告缺项，不向推测的目录安装。

`{{editor_root}}` 与 `{{common_root}}` 分别采用清单中的实际绝对 rootPath。`{{data_path}}` 为编辑器自己的 dataPath，保留在缓存之外；`editor-state.sqlite` 由宿主注入的 `ZCODE_PLUGIN_DATA` 指向该目录。不得将它改成 common 的数据目录、工作区或插件缓存，也不复制其他会话数据。

## 准备运行依赖与链接

只在已确认的编辑器根安装锁定依赖，再从实际 common 根建立包链接：

```powershell
node --version
npm --prefix "{{editor_root}}" ci --ignore-scripts --no-audit --no-fund
node "{{common_root}}/link.mjs" --plugin-root "{{editor_root}}"
```

Node 版本须满足要求，每条命令成功后再执行下一条。记录安装结果，失败保留错误，不宣称完成。`npm ci` 会清理该插件的 node_modules，因此每次安装或升级后都须重新执行链接命令。common 的稳定入口默认位于当前用户 `~/.zcode/tools/suian-zcode-common/runtime`；不假设两个独立插件缓存是同级目录。已有非链接公共包入口由 link.mjs 报错，不覆盖。

文本编辑只需 common 公共模块和包链接，不需要启动、注册或重启远控网关。选区评论另需用户已有的公共网关配置及 Desktop 移动端远控连接可达；没有配置或连接时，评论入口显示不可用原因，编辑和保存继续可用。评论状态通过一次受审登记的只读资源同步，`running` 仅作保守代理，可能覆盖模型回复，仍有发送边界残余风险。

上述 setup 步骤不执行 common 的 Windows Install/Restart，不替用户安装或重启网关，也不增加全局 MCP 或全局技能。构建好的 `ui/dist/editor.html` 与第三方许可随插件提供；原生安装无需构建，也不在 sources 中安装依赖。

## 核对生效范围

原生 `.mcp.json` 与 `editor` 侧栏由宿主加载。先完成依赖和链接，再在已有可信会话的侧栏“打开标签页”中选择“文本编辑器”，核对目录树与文件读取；读取、保存、设置和恢复副本工具均为 app-only，宿主的正常权限审批仍会出现。没有可信会话身份时保持禁用，不伪造 session_id 或工作区。

更新缓存或链接不等于既有 MCP 进程已加载新代码。需要重载时使用宿主公开的服务重连操作；未连接、旧进程或重启待生效部分单独报告，不自动退出用户的 ZCode。核对数据仍为编辑器自己的外置目录，不以页面显示成功代替文件保存和恢复副本的各自回执。

原生停用与卸载使用原生插件管理器，保留外置状态与其他业务插件。源码开发依赖、构建和隔离测试见 [README](../../README.md#本地开发)，不要把源码测试夹具当作正式缓存安装或用户验收。
