import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

await createMcpServer({ indexDbPath: process.env.SUIAN_SIDE_EDITOR_INDEX_DB ?? join(homedir(), '.zcode', 'v2', 'tasks-index.sqlite') }).connect(new StdioServerTransport());
