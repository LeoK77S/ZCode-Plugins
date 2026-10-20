# PKG-08：收敛无 npm/link 的安装、配置、诊断与旧安装迁移

**状态**：用户已确认；已发布为 [#120](https://github.com/ONEGAYI/ZCode-Plugins/issues/120)，等待 [PKG-02（#114）](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)、[PKG-03（#115）](https://github.com/ONEGAYI/ZCode-Plugins/issues/115)、[PKG-04（#116）](https://github.com/ONEGAYI/ZCode-Plugins/issues/116)、[PKG-05（#117）](https://github.com/ONEGAYI/ZCode-Plugins/issues/117)、[PKG-06（#118）](https://github.com/ONEGAYI/ZCode-Plugins/issues/118)；尚未实施。

## 问题与交付行为

当前技能把 npm 和 junction 恢复作为升级必经步骤，depcheck 也会将无 node_modules 的正确 bundle 误报为损坏。新产物必须有配套的用户操作链，不能只完成构建。

本票让原生首次安装、升级、配置、仅检查、回退和卸载使用新发布入口；诊断区分缺包、API 不兼容、系统入口未部署和进程旧版。源码开发的 npm/link 说明单独保留。

## 负责模块

common 的 depcheck/prompt/Hook 与状态接口；common/title/app-mcp 的 setup/configuration，editor 现有 setup；相关 paths/debug、根路由 SKILL、README、AGENTS、CONTEXT 及安装契约。

## Blocked by

- [PKG-02（#114）](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)、[PKG-03（#115）](https://github.com/ONEGAYI/ZCode-Plugins/issues/115)、[PKG-04（#116）](https://github.com/ONEGAYI/ZCode-Plugins/issues/116)、[PKG-05（#117）](https://github.com/ONEGAYI/ZCode-Plugins/issues/117)、[PKG-06（#118）](https://github.com/ONEGAYI/ZCode-Plugins/issues/118)。

## 接口与约束

- 每个入口的操作说明与其实际发布命令一致，版本缓存里不 git pull、不 npm ci、不修包链接。
- 仅检查不写配置、不注册任务或通知、不启动网关；缺包通过宿主修复，服务未初始化才执行对应 setup。
- title 模型、暂停与恢复，MCP 原配置/停用状态，editor 状态及网关所有既有用户数据保留。
- editor 文本功能不安装网关，不新增无实际需要的 configuration 技能。
- 卸载必须区分宿主默认删除 data、keep-data 和缓存外自有服务；不能笼统宣称全部保留或全部删除。

## 验收条件

- [ ] 红色契约先证明旧 depcheck 将正确无 node_modules 产物判错；新检查接受新包，仍检出缺文件、错身份和 API 不兼容。
- [ ] common 缓存缺失时诊断/已部署 Toast 有明确修复路径；不自动安装 npm、拉源码、创建链接或重启 Desktop。
- [ ] 模拟旧源码/原生缓存迁移，先记录开关和路径，安全部署服务/通知，再重连并恢复；不重复注册 Hook/MCP，不覆盖自定义字段。
- [ ] 旧 junction 的清理核对归属且只删链接；真实目录、其他插件注册和用户源码保持。
- [ ] common setup/configuration 分清候选、活动、运行代码及 Desktop 环境；不以文件更新证明当前进程已换代。
- [ ] title/setup/configuration、app-mcp/setup/configuration 与 editor/setup 均使用包内实际入口；配置变化不会触发依赖重装。
- [ ] 从技能逐步执行隔离首次安装/升级/仅检查/卸载场景，命令与结果字段可对应；纯文案修改做链接/内容检查，不为文案添加镜像测试。
- [ ] paths/debug/README/AGENTS/CONTEXT 同步已实现归属与术语，明确源码开发流程和既有宿主/编辑器未验范围。
- [ ] 首次 Git 源到 ZIP 的恢复限制、宿主 keep-data 适用方式及暂缺缓存的业务失败边界均写清楚。

## 验证与完成边界

以安装器公开入口、临时文件和系统桩检查用户操作链。只跑受影响安装/诊断契约与文档检查；真实 UI、用户任务或协议操作留给 PKG-09，不因本票完成提前移除旧正式市场来源。

## 依据

- [主规格第 10、11、12 节](../shared-runtime-release-spec.md)。
- [当前依赖检查](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-common/depcheck.mjs)。
- [当前公共安装技能](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-common/skills/setup/SKILL.md)。
