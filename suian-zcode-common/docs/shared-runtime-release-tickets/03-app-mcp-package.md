# PKG-03：让 app-mcp 发布包覆盖 stdio、工件 Hook 与面板

**状态**：用户已确认；已发布为 [#115](https://github.com/ONEGAYI/ZCode-Plugins/issues/115)，等待 [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)；尚未实施。

## 问题与交付行为

app-mcp 既有 stdio 服务，也有工件 Hook 和原生面板资源。SDK/zod 随业务打包，公共协议和模块继续从 common 共享加载，不能留下安装后 npm 或包链接步骤。

交付实际解包可运行的 MCP、工件事件入口及面板资源，所有入口仍读取同一外置配置和工件库。

## 负责模块

suian-zcode-app-mcp 的 cli/server/install、artifact-hook/artifact-ui、公共模块导入、.mcp.json、hooks/plugin 清单、构建与 stdio/工件契约；同步实际改变的 setup/configuration 入口。

## Blocked by

- [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)。

## 接口与约束

- 只将本插件 SDK/zod 等依赖纳入业务产物，common 实现保持外部共享。
- 公共加载完成前不访问凭据、写工件库、连接 Host 或执行业务工具。
- 静态 UI 路径与资源 MIME、工具 schema、注解、可见性、权限与信任边界均保持现有契约。
- 配置与状态归本插件，不能迁入 common 数据目录；工件库与宿主数据库边界保持。

## 验收条件

- [ ] 先用独立目录暴露 stdio、Hook 或 HTML 相对路径的旧失败，再测试实际构建产物。
- [ ] 无业务 node_modules、无 junction、无源码目录时，MCP initialize 与工具列表正常，公共路径指向 PKG-01 的同一 common 安装记录。
- [ ] 使用临时 SQLite 覆盖公开本地读取、工件 get/set、提交摘要、Stop 快照与资源响应；工件 Hook 与 stdio 使用同一外置配置。
- [ ] 网关离线时原有本地只读和非会话工件行为保持；读取不主动写宿主数据库。
- [ ] 模拟 Host 验证会话写工具、权限来源和未知结果语义保持；GLM 重置仍须原用户确认，不消耗真实卡。
- [ ] 构建面板 HTML 与其他静态资源可通过正式服务入口读取；元信息与许可齐全，不回溯源码目录。
- [ ] 安装器 --check-only 不安装 npm、不修链、不注册额外 MCP/Hook；原配置及停用状态保留。
- [ ] metafile 排除 common 实现与公共 vendor，允许薄定位器；包内无运行数据、凭据或研究快照。

## 验证与完成边界

以实际 stdio 子进程、临时真实数据库和服务资源接口验证。外部 Host、gh 与系统打开动作按已有高层边界注入；原生面板 UI 和真实会话操作由 PKG-09 验收。本票不修复宿主侧栏滞留等既有问题。

## 依据

- [主规格第 5、6、10 节](../shared-runtime-release-spec.md)。
- [当前 MCP 注册](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-app-mcp/.mcp.json)。
- [当前工件 Hook](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-app-mcp/artifact-hook.mjs)。
