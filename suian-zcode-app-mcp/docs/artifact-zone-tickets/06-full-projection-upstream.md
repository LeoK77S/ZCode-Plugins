# 工件区完整版：每请求唯一最新尾部状态投影

GitHub Issue：[#36](https://github.com/ONEGAYI/ZCode-Plugins/issues/36)，标签 enhancement、wait-for-upstreaming。

本地标识：AZ-06。状态：等待上游，尚未实施。Blocked by：ZCode 提供正式的请求级临时状态槽，并具名确定支持版本。demo 的 #28–#31 不以本票为前置条件。

## 问题与目标

demo 接受用户提交时的管理提示词和统计在运行时上下文中累积，完整列表通过 get_artifacts 读取。完整版要求每个适用模型请求都携带一份最新完整工件状态，旧自动投影不随历史再次发送。

本票保留原 #29 的严格请求投影目标，避免把 demo 的摘要放宽当作完整版已解决。历史断点分叉采用已确认的 SQLite 快照规则，不再要求在点击原生分叉时冻结父最新状态。

## 所需上游契约与验收

- [ ] 正式插件入口在每个适用模型请求装配时读取当前会话最新状态，有稳定的状态槽/来源 ID。
- [ ] 同一最终请求只附一份自动工件投影，包含管理说明、revision 与完整条目；空状态同样可见。
- [ ] Provider 序列化后仍位于约定的 messages 数组末端，工具调用/结果配对及顺序合法。
- [ ] set 成功后的工具续跑、重试、连续输入、压缩和恢复按已定义请求范围刷新，不复用旧状态。
- [ ] 自动投影不写入权威运行时历史、聊天持久化或恢复快照；保留正常用户文本、工具参数及工具回执，不靠删除同名文本实现唯一性。
- [ ] 读取或生成失败能明确阻止请求携带未知/旧状态；诊断日志的保存边界另作明确说明。
- [ ] 固定支持版本和加载产物，用隔离 Host 捕获实际最终请求、运行时历史和持久数据验收，不能只凭 Hook 输出或 formatter 单测解除等待标签。

## 已知边界

#27 的 3.14.5.7961 隔离运行已证实 UserPromptSubmit.additionalContext 会过时、累积且不是最终请求尾部。3.15.1 的 UI 插件与原生侧栏不提供请求级唯一替换槽；当前七类 Hook 和运行时追加路径仍不能作为上述严格契约的替代。

固定源码：[Hook 枚举](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/contracts/src/hooks/index.ts#L7)、[Hook 上下文追加](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/runtime/methods/hooks.ts#L106)、[3.15.1 UI 文档](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/UI_PLUGIN.md)。

本票建在本仓库记录依赖；没有向 ZCode 上游发票、修改其源码或替换运行时。demo 规格附于 #28；#27 保留原始严格规格与历史验证记录。
