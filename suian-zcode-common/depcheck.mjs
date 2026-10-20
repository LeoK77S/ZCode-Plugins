import { createHash } from 'node:crypto';
import { lstat, readlink, readFile } from 'node:fs/promises';
import { join, resolve, toNamespacedPath } from 'node:path';
import { homedir } from 'node:os';

export const SUIAN_MARKETPLACE = 'suian-zcode-plugins';
export const COMMON_PACKAGE = 'suian-zcode-common';

const samePath = (a, b) => toNamespacedPath(resolve(a)) === toNamespacedPath(resolve(b));

async function maybeLstat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readJsonAt(path) {
  try { return { status: 'ok', value: JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'bad' }; }
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

const parseVersion = value => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ''));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const compareVersion = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
};

// 读取已安装插件清单里属于本仓库的 suian 系列条目（按插件名前缀或市场名识别）。
function pickSuianEntries(manifest) {
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
  return plugins.filter(entry => {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const id = typeof entry?.id === 'string' ? entry.id : '';
    return name.startsWith('suian-') || id.endsWith(`@${SUIAN_MARKETPLACE}`);
  });
}

const asArray = value => Array.isArray(value) ? value : [];

// 发布目录完整性（PKG-08 契约）：release.json 声明的每个文件必须存在且摘要一致。
// 业务兼容声明接受 expectedCommonApiVersion（app-mcp/side-editor）或 commonApiVersion（title），
// 与各 build-release.mjs 实际写出的字段对应；二者同存时以 expectedCommonApiVersion 为准。
function readCompatFields(release) {
  const expectedApi = release.expectedCommonApiVersion ?? release.commonApiVersion ?? null;
  return { expectedApi, minimumCommonVersion: typeof release.minimumCommonVersion === 'string' ? release.minimumCommonVersion : null };
}

function releaseShapeOk(release) {
  return release?.formatVersion === 1
    && typeof release?.pluginName === 'string'
    && typeof release?.pluginVersion === 'string' && parseVersion(release.pluginVersion) !== null
    && typeof release?.buildId === 'string' && /^[0-9a-f]{64}$/.test(release.buildId)
    && typeof release?.entries === 'object' && release.entries !== null
    && Array.isArray(release?.files);
}

async function checkReleaseDirectory(installPath, name, issues) {
  const releasePath = join(installPath, 'release.json');
  const releaseRead = await readJsonAt(releasePath);
  if (releaseRead.status === 'missing') {
    issues.push({ plugin: name, code: 'release_missing', detail: `${releasePath} 不存在（非发布包形态；源码开发布局不经原生安装分发）` });
    return null;
  }
  if (releaseRead.status !== 'ok' || !releaseShapeOk(releaseRead.value)) {
    issues.push({ plugin: name, code: 'release_invalid', detail: `release.json 缺失或字段不满足发布契约：${releasePath}` });
    return null;
  }
  const release = releaseRead.value;
  if (release.pluginName !== name) {
    issues.push({ plugin: name, code: 'identity_mismatch', detail: `发布清单身份为 ${release.pluginName}，安装条目是 ${name}` });
    return null;
  }
  for (const entry of release.files) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      issues.push({ plugin: name, code: 'release_invalid', detail: `发布清单文件条目异常：${JSON.stringify(entry)}` });
      continue;
    }
    const filePath = join(installPath, entry.path);
    const present = await maybeLstat(filePath);
    if (!present || !present.isFile()) {
      issues.push({ plugin: name, code: 'file_missing', detail: `发布文件缺失：${entry.path}` });
      continue;
    }
    const content = await readFile(filePath);
    if (sha256(content) !== entry.sha256) {
      issues.push({ plugin: name, code: 'file_digest_mismatch', detail: `发布文件摘要不符：${entry.path}` });
    }
  }
  return release;
}

// 遗留 runtime 链接状态：迁移遗留不是损坏，仅报告给迁移链参考。
async function inspectLegacyRuntimeLink(runtimeRoot) {
  const present = await maybeLstat(runtimeRoot);
  if (!present) return 'absent';
  return present.isSymbolicLink() ? 'symlink' : 'directory';
}

// 完整性检查只读清单与文件系统，不依赖 node_modules 解析——钩子自身必须能在依赖全丢时照常运行并报警。
export async function scanSuianPlugins({ pluginsFile, homeDir = homedir(), toolsRoot } = {}) {
  const resolvedPluginsFile = pluginsFile ?? join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  const resolvedToolsRoot = toolsRoot ?? join(homeDir, '.zcode', 'tools');
  const runtimeRoot = join(resolvedToolsRoot, COMMON_PACKAGE, 'runtime');
  const result = { ok: true, skipped: null, checkedAt: new Date().toISOString(), runtimeRoot, legacyRuntimeLink: null, plugins: [], issues: [] };

  const manifestRead = await readJsonAt(resolvedPluginsFile);
  if (manifestRead.status !== 'ok') {
    result.skipped = manifestRead.status === 'missing' ? 'no_manifest' : 'bad_manifest';
    return result;
  }
  const manifest = manifestRead.value;
  // 合法 JSON 但形态异常（null/数组/标量、plugins 非数组）同样视为清单损坏，静默跳过而非按空世界判 clean
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || (manifest.plugins !== undefined && !Array.isArray(manifest.plugins))) {
    result.skipped = 'bad_manifest';
    return result;
  }
  const entries = pickSuianEntries(manifest);
  const commonEntry = entries.find(entry => entry?.name === COMMON_PACKAGE) ?? null;

  const commonReleases = new Map();
  for (const entry of entries) {
    const name = entry.name;
    const installPath = typeof entry.installPath === 'string' ? entry.installPath : null;
    const record = { name, version: entry.version ?? null, installPath, dependsOnCommon: false, buildId: null, releaseVersion: null };
    result.plugins.push(record);
    if (!installPath || !(await maybeLstat(installPath))?.isDirectory()) {
      result.issues.push({ plugin: name, code: 'cache_missing', detail: `缓存目录不存在：${installPath ?? '(清单未提供)'}` });
      // 缓存目录缺失也保留清单层依赖判定，复合故障下 common 兼容检查不被短路
      record.dependsOnCommon = asArray(entry.dependencies).includes(COMMON_PACKAGE);
      continue;
    }
    const pluginRead = await readJsonAt(join(installPath, '.zcode-plugin', 'plugin.json'));
    if (pluginRead.status !== 'ok') result.issues.push({ plugin: name, code: 'plugin_files_missing', detail: '.zcode-plugin/plugin.json 缺失或不可解析' });
    record.dependsOnCommon = [...asArray(entry.dependencies), ...asArray(pluginRead.value?.dependencies)].includes(COMMON_PACKAGE);
    const release = await checkReleaseDirectory(installPath, name, result.issues);
    if (release) {
      record.buildId = release.buildId;
      record.releaseVersion = release.pluginVersion;
      if (name === COMMON_PACKAGE && typeof release.commonApiVersion === 'number') {
        commonReleases.set(installPath, release);
      }
    }
  }

  // common 兼容汇总：以清单中的 common 安装条目为基准，业务声明逐个比对。
  const anyConsumer = result.plugins.some(record => record.name !== COMMON_PACKAGE && record.dependsOnCommon);
  if (anyConsumer && !commonEntry) {
    result.issues.push({ plugin: COMMON_PACKAGE, code: 'common_not_installed', detail: '业务插件声明依赖 suian-zcode-common，但清单中没有它的安装条目' });
  } else if (anyConsumer && typeof commonEntry.installPath === 'string') {
    const commonRelease = commonReleases.get(commonEntry.installPath) ?? null;
    if (commonRelease) {
      for (const record of result.plugins) {
        if (record.name === COMMON_PACKAGE || !record.dependsOnCommon || !record.installPath) continue;
        const releaseRead = await readJsonAt(join(record.installPath, 'release.json'));
        if (releaseRead.status !== 'ok') continue; // 该业务自身损坏已单独报告
        const compat = readCompatFields(releaseRead.value);
        if (typeof compat.expectedApi === 'number' && compat.expectedApi !== commonRelease.commonApiVersion) {
          result.issues.push({ plugin: record.name, code: 'api_incompatible', detail: `要求的公共 API 版本为 ${compat.expectedApi}，已安装 common 发布为 ${commonRelease.commonApiVersion}；按市场配套版本更新对应插件或 common` });
        }
        if (compat.minimumCommonVersion) {
          if (!parseVersion(compat.minimumCommonVersion)) {
            result.issues.push({ plugin: record.name, code: 'version_insufficient', detail: `声明的 minimumCommonVersion 无法解析：${compat.minimumCommonVersion}` });
          } else if (compareVersion(commonRelease.pluginVersion, compat.minimumCommonVersion) < 0) {
            result.issues.push({ plugin: record.name, code: 'version_insufficient', detail: `已安装 common ${commonRelease.pluginVersion} 低于要求的 ${compat.minimumCommonVersion}` });
          }
        }
      }
    }
  }

  result.legacyRuntimeLink = await inspectLegacyRuntimeLink(runtimeRoot);
  result.ok = result.issues.length === 0;
  return result;
}
