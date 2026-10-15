import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture } from './fixtures.mjs';
import { createArtifactStatusService, mergePrStatus } from '../artifact-status.mjs';

const GH_REF = 'https://github.com/onegayi/zcode-plugins/pull/68';
const OPEN_PR = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', additions: 12, deletions: 3 };
const GH_ARGS = ['pr', 'view', GH_REF, '--json', 'state,isDraft,mergeable,additions,deletions'];

// 可切换行为的 gh 桩：按当前模式分发，集中记录调用，服务超时/失败语义不依赖真实网络
function switchableGh(modes) {
  const calls = [];
  let mode = Object.keys(modes)[0];
  return {
    calls,
    use(name) { mode = name; },
    runGh: (args, options) => { calls.push({ args, mode }); return modes[mode](args, options); }
  };
}
const resolveGh = payloadFn => () => Promise.resolve(JSON.stringify(payloadFn()));
const hangGh = () => (args, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
});
const failGh = message => () => Promise.reject(Object.assign(new Error(message), { exitCode: 4 }));

test('成功拉取透传 gh 参数并归并字段', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_PR) });
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => 42, timeoutMs: 1000 });
  const statuses = await service.fetchStatuses([GH_REF]);
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(gh.calls[0].args, GH_ARGS);
  assert.deepEqual(statuses[GH_REF], { status: 'open', additions: 12, deletions: 3, fetched_at: 42 });
});

test('状态归并：merged、closed 压过冲突，冲突压过草稿，其余开放', async () => {
  const gh = switchableGh({ ok: resolveGh(() => ({ state: 'OPEN', isDraft: true, mergeable: 'CONFLICTING', additions: 1, deletions: 2 })) });
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => 0 });
  const statuses = await service.fetchStatuses([GH_REF]);
  assert.equal(statuses[GH_REF].status, 'conflict', '草稿遇冲突按冲突展示');
  assert.deepEqual([
    mergePrStatus({ state: 'MERGED', isDraft: true, mergeable: 'CONFLICTING' }),
    mergePrStatus({ state: 'CLOSED', isDraft: true, mergeable: 'CONFLICTING' }),
    mergePrStatus({ state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE' }),
    mergePrStatus({ state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN' }),
    mergePrStatus({ state: 'open', isDraft: false, mergeable: 'mergeable' }),
    mergePrStatus({})
  ], ['merged', 'closed', 'draft', 'open', 'open', 'open']);
});

test('新鲜期内命中缓存不再起子进程，过期后重新拉取并更新时间戳', async () => {
  let payload = OPEN_PR;
  const gh = switchableGh({ ok: resolveGh(() => payload) });
  const clock = { value: 100 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, freshMs: 60000 });
  await service.fetchStatuses([GH_REF]);
  clock.value += 59000;
  const cached = await service.fetchStatuses([GH_REF]);
  assert.equal(gh.calls.length, 1, '新鲜期内直接命中缓存');
  assert.deepEqual(cached[GH_REF], { status: 'open', additions: 12, deletions: 3, fetched_at: 100 });
  clock.value += 2000;
  payload = { ...OPEN_PR, state: 'MERGED', additions: 20, deletions: 8 };
  const fresh = await service.fetchStatuses([GH_REF]);
  assert.equal(gh.calls.length, 2, '过期后重新拉取');
  assert.deepEqual(fresh[GH_REF], { status: 'merged', additions: 20, deletions: 8, fetched_at: 61100 });
});

test('拉取超时：有旧数据沿用并标记 stale，fetched_at 保持旧成功时间', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_PR), hang: hangGh() });
  const clock = { value: 1000 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, timeoutMs: 25, freshMs: 60000 });
  await service.fetchStatuses([GH_REF]);
  clock.value = 200000;
  gh.use('hang');
  const statuses = await service.fetchStatuses([GH_REF]);
  assert.deepEqual(statuses[GH_REF], { status: 'open', additions: 12, deletions: 3, fetched_at: 1000, stale: true, stale_reason: 'timeout' });
});

test('拉取超时且无旧数据时按出错处理', async () => {
  const hanging = switchableGh({ hang: hangGh() });
  const service = createArtifactStatusService({ runGh: hanging.runGh, now: () => 0, timeoutMs: 25 });
  const statuses = await service.fetchStatuses([GH_REF]);
  assert.match(statuses[GH_REF].error, /^pr_status_timeout/);
  assert.equal(hanging.calls.length, 1);
});

test('gh 失败返回逐条错误并清空缓存，随后的超时不再回退旧数据', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_PR), fail: failGh('gh: authentication required'), hang: hangGh() });
  const clock = { value: 0 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, timeoutMs: 25, freshMs: 60000 });
  await service.fetchStatuses([GH_REF]);
  clock.value = 100000;
  gh.use('fail');
  const failed = await service.fetchStatuses([GH_REF]);
  assert.match(failed[GH_REF].error, /^gh_failed: /);
  clock.value = 200000;
  gh.use('hang');
  const afterFail = await service.fetchStatuses([GH_REF]);
  assert.match(afterFail[GH_REF].error, /^pr_status_timeout/, '失败后缓存被清除，超时无旧数据可沿用');
});

test('非 GitHub 域名直接走出错路径，不起子进程', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_PR) });
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => 0 });
  const statuses = await service.fetchStatuses(['https://example.com/pull/1', 'https://gitlab.com/a/b/-/merge_requests/2', GH_REF, 'not-a-url']);
  assert.equal(gh.calls.length, 1, '仅为 GitHub ref 起子进程');
  assert.match(statuses['https://example.com/pull/1'].error, /^pr_status_not_github/);
  assert.match(statuses['https://gitlab.com/a/b/-/merge_requests/2'].error, /^pr_status_not_github/);
  assert.match(statuses['not-a-url'].error, /^pr_status_not_github/);
  assert.equal(statuses[GH_REF].status, 'open');
});

test('同一 ref 的在途请求合并为一次子进程调用', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const gh = switchableGh({ slow: async () => { await gate; return JSON.stringify(OPEN_PR); } });
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => 0 });
  const first = service.fetchStatuses([GH_REF]);
  const second = service.fetchStatuses([GH_REF]);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(a[GH_REF], b[GH_REF]);
});

// —— MCP 公开契约 ——

async function connect(t, f, options, capabilities, name = 'plain-client') {
  const { createMcpServer } = await import('../server.mjs');
  const server = createMcpServer(f, options);
  const client = new Client({ name, version: name === 'zcode' ? '3.15.1' : '1.0.0' }, capabilities ? { capabilities } : undefined);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st);
  await client.connect(ct);
  return client;
}

const appsCapability = () => ({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });

test('get_pr_statuses 是面板专用通道：普通客户端不可见，UI 客户端以 app 可见性启用', async t => {
  const f = fixture(t);
  const quiet = { fetchStatuses: async () => { throw new Error('普通客户端不应触达状态服务'); } };
  const plain = await connect(t, f, { prStatus: quiet });
  const listed = await plain.listTools();
  assert.equal(listed.tools.some(tool => tool.name === 'get_pr_statuses'), false, '默认禁用：模型侧契约保持十五个工具');
  const ui = await connect(t, f, { prStatus: quiet }, appsCapability(), 'zcode');
  const tool = (await ui.listTools()).tools.find(tool => tool.name === 'get_pr_statuses');
  assert.ok(tool, 'UI 能力协商成功后启用');
  assert.equal(tool._meta?.ui?.surface, 'artifacts');
  assert.equal(tool._meta?.ui?.resourceUri, 'ui://suian-zcode-app-mcp/artifacts.html');
  assert.deepEqual(tool._meta?.ui?.visibility, ['app']);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('get_pr_statuses 按透传 refs 返回逐条结果，单条错误不拖垮整体，服务异常整体报错', async t => {
  const f = fixture(t);
  const seen = [];
  const client = await connect(t, f, { prStatus: { fetchStatuses: async refs => {
    seen.push(refs);
    return Object.fromEntries(refs.map(ref => [ref, ref.includes('example.com')
      ? { error: 'pr_status_not_github: 仅支持 GitHub PR 链接' }
      : { status: 'merged', additions: 7, deletions: 2, fetched_at: 9 }]));
  } }, }, appsCapability(), 'zcode');
  const response = await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF, 'https://example.com/pull/1'] } });
  assert.equal(response.isError, undefined);
  assert.deepEqual(seen, [[GH_REF, 'https://example.com/pull/1']]);
  assert.deepEqual(response.structuredContent.statuses[GH_REF], { status: 'merged', additions: 7, deletions: 2, fetched_at: 9 });
  assert.match(response.structuredContent.statuses['https://example.com/pull/1'].error, /^pr_status_not_github/);
  assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [] } })).isError, true);
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF], extra: 1 } })).isError, true);
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: {} })).isError, true);
  const broken = await connect(t, fixture(t), { prStatus: { fetchStatuses: async () => { throw new Error('boom'); } } }, appsCapability(), 'zcode');
  const failure = await broken.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF] } });
  assert.equal(failure.isError, true);
  assert.match(failure.structuredContent.error, /boom/);
});

test('模型侧 get_artifacts 列表与详情都不触发状态拉取', async t => {
  const f = fixture(t);
  const calls = [];
  const client = await connect(t, f, { prStatus: { fetchStatuses: async refs => { calls.push(refs); return {}; } } });
  await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0,
    upsert: [{ kind: 'pr', ref: GH_REF, label: '实现 PR', purpose: '面板增强工单' }] }, _meta: { session_id: 'sess_alpha' } });
  const list = await client.callTool({ name: 'get_artifacts', arguments: {}, _meta: { session_id: 'sess_alpha' } });
  const detail = await client.callTool({ name: 'get_artifacts', arguments: { ref: GH_REF }, _meta: { session_id: 'sess_alpha' } });
  assert.equal(list.isError, undefined);
  assert.equal(detail.isError, undefined);
  assert.equal(detail.structuredContent.hyperlink, GH_REF);
  assert.equal(calls.length, 0, 'get_artifacts 是模型高频读取路径，不产生网络副作用');
});
