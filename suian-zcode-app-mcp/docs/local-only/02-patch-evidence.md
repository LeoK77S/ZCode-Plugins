# LO-02 补丁与网关接入证据（脱敏）

**执行日期**：2026-10-21。**对象**：ZCode Desktop 3.16.2 运行包的隔离副本（LO-01 lab 工具搭建）＋ 未修改的公共网关直启实例。**结论先行**：完全短路补丁在真实包上成立——无登录态、无官方 HTTP 注册/取令牌的条件下，补丁副本以本地设备身份完成网关握手（auth_init 无 role → auth_ack matched → desktop_ready），心跳保持，`probeHost`/`connectHost` 经原 Host RPC 取回 bootstrap；网关字节未变；副本远控链路零官方连接。**具名缺口**：无登录态下 renderer 不触发远控启动链（main 侧 start 依赖 renderer IPC），本轮以 CDP 调用官方 preload 桥触发完成验证，产品化触发路径属后续票。

原始日志、报告、候选包与备份留在 git 忽略的 `suian-zcode-common/.scratch/`（`logs/lo02-*.log`、`lo02-candidate/`、`local-only-lab-lo02/`）；本文只收脱敏摘录。代码基线见提交本身的文件清单。

## 1. 补丁身份与摘要

| 项 | 值 |
| --- | --- |
| 补丁版本 | 1（`local-only/patch-env.mjs` `PATCH_VERSION`） |
| 原包 app.asar SHA-256 | `1f960ba24a4a6687bb29090a9ac3273c06e9fc18b14882525f591132650a99a8`（341,334,118 字节，与 LO-01 登记一致） |
| 补丁包 app.asar SHA-256 | `cb545ea5abac442d71191214875596e1889c299445a6eef4c5121deebdecddaf`（341,335,098 字节） |
| out/main/index.js | 806,407 → 807,387 字节（净增 980） |
| 注入点 | 5 处，锚点在产物内唯一命中（构建时逐点校验，失配即 `anchor_mismatch`） |

注入点清单（prepare 输出，`candidate.json` 存档）：

| id | 位置（原 index.js 字节偏移） | 语义 |
| --- | --- | --- |
| P0-fs-import | 文件首行 | `node:fs` existsSync 自包含命名 import |
| P1-mode-gate | @777182（sA/iA var 语句后） | 开关判定（env > 数据根标志 > userData 标志）→ sA 改写 `ws://127.0.0.1:17331/ws`（外部 env 已设置则不动）→ 22 字符 token 生成器 |
| P2-login-short-circuit | @777899 | getLogin 回调短路，返回固定本地凭据（放行登录检查与续检） |
| P3-device-sid-short-circuit | @406484 | resolveDeviceSid 回调短路，常量 `local-only-device`，跳过 HTTP 设备注册 |
| P4-token-short-circuit | @406296 | getToken 回调短路，本地 22 字符 token，跳过 HTTP 取令牌 |

短路全部条件化于 `__LO_MODE`：开关关闭时官方代码路径原样执行（契约测试断言官方路径文本保留）。P1 只改写 relay WS 覆盖值（官方 `desktop/src/main/index.ts:898` 原生覆盖入口），不重定向 endpointOrigin——HTTP 注册/取令牌不是被重定向而是被跳过，网关无需新增 HTTP 端点。

补丁包 `out/main/index.js` 通过 `node --check`（ESM）语法检查；确定性已验证（同输入两次 prepare 产出 asar 字节一致，契约测试覆盖）。

## 2. 工具行为（契约层，先红后绿）

- 契约测试 `suian-zcode-common/tests/local-only-patch.test.mjs` 20/20 通过；红→绿记录在 `.scratch/logs/local-only-patch-red.log`（实现缺失时加载失败）与 `local-only-patch-green.log`。修复过程中的真实红灯（P1 语句边界语法错误、asar 流复制解构错误、变量笔误）均被测试抓出后修复。
- 覆盖：status 三态（original/patched/conflict）、prepare 候选与摘要记录、身份不符（版本→`unsupported_package`，同版本摘要→`digest_mismatch`）、锚点失配拒绝、apply 全链（备份→验证→替换→状态记录）、运行实例拒绝（进程枚举桩）、重复 apply 识别（备份 mtime/摘要不变）、restore 摘要核对、目标变化拒绝 restore、fuse ENABLE 拒绝、注入结果 `node --check`。
- `suian-zcode-common` 全量 303/303 通过（`.scratch/logs/lo02-common-full.log`；LO-01 基线 283 + 本票 20）。worktree 缺 `node_modules` 时的 31 项失败为环境缺失（esbuild 未装），`npm ci` 后全绿，非代码回归。
- 构建接入：`local-only/lab-env.mjs`、`local-only/patch-env.mjs`、`local-only/patch.mjs` 进入 `MANAGEMENT_STATIC`；`npm run build:release` 输出 58 文件含三件（`.scratch/logs/lo02-build-release.log`），release.json 逐文件摘要完整。lab.mjs（隔离实验工具，面向开发者复现）不进发布目录。

## 3. 网关字节未变证据

- 直启命令：`node gateway.mjs --config <lab>/gateway/config.json`（lab 专属配置：mode=local-only、relay_protocol_version=2、port 17331、随机 control_token 仅存 lab）。
- `gateway.mjs` SHA-256：`6853d3927412877793bfc62776c4cb8a31b56313198342a664c247a2c57d5624`；`git diff --stat HEAD -- suian-zcode-common/gateway.mjs` 为 0 行（`.scratch/logs/lo02-gateway-sha.txt`）。`gateway-client.mjs`（probeHost/connectHost）同为仓库原字节。
- 网关启动回执：`{"ok":true,"relay_url":"ws://127.0.0.1:17331/ws","health_url":"http://127.0.0.1:17331/health"}`。

## 4. 原生握手、心跳与原 Host 探针

时序（Desktop main 日志 + 网关 /health，`logs/lo02-*` 与 lab 报告存档）：

```
[main] [web-remote-control] V2 device state {"state":"connecting"}
[main] [web-remote-control] V2 device state {"state":"authenticating"}   ← auth_init 已发（无 role，device_sid=local-only-device）
[main] [web-remote-control] V2 device state {"state":"paired"}           ← auth_ack matched
[main] [web-remote-control] attaching workspace bridge window=1 ...      ← RPC 桥建立
[main] [web-remote-control] workspace bridge active ...
/health → desktop_connected:true desktop_ready:true paired:true（触发后持续保持，25 秒后复核仍 true）
```

- 无登录态：lab home/userData 从零创建（LO-01 隔离），启动前无任何凭据；登录检查被 P2 放行（无 `auth-required` 错误）。
- 无 HTTP 注册/取令牌：握手全程未发生对官方端点的 POST（TCP 证据见 §5；P3/P4 短路后 register/token 回调不触网）。
- **原 Host 探针（核心证据）**：`gateway-client.mjs`（未修改字节）对 lab 网关执行：

```json
probeHost: {"ok":true,"stage":"gateway","mode":"local-only","paired":true,"hostReachable":true,"workspaceFound":true,"sessionFound":true}
connectHost bootstrap: {"desktopAppVersion":"3.16.2","workspaces":[{"kind":"local","label":"workspace",...}],"mobileTaskViewEpoch":"..."}
```

bootstrap 从原 Host RPC 链路（/rpc WS + Bearer control_token → 网关 broker → 补丁副本 Desktop → 原 Host）取回，构成"最小原 Host 连接"闭环；未使用静态接入判断或另起 CLI app-server。

## 5. 网络证据（按 PID 的 TCP 观察）

lab report（`reports/report-20261021T131328004Z.json`，按副本 exe 路径枚举全部进程后过滤 netstat）：

| 分类 | 明细 |
| --- | --- |
| 回环 | `127.0.0.1:60075 -> 127.0.0.1:17331 ESTABLISHED`（远控 WS，唯一回环连接；未连日常网关 17329） |
| 外部 | 2 条 `-> 198.18.0.69:443 ESTABLISHED`（系统 TUN fake-ip 段；与 LO-01 原版基线**相同形态**的更新/遥测通道噪声，更新检查另被死代理 `ERR_PROXY_CONNECTION_FAILED` 拦截） |

远控链路的官方端点（zcode.z.ai HTTP 注册/取令牌/relay WS）连接数为 **0**：原版在该条件下被登录检查阻断、补丁版被短路，均未发起。外部 443 噪声非远控通道，其具体域名经 TUN 映射不可见（与 LO-01 同一未验项）。

## 6. renderer 面板可见性观察（票面第一验证项）

**观察结果（原样记录）**：补丁副本无登录冷启动后观察 75 秒（第一轮，无 CDP、标志未启用），main 日志零条 `[web-remote-control]`——远控 manager 未被触发。源码核实：`manager.startAuthorized` 仅由 renderer IPC（`zcode:start-web-remote-control`）进入；无登录首屏下承载该入口的 UI 组件不挂载/不调用。**renderer 侧登录 gate 缺口实测成立**（05 笔记 §6 风险 2 落实），main 侧补丁完备但产品路径上无人扣动扳机。

**本轮验证手段**：经 CDP（`--remote-debugging-port` + 显式 `--user-data-dir`，Chromium 对默认数据目录下的远程调试有安全缓解，二者缺一 targets 不暴露）在 renderer 执行官方 preload 桥 `window.zcode.startWebRemoteControl({workspacePath:<lab workspace>})`——触发的是官方 IPC 链，不改包、不改网关。该手段仅用于验证，不是产品触发路径。

**影响与归属**：主侧短路、握手、Host 探针全部成立；"无登录用户在 UI 上点开本地远控"的产品闭环需要 renderer 侧入口（登录 gate 放行或替代触发器），属后续票范围（建议在 LO-03 与登出/账号通知短路一并处理；restorePreviouslyEnabled 恢复路径同样依赖 renderer workspace sync，一并覆盖）。

## 7. 开关关闭态行为（开关二态证据）

第一轮启动（补丁包、无标志文件、无 env）75 秒观察：应用正常启动（3 进程存活、无注入相关错误、更新检查/遥测与原版基线一致），远控链路零活动——`__LO_MODE=false` 时全部短路不生效、官方代码路径原样保留。补丁存在 ≠ 本地模式启用，两态分离符合规格。

## 8. restore 与日常环境核对

- `restore`：恢复后 asar SHA-256 == 原包 `1f960ba2...`（输出 `restoredAsarSha256` 逐字符核对），状态与备份清理，`status` 回到 `original`（`logs/lo02-restore.log`）。
- 日常环境：日常网关 127.0.0.1:17329（PID 91244）验证前后正常 LISTENING；日常 `~/.zcode/v2/credentials.json` mtime 未变化；lab 网关 17331 与 CDP 9223 端口已释放；源安装目录全程只读（仅 setup 读操作）。
- token/令牌：lab 网关 control_token 仅存 lab `gateway/config.json`，未进入任何日志或本文档。

## 9. 验收条件自评（票面 8 条）

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | 公开工具入口先红后绿；核对实际编译产物；记录原包/补丁包/补丁版本摘要 | **满足** | §1/§2：红绿日志、真实产物锚点（asar-extract 实测）、三摘要齐备 |
| 2 | 原包匹配才生成候选；准备不改运行中的应用；各类失败明确 | **满足** | 契约测试覆盖 unsupported_package/digest_mismatch/anchor_mismatch 分类；prepare 全程只读目标 |
| 3 | 应用前重查运行实例退出；不强退；备份验证后才替换；重复应用不覆盖备份 | **满足** | running_instance 检查（WQL 枚举）；备份先验证（SHA 核对）后替换；重复 apply 识别（备份 mtime 断言） |
| 4 | 显式本地分支跳过账号/注册/取令牌，连匹配回环网关；未启用保留原行为 | **满足** | §4/§5/§7：P2-P4 短路实测生效、回环握手成立、关闭态零行为变化 |
| 5 | 不改网关与 connectHost 契约，现有握手/心跳取得 desktop_ready 并调通原 Host 探针；提供网关字节未变与无官方连接证据 | **满足** | §3/§4/§5：gateway.mjs SHA + git diff 0 行、probeHost ok、bootstrap 取回、官方端点连接 0 |
| 6 | 独立还原恢复匹配备份与配置；被外部修改时拒绝；注入失败验证恢复 | **满足（部分原生）** | restore 摘要核对原生通过（§8）；目标变化拒绝为契约测试覆盖；"注入应用失败中逋试恢复"仅契约层模拟（原生无失败可复现），列为未验项 |
| 7 | 工具纳入 common 正式构建与安装期入口；发布包不带 Desktop 完整包/备份/个人数据 | **满足** | §2：MANAGEMENT_STATIC 三件进构建、release.json 完整；候选/备份只在 .scratch 与目标目录，不入包 |
| 8 | 原网关无法复用时提交具名失败与最小调整建议；不得以静态判断冒充原 Host 验证 | **不适用（网关复用成立）** | 未发生短路方案失败；renderer 触发缺口按具名观察记录（§6），未以任何冒充手段替代验证 |

## 10. 未验项清单

- **renderer 触发路径**：无登录 UI 入口的补齐（登录 gate 放行或替代触发器）未实施——§6 具名缺口，建议随 LO-03 立项。
- **产品流程层**：setup 技能选 local-only → Agent 准备 → 用户外部应用 → 原快捷方式重开的完整产品闭环未走（本票为工具层 + 原生层验证；setup 接入属后续票）。
- **apply 中途失败的真机恢复演练**：原生路径未复现替换失败（写入一次成功）；契约层以模拟校验恢复逻辑。
- **网关重启恢复**：Desktop 在网关重启后自动重连（transport 退避重连逻辑）未实测；LO-04/LO-05 范围。
- **外部 443 噪声的具体域名**：经系统 TUN fake-ip 映射不可见（与 LO-01 相同限制）。
- **switch 回 relay 模式**：`ZCODE_LOCAL_ONLY=0` 强制关闭 + 官方链路回归未实测（需登录态，lab 无凭据；规格允许保留未验）。

## 11. 实测补充事实（供后续票使用）

1. **Electron 精确版本 41.0.3**（CDP `/json/version` 运行时确认，补齐 LO-01 未验项；Chromium 146.0.7680.80，与 05 笔记静态推导一致）。
2. **`__LO_MODE` 为模块加载期一次性求值**：标志文件必须在启动前存在，启动后补写无效（实测踩坑：teardown 清理 lab home 会连带删除标志）。产品语义上合理（模式随启动判定），操作手册须写明。
3. **CDP 远程调试需显式 `--user-data-dir`**：Electron 41/Chromium 146 下默认数据目录的 `--remote-debugging-port` target 不暴露；验证手段记录备查。
4. **`lab.mjs teardown` 清理 home 目录**：含数据根标志；lab 内做开关相关实验时先 teardown 再重建标志。
