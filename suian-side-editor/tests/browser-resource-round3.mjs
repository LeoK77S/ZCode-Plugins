import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');

test('三页重绑定直接激活实际目标，不让相邻脏页提前其剩余800ms保存', async () => {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-round3-'));
  const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath);
  for (const directory of ['folder', 'other']) { await mkdir(join(workspaceRoot, directory)); await writeFile(join(workspaceRoot, directory, 'file.txt'), directory + '\n'); }
  await writeFile(join(workspaceRoot, 'third.txt'), 'third\n');
  const server = createMcpServer({ workspaceRoot, dataPath, zcodeAppVersion: '3.15.1' });
  const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  let browser;
  try {
    await server.connect(st); await client.connect(ct);
    assert.equal((await client.callTool({ name: 'update_editor_settings', arguments: { saveMode: 'auto' }, _meta: { session_id: 'round3-default-fixture' } })).isError, undefined);
    const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(1800); await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    const tools = [], errors = [];
    let settingsArrived, releaseSettings;
    const settingsReady = new Promise(resolve => { settingsArrived = resolve; });
    await page.exposeFunction('editorCall', async (name, args) => {
      const call = { name, args }; tools.push(call);
      const result = await client.callTool({ name, arguments: args, _meta: { session_id: 'round3-page-fixture' } }); call.result = result;
      if (name === 'get_editor_settings') return new Promise(resolve => { releaseSettings = () => resolve(result); settingsArrived(); });
      return result;
    });
    const resources = await installResourceBridge(page, client);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('data:text/html,<!doctype html><html><body></body></html>'); await page.setContent(html); await settingsReady;
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z')); await page.getByRole('button', { name: '文件列表', exact: true }).click();
    await page.getByRole('treeitem', { name: 'folder', exact: true }).click(); await page.locator('[data-path="folder/file.txt"]').dblclick();
    await page.locator('[data-path="third.txt"]').dblclick();
    await page.getByRole('treeitem', { name: 'other', exact: true }).click(); await page.locator('[data-path="other/file.txt"]').dblclick();
    await page.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 3 && [...document.querySelectorAll('[role=tab] .tab-title')].every(title => getComputedStyle(title).fontStyle === 'normal'));
    assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('aria-label'))), ['folder/file.txt', 'third.txt', 'other/file.txt']);
    const opened = path => tools.find(call => call.name === 'read_editor_text' && call.args.path === path).result.structuredContent;
    const oldUri = opened('folder/file.txt').resourceUri, targetUri = opened('other/file.txt').resourceUri;
    const content = page.getByRole('textbox', { name: '文件正文', exact: true });
    async function append(text) { await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(text); }
    await append('target-draft'); await page.getByRole('tab', { name: 'third.txt', exact: true }).click(); await append('recent');
    await page.clock.runFor(100); await page.getByRole('tab', { name: 'folder/file.txt', exact: true }).click();
    releaseSettings(); await page.getByRole('button', { name: '保存方式', exact: true }).getByText('自动保存', { exact: true }).waitFor();
    await rename(join(workspaceRoot, 'folder'), join(workspaceRoot, 'retired')); await symlink(join(workspaceRoot, 'other'), join(workspaceRoot, 'folder'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(JSON.parse((await client.readResource({ uri: oldUri })).contents[0].text).code, 'registered_path_changed');
    await page.getByText(/真实路径已改变/).waitFor(); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click();
    await content.filter({ hasText: 'target-draft' }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'other/file.txt', exact: true }).getAttribute('aria-selected'), 'true');
    const saves = () => tools.filter(call => call.name === 'save_editor_text' && call.args.path === 'third.txt');
    assert.equal(saves().length, 0, '用户从A重读到B，不得通过瞬时C页触发100ms时的提前写回');
    assert.equal(await readFile(join(workspaceRoot, 'third.txt'), 'utf8'), 'third\n');
    assert.equal(await page.getByRole('tab').count(), 2); assert.equal(resources.filter(call => call.method === 'resources/subscribe' && call.uri === targetUri).length, 1);
    assert.equal(resources.filter(call => call.method === 'resources/unsubscribe' && call.uri === targetUri).length, 0);
    await page.clock.runFor(699); assert.equal(saves().length, 0, 'C最近编辑799ms仍不写回');
    await page.clock.runFor(1); await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal(saves().length, 1); assert.equal(await readFile(join(workspaceRoot, 'third.txt'), 'utf8'), 'third\nrecent');
    assert.equal(await readFile(join(workspaceRoot, 'other/file.txt'), 'utf8'), 'other\ntarget-draft');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
