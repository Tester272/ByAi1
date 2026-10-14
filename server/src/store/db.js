// server/src/store/db.js
// Persistence layer built on Node's built-in SQLite (node:sqlite) - no native deps.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { id, now } from '../util/ids.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT,
  data            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  content    TEXT NOT NULL,
  tags       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  goal        TEXT NOT NULL,
  status      TEXT NOT NULL,
  plan        TEXT,
  transcript  TEXT,
  result      TEXT,
  error       TEXT,
  steps       INTEGER NOT NULL DEFAULT 0,
  max_steps   INTEGER NOT NULL DEFAULT 25,
  config      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT,
  type       TEXT NOT NULL,
  data       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);
`;

const json = (v) => (v == null ? null : JSON.stringify(v));
const parse = (v, fallback = null) => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

export class Store {
  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ---- settings ---------------------------------------------------------
  setSetting(key, value) {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now());
    return value;
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? parse(row.value, fallback) : fallback;
  }

  allSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) out[r.key] = parse(r.value);
    return out;
  }

  // ---- conversations & messages ----------------------------------------
  createConversation({ userId = 'local', title = 'New chat' } = {}) {
    const cid = id('conv');
    const t = now();
    this.db
      .prepare(
        'INSERT INTO conversations(id, user_id, title, created_at, updated_at) VALUES(?,?,?,?,?)',
      )
      .run(cid, userId, title, t, t);
    return { id: cid, user_id: userId, title, created_at: t, updated_at: t };
  }

  getConversation(cid) {
    return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(cid) || null;
  }

  listConversations(userId = 'local') {
    return this.db
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId);
  }

  addMessage({ conversationId, role, content = '', data = null }) {
    const mid = id('msg');
    const t = now();
    this.db
      .prepare(
        'INSERT INTO messages(id, conversation_id, role, content, data, created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(mid, conversationId, role, content, json(data), t);
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, conversationId);
    return { id: mid, conversation_id: conversationId, role, content, data, created_at: t };
  }

  listMessages(conversationId, limit = 500) {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?',
      )
      .all(conversationId, limit)
      .map((m) => ({ ...m, data: parse(m.data) }));
  }

  // ---- memory -----------------------------------------------------------
  addMemory({ userId = 'local', content, tags = [] }) {
    const mid = id('mem');
    this.db
      .prepare('INSERT INTO memories(id, user_id, content, tags, created_at) VALUES(?,?,?,?,?)')
      .run(mid, userId, content, json(tags), now());
    return { id: mid, user_id: userId, content, tags };
  }

  listMemories(userId = 'local', limit = 100) {
    return this.db
      .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit)
      .map((m) => ({ ...m, tags: parse(m.tags, []) }));
  }

  searchMemories(userId = 'local', query = '', limit = 20) {
    const like = `%${query}%`;
    return this.db
      .prepare(
        'SELECT * FROM memories WHERE user_id = ? AND (content LIKE ? OR tags LIKE ?) ORDER BY created_at DESC LIMIT ?',
      )
      .all(userId, like, like, limit)
      .map((m) => ({ ...m, tags: parse(m.tags, []) }));
  }

  // ---- tasks ------------------------------------------------------------
  createTask({ userId = 'local', goal, plan = [], maxSteps = 25, config = {}, status = 'queued' }) {
    const tid = id('task');
    const t = now();
    this.db
      .prepare(
        `INSERT INTO tasks(id, user_id, goal, status, plan, transcript, result, error, steps, max_steps, config, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(tid, userId, goal, status, json(plan), json([]), null, null, 0, maxSteps, json(config), t, t);
    return this.getTask(tid);
  }

  getTask(tid) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid);
    return row ? hydrateTask(row) : null;
  }

  listTasks(userId = 'local', limit = 100) {
    return this.db
      .prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit)
      .map(hydrateTask);
  }

  nextQueuedTask() {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .get();
    return row ? hydrateTask(row) : null;
  }

  updateTask(tid, patch) {
    const current = this.getTask(tid);
    if (!current) return null;
    const merged = { ...current, ...patch, updated_at: now() };
    this.db
      .prepare(
        `UPDATE tasks SET status=?, plan=?, transcript=?, result=?, error=?, steps=?, max_steps=?, config=?, updated_at=?, started_at=?, finished_at=? WHERE id=?`,
      )
      .run(
        merged.status,
        json(merged.plan),
        json(merged.transcript),
        merged.result == null ? null : JSON.stringify(merged.result),
        merged.error,
        merged.steps ?? 0,
        merged.max_steps ?? 25,
        json(merged.config),
        merged.updated_at,
        merged.started_at ?? null,
        merged.finished_at ?? null,
        tid,
      );
    return this.getTask(tid);
  }

  // Tasks that were mid-flight when the process died are re-queued on boot.
  requeueInterrupted() {
    const info = this.db
      .prepare(
        "UPDATE tasks SET status='queued', updated_at=? WHERE status IN ('running','cancelling')",
      )
      .run(now());
    return Number(info.changes || 0);
  }

  // ---- events (append-only log used for live streaming) ----------------
  addEvent({ taskId = null, type, data = null }) {
    const info = this.db
      .prepare('INSERT INTO events(task_id, type, data, created_at) VALUES(?,?,?,?)')
      .run(taskId, type, json(data), now());
    return Number(info.lastInsertRowid);
  }

  listEvents(taskId, afterId = 0, limit = 1000) {
    return this.db
      .prepare('SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(taskId, afterId, limit)
      .map((e) => ({ ...e, data: parse(e.data) }));
  }
}

function hydrateTask(row) {
  return {
    ...row,
    plan: parse(row.plan, []),
    transcript: parse(row.transcript, []),
    result: parse(row.result, null),
    config: parse(row.config, {}),
  };
}

export function openStore(file) {
  return new Store(file);
}
