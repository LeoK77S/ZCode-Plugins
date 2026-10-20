# PKG-01：提供独立 common 产物及无包链接的公共加载契约

**状态**：用户已确认；已发布为 [#113](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)，无实施票阻塞；实施另需指令。

## 问题与交付行为

原生市场依赖不提供 Node 包解析。先打通“common 发布目录 → 安装记录定位 → 消费者加载公共 API”的最小可运行路径，为后续业务迁移提供唯一契约。

本票交付 common 客户端发布入口、release.json、纯 Node 定位器、独立目录消费烟测和构建输入记录。common 实现只进入 common 产物；薄定位器可以由单一源码生成到业务包。

## 负责模块

suian-zcode-common 的公共导出边界、构建入口、运行元数据、定位器和契约测试；必要构建期配置及锁文件。不得把 gateway 主程序或安装副作用放进客户端导入链，不为本票重构无关公共函数。

## Blocked by

- 无实施票前置；[主规格](../shared-runtime-release-spec.md)与票粒度已获用户确认。

## 接口与约束

- 公共客户端入口提供现有三个消费者实际使用的函数和协议导出，第一代 commonApiVersion 为 1。
- 原生以实际宿主存储根的安装记录定位完整 common 身份；源码调试显式提供 common 根或安装记录路径。入口不能依赖 node_modules 或 junction。
- release.json 区分插件身份与 package 名称，包含版本、API、buildId、入口和文件摘要；业务所需 API 与最低 common 版本必须可判定。
- 拒绝缺失、损坏、歧义或不兼容的安装记录；不遍历版本猜测、不回退源码、不自行修复系统。
- 首次加载固定本进程的 common 根；升级后通过新进程加载，不热换运行中模块。

## 验收条件

- [ ] 先添加契约，证明旧裸包导入在无链接的独立目录失败；新定位路径使同一场景通过。
- [ ] 用目标宿主公开事实固定 Hook、MCP、技能命令和独立 CLI 的存储根锚点；缺少某变量的入口显式传入安装记录路径，不假定默认用户目录。
- [ ] 隔离自定义存储根、中文/空格路径、无开发依赖时，两个独立消费者读取相同 common 根与 buildId；无额外网关进程或系统注册。
- [ ] common 缺失、损坏、版本不足、API 不兼容和清单歧义在业务副作用前明确失败，错误能区别上述原因。
- [ ] 客户端入口不触发启动、通知、凭据读取或 gateway-build 源码扫描；既有接口语义保持。
- [ ] common 产物包括所需 ws 与 vendor 运行依赖、许可及元数据；无需生产 node_modules，文件摘要不存在自引用。
- [ ] 导出列表、构建输入和定位规则有可供后票使用的契约说明；旧生产市场与旧源码开发入口尚未切换。

## 验证与完成边界

以临时真实文件和最小消费者进程测试公开加载行为，系统边界必须注入。已有 common 受影响测试与新契约通过即可；不提前跑全仓回归、真实安装或发布。日志保存首次红绿结果与退出码。

本票完成不代表业务 ZIP 已迁移、网关已部署或目标 Desktop 已通过完整安装验收。

## 依据

- [主规格第 4–6 节](../shared-runtime-release-spec.md)。
- [当前公共链接](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-common/link.mjs)。
- [官方 MCP 环境注入](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/apps/zcode-cli/packages/adapters/src/plugins/mcp.ts)。
