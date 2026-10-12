import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server.mjs';
import { fixture } from './fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function hook(f, event, sessionId = 'sess_parent', turnId = 'turn_A') {
  const config = join(dirname(f.sessionDbPath), 'config.json');
  writeFileSync(config, JSON.stringify({ sessionDbPath: f.sessionDbPath, artifactDbPath: f.artifactDbPath }));
  const registration = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8')).hooks[event][0].hooks[0];
  assert.notEqual(registration.async, true, `${event} 必须同步`);
  const command = registration.command.replaceAll('${ZCODE_PLUGIN_ROOT}', root).replaceAll('${ZCODE_PLUGIN_DATA}', dirname(config));
  const run = spawnSync(command, { shell: true, windowsHide: true, encoding: 'utf8', input: JSON.stringify({ hookEventName: event, sessionId, turnId }) });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
async function connect(t, f) {
  const server = createMcpServer(f), client = new Client({ name: 'artifact-hooks-contract', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return (name, args = {}, session = 'sess_parent') => client.callTool({ name, arguments: args, _meta: { session_id: session } });
}
function boundary(f, id, turnId, sequence) {
  f.message({ id, session: 'sess_parent', role: 'assistant', sequence,
    info: { time: { completed: 123 }, semantics: { kind: 'assistant_response' }, anchor: { turnId } } });
}
function fork(f, id, boundaryId) {
  f.session({ id, parent: 'sess_parent', taskType: 'fork' });
  f.message({ id: `${id}_notice`, session: id, sequence: 0, role: 'user', info: { semantics: { kind: 'fork_notice', uiVisibility: 'hidden' },
    metadata: { forkOrigin: { parentSessionId: 'sess_parent', targetMessageId: boundaryId } } } });
}

test('同步 Stop 落盘原消息断点，父 A 变 B 后分叉只继承 A，子版本独立且恢复不覆盖', async t => {
  const f = fixture(t), call = await connect(t, f);
  f.session({ id: 'sess_parent' });
  const a = { kind: 'file', ref: 'D:/fixture/A.md', label: '历史 A', purpose: '交付' }, b = { ...a, label: '最新 B' };
  await call('set_artifacts', { expected_revision: 0, upsert: [a] });
  boundary(f, 'original_A', 'turn_A', 1); hook(f, 'Stop');
  await call('set_artifacts', { expected_revision: 1, upsert: [b] });
  boundary(f, 'original_B', 'turn_B', 2); hook(f, 'Stop', 'sess_parent', 'turn_B');
  fork(f, 'sess_child', 'original_A'); hook(f, 'SessionStart', 'sess_child');
  const child = (await call('get_artifacts', {}, 'sess_child')).structuredContent;
  assert.deepEqual(child.items, [a]); assert.equal(child.revision, 0);
  assert.equal(child.inheritance.status, 'inherited'); assert.equal(child.inheritance.target_message_id, 'original_A');
  const c = { ...a, label: '子 C' };
  await call('set_artifacts', { expected_revision: 0, upsert: [c] }, 'sess_child');
  hook(f, 'SessionStart', 'sess_child');
  assert.deepEqual((await call('get_artifacts', {}, 'sess_child')).structuredContent.items, [c]);
  assert.deepEqual((await call('get_artifacts')).structuredContent.items, [b]);
});

test('UserPromptSubmit 只生成一句工具入口与当次统计，不包含详细规则或工件字段，下一次提交读取新统计', async t => {
  const f = fixture(t), call = await connect(t, f);
  f.session({ id: 'sess_parent' });
  const secret = { kind: 'file', ref: 'D:/fixture/private-reference.md', label: 'private-label', purpose: 'private-purpose' };
  await call('set_artifacts', { expected_revision: 0, upsert: [secret] });
  const first = hook(f, 'UserPromptSubmit').hookSpecificOutput;
  assert.equal(first.hookEventName, 'UserPromptSubmit');
  assert.equal(first.additionalContext,
    '请在创建、接手或替换任务相关的 PR、会话、文件或链接时及时登记或更新工件，详见 mcp__plugin_suian-zcode-app-mcp_suian-zcode-app__set_artifacts。\n'
    + '工件统计（revision 1）：共 1 条；pr 0；session 0；file 1；link 0');
  assert.match(first.additionalContext, /revision 1.*共 1 条/);
  assert.match(first.additionalContext, /file 1/);
  for (const value of [secret.ref, secret.label, secret.purpose, '"items"']) assert.equal(first.additionalContext.includes(value), false);
  await call('set_artifacts', { expected_revision: 1, remove: [secret.ref] });
  const second = hook(f, 'UserPromptSubmit').hookSpecificOutput.additionalContext;
  assert.match(second, /revision 2.*共 0 条/);
  assert.match(first.additionalContext, /revision 1.*共 1 条/);
});

test('无变化消息仍映射，同一运行轮的两个 Stop 各自冻结，重放旧 Stop 不改历史', async t => {
  const f = fixture(t), call = await connect(t, f);
  f.session({ id: 'sess_parent' });
  const a = { kind: 'file', ref: 'D:/fixture/A.md', label: 'A', purpose: '接续' };
  await call('set_artifacts', { expected_revision: 0, upsert: [a] });
  boundary(f, 'msg_A', 'turn_A', 1); hook(f, 'Stop');
  boundary(f, 'msg_same', 'turn_same', 2); hook(f, 'Stop', 'sess_parent', 'turn_same');
  await call('set_artifacts', { expected_revision: 1, upsert: [{ ...a, label: 'C' }] });
  boundary(f, 'msg_C', 'turn_repeat', 3); hook(f, 'Stop', 'sess_parent', 'turn_repeat');
  await call('set_artifacts', { expected_revision: 2, upsert: [{ ...a, label: 'D' }] });
  boundary(f, 'msg_D', 'turn_repeat', 4); hook(f, 'Stop', 'sess_parent', 'turn_repeat');
  hook(f, 'Stop');
  const db = new DatabaseSync(f.artifactDbPath, { readOnly: true });
  try {
    const maps = db.prepare('SELECT * FROM artifact_boundary ORDER BY message_id').all();
    assert.equal(maps.length, 4);
    assert.equal(maps.find(row => row.message_id === 'msg_A').snapshot_id, maps.find(row => row.message_id === 'msg_same').snapshot_id);
    assert.notEqual(maps.find(row => row.message_id === 'msg_C').snapshot_id, maps.find(row => row.message_id === 'msg_D').snapshot_id);
  } finally { db.close(); }
  for (const [childId, target, label] of [['sess_old', 'msg_A', 'A'], ['sess_c', 'msg_C', 'C'], ['sess_final', 'msg_D', 'D']]) {
    fork(f, childId, target);
    assert.equal((await call('get_artifacts', {}, childId)).structuredContent.items[0].label, label);
  }
});

test('缺快照显示诊断但允许子 get/set；迟到快照和 SessionStart 不覆盖子更新，普通子不继承', async t => {
  const f = fixture(t), call = await connect(t, f);
  f.session({ id: 'sess_parent' });
  const item = { kind: 'file', ref: 'D:/fixture/current.md', label: '父最新', purpose: '交付' };
  await call('set_artifacts', { expected_revision: 0, upsert: [item] });
  fork(f, 'sess_missing', 'missing_boundary');
  const empty = await call('get_artifacts', {}, 'sess_missing');
  assert.equal(empty.isError, undefined); assert.deepEqual(empty.structuredContent.items, []);
  assert.equal(empty.structuredContent.inheritance.code, 'snapshot_missing');
  const own = { ...item, label: '子自己的工件' };
  const written = await call('set_artifacts', { expected_revision: 0, upsert: [own] }, 'sess_missing');
  assert.equal(written.isError, undefined); assert.equal(written.structuredContent.revision, 1);
  boundary(f, 'missing_boundary', 'turn_late', 3); hook(f, 'Stop', 'sess_parent', 'turn_late');
  hook(f, 'SessionStart', 'sess_missing');
  const kept = (await call('get_artifacts', {}, 'sess_missing')).structuredContent;
  assert.deepEqual(kept.items, [own]); assert.equal(kept.inheritance.status, 'snapshot_missing');
  assert.match(hook(f, 'UserPromptSubmit', 'sess_missing').hookSpecificOutput.additionalContext, /snapshot_missing.*仍可独立读写/);
  f.session({ id: 'sess_ordinary_child', parent: 'sess_parent', taskType: 'agent' });
  const ordinary = (await call('get_artifacts', {}, 'sess_ordinary_child')).structuredContent;
  assert.deepEqual(ordinary.items, []); assert.equal(ordinary.inheritance, undefined);
});

test('首次 set 也先准确继承；未完成或其它轮的消息不充当 Stop 断点', async t => {
  const f = fixture(t), call = await connect(t, f);
  f.session({ id: 'sess_parent' });
  const a = { kind: 'file', ref: 'D:/fixture/A.md', label: 'A', purpose: '交付' };
  await call('set_artifacts', { expected_revision: 0, upsert: [a] });
  boundary(f, 'original', 'turn_A', 1); hook(f, 'Stop');
  fork(f, 'sess_set_first', 'original');
  const b = { ...a, ref: 'D:/fixture/B.md', label: 'B' };
  assert.equal((await call('set_artifacts', { expected_revision: 0, upsert: [b] }, 'sess_set_first')).structuredContent.stats.total, 2);
  assert.deepEqual((await call('get_artifacts', {}, 'sess_set_first')).structuredContent.items, [a, b]);
  f.message({ id: 'unfinished', session: 'sess_parent', role: 'assistant', sequence: 5,
    info: { semantics: { kind: 'assistant_response' }, anchor: { turnId: 'turn_incomplete' } } });
  const bad = spawnSync(process.execPath, [join(root, 'artifact-hook.mjs'), '--config', join(dirname(f.sessionDbPath), 'config.json')], {
    windowsHide: true, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess_parent', turnId: 'turn_incomplete' })
  });
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).code, 'checkpoint_unavailable');
  const db = new DatabaseSync(f.artifactDbPath, { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) n FROM artifact_boundary WHERE message_id='unfinished'").get().n, 0); }
  finally { db.close(); }
});
