import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');

async function withEditor(action, { openingToolHold = false, openingResourceHold = false, fixed = true, supported = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-resource-ui-'));
  const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath);
  for (const name of ['first.txt', 'second.txt']) await writeFile(join(workspaceRoot, name), 'original\n');
  const server = createMcpServer({ workspaceRoot, dataPath, zcodeAppVersion: '3.15.1' });
  const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  let browser;
  try {
    await server.connect(st); await client.connect(ct);
    const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(1800); await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    const holds = new Map(), tools = [], errors = [];
    const hold = name => {
      const token = {}; token.ready = new Promise(resolve => { token.arrived = resolve; });
      holds.set(name, token); return token;
    };
    const waitReply = (name, result) => {
      const token = holds.get(name);
      if (!token) return result;
      holds.delete(name);
      return new Promise(resolve => { token.release = () => resolve(result); token.arrived(); });
    };
    const initial = openingToolHold ? hold('read_editor_text') : openingResourceHold ? hold('resources/read') : undefined;
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('editorCall', async (name, args) => {
      const result = await client.callTool({ name, arguments: args, _meta: { session_id: 'resource-ui-fixture' } });
      tools.push({ name, args, result }); return waitReply(name, result);
    });
    const resources = await installResourceBridge(page, client, { supported, read: result => waitReply('resources/read', result) });
    await page.goto('data:text/html,<!doctype html><html><body></body></html>'); await page.setContent(html);
    const mode = page.getByRole('button', { name: '保存方式', exact: true });
    if (supported) {
      await mode.getByText('手动保存', { exact: true }).waitFor();
      await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
      await page.getByRole('button', { name: '文件列表', exact: true }).click();
      await page.getByRole('treeitem', { name: 'first.txt', exact: true })[fixed && !initial ? 'dblclick' : 'click']();
      if (initial) await initial.ready;
      else if (fixed) await page.waitForFunction(() => getComputedStyle(document.querySelector('[role=tab] .tab-title')).fontStyle === 'normal');
      else await page.getByRole('textbox', { name: '文件正文', exact: true }).waitFor();
    } else await page.getByText(/宿主不支持资源订阅/).waitFor();
    const content = page.getByRole('textbox', { name: '文件正文', exact: true });
    const uri = () => tools.find(call => call.name === 'read_editor_text').result.structuredContent.resourceUri;
    async function append(text) { await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(text); }
    const write = text => writeFile(join(workspaceRoot, 'first.txt'), text);
    async function publish(text) { await write(text); await client.readResource({ uri: uri() }); }
    await action({ page, content, mode, client, tools, resources, uri, hold, initial, append, write, publish });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
}

test('临时文件被替换和内部关闭都退订，不保留旧文件的资源登记', async () => {
  await withEditor(async ({ page, client, resources, uri }) => {
    const first = uri();
    await page.getByRole('treeitem', { name: 'second.txt', exact: true }).click();
    await page.getByRole('tab', { name: 'second.txt', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 1);
    await assert.rejects(client.readResource({ uri: first }), /未登记/);
    await page.getByRole('treeitem', { name: 'second.txt', exact: true }).dblclick();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role=tab] .tab-title')).fontStyle === 'normal');
    await page.getByRole('button', { name: '关闭 second.txt', exact: true }).click();
    await page.getByText('从文件列表选择文本').waitFor();
    assert.equal(resources.filter(call => call.method === 'resources/unsubscribe').length, 2);
  }, { fixed: false });
});

test('收到公开 pagehide 生命周期事件时取消监听并发出退订，实际实例销毁由宿主完成', async () => {
  await withEditor(async ({ page, client, resources, uri }) => {
    const opened = uri();
    // 标准生命周期事件是公开边界；不把销毁后异步绑定失效当成 Native dispose 的替代。
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.clock.runFor(1);
    assert.equal(resources.filter(call => call.method === 'resources/unsubscribe').length, 1);
    await assert.rejects(client.readResource({ uri: opened }), /未登记/);
    await page.goto('about:blank');
  });
});

test('首次受审工具回执等待时发生外改，订阅后补读当前资源而不追加工具读取', async () => {
  await withEditor(async ({ content, tools, initial, write }) => {
    await write('between-open-and-subscribe\n'); initial.release();
    await content.filter({ hasText: 'between-open-and-subscribe' }).waitFor();
    assert.equal(tools.filter(call => call.name === 'read_editor_text').length, 1);
  }, { openingToolHold: true });
});

test('旧资源读晚于本页保存回执到达，不回退已保存正文或清除保存期间新增输入', async () => {
  await withEditor(async ({ page, content, append, initial }) => {
    await append('saved'); await page.keyboard.press('Control+s');
    await page.getByText('已保存', { exact: true }).waitFor();
    await append('new-edit'); initial.release(); await page.clock.runFor(1);
    await page.getByText('未保存', { exact: true }).waitFor();
    assert.ok((await content.textContent()).endsWith('savednew-edit'));
    assert.equal(await page.getByText(/磁盘内容已改变/).count(), 0);
  }, { openingResourceHold: true });
});

test('保存等待时到达的真实资源通知，在保存回执后仍核对外部最新正文', async () => {
  await withEditor(async ({ page, content, append, hold, publish, resources }) => {
    const saving = hold('save_editor_text'); await append('local'); await page.keyboard.press('Control+s'); await saving.ready;
    const before = resources.filter(call => call.method === 'resources/read').length;
    await publish('external-after-own-write\n'); await page.clock.runFor(1);
    assert.equal(resources.filter(call => call.method === 'resources/read').length, before, '保存等待中只记住通知，不读入旧响应');
    saving.release(); await content.filter({ hasText: 'external-after-own-write' }).waitFor();
  });
});

test('确认重新读取等待时到达的新通知，旧工具回执之后仍刷新到磁盘最新正文', async () => {
  await withEditor(async ({ page, content, append, hold, publish }) => {
    await append('local'); await publish('external-before-reload\n'); await page.getByText(/磁盘内容已改变/).waitFor();
    const reloading = hold('read_editor_text');
    await page.getByRole('button', { name: '重新读取', exact: true }).click();
    await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click(); await reloading.ready;
    await publish('external-during-reload\n'); await page.clock.runFor(1); reloading.release();
    await content.filter({ hasText: 'external-during-reload' }).waitFor();
  });
});

test('缺资源订阅能力明确阻止初始化，不静默使用受审工具轮询', async () => {
  await withEditor(async ({ page, tools, resources }) => {
    assert.equal(await page.getByRole('button', { name: '文件列表', exact: true }).isDisabled(), true);
    assert.equal(tools.filter(call => call.name === 'read_editor_text').length, 0);
    assert.deepEqual(resources, []);
  }, { supported: false });
});
