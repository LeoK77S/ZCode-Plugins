# LO-07 侧栏评论与连接恢复验收证据（脱敏）

**执行日期**：2026-10-21。**代码基线**：`2c951e2`（feat/local-only-integration，LO-06 合入后）于 worktree 分支 `feat/lo07-editor-acceptance` 验证。

**对象**：三个真实构建发布包（common 0.6.0 + app-mcp 0.11.0 + side-editor 0.4.0）、lab 隔离副本（3.16.2.8769，字节身份与登记一致）、补丁 v2、lab 网关、受控本地模型服务、真实原生侧栏面板（Electron webview 内的实际构建页面与真实 CodeMirror 实例）。

**结论先行**：local-only 隔离环境下，真实侧栏评论的完整链路成立——真实选区和评论快照携带可信会话/工作区、文件路径、行号、选文、评论体与未保存标记；经宿主 `updateModelContext` 进入当前主对话的 composer 草稿，用户发送后以 `# Plugin context:` 块落库；受理证据来自对话历史/队列中的本插件批次，与模型 running 状态分开；断连时状态转 unknown 且评论正文保留，重连后恢复可提交；两个会话的评论互不污染，原文件保存与恢复副本保持独立回执。

**边界如实**：未注入发送级失败；未打开第二个工作区做原生跨工作区验证；模型全部来自受控本机 mock；#47 历史结论不改写，完整并发 #57 仍独立。

原始日志、lab 数据与安装记录留在 git 忽略的 worktree 根 `.scratch/`（`logs/lo07-*.log`、`local-only-lab-lo07/`）；本文只收脱敏摘录，不写会话 ID、令牌与本机路径。

## 1. 构建与加载入口

| 项 | 值 |
| --- | --- |
| common 发布包 | 0.6.0，buildId `018f462679ae9da5…`，58 文件，commonApiVersion 1（`lo07-build-common.log`，EXIT=0） |
| app-mcp 发布包 | 0.11.0，buildId `ab362ce559631ce6…`，22 文件，dist 三入口（`lo07-build-app-mcp.log`，EXIT=0） |
| side-editor 发布包 | 0.4.0，buildId `e700a2c71c92435c…`，17 文件，commonApiVersion 1、minimumCommonVersion 0.6.0，入口 `cli.mjs` / `ui/dist/editor.html`（`lo07-build-side-editor.log`，EXIT=0） |
| side-editor 页面 | `ui/dist/editor.html` 330,488 字节，SHA-256 `7c057730e9ab1f024c38153f708f03130fd25cf64f8996b305d92e8fa925f0d8`；页面 `document.title` 为“文本编辑器” |
| 原版 asar | `1f960ba2…`（lab 副本与日常安装逐字节一致） |
| v2 补丁 asar | `71c640b5…`（与 LO-03/LO-06 登记一致；`patch.mjs prepare/apply` 真实执行，EXIT=0） |
| lab 检查 | `{"ok":true,"total":21}` 全 PASS（`lo07-lab-check.log`） |
| 网关 | 部署 buildId `ac0e0c0d…`；`/health` mode=local-only、relay_protocol_version=2、`upstream_connected:false` |
| 会话 MCP | stdio 实连 app-mcp dist 入口；`list_sessions` 正常回执（`lo07-mcp-list.log`，EXIT=0） |
| 实连会话 | 两个测试会话均创建于 lab 工作区，权限模式 `yolo`（验证构造，见 §4）；首轮与第二轮均真实完成（mock 回复落库） |

## 2. lab 配置与面板入口

side-editor 按 PKG-01 形态安装到宿主实际发现根，未执行 npm、链接或手工改宿主：

| 项 | 实际值 |
| --- | --- |
| 插件缓存 | `<lab>/storage/cli/plugins/cache/suian-zcode-plugins/suian-side-editor/0.4.0/`（另含 common、app-mcp 两条，各自独立缓存） |
| 安装记录 | `<lab>/storage/cli/plugins/installed_plugins.json`，三条记录均 `enabled:true`（`lo07-installed-plugins.json` 节选） |
| 启用门槛 | `<lab>/home/.zcode/cli/config.json` 的 `plugins.enabledPlugins["suian-side-editor@suian-zcode-plugins"]=true`（K19） |
| 插件数据 | `<lab>/storage/cli/plugins/data/suian-side-editor@suian-zcode-plugins/`；恢复副本库 `editor-state.sqlite` |
| 工作区绑定 | 发布 `.mcp.json` 的宿主语义：`cwd=${ZCODE_PROJECT_DIR}`、`SUIAN_SIDE_EDITOR_WORKSPACE=${ZCODE_PROJECT_DIR}`；stdin 请求的 `session_id` 由宿主注入，页面不能指定目标身份 |
| 任务索引 | 默认 `homedir()/.zcode/v2/tasks-index.sqlite`，lab HOME 注入后落在 `<lab>/home/.zcode/v2/` |
| 网关配置 | 评论状态经公共 `connectHost` 的默认路径 `homedir()/.zcode/tools/suian-zcode-gateway/config.json`；已把 lab 网关配置复制到 `<lab>/home/.zcode/tools/suian-zcode-gateway/config.json`（仅 `<lab>/gateway/config.json` 不够，见 K30） |
| 市场提示 | 插件市场“个人”页显示“市场来源已缺失。插件仍可使用，但暂时无法更新。”——手工 cache 安装的预期提示，不影响运行 |

**面板入口实测**（本轮新发现）：local-only 离线时，侧栏“新标签页”的“应用插件”只列推荐位，推荐数据来自远端客户端配置，离线不可得；第三方面板应从侧栏内嵌插件市场进入：`查看所有插件` → `个人` → 该插件卡片 `打开`。主导航的“插件市场”整页没有打开 UI 的入口（`embedded=false` 时不提供 `onOpenUi`）。本轮据此打开真实面板，宿主创建独立 sandbox 实例（OOPIF webview + plugin iframe），页面标题为“文本编辑器”，桥对象含 `callTool` / `readResource` / `subscribeResource` / `updateModelContext` 等真实宿主能力。打开另一会话时创建新的实例（不同 sandbox/instance 标识），与会话绑定。

## 3. 六项验收

### 3.1 真实选区到评论

在真实面板的真实 CodeMirror 实例（`.cm-editor`）中，用标准 CDP 键盘事件（`Control+Home` → `ArrowDown` → `Home` → `Shift+End`）建立第二行选区，点击“评论选区”。对话框回执：

| 字段 | 实际值 |
| --- | --- |
| 位置 | `<lab>/workspace/alpha.txt · 2–2 行` |
| 选文 | `第二行：选择这一行` |
| 评论体 | `请检查第二行`（真实文本输入） |
| 会话/工作区 | 快照 JSON 中为当前会话与 `<lab>/workspace`（见 3.2） |
| 未保存标记 | `unsaved:false`（源与草稿一致时） |

评论体提交后页面显示“待发送评论 1 条”，主对话 composer 出现“插件上下文”附件，说明 Host 受理了 `updateModelContext`。**口径**：选区为真实键盘事件、页面为宿主实际加载的构建页面；按钮点击为页面 DOM click（触发真实 React 处理），不是物理鼠标轨迹；未用合成 DOM 生命周期或伪造 bridge。

### 3.2 入主对话

在 composer 输入普通正文并发送后，`read_session` 读到完整用户消息：

```
LO07 评论提交

# Plugin context:

## Plugin suian-side-editor@suian-zcode-plugins (surface:editor)

文本编辑器选区评论（1 条；快照创建后不随正文变化）
{"schemaVersion":1,"batchId":"…","comments":[{"commentId":"…",
 "sessionId":"{{S1}}","workspacePath":"<lab>/workspace",
 "path":"<lab>/workspace/alpha.txt","title":"alpha.txt",
 "startLine":2,"endLine":2,"selectedText":"第二行：选择这一行",
 "unsaved":false,"comment":"请检查第二行"}]}
```

助手回复 `LO07-MOCK-REPLY` 落库。对话内内容与评论快照逐字段一致：可信会话、工作区、绝对路径、1-based 起止行、选文、评论体、未保存标记、批次与独立评论 ID。**口径**：评论不是“立即发送”，而是按已交付契约进入 composer 草稿，随用户下一条消息进入对话；`updateModelContext` 的成功只代表 Host 受理草稿。

### 3.3 受理反馈、阻止保留与幂等

| 场景 | 实际观察 |
| --- | --- |
| 正常受理 | 批次进入历史后，评论状态资源在 1 秒监测周期内识别；页面从“待发送评论 1 条”变为 0 条，“评论选区”重新可用 |
| 已受理缓存 | 同一批次被识别后，多轮监测与多次对话读取未把评论重新加回待发送列表（连续观察跨多轮会话，含断连重连前后）；服务端以 batchId/序列化去重（`comment-state.mjs` 的 Map） |
| 模型 running 阻止 | 对话框保持打开时发送消息进入 running：提交按钮禁用，tooltip 为“主对话正在处理输入，为避免新增评论被本次发送清理，暂时不能添加评论；处理结束后恢复。这是尽力保护…”；textarea 正文 `运行中保留` 原样保留 |
| 断连阻止 | 打开对话框后强杀 lab 网关：状态变为“评论状态不可用：公共网关健康检查失败：TypeError”，提交禁用，正文 `断连保留` 保留 |
| 发送级失败 | **未注入**（宿主 bridge 为 frozen，页面层无法替换 `updateModelContext`）；以上“阻止”路径均验证不丢评论与选文 |

**幂等口径**：本轮验证的是“已受理批次重复读取不复活、pending 保持 0”，未单独构造重复 batch 序列化上报；服务端去重逻辑由 `comment-state.mjs` 的 Map 键与契约测试支撑。

### 3.4 断连与重连

| 步骤 | 实际回执 |
| --- | --- |
| 强杀 lab 网关 | 评论链路下一次刷新进入 unknown：`评论状态不可用：公共网关健康检查失败：TypeError`；评论按钮与提交均禁用；正文保留 |
| 重启网关 | 同一 config 直启；`/health` 在 **7 秒**恢复 `desktop_connected:true, desktop_ready:true, paired:true` |
| 重连后 | 状态回到 idle（reason 为空），提交重新可用，正文 `断连保留` 保留；点击“加入主对话”成功，随后发送并在对话中读到该批次 |
| 说明 | 重连耗时本轮 7 秒，LO-06 曾约 50 秒；K24 的“数十秒级”结论保留，不写死秒数 |

### 3.5 归属隔离与原文件/恢复副本独立

**会话隔离**（原生）：在会话 A 中产生并受理若干评论后，经 MCP `start_session` 创建同工作区会话 B。切换主对话到 B 后，从内嵌市场打开 side-editor，B 的页面为独立 sandbox 实例、待发送 0 条；在 B 中创建 `第三行：omega` 的评论并发送，B 的对话消息携带 `sessionId:{{S2}}`、`startLine:3`、`comment:"S2隔离评论"`。会话 A 的对话总数保持 10、5 条 user 消息，且不含 B 的评论；A 的评论也未出现在 B 中。

**工作区隔离**：本轮只打开一个工作区，未做原生跨工作区验证；工作区绑定由 `boundContext` 从宿主启动环境与会话项目上下文校验，`context.test.mjs` 覆盖“工作区来自启动绑定、页面无法指定、缺失/冲突阻止”，本轮与评论契约测试一并 19/19 通过（`lo07-side-contract-tests.log`，EXIT=0）。因此工作区污染结论为“源码/契约层满足，原生未验”。

**原文件与恢复副本独立**：

| 项 | 实际值 |
| --- | --- |
| 源文件 `alpha.txt` SHA-256 | 编辑与评论前后均为 `ab2b2a6b…`（`lo07-alpha-before.sha` 与复核一致） |
| 编辑状态 | 在第二行末尾输入 ` unsaved` 后状态“未保存”；评论位置追加“包含未保存编辑”，快照 `unsaved:true`，选文含 ` unsaved` |
| 恢复副本 | `editor-state.sqlite` 的 `session_recovery` 行保存草稿：`text` 含 ` unsaved`、`diskText` 为原文、`baseVersion` 为源文件版本；与源文件保存互不代替 |
| 收尾 | 关闭页签时选择“放弃修改”，编辑器回到“选择文件开始编辑”，源文件哈希不变；评论验证未隐式写用户文件 |

### 3.6 模型状态口径

用受控 mock 的 hold-stream 模式构造“长轮次”：评论已进入 composer 并发送后，模型请求被挂起，主对话显示“工作中 / 停止生成”。此时：

- 评论状态显示 **busy** 及“主对话正在处理输入…”（状态资源 `source=task-snapshot`），不是 admission pending。
- 但待发送评论已为 **0 条**：本插件批次已出现在会话历史/队列中，受理证据独立于模型完成。
- 挂起的模型请求释放后，状态回到 idle，预先打开的第二个对话框恢复可提交；随后提交、发送、受理均正常。
- mock 调用锚点：7 次 `kind=turn,stream=true`、1 次 `held`（`lo07-mock-model.jsonl`）；无登录态下全部模型调用来自受控本机 mock（合成），不代表真实模型质量或计费。
- 未验：真实账号模型；发送级失败注入；Toast/原生通知视觉。

## 4. 验证构造与影响面

- **权限模式**：测试会话以 `permission_mode:"yolo"` 创建，避免 app-only UI 工具在 build 模式逐个等待人工审批；这是验证构造，不是产品默认。`read_session` 的 `permission_mode` 读回为 `build`（CLI 会话库持久值），而 composer 与运行期显示“完全访问”，UI 工具实际放行——两者口径不同，不能拿持久字段判断运行期权限（K29）。
- **模型**：受控 provider 的 manual model 配置在 3.16.2 下不接受 `optionSpecs.maxOutputTokens.map`（`unrecognized_keys`），去掉 `map` 后 Host 正常加载（K28）。
- **启动门**：全新 lab 首次进入主界面需要 `providerFamilyDomain`（`<lab>/home/.zcode/v2/setting.json`）；只有 personal provider 时仍会停在欢迎/登录页。这是无登录验证构造，不是产品缺陷（K28）。
- **未修改产品代码**：本轮未发现需要修正的 side-editor/common/app-mcp 业务行为；无先红后绿项。`sources/` 全程只读。

## 5. 票面验收条件自评（6 条）

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | 真实 CodeMirror 选区与已构建页面，核对可信工作区/会话、路径、行号、选文、评论与未保存标记进入当前主对话 | **满足** | §3.1/§3.2：真实 OOPIF 页面、真实 CodeMirror、真实键盘选区；对话内 JSON 逐字段一致 |
| 2 | 正常受理、失败/阻止内容保留、已受理缓存与断连/重连实际状态，按已交付契约解释 | **满足**（失败以阻止路径覆盖） | §3.3/§3.4：正常受理→pending 0；busy/未知均禁用且正文保留；重连 7 秒恢复；发送级失败未注入，已如实标注 |
| 3 | 不以模型 running 冒充 admission pending；不把 local-only 适配当作完整原生并发；#57 独立、#47 不改写 | **满足** | §3.6：running 时 busy 与已受理并存；§6 明确 #47/#57 边界 |
| 4 | 评论不跨会话/工作区污染；原文件保存与恢复副本独立回执，不隐式写用户文件 | **满足**（工作区原生未验） | §3.5：A/B 会话原生隔离；源哈希不变、恢复副本独立；跨工作区仅契约/源码层 |
| 5 | 仅在证据需要时最小修正并先红后绿；不改只读 sources、不用合成 DOM 生命周期 | **满足**（无产品修正） | §4；真实宿主页面与真实 CodeMirror；未修改 `sources/` |
| 6 | 独立提交包/插件/网关摘要、日志退出码与已验/失败/未验清单；不阻塞或反向改写首轮 MCP | **满足** | §1/§2 摘要；§7 清单；不关闭 #47/#57，不改写首轮结论 |

## 6. 既有评论限制（不改写、不夸大）

- **#47 原缺口保持**：未观察时“受理后取消、且当前投影已无 queue/userInput”的场景仍不能由本链路证明；历史结论与冻结证据不改写。
- **#57 完整并发独立**：本票不宣称完整原生并发评论、完整同步/批次或在途追加完成；临时禁用是已交付的尽力保护，禁用窗口可能覆盖模型回复，发送边界仍有残余风险（ADR 0005）。
- **状态口径**：unknown/断连不当空闲；busy 是保守代理，可能覆盖整个回复期；评论受理以对话历史/队列中的本插件批次为准，不以模型结束或 running 猜测。
- **超时与重试**：模型请求挂起约 45 秒时观察到 Host 重发请求（mock 记录一次额外 turn）；本票未深究该宿主行为，不代表评论链路失败。

## 7. 已验 / 失败 / 未验清单

**已验**：三包构建与摘要；lab 21/21；补丁 v2；网关 local-only；三插件发现与启用；真实面板打开；真实选区/评论/入对话；受理反馈；busy 阻止；断连 unknown 与 7 秒重连；会话隔离；源文件/恢复副本独立；受控轮次完成与 mock 锚点；日常环境只读复核。

**失败**（保留记录）：

- 首次手动启动后窗口停在欢迎页；根因为 `providerFamilyDomain` 未设置，不是插件失败（§4/K28）。
- 首次 provider 配置含 `maxOutputTokens.map` 被 Host 拒绝（Zod `unrecognized_keys`），修正后加载（K28）。
- 首次打开“应用插件”时点到 App MCP 卡片，打开的是“会话工件”而非编辑器；按卡片定位后打开 side-editor（K25）。

**未验**：真实账号模型；发送级失败注入；原生跨工作区；物理鼠标逐按钮操作；Toast/通知视觉；多面板并发与在途追加（#57）；真实用户产品验收。

## 8. 复现要点（占位符）

1. 构建三包（`build-release.mjs --out …`），lab `setup`/`check`（21/21）。
2. 插件装 `<lab>/storage/cli/plugins`（cache + `installed_plugins.json` + `data/<id>`），写 `home/.zcode/cli/config.json` 的 `enabledPlugins`。
3. 写完整 manual provider 配置（3.16.2 的 `maxOutputTokens` 只含 `max`），写 `providerFamilyDomain`，起双模式 mock。
4. `patch.mjs prepare/apply` → 写 `home/.zcode/local-only.flag`（首行工作区）→ 部署并直启网关；把网关配置复制到 `home/.zcode/tools/suian-zcode-gateway/config.json`。
5. `lab.mjs launch --workspace … --remote-debugging-port …`；用 app-mcp stdio 创建 `yolo` 会话。
6. 侧栏 `查看所有插件` → `个人` → `打开` 文本编辑器；真实键盘选区 → 评论 → 加入主对话 → 发送；通过 `read_session` 核对 `# Plugin context:` 块。
7. 断连：强杀网关观察 unknown 与正文保留；重启网关等待 `desktop_ready` 后复提。

## 9. 收尾与日常环境

- lab `teardown --purge`：`{"purged":true}`（`lo07-teardown.log`，EXIT=0）；`patch-candidate/` 残留 326 MB 已手工删除；lab 目录仅余日志/网关工具（约 2 MB）；lab ZCode 进程 0 个。
- 日常安装 asar 仍为 `1f960ba2…`；日常网关 17329 全程 LISTENING；日常 `installed_plugins.json` mtime 为本轮开始前，内容不含 lab 路径（`lo07-daily-check.log`）。
- 原始截图、mock 日志、会话 ID 与 lab 路径只留 `.scratch/`（git 忽略），不入库。
