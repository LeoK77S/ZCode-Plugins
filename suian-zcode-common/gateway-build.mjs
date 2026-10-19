import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = await realpath(dirname(fileURLToPath(import.meta.url)));
// 网关的固定执行依赖与启动链；文档、技能及其它插件代码不参与。
const files = [
  'gateway-build.mjs', 'gateway.mjs', 'rpc-broker.mjs', 'terminal-gateway.mjs', 'terminal-relay.mjs',
  'run.ps1', 'run.vbs', '.zcode-plugin/plugin.json',
  'vendor/remote-shared.js', 'vendor/channelClient.js', 'vendor/serialization.js',
  'vendor/buffer.js', 'vendor/foundation.js', 'vendor/channels.shared.js',
  'node_modules/ws/package.json', 'node_modules/ws/index.js', 'node_modules/ws/wrapper.mjs',
  ...(await readdir(join(root, 'node_modules/ws/lib'))).filter(file => file.endsWith('.js')).map(file => 'node_modules/ws/lib/' + file),
].sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update('\0').update(await readFile(join(root, file))).update('\0');
// 在模块首次加载时锁定；/health 不重新读取磁盘，避免旧进程冒报新代码。
export const gatewayBuild = Object.freeze({
  id: hash.digest('hex'), root,
  version: JSON.parse(await readFile(join(root, '.zcode-plugin/plugin.json'), 'utf8')).version,
});

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) console.log(JSON.stringify(gatewayBuild));
