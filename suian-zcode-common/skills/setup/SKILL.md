---
name: setup
description: 安装、升级或移除 ZCode 公共网关，建立业务插件共享的公共包入口并迁移旧技能。
---

# 公共插件安装与升级

原生根为 `${ZCODE_SKILL_DIR}/../..`，使用前规范化绝对路径；源码模式沿用已确定的根。先读[路径与数据](../paths.md)。

## 首次初始化

1. 确认 Windows、Node.js 24+ 和用户选择的业务插件。市场安装业务插件会自动安装 common，但不会执行 npm 或 Windows 初始化。原生模式核对 common 已启用；源码模式核对公共目录存在。
2. 在公共根执行 `npm ci --ignore-scripts --no-audit --no-fund`。安装 MCP 时也在 MCP 根执行同一命令；命名自身无需 npm 依赖。不要初始化研究用 sources。
3. 建立共享入口，每个已选择业务插件传一次 --plugin-root；只有公共插件时可不传：

```powershell
node "{{common_root}}/link.mjs" --plugin-root "{{business_root}}"
```

4. 按业务 setup 技能运行安装器 --check-only。只有命名需要 sqlite3 CLI 的只读 JSON 能力。失败先补齐依赖，不注册不可用的服务。
5. 执行 setup.ps1 -Action Status，未安装才 Install。原生模式为 Install/Restart 加 -NativePlugin；源码模式不加，保留旧全局技能入口：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{{common_root}}/setup.ps1" -Action Install -NativePlugin
```

Install 复用唯一当前用户登录任务，以隐藏 VBS → PowerShell → Node 启动并监督网关。健康检查通过后才写用户级 ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL 并广播变更。保留网关数据、端口、令牌和原环境备份，不另建 common 的第二个任务。原生模式不复制全局技能，只移除归属匹配的旧公共技能。

6. 回业务 setup 完成全部配置。改变模式、端口或上游时先读[configuration](../configuration/SKILL.md)。首次连接未生效时仍先完成本机配置，原 Host 验证留到用户重开后。

## 升级

原生插件通过原生管理器更新，不能在版本缓存里 git pull；源码安装先确认干净工作树和基线，再 fast-forward 更新，不覆盖本地修改。公共层和已选择业务插件使用配套版本。

更新后重装公共与 MCP 的锁定依赖，再刷新 link.mjs 的公共入口和所有已安装业务端链接。刷新链接不会重载运行中的网关或 MCP。

需要重载网关时，等插件调用收尾，请用户只暂停 ZCode 的移动端远控，保留 ZCode 与当前 Agent 完成升级。Status 确认 desktop_connected:false 后 Restart，原生模式加 -NativePlugin。脚本等待网关和启动器退出后才更新任务，保留已有配置。业务安装器同时更新通知脚本的代码路径。

交付完整报告后再请用户保存工作、择时从托盘退出并重开 ZCode、重新开启远控。网关经 Restart 生效；新进程加载新的公共模块；既有会话的 MCP 仍可能是旧版。只改文档或不涉及常驻代码的配置时可说明无需重载。

## 移除

单独卸载业务插件保留 common 和网关。只有用户明确要求恢复官方直连或移除公共工具，才执行 setup.ps1 -Action Remove。先保存工作并完整退出 ZCode；入口让网关自行退出，移除自己的任务，恢复原用户环境并广播。外部改过的变量保留。

Remove 不删除业务授权、通知身份、Hook、MCP 或标题策略。若用户还要求清理业务端链接和运行入口，只删除已确认的链接本身，不递归删除目标。报告移除结果和重开后待验证事项。
