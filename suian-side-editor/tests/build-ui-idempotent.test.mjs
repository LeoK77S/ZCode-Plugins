import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const targets = ['ui/dist/editor.html', 'ui/dist/THIRD-PARTY-LICENSES.txt'];

test('重复构建内容等价时不触碰已入库产物，工作树不因行尾差异变脏', async () => {
  const before = {};
  for (const rel of targets) {
    const info = await stat(join(root, rel));
    before[rel] = { mtimeNs: info.mtimeMs * 1e6, bytes: await readFile(join(root, rel)) };
  }
  // 首次执行在内容等价时也必须走跳过分支：checkout 出的 CRLF 产物与 LF 构建输出归一后相同。
  await run(process.execPath, ['build-ui.mjs'], { cwd: root });
  for (const rel of targets) {
    const info = await stat(join(root, rel));
    const bytes = await readFile(join(root, rel));
    assert.equal(info.mtimeMs * 1e6, before[rel].mtimeNs, `${rel} 未被重写（mtime 不变）`);
    assert.ok(Buffer.compare(bytes, before[rel].bytes) === 0, `${rel} 字节不变`);
  }
});
