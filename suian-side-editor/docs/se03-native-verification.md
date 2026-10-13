# SE-03 · 原生目录、页签与手动保存烟测

2026-10-13，隔离 Desktop 中的本票 Native 烟测通过。**11 次实际 UI 工具请求得到 10 次成功响应和 1 次预期版本冲突**；两次正常写回均核对了磁盘原字节。本轮只补原生链路，既有 SDK 19/19、12 组浏览器与独立两轴证据见 [SE-03 验证](se03-verification.md)。

本轮没有新启动 GUI 或发送模型 turn。沿用已绑定的隔离 Desktop、测试工作区 B、公开 Host 创建的合成空任务与 localhost 合成 Provider；模式保持 build。制作代理没有程序化修改 mode 或权限配置，也没有代点审批。记录不代表用户已完成产品验收。

## 实际执行的产物与入口

测试执行的源码固定为 `b1c2a220445097f2fe3301191c2e82a32f90e473`。开始前核对 CLI、服务端、文件模块、UI 源和实际构建 HTML 的哈希；写本文前仅以 `--ff-only` 合到统一文档基线 `68fa8b768a36a62b117e6bdfc275d607445663f0`，这些生产产物仍逐字一致。没有为记录修改或重建产物。

公开本地测试市场安装 `se03-native-editor-probe@se03-native-local-test`，原生 Chooser 选择“SE03 编辑器烟测”。该探针只提供临时元信息，stdio server 为 `plugin:se03-native-editor-probe:suian-side-editor`，返回 `ui://suian-side-editor/editor.html`；CLI 与依赖实际来自固定 SE03 源码树。**这不是 SE-08 正式缓存包装安装验收**。

准备阶段只列出四个 app-only 工具和读取 UI 资源，未预调用文件工具。HTML 为 312054 字节，SHA-256 为 `2c13431012c02693c394a5bd54e06871545d5a791f24c44a31a0343e2db55903`；SDK、common 与 CodeMirror 的实际依赖路径保留在忽略目录，入库使用来源说明。工具规范名共用前缀 `mcp__plugin_se03-native-editor-probe_suian-side-editor__`。

## 单步原生结果

每次通过正常 UI 操作触发一个请求，审批期间不切页、不关闭、不重复调用。时间表为 **2026-10-12 UTC**（北京时间为次日），精确时间和请求参数见 [脱敏 JSON](se03-native-evidence.json)。

| ID | SDK 实际请求 | 请求时间 UTC | 结果 |
| --- | --- | --- | --- |
| 1 | `get_editor_context` | 23:22:33.377 | 成功，取得当前测试任务与工作区身份 |
| 2 | `list_editor_directory`，`.` | 23:25:41.102 | 根层含 node_modules 和隐藏文件 |
| 3 | `list_editor_directory`，`se03-smoke` | 23:26:08.471 | 只读取被展开的一层 |
| 4 | `read_editor_text`，`plain-lf.txt` | 23:26:49.630 | LF 正文，单临时页 |
| 5 | `read_editor_text`，`third.txt` | 23:27:13.668 | 替换旧临时页，没有增加第二临时页 |
| 6 | `read_editor_text`，`bom-crlf.txt` | 23:27:36.760 | BOM/CRLF 正文；双击页签固定 |
| 7 | 保存按钮，`bom-crlf.txt` | 23:29:09.516 | 正常写回，59 字节，BOM 与 CRLF 保留 |
| 8 | `read_editor_text`，`third.txt` | 23:30:07.201 | 新临时页；首次编辑后自动固定 |
| 9 | Ctrl+S，`third.txt` | 23:30:44.525 | 仅一个保存请求，83 字节、无 BOM、LF |
| 10 | 保存按钮，`third.txt` | 23:31:52.996 | 预期 `version_conflict`，保留编辑与外部磁盘内容 |
| 11 | `list_editor_directory`，`node_modules` | 23:32:28.523 | 出现子目录但未自动下钻 |

按钮保存与 Ctrl+S 后，UI 清除 dirty 并显示“已保存”，新版本分别与磁盘 SHA-256 相符。冲突请求实际携带 ID 9 返回的新基线；夹具在此后通过本地外部写入改变了同一测试文件。ID 10 返回 `isError=true/code=version_conflict`，外部内容的 47 字节保持不变，未保存输入、脏标记和页签均保留，未自动重试。

树显隐没有增加工具请求。同一 415 × 745 CSS 像素视口，树显示时正文区域宽约 220.44 px、右树约 186.90 px；隐藏后正文区域约 407.33 px。尺寸来自实时 DOM，视觉结论另有完整 Native guest 截图，不用 DOM 尺寸替代图像观察。

## 审批、身份与模型计数分层

**11 条原生审批回执均为 build 下的 allow**。ID 7 按钮保存的 reason 是 `Approved for this project`；其余 10 条是 `Approved once`。保存走 `mode.build.highRisk`，其余工具走 `mode.build.sideEffect`。用户配合点击原生审批，制作代理没有操作任何批准按钮。

**本轮出现一条项目规则更新跳过，未证实持久化成功**。冻结 CLI 时窗第 27 行是 ID 7 的项目允许回执，第 28 行紧接本轮唯一的 `tool.permission.project_update.skipped`；两条日志时间均为 `2026-10-12T23:29:12.684Z`，SID 相同。skip 自身没有 toolCallId 或 requestId；本轮 11 次审批共用 trace/span，它们不是唯一调用标识。结合单步串行操作与相邻日志记录本轮跳过现象，不声称 skip 与 ID 7 有直接请求 ID 关联。

skip 的日志文字是 `without persisted session`，但[固定官方源码的 guard](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/core/src/tool/executor/permission-rules-persistence.ts#L46-L67) 实际在无法取得 `session.projectID` 时跳过项目规则更新。本次权限补查没有直接读取 Core DB，不能区分 session 缺失与 projectID 字段缺失，因此不概括为“没有 Core 会话”。这只证明本轮存在更新跳过；通常有持久 Core 归属的任务，其同工具同路径免审或重启复用均未实测。

“未改权限配置”仍只指代理未程序化修改。没有 Host 权限状态的前后快照，上述项目规则更新跳过也不能证明其他内存权限状态完全不变；通常持久任务的授权持久化及作用范围未独立核查。

证据按来源区分：

- **UI 请求实测**：原生 guest SDK 日志有实际 `tools/call`、参数与响应。UI 请求 `_meta` 只有 `progressToken`；本轮没有捕获服务端 stdio wire。
- **Host 注入源码**：沿用 [SE-01 分层证据](se01-native-verification.md) 与 [宿主绑定研究](native-ui-binding-research.md)，不把源码事实写成此次截获的线报。
- **可信服务端响应**：10 个成功响应的任务、工作区与工作区身份一致；读写正文、版本与磁盘核对相符。冲突错误响应本身不承载完整身份。
- **人工审批**：人类配合记录与实际 `tool.permission.resolved` 回执共同留证，工具批准不等于产品验收。
- **模型端点**：沿用 SE-02 的累计计数 5，烟测后仍为 5，本轮新增 0；请求日志没有本轮时窗中的模型请求。不回写 SE-01 冻结时点的 0。

## Native 图像与普通样式

从当前可见且已绑定隔离实例的 webview shell 顶层目标执行标准 CDP `Page.captureScreenshot`，取得完整 Native guest 像素。制作代理和根代理均已直接查看：顶部两固定页、脏标记、面包屑、保存／文件夹按钮、右树、行号正文、底部冲突提示与编码状态可见。截图 623 × 1117 像素，SHA-256 为 `41af5a550e57aa4c6bba6d04765b0ee1788386b7d57913a764cf5c70db54faec`；原图只留在忽略目录。

同一 guest 被动读取 `getComputedStyle`：body 与固定页标题为 `system-ui, "Microsoft YaHei", sans-serif`、14 px；目录行为同一字体栈、12 px；正文滚动层为 `ui-monospace, Consolas, "Cascadia Code", monospace`、12 px。fontStyle 均为 normal，匹配已加载普通 inline CSS。没有发现额外字体覆盖，没有按衬线观感修改 CSS；此核对不证明系统实际选用了某一具体字体文件。

## 保留的失败与范围边界

- **空合成 Core 告警**：22 条 `usage.tool.write.failed` 报 `FOREIGN KEY constraint failed`，属于用量事实写入。工具链仍有 11 个实际响应；本轮磁盘／UI 结果与响应相符，没有将告警包装为文件保存失败或忽略掉。
- **输入适配失败**：一次多行 `Input.insertText` 在 CRLF 文档形成单行；该次输入未触发保存。后续使用逐行正常键盘输入与 Enter，未改产品。它不是产品字节写回红灯，也不替代既有标准粘贴回归。
- **截图失败尝试**：主 renderer 截图遗漏 guest 局部画面，未用于视觉结论；直接对 OOPIF 截图返回 `CDP -32000 / only top-level targets`，失败日志 exit 1 保留。随后使用同一绑定 shell 顶层目标取得完整截图，没有 Win32/UIA 或私有 DOM 补丁。

本轮未重跑全部 SDK／浏览器组，没有扩大到 SE-08 缓存安装、H3、H4、跨重启恢复、评论或完整首版验收。Native 结果是本票限定烟测与视觉核对，不表述为用户产品验收；证据制作自检不表述为独立审查。

## 冻结与检查

唯一 Native 事实来源为 SE-02 专用测试树的冻结总 JSON 和 **154 项**转移清单：`.scratch/se03-native-frozen/se03-native-evidence.json`、`.scratch/se03-native-logs-to-transfer.json`。总 JSON 原 SHA-256 为 `9b9e5a688b549c7a0d5c749e4cfbf7d2ee869b07204bb3694e37cdde7d3f0f6a`，入库转换没有覆写该源。

转移清单逐项包含 SHA、字节数及适用日志退出码，所有 source 都是冻结副本。活动 controller／GUI 日志、CLI 日志原文件与模型请求日志原文件不在转移源中；CLI 本轮时窗与模型计数另有已关闭快照。证据自检、冻结复制哈希检查均 exit 0；唯一非零日志是上述已解释的 OOPIF 截图失败。

本次文档与 JSON、相对链接、脱敏内容及生产哈希检查输出保存在 SE-03 工作树忽略目录。`.scratch/se03-native-doc-check.log` 与 `se03-native-doc-check-green.log` 各有失败记录：检查脚本先把已有 HTTPS 链接协议的一部分误判为 Windows 盘符，收窄正则后又命中了说明文字中的孤立协议示例。修正检查与说明后，`.scratch/se03-native-doc-check-final.log` 与 `.exit` 为通过记录，没有改动产品或覆写首次失败。原始截图、合成任务标识和本机绝对路径不入库；完整脱敏索引见 [Native JSON](se03-native-evidence.json)。
