# PKG-02：让 title 从独立发布目录完成 CLI、Stop 与安装检查

**状态**：用户已确认；已发布为 [#114](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)，等待 [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)；尚未实施。

## 问题与交付行为

title 没有直接 npm 依赖，但其 CLI、历史投影、安装器和 Toast 仍导入 common。只打包 CLI 会漏掉 Stop 派发后的 worker、提示词与独立安装入口。

本票交付能从解包目录独立执行的 title 发布目录，覆盖原生 Hook → 后台 worker → 公共 API → 原有命名行为；Toast 的业务模板随包提供，其稳定协议执行由 PKG-06 完成。

## 负责模块

suian-zcode-title 的 cli/hook/install/doctor/history/backend 相关导入与入口、prompt.md、Toast 模板、hooks/plugin 清单、构建配置和测试；同步本票实际改变的 setup/configuration 路径说明。命名业务规则不改。

## Blocked by

- [PKG-01（#113）](https://github.com/ONEGAYI/ZCode-Plugins/issues/113)。

## 接口与约束

- 业务公共导入经 PKG-01 的薄适配模块，发布构建不得内联 common 实现或公共 vendor。
- title 仍保留 Node 24+、sqlite3 CLI 及其配置优先级；显式无效路径不回退。
- Stop 的续跑保护、原时序、锁、派发参数和后台隐藏行为保留，只迁移路径及依赖加载。
- 发布入口、worker 与提示词必须从明确发布根定位，不能用错误的 bundle 所在目录解释旧源码相对路径。

## 验收条件

- [ ] 先以旧入口在独立目录无法加载 common/worker/资源的场景建立红色契约，再使实际发布目录通过。
- [ ] 清除开发 node_modules、旧 runtime 链接并隔离源码目录后，发布 CLI 的检查、status/doctor 与 Hook worker 能正常加载。
- [ ] 真实子进程测试证明 Hook 启动的是包内 worker，参数中的会话元数据和实际配置路径正确；不触发真实改名或协议。
- [ ] prompt、清单、Hook、配置模板和许可齐全；各命令入口的 ESM 主模块判定正常。
- [ ] 安装检查保留 sqlite3 只读 JSON 验证；首次配置暂停、模型核验、原开关和自定义字段保留契约不变。
- [ ] 命名去重、固定标题、手动保护、stale_result 与写后复核的受影响契约通过，无工具或策略扩展。
- [ ] metafile 证明仅允许薄定位器来自 common，未内联 common 实现；包内无用户配置、授权、状态或本机绝对路径。
- [ ] 为 PKG-06 提供业务归属的 Toast 模板和身份信息，不把 title 逻辑搬入 common 源码。

## 验证与完成边界

使用解包目录、真实 CLI/worker 子进程与合成 Host 边界，运行 title 受影响契约。真实 Stop、模型用量和按钮点击留给授权后的 PKG-09。原生正式市场不在本票切换。

## 依据

- [主规格第 5、6、8、10 节](../shared-runtime-release-spec.md)。
- [当前 Hook](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-title/hook.mjs)。
- [当前业务 Toast 动作](https://github.com/ONEGAYI/ZCode-Plugins/blob/73a9c2e94e551b8980c884370a7a82ec7210d617/suian-zcode-title/toast-action.mjs)。
