/**
 * ollama.js — Ollama REST API client
 * Handles: streaming requests, context trimming, summarisation
 */
'use strict';

const axios = require('axios');
const db    = require('../db/database');

const BASE_URL          = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const TOKEN_LIMIT       = parseInt(process.env.CONTEXT_TOKEN_LIMIT || '1000', 10);
// rough approximation: 1 token ≈ 4 chars (1000 tokens is perfect for very fast mobile chat context)
const CHAR_LIMIT        = TOKEN_LIMIT * 4;

// ─── Personas ────────────────────────────────────────────────────────────────
const PERSONAS = require('../../config/personas.json');

function getSystemPrompt(persona = 'default') {
  return PERSONAS[persona] || PERSONAS.default;
}

// ─── Token / Length guard ────────────────────────────────────────────────────

function totalChars(messages) {
  return messages.reduce((s, m) => s + (m.content?.length || 0), 0);
}

/**
 * Summarise old messages using the small model and collapse them
 * to a single assistant checkpoint message.
 */
async function summariseHistory(userId, model) {
  const history = db.getHistory(userId);
  if (totalChars(history) < CHAR_LIMIT) return history;

  // keep last 4 messages always fresh, summarise the older chunk
  const old   = history.slice(0, -4);
  const fresh = history.slice(-4);

  const summaryPrompt = [
    {
      role: 'user',
      content:
        'Please summarise these previous chat messages briefly in 1-2 paragraphs (keep facts and context):\n\n' +
        old.map(m => `${m.role}: ${m.content}`).join('\n'),
    },
  ];

  try {
    const res = await axios.post(`${BASE_URL}/api/chat`, {
      model,
      messages: summaryPrompt,
      stream:   false,
    });
    const summary = res.data.message.content;
    const newHistory = [
      { role: 'assistant', content: `[Conversation summary]: ${summary}` },
      ...fresh,
    ];
    db.saveHistory(userId, newHistory);
    return newHistory;
  } catch {
    // summarisation failed — just trim oldest messages
    const trimmed = history.slice(-4);
    db.saveHistory(userId, trimmed);
    return trimmed;
  }
};

// ─── Main chat call ──────────────────────────────────────────────────────────

/**
 * Send a message to Ollama and return the assistant reply text.
 */
async function chat({ userId, userMessage, model, persona = 'default' }) {
  // 1. append user message
  db.appendMessage(userId, 'user', userMessage);

  // 2. get (possibly summarised) history
  let history = await summariseHistory(userId, process.env.MODEL_SMALL || model);

  // 3. inject persistent memory as context
  const memFacts = db.getMemory(userId);
  const memBlock = memFacts.length
    ? `\n\nKnown facts about the user:\n${memFacts.map(f => `- ${f.fact}`).join('\n')}`
    : '';

  // 4. build messages array
  const systemContent = getSystemPrompt(persona) + memBlock;
  const messages = [
    { role: 'system', content: systemContent },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  // 5. call Ollama — 120s timeout (large models can be slow on mobile)
  console.log(`[ollama] calling model=${model}, messages=${messages.length}`);
  let res;
  try {
    res = await axios.post(`${BASE_URL}/api/chat`, {
      model,
      messages,
      stream: false,
    }, { timeout: 120_000 });
  } catch (err) {
    console.error('[ollama] axios error:', err.code || err.message);
    throw err;
  }

  if (!res.data?.message?.content) {
    console.error('[ollama] unexpected response:', JSON.stringify(res.data).slice(0, 200));
    throw new Error('Empty response from Ollama');
  }

  const reply = res.data.message.content;

  // 6. persist assistant response
  db.appendMessage(userId, 'assistant', reply);

  return reply;
}

/**
 * List available models from local Ollama.
 */
async function listModels() {
  const res = await axios.get(`${BASE_URL}/api/tags`);
  return (res.data.models || []).map(m => m.name);
}

/**
 * Health check — returns true if Ollama is reachable.
 */
async function isOllamaRunning() {
  try {
    await axios.get(`${BASE_URL}/api/tags`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { chat, listModels, isOllamaRunning, getSystemPrompt };
