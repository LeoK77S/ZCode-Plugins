import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const sessionId of ['sess_fixture', 'session_00000000-0000-4000-8000-000000000316']) test(`会话命名策略兼容 ${sessionId.split('_')[0]} 前缀，显式锁定可由两个调用方读取`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zcode-title-policy-'));
  t.after(() => rm(directory, { recursive: true }));
  const { readTitlePolicy, writeTitlePolicy } = await import('../title-policy.mjs');
  assert.equal(await readTitlePolicy({ sessionId, directory }), null);
  await writeTitlePolicy({ sessionId, locked: true, directory });
  assert.deepEqual(await readTitlePolicy({ sessionId, directory }), { version: 1, locked: true });
  await writeTitlePolicy({ sessionId: 'sess_other', locked: false, directory });
  assert.equal((await readTitlePolicy({ sessionId: 'sess_other', directory })).locked, false);
  await assert.rejects(writeTitlePolicy({ sessionId: '../escape', locked: true, directory }), /session/);
});
