// local-only lab 隔离环境定义（LO-01，Close #144）
// 单一数据源：目录树规划、进程级环境变量集、支持包身份。
// 支持包身份固定 Windows 3.16.2.8769 运行包的字节身份（exe 版本 + app.asar SHA-256），
// 不以版本字段代替字节身份；身份来源为 2026-10-21 只读采集（探索笔记 03）。
//
// 环境变量语义依据（sources/official-zcode 只读快照）：
// - services/src/paths.ts：getDataBaseDir() 派生 {dataBaseDir}/.zcode 与 {dataBaseDir}/.zcode/v2，
//   因此 ZCODE_DATA_BASE_DIR 指向 .zcode 的父目录（lab home），不是 .zcode 本身。
// - desktop/src/main/desktopRuntimeEnv.ts：dataBaseDir !== homedir() 时 Desktop 经 host env 注入
//   ZCODE_DATA_BASE_DIR；ZCODE_DESKTOP_USER_DATA_DIR 决定 Electron userData，单实例锁按 userData 派生。
// - desktop/src/main/index.ts:898/930：ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL 是 relay 地址最高优先级
//   覆盖；日常 HKCU 将其指向 127.0.0.1:17329 日常网关，副本必须显式清除，避免继承。

import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const SUPPORTED_PACKAGE = Object.freeze({
  exeName: 'ZCode.exe',
  exeFileVersion: '3.16.2.8769',
  appAsarRelativePath: 'resources/app.asar',
  appAsarSha256: '1F960BA24A4A6687BB29090A9AC3273C06E9FC18B14882525F591132650A99A8',
  appAsarBytes: 341334118,
  chromiumVersion: '147.0.7727.15',
  electronVersion: null, // 静态证据链未定 Electron 精确版本；运行时提取列为未验项
});

export const LAB_APPLICATION_NAME = 'ZCode Lab';

// 启动器进程内必须显式删除的继承变量（不修改用户环境变量）。
export const LAB_ENV_CLEAR = Object.freeze([
  'ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL',
  'ZCODE_WEB_REMOTE_CONTROL_URL',
]);

// lab 网关独立端口：避开日常网关 17329；LO-01 只交付配置模板，不启动网关（LO-02 范围）。
export const LAB_GATEWAY_DEFAULT_PORT = 17331;

export function labDirectories(labDir) {
  const root = resolve(labDir);
  const app = join(root, 'app');
  const asarSegments = SUPPORTED_PACKAGE.appAsarRelativePath.split('/');
  return {
    root,
    app, // 运行包副本（源目录整份复制）
    appExe: join(app, SUPPORTED_PACKAGE.exeName),
    appAsar: join(app, ...asarSegments),
    home: join(root, 'home'), // HOME/USERPROFILE；ZCODE_DATA_BASE_DIR 指向这里（.zcode 的父目录）
    userData: join(root, 'desktop-user-data'), // ZCODE_DESKTOP_USER_DATA_DIR（Electron userData/单实例锁）
    sessionData: join(root, 'desktop-session-data'), // ZCODE_DESKTOP_SESSION_DATA_DIR
    storage: join(root, 'storage'), // ZCODE_STORAGE_DIR（CLI storage 根）
    sessionDbDir: join(root, 'session-db'), // ZCODE_SESSION_DB_PATH 所在目录
    appdata: join(root, 'appdata'), // APPDATA
    localappdata: join(root, 'localappdata'), // LOCALAPPDATA
    workspace: join(root, 'workspace'), // 测试工作区（启动器 WorkingDirectory）
    gatewayConfigDir: join(root, 'gateway'),
    gatewayConfigPath: join(root, 'gateway', 'config.json'),
    logsDir: join(root, 'logs'),
    reportsDir: join(root, 'reports'),
    launcherPath: join(root, 'launcher.ps1'),
    manifestPath: join(root, 'lab-manifest.json'),
    envPath: join(root, 'lab-env.json'),
    runStatePath: join(root, 'run-state.json'),
  };
}

export function labEnvValues(labDir, { gatewayPort = LAB_GATEWAY_DEFAULT_PORT } = {}) {
  const dirs = labDirectories(labDir);
  return {
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    APPDATA: dirs.appdata,
    LOCALAPPDATA: dirs.localappdata,
    ZCODE_DATA_BASE_DIR: dirs.home,
    ZCODE_DESKTOP_HOME_DIR: dirs.home,
    ZCODE_DESKTOP_USER_DATA_DIR: dirs.userData,
    ZCODE_DESKTOP_SESSION_DATA_DIR: dirs.sessionData,
    ZCODE_DESKTOP_APPLICATION_NAME: LAB_APPLICATION_NAME,
    ZCODE_STORAGE_DIR: dirs.storage,
    ZCODE_SESSION_DB_PATH: join(dirs.sessionDbDir, 'db.sqlite'),
    // LO-03：local-only 补丁 P1 的网关地址通道（仅接受回环目标）；与 lab 网关配置端口一致。
    ZCODE_LOCAL_ONLY_GATEWAY: `http://127.0.0.1:${gatewayPort}`,
  };
}

// 路径归属判定：大小写与斜杠方向不敏感；lab 根本身也算归属。
export function isInsideLab(labDir, targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') return false;
  const normalize = (p) => resolve(p).toLowerCase().replaceAll('/', '\\');
  const root = normalize(labDir);
  const target = normalize(targetPath);
  return target === root || target.startsWith(root.endsWith('\\') ? root : root + '\\');
}

const psQuote = (s) => `'${s.replaceAll("'", "''")}'`;

// 启动器脚本：在自身 PowerShell 进程内 set 全部隔离 env、清除官方 relay 地址覆盖后启动副本 exe。
// 隔离 env 只存在于本进程及其子进程（副本 exe），不改用户环境变量。
// --proxy-server 适用边界：仅约束 Chromium 网络栈；Desktop main 进程的远控 HTTP 走 Node fetch
// （官方 webRemoteControlV2Http.ts），不受该开关控制，其官方连接证据以 report 的 TCP 观察为准。
// LO-03：gatewayPort 生成与网关配置一致的 ZCODE_LOCAL_ONLY_GATEWAY；RemoteDebuggingPort 可选
// （CDP 诊断/账号事件注入；Electron 41 需配合已显式的 --user-data-dir 才暴露 targets）。
export function renderLauncherPs1(labDir, { gatewayPort, remoteDebuggingPort } = {}) {
  const dirs = labDirectories(labDir);
  const values = labEnvValues(labDir, gatewayPort === undefined ? {} : { gatewayPort });
  const envLines = Object.entries(values).map(([key, value]) => `$env:${key} = ${psQuote(value)}`);
  const clearLines = LAB_ENV_CLEAR.map((key) => `Remove-Item Env:${key} -ErrorAction SilentlyContinue`);
  const envSnapshotLines = Object.keys(values).map((key) => `    ${key} = $env:${key}`);
  return [
    '# local-only lab 启动器（LO-01 生成，勿手工编辑）。',
    '# 隔离 env 仅在当前 PowerShell 进程内设置，副本 exe 及其子进程继承；不修改用户环境变量。',
    'param(',
    "    [string]$ProxyServer = '',",
    '    [int]$RemoteDebuggingPort = 0,',
    "    [string]$Workspace = ''",
    ')',
    "$ErrorActionPreference = 'Stop'",
    'try {',
    ...envLines.map((line) => `  ${line}`),
    ...clearLines.map((line) => `  ${line}`),
    `  $exe = ${psQuote(dirs.appExe)}`,
    `  $workingDir = ${psQuote(dirs.workspace)}`,
    '  if (-not (Test-Path -LiteralPath $workingDir)) { New-Item -ItemType Directory -Path $workingDir -Force | Out-Null }',
    '  $desktopArgs = @()',
    '  if ($ProxyServer) { $desktopArgs += "--proxy-server=$ProxyServer" }',
    // CDP 需要同时传命令行 --user-data-dir：Chromium 对默认数据目录下的远程调试有安全缓解，
    // 仅设 env ZCODE_DESKTOP_USER_DATA_DIR 不够，targets 不暴露（LO-02 实证，LO-03 固化进工具）。
    // 路径以双引号内嵌（Start-Process 对数组元素不自动加引号，含空格路径会断裂）。
    '  $udir = ' + psQuote(dirs.userData),
    '  if ($RemoteDebuggingPort -gt 0) { $desktopArgs += "--remote-debugging-port=$RemoteDebuggingPort"; $desktopArgs += (\'--user-data-dir="{0}"\' -f $udir) }',
    // Workspace 位置参数（官方 index.ts extractOpenWorkspacePathFromArgs 语义）：启动即打开
    // 指定工作区，绕过首启欢迎页；与 local-only 标志首行一致时远控 attach 与窗口工作区匹配。
    "  if ($Workspace) { $desktopArgs += ('\"{0}\"' -f $Workspace) }",
    '  $proc = Start-Process -FilePath $exe -ArgumentList $desktopArgs -WorkingDirectory $workingDir -PassThru -RedirectStandardOutput ' + psQuote(join(dirs.logsDir, 'desktop.out.log')) + ' -RedirectStandardError ' + psQuote(join(dirs.logsDir, 'desktop.err.log')),
    '  $state = [ordered]@{',
    '    pid = $proc.Id',
    '    exePath = $exe',
    "    startedAt = (Get-Date).ToUniversalTime().ToString('o')",
    '    proxyServer = $ProxyServer',
    '    remoteDebuggingPort = $RemoteDebuggingPort',
    `    labDir = ${psQuote(dirs.root)}`,
    '    env = @{',
    ...envSnapshotLines,
    '    }',
    '  }',
    `  $state | ConvertTo-Json -Depth 4 | Set-Content -Path ${psQuote(dirs.runStatePath)} -Encoding UTF8`,
    '} catch {',
    `  $_ | Out-String | Set-Content -Path ${psQuote(join(dirs.logsDir, 'launcher-error.log'))} -Encoding UTF8`,
    '  exit 1',
    '}',
    'exit 0',
  ].join('\r\n') + '\r\n';
}

// lab 专属网关配置模板：local-only + V2 + 独立端口 + 随机 control_token（仅存 lab 内，不进日志与入库文档）。
// 字段与 gateway.mjs --config 读取项对齐；LO-01 只交付配置与归属检查，不要求网关跑通。
export function renderGatewayConfig({ port = LAB_GATEWAY_DEFAULT_PORT } = {}) {
  return {
    version: 1,
    mode: 'local-only',
    relay_protocol_version: 2,
    port,
    control_token: randomBytes(32).toString('hex'),
  };
}

// lab env 定义文件内容（setup 写出、check 消费）。gatewayPort 与网关配置一致。
export function renderEnvDocument(labDir, { gatewayPort } = {}) {
  const dirs = labDirectories(labDir);
  return {
    formatVersion: 1,
    kind: 'local-only-lab-env',
    labDir: dirs.root,
    values: labEnvValues(labDir, gatewayPort === undefined ? {} : { gatewayPort }),
    clear: LAB_ENV_CLEAR,
    semantics: {
      ZCODE_DATA_BASE_DIR: '指向 .zcode 父目录（官方 services paths.ts：getZCodeDataRootDir = join(getDataBaseDir(), ".zcode")）',
      ZCODE_DESKTOP_USER_DATA_DIR: 'Electron 单实例锁按 userData 派生；独立 userData + 独立应用名避免锁转交日常窗口',
      ZCODE_LOCAL_ONLY_GATEWAY: 'local-only 补丁 P1 的网关地址通道（仅回环目标生效）；端口与 gateway/config.json 一致',
      clear: '启动器进程内删除；日常 HKCU 的 relay 覆盖指向 17329 日常网关，副本不得继承',
    },
  };
}
