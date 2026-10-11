import { lstat, readlink, symlink, unlink, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, toNamespacedPath } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

async function ensureLink(path, target) {
  let existing;
  try { existing = await lstat(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isSymbolicLink()) throw new Error(`公共包入口不是链接，拒绝覆盖：${path}`);
    if (toNamespacedPath(resolve(await readlink(path))) === toNamespacedPath(target)) return { path, action: 'unchanged' };
    await unlink(path);
  }
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
  return { path, action: 'linked' };
}

export async function linkCommon({ commonRoot, runtimeRoot = join(homedir(), '.zcode', 'tools', 'suian-zcode-common', 'runtime'), pluginRoots = [] }) {
  commonRoot = resolve(commonRoot); runtimeRoot = resolve(runtimeRoot);
  const pkg = JSON.parse(await readFile(join(commonRoot, 'package.json'), 'utf8'));
  if (pkg.name !== 'suian-zcode-common') throw new Error('公共包目录不属于 suian-zcode-common');
  const actions = [await ensureLink(runtimeRoot, commonRoot)];
  for (const pluginRoot of pluginRoots) {
    actions.push(await ensureLink(join(resolve(pluginRoot), 'node_modules', 'suian-zcode-common'), runtimeRoot));
  }
  return { ok: true, commonRoot, runtimeRoot, actions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'plugin-root': { type: 'string', multiple: true }, 'runtime-root': { type: 'string' } } });
  const result = await linkCommon({ commonRoot: dirname(fileURLToPath(import.meta.url)), runtimeRoot: values['runtime-root'], pluginRoots: values['plugin-root'] });
  console.log(JSON.stringify(result));
}
