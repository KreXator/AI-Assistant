## [2026-03-24] — Scheduler & Geocoding Reliability
**[PATTERN]**
Context: Fixing weather extraction and telegram markdown errors.
Mistake: Fixed `commands.js` but forgot `scheduler.js` used a separate regex. Also, didn't account for Polish case endings in geocoding.
Rule: 
1. Always apply extraction fixes to BOTH `handlers/` and `scheduler/` if they share similar logic.
2. For Polish city names, use a normalization mapping (locative -> nominative) before geocoding.
3. Automated push messages (schedulers) MUST have a Markdown-to-Plain-Text fallback in `sendLong` to prevent hanging on 400 Bad Request.
4. Escape special characters (`*`, `_`, `` ` ``) at the source in search tools.
