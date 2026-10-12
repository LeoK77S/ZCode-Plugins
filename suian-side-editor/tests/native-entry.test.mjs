import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('独立原生入口绑定宿主工作区，元信息使用 session 侧栏和 common 依赖', () => {
  const root = new URL('../', import.meta.url);
  assert.ok(existsSync(new URL('.zcode-plugin/plugin.json', root)), 'SE-01 原生插件元信息尚未提供');
  const plugin = JSON.parse(readFileSync(new URL('.zcode-plugin/plugin.json', root)));
  assert.equal(plugin.name, 'suian-side-editor');
  assert.deepEqual(plugin.dependencies, ['suian-zcode-common']);
  assert.deepEqual(plugin.ui.surfaces, [{ id: 'editor', title: { 'zh-CN': '文本编辑器', en: 'Text editor' }, server: 'suian-side-editor', resourceUri: 'ui://suian-side-editor/editor.html', availability: 'session' }]);
  const mcp = JSON.parse(readFileSync(new URL('.mcp.json', root))).mcpServers['suian-side-editor'];
  assert.equal(mcp.type, 'stdio');
  assert.equal(mcp.cwd, '${ZCODE_PROJECT_DIR}');
  assert.deepEqual(mcp.env, { SUIAN_SIDE_EDITOR_WORKSPACE: '${ZCODE_PROJECT_DIR}' });
  assert.deepEqual(mcp.args, ['${ZCODE_PLUGIN_ROOT}/cli.mjs']);
});
