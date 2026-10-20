// PKG-04 发布包浏览器烟测：实际构建 editor.html + 独立安装根中真实 stdio 进程，
// 覆盖打开文件、编辑保存、模式切换、恢复副本重开与无网关时评论入口不可用；
// 页面全程不请求开发服务器或本机源码路径，授权语义仍走原 MCP 工具。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildEditorRelease } from '../build-release.mjs';
import { ensureCommonFixture } from './common-fixture.mjs';
import { apps } from './fixtures.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';

const require = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url);
const { chromium } = require('playwright');
const EDITOR_URI = 'ui://suian-side-editor/editor.html';

test('发布包实际页面经真实 stdio：打开、保存、模式、恢复重开与评论入口不可用', { timeout: 60000 }, async t => {
  const fixture = await ensureCommonFixture();
  const out = await mkdtemp(join(tmpdir(), 'pkg04-browser-'));
  const built = await buildEditorRelease({ outDir: join(out, 'release') });
  const install = join(out, 'installed');
  await cp(built.releaseDir, install, { recursive: true });
  // 宿主 cwd 语义（ZCODE_PROJECT_DIR）在安装根之外，避免测试收尾的目录锁。
  const hostCwd = join(out, 'host-cwd');
  await mkdir(hostCwd, { recursive: true });
  const workspaceRoot = join(out, 'workspace');
  await mkdir(workspaceRoot);
  await writeFile(join(workspaceRoot, 'note.txt'), '第一行\r\nsecond line\r\n');
  const env = {
    ZCODE_PLUGIN_DATA: fixture.dataPath,
    SUIAN_SIDE_EDITOR_WORKSPACE: workspaceRoot,
    SUIAN_SIDE_EDITOR_INDEX_DB: join(out, 'index.sqlite'),
    SUIAN_SIDE_EDITOR_GATEWAY_CONFIG: join(out, 'missing-gateway.json'),
    ZCODE_APP_VERSION: '3.15.1',
  };
  const meta = { session_id: 'pkg04-browser-fixture' };
  const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(install, 'cli.mjs')], cwd: hostCwd, env, stderr: 'pipe',
  });
  transport.stderr.resume();
  await client.connect(transport);
  t.after(() => client.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
  const requests = [], errors = [], toolCalls = [];
  async function openPage() {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(4000);
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => { errors.push(error.message); console.error('浏览器异常：', error.message); });
    await page.exposeFunction('editorCall', async (name, args) => {
      toolCalls.push(name);
      return client.callTool({ name, arguments: args, _meta: meta });
    });
    await installResourceBridge(page, client);
    await page.goto('data:text/html,<!doctype html><html><body></body></html>');
    await page.setContent(html);
    return page;
  }

  // 打开文件
  const first = await openPage();
  await first.getByRole('button', { name: '文件列表', exact: true }).click();
  await first.getByRole('treeitem', { name: 'note.txt', exact: true }).dblclick();
  const content = first.getByRole('textbox', { name: '文件正文', exact: true });
  await content.waitFor();
  assert.equal(await first.locator('.cm-line').first().textContent(), '第一行');

  // 编辑并手动保存（回执与磁盘字节分离验证）
  await content.focus();
  await first.keyboard.press('Control+End');
  await first.keyboard.type('追加');
  await first.getByRole('button', { name: '保存', exact: true }).click();
  await first.getByText('已保存', { exact: true }).waitFor();
  assert.ok((await readFile(join(workspaceRoot, 'note.txt'), 'utf8')).endsWith('追加'), '保存必须写回磁盘源文件');

  // 模式切换（手动→自动，事务落外置状态库）
  const mode = first.getByRole('button', { name: '保存方式', exact: true });
  assert.equal(await mode.textContent(), '手动保存');
  await mode.click();
  await first.waitForFunction(() => document.querySelector('button')?.textContent, { timeout: 4000 }).catch(() => {});
  await first.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '自动保存'));
  assert.equal(await mode.textContent(), '自动保存');

  // 恢复副本：脏正文等待副本同步回执后重开页面，从外置状态库恢复页签与草稿
  await content.focus();
  await first.keyboard.press('Control+End');
  await first.keyboard.type('草稿');
  await first.getByText('恢复副本已同步', { exact: true }).waitFor();
  await first.close();
  const second = await openPage();
  await second.getByRole('tab', { name: 'note.txt', exact: true }).waitFor();
  const restored = second.getByRole('textbox', { name: '文件正文', exact: true });
  await restored.waitFor();
  assert.match(await restored.textContent(), /草稿/, '重开页面应从外置恢复副本还原未保存草稿');

  // 评论入口：无网关时状态明确不可用，选区后按钮禁用；文本编辑不受影响
  const commentState = (await client.callTool({ name: 'get_editor_comment_state', arguments: {}, _meta: meta })).structuredContent;
  assert.equal(commentState.state, 'unknown');
  assert.ok(commentState.reason.length > 0);
  await restored.focus();
  await second.keyboard.press('Control+Home');
  await second.keyboard.press('Shift+End');
  const commentButton = second.getByRole('button', { name: '评论选区', exact: true });
  await second.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '评论选区');
    return button && button.disabled === true;
  });
  assert.equal(await commentButton.isDisabled(), true, '无网关时评论入口必须禁用');
  await restored.focus();
  await second.keyboard.press('Control+End');
  await second.keyboard.type('继续编辑');
  await second.getByText('未保存', { exact: true }).waitFor();

  // 页面自包含：不请求开发服务器、本机 file URL 或绝对源码路径
  assert.ok(requests.every(url => url.startsWith('data:')), `页面不得发起网络或 file 请求，实际：${JSON.stringify(requests)}`);
  assert.equal(errors.length, 0, '页面运行期不得出现未处理异常');
  assert.ok(toolCalls.includes('read_editor_text') && toolCalls.includes('save_editor_text')
    && toolCalls.includes('update_editor_state'), `发布页面应走原 MCP 工具，实际调用：${JSON.stringify([...new Set(toolCalls)])}`);
  await second.close();
});
