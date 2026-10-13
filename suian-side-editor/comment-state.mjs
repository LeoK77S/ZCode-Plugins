import { randomUUID } from 'node:crypto';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { connectHost } from 'suian-zcode-common/gateway-client.mjs';

const busyReason = '主对话正在处理输入，为避免新增评论被本次发送清理，暂时不能添加评论；处理结束后恢复。这是尽力保护，禁用窗口可能覆盖模型回复，发送边界仍有残余风险。';
function acceptedBatches(context, messages, events) {
  const bodies = messages.filter(message => message.role === 'user' && typeof message.content === 'string' && !message.bodyRefs?.some(ref => ref.field === 'content')).map(message => message.content);
  for (const event of events) if (event.sessionId === context.sessionId && ['turn.steerQueued', 'turn.started'].includes(event.type) && typeof event.payload?.input === 'string') bodies.push(event.payload.input);
  const batches = new Map();
  for (const body of bodies) for (const match of body.matchAll(/文本编辑器选区评论（[^\r\n]*）\r?\n(\{[^\r\n]+\})/g)) {
    try {
      const data = JSON.parse(match[1]);
      if (data.schemaVersion !== 1 || typeof data.batchId !== 'string' || !Array.isArray(data.comments) || !data.comments.length ||
          !data.comments.every(comment => comment.sessionId === context.sessionId && comment.workspacePath === context.workspacePath)) continue;
      batches.set(data.batchId, { batchId: data.batchId, serialized: match[1] });
    } catch { /* 普通用户正文和不完整 JSON 都不是受理证据。 */ }
  }
  return [...batches.values()];
}

// 只服务本插件评论业务。资源归属来自一次受审工具，不从 URI/页面参数猜身份。
export function installCommentState(server, { hostConnector = connectHost, gatewayConfigPath } = {}) {
  const entries = new Map();
  let closed = false;
  const active = entry => !closed && entries.get(entry.uri) === entry;
  function lookup(uri) {
    const entry = entries.get(uri);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, '评论状态资源未登记，请重新打开编辑器');
    return entry;
  }
  function refresh(entry) {
    entry.reading = entry.reading.then(async () => {
      if (!active(entry)) return false;
      let host, snapshot;
      try {
        host = await hostConnector({ workspacePath: entry.context.workspacePath, sessionId: entry.context.sessionId,
          ...(gatewayConfigPath ? { gatewayConfigPath } : {}), timeoutMs: 6000, handshakeTimeoutMs: 3000 });
        if (!active(entry)) return false;
        entry.connection = host;
        const data = await host.call('zcode-task', 'getTaskSnapshot', [{ taskId: entry.context.sessionId, workspacePath: entry.context.workspacePath, messageLimit: 20, byteBudget: 200000 }]);
        if (!active(entry)) return false;
        if (data?.meta?.taskId && data.meta.taskId !== entry.context.sessionId) throw new Error('网关返回了其他会话，评论状态不可确认');
        // 此公开读取默认 start-if-needed；不是 existing-only，也不是发送 pending 信号。
        const events = await host.call('zcode-agent', 'readSessionEvents', [{ sessionId: entry.context.sessionId, workspacePath: entry.context.workspacePath, limit: 200 }]);
        if (!active(entry)) return false;
        if (!Array.isArray(events)) throw new Error('主对话事件读取未返回有效数组，评论受理不可确认');
        const busy = data?.meta?.status === 'running' || Boolean(data?.runtime?.activeTurnKind);
        const state = busy ? 'busy' : data?.meta?.status === 'completed' ? 'idle' : 'unknown';
        snapshot = { state, reason: busy ? busyReason : state === 'unknown' ? '尚未取得可确认的主对话状态，暂时不能添加评论' : '',
          source: 'task-snapshot', status: data?.meta?.status ?? null, activeTurnKind: data?.runtime?.activeTurnKind ?? null,
          acceptedBatches: acceptedBatches(entry.context, Array.isArray(data.messages) ? data.messages : [], events) };
      } catch (error) { if (!active(entry)) return false; snapshot = { state: 'unknown', reason: `评论状态不可用：${error.message}`, code: error.reasonCode ?? error.code ?? 'comment_state_unavailable' }; }
      finally { host?.close(); entry.connection = undefined; }
      const changed = JSON.stringify(snapshot) !== JSON.stringify(entry.snapshot); entry.snapshot = snapshot; return changed;
    });
    return entry.reading;
  }
  function monitor(entry) {
    entry.timer = setTimeout(async () => {
      try {
        const changed = await refresh(entry);
        if (!entries.has(entry.uri) || !entry.subscribed) return;
        if (changed) await server.server.sendResourceUpdated({ uri: entry.uri });
        if (entries.has(entry.uri) && entry.subscribed) monitor(entry);
      } catch (error) { entry.timer = undefined; console.error(`评论状态通知失败，监测已停止：${error.message}`); }
    }, 1000); entry.timer.unref();
  }
  server.registerResource('comment-state', new ResourceTemplate('ui://suian-side-editor/comment-state/{id}', {}),
    { title: '当前绑定会话的只读评论状态', mimeType: 'application/json' }, async uri => {
      const entry = lookup(uri.href), changed = await refresh(entry);
      if (changed && entry.subscribed && entries.has(entry.uri)) await server.server.sendResourceUpdated({ uri: entry.uri });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(entry.snapshot) }] };
    });
  return {
    has: uri => entries.has(uri),
    async register(context) {
      if (closed) throw new McpError(ErrorCode.InvalidRequest, '评论状态连接已关闭');
      let entry = [...entries.values()].find(item => item.context.sessionId === context.sessionId && item.context.workspacePath === context.workspacePath);
      if (!entry) { const uri = `ui://suian-side-editor/comment-state/${randomUUID()}`; entry = { uri, context, reading: Promise.resolve() }; entries.set(uri, entry); }
      await refresh(entry); lookup(entry.uri); return { ...entry.snapshot, resourceUri: entry.uri };
    },
    async subscribe(uri) { const entry = lookup(uri); await refresh(entry); if (!entries.has(uri)) return; entry.subscribed = true; if (!entry.timer) monitor(entry); return {}; },
    unsubscribe(uri) { const entry = lookup(uri); entries.delete(uri); entry.subscribed = false; clearTimeout(entry.timer); entry.connection?.close(); return {}; },
    close() { closed = true; for (const entry of entries.values()) { entry.subscribed = false; clearTimeout(entry.timer); entry.connection?.close(); } entries.clear(); }
  };
}
