import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, apps } from './fixtures.mjs';

test('支持的宿主取得本地构建编辑页面；不支持者没有文件工具或 UI 资源', async t => {
  for (const [name, version, capabilities, zcodeAppVersion, enabled] of [
    ['zcode', '3.15.1', apps, undefined, true], ['zcode', '0.16.9', apps, '3.15.1', true],
    ['zcode', '3.15.0', apps, undefined, false], ['zcode', '3.15.1', {}, undefined, false],
    ['other', '3.15.1', apps, undefined, false]
  ]) {
    const client = await connect(t, { zcodeAppVersion }, { name, version, capabilities });
    const resources = (await client.listResources()).resources;
    assert.equal(resources.some(item => item.uri === 'ui://suian-side-editor/editor.html'), enabled);
    assert.equal((await client.listTools()).tools.length, enabled ? 6 : 0);
    if (enabled) {
      const page = (await client.readResource({ uri: 'ui://suian-side-editor/editor.html' })).contents[0];
      assert.equal(page.mimeType, 'text/html;profile=mcp-app');
      assert.match(page.text, /get_editor_context/); assert.match(page.text, /read_editor_text/);
      assert.match(page.text, /list_editor_directory/); assert.match(page.text, /save_editor_text/);
      assert.doesNotMatch(page.text, /EDITOR_SCRIPT|EDITOR_STYLE/);
      assert.doesNotMatch(page.text, /fetch\(|https:\/\/.*\.js|sendMessage|updateModelContext|session_id/);
    }
  }
});
