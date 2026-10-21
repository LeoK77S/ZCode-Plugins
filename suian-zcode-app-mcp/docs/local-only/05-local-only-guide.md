# local-only 环境搭建与操作指南（3.16.2）

**适用**：Windows 上 ZCode Desktop 3.16.2 的 local-only 模式——从零搭建隔离验证环境、走产品 setup 应用补丁、用原生 MCP 检查会话，到切回与还原的全流程。**读者**：需要复现首轮验证（LO-01~05）的人，或在隔离环境验证 local-only 行为的开发者。

参数一律写 `{{占位符}}`；按本指南操作时替换为实际值。不依赖本文档之外的本机路径、令牌或会话标识。回执示例为**形状模板**（字段名与判定值），时间戳、PID、摘要前缀等以实际输出为准。

前置阅读：[规格](local-only-spec.md)、[LO-04 setup 集成证据](04-setup-integration-evidence.md)、[MCP 闭环证据](05-mcp-closure-evidence.md)。日常安装的诊断与操作语义见公共插件 debug 技能的 local-only 故障分层表。

## 1. 支持包与依赖准备

local-only 按**字节身份**只支持一个运行包；其它构建（包括同为 3.16.2 的不同渠道包）一律拒绝，不做模糊匹配。

| 项 | 要求 |
| --- | --- |
| ZCode Desktop | `{{zcode_exe_version}}` = `3.16.2.8769`；`{{app_asar_sha256}}` = `1f960ba2…`（完整值见 `suian-zcode-common/local-only/lab-env.mjs` 的 SUPPORTED_PACKAGE） |
| Node.js | 24+（网关、补丁工具、MCP CLI 与构建都需要） |
| 公共插件 | 源码 `suian-zcode-common/`，`npm ci --ignore-scripts` 后 `npm run build:release` |
| 会话 MCP 插件 | 源码 `suian-zcode-app-mcp/`，`npm ci --ignore-scripts` 后 `node build-release.mjs --out {{releases}}/app-mcp` |

核对源包身份（只读）：

```powershell
(Get-Item "{{zcode_install_dir}}/ZCode.exe").VersionInfo.FileVersion   # 预期 3.16.2.8769
(Get-FileHash "{{zcode_install_dir}}/resources/app.asar" -Algorithm SHA256).Hash  # 预期 1F960BA2…
```

构建产物自带 `release.json`（逐文件摘要与 buildId）；构建双包的命令在各自 `build-release.mjs`，预期输出形如 `{"releaseDir":"…","buildId":"{{build_id}}",…}`。

## 2. 隔离环境搭建

一切安装、应用、网关动作只落在 lab 目录，不触日常安装、日常 `~/.zcode` 与日常网关（127.0.0.1:17329）。

### 2.1 lab 与运行包副本

```powershell
node "{{repo}}/suian-zcode-common/local-only/lab.mjs" setup --lab "{{lab_dir}}" --source "{{zcode_install_dir}}"
node "{{repo}}/suian-zcode-common/local-only/lab.mjs" check --lab "{{lab_dir}}"
```

- setup 预期回执：`identityMatch: true`（副本 asar 摘要与登记逐字节一致）。
- check 预期：`{"ok":true,"total":21}`，全部 `[PASS]`。任何 FAIL 都先解决再继续——环境变量实际生效路径必须全部归属 `{{lab_dir}}`。

lab 目录布局（lab 工具单一数据源，勿手工改）：`app/`（运行包副本）、`home/`（数据根）、`desktop-user-data/`、`session-db/`、`workspace/`、`gateway/`、`logs/`。

### 2.2 隔离插件安装（PKG-01 形态）

按官方宿主存储布局装进 lab：`{{storage_root}}` = `{{lab_dir}}/storage/cli/plugins`。

**LO-06 实测修正**：宿主运行期插件根由 lab env 的 `ZCODE_STORAGE_DIR`（lab 注入为 `{{lab_dir}}/storage`）派生为 `<storage>/cli/plugins`；`{{lab_dir}}/plugin-home/cli/plugins` 不是宿主发现路径（只适合无宿主注入的独立 MCP 验证）。曾用三路径探针实测：仅 `<lab>/storage/cli/plugins` 的 SessionStart/UserPromptSubmit 被触发，`home/.zcode/cli/plugins` 与 `plugin-home/cli/plugins` 均为零。若移除 `ZCODE_STORAGE_DIR`，默认落到 `~/.zcode/cli/plugins`（lab 内即 `home/.zcode/cli/plugins`）。

- 缓存：`{{storage_root}}/cache/suian-zcode-plugins/suian-zcode-common/{{common_version}}/` 与 `…/suian-zcode-app-mcp/{{app_mcp_version}}/`（各自复制发布目录内容，**分别缓存，不硬拼同级**）。
- 安装记录：`{{storage_root}}/installed_plugins.json`，两条 `InstalledPluginRecord`（id 形如 `suian-zcode-common@suian-zcode-plugins`，含绝对 `installPath`）。
- **启用门槛（LO-06 实测）**：宿主只加载 `{{lab_dir}}/home/.zcode/cli/config.json` 中 `plugins.enabledPlugins[<id>] === true` 的第三方记录；只写 `installed_plugins.json` 不会让插件生效。lab 需显式写入：

```json
{
  "plugins": {
    "enabledPlugins": {
      "suian-zcode-common@suian-zcode-plugins": true,
      "suian-zcode-app-mcp@suian-zcode-plugins": true,
      "suian-zcode-title@suian-zcode-plugins": true
    }
  }
}
```

- 数据目录：`{{storage_root}}/data/<plugin-id>/`（`<plugin-id>` 形如 `suian-zcode-app-mcp@suian-zcode-plugins`，`@` 保留）。外置配置 `{{storage_root}}/data/suian-zcode-app-mcp@suian-zcode-plugins/config.json`，路径全部显式指向 lab：

```json
{
  "authDataDir": "{{storage_root}}/data/suian-zcode-app-mcp@suian-zcode-plugins/auth",
  "artifactDbPath": "…/artifacts.sqlite",
  "gatewayConfigPath": "{{lab_dir}}/gateway-data/config.json",
  "indexDbPath": "{{lab_dir}}/home/.zcode/v2/tasks-index.sqlite",
  "sessionDbPath": "{{lab_dir}}/session-db/db.sqlite"
}
```

要点（实测沉淀）：任务索引在 `home/.zcode/v2/`；**CLI 会话库在 lab env `ZCODE_SESSION_DB_PATH` 的位置**（`{{lab_dir}}/session-db/db.sqlite`），不在 `home/.zcode/cli/db/`——以启动后实际落盘为准核对一次。

随后跑产品安装入口核对（零副作用与正式各一次）：

```powershell
node "{{app_mcp_cache}}/dist/install.mjs" --native-plugin --config "{{…}}/config.json" --installed-plugins "{{storage_root}}/installed_plugins.json" --check-only
```

预期：`{"ok":true,"action":"checked","dependencies":{"node_version":"24.x"},"common":{"ok":true}}`。

### 2.3 隔离 MCP 注册语义

发布包 `.mcp.json` 的 stdio 注册指向 `${ZCODE_PLUGIN_ROOT}/dist/cli.mjs --config ${ZCODE_PLUGIN_DATA}/config.json`。宿主内使用时模板变量由宿主解析；**独立验证**（无宿主）等价注册为：

```
command: node
args:    ["{{app_mcp_cache}}/dist/cli.mjs", "--config", "{{…}}/config.json"]
env:     ZCODE_PLUGIN_DATA={{storage_root}}/data/suian-zcode-app-mcp@suian-zcode-plugins
         HOME={{lab_dir}}/home ; USERPROFILE={{lab_dir}}/home
```

`ZCODE_PLUGIN_DATA` 上溯两级即存储根，定位器据此读 lab 安装记录加载 lab common。**HOME/USERPROFILE 必须随宿主 env 注入**（宿主进程树在 lab env 下）：MCP 进程内按 `homedir()` 落盘的路径（如标题锁策略）才不会越界写日常目录。

### 2.4 可选：受控本地模型服务

无 ZCode 登录态时 Host 没有可用模型供应商，`start_session` 会被拒（`当前没有可用的模型供应商和模型…`）。只做**查询类** MCP 检查（list/read）不需要模型；要验证**创建/发信**闭环，按规格配一个受控本地服务：

1. 起一个回环 OpenAI 兼容端点（`{{loopback_model_url}}`，如 `http://127.0.0.1:{{port}}/v1`），支持非流式与 SSE 两种响应；每次请求记录一条调用锚点，便于区分"Host 受理"与"模型真实被调用"。
2. 写 `{{lab_dir}}/home/.zcode/v2/provider_config.json`（schemaVersion 1）：personal 层声明一个 `api-key` 型 `openai-chat-completions` 供应商指向该端点，含一个模型与 `defaultModelSelection`。文件字段以官方 provider 包 schema 为准。

**LO-06 实测修正**：轮次能否真正完成取决于模型手动配置是否完整。仅声明 provider 时仍可能"受理成功、轮次失败、服务零调用"；补齐 `manualProviderModelRules[].config` 的 `properties`（`contextWindow`、`supportsJsonSchemaOutput`、`supportsNativeWebSearch`、`supportsMidConversationSystem`、`inputFormat.supportsImage/Video/Pdf`）与 `optionSpecs`（`reasoningLevel.values` + `map`、`maxOutputTokens.max`）后，受控轮次可真正完成并落库助手回复（LO-06 证据，14 次流式 turn 调用 + 8 次非流式标题调用）。`map` 可先用 `"{}"`（不回写请求体字段）。

如实口径：合成回复只证明链路；**Host 受理（ACK）≠ 模型完成**，以受控服务的调用记录与落库助手消息双重核对；轮次失败时不会触发 Stop Hook，因此也不存在"命名 Hook 误报成功"。

## 3. 原版失败基线（对照用）

同一 lab、未打补丁、无登录态时，原版被阻断在登录检查阶段（更新/遥测通道仍有外部连接）。这是**预期失败基线**，完整证据见 [LO-01](01-original-baseline-evidence.md)。补丁后的行为差异以此为对照。

## 4. 产品 setup：选 local-only

用**构建发布目录**的 setup.ps1（不是源码根的）。lab 语义下 Windows 系统边界（计划任务/注册表/环境广播/健康 HTTP）以 systemFixture 桩到 lab 状态文件——方法沿 LO-04（`tests/setup.test.mjs` 提取 fixture、移除补丁桩使工具真实执行）；日常安装则无桩真实执行，参数相同：

```powershell
powershell -ExecutionPolicy Bypass -File "{{common_release}}/setup.ps1" `
  -Action Install -Mode local-only -RelayProtocolVersion 2 -ZcodeAppVersion 3.16.2 `
  -ZcodeInstallDir "{{lab_dir}}/app" `
  -LocalOnlyWorkspace "{{lab_dir}}/workspace" `
  -LocalOnlyDataRoot "{{lab_dir}}/home" `
  -DataDir "{{lab_dir}}/gateway-data" -ToolsRoot "{{lab_dir}}/gateway-tools" -SkillsDir "{{lab_dir}}/skills"
```

预期回执（节选）：

```json
{"ok":true,"action":"installed","mode":"local-only","relay_url":"ws://127.0.0.1:17331/ws",
 "local_only":{"state":"prepared","patch_state":"original","patch_version":2,
   "apply_script":"{{lab_dir}}/gateway-data/local-only/apply-local-only.ps1",
   "restore_script":"…/restore-local-only.ps1",
   "expected_receipt":"ok=true; applied=applied|already; activated=true; after reopen desktop_ready=true"}}
```

**prepared ≠ applied**：setup 只做预检（补丁工具 status，按字节身份放行）与候选准备（候选 asar 摘要应等于登记的 v2 补丁摘要 `71c640b5…`，同输入同字节）；不执行应用、不强退进程。

lab 桩模式下网关任务由桩代答；随后从部署目录真实直启一次，验证 setup 产物 config 自包含可用：

```powershell
node "{{lab_dir}}/gateway-tools/deployments/{{build_id}}/gateway.mjs" --config "{{lab_dir}}/gateway-data/config.json"
curl http://127.0.0.1:17331/health   # 预期 service=suian-zcode-gateway, mode=local-only, relay_protocol_version=2
```

## 5. 外部应用（用户退出后执行）

setup 生成的 apply 脚本就是交付用户的外部命令。**先关闭该安装目录的全部 Desktop 实例**（工具只检查与提示，从不强退）：

```powershell
powershell -ExecutionPolicy Bypass -File "{{lab_dir}}/gateway-data/local-only/apply-local-only.ps1"
```

| 场景 | 预期回执 |
| --- | --- |
| 实例未退出 | 退出码 12 `running_instance`，列出全部 PID，零变更 |
| 应用成功 | `{"ok":true,"applied":"applied","activated":true,…}`；副本 asar 摘要 == 补丁摘要，备份 == 原版摘要 `1f960ba2…` |
| 包被升级/改写 | REFUSED（退出码 10/11），透传摘要失配与诊断指引，零变更 |

标志文件 `{{lab_dir}}/home/.zcode/local-only.flag` 首行即自动启动工作区（P6）；**它在启动时一次性求值，必须在启动前存在**。

## 6. 正常重开与就绪验证

用原快捷方式（lab 中为 launcher）重开，工作区以**位置参数**直开（官方 argv 语义，绕过首启欢迎页——欢迎页是首启必经，无登录态脚本无法点击；人工完成一次首启是兜底手段）：

```powershell
node "{{repo}}/suian-zcode-common/local-only/lab.mjs" launch --lab "{{lab_dir}}" `
  --proxy-dead-port {{dead_port}} --remote-debugging-port {{cdp_port}} --workspace "{{lab_dir}}/workspace"
```

> **首启注意（K1/K13）**：全新 userData 下先跑一轮**普通启动**（不带 `--workspace`）完成首启初始化，CDP `http://127.0.0.1:{{cdp_port}}/json/list` 见 page target 即窗口已创建；随后杀进程、删 `run-state.json` 再走完整流程。跳过此步时 workspace 直开可能不创建主窗口（根因未定位，与补丁无关）。

就绪判断（从插件视角，两条都要过）：

```text
curl http://127.0.0.1:17331/health
  预期 desktop_connected/desktop_ready/paired 全 true（首轮实测重开后 2~6 秒内达成）
probeHost（lab common 的 dist/client.mjs，传 gatewayConfigPath + workspacePath）
  预期 {"ok":true,"mode":"local-only","paired":true,"hostReachable":true,"workspaceFound":true,"sessionFound":true}
```

## 7. MCP 检查（stdio 实连）

以 MCP 客户端（`@modelcontextprotocol/sdk` 的 Client + StdioClientTransport）按 §2.3 的注册连 dist 入口。先核对工具清单（基础十九个；宿主索引含 projects 表时另见 `list_projects`，加工件面板两工具共面），再按需闭环：

| 步骤 | 调用 | 预期回执要点 |
| --- | --- | --- |
| 创建 | `start_session`（workspace_path + title + lock_title + 受控 message） | `session_id` 返回、`delivery_status:"accepted"`（**ACK 语义**）；warning 含 `permission_not_inherited` 属预期（外部来源） |
| 发信 | `send_message` | `delivery_status:"accepted"`；`admitted_delivery` 记录受理通道（queue/startNow） |
| 改名 | `rename_session` | 回执 `title` 读回一致；`list_sessions` 标题同步 |
| 读取 | `read_session` / `list_sessions` | 开局消息在持久化分支可见，正文带 `created-by-other-session`/`delivered-by-other-session` 注入标记 |
| 断链恢复 | 杀网关 → 同 config 重启 → 再读再发 | 副本自动重连（秒级）；read/send 均再次成功 |

归属核验：新会话只出现在 lab 的 `session-db/db.sqlite` 与 `home/.zcode/v2/tasks-index.sqlite`；对照日常两库无此会话、日常 `installed_plugins.json` mtime 不变。网络证据按进程 PID 过滤 netstat——副本回环仅连 `127.0.0.1:17331`；官方远控端点直连为 0（TUN fake-ip 段 `198.18.x.x:443` 噪声除外）。

## 8. 故障定位

统一入口为补丁工具只读 status：`node "{{common_root}}/local-only/patch.mjs" status --target "{{zcode_install_dir}}"`。按公共 debug 技能的 **local-only 七类分层表**对位：包不支持/摘要变化、宿主仍运行、备份或写入失败、环境未生效、网关未就绪、Host 未附着、模型服务不可达（表见 `suian-zcode-common/skills/debug/SKILL.md`）。隔离环境自身的排查方法论（进程/UI/日志/网络/环境/时序六层收缩）与已知坑 K1~K24 见项目技能 `debug-isolated-zcode`。

## 9. 切回 relay

补丁保留、应用包不重写，只关本地开关：

```powershell
powershell … -File "{{common_release}}/setup.ps1" -Action Restart -Mode relay `
  -ZcodeAppVersion 3.16.2 -ZcodeInstallDir "{{lab_dir}}/app" `
  -LocalOnlyDataRoot "{{lab_dir}}/home" -DataDir … -ToolsRoot … -SkillsDir …
```

预期：`local_only_switch:"disabled"`（标志文件删除）、网关 mode=relay、环境值按 relay 写回。重开后零 `[web-remote-control]` 本地连接。**在线 relay 的真实账号链路**（官方鉴权、手机端）需要真实登录态与网络，lab 无凭据不可验，保留未验状态。

## 10. 完整还原

独立外部命令，按备份恢复原版并关开关：

```powershell
powershell -ExecutionPolicy Bypass -File "{{lab_dir}}/gateway-data/local-only/restore-local-only.ps1"
```

预期：`restoredAsarSha256` == 原版摘要 `1f960ba2…`；补丁工具 status 回 `original`；备份与状态文件清理。还原时目标包摘要不再匹配记录则明确拒绝（不用旧备份覆盖未知新版本）。

## 11. 清理

```powershell
node "{{repo}}/suian-zcode-common/local-only/lab.mjs" teardown --lab "{{lab_dir}}"   # 杀副本进程树并清运行数据，保留日志与副本
```

收尾核对：lab 网关与 CDP 端口已释放；日常网关 127.0.0.1:17329 仍 LISTENING；日常 `app.asar` 摘要仍为原版；日常安装全程只读。lab 目录、控制令牌与原始日志不入库，入库证据只保留脱敏摘录。
