#!/usr/bin/env bash
# Sends this checkout to the VM and runs the setup there. Run from the repo root:
#   bash deploy/push.sh <vm-ip>
# The account key (VULTR_API_KEY) never leaves this machine; the rest of .env goes along.
set -euo pipefail
IP="$1"
SSH="ssh -o StrictHostKeyChecking=accept-new root@$IP"
rsync -az --delete -e "ssh -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude .next --exclude var --exclude .env --exclude .git --exclude .claude \
  ./ "root@$IP:/root/hold-the-wall/"
# What the stage calls the host it runs on.
HOST_LABEL="${HOST_LABEL:-vultr · sto · vc2-2c-4gb}"
{ grep -vE '^(VULTR_API_KEY|WALL_HOST_LABEL)=' .env; echo "WALL_HOST_LABEL=$HOST_LABEL"; } | $SSH 'umask 077; cat > /root/hold-the-wall/.env'
$SSH 'cd /root/hold-the-wall && bash deploy/setup.sh'
