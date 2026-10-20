#!/usr/bin/env node
// 旧链接清理（PKG-08）：从 npm/link 安装迁移到发布形态后，核对旧 junction/目录链接的
// 归属并只删链接本身。真实目录、指向其他目标的链接与用户源码一律保留；未带 --apply
// 时仅输出计划。判据与 link.mjs 建立的形态一一对应：runtime 链接指向 common 安装根
// （含指向已被清理的旧版本缓存而悬空），业务端 node_modules/suian-zcode-common 链接
// 指向 runtime 根或 common 安装根。
import { lstat, readlink, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, toNamespacedPath } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const COMMON_PACKAGE = 'suian-zcode-common';

const samePath = (a, b) => toNamespacedPath(resolve(a)) === toNamespacedPath(resolve(b));

async function maybeLstat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readJsonAt(path) {
  try { return { status: 'ok', value: JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'bad' }; }
}

async function readManifestEntries(pluginsFile, homeDir) {
  const resolved = pluginsFile ?? join(homeDir, '.zcode', 'cli', 'plugins', 'installed_plugins.json');
  const read = await readJsonAt(resolved);
  if (read.status !== 'ok' || !Array.isArray(read.value?.plugins)) return [];
  return read.value.plugins.filter(entry => typeof entry?.name === 'string' && entry.name.startsWith('suian-'));
}

// 单个链接位置的归属判定。targetBelongs：调用方传入的"属于 suian-zcode-common"谓词。
async function classifyLink({ path, targetBelongs }) {
  const present = await maybeLstat(path);
  if (!present) return { kind: 'absent', owned: false };
  if (!present.isSymbolicLink()) return { kind: 'directory', owned: false, reason: 'real_directory' };
  const target = resolve(await readlink(path));
  const owned = await targetBelongs(target);
  return { kind: 'symlink', owned: owned ? true : false, reason: owned ? null : 'foreign_target', target };
}

export async function inspectLegacyLinks({ pluginsFile, homeDir = homedir(), toolsRoot } = {}) {
  const resolvedToolsRoot = toolsRoot ?? join(homeDir, '.zcode', 'tools');
  const runtimeRoot = join(resolvedToolsRoot, COMMON_PACKAGE, 'runtime');
  const entries = await readManifestEntries(pluginsFile, homeDir);
  const commonInstallPath = entries.find(entry => entry.name === COMMON_PACKAGE && typeof entry.installPath === 'string')?.installPath ?? null;

  // 归属谓词：目标等于清单中的 common 安装根；目标悬空时按目标路径包含公共包目录名判定
  // （link.mjs 建立的链接只会指向 common 根或 runtime 根，二者都含 suian-zcode-common 路径段）。
  const belongsToCommon = async target => {
    if (commonInstallPath && samePath(target, commonInstallPath)) return true;
    if (samePath(target, runtimeRoot)) return true;
    if (await maybeLstat(target)) return false; // 存在但既非 common 安装根也非 runtime 根：他人目标
    const segments = target.split(/[\\/]/);
    return segments.includes(COMMON_PACKAGE);
  };

  const runtimeLink = { path: runtimeRoot, ...(await classifyLink({ path: runtimeRoot, targetBelongs: belongsToCommon })) };
  const consumerLinks = [];
  for (const entry of entries) {
    if (entry.name === COMMON_PACKAGE) continue;
    const installPath = typeof entry.installPath === 'string' ? entry.installPath : null;
    if (!installPath) continue;
    const linkPath = join(installPath, 'node_modules', COMMON_PACKAGE);
    const classified = await classifyLink({ path: linkPath, targetBelongs: target => belongsToCommon(target) });
    if (classified.kind === 'absent') continue;
    consumerLinks.push({ plugin: entry.name, path: linkPath, ...classified });
  }
  return { runtimeRoot, runtimeLink, consumerLinks, commonInstallPath };
}

const planFor = classified => {
  if (classified.kind === 'absent') return { action: 'noop_absent' };
  if (!classified.owned) return { action: 'kept_not_owned', reason: classified.reason, target: classified.target ?? null };
  return { action: 'planned', target: classified.target };
};

// 清理入口：apply 为 true 时对归属确认的链接执行 unlink（仅链接本身）；其余场景只出计划。
export async function cleanupLegacyLinks({ pluginsFile, homeDir = homedir(), toolsRoot, apply = false } = {}) {
  const inspected = await inspectLegacyLinks({ pluginsFile, homeDir, toolsRoot });
  const settle = classified => {
    const plan = planFor(classified);
    if (apply && plan.action === 'planned') {
      return { ...classified, ...plan, action: 'removed' };
    }
    return { ...classified, ...plan };
  };
  const runtimeLink = settle(inspected.runtimeLink);
  const consumerLinks = [];
  for (const link of inspected.consumerLinks) consumerLinks.push(settle(link));
  if (apply) {
    if (runtimeLink.action === 'removed') await unlink(runtimeLink.path);
    for (const link of consumerLinks) {
      if (link.action === 'removed') await unlink(link.path);
    }
  }
  return { ok: true, apply, runtimeRoot: inspected.runtimeRoot, runtimeLink, consumerLinks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean' }, inspect: { type: 'boolean' },
    'plugins-file': { type: 'string' }, home: { type: 'string' }, 'tools-root': { type: 'string' },
  } });
  const homeDir = values.home ?? homedir();
  const options = { homeDir, pluginsFile: values['plugins-file'], toolsRoot: values['tools-root'] };
  const result = values.apply
    ? await cleanupLegacyLinks({ ...options, apply: true })
    : { ok: true, ...(await inspectLegacyLinks(options)) };
  console.log(JSON.stringify(result, null, 2));
}
