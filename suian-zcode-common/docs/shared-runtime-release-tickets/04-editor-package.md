# PKG-04：让 editor 发布包直接提供实际 UI、stdio 与外置状态

**状态**：用户已确认；已发布为 [#116](https://github.com/ONEGAYI/ZCode-Plugins/issues/116)，等待 [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)；尚未实施。

## 问题与交付行为

editor 目前安装后还需 SDK/zod 依赖和 common 链接，UI 则已有独立构建入口。本票将两者组合为无需用户构建和 npm 的正式发布目录，不增加网关安装副作用。

## 负责模块

suian-side-editor 的 cli/server、公共模块导入、构建与资源路径、.mcp.json/plugin 清单、现有 setup/README 和受影响测试；复用 build-ui.mjs，不手改生成 HTML。

## Blocked by

- [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)。

## 接口与约束

- SDK/zod 进入本业务包；common 的项目归属、UI 判定、网关客户端及协议实现仍共享加载。
- editor-state.sqlite、模式和恢复副本仍归当前插件 dataPath；用户源文件保存与副本回执分离。
- 文本编辑启动不安装、注册或重启网关。评论是否可用继续按既有连接和可信身份判断。
- 当前没有 configuration 技能，本票不为结构统一新增该技能或新配置功能。

## 验收条件

- [ ] 先添加独立发布目录下公共模块/页面资源无法加载的契约，再用真实构建产物使其通过。
- [ ] 无开发 node_modules、无链接、无源码目录时，stdio initialize、app-only 工具和实际构建 editor.html 可用。
- [ ] 解包资源保留 CodeMirror 等第三方许可，浏览器不请求开发服务器或本机源码路径。
- [ ] 临时文件及真实 SQLite 契约证明路径边界、版本冲突拒写、模式和恢复副本使用原外置归属。
- [ ] 实际构建页面的受影响烟测覆盖打开文件、编辑保存、模式/恢复和评论入口可用性，不因包装改变现有授权语义。
- [ ] 没有网关时文本编辑仍可用，评论显示既有不可用状态；测试不启动用户服务。
- [ ] build metafile 未内联 common 实现或 vendor；Node 内置 SQLite 不被替换为新的原生 npm 扩展。
- [ ] 安装说明取消原生 npm/link/UI 构建，清楚区分正式缓存、源码开发和已有未验事项。

## 验证与完成边界

运行受影响 SDK/SQLite 契约和实际构建浏览器烟测，日志首次保存。包装通过不关闭编辑器 #42、#46、#47、#48 或完整并发 #57，不能冒充其原用户验收。

## 依据

- [主规格第 6、10、12 节](../shared-runtime-release-spec.md)。
- [当前服务资源读取](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-side-editor/server.mjs)。
- [唯一 UI 构建入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-side-editor/build-ui.mjs)。
