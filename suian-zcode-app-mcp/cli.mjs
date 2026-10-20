import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';
import { loadCommonClient, saveAuthorization, setCommonLocation } from './common-client.mjs';
import { loadConfig } from './config.mjs';

const { values } = parseArgs({
   options: { config: { type: 'string' }, 'index-db': { type: 'string' }, 'session-db': { type: 'string' }, 'artifact-db': { type: 'string' }, 'gateway-config': { type: 'string' }, 'auth-data-dir': { type: 'string' }, 'save-authorization': { type: 'boolean' },
    // 源码调试/独立 CLI 场景显式提供公共层位置；宿主 stdio 注入 ZCODE_PLUGIN_DATA 时无需传参
    'installed-plugins': { type: 'string' }, 'common-root': { type: 'string' } },
  allowPositionals: false
});
if (values['installed-plugins']) setCommonLocation({ installedPluginsPath: values['installed-plugins'] });
if (values['common-root']) setCommonLocation({ commonRoot: values['common-root'] });
const config = await loadConfig(values);
if (values['save-authorization']) {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk;
  const { authorization_url } = JSON.parse(raw);
  await saveAuthorization({ dataDir: config.authDataDir, url: authorization_url });
  console.log(JSON.stringify({ ok: true, authorization: 'saved' }));
} else {
  // 建立服务前完成公共层定位与兼容校验（client 入口）；失败在注册工具等业务副作用前报告阶段
  await loadCommonClient();
  const server = await createMcpServer(config);
  await server.connect(new StdioServerTransport());
}
