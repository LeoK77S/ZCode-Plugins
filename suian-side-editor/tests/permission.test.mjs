import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './fixtures.mjs';

test('Windows 临时文件 ACL 拒绝读取时报告 permission_denied', { skip: process.platform !== 'win32' }, async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'side-editor-acl-'));
  t.after(() => rm(workspaceRoot, { recursive: true }));
  const path = join(workspaceRoot, 'denied.txt'); await writeFile(path, 'permission-fixture');
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUIAN_TEST_FILE: path };
  const run = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop";' + script], { env, windowsHide: true, stdio: 'pipe' });
  run('$file=$env:SUIAN_TEST_FILE; $acl=Get-Acl -LiteralPath $file; [IO.File]::WriteAllText($file+".sddl",$acl.Sddl); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"Read","Deny"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;');
  try {
    const client = await connect(t, { workspaceRoot });
    const result = await client.callTool({ name: 'read_editor_text', arguments: { path: 'denied.txt' }, _meta: { session_id: 'test-acl' } });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'permission_denied');
    assert.equal(result.structuredContent.text, undefined);
  } finally {
    run('$file=$env:SUIAN_TEST_FILE; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($file+".sddl")); Set-Acl -LiteralPath $file -AclObject $acl;');
  }
});
