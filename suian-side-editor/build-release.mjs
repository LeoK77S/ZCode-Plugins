// 构建发布目录（PKG-04）：stdio CLI 打包（SDK/zod 等业务依赖内联）、薄适配与定位器独立
// 分发、经唯一 UI 构建入口（build-ui.mjs）产出的实际页面与第三方许可、市场/插件清单、
// release.json 与发布目录之外的构建输入记录。
// 业务输入不包含 common 实现或公共 vendor：common-client.mjs 与 locate.mjs 保持 external，
// 运行期从发布根的相对位置解析，公共代码由已安装的 common 插件提供。
import { build, version as esbuildVersion } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const run = promisify(execFile);
const toPosix = path => path.split(sep).join('/');
const defaultRoot = dirname(fileURLToPath(import.meta.url));
const TARGET = 'node24';
// 业务薄适配与定位器独立分发（不内联），发布根相对位置与源码根一致；
// ws 系可选原生加速包不进入本包。
const THIN_ADAPTER_EXTERNALS = ['./common-client.mjs', './locate.mjs'];
const EXTERNALS = [...THIN_ADAPTER_EXTERNALS, 'bufferutil', 'utf-8-validate'];

// esbuild 的 esm 产物中 __require shim 在 ESM 作用域没有 require 可用，CJS 依赖路径会
// 在模块求值阶段抛 Dynamic require；注入真实 createRequire（与 common 构建同法）。
const nodeRequireBanner = [
  "import { createRequire as __suianCreateRequire } from \"node:module\";",
  "const require = __suianCreateRequire(import.meta.url);",
].join(String.fromCharCode(10));

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const sortedObject = value => Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)));

async function walkFiles(dir, base = dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(path, base));
    else found.push(toPosix(relative(base, path)));
  }
  return found;
}

async function findLicense(root) {
  for (const candidate of [join(root, 'LICENSE'), join(root, '..', 'LICENSE')]) {
    try { await readFile(candidate); return candidate; } catch {}
  }
  throw new Error('找不到仓库 LICENSE（依次尝试构建根与其上级）');
}

async function packageLicense(packageDir, packageName) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    try { return await readFile(join(packageDir, name), 'utf8'); } catch {}
  }
  try {
    const meta = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
    if (meta.license) return `${packageName}\n声明许可：${meta.license}（包内无独立许可文件，字段来自 package.json）\n`;
  } catch {}
  return null;
}

export async function buildEditorRelease({ root = defaultRoot, outDir, skipUiBuild = false } = {}) {
  if (!outDir) throw new Error('缺少 --out <dir>');
  root = resolve(root);
  outDir = resolve(outDir);
  const commonSourceRoot = resolve(root, '..', 'suian-zcode-common');

  // 定位器单一源码约束：业务内副本必须与 common 逐字节一致，防止双源漂移。
  const locateSource = await readFile(join(commonSourceRoot, 'locate.mjs'), 'utf8');
  if (await readFile(join(root, 'locate.mjs'), 'utf8') !== locateSource) {
    throw new Error('locate.mjs 副本与 common 单一源码不一致：请先同步 suian-side-editor/locate.mjs 再构建');
  }

  // 唯一 UI 构建入口产出实际页面；本脚本不手改生成 HTML。
  if (!skipUiBuild) await run(process.execPath, ['build-ui.mjs'], { cwd: root, windowsHide: true });

  // 构建前清空输出目录：残留旧文件会进入 release.json 清单与 buildId，重复构建必须幂等。
  const staleEntries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  if (staleEntries.some(entry => entry.name === '.git')) throw new Error('输出目录包含 .git，疑似误传仓库路径，拒绝清空');
  if (staleEntries.length > 0) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, 'cli.mjs')],
    outfile: join(outDir, 'cli.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: TARGET,
    banner: { js: nodeRequireBanner },
    legalComments: 'inline',
    metafile: true,
    logLevel: 'silent',
    external: EXTERNALS,
  });

  // 允许清单：薄适配与定位器、实际构建 UI 与其第三方许可、隐藏插件清单目录、
  // 市场 MCP 注册、setup 技能与仓库许可。不含 node_modules、测试与文档。
  await cp(join(root, 'common-client.mjs'), join(outDir, 'common-client.mjs'));
  await cp(join(root, 'locate.mjs'), join(outDir, 'locate.mjs'));
  await cp(join(root, 'ui', 'dist'), join(outDir, 'ui', 'dist'), { recursive: true });
  await cp(join(root, '.zcode-plugin'), join(outDir, '.zcode-plugin'), { recursive: true });
  await cp(join(root, '.mcp.json'), join(outDir, '.mcp.json'));
  await cp(join(root, 'skills'), join(outDir, 'skills'), { recursive: true });
  await cp(await findLicense(root), join(outDir, 'LICENSE'));

  // 内联进 bundle 的第三方依赖保留独立许可文件；页面侧 CodeMirror 许可已在 ui/dist 内。
  const bundledPackages = [...new Set(Object.keys(result.metafile.inputs)
    .filter(path => path.startsWith('node_modules/'))
    .map(path => {
      const parts = path.slice('node_modules/'.length).split('/');
      return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    }))].sort();
  for (const name of bundledPackages) {
    const license = await packageLicense(join(root, 'node_modules', name), name);
    if (license) {
      await mkdir(join(outDir, 'licenses'), { recursive: true });
      await writeFile(join(outDir, 'licenses', `${name.replaceAll('/', '--')}-LICENSE`), license);
    }
  }

  const files = [];
  for (const path of (await walkFiles(outDir)).sort()) {
    const content = await readFile(join(outDir, path));
    files.push({ path, sha256: sha256(content), bytes: content.length });
  }

  const manifest = JSON.parse(await readFile(join(root, '.zcode-plugin', 'plugin.json'), 'utf8'));
  const packageName = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name;
  const commonManifest = JSON.parse(await readFile(join(commonSourceRoot, '.zcode-plugin', 'plugin.json'), 'utf8'));
  const config = { target: TARGET, entries: { cli: 'cli.mjs' }, thinAdapter: THIN_ADAPTER_EXTERNALS, external: EXTERNALS, esbuildVersion };
  const inputs = {};
  for (const inputKey of Object.keys(result.metafile.inputs)) {
    inputs[toPosix(inputKey)] = sha256(await readFile(join(root, inputKey)));
  }
  // 薄定位器来自公共单一源码；最低兼容版本也读取公共清单，二者都是实际组装输入。
  for (const path of ['locate.mjs', '.zcode-plugin/plugin.json']) {
    const inputPath = join(commonSourceRoot, path);
    inputs[toPosix(relative(root, inputPath))] = sha256(await readFile(inputPath));
  }
  const inputDigest = sha256(JSON.stringify({ config, inputs: sortedObject(inputs) }));
  const buildId = sha256(JSON.stringify({ inputDigest, outputs: files.map(({ path, sha256: digest }) => [path, digest]) }));
  const release = {
    formatVersion: 1,
    pluginName: manifest.name,
    packageName,
    pluginVersion: manifest.version,
    buildId,
    // 兼容声明为顶层字段（规格 5.3，与 title/app-mcp 一致）：depcheck/locate/verify 按顶层读取，
    // 嵌套形状无人消费曾使 API 兼容检测静默跳过。
    commonApiVersion: 1,
    minimumCommonVersion: commonManifest.version,
    entries: { cli: 'cli.mjs', commonClient: 'common-client.mjs', locate: 'locate.mjs', page: 'ui/dist/editor.html' },
    files,
  };
  await writeFile(join(outDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);

  // 构建证据落在发布目录之外，不进入文件清单。
  const inputsPath = join(dirname(outDir), 'build-inputs.json');
  await writeFile(inputsPath, `${JSON.stringify({ config, inputDigest, inputs: sortedObject(inputs), bundledPackages }, null, 2)}\n`);
  const metafilePath = join(dirname(outDir), 'build-metafile.json');
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return { releaseDir: outDir, release, inputsPath, metafilePath, buildInputs: { config, inputDigest, inputs }, metafile: result.metafile };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const result = await buildEditorRelease({ outDir: values.out });
  console.log(JSON.stringify({ releaseDir: result.releaseDir, buildId: result.release.buildId, inputsPath: result.inputsPath }));
}
