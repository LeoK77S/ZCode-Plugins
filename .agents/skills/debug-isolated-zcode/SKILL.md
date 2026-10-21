---
name: debug-isolated-zcode
description: 调试隔离 ZCode Desktop/CLI 实验环境（local-only lab）：lab 工具用法、分层排查方法论与已知卡点（欢迎页卡住、单实例锁、开关时序、PowerShell/asar 坑）。在 ZCode-Plugins 仓库搭建、启动或诊断隔离 ZCode 环境，或排查 local-only 补丁链路问题时使用。
---

# 调试隔离 ZCode 环境

隔离 ZCode 环境 = 复制的运行包 + 独立数据根 + 进程级环境变量集，用于在不触及日常安装（`D:/APP/_ForCoder/ZCode`）、日常 `~/.zcode` 与日常网关（127.0.0.1:17329）的前提下验证 Desktop/CLI/补丁行为。本技能沉淀 local-only 系列（LO-01 起）的排查方法与踩坑实录。

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

### K1 首次启动卡欢迎页（人工可跳过，脚本难跳过）

- **症状**：隔离副本首次启动停在欢迎/引导页，无登录态时脚本自动化无法继续；远控面板等入口不可达。
- **根因**：欢迎引导是首启必经流程，完成状态记在 userData 内（具体持久化文件名待回填）。
- **解法**：人工点击跳过一次（LO-02 由用户完成）；此后 userData 记忆引导完成，重启直接进主页。CDP 自动点击跳过尝试三轮未稳定成功（证据：`.scratch/lo02-cdp-start*.log`）。
- **CDP 补充（LO-02 实证）**：CDP 可越过 UI 直接调用官方 IPC（如 `zcode:start-web-remote-control`）验证 main 链路——UI 卡点不阻断链路级验证；CDP 连接需给 Electron 显式传 `--user-data-dir`。
- **把"首启需要一次人工跳过"写进可复现步骤，不要假装全自动**。
- **来源**：LO-02 实录（证据文档 `02-patch-evidence.md`）。

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
- **解法方向（LO-03 范围）**：开关开启时 main 启动后自动触发 start（跳过 renderer 依赖），或等价的最小注入；链路级验证可先用 CDP 调 IPC 过渡（见 K1 CDP 补充）。
- **来源**：LO-02 具名缺口（证据文档 §10 未验项）。

## 维护约定

- 每张 LO 票收尾时，实施者（或协调者）把该票**新**踩的坑回填到"已知坑实录"，注明票号与证据路径；修正既有条目的"待确认"标注。
- 经验只收"可复现的动作 + 可指认的证据"，不收一次性结论；与 lab/patch 工具行为相关的变更以工具源码为准，技能不复制实现细节。
- 本技能位于仓库 `.agents/skills/`（入库；ZCode 以 worktree 根的 `.agents/skills` 为兼容发现路径，`.zcode/skills` 优先同名时以其为准）。
