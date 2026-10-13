# 主对话插件上下文的并发清理边界

2026-10-12，独立只读预读；未执行尚受 SE-01 阻塞的 SE-02 运行探针。对象为最新公开 aac4755（3.15.1）及本机 Desktop 3.15.1.8093 的原始安装产物。没有修改 sources、安装目录或用户数据。

## 公开接口事实

updateModelContext 由宿主生成每个 surface 的固定 context ID。页面自带 batchUuid/commentIds 不会改变附件身份。同 ID 更新替换整个对象，删除也只比较 ID，没有 revision 或对象一致性检查。

Composer 捕获本次插件数组，等待主对话受理后逐项删除捕获的 ID。A 被捕获后，同页更新为 B，A 的成功清理仍可能删除 B。原生新增附件有独立 ID，不能把视觉聚合与固定数据身份混同。

更新端只返回空对象，没有提交／清理批次回执。已核对的原 Host service 未暴露 composer 草稿附件增删或版本更新接口。原生 code-comment 虽有 remove-from-chat／restore-preview 广播，其当前消费只改预览 store，不能作为插件向 composer 添加附件或插件 context 消费回执。

来源：[固定 ID](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiInteractions.ts#L93-L108)、[同 ID 替换／删除](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/adapters/pluginUiModelContextEvents.ts#L50-L64)、[发送后清理](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx#L1503-L1525)、[更新反馈](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/plugin-ui/app/pluginUiInteractionPorts.ts#L101-L132)、[Host service](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/zcode-agent/zcodeAgent.ts#L670-L727)。

## 实际安装产物静态核对

app.asar/package.json version 为 3.15.1。renderer 与沙箱别名中的对应逻辑与公开源码一致：固定 surface ID、同 ID 替换／删除、等待受理后按捕获 ID 清理，更新仍返回空对象。

别名 subscribe 提供工具输入／结果／取消、host-context 更新和主动 widgetState 写入的通知；已核对的发送清理链没有向页面通知 context 被消费。

| 产物 | SHA-256 |
| --- | --- |
| resources/app.asar | c98b4b2a80e5ea46ce93f934f9580eff11bc487570c87478fa36a3f4bd3d101f |
| out/renderer/assets/styles-D-FzO2Ov.js | 8460aa6e6df5b0191d0a989aa917dcb3d9f577a871b9791ae7282f1bd951d0fe |
| out/plugin-sandbox/plugin-sandbox-alias.js | eca82ae2c11aecb8574b0ba65c8d275942cea7ee707b56f4ec6d6d2f5283a1d3 |

以上是安装产物静态核对，不表述为已运行 Host 竞态探针；原始代码摘录未入库。

## 对实施的影响

精确批次匹配权威 userInput／queue 可只清理插件自己的已受理缓存，但不能保证主输入框的新胶囊免于旧 ACK 删除。该方案不构成 H3 完整通过。

需要上游提供可关联的 context revision、按捕获 revision 清理和消费批次反馈，或公开具有独立条目 ID 的原生附件 API。当前公开接口与已核对安装产物没有这条完整契约。首版并发要求保持不变；未满足时评论票与完整验收保持阻塞，不实施定时重发、禁用新增或私有宿主修改作为替代。

## SE-02 实际 Desktop 续验

真实隔离 Desktop 已验证 tooltip 明细、完整字段进入正常 userInput、普通成功清理及模型运行期间的排队受理；同页替换仍是一枚胶囊，正常清理和原生删除后页面没有关联消费反馈。尚无可控 admission gate，模型 completion hold 未作为竞态证明，H3 继续阻塞。运行轨迹、首次 FK 失败与 Native 夹具修正见 [SE-02 验证](se02-verification.md)，脱敏日志摘要见 [证据 JSON](se02-evidence.json)。
