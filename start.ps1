#Requires -Version 5.1
<#
.SYNOPSIS
    Start the Windows AI Assistant (Telegram bot + Ollama).
.DESCRIPTION
    - Checks for .env file, creates it from .env.example if missing
    - Checks if Ollama is reachable; starts it if not running
    - Starts the Node.js bot process
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "  Windows AI Assistant" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── 1. .env check ─────────────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  [setup] Created .env from .env.example" -ForegroundColor Yellow
        Write-Host "  [setup] Edit .env and set your TELEGRAM_BOT_TOKEN, then re-run." -ForegroundColor Yellow
        Start-Process notepad.exe ".env"
        exit 0
    } else {
        Write-Host "  [error] No .env or .env.example found." -ForegroundColor Red
        exit 1
    }
}

# ── 2. node_modules check ─────────────────────────────────────────────────────
if (-not (Test-Path "node_modules")) {
    Write-Host "  [setup] node_modules not found. Running npm install..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [error] npm install failed." -ForegroundColor Red
        exit 1
    }
}

# ── 3. Ollama check ───────────────────────────────────────────────────────────
$ollamaUp = $false
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    $ollamaUp = ($resp.StatusCode -eq 200)
} catch {
    $ollamaUp = $false
}

if (-not $ollamaUp) {
    Write-Host "  [ollama] Not running. Attempting to start..." -ForegroundColor Yellow

    # Check if ollama.exe is available
    $ollamaExe = Get-Command ollama -ErrorAction SilentlyContinue
    if ($ollamaExe) {
        Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
        Write-Host "  [ollama] Started in background. Waiting 3s..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    } else {
        Write-Host "  [ollama] ollama not found in PATH." -ForegroundColor Red
        Write-Host "           Download from https://ollama.com and install." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  [ollama] Running ✓" -ForegroundColor Green
}

# ── 4. Start the bot ──────────────────────────────────────────────────────────
Write-Host "  [bot]    Starting Windows AI Assistant..." -ForegroundColor Cyan
Write-Host ""
node index.js
