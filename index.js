/**
 * index.js — Entry point for Windows AI Assistant
 * Boot sequence: load env → check Ollama → start Telegram bot → init scheduler
 */
'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const ollama      = require('./src/llm/ollama');
const commands    = require('./src/handlers/commands');
const scheduler   = require('./src/scheduler/scheduler');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

async function main() {
  console.log('🔄 Checking Ollama...');
  const alive = await ollama.isOllamaRunning();
  if (!alive) {
    console.warn('⚠️  Ollama is not responding at', process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    console.warn('   Start Ollama with: ollama serve');
    console.warn('   Continuing anyway — bot will report errors to Telegram.\n');
  } else {
    console.log('✅ Ollama is running.');
  }

  const bot = new TelegramBot(TOKEN, { polling: true });

  commands.register(bot);

  // Restore scheduled searches from database
  scheduler.init(bot);

  bot.on('polling_error', err => {
    console.error('[Polling error]', err.code, err.message);
  });

  bot.on('error', err => {
    console.error('[Bot error]', err.message);
  });

  const searchMode = process.env.SERPER_API_KEY ? 'Serper (Google)' : 'DuckDuckGo (fallback)';

  console.log('🤖 Windows AI Assistant is running. Send /start on Telegram.');
  console.log(`   Fast   model (💬): ${process.env.MODEL_SMALL  || 'qwen2.5:3b-instruct-q4_K_M'}`);
  console.log(`   Medium model (⚡): ${process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M'}`);
  console.log(`   High   model (🧠): ${process.env.MODEL_LARGE  || 'qwen3:8b'}`);
  console.log(`   Web search:        ${searchMode}`);
  console.log(`   Timezone:          ${process.env.TZ || 'Europe/Warsaw'}`);
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
