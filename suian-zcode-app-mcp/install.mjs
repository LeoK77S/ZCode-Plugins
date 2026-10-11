import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkRuntime } from 'suian-zcode-common/prerequisites.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export async function installSkill({ pluginRoot = root, skillFile = join(homedir(), '.zcode', 'skills', 'suian-zcode-app-mcp', 'SKILL.md') } = {}) {
  pluginRoot = resolve(pluginRoot);
  const template = await readFile(join(pluginRoot, 'SKILL.md'), 'utf8');
  const marker = '<!-- suian-zcode-app-mcp:plugin-root -->';
  if (!template.includes(marker)) throw new Error('技能模板缺少插件根锚点');
  const deployed = template.replace(marker, `**本机插件根**：\`${pluginRoot}\``);
  let existing;
  try { existing = await readFile(skillFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing === deployed) return { ok: true, action: 'unchanged', skill_file: skillFile };
  await mkdir(dirname(skillFile), { recursive: true });
  await writeFile(skillFile, deployed);
  return { ok: true, action: 'written', skill_file: skillFile };
}

export async function migrateLegacyRegistration({ pluginRoot, configFile = join(homedir(), '.zcode', 'cli', 'config.json'), skillFile = join(homedir(), '.zcode', 'skills', 'suian-zcode-app-mcp', 'SKILL.md'), runtimeConfigFile }) {
  let config;
  try { config = JSON.parse(await readFile(configFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const expected = resolve(pluginRoot, 'cli.mjs');
  const server = config?.mcp?.servers?.['suian-zcode-app'];
  const scriptIndex = server?.args?.findIndex(arg => resolve(arg).toLowerCase() === expected.toLowerCase());
  const matches = scriptIndex >= 0;
  if (matches) {
    const { values } = parseArgs({
      args: server.args.slice(scriptIndex + 1),
      options: { config: { type: 'string' }, 'index-db': { type: 'string' }, 'session-db': { type: 'string' }, 'gateway-config': { type: 'string' }, 'auth-data-dir': { type: 'string' }, 'save-authorization': { type: 'boolean' } }
    });
    const fields = {};
    for (const [key, flag, env] of [['indexDbPath','--index-db','ZCODE_APP_MCP_INDEX_DB'],['sessionDbPath','--session-db','ZCODE_APP_MCP_SESSION_DB'],['gatewayConfigPath','--gateway-config'],['authDataDir','--auth-data-dir','ZCODE_APP_MCP_AUTH_DATA_DIR']]) {
      const value = values[flag.slice(2)] ?? server.env?.[env];
      if (value !== undefined) fields[key] = value;
    }
    if (Object.keys(fields).length) {
      if (!runtimeConfigFile) throw new Error('旧 MCP 有自定义路径，请用 --config 指定外置配置后迁移');
      let runtime = {};
      try { runtime = JSON.parse(await readFile(runtimeConfigFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await mkdir(dirname(runtimeConfigFile), { recursive: true });
      await writeFile(runtimeConfigFile, JSON.stringify({ ...fields, ...runtime }, null, 2) + '\n');
    }
    delete config.mcp.servers['suian-zcode-app'];
    await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
  }
  let skill;
  try { skill = await readFile(skillFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const owned = skill?.includes(`**本机插件根**：\`${resolve(pluginRoot)}\``);
  if (owned) await unlink(skillFile);
  return { registration: matches ? 'removed' : 'absent', skill: owned ? 'removed' : 'preserved' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'skills-dir': { type: 'string', default: join(homedir(), '.zcode', 'skills') }, 'check-only': { type: 'boolean' }, 'native-plugin': { type: 'boolean' }, 'legacy-root': { type: 'string' }, config: { type: 'string' } } });
  const dependencies = await checkRuntime();
  try { await import('@modelcontextprotocol/sdk/server/mcp.js'); await import('zod'); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('MCP 缺少 npm 依赖；请在 suian-zcode-app-mcp 目录执行 npm ci --ignore-scripts --no-audit --no-fund', { cause: error });
  }
  let result;
  if (values['check-only']) result = { ok: true, action: 'checked' };
  else if (values['native-plugin']) {
    const migration = values['legacy-root'] ? await migrateLegacyRegistration({ pluginRoot: values['legacy-root'], skillFile: join(resolve(values['skills-dir']), 'suian-zcode-app-mcp', 'SKILL.md'), runtimeConfigFile: values.config ? resolve(values.config) : undefined }) : undefined;
    if (values.config) {
      const configFile = resolve(values.config);
      let config = {};
      try { config = JSON.parse(await readFile(configFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await mkdir(dirname(configFile), { recursive: true });
      await writeFile(configFile, JSON.stringify({ authDataDir: join(dirname(configFile), 'auth'), ...config }, null, 2) + '\n');
    }
    result = { ok: true, action: 'plugin_managed', ...(migration ? { migration } : {}) };
  } else result = await installSkill({ skillFile: join(resolve(values['skills-dir']), 'suian-zcode-app-mcp', 'SKILL.md') });
  console.log(JSON.stringify({ ...result, dependencies }));
}
