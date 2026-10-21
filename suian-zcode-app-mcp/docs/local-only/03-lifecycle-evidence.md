# LO-03 离线生命周期证据（脱敏）

**执行日期**：2026-10-21。**对象**：ZCode Desktop 3.16.2 隔离副本（lab 工具搭建）＋ 未修改公共网关（端口 17431，避开日常 17329 与 LO-02 用的 17331）。**结论先行**：补丁升级 v2 后，无登录态冷启动闭环成立——开关开启且标志文件带工作区时 main 自动触发远控 start（解 LO-02 具名的 renderer 触发缺口 K9），免 CDP、免人工跳过欢迎页；网关异常断开后副本按退避自动重连并恢复 desktop_ready；signed-out 通知不撤销本地链路；relay↔local-only 往返三态分离。网关字节零改动；connectHost 契约未动。

原始日志与 lab 数据留在 git 忽略的 `suian-zcode-common/.scratch/`（`logs/lo03-*.log`、`local-only-lab-lo03/`）；本文只收脱敏摘录。代码基线见提交本身。

## 1. 补丁 v2 身份

| 项 | 值 |
| --- | --- |
| 补丁版本 | 2（`local-only/patch-env.mjs` `PATCH_VERSION`） |
| 原包 app.asar SHA-256 | `1f960ba24a4a6687bb29090a9ac3273c06e9fc18b14882525f591132650a99a8`（与 LO-01/02 登记一致） |
| v2 补丁包 app.asar SHA-256 | `71c640b58851d5a6f4e393525315d6ea8b1594b92da2bdbaade5577df7712f8c` |
| 注入点 | 7 处，锚点在产物内唯一命中（apply 输出与 `candidate.json` 存档） |

v2 新增（P0-P4 语义不变）：

| id | 锚点 | 语义 |
| --- | --- | --- |
| P5-signed-out-isolation | `async notifyAuthStateChanged(h,v){let O=++w;if(v.state==="signed-in"){`（@409101 一带） | signed-out/登出通知入口短路：本地模式直接 return，不撤销任何窗口（05 笔记 C4）；开关关闭保留原撤销语义 |
| P6-auto-start | manager 构造收尾 + `Ef.current=li;`（源码 index.ts:1030，@780415） | 开关开启且解析到工作区（env `ZCODE_LOCAL_ONLY_WORKSPACE` > 标志文件首行）时轮询触发 `li.start(windowId,{workspacePath})`；getStatus 非 idle 即停（与 renderer 手动 start 并存幂等）；失败重试上限 150 次×2s |

P1 同步扩展：`__LO_WS` 求值（IIFE 内收拢，见 §6 踩坑）与网关回环校验（目标非 `127.*`/`::1`/localhost 时忽略覆盖、保留默认回环，loopback URL 不当模式标识）。

**v1→v2 升级路径**：prepare 对已应用 v1 的目标从完好备份生成候选（`preparedFromBackup`，目标只读）；apply 检测到本工具旧版本补丁时自动 restore 原版→重新应用 v2（输出 `upgradedFromPatchVersion: 1`），不在旧注入上叠加；备份缺失（`backup_missing`）或摘要不符（`digest_mismatch`）明确失败。status 对旧版本补丁报 `upgradeAvailable`。契约测试覆盖全部路径。

## 2. 工具与测试（契约层，先红后绿）

- **新增** `tests/local-only-lifecycle.test.mjs`（21 项）：v2 注入点锚点匹配与输出、原版失败契约（未打补丁时登录检查/HTTP 注册/取令牌代码形态原样；开关关闭零行为变化——P1 门控 vm 沙箱三态断言）、P1 回环约束（vm：非回环覆盖被忽略保留默认）、P6 自动启动 vm 行为（idle 触发一次、非 idle 幂等不触发、失败重试带上限、开关关闭/无工作区零启动、优先官方窗口列举）、v1→v2 升级三路径、同版本重复 apply 不误判。
- **提取** `tests/local-only-fixture.mjs`：共享 fixture（真实产物锚点切片 + 合成 asar 构造），消除测试文件互相 import 的重复执行；fixture 顶层预置 `let b2` 占位压缩名，注入体若向模块顶层引入 `var b2` 会在此直接 SyntaxError（§6 踩坑回归防护）。
- **更新** `tests/local-only-patch.test.mjs`（v2 断言）与 `tests/local-only-lab.test.mjs`（网关 env/调试端口断言）。
- 红→绿记录：`.scratch/logs/lo03-lifecycle-red.log`（实现缺失时 12 项失败）→ `lo03-lifecycle-green.log`（41/41）。修复过程中的真实红灯（`var b2` 与产物顶层 `let b2` 冲突导致 main bundle SyntaxError、锚点跨行断裂）均被测试与真实产物 `node --check` 抓出。
- 全量：`suian-zcode-common` 324/324 通过（`.scratch/logs/lo03-common-full.log`；LO-02 基线 303 + 本票 21）。
- **lab 工具增强**（验证条件所需，随契约测试）：启动器设置 `ZCODE_LOCAL_ONLY_GATEWAY`（与网关配置端口一致）；`--remote-debugging-port`（自动附命令行 `--user-data-dir`，见 §6）；`--workspace`（启动位置参数，官方 argv 语义直开工作区）。`lab-env.mjs`/`lab.mjs` 单一数据源同步更新，check 对网关 env 做回环与端口一致性校验。

## 3. 原生验证逐项结论（真实 lab）

网关：`gateway.mjs --config <lab>/gateway/config.json`（mode=local-only、V2、port 17431、随机 control_token 仅存 lab）。副本启动统一经 lab launcher（隔离 env + 死代理 127.0.0.1:1 + workspace 直开 + CDP 9223）。

### 3.1 无登录冷启动（票面验收 2）

时序（Desktop main 日志 + /health）：先建标志文件（K5 时序，首行 = lab workspace）→ 启动 → `V2 device state connecting → authenticating → paired`（进程启动后约 1 秒内完成）→ `/health` `desktop_connected:true desktop_ready:true paired:true`。**P6 自动触发实证：本轮零 CDP 干预、零人工**（LO-02 同场景需 CDP 调 IPC）。原 Host 探针（`gateway-client.mjs` 未修改字节）：

```json
probeHost: {"ok":true,"stage":"gateway","mode":"local-only","paired":true,"hostReachable":true,"workspaceFound":true,"sessionFound":true}
connectHost: desktopAppVersion 3.16.2, workspaces [{"kind":"local","label":"workspace"}]
```

首启欢迎页以 workspace 位置参数直开工作区绕过（官方 argv 语义，非 UI 自动化），远控 attach 的 workspace 与窗口一致。

### 3.2 网关重启恢复与重连退避（票面验收 3 前半）

- 快速重启：强杀网关 → 同配置重启 → 副本 **10 秒**内恢复 `paired/ready`。
- 长断连（退避观察）：强杀网关后保持 45 秒不可达（时间线 `lo03-gwrestart-timeline.log`：副本对 17431 的 TCP 立即清零，期间无重连泄漏连接）→ 重启网关 → **30 秒内**恢复。日志显示 transport 重连为 `connecting` 重试（两次 connecting 间隔约 92 秒，退避上限约 90 秒级）。
- **无官方 token/上游双证据**（断连与恢复全程）：lab report 按副本 exe 进程枚举 TCP——回环仅 `127.0.0.1:x -> 127.0.0.1:17431 ESTABLISHED`；远控官方端点（zcode.z.ai 注册/token/relay WS）连接数 0（外部仅 TUN fake-ip `198.18.0.69:443` 更新/遥测噪声，与 LO-01/02 基线同形态）；网关侧 `upstream_connected` 始终 false。重连路径不经过官方 getToken（P4 短路对重连同生效）。

### 3.3 主动断链恢复（票面验收 3 后半）

网关零改动下无"进程存活、单连接踢除"入口（`gateway.mjs` 仅整体 closeGateway terminate）。以**强杀网关进程**构造最接近语义：无 close frame 的异常断开，副本 TCP 即刻清零并进入退避重连，网关恢复后重连成功（§3.2 两轮均为该构造）。与"网关重启"的差异（无优雅关闭帧）如实记录；更细的单连接主动断开验证需要网关控制端点，属网关改动，本票不做。

### 3.4 Desktop 重开恢复（票面验收 3 后半）

杀副本进程树（保留 home/userData/workspace 与标志文件）→ 删运行记录重开 → 新进程 **3 秒内** `connecting → authenticating → paired`，desktop_ready 恢复（`lo03-relaunch.log`）。

### 3.5 账号事件隔离（票面验收 4）

经 CDP 在 renderer 执行官方 preload 桥 `window.zcode.notifyWebRemoteControlAuthStateChanged({state:"signed-out"})`（官方 IPC 链，无注入协助）：

```
status before: {"status":"active", ... "mobileConnected":true}
signed-out sent → 3 秒后 status after: {"status":"active"}（未撤销、未 auth-required）
/health after: connected/ready/paired 全保持
```

P5 短路生效。**开关关闭对照（原撤销语义）未验**：撤销目标是活跃 relay 会话 + 真实登录态，lab 无凭据不可构造（规格允许保留未验）；契约层断言官方 signed-out 分支文本完整保留、短路守卫条件于 `__LO_MODE`。

### 3.6 回环约束（票面验收 5）

- 网关 RPC 复核（`ws://127.0.0.1:17431/rpc`）：无 token → HTTP 403；错 token → 403；带浏览器 Origin（即使 token 正确）→ 403；正确 token 且无 Origin → 连接建立。与登记行为一致。
- 回环正向：`ZCODE_LOCAL_ONLY_GATEWAY=http://127.0.0.1:17431` 覆盖被采纳（§3.1 连接即证）；无 env 时默认 17331（LO-02 语义）。
- **非回环负向**：契约层 vm 断言（`http://192.168.1.5:9000` 覆盖被忽略、sA 保持 `ws://127.0.0.1:17331/ws`）+ 回环正向原生证据合并支撑；原生直接构造未达成——手动 env 启动的副本实例三次早退（停在 crash-capture 日志，根因未定位，非 lab 工具链路径），无从观察连接目标，如实记录不以"进程死后零连接"冒充。

### 3.7 模式切换往返（票面验收 6）

| 态 | 补丁存在 | 模式启用 | 实际连接目标 | 观察 |
| --- | --- | --- | --- | --- |
| local-only | 是（v2，status `patched`） | 是（标志文件） | `ws://127.0.0.1:17431/ws` | 自动握手 paired，desktop_ready |
| relay（删标志重启） | 是（v2） | 否 | 官方 relay（不可达） | 零 `[web-remote-control]` 日志（远控未启动），对 17431 无 ESTABLISHED；官方网络尝试被死代理拦（`ERR_PROXY_CONNECTION_FAILED`，auto-update 等）——无登录时官方链路不可用为原版行为非缺陷 |
| 回 local-only（重建标志重启） | 是（v2） | 是 | `ws://127.0.0.1:17431/ws` | 3 秒内自动握手恢复 |

实际在线 relay 验收（真实账号/网络下的官方鉴权链）未验，不以夹具冒充（规格允许）。

### 3.8 会话归属（票面验收 7）

- connectHost bootstrap 从原 Host RPC 链路取回（desktopAppVersion 3.16.2、workspace 由原 Host 管理）；probeHost `workspaceFound:true sessionFound:true`。
- 副本进程数历次 report 稳定 7（主/GPU/renderer/utility/host），重连与重开均未新增 app-server。
- 会话库落盘在 lab 隔离目录（`<lab>/home/.zcode/cli/db/db.sqlite`），未越界写日常 `~/.zcode`。

## 4. 收尾与日常环境核对

- lab 副本 `restore`：恢复后 asar SHA-256 == 原包 `1f960ba2...`；lab 网关与 17431/9223 端口已停；lab 目录（含标志、令牌、日志）留在忽略的 `.scratch/` 不入库。
- 日常网关 127.0.0.1:17329 验证前后正常 LISTENING（日常 Desktop 进程持有）；源安装目录（`{{日常安装目录}}`）全程只读。
- 日常 `~/.zcode/v2/credentials.json` mtime 在验证窗口内有一次刷新；归属核对：日常 Desktop 进程（日常安装目录下 `ZCode.exe`，验证窗口前已常驻）运行的 token 自刷新，与 lab 副本无关（lab 全部进程 env 隔离且写路径均在 lab 内）。
- token：lab 网关 control_token 仅存 lab `gateway/config.json`，未进入任何日志与本文档。

## 5. 票面验收条件自评

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | 原版失败契约：未打补丁/开关关闭时登录检查与 HTTP 注册/取令牌路径代码形态未被改写；开关开启短路生效 | **满足** | §2：fixture 原文断言 + P1 门控 vm 三态 + P2-P4 守卫与官方路径并存断言 |
| 2 | 无登录态冷启动完成本地握手与原 Host 调用 | **满足** | §3.1：P6 自动触发、paired、desktop_ready、probeHost/connectHost（零 CDP、零人工） |
| 3 | 网关重启/断链/重开后恢复，不重取官方 token、不建官方上游、不静默切 relay | **满足（断链构造有具名限制）** | §3.2-3.4：三场景恢复 + TCP/网关双证据；"单连接主动断开"以强杀构造（§3.3） |
| 4 | 登出/账号变化不误撤销本地链路；relay 模式原语义不变 | **满足（对照未验）** | §3.5：signed-out 不撤销实测；开关关闭原撤销语义无登录 lab 不可构造，契约层文本断言 + 未验记录 |
| 5 | 本地开关只匹配回环目标；RPC 要求 control_token、拒绝浏览器 Origin | **满足（负向以契约层为主）** | §3.6：网关 403×3 复核、回环正向原生、非回环忽略为 vm 断言（原生构造失败如实记录） |
| 6 | local-only → relay → local-only 三态记录；在线 relay 未验不冒充 | **满足** | §3.7 三态表；在线 relay 保留未验 |
| 7 | 会话归属原 Host、无新 app-server；补丁版本/摘要/失败与通过记录提交 | **满足** | §3.8 + §1/§5 本表与未验项清单 |

## 6. 未验项与踩坑实录（回填技能）

未验项：

- **开关关闭时 signed-out 原撤销语义**（需真实登录态，§3.5）。
- **非回环网关覆盖的原生直接观察**（手动构造实例早退未定位，§3.6）。
- **实际在线 relay**（无账号/官方网络条件，§3.7）。
- **网关进程存活下主动断开单个 WS**（网关无此入口，零改动约束，§3.3）。

踩坑（详见 `.agents/skills/debug-isolated-zcode/SKILL.md` 回填）：

1. **注入语句不得向 minified 模块顶层引入压缩形态变量名**：`var b2` 与产物顶层 `let b2` 冲突 → SyntaxError → main bundle 加载失败、进程静默退出（首个真实红灯）。解法：求值逻辑全部收进 IIFE，顶层只留 `__LO_*` 唯一前缀声明；fixture 预置 `let b2` 使 `node --check` 用例可抓同类回归。
2. **锚点切片跨行断裂**：fixture 把锚点拆在两行（join('\n')）导致不命中；锚点字节串必须整体单行内嵌。
3. **lab launcher 每次启动前重渲染**：对 `launcher.ps1` 的手工修改会被 `launchLab` 覆盖（本轮手工加网关 env 即被冲掉）；lab 需要的启动参数一律走工具选项（本票已把网关 env/调试端口/workspace 固化进选项）。
4. **CDP 需命令行 `--user-data-dir`**：仅设 env 不够，Electron 41/Chromium 146 下 targets 不暴露；launcher 已在开启调试端口时自动附加（含路径引号内嵌格式，PowerShell 数组参数不自动加引号）。
5. **P1 默认网关与 lab 网关端口不一致时自动启动"零日志"**：默认 17331 无服务时 transport 连接失败日志极少；lab 网关自定义端口必须经 `ZCODE_LOCAL_ONLY_GATEWAY` 显式对齐（工具已自动）。
