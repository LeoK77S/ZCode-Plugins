// local-only 补丁单一数据源（LO-02 建立，Close #145；LO-03 升级 v2，Close #146）
// 补丁版本、注入点锚点（锚定 app.asar 内 out/main/index.js 的精确字节）、
// 本档案独立维护该包的字节身份、补丁修订号与精确注入规则。新增发行包追加档案，不覆盖本档案。
//
// 锚点依据（2026-10-21 对真实 app.asar 产物的只读实测，探索笔记 05/06）：
// - 全部 find 串在 out/main/index.js（806,407 字节）中唯一命中：
//   env-override 行 @777197、getToken 回调 @406296、resolveDeviceSid 回调 @406484、getLogin 回调 @777899、
//   notifyAuthStateChanged 签名 @409101 一带（LO-03 实测）、manager 引用挂接 "Ef.current=li;" @780415
//   （对应源码 index.ts:1030 webRemoteControlManagerRef.current = webRemoteControlManager，LO-03 实测）。
// - 锚点含压缩变量名（sA/N2/U2/kd/Gn/zn/Ef/li 等）：仅对字节身份固定的包有意义；未来版本锚点失配
//   一律报 anchor_mismatch（结构变化需人工分析），不做模糊替换。
//
// 注入形态（完全短路方案，LO-02 已定）：不重定向官方 HTTP endpointOrigin，直接短路
// 登录检查（getLogin）、HTTP 设备注册（resolveDeviceSid）与取令牌（getToken），
// 本地生成 device_sid 与 22 字符形状 token，仅将 relay WS 地址（官方原生 env 覆盖入口，
// desktop/src/main/index.ts:898）指向回环网关 /ws。网关字节不改。
//
// v2 新增（LO-03，离线冷启动/重连/账号事件隔离）：
// - P5：signed-out/登出通知不撤销本地链路（notifyAuthStateChanged 入口短路；开关关闭保留原撤销语义）。
// - P6：开关开启且解析到工作区时，main 完成初始化后自动触发远控 start（解 LO-02 具名的 renderer
//   触发缺口 K9——无登录首屏 UI 不发 zcode:start-web-remote-control IPC）。以 getStatus 非 idle
//   即停保证与 renderer 手动 start 并存幂等；start 为 manager 语义上的 restart，不重复叠加。
// - P1 扩展：__LO_WS 求值（env 显式 > 标志文件首行）与网关回环校验（非回环目标忽略覆盖、保留默认）。

export const SUPPORTED_PACKAGE = Object.freeze({
  exeName: 'ZCode.exe',
  exeFileVersion: '3.16.2.8769',
  appAsarRelativePath: 'resources/app.asar',
  appAsarSha256: '1F960BA24A4A6687BB29090A9AC3273C06E9FC18B14882525F591132650A99A8',
  appAsarBytes: 341334118,
  chromiumVersion: '147.0.7727.15',
  electronVersion: null, // 静态证据链未定 Electron 精确版本；运行时提取列为未验项
});

// 补丁版本：注入内容或锚点变化时递增；candidate/状态记录均携带此版本。
// v2 = v1 五点 + P5 账号事件隔离 + P6 自动启动 + P1 回环校验/__LO_WS。
// v1→v2 升级：apply 检测到目标已是本工具旧版本补丁时自动 restore 原版后重新应用（见 patch.mjs），
// 不允许在旧注入之上静默叠加新注入。v3 对最终 WS 目标统一做 URL 回环校验。
export const PATCH_VERSION = 3;

// 主入口文件（asar 内路径）：远控启动链全部运行时逻辑内联于此单文件（05 笔记 §2）。
export const MAIN_ENTRY = 'out/main/index.js';

// ---- 运行时开关载体约定（与 P1 注入代码保持一致；改此处必须同步改渲染函数） ----
// 判定优先级：env ZCODE_LOCAL_ONLY（显式 1/0）> 数据根标志 > userData 标志 > 默认关。
// 主开关是标志文件（用户原快捷方式启动也能生效）；env 只作显式覆盖通道。
export const LOCAL_ONLY_ENV_OVERRIDE = 'ZCODE_LOCAL_ONLY';
export const LOCAL_ONLY_GATEWAY_ENV = 'ZCODE_LOCAL_ONLY_GATEWAY';
// 自动启动的工作区来源（P6 消费）：env 显式优先；否则取首个存在的标志文件首行（非空行）。
export const LOCAL_ONLY_WORKSPACE_ENV = 'ZCODE_LOCAL_ONLY_WORKSPACE';
export const LOCAL_ONLY_FLAG_PATHS = Object.freeze([
  '{dataBaseDir}/.zcode/local-only.flag', // dataBaseDir = ZCODE_DATA_BASE_DIR || HOME || USERPROFILE
  '{APPDATA}/ZCode/local-only.flag',
]);
export const LOCAL_ONLY_GATEWAY_DEFAULT_ORIGIN = 'http://127.0.0.1:17331'; // lab 默认端口，避开日常网关 17329
// 网关 WS 端点为 /ws（gateway.mjs upgrade 分流），不是官方 /api/v1/remote/ws2。
export const LOCAL_ONLY_GATEWAY_WS_PATH = '/ws';

// ---- 注入点定义 ----
// 每个注入点：id（对外报告）、kind（prepend：文件首部；replace：字节串替换）、
// find（唯一命中的精确字节串）/ replacement（完整替换文本）、semantic（人工核对新版本用）。

// P0：文件首行插入自包含命名 import（注入代码需要同步 existsSync/readFileSync 读标志文件）。
const P0_IMPORT = 'import{existsSync as __loExists,readFileSync as __loRead}from"node:fs";\n';

// P1 注入体：开关判定 + 工作区解析 + 回环校验的 relay WS 覆盖 + 本地 token 生成器（语句序列）。
// 插入位置在 sA/iA 所在 var 语句**结束之后**（锚点以分号收尾），下一条语句之前——
// 在逗号/var 表达式中间插语句是语法错误（契约测试以 node --check 守住）。
// 语义：sA（relayWsUrl 覆盖值，desktop index.ts:898 顶层求值）在 var 语句内已求值；
// 门控语句在其后直接重新赋值 sA。manager 构造（li=gC）与 getEndpointUrls 回调都以闭包
// 引用 sA 绑定，运行期读到新值；resolveWebRemoteControlRelayWsUrl 对 overrideUrl 整体直用
// （zcodeEndpoint.ts，无协议校验），因此 ws://127.0.0.1:port/ws 直接生效。
// 开关关闭时保留原覆盖值；开启时两个 env 入口都只接受实际主机为回环的 HTTP/WS URL。
// 已有回环 WS 覆盖优先；非回环、凭据伪装或无效 URL 忽略，最终使用回环网关。
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
    // __LO_WS：自动启动工作区（P6 消费）。env 显式优先；否则取首个存在的标志文件首行（非空）。
    // 整体收在 IIFE 内：内部变量（e/b/c/t/i）不提升到模块顶层——产物顶层已占用大量压缩名
    // （真实运行曾因 var b2 与产物顶层 let b2 冲突导致 SyntaxError，见 LO-03 原生验证）。
    'var __LO_WS=(function(){',
    'if(!__LO_MODE)return "";',
    `try{var e=(process.env.${LOCAL_ONLY_WORKSPACE_ENV}||"").trim();if(e)return e}catch(x){}`,
    'try{',
    'var c=[];var b=(process.env.ZCODE_DATA_BASE_DIR||process.env.HOME||process.env.USERPROFILE||"").trim();',
    'if(b)c.push(b.replace(/[\\/\\\\]+$/,"")+"/.zcode/local-only.flag");',
    'if(process.env.APPDATA)c.push(process.env.APPDATA+"/ZCode/local-only.flag");',
    'for(var i=0;i<c.length;i++){try{var t=__loRead(c[i],"utf8").split(/\\r?\\n/)[0].trim();if(t)return t}catch(x){}}',
    '}catch(x){}return "";})();',
    // URL 是外部环境输入；只捕获解析错误。内部变量全部保留在 IIFE 中。
    'if(__LO_MODE)sA=(function(){',
    'var local=function(v,p){var u;try{u=new URL(v)}catch(e){return null}',
    'var h=u.hostname;return p.indexOf(u.protocol)>=0&&!u.username&&!u.password&&(h==="localhost"||h==="[::1]"||/^127(?:\\.[0-9]{1,3}){3}$/.test(h))?u:null};',
    'var w=local(sA,["ws:","wss:"]);if(w)return w.href;',
    `var g=local(${gatewayExpression},["http:","https:"])||new URL(${JSON.stringify(LOCAL_ONLY_GATEWAY_DEFAULT_ORIGIN)});`,
    `g.protocol=g.protocol==="https:"?"wss:":"ws:";g.pathname="${LOCAL_ONLY_GATEWAY_WS_PATH}";g.search="";g.hash="";return g.href})();`,
    'var __LO_TOKEN=function(){var a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",s="";',
    'for(var i=0;i<21;i++)s+=a.charAt(Math.floor(Math.random()*a.length));return s+"A"};',
  ].join('');
}

// P6 注入体：自动启动。imports 为顶层 electron 自包含命名 import（不依赖产物压缩变量）；
// body 为可独立在 vm 沙箱验证的语句序列，插入在 manager 引用挂接（Ef.current=li;）之后。
// 语义：开关开启且解析到工作区时，2s 后轮询（2s 间隔、上限 150 次约 5 分钟）：
// - app 未 ready / 无应用窗口 → 重试；有窗口取 Le()（官方 getApplicationWindowsExcludingCuaIndicator，
//   排除 CUA 指示窗）首个窗口，Le 不可用时（结构变化防御）回退 BrowserWindow.getAllWindows 过滤已销毁；
// - getStatus 非 idle（starting/running/active/auth-required）→ 停止（renderer 手动 start 并存幂等；
//   manager.start 本身是 restart 语义，不重复叠加 runtime）；
// - idle → li.start(windowId, {workspacePath:__LO_WS})，失败按同间隔重试至上限。
export function renderP6AutoStartCode() {
  return {
    imports: 'import{app as __loApp,BrowserWindow as __loBW}from"electron";',
    body: [
      'if(__LO_MODE&&__LO_WS){(function(){',
      'var n=0,t=function(){try{',
      'if(!__loApp.isReady()){if(++n>150)return;return setTimeout(t,2e3)}',
      'var w=typeof Le==="function"?Le():__loBW.getAllWindows().filter(function(x){try{return!x.isDestroyed()}catch(e){return!1}});',
      'if(!w.length){if(++n>150)return;return setTimeout(t,2e3)}',
      'var s=li.getStatus(w[0].id);',
      'if(s&&s.status!=="idle")return;',
      'Promise.resolve(li.start(w[0].id,{workspacePath:__LO_WS})).then(function(){},function(x){if(++n>150)return;setTimeout(t,2e3)})',
      '}catch(x){if(++n>150)return;setTimeout(t,2e3)}};',
      'setTimeout(t,2e3)})()}',
    ].join(''),
  };
}

// 从真实产物（asar-extract 实测）提取的锚点字节串。唯一性已逐一验证（各命中 1 次）。
// env-override 锚点以分号收尾（var 语句边界），其后紧跟 function TA(e)（语句边界插入的前提）。
const ANCHOR_ENV_OVERRIDE = 'sA=process.env.ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL?.trim(),iA=process.env.ZCODE_WEB_REMOTE_CONTROL_URL?.trim();';
const ANCHOR_GET_LOGIN = 'getLogin:s(async()=>{let e=await N2(),t=await U2(e);return t?{userId:e,jwt:t.slice(7)}:void 0},"getLogin")';
const ANCHOR_GET_TOKEN = 'getToken:s(async ae=>{let lt=await Gn(),jo=await zn.token(lt.jwt,AbortSignal.any([ne,ae]));return await Gn(),e.logger.info("[web-remote-control] V2 device token acquired"),jo},"getToken")';
const ANCHOR_RESOLVE_SID = 'resolveDeviceSid:s(async(ae,lt)=>(Be=await kd(lt,ae),t.get(h)===le&&(le.deviceSid=Be,le.qrUrl=le.connectUrl=""),Be),"resolveDeviceSid")';
// notifyAuthStateChanged 签名行（@409101 一带，05 笔记 C4）：signed-in 分支在 if 内，
// 其后（signed-out/登出）分支对所有窗口撤销并 requireAuthentication。
const ANCHOR_NOTIFY_AUTH = 'async notifyAuthStateChanged(h,v){let O=++w;if(v.state==="signed-in"){';
// manager 引用挂接（源码 index.ts:1030）：manager 构造收尾（platformHandlers 最后一项）+ 引用挂接，
// 唯一稳定的顶层语句边界；含压缩名（ld/Ef/li），仅对字节身份固定的包有效。
const ANCHOR_MANAGER_REF = 'disposeWorkspaceHostAttachmentsForRemoteSession:s(e=>ld.disposeRemoteSession(e),"disposeWorkspaceHostAttachmentsForRemoteSession")});Ef.current=li;';

// P1 替换文本：锚点语句（原样保留）之后追加门控语句序列。
function p1Replacement() {
  return ANCHOR_ENV_OVERRIDE + renderP1GateCode();
}

// P6 替换文本：锚点语句（原样保留）之后追加 electron import（ESM 顶层提升，位置合法）
// 与自动启动体。
function p6Replacement() {
  const { imports, body } = renderP6AutoStartCode();
  return ANCHOR_MANAGER_REF + imports + body;
}

export const INJECTIONS = Object.freeze([
  Object.freeze({
    id: 'P0-fs-import',
    kind: 'prepend',
    replacement: P0_IMPORT,
    semantic: '文件首行插入 node:fs existsSync/readFileSync 自包含命名 import（标志文件存在性与首行读取）',
  }),
  Object.freeze({
    id: 'P1-mode-gate',
    kind: 'replace',
    find: ANCHOR_ENV_OVERRIDE,
    replacement: p1Replacement(),
    semantic: 'sA/iA 所在 var 语句结束后：开关判定（env/标志文件）→ __LO_WS 解析（env>标志首行）→ 回环校验后 sA 改写为回环网关 WS → 本地 token 生成器',
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
  Object.freeze({
    id: 'P5-signed-out-isolation',
    kind: 'replace',
    find: ANCHOR_NOTIFY_AUTH,
    replacement: `async notifyAuthStateChanged(h,v){if(__LO_MODE&&v&&v.state!=="signed-in")return;${ANCHOR_NOTIFY_AUTH.slice('async notifyAuthStateChanged(h,v){'.length)}`,
    semantic: 'signed-out/登出通知短路：本地模式直接返回，不撤销任何窗口的本地链路（05 C4 @409101）；开关关闭保留原撤销语义',
  }),
  Object.freeze({
    id: 'P6-auto-start',
    kind: 'replace',
    find: ANCHOR_MANAGER_REF,
    replacement: p6Replacement(),
    semantic: 'manager 引用挂接后注入自动启动：开关开启且解析到工作区时轮询触发 li.start（解 renderer 触发缺口 K9）；getStatus 非 idle 即停（幂等），失败重试上限 150 次',
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
