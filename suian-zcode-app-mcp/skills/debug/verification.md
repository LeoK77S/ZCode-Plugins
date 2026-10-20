# 握手与隔离读取

先在当前 ZCode 会话运行 `/mcp list` 查看实际服务。原生插件声明的名称还可从 `zcode plugins list --json` 中本插件的 mcpServerNames 取得，通常为 `plugin:suian-zcode-app-mcp:suian-zcode-app`。插件清单中的声明不证明当前会话已经加载了该服务。

## 原生缓存中的独立握手

使用 paths.md 已确定的命令目录、外置配置和安装记录，初始化完成后执行。脚本只用 Node 内置模块完成 initialize 和 tools/list，不调用业务工具或连接网关，也不证明当前 ZCode 会话的 MCP 已换代。

```powershell
Push-Location "{{plugin_root}}"
try {
    @'
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const [entry, configPath, registryPath] = process.argv.slice(2);
const child = spawn(process.execPath, [entry, '--config', configPath, '--installed-plugins', registryPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.pipe(process.stderr);
child.on('error', error => { throw error; });
const lines = createInterface({ input: child.stdout });
const timeout = setTimeout(() => child.kill(), 10000);
const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
let received = false;
try {
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'suian-mcp-debug', version: '1.0.0' } } });
  for await (const line of lines) {
    const response = JSON.parse(line);
    if (response.error) throw new Error(JSON.stringify(response.error));
    if (response.id === 1) {
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list', params: {} });
    } else if (response.id === 2) {
      const tools = response.result.tools;
      console.log(JSON.stringify({ toolCount: tools.length, names: tools.map(tool => tool.name) }));
      received = true;
      break;
    }
  }
  if (!received) throw new Error('未收到 tools/list 回执；请核对 stderr、配置与定位锚点');
} finally {
  clearTimeout(timeout);
  lines.close();
  child.stdin.end();
  child.kill();
}
'@ | node --input-type=module - "{{command_dir}}/cli.mjs" "{{config_path}}" "{{installed_plugins_json}}"
} finally {
    Pop-Location
}
```

预期 toolCount 为 19，包含 list_sessions、read_session、get_current_session、get_artifacts 和 set_artifacts。失败时保留错误；不以重新注册全局 MCP 作为修复。该调试客户端没有声明 MCP Apps，工件工具没有 UI 元数据属于正常降级。

原生侧栏失败先区分三层：版本/能力未满足时资源不提供；宿主尚未为目标会话取得 MCP 连接时，在页面装载前可能报告 connection unavailable；页面 get 的 caller 或 SQLite 错误会显示读取失败。当前会话 MCP 连接就绪后使用“重新加载”或页面“刷新”，不要通过启动模型轮掩盖问题。3.15.1.8093 的 initialize 实测仍报告 CLI 0.16.9，实际应用版本来自 Desktop 传入的 ZCODE_APP_VERSION。详细证据见 ../../docs/artifact-demo-verification.md。

## 源码工作树中的隔离读取

这一步使用仓库的测试夹具，要求源码工作树同时包含 common 与 MCP，并已安装锁定的开发依赖。夹具提供公共安装记录，不要求业务包链接；测试仍有同级源码引用，不能直接在原生的独立缓存目录运行。

在源码 MCP 根执行：

```powershell
node --test tests/stdio.test.mjs > stdio-check.log 2>&1
$stdioCheckExit = $LASTEXITCODE
Add-Content -LiteralPath stdio-check.log -Value "EXIT=$stdioCheckExit"
```

tests/fixtures.mjs 自动在临时目录创建双库并清理，无需复制用户数据库。测试覆盖握手、分页、历史、错误反馈与读取前后数据库摘要；后续复核从 stdio-check.log 读取。仅保留脱敏结果。

没有源码工作树时，先报告独立握手结果和隔离读取未执行。当前会话的读取验收可通过客户端工具，对用户指定目标调用 list_sessions/read_session；不把它记作隔离测试。
