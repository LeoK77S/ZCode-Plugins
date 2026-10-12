export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export function supportsZcodeMcpApps({ clientInfo, capabilities, zcodeAppVersion }) {
  // Desktop initialize 可能仍报告 CLI 0.16.9；宿主传入的应用版本优先。
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?(?:\+[\w.-]+)?$/.exec(zcodeAppVersion ?? clientInfo?.version ?? '');
  const version = match?.slice(1, 4).map(Number);
  const supported = clientInfo?.name === 'zcode' && version && (version[0] > 3 || version[0] === 3 && (version[1] > 15 || version[1] === 15 && version[2] >= 1));
  const mimeTypes = capabilities?.extensions?.['io.modelcontextprotocol/ui']?.mimeTypes;
  return Boolean(supported && Array.isArray(mimeTypes) && mimeTypes.includes(MCP_APP_MIME_TYPE));
}
