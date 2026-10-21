// local-only 契约测试共享 fixture（LO-02 建立，LO-03 提取为独立模块）。
// 合成目标（假 exe + 合成 asar + 真实锚点切片）的构造辅助，供 local-only-patch.test.mjs
// 与 local-only-lifecycle.test.mjs 共用，避免测试文件互相 import 导致重复执行。
// 锚点切片取自 3.16.2 真实产物（探索笔记 05 的 asar-extract 实测，脱敏：仅编译产物代码，
// 不含个人路径/凭据），保证注入断言对真实包成立。
// 注意：本文件不是测试文件（*.test.mjs），只放构造辅助，不放 test()。

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
export const FUSE_SENTINEL_TEXT = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

// 真实产物锚点切片（嵌入合成 index.js，与 INJECTIONS.find 精确一致）。
// LO-03 起同时覆盖 v2 注入点（notifyAuthStateChanged / manager 引用挂接切片）。
export const FIXTURE_INDEX = Buffer.from([
  'import{helper}from"./chunk-FIXTURE.js";',
  'var Ae="https://zcode.z.ai",ff="3.16.2";',
  '$2=Et(Ae,{appVersion:ff}),sA=process.env.ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL?.trim(),iA=process.env.ZCODE_WEB_REMOTE_CONTROL_URL?.trim();',
  'async function start(h,v){let Be="",le,Mf=!1,Of,t=new Map(),ne=new AbortController().signal,e={deviceMid:"mid"},kd=async()=>{},Gn=async()=>({}),zn=async()=>{};',
  'const options={',
  'getToken:s(async ae=>{let lt=await Gn(),jo=await zn.token(lt.jwt,AbortSignal.any([ne,ae]));return await Gn(),e.logger.info("[web-remote-control] V2 device token acquired"),jo},"getToken"),',
  'resolveDeviceSid:s(async(ae,lt)=>(Be=await kd(lt,ae),t.get(h)===le&&(le.deviceSid=Be,le.qrUrl=le.connectUrl=""),Be),"resolveDeviceSid"),',
  'getLogin:s(async()=>{let e=await N2(),t=await U2(e);return t?{userId:e,jwt:t.slice(7)}:void 0},"getLogin"),',
  '};',
  'return options;',
  '}',
  'start("w","ctx");',
  // manager 侧（LO-03 v2 锚点切片）：notifyAuthStateChanged 签名行与 signed-out 撤销分支、
  // manager 构造收尾与引用挂接（源码 index.ts:1030 webRemoteControlManagerRef.current = ...）。
  // 顶层 let b2 模拟真实产物顶层已占用的压缩名：注入体若向模块顶层引入 var b2 会在此直接
  // SyntaxError（LO-03 真实运行踩坑：var b2 与产物 let b2 冲突导致 main bundle 加载失败）。
  'var w=0,p=0,m=!1,a=new Map(),t=new Map(),r=new Map(),n=new Set();',
  'let b2={fromId(e){}};',
  'var y=(X)=>{},ir=(X)=>{};',
  'var ld={disposeRemoteSession(e){}};',
  'var Ef={get(){return li}};',
  'var li=gC({getStatus(h){return{status:"idle"}},async start(h,c){return{status:"running"}},async notifyAuthStateChanged(h,v){let O=++w;if(v.state==="signed-in"){return}p+=1,m=!1;let W=new Set([h,...a.keys(),...t.keys(),...r.keys()]);for(let X of W)y(X),ir(X)},platformHandlers:{},disposeWorkspaceHostAttachmentsForRemoteSession:s(e=>ld.disposeRemoteSession(e),"disposeWorkspaceHostAttachmentsForRemoteSession")});Ef.current=li;var Sd=!1;',
  'function Le(){return[{id:1,isDestroyed(){return!1}}]}',
].join('\n') + '\n', 'utf8');

// ---------- 合成 asar（与真实 3.16.2 头格式一致：pickle 前缀 + 紧凑 JSON + 空格 pad） ----------

export function fixtureIntegrity(buffer) {
  const blocks = [];
  for (let i = 0; i < buffer.length; i += 4194304) {
    blocks.push(sha256(buffer.subarray(i, Math.min(i + 4194304, buffer.length))));
  }
  return { algorithm: 'SHA256', hash: sha256(buffer), blockSize: 4194304, blocks };
}

function buildTree(files) {
  const root = { files: {} };
  for (const file of files) {
    let node = root;
    const segments = file.path.split('/');
    for (const segment of segments.slice(0, -1)) {
      node = node.files[segment] ??= { files: {} };
    }
    const name = segments.at(-1);
    if (file.unpacked) node.files[name] = { size: file.content.length, unpacked: true, integrity: fixtureIntegrity(file.content) };
    else node.files[name] = { size: file.content.length, offset: null, integrity: fixtureIntegrity(file.content) };
  }
  return root;
}

export function buildAsarBuffer(files) {
  const root = buildTree(files);
  let cursor = 0;
  for (const file of files) {
    if (file.unpacked) continue;
    const segments = file.path.split('/');
    let node = root;
    for (const segment of segments.slice(0, -1)) node = node.files[segment];
    node.files[segments.at(-1)].offset = String(cursor);
    cursor += file.content.length;
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const paddedLen = (json.length + 3) & ~3;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(4 + 4 + paddedLen, 4);
  prefix.writeUInt32LE(4 + paddedLen, 8);
  prefix.writeUInt32LE(json.length, 12);
  const pad = Buffer.alloc(paddedLen - json.length, 0x20);
  const parts = [prefix, json, pad];
  for (const file of files) {
    if (!file.unpacked) parts.push(file.content);
  }
  return Buffer.concat(parts);
}

export function buildFakeExe({ wire = '101000011' } = {}) {
  const sentinel = Buffer.from(FUSE_SENTINEL_TEXT, 'latin1');
  return Buffer.concat([
    Buffer.from('MZ fake exe for local-only patch contract test ' + 'A'.repeat(64), 'latin1'),
    sentinel,
    Buffer.from([0x01, wire.length]),
    Buffer.from(wire, 'latin1'),
    Buffer.from([0x00]),
  ]);
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}
export { exists };

// 搭建受支持目标（合成安装目录）：假 exe（fuse DISABLE）+ 合成 asar（含真实锚点切片）。
export async function makeSupportedTarget(root, { wire = '101000011', extraFiles = [] } = {}) {
  const exePath = join(root, 'ZCode.exe');
  const asarPath = join(root, 'resources', 'app.asar');
  await mkdir(dirname(asarPath), { recursive: true });
  await writeFile(exePath, buildFakeExe({ wire }));
  const files = [
    { path: 'package.json', content: Buffer.from('{"name":"@zcode/desktop","version":"3.16.2","main":"out/main/index.js"}\n') },
    { path: 'out/main/index.js', content: FIXTURE_INDEX },
    { path: 'out/main/chunk-FIXTURE.js', content: Buffer.from('export const helper=1;\n' + randomBytes(32).toString('hex')) },
    { path: 'node_modules/node-pty/prebuilds/win32-x64/pty.dll', content: Buffer.from('unpacked-native-' + randomBytes(16).toString('hex')), unpacked: true },
    ...extraFiles,
  ];
  const asarBuffer = buildAsarBuffer(files);
  await writeFile(asarPath, asarBuffer);
  const identity = {
    exeName: 'ZCode.exe',
    exeFileVersion: '3.16.2.8769',
    appAsarRelativePath: 'resources/app.asar',
    appAsarSha256: sha256(asarBuffer),
    appAsarBytes: asarBuffer.length,
  };
  return {
    exePath,
    asarPath,
    identity,
    files,
    // 桩：真实实现会读 exe VersionInfo / 全量 asar 摘要，这里直接返回登记身份的磁盘真值。
    resolveIdentity: async () => {
      const actual = await readFile(asarPath).then(sha256);
      return { exeFileVersion: identity.exeFileVersion, appAsarSha256: actual, appAsarBytes: (await stat(asarPath)).size };
    },
  };
}

export const noProcesses = async () => [];

export function boundaries(target, { processes = noProcesses } = {}) {
  return {
    packageIdentity: target.identity,
    resolveIdentity: target.resolveIdentity,
    readProcesses: processes,
  };
}
