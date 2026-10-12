import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';

test('工作区来自启动绑定；会话来自宿主 meta，页面无法指定目标归属', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-context-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const client = await connect(t, { workspaceRoot });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.find(item => item.name === 'get_editor_context')._meta.ui.visibility, ['app']);
  let result = await client.callTool({ name: 'get_editor_context', arguments: {} });
  assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'session_binding_unavailable');
  result = await client.callTool({ name: 'get_editor_context', arguments: {}, _meta: { session_id: 'test-session-a' } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.sessionId, 'test-session-a');
  assert.equal(result.structuredContent.workspacePath.toLowerCase(), workspaceRoot.toLowerCase());
  assert.match(result.structuredContent.workspaceIdentity, /^sha256:[a-f0-9]{64}$/);
  result = await client.callTool({ name: 'get_editor_context', arguments: { session_id: 'spoofed' }, _meta: { session_id: 'test-session-a' } });
  assert.equal(result.isError, true);
});

test('缺失工作区与冲突会话都阻止读取；不使用 cwd、trace 或最近会话兜底', async t => {
  const client = await connect(t, { workspaceRoot: 'relative-workspace' });
  let result = await client.callTool({ name: 'get_editor_context', arguments: {}, _meta: { session_id: 'bound-a' } });
  assert.equal(result.structuredContent.code, 'workspace_binding_unavailable');
  result = await client.callTool({ name: 'read_editor_text', arguments: { path: 'README.md' }, _meta: { trace_id: 'not-session-id' } });
  assert.equal(result.structuredContent.code, 'session_binding_unavailable');
  result = await client.callTool({ name: 'read_editor_text', arguments: { path: 'README.md' }, _meta: { session_id: 'a', 'com.zcode/request-context': { session_id: 'b' } } });
  assert.equal(result.structuredContent.code, 'session_binding_invalid');
  for (const meta of [{ session_id: ' ' }, { session_id: 42 }, { session_id: 'a', 'com.zcode/request-context': [] }]) {
    result = await client.callTool({ name: 'get_editor_context', arguments: {}, _meta: meta });
    assert.equal(result.structuredContent.code, 'session_binding_invalid');
  }
});

test('同工作区不同会话保留不同身份；嵌套宿主 meta 合法，页面工作区字段不覆盖启动绑定', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-sessions-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const client = await connect(t, { workspaceRoot });
  const a = await client.callTool({ name: 'get_editor_context', arguments: {}, _meta: { 'com.zcode/request-context': { session_id: 'a' }, workspace_path: 'untrusted-other' } });
  const b = await client.callTool({ name: 'get_editor_context', arguments: {}, _meta: { session_id: 'b' } });
  assert.equal(a.structuredContent.sessionId, 'a'); assert.equal(b.structuredContent.sessionId, 'b');
  assert.equal(a.structuredContent.workspaceIdentity, b.structuredContent.workspaceIdentity);
  assert.equal(a.structuredContent.workspacePath.toLowerCase(), workspaceRoot.toLowerCase());
});
