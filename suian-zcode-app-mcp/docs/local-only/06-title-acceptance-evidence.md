# LO-06 真实 Stop 自动命名与标题保护验收证据（脱敏）

**执行日期**：2026-10-21。**代码基线**：`caafde8`（feat/local-only-integration，LO-05 与 review 修复后）于 worktree 分支 `feat/lo06-title-acceptance` 验证。**对象**：三个真实构建发布包（common 0.6.0 + app-mcp 0.11.0 + title 0.2.0）、lab 隔离副本（3.16.2.8769，字节身份与登记一致）、补丁 v2、lab 网关、受控本地模型服务。**结论先行**：真实 Stop 触发链在 local-only 隔离环境成立——受控会话轮次真正完成（模型真实被调用、助手回复落库）→ Stop Hook 派发 → 命名 worker 经网关读取历史并生成候选 → 经原 Host 改名 → 读回一致；锁定/解锁/跨会话隔离/手动保护均按契约工作；命名模型不可达与网关不可达分别给出可区分的失败反馈；失败轮不触发 Stop（源码与实测双向一致）。**模型口径如实**：无登录态，真实账号模型不可得；全部模型调用来自受控本机 mock（合成），已用调用锚点与落库回复双重核对。

原始日志、lab 数据与安装记录留在 git 忽略的 worktree 根 `.scratch/`（`logs/lo06-*.log`、`local-only-lab-lo06/`）；本文只收脱敏摘录，不写会话 ID、令牌与本机路径。

## 1. 构建与加载入口

| 项 | 值 |
| --- | --- |
| common 发布包 | 0.6.0，buildId `018f4626…`，58 文件，commonApiVersion 1（`lo06-build-common.log`） |
| app-mcp 发布包 | 0.11.0，buildId `0c7775bd…`，22 文件，dist 三入口（`lo06-build-app-mcp.log`） |
| title 发布包 | 0.2.0，buildId `3604d987…`，15 文件，四入口（cli / hook / install / toast-action）（`lo06-build-title.log`） |
| 原版 asar | `1f960ba2…`（lab 副本与日常安装逐字节一致，`identityMatch:true`） |
| v2 补丁 asar | `71c640b5…`（与 LO-03 登记一致；`patch.mjs apply` 真实执行） |
| lab 检查 | `{"ok":true,"total":21}` 全 PASS（`lo06-lab-check.log`） |
| 网关 | 部署 buildId `ac0e0c0d…`；`/health` mode=local-only、relay_protocol_version=2、`upstream_connected:false`（全程） |
| 会话 MCP | stdio 实连 dist 入口；工具清单 20 个，与首轮一致（`lo06-mcp-list-tools.log`） |

lab 的 local-only 状态由补丁工具 + 标志文件 + 网关直启构成（不再执行 setup.ps1 以避免对日常计划任务/注册表/环境广播的真实写入；setup 产品流程已由 LO-04/05 验证）。启动仍走 `lab.mjs launch`（死代理 + CDP + workspace）。

## 2. 插件发现根实测（本轮新发现，修正 LO-05 指南）

**结论**：lab 中宿主真实加载插件的根是 `{{lab_dir}}/storage/cli/plugins`（由 lab env `ZCODE_STORAGE_DIR={{lab_dir}}/storage` 派生为 `<storage>/cli/plugins`）；LO-05 指南原写的 `{{lab_dir}}/plugin-home/cli/plugins` 不是宿主发现路径。另外，**第三方安装记录必须同时在 `{{lab_dir}}/home/.zcode/cli/config.json` 的 `plugins.enabledPlugins[<id>]=true` 才会被加载**（Host 的 `readEnabledPluginRecords` 只接受显式 true）。

**方法（A/B/C 三路径探针）**：同一插件分别装到三个候选根，各自 SessionStart/UserPromptSubmit 写独立 marker；探针内含 `ZCODE_PLUGIN_ROOT`/`ZCODE_PLUGIN_DATA` 实际值。

| 候选根 | 来源 | marker 次数 | 结论 |
| --- | --- | --- | --- |
| `{{lab_dir}}/storage/cli/plugins` | lab env `ZCODE_STORAGE_DIR` | **21**（后续真实会话继续追加） | **宿主实际发现根** |
| `{{lab_dir}}/home/.zcode/cli/plugins` | 无 env 时的默认 `~/.zcode` | 0 | 未被发现 |
| `{{lab_dir}}/plugin-home/cli/plugins` | LO-05 指南原路径 | 0 | 未被发现 |

marker 实际内容（节选，脱敏）：`pluginRoot=…/storage/cli/plugins/cache/zcode-plugins-official/lo06-probe-…`、`pluginData=…/storage/cli/plugins/data/lo06-probe-…`，事件为 `SessionStart(startup)` 与 `UserPromptSubmit`，stdin 为标准兼容字段（`session_id`/`cwd`/`hook_event_name`/`stop_hook_active`）。

**由此产生的文档修正**（本票合理范围）：[05-local-only-guide.md](05-local-only-guide.md) §2.2 的存储根改为 `storage/cli/plugins`，补充 `enabledPlugins` 门槛与 `data/<plugin-id>` 形态；§2.4 补充受控 provider 的完整手动模型配置要求。

## 3. 真实 Stop 触发链（核心）

**链路**：MCP `start_session`（受控输入）→ Host 真实执行一轮 → 模型真实调用（受控 mock）→ 助手回复落库、会话 `completed` → **Stop Hook**（异步）→ 8 秒延迟 → 命名 worker → 读取任务索引 + CLI 会话库（历史裁剪）→ 经公共网关附着原 Host → `generateWorkspaceText`（命名模型真实调用）→ 校验候选 → `renameTask` → 三处核验 → 读回。

| 环节 | 证据 |
| --- | --- |
| 轮次真实完成 | `read_session`：2 条消息（user 注入标记 + assistant 合成回复），`status:"completed"` |
| 模型真实调用 | mock 锚点：14 次 `kind=turn,stream=true`（SSE）+ 8 次 `kind=title,stream=false`；非流式/SSE 双模式均被实际使用 |
| Stop 真实触发 | 插件自身 `hook.log.jsonl`：`{"event":"Stop","action":"dispatched","stopHookActive":false}`（每轮一条） |
| 历史读取与决策 | `runner.log.jsonl`：`command:"run"`、`status:"renamed"`、`durationMs≈240`；`usage.jsonl` 记录 `selectedTurns`、usage 与 selection |
| 改名经原 Host | runner 状态 `renamed` 后 `read_session`/`list_sessions` 标题读回候选标题；双库标题一致（索引与 CLI 库同值） |
| 无串扰 | 各会话 `data/state/<session>.json` 与 `session-titles/<session>.json` 独立；跨会话触发互不影响（见 §4） |

一次基线轮的实际标题迁移：初始 `🛠️ …` → 候选 `🧩 …｜…`（候选同时满足"emoji + 对象｜目标 + ≤48 字符"规则），`action:"rename"` 生效。

## 4. 标题保护矩阵

| 场景 | 触发方式 | 命名结果 | 命名模型调用 | 标题结果 |
| --- | --- | --- | --- | --- |
| 基线自动命名 | 真实 Stop | `renamed` | 有（turn+title） | 初始 → 候选 |
| MCP `lock_title=true` | 真实 Stop | `locked` | **无** | 保持不变 |
| 公共 `cli.mjs lock` | 真实 Stop | `locked` | **无** | 保持不变 |
| 公共 `cli.mjs unlock` | 真实 Stop | `renamed` | 有（turn+title） | 更新为新候选 |
| 跨会话：A 未锁 / B 已锁 | 各自真实 Stop | A `renamed`、B `locked` | 仅 A 有 title 调用 | A 变、B 不变 |
| 无公共策略 + 用户手动改名 | 真实 Stop | `manual_title` | **无** | 保持不变；状态文件写入 `locked:true` |
| 模型返回不合规标题 | 真实 Stop | `failed`（`标题长度或类别格式无效`） | 有（turn+title） | 保持不变（拒绝写入） |

补充：MCP 创建写 `locked:false` 的公共策略时，按契约"false 明确不锁"，命名层继续接管；`manual_title` 保护针对**无策略**会话（本轮用"移除策略文件"构造，见 §8 未验项）。重复执行 `lock`/`unlock` 幂等，回执带 `previous`/`policy`。

## 5. 失败反馈与恢复边界

四条失败/边界均保留"不改标题、不误报成功、可按日志定位"的口径：

| 场景 | 构造 | 结果 | 恢复 |
| --- | --- | --- | --- |
| 命名模型不可达（轮次正常） | title `selection` 指向第二 provider（死端口）；真实 Stop | `runner.log`：`status:"failed"`、`error:"Model request was cancelled."`、`durationMs≈60s`、`reasonCode:null`；标题不变 | 切回正常 selection 后下一轮恢复 |
| 网关不可达 | 在 Stop 触发后的 8 秒派发窗口内杀掉 lab 网关（真实 Stop 已发生） | `runner.log`：`status:"failed"`、`reasonCode:"gateway_unreachable"`、`durationMs≈0.5s`；标题不变 | 重启网关后 Host 重连；再一轮 Stop `kept`（模型真实调用） |
| 轮次模型不可达 | `start_session` 显式 `model` 指向死 provider | 轮次失败；**该会话 Stop 记录 0 条**（hook.log 无条目，探针仅有 SessionStart/UserPromptSubmit）；标题不变 | 换回可用模型的新轮次正常 |
| 官方远控离线 | 全程 | 网关 `upstream_connected:false`、`paired:true`（本地配对） | 与模型不可达分开记录：官方上游离线不影响本地命名链 |

**源码与实测一致**：Stop Hook 只在轮次正常完成（模型响应落盘）后运行；轮次失败走 TurnError 路径，不触发 Stop。因此"模型不可达"的失败反馈由会话错误状态承担，不会被命名层吞掉或伪装成功。

口径提示：命名模型不可达时失败要等模型请求超时（本轮约 60 秒），且当前不带 `reasonCode`/Toast（这是已交付契约：Toast 仅覆盖远控类失败）；网关不可达则在秒级返回 `gateway_unreachable`。

## 6. 归属、网络与日常环境

| 项 | 证据 |
| --- | --- |
| 测试会话归属 | 4 个测试会话只在 lab `session-db/db.sqlite` 与 `home/.zcode/v2/tasks-index.sqlite`；日常两库按相同 ID 查询均 0 命中 |
| 标题策略归属 | 只在 lab `home/.zcode/tools/suian-zcode-common/session-titles/`；日常同名目录无本轮新增文件（最新文件为 10 月中旬） |
| 安装记录 | 三插件按 PKG-01 形态装 lab `storage/cli/plugins`（cache + installed_plugins.json + data/<id>）；日常 `installed_plugins.json` mtime 未变 |
| 网关 | lab 127.0.0.1:17331；日常 17329 全程 LISTENING；lab 网关 `upstream_connected:false` |
| 网络 | lab 主进程仅回环 17331；唯一外部为 TUN fake-ip `198.18.x.x:443` 噪声（与 LO-01~05 同形态），无官方端点直连 |
| 日常安装 | 日常 `app.asar` 全程 `1f960ba2…`（原版，只读） |
| 模型请求来源 | 唯一受控 mock（127.0.0.1:{{mock_port}}），14 次 turn + 8 次 title，全部命中锚点日志 |
| 重置卡/日常会话 | 未消耗、未触碰 |

**一处需说明的副作用及还原**：title 原生安装会写 HKCU `suian-zcode-title` 协议键与开始菜单快捷方式。lab 安装把协议键指向 lab 路径后已**立即还原为日常值**（两次安装各还原一次，记录于 `lo06-protocol-registry-remediation.log`）；快捷方式与 AppID 只落在 lab `appdata`。

## 7. 票面验收条件自评（5 条）

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | 受控会话真实生成轮触发已安装 Stop Hook，验证历史读取、辅助生成、改名与读回；不以手动入口或 MCP 改名代替 | **满足** | §3 全链：轮次完成 + Stop 派发 + 命名模型真实调用 + 经原 Host 改名 + 读回；手动 `lock`/`unlock` 仅用于保护矩阵，不充当触发证据 |
| 2 | 验证受测会话 ID、标题规则、公共 lock/unlock 与已交付手动保护，防止跨会话或覆盖已固定标题 | **满足** | §4 矩阵（锁/解锁/跨会话/manual_title/格式拒绝）；策略与状态均按会话 ID 隔离 |
| 3 | 网关或模型不可达时保留正确失败反馈与恢复边界，不吞错、不混淆官方远控离线与模型离线 | **满足** | §5 四场景分层；失败均不改标题、不误报；恢复均有实证 |
| 4 | 记录 local-only 无官方上游连接、模型来源与真实/合成边界；不消耗重置卡或日常会话 | **满足** | §6 归属与网络；模型为合成 mock，明确标注；日常两库/注册表/asar 只读 |
| 5 | 新增行为或修复先红后绿；独立报告真实 Hook 与模型证据，不自动关闭其他议题 | **满足（无产品代码修改）** | 本轮无业务适配需修改；文档修正为已合入指南的路径偏差；不关闭首版功能、#57 等议题 |

## 8. 未验项与边界

- **真实账号模型**：无登录态不可得；本轮全部模型调用为受控 mock（合成），不代表真实模型质量或计费行为。
- **Toast 视觉渲染**：失败路径只核对结构化回执与日志字段，未截图验证原生通知横幅/按钮（按钮协议链路按约定不触发）。
- **桌面 UI 创建会话的手动保护**：本轮以"移除公共策略文件"构造无策略会话验证 `manual_title`；真实 UI 新建会话的 `titleSource/custom` 组合未逐一覆盖（源码路径与 MCP 会话相同）。
- **CronCreate 标题冻结豁免**：本轮未触发。
- **真实用户验收**：本票为代理验证口径；产品语义仍需用户在日常环境确认。
- 失败轮在任务索引留下 `meta_json 非法` 的宿主日志（失败轮特有，非本插件写入）；未定位其是否为 3.16 已知行为。

## 9. 复现要点（占位符）

1. 构建三包（`build-release.mjs --out …`），lab `setup`/`check`（21/21）。
2. 探针/正式插件装 `{{lab_dir}}/storage/cli/plugins`，写 `installed_plugins.json` 与 `home/.zcode/cli/config.json` 的 `enabledPlugins`。
3. 写 `provider_config.json`（完整 manual model 配置）+ 起双模式 mock（记录 `MODEL_CALL`）。
4. `patch.mjs prepare/apply` → 写 `home/.zcode/local-only.flag`（首行工作区）→ 部署并直启网关。
5. `lab.mjs launch`（首启初始化一次后重开），`/health` 三项 true 后以 stdio MCP 驱动 `start_session`。
6. 观察顺序：mock `MODEL_CALL(turn)` → `read_session` 出现 assistant → `hook.log` Stop → `runner.log` 命名结果 → `list_sessions` 标题。
