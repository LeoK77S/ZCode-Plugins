# 公共插件的位置与数据

原生技能正文中的 `${ZCODE_SKILL_DIR}` 由宿主替换为当前技能目录；向上两级就是公共插件根。通过源码兼容入口读取技能时，沿用入口已经确定的根。

其他原生插件的位置使用 `zcode plugins list --json`，按完整 id 核对 rootPath、dataPath 和 enabled。CLI 不在 PATH 时，可用 Node.js 24+ 执行用户实际安装的 Desktop `resources/glm/zcode.cjs`，参数相同；先定位实际安装目录，不能猜路径或下载另一份 CLI。核对 CLI 与 Desktop 使用同一用户及配置目录。

公共代码入口为当前用户 `~/.zcode/tools/suian-zcode-common/runtime` 的目录链接，目标是已确认的公共代码根。业务插件的 `node_modules/suian-zcode-common` 链接到它。Windows 使用目录 junction，无需管理员权限；已有普通目录会报错，不覆盖。升级后刷新入口，新进程加载新代码，运行中的进程仍需重载。

网关数据继续保存在 `~/.zcode/tools/suian-zcode-gateway`，标题锁定策略继续保存在 `~/.zcode/tools/suian-zcode-common/session-titles`。不要搬进版本缓存，不把 control_token 放入参数、环境变量、日志或聊天。

源码安装也要在 npm ci 后运行 link.mjs；npm 清理 node_modules 会移除业务端链接，需重新建立。目录链接不会复制模块。
