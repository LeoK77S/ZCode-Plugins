import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';
const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-recovery-review-')), workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath);
  for (const folder of ['folder','other']) { await mkdir(join(workspaceRoot, folder)); await writeFile(join(workspaceRoot, folder, 'file.txt'), folder + ' original\n'); }
  for (const name of ['alpha','beta']) await writeFile(join(workspaceRoot, name + '.txt'), name + ' original\n');
  const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../cli.mjs', import.meta.url))], cwd: root,
    env: { SUIAN_SIDE_EDITOR_WORKSPACE: workspaceRoot, ZCODE_PLUGIN_DATA: dataPath, ZCODE_APP_VERSION: '3.15.1' }, stderr: 'pipe' }); transport.stderr.resume();
  await client.connect(transport); const browser = await chromium.launch({ headless: true });
  const db = new DatabaseSync(join(dataPath, 'editor-state.sqlite'));
  t.after(async () => { db.close(); await browser.close(); await client.close(); await rm(root, { recursive: true, force: true }); });
  const request = (name, args = {}) => client.callTool({ name, arguments: args, _meta: { session_id: 'review-A' } });
  const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
  const calls = [], errors = [], holds = [];
  function hold(match, { beforeCall = false } = {}) { const token = { match, beforeCall }; token.ready = new Promise(resolve => { token.arrived = resolve; }); holds.push(token); return token; }
  async function page() {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }); page.setDefaultTimeout(2500);
    await page.exposeFunction('editorCall', async (name, args) => {
      const entry = { name, args }; calls.push(entry);
      const before = holds.find(token => token.beforeCall && !token.release && token.match(entry, calls));
      if (before) await new Promise(resolve => { before.release = resolve; before.arrived(); });
      const result = await request(name, args); entry.result = result;
      const token = holds.find(token => !token.beforeCall && !token.release && token.match(entry, calls));
      if (token) return new Promise(resolve => { token.result = result; token.release = () => resolve(result); token.arrived(); });
      return result;
    });
    const resources = await installResourceBridge(page, client, { read: result => {
      const entry = { name: 'resources/read', result }; calls.push(entry);
      const token = holds.find(token => !token.beforeCall && !token.release && token.match(entry, calls));
      if (token) return new Promise(resolve => { token.result = result; token.release = () => resolve(result); token.arrived(); });
      return result;
    } }); page.on('pageerror', error => errors.push(error.message));
    await page.goto('data:text/html,<!doctype html><html><body></body></html>'); await page.setContent(html); return { page, resources };
  }
  const saved = async (path, text) => {
    const data = (await request('read_editor_text', { path })).structuredContent;
    return { path, fixed: true, scrollTop: 0, scrollLeft: 0, ...(text ? { draft: { text, diskText: data.text, baseVersion: data.version, encoding: data.encoding } } : {}) };
  };
  return { workspaceRoot, dataPath, request, page, saved, calls, errors, hold, db, client };
}

for (const variant of ['clean','dirty-source','both-dirty']) test(`恢复规范目标合流-${variant}：页签唯一，脏副本不丢失且退订不影响另一页`, async t => {
  const f = await fixture(t);
  if (variant === 'dirty-source') await writeFile(join(f.workspaceRoot, 'folder/file.txt'), 'other original\n');
  const first = await f.saved('folder/file.txt', variant === 'clean' ? undefined : 'folder 未保存'), second = await f.saved('other/file.txt', variant === 'both-dirty' ? 'other 未保存' : undefined);
  if (variant === 'clean') second.fixed = false;
  if (variant === 'dirty-source') {
    assert.equal(first.draft.baseVersion, (await f.request('read_editor_text', { path: 'other/file.txt' })).structuredContent.version, '新旧目标恰同字节版本');
    await f.request('update_editor_settings', { saveMode: 'auto' });
  }
  await f.request('update_editor_state', { state: { files: [first,second], currentPath: 'folder/file.txt' } });
  await rename(join(f.workspaceRoot, 'folder'), join(f.workspaceRoot, 'retired')); await symlink(join(f.workspaceRoot, 'other'), join(f.workspaceRoot, 'folder'), process.platform === 'win32' ? 'junction' : 'dir');
  const { page, resources } = await f.page(); await page.getByRole('button', { name: '保存方式', exact: true }).getByText(variant === 'dirty-source' ? '自动保存' : '手动保存', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'other/file.txt', exact: true }).count(), 1);
  const target = f.calls.find(call => call.name === 'read_editor_text').result.structuredContent.resourceUri;
  assert.equal(resources.filter(call => call.method === 'resources/subscribe' && call.uri === target).length, 1);
  if (variant === 'clean') {
    assert.equal(await page.getByRole('tab').count(), 1); assert.equal(await page.getByRole('tab', { name: 'other/file.txt', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('tab', { name: 'other/file.txt', exact: true }).locator('.tab-title').evaluate(el => getComputedStyle(el).fontStyle), 'normal', '合流时保留固定属性');
    await page.getByText('恢复副本已同步', { exact: true }).waitFor();
    assert.deepEqual((await f.request('get_editor_state')).structuredContent.state.files.map(file => file.path), ['other/file.txt']);
    await page.getByRole('button', { name: '关闭 other/file.txt', exact: true }).click();
  } else {
    assert.equal(await page.getByRole('tab', { name: 'folder/file.txt', exact: true }).count(), 1);
    assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /folder 未保存/);
    await page.getByText(/路径已改变/).waitFor(); assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    await page.getByRole('textbox', { name: '文件正文', exact: true }).focus();
    await page.keyboard.press('Control+s'); assert.equal(f.calls.filter(call => call.name === 'save_editor_text').length, 0);
    if (variant === 'dirty-source') { await page.waitForTimeout(900); assert.equal(f.calls.filter(call => call.name === 'save_editor_text').length, 0, '同字节目标也不触发自动写回'); }
    await page.getByRole('button', { name: '关闭 folder/file.txt', exact: true }).click(); await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    assert.equal(resources.filter(call => call.method === 'resources/unsubscribe' && call.uri === target).length, 0);
    await page.getByRole('tab', { name: 'other/file.txt', exact: true }).click();
    if (variant === 'both-dirty') assert.match(await page.getByRole('textbox', { name: '文件正文', exact: true }).innerText(), /other 未保存/);
  }
  await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  if (variant === 'both-dirty') assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft.text, 'other 未保存');
  assert.equal(await readFile(join(f.workspaceRoot, 'other/file.txt'), 'utf8'), 'other original\n'); assert.deepEqual(f.errors, []);
});

test('真实 SQLite 锁失败后的连续恢复重试只有一轮，关闭的已同步空副本不被迟到恢复复活', async t => {
  const f = await fixture(t); await f.request('update_editor_state', { state: { files: [await f.saved('alpha.txt')], currentPath: 'alpha.txt' } });
  f.db.exec('BEGIN IMMEDIATE'); let locked = true;
  try {
    const { page } = await f.page(); await page.locator('#recovery-status').getByText(/恢复副本失败/).waitFor();
    f.db.exec('ROLLBACK'); locked = false;
    const late = f.hold((entry, calls) => entry.name === 'read_editor_text' && calls.filter(call => call.name === 'read_editor_text').length === 2);
    await page.getByRole('button', { name: '重试恢复副本', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole('tab', { name: 'alpha.txt', exact: true }).waitFor(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭 alpha.txt', exact: true }).click(); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
    assert.deepEqual((await f.request('get_editor_state')).structuredContent.state, { files: [], currentPath: null });
    if (late.release) { late.release(); await page.getByRole('tab', { name: 'alpha.txt', exact: true }).waitFor(); }
    assert.equal(await page.getByRole('tab').count(), 0, '已确认关闭并持久化的页面不能被第二轮旧恢复读取复活');
    assert.equal(f.calls.filter(call => call.name === 'get_editor_state').length, 2, '初次锁失败加唯一一轮重试');
    assert.equal(late.release, undefined, '没有第二轮迟到文件读取'); assert.deepEqual(f.errors, []);
  } finally { if (locked) f.db.exec('ROLLBACK'); }
});

test('恢复尚未完成时不可编辑提前显示的首页，完成后新正文须取得独立副本 ACK', async t => {
  const f = await fixture(t); await f.request('update_editor_state', { state: { files: [await f.saved('alpha.txt'), await f.saved('beta.txt')], currentPath: 'alpha.txt' } });
  const first = f.hold(entry => entry.name === 'read_editor_text' && entry.args.path === 'alpha.txt'), second = f.hold(entry => entry.name === 'read_editor_text' && entry.args.path === 'beta.txt');
  const { page } = await f.page(); await first.ready;
  await writeFile(join(f.workspaceRoot, 'alpha.txt'), 'alpha 外部新正文\n'); first.release(); await second.ready;
  await page.locator('[role=tab][aria-label="alpha.txt"]').waitFor();
  await page.locator('[role=tab][aria-label="alpha.txt"]').evaluate(button => button.focus());
  await page.keyboard.press('Enter');
  const content = page.locator('.cm-content');
  // 标准浏览器 focus/键盘输入；恢复阶段须阻止焦点与编辑，不触达页面私有状态。
  if (await content.count()) { await content.evaluate(element => element.focus()); await page.keyboard.type('初始化新增'); }
  assert.equal(await page.evaluate(() => document.querySelector('#editor').contains(document.activeElement)), false, '恢复未完成不能进入可编辑正文');
  second.release(); await page.getByRole('button', { name: '保存方式', exact: true }).getByText('手动保存', { exact: true }).waitFor();
  await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('恢复完成后新增'); await page.getByText('恢复副本已同步', { exact: true }).waitFor();
  assert.equal((await f.request('get_editor_state')).structuredContent.state.files[0].draft.text, 'alpha 外部新正文\n恢复完成后新增');
  assert.equal(await readFile(join(f.workspaceRoot, 'alpha.txt'), 'utf8'), 'alpha 外部新正文\n'); assert.deepEqual(f.errors, []);
});

test('规范合流的新受审读取作废同版本迟到权限错误，后续自动保存与外部通知仍可用', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), first = await f.saved('folder/file.txt'), second = await f.saved('other/file.txt');
  await f.request('update_editor_state', { state: { files: [first,second], currentPath: 'other/file.txt' } });
  await rename(join(f.workspaceRoot, 'folder'), join(f.workspaceRoot, 'retired')); await symlink(join(f.workspaceRoot, 'other'), join(f.workspaceRoot, 'folder'), 'junction');
  const next = f.hold(entry => entry.name === 'read_editor_text' && entry.args.path === 'other/file.txt', { beforeCall: true });
  const stale = f.hold(entry => entry.name === 'resources/read' && JSON.parse(entry.result.contents[0].text).code === 'permission_denied');
  const { page } = await f.page(); await next.ready;
  const opened = f.calls.find(call => call.name === 'read_editor_text').result.structuredContent;
  const path = join(f.workspaceRoot, 'other/file.txt');
  const run = script => execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop";' + script], { env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: path }, windowsHide: true, stdio: 'pipe' });
  const restore = '$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;';
  run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Read","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
  try {
    assert.equal(JSON.parse((await f.client.readResource({ uri: opened.resourceUri })).contents[0].text).code, 'permission_denied');
    await stale.ready; assert.equal(JSON.parse(stale.result.contents[0].text).code, 'permission_denied');
  } finally { run(restore); }
  next.release(); await page.getByRole('button', { name: '保存方式', exact: true }).getByText('手动保存', { exact: true }).waitFor();
  const newer = f.calls.filter(call => call.name === 'read_editor_text').at(-1).result.structuredContent;
  assert.equal(newer.version, opened.version, '权限恢复后第二次受审读取的字节版本不变'); assert.equal(newer.resourceUri, opened.resourceUri);
  stale.release(); await page.getByRole('button', { name: '保存方式', exact: true }).click(); await page.getByRole('button', { name: '保存方式', exact: true }).getByText('自动保存', { exact: true }).waitFor();
  const content = page.getByRole('textbox', { name: '文件正文', exact: true }); await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('new');
  try { await page.getByText('已保存', { exact: true }).waitFor(); }
  catch (error) { assert.fail(`${error.message}\n${JSON.stringify({ status: await page.locator('#status-text').innerText(), conflictVisible: await page.locator('#conflict-bar').isVisible(), saveRequests: f.calls.filter(call => call.name === 'save_editor_text').length, disk: await readFile(path, 'utf8') })}`); }
  assert.equal(await readFile(path, 'utf8'), 'other original\nnew');
  assert.equal(await page.locator('#conflict-bar').isVisible(), false);
  await writeFile(path, 'latest external\n'); await f.client.readResource({ uri: opened.resourceUri }); await content.filter({ hasText: 'latest external' }).waitFor();
  assert.deepEqual(f.errors, []);
});
