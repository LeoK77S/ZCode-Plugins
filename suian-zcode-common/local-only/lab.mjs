// local-only lab CLI（LO-01，Close #144）
// 子命令：setup / check / launch / report / teardown。每步返回真实退出码，失败明确报因，不吞错。
//
// 系统边界（进程启动、进程枚举、TCP 表、杀进程、复制目录）均以参数注入，
// 契约测试注入替身后不启动真 Desktop、不碰真实安装目录与日常 ~/.zcode；
// 默认边界使用 PowerShell / robocopy / netstat / taskkill，仅在真实运行（原生层）时生效。

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, mkdir, readFile, readdir, rm, stat, writeFile, cp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import {
  LAB_ENV_CLEAR,
  LAB_GATEWAY_DEFAULT_PORT,
  SUPPORTED_PACKAGE,
  isInsideLab,
  labDirectories,
  renderEnvDocument,
  renderGatewayConfig,
  renderLauncherPs1,
} from './lab-env.mjs';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

// PowerShell Set-Content -Encoding UTF8 写出的 JSON 带 BOM，JSON.parse 前需剥除。
async function readJsonFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function runCommand(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const finish = (result) => { clearTimeout(timer); resolveRun(result); };
    child.on('error', (error) => finish({ code: -1, error: error.message, stdout, stderr }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

// ---------- 默认系统边界 ----------

const psQuote = (s) => `'${s.replaceAll("'", "''")}'`;

// 读源包身份：exe FileVersion（PowerShell VersionInfo）+ app.asar SHA-256/大小（Node crypto）。
async function resolvePackageIdentityFromDisk(sourceDir) {
  const exePath = join(sourceDir, SUPPORTED_PACKAGE.exeName);
  const asarPath = join(sourceDir, ...SUPPORTED_PACKAGE.appAsarRelativePath.split('/'));
  for (const target of [exePath, asarPath]) {
    if (!(await exists(target))) {
      throw new Error(`源目录缺少必需文件：${target}`);
    }
  }
  // Windows PowerShell 5.1 的 -Command 不接受尾部 $args 传参，路径以单引号字面量内嵌（单引号翻倍转义）。
  const versionResult = await runCommand('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath ${psQuote(exePath)}).VersionInfo.FileVersion`,
  ]);
  if (versionResult.code !== 0) {
    throw new Error(`读取 exe 版本失败（exit ${versionResult.code}）：${(versionResult.stderr || versionResult.error || '').trim()}`);
  }
  const exeFileVersion = versionResult.stdout.trim();
  if (!/^\d+(\.\d+){3}$/.test(exeFileVersion)) {
    throw new Error(`exe 版本信息异常："${exeFileVersion}"`);
  }
  const appAsarSha256 = await sha256File(asarPath);
  const appAsarBytes = (await stat(asarPath)).size;
  return { exeFileVersion, appAsarSha256, appAsarBytes };
}

// robocopy 退出码 0-7 均为成功（含"有文件跳过/已存在"），>=8 失败。
async function robocopyTree(from, to) {
  const result = await runCommand('robocopy', [from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'], { timeoutMs: 600000 });
  if (result.code === -1) throw new Error(`robocopy 启动失败：${result.error}`);
  if (result.code >= 8) throw new Error(`robocopy 失败（exit ${result.code}）：${result.stdout}\n${result.stderr}`);
  return { tool: `robocopy(exit ${result.code})` };
}

async function nodeCopyTree(from, to) {
  await cp(from, to, { recursive: true });
  return { tool: 'node-cp' };
}

// 启动引导器：设置隔离 env、Start-Process 副本 exe 并写出 run-state 后即退出。
// 不以 detached 启动引导器：Windows 上 detached+windowsHide 的 PowerShell 子进程会静默不执行
// （真实运行暴露的缺陷，勿回退）。副本 exe 由 Start-Process 独立创建，父进程（引导器与本 CLI）
// 退出不影响其存活，语义上仍是 detached 启动；同步等待可拿到引导器真实退出码。
async function defaultRunLauncher({ launcherPath, proxyServer, remoteDebuggingPort = 0, workspace }) {
  return await new Promise((resolveRun, rejectRun) => {
    // stdio: 'ignore' 是关键：Start-Process 的副本 exe 会继承引导器的 stdio 管道，
    // 若引导器持有 node 管道，副本存活期间管道不 EOF，node 的 close 事件永不触发（真实运行暴露）。
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath,
      '-ProxyServer', proxyServer,
      '-RemoteDebuggingPort', String(remoteDebuggingPort),
    ];
    if (workspace) args.push('-Workspace', workspace);
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' });
    child.on('error', (error) => rejectRun(new Error(`启动器进程启动失败：${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolveRun({ code });
      else rejectRun(new Error(`启动器退出码 ${code}（检查 logs/launcher-error.log）`));
    });
  });
}

function defaultProbeProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

// 构造按 ExecutablePath 枚举进程的 CIM 查询脚本。
// WQL 字符串内反斜杠与单引号均需转义（分别双写为 \\ 与 ''）；单反斜杠路径会报"无效查询"
// （真实运行暴露的缺陷，勿回退）。
export function buildProcessQueryScript(exePath) {
  const wqlPath = exePath.replaceAll('\\', '\\\\').replaceAll("'", "''");
  return [
    `$q = "SELECT ProcessId, CreationDate FROM Win32_Process WHERE ExecutablePath = '${wqlPath}'"`,
    'Get-CimInstance -Query $q | ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.CreationDate }',
  ].join('\n');
}

// 枚举副本 exe 路径的全部进程（Electron 主进程 + 渲染/GPU/utility 子进程 + host）。
async function defaultReadLabProcesses(exePath) {
  const result = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildProcessQueryScript(exePath)]);
  if (result.code !== 0) {
    throw new Error(`枚举 lab 进程失败（exit ${result.code}）：${(result.stderr || '').trim()}`);
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pid, creationDate] = line.split('|');
    return { pid: Number(pid), creationDate: creationDate ?? null };
  });
}

// netstat -ano -p tcp 全表；report 按 lab 进程 PID 过滤。
async function defaultReadTcpTable() {
  const result = await runCommand('netstat.exe', ['-ano', '-p', 'tcp']);
  if (result.code !== 0) {
    throw new Error(`netstat 失败（exit ${result.code}）：${(result.stderr || '').trim()}`);
  }
  const rows = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/);
    if (match) {
      rows.push({ proto: 'TCP', local: match[1], foreign: match[2], state: match[3], pid: Number(match[4]) });
    }
  }
  return rows;
}

// 只杀 launch 记录的 PID 及其进程树（/T）；不动其他进程。
async function defaultKillTree({ pid }) {
  const result = await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  // 0=已结束；128=进程不存在（已自行退出）也视为已结束。
  if (result.code === 0 || result.code === 128) {
    return { pid, code: result.code, ended: true };
  }
  return { pid, code: result.code, ended: false, output: `${result.stdout}\n${result.stderr}`.trim() };
}

// ---------- 子命令实现 ----------

// setup：核对源包身份 → 创建目录树 → 复制副本 → 生成 env 定义/启动器/网关配置/清单。
export async function setupLab({
  labDir,
  sourceDir,
  packageIdentity = SUPPORTED_PACKAGE,
  resolveIdentity = resolvePackageIdentityFromDisk,
  copyTree = robocopyTree,
  gatewayPort,
  now = () => new Date(),
} = {}) {
  labDir = resolve(labDir);
  sourceDir = resolve(sourceDir);
  const dirs = labDirectories(labDir);
  if (await exists(dirs.manifestPath)) {
    return { ok: false, phase: 'guard', reason: `lab 清单已存在：${dirs.manifestPath}；如需重建请先 teardown --purge` };
  }
  // 1. 身份核对：先于任何写入；不匹配明确失败。
  let actual;
  try {
    actual = await resolveIdentity(sourceDir);
  } catch (error) {
    return { ok: false, phase: 'identity', reason: `源包身份解析失败：${error.message}` };
  }
  const mismatches = [];
  if (actual.exeFileVersion !== packageIdentity.exeFileVersion) {
    mismatches.push(`exe 版本不符：实际 ${actual.exeFileVersion}，期望 ${packageIdentity.exeFileVersion}`);
  }
  if (String(actual.appAsarSha256).toLowerCase() !== String(packageIdentity.appAsarSha256).toLowerCase()) {
    mismatches.push(`app.asar SHA-256 不符：实际 ${actual.appAsarSha256}，期望 ${packageIdentity.appAsarSha256}`);
  }
  if (mismatches.length) {
    return { ok: false, phase: 'identity', reason: `源包身份不匹配：${mismatches.join('；')}` };
  }
  // 2. 创建隔离目录树。
  try {
    for (const dir of [dirs.app, dirs.home, dirs.userData, dirs.sessionData, dirs.storage,
      dirs.sessionDbDir, dirs.appdata, dirs.localappdata, dirs.workspace, dirs.gatewayConfigDir,
      dirs.logsDir, dirs.reportsDir]) {
      await mkdir(dir, { recursive: true });
    }
  } catch (error) {
    return { ok: false, phase: 'directories', reason: `创建 lab 目录树失败：${error.message}` };
  }
  // 3. 复制运行包副本。
  let copyInfo;
  try {
    copyInfo = await copyTree(sourceDir, dirs.app);
  } catch (error) {
    return { ok: false, phase: 'copy', reason: `复制运行包副本失败：${error.message}` };
  }
  // 4. 副本完整性：副本 asar 摘要必须与源一致。
  let copySha;
  try {
    copySha = await sha256File(dirs.appAsar);
  } catch (error) {
    return { ok: false, phase: 'copy-verify', reason: `副本 app.asar 摘要计算失败：${error.message}` };
  }
  if (copySha.toLowerCase() !== String(actual.appAsarSha256).toLowerCase()) {
    return {
      ok: false,
      phase: 'copy-verify',
      reason: `副本 app.asar 摘要与源不一致：${copySha} != ${actual.appAsarSha256}`,
    };
  }
  // 5. 生成 env 定义、启动器、网关配置与清单（env/启动器的网关地址与网关配置端口一致）。
  const gatewayConfig = renderGatewayConfig(gatewayPort === undefined ? {} : { port: gatewayPort });
  const manifest = {
    formatVersion: 1,
    kind: 'local-only-lab',
    createdAt: now().toISOString(),
    supportedPackage: packageIdentity,
    source: { dir: sourceDir, ...actual },
    copy: {
      dir: dirs.app,
      appAsarSha256: copySha,
      appAsarBytes: actual.appAsarBytes,
      tool: copyInfo.tool,
      copiedAt: now().toISOString(),
    },
    identityMatch: true,
    gateway: {
      configPath: dirs.gatewayConfigPath,
      port: gatewayConfig.port,
      mode: gatewayConfig.mode,
      relay_protocol_version: gatewayConfig.relay_protocol_version,
      note: 'LO-01 只交付配置模板与归属检查；网关运行为 LO-02 范围',
    },
  };
  try {
    await writeFile(dirs.envPath, JSON.stringify(renderEnvDocument(labDir, { gatewayPort: gatewayConfig.port }), null, 2));
    await writeFile(dirs.launcherPath, renderLauncherPs1(labDir, { gatewayPort: gatewayConfig.port }), 'utf8');
    await writeFile(dirs.gatewayConfigPath, JSON.stringify(gatewayConfig, null, 2));
    await writeFile(dirs.manifestPath, JSON.stringify(manifest, null, 2));
  } catch (error) {
    return { ok: false, phase: 'write-artifacts', reason: `写出 lab 文件失败：${error.message}` };
  }
  return { ok: true, labDir: dirs.root, manifest };
}

// check：启动前核对隔离边界——每个环境变量实际解析路径归属 lab、副本完整、启动器与网关配置归属正确。
// 只读检查，不启动 Desktop。
export async function checkLab({ labDir, packageIdentity = SUPPORTED_PACKAGE } = {}) {
  labDir = resolve(labDir);
  const dirs = labDirectories(labDir);
  const items = [];
  const add = (name, ok, reason) => items.push({ name, ok, ...(ok ? {} : { reason }) });

  let manifest = null;
  try {
    manifest = await readJsonFile(dirs.manifestPath);
    add('lab-manifest.json', true);
  } catch {
    add('lab-manifest.json', false, '缺少 lab 清单（先执行 setup）');
  }
  let envDoc = null;
  try {
    envDoc = await readJsonFile(dirs.envPath);
    add('lab-env.json', true);
  } catch {
    add('lab-env.json', false, '缺少 env 定义文件（先执行 setup）');
  }
  if (envDoc) {
    // 路径型变量做归属检查；应用名（非路径）单独核对，不得沿用日常默认（避免单实例锁转交）。
    for (const [key, value] of Object.entries(envDoc.values ?? {})) {
      if (key === 'ZCODE_DESKTOP_APPLICATION_NAME') {
        if (value && value !== 'ZCode') add(`env:${key}`, true);
        else add(`env:${key}`, false, '应用名沿用日常默认 "ZCode"，无法隔离单实例锁');
        continue;
      }
      // 网关地址是回环 URL 而非路径：核对格式与清单端口一致，不做 lab 归属判定。
      if (key === 'ZCODE_LOCAL_ONLY_GATEWAY') {
        const expectedPort = manifest?.gateway?.port ?? LAB_GATEWAY_DEFAULT_PORT;
        const matchLoopback = /^http:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/.test(String(value));
        const portMatch = String(value).endsWith(`:${expectedPort}`);
        add(`env:${key}`, matchLoopback && portMatch, `期望回环地址且端口 ${expectedPort}（与 gateway/config.json 一致），实际 ${value}`);
        continue;
      }
      if (isInsideLab(labDir, value)) add(`env:${key}`, true);
      else add(`env:${key}`, false, `越界：${value} 不在 lab 目录内`);
    }
    if (envDoc.values?.ZCODE_DATA_BASE_DIR === labDirectories(labDir).home) {
      add('semantics:ZCODE_DATA_BASE_DIR', true);
    } else {
      add('semantics:ZCODE_DATA_BASE_DIR', false, `期望指向 lab home（.zcode 父目录），实际 ${envDoc.values?.ZCODE_DATA_BASE_DIR}`);
    }
    for (const key of LAB_ENV_CLEAR) {
      if ((envDoc.clear ?? []).includes(key)) add(`clear:${key}`, true);
      else add(`clear:${key}`, false, 'env 定义缺少该清除项');
    }
  }
  if (manifest) {
    try {
      const copySha = await sha256File(dirs.appAsar);
      const expected = String(manifest.copy.appAsarSha256).toLowerCase();
      if (copySha.toLowerCase() === expected) add('copy:app.asar', true);
      else add('copy:app.asar', false, `副本摘要 ${copySha} 与清单 ${expected} 不一致（可能被篡改）`);
    } catch (error) {
      add('copy:app.asar', false, `读取失败：${error.message}`);
    }
    if (await exists(dirs.appExe)) add(`copy:${SUPPORTED_PACKAGE.exeName}`, true);
    else add(`copy:${SUPPORTED_PACKAGE.exeName}`, false, '副本 exe 缺失');
  }
  try {
    const launcher = await readFile(dirs.launcherPath, 'utf8');
    const pointsToCopy = launcher.includes(dirs.appExe);
    add('launcher.ps1', pointsToCopy, pointsToCopy ? undefined : '启动器未指向副本 exe');
  } catch {
    add('launcher.ps1', false, '启动器缺失（先执行 setup）');
  }
  try {
    const config = await readJsonFile(dirs.gatewayConfigPath);
    const problems = [];
    if (config.version !== 1) problems.push(`version=${config.version}（期望 1）`);
    if (config.mode !== 'local-only') problems.push(`mode=${config.mode}`);
    if (config.relay_protocol_version !== 2) problems.push(`relay_protocol_version=${config.relay_protocol_version}`);
    if (config.port === 17329) problems.push('port 与日常网关 17329 冲突');
    if (typeof config.control_token !== 'string' || config.control_token.length < 32) problems.push('control_token 缺失或过短');
    add('gateway/config.json', problems.length === 0, problems.join('；'));
  } catch (error) {
    add('gateway/config.json', false, `读取失败：${error.message}`);
  }
  const ok = items.length > 0 && items.every((item) => item.ok);
  return { ok, items };
}

// launch：以隔离 env 启动副本（detached），向 exe 传 Chromium 死代理参数阻断官方外连路径之一。
// remoteDebuggingPort 可选：CDP 诊断（Electron 41 需配合已显式的 --user-data-dir 才暴露 targets）。
// workspace 可选：以 Desktop 的 --open-workspace 参数直开工作区，
// 与 local-only 标志首行一致时远控 attach 与窗口工作区匹配。
export async function launchLab({
  labDir,
  proxyDeadPort = 1,
  runLauncher = defaultRunLauncher,
  waitStateMs = 15000,
  pollMs = 250,
  remoteDebuggingPort = 0,
  workspace,
} = {}) {
  labDir = resolve(labDir);
  const dirs = labDirectories(labDir);
  if (!(await exists(dirs.launcherPath))) {
    return { ok: false, reason: '启动器缺失（先执行 setup）' };
  }
  if (await exists(dirs.runStatePath)) {
    return { ok: false, reason: `已有运行记录（${dirs.runStatePath}）；先 teardown 再 launch` };
  }
  const proxyServer = `http://127.0.0.1:${proxyDeadPort}`;
  let gatewayPort;
  try {
    gatewayPort = (await readJsonFile(dirs.manifestPath)).gateway?.port;
  } catch {
    gatewayPort = undefined;
  }
  try {
    // 每次启动前重渲染启动器：生成物与工具当前版本保持一致（含与网关配置一致的
    // ZCODE_LOCAL_ONLY_GATEWAY），并自保障工作目录存在（teardown 清理后 workspace 不再存在，
    // 真实运行暴露的 DirectoryNotFoundException）。重渲染会覆盖对 launcher.ps1 的手工修改——
    // lab 需要的启动参数一律走本工具选项，不要手工改 launcher。
    await writeFile(dirs.launcherPath, renderLauncherPs1(labDir, {
      ...(gatewayPort === undefined ? {} : { gatewayPort }),
      ...(remoteDebuggingPort > 0 ? { remoteDebuggingPort } : {}),
      ...(workspace ? { workspace } : {}),
    }), 'utf8');
  } catch (error) {
    return { ok: false, reason: `更新启动器失败：${error.message}` };
  }
  try {
    await runLauncher({ labDir, launcherPath: dirs.launcherPath, proxyServer, remoteDebuggingPort, workspace });
  } catch (error) {
    return { ok: false, reason: `启动器执行失败：${error.message}` };
  }
  const deadline = Date.now() + waitStateMs;
  let runState = null;
  while (Date.now() < deadline) {
    try {
      runState = await readJsonFile(dirs.runStatePath);
      break;
    } catch {
      await sleep(pollMs);
    }
  }
  if (!runState) {
    return {
      ok: false,
      reason: `启动器未在 ${waitStateMs}ms 内写出运行记录；检查 ${join(dirs.logsDir, 'launcher-error.log')}`,
    };
  }
  return { ok: true, pid: runState.pid, runState, proxyServer, remoteDebuggingPort };
}

function parseForeignAddress(address) {
  if (typeof address !== 'string') return null;
  let host;
  let port;
  if (address.startsWith('[')) {
    const end = address.indexOf(']');
    if (end === -1) return null;
    host = address.slice(1, end);
    port = address.slice(end + 2);
  } else {
    const idx = address.lastIndexOf(':');
    if (idx === -1) return null;
    host = address.slice(0, idx);
    port = address.slice(idx + 1);
  }
  if ((host === '0.0.0.0' || host === '::' || host === '*') && (port === '0' || port === '*')) {
    return null; // LISTENING/未连接占位，不构成连接目标
  }
  const isLoopback = host === '::1' || host.startsWith('127.');
  return { host, port, isLoopback };
}

async function collectDesktopLogTails(userDataDir, { maxFiles = 8, tailBytes = 4096 } = {}) {
  const found = [];
  const walk = async (dir, depth) => {
    if (found.length >= maxFiles || depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.name.toLowerCase().endsWith('.log')) {
        try {
          const info = await stat(path);
          const start = Math.max(0, info.size - tailBytes);
          const buffer = Buffer.alloc(info.size - start);
          const handle = await open(path, 'r');
          try {
            await handle.read(buffer, 0, buffer.length, start);
          } finally {
            await handle.close();
          }
          found.push({ path, bytes: info.size, tail: buffer.toString('utf8') });
        } catch {
          // 读不了的日志跳过，不让单个文件失败掩盖其余证据
        }
      }
    }
  };
  await walk(userDataDir, 0);
  return found;
}

// report：收集证据——副本进程存活、按 PID 的 TCP 连接（回环 vs 外部分类）、Desktop 日志尾部、环境快照。
export async function reportLab({
  labDir,
  probeProcessAlive = defaultProbeProcessAlive,
  readLabProcesses = defaultReadLabProcesses,
  readTcpTable = defaultReadTcpTable,
  now = () => new Date(),
} = {}) {
  labDir = resolve(labDir);
  const dirs = labDirectories(labDir);
  let runState;
  try {
    runState = await readJsonFile(dirs.runStatePath);
  } catch {
    return { ok: false, reason: '缺少运行记录（先 launch）' };
  }
  const mainPid = runState.pid;
  const mainPidAlive = await probeProcessAlive(mainPid);
  let processes = [];
  let processError = null;
  try {
    processes = await readLabProcesses(dirs.appExe);
  } catch (error) {
    processError = error.message;
  }
  const pids = new Set(processes.map((p) => p.pid));
  pids.add(mainPid);
  let tcpTable = [];
  let tcpError = null;
  try {
    tcpTable = await readTcpTable();
  } catch (error) {
    tcpError = error.message;
  }
  const connections = { loopback: [], external: [] };
  for (const row of tcpTable) {
    if (!pids.has(row.pid)) continue;
    const parsed = parseForeignAddress(row.foreign);
    if (!parsed) continue;
    if (parsed.isLoopback) connections.loopback.push(row);
    else connections.external.push(row);
  }
  // Desktop 日志尾部：userData 与 {dataBaseDir}/.zcode/v2/logs（真实运行确认日志落后者）。
  const desktopLogs = [
    ...(await collectDesktopLogTails(dirs.userData)),
    ...(await collectDesktopLogTails(join(dirs.home, '.zcode', 'v2', 'logs'))),
  ];
  const report = {
    formatVersion: 1,
    kind: 'local-only-lab-report',
    generatedAt: now().toISOString(),
    labDir: dirs.root,
    mainPid,
    mainPidAlive,
    processes,
    ...(processError ? { processError } : {}),
    ...(tcpError ? { tcpError } : {}),
    connections,
    // 外部目标连接即"官方连接尝试"的直接网络证据（未被死代理约束的 Node fetch 栈也在此暴露）。
    externalAttempts: connections.external,
    desktopLogs,
    envSnapshot: runState.env ?? null,
    proxyServer: runState.proxyServer ?? null,
    startedAt: runState.startedAt ?? null,
  };
  await mkdir(dirs.reportsDir, { recursive: true });
  const stamp = now().toISOString().replaceAll(':', '').replaceAll('.', '').replaceAll('-', '');
  const reportPath = join(dirs.reportsDir, `report-${stamp}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return {
    ok: true,
    report,
    reportPath,
    summary: {
      mainPid,
      mainPidAlive,
      processCount: processes.length,
      loopbackConnections: connections.loopback.length,
      externalConnections: connections.external.length,
      desktopLogFiles: desktopLogs.length,
    },
  };
}

// teardown：结束本次启动的进程（只杀 launch 记录的 PID 树）、清理 lab 内运行数据；保留日志与清单。
export async function teardownLab({ labDir, killTree = defaultKillTree, purge = false } = {}) {
  labDir = resolve(labDir);
  const dirs = labDirectories(labDir);
  let killResult = null;
  let mainPid = null;
  try {
    const runState = await readJsonFile(dirs.runStatePath);
    mainPid = runState.pid;
    killResult = await killTree({ pid: runState.pid, exePath: runState.exePath });
    await rm(dirs.runStatePath, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return { ok: false, reason: `teardown 失败：${error.message}` };
    }
    // 无运行记录：仅清理数据，不杀任何进程。
  }
  // 杀进程后等待实际退出（taskkill 发出与进程完全退出之间有延迟，
  // 此时 userData/lockfile 仍被占用，立即 rm 会 EBUSY——真实运行暴露）。
  if (mainPid !== null) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      let alive = true;
      try {
        process.kill(mainPid, 0);
      } catch {
        alive = false;
      }
      if (!alive) break;
      await sleep(500);
    }
  }
  const removable = [dirs.home, dirs.userData, dirs.sessionData, dirs.storage, dirs.sessionDbDir,
    dirs.appdata, dirs.localappdata, dirs.workspace];
  if (purge) removable.push(dirs.app);
  const failures = [];
  for (const dir of removable) {
    if (!isInsideLab(labDir, dir)) continue; // 结构防御：只删 lab 内路径
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(dir, { recursive: true, force: true });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await sleep(1000); // 文件句柄释放延迟，重试
      }
    }
    if (lastError) failures.push(`${dir}: ${lastError.message}`);
  }
  if (failures.length) {
    return { ok: false, reason: `部分 lab 目录清理失败：${failures.join('；')}`, killed: killResult, purged: Boolean(purge) };
  }
  return { ok: true, killed: killResult, purged: Boolean(purge) };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values[key] = next;
      i++;
    } else {
      values[key] = true;
    }
  }
  return values;
}

export async function main(argv) {
  const [command, ...rest] = argv;
  const values = parseArgs(rest);
  const labDir = values.lab;
  if (!labDir) {
    console.error('缺少 --lab <目录>');
    return 2;
  }
  if (command === 'setup') {
    if (!values.source) {
      console.error('缺少 --source <安装目录>');
      return 2;
    }
    const options = {};
    if (values['package-identity']) {
      try {
        options.packageIdentity = await readJsonFile(values['package-identity']);
      } catch (error) {
        console.error(`--package-identity 文件读取失败：${error.message}`);
        return 2;
      }
    }
    if (values['gateway-port']) options.gatewayPort = Number(values['gateway-port']);
    if (values['copy-tool'] === 'node') options.copyTree = nodeCopyTree;
    const result = await setupLab({ labDir, sourceDir: values.source, ...options });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === 'check') {
    const result = await checkLab({ labDir });
    for (const item of result.items) {
      const line = `[${item.ok ? 'PASS' : 'FAIL'}] ${item.name}${item.ok ? '' : `：${item.reason}`}`;
      if (item.ok) console.log(line);
      else console.error(line);
    }
    console.log(JSON.stringify({ ok: result.ok, total: result.items.length }));
    return result.ok ? 0 : 1;
  }
  if (command === 'launch') {
    const options = {};
    if (values['proxy-dead-port']) options.proxyDeadPort = Number(values['proxy-dead-port']);
    if (values['remote-debugging-port']) options.remoteDebuggingPort = Number(values['remote-debugging-port']);
    if (values.workspace && typeof values.workspace === 'string') options.workspace = values.workspace;
    const result = await launchLab({ labDir, ...options });
    console.log(JSON.stringify(result.ok ? { ok: true, pid: result.pid, proxyServer: result.proxyServer, runState: result.runState } : result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === 'report') {
    const result = await reportLab({ labDir });
    if (result.ok) {
      const { summary, reportPath } = result;
      const external = result.report.externalAttempts.map((c) => `${c.pid} -> ${c.foreign} (${c.state})`).join(', ');
      console.log(JSON.stringify({ ok: true, reportPath, ...summary, external }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return result.ok ? 0 : 1;
  }
  if (command === 'teardown') {
    const result = await teardownLab({ labDir, purge: values.purge === true });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  console.error('用法：node local-only/lab.mjs <setup|check|launch|report|teardown> --lab <dir> [--source <安装目录>] [--proxy-dead-port <port>] [--gateway-port <port>] [--copy-tool robocopy|node] [--package-identity <json>] [--purge] [--remote-debugging-port <port>]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(await main(process.argv.slice(2)));
}
