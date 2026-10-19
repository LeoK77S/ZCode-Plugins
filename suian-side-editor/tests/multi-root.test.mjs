import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from './fixtures.mjs';

test('当前会话登记的附加目录可选择，同名文件和未登记目录保持隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'side-multiroot-'));
  let db;
  t.after(async () => { db?.close(); await rm(dir, { recursive: true }); });
  const first = join(dir, 'first'), second = join(dir, 'second'), outside = join(dir, 'outside');
  for (const path of [first, second, outside]) { await mkdir(path); await writeFile(join(path, 'same.txt'), path === first ? 'first' : 'second'); }
  const indexDbPath = join(dir, 'index.sqlite'); db = new DatabaseSync(indexDbPath);
  db.exec(`CREATE TABLE tasks (task_id TEXT, workspace_key TEXT, workspace_path TEXT, workspace_identity TEXT, root_path TEXT, host_id TEXT, project_id TEXT, execution_directories TEXT);
    CREATE TABLE projects (project_id TEXT, host_id TEXT, name TEXT, deleted INTEGER);
    CREATE TABLE project_roots (project_id TEXT, root_path TEXT, position INTEGER, is_primary INTEGER);`);
  db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run('session_multi', first, first, null, first, 'local', 'project_multi', null);
  db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run('project_multi', 'local', '多目录项目', 0);
  for (const [i, path] of [first, second].entries()) db.prepare('INSERT INTO project_roots VALUES (?,?,?,?)').run('project_multi', path, i, Number(i === 0));
  const client = await connect(t, { workspaceRoot: first, indexDbPath, dataPath: join(dir, 'data') });
  const call = (name, args = {}) => client.callTool({ name, arguments: args, _meta: { session_id: 'session_multi' } });
  const context = await call('get_editor_context');
  assert.deepEqual(context.structuredContent.workspaceRoots, [first, second]);
  const a = await call('read_editor_text', { path: 'same.txt', workspace_root: first });
  const b = await call('read_editor_text', { path: 'same.txt', workspace_root: second });
  assert.equal(a.structuredContent.text, 'first'); assert.equal(b.structuredContent.text, 'second');
  assert.notEqual(a.structuredContent.workspaceIdentity, b.structuredContent.workspaceIdentity);
  assert.equal((await call('get_editor_context', { workspace_root: second })).structuredContent.sessionWorkspacePath, first);
  const denied = await call('read_editor_text', { path: 'same.txt', workspace_root: outside });
  assert.equal(denied.isError, true); assert.equal(denied.structuredContent.code, 'workspace_not_allowed');
  if (process.platform === 'win32') {
    const indexedPath = first.replaceAll('\\', '/').toLowerCase();
    db.prepare('UPDATE tasks SET root_path=?').run(indexedPath);
    db.prepare('UPDATE project_roots SET root_path=? WHERE position=0').run(indexedPath);
    const normalized = await call('get_editor_context', { workspace_root: indexedPath });
    assert.equal(normalized.isError, undefined, '索引与启动路径的斜杠、大小写差异不能阻止打开');
    assert.equal(normalized.structuredContent.workspaceRoot, indexedPath);
    assert.equal(normalized.structuredContent.workspacePath, first);
  }
  db.prepare('UPDATE tasks SET execution_directories=?').run('[]');
  const revoked = await call('read_editor_text', { path: 'same.txt', workspace_root: second });
  assert.equal(revoked.isError, true, '冻结为空附加目录时，不能用项目目录扩大执行范围');
});
