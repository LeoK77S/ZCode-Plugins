const ARTIFACT_ENTRY = '请在创建、接手或替换任务相关的 PR、会话、文件或链接时及时登记或更新工件，详见 mcp__plugin_suian-zcode-app-mcp_suian-zcode-app__set_artifacts。';

export function artifactSummary({ revision, stats, inheritance }) {
  const counts = Object.entries(stats.by_kind).map(([kind, count]) => `${kind} ${count}`).join('；');
  const diagnostic = inheritance?.status === 'snapshot_missing'
    ? '\n继承诊断：snapshot_missing。所选断点没有快照，子工件区未继承，仍可独立读写。' : '';
  return `${ARTIFACT_ENTRY}\n工件统计（revision ${revision}）：共 ${stats.total} 条；${counts}${diagnostic}`;
}
