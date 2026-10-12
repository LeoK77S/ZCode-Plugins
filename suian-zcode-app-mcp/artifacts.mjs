import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, win32 } from 'node:path';
import { artifactRepresentation } from './artifact-prompt.mjs';
import { createHash } from 'node:crypto';
import { readForkOrigin, readStopBoundary } from './artifact-host.mjs';

function invalid(message) { throw Object.assign(new Error(message), { code: 'invalid_input' }); }

function validateBatch(upsert, remove) {
  const refs = new Set();
  for (const item of upsert) {
    if (refs.has(item.ref) || remove.includes(item.ref)) invalid('同一 ref 不能重复 upsert 或同时 upsert/remove');
    refs.add(item.ref);
    if (item.kind === 'file' && !isAbsolute(item.ref) && !win32.isAbsolute(item.ref)) invalid('file ref 必须是绝对路径');
    if (item.kind === 'pr' || item.kind === 'link') {
      let url;
      try { url = new URL(item.ref); }
      catch { invalid('pr/link ref 必须是 HTTP(S) URL'); }
      if (!['http:', 'https:'].includes(url.protocol)) invalid('pr/link ref 必须是 HTTP(S) URL');
    }
  }
}

export function artifactStats(items) {
  const by_kind = { pr: 0, session: 0, file: 0, link: 0 };
  for (const item of items) by_kind[item.kind]++;
  return { total: items.length, by_kind };
}

function storedState(db, sessionId) {
  const row = db.prepare('SELECT revision, items, inheritance FROM artifact_state WHERE session_id = ?').get(sessionId);
  return row ? { revision: row.revision, items: JSON.parse(row.items), ...(row.inheritance ? { inheritance: JSON.parse(row.inheritance) } : {}) } : { revision: 0, items: [] };
}

export function createArtifactStore({ artifactDbPath, sessionDbPath }) {
  function exists() {
    try { statSync(artifactDbPath); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  function open(write = false) {
    const present = exists();
    if (!write && !present) return;
    if (write) mkdirSync(dirname(artifactDbPath), { recursive: true });
    const db = new DatabaseSync(artifactDbPath, { readOnly: !write, timeout: 5000 });
    try {
      if (write) db.exec('BEGIN IMMEDIATE');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (!present && version === 0 && write) {
        db.exec(`CREATE TABLE IF NOT EXISTS artifact_state (
          session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, items TEXT NOT NULL, inheritance TEXT
        );
        CREATE TABLE IF NOT EXISTS artifact_snapshot (snapshot_id TEXT PRIMARY KEY, items TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artifact_boundary (
          session_id TEXT NOT NULL, message_id TEXT NOT NULL, turn_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
          PRIMARY KEY (session_id, message_id)
        ); PRAGMA user_version = 1;`);
        // 库结构单独提交，业务拒绝只回滚工件状态。
        db.exec('COMMIT; BEGIN IMMEDIATE');
      } else if (version !== 1) throw Object.assign(new Error('工件存储版本不兼容'), { code: 'artifact_storage_incompatible' });
      return db;
    } catch (error) { db.close(); throw error; }
  }

  function initialize(sessionId) {
    const existing = open();
    try { if (existing?.prepare('SELECT 1 FROM artifact_state WHERE session_id=?').get(sessionId)) return; }
    finally { existing?.close(); }
    const origin = readForkOrigin(sessionDbPath, sessionId);
    if (!origin) return;
    const db = open(true);
    try {
      if (!db.prepare('SELECT 1 FROM artifact_state WHERE session_id=?').get(sessionId)) {
        const snapshot = db.prepare(`SELECT s.snapshot_id,s.items FROM artifact_boundary b
          JOIN artifact_snapshot s USING(snapshot_id) WHERE b.session_id=? AND b.message_id=?`).get(origin.parentSessionId, origin.targetMessageId);
        const inheritance = { status: snapshot ? 'inherited' : 'snapshot_missing', parent_session_id: origin.parentSessionId,
          target_message_id: origin.targetMessageId, ...(snapshot ? { snapshot_id: snapshot.snapshot_id } : { code: 'snapshot_missing' }) };
        db.prepare('INSERT INTO artifact_state VALUES (?,?,?,?)').run(sessionId, 0, snapshot?.items ?? '[]', JSON.stringify(inheritance));
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.close(); }
  }

  return {
    initialize,
    snapshot(sessionId, turnId) {
      const messageId = readStopBoundary(sessionDbPath, sessionId, turnId);
      initialize(sessionId);
      const db = open(true);
      try {
        const items = JSON.stringify(storedState(db, sessionId).items);
        const snapshotId = createHash('sha256').update(items).digest('hex');
        db.prepare('INSERT OR IGNORE INTO artifact_snapshot VALUES (?,?)').run(snapshotId, items);
        db.prepare('INSERT OR IGNORE INTO artifact_boundary VALUES (?,?,?,?)').run(sessionId, messageId, turnId, snapshotId);
        db.exec('COMMIT');
        return { message_id: messageId, snapshot_id: snapshotId };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { db.close(); }
    },
    get(sessionId) {
      initialize(sessionId);
      const db = open();
      try {
        const state = db ? storedState(db, sessionId) : { revision: 0, items: [] };
        return { ...state, stats: artifactStats(state.items) };
      } finally { db?.close(); }
    },
    set(sessionId, { expected_revision, upsert = [], remove = [] }) {
      validateBatch(upsert, remove);
      initialize(sessionId);
      const db = open(true);
      try {
        const previous = storedState(db, sessionId);
        if (previous.revision !== expected_revision) throw Object.assign(new Error('工件版本冲突，请 get_artifacts 后重新判断增量'), {
          code: 'revision_conflict', expected_revision, current_revision: previous.revision
        });
        let removed = 0, upserted = 0;
        const items = previous.items.filter(item => { if (!remove.includes(item.ref)) return true; removed++; return false; });
        for (const item of upsert) {
          const index = items.findIndex(old => old.ref === item.ref);
          if (index < 0) { items.push(item); upserted++; }
          else if (JSON.stringify(items[index]) !== JSON.stringify(item)) { items[index] = item; upserted++; }
        }
        const changed = removed + upserted > 0;
        const revision = previous.revision + Number(changed);
        const characters = Array.from(artifactRepresentation({ revision, items })).length;
        if (items.length > 20 || characters > 12000) throw Object.assign(new Error('工件容量超限，整次增量未保存'), {
          code: 'capacity_exceeded', total: items.length, max_items: 20, characters, max_characters: 12000
        });
        if (changed) db.prepare('INSERT INTO artifact_state (session_id,revision,items) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision, items=excluded.items')
          .run(sessionId, revision, JSON.stringify(items));
        db.exec('COMMIT');
        return { revision, changed, upserted, removed, stats: artifactStats(items) };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { db.close(); }
    }
  };
}
