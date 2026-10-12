import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server.mjs';

export const apps = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };
export async function connect(t, options, { name = 'zcode', version = '3.15.1', capabilities = apps } = {}) {
  const server = createMcpServer(options);
  const client = new Client({ name, version }, { capabilities });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return client;
}
