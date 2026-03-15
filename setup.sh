#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Termux AI Assistant — One-Shot Setup
#  Usage in Termux:
#    curl -fsSL https://raw.githubusercontent.com/KreXator/Termux-AI-Assistant/main/setup.sh | bash
# ============================================================
set -e

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}ℹ  $*${RESET}"; }
success() { echo -e "${GREEN}✅ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠️  $*${RESET}"; }
error()   { echo -e "${RED}❌ $*${RESET}"; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Banner ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ████████╗███████╗██████╗ ███╗   ███╗██╗   ██╗██╗  ██╗"
echo "     ██╔══╝██╔════╝██╔══██╗████╗ ████║██║   ██║╚██╗██╔╝"
echo "     ██║   █████╗  ██████╔╝██╔████╔██║██║   ██║ ╚███╔╝ "
echo "     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║   ██║ ██╔██╗ "
echo "     ██║   ███████╗██║  ██║██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗"
echo "     ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝"
echo -e "                  AI Assistant Setup${RESET}"
echo ""

INSTALL_DIR="$HOME/termux-ai-assistant"
DEFAULT_MODEL="qwen2.5:0.5b"      # Smallest capable model (~400MB)
DEFAULT_MODEL_LARGE="llama3.2:3b" # For complex tasks

# ── Step 1: System deps ──────────────────────────────────────
step "1/6 Installing system dependencies"

pkg update -y -q 2>/dev/null || true
for pkg in curl git nodejs; do
  if ! command -v "$pkg" &>/dev/null; then
    info "Installing $pkg..."
    pkg install -y "$pkg" -q
  else
    success "$pkg already installed"
  fi
done

# ── Step 2: Ollama ───────────────────────────────────────────
step "2/6 Checking Ollama"

if command -v ollama &>/dev/null; then
  success "Ollama already installed ($(ollama --version 2>/dev/null || echo 'ok'))"
else
  info "Installing Ollama for ARM64..."
  # Official install script works in Termux on ARM64
  curl -fsSL https://ollama.com/install.sh | sh || {
    # Fallback: manual ARM64 binary download
    warn "Official script failed, trying direct download..."
    OLLAMA_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-arm64"
    curl -fsSL "$OLLAMA_URL" -o "$PREFIX/bin/ollama"
    chmod +x "$PREFIX/bin/ollama"
  }
  success "Ollama installed"
fi

# ── Step 3: Start Ollama (background) ───────────────────────
step "3/6 Starting Ollama service"

if ! pgrep -x "ollama" > /dev/null 2>&1; then
  info "Starting ollama serve in background..."
  nohup ollama serve > "$HOME/.ollama/server.log" 2>&1 &
  OLLAMA_PID=$!
  info "Waiting for Ollama to be ready..."
  for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
      success "Ollama is ready"
      break
    fi
    sleep 1
    if [ "$i" -eq 15 ]; then
      warn "Ollama didn't respond in time — continuing, bot will retry"
    fi
  done
else
  success "Ollama already running"
fi

# ── Step 4: Pull model ───────────────────────────────────────
step "4/6 Checking AI model"

EXISTING_MODELS=$(curl -sf http://127.0.0.1:11434/api/tags 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' | head -5 || echo "")

if echo "$EXISTING_MODELS" | grep -q "."; then
  success "Found existing models:"
  echo "$EXISTING_MODELS" | while read -r m; do echo "   • $m"; done
  DEFAULT_MODEL=$(echo "$EXISTING_MODELS" | head -1)
  info "Will use: $DEFAULT_MODEL"
else
  info "No models found. Pulling $DEFAULT_MODEL (~400MB, smallest capable model)..."
  info "This may take a few minutes on mobile data..."
  ollama pull "$DEFAULT_MODEL"
  success "Model $DEFAULT_MODEL downloaded"

  info "Also pulling $DEFAULT_MODEL_LARGE for complex tasks (~2GB)..."
  echo -n "Pull large model now? (takes longer, you can skip with 'n'): "
  read -r PULL_LARGE < /dev/tty
  if [[ "$PULL_LARGE" != "n" && "$PULL_LARGE" != "N" ]]; then
    ollama pull "$DEFAULT_MODEL_LARGE" && success "Large model ready"
  else
    warn "Skipped large model. Bot will use $DEFAULT_MODEL for all tasks."
    DEFAULT_MODEL_LARGE="$DEFAULT_MODEL"
  fi
fi

# ── Step 5: Download / update bot ───────────────────────────
step "5/6 Setting up bot files"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null && success "Updated to latest version"
elif [ -d "$INSTALL_DIR" ]; then
  info "Directory exists (no git). Keeping it as-is."
else
  info "Cloning repository..."
  git clone https://github.com/KreXator/Termux-AI-Assistant.git "$INSTALL_DIR"
  success "Repository cloned to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"

info "Installing Node.js dependencies..."
npm install --silent
success "Dependencies installed"

# ── Step 6: Configure ────────────────────────────────────────
step "6/6 Configuration"

if [ -f ".env" ] && grep -q "TELEGRAM_BOT_TOKEN=." .env 2>/dev/null; then
  success ".env already configured. Skipping."
else
  echo ""
  echo -e "${BOLD}You need a Telegram Bot Token.${RESET}"
  echo "  1. Open Telegram → search for @BotFather"
  echo "  2. Send: /newbot"
  echo "  3. Follow instructions → copy the token (looks like: 1234567890:ABCdef...)"
  echo ""
  while true; do
    echo -n "  Paste your Telegram Bot Token: "
    read -r TG_TOKEN < /dev/tty
    if [[ "$TG_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{35,}$ ]]; then
      success "Token format looks correct!"
      break
    else
      warn "That doesn't look like a valid token. Try again."
    fi
  done

  echo ""
  echo -n "  Your Telegram User ID (optional, press Enter to skip — bot will accept anyone): "
  read -r TG_USER_ID < /dev/tty

  # Write .env
  cat > .env << EOF
TELEGRAM_BOT_TOKEN=${TG_TOKEN}
ALLOWED_USER_IDS=${TG_USER_ID}
OLLAMA_BASE_URL=http://127.0.0.1:11434
MODEL_SMALL=${DEFAULT_MODEL}
MODEL_LARGE=${DEFAULT_MODEL_LARGE}
CONTEXT_TOKEN_LIMIT=3000
DATA_DIR=./data
EOF

  success ".env file created"
fi

# ── Done! Launch ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Setup complete! Starting bot...${RESET}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo ""
echo -e "  Open Telegram and send ${BOLD}/start${RESET} to your bot."
echo ""
echo -e "  To run in background next time:"
echo -e "  ${CYAN}nohup node ~/termux-ai-assistant/index.js > ~/assistant.log 2>&1 &${RESET}"
echo ""

node index.js
