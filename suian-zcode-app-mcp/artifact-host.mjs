import { DatabaseSync } from 'node:sqlite';

export function readHost(path, read) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try { db.exec('PRAGMA query_only=ON'); return read(db); }
  finally { db.close(); }
}

// 3.15.1 的持久消息契约；不用 renderer ID、时间近似或父最新状态。
export function readForkOrigin(sessionDbPath, sessionId) {
  return readHost(sessionDbPath, db => {
    const session = db.prepare('SELECT parent_id, task_type FROM session WHERE id=?').get(sessionId);
    if (session?.task_type !== 'fork') return null;
    const row = db.prepare(`SELECT data FROM message WHERE session_id=?
      AND json_extract(data, '$.semantics.kind')='fork_notice'
      AND json_extract(data, '$.semantics.uiVisibility')='hidden'
      ORDER BY sequence DESC LIMIT 1`).get(sessionId);
    const origin = row && JSON.parse(row.data).metadata?.forkOrigin;
    if (!origin || origin.parentSessionId !== session.parent_id || typeof origin.targetMessageId !== 'string' || !origin.targetMessageId) {
      throw Object.assign(new Error('无法核实分叉的原始父会话和消息断点'), { code: 'fork_origin_invalid' });
    }
    return origin;
  });
}

export function readStopBoundary(sessionDbPath, sessionId, turnId) {
  return readHost(sessionDbPath, db => {
    const row = db.prepare(`SELECT id FROM message WHERE session_id=?
      AND json_extract(data, '$.role')='assistant'
      AND json_extract(data, '$.semantics.kind')='assistant_response'
      AND json_extract(data, '$.time.completed') IS NOT NULL
      AND json_extract(data, '$.anchor.turnId')=? ORDER BY sequence DESC LIMIT 1`).get(sessionId, turnId);
    if (!row) throw Object.assign(new Error('Stop 对应的已完成 assistant 消息尚不存在'), { code: 'checkpoint_unavailable' });
    return row.id;
  });
}
