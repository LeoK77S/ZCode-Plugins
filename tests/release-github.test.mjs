// PKG-07 契约：GitHub Release 发布流水线（全桩注入，不触真实网络写操作）。
// 覆盖：新建、同名草稿续作、同名已发布资产复用/冲突、请求结果未知先读现状、
// 中断续作、匿名下载失败阻断公开、摘要不匹配阻断、不能覆盖现有未知内容；
// 顺序强制：草稿资产齐全 -> 匿名下载核验 -> 公开 -> 市场就绪，无先暴露 404 的路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { runReleasePipeline, PIPELINE_STAGES } from '../release-github.mjs';

const shaOf = char => char.repeat(64);
const contentSha = content => createHash('sha256').update(content).digest('hex');
const makeZip = (name, shaChar, bytes = 10) => {
  const content = Buffer.alloc(bytes, shaChar.charCodeAt(0));
  return { name, fileName: `${name}.zip`, zipPath: `D:/zips/${name}.zip`, sha256: contentSha(content), bytes, content };
};
const zips = [makeZip('p', 'a'), makeZip('q', 'b')];
const URL_BASE = 'https://github.com/o/r/releases/download/t-1';
const publicUrls = new Map([
  ['p.zip', `${URL_BASE}/p.zip`],
  ['q.zip', `${URL_BASE}/q.zip`],
]);
const allZips = [...zips];
// 匿名下载：按 URL 尾段映射回对应 ZIP 字节；未登记的 URL 返回 404。
const defaultDownload = async url => {
  const fileName = url.split('/').at(-1);
  const zip = allZips.find(item => item.fileName === fileName);
  if (!zip) {
    const error = new Error('404');
    error.httpStatus = 404;
    throw error;
  }
  return zip.content;
};

class RecordingApi {
  constructor({ release = null, assets = [], digestByAsset = null, uploadFailures = [] } = {}) {
    this.release = release;                 // null | { id, draft, prerelease, tag }
    this.assets = [...assets];              // [{ id, name, size }]
    this.digestByAsset = digestByAsset ?? (asset => allZips.find(zip => zip.fileName === asset.name)?.sha256 ?? null);
    this.uploadFailures = [...uploadFailures]; // 每次 uploadAsset 弹出一个错误
    this.calls = [];
    this.releasesCreated = 0;
    this.metadataUpdates = [];
  }
  async getReleaseByTag(tag) { this.calls.push(['getReleaseByTag', tag]); return this.release; }
  async createDraftRelease({ tag }) { this.calls.push(['createDraftRelease', tag]); this.releasesCreated += 1; this.release = { id: 1, draft: true, prerelease: false, tag }; return this.release; }
  async listAssets(release) { this.calls.push(['listAssets', release.id]); return this.assets.map(asset => ({ ...asset })); }
  async getAssetDigest(asset) { return this.digestByAsset(asset); }
  async uploadAsset(release, { name }) {
    this.calls.push(['uploadAsset', name]);
    const failure = this.uploadFailures.shift();
    if (failure) throw failure;
    this.assets.push({ id: this.assets.length + 10, name, size: 1 });
    return this.assets.at(-1);
  }
  async updateRelease(release, patch) { this.calls.push(['updateRelease', release.id, patch]); Object.assign(this.release, patch); this.metadataUpdates.push(patch); return this.release; }
  assetDownloadUrl(release, asset) { return publicUrls.get(asset.name) ?? `${URL_BASE}/${asset.name}`; }
}

test('新建：无同名 tag/Release 时建草稿、传齐资产、匿名核验后按授权公开', async () => {
  const api = new RecordingApi();
  const download = defaultDownload;
  const result = await runReleasePipeline({
    state: {}, githubApi: api, download, zips, releaseTag: 't-1',
    authorize: { publish: true },
  });
  assert.equal(result.state.stage, 'publish', JSON.stringify(result.error ?? result.state));
  assert.equal(api.releasesCreated, 1);
  assert.equal(api.assets.length, 2, '两个 ZIP 都已上传');
  assert.deepEqual(api.metadataUpdates.at(-1), { draft: false, prerelease: true }, '公开阶段先标预发布');
  assert.equal(result.state.downloads.every(item => item.ok), true);
});

test('顺序强制：未完成匿名下载核验前不得公开（无先暴露 404 的路径）', async () => {
  const api = new RecordingApi();
  const download = async () => { const error = new Error('404'); error.httpStatus = 404; throw error; };
  const result = await runReleasePipeline({
    state: {}, githubApi: api, download, zips, releaseTag: 't-1',
    authorize: { publish: true },
  });
  assert.notEqual(result.state.stage, 'publish', '下载失败不得进入公开阶段');
  assert.equal(result.state.stage, 'verify-download');
  assert.equal(api.release.draft, true, 'Release 必须保持草稿');
  assert.deepEqual(api.metadataUpdates, []);
});

test('匿名下载成功但摘要不匹配必须阻断公开', async () => {
  const api = new RecordingApi();
  const download = async () => Buffer.from('tampered content');
  const result = await runReleasePipeline({
    state: {}, githubApi: api, download, zips, releaseTag: 't-1',
    authorize: { publish: true },
  });
  assert.equal(result.state.stage, 'verify-download');
  assert.deepEqual(api.metadataUpdates, [], '不得公开');
  assert.ok(result.state.downloads.some(item => !item.ok));
});

test('同名草稿续作：已传且摘要匹配的资产不重传，缺的补齐', async () => {
  const api = new RecordingApi({ release: { id: 7, draft: true, prerelease: false, tag: 't-1' }, assets: [{ id: 1, name: 'p.zip', size: 10 }] });
  const download = defaultDownload;
  const result = await runReleasePipeline({
    state: {}, githubApi: api, download, zips, releaseTag: 't-1',
    authorize: { publish: true },
  });
  assert.equal(result.state.stage, 'publish');
  const uploads = api.calls.filter(call => call[0] === 'uploadAsset').map(call => call[1]);
  assert.deepEqual(uploads, ['q.zip'], '已有匹配资产只补缺失的');
});

test('同名已发布资产：摘要匹配即复用不重传；不匹配报冲突，不删除重传', async () => {
  const matching = new RecordingApi({ release: { id: 7, draft: false, prerelease: true, tag: 't-1' }, assets: [{ id: 1, name: 'p.zip', size: 10 }, { id: 2, name: 'q.zip', size: 10 }] });
  const download = defaultDownload;
  const reuse = await runReleasePipeline({ state: {}, githubApi: matching, download, zips, releaseTag: 't-1', authorize: { publish: true } });
  assert.equal(reuse.state.stage, 'publish');
  assert.deepEqual(matching.calls.filter(call => call[0] === 'uploadAsset'), [], '不得重传已发布资产');

  const conflicting = new RecordingApi({
    release: { id: 7, draft: false, prerelease: true, tag: 't-1' },
    assets: [{ id: 1, name: 'p.zip', size: 10 }, { id: 2, name: 'q.zip', size: 10 }],
    digestByAsset: asset => (asset.name === 'q.zip' ? shaOf('f') : shaOf('a')),
  });
  const conflict = await runReleasePipeline({ state: {}, githubApi: conflicting, download, zips, releaseTag: 't-1', authorize: { publish: true } });
  assert.equal(conflict.error.code, 'asset_conflict', JSON.stringify(conflict.error));
  assert.deepEqual(conflicting.calls.filter(call => call[0] === 'uploadAsset'), [], '冲突时不得删除重传');
});

test('不能覆盖现有未知内容：同名资产无可用摘要时拒绝，不得盲传', async () => {
  const api = new RecordingApi({
    release: { id: 7, draft: true, prerelease: false, tag: 't-1' },
    assets: [{ id: 1, name: 'p.zip', size: 10 }],
    digestByAsset: () => null,
  });
  const download = defaultDownload;
  const result = await runReleasePipeline({ state: {}, githubApi: api, download, zips, releaseTag: 't-1', authorize: { publish: true } });
  assert.equal(result.error.code, 'asset_unknown');
  assert.deepEqual(api.calls.filter(call => call[0] === 'uploadAsset'), [], '未知内容不得被覆盖');
});

test('请求结果未知：上传抛 unknown 后先读取现状再续作，不盲重传', async () => {
  const unknownError = new Error('socket hang up');
  unknownError.unknownResult = true;
  // 第一次上传 p.zip 结果未知，但实际已成功落库；续作必须通过读取现状确认而不是重传。
  const api = new RecordingApi({ uploadFailures: [unknownError] });
  const originalUpload = api.uploadAsset.bind(api);
  api.uploadAsset = async (release, input) => {
    if (input.name === 'p.zip' && !api.assets.some(asset => asset.name === 'p.zip')) {
      api.calls.push(['uploadAsset', 'p.zip']);
      api.uploadFailures.shift();
      api.assets.push({ id: 11, name: 'p.zip', size: 10 });
      throw unknownError;
    }
    return originalUpload(release, input);
  };
  const download = defaultDownload;
  const result = await runReleasePipeline({ state: {}, githubApi: api, download, zips, releaseTag: 't-1', authorize: { publish: true } });
  assert.equal(result.state.stage, 'publish', JSON.stringify(result.error ?? result.state));
  const pUploads = api.calls.filter(call => call[0] === 'uploadAsset' && call[1] === 'p.zip');
  assert.equal(pUploads.length, 1, 'p.zip 只允许一次真实上传尝试');
  const readAfterUnknown = api.calls.filter(call => call[0] === 'listAssets').length >= 2;
  assert.equal(readAfterUnknown, true, '结果未知后必须先读取现状');
});

test('中断续作：状态文件已完成阶段跳过、未完成阶段从远端现状续作', async () => {
  // 预置状态：草稿已建、p.zip 已上传核验；远端实际也有 p.zip。续作只传 q.zip。
  const api = new RecordingApi({ release: { id: 7, draft: true, prerelease: false, tag: 't-1' }, assets: [{ id: 1, name: 'p.zip', size: 10 }] });
  const download = defaultDownload;
  const state = { stage: 'upload', releaseId: 7, assets: { 'p.zip': { uploaded: true, sha256: shaOf('a') } } };
  const result = await runReleasePipeline({ state, githubApi: api, download, zips, releaseTag: 't-1', authorize: { publish: true } });
  assert.equal(result.state.stage, 'publish');
  const uploads = api.calls.filter(call => call[0] === 'uploadAsset').map(call => call[1]);
  assert.deepEqual(uploads, ['q.zip']);
  assert.equal(api.releasesCreated, 0, '续作不得重建草稿');
});

test('授权边界：publish 未授权时停留在下载核验完成态并报告待授权，不改 Release 元信息', async () => {
  const api = new RecordingApi();
  const download = defaultDownload;
  const result = await runReleasePipeline({ state: {}, githubApi: api, download, zips, releaseTag: 't-1', authorize: { publish: false } });
  assert.equal(result.state.stage, 'verify-download');
  assert.equal(result.state.publishPending, true);
  assert.deepEqual(api.metadataUpdates, []);
  assert.match(JSON.stringify(result.report), /授权/);
});

test('市场就绪：发布完成后核对候选条目 URL/摘要与资产一致，仅报告不切 master', async () => {
  const api = new RecordingApi();
  const download = defaultDownload;
  publicUrls.set('p-1.0.0.zip', `${URL_BASE}/p-1.0.0.zip`);
  const p = makeZip('p', 'a');
  p.fileName = 'p-1.0.0.zip';
  allZips.push(p);
  const candidateEntry = { name: 'p', version: '1.0.0', dependencies: ['suian-zcode-common'], source: { source: 'url', type: 'zip', url: `${URL_BASE}/p-1.0.0.zip`, sha256: p.sha256, stripRoot: false } };
  const result = await runReleasePipeline({
    state: {}, githubApi: api, download, zips: [p], releaseTag: 't-1',
    authorize: { publish: true }, marketCandidate: { name: 'm', plugins: [candidateEntry] },
  });
  assert.equal(result.state.stage, 'market-ready', JSON.stringify(result.error ?? result.state));
  assert.equal(result.state.marketSwitchPending, true, '市场切换须另行授权，只报告就绪');
  assert.deepEqual(api.metadataUpdates.at(-1), { draft: false, prerelease: true });
});

test('阶段常量暴露完整顺序，供编排器与文档引用', () => {
  assert.deepEqual(PIPELINE_STAGES, ['draft', 'upload', 'verify-download', 'publish', 'market-ready']);
});
