/**
 * commands.js — Telegram command handlers
 *
 * Handles all /commands and routes plain messages through the agent pipeline.
 */
'use strict';

const db        = require('../db/database');
const ollama    = require('../llm/ollama');
const router    = require('../agent/router');
const search    = require('../tools/search');
const coder     = require('../tools/coder');
const scheduler = require('../scheduler/scheduler');

const ALLOWED_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number);

/**
 * Returns true if the user is authorized to use the bot.
 */
function isAllowed(userId) {
  if (!ALLOWED_IDS.length) return true;  // open if no list set
  return ALLOWED_IDS.includes(userId);
}

/**
 * Send a long-ish message, splitting if necessary (Telegram 4096-char limit).
 */
async function sendLong(bot, chatId, text, opts = {}) {
  const MAX = 4000;
  if (text.length <= MAX) {
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  }
  for (let i = 0; i < text.length; i += MAX) {
    await bot.sendMessage(chatId, text.slice(i, i + MAX), { parse_mode: 'Markdown' });
  }
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleStart(bot, msg) {
  const name = msg.from?.first_name || 'User';
  await sendLong(bot, msg.chat.id,
    `👋 Hi ${name}! I'm your local AI assistant running on Ollama.\n\n` +
    `Type anything to chat. Available commands:\n\n` +
    `*Core*\n` +
    `/help — show this message\n` +
    `/status — system status\n` +
    `/clear — clear conversation context\n\n` +
    `*Models & Persona*\n` +
    `/model [name|auto] — switch model or re-enable auto-routing\n` +
    `/models — list available models\n` +
    `/persona [name] — change personality (default/coder/polish/researcher/planner)\n` +
    `/instruct [text] — set a custom system instruction\n` +
    `/instruct show — show current instruction\n` +
    `/instruct clear — revert to persona\n\n` +
    `*Memory*\n` +
    `/memory — show remembered facts\n` +
    `/remember [fact] — save a fact\n` +
    `/forget — clear all memory\n\n` +
    `*Notes*\n` +
    `/notes — show notes\n` +
    `/note [text] — add a note\n` +
    `/delnote [n] — delete note #n\n\n` +
    `*Todos*\n` +
    `/todo — show todo list\n` +
    `/task [text] — add a to-do item\n` +
    `/done [n] — mark todo #n done\n\n` +
    `*Search & Automation*\n` +
    `/search [query] — search the web now\n` +
    `/schedules — list scheduled searches\n` +
    `/schedule add HH:MM [query] — add daily search alert\n` +
    `/schedule test [n] — run schedule #n right now\n` +
    `/schedule del [n] — remove schedule #n\n\n` +
    `*Dev*\n` +
    `/run [code] — execute JS code`
  );
}

async function handleHelp(bot, msg) {
  return handleStart(bot, msg);
}

async function handleStatus(bot, msg) {
  const userId = msg.from.id;
  const alive  = await ollama.isOllamaRunning();
  const cfg    = db.getConfig(userId);
  const models = alive ? await ollama.listModels() : [];
  const schedules = db.getSchedules(userId);
  const searchMode = process.env.SERPER_API_KEY ? '✅ Serper (Google)' : '⚠️ DuckDuckGo scrape';

  await sendLong(bot, msg.chat.id,
    `🖥 *System Status*\n\n` +
    `Ollama: ${alive ? '✅ running' : '❌ offline'}\n` +
    `Active model: \`${cfg.model}\` ${cfg.manualModel ? '_(manual)_' : '_(auto-routed)_'}\n` +
    `Persona: ${cfg.persona}${cfg.customInstruction ? ' _(overridden by /instruct)_' : ''}\n` +
    `Web search: ${searchMode}\n` +
    `Schedules: ${schedules.length} active\n` +
    `Available models: ${models.length ? models.join(', ') : 'none detected'}\n` +
    `Router tiers:\n` +
    `  💬 small=\`${router.MODEL_SMALL}\`\n` +
    `  ⚡ medium=\`${router.MODEL_MEDIUM}\`\n` +
    `  🧠 large=\`${router.MODEL_LARGE}\``
  );
}

async function handleClear(bot, msg) {
  db.clearHistory(msg.from.id);
  await bot.sendMessage(msg.chat.id, '🗑 Conversation context cleared.');
}

// ─── Model & Persona ─────────────────────────────────────────────────────────

async function handleModel(bot, msg, args) {
  const userId = msg.from.id;
  if (!args.length) {
    const cfg = db.getConfig(userId);
    return bot.sendMessage(msg.chat.id,
      `Current model: \`${cfg.model}\` ${cfg.manualModel ? '_(manual override)_' : '_(auto-routed)_'}\n` +
      `Use \`/model auto\` to re-enable auto-routing.`
    );
  }
  const modelName = args.join(' ');
  if (modelName === 'auto') {
    db.setConfig(userId, { model: router.MODEL_SMALL, manualModel: false });
    return bot.sendMessage(msg.chat.id, '✅ Auto-routing re-enabled.');
  }
  db.setConfig(userId, { model: modelName, manualModel: true });
  await bot.sendMessage(msg.chat.id,
    `✅ Model switched to \`${modelName}\`. Auto-routing disabled.\nUse \`/model auto\` to re-enable.`
  );
}

async function handleModels(bot, msg) {
  const alive = await ollama.isOllamaRunning();
  if (!alive) return bot.sendMessage(msg.chat.id, '❌ Ollama is not running.');
  const models = await ollama.listModels();
  await sendLong(bot, msg.chat.id,
    models.length
      ? `🤖 *Available models:*\n${models.map(m => `• \`${m}\``).join('\n')}`
      : 'No models found. Run `ollama pull qwen3:8b` in your terminal.'
  );
}

async function handlePersona(bot, msg, args) {
  const userId  = msg.from.id;
  const persona = args[0] || 'default';
  db.setConfig(userId, { persona });
  await bot.sendMessage(msg.chat.id, `🎭 Persona set to: *${persona}*`);
}

// ─── Custom Instructions ─────────────────────────────────────────────────────

async function handleInstruct(bot, msg, args) {
  const userId = msg.from.id;

  if (!args.length || args[0] === 'show') {
    const cfg = db.getConfig(userId);
    if (!cfg.customInstruction)
      return bot.sendMessage(msg.chat.id,
        'No custom instruction set.\nUsage: `/instruct [your system prompt text]`'
      );
    return sendLong(bot, msg.chat.id, `📋 *Current custom instruction:*\n\n${cfg.customInstruction}`);
  }

  if (args[0] === 'clear') {
    db.setConfig(userId, { customInstruction: null });
    return bot.sendMessage(msg.chat.id, '✅ Custom instruction cleared. Back to persona.');
  }

  const instruction = args.join(' ');
  db.setConfig(userId, { customInstruction: instruction });
  await bot.sendMessage(msg.chat.id,
    `✅ Custom instruction saved! This replaces your persona for all future messages.\n` +
    `Use \`/instruct clear\` to revert.`
  );
}

// ─── Memory ──────────────────────────────────────────────────────────────────

async function handleMemory(bot, msg) {
  const facts = db.getMemory(msg.from.id);
  if (!facts.length)
    return bot.sendMessage(msg.chat.id, 'No memories stored yet. Use /remember [fact].');
  const list = facts.map((f, i) => `${i + 1}. ${f.fact} _(${f.ts.slice(0, 10)})_`).join('\n');
  await sendLong(bot, msg.chat.id, `🧠 *Remembered facts:*\n\n${list}`);
}

async function handleRemember(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /remember [fact about you]');
  db.addMemory(msg.from.id, args.join(' '));
  await bot.sendMessage(msg.chat.id, '✅ Noted!');
}

async function handleForget(bot, msg) {
  db.forgetAll(msg.from.id);
  await bot.sendMessage(msg.chat.id, '🗑 All memories cleared.');
}

// ─── Notes ──────────────────────────────────────────────────────────────────

async function handleNotes(bot, msg) {
  const notes = db.getNotes(msg.from.id);
  if (!notes.length)
    return bot.sendMessage(msg.chat.id, 'No notes yet. Use /note [text].');
  const list = notes.map((n, i) => `${i + 1}. ${n.note} _(${n.ts.slice(0, 10)})_`).join('\n');
  await sendLong(bot, msg.chat.id, `📝 *Your notes:*\n\n${list}`);
}

async function handleNote(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /note [note text]');
  db.addNote(msg.from.id, args.join(' '));
  await bot.sendMessage(msg.chat.id, '✅ Note saved!');
}

async function handleDelNote(bot, msg, args) {
  const n = parseInt(args[0], 10);
  if (isNaN(n) || n < 1)
    return bot.sendMessage(msg.chat.id, 'Usage: /delnote [note number]');
  const deleted = db.deleteNote(msg.from.id, n - 1);
  if (!deleted)
    return bot.sendMessage(msg.chat.id, `❌ No note #${n}. Use /notes to see your list.`);
  await bot.sendMessage(msg.chat.id, `🗑 Note #${n} deleted.`);
}

// ─── Todos ───────────────────────────────────────────────────────────────────

async function handleTodos(bot, msg) {
  const todos = db.getTodos(msg.from.id);
  if (!todos.length)
    return bot.sendMessage(msg.chat.id, 'No tasks yet. Use /task [text].');
  const list = todos
    .map((t, i) => `${t.done ? '✅' : '⬜'} ${i + 1}. ${t.task}`)
    .join('\n');
  await sendLong(bot, msg.chat.id, `📋 *Todo list:*\n\n${list}`);
}

async function handleTask(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /task [task description]');
  db.addTodo(msg.from.id, args.join(' '));
  await bot.sendMessage(msg.chat.id, '✅ Task added!');
}

async function handleDone(bot, msg, args) {
  const n = parseInt(args[0], 10);
  if (isNaN(n) || n < 1)
    return bot.sendMessage(msg.chat.id, 'Usage: /done [task number]');
  const marked = db.doneTodo(msg.from.id, n - 1);
  if (!marked)
    return bot.sendMessage(msg.chat.id, `❌ No task #${n}. Use /todo to see your list.`);
  await bot.sendMessage(msg.chat.id, `✅ Task #${n} marked as done.`);
}

// ─── Schedules ───────────────────────────────────────────────────────────────

async function handleSchedule(bot, msg, args) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const sub    = args[0];

  // /schedule (no args) or /schedules → list
  if (!sub || sub === 'list') {
    return handleScheduleList(bot, msg);
  }

  // /schedule add HH:MM search query text
  if (sub === 'add') {
    const timeArg = args[1];
    const query   = args.slice(2).join(' ');

    if (!timeArg || !query)
      return bot.sendMessage(chatId,
        'Usage: `/schedule add HH:MM [search query]`\n' +
        'Example: `/schedule add 08:00 job offers Warsaw Node.js developer`',
        { parse_mode: 'Markdown' }
      );

    if (!/^\d{1,2}:\d{2}$/.test(timeArg))
      return bot.sendMessage(chatId, '❌ Invalid time format. Use HH:MM e.g. `08:00`');

    const schedule = db.addSchedule(userId, chatId, query, timeArg);
    scheduler.add(schedule);

    const tz = process.env.TZ || 'Europe/Warsaw';
    await bot.sendMessage(chatId,
      `✅ Schedule added!\n` +
      `🕐 *${timeArg}* daily (${tz})\n` +
      `🔍 Query: _${query}_\n\n` +
      `Results will be sent here. Use \`/schedule test [n]\` to try it now.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /schedule test N → run schedule immediately
  if (sub === 'test') {
    const n = parseInt(args[1], 10);
    if (isNaN(n) || n < 1)
      return bot.sendMessage(chatId, 'Usage: /schedule test [number]');
    const schedules = db.getSchedules(userId);
    if (n > schedules.length)
      return bot.sendMessage(chatId, `❌ No schedule #${n}. Use /schedules to see your list.`);
    await bot.sendMessage(chatId, `⏳ Running schedule #${n} now...`);
    try {
      await scheduler.runNow(schedules[n - 1]);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
    return;
  }

  // /schedule del N
  if (sub === 'del' || sub === 'delete' || sub === 'remove') {
    const n = parseInt(args[1], 10);
    if (isNaN(n) || n < 1)
      return bot.sendMessage(chatId, 'Usage: /schedule del [number]');
    const removed = db.removeSchedule(userId, n - 1);
    if (!removed)
      return bot.sendMessage(chatId, `❌ No schedule #${n}. Use /schedules to see your list.`);
    scheduler.remove(removed.id);
    await bot.sendMessage(chatId, `🗑 Schedule #${n} removed.`);
    return;
  }

  return handleScheduleList(bot, msg);
}

async function handleScheduleList(bot, msg) {
  const schedules = db.getSchedules(msg.from.id);
  if (!schedules.length)
    return bot.sendMessage(msg.chat.id,
      'No schedules yet.\nUse `/schedule add HH:MM [query]` to create one.',
      { parse_mode: 'Markdown' }
    );
  const tz   = process.env.TZ || 'Europe/Warsaw';
  const list = schedules
    .map((s, i) => `${i + 1}. 🕐 *${s.time}* daily — _${s.query}_`)
    .join('\n');
  await sendLong(bot, msg.chat.id,
    `📅 *Scheduled searches* (${tz}):\n\n${list}\n\n` +
    `Use \`/schedule test [n]\` to run one now, \`/schedule del [n]\` to remove.`
  );
}

// ─── Web Search ──────────────────────────────────────────────────────────────

async function handleSearch(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /search [query]');
  const query = args.join(' ');
  await bot.sendMessage(msg.chat.id, `🔍 Searching: _${query}_...`);
  const results = await search.webSearch(query);
  await sendLong(bot, msg.chat.id, results);
}

// ─── Code Execution ──────────────────────────────────────────────────────────

async function handleRun(bot, msg, args) {
  if (!ALLOWED_IDS.length) {
    return bot.sendMessage(msg.chat.id,
      '⚠️ `/run` is disabled: set `ALLOWED_USER_IDS` in `.env` first.\n' +
      'This command executes code with full system privileges.',
      { parse_mode: 'Markdown' }
    );
  }
  const code = args.join(' ');
  if (!code) return bot.sendMessage(msg.chat.id, 'Usage: /run [js code]');
  await bot.sendMessage(msg.chat.id, '⚙️ Running...');
  const result = await coder.runCode(code);
  await sendLong(bot, msg.chat.id, coder.formatResult(result));
}

// ─── Plain Message → Agent ───────────────────────────────────────────────────

async function handleMessage(bot, msg) {
  const userId  = msg.from.id;
  const chatId  = msg.chat.id;
  const text    = msg.text?.trim();
  if (!text) return;

  // Store chatId so scheduler can push messages even without a prior message
  const cfg = db.getConfig(userId);
  if (cfg.chatId !== chatId) db.setConfig(userId, { chatId });

  await bot.sendChatAction(chatId, 'typing');

  const manualModel = cfg.manualModel ? cfg.model : null;

  // Decide: web search needed?
  const needsSearch = /\b(search|wyszukaj|google|find|znajdź).+\b/i.test(text) ||
                      (/\bco to jest\b/i.test(text) && text.length > 40);

  let enriched = text;
  if (needsSearch) {
    await bot.sendMessage(chatId, '🔍 Searching the web first...');
    const results = await search.webSearch(text);
    enriched = `User asked: ${text}\n\nContext from web search:\n${results}`;
  }

  const model = manualModel || router.routeModel(text, null);
  const label = router.modelLabel(model);

  let typingInterval;
  let loadingMsg = null;
  try {
    if (model !== router.MODEL_SMALL) {
      loadingMsg = await bot.sendMessage(chatId, `⏳ *${label} — ${model}...*`);
    }

    typingInterval = setInterval(() => bot.sendChatAction(chatId, 'typing'), 5000);

    const reply = await ollama.chat({
      userId,
      userMessage:       enriched,
      model,
      persona:           cfg.persona,
      customInstruction: cfg.customInstruction || null,
    });

    clearInterval(typingInterval);
    if (loadingMsg) {
      await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    }

    const prefixed = model !== router.MODEL_SMALL ? `${label}\n\n${reply}` : reply;
    await sendLong(bot, chatId, prefixed);
  } catch (err) {
    clearInterval(typingInterval);

    let errMsg = `❌ Error: ${err.message}`;
    if (err.code === 'ECONNREFUSED')
      errMsg = '❌ Cannot reach Ollama. Make sure it is running: `ollama serve`';
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))
      errMsg = `⏱️ *Timeout!* Model \`${model}\` did not respond within 180s.\nTry a lighter model with \`/model auto\`.`;

    await bot.sendMessage(chatId, errMsg, { parse_mode: 'Markdown' });
  }
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

function register(bot) {
  function guard(handler) {
    return async (msg, match) => {
      if (!msg || !msg.chat || !msg.chat.id || !msg.from) return;
      if (!isAllowed(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, '🚫 Unauthorized.');
      }
      return handler(msg, match);
    };
  }

  bot.onText(/^\/start/, guard(m => handleStart(bot, m)));
  bot.onText(/^\/help/,  guard(m => handleHelp(bot, m)));
  bot.onText(/^\/status/,guard(m => handleStatus(bot, m)));
  bot.onText(/^\/clear/, guard(m => handleClear(bot, m)));

  bot.onText(/^\/model(?:\s+(.+))?$/, guard((m, match) =>
    handleModel(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/models/, guard(m => handleModels(bot, m)));
  bot.onText(/^\/persona(?:\s+(.+))?$/, guard((m, match) =>
    handlePersona(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/instruct(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleInstruct(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/memory/, guard(m => handleMemory(bot, m)));
  bot.onText(/^\/remember(?:\s+(.+))?$/, guard((m, match) =>
    handleRemember(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/forget/, guard(m => handleForget(bot, m)));

  bot.onText(/^\/notes?/, guard(m => handleNotes(bot, m)));
  bot.onText(/^\/note(?:\s+(.+))?$/, guard((m, match) =>
    handleNote(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/delnote(?:\s+(\d+))?$/, guard((m, match) =>
    handleDelNote(bot, m, match[1] ? [match[1]] : [])));

  bot.onText(/^\/todos?/, guard(m => handleTodos(bot, m)));
  bot.onText(/^\/task(?:\s+(.+))?$/, guard((m, match) =>
    handleTask(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/done(?:\s+(\d+))?$/, guard((m, match) =>
    handleDone(bot, m, match[1] ? [match[1]] : [])));

  // /schedule and /schedules both route to the same handler
  bot.onText(/^\/schedules?(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleSchedule(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/search(?:\s+(.+))?$/, guard((m, match) =>
    handleSearch(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/run(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleRun(bot, m, match[1] ? [match[1].trim()] : [])));

  bot.on('message', guard(m => {
    if (!m.text || m.text.startsWith('/')) return;
    return handleMessage(bot, m);
  }));
}

module.exports = { register };
