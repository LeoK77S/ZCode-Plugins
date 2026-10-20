// PKG-07 失败契约（工单验收第一条）：错误版本、缺隐藏清单/资源、公共代码重复内联、
// 敏感文件混入、摘要错误——在有缺陷的组装目录上必须以明确 code 失败；合法目录通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeReleaseDir, sha256 } from './release-fixtures.mjs';
import { verifyReleaseDir, PLUGIN_PROFILES } from '../release-verify.mjs';

const stage = async options => {
  const dir = await mkdtemp(join(tmpdir(), 'pkg07-verify-'));
  const made = await makeReleaseDir(dir, options);
  return { dir, ...made };
};

const titleShape = {
  pluginName: 'suian-zcode-title',
  version: '0.1.5',
  packageName: 'oil-zcode-title-runner',
  files: {
    'dist/cli.mjs': '// cli\n',
    'dist/hook.mjs': '// hook\n',
    'dist/install.mjs': '// install\n',
    'dist/toast-action.mjs': '// toast\n',
    'prompt.md': '# prompt\n',
    'SKILL.md': '# skill\n',
    'hooks/hooks.json': '{}\n',
  },
  releaseOverrides: release => ({
    ...release,
    entries: { cli: 'dist/cli.mjs', hook: 'dist/hook.mjs', install: 'dist/install.mjs', 'toast-action': 'dist/toast-action.mjs' },
  }),
};

const codes = result => new Set(result.problems.map(problem => problem.code));

test('失败契约：错误版本——市场期望版本与组装目录不一致必须拒绝', async t => {
  const made = await stage({ ...titleShape });
  t.after(() => rm(made.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.2.0' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).has('version_mismatch'), `必须有 version_mismatch，实际 ${JSON.stringify(result.problems)}`);
});

test('失败契约：plugin.json 与 release.json 互指版本不一致必须拒绝', async t => {
  const made = await stage({ ...titleShape, releaseOverrides: release => ({ ...release, pluginVersion: '9.9.9' }) });
  t.after(() => rm(made.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).has('version_mismatch'));
});

test('失败契约：缺隐藏插件清单目录必须拒绝', async t => {
  const made = await stage({ ...titleShape, omit: ['.zcode-plugin/plugin.json'] });
  t.after(() => rm(made.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).has('manifest_missing'), `必须有 manifest_missing，实际 ${JSON.stringify(result.problems)}`);
});

test('失败契约：缺必备入口与资源必须拒绝（title 四入口/提示词/技能/Hook 清单）', async t => {
  for (const missing of ['dist/hook.mjs', 'prompt.md', 'hooks/hooks.json', 'skills/setup/SKILL.md']) {
    const made = await stage({ ...titleShape, omit: [missing] });
    try {
      const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5' });
      assert.equal(result.ok, false, `缺 ${missing} 必须失败`);
      assert.ok(codes(result).has(missing.startsWith('dist/') ? 'entry_missing' : 'resource_missing'),
        `缺 ${missing} 的 code 不符：${JSON.stringify(result.problems)}`);
    } finally {
      await rm(made.dir, { recursive: true, force: true });
    }
  }
});

test('失败契约：公共代码重复内联——业务目录含 common 实现文件副本必须拒绝', async t => {
  // 构造 common 发布目录（最小形状），再构造"内联了 common dist/client.mjs"的业务目录。
  const commonCommon = await stage({
    pluginName: 'suian-zcode-common', version: '0.4.2', packageName: 'suian-zcode-common',
    omit: ['dist/cli.mjs'],
    files: {
      'dist/client.mjs': '// common client implementation\n',
      'dist/client-install.mjs': '// common client-install implementation\n',
      'toast-executor.mjs': '// toast executor\n',
      'vendor/LICENSE-ZCode': 'MIT\n',
      'vendor/NOTICE-ZCode-current.md': 'notice\n',
      'vendor/LICENSE-zod': 'MIT\n',
      'vendor/NOTICE.md': 'notice\n',
      'vendor/conversation-wire.sources.json': '{}\n',
      'licenses/ws-LICENSE': 'MIT\n',
    },
    releaseOverrides: release => ({ ...release, entries: { client: 'dist/client.mjs', 'client-install': 'dist/client-install.mjs' } }),
  });
  const business = await stage({
    ...titleShape,
    files: { ...titleShape.files, 'dist/inlined-common.js': '// common client implementation\n' },
  });
  t.after(() => rm(commonCommon.dir, { recursive: true, force: true }));
  t.after(() => rm(business.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({
    releaseDir: business.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5',
    commonReleaseDir: commonCommon.dir,
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).has('common_inline'), `必须有 common_inline，实际 ${JSON.stringify(result.problems)}`);
});

test('公共内联白名单：薄定位器 locate.mjs 允许与 common 逐字节一致，不算内联', async t => {
  const commonCommon = await stage({
    pluginName: 'suian-zcode-common', version: '0.4.2', packageName: 'suian-zcode-common',
    omit: ['dist/cli.mjs'],
    files: { 'dist/client.mjs': '// impl\n', 'locate.mjs': '// thin locator\n' },
    releaseOverrides: release => ({ ...release, entries: { client: 'dist/client.mjs' } }),
  });
  const editor = await stage({
    pluginName: 'suian-side-editor', version: '0.3.0', packageName: 'suian-side-editor',
    omit: ['dist/cli.mjs'],
    files: {
      'cli.mjs': '// cli\n', 'common-client.mjs': '// adapter\n', 'locate.mjs': '// thin locator\n',
      'ui/dist/editor.html': '<html></html>\n', '.mcp.json': '{}\n',
      // 各包技能内容本不相同；fixture 默认值与 common 相同会被内联检测按逐字节副本正确拒绝。
      'skills/setup/SKILL.md': '# editor setup skill\n',
    },
    releaseOverrides: release => ({ ...release, entries: { cli: 'cli.mjs' } }),
  });
  t.after(() => rm(commonCommon.dir, { recursive: true, force: true }));
  t.after(() => rm(editor.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({
    releaseDir: editor.dir, pluginName: 'suian-side-editor', expectedVersion: '0.3.0',
    commonReleaseDir: commonCommon.dir,
  });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
});

test('第三方许可可各包保留，但把 common 实现改名为许可证仍须拒绝', async t => {
  const license = (await readFile(new URL('../suian-zcode-common/vendor/LICENSE-zod', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const implementation = '// shared implementation, not a license\n';
  const common = await stage({
    pluginName: 'suian-zcode-common', version: '0.4.2',
    omit: ['dist/cli.mjs'],
    files: { 'vendor/LICENSE-zod': license, 'dist/client.mjs': implementation },
  });
  t.after(() => rm(common.dir, { recursive: true, force: true }));
  for (const copiedImplementation of [false, true]) {
    const business = await stage({
      ...titleShape,
      files: {
        ...titleShape.files, 'skills/setup/SKILL.md': '# title setup\n',
        'licenses/zod-LICENSE': license,
        ...(copiedImplementation ? { 'licenses/fake-LICENSE': implementation } : {}),
      },
    });
    t.after(() => rm(business.dir, { recursive: true, force: true }));
    const result = await verifyReleaseDir({
      releaseDir: business.dir, pluginName: 'suian-zcode-title', commonReleaseDir: common.dir,
    });
    assert.deepEqual(result.problems.filter(problem => problem.code === 'common_inline').map(problem => problem.path),
      copiedImplementation ? ['licenses/fake-LICENSE'] : []);
    assert.equal(result.ok, !copiedImplementation, JSON.stringify(result.problems));
  }
});

test('失败契约：敏感文件混入——凭据、日志、数据与 node_modules 必须拒绝', async t => {
  for (const [path, content, expectedCode] of [
    ['debug.log', 'x', 'sensitive_file'],
    ['.env', 'TOKEN=1', 'sensitive_file'],
    ['credentials.json', '{}', 'sensitive_file'],
    ['run-data/session-abc.json', '{}', 'sensitive_file'],
    ['node_modules/ws/index.js', 'x', 'forbidden_present'],
    ['tests/leak.test.mjs', 'x', 'forbidden_present'],
    ['docs/notes.md', 'x', 'forbidden_present'],
  ]) {
    const made = await stage({ ...titleShape, files: { ...titleShape.files, [path]: content } });
    try {
      const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5' });
      assert.equal(result.ok, false, `${path} 混入必须失败`);
      assert.ok(codes(result).has(expectedCode), `${path} 期望 code ${expectedCode}，实际 ${JSON.stringify(result.problems)}`);
    } finally {
      await rm(made.dir, { recursive: true, force: true });
    }
  }
});

test('失败契约：敏感内容——本机绝对路径与凭据模式进入文本文件必须拒绝', async t => {
  const made = await stage({
    ...titleShape,
    files: { ...titleShape.files, 'dist/cli.mjs': `// cache at C:\\Users\\64487\\.zcode\\cache\n// token ghp_0123456789abcdefghij0123456789abcdefghij\n` },
  });
  t.after(() => rm(made.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({
    releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5',
    sensitiveRoots: [join(tmpdir(), 'leak-marker-')],
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).has('sensitive_content'), JSON.stringify(result.problems));
});

test('失败契约：摘要错误——release.json 文件清单与实际内容不符必须拒绝', async t => {
  const made = await stage({
    ...titleShape,
    releaseOverrides: release => {
      release.files = release.files.map(file => (file.path === 'prompt.md' ? { ...file, sha256: sha256(Buffer.from('tampered')) } : file));
      return release;
    },
  });
  t.after(() => rm(made.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).has('digest_mismatch'), JSON.stringify(result.problems));
});

test('合法 title 形状组装目录通过校验', async t => {
  const made = await stage({ ...titleShape });
  t.after(() => rm(made.dir, { recursive: true, force: true }));
  const result = await verifyReleaseDir({ releaseDir: made.dir, pluginName: 'suian-zcode-title', expectedVersion: '0.1.5' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('四插件允许清单 profile 齐备且指向仓库实际插件名', () => {
  assert.deepEqual(Object.keys(PLUGIN_PROFILES).sort(), [
    'suian-side-editor', 'suian-zcode-app-mcp', 'suian-zcode-common', 'suian-zcode-title',
  ]);
  for (const profile of Object.values(PLUGIN_PROFILES)) {
    assert.ok(Array.isArray(profile.requiredFiles) && profile.requiredFiles.includes('.zcode-plugin/plugin.json'));
  }
});
