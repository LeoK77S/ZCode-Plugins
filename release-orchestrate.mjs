// PKG-07：仓库层发布编排。职责：调用四包既有 build-release 入口（PKG-02~04 已交付，
// 本模块不重复实现构建）-> 组装产物契约校验 -> 确定性 ZIP -> ZIP 解压复验 -> 发布记录
// （绑定提交、构建输入摘要、工具链与正式 ZIP 摘要；ZIP 内不含提交自引用）-> 市场候选
// 与版本统一检查。
// 一轮正式发布只生成一次 ZIP：源码输入未变的包复用原 ZIP 字节与证据（规格 9.2：
// 只改变提交身份不重建），输入漂移只重建受影响包；门禁只核对输入漂移与 ZIP 摘要，
// 不重新构建。
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { writeDeterministicZip, extractZip } from './release-zip.mjs';
import { verifyReleaseDir } from './release-verify.mjs';
import { checkVersionConsistency, generateMarketplaceCandidate } from './release-marketplace.mjs';

const run = promisify(execFile);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const toPosix = path => path.split('\\').join('/');
const sortedObject = value => Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)));

export const PLUGIN_ORDER = ['suian-zcode-common', 'suian-zcode-title', 'suian-zcode-app-mcp', 'suian-side-editor'];
const INPUT_SUFFIXES = ['.mjs', '.cjs', '.js', '.json', '.ps1', '.vbs', '.md', '.html', '.css'];
const EXCLUDED_SEGMENTS = new Set(['node_modules', '.scratch', 'tests', 'docs', 'experiments', '.git', '.zcode-plugin']);
export const RECORD_NAME = 'release-record.json';
export const CANDIDATE_NAME = 'marketplace.candidate.json';

// 源码输入摘要：发布复用与门禁漂移判定共用；覆盖会实际影响产物的源文件与锁文件。
async function scanSourceInputs(dir, base = dir) {
  const inputs = {};
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return inputs;
  }
  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(inputs, await scanSourceInputs(path, base));
    else if (entry.isFile() && INPUT_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) {
      inputs[toPosix(relative(base, path))] = sha256(await readFile(path));
    }
  }
  return inputs;
}

async function resolveDefaultCommit(repoRoot) {
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true });
  return stdout.trim();
}

/** 默认构建器：子进程调用各包既有 build-release.mjs（构建工具由各包 node_modules 提供）。 */
function defaultBuilders(repoRoot) {
  const builders = {};
  for (const plugin of PLUGIN_ORDER) {
    builders[plugin] = async ({ outDir }) => {
      await run(process.execPath, [join(repoRoot, plugin, 'build-release.mjs'), '--out', outDir], { cwd: repoRoot, windowsHide: true });
    };
  }
  return builders;
}

async function findBuildInputs(workDir) {
  const found = [];
  const walk = async dir => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === 'build-inputs.json') found.push(path);
    }
  };
  await walk(workDir);
  return found.length ? JSON.parse(await readFile(found[0], 'utf8')) : null;
}

/**
 * 全链编排。逐包幂等：既有记录中该包源码输入摘要一致 -> 复用原 ZIP 与证据（不重跑
 * 构建器、不重打包）；漂移 -> 只重建该包。commit 变化本身不触发重建（规格 9.2 等同性
 * 复用），新 commit 写入新记录。
 */
export async function buildReleaseArtifacts({
  repoRoot, outDir, builders, resolveCommit, marketplace, releaseTag, baseUrl,
  plugins = PLUGIN_ORDER,
}) {
  repoRoot = resolve(repoRoot);
  outDir = resolve(outDir);
  const commitFn = resolveCommit ?? (() => resolveDefaultCommit(repoRoot));
  const allBuilders = builders ?? defaultBuilders(repoRoot);
  const commit = await commitFn(repoRoot);
  const workRoot = join(outDir, 'work');
  const zipsDir = join(outDir, 'zips');
  await mkdir(workRoot, { recursive: true });
  await mkdir(zipsDir, { recursive: true });

  let previous = null;
  try {
    previous = JSON.parse(await readFile(join(outDir, RECORD_NAME), 'utf8'));
  } catch { /* 首轮发布 */ }

  const problems = [];
  const zipResults = [];
  const pluginRecords = {};
  const sourceInputsByPlugin = {};
  const isCommon = plugin => plugin === 'suian-zcode-common';
  let commonReleaseDir = plugins.some(isCommon) && previous?.plugins?.['suian-zcode-common']
    ? join(outDir, previous.plugins['suian-zcode-common'].releaseDir)
    : null;

  for (const plugin of plugins) {
    const inputs = await scanSourceInputs(join(repoRoot, plugin));
    sourceInputsByPlugin[plugin] = inputs;
    const sourceDigest = sha256(JSON.stringify(sortedObject(inputs)));
    const prior = previous?.plugins?.[plugin];
    const reuse = prior && prior.sourceDigest === sourceDigest;

    let releaseDir;
    let release;
    let inputDigest;
    if (reuse) {
      releaseDir = join(outDir, prior.releaseDir);
      release = { pluginVersion: prior.pluginVersion, buildId: prior.buildId };
      inputDigest = prior.inputDigest;
      if (isCommon(plugin)) commonReleaseDir = releaseDir;
    } else {
      const workDir = join(workRoot, plugin);
      await rm(workDir, { recursive: true, force: true });
      const stagingRelease = join(workDir, 'release');
      await allBuilders[plugin]({ outDir: stagingRelease, repoRoot });
      releaseDir = stagingRelease;
      release = JSON.parse(await readFile(join(stagingRelease, 'release.json'), 'utf8'));
      const buildInputs = await findBuildInputs(workDir);
      // 真实构建取 build-inputs.json 的 inputDigest（esbuild metafile 语义），否则以源码扫描为准。
      inputDigest = buildInputs?.inputDigest ?? sha256(JSON.stringify(sortedObject(inputs)));
      if (isCommon(plugin)) commonReleaseDir = stagingRelease;
    }

    const fileName = `${plugin}-${release.pluginVersion}.zip`;
    const zipPath = join(zipsDir, fileName);
    if (!reuse) {
      const zip = await writeDeterministicZip({ sourceDir: releaseDir, zipPath });
      zipResults.push({ plugin, releaseDir, version: release.pluginVersion, buildId: release.buildId, zipPath, zipSha256: zip.zipSha256, fresh: true });
    } else {
      zipResults.push({ plugin, releaseDir, version: release.pluginVersion, buildId: release.buildId, zipPath, zipSha256: prior.zipSha256, fresh: false });
    }
    pluginRecords[plugin] = {
      pluginVersion: release.pluginVersion,
      buildId: release.buildId,
      releaseDir: toPosix(relative(outDir, releaseDir)),
      sourceDigest,
      inputDigest,
      zipPath: toPosix(relative(outDir, zipPath)),
      zipSha256: zipResults.at(-1).zipSha256,
    };
  }

  // 组装目录校验 + 新打 ZIP 的解压复验（复用 ZIP 已在首轮验证，不再重复解压全量）。
  const sensitiveRoots = [repoRoot, homedir(), tmpdir()];
  for (const zipResult of zipResults) {
    const verifyOne = async (label, dir) => {
      const result = await verifyReleaseDir({
        releaseDir: dir,
        pluginName: zipResult.plugin,
        expectedVersion: zipResult.version,
        commonReleaseDir: isCommon(zipResult.plugin) ? null : commonReleaseDir,
        sensitiveRoots,
      });
      for (const problem of result.problems) problems.push({ plugin: zipResult.plugin, where: label, ...problem });
    };
    if (zipResult.fresh) {
      const extracted = await mkdtemp(join(tmpdir(), 'pkg07-verify-extract-'));
      try {
        await extractZip(zipResult.zipPath, extracted);
        await verifyOne('extracted', extracted);
      } catch (error) {
        problems.push({ plugin: zipResult.plugin, where: 'extracted', code: 'zip_extract_failed', message: String(error.message ?? error) });
      } finally {
        await rm(extracted, { recursive: true, force: true }).catch(() => {});
      }
    }
    await verifyOne('staged', zipResult.releaseDir);
  }

  // 市场候选：全部本轮包切换 ZIP 来源；版本统一检查只报告不一致。
  const candidate = generateMarketplaceCandidate({
    current: marketplace,
    baseUrl,
    releaseTag,
    updates: zipResults.map(({ plugin, version, zipSha256 }) => ({
      name: plugin, version, fileName: `${plugin}-${version}.zip`, zipSha256,
    })),
  });
  const stagedVersions = Object.fromEntries(zipResults.map(({ plugin, version }) => [plugin, version]));
  const versionReport = await checkVersionConsistency({
    repoRoot,
    pluginRoots: Object.fromEntries(plugins.map(plugin => [plugin, plugin])),
    marketplace,
    stagedVersions,
  });

  const record = {
    formatVersion: 1,
    commit,
    releaseTag,
    baseUrl,
    toolchain: { node: process.version, platform: process.platform },
    marketplace: { name: marketplace?.name ?? null },
    plugins: pluginRecords,
    sourceInputs: Object.fromEntries(plugins.map(plugin => [plugin, sourceInputsByPlugin[plugin]])),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(outDir, RECORD_NAME), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(join(outDir, CANDIDATE_NAME), `${JSON.stringify(candidate, null, 2)}\n`);

  return {
    record,
    zips: zipResults.map(({ plugin, version, zipPath, zipSha256, buildId }) => ({ plugin, pluginVersion: version, zipPath, zipSha256, buildId })),
    candidate,
    problems,
    versionReport,
  };
}

/**
 * 门禁：核对当前源码输入与已生成 ZIP 的记录一致（漂移逐文件定位），并复用原 ZIP 字节
 * （按记录摘要重算文件哈希，不重新构建）。返回 { ok, drifted, problems }。
 */
export async function gateCommitInputs({ repoRoot, record, outDir, commit }) {
  const problems = [];
  const drifted = [];
  if (commit && record.commit !== commit) problems.push({ code: 'commit_mismatch', expected: record.commit, actual: commit });
  for (const [plugin, pluginRecord] of Object.entries(record.plugins ?? {})) {
    const current = await scanSourceInputs(join(resolve(repoRoot), plugin));
    const recorded = record.sourceInputs?.[plugin] ?? {};
    for (const [path, digest] of Object.entries(current)) {
      if (recorded[path] !== digest) drifted.push({ plugin, path, kind: recorded[path] === undefined ? 'added' : 'changed' });
    }
    for (const path of Object.keys(recorded)) {
      if (!(path in current)) drifted.push({ plugin, path, kind: 'removed' });
    }
    try {
      const bytes = await readFile(join(resolve(outDir), pluginRecord.zipPath));
      if (sha256(bytes) !== pluginRecord.zipSha256) problems.push({ code: 'zip_digest_mismatch', plugin });
    } catch {
      problems.push({ code: 'zip_missing', plugin });
    }
  }
  return { ok: problems.length === 0 && drifted.length === 0, drifted, problems };
}

export { scanSourceInputs };

// ---- CLI 入口：node release-orchestrate.mjs <build|gate|marketplace> ----
// build：全链构建 + ZIP + 记录 + 候选（需 --tag 与 --base-url；不代选 tag/版本）。
// gate：对当前 HEAD 核对输入漂移与 ZIP 摘要（复用原字节，不重建）。
// marketplace：基于既有记录重新生成候选清单（供人工核对采纳）。
const usage = () => {
  console.error('用法：node release-orchestrate.mjs build --tag <release-tag> --base-url <https://github.com/<owner>/<repo>/releases/download> [--out .scratch/release] [--plugins a,b]');
  console.error('      node release-orchestrate.mjs gate [--out .scratch/release]');
  console.error('      node release-orchestrate.mjs marketplace --tag <release-tag> --base-url <...> [--out .scratch/release]');
  process.exitCode = 1;
};

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--')) return usage();
    options[rest[index].slice(2)] = rest[index + 1];
  }
  const repoRoot = dirnameOfScript();
  const outDir = resolve(repoRoot, options.out ?? '.scratch/release');
  if (command === 'build' || command === 'marketplace') {
    if (!options.tag || !options['base-url']) return usage();
  } else if (command !== 'gate') {
    return usage();
  }
  const marketplace = JSON.parse(await readFile(join(repoRoot, 'marketplace.json'), 'utf8'));

  if (command === 'gate') {
    const record = JSON.parse(await readFile(join(outDir, RECORD_NAME), 'utf8'));
    const result = await gateCommitInputs({ repoRoot, record, outDir });
    console.log(JSON.stringify({ ...result, recordCommit: record.commit }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'marketplace') {
    const record = JSON.parse(await readFile(join(outDir, RECORD_NAME), 'utf8'));
    const candidate = generateMarketplaceCandidate({
      current: marketplace,
      baseUrl: options['base-url'],
      releaseTag: options.tag,
      updates: Object.entries(record.plugins).map(([plugin, pluginRecord]) => ({
        name: plugin, version: pluginRecord.pluginVersion,
        fileName: `${plugin}-${pluginRecord.pluginVersion}.zip`, zipSha256: pluginRecord.zipSha256,
      })),
    });
    const target = join(outDir, CANDIDATE_NAME);
    await writeFile(target, `${JSON.stringify(candidate, null, 2)}\n`);
    console.log(JSON.stringify({ candidate: target }, null, 2));
    return;
  }

  const plugins = options.plugins ? options.plugins.split(',') : PLUGIN_ORDER;
  const result = await buildReleaseArtifacts({
    repoRoot, outDir, marketplace, releaseTag: options.tag, baseUrl: options['base-url'], plugins,
  });
  console.log(JSON.stringify({
    record: join(outDir, RECORD_NAME),
    candidate: join(outDir, CANDIDATE_NAME),
    zips: result.zips.map(({ plugin, pluginVersion, zipSha256 }) => ({ plugin, pluginVersion, zipSha256 })),
    problems: result.problems,
    versionReport: result.versionReport,
  }, null, 2));
  process.exitCode = result.problems.length ? 1 : 0;
}

function dirnameOfScript() {
  return dirname(fileURLToPath(import.meta.url));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
