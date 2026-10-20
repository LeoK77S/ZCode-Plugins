import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect, apps, isolatedDataPath } from './fixtures.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // dataPath 采用夹具存储根的真实布局（<storageRoot>/data/<目录>）：定位锚点与状态库目录共享同一语义。
  const workspaceRoot = join(root, 'workspace'); await mkdir(workspaceRoot);
  const dataPath = await isolatedDataPath();
  return { root, workspaceRoot, dataPath };
}
const request = (client, name, session, args = {}) => client.callTool({ name, arguments: args, _meta: { session_id: session } });
async function mode(client, session) {
  const result = await request(client, 'get_editor_settings', session);
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  return result.structuredContent.saveMode;
}

test('模式持久化以工作区/会话隔离：A+全局更新，已有 B 不变，新 C 继承，A 重开恢复', async t => {
  const options = await fixture(t), client = await connect(t, options);
  assert.equal(await mode(client, 'A'), 'manual'); assert.equal(await mode(client, 'B'), 'manual');
  const changed = await request(client, 'update_editor_settings', 'A', { saveMode: 'auto' });
  assert.equal(changed.isError, undefined); assert.equal(changed.structuredContent.saveMode, 'auto');
  assert.equal(await mode(client, 'B'), 'manual'); assert.equal(await mode(client, 'C'), 'auto');
  const reopened = await connect(t, options);
  assert.equal(await mode(reopened, 'A'), 'auto');
  const otherWorkspace = join(options.root, 'other'); await mkdir(otherWorkspace);
  const other = await connect(t, { ...options, workspaceRoot: otherWorkspace });
  await request(other, 'update_editor_settings', 'A', { saveMode: 'manual' });
  assert.equal(await mode(client, 'A'), 'auto', '同名会话的另一工作区不能改 A');
  assert.equal(await mode(client, 'D'), 'manual', '全局默认属于同一插件数据根');
});

test('真实 SQLite 事务失败同时回滚 A 与全局默认，不能误报设置已保存', async t => {
  const options = await fixture(t), client = await connect(t, options);
  assert.equal(await mode(client, 'A'), 'manual');
  const db = new DatabaseSync(join(options.dataPath, 'editor-state.sqlite'));
  try {
    db.exec("CREATE TRIGGER reject_session_update BEFORE UPDATE ON session_settings BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END");
    const result = await request(client, 'update_editor_settings', 'A', { saveMode: 'auto' });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'state_storage_error');
    assert.equal(await mode(client, 'A'), 'manual'); assert.equal(await mode(client, 'C'), 'manual');
  } finally { db.close(); }
});

test('模式工具仍为 app-only 且只用可信 meta；缺失归属、伪造归属和无效数据根不写状态', async t => {
  const options = await fixture(t), client = await connect(t, options);
  const tools = (await client.listTools()).tools;
  for (const name of ['get_editor_settings', 'update_editor_settings']) assert.deepEqual(tools.find(tool => tool.name === name)._meta.ui.visibility, ['app']);
  const noMeta = await client.callTool({ name: 'get_editor_settings', arguments: {} });
  assert.equal(noMeta.structuredContent.code, 'session_binding_unavailable');
  const spoofed = await request(client, 'update_editor_settings', 'A', { saveMode: 'auto', sessionId: 'B' });
  assert.equal(spoofed.isError, true);
  assert.equal(await mode(client, 'A'), 'manual');
  const missing = await connect(t, { workspaceRoot: options.workspaceRoot, dataPath: '' });
  assert.equal((await request(missing, 'get_editor_settings', 'A')).structuredContent.code, 'state_data_path_unavailable');
  const badRoot = join(options.root, 'file'); await writeFile(badRoot, 'not a directory');
  const bad = await connect(t, { workspaceRoot: options.workspaceRoot, dataPath: badRoot });
  assert.equal((await request(bad, 'get_editor_settings', 'A')).structuredContent.code, 'state_storage_error');
  assert.equal(await readFile(badRoot, 'utf8'), 'not a directory');
});

test('未知 schema 和损坏数据库明确拒绝，不清空或重置原文件', async t => {
  const options = await fixture(t), path = join(options.dataPath, 'editor-state.sqlite');
  const db = new DatabaseSync(path); db.exec("PRAGMA user_version=99; CREATE TABLE retained(body TEXT); INSERT INTO retained VALUES ('draft')"); db.close();
  const client = await connect(t, options);
  const unknown = await request(client, 'get_editor_settings', 'A');
  assert.equal(unknown.isError, true); assert.equal(unknown.structuredContent.code, 'state_schema_incompatible');
  const reopened = new DatabaseSync(path);
  assert.equal(reopened.prepare('SELECT body FROM retained').get().body, 'draft'); reopened.close();
  const corruptData = join(options.root, 'corrupt'); await mkdir(corruptData);
  const corruptPath = join(corruptData, 'editor-state.sqlite'); await writeFile(corruptPath, 'broken database');
  const corrupt = await connect(t, { ...options, dataPath: corruptData });
  const corruptResult = await request(corrupt, 'get_editor_settings', 'A');
  assert.equal(corruptResult.structuredContent.code, 'state_database_corrupt');
  assert.match(corruptResult.structuredContent.error, /损坏|格式无效/);
  assert.equal(await readFile(corruptPath, 'utf8'), 'broken database');
});

test('真实 stdio 多进程读取最新全局默认，进程退出重开恢复已有模式', async t => {
  const options = await fixture(t);
  const clients = new Set();
  async function processClient() {
    const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../cli.mjs', import.meta.url))], cwd: options.root,
      env: { SUIAN_SIDE_EDITOR_WORKSPACE: options.workspaceRoot, ZCODE_PLUGIN_DATA: options.dataPath, ZCODE_APP_VERSION: '3.15.1' }, stderr: 'pipe' });
    transport.stderr.resume();
    await client.connect(transport); clients.add(client); return client;
  }
  try {
  const first = await processClient(), second = await processClient();
  assert.equal(await mode(first, 'A'), 'manual'); assert.equal(await mode(second, 'B'), 'manual');
  assert.equal((await request(first, 'update_editor_settings', 'A', { saveMode: 'auto' })).isError, undefined);
  assert.equal(await mode(second, 'B'), 'manual'); assert.equal(await mode(second, 'C'), 'auto');
  await first.close(); clients.delete(first); const reopened = await processClient(); assert.equal(await mode(reopened, 'A'), 'auto');
  await Promise.all([request(second, 'update_editor_settings', 'B', { saveMode: 'manual' }), request(reopened, 'update_editor_settings', 'A', { saveMode: 'auto' })]);
  assert.equal(await mode(second, 'B'), 'manual'); assert.equal(await mode(reopened, 'A'), 'auto');
  } finally { for (const client of clients) await client.close(); }
});

test('多个真实 stdio 进程同时首次读取空数据库，共享一次 schema 初始化', async t => {
  for (let round = 0; round < 5; round++) {
  const options = await fixture(t), clients = [];
  try {
    await Promise.all(Array.from({ length: 8 }, async () => {
      const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
      const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../cli.mjs', import.meta.url))], cwd: options.root,
        env: { SUIAN_SIDE_EDITOR_WORKSPACE: options.workspaceRoot, ZCODE_PLUGIN_DATA: options.dataPath, ZCODE_APP_VERSION: '3.15.1' }, stderr: 'pipe' });
      transport.stderr.resume(); clients.push(client); await client.connect(transport);
    }));
    assert.deepEqual(await Promise.all(clients.map((client, index) => mode(client, `cold-${index}`))), Array(8).fill('manual'));
  } finally { for (const client of clients) await client.close(); }
  }
});
