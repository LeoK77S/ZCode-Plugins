// local-only 补丁单一数据源（LO-02，Close #145）
// 补丁版本、注入点锚点（锚定 app.asar 内 out/main/index.js 的精确字节）、
// 开关载体约定、备份/状态文件名与失败退出码。包身份复用 lab-env 的 SUPPORTED_PACKAGE
// （单包固定字节身份），不另立身份源；适配新包须先在 lab-env 登记，再按产物实测锚点扩展。
//
// 锚点依据（2026-10-21 对真实 app.asar 产物的只读实测，探索笔记 05/06）：
// - 全部 find 串在 out/main/index.js（806,407 字节）中唯一命中：
//   env-override 行 @777197、getToken 回调 @406296、resolveDeviceSid 回调 @406484、getLogin 回调 @777899。
// - 锚点含压缩变量名（sA/N2/U2/kd/Gn/zn 等）：仅对字节身份固定的包有意义；未来版本锚点失配
//   一律报 anchor_mismatch（结构变化需人工分析），不做模糊替换。
//
// 注入形态（完全短路方案，已定决策）：不重定向官方 HTTP endpointOrigin，直接短路
// 登录检查（getLogin）、HTTP 设备注册（resolveDeviceSid）与取令牌（getToken），
// 本地生成 device_sid 与 22 字符形状 token，仅将 relay WS 地址（官方原生 env 覆盖入口，
// desktop/src/main/index.ts:898）指向回环网关 /ws。网关字节不改。

import { SUPPORTED_PACKAGE } from './lab-env.mjs';

export { SUPPORTED_PACKAGE };

// 补丁版本：注入内容或锚点变化时递增；candidate/状态记录均携带此版本。
export const PATCH_VERSION = 1;

// 主入口文件（asar 内路径）：远控启动链全部运行时逻辑内联于此单文件（05 笔记 §2）。
export const MAIN_ENTRY = 'out/main/index.js';

// ---- 运行时开关载体约定（与 P1 注入代码保持一致；改此处必须同步改渲染函数） ----
// 判定优先级：env ZCODE_LOCAL_ONLY（显式 1/0）> 数据根标志 > userData 标志 > 默认关。
// 主开关是标志文件（用户原快捷方式启动也能生效）；env 只作显式覆盖通道。
export const LOCAL_ONLY_ENV_OVERRIDE = 'ZCODE_LOCAL_ONLY';
export const LOCAL_ONLY_GATEWAY_ENV = 'ZCODE_LOCAL_ONLY_GATEWAY';
export const LOCAL_ONLY_FLAG_PATHS = Object.freeze([
  '{dataBaseDir}/.zcode/local-only.flag', // dataBaseDir = ZCODE_DATA_BASE_DIR || HOME || USERPROFILE
  '{APPDATA}/ZCode/local-only.flag',
]);
export const LOCAL_ONLY_GATEWAY_DEFAULT_ORIGIN = 'http://127.0.0.1:17331'; // lab 默认端口，避开日常网关 17329
// 网关 WS 端点为 /ws（gateway.mjs upgrade 分流），不是官方 /api/v1/remote/ws2。
export const LOCAL_ONLY_GATEWAY_WS_PATH = '/ws';

// 备份与状态文件（位于安装目录 resources/ 内，与 app.asar 同目录）。
export const BACKUP_SUFFIX = '.lo02bak';
export const STATE_SUFFIX = '.lo02state.json';

// ---- 失败退出码（票面要求的明确分类；status 输出与 apply/restore 失败一一对应） ----
export const EXIT_CODES = Object.freeze({
  ok: 0,
  internal: 1,
  usage: 2,
  unsupported_package: 10,
  digest_mismatch: 11,
  running_instance: 12,
  backup_missing: 13,
  write_failed: 14,
  fuse_validation_enabled: 15,
  anchor_mismatch: 16,
});

// ---- 注入点定义 ----
// 每个注入点：id（对外报告）、kind（prepend：文件首部；replace：字节串替换）、
// find（唯一命中的精确字节串）/ replacement（完整替换文本）、semantic（人工核对新版本用）。
// LO-03 扩展位：登出/账号通知短路（notifyAuthStateChanged，产物锚点
// "auth-identity-changed" @409101 一带）按同结构追加 { id: 'P5-...' } 即可，
// 本票（LO-02）不注入该点。

// P0：文件首行插入自包含命名 import（注入代码需要同步 existsSync 读标志文件）。
const P0_IMPORT = 'import{existsSync as __loExists}from"node:fs";\n';

// P1 注入体：开关判定 + relay WS 覆盖 + 本地 token 生成器（语句序列，以 ; 结尾）。
// 插入位置在 sA/iA 所在 var 语句**结束之后**（锚点以分号收尾），下一条语句之前——
// 在逗号/var 表达式中间插语句是语法错误（契约测试以 node --check 守住）。
// 语义：sA（relayWsUrl 覆盖值，desktop index.ts:898 顶层求值）在 var 语句内已求值；
// 门控语句在其后直接重新赋值 sA。manager 构造（li=gC）与 getEndpointUrls 回调都以闭包
// 引用 sA 绑定，运行期读到新值；resolveWebRemoteControlRelayWsUrl 对 overrideUrl 整体直用
// （zcodeEndpoint.ts，无协议校验），因此 ws://127.0.0.1:port/ws 直接生效。
// 开关关闭（无标志、无 env）时零行为变化；开关开启且 sA 未被外部 env 设置时才改写，
// 外部显式值优先（lab 或用户可用官方 env 覆盖网关地址）。
export function renderP1GateCode() {
  const gatewayExpression = `(process.env.${LOCAL_ONLY_GATEWAY_ENV}||${JSON.stringify(LOCAL_ONLY_GATEWAY_DEFAULT_ORIGIN)}).trim()`;
  return [
    'var __LO_MODE=(function(){try{',
    `if(process.env.${LOCAL_ONLY_ENV_OVERRIDE}==="1")return true;`,
    `if(process.env.${LOCAL_ONLY_ENV_OVERRIDE}==="0")return false;`,
    'var c=[];var b=(process.env.ZCODE_DATA_BASE_DIR||process.env.HOME||process.env.USERPROFILE||"").trim();',
    'if(b)c.push(b.replace(/[\\/\\\\]+$/,"")+"/.zcode/local-only.flag");',
    'if(process.env.APPDATA)c.push(process.env.APPDATA+"/ZCode/local-only.flag");',
    'for(var i=0;i<c.length;i++){try{if(__loExists(c[i]))return true}catch(x){}}',
    '}catch(x){}return false})();',
    'if(__LO_MODE&&!sA){',
    `var __loGw=${gatewayExpression};`,
    `sA=__loGw.replace(/^http/,"ws")+"${LOCAL_ONLY_GATEWAY_WS_PATH}";}`,
    'var __LO_TOKEN=function(){var a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",s="";',
    'for(var i=0;i<21;i++)s+=a.charAt(Math.floor(Math.random()*a.length));return s+"A"};',
  ].join('');
}

// 从真实产物（asar-extract 实测）提取的锚点字节串。唯一性已逐一验证（各命中 1 次）。
// env-override 锚点以分号收尾（var 语句边界），其后紧跟 function TA(e)（语句边界插入的前提）。
const ANCHOR_ENV_OVERRIDE = 'sA=process.env.ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL?.trim(),iA=process.env.ZCODE_WEB_REMOTE_CONTROL_URL?.trim();';
const ANCHOR_GET_LOGIN = 'getLogin:s(async()=>{let e=await N2(),t=await U2(e);return t?{userId:e,jwt:t.slice(7)}:void 0},"getLogin")';
const ANCHOR_GET_TOKEN = 'getToken:s(async ae=>{let lt=await Gn(),jo=await zn.token(lt.jwt,AbortSignal.any([ne,ae]));return await Gn(),e.logger.info("[web-remote-control] V2 device token acquired"),jo},"getToken")';
const ANCHOR_RESOLVE_SID = 'resolveDeviceSid:s(async(ae,lt)=>(Be=await kd(lt,ae),t.get(h)===le&&(le.deviceSid=Be,le.qrUrl=le.connectUrl=""),Be),"resolveDeviceSid")';

// P1 替换文本：锚点语句（原样保留）之后追加门控语句序列。
function p1Replacement() {
  return ANCHOR_ENV_OVERRIDE + renderP1GateCode();
}

export const INJECTIONS = Object.freeze([
  Object.freeze({
    id: 'P0-fs-import',
    kind: 'prepend',
    replacement: P0_IMPORT,
    semantic: '文件首行插入 node:fs existsSync 自包含命名 import（标志文件同步读取）',
  }),
  Object.freeze({
    id: 'P1-mode-gate',
    kind: 'replace',
    find: ANCHOR_ENV_OVERRIDE,
    replacement: p1Replacement(),
    semantic: 'sA/iA 所在 var 语句结束后：开关判定（env/标志文件）→ sA 改写为回环网关 WS → 本地 token 生成器',
  }),
  Object.freeze({
    id: 'P2-login-short-circuit',
    kind: 'replace',
    find: ANCHOR_GET_LOGIN,
    replacement: `getLogin:s(async()=>{if(__LO_MODE)return{userId:"local-only-device",jwt:"local-only"};${ANCHOR_GET_LOGIN.slice('getLogin:s(async()=>{'.length)}`,
    semantic: 'getLogin 回调短路：本地模式返回固定凭据，放行 manager start 的登录检查与续检（05 C1/C3）',
  }),
  Object.freeze({
    id: 'P3-device-sid-short-circuit',
    kind: 'replace',
    find: ANCHOR_RESOLVE_SID,
    replacement: `resolveDeviceSid:s(async(ae,lt)=>__LO_MODE?"local-only-device":${ANCHOR_RESOLVE_SID.slice('resolveDeviceSid:s(async(ae,lt)=>'.length)}`,
    semantic: 'resolveDeviceSid 回调短路：本地模式返回常量 device_sid，跳过 HTTP 设备注册（POST /api/v1/remote/device，05 C2）',
  }),
  Object.freeze({
    id: 'P4-token-short-circuit',
    kind: 'replace',
    find: ANCHOR_GET_TOKEN,
    replacement: `getToken:s(async ae=>{if(__LO_MODE)return __LO_TOKEN();${ANCHOR_GET_TOKEN.slice('getToken:s(async ae=>{'.length)}`,
    semantic: 'getToken 回调短路：本地模式返回 22 字符形状 token，跳过 HTTP 取令牌（POST /api/v1/remote/token，05 C2）',
  }),
]);

// 对 index.js 应用全部注入；返回 { content, applied }。
// 全部锚点必须唯一命中，任一失配/多重命中即抛错（anchor_mismatch），不写半成品。
export function applyInjections(source) {
  if (typeof source !== 'string') throw new Error('index.js 内容必须是字符串');
  if (source.includes('__LO_MODE')) {
    throw new Error('index.js 已含注入标记 __LO_MODE（疑似已应用补丁）');
  }
  let content = source;
  const applied = [];
  for (const injection of INJECTIONS) {
    if (injection.kind === 'prepend') {
      content = injection.replacement + content;
      applied.push({ id: injection.id, bytesAdded: Buffer.byteLength(injection.replacement, 'utf8') });
      continue;
    }
    const find = injection.find;
    const first = content.indexOf(find);
    if (first === -1) {
      throw new Error(`锚点 ${injection.id} 未命中（结构变化，需人工分析）：${find.slice(0, 60)}...`);
    }
    if (content.indexOf(find, first + 1) !== -1) {
      throw new Error(`锚点 ${injection.id} 命中多次（结构变化，需人工分析）`);
    }
    content = content.slice(0, first) + injection.replacement + content.slice(first + find.length);
    applied.push({
      id: injection.id,
      anchorOffset: first,
      bytesAdded: Buffer.byteLength(injection.replacement, 'utf8') - Buffer.byteLength(find, 'utf8'),
    });
  }
  return { content, applied };
}
