// 薄定位器：单一源码维护，构建时分发到业务包（PKG-01 契约）。
// 只依赖 Node 内置模块；定位与兼容校验全部在导入业务入口之前完成。
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMMON_PLUGIN_ID = 'suian-zcode-common@suian-zcode-plugins';
export const COMMON_PLUGIN_NAME = 'suian-zcode-common';
export const COMMON_MARKETPLACE = 'suian-zcode-plugins';

const REGISTRY_FILE = 'installed_plugins.json';
const RELEASE_FILE = 'release.json';
// 宿主数据目录布局：<storageRoot>/data/<sanitized-plugin-id>，向上两级即存储根。
const DATA_DEPTH = 2;

export class CommonLocationError extends Error {
  constructor(code, stage, message, detail) {
    super(message);
    this.name = 'CommonLocationError';
    this.code = code;
    this.stage = stage;
    this.detail = detail;
  }
}

const fail = (code, stage, message, detail) => {
  throw new CommonLocationError(code, stage, message, detail);
};

const parseVersion = value => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersion = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
};

async function readRegistry(registryPath) {
  let raw;
  try {
    raw = await readFile(registryPath, 'utf8');
  } catch (error) {
    fail('registry_missing', 'registry', `无法读取安装记录 ${registryPath}：${error.message}`);
  }
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch (error) {
    fail('registry_invalid', 'registry', `安装记录不是合法 JSON：${error.message}`);
  }
  if (registry?.version !== 1 || !Array.isArray(registry?.plugins)) {
    fail('registry_invalid', 'registry', '安装记录结构不符：需要 { version: 1, plugins: [...] }');
  }
  return registry;
}

async function findCommonRecord(registry, registryPath) {
  const matches = registry.plugins.filter(plugin => plugin?.id === COMMON_PLUGIN_ID);
  if (matches.length === 0) {
    fail('common_not_installed', 'registry', `安装记录中没有 ${COMMON_PLUGIN_ID}；先安装原生 common 插件`, { registryPath });
  }
  if (matches.length > 1) {
    fail('common_ambiguous', 'registry', `安装记录中 ${COMMON_PLUGIN_ID} 出现 ${matches.length} 次，拒绝猜测`, { registryPath });
  }
  const record = matches[0];
  if (record.name !== COMMON_PLUGIN_NAME || record.marketplace !== COMMON_MARKETPLACE || typeof record.installPath !== 'string' || !isAbsolute(record.installPath)) {
    fail('registry_invalid', 'registry', 'common 安装记录缺少完整身份或绝对 installPath');
  }
  try {
    const info = await stat(record.installPath);
    if (!info.isDirectory()) fail('install_path_missing', 'install', `common 安装路径不是目录：${record.installPath}`);
  } catch (error) {
    fail('install_path_missing', 'install', `common 安装路径不存在：${record.installPath}`, { cause: error.code });
  }
  return record;
}

async function readRelease(root, options = {}) {
  let raw;
  try {
    raw = await readFile(join(root, RELEASE_FILE), 'utf8');
  } catch (error) {
    fail('release_missing', 'release', `发布目录缺 ${RELEASE_FILE}：${root}`, { root });
  }
  let release;
  try {
    release = JSON.parse(raw);
  } catch (error) {
    fail('release_invalid', 'release', `${RELEASE_FILE} 不是合法 JSON：${error.message}`, { root });
  }
  if (release?.formatVersion !== 1 || release?.pluginName !== COMMON_PLUGIN_NAME || typeof release?.pluginVersion !== 'string' || !parseVersion(release.pluginVersion) || typeof release?.buildId !== 'string' || typeof release?.commonApiVersion !== 'number' || typeof release?.entries !== 'object' || release.entries === null || !Array.isArray(release?.files)) {
    fail('release_invalid', 'release', `${RELEASE_FILE} 字段不满足发布契约`, { root });
  }
  const expectedApi = options.expectedCommonApiVersion ?? 1;
  if (release.commonApiVersion !== expectedApi) {
    fail('api_incompatible', 'compat', `commonApiVersion 不兼容：发布为 ${release.commonApiVersion}，消费者要求 ${expectedApi}；不回退其他版本`, { root, expectedApi });
  }
  if (options.minimumCommonVersion) {
    const minimum = parseVersion(options.minimumCommonVersion);
    if (!minimum) {
      fail('version_insufficient', 'compat', `消费者声明的 minimumCommonVersion 无法解析：${options.minimumCommonVersion}`);
    }
    if (compareVersion(release.pluginVersion, options.minimumCommonVersion) < 0) {
      fail('version_insufficient', 'compat', `common 版本不足：发布为 ${release.pluginVersion}，消费者要求不低于 ${options.minimumCommonVersion}`, { root, minimumCommonVersion: options.minimumCommonVersion });
    }
  }
  return release;
}

// 锚点优先级：显式 commonRoot（源码调试）> 显式 installedPluginsPath（技能/CLI）>
// ZCODE_PLUGIN_DATA 推导（Hook/MCP 注入）。不假定默认用户目录、不猜测版本目录。
export async function resolveCommonRelease(options = {}) {
  const env = options.env ?? process.env;
  if (options.commonRoot) {
    if (!isAbsolute(options.commonRoot)) {
      fail('common_root_invalid', 'anchor', 'commonRoot 必须是绝对路径');
    }
    return { root: resolve(options.commonRoot), release: await readRelease(resolve(options.commonRoot), options), record: null };
  }
  let registryPath;
  if (options.installedPluginsPath) {
    registryPath = resolve(options.installedPluginsPath);
  } else {
    const dataPath = options.dataPath ?? env.ZCODE_PLUGIN_DATA;
    if (!dataPath || !isAbsolute(dataPath)) {
      fail('anchor_missing', 'anchor', '缺少定位锚点：入口未注入 ZCODE_PLUGIN_DATA，也未显式提供 installedPluginsPath；不假定默认用户目录');
    }
    let storageRoot = resolve(dataPath);
    for (let index = 0; index < DATA_DEPTH; index += 1) storageRoot = dirname(storageRoot);
    registryPath = join(storageRoot, REGISTRY_FILE);
  }
  const registry = await readRegistry(registryPath);
  const record = await findCommonRecord(registry, registryPath);
  const release = await readRelease(record.installPath, options);
  return { root: record.installPath, release, record };
}

let frozen = undefined;

// 首次成功加载即冻结本进程的 common 根；之后注册表变化不热换，升级经新进程生效。
export async function loadCommonModule(entry = 'client', options = {}) {
  if (!frozen) {
    const located = await resolveCommonRelease(options);
    frozen = {
      root: located.root,
      buildId: located.release.buildId,
      pluginVersion: located.release.pluginVersion,
      commonApiVersion: located.release.commonApiVersion,
      entries: located.release.entries,
    };
  }
  const entryPath = frozen.entries[entry];
  if (typeof entryPath !== 'string' || entryPath.length === 0) {
    fail('entry_missing', 'entry', `发布清单没有入口 ${entry}；可用入口：${Object.keys(frozen.entries).join(', ')}`, { root: frozen.root });
  }
  try {
    await stat(join(frozen.root, entryPath));
  } catch (error) {
    fail('entry_missing', 'entry', `入口文件缺失于发布目录：${entryPath}`, { root: frozen.root, cause: error.code });
  }
  const module = await import(pathToFileURL(join(frozen.root, entryPath)).href);
  return { module, root: frozen.root, buildId: frozen.buildId, pluginVersion: frozen.pluginVersion, commonApiVersion: frozen.commonApiVersion };
}

export function frozenCommonRoot() {
  return frozen?.root ?? null;
}
