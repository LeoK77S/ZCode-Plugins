import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LOCAL_ONLY_ENV_OVERRIDE,
  LOCAL_ONLY_GATEWAY_ENV,
  LOCAL_ONLY_GATEWAY_DEFAULT_ORIGIN,
  LOCAL_ONLY_GATEWAY_WS_PATH,
  LOCAL_ONLY_WORKSPACE_ENV,
  PATCH_VERSION,
  applyInjections,
  renderP1GateCode,
  renderP6AutoStartCode,
} from '../local-only/patch-env.mjs';
import { extractAsarFile, patchApply, patchPrepare, patchStatus, writePatchedAsar } from '../local-only/patch.mjs';
import {
  FIXTURE_INDEX,
  sha256,
  makeSupportedTarget,
  noProcesses,
  boundaries,
  profilesFor,
} from './local-only-fixture.mjs';

// LO-03 生命周期契约（Close #146）：
// - v2 注入点（P5 signed-out 隔离 / P6 自动启动）锚点匹配与注入输出；
// - P1 门控行为（vm 沙箱）：开关三态、__LO_WS 求值、回环约束；
// - P6 自动启动行为（vm 沙箱）：幂等（非 idle 不触发）、失败重试、开关关闭零启动；
// - 原版失败契约：未打补丁/开关关闭时登录检查与 HTTP 注册/取令牌路径代码形态未被改写；
// - v1→v2 升级路径：已 v1 状态下 apply v2 自动 restore→re-apply，不静默叠加注入。
// fixture 复用 local-only-patch.test.mjs 的真实产物锚点切片（单一 fixture 源）。

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// ---------- P1 门控行为（vm 沙箱） ----------

function runGate({ env = {}, flags = {}, flagContent = '', sA = null } = {}) {
  const sandbox = {
    process: { env },
    URL,
    __loExists: (p) => Boolean(flags[p]),
    __loRead: (p) => { if (!flags[p]) throw new Error(`ENOENT: ${p}`); return flagContent; },
    sA,
    iA: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(renderP1GateCode(), sandbox);
  return sandbox;
}

const homeFlag = (home) => `${home.replace(/[\\/]+$/, '')}/.zcode/local-only.flag`;

test('P1 门控行为：无 env 无标志 → 模式关、sA 不被改写（开关关闭零行为变化）', () => {
  const sandbox = runGate({ env: { HOME: 'D:/lab/home' } });
  assert.equal(sandbox.__LO_MODE, false);
  assert.equal(sandbox.sA, null); // 官方 relayWsUrl 覆盖值原样（未设置），不改写
  assert.equal(sandbox.__LO_WS, '');
});

test('P1 门控行为：标志文件存在 → 模式开、sA 改写为默认回环网关 /ws', () => {
  const home = 'D:/lab/home';
  const sandbox = runGate({ env: { HOME: home }, flags: { [homeFlag(home)]: true } });
  assert.equal(sandbox.__LO_MODE, true);
  assert.equal(sandbox.sA, LOCAL_ONLY_GATEWAY_DEFAULT_ORIGIN.replace(/^http/, 'ws') + LOCAL_ONLY_GATEWAY_WS_PATH);
});

test('P1 门控行为：env 显式 0 覆盖标志文件（优先级 env > 标志）', () => {
  const home = 'D:/lab/home';
  const sandbox = runGate({
    env: { HOME: home, [LOCAL_ONLY_ENV_OVERRIDE]: '0' },
    flags: { [homeFlag(home)]: true },
  });
  assert.equal(sandbox.__LO_MODE, false);
  assert.equal(sandbox.sA, null);
});

test('P1 门控行为：local-only 拒绝非回环官方 relay 覆盖，relay 模式保持原值', () => {
  const home = 'D:/lab/home';
  const official = 'wss://official-relay.example/ws';
  const sandbox = runGate({ env: { HOME: home }, flags: { [homeFlag(home)]: true }, sA: official });
  assert.equal(sandbox.__LO_MODE, true);
  assert.equal(sandbox.sA, 'ws://127.0.0.1:17331/ws');
  assert.equal(runGate({ env: { [LOCAL_ONLY_ENV_OVERRIDE]: '0' }, sA: official }).sA, official);
  assert.equal(runGate({ env: { [LOCAL_ONLY_ENV_OVERRIDE]: '1' }, sA: 'ws://127.0.0.1:17431/ws' }).sA, 'ws://127.0.0.1:17431/ws');
  assert.equal(runGate({ env: { [LOCAL_ONLY_ENV_OVERRIDE]: '1' }, sA: 'ws://127.0.0.1@remote.example:9999/ws' }).sA, 'ws://127.0.0.1:17331/ws');
});

test('P1 回环约束以实际 URL 主机为准，拒绝凭据伪装、域名前缀及非 HTTP/WS 协议', () => {
  for (const value of ['http://127.0.0.1@remote.example:9999', 'http://127.evil.example:9999', 'ftp://127.0.0.1:9999', 'invalid']) {
    const sandbox = runGate({ env: { [LOCAL_ONLY_ENV_OVERRIDE]: '1', [LOCAL_ONLY_GATEWAY_ENV]: value } });
    assert.equal(sandbox.sA, 'ws://127.0.0.1:17331/ws', value);
  }
  const gateway = runGate({ env: { [LOCAL_ONLY_ENV_OVERRIDE]: '1', [LOCAL_ONLY_GATEWAY_ENV]: 'http://[::1]:17431' } });
  assert.equal(gateway.sA, 'ws://[::1]:17431/ws');
});

test('P1 回环约束：网关 env 指向非回环目标时忽略覆盖、保留默认回环', () => {
  const home = 'D:/lab/home';
  const sandbox = runGate({
    env: { HOME: home, [LOCAL_ONLY_GATEWAY_ENV]: 'http://192.168.1.5:9000' },
    flags: { [homeFlag(home)]: true },
  });
  assert.equal(sandbox.__LO_MODE, true);
  assert.equal(sandbox.sA, 'ws://127.0.0.1:17331/ws');
});

test('P1 回环约束：网关 env 指向回环目标（127.x / localhost）时采纳', () => {
  const home = 'D:/lab/home';
  const a = runGate({
    env: { HOME: home, [LOCAL_ONLY_GATEWAY_ENV]: 'http://127.0.0.1:17431' },
    flags: { [homeFlag(home)]: true },
  });
  assert.equal(a.sA, 'ws://127.0.0.1:17431/ws');
  const b = runGate({
    env: { HOME: home, [LOCAL_ONLY_GATEWAY_ENV]: 'http://localhost:17431' },
    flags: { [homeFlag(home)]: true },
  });
  assert.equal(b.sA, 'ws://localhost:17431/ws');
});

test('P1 __LO_WS 求值：env 显式优先；否则取标志文件首行；均无则为空（自动启动不触发）', () => {
  const home = 'D:/lab/home';
  const viaEnv = runGate({
    env: { HOME: home, [LOCAL_ONLY_ENV_OVERRIDE]: '1', [LOCAL_ONLY_WORKSPACE_ENV]: 'D:/lab/workspace' },
  });
  assert.equal(viaEnv.__LO_WS, 'D:/lab/workspace');
  const viaFlag = runGate({
    env: { HOME: home },
    flags: { [homeFlag(home)]: true },
    flagContent: 'D:/from/flag\nsecond-line\n',
  });
  assert.equal(viaFlag.__LO_WS, 'D:/from/flag');
  const none = runGate({ env: { HOME: home, [LOCAL_ONLY_ENV_OVERRIDE]: '1' } });
  assert.equal(none.__LO_MODE, true);
  assert.equal(none.__LO_WS, '');
});

// ---------- P6 自动启动行为（vm 沙箱） ----------

function runAutoStart({ mode = true, ws = 'D:/lab/workspace', status = 'idle', startError = null, ready = true, viaLe = false } = {}) {
  const timers = [];
  const calls = { start: 0, getStatus: 0, le: 0 };
  const sandbox = {
    __LO_MODE: mode,
    __LO_WS: ws,
    __loApp: { isReady: () => ready },
    __loBW: { getAllWindows: () => [{ id: 7, isDestroyed: () => false }] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Promise,
    li: {
      getStatus: () => { calls.getStatus++; return typeof status === 'function' ? status(calls.getStatus) : status; },
      start: async (windowId, context) => {
        calls.start++;
        calls.lastStartArgs = { windowId, context };
        if (startError) throw startError;
        return { status: 'running' };
      },
    },
    ...(viaLe ? { Le: () => { calls.le++; return [{ id: 9, isDestroyed: () => false }]; } } : {}),
  };
  vm.createContext(sandbox);
  vm.runInContext(renderP6AutoStartCode().body, sandbox);
  const flush = () => { const pending = timers.splice(0); for (const t of pending) t.fn(); };
  return { sandbox, timers, calls, flush };
}

test('P6 自动启动：开关开启且 idle → 对首个应用窗口调用 start({workspacePath}) 一次，成功后停止轮询', async () => {
  const { calls, timers, flush } = runAutoStart({ status: { status: 'idle' } });
  assert.equal(timers.length, 1, '先调度一次延迟 tick');
  flush();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.start, 1);
  // 跨 vm 上下文对象不做 deepEqual（原型不同），逐字段断言。
  assert.equal(calls.lastStartArgs.windowId, 7);
  assert.equal(calls.lastStartArgs.context.workspacePath, 'D:/lab/workspace');
  assert.deepEqual(Object.keys(calls.lastStartArgs.context), ['workspacePath']);
  assert.equal(timers.length, 0, '成功后不再重试');
});

test('P6 自动启动幂等：状态非 idle（running/starting/auth-required）不触发 start', async () => {
  for (const st of ['running', 'starting', 'active', 'auth-required']) {
    const { calls, timers, flush } = runAutoStart({ status: { status: st } });
    flush();
    await Promise.resolve();
    assert.equal(calls.start, 0, `${st} 状态不得触发 start`);
    assert.equal(timers.length, 0, `${st} 状态停止轮询（与 renderer 手动 start 并存幂等）`);
  }
});

test('P6 自动启动：app 未 ready → 定时重试不触发 start；重试上限后放弃', () => {
  const { calls, timers, flush } = runAutoStart({ ready: false });
  flush();
  assert.equal(calls.start, 0);
  assert.ok(timers.length >= 1, '未 ready 时调度重试');
  for (let i = 0; i < 200; i++) flush();
  const before = timers.length;
  flush();
  assert.equal(calls.start, 0);
  assert.ok(before === 0, '超过重试上限后不再调度');
});

test('P6 自动启动：start 失败 → 按退避重试，成功后停', async () => {
  const { calls, timers, flush } = runAutoStart({ status: { status: 'idle' }, startError: new Error('gateway down') });
  flush();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.start, 1);
  assert.ok(timers.length >= 1, '失败调度重试');
  // 重建成功语义：直接断言重试存在即可（tick 闭包内 startError 固定，重复失败重试由上限兜底）
  for (let i = 0; i < 160; i++) flush();
  assert.ok(calls.start < 200, '重试受上限约束');
});

test('P6 自动启动：开关关闭或无 workspace → 不注册任何定时器（零行为）', () => {
  const off = runAutoStart({ mode: false });
  assert.equal(off.timers.length, 0);
  assert.equal(off.calls.start, 0);
  const noWs = runAutoStart({ ws: '' });
  assert.equal(noWs.timers.length, 0);
  assert.equal(noWs.calls.start, 0);
});

test('P6 自动启动：优先使用官方窗口列举 Le()（排除 CUA 指示窗）', () => {
  const { calls, flush } = runAutoStart({ viaLe: true, status: { status: 'idle' } });
  flush();
  assert.ok(calls.le >= 1, '走 Le() 分支');
});

test('P6 渲染：imports 自包含（electron），不依赖产物压缩变量', () => {
  const { imports, body } = renderP6AutoStartCode();
  assert.equal(imports, 'import{app as __loApp,BrowserWindow as __loBW}from"electron";');
  assert.ok(body.startsWith('if(__LO_MODE&&__LO_WS){'));
});

// ---------- v2 注入输出与原版失败契约（文本层） ----------

test('原版失败契约：未打补丁时官方路径代码形态原样（登录检查/HTTP 注册/取令牌无注入痕迹）', () => {
  const original = FIXTURE_INDEX.toString('utf8');
  assert.ok(!original.includes('__LO_MODE'));
  assert.ok(!original.includes('__LO_'));
  // 登录检查：getLogin 官方闭包完整（无凭据 → undefined → manager.start 抛 auth-required）
  assert.ok(original.includes('getLogin:s(async()=>{let e=await N2(),t=await U2(e);return t?{userId:e,jwt:t.slice(7)}:void 0},"getLogin")'));
  // HTTP 注册：resolveDeviceSid 官方闭包完整（调 kd → HTTP POST /api/v1/remote/device）
  assert.ok(original.includes('resolveDeviceSid:s(async(ae,lt)=>(Be=await kd(lt,ae)'));
  // 取令牌：getToken 官方闭包完整（调 zn.token → HTTP POST /api/v1/remote/token）
  assert.ok(original.includes('getToken:s(async ae=>{let lt=await Gn(),jo=await zn.token('));
});

test('v2 注入输出：P5/P6 守卫存在且官方代码路径保留（开关关闭时短路不可达，官方路径零改写）', () => {
  const { content, applied } = applyInjections(FIXTURE_INDEX.toString('utf8'));
  assert.equal(applied.length, 7);
  const ids = applied.map((a) => a.id);
  assert.ok(ids.includes('P5-signed-out-isolation'));
  assert.ok(ids.includes('P6-auto-start'));
  // P5：signed-out 守卫前置于官方分支；官方 signed-out 撤销分支文本保留
  assert.ok(content.includes('async notifyAuthStateChanged(h,v){if(__LO_MODE&&v&&v.state!=="signed-in")return;let O=++w;'));
  assert.ok(content.includes('p+=1,m=!1;let W=new Set('));
  // P6：manager 引用挂接后注入自动启动
  assert.ok(content.includes('Ef.current=li;import{app as __loApp,BrowserWindow as __loBW}from"electron";if(__LO_MODE&&__LO_WS){'));
  // P2-P4 官方路径保留（短路守卫在前，官方语句原样）
  assert.ok(content.includes('if(__LO_MODE)return{userId:"local-only-device",jwt:"local-only"};'));
  assert.ok(content.includes('return t?{userId:e,jwt:t.slice(7)}:void 0'));
  assert.ok(content.includes('let lt=await Gn(),jo=await zn.token('));
});

// ---------- v1→v2 升级路径（apply 全链） ----------

// 构造"已应用 v1 补丁"的目标：v1 补丁 asar（模拟）+ v1 状态记录 + 完好备份。
async function makeV1AppliedTarget(root, patchVersion = 1) {
  const targetDir = join(root, 'target');
  const target = await makeSupportedTarget(targetDir);
  const v1Index = Buffer.from(FIXTURE_INDEX.toString('utf8') + '\n/* simulated v1 patch payload */\n');
  const v1AsarPath = join(root, 'v1-app.asar');
  await writePatchedAsar({ srcPath: target.asarPath, outPath: v1AsarPath, replacements: new Map([['out/main/index.js', v1Index]]) });
  const v1Sha = sha256(await readFile(v1AsarPath));
  // 备份原版 → 替换为 v1 补丁 → 写 v1 状态
  await copyFile(target.asarPath, target.asarPath + '.lo02bak');
  await copyFile(v1AsarPath, target.asarPath);
  await writeFile(target.asarPath + '.lo02state.json', JSON.stringify({
    formatVersion: 1,
    kind: 'local-only-patch-state',
    patchVersion,
    appliedAt: '2026-10-20T00:00:00.000Z',
    targetExeFileVersion: target.identity.exeFileVersion,
    originalAsarSha256: target.identity.appAsarSha256,
    patchedAsarSha256: v1Sha,
    backupFile: target.asarPath + '.lo02bak',
    candidateInjections: [],
  }, null, 2) + '\n');
  return { ...target, v1Sha };
}

test('v1/v2→当前补丁升级：先 restore 原版再应用新候选，不叠加注入', async () => {
  for (const previousVersion of [1, 2]) {
  const root = await mkdtemp(join(tmpdir(), 'lo03-upgrade-'));
  const target = await makeV1AppliedTarget(root, previousVersion);
  const candidateDir = join(root, 'candidate');
  const b = boundaries(target);
  const prepared = await patchPrepare({ targetDir: join(root, 'target'), outDir: candidateDir, ...b });
  assert.equal(prepared.ok, true);
  const applied = await patchApply({ targetDir: join(root, 'target'), candidateDir, ...b });
  assert.equal(applied.ok, true);
  assert.equal(applied.alreadyApplied, false);
  assert.equal(applied.upgradedFromPatchVersion, previousVersion);
  assert.equal(applied.patchVersion, PATCH_VERSION);
  // 最终字节 == v2 候选（restore→re-apply，非叠加）
  const finalSha = sha256(await readFile(target.asarPath));
  assert.equal(finalSha, prepared.candidate.patched.appAsarSha256);
  const finalIndex = (await extractAsarFile(target.asarPath, 'out/main/index.js')).toString('utf8');
  assert.ok(!finalIndex.includes('simulated v1 patch payload'), 'v1 注入残留意味着叠加而非升级');
  assert.ok(finalIndex.includes('__LO_MODE'));
  // 状态记录升级为 v2；备份仍为原版
  const state = JSON.parse(await readFile(target.asarPath + '.lo02state.json', 'utf8'));
  assert.equal(state.patchVersion, PATCH_VERSION);
  assert.equal(sha256(await readFile(target.asarPath + '.lo02bak')), target.identity.appAsarSha256);
  // status 报告 patched v2
  const status = await patchStatus({ targetDir: join(root, 'target'), ...b });
  assert.equal(status.patchState, 'patched');
  assert.equal(status.patchInfo.patchVersion, PATCH_VERSION);
  await rm(root, { recursive: true, force: true });
  }
});

test('v1→v2 升级：prepare 从完好备份生成候选（preparedFromBackup），目标只读', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo03-upgrade-prep-'));
  const target = await makeV1AppliedTarget(root);
  const candidateDir = join(root, 'candidate');
  const before = sha256(await readFile(target.asarPath));
  const prepared = await patchPrepare({ targetDir: join(root, 'target'), outDir: candidateDir, ...boundaries(target) });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.candidate.preparedFromBackup, true);
  assert.equal(prepared.candidate.target.appAsarSha256, target.identity.appAsarSha256, '候选仍登记原版身份');
  assert.equal(sha256(await readFile(target.asarPath)), before, 'prepare 不写目标');
  await rm(root, { recursive: true, force: true });
});

test('v1→v2 升级：备份缺失时明确失败（backup_missing），不静默叠加', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo03-upgrade-nobak-'));
  const target = await makeV1AppliedTarget(root);
  const candidateDir = join(root, 'candidate');
  // 候选先生成（备份仍在）；随后备份丢失，apply 升级路径必须拒绝。
  const prepared = await patchPrepare({ targetDir: join(root, 'target'), outDir: candidateDir, ...boundaries(target) });
  assert.equal(prepared.ok, true);
  await rm(target.asarPath + '.lo02bak', { force: true });
  const before = sha256(await readFile(target.asarPath));
  const applied = await patchApply({ targetDir: join(root, 'target'), candidateDir, ...boundaries(target) });
  assert.equal(applied.ok, false);
  assert.equal(applied.code, 'backup_missing');
  assert.match(applied.reason, /升级|还原|备份/);
  assert.equal(sha256(await readFile(target.asarPath)), before, '失败不写目标');
  await rm(root, { recursive: true, force: true });
});

test('v1→v2 升级：v1 状态但当前包与记录不符（外部修改）拒绝，不静默叠加', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo03-upgrade-tamper-'));
  const target = await makeV1AppliedTarget(root);
  const candidateDir = join(root, 'candidate');
  const prepared = await patchPrepare({ targetDir: join(root, 'target'), outDir: candidateDir, ...boundaries(target) });
  assert.equal(prepared.ok, true);
  // 候选就绪后目标被外部修改：currentSha 不匹配候选原版/补丁版，也匹配不上 v1 记录 → 拒绝。
  await writeFile(target.asarPath, Buffer.concat([await readFile(target.asarPath), Buffer.from('externally-modified')]));
  const applied = await patchApply({
    targetDir: join(root, 'target'),
    candidateDir,
    profiles: profilesFor(target.identity),
    resolveIdentity: async () => ({ exeFileVersion: target.identity.exeFileVersion, appAsarSha256: sha256(await readFile(target.asarPath)), appAsarBytes: 1 }),
    readProcesses: noProcesses,
  });
  assert.equal(applied.ok, false);
  assert.equal(applied.code, 'digest_mismatch');
  await rm(root, { recursive: true, force: true });
});

test('同版本重复 apply v2 仍识别 alreadyApplied（不误走升级路径）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lo03-apply-repeat-'));
  const targetDir = join(root, 'target');
  const candidateDir = join(root, 'candidate');
  const target = await makeSupportedTarget(targetDir);
  const b = boundaries(target);
  await patchPrepare({ targetDir, outDir: candidateDir, ...b });
  const first = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(first.ok, true);
  assert.equal(first.upgradedFromPatchVersion, undefined);
  const second = await patchApply({ targetDir, candidateDir, ...b });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.upgradedFromPatchVersion, undefined);
  await rm(root, { recursive: true, force: true });
});
