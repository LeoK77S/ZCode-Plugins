import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';

await createMcpServer().connect(new StdioServerTransport());
