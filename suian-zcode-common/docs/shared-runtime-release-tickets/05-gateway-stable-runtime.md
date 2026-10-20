# PKG-05：部署缓存外网关并提供稳定启动、安全切换与回退

**状态**：已在分支 `pkg05/gateway-stable-runtime` 实施（基线 90caa4b，含 PKG-01 成果）；验证证据见[PKG-05 证据](../pkg05-gateway-stable-runtime-evidence.json)；等待正式集成。

## 问题与交付行为

现有计划任务把安装时的缓存根编码进 run.ps1 参数。仅打包 JS 或移动 VBS 都不能让旧缓存删除后的网关重新启动。

交付真实的缓存外网关运行文件、固定任务启动器和独立活动版本记录。用户在安全窗口切换候选，失败可明确回到先前部署；Status 区分候选、活动和运行版本。

## 负责模块

common 的网关发布构建、gateway-build、setup.ps1、run.ps1/run.vbs、稳定启动器、活动记录与现有 Windows 文件/系统边界测试；同步 common setup/configuration 的对应操作。

## Blocked by

- [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)。

## 接口与约束

- 部署到 common 的缓存外版本目录，复制所需运行文件及资源闭包，不使用指向缓存的 junction。
- 网关数据、任务身份、端口、模式、control_token、自定义上游和原环境备份延续原归属。
- gateway 和 Toast 使用独立活动记录；网关 fingerprint 对真实发布文件计算，运行时首次加载固定。
- Desktop 活跃或状态未知时不切换活动网关。原有隐藏监督、等待和退出码必须保留。
- 不退出 Desktop、不强杀进程、不自动清理旧部署，不增加协议或网关连接模式。

## 验收条件

- [x] 红色契约先证明旧任务依赖已删除缓存；新固定启动器在同样隔离场景能启动部署的运行文件。
- [x] Install/Status/Restart/Remove 在临时目录和系统桩中贯通；任务参数、工作目录及子进程路径不引用版本缓存。
- [x] 重复安装同一 buildId 幂等；路径变但内容一致不要求重载，候选不同则 Status 明确待激活。
- [x] 桩验证 Desktop 活跃/健康未知拒绝切换；允许切换时等待网关、监听与监督启动器实际退出。
- [x] 候选校验失败不改活动记录；候选启动失败恢复之前的活动部署和本次自有配置。首次无旧部署时撤销本次新增注册和环境修改，分别报告失败及回退结果。
- [x] 真实回环进程证明健康返回已加载 buildId，磁盘候选变化不能冒充运行代码变化。
- [x] 环境写入/恢复与广播遵循原契约，不覆盖用户并发外部修改；Node 路径和参数支持中文/空格。
- [x] 旧缓存移除后可再次启动；业务 common 缓存缺失另行诊断，不从稳定网关目录偷偷补业务模块。
- [x] 旧安装迁移核对任务与链接归属，仅删除已确认链接本身；不改变用户源码和业务数据。

## 验证与完成边界

使用真实临时文件、回环网关进程与现有任务/环境边界桩，不修改真实用户任务或 Desktop。用户任务、真实重载与手机共存按固定版本在 PKG-09 分层验收。

## 依据

- [主规格第 7、9、11 节](../shared-runtime-release-spec.md)。
- [当前任务和状态入口](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-common/setup.ps1)。
- [当前指纹](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-common/gateway-build.mjs)。
