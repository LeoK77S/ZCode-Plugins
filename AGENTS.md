# ZCode-Plugins — ZCode 插件 monorepo 根

`ZCode-Plugins/` 是 ZCode 插件与公共工具的集总仓库；每个一级子目录是一个子项目根，内部约定由其自身 `AGENTS.md` 维护，本文件只负责导航与仓库级约定。

## 仓库级约定

- 新增子项目必须在本文件文件树登记，并拥有自己的 `AGENTS.md`；通用规则写这里，专属规则写子项目内。
- `suian-zcode-common/` 是业务插件共用的公共基础能力实现和配置入口：网关、远控协议/探活、DPAPI、Toast 与消息投影。插件仅维护业务规则和提示词，不复制公共实现；运行数据归调用方，网关数据保留原目录。
- `marketplace.json` 是原生市场入口；三个业务条目的 dependencies 都包含 common，各条目版本与插件清单同步。原生插件分别缓存，不硬拼同级缓存路径；业务对 common 的加载正按 PKG 契约分票迁移到安装记录定位（title 已完成，公共导入经薄适配加载 common 发布目录），旧 link.mjs Node 包链接降为源码开发工具。skills/ 按职责拆分，根 SKILL.md 仅作源码兼容路由。
- 开源发布前完成个人信息脱敏（用户名、会话标识、本机路径、授权凭据），由插件各自 `.gitignore` 挡住运行时数据。
- 提交信息用中文，`类型: 简述` 格式，正文分条说明做了什么、为什么做。
- `sources/` 下的 submodule 是研究用的第三方上游快照：只读、不 fork、不修改、不安装依赖；升级钉定提交须在 `sources/README.md` 同步登记。
- 研究与验证笔记统一放 `suian-zcode-title/docs/notes/`（与命名相关）、`suian-zcode-app-mcp/docs/`（与会话操控 MCP 相关）或 `suian-side-editor/docs/`（与侧栏编辑器相关），入库存脱敏版。

## 开发与正式集成纪律

- **分支职责**：`dev` 是开发集成分支，`master` 是当前正式分支；用户泛称的 `main` 在本仓库指 `master`，保留现有分支名。
- **开发变更**：新特性和修复先在开发分支完成验证，再合入 `dev`，不得直接提交或合入 `master`。`dev` 尚不存在时，先从正式分支的当前基线建立，不以正式分支代替开发集成分支。
- **正式集成**：只有用户明确允许正式合并时，才将已验证的 `dev` 变更合入 `master`。推送、建 PR 和合并仍遵循各自的授权边界，不因建立本纪律而自动获得授权。
- **版本范围**：正式集成前，对照 `dev` 与正式分支的差异，确定受影响的插件并更新其版本；未受影响的插件不联动升版。公共层有变化时，按实际影响核对依赖它的业务插件。
- **版本清单**：同步受影响插件的 `.zcode-plugin/plugin.json`；已有版本字段的 `package.json`、锁文件根包与运行时自报版本也必须一致，已有 CHANGELOG 按发布范围更新。修改任一插件清单的 `version` 时，必须在同一变更中同步根 `marketplace.json` 对应条目的 `version`；提交前核对一致，避免原生市场漏检更新。
- **完成条件**：版本更新必须随正式集成内容一并进入 `master`；核对版本一致性、完成受影响范围的验证，并在提交或 PR 正文说明插件版本与验证结果。未完成版本同步，不得宣称正式集成完成。

## 文件树

```
ZCode-Plugins/
├── AGENTS.md               # 本文件：仓库导航与约定（单一事实源）
├── CLAUDE.md               # 通过 @AGENTS.md 导入主文件，仅附加 Claude 专属补充
├── CONTEXT.md              # 开发术语表（词汇与边界定义；Agent 操作入口见各 SKILL.md）
├── README.md               # 面向开源读者的仓库简介
├── marketplace.json        # 四个原生插件的版本、市场清单与业务依赖
├── LICENSE                 # MIT（自有代码）；vendor 第三方代码保留原许可
├── .gitignore              # 仓库级通用忽略规则
│
├── suian-zcode-title/      # ZCode 会话自动命名插件（Stop Hook + 命名决策 + 通知文案；公共导入经客户端契约定位）
│   ├── .zcode-plugin/      # 原生插件元信息
│   ├── hooks/             # 原生异步 Stop 注册（发布构建将命令改指 dist 入口）
│   ├── skills/            # setup / configuration / control / debug
│   ├── common-access.mjs / release-layout.mjs / installer.mjs / build-release.mjs
│   │                       # 公共薄适配与锚点解析、源码/发布双模式布局、安装共享实现、发布目录构建
│   └── docs/notes/         # 研究与验证笔记（脱敏后入库；桌面截图等敏感物料不入库）
│
├── suian-zcode-app-mcp/    # ZCode 会话 MCP（检索、聊天历史、原 Host 改名/创建/发信/压缩/置顶与 stdio 接入）
│   ├── .zcode-plugin/      # 原生插件元信息
│   ├── .mcp.json           # 原生 stdio 注册，配置指向外置 dataPath
│   ├── hooks/              # 同步工件初始化、提交摘要与 Stop 快照
│   ├── ui/                 # 原生只读工件侧栏资源
│   └── skills/             # setup / configuration / sessions / automations / artifacts / glm / debug
│
├── suian-side-editor/     # 本机文本编辑器 0.3.0；多目录切换，选区评论尽力保护，原#47缺口与Native待验
│   ├── AGENTS.md          # 本插件规则与文档入口
│   ├── CLAUDE.md          # 导入 AGENTS.md
│   ├── .zcode-plugin/     # 原生侧栏元信息与市场版本
│   ├── skills/setup/     # 独立缓存的依赖初始化与公共包链接
│   ├── .mcp.json          # stdio 与宿主工作区绑定
│   ├── cli.mjs / server.mjs # 启动入口与 app-only 上下文、目录、读写工具
│   ├── text-files.mjs     # 工作区边界、按层目录、UTF-8 读取与版本检查写回
│   ├── text-resources.mjs # 已登记只读快照、版本通知／退订，后台发送失败报告并停止监测
│   ├── comment-state.mjs # 可信评论状态、V4临时快照与当前分支历史分页、已观测批次证明
│   ├── editor-settings.mjs # 外置 SQLite schema 2、模式与恢复副本事务；回执独立于源保存
│   ├── build-ui.mjs       # 唯一本地 UI 构建入口
│   ├── ui/               # CodeMirror 源文件、自包含构建页面与第三方许可
│   ├── tests/            # 公开契约与浏览器烟测
│   └── docs/             # 规格、票、架构决定与分层验证证据
│
├── suian-zcode-common/    # 公共网关、远控/授权/通知/投影模块、依赖完整性 Stop 钩子、Windows 配置与 Agent skill
│   ├── .zcode-plugin/      # 必需公共插件元信息
│   ├── hooks/              # 原生 Stop 注册（async 触发 depcheck-hook.mjs）
│   ├── link.mjs            # 稳定公共入口与业务端 Node 包链接
│   ├── client.mjs / client-install.mjs  # 公共客户端运行期/安装期入口（PKG-01 契约，commonApiVersion 1）
│   ├── locate.mjs         # 薄定位器：安装记录定位 common，单一源码分发业务包
│   ├── build-release.mjs  # 发布目录构建：esbuild 打包、release.json、buildId 与构建输入记录
│   ├── docs/client-contract.md  # 公共加载契约（锚点、失败分类、导出清单、迁移指引）
│   ├── depcheck.mjs        # suian 系列插件依赖完整性扫描（纯内置模块，可独立运行）
│   ├── depcheck-hook.mjs   # Stop 钩子入口：扫描→缺失时 Toast 提醒（--scan-only 手动复查）
│   ├── toast-action.mjs    # Toast 按钮协议入口：重扫→复制修复提示词→打开 ZCode
│   ├── vendor/             # 固定协议／投影及官方V4 decoder；保留来源和独立许可
│   └── skills/             # setup / configuration / debug
│
└── sources/                # 上游源码 submodule 引用（只读，见 sources/README.md）
    ├── official-zcode/     # zai-org/ZCode @ 0a1fc56d（2026-10-19 公开快照，包含 Relay V2）
    └── zcode-open-bridge/  # tizerluo/zcode-open-bridge @ e8bd9bc（社区桥接参考）
```
