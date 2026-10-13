// 子进程隔离真实 transport.send 拒绝，记录 Node 未处理拒绝而不污染父测试运行器。
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server.mjs';
import { apps } from './fixtures.mjs';

const root = await mkdtemp(join(tmpdir(), 'side-editor-send-failure-'));
const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
await mkdir(workspaceRoot); await mkdir(dataPath); await writeFile(join(workspaceRoot, 'file.txt'), 'first\n');
const server = createMcpServer({ workspaceRoot, dataPath, zcodeAppVersion: '3.15.1' });
const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
const [ct, st] = InMemoryTransport.createLinkedPair();
const reports = [], unhandled = [];
const originalError = console.error;
console.error = (...args) => { reports.push(args.map(String).join(' ')); originalError(...args); };
process.on('unhandledRejection', error => { unhandled.push(error.message); });
let attempted, rejectSend, timeout, attempts = 0;
const attempt = new Promise(resolve => { attempted = resolve; });
const originalSend = st.send.bind(st);
st.send = message => {
  if (message.method !== 'notifications/resources/updated') return originalSend(message);
  attempts++; attempted();
  if (process.argv[2] === 'close') return new Promise((_resolve, reject) => { rejectSend = reject; });
  return Promise.reject(new Error('测试：资源通知发送失败'));
};
try {
  await server.connect(st); await client.connect(ct);
  const opened = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id: 'send-failure-fixture' } });
  await client.subscribeResource({ uri: opened.structuredContent.resourceUri });
  await writeFile(join(workspaceRoot, 'file.txt'), 'changed\n');
  await Promise.race([attempt, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('没有经过公开发送边界')), 2500); })]);
  clearTimeout(timeout);
  if (process.argv[2] === 'close') { await server.close(); rejectSend(new Error('测试：连接关闭时在途通知发送失败')); }
  await nextTurn(); await nextTurn();
  await writeFile(join(workspaceRoot, 'file.txt'), 'later-change\n');
  await new Promise(resolve => setTimeout(resolve, 1100));
  console.log(JSON.stringify({ reports, unhandled, attempts }));
} finally { clearTimeout(timeout); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
