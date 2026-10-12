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
const template = await readFile(join(root, 'ui/editor-template.html'), 'utf8');
const css = await readFile(join(root, 'ui/editor.css'), 'utf8');
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = template.replace('<!-- EDITOR_STYLE -->', () => `<style>${css}</style>`).replace('<!-- EDITOR_SCRIPT -->', () => `<script type="module">${script}</script>`);
const output = resolve(root, 'ui/dist');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'editor.html'), html);
await writeFile(join(output, 'THIRD-PARTY-LICENSES.txt'), licenses.join('\n\n---\n\n'));
console.log(`已构建本地编辑器：${Buffer.byteLength(html)} 字节；${packages.size} 个依赖许可`);
