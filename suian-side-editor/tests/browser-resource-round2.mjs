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

async function withEditor(action, { sameBytes = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-round2-'));
  const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath);
  for (const directory of ['folder', 'other']) { await mkdir(join(workspaceRoot, directory)); await writeFile(join(workspaceRoot, directory, 'file.txt'), directory === 'folder' || sameBytes ? 'original\n' : 'other\n'); }
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
    const tools = [], errors = [];
    await page.exposeFunction('editorCall', async (name, args) => { const result = await client.callTool({ name, arguments: args, _meta: { session_id: 'round2-ui-fixture' } }); tools.push({ name, args, result }); return result; });
    const resources = await installResourceBridge(page, client);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('data:text/html,<!doctype html><html><body></body></html>'); await page.setContent(html);
    const mode = page.getByRole('button', { name: '保存方式', exact: true }); await mode.getByText('手动保存', { exact: true }).waitFor();
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z')); await page.getByRole('button', { name: '文件列表', exact: true }).click();
    await page.getByRole('treeitem', { name: 'folder', exact: true }).click(); await page.locator('[data-path="folder/file.txt"]').dblclick();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role=tab] .tab-title')).fontStyle === 'normal');
    const content = page.getByRole('textbox', { name: '文件正文', exact: true });
    const documentText = async () => (await content.locator('.cm-line').allTextContents()).join('\n');
    const reads = () => tools.filter(call => call.name === 'read_editor_text');
    async function append(text) { await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(text); }
    async function reload() { await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click(); }
    async function retarget() { await rename(join(workspaceRoot, 'folder'), join(workspaceRoot, 'retired')); await symlink(join(workspaceRoot, 'other'), join(workspaceRoot, 'folder'), process.platform === 'win32' ? 'junction' : 'dir'); }
    await action({ page, content, documentText, mode, client, tools, resources, reads, append, reload, retarget, workspaceRoot });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
}

for (const dirty of [false, true]) {
  test(`目录改指已打开目标后确认重读，规范目标只保留一个固定页${dirty ? '且保留其未保存正文' : ''}`, async () => {
    await withEditor(async ({ page, content, documentText, client, resources, reads, append, reload, retarget, workspaceRoot }) => {
      const oldUri = reads().at(-1).result.structuredContent.resourceUri;
      await page.getByRole('treeitem', { name: 'other', exact: true }).click(); await page.locator('[data-path="other/file.txt"]').dblclick();
      await page.waitForFunction(() => {
        const target = document.querySelector('[role=tab][aria-label="other/file.txt"]');
        return target?.getAttribute('aria-selected') === 'true' && getComputedStyle(target.querySelector('.tab-title')).fontStyle === 'normal';
      });
      const targetUri = reads().find(call => call.args.path === 'other/file.txt').result.structuredContent.resourceUri;
      if (dirty) await append('target-draft');
      await page.getByRole('tab', { name: 'folder/file.txt', exact: true }).click();
      assert.equal(await page.getByRole('tab').count(), 2);
      await retarget(); assert.equal(JSON.parse((await client.readResource({ uri: oldUri })).contents[0].text).code, 'registered_path_changed');
      await page.getByText(/真实路径已改变/).waitFor(); await reload(); await content.filter({ hasText: 'other' }).waitFor();
      assert.equal(reads().at(-1).result.structuredContent.resourceUri, targetUri, '受审重读复用已有目标关联');
      assert.equal(await page.getByRole('tab', { name: 'other/file.txt', exact: true }).count(), 1, '确认重读应复用已有规范目标页，不创建第二个同URI页');
      assert.equal(await page.getByRole('tab').count(), 1);
      assert.equal(await documentText(), dirty ? 'other\ntarget-draft' : 'other\n');
      assert.equal(resources.filter(call => call.method === 'resources/subscribe' && call.uri === targetUri).length, 1);
      assert.equal(resources.filter(call => call.method === 'resources/unsubscribe' && call.uri === targetUri).length, 0);
      await assert.rejects(client.readResource({ uri: oldUri }), /未登记/);
      await writeFile(join(workspaceRoot, 'other/file.txt'), 'external-target\n'); await client.readResource({ uri: targetUri });
      if (dirty) { await page.getByText(/磁盘内容已改变/).waitFor(); assert.equal(await documentText(), 'other\ntarget-draft'); await page.getByRole('button', { name: '关闭 other/file.txt', exact: true }).click(); await page.getByRole('button', { name: '放弃修改', exact: true }).click(); }
      else { await content.filter({ hasText: 'external-target' }).waitFor(); await page.getByRole('button', { name: '关闭 other/file.txt', exact: true }).click(); }
      await page.getByText('从文件列表选择文本').waitFor(); await assert.rejects(client.readResource({ uri: targetUri }), /未登记/);
    });
  });
}

test('同字节目录改指后直接保存，源ACK不清除旧资源关联的同步失败', async () => {
  await withEditor(async ({ page, content, documentText, mode, client, tools, reads, append, reload, retarget, workspaceRoot }) => {
    const original = reads().at(-1).result.structuredContent;
    await retarget(); assert.equal(JSON.parse((await client.readResource({ uri: original.resourceUri })).contents[0].text).code, 'registered_path_changed');
    await page.getByText(/真实路径已改变/).waitFor(); await append('manual'); await page.keyboard.press('Control+s'); await page.getByText(/已保存/).waitFor();
    const saved = tools.find(call => call.name === 'save_editor_text');
    assert.equal(saved.args.baseVersion, original.version); assert.equal(saved.result.isError, undefined);
    assert.equal(saved.result.structuredContent.relativePath, 'other/file.txt'); assert.equal(await readFile(join(workspaceRoot, 'other/file.txt'), 'utf8'), 'original\nmanual');
    assert.match(await page.locator('#status-text').textContent(), /同步.*真实路径已改变/, '源文件保存成功不表示旧只读关联已经恢复');
    await mode.click(); await mode.getByText('自动保存', { exact: true }).waitFor(); await append('paused'); await page.clock.runFor(801);
    assert.equal(tools.filter(call => call.name === 'save_editor_text').length, 1, '旧关联不可用时仍暂停自动写回');
    await writeFile(join(workspaceRoot, 'other/file.txt'), 'external-before-reload\n'); await client.readResource({ uri: original.resourceUri });
    assert.equal(await documentText(), 'original\nmanualpaused');
    await reload(); await content.filter({ hasText: 'external-before-reload' }).waitFor(); await page.getByText('已读取', { exact: true }).waitFor();
    const recovered = reads().at(-1).result.structuredContent; assert.notEqual(recovered.resourceUri, original.resourceUri);
    await writeFile(join(workspaceRoot, 'other/file.txt'), 'external-after-reload\n'); await client.readResource({ uri: recovered.resourceUri });
    await content.filter({ hasText: 'external-after-reload' }).waitFor();
    await append('auto'); await page.clock.runFor(801); await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal(await readFile(join(workspaceRoot, 'other/file.txt'), 'utf8'), 'external-after-reload\nauto');
  }, { sameBytes: true });
});
