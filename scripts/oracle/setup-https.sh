#!/usr/bin/env bash
# HTTPS через Caddy + бесплатный DuckDNS
# Использование:
#   export DUCKDNS_DOMAIN=ecohub-вашник.duckdns.org
#   export DUCKDNS_TOKEN=ваш_токен_из_duckdns
#   bash scripts/oracle/setup-https.sh
set -euo pipefail

DOMAIN="${DUCKDNS_DOMAIN:?Задайте DUCKDNS_DOMAIN=имя.duckdns.org}"
TOKEN="${DUCKDNS_TOKEN:?Задайте DUCKDNS_TOKEN}"
APP_DIR="${APP_DIR:-$HOME/ecohub}"

echo "→ DuckDNS update: $DOMAIN"
curl -fsS "https://www.duckdns.org/update?domains=${DOMAIN%.duckdns.org}&token=${TOKEN}&ip="
echo ""

# Caddy
if ! command -v caddy >/dev/null 2>&1; then
  echo "→ Установка Caddy…"
  sudo apt-get update
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
fi

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	reverse_proxy 127.0.0.1:3001
}
EOF

sudo systemctl enable caddy
sudo systemctl restart caddy

# WEBAPP_URL в .env
ENV_FILE="$APP_DIR/.env"
URL="https://$DOMAIN"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^WEBAPP_URL=' "$ENV_FILE"; then
    sed -i "s|^WEBAPP_URL=.*|WEBAPP_URL=$URL|" "$ENV_FILE"
  else
    echo "WEBAPP_URL=$URL" >> "$ENV_FILE"
  fi
fi

sudo systemctl restart ecohub || true
sleep 3
cd "$APP_DIR"
npm run bot:setup || true

echo ""
echo "✅ HTTPS: $URL"
echo "   Проверка: curl -s $URL/health"
echo "   Бот: @EcoHubBY_bot → /start"
