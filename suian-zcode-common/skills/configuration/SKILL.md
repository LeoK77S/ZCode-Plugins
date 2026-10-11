---
name: configuration
description: 修改 ZCode 公共网关的连接模式、端口或上游，保留已有配置并安排 Desktop 环境生效。
---

# 公共连接配置

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与数据](../paths.md)，执行 setup.ps1 -Action Status。

| 模式 | 条件与验证 |
| --- | --- |
| relay | 默认模式，连接官方上游并保留手机共存；原 Host 调用需要相应连接 |
| local-only | 用户明确需要内网本机控制时选择；不连接官方 relay，不支持手机页面，须验证 desktop_ready |

已有配置保留 mode，旧配置缺少该字段按 relay 兼容。临时网络失败不自动切模式；需求不明且影响手机时先确认是否需要官方手机远控。

首次 Install 可加 -Mode local-only、-Port {{port}} 或 -UpstreamUrl {{url}}；默认端口 17329，上游 wss://zcode.z.ai/ws。已有配置按 setup 的暂停远控流程 Restart，只传用户要求改变的字段；原生模式加 -NativePlugin。模式切换沿用本机地址与上游，便于恢复。

自定义网关数据目录时，命名与 MCP 配置的 gatewayConfigPath 必须指向同一公共 config.json，不传 control_token。

用户环境变量由 Desktop 主进程启动时读取，MCP 的 env 只影响子进程。广播成功不代表已运行 Desktop 更新了环境。先完成全部配置和本机检查，再让用户择时重开；通常用普通快捷方式即可，不要求注销 Windows。

若广播失败或已确认启动器仍传旧变量，定位实际 Desktop exe，交付下面的外部 PowerShell 命令，不自行退出当前 ZCode：

```powershell
$env:ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL = [Environment]::GetEnvironmentVariable('ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL', 'User')
Start-Process -FilePath "{{zcode_exe}}" -WindowStyle Hidden
```

模型服务、登录和 GLM 额度仍需要各自服务可达，local-only 只解决 relay 依赖；手机可用性需实际验收。
