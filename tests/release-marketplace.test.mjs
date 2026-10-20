// PKG-07 契约：市场条目官方 ZIP 来源形状（source=url、type=zip、固定 HTTPS URL、
// sha256 64 位小写、stripRoot=false、无敏感 headers/latest/私有 token）；
// 候选生成只改受影响条目、未变条目原样保留；版本统一检查只报告不代选；回退候选引用旧资产。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateMarketplaceEntry, generateMarketplaceCandidate, generateRollbackCandidate, checkVersionConsistency } from '../release-marketplace.mjs';

const BASE_URL = 'https://github.com/ONEGAYI/ZCode-Plugins/releases/download';
const validSource = (name, version, sha) => ({
  source: 'url',
  type: 'zip',
  url: `${BASE_URL}/plugins-${version}/${name}-${version}.zip`,
  sha256: sha,
  stripRoot: false,
});
const VALID_SHA = 'a'.repeat(64);

const problemCodes = result => new Set(result.problems.map(problem => problem.code));

test('合法 zip 条目：形状、固定 URL、摘要、stripRoot 与业务依赖集合全部通过', () => {
  const entry = { name: 'suian-zcode-title', version: '0.1.5', dependencies: ['suian-zcode-common'], source: validSource('suian-zcode-title', '0.1.5', VALID_SHA) };
  const result = validateMarketplaceEntry(entry);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('非法形状拒绝：缺对象 source、非 https、latest URL、摘要格式、stripRoot=true、headers、token 字段', () => {
  const cases = [
    [{ name: 'p', version: '1.0.0', source: './p' }, 'source_shape'],
    [{ name: 'p', version: '1.0.0', source: { source: 'url', type: 'tar', url: `${BASE_URL}/t-1.0.0/p-1.0.0.zip`, sha256: VALID_SHA, stripRoot: false } }, 'source_shape'],
    [{ name: 'p', version: '1.0.0', source: { source: 'url', type: 'zip', url: `http://cdn.example.com/p-1.0.0.zip`, sha256: VALID_SHA, stripRoot: false } }, 'url_not_https'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), url: 'https://github.com/o/r/releases/latest/download/p-1.0.0.zip' } }, 'url_not_fixed'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), sha256: 'ABCDEF'.repeat(10) } }, 'sha256_invalid'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), sha256: 'a'.repeat(63) } }, 'sha256_invalid'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), stripRoot: true } }, 'strip_root'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), headers: { Authorization: 'Bearer x' } } }, 'headers_present'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), headers: { 'X-Cache': 'no' } } }, 'headers_present'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), token: 'ghp_xxx' } }, 'token_present'],
    [{ name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), url: `${BASE_URL}/t-1.0.0/p.zip` } }, 'url_not_fixed'],
  ];
  for (const [entry, code] of cases) {
    const result = validateMarketplaceEntry(entry);
    assert.equal(result.ok, false, JSON.stringify(entry));
    assert.ok(problemCodes(result).has(code), `期望 code ${code}，实际 ${JSON.stringify(result.problems)}`);
  }
});

test('URL 必须带明确 Release tag：无 tag 段的裸下载 URL 拒绝', () => {
  const entry = { name: 'p', version: '1.0.0', source: { ...validSource('p', '1.0.0'), url: 'https://cdn.example.com/p-1.0.0.zip' } };
  const result = validateMarketplaceEntry(entry);
  assert.equal(result.ok, false);
  assert.ok(problemCodes(result).has('url_not_fixed'));
});

test('业务条目必须保留 common 依赖；common 自身不得声明业务依赖', () => {
  const noDeps = { name: 'suian-zcode-title', version: '0.1.5', source: validSource('suian-zcode-title', '0.1.5', VALID_SHA) };
  assert.ok(problemCodes(validateMarketplaceEntry(noDeps)).has('dependency_missing'));
  const commonEntry = { name: 'suian-zcode-common', version: '0.4.2', source: validSource('suian-zcode-common', '0.4.2', VALID_SHA), dependencies: ['suian-zcode-title'] };
  assert.ok(problemCodes(validateMarketplaceEntry(commonEntry)).has('dependency_invalid'));
});

test('候选生成：只改受影响条目为 zip 来源，未变条目逐字段保留', () => {
  const current = {
    name: 'suian-zcode-plugins',
    plugins: [
      { name: 'suian-zcode-common', version: '0.4.2', source: './suian-zcode-common', description: 'd1' },
      { name: 'suian-zcode-title', version: '0.1.5', source: './suian-zcode-title', description: 'd2', dependencies: ['suian-zcode-common'] },
    ],
  };
  const candidate = generateMarketplaceCandidate({
    current,
    baseUrl: BASE_URL,
    releaseTag: 'plugins-0.4.2',
    updates: [{ name: 'suian-zcode-common', version: '0.4.2', fileName: 'suian-zcode-common-0.4.2.zip', zipSha256: VALID_SHA }],
  });
  // 未变条目逐字段一致
  assert.deepEqual(candidate.plugins.find(plugin => plugin.name === 'suian-zcode-title'), current.plugins[1]);
  // 受影响条目切换为 zip 来源且字段齐备
  const updated = candidate.plugins.find(plugin => plugin.name === 'suian-zcode-common');
  assert.equal(updated.version, '0.4.2');
  assert.equal(updated.description, 'd1');
  assert.deepEqual(updated.source, {
    source: 'url', type: 'zip',
    url: `${BASE_URL}/plugins-0.4.2/suian-zcode-common-0.4.2.zip`,
    sha256: VALID_SHA, stripRoot: false,
  });
  // 生成的条目本身必须通过形状校验
  assert.equal(validateMarketplaceEntry(updated).ok, true, JSON.stringify(validateMarketplaceEntry(updated).problems));
});

test('候选生成：更新不在市场中的插件名必须报错，不允许悄悄新增条目', () => {
  const current = { name: 'm', plugins: [{ name: 'a', version: '1.0.0', source: './a' }] };
  assert.throws(() => generateMarketplaceCandidate({
    current, baseUrl: BASE_URL, releaseTag: 't-1.0.0',
    updates: [{ name: 'ghost', version: '2.0.0', fileName: 'ghost-2.0.0.zip', zipSha256: VALID_SHA }],
  }), /ghost/);
});

test('版本统一检查：报告插件清单与 package.json / lock 根 / 自报版本 / 市场的不一致，且不修改任何文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pkg07-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'demo-plugin', '.zcode-plugin'), { recursive: true });
  await writeFile(join(root, 'demo-plugin', '.zcode-plugin', 'plugin.json'), `${JSON.stringify({ name: 'demo-plugin', version: '1.2.3' })}\n`);
  await writeFile(join(root, 'demo-plugin', 'package.json'), `${JSON.stringify({ name: 'demo-plugin', version: '1.0.0' })}\n`);
  await writeFile(join(root, 'demo-plugin', 'package-lock.json'), `${JSON.stringify({ name: 'demo-plugin', packages: { '': { version: '1.0.0' } } })}\n`);
  await writeFile(join(root, 'demo-plugin', 'release.json'), `${JSON.stringify({ pluginVersion: '1.0.0' })}\n`);
  const marketplace = { name: 'm', plugins: [{ name: 'demo-plugin', version: '0.9.0', source: { ...validSource('demo-plugin', '0.9.0') } }] };
  const report = await checkVersionConsistency({ repoRoot: root, pluginRoots: { 'demo-plugin': 'demo-plugin' }, marketplace });
  assert.equal(report.ok, false);
  const fields = new Set(report.mismatches.map(item => item.field));
  assert.deepEqual([...fields].sort(), ['marketplace', 'package-lock.json', 'package.json', 'release.json']);
  // 只读：不生成、不修改任何文件
  assert.deepEqual(await (await import('node:fs/promises')).readdir(root), ['demo-plugin']);
});

test('版本统一检查：所有来源一致时通过；缺字段（package.json 无 version）不视为不一致', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pkg07-version-ok-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'demo-plugin', '.zcode-plugin'), { recursive: true });
  await writeFile(join(root, 'demo-plugin', '.zcode-plugin', 'plugin.json'), `${JSON.stringify({ name: 'demo-plugin', version: '1.2.3' })}\n`);
  await writeFile(join(root, 'demo-plugin', 'package.json'), `${JSON.stringify({ name: 'demo-plugin', private: true })}\n`);
  const marketplace = { name: 'm', plugins: [{ name: 'demo-plugin', version: '1.2.3', source: { ...validSource('demo-plugin', '1.2.3') } }] };
  const report = await checkVersionConsistency({ repoRoot: root, pluginRoots: { 'demo-plugin': 'demo-plugin' }, marketplace });
  assert.equal(report.ok, true, JSON.stringify(report.mismatches));
});

test('回退候选：指定插件回退到旧市场条目，旧 URL 与摘要逐字段保留，未指定插件保持当前候选', () => {
  const previous = { name: 'm', plugins: [{ name: 'a', version: '1.0.0', source: validSource('a', '1.0.0', 'b'.repeat(64)) }, { name: 'b', version: '2.0.0', source: validSource('b', '2.0.0', 'c'.repeat(64)) }] };
  const current = { name: 'm', plugins: [{ name: 'a', version: '1.1.0', source: validSource('a', '1.1.0', 'd'.repeat(64)) }, { name: 'b', version: '2.1.0', source: validSource('b', '2.1.0', 'e'.repeat(64)) }] };
  const rollback = generateRollbackCandidate({ current, previous, names: ['a'] });
  assert.deepEqual(rollback.plugins.find(plugin => plugin.name === 'a'), previous.plugins[0]);
  assert.deepEqual(rollback.plugins.find(plugin => plugin.name === 'b'), current.plugins[1]);
});
