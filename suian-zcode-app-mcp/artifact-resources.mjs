import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveCaller } from './caller.mjs';

/** 工件面板订阅的变更信号资源：单 URI 覆盖所有会话，数据仍以 get_artifacts 工具为准。 */
export const ARTIFACT_RESOURCE_URI = 'suian-artifacts://current';

/**
 * 注册工件资源与订阅协议（ZCode 宿主的 experimental `zcode/resourceSubscribe` 扩展）。
 *
 * 资源 read 按请求上下文尽力解析会话——宿主转发工具调用时注入的 `com.zcode/request-context`
 * 是否同样注入资源请求不属于稳定契约，因此页面只把订阅当刷新信号，数据统一走 get_artifacts；
 * read 缺上下文时返回说明而非报错。宿主的 subscribe 请求携带 scopeId/generation 等归属扩展参数，
 * 规范 schema 剥离未知字段后仅剩 uri，记录集合只在连接存活期内有效。
 */
export function registerArtifactResources(server, config, store) {
  const subscribed = new Set();
  // 资源能力注册须在连接建立前完成（SDK 禁止连接后追加能力）；未连接时的 list_changed 通知由高层静默跳过
  server.registerResource('suian-artifacts', ARTIFACT_RESOURCE_URI, {
    mimeType: 'application/json',
    description: '当前会话的工件清单与统计。读取按请求上下文解析会话；面板订阅其变更作为刷新信号，数据以 get_artifacts 工具为准。'
  }, async (uri, extra) => {
    let sessionId;
    try { sessionId = resolveCaller({ meta: extra._meta, sessionDbPath: config.sessionDbPath, toolName: 'get_artifacts' }).sessionId; }
    catch { sessionId = undefined; }
    const payload = sessionId ? store.get(sessionId)
      : { error: 'resource_context_missing: 资源读取缺少会话上下文，请改用 get_artifacts 工具读取工件' };
    return { contents: [{ uri: ARTIFACT_RESOURCE_URI, mimeType: 'application/json', text: JSON.stringify(payload) }] };
  });
    server.server.setRequestHandler(SubscribeRequestSchema, async request => {
      // 只接受已注册资源：未知 uri 不入集合，避免订阅集合无界增长与向未声明资源推送
      if (request.params.uri === ARTIFACT_RESOURCE_URI) subscribed.add(request.params.uri);
      return {};
    });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async request => {
    subscribed.delete(request.params.uri);
    return {};
  });
  return {
    /** 工件状态实际写入后调用：向已订阅 URI 推送 updated 通知，发送失败不阻塞写路径。 */
    notifyChanged() {
      for (const uri of subscribed) void server.server.sendResourceUpdated({ uri }).catch(() => undefined);
    }
  };
}
