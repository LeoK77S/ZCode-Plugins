import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';
const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');
const lines = Array.from({ length: 150 }, (_, i) => `第${i + 1}行 正文`).join('\n');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-recover-ui-')), workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath); await writeFile(join(workspaceRoot, 'alpha.txt'), lines); await writeFile(join(workspaceRoot, 'beta.txt'), 'beta old\n');
  const server = createMcpServer({ workspaceRoot, dataPath, zcodeAppVersion: '3.15.1' });
  const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps }); const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct); const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); });
  const request = (name, args = {}, session = 'A') => client.callTool({ name, arguments: args, _meta: { session_id: session } });
  const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
  const calls = [], errors = []; let hold;
  async function page() {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }); page.setDefaultTimeout(2500);
    await page.exposeFunction('editorCall', async (name, args) => {
      const entry = { name, args }; calls.push(entry);
      const result = await request(name, args); entry.result = result;
      if (hold?.name === name) return new Promise(resolve => { hold.release = () => resolve(result); });
      return result;
    });
    await installResourceBridge(page, client); page.on('pageerror', error => errors.push(error.message));
    await page.goto('data:text/html,<!doctype html><html><body></body></html>'); await page.setContent(html); return page;
  }
  return { root, workspaceRoot, dataPath, request, page, calls, errors, setHold: value => { hold = value; } };
}

test('实际构建页面恢复顺序/临时属性/当前页/脏正文/阅读位置，源文件未保存且不抢键盘焦点', async t => {
  const f = await fixture(t), alpha = (await f.request('read_editor_text', { path: 'alpha.txt' })).structuredContent;
  const state = { files: [{ path: 'alpha.txt', fixed: true, scrollTop: 700, scrollLeft: 0, draft: { text: lines + '\n恢复正文', diskText: lines, baseVersion: alpha.version, encoding: alpha.encoding } }, { path: 'beta.txt', fixed: false, scrollTop: 0, scrollLeft: 0 }], currentPath: 'alpha.txt' };
  assert.equal((await f.request('update_editor_state', { state })).isError, undefined);
  await writeFile(join(f.workspaceRoot, 'beta.txt'), 'beta latest\n');
  const page = await f.page(); await page.getByRole('tab', { name: 'alpha.txt', exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('aria-label'))), ['alpha.txt','beta.txt']);
  assert.equal(await page.getByRole('tab', { name: 'alpha.txt', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('tab', { name: 'beta.txt', exact: true }).locator('.tab-title').evaluate(el => getComputedStyle(el).fontStyle), 'italic');
  await page.waitForFunction(() => document.querySelector('.cm-scroller').scrollTop >= 690);
  assert.equal(await page.getByRole('textbox', { name: '文件正文', exact: true }).evaluate(el => el.contains(document.activeElement)), false);
  await page.getByRole('textbox', { name: '文件正文', exact: true }).focus(); await page.keyboard.press('Control+End'); await page.getByText('未保存', { exact: true }).waitFor();
  assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /恢复正文/);
  assert.equal(await readFile(join(f.workspaceRoot, 'alpha.txt'), 'utf8'), lines);
  await page.getByRole('tab', { name: 'beta.txt', exact: true }).click(); assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /beta latest/);
  await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  assert.equal((await f.request('get_editor_state')).structuredContent.state.currentPath, 'beta.txt');
  assert.deepEqual(f.errors, []);
});

test('过期基线及已删除文件保留恢复正文并阻止自动覆盖，确认重新读盘才放弃正文', async t => {
  const f = await fixture(t), alpha = (await f.request('read_editor_text', { path: 'alpha.txt' })).structuredContent, beta = (await f.request('read_editor_text', { path: 'beta.txt' })).structuredContent;
  await f.request('update_editor_state', { state: { files: [alpha,beta].map(data => ({ path: data.relativePath, fixed: true, scrollTop: 0, scrollLeft: 0, draft: { text: '恢复-' + data.relativePath, diskText: data.text, baseVersion: data.version, encoding: data.encoding } })), currentPath: 'alpha.txt' } });
  await f.request('update_editor_settings', { saveMode: 'auto' }); await writeFile(join(f.workspaceRoot, 'alpha.txt'), '外部新正文\n'); await unlink(join(f.workspaceRoot, 'beta.txt'));
  const page = await f.page(); await page.getByText(/恢复正文已保留/).waitFor();
  assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /恢复-alpha/);
  await page.getByRole('button', { name: '保存方式', exact: true }).getByText('自动保存', { exact: true }).waitFor();
  await page.waitForTimeout(1100); assert.equal(f.calls.filter(call => call.name === 'save_editor_text').length, 0);
  assert.equal(await readFile(join(f.workspaceRoot, 'alpha.txt'), 'utf8'), '外部新正文\n');
  await page.getByRole('tab', { name: 'beta.txt', exact: true }).click();
  assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /恢复-beta/); await page.getByText(/文件不存在/).waitFor();
  await page.getByText('恢复副本已同步', { exact: true }).waitFor(); assert.equal((await f.request('get_editor_state')).structuredContent.state.files[1].draft.text, '恢复-beta.txt');
  await page.getByRole('tab', { name: 'alpha.txt', exact: true }).click(); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click();
  await page.getByText('已读取', { exact: true }).waitFor(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /外部新正文/); assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft, undefined);
  assert.deepEqual(f.errors, []);
});

test('恢复副本晚到 ACK 不确认新编辑；真实 SQLite 失败显式提示且可重试，源文件不受影响', async t => {
  const f = await fixture(t), page = await f.page(); await page.getByRole('button', { name: '文件列表', exact: true }).click(); await page.getByRole('treeitem', { name: 'beta.txt', exact: true }).click();
  await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  const first = { name: 'update_editor_state' }; f.setHold(first);
  const content = page.getByRole('textbox', { name: '文件正文', exact: true }); await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('第一份');
  await page.waitForFunction(() => document.getElementById('recovery-status').textContent === '恢复副本待同步…');
  for (let attempts = 0; !first.release && attempts < 200; attempts++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof first.release, 'function', '第一份副本实际取得工具回执并等待交还页面');
  await page.keyboard.type('新增'); const second = { name: 'update_editor_state' }; f.setHold(second); first.release();
  await page.getByText('恢复副本待同步…', { exact: true }).waitFor();
  for (let attempts = 0; !second.release && attempts < 200; attempts++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof second.release, 'function', '新正文副本实际取得工具回执');
  assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft.text, 'beta old\n第一份新增');
  f.setHold(undefined); second.release(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  const db = new DatabaseSync(join(f.dataPath, 'editor-state.sqlite'));
  try {
    db.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON session_recovery BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    await page.keyboard.type('失败时新增'); await page.getByText(/恢复副本失败/).waitFor();
    assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft.text, 'beta old\n第一份新增');
    assert.equal(await readFile(join(f.workspaceRoot, 'beta.txt'), 'utf8'), 'beta old\n');
    db.exec('DROP TRIGGER reject_recovery'); await page.getByRole('button', { name: '重试恢复副本', exact: true }).click(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
    assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft.text, 'beta old\n第一份新增失败时新增');
  } finally { db.close(); }
  assert.deepEqual(f.errors, []);
});

test('切页阅读位置/固定属性/关闭与放弃状态在重建页面生效，不复活已关页', async t => {
  const f = await fixture(t); let page = await f.page(); await page.getByRole('button', { name: '文件列表', exact: true }).click();
  await page.getByRole('treeitem', { name: 'alpha.txt', exact: true }).dblclick(); await page.getByRole('textbox', { name: '文件正文', exact: true }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = 760; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.cm-scroller').evaluate(el => el.scrollTop), 760, '开始切页前已实际到达的阅读位置');
  await page.getByRole('treeitem', { name: 'beta.txt', exact: true }).click(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].scrollTop, 760);
  await page.close(); page = await f.page(); await page.getByRole('tab', { name: 'beta.txt', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'beta.txt', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: 'alpha.txt', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.cm-scroller').scrollTop >= 750);
  await page.getByRole('button', { name: '关闭 alpha.txt', exact: true }).click();
  const content = page.getByRole('textbox', { name: '文件正文', exact: true }); await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('应放弃');
  await page.getByText('恢复副本已同步', { exact: true }).waitFor(); await page.getByRole('button', { name: '关闭 beta.txt', exact: true }).click(); await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByText('恢复副本已同步', { exact: true }).waitFor(); assert.deepEqual((await f.request('get_editor_state')).structuredContent.state, { files: [], currentPath: null });
  await page.close(); page = await f.page(); await page.getByText('恢复副本已同步', { exact: true }).waitFor(); assert.equal(await page.getByRole('tab').count(), 0);
  assert.equal(await readFile(join(f.workspaceRoot, 'beta.txt'), 'utf8'), 'beta old\n'); assert.deepEqual(f.errors, []);
});

test('恢复遇真实读取 ACL 失败仍保留 dirty 正文，权限恢复后确认重读可继续', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), beta = (await f.request('read_editor_text', { path: 'beta.txt' })).structuredContent;
  await f.request('update_editor_state', { state: { files: [{ path: 'beta.txt', fixed: true, scrollTop: 0, scrollLeft: 0, draft: { text: '权限失败仍保留', diskText: beta.text, baseVersion: beta.version, encoding: beta.encoding } }], currentPath: 'beta.txt' } });
  const path = join(f.workspaceRoot, 'beta.txt');
  const run = script => execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop";' + script], { env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: path }, windowsHide: true, stdio: 'pipe' });
  const restore = '$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;';
  run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Read","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
  try {
    const page = await f.page(); await page.getByText(/没有访问该文件的权限|系统拒绝访问该文件/).waitFor();
    assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /权限失败仍保留/);
    assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft.text, '权限失败仍保留');
    run(restore); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click();
    await page.getByText('已读取', { exact: true }).waitFor(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
    assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft, undefined); assert.deepEqual(f.errors, []);
  } finally { run(restore); }
});

test('恢复库初始化失败显示独立错误并禁止用空页面覆盖旧副本，修复后按正常工具重试', async t => {
  const f = await fixture(t); await f.request('update_editor_state', { state: { files: [{ path: 'beta.txt', fixed: false, scrollTop: 0, scrollLeft: 0 }], currentPath: 'beta.txt' } });
  const db = new DatabaseSync(join(f.dataPath, 'editor-state.sqlite'));
  try {
    const original = db.prepare('SELECT state_json FROM session_recovery').get().state_json; db.exec('PRAGMA user_version=99');
    const page = await f.page(); await page.locator('#recovery-status').getByText(/版本不兼容/).waitFor();
    assert.equal(await page.getByRole('button', { name: '文件列表', exact: true }).isDisabled(), true);
    assert.equal(f.calls.filter(call => call.name === 'update_editor_state').length, 0); assert.equal(db.prepare('SELECT state_json FROM session_recovery').get().state_json, original);
    db.exec('PRAGMA user_version=2'); await page.getByRole('button', { name: '重试恢复副本', exact: true }).click(); await page.getByRole('tab', { name: 'beta.txt', exact: true }).waitFor();
    await page.getByText('恢复副本已同步', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '文件列表', exact: true }).isDisabled(), false);
    assert.deepEqual(f.errors, []);
  } finally { db.close(); }
});
