import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  PATCH_VERSION,
  INJECTIONS,
  EXIT_CODES,
  applyInjections,
} from '../local-only/patch-env.mjs';
import {
  readAsarHeader,
  extractAsarFile,
  writePatchedAsar,
  readFusesFromExe,
  patchStatus,
  patchPrepare,
  patchApply,
  patchRestore,
} from '../local-only/patch.mjs';
import {
  FIXTURE_INDEX,
  sha256,
  FUSE_SENTINEL_TEXT,
  fixtureIntegrity,
  buildAsarBuffer,
  buildFakeExe,
  makeSupportedTarget,
  noProcesses,
  boundaries,
  exists,
} from './local-only-fixture.mjs';

// fixture 与构造辅助提取至 local-only-fixture.mjs（LO-03：与 lifecycle 契约共用单一 fixture 源，
// 避免测试文件互相 import 导致重复执行）。锚点切片取自真实产物（探索笔记 05 asar-extract 实测）。

// ---------- patch-env 契约 ----------

test('INJECTIONS 定义完整：P0-P6 各就其位，replace 注入含 find/replacement/semantic', () => {
  assert.equal(PATCH_VERSION, 3);
  assert.deepEqual(INJECTIONS.map((i) => i.id), [
    'P0-fs-import',
    'P1-mode-gate',
    'P2-login-short-circuit',
    'P3-device-sid-short-circuit',
    'P4-token-short-circuit',
    'P5-signed-out-isolation',
    'P6-auto-start',
  ]);
  for (const injection of INJECTIONS) {
    assert.ok(injection.semantic, `${injection.id} 需要 semantic 说明`);
    if (injection.kind === 'replace') {
      assert.ok(typeof injection.find === 'string' && injection.find.length > 40, `${injection.id} find 应是锚点字节串`);
      assert.ok(typeof injection.replacement === 'string' && injection.replacement.includes(injection.find.slice(0, 20)) || injection.kind === 'prepend');
      assert.ok(injection.replacement.length > injection.find.length, `${injection.id} 替换文本应长于锚点`);
    }
  }
});

test('applyInjections：真实锚点切片全部命中且注入结果含短路点与门控', () => {
  const { content, applied } = applyInjections(FIXTURE_INDEX.toString('utf8'));
  assert.equal(applied.length, INJECTIONS.length);
  // P0：文件首行 import（v2 加 readFileSync，供标志文件首行读取）
  assert.ok(content.startsWith('import{existsSync as __loExists,readFileSync as __loRead}from"node:fs";'));
  // P1：在 var 语句边界后注入门控；最终地址行为由 lifecycle 的 vm 契约验证。
  assert.ok(content.includes('var __LO_MODE='));
  // P2-P4：三个回调短路
  assert.ok(content.includes('if(__LO_MODE)return{userId:"local-only-device",jwt:"local-only"};'));
  assert.ok(content.includes('__LO_MODE?"local-only-device":(Be=await kd(lt,ae)'));
  assert.ok(content.includes('if(__LO_MODE)return __LO_TOKEN();'));
  // 锚点原语义保留（短路未删除官方代码路径）
  assert.ok(content.includes('return t?{userId:e,jwt:t.slice(7)}:void 0'));
  assert.ok(content.includes('let lt=await Gn(),jo=await zn.token('));
});

test('applyInjections：重复注入（已含标记）与锚点失配明确失败', () => {
  const once = applyInjections(FIXTURE_INDEX.toString('utf8')).content;
  assert.throws(() => applyInjections(once), /已含注入标记/);
  const broken = FIXTURE_INDEX.toString('utf8').replace('resolveDeviceSid:s(async', 'resolveDeviceId:s(async');
  assert.throws(() => applyInjections(broken), /P3-device-sid-short-circuit 未命中/);
});

test('注入结果通过 Node ESM 语法检查（node --check）', { timeout: 30000 }, async () => {
  const { content } = applyInjections(FIXTURE_INDEX.toString('utf8'));
  const dir = await mkdtemp(join(tmpdir(), 'lo02-syntax-'));
  const file = join(dir, 'index.check.mjs');
  await writeFile(file, content);
  await new Promise((resolveTest, rejectTest) => {
    execFile(process.execPath, ['--check', file], (error, _stdout, stderr) => {
      if (error) rejectTest(new Error(`注入结果语法不合法：${stderr}`));
      else resolveTest();
    });
  });
  await rm(dir, { recursive: true, force: true });
});

// ---------- asar 读写契约 ----------

test('readAsarHeader/extractAsarFile：合成 asar（真实头格式）往返一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-asar-'));
  const asarPath = join(root, 'app.asar');
  const files = [
    { path: 'package.json', content: Buffer.from('{"main":"out/main/index.js"}') },
    { path: 'out/main/index.js', content: Buffer.from('const x=1;\n') },
    { path: 'a/b/c.bin', content: randomBytes(1024) },
  ];
  await writeFile(asarPath, buildAsarBuffer(files));
  const { contentBase, jsonLen } = await readAsarHeader(asarPath);
  assert.ok(contentBase >= 16 && jsonLen > 0);
  assert.deepEqual(await extractAsarFile(asarPath, 'a/b/c.bin'), files[2].content);
  await rm(root, { recursive: true, force: true });
});

test('writePatchedAsar：替换 index.js 后其余文件字节不变、unpacked 条目保留、头可重新解析', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-rewrite-'));
  const srcPath = join(root, 'app.asar');
  const outPath = join(root, 'patched.asar');
  const chunkContent = randomBytes(9 * 1024 * 1024 + 12345); // 跨 4MB integrity 块边界
  const files = [
    { path: 'package.json', content: Buffer.from('{"main":"out/main/index.js"}') },
    { path: 'out/main/index.js', content: Buffer.from('original-index') },
    { path: 'out/main/big-chunk.js', content: chunkContent },
    { path: 'node_modules/pty/prebuilds/x.dll', content: Buffer.from('native'), unpacked: true },
  ];
  await writeFile(srcPath, buildAsarBuffer(files));
  const patchedIndex = Buffer.from('patched-index-with-more-bytes-than-original');
  await writePatchedAsar({ srcPath, outPath, replacements: new Map([['out/main/index.js', patchedIndex]]) });
  assert.deepEqual(await extractAsarFile(outPath, 'out/main/index.js'), patchedIndex);
  assert.deepEqual(await extractAsarFile(outPath, 'out/main/big-chunk.js'), chunkContent);
  const { header } = await readAsarHeader(outPath);
  const unpackedEntry = header.files.node_modules.files.pty.files.prebuilds.files['x.dll'];
  assert.equal(unpackedEntry.unpacked, true);
  assert.equal(unpackedEntry.offset, undefined);
  await rm(root, { recursive: true, force: true });
});

test('writePatchedAsar 确定性：同输入两次输出逐字节一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-determinism-'));
  const srcPath = join(root, 'app.asar');
  const files = [
    { path: 'out/main/index.js', content: FIXTURE_INDEX },
    { path: 'out/other.js', content: randomBytes(4096) },
  ];
  await writeFile(srcPath, buildAsarBuffer(files));
  const { content } = applyInjections(FIXTURE_INDEX.toString('utf8'));
  const replacements = new Map([['out/main/index.js', Buffer.from(content, 'utf8')]]);
  const outA = join(root, 'a.asar');
  const outB = join(root, 'b.asar');
  await writePatchedAsar({ srcPath, outPath: outA, replacements });
  await writePatchedAsar({ srcPath, outPath: outB, replacements });
  assert.equal(sha256(await readFile(outA)), sha256(await readFile(outB)));
  await rm(root, { recursive: true, force: true });
});

test('readFusesFromExe：sentinel + wire 解析，fuse#5 ENABLE 检出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-fuse-'));
  const disabled = join(root, 'disabled.exe');
  const enabled = join(root, 'enabled.exe');
  await writeFile(disabled, buildFakeExe({ wire: '101000011' }));
  await writeFile(enabled, buildFakeExe({ wire: '101010011' }));
  assert.deepEqual(await readFusesFromExe(disabled), {
    sentinelFound: true, ok: true, version: 1, count: 9, wire: '101000011', asarIntegrityValidation: 'DISABLE',
  });
  const enabledResult = await readFusesFromExe(enabled);
  assert.equal(enabledResult.ok, true);
  assert.equal(enabledResult.asarIntegrityValidation, 'ENABLE');
  const none = join(root, 'none.exe');
  await writeFile(none, Buffer.from('no sentinel here'));
  assert.equal((await readFusesFromExe(none)).sentinelFound, false);
  await rm(root, { recursive: true, force: true });
});

// ---------- status / prepare / apply / restore 契约 ----------

test('status 三态：original → patched（apply 后）→ unknown（外部篡改）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-status-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  const original = await patchStatus({ targetDir, ...b });
  assert.equal(original.ok, true);
  assert.equal(original.patchState, 'original');
  assert.equal(original.supported, true);
  assert.equal(original.fuse.asarIntegrityValidation, 'DISABLE');

  const prepared = await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  assert.equal(prepared.ok, true);
  const applied = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(applied.ok, true);

  const patchedStatus = await patchStatus({ targetDir, ...b });
  assert.equal(patchedStatus.patchState, 'patched');
  assert.equal(patchedStatus.patchInfo.patchVersion, PATCH_VERSION);
  assert.equal(patchedStatus.backup.exists, true);
  assert.equal(patchedStatus.backup.matchesOriginal, true);

  await writeFile(target.asarPath, Buffer.concat([await readFile(target.asarPath), Buffer.from('tampered')]));
  const unknownStatus = await patchStatus({ targetDir, ...b });
  assert.equal(unknownStatus.patchState, 'conflict');
  assert.equal(unknownStatus.supported, false);
  await rm(root, { recursive: true, force: true });
});

test('prepare：身份不符明确失败（版本不同 → unsupported_package，同版本摘要不同 → digest_mismatch），目标不被写入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-prepare-identity-'));
  const targetDir = join(root, 'target');
  const target = await makeSupportedTarget(targetDir);
  const asarPath = join(targetDir, 'resources', 'app.asar');
  const asarBytes = await readFile(asarPath);
  const before = sha256(asarBytes);
  // 工具登记为另一版本包：目标实际（磁盘真值）与登记不符 → unsupported_package。
  const otherVersion = {
    exeName: 'ZCode.exe',
    exeFileVersion: '3.16.3.9999',
    appAsarRelativePath: 'resources/app.asar',
    appAsarSha256: before,
    appAsarBytes: asarBytes.length,
  };
  const versionResult = await patchPrepare({
    targetDir,
    outDir: join(root, 'c1'),
    packageIdentity: otherVersion,
    resolveIdentity: target.resolveIdentity,
  });
  assert.equal(versionResult.ok, false);
  assert.equal(versionResult.code, 'unsupported_package');
  assert.match(versionResult.reason, /exe 版本不符/);
  // 工具登记同版本但摘要不同（原包被改/升级后旧工具）：exe 版本一致、摘要不符 → digest_mismatch。
  const digestResult = await patchPrepare({
    targetDir,
    outDir: join(root, 'c2'),
    packageIdentity: { ...target.identity, appAsarSha256: 'deadbeef'.repeat(8) },
    resolveIdentity: target.resolveIdentity,
  });
  assert.equal(digestResult.ok, false);
  assert.equal(digestResult.code, 'digest_mismatch');
  assert.match(digestResult.reason, /SHA-256 不符/);
  // 失败路径不写目标
  assert.equal(sha256(await readFile(asarPath)), before);
  await rm(root, { recursive: true, force: true });
});

test('prepare：锚点失配拒绝（anchor_mismatch），不产出候选', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-anchor-'));
  const targetDir = join(root, 'target');
  const brokenIndex = Buffer.from(FIXTURE_INDEX.toString('utf8').replace('getToken:s(async ae=>', 'getToken:s(async signal=>'));
  const target = await makeSupportedTarget(targetDir, { extraFiles: [] });
  await writeFile(target.asarPath, buildAsarBuffer([
    { path: 'package.json', content: Buffer.from('{}') },
    { path: 'out/main/index.js', content: brokenIndex },
  ]));
  const identity = { ...target.identity, appAsarSha256: sha256(await readFile(target.asarPath)) };
  const result = await patchPrepare({
    targetDir,
    outDir: join(root, 'candidate'),
    packageIdentity: identity,
    resolveIdentity: async () => ({ exeFileVersion: identity.exeFileVersion, appAsarSha256: identity.appAsarSha256, appAsarBytes: identity.appAsarBytes }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'anchor_mismatch');
  assert.match(result.reason, /P4-token-short-circuit 未命中/);
  await rm(root, { recursive: true, force: true });
});

test('prepare：候选包含原/补丁摘要与注入点清单，补丁包字节确定', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-prepare-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const result = await patchPrepare({ targetDir, outDir: candidateDir, ...boundaries(target) });
  assert.equal(result.ok, true);
  const { candidate, candidateAsarPath, candidateMetaPath } = result;
  assert.equal(candidate.patchVersion, PATCH_VERSION);
  assert.equal(candidate.target.appAsarSha256, target.identity.appAsarSha256);
  assert.equal(candidate.patched.indexJsOriginalBytes, FIXTURE_INDEX.length);
  assert.ok(candidate.patched.indexJsPatchedBytes > FIXTURE_INDEX.length);
  assert.equal(candidate.injections.length, INJECTIONS.length);
  for (const injection of candidate.injections) {
    assert.ok(Number.isInteger(injection.bytesAdded) && injection.bytesAdded > 0, `${injection.id} bytesAdded`);
  }
  assert.equal(sha256(await readFile(candidateAsarPath)), candidate.patched.appAsarSha256);
  assert.equal(JSON.parse(await readFile(candidateMetaPath, 'utf8')).kind, 'local-only-patch-candidate');
  // 目标未被修改
  assert.equal(sha256(await readFile(target.asarPath)), target.identity.appAsarSha256);
  // 确定性：重复 prepare 同字节
  const again = await patchPrepare({ targetDir, outDir: join(root, 'candidate2'), ...boundaries(target) });
  assert.equal(again.candidate.patched.appAsarSha256, candidate.patched.appAsarSha256);
  await rm(root, { recursive: true, force: true });
});

test('apply 全链：备份验证 → 替换 → 状态记录；补丁 asar 内容正确、chunk 与 unpacked 保留', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-apply-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  const prepared = await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  const applied = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(applied.ok, true);
  assert.equal(applied.alreadyApplied, false);
  const backupPath = target.asarPath + '.lo02bak';
  const statePath = target.asarPath + '.lo02state.json';
  assert.equal(await exists(backupPath), true);
  assert.equal(sha256(await readFile(backupPath)), target.identity.appAsarSha256);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.patchVersion, PATCH_VERSION);
  assert.equal(state.originalAsarSha256, target.identity.appAsarSha256);
  assert.equal(state.patchedAsarSha256, prepared.candidate.patched.appAsarSha256);
  // 替换后目标 asar == 候选字节
  assert.equal(sha256(await readFile(target.asarPath)), prepared.candidate.patched.appAsarSha256);
  // 补丁包内 index.js == 注入结果；chunk 文件字节不变
  const { content } = applyInjections(FIXTURE_INDEX.toString('utf8'));
  assert.equal((await extractAsarFile(target.asarPath, 'out/main/index.js')).toString('utf8'), content);
  const { header: originalHeader } = await readAsarHeader(candidateDir + '/app.asar');
  assert.ok(originalHeader.files.out.files.main.files['chunk-FIXTURE.js']);
  await rm(root, { recursive: true, force: true });
});

test('apply：候选摘要不符拒绝；准备后目标变化拒绝（不覆盖升级后的包）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-apply-stale-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  // 候选被篡改
  await writeFile(join(candidateDir, 'app.asar'), Buffer.concat([await readFile(join(candidateDir, 'app.asar')), Buffer.from('x')]));
  const tamperedCandidate = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(tamperedCandidate.ok, false);
  assert.equal(tamperedCandidate.code, 'digest_mismatch');
  // 恢复候选后：准备后目标被升级替换 → 拒绝
  const candidateAsar = join(candidateDir, 'app.asar');
  const prepared2 = await patchPrepare({ targetDir, outDir: candidateDir + '2', ...boundaries(target) });
  assert.equal(prepared2.ok, true);
  await writeFile(target.asarPath, buildAsarBuffer([
    { path: 'package.json', content: Buffer.from('{"main":"out/main/index.js","version":"3.17.0"}') },
    { path: 'out/main/index.js', content: Buffer.from('upgraded new index without anchors') },
  ]));
  const stale = await patchApply({
    targetDir,
    candidateDir: candidateDir + '2',
    packageIdentity: target.identity,
    resolveIdentity: async () => ({ exeFileVersion: '3.16.2.8769', appAsarSha256: sha256(await readFile(target.asarPath)), appAsarBytes: (await stat(target.asarPath)).size }),
    readProcesses: noProcesses,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'digest_mismatch');
  assert.match(stale.reason, /准备后被升级或其它工具修改/);
  await rm(root, { recursive: true, force: true });
});

test('apply：目标运行实例存在明确失败（running_instance），不强退、不写入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-apply-running-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  await patchPrepare({ targetDir, outDir: candidateDir, ...boundaries(target) });
  const before = sha256(await readFile(target.asarPath));
  const result = await patchApply({ targetDir, candidateDir, ...boundaries(target, { processes: async () => [4242, 4243] }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'running_instance');
  assert.match(result.reason, /4242, 4243/);
  assert.equal(sha256(await readFile(target.asarPath)), before);
  await rm(root, { recursive: true, force: true });
});

test('apply：重复应用同补丁识别为已应用，不覆盖原备份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-apply-repeat-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  const first = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(first.ok, true);
  const backupPath = target.asarPath + '.lo02bak';
  const backupBefore = { sha: sha256(await readFile(backupPath)), mtime: (await stat(backupPath)).mtimeMs };
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 20));
  const second = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.backupIntact, true);
  assert.equal(sha256(await readFile(backupPath)), backupBefore.sha);
  assert.equal((await stat(backupPath)).mtimeMs, backupBefore.mtime);
  await rm(root, { recursive: true, force: true });
});

test('restore：恢复后 asar 摘要 == 原包，状态与备份清理', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-restore-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  await patchApply({ targetDir, candidateDir, ...b });
  const result = await patchRestore({ targetDir, ...b });
  assert.equal(result.ok, true);
  assert.equal(result.restoredAsarSha256, target.identity.appAsarSha256);
  assert.equal(sha256(await readFile(target.asarPath)), target.identity.appAsarSha256);
  assert.equal(await exists(target.asarPath + '.lo02bak'), false);
  assert.equal(await exists(target.asarPath + '.lo02state.json'), false);
  await rm(root, { recursive: true, force: true });
});

test('restore：当前包与记录不匹配（被升级/其它工具改过）明确拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-restore-conflict-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  await patchApply({ targetDir, candidateDir, ...b });
  await writeFile(target.asarPath, Buffer.concat([await readFile(target.asarPath), Buffer.from('upgraded')]));
  const conflict = await patchRestore({
    targetDir,
    packageIdentity: target.identity,
    resolveIdentity: async () => ({ exeFileVersion: '3.16.2.8769', appAsarSha256: sha256(await readFile(target.asarPath)), appAsarBytes: (await stat(target.asarPath)).size }),
    readProcesses: noProcesses,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'digest_mismatch');
  assert.match(conflict.reason, /拒绝覆盖/);
  // 无状态记录时拒绝盲恢复
  const bareDir = join(root, 'bare');
  await makeSupportedTarget(bareDir);
  const bare = await patchRestore({ targetDir: bareDir, ...boundaries(await Promise.resolve({ identity: target.identity, resolveIdentity: async () => ({ exeFileVersion: '3.16.2.8769', appAsarSha256: sha256(await readFile(join(bareDir, 'resources', 'app.asar'))), appAsarBytes: 1 }) })) });
  assert.equal(bare.ok, false);
  assert.equal(bare.code, 'backup_missing');
  await rm(root, { recursive: true, force: true });
});

test('fuse：EnableEmbeddedAsarIntegrityValidation=ENABLE 时 prepare/apply 拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo02-fuse-enabled-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir, { wire: '101010011' });
  const b = boundaries(target);
  const prepareResult = await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  assert.equal(prepareResult.ok, false);
  assert.equal(prepareResult.code, 'fuse_validation_enabled');
  // 状态报告同时暴露阻断原因
  const status = await patchStatus({ targetDir, ...b });
  assert.equal(status.fuse.asarIntegrityValidation, 'ENABLE');
  assert.equal(status.fuse.blockingPatch, 'fuse_validation_enabled');
  await rm(root, { recursive: true, force: true });
});

test('EXIT_CODES：票面要求的失败分类全部登记', () => {
  for (const code of ['unsupported_package', 'digest_mismatch', 'running_instance', 'backup_missing', 'write_failed', 'fuse_validation_enabled']) {
    assert.ok(Number.isInteger(EXIT_CODES[code]), `缺少退出码 ${code}`);
  }
  assert.equal(EXIT_CODES.anchor_mismatch, 16);
});
