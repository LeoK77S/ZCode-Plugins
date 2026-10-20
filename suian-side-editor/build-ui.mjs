import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ['ui/editor.mjs'], bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'chrome120', minify: true,
  legalComments: 'inline', metafile: true
});
const packages = new Set(Object.keys(result.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => {
  const parts = path.slice('node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}));
const licenses = await Promise.all([...packages].sort().map(async name => `${name}\n${await readFile(join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`));
const licenseText = licenses.join('\n\n---\n\n');
const template = await readFile(join(root, 'ui/editor-template.html'), 'utf8');
const css = await readFile(join(root, 'ui/editor.css'), 'utf8');
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = template.replace('<!-- EDITOR_LICENSES -->', () => `<!-- 第三方依赖许可（自动构建）\n${licenseText}\n-->`)
  .replace('<!-- EDITOR_STYLE -->', () => `<style>${css}</style>`).replace('<!-- EDITOR_SCRIPT -->', () => `<script type="module">${script}</script>`);
const output = resolve(root, 'ui/dist');
await mkdir(output, { recursive: true });
// autocrlf 环境下入库产物 checkout 为 CRLF，重建输出为 LF；内容按 LF 归一等价时
// 跳过写回，避免每次构建都因行尾差异把工作树标脏、阻断发布门禁的清洁检查。
const writeIfUnchanged = async (file, content) => {
  const normalize = value => Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'));
  let existing = null;
  try { existing = await readFile(file); } catch {}
  if (existing && Buffer.compare(normalize(existing), normalize(content)) === 0) return;
  await writeFile(file, content);
};
await writeIfUnchanged(join(output, 'editor.html'), html);
await writeIfUnchanged(join(output, 'THIRD-PARTY-LICENSES.txt'), licenseText);
console.log(`已构建本地编辑器：${Buffer.byteLength(html)} 字节；${packages.size} 个依赖许可`);
