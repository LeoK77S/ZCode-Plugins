import { readFile } from 'node:fs/promises';

const URI = 'ui://suian-zcode-app-mcp/artifacts.html';
const MIME = 'text/html;profile=mcp-app';

export function registerArtifactUi(server, getTool, setTool, { zcodeAppVersion }) {
  const resource = server.registerResource('artifacts', URI, { title: '会话工件', mimeType: MIME }, async () => ({ contents: [{
    uri: URI, mimeType: MIME, text: await readFile(new URL('./ui/artifacts.html', import.meta.url), 'utf8'),
    _meta: { ui: { prefersBorder: false } }
  }] }));
  resource.disable();
  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    // 3.15.1.8093 的 initialize 仍报告 CLI 0.16.9；Desktop 传入的 ZCODE_APP_VERSION 才是应用版本。
    const match = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?(?:\+[\w.-]+)?$/.exec(zcodeAppVersion ?? client?.version ?? '');
    const version = match?.slice(1, 4).map(Number);
    const supported = client?.name === 'zcode' && version && (version[0] > 3 || version[0] === 3 && (version[1] > 15 || version[1] === 15 && version[2] >= 1));
    const mimeTypes = server.server.getClientCapabilities()?.extensions?.['io.modelcontextprotocol/ui']?.mimeTypes;
    if (supported && Array.isArray(mimeTypes) && mimeTypes.includes(MIME)) {
      resource.enable();
      const ui = { resourceUri: URI, surface: 'artifacts' };
      getTool.update({ _meta: { ui: { ...ui, visibility: ['model', 'app'] } } });
      setTool.update({ _meta: { ui: { ...ui, visibility: ['model'] } } });
    }
  };
}
