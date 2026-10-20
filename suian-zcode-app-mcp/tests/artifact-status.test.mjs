import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture } from './fixtures.mjs';
import { createArtifactStatusService, mergePrStatus, mergeIssueState } from '../artifact-status.mjs';

const GH_REF = 'https://github.com/onegayi/zcode-plugins/pull/68';
const OPEN_PR = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', additions: 12, deletions: 3 };
const GH_ARGS = ['pr', 'view', GH_REF, '--json', 'state,isDraft,mergeable,additions,deletions'];
const GH_ISSUE_REF = 'https://github.com/onegayi/zcode-plugins/issues/70';
// 真实 gh issue view --json comments 返回完整评论对象数组（不含主帖）；数字形态作兼容用例
const commentList = length => Array.from({ length }, (_, i) => ({ author: 'u' + i }));
const OPEN_ISSUE = { state: 'OPEN', comments: commentList(4) };
const GH_ISSUE_ARGS = ['issue', 'view', GH_ISSUE_REF, '--json', 'state,comments'];

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

// —— 议题状态（AP-03）：与 PR 共用同一服务的缓存/超时/出错机制 ——

test('议题成功拉取透传 gh issue view 参数并归并状态与评论数', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_ISSUE), numeric: resolveGh(() => ({ state: 'OPEN', comments: 7 })) });
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => 42, timeoutMs: 1000 });
  const statuses = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(gh.calls[0].args, GH_ISSUE_ARGS);
  assert.deepEqual(statuses[GH_ISSUE_REF], { state: 'open', comments: 4, fetched_at: 42 }, '评论对象数组归并为条数');
  gh.use('numeric');
  const numericRef = 'https://github.com/onegayi/zcode-plugins/issues/71';
  const numeric = await service.fetchIssueStatuses([numericRef]);
  assert.equal(numeric[numericRef].comments, 7, 'gh 返回数字评论数时原样透传');
});

test('议题状态归并：CLOSED 为已关闭，开放、缺失或未知值回落开放', () => {
  assert.deepEqual([
    mergeIssueState('CLOSED'), mergeIssueState('closed'), mergeIssueState('OPEN'),
    mergeIssueState(undefined), mergeIssueState('COMPLETED')
  ], ['closed', 'closed', 'open', 'open', 'open']);
});

test('议题新鲜期内命中缓存不再起子进程，过期后重新拉取并更新时间戳', async () => {
  let payload = OPEN_ISSUE;
  const gh = switchableGh({ ok: resolveGh(() => payload) });
  const clock = { value: 100 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, freshMs: 60000 });
  await service.fetchIssueStatuses([GH_ISSUE_REF]);
  clock.value += 59000;
  const cached = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.equal(gh.calls.length, 1, '新鲜期内直接命中缓存');
  assert.deepEqual(cached[GH_ISSUE_REF], { state: 'open', comments: 4, fetched_at: 100 });
  clock.value += 2000;
  payload = { state: 'CLOSED', comments: commentList(9) };
  const fresh = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.equal(gh.calls.length, 2, '过期后重新拉取');
  assert.deepEqual(fresh[GH_ISSUE_REF], { state: 'closed', comments: 9, fetched_at: 61100 });
});

test('议题拉取超时：有旧数据沿用并标记 stale，fetched_at 保持旧成功时间', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_ISSUE), hang: hangGh() });
  const clock = { value: 1000 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, timeoutMs: 25, freshMs: 60000 });
  await service.fetchIssueStatuses([GH_ISSUE_REF]);
  clock.value = 200000;
  gh.use('hang');
  const statuses = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.deepEqual(statuses[GH_ISSUE_REF], { state: 'open', comments: 4, fetched_at: 1000, stale: true, stale_reason: 'timeout' });
});

test('议题拉取超时且无旧数据时按出错处理', async () => {
  const hanging = switchableGh({ hang: hangGh() });
  const service = createArtifactStatusService({ runGh: hanging.runGh, now: () => 0, timeoutMs: 25 });
  const statuses = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.match(statuses[GH_ISSUE_REF].error, /^issue_status_timeout/);
  assert.equal(hanging.calls.length, 1);
});

test('议题 gh 失败返回逐条错误并清空缓存，随后的超时不再回退旧数据', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_ISSUE), fail: failGh('gh: Not Found'), hang: hangGh() });
  const clock = { value: 0 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, timeoutMs: 25, freshMs: 60000 });
  await service.fetchIssueStatuses([GH_ISSUE_REF]);
  clock.value = 100000;
  gh.use('fail');
  const failed = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.match(failed[GH_ISSUE_REF].error, /^gh_failed: /);
  clock.value = 200000;
  gh.use('hang');
  const afterFail = await service.fetchIssueStatuses([GH_ISSUE_REF]);
  assert.match(afterFail[GH_ISSUE_REF].error, /^issue_status_timeout/, '失败后缓存被清除，超时无旧数据可沿用');
});

test('非 GitHub 议题域名直接走出错路径，不起子进程', async () => {
  const gh = switchableGh({ ok: resolveGh(() => OPEN_ISSUE) });
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => 0 });
  const statuses = await service.fetchIssueStatuses(['https://gitlab.com/a/b/-/issues/2', 'not-a-url', GH_ISSUE_REF]);
  assert.equal(gh.calls.length, 1, '仅为 GitHub 议题起子进程');
  assert.match(statuses['https://gitlab.com/a/b/-/issues/2'].error, /^issue_status_not_github/);
  assert.match(statuses['not-a-url'].error, /^issue_status_not_github/);
  assert.equal(statuses[GH_ISSUE_REF].state, 'open');
});

test('议题与 PR 同服务共存：同一次刷新各自降级互不影响', async () => {
  // 按 ref 分发行为的 gh 桩：可对 PR 与议题分别制造超时/失败/成功
  const behavior = { [GH_REF]: 'ok', [GH_ISSUE_REF]: 'ok' };
  const gh = {
    runGh: (args, options) => {
      const ref = args[2];
      if (behavior[ref] === 'hang') return hangGh()(args, options);
      if (behavior[ref] === 'fail') return failGh('gh: 崩溃')(args, options);
      return Promise.resolve(JSON.stringify(ref === GH_ISSUE_REF ? OPEN_ISSUE : OPEN_PR));
    }
  };
  const clock = { value: 0 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, timeoutMs: 25, freshMs: 60000 });
  await Promise.all([service.fetchStatuses([GH_REF]), service.fetchIssueStatuses([GH_ISSUE_REF])]);
  clock.value = 100000;
  behavior[GH_REF] = 'hang';    // PR 超时：沿用旧数据标 stale
  behavior[GH_ISSUE_REF] = 'fail'; // 议题失败：返回 error 且清缓存
  const [pr, issue] = await Promise.all([service.fetchStatuses([GH_REF]), service.fetchIssueStatuses([GH_ISSUE_REF])]);
  assert.deepEqual(pr[GH_REF], { status: 'open', additions: 12, deletions: 3, fetched_at: 0, stale: true, stale_reason: 'timeout' });
  assert.match(issue[GH_ISSUE_REF].error, /^gh_failed: /, '议题失败不拖垮 PR 的超时降级');
  clock.value = 200000;
  behavior[GH_REF] = 'ok'; behavior[GH_ISSUE_REF] = 'ok';
  const [pr2, issue2] = await Promise.all([service.fetchStatuses([GH_REF]), service.fetchIssueStatuses([GH_ISSUE_REF])]);
  assert.equal(pr2[GH_REF].stale, undefined, '议题失败不影响 PR 恢复拉取');
  assert.deepEqual(issue2[GH_ISSUE_REF], { state: 'open', comments: 4, fetched_at: 200000 });
});

test('同 ref 的 PR 与议题按拉取规格隔离：各自起子进程、快照形状互不污染', async () => {
  // PR 与议题 ref 不必然不同：工具层 refs/issue_refs 可传同一 URL，缓存与在途合并必须带规格维度
  const calls = [];
  const gh = { runGh: args => { calls.push(args); return Promise.resolve(JSON.stringify(args[0] === 'issue' ? OPEN_ISSUE : OPEN_PR)); } };
  const clock = { value: 0 };
  const service = createArtifactStatusService({ runGh: gh.runGh, now: () => clock.value, freshMs: 60000 });
  const [pr, issue] = await Promise.all([service.fetchStatuses([GH_REF]), service.fetchIssueStatuses([GH_REF])]);
  assert.equal(calls.length, 2, '同 ref 两分支各自起子进程，不在途合并成一个');
  assert.deepEqual(pr[GH_REF], { status: 'open', additions: 12, deletions: 3, fetched_at: 0 }, 'PR 分支快照形状正确');
  assert.deepEqual(issue[GH_REF], { state: 'open', comments: 4, fetched_at: 0 }, '议题分支不被 PR 快照污染');
  clock.value += 1000;
  const [pr2, issue2] = await Promise.all([service.fetchStatuses([GH_REF]), service.fetchIssueStatuses([GH_REF])]);
  assert.equal(calls.length, 2, '新鲜期内两分支各自命中本规格缓存');
  assert.deepEqual(pr2[GH_REF], pr[GH_REF], 'PR 缓存读取不串到议题形状');
  assert.deepEqual(issue2[GH_REF], issue[GH_REF], '议题缓存读取不串到 PR 形状');
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

test('工件最近状态跨服务实例保存在数据库，列表与详情先读旧快照且不触发网络', async t => {
  const f = fixture(t), calls = [];
  let clock = 100, merged = false;
  const config = { ...f, now: () => clock, runGh: async args => {
    calls.push(args);
    return JSON.stringify(args[0] === 'pr' ? { ...OPEN_PR, state: merged ? 'MERGED' : 'OPEN' } : OPEN_ISSUE);
  } };
  const first = await connect(t, config, {}, appsCapability(), 'zcode');
  await first.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0, upsert: [
    { kind: 'pr', ref: GH_REF, label: '实现 PR', purpose: '跟进' },
    { kind: 'issue', ref: GH_ISSUE_REF, label: '议题', purpose: '跟进' }
  ] }, _meta: { session_id: 'sess_alpha' } });
  await first.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF], issue_refs: [GH_ISSUE_REF] } });
  await first.close();
  clock = 200000; merged = true;
  const reopened = await connect(t, config, {}, appsCapability(), 'zcode');
  const list = await reopened.callTool({ name: 'get_artifacts', arguments: {}, _meta: { session_id: 'sess_alpha' } });
  assert.equal(list.isError, undefined);
  assert.deepEqual(list.structuredContent.items.map(item => item.github_status), [
    { status: 'open', additions: 12, deletions: 3, fetched_at: 100 },
    { state: 'open', comments: 4, fetched_at: 100 }
  ]);
  const detail = await reopened.callTool({ name: 'get_artifacts', arguments: { ref: GH_REF }, _meta: { session_id: 'sess_alpha' } });
  assert.equal(detail.structuredContent.item.github_status.status, 'open');
  assert.equal(calls.length, 2, '读取列表与详情不发 GitHub 请求，过期快照也可用于首屏');
  const fresh = await reopened.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF] } });
  assert.equal(fresh.structuredContent.statuses[GH_REF].status, 'merged');
  const updated = await reopened.callTool({ name: 'get_artifacts', arguments: {}, _meta: { session_id: 'sess_alpha' } });
  assert.equal(updated.structuredContent.items[0].github_status.status, 'merged');
  assert.equal(updated.structuredContent.revision, list.structuredContent.revision, '状态刷新不更改工件登记版本');
});

test('get_pr_statuses 是面板专用通道：普通客户端不可见，UI 客户端以 app 可见性启用', async t => {
  const f = fixture(t);
  const quiet = { fetchStatuses: async () => { throw new Error('普通客户端不应触达状态服务'); } };
  const plain = await connect(t, f, { prStatus: quiet });
  const listed = await plain.listTools();
  assert.equal(listed.tools.some(tool => tool.name === 'get_pr_statuses'), false, '默认禁用：模型侧契约保持十九个工具');
  const ui = await connect(t, f, { prStatus: quiet }, appsCapability(), 'zcode');
  const uiTools = (await ui.listTools()).tools;
  const tool = uiTools.find(tool => tool.name === 'get_pr_statuses');
  assert.ok(tool, 'UI 能力协商成功后启用');
  assert.equal(tool._meta?.ui?.surface, 'artifacts');
  assert.equal(tool._meta?.ui?.resourceUri, 'ui://suian-zcode-app-mcp/artifacts.html');
  assert.deepEqual(tool._meta?.ui?.visibility, ['app']);
  assert.equal(tool.annotations.readOnlyHint, true);
  const get = uiTools.find(tool => tool.name === 'get_artifacts');
  assert.match(get.description, /可能恢复会话并同步索引/, '会话详情的副作用由 get_artifacts 自身说明');
});

test('持久化缓存跨实例保留新鲜期与超时回退，明确失败后删除旧快照', async t => {
  const f = fixture(t), gh = switchableGh({ ok: resolveGh(() => OPEN_PR), hang: hangGh(), fail: failGh('认证失效') });
  let clock = 100;
  const config = { ...f, now: () => clock, runGh: gh.runGh, timeoutMs: 25 };
  const call = async () => (await (await connect(t, config, {}, appsCapability(), 'zcode'))
    .callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF] } })).structuredContent.statuses[GH_REF];
  const first = await connect(t, config, {}, appsCapability(), 'zcode');
  await first.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0,
    upsert: [{ kind: 'pr', ref: GH_REF, label: '实现 PR', purpose: '跟进' }] }, _meta: { session_id: 'sess_alpha' } });
  await call();
  clock = 200;
  gh.use('fail');
  assert.equal((await call()).status, 'open');
  assert.equal(gh.calls.length, 1, '新实例也遵守成功时间戳的新鲜期');
  clock = 200000; gh.use('hang');
  assert.deepEqual(await call(), { status: 'open', additions: 12, deletions: 3, fetched_at: 100, stale: true, stale_reason: 'timeout' });
  gh.use('fail');
  assert.match((await call()).error, /^gh_failed:/);
  const reopened = await connect(t, config, {}, appsCapability(), 'zcode');
  const list = await reopened.callTool({ name: 'get_artifacts', arguments: {}, _meta: { session_id: 'sess_alpha' } });
  assert.equal(list.structuredContent.items[0].github_status, undefined, '失败后新页面不能复活已清除的状态');
  gh.use('hang');
  assert.match((await call()).error, /^pr_status_timeout:/);
});

test('状态持久化失败直接报错，不伪装成 gh 拉取失败', async () => {
  const service = createArtifactStatusService({ runGh: resolveGh(() => OPEN_PR), cache: {
    get: () => undefined,
    set: () => { throw new Error('fixture: SQLite write failed'); },
    delete: () => { throw new Error('不应把写缓存失败当成 gh 失败后清库'); }
  } });
  await assert.rejects(service.fetchStatuses([GH_REF]), /fixture: SQLite write failed/);
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
  assert.match(response.content[0].text, /2 条.*1 条失败/);
  assert.ok(!response.content[0].text.includes(GH_REF), '状态清单只在结构化数据中保留');
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [] } })).isError, true);
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF], extra: 1 } })).isError, true);
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: {} })).isError, true);
  const broken = await connect(t, fixture(t), { prStatus: { fetchStatuses: async () => { throw new Error('boom'); } } }, appsCapability(), 'zcode');
  const failure = await broken.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF] } });
  assert.equal(failure.isError, true);
  assert.match(failure.structuredContent.error, /boom/);
  assert.match(failure.content[0].text, /操作失败.*boom/);
});

test('get_pr_statuses 的 issue_refs 通道：与 PR 结果合并返回，校验与服务异常覆盖议题', async t => {
  const f = fixture(t);
  const seen = [];
  const client = await connect(t, f, { prStatus: {
    fetchStatuses: async refs => { seen.push(['pr', refs]); return { [refs[0]]: { status: 'merged', additions: 7, deletions: 2, fetched_at: 9 } }; },
    fetchIssueStatuses: async refs => { seen.push(['issue', refs]); return { [refs[0]]: { state: 'closed', comments: 7, fetched_at: 10 } }; }
  } }, appsCapability(), 'zcode');
  const both = await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF], issue_refs: [GH_ISSUE_REF] } });
  assert.equal(both.isError, undefined);
  assert.deepEqual(seen, [['pr', [GH_REF]], ['issue', [GH_ISSUE_REF]]], '同一次调用分发两个分支');
  assert.deepEqual(both.structuredContent.statuses[GH_REF], { status: 'merged', additions: 7, deletions: 2, fetched_at: 9 });
  assert.deepEqual(both.structuredContent.statuses[GH_ISSUE_REF], { state: 'closed', comments: 7, fetched_at: 10 });
  assert.match(both.content[0].text, /2 条/);
  const issueOnly = await client.callTool({ name: 'get_pr_statuses', arguments: { issue_refs: [GH_ISSUE_REF] } });
  assert.equal(issueOnly.isError, undefined);
  assert.deepEqual(issueOnly.structuredContent.statuses[GH_ISSUE_REF], { state: 'closed', comments: 7, fetched_at: 10 });
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: { issue_refs: [] } })).isError, true);
  assert.equal((await client.callTool({ name: 'get_pr_statuses', arguments: { issues: [GH_ISSUE_REF] } })).isError, true);
  const broken = await connect(t, fixture(t), { prStatus: {
    fetchStatuses: async () => { throw new Error('boom'); },
    fetchIssueStatuses: async () => { throw new Error('boom'); }
  } }, appsCapability(), 'zcode');
  const failure = await broken.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF], issue_refs: [GH_ISSUE_REF] } });
  assert.equal(failure.isError, true);
  assert.match(failure.structuredContent.statuses[GH_ISSUE_REF].error, /boom/, '服务异常时议题 ref 也带回逐条错误');
});

test('get_pr_statuses 单数组上限 200：恰 200 可用、超出整批拒绝（面板按 ≤200 分块的依据）', async t => {
  const f = fixture(t);
  const many = n => Array.from({ length: n }, (_, i) => `https://github.com/o/r/pull/${i + 1}`);
  const client = await connect(t, f, { prStatus: {
    fetchStatuses: async refs => Object.fromEntries(refs.map(ref => [ref, { status: 'open', fetched_at: 1 }]))
  } }, appsCapability(), 'zcode');
  const full = await client.callTool({ name: 'get_pr_statuses', arguments: { refs: many(200) } });
  assert.equal(full.isError, undefined, '恰 200 条通过校验');
  assert.equal(Object.keys(full.structuredContent.statuses).length, 200);
  const over = await client.callTool({ name: 'get_pr_statuses', arguments: { refs: many(201) } });
  assert.equal(over.isError, true, '超出单数组上限整批拒绝，面板必须按 ≤200 分块调用');
  const overIssue = await client.callTool({ name: 'get_pr_statuses', arguments: { refs: [GH_REF], issue_refs: many(201) } });
  assert.equal(overIssue.isError, true, 'issue_refs 同样受单数组上限约束');
});

test('模型侧 get_artifacts 列表与详情都不触发状态拉取', async t => {
  const f = fixture(t);
  const calls = [];
  const client = await connect(t, f, { prStatus: {
    fetchStatuses: async refs => { calls.push(['pr', refs]); return {}; },
    fetchIssueStatuses: async refs => { calls.push(['issue', refs]); return {}; }
  } });
  await client.callTool({ name: 'set_artifacts', arguments: { expected_revision: 0,
    upsert: [{ kind: 'pr', ref: GH_REF, label: '实现 PR', purpose: '面板增强工单' },
      { kind: 'issue', ref: GH_ISSUE_REF, label: '面板增强议题', purpose: '跟踪工单' }] }, _meta: { session_id: 'sess_alpha' } });
  const list = await client.callTool({ name: 'get_artifacts', arguments: {}, _meta: { session_id: 'sess_alpha' } });
  const detail = await client.callTool({ name: 'get_artifacts', arguments: { ref: GH_REF }, _meta: { session_id: 'sess_alpha' } });
  const issueDetail = await client.callTool({ name: 'get_artifacts', arguments: { ref: GH_ISSUE_REF }, _meta: { session_id: 'sess_alpha' } });
  assert.equal(list.isError, undefined);
  assert.equal(detail.isError, undefined);
  assert.equal(issueDetail.isError, undefined);
  assert.equal(detail.structuredContent.hyperlink, GH_REF);
  assert.equal(issueDetail.structuredContent.hyperlink, GH_ISSUE_REF);
  assert.equal(calls.length, 0, 'get_artifacts 是模型高频读取路径，不产生网络副作用');
});
