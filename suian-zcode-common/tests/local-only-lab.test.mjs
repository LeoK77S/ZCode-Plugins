import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import {
  SUPPORTED_PACKAGE,
  LAB_ENV_CLEAR,
  labDirectories,
  labEnvValues,
  isInsideLab,
} from '../local-only/lab-env.mjs';
import {
  setupLab,
  checkLab,
  launchLab,
  reportLab,
  teardownLab,
  buildProcessQueryScript,
} from '../local-only/lab.mjs';

// 系统边界注入：测试不读真实安装目录、不启动 Desktop、不执行系统杀进程命令。

async function nodeCopyTree(from, to) {
  await cp(from, to, { recursive: true });
  return { tool: 'node-cp' };
}

async function makeFakeInstall(root) {
  const exePath = join(root, 'ZCode.exe');
  const asarPath = join(root, 'resources', 'app.asar');
  await mkdir(dirname(asarPath), { recursive: true });
  await writeFile(exePath, 'MZ fake desktop exe for local-only lab contract test');
  const asarBytes = Buffer.from(`fake asar payload ${randomBytes(16).toString('hex')}`);
  await writeFile(asarPath, asarBytes);
  return {
    exePath,
    asarPath,
    identity: {
      exeFileVersion: '9.9.9-lab-test.1',
      appAsarSha256: createHash('sha256').update(asarBytes).digest('hex'),
      appAsarBytes: asarBytes.length,
    },
  };
}

function fixtureBoundaries(identity) {
  return {
    packageIdentity: identity,
    resolveIdentity: async () => ({ ...identity }),
    copyTree: nodeCopyTree,
  };
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test('SUPPORTED_PACKAGE 固定 3.16.2.8769 运行包字节身份，不以版本字段代替摘要', () => {
  assert.equal(SUPPORTED_PACKAGE.exeFileVersion, '3.16.2.8769');
  assert.equal(
    SUPPORTED_PACKAGE.appAsarSha256.toLowerCase(),
    '1f960ba24a4a6687bb29090a9ac3273c06e9fc18b14882525f591132650a99a8',
  );
  assert.equal(SUPPORTED_PACKAGE.appAsarBytes, 341334118);
});

test('lab 环境变量定义：ZCODE_DATA_BASE_DIR 指向 .zcode 父目录，覆盖变量全部归属 lab 且显式清除官方 relay 地址覆盖', () => {
  const labDir = 'D:/lab-example';
  const dirs = labDirectories(labDir);
  const values = labEnvValues(labDir);
  // 官方 services paths.ts 语义：getDataBaseDir() 派生 {dataBaseDir}/.zcode，
  // 因此 ZCODE_DATA_BASE_DIR 必须是 .zcode 的父目录（lab home），不是 .zcode 本身。
  assert.equal(values.ZCODE_DATA_BASE_DIR, dirs.home);
  assert.equal(values.HOME, dirs.home);
  assert.equal(values.USERPROFILE, dirs.home);
  assert.equal(values.ZCODE_DESKTOP_HOME_DIR, dirs.home);
  assert.equal(values.ZCODE_DESKTOP_USER_DATA_DIR, dirs.userData);
  assert.equal(values.ZCODE_DESKTOP_SESSION_DATA_DIR, dirs.sessionData);
  assert.equal(values.ZCODE_STORAGE_DIR, dirs.storage);
  assert.equal(values.ZCODE_SESSION_DB_PATH, join(dirs.sessionDbDir, 'db.sqlite'));
  assert.equal(values.APPDATA, dirs.appdata);
  assert.equal(values.LOCALAPPDATA, dirs.localappdata);
  // 单实例锁隔离：userData 与应用名都偏离日常默认。
  assert.equal(values.ZCODE_DESKTOP_APPLICATION_NAME, 'ZCode Lab');
  // LO-03：网关地址 env 与网关配置端口一致（补丁 P1 只接受回环目标）；
  // lab 网关端口自定义时（如 17431 避开 17331），副本必须显式指向同端口。
  assert.equal(values.ZCODE_LOCAL_ONLY_GATEWAY, 'http://127.0.0.1:17331');
  assert.equal(labEnvValues(labDir, { gatewayPort: 17431 }).ZCODE_LOCAL_ONLY_GATEWAY, 'http://127.0.0.1:17431');
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ZCODE_DATA_BASE_DIR',
    'ZCODE_DESKTOP_HOME_DIR', 'ZCODE_DESKTOP_USER_DATA_DIR', 'ZCODE_DESKTOP_SESSION_DATA_DIR',
    'ZCODE_STORAGE_DIR', 'ZCODE_SESSION_DB_PATH']) {
    assert.ok(isInsideLab(labDir, values[key]), `${key} 应在 lab 内`);
  }
  // 日常 HKCU 的 ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL 指向 17329 日常网关；
  // 副本不得继承该覆盖（官方 index.ts:898/930 读取点），也不得继承远端地址覆盖。
  assert.ok(LAB_ENV_CLEAR.includes('ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL'));
  assert.ok(LAB_ENV_CLEAR.includes('ZCODE_WEB_REMOTE_CONTROL_URL'));
});

test('setup 创建完整目录树、启动器、网关配置与清单，并记录源与副本摘要', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  const result = await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  assert.equal(result.ok, true);
  const dirs = labDirectories(labDir);
  for (const dir of [dirs.app, dirs.home, dirs.userData, dirs.sessionData, dirs.storage,
    dirs.sessionDbDir, dirs.appdata, dirs.localappdata, dirs.workspace, dirs.gatewayConfigDir,
    dirs.logsDir, dirs.reportsDir]) {
    assert.ok(await exists(dir), `目录应存在：${dir}`);
  }
  // 启动器：隔离 env 全量 set、显式清除官方 relay 覆盖、指向副本 exe、重定向输出。
  const launcher = await readFile(dirs.launcherPath, 'utf8');
  assert.match(launcher, /\$env:ZCODE_DESKTOP_USER_DATA_DIR\s*=/);
  assert.match(launcher, /Remove-Item Env:ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL/);
  assert.match(launcher, /Remove-Item Env:ZCODE_WEB_REMOTE_CONTROL_URL/);
  assert.ok(launcher.includes(join(dirs.app, 'ZCode.exe')));
  assert.match(launcher, /-RedirectStandardOutput/);
  // LO-03：启动器设置 local-only 网关地址 env（与网关配置端口一致），并支持可选
  // CDP 远程调试端口参数（renderer 触发缺口的诊断与账号事件注入用；userData 已显式）。
  assert.match(launcher, /\$env:ZCODE_LOCAL_ONLY_GATEWAY\s*=\s*'http:\/\/127\.0\.0\.1:17331'/);
  assert.match(launcher, /RemoteDebuggingPort/);
  // 网关配置模板：local-only + V2 + 独立端口 + 随机令牌（LO-01 只交付配置，不启动网关）。
  const gatewayConfig = JSON.parse(await readFile(dirs.gatewayConfigPath, 'utf8'));
  assert.equal(gatewayConfig.version, 1);
  assert.equal(gatewayConfig.mode, 'local-only');
  assert.equal(gatewayConfig.relay_protocol_version, 2);
  assert.notEqual(gatewayConfig.port, 17329);
  assert.match(gatewayConfig.control_token, /^[0-9a-f]{32,}$/);
  // 清单：源与副本摘要一致且与支持身份匹配。
  const manifest = JSON.parse(await readFile(dirs.manifestPath, 'utf8'));
  assert.equal(manifest.source.appAsarSha256, install.identity.appAsarSha256);
  assert.equal(manifest.copy.appAsarSha256, install.identity.appAsarSha256);
  assert.equal(manifest.identityMatch, true);
  // env 定义文件：values 全部归属 lab。
  const envFile = JSON.parse(await readFile(dirs.envPath, 'utf8'));
  assert.equal(envFile.values.ZCODE_DATA_BASE_DIR, dirs.home);
});

test('setup 在 asar 摘要不匹配时明确失败且不创建 lab 目录', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  const wrongIdentity = { ...install.identity, appAsarSha256: '0'.repeat(64) };
  const result = await setupLab({
    labDir, sourceDir,
    packageIdentity: wrongIdentity,
    resolveIdentity: async () => ({ ...install.identity }),
    copyTree: nodeCopyTree,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /app\.asar/);
  assert.equal(await exists(labDir), false, '身份不匹配时不得创建 lab');
});

test('setup 在 exe 版本不匹配时明确失败', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  const wrongIdentity = { ...install.identity, exeFileVersion: '0.0.0-other.1' };
  const result = await setupLab({
    labDir, sourceDir,
    packageIdentity: wrongIdentity,
    resolveIdentity: async () => ({ ...install.identity }),
    copyTree: nodeCopyTree,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /版本|version/i);
});

test('setup 拒绝覆盖既有 lab 清单', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  const boundaries = fixtureBoundaries(install.identity);
  assert.equal((await setupLab({ labDir, sourceDir, ...boundaries })).ok, true);
  const again = await setupLab({ labDir, sourceDir, ...boundaries });
  assert.equal(again.ok, false);
  assert.match(again.reason, /已存在|exists/i);
});

test('check 通过：setup 后所有环境变量解析路径与配置归属 lab', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const result = await checkLab({ labDir });
  assert.equal(result.ok, true);
  assert.ok(result.items.length >= 8);
  assert.ok(result.items.every(item => item.ok));
});

test('check 检出越界环境变量路径并失败', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const dirs = labDirectories(labDir);
  const envFile = JSON.parse(await readFile(dirs.envPath, 'utf8'));
  envFile.values.HOME = join(outer, 'outside-home'); // lab 外路径
  await writeFile(dirs.envPath, JSON.stringify(envFile, null, 2));
  const result = await checkLab({ labDir });
  assert.equal(result.ok, false);
  const violation = result.items.find(item => !item.ok);
  assert.match(violation.name, /HOME/);
  assert.match(violation.reason, /越界|outside/i);
});

test('check 在副本 asar 被篡改后失败', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const dirs = labDirectories(labDir);
  await writeFile(join(dirs.app, 'resources', 'app.asar'), 'tampered');
  const result = await checkLab({ labDir });
  assert.equal(result.ok, false);
  assert.ok(result.items.some(item => !item.ok && /app\.asar/.test(item.name)));
});

test('launch 经启动器启动并等待 run-state 记录（注入启动边界，不启动真 Desktop）', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const dirs = labDirectories(labDir);
  const calls = [];
  const result = await launchLab({
    labDir,
    proxyDeadPort: 47821,
    runLauncher: async ({ launcherPath, proxyServer }) => {
      calls.push({ launcherPath, proxyServer });
      await writeFile(dirs.runStatePath, JSON.stringify({
        pid: 47110815,
        exePath: join(dirs.app, 'ZCode.exe'),
        startedAt: new Date().toISOString(),
        proxyServer,
        env: labEnvValues(labDir),
      }));
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.pid, 47110815);
  assert.equal(calls[0].launcherPath, dirs.launcherPath);
  assert.match(calls[0].proxyServer, /127\.0\.0\.1:47821/);
});

test('report 生成证据文件并分类回环与外部连接', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const dirs = labDirectories(labDir);
  await writeFile(dirs.runStatePath, JSON.stringify({
    pid: 4242,
    exePath: join(dirs.app, 'ZCode.exe'),
    startedAt: new Date().toISOString(),
    proxyServer: 'http://127.0.0.1:1',
    env: labEnvValues(labDir),
  }));
  const result = await reportLab({
    labDir,
    probeProcessAlive: async () => true,
    readLabProcesses: async () => [{ pid: 4242 }, { pid: 4243 }],
    readTcpTable: async () => [
      { proto: 'TCP', local: '127.0.0.1:50000', foreign: '127.0.0.1:17329', state: 'ESTABLISHED', pid: 4242 },
      { proto: 'TCP', local: '127.0.0.1:50001', foreign: '203.0.113.10:443', state: 'SYN_SENT', pid: 4242 },
      { proto: 'TCP', local: '127.0.0.1:50002', foreign: '198.51.100.7:443', state: 'ESTABLISHED', pid: 4243 },
      { proto: 'TCP', local: '127.0.0.1:50003', foreign: '93.184.216.34:443', state: 'SYN_SENT', pid: 999 }, // 其他进程，不归属本 lab
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.report.mainPid, 4242);
  assert.equal(result.report.processes.length, 2);
  assert.equal(result.report.connections.loopback.length, 1);
  assert.equal(result.report.connections.external.length, 2, '外部目标连接全部计入（不按 PID 漏计子进程）');
  assert.ok(result.report.connections.external.every(c => c.pid === 4242 || c.pid === 4243));
  assert.ok(result.report.envSnapshot);
  assert.ok(await exists(result.reportPath));
});

test('teardown 只清理 lab 内运行数据，保留日志、清单与网关配置，不越界', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const outsideMarker = join(outer, 'outside-marker.txt');
  await writeFile(outsideMarker, 'outside');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const dirs = labDirectories(labDir);
  await writeFile(join(dirs.logsDir, 'desktop.out.log'), 'log evidence');
  await writeFile(dirs.runStatePath, JSON.stringify({ pid: 987654, exePath: join(dirs.app, 'ZCode.exe') }));
  const killed = [];
  const result = await teardownLab({
    labDir,
    killTree: async ({ pid }) => { killed.push(pid); return { killed: true }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(killed, [987654], '只杀 launch 记录的 PID');
  assert.equal(await exists(dirs.home), false, '运行数据 home 应清理');
  assert.equal(await exists(dirs.storage), false);
  assert.equal(await exists(dirs.userData), false);
  assert.equal(await exists(dirs.sessionData), false);
  assert.equal(await exists(dirs.sessionDbDir), false);
  assert.equal(await exists(dirs.appdata), false);
  assert.equal(await exists(dirs.localappdata), false);
  assert.equal(await exists(dirs.workspace), false);
  assert.ok(await exists(dirs.app), '运行包副本保留（可复用）');
  assert.ok(await exists(join(dirs.logsDir, 'desktop.out.log')), '日志保留');
  assert.ok(await exists(dirs.manifestPath), '清单保留');
  assert.ok(await exists(dirs.envPath), 'env 定义保留');
  assert.ok(await exists(dirs.gatewayConfigPath), '网关配置保留');
  assert.ok(await exists(dirs.launcherPath), '启动器保留');
  assert.equal(await exists(dirs.runStatePath), false, 'run-state 结束后移除');
  assert.ok(await exists(outsideMarker), 'lab 外文件不受影响');
});

test('report 兼容 PowerShell 写出的带 BOM 运行记录', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const dirs = labDirectories(labDir);
  const state = JSON.stringify({ pid: 1357, exePath: join(dirs.app, 'ZCode.exe'), startedAt: new Date().toISOString(), env: {} });
  await writeFile(dirs.runStatePath, '\ufeff' + state, 'utf8'); // 模拟 PowerShell Set-Content -Encoding UTF8 的 BOM
  const result = await reportLab({
    labDir,
    probeProcessAlive: async () => false,
    readLabProcesses: async () => [{ pid: 1357 }],
    readTcpTable: async () => [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.report.mainPid, 1357);
});

test('进程枚举查询脚本对反斜杠与单引号转义（真实运行暴露的 WQL 缺陷回归）', () => {
  const script = buildProcessQueryScript("D:\\dir\\Z Code's\\ZCode.exe");
  // WQL 字符串内反斜杠与单引号均需双写转义，否则 CIM 报"无效查询"。
  assert.ok(script.includes("'D:\\\\dir\\\\Z Code''s\\\\ZCode.exe'"), script);
});

test('teardown 无运行记录时仅清理数据不报错', async t => {
  const outer = await mkdtemp(join(tmpdir(), 'lo-lab-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const labDir = join(outer, 'lab');
  const sourceDir = join(outer, 'fake-install');
  const install = await makeFakeInstall(sourceDir);
  await setupLab({ labDir, sourceDir, ...fixtureBoundaries(install.identity) });
  const killed = [];
  const result = await teardownLab({
    labDir,
    killTree: async ({ pid }) => { killed.push(pid); return { killed: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(killed.length, 0, '无 run-state 时不杀任何进程');
});
