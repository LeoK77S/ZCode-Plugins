import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';

import { computeGatewayBuildId, deployGatewayRuntime, ensureLaunchers, writeActiveGateway } from '../gateway-deploy.mjs';

const exec = promisify(execFile);
const commonRoot = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tests$/, '');
const wscript = () => join(process.env.SystemRoot, 'System32', 'wscript.exe');
const encodedCommand = command => Buffer.from(command, 'utf16le').toString('base64');

async function sourceCopy(t, name = 'stable-src-') {
  const root = await mkdtemp(join(tmpdir(), name));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(commonRoot, root, { recursive: true, filter: path => !['tests', 'docs', '.scratch', 'experiments'].includes(path.slice(commonRoot.length + 1).split(/[\\/]/)[0]) });
  return root;
}

async function writeGatewayConfig(dataDir, overrides = {}) {
  const configFile = join(dataDir, 'config.json');
  await writeFile(configFile, JSON.stringify({ version: 1, port: 0, upstream_url: 'ws://127.0.0.1:1/ws', instance_id: 'stable-launcher-fixture', control_token: 'stable-launcher-token', ...overrides }));
  return configFile;
}

// 用稳定任务参数（wscript → 稳定 VBS → 稳定 PowerShell 启动器）启动部署网关。
// 外层 exit $LASTEXITCODE 把脚本退出码精确传回进程（& 调用脚本内的 exit 只退出脚本作用域）。
async function launchStable(t, toolsRoot, dataDir) {
  const configFile = await writeGatewayConfig(dataDir);
  const psFile = join(toolsRoot, 'launchers', 'run.ps1');
  const launch = `& '${psFile.replaceAll("'", "''")}' -ToolsRoot '${toolsRoot.replaceAll("'", "''")}' -DataDir '${dataDir.replaceAll("'", "''")}'; exit $LASTEXITCODE`;
  const child = spawn(wscript(), ['//B', '//NoLogo', join(toolsRoot, 'launchers', 'gateway-launch.vbs'), encodedCommand(launch)], { windowsHide: true });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } });
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  return { child, exited, config };
}

async function waitForHealth(url, { attempts = 60 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await (await fetch(url)).json(); }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw lastError;
}

// 稳定启动器把网关 stdout 重定向到 gateway.out.log；轮询直到首行 JSON 就绪。
// excludeUrl 跳过上一次启动留下的旧行（同一数据目录复用，端口 0 每次不同）。
async function waitForGatewayLog(dataDir, { attempts = 60, excludeUrl = null } = {}) {
  const logFile = join(dataDir, 'gateway.out.log');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const content = await readFile(logFile, 'utf8');
      for (const line of content.trim().split('\n')) {
        if (!line) continue;
        const report = JSON.parse(line);
        if (report.health_url && report.health_url !== excludeUrl) return report;
      }
    } catch { /* 文件尚未创建或尚未写完 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`gateway.out.log 未就绪: ${logFile}`);
}

test('旧任务参数把安装时缓存编码进 EncodedCommand，缓存删除后无法再启动', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const cache = await sourceCopy(t, 'stable-old-cache-');
  const dataDir = await mkdtemp(join(tmpdir(), 'stable-old-data-'));
  await writeGatewayConfig(dataDir);
  // 旧 setup.ps1 生成的任务参数形态：run.ps1 的绝对路径来自安装时的公共缓存根。
  const oldLaunch = `& '${join(cache, 'run.ps1').replaceAll("'", "''")}' -NodePath '${process.execPath.replaceAll("'", "''")}' -DataDir '${dataDir.replaceAll("'", "''")}'`;
  await rm(cache, { recursive: true, force: true }, { maxRetries: 5 });
  const failure = await promisify(execFile)(wscript(), ['//B', '//NoLogo', join(commonRoot, 'run.vbs'), encodedCommand(oldLaunch)], { windowsHide: true, timeout: 20000 }).then(() => null, error => error);
  assert.ok(failure, '旧任务参数在缓存删除后必须失败');
  assert.notEqual(failure.code, 0, '旧任务参数的失败必须以真实退出码传回，不能伪装成功');
});

test('稳定启动器经活动记录启动部署网关：缓存删除后仍可启动，健康报告 buildId，退出码真实传回', { skip: process.platform !== 'win32', timeout: 40000 }, async t => {
  const cache = await sourceCopy(t, 'stable-new-cache-');
  const toolsRoot = await mkdtemp(join(tmpdir(), 'stable 新 tools-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'stable 数据 dir-'));
  const { buildId } = await deployGatewayRuntime({ sourceRoot: cache, toolsRoot });
  await ensureLaunchers({ sourceRoot: cache, toolsRoot });
  await writeActiveGateway({ toolsRoot, buildId, nodePath: process.execPath });
  await rm(cache, { recursive: true, force: true }, { maxRetries: 5 });

  const stable = await launchStable(t, toolsRoot, dataDir);
  const { health_url: healthUrl } = await waitForGatewayLog(dataDir);
  const report = await waitForHealth(healthUrl);
  assert.equal(report.service, 'suian-zcode-gateway');
  assert.equal(report.build.id, buildId, '稳定启动器启动的必须是部署的运行文件');

  const shutdown = await fetch(healthUrl.replace('/health', '/shutdown'), { method: 'POST', headers: { Authorization: 'Bearer ' + stable.config.control_token } });
  assert.equal(shutdown.status, 200);
  assert.equal(await (await stable.exited)[0], 0, '监督启动链必须传回真实退出码');
});

test('同一任务参数经活动记录切换到另一部署，不再依赖任务参数里的版本', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const firstSource = await sourceCopy(t, 'stable-sw-a-');
  const secondSource = await sourceCopy(t, 'stable-sw-b-');
  const toolsRoot = await mkdtemp(join(tmpdir(), 'stable-switch-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'stable-switch-data-'));
  const secondVariant = join(secondSource, 'terminal-relay.mjs');
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(secondVariant, (await readFile(secondVariant, 'utf8')) + '\n// switch variant\n');
  const first = await deployGatewayRuntime({ sourceRoot: firstSource, toolsRoot });
  const second = await deployGatewayRuntime({ sourceRoot: secondSource, toolsRoot });
  assert.notEqual(first.buildId, second.buildId);
  await ensureLaunchers({ sourceRoot: firstSource, toolsRoot });

  await writeActiveGateway({ toolsRoot, buildId: first.buildId, nodePath: process.execPath });
  const runOne = await launchStable(t, toolsRoot, dataDir);
  const healthOne = (await waitForGatewayLog(dataDir)).health_url;
  assert.equal((await waitForHealth(healthOne)).build.id, first.buildId);
  const stopOne = await fetch(healthOne.replace('/health', '/shutdown'), { method: 'POST', headers: { Authorization: 'Bearer ' + runOne.config.control_token } });
  assert.equal(stopOne.status, 200);
  assert.equal(await (await runOne.exited)[0], 0);

  await writeActiveGateway({ toolsRoot, buildId: second.buildId, nodePath: process.execPath });
  const runTwo = await launchStable(t, toolsRoot, dataDir);
  const healthTwo = (await waitForGatewayLog(dataDir, { excludeUrl: healthOne })).health_url;
  assert.equal((await waitForHealth(healthTwo)).build.id, second.buildId, '切换活动记录即可切换部署版本');
  const stopTwo = await fetch(healthTwo.replace('/health', '/shutdown'), { method: 'POST', headers: { Authorization: 'Bearer ' + runTwo.config.control_token } });
  assert.equal(stopTwo.status, 200);
  assert.equal(await (await runTwo.exited)[0], 0);
  assert.equal(await computeGatewayBuildId(secondSource), second.buildId);
});

test('稳定启动器在无活动记录或部署缺失时明确失败并传回退出码', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const cache = await sourceCopy(t, 'stable-missing-');
  const toolsRoot = await mkdtemp(join(tmpdir(), 'stable-missing-tools-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'stable-missing-data-'));
  await ensureLaunchers({ sourceRoot: cache, toolsRoot });
  const psFile = join(toolsRoot, 'launchers', 'run.ps1');
  const launch = `& '${psFile.replaceAll("'", "''")}' -ToolsRoot '${toolsRoot.replaceAll("'", "''")}' -DataDir '${dataDir.replaceAll("'", "''")}'; exit $LASTEXITCODE`;
  const missingActive = await exec(wscript(), ['//B', '//NoLogo', join(toolsRoot, 'launchers', 'gateway-launch.vbs'), encodedCommand(launch)], { windowsHide: true }).then(() => null, error => error);
  assert.ok(missingActive && missingActive.code === 3, '无活动记录必须明确失败（退出码 3）');
  const { buildId } = await deployGatewayRuntime({ sourceRoot: cache, toolsRoot });
  await writeActiveGateway({ toolsRoot, buildId: 'f'.repeat(64), nodePath: process.execPath });
  const missingDeployment = await exec(wscript(), ['//B', '//NoLogo', join(toolsRoot, 'launchers', 'gateway-launch.vbs'), encodedCommand(launch)], { windowsHide: true }).then(() => null, error => error);
  assert.ok(missingDeployment && missingDeployment.code === 4, '部署缺失必须明确失败（退出码 4）');
});
