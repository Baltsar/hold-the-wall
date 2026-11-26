#!/usr/bin/env bash
# Takes a fresh Ubuntu LTS VM on Vultr to a running Hold the Wall. Run as root from a clone of the repo:
#   SITE=wall.example.com bash deploy/setup.sh
# SITE defaults to <ip-with-dashes>.sslip.io, which Caddy can get a certificate for.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(curl -s https://api.ipify.org)"
SITE="${SITE:-${IP//./-}.sslip.io}"

apt-get update
apt-get install -y ca-certificates curl gnupg ufw rsync debian-keyring debian-archive-keyring apt-transport-https

# Docker
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi

# gVisor (runsc). If it does not install, the box runs on runc and the report says so.
if ! command -v runsc >/dev/null; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg || true
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
  apt-get update && apt-get install -y runsc && runsc install && systemctl restart docker || echo "gVisor did not install; using runc"
fi

# Node 22
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# The service user. In the docker group it is root-equivalent on this VM, which holds nothing else.
id wall >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin wall
usermod -aG docker wall
mkdir -p /var/lib/wall && chown wall:wall /var/lib/wall && chmod 700 /var/lib/wall

# The app
rsync -a --delete --exclude node_modules --exclude .next --exclude var --exclude .env "$REPO_DIR/" /opt/hold-the-wall/
# The .env sent with this push wins; without one, the VM keeps the one it has.
if [ -f "$REPO_DIR/.env" ]; then cp "$REPO_DIR/.env" /opt/hold-the-wall/.env; elif [ ! -f /opt/hold-the-wall/.env ]; then cp "$REPO_DIR/.env.example" /opt/hold-the-wall/.env; fi
grep -q '^PUBLIC_ORIGIN=.\+' /opt/hold-the-wall/.env || sed -i "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://$SITE|" /opt/hold-the-wall/.env
if command -v runsc >/dev/null; then sed -i 's|^SANDBOX_RUNTIME=.*|SANDBOX_RUNTIME=runsc|' /opt/hold-the-wall/.env; fi
# The .env file is read after the unit's own Environment=, so an empty line there would win.
sed -i 's|^WALL_DATA_DIR=.*|WALL_DATA_DIR=/var/lib/wall|' /opt/hold-the-wall/.env
chown -R wall:wall /opt/hold-the-wall
chmod 600 /opt/hold-the-wall/.env
cd /opt/hold-the-wall
sudo -u wall npm ci --no-audit --no-fund
sudo -u wall npm run build
docker build -t wall-sandbox:1 -f deploy/sandbox.Dockerfile deploy

# Services
cp deploy/hold-the-wall.service /etc/systemd/system/
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=SITE=%s\n' "$SITE" > /etc/systemd/system/caddy.service.d/site.conf
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable hold-the-wall
systemctl restart hold-the-wall
systemctl restart caddy

# Only ssh and the web reach this VM; the app (3000) and the beacon (3001) do not.
ufw default deny incoming
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Hold the Wall is at https://$SITE"
