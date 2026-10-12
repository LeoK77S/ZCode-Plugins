import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';
import { saveAuthorization } from 'suian-zcode-common/auth-store.mjs';
import { loadConfig } from './config.mjs';

const { values } = parseArgs({
   options: { config: { type: 'string' }, 'index-db': { type: 'string' }, 'session-db': { type: 'string' }, 'artifact-db': { type: 'string' }, 'gateway-config': { type: 'string' }, 'auth-data-dir': { type: 'string' }, 'save-authorization': { type: 'boolean' } },
  allowPositionals: false
});
const config = await loadConfig(values);
if (values['save-authorization']) {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk;
  const { authorization_url } = JSON.parse(raw);
  await saveAuthorization({ dataDir: config.authDataDir, url: authorization_url });
  console.log(JSON.stringify({ ok: true, authorization: 'saved' }));
} else {
  const server = createMcpServer(config);
  await server.connect(new StdioServerTransport());
}
