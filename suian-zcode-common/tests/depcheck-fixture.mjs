import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const linkType = () => (process.platform === 'win32' ? 'junction' : 'dir');

// 构造与真实宿主缓存同构的最小世界：installed_plugins.json + 四个 suian 插件缓存
// （npm 依赖为真实目录、公共包链为两级 junction）+ 一个非 suian 插件对照条目。
export async function buildWorld(t) {
  const root = await mkdtemp(join(tmpdir(), 'suian-depcheck-'));
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
    { id: 'exa@claude-plugins-official', name: 'exa', version: '3.4.1', installPath: join(root, 'nonexistent-exa'), scope: 'user' },
  ] }));
  return { root, homeDir, pluginsFile, runtimeRoot, installPaths, defs };
}
