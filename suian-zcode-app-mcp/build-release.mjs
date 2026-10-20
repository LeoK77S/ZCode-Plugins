// 构建发布目录（PKG-03）：esbuild 多入口 bundle（SDK/zod 内联进业务产物）+ 资源与清单组装 +
// release.json + 构建输入记录。公共实现不进入业务产物：common 侧输入仅允许薄定位器 locate.mjs，
// 运行期经 loadCommonModule 动态加载已安装 common 发布目录（PKG-01 契约）。
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EXPECTED_COMMON_API_VERSION, MINIMUM_COMMON_VERSION } from './common-client.mjs';

const toPosix = path => path.split(sep).join('/');
const defaultRoot = dirname(fileURLToPath(import.meta.url));
const ENTRIES = { cli: 'cli.mjs', 'artifact-hook': 'artifact-hook.mjs', install: 'install.mjs' };
const DIST_ENTRIES = { cli: 'dist/cli.mjs', 'artifact-hook': 'dist/artifact-hook.mjs', install: 'dist/install.mjs' };

// 与 common 构建同法：esbuild esm 产物的 __require shim 在 ESM 作用域无 require 可用，
// 注入真实 createRequire 防止依赖链中的 CJS 路径在模块求值阶段抛错。
const nodeRequireBanner = [
  "import { createRequire as __suianCreateRequire } from \"node:module\";",
  "const require = __suianCreateRequire(import.meta.url);",
].join(String.fromCharCode(10));
const TARGET = 'node24';
// 薄定位器：common 侧唯一允许进入业务构建输入的文件（契约 client-contract.md）
const COMMON_LOCATOR = '../suian-zcode-common/locate.mjs';
const THIRD_PARTY = [
  { dir: '@modelcontextprotocol/sdk', name: 'mcp-sdk-LICENSE' },
  { dir: 'zod', name: 'zod-LICENSE' },
];

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const normalizeKey = (root, key) => toPosix(relative(root, resolve(key)));
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
  for (const candidate of [join(root, "LICENSE"), join(root, "..", "LICENSE"), join(defaultRoot, "..", "LICENSE")]) {
    try { await readFile(candidate); return candidate; }
    catch {}
  }
  throw new Error("找不到仓库 LICENSE（依次尝试构建根、其上级、构建脚本所在仓库）");
}

// 发布清单指向 dist 入口：模板变量语义（${ZCODE_PLUGIN_ROOT}/${ZCODE_PLUGIN_DATA}）保持不变
async function writeReleaseManifests(root, outDir) {
  for (const [source, target] of [['.mcp.json', '.mcp.json'], [join('hooks', 'hooks.json'), join('hooks', 'hooks.json')]]) {
    const text = await readFile(join(root, source), 'utf8');
    await mkdir(dirname(join(outDir, target)), { recursive: true });
    await writeFile(join(outDir, target), text
      .replaceAll('${ZCODE_PLUGIN_ROOT}/cli.mjs', '${ZCODE_PLUGIN_ROOT}/dist/cli.mjs')
      .replaceAll('${ZCODE_PLUGIN_ROOT}/artifact-hook.mjs', '${ZCODE_PLUGIN_ROOT}/dist/artifact-hook.mjs')
      .replaceAll('${ZCODE_PLUGIN_ROOT}/install.mjs', '${ZCODE_PLUGIN_ROOT}/dist/install.mjs'));
  }
}

export async function buildRelease({ root = defaultRoot, outDir } = {}) {
  if (!outDir) throw new Error('缺少 --out <dir>');
  root = resolve(root);
  outDir = resolve(outDir);
  const distDir = join(outDir, 'dist');
  await mkdir(distDir, { recursive: true });

  const inputs = {};
  for (const [key, entry] of Object.entries(ENTRIES)) {
    const result = await build({
      entryPoints: [join(root, entry)],
      outfile: join(outDir, DIST_ENTRIES[key]),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: TARGET,
      banner: { js: nodeRequireBanner },
      legalComments: 'inline',
      metafile: true,
      logLevel: 'silent',
    });
    for (const inputKey of Object.keys(result.metafile.inputs)) {
      inputs[normalizeKey(root, inputKey)] = sha256(await readFile(resolve(inputKey)));
    }
  }

  // 公共实现不内联：common 侧构建输入仅允许薄定位器（验收：metafile 排除 common 实现与公共 vendor）
  const commonInputs = Object.keys(inputs).filter(key => key.startsWith('../suian-zcode-common/'));
  const unexpected = commonInputs.filter(key => key !== COMMON_LOCATOR);
  if (unexpected.length) throw new Error(`业务构建输入包含 common 实现，拒绝产出：${unexpected.join(', ')}`);
  if (!commonInputs.includes(COMMON_LOCATOR)) throw new Error(`构建输入缺少薄定位器 ${COMMON_LOCATOR}`);

  // 允许清单：面板资源（随入口位于 dist/ui，保持 './ui/...' 相对引用两种模式一致）、技能、
  // 隐藏插件清单目录、源码路由技能模板、示例配置、自有 vendor 声明与第三方许可。
  await cp(join(root, 'ui'), join(distDir, 'ui'), { recursive: true });
  await cp(join(root, 'skills'), join(outDir, 'skills'), { recursive: true });
  await cp(join(root, '.zcode-plugin'), join(outDir, '.zcode-plugin'), { recursive: true });
  await mkdir(join(outDir, 'vendor'), { recursive: true });
  await cp(join(root, 'vendor', 'NOTICE.md'), join(outDir, 'vendor', 'NOTICE.md'));
  await cp(join(root, 'SKILL.md'), join(outDir, 'SKILL.md'));
  await cp(join(root, 'mcp.config.example.json'), join(outDir, 'mcp.config.example.json'));
  const licenseSource = await findLicense(root);
  await cp(licenseSource, join(outDir, 'LICENSE'));
  await mkdir(join(outDir, 'licenses'), { recursive: true });
  for (const thirdParty of THIRD_PARTY) {
    await cp(join(root, 'node_modules', thirdParty.dir, 'LICENSE'), join(outDir, 'licenses', thirdParty.name));
  }
  await writeReleaseManifests(root, outDir);

  const files = [];
  for (const path of (await walkFiles(outDir)).sort()) {
    const content = await readFile(join(outDir, path));
    files.push({ path, sha256: sha256(content), bytes: content.length });
  }

  const config = { target: TARGET, entries: ENTRIES, esbuildVersion };
  const inputDigest = sha256(JSON.stringify({ config, inputs: sortedObject(inputs) }));
  const buildId = sha256(JSON.stringify({ inputDigest, outputs: files.map(({ path, sha256: digest }) => [path, digest]) }));

  const manifest = JSON.parse(await readFile(join(root, '.zcode-plugin', 'plugin.json'), 'utf8'));
  const release = {
    formatVersion: 1,
    pluginName: manifest.name,
    packageName: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name,
    pluginVersion: manifest.version,
    buildId,
    expectedCommonApiVersion: EXPECTED_COMMON_API_VERSION,
    minimumCommonVersion: MINIMUM_COMMON_VERSION,
    entries: { ...DIST_ENTRIES },
    files,
  };
  await writeFile(join(outDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);

  // 构建输入记录是发布证据，落在发布目录之外，不进入文件清单
  const inputsPath = join(dirname(outDir), `${basename(outDir)}-build`, 'build-inputs.json');
  await mkdir(dirname(inputsPath), { recursive: true });
  await writeFile(inputsPath, `${JSON.stringify({ config, inputDigest, inputs: sortedObject(inputs) }, null, 2)}\n`);
  return { releaseDir: outDir, release, inputsPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const result = await buildRelease({ outDir: values.out });
  console.log(JSON.stringify({ releaseDir: result.releaseDir, buildId: result.release.buildId, inputsPath: result.inputsPath }));
}
