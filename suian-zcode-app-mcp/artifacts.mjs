import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { readForkOrigin, readHost, readStopBoundary } from './artifact-host.mjs';

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

export function createArtifactStore({ artifactDbPath, sessionDbPath, indexDbPath, now = Date.now }) {
  function exists() {
    try { statSync(artifactDbPath); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  // 会话列表名称的权威源是任务索引（renameTask 先写索引，CLI 会话库是可能滞后的同步副本）；
  // 同 task_id 跨工作区多行时借 MAX 裸列语义取 updated_at 最新一行的 title；空标题视为无名，不入结果。
  function indexTitles(sessionIds) {
    if (!indexDbPath || !sessionIds.length) return new Map();
    return readHost(indexDbPath, db => new Map(db.prepare(
      `SELECT task_id, title, MAX(updated_at) FROM tasks WHERE deleted=0 AND task_id IN (${sessionIds.map(() => '?').join(',')}) GROUP BY task_id`
    ).all(...sessionIds).flatMap(row => row.title ? [[row.task_id, row.title]] : [])));
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

  function update(db, sessionId, { expected_revision, upsert = [], remove = [] }) {
    const previous = storedState(db, sessionId);
    if (expected_revision !== undefined && previous.revision !== expected_revision) throw Object.assign(new Error('工件版本冲突，请 get_artifacts 后重新判断增量'), {
      code: 'revision_conflict', expected_revision, current_revision: previous.revision
    });
    let removed = 0, upserted = 0;
    const items = previous.items.filter(item => { if (!remove.includes(item.ref)) return true; removed++; return false; });
    for (const item of upsert) {
      const index = items.findIndex(old => old.ref === item.ref), previousItem = items[index];
      if (previousItem && ['kind', 'ref', 'label', 'purpose'].every(key => previousItem[key] === item[key]) &&
          (item.session_link === undefined || JSON.stringify(item.session_link) === JSON.stringify(previousItem.session_link))) continue;
      const time = now(), link = item.session_link ?? previousItem?.session_link;
      const updated = { ...item, created_at: previousItem ? previousItem.created_at ?? null : time, updated_at: time,
        ...(item.kind === 'session' && link ? { session_link: link } : {}) };
      if (index < 0) items.push(updated);
      else items[index] = updated;
      upserted++;
    }
    const changed = removed + upserted > 0, revision = previous.revision + Number(changed);
    if (changed) db.prepare('INSERT INTO artifact_state (session_id,revision,items) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision, items=excluded.items')
      .run(sessionId, revision, JSON.stringify(items));
    return { revision, changed, upserted, removed, stats: artifactStats(items) };
  }

  return {
    initialize,
    linkSessions({ creator, created, creatorLabel, createdLabel }) {
      initialize(creator);
      const db = open(true);
      try {
        const session_link = { creator, created };
        for (const [id, ref, label, purpose] of [
          [creator, created, createdLabel, '由当前会话发起的任务'],
          [created, creator, creatorLabel, '当前会话的发起会话']
        ]) {
          const old = storedState(db, id).items.find(item => item.ref === ref);
          update(db, id, { upsert: [{ kind: 'session', ref, label: old?.label ?? label, purpose: old?.purpose ?? purpose, session_link }] });
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { db.close(); }
    },
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
        let titles = new Map();
        try { titles = indexTitles([...new Set(state.items.filter(item => item.kind === 'session').map(item => item.ref))]); }
        catch (error) { console.error(JSON.stringify({ code: 'artifact_index_title_degraded', error: error.message })); }
        const items = state.items.map(item => {
          const directed = item.session_link ? { ...item, session_direction:
            sessionId === item.session_link.creator ? 'outgoing' : sessionId === item.session_link.created ? 'incoming' : 'related' } : item;
          const title = directed.kind === 'session' ? titles.get(directed.ref) : null;
          return title != null ? { ...directed, session_title: title } : directed;
        });
        return { ...state, items, stats: artifactStats(items) };
      } finally { db?.close(); }
    },
    set(sessionId, { expected_revision, upsert = [], remove = [] }) {
      validateBatch(upsert, remove);
      initialize(sessionId);
      const db = open(true);
      try {
        const result = update(db, sessionId, { expected_revision, upsert, remove });
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { db.close(); }
    }
  };
}
