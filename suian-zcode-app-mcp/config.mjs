import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export async function loadConfig(values = {}) {
  const root = join(homedir(), '.zcode');
  const supplied = values.config ? JSON.parse(await readFile(values.config, 'utf8')) : {};
  const authDataDir = values['auth-data-dir'] ?? process.env.ZCODE_APP_MCP_AUTH_DATA_DIR ?? supplied.authDataDir ?? join(root, 'tools', 'suian-zcode-app-mcp');
  return {
    authDataDir,
    zcodeAppVersion: process.env.ZCODE_APP_VERSION,
    artifactDbPath: values['artifact-db'] ?? process.env.ZCODE_APP_MCP_ARTIFACT_DB ?? supplied.artifactDbPath ?? join(values.config ? dirname(resolve(values.config)) : authDataDir, 'artifacts.sqlite'),
    gatewayConfigPath: values['gateway-config'] ?? supplied.gatewayConfigPath,
    indexDbPath: values['index-db'] ?? process.env.ZCODE_APP_MCP_INDEX_DB ?? supplied.indexDbPath ?? join(root, 'v2', 'tasks-index.sqlite'),
    sessionDbPath: values['session-db'] ?? process.env.ZCODE_APP_MCP_SESSION_DB ?? supplied.sessionDbPath ?? join(root, 'cli', 'db', 'db.sqlite')
  };
}
