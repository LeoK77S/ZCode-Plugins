# SE-01 只读切片与宿主验证

2026-10-12。本记录区分公开服务端契约、浏览器夹具和实际 Desktop 轨迹。**H1/H2 尚未通过，SE-01 / #41 未完成**，没有关闭 Issue、推送、PR 或市场发布。

## 已实现的切片

原生 `editor` surface 指向插件本地 `ui/editor.html`，stdio 入口为 `cli.mjs`。仅提供 `get_editor_context` 和 `read_editor_text` 两个 app-only 工具，页面不填写身份、不发送聊天。

工作区来自 `.mcp.json` 绑定的宿主 `ZCODE_PROJECT_DIR`，服务端只读取专属 `SUIAN_SIDE_EDITOR_WORKSPACE`。会话来自 SDK handler 的 `extra._meta.session_id` 或已核实的嵌套宿主请求上下文；两处冲突时拒绝。工作区身份为规范路径的 SHA-256；Windows 大小写不区分。

读取拒绝绝对路径、路径穿越、备用数据流和工作区外链接。正文使用 fatal UTF-8 解码；BOM 独立记录，换行记录为 LF/CRLF/CR/混合/无换行。NUL 及不属于制表或换行的 C0/DEL 控制字符作为二进制特征拒绝。该判断不声称能识别所有可能的二进制格式。

内容版本是**实际读取字节的 SHA-256**，包含 BOM 和换行字节。读取不是跨外部编辑器的原子快照；常规路径检查也不具有抵御目录在检查与打开之间被替换的原子保证。本票没有写回接口。

## 自动化证据

Node.js `24.15.0`，MCP SDK `1.32.1`，Zod `4.6.5`。新插件只在自身包目录安装依赖。公共模块以包名导入 `suian-zcode-common/ui-capabilities.mjs`，通过 common 的 `link.mjs` 连接到隔离运行时，没有复制公共实现。

原生入口、可信上下文、文本读取、路径边界、文件错误和 UI 资源分别先观察契约红灯，再完成最小实现。首次输出保存在忽略目录 `.scratch` 并记录退出码。完整公开测试最终 **10/10、零失败、零跳过**；语法检查退出码 0。

公开测试包括：

- 缺失、非法或冲突的会话 meta；页面伪造身份被输入 schema 拒绝；trace/cwd 不作为身份兜底。
- 两个真实 stdio 进程使用不同专属工作区 env，在同一个 cwd 启动仍读取各自文件；同工作区不同会话保留独立身份。
- 中文、BOM、CRLF、内容版本变化、越界路径、真实外部 junction、非法 UTF-8、二进制控制字节、目录和文件不存在。
- Windows 临时文件真实 ACL 拒绝，回执为 `permission_denied`，测试结束恢复原 ACL。
- 客户端、版本与 MIME 不满足公共门槛时不提供文件工具或 UI 资源；满足门槛时两工具 visibility 都为 `app`。

浏览器烟测使用开发环境提供的 Playwright `1.62.1`，运行正式 MCP 资源返回的 HTML，并调用真实 SDK 服务。确认 HTML 选文按文本显示、错误清除旧正文、缺失归属禁用读取、深色主题属性和窄视口，无网络请求或页面异常。**宿主 meta 为夹具注入**，这不是 H2 或原生视觉验收。

早期 stdio 测试把目录清理置于子进程关闭之前，出现测试失败与未退出；该轮已中断，原日志没有完整失败诊断。改为逐连接 finally 关闭客户端、再清理夹具后，独立 stdio 和完整回归通过。它不是生产宿主能力失败。

## 实际 Desktop 对象与隔离

| 对象 | 实际核实结果 |
| --- | --- |
| EXE | ProductVersion / FileVersion `3.15.1.8093` |
| ASAR | 包版本 `3.15.1`，正式 main 为 `out/main/index.js` |
| CLI | 原封不动 `resources/glm/zcode.cjs`，Electron Node 模式 `--version` 为 `0.16.9` |
| 插件安装方式 | 当前单票工作树通过 `plugins.dirs` 的 inline 原生加载，不是市场缓存安装 |
| 实际插件入口 | `{{SE01_WORKTREE}}/suian-side-editor/cli.mjs` 与 `ui/editor.html` |
| 实际 Desktop 启动目录 | `{{ISOLATED_ROOT}}/workspace-a` |
| 隔离范围 | 独立 home、Electron userData/sessionData、配置、工作区、storage、插件数据和临时目录 |

子进程使用白名单环境，明确设置 `ZCODE_DESKTOP_HOME_DIR/USER_DATA_DIR/SESSION_DATA_DIR/APPLICATION_NAME`、HOME/USERPROFILE/APPDATA/LOCALAPPDATA、TEMP/TMP 和 ZCode 数据路径。只使用安装包公开内置 Provider 配置及自建 localhost Provider/占位 key。没有读取、复制用户账号、凭据、配置或活动会话；没有修改安装包、sources 或真实用户插件设置。

实际运行路径的替换值、PID 与原始日志仅保存在工作树的忽略目录；入库记录不包含会话 ID、Profile 身份或个人绝对路径。安装产物 SHA-256 与各轮日志摘要见 [脱敏 JSON](se01-evidence.json)。

## 三次 GUI 启动的轨迹

1. 第一次：CDP 已就绪，但探针在 renderer page 创建前取到空页面列表并结束。这是探针时序错误，未到插件页面。
2. 第二次：修正为等待真实 page 创建事件。测试 Profile 完成跳过登录与引导，并识别本地 Provider。最初使用位置参数指定工作区，实际仍在默认会话工作区；随后只读确认正式参数为 `--open-workspace`。
3. 第三次：以明确 `--open-workspace={{ISOLATED_ROOT}}/workspace-a` 启动并进入该工作区。父协调器暂停新增 GUI 启动的消息到达时该次启动已发出；此后没有新增 Desktop 启动或重启。后续仅正常刷新同一 renderer 和运行 Node 模式辅助协议进程。

原生 CLI `plugins list --json` 识别 `suian-side-editor@inline`，enabled 为 true，MCP server 声明与入口正确，diagnostics 为空。

新任务草稿没有会话身份，原生“打开标签页”仅显示审查、终端、浏览器。`availability=session` 需要会话身份，**这一现象本身不判定 H1 失败**。

## 公开空会话路径与未完成条件

为尝试到达可冷恢复的测试会话，使用同一原装 CLI 的 `app-server --stdio`、当前隔离数据和合成 Provider，调用公开 `session/create`，不发送 turn。首次夹具使用不支持的 reasoning `none`，公开错误为 `invalid_model_request`；读取安装包公开模型规则后改用合法 `disabled`。该夹具错误不记为 H1/H2 失败。

两个工作区的创建回执均包含 `messages=[]`。最后一组逐工作区观察为：

| 公开操作 | 实际结果 |
| --- | --- |
| `session/create`，`persistence=immediate` | 返回空消息的会话快照 |
| 同进程 `session/list` | 能看到当前辅助进程的会话 |
| `session/close` | 返回 `closed=true` |
| 关闭后同进程 `session/list` | 返回空集合 |
| 辅助进程退出后另起 Node 模式 `session/list` | 返回空集合 |
| 当前 Desktop 正常 renderer 刷新 | 仍无可选择的空测试任务 |

辅助进程的会话运行时与当前 Desktop 的 MCP lease 不是同一对象。没有用辅助工具调用、模型预热、固定等待或内部补丁冒充原生冷启动成功。第三次 GUI 启动以来，明确区分模型 endpoint 和辅助 HTTP 路径；模型 endpoint 请求数为 **0**。

**具名未满足条件**：需要能在无模型 turn 的情况下，建立可被实际 Desktop 原生选中并冷恢复的测试会话；随后从该 Desktop 目标会话首次打开 session surface，观察实际 MCP 连接与 SDK meta。当前公开空会话路径没有达到这个条件，不能概括为所有 Desktop 建会话入口均不可用。

H1 的首开、关闭重开和工作区切换读取没有完成；H2 的实际 UI 请求 `session_id` 与启动 env 来源没有完成。已通过的 SDK/stdio 夹具不能补作这些结果。因此 #41 保留未完成，后续文件业务继续保留宿主能力条件。

## 宿主系统注册副作用

实际包启动时自动执行 `installWindowsOpenFolderContextMenu`。只读核实其固定键是 `HKCU\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode` 和对应 Drive 键，不随测试 applicationName 改名。

当前键默认值与 MUIVerb 为“在ZCode中打开”，Icon 指向原安装 EXE，command 为原安装 EXE 加 `--open-workspace "%1"`。**没有启动前注册表快照**，不能确认旧值或把标准键认作测试新建项。保持现状，没有删除标准键或恢复未知旧值。

这项宿主启动副作用独立于插件设置和代码实现。未来真实验证再次启动 Desktop 前，应先确定公开的禁用系统注册选项或核实重复写入影响；不通过修改安装包绕过。

证据完成后通过原测试启动器停止当前 Desktop，并用 memlist 复核记录的 GUI 主进程、Utility Host 与四个辅助协议进程，六个 PID 均不存在。该结论限于已记录的隔离进程，不声称完成全系统进程清理。原始日志留在 `.scratch`，供协调者迁移与复核。
