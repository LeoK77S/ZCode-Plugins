// local-only 补丁 CLI（LO-02，Close #145）
// 子命令：status / prepare / apply / restore。每步返回真实退出码，失败明确报因，不吞错。
//
// 形态（已定决策·完全短路方案）：prepare 只读目标并生成候选 asar；apply 在目标进程退出后
// 备份→验证→替换→记录；restore 按记录恢复并核对摘要。运行实例检查发现进程即失败，不强退。
//
// 系统边界（exe 版本读取、fuse wire 读取、进程枚举）以参数注入，契约测试注入替身后
// 不启动真进程、不碰真实安装目录；默认边界使用 PowerShell（与 lab.mjs 同法）。
//
// asar 格式（对真实 3.16.2 包实测，05 笔记 §1）：
//   u32@0 = 4；u32@4 = 内层 pickle 长度；u32@8 = string pickle 长；u32@12 = json 字节数；
//   头 JSON 紧凑无空格，位于 [16, 16+jsonLen)；json 以空格 pad 到 4 字节对齐；
//   内容基址 = 16 + padded(jsonLen) = 8 + @4；文件项 offset 为字符串单值（起始，紧排无对齐）；
//   unpacked 项无 offset 字段（内容在 app.asar.unpacked，重写时原样保留条目）。

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  BACKUP_SUFFIX,
  EXIT_CODES,
  INJECTIONS,
  MAIN_ENTRY,
  PATCH_VERSION,
  STATE_SUFFIX,
  SUPPORTED_PACKAGE,
  applyInjections,
} from './patch-env.mjs';

const ASAR_BLOCK_SIZE = 4194304;
const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'latin1');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function integrityFor(buffer) {
  const hash = createHash('sha256').update(buffer).digest('hex');
  const blocks = [];
  for (let i = 0; i < buffer.length; i += ASAR_BLOCK_SIZE) {
    blocks.push(createHash('sha256').update(buffer.subarray(i, Math.min(i + ASAR_BLOCK_SIZE, buffer.length))).digest('hex'));
  }
  return { algorithm: 'SHA256', hash, blockSize: ASAR_BLOCK_SIZE, blocks };
}

// ---------- asar 读取与确定性重写 ----------

// 解析 asar 头：返回 { header, jsonLen, contentBase }；结构异常即抛错（digest_mismatch 上报）。
export async function readAsarHeader(asarPath) {
  const handle = await open(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    const outer = head.readUInt32LE(0);
    const pickleLen = head.readUInt32LE(4);
    const stringPickleLen = head.readUInt32LE(8);
    const jsonLen = head.readUInt32LE(12);
    const padded = (jsonLen + 3) & ~3;
    if (outer !== 4 || pickleLen !== stringPickleLen + 4 || 8 + pickleLen !== 16 + padded) {
      throw new Error(`asar 头布局异常：@0=${outer} @4=${pickleLen} @8=${stringPickleLen} @12=${jsonLen}`);
    }
    const jsonBuf = Buffer.alloc(jsonLen);
    await handle.read(jsonBuf, 0, jsonLen, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    if (!header || typeof header !== 'object' || !header.files) throw new Error('asar 头 JSON 无 files 根');
    return { header, jsonLen, contentBase: 16 + padded };
  } finally {
    await handle.close();
  }
}

function resolveTreeEntry(header, asarPath) {
  let node = { files: header.files };
  for (const segment of asarPath.split('/')) {
    node = node?.files?.[segment];
    if (!node) throw new Error(`asar 内路径不存在：${asarPath}`);
  }
  return node;
}

export async function extractAsarFile(asarPath, entryPath) {
  const { header, contentBase } = await readAsarHeader(asarPath);
  const entry = resolveTreeEntry(header, entryPath);
  if (entry.files || entry.unpacked) throw new Error(`asar 条目不是打包文件：${entryPath}`);
  const handle = await open(asarPath, 'r');
  try {
    const buffer = Buffer.alloc(entry.size);
    await handle.read(buffer, 0, entry.size, contentBase + Number(entry.offset));
    return buffer;
  } finally {
    await handle.close();
  }
}

// 确定性重写 asar：按头树原顺序重排全部非 unpacked 文件 offset（紧排），replacements 替换
// 指定条目内容并重算 integrity；其余条目内容字节不变、integrity 原样保留。
// 同输入同字节（头 JSON 紧凑序列化、pad 用空格、无时间戳）。
export async function writePatchedAsar({ srcPath, outPath, replacements = new Map(), copyChunkBytes = ASAR_BLOCK_SIZE }) {
  const { header, contentBase } = await readAsarHeader(srcPath);
  const entries = []; // { node, buffer | srcOffset, srcSize }
  let cursor = 0;
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) {
        walk(entry, path);
        continue;
      }
      if (entry.unpacked) {
        entries.push({ node: entry, path, unpacked: true });
        continue;
      }
      const replacement = replacements.get(path);
      if (replacement) {
        entry.size = replacement.length;
        entry.integrity = integrityFor(replacement);
        entries.push({ node: entry, path, buffer: replacement });
      } else {
        entries.push({ node: entry, path, srcOffset: contentBase + Number(entry.offset), srcSize: entry.size });
      }
      entry.offset = String(cursor);
      cursor += entry.size;
    }
  };
  walk({ files: header.files }, '');
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const paddedLen = (json.length + 3) & ~3;
  const jsonPad = Buffer.alloc(paddedLen - json.length, 0x20);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(4 + 4 + paddedLen, 4);
  prefix.writeUInt32LE(4 + paddedLen, 8);
  prefix.writeUInt32LE(json.length, 12);

  const srcHandle = await open(srcPath, 'r');
  const outHandle = await open(outPath, 'w');
  try {
    await outHandle.write(prefix, 0, 16, 0);
    await outHandle.write(json, 0, json.length, 16);
    if (jsonPad.length) await outHandle.write(jsonPad, 0, jsonPad.length, 16 + json.length);
    let position = 16 + paddedLen;
    const chunk = Buffer.alloc(copyChunkBytes);
    for (const item of entries) {
      if (item.unpacked) continue;
      if (item.buffer) {
        await outHandle.write(item.buffer, 0, item.buffer.length, position);
        position += item.buffer.length;
        continue;
      }
      let remaining = item.srcSize;
      let srcPos = item.srcOffset;
      while (remaining > 0) {
        const { bytesRead } = await srcHandle.read(chunk, 0, Math.min(remaining, chunk.length), srcPos);
        if (bytesRead === 0) throw new Error(`asar 源读取提前结束：${item.path}`);
        await outHandle.write(chunk, 0, bytesRead, position);
        srcPos += bytesRead;
        position += bytesRead;
        remaining -= bytesRead;
      }
    }
    await outHandle.truncate(position);
    return { bytes: position };
  } finally {
    await srcHandle.close();
    await outHandle.close();
  }
}

// ---------- 默认系统边界 ----------

const psQuote = (s) => `'${s.replaceAll("'", "''")}'`;

function runCommand(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const finish = (result) => { clearTimeout(timer); resolveRun(result); };
    child.on('error', (error) => finish({ code: -1, error: error.message, stdout, stderr }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

async function resolvePackageIdentityFromDisk(targetDir, { exeName = SUPPORTED_PACKAGE.exeName, appAsarRelativePath = SUPPORTED_PACKAGE.appAsarRelativePath } = {}) {
  const exePath = join(targetDir, exeName);
  const asarPath = join(targetDir, ...appAsarRelativePath.split('/'));
  for (const target of [exePath, asarPath]) {
    if (!(await exists(target))) throw new Error(`目标目录缺少必需文件：${target}`);
  }
  const versionResult = await runCommand('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath ${psQuote(exePath)}).VersionInfo.FileVersion`,
  ]);
  if (versionResult.code !== 0) {
    throw new Error(`读取 exe 版本失败（exit ${versionResult.code}）：${(versionResult.stderr || versionResult.error || '').trim()}`);
  }
  const exeFileVersion = versionResult.stdout.trim();
  if (!/^\d+(\.\d+){3}$/.test(exeFileVersion)) throw new Error(`exe 版本信息异常："${exeFileVersion}"`);
  const appAsarSha256 = await sha256File(asarPath);
  const appAsarBytes = (await stat(asarPath)).size;
  return { exeFileVersion, appAsarSha256, appAsarBytes };
}

// Electron fuse wire：sentinel 后 [version u8][count u8][count 个 '0'/'1'][0x00]（05 笔记 §4）。
// fuse #5 = EnableEmbeddedAsarIntegrityValidation；'1'（ENABLE）时修改 asar 会被完整性校验拒绝。
export async function readFusesFromExe(exePath) {
  const handle = await open(exePath, 'r');
  try {
    const info = await stat(exePath);
    const overlap = FUSE_SENTINEL.length;
    const window = 8 * 1024 * 1024;
    let position = 0;
    let carry = Buffer.alloc(0);
    while (position < info.size) {
      const buffer = Buffer.alloc(Math.min(window, info.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      const scan = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      const index = scan.indexOf(FUSE_SENTINEL);
      if (index !== -1) {
        const wireStart = index + overlap;
        if (wireStart + 2 > scan.length) break; // sentinel 跨读窗边界，极小概率；重扫下窗
        const version = scan[wireStart];
        const count = scan[wireStart + 1];
        const wire = scan.subarray(wireStart + 2, Math.min(wireStart + 2 + count, scan.length)).toString('latin1');
        if (version !== 1 || !/^[01]+$/.test(wire) || wire.length !== count) {
          return { sentinelFound: true, ok: false, reason: `fuse wire 异常：version=${version} count=${count} wire="${wire}"` };
        }
        return { sentinelFound: true, ok: true, version, count, wire, asarIntegrityValidation: wire[4] === '1' ? 'ENABLE' : 'DISABLE' };
      }
      carry = scan.subarray(Math.max(0, scan.length - overlap));
      position += bytesRead;
    }
    return { sentinelFound: false, ok: false, reason: '未找到 fuse sentinel（exe 结构变化，无法确认 asar 完整性校验状态）' };
  } finally {
    await handle.close();
  }
}

// WQL 内反斜杠与单引号双写转义（LO-01 真实运行暴露的缺陷，勿回退）。
export function buildProcessQueryScript(exePath) {
  const wqlPath = exePath.replaceAll('\\', '\\\\').replaceAll("'", "''");
  return [
    `$q = "SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = '${wqlPath}'"`,
    'Get-CimInstance -Query $q | ForEach-Object { "{0}" -f $_.ProcessId }',
  ].join('\n');
}

async function readProcessesByExe(exePath) {
  const result = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildProcessQueryScript(exePath)]);
  if (result.code !== 0) {
    throw new Error(`枚举目标进程失败（exit ${result.code}）：${(result.stderr || '').trim()}`);
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(Number);
}

// ---------- 状态/备份文件 ----------

function statePathsFor(asarPath) {
  return { backup: asarPath + BACKUP_SUFFIX, state: asarPath + STATE_SUFFIX };
}

async function readState(asarPath) {
  const { state } = statePathsFor(asarPath);
  try {
    return JSON.parse(await readFile(state, 'utf8'));
  } catch {
    return null;
  }
}

async function resolveTargetIdentity(targetDir, { packageIdentity = SUPPORTED_PACKAGE, resolveIdentity = resolvePackageIdentityFromDisk } = {}) {
  const actual = await resolveIdentity(targetDir);
  const expected = packageIdentity;
  const mismatches = [];
  if (actual.exeFileVersion !== expected.exeFileVersion) mismatches.push(`exe 版本不符：实际 ${actual.exeFileVersion}，期望 ${expected.exeFileVersion}`);
  if (String(actual.appAsarSha256).toLowerCase() !== String(expected.appAsarSha256).toLowerCase()) mismatches.push(`app.asar SHA-256 不符：实际 ${actual.appAsarSha256}，期望 ${expected.appAsarSha256}`);
  return { actual, matches: mismatches.length === 0, mismatches };
}

// ---------- 子命令 ----------

function classifyIdentityFailure(actual, packageIdentity, mismatches) {
  // exe 版本一致但 asar 摘要不同：包内容被改（升级/其它工具）→ digest_mismatch；
  // 版本不同：不受支持的包 → unsupported_package。
  const versionMatches = actual?.exeFileVersion === packageIdentity.exeFileVersion;
  return versionMatches ? 'digest_mismatch' : 'unsupported_package';
}

// status：报告原版/已 patch/未知、备份可用性、fuse 前置检查。只读。
export async function patchStatus({
  targetDir,
  packageIdentity = SUPPORTED_PACKAGE,
  resolveIdentity = resolvePackageIdentityFromDisk,
  readFuses = readFusesFromExe,
}) {
  targetDir = resolve(targetDir);
  const asarPath = join(targetDir, ...packageIdentity.appAsarRelativePath.split('/'));
  const exePath = join(targetDir, packageIdentity.exeName);
  let actual = null;
  try {
    actual = await resolveIdentity(targetDir);
  } catch (error) {
    return { ok: false, code: 'unsupported_package', reason: `目标身份解析失败：${error.message}` };
  }
  const fuse = await readFuses(exePath);
  const state = await readState(asarPath);
  const { backup } = statePathsFor(asarPath);
  const originalSha = String(packageIdentity.appAsarSha256).toLowerCase();
  const currentSha = String(actual.appAsarSha256).toLowerCase();
  let patchState = 'unknown';
  let patchInfo = null;
  if (currentSha === originalSha) patchState = 'original';
  else if (state && currentSha === String(state.patchedAsarSha256).toLowerCase()) {
    patchState = 'patched';
    patchInfo = { patchVersion: state.patchVersion };
  } else if (state) patchState = 'conflict';
  let backupInfo = null;
  if (await exists(backup)) {
    const backupSha = String(await sha256File(backup)).toLowerCase();
    const expectedBackupSha = state ? String(state.originalAsarSha256).toLowerCase() : originalSha;
    backupInfo = { exists: true, sha256: backupSha, matchesOriginal: backupSha === expectedBackupSha };
  } else {
    backupInfo = { exists: false, sha256: null, matchesOriginal: false };
  }
  const mismatches = [];
  if (actual.exeFileVersion !== packageIdentity.exeFileVersion) mismatches.push(`exe 版本不符：实际 ${actual.exeFileVersion}，期望 ${packageIdentity.exeFileVersion}`);
  if (currentSha !== originalSha && patchState !== 'patched') mismatches.push(`app.asar 摘要不属于已登记原版或补丁版：${actual.appAsarSha256}`);
  return {
    ok: true,
    targetDir,
    package: { exeFileVersion: actual.exeFileVersion, appAsarSha256: actual.appAsarSha256, appAsarBytes: actual.appAsarBytes },
    supported: mismatches.length === 0,
    ...(mismatches.length ? { mismatches } : {}),
    patchState,
    patchInfo,
    backup: backupInfo,
    fuse: { ...fuse, blockingPatch: fuse.ok && fuse.asarIntegrityValidation === 'ENABLE' ? 'fuse_validation_enabled' : null },
    stateFile: state,
  };
}

// prepare：核对身份 → 提取 index.js → 锚点校验与注入 → 确定性重写 asar → 输出候选。
// 不改运行中的目标（全流程只读目标目录）。
export async function patchPrepare({
  targetDir,
  outDir,
  packageIdentity = SUPPORTED_PACKAGE,
  resolveIdentity = resolvePackageIdentityFromDisk,
  readFuses = readFusesFromExe,
  now = () => new Date(),
}) {
  targetDir = resolve(targetDir);
  outDir = resolve(outDir);
  const asarPath = join(targetDir, ...packageIdentity.appAsarRelativePath.split('/'));
  const exePath = join(targetDir, packageIdentity.exeName);
  let actual;
  try {
    actual = await resolveIdentity(targetDir);
  } catch (error) {
    return { ok: false, code: 'unsupported_package', reason: `目标身份解析失败：${error.message}` };
  }
  const identity = await resolveTargetIdentity(targetDir, { packageIdentity, resolveIdentity: async () => actual });
  if (!identity.matches) {
    const code = classifyIdentityFailure(actual, packageIdentity, identity.mismatches);
    return { ok: false, code, reason: `目标包身份不匹配：${identity.mismatches.join('；')}` };
  }
  const fuse = await readFuses(exePath);
  if (!fuse.ok) return { ok: false, code: 'fuse_validation_enabled', reason: `fuse 前置检查失败：${fuse.reason}` };
  if (fuse.asarIntegrityValidation === 'ENABLE') {
    return { ok: false, code: 'fuse_validation_enabled', reason: 'EnableEmbeddedAsarIntegrityValidation 为 ENABLE，修改 app.asar 会被完整性校验拒绝' };
  }
  const originalIndex = await extractAsarFile(asarPath, MAIN_ENTRY);
  let injected;
  try {
    injected = applyInjections(originalIndex.toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'anchor_mismatch', reason: error.message };
  }
  const patchedIndex = Buffer.from(injected.content, 'utf8');
  await mkdir(outDir, { recursive: true });
  const candidateAsarPath = join(outDir, 'app.asar');
  try {
    await writePatchedAsar({ srcPath: asarPath, outPath: candidateAsarPath, replacements: new Map([[MAIN_ENTRY, patchedIndex]]) });
  } catch (error) {
    return { ok: false, code: 'internal', reason: `补丁 asar 写出失败：${error.message}` };
  }
  const patchedAsarSha256 = await sha256File(candidateAsarPath);
  const patchedAsarBytes = (await stat(candidateAsarPath)).size;
  const candidate = {
    formatVersion: 1,
    kind: 'local-only-patch-candidate',
    patchVersion: PATCH_VERSION,
    preparedAt: now().toISOString(),
    target: {
      exeName: packageIdentity.exeName,
      exeFileVersion: packageIdentity.exeFileVersion,
      appAsarRelativePath: packageIdentity.appAsarRelativePath,
      appAsarSha256: String(packageIdentity.appAsarSha256).toLowerCase(),
      appAsarBytes: packageIdentity.appAsarBytes,
    },
    patched: {
      appAsarSha256: patchedAsarSha256,
      appAsarBytes: patchedAsarBytes,
      indexJsOriginalSha256: createHash('sha256').update(originalIndex).digest('hex'),
      indexJsPatchedSha256: createHash('sha256').update(patchedIndex).digest('hex'),
      indexJsOriginalBytes: originalIndex.length,
      indexJsPatchedBytes: patchedIndex.length,
    },
    injections: injected.applied,
    entryPoint: MAIN_ENTRY,
  };
  const candidateMetaPath = join(outDir, 'candidate.json');
  await writeFile(candidateMetaPath, `${JSON.stringify(candidate, null, 2)}\n`);
  return { ok: true, outDir, candidateAsarPath, candidateMetaPath, candidate };
}

// apply：重新核对目标与候选匹配 → 目标进程退出检查 → 备份并验证可还原 → 替换 → 记录状态。
export async function patchApply({
  targetDir,
  candidateDir,
  packageIdentity = SUPPORTED_PACKAGE,
  resolveIdentity = resolvePackageIdentityFromDisk,
  readFuses = readFusesFromExe,
  readProcesses = readProcessesByExe,
  now = () => new Date(),
}) {
  targetDir = resolve(targetDir);
  candidateDir = resolve(candidateDir);
  const asarPath = join(targetDir, ...packageIdentity.appAsarRelativePath.split('/'));
  const exePath = join(targetDir, packageIdentity.exeName);
  const { backup, state: statePath } = statePathsFor(asarPath);
  let candidate;
  try {
    candidate = JSON.parse(await readFile(join(candidateDir, 'candidate.json'), 'utf8'));
  } catch (error) {
    return { ok: false, code: 'unsupported_package', reason: `候选元数据读取失败：${error.message}` };
  }
  if (candidate.kind !== 'local-only-patch-candidate' || candidate.formatVersion !== 1) {
    return { ok: false, code: 'unsupported_package', reason: '候选元数据格式不受支持' };
  }
  const candidateAsarPath = join(candidateDir, 'app.asar');
  if (!(await exists(candidateAsarPath))) {
    return { ok: false, code: 'unsupported_package', reason: `候选 asar 缺失：${candidateAsarPath}` };
  }
  const candidateSha = await sha256File(candidateAsarPath);
  if (candidateSha.toLowerCase() !== String(candidate.patched.appAsarSha256).toLowerCase()) {
    return { ok: false, code: 'digest_mismatch', reason: `候选 asar 摘要与元数据不符：${candidateSha}` };
  }
  let actual;
  try {
    actual = await resolveIdentity(targetDir);
  } catch (error) {
    return { ok: false, code: 'unsupported_package', reason: `目标身份解析失败：${error.message}` };
  }
  if (actual.exeFileVersion !== candidate.target.exeFileVersion) {
    return { ok: false, code: 'unsupported_package', reason: `目标 exe 版本与候选不符：实际 ${actual.exeFileVersion}，候选 ${candidate.target.exeFileVersion}` };
  }
  const currentSha = String(actual.appAsarSha256).toLowerCase();
  const originalSha = String(candidate.target.appAsarSha256).toLowerCase();
  const patchedSha = String(candidate.patched.appAsarSha256).toLowerCase();
  const previousState = await readState(asarPath);
  if (currentSha === patchedSha) {
    const backupOk = (await exists(backup)) && String(await sha256File(backup)).toLowerCase() === originalSha;
    return {
      ok: true,
      alreadyApplied: true,
      patchVersion: previousState?.patchVersion ?? candidate.patchVersion,
      backupIntact: backupOk,
      note: backupOk ? '目标已是该补丁版，未做任何写入' : '目标已是补丁版，但备份缺失或不匹配，restore 前需人工核对',
    };
  }
  if (currentSha !== originalSha) {
    return {
      ok: false,
      code: 'digest_mismatch',
      reason: `目标 app.asar 与候选不匹配（准备后被升级或其它工具修改）：当前 ${currentSha}，期望原版 ${originalSha}；拒绝覆盖`,
    };
  }
  if (previousState && String(previousState.patchedAsarSha256).toLowerCase() !== currentSha && String(previousState.originalAsarSha256).toLowerCase() !== currentSha) {
    return { ok: false, code: 'digest_mismatch', reason: '状态记录与当前包摘要均不匹配（目标被外部修改），拒绝应用' };
  }
  const fuse = await readFuses(exePath);
  if (!fuse.ok) return { ok: false, code: 'fuse_validation_enabled', reason: `fuse 前置检查失败：${fuse.reason}` };
  if (fuse.asarIntegrityValidation === 'ENABLE') {
    return { ok: false, code: 'fuse_validation_enabled', reason: 'EnableEmbeddedAsarIntegrityValidation 为 ENABLE，拒绝替换 app.asar' };
  }
  let processes;
  try {
    processes = await readProcesses(exePath);
  } catch (error) {
    return { ok: false, code: 'running_instance', reason: `目标运行实例检查失败：${error.message}` };
  }
  if (processes.length > 0) {
    return { ok: false, code: 'running_instance', reason: `目标安装目录存在运行实例（PID ${processes.join(', ')}），请先正常退出后重试（本工具不强退进程）` };
  }
  // 备份：已存在则核对摘要（重复应用同补丁不覆盖原备份），缺失则新建并验证可还原。
  if (await exists(backup)) {
    const backupSha = String(await sha256File(backup)).toLowerCase();
    if (backupSha !== originalSha) {
      return { ok: false, code: 'digest_mismatch', reason: `已有备份摘要与原版不符：${backupSha} != ${originalSha}；不覆盖，请人工核对` };
    }
  } else {
    try {
      await copyFile(asarPath, backup);
    } catch (error) {
      return { ok: false, code: 'write_failed', reason: `备份写入失败：${error.message}` };
    }
    const backupSha = String(await sha256File(backup)).toLowerCase();
    if (backupSha !== originalSha) {
      await rm(backup, { force: true });
      return { ok: false, code: 'write_failed', reason: '备份验证失败（摘要与原版不符），已删除损坏备份，未替换目标' };
    }
  }
  // 替换：先写临时文件并核对摘要，再原子改名，改名后复核。
  const stagingPath = asarPath + '.lo02tmp';
  const restoreFromBackup = async () => {
    try {
      await copyFile(backup, asarPath);
      const restored = String(await sha256File(asarPath)).toLowerCase();
      return restored === originalSha ? { restored: true } : { restored: false, detail: `恢复后摘要 ${restored}` };
    } catch (error) {
      return { restored: false, detail: error.message };
    }
  };
  try {
    await copyFile(candidateAsarPath, stagingPath);
    const stagingSha = String(await sha256File(stagingPath)).toLowerCase();
    if (stagingSha !== patchedSha) {
      await rm(stagingPath, { force: true });
      return { ok: false, code: 'write_failed', reason: `候选落盘摘要不符：${stagingSha}` };
    }
    await rename(stagingPath, asarPath);
  } catch (error) {
    await rm(stagingPath, { force: true }).catch(() => {});
    return { ok: false, code: 'write_failed', reason: `替换 app.asar 失败：${error.message}`, ...(await exists(asarPath) ? {} : { recovery: await restoreFromBackup() }) };
  }
  const appliedSha = String(await sha256File(asarPath)).toLowerCase();
  if (appliedSha !== patchedSha) {
    const recovery = await restoreFromBackup();
    return { ok: false, code: 'write_failed', reason: `替换后复核失败：${appliedSha} != ${patchedSha}`, recovery };
  }
  const state = {
    formatVersion: 1,
    kind: 'local-only-patch-state',
    patchVersion: candidate.patchVersion,
    appliedAt: now().toISOString(),
    targetExeFileVersion: candidate.target.exeFileVersion,
    originalAsarSha256: originalSha,
    patchedAsarSha256: patchedSha,
    backupFile: backup,
    candidateInjections: candidate.injections,
  };
  try {
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    const recovery = await restoreFromBackup();
    if (recovery.restored) await rm(statePath, { force: true }).catch(() => {});
    return { ok: false, code: 'write_failed', reason: `状态记录写入失败：${error.message}`, recovery };
  }
  return {
    ok: true,
    alreadyApplied: false,
    patchVersion: candidate.patchVersion,
    originalAsarSha256: originalSha,
    patchedAsarSha256: appliedSha,
    backupFile: backup,
    stateFile: statePath,
    injections: candidate.injections,
  };
}

// restore：按备份恢复并核对恢复后摘要 == 原包；当前包与记录不符时明确拒绝。
export async function patchRestore({
  targetDir,
  packageIdentity = SUPPORTED_PACKAGE,
  resolveIdentity = resolvePackageIdentityFromDisk,
  readProcesses = readProcessesByExe,
}) {
  targetDir = resolve(targetDir);
  const asarPath = join(targetDir, ...packageIdentity.appAsarRelativePath.split('/'));
  const exePath = join(targetDir, packageIdentity.exeName);
  const { backup, state: statePath } = statePathsFor(asarPath);
  const state = await readState(asarPath);
  if (!state || state.kind !== 'local-only-patch-state') {
    return { ok: false, code: 'backup_missing', reason: '缺少本工具的补丁状态记录，拒绝盲恢复（备份或状态可能属于其它工具）' };
  }
  let actual;
  try {
    actual = await resolveIdentity(targetDir);
  } catch (error) {
    return { ok: false, code: 'unsupported_package', reason: `目标身份解析失败：${error.message}` };
  }
  if (actual.exeFileVersion !== state.targetExeFileVersion) {
    return { ok: false, code: 'digest_mismatch', reason: `目标 exe 版本已变化（实际 ${actual.exeFileVersion}，记录 ${state.targetExeFileVersion}），拒绝恢复` };
  }
  const currentSha = String(actual.appAsarSha256).toLowerCase();
  const originalSha = String(state.originalAsarSha256).toLowerCase();
  const patchedSha = String(state.patchedAsarSha256).toLowerCase();
  if (currentSha === originalSha) {
    await rm(statePath, { force: true }).catch(() => {});
    await rm(backup, { force: true }).catch(() => {});
    return { ok: true, alreadyRestored: true, note: '目标已是记录的原版摘要，清理状态与备份' };
  }
  if (currentSha !== patchedSha) {
    return {
      ok: false,
      code: 'digest_mismatch',
      reason: `当前包摘要 ${currentSha} 与本工具记录（补丁版 ${patchedSha}）不匹配（已被升级或其它工具修改），拒绝覆盖`,
    };
  }
  if (!(await exists(backup))) {
    return { ok: false, code: 'backup_missing', reason: `备份文件缺失：${backup}` };
  }
  const backupSha = String(await sha256File(backup)).toLowerCase();
  if (backupSha !== originalSha) {
    return { ok: false, code: 'digest_mismatch', reason: `备份摘要 ${backupSha} 与记录的原版摘要不符，拒绝恢复` };
  }
  let processes;
  try {
    processes = await readProcesses(exePath);
  } catch (error) {
    return { ok: false, code: 'running_instance', reason: `目标运行实例检查失败：${error.message}` };
  }
  if (processes.length > 0) {
    return { ok: false, code: 'running_instance', reason: `目标安装目录存在运行实例（PID ${processes.join(', ')}），请先正常退出后重试（本工具不强退进程）` };
  }
  const stagingPath = asarPath + '.lo02tmp';
  try {
    await copyFile(backup, stagingPath);
    const stagingSha = String(await sha256File(stagingPath)).toLowerCase();
    if (stagingSha !== originalSha) {
      await rm(stagingPath, { force: true });
      return { ok: false, code: 'digest_mismatch', reason: `备份落盘摘要不符：${stagingSha}` };
    }
    await rename(stagingPath, asarPath);
  } catch (error) {
    await rm(stagingPath, { force: true }).catch(() => {});
    return { ok: false, code: 'write_failed', reason: `恢复 app.asar 失败：${error.message}` };
  }
  const restoredSha = String(await sha256File(asarPath)).toLowerCase();
  if (restoredSha !== originalSha) {
    return { ok: false, code: 'write_failed', reason: `恢复后摘要核对失败：${restoredSha} != ${originalSha}；备份与状态保留在原处` };
  }
  await rm(statePath, { force: true }).catch(() => {});
  await rm(backup, { force: true }).catch(() => {});
  return { ok: true, restoredAsarSha256: restoredSha, note: '已恢复原版摘要并清理状态与备份' };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { values[key] = next; i++; }
    else values[key] = true;
  }
  return values;
}

async function loadPackageIdentityOption(values) {
  if (!values['package-identity']) return {};
  try {
    return { packageIdentity: JSON.parse(await readFile(values['package-identity'], 'utf8')) };
  } catch (error) {
    throw new Error(`--package-identity 文件读取失败：${error.message}`);
  }
}

export async function main(argv) {
  const [command, ...rest] = argv;
  const values = parseArgs(rest);
  if (!values.target) {
    console.error('缺少 --target <安装目录>');
    return EXIT_CODES.usage;
  }
  let options = {};
  try {
    options = await loadPackageIdentityOption(values);
  } catch (error) {
    console.error(error.message);
    return EXIT_CODES.usage;
  }
  const report = (result) => { console.log(JSON.stringify(result, null, 2)); return result; };
  if (command === 'status') {
    const result = await patchStatus({ targetDir: values.target, ...options });
    report(result);
    return result.ok ? EXIT_CODES.ok : EXIT_CODES[result.code] ?? EXIT_CODES.internal;
  }
  if (command === 'prepare') {
    if (!values.out) { console.error('缺少 --out <候选目录>'); return EXIT_CODES.usage; }
    const result = await patchPrepare({ targetDir: values.target, outDir: values.out, ...options });
    report(result);
    return result.ok ? EXIT_CODES.ok : EXIT_CODES[result.code] ?? EXIT_CODES.internal;
  }
  if (command === 'apply') {
    if (!values.candidate) { console.error('缺少 --candidate <候选目录>'); return EXIT_CODES.usage; }
    const result = await patchApply({ targetDir: values.target, candidateDir: values.candidate, ...options });
    report(result);
    return result.ok ? EXIT_CODES.ok : EXIT_CODES[result.code] ?? EXIT_CODES.internal;
  }
  if (command === 'restore') {
    const result = await patchRestore({ targetDir: values.target, ...options });
    report(result);
    return result.ok ? EXIT_CODES.ok : EXIT_CODES[result.code] ?? EXIT_CODES.internal;
  }
  console.error('用法：node local-only/patch.mjs <status|prepare|apply|restore> --target <安装目录> [--out <候选目录>] [--candidate <候选目录>] [--package-identity <json>]');
  return EXIT_CODES.usage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(await main(process.argv.slice(2)));
}
