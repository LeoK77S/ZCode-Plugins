import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';

test('可信登记的评论状态与文本可同时订阅，独立退订和会话隔离', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'comment-state-')); t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeFile(join(workspaceRoot, 'a.txt'), 'original');
  const calls = [], state = { meta: { status: 'completed' }, runtime: {}, messages: [] };
  const client = await connect(t, { workspaceRoot, hostConnector: async options => ({ call: async (channel, method, args) => { calls.push({ options, channel, method, args }); return method === 'readSessionEvents' ? [] : state; }, close() {} }) });
  const request = (name, session) => client.callTool({ name, arguments: name === 'read_editor_text' ? { path: 'a.txt' } : {}, _meta: { session_id: session } });
  const a = (await request('get_editor_comment_state', 'A')).structuredContent;
  assert.equal(a.state, 'idle');
  assert.match(a.resourceUri, /^ui:\/\/suian-side-editor\/comment-state\/[a-f0-9-]+$/);
  const b = (await request('get_editor_comment_state', 'B')).structuredContent;
  assert.notEqual(a.resourceUri, b.resourceUri);
  const text = (await request('read_editor_text', 'A')).structuredContent;
  await client.subscribeResource({ uri: a.resourceUri }); await client.subscribeResource({ uri: text.resourceUri });
  assert.equal(JSON.parse((await client.readResource({ uri: text.resourceUri })).contents[0].text).text, 'original');
  state.meta.status = 'running'; state.runtime.activeTurnKind = 'regular';
  assert.equal(JSON.parse((await client.readResource({ uri: a.resourceUri })).contents[0].text).state, 'busy');
  await client.unsubscribeResource({ uri: a.resourceUri });
  await assert.rejects(client.readResource({ uri: a.resourceUri }), /未登记/);
  assert.equal(JSON.parse((await client.readResource({ uri: text.resourceUri })).contents[0].text).text, 'original');
  await client.unsubscribeResource({ uri: text.resourceUri });
  await assert.rejects(client.readResource({ uri: text.resourceUri }), /未登记/);
  assert.equal(JSON.parse((await client.readResource({ uri: b.resourceUri })).contents[0].text).state, 'busy');
  assert.ok(calls.every(call => call.options.workspacePath === workspaceRoot));
  assert.ok(calls.some(call => call.options.sessionId === 'A') && calls.some(call => call.options.sessionId === 'B'));
});

test('评论工具拒绝伪造身份，网关未知不冒充空闲且状态资源不泄露聊天正文', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'comment-context-')); t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  let reachable = false, calls = 0;
  const client = await connect(t, { workspaceRoot, hostConnector: async () => {
    calls++; if (!reachable) throw Object.assign(new Error('公共网关尚未配置'), { reasonCode: 'gateway_not_configured' });
    return { call: async (_channel, method) => method === 'readSessionEvents' ? [] : { meta: { status: 'paused' }, runtime: {}, messages: [{ role: 'user', content: '私密普通用户正文' }] }, close() {} };
  } });
  const request = args => client.callTool({ name: 'get_editor_comment_state', arguments: args, _meta: { session_id: 'real' } });
  assert.equal((await request({ sessionId: 'other' })).isError, true); assert.equal(calls, 0);
  const missing = await client.callTool({ name: 'get_editor_comment_state', arguments: {} }); assert.equal(missing.structuredContent.code, 'session_binding_unavailable'); assert.equal(calls, 0);
  const unknown = (await request({})).structuredContent; assert.equal(unknown.state, 'unknown'); assert.match(unknown.reason, /公共网关尚未配置/);
  reachable = true;
  const snapshot = JSON.parse((await client.readResource({ uri: unknown.resourceUri })).contents[0].text);
  assert.equal(snapshot.state, 'unknown'); assert.doesNotMatch(JSON.stringify(snapshot), /私密普通用户正文/);
  await assert.rejects(client.readResource({ uri: 'ui://suian-side-editor/comment-state/guessed-session' }), /未登记/);
});

test('MCP连接关闭同时停止评论与文本订阅，不再读取Host', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'comment-close-')); t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await writeFile(join(workspaceRoot, 'a.txt'), 'text'); let calls = 0;
  const client = await connect(t, { workspaceRoot, hostConnector: async () => ({ call: async (_channel, method) => { calls++; return method === 'readSessionEvents' ? [] : { meta: { status: 'completed' }, runtime: {}, messages: [] }; }, close() {} }) });
  const request = (name, args = {}) => client.callTool({ name, arguments: args, _meta: { session_id: 'close' } });
  const comment = (await request('get_editor_comment_state')).structuredContent, text = (await request('read_editor_text', { path: 'a.txt' })).structuredContent;
  await client.subscribeResource({ uri: comment.resourceUri }); await client.subscribeResource({ uri: text.resourceUri });
  await client.close(); const atClose = calls; await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(calls, atClose);
});

for (const lifecycle of ['unsubscribe', 'close']) test(`评论状态${lifecycle}后握手迟到与已排队刷新不得读取Host`, async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'comment-late-host-')); t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const arrived = Promise.withResolvers(), release = Promise.withResolvers(), lateClosed = Promise.withResolvers();
  const calls = []; let delayed = false, lateConnections = 0;
  const client = await connect(t, { workspaceRoot, hostConnector: async () => {
    const late = delayed;
    if (late) { lateConnections++; arrived.resolve(); await release.promise; }
    return { call: async (_channel, method) => { if (late) calls.push(method); return method === 'readSessionEvents' ? [] : { meta: { status: 'completed' }, runtime: {}, messages: [] }; }, close: () => { if (late) lateClosed.resolve(); } };
  } });
  const uri = (await client.callTool({ name: 'get_editor_comment_state', arguments: {}, _meta: { session_id: 'late' } })).structuredContent.resourceUri;
  delayed = true;
  const pending = Promise.allSettled([client.readResource({ uri }), client.readResource({ uri })]);
  await arrived.promise;
  if (lifecycle === 'unsubscribe') await client.unsubscribeResource({ uri }); else await client.close();
  release.resolve(); await lateClosed.promise; await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [], '失效资源的迟到连接必须立即关闭，不读取会话或启动事件读取服务');
  assert.equal(lateConnections, 1, '已排队刷新不得在资源失效后重新握手');
});

test('评论状态退订后快照回执迟到不得继续读取start-if-needed事件', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'comment-late-snapshot-')); t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const arrived = Promise.withResolvers(), release = Promise.withResolvers(); let delayed = false; const lateCalls = [];
  const client = await connect(t, { workspaceRoot, hostConnector: async () => ({ call: async (_channel, method) => {
    if (delayed) { lateCalls.push(method); if (method === 'getTaskSnapshot') { arrived.resolve(); await release.promise; } }
    return method === 'readSessionEvents' ? [] : { meta: { status: 'completed' }, runtime: {}, messages: [] };
  }, close() {} }) });
  const uri = (await client.callTool({ name: 'get_editor_comment_state', arguments: {}, _meta: { session_id: 'late' } })).structuredContent.resourceUri;
  delayed = true; const pending = client.readResource({ uri }); await arrived.promise;
  await client.unsubscribeResource({ uri }); release.resolve(); await pending;
  assert.deepEqual(lateCalls, ['getTaskSnapshot'], '正在执行的快照无法撤回，但退订后的事件读取不能开始');
});
