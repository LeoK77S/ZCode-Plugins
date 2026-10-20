// PKG-07 契约：URL 安装 fixture——本地 loopback HTTP 提供正式 ZIP 字节，模拟官方
// zip-source 安装器：形状校验 -> 下载 -> sha256 -> 安全解压 -> stripRoot:false 根定位 ->
// 插件清单身份与版本核对 -> common 依赖集合核对；摘要不匹配与下载失败必须拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeReleaseDir } from './release-fixtures.mjs';
import { writeDeterministicZip, extractZip } from '../release-zip.mjs';
import { validateMarketplaceEntry } from '../release-marketplace.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');

const startServer = async (routes) => {
  const server = createServer((request, response) => {
    const route = routes[request.url];
    if (!route) { response.writeHead(404); response.end('not found'); return; }
    response.writeHead(200, { 'content-type': route.type ?? 'application/octet-stream' });
    response.end(route.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: path => `http://127.0.0.1:${port}${path}` };
};

const makeZipFixture = async () => {
  const source = await mkdtemp(join(tmpdir(), 'pkg07-inst-src-'));
  const release = await makeReleaseDir(source, {
    pluginName: 'suian-zcode-title', version: '0.1.5', packageName: 'oil-zcode-title-runner',
    dependencies: ['suian-zcode-common'],
    files: {
      'dist/cli.mjs': '// cli\n', 'dist/hook.mjs': '// hook\n', 'dist/install.mjs': '// install\n', 'dist/toast-action.mjs': '// toast\n',
      'prompt.md': '# p\n', 'SKILL.md': '# s\n', 'hooks/hooks.json': '{}\n',
    },
  });
  const zipPath = join(source, '..', 'suian-zcode-title-0.1.5.zip');
  const zip = await writeDeterministicZip({ sourceDir: source, zipPath });
  const bytes = await readFile(zipPath);
  return { source, release, zipPath, bytes, zipSha256: zip.zipSha256 };
};

// 模拟官方 resolveZipPluginSource 的关键顺序：形状 -> 匿名下载 -> 先摘要校验后解压 -> 根定位。
async function simulateInstaller({ entry, fetchImpl, extractRoot, tempZip }) {
  const shape = validateMarketplaceEntry(entry, { allowLoopback: true });
  if (!shape.ok) return { status: 'shape_rejected', problems: shape.problems };
  let response;
  try {
    response = await fetchImpl(entry.source.url);
  } catch (error) {
    return { status: 'download_failed', reason: error.cause?.code ?? error.message };
  }
  if (!response.ok) return { status: 'download_failed', reason: `HTTP ${response.status}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== entry.source.sha256.toLowerCase()) return { status: 'digest_mismatch' };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(tempZip, bytes);
  await extractZip(tempZip, extractRoot);
  const manifest = JSON.parse(await readFile(join(extractRoot, '.zcode-plugin', 'plugin.json'), 'utf8'));
  return { status: 'installed', manifest };
}

test('安装 fixture：合法 ZIP 经官方语义安装成功，根即插件根、依赖集合正确', async t => {
  const fixture = await makeZipFixture();
  t.after(() => rm(fixture.source, { recursive: true, force: true }));
  t.after(() => rm(join(fixture.zipPath, '..'), { recursive: true, force: true }).catch(() => {}));
  const { server, url } = await startServer({ '/p.zip': { body: fixture.bytes } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = {
    name: 'suian-zcode-title', version: '0.1.5', dependencies: ['suian-zcode-common'],
    source: { source: 'url', type: 'zip', url: url('/p.zip'), sha256: fixture.zipSha256, stripRoot: false },
  };
  const extractRoot = await mkdtemp(join(tmpdir(), 'pkg07-inst-root-'));
  t.after(() => rm(extractRoot, { recursive: true, force: true }));
  const tempZipDir = await mkdtemp(join(tmpdir(), 'pkg07-inst-tmp-'));
  t.after(() => rm(tempZipDir, { recursive: true, force: true }));
  const result = await simulateInstaller({ entry, fetchImpl: fetch, extractRoot, tempZip: join(tempZipDir, 'download.zip') });
  assert.equal(result.status, 'installed', JSON.stringify(result));
  assert.equal(result.manifest.name, 'suian-zcode-title');
  assert.equal(result.manifest.version, '0.1.5');
  assert.deepEqual(result.manifest.dependencies, ['suian-zcode-common'], '业务条目依赖集合必须含 common');
});

test('安装 fixture：摘要不匹配拒绝，不得解压', async t => {
  const fixture = await makeZipFixture();
  t.after(() => rm(fixture.source, { recursive: true, force: true }));
  const { server, url } = await startServer({ '/p.zip': { body: Buffer.concat([fixture.bytes, Buffer.from('x')]) } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = {
    name: 'p', version: '0.1.5', dependencies: ['suian-zcode-common'],
    source: { source: 'url', type: 'zip', url: url('/p.zip'), sha256: fixture.zipSha256, stripRoot: false },
  };
  const extractRoot = await mkdtemp(join(tmpdir(), 'pkg07-inst-bad-'));
  t.after(() => rm(extractRoot, { recursive: true, force: true }));
  const result = await simulateInstaller({ entry, fetchImpl: fetch, extractRoot, tempZip: join(extractRoot, '..', 'dl.zip') });
  assert.equal(result.status, 'digest_mismatch');
  await assert.rejects(() => readFile(join(extractRoot, '.zcode-plugin', 'plugin.json')), { code: 'ENOENT' }, '摘要不匹配不得解压');
});

test('安装 fixture：匿名下载失败（404）拒绝且不产生安装痕迹', async t => {
  const { server, url } = await startServer({});
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = {
    name: 'p', version: '0.1.5', dependencies: ['suian-zcode-common'],
    source: { source: 'url', type: 'zip', url: url('/p.zip'), sha256: 'a'.repeat(64), stripRoot: false },
  };
  const extractRoot = await mkdtemp(join(tmpdir(), 'pkg07-inst-404-'));
  t.after(() => rm(extractRoot, { recursive: true, force: true }));
  const result = await simulateInstaller({ entry, fetchImpl: fetch, extractRoot, tempZip: join(extractRoot, '..', 'dl.zip') });
  assert.equal(result.status, 'download_failed');
  assert.match(result.reason, /404/);
});

test('安装 fixture：非 loopback http URL、敏感 headers、latest URL、token 不进入市场（形状层拒绝）', () => {
  const cases = [
    { name: 'p', version: '1.0.0', source: { source: 'url', type: 'zip', url: 'http://cdn.example.com/p.zip', sha256: 'a'.repeat(64), stripRoot: false } },
    { name: 'p', version: '1.0.0', source: { source: 'url', type: 'zip', url: 'http://127.0.0.1:1/p.zip', sha256: 'a'.repeat(64), stripRoot: false, headers: { Cookie: 'x' } } },
    { name: 'p', version: '1.0.0', source: { source: 'url', type: 'zip', url: 'https://github.com/o/r/releases/latest/download/p.zip', sha256: 'a'.repeat(64), stripRoot: false } },
    { name: 'p', version: '1.0.0', source: { source: 'url', type: 'zip', url: 'https://github.com/o/r/releases/download/t-1/p.zip', sha256: 'a'.repeat(64), stripRoot: false, token: 'ghp_x' } },
  ];
  for (const entry of cases) {
    const result = validateMarketplaceEntry(entry, { allowLoopback: true });
    assert.equal(result.ok, false, JSON.stringify(entry));
  }
});
