import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readdir, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { linkCommon } from '../../suian-zcode-common/link.mjs';

// PKG-03 起 app-mcp 运行期经 PKG-01 安装记录定位公共层，不再依赖业务端包链接；
// 本测试保留尚未迁移的 suian-zcode-title 的“分别缓存 + 公共包链接”场景验证。
// app-mcp 的发布包行为（无 node_modules、无 junction、无源码目录）由 release-package.test.mjs 覆盖。
test('分别缓存的 title 插件经公共包链接启动 Stop Hook，写出 not_configured', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-native-cache-'));
  t.after(() => rm(root, { recursive: true }));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const roots = {};
  for (const name of ['suian-zcode-common', 'suian-zcode-title']) {
    const { version } = JSON.parse(await readFile(join(repo, name, '.zcode-plugin', 'plugin.json'), 'utf8'));
    const dest = join(root, '市场 缓存', name, version);
    await cp(join(repo, name), dest, { recursive: true, filter: path => !['node_modules', 'tests', 'docs', 'experiments', '.local', '.scratch', 'config.local.json'].includes(basename(path)) });
    roots[name] = dest;
    if (name === 'suian-zcode-title') continue;
    for (const entry of await readdir(join(repo, name, 'node_modules'), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'suian-zcode-common') continue;
      await mkdir(join(dest, 'node_modules'), { recursive: true });
      await symlink(join(repo, name, 'node_modules', entry.name), join(dest, 'node_modules', entry.name), process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  await linkCommon({ commonRoot: roots['suian-zcode-common'], runtimeRoot: join(root, '稳定公共入口'), pluginRoots: [roots['suian-zcode-title']] });
  const title = roots['suian-zcode-title'];
  const hook = JSON.parse(await readFile(join(title, 'hooks', 'hooks.json'), 'utf8')).hooks.Stop[0].hooks[0];
  assert.equal(hook.async, true);
  const titleData = join(root, '数据', 'title');
  const command = hook.command.replaceAll('${ZCODE_PLUGIN_ROOT}', title).replaceAll('${ZCODE_PLUGIN_DATA}', titleData);
  const stopped = spawnSync(command, { shell: true, windowsHide: true, encoding: 'utf8', input: JSON.stringify({ session_id: 'sess_native_cache_fixture', cwd: root }), env: { ...process.env, OIL_ZCODE_TITLE_DATA: undefined, ZCODE_PLUGIN_DATA: titleData } });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.match(stopped.stdout, /not_configured/);
  assert.equal(JSON.parse((await readFile(join(titleData, 'state', 'hook.log.jsonl'), 'utf8')).trim()).action, 'not_configured');
});
