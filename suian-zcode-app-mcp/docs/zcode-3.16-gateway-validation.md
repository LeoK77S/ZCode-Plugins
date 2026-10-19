# ZCode 3.16 网关实验与验证

日期：2026-10-19。范围：独立开发分支 `codex/zcode-3.16`，公共网关的实验性 `terminal` 模式。本记录不代表全部业务插件已兼容，也不代表用户验收。

**后续成功标准已收紧为共存**：手机与插件必须同时连接同一个 Desktop，并持续调用同一个 Host。以下单 terminal 联调仅为中间证据，尚未达到此标准。

## 结论

**网关可以作为账号授权的 terminal 直接连接 3.16.1 的官方 relay**。Desktop 不再把连接指向本地网关；网关只向本地插件提供原有 `connectHost` RPC 接口。

**同一设备暂不能与手机同时保持 terminal 连接**。实测第二个终端接入后，第一个收到 `KICKED`。上游公开契约也规定同一 `(SID, role)` 只保留当前连接。新模式收到替换、断线或心跳超时后停止连接并报告错误，不自动争抢手机的连接。

## 共存所需的接入边界

新源码的 `packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts` 使用 `MessageChannelMain` 创建独立 attachment，并向已有窗口 Host 发送 `AttachServicePort`。`packages/desktop/src/host/windowHostAttachmentRegistry.ts` 按 attachment ID 管理多个连接；`windowHostAttachmentRpcPolicy.ts` 为 `web-remote-replayable` 提供显式允许的 channel 集合。它们提供多附着的实现基础，不等于已向仓库外的网关开放授权接口。

目前核对的附着路径由 Electron Main/UtilityProcess 内部传递 MessagePort，不能仅凭账号 JWT 从外部直接取得。要同时保持“网关与手机平级”和“同一 Host 共存”，需增加 Desktop 授权集成入口；若只修改外部网关，另一条路线是继续代理 V2 并复用手机连接。两条路线涉及不同的部署边界，待用户选择后继续实现；`sources/` 保持只读。

## 依据与运行对象

- 官方源码：[`0a1fc56d279fd1001f78387bd81aec1c26767411`](https://github.com/zai-org/ZCode/commit/0a1fc56d279fd1001f78387bd81aec1c26767411)，由 2026-10-19 的 `main` 获取。上游尚未新增 3.16 tag，不能仅凭主分支提交认定与发行包逐字节一致。
- 共享契约：[`docs/web-remote-control/relay-v2-pairing.md`](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/docs/web-remote-control/relay-v2-pairing.md)。它定义账号隔离、60 秒一次性 token、同角色连接替换和 V2 心跳。
- 实际运行：用户提供的 Windows 便携包 `app/ZCode.exe`，其 `resources/app.asar/package.json` 自报 **3.16.1**，实际加载包内 `out/main/index.js`、`out/host/index.js` 和内嵌运行时。
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

- 新模式目前通过模块接口注入授权提供方。独立登录、账号切换、token 提供方的安全部署及 Windows 安装/升级流程尚未接入。
- 真实 3.16.1 Host 创建的任务 ID 使用 `session_` 前缀；业务插件中既有 `sess_` 校验及其他会话契约仍需独立适配。
- 尚未验证所有 MCP 写工具、自动命名模型请求与 Stop Hook、侧栏评论、断网恢复或真实手机切换。
- 尚未发布兼容版本；市场版本和运行中的本机 3.15 网关保持原状。
