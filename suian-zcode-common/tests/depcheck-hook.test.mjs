import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runDepcheckHook, resolveDataDir } from '../depcheck-hook.mjs';
import { runAction, parseActionUri } from '../toast-action.mjs';
import { scanSuianPlugins } from '../depcheck.mjs';
import { buildFixPrompt } from '../depcheck-prompt.mjs';
import { buildWorld } from './depcheck-fixture.mjs';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

test('stop_hook_active 轮直接跳过且不触发扫描', async () => {
  let scanCalled = false;
  const result = await runDepcheckHook({
    payload: { stop_hook_active: true, session_id: 'sess_x' },
    dataDir: '.',
    scan: async () => { scanCalled = true; return { ok: true, issues: [] }; },
  });
  assert.equal(result.action, 'skipped_stale');
  assert.equal(scanCalled, false);
});

test('无效 stdin 载荷被忽略', async () => {
  const result = await runDepcheckHook({ payload: null, dataDir: '.' });
  assert.equal(result.action, 'ignored_invalid');
});

test('清单缺失时静默跳过且不安装身份不发通知', async t => {
  const world = await buildWorld(t);
  let identityCalled = false;
  let notifyCalled = false;
  const result = await runDepcheckHook({
    payload: { session_id: 'sess_x' },
    dataDir: join(world.root, 'data'),
    scan: () => scanSuianPlugins({ pluginsFile: join(world.root, 'absent.json') }),
    ensureIdentity: async () => { identityCalled = true; return { action: 'cached' }; },
    notify: async () => { notifyCalled = true; return { shown: true }; },
  });
  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, 'no_manifest');
  assert.equal(identityCalled, false);
  assert.equal(notifyCalled, false);
});

test('依赖齐全时只落盘检查结果，不安装身份不发通知', async t => {
  const world = await buildWorld(t);
  const dataDir = join(world.root, 'data');
  let identityCalled = false;
  let notifyCalled = false;
  const result = await runDepcheckHook({
    payload: { session_id: 'sess_x' },
    dataDir,
    scan: () => scanSuianPlugins({ homeDir: world.homeDir }),
    ensureIdentity: async () => { identityCalled = true; return { action: 'cached' }; },
    notify: async () => { notifyCalled = true; return { shown: true }; },
  });
  assert.equal(result.action, 'clean');
  assert.equal(identityCalled, false);
  assert.equal(notifyCalled, false);
  const persisted = JSON.parse(await readFile(join(dataDir, 'depcheck-last.json'), 'utf8'));
  assert.equal(persisted.ok, true);
});

test('发现缺失时先确保 Toast 身份再以修复引导文案通知', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-side-editor'], 'node_modules', 'suian-zcode-common'));
  const dataDir = join(world.root, 'data');
  const calls = { identity: [], notify: [] };
  const result = await runDepcheckHook({
    payload: { session_id: 'sess_x' },
    dataDir,
    scan: () => scanSuianPlugins({ homeDir: world.homeDir }),
    ensureIdentity: async arg => { calls.identity.push(arg); return { action: 'installed' }; },
    notify: async arg => { calls.notify.push(arg); return { shown: true }; },
  });
  assert.equal(result.action, 'notified');
  assert.equal(result.issues, 1);
  assert.equal(result.shown, true);
  assert.deepEqual(calls.identity, [{ dataDir }]);
  assert.equal(calls.notify.length, 1);
  assert.match(calls.notify[0].message, /suian-side-editor 0\.2\.0/);
  assert.match(calls.notify[0].message, /缺公共包链接/);
  assert.match(calls.notify[0].message, /点击按钮复制修复提示词/);
  const persisted = JSON.parse(await readFile(join(dataDir, 'depcheck-last.json'), 'utf8'));
  assert.equal(persisted.issues[0].code, 'common_link_missing');
});

test('通知处于冷却（shown:false）时不视为错误', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-zcode-title'], 'node_modules', 'suian-zcode-common'));
  const result = await runDepcheckHook({
    payload: { session_id: 'sess_x' },
    dataDir: join(world.root, 'data'),
    scan: () => scanSuianPlugins({ homeDir: world.homeDir }),
    ensureIdentity: async () => ({ action: 'cached' }),
    notify: async () => ({ shown: false, reason: 'cooldown' }),
  });
  assert.equal(result.action, 'notified');
  assert.equal(result.shown, false);
  assert.equal(result.toastReason, 'cooldown');
});

test('Toast 按钮动作对缺失世界复制含修复步骤的提示词并打开工作区', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-side-editor'], 'node_modules', 'suian-zcode-common'));
  const clipboard = [];
  const opened = [];
  const result = await runAction({
    uri: 'suian-zcode-common://fix',
    dataDir: join(world.root, 'data'),
    homeDir: world.homeDir,
    setClipboard: async text => { clipboard.push(text); },
    openWorkspace: async uri => { opened.push(uri); },
  });
  assert.deepEqual(result, { ok: true, action: 'fix', issues: 1 });
  assert.equal(clipboard.length, 1);
  const prompt = clipboard[0];
  assert.match(prompt, /suian-side-editor 0\.2\.0：缺少 node_modules\/suian-zcode-common 公共包链接/);
  assert.match(prompt, /suian-zcode-common:setup/);
  assert.match(prompt, /link\.mjs --plugin-root/);
  assert.match(prompt, /depcheck-hook\.mjs --scan-only/);
  assert.match(prompt, new RegExp(world.installPaths['suian-zcode-common'].replace(/\\/g, '\\\\')));
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^zcode:\/\/workspace\/open\?path=/);
});

test('按钮动作在依赖已修复后复制复查通过说明', async t => {
  const world = await buildWorld(t);
  const clipboard = [];
  const result = await runAction({
    uri: 'suian-zcode-common://fix',
    dataDir: join(world.root, 'data'),
    homeDir: world.homeDir,
    setClipboard: async text => { clipboard.push(text); },
    openWorkspace: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.issues, 0);
  assert.match(clipboard[0], /复查通过/);
});

test('协议 URI 解析：合法 fix 动作放行，非法与未知动作被拒绝', async () => {
  assert.deepEqual(parseActionUri('suian-zcode-common://fix'), { action: 'fix' });
  assert.equal(parseActionUri('https://example.com'), null);
  assert.deepEqual(parseActionUri('suian-zcode-common://unknown'), { action: 'unknown' });
  const result = await runAction({ uri: 'suian-zcode-common://unknown', dataDir: '.' });
  assert.deepEqual(result, { ok: false, reason: 'unknown_action' });
  const invalid = await runAction({ uri: 'not-a-uri', dataDir: '.' });
  assert.deepEqual(invalid, { ok: false, reason: 'invalid_uri' });
});

test('数据目录解析：宿主注入 ZCODE_PLUGIN_DATA 时挂 state 子目录', () => {
  assert.equal(resolveDataDir({ ZCODE_PLUGIN_DATA: 'C:\\plugin-data' }), join('C:\\plugin-data', 'state'));
  assert.equal(resolveDataDir({}), join(homedir(), '.zcode', 'suian-zcode-common'));
});

test('宿主冒烟：齐全世界 Stop 载荷正常退出且落盘检查结果', async t => {
  const world = await buildWorld(t);
  const dataDir = join(world.root, 'host-data');
  const hook = JSON.parse(await readFile(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks.Stop[0].hooks[0];
  assert.equal(hook.async, true, 'Stop 依赖检查必须异步注册以免阻塞对话');
  assert.equal(hook.timeoutMs >= 30000, true);
  const command = hook.command.replaceAll('${ZCODE_PLUGIN_ROOT}', pluginRoot);
  const stopped = spawnSync(command, {
    shell: true, windowsHide: true, encoding: 'utf8',
    input: JSON.stringify({ session_id: 'sess_smoke_fixture', cwd: world.root, hook_event_name: 'Stop' }),
    env: { ...process.env, ZCODE_PLUGIN_DATA: dataDir, SUIAN_DEPCHECK_HOME: world.homeDir, OIL_ZCODE_TITLE_DATA: undefined },
  });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.ok(!stopped.stdout.trimStart().startsWith('{'), 'stdout 不得以 { 开头');
  assert.match(stopped.stdout, /"action":"clean"/);
  const persisted = JSON.parse(await readFile(join(dataDir, 'state', 'depcheck-last.json'), 'utf8'));
  assert.equal(persisted.ok, true);
  const log = (await readFile(join(dataDir, 'state', 'hook.log.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(log.at(-1).action, 'clean');
});

test('宿主冒烟：非法 stdin 与续跑轮不崩且不扫真实缓存', async t => {
  const world = await buildWorld(t);
  const dataDir = join(world.root, 'host-data2');
  const command = `node "${join(pluginRoot, 'depcheck-hook.mjs')}"`;
  for (const [input, expected] of [
    ['not-json', /ignored_invalid/],
    [JSON.stringify({ stop_hook_active: true, session_id: 'sess_x' }), /skipped_stale/],
  ]) {
    const stopped = spawnSync(command, {
      shell: true, windowsHide: true, encoding: 'utf8', input,
      env: { ...process.env, ZCODE_PLUGIN_DATA: dataDir, SUIAN_DEPCHECK_HOME: world.homeDir, OIL_ZCODE_TITLE_DATA: undefined },
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.stdout, expected);
  }
});

test('修复提示词模板：缺失明细与缓存根一一对应', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-zcode-app-mcp'], 'node_modules', 'zod'), { recursive: true, force: true });
  await rm(world.runtimeRoot);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  const prompt = buildFixPrompt(result);
  assert.match(prompt, /suian-zcode-app-mcp 0\.4\.2：.*npm 生产依赖未安装（zod）/);
  assert.match(prompt, /公共稳定入口 runtime 链接缺失/);
  for (const def of world.defs) assert.match(prompt, new RegExp(def.name));
});
