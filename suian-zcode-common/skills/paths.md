# 公共插件的位置与数据

原生技能正文中的 `${ZCODE_SKILL_DIR}` 由宿主替换为当前技能目录；向上两级就是公共插件根。通过源码兼容入口读取技能时，沿用入口已经确定的根。

其他原生插件的位置使用 `zcode plugins list --json`，按完整 id 核对 rootPath、dataPath 和 enabled。CLI 不在 PATH 时，可用 Node.js 24+ 执行用户实际安装的 Desktop `resources/glm/zcode.cjs`，参数相同；先定位实际安装目录，不能猜路径或下载另一份 CLI。核对 CLI 与 Desktop 使用同一用户及配置目录。

原生安装的公共代码入口是**宿主安装记录定位的发布目录**（PKG-01 契约）：Hook 与 MCP 由宿主注入的 `ZCODE_PLUGIN_DATA` 向上两级推导存储根并读取 `installed_plugins.json`，按完整身份 `suian-zcode-common@suian-zcode-plugins` 定位；技能命令与独立 CLI 显式传 `--installed-plugins`，源码调试传 `--common-root`。发布目录带 `release.json`（含逐文件摘要与 commonApiVersion），业务加载前校验完整性与 API 兼容，不自动 npm 安装、不修链接、不回退旧缓存。旧式 `~/.zcode/tools/suian-zcode-common/runtime` junction 与业务端 `node_modules/suian-zcode-common` 链接是源码开发时期的遗留，迁移后按 setup 的 legacy-cleanup 清理；诊断只报告其存在，不再判为损坏。

网关数据继续保存在 `~/.zcode/tools/suian-zcode-gateway`，标题锁定策略继续保存在 `~/.zcode/tools/suian-zcode-common/session-titles`。不要搬进版本缓存，不把 control_token 放入参数、环境变量、日志或聊天。

网关运行文件部署在缓存外 `~/.zcode/tools/suian-zcode-common/deployments/<buildId>`（真实文件副本，非 junction），稳定启动器在 `~/.zcode/tools/suian-zcode-common/launchers`。计划任务指向稳定 VBS，经活动网关记录 `active-gateway.json` 选择部署版本与实际 Node；删除版本缓存后网关仍可从部署目录启动。活动 Toast 记录 `active-toast.json` 与网关记录独立。业务公共模块缺失时不从网关部署目录补业务代码，另行按原生 common 安装诊断。

depcheck（依赖完整性 Stop 钩子）的数据在宿主插件数据目录的 `state` 子目录（原生模式即 `~/.zcode/cli/plugins/data/suian-zcode-common@suian-zcode-plugins/state`；无宿主数据目录时回退 `~/.zcode/suian-zcode-common`）：`depcheck-last.json` 最近一次扫描结果、`hook.log.jsonl` / `toast-action-log.jsonl` 运行日志、`toast-launch.vbs` / `toast-appid.txt` / `toast-cooldown.json` / `toast.lock` 通知身份与冷却状态。诊断用 `SUIAN_DEPCHECK_HOME` 环境变量可覆盖扫描根，仅限测试与人工排查。

共享 Toast 稳定运行时在 `~/.zcode/tools/suian-zcode-common`（与网关部署目录分离）：`toast/executor.mjs` 缓存外公共执行器（旧通知点击不依赖插件缓存）、`toast/launch.vbs` 稳定启动器（URI 精确白名单）、`active-toast.json` 活动 Toast 记录（共享运行根直下；网关移除以其为探针保留部署目录）、`toast/identities/<protocol>.json` 各调用方外置身份描述（title 的排障提示词模板随身份外置在其数据目录）。协议激活链为：注册表命令 → 调用方数据目录 `toast-launch.vbs`（转发桥）→ 稳定启动器 → 公共执行器。执行器更新经安装流程暂存校验后切换活动记录，失败保留旧部署，不重启网关。

源码开发（仅源码）在 npm ci 后运行 link.mjs 建立入口链接；npm 清理 node_modules 会移除业务端链接，需重新建立。目录链接不会复制模块；正式安装与诊断不依赖它。
