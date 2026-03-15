@echo off
REM ========================================================
REM  Quick-start helper for LOCAL DEVELOPMENT on Windows
REM  (Production running is on Android/Termux — see setup.sh)
REM ========================================================

echo.
echo  Termux AI Assistant — Local dev start
echo.

IF NOT EXIST .env (
  copy .env.example .env
  echo  Created .env from template.
  echo  ** Edit .env and add your TELEGRAM_BOT_TOKEN **
  echo.
  notepad .env
)

node index.js
