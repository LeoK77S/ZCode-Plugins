import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { buildRelease } from '../build-release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const commonRoot = resolve(here, '..');
const nodeBin = process.execPath;

const buildTo = async (root, dirName) => {
  const out = await mkdtemp(join(tmpdir(), dirName));
  const result = await buildRelease({ root, outDir: join(out, 'release') });
  return { out, ...result };
};

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

test('发布目录组装：客户端产物、许可与元数据齐备且无 node_modules', async t => {
  const { out, releaseDir } = await buildTo(commonRoot, 'pkg01-build-');
  t.after(() => rm(out, { recursive: true, force: true }));
  for (const file of ['dist/client.mjs', 'dist/client-install.mjs', 'release.json', 'toast-executor.mjs', 'LICENSE', 'vendor/LICENSE-ZCode', 'vendor/NOTICE-ZCode-current.md', 'vendor/LICENSE-zod', 'vendor/NOTICE.md', 'vendor/conversation-wire.sources.json', 'licenses/ws-LICENSE', '.zcode-plugin/plugin.json', 'skills/setup/SKILL.md', 'skills/configuration/SKILL.md', 'skills/debug/SKILL.md']) {
    await assert.doesNotReject(() => readFile(join(releaseDir, file)), `发布目录缺 ${file}`);
  }
  assert.equal((await readdir(join(releaseDir, 'dist'))).length, 2);
  const entries = await readdir(releaseDir, { withFileTypes: true });
  assert.ok(!entries.some(entry => entry.name === 'node_modules'), '发布目录不得携带 node_modules');
});

test('自包含：产物在无 node_modules 的独立目录可直接导入且导出完整', async t => {
  const { out, releaseDir } = await buildTo(commonRoot, 'pkg01-self-');
  t.after(() => rm(out, { recursive: true, force: true }));
  const dir = await mkdtemp(join(tmpdir(), 'pkg01-isolated-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entryUrl = pathToFileURL(join(releaseDir, 'dist', 'client.mjs')).href;
  const result = spawnSync(nodeBin, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(entryUrl)});
if (typeof m.connectHost !== 'function' || typeof m.TopicWireFrameAssembler !== 'function') throw new Error('契约导出缺失');`], { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('release.json 契约：字段齐备、文件清单逐项校验且不含自身', async t => {
  const { out, releaseDir, release } = await buildTo(commonRoot, 'pkg01-release-');
  t.after(() => rm(out, { recursive: true, force: true }));
  assert.equal(release.formatVersion, 1);
  assert.equal(release.pluginName, 'suian-zcode-common');
  assert.equal(release.packageName, 'suian-zcode-common');
  assert.equal(release.commonApiVersion, 1);
  assert.match(release.pluginVersion, /^\d+\.\d+\.\d+/);
  assert.match(release.buildId, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(release.entries).sort(), ['client', 'client-install']);
  for (const entryPath of Object.values(release.entries)) {
    await assert.doesNotReject(() => readFile(join(releaseDir, entryPath)));
  }
  const listed = release.files.map(file => file.path);
  assert.ok(!listed.includes('release.json'), '文件清单不得包含 release.json 自身（自引用）');
  assert.ok(listed.includes('dist/client.mjs') && listed.includes('vendor/LICENSE-ZCode'));
  for (const file of release.files) {
    assert.equal(await sha256(join(releaseDir, file.path)), file.sha256, `${file.path} 摘要不符`);
  }
});

test('buildId 稳定：同输入重复构建一致，输入变更后变化', async t => {
  const first = await buildTo(commonRoot, 'pkg01-det-1-');
  const second = await buildTo(commonRoot, 'pkg01-det-2-');
  t.after(() => rm(first.out, { recursive: true, force: true }));
  t.after(() => rm(second.out, { recursive: true, force: true }));
  assert.equal(first.release.buildId, second.release.buildId);

  const copy = join(first.out, 'common-copy');
  await cp(commonRoot, copy, { recursive: true, filter: source => { const rel = relative(commonRoot, source); return rel === '' || (!rel.startsWith('tests') && !rel.startsWith('docs') && !rel.startsWith('.scratch')); } });
  const mutated = join(copy, 'project-context.mjs');
  await writeFile(mutated, `${await readFile(mutated, 'utf8')}\n// build determinism probe\n`);
  const third = await buildTo(copy, 'pkg01-det-3-');
  t.after(() => rm(third.out, { recursive: true, force: true }));
  assert.notEqual(third.release.buildId, first.release.buildId);
});

test('构建输入记录：build-inputs.json 列出真实输入与配置摘要，位于发布目录之外', async t => {
  const { out, releaseDir, inputsPath } = await buildTo(commonRoot, 'pkg01-inputs-');
  t.after(() => rm(out, { recursive: true, force: true }));
  assert.notEqual(inputsPath, join(releaseDir, 'build-inputs.json'), '输入记录不得进入发布目录');
  const inputs = JSON.parse(await readFile(inputsPath, 'utf8'));
  assert.ok(inputs.config?.target === 'node24');
  assert.match(inputs.inputDigest, /^[0-9a-f]{64}$/);
  const inputPaths = Object.keys(inputs.inputs);
  for (const required of ['client.mjs', 'gateway-client.mjs', 'auth-store.mjs', 'title-policy.mjs', 'project-context.mjs', 'vendor/conversation-wire.js']) {
    assert.ok(inputPaths.includes(required), `构建输入缺 ${required}`);
  }
  assert.ok(Object.values(inputs.inputs).every(digest => /^[0-9a-f]{64}$/.test(digest)), '每个输入必须有内容摘要');
});
