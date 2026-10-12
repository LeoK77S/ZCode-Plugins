# suian-side-editor

独立侧栏文本编辑器的**本地开发切片**。目录树、临时／固定页签和版本检查手动保存已通过 SDK 与真实构建浏览器验证；[SE-03](docs/se03-verification.md) 的 Native 保存烟测与独立复核仍待进行。SE-01 的 H1/H2 已经人工原生审批实测及两轴复核通过。本插件暂不加入市场清单，GitHub [#43](https://github.com/ONEGAYI/ZCode-Plugins/issues/43) 尚未完成。

## 当前可验证的行为

- 独立原生入口为 `editor`，仅在具有会话身份的宿主上下文提供。
- `.mcp.json` 将宿主 `ZCODE_PROJECT_DIR` 明确绑定到 `cwd` 和专属环境变量 `SUIAN_SIDE_EDITOR_WORKSPACE`。服务端不以 `process.cwd()` 推断归属。
- `get_editor_context` 只读取宿主请求 meta 的 `session_id`；目录、读取与保存工具只接收工作区相对路径。四个工具仅对满足公共 MCP Apps 能力门槛的客户端注册，visibility 均为 `app`。
- 缺失或冲突的归属会阻止文件访问。绝对路径、穿越、Windows 备用数据流及指向工作区外的链接被拒绝。
- 读取返回规范路径、正文、UTF-8/BOM/换行特征和实际读取字节的 SHA-256 版本。非法 UTF-8、二进制控制字节、目录、缺失文件和权限失败明确报错。

- 顶部文件夹按钮开关右目录树，node_modules、隐藏文件与无扩展名文件可浏览。主区域按右树之外的剩余宽度居中。
- 单击复用一个斜体临时页；双击或首次编辑固定为正体。已打开文件只激活，保存后保持固定。
- 保存按钮和 Ctrl+S 写回当前正文；磁盘版本不符则拒绝。保存等待期间新增编辑仍未保存，失败保留正文。关闭脏页提供保存并关闭／放弃修改／取消。

保存模式、自动保存、外部修改同步、面板回收／重启恢复和评论由后续票实施。当前未保存正文与内部页签仅存在于页面内存，不能将本切片当作完整首版使用。

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

UI 源文件是 `ui/editor-template.html`、`ui/editor.css` 与 `ui/editor.mjs`。`npm run build` 生成自包含的 `ui/dist/editor.html` 和第三方许可，生成文件随插件提交，不直接手改，也不从 CDN 加载编辑器。

## 证据与限制

实现范围与首次轨迹见 [SE-01 验证记录](docs/se01-verification.md)，实际首开、关闭重开及两个工作区的结果见 [Native 续验](docs/se01-native-verification.md)。脱敏日志摘要见 [JSON 证据](docs/se01-evidence.json)。规格与原子票见 [首版规格](docs/text-editor-spec.md) 和 [SE-01](docs/issues/01-sidebar-context-and-read.md)。

目录、保存与页面结果见 [SE-03 验证记录](docs/se03-verification.md) 和 [JSON 证据](docs/se03-evidence.json)：SDK／stdio／Windows ACL 19/19，浏览器 10 组行为、构建与语法检查通过。Native 保存烟测和用户验收仍未发生。

读取与保存使用常规 `realpath`、文件句柄和字节版本。保存前核对内容并在本服务接收入口顺序处理，不提供跨任意外部编辑器的原子比较写入或工作区目录被并发替换时的原子路径隔离保证。
