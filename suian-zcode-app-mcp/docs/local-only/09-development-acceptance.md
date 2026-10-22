# local-only 开发集成总验收

**日期**：2026-10-22。范围为 `feat/local-only-integration` 相对开发基线 `c29be83` 的 LO-01～07 实施、启动器修复与本轮补票修复。**代理复核结论**：可集成到 dev；真实用户安装与在线 relay 验收仍保持未验，不等同正式发布。

## 本轮发现与修复

**最终连接地址现在始终受回环约束**。v2 只在已有 relay 覆盖为空时检查网关地址，且手写字符串解析可能接受 `127.0.0.1@remote.example`。v3 使用 URL 实际主机，两个覆盖入口都必须满足回环主机及 HTTP/WS 协议要求；拒绝凭据伪装、127 域名前缀与无效 URL。已有回环 WS 地址仍优先，关闭 local-only 时保留原 relay 行为。

**完整还原同时恢复应用和模式配置**。旧命令恢复 app.asar 后保留网关 local-only 模式，与规格不符。当前外部命令恢复包后复用 setup 的 Restart 事务切回 relay，保留端口、控制令牌和原环境备份；事务成功后才回执成功。应用已恢复、网关未恢复时返回 `local-only-restore-incomplete`（退出码 14）；已原版状态也可重试补做模式恢复。

Windows 系统边界由隔离 fixture 替换；补丁 CLI、PowerShell 脚本及配置文件逻辑按测试说明执行。未对日常安装执行外部应用或完整还原。

## 当前补丁身份与原生验证

| 项 | 结果 |
| --- | --- |
| 支持运行包 | Windows 3.16.2.8769，原版 SHA-256 `1f960ba24a4a6687bb29090a9ac3273c06e9fc18b14882525f591132650a99a8` |
| 当前补丁版本 | v3；旧 v1/v2 从完好原版备份升级，不叠加注入 |
| v3 asar SHA-256 | `b9574e1235cd7d2c7b5614ed384a50a48d3c2c249e894fbacb01371913c4b784` |
| 真实 v2→v3 升级 | `upgradedFromPatchVersion:2`、`patchVersion:3`，备份保留原版 |
| 原生负向构造 | 同时设置非回环 `ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 与 userinfo 伪装的 `ZCODE_LOCAL_ONLY_GATEWAY` |
| 冷启动 | 全新 lab 数据根、无登录态、不带 CDP；主窗口 dom-ready，`desktop_connected/desktop_ready:true` |
| 原 Host | `probeHost` 的 `hostReachable/workspaceFound:true`，网关 `upstream_connected:false` |

以上是 v3 的实际运行结果，不用 v2 的历史原生验收替代。既有 MCP、Stop 命名和评论矩阵见 [LO-05](05-mcp-closure-evidence.md)、[LO-06](06-title-acceptance-evidence.md)、[LO-07](07-editor-acceptance-evidence.md)；本轮网关及业务运行代码未修改。

## 测试记录与复核

- 回环限制、完整还原模式缺口均先有失败测试，再实施修复。
- 当前 local-only 三组契约 **59/59 通过**，包含地址解析、v1/v2 升级、备份/还原及启动器。
- setup 的 **50 项**与发布构建 **8 项**在受影响范围检查中通过。组合运行的一项旧注入字符串断言失效，移除已被行为测试覆盖的旧实现断言后，local-only 三组重新通过；完整还原用例补齐夹具摘要后定向复验通过。不重复已通过的长耗时 setup 全组。
- 代码约定与规格两轴独立复核均确认原阻断已闭合；未重复此前 common 330 项及根级 55 项全量。

原始记录在集成工作树忽略目录 `.scratch/acceptance-local-only/`：`loopback-red.log`、`loopback-green.log`、`restore-red.log`、`affected-tests.log`、`local-only-final.log`、`restore-final.log`、`prepare-v3.log`、`apply-v3.log`、`native-v3.log`。失败日志保留，退出码单独记录，不把首次组合运行写成一次全绿。

## 保留的边界

- 只支持登记的 Windows 单包；用户日常安装的真实应用、还原、计划任务组合和在线账号/手机 relay 仍待用户验证。
- 受控模型证明链路，不代表真实模型质量、计费或账号授权。
- LO-07 的发送级失败注入与原生跨工作区场景仍未验；#47、#57 的既有结论不变。
- K12 历史三次早退的持锁者无法逐次追溯。K13 的启动器根因及修复见[启动器诊断](08-launcher-diagnostics.md)。
- 原版 Desktop 副本会写当前用户的协议和右键菜单注册；本轮原生验证后已恢复日常安装入口。数据目录隔离不代表 Windows 系统注册隔离。
