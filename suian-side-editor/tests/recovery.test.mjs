import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect, apps, isolatedDataPath } from './fixtures.mjs';

const request = (client, name, session, args = {}) => client.callTool({ name, arguments: args, _meta: { session_id: session } });
const draft = { text: '未保存\r\n正文', diskText: '原正文\r\n', baseVersion: 'sha256:' + 'a'.repeat(64), encoding: { name: 'utf-8', bom: true, newline: 'crlf' } };
const snapshot = { files: [{ path: 'a.md', fixed: true, scrollTop: 731, scrollLeft: 8, draft }, { path: 'b.txt', fixed: false, scrollTop: 25, scrollLeft: 0 }], currentPath: 'a.md' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // dataPath 采用夹具存储根的真实布局（<storageRoot>/data/<目录>）：定位锚点与状态库目录共享同一语义。
  const workspaceRoot = join(root, 'workspace'); await mkdir(workspaceRoot);
  const dataPath = await isolatedDataPath();
  return { root, workspaceRoot, dataPath };
}

test('schema1 无损迁移；恢复快照在新 stdio 进程保留、关闭清空且工作区/会话隔离', async t => {
  const options = await fixture(t), old = await connect(t, options);
  const a = (await request(old, 'get_editor_context', 'A')).structuredContent;
  const db = new DatabaseSync(join(options.dataPath, 'editor-state.sqlite'));
  db.exec("CREATE TABLE editor_defaults (id INTEGER PRIMARY KEY, save_mode TEXT); CREATE TABLE session_settings(workspace_identity TEXT,session_id TEXT,save_mode TEXT,PRIMARY KEY(workspace_identity,session_id)); INSERT INTO editor_defaults VALUES(1,'auto'); PRAGMA user_version=1");
  db.prepare('INSERT INTO session_settings VALUES(?,?,?)').run(a.workspaceIdentity, 'A', 'manual'); db.prepare('INSERT INTO session_settings VALUES(?,?,?)').run(a.workspaceIdentity, 'B', 'auto'); db.close();
  const initial = await request(old, 'get_editor_state', 'A');
  assert.equal(initial.isError, undefined); assert.deepEqual(initial.structuredContent, { state: { files: [], currentPath: null }, revision: 0 });
  const ack = await request(old, 'update_editor_state', 'A', { state: snapshot }); assert.equal(ack.isError, undefined); assert.equal(ack.structuredContent.revision, 1);
  const inspect = new DatabaseSync(join(options.dataPath, 'editor-state.sqlite'));
  assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 2); assert.equal(inspect.prepare('SELECT save_mode FROM editor_defaults').get().save_mode, 'auto');
  assert.deepEqual(inspect.prepare('SELECT session_id,save_mode FROM session_settings ORDER BY session_id').all().map(x => [x.session_id,x.save_mode]), [['A','manual'],['B','auto']]); inspect.close();
  const child = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../cli.mjs', import.meta.url))], cwd: options.root,
    env: { SUIAN_SIDE_EDITOR_WORKSPACE: options.workspaceRoot, ZCODE_PLUGIN_DATA: options.dataPath, ZCODE_APP_VERSION: '3.15.1' }, stderr: 'pipe' }); transport.stderr.resume();
  try {
    await child.connect(transport); assert.deepEqual((await request(child, 'get_editor_state', 'A')).structuredContent, { state: snapshot, revision: 1 });
    assert.deepEqual((await request(child, 'get_editor_state', 'B')).structuredContent.state.files, []);
    const otherRoot = join(options.root, 'other'); await mkdir(otherRoot); const other = await connect(t, { ...options, workspaceRoot: otherRoot });
    assert.deepEqual((await request(other, 'get_editor_state', 'A')).structuredContent.state.files, []);
    assert.equal((await request(child, 'get_editor_settings', 'A')).structuredContent.saveMode, 'manual');
    assert.equal((await request(child, 'get_editor_settings', 'new')).structuredContent.saveMode, 'auto');
    await request(child, 'update_editor_state', 'A', { state: { files: [], currentPath: null } });
    assert.deepEqual((await request(old, 'get_editor_state', 'A')).structuredContent, { state: { files: [], currentPath: null }, revision: 2 });
  } finally { await child.close(); }
});

test('恢复工具仅 app-only；拒绝伪造归属、越界路径、重复页、多个临时页和不可序列化的生命周期字段', async t => {
  const options = await fixture(t), client = await connect(t, options);
  for (const name of ['get_editor_state','update_editor_state']) assert.deepEqual((await client.listTools()).tools.find(tool => tool.name === name)._meta.ui.visibility, ['app']);
  assert.equal((await client.callTool({ name: 'get_editor_state', arguments: {} })).structuredContent.code, 'session_binding_unavailable');
  assert.equal((await request(client, 'update_editor_state', 'A', { state: snapshot, sessionId: 'B' })).isError, true);
  for (const path of ['../outside.txt', '/absolute.txt', 'C:/secret.txt', 'x:stream', 'dir\\a.txt']) {
    assert.equal((await request(client, 'update_editor_state', 'A', { state: { files: [{ path, fixed: true, scrollTop: 0, scrollLeft: 0 }], currentPath: path } })).isError, true);
  }
  for (const state of [
    { files: [snapshot.files[0],snapshot.files[0]], currentPath: 'a.md' },
    { files: [snapshot.files[1], { ...snapshot.files[1], path: 'c.txt' }], currentPath: 'b.txt' },
    { ...snapshot, currentPath: 'missing.txt' },
    { ...snapshot, files: [{ ...snapshot.files[0], resourceUri: 'ui://expired' }] },
    { ...snapshot, files: [{ ...snapshot.files[0], fixed: false }] }
  ]) assert.equal((await request(client, 'update_editor_state', 'A', { state })).isError, true);
  assert.deepEqual((await request(client, 'get_editor_state', 'A')).structuredContent, { state: { files: [], currentPath: null }, revision: 0 });
});

test('恢复写入真实事务失败保留旧副本与模式；修复后可写，不静默清库', async t => {
  const options = await fixture(t), client = await connect(t, options);
  await request(client, 'update_editor_state', 'A', { state: snapshot }); await request(client, 'update_editor_settings', 'A', { saveMode: 'auto' });
  const db = new DatabaseSync(join(options.dataPath, 'editor-state.sqlite'));
  try {
    db.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON session_recovery BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    const rejected = await request(client, 'update_editor_state', 'A', { state: { files: [], currentPath: null } });
    assert.equal(rejected.isError, true); assert.equal(rejected.structuredContent.code, 'state_storage_error');
    assert.deepEqual((await request(client, 'get_editor_state', 'A')).structuredContent, { state: snapshot, revision: 1 });
    assert.equal((await request(client, 'get_editor_settings', 'A')).structuredContent.saveMode, 'auto');
    db.exec('DROP TRIGGER reject_recovery'); assert.equal((await request(client, 'update_editor_state', 'A', { state: { files: [], currentPath: null } })).structuredContent.revision, 2);
  } finally { db.close(); }
});

test('损坏的恢复记录明确报错，保留原记录而非返回不可用正文或重置', async t => {
  const options = await fixture(t), client = await connect(t, options);
  await request(client, 'update_editor_state', 'A', { state: snapshot });
  const db = new DatabaseSync(join(options.dataPath, 'editor-state.sqlite'));
  try {
    db.exec(`UPDATE session_recovery SET state_json='{"files":null,"currentPath":null}'`);
    const result = await request(client, 'get_editor_state', 'A'); assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'state_database_corrupt');
    assert.equal(db.prepare('SELECT state_json FROM session_recovery').get().state_json, '{"files":null,"currentPath":null}');
  } finally { db.close(); }
});
