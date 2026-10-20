import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const linkType = () => (process.platform === 'win32' ? 'junction' : 'dir');
const sha256 = data => createHash('sha256').update(data).digest('hex');

// 构造发布形态插件目录（PKG-08 起 depcheck 的正判对象）：release.json 逐文件清单、
// dist 入口与资源全部落盘，不含 node_modules，也不依赖任何目录链接。
// release.json 自身不入清单（与 build-release.mjs 的发布契约一致）。
export async function writeReleaseDirectory(dir, spec) {
  const { name, version, deps = [], commonApiVersion, expectedCommonApiVersion, minimumCommonVersion, entries = {}, paths = [] } = spec;
  const materialized = paths.map(path => ({ path, content: `${path} of ${name}@${version}\n` }));
  for (const file of materialized) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.content);
  }
  await mkdir(join(dir, '.zcode-plugin'), { recursive: true });
  const pluginJson = JSON.stringify({ name, version, ...(deps.length ? { dependencies: deps } : {}) });
  await writeFile(join(dir, '.zcode-plugin', 'plugin.json'), pluginJson);
  const files = [
    { path: '.zcode-plugin/plugin.json', sha256: sha256(pluginJson), bytes: pluginJson.length },
    ...materialized.map(file => ({ path: file.path, sha256: sha256(file.content), bytes: file.content.length })),
  ];
  const release = {
    formatVersion: 1,
    pluginName: name,
    packageName: name,
    pluginVersion: version,
    buildId: sha256(`${name}@${version}`),
    ...(commonApiVersion !== undefined ? { commonApiVersion } : {}),
    ...(expectedCommonApiVersion !== undefined ? { expectedCommonApiVersion } : {}),
    ...(minimumCommonVersion !== undefined ? { minimumCommonVersion } : {}),
    entries,
    files,
  };
  const releaseJson = JSON.stringify(release, null, 2);
  await writeFile(join(dir, 'release.json'), releaseJson);
  return { dir, release };
}

// 发布形态世界：四个 suian 插件均为发布目录（无 node_modules、无 runtime junction）+ 非 suian 对照条目。
// title 的兼容声明用 commonApiVersion、app-mcp/side-editor 用 expectedCommonApiVersion，
// 与各自 build-release.mjs 实际写出的字段一致；depcheck 两种字段都要接受。
export async function buildReleaseWorld(t) {
  const root = await mkdtemp(join(tmpdir(), 'suian-depcheck-rel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = join(root, 'home');
  const cacheDir = join(homeDir, '.zcode', 'cli', 'plugins', 'cache', 'suian-zcode-plugins');
  const specs = [
    {
      name: 'suian-zcode-common', version: '0.5.0', deps: [], commonApiVersion: 1,
      entries: { client: 'dist/client.mjs', 'client-install': 'dist/client-install.mjs' },
      paths: ['dist/client.mjs', 'dist/client-install.mjs', 'toast-executor.mjs', 'vendor/NOTICE.md', 'licenses/ws-LICENSE', 'LICENSE'],
    },
    {
      name: 'suian-zcode-title', version: '0.1.6', deps: ['suian-zcode-common'], commonApiVersion: 1, minimumCommonVersion: '0.5.0',
      entries: { cli: 'dist/cli.mjs', hook: 'dist/hook.mjs', install: 'dist/install.mjs', 'toast-action': 'dist/toast-action.mjs' },
      paths: ['dist/cli.mjs', 'dist/hook.mjs', 'dist/install.mjs', 'dist/toast-action.mjs', 'skills/setup/SKILL.md', 'skills/configuration/SKILL.md', 'prompt.md', 'LICENSE'],
    },
    {
      name: 'suian-zcode-app-mcp', version: '0.11.0', deps: ['suian-zcode-common'], expectedCommonApiVersion: 1, minimumCommonVersion: '0.5.0',
      entries: { cli: 'dist/cli.mjs', 'artifact-hook': 'dist/artifact-hook.mjs', install: 'dist/install.mjs' },
      paths: ['dist/cli.mjs', 'dist/artifact-hook.mjs', 'dist/install.mjs', 'dist/ui/panel.html', 'skills/setup/SKILL.md', 'mcp.config.example.json', 'LICENSE'],
    },
    {
      name: 'suian-side-editor', version: '0.3.0', deps: ['suian-zcode-common'], expectedCommonApiVersion: 1, minimumCommonVersion: '0.5.0',
      entries: { cli: 'dist/cli.mjs' },
      paths: ['dist/cli.mjs', 'dist/editor.html', 'skills/setup/SKILL.md', 'LICENSE'],
    },
  ];
  const installPaths = {};
  for (const spec of specs) installPaths[spec.name] = join(cacheDir, spec.name, spec.version);
  await writeReleaseDirectory(installPaths['suian-zcode-common'], specs[0]);
  await writeReleaseDirectory(installPaths['suian-zcode-title'], specs[1]);
  await writeReleaseDirectory(installPaths['suian-zcode-app-mcp'], specs[2]);
  await writeReleaseDirectory(installPaths['suian-side-editor'], specs[3]);
  const pluginsFile = join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  await mkdir(dirname(pluginsFile), { recursive: true });
  await writeFile(pluginsFile, JSON.stringify({ version: 1, plugins: [
    ...specs.map(spec => ({ id: `${spec.name}@suian-zcode-plugins`, name: spec.name, version: spec.version, installPath: installPaths[spec.name], scope: 'user', ...(spec.deps.length ? { dependencies: spec.deps } : {}) })),
    { id: 'exa@claude-plugins-official', name: 'exa', version: '3.4.1', installPath: join(root, 'nonexistent-exa'), scope: 'user' },
  ] }));
  return { root, homeDir, pluginsFile, installPaths, specs };
}

// 旧形态世界（npm + 两级 junction）：仅供迁移与链接清理契约使用，
// 新 depcheck 不再把该形态判定为损坏（迁移遗留不等于安装损坏）。
export async function buildLegacyWorld(t) {
  const root = await mkdtemp(join(tmpdir(), 'suian-depcheck-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = join(root, 'home');
  const cacheDir = join(homeDir, '.zcode', 'cli', 'plugins', 'cache', 'suian-zcode-plugins');
  const defs = [
    { name: 'suian-zcode-common', version: '0.2.0', npmDeps: { ws: '8.22.0' }, pluginDeps: [] },
    { name: 'suian-zcode-title', version: '0.1.1', npmDeps: {}, pluginDeps: ['suian-zcode-common'] },
    { name: 'suian-zcode-app-mcp', version: '0.4.2', npmDeps: { '@modelcontextprotocol/sdk': '1.32.1', zod: '4.6.5' }, pluginDeps: ['suian-zcode-common'] },
    { name: 'suian-side-editor', version: '0.2.0', npmDeps: { '@modelcontextprotocol/sdk': '1.32.1', zod: '4.6.5' }, pluginDeps: ['suian-zcode-common'] },
  ];
  const installPaths = {};
  for (const def of defs) {
    const dir = join(cacheDir, def.name, def.version);
    installPaths[def.name] = dir;
    await mkdir(join(dir, '.zcode-plugin'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: def.name, dependencies: def.npmDeps }));
    await writeFile(join(dir, '.zcode-plugin', 'plugin.json'), JSON.stringify({ name: def.name, version: def.version, dependencies: def.pluginDeps }));
    for (const pkg of Object.keys(def.npmDeps)) await mkdir(join(dir, 'node_modules', pkg), { recursive: true });
  }
  const runtimeRoot = join(homeDir, '.zcode', 'tools', 'suian-zcode-common', 'runtime');
  await mkdir(dirname(runtimeRoot), { recursive: true });
  await symlink(installPaths['suian-zcode-common'], runtimeRoot, linkType());
  for (const def of defs.filter(d => d.pluginDeps.includes('suian-zcode-common'))) {
    await mkdir(join(installPaths[def.name], 'node_modules'), { recursive: true });
    await symlink(runtimeRoot, join(installPaths[def.name], 'node_modules', 'suian-zcode-common'), linkType());
  }
  const pluginsFile = join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  await mkdir(dirname(pluginsFile), { recursive: true });
  await writeFile(pluginsFile, JSON.stringify({ version: 1, plugins: [
    ...defs.map(d => ({ id: `${d.name}@suian-zcode-plugins`, name: d.name, version: d.version, installPath: installPaths[d.name], scope: 'user', ...(d.pluginDeps.length ? { dependencies: d.pluginDeps } : {}) })),
  ] }));
  return { root, homeDir, pluginsFile, runtimeRoot, installPaths, defs };
}

// 兼容旧引用名：原有测试与文档使用的 buildWorld 即旧形态世界。
export async function buildWorld(t) {
  return buildLegacyWorld(t);
}
