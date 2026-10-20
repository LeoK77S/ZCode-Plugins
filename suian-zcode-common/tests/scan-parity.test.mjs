// 同源双份 parity 契约：toast-executor（缓存外部署快照）与 depcheck（主源）对同一世界
// 必须给出等价的扫描结论与逐字一致的修复提示词。PKG-08 曾在两处独立改写扫描逻辑，
// 行为分叉（common 基准裸读 vs 校验后入 Map）只能靠 parity 测试兜住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { scanSuianPlugins as scanMain, COMMON_PACKAGE } from '../depcheck.mjs';
import { scanSuianPlugins as scanSnapshot, buildFixPrompt as buildPromptSnapshot } from '../toast-executor.mjs';
import { buildFixPrompt as buildPromptMain } from '../depcheck-prompt.mjs';
import { buildReleaseWorld } from './depcheck-fixture.mjs';

const normalize = result => ({ ...result, checkedAt: undefined });

test('扫描 parity：健康与损坏世界上，执行器快照与 depcheck 主源结论等价', async t => {
  const healthy = await buildReleaseWorld(t);
  const fromMain = await scanMain({ homeDir: healthy.homeDir });
  const fromSnapshot = await scanSnapshot({ homeDir: healthy.homeDir });
  assert.equal(fromMain.ok, true, JSON.stringify(fromMain.issues));
  assert.deepEqual(normalize(fromSnapshot), normalize(fromMain), '执行器快照与主源扫描结论必须等价');

  // common 基准被篡改（文件摘要不符）：两套实现都必须把它计为 file_digest_mismatch，
  // 且都不基于损坏的 common 基准输出 api_incompatible/version_insufficient。
  const tamperedWorld = await buildReleaseWorld(t);
  const clientPath = join(tamperedWorld.installPaths[COMMON_PACKAGE], 'dist', 'client.mjs');
  await writeFile(clientPath, `${await readFile(clientPath, 'utf8')}\n// tampered\n`);
  const tamperedMain = await scanMain({ homeDir: tamperedWorld.homeDir });
  const tamperedSnapshot = await scanSnapshot({ homeDir: tamperedWorld.homeDir });
  assert.deepEqual(normalize(tamperedSnapshot), normalize(tamperedMain), '损坏 common 世界两套结论必须等价');
  assert.ok(tamperedMain.issues.some(issue => issue.code === 'file_digest_mismatch' && issue.plugin === COMMON_PACKAGE));
});

test('提示词 parity：执行器快照与 depcheck-prompt 主源对同一结果逐字一致', async t => {
  const world = await buildReleaseWorld(t);
  await writeFile(join(world.installPaths['suian-zcode-title'], 'dist', 'hook.mjs'), 'broken\n');
  const result = await scanMain({ homeDir: world.homeDir });
  assert.equal(result.ok, false);
  assert.equal(buildPromptSnapshot(result), buildPromptMain(result), '修复提示词文本必须逐字一致');
});
