import { COMMON_PACKAGE } from './depcheck.mjs';

// Toast 正文用短描述（两行文本会截断），修复提示词用完整描述（含 detail）。
// PKG-08 起诊断对象是发布契约：缺包/损坏指向原生重新安装或更新，不再是 npm 安装与包链接。
const shortMessages = {
  cache_missing: '缓存目录缺失',
  plugin_files_missing: '插件文件缺失',
  release_missing: '非发布包形态',
  release_invalid: '发布清单损坏',
  identity_mismatch: '发布身份不符',
  file_missing: '发布文件缺失',
  file_digest_mismatch: '发布文件被改动',
  common_not_installed: '公共插件未安装',
  api_incompatible: '公共 API 不兼容',
  version_insufficient: '公共插件版本过低',
};

const fullMessages = {
  ...shortMessages,
  cache_missing: '插件缓存目录缺失',
  plugin_files_missing: '插件清单 .zcode-plugin/plugin.json 缺失或不可解析',
  release_missing: '插件目录缺 release.json（旧源码缓存形态或安装损坏）',
  release_invalid: 'release.json 缺失或字段不满足发布契约',
  identity_mismatch: '发布清单身份与安装记录条目不一致',
  file_missing: '发布清单声明的文件缺失于安装目录',
  file_digest_mismatch: '发布文件内容与发布清单摘要不符（被改动或传输损坏）',
  common_not_installed: '业务插件声明依赖公共插件，但安装清单中没有公共插件条目',
  api_incompatible: '业务要求的公共 API 版本与已安装 common 不一致，需按市场配套版本更新',
  version_insufficient: '已安装 common 版本低于业务声明的最低版本',
};

// version 来自外部清单，仅接受字符串，其余形态（对象/数字等）一律视为缺失
const versionOf = (result, plugin) => {
  const version = result.plugins.find(entry => entry.name === plugin)?.version;
  return typeof version === 'string' && version ? version : null;
};

export function summarizeIssues(result) {
  const items = result.issues.map(issue => {
    const version = versionOf(result, issue.plugin);
    return `${issue.plugin}${version ? ` ${version}` : ''}：${shortMessages[issue.code] ?? issue.code}`;
  });
  const head = items.slice(0, 3).join('；');
  return items.length > 3 ? `${head} 等 ${items.length} 项` : head;
}

export function buildToastMessage(result) {
  return `${summarizeIssues(result)}。点击按钮复制修复提示词并打开 ZCode（需确认打开工作区）。`;
}

const REINSTALL_CODES = new Set(['cache_missing', 'plugin_files_missing', 'release_missing', 'release_invalid', 'identity_mismatch', 'file_missing', 'file_digest_mismatch']);

export function buildFixPrompt(result) {
  if (!result.issues.length) {
    return `suian-zcode-common 依赖检查刚刚复查通过，所有已安装 suian 系列插件的发布包完整性与公共 API 兼容性均正常，无需修复。`;
  }
  const lines = result.issues.map(issue => {
    const version = versionOf(result, issue.plugin);
    const label = `${issue.plugin}${version ? ` ${version}` : ''}`;
    return `- ${label}：${fullMessages[issue.code] ?? issue.code}${issue.detail ? `（${issue.detail}）` : ''}`;
  });
  const roots = result.plugins
    .map(entry => `- ${entry.name}${versionOf(result, entry.name) ? ` ${versionOf(result, entry.name)}` : ''}：${entry.installPath ?? '(未知)'}`)
    .join('\n');
  const reinstallTargets = [...new Set(result.issues.filter(issue => REINSTALL_CODES.has(issue.code)).map(issue => issue.plugin))]
    .filter(name => name !== COMMON_PACKAGE || result.issues.some(issue => issue.plugin === COMMON_PACKAGE && REINSTALL_CODES.has(issue.code)));
  const commonUpgradeNeeded = result.issues.some(issue => issue.code === 'api_incompatible' || issue.code === 'version_insufficient' || issue.plugin === COMMON_PACKAGE && issue.code === 'common_not_installed');
  const steps = [];
  if (result.issues.some(issue => issue.code === 'common_not_installed')) {
    steps.push(`1. 安装清单中没有 suian-zcode-common：在 ZCode 插件市场安装（或重新安装任一依赖它的 suian 业务插件，依赖会一并安装）`);
  }
  if (commonUpgradeNeeded && result.issues.some(issue => issue.code !== 'common_not_installed')) {
    steps.push(`${steps.length + 1}. 公共层与业务版本不配套：先更新 suian-zcode-common（zcode plugins update suian-zcode-common@suian-zcode-plugins），仍有 api_incompatible 或 version_insufficient 时一并更新对应业务插件`);
  }
  if (reinstallTargets.length) {
    steps.push(`${steps.length + 1}. 对上表存在发布文件问题的插件，通过 ZCode 插件市场重新安装或更新（zcode plugins update <插件>@suian-zcode-plugins）以恢复发布目录；不要在版本缓存内手工执行 npm、创建目录链接或复制文件`);
  }
  const commonRoot = result.plugins.find(entry => entry.name === COMMON_PACKAGE)?.installPath;
  steps.push(`${steps.length + 1}. 修复后运行 node ${commonRoot ?? '<suian-zcode-common 缓存根>'}\\depcheck-hook.mjs --scan-only 复查，直到缺失清单为空`);
  return [
    '我的 ZCode suian 系列插件依赖不完整，请帮我修复。以下缺失清单来自 suian-zcode-common 的依赖检查（Stop 钩子 depcheck）：',
    '',
    ...lines,
    '',
    '请按 suian-zcode-common:setup 技能（skills/setup/SKILL.md）处理，修复方式是原生重新安装或更新，不是 npm 安装：',
    ...steps,
    '',
    '各插件本次检查实测的缓存根：',
    roots,
  ].join('\n');
}
