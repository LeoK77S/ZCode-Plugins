import test from 'node:test';
import assert from 'node:assert/strict';
import { MCP_APP_MIME_TYPE, supportsZcodeMcpApps } from '../ui-capabilities.mjs';

const apps = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };

test('公共 UI 能力入口优先使用 Desktop 应用版本，不将 CLI 版本作为应用版本', () => {
  assert.equal(MCP_APP_MIME_TYPE, 'text/html;profile=mcp-app');
  assert.equal(supportsZcodeMcpApps({
    clientInfo: { name: 'zcode', version: '0.16.9' },
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
    zcodeAppVersion: '3.15.1.8093'
  }), true);
});

test('公共 UI 判定保持已有版本门槛、版本格式和 Desktop 优先语义', () => {
  for (const [zcodeAppVersion, clientVersion, enabled] of [
    ['3.15.1', '0.16.9', true], ['3.15.1.8093', '0.16.9', true],
    ['3.15.1+build.8093', '0.16.9', true], ['3.16.0', '0.16.9', true], ['4.0.0', '0.16.9', true],
    ['3.15.0', '3.15.1', false], ['3.14.5', '3.15.1', false], ['2.99.99', '3.15.1', false],
    ['unknown', '3.15.1', false], ['', '3.15.1', false], ['3.15.1-beta.1', '3.15.1', false],
    ['3.15.1.8093.1', '3.15.1', false], ['v3.15.1', '3.15.1', false],
    [undefined, '3.15.1', true], [null, '3.15.1', true], [undefined, '0.16.9', false],
    [undefined, 'unknown', false], [undefined, undefined, false]
  ]) {
    assert.equal(supportsZcodeMcpApps({
      clientInfo: { name: 'zcode', version: clientVersion }, capabilities: apps, zcodeAppVersion
    }), enabled, JSON.stringify({ zcodeAppVersion, clientVersion }));
  }
});

test('公共 UI 判定要求 ZCode 客户端与完整 MCP Apps MIME 能力', () => {
  for (const clientInfo of [undefined, null, {}, { name: 'other-client' }, { name: 'ZCode' }]) {
    assert.equal(supportsZcodeMcpApps({ clientInfo, capabilities: apps, zcodeAppVersion: '3.15.1' }), false);
  }
  for (const capabilities of [
    undefined, null, {}, { extensions: {} }, { extensions: { 'io.modelcontextprotocol/ui': {} } },
    ...[undefined, null, [], ['text/html'], ['TEXT/HTML;PROFILE=MCP-APP'], 'text/html;profile=mcp-app', {}]
      .map(mimeTypes => ({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes } } }))
  ]) {
    assert.equal(supportsZcodeMcpApps({
      clientInfo: { name: 'zcode', version: '3.15.1' }, capabilities
    }), false, JSON.stringify(capabilities));
  }
  assert.equal(supportsZcodeMcpApps({
    clientInfo: { name: 'zcode', version: '3.15.1' },
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html', 'text/html;profile=mcp-app'] } } }
  }), true);
});
