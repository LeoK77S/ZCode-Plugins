import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './fixtures.mjs';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

test('资源只能读取可信工具已成功登记的文本，URI 不承载任意路径或调用方身份', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-resources-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  await writeFile(join(workspaceRoot, 'file.txt'), 'first\n');
  const client = await connect(t, { workspaceRoot });
  const unknown = 'ui://suian-side-editor/text/not-registered';
  await assert.rejects(client.readResource({ uri: unknown }), /未登记|not found/);
  await assert.rejects(client.subscribeResource({ uri: unknown }), /未登记/);
  const rejected = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' } });
  assert.equal(rejected.isError, true);
  const opened = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id: 'resource-a' } });
  assert.equal(opened.isError, undefined);
  const uri = opened.structuredContent.resourceUri;
  assert.match(uri, /^ui:\/\/suian-side-editor\/text\/[a-f0-9-]+$/);
  assert.equal(client.getServerCapabilities().resources.subscribe, true);
  const snapshot = JSON.parse((await client.readResource({ uri })).contents[0].text);
  assert.equal(snapshot.text, 'first\n');
  assert.equal(opened.structuredContent.sessionId, 'resource-a', '首次工具具有可信归属');
  assert.deepEqual(Object.keys(snapshot).sort(), ['encoding', 'text', 'version'], '资源只返回磁盘刷新字段，不把首次工具 context 当成当前读者身份公开');
  assert.equal(snapshot.version, opened.structuredContent.version);
  assert.equal((await client.listResources()).resources.some(item => item.uri === uri), false, '模板没有列举登记实例，但这不构成授权证明');
  const other = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id: 'resource-b' } });
  assert.notEqual(other.structuredContent.resourceUri, uri, '不同可信会话登记不同关联 URI');
});

test('一个关联退订不删除其他会话的登记，删除文件返回明确只读错误快照', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-resource-lifecycle-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const path = join(workspaceRoot, 'file.txt'); await writeFile(path, 'first\n');
  const client = await connect(t, { workspaceRoot });
  const open = async session_id => (await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id } })).structuredContent.resourceUri;
  const a = await open('lifecycle-a'), b = await open('lifecycle-b');
  await client.subscribeResource({ uri: a }); await client.subscribeResource({ uri: b });
  await client.unsubscribeResource({ uri: a });
  await assert.rejects(client.readResource({ uri: a }), /未登记/);
  await writeFile(path, 'still-open-in-b\n');
  assert.equal(JSON.parse((await client.readResource({ uri: b })).contents[0].text).text, 'still-open-in-b\n');
  await rm(path);
  const deleted = JSON.parse((await client.readResource({ uri: b })).contents[0].text);
  assert.equal(deleted.code, 'file_not_found'); assert.match(deleted.error, /不存在或已删除/);
  assert.equal(deleted.text, undefined, '失败不伪造空正文或保存回执');
});

test('已登记路径改成另一个文件的目录链接，不把新目标作为资源正文读取', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-resource-path-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const folder = join(workspaceRoot, 'folder'), other = join(workspaceRoot, 'other');
  await mkdir(folder); await mkdir(other);
  await writeFile(join(folder, 'file.txt'), 'authorized\n'); await writeFile(join(other, 'file.txt'), Buffer.from([0xff]));
  const client = await connect(t, { workspaceRoot });
  const opened = await client.callTool({ name: 'read_editor_text', arguments: { path: 'folder/file.txt' }, _meta: { session_id: 'resource-path' } });
  await rename(folder, join(workspaceRoot, 'retired')); await symlink(other, folder, process.platform === 'win32' ? 'junction' : 'dir');
  const snapshot = JSON.parse((await client.readResource({ uri: opened.structuredContent.resourceUri })).contents[0].text);
  assert.equal(snapshot.code, 'registered_path_changed'); assert.equal(snapshot.text, undefined);
});

test('真实文件 ACL 拒读成为资源错误，恢复后重新读取得到最新快照', { skip: process.platform !== 'win32' }, async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-resource-acl-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const path = join(workspaceRoot, 'file.txt'); await writeFile(path, 'first\n');
  const client = await connect(t, { workspaceRoot });
  const opened = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id: 'resource-acl' } });
  const uri = opened.structuredContent.resourceUri;
  const run = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop";' + script],
    { env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: path }, windowsHide: true, stdio: 'pipe' });
  run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Read","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
  try {
    const denied = JSON.parse((await client.readResource({ uri })).contents[0].text);
    assert.equal(denied.code, 'permission_denied'); assert.match(denied.error, /没有访问|拒绝访问/);
  } finally {
    run('$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;');
  }
  assert.equal(JSON.parse((await client.readResource({ uri })).contents[0].text).text, 'first\n');
});

test('已订阅资源的主动读取发现变化也通知其他订阅者，不能让读取抢先吞掉版本变化', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-resource-read-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const path = join(workspaceRoot, 'file.txt'); await writeFile(path, 'first\n');
  const client = await connect(t, { workspaceRoot });
  const opened = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id: 'resource-reader' } });
  const uri = opened.structuredContent.resourceUri;
  const notifications = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, frame => { notifications.push(frame.params.uri); });
  await client.subscribeResource({ uri });
  await writeFile(path, 'read-before-monitor\n');
  assert.equal(JSON.parse((await client.readResource({ uri })).contents[0].text).text, 'read-before-monitor\n');
  assert.deepEqual(notifications, [uri], '读取刷新快照不能让其他有效订阅者错过变化');
});

test('subscribe 确认后读取当前快照覆盖首次打开到订阅之间的变化，并推送后续真实变化', { timeout: 4000 }, async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-resource-gap-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const path = join(workspaceRoot, 'file.txt'); await writeFile(path, 'first\n');
  const client = await connect(t, { workspaceRoot });
  const opened = await client.callTool({ name: 'read_editor_text', arguments: { path: 'file.txt' }, _meta: { session_id: 'resource-gap' } });
  const uri = opened.structuredContent.resourceUri;
  await writeFile(path, 'between-open-and-subscribe\n');
  await client.subscribeResource({ uri });
  assert.equal(JSON.parse((await client.readResource({ uri })).contents[0].text).text, 'between-open-and-subscribe\n');
  let notified;
  const notification = new Promise(resolve => { notified = resolve; });
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, frame => { notified(frame.params.uri); });
  await writeFile(path, 'external-change\n');
  assert.equal(await notification, uri, '真实内容变化发送资源 URI 通知，而非新的受审工具调用');
  assert.equal(JSON.parse((await client.readResource({ uri })).contents[0].text).text, 'external-change\n');
  await client.unsubscribeResource({ uri });
  await assert.rejects(client.readResource({ uri }), /未登记/);
});
