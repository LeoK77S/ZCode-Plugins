# suian-side-editor

独立侧栏文本编辑器的**本地开发切片**。目录树、临时／固定页签和版本检查手动保存已通过 SDK、真实构建浏览器、限定 Native 烟测及独立两轴复核，见 [SE-03](docs/se03-verification.md)。SE-01 的 H1/H2 已经人工原生审批实测及两轴复核通过。本插件暂不加入市场清单；[#43](https://github.com/ONEGAYI/ZCode-Plugins/issues/43) 本地范围已完成，远端票仍开着，不代表完整首版或用户验收。

## 当前可验证的行为

- 独立原生入口为 `editor`，仅在具有会话身份的宿主上下文提供。
- `.mcp.json` 将宿主 `ZCODE_PROJECT_DIR` 明确绑定到 `cwd` 和专属环境变量 `SUIAN_SIDE_EDITOR_WORKSPACE`。服务端不以 `process.cwd()` 推断归属。
- `get_editor_context` 只读取宿主请求 meta 的 `session_id`；目录、读取与保存工具只接收工作区相对路径。八个工具仅对满足公共 MCP Apps 能力门槛的客户端注册，visibility 均为 `app`。恢复状态工具同样不接受调用方指定身份。
- 缺失或冲突的归属会阻止文件访问。绝对路径、穿越、Windows 备用数据流及指向工作区外的链接被拒绝。
- 读取返回规范路径、正文、UTF-8/BOM/换行特征和实际读取字节的 SHA-256 版本。非法 UTF-8、二进制控制字节、目录、缺失文件和权限失败明确报错。

- 顶部文件夹按钮开关右目录树，node_modules、隐藏文件与无扩展名文件可浏览。主区域按右树之外的剩余宽度居中。
- 单击复用一个斜体临时页；双击或首次编辑固定为正体。已打开文件只激活，保存后保持固定。
- 保存按钮和 Ctrl+S 写回当前正文；磁盘版本不符则拒绝。保存等待期间新增编辑仍未保存，失败保留正文。关闭脏页提供保存并关闭／放弃修改／取消。

- 内部保存方式按钮切换手动／自动。首次默认为手动；模式通过插件自有 SQLite 持久化。当前会话切换时事务更新当前会话与全局默认，已有其他会话保持自己的模式，新会话继承最新默认。
- 自动模式在停止输入 800 ms、切换内部页签和切入自动模式时尝试保存；切手动取消尚未开始的任务。写回仍走同一内容版本检查入口。
- 首次打开仍由受审工具验证可信归属并登记只读资源；之后订阅该资源的内容变化，收到 URI 通知后读当前快照。稳定文件不再由页面循环调用读工具。干净正文自动刷新并保留有效阅读位置；脏正文或读取／写入失败保留当前正文并暂停该文件自动保存。保留编辑不授权覆盖；重新读取需确认放弃编辑。

SE-04 的原 Native 重复读审批失败保留。[资源订阅修复](docs/se04-watch-fix-verification.md) 及[三轮修正](docs/se04-watch-round3-verification.md) 已通过统一执行等同性、独立代码复核和 42 项浏览器验证；未改 SDK 复用 33/33。[新 Native 证据](docs/se04-watch-native-verification.md) 与文档门槛两轴复核通过，SE-04 本地限定条件已闭合，当前结果见 [实施总记录](docs/development-verification.md)。新轮视觉未验。

[SE-05](docs/se05-verification.md) 新增会话恢复副本：页签顺序、临时／固定属性、当前页、每文件阅读位置与未保存正文独立持久化。页面显示副本待同步、成功或失败；只有回执到达才确认副本已同步。恢复遇磁盘冲突或读权限失败保留脏正文，干净文件重新读取最新磁盘内容。[三类原生生命周期](docs/se05-native-verification.md) 的 H4 实测及源 Native 文档两轴已通过，#45 本地限定条件已满足；最终统一文档两轴待根复核，评论接入继续受 H3 门槛约束。

[首轮复核修正](docs/se05-review-fix-verification.md) 保留改指后的原身份脏副本、阻止重复恢复与初始化期间未计入副本的编辑。[第二轮修正](docs/se05-round2-verification.md) 与[脏目标分支补齐](docs/se05-round3-verification.md) 将新读取的代际确认与正文替换分开，保留既有脏正文，阻止迟到同版本旧资源错误误阻塞。最终来源与统一代码两轴、统一完整 SDK 37/37、实际构建浏览器 55 项／组及构建／语法检查通过，当前范围见 [实施总记录](docs/development-verification.md)。旧页保留其提交时点，不与当前原生结果混称。

原生恢复核对两固定页、一临时页、当前页、各页纵横阅读位置与脏正文，副本成功回执和源文件字节未变分别确认。编辑器未主动聚焦；正常打开按钮与审批后 Main 为 BODY，不能声明主输入框持续 active。临时 user-scope wrapper 不是正式缓存安装；完整首版与用户验收尚未通过，远端票未改。当前整合结论见 [实施总记录](docs/development-verification.md)。

资源 URI 只指向首次受审工具已经登记的文件，不解析成新文件路径。资源请求没有 ZCode 对话 meta，归属来自首次登记；不能声称服务端逐次验证资源读者的 SID。资源为当前进程的只读快照，退订或服务关闭后登记失效，重建必须经工具重新打开。保存与模式写入继续走原受审工具。

## 本地开发

要求 Node.js 24。只在本插件目录安装依赖；安装后通过公共入口建立包链接，不能假设正式插件缓存互为同级目录：

```powershell
npm ci --ignore-scripts
node ../suian-zcode-common/link.mjs --plugin-root . --runtime-root ../.scratch/common-runtime
npm run build
npm test
npm run check
```

上面的相邻源码路径只用于源码开发时调用公共链接入口。正式独立缓存使用 common 自身的稳定 `link.mjs` 入口，以插件根和公共运行时位置为参数；本插件运行代码始终按 Node 包名导入 common。

浏览器烟测使用开发环境提供的 Playwright。可把 `SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE` 设为该环境的 `playwright/package.json` 绝对路径，再运行 `npm run test:browser`。测试运行服务端实际返回的构建 HTML 与 SDK 服务，但宿主 meta 是夹具注入，不能替代 Native 验证。

状态数据库为宿主默认注入的 `ZCODE_PLUGIN_DATA` 目录下的 `editor-state.sqlite`。源码直跑时必须显式提供自己的外置测试数据目录；缺失或无效目录不回退到工作区、插件缓存或 common。schema 2 在写事务内迁移 schema 1，保留已有全局默认和会话模式，并按可信工作区／会话隔离恢复副本。设置、副本与源文件各自显示回执，互不冒充。Node 24 内置 SQLite，无新增 ORM 或运行依赖。

UI 源文件是 `ui/editor-template.html`、`ui/editor.css` 与 `ui/editor.mjs`。`npm run build` 生成自包含的 `ui/dist/editor.html` 和第三方许可；本次 bundle 的完整版权与许可文本同时嵌入返回 HTML，并保留独立许可文件。生成内容随插件提交，不直接手改，也不从 CDN 加载编辑器。

## 证据与限制

实现范围与首次轨迹见 [SE-01 验证记录](docs/se01-verification.md)，实际首开、关闭重开及两个工作区的结果见 [Native 续验](docs/se01-native-verification.md)。脱敏日志摘要见 [JSON 证据](docs/se01-evidence.json)。规格与原子票见 [首版规格](docs/text-editor-spec.md) 和 [SE-01](docs/issues/01-sidebar-context-and-read.md)。

目录、保存与页面结果见 [SE-03 验证记录](docs/se03-verification.md) 和 [JSON 证据](docs/se03-evidence.json)：SDK／stdio／Windows ACL 19/19，浏览器 12 组行为、构建与语法检查通过。混合换行转换后的连续保存和 LF 粘贴 CRLF 文件的两项 P2 已修复并通过双轴复核。[Native 烟测](docs/se03-native-verification.md) 的 11 次请求为 10 次成功与 1 次预期版本冲突，按钮和 Ctrl+S 均核对磁盘字节；人工批准工具不代表用户产品验收。

SE-04 的首次本地验证为 SDK／SQLite／stdio 25/25、浏览器 20 组通过；[时序修复](docs/se04-review-fix-verification.md) 再新增 6 项契约。后续订阅修正的最终固定结果为 SDK 33/33、浏览器 42 项／组。本轮 [Native 证据](docs/se04-watch-native-evidence.json) 将 ID0 初始化与随后 42 个请求分开：21 个工具为 18 成功及 3 个预期错误，资源请求均取得 ACK；21 次实际授权均为单次允许，模型增量 0。旧模式多会话链、精确时钟与本轮实际字节分层复用，不代表完整首版或用户验收通过。

读取与保存使用常规 `realpath`、文件句柄和字节版本。保存前核对内容并在本服务接收入口顺序处理，不提供跨任意外部编辑器的原子比较写入或工作区目录被并发替换时的原子路径隔离保证。
