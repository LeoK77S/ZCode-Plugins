import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';

test('app-only 目录工具只返回所需层级，node_modules 与隐藏文件不被过滤', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-tree-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  await mkdir(join(workspaceRoot, 'node_modules'));
  await mkdir(join(workspaceRoot, '.git'));
  await writeFile(join(workspaceRoot, '.hidden'), 'visible');
  await writeFile(join(workspaceRoot, 'plain'), 'no-extension');
  await writeFile(join(workspaceRoot, 'node_modules', 'child.txt'), 'child');
  const client = await connect(t, { workspaceRoot });
  const root = await client.callTool({ name: 'list_editor_directory', arguments: { path: '.' }, _meta: { session_id: 'tree-session' } });
  assert.equal(root.isError, undefined);
  assert.deepEqual(root.structuredContent.entries, [
    { name: '.git', path: '.git', kind: 'directory' },
    { name: 'node_modules', path: 'node_modules', kind: 'directory' },
    { name: '.hidden', path: '.hidden', kind: 'file' },
    { name: 'plain', path: 'plain', kind: 'file' }
  ]);
  const nested = await client.callTool({ name: 'list_editor_directory', arguments: { path: 'node_modules' }, _meta: { session_id: 'tree-session' } });
  assert.deepEqual(nested.structuredContent.entries, [{ name: 'child.txt', path: 'node_modules/child.txt', kind: 'file' }]);
  assert.equal(root.structuredContent.sessionId, 'tree-session');
  assert.deepEqual((await client.listTools()).tools.find(tool => tool.name === 'list_editor_directory')._meta.ui.visibility, ['app']);
});

test('目录展开拒绝绝对路径、越界链接及非目录，不绕过可信会话归属', async t => {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-tree-boundary-'));
  t.after(() => rm(root, { recursive: true }));
  const workspaceRoot = join(root, 'workspace'), outside = join(root, 'outside');
  await mkdir(workspaceRoot); await mkdir(outside); await writeFile(join(workspaceRoot, 'file.txt'), 'file');
  await symlink(outside, join(workspaceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const client = await connect(t, { workspaceRoot });
  for (const [path, code] of [[outside, 'invalid_relative_path'], ['../outside', 'invalid_relative_path'],
    ['linked', 'path_outside_workspace'], ['file.txt', 'not_directory']]) {
    const result = await client.callTool({ name: 'list_editor_directory', arguments: { path }, _meta: { session_id: 'tree-boundary' } });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, code); assert.equal(result.structuredContent.entries, undefined);
  }
  const noMeta = await client.callTool({ name: 'list_editor_directory', arguments: { path: '.' } });
  assert.equal(noMeta.isError, true); assert.equal(noMeta.structuredContent.code, 'session_binding_unavailable');
});

test('内部目录链接按目录显示可展开，外部链接保留为不可访问条目', async t => {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-tree-links-'));
  t.after(() => rm(root, { recursive: true }));
  const workspaceRoot = join(root, 'workspace'), outside = join(root, 'outside');
  await mkdir(workspaceRoot); await mkdir(outside); await mkdir(join(workspaceRoot, 'inside'));
  await writeFile(join(workspaceRoot, 'inside', 'file.txt'), 'inside');
  await symlink(join(workspaceRoot, 'inside'), join(workspaceRoot, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(workspaceRoot, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  const client = await connect(t, { workspaceRoot });
  const call = path => client.callTool({ name: 'list_editor_directory', arguments: { path }, _meta: { session_id: 'tree-links' } });
  const { entries } = (await call('.')).structuredContent;
  assert.deepEqual(entries.find(entry => entry.name === 'alias'), { name: 'alias', path: 'alias', kind: 'directory' });
  assert.equal(entries.find(entry => entry.name === 'external').kind, 'other');
  assert.equal(entries.find(entry => entry.name === 'external').unavailableReason, 'path_outside_workspace');
  assert.deepEqual((await call('alias')).structuredContent.entries, [{ name: 'file.txt', path: 'inside/file.txt', kind: 'file' }]);
});
