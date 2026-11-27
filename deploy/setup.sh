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

# The service user. It is not in the docker group, which would make it root on this VM: it runs docker only
# through the checker below, owned by root, which allows exactly the docker calls the app makes. What runs
# inside a box is not checked; that is the game.
id wall >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin wall
install -o root -g root -m 0755 "$REPO_DIR/deploy/wall-docker" /usr/local/sbin/wall-docker
# A name with a dot in it is ignored by sudo, so the draft is never live until visudo has passed it.
cat > /etc/sudoers.d/.wall-docker.new <<'SUDO'
# The app's user may run docker only through the checker.
Defaults!/usr/local/sbin/wall-docker !pam_session
wall ALL=(root) NOPASSWD: /usr/local/sbin/wall-docker
SUDO
visudo -cf /etc/sudoers.d/.wall-docker.new
install -o root -g root -m 0440 /etc/sudoers.d/.wall-docker.new /etc/sudoers.d/wall-docker
rm -f /etc/sudoers.d/.wall-docker.new
gpasswd -d wall docker >/dev/null 2>&1 || true
mkdir -p /var/lib/wall && chown wall:wall /var/lib/wall && chmod 700 /var/lib/wall
# The folders shared into boxes live in a small tmpfs, so boxes cannot fill the VM's disk. Only root may
# change what is in it (the checker makes and removes the folders), so a mount cannot be swapped for a link.
mkdir -p /var/lib/wall/shared
mountpoint -q /var/lib/wall/shared || mount -t tmpfs -o size=32m,mode=0755 tmpfs /var/lib/wall/shared
chown root:root /var/lib/wall/shared && chmod 0755 /var/lib/wall/shared
sed -i '\| /var/lib/wall/shared |d' /etc/fstab
echo "tmpfs /var/lib/wall/shared tmpfs size=32m,mode=0755 0 0" >> /etc/fstab

# The app
rsync -a --delete --exclude node_modules --exclude .next --exclude var --exclude .env "$REPO_DIR/" /opt/hold-the-wall/
# The .env sent with this push wins; without one, the VM keeps the one it has.
if [ -f "$REPO_DIR/.env" ]; then cp "$REPO_DIR/.env" /opt/hold-the-wall/.env; elif [ ! -f /opt/hold-the-wall/.env ]; then cp "$REPO_DIR/.env.example" /opt/hold-the-wall/.env; fi
grep -q '^PUBLIC_ORIGIN=.\+' /opt/hold-the-wall/.env || sed -i "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://$SITE|" /opt/hold-the-wall/.env
if command -v runsc >/dev/null; then sed -i 's|^SANDBOX_RUNTIME=.*|SANDBOX_RUNTIME=runsc|' /opt/hold-the-wall/.env; fi
# The .env file is read after the unit's own Environment=, so an empty line there would win.
sed -i 's|^WALL_DATA_DIR=.*|WALL_DATA_DIR=/var/lib/wall|' /opt/hold-the-wall/.env
# How the app reaches docker is set by the unit alone.
sed -i '/^WALL_DOCKER=/d' /opt/hold-the-wall/.env
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

# SSH with keys only: no password logins, and root only with a key. (Bots try thousands of passwords a day.)
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
SSHD
sshd -t && systemctl reload ssh

# Only ssh and the web reach this VM; the app (3000) and the beacon (3001) do not.
ufw default deny incoming
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Hold the Wall is at https://$SITE"
