import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server.mjs';
import { fixture } from './fixtures.mjs';

const uri = 'ui://suian-zcode-app-mcp/artifacts.html';
const mime = 'text/html;profile=mcp-app';
async function connect(t, f, version, capabilities, name = 'zcode') {
  const server = createMcpServer(f), client = new Client({ name, version }, { capabilities });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return client;
}

test('原生工件 UI 同时要求 ZCode >=3.15.1 与 MCP Apps MIME；旧版和能力不足仍有两个普通工具', async t => {
  const f = fixture(t), apps = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [mime] } } };
  for (const [version, capabilities, enabled] of [
    ['3.15.1', apps, true], ['3.15.1.8093', apps, true], ['3.16.0', apps, true],
    ['3.15.0', apps, false], ['3.14.5', apps, false], ['0.16.9', apps, false], ['unknown', apps, false],
    ['3.15.1-beta.1', apps, false], ['3.15.1+build.8093', apps, true], ['4.0.0', apps, true],
    ['3.15.1', {}, false],
    ['3.15.1', { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html'] } } }, false],
    ['3.15.1', { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: mime } } }, false]
  ]) {
    const client = await connect(t, f, version, capabilities);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 15);
    const get = tools.find(tool => tool.name === 'get_artifacts'), set = tools.find(tool => tool.name === 'set_artifacts');
    assert.ok(get); assert.ok(set);
    assert.equal(get._meta?.ui?.resourceUri, enabled ? uri : undefined, version + JSON.stringify(capabilities));
    assert.equal(get._meta?.ui?.surface, enabled ? 'artifacts' : undefined);
    assert.deepEqual(get._meta?.ui?.visibility, enabled ? ['model', 'app'] : undefined);
    assert.deepEqual(set._meta?.ui?.visibility, enabled ? ['model'] : undefined);
    assert.equal((await client.listResources()).resources.some(resource => resource.uri === uri), enabled);
    if (enabled) {
      const page = (await client.readResource({ uri })).contents[0];
      assert.equal(page.mimeType, mime); assert.match(page.text, /get_artifacts/);
      assert.match(page.text, /session_title/);
      assert.match(page.text, /folder:/, '文件夹图标路径存在');
      assert.match(page.text, /is_directory/, '图标按目录标记切换');
      assert.match(page.text, /\.icon\.missing/, '缺失态有灰化样式');
      assert.doesNotMatch(page.text, /set_artifacts|https:\/\/.*\.js|fetch\(/);
    } else await assert.rejects(client.readResource({ uri }));
    assert.equal((await client.callTool({ name: 'get_artifacts', arguments: {}, _meta: { session_id: 'sess_alpha' } })).isError, undefined);
    await client.close();
  }
});

test('3.15.1 Desktop 仍报 CLI 0.16.9 时使用宿主传入的应用版本；未知或旧版应用不启用 UI', async t => {
  const f = fixture(t), apps = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [mime] } } };
  for (const [appVersion, clientVersion, name, enabled] of [
    ['3.15.1', '0.16.9', 'zcode', true], ['3.15.1.8093', '0.16.9', 'zcode', true],
    ['3.15.0', '3.15.1', 'zcode', false], ['unknown', '3.15.1', 'zcode', false],
    ['', '3.15.1', 'zcode', false], [undefined, '0.16.9', 'zcode', false],
    ['3.15.1', '3.15.1', 'other-client', false]
  ]) {
    const client = await connect(t, { ...f, zcodeAppVersion: appVersion }, clientVersion, apps, name);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 15);
    assert.equal(tools.find(tool => tool.name === 'get_artifacts')._meta?.ui?.resourceUri, enabled ? uri : undefined);
    assert.deepEqual(tools.find(tool => tool.name === 'set_artifacts')._meta?.ui?.visibility, enabled ? ['model'] : undefined);
    assert.equal((await client.listResources()).resources.some(resource => resource.uri === uri), enabled);
    await client.close();
  }
});
