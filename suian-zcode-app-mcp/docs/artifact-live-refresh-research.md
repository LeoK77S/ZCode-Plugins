# 工件面板实时刷新：上游能力核实与实施记录

对应 issue #54。调研基于 `sources/official-zcode` v3.15.1 公开快照（`aac47556`，2026-10 自 v3.14.3 升级），实施在特性分支 `feat/artifact-live-refresh`（基线 `dev` @ `8552fd9`）。

## 原待核实项结论

### 1. 面板 tab 切走再切回是否销毁重建 webview —— 不销毁，页面保活

- `packages/ui/src/plugin-ui/CONTRACT.md:5,15`：页面实例由窗口唯一页面管理器统一持有（controller、AppBridge、独立 lease、通知 feed 与内存快照），卡片与侧栏只登记锚点；DOM 卸载前同步移入隐藏承载区，原子移动保留同一 guest、不重读资源、不重新握手；"卡片卸载不切断保活页面的订阅"。
- 推论：切回面板**不会**自动恢复一致（页面仍是旧数据），主动刷新机制是必需的；但订阅在面板隐藏期间持续有效，切走期间的更新通知不会丢。
- 边界：存在容量准入（`packages/ui/src/plugin-ui/app/pluginUiPageManager.ts` 的 "sandbox capacity reached"），超容量页面被回收，属极端场景不阻塞本方案。

### 2. `window.zcode` 桥是否暴露服务端通知 —— 是，官方机制完整存在

ZCode 3.15 的 experimental `zcode/resourceSubscribe` 扩展提供完整链路：

- **页面侧**（`packages/desktop/src/renderer/src/plugin-sandbox/aliasRuntime.ts:231-245`）：`window.zcode` 提供 `subscribeResource(uri)` / `unsubscribeResource(uri)` / `onResourceUpdated(listener)`（回调带 uri，返回退订函数）/ `onResourceListChanged(listener)`，另有 `readResource` / `listResources` / `callTool`。
- **宿主转发**（`packages/ui/src/plugin-ui/app/pluginUiHostController.ts:294-297`）：投影增量 `pluginUi.resourceUpdated` 触发 `bridge.notification({ method: "notifications/resources/updated", params: { uri } })` 送进页面；路由表见 `pluginUiResourceNotificationBus.ts`（会话键+插件+作用域+实例代际，无登记的订阅者直接丢弃）。
- **订阅生命周期**（`pluginUiResourceSubscriptions.ts`）：按 uri → Agent 代际记账，同实例重复订阅合并、迟到成功立即补退订，换代或销毁时逐 uri 退订。
- **作用域**：页面只能访问同插件 server 的资源（"同插件 server，归属由 agent 校验"）。工件面板与工件数据同属本插件，满足。

## 实施期发现（上游事实补充）

- **agent 核心不在公开快照**：desktop/services 层经 V4 协议短方法名（如 `mcpUiReadResource: "ln"`，见 `packages/shared/src/zcode-protocol/index.ts`）委托 workspace agent 进程执行，agent 侧实现对 server 发出的资源请求是否注入 `com.zcode/request-context` `_meta` 无法从快照核实。
  - **应对**：数据路径不依赖资源 read——页面收到通知后仍走 `callTool('get_artifacts')`（该路径的 `_meta` 注入已被现有工具依赖证明），资源订阅只当"有变化"信号；资源 read 按请求上下文尽力解析，缺上下文返回说明而非报错。
- **SDK 约束**（`@modelcontextprotocol/sdk` 1.32.1）：`registerResource` 在连接后调用会抛 "Cannot register capabilities after connecting to transport"，资源能力注册必须在连接前完成；低层 `sendResourceUpdated` 仅要求宣告 `capabilities.resources` 存在。
- **扩展参数容忍**：宿主 subscribe 请求携带的 `scopeId` / `generation` 等归属扩展参数，被 SDK 的 `SubscribeRequestParamsSchema`（非 strict，等于 `ResourceRequestParamsSchema`）剥离未知字段，仅剩 `uri` 到达 handler——契约测试已覆盖。
- **进程边界**：工件状态的全部写路径（`set_artifacts` 工具、`start_session` 的会话关联）都在 server 进程内，server 进程发通知即可覆盖；hooks 进程只做 `snapshot` / `initialize` / `get`，不注入通知回调。已知边界：面板打开期间由 hook 进程 `initialize` 首次建立的继承行（revision 0）不触发通知，页面下次刷新可见。

## 方案要点

- 单一逻辑 URI `suian-artifacts://current`：所有会话共用一个变更信号。多个会话的面板同时打开时一次写入会触发各面板重拉（各自经 `get_artifacts` 取本会话数据，结果正确，代价是各多一次本地只读查询）；不产生模型请求、不写聊天历史。
- `set_artifacts` 与会话关联写入**实际改变状态**时才推送通知（内容完全相同的 upsert 不推）。
- 页面在 `refresh()` 引入重入合并（进行中的刷新收到新信号时合并为完成后补拉一次），手动刷新、分页 revision 校验、主题订阅、分页续读行为不变。
- 桥不可用（外置浏览器等无 `window.zcode` 场景）静默保持手动刷新。

## 验证与遗留

- 契约测试 `tests/artifact-resources.test.mjs`（4 例）与全量回归见 `artifact-live-refresh-evidence.json`。
- 待桌面实测（需要安装了 Desktop 3.15.1 的环境）：面板打开期间 `set_artifacts` 的自动刷新时延、切 tab 切回后通知连续性、资源 read 在真实宿主转发下的 `_meta` 形态（当前设计已不依赖该形态）。
