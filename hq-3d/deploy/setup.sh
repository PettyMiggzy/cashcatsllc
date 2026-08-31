#!/usr/bin/env bash
#
# Stand up World of CashCats on a fresh Ubuntu box.
#
#   sudo bash setup.sh woc.cashcatllc.help
#
# Point the domain's A record at this server BEFORE running: certbot proves
# ownership over port 80 and cannot do that while DNS points elsewhere.
#
# Safe to run again. It updates the checkout, refreshes the rooms and
# restarts, and will not overwrite an .env that already exists.
set -euo pipefail

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && { echo "usage: sudo bash setup.sh <domain>"; exit 1; }
[ "$(id -u)" -ne 0 ] && { echo "run with sudo"; exit 1; }

REPO="https://github.com/PettyMiggzy/cashcatsllc.git"
BRANCH="${BRANCH:-claude/new-session-8zljjb}"
DIR=/opt/cashcats
NODE=22.11.0            # exact: package.json pins it, PhysX is built for it
EMAIL="${EMAIL:-admin@${DOMAIN#*.}}"

echo "==> packages"
apt-get update -qq
apt-get install -y -qq git curl python3 nginx certbot python3-certbot-nginx xz-utils iproute2

echo "==> node $NODE"
if [ "$(/opt/node/bin/node -v 2>/dev/null || true)" != "v$NODE" ]; then
  rm -rf /opt/node && mkdir -p /opt/node
  curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-x64.tar.xz" \
    | tar -xJ -C /opt/node --strip-components=1
fi
# Kept in /opt and deliberately NOT symlinked into /usr/local/bin. This box
# may already run other services on their own node, and putting ours ahead
# of theirs on the PATH would quietly move them onto a different runtime
# the next time anything restarts.
NODE_BIN=/opt/node/bin
export PATH="$NODE_BIN:$PATH"
"$NODE_BIN/node" -v

echo "==> code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/hq-3d"

echo "==> deps"
"$NODE_BIN/npm" install --no-audit --no-fund

echo "==> port"
# 3000 is a popular port and this box runs a lot. Take the next free one
# rather than colliding with something already serving on it.
PORT="${PORT:-3000}"
while ss -ltn 2>/dev/null | grep -q ":$PORT "; do
  echo "    $PORT is taken, trying $((PORT+1))"
  PORT=$((PORT+1))
done
echo "    using $PORT"

echo "==> config"
NEW_ENV=0
if [ ! -f .env ]; then
  cp .env.example .env
  # A blank ADMIN_CODE makes every visitor an admin, and the stock JWT secret
  # would let anyone forge a holder pass into the Vault. Generate both.
  ADMIN=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
  JWT=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')
  sed -i "s|^ADMIN_CODE=.*|ADMIN_CODE=$ADMIN|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|"   .env
  echo "$ADMIN" > /root/cashcats-admin-code && chmod 600 /root/cashcats-admin-code
  NEW_ENV=1
fi
sed -i "s|^PORT=.*|PORT=$PORT|" .env
# the domain can change between runs; the secrets must not
sed -i "s|^PUBLIC_WS_URL=.*|PUBLIC_WS_URL=wss://$DOMAIN/ws|"      .env
sed -i "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://$DOMAIN/api|" .env
grep -q '^GATE_ENABLED=' .env && sed -i "s|^GATE_ENABLED=.*|GATE_ENABLED=0|" .env \
                              || echo "GATE_ENABLED=0" >> .env

echo "==> service"
cat > /etc/systemd/system/cashcats.service <<UNIT
[Unit]
Description=World of CashCats
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR/hq-3d
ExecStart=$NODE_BIN/node build/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable cashcats >/dev/null 2>&1 || true

echo "==> build"
"$NODE_BIN/npm" run build

echo "==> first boot"
# The server creates world/, lays down the database schema and copies in the
# seed assets. The install scripts write blueprints into that database, so
# they cannot run before it exists — on a fresh box they would fail with
# "no such table: blueprints".
systemctl restart cashcats
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT" && break
  sleep 2
done

echo "==> world"
# The scripts are the source of truth for every room; the database is
# disposable. Re-running refreshes each room in place.
for s in install install_workshop install_homestead install_vault install_campus install_brand; do
  python3 "roomsrc/$s.py" >/dev/null && echo "    $s"
done

# blueprints are cached at boot, so the rooms just written need a restart
systemctl restart cashcats
sleep 4
systemctl --no-pager --lines=0 status cashcats | head -3 || true

echo "==> nginx"
cat > /etc/nginx/sites-available/cashcats <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        # the world runs over a websocket; without these it connects and is
        # dropped a moment later
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 7d;
        proxy_send_timeout 7d;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/cashcats /etc/nginx/sites-enabled/cashcats
# The default site stays. It only answers requests matching no server_name,
# and this box may already be serving something through it.
nginx -t && systemctl reload nginx

echo "==> https"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
  || echo "    certbot failed — check the A record for $DOMAIN points here, then re-run"

echo
echo "================================================================"
echo " https://$DOMAIN"
[ "$NEW_ENV" = "1" ] && echo " admin code: $(cat /root/cashcats-admin-code)   (kept in /root/cashcats-admin-code)"
[ "$NEW_ENV" = "1" ] && echo " use it in world chat:  /admin <code>"
echo
echo " port:    $PORT (nginx proxies to it)"
echo " logs:    journalctl -u cashcats -f"
echo " restart: systemctl restart cashcats"
echo " update:  sudo bash $DIR/hq-3d/deploy/setup.sh $DOMAIN"
echo "================================================================"
