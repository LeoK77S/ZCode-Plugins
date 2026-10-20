import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server.mjs';
// 源码测试进程统一经夹具构造安装存储根并预加载公共客户端（PKG-04）；
// 该 import 上的顶层 await 保证本模块的所有消费者在夹具就绪后才创建服务。
import { ensureCommonFixture, isolatedDataPath } from './common-fixture.mjs';

export { isolatedDataPath };
export const apps = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };
await ensureCommonFixture();
export async function connect(t, options, { name = 'zcode', version = '3.15.1', capabilities = apps } = {}) {
  const server = createMcpServer(options);
  const client = new Client({ name, version }, { capabilities });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return client;
}
