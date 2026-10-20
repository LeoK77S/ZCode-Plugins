# PKG-06：让 common 与 title 的 Toast 修复入口脱离版本缓存

**状态**：用户已确认；已发布为 [#118](https://github.com/ONEGAYI/ZCode-Plugins/issues/118)，等待 [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)、[PKG-02（#114）](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)；尚未实施。

## 问题与交付行为

Toast 数据目录中的 VBS 目前仍嵌入缓存内 toast-action.mjs；title 动作还依赖自己的源码和 common。旧通知点击较晚，不能假定发出通知时的缓存还在。

交付共享的缓存外 Toast 执行器、固定启动目标，以及归调用方所有的身份描述和提示词模板。缓存缺失时仍能诊断并复制修复提示，用户显式点击才打开固定默认工作区。

## 负责模块

common 的 notification-install/action、depcheck-hook/toast-action、Toast 发布入口和稳定部署；title 的业务提示模板及 install 调用；协议/快捷方式/日志/冷却契约。

## Blocked by

- [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)。
- [PKG-02（#114）](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)。

## 接口与约束

- 只支持当前 common 依赖修复和 title 网关排障两种身份，不设计任意插件动作框架。
- URI 只接受对应协议的 fix，不能携带任意文件、模块或命令路径。
- VBS 与快捷方式不引用版本缓存；Node 路径与身份数据路径由明确安装上下文提供。
- title 维护业务模板，复制到自己的外置数据；公共执行器不导入 title 缓存代码。
- Toast 活动记录与网关分离，更新通知不重启网关；保留各身份、AUMID、冷却及默认工作区规则。

## 验收条件

- [ ] 红色契约覆盖旧缓存删除后的 VBS/动作依赖失败，新稳定入口在相同场景通过。
- [ ] 暂存校验后才切换 Toast 活动记录，重复安装幂等；失败保留原活动执行器，日志不隐藏原错误。
- [ ] common 点击时现场扫描当前安装，title 点击时插入当前安装根；不存在时明确说明缺失，不输出旧根作为有效入口。
- [ ] 同时移除 title/common 测试缓存后，已部署执行器与外置模板仍可生成并复制修复提示；数据缺失或身份不匹配时明确失败。
- [ ] 协议校验拒绝无效 URI、其他动作和越权身份；运行参数不会变成 Shell 命令拼接输入。
- [ ] 自动测试完全注入通知、注册表、剪贴板和打开工作区，既不激活真实协议也不打开 ZCode。
- [ ] 卸载 title 只移除 title 自有身份，保留 common、共享运行目录与网关；反向情况也不越权清理。
- [ ] 安装检查可报告当前缓存、部署、模板与实际协议目标，不能仅凭 AppID 缓存判定健康。

## 验证与完成边界

用真实临时 VBS/描述文件和公开动作入口测试，系统调用按现有高层边界注入。真实按钮点击、剪贴板与官方确认框由 PKG-09 人工验收；本票不将生成脚本文本称为用户体验已通过。

## 依据

- [主规格第 8、10、12 节](../shared-runtime-release-spec.md)。
- [当前通知注册](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-common/notification-install.mjs)。
- [title 提示词归属](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-title/toast.mjs)。
