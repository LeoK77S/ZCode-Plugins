import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const failure = (code, message) => Object.assign(new Error(message), { code });

// 此票只保存模式；正文和页签恢复由后续票加入，不混用源文件保存回执。
export async function editorSettings(dataPath, context, saveMode) {
  if (typeof dataPath !== 'string' || !isAbsolute(dataPath) || dataPath.includes('${'))
    throw failure('state_data_path_unavailable', '宿主未提供有效的插件数据目录，无法持久化保存方式');
  let db, transaction = false;
  try {
    await mkdir(dataPath, { recursive: true });
    db = new DatabaseSync(join(dataPath, 'editor-state.sqlite'));
    db.exec('PRAGMA busy_timeout=2000');
    // 保留 SQLite 默认回滚日志，不在多个冷进程间竞争切换 journal_mode。
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE'); transaction = true;
    // schema 判定和初始化也属于写事务，其他进程不能沿用抢锁前的旧版本。
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== 1) throw failure('state_schema_incompatible', '编辑器状态数据库版本不兼容，未重置已有数据');
    if (version === 0) {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)
        throw failure('state_schema_incompatible', '编辑器状态数据库缺少有效版本，未重置已有数据');
      db.exec("CREATE TABLE editor_defaults (id INTEGER PRIMARY KEY CHECK(id=1), save_mode TEXT NOT NULL CHECK(save_mode IN ('manual','auto'))); CREATE TABLE session_settings (workspace_identity TEXT NOT NULL, session_id TEXT NOT NULL, save_mode TEXT NOT NULL CHECK(save_mode IN ('manual','auto')), PRIMARY KEY(workspace_identity,session_id)); PRAGMA user_version=1");
    }
    db.prepare("INSERT OR IGNORE INTO editor_defaults VALUES (1,'manual')").run();
    if (saveMode !== undefined) {
      db.prepare('UPDATE editor_defaults SET save_mode=? WHERE id=1').run(saveMode);
      db.prepare('INSERT INTO session_settings VALUES (?,?,?) ON CONFLICT(workspace_identity,session_id) DO UPDATE SET save_mode=excluded.save_mode')
        .run(context.workspaceIdentity, context.sessionId, saveMode);
    } else {
      db.prepare('INSERT OR IGNORE INTO session_settings SELECT ?,?,save_mode FROM editor_defaults WHERE id=1')
        .run(context.workspaceIdentity, context.sessionId);
    }
    const row = db.prepare('SELECT save_mode FROM session_settings WHERE workspace_identity=? AND session_id=?').get(context.workspaceIdentity, context.sessionId);
    if (!row || !['manual', 'auto'].includes(row.save_mode)) throw failure('state_schema_incompatible', '编辑器状态数据库内容无效，未重置已有数据');
    db.exec('COMMIT'); transaction = false;
    return { saveMode: row.save_mode };
  } catch (error) {
    if (transaction) { try { db.exec('ROLLBACK'); } catch {} }
    if (error.code?.startsWith('state_')) throw error;
    if ([11, 26].includes(error.errcode & 255)) throw failure('state_database_corrupt', '编辑器状态数据库损坏或格式无效，未重置已有数据');
    throw failure('state_storage_error', '无法访问或写入编辑器状态数据库，保存方式未确认持久化');
  } finally { db?.close(); }
}
