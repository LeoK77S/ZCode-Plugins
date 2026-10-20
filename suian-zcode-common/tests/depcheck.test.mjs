import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanSuianPlugins } from '../depcheck.mjs';
import { buildReleaseWorld, buildLegacyWorld } from './depcheck-fixture.mjs';

const issueKeys = result => result.issues.map(i => `${i.plugin}:${i.code}`);

test('红色契约：无 node_modules 的正确发布产物不再被误判为损坏', async t => {
  const world = await buildReleaseWorld(t);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.equal(result.ok, true, `发布产物不应报错，实际：${JSON.stringify(result.issues)}`);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.plugins.map(p => p.name).sort(), ['suian-side-editor', 'suian-zcode-app-mcp', 'suian-zcode-common', 'suian-zcode-title']);
});

test('发布产物各插件记录 buildId 与发布版本', async t => {
  const world = await buildReleaseWorld(t);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  for (const record of result.plugins) {
    assert.match(record.buildId, /^[0-9a-f]{64}$/, `${record.name} 应携带发布 buildId`);
    assert.equal(typeof record.releaseVersion, 'string', `${record.name} 应携带发布版本`);
  }
});

test('发布清单中某文件缺失报 file_missing', async t => {
  const world = await buildReleaseWorld(t);
  await rm(join(world.installPaths['suian-zcode-title'], 'dist', 'hook.mjs'));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:file_missing']);
  assert.match(result.issues[0].detail, /dist\/hook\.mjs/);
});

test('发布清单中某文件内容被篡改报 file_digest_mismatch', async t => {
  const world = await buildReleaseWorld(t);
  await writeFile(join(world.installPaths['suian-zcode-app-mcp'], 'dist', 'cli.mjs'), 'tampered\n', 'utf8');
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-app-mcp:file_digest_mismatch']);
  assert.match(result.issues[0].detail, /dist\/cli\.mjs/);
});

test('release.json 的 pluginName 与安装条目不符报 identity_mismatch', async t => {
  const world = await buildReleaseWorld(t);
  const releasePath = join(world.installPaths['suian-zcode-title'], 'release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  release.pluginName = 'suian-zcode-app-mcp';
  await writeFile(releasePath, JSON.stringify(release));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:identity_mismatch']);
});

test('目录缺 release.json（旧源码缓存形态）报 release_missing，指向原生重装而非 npm', async t => {
  const world = await buildReleaseWorld(t);
  await rm(join(world.installPaths['suian-side-editor'], 'release.json'));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-side-editor:release_missing']);
});

test('release.json 损坏或字段不符报 release_invalid', async t => {
  const world = await buildReleaseWorld(t);
  await writeFile(join(world.installPaths['suian-zcode-title'], 'release.json'), '{ broken');
  assert.deepEqual(issueKeys(await scanSuianPlugins({ homeDir: world.homeDir })), ['suian-zcode-title:release_invalid']);
  // 字段形态异常（files 非数组）同样判 release_invalid
  const world2 = await buildReleaseWorld(t);
  const releasePath = join(world2.installPaths['suian-zcode-title'], 'release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  release.files = 'nope';
  await writeFile(releasePath, JSON.stringify(release));
  const result = await scanSuianPlugins({ homeDir: world2.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:release_invalid']);
});

test('业务期望的公共 API 版本与 common 不符报 api_incompatible', async t => {
  const world = await buildReleaseWorld(t);
  const releasePath = join(world.installPaths['suian-zcode-app-mcp'], 'release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  release.expectedCommonApiVersion = 2;
  await writeFile(releasePath, JSON.stringify(release));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-app-mcp:api_incompatible']);
  assert.match(result.issues[0].detail, /2/);
  assert.match(result.issues[0].detail, /1/);
});

test('common 发布版本低于业务声明的最低版本报 version_insufficient', async t => {
  const world = await buildReleaseWorld(t);
  const releasePath = join(world.installPaths['suian-zcode-app-mcp'], 'release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  release.minimumCommonVersion = '0.6.0';
  await writeFile(releasePath, JSON.stringify(release));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-app-mcp:version_insufficient']);
  assert.match(result.issues[0].detail, /0\.6\.0/);
});

test('业务在册但 common 条目缺失报 common_not_installed', async t => {
  const world = await buildReleaseWorld(t);
  const manifest = JSON.parse(await readFile(world.pluginsFile, 'utf8'));
  manifest.plugins = manifest.plugins.filter(p => p.name !== 'suian-zcode-common');
  await writeFile(world.pluginsFile, JSON.stringify(manifest));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-common:common_not_installed']);
});

test('插件缓存目录缺失报 cache_missing', async t => {
  const world = await buildReleaseWorld(t);
  await rm(world.installPaths['suian-zcode-title'], { recursive: true, force: true });
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.deepEqual(issueKeys(result), ['suian-zcode-title:cache_missing']);
});

test('插件文件残缺（plugin.json 缺失）报 plugin_files_missing，且该文件在发布清单内同时报 file_missing', async t => {
  const world = await buildReleaseWorld(t);
  await rm(join(world.installPaths['suian-zcode-title'], '.zcode-plugin', 'plugin.json'));
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  const keys = issueKeys(result);
  assert.ok(keys.includes('suian-zcode-title:plugin_files_missing'));
  assert.ok(keys.includes('suian-zcode-title:file_missing'), 'plugin.json 同时是发布清单文件');
});

test('遗留旧 runtime junction 存在不判损坏，但结果要报告其状态供迁移参考', async t => {
  const world = await buildReleaseWorld(t);
  const { symlink } = await import('node:fs/promises');
  const runtimeRoot = join(world.homeDir, '.zcode', 'tools', 'suian-zcode-common', 'runtime');
  await mkdir(join(world.homeDir, '.zcode', 'tools', 'suian-zcode-common'), { recursive: true });
  await symlink(world.installPaths['suian-zcode-common'], runtimeRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.equal(result.ok, true, '迁移遗留链接不是损坏');
  assert.equal(result.legacyRuntimeLink, 'symlink', '结果应报告遗留 runtime 链接状态');
});

test('旧源码缓存形态（npm+链接世界）报 release_missing 而非 npm/link 缺失', async t => {
  const world = await buildLegacyWorld(t);
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  const keys = issueKeys(result);
  for (const key of keys) assert.match(key, /:release_missing$/, `旧形态应报 release_missing，实际 ${key}`);
  assert.equal(result.ok, false);
});

test('清单缺失时跳过本轮且不能报告正常（skipped=no_manifest）', async t => {
  const world = await buildReleaseWorld(t);
  const result = await scanSuianPlugins({ pluginsFile: join(world.root, 'absent.json') });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'no_manifest');
});

test('清单损坏时跳过本轮且不能报告正常（skipped=bad_manifest）', async t => {
  const world = await buildReleaseWorld(t);
  await writeFile(world.pluginsFile, '{broken json', 'utf8');
  const result = await scanSuianPlugins({ pluginsFile: world.pluginsFile });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'bad_manifest');
});

test('清单为合法 JSON 但非对象（null/数组）按 bad_manifest 静默跳过', async t => {
  const world = await buildReleaseWorld(t);
  for (const content of ['null', '["suian"]', '42']) {
    await writeFile(world.pluginsFile, content, 'utf8');
    const result = await scanSuianPlugins({ pluginsFile: world.pluginsFile });
    assert.equal(result.skipped, 'bad_manifest', `内容 ${content} 应判 bad_manifest`);
    assert.equal(result.ok, false);
  }
});

test('清单 plugins 字段类型异常按 bad_manifest 静默跳过', async t => {
  const world = await buildReleaseWorld(t);
  await writeFile(world.pluginsFile, JSON.stringify({ version: 1, plugins: { suian: {} } }), 'utf8');
  const result = await scanSuianPlugins({ pluginsFile: world.pluginsFile });
  assert.equal(result.skipped, 'bad_manifest');
});

test('仅装 common 无业务插件时不做 API 比对（无消费者则无兼容约束）', async t => {
  const world = await buildReleaseWorld(t);
  const manifest = JSON.parse(await readFile(world.pluginsFile, 'utf8'));
  manifest.plugins = manifest.plugins.filter(p => p.name === 'suian-zcode-common' || p.name === 'exa');
  await writeFile(world.pluginsFile, JSON.stringify(manifest));
  for (const name of ['suian-zcode-title', 'suian-zcode-app-mcp', 'suian-side-editor']) {
    await rm(world.installPaths[name], { recursive: true, force: true });
  }
  const result = await scanSuianPlugins({ homeDir: world.homeDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
