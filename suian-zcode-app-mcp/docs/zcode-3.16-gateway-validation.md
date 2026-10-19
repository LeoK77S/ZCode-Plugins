# ZCode 3.16 网关实验与验证

日期：2026-10-19。范围：独立开发分支 `codex/zcode-3.16`，原版 3.16.1 Desktop 与公共网关的 `relay` V2 模式；保留此前独立 `terminal` 实验作为历史依据。本记录不代表全部业务插件已兼容，也不代表正式发布。

**当前边界**：用户已选择网关与官方远控路线，不修改 Desktop；local-only 与断网冷启动暂缓。`sources/` 保持只读。此前获准的 Desktop 适配实验已停止，并移出受版本控制的代码与测试目录。

## 当前实现与验证

**V2 代理路线已实现并通过一轮真机双向验证**。Desktop 使用官方 HTTP 接口注册设备、获取 device token，再经回环网关连接官方 WS；手机独立登录官方 Web。网关转发 Desktop 的一次性 token 与 MID，不创建额外 terminal。本机插件通过 control token 附着网关，与手机复用同一个 Host 物理桥。

```text
原版 Desktop ── 回环网关 ── 官方 relay V2 ── 官方手机 Web
                    │
                    └── 本机插件 connectHost / MCP
```

模块入口为 `startGateway({mode:'relay', relayProtocolVersion:2, controlToken})`。配置对应 `relay_protocol_version:2`，上游为 `/api/v1/remote/ws2`；CLI 也支持 `--relay-protocol-version 2`。旧配置不含该字段时仍为 V1，旧上游与消息行为保持。健康接口增加 `relay_protocol_version`；插件的 `connectHost` 接口不变。

V2 使用严格消息 schema：注入 Desktop 的数据为 `server_ts`，发往官方上游的数据为 `client_ts`，均使用 Unix 秒。鉴权完成后的本地配对变化使用 `pair_status_ack`，不能重复发送 `auth_ack`，也不能携带只属于 auth_ack 的 `device_sid`。实机复现的首次附着超时已补入契约测试，按红灯、修复、绿灯验证。

**真机第一轮**：用户在官方手机页面发送合成文本，插件通过同一 Host 读取到输入及模型回复；随后使用 MCP 控制器改名与发信，用户确认手机同时看到新标题和消息。持续连接共读取 393 次，其中 350 次发生于官方手机配对期间，错误数为 0。该轮发生于下述隔离失误发现之前，不能用于宣称测试数据完全隔离。

**纠正存储隔离后的原版运行包**：通过 MCP 控制器完成创建、首发、改名、历史读取、状态查询、置顶与取消置顶，读到模型最终回复。标准 stdio MCP 进程完成 `list_sessions`、`read_session`、`get_current_session`、`pin_session`、`unpin_session`、`send_message` 与 `start_session`，来源 ID 和 build 权限继承有效。新会话在隔离 CLI 库中存在，并核对其 ID 不存在于本机默认 CLI 库。

命名插件也在标准 MCP 新建的测试会话上，手动触发真实历史读取、原 Host 辅助模型生成、格式检查、改名和读回，结果为 `renamed`。此处使用实际辅助模型请求，未通过 mock 替代；仍不代表真实 Stop Hook 自动触发链已经验收。

**最后一轮真机复验仍待补齐**：修正隔离并重载最终网关后，已启动持续 Host 读取监测，等待用户在新建的隔离会话补发消息。此处不得以虚拟 paired 状态替代手机在线证据。

**自动回归**：公共层 148 项、命名插件 73 项全部通过；MCP 的控制器、会话读取与 stdio 相关 61 项通过，共 282 项，退出码均为 0。包含旧 relay/local-only、V2 token/MID 转发、严格消息字段、首次心跳前附着、手机与多个本地客户端的 RPC/V4 身份隔离，以及新旧会话 ID 前缀。V1 回归通过不等于已完成 3.15 实机复测；本轮未升级或重启本机 3.15 程序。

测试与联调原始日志首次运行即保存于忽略的 `.scratch/3.16/`。已通过的回归不因提交或交付阶段切换而重复运行。

## 首轮隔离失误与已确认影响

最初仅覆盖了 Desktop 的数据目录，包内 CLI 的默认会话库仍解析到本机用户目录。已确认本机 CLI 库留下四个测试会话，并在首次启动时自动执行两项 0.16.9 迁移：`0023_session_soft_delete_outcome` 为 session 表增加 `time_deleted`、`last_outcome`，`0024_session_database_identity` 创建 `zcode_database_identity`。这未满足原定的数据隔离要求。

迁移前的官方自动备份已另存至测试目录的受限区域。备份是迁移涉及表的快照，不能视为整个当前数据库的完整备份；未用旧表快照覆盖当前库，也未擅自删除字段或回滚迁移，以免覆盖之后的新数据。本机程序文件未修改；本节记录的会话库影响仍保留，不能写成“本机 3.15 完全未受影响”。

后续同时隔离 HOME、USERPROFILE、APPDATA、LOCALAPPDATA，显式配置 `ZCODE_STORAGE_DIR` 与 `ZCODE_SESSION_DB_PATH`，并停用隔离 CLI 的插件自动加载。登录凭据副本按隔离 home 重新加密，明文只在内存，未修改原凭据。新会话的两库定位与本机默认库未命中检查已通过。

## 历史独立 terminal 实验

**网关可以作为账号授权的 terminal 直接连接 3.16.1 的官方 relay**。Desktop 不再把连接指向本地网关；网关只向本地插件提供原有 `connectHost` RPC 接口。

**同一设备暂不能与手机同时保持 terminal 连接**。实测第二个终端接入后，第一个收到 `KICKED`。上游公开契约也规定同一 `(SID, role)` 只保留当前连接。新模式收到替换、断线或心跳超时后停止连接并报告错误，不自动争抢手机的连接。

## 共存所需的接入边界

新源码的 `packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts` 使用 `MessageChannelMain` 创建独立 attachment，并向已有窗口 Host 发送 `AttachServicePort`。`packages/desktop/src/host/windowHostAttachmentRegistry.ts` 按 attachment ID 管理多个连接；`windowHostAttachmentRpcPolicy.ts` 为 `web-remote-replayable` 提供显式允许的 channel 集合。它们提供多附着的实现基础，不等于已向仓库外的网关开放授权接口。

核对的附着路径由 Electron Main/UtilityProcess 内部传递 MessagePort，不能仅凭账号 JWT 从外部直接取得。该阶段评估过 Desktop 授权入口与 V2 代理两条路线；本轮已按用户最终指令实施 V2 代理，Desktop 授权入口不再作为交付方案。

## 依据与运行对象

- 官方源码：[`0a1fc56d279fd1001f78387bd81aec1c26767411`](https://github.com/zai-org/ZCode/commit/0a1fc56d279fd1001f78387bd81aec1c26767411)，由 2026-10-19 的 `main` 获取。上游尚未新增 3.16 tag，不能仅凭主分支提交认定与发行包逐字节一致。
- 共享契约：[`docs/web-remote-control/relay-v2-pairing.md`](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/docs/web-remote-control/relay-v2-pairing.md)。它定义账号隔离、60 秒一次性 token、同角色连接替换和 V2 心跳。
- 实际运行：用户提供的 Windows 便携包 `app/ZCode.exe`，其 `resources/app.asar/package.json` 自报 **3.16.1**，实际加载包内 `out/main/index.js`、`out/host/index.js` 和内嵌运行时。原包 app.asar 的 SHA-256 已与实验前记录核对一致；已停止的 Desktop 适配副本不用于当前路线验收。
- 启动与隔离：直接启动程序，显式设置 `ZCODE_DATA_BASE_DIR`、`ZCODE_DESKTOP_HOME_DIR`、`ZCODE_DESKTOP_USER_DATA_DIR`；测试工作区也位于独立目录。未使用会向本机用户目录播种的便携包启动器。
- 授权：便携包的跨机器密文无法在本机解密，测试改用本机既有登录态的隔离副本。网关仅接收授权提供方返回的短期 token；账号 JWT 和 control token 不写入本记录或协议日志。

## 接口与结构

新增 `startGateway({mode:'terminal', deviceSid, deviceMid, getToken, controlToken})` 模块接口。`deviceSid` 与 `deviceMid` 来自账号下选定的设备；`getToken` 每次连接取得一个 role 为 terminal 的新 token，不复用已消费 token。

```text
Desktop ───────── 官方 relay V2 ───────── 普通手机 Web terminal
                         │
                         └──────────── 集成 terminal 网关 ── 本机插件 RPC
```

图中的两类 terminal 处于同等协议角色，但同一设备 SID 上仍互斥。集成端没有改变服务端的连接名额规则。

V2 使用 `/api/v1/remote/ws2?token=...&mid=...`，`auth_init` 不再发送 role/hash，时间戳改为 Unix 秒。`mid` 是路由提示，不能作为账号授权凭据；联调时必须传入目标设备的正确 MID。

3.16 的 bootstrap 只提供工作区与窗口状态，不再提供 `tasks`。网关在附着指定会话时改为向目标工作区 Host 调用 `zcode-task.getTaskMeta` 验证归属。旧版带 `tasks` 的 bootstrap 继续沿用原有检查。

## 已执行验证

**3.16.1 真实运行包联调**：官方 token 签发、终端鉴权及配对成功；bootstrap 成功；工作区桥与本地 `connectHost` 附着成功；读取模型目录成功；在新建的隔离会话内发送合成文本，取得 `inputAccepted` 回执；随后改名并通过 `getTaskMeta` 读回确认。发信回执只证明 Host 受理，不代表已确认模型最终回复或真实 Stop Hook。

首次尝试在会话尚未收到首条输入时直接改名，Host 返回 `Session not found after write`。发送首条合成输入后，同一链路的改名与读回通过；不能把这次 Host 会话持久化差异归因为 relay 鉴权失败。

**连接替换实测**：对同一隔离设备建立第二个合法 terminal，第一个收到 `KICKED`，第二个配对成功。此处是两个协议终端的隔离测试，未用真实手机浏览器进行验收。

**自动测试**：新增回环 HTTP/WS 契约，覆盖 V2 鉴权字段、心跳 ACK 超时、KICKED 分类、多个本地客户端复用一个官方连接和 Host 桥、缺失会话拒绝、Origin/control token 访问控制及不存在 Desktop 代理入口。执行 `node --test suian-zcode-common/tests/*.test.mjs`，公共层 **144 项全部通过**，退出码 0，包含旧 relay/local-only 回归。该结果来自本次工作树；未为发布凭证另跑全量。

原始联调日志首次执行即保存于忽略的 `.scratch/3.16/`，按失败假设只重跑相关探针；未修改研究用上游源码，也未安装上游依赖。

## 尚未完成

- V2 relay 已接入模块、配置与 CLI；Windows 安装/升级脚本尚未新增协议版本参数，正式部署与版本发布未完成。独立 terminal 的授权提供方仍只是实验接口。
- 真实 3.16.1 Host 创建的任务 ID 使用 `session_` 前缀；公共命名策略及命名插件 Hook、历史、后端已兼容该前缀，同时保留 `sess_`。
- 尚未验证所有 MCP 写工具、自动命名模型请求与 Stop Hook、侧栏评论、断网恢复或真实手机切换。
- 尚未发布兼容版本；市场版本和运行中的本机 3.15 网关保持原状。CLI 会话库的首轮隔离失误及残留影响见上文，不能据此推断其数据未变化。
