// PKG-07 契约测试共享夹具：构造最小合法的合成发布目录（release.json + 隐藏插件清单 + 入口 + 许可）。
// 不依赖 node_modules 与 esbuild；测试通过 files/omit/releaseOverrides 注入缺陷，构造失败契约。
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

/**
 * 生成合成发布目录。默认形态是 title 形状；调用方按需覆盖 files 与 pluginName。
 * options：
 * - pluginName / version / packageName / description / dependencies
 * - files：path -> string|Buffer，覆盖同名默认文件或追加
 * - omitDefaults：仅从默认文件集合剔除（不影响 files 覆盖，用于避免跨包默认同内容）
 * - omit：从最终集合剔除路径（制造"缺隐藏清单/资源"缺陷）
 * - releaseOverrides：(release) => release，最后改写 release.json 对象（制造摘要错误、版本错误等）
 */
export async function makeReleaseDir(dir, options = {}) {
  const {
    pluginName = 'suian-zcode-title',
    version = '0.1.5',
    packageName = 'demo-package',
    description = '测试插件',
    dependencies,
    files = {},
    omitDefaults = [],
    omit = [],
    releaseOverrides,
  } = options;
  const manifest = { name: pluginName, version, description };
  if (dependencies) manifest.dependencies = dependencies;
  const defaultFiles = {
    '.zcode-plugin/plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
    LICENSE: 'MIT License (test fixture)\n',
    'dist/cli.mjs': '// demo cli entry\n',
    'skills/setup/SKILL.md': '# setup skill\n',
  };
  for (const path of omitDefaults) delete defaultFiles[path];
  const all = { ...defaultFiles, ...files };
  for (const path of omit) delete all[path];
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  const fileEntries = Object.keys(all).filter(path => path !== 'release.json').sort().map(path => {
    const raw = all[path];
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    return { path, sha256: sha256(buffer), bytes: buffer.length };
  });
  let release = {
    formatVersion: 1,
    pluginName,
    packageName,
    pluginVersion: version,
    buildId: sha256(`${pluginName}@${version}`),
    entries: { cli: 'dist/cli.mjs' },
    files: fileEntries,
  };
  if (releaseOverrides) release = releaseOverrides(structuredClone(release)) ?? release;
  await writeFile(join(dir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  return { dir, release };
}
