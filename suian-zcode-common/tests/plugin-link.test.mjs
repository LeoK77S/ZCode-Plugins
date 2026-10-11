import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { linkCommon } from '../link.mjs';

test('独立版本缓存中的业务插件共享同一个公共包，公共升级后新进程加载新版本', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-plugin-link-'));
  t.after(() => rm(root, { recursive: true }));
  const runtimeRoot = join(root, '公共运行入口');
  const pluginRoot = join(root, 'cache', 'suian-zcode-title', '0.1.0');
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, 'probe.mjs'), "import {version} from 'suian-zcode-common/probe.mjs'; console.log(version);");
  for (const version of ['0.1.0', '0.2.0']) {
    const commonRoot = join(root, 'cache', 'suian-zcode-common', version);
    await mkdir(commonRoot, { recursive: true });
    await writeFile(join(commonRoot, 'package.json'), JSON.stringify({ name: 'suian-zcode-common', type: 'module' }));
    await writeFile(join(commonRoot, 'probe.mjs'), `export const version='${version}';`);
    await linkCommon({ commonRoot, runtimeRoot, pluginRoots: [pluginRoot] });
    const { stdout } = await promisify(execFile)(process.execPath, [join(pluginRoot, 'probe.mjs')], { windowsHide: true });
    assert.equal(stdout.trim(), version);
  }
  assert.equal((await linkCommon({ commonRoot: join(root, 'cache', 'suian-zcode-common', '0.2.0'), runtimeRoot, pluginRoots: [pluginRoot] })).actions.every(item => item.action === 'unchanged'), true);
});

test('公共运行入口存在普通目录时拒绝覆盖，保留用户文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-plugin-link-owned-'));
  t.after(() => rm(root, { recursive: true }));
  const commonRoot = join(root, 'common'), runtimeRoot = join(root, 'runtime');
  await mkdir(commonRoot); await mkdir(runtimeRoot);
  await writeFile(join(commonRoot, 'package.json'), '{"name":"suian-zcode-common"}');
  await writeFile(join(runtimeRoot, 'keep.txt'), '保留');
  await assert.rejects(linkCommon({ commonRoot, runtimeRoot, pluginRoots: [] }), /不是链接/);
  assert.equal(await readFile(join(runtimeRoot, 'keep.txt'), 'utf8'), '保留');
});
