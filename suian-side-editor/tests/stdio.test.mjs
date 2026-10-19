import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { apps } from './fixtures.mjs';

test('真实 stdio 进程按专属 env 隔离两个工作区；同一 cwd 不决定文件归属', async t => {
  const root = await mkdtemp(join(tmpdir(), 'side-editor-stdio-'));
  t.after(() => rm(root, { recursive: true }));
  const states = [];
  for (const id of ['a', 'b']) {
    const workspaceRoot = join(root, id); await mkdir(workspaceRoot); await writeFile(join(workspaceRoot, 'test.txt'), `workspace-${id}`);
    const client = new Client({ name: 'zcode', version: '0.16.9' }, { capabilities: apps });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../cli.mjs', import.meta.url))], cwd: root,
      env: { SUIAN_SIDE_EDITOR_WORKSPACE: workspaceRoot, SUIAN_SIDE_EDITOR_INDEX_DB: join(root, 'isolated-index.sqlite'), ZCODE_APP_VERSION: '3.15.1' }, stderr: 'pipe' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'read_editor_text', arguments: { path: 'test.txt' }, _meta: { session_id: `session-${id}` } });
      assert.equal(result.isError, undefined); assert.equal(result.structuredContent.text, `workspace-${id}`);
      assert.equal(result.structuredContent.sessionId, `session-${id}`); states.push(result.structuredContent.workspaceIdentity);
    } finally { await client.close(); }
  }
  assert.notEqual(states[0], states[1]);
});
