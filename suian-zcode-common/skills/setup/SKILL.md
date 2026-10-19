---
name: setup
description: 安装、升级或移除 ZCode 公共网关，建立业务插件共享的公共包入口并迁移旧技能。
---

# 公共插件安装与升级

原生根为 `${ZCODE_SKILL_DIR}/../..`，使用前规范化绝对路径；源码模式沿用已确定的根。先读[路径与数据](../paths.md)。

## 确认 ZCode 版本

先从桌面端的应用信息或实际启动程序确认 ZCode 应用版本，随包 CLI 的版本不能代替应用版本。

**公共插件 0.3.0 起支持 ZCode 3.16 在线模式**，手机共存和核心会话操作已通过验证。安装器按 Desktop 应用版本选择协议：3.16 使用 V2，旧版使用 V1。宿主提供 ZCODE_APP_VERSION 时可自动读取；在外部 Shell 中调用时，使用 -ZcodeAppVersion 传入已核实的应用版本。具体配置与验证边界见[configuration](../configuration/SKILL.md)。

## 远控开关操作

在桌面端打开移动端远程控制面板并开启服务，出现等待连接或已连接的状态后，再检查插件连接。插件不要求手机扫码或保持在线；暂停远控时在面板内点击“停止”。

**ZCode 3.16 暂不支持 local-only**，需要登录 ZCode 账号，并能连接官方远控服务。面板停在“启动中”或显示失败时，结合面板错误与日志检查登录、网络及版本配置，不能直接认定网络不可达，也不能将 local-only 作为 3.16 的回退方案。已支持的旧版是否使用本地模式，按[configuration](../configuration/SKILL.md)处理。

## 首次初始化

1. 确认 Windows、Node.js 24+ 和用户选择的业务插件。市场安装业务插件会自动安装 common，但不会执行 npm 或 Windows 初始化。原生模式核对 common 已启用；源码模式核对公共目录存在。
2. 在公共根执行 `npm ci --ignore-scripts --no-audit --no-fund`。安装 MCP 时也在 MCP 根执行同一命令；命名自身无需 npm 依赖。不要初始化研究用 sources。
3. 建立共享入口，每个已选择业务插件传一次 --plugin-root；只有公共插件时可不传：

```powershell
node "{{common_root}}/link.mjs" --plugin-root "{{business_root}}"
```

4. 按业务 setup 技能运行安装器 --check-only。只有命名需要 sqlite3 CLI 的只读 JSON 能力。失败先补齐依赖，不注册不可用的服务。
5. 执行 setup.ps1 -Action Status -ZcodeAppVersion {{app_version}}，未安装才 Install。版本来自前面的实际 Desktop 核对；不要依赖外部 Shell 未必具备的宿主环境。原生模式为 Install/Restart 加 -NativePlugin；源码模式不加，保留旧全局技能入口：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{{common_root}}/setup.ps1" -Action Install -ZcodeAppVersion "{{app_version}}" -NativePlugin
```

Install 复用唯一当前用户登录任务，以隐藏 VBS → PowerShell → Node 启动并监督网关。健康检查通过后才写用户级 ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL 并广播变更。保留网关数据、端口、令牌和原环境备份，不另建 common 的第二个任务。原生模式不复制全局技能，只移除归属匹配的旧公共技能。

6. 回业务 setup 完成全部配置。改变模式、端口或上游时先读[configuration](../configuration/SKILL.md)。首次连接未生效时仍先完成本机配置，原 Host 验证留到用户重开后。

## 升级

原生插件通过原生管理器更新，不能在版本缓存里 git pull。更新后重新执行 zcode plugins list --json，以新的 rootPath、dataPath 读取并执行 setup，不沿用当前会话加载的旧缓存路径。源码安装先确认干净工作树和基线，再 fast-forward 更新，不覆盖本地修改。公共层和已选择业务插件使用配套版本。

由 Agent 代为更新原生插件时，更新对象是市场副本仓库 suian-zcode-plugins，不是版本缓存：先核对来源分支并拉取远端最新 HEAD，本地修改或分叉时说明原因，不强制覆盖；副本不含 Git 元数据时改用 CLI 的 `plugins marketplace update suian-zcode-plugins` 刷新。CLI 不依赖 PATH：定位用户实际安装的 Desktop 目录，用随应用提供的 zcode CLI（如 `resources/glm/zcode.cjs`，由 Node.js 24+ 执行相同参数），不下载另一份。更新顺序为先 common 后业务插件，命令形如 `zcode plugins update suian-zcode-common@suian-zcode-plugins`，只对实际已安装的插件执行。

更新后重装公共与 MCP 的锁定依赖，再刷新 link.mjs 的公共入口和所有已安装业务端链接。刷新链接不会重载运行中的网关或 MCP。

从新公共根执行 Status -ZcodeAppVersion {{app_version}}，核对 code_status、gateway_path_matches、protocol_update_required、upstream_update_required 与 gateway_restart_required。代码已变化、目录不匹配、协议待升级或旧进程没有指纹时安排安全重载；不要用 health.version 或仅有的连接正常来判断已加载新代码。只修改文档或 skill 时，代码指纹不变；是否重开 Desktop 看环境变更与实际连接，不能仅凭 restart_required 汇总标志决定。

需要重载网关时，等插件调用收尾，请用户只暂停 ZCode 的移动端远控，保留 ZCode 与当前 Agent 完成升级。Status 确认 desktop_connected:false 后执行 Restart -ZcodeAppVersion {{app_version}}，原生模式加 -NativePlugin。脚本等待网关和启动器退出后才更新任务，保留端口、控制令牌、原环境备份及自定义上游；应用升级时同步协议与官方地址。单纯重载且未提供新版本时，保留已配置协议。业务安装器同时更新通知脚本的代码路径。

网关经 Restart 生效；地址未变且原窗口已连接正确网关时，重新开启远控即可。首次接入或改变启动环境时，先交付本机配置与待验证报告，最后请用户保存工作、择时从托盘退出并重开 ZCode，再开启远控。重连后继续业务模型、探活及临时暂停的恢复，不能把待恢复项当作升级完成。

新进程加载新的公共模块；既有 MCP 仍可能是旧版，按 MCP setup 安排断开重连或择时重开并核验。只改文档或不涉及常驻代码的配置时可说明无需重载。

## 依赖完整性检查（Stop 钩子 depcheck）

common 0.2.0 起自带原生 Stop 钩子（hooks/hooks.json → depcheck-hook.mjs），每轮对话结束自动扫描已安装 suian 系列插件的最新缓存：npm 生产依赖目录、各业务端 node_modules/suian-zcode-common 链接、公共稳定入口 runtime（含 common 升级后未重跑 link 的过期链接）。检查实现只用 Node 内置模块与包内相对导入，不经 node_modules 解析，依赖全丢时钩子仍可运行并报警。

发现缺失时弹 Windows Toast（同一数据目录 2 小时冷却），按钮点击复制修复提示词并打开 ZCode；用户把提示词粘贴给任意会话，即可按本技能执行 npm ci 与 link.mjs 修复。修复后手动复查：

```powershell
node "{{common_root}}/depcheck-hook.mjs" --scan-only
```

Toast 身份（协议 suian-zcode-common://fix、AppID SUIAN.SuianZcodeCommon.Toast、开始菜单快捷方式"ZCode 公共基础插件"）由钩子在首次报警前自动幂等注册；setup.ps1 -Action Remove 不清理该身份，明确移除时调用 notification-install.mjs 的 removeToastAssets。

## 旧源码安装迁移

先确定旧根、原启用状态和所选业务插件。把用户设置、旧命名配置与状态、网关配置备份到缓存外的私有目录；含凭据的备份不回显或入库。命名的临时暂停与恢复按其 setup 执行。

按上方升级流程在原生根重建依赖与链接。已有网关按安全重载流程执行 Restart -NativePlugin，更新原任务的代码路径；Status 显示已安装不代表已指向原生缓存。网关数据、端口、模式、令牌及原环境备份继续保留。

业务安装器只移除指定旧根的注册。迁移后复读全局设置和旧技能；技能残留时，读取其中注入的根路径，规范化分隔符和绝对路径后比对归属，只删除已确认属于旧根的副本。保留旧源码与运行数据供回退。

## 移除

单独卸载业务插件保留 common 和网关。只有用户明确要求恢复官方直连或移除公共工具，才执行 setup.ps1 -Action Remove。先保存工作并完整退出 ZCode；入口让网关自行退出，移除自己的任务，恢复原用户环境并广播。外部改过的变量保留。

Remove 不删除业务授权、通知身份、Hook、MCP 或标题策略。若用户还要求清理业务端链接和运行入口，只删除已确认的链接本身，不递归删除目标。报告移除结果和重开后待验证事项。
