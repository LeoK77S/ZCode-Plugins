// PKG-07 契约：仓库层发布编排——四包构建 -> 组装校验 -> 确定性 ZIP -> 发布记录 ->
// 市场候选与版本统一检查。一轮正式发布只生成一次 ZIP：同输入再次编排复用原字节、
// 不重跑构建；发布记录绑定提交、构建输入摘要、工具与 ZIP 摘要，且 ZIP 内不含提交自引用；
// 门禁只核对输入漂移与 ZIP 摘要，不重新构建。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildReleaseArtifacts, gateCommitInputs } from '../release-orchestrate.mjs';
import { makeReleaseDir } from './release-fixtures.mjs';
import { readZipEntries, readZipEntry } from '../release-zip.mjs';

const COMMIT = 'c0ffee1234567890c0ffee1234567890c0ffee12';

// 合成"源码树"：每插件一个目录，含会被计入构建输入的源文件。
async function makeSourceTree(root) {
  for (const plugin of ['suian-zcode-common', 'suian-zcode-title', 'suian-zcode-app-mcp', 'suian-side-editor']) {
    await mkdir(join(root, plugin, '.zcode-plugin'), { recursive: true });
    await writeFile(join(root, plugin, '.zcode-plugin', 'plugin.json'), `${JSON.stringify({ name: plugin, version: '1.0.0', description: `${plugin} 合成` })}\n`);
    await writeFile(join(root, plugin, 'src.mjs'), `// ${plugin} source\n`);
  }
}

// 形状齐备的发布目录（按 release-verify 的 profile 必备项）；内容按插件差异化，
// 避免跨包同内容文本被"公共内联"检测误判为副本。源码 src.mjs 的内容作为指纹进入
// 产物，使"输入变化 -> ZIP 变化"在合成构建器下真实成立。
async function buildFakeRelease(outDir, plugin, repoRoot) {
  const sourceFingerprint = await readFile(join(repoRoot, plugin, 'src.mjs'), 'utf8');
  const shapes = {
    'suian-zcode-common': {
      files: {
        'dist/client.mjs': `// ${plugin} client\n`, 'dist/client-install.mjs': `// ${plugin} client-install\n`,
        'toast-executor.mjs': `// ${plugin} toast\n`,
        'vendor/LICENSE-ZCode': `${plugin} MIT\n`, 'vendor/NOTICE-ZCode-current.md': `${plugin} notice\n`,
        'vendor/LICENSE-zod': `${plugin} zod MIT\n`, 'vendor/NOTICE.md': `${plugin} notice\n`,
        'vendor/conversation-wire.sources.json': `{"plugin":"${plugin}"}\n`,
        'licenses/ws-LICENSE': `${plugin} ws MIT\n`,
        'skills/setup/SKILL.md': `# ${plugin} setup skill\n`,
      },
      entries: { client: 'dist/client.mjs', 'client-install': 'dist/client-install.mjs' },
    },
    'suian-zcode-title': {
      files: {
        'dist/cli.mjs': `// ${plugin} cli\n`, 'dist/hook.mjs': `// ${plugin} hook\n`, 'dist/install.mjs': `// ${plugin} install\n`, 'dist/toast-action.mjs': `// ${plugin} toast\n`,
        'prompt.md': `# ${plugin} prompt\n`, 'SKILL.md': `# ${plugin} skill\n`, 'hooks/hooks.json': `{"plugin":"${plugin}"}\n`, 'skills/setup/SKILL.md': `# ${plugin} setup\n`,
      },
      entries: { cli: 'dist/cli.mjs' },
    },
    'suian-zcode-app-mcp': {
      files: {
        'dist/cli.mjs': `// ${plugin} cli\n`, 'dist/artifact-hook.mjs': `// ${plugin} hook\n`, 'dist/install.mjs': `// ${plugin} install\n`,
        'dist/ui/index.html': `<i>${plugin}</i>\n`, 'skills/setup/SKILL.md': `# ${plugin} setup\n`,
        '.mcp.json': `{"plugin":"${plugin}"}\n`, 'hooks/hooks.json': `{"plugin":"${plugin}"}\n`, 'vendor/NOTICE.md': `${plugin} notice\n`, 'SKILL.md': `# ${plugin} skill\n`,
        'licenses/mcp-sdk-LICENSE': `${plugin} sdk MIT\n`,
      },
      entries: { cli: 'dist/cli.mjs' },
    },
    'suian-side-editor': {
      files: {
        'cli.mjs': `// ${plugin} cli\n`, 'common-client.mjs': `// ${plugin} adapter\n`, 'locate.mjs': '// thin locator\n',
        'ui/dist/editor.html': `<html>${plugin}</html>\n`, '.mcp.json': `{"plugin":"${plugin}"}\n`, 'skills/setup/SKILL.md': `# ${plugin} setup\n`,
      },
      entries: { cli: 'cli.mjs' },
    },
  };
  const shape = shapes[plugin];
  return makeReleaseDir(outDir, {
    pluginName: plugin, version: '1.0.0', packageName: plugin, dependencies: plugin === 'suian-zcode-common' ? undefined : ['suian-zcode-common'],
    omitDefaults: ['dist/cli.mjs', 'skills/setup/SKILL.md'],
    files: { ...shape.files, 'src-fingerprint.txt': sourceFingerprint },
    releaseOverrides: release => ({ ...release, entries: shape.entries }),
  });
}

const makeWorld = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pkg07-orch-'));
  await makeSourceTree(root);
  const buildCounts = {};
  const builders = {};
  for (const plugin of ['suian-zcode-common', 'suian-zcode-title', 'suian-zcode-app-mcp', 'suian-side-editor']) {
    builders[plugin] = async ({ outDir }) => {
      buildCounts[plugin] = (buildCounts[plugin] ?? 0) + 1;
      return buildFakeRelease(outDir, plugin, root);
    };
  }
  return {
    root, buildCounts, builders,
    resolveCommit: async () => COMMIT,
    marketplace: {
      name: 'suian-zcode-plugins',
      plugins: [
        { name: 'suian-zcode-common', version: '0.4.2', source: './suian-zcode-common', description: 'd1' },
        { name: 'suian-zcode-title', version: '0.1.5', source: './suian-zcode-title', description: 'd2', dependencies: ['suian-zcode-common'] },
        { name: 'suian-zcode-app-mcp', version: '0.10.0', source: './suian-zcode-app-mcp', description: 'd3', dependencies: ['suian-zcode-common'] },
        { name: 'suian-side-editor', version: '0.3.0', source: './suian-side-editor', description: 'd4', dependencies: ['suian-zcode-common'] },
      ],
    },
  };
};

test('全链（合成构建器）：四包 ZIP 生成、发布记录与市场候选齐备', async t => {
  const world = await makeWorld();
  const outDir = await mkdtemp(join(tmpdir(), 'pkg07-out-'));
  t.after(() => rm(world.root, { recursive: true, force: true }));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await buildReleaseArtifacts({
    repoRoot: world.root, outDir, builders: world.builders, resolveCommit: world.resolveCommit,
    marketplace: world.marketplace, releaseTag: 'plugins-1.0.0', baseUrl: 'https://github.com/ONEGAYI/ZCode-Plugins/releases/download',
  });
  assert.equal(result.problems.length, 0, JSON.stringify(result.problems));
  assert.equal(result.zips.length, 4);
  for (const zip of result.zips) {
    assert.match(zip.zipSha256, /^[0-9a-f]{64}$/);
    assert.match(zip.pluginVersion, /^1\.0\.0$/);
  }
  // 发布记录绑定提交、构建输入摘要、工具与 ZIP 摘要
  const record = JSON.parse(await readFile(join(outDir, 'release-record.json'), 'utf8'));
  assert.equal(record.commit, COMMIT);
  assert.equal(record.marketplace?.name, 'suian-zcode-plugins');
  assert.ok(record.toolchain?.node, '记录必须绑定工具链（Node 版本）');
  for (const plugin of Object.values(record.plugins)) {
    assert.match(plugin.inputDigest, /^[0-9a-f]{64}$/);
    assert.match(plugin.zipSha256, /^[0-9a-f]{64}$/);
  }
  // 市场候选：四条目全部切换 zip 来源且通过形状校验
  const candidate = JSON.parse(await readFile(join(outDir, 'marketplace.candidate.json'), 'utf8'));
  assert.equal(candidate.plugins.length, 4);
  assert.ok(candidate.plugins.every(plugin => plugin.source?.type === 'zip'));
});

test('一轮只生成一次 ZIP：同输入再次编排复用原字节、构建器不重跑', async t => {
  const world = await makeWorld();
  const outDir = await mkdtemp(join(tmpdir(), 'pkg07-reuse-'));
  t.after(() => rm(world.root, { recursive: true, force: true }));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const options = {
    repoRoot: world.root, outDir, builders: world.builders, resolveCommit: world.resolveCommit,
    marketplace: world.marketplace, releaseTag: 'plugins-1.0.0', baseUrl: 'https://github.com/o/r/releases/download',
  };
  const first = await buildReleaseArtifacts(options);
  const second = await buildReleaseArtifacts(options);
  assert.deepEqual(world.buildCounts, {
    'suian-zcode-common': 1, 'suian-zcode-title': 1, 'suian-zcode-app-mcp': 1, 'suian-side-editor': 1,
  }, '第二次编排必须复用首轮构建与 ZIP');
  for (const zip of first.zips) {
    assert.equal(second.zips.find(item => item.plugin === zip.plugin).zipSha256, zip.zipSha256);
  }
});

test('输入漂移后再次编排：不复用旧 ZIP，重新构建并生成新 ZIP', async t => {
  const world = await makeWorld();
  const outDir = await mkdtemp(join(tmpdir(), 'pkg07-drift-'));
  t.after(() => rm(world.root, { recursive: true, force: true }));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const options = {
    repoRoot: world.root, outDir, builders: world.builders, resolveCommit: world.resolveCommit,
    marketplace: world.marketplace, releaseTag: 'plugins-1.0.0', baseUrl: 'https://github.com/o/r/releases/download',
  };
  const first = await buildReleaseArtifacts(options);
  await writeFile(join(world.root, 'suian-zcode-title', 'src.mjs'), '// title source mutated\n');
  const second = await buildReleaseArtifacts(options);
  assert.equal(world.buildCounts['suian-zcode-title'], 2, '输入变化必须重新构建对应包');
  assert.equal(world.buildCounts['suian-zcode-common'], 1, '未变包不得重跑');
  assert.notEqual(
    second.zips.find(item => item.plugin === 'suian-zcode-title').zipSha256,
    first.zips.find(item => item.plugin === 'suian-zcode-title').zipSha256,
  );
});

test('ZIP 不含提交 C 的自引用：条目与文本内容都不出现记录文件与提交 SHA', async t => {
  const world = await makeWorld();
  const outDir = await mkdtemp(join(tmpdir(), 'pkg07-noref-'));
  t.after(() => rm(world.root, { recursive: true, force: true }));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await buildReleaseArtifacts({
    repoRoot: world.root, outDir, builders: world.builders, resolveCommit: world.resolveCommit,
    marketplace: world.marketplace, releaseTag: 'plugins-1.0.0', baseUrl: 'https://github.com/o/r/releases/download',
  });
  for (const zip of result.zips) {
    const entries = await readZipEntries(zip.zipPath);
    assert.ok(!entries.some(entry => /record|candidate|state/.test(entry.path)), `ZIP 条目不得含发布记录：${entryPaths(entries)}`);
    for (const entry of entries) {
      const text = (await readZipEntry(zip.zipPath, entry.path)).toString('utf8');
      assert.equal(text.includes(COMMIT), false, `${zip.plugin}/${entry.path} 不得包含提交自引用`);
    }
  }
});

test('门禁：输入未漂移时绑定提交通过；源文件被改后报告漂移文件', async t => {
  const world = await makeWorld();
  const outDir = await mkdtemp(join(tmpdir(), 'pkg07-gate-'));
  t.after(() => rm(world.root, { recursive: true, force: true }));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const options = {
    repoRoot: world.root, outDir, builders: world.builders, resolveCommit: world.resolveCommit,
    marketplace: world.marketplace, releaseTag: 'plugins-1.0.0', baseUrl: 'https://github.com/o/r/releases/download',
  };
  const built = await buildReleaseArtifacts(options);
  const clean = await gateCommitInputs({ repoRoot: world.root, record: built.record, outDir });
  assert.equal(clean.ok, true, JSON.stringify(clean.drifted));
  await writeFile(join(world.root, 'suian-zcode-app-mcp', 'src.mjs'), '// app-mcp source mutated\n');
  const dirty = await gateCommitInputs({ repoRoot: world.root, record: built.record, outDir });
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.drifted.map(item => item.plugin), ['suian-zcode-app-mcp']);
});

test('版本统一检查：合成树与市场版本不一致只报告，不修改文件', async t => {
  const world = await makeWorld();
  const outDir = await mkdtemp(join(tmpdir(), 'pkg07-vcheck-'));
  t.after(() => rm(world.root, { recursive: true, force: true }));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await buildReleaseArtifacts({
    repoRoot: world.root, outDir, builders: world.builders, resolveCommit: world.resolveCommit,
    marketplace: world.marketplace, releaseTag: 'plugins-1.0.0', baseUrl: 'https://github.com/o/r/releases/download',
  });
  assert.equal(result.versionReport.ok, false, '市场旧版本 vs 合成 1.0.0 必须报告不一致');
  const fields = new Set(result.versionReport.mismatches.map(item => item.field));
  assert.deepEqual([...fields], ['marketplace']);
});

const entryPaths = entries => entries.map(entry => entry.path).join(', ');
