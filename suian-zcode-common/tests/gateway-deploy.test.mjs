import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';

import {
  computeGatewayBuildId,
  deployGatewayRuntime,
  gatewayRuntimeManifest,
  readActiveGateway,
  verifyDeployment,
  writeActiveGateway,
} from '../gateway-deploy.mjs';

const exec = promisify(execFile);
const commonRoot = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tests$/, '');

// 与 gateway-build.test.mjs 同法：复制真实源码根到临时目录（排除 tests/docs/.scratch）。
async function sourceCopy(t, name = 'gateway-deploy-src-') {
  const root = await mkdtemp(join(tmpdir(), name));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(commonRoot, root, { recursive: true, filter: path => !['tests', 'docs', '.scratch', 'experiments'].includes(path.slice(commonRoot.length + 1).split(/[\\/]/)[0]) });
  return root;
}

async function writeGatewayConfig(dir, overrides = {}) {
  const configFile = join(dir, 'config.json');
  await writeFile(configFile, JSON.stringify({ version: 1, port: 0, upstream_url: 'ws://127.0.0.1:1/ws', instance_id: 'deploy-fixture', control_token: 'deploy-fixture-token', ...overrides }));
  return configFile;
}

// 真实回环网关进程：从部署目录启动，返回 { healthUrl, stop }。
async function startDeployedGateway(t, deploymentDir, dataDir) {
  const configFile = await writeGatewayConfig(dataDir);
  const child = spawn(process.execPath, [join(deploymentDir, 'gateway.mjs'), '--config', configFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const [line] = await Promise.race([
    (async () => {
      const { createInterface } = await import('node:readline');
      const lines = createInterface({ input: child.stdout });
      const [first] = await once(lines, 'line');
      lines.close();
      return [first];
    })(),
    exited.then(([code]) => { throw new Error(`网关提前退出 ${code}: ${stderr}`); }),
  ]);
  const { health_url: healthUrl } = JSON.parse(line);
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  return {
    healthUrl,
    child,
    async stop() {
      const response = await fetch(healthUrl.replace('/health', '/shutdown'), { method: 'POST', headers: { Authorization: 'Bearer ' + config.control_token } });
      assert.equal(response.status, 200);
      const [code] = await exited;
      return code;
    },
  };
}

test('部署复制真实运行闭包并写 deployment.json：摘要齐备、buildId 即部署指纹、目录不含业务模块', async t => {
  const source = await sourceCopy(t);
  const toolsRoot = await mkdtemp(join(tmpdir(), 'gateway-deploy-tools-'));
  t.after(() => rm(toolsRoot, { recursive: true, force: true }));
  const { buildId, deploymentDir, alreadyPresent } = await deployGatewayRuntime({ sourceRoot: source, toolsRoot });
  assert.equal(alreadyPresent, false);
  assert.equal(buildId, await computeGatewayBuildId(source), 'buildId 必须由候选内容决定');
  assert.equal(deploymentDir, join(toolsRoot, 'deployments', buildId));

  const manifest = await gatewayRuntimeManifest(source);
  assert.ok(manifest.some(item => item.to === 'gateway.mjs'), '网关入口必须在清单中');
  assert.ok(manifest.some(item => item.to === 'vendor/remote-shared.js'));
  assert.ok(manifest.some(item => item.to === 'node_modules/ws/wrapper.mjs'), 'ESM 入口 wrapper 必须在清单中');
  for (const item of manifest) {
    await assert.doesNotReject(() => readFile(join(deploymentDir, item.to)), `部署缺运行文件 ${item.to}`);
  }
  const deployment = JSON.parse(await readFile(join(deploymentDir, 'deployment.json'), 'utf8'));
  assert.equal(deployment.formatVersion, 1);
  assert.equal(deployment.buildId, buildId);
  assert.deepEqual(deployment.runtime.map(entry => entry.path).sort(), manifest.map(item => item.to).sort(), 'deployment.json 必须记录全部运行文件');
  const { createHash } = await import('node:crypto');
  for (const entry of deployment.runtime) {
    const content = await readFile(join(deploymentDir, entry.path));
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256, `${entry.path} 摘要不符`);
  }

  const entries = new Set((await readdir(deploymentDir, { recursive: true })).map(String));
  for (const forbidden of ['client.mjs', 'client-install.mjs', 'locate.mjs', 'depcheck.mjs', 'toast-action.mjs', 'SKILL.md']) {
    assert.ok(!entries.has(forbidden) && ![...entries].some(path => path.endsWith('/' + forbidden) || path.endsWith('\\' + forbidden)), `部署目录不得携带业务模块 ${forbidden}`);
  }
  await assert.doesNotReject(() => readFile(join(deploymentDir, 'licenses', 'ws-LICENSE')), 'ws 许可可追溯');
});

test('buildId 是内容指纹：路径变化不改变、内容变化必改变', async t => {
  const first = await sourceCopy(t, 'gateway-deploy-a-');
  const second = await sourceCopy(t, 'gateway-deploy-b-');
  assert.equal(await computeGatewayBuildId(first), await computeGatewayBuildId(second), '同内容不同路径 buildId 相同');
  const variant = join(second, 'rpc-broker.mjs');
  await appendFile(variant, '\n// deploy digest probe\n');
  assert.notEqual(await computeGatewayBuildId(first), await computeGatewayBuildId(second), '运行文件内容变化必须改变 buildId');
  const beforeDocChange = await computeGatewayBuildId(second);
  await appendFile(join(second, 'README.md'), '\n// 文档变化\n');
  assert.equal(await computeGatewayBuildId(second), beforeDocChange, '文档变化不影响网关 buildId');
});

test('重复部署同一 buildId 幂等：不重写已有部署并报告 alreadyPresent', async t => {
  const source = await sourceCopy(t);
  const toolsRoot = await mkdtemp(join(tmpdir(), 'gateway-deploy-idem-'));
  t.after(() => rm(toolsRoot, { recursive: true, force: true }));
  const first = await deployGatewayRuntime({ sourceRoot: source, toolsRoot });
  const marker = join(first.deploymentDir, 'gateway.mjs');
  const before = await readFile(marker);
  const second = await deployGatewayRuntime({ sourceRoot: source, toolsRoot });
  assert.equal(second.buildId, first.buildId);
  assert.equal(second.alreadyPresent, true, '同 buildId 重复部署应报告 alreadyPresent');
  assert.deepEqual(await readFile(marker), before, '幂等部署不得重写运行文件');
  const dirs = (await readdir(join(toolsRoot, 'deployments'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert.deepEqual(dirs.sort(), [first.buildId], '同 buildId 只应存在一个部署目录');
  assert.ok(!dirs.some(name => name.startsWith('.staging')), '不得残留暂存目录');
});

test('部署自包含：源码候选删除后，部署目录仍能启动真实回环网关并返回 buildId', { timeout: 20000 }, async t => {
  const source = await sourceCopy(t);
  const toolsRoot = await mkdtemp(join(tmpdir(), 'gateway-deploy-run-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'gateway-deploy-data-'));
  t.after(() => rm(toolsRoot, { recursive: true, force: true }));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { buildId, deploymentDir } = await deployGatewayRuntime({ sourceRoot: source, toolsRoot });
  await rm(source, { recursive: true, force: true });

  const gateway = await startDeployedGateway(t, deploymentDir, dataDir);
  const health = await (await fetch(gateway.healthUrl)).json();
  assert.equal(health.service, 'suian-zcode-gateway');
  assert.equal(health.build.id, buildId, '健康接口必须报告部署 buildId');
  assert.equal(health.build.root, deploymentDir);
  assert.equal(await gateway.stop(), 0, '部署网关应可正常自行退出');
});

test('运行中健康不冒充磁盘新代码；部署文件被篡改后指纹校验失败', { timeout: 20000 }, async t => {
  const source = await sourceCopy(t);
  const toolsRoot = await mkdtemp(join(tmpdir(), 'gateway-deploy-tamper-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'gateway-deploy-data-'));
  t.after(() => rm(toolsRoot, { recursive: true, force: true }));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { buildId, deploymentDir } = await deployGatewayRuntime({ sourceRoot: source, toolsRoot });

  const gateway = await startDeployedGateway(t, deploymentDir, dataDir);
  assert.equal((await (await fetch(gateway.healthUrl)).json()).build.id, buildId);
  await appendFile(join(deploymentDir, 'rpc-broker.mjs'), '\n// tampered after start\n');
  assert.equal((await (await fetch(gateway.healthUrl)).json()).build.id, buildId, '磁盘候选变化不能冒充运行代码变化');
  await gateway.stop();

  await assert.rejects(exec(process.execPath, [join(deploymentDir, 'gateway-build.mjs')]), /deploy/i, '部署版指纹入口必须校验 deployment.json 摘要并明确失败');
  await assert.rejects(verifyDeployment({ toolsRoot, buildId }), /摘要|digest|sha256|match/i, '校验入口必须报告篡改');
});

test('活动记录独立于 Toast 记录：写入网关记录不触碰 Toast 记录，原子切换返回先前值', async t => {
  const toolsRoot = await mkdtemp(join(tmpdir(), 'gateway-deploy-active-'));
  t.after(() => rm(toolsRoot, { recursive: true, force: true }));
  const first = await writeActiveGateway({ toolsRoot, buildId: 'a'.repeat(64), nodePath: process.execPath });
  assert.equal(first.previous, null, '首次写入无先前记录');
  const toastRecord = { version: 1, build_id: 'b'.repeat(64), note: 'PKG-06 fixture' };
  await writeFile(join(toolsRoot, 'active-toast.json'), JSON.stringify(toastRecord));
  const second = await writeActiveGateway({ toolsRoot, buildId: 'c'.repeat(64), nodePath: process.execPath });
  assert.equal(second.previous, 'a'.repeat(64), '原子切换应返回先前 buildId');
  const active = await readActiveGateway(toolsRoot);
  assert.equal(active.build_id, 'c'.repeat(64));
  assert.equal(active.node_path, process.execPath);
  assert.deepEqual(JSON.parse(await readFile(join(toolsRoot, 'active-toast.json'), 'utf8')), toastRecord, '网关活动记录切换不得触碰 Toast 记录');
  assert.equal(await readActiveGateway(join(toolsRoot, '不存在')), null);
  const files = await readdir(toolsRoot);
  assert.ok(files.includes('active-gateway.json'), '活动记录必须落盘');
  assert.ok(!files.some(name => name.startsWith('active-gateway.json.tmp')), '原子写入不得残留临时文件');
});
