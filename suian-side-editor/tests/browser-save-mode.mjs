import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';

const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');
const root = await mkdtemp(join(tmpdir(), 'side-editor-auto-')), workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
await mkdir(workspaceRoot); await mkdir(dataPath);
const server = createMcpServer({ workspaceRoot, dataPath, zcodeAppVersion: '3.15.1' });
const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
const [ct, st] = InMemoryTransport.createLinkedPair();
let browser;
try {
  for (const name of ['first.txt', 'second.txt']) await writeFile(join(workspaceRoot, name), `${name}\n`);
  await writeFile(join(workspaceRoot, 'long.txt'), Array.from({ length: 150 }, (_, n) => `line-${n}`).join('\n'));
  await server.connect(st); await client.connect(ct);
  const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(2500); await page.clock.install();
  const calls = [], errors = [], requests = [];
  let holdName, release, arrived, ready, failSettings = false;
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
  await page.exposeFunction('editorCall', async (name, args) => {
    calls.push({ name, args });
    if (name === 'update_editor_settings' && failSettings) return { isError: true, structuredContent: { code: 'state_storage_error', error: '数据库写入失败，设置未保存' } };
    const result = await client.callTool({ name, arguments: args, _meta: { session_id: 'auto-browser-fixture' } });
    if (name === holdName) { holdName = undefined; return new Promise(resolve => { release = () => resolve(result); arrived(); }); }
    return result;
  });
  function hold(name) { holdName = name; ready = new Promise(resolve => { arrived = resolve; }); }
  await page.addInitScript(() => { window.zcode = { ready: async () => {}, subscribe: () => {}, theme: 'dark', callTool: (name, args) => window.editorCall(name, args) }; });
  await page.goto('about:blank'); await page.setContent(html);
  const mode = page.getByRole('button', { name: '保存方式', exact: true });
  await mode.getByText('手动保存', { exact: true }).waitFor(); assert.equal(await mode.textContent(), '手动保存');
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  await page.getByRole('button', { name: '文件列表', exact: true }).click();
  async function open(name, fixed = true) { await page.getByRole('treeitem', { name, exact: true })[fixed ? 'dblclick' : 'click'](); await page.getByRole('tab', { name, exact: true }).waitFor(); }
  const content = page.getByRole('textbox', { name: '文件正文', exact: true });
  async function append(text) { await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(text); }
  const saves = () => calls.filter(call => call.name === 'save_editor_text');
  await open('first.txt'); await append('manual'); await page.clock.runFor(2000);
  await open('second.txt'); await append('second-manual'); await page.getByRole('tab', { name: 'first.txt', exact: true }).click();
  assert.equal(saves().length, 0, '手动模式无自动写回');
  await mode.click(); await page.getByText('已保存', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'second.txt', exact: true }).locator('.dirty-indicator').waitFor({ state: 'hidden' });
  assert.equal(await mode.textContent(), '自动保存'); assert.equal(saves().length, 2, '切入自动立即保存全部已有脏正文');
  assert.ok((await readFile(join(workspaceRoot, 'second.txt'), 'utf8')).endsWith('second-manual'));
  await append('idle'); await page.clock.runFor(799); assert.equal(saves().length, 2);
  await page.clock.runFor(1); await page.getByText('已保存', { exact: true }).waitFor(); assert.equal(saves().length, 3);
  await append('cancel'); await page.clock.runFor(300); await mode.click(); await page.clock.runFor(1000);
  assert.equal(await mode.textContent(), '手动保存'); assert.equal(saves().length, 3, '切手动取消未开始定时任务');
  await mode.click(); await page.getByText('已保存', { exact: true }).waitFor();
  await append('switch'); await open('second.txt');
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]').textContent.includes('second.txt'));
  assert.ok((await readFile(join(workspaceRoot, 'first.txt'), 'utf8')).endsWith('switch'), '内部切页立即尝试保存旧页');
  await page.clock.runFor(900); assert.equal(saves().filter(call => call.args.path === 'first.txt').length, 4, '切页清除旧 idle 任务');
  console.log('自动触发契约通过：首次手动、切自动、800ms、切手动取消、内部切页');
  await page.getByRole('tab', { name: 'first.txt', exact: true }).click();
  hold('save_editor_text'); await append('pending'); await page.clock.runFor(800); await ready;
  await append('new'); await page.clock.runFor(800); release();
  await page.clock.runFor(800); await page.getByText('已保存', { exact: true }).waitFor();
  assert.ok((await readFile(join(workspaceRoot, 'first.txt'), 'utf8')).endsWith('pendingnew'));
  console.log('自动并发契约通过：保存等待期间新增输入不被旧回执覆盖，后续仍可自动保存');
  hold('save_editor_text'); await append('old-auto'); await page.clock.runFor(800); await ready;
  await append('manual-new'); await mode.click(); const pendingCount = saves().length; release();
  await page.getByText('未保存', { exact: true }).waitFor(); await page.clock.runFor(1000);
  assert.equal(saves().length, pendingCount, '切手动后旧回执不能重新调度自动保存');
  assert.ok((await content.textContent()).endsWith('manual-new')); assert.ok((await readFile(join(workspaceRoot, 'first.txt'), 'utf8')).endsWith('old-auto'));
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByText('已保存', { exact: true }).waitFor();
  console.log('切手动并发契约通过：在途保存继续返回，新输入仍未保存，未开始任务保持取消');
  await open('long.txt'); await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = 700; });
  await page.clock.runFor(16); const scroll = await page.locator('.cm-scroller').evaluate(el => el.scrollTop);
  await writeFile(join(workspaceRoot, 'replacement.tmp'), Array.from({ length: 150 }, (_, n) => `changed-${n}`).join('\n'));
  await rename(join(workspaceRoot, 'replacement.tmp'), join(workspaceRoot, 'long.txt'));
  await page.clock.runFor(1000); await page.locator('.cm-line').filter({ hasText: 'changed-' }).first().waitFor();
  await page.clock.runFor(16);
  assert.match(await content.textContent(), /changed-/); assert.equal(await page.locator('.cm-scroller').evaluate(el => el.scrollTop), scroll, '干净刷新保留有效阅读位置');
  console.log('干净外改契约通过：真实文件变化自动刷新，保留有效滚动位置');
  await page.getByRole('tab', { name: 'first.txt', exact: true }).click(); await mode.click();
  await append('local'); await writeFile(join(workspaceRoot, 'first.txt'), 'external\n');
  await page.clock.runFor(1000); await page.getByText(/磁盘内容已改变/).waitFor();
  assert.ok((await content.textContent()).endsWith('local')); const conflictedSaves = saves().length;
  await page.getByRole('button', { name: '保留编辑', exact: true }).click(); await append('kept'); await page.clock.runFor(2000);
  assert.equal(saves().length, conflictedSaves, '保留编辑不恢复自动写回或授权覆盖'); assert.equal(await readFile(join(workspaceRoot, 'first.txt'), 'utf8'), 'external\n');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByRole('dialog', { name: '重新读取文件', exact: true }).waitFor();
  await page.getByRole('button', { name: '取消重新读取', exact: true }).click(); assert.ok((await content.textContent()).endsWith('localkept'));
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click();
  await page.getByText('已读取', { exact: true }).waitFor(); assert.equal(await content.textContent(), 'external');
  await append('after'); await page.clock.runFor(800); await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(await readFile(join(workspaceRoot, 'first.txt'), 'utf8'), 'external\nafter');
  console.log('脏正文冲突契约通过：暂停该文件自动写回、保留不覆盖、取消/确认重新读取');
  await mode.click(); hold('read_editor_text'); await writeFile(join(workspaceRoot, 'first.txt'), 'changed-during-read\n');
  await page.clock.runFor(1000); await ready; await append('typed-during-read'); release();
  await page.getByText(/磁盘内容已改变/).waitFor(); assert.ok((await content.textContent()).endsWith('typed-during-read'), '外部读取等待时的新输入不能被干净刷新覆盖');
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click();
  await page.getByText('已读取', { exact: true }).waitFor(); await mode.click();
  console.log('外部读取并发契约通过：请求期间新增编辑保留并转为冲突');
  if (process.platform === 'win32') {
    const path = join(workspaceRoot, 'first.txt');
    const run = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop";' + script],
      { env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: path }, windowsHide: true, stdio: 'pipe' });
    run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Write","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
    try {
      await append('denied'); await page.clock.runFor(800); await page.getByText(/没有访问|拒绝访问/).waitFor();
      const deniedCount = saves().length; await page.clock.runFor(2000); assert.equal(saves().length, deniedCount);
      assert.equal(await readFile(path, 'utf8'), 'changed-during-read\n'); assert.ok((await content.textContent()).endsWith('denied'));
    } finally {
      run('$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;');
    }
    await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByText('已保存', { exact: true }).waitFor();
    console.log('写权限契约通过：真实临时文件 ACL 拒写保留正文、暂停自动，恢复权限后手动保存');
  }
  await rm(join(workspaceRoot, 'first.txt')); await page.clock.runFor(1000); await page.getByText(/不存在或已删除/).waitFor();
  await append('deleted'); const deletedSaves = saves().length; await page.clock.runFor(2000);
  assert.equal(saves().length, deletedSaves); assert.ok((await content.textContent()).endsWith('deleted'));
  failSettings = true; await mode.click(); await page.getByText(/数据库写入失败/).waitFor();
  assert.equal(await mode.textContent(), '自动保存', '设置失败不能假装已切换/保存');
  console.log('失败契约通过：文件删除保留正文并暂停自动，设置失败明确显示且不误报新模式');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
} finally { await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
