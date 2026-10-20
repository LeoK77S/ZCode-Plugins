---
name: configuration
description: 配置 ZCode 自动命名的模型、思考档位、SQLite 路径与超时，保留既有选择和暂停状态。
---

# 自动命名配置

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与数据](../paths.md)，读取当前外置配置或既有 config.local.json。

stdin 传目标会话，执行 `node "{{command_dir}}/cli.mjs" models --config "{{config_path}}" --installed-plugins "{{installed_plugins_json}}"`，从原 Host 取得实际清单。command_dir 按 paths.md 区分发布包与源码。生成通过用户当前窗口的网关连接，不能猜 providerId、modelId 或 reasoningLevel。

首次安装由用户选择；已明确指定时核验后沿用。升级保留已有组合，只有用户要求更换或原组合不可用时询问。取不到清单时报告原因并保持首次安装暂停，不用示例 selection 代替用户选择。

把真实组合写入 selection：`{"providerId":"...","modelId":"...","options":{"reasoningLevel":"..."}}`。复读并核对清单；首次选择与核验完成后才设 enabled:true。已暂停的旧安装继续暂停，除非用户要求恢复。

按需修改 sqliteBin、timeoutMs、maxOutputTokens 或 gatewayConfigPath；超时允许 1000–300000 毫秒。公共目录非默认时 gatewayConfigPath 指向实际网关配置；保留有效自定义数据库与数据目录，不复制 control_token。

变更由下一次 Hook/CLI 读取，通常不需重启网关。完成后 doctor；它核对静态定义、双库和模型，不证明当前会话已加载 Hook。真实触发按[debug](../debug/SKILL.md)验证。
