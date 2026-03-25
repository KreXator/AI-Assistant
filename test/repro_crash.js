/**
 * test/repro_crash.js
 * Reproduce the reported crash on "Wyświetl listę zadań"
 */
'use strict';

// Mock env
process.env.TURSO_URL = 'libsql://dummy.turso.io';
process.env.TURSO_AUTH_TOKEN = 'dummy';
process.env.TELEGRAM_BOT_TOKEN = 'dummy';

process.env.NODE_ENV = 'test';

const db = require('../src/db/database');
const handlers = require('../src/handlers/commands');

// Mock bot
const bot = {
  sendMessage: async (chatId, text, opts) => {
    console.log(`[MockBot] Sending to ${chatId}:`, text);
    return { message_id: 123 };
  },
  sendChatAction: async (chatId, action) => {
    console.log(`[MockBot] Action ${action} on ${chatId}`);
  },
  on: () => {},
  onText: () => {},
};

// Mock Turso to throw the once-fatal error
const turso = require('../src/db/turso');
turso.execute = async () => {
  throw new TypeError('resp.body?.cancel is not a function');
};
turso.batch = async () => {
  throw new TypeError('resp.body?.cancel is not a function');
};

const msg = {
  from: { id: 123, language_code: 'pl' },
  chat: { id: 456 },
  text: 'Wyświetl listę zadań'
};

async function runRepro() {
  console.log('🚀 Running crash reproduction for: "Wyświetl listę zadań"');
  
  const nlRouter = require('../src/handlers/nlRouter');
  const pre = nlRouter.precheck(msg.text);
  console.log('--- Precheck Result ---');
  console.log(JSON.stringify(pre, null, 2));

  try {
    // 1. Test handleMessage (calls nlRouter -> executeIntent -> handleTodos)
    console.log('\n--- Test 1: handleMessage ---');
    await handlers.handleMessage(bot, msg);
    
    // 2. Test executeIntent directly
    console.log('\n--- Test 2: executeIntent ---');
    await handlers.executeIntent(bot, msg, { intent: 'list_todos', lang: 'pl', params: {} });

    console.log('\n✅ Repro completed without crash.');
    if (pre && pre.intent === 'list_todos') {
      console.log('✅ Intent "list_todos" correctly identified via precheck.');
    } else {
      console.error('❌ Intent identification failed!');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n💥 CRASH DETECTED:');
    console.error(err);
    process.exit(1);
  }
}

runRepro();
