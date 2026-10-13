import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';
import { EDITOR_URI } from '../server.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const require = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url);
const { chromium } = require('playwright');
async function fixture(t, { failPublish = false, holdPublish = false } = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-comment-')), dataPath = await mkdtemp(join(tmpdir(), 'side-comment-data-'));
  t.after(() => Promise.all([rm(workspaceRoot, { recursive: true, force: true }), rm(dataPath, { recursive: true, force: true })]));
  await writeFile(join(workspaceRoot, 'alpha.txt'), 'first\nsecond\nthird');
  const state = { meta: { taskId: 'comment-fixture', status: 'completed' }, runtime: {}, messages: [] };
  const hostCalls = [], calls = [], capsules = [], events = [];
  let connectionError, releasePublish, publishStarted;
  const publishReady = new Promise(resolve => { publishStarted = resolve; });
  const hostConnector = async options => { if (connectionError) throw new Error(connectionError); return { call: async (channel, method, args) => { hostCalls.push({ options, channel, method, args }); return method === 'readSessionEvents' ? events : state; }, close() {} }; };
  const client = await connect(t, { workspaceRoot, dataPath, hostConnector });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(2000);
  await page.exposeFunction('editorCall', async (name, args) => { const entry = { name, args }; calls.push(entry); entry.result = await client.callTool({ name, arguments: args, _meta: { session_id: 'comment-fixture' } }); return entry.result; });
  await page.exposeFunction('publishComments', payload => { if (failPublish) { failPublish = false; throw new Error('胶囊更新失败'); } capsules.push(payload); publishStarted(); if (holdPublish) { holdPublish = false; return new Promise(resolve => { releasePublish = resolve; }); } return {}; });
  const resources = await installResourceBridge(page, client);
  await page.addInitScript(() => { window.zcode.updateModelContext = payload => window.publishComments(payload); });
  await page.goto('about:blank'); await page.setContent((await client.readResource({ uri: EDITOR_URI })).contents[0].text);
  await page.getByRole('button', { name: '文件列表', exact: true }).click();
  await page.getByRole('treeitem', { name: 'alpha.txt', exact: true }).click();
  const content = page.getByRole('textbox', { name: '文件正文', exact: true }); await content.waitFor();
  async function select() { await content.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); }
  async function refresh() { await client.readResource({ uri: calls.find(call => call.name === 'get_editor_comment_state').result.structuredContent.resourceUri }); }
  return { page, content, select, state, events, hostCalls, calls, capsules, resources, workspaceRoot, client, refresh, publishReady, disconnect: message => { connectionError = message; }, releasePublish: () => releasePublish({}) };
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
  assert.ok(f.hostCalls.some(call => call.channel === 'zcode-agent' && call.method === 'readSessionEvents'));
  assert.equal(f.capsules.length, 2, '受理观察不会定时重发胶囊');
});
