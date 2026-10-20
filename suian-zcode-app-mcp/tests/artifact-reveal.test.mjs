import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture } from './fixtures.mjs';
import { createArtifactRevealService } from '../artifact-reveal.mjs';

const WIN_FILE = 'C:\\work\\report.md', WIN_DIR = 'C:\\work\\bundle';
const MAC_FILE = '/Users/dev/report.md', LINUX_FILE = '/home/dev/report.md', LINUX_DIR = '/home/dev/bundle';
const FILE_REF = 'D:\\work\\deliver\\result.md';
const GH_REF = 'https://github.com/onegayi/zcode-plugins/pull/68';

// —— 服务层：三个平台命令分支以子进程桩验证调用形态，非当前平台分支用 platform 注入确定性执行 ——

function stubRunner() {
  const calls = [];
  return { calls, run: (file, args, options) => { calls.push({ file, args, signal: options?.signal }); return Promise.resolve(); } };
}
const statOf = info => async () => info;
const dirInfo = { isDirectory: () => true }, fileInfo = { isDirectory: () => false };
const exitRunner = code => () => Promise.reject(Object.assign(new Error(`explorer 退出码 ${code}`), { exitCode: code }));

test('win32：文件用 explorer /select,<path> 打开所在目录并选中，文件夹用 explorer <path> 打开自身', async () => {
  const runner = stubRunner();
  const asFile = createArtifactRevealService({ platform: 'win32', stat: statOf(fileInfo), run: runner.run });
  assert.deepEqual(await asFile.reveal(WIN_FILE), { is_directory: false, platform: 'win32' });
  assert.deepEqual(runner.calls[0].args, ['/select,' + WIN_FILE]);
  assert.equal(runner.calls[0].file, 'explorer');
  assert.ok(runner.calls[0].signal instanceof AbortSignal);
  const asDir = createArtifactRevealService({ platform: 'win32', stat: statOf(dirInfo), run: runner.run });
  await asDir.reveal(WIN_DIR);
  assert.deepEqual(runner.calls[1], { file: 'explorer', args: [WIN_DIR], signal: runner.calls[1].signal });
});

test('darwin：文件用 open -R 定位，文件夹用 open 打开自身', async () => {
  const runner = stubRunner();
  await createArtifactRevealService({ platform: 'darwin', stat: statOf(fileInfo), run: runner.run }).reveal(MAC_FILE);
  await createArtifactRevealService({ platform: 'darwin', stat: statOf(dirInfo), run: runner.run }).reveal(MAC_FILE);
  assert.deepEqual([runner.calls[0].file, runner.calls[0].args], ['open', ['-R', MAC_FILE]]);
  assert.deepEqual([runner.calls[1].file, runner.calls[1].args], ['open', [MAC_FILE]]);
});

test('linux：文件夹用 xdg-open 打开自身，文件无统一选中语法、尽力打开所在目录', async () => {
  const runner = stubRunner();
  await createArtifactRevealService({ platform: 'linux', stat: statOf(fileInfo), run: runner.run }).reveal(LINUX_FILE);
  await createArtifactRevealService({ platform: 'linux', stat: statOf(dirInfo), run: runner.run }).reveal(LINUX_DIR);
  assert.deepEqual([runner.calls[0].file, runner.calls[0].args], ['xdg-open', ['/home/dev']]);
  assert.deepEqual([runner.calls[1].file, runner.calls[1].args], ['xdg-open', [LINUX_DIR]]);
});

test('win32 explorer 进程委托现有实例：退出码 0/1 均视为已打开，2 及以上按失败回报', async () => {
  for (const code of [0, 1]) {
    const service = createArtifactRevealService({ platform: 'win32', stat: statOf(fileInfo), run: exitRunner(code) });
    assert.deepEqual(await service.reveal(WIN_FILE), { is_directory: false, platform: 'win32' }, `退出码 ${code} 是成功`);
  }
  const failed = createArtifactRevealService({ platform: 'win32', stat: statOf(fileInfo), run: exitRunner(2) });
  await assert.rejects(() => failed.reveal(WIN_FILE), error => error.code === 'reveal_failed' && /退出码 2/.test(error.message));
});

test('darwin/linux 退出码 1 按失败回报，open 与 xdg-open 是行为正常的控制台程序', async () => {
  for (const platform of ['darwin', 'linux']) {
    const service = createArtifactRevealService({ platform, stat: statOf(dirInfo), run: exitRunner(1) });
    await assert.rejects(() => service.reveal(WIN_DIR), error => error.code === 'reveal_failed');
  }
});

test('命令无法启动（spawn ENOENT）按 reveal_failed 回报，不误判为超时或成功', async () => {
  const run = () => Promise.reject(Object.assign(new Error('spawn explorer ENOENT'), { code: 'ENOENT' }));
  const service = createArtifactRevealService({ platform: 'win32', stat: statOf(fileInfo), run });
  await assert.rejects(() => service.reveal(WIN_FILE), error => error.code === 'reveal_failed' && /spawn explorer ENOENT/.test(error.message));
});

test('路径不存在（stat ENOENT）拒绝为 artifact_missing 且不起子进程', async () => {
  const runner = stubRunner();
  const stat = async () => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); };
  const service = createArtifactRevealService({ platform: 'win32', stat, run: runner.run });
  await assert.rejects(() => service.reveal(WIN_FILE), error => error.code === 'artifact_missing' && error.message.includes(WIN_FILE));
  assert.equal(runner.calls.length, 0);
});

test('非 ENOENT 的 stat 错误按存在降级：沿用文件语义继续打开，不阻塞', async () => {
  const runner = stubRunner();
  const stat = async () => { throw Object.assign(new Error('unreachable'), { code: 'UNKNOWN' }); };
  const service = createArtifactRevealService({ platform: 'win32', stat, run: runner.run });
  assert.deepEqual(await service.reveal(WIN_FILE), { is_directory: false, platform: 'win32' });
  assert.deepEqual(runner.calls[0].args, ['/select,' + WIN_FILE]);
});

test('未知平台没有可用打开命令，拒绝为 reveal_unsupported', async () => {
  const runner = stubRunner();
  const service = createArtifactRevealService({ platform: 'sunos', stat: statOf(fileInfo), run: runner.run });
  await assert.rejects(() => service.reveal(WIN_FILE), error => error.code === 'reveal_unsupported');
  assert.equal(runner.calls.length, 0);
});

test('打开命令超时按 reveal_timeout 回报，不沿用退出码语义', async () => {
  const run = (file, args, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
  });
  const service = createArtifactRevealService({ platform: 'win32', stat: statOf(fileInfo), run, timeoutMs: 20 });
  await assert.rejects(() => service.reveal(WIN_FILE), error => error.code === 'reveal_timeout');
});

// 外层兜底竞速：旧实现对悬挂 stat 无界等待，让缺口以断言失败呈现而不是挂死测试进程
const hangGuard = (promise, ms = 800) => Promise.race([
  promise.then(() => 'resolved', error => error.code),
  new Promise(resolve => setTimeout(() => resolve('测试兜底超时：操作无界等待'), ms))
]);

test('stat 探测悬挂纳入整体期限：期限内按 reveal_timeout 失败，不起打开进程', async () => {
  const runner = stubRunner();
  const stat = () => new Promise(() => {}); // 网络挂载 stat 悬挂：永不 settle
  const service = createArtifactRevealService({ platform: 'win32', stat, run: runner.run, timeoutMs: 25 });
  assert.equal(await hangGuard(service.reveal(WIN_FILE)), 'reveal_timeout', '预检悬挂必须在期限内按超时失败');
  assert.equal(runner.calls.length, 0, '预检未完成不得启动资源管理器');
});

test('stat 超时判决后迟到返回不再触发打开：race 已决出，迟到结果被忽略', async () => {
  const runner = stubRunner();
  let settleStat;
  const stat = () => new Promise(resolve => { settleStat = () => resolve(fileInfo); });
  const service = createArtifactRevealService({ platform: 'win32', stat, run: runner.run, timeoutMs: 20 });
  const outcome = hangGuard(service.reveal(WIN_FILE));
  await new Promise(resolve => setTimeout(resolve, 80)); // 超过 timeoutMs，超时判决应已作出
  assert.equal(await outcome, 'reveal_timeout');
  settleStat(); // stat 迟到成功返回
  await new Promise(resolve => setTimeout(resolve, 50)); // 迟到结果传播后复查
  assert.equal(runner.calls.length, 0, '迟到 stat 结果不得触发资源管理器');
});

// —— MCP 公开契约 ——

async function connect(t, f, options, capabilities, name = 'plain-client') {
  const { createMcpServer } = await import('../server.mjs');
  const server = await createMcpServer(f, options);
  const client = new Client({ name, version: name === 'zcode' ? '3.15.1' : '1.0.0' }, capabilities ? { capabilities } : undefined);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st);
  await client.connect(ct);
  return client;
}

const appsCapability = () => ({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
const recordingReveal = results => {
  const calls = [];
  return { calls, reveal: async path => { calls.push(path); return typeof results === 'function' ? results(path) : results; } };
};

test('reveal_artifact 是面板专用通道：普通客户端不可见，UI 客户端以 app 可见性启用', async t => {
  const f = fixture(t);
  const guard = { reveal: async () => { throw new Error('普通客户端不应触达打开服务'); } };
  const plain = await connect(t, f, { reveal: guard });
  assert.equal((await plain.listTools()).tools.some(tool => tool.name === 'reveal_artifact'), false, '默认禁用：模型侧清单不新增工具');
  const ui = await connect(t, f, { reveal: guard }, appsCapability(), 'zcode');
  const tool = (await ui.listTools()).tools.find(tool => tool.name === 'reveal_artifact');
  assert.ok(tool, 'UI 能力协商成功后启用');
  assert.equal(tool._meta?.ui?.surface, 'artifacts');
  assert.equal(tool._meta?.ui?.resourceUri, 'ui://suian-zcode-app-mcp/artifacts.html');
  assert.deepEqual(tool._meta?.ui?.visibility, ['app']);
  assert.equal(tool.annotations.readOnlyHint, false, '打开资源管理器有用户可见副作用，不标只读');
  assert.equal(tool.annotations.destructiveHint, false);
  assert.match(tool.description, /不接受任意路径/);
  assert.match(tool.description, /file/);
});

test('参数只收 ref：缺 ref、空 ref 或多余参数直接拒绝，不触达打开服务', async t => {
  const f = fixture(t), service = recordingReveal({ is_directory: false, platform: 'win32' });
  const client = await connect(t, f, { reveal: service }, appsCapability(), 'zcode');
  assert.equal((await client.callTool({ name: 'reveal_artifact', arguments: {}, _meta: { session_id: 'sess_alpha' } })).isError, true);
  assert.equal((await client.callTool({ name: 'reveal_artifact', arguments: { ref: '  ' }, _meta: { session_id: 'sess_alpha' } })).isError, true);
  assert.equal((await client.callTool({ name: 'reveal_artifact', arguments: { ref: FILE_REF, path: 'C:\\other.md' }, _meta: { session_id: 'sess_alpha' } })).isError, true);
  assert.equal(service.calls.length, 0);
});

test('权限边界：仅当前会话已登记的 file 条目执行——未登记、非 file 条目直接拒绝', async t => {
  const f = fixture(t), service = recordingReveal(path => ({ is_directory: true, platform: 'win32' }));
  const client = await connect(t, f, { reveal: service }, appsCapability(), 'zcode');
  const call = (name, args, session = 'sess_alpha') => client.callTool({ name, arguments: args, _meta: { session_id: session } });
  await call('set_artifacts', { expected_revision: 0, upsert: [
    { kind: 'pr', ref: GH_REF, label: '实现 PR', purpose: '工单' },
    { kind: 'link', ref: 'https://example.com/doc', label: '文档', purpose: '参考' },
    { kind: 'session', ref: 'sess_beta', label: '兄弟会话', purpose: '协作' },
    { kind: 'issue', ref: 'https://github.com/onegayi/zcode-plugins/issues/71', label: '工单', purpose: '交付' },
    { kind: 'file', ref: FILE_REF, label: '交付文件', purpose: '交付' }
  ] });
  const rejected = [];
  for (const ref of [GH_REF, 'https://example.com/doc', 'sess_beta', 'https://github.com/onegayi/zcode-plugins/issues/71']) {
    const outcome = await call('reveal_artifact', { ref });
    assert.equal(outcome.isError, true, ref + ' 非 file 条目必须拒绝');
    rejected.push(outcome.structuredContent.code);
  }
  assert.deepEqual(rejected, ['artifact_not_file', 'artifact_not_file', 'artifact_not_file', 'artifact_not_file']);
  assert.equal(service.calls.length, 0, '拒绝路径不触达打开服务');
  const unknown = await call('reveal_artifact', { ref: 'C:\\not-registered.md' });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.structuredContent.code, 'artifact_not_found');
  const otherSession = await call('reveal_artifact', { ref: FILE_REF }, 'sess_gamma');
  assert.equal(otherSession.isError, true, '其它会话未登记该工件，不互通');
  assert.equal(otherSession.structuredContent.code, 'artifact_not_found');
  const ok = await call('reveal_artifact', { ref: FILE_REF });
  assert.equal(ok.isError, undefined);
  assert.deepEqual(ok.structuredContent, { ref: FILE_REF, is_directory: true, platform: 'win32' });
  assert.match(ok.content[0].text, /文件管理器.*定位/);
  assert.ok(!ok.content[0].text.includes(FILE_REF), '定位回执不重复完整引用');
  assert.deepEqual(service.calls, [FILE_REF], '仅命中 file 条目才把路径交给打开服务');
});

test('打开失败与路径缺失在回执中行内可读：isError 携带 code 与 error', async t => {
  for (const [code, message] of [
    ['artifact_missing', 'artifact_missing: 路径不存在'],
    ['reveal_failed', 'reveal_failed: explorer 退出码 2']
  ]) {
    const f = fixture(t);
    const client = await connect(t, f, { reveal: { reveal: async () => { throw Object.assign(new Error(message), { code }); } } }, appsCapability(), 'zcode');
    await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0,
      upsert: [{ kind: 'file', ref: FILE_REF, label: '交付文件', purpose: '交付' }] }, _meta: { session_id: 'sess_alpha' } });
    const outcome = await client.callTool({ name: 'reveal_artifact', arguments: { ref: FILE_REF }, _meta: { session_id: 'sess_alpha' } });
    assert.equal(outcome.isError, true);
    assert.equal(outcome.structuredContent.code, code);
    assert.match(outcome.structuredContent.error, new RegExp(code));
    assert.match(outcome.content[0].text, /操作失败/);
  }
});
