import { COMMON_PACKAGE } from './depcheck.mjs';

// Toast 正文用短描述（两行文本会截断），修复提示词用完整描述（含 detail）。
const shortMessages = {
  cache_missing: '缓存目录缺失',
  plugin_files_missing: '插件文件缺失',
  npm_dependency_missing: 'npm 依赖未装',
  common_not_installed: '公共插件未安装',
  common_link_missing: '缺公共包链接',
  common_link_not_symlink: '公共包入口被真实目录占据',
  common_link_mismatch: '公共包链接指向错误',
  runtime_missing: '公共稳定入口缺失',
  runtime_not_symlink: '公共稳定入口被真实目录占据',
  runtime_target_missing: '公共稳定入口悬空',
  runtime_target_invalid: '公共稳定入口指向异常',
  runtime_stale: '公共入口指向旧版本',
};

const fullMessages = {
  ...shortMessages,
  cache_missing: '插件缓存目录缺失',
  plugin_files_missing: '插件清单文件（package.json / plugin.json）缺失或不可解析',
  npm_dependency_missing: 'npm 生产依赖未安装',
  common_not_installed: '业务插件声明依赖公共插件，但安装清单中没有公共插件条目',
  common_link_missing: '缺少 node_modules/suian-zcode-common 公共包链接',
  common_link_not_symlink: 'node_modules/suian-zcode-common 被真实目录占据（应为 junction 链接）',
  common_link_mismatch: '公共包链接未指向稳定入口 ~/.zcode/tools/suian-zcode-common/runtime',
  runtime_missing: '公共稳定入口 runtime 链接缺失',
  runtime_not_symlink: '公共稳定入口被真实目录占据（应为 junction 链接）',
  runtime_target_missing: '公共稳定入口链接悬空（目标目录不存在）',
  runtime_target_invalid: '公共稳定入口指向了不属于 suian-zcode-common 的目录',
  runtime_stale: '公共稳定入口仍指向旧版本缓存（common 升级后未重跑 link.mjs）',
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

export function buildFixPrompt(result) {
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
