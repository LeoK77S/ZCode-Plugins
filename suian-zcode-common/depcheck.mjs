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

async function checkNpmDependencies(installPath, name, issues) {
  const pkgRead = await readJsonAt(join(installPath, 'package.json'));
  if (pkgRead.status !== 'ok') {
    issues.push({ plugin: name, code: 'plugin_files_missing', detail: 'package.json 缺失或不可解析' });
    return false;
  }
  const deps = pkgRead.value.dependencies;
  if (!deps || typeof deps !== 'object') return true;
  const missing = [];
  for (const pkgName of Object.keys(deps)) {
    if (!(await maybeLstat(join(installPath, 'node_modules', pkgName)))) missing.push(pkgName);
  }
  if (missing.length) issues.push({ plugin: name, code: 'npm_dependency_missing', detail: missing.join(', ') });
  return true;
}

async function checkCommonLink(installPath, name, runtimeRoot, issues) {
  const linkPath = join(installPath, 'node_modules', COMMON_PACKAGE);
  const present = await maybeLstat(linkPath);
  if (!present) {
    issues.push({ plugin: name, code: 'common_link_missing', detail: 'node_modules/suian-zcode-common 不存在' });
    return;
  }
  if (!present.isSymbolicLink()) {
    issues.push({ plugin: name, code: 'common_link_not_symlink', detail: `${linkPath} 是真实目录而非链接` });
    return;
  }
  const target = resolve(await readlink(linkPath));
  if (!samePath(target, runtimeRoot)) {
    issues.push({ plugin: name, code: 'common_link_mismatch', detail: `链接指向 ${target}，应为 ${runtimeRoot}` });
  }
}

async function checkRuntimeLink(runtimeRoot, commonInstallPath, issues) {
  const present = await maybeLstat(runtimeRoot);
  if (!present) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_missing', detail: `${runtimeRoot} 不存在` });
    return;
  }
  if (!present.isSymbolicLink()) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_not_symlink', detail: `${runtimeRoot} 是真实目录而非链接` });
    return;
  }
  const target = resolve(await readlink(runtimeRoot));
  if (!(await maybeLstat(target))) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_target_missing', detail: `链接目标 ${target} 不存在` });
    return;
  }
  const pkgRead = await readJsonAt(join(target, 'package.json'));
  if (pkgRead.status !== 'ok' || pkgRead.value?.name !== COMMON_PACKAGE) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_target_invalid', detail: `目标 ${target} 不属于 ${COMMON_PACKAGE}` });
    return;
  }
  if (!samePath(target, commonInstallPath)) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_stale', detail: `稳定入口指向 ${target}，已安装版本在 ${commonInstallPath}` });
  }
}

// 完整性检查只读清单与文件系统，不依赖 node_modules 解析——钩子自身必须能在依赖全丢时照常运行并报警。
export async function scanSuianPlugins({ pluginsFile, homeDir = homedir(), toolsRoot } = {}) {
  const resolvedPluginsFile = pluginsFile ?? join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  const resolvedToolsRoot = toolsRoot ?? join(homeDir, '.zcode', 'tools');
  const runtimeRoot = join(resolvedToolsRoot, COMMON_PACKAGE, 'runtime');
  const result = { ok: true, skipped: null, checkedAt: new Date().toISOString(), runtimeRoot, plugins: [], issues: [] };

  const manifestRead = await readJsonAt(resolvedPluginsFile);
  if (manifestRead.status !== 'ok') {
    result.skipped = manifestRead.status === 'missing' ? 'no_manifest' : 'bad_manifest';
    return result;
  }
  const entries = pickSuianEntries(manifestRead.value);
  const commonEntry = entries.find(entry => entry?.name === COMMON_PACKAGE) ?? null;
  const consumers = entries.filter(entry => entry !== commonEntry);

  for (const entry of entries) {
    const name = entry.name;
    const installPath = typeof entry.installPath === 'string' ? entry.installPath : null;
    const record = { name, version: entry.version ?? null, installPath, dependsOnCommon: false };
    result.plugins.push(record);
    if (!installPath || !(await maybeLstat(installPath))?.isDirectory()) {
      result.issues.push({ plugin: name, code: 'cache_missing', detail: `缓存目录不存在：${installPath ?? '(清单未提供)'}` });
      continue;
    }
    const pluginRead = await readJsonAt(join(installPath, '.zcode-plugin', 'plugin.json'));
    if (pluginRead.status !== 'ok') result.issues.push({ plugin: name, code: 'plugin_files_missing', detail: '.zcode-plugin/plugin.json 缺失或不可解析' });
    record.dependsOnCommon = [...asArray(entry.dependencies), ...asArray(pluginRead.value?.dependencies)].includes(COMMON_PACKAGE);
    const pkgReadable = await checkNpmDependencies(installPath, name, result.issues);
    if (record.dependsOnCommon && pkgReadable) await checkCommonLink(installPath, name, runtimeRoot, result.issues);
  }

  const anyConsumer = result.plugins.some(record => record.name !== COMMON_PACKAGE && record.dependsOnCommon);
  if (anyConsumer && !commonEntry) {
    result.issues.push({ plugin: COMMON_PACKAGE, code: 'common_not_installed', detail: '业务插件声明依赖 suian-zcode-common，但清单中没有它的安装条目' });
  } else if (anyConsumer && typeof commonEntry.installPath === 'string') {
    await checkRuntimeLink(runtimeRoot, commonEntry.installPath, result.issues);
  }

  result.ok = result.issues.length === 0;
  return result;
}
