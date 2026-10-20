# suian-zcode-common — 公共基础能力

业务插件共用本目录的网关、远控协议、DPAPI、通知和消息投影。0.1.2 新增向后兼容的 Channel 监听入口与固定官方 V4 decoder；0.2.0 新增 Stop 依赖完整性钩子（depcheck）：按安装清单校验各 suian 插件缓存的 npm 依赖与公共包 junction，缺失时 Toast 提醒并提供复制修复提示词的按钮。公共层不导入任何插件，调用方保留业务规则、通知文案、协议身份与配置数据。

## 约定

- 只有网关是常驻独立进程，其他能力是调用方导入的模块；提取代码不代表所有插件自动增加这些行为。
- 网关只绑定 `127.0.0.1`，不读取远控链接或 ZCode 凭据、不记录消息体。本地工作区复用窗口 Host 的一个物理桥，隔离客户端 RPC 编号；共存声明必须区分隔离测试与真实手机验收。实验性 terminal 模式通过调用方的 `getToken` 获取一次性终端 token，Desktop 直连官方 relay；同设备只允许一个 terminal，收到 KICKED 后停止连接，不自动争抢。
- 默认 relay 模式保留官方鉴权与手机共存；显式 local-only 模式仅处理回环 Desktop 的注册、就绪和心跳，不连接官方 relay、不使用传入的 pass_hash，也不宣称官方身份已验证。本地 RPC 仍要求当前用户 control_token；设备入口信任本机进程，拒绝浏览器 Origin。旧配置无 mode 时按 relay 兼容，不因网络失败自动切换。
- relay 的 `relayProtocolVersion`／配置 `relay_protocol_version` 缺省为 1；3.16 显式选择 2，转发 Desktop 一次性 token 与 MID，不另占 terminal。V2 消息严格区分 server_ts／client_ts，使用 Unix 秒；将 auth_ack 转成配对通知时不得带 device_sid。3.16 local-only 暂缓，旧模式测试不构成 3.16 离线证据。
- Windows 安装器按显式 ZcodeAppVersion 或宿主 ZCODE_APP_VERSION 自动选择协议与官方地址；没有新版本信息时保留已配置协议。升级时只迁移旧官方地址，自定义上游、端口、令牌和原环境备份保留；旧配置缺少协议字段按 V1 兼容，不能把无版本依据的默认值当作 3.16 就绪证据。
- 公共远控模块使用调用方提供的授权。DPAPI 明文只在进程内，保存位置由调用方的 `dataDir` 决定；不回显或复制凭据到公共配置。
- Toast 的两小时冷却与互斥实现共用，状态范围由调用方的 `dataDir` 决定。协议、快捷方式和 AUMID 属于调用方，卸载一个插件不删除另一个身份。
- 自动化测试必须注入通知显示、剪贴板及打开工作区的系统边界，不激活真实协议或打开 ZCode 确认框。
- 登录任务用 `wscript.exe` 与数据目录内的 VBS 桥隐藏启动 PowerShell → Node，启动链必须等待子进程并传递退出码，保持异常重试有效。不要把常驻 WScript 指向 Git 工作树内的模板。
- 健康检查默认每次 5 秒、仅超时重试一次；连续超时报未知，不能掩盖为网关已停止。
- 网关健康和任务状态分别检查；任务 Ready 不代表网关停止。重载/移除检查实际连接，等待监听与启动器都退出后再修改配置。
- Windows 网关配置只管理当前用户任务和 `ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL`。不退出或重启 Desktop；Restart/Remove 在 Desktop 已断开时才允许网关自行退出。
- 写入或恢复用户环境后广播 WM_SETTINGCHANGE / Environment；Status 与保留外部环境值不广播。使用 Unicode SendMessageTimeoutW，等待有超时，失败明确报出，不把已运行进程视为已更新。自动测试替换原生广播边界，不通知真实桌面。
- 为兼容既有安装，网关数据仍在 `~/.zcode/tools/suian-zcode-gateway`，任务名和健康接口 service 仍为网关身份。源码兼容路由 skill 部署到 `~/.zcode/skills/suian-zcode-common`，原生拆分技能由宿主加载；迁移不另建任务或丢失原环境备份。
- 新行为先写契约测试。Windows 设置测试使用隔离文件与模拟系统命令，不修改真实用户环境、计划任务或正在运行的 ZCode。
- `vendor/` 固定第三方来源并保留许可；不修改 `../sources/`。验证日志落忽略的 `.scratch/`，入库只保留脱敏汇总。

## 文件职责

| 路径 | 职责 |
| --- | --- |
| gateway.mjs | 唯一 relay V1/V2 网关、一次性 token 转发、同进程 bootstrap 分流及健康状态 |
| gateway-build.mjs | 启动时固定网关、协议与 ws 执行依赖及启动链的代码指纹；提供当前磁盘版本供 Status 比较，文档不参与 |
| terminal-gateway.mjs / terminal-relay.mjs | 3.16 实验性独立终端网关、V2 token 建连、心跳及本机 RPC；授权提供方由调用方注入，未接入 Windows 安装流程 |
| .zcode-plugin/plugin.json / link.mjs | 原生公共插件元信息、稳定公共入口和业务端 Node 包链接 |
| skills/ | setup / configuration / debug，paths.md 统一位置与数据归属 |
| rpc-broker.mjs | 单一 Host 桥、RPC 编号与 v4 握手身份映射、手机虚拟桥与本地客户端分流 |
| gateway-client.mjs | 插件默认 connectHost/probeHost，本地配置与鉴权、RPC call／listen 附着、原事件参数与释放语义及明确失败 |
| setup.ps1 / run.ps1 / run.vbs | 用户任务、变量、公共 skill；按 Desktop 版本选择 V1/V2，保留协议与迁移官方地址，核对运行代码／安装路径／协议，无窗口监督启动、安全重载与恢复 |
| remote.mjs | 官方 relay 鉴权、workspace bridge、Channel RPC 与分层探活 |
| auth-store.mjs | 调用方数据目录内的当前用户 DPAPI 授权存取 |
| title-policy.mjs | 当前用户跨插件的会话锁定策略：MCP 写入，命名插件读取 |
| project-context.mjs | 只读任务索引的会话项目／执行目录；冻结附加目录优先、旧版单目录兼容，拒绝远端、错 Host、相对目录和歧义归属，不写宿主库 |
| notifications.mjs / cooldown.mjs | Toast 显示、XML、两小时冷却、跨进程显示互斥 |
| client.mjs / client-install.mjs | 公共客户端运行期与安装期入口（PKG-01）：再导出三消费者实际使用的公共 API，第一代 commonApiVersion 为 1；导入无副作用，安装期函数独立入口避免运行期携带安装器 |
| locate.mjs | 薄定位器（单一源码，构建时分发到业务包）：按完整插件身份从安装记录定位 common，锚点优先级与失败分类见 docs/client-contract.md；进程内首次加载固定 common 根 |
| build-release.mjs | 发布目录构建（PKG-01）：esbuild 多入口打包（ws 与 vendor 内联）、许可组装、release.json 与 buildId、发布目录外的构建输入记录；npm run build:release -- --out <dir> |
| depcheck.mjs | suian 系列插件依赖完整性扫描：安装清单、npm 生产依赖与两级公共包链接判定 |
| depcheck-hook.mjs / hooks/hooks.json | Stop 钩子入口与原生注册（async 不阻塞）；--scan-only 手动复查 |
| depcheck-prompt.mjs | Toast 摘要与修复提示词模板（缺失清单、缓存根、setup 修复步骤） |
| toast-action.mjs | Toast 按钮协议入口：重扫后复制修复提示词并打开默认工作区 |
| notification-action.mjs | 复制调用方提示词、打开固定默认工作区 |
| notification-install.mjs | 按调用方身份安装/移除协议桥、快捷方式与 AUMID |
| windows.mjs | 公共 PowerShell 执行与安装用文件/系统边界 |
| prerequisites.mjs | 两插件共用的安装检查：Node 版本、公共依赖；仅命名调用方要求 sqlite3 CLI 只读 JSON 能力 |
| ui-capabilities.mjs | ZCode 应用版本与 MCP Apps MIME 判定；不注册业务资源或工具 |
| vendor/ | 固定消息投影和远控协议库，见 NOTICE.md |
| vendor/conversation-wire.js / vendor/conversation-wire.sources.json | 固定官方 V4 topic 帧组装／编码及快照／历史页 schema；49源blob、ref和构建SHA，不代表安装版本逐字节一致 |
| vendor/LICENSE-ZCode / vendor/NOTICE-ZCode-current.md / vendor/LICENSE-zod | 官方Apache-2.0完整许可／NOTICE与构建内Zod MIT许可，禁止改成自有MIT归属 |
| SKILL.md / README.md | 源码兼容路由与公共模块接口，完整操作流程在对应 skills/ 技能 |
| tests/ | 回环网关、隔离 Windows 配置、远控、DPAPI、通知、依赖完整性判定、不自举契约及 PKG-01 公共加载契约（定位器分类、入口导出面、导入纯净、构建确定性与自包含） |
| tests/gateway-rpc.test.mjs / tests/plugin-link.test.mjs | 真实回环call／listen客户端隔离和释放、市场版本一致及独立缓存公共升级契约 |
| tests/terminal-gateway.test.mjs / tests/terminal-relay.test.mjs | 3.16 终端握手与心跳、单桥复用、Host 会话查询、KICKED 及回环访问控制 |
| experiments/ | 仅发合成 auth_init 的研究探针，不自动执行 |
| package.json / package-lock.json | 固定 Node/ws 版本与测试入口 |
| docs/ | [共享运行时与 Release 规格](docs/shared-runtime-release-spec.md)、[开票索引](docs/shared-runtime-release-tickets.md)及脱敏验证证据；历史与本次验证分开 |
| docs/client-contract.md | PKG-01 公共加载契约：锚点事实、定位规则、失败分类、导出清单、release.json 与构建输入说明及业务迁移指引 |
| docs/pkg01-client-contract-evidence.json | PKG-01 红绿与全量回归的脱敏验证证据；完整日志在忽略的 .scratch/ |
