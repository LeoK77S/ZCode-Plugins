---
name: configuration
description: 配置 ZCode 会话 MCP 的数据库、网关和授权目录，或接入源码客户端；不重复注册原生服务。
---

# 会话 MCP 配置

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与配置](../paths.md)。

原生模式编辑 dataPath/config.json，保留未变字段；JSON 无效明确报错。按需设置 indexDbPath、sessionDbPath、artifactDbPath、gatewayConfigPath、authDataDir。.mcp.json 已注册服务，同步工件 Hook 也读这份配置；不再追加另一个服务或重复 Hook，个人配置不写入版本缓存。

默认数据库和网关位置有效时不新增路径设置。自定义 gatewayConfigPath 与命名插件指向同一公共文件，不把 control_token 或远控链接放入配置、args/env 或聊天。

源码接入默认用 ~/.zcode/cli/config.json；用户明确只针对工作区时用 .zcode/config.json。先解析已有文件，只合并本服务，保留 Hook、模型、其他服务和既有有效参数：

```json
{
  "mcp": {
    "servers": {
      "suian-zcode-app": {
        "type": "stdio",
        "enabled": true,
        "command": "{{node_exe}}",
        "args": ["{{plugin_root}}/cli.mjs"]
      }
    }
  }
}
```

node_exe 用实际 Node.js 24+ 的绝对路径。安装启用时移除本服务旧 enable 字段，残留 false 会停用服务。mcp.config.example.json 的 mcpServers 形状用于兼容客户端，不整段粘进 ZCode 原生 config；同作用域原生配置优先，排障先固定生效文件。

改配置后核对实际服务名和连接。既有会话可能持有旧子进程，生效与升级见[setup](../setup/SKILL.md)，不宣称文件更新已改变运行中工具。
