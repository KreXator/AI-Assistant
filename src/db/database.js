/**
 * database.js — Turso (libsql) persistence layer
 * All functions are async. Same export interface as the old JSON version.
 */
'use strict';

const crypto = require('crypto');
const turso  = require('./turso');

// ─── Schema Init ─────────────────────────────────────────────────────────────

async function init() {
  try {
    await turso.batch([
      { sql: `CREATE TABLE IF NOT EXISTS chat_history (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          role    TEXT NOT NULL,
          content TEXT NOT NULL,
          ts      TEXT NOT NULL
        )` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_history(user_id)` },
      { sql: `CREATE TABLE IF NOT EXISTS memory (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          fact    TEXT NOT NULL,
          ts      TEXT NOT NULL
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS notes (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          note    TEXT NOT NULL,
          ts      TEXT NOT NULL
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS todos (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          task    TEXT NOT NULL,
          done    INTEGER DEFAULT 0,
          ts      TEXT NOT NULL
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS config (
          user_id            TEXT PRIMARY KEY,
          model              TEXT,
          persona            TEXT DEFAULT 'default',
          manual_model       INTEGER DEFAULT 0,
          custom_instruction TEXT,
          chat_id            TEXT
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS schedules (
          id      TEXT NOT NULL,
          user_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          query   TEXT NOT NULL,
          time    TEXT NOT NULL,
          ts      TEXT NOT NULL
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS reminders (
          id      TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          text    TEXT NOT NULL,
          fire_at TEXT NOT NULL
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS briefing_feeds (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id  TEXT NOT NULL,
          url      TEXT NOT NULL,
          label    TEXT NOT NULL,
          category TEXT DEFAULT 'general',
          ts       TEXT NOT NULL
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS briefing_seen (
          user_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          PRIMARY KEY (user_id, item_id)
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS briefing_config (
          user_id         TEXT PRIMARY KEY,
          morning_time    TEXT DEFAULT '08:00',
          evening_time    TEXT DEFAULT '20:00',
          morning_enabled INTEGER DEFAULT 0,
          evening_enabled INTEGER DEFAULT 0,
          chat_id         TEXT
        )` },
      { sql: `CREATE TABLE IF NOT EXISTS briefing_keywords (
          user_id TEXT NOT NULL,
          keyword TEXT NOT NULL,
          PRIMARY KEY (user_id, keyword)
        )` },
      { sql: `DROP TABLE IF EXISTS instance_lock` },
      { sql: `CREATE TABLE instance_lock (
          lock_slot   INTEGER NOT NULL DEFAULT 1 CHECK(lock_slot = 1),
          instance_id TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat   TEXT NOT NULL,
          PRIMARY KEY (lock_slot)
        )` },
    ], 'write');
    console.log('[db] Schema ready.');
  } catch (err) {
    console.error('[db] init failed:', err.message);
  }
}

// ─── Conversation History ────────────────────────────────────────────────────

async function getHistory(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT role, content, ts FROM chat_history WHERE user_id = ? ORDER BY id',
      args: [String(userId)],
    });
    return r.rows.map(row => ({ role: row[0], content: row[1], ts: row[2] }));
  } catch (err) {
    console.error('[db] getHistory failed:', err.message);
    return [];
  }
}

async function saveHistory(userId, messages) {
  try {
    const uid = String(userId);
    const stmts = [
      { sql: 'DELETE FROM chat_history WHERE user_id = ?', args: [uid] },
      ...messages.map(m => ({
        sql:  'INSERT INTO chat_history (user_id, role, content, ts) VALUES (?, ?, ?, ?)',
        args: [uid, m.role, m.content, m.ts || new Date().toISOString()],
      })),
    ];
    await turso.batch(stmts, 'write');
  } catch (err) {
    console.error('[db] saveHistory failed:', err.message);
  }
}

async function appendMessage(userId, role, content) {
  try {
    const safeContent = (typeof content === 'string') ? content : JSON.stringify(content);
    await turso.execute({
      sql:  'INSERT INTO chat_history (user_id, role, content, ts) VALUES (?, ?, ?, ?)',
      args: [String(userId), role, safeContent, new Date().toISOString()],
    });
  } catch (err) {
    console.error('[db] appendMessage failed:', err.message);
  }
}

async function clearHistory(userId) {
  try {
    await turso.execute({
      sql:  'DELETE FROM chat_history WHERE user_id = ?',
      args: [String(userId)],
    });
  } catch (err) {
    console.error('[db] clearHistory failed:', err.message);
  }
}

// ─── Persistent Memory ───────────────────────────────────────────────────────

async function getMemory(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT fact, ts FROM memory WHERE user_id = ? ORDER BY id',
      args: [String(userId)],
    });
    return r.rows.map(row => ({ fact: row[0], ts: row[1] }));
  } catch (err) {
    console.error('[db] getMemory failed:', err.message);
    return [];
  }
}

async function addMemory(userId, fact) {
  try {
    await turso.execute({
      sql:  'INSERT INTO memory (user_id, fact, ts) VALUES (?, ?, ?)',
      args: [String(userId), fact, new Date().toISOString()],
    });
  } catch (err) {
    console.error('[db] addMemory failed:', err.message);
  }
}

async function forgetAll(userId) {
  try {
    await turso.execute({
      sql:  'DELETE FROM memory WHERE user_id = ?',
      args: [String(userId)],
    });
  } catch (err) {
    console.error('[db] forgetAll failed:', err.message);
  }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

async function getNotes(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT id, note, ts FROM notes WHERE user_id = ? ORDER BY id DESC',
      args: [String(userId)],
    });
    return r.rows.map(row => ({ note: row[1], ts: row[2] }));
  } catch (err) {
    console.error('[db] getNotes failed:', err.message);
    return [];
  }
}

async function addNote(userId, note) {
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    console.error('[db] addNote failed: userId must be a string or number.');
    return;
  }
  if (typeof note !== 'string' || note.trim() === '') {
    console.error('[db] addNote failed: note must be a non-empty string.');
    return;
  }
  try {
    await turso.execute({
      sql:  'INSERT INTO notes (user_id, note, ts) VALUES (?, ?, ?)',
      args: [String(userId), note, new Date().toISOString()],
    });
  } catch (err) {
    console.error('[db] addNote failed:', err.message);
  }
}

async function deleteNote(userId, index) {
  try {
    const r = await turso.execute({
      sql:  'SELECT id FROM notes WHERE user_id = ? ORDER BY id',
      args: [String(userId)],
    });
    if (index < 0 || index >= r.rows.length) return false;
    const id = r.rows[index][0];
    await turso.execute({ sql: 'DELETE FROM notes WHERE id = ?', args: [id] });
    return true;
  } catch (err) {
    console.error('[db] deleteNote failed:', err.message);
    return false;
  }
}

// ─── Todos ───────────────────────────────────────────────────────────────────

async function getTodos(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT id, task, done, ts FROM todos WHERE user_id = ? ORDER BY id',
      args: [String(userId)],
    });
    return r.rows.map(row => ({ task: row[1], done: !!row[2], ts: row[3] }));
  } catch (err) {
    console.error('[db] getTodos failed:', err.message);
    return [];
  }
}

async function addTodo(userId, task) {
  try {
    await turso.execute({
      sql:  'INSERT INTO todos (user_id, task, done, ts) VALUES (?, ?, 0, ?)',
      args: [String(userId), task, new Date().toISOString()],
    });
  } catch (err) {
    console.error('[db] addTodo failed:', err.message);
  }
}

async function doneTodo(userId, index) {
  try {
    const r = await turso.execute({
      sql:  'SELECT id FROM todos WHERE user_id = ? ORDER BY id',
      args: [String(userId)],
    });
    if (index < 0 || index >= r.rows.length) return false;
    const id = r.rows[index][0];
    await turso.execute({ sql: 'UPDATE todos SET done = 1 WHERE id = ?', args: [id] });
    return true;
  } catch (err) {
    console.error('[db] doneTodo failed:', err.message);
    return false;
  }
}

async function clearTodos(userId) {
  try {
    await turso.execute({
      sql:  'DELETE FROM todos WHERE user_id = ? AND done = 1',
      args: [String(userId)],
    });
  } catch (err) {
    console.error('[db] clearTodos failed:', err.message);
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.MODEL_SMALL || 'qwen2.5:3b-instruct-q4_K_M';

function _rowToConfig(row) {
  return {
    model:             row[1] || DEFAULT_MODEL,
    persona:           row[2] || 'default',
    manualModel:       !!row[3],
    customInstruction: row[4] || null,
    chatId:            row[5] ? Number(row[5]) : null,
  };
}

async function getConfig(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT user_id, model, persona, manual_model, custom_instruction, chat_id FROM config WHERE user_id = ?',
      args: [String(userId)],
    });
    if (!r.rows.length) return { model: DEFAULT_MODEL, persona: 'default', manualModel: false, customInstruction: null, chatId: null };
    return _rowToConfig(r.rows[0]);
  } catch (err) {
    console.error('[db] getConfig failed:', err.message);
    return { model: DEFAULT_MODEL, persona: 'default', manualModel: false, customInstruction: null, chatId: null };
  }
}

async function setConfig(userId, updates) {
  try {
    const current = await getConfig(userId);
    const merged  = { ...current, ...updates };
    await turso.execute({
      sql: `INSERT INTO config (user_id, model, persona, manual_model, custom_instruction, chat_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              model = excluded.model,
              persona = excluded.persona,
              manual_model = excluded.manual_model,
              custom_instruction = excluded.custom_instruction,
              chat_id = excluded.chat_id`,
      args: [
        String(userId),
        merged.model,
        merged.persona,
        merged.manualModel ? 1 : 0,
        merged.customInstruction || null,
        merged.chatId != null ? String(merged.chatId) : null,
      ],
    });
  } catch (err) {
    console.error('[db] setConfig failed:', err.message);
  }
}

// ─── Schedules ───────────────────────────────────────────────────────────────

async function getSchedules(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT id, user_id, chat_id, query, time, ts FROM schedules WHERE user_id = ? ORDER BY rowid',
      args: [String(userId)],
    });
    return r.rows.map(row => ({
      id:     row[0],
      userId: Number(row[1]),
      chatId: Number(row[2]),
      query:  row[3],
      time:   row[4],
      ts:     row[5],
    }));
  } catch (err) {
    console.error('[db] getSchedules failed:', err.message);
    return [];
  }
}

async function addSchedule(userId, chatId, query, time) {
  try {
    const schedule = {
      id:     crypto.randomUUID(),
      userId: Number(userId),
      chatId,
      query,
      time,
      ts:     new Date().toISOString(),
    };
    await turso.execute({
      sql:  'INSERT INTO schedules (id, user_id, chat_id, query, time, ts) VALUES (?, ?, ?, ?, ?, ?)',
      args: [schedule.id, String(userId), String(chatId), query, time, schedule.ts],
    });
    return schedule;
  } catch (err) {
    console.error('[db] addSchedule failed:', err.message);
    return null;
  }
}

async function removeSchedule(userId, index) {
  try {
    const r = await turso.execute({
      sql:  'SELECT id, user_id, chat_id, query, time, ts FROM schedules WHERE user_id = ? ORDER BY rowid',
      args: [String(userId)],
    });
    if (index < 0 || index >= r.rows.length) return null;
    const row = r.rows[index];
    const removed = { id: row[0], userId: Number(row[1]), chatId: Number(row[2]), query: row[3], time: row[4], ts: row[5] };
    await turso.execute({ sql: 'DELETE FROM schedules WHERE id = ?', args: [removed.id] });
    return removed;
  } catch (err) {
    console.error('[db] removeSchedule failed:', err.message);
    return null;
  }
}

async function getAllSchedules() {
  try {
    const r = await turso.execute(
      'SELECT id, user_id, chat_id, query, time, ts FROM schedules ORDER BY rowid'
    );
    return r.rows.map(row => ({
      id:     row[0],
      userId: Number(row[1]),
      chatId: Number(row[2]),
      query:  row[3],
      time:   row[4],
      ts:     row[5],
    }));
  } catch (err) {
    console.error('[db] getAllSchedules failed:', err.message);
    return [];
  }
}

// ─── Reminders ───────────────────────────────────────────────────────────────

async function loadReminders() {
  try {
    const now = new Date().toISOString();
    const r = await turso.execute({
      sql:  'SELECT id, chat_id, user_id, text, fire_at FROM reminders WHERE fire_at > ?',
      args: [now],
    });
    return r.rows.map(row => ({
      id:     row[0],
      chatId: Number(row[1]),
      userId: Number(row[2]),
      text:   row[3],
      fireAt: row[4],
    }));
  } catch (err) {
    console.error('[db] loadReminders failed:', err.message);
    return [];
  }
}

async function saveReminders(list) {
  try {
    const stmts = [
      { sql: 'DELETE FROM reminders' },
      ...list.map(r => ({
        sql:  'INSERT INTO reminders (id, chat_id, user_id, text, fire_at) VALUES (?, ?, ?, ?, ?)',
        args: [r.id, String(r.chatId), String(r.userId), r.text, r.fireAt],
      })),
    ];
    await turso.batch(stmts, 'write');
  } catch (err) {
    console.error('[db] saveReminders failed:', err.message);
  }
}

// ─── Briefing Feeds ──────────────────────────────────────────────────────────

async function getBriefingFeeds(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT url, label, category, ts FROM briefing_feeds WHERE user_id = ? ORDER BY id',
      args: [String(userId)],
    });
    return r.rows.map(row => ({ url: row[0], label: row[1], category: row[2], ts: row[3] }));
  } catch (err) {
    console.error('[db] getBriefingFeeds failed:', err.message);
    return [];
  }
}

async function addBriefingFeed(userId, url, label, category = 'general') {
  try {
    await turso.batch([
      { sql: 'DELETE FROM briefing_feeds WHERE user_id = ? AND label = ?', args: [String(userId), label] },
      { sql: 'INSERT INTO briefing_feeds (user_id, url, label, category, ts) VALUES (?, ?, ?, ?, ?)',
        args: [String(userId), url, label, category, new Date().toISOString()] },
    ], 'write');
  } catch (err) {
    console.error('[db] addBriefingFeed failed:', err.message);
  }
}

async function removeBriefingFeed(userId, label) {
  try {
    const r = await turso.execute({
      sql:  'SELECT COUNT(*) FROM briefing_feeds WHERE user_id = ? AND label = ?',
      args: [String(userId), label],
    });
    const count = Number(r.rows[0][0]);
    if (!count) return false;
    await turso.execute({
      sql:  'DELETE FROM briefing_feeds WHERE user_id = ? AND label = ?',
      args: [String(userId), label],
    });
    return true;
  } catch (err) {
    console.error('[db] removeBriefingFeed failed:', err.message);
    return false;
  }
}

// ─── Briefing Seen IDs ────────────────────────────────────────────────────────

const SEEN_MAX = 2000;

async function getBriefingSeenIds(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT item_id FROM briefing_seen WHERE user_id = ?',
      args: [String(userId)],
    });
    return new Set(r.rows.map(row => row[0]));
  } catch (err) {
    console.error('[db] getBriefingSeenIds failed:', err.message);
    return new Set();
  }
}

async function markBriefingSeen(userId, ids) {
  if (!ids.length) return;
  try {
    const uid = String(userId);
    // insert new
    const stmts = ids.map(id => ({
      sql:  'INSERT OR IGNORE INTO briefing_seen (user_id, item_id) VALUES (?, ?)',
      args: [uid, id],
    }));
    await turso.batch(stmts, 'write');
    // prune if over cap — keep newest SEEN_MAX by rowid
    const countR = await turso.execute({
      sql: 'SELECT COUNT(*) FROM briefing_seen WHERE user_id = ?', args: [uid],
    });
    const total = Number(countR.rows[0][0]);
    if (total > SEEN_MAX) {
      await turso.execute({
        sql:  `DELETE FROM briefing_seen WHERE user_id = ? AND rowid NOT IN (
                 SELECT rowid FROM briefing_seen WHERE user_id = ? ORDER BY rowid DESC LIMIT ?
               )`,
        args: [uid, uid, SEEN_MAX],
      });
    }
  } catch (err) {
    console.error('[db] markBriefingSeen failed:', err.message);
  }
}

// ─── Briefing Config ─────────────────────────────────────────────────────────

const DEFAULT_BRIEFING_CFG = {
  morningTime:    '08:00',
  eveningTime:    '20:00',
  morningEnabled: false,
  eveningEnabled: false,
  chatId:         null,
};

async function getBriefingConfig(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT morning_time, evening_time, morning_enabled, evening_enabled, chat_id FROM briefing_config WHERE user_id = ?',
      args: [String(userId)],
    });
    if (!r.rows.length) return { ...DEFAULT_BRIEFING_CFG };
    const row = r.rows[0];
    return {
      morningTime:    row[0] || DEFAULT_BRIEFING_CFG.morningTime,
      eveningTime:    row[1] || DEFAULT_BRIEFING_CFG.eveningTime,
      morningEnabled: !!row[2],
      eveningEnabled: !!row[3],
      chatId:         row[4] ? Number(row[4]) : null,
    };
  } catch (err) {
    console.error('[db] getBriefingConfig failed:', err.message);
    return { ...DEFAULT_BRIEFING_CFG };
  }
}

async function setBriefingConfig(userId, updates) {
  try {
    const current = await getBriefingConfig(userId);
    const merged  = { ...current, ...updates };
    await turso.execute({
      sql: `INSERT INTO briefing_config (user_id, morning_time, evening_time, morning_enabled, evening_enabled, chat_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              morning_time    = excluded.morning_time,
              evening_time    = excluded.evening_time,
              morning_enabled = excluded.morning_enabled,
              evening_enabled = excluded.evening_enabled,
              chat_id         = excluded.chat_id`,
      args: [
        String(userId),
        merged.morningTime,
        merged.eveningTime,
        merged.morningEnabled ? 1 : 0,
        merged.eveningEnabled ? 1 : 0,
        merged.chatId != null ? String(merged.chatId) : null,
      ],
    });
  } catch (err) {
    console.error('[db] setBriefingConfig failed:', err.message);
  }
}

async function getAllBriefingConfigs() {
  try {
    const r = await turso.execute(
      'SELECT user_id, morning_time, evening_time, morning_enabled, evening_enabled, chat_id FROM briefing_config'
    );
    return r.rows.map(row => ({
      userId:         Number(row[0]),
      morningTime:    row[1] || DEFAULT_BRIEFING_CFG.morningTime,
      eveningTime:    row[2] || DEFAULT_BRIEFING_CFG.eveningTime,
      morningEnabled: !!row[3],
      eveningEnabled: !!row[4],
      chatId:         row[5] ? Number(row[5]) : null,
    }));
  } catch (err) {
    console.error('[db] getAllBriefingConfigs failed:', err.message);
    return [];
  }
}

// ─── Briefing Keywords ───────────────────────────────────────────────────────

async function getBriefingKeywords(userId) {
  try {
    const r = await turso.execute({
      sql:  'SELECT keyword FROM briefing_keywords WHERE user_id = ? ORDER BY rowid',
      args: [String(userId)],
    });
    return r.rows.map(row => row[0]);
  } catch (err) {
    console.error('[db] getBriefingKeywords failed:', err.message);
    return [];
  }
}

async function addBriefingKeyword(userId, keyword) {
  try {
    const kw = keyword.trim().toLowerCase();
    const r  = await turso.execute({
      sql:  'SELECT COUNT(*) FROM briefing_keywords WHERE user_id = ? AND keyword = ?',
      args: [String(userId), kw],
    });
    if (Number(r.rows[0][0]) > 0) return false;
    await turso.execute({
      sql:  'INSERT INTO briefing_keywords (user_id, keyword) VALUES (?, ?)',
      args: [String(userId), kw],
    });
    return true;
  } catch (err) {
    console.error('[db] addBriefingKeyword failed:', err.message);
    return false;
  }
}

async function removeBriefingKeyword(userId, keyword) {
  try {
    const kw = keyword.trim().toLowerCase();
    const r  = await turso.execute({
      sql:  'SELECT COUNT(*) FROM briefing_keywords WHERE user_id = ? AND keyword = ?',
      args: [String(userId), kw],
    });
    if (!Number(r.rows[0][0])) return false;
    await turso.execute({
      sql:  'DELETE FROM briefing_keywords WHERE user_id = ? AND keyword = ?',
      args: [String(userId), kw],
    });
    return true;
  } catch (err) {
    console.error('[db] removeBriefingKeyword failed:', err.message);
    return false;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/** Returns [{userId, chatId}] for every user that has a stored chatId. */
async function getAllChatIds() {
  try {
    const r = await turso.execute(
      'SELECT user_id, chat_id FROM config WHERE chat_id IS NOT NULL'
    );
    return r.rows.map(row => ({ userId: Number(row[0]), chatId: Number(row[1]) }));
  } catch (err) {
    console.error('[db] getAllChatIds failed:', err.message);
    return [];
  }
}

module.exports = {
  init,
  // history
  getHistory, saveHistory, appendMessage, clearHistory,
  // memory
  getMemory, addMemory, forgetAll,
  // notes
  getNotes, addNote, deleteNote,
  // todos
  getTodos, addTodo, doneTodo, clearTodos,
  // config
  getConfig, setConfig, getAllChatIds,
  // schedules
  getSchedules, addSchedule, removeSchedule, getAllSchedules,
  // reminders
  loadReminders, saveReminders,
  // briefing
  getBriefingFeeds, addBriefingFeed, removeBriefingFeed,
  getBriefingSeenIds, markBriefingSeen,
  getBriefingConfig, setBriefingConfig, getAllBriefingConfigs,
  getBriefingKeywords, addBriefingKeyword, removeBriefingKeyword,
};
