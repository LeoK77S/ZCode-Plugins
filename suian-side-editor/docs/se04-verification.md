# SE-04 本地实施与验证

2026-10-13。基线 `2e5e1d08aabf994871129d1285e6ec411a13069a`，在 SE-04 专用工作树和 `codex/side-editor-se04` 实施。只改变本插件，common／app-mcp／sources 没有修改；未推送、建 PR、关闭票或操作 Native。

**当前结论**：模式持久化、自动触发和外部修改处理通过本地契约。独立两轴、本票 Native 及用户验收尚待执行，不能用这些结果解除完整首版的 H3／H4 门槛。

## 最小接口与数据所有权

`createMcpServer` 从启动环境 `ZCODE_PLUGIN_DATA` 取得外置 dataPath；`editor-settings.mjs` 使用该目录下的 `editor-state.sqlite`。缺失、相对路径或未展开模板明确失败，不回退至工作区、插件缓存或 common。Host 默认注入已由固定官方源码与 CLI 静态核对，本票尚未运行 Native 捕获。

| 工具 | 严格请求 | 回执与边界 |
| --- | --- | --- |
| get_editor_settings | `{}` | `{saveMode:"manual"或"auto"}`；首次会话在事务内继承全局默认并形成自己的记录 |
| update_editor_settings | `{saveMode:"manual"或"auto"}` | 同一事务更新当前会话与全局默认；不修改已有其他会话 |

二者为 app-only；工作区与会话来自已有可信绑定，不接受页面指定身份。读取模式也可能初始化记录，故没有标为 readOnly。schema 1 仅有 `editor_defaults` 与 `session_settings`，键由可信工作区身份和会话 ID 组成；正文、页签与重启恢复属于 SE-05。

每次操作建立并关闭 Node 24 SQLite 连接，使用 2000 ms busy timeout、FULL 同步及 BEGIN IMMEDIATE。schema 判定、初始化和模式变化都在事务内，失败回滚；未知版本或损坏明确报错，不清空数据。不主动切换 journal_mode，新的数据库使用 SQLite 默认回滚日志。事务回执与源文件保存回执分开。

## 页面与外部检测

模式按钮等待持久化回执后更新显示。手动模式默认不安排自动写回；自动模式在停止输入 800 ms、切换内部页签及切入自动模式时调用已有版本检查保存入口。切手动取消尚未开始的任务，已在途的回执保留期间新增正文；在途之后仍需自动保存的新正文继续调度。

`checkFiles` 只遍历当前页面的打开文件，逐个调用已有 `read_editor_text`，跳过保存中、重新读取中及已阻塞文件。一轮完成后 1000 ms 再启动下一轮，不堆积重叠轮次。依据实际内容版本，包含普通写入、替换与删除；没有 mtime 假设、私有宿主通知或新公共监听框架。Host 授权等待会相应延长轮次，不能把 SDK 夹具响应速度当作 Native 授权保证。

干净文件变化刷新正文与基线，CodeMirror 测量后在新文档上恢复有效滚动位置。脏正文或读取／写入失败保留正文并暂停该文件自动保存；保留编辑维持冲突，重新读取先显示放弃编辑的确认。读取等待期间有新输入也不能被刷新覆盖。设置错误独立显示，不被当前文件错误遮住。

## 红灯与修复轨迹

- `settings-red.log`：旧服务缺少模式工具，五组契约失败；首次命令收尾未退出，由工具 Ctrl+C 中断，退出码 1 单列记录，未当作完整测试汇总。初次绿灯仍有 stdio 夹具收尾失败。夹具改为 finally 清理客户端并消费 stderr 后，五组完整退出 0；不将未定位的夹具收尾归因为产品 SQLite 错误。
- `browser-mode-red.log`：真实返回的旧构建缺少模式按钮。后续首次断言还揭示夹具需要等待模式读取回执；修正为等待“手动保存”，再暂停浏览器时钟。
- `browser-mode-green-2.log`：自动触发与保存并发通过，但干净刷新滚动位置红灯。改为 CodeMirror 测量后，在同一新文档使用公开 scrollSnapshot；随后该项通过。
- `browser-mode-green-3.log`：文件删除与模式写入失败同时发生时，模式错误不可见。独立设置错误提示修复后通过。
- `settings-cold-1.log`／`settings-corrupt-red.log`：同时首次初始化有间歇失败；损坏数据库文案也补充了具体预期。先将 schema 判定移入事务仍有冷初始化红灯，保留一次通过与随后失败，不把一次绿当成收敛。
- `settings-cold-diagnostic-3.log`：临时 stderr 诊断确认失败发生在 journal-mode，SQLite errcode 5。删除并发 WAL 切换，保留默认回滚日志与事务，未添加重试框架；诊断代码已经移除。最终五轮、每轮八个真实 stdio 进程首次初始化全部通过。损坏数据库返回明确错误且原字节不变。

SQLite 的 journal-mode 与 busy timeout 语义核对了 [SQLite PRAGMA 原文](https://www.sqlite.org/pragma.html#pragma_journal_mode)、[Node 24.15 SQLite 文档](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html)；具体失败归属来自上面的真实进程日志。计时控制采用 [Playwright Clock 公开接口](https://playwright.dev/docs/api/class-clock)，没有长时间 sleep 或内部函数镜像测试。

## 最终本地验证

Node 24.15.0。SDK／SQLite／stdio 25/25，包括既有 19 项文件边界和 6 项模式契约；实际构建浏览器原有 12 组与新增 8 组通过，构建与语法检查通过。所有文件、数据库和 ACL 夹具均为自有临时目录，Host meta 为明确夹具，页面网络请求与异常为零。未调用模型、真实用户工作区或 Native。

新增浏览器覆盖：多脏页切自动、799／800 ms 边界、切手动取消、内部切页、保存在途新输入及切手动、干净文件替换与有效滚动、脏冲突和确认重新读取、外部读取在途新输入、真实 Windows 文件 ACL 拒写及手动恢复、删除与设置失败。数据库覆盖 A／B／C／重开、工作区隔离、真实 SQL 触发器事务回滚、可信归属、数据根错误、未知 schema／损坏、不同真实进程读取最新默认及五轮八进程冷初始化。

最终日志位于本插件忽略目录 `.scratch/se04/`：`sdk-final.log`／`.exit`、`browser-final.log`／`.exit`、`check-final.log`／`.exit`；构建记录 `build-3.log`／`.exit`，模式独立记录 `settings-final.log`／`.exit`。详细脱敏索引见 [JSON 证据](se04-evidence.json)。common／app-mcp 不变，未重跑其回归。

返回 HTML 工作树构建字节为 316738，SHA-256 `efd941b04d40269d2cae1faf9412fff139ccfd391e27d4396e1fdd5087f139a5`。Git 的行尾转换可能改变检出字节；整合及 Native 必须重新固定实际返回资源，不能把工作树构建哈希当成其他检出目录的字节声明。第三方许可完整嵌入 HTML，构建输入与许可范围未扩展。

## Native 交接，尚未执行

由原生负责人在固定提交、产物和正常持久 Core 测试任务上串行验证，使用公开 callTool 与人类审批。不能复用空任务项目更新跳过作为免审证据，也不能改私有权限或增加绕过代理。

1. 记录实际 `ZCODE_PLUGIN_DATA` 与模式数据库位置，首开读取默认及关闭重开模式；记录两个新工具的原生授权。
2. A 切自动、已有 B 不变、新 C 继承，A 重开恢复。源码／数据库契约不能替代这项 Native 结果。
3. 用已有测试文本核对三种自动触发、切手动取消和保存期间新输入；人类选择公开的项目授权范围，保存路径规则需分别核实。
4. 外部修改打开文件：干净自动刷新、脏正文保留与暂停自动、保留不覆盖、取消／确认重新读取；核对磁盘字节和真实页面。
5. 删除／权限／模式持久化失败核实原因与正文保留；源文件和设置回执不可混称。模式通过也不表示 SE-05 正文恢复通过。

页面入口：`#save-mode`（aria-label 保存方式），冲突 `#conflict-bar`／`#keep-edit`／`#reload-file`；确认 `#reload-dialog`（重新读取文件）、`#reload-cancel`（取消重新读取）、`#reload-confirm`（放弃编辑并重新读取）。
