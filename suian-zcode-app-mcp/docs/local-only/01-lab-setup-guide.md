# LO-01 lab 搭建指南：隔离测试环境与原版离线基线

本指南面向需要复现 local-only 验证环境的开发者，覆盖从依赖准备到清理的完整步骤。工具位于 `suian-zcode-common/local-only/`（`lab-env.mjs` 环境定义、`lab.mjs` CLI），契约测试位于 `suian-zcode-common/tests/local-only-lab.test.mjs`。

路径一律使用占位符模板；请按你的机器替换，不要把个人路径写入提交内容。

| 占位符 | 含义 | 示例形态 |
| --- | --- | --- |
| `{{LAB_DIR}}` | lab 根目录（放 git 忽略目录内，副本约 800 MB） | `<repo>/suian-zcode-common/.scratch/local-only-lab` |
| `{{SOURCE_DIR}}` | 受支持的 ZCode Desktop 安装目录（**只读，绝不修改**） | Windows 安装目录，内含 `ZCode.exe` 与 `resources/app.asar` |
| `{{REPO}}` | ZCode-Plugins 仓库/worktree 根 |  |

## 依赖

- Windows + Node.js ≥ 24（读 exe 版本与进程枚举使用 PowerShell，系统自带）。
- 受支持的运行包身份固定为单包（字节身份，不以版本字段代替）：

  | 项 | 值 |
  | --- | --- |
  | ZCode.exe FileVersion | `3.16.2.8769` |
  | resources/app.asar SHA-256 | `1F960BA24A4A6687BB29090A9AC3273C06E9FC18B14882525F591132650A99A8` |
  | app.asar 大小 | 341,334,118 字节 |
  | Chromium（asar 内 UA 字符串） | 147.0.7727.15 |

  身份不匹配时 `setup` 明确失败，不会创建任何目录。要适配其他包，需先在 `lab-env.mjs` 的 `SUPPORTED_PACKAGE` 登记新身份（保持"单包固定"原则），不可用版本号模糊匹配。
- lab 目录所在磁盘需有约 1.6 GB 空余（源读取 + 副本）。

## lab 目录树（setup 自动创建）

```
{{LAB_DIR}}/
├── app/                  # 运行包副本（{{SOURCE_DIR}} 整份复制，摘要与源核对一致）
├── home/                 # HOME/USERPROFILE；ZCODE_DATA_BASE_DIR 指向这里（.zcode 的父目录）
├── desktop-user-data/    # ZCODE_DESKTOP_USER_DATA_DIR（Electron userData 与单实例锁）
├── desktop-session-data/ # ZCODE_DESKTOP_SESSION_DATA_DIR
├── storage/              # ZCODE_STORAGE_DIR（CLI storage 根，替代 ~/.zcode）
├── session-db/           # ZCODE_SESSION_DB_PATH 所在目录
├── appdata/  localappdata/   # APPDATA / LOCALAPPDATA
├── workspace/            # 测试工作区（启动器工作目录）
├── gateway/config.json   # lab 专属网关配置模板（local-only、V2、独立端口、随机 control_token）
├── logs/                 # setup/launch/report/teardown 日志与副本 stdout/stderr（长流程首跑落盘）
├── reports/              # report 产出的证据 JSON
├── launcher.ps1          # 启动器：进程内 set 全部隔离 env 后启动副本 exe
├── lab-env.json          # env 定义（check 的核对对象）
├── lab-manifest.json     # 源/副本摘要清单
└── run-state.json        # launch 写出的运行记录（pid/env 快照；teardown 后移除）
```

两个容易踩的语义点（均已按官方源码核实并固化在工具里）：

- `ZCODE_DATA_BASE_DIR` 指向 `.zcode` 的**父目录**（官方 services `paths.ts` 派生 `{dataBaseDir}/.zcode`），lab 中即 `home/`，不是 `.zcode` 本身。
- 启动器会显式**删除** `ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 与 `ZCODE_WEB_REMOTE_CONTROL_URL` 两个继承变量：日常机器常把前者指向日常网关（127.0.0.1:17329），副本若继承会把第二实例注册进日常网关。

## 步骤

以下命令都在 `{{REPO}}/suian-zcode-common/` 下执行。

### 1. 搭建（setup）

```bash
node local-only/lab.mjs setup --lab "{{LAB_DIR}}" --source "{{SOURCE_DIR}}"
```

- 身份核对失败会直接退出（exit 1）并列出期望与实际，lab 不会创建。
- 成功输出 `lab-manifest.json` 全文；副本 `app.asar` 摘要与源逐字节核对一致。

### 2. 启动前检查（check）

```bash
node local-only/lab.mjs check --lab "{{LAB_DIR}}"
```

逐项核对：每个环境变量的实际解析路径都在 lab 内、`ZCODE_DATA_BASE_DIR` 语义正确、两个 relay 覆盖变量在清除清单、副本摘要与清单一致、启动器指向副本 exe、网关配置为 local-only/V2/独立端口/非空令牌。任一项失败 exit 1 并给出原因。

### 3. 启动（launch）

```bash
node local-only/lab.mjs launch --lab "{{LAB_DIR}}" --proxy-dead-port 47821
```

- 以隔离 env 启动副本，并向 exe 传 `--proxy-server=http://127.0.0.1:47821`（端口需确认无监听）。
- 输出运行记录（PID、启动器进程内 env 快照）。
- **适用边界**：`--proxy-server` 只约束 Chromium 网络栈（更新检查等）；Desktop main 进程的远控 HTTP 走 Node fetch，不受它控制。官方连接证据以 report 的 TCP 观察为准，不能只看代理报错。
- 无登录态前提：lab 的 home/userData 从零创建，不复制日常凭据。

### 4. 观察与取证（report）

等待观察期（建议 60–120 秒，覆盖官方 30 秒 QR-ready 超时）后：

```bash
node local-only/lab.mjs report --lab "{{LAB_DIR}}"
```

产出 `reports/report-*.json`，stdout 给摘要：主 PID 存活、副本进程数、回环/外部连接数与外部连接明细（外部连接即"官方连接尝试"证据）、Desktop 日志尾部（`home/.zcode/v2/logs` 与 userData）、环境快照。观察期内可多次执行。

### 5. 清理（teardown）

```bash
node local-only/lab.mjs teardown --lab "{{LAB_DIR}}"        # 保留副本与全部日志/清单
node local-only/lab.mjs teardown --lab "{{LAB_DIR}}" --purge # 连副本一起删
```

只结束 launch 记录的 PID 进程树（等待实际退出后再清理目录），只删 lab 内路径；日志、报告、清单、网关配置保留。

## 预期回执（原版离线基线）

在"无登录态 + 官方不可达"条件下启动**未打补丁的副本**，预期是**失败基线**而非成功：

- 副本进程存活、窗口停在登录/首屏，不转交日常 Desktop 窗口（单实例锁已隔离）。
- 更新检查被死代理阻断（`net::ERR_PROXY_CONNECTION_FAILED`、`auto-update ... failed`）。
- TCP 观察可见少量外部 443 连接（遥测/更新通道；具体目标域名经系统代理/TUN 后不可见）。
- 远控链路按官方源码在登录检查阶段即阻断（无登录态时根本不进入网络注册阶段）。

这些失败是**预期基线**，如实记录即可；补丁版（后续票）在相同条件下的对照结果才构成离线能力的证明。实测证据见 [原版基线证据](01-original-baseline-evidence.md)。

## 日常环境安全边界

- `{{SOURCE_DIR}}`、日常 `~/.zcode`、日常网关（127.0.0.1:17329）：全程只读，不停、不改、不占用端口。
- 隔离 env 只存在于生成的启动器进程及其子进程内，不写用户环境变量、计划任务、防火墙或 hosts。
- lab 的 `control_token` 随机生成，仅存 lab 目录内；不写入日志或入库文档。
- 收尾建议：对比实验前后日常 `~/.zcode` 内凭据、插件安装记录与会话库的 mtime，确认无本实验痕迹。
