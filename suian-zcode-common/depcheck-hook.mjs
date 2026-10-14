#!/usr/bin/env node
// ZCode Stop Hook：扫描已安装 suian 系列插件的依赖完整性，缺失时经 Toast 提醒并给出复制修复提示词的按钮。
// 约定（源码核实）：hooks.json 以 async:true 注册，宿主 fire-and-forget，stdout 决策被忽略；
// stop_hook_active=true 表示本轮由 Stop 续跑产生，跳过；stdout 不得以 { 开头；恒 exit 0，异常吞掉记日志。
// 本钩子及其导入链（depcheck/notifications/notification-install/cooldown/windows）只用 Node 内置模块，
// 且全部为 common 包内相对导入——不经 node_modules 解析，依赖全丢时仍可运行并报警。
import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanSuianPlugins } from './depcheck.mjs';
import { buildToastMessage } from './depcheck-prompt.mjs';
import { notifyOnce } from './notifications.mjs';
import { installToastAssets } from './notification-install.mjs';

export const TOAST_IDENTITY = {
  protocol: 'suian-zcode-common',
  appId: 'SUIAN.SuianZcodeCommon.Toast',
  shortcutName: 'ZCode 公共基础插件.lnk',
  description: 'ZCode 公共基础插件通知',
};
export const TOAST_TITLE = 'suian 插件依赖不完整';
export const TOAST_REASON_CODE = 'dependency-incomplete';

const pluginRoot = dirname(fileURLToPath(import.meta.url));

export function resolveDataDir(env = process.env) {
  if (env.ZCODE_PLUGIN_DATA) return join(env.ZCODE_PLUGIN_DATA, 'state');
  return join(homedir(), '.zcode', 'suian-zcode-common');
}

// Toast 身份归调用方：common 首次报警前确保自己的协议/AppID/快捷方式已注册（幂等，成功后由 appid 缓存短路）。
export async function ensureToastIdentity({ dataDir, install = installToastAssets }) {
  try {
    const cached = (await readFile(join(dataDir, 'toast-appid.txt'), 'utf8')).trim();
    if (cached === TOAST_IDENTITY.appId) return { action: 'cached' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await install({ pluginRoot, dataDir, ...TOAST_IDENTITY });
  return { action: 'installed' };
}

async function persistLastResult(dataDir, result) {
  await mkdir(dataDir, { recursive: true });
  const temporary = join(dataDir, 'depcheck-last.tmp-' + randomUUID());
  await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', 'utf8');
  await rename(temporary, join(dataDir, 'depcheck-last.json'));
}

const defaultNotify = ({ dataDir, message }) => notifyOnce({
  dataDir,
  appId: TOAST_IDENTITY.appId,
  title: TOAST_TITLE,
  message,
  reasonCode: TOAST_REASON_CODE,
  actionLabel: '复制修复提示词并打开 ZCode',
  actionUri: `${TOAST_IDENTITY.protocol}://fix`,
});

// SUIAN_DEPCHECK_HOME 仅供测试与人工诊断覆盖扫描根；生产路径走宿主真实用户目录。
const defaultScan = () => scanSuianPlugins({ homeDir: process.env.SUIAN_DEPCHECK_HOME || undefined });

export async function runDepcheckHook({ payload, dataDir, scan = defaultScan, ensureIdentity = ensureToastIdentity, notify = defaultNotify, persist = persistLastResult }) {
  if (!payload || typeof payload !== 'object') return { action: 'ignored_invalid' };
  if (payload.stop_hook_active === true) return { action: 'skipped_stale' };
  const result = await scan();
  if (result.skipped) return { action: 'skipped', reason: result.skipped };
  await persist(dataDir, result);
  if (result.ok) return { action: 'clean' };
  const identity = await ensureIdentity({ dataDir });
  const toast = await notify({ dataDir, message: buildToastMessage(result) });
  return { action: 'notified', issues: result.issues.length, identity: identity.action, shown: toast.shown === true, toastReason: toast.reason ?? null };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let dataDirArg = null;
  const scanOnly = process.argv.includes('--scan-only');
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--data-dir' && process.argv[i + 1]) dataDirArg = resolve(process.argv[++i]);
  }
  const dataDir = dataDirArg ?? resolveDataDir();
  const logHook = async entry => {
    try {
      await mkdir(dataDir, { recursive: true });
      await appendFile(join(dataDir, 'hook.log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    } catch {}
  };
  try {
    if (scanOnly) {
      const result = await scanSuianPlugins({ homeDir: process.env.SUIAN_DEPCHECK_HOME || undefined });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    const result = await runDepcheckHook({ payload, dataDir });
    console.log('suian-zcode-common:', JSON.stringify(result));
    await logHook({ event: payload?.hook_event_name ?? 'Stop', action: result.action, sessionId: payload?.session_id ?? null, error: null });
  } catch (error) {
    console.log('suian-zcode-common: hook-error', error.message);
    await logHook({ event: 'Stop', action: 'error', error: String(error.message).slice(0, 200) });
  }
  process.exit(0);
}
