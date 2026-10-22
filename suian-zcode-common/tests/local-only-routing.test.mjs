import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchPrepare, patchApply, patchStatus, patchRestore, extractAsarFile, main } from '../local-only/patch.mjs';
import { buildAsarBuffer, buildFakeExe, sha256, noProcesses, exists } from './local-only-fixture.mjs';

// 两个合成发行包使用不同入口和注入规则，仅证明路由，不代表支持新的真实 ZCode。
async function targetAt(t, label, patchVersion) {
  const dir = await mkdtemp(join(tmpdir(), 'lo-routing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'resources'));
  await writeFile(join(dir, 'ZCode.exe'), buildFakeExe());
  const mainEntry = `main-${label}.js`;
  const original = buildAsarBuffer([{ path: mainEntry, content: Buffer.from(`const release="${label}";`) }]);
  const asarPath = join(dir, 'resources/app.asar');
  await writeFile(asarPath, original);
  const profile = {
    id: `fixture-${label}`, platform: 'win32', patchVersion, mainEntry,
    packageIdentity: { exeName: 'ZCode.exe', exeFileVersion: '3.16.2.8769', appAsarRelativePath: 'resources/app.asar', appAsarSha256: sha256(original), appAsarBytes: original.length },
    applyInjections: source => ({ content: source + `/* patch ${label} */`, applied: [{ id: label }] }),
  };
  const resolveIdentity = async () => ({ exeFileVersion: '3.16.2.8769', appAsarSha256: sha256(await readFile(asarPath)) });
  return { dir, asarPath, original, profile, resolveIdentity };
}

test('新增档案后同版本不同摘要各自路由，使用各自入口与补丁修订号', async t => {
  const a = await targetAt(t, 'a', 3);
  const b = await targetAt(t, 'b', 1);
  const profiles = [b.profile, a.profile];
  for (const target of [a, b]) {
    const outDir = join(target.dir, 'candidate');
    const result = await patchPrepare({ targetDir: target.dir, outDir, profiles, platform: 'win32', resolveIdentity: target.resolveIdentity });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.candidate.profileId, target.profile.id);
    assert.equal(result.candidate.patchVersion, target.profile.patchVersion);
    assert.equal((await extractAsarFile(join(outDir, 'app.asar'), target.profile.mainEntry)).toString(), `const release="${target.profile.id.slice(8)}";/* patch ${target.profile.id.slice(8)} */`);
    const options = { targetDir: target.dir, profiles, platform: 'win32', resolveIdentity: target.resolveIdentity, readProcesses: noProcesses };
    const applied = await patchApply({ ...options, candidateDir: outDir });
    assert.equal(applied.ok, true, applied.reason);
    assert.equal(applied.patchVersion, target.profile.patchVersion);
    const status = await patchStatus(options);
    assert.equal(status.profileId, target.profile.id);
    assert.equal(status.patchState, 'patched');
    assert.equal(status.patchInfo.patchVersion, target.profile.patchVersion);
    assert.equal(status.patchInfo.upgradeAvailable, undefined);
    assert.equal((await patchRestore(options)).ok, true);
    assert.deepEqual(await readFile(target.asarPath), target.original);
  }
});

test('apply/status/restore 共享路由；旧状态无档案字段仍能识别和升级', async t => {
  const a = await targetAt(t, 'old', 3);
  const b = await targetAt(t, 'new', 1);
  const profiles = [b.profile, a.profile];
  const options = { targetDir: a.dir, profiles, platform: 'win32', resolveIdentity: a.resolveIdentity, readProcesses: noProcesses };
  const candidateDir = join(a.dir, 'candidate');
  const prepared = await patchPrepare({ ...options, outDir: candidateDir });
  const applied = await patchApply({ ...options, candidateDir });
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(applied.profileId, 'fixture-old');
  const statePath = a.asarPath + '.lo02state.json';
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.formatVersion, 2);
  assert.equal(state.profileId, 'fixture-old');
  // 模拟历史 format 1 状态，补丁修订号 2；已安装字节由状态记录确认。
  delete state.profileId; delete state.platform;
  state.formatVersion = 1; state.patchVersion = 2;
  await writeFile(statePath, JSON.stringify(state));
  const before = await readFile(statePath, 'utf8');
  const status = await patchStatus(options);
  assert.equal(status.supported, true, status.reason);
  assert.equal(status.profileId, 'fixture-old');
  assert.equal(status.patchInfo.upgradeAvailable, 3);
  assert.equal(await readFile(statePath, 'utf8'), before, '只读识别不改写旧状态');
  assert.equal((await patchPrepare({ ...options, outDir: join(a.dir, 'upgrade') })).candidate.preparedFromBackup, true);
  const restored = await patchRestore(options);
  assert.equal(restored.ok, true, restored.reason);
  assert.deepEqual(await readFile(a.asarPath), a.original);
  assert.equal(await exists(statePath), false);
  // 旧候选同样按原包身份路由，不要求先手动迁移元数据。
  const legacy = { ...prepared.candidate, formatVersion: 1 };
  delete legacy.profileId; delete legacy.platform;
  await writeFile(join(candidateDir, 'candidate.json'), JSON.stringify(legacy));
  assert.equal((await patchApply({ ...options, candidateDir })).ok, true);
});

test('跨档案候选、降级和损坏元数据均拒绝，目标/备份/状态不变', async t => {
  const a = await targetAt(t, 'a', 3);
  const b = await targetAt(t, 'b', 1);
  const profiles = [a.profile, b.profile];
  const options = target => ({ targetDir: target.dir, profiles, platform: 'win32', resolveIdentity: target.resolveIdentity, readProcesses: noProcesses });
  const aCandidate = join(a.dir, 'candidate');
  const bCandidate = join(b.dir, 'candidate');
  const prepared = await patchPrepare({ ...options(a), outDir: aCandidate });
  await patchPrepare({ ...options(b), outDir: bCandidate });
  await patchApply({ ...options(a), candidateDir: aCandidate });
  const statePath = a.asarPath + '.lo02state.json';
  const paths = [a.asarPath, a.asarPath + '.lo02bak', statePath];
  const before = await Promise.all(paths.map(p => readFile(p)));
  const assertUnchanged = async () => assert.deepEqual(await Promise.all(paths.map(p => readFile(p))), before);
  const wrongPackage = await patchApply({ ...options(a), candidateDir: bCandidate });
  assert.equal(wrongPackage.ok, false);
  await assertUnchanged();
  for (const fields of [{ profileId: b.profile.id }, { platform: 'linux' }, { patchVersion: 2 }, { formatVersion: 999 }]) {
    await writeFile(join(aCandidate, 'candidate.json'), JSON.stringify({ ...prepared.candidate, ...fields }));
    const result = await patchApply({ ...options(a), candidateDir: aCandidate });
    assert.equal(result.ok, false, JSON.stringify(fields));
    await assertUnchanged();
  }
  await writeFile(statePath, '{broken');
  const corrupt = await readFile(statePath);
  for (const command of [patchStatus, patchPrepare, patchApply, patchRestore]) {
    const result = await command({ ...options(a), outDir: join(a.dir, 'unused'), candidateDir: aCandidate });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_metadata');
    assert.deepEqual(await readFile(a.asarPath), before[0]);
    assert.deepEqual(await readFile(a.asarPath + '.lo02bak'), before[1]);
    assert.deepEqual(await readFile(statePath), corrupt);
  }
});

test('未知摘要、未适配平台及重复身份不按最新档案兜底', async t => {
  const a = await targetAt(t, 'a', 3);
  const options = { targetDir: a.dir, outDir: join(a.dir, 'candidate'), profiles: [a.profile], platform: 'win32', resolveIdentity: a.resolveIdentity };
  assert.equal((await patchPrepare({ ...options, platform: 'linux' })).ok, false);
  assert.equal((await patchPrepare({ ...options, profiles: [a.profile, { ...a.profile, id: 'duplicate' }] })).ok, false);
  await writeFile(a.asarPath, Buffer.from('unknown package'));
  assert.equal((await patchStatus(options)).supported, false);
  assert.equal((await patchPrepare(options)).ok, false);
  assert.equal(await exists(join(a.dir, 'candidate')), false);
  assert.equal(await exists(a.asarPath + '.lo02bak'), false);
});

test('旧包升级仅比较所属档案修订号，升级写入档案标识并保留原版备份', async t => {
  const a = await targetAt(t, 'a', 3);
  const b = await targetAt(t, 'b', 1);
  const oldPatched = Buffer.concat([a.original, Buffer.from('old revision')]);
  await writeFile(a.asarPath + '.lo02bak', a.original);
  await writeFile(a.asarPath, oldPatched);
  const statePath = a.asarPath + '.lo02state.json';
  await writeFile(statePath, JSON.stringify({ formatVersion: 1, kind: 'local-only-patch-state', patchVersion: 2, targetExeFileVersion: '3.16.2.8769', originalAsarSha256: sha256(a.original), patchedAsarSha256: sha256(oldPatched) }));
  const options = { targetDir: a.dir, profiles: [b.profile, a.profile], platform: 'win32', resolveIdentity: a.resolveIdentity, readProcesses: noProcesses };
  const candidateDir = join(a.dir, 'candidate');
  assert.equal((await patchStatus(options)).patchInfo.upgradeAvailable, 3);
  assert.equal((await patchPrepare({ ...options, outDir: candidateDir })).ok, true);
  const applied = await patchApply({ ...options, candidateDir });
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(applied.upgradedFromPatchVersion, 2);
  assert.equal(JSON.parse(await readFile(statePath)).profileId, 'fixture-a');
  assert.deepEqual(await readFile(a.asarPath + '.lo02bak'), a.original);
  // Desktop 已换包，旧记录不允许把旧备份覆盖上去。
  await writeFile(a.asarPath, b.original);
  assert.equal((await patchRestore(options)).ok, false);
  assert.deepEqual(await readFile(a.asarPath), b.original);
});

test('显式档案 ID 不符和未知状态格式不会回退旧格式识别', async t => {
  const a = await targetAt(t, 'a', 3);
  const options = { targetDir: a.dir, profiles: [a.profile], platform: 'win32', resolveIdentity: a.resolveIdentity, readProcesses: noProcesses };
  const candidateDir = join(a.dir, 'candidate');
  await patchPrepare({ ...options, outDir: candidateDir });
  await patchApply({ ...options, candidateDir });
  const statePath = a.asarPath + '.lo02state.json';
  const state = JSON.parse(await readFile(statePath));
  const patched = await readFile(a.asarPath);
  for (const fields of [{ profileId: 'unknown' }, { formatVersion: 999 }]) {
    const text = JSON.stringify({ ...state, ...fields });
    await writeFile(statePath, text);
    assert.equal((await patchStatus(options)).supported === true, false);
    assert.equal((await patchRestore(options)).ok, false);
    assert.deepEqual(await readFile(a.asarPath), patched);
    assert.equal(await readFile(statePath, 'utf8'), text);
  }
});

test('生产 CLI 拒绝用任意包身份文件绕过档案路由', async t => {
  t.mock.method(console, 'error', () => {});
  assert.equal(await main(['prepare', '--target', 'unused', '--out', 'unused', '--package-identity', 'unused.json']), 2);
});
