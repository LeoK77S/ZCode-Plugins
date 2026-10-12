# suian-side-editor

独立侧栏文本编辑器的**只读开发切片**。已实现 SE-01 的本地资源、app-only MCP 工具、可信归属拒绝和文本读取；真实 Desktop 的 H1/H2 门槛尚未完成，[#41](https://github.com/ONEGAYI/ZCode-Plugins/issues/41) 保持未完成。本插件暂不加入市场清单。

## 当前可验证的行为

- 独立原生入口为 `editor`，仅在具有会话身份的宿主上下文提供。
- `.mcp.json` 将宿主 `ZCODE_PROJECT_DIR` 明确绑定到 `cwd` 和专属环境变量 `SUIAN_SIDE_EDITOR_WORKSPACE`。服务端不以 `process.cwd()` 推断归属。
- `get_editor_context` 只读取宿主请求 meta 的 `session_id`；`read_editor_text` 只接收工作区相对文件路径。两者仅对满足公共 MCP Apps 能力门槛的客户端注册，visibility 均为 `app`。
- 缺失或冲突的归属会阻止文件访问。绝对路径、穿越、Windows 备用数据流及指向工作区外的链接被拒绝。
- 读取返回规范路径、正文、UTF-8/BOM/换行特征和实际读取字节的 SHA-256 版本。非法 UTF-8、二进制控制字节、目录、缺失文件和权限失败明确报错。

页面只提供相对路径输入和只读正文，不包含目录树、页签状态、编辑、保存或评论。正文按文本显示，读取失败清除旧正文。

## 本地开发

要求 Node.js 24。只在本插件目录安装依赖；安装后通过公共入口建立包链接，不能假设正式插件缓存互为同级目录：

```powershell
npm ci --ignore-scripts
node ../suian-zcode-common/link.mjs --plugin-root . --runtime-root ../.scratch/common-runtime
npm test
npm run check
```

上面的相邻源码路径只用于源码开发时调用公共链接入口。正式独立缓存使用 common 自身的稳定 `link.mjs` 入口，以插件根和公共运行时位置为参数；本插件运行代码始终按 Node 包名导入 common。

浏览器烟测使用开发环境提供的 Playwright。可把 `SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE` 设为该环境的 `playwright/package.json` 绝对路径，再运行 `npm run test:browser`。烟测运行正式返回的 HTML 与真实 SDK 服务，但宿主 meta 是夹具注入，不能替代 H2。

## 证据与限制

实现范围及未完成条件见 [SE-01 验证记录](docs/se01-verification.md)，脱敏日志摘要见 [JSON 证据](docs/se01-evidence.json)。规格与原子票见 [首版规格](docs/text-editor-spec.md) 和 [SE-01](docs/issues/01-sidebar-context-and-read.md)。

读取使用常规 `realpath`、文件句柄和字节读取，版本描述实际读取到的内容；不宣称跨任意外部编辑器的原子文件快照，也不宣称工作区目录被并发替换时具有原子路径隔离保证。
