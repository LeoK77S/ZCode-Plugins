# 会话 MCP 的位置与配置

原生调用时，从 `${ZCODE_SKILL_DIR}` 向上两级得到插件根；源码兼容入口读取时沿用已确定的根。用 zcode plugins list --json 按完整 id 核对 rootPath、dataPath、enabled；CLI 不在 PATH 时按公共 setup 使用实际 Desktop 随包 CLI。

原生配置位于 dataPath/config.json，通过 .mcp.json 的 --config 传给 CLI，工件 Hook 也使用该文件；授权状态默认在 dataPath/auth。可设置 indexDbPath、sessionDbPath、artifactDbPath、gatewayConfigPath、authDataDir。CLI 参数优先于对应环境变量和配置，环境变量只覆盖对应数据库与授权路径；已有设置保留。

未指定时数据库仍为当前用户 ~/.zcode/v2/tasks-index.sqlite 与 ~/.zcode/cli/db/db.sqlite；网关默认 ~/.zcode/tools/suian-zcode-gateway/config.json。原生缺外置配置时先初始化，不在版本缓存里存配置或授权。

工件默认位于配置文件同目录的 artifacts.sqlite；未传 --config 的源码模式默认 ~/.zcode/tools/suian-zcode-app-mcp/artifacts.sqlite。覆盖使用 --artifact-db、ZCODE_APP_MCP_ARTIFACT_DB 或 artifactDbPath，Hook 与 MCP 必须指向同一库。备份时同时保留该库的当前状态和历史断点映射；不复制到公共网关或项目 Git。

原生服务由宿主加命名空间，形如 plugin:suian-zcode-app-mcp:suian-zcode-app。看客户端实际清单后使用，不能拿旧全局名断言原生服务不存在；源码模式仍可用 suian-zcode-app。

命令目录 `{{command_dir}}`：含 release.json 的发布包为 `{{plugin_root}}/dist`，源码为 `{{plugin_root}}`。插件根不随命令目录改变。

公共根使用 common 插件的 rootPath；setup 在该根 skills/setup/SKILL.md。公共能力经实际宿主存储根的 installed_plugins.json 定位，不依赖同级目录或包链接。独立技能命令传 `--installed-plugins "{{installed_plugins_json}}"`；源码调试可传 `--common-root "{{common_release_root}}"` 指向已有 common 发布目录。
