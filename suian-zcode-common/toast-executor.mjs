#!/usr/bin/env node
// suian 共享 Toast 执行器（PKG-06 部署快照）：common 在安装/报警时把本文件原样部署到
// <homeDir>/.zcode/tools/suian-zcode-common/toast/executor.mjs（版本缓存之外）。
// 单文件自包含、只依赖 Node 内置模块：即便 common 与 title 的插件缓存被整体删除，
// 旧通知点击仍能现场诊断并复制修复提示。更新仅经 common 的部署流程（toast-runtime.mjs）。
// common://fix 的扫描与提示词判据同源维护于 depcheck.mjs / depcheck-prompt.mjs（契约测试对齐）；
// title://fix 只读取 title 外置数据目录中的身份描述与模板，不导入 title 缓存代码。
import { appendFile, lstat, mkdir, readFile, readlink, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve, toNamespacedPath } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOAST_PROTOCOLS = ['suian-zcode-common', 'suian-zcode-title'];
export const COMMON_PACKAGE = 'suian-zcode-common';
export const SUIAN_MARKETPLACE = 'suian-zcode-plugins';
export const TITLE_PLUGIN_ID = 'suian-zcode-title';

const toastRootFor = homeDir => join(homeDir, '.zcode', 'tools', COMMON_PACKAGE, 'toast');
const samePath = (a, b) => toNamespacedPath(resolve(a)) === toNamespacedPath(resolve(b));

// —— URI 契约：只支持 common 依赖修复与 title 网关排障两种身份，动作只接受 fix ——

export function parseActionUri(uri) {
  const match = /^(suian-zcode-common|suian-zcode-title):\/\/([a-z]+)$/i.exec(String(uri ?? ''));
  return match ? { protocol: match[1].toLowerCase(), action: match[2].toLowerCase() } : null;
}

// —— common://fix：现场重扫当前依赖状态（判据与 depcheck.mjs 同步维护） ——

async function maybeLstat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readJsonAt(path) {
  try { return { status: 'ok', value: JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'bad' }; }
}

function pickSuianEntries(manifest) {
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
  return plugins.filter(entry => {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const id = typeof entry?.id === 'string' ? entry.id : '';
    return name.startsWith('suian-') || id.endsWith(`@${SUIAN_MARKETPLACE}`);
  });
}

const asArray = value => Array.isArray(value) ? value : [];

async function checkNpmDependencies(installPath, name, issues) {
  const pkgRead = await readJsonAt(join(installPath, 'package.json'));
  if (pkgRead.status !== 'ok') {
    issues.push({ plugin: name, code: 'plugin_files_missing', detail: 'package.json 缺失或不可解析' });
    return false;
  }
  const deps = pkgRead.value.dependencies;
  if (!deps || typeof deps !== 'object') return true;
  const missing = [];
  for (const pkgName of Object.keys(deps)) {
    if (!(await maybeLstat(join(installPath, 'node_modules', pkgName)))) missing.push(pkgName);
  }
  if (missing.length) issues.push({ plugin: name, code: 'npm_dependency_missing', detail: missing.join(', ') });
  return true;
}

async function checkCommonLink(installPath, name, runtimeRoot, issues) {
  const linkPath = join(installPath, 'node_modules', COMMON_PACKAGE);
  const present = await maybeLstat(linkPath);
  if (!present) {
    issues.push({ plugin: name, code: 'common_link_missing', detail: 'node_modules/suian-zcode-common 不存在' });
    return;
  }
  if (!present.isSymbolicLink()) {
    issues.push({ plugin: name, code: 'common_link_not_symlink', detail: `${linkPath} 是真实目录而非链接` });
    return;
  }
  const target = resolve(await readlink(linkPath));
  if (!samePath(target, runtimeRoot)) {
    issues.push({ plugin: name, code: 'common_link_mismatch', detail: `链接指向 ${target}，应为 ${runtimeRoot}` });
  }
}

async function checkRuntimeLink(runtimeRoot, commonInstallPath, issues) {
  const present = await maybeLstat(runtimeRoot);
  if (!present) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_missing', detail: `${runtimeRoot} 不存在` });
    return;
  }
  if (!present.isSymbolicLink()) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_not_symlink', detail: `${runtimeRoot} 是真实目录而非链接` });
    return;
  }
  const target = resolve(await readlink(runtimeRoot));
  if (!(await maybeLstat(target))) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_target_missing', detail: `链接目标 ${target} 不存在` });
    return;
  }
  const pkgRead = await readJsonAt(join(target, 'package.json'));
  if (pkgRead.status !== 'ok' || pkgRead.value?.name !== COMMON_PACKAGE) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_target_invalid', detail: `目标 ${target} 不属于 ${COMMON_PACKAGE}` });
    return;
  }
  if (!samePath(target, commonInstallPath)) {
    issues.push({ plugin: COMMON_PACKAGE, code: 'runtime_stale', detail: `稳定入口指向 ${target}，已安装版本在 ${commonInstallPath}` });
  }
}

async function scanSuianPlugins({ pluginsFile, homeDir }) {
  const resolvedPluginsFile = pluginsFile ?? join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  const runtimeRoot = join(homeDir, '.zcode', 'tools', COMMON_PACKAGE, 'runtime');
  const result = { ok: true, skipped: null, checkedAt: new Date().toISOString(), runtimeRoot, plugins: [], issues: [] };
  const manifestRead = await readJsonAt(resolvedPluginsFile);
  if (manifestRead.status !== 'ok') {
    result.skipped = manifestRead.status === 'missing' ? 'no_manifest' : 'bad_manifest';
    return result;
  }
  const manifest = manifestRead.value;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || (manifest.plugins !== undefined && !Array.isArray(manifest.plugins))) {
    result.skipped = 'bad_manifest';
    return result;
  }
  const entries = pickSuianEntries(manifest);
  const commonEntry = entries.find(entry => entry?.name === COMMON_PACKAGE) ?? null;
  const consumers = entries.filter(entry => entry !== commonEntry);
  for (const entry of entries) {
    const name = entry.name;
    const installPath = typeof entry.installPath === 'string' ? entry.installPath : null;
    const record = { name, version: entry.version ?? null, installPath, dependsOnCommon: false };
    result.plugins.push(record);
    if (!installPath || !(await maybeLstat(installPath))?.isDirectory()) {
      result.issues.push({ plugin: name, code: 'cache_missing', detail: `缓存目录不存在：${installPath ?? '(清单未提供)'}` });
      record.dependsOnCommon = asArray(entry.dependencies).includes(COMMON_PACKAGE);
      continue;
    }
    const pluginRead = await readJsonAt(join(installPath, '.zcode-plugin', 'plugin.json'));
    if (pluginRead.status !== 'ok') result.issues.push({ plugin: name, code: 'plugin_files_missing', detail: '.zcode-plugin/plugin.json 缺失或不可解析' });
    record.dependsOnCommon = [...asArray(entry.dependencies), ...asArray(pluginRead.value?.dependencies)].includes(COMMON_PACKAGE);
    const pkgReadable = await checkNpmDependencies(installPath, name, result.issues);
    if (record.dependsOnCommon && pkgReadable) await checkCommonLink(installPath, name, runtimeRoot, result.issues);
  }
  const anyConsumer = result.plugins.some(record => record.name !== COMMON_PACKAGE && record.dependsOnCommon);
  if (anyConsumer && !commonEntry) {
    result.issues.push({ plugin: COMMON_PACKAGE, code: 'common_not_installed', detail: '业务插件声明依赖 suian-zcode-common，但清单中没有它的安装条目' });
  } else if (anyConsumer && typeof commonEntry.installPath === 'string') {
    await checkRuntimeLink(runtimeRoot, commonEntry.installPath, result.issues);
  }
  result.ok = result.issues.length === 0;
  return result;
}

// 提示词文案与 depcheck-prompt.mjs 同步维护
const shortMessages = {
  cache_missing: '缓存目录缺失', plugin_files_missing: '插件文件缺失', npm_dependency_missing: 'npm 依赖未装',
  common_not_installed: '公共插件未安装', common_link_missing: '缺公共包链接', common_link_not_symlink: '公共包入口被真实目录占据',
  common_link_mismatch: '公共包链接指向错误', runtime_missing: '公共稳定入口缺失', runtime_not_symlink: '公共稳定入口被真实目录占据',
  runtime_target_missing: '公共稳定入口悬空', runtime_target_invalid: '公共稳定入口指向异常', runtime_stale: '公共入口指向旧版本',
};
const fullMessages = {
  ...shortMessages,
  cache_missing: '插件缓存目录缺失', plugin_files_missing: '插件清单文件（package.json / plugin.json）缺失或不可解析',
  npm_dependency_missing: 'npm 生产依赖未安装', common_not_installed: '业务插件声明依赖公共插件，但安装清单中没有公共插件条目',
  common_link_missing: '缺少 node_modules/suian-zcode-common 公共包链接', common_link_not_symlink: 'node_modules/suian-zcode-common 被真实目录占据（应为 junction 链接）',
  common_link_mismatch: '公共包链接未指向稳定入口 ~/.zcode/tools/suian-zcode-common/runtime', runtime_missing: '公共稳定入口 runtime 链接缺失',
  runtime_not_symlink: '公共稳定入口被真实目录占据（应为 junction 链接）', runtime_target_missing: '公共稳定入口链接悬空（目标目录不存在）',
  runtime_target_invalid: '公共稳定入口指向了不属于 suian-zcode-common 的目录', runtime_stale: '公共稳定入口仍指向旧版本缓存（common 升级后未重跑 link.mjs）',
};
const versionOf = (result, plugin) => {
  const version = result.plugins.find(entry => entry.name === plugin)?.version;
  return typeof version === 'string' && version ? version : null;
};

function buildFixPrompt(result) {
  if (!result.issues.length) {
    return `suian-zcode-common 依赖检查刚刚复查通过，所有已安装 suian 系列插件的 npm 依赖与公共包链接均齐全，无需修复。`;
  }
  const lines = result.issues.map(issue => {
    const version = versionOf(result, issue.plugin);
    const label = `${issue.plugin}${version ? ` ${version}` : ''}`;
    return `- ${label}：${fullMessages[issue.code] ?? issue.code}${issue.detail ? `（${issue.detail}）` : ''}`;
  });
  const commonRoot = result.plugins.find(entry => entry.name === COMMON_PACKAGE)?.installPath;
  const roots = result.plugins
    .map(entry => `- ${entry.name}${versionOf(result, entry.name) ? ` ${versionOf(result, entry.name)}` : ''}：${entry.installPath ?? '(未知)'}`)
    .join('\n');
  return [
    '我的 ZCode suian 系列插件依赖不完整，请帮我修复。以下缺失清单来自 suian-zcode-common 的依赖检查（Stop 钩子 depcheck）：',
    '',
    ...lines,
    '',
    '请按 suian-zcode-common:setup 技能（skills/setup/SKILL.md）执行依赖初始化与修复：',
    '1. 对上表每个存在 npm 依赖问题的插件，在其缓存根目录运行 npm ci --ignore-scripts --no-audit --no-fund（suian-zcode-common 自身同样适用）',
    `2. 运行 node ${commonRoot ?? '<suian-zcode-common 缓存根>'}\\link.mjs --plugin-root <各业务插件缓存根>（每个依赖 common 的插件传一次），重建公共包链接`,
    `3. 修复后运行 node ${commonRoot ?? '<suian-zcode-common 缓存根>'}\\depcheck-hook.mjs --scan-only 复查，直到缺失清单为空`,
    '',
    '各插件本次检查实测的缓存根：',
    roots,
  ].join('\n');
}

// —— 身份与安装记录 ——

// 身份文件读取：区分「描述缺失」（identity_missing）与「描述存在但协议不符」（identity_mismatch）。
async function loadIdentity(toastRoot, protocol) {
  const path = join(toastRoot, 'identities', `${protocol}.json`);
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'absent', identity: null }; throw error; }
  try { return { status: 'present', identity: JSON.parse(raw) }; }
  catch { return { status: 'present', identity: null }; }
}

// 点击时重新读取安装记录，取 title 当前安装条目根；缺失时返回 null，不采用任何旧根。
async function resolveTitleInstallRoot({ pluginsFile, homeDir }) {
  const resolved = pluginsFile ?? join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  const read = await readJsonAt(resolved);
  if (read.status !== 'ok') return null;
  const entries = pickSuianEntries(read.value).filter(entry => entry?.name === TITLE_PLUGIN_ID);
  for (const entry of entries) {
    if (typeof entry.installPath === 'string' && (await maybeLstat(entry.installPath))?.isDirectory()) return entry.installPath;
  }
  return null;
}

const MISSING_ROOT_NOTE = '（suian-zcode-title 安装条目缺失：请在 ZCode 插件市场重新安装或更新）';

function renderFixPrompt({ template, installRoot, dataDir }) {
  return String(template)
    .replace(/\{\{plugin_root\}\}/g, () => installRoot ?? MISSING_ROOT_NOTE)
    .replace(/\{\{data_dir\}\}/g, () => dataDir);
}

// —— 剪贴板与打开工作区（实现与 notification-action.mjs 同步维护） ——

export const defaultFixWorkspace = () => join(homedir(), '.zcode', 'workspace', 'default');
export function encodeWorkspaceOpenUri(workspacePath) {
  return 'zcode://workspace/open?path=' + encodeURIComponent(workspacePath);
}

async function runPowerShell(script, { env = {}, timeout } = {}) {
  return promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout, env: { ...process.env, ...env } });
}

async function readClipboardOnce(executePowerShell) {
  const { stdout } = await executePowerShell('[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::GetText()');
  return stdout.replace(/\r\n$/, '');
}

async function setClipboardViaTempFile(text, { dataDir, executePowerShell = runPowerShell }) {
  const temporary = join(dataDir ?? '.', 'fix-prompt.tmp-' + process.pid);
  await writeFile(temporary, text, 'utf8');
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 400 * attempt));
      try {
        await executePowerShell('Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::SetText([IO.File]::ReadAllText($env:OIL_CLIP_FILE,[Text.Encoding]::UTF8))', { env: { OIL_CLIP_FILE: temporary } });
        return;
      } catch (error) { lastError = error; }
      try { if (await readClipboardOnce(executePowerShell) === text) return; }
      catch (error) { lastError = error; }
    }
    throw new Error('剪贴板写入未生效：' + String(lastError?.message ?? '').slice(0, 120));
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function openWorkspaceViaShell(uri) {
  await promisify(execFile)('cmd.exe', ['/c', 'start', '', uri], { windowsHide: true });
}

// —— 公开动作入口 ——

export async function runAction({ uri, homeDir, toastRoot, pluginsFile, setClipboard = setClipboardViaTempFile, openWorkspace = openWorkspaceViaShell }) {
  const parsed = parseActionUri(uri);
  if (!parsed) return { ok: false, reason: 'invalid_uri' };
  if (parsed.action !== 'fix') return { ok: false, reason: 'unknown_action' };
  const resolvedHome = homeDir ?? process.env.SUIAN_TOAST_HOME ?? homedir();
  const root = toastRoot ?? toastRootFor(resolvedHome);
  const loaded = await loadIdentity(root, parsed.protocol);
  if (loaded.status === 'absent' || !loaded.identity) return { ok: false, reason: 'identity_missing' };
  const identity = loaded.identity;
  if (identity.protocol !== parsed.protocol) return { ok: false, reason: 'identity_mismatch' };

  let prompt;
  let issues = null;
  if (parsed.protocol === 'suian-zcode-common') {
    // 按钮点击与 Toast 弹出可能间隔很久，现场重扫保证提示词反映当前实际状态
    const result = await scanSuianPlugins({ pluginsFile, homeDir: resolvedHome });
    prompt = buildFixPrompt(result);
    issues = result.issues.length;
  } else {
    if (!identity.templateFile) return { ok: false, reason: 'template_missing' };
    let template;
    try {
      template = await readFile(join(identity.dataDir, identity.templateFile), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: false, reason: 'template_missing' };
      throw error;
    }
    const installRoot = await resolveTitleInstallRoot({ pluginsFile, homeDir: resolvedHome });
    prompt = renderFixPrompt({ template, installRoot, dataDir: identity.dataDir });
  }
  await setClipboard(prompt, { dataDir: identity.dataDir });
  await openWorkspace(encodeWorkspaceOpenUri(defaultFixWorkspace()));
  return { ok: true, action: 'fix', identity: parsed.protocol, issues };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const uri = process.argv[2];
  const resolvedHome = process.env.SUIAN_TOAST_HOME || homedir();
  const root = toastRootFor(resolvedHome);
  const logAction = async (entry, dataDir) => {
    try {
      await mkdir(dataDir, { recursive: true });
      await appendFile(join(dataDir, 'toast-action-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    } catch { /* 日志尽力而为 */ }
  };
  runAction({ uri, homeDir: resolvedHome, toastRoot: root })
    .then(async result => {
      console.log(JSON.stringify(result));
      const parsed = parseActionUri(uri);
      const loaded = parsed ? await loadIdentity(root, parsed.protocol) : null;
      await logAction({ uri, ok: result.ok, reason: result.reason ?? null, issues: result.issues ?? null }, loaded?.identity?.dataDir ?? root);
      process.exit(result.ok ? 0 : 1);
    })
    .catch(async error => {
      console.log(JSON.stringify({ ok: false, reason: 'error', detail: String(error.message).slice(0, 200) }));
      const parsed = parseActionUri(uri);
      const loaded = parsed ? await loadIdentity(root, parsed.protocol) : null;
      await logAction({ uri, ok: false, reason: 'error', detail: String(error.message).slice(0, 200) }, loaded?.identity?.dataDir ?? root);
      process.exit(1);
    });
}
