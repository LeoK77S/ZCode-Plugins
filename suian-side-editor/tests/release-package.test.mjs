// PKG-04 发布目录契约：公共模块经真实安装记录定位加载、发布包自包含、
// 外置状态与版本冲突语义保持、构建输入不内联 common 实现或 vendor。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { apps } from './fixtures.mjs';
import { ensureCommonFixture, editorRoot, commonSourceRoot } from './common-fixture.mjs';
import { buildEditorRelease } from '../build-release.mjs';

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

let releaseOnce;
function releaseResult() {
  releaseOnce ??= (async () => {
    const out = await mkdtemp(join(tmpdir(), 'pkg04-editor-release-'));
    return { out, ...await buildEditorRelease({ outDir: join(out, 'editor-release') }) };
  })();
  return releaseOnce;
}

test('入口未注入定位锚点时按定位契约失败，而不是裸模块错误', async () => {
  const child = spawn(process.execPath, [join(editorRoot, 'cli.mjs')], {
    cwd: tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ZCODE_APP_VERSION: '3.15.1', SUIAN_SIDE_EDITOR_INDEX_DB: 'unused' },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const outcome = await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve('timeout'); }, 8000);
    child.on('exit', status => { clearTimeout(timer); resolve(status); });
  });
  assert.notEqual(outcome, 'timeout', `入口进程未按定位契约退出，8 秒仍等待 stdio；stderr：${stderr}`);
  assert.notEqual(outcome, 0, '缺少定位锚点不得正常启动');
  assert.match(stderr, /anchor_missing/, `stderr 应包含定位错误分类 anchor_missing，实际：${stderr}`);
});

test('发布目录组装：实际构建页面、薄适配、许可与元数据齐备，无 node_modules', async t => {
  // 共享构建产物供后续测试复用；临时根由系统清理，不在单个测试结束时删除。
  const { releaseDir, release } = await releaseResult();
  for (const file of [
    'cli.mjs', 'common-client.mjs', 'locate.mjs', 'ui/dist/editor.html', 'ui/dist/THIRD-PARTY-LICENSES.txt',
    '.zcode-plugin/plugin.json', '.mcp.json', 'skills/setup/SKILL.md', 'LICENSE', 'release.json',
  ]) {
    await assert.doesNotReject(() => readFile(join(releaseDir, file)), `发布目录缺 ${file}`);
  }
  const entries = await readdir(releaseDir, { withFileTypes: true });
  assert.ok(!entries.some(entry => entry.name === 'node_modules'), '发布目录不得携带 node_modules');

  const licenses = await readFile(join(releaseDir, 'ui/dist/THIRD-PARTY-LICENSES.txt'), 'utf8');
  assert.match(licenses, /@codemirror\/state/, 'CodeMirror 第三方许可缺失');
  const page = await readFile(join(releaseDir, 'ui/dist/editor.html'), 'utf8');
  assert.doesNotMatch(page, /http:\/\/(?:localhost|127\.0\.0\.1)/, '页面不得请求开发服务器');
  assert.doesNotMatch(page, /file:\/\/\//, '页面不得引用本机 file URL');
  assert.doesNotMatch(page, /[A-Za-z]:[\\/](?:CODE|Users|Windows|APP)[\\/]/, '页面不得携带本机源码路径');

  assert.equal(release.formatVersion, 1);
  assert.equal(release.pluginName, 'suian-side-editor');
  assert.match(release.pluginVersion, /^\d+\.\d+\.\d+$/);
  assert.match(release.buildId, /^[0-9a-f]{64}$/);
  for (const entry of ['cli', 'commonClient', 'locate', 'page']) {
    assert.ok(typeof release.entries[entry] === 'string' && release.entries[entry].length > 0, `entries 缺 ${entry}`);
    await assert.doesNotReject(() => readFile(join(releaseDir, release.entries[entry])), `入口文件 ${entry} 不存在`);
  }
  assert.equal(release.requiredCommon.commonApiVersion, 1, '业务必须声明所需公共 API 代际');
  assert.match(release.requiredCommon.minimumCommonVersion, /^\d+\.\d+\.\d+$/, '必须声明最低 common 插件版本');
  const listed = release.files.map(file => file.path);
  assert.ok(!listed.includes('release.json'), '文件清单不得包含 release.json 自身');
  for (const file of release.files) {
    assert.equal(await sha256(join(releaseDir, file.path)), file.sha256, `${file.path} 摘要不符`);
  }
});

test('构建输入不内联 common 实现或公共 vendor；状态库仍使用 Node 内置 SQLite', async t => {
  const { releaseDir, buildInputs } = await releaseResult();
  const inputs = Object.keys(buildInputs.inputs);
  assert.ok(inputs.length > 0, '必须记录真实构建输入');
  assert.ok(!inputs.some(path => path.includes('suian-zcode-common')), '不得把 common 实现打进业务产物');
  assert.ok(!inputs.some(path => /(^|[\\/])vendor([\\/]|$)/.test(path)), '不得把公共 vendor 打进业务产物');
  assert.ok(!inputs.some(path => /better-sqlite3|(^|[\\/])sqlite3([\\/]|$)|node-gyp/.test(path)), '不得引入原生 SQLite 扩展');
  const bundle = await readFile(join(releaseDir, 'cli.mjs'), 'utf8');
  assert.match(bundle, /node:sqlite/, 'bundle 应继续引用 Node 内置 SQLite');
  assert.doesNotMatch(bundle, /suian-zcode-common/, 'common 裸包名不得残留在发布产物');
  const locateCopy = await readFile(join(releaseDir, 'locate.mjs'), 'utf8');
  const locateSource = await readFile(join(commonSourceRoot, 'locate.mjs'), 'utf8');
  assert.equal(locateCopy, locateSource, '定位器必须逐字节来自 common 单一源码');
});

test('独立安装根：无开发依赖时 stdio、app-only 工具、实际页面与外置状态可用', async t => {
  const fixture = await ensureCommonFixture();
  const { out, releaseDir } = await releaseResult();
  const install = await mkdtemp(join(tmpdir(), 'pkg04-installed-'));
  // Windows 下 stdio 子进程退出与句柄释放存在短暂窗口，删除临时安装根须重试等待锁释放。
  t.after(() => rm(install, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const editorInstall = join(install, 'suian-side-editor');
  await cp(releaseDir, editorInstall, { recursive: true });
  // 宿主 stdio 的 cwd 是 ZCODE_PROJECT_DIR（用户工作区，不在插件缓存内）；按同一语义把
  // 子进程 cwd 放在安装根之外，避免测试收尾时工作目录占用安装目录（Windows 目录锁）。
  const hostCwd = join(out, 'host-cwd');
  await mkdir(hostCwd, { recursive: true });
  const workspace = join(install, 'workspace');
  await mkdir(workspace);
  const original = '第一行\r\nsecond line\r\n';
  await writeFile(join(workspace, 'note.txt'), original);
  const env = {
    ZCODE_PLUGIN_DATA: fixture.dataPath,
    SUIAN_SIDE_EDITOR_WORKSPACE: workspace,
    SUIAN_SIDE_EDITOR_INDEX_DB: join(install, 'index.sqlite'),
    SUIAN_SIDE_EDITOR_GATEWAY_CONFIG: join(install, 'missing-gateway.json'),
    ZCODE_APP_VERSION: '3.15.1',
  };
  const spawnClient = async () => {
    const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [join(editorInstall, 'cli.mjs')], cwd: hostCwd, env, stderr: 'pipe',
    });
    await client.connect(transport);
    return client;
  };
  const meta = { session_id: 'pkg04-release-fixture' };
  const client = await spawnClient();
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 9, 'initialize 后 app-only 工具应全部启用');

  const read = await client.callTool({ name: 'read_editor_text', arguments: { path: 'note.txt' }, _meta: meta });
  assert.equal(read.isError, undefined);
  assert.equal(read.structuredContent.text, original);
  const baseVersion = read.structuredContent.version;

  await writeFile(join(workspace, 'note.txt'), '外部覆盖\r\n');
  const conflict = await client.callTool({
    name: 'save_editor_text', arguments: { path: 'note.txt', text: '新正文\r\n', baseVersion }, _meta: meta,
  });
  assert.equal(conflict.isError, true, '磁盘版本变化后必须拒绝写入');
  assert.equal(conflict.structuredContent.code, 'version_conflict');

  const reread = await client.callTool({ name: 'read_editor_text', arguments: { path: 'note.txt' }, _meta: meta });
  const saved = await client.callTool({
    name: 'save_editor_text',
    arguments: { path: 'note.txt', text: '编辑后的正文\r\n', baseVersion: reread.structuredContent.version },
    _meta: meta,
  });
  assert.equal(saved.isError, undefined, '重新核对版本后保存应成功');

  const settings = await client.callTool({ name: 'update_editor_settings', arguments: { saveMode: 'auto' }, _meta: meta });
  assert.equal(settings.structuredContent.saveMode, 'auto', '保存模式事务应在发布包内生效');
  const draftState = {
    files: [{
      path: 'note.txt', fixed: true, scrollTop: 12, scrollLeft: 0,
      draft: {
        text: '未保存草稿', diskText: '编辑后的正文\r\n', baseVersion: saved.structuredContent.version,
        encoding: { name: 'utf-8', bom: false, newline: 'crlf' },
      },
    }],
    currentPath: 'note.txt',
  };
  const updated = await client.callTool({ name: 'update_editor_state', arguments: { state: draftState }, _meta: meta });
  assert.equal(updated.isError, undefined, '恢复副本写入应成功');
  await assert.doesNotReject(() => stat(join(fixture.dataPath, 'editor-state.sqlite')), '状态库必须落在 ZCODE_PLUGIN_DATA 外置目录');

  const page = (await client.readResource({ uri: 'ui://suian-side-editor/editor.html' })).contents[0];
  assert.equal(page.mimeType, 'text/html;profile=mcp-app');
  assert.match(page.text, /get_editor_context/, '资源应返回实际构建页面');

  const comment = await client.callTool({ name: 'get_editor_comment_state', arguments: {}, _meta: meta });
  assert.equal(comment.isError, undefined);
  assert.equal(comment.structuredContent.state, 'unknown', '无网关时评论状态应明确不可用');
  assert.ok(comment.structuredContent.reason.length > 0, '不可用必须给出原因');
  assert.deepEqual(comment.structuredContent.acceptedBatches, []);
  const stillWorks = await client.callTool({ name: 'read_editor_text', arguments: { path: 'note.txt' }, _meta: meta });
  assert.equal(stillWorks.isError, undefined, '评论不可用不得影响文本编辑');

  await client.close();
  const second = await spawnClient();
  t.after(() => second.close());
  const restored = await second.callTool({ name: 'get_editor_state', arguments: {}, _meta: meta });
  assert.equal(restored.isError, undefined);
  assert.deepEqual(restored.structuredContent.state, draftState, '新进程应从外置状态目录读回恢复副本');
  assert.ok(restored.structuredContent.revision >= 1, '恢复副本应有递增版本');
});
