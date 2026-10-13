import { open, realpath, readdir, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, win32, sep, posix } from 'node:path';
import { createHash } from 'node:crypto';

export function fileFailure(error) {
  const causes = {
    ENOENT: ['file_not_found', '文件不存在或已删除'], ENOTDIR: ['file_not_found', '路径中的目录不存在'],
    EISDIR: ['not_text_file', '目标是目录，不是文本文件'], EACCES: ['permission_denied', '没有访问该文件的权限'],
    EPERM: ['permission_denied', '系统拒绝访问该文件'],
    ERR_ENCODING_INVALID_ENCODED_DATA: ['invalid_utf8', '文件不是有效 UTF-8，未使用替换字符解码']
  };
  const [code, message] = causes[error.code] ?? [error.code ?? 'file_error', error.message];
  return { code, error: message };
}

function describeText(context, path, bytes) {
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    throw Object.assign(new Error('文件包含二进制控制字节，不作为文本读取'), { code: 'binary_file' });
  const styles = new Set((text.match(/\r\n|\r|\n/g) ?? []).map(value => value === '\r\n' ? 'crlf' : value === '\r' ? 'cr' : 'lf'));
  const newline = styles.size > 1 ? 'mixed' : [...styles][0] ?? 'none';
  return { ...context, ...path, text, encoding: { name: 'utf-8', bom, newline }, byteLength: bytes.length,
    version: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

async function resolveWorkspacePath(context, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes(':') || isAbsolute(path) || win32.isAbsolute(path)
    || path.replaceAll('\\', '/').split('/').includes('..'))
    throw Object.assign(new Error('只接受工作区内相对路径，不允许绝对路径、路径穿越或备用数据流'), { code: 'invalid_relative_path' });
  const sourcePath = await realpath(resolve(context.workspacePath, path.replaceAll('\\', '/')));
  const resolvedRelative = relative(context.workspacePath, sourcePath);
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${sep}`) || isAbsolute(resolvedRelative))
    throw Object.assign(new Error('真实路径位于绑定工作区之外，已阻止访问'), { code: 'path_outside_workspace' });
  return { sourcePath, relativePath: resolvedRelative.replaceAll('\\', '/') };
}

export async function listDirectory(context, path) {
  const { sourcePath, relativePath } = await resolveWorkspacePath(context, path);
  if (!(await stat(sourcePath)).isDirectory())
    throw Object.assign(new Error('目标不是目录，不能展开文件列表'), { code: 'not_directory' });
  const entries = await Promise.all((await readdir(sourcePath, { withFileTypes: true })).map(async entry => {
    const item = { name: entry.name, path: posix.join(relativePath, entry.name),
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' };
    if (entry.isSymbolicLink()) {
      try {
        const target = await resolveWorkspacePath(context, item.path);
        const type = await stat(target.sourcePath);
        item.kind = type.isDirectory() ? 'directory' : type.isFile() ? 'file' : 'other';
      } catch (error) {
        if (!['path_outside_workspace', 'ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
        item.unavailableReason = error.code;
      }
    }
    return item;
  }));
  entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'zh-CN'));
  return { ...context, relativePath: relativePath || '.', entries };
}

export async function readTextFile(context, path, expectedSourcePath) {
  const bound = await resolveWorkspacePath(context, path);
  if (expectedSourcePath !== undefined && bound.sourcePath !== expectedSourcePath)
    throw Object.assign(new Error('已登记文件的真实路径已改变，请重新打开'), { code: 'registered_path_changed' });
  const file = await open(bound.sourcePath, 'r');
  try {
    if (!(await file.stat()).isFile())
      throw Object.assign(new Error('目标不是已有的普通文本文件'), { code: 'not_text_file' });
    return describeText(context, bound, await file.readFile());
  } finally { await file.close(); }
}

export async function saveTextFile(context, path, text, baseVersion) {
  if (!text.isWellFormed())
    throw Object.assign(new Error('正文包含孤立代理字符，已拒绝有损 UTF-8 编码'), { code: 'invalid_text' });
  const bound = await resolveWorkspacePath(context, path);
  const file = await open(bound.sourcePath, 'r+');
  try {
    if (!(await file.stat()).isFile())
      throw Object.assign(new Error('目标不是已有的普通文本文件'), { code: 'not_text_file' });
    const current = describeText(context, bound, await file.readFile());
    if (current.version !== baseVersion)
      throw Object.assign(new Error('磁盘内容已改变，保存被拒绝；当前编辑仍保留'), { code: 'version_conflict' });
    if (current.text === text) return current;
    const newline = { crlf: '\r\n', lf: '\n', cr: '\r' }[current.encoding.newline];
    const savedText = newline ? text.replace(/\r\n|\r|\n/g, newline) : text;
    const bytes = Buffer.from((current.encoding.bom ? '\ufeff' : '') + savedText, 'utf8');
    const result = describeText(context, bound, bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset);
      offset += bytesWritten;
    }
    await file.truncate(bytes.length);
    await file.sync();
    return result;
  } finally { await file.close(); }
}
