# 握手与隔离读取

先在当前 ZCode 会话运行 `/mcp list` 查看实际服务。原生插件声明的名称还可从 `zcode plugins list --json` 中本插件的 mcpServerNames 取得，通常为 `plugin:suian-zcode-app-mcp:suian-zcode-app`。插件清单中的声明不证明当前会话已经加载了该服务。

## 原生缓存中的独立握手

使用 paths.md 已确定的插件根与外置配置，初始化完成后执行。以下 SDK 客户端只做 initialize 和 tools/list，不读取数据库、不连接网关，也不证明当前 ZCode 会话的 MCP 已换代。

```powershell
Push-Location "{{plugin_root}}"
try {
    @'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const [entry, configPath] = process.argv.slice(2);
const client = new Client({ name: 'suian-mcp-debug', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath, args: [entry, '--config', configPath], stderr: 'pipe'
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(JSON.stringify({ toolCount: tools.length, names: tools.map(tool => tool.name) }));
} finally {
  await client.close();
}
'@ | node --input-type=module - "{{plugin_root}}/cli.mjs" "{{config_path}}"
} finally {
    Pop-Location
}
```

预期 toolCount 为 19，包含 list_sessions、read_session、get_current_session、get_artifacts 和 set_artifacts。失败时保留错误；不以重新注册全局 MCP 作为修复。该调试客户端没有声明 MCP Apps，工件工具没有 UI 元数据属于正常降级。

原生侧栏失败先区分三层：版本/能力未满足时资源不提供；宿主尚未为目标会话取得 MCP 连接时，在页面装载前可能报告 connection unavailable；页面 get 的 caller 或 SQLite 错误会显示读取失败。当前会话 MCP 连接就绪后使用“重新加载”或页面“刷新”，不要通过启动模型轮掩盖问题。3.15.1.8093 的 initialize 实测仍报告 CLI 0.16.9，实际应用版本来自 Desktop 传入的 ZCODE_APP_VERSION。详细证据见 ../../docs/artifact-demo-verification.md。

## 源码工作树中的隔离读取

这一步使用仓库的测试夹具，要求源码工作树同时包含 common 与 MCP，且已按 setup 准备依赖及链接。测试仍有同级源码引用，不能直接在原生的独立缓存目录运行。

在源码 MCP 根执行：

```powershell
node --test tests/stdio.test.mjs > stdio-check.log 2>&1
$stdioCheckExit = $LASTEXITCODE
Add-Content -LiteralPath stdio-check.log -Value "EXIT=$stdioCheckExit"
```

tests/fixtures.mjs 自动在临时目录创建双库并清理，无需复制用户数据库。测试覆盖握手、分页、历史、错误反馈与读取前后数据库摘要；后续复核从 stdio-check.log 读取。仅保留脱敏结果。

没有源码工作树时，先报告独立握手结果和隔离读取未执行。当前会话的读取验收可通过客户端工具，对用户指定目标调用 list_sessions/read_session；不把它记作隔离测试。
