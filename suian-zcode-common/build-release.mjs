// 构建发布目录（PKG-01）：esbuild 多入口打包 + 许可/元数据组装 + release.json + 构建输入记录。
// 构建输入记录与 release.json 都只描述实际进入发布目录的文件；文件清单不含 release.json 自身。
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const toPosix = path => path.split(sep).join('/');
const defaultRoot = dirname(fileURLToPath(import.meta.url));
const ENTRIES = { client: 'client.mjs', 'client-install': 'client-install.mjs' };
const DIST_ENTRIES = { client: 'dist/client.mjs', 'client-install': 'dist/client-install.mjs' };

// esbuild 的 esm 产物中 __require shim 在 ESM 作用域没有 require 可用，ws 的 CJS 路径会
// 在模块求值阶段抛 Dynamic require；注入真实 createRequire（与官方 node-repl-host 构建同法）。
const nodeRequireBanner = [
  "import { createRequire as __suianCreateRequire } from \"node:module\";",
  "const require = __suianCreateRequire(import.meta.url);",
].join(String.fromCharCode(10));
const TARGET = 'node24';
// ws 的可选原生加速包：保持 external，运行期缺省回退纯 JS 实现。
const EXTERNALS = ['bufferutil', 'utf-8-validate'];
const VENDOR_STATIC = ['LICENSE-ZCode', 'NOTICE-ZCode-current.md', 'LICENSE-zod', 'NOTICE.md', 'conversation-wire.sources.json'];

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
    try { await readFile(candidate); return candidate; } catch {}
  }
  throw new Error("找不到仓库 LICENSE（依次尝试构建根、其上级、构建脚本所在仓库）");
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
      external: EXTERNALS,
    });
    for (const inputKey of Object.keys(result.metafile.inputs)) {
      inputs[normalizeKey(root, inputKey)] = sha256(await readFile(resolve(inputKey)));
    }
  }

  // 允许清单：许可与插件清单目录（隐藏目录随 recursive 复制进入）。
  await cp(join(root, '.zcode-plugin'), join(outDir, '.zcode-plugin'), { recursive: true });
  await mkdir(join(outDir, 'vendor'), { recursive: true });
  for (const name of VENDOR_STATIC) {
    await cp(join(root, 'vendor', name), join(outDir, 'vendor', name));
  }
  const licenseSource = await findLicense(root);
  await cp(licenseSource, join(outDir, 'LICENSE'));
  await mkdir(join(outDir, 'licenses'), { recursive: true });
  await cp(join(root, 'node_modules', 'ws', 'LICENSE'), join(outDir, 'licenses', 'ws-LICENSE'));

  const files = [];
  for (const path of (await walkFiles(outDir)).sort()) {
    const content = await readFile(join(outDir, path));
    files.push({ path, sha256: sha256(content), bytes: content.length });
  }

  const config = { target: TARGET, entries: ENTRIES, external: EXTERNALS, esbuildVersion };
  const inputDigest = sha256(JSON.stringify({ config, inputs: sortedObject(inputs) }));
  const buildId = sha256(JSON.stringify({ inputDigest, outputs: files.map(({ path, sha256: digest }) => [path, digest]) }));

  const manifest = JSON.parse(await readFile(join(root, '.zcode-plugin', 'plugin.json'), 'utf8'));
  const release = {
    formatVersion: 1,
    pluginName: manifest.name,
    packageName: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name,
    pluginVersion: manifest.version,
    buildId,
    commonApiVersion: (await import(pathToFileURL(join(root, 'client.mjs')).href)).COMMON_API_VERSION,
    entries: { ...DIST_ENTRIES },
    files,
  };
  await writeFile(join(outDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);

  // 构建输入记录是发布证据，落在发布目录之外，不进入文件清单。
  const inputsPath = join(dirname(outDir), 'build-inputs.json');
  await writeFile(inputsPath, `${JSON.stringify({ config, inputDigest, inputs: sortedObject(inputs) }, null, 2)}\n`);
  return { releaseDir: outDir, release, inputsPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const result = await buildRelease({ outDir: values.out });
  console.log(JSON.stringify({ releaseDir: result.releaseDir, buildId: result.release.buildId, inputsPath: result.inputsPath }));
}
