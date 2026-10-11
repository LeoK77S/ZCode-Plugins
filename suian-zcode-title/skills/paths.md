# 自动命名的位置与数据

原生调用时，从 `${ZCODE_SKILL_DIR}` 向上两级得到插件根；源码兼容入口读取时沿用已确定的根。原生安装通过 zcode plugins list --json 按完整 id 核对 rootPath、dataPath 和 enabled。CLI 不在 PATH 时按公共 setup 的说明使用实际 Desktop 随包 CLI。

| 模式 | 配置与状态 |
| --- | --- |
| 原生 | dataPath/config.json；状态默认 dataPath/state，有效外部自定义 dataDir 保留；dataPath 来自插件清单 |
| 源码兼容 | 现有根下 config.local.json 与配置指定的 dataDir；已有 .local 保留 |

所有命名 CLI 操作加 --config {{config_path}}，stdin 传 `{"session_id":"sess_...","workspace_path":"工作区绝对路径"}`。目标可以是用户指定的其他会话，不把 turn_id 当用户消息 ID。

公共根从已安装 common 的 rootPath 或源码公共目录确定；原生缓存里不存在可依赖的同级 common。公共安装入口为 {{common_root}}/skills/setup/SKILL.md，配置与排障在该根的对应技能。

迁移前保留旧 config.local.json 的模型选择、原启用或暂停状态与自定义路径。

按 setup 临时暂停并等待旧 worker 收尾后，旧 dataDir 位于源码或版本缓存内时，将状态和授权复制到外置数据目录，默认使用 dataPath/state，并改 config.dataDir 指向新目录；不复制 worker.lock。已有有效外部自定义目录沿用。

复核后保留旧文件供回退，不输出密文或凭据。公共标题策略与网关数据原位置不变，运行数据不放进版本缓存。
