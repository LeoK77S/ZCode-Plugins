---
name: setup
description: 初始化、升级或卸载 ZCode 自动命名，配置外置数据并迁移旧全局 Stop Hook。
---

# 自动命名安装与迁移

原生根为 `${ZCODE_SKILL_DIR}/../..`；源码模式沿用已确定的根。先读[路径与数据](../paths.md)。

1. 原生模式核对 common 与命名插件已启用。按公共 setup 安装锁定依赖、建立公共包和业务端链接，并完成网关配置；命名自身不用 npm install。源码模式同样先建立公共包链接。
2. 确认 Node.js 24+ 和 sqlite3 CLI。安装器验证只读 JSON 查询；sqliteBin → SQLITE_BIN → PATH，不把 npm 同名包当 CLI。绝对路径适合后台进程，显式无效路径不回退。
3. 原生数据来自插件清单。按 paths.md 确定实际状态目录 {{state_dir}}，首次默认 {{data_path}}/state；已有有效外部自定义目录沿用。已有源码安装先转存配置和状态；首次配置保持暂停，不采用示例模型。仅检查通过后初始化：

```powershell
node "{{plugin_root}}/install.mjs" "{{state_dir}}" --native-plugin --config "{{data_path}}/config.json" --check-only
node "{{plugin_root}}/install.mjs" "{{state_dir}}" --native-plugin --config "{{data_path}}/config.json"
```

首次缺配置时建立 enabled:false 的外置配置；已有选择、暂停状态和自定义字段保留。Hook 与技能由宿主管理，安装器只配置通知资产，不重复写全局注册。

迁移旧安装时，第二条命令追加 --legacy-root "{{legacy_root}}"，先确认这确实是原命名根。安装器只移除该根的旧 Stop 命令与归属匹配的旧技能，同一 matcher 内的他人 Hook 保留。迁移后复读用户设置，确认没有新旧双注册。

源码兼容模式仍用 node install.mjs {{data_dir}} --config {{config_path}}，不加 native 标志；该模式部署全局 Hook 和路由技能。两种注册方式不要同时保留。

4. 网关连接后按[configuration](../configuration/SKILL.md)查询账户实际可用模型与档位。首次由用户选择；已有明确选择先核验，不重复询问。取不到清单时保留暂停，报告模型配置待确认，继续完成其他本机配置。
5. 执行 status、doctor 与 probe。首次环境未生效时先交付配置完成报告，最后才安排用户择时重开，原 Host 验证留到重开后；不退出当前 ZCode。配置、模型核验、真实 Stop 和手机共存分别报告。

## 升级与卸载

按对应安装方式更新源码，刷新公共入口，再运行同一安装命令以更新通知 VBS 的代码路径。保留配置、状态、授权和原暂停状态；常驻网关升级只按公共 setup 处理。

原生卸载通知资产用 node install.mjs {{state_dir}} --native-plugin --remove，再通过原生管理器停用或卸载本插件。源码模式不加 native 标志，安装器同时移除自有全局 Hook 与技能。保留业务状态和公共网关；明确要求恢复直连时才调用公共 Remove。
