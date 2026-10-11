import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, utimes, rm, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installSkill, migrateLegacyRegistration } from '../install.mjs';

async function skillFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'zcode-mcp-skill-'));
  t.after(() => rm(root, { recursive: true }));
  const pluginRoot = join(root, '中文 plugin');
  const skillFile = join(root, 'skills', 'suian-zcode-app-mcp', 'SKILL.md');
  await mkdir(pluginRoot);
  const template = '---\nname: suian-zcode-app-mcp\ndescription: 初始化会话 MCP\n---\n\n<!-- suian-zcode-app-mcp:plugin-root -->\n其他操作指引。\n';
  await writeFile(join(pluginRoot, 'SKILL.md'), template);
  return { root, pluginRoot, skillFile, template };
}

test('部署技能到指定目录，注入插件绝对路径，保留模板和原文', async (t) => {
  const f = await skillFixture(t);
  const result = await installSkill({ pluginRoot: f.pluginRoot, skillFile: f.skillFile });
  assert.equal(result.action, 'written');
  const installed = await readFile(f.skillFile, 'utf8');
  assert.match(installed, /^---\nname: suian-zcode-app-mcp\n/);
  assert.ok(installed.includes(`**本机插件根**：\`${f.pluginRoot}\``));
  assert.ok(installed.includes('其他操作指引。'));
  assert.ok(!installed.includes('<!-- suian-zcode-app-mcp:plugin-root -->'));
  assert.equal(await readFile(join(f.pluginRoot, 'SKILL.md'), 'utf8'), f.template);
});

test('重复部署相同内容不改写，模板更新后同步技能副本', async (t) => {
  const f = await skillFixture(t);
  await installSkill({ pluginRoot: f.pluginRoot, skillFile: f.skillFile });
  const oldTime = new Date('2020-01-01T00:00:00Z');
  await utimes(f.skillFile, oldTime, oldTime);
  const before = (await stat(f.skillFile)).mtimeMs;
  assert.equal((await installSkill({ pluginRoot: f.pluginRoot, skillFile: f.skillFile })).action, 'unchanged');
  assert.equal((await stat(f.skillFile)).mtimeMs, before);
  await writeFile(join(f.pluginRoot, 'SKILL.md'), f.template + '新增初始化指引。\n');
  assert.equal((await installSkill({ pluginRoot: f.pluginRoot, skillFile: f.skillFile })).action, 'written');
  assert.ok((await readFile(f.skillFile, 'utf8')).includes('新增初始化指引。'));
});

test('模板缺少定位锚点时明确失败，保留已安装副本', async (t) => {
  const f = await skillFixture(t);
  await mkdir(dirname(f.skillFile), { recursive: true });
  await writeFile(f.skillFile, '原技能副本');
  await writeFile(join(f.pluginRoot, 'SKILL.md'), '没有插件定位信息的模板');
  await assert.rejects(installSkill({ pluginRoot: f.pluginRoot, skillFile: f.skillFile }), /缺少插件根锚点/);
  assert.equal(await readFile(f.skillFile, 'utf8'), '原技能副本');
});

test('CLI 自行定位仓库根，允许在隔离技能目录安装', async (t) => {
  const f = await skillFixture(t);
  const cli = fileURLToPath(new URL('../install.mjs', import.meta.url));
  const skillsDir = join(f.root, 'CLI skills');
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, '--skills-dir', skillsDir], { windowsHide: true });
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).ok, true);
  const installed = await readFile(join(skillsDir, 'suian-zcode-app-mcp', 'SKILL.md'), 'utf8');
  assert.ok(installed.includes(`**本机插件根**：\`${dirname(cli)}\``));
});

test('CLI Node 版本不足时不部署技能，错误说明所需版本',async t=>{
  const f=await skillFixture(t),cli=fileURLToPath(new URL('../install.mjs',import.meta.url));
  const preload=join(f.root,'old-node.mjs'),skillsDir=join(f.root,'old-node-skills');
  await writeFile(preload,"Object.defineProperty(process.versions,'node',{value:'22.0.0'});");
  await assert.rejects(promisify(execFile)(process.execPath,['--import',pathToFileURL(preload).href,cli,'--skills-dir',skillsDir],{windowsHide:true}),error=>{
    assert.match(error.stderr,/Node.js 24\+/);return true;
  });
  await assert.rejects(stat(skillsDir),{code:'ENOENT'});
});

test('CLI 仅检查不部署技能，MCP 不要求 sqlite3 CLI',async t=>{
  const f=await skillFixture(t),cli=fileURLToPath(new URL('../install.mjs',import.meta.url));
  const skillsDir=join(f.root,'check-only-skills');
  const {stdout}=await promisify(execFile)(process.execPath,[cli,'--skills-dir',skillsDir,'--check-only'],{windowsHide:true,env:{...process.env,SQLITE_BIN:join(f.root,'missing-sqlite3.exe')}});
  assert.equal(JSON.parse(stdout).action,'checked');
  await assert.rejects(stat(skillsDir),{code:'ENOENT'});
});

test('原生初始化由插件加载技能，不另部署全局技能副本',async t=>{
  const f=await skillFixture(t),cli=fileURLToPath(new URL('../install.mjs',import.meta.url)),skillsDir=join(f.root,'native-skills'),configFile=join(f.root,'native-data','config.json');
  const args=[cli,'--native-plugin','--skills-dir',skillsDir,'--config',configFile];
  const {stdout}=await promisify(execFile)(process.execPath,args,{windowsHide:true});
  assert.equal(JSON.parse(stdout).action,'plugin_managed');
  await assert.rejects(stat(skillsDir),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(configFile,'utf8')).authDataDir,join(dirname(configFile),'auth'));
  await writeFile(configFile,'{"indexDbPath":"D:/custom/index.sqlite"}');
  await promisify(execFile)(process.execPath,args,{windowsHide:true});
  assert.equal(JSON.parse(await readFile(configFile,'utf8')).indexDbPath,'D:/custom/index.sqlite');
});

test('原生迁移仅移除指定旧根的 MCP 注册与自有技能，保留其他设置',async t=>{
  const f=await skillFixture(t),configFile=join(f.root,'user-config.json'),runtimeConfigFile=join(f.root,'runtime.json');
  const before={hooks:{enabled:true},mcp:{servers:{'suian-zcode-app':{command:'node',args:[join(f.pluginRoot,'cli.mjs'),'--index-db','D:/legacy/index.sqlite'],env:{ZCODE_APP_MCP_SESSION_DB:'D:/legacy/session.sqlite'}},other:{command:'keep'}}}};
  await writeFile(configFile,JSON.stringify(before));
  await writeFile(runtimeConfigFile,'{"sessionDbPath":"D:/native/session.sqlite"}');
  await installSkill({pluginRoot:f.pluginRoot,skillFile:f.skillFile});
  await migrateLegacyRegistration({pluginRoot:f.pluginRoot,configFile,skillFile:f.skillFile,runtimeConfigFile});
  const after=JSON.parse(await readFile(configFile,'utf8'));
  assert.equal(after.mcp.servers['suian-zcode-app'],undefined);
  assert.deepEqual(after.mcp.servers.other,before.mcp.servers.other);
  assert.deepEqual(after.hooks,before.hooks);
  const runtime=JSON.parse(await readFile(runtimeConfigFile,'utf8'));
  assert.equal(runtime.indexDbPath,'D:/legacy/index.sqlite');
  assert.equal(runtime.sessionDbPath,'D:/native/session.sqlite');
  await assert.rejects(stat(f.skillFile),{code:'ENOENT'});
  await writeFile(configFile,'{invalid');
  await assert.rejects(migrateLegacyRegistration({pluginRoot:f.pluginRoot,configFile,skillFile:f.skillFile}),SyntaxError);
});

test('原生迁移保留旧 CLI 等号形式的自定义路径和参数优先级',async t=>{
  const f=await skillFixture(t),configFile=join(f.root,'user-config.json'),runtimeConfigFile=join(f.root,'runtime.json');
  await writeFile(configFile,JSON.stringify({mcp:{servers:{'suian-zcode-app':{
    command:'node',args:[join(f.pluginRoot,'cli.mjs'),'--index-db','D:/first/index.sqlite','--index-db=D:/custom/index.sqlite','--session-db=D:/中文 目录/session.sqlite','--gateway-config=D:/custom/gateway.json','--auth-data-dir=D:/custom/auth'],
    env:{ZCODE_APP_MCP_INDEX_DB:'D:/env/index.sqlite'}
  }}}}));
  await migrateLegacyRegistration({pluginRoot:f.pluginRoot,configFile,skillFile:f.skillFile,runtimeConfigFile});
  assert.deepEqual(JSON.parse(await readFile(runtimeConfigFile,'utf8')),{
    indexDbPath:'D:/custom/index.sqlite',sessionDbPath:'D:/中文 目录/session.sqlite',gatewayConfigPath:'D:/custom/gateway.json',authDataDir:'D:/custom/auth'
  });
  assert.equal(JSON.parse(await readFile(configFile,'utf8')).mcp.servers['suian-zcode-app'],undefined);
});

test('CLI MCP 依赖缺失时先报 npm ci，保留已有技能',async t=>{
  const f=await skillFixture(t),common=join(f.root,'suian-zcode-common'),plugin=join(f.root,'suian-zcode-app-mcp');
  await mkdir(join(common,'node_modules','ws'),{recursive:true});
  await mkdir(plugin);
  await mkdir(join(plugin,'node_modules'));
  await symlink(common,join(plugin,'node_modules','suian-zcode-common'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(common,'node_modules','ws','package.json'),'{"type":"module","exports":"./index.mjs"}');
  await writeFile(join(common,'node_modules','ws','index.mjs'),'export default class WebSocket {}');
  for(const name of ['windows.mjs','prerequisites.mjs'])await copyFile(new URL('../../suian-zcode-common/'+name,import.meta.url),join(common,name));
  const cli=join(plugin,'install.mjs');
  await copyFile(new URL('../install.mjs',import.meta.url),cli);
  await mkdir(dirname(f.skillFile),{recursive:true});
  await writeFile(f.skillFile,'既有副本');
  await assert.rejects(promisify(execFile)(process.execPath,[cli,'--skills-dir',join(f.root,'skills')],{windowsHide:true}),error=>{
    assert.match(error.stderr,/MCP 缺少 npm 依赖/);assert.match(error.stderr,/npm ci/);return true;
  });
  assert.equal(await readFile(f.skillFile,'utf8'),'既有副本');
});
