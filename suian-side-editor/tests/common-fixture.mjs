// 源码与发布测试共用的公共 common 安装夹具（PKG-04）。
// 在临时目录组装宿主安装存储根：<root>/installed_plugins.json + <root>/data/<插件目录>/，
// installPath 指向按 PKG-01 构建的真实 common 发布目录；进程内以 ZCODE_PLUGIN_DATA 命中
// 宿主 stdio 注入的同名锚点，定位器按“向上两级即存储根”的真实布局推导安装记录。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease as buildCommonRelease } from '../../suian-zcode-common/build-release.mjs';
import { commonClient } from '../common-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const editorRoot = resolve(here, '..');
export const commonSourceRoot = resolve(here, '..', '..', 'suian-zcode-common');

let fixture;

export function ensureCommonFixture() {
  fixture ??= (async () => {
    // 清理宿主（如在 ZCode 内运行测试）注入的应用版本与编辑器环境：测试对默认参数的
    // 预期必须显式传入，不随进程环境漂移。
    for (const key of ['ZCODE_APP_VERSION', 'SUIAN_SIDE_EDITOR_WORKSPACE', 'SUIAN_SIDE_EDITOR_GATEWAY_CONFIG', 'SUIAN_SIDE_EDITOR_INDEX_DB']) {
      delete process.env[key];
    }
    const base = await mkdtemp(join(tmpdir(), 'pkg04-common-fixture-'));
    const commonRelease = join(base, 'common-release');
    const built = await buildCommonRelease({ root: commonSourceRoot, outDir: commonRelease });
    const storageRoot = join(base, 'storage');
    const dataPath = join(storageRoot, 'data', 'suian-side-editor');
    await mkdir(dataPath, { recursive: true });
    await writeFile(join(storageRoot, 'installed_plugins.json'), `${JSON.stringify({
      version: 1,
      plugins: [{
        id: 'suian-zcode-common@suian-zcode-plugins',
        name: 'suian-zcode-common',
        marketplace: 'suian-zcode-plugins',
        version: built.release.pluginVersion,
        installPath: commonRelease,
      }],
    }, null, 2)}\n`);
    // 测试进程统一使用夹具锚点，避免命中用户真实安装记录；子进程测试按需显式携带同一 dataPath。
    process.env.ZCODE_PLUGIN_DATA = dataPath;
    await commonClient();
    return { base, storageRoot, dataPath, commonRelease, commonPluginVersion: built.release.pluginVersion };
  })();
  return fixture;
}

// 在夹具存储根的真实布局（<storageRoot>/data/<目录>）下新建隔离数据目录：
// 编辑器状态库与定位锚点共享同一 dataPath 语义，且不与其他测试串扰。
export async function isolatedDataPath() {
  const { storageRoot } = await ensureCommonFixture();
  const dir = join(storageRoot, 'data', `test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
