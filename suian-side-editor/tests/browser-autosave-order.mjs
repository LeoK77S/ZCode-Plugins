import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, EDITOR_URI } from '../server.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');

async function withEditor(action, { saveMode = 'auto', pendingSettings = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-order-'));
  const workspaceRoot = join(root, 'workspace'), dataPath = join(root, 'data');
  await mkdir(workspaceRoot); await mkdir(dataPath); await writeFile(join(workspaceRoot, 'file.txt'), 'original\n');
  const server = createMcpServer({ workspaceRoot, dataPath, zcodeAppVersion: '3.15.1' });
  const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  let browser;
  try {
    await server.connect(st); await client.connect(ct);
    // 新页面会话继承另一个可信会话更新的全局默认，仍经过真实模式工具和数据库。
    const seeded = await client.callTool({ name: 'update_editor_settings', arguments: { saveMode }, _meta: { session_id: 'order-default-fixture' } });
    assert.equal(seeded.isError, undefined);
    const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(1800); await page.clock.install();
    const calls = [], errors = [], requests = [];
    const holds = new Map();
    function hold(name) {
      const token = {};
      token.ready = new Promise(resolve => { token.arrived = resolve; });
      token.cancel = () => { if (holds.get(name) === token) holds.delete(name); };
      holds.set(name, token); return token;
    }
    const settings = pendingSettings ? hold('get_editor_settings') : undefined;
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await page.exposeFunction('editorCall', async (name, args) => {
      calls.push({ name, args });
      const result = await client.callTool({ name, arguments: args, _meta: { session_id: 'order-page-fixture' } });
      const token = holds.get(name);
      if (token) {
        holds.delete(name);
        return new Promise(resolve => { token.release = () => resolve(result); token.arrived(); });
      }
      return result;
    });
    await installResourceBridge(page, client);
    await page.goto('about:blank'); await page.setContent(html);
    const mode = page.getByRole('button', { name: '保存方式', exact: true });
    if (pendingSettings) await settings.ready;
    else await mode.getByText(saveMode === 'auto' ? '自动保存' : '手动保存', { exact: true }).waitFor();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));
    await page.getByRole('button', { name: '文件列表', exact: true }).click();
    await page.getByRole('treeitem', { name: 'file.txt', exact: true }).click();
    const content = page.getByRole('textbox', { name: '文件正文', exact: true }); await content.waitFor();
    async function append(text) { await content.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(text); }
    const saves = () => calls.filter(call => call.name === 'save_editor_text');
    await action({ page, mode, content, append, saves, hold, releaseSettings: () => settings.release(),
      filePath: join(workspaceRoot, 'file.txt'), disk: () => readFile(join(workspaceRoot, 'file.txt'), 'utf8') });
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await browser?.close(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
}

test('在途保存期间 B 的计时到期后继续输入 C，旧回执不能提前 C 的 800ms 保存', async () => {
  await withEditor(async ({ page, append, saves, hold, disk }) => {
    const pending = hold('save_editor_text'); await append('A'); await page.clock.runFor(800); await pending.ready;
    await append('B'); await page.clock.runFor(800);
    await append('C'); await page.clock.runFor(100); pending.release();
    await page.getByText('未保存', { exact: true }).waitFor(); await page.clock.runFor(1);
    assert.equal(saves().length, 1, 'C 输入后101ms，旧回执不得写回 B+C');
    assert.equal(await disk(), 'original\nA');
    await page.clock.runFor(698); assert.equal(saves().length, 1, 'C 输入后799ms仍不写回');
    await page.clock.runFor(1); await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal(saves().length, 2); assert.equal(await disk(), 'original\nABC');
  });
});

test('继承 Auto 的模式回执等待时先编辑，已停止输入800ms的正文在回执后继续保存', async () => {
  await withEditor(async ({ page, mode, append, saves, releaseSettings, disk }) => {
    await append('pending'); await page.clock.runFor(800); assert.equal(saves().length, 0);
    releaseSettings(); await mode.getByText('自动保存', { exact: true }).waitFor(); await page.clock.runFor(1);
    assert.equal(saves().length, 1, 'Auto 回执到达后不能遗漏初始化期间已经到期的编辑');
    await page.getByText('已保存', { exact: true }).waitFor(); assert.equal(await disk(), 'original\npending');
  }, { pendingSettings: true });
});

test('继承 Auto 的回执到达时距离最后输入不足800ms，保存仍按最后输入计算', async () => {
  await withEditor(async ({ page, mode, append, saves, releaseSettings, disk }) => {
    await append('recent'); await page.clock.runFor(100);
    releaseSettings(); await mode.getByText('自动保存', { exact: true }).waitFor(); await page.clock.runFor(699);
    assert.equal(saves().length, 0, '模式读取回执不能让最近输入提前保存');
    await page.clock.runFor(1); await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal(saves().length, 1); assert.equal(await disk(), 'original\nrecent');
  }, { pendingSettings: true });
});

test('继承 Manual 的模式回执等待时先编辑，回执之后保持未保存且不安排自动写回', async () => {
  await withEditor(async ({ page, mode, append, saves, releaseSettings, disk }) => {
    await append('manual'); await page.clock.runFor(800); releaseSettings();
    await mode.getByText('手动保存', { exact: true }).waitFor(); await page.clock.runFor(1000);
    assert.equal(saves().length, 0); assert.equal(await disk(), 'original\n');
    await page.getByText('未保存', { exact: true }).waitFor();
  }, { saveMode: 'manual', pendingSettings: true });
});

for (const order of ['save-first', 'read-first']) {
  test(`权限恢复后确认重新读取，不允许旧读取回退新保存（${order}）`, { skip: process.platform !== 'win32' }, async () => {
    await withEditor(async ({ page, append, saves, hold, filePath, disk }) => {
      const run = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop";' + script],
        { env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: filePath }, windowsHide: true, stdio: 'pipe' });
      await append('local');
      run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Write","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
      try {
        await page.keyboard.press('Control+s'); await page.getByText(/没有访问|拒绝访问/).waitFor();
        assert.equal(await disk(), 'original\n', '权限失败没有改变磁盘基线');
      } finally {
        run('$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;');
      }
      const reading = hold('read_editor_text');
      await page.getByRole('button', { name: '重新读取', exact: true }).click();
      await page.getByRole('button', { name: '放弃编辑并重新读取', exact: true }).click(); await reading.ready;
      const saving = hold('save_editor_text'), attempts = saves().length;
      const saveButton = page.getByRole('button', { name: '保存', exact: true });
      const disabledDuringRead = await saveButton.isDisabled();
      await page.getByRole('textbox', { name: '文件正文', exact: true }).focus(); await page.keyboard.press('Control+s');
      await page.getByRole('button', { name: '文件列表', exact: true }).focus(); await page.keyboard.press('Control+s');
      await page.clock.runFor(1);
      if (saves().length > attempts) {
        // 如果产品允许并发保存，两种真实回执顺序都必须保留较新的已保存正文。
        await saving.ready; assert.equal(await disk(), 'original\nlocal');
        if (order === 'save-first') {
          saving.release(); await page.getByText('已保存', { exact: true }).waitFor(); reading.release();
          await page.getByText('已读取', { exact: true }).waitFor();
          assert.deepEqual(await page.locator('.cm-line').allTextContents(), ['original', 'local'], '旧读取回执不能回退较新的保存正文');
        } else {
          reading.release(); await page.locator('.cm-line').nth(1).filter({ hasText: /^$/ }).waitFor(); saving.release();
          await page.getByText('未保存', { exact: true }).waitFor(); await page.clock.runFor(801);
          await page.getByText('已保存', { exact: true }).waitFor();
          assert.equal(await disk(), 'original\nlocal', '旧读取正文不能在新保存回执后被 Auto 写回');
        }
      } else {
        // 最小的合法策略是重新读取期间禁止保存，UI 和两种 Ctrl+S 入口必须一致。
        assert.equal(disabledDuringRead, true, '读取期间按钮不能声称可保存');
        assert.equal(saves().length, attempts);
        saving.cancel();
        reading.release(); await page.getByText('已读取', { exact: true }).waitFor();
        assert.equal(await disk(), 'original\n'); assert.deepEqual(await page.locator('.cm-line').allTextContents(), ['original', '']);
        await append('after-reload'); await page.keyboard.press('Control+s'); await page.getByText('已保存', { exact: true }).waitFor();
        assert.equal(await disk(), 'original\nafter-reload', '重读结束后正常编辑和手动保存仍可用');
      }
    }, { saveMode: order === 'read-first' ? 'auto' : 'manual' });
  });
}
