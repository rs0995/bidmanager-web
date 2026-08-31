#!/usr/bin/env bash
#
# Deploy the BidManager backend to the OCI Ampere VM.
#
#   - copies Server UI/server/* to ~/bidmanager on the VM (tar over ssh)
#   - optionally copies deploy/oci/compose.yaml   (--with-compose)
#   - rebuilds + restarts the `backend` compose service (skip build: --no-build)
#   - waits for the public /health endpoint, then prints `compose ps` + recent logs
#
# Never touches the VM's .env or drive-sa.json. Run from anywhere in the repo.
#
# Usage:
#   deploy/oci/deploy-backend.sh [--with-compose] [--no-build] [HEALTH_URL]
#
# Overridable env:
#   BIDMANAGER_OCI_SSH   ssh target                (default: bidmanager-oci — see ~/.ssh/config)
#   BIDMANAGER_OCI_DIR   repo dir on VM, relative to the login home or absolute;
#                        do NOT use a leading ~ (it is passed inside quotes)
#                        (default: bidmanager)

set -euo pipefail

REMOTE="${BIDMANAGER_OCI_SSH:-bidmanager-oci}"
REMOTE_DIR="${BIDMANAGER_OCI_DIR:-bidmanager}"

with_compose=0
do_build=1
health_url="https://161.118.170.233.sslip.io/health"

for arg in "$@"; do
  case "$arg" in
    --with-compose) with_compose=1 ;;
    --no-build)     do_build=0 ;;
    --*)            echo "unknown flag: $arg" >&2; exit 2 ;;
    *)              health_url="$arg" ;;
  esac
done

# Resolve the repo root from this script's location (deploy/oci/).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"

echo "==> repo:   $repo_root"
echo "==> remote: $REMOTE:$REMOTE_DIR"
echo "==> health: $health_url"
echo "==> build:  $([ "$do_build" -eq 1 ] && echo yes || echo 'no (file-only restart)')"

echo "==> copying Server UI/server -> VM"
tar -cf - --exclude=__pycache__ --exclude='*.pyc' --exclude='*.db' -C "Server UI/server" . \
  | ssh "$REMOTE" "mkdir -p \"$REMOTE_DIR/Server UI/server\" && cd \"$REMOTE_DIR/Server UI/server\" && tar -xf -"

if [ "$with_compose" -eq 1 ]; then
  echo "==> copying deploy/oci/compose.yaml -> VM"
  tar -cf - -C deploy/oci compose.yaml \
    | ssh "$REMOTE" "cd \"$REMOTE_DIR/deploy/oci\" && tar -xf -"
fi

build_flag=""
[ "$do_build" -eq 1 ] && build_flag="--build"
echo "==> docker compose up -d $build_flag backend"
ssh "$REMOTE" "cd \"$REMOTE_DIR/deploy/oci\" && docker compose up -d $build_flag backend"

echo "==> waiting for $health_url"
ok=0
for i in $(seq 1 15); do
  if curl -fsS --max-time 10 "$health_url" >/dev/null 2>&1; then
    ok=1
    echo "    healthy after ${i} attempt(s)"
    break
  fi
  sleep 5
done

echo "==> docker compose ps"
ssh "$REMOTE" "cd \"$REMOTE_DIR/deploy/oci\" && docker compose ps"
echo "==> backend logs (tail 20)"
ssh "$REMOTE" "cd \"$REMOTE_DIR/deploy/oci\" && docker compose logs --tail=20 backend" || true

if [ "$ok" -ne 1 ]; then
  echo "!! health check never passed ($health_url)" >&2
  exit 1
fi
echo "==> deploy OK"
