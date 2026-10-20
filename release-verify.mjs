// PKG-07：发布目录（组装产物）契约校验。核对插件身份与版本、隐藏插件清单、
// 入口与必备资源、禁止内容（node_modules/测试/文档/锁文件）、敏感文件与敏感内容
// （本机路径、凭据模式）、release.json 文件摘要，以及"common 实现不得重复内联进业务包"。
// 校验聚合返回 problems（不中途抛出），code 稳定供契约测试与门禁引用。
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const toPosix = path => path.split('\\').join('/');

async function collectFiles(dir, base = dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await collectFiles(path, base));
    else if (entry.isFile()) found.push({ path: toPosix(path.slice(base.length + 1)), full: path });
  }
  return found;
}

export const PLUGIN_PROFILES = {
  'suian-zcode-common': {
    requiredFiles: [
      '.zcode-plugin/plugin.json', 'LICENSE',
      'dist/client.mjs', 'dist/client-install.mjs', 'toast-executor.mjs',
      'vendor/LICENSE-ZCode', 'vendor/NOTICE-ZCode-current.md', 'vendor/LICENSE-zod',
      'vendor/NOTICE.md', 'vendor/conversation-wire.sources.json',
      'licenses/ws-LICENSE',
    ],
    requiredDirs: [],
    // 已知差异：规格第 6 节要求 common 发布包含 skills；PKG-01 现实现未复制 skills，
    // 内容随 08 票 setup 同步改造，此处不擅自放宽也不额外要求（见发布 runbook 遗留问题）。
  },
  'suian-zcode-title': {
    requiredFiles: [
      '.zcode-plugin/plugin.json', 'LICENSE',
      'dist/cli.mjs', 'dist/hook.mjs', 'dist/install.mjs', 'dist/toast-action.mjs',
      'prompt.md', 'SKILL.md', 'hooks/hooks.json',
    ],
    requiredDirs: ['skills'],
  },
  'suian-zcode-app-mcp': {
    requiredFiles: [
      '.zcode-plugin/plugin.json', 'LICENSE', 'SKILL.md',
      '.mcp.json', 'hooks/hooks.json', 'vendor/NOTICE.md',
      'dist/cli.mjs', 'dist/artifact-hook.mjs', 'dist/install.mjs',
    ],
    requiredDirs: ['skills', 'dist/ui', 'licenses'],
  },
  'suian-side-editor': {
    requiredFiles: [
      '.zcode-plugin/plugin.json', 'LICENSE',
      'cli.mjs', 'common-client.mjs', 'locate.mjs', 'ui/dist/editor.html', '.mcp.json',
    ],
    requiredDirs: ['skills'],
  },
};

const FORBIDDEN_SEGMENTS = new Set(['node_modules', 'tests', 'docs', '.git', '.scratch', 'experiments', '.local']);
const FORBIDDEN_FILENAMES = new Set(['package.json', 'package-lock.json', 'config.local.json']);
const SENSITIVE_SEGMENTS = new Set(['run-data', 'userdata', 'secrets', '.env']);
const SENSITIVE_FILE_PATTERNS = [/\.(log|pem|key|p12|pfx|kdbx)$/i, /^\.env/i, /credential/i, /secret/i, /token/i, /^auth\.json$/i];
const SENSITIVE_CONTENT_PATTERNS = [
  /C:\\Users\\/i,
  /C:\/Users\//i,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];
const TEXT_SUFFIXES = new Set(['.mjs', '.cjs', '.js', '.json', '.md', '.html', '.htm', '.txt', '.ps1', '.vbs', '.css', '.example.json', '.sources.json']);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
// 允许与 common 逐字节一致的文件（PKG-01/04 契约：薄定位器单一源码；许可文本各包同源）。
const COMMON_INLINE_PATH_ALLOWLIST = new Set(['locate.mjs', 'LICENSE']);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function dirHasFiles(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some(entry => entry.isFile())) return true;
    return entries.some(entry => entry.isDirectory()) && (await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => dirHasFiles(join(path, entry.name))))).some(Boolean);
  } catch {
    return false;
  }
}

function classifySensitive(path) {
  const segments = path.split('/');
  if (segments.some(segment => SENSITIVE_SEGMENTS.has(segment))) return true;
  const name = segments.at(-1);
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * 校验组装产物目录。options：
 * - releaseDir：待校验目录
 * - pluginName：期望插件名
 * - expectedVersion：市场/候选期望版本（与 plugin.json、release.json 三方一致）
 * - commonReleaseDir：提供时执行"公共实现不重复内联"检测
 * - sensitiveRoots：额外按子串拒绝的本机路径（仓库根、用户目录、临时目录等）
 * 返回 { ok, problems: [{code, path, message}] }。
 */
export async function verifyReleaseDir({ releaseDir, pluginName, expectedVersion, commonReleaseDir, sensitiveRoots = [] }) {
  const problems = [];
  const add = (code, path, message) => problems.push({ code, path, message });

  const profile = PLUGIN_PROFILES[pluginName];
  if (!profile) add('unknown_plugin', pluginName, `缺少插件允许清单 profile：${pluginName}`);

  let release = null;
  try {
    release = await readJson(join(releaseDir, 'release.json'));
  } catch {
    add('release_missing', 'release.json', '发布目录缺少可解析的 release.json');
  }
  if (release && release.pluginName !== pluginName) {
    add('release_identity', 'release.json', `release.json 身份不符：${release.pluginName} != ${pluginName}`);
  }

  let manifest = null;
  try {
    manifest = await readJson(join(releaseDir, '.zcode-plugin', 'plugin.json'));
  } catch {
    add('manifest_missing', '.zcode-plugin/plugin.json', '缺少隐藏插件清单 .zcode-plugin/plugin.json');
  }
  if (manifest) {
    if (manifest.name !== pluginName) add('manifest_identity', '.zcode-plugin/plugin.json', `插件清单身份不符：${manifest.name} != ${pluginName}`);
    if (expectedVersion && manifest.version !== expectedVersion) {
      add('version_mismatch', '.zcode-plugin/plugin.json', `插件清单版本 ${manifest.version} != 期望 ${expectedVersion}`);
    }
  }
  if (release && manifest && release.pluginVersion !== manifest.version) {
    add('version_mismatch', 'release.json', `release.json 版本 ${release.pluginVersion} != 插件清单 ${manifest.version}`);
  }

  const files = await collectFiles(releaseDir);
  const paths = new Set(files.map(file => file.path));

  if (release && typeof release.entries === 'object' && release.entries) {
    for (const [key, entryPath] of Object.entries(release.entries)) {
      if (!paths.has(entryPath)) add('entry_missing', entryPath, `release.json 入口 ${key} 指向的文件不存在`);
    }
  }
  if (profile) {
    for (const required of profile.requiredFiles) {
      if (!paths.has(required)) add('resource_missing', required, `缺少必备文件 ${required}`);
    }
    for (const required of profile.requiredDirs) {
      if (!(await dirHasFiles(join(releaseDir, ...required.split('/'))))) add('resource_missing', required, `必备资源目录 ${required} 缺失或为空`);
    }
  }

  const digestByPath = new Map();
  for (const file of files) {
    const { path, full } = file;
    digestByPath.set(path, null); // 摘要惰性计算并缓存
    const segments = path.split('/');
    if (segments.some(segment => FORBIDDEN_SEGMENTS.has(segment))) {
      add('forbidden_present', path, `发布目录不得包含 ${path}`);
    }
    if (FORBIDDEN_FILENAMES.has(segments.at(-1))) {
      add('forbidden_present', path, `发布目录不得携带开发/锁文件 ${path}`);
    }
    if (classifySensitive(path)) {
      add('sensitive_file', path, `疑似敏感文件混入：${path}`);
    }
  }

  // release.json 文件清单与实际内容逐项核对。
  if (release && Array.isArray(release.files)) {
    const listed = new Map(release.files.map(file => [file.path, file.sha256]));
    for (const listedFile of release.files) {
      const actual = files.find(file => file.path === listedFile.path);
      if (!actual) {
        add('digest_mismatch', listedFile.path, `清单中的文件不存在：${listedFile.path}`);
        continue;
      }
      const digest = await fileSha256(actual, digestByPath);
      if (digest !== listedFile.sha256) add('digest_mismatch', listedFile.path, `摘要不符：清单 ${listedFile.sha256} != 实际 ${digest}`);
    }
    for (const file of files) {
      if (file.path === 'release.json') continue;
      if (!listed.has(file.path)) add('unlisted_file', file.path, `实际文件未列入 release.json 清单：${file.path}`);
    }
  }

  // 敏感内容：文本文件扫描本机路径与凭据模式。
  const rootLiterals = sensitiveRoots.map(root => toPosix(String(root))).filter(root => root.length > 4);
  for (const file of files) {
    const suffix = file.path.slice(file.path.lastIndexOf('.'));
    if (!TEXT_SUFFIXES.has(suffix) && !file.path.endsWith('.example.json')) continue;
    const content = await readFile(file.full).catch(() => null);
    if (!content || content.length > MAX_SCAN_BYTES) continue;
    const text = toPosix(content.toString('utf8'));
    for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
      if (pattern.test(text)) {
        add('sensitive_content', file.path, `文本内容命中敏感模式 ${pattern}`);
        break;
      }
    }
    if (problems.some(problem => problem.code === 'sensitive_content' && problem.path === file.path)) continue;
    for (const literal of rootLiterals) {
      if (text.includes(literal)) {
        add('sensitive_content', file.path, `文本内容泄漏本机路径片段：${literal.slice(0, 12)}…`);
        break;
      }
    }
  }

  // 公共实现不重复内联：业务目录不得携带 common 实现文件的逐字节副本（白名单除外）。
  if (commonReleaseDir && pluginName !== 'suian-zcode-common') {
    let commonRelease = null;
    try {
      commonRelease = await readJson(join(commonReleaseDir, 'release.json'));
    } catch {
      add('common_release_missing', 'release.json', 'common 发布目录缺少 release.json，无法执行公共内联检测');
    }
    if (commonRelease && Array.isArray(commonRelease.files)) {
      // 内联判定以"内容逐字节副本"为准：摘要命中即视为把 common 实现搬进了业务包；
      // 仅路径同名而内容不同不属于内联（业务自有文件恰与公共文件同名）。
      const commonImplementations = commonRelease.files
        .filter(file => !COMMON_INLINE_PATH_ALLOWLIST.has(file.path) && file.path !== '.zcode-plugin/plugin.json')
        .map(file => ({ path: file.path, sha256: file.sha256 }));
      const commonDigests = new Set(commonImplementations.map(item => item.sha256));
      for (const file of files) {
        if (COMMON_INLINE_PATH_ALLOWLIST.has(file.path)) continue;
        if (commonDigests.has(await fileSha256(file, digestByPath))) {
          add('common_inline', file.path, `业务发布目录内联了 common 实现文件（内容逐字节副本）：${file.path}`);
        }
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

async function fileSha256(file, cache) {
  if (!cache.has(file.path) || cache.get(file.path) === null) {
    cache.set(file.path, sha256(await readFile(file.full)));
  }
  return cache.get(file.path);
}

export { collectFiles };
