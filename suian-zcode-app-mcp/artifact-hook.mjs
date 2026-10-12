import { parseArgs } from 'node:util';
import { createArtifactStore } from './artifacts.mjs';
import { loadConfig } from './config.mjs';
import { artifactSummary } from './artifact-prompt.mjs';

const { values } = parseArgs({ options: { config: { type: 'string' } }, allowPositionals: false });
try {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const event = input.hookEventName ?? input.hook_event_name;
  const sessionId = input.sessionId ?? input.session_id;
  if (!['SessionStart', 'UserPromptSubmit', 'Stop'].includes(event) || typeof sessionId !== 'string' || !sessionId.trim()) {
    throw Object.assign(new Error('工件 Hook 缺少有效事件或会话身份'), { code: 'hook_input_invalid' });
  }
  const store = createArtifactStore(await loadConfig(values));
  if (event === 'Stop') {
    if (typeof input.turnId !== 'string' || !input.turnId) throw Object.assign(new Error('Stop 缺少运行时 turnId'), { code: 'hook_input_invalid' });
    store.snapshot(sessionId, input.turnId);
  } else store.initialize(sessionId);
  console.log(JSON.stringify({ suppressOutput: true, ...(event === 'UserPromptSubmit' ? {
    hookSpecificOutput: { hookEventName: event, additionalContext: artifactSummary(store.get(sessionId)) }
  } : {}) }));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'artifact_hook_failed', error: error.message }));
  process.exitCode = 1;
}
