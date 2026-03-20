# AI Assistant

Personal AI assistant running locally via Ollama, accessible through Telegram.
Designed for Windows but works on any OS with Node.js and Ollama.

---

## Quick Start

```powershell
git clone https://github.com/KreXator/Termux-AI-Assistant.git ai-assistant
cd ai-assistant
.\start.ps1   # creates .env, installs deps, starts Ollama, launches bot
```

> You only need a token from [@BotFather](https://t.me/BotFather) on Telegram.

---

## Features

| Feature | Description |
|---|---|
| 💬 **Chat** | Context-aware conversation with pruned history window |
| 🧠 **Persistent memory** | Facts about you survive restarts (`/remember`, `/memory`) |
| 📝 **Notes** | `/note`, `/notes`, `/delnote` |
| ✅ **Todo list** | `/task`, `/todo`, `/done` |
| 🔍 **Web search** | Serper (Google) or DuckDuckGo fallback, auto-triggered or `/search` |
| 📅 **Scheduled searches** | Daily alerts at set times (`/schedule add HH:MM [query]`) |
| ⏰ **Reminders** | One-time reminders, persist across restarts (`/remind 30min ...`) |
| 🌤️ **Weather** | Current conditions via Open-Meteo, no API key needed (`/weather`) |
| 🎤 **Voice** | Send a voice message — transcribed via Groq Whisper, then answered |
| 📷 **Image analysis** | Send a photo — described by local vision model (llava) |
| ⚡ **Auto model routing** | Small model for simple tasks, large for code/reasoning |
| 🎭 **Personas** | `/persona coder`, `planner`, `researcher`, `polish`, `default` |
| 🔧 **Custom instructions** | Override persona via Telegram (`/instruct`) |
| 💻 **Code execution** | Run JS snippets directly (`/run`) |

---

## Configuration (`.env`)

Copy `.env.example` → `.env` and fill in:

| Variable | Description | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather | **required** |
| `ALLOWED_USER_IDS` | Comma-separated Telegram IDs (empty = open) | — |
| `OLLAMA_BASE_URL` | Ollama endpoint | `http://127.0.0.1:11434` |
| `MODEL_SMALL` | Fast model — simple tasks | `qwen2.5:3b-instruct-q4_K_M` |
| `MODEL_MEDIUM` | Mid model — general use | `qwen2.5:7b-instruct-q4_K_M` |
| `MODEL_LARGE` | Heavy model — coding, reasoning | `qwen3:8b` |
| `VISION_MODEL` | Vision model for image analysis | `llava:7b` |
| `HISTORY_WINDOW` | Conversation messages kept per user | `10` |
| `SERPER_API_KEY` | Google search (optional, free tier) | — |
| `GROQ_API_KEY` | Voice transcription (optional, free tier) | — |
| `TZ` | Timezone for scheduled tasks | `Europe/Warsaw` |

---

## Model Routing (automatic)

| Task type | Model used |
|---|---|
| Chat, notes, todos, memory, weather | 💬 `MODEL_SMALL` |
| Research, scheduling, medium tasks | ⚡ `MODEL_MEDIUM` |
| Code, debugging, complex reasoning | 🧠 `MODEL_LARGE` |
| Manual override `/model name` | User-specified |

---

## Commands

**Core**
```
/start · /help · /status · /clear
```

**Models & Persona**
```
/model [name|auto]    — switch model or re-enable auto-routing
/models               — list available Ollama models
/persona [name]       — change personality
/instruct [text]      — set custom system instruction
/instruct show|clear  — view or remove it
```

**Memory**
```
/remember [fact]  — save a fact about yourself
/memory           — show remembered facts
/forget           — clear all memory
```

**Notes & Todos**
```
/note [text]      — add a note
/notes            — list notes
/delnote [n]      — delete note #n
/task [text]      — add a todo
/todo             — list todos
/done [n]         — mark todo #n done
```

**Search & Automation**
```
/search [query]              — web search now
/schedule add HH:MM [query]  — daily search alert
/schedule test [n]           — run schedule immediately
/schedule del [n]            — remove schedule
/schedules                   — list active schedules
```

**Reminders**
```
/remind 30min [text]   — reminder in 30 minutes
/remind 2h [text]      — reminder in 2 hours
/remind 17:30 [text]   — reminder at specific time
/reminders             — list active reminders
/remindel [n]          — cancel reminder #n
```

**Weather & Media**
```
/weather [city]     — current weather (Open-Meteo, no key needed)
[voice message]     — transcribed + answered (requires GROQ_API_KEY)
[photo]             — image description (requires vision model in Ollama)
```

**Dev**
```
/run [js code]   — execute JavaScript (requires ALLOWED_USER_IDS)
```

---

## Project Structure

```
ai-assistant/
├── index.js                  # Entry point
├── start.ps1                 # Windows PowerShell launcher
├── config/
│   └── personas.json         # System prompt templates
├── src/
│   ├── agent/
│   │   └── router.js         # Automatic model routing
│   ├── db/
│   │   └── database.js       # JSON flat-file persistence
│   ├── handlers/
│   │   └── commands.js       # Telegram command handlers
│   ├── llm/
│   │   └── ollama.js         # Ollama REST client
│   ├── scheduler/
│   │   └── scheduler.js      # Cron-based scheduled searches
│   └── tools/
│       ├── search.js         # Web search (Serper + DDG fallback)
│       ├── coder.js          # JS code execution
│       ├── reminder.js       # One-time reminders with persistence
│       ├── weather.js        # Open-Meteo weather
│       ├── voice.js          # Groq Whisper transcription
│       └── vision.js         # Ollama vision model
└── data/                     # Persisted user data (gitignored)
    ├── chat.json
    ├── memory.json
    ├── notes.json
    ├── todos.json
    ├── config.json
    ├── schedules.json
    └── reminders.json
```

---

## Running as a Windows Service (optional)

```powershell
winget install nssm
nssm install "AI-Assistant" powershell.exe "-NoProfile -File C:\path\to\ai-assistant\start.ps1"
nssm start "AI-Assistant"
```
