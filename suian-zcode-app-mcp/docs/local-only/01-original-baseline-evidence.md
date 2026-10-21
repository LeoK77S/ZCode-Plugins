# LO-01 原版离线阻断基线证据（脱敏）

**执行日期**：2026-10-21。**对象**：未打补丁的 ZCode Desktop 3.16.2 运行包副本，在隔离 lab 内、无登录态、官方不可达条件下冷启动。**结论先行**：原版在该条件下被阻断在登录/首屏阶段，更新与遥测通道仍发起外部连接（部分被死代理拦截，部分经系统代理/TUN 外连）；这是预期失败基线，不是离线能力证明。

原始日志、报告与副本留在 git 忽略的 lab 目录（`suian-zcode-common/.scratch/local-only-lab/`，含 `logs/`、`reports/`、`lab-manifest.json`）；本文只收脱敏摘录。代码基线见提交本身的文件清单。

## 1. 运行包身份（源只读核对）

| 项 | 值 | 来源 |
| --- | --- | --- |
| ZCode.exe FileVersion | 3.16.2.8769 | setup 身份核对（PowerShell VersionInfo） |
| app.asar SHA-256（源） | `1f960ba24a4a6687bb29090a9ac3273c06e9fc18b14882525f591132650a99a8` | setup（Node crypto） |
| app.asar SHA-256（副本） | 与源逐字节一致 | setup 复制后复核（robocopy exit 1 = 正常复制） |
| app.asar 大小 | 341,334,118 字节 | 同上 |
| 源目录 | `<安装目录>`（全程只读） | — |
| Chromium | 147.0.7727.15 | asar 内 UA 字符串（静态） |
| Electron 精确版本 | **未验**（静态证据链无法确定；运行时 `process.versions.electron` 未提取） | — |
| 内嵌 CLI（resources/glm/zcode.cjs） | 0.13.3 | asar 内静态字符串；自报 `--version` 未执行（未验项） |
| main/host 入口 | `out/main/index.js`（asar package.json `main`）；host 为同侧 `../host/index.js` | 03 探索笔记静态解析 |

setup 输出与清单全文见 lab `logs/setup.log` 与 `lab-manifest.json`（exit 0）。

## 2. 隔离边界核对（启动前 check，20/20 通过）

`logs/check.log`（exit 0）。要点：

- **环境变量实际生效路径**（定义于 `lab-env.json`，全部归属 lab）：

| 变量 | 实际值（lab 内相对路径） |
| --- | --- |
| HOME / USERPROFILE / ZCODE_DESKTOP_HOME_DIR | `home` |
| ZCODE_DATA_BASE_DIR | `home`（`.zcode` 的父目录，官方 paths.ts 语义；**遗留语义项已核实**） |
| ZCODE_DESKTOP_USER_DATA_DIR | `desktop-user-data` |
| ZCODE_DESKTOP_SESSION_DATA_DIR | `desktop-session-data` |
| ZCODE_STORAGE_DIR | `storage` |
| ZCODE_SESSION_DB_PATH | `session-db\db.sqlite` |
| APPDATA / LOCALAPPDATA | `appdata` / `localappdata` |
| ZCODE_DESKTOP_APPLICATION_NAME | `ZCode Lab`（独立应用名 + 独立 userData 隔离单实例锁） |

- 显式清除继承变量：`ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL`、`ZCODE_WEB_REMOTE_CONTROL_URL`（日常机器前者指向日常网关 17329）。**另一遗留语义项已定位**：官方 Desktop 读取点在 `packages/desktop/src/main/index.ts:898`（`process.env[...]?.trim()`），经 `resolveWebRemoteControlRelayWsUrl` 作为 relay 地址最高优先级覆盖（index.ts:930、:937）——上一轮探索笔记未找到，本次已在 sources 快照核实。
- 网关配置模板：`gateway/config.json`（local-only、relay_protocol_version 2、port 17331 ≠ 日常 17329、随机 control_token 仅存 lab）。LO-01 只交付配置与归属检查，网关未运行（LO-02 范围）。

## 3. 运行时归属证据（副本落盘位置）

两轮真实启动（第一轮观察约 4.5 分钟、第二轮 60 秒），副本全部落盘都在 lab 内：

- `home\.zcode\v2\crash\`、`home\.zcode\v2\logs\2026-10-21.log`、`home\.zcode\v2\telemetry-state.json`（新 deviceMid 在 lab 内生成，未复制日常凭据）——`ZCODE_DATA_BASE_DIR` 运行时生效。
- `desktop-user-data\lockfile`、`desktop-user-data\.updaterId`——userData 隔离生效，**Chromium 单实例锁文件落在 lab userData**。
- `home\.cache\AMD\`、`home\appdata\local\NVIDIA\`——HOME/USERPROFILE 隔离生效（GPU 缓存写 lab）。
- 运行记录（`run-state.json`）由启动器在**进程内**写回 env 快照，11 个变量全部为 lab 路径（见 `logs/launch-4.log`）。

**单实例锁未转交**：实验全程日常 Desktop（另一 ZCode.exe 实例）与本副本并存运行数分钟，副本进程未立即退出、未触发窗口转交；teardown 后副本进程清零，日常 Desktop 不受影响。

## 4. 阻断阶段与网络证据

时间线（本地时间）：第一轮 20:19:10 启动（PID 31740，共 3 进程），观察至 20:23；第二轮 20:31:35 启动（PID 92260，共 3 进程），60 秒后取证。

**Desktop 日志摘录**（`home\.zcode\v2\logs\` 与 `logs/desktop.out.log`，脱敏后原样摘录）：

```
[main] [desktop-network] renderer proxy mode=direct ... / mode=system ...
[main] [auto-update] initializing, current version: 3.16.2
[main] Checking for update
[main] [auto-update] checking for update...
[main] Generated new staging user ID: e3cc3e59-...（lab 内新生成）
[main] Error: net::ERR_PROXY_CONNECTION_FAILED          ← 死代理 127.0.0.1:47821 生效
[main] [auto-update] background check failed
[main] [auto-update] startup check failed
```

**TCP 观察**（report 按副本 exe 路径枚举全部进程 PID 后过滤 netstat）：

| 轮次 | 外部目标连接 | 状态 |
| --- | --- | --- |
| 第一轮（观察 2 分钟/4.5 分钟两次 report） | `198.18.0.69:443`（副本子进程 PID 39560） | CLOSE_WAIT |
| 第二轮（60 秒 report） | `198.18.0.69:443`（副本子进程 PID 97252） | ESTABLISHED |

回环连接 0 条：**副本未连接日常网关 17329**（relay 覆盖变量已清除的直接验证）。`198.18.0.0/15` 为本机系统代理 TUN 的 fake-ip 段：该连接是"副本发起外部 443 连接尝试"的直接证据；具体目标域名在 TUN 映射层之后，本工具不可见（未验项）。

**阻断阶段判定**：

- 远控链路：官方源码（webRemoteControlManager.ts:1517-1520）在无登录 JWT 时最先阻断于登录检查（auth-required），不进入设备注册网络阶段。日志中未见远控启动条目，与此一致；UI 停在登录/首屏（无截图，未验项）。
- 更新/遥测通道：Chromium 栈部分被死代理阻断（`ERR_PROXY_CONNECTION_FAILED`）；仍有外部 443 连接经系统 TUN 建立成功——印证 `--proxy-server` 的适用边界：**它只约束 Chromium 栈，main 进程 Node fetch 与部分流量不受其控制**，官方不可达证据必须依赖 TCP 观察（本次已同时保留两类证据）。
- 隔离环境噪声（如实记录）：ARMS 初始化报 `Failed to get 'userData' path`（unhandledRejection 被捕获打印，进程未崩溃）；`Windows bundled runtime missing providers: glm` 警告（副本内 glm 目录存在，属启动自检提示）。

**这是预期失败基线**：原版在无登录态 + 官方不可达下无法进入可用状态；补丁版对照结论属后续票。

## 5. 日常环境无扰动核对

启动前快照（`logs/pre-snapshot-*.txt`，20:17:48）与实验后对比：

- `~/.zcode/v2/credentials.json`、`cli/plugins/installed_plugins.json`、`tools/suian-zcode-gateway/config.json`：mtime **未变化**。
- 日常网关 127.0.0.1:17329（PID 91244）与日常 Desktop（PID 3600）实验前后均正常运行。
- 观察期内 `~/.zcode` 有 47 个文件 mtime 变化，逐一归属后全部为：本验证任务的执行会话自身（子代理 artifacts/rollout/会话库增量）与日常 Desktop/CLI 的正常运行（插件状态、飞书组件锁续租、CLI 日志）；无任何文件归属 lab 副本写入。任务索引 `v2/tasks-index.sqlite` 的变化同样来自本执行会话（会话同步器），非副本。
- 未见本次实验特征标识（lab deviceMid、staging user ID）出现在日常目录。

## 6. 验收条件自评（票面 7 条）

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | 固定 exe/asar/main/host/内嵌 CLI 路径与版本、原包 SHA-256，单包支持 | **满足** | manifest 记录全套身份；Electron 精确版本与 CLI 自报版本列为未验项（静态不可得） |
| 2 | 数据根/home/userData/sessionData/应用身份隔离 + 实际生效路径核对 + 不被单实例锁转交 | **满足** | check 20 项 + run-state 进程内快照 + 运行时落盘（§2/§3）；副本与日常 Desktop 并存无转交 |
| 3 | 任务索引/会话库/插件记录/外置配置/工作区/网关配置归属隔离范围，启动前后核对 | **满足（结构层）** | check + 运行时归属；副本未产生会话/任务（未登录），session-db/tasks-index 无运行时写入可证——env 归属与零写入共同构成证明 |
| 4 | 不复制凭据、不加载日常 Hook/MCP 配置、不改用户环境/计划任务/默认应用 | **满足** | lab home 从零创建（新 deviceMid）；无任何系统级写入；日常 installed_plugins 未被读取（副本无日常插件痕迹） |
| 5 | 无登录态 + 官方不可达下运行原版，保留阻断阶段/错误/网络/进程证据，不伪报通过 | **满足** | §4：死代理阻断证据 + 外部连接 TCP 证据 + 登录阶段阻断判定；UI 停留状态未截图（未验项） |
| 6 | 指南含路径模板/依赖/启动/检查/退出/清理步骤；证明测试标记未进日常库 | **满足** | [搭建指南](01-lab-setup-guide.md)；§5 无扰动核对（检查本身只读，不写日常库） |
| 7 | 原始包/副本/令牌/日志留忽略目录；长流程首跑落盘日志与退出码；提交脱敏清单与未验项 | **满足** | 全部命令日志+exit code 落 `logs/`；token 仅存 lab；本文即脱敏清单 |

## 7. 未验项清单

- Electron 精确版本与 Electron 内 Node 版本：需运行时提取（副本进程内 `process.versions`，或 `ELECTRON_RUN_AS_NODE` 方式），LO-01 未做；Chromium 147.0.7727.15 可作核对锚点。
- 内嵌 CLI 自报版本（`zcode.cjs --version`）：未执行，0.13.3 为静态字符串证据。
- 外部连接 `198.18.0.69:443` 的具体目标域名：经系统 TUN fake-ip 映射，本工具不可见。
- 登录阻断的 UI 截图：未采集（窗口停留状态由进程存活 + 日志缺失间接证明）。
- `ZCODE_SESSION_DB_PATH`/任务索引的运行时写入验证：副本未登录无会话，库文件未生成；当前证明止于 env 归属与日常库零污染。
- lab 网关 local-only/V2 实际运行与 Desktop 本地接入：LO-02 范围，本次仅交付配置模板与归属检查。

## 8. 工具缺陷修复记录（真实运行暴露，均有回归测试）

1. PowerShell 5.1 `-Command` 不支持尾部 `$args` 传参 → 路径改为单引号字面量内嵌。
2. `Set-Content -Encoding UTF8` 写出带 BOM 的 run-state → `readJsonFile` 剥 BOM（回归测试覆盖）。
3. WQL `ExecutablePath` 路径的反斜杠需双写转义，否则"无效查询" → `buildProcessQueryScript`（回归测试覆盖）。
4. Windows 上 `detached+windowsHide` 的 PowerShell 子进程静默不执行 → 引导器改同步等待 + 副本由 `Start-Process` 独立创建；且 `stdio: 'ignore'` 防止副本继承管道导致 CLI 挂起。
5. teardown 在进程退出延迟期删除 userData 撞 `lockfile` EBUSY → 等待主 PID 实际退出 + 目录删除重试 + 失败收集不崩溃。

契约测试 15/15 通过（红→绿记录在 `.scratch/logs/local-only-lab-*.log`）；`suian-zcode-common` 全量 283/283 通过。
