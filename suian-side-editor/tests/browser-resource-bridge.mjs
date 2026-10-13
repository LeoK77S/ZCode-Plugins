import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

// 与实际 alias 相同的公开 URI 参数、通知回调及取消函数；所有资源请求经过真实 MCP。
export async function installResourceBridge(page, client, { read = result => result, subscribe = uri => client.subscribeResource({ uri }), supported = true } = {}) {
  const calls = [];
  await page.exposeFunction('editorReadResource', async uri => {
    calls.push({ method: 'resources/read', uri });
    return read(await client.readResource({ uri }), uri);
  });
  await page.exposeFunction('editorSubscribeResource', async uri => {
    calls.push({ method: 'resources/subscribe', uri }); await subscribe(uri);
  });
  await page.exposeFunction('editorUnsubscribeResource', async uri => {
    calls.push({ method: 'resources/unsubscribe', uri }); await client.unsubscribeResource({ uri });
  });
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, async notification => {
    if (!page.isClosed()) await page.evaluate(uri => window.editorResourceUpdated(uri), notification.params.uri);
  });
  await page.addInitScript(({ supported }) => {
    const listeners = new Set();
    window.editorResourceUpdated = uri => { for (const listener of listeners) listener(uri); };
    window.zcode = {
      ready: async () => {}, subscribe: () => {}, theme: 'dark',
      hostCapabilities: { experimental: supported ? { 'zcode/resourceSubscribe': {} } : {} },
      callTool: (name, args) => window.editorCall(name, args),
      readResource: uri => window.editorReadResource(uri), subscribeResource: uri => window.editorSubscribeResource(uri),
      unsubscribeResource: uri => window.editorUnsubscribeResource(uri),
      onResourceUpdated: listener => { listeners.add(listener); return () => listeners.delete(listener); }
    };
  }, { supported });
  return calls;
}
