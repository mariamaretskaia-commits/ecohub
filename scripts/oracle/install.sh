#!/usr/bin/env bash
# Установка EcoHub на Oracle Cloud Always Free (Ubuntu / Oracle Linux)
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/ecohub}"
SERVICE_USER="${USER}"

echo "♻️ EcoHub install → $APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "❌ Нет $APP_DIR/.env – положите туда BOT_TOKEN, JWT_SECRET, WEBAPP_URL"
  exit 1
fi

# Node.js 22
if ! command -v node >/dev/null 2>&1; then
  echo "→ Установка Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs build-essential python3 || {
    # Oracle Linux
    sudo dnf install -y nodejs npm gcc-c++ make python3 || true
  }
fi

node -v
npm -v

# Зависимости + сборка фронта
cd "$APP_DIR"
npm install --prefix server
npm install --prefix bot
npm install --prefix web
npm run build --prefix web

mkdir -p "$APP_DIR/server/data/uploads"

# systemd
UNIT_SRC="$APP_DIR/scripts/oracle/ecohub.service"
UNIT_DST="/etc/systemd/system/ecohub.service"
if [[ -f "$UNIT_SRC" ]]; then
  TMP=$(mktemp)
  sed "s|/home/opc/ecohub|$APP_DIR|g; s|User=opc|User=$SERVICE_USER|g" "$UNIT_SRC" > "$TMP"
  sudo cp "$TMP" "$UNIT_DST"
  rm -f "$TMP"
  sudo systemctl daemon-reload
  sudo systemctl enable ecohub
  sudo systemctl restart ecohub
  echo "✅ systemd: ecohub запущен"
  sudo systemctl --no-pager status ecohub || true
fi

echo ""
echo "Дальше HTTPS (Caddy + DuckDNS) – см. scripts/oracle/README.md"
echo "После HTTPS: cd $APP_DIR && npm run bot:setup"
