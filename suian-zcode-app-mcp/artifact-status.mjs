import { spawn } from 'node:child_process';

const GH_FIELDS = 'state,isDraft,mergeable,additions,deletions';
const ISSUE_FIELDS = 'state,comments';

/** 仅 github.com（含 www）视为 GitHub 链接；其它域名直接走出错路径，不起子进程。 */
function isGitHubRef(ref) {
  try {
    const host = new URL(ref).hostname.toLowerCase();
    return host === 'github.com' || host === 'www.github.com';
  } catch { return false; }
}

/**
 * gh 字段归并为五种展示状态。优先级：merged、closed > conflict（mergeable=CONFLICTING）> draft > open；
 * 字段缺失或未知（mergeable=UNKNOWN/BLACKED 等）不升级为冲突，回落开放。
 */
export function mergePrStatus({ state, isDraft, mergeable } = {}) {
  const value = input => String(input ?? '').toUpperCase();
  if (value(state) === 'MERGED') return 'merged';
  if (value(state) === 'CLOSED') return 'closed';
  if (value(mergeable) === 'CONFLICTING') return 'conflict';
  if (isDraft === true) return 'draft';
  return 'open';
}

/** gh issue view 的 state 只有 OPEN/CLOSED；缺失或未知值不臆断关闭，回落开放。 */
export function mergeIssueState(state) {
  return String(state ?? '').toUpperCase() === 'CLOSED' ? 'closed' : 'open';
}

/**
 * gh issue view --json comments 实际返回完整评论对象数组（不含主帖，实测 149 条无截断），
 * 归并为评论条数；兼容数字形态原样透传。
 */
function countIssueComments(comments) {
  return Array.isArray(comments) ? comments.length : comments;
}

/** 真实 gh 子进程：stdout 为 JSON 时 resolve；非零退出、启动失败或中止时 reject。 */
function runGhProcess(args, { signal }) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', settled = false;
    let child;
    try { child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal }); }
    catch (error) { reject(error); return; }
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(stdout);
    };
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 ? undefined
      : Object.assign(new Error(stderr.trim() || `gh 退出码 ${code}`), { exitCode: code })));
  });
}

/**
 * 面板专用状态拉取服务：per-ref 内存缓存带成功时间戳，新鲜期内命中缓存不起子进程。
 * PR（gh pr view）与议题（gh issue view）共用同一套缓存、超时与出错分类，仅子命令、字段与快照形状不同。
 * 超时沿用旧数据并标记 stale（stale_reason=timeout），无旧数据按出错处理；gh 失败清空该 ref
 * 缓存并返回逐条 error。拉取只在面板标准刷新时机经 get_pr_statuses 到达，模型侧 get_artifacts 不经过本模块。
 */
export function createArtifactStatusService({
  runGh = runGhProcess, now = Date.now, timeoutMs = 5000, freshMs = 60000, maxConcurrent = 6
} = {}) {
  const cache = new Map();   // ref -> 快照（PR/议题 ref 天然不重叠，共用一张表）
  const inFlight = new Map(); // ref -> 进行中的拉取 Promise（结果共享，超时不缓存）

  // 拉取规格：同一机制下区分 gh 子命令、JSON 字段、错误码前缀与快照构造
  const SPECS = {
    pr: {
      command: 'pr', fields: GH_FIELDS, code: 'pr_status', noun: 'PR',
      build: data => ({ status: mergePrStatus(data), additions: data.additions, deletions: data.deletions })
    },
    issue: {
      command: 'issue', fields: ISSUE_FIELDS, code: 'issue_status', noun: '议题',
      build: data => ({ state: mergeIssueState(data.state), comments: countIssueComments(data.comments) })
    }
  };

  function fetchOne(ref, spec) {
    if (inFlight.has(ref)) return inFlight.get(ref);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const attempt = (async () => {
      try {
        const stdout = await runGh([spec.command, 'view', ref, '--json', spec.fields], { signal: controller.signal });
        let data;
        try { data = JSON.parse(stdout); }
        catch { throw new Error('gh 返回的不是有效 JSON'); }
        const snapshot = { ...spec.build(data), fetched_at: now() };
        cache.set(ref, snapshot);
        return snapshot;
      } catch (error) {
        if (controller.signal.aborted) {
          // 超时：有旧数据沿用（标记 stale），没有则按出错处理
          const cached = cache.get(ref);
          if (cached) return { ...cached, stale: true, stale_reason: 'timeout' };
          return { error: `${spec.code}_timeout: 拉取超时（${timeoutMs}ms）且没有可沿用的旧数据` };
        }
        cache.delete(ref);
        return { error: `gh_failed: ${error.message}` };
      } finally { inFlight.delete(ref); }
    })();
    inFlight.set(ref, attempt);
    void attempt.finally(() => clearTimeout(timer)).catch(() => undefined);
    return attempt;
  }

  async function resolveRef(ref, spec) {
    if (!isGitHubRef(ref)) return { error: `${spec.code}_not_github: 仅支持 GitHub ${spec.noun}链接，非 GitHub 引用不拉取` };
    const cached = cache.get(ref);
    if (cached && now() - cached.fetched_at < freshMs) return cached;
    return fetchOne(ref, spec);
  }

  async function fetchBatch(refs, spec) {
    const unique = [...new Set(refs)];
    const statuses = {};
    const queue = [];
    for (const ref of unique) {
      if (isGitHubRef(ref)) queue.push(ref);
      else statuses[ref] = { error: `${spec.code}_not_github: 仅支持 GitHub ${spec.noun}链接，非 GitHub 引用不拉取` };
    }
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const ref = queue[cursor++];
        statuses[ref] = await resolveRef(ref, spec);
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, queue.length) }, worker));
    return statuses;
  }

  return {
    /** 批量拉取 PR 状态：逐 ref 返回结果对象，单条失败不影响其它条目；结果键保持输入 ref 原样。 */
    async fetchStatuses(refs) { return fetchBatch(refs, SPECS.pr); },
    /** 批量拉取议题状态与评论数，机制与 PR 一致；state 为 open/closed，comments 不含主帖。 */
    async fetchIssueStatuses(refs) { return fetchBatch(refs, SPECS.issue); }
  };
}
