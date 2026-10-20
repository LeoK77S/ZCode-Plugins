import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';
import { commonClient } from './common-client.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

try {
  // 先按定位契约加载公共客户端（宿主 stdio 注入 ZCODE_PLUGIN_DATA 推导安装记录）；
  // 定位失败在服务任何会话前以明确分类退出，不产生部分可用状态。
  await commonClient();
} catch (error) {
  console.error(`公共 common 客户端加载失败（${error.code ?? 'internal'}，阶段 ${error.stage ?? 'unknown'}）：${error.message}`);
  process.exit(1);
}

await createMcpServer({ indexDbPath: process.env.SUIAN_SIDE_EDITOR_INDEX_DB ?? join(homedir(), '.zcode', 'v2', 'tasks-index.sqlite') }).connect(new StdioServerTransport());
