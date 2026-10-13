import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, utimes, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';

test('app-only 手动保存校验字节基线，保留 BOM/CRLF/中文并返回新版本', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-save-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const source = join(workspaceRoot, '中文.md');
  await writeFile(source, '\ufeff中文\r\n原文\r\n');
  const client = await connect(t, { workspaceRoot });
  const call = (name, args) => client.callTool({ name, arguments: args, _meta: { session_id: 'save-session' } });
  const before = (await call('read_editor_text', { path: '中文.md' })).structuredContent;
  const result = await call('save_editor_text', { path: '中文.md', text: '中文已编辑\r\n原文\r\n', baseVersion: before.version });
  assert.equal(result.isError, undefined);
  assert.equal(await readFile(source, 'utf8'), '\ufeff中文已编辑\r\n原文\r\n');
  assert.notEqual(result.structuredContent.version, before.version);
  assert.equal(result.structuredContent.text, '中文已编辑\r\n原文\r\n');
  assert.deepEqual(result.structuredContent.encoding, { name: 'utf-8', bom: true, newline: 'crlf' });
  assert.deepEqual((await client.listTools()).tools.find(tool => tool.name === 'save_editor_text')._meta.ui.visibility, ['app']);
  const context = (await call('get_editor_context', {})).structuredContent;
  assert.equal(context.capabilities.saveText, true);
});

test('未修改保存不重写 BOM/混合换行字节；内容变更即使 mtime 相同也拒绝旧基线', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-version-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const source = join(workspaceRoot, 'mixed.txt'), original = Buffer.from('\ufeff第一行\r\n第二行\n第三行\r');
  await writeFile(source, original);
  const client = await connect(t, { workspaceRoot });
  const call = (name, args) => client.callTool({ name, arguments: args, _meta: { session_id: 'version-session' } });
  const before = (await call('read_editor_text', { path: 'mixed.txt' })).structuredContent;
  const untouched = await call('save_editor_text', { path: 'mixed.txt', text: before.text, baseVersion: before.version });
  assert.equal(untouched.isError, undefined);
  assert.equal(untouched.structuredContent.version, before.version);
  assert.deepEqual(await readFile(source), original);
  const time = await stat(source);
  await writeFile(source, '\ufeff外部修改\r\n');
  await utimes(source, time.atime, time.mtime);
  const stale = await call('save_editor_text', { path: 'mixed.txt', text: '本地编辑\r\n', baseVersion: before.version });
  assert.equal(stale.isError, true); assert.equal(stale.structuredContent.code, 'version_conflict');
  assert.equal(await readFile(source, 'utf8'), '\ufeff外部修改\r\n');
});

test('同文件保存顺序执行，两次旧基线请求仅第一份成功且不会清除新基线', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-order-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const source = join(workspaceRoot, 'file.txt'); await writeFile(source, 'before\n');
  const client = await connect(t, { workspaceRoot });
  const call = (name, args) => client.callTool({ name, arguments: args, _meta: { session_id: 'order-session' } });
  const { version } = (await call('read_editor_text', { path: 'file.txt' })).structuredContent;
  const [first, second] = await Promise.all([
    call('save_editor_text', { path: 'file.txt', text: 'first\n', baseVersion: version }),
    call('save_editor_text', { path: './file.txt', text: 'second\n', baseVersion: version })
  ]);
  assert.equal(first.isError, undefined);
  assert.equal(second.isError, true); assert.equal(second.structuredContent.code, 'version_conflict');
  assert.equal(await readFile(source, 'utf8'), 'first\n');
});

test('保存不会创建文件或借缺失归属、绝对路径、外部链接越界', async t => {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-save-boundary-'));
  t.after(() => rm(root, { recursive: true }));
  const workspaceRoot = join(root, 'workspace'), outside = join(root, 'outside');
  await mkdir(workspaceRoot); await mkdir(outside);
  await writeFile(join(workspaceRoot, 'file.txt'), 'inside');
  await writeFile(join(outside, 'file.txt'), 'outside');
  await symlink(outside, join(workspaceRoot, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const client = await connect(t, { workspaceRoot });
  const args = { text: 'overwrite', baseVersion: 'sha256:' + '0'.repeat(64) };
  for (const [path, code] of [['missing.txt', 'file_not_found'], ['../outside/file.txt', 'invalid_relative_path'],
    [join(outside, 'file.txt'), 'invalid_relative_path'], ['link/file.txt', 'path_outside_workspace']]) {
    const result = await client.callTool({ name: 'save_editor_text', arguments: { ...args, path }, _meta: { session_id: 'boundary-session' } });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, code);
  }
  const missingContext = await client.callTool({ name: 'save_editor_text', arguments: { ...args, path: 'file.txt' } });
  assert.equal(missingContext.isError, true); assert.equal(missingContext.structuredContent.code, 'session_binding_unavailable');
  assert.equal(await readFile(join(outside, 'file.txt'), 'utf8'), 'outside');
  assert.equal(await readFile(join(workspaceRoot, 'file.txt'), 'utf8'), 'inside');
});

test('保存边界拒绝会被 UTF-8 编码替换的孤立代理字符，原文不被损坏', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-invalid-text-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const source = join(workspaceRoot, 'file.txt'); await writeFile(source, 'before');
  const client = await connect(t, { workspaceRoot });
  const call = (name, args) => client.callTool({ name, arguments: args, _meta: { session_id: 'invalid-text' } });
  const { version } = (await call('read_editor_text', { path: 'file.txt' })).structuredContent;
  const result = await call('save_editor_text', { path: 'file.txt', text: '\ud800', baseVersion: version });
  assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'invalid_text');
  assert.equal(await readFile(source, 'utf8'), 'before');
});
