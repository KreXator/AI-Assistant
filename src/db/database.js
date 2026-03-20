/**
 * database.js — JSON flat-file persistence layer
 * Manages: conversation history, persistent memory, notes, todos, config, schedules
 */
'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CHAT_FILE     = path.join(DATA_DIR, 'chat.json');
const MEMORY_FILE   = path.join(DATA_DIR, 'memory.json');
const NOTES_FILE    = path.join(DATA_DIR, 'notes.json');
const TODO_FILE     = path.join(DATA_DIR, 'todos.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'config.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedules.json');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJSON(file, defaultVal) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultVal, null, 2));
    return defaultVal;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultVal;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[db] saveJSON failed for', file, ':', err.message);
  }
}

// ─── Conversation History ────────────────────────────────────────────────────

function getHistory(userId) {
  const all = loadJSON(CHAT_FILE, {});
  return all[String(userId)] || [];
}

function saveHistory(userId, messages) {
  const all = loadJSON(CHAT_FILE, {});
  all[String(userId)] = messages;
  saveJSON(CHAT_FILE, all);
}

function appendMessage(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content, ts: Date.now() });
  saveHistory(userId, history);
}

function clearHistory(userId) {
  saveHistory(userId, []);
}

// ─── Persistent Memory (facts about the user) ───────────────────────────────

function getMemory(userId) {
  const all = loadJSON(MEMORY_FILE, {});
  return all[String(userId)] || [];
}

function addMemory(userId, fact) {
  const all  = loadJSON(MEMORY_FILE, {});
  const uid  = String(userId);
  if (!all[uid]) all[uid] = [];
  all[uid].push({ fact, ts: new Date().toISOString() });
  saveJSON(MEMORY_FILE, all);
}

function forgetAll(userId) {
  const all = loadJSON(MEMORY_FILE, {});
  all[String(userId)] = [];
  saveJSON(MEMORY_FILE, all);
}

// ─── Notes ──────────────────────────────────────────────────────────────────

function getNotes(userId) {
  const all = loadJSON(NOTES_FILE, {});
  return all[String(userId)] || [];
}

function addNote(userId, note) {
  const all = loadJSON(NOTES_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  all[uid].push({ note, ts: new Date().toISOString() });
  saveJSON(NOTES_FILE, all);
}

function deleteNote(userId, index) {
  const all  = loadJSON(NOTES_FILE, {});
  const uid  = String(userId);
  if (all[uid] && index >= 0 && index < all[uid].length) {
    all[uid].splice(index, 1);
    saveJSON(NOTES_FILE, all);
    return true;
  }
  return false;
}

// ─── Todos ───────────────────────────────────────────────────────────────────

function getTodos(userId) {
  const all = loadJSON(TODO_FILE, {});
  return all[String(userId)] || [];
}

function addTodo(userId, task) {
  const all = loadJSON(TODO_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  all[uid].push({ task, done: false, ts: new Date().toISOString() });
  saveJSON(TODO_FILE, all);
}

/**
 * Mark todo at index as done. Returns true if the index was valid, false otherwise.
 */
function doneTodo(userId, index) {
  const all = loadJSON(TODO_FILE, {});
  const uid = String(userId);
  if (all[uid] && index >= 0 && index < all[uid].length) {
    all[uid][index].done = true;
    saveJSON(TODO_FILE, all);
    return true;
  }
  return false;
}

function clearTodos(userId) {
  const all = loadJSON(TODO_FILE, {});
  all[String(userId)] = all[String(userId)]?.filter(t => !t.done) || [];
  saveJSON(TODO_FILE, all);
}

// ─── Config (per-user settings) ──────────────────────────────────────────────

const DEFAULT_MODEL = process.env.MODEL_SMALL || 'qwen2.5:3b-instruct-q4_K_M';

function getConfig(userId) {
  const all = loadJSON(CONFIG_FILE, {});
  return all[String(userId)] || {
    model:             DEFAULT_MODEL,
    persona:           'default',
    manualModel:       false,
    customInstruction: null,
    chatId:            null,
  };
}

function setConfig(userId, updates) {
  const all = loadJSON(CONFIG_FILE, {});
  const uid = String(userId);
  all[uid]  = { ...getConfig(userId), ...updates };
  saveJSON(CONFIG_FILE, all);
}

// ─── Schedules ───────────────────────────────────────────────────────────────

function getSchedules(userId) {
  const all = loadJSON(SCHEDULE_FILE, {});
  return all[String(userId)] || [];
}

/**
 * Add a new schedule. Returns the saved schedule object (with generated id).
 * @param {number} userId
 * @param {number} chatId  — Telegram chat ID to send results to
 * @param {string} query   — search query to run
 * @param {string} time    — "HH:MM" in 24h format
 * @returns {object} schedule
 */
function addSchedule(userId, chatId, query, time) {
  const all = loadJSON(SCHEDULE_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  const schedule = {
    id:     crypto.randomUUID(),
    userId: Number(userId),
    chatId,
    query,
    time,
    ts:     new Date().toISOString(),
  };
  all[uid].push(schedule);
  saveJSON(SCHEDULE_FILE, all);
  return schedule;
}

/**
 * Remove schedule by index (0-based). Returns removed schedule or null.
 */
function removeSchedule(userId, index) {
  const all = loadJSON(SCHEDULE_FILE, {});
  const uid = String(userId);
  if (!all[uid] || index < 0 || index >= all[uid].length) return null;
  const [removed] = all[uid].splice(index, 1);
  saveJSON(SCHEDULE_FILE, all);
  return removed;
}

/**
 * Returns all schedules across all users — used on bot startup to restore cron tasks.
 */
function getAllSchedules() {
  const all = loadJSON(SCHEDULE_FILE, {});
  return Object.values(all).flat();
}

module.exports = {
  // history
  getHistory, saveHistory, appendMessage, clearHistory,
  // memory
  getMemory, addMemory, forgetAll,
  // notes
  getNotes, addNote, deleteNote,
  // todos
  getTodos, addTodo, doneTodo, clearTodos,
  // config
  getConfig, setConfig,
  // schedules
  getSchedules, addSchedule, removeSchedule, getAllSchedules,
};
