import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, lstat, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectLegacyLinks, cleanupLegacyLinks } from '../legacy-cleanup.mjs';
import { buildLegacyWorld, buildReleaseWorld } from './depcheck-fixture.mjs';

const linkType = () => (process.platform === 'win32' ? 'junction' : 'dir');
const isLink = async path => (await lstat(path)).isSymbolicLink();

test('旧源码世界：runtime 与业务端链接全部识别为归属 common 的可清理链接', async t => {
  const world = await buildLegacyWorld(t);
  const inspected = await inspectLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir });
  assert.equal(inspected.runtimeLink.kind, 'symlink');
  assert.equal(inspected.runtimeLink.owned, true);
  const consumers = inspected.consumerLinks.filter(link => link.owned);
  assert.deepEqual(consumers.map(link => link.plugin).sort(), ['suian-side-editor', 'suian-zcode-app-mcp', 'suian-zcode-title']);
});

test('清理只删链接本身：目标缓存目录与用户源码保持', async t => {
  const world = await buildLegacyWorld(t);
  const result = await cleanupLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir, apply: true });
  assert.equal(result.runtimeLink.action, 'removed');
  assert.deepEqual(result.consumerLinks.map(link => `${link.plugin}:${link.action}`).sort(), [
    'suian-side-editor:removed', 'suian-zcode-app-mcp:removed', 'suian-zcode-title:removed',
  ]);
  // 链接已删除
  assert.equal(await isLink(world.runtimeRoot).then(() => true, () => false), false);
  for (const name of ['suian-zcode-title', 'suian-zcode-app-mcp', 'suian-side-editor']) {
    const linkPath = join(world.installPaths[name], 'node_modules', 'suian-zcode-common');
    const present = await lstat(linkPath).then(() => true, () => false);
    assert.equal(present, false, `${name} 的链接应被删除`);
  }
  // 目标目录（common 缓存与用户源码数据）保持原样
  const commonEntries = await readdir(world.installPaths['suian-zcode-common']);
  assert.ok(commonEntries.includes('package.json'), 'common 缓存内容未被删除');
  const titleEntries = await readdir(join(world.installPaths['suian-zcode-title'], 'node_modules'));
  assert.equal(titleEntries.length, 0, '业务 node_modules 只少了链接本身');
});

test('归属核对：真实目录占据与指向他人的链接一律保留', async t => {
  const world = await buildLegacyWorld(t);
  // side-editor 的链接位置被真实目录占据
  const realDirLink = join(world.installPaths['suian-side-editor'], 'node_modules', 'suian-zcode-common');
  await rm(realDirLink);
  await mkdir(realDirLink, { recursive: true });
  await writeFile(join(realDirLink, 'user-file.txt'), 'user data', 'utf8');
  // app-mcp 的链接改指别处（他人注册）
  const alienLink = join(world.installPaths['suian-zcode-app-mcp'], 'node_modules', 'suian-zcode-common');
  await rm(alienLink);
  await symlink(world.installPaths['suian-zcode-title'], alienLink, linkType());

  const result = await cleanupLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir, apply: true });
  const byPlugin = Object.fromEntries(result.consumerLinks.map(link => [link.plugin, link]));
  assert.equal(byPlugin['suian-side-editor'].action, 'kept_not_owned');
  assert.equal(byPlugin['suian-side-editor'].reason, 'real_directory');
  assert.equal(byPlugin['suian-zcode-app-mcp'].action, 'kept_not_owned');
  assert.equal(byPlugin['suian-zcode-app-mcp'].reason, 'foreign_target');
  assert.equal(byPlugin['suian-zcode-title'].action, 'removed');
  // 真实目录与内容保留
  assert.equal((await readFile(join(realDirLink, 'user-file.txt'), 'utf8')), 'user data');
  // 他人链接保留
  assert.equal(await isLink(alienLink), true);
});

test('runtime 链接指向旧版本缓存（悬空或非当前条目）时仍按 common 归属判定', async t => {
  const world = await buildLegacyWorld(t);
  // 模拟 common 升级后旧 runtime 指向已被清理的旧版本目录（悬空）
  await rm(world.runtimeRoot);
  await symlink(join(world.root, 'old-cache', 'suian-zcode-common', '0.1.0'), world.runtimeRoot, linkType());
  const inspected = await inspectLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir });
  assert.equal(inspected.runtimeLink.kind, 'symlink');
  assert.equal(inspected.runtimeLink.owned, true, '悬空的 common 入口链接仍归属 common，可清理');
});

test('runtime 被真实目录占据时保留并报告', async t => {
  const world = await buildLegacyWorld(t);
  await rm(world.runtimeRoot);
  await mkdir(world.runtimeRoot, { recursive: true });
  await writeFile(join(world.runtimeRoot, 'keep.txt'), 'x', 'utf8');
  const result = await cleanupLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir, apply: true });
  assert.equal(result.runtimeLink.action, 'kept_not_owned');
  assert.equal(result.runtimeLink.reason, 'real_directory');
  assert.equal((await readFile(join(world.runtimeRoot, 'keep.txt'), 'utf8')), 'x');
});

test('发布世界（无任何链接）：inspect 全部 absent，apply 空操作', async t => {
  const world = await buildReleaseWorld(t);
  const inspected = await inspectLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir });
  assert.equal(inspected.runtimeLink.kind, 'absent');
  assert.equal(inspected.consumerLinks.length, 0);
  const result = await cleanupLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir, apply: true });
  assert.equal(result.runtimeLink.action, 'noop_absent');
});

test('未带 apply 时只出计划不删任何链接', async t => {
  const world = await buildLegacyWorld(t);
  const result = await cleanupLegacyLinks({ pluginsFile: world.pluginsFile, homeDir: world.homeDir, apply: false });
  assert.equal(result.runtimeLink.action, 'planned');
  assert.equal(await isLink(world.runtimeRoot), true, '计划模式不得删链接');
});
