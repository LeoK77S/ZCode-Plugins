// 发布契约测试夹具（PKG-03）：构建 common/app-mcp 发布目录并模拟宿主安装记录。
// 仅用 Node 内置模块与子进程 esbuild；staging 位于 tests/.scratch/（已 gitignore）。
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

/** 构建 common 发布目录（PKG-01 产物）。每次真实重建，保证与源码一致。 */
export async function buildCommonRelease(outDir) {
  await run(process.execPath, [join(repoRoot, 'suian-zcode-common', 'build-release.mjs'), '--out', outDir], { windowsHide: true });
  return JSON.parse(await readFile(join(outDir, 'release.json'), 'utf8'));
}

/**
 * 构造隔离宿主存储根：<root>/installed_plugins.json + <root>/data/suian-zcode-app-mcp/。
 * 安装记录按官方 InstalledPluginRecord 构造（adapters/src/plugins/marketplace.ts:137），
 * common 条目 installPath 指向传入的 common 发布目录。
 */
export async function createHostStorage({ root, commonInstallPath, commonVersion, appEnabled = true }) {
  const dataPath = join(root, 'data', 'suian-zcode-app-mcp');
  await mkdir(dataPath, { recursive: true });
  const installedAt = new Date().toISOString();
  const registry = {
    version: 1,
    plugins: [
      {
        id: 'suian-zcode-common@suian-zcode-plugins', name: 'suian-zcode-common', marketplace: 'suian-zcode-plugins',
        version: commonVersion, installPath: commonInstallPath, installedAt, scope: 'user',
      },
      {
        id: 'suian-zcode-app-mcp@suian-zcode-plugins', name: 'suian-zcode-app-mcp', marketplace: 'suian-zcode-plugins',
        version: JSON.parse(await readFile(join(pluginRoot, '.zcode-plugin', 'plugin.json'), 'utf8')).version,
        installPath: join(root, 'plugins', 'suian-zcode-app-mcp'), installedAt, scope: 'user',
        enabled: appEnabled, dependencies: ['suian-zcode-common'],
      },
    ],
  };
  await writeFile(join(root, 'installed_plugins.json'), JSON.stringify(registry, null, 2) + '\n');
  return { root, registryPath: join(root, 'installed_plugins.json'), dataPath };
}

export { pluginRoot, repoRoot };
