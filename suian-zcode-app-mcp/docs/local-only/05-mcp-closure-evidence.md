# LO-05 原生 MCP 闭环与指南交付证据（脱敏）

**执行日期**：2026-10-21。**代码基线**：`e693dd0`（feat/local-only-integration，LO-04 合入后）于 worktree 分支 `feat/lo05-mcp-guide` 验证。**对象**：真实构建发布包（common 0.6.0 + app-mcp 0.11.0）+ lab 隔离副本（3.16.2.8769，字节身份与登记一致）+ 实际 stdio MCP。**结论先行**：首轮端到端闭环成立——产品 setup 选 local-only → 外部应用 → 原快捷方式重开 2 秒 paired/desktop_ready；MCP stdio 实连完成 start_session（受控输入）/send_message/rename_session/list_sessions/read_session 全链（Host ACK、改名读回、内容注入标记实证）；网关强杀重启后 read 与 send 再次成功；测试会话只存在于 lab 隔离索引与 CLI 库，日常环境零污染。**模型口径如实**：无登录态下 Host 拒绝创建直到配置受控本地 provider；受理后轮次以 `Turn execution failed` 失败（受控服务零调用）——ACK ≠ 模型完成，无合成回复冒充。

原始日志与 lab 数据留在 git 忽略的 worktree 根 `.scratch/`（`logs/lo05-*.log`、`local-only-lab-lo05/`、`local-only-lab-lo05-drill/`）；本文只收脱敏摘录。指南见 [05-local-only-guide.md](05-local-only-guide.md)。

## 1. 加载入口与包摘要矩阵

| 项 | 值 |
| --- | --- |
| common 发布包 | 0.6.0，buildId `7c7a23619231…`，58 文件（`lo05-build-common.log`） |
| app-mcp 发布包 | 0.11.0，buildId `ab362ce55963…`，22 文件，dist 三入口（cli/artifact-hook/install）（`lo05-build-app-mcp.log`） |
| lab 安装形态 | PKG-01：`installed_plugins.json` 两条记录 + 独立缓存目录（cache/suian-zcode-plugins/<name>/<version>），逐文件摘要复核 58+22 全过；install.mjs `--check-only` 与正式初始化均 ok（`lo05-install-plugins.log`） |
| lab MCP 注册 | 发布 `.mcp.json` 语义（`${ZCODE_PLUGIN_ROOT}/dist/cli.mjs --config ${ZCODE_PLUGIN_DATA}/config.json`）；独立验证注入 `ZCODE_PLUGIN_DATA` + lab HOME 等价注册，经 lab 安装记录加载 lab common（commonApiVersion 1 核对通过） |
| 原版 app.asar | `1f960ba24a4a…`（源与副本逐字节一致，setup 复核） |
| v2 补丁 asar | 候选与副本应用后均为 `71c640b58851…`，与 LO-03 登记一致（确定性复现） |
| 网关 | 部署 buildId `ac0e0c0d…`（部署 CLI 从发布根实算），config 自包含直启；`gateway.mjs` 等网关字节随发布构建，源码零改动（LO-02 起沿用） |

## 2. 产品流程（真实构建包 + 桩 Windows 边界，方法沿 LO-04/K14）

| 步骤 | 回执摘要 | 日志 |
| --- | --- | --- |
| lab 搭建与边界 | setup `identityMatch:true`；check 21/21 PASS | `lo05-lab-setup.log`、`lo05-lab-check.log` |
| userData 首启初始化轮 | 普通启动窗口创建（CDP 5 targets/1 page）后杀进程清运行记录（K13 预防） | `lo05-launch-init.log` |
| setup Status 预检 | `local_only_patch: {supported:true, patchState:"original"}`（真实补丁工具判定） | `lo05-setup-status.log` |
| setup Install local-only | ok、mode=local-only、port 17331、V2；`state:"prepared"`、`patch_version:2`、apply/restore 脚本生成；重复 Install 幂等 | `lo05-setup-install.log`、`lo05-setup-install2.log` |
| 网关真实直启 | `/health` mode=local-only、V2、build 匹配部署目录 | `lo05-gateway.log` |
| 外部应用 | `{"applied":"applied","activated":true}`；副本==补丁摘要、备份==原版摘要、标志首行=工作区 | `lo05-apply.log` |
| 原快捷方式重开 | **2 秒** `connected/ready/paired` 全 true；插件视角 probeHost `ok:true`（paired/hostReachable/workspaceFound/sessionFound）、connectHost bootstrap `desktopAppVersion 3.16.2` | `lo05-launch-reopen.log`、`lo05-plugin-probe3.log` |

probeHost 首次失败为调用侧漏传 workspacePath（网关正确拒绝 `Invalid workspace attachment`），修正参数后通过；非产品缺陷，记录在案。

## 3. 原生 MCP 闭环（实际 stdio，客户端为 SDK Client + StdioClientTransport）

**就绪前置（实测发现）**：无登录态时 Host 无可用 provider，start_session 被拒（`当前没有可用的模型供应商和模型，请先登录或配置 API Key。`）。按规格"受控本地服务"配置 personal provider（`home/.zcode/v2/provider_config.json`，api-key 型 OpenAI 兼容指向回环 mock `127.0.0.1:18081`）后 Host 即可创建会话。此路径为规格允许的验证构造，非产品安装步骤。

工具清单实读：**20 个**（基础十九 + 工件面板 get_artifacts/set_artifacts；宿主索引含 projects 表，list_projects 公布），与 server.mjs 注册一致，零自行增改。全程 MCP 进程 stderr 零输出。

| 步骤 | 实际回执（摘录） | 口径 |
| --- | --- | --- |
| `start_session`（受控输入"echo: LO05-START"，lock_title） | `session_id:"session_e534…"`、`title` 写入、`input_id` 返回、`delivery_status:"accepted"`、`permission_mode:"build"`；warning `permission_not_inherited`（外部来源预期） | **Host ACK**：创建回执与输入受理 |
| `send_message` | `delivery_status:"accepted"`、`admitted_delivery:"queue"`、`input_id` | **Host ACK**：仅提交，不代表处理或回复 |
| `rename_session` | 回执 `title` 读回一致（原 Host getTaskMeta 核对 + 双库同步确认） | 改名读回 |
| `list_sessions` | 工作区过滤命中目标会话，标题=新标题 | 标题读回 |
| `read_session`（延迟复核） | 2 条 user 消息全部落库：开局消息带 `created-by-other-session creator="…"` 注入、发信带 `delivered-by-other-session deliverer="…"` 注入（契约行为实证） | 内容核对 |
| 网关强杀→同 config 重启 | 副本自动重连；`read_session` 再查询成功（1 条）、`send_message` 再提交 `accepted`（`admitted_delivery:"startNow"`）、标题保持 | 断链恢复闭环 |

**模型状态如实记录**（三层分开）：

1. **Host ACK**：全部获得（三次提交均 `accepted`）。
2. **合成回复**：**未发生**——受控本地服务全程零 `chat/completions` 调用（`lo05-mock-model.log` 仅 health）。重启后 Host 以 startNow 启动轮次，CLI 日志 `turn.failed / Turn execution failed`（turnPhase=processing_input，UNKNOWN_ERROR），会话状态 error；失败发生在模型请求之前。
3. **真实模型**：不可得（无登录态），未验证。

不以任何回执宣称模型完成；受控 provider 的深因定位（Turn execution failed 于输入处理阶段）列为未验项。

## 4. 归属与网络证据

| 项 | 证据 |
| --- | --- |
| 测试会话归属 | 只存在于 lab `session-db/db.sqlite`（ZCODE_SESSION_DB_PATH 实际落点）与 lab `home/.zcode/v2/tasks-index.sqlite`；日常两库按会话 ID 查询 0 命中 |
| 会话库落点修正（实测） | CLI 会话库在 lab env `ZCODE_SESSION_DB_PATH` 位置，**不在** `home/.zcode/cli/db/`（app-mcp 外置 config 初值指错时 sessionMode/sessionTitle 报 `unable to open database file`，修正后全通）；已沉淀进指南 §2.2 |
| title-policy 归属 | MCP 进程注入 lab HOME 后落 `{{lab}}/home/.zcode/tools/suian-zcode-common/session-titles/`；日常 `session-titles` 目录 mtime 复核无本轮写入（失败路径在写 policy 前中断、成功路径已入 lab） |
| 副本 TCP（report） | 回环唯一：主进程 → `127.0.0.1:17331` ESTABLISHED；外部仅 TUN fake-ip `198.18.0.69:443`（与 LO-01~03 基线同形态噪声）；官方远控端点直连 0 |
| MCP 进程 TCP | 读工具运行期 netstat 按 PID 过滤 0 行（本地 SQLite，零网络）；写工具连接仅网关 17331（闭环成功即证） |
| 令牌 | lab 网关 control_token 仅存 lab `gateway-data/config.json`，未进日志与本文档 |
| 日常环境 | 网关 17329（PID 91244）验证前后 LISTENING；日常 `installed_plugins.json` mtime 未变；日常 asar 摘要验证后仍 `1f960ba2…`；日常两库 mtime 变化均属日常 Desktop/本验证会话自身运行（归属核对，非 lab 写入） |

## 5. 干净环境定向演练（指南可复现性）

全新 lab（`local-only-lab-lo05-drill/`）按指南 C 从零走关键路径，复用 A 步构建产物，不重复全量：搭建（check 21/21）→ 插件安装（check-only + 正式）→ 首启初始化轮（CDP 1 page）→ setup Install（prepared）→ 网关直启 + 外部应用→ 重开 **6 秒** paired/ready → probeHost ok + MCP stdio 一次查询（20 工具、list_sessions 正常回执，空列表为全新库预期）。teardown 后 17331/9224 端口释放、日常网关正常。日志：`logs/lo05-drill-*.log`。

## 6. 票面验收条件自评（8 条）

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | 固定实际加载的发布包、common、网关、Desktop/CLI 入口和摘要；产品 setup 选 local-only、外部命令应用、原快捷方式重开完成检查 | **满足** | §1 摘要矩阵；§2 产品流程全链（重开 2 秒 ready + 探针） |
| 2 | 实际 stdio MCP 执行 start/send/rename/list/read，核对来源、目标原 Host、标题读回与内容；不只直接调控制器 | **满足** | §3 闭环表（SDK stdio 客户端实连 dist 入口；probeHost 仅作就绪探针） |
| 3 | 无登录态且官方远控不可达；保留请求/连接证据；网关重启后再次读取与提交成功 | **满足** | §4 TCP 证据（回环唯一 + 官方直连 0）；§3 网关重启行 |
| 4 | 测试会话只存在于隔离索引和 CLI 库；配置、令牌、工作区、网关进程归属清晰 | **满足** | §4 归属表 |
| 5 | Host ACK、合成模型回复、真实模型最终回复分别记录；不以受理回执宣称模型完成 | **满足** | §3 模型三层口径（合成未发生亦如实记录） |
| 6 | 指南覆盖 12 项清单；参数模板与预期回执 | **满足** | [指南](05-local-only-guide.md) §1~§11；占位符全量、无本机路径/令牌/会话标识 |
| 7 | 针对指南可复现性执行新的干净隔离环境定向演练；复用有效底层日志；支持包、未验条件与故障定位有说明 | **满足** | §5 演练；§1 构建复用；指南 §8 分层定位 |
| 8 | 首轮结果区分代理验证与用户验收；原始敏感物料不入库 | **满足** | §7 汇总表区分；lab/令牌/原始日志留忽略目录 |

## 7. 首轮（LO-01~LO-05）汇总

| 票 | 交付 | 证据（脱敏入库） | 验证口径 |
| --- | --- | --- | --- |
| LO-01 | 隔离 lab 工具 + 原版离线阻断基线 | [01 基线证据](01-original-baseline-evidence.md)、[搭建指南](01-lab-setup-guide.md) | 代理验证（lab） |
| LO-02 | 可还原补丁 v1 + 未修改网关最小接入（原 Host 探针） | [02 补丁证据](02-patch-evidence.md) | 代理验证（lab；renderer 触发缺口具名，LO-03 补齐） |
| LO-03 | 补丁 v2（自动启动/signed-out 隔离/回环校验）+ 冷启动/重连/模式往返 | [03 生命周期证据](03-lifecycle-evidence.md) | 代理验证（lab） |
| LO-04 | setup 产品流程集成（预检/准备/外部命令/切回/还原）+ 真实构建包验证 | [04 setup 集成证据](04-setup-integration-evidence.md) | 代理验证（lab + 日常只读预检演示） |
| LO-05 | 原生 MCP 闭环 + 最终指南 + 定向演练（本票） | 本文 + [指南](05-local-only-guide.md) | 代理验证（lab + drill） |

**首轮结论（代理验证口径）**：LO-01~05 各自验收条件全部满足，规格定义的首轮成功标准成立——无 ZCode 登录态且官方远控不可达时补丁版冷启动接入原 Host，MCP 创建、提交、改名、历史读取闭环成立，网关重启可恢复，可切回 relay 可完整还原。**用户产品验收未开始**（见下）。

**首轮未验项汇总**（跨票合并；细节见各证据未验项节）：

- 日常真实安装的应用补丁与重开（产品语义安排给用户）；真实计划任务 + 真实注册表组合（LO-04 桩约束）。
- 在线 relay 真实账号链路与手机端验收（无凭据/官方网络条件）。
- 真实模型回复与真实 Stop 自动命名、侧栏评论（LO-06/07 独立票；本轮仅 Host ACK + 轮次失败记录）。
- 受控 provider 下轮次失败深因（Turn execution failed 于模型调用前，§3）；全新 userData 首启窗口问题（K13 根因）；外部 443 噪声域名（TUN 不可见）；开关关闭时 signed-out 原撤销语义（需登录态）。

## 8. 收尾

- B lab 与 drill lab 均 teardown（进程树、网关、17331/9223/9224、mock 18081 全部释放；lab 目录与令牌留忽略目录不入库）。
- 日常网关/安装/插件记录/asar 验证前后状态一致（§4）。
- 本票新增踩坑回填项目技能 `debug-isolated-zcode`（K15 MCP 进程 HOME 注入、K16 会话库落点、K17 probeHost workspacePath、K18 provider not ready）。
