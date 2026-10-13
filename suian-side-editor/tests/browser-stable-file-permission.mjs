import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');

test('首次允许打开稳定文件后，空闲检查不得继续发出受审的读取工具调用', async () => {
  const startedAt = performance.now();
  const root = await mkdtemp(join(tmpdir(), 'side-editor-stable-permission-'));
  const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath);
  await writeFile(join(workspaceRoot, 'stable.txt'), 'stable text\n');
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
    const calls = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('editorCall', async (name, args) => {
      // 记录真实页面经过公开桥接发出的每次请求，不预设宿主永久授权或跳过审批。
      calls.push({ name, args });
      return client.callTool({ name, arguments: args, _meta: { session_id: 'stable-permission-fixture' } });
    });
    const resources = await installResourceBridge(page, client);
    await page.goto('about:blank'); await page.setContent(html);
    await page.getByRole('button', { name: '保存方式', exact: true }).getByText('手动保存', { exact: true }).waitFor();
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    await page.getByRole('button', { name: '文件列表', exact: true }).click();
    await page.getByRole('treeitem', { name: 'stable.txt', exact: true }).click();
    await page.getByRole('textbox', { name: '文件正文', exact: true }).waitFor();
    assert.equal(await page.locator('.cm-line').first().textContent(), 'stable text');
    const reads = () => calls.filter(call => call.name === 'read_editor_text');
    assert.equal(reads().length, 1, '用户首次打开文件仅请求一次读取，真实 MCP 返回正文');

    // 文件未变化且没有新的读取动作；推进可控页面时钟，不让用户重复处理权限。
    await page.clock.runFor(3000);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ test: 'stable-file-permission', resourceSha256: createHash('sha256').update(html).digest('hex'),
      initialReadCount: 1, idleWindowMs: 3000, readToolCalls: reads(), elapsedWallMs: Math.round(performance.now() - startedAt) }));
    assert.equal(reads().length, 1, '稳定文件空闲期间不得追加 read_editor_text；每次工具调用都可能重新要求本次审批');
    assert.equal(resources.filter(call => call.method === 'resources/subscribe').length, 1);
  } finally {
    await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true });
  }
});
