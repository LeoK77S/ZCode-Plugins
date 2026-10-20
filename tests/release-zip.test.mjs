// PKG-07 契约：确定性 ZIP——相同输入字节级一致、排序与时间戳固定、内容变化即变化；
// 安全解压拒绝 Zip Slip / 绝对路径 / 反斜杠 / 盘符路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  writeDeterministicZip, readZipEntries, readZipEntry, extractZip,
  packZipEntries, ZIP_EPOCH_DOS_DATE, ZIP_EPOCH_DOS_TIME,
} from '../release-zip.mjs';

const makeDir = async files => {
  const dir = await mkdtemp(join(tmpdir(), 'pkg07-zip-src-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dir;
};

test('确定性：同输入两次打包字节一致，与写入顺序无关', async t => {
  const firstSource = await makeDir({ 'dist/cli.mjs': 'a', 'LICENSE': 'b', '.zcode-plugin/plugin.json': 'c' });
  const secondSource = await makeDir({ '.zcode-plugin/plugin.json': 'c', 'LICENSE': 'b', 'dist/cli.mjs': 'a' });
  t.after(() => rm(firstSource, { recursive: true, force: true }));
  t.after(() => rm(secondSource, { recursive: true, force: true }));
  const first = await writeDeterministicZip({ sourceDir: firstSource, zipPath: join(firstSource, '..', 'pkg07-a.zip') });
  const second = await writeDeterministicZip({ sourceDir: secondSource, zipPath: join(secondSource, '..', 'pkg07-b.zip') });
  assert.equal(first.zipSha256, second.zipSha256, '同内容不同创建顺序必须产出相同 ZIP 字节');
});

test('确定性：内容或文件名变化后 ZIP 摘要变化', async t => {
  const base = await makeDir({ 'dist/cli.mjs': 'a' });
  const mutated = await makeDir({ 'dist/cli.mjs': 'a2' });
  t.after(() => rm(base, { recursive: true, force: true }));
  t.after(() => rm(mutated, { recursive: true, force: true }));
  const first = await writeDeterministicZip({ sourceDir: base, zipPath: join(base, '..', 'x1.zip') });
  const second = await writeDeterministicZip({ sourceDir: mutated, zipPath: join(mutated, '..', 'x2.zip') });
  assert.notEqual(first.zipSha256, second.zipSha256);
});

test('时间戳与排序固定：central directory 全部条目使用固定 DOS 时间，路径按 posix 排序', async t => {
  const source = await makeDir({ 'b.txt': '1', 'a/dist/deep.mjs': '2', '.zcode-plugin/plugin.json': '3' });
  t.after(() => rm(source, { recursive: true, force: true }));
  const zipPath = join(source, '..', 'epoch.zip');
  await writeDeterministicZip({ sourceDir: source, zipPath });
  const entries = await readZipEntries(zipPath);
  assert.deepEqual(entries.map(entry => entry.path), ['.zcode-plugin/plugin.json', 'a/dist/deep.mjs', 'b.txt']);
  for (const entry of entries) {
    assert.equal(entry.dosTime, ZIP_EPOCH_DOS_TIME, `${entry.path} 时间必须固定`);
    assert.equal(entry.dosDate, ZIP_EPOCH_DOS_DATE, `${entry.path} 日期必须固定`);
  }
});

test('插件根直接位于压缩包根：条目路径无共享顶层目录包裹', async t => {
  const source = await makeDir({ '.zcode-plugin/plugin.json': '{}', 'dist/cli.mjs': 'x' });
  t.after(() => rm(source, { recursive: true, force: true }));
  const zipPath = join(source, '..', 'root.zip');
  await writeDeterministicZip({ sourceDir: source, zipPath });
  const entries = await readZipEntries(zipPath);
  const topLevel = new Set(entries.map(entry => entry.path.split('/')[0]));
  assert.deepEqual([...topLevel].sort(), ['.zcode-plugin', 'dist'], '根条目直接是插件根内容（stripRoot:false 前提）');
});

test('读回与解压：内容逐字节一致，隐藏目录文件完整', async t => {
  const source = await makeDir({ '.zcode-plugin/plugin.json': '{"ok":true}', 'dist/cli.mjs': 'entry code', 'skills/setup/SKILL.md': '# s\n' });
  t.after(() => rm(source, { recursive: true, force: true }));
  const zipPath = join(source, '..', 'roundtrip.zip');
  await writeDeterministicZip({ sourceDir: source, zipPath });
  assert.equal((await readZipEntry(zipPath, '.zcode-plugin/plugin.json')).toString(), '{"ok":true}');
  const target = await mkdtemp(join(tmpdir(), 'pkg07-extract-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await extractZip(zipPath, target);
  assert.equal(await readFile(join(target, 'dist', 'cli.mjs'), 'utf8'), 'entry code');
  await stat(join(target, 'skills', 'setup', 'SKILL.md'));
});

test('安全解压：拒绝 ..、绝对路径、反斜杠与 Windows 盘符条目', async () => {
  const evilEntries = [
    ['../escape.txt', 'x'],
    ['/absolute.txt', 'x'],
    ['nested/../../escape.txt', 'x'],
    ['C:/escape.txt', 'x'],
    ['C:\\escape.txt', 'x'],
    ['back\\slash.txt', 'x'],
  ];
  const buffer = packZipEntries(evilEntries.map(([path, data]) => ({ path, data: Buffer.from(data) })));
  for (let index = 0; index < evilEntries.length; index += 1) {
    // 逐条构造单条目 ZIP，定位失败归因到具体条目
    const single = packZipEntries([{ path: evilEntries[index][0], data: Buffer.from('x') }]);
    const dir = await mkdtemp(join(tmpdir(), 'pkg07-slip-'));
    const zipPath = join(dir, 'evil.zip');
    await writeFile(zipPath, single);
    await assert.rejects(() => extractZip(zipPath, join(dir, 'out')), { code: 'zip_unsafe_path' });
    await rm(dir, { recursive: true, force: true });
  }
  assert.ok(buffer.length > 0);
});
