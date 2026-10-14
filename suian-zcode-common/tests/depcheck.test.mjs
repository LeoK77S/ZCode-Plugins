import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, symlink, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { scanSuianPlugins } from '../depcheck.mjs';
import { buildWorld } from './depcheck-fixture.mjs';

const linkType = () => (process.platform === 'win32' ? 'junction' : 'dir');

const issueKeys = result => result.issues.map(i => `${i.plugin}:${i.code}`);

test('齐全世界（真实 npm 目录 + 两级 junction）扫描通过且忽略非 suian 插件', async t => {
  const world = await buildWorld(t);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.plugins.map(p => p.name).sort(), ['suian-side-editor', 'suian-zcode-app-mcp', 'suian-zcode-common', 'suian-zcode-title']);
});

test('业务插件缺公共包 junction（本机 side-editor 0.2.0 判例）报 common_link_missing', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-side-editor'], 'node_modules', 'suian-zcode-common'));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.equal(result.ok, false);
  assert.deepEqual(issueKeys(result), ['suian-side-editor:common_link_missing']);
});

test('node_modules 整体缺失（npm ci 未跑形态）同时报 npm 依赖与公共包链接缺失', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-side-editor'], 'node_modules'), { recursive: true, force: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  const keys = issueKeys(result);
  assert.ok(keys.includes('suian-side-editor:npm_dependency_missing'));
  assert.ok(keys.includes('suian-side-editor:common_link_missing'));
  const npmIssue = result.issues.find(i => i.code === 'npm_dependency_missing');
  assert.match(npmIssue.detail, /@modelcontextprotocol\/sdk/);
  assert.match(npmIssue.detail, /zod/);
});

test('单个 npm 生产依赖缺失报 npm_dependency_missing 且不影响其余判定', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-zcode-app-mcp'], 'node_modules', 'zod'), { recursive: true, force: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-app-mcp:npm_dependency_missing']);
  const npmIssue = result.issues.find(i => i.code === 'npm_dependency_missing');
  assert.equal(npmIssue.detail, 'zod');
});

test('common 自身 npm 依赖（ws）缺失同样被报告', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-zcode-common'], 'node_modules', 'ws'), { recursive: true, force: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:npm_dependency_missing']);
});

test('插件缓存目录缺失报 cache_missing', async t => {
  const world = await buildWorld(t);
  await rm(world.installPaths['suian-zcode-title'], { recursive: true, force: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:cache_missing']);
});

test('公共包入口被真实目录占据（link.mjs 拒绝覆盖的形态）报 common_link_not_symlink', async t => {
  const world = await buildWorld(t);
  const linkPath = join(world.installPaths['suian-zcode-title'], 'node_modules', 'suian-zcode-common');
  await rm(linkPath);
  await mkdir(linkPath, { recursive: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:common_link_not_symlink']);
});

test('业务链接指向非 runtime 位置报 common_link_mismatch', async t => {
  const world = await buildWorld(t);
  const linkPath = join(world.installPaths['suian-zcode-title'], 'node_modules', 'suian-zcode-common');
  await rm(linkPath);
  await symlink(world.installPaths['suian-zcode-common'], linkPath, linkType());
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:common_link_mismatch']);
});

test('runtime 入口缺失报 runtime_missing（全局 issue 归 common）', async t => {
  const world = await buildWorld(t);
  await rm(world.runtimeRoot);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:runtime_missing']);
});

test('runtime 链接悬空（目标目录不存在）报 runtime_target_missing', async t => {
  const world = await buildWorld(t);
  await rm(world.runtimeRoot);
  await symlink(join(world.root, 'ghost-common'), world.runtimeRoot, linkType());
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:runtime_target_missing']);
});

test('runtime 指向旧版本缓存（common 升级后未重跑 link）报 runtime_stale', async t => {
  const world = await buildWorld(t);
  const newer = join(dirname(world.installPaths['suian-zcode-common']), '0.3.0');
  await mkdir(join(newer, '.zcode-plugin'), { recursive: true });
  await writeFile(join(newer, 'package.json'), JSON.stringify({ name: 'suian-zcode-common', dependencies: { ws: '8.22.0' } }));
  await writeFile(join(newer, '.zcode-plugin', 'plugin.json'), JSON.stringify({ name: 'suian-zcode-common', version: '0.3.0' }));
  await mkdir(join(newer, 'node_modules', 'ws'), { recursive: true });
  await rm(world.runtimeRoot);
  await symlink(newer, world.runtimeRoot, linkType());
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:runtime_stale']);
  assert.match(result.issues[0].detail, /0\.3\.0/);
});

test('runtime 目标不属于 suian-zcode-common 报 runtime_target_invalid', async t => {
  const world = await buildWorld(t);
  const alien = join(world.root, 'alien-pkg');
  await mkdir(alien, { recursive: true });
  await writeFile(join(alien, 'package.json'), JSON.stringify({ name: 'not-suian-common' }));
  await rm(world.runtimeRoot);
  await symlink(alien, world.runtimeRoot, linkType());
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:runtime_target_invalid']);
});

test('清单缺失时静默跳过本轮（skipped=no_manifest 且 ok）', async t => {
  const world = await buildWorld(t);
  const result = await scanSuianPlugins({ pluginsFile: join(world.root, 'absent.json') });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'no_manifest');
  assert.deepEqual(result.issues, []);
});

test('清单损坏时静默跳过本轮（skipped=bad_manifest 且 ok）', async t => {
  const world = await buildWorld(t);
  await writeFile(world.pluginsFile, '{broken json', 'utf8');
  const result = await scanSuianPlugins({ pluginsFile: world.pluginsFile });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'bad_manifest');
});

test('清单为合法 JSON 但非对象（null/数组）按 bad_manifest 静默跳过', async t => {
  const world = await buildWorld(t);
  for (const content of ['null', '["suian"]', '42']) {
    await writeFile(world.pluginsFile, content, 'utf8');
    const result = await scanSuianPlugins({ pluginsFile: world.pluginsFile });
    assert.equal(result.skipped, 'bad_manifest', `内容 ${content} 应判 bad_manifest`);
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  }
});

test('清单 plugins 字段类型异常按 bad_manifest 静默跳过', async t => {
  const world = await buildWorld(t);
  await writeFile(world.pluginsFile, JSON.stringify({ version: 1, plugins: { suian: {} } }), 'utf8');
  const result = await scanSuianPlugins({ pluginsFile: world.pluginsFile });
  assert.equal(result.skipped, 'bad_manifest');
});

test('插件文件残缺（package.json 缺失）报 plugin_files_missing', async t => {
  const world = await buildWorld(t);
  await rm(join(world.installPaths['suian-zcode-title'], 'package.json'));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:plugin_files_missing']);
});

test('runtime 稳定入口被真实目录占据报 runtime_not_symlink', async t => {
  const world = await buildWorld(t);
  await rm(world.runtimeRoot);
  await mkdir(world.runtimeRoot, { recursive: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:runtime_not_symlink']);
});

test('唯一消费者缓存目录缺失时仍依据清单依赖驱动 runtime 检查（复合故障不漏报）', async t => {
  const world = await buildWorld(t);
  // title/app-mcp/side-editor 三个消费者全部移除缓存目录，只留清单条目
  for (const name of ['suian-zcode-title', 'suian-zcode-app-mcp', 'suian-side-editor']) {
    await rm(world.installPaths[name], { recursive: true, force: true });
  }
  await rm(world.runtimeRoot);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  const keys = issueKeys(result);
  assert.ok(keys.includes('suian-zcode-title:cache_missing'));
  assert.ok(keys.includes('suian-zcode-app-mcp:cache_missing'));
  assert.ok(keys.includes('suian-side-editor:cache_missing'));
  assert.ok(keys.includes('suian-zcode-common:runtime_missing'), '清单层依赖声明应继续驱动 runtime 检查');
});

test('业务插件在册但 common 未安装报 common_not_installed', async t => {
  const world = await buildWorld(t);
  const manifest = JSON.parse(await readFile(world.pluginsFile, 'utf8'));
  manifest.plugins = manifest.plugins.filter(p => p.name !== 'suian-zcode-common');
  await writeFile(world.pluginsFile, JSON.stringify(manifest));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:common_not_installed']);
});

test('仅装 common 无业务插件时不检查 runtime（无消费者则链接非必需）', async t => {
  const world = await buildWorld(t);
  const manifest = JSON.parse(await readFile(world.pluginsFile, 'utf8'));
  manifest.plugins = manifest.plugins.filter(p => p.name === 'suian-zcode-common' || p.name === 'exa');
  await writeFile(world.pluginsFile, JSON.stringify(manifest));
  await rm(world.runtimeRoot);
  for (const def of world.defs.filter(d => d.name !== 'suian-zcode-common')) {
    await rm(world.installPaths[def.name], { recursive: true, force: true });
  }
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
