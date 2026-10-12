import { z } from 'zod';
import { createArtifactStore } from './artifacts.mjs';
import { resolveCaller } from './caller.mjs';
import { registerArtifactUi } from './artifact-ui.mjs';

export function registerArtifactTools(server, config) {
  const store = createArtifactStore(config);
  const text = z.string().refine(value => value.trim().length > 0, '必须是非空字符串');
  function run(extra, name, action) {
    try {
      const origin = resolveCaller({ meta: extra._meta, sessionDbPath: config.sessionDbPath, toolName: name });
      if (!origin.sessionId) throw Object.assign(new Error(origin.warning.message), { code: origin.warning.code });
      const data = action(origin.sessionId);
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      const data = { ...error, code: error.code ?? error.message.split(':')[0], error: error.message };
      return { isError: true, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  }
  const getTool = server.registerTool('get_artifacts', {
    description: '读取当前会话最新工件版本、完整条目与分类统计；提交时摘要可能已过时。',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, (_, extra) => run(extra, 'get_artifacts', id => store.get(id)));
  const setTool = server.registerTool('set_artifacts', {
    description: '按 expected_revision 原子更新当前会话工件，冲突时先 get_artifacts；仅登记引用，不操作资源。',
    inputSchema: z.object({ expected_revision: z.number().int().nonnegative(),
      upsert: z.array(z.object({ kind: z.enum(['pr', 'session', 'file', 'link']), ref: text, label: text, purpose: text }).strict()).optional(),
      remove: z.array(text).optional()
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, (args, extra) => run(extra, 'set_artifacts', id => store.set(id, args)));
  registerArtifactUi(server, getTool, setTool, config);
}
