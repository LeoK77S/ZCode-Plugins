import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');

async function withEditor(action, { failFirstSubscribe = false, directory = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-review-'));
  const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath);
  if (directory) { await mkdir(join(workspaceRoot, 'folder')); await mkdir(join(workspaceRoot, 'other')); await writeFile(join(workspaceRoot, 'other/file.txt'), 'other\n'); }
  const path = directory ? 'folder/file.txt' : 'file.txt';
  await writeFile(join(workspaceRoot, path), 'original\n');
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
    const tools = [], errors = [], holds = new Map();
    const hold = name => { const token = {}; token.ready = new Promise(resolve => { token.arrived = resolve; }); holds.set(name, token); return token; };
    const reply = (name, result) => { const token = holds.get(name); if (!token) return result; holds.delete(name);
      return new Promise(resolve => { token.result = result; token.release = () => resolve(result); token.arrived(); }); };
    await page.exposeFunction('editorCall', async (name, args) => {
      const result = await client.callTool({ name, arguments: args, _meta: { session_id: 'review-ui-fixture' } });
      tools.push({ name, args, result }); return reply(name, result);
    });
    let subscribeCount = 0;
    const resources = await installResourceBridge(page, client, { read: result => reply('resources/read', result), subscribe: async uri => {
      if (failFirstSubscribe && ++subscribeCount === 1) throw new Error('测试：订阅通路暂时不可用');
      await client.subscribeResource({ uri });
    } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('data:text/html,<!doctype html><html><body></body></html>'); await page.setContent(html);
    const mode = page.getByRole('button', { name: '保存方式', exact: true }); await mode.getByText('手动保存', { exact: true }).waitFor();
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    await page.getByRole('button', { name: '文件列表', exact: true }).click();
    if (directory) await page.getByRole('treeitem', { name: 'folder', exact: true }).click();
    await page.getByRole('treeitem', { name: 'file.txt', exact: true }).dblclick();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role=tab] .tab-title')).fontStyle === 'normal');
    const content = page.getByRole('textbox', { name: '文件正文', exact: true });
    async function reload() { await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click(); }
    async function append(text) { await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(text); }
    const reads = () => tools.filter(call => call.name === 'read_editor_text');
    await action({ page, content, mode, client, tools, resources, reads, hold, reload, append, workspaceRoot, filePath: join(workspaceRoot, path) });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
}

test('首次订阅暂时失败后确认重读，必须恢复订阅及之后的真实外部同步', async () => {
  await withEditor(async ({ page, content, resources, reload, reads, client, filePath }) => {
    await page.getByText(/外部同步订阅失败/).waitFor(); await reload(); await page.getByText('已读取', { exact: true }).waitFor();
    assert.equal(resources.filter(call => call.method === 'resources/subscribe').length, 2, '成功受审重读之后应再订阅，不能只清错误');
    await writeFile(filePath, 'after-recovery\n'); await client.readResource({ uri: reads().at(-1).result.structuredContent.resourceUri });
    await content.filter({ hasText: 'after-recovery' }).waitFor();
  }, { failFirstSubscribe: true });
});

test('原目录换为工作区内部链接，确认重读必须接收新路径并订阅新资源', async () => {
  await withEditor(async ({ page, content, resources, reload, reads, client, workspaceRoot }) => {
    const previous = reads().at(-1).result.structuredContent.resourceUri;
    await rename(join(workspaceRoot, 'folder'), join(workspaceRoot, 'retired'));
    await symlink(join(workspaceRoot, 'other'), join(workspaceRoot, 'folder'), process.platform === 'win32' ? 'junction' : 'dir');
    const rejected = JSON.parse((await client.readResource({ uri: previous })).contents[0].text);
    assert.equal(rejected.code, 'registered_path_changed');
    await page.getByText(/真实路径已改变/).waitFor(); await reload();
    await content.filter({ hasText: 'other' }).waitFor();
    const opened = reads().at(-1).result.structuredContent;
    assert.notEqual(opened.resourceUri, previous);
    assert.equal(await page.getByRole('tab', { name: opened.relativePath, exact: true }).count(), 1, '确认重读应接受受审工具返回的新规范路径');
    assert.equal(resources.filter(call => call.method === 'resources/subscribe').at(-1).uri, opened.resourceUri);
    assert.equal(resources.filter(call => call.method === 'resources/unsubscribe').at(-1).uri, previous);
    assert.match(await page.locator('#breadcrumb').textContent(), /other/);
    await page.getByRole('button', { name: `关闭 ${opened.relativePath}`, exact: true }).waitFor();
    await assert.rejects(client.readResource({ uri: previous }), /未登记/);
    await writeFile(join(workspaceRoot, 'other/file.txt'), 'changed-new-target\n'); await client.readResource({ uri: opened.resourceUri });
    await content.filter({ hasText: 'changed-new-target' }).waitFor();
  }, { directory: true });
});

test('真实权限错误的迟到资源回执不能覆盖同版本的成功重读', { skip: process.platform !== 'win32' }, async () => {
  await withEditor(async ({ page, mode, append, reads, resources, client, hold, reload, filePath }) => {
    const opened = reads().at(-1).result.structuredContent;
    const run = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop";' + script],
      { env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: filePath }, windowsHide: true, stdio: 'pipe' });
    const restore = () => run('$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;');
    const stale = hold('resources/read');
    run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Read,Write","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
    try {
      assert.equal(JSON.parse((await client.readResource({ uri: opened.resourceUri })).contents[0].text).code, 'permission_denied');
      await stale.ready; assert.equal(JSON.parse(stale.result.contents[0].text).code, 'permission_denied');
      await append('cannot-write'); await page.keyboard.press('Control+s'); await page.getByText(/没有访问|系统拒绝访问/).waitFor();
    } finally { restore(); }
    await reload(); await page.getByText('已读取', { exact: true }).waitFor();
    assert.equal(reads().at(-1).result.structuredContent.version, opened.version, '重读成功时磁盘正文和版本均未变化');
    const before = resources.filter(call => call.method === 'resources/read').length;
    stale.release(); await page.clock.runFor(1);
    await mode.click(); await mode.getByText('自动保存', { exact: true }).waitFor(); await append('after-reload'); await page.clock.runFor(801);
    assert.equal(resources.filter(call => call.method === 'resources/read').length > before, true, '旧错误被较新成功重读取代后，应核对当前资源而非再次阻塞');
    await page.getByText('已保存', { exact: true }).waitFor(); assert.equal(await readFile(filePath, 'utf8'), 'original\nafter-reload');
  });
});

test('手动原文件保存成功仍显示独立的同步失败，自动保存保持暂停至重读恢复', async () => {
  await withEditor(async ({ page, content, mode, append, resources, reload, tools, filePath }) => {
    await page.getByText(/外部同步订阅失败/).waitFor(); await append('manual'); await page.keyboard.press('Control+s');
    await page.getByText(/已保存/).waitFor();
    assert.match(await page.locator('#status-text').textContent(), /外部同步订阅失败/, '原文件保存 ACK 不应掩盖尚未恢复的订阅失败');
    await mode.click(); await mode.getByText('自动保存', { exact: true }).waitFor(); await append('paused'); await page.clock.runFor(801);
    assert.equal(tools.filter(call => call.name === 'save_editor_text').length, 1, '同步不可用时不自动写回');
    assert.equal(await readFile(filePath, 'utf8'), 'original\nmanual');
    await reload(); await page.getByText('已读取', { exact: true }).waitFor();
    assert.equal(resources.filter(call => call.method === 'resources/subscribe').length, 2);
    await append('recovered'); await page.clock.runFor(801); await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal(await readFile(filePath, 'utf8'), 'original\nmanualrecovered');
    assert.ok((await content.textContent()).endsWith('manualrecovered'));
  }, { failFirstSubscribe: true });
});
