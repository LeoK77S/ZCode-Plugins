import { randomUUID } from 'node:crypto';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { readTextFile, fileFailure } from './text-files.mjs';

const diskSnapshot = data => ({ text: data.text, encoding: data.encoding, version: data.version });

// 资源请求没有 ZCode 对话 meta；只查首次受审工具已经登记的关联，不从 URI 解析文件路径。
export function installTextResources(server, commentState) {
  const entries = new Map();
  function lookup(uri) {
    const entry = entries.get(uri);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, '文件资源未登记，请通过文件工具重新打开');
    return entry;
  }
  function refresh(entry) {
    entry.reading = entry.reading.then(async () => {
      let snapshot;
      try {
        const data = await readTextFile(entry.context, entry.relativePath, entry.sourcePath);
        snapshot = diskSnapshot(data);
      } catch (error) { snapshot = fileFailure(error); }
      const changed = JSON.stringify(snapshot) !== JSON.stringify(entry.snapshot);
      entry.snapshot = snapshot;
      return changed;
    });
    return entry.reading;
  }
  function monitor(entry) {
    entry.timer = setTimeout(async () => {
      try {
        const changed = await refresh(entry);
        if (!entries.has(entry.uri)) return;
        if (changed) await server.server.sendResourceUpdated({ uri: entry.uri });
        if (entries.has(entry.uri)) monitor(entry);
      } catch (error) {
        entry.timer = undefined;
        console.error(`文件资源通知发送失败，监测已停止（${entry.uri}）：${error.message}`);
      }
    }, 1000);
    entry.timer.unref();
  }
  server.server.registerCapabilities({ resources: { subscribe: true } });
  server.registerResource('opened-text', new ResourceTemplate('ui://suian-side-editor/text/{id}', {}),
    { title: '已打开文本的只读快照', mimeType: 'application/json' }, async uri => {
      const entry = lookup(uri.href); const changed = await refresh(entry);
      if (changed && entry.timer && entries.has(entry.uri)) await server.server.sendResourceUpdated({ uri: entry.uri });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(entry.snapshot) }] };
    });
  server.server.setRequestHandler(SubscribeRequestSchema, async request => {
    if (commentState?.has(request.params.uri)) return commentState.subscribe(request.params.uri);
    const entry = lookup(request.params.uri); await refresh(entry);
    if (entries.has(entry.uri) && !entry.timer) monitor(entry);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async request => {
    if (commentState?.has(request.params.uri)) return commentState.unsubscribe(request.params.uri);
    const entry = lookup(request.params.uri); clearTimeout(entry.timer); entries.delete(entry.uri); return {};
  });
  server.server.onclose = () => { for (const entry of entries.values()) clearTimeout(entry.timer); entries.clear(); commentState?.close(); };
  return {
    register(context, data) {
      const existing = [...entries.values()].find(entry => entry.context.sessionId === context.sessionId && entry.sourcePath === data.sourcePath);
      if (existing) return { ...data, resourceUri: existing.uri };
      const uri = `ui://suian-side-editor/text/${randomUUID()}`;
      const snapshot = diskSnapshot(data);
      entries.set(uri, { uri, context, snapshot, sourcePath: data.sourcePath, relativePath: data.relativePath, reading: Promise.resolve() });
      return { ...data, resourceUri: uri };
    }
  };
}
