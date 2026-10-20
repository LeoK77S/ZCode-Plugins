// PKG-07：根 marketplace.json 的候选生成 / 校验 / 版本统一检查 / 回退候选。
// 候选只修改受影响条目（未变插件逐字段保留原状）；版本统一检查只报告不一致，
// 不代选版本、不修改任何文件；根 marketplace.json 本身是手工维护的单一数据源，
// 本模块输出候选供人工核对采纳，不整体重写正式清单。
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const GITHUB_ASSET_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SENSITIVE_SOURCE_KEYS = new Set(['token', 'privateToken', 'authToken', 'authorization']);
const COMMON_PLUGIN = 'suian-zcode-common';

/**
 * 校验单个市场条目的官方 ZIP 来源形状。
 * codes：source_shape / url_not_https / url_not_fixed / sha256_invalid / strip_root /
 * headers_present / token_present / dependency_missing / dependency_invalid / version_invalid。
 * options.allowLoopback：本地 fixture 允许 loopback HTTP（官方 zip-source 规范语义）。
 */
export function validateMarketplaceEntry(entry, options = {}) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  if (!entry || typeof entry !== 'object') return { ok: false, problems: [{ code: 'source_shape', message: '条目不是对象' }] };
  if (!/^\d+\.\d+\.\d+/.test(String(entry.version ?? ''))) add('version_invalid', `版本不合法：${entry.version}`);
  for (const key of Object.keys(entry)) {
    if (SENSITIVE_SOURCE_KEYS.has(key)) add('token_present', `条目顶层不得携带私有 token 字段：${key}`);
  }
  const source = entry.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { ok: false, problems: [...problems, { code: 'source_shape', message: 'source 必须是对象' }] };
  }
  if (source.source !== 'url' || source.type !== 'zip' || typeof source.url !== 'string' || typeof source.sha256 !== 'string') {
    add('source_shape', 'source 必须为 {source:"url", type:"zip", url, sha256}');
  }
  for (const key of Object.keys(source)) {
    if (SENSITIVE_SOURCE_KEYS.has(key)) add('token_present', `source 不得携带私有 token 字段：${key}`);
  }
  if (source.headers !== undefined) add('headers_present', '公开 ZIP 不支持 headers（敏感 header 不得进入市场）');
  if (source.stripRoot !== false) add('strip_root', 'stripRoot 必须显式为 false');

  let parsed = null;
  try {
    parsed = new URL(source.url ?? '');
  } catch {
    add('url_not_https', `URL 无法解析：${source.url}`);
  }
  if (parsed) {
    const isLoopback = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
    const isHttps = parsed.protocol === 'https:';
    if (!isHttps && !(options.allowLoopback && isLoopback)) {
      add('url_not_https', `远端资产必须 HTTPS（本地 fixture 仅允许 loopback）：${parsed.protocol}//${parsed.hostname}`);
    }
    if (/\/releases\/latest\/|\/latest\/download\//.test(parsed.pathname)) {
      add('url_not_fixed', '不得使用 latest 或临时重定向 URL');
    } else if (isHttps && !options.allowLoopback) {
      const match = GITHUB_ASSET_URL.exec(source.url);
      if (!match) {
        add('url_not_fixed', `必须使用 GitHub Release 固定下载 URL（/releases/download/<tag>/<file>）：${source.url}`);
      } else {
        const [, , , tag, file] = match;
        if (!tag || tag.toLowerCase() === 'latest') add('url_not_fixed', 'URL 必须携带明确 Release tag');
        if (!file.endsWith('.zip')) add('url_not_fixed', '资产必须是 .zip');
        if (entry.version && !file.includes(entry.version)) add('url_not_fixed', `资产文件名必须包含插件版本 ${entry.version}：${file}`);
      }
    }
  }
  if (typeof source.sha256 === 'string' && !/^[0-9a-f]{64}$/.test(source.sha256)) {
    add('sha256_invalid', 'sha256 必须是 64 位小写 hex');
  }
  if (entry.name === COMMON_PLUGIN) {
    if (entry.dependencies && entry.dependencies.length) add('dependency_invalid', 'common 自身不得声明业务依赖');
  } else if (!Array.isArray(entry.dependencies) || !entry.dependencies.includes(COMMON_PLUGIN)) {
    add('dependency_missing', `业务条目必须保留依赖 ${COMMON_PLUGIN}`);
  }
  return { ok: problems.length === 0, problems };
}

/** 只更新受影响条目为 ZIP 来源；未变条目逐字段保留。未知插件名直接报错。 */
export function generateMarketplaceCandidate({ current, updates, baseUrl, releaseTag }) {
  if (!current || !Array.isArray(current.plugins)) throw new Error('当前市场清单缺少 plugins 数组');
  const byName = new Map(current.plugins.map(plugin => [plugin.name, plugin]));
  const candidates = [];
  for (const update of updates) {
    const existing = byName.get(update.name);
    if (!existing) throw new Error(`更新目标不在市场清单中：${update.name}`);
    const source = {
      source: 'url',
      type: 'zip',
      url: `${String(baseUrl).replace(/\/$/, '')}/${releaseTag}/${update.fileName}`,
      sha256: update.zipSha256,
      stripRoot: false,
    };
    const candidate = {
      ...structuredClone(existing),
      version: update.version,
      source,
    };
    const check = validateMarketplaceEntry(candidate);
    if (!check.ok) throw new Error(`生成的候选条目未通过形状校验（${update.name}）：${JSON.stringify(check.problems)}`);
    candidates.push(update.name);
  }
  return {
    ...structuredClone(current),
    plugins: current.plugins.map(plugin => {
      if (!candidates.includes(plugin.name)) return structuredClone(plugin);
      const update = updates.find(item => item.name === plugin.name);
      return {
        ...structuredClone(plugin),
        version: update.version,
        source: {
          source: 'url', type: 'zip',
          url: `${String(baseUrl).replace(/\/$/, '')}/${releaseTag}/${update.fileName}`,
          sha256: update.zipSha256, stripRoot: false,
        },
      };
    }),
  };
}

/** 回退候选：指定插件回退到 previous 中已发布的旧条目（旧 URL/旧摘要逐字段保留）。 */
export function generateRollbackCandidate({ current, previous, names }) {
  if (!current || !previous) throw new Error('回退候选需要当前与历史两份市场清单');
  const previousByName = new Map(previous.plugins.map(plugin => [plugin.name, plugin]));
  return {
    ...structuredClone(current),
    plugins: current.plugins.map(plugin => {
      if (!names.includes(plugin.name)) return structuredClone(plugin);
      const old = previousByName.get(plugin.name);
      if (!old) throw new Error(`历史市场清单中没有 ${plugin.name} 的已发布条目，无法回退`);
      return structuredClone(old);
    }),
  };
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 版本统一检查：插件清单 version 为基准，核对已有 package.json / package-lock 根版本、
 * release.json（自报）与市场条目 version。只报告不一致，不修改任何文件，不代选版本。
 * pluginRoots：{插件名: 相对 repoRoot 的目录}；stagedVersions：构建产物自报版本（可选）。
 */
export async function checkVersionConsistency({ repoRoot, pluginRoots, marketplace, stagedVersions = {} }) {
  const mismatches = [];
  const checked = [];
  const marketByName = new Map((marketplace?.plugins ?? []).map(plugin => [plugin.name, plugin]));
  for (const [pluginName, relativeRoot] of Object.entries(pluginRoots)) {
    const root = join(repoRoot, relativeRoot);
    const manifest = await readJsonIfPresent(join(root, '.zcode-plugin', 'plugin.json'));
    const expected = manifest?.version ?? null;
    if (!expected) {
      mismatches.push({ plugin: pluginName, field: '.zcode-plugin/plugin.json', expected: null, actual: null });
      continue;
    }
    const sources = [
      ['package.json', (await readJsonIfPresent(join(root, 'package.json')))?.version ?? null],
      ['package-lock.json', (await readJsonIfPresent(join(root, 'package-lock.json')))?.packages?.['']?.version ?? null],
      ['release.json', stagedVersions[pluginName] ?? (await readJsonIfPresent(join(root, 'release.json')))?.pluginVersion ?? null],
      ['marketplace', marketByName.get(pluginName)?.version ?? null],
    ];
    for (const [field, actual] of sources) {
      if (actual === null) continue; // 无该字段（如 package.json 未声明 version）不视为不一致
      if (actual !== expected) mismatches.push({ plugin: pluginName, field, expected, actual });
    }
    checked.push(pluginName);
  }
  return { ok: mismatches.length === 0, mismatches, checked };
}

export { readJsonIfPresent };
