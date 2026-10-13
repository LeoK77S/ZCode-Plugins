# ZCode-Plugins — ZCode 插件 monorepo 根

`ZCode-Plugins/` 是 ZCode 插件与公共工具的集总仓库；每个一级子目录是一个子项目根，内部约定由其自身 `AGENTS.md` 维护，本文件只负责导航与仓库级约定。

## 仓库级约定

- 新增子项目必须在本文件文件树登记，并拥有自己的 `AGENTS.md`；通用规则写这里，专属规则写子项目内。
- `suian-zcode-common/` 是业务插件共用的公共基础能力实现和配置入口：网关、远控协议/探活、DPAPI、Toast 与消息投影。插件仅维护业务规则和提示词，不复制公共实现；运行数据归调用方，网关数据保留原目录。
- `marketplace.json` 是原生市场入口；两个业务条目的 dependencies 都包含 common。原生插件分别缓存，通过公共 link.mjs 建立 Node 包链接，不硬拼同级缓存路径。skills/ 按职责拆分，根 SKILL.md 仅作源码兼容路由。
- 开源发布前完成个人信息脱敏（用户名、会话标识、本机路径、授权凭据），由插件各自 `.gitignore` 挡住运行时数据。
- 提交信息用中文，`类型: 简述` 格式，正文分条说明做了什么、为什么做。
- `sources/` 下的 submodule 是研究用的第三方上游快照：只读、不 fork、不修改、不安装依赖；升级钉定提交须在 `sources/README.md` 同步登记。
- 研究与验证笔记统一放 `suian-zcode-title/docs/notes/`（与命名相关）、`suian-zcode-app-mcp/docs/`（与会话操控 MCP 相关）或 `suian-side-editor/docs/`（与侧栏编辑器相关），入库存脱敏版。

## 文件树

```
ZCode-Plugins/
├── AGENTS.md               # 本文件：仓库导航与约定（单一事实源）
├── CLAUDE.md               # 通过 @AGENTS.md 导入主文件，仅附加 Claude 专属补充
├── CONTEXT.md              # 开发术语表（词汇与边界定义；Agent 操作入口见各 SKILL.md）
├── README.md               # 面向开源读者的仓库简介
├── marketplace.json        # 三个原生插件的市场清单与业务依赖
├── LICENSE                 # MIT（自有代码）；vendor 第三方代码保留原许可
├── .gitignore              # 仓库级通用忽略规则
│
├── suian-zcode-title/      # ZCode 会话自动命名插件（Stop Hook + 命名决策 + 通知文案）
│   ├── .zcode-plugin/      # 原生插件元信息
│   ├── hooks/             # 原生异步 Stop 注册
│   ├── skills/            # setup / configuration / control / debug
│   └── docs/notes/         # 研究与验证笔记（脱敏后入库；桌面截图等敏感物料不入库）
│
├── suian-zcode-app-mcp/    # ZCode 会话 MCP（检索、聊天历史、原 Host 改名/创建/发信/压缩与 stdio 接入）
│   ├── .zcode-plugin/      # 原生插件元信息
│   ├── .mcp.json           # 原生 stdio 注册，配置指向外置 dataPath
│   ├── hooks/              # 同步工件初始化、提交摘要与 Stop 快照
│   ├── ui/                 # 原生只读工件侧栏资源
│   └── skills/             # setup / configuration / sessions / artifacts / glm / debug
│
├── suian-side-editor/     # 手动 Native 通过；自动保存修复整合及两轴代码复核通过，Native 待验
│   ├── AGENTS.md          # 本插件规则与文档入口
│   ├── CLAUDE.md          # 导入 AGENTS.md
│   ├── .zcode-plugin/     # 原生侧栏元信息（尚未加入正式市场清单）
│   ├── .mcp.json          # stdio 与宿主工作区绑定
│   ├── cli.mjs / server.mjs # 启动入口与 app-only 上下文、目录、读写工具
│   ├── text-files.mjs     # 工作区边界、按层目录、UTF-8 读取与版本检查写回
│   ├── editor-settings.mjs # 外置 SQLite 全局默认／会话保存模式事务，不保存正文
│   ├── build-ui.mjs       # 唯一本地 UI 构建入口
│   ├── ui/               # CodeMirror 源文件、自包含构建页面与第三方许可
│   ├── tests/            # 公开契约与浏览器烟测
│   └── docs/             # 规格、票、架构决定与分层验证证据
│
├── suian-zcode-common/    # 公共网关、远控/授权/通知/投影模块、Windows 配置与 Agent skill
│   ├── .zcode-plugin/      # 必需公共插件元信息
│   ├── link.mjs            # 稳定公共入口与业务端 Node 包链接
│   └── skills/             # setup / configuration / debug
│
└── sources/                # 上游源码 submodule 引用（只读，见 sources/README.md）
    ├── official-zcode/     # zai-org/ZCode @ 29628c9（v3.14.3 公开快照）
    └── zcode-open-bridge/  # tizerluo/zcode-open-bridge @ e8bd9bc（社区桥接参考）
```
