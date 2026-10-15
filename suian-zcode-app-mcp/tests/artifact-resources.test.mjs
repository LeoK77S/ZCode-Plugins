import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { fixture } from './fixtures.mjs';
import { createArtifactStore } from '../artifacts.mjs';

const RESOURCE_URI = 'suian-artifacts://current';
const entry = { kind: 'link', ref: 'https://example.com/issue-54', label: '实施票', purpose: '本次实施工单' };

async function pair(t, f, controller) {
  const { createMcpServer } = await import('../server.mjs');
  const server = createMcpServer(f, controller);
  const client = new Client({ name: 'artifact-resources-contract', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return { server, client };
}

// InMemoryTransport 下的通知与工具响应到达顺序不保证，轮询等待而非固定延时
async function waitFor(condition, label = '条件') {
  for (let i = 0; i < 50; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 4));
  }
  assert.ok(condition(), `等待超时：${label}`);
}

test('宣告资源订阅能力并暴露工件资源条目', async t => {
  const f = fixture(t);
  const { client } = await pair(t, f);
  assert.equal(client.getServerCapabilities()?.resources?.subscribe, true);
  const listed = await client.listResources();
  const entry = listed.resources.find(resource => resource.uri === RESOURCE_URI);
  assert.ok(entry, 'resources/list 必须包含工件资源条目');
  assert.equal(entry.mimeType, 'application/json');
});

test('资源 read 按请求上下文返回当前会话工件，缺上下文时返回说明而非报错', async t => {
  const f = fixture(t);
  const { client } = await pair(t, f);
  await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0, upsert: [entry] },
    _meta: { session_id: 'sess_panel' } });
  const withContext = await client.readResource({ uri: RESOURCE_URI, _meta: { session_id: 'sess_panel' } });
  const state = JSON.parse(withContext.contents[0].text);
  assert.equal(state.revision, 1);
  assert.equal(state.items[0].ref, entry.ref);
  const withoutContext = await client.readResource({ uri: RESOURCE_URI });
  assert.equal(withoutContext.contents.length, 1);
  const fallback = JSON.parse(withoutContext.contents[0].text);
  assert.equal(typeof fallback.error, 'string');
});

test('订阅后 set_artifacts 变更推送 updated 通知，宿主扩展参数被容忍，无变更与退订后不再推送', async t => {
  const f = fixture(t);
  const { client } = await pair(t, f);
  const updates = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, notification => updates.push(notification.params));
  // 宿主（ZCode agent）发来的 subscribe 会携带归属扩展参数，服务端必须容忍
  await client.subscribeResource({ uri: RESOURCE_URI, _meta: { session_id: 'sess_panel' }, scopeId: 'scope-1', generation: 3 });
  await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0, upsert: [entry] },
    _meta: { session_id: 'sess_panel' } });
  await waitFor(() => updates.length >= 1);
  assert.deepEqual(updates, [{ uri: RESOURCE_URI }]);
  await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 1, upsert: [{ ...entry, purpose: entry.purpose }] },
    _meta: { session_id: 'sess_panel' } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(updates.length, 1, '内容完全相同的 upsert 不推送通知');
  await client.unsubscribeResource({ uri: RESOURCE_URI });
  await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 1, upsert: [{ ...entry, label: '实施票（更名）' }] },
    _meta: { session_id: 'sess_panel' } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(updates.length, 1, '退订后不再推送通知');
});

test('store 层通知仅在发生实际写入时触发，未注入 notify 时静默', async t => {
  const f = fixture(t);
  const notified = [];
  const store = createArtifactStore({ ...f, now: () => 1, notify: () => notified.push('called') });
  store.set('sess_a', { expected_revision: 0, upsert: [entry] });
  assert.deepEqual(notified, ['called']);
  store.set('sess_a', { expected_revision: 1, upsert: [entry] });
  assert.equal(notified.length, 1, '内容完全相同的 upsert 不触发通知');
  store.linkSessions({ creator: 'sess_a', created: 'sess_b', creatorLabel: '甲', createdLabel: '乙' });
  assert.equal(notified.length, 3, 'linkSessions 两侧写入各触发一次');
  const quiet = createArtifactStore({ ...f, now: () => 1 });
  quiet.set('sess_c', { expected_revision: 0, upsert: [entry] });
  quiet.linkSessions({ creator: 'sess_c', created: 'sess_d', creatorLabel: '甲', createdLabel: '乙' });
});
