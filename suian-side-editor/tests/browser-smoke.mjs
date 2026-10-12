import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';

// 浏览器依赖由开发环境提供，不进入正式 stdio 运行依赖。
const require = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url);
const { chromium } = require('playwright');
const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-browser-'));
const server = createMcpServer({ workspaceRoot, zcodeAppVersion: '3.15.1' });
const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
const [ct, st] = InMemoryTransport.createLinkedPair();
let browser;
try {
  await writeFile(join(workspaceRoot, 'probe.md'), '中文\r\n<img src=x onerror="window.injected=true">\r\n');
  await server.connect(st); await client.connect(ct);
  const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 480, height: 740 } });
  const page = await context.newPage();
  const requests = [], errors = [], calls = [];
  page.on('request', req => requests.push(req.url())); page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('editorCall', async (name, args) => {
    calls.push({ name, args });
    return client.callTool({ name, arguments: args, _meta: { session_id: 'browser-fixture' } });
  });
  await page.addInitScript(() => { window.zcode = { ready: async () => {}, subscribe: () => {}, theme: 'dark', callTool: (name, args) => window.editorCall(name, args) }; });
  await page.goto('about:blank'); await page.setContent(html);
  await page.getByText('已确认宿主归属', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '工作区相对文件路径' }).fill('probe.md');
  await page.getByRole('button', { name: '读取', exact: true }).click();
  await page.getByText('已读取磁盘正文 · 只读', { exact: true }).waitFor();
  assert.equal(await page.locator('#text').textContent(), '中文\r\n<img src=x onerror="window.injected=true">\r\n');
  assert.equal(await page.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('textbox').fill('missing.md'); await page.getByRole('button', { name: '读取', exact: true }).click();
  await page.getByText(/file_not_found/).waitFor(); assert.equal(await page.locator('#text').textContent(), '');
  await page.exposeFunction('editorNoContext', (name, args) => client.callTool({ name, arguments: args }));
  await page.evaluate(() => { window.zcode.callTool = (name, args) => window.editorNoContext(name, args); });
  await page.setContent(html);
  await page.getByText(/session_binding_unavailable/).waitFor();
  assert.equal(await page.getByRole('button', { name: '读取', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  assert.ok(calls.every(call => !('session_id' in call.args) && !('sessionId' in call.args)));
  console.log('浏览器烟测通过：真实资源/SDK、文本安全、错误清理、缺失归属阻止、深色窄栏、零网络请求');
} finally {
  await browser?.close(); await client.close(); await server.close(); await rm(workspaceRoot, { recursive: true });
}
