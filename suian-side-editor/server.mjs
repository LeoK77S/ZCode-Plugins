import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { realpath, stat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { MCP_APP_MIME_TYPE, supportsZcodeMcpApps } from 'suian-zcode-common/ui-capabilities.mjs';
import { readTextFile } from './text-files.mjs';

export const EDITOR_URI = 'ui://suian-side-editor/editor.html';
const failure = (code, message) => Object.assign(new Error(message), { code });

async function boundContext(workspaceRoot, meta) {
  const nested = meta?.['com.zcode/request-context'];
  if (nested !== undefined && (!nested || typeof nested !== 'object' || Array.isArray(nested)))
    throw failure('session_binding_invalid', '宿主请求上下文不是有效对象');
  const ids = [...new Set([meta?.session_id, nested?.session_id].filter(value => value !== undefined))];
  if (!ids.length) throw failure('session_binding_unavailable', '宿主请求未提供可信 session_id，已阻止文件访问');
  if (ids.length !== 1 || typeof ids[0] !== 'string' || !ids[0].trim() || ids[0] !== ids[0].trim())
    throw failure('session_binding_invalid', '宿主会话归属缺失、无效或冲突，已阻止文件访问');
  if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot) || workspaceRoot.includes('${'))
    throw failure('workspace_binding_unavailable', '启动环境未绑定有效的绝对工作区路径，已阻止文件访问');
  let workspacePath;
  try {
    workspacePath = await realpath(workspaceRoot);
    if (!(await stat(workspacePath)).isDirectory()) throw new Error('工作区不是目录');
  } catch {
    throw failure('workspace_binding_unavailable', '启动绑定的工作区不可访问或不是目录，已阻止文件访问');
  }
  const identityPath = process.platform === 'win32' ? workspacePath.toLowerCase() : workspacePath;
  return { sessionId: ids[0], workspacePath, workspaceIdentity: `sha256:${createHash('sha256').update(identityPath).digest('hex')}`,
    capabilities: { readText: true, saveText: false } };
}

export function createMcpServer({ workspaceRoot = process.env.SUIAN_SIDE_EDITOR_WORKSPACE, zcodeAppVersion = process.env.ZCODE_APP_VERSION } = {}) {
  const server = new McpServer({ name: 'suian-side-editor', version: '0.1.0' });
  async function run(extra, action) {
    try {
      const data = await action(await boundContext(workspaceRoot, extra._meta));
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      const causes = {
        ENOENT: ['file_not_found', '文件不存在或已删除'],
        ENOTDIR: ['file_not_found', '路径中的目录不存在'],
        EISDIR: ['not_text_file', '目标是目录，不是文本文件'],
        EACCES: ['permission_denied', '没有读取该文件的权限'],
        EPERM: ['permission_denied', '系统拒绝读取该文件'],
        ERR_ENCODING_INVALID_ENCODED_DATA: ['invalid_utf8', '文件不是有效 UTF-8，未使用替换字符解码']
      };
      const [code, message] = causes[error.code] ?? [error.code ?? 'read_error', error.message];
      const data = { code, error: message };
      return { isError: true, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  }
  const contextTool = server.registerTool('get_editor_context', {
    description: '读取宿主绑定的当前工作区与会话；页面不能指定目标身份。',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: EDITOR_URI, surface: 'editor', visibility: ['app'] } }
  }, (_args, extra) => run(extra, context => context));
  const readTool = server.registerTool('read_editor_text', {
    description: '只读当前工作区已有 UTF-8 文本；路径为工作区内相对路径。',
    inputSchema: z.object({ path: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: EDITOR_URI, surface: 'editor', visibility: ['app'] } }
  }, ({ path }, extra) => run(extra, context => readTextFile(context, path)));
  const tools = [contextTool, readTool];
  const resource = server.registerResource('editor', EDITOR_URI, { title: '文本编辑器', mimeType: MCP_APP_MIME_TYPE }, async () => ({ contents: [{
    uri: EDITOR_URI, mimeType: MCP_APP_MIME_TYPE, text: await readFile(new URL('./ui/editor.html', import.meta.url), 'utf8'),
    _meta: { ui: { prefersBorder: false } }
  }] }));
  resource.disable();
  for (const tool of tools) tool.disable();
  server.server.oninitialized = () => {
    if (supportsZcodeMcpApps({ clientInfo: server.server.getClientVersion(), capabilities: server.server.getClientCapabilities(), zcodeAppVersion })) {
      resource.enable();
      for (const tool of tools) tool.enable();
    }
  };
  return server;
}
