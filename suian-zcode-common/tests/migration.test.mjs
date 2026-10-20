import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, stat as fsStat, unlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import childProcess from 'node:child_process';
import { captureLegacyState, restoreLegacyState } from '../migration.mjs';
import { cleanupLegacyLinks } from '../legacy-cleanup.mjs';
import { deployToastRuntime } from '../toast-runtime.mjs';
import { buildLegacyWorld } from './depcheck-fixture.mjs';

async function buildMigrationWorld(t) {
  const root = await mkdtemp(join(tmpdir(), 'suian-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacyRoot = join(root, 'old-source', 'ZCode-Plugins');
  const titleConfig = join(root, 'old-title-config.json');
  const gatewayConfig = join(root, 'gateway', 'config.json');
  const recordPath = join(root, 'migration-record.json');
  await mkdir(join(legacyRoot, 'suian-zcode-common'), { recursive: true });
  await mkdir(join(root, 'gateway'), { recursive: true });
  return { root, legacyRoot, titleConfig, gatewayConfig, recordPath };
}

test('capture 记录旧开关与路径：enabled 未写按启用记录，网关配置只记路径与模式端口', async t => {
  const world = await buildMigrationWorld(t);
  // 旧 title 配置未写 enabled（旧版语义：默认启用）
  await writeFile(world.titleConfig, JSON.stringify({ model: 'glm-4.7', interval: 2 }), 'utf8');
  await writeFile(world.gatewayConfig, JSON.stringify({
    version: 1, port: 17329, mode: 'relay', control_token: 'SECRET-TOKEN', upstream_url: 'wss://zcode.z.ai/ws',
  }), 'utf8');
  const record = await captureLegacyState({
    legacyRoot: world.legacyRoot,
    titleConfigPath: world.titleConfig,
    gatewayConfigPath: world.gatewayConfig,
    recordPath: world.recordPath,
  });
  assert.equal(record.formatVersion, 1);
  assert.equal(record.switches.titleEnabled, true, 'enabled 未写时按旧版默认启用记录');
  assert.equal(record.switches.titleEnabledDefined, false);
  assert.equal(record.switches.titleModel, 'glm-4.7');
  assert.equal(record.paths.legacyRoot, world.legacyRoot);
  assert.equal(record.paths.gatewayConfig, world.gatewayConfig);
  assert.equal(record.gateway.mode, 'relay');
  assert.equal(record.gateway.port, 17329);
  const persisted = JSON.parse(await readFile(world.recordPath, 'utf8'));
  assert.equal(persisted.switches.titleEnabled, true);
  const text = await readFile(world.recordPath, 'utf8');
  assert.doesNotMatch(text, /SECRET-TOKEN/, '迁移记录不得包含控制令牌');
});

test('capture 对显式停用与缺失配置分别记录', async t => {
  const world = await buildMigrationWorld(t);
  await writeFile(world.titleConfig, JSON.stringify({ enabled: false }), 'utf8');
  const record = await captureLegacyState({ legacyRoot: world.legacyRoot, titleConfigPath: world.titleConfig, gatewayConfigPath: world.gatewayConfig, recordPath: world.recordPath });
  assert.equal(record.switches.titleEnabled, false);
  assert.equal(record.switches.titleEnabledDefined, true);
  assert.equal(record.gateway.configured, false, '网关配置缺失时记录 configured:false 而不是失败');
});

test('restore 恢复原开关：目标配置缺 enabled 时写入记录值，不覆盖已有自定义字段', async t => {
  const world = await buildMigrationWorld(t);
  await writeFile(world.titleConfig, JSON.stringify({ model: 'glm-4.7' }), 'utf8');
  await captureLegacyState({ legacyRoot: world.legacyRoot, titleConfigPath: world.titleConfig, gatewayConfigPath: world.gatewayConfig, recordPath: world.recordPath });

  const newTitleConfig = join(world.root, 'new-title-config.json');
  await writeFile(newTitleConfig, JSON.stringify({ interval: 3, customField: { keep: true } }), 'utf8');
  const restored = await restoreLegacyState({ recordPath: world.recordPath, titleConfigPath: newTitleConfig });
  assert.equal(restored.titleEnabled.action, 'restored');
  const after = JSON.parse(await readFile(newTitleConfig, 'utf8'));
  assert.equal(after.enabled, true, 'enabled 未写时按记录恢复为启用');
  assert.equal(after.customField.keep, true, '已有自定义字段不覆盖');
  assert.equal(after.interval, 3);

  // 目标已写 enabled（用户在迁移窗口内自行修改）时不覆盖
  const userConfig = join(world.root, 'user-title-config.json');
  await writeFile(userConfig, JSON.stringify({ enabled: false }), 'utf8');
  const kept = await restoreLegacyState({ recordPath: world.recordPath, titleConfigPath: userConfig });
  assert.equal(kept.titleEnabled.action, 'preserved_existing');
  assert.equal(JSON.parse(await readFile(userConfig, 'utf8')).enabled, false);
});

test('restore 对显式停用记录恢复为停用', async t => {
  const world = await buildMigrationWorld(t);
  await writeFile(world.titleConfig, JSON.stringify({ enabled: false, model: 'glm-4.7' }), 'utf8');
  await captureLegacyState({ legacyRoot: world.legacyRoot, titleConfigPath: world.titleConfig, gatewayConfigPath: world.gatewayConfig, recordPath: world.recordPath });
  const newConfig = join(world.root, 'fresh-config.json');
  await writeFile(newConfig, JSON.stringify({ interval: 2 }), 'utf8');
  const restored = await restoreLegacyState({ recordPath: world.recordPath, titleConfigPath: newConfig });
  assert.equal(restored.titleEnabled.action, 'restored');
  assert.equal(JSON.parse(await readFile(newConfig, 'utf8')).enabled, false);
});

test('restore 记录缺失时报错，不猜测状态', async t => {
  const world = await buildMigrationWorld(t);
  await assert.rejects(
    () => restoreLegacyState({ recordPath: world.recordPath, titleConfigPath: join(world.root, 'x.json') }),
    /migration-record/,
  );
});

test('重复 capture 幂等：记录文件可覆盖且内容一致', async t => {
  const world = await buildMigrationWorld(t);
  await writeFile(world.titleConfig, JSON.stringify({ enabled: true }), 'utf8');
  const first = await captureLegacyState({ legacyRoot: world.legacyRoot, titleConfigPath: world.titleConfig, gatewayConfigPath: world.gatewayConfig, recordPath: world.recordPath });
  const second = await captureLegacyState({ legacyRoot: world.legacyRoot, titleConfigPath: world.titleConfig, gatewayConfigPath: world.gatewayConfig, recordPath: world.recordPath });
  assert.equal(second.switches.titleEnabled, first.switches.titleEnabled);
  assert.equal(second.switches.titleEnabledDefined, first.switches.titleEnabledDefined);
});

// 迁移链端到端契约（PKG-08 验收）：先记录开关和路径 → 清理旧链接（只删链接）→
// 安全部署 Toast 稳定运行时（网关侧由 setup.ps1 流程负责，PKG-05 已有契约）→
// 迁移后配置恢复原开关；用户数据（网关配置、title 自定义字段、旧源码根）全部保留。
// 系统边界注入：部署 shell 只放行 node --check，不触达注册表/PowerShell/计划任务。
const originalExecFile = childProcess.execFile;
const migrationShell = {
  mkdir: path => mkdir(path, { recursive: true }),
  readText: path => readFile(path, 'utf8'),
  writeText: (path, text) => writeFile(path, text, 'utf8'),
  remove: async path => { try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
  rename: (from, to) => rename(from, to),
  stat: async path => {
    try { const info = await fsStat(path); return { isFile: info.isFile(), isDirectory: info.isDirectory() }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  },
  run: (cmd, args) => {
    if (args[0] === '--check') return promisify(originalExecFile)(cmd, args, { windowsHide: true }).then(r => r.stdout);
    throw new Error('unexpected system call in migration chain: ' + cmd);
  },
};

test('迁移链端到端：记录 → 链接清理 → Toast 稳定部署 → 配置恢复，用户数据全保留', async t => {
  const legacy = await buildLegacyWorld(t);
  // 旧世界的用户数据：title 外置配置（enabled 未写=启用+自定义字段）、网关配置（含令牌）
  const titleConfig = join(legacy.root, 'title-config.json');
  await writeFile(titleConfig, JSON.stringify({ model: 'glm-4.7', interval: 2 }), 'utf8');
  const gatewayDir = join(legacy.root, 'gateway-data');
  await mkdir(gatewayDir, { recursive: true });
  const gatewayConfig = join(gatewayDir, 'config.json');
  await writeFile(gatewayConfig, JSON.stringify({ version: 1, port: 17329, mode: 'relay', control_token: 'SECRET', upstream_url: 'wss://zcode.z.ai/ws' }), 'utf8');
  await writeFile(join(gatewayDir, 'gateway.db'), 'user gateway data', 'utf8');
  const recordPath = join(legacy.root, 'private', 'migration-record.json');

  // 1) 先记录开关和路径（迁移记录不含令牌）
  const record = await captureLegacyState({ legacyRoot: legacy.root, titleConfigPath: titleConfig, gatewayConfigPath: gatewayConfig, recordPath });
  assert.equal(record.switches.titleEnabled, true);
  assert.equal(record.gateway.configured, true);
  assert.doesNotMatch(await readFile(recordPath, 'utf8'), /SECRET/);

  // 2) 清理旧链接：只删链接本身，源码根与缓存内容保持
  const cleanup = await cleanupLegacyLinks({ pluginsFile: legacy.pluginsFile, homeDir: legacy.homeDir, apply: true });
  assert.equal(cleanup.runtimeLink.action, 'removed');
  assert.ok(cleanup.consumerLinks.every(link => link.action === 'removed'));
  assert.ok((await readdir(legacy.installPaths['suian-zcode-common'])).includes('package.json'), '旧 common 缓存内容保留作回退');

  // 3) 安全部署 Toast 稳定运行时（通知侧；执行器来自 common 源文本）
  const executorText = await readFile(join(legacy.root, 'common-source', 'toast-executor.mjs'), 'utf8').catch(() => null)
    ?? await readFile(new URL('../toast-executor.mjs', import.meta.url), 'utf8');
  const deployed = await deployToastRuntime({ homeDir: legacy.homeDir, nodeExe: process.execPath, executorText, shell: migrationShell });
  assert.equal(deployed.action, 'deployed');
  assert.equal((await fsStat(join(legacy.homeDir, '.zcode', 'tools', 'suian-zcode-common', 'toast', 'executor.mjs'))).isFile(), true);

  // 4) 迁移后的新 title 配置：enabled 未写，恢复原开关；自定义字段保留
  const newTitleConfig = join(legacy.root, 'new-title-config.json');
  await writeFile(newTitleConfig, JSON.stringify({ interval: 3, customField: 'keep' }), 'utf8');
  const restored = await restoreLegacyState({ recordPath, titleConfigPath: newTitleConfig });
  assert.equal(restored.titleEnabled.action, 'restored');
  const afterTitle = JSON.parse(await readFile(newTitleConfig, 'utf8'));
  assert.equal(afterTitle.enabled, true);
  assert.equal(afterTitle.customField, 'keep');

  // 5) 用户数据保留：网关配置与数据原样、旧源码根原样
  const gatewayAfter = JSON.parse(await readFile(gatewayConfig, 'utf8'));
  assert.equal(gatewayAfter.control_token, 'SECRET');
  assert.equal(gatewayAfter.port, 17329);
  assert.equal(await readFile(join(gatewayDir, 'gateway.db'), 'utf8'), 'user gateway data');
  assert.ok((await readdir(legacy.root)).includes('home'), '旧世界根结构未被迁移工具删除');
});
