import assert from 'node:assert/strict';
import { encodeTopicWireFrames, measureTopicNotificationEnvelopeBytes } from 'suian-zcode-common/vendor/conversation-wire.js';

export function userRow(text, rowId = 1) {
  return { rowId, turnId: `turn-${rowId}`, entityId: `message-${rowId}`, visibility: 'visible', createdAt: 1, createdAtSeq: rowId, kind: 'userInput', text, origin: 'realUser' };
}
export function queueItem(text) {
  return { sourceCommandId: 'queued-command', queueItemId: 'queued-item', clientId: 'queued-client', kind: 'sendText', text,
    delivery: { requested: 'queue', admitted: 'queue' }, order: { admissionSeq: 1 }, steer: { state: 'notRequested' }, dispatch: { state: 'queued' }, admittedAt: 1 };
}
export function v4Snapshot({ sessionId, rows = [], queue = [], seq = rows.length, revision = rows.length, logEpoch = 'fixture-epoch' }) {
  return { protocolVersion: 1, sessionId, logEpoch, seq, revision,
    control: { phase: 'completedSuccess', sessionEnded: true, canStop: false, stopState: 'idle', stopTargetKind: 'unknown', activeWorks: [], lastError: null, apiRetry: null },
    availability: Object.fromEntries(['fork', 'compact', 'switchModelConfig', 'setFollowupMode', 'queueEdit', 'sendQueuedNow', 'pauseGoal', 'resumeGoal'].map(key => [key, { allowed: true }])),
    inputRouting: { mode: 'startNow' }, config: { provider: 'fixture', model: 'fixture', thought: 'disabled', thoughtLevels: ['disabled'], followupMode: 'queue', mode: 'build', modelSelection: { providerId: 'fixture', modelId: 'fixture' }, planEnabled: false },
    usage: { contextWindow: null, cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    queue: { items: queue, autoDrain: true }, pendingInteractions: [], pendingCommands: [], backgroundWorks: [], goal: null, plan: null,
    rows: { window: rows.slice(-60), totalCount: rows.length, firstRowId: rows[0]?.rowId ?? 0 } };
}
export function wires(snapshot, subscriptionId = 'fixture-sub', maxPhysicalFrameBytes) {
  const topic = `conversation/${snapshot.sessionId}`;
  return encodeTopicWireFrames({ topic, subscriptionId, fromSeq: 0, toSeq: snapshot.seq, sentAt: 1, payload: { kind: 'snapshot', snapshot } },
    { topic, subscriptionId, deliveryKind: 'initial', logicalFrameId: 'fixture-initial', logicalFrameOrdinal: 1,
      ...(maxPhysicalFrameBytes ? { maxPhysicalFrameBytes } : {}), measurePhysicalFrameBytes: wire => measureTopicNotificationEnvelopeBytes(wire).maxBytes });
}

// 只在测试中模拟已核实的公共 Host；所有未知方法都失败，不接真实网关。
export function commentHost({ options, state = { meta: { status: 'completed' }, runtime: {}, messages: [] }, events = [], onCall = () => {}, onClose = () => {}, onDispose = () => {}, rows, queue, snapshot, page, maxPhysicalFrameBytes, beforeAck, afterAck, helloCapabilities = {} }) {
  let listener, current, currentRows;
  const getRows = () => {
    if (rows) return rows();
    const started = events.filter(event => event.type === 'turn.started' && event.sessionId === options.sessionId).map((event, index) => userRow(event.payload.input, index + 1));
    return [...started, ...state.messages.filter(message => !message.bodyRefs?.some(ref => ref.field === 'content')).map((message, index) => ({ ...userRow(message.content, started.length + index + 1), ...(message.role === 'assistant' ? { kind: 'assistantText', state: 'complete' } : {}) }))];
  };
  return {
    listen(channel, event, args) {
      assert.equal(channel, 'zcode-agent'); assert.equal(event, 'onDynamicConversationFrame'); assert.deepEqual(args, { workspacePath: options.workspacePath });
      return callback => { listener = callback; return { dispose() { listener = undefined; onDispose(); } }; };
    },
    async call(channel, method, args) {
      await onCall({ options, channel, method, args });
      if (method === 'getTaskSnapshot') return { ...state, messages: state.messages.slice(-args[0].messageLimit) };
      assert.equal(channel, 'zcode-agent');
      if (method === 'readSessionEvents') throw new Error('strict payload: Unrecognized key fullAccessSupported');
      if (method === 'helloConversationV4') { assert.deepEqual(args, []); return { protocolVersion: 3, capabilities: helloCapabilities, clientMode: 'web-remote-replayable' }; }
      if (method === 'initializeConversationV4') { assert.equal(args[0].protocolVersion, 3); return {}; }
      if (method === 'subscribeConversationV4') {
        assert.deepEqual(args, [{ workspacePath: options.workspacePath, sessionId: options.sessionId, visibility: 'background' }]); assert.equal(typeof listener, 'function');
        currentRows = getRows(); current = snapshot?.() ?? v4Snapshot({ sessionId: options.sessionId, rows: currentRows,
          queue: queue?.() ?? events.filter(event => event.type === 'turn.steerQueued' && event.sessionId === options.sessionId).map(event => queueItem(event.payload.input)) });
        const frames = wires(current, 'fixture-sub', maxPhysicalFrameBytes);
        if (beforeAck) await beforeAck(listener, frames); else frames.forEach(listener);
        if (afterAck) setImmediate(() => afterAck(listener, frames));
        return { ack: { subscriptionId: 'fixture-sub', mode: 'snapshot', logEpoch: current.logEpoch } };
      }
      if (method === 'conversationRowsRangeV4') {
        if (page) return page(args[0], current);
        const all = currentRows.filter(row => args[0].beforeRowId === undefined || row.rowId < args[0].beforeRowId);
        return { rows: all.slice(-args[0].limit), atSeq: current.seq, atRevision: current.revision, atLogEpoch: current.logEpoch, hasMore: all.length > args[0].limit };
      }
      if (method === 'unsubscribeConversationV4') { assert.deepEqual(args, [{ workspacePath: options.workspacePath, subscriptionId: 'fixture-sub', runtimePolicy: 'existing-only' }]); return {}; }
      assert.fail(`未核公开方法：${method}`);
    }, close: onClose
  };
}
