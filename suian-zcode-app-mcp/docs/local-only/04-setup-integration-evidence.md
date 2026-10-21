# LO-04 setup 产品流程集成证据（脱敏）

**执行日期**：2026-10-21。**对象**：真实构建发布目录（common 0.6.0，58 文件，补丁工具随包）＋ lab 隔离副本（3.16.2.8769 字节身份与登记一致）。**结论先行**：local-only 已进入产品 setup——构建包的 setup.ps1 在选 `-Mode local-only` 时先做补丁预检（仅受支持包放行），准备候选、安装回环网关并生成交付用户的外部 apply/restore 命令；用户退出实例后执行外部命令完成应用与开关激活，原快捷方式重开后 6 秒内 paired、desktop_ready 与原 Host 探针通过；切回 relay 一次完成关网关模式/开关/环境值且不重写应用包；完整还原恢复原版摘要；升级改包后旧候选被明确拒绝。setup 自身不执行 apply、不强退进程、不启动等待助手。

原始日志与 lab 数据留在 git 忽略的工作树根 `.scratch/`（`logs/lo04-*.log`、`local-only-lab-lo04/`）；本文只收脱敏摘录。代码基线见提交本身。

## 1. 契约层（先红后绿）

- 新增 setup 契约用例 5 项（`suian-zcode-common/tests/setup.test.mjs`），红（实现缺失时旧拒绝 `does not support local-only` 仍触发，`lo04-setup-red.log`）→ 绿（`lo04-setup-green-*.log`）；既有"3.16 local-only 拒绝"断言改写为新契约（缺 `-ZcodeInstallDir` 拒绝）。
- 桩机制沿用 systemFixture（Windows 注册表/任务/广播/健康 HTTP 桩）；补丁工具边界以同名 `Invoke-PatchCli` 桩注入（setup.ps1 的默认实现为守卫式定义，外部先定义时不覆盖——与既有桩同法），**桩对 apply/restore 一律失败，构成"setup 任何 Action 不得直接执行应用/还原"的证明**。
- 覆盖：受支持包放行（默认端口 17331、config/环境一致性、原值备份保留）、未知包/摘要变化/身份解析失败在写配置与停网关前拒绝且附诊断指引、prepare 失败拒绝安装、重复准备幂等（候选重备、任务不重复注册）、已应用当前补丁不再准备、旧版本补丁走升级准备、外部命令生成与内容断言（精确目标/候选/标志路径/工作区；不含 Stop-Process/taskkill/Stop-ScheduledTask）、切回 relay 删标志并恢复模式（不触碰补丁工具）、Status 附加只读补丁状态。
- 全量：suian-zcode-common 329/329 通过（`lo04-common-full.log`；LO-03 基线 324 + 本票 5）。

## 2. 产品流程层（真实构建包，lab 语义）

执行形态：构建发布目录的 setup.ps1 真实执行；Windows 系统边界（计划任务/注册表/广播/健康 HTTP）以 systemFixture 桩到 lab 状态文件（约束：不改真实用户环境/任务/通知）；**补丁工具、网关部署 CLI、外部命令、标志文件、网关进程全部真实**（lab runner 脚本从测试文件提取 fixture 并移除补丁桩）。网关由部署目录真实副本直启，验证 setup 产物 config 自包含可用。

| 步骤 | 回执摘要 | 日志 |
| --- | --- | --- |
| 日常安装只读预检演示 | `status --target <日常目录>`：supported=true、patchState=original（3.16.2.8769 字节身份匹配；全程只读） | `logs-daily-status.txt` |
| 构建与自包含 | `build:release` 58 文件含 `local-only/{patch,patch-env,lab-env}.mjs` 与 setup.ps1 | `lo04-build-release.log` |
| setup local-only 安装 | ok、mode=local-only、port 17331、协议 V2（desktop_version）、网关部署与活动记录切换、环境广播（桩）；`local_only.state=prepared`、patch_state=original、patch_version=2、apply/restore 脚本路径与预期回执说明 | `lo04-setup-install.log` |
| 候选确定性 | 候选 app.asar SHA-256 == LO-03 登记的 v2 补丁摘要 `71c640b5...`（同输入同字节） | `candidate.json` |
| 未退出拒绝 | 实例运行中执行外部命令：exit 12 `running_instance`，列全部 PID，明示"不强退、关闭后重试"，无其他变更 | `lo04-apply-refused-running.log` |
| 外部应用 | 关闭实例后执行：`{"ok":true,"applied":"applied","activated":true,...}`；标志文件首行=工作区；副本 asar==候选摘要、备份==原版摘要 | `lo04-apply-success.log` |
| 原快捷方式重开验证 | 重开后 **6 秒内** `connecting→authenticating→paired`；/health `desktop_connected/desktop_ready/paired` 全 true 且持续保持（30 秒轮询）；P6 自动启动零 CDP 干预、零人工 | `lo04-lab-launch4.log` |
| 原 Host 探针 | 未修改字节的 `gateway-client.mjs`：probeHost `ok=true, mode=local-only, paired=true, hostReachable/workspaceFound/sessionFound=true`；connectHost bootstrap `desktopAppVersion 3.16.2`、workspaces 含目标工作区 | `lo04-probe.log` |
| 切回 relay | `Restart -Mode relay`：mode=relay、`local_only_switch=disabled`（标志删除）、端口保留、环境值按 relay 网关写入；**补丁工具零调用，应用包未重写**；网关按新 config 重启自报 mode=relay；副本重开后零 `[web-remote-control]` 日志、对 17331 零 ESTABLISHED、外部连接 0（无登录时官方链路不可用为原版行为） | `lo04-switch-relay.log`、`lo04-relay-report.log` |
| 完整还原 | 外部 restore 命令：`restoredAsarSha256 == 原版 1f960ba2...`；status 回 original、备份与状态清理 | `lo04-restore.log` |
| 升级拒绝（摘要变化） | 对副本 asar 改一字节后执行外部命令：exit 10 REFUSED，透传实际摘要失配与可执行诊断（status/debug skill 指引），零变更；恢复字节后 status 回 patched | `lo04-apply-upgrade-refused.log` |

网关配置一致性：setup 写出的 config（mode=local-only、relay_protocol_version=2、port=17331、control_token 仅存 lab 数据目录）被部署目录网关真实加载并按模式服务；`ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 指向 `ws://127.0.0.1:17331/ws` 且原值备份保留在 config（`previous_user_relay`）。

## 3. 票面验收条件自评

| # | 验收条件 | 结论 | 依据/缺口 |
| --- | --- | --- | --- |
| 1 | setup 区分原版/已 patch、受支持/未知包与 relay/local-only；仅匹配支持包放行，版本未知明确报错，不泛化 3.16 | **满足** | 契约层 unsupported/digest/resolve_fail 三类拒绝 + lab 真实预检（supported/original 放行）；放行判定来自补丁工具字节身份 |
| 2 | Agent 定位原目录，预检准备后给精确外部命令与预期；不关闭/重启当前 Desktop、无等待助手 | **满足** | setup 只调 status/prepare（桩证明无 apply/restore）；外部命令含精确目标/候选/预期回执；lab 全程未强退任何用户进程 |
| 3 | 外部命令在实例退出后应用激活；重开后检查模式/端点、desktop_ready 与原 Host；准备成功不宣称已应用 | **满足** | §2：拒绝→应用→重开 paired/ready→probeHost/bootstrap；回执语义表区分 prepared/applied/activated/ready |
| 4 | 开关与网关配置一致；保留端口/control_token/原环境备份与暂停远控纪律；失败不写成已就绪、回退失败如实报告 | **满足（lab 语义）** | config 一致性核对；外部命令在健康确认与环境写入成功后才生成；任务/广播为桩（真实注册路径沿用既有契约测试）；"外部命令未生成即失败"由顺序保证 |
| 5 | 切回 relay 保留补丁关闭本地分支；完整还原独立外部命令；升级后旧补丁停止套用并给可执行诊断 | **满足** | §2 切回/还原/升级拒绝三行；切回零补丁调用 |
| 6 | common 正式构建含补丁入口与资源，独立缓存可定位；发布缓存不 npm ci/link.mjs，不带研究源或完整包 | **满足** | 58 文件含 local-only 三件；lab 期间未在发布目录 npm/link；候选/备份只在数据与目标目录 |
| 7 | 隔离文件、系统调用桩与实际构建包验证首次/重复准备、未退出拒绝、应用成功/失败、切换与还原；桩不改真实环境 | **满足** | 契约层（桩）+ 产品层（真实包）；apply 失败路径以运行实例拒绝与升级拒绝实证，写入失败类沿用 LO-02 契约 |
| 8 | 技能解释择时退出重开，区分预检/准备/待应用/已应用未生效/验证就绪；不暴露个人路径/令牌/内部细节 | **满足** | setup/configuration/debug 三技能更新（回执语义表、开关与切换、故障分层表）；内容以占位符表达，操作指向脚本 |

## 4. 未验项与具名限制

- **日常真实安装的应用**：产品流程在 lab 副本完成；用户日常安装目录只做了只读 status 预检演示，真实 apply/重开留用户验收（产品语义即如此安排）。
- **全新 userData 首启窗口问题（本轮具名发现）**：lab 中重置 userData/sessionData/home 后，workspace 直开未创建主窗口（P6 无窗口可触发、零远控日志；原版 asar 对照同样无窗口，与本票实现无关）；userData 完成首启初始化后（哪怕由原版完成）一切正常。根因未定位，已回填技能 K13。**后续修正**：当时 lab 传的是裸位置参数，Desktop 只识别 `--open-workspace`（K1），该前提不成立，本观察需在修正参数后重新评估。
- **Windows 任务注册/环境广播真实路径**：产品层以桩验证（约束要求），真实路径由既有 setup 契约测试覆盖；"真实计划任务 + 真实注册表"的组合留日常安装验收。
- **在线 relay 真实账号链路**（延续 LO-03）：切回 relay 的无登录复核只证明官方尝试被拦的原版行为，真实手机/账号验收未做。
- **外部 443 噪声归属**：与 LO-01~03 相同的 TUN fake-ip 限制。

## 5. 收尾与日常环境核对

- lab teardown 完成（副本进程树、网关进程、17331/9223 端口全部释放；lab 目录在忽略的 `.scratch/` 不入库）。
- 日常网关 127.0.0.1:17329 验证前后正常 LISTENING；日常安装目录全程只读（仅 status），日常 `app.asar` 摘要验证后仍为原版 `1f960ba2...`；本流程未写任何日常环境变量/任务/通知。
