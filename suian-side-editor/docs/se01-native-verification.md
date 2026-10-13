# SE-01 实际 Desktop 续验

2026-10-12，安装版 Desktop `3.15.1.8093`。本记录补充 [首次验证](se01-verification.md)，只新增验收证据，不改变只读切片。**H1/H2 已在真实隔离 Desktop 中通过：原生审批后的首开、关闭重开、同工作区两会话和两个工作区均正确**。SE-01 的本地实现与条件验证已完成，Issue 未关闭、未推送或发布；工具审批不等于用户产品验收。

## 修正此前夹具边界

规格的 H1 要求无模型前置的侧栏首开和关闭重开，并未要求空会话跨进程持久化。此前辅助 `app-server` 的空会话不能被 Desktop 选中，只说明该夹具没有走到目标原生页面，不构成本票必需的冷恢复条件。

本轮使用同一个实际 Desktop Host 的公开 `zcode-task/createTask`。它初始化目标 Runtime/MCP 并登记原生任务索引，不需要 `initialMessage`；本轮没有发送 turn。辅助协议进程的 Runtime 不作为实际 Desktop lease 的证据。

## 启动与通道

前三次 GUI 的启动前注册表状态未知，保留首次记录的限制。第四次启动前，逐项只读核对 Directory、Drive 两组固定 Explorer 菜单的默认值、MUIVerb、Icon 和 command 默认值，共八项：类型和内容均与安装包下一次启动将写入的值逐字相同。测试 profile 语言为 `zh-CN`，协调者因此明确授权仅一次最小 GUI 启动。启动后八项仍逐字一致；没有改删标准注册键。

只使用自造 profile、白名单子进程环境、两个测试工作区和 localhost 合成 Provider。安装产物原封不动，窗口隐藏启动；不读取真实用户配置、凭据或活跃会话。公共包依原锁文件安装依赖，未改锁文件或安装 `sources/` 依赖。

本地网关使用公共 `startGateway`，模式为 `local-only`，绑定 `127.0.0.1` 和动态端口，随机测试控制 token 只写隔离配置。Desktop 子进程的 relay 环境变量指向此网关。通过原生“移动端远程控制”入口启用后，公开状态为 `active`。随后以公共 `connectHost` 调用原 Host 的公开服务；不使用会发送提示词的 `control.mjs create` 封装。

## 原生首开到达的阶段

| 阶段 | 实际观察 |
| --- | --- |
| `zcode-task/createTask` | 生成测试任务 A1，默认 `build`，空消息；任务立即出现在原生任务列表 |
| 原生选择 A1 | 主面板选择成功，目标工作区为测试工作区 A |
| 插件发现 | `listPlugins` 识别启用的 inline 编辑器；`plugin-ui-bridge/listSurfaces` 返回 `editor`，availability 为 `session` |
| 原生侧栏入口 | 异步列表完成后出现“文本编辑器”；早期立即抓取的菜单尚未含该项，是探针观察时序问题 |
| MCP 连接 | A1 日志记录 session lease、stdio 连接成功和 toolCount=2；CLI initialize 版本 `0.16.9`，应用版本 `3.15.1` |
| 沙箱资源 | `prepareSandbox resource ready`，本地 HTML 与原生 alias 均 200；生命周期进入 `mounted/running` |
| 正式 UI 上下文工具 | `get_editor_context` 等待审批约 60 秒，最终 `Request timed out`，页面保持读取禁用 |

实际插件是 Electron webview 内的独立 iframe，主 renderer 的 Playwright frames 列表不含它。首次探针因此错误报告 frame 缺失；改为连接当前隔离实例公开 CDP iframe 目标后，只读取得正式页面错误。CDP 仅用于查看 DOM 和标准输入操作，没有注入桥接、替换 handler 或修改内部 DOM。

## 默认审批模式的失败

实际 CLI 日志明确记录：`tool.permission.resolved` 的规则为 `mode.build.sideEffect`，工具是规范名 `mcp__plugin_suian-side-editor_suian-side-editor__get_editor_context`，结果为 `deny`，原因为 `Permission request cancelled`。随后 `mcp.ui.tool.call` 记录 `cancelled`，Host `callTool` 记录中止。

服务端已声明 `readOnlyHint=true`、`destructiveHint=false`。宿主 MCP 注册仍无条件设置 `needsApproval=true`；`build` 的只读自动放行还要求 `!needsApproval`，因此该调用等待审批。**用户实际观察到原生审批模态，并表示未赶上超时窗口**。探针此前仅取主 renderer 的页面文本，没有在有效窗口内捕获模态；不能据此判定审批入口缺失。该结果不是 MCP 未连接或会话 meta 拒绝；工具尚未获得执行机会，不能据此宣称 H2 成功。

运行链用正式页面的归属确认断言复现红灯，原始退出码为 1。探针没有通过模型 turn、私有补丁或固定等待绕过审批。

## 模式选择的限制

原生菜单中的“自主模式”对应 `guarded`，不是保留但未实现的 `auto`。“完全访问”对应 `yolo`。点击“自主模式”只改变下一次 Submission 草稿；无 turn 时不会更新当前 `UIcallTool` 所读 Runtime 模式。实际菜单选择后没有新工具调用，关闭页签重开复用了首个失败沙箱。

公开 `zcode-task.setMode` 可通过 V4 CAS 即时更新 Runtime；源码 handler 仅调用 `app.setMode`，不启动模型。本轮没有调用该写 API，没有应用宽泛模式授权。

更窄的公开候选是 CLI `permission.allowedTools`，只允许本插件两个工具规范名，并保留 app-only 可见性。本轮仅在自造 home 的 CLI 配置中加入精确列表，随后通过同一公开 Host 创建 A2，显式 `build`。A2 原生首开仍触发 `mode.build.sideEffect`，约 60 秒后取消；新 Runtime 尚未证明读入该配置，不能当成预授权成功。B1 也已创建为 `build` 空任务，但尚未原生选择或触发 UI 工具。

人类反馈到达后立即暂停主动页面关闭、重开、切任务、工具触发和配置修改。只读核对时 A2 页面仍可见、读取禁用，原生 renderer 已无活动 dialog，模型 endpoint 计数为 0。后续人工审批重试须先协调触发时机，触发后留出审批窗口，不由脚本连续操作覆盖。

## 实际人工审批与读取

用户明确表示“现在重试，我来点”后，只计划触发一个新的上下文请求。B1 不在当前已打开工作区的原生任务列表，等待定位失败，**没有触发工具请求**。随后使用同一公开 Host 在工作区 A 创建 A3，显式 `build`、空消息；原生选择和首次 surface 打开后，立即报告触发时机，保持页面和任务不动。

| 实际调用 | 原生权限回执 | 结果 |
| --- | --- | --- |
| A3 `get_editor_context` | `mode.build.sideEffect` → `allow`，`Approved for this project` | 约 3.6 秒完成，isError=false；正式页面显示匹配 A3 的会话和工作区 A，读取启用 |
| A3 `read_editor_text`，path=`probe.txt` | `mode.build.sideEffect` → `allow`，`Approved once` | 约 3.1 秒完成，isError=false；正文精确为 `工作区 A · 只读探针\r\n`，换行为 CRLF |
| A3 正常关闭、重开后再次读取 | `mode.build.sideEffect` → `allow`，`Approved for this project` | 约 9.5 秒完成，isError=false；同一 A3/工作区 A，正文逐字一致 |
| A4 同工作区新会话首开上下文 | `mode.build.sideEffect` → `allow`，`Approved once` | 约 7.4 秒完成，isError=false；A4 会话不同于 A3，工作区仍为 A |
| A4 `read_editor_text` | `mode.build.sideEffect` → `allow`，`Approved once` | 约 2.8 秒完成，isError=false；正文和 CRLF 逐字一致 |
| B2 工作区 B 首开上下文 | `mode.build.sideEffect` → `allow`，`Approved once` | 约 9.4 秒完成，isError=false；B2 会话和工作区 B 正确 |
| B2 `read_editor_text` | `mode.build.sideEffect` → `allow`，`Approved once` | 约 4.7 秒完成，isError=false；正文为 `工作区 B · 只读探针\n`，LF 保留，路径和工作区身份不同于 A |

每次调用均由用户原生点击审批；代理没有代点。两次调用之间先报告上下文成功，再按协调者明确安排填写相对路径、点击一次读取。模型 endpoint 计数保持 0。

A3 页签关闭后重新打开，宿主复用同一沙箱；本轮证明复用后真实 `UIcallTool` 仍能读取，不声称再次获取了资源或重建 MCP 连接。A4 通过原公开 `createTask` 创建，显式 `build`，再从原生任务列表选中；此次新 Runtime 仍需人工批准，不能把“Approved for this project”概括为后续所有会话均自动放行。

只读观察脚本最初误以为 `sourcePath` 是相对路径，正文与归属已正确但断言失败；生产契约实际返回绝对规范路径。修正观察断言后，仅重新读取现有 DOM，检查通过，没有再调用文件工具。

**实际 UI 消息与 Host 注入必须分开**。通过隔离实例的 CDP 只读观察 SDK 控制台消息对象：页面发送 `get_editor_context` 的 arguments 为 `{}`，`read_editor_text` 为 `{path:'probe.txt'}`；页面 `_meta` 只有 SDK 的 `progressToken`，没有页面指定的会话 ID。工具成功回执包含 A3 会话、工作区 A、工作区身份及只读能力，文件回执包含 UTF-8/CRLF、正文和字节版本。

本轮没有直接截获 Host 到 stdio 的原始请求帧，不能把 UI 消息的 `_meta` 当成服务端 `extra._meta`。服务端在缺失/冲突会话 meta 时拒绝，因而此次成功回执证明宿主链路提供了其接受的可信归属；字段在 Host 侧注入的具体形态仍由独立源码核对支持，不冒充 wire 抓包。

## 工作区 B 的实际绑定

第二工作区的公开原生入口是 Ctrl+O /“打开工作区”，经系统目录框选择。官方 Computer Use 模块可初始化，但窗口列表返回两个同 EXE、同标题的 ZCode 窗口，未提供 PID 归属字段；没有猜测 opaque window ID 对应关系、捕获不明窗口或创建 Win32/UIA helper。

向明确绑定测试主进程的 CDP renderer 发送一次 Ctrl+O 后，窗口列表没有返回可确认的新目录框，停止自动操作。协调者核对用户截图，确认目录框及误输入路径造成的错误弹窗实际存在；路径文案转义已更正，由用户手动选中工作区 B。随后只读确认原生 B 草稿页面和 B1 任务出现。

B1 是打开 B 之前经 A 的远控上下文创建的空测试任务。原生选择 B1 后，主面板报 `Session is not active and not persisted` / `fault.subscribe.sessionNotFound`，侧栏停在加载，未产生新沙箱或 SDK 工具请求。首次报告把 surface 点击当成工具触发，随后依实际日志纠正；没有消耗工具审批窗口。这个结果说明本次 B1 夹具未在当前 B 后端可用，任务索引不能证明活跃 Runtime；不扩大为 H1 必须支持空会话跨进程持久化。

公开 `getWebRemoteControlStatus.workspacePath` 仍为 A。一次辅助 `connectHost(B)` 未取得 descriptor，Node 退出 `-1073740791`；仅据该辅助客户端失败，不判宿主能力缺失。按已授权的原生入口停止测试远控，在当前 B 重新启用同一隔离 relay；公开 status 路径变为 B，随后 `connectHost(B)` 的 attached 路径和 bootstrap 本地工作区也明确为 B。

在 B 的公开绑定下通过 `createTask` 新建 B2，显式 `build`。先确认 B2 原生可选，再选择和首开。真实 SDK 出现 `tools/call get_editor_context` 后才报告调用已触发；上下文成功后另行触发一次文件读取。B2 的路径、SID、工作区身份、正文、编码、字节数和版本均与其磁盘夹具相符，没有沿用 A 的结果。

## 完成边界与证据保留

未审批的 `build` 会等待原生审批并超时；本轮成功均有实际人工原生批准。测试 home 精确 allowlist 的效果未证明，不能把这些成功归因于它，也没有添加自动授权逻辑。实际隔离 ZCode 模型 endpoint 请求数为 **0**，未发送 turn、未手动预热 MCP、未改安装包或内部 DOM。

最终只读比较注册表八项：第四次启动前、启动后及 Native 验证完成后都满足预期，启动前和最终逐项类型／值完全相同。前三次启动无前置快照的限制仍保留，标准 Explorer 键未改删。

此次补充仅修改验证文档和票状态，不重跑已有公开 10/10、语法与浏览器回归。新增检查读取真实 SDK/DOM 回执，断言 A3/A4 会话不同而工作区身份相同、A/B 路径和身份不同、A CRLF / B LF 保留、原字节 SHA-256 一致、页面不指定会话以及注册表八项相同；退出码 0。脱敏结果见 [Native JSON](se01-native-evidence.json)，完整日志摘要追加到 [总证据](se01-evidence.json)。

原始日志在单票树忽略目录 `.scratch/` 中；测试会话身份、路径和网关配置不得直接入库。按协调者明确要求保留当前隔离 GUI、Host、网关和测试 Provider，供 SE-02/03 继续 Native 测试，未停止或归档。持续写入的宿主日志另存冻结副本，SHA 清单只针对该时点副本，不声称当前活动日志已停止变化。

首次证据迁移因活动启动器日志 `.scratch/se01-native-gui-run.log` 被进程占用而失败。该来源已由 `.scratch/se01-native-frozen/runner.log` 冻结覆盖，两条原摘要的字节数与 SHA-256 相同。修正转移清单和总 JSON，排除重复的活动源条目，在冻结条目以 `sourceFile` 保存映射；新增清单为 113 个唯一文件，总摘要为 142 条。没有停止进程、重新冻结日志或重跑 Native。
