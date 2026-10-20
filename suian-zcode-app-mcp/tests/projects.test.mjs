import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture } from './fixtures.mjs';
import { createSessionReader } from '../sessions.mjs';
import { createMcpServer } from '../server.mjs';

function projectFixture(t) {
  const f = fixture(t);
  for (const [id, workspace] of [['parent', 'D:/alpha'], ['sibling', 'D:/beta'], ['other', 'D:/alpha']]) f.task({ id, workspace });
  f.session({ id: 'parent', directory: 'D:/alpha', permission: { mode: 'plan' } });
  f.index.exec([
    'ALTER TABLE tasks ADD COLUMN host_id TEXT DEFAULT "local"',
    'ALTER TABLE tasks ADD COLUMN root_path TEXT',
    'ALTER TABLE tasks ADD COLUMN project_id TEXT',
    'ALTER TABLE tasks ADD COLUMN execution_directories TEXT',
    'CREATE TABLE projects (project_id TEXT PRIMARY KEY,host_id TEXT,name TEXT,deleted INTEGER)',
    'CREATE TABLE project_roots (project_id TEXT,root_path TEXT,position INTEGER)',
    "INSERT INTO projects VALUES ('project-a','local','项目 A',0),('project-b','local','项目 B',0)",
    "INSERT INTO project_roots VALUES ('project-a','D:/alpha',0),('project-a','D:/beta',1),('project-b','D:/alpha',0)",
    "UPDATE tasks SET root_path=workspace_path,project_id=CASE task_id WHEN 'other' THEN 'project-b' ELSE 'project-a' END"
  ].join(';'));
  return f;
}

test('项目筛选以项目 ID 区分同目录的不同项目，当前会话公布冻结目录，查询不写索引', async t => {
  const f = projectFixture(t), reader = createSessionReader(f);
  f.index.prepare('UPDATE tasks SET execution_directories=? WHERE task_id=?').run('[]', 'parent');
  const before = readFileSync(f.indexDbPath);
  const list = reader.listSessions({ project_id: 'project-a' });
  assert.deepEqual(list.sessions.map(row => row.session_id), ['parent', 'sibling']);
  assert.ok(list.sessions.every(row => row.project_id === 'project-a'));
  assert.deepEqual(reader.listSessions({ project_id: 'project-b' }).sessions.map(row => row.session_id), ['other']);
  assert.deepEqual(reader.listSessions({ project_id: null }).sessions, []);
  const current = await reader.sessionOverview({ session_id: 'parent' });
  assert.equal(current.project_id, 'project-a');
  assert.deepEqual(current.additional_directories, []);
  assert.deepEqual(readFileSync(f.indexDbPath), before);
});

test('列表区分多目录项目与会话附加目录，摘要最多三项并明确截断', t => {
  const f = projectFixture(t), reader = createSessionReader(f);
  f.index.exec("INSERT INTO project_roots VALUES ('project-a','D:/gamma',2),('project-a','D:/delta',3),('project-a','D:/epsilon',4)");
  f.index.prepare('UPDATE tasks SET execution_directories=? WHERE task_id=?')
    .run(JSON.stringify(['D:/gamma', 'D:/delta', 'D:/epsilon', 'D:/frozen-only']), 'parent');
  const before = readFileSync(f.indexDbPath);
  const rows = reader.listSessions().sessions;
  const parent = rows.find(row => row.session_id === 'parent');
  assert.equal(parent.is_multi_workspace_project, true);
  assert.equal(parent.additional_directories_count, 4);
  assert.deepEqual(parent.additional_directories_preview, ['D:/gamma', 'D:/delta', 'D:/epsilon']);
  assert.equal(parent.additional_directories_truncated, true);
  const sibling = rows.find(row => row.session_id === 'sibling');
  assert.equal(sibling.additional_directories_count, 4);
  assert.deepEqual(sibling.additional_directories_preview, ['D:/alpha', 'D:/gamma', 'D:/delta']);
  const other = rows.find(row => row.session_id === 'other');
  assert.equal(other.is_multi_workspace_project, false);
  assert.equal(other.additional_directories_count, 0);
  assert.deepEqual(other.additional_directories_preview, []);
  assert.equal(other.additional_directories_truncated, false);
  assert.deepEqual(readFileSync(f.indexDbPath), before);
  f.index.prepare('UPDATE tasks SET execution_directories=? WHERE task_id=?').run('[]', 'parent');
  const frozenEmpty = reader.listSessions({ project_id: 'project-a' }).sessions.find(row => row.session_id === 'parent');
  assert.equal(frozenEmpty.is_multi_workspace_project, true);
  assert.equal(frozenEmpty.additional_directories_count, 0);
  assert.deepEqual(frozenEmpty.additional_directories_preview, []);
  assert.equal(frozenEmpty.additional_directories_truncated, false);
});

test('query 通过附加目录找到所属项目，先筛选再分页并保留项目与归档边界', t => {
  const f = projectFixture(t), reader = createSessionReader(f);
  f.index.exec("UPDATE tasks SET execution_directories='[]' WHERE task_id='parent'");
  f.index.exec("INSERT INTO project_roots VALUES ('project-a','D:/third',2),('project-a','D:/fourth',3),('project-a','D:/beyond-preview',4)");
  const before = readFileSync(f.indexDbPath);
  const first = reader.listSessions({ query: 'BETA', limit: 1 });
  assert.equal(first.total, 2);
  assert.deepEqual(first.sessions.map(row => row.session_id), ['parent']);
  assert.equal(first.next_offset, 1);
  const next = reader.listSessions({ query: 'BETA', limit: 1, offset: first.next_offset });
  assert.deepEqual(next.sessions.map(row => row.session_id), ['sibling']);
  assert.equal(next.next_offset, null);
  assert.equal(reader.listSessions({ query: 'beyond-preview' }).total, 2);
  assert.equal(reader.listSessions({ query: 'd:\\BETA\\' }).total, 2);
  assert.deepEqual(reader.listSessions({ query: 'beta', workspace_path: 'D:/alpha' }).sessions.map(row => row.session_id), ['parent']);
  assert.equal(reader.listSessions({ query: 'beta', project_id: 'project-b' }).total, 0);
  assert.deepEqual(readFileSync(f.indexDbPath), before);
  f.index.prepare('UPDATE tasks SET execution_directories=? WHERE task_id=?').run('["D:/frozen-only"]', 'parent');
  assert.equal(reader.listSessions({ query: 'frozen-only' }).total, 2);
  f.index.prepare('UPDATE tasks SET project_id=NULL,execution_directories=? WHERE task_id=?').run('["D:/unclassified-extra"]', 'other');
  assert.deepEqual(reader.listSessions({ query: 'unclassified-extra' }).sessions.map(row => row.session_id), ['other']);
  f.index.exec("UPDATE tasks SET archived=1 WHERE task_id='sibling'");
  assert.equal(reader.listSessions({ query: 'beta' }).total, 1);
  assert.equal(reader.listSessions({ query: 'beta', include_archived: true }).total, 2);
  f.index.exec("UPDATE tasks SET deleted=1 WHERE task_id='parent'");
  assert.deepEqual(reader.listSessions({ query: 'beta', include_archived: true }).sessions.map(row => row.session_id), ['sibling']);
});

test('旧索引继续支持原有列表，显式项目筛选报告宿主索引不支持', t => {
  const f = fixture(t); f.task({ id: 'old' });
  const reader = createSessionReader(f);
  assert.equal(reader.listSessions().total, 1);
  assert.equal(reader.listSessions({ query: 'WORK\\ALPHA' }).total, 1);
  assert.equal(reader.listSessions().sessions[0].is_multi_workspace_project, undefined);
  assert.throws(() => reader.listSessions({ project_id: 'project-a' }), /project_schema_unsupported/);
});

test('远端发起者仍可查询会话元信息，但不把远端项目目录继承为本机权限', async t => {
  const f = projectFixture(t), reader = createSessionReader(f);
  f.index.exec("UPDATE tasks SET host_id='remote' WHERE task_id='parent'");
  assert.equal((await reader.sessionOverview({ session_id: 'parent' })).session_title, 'parent');
  assert.equal(await reader.sessionProject({ session_id: 'parent' }), undefined);
});

test('MCP 创建在会话范围内继承项目和目录，跨项目与显式未归类不误继承', async t => {
  const f = projectFixture(t), calls = [];
  const controller = { startSession: async args => { calls.push(args); return { session_id: 'new', delivery_status: 'accepted' }; } };
  const server = await createMcpServer(f, { controller }), client = new Client({ name: 'multi-root-contract', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  const start = arguments_ => client.callTool({ name: 'start_session', arguments: { workspace_path: 'D:/alpha', message: 'hello', ...arguments_ }, _meta: { session_id: 'parent' } });
  assert.equal((await start({})).isError, undefined);
  assert.equal(calls.at(-1).project_id, 'project-a');
  assert.deepEqual(calls.at(-1).additional_directories, ['D:/beta']);
  await start({ workspace_path: 'd:/BETA/' });
  assert.equal(calls.at(-1).project_id, 'project-a');
  assert.deepEqual(calls.at(-1).additional_directories, ['D:/alpha']);
  await start({ workspace_path: 'D:/elsewhere' });
  assert.equal(calls.at(-1).project_id, undefined);
  assert.equal(calls.at(-1).additional_directories, undefined);
  await start({ project_id: null });
  assert.equal(calls.at(-1).project_id, null);
  assert.equal(calls.at(-1).additional_directories, undefined);
  await start({ project_id: 'project-b' });
  assert.equal(calls.at(-1).project_id, 'project-b');
  assert.equal(calls.at(-1).additional_directories, undefined);
  await start({ additional_directories: [] });
  assert.equal(calls.at(-1).project_id, 'project-a');
  assert.deepEqual(calls.at(-1).additional_directories, []);
  const listed = await client.callTool({ name: 'list_sessions', arguments: { project_id: 'project-b' } });
  assert.deepEqual(listed.structuredContent.sessions.map(row => row.session_id), ['other']);
  assert.equal(listed.structuredContent.sessions[0].is_multi_workspace_project, false);
  const searched = await client.callTool({ name: 'list_sessions', arguments: { query: 'beta' } });
  assert.deepEqual(searched.structuredContent.sessions.map(row => row.session_id), ['parent', 'sibling']);
  assert.deepEqual(searched.structuredContent.sessions[0].additional_directories_preview, ['D:/beta']);
  const current = await client.callTool({ name: 'get_current_session', arguments: {}, _meta: { session_id: 'parent' } });
  assert.equal(current.structuredContent.project_id, 'project-a');
  assert.deepEqual(current.structuredContent.additional_directories, ['D:/beta']);
  const count = calls.length;
  assert.equal((await start({ additional_directories: ['relative/path'] })).isError, true);
  assert.equal(calls.length, count);
  f.index.exec("INSERT INTO tasks (workspace_key,task_id,host_id,workspace_path,root_path,project_id) VALUES ('duplicate','parent','local','D:/beta','D:/beta','project-a')");
  assert.equal((await start({})).isError, undefined, '归属不唯一时跳过目录继承，不阻断旧参数创建');
  assert.equal(calls.at(-1).project_id, undefined);
  assert.equal(calls.at(-1).additional_directories, undefined);
  f.index.exec("UPDATE tasks SET deleted=1 WHERE workspace_key='duplicate'");
  assert.equal((await start({})).isError, undefined, '唯一有效归属不能被另一条已删除记录阻断');
  assert.equal(calls.at(-1).project_id, 'project-a');
  assert.deepEqual(calls.at(-1).additional_directories, ['D:/beta']);
});
