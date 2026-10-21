---
name: debug-isolated-zcode
description: 调试隔离 ZCode Desktop/CLI 实验环境（local-only lab）：lab 工具用法、分层排查方法论与已知卡点（欢迎页卡住、单实例锁、开关时序、PowerShell/asar 坑）。在 ZCode-Plugins 仓库搭建、启动或诊断隔离 ZCode 环境，或排查 local-only 补丁链路问题时使用。
---

# 调试隔离 ZCode 环境

隔离 ZCode 环境 = 复制的运行包 + 独立数据根 + 进程级环境变量集，用于在不触及日常安装（`{{日常安装目录}}`）、日常 `~/.zcode` 与日常网关（127.0.0.1:17329）的前提下验证 Desktop/CLI/补丁行为。本技能沉淀 local-only 系列（LO-01 起）的排查方法与踩坑实录。

## 适用场景

- 用 lab 工具搭建、启动、检查、清理隔离环境（`suian-zcode-common/local-only/`）
- 隔离 Desktop 启动后行为异常（卡页面、连不上网关、auth 报错、进程退出）
- 补丁应用/还原后验证，或怀疑环境变量未生效、越界写入
- 排查隔离环境下的网关握手、Host 附着问题

不适用：日常 ZCode 安装本身的故障（那是 zcode-guide 系列的领域）；本技能只管隔离副本。

## 环境速查

| 项 | 值 |
| --- | --- |
| lab 工具 | `suian-zcode-common/local-only/lab.mjs`（setup / check / launch / report / teardown） |
| 补丁工具 | `suian-zcode-common/local-only/patch.mjs`（status / prepare / apply / restore） |
| 单一数据源 | `lab-env.mjs`（目录树、env 集、包字节身份）；`patch-env.mjs`（锚点、开关约定、退出码） |
| lab 目录布局 | `app/`（运行包副本）、`home/`、`desktop-user-data/`、`desktop-session-data/`、`session-db/`、`gateway/`、`workspace/`、`logs/`、`run-state.json` |
| 日志位置 | lab 内 `logs/desktop.out.log`、`logs/desktop.err.log`；流程日志在 `suian-zcode-common/.scratch/logs/`（忽略目录，不入库） |
| 网关健康 | `curl http://127.0.0.1:<lab端口>/health`（lab 默认 17331；日常网关占 17329，勿碰） |

**先读 run-state.json**：记录了主进程 PID、全部隔离 env、代理端口。后续一切判断（杀谁、查谁的网络、核对哪个路径）以它为锚。

## 排查方法论（按层收缩）

1. **进程层**：副本进程还活着吗（按 run-state 的 PID 与 exe 路径过滤，勿用进程名全局匹配——日常 Desktop 同名）？主进程还是仅剩子进程？
2. **UI 层**：卡在哪个页面（欢迎页/登录页/主页）？桌面截图或 CDP 观察；注意首次启动必经欢迎引导。
3. **日志层**：`desktop.err.log` 从后往前读——Electron main 的未捕获错误、IPC handler 报错（如 `zcode:start-web-remote-control`）都在这里；`desktop.out.log` 看 `[main]`/`[host]` 生命周期与 RPC 调用结果。
4. **网络层**：按 PID 查 TCP 连接（回环 = 本地链路；外部 443 = 官方尝试或 TUN 残留）；网关 `/health` 的 `desktop_connected`/`desktop_ready` 区分"没连上"与"连了但没就绪"。
5. **环境层**：`lab.mjs check` 核对各 env 实际解析路径都在 lab 内；对照坑 K4（ZCODE_DATA_BASE_DIR 语义）。
6. **时序层**：开关/标志/补丁的求值时机 vs 创建时机（坑 K5）；进程启动早于标志文件创建时，重启进程才生效。

每层先收集事实再下结论；"设置了变量"不等于"实际生效"，以 check 输出和日志中的实际路径为准。

## 已知坑实录

> 每条注明来源票与证据位置；未核实的推测单独标注。**新增坑按 K 编号追加，格式：症状 / 根因 / 解法。**

### K1 首次启动卡欢迎页（可用 workspace 启动参数绕过）

- **症状**：隔离副本首次启动停在欢迎/引导页，无登录态时脚本自动化无法继续；远控面板等入口不可达。
- **根因**：欢迎引导是首启必经流程，完成状态记在 userData 内（具体持久化文件名仍未定位，未回填）。
- **解法（LO-03 升级）**：启动时把工作区路径作为**位置参数**传给 exe（官方 argv 语义 `extractOpenWorkspacePathFromArgs`），Desktop 直开该工作区、绕过欢迎页，无需人工或 UI 自动化——`lab.mjs launch --workspace <路径>` 已内置。远控 attach 的 workspace 与窗口一致时 connectHost 才能通过（不一致报 "Requested local workspace is not open in the Desktop window"）。历史手段（人工点击一次、CDP 直调 IPC）保留为备选。
- **CDP 补充（LO-02 实证）**：CDP 可越过 UI 直接调用官方 IPC 验证 main 链路；CDP 连接需给 Electron **命令行**传 `--user-data-dir`（env 不够，见 K11）。
- **来源**：LO-02 实录；LO-03 升级解法（证据文档 `03-lifecycle-evidence.md` §3.1/§6）。

### K2 PowerShell 5.1 启动链五坑（LO-01 全部踩过）

- `powershell -Command` 不收尾部 `$args` 传参——参数改走 `-File` 或环境变量。
- 写出的 JSON 带 BOM 导致读回解析失败——统一 `utf8` 无 BOM 写入。
- WQL 查询里的反斜杠路径未转义导致进程枚举失败——WQL 字符串内 `\` 要写成 `\\`。
- `detached + windowsHide` 启动 PowerShell 会静默不执行——改引导器同步等待 + `stdio:'ignore'` 防管道继承挂起。
- teardown 后进程退出有延迟，立即删目录报 EBUSY——等待退出 + 重试。
- **证据**：LO-01 提交 8d08f23 回归测试与 `.scratch/logs/local-only-lab-*.log`。

### K3 单实例锁：userData 隔离即可避免锁转交

- **症状**：担心副本启动把命令行转交给日常窗口（Electron 单实例）。
- **事实**：锁基于 userData（官方源码 index.ts:2010；e2e 注释 desktopRuntimeEnv.ts:62-67 佐证）；设 `ZCODE_DESKTOP_USER_DATA_DIR` 指向 lab 内目录后，副本与日常 Desktop 并存无转交（LO-01/LO-02 均实证）。

### K4 ZCODE_DATA_BASE_DIR 指向 `.zcode` 的父目录

- 语义：`ZCODE_DATA_BASE_DIR > HOME > homedir()`（官方 paths.ts:14-15），它的值是**数据根目录**（home 层级），`.zcode` 会在其下派生。把它设成 `.zcode` 本身会得到 `.zcode/.zcode` 双层。
- lab 惯例：`ZCODE_DATA_BASE_DIR` = lab 的 `home/` 目录，`HOME`/`USERPROFILE` 同指它。
- **来源**：LO-01 实施核实（写进 `01-original-baseline-evidence.md`）。

### K5 local-only 开关在模块加载期一次性求值——标志文件晚了不生效

- **症状**：补丁已 apply、标志文件已存在，`zcode:start-web-remote-control` 仍抛 `auth-required`。
- **根因（LO-02 已证实）**：补丁 P1 的 `__LO_MODE` 在 main bundle 模块加载时**一次性求值**；进程启动早于标志文件创建时 `__LO_MODE` 固化为 false，getLogin 短路（P2）不触发。判定优先级：env `ZCODE_LOCAL_ONLY` > `{dataBaseDir}/.zcode/local-only.flag` > `{APPDATA}/ZCode/local-only.flag`。
- **解法**：先创建标志（或设 env）再启动进程；顺序错了就重启进程。时序验证脚本参考 `.scratch/lo02-simulate-gate.mjs`（LO-02 worktree）。
- **来源**：LO-02 实证（证据文档 §实测补充）。

### K6 "官方不可达"构造：死代理 + 观察，注意 TUN 残留

- 构造：启动时给 exe 传 `--proxy-server=http://127.0.0.1:<死端口>`，Chromium 栈请求全部失败（日志可见 `net::ERR_PROXY_CONNECTION_FAILED`）。
- **注意**：本机若有 TUN 代理，仍可能观察到 `198.18.x.x:443` 之类外部连接（TUN 虚拟网段）——这是经系统代理的连接，不等于官方远控直连；证据里要区分"经 TUN 的连接"与"对官方端点的直连尝试"，不能只看"有无外部连接"。
- **来源**：LO-01 基线两轮实录（`01-original-baseline-evidence.md`）。

### K7 网关端口：lab 必须 17331，日常占用 17329

- 日常网关常驻 127.0.0.1:17329（mode=relay，V2）。lab 网关独立端口 17331 + 独立 config（`gateway.mjs --config <lab>/gateway/config.json`），互不影响；勿对 17329 做任何写操作。

### K8 判断"子代理是否还活着"：任务索引不可靠，文件活动为准

- **症状**：SendMessage/TaskOutput 报"无活动任务"，但子代理实际仍在运行收尾。
- **解法**：查其 worktree `.scratch/` 最近文件 mtime（5 分钟内有新文件 = 在工作）；发信失败≠代理死亡。协调者不要仅凭任务索引结论接管工作。
- **来源**：本系列协调过程实录（2026-10-21，LO-02 收尾期误判后纠正）。

### K9 无登录首屏 UI 不触发远控启动链（renderer 触发缺口）

- **症状**：补丁就绪、开关开启，但 Desktop 起来后远控不启动、网关 `desktop_connected:false`。
- **根因（LO-02 已证实）**：官方 `manager.start` 仅由 renderer IPC（`zcode:start-web-remote-control`）触发；无登录态首屏不出远控入口，main 侧无人调用 start。main 日志零条目佐证（远控链路完全未启动，不是启动失败）。
- **解法（LO-03 已落地）**：补丁 v2 P6 自动启动——开关开启且标志文件首行（或 env `ZCODE_LOCAL_ONLY_WORKSPACE`）给出工作区时，main 初始化后轮询触发 `li.start`（getStatus 非 idle 即停，与 renderer 手动 start 并存幂等）。冷启动闭环已实证（`03-lifecycle-evidence.md` §3.1）。CDP 调 IPC 仍是有效的链路级诊断过渡手段。
- **来源**：LO-02 具名缺口（证据文档 §10 未验项）；LO-03 补齐。

### K10 向 minified 模块顶层注入 var 会与产物压缩名冲突（LO-03 首个真实红灯）

- **症状**：注入后副本进程启动即退出、零远控日志；对注入结果跑 `node --check` 报 `SyntaxError: Identifier 'b2' has already been declared`。
- **根因**：注入体的 `var b2` 位于 `if` 块内但 var 提升到模块顶层，与产物顶层已有的 `let b2` 冲突；minified bundle 顶层占满 1-2 字符压缩名，任一裸 var 都可能撞车。
- **解法**：注入求值逻辑全部收进 IIFE（函数作用域隔离），模块顶层只声明 `__LO_*` 唯一前缀变量；契约 fixture 顶层预置 `let b2` 占位，使 `node --check` 用例能抓同类回归；**每次 prepare 后对真实产物注入结果跑一次 `node --check`**（fixture 通过不代表真实包通过）。
- **来源**：LO-03 实录（`03-lifecycle-evidence.md` §6 踩坑 1）。

### K11 lab launcher 每次启动前重渲染；CDP 需命令行 --user-data-dir

- **症状一**：手工给 `launcher.ps1` 加的 env/参数在下次 `launch` 后消失。
- **根因**：`launchLab` 每次启动前用当前工具版本重渲染 launcher，覆盖一切手工修改。
- **解法**：lab 需要的启动条件一律走 `lab.mjs` 选项（本票已固化：`--remote-debugging-port` 自动附命令行 `--user-data-dir`；`--workspace` 位置参数；网关 env 自动与 `gateway/config.json` 端口一致）。
- **症状二**：CDP 端口在监听但 `/json/list` 空。**根因**：Electron 41/Chromium 146 对默认数据目录下的远程调试有安全缓解，**必须命令行传 `--user-data-dir`**（仅设 env 不够）；且 PowerShell `Start-Process -ArgumentList` 数组元素不自动加引号，含空格路径需自行内嵌双引号（单引号会成为路径字面量）。
- **来源**：LO-03 实录（`03-lifecycle-evidence.md` §6 踩坑 3/4）。

### K12 绕过 lab 工具手动构造 env 启动的副本实例会早退（根因未定位）

- **症状**：用自写 PowerShell 启动器（复刻 lab env 集 + 额外覆盖变量）启动副本，进程停在 crash-capture 日志后静默退出，三次复现。
- **现状**：与 lab launcher 的差异未定位（env 传递路径或参数形态）；验证条件的构造应优先扩展 lab 工具选项而不是绕开它。涉及"非回环网关覆盖"的原生观察因此未达成（以契约层断言支撑，见 `03-lifecycle-evidence.md` §3.6）。
- **来源**：LO-03 实录。

### K13 重置 userData 后 workspace 直开不创建主窗口；判断窗口存在要用 CDP targets

- **症状**：lab 重置 userData/sessionData/home 后 `launch --workspace` 启动，主进程存活但零 `[web-remote-control]` 日志、P6 不触发；补丁版与**原版 asar 对照**同样无窗口——即与补丁无关的环境行为。userData 完成过一次首启初始化后（哪怕由原版完成）再启动一切正常。
- **根因**：未定位（疑似首启引导流程在全新 userData 下未按 workspace 参数创建主窗口；与 LO-03 当时"workspace 直开绕过欢迎页"的表现不一致，同日内环境行为变化）。main 日志特征：停在 crash-capture/deep-link/startup/auto-update 一段，无窗口创建迹象。
- **解法**：验证依赖窗口的链路前确认 userData 已完成首启（先用一轮普通启动初始化）；**判断"有没有窗口/页面"以 CDP `--remote-debugging-port` 的 `/json/list` targets 为准**——`MainWindowTitle` 为空与按 exe 的 WQL 进程枚举都曾给出假阴性（枚举漏 renderer）。
- **来源**：LO-04 实录（`04-setup-integration-evidence.md` §4 未验项）。

### K14 复用 setup 契约测试桩做 lab 端到端 runner 的三个对齐点

- **场景**：需要在 lab 语义下真实执行 setup.ps1 与补丁工具、又不能碰真实任务/注册表/广播时，从 `tests/setup.test.mjs` 提取 systemFixture 作 Windows 边界桩（lab runner 脚本留在 `.scratch/` 不入库）。
- **对齐点**：① 桩 fixture 的 `build.id` 必须是**部署 CLI 从构建目录实算的 candidateBuildId**（`gateway-deploy.mjs --status`），不是 release.json 的构建指纹——部署清单输入与构建清单不同，setup 健康核对按前者；`version` 字段也要带上。② 移除 `Invoke-PatchCli` 桩后 setup.ps1 的守卫式默认定义自动生效，补丁工具即真实执行（apply/restore 拒绝语义同理可证）。③ 从测试文件正则提取 fixture 时注意文件是 CRLF（正则 `\`;\r?\n`），Windows 边界桩模板对属性访问要防御 `Set-StrictMode`（StrictMode 随调用栈传播到桩函数）。
- **来源**：LO-04 实录（lab runner 三次红灯后对齐）。

### K15 lab 中独立 MCP/CLI 进程必须注入 lab HOME/USERPROFILE

- **症状**：宿主 stdio 语义下直接以日常 env 启动 lab 安装的 app-mcp CLI，title-policy 等按 `homedir()` 落盘的路径会写到**日常** `~/.zcode/tools/…`（越界）。
- **根因**：`title-policy.mjs` 等公共实现用 `os.homedir()` 取默认目录；真实宿主里 MCP 子进程继承宿主 env（lab Desktop 进程树的 HOME=lab home），独立验证进程没继承就落到日常主目录。
- **解法**：独立验证时给 CLI 进程显式注入 `HOME`/`USERPROFILE` 指向 lab home（与 `ZCODE_PLUGIN_DATA` 一同注入）；收尾用目录 mtime 复核日常 `session-titles` 无新写入。
- **来源**：LO-05 实录（`05-mcp-closure-evidence.md` §4）。

### K16 lab CLI 会话库落点是 ZCODE_SESSION_DB_PATH，不是 home/.zcode/cli/db/

- **症状**：app-mcp 外置 config 按日常默认习惯把 sessionDbPath 指到 `<lab>/home/.zcode/cli/db/db.sqlite`，`sessionMode`/`sessionTitle` 报 `unable to open database file`（node:sqlite 标准错；该路径根本不存在）。
- **根因**：lab env 注入的 `ZCODE_SESSION_DB_PATH=<lab>/session-db/db.sqlite` 才是 Host 侧 CLI 会话库实际落点（LO-05 文件实证；与 LO-03 当时观察不同，以启动后实际落盘为准）。
- **解法**：写外置 config 前先枚举 lab 内 `*.sqlite` 实证落点；task index 在 `home/.zcode/v2/tasks-index.sqlite` 不变。
- **来源**：LO-05 实录（首轮两次 start_session 部分失败后定位）。

### K17 probeHost 必须 workspacePath；漏传时网关报 Invalid workspace attachment

- **症状**：`probeHost({gatewayConfigPath})` 稳定返回 `gateway_rpc_failed / Invalid workspace attachment`，而同参数的 `connectHost` 却成功——看似网关缺陷。
- **根因**：probeHost 是 connectHost+probe 的组合，其 attach 消息的 `workspace_path` 直接来自参数；漏传时为 undefined，网关（rpc-broker `acceptLocal`）按协议正确拒绝。LO-02/03 的成功调用都带 workspacePath。
- **解法**：`probeHost({gatewayConfigPath, workspacePath})` 两个都传。
- **来源**：LO-05 实录（两次复现后回源码定位）。

### K18 无登录态 Host 拒绝创建会话：需 personal provider（受控本地服务）才可验 start_session

- **症状**：local-only 链路全部就绪（paired/ready/探针 ok），MCP `start_session` 仍报 `当前没有可用的模型供应商和模型，请先登录或配置 API Key。`（Host 侧 zcodeAgentService 的 provider not ready）。
- **根因**：provider 全部来自账号（登录态）或 personal provider 配置；无登录 lab 里 providerCount=0，Host 在创建会话入口直接拒绝（与网关/补丁无关）。
- **解法（验证构造，非产品步骤）**：按规格"受控本地服务"写 `<lab home>/.zcode/v2/provider_config.json`（schemaVersion 1，api-key 型 openai-chat-completions 指向回环 mock，含 personalModelIds 与 defaultModelSelection；schema 依官方 provider 包）。注意：**受理（accepted）后轮次仍可能失败**（LO-05 实测 `Turn execution failed` 于模型调用前，mock 零调用）——ACK ≠ 模型完成，深因未定位。
- **来源**：LO-05 实录（`05-mcp-closure-evidence.md` §3）。

### K19 宿主插件发现根是 `<storage>/cli/plugins`，且必须 `enabledPlugins[id]=true`

- **症状**：插件按 LO-05 指南装到 `{{lab_dir}}/plugin-home/cli/plugins`、`installed_plugins.json` 也写了，Stop Hook 却从不触发；换成 `home/.zcode/cli/plugins` 也不行。
- **根因（LO-06 三路径探针实测）**：lab 里宿主运行期插件根由 `ZCODE_STORAGE_DIR`（lab 注入 `{{lab_dir}}/storage`）派生为 `<storage>/cli/plugins`。此外 Host 的 `readEnabledPluginRecords` 只加载 `{{lab_dir}}/home/.zcode/cli/config.json` 中 `plugins.enabledPlugins[<id>]===true` 的第三方记录——只写安装记录不会生效。`plugin-home` 只适合无宿主注入的独立 MCP 验证。
- **解法**：插件装 `<lab>/storage/cli/plugins`（cache + installed_plugins.json + `data/<plugin-id>/config.json`），并写入 `home/.zcode/cli/config.json` 的 `plugins.enabledPlugins`。判定是否生效用最小 SessionStart/UserPromptSubmit 探针写 marker，不要靠日志猜测。
- **来源**：LO-06 实录（`06-title-acceptance-evidence.md` §2；探针 A/B/C：仅 storage 路径 21 次触发，其余 0）。

### K20 受控 provider 要让轮次真正完成，必须补齐 manual model 配置

- **症状**：LO-05 的"受理成功、轮次失败、受控服务零调用"（`Turn execution failed` / `processing_input`）。只声明 provider 与模型 ID 仍然失败。
- **根因**：`manualProviderModelRules[].config` 缺失/不完整时，Host 在执行输入阶段无法构造模型（properties/optionSpecs 是模型创建必需项）。
- **解法**：补 `properties`（`contextWindow`、`supportsJsonSchemaOutput`、`supportsNativeWebSearch`、`supportsMidConversationSystem`、`inputFormat.supportsImage/Video/Pdf`）与 `optionSpecs`（`reasoningLevel.values` + `map`，`maxOutputTokens.max`）；`map` 先用 `"{}"`。补齐后受控轮次真实完成、助手消息落库（LO-06 实证 14 次流式 turn + 8 次非流式标题调用）。
- **来源**：LO-06 实录（证据 §3、指南 §2.4）。

### K21 失败轮不触发 Stop Hook；命名失败要分层核对

- **事实（源码 + 实测）**：Stop Hook 只在轮次正常完成（模型响应落盘）后运行；轮次失败走 TurnError 路径，**不触发 Stop**。因此"轮次模型不可达"不会产生任何命名记录，也不会误报命名成功。任务索引可能留下 `meta_json 非法` 的宿主日志（失败轮特有）。
- **命名自身失败有两种时延与口径**：命名模型不可达约 60s 后 `status:"failed"`、`reasonCode:null`（模型错误无 stage，无 Toast，属已交付契约）；网关不可达在秒级返回 `reasonCode:"gateway_unreachable"`（远控类失败，才有 Toast 路径）。
- **来源**：LO-06 实录（证据 §5）。

### K22 title 原生安装会改写 HKCU 协议键；lab 需预建开始菜单目录

- **症状**：lab 里跑 `title/dist/install.mjs --native-plugin`，报"无法保存快捷方式 … Start Menu\Programs\…lnk"（DirectoryNotFoundException）；成功后用户级 `suian-zcode-title` 协议键被改成 lab 路径。
- **根因**：安装器按 `$env:APPDATA` 写开始菜单快捷方式，lab appdata 无 `Microsoft/Windows/Start Menu/Programs`；协议键是 HKCU 全局，不随 lab 隔离。
- **解法**：先 `mkdir -p "<lab>/appdata/Microsoft/Windows/Start Menu/Programs"` 再安装；安装后把协议键还原为日常值并留还原记录（协议激活链路仍严禁触发）。只做命名链验收时可只跑 `--check-only`，但离线与 Toast 资产会不完整，失败字段可能出现 `toast:"unavailable"`。
- **来源**：LO-06 实录（`lo06-title-install*.log`、`lo06-protocol-registry-remediation.log`）。

### K23 `lab.mjs teardown` 会删 lab `home/`：装好插件后不能直接 teardown

- **症状**：为做"首启初始化轮→重开"而 `lab.mjs teardown`，随后插件安装记录、provider 配置、local-only 标志全部消失。
- **根因**：teardown 的 removable 列表包含 `dirs.home`、`storage`、`session-db` 等运行数据（保留 app 与日志）。
- **解法**：首启后只杀 `run-state.json` 记录的进程树（taskkill /T /F）并删 `run-state.json`，再 `launch`；需要彻底清理时才 teardown（并预期重建安装）。
- **来源**：LO-06 实录（lab.mjs teardownLab 源码 + 实例化流程）。

### K24 网关闭环重连不是"秒级"；Stop 延迟窗内杀网关要提前起 watcher

- **观察**：lab 网关重启后，Host 重新配对约需 50 秒（health `desktop_connected` 由 false 转 true）；此前把"秒级重连"当固定事实会误判故障。
- **时序坑**：Stop Hook 有 8 秒派发延迟；若先发消息再开始轮询模型日志，往往在检测到调用时 8 秒已过、命名已完成（杀网关晚到）。要构造"网关不可达"必须在发消息前起 watcher，看到新的 turn 模型调用就立即杀（LO-06 用 100ms 轮询脚本，观测到调用后 0.65s，杀进程总耗时约 2.3s）。
- **来源**：LO-06 实录（证据 §5；`gateway-fail-test.mjs`）。

## 维护约定

- 每张 LO 票收尾时，实施者（或协调者）把该票**新**踩的坑回填到"已知坑实录"，注明票号与证据路径；修正既有条目的"待确认"标注。
- 经验只收"可复现的动作 + 可指认的证据"，不收一次性结论；与 lab/patch 工具行为相关的变更以工具源码为准，技能不复制实现细节。
- 本技能位于仓库 `.agents/skills/`（入库；ZCode 以 worktree 根的 `.agents/skills` 为兼容发现路径，`.zcode/skills` 优先同名时以其为准）。
