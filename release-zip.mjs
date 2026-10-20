// PKG-07：确定性 ZIP 写入 / 读取 / 安全解压。
// 压缩实现锁定为 Node 内置 zlib（deflate level 9，不足则 store），无外部依赖；
// 相同文件集合与内容产出字节级一致的 ZIP：条目按 posix 路径排序、时间戳取固定
// DOS 纪元（2026-01-01 00:00:00）、权限位固定 0o100644。
// 解压侧对齐官方 zip-source 规范的安全要求：拒绝绝对路径、`..`、反斜杠、盘符、
// NUL、symlink 条目，并复核目标仍在解压根内（Zip Slip 双保险）。
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const ZIP_EPOCH_DOS_DATE = 0x5c21; // 2026-01-01（(2026-1980)<<9 | 1<<5 | 1）
export const ZIP_EPOCH_DOS_TIME = 0x0000; // 00:00:00

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 0x031e; // Unix / zip 3.0
const EXTERNAL_ATTRS = (0o100644) << 16; // 普通文件 -rw-r--r--
const FLAG_UTF8 = 0x0800;

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

const writeU16 = (buffer, offset, value) => { buffer.writeUInt16LE(value & 0xffff, offset); };
const writeU32 = (buffer, offset, value) => { buffer.writeUInt32LE(value >>> 0, offset); };

const toPosix = path => path.split(sep).join('/');

async function walkFiles(dir, base = dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(path, base));
    else if (entry.isFile()) found.push(toPosix(relative(base, path)));
    else throw new Error(`发布目录包含非常规文件，拒绝打包：${path}`);
  }
  return found;
}

/**
 * 底层打包：files = [{path, data}]，按传入顺序原样写入（供测试构造恶意 ZIP）。
 * 生产路径请用 writeDeterministicZip（先排序再打包）。
 */
export function packZipEntries(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { path, data } of files) {
    const nameBytes = Buffer.from(path, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const digest = crc32(raw) >>> 0;
    let method = METHOD_DEFLATE;
    let payload = deflateRawSync(raw, { level: 9 });
    if (payload.length >= raw.length) {
      method = METHOD_STORE;
      payload = raw;
    }
    const local = Buffer.alloc(30 + nameBytes.length);
    writeU32(local, 0, LOCAL_HEADER_SIG);
    writeU16(local, 4, VERSION_NEEDED);
    writeU16(local, 6, FLAG_UTF8);
    writeU16(local, 8, method);
    writeU16(local, 10, ZIP_EPOCH_DOS_TIME);
    writeU16(local, 12, ZIP_EPOCH_DOS_DATE);
    writeU32(local, 14, digest);
    writeU32(local, 18, payload.length);
    writeU32(local, 22, raw.length);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    nameBytes.copy(local, 30);
    locals.push(local, payload);

    const central = Buffer.alloc(46 + nameBytes.length);
    writeU32(central, 0, CENTRAL_HEADER_SIG);
    writeU16(central, 4, VERSION_MADE_BY);
    writeU16(central, 6, VERSION_NEEDED);
    writeU16(central, 8, FLAG_UTF8);
    writeU16(central, 10, method);
    writeU16(central, 12, ZIP_EPOCH_DOS_TIME);
    writeU16(central, 14, ZIP_EPOCH_DOS_DATE);
    writeU32(central, 16, digest);
    writeU32(central, 20, payload.length);
    writeU32(central, 24, raw.length);
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0); // extra
    writeU16(central, 32, 0); // comment
    writeU16(central, 34, 0); // disk start
    writeU16(central, 36, 0); // internal attrs
    writeU32(central, 38, EXTERNAL_ATTRS);
    writeU32(central, 42, offset);
    nameBytes.copy(central, 46);
    centrals.push(central);

    offset += local.length + payload.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  writeU32(eocd, 0, EOCD_SIG);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, files.length);
  writeU16(eocd, 10, files.length);
  writeU32(eocd, 12, centralDirectory.length);
  writeU32(eocd, 16, offset);
  writeU16(eocd, 20, 0);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

/** 确定性打包目录：插件根直接位于压缩包根，条目按 posix 路径排序。 */
export async function writeDeterministicZip({ sourceDir, zipPath }) {
  const paths = (await walkFiles(sourceDir)).sort();
  const files = [];
  for (const path of paths) {
    const data = await readFile(join(sourceDir, ...path.split('/')));
    files.push({ path, data });
  }
  const bytes = packZipEntries(files);
  await mkdir(dirname(zipPath), { recursive: true });
  await writeFile(zipPath, bytes);
  return {
    zipPath,
    zipSha256: sha256(bytes),
    bytes: bytes.length,
    entries: files.map(({ path, data }) => ({ path, sha256: sha256(data), bytes: data.length })),
  };
}

async function parseCentralDirectory(zipPath) {
  const bytes = await readFile(zipPath);
  if (bytes.length < 22) throw new Error('ZIP 文件不完整');
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= 0 && index >= bytes.length - 22 - 0xffff; index -= 1) {
    if (bytes.readUInt32LE(index) === EOCD_SIG) { eocdOffset = index; break; }
  }
  if (eocdOffset < 0) throw new Error('找不到 ZIP EOCD 记录');
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  let offset = bytes.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== CENTRAL_HEADER_SIG) throw new Error(`central directory 第 ${index} 项签名不符`);
    const method = bytes.readUInt16LE(offset + 10);
    const dosTime = bytes.readUInt16LE(offset + 12);
    const dosDate = bytes.readUInt16LE(offset + 14);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttrs = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const path = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ path, method, dosTime, dosDate, crc32: crc, compressedSize, size, externalAttrs, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { bytes, entries };
}

/** 读取 central directory 条目列表（含固定时间戳与排序核对所需字段）。 */
export async function readZipEntries(zipPath) {
  const { entries } = await parseCentralDirectory(zipPath);
  return entries;
}

/** 读取单个条目内容（支持 store/deflate）。 */
export async function readZipEntry(zipPath, entryPath) {
  const { bytes, entries } = await parseCentralDirectory(zipPath);
  const entry = entries.find(item => item.path === entryPath);
  if (!entry) throw new Error(`ZIP 中不存在条目 ${entryPath}`);
  if (bytes.readUInt32LE(entry.localOffset) !== LOCAL_HEADER_SIG) throw new Error(`${entryPath} 本地头签名不符`);
  const nameLength = bytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const payload = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === METHOD_STORE) return Buffer.from(payload);
  if (entry.method === METHOD_DEFLATE) {
    const raw = inflateRawSync(payload);
    if (raw.length !== entry.size || (crc32(raw) >>> 0) !== entry.crc32) throw new Error(`${entryPath} 解压校验失败`);
    return raw;
  }
  throw new Error(`${entryPath} 使用不支持的压缩方法 ${entry.method}`);
}

const isUnsafePath = path => {
  if (!path || path.includes('\0')) return true;
  if (path.includes('\\')) return true;
  if (path.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(path)) return true;
  return path.split('/').some(segment => segment === '' || segment === '..' || segment === '.');
};

const isSymlinkEntry = entry => ((entry.externalAttrs >> 16) & 0o170000) === 0o120000;

/** 安全解压到目标目录；危险条目以 zip_unsafe_path / zip_unsupported_entry 拒绝。 */
export async function extractZip(zipPath, targetDir) {
  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });
  const entries = await readZipEntries(zipPath);
  const written = [];
  for (const entry of entries) {
    if (isUnsafePath(entry.path)) {
      const error = new Error(`拒绝不安全的 ZIP 条目路径：${entry.path}`);
      error.code = 'zip_unsafe_path';
      throw error;
    }
    if (isSymlinkEntry(entry)) {
      const error = new Error(`拒绝符号链接条目：${entry.path}`);
      error.code = 'zip_unsupported_entry';
      throw error;
    }
    const destination = resolve(root, ...entry.path.split('/'));
    if (relative(root, destination).startsWith('..')) {
      const error = new Error(`条目逃逸解压根：${entry.path}`);
      error.code = 'zip_unsafe_path';
      throw error;
    }
    const content = await readZipEntry(zipPath, entry.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    written.push(entry.path);
  }
  return { root, written };
}

export { isUnsafePath };
