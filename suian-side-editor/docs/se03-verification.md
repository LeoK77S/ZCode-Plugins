# SE-03 · 目录、页签与手动保存验证

2026-10-12，审查与 Native 追加更新至 2026-10-13。状态：本地实现、整合验证和独立两轴复核通过；本票原生侧栏目录、读取、编辑与手动保存烟测已通过，记录见 [Native 验证](se03-native-verification.md) 与 [Native JSON](se03-native-evidence.json)。未关闭 GitHub Issue，**不能据此将完整首版或用户产品验收标为完成**。

本票基于 `b895823f615ebeaa68d08f3d74115df3ca4c19e2`，在独立 `codex/side-editor-se03` 工作树实施。沿用 SE-01 已通过的 H1/H2 和公共包入口。初次代码与浏览器验证不操作已运行的 Desktop；后续 Native 烟测只使用既有隔离实例与合成工作区，不操作用户工作区或研究快照。

## 交付与边界

`list_editor_directory` 按需返回一层目录，保留 node_modules、隐藏文件及无扩展名文件。内部目录链接可以展开；外部或不可访问的链接仍显示为禁用条目。`save_editor_text` 只写回已有普通 UTF-8 文件，请求必须带实际内容的 SHA-256 基线。

保存请求在 MCP 接收入口顺序处理，工作区真实路径与宿主 session meta 继续逐次核实。重新读取的字节版本不符即拒绝；文件权限失败、非法 UTF-8 和有损 Unicode 输入明确报错。未修改保存直接返回原内容，不重写 BOM 或换行字节。

UI 使用本地 CodeMirror 6，提供右侧目录树、内部单临时／多固定页签、行号正文、保存按钮和 Ctrl+S。首次编辑或双击固定页；保存后仍固定。保存等待期间的新增编辑保持未保存。脏页关闭提供保存并关闭、放弃修改和取消；失败保留文件页，取消关闭后晚到的保存回执也不重新关页。

本票没有自动保存、会话设置、外部修改轮询、跨重启恢复或评论接入。状态栏显示中文原因，结构化工具响应保留错误码。

## 工程与构建

Node 24.15.0、npm 11.6.4。查询 npm 官方包元数据后，精确锁定 `@codemirror/state` 6.7.6、`@codemirror/view` 6.43.14、`@codemirror/commands` 6.11.1 与 esbuild 0.28.2，传递依赖由锁文件固定。

`ui/editor-template.html`、`ui/editor.css`、`ui/editor.mjs` 是源文件；`build-ui.mjs` 是唯一构建入口。宿主资源返回 `ui/dist/editor.html`，JS 与 CSS 自包含，不请求 CDN；本次 bundle 的第三方版权和许可证完整嵌入返回 HTML 的 head 注释，并保留 `ui/dist/THIRD-PARTY-LICENSES.txt`。生成内容不手工修改。

CodeMirror 的 `lineSeparator` 与 `sliceDoc()` 保持统一 CRLF／LF／CR。混合换行由 CodeMirror 正确分行，UI 将实际编辑范围映射回原正文，保留未触及的分隔符；新插入的换行沿用该文件首个分隔符。未修改保存保持全部字节，验证覆盖 BOM、中文、混合分隔符正文追加。

## 红绿证据

首次运行日志与退出码保存在忽略目录 `.scratch/se03/`。以下红灯均有具体断言或可观察缺失，修复后通过；完整清单与摘要见 [JSON 证据](se03-evidence.json)。

| 契约 | 首次失败 | 修复与通过证据 |
| --- | --- | --- |
| 按层目录工具 | `tree-red`：工具尚不存在 | `tree-green`，node_modules／隐藏文本可见 |
| 版本检查保存工具 | `save-red`：工具尚不存在 | `save-green`，BOM／CRLF／中文写回与新基线 |
| 同文件两次旧基线请求 | `save-contracts`：异步路径解析颠倒接收顺序 | `save-order-green`，接收入口串行；第一份成功、第二份冲突 |
| 临时／固定页签 | `browser-tabs-red`：双击未固定 | `browser-tabs-green`，临时替换、已打开页不重复读取 |
| 编辑与手动保存 | `browser-save-red`：正文尚为只读 | `browser-save-green-fixed`，编辑固定与按钮／Ctrl+S |
| 脏页关闭 | `browser-close-red`：关闭入口缺失 | `browser-close-green`，三种结果 |
| 取消关闭时晚到回执 | `browser-close-cancel-red`：访问被清除的对话框状态 | `browser-close-cancel-green`，取消保留文件页、无页面异常 |
| 混合换行分行 | `browser-mixed-lines-red`：CR 行号不正确 | `browser-mixed-green`，正确四行与原分隔符保持 |
| 深色行号栏 | `browser-theme-red`：行号栏仍为浅色 | `browser-theme-green`，计算背景颜色与主体一致 |
| 工具栏焦点 Ctrl+S | `browser-shortcut-red`：未调用保存 | `browser-shortcut-green`，保存当前正文 |
| 非目录与链接边界 | `tree-boundary-red`、`tree-links-red` | 对应 `green`，拒绝非目录／越界、内部目录链接可展开 |
| 有损 Unicode 输入 | `save-unicode-red`：孤立代理字符被编码替换 | `save-unicode-green`，拒绝有损写回、原文保留 |
| 产品错误文案 | `browser-copy-red`：展示接口错误码 | `browser-copy-green`，中文原因与结构化 code 分离 |

初次本地构建的 IIFE 顶层 await 错误、模板替换对 `$&` 的解释错误，以及诊断日志也保留；它们是构建问题，未当作产品契约红灯或最终通过结果。

## 最终结果

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 本地 UI 构建 | 退出码 0；HTML 312054 字节，11 个依赖许可 | `review-final-build.log` |
| SDK／真实 stdio／临时文件／Windows ACL | **19/19**，退出码 0 | `review-final-sdk.log` |
| 真实构建 HTML 与 SDK 浏览器 | 12 组行为摘要通过，退出码 0；零网络请求、零页面异常 | `review-complete-browser-green.log` |
| JS 语法 | 退出码 0 | `review-complete-check-green.log` |
| diff 格式 | 退出码 0 | `review-complete-diff-green.log` |

浏览器还验证了目录展开才读取子层、node_modules 内文件可读、内部页签双击、保存期间继续输入、失败不关页、页面不自填会话／工作区、缺失可信 meta 禁止文件操作。

## 2026-10-13 审查追加修复

**两项 P2 均已在真实构建页复现、修复并通过独立双轴复核**。复核固定范围为 `654a2fd…b1c2a22`，没有为审查重跑测试或操作 Native。

- 规范轴：`a\nb\r\nc` 删除首个 LF 后保存为统一 CRLF，继续 Enter 时 UI 仍按旧混合换行序列化。第二次请求是 `ab\r\nc\n`，服务端成功转 CRLF 后 UI 残留 dirty，保存并关闭失败。`review-newline-red` 与 `review-newline-payload-red` 退出码均为 1。保存回执现在更新混合标记、插入约定与 CodeMirror 的 lineSeparator Compartment，只转换当前正文的分隔符，不用旧响应覆盖新增正文，也不重建编辑状态。
- 规格轴：CRLF/BOM 文件标准粘贴 `一\n二`，实际只有一个 CM 行。`review-paste-red` 退出码为 1。公开 clipboardInputFilter 按当前 state.lineBreak 归一化入站文本；ClipboardEvent/DataTransfer 回归验证正确两行、原 BOM/CRLF 保存并关闭，以及正常 undo/redo 内容和映射选区。没有读写用户 OS 剪贴板。

新增用例同时覆盖保存等待期间输入新正文、切换文件页再回到原文件、继续编辑、成功保存并关闭。先前的晚到回执、取消关闭、冲突及其他契约仍通过。重跑范围仅为本插件的构建／SDK／浏览器／语法，未跑未受影响的 common 或 app 回归。

追加测试中的两个额外位置假设曾失败：DOM focus 不保证恢复光标，CodeMirror redo 本来会恢复映射后的原选区。分别改为明确键盘定位，以及按精确包源码核实的默认 redo 选区；未为错误的测试假设修改产品行为。相关失败日志保留，没有算作上述两项产品缺陷的红灯。

许可内容核对先确认原 HTML 没有完整 MIT、独立许可文件已有完整文本。现同一构建文本随资源嵌入；`review-license-after.log` 内容检查通过，未增加产品流程或通用许可框架。

统一分支通过 `34aad51` 集成初切片、`ea0374c` 集成修复，最终整合记录为 `5052bc6`。整合首次 SDK 19/19、浏览器 12 组、构建、语法、diff 和文档检查均通过；common／app 未变化，复用既有 95/109 证据。生成 HTML 的初次逐字节核对因 Git 换行归一化失败，修正为归一化内容比较后通过；原始失败日志保留，没有为补看信息重跑套件。根导航 P3 在固定 `5052bc6` 的只读规范复核中关闭。

## 视觉核对与待验项

已亲自核对真实构建的宽栏和 480 px 窄栏：圆角内部页签、面包屑、等宽行号正文与独立滚动右树符合用户参考方向，主体按目录树之外的剩余宽度居中；展开／收起时有尺寸断言，窄栏没有页面水平溢出。

另用自有临时 `.gitignore` 保存正常内容的预览图，未展示安全测试注入文字或故意冲突作为外观交付图。字体计算值证明只有临时页签标题为 italic，面包屑、树根和目录文字为 normal。这是浏览器构建图，不是 Native 截图或用户验收。

原生烟测由单一负责人串行执行，实际产物固定 `b1c2a22`：11 次 UI 工具请求得到 10 次成功和 1 次预期版本冲突，原生审批有 11 条 allow 回执，本轮模型请求 0。按钮保存保留 BOM/CRLF，Ctrl+S 仅一次调用且 LF 字节正确；冲突保留外部磁盘内容与 UI 未保存正文。临时替换、双击／首次编辑固定、node_modules 按需展开、树显隐与完整 Native guest 像素另有 [限定证据与失败边界](se03-native-verification.md)。SE-01 只读烟测没有被用来代替本票保存验证。

版本检查仍是普通文件句柄的读后写；不提供跨任意外部编辑器的原子比较写入，也不保证并发替换工作区目录时的原子路径隔离。写入出错保留 UI 编辑，不能承诺发生磁盘写入中断时原文件一定完整不变。
