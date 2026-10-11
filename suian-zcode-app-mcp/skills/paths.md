# 会话 MCP 的位置与配置

原生调用时，从 `${ZCODE_SKILL_DIR}` 向上两级得到插件根；源码兼容入口读取时沿用已确定的根。用 zcode plugins list --json 按完整 id 核对 rootPath、dataPath、enabled；CLI 不在 PATH 时按公共 setup 使用实际 Desktop 随包 CLI。

原生配置位于 dataPath/config.json，通过 .mcp.json 的 --config 传给 CLI；授权状态默认在 dataPath/auth。可设置 indexDbPath、sessionDbPath、gatewayConfigPath、authDataDir。CLI 参数优先于对应环境变量和配置，环境变量只覆盖对应数据库与授权路径；已有设置保留。

未指定时数据库仍为当前用户 ~/.zcode/v2/tasks-index.sqlite 与 ~/.zcode/cli/db/db.sqlite；网关默认 ~/.zcode/tools/suian-zcode-gateway/config.json。原生缺外置配置时先初始化，不在版本缓存里存配置或授权。

原生服务由宿主加命名空间，形如 plugin:suian-zcode-app-mcp:suian-zcode-app。看客户端实际清单后使用，不能拿旧全局名断言原生服务不存在；源码模式仍可用 suian-zcode-app。

公共根使用 common 插件的 rootPath 或源码公共目录；setup 在该根 skills/setup/SKILL.md。原生业务缓存没有同级公共模块，依赖通过共享 Node 包链接加载。
