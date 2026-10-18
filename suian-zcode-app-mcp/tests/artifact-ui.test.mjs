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
    assert.equal(tools.length, enabled ? 21 : 19, version + JSON.stringify(capabilities));
    const get = tools.find(tool => tool.name === 'get_artifacts'), set = tools.find(tool => tool.name === 'set_artifacts');
    const status = tools.find(tool => tool.name === 'get_pr_statuses');
    const reveal = tools.find(tool => tool.name === 'reveal_artifact');
    assert.ok(get); assert.ok(set);
    assert.equal(Boolean(status), enabled, 'PR 状态工具仅随面板 UI 启用');
    if (enabled) assert.deepEqual(status._meta?.ui?.visibility, ['app']);
    assert.equal(Boolean(reveal), enabled, '资源管理器打开工具仅随面板 UI 启用');
    if (enabled) assert.deepEqual(reveal._meta?.ui?.visibility, ['app']);
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
      assert.match(page.text, /reveal_artifact/, '面板经 callTool 调用本机定位通道');
      assert.match(page.text, /用文件资源管理器打开/);
      assert.match(page.text, /item\.kind === 'file'/);
      assert.match(page.text, /item\.missing/, '缺失态驱动打开按钮灰化');
      assert.match(page.text, /\.reveal:disabled/, '灰化按钮有禁用样式');
      assert.match(page.text, /pr: '拉取请求', issue: '议题', session: '会话', file: '文件', link: '链接'/);
      assert.match(page.text, /\.icon\.issue\{color:var\(--issue\)\}/);
      assert.match(page.text, /\.icon\.issue\[data-state=open\]\{color:var\(--link\)\}/, '议题开放状态着色');
      assert.match(page.text, /\.icon\.issue\[data-state=closed\]\{color:var\(--accent\)\}/, '议题关闭状态着色');
      assert.match(page.text, /\.icon\.bubble\{/, '评论气泡样式存在');
      assert.match(page.text, /issue_refs/, '面板经同一状态通道传递议题 refs');
      assert.match(page.text, /议题状态/, '详情页显示议题状态');
      assert.match(page.text, /评论数（不含主帖）/, '详情页显示评论数');
      // 状态通道整次失败（callTool 拒绝或 isError）不再静默沿用旧快照：本批全部条目标记错误并重绘，
      // 清状态与数字、logo 回默认（docs/artifact-zone-spec.md 降级语义）；下一次成功刷新恢复显示
      assert.doesNotMatch(page.text, /静默保持现状/, '通道失败静默保持现状的旧语义已移除');
      assert.match(page.text, /通道级失败/, '通道级失败路径注释锚点存在');
      assert.match(page.text, /failStatusChunk\(prChunk, issueChunk/, '通道失败把整批条目标记为错误');
      assert.match(page.text, /prStatuses\[ref\] = \{ error: message \}/, 'PR 桶错误标记清状态');
      assert.match(page.text, /issueStatuses\[ref\] = \{ error: message \}/, '议题桶错误标记清状态');
      // reveal 迟到回执绑定详情代次与 ref：离开详情或切换条目后不污染共享 detailStatus
      assert.match(page.text, /request !== detailRequest \|\| ref !== selectedRef/, '打开回执按详情代次与 ref 校验');
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
    assert.equal(tools.length, enabled ? 21 : 19);
    assert.equal(tools.find(tool => tool.name === 'get_artifacts')._meta?.ui?.resourceUri, enabled ? uri : undefined);
    assert.equal(Boolean(tools.find(tool => tool.name === 'get_pr_statuses')), enabled);
    assert.equal(Boolean(tools.find(tool => tool.name === 'reveal_artifact')), enabled);
    assert.deepEqual(tools.find(tool => tool.name === 'set_artifacts')._meta?.ui?.visibility, enabled ? ['model'] : undefined);
    assert.equal((await client.listResources()).resources.some(resource => resource.uri === uri), enabled);
    await client.close();
  }
});

// UI 逻辑无浏览器测试设施：页面行为契约以源码特征断言固化，脚本本身的可解析性用 node --check 守护
// （module 语法含顶层 await，临时文件取 .mjs 扩展让 --check 按模块解析）
test('页面内联脚本可解析：抽取后 node --check 通过', async t => {
  const { readFile, writeFile, rm } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const html = await readFile(new URL('../ui/artifacts.html', import.meta.url), 'utf8');
  const match = html.match(/<script type="module">([\s\S]*)<\/script>/);
  assert.ok(match, '页面包含 module 内联脚本');
  const file = join(tmpdir(), `artifacts-page-${process.pid}-${Date.now()}.mjs`);
  await writeFile(file, match[1]);
  t.after(() => rm(file, { force: true }).catch(() => {}));
  await promisify(execFile)(process.execPath, ['--check', file]);
});
