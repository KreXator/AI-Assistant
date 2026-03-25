## [2026-03-24] — Scheduler & Geocoding Reliability
**[PATTERN]**
Context: Fixing weather extraction and telegram markdown errors.
Mistake: Fixed `commands.js` but forgot `scheduler.js` used a separate regex. Also, didn't account for Polish case endings in geocoding.
Rule: 
1. Always apply extraction fixes to BOTH `handlers/` and `scheduler/` if they share similar logic.
2. For Polish city names, use a normalization mapping (locative -> nominative) before geocoding.
3. Automated push messages (schedulers) MUST have a Markdown-to-Plain-Text fallback in `sendLong` to prevent hanging on 400 Bad Request.
4. Escape special characters (`*`, `_`, `` ` ``) at the source in search tools.

## [2026-03-25] — System Hardening & Async Safety
**[CRITICAL/PATTERN]**
Context: Preventing bot crashes from third-party library errors (libsql/hrana).
Mistake: Relying on library stability for database calls and assuming `try/catch` in high-level handlers is enough.
Rule:
1. **Lower-Level Hardening**: ALWAYS wrap database interaction functions in their own `try/catch` blocks at the source (`src/db/database.js`).
2. **Global Safety Net**: Always implement `process.on('unhandledRejection')` and `process.on('uncaughtException')` in `index.js` to catch async leaks from libraries.
3. **Deterministic Persistence**: For high-frequency calls (briefing configs, history), protect the write path to ensure a single failed DB write doesn't stall the main event loop.
4. **Resilient Regex**: Use character-aware boundaries `[^\p{L}\p{N}]` for Polish commands to ensure inflected words don't break NL routing.
