import { open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, win32, sep } from 'node:path';
import { createHash } from 'node:crypto';

export async function readTextFile(context, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes(':') || isAbsolute(path) || win32.isAbsolute(path)
    || path.replaceAll('\\', '/').split('/').includes('..'))
    throw Object.assign(new Error('只接受工作区内相对路径，不允许绝对路径、路径穿越或备用数据流'), { code: 'invalid_relative_path' });
  const sourcePath = await realpath(resolve(context.workspacePath, path.replaceAll('\\', '/')));
  const resolvedRelative = relative(context.workspacePath, sourcePath);
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${sep}`) || isAbsolute(resolvedRelative))
    throw Object.assign(new Error('真实文件路径位于绑定工作区之外，已阻止读取'), { code: 'path_outside_workspace' });
  const file = await open(sourcePath, 'r');
  try {
    if (!(await file.stat()).isFile())
      throw Object.assign(new Error('目标不是已有的普通文本文件'), { code: 'not_text_file' });
    const bytes = await file.readFile();
    const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
      throw Object.assign(new Error('文件包含二进制控制字节，不作为文本读取'), { code: 'binary_file' });
    const styles = new Set((text.match(/\r\n|\r|\n/g) ?? []).map(value => value === '\r\n' ? 'crlf' : value === '\r' ? 'cr' : 'lf'));
    const newline = styles.size > 1 ? 'mixed' : [...styles][0] ?? 'none';
    return { ...context, sourcePath, relativePath: resolvedRelative.replaceAll('\\', '/'),
      text, encoding: { name: 'utf-8', bom, newline }, byteLength: bytes.length,
      version: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  } finally { await file.close(); }
}
