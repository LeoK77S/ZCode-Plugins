# SE-04 重复读审批的资源订阅修复

2026-10-13，基线 `e94f1ef35bdf9eed7400a356e0ccfccef0f77bc2`。本轮仅在独立修复树执行本地契约；原生窗口、Host/controller、旧 Source、权限策略、模型端点及真实插件缓存均未操作。

**当前结论**：稳定文件不再由页面空闲循环调用读工具；公开 SDK／SQLite／stdio 31/31、实际构建浏览器 34 项／组通过。当前修复尚待独立两轴及新 Native，#44 未完成、#45 未解锁，H3/H4 与完整首版验收仍阻塞。

## 原生失败与最小红测

原生固定 Source 为 `dc718839…`，HTML SHA-256 `a54ba28d…`。根按 278 项清单冻结迁移的证据记录：ID7 首次文件读取成功；稳定文件每秒检查的 ID8–12 各获“允许一次”后仍再次弹窗，ID13 被拒后检查暂停且正文保留。六个自有测试文件未改变；这轮 Native 未通过，不能把允许过工具当产品通过。

`tests/browser-stable-file-permission.mjs` 运行服务实际返回 HTML，经公开 `window.zcode.callTool` 调用真实 InMemory MCP。首次打开成功后，不改磁盘、不追加操作，推进页面时钟 3000 ms。旧实现追加一次读取，断言 `2 !== 1`；首次完整报告约 0.65 秒，`red.log`／`.exit=1`。更换为完整公开资源桥的 `resource-bridge-idle-red.log` 仍复现同一断言。修复后读工具保持一次、订阅一次，最终日志中该项通过。

最初红测资源与 Native 哈希不同仅因 Git checkout 行尾：Native 317169 字节、62 个 CRLF 和 296 个 LF；checkout 317465 字节、358 个 CRLF。统一 CRLF 为 LF 后，完整 HTML 与内嵌脚本分别相等，规范化 SHA-256 为 `f234fdb4…` 和 `b74d336f…`。`core.autocrlf=true`、`i/lf w/crlf`、未指定 text/eol 属性及无源码 diff 支持该结论；没有路径展开注释差异，没有为补看重跑旧构建或测试。

## 公开资源通路与边界

实际 Desktop 3.15.1.8093／CLI 0.16.9 与固定源码 `aac4755666d09fdcd70272fcf063c077a639015f` 已由根只读核实完整链。页面使用既有 alias 的 `subscribeResource(uri)`、`unsubscribeResource(uri)`、`readResource(uri)`；`onResourceUpdated(listener)` 回调只接收 URI 并返回监听取消函数。[公开 alias 接口](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/desktop/src/renderer/src/plugin-sandbox/aliasApi.ts#L32)、[运行时转发](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/desktop/src/renderer/src/plugin-sandbox/aliasRuntime.ts#L217) 支持这些形状。

资源代理与工具 `authorizeAppTool` 是不同分支；资源到插件没有可信对话 meta。[请求边界](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts#L408)、[资源 adapter](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/adapters/src/mcp/index.ts#L864) 支持这个限制，不证明本轮新 Native 已经运行或所有资源操作永不需要任何授权。

- 首次成功的受审 `read_editor_text` 验证可信工作区、对话与规范文件，登记不含路径的关联 URI；失败读取不登记。
- 资源模板只按登记 URI 查表，不能把 URI 参数解析成新任意路径。刷新继续执行原有路径／文本边界检查；规范目标变成另一文件时拒绝。
- 资源只读磁盘快照，成功 JSON 仅含 `text`、`encoding`、`version`，错误含 `code`、`error`。不公开首次工具的 context，不包含本地脏编辑、恢复状态或写入回执。归属记录来自首次工具，不声称逐次验证资源读者 SID。
- 服务明确声明 `resources.subscribe` 并安装公开 handlers。只监测订阅中的登记文件，按实际字节版本比较，变化后发送 `sendResourceUpdated({uri})`。页面不轮询工具；订阅确认后读取最新快照，覆盖初次打开到订阅之间的变化。
- URI 登记仅在当前进程有效。内部关闭／临时页替换退订，连接关闭清理监听；重建经工具重新打开。宿主对同 server/URI 引用计数，最后一个订阅者才向服务退订，不能把单页关闭扩大为全部同 URI 页面关闭。
- 保存、模式与后续恢复写入仍走原可信工具，没有资源写入口。缺资源能力或订阅失败明确显示，未设置工具轮询回退或改变权限策略。Host 资源结果上限为 8 MiB，实际大文件行为仍受该边界约束。

## 时序与错误契约

新增资源 SDK 6 项覆盖可信登记／未知 URI 拒绝、独立关联释放、文件删除、真实 ACL 拒读、规范路径重新指向别的文件、订阅间隙与变化通知。已有 SDK／SQLite／stdio 25 项完整回归通过，模式库语义未改。

资源读取如果先于监测发现变化，也须通知其他有效订阅者。`resource-read-notification-red.log` 的通知为 `[]`、预期 `[uri]`；补发标准变化通知后通过。仅返回页面刷新字段的契约也先确认红灯：原 11 个字段包括 SID／工作区／能力，预期仅三个字段；缩小快照后通过，见 `resource-minimal-fields-red.log`／`-green.log`。

登记的规范目标必须在打开正文前比对。最初在读取完成后才检查目标，目录链接指向非法 UTF-8 文件时实际先报 `invalid_utf8`，预期为 `registered_path_changed`，见 `registered-path-before-read-red.log`。将已有目标比对移到 realpath 之后、open 之前后通过；首次工具读取不带这一已登记约束，继续原边界。不是只把新目标正文读出后丢弃。

页面等待保存或确认重读时先记住资源通知，操作结束后核对当前磁盘；旧在途资源回复不应用到已经变化的基线。新 7 项浏览器资源契约覆盖临时替换／关闭、公共生命周期、首次订阅间隙、旧资源读晚于成功保存、新输入仍未保存、saving 时通知，以及 reloading 时通知。

`resource-ui-red-1.log` 确认重读等待时漏掉新通知：旧 D 回执返回后未显示较新的 E。最小修复是先记录正在保存／重读期间的通知，再判断冲突暂停状态；`resource-ui-green-2.log` 7/7 通过。原有 26 项／组继续通过，稳定文件回归新增一项，共 34 项／组。

## 驱动器错误与生命周期限制

首次资源 UI 测试有两个夹具错误：临时页路径没有等工具结果，以及空态文字写错，分别保留在 `resource-ui-red-1.log`／`resource-ui-green-1.log`，修正等待与实际可见文字后通过。这些不是产品失败。

真实 `page.goto` 销毁旧上下文时，Playwright 暴露的异步绑定没有保证把该上下文的退订请求送达。该次 `0 !== 1` 原日志保留，不能据此证明或否定 Native Host dispose。最终夹具仅在公开标准 `pagehide` 事件边界验证取消监听、发退订请求及服务拒绝已释放 URI，然后再导航；它是合成生命周期事件，不是 Native 实例销毁。

**三种范围必须分开**：页面 `pagehide` 回调作尽力退订；用户内部关闭经公开桥接完成退订；实际 Host 实例销毁由宿主公共链退订。第三项仍待新 Native。旧版静态退订链见 [Host/Agent 生命周期](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/protocol.ts#L289)，不当作本轮实测。

## 构建与最终验证

首次为复用已安装依赖，在自有树使用外树 node_modules junction。esbuild 的 metafile 路径因此展开，原构建许可枚举为零；`watch-build-1.log` 保留该不完整产物记录，未交付它。仅移除自有 junction，按锁文件 `npm ci` 并通过 common/link 建立自有 runtime 入口后重构建，完整 11 个许可恢复。没有修改原 Source 的依赖或 sources 研究目录，未因这个环境问题改构建器。

最终 HTML 318324 字节，SHA-256 `067f355262a0990069bb2df20318cdead989ff8f620e5127667fedd2ae52ed5e`；独立许可 12465 字节，SHA-256 `23ce8b41…`。生成资源只由 `build-ui.mjs` 产生；没有手改生成内容。原 Native HTML 仍为 `a54ba28d…`。

| 最终命令 | 结果 |
| --- | --- |
| `npm test` | SDK／SQLite／stdio 31/31，退出 0 |
| `npm run test:browser` | 原 26 项／组 + 新 8 项，共 34 项／组，退出 0 |
| `npm run check`、本地构建 | 退出 0，11 份许可 |
| common／app-mcp | 未变化，复用既有 95/109 证据，未重跑 |

最终最小快照改动后回归以 `*-minimal-fields-final.log`／`.exit` 留证；后续把既有路径比对提前后，SDK／语法受影响复验为 `sdk-boundary-final.log` 和 `check-boundary-final.log`。UI、正常快照形状及产物未改，复用刚完成的浏览器 34 项／组。原完整回归、所有红灯、夹具失败和首次构建日志保留。截图写入独占的新目录，不覆盖旧历史。JSON 索引见 [订阅修复证据](se04-watch-fix-evidence.json)，原三项修复见 [历史记录](se04-review-fix-verification.md)。

新 Native 须核对订阅 ACK、稳定文件无额外读工具审批、实际变化 URI 通知与 JSON 快照、干净滚动保持／脏冲突、错误、会话／实例路由及最终退订。自动写工具的授权复用独立验证；读通路修复不证明写授权已解决。当前无推送、PR、合并 dev/master、关票、升版或正式安装。
