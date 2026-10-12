# SE-03 · 目录、页签与手动保存验证

2026-10-12。状态：本地实现、SDK 契约和真实构建浏览器验证通过；原生侧栏烟测与独立两轴复核等待串行安排。**不能据此将 #43 或完整首版标为完成**。

本票基于 `b895823f615ebeaa68d08f3d74115df3ca4c19e2`，在独立 `codex/side-editor-se03` 工作树实施。沿用 SE-01 已通过的 H1/H2 和公共包入口；不操作已运行的 Desktop、用户工作区或研究快照。

## 交付与边界

`list_editor_directory` 按需返回一层目录，保留 node_modules、隐藏文件及无扩展名文件。内部目录链接可以展开；外部或不可访问的链接仍显示为禁用条目。`save_editor_text` 只写回已有普通 UTF-8 文件，请求必须带实际内容的 SHA-256 基线。

保存请求在 MCP 接收入口顺序处理，工作区真实路径与宿主 session meta 继续逐次核实。重新读取的字节版本不符即拒绝；文件权限失败、非法 UTF-8 和有损 Unicode 输入明确报错。未修改保存直接返回原内容，不重写 BOM 或换行字节。

UI 使用本地 CodeMirror 6，提供右侧目录树、内部单临时／多固定页签、行号正文、保存按钮和 Ctrl+S。首次编辑或双击固定页；保存后仍固定。保存等待期间的新增编辑保持未保存。脏页关闭提供保存并关闭、放弃修改和取消；失败保留文件页，取消关闭后晚到的保存回执也不重新关页。

本票没有自动保存、会话设置、外部修改轮询、跨重启恢复或评论接入。状态栏显示中文原因，结构化工具响应保留错误码。

## 工程与构建

Node 24.15.0、npm 11.6.4。查询 npm 官方包元数据后，精确锁定 `@codemirror/state` 6.7.6、`@codemirror/view` 6.43.14、`@codemirror/commands` 6.11.1 与 esbuild 0.28.2，传递依赖由锁文件固定。

`ui/editor-template.html`、`ui/editor.css`、`ui/editor.mjs` 是源文件；`build-ui.mjs` 是唯一构建入口。宿主资源返回 `ui/dist/editor.html`，JS 与 CSS 自包含，不请求 CDN；包的第三方许可证随 `ui/dist/THIRD-PARTY-LICENSES.txt` 输出。生成内容不手工修改。

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
| 本地 UI 构建 | 退出码 0；HTML 299119 字节，11 个依赖许可 | `final-build.log` |
| SDK／真实 stdio／临时文件／Windows ACL | **19/19**，退出码 0 | `final-test.log` |
| 真实构建 HTML 与 SDK 浏览器 | 10 组行为摘要通过，退出码 0；零网络请求、零页面异常 | `final-browser.log` |
| JS 语法 | 退出码 0 | `final-check.log` |
| diff 格式 | 退出码 0 | `final-diff.log` |

浏览器还验证了目录展开才读取子层、node_modules 内文件可读、内部页签双击、保存期间继续输入、失败不关页、页面不自填会话／工作区、缺失可信 meta 禁止文件操作。

## 视觉核对与待验项

已亲自核对真实构建的宽栏和 480 px 窄栏：圆角内部页签、面包屑、等宽行号正文与独立滚动右树符合用户参考方向，主体按目录树之外的剩余宽度居中；展开／收起时有尺寸断言，窄栏没有页面水平溢出。

另用自有临时 `.gitignore` 保存正常内容的预览图，未展示安全测试注入文字或故意冲突作为外观交付图。字体计算值证明只有临时页签标题为 italic，面包屑、树根和目录文字为 normal。这是浏览器构建图，不是 Native 截图或用户验收。

原生烟测由单一负责人串行安排，须核实实际插件产物路径、读取／目录／保存的宿主审批与侧栏动作。现阶段没有原生保存成功的证据，SE-01 的只读烟测不能替代本票。

版本检查仍是普通文件句柄的读后写；不提供跨任意外部编辑器的原子比较写入，也不保证并发替换工作区目录时的原子路径隔离。写入出错保留 UI 编辑，不能承诺发生磁盘写入中断时原文件一定完整不变。
