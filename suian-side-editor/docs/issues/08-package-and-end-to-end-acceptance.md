# SE-08 · 完成独立插件安装包与首版端到端验收

**状态**：已发布，尚未实施；依赖与实际能力条件未满足前保持阻塞。

**GitHub**：[#48](https://github.com/ONEGAYI/ZCode-Plugins/issues/48)。

**Blocked by**：[#45 · SE-05](https://github.com/ONEGAYI/ZCode-Plugins/issues/45)、[#47 · SE-07](https://github.com/ONEGAYI/ZCode-Plugins/issues/47)。

规格：[首版规格](../text-editor-spec.md)。顺序：[票索引](../text-editor-tickets.md)。本地标识不是 GitHub Issue 编号。

## 问题与交付

开发工作树中的局部验证不能证明原生缓存安装、公共依赖链接及首版完整流程可用。

交付可独立安装且依赖 common 的原生插件，核对实际加载产物，完成整个首版行为验收并记录脱敏证据。

## 责任范围

suian-side-editor 的安装／配置技能、原生注册和构建产物；根 marketplace.json／AGENTS.md／README.md 的实际新增入口；common 及受影响既有调用方的必要回归。

本票的代码交付与测试不自动授权市场发布、推送、建 PR、合入 master 或修改用户已有安装。

## 验收条件

- [ ] 新插件有自身 AGENTS.md／CLAUDE.md、原生元信息、stdio 注册、最小安装／配置入口与本地 UI 产物。
- [ ] marketplace 登记独立业务条目并声明 common 依赖，独立缓存使用稳定包链接，不硬拼同级缓存目录。
- [ ] 运行数据落本插件外置 dataPath；用户正文、会话 ID、个人路径与凭据不进入 Git 或验收汇总。
- [ ] 验证冷启动 → 目录树 → 临时／固定页 → 保存模式 → 外部冲突 → 重开恢复 → 主对话评论 → 发送清理 → 并发新增保留。
- [ ] 验证所需应用版本与 MIME、插件 Node 依赖和本地构建产物一致；旧环境显示具体能力不足。
- [ ] 受影响 common 与既有 artifact-ui 回归通过；不全量重跑无关模块。
- [ ] 入库记录真实证据和未完成条件，技术自检不表述为用户已验收。
- [ ] 开发集成走 dev；master 正式集成、版本发布、推送／PR／合并分别等待届时明确授权，版本按实际影响同步。

## 验证与完成证据

隔离安装路径的完整 Desktop 验收与受影响契约回归；首次长命令留日志和退出码，后续统计只读日志。

可执行行为遵循契约测试先行。首次长命令落盘记录日志和退出码；只汇总脱敏证据。通过依赖票还必须满足该票声明的实际能力条件；调查结束本身不会解除能力阻塞。
