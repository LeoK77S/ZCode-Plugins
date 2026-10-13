import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';

test('app-only 读取保留中文、BOM 与 CRLF 特征，版本来自实际字节', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-read-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  await writeFile(join(workspaceRoot, '中文.md'), '\ufeff中文\r\n<tag>\r\n');
  const client = await connect(t, { workspaceRoot });
  const result = await client.callTool({ name: 'read_editor_text', arguments: { path: '中文.md' }, _meta: { session_id: 'test-read-a' } });
  assert.equal(result.isError, undefined, '应通过只读 app 工具读取文本');
  assert.equal(result.structuredContent.text, '中文\r\n<tag>\r\n');
  assert.equal(result.structuredContent.relativePath, '中文.md');
  assert.deepEqual(result.structuredContent.encoding, { name: 'utf-8', bom: true, newline: 'crlf' });
  assert.match(result.structuredContent.version, /^sha256:[a-f0-9]{64}$/);
  const oldVersion = result.structuredContent.version;
  await writeFile(join(workspaceRoot, '中文.md'), '\ufeff中文已更新\r\n<tag>\r\n');
  const updated = await client.callTool({ name: 'read_editor_text', arguments: { path: '中文.md' }, _meta: { session_id: 'test-read-a' } });
  assert.notEqual(updated.structuredContent.version, oldVersion);
  assert.equal(updated.structuredContent.sessionId, 'test-read-a');
  assert.deepEqual((await client.listTools()).tools.find(item => item.name === 'read_editor_text')._meta.ui.visibility, ['app']);
});

test('非法 UTF-8、二进制、目录与不存在文件提供明确原因，不返回可编辑正文', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-errors-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  await writeFile(join(workspaceRoot, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
  await writeFile(join(workspaceRoot, 'binary.dat'), Buffer.from([0x61, 0, 0x62]));
  await mkdir(join(workspaceRoot, 'directory'));
  const client = await connect(t, { workspaceRoot });
  for (const [path, code] of [['invalid.txt', 'invalid_utf8'], ['binary.dat', 'binary_file'], ['directory', 'not_text_file'], ['missing.txt', 'file_not_found']]) {
    const result = await client.callTool({ name: 'read_editor_text', arguments: { path }, _meta: { session_id: 'test-errors' } });
    assert.equal(result.isError, true, path);
    assert.equal(result.structuredContent.code, code, path);
    assert.equal(result.structuredContent.text, undefined);
  }
});

test('相对路径只能读取绑定工作区；绝对路径、穿越与外部链接均被拒绝', async t => {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-boundary-'));
  t.after(() => rm(root, { recursive: true }));
  const workspaceRoot = join(root, 'workspace'), outside = join(root, 'outside');
  await mkdir(workspaceRoot); await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'outside-secret');
  await symlink(outside, join(workspaceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const client = await connect(t, { workspaceRoot });
  for (const [path, code] of [[join(outside, 'secret.txt'), 'invalid_relative_path'], ['../outside/secret.txt', 'invalid_relative_path'],
    ['..\\outside\\secret.txt', 'invalid_relative_path'], ['C:\\anywhere\\file.txt', 'invalid_relative_path'],
    ['\\\\server\\share\\file.txt', 'invalid_relative_path'], ['file.txt:stream', 'invalid_relative_path'],
    ['linked/secret.txt', 'path_outside_workspace']]) {
    const result = await client.callTool({ name: 'read_editor_text', arguments: { path }, _meta: { session_id: 'test-boundary' } });
    assert.equal(result.isError, true, path);
    assert.equal(result.structuredContent.code, code, path);
    assert.equal(result.structuredContent.text, undefined);
  }
});
