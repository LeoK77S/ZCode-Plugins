---
name: configuration
description: 修改 ZCode 公共网关的连接模式、端口或上游，保留已有配置并安排 Desktop 环境生效。
---

# 公共连接配置

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与数据](../paths.md)，确认 ZCode 应用版本，再执行 setup.ps1 -Action Status。CLI 版本不能代替应用版本。

| 模式 | 版本范围与条件 |
| --- | --- |
| relay | 默认模式，连接官方上游并保留手机共存；公共插件 0.3.0 起支持 3.16 在线模式，需要已登录账号和可达的官方远控服务 |
| local-only | 仅适用于已支持的旧版，已在 3.14.4 验证；不连接官方远控服务，不支持手机页面，须验证 desktop_ready；3.16 暂不可用 |

已有配置保留 `mode`，缺少该字段时按 `relay` 兼容；缺少 `relay_protocol_version` 时使用 V1。临时网络失败不自动切换模式。面板停在“启动中”或显示失败时，先结合错误和日志核对登录、网络与版本配置，不能仅凭界面状态判定原因。

3.16 使用公共插件 0.3.0 及以上版本，配置 `relay_protocol_version: 2`，上游为 `wss://zcode.z.ai/api/v1/remote/ws2`。现有 Windows 安装脚本尚未接入 V2 参数，不能只修改上游地址，也不能套用下面的默认安装命令。具体配置和已验证范围见[3.16 开发记录](../../../suian-zcode-app-mcp/docs/zcode-3.16-gateway-validation.md)。3.16 不支持以 local-only 回退。

旧版首次 Install 可加 `-Mode local-only`、`-Port {{port}}` 或 `-UpstreamUrl {{url}}`；默认端口为 17329，V1 上游为 `wss://zcode.z.ai/ws`。已有配置按 setup 的暂停远控流程 Restart，只传用户要求改变的字段；原生模式加 `-NativePlugin`。切换本地模式前确认该应用版本在支持范围内，并说明手机连接将不可用。

自定义网关数据目录时，命名与 MCP 配置的 gatewayConfigPath 必须指向同一公共 config.json，不传 control_token。

用户环境变量由 Desktop 主进程启动时读取，MCP 的 env 只影响子进程。广播成功不代表已运行 Desktop 更新了环境。先完成全部配置和本机检查，再让用户择时重开；通常用普通快捷方式即可，不要求注销 Windows。

若广播失败或已确认启动器仍传旧变量，定位实际 Desktop exe，交付下面的外部 PowerShell 命令，不自行退出当前 ZCode：

```powershell
$env:ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL = [Environment]::GetEnvironmentVariable('ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL', 'User')
Start-Process -FilePath "{{zcode_exe}}" -WindowStyle Hidden
```

模型服务、登录和 GLM 额度仍需要各自服务可达。旧版本地模式只免除官方远控连接，不代表这些服务也可离线使用；手机可用性需实际验收。
