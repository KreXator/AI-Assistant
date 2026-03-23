/**
 * nlRouter.js — Unified natural-language message router
 *
 * Replaces the fragmented intentHandler + needsSearch + NL routing regex approach.
 * Every plain-text message gets classified in one fast LLM call into:
 *
 *   bot_command  — bot configuration/management (schedules, reminders, notes, etc.)
 *   web_search   — needs live/current data (weather, news, prices, sports)
 *   chat         — everything else (conversation, coding, questions from training data)
 *
 * Falls back to { type: 'chat' } on any error or timeout — never breaks the bot.
 */
'use strict';

const openrouter = require('../llm/openrouter');
const ollama     = require('../llm/ollama');

const ROUTE_TIMEOUT_MS = 8_000;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a router for a personal Telegram AI assistant bot.
The user speaks Polish or English.
Classify the user's message into exactly one route.

Routes:
- "bot_command" — user wants to manage the bot: add/list schedules, reminders, notes, todos, memory facts, RSS feeds, briefings
- "web_search"  — user needs live/current data: weather, today's news, stock prices, crypto rates, sports results, anything that changes over time
- "chat"        — everything else: questions answered from training data, conversation, coding help, creative tasks, explanations, "how does X work?"

Return ONLY valid JSON. No prose, no markdown, no code block.

JSON schema:
{"type": "bot_command|web_search|chat", "intent": "<intent or null>", "lang": "pl|en", "params": {}}

lang: "pl" if the user wrote in Polish, "en" if in English.

For "web_search" and "chat": intent must be null, params must be {}.
For "bot_command": include the specific intent and extracted parameters.

Supported bot_command intents and params:
- list_todos            {}
- list_notes            {}
- list_reminders        {}
- list_memory           {}
- list_schedules        {}
- list_feeds            {}
- briefing_add_feed     {"url": "https://...", "label": "name", "category": "jobs|news|tech|general"}
- briefing_on           {}
- briefing_off          {}
- briefing_time_morning {"time": "HH:MM", "enable": true|false}
- briefing_time_evening {"time": "HH:MM", "enable": true|false}
- briefing_keywords_add {"keyword": "phrase in lowercase"}
- briefing_keywords_remove {"keyword": "phrase in lowercase"}
- briefing_run_now      {"type": "morning|evening"}
- schedule_add          {"time": "HH:MM", "query": "search query string"}
- remind                {"when": "30min|2h|45s|HH:MM", "text": "reminder message"}
- remember              {"fact": "fact about the user in third person, Polish"}
- summarize_url         {"url": "https://..."}
- daily_digest          {}

Time normalization rules:
- "za 30 minut" → "30min"
- "za 2 godziny" → "2h"
- "za pół godziny" → "30min"
- "o 7:30" → "07:30"
- Always zero-pad hours: "7:30" → "07:30"

CRITICAL — use "bot_command" / summarize_url for:
- Any message containing a URL (http/https) with words like "podsumuj", "streszcz", "co to jest", "przeczytaj", "sum", "summarize", "tldr" — or a bare URL with no other instruction
- Example: "podsumuj https://example.com" → {"type":"bot_command","intent":"summarize_url","lang":"pl","params":{"url":"https://example.com"}}
- Example: "https://example.com" → {"type":"bot_command","intent":"summarize_url","lang":"pl","params":{"url":"https://example.com"}}

CRITICAL — use "bot_command" / daily_digest for:
- "co mam dziś", "plan na dziś", "mój dzień", "standup", "co dziś", "/dzisiaj"
- Example: "co mam dziś do zrobienia?" → {"type":"bot_command","intent":"daily_digest","lang":"pl","params":{}}

CRITICAL — use "chat" (not "bot_command") for:
- Questions about how things work: "jak działa RSS?", "co to jest briefing?"
- Code-related tasks: "dodaj mi komentarz", "napisz funkcję"
- General conversation, greetings, opinions
- Planning real-world activities: "zaplanuj trasę", "zaplanuj wyjazd", "zaplanuj dzień", "zaplanuj projekt", "stwórz plan" — these are NOT schedule_add!
- schedule_add is ONLY for "zaplanuj automatyczne wyszukiwanie o HH:MM [query]"

CRITICAL — use "web_search" for:
- Weather: "pogoda", "jaka pogoda", "sprawdź pogodę"
- Today/current/live: "dzisiaj", "teraz", "aktualnie", "today", "right now", "latest"
- News: "wiadomości", "aktualności", "news", "headlines"
- Prices/rates: "kurs", "cena", "bitcoin", "btc", "eth", "crypto", "notowania"
- Sports: "kto wygrał", "wyniki meczu", "tabela ligowa", "who won"
- Any factual query needing up-to-date data

Examples:
"Pokaż moje zadania" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"pokaż zadania" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"moje zadania" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"lista zadań" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"moje notatki" → {"type":"bot_command","intent":"list_notes","lang":"pl","params":{}}
"lista przypomnień" → {"type":"bot_command","intent":"list_reminders","lang":"pl","params":{}}
"zaplanowane wyszukiwania" → {"type":"bot_command","intent":"list_schedules","lang":"pl","params":{}}
"pokaż feedy RSS" → {"type":"bot_command","intent":"list_feeds","lang":"pl","params":{}}
"moja pamięć" → {"type":"bot_command","intent":"list_memory","lang":"pl","params":{}}
"show my todos" → {"type":"bot_command","intent":"list_todos","lang":"en","params":{}}
"dodaj feed https://justjoin.it/rss.xml jako justjoinit z kategorią jobs" → {"type":"bot_command","intent":"briefing_add_feed","lang":"pl","params":{"url":"https://justjoin.it/rss.xml","label":"justjoinit","category":"jobs"}}
"włącz poranne raporty" → {"type":"bot_command","intent":"briefing_on","lang":"pl","params":{}}
"wyłącz raporty" → {"type":"bot_command","intent":"briefing_off","lang":"pl","params":{}}
"ustaw poranny raport na 7:30" → {"type":"bot_command","intent":"briefing_time_morning","lang":"pl","params":{"time":"07:30","enable":false}}
"włącz poranny raport o 7:30" → {"type":"bot_command","intent":"briefing_time_morning","lang":"pl","params":{"time":"07:30","enable":true}}
"odpal briefing" → {"type":"bot_command","intent":"briefing_run_now","lang":"pl","params":{"type":"morning"}}
"odpal wieczorny briefing" → {"type":"bot_command","intent":"briefing_run_now","lang":"pl","params":{"type":"evening"}}
"zaplanuj wyszukiwanie o 9:00 oferty pracy Node.js" → {"type":"bot_command","intent":"schedule_add","lang":"pl","params":{"time":"09:00","query":"oferty pracy Node.js"}}
"zaplanuj trasę rowerową 10 km" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"zaplanuj mi dzień" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"zaplanuj wyjazd do Krakowa" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"przypomnij mi za 30 minut o spotkaniu" → {"type":"bot_command","intent":"remind","lang":"pl","params":{"when":"30min","text":"spotkanie"}}
"remind me in 2 hours to send the report" → {"type":"bot_command","intent":"remind","lang":"en","params":{"when":"2h","text":"send the report"}}
"zapamiętaj że szukam pracy zdalnej" → {"type":"bot_command","intent":"remember","lang":"pl","params":{"fact":"Szuka pracy zdalnej"}}
"remember I prefer concise answers" → {"type":"bot_command","intent":"remember","lang":"en","params":{"fact":"Prefers concise answers"}}
"podsumuj https://example.com/article" → {"type":"bot_command","intent":"summarize_url","lang":"pl","params":{"url":"https://example.com/article"}}
"https://news.ycombinator.com" → {"type":"bot_command","intent":"summarize_url","lang":"pl","params":{"url":"https://news.ycombinator.com"}}
"co mam dziś do zrobienia?" → {"type":"bot_command","intent":"daily_digest","lang":"pl","params":{}}
"plan na dziś" → {"type":"bot_command","intent":"daily_digest","lang":"pl","params":{}}
"sprawdź pogodę w Warszawie" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"jaka jest pogoda dzisiaj?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"kurs bitcoina" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"jakie są dzisiejsze wiadomości?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"kto wygrał mecz dziś?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"aktualny kurs EUR/PLN" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"podaj przegląd wiadomości" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"podaj wiadomości lokalne" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"co słychać w Polsce?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"najnowsze informacje" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"jaka jest teraz pogoda?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"Jakie masz możliwości?" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"napisz mi funkcję w Python" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"jak działa RSS?" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"co to jest briefing?" → {"type":"chat","intent":null,"lang":"pl","params":{}}`;

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(text) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: text },
  ];
  try {
    return await openrouter.complete(openrouter.OR_MODEL_SMALL, messages, 150);
  } catch {
    try {
      return await ollama.completeRaw(process.env.MODEL_SMALL || 'qwen2.5:3b-instruct-q4_K_M', messages);
    } catch (err2) {
      console.warn('[nlRouter] both LLM providers failed, defaulting to chat:', err2.message);
      return null;
    }
  }
}

// ─── Parse LLM response ───────────────────────────────────────────────────────

const KNOWN_INTENTS = new Set([
  'list_todos', 'list_notes', 'list_reminders', 'list_memory', 'list_schedules', 'list_feeds',
  'briefing_add_feed', 'briefing_on', 'briefing_off',
  'briefing_time_morning', 'briefing_time_evening',
  'briefing_keywords_add', 'briefing_keywords_remove',
  'briefing_run_now', 'schedule_add', 'remind', 'remember',
  'summarize_url', 'daily_digest',
]);

function parse(raw) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);

    const type = obj.type;
    if (type !== 'bot_command' && type !== 'web_search' && type !== 'chat') return null;

    if (type === 'bot_command') {
      if (!obj.intent || !KNOWN_INTENTS.has(obj.intent)) return null;
      return {
        type,
        intent: obj.intent,
        lang: obj.lang === 'en' ? 'en' : 'pl',
        params: obj.params || {},
      };
    }

    // web_search or chat
    return { type, intent: null, lang: obj.lang === 'en' ? 'en' : 'pl', params: {} };
  } catch {
    return null;
  }
}

// ─── Fast pre-check (deterministic, no LLM) ──────────────────────────────────
// Handles unambiguous patterns that free models misclassify.
// Returns a route object on match, null to proceed to LLM.

// Bare or accompanied URL → summarize
const URL_PRECHECK_RE = /https?:\/\/[^\s<>"']+/i;
const SUMMARIZE_TRIGGER_RE = /\b(podsumuj|streszcz|streścij|summarize|tldr|przeczytaj|co tam|co pisze)\b/i;

// "co mam dziś", "plan na dziś", "standup"
const DAILY_DIGEST_RE = /\b(co\s+mam\s+dzi[śs]|plan\s+na\s+dzi[śs]|m[oó]j\s+dzie[nń]|standup|co\s+dzi[śs]\b)/i;

// Live/current-data queries → web_search
// Covers: news, weather, finance, sports, local events — anything time-sensitive.
// LLM models hallucinate these categories when they don't have real-time access.
// prettier-ignore
// Note: \b avoided after non-ASCII chars (ł, ą etc.) — use (?:\s|$) lookahead where needed
const LIVE_DATA_RE = /\b(wiadomo[śs]ci|aktualno[śs]ci|przeg[lł][aą]d\s+wiadomo[śs]ci|skr[oó]t\s+wiadomo[śs]ci|(?:lokalne?|regionalne?)\s+wiadomo[śs]ci|wiadomo[śs]ci\s+(?:lokalne?|z\s+\w+)|headlines?|news\b|co\s+si[ęe]\s+dzieje|co\s+nowego(?:\s|$)|(?:najnowsze?|ostatnie?|aktualne?|bież[aą]ce?)\s+(?:wiadomo[śs]ci|info|doniesienia|wydarzen)|pogoda\b|prognoza\s+(?:pogody|na\s+\w+)|ile\s+stopni|kurs\s+\w+|notowania\b|gie[lł]da\b|bitcoin\b|btc\b|\beth\b|kryptowalu[tc]|cena\s+(?:benzyny|gazu|pr[aą]du|ropy|diesla)|wyniki?\s+(?:meczu?|ligi|rozgrywek)|tabela\s+\w*\s*ligi|kto\s+wygra[lł]|co\s+(?:graj[aą]|leci)(?:\s|$)|wydarzenia\s+w\b|imprezy?\s+w\b)/i;

// Navigation queries → web_search with special redirect to mapping apps (no LLM)
// prettier-ignore
const NAV_SEARCH_RE = /\b(jak\s+(?:dojecha[ćc]|dojad[ęe]|dotrze[ćc]|doj[śs][ćc])|drog[ęa]\s+powrotn|trasa?\s+rowerow|trasa?\s+(?:piesz|samochodow)|(?:wymyśl|zaproponuj|poka[zż]|podaj|polecasz?|pole[ćc])\s+.{0,40}tras[ęea]?|jak[aą]\s+tras[ęea]|(?:lekk[aą]|ciekaw[aą]|fajna?|krótk[aą]|ładn[aą])\s+tras[ęea]|tras[ęea]\s+.{0,30}(?:polecasz?|zaproponuj|wymyśl|pole[ćc])|wycieczk[ięa]\s+rowerow)/i;

const LIST_PRECHECK = [
  { re: /\b(moje\s+)?notatki\b|\blista\s+notatek\b|\bpokaż\s+notatki\b/i,                intent: 'list_notes'     },
  { re: /\b(moje\s+)?zadania\b|\blista\s+zadań\b|\bpokaż\s+zadania\b|\btodos\b/i,        intent: 'list_todos'     },
  { re: /\b(moje\s+)?przypomnienia\b|\blista\s+przypomnień\b|\bpokaż\s+przypomnienia\b/i, intent: 'list_reminders' },
  { re: /\b(moja\s+)?pamięć\b|\bzapamiętane\b|\bpokaż\s+pamięć\b/i,                     intent: 'list_memory'    },
  { re: /\bzaplanowane\s+wyszukiwania\b|\bpokaż\s+(harmonogram|schedule)\b/i,             intent: 'list_schedules' },
  { re: /\b(moje\s+)?feedy\b|\blista\s+feedów\b|\bpokaż\s+(feedy|feed[sy]?\s+rss)\b/i,   intent: 'list_feeds'     },
];

// "zaplanuj X" where X is NOT a scheduled-search — force to chat
// .{0,40} allows phrases like "sobie jutro", "nam na weekend" between "zaplanuj" and the noun
const CHAT_OVERRIDE = /\bzaplanuj\b.{0,40}\b(trasę|wyjazd|dzień|projekt|menu|wakacje|podróż|weekend|wycieczkę|aktywność|czas|tydzień)\b/i;

// "zaplanuj [coś] o HH:MM" — deterministic schedule_add detection
// Matches: "zaplanuj wyszukiwanie o 9:00 ...", "zaplanuj codzienny przegląd o 8:30 ..."
const SCHEDULE_ADD_RE = /\bzaplanuj\b.{0,100}\bo\s+(\d{1,2}:\d{2})\b/i;

function precheck(text) {
  if (CHAT_OVERRIDE.test(text)) return { type: 'chat', intent: null, lang: 'pl', params: {} };

  // URL in message → summarize (bare URL or with trigger word)
  const urlMatch = URL_PRECHECK_RE.exec(text);
  if (urlMatch && (SUMMARIZE_TRIGGER_RE.test(text) || text.trim().match(/^https?:\/\//i))) {
    return { type: 'bot_command', intent: 'summarize_url', lang: 'pl', params: { url: urlMatch[0] } };
  }

  // Daily digest
  if (DAILY_DIGEST_RE.test(text)) {
    return { type: 'bot_command', intent: 'daily_digest', lang: 'pl', params: {} };
  }

  // Local events queries → redirect (LLM has no local event data, always hallucinates)
  if (/\b(wydarzen[iy]a?\s+(?:lokalne?|na\s+weekend|w\s+\w+)|co\s+(?:robi[ćc]|zwiedzi[ćc]|zobaczy[ćc])\s+(?:z\s+dzieckiem|z\s+córk|z\s+synem|w\s+\w+)|atrakcje?\s+(?:dla|w\s+\w+)|co\s+polecasz\s+(?:z\s+dzieckiem|z\s+córk|z\s+synem|w\s+\w+))\b/i.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: { subtype: 'local_events' } };
  }

  // Live/current-data queries → web_search (LLM hallucinates time-sensitive data)
  if (LIVE_DATA_RE.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: {} };
  }

  // Navigation queries → web_search with subtype flag (LLM hallucinates local streets)
  if (NAV_SEARCH_RE.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: { subtype: 'navigation' } };
  }

  // schedule_add: "zaplanuj ... o HH:MM" — extract time and use rest as query
  const schedMatch = SCHEDULE_ADD_RE.exec(text);
  if (schedMatch) {
    const time  = schedMatch[1].padStart(5, '0');  // "8:30" → "08:30"
    // Extract query: everything before "o HH:MM", drop "zaplanuj [mi]" prefix
    const query = text
      .replace(/\bzaplanuj\s+(?:mi\s+|sobie\s+)?/i, '')
      .replace(/\s+o\s+\d{1,2}:\d{2}\b.*$/i, '')
      .trim();
    return { type: 'bot_command', intent: 'schedule_add', lang: 'pl', params: { time, query } };
  }

  for (const { re, intent } of LIST_PRECHECK) {
    if (re.test(text)) return { type: 'bot_command', intent, lang: 'pl', params: {} };
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a plain-text message into a routing decision.
 * Always resolves — never throws.
 * @param {string} text
 * @returns {Promise<{type: 'bot_command'|'web_search'|'chat', intent: string|null, lang: string, params: object}>}
 */
async function route(text) {
  const fast = precheck(text);
  if (fast) return fast;

  try {
    const raw = await Promise.race([
      callLLM(text),
      new Promise((_, rej) => setTimeout(() => rej(new Error('router timeout')), ROUTE_TIMEOUT_MS)),
    ]);
    // If LLM router returns ambiguous/unparseable result → web_search is safer than chat
    // (unnecessary search is harmless; hallucinating facts is not)
    return parse(raw) || { type: 'web_search', intent: null, lang: 'pl', params: {} };
  } catch {
    return { type: 'web_search', intent: null, lang: 'pl', params: {} };
  }
}

module.exports = { route };
