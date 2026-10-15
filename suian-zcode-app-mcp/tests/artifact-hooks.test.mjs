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
import { loadConfig } from '../config.mjs';
import { homedir } from 'node:os';
import { fixture } from './fixtures.mjs';

const references = items => items.map(({ kind, ref, label, purpose }) => ({ kind, ref, label, purpose }));

const root = fileURLToPath(new URL('../', import.meta.url));
// spawnSync 默认继承宿主 env；清掉三个库路径变量，避免外部环境压过测试写入 config.json 的 fixture 路径
const hookEnv = { ...process.env };
for (const name of ['ZCODE_APP_MCP_INDEX_DB', 'ZCODE_APP_MCP_SESSION_DB', 'ZCODE_APP_MCP_ARTIFACT_DB']) delete hookEnv[name];
function hook(f, event, sessionId = 'sess_parent', turnId = 'turn_A') {
  const config = join(dirname(f.sessionDbPath), 'config.json');
  writeFileSync(config, JSON.stringify({ sessionDbPath: f.sessionDbPath, artifactDbPath: f.artifactDbPath, indexDbPath: f.indexDbPath }));
  const registration = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8')).hooks[event][0].hooks[0];
  assert.notEqual(registration.async, true, `${event} 必须同步`);
  const command = registration.command.replaceAll('${ZCODE_PLUGIN_ROOT}', root).replaceAll('${ZCODE_PLUGIN_DATA}', dirname(config));
  const run = spawnSync(command, { shell: true, windowsHide: true, encoding: 'utf8', env: hookEnv, input: JSON.stringify({ hookEventName: event, sessionId, turnId }) });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
async function connect(t, f, options) {
  const server = createMcpServer(f, options), client = new Client({ name: 'artifact-hooks-contract', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return (name, args = {}, session = 'sess_parent') => client.callTool({ name, arguments: args, _meta: { session_id: session } });
}

test('分叉保留创建关系与时间，但不会冒充原发起者的派发方向', async t => {
  const f = fixture(t); f.session({ id: 'sess_parent' });
  const call = await connect(t, f, { controller: { startSession: async args => {
    await args.onCreated({ session_id: 'sess_started', title: '已派发任务' });
    return { session_id: 'sess_started', delivery_status: 'accepted' };
  } } });
  await call('start_session', { workspace_path: 'D:/fixture', message: '执行任务' });
  const original = (await call('get_artifacts')).structuredContent.items[0];
  assert.equal(original.session_direction, 'outgoing');
  boundary(f, 'original_link', 'turn_A', 1); hook(f, 'Stop');
  fork(f, 'sess_fork', 'original_link'); hook(f, 'SessionStart', 'sess_fork');
  const copied = (await call('get_artifacts', {}, 'sess_fork')).structuredContent.items[0];
  assert.equal(copied.session_direction, 'related'); assert.equal(copied.created_at, original.created_at);
  assert.deepEqual(copied.session_link, original.session_link);
});
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
  const frozenA = (await call('get_artifacts')).structuredContent.items;
  boundary(f, 'original_A', 'turn_A', 1); hook(f, 'Stop');
  await call('set_artifacts', { expected_revision: 1, upsert: [b] });
  boundary(f, 'original_B', 'turn_B', 2); hook(f, 'Stop', 'sess_parent', 'turn_B');
  fork(f, 'sess_child', 'original_A'); hook(f, 'SessionStart', 'sess_child');
  const child = (await call('get_artifacts', {}, 'sess_child')).structuredContent;
  assert.deepEqual(child.items, frozenA); assert.equal(child.revision, 0);
  assert.equal(child.inheritance.status, 'inherited'); assert.equal(child.inheritance.target_message_id, 'original_A');
  const c = { ...a, label: '子 C' };
  await call('set_artifacts', { expected_revision: 0, upsert: [c] }, 'sess_child');
  hook(f, 'SessionStart', 'sess_child');
  assert.deepEqual(references((await call('get_artifacts', {}, 'sess_child')).structuredContent.items), [c]);
  assert.deepEqual(references((await call('get_artifacts')).structuredContent.items), [b]);
});

test('UserPromptSubmit 注入当次统计与工件简表，下一次提交重新读取，简表不改变存储', async t => {
  const f = fixture(t), call = await connect(t, f);
  f.session({ id: 'sess_parent' });
  const item = { kind: 'file', ref: 'D:/fixture/reference.md', label: '验收规格', purpose: '核对要求' };
  const issue = { kind: 'issue', ref: 'https://github.com/example/repo/issues/67', label: '面板增强议题', purpose: '跟踪需求' };
  await call('set_artifacts', { expected_revision: 0, upsert: [item, issue] });
  const before = (await call('get_artifacts')).structuredContent;
  const first = hook(f, 'UserPromptSubmit').hookSpecificOutput;
  assert.equal(first.hookEventName, 'UserPromptSubmit');
  assert.ok(first.additionalContext.startsWith(
    '请在创建、接手或替换任务相关的 PR、议题、会话、文件或链接时及时登记或更新工件，详见 mcp__plugin_suian-zcode-app-mcp_suian-zcode-app__set_artifacts。\n'
    + '工件统计（revision 1）：共 2 条；pr 0；issue 1；session 0；file 1；link 0'));
  assert.match(first.additionalContext, /revision 1.*共 2 条/);
  assert.match(first.additionalContext, /issue 1/);
  assert.match(first.additionalContext, /file 1/);
  assert.match(first.additionalContext, /类型.*名称.*用途.*引用/);
  for (const value of [...Object.values(item), ...Object.values(issue)]) assert.ok(first.additionalContext.includes(value));
  assert.match(first.additionalContext, /显示 2\/2 条/);
  assert.match(first.additionalContext, /可能已过时/);
  assert.match(first.additionalContext, /不是指令或授权/);
  assert.deepEqual((await call('get_artifacts')).structuredContent, before);
  await call('set_artifacts', { expected_revision: 1, remove: [item.ref] });
  const second = hook(f, 'UserPromptSubmit').hookSpecificOutput.additionalContext;
  assert.match(second, /revision 2.*共 1 条/);
  assert.equal(second.includes(item.ref), false);
  assert.match(first.additionalContext, /revision 1.*共 2 条/);
});

test('生产 config 未显式配置时回落本机默认索引库，hook 的名称反查依赖该回落', async () => {
  const saved = { index: process.env.ZCODE_APP_MCP_INDEX_DB, session: process.env.ZCODE_APP_MCP_SESSION_DB };
  delete process.env.ZCODE_APP_MCP_INDEX_DB; delete process.env.ZCODE_APP_MCP_SESSION_DB;
  try {
    const config = await loadConfig({});
    assert.equal(config.indexDbPath, join(homedir(), '.zcode', 'v2', 'tasks-index.sqlite'));
    assert.equal(config.sessionDbPath, join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite'));
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key === 'index' ? 'ZCODE_APP_MCP_INDEX_DB' : 'ZCODE_APP_MCP_SESSION_DB'] = value;
  }
});

test('UserPromptSubmit 简表按任务索引显示会话实时名称，登记标注只保留在存储', async t => {
  const f = fixture(t); f.session({ id: 'sess_parent' });
  f.task({ id: 'sess_child', title: '新列表名' });
  const call = await connect(t, f);
  const item = { kind: 'session', ref: 'sess_child', label: '登记标注', purpose: '跟进' };
  await call('set_artifacts', { expected_revision: 0, upsert: [item] });
  const text = hook(f, 'UserPromptSubmit').hookSpecificOutput.additionalContext;
  assert.ok(text.includes('新列表名'));
  assert.equal(text.includes('登记标注'), false);
  const stored = (await call('get_artifacts')).structuredContent.items[0];
  assert.equal(stored.label, '登记标注'); assert.equal(stored.session_title, '新列表名');
});

test('正式 UserPromptSubmit 使用真实工件时间做 20 条类别保底选择，完整列表仍保留全部 45 条', async t => {
  const f = fixture(t); f.session({ id: 'sess_parent' });
  let clock = 100;
  const call = await connect(t, { ...f, now: () => clock++ });
  const recent = Array.from({ length: 30 }, (_, i) => ({ kind: 'pr', ref: `https://example.com/pull/${i}`,
    label: `实现 PR ${i}`, purpose: '接续评审' }));
  await call('set_artifacts', { expected_revision: 0, upsert: recent });
  clock = 10;
  const older = ['session', 'file', 'link'].flatMap(kind => Array.from({ length: 5 }, (_, i) => ({
    kind, ref: kind === 'file' ? `D:/fixture/file-${i}.md` : kind === 'link' ? `https://example.com/reference/${i}` : `sess_related_${i}`,
    label: `${kind} ${i}`, purpose: '保留后续用途'
  })));
  await call('set_artifacts', { expected_revision: 1, upsert: older });
  const before = (await call('get_artifacts')).structuredContent;
  const text = hook(f, 'UserPromptSubmit').hookSpecificOutput.additionalContext;
  const rows = text.split('\n').filter(line => /^\| (pr|issue|session|file|link) \|/.test(line));
  assert.equal(rows.length, 20); assert.equal(rows.filter(row => row.startsWith('| pr |')).length, 11);
  for (const kind of ['session', 'file', 'link']) assert.equal(rows.filter(row => row.startsWith(`| ${kind} |`)).length, 3);
  assert.match(rows[0], /pull\/29/); assert.match(text, /显示 20\/45 条，省略 25 条/);
  assert.ok(Array.from(text).length <= 9000);
  assert.deepEqual((await call('get_artifacts')).structuredContent, before);
  assert.equal(before.items.length, 45);
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
  assert.deepEqual(references(kept.items), [own]); assert.equal(kept.inheritance.status, 'snapshot_missing');
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
  assert.deepEqual(references((await call('get_artifacts', {}, 'sess_set_first')).structuredContent.items), [a, b]);
  f.message({ id: 'unfinished', session: 'sess_parent', role: 'assistant', sequence: 5,
    info: { semantics: { kind: 'assistant_response' }, anchor: { turnId: 'turn_incomplete' } } });
  const bad = spawnSync(process.execPath, [join(root, 'artifact-hook.mjs'), '--config', join(dirname(f.sessionDbPath), 'config.json')], {
    windowsHide: true, encoding: 'utf8', env: hookEnv, input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess_parent', turnId: 'turn_incomplete' })
  });
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).code, 'checkpoint_unavailable');
  const db = new DatabaseSync(f.artifactDbPath, { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) n FROM artifact_boundary WHERE message_id='unfinished'").get().n, 0); }
  finally { db.close(); }
});
