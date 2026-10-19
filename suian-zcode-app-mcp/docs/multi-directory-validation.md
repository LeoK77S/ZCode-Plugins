# 多目录适配与隔离验证（2026-10-19）

## 行为与范围

- 侧栏编辑器在文件树顶部切换会话允许的本机目录，左上显示当前完整路径；每个目录分别保留页签、阅读位置与未保存正文。
- 切换前确认恢复副本回执；保存、重读与首次打开文件期间不切换。旧目录的迟到资源响应不覆盖新目录，同名文件分别保存。
- MCP 的 list_sessions 增加 project_id 精确筛选；get_current_session 公开本地项目和附加目录。start_session 在发起会话范围内继承项目及其余目录，显式范围覆盖默认继承。
- 目录选择只改变编辑器浏览范围。网关附着与自动命名继续使用会话执行目录；旧版单目录调用不增加项目协议字段。

公共 project-context 只读任务索引。会话 execution_directories 为字符串时优先使用其 JSON 数组，包括空数组；否则使用项目 roots。拒绝远端本机访问、错 Host、歧义归属、相对目录和已删除会话。来源为[官方项目存储契约](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/packages/services/src/project-storage/contract.ts)与[项目仓库](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/packages/services/src/project-storage/project-repository.ts)，创建参数见[官方任务服务](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/packages/services/src/session/zcodeTaskService.ts)。

## 先失败再通过的记录

原始日志保存在忽略的 .scratch/multi-root/，不提交个人路径、运行凭据或真实会话内容。

| 观察到的缺口 | 失败记录 | 修正后的覆盖 |
| --- | --- | --- |
| 编辑器没有多目录上下文和选择器 | editor-context-red.log、editor-ui-red.log | 实际 MCP 服务与构建页面的目录选择、同名文件及草稿恢复 |
| 项目筛选混入同目录其他项目，创建缺少目录继承 | mcp-projects-red.log、control-directories-red.log | 项目 ID 筛选、真实 MCP 路由和原 Host createTask 参数 |
| 相对目录可进入文件范围，未拒绝已删除会话 | project-boundary-red.log | 绝对路径、删除状态、坏 JSON、Host 归属与只读字节核对 |
| Windows 索引与启动路径的斜杠／大小写差异导致误拒绝 | path-binding-red.log | 选择参数保留索引路径，文件目标和状态身份使用真实路径 |
| 老 Host 忽略新参数，远端自省被本机目录限制误伤 | mcp-backward-red.log | 旧调用无新增字段；新参数在不支持的 Host 创建前拒绝；远端元信息仍可查询 |

首轮整合还发现，目录继承误用了带 CLI 权限解析的自省方法，破坏了已有“CLI 权限探测异常不阻断创建”契约。已将项目读取独立为仅查索引的 sessionProject；错误记录保留在 mcp-projects-green.log，修正后专项及完整回归通过。

## 回归结果

| 检查 | 结果 | 原始日志 |
| --- | --- | --- |
| common 项目／网关 RPC／独立缓存链接、MCP 全部 SDK、编辑器全部 SDK、命名后端 | 300 / 300，退出码 0 | combined-sdk.log |
| 编辑器正式 test:browser 入口、实际构建 HTML | 20 组脚本契约与 46 个 Node 测试全部通过，退出码 0 | editor-browser-regression.log |
| 实际构建与语法／diff 空白检查 | 通过，退出码 0 | ui-final-build.log、syntax.log |

浏览器新增用例覆盖：两个目录同名文件、分别保留草稿、保存期间禁用切换、旧目录资源迟到回执、关闭重开后恢复另一个目录。网关新增用例覆盖：V2 两个执行目录各自查询会话归属、错误归属拒绝、手机与插件复用一个物理 Host 桥。命名后端用例把事件 cwd 设为附加目录，确认辅助生成和改名仍使用 session.directory。

本轮使用临时 SQLite、回环协议夹具和实际构建页面；没有修改 Desktop、sources、用户真实数据库或运行配置。多目录的原生侧栏、原生审批与实体手机组合尚待宿主验收；这些夹具通过结果不代替真机结果。既有 3.16 选区评论限制保留。
