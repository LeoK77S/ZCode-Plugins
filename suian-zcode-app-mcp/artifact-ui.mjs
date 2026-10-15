import { readFile } from 'node:fs/promises';
import { MCP_APP_MIME_TYPE as MIME, supportsZcodeMcpApps } from 'suian-zcode-common/ui-capabilities.mjs';

const URI = 'ui://suian-zcode-app-mcp/artifacts.html';

export function registerArtifactUi(server, getTool, setTool, statusTool, { zcodeAppVersion }) {
  const resource = server.registerResource('artifacts', URI, { title: '会话工件', mimeType: MIME }, async () => ({ contents: [{
    uri: URI, mimeType: MIME, text: await readFile(new URL('./ui/artifacts.html', import.meta.url), 'utf8'),
    _meta: { ui: { prefersBorder: false } }
  }] }));
  resource.disable();
  server.server.oninitialized = () => {
    if (supportsZcodeMcpApps({
      clientInfo: server.server.getClientVersion(),
      capabilities: server.server.getClientCapabilities(),
      zcodeAppVersion
    })) {
      resource.enable();
      const ui = { resourceUri: URI, surface: 'artifacts' };
      getTool.update({ _meta: { ui: { ...ui, visibility: ['model', 'app'] } } });
      setTool.update({ _meta: { ui: { ...ui, visibility: ['model'] } } });
      // PR 状态通道只随面板启用，且不向模型暴露（visibility 仅 app）
      statusTool.update({ _meta: { ui: { ...ui, visibility: ['app'] } }, enabled: true });
    }
  };
}
