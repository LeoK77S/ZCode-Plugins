import { readFile } from 'node:fs/promises';
import { loadCommonClient } from './common-client.mjs';

const URI = 'ui://suian-zcode-app-mcp/artifacts.html';

export async function registerArtifactUi(server, getTool, setTool, statusTool, revealTool, { zcodeAppVersion }) {
  // MIME 与能力判定由公共层提供；注册资源前完成公共定位，失败在任何业务副作用前抛出。
  // supportsZcodeMcpApps 取同步引用，oninitialized 回调内维持同步判定，避免工具 _meta 更新与 listTools 竞态。
  const common = await loadCommonClient();
  const MIME = common.MCP_APP_MIME_TYPE;
  const resource = server.registerResource('artifacts', URI, { title: '会话工件', mimeType: MIME }, async () => ({ contents: [{
    // 相对 import.meta.url 解析：源码模式为插件根 ui/，发布 bundle 后入口位于 dist/、ui 随包复制到 dist/ui
    uri: URI, mimeType: MIME, text: await readFile(new URL('./ui/artifacts.html', import.meta.url), 'utf8'),
    _meta: { ui: { prefersBorder: false } }
  }] }));
  resource.disable();
  server.server.oninitialized = () => {
    if (common.supportsZcodeMcpApps({
      clientInfo: server.server.getClientVersion(),
      capabilities: server.server.getClientCapabilities(),
      zcodeAppVersion
    })) {
      resource.enable();
      const ui = { resourceUri: URI, surface: 'artifacts' };
      getTool.update({ _meta: { ui: { ...ui, visibility: ['model', 'app'] } } });
      setTool.update({ _meta: { ui: { ...ui, visibility: ['model'] } } });
      // PR 状态通道与本机定位通道只随面板启用，且不向模型暴露（visibility 仅 app）
      statusTool.update({ _meta: { ui: { ...ui, visibility: ['app'] } }, enabled: true });
      revealTool.update({ _meta: { ui: { ...ui, visibility: ['app'] } }, enabled: true });
    }
  };
}
