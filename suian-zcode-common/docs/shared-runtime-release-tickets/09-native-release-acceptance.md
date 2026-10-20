# PKG-09：验收实际 ZIP/URL 升级、缓存删除与 Windows 原生入口

**状态**：用户已确认；已发布为 [#121](https://github.com/ONEGAYI/ZCode-Plugins/issues/121)，等待 [PKG-07（#119）](https://github.com/ONEGAYI/ZCode-Plugins/issues/119)、[PKG-08（#120）](https://github.com/ONEGAYI/ZCode-Plugins/issues/120)；尚未实施。

## 问题与交付行为

本地构建、stdio 和系统桩不能证明实际 Desktop 使用的新缓存、长期注册命令以及公开 Release 下载链都正确。本票分层核验已固定的发行候选，不借验收扩大业务功能。

## 负责模块

四个正式 ZIP、候选市场、同一用户隔离宿主安装、网关/Toast 实际 Windows 入口、业务状态快照和脱敏证据。必要修复只在已授权的本改造范围内实施并保留新证据。

## Blocked by

- [PKG-07（#119）](https://github.com/ONEGAYI/ZCode-Plugins/issues/119)。
- [PKG-08（#120）](https://github.com/ONEGAYI/ZCode-Plugins/issues/120)。

**外部执行条件**：明确的候选提交与四插件版本；Node 24+、title 所需 sqlite3；实际目标 Desktop/随包 CLI 和隔离用户数据；公开下载条件；网关安全重载窗口与人工 Toast 操作。

**授权门槛**：真实系统注册/迁移、会话或模型操作、公开 Release、推送/tag/PR、正式合并按用户给定范围分别执行。创建本票或本地测试通过均不自动授权这些操作。

## 验收条件

- [ ] 先固定从哪个工作树/目录、以何种安装方式、加载什么实际产物；记录 Desktop/CLI/rootPath/dataPath、提交、基线和 ZIP 摘要。
- [ ] 在无源码目录、开发依赖和旧链接的隔离存储根中，安装四包及依赖集合；不执行 npm/link，业务共同加载同一 common 当前安装条目。
- [ ] 覆盖只更新业务、只更新兼容 common、同版本重装和旧进程待重载；无错误的热换模块或跨版本假通过。
- [ ] 从旧安装迁移后保留配置、模型、开关、标题策略、授权、工件库和编辑器模式/恢复副本；比对运行注册未重复。
- [ ] 安全窗口内完成真实网关切换，删除已确认的测试旧缓存后，监督启动链可重新启动并返回匹配的运行指纹；端口/令牌/环境备份保留。
- [ ] 实际点击升级前发出的测试 Toast：common/title 两种身份均可生成当前修复提示、写剪贴板并触发官方默认工作区确认；操作者人工完成，不让自动脚本激活协议。
- [ ] 实际 stdio 工具、工件 Hook、title Stop worker 与原生页面分别核对；真实改名仅限已授权专用测试会话，模型用量如实记录。
- [ ] editor 文本路径不因未安装网关而失效；包装证据不关闭既有评论/宿主 UI 票，阻断项保持未验。
- [ ] Release 公开后从固定匿名 URL 下载，SHA-256 与已测 ZIP 一致，原生 ZIP 源安装/升级成功；草稿下载或本地 HTTP 不冒充此结果。
- [ ] 正式合并获准后核对 master 中四插件配套版本及 URL/摘要，所有资产先可访问；未获授权则只报告已验候选，不执行市场切换。
- [ ] 缺包、摘要错误、候选启动失败和回退的可自动场景有证据；真实未执行部分明确列出，不以自动测试替代用户验收。
- [ ] 正式门禁仅针对最终候选运行一次，日志及退出码首次落盘；后续阶段复用有效证据。变更触发重跑时说明原因并缩小范围。

## 完成与留存

交付候选输入/产物/宿主版本的证据索引、执行与未执行项目、失败记录、回退入口及正式市场状态。公开资料不含凭据、真实会话标识、个人路径或用户文件正文。

本票只有对应外部条件实际满足才可关闭；源码支持、桩测试和静态脚本检查不等于真实入口验收，也不等于用户已验收产品。

## 依据

- [主规格第 9、11–13 节](../shared-runtime-release-spec.md)。
- [开票与授权边界](../../../suian-zcode-app-mcp/docs/agents/issue-tracker.md)。
- [官方 ZIP 校验实现](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/apps/zcode-cli/packages/adapters/src/plugins/zip-source.ts)。
