import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from './fixtures.mjs';
import { EDITOR_URI } from '../server.mjs';
import { installResourceBridge } from './browser-resource-bridge.mjs';
const { chromium } = createRequire(process.env.SUIAN_SIDE_EDITOR_PLAYWRIGHT_MODULE ?? import.meta.url)('playwright');

test('工作区下拉切换目录，左上角显示路径，两个目录的同名页签与未保存正文分别恢复', { timeout: 25000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'editor-roots-ui-'));
  let db, browser;
  t.after(async () => { await browser?.close(); db?.close(); await rm(dir, { recursive: true }); });
  const first = join(dir, 'first'), second = join(dir, 'second');
  for (const [path, content] of [[first, 'AAA'], [second, 'BBB']]) { await mkdir(path); await writeFile(join(path, 'same.txt'), content); }
  const indexDbPath = join(dir, 'index.sqlite'); db = new DatabaseSync(indexDbPath);
  db.exec(`CREATE TABLE tasks (task_id TEXT, workspace_key TEXT, workspace_path TEXT, workspace_identity TEXT, root_path TEXT, host_id TEXT, project_id TEXT, execution_directories TEXT);
    CREATE TABLE projects (project_id TEXT, host_id TEXT, name TEXT, deleted INTEGER);
    CREATE TABLE project_roots (project_id TEXT, root_path TEXT, position INTEGER, is_primary INTEGER);`);
  db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run('session_ui', first, first, null, first, 'local', 'project_ui', null);
  db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run('project_ui', 'local', '项目', 0);
  for (const [i, path] of [first, second].entries()) db.prepare('INSERT INTO project_roots VALUES (?,?,?,?)').run('project_ui', path, i, Number(i === 0));
  const client = await connect(t, { workspaceRoot: first, indexDbPath, dataPath: join(dir, 'data'), zcodeAppVersion: '3.16.1' });
  const html = (await client.readResource({ uri: EDITOR_URI })).contents[0].text;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const saveGate = Promise.withResolvers(), saveStarted = Promise.withResolvers();
  const recoveryGate = Promise.withResolvers(), recoveryStarted = Promise.withResolvers();
  const resourceGate = Promise.withResolvers(), resourceStarted = Promise.withResolvers();
  let holdResource = false, holdRecovery = false;
  t.after(() => { saveGate.resolve(); recoveryGate.resolve(); resourceGate.resolve(); });
  const invoke = async (name, args) => {
    if (name === 'save_editor_text') { saveStarted.resolve(); await saveGate.promise; }
    if (name === 'update_editor_state' && holdRecovery) {
      holdRecovery = false; recoveryStarted.resolve(); await recoveryGate.promise;
      return { isError: true, structuredContent: { error: 'fixture recovery write failed' } };
    }
    return client.callTool({ name, arguments: args, _meta: { session_id: 'session_ui' } });
  };
  await page.exposeFunction('editorCall', invoke);
  const bridgeCalls = await installResourceBridge(page, client, { read: async (result, uri) => {
    if (holdResource) { holdResource = false; resourceStarted.resolve(uri); await resourceGate.promise; }
    return result;
  } });
  await page.goto('about:blank'); await page.setContent(html);
  await page.getByRole('button', { name: '文件列表', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#folder').disabled);
  assert.equal(await page.locator('#workspace-path').textContent(), first);
  await page.getByRole('button', { name: '文件列表', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '切换工作区' }).count(), 1, '文件树上方提供工作区选择器');
  const select = page.getByRole('combobox', { name: '切换工作区' });
  await page.getByRole('treeitem', { name: 'same.txt', exact: true }).click();
  const content = page.getByRole('textbox', { name: '文件正文', exact: true });
  holdRecovery = true;
  await content.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' draft-A');
  await recoveryStarted.promise;
  assert.equal(await select.isDisabled(), true, '自动恢复副本请求已在途时必须禁用目录切换');
  recoveryGate.resolve();
  await page.waitForFunction(() => !document.querySelector('#workspace-select').disabled);
  await page.getByText('恢复副本失败：fixture recovery write failed', { exact: true }).waitFor();
  assert.equal(await page.locator('#workspace-path').textContent(), first);
  assert.equal(await content.textContent(), 'AAA draft-A', '失败副本回执后仍保留原目录和未保存正文');
  await select.selectOption(second);
  await page.waitForFunction(path => document.querySelector('#workspace-path').textContent === path && !document.body.inert, second);
  await page.getByRole('treeitem', { name: 'same.txt', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'BBB');
  await content.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' draft-B');
  await select.selectOption(first);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'AAA draft-A' && !document.body.inert);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await saveStarted.promise;
  assert.equal(await select.isDisabled(), true, '保存回执到达前不能切换目录');
  saveGate.resolve();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(await readFile(join(first, 'same.txt'), 'utf8'), 'AAA draft-A');
  assert.equal(await readFile(join(second, 'same.txt'), 'utf8'), 'BBB');
  const sourceUri = bridgeCalls.filter(call => call.method === 'resources/subscribe').at(-1).uri;
  await page.evaluate(() => {
    const read = window.zcode.readResource;
    window.zcode.readResource = async uri => {
      try { return await read(uri); } finally { window.lastResourceReturned = uri; }
    };
  });
  holdResource = true;
  await writeFile(join(first, 'same.txt'), 'AAA external');
  await page.evaluate(uri => window.editorResourceUpdated(uri), sourceUri);
  const pendingUri = await resourceStarted.promise;
  await select.selectOption(second);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'BBB draft-B' && !document.body.inert);
  assert.equal(await page.locator('#workspace-path').textContent(), second);
  resourceGate.resolve();
  await page.waitForFunction(uri => window.lastResourceReturned === uri, pendingUri);
  assert.equal(await content.textContent(), 'BBB draft-B', '旧目录资源迟到回执不能覆盖新目录正文');
  assert.deepEqual(errors, []);
  if (process.env.SUIAN_SIDE_EDITOR_SCREENSHOT_DIR) { await mkdir(process.env.SUIAN_SIDE_EDITOR_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.SUIAN_SIDE_EDITOR_SCREENSHOT_DIR, 'multi-root.png') }); }
  await page.close();
  const reopened = await browser.newPage();
  await reopened.exposeFunction('editorCall', invoke); await installResourceBridge(reopened, client);
  await reopened.goto('about:blank'); await reopened.setContent(html);
  await reopened.waitForFunction(() => !document.body.inert && !document.querySelector('#folder').disabled);
  await reopened.getByRole('button', { name: '文件列表', exact: true }).click();
  await reopened.getByRole('combobox', { name: '切换工作区' }).selectOption(second);
  await reopened.waitForFunction(() => !document.body.inert && document.querySelector('.cm-content')?.textContent === 'BBB draft-B');
});
