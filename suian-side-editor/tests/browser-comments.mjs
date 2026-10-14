import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';
import { EDITOR_URI } from '../server.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';
import { commentHost } from './comment-host-fixture.mjs';

const require = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url);
const { chromium } = require('playwright');
async function fixture(t, { failPublish = false, holdPublish = false, restoreMissing = false, historyFailure } = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-comment-')), dataPath = await mkdtemp(join(tmpdir(), 'side-comment-data-'));
  t.after(() => Promise.all([rm(workspaceRoot, { recursive: true, force: true }), rm(dataPath, { recursive: true, force: true })]));
  await writeFile(join(workspaceRoot, 'alpha.txt'), 'first\nsecond\nthird');
  const state = { meta: { taskId: 'comment-fixture', status: 'completed' }, runtime: {}, messages: [] };
  const hostCalls = [], calls = [], capsules = [], events = [];
  let connectionError, releasePublish, publishStarted;
  const publishReady = new Promise(resolve => { publishStarted = resolve; });
  let observedQueue = false;
  const hostConnector = async options => { if (connectionError) throw new Error(connectionError); return commentHost({ options, state, events, onCall: call => hostCalls.push(call),
    ...(historyFailure ? { page(_query, snapshot) {
      if (snapshot.queue.items.length) {
        observedQueue = true; events.splice(0);
        if (historyFailure === 'page-error') throw new Error('完整队列快照后的确定性历史页失败');
        return { rows: [], atSeq: snapshot.seq + 1, atRevision: snapshot.revision + 1, atLogEpoch: snapshot.logEpoch, hasMore: false };
      }
      return { rows: [], atSeq: snapshot.seq, atRevision: snapshot.revision, atLogEpoch: snapshot.logEpoch, hasMore: false };
    } } : {}) }); };
  const client = await connect(t, { workspaceRoot, dataPath, hostConnector });
  if (restoreMissing) {
    const file = (await client.callTool({ name: 'read_editor_text', arguments: { path: 'alpha.txt' }, _meta: { session_id: 'comment-fixture' } })).structuredContent;
    await client.callTool({ name: 'update_editor_state', arguments: { state: { files: [{ path: 'alpha.txt', fixed: true, scrollTop: 0, scrollLeft: 0, draft: { text: 'first\n恢复脏正文\nthird', diskText: file.text, baseVersion: file.version, encoding: file.encoding } }], currentPath: 'alpha.txt' } }, _meta: { session_id: 'comment-fixture' } });
    await rm(join(workspaceRoot, 'alpha.txt'));
  }
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(2000);
  await page.exposeFunction('editorCall', async (name, args) => { const entry = { name, args }; calls.push(entry); entry.result = await client.callTool({ name, arguments: args, _meta: { session_id: 'comment-fixture' } }); return entry.result; });
  await page.exposeFunction('publishComments', payload => { if (failPublish) { failPublish = false; throw new Error('胶囊更新失败'); } capsules.push(payload); publishStarted(); if (holdPublish) { holdPublish = false; return new Promise(resolve => { releasePublish = resolve; }); } return {}; });
  const resources = await installResourceBridge(page, client);
  await page.addInitScript(() => { window.zcode.updateModelContext = payload => window.publishComments(payload); });
  await page.goto('about:blank'); await page.setContent((await client.readResource({ uri: EDITOR_URI })).contents[0].text);
  if (!restoreMissing) {
    await page.getByRole('button', { name: '文件列表', exact: true }).click();
    await page.getByRole('treeitem', { name: 'alpha.txt', exact: true }).click();
  } else await page.getByRole('button', { name: '保存方式', exact: true }).getByText('手动保存', { exact: true }).waitFor();
  const content = page.getByRole('textbox', { name: '文件正文', exact: true }); await content.waitFor();
  async function select() { await content.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); }
  async function refresh() { return JSON.parse((await client.readResource({ uri: calls.find(call => call.name === 'get_editor_comment_state').result.structuredContent.resourceUri })).contents[0].text); }
  return { page, content, select, state, events, hostCalls, calls, capsules, resources, workspaceRoot, client, refresh, publishReady, observedQueue: () => observedQueue, disconnect: message => { connectionError = message; }, releasePublish: () => releasePublish({}) };
}

test('实际选区创建完整未保存快照，单胶囊聚合且继续编辑不改写评论', async t => {
  const f = await fixture(t);
  await f.content.focus(); await f.page.keyboard.press('Control+End'); await f.page.keyboard.type(' unsaved'); await f.select();
  await f.page.getByRole('button', { name: '评论选区', exact: true }).click();
  await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill('请检查这行');
  await f.page.getByRole('button', { name: '加入主对话', exact: true }).click();
  await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor();
  assert.equal(f.capsules.length, 1);
  const comment = f.capsules[0].structuredContent.comments[0];
  assert.deepEqual({ sessionId: comment.sessionId, workspacePath: comment.workspacePath, path: comment.path, title: comment.title, startLine: comment.startLine, endLine: comment.endLine, selectedText: comment.selectedText, comment: comment.comment, unsaved: comment.unsaved },
    { sessionId: 'comment-fixture', workspacePath: f.workspaceRoot, path: join(f.workspaceRoot, 'alpha.txt'), title: 'alpha.txt', startLine: 2, endLine: 2, selectedText: 'second', comment: '请检查这行', unsaved: true });
  assert.match(comment.commentId, /^[0-9a-f-]{36}$/); assert.match(f.capsules[0].structuredContent.batchId, /^[0-9a-f-]{36}$/);
  assert.ok(f.capsules[0].content[0].text.includes(JSON.stringify(f.capsules[0].structuredContent)), '完整字段进入实际文字正文');
  await f.content.focus(); await f.page.keyboard.press('Control+End'); await f.page.keyboard.type(' later'); await f.select();
  await f.page.getByRole('button', { name: '评论选区', exact: true }).click(); await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill('第二条'); await f.page.getByRole('button', { name: '加入主对话', exact: true }).click();
  await f.page.getByText('待发送评论 2 条', { exact: true }).waitFor();
  assert.deepEqual(f.capsules[1].structuredContent.comments[0], comment);
  assert.equal(f.calls.filter(call => call.name === 'save_editor_text').length, 0);
});

test('评论状态退订被拒绝时留下可观察错误记录', async t => {
  const f = await fixture(t);
  const uri = f.calls.find(call => call.name === 'get_editor_comment_state').result.structuredContent.resourceUri;
  await f.page.evaluate(uri => { const original = window.zcode.unsubscribeResource; window.zcode.unsubscribeResource = target => target === uri ? Promise.reject(new Error('测试评论退订拒绝')) : original(target); }, uri);
  const diagnostic = f.page.waitForEvent('console', { predicate: message => message.type() === 'error' && message.text().includes('评论状态退订失败') && message.text().includes('测试评论退订拒绝') });
  await f.page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await diagnostic;
});

test('源读取失败的恢复脏正文没有可信完整路径时禁止评论，编辑与副本仍可继续', async t => {
  const f = await fixture(t, { restoreMissing: true }); await f.select();
  const button = f.page.getByRole('button', { name: '评论选区', exact: true });
  assert.equal(await button.isDisabled(), true, '只恢复relativePath不能提供完整可信path');
  assert.match(await button.getAttribute('title'), /未取得文件的可信完整路径/);
  assert.equal(f.capsules.length, 0);
  assert.match(await f.content.innerText(), /恢复脏正文/);
  await f.content.focus(); await f.page.keyboard.press('Control+End'); await f.page.keyboard.type(' continued');
  await f.page.getByText('恢复副本已同步', { exact: true }).waitFor();
  const state = (await f.client.callTool({ name: 'get_editor_state', arguments: {}, _meta: { session_id: 'comment-fixture' } })).structuredContent.state;
  assert.equal(state.files[0].draft.text, 'first\n恢复脏正文\nthird continued');
});

test('完整评论保留用户输入空白，空白正文不提交', async t => {
  const f = await fixture(t); await f.select();
  await f.page.getByRole('button', { name: '评论选区', exact: true }).click();
  const input = f.page.getByRole('textbox', { name: '评论内容', exact: true }), submit = f.page.getByRole('button', { name: '加入主对话', exact: true });
  await input.fill('  \n'); assert.equal(await submit.isDisabled(), true);
  await input.fill('  保留缩进\n下一行  '); await submit.click(); await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor();
  assert.equal(f.capsules[0].structuredContent.comments[0].comment, '  保留缩进\n下一行  ');
});

test('胶囊更新ACK迟到时已受理批次不复活，重连重复事件保持幂等', async t => {
  const f = await fixture(t, { holdPublish: true }); await f.select();
  await f.page.getByRole('button', { name: '评论选区', exact: true }).click(); await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill('迟到A'); await f.page.getByRole('button', { name: '加入主对话', exact: true }).click();
  await f.publishReady;
  f.events.push({ eventId: 'start-A', sessionId: 'comment-fixture', seq: 1, type: 'turn.started', payload: { input: f.capsules[0].content[0].text } }); await f.refresh();
  f.releasePublish(); await f.page.getByText('待发送评论 0 条', { exact: true }).waitFor();
  f.disconnect('短暂断连'); await f.refresh(); await f.page.getByText(/短暂断连/).first().waitFor();
  f.disconnect(undefined); await f.refresh(); await f.page.getByText('待发送评论 0 条', { exact: true }).waitFor();
  await f.select(); await f.page.getByRole('button', { name: '评论选区', exact: true }).click(); await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill('重连B'); await f.page.getByRole('button', { name: '加入主对话', exact: true }).click();
  await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor(); assert.deepEqual(f.capsules.at(-1).structuredContent.comments.map(comment => comment.comment), ['重连B']);
});

test('真实会话资源尽力禁用入口和已开表单，保留正文，断连仍可编辑保存', async t => {
  const f = await fixture(t); await f.select();
  await f.page.getByRole('button', { name: '评论选区', exact: true }).click();
  await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill('尚未提交');
  f.state.meta.status = 'running'; f.state.runtime.activeTurnKind = 'regular'; await f.refresh();
  await f.page.waitForFunction(() => document.getElementById('comment-submit').disabled);
  assert.match(await f.page.getByRole('button', { name: '加入主对话', exact: true }).getAttribute('title'), /主对话正在处理输入.*避免新增评论.*尽力/);
  assert.equal(await f.page.getByRole('button', { name: '评论选区', exact: true }).isDisabled(), true);
  assert.equal(await f.page.getByRole('textbox', { name: '评论内容', exact: true }).inputValue(), '尚未提交');
  f.state.meta.status = 'completed'; delete f.state.runtime.activeTurnKind; await f.refresh();
  await f.page.waitForFunction(() => !document.getElementById('comment-submit').disabled);
  f.disconnect('测试网关已断开'); await f.refresh();
  await f.page.waitForFunction(() => document.getElementById('comment-submit').disabled);
  assert.match(await f.page.getByRole('button', { name: '加入主对话', exact: true }).getAttribute('title'), /测试网关已断开/);
  await f.page.getByRole('button', { name: '取消评论', exact: true }).click();
  await f.content.focus(); await f.page.keyboard.press('Control+End'); await f.page.keyboard.type(' after disconnect'); await f.page.getByRole('button', { name: '保存', exact: true }).click();
  await f.page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(f.calls.filter(call => call.name === 'get_editor_comment_state').length, 1, '状态更新不反复tools/call审批');
});

test('失败与残缺正文保留，完整批次受理清理，晚到旧回执不复活A或清除B', async t => {
  const f = await fixture(t, { failPublish: true }); await f.select();
  const add = async text => { await f.page.getByRole('button', { name: '评论选区', exact: true }).click(); await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill(text); await f.page.getByRole('button', { name: '加入主对话', exact: true }).click(); };
  await add('A'); await f.page.getByText(/加入主对话失败，评论已保留/).waitFor();
  assert.equal(await f.page.getByRole('textbox', { name: '评论内容', exact: true }).inputValue(), 'A');
  await f.page.getByRole('button', { name: '加入主对话', exact: true }).click(); await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor();
  const a = f.capsules[0], aText = a.content[0].text;
  f.state.messages = [{ role: 'assistant', content: aText }, { role: 'user', content: aText, bodyRefs: [{ field: 'content', refId: 'truncated' }] }]; await f.refresh();
  assert.equal(await f.page.getByText('待发送评论 1 条', { exact: true }).count(), 1);
  f.state.messages = [{ role: 'user', content: aText.replace('"comment":"A"', '"comment":"different"') }]; await f.refresh();
  assert.equal(await f.page.getByText('待发送评论 1 条', { exact: true }).count(), 1, '相同ID不同正文不能清理');
  f.state.messages = [{ role: 'user', content: `用户正文\n${aText}` }]; await f.refresh();
  await f.page.getByText('待发送评论 0 条', { exact: true }).waitFor();
  await f.select(); await add('B'); await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor();
  assert.deepEqual(f.capsules.at(-1).structuredContent.comments.map(comment => comment.comment), ['B']);
  await f.refresh(); assert.equal(await f.page.getByText('待发送评论 1 条', { exact: true }).count(), 1);
  const bText = f.capsules.at(-1).content[0].text;
  f.events.push({ eventId: 'queued-1', sessionId: 'comment-fixture', seq: 1, timestamp: 1, type: 'turn.steerQueued', payload: { input: bText } }); await f.refresh();
  await f.page.getByText('待发送评论 0 条', { exact: true }).waitFor();
  assert.ok(f.hostCalls.some(call => call.channel === 'zcode-agent' && call.method === 'subscribeConversationV4'));
  assert.ok(!f.hostCalls.some(call => call.method === 'readSessionEvents'));
  assert.equal(f.capsules.length, 2, '受理观察不会定时重发胶囊');
});

test('断连期间A受理并退出60行快照与200行历史页，重连完整分页后B胶囊只有B', async t => {
  const f = await fixture(t);
  const add = async comment => { await f.select(); await f.page.getByRole('button', { name: '评论选区', exact: true }).click(); await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill(comment); await f.page.getByRole('button', { name: '加入主对话', exact: true }).click(); await f.page.getByRole('dialog', { name: '选区评论', exact: true }).waitFor({ state: 'hidden' }); };
  await add('A 已发送'); await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor();
  const aText = f.capsules[0].content[0].text;
  f.disconnect('确定性断开观察连接'); assert.equal((await f.refresh()).state, 'unknown');
  await f.page.waitForFunction(() => document.getElementById('comment-status').textContent.includes('确定性断开'));
  assert.equal(await f.page.getByRole('button', { name: '评论选区', exact: true }).isDisabled(), true);
  f.state.messages.push({ role: 'user', content: aText, timestamp: 1 });
  f.events.push({ eventId: 'accepted-A', sessionId: 'comment-fixture', seq: 1, timestamp: 1, type: 'turn.started', payload: { input: aText } });
  for (let i = 0; i < 201; i++) f.events.push({ eventId: `later-${i}`, sessionId: 'comment-fixture', seq: i + 2, timestamp: i + 2, type: 'tool.updated', payload: {} });
  for (let i = 0; i < 260; i++) f.state.messages.push({ role: i % 2 ? 'assistant' : 'user', content: `普通后续正文 ${i}`, timestamp: i + 2 });
  assert.ok(!f.events.slice(-200).some(event => event.payload.input === aText)); assert.ok(!f.state.messages.slice(-20).some(message => message.content === aText));
  f.disconnect(undefined); assert.equal((await f.refresh()).state, 'idle');
  assert.ok(f.hostCalls.some(call => call.method === 'conversationRowsRangeV4' && call.args[0].beforeRowId !== undefined), '必须读取尾页以前的完整历史，队列已空');
  await add('B 新评论');
  assert.deepEqual(f.capsules.at(-1).structuredContent.comments.map(comment => comment.comment), ['B 新评论']);
  await f.refresh(); await f.page.getByText('待发送评论 1 条', { exact: true }).waitFor();
});

for (const historyFailure of ['watermark', 'page-error']) test(`已完整观测队列A后历史${historyFailure}，恢复后B胶囊不得带回A`, async t => {
  const f = await fixture(t, { historyFailure });
  const add = async comment => { await f.select(); await f.page.getByRole('button', { name: '评论选区', exact: true }).click(); await f.page.getByRole('textbox', { name: '评论内容', exact: true }).fill(comment); await f.page.getByRole('button', { name: '加入主对话', exact: true }).click(); await f.page.getByRole('dialog', { name: '选区评论', exact: true }).waitFor({ state: 'hidden' }); };
  await add('A 已排队'); const a = f.capsules[0];
  f.events.push({ eventId: 'owned-A', sessionId: 'comment-fixture', seq: 1, type: 'turn.steerQueued', payload: { input: a.content[0].text } });
  const broken = await f.refresh(); assert.equal(broken.state, 'unknown'); assert.equal(f.observedQueue(), true, '已完整编码发送队列A，之后页读取才失败');
  const recovered = await f.refresh(); assert.equal(recovered.state, 'idle');
  await add('B 新评论'); assert.deepEqual(f.capsules.at(-1).structuredContent.comments.map(comment => comment.comment), ['B 新评论']);
});
