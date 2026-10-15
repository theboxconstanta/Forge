#!/usr/bin/env bash
# FORGE EVENTS Phase 1B - (re)creates a DISPOSABLE local Postgres and applies
# the Events migration to it. Local only: the container listens on
# 127.0.0.1, has no credentials for and no connection to any Supabase
# project. Uses the locally cached supabase/postgres image (no pull).
#   bash setup.sh <migration.sql> [rollback.sql] [hardening.sql hardening.rollback.sql]
# The hardening migration (Phase 3.2) is copied to /work/hardening.sql and
# applied after Phase 1 unless APPLY_HARDENING=0 (hardening-pg.sh applies it
# itself, after seeding a pre-hardening "legacy" row).
set -euo pipefail
C=forge-events-pg1b
IMG=public.ecr.aws/supabase/postgres:17.6.1.127
HERE=$(cd "$(dirname "$0")" && pwd)
MIG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
RB=${2:-}; [ -n "$RB" ] && RB=$(cd "$(dirname "$RB")" && pwd)/$(basename "$RB")
HMIG=${3:-}; [ -n "$HMIG" ] && HMIG=$(cd "$(dirname "$HMIG")" && pwd)/$(basename "$HMIG")
HRB=${4:-}; [ -n "$HRB" ] && HRB=$(cd "$(dirname "$HRB")" && pwd)/$(basename "$HRB")
docker image inspect $IMG >/dev/null   # fail instead of pulling
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --pull never --name $C -p 127.0.0.1:54399:5432 -e POSTGRES_PASSWORD=local-disposable-only $IMG >/dev/null
for i in $(seq 1 90); do
  docker exec $C pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 1
done
sleep 2
# Git Bash on Windows: hand docker.exe native host paths, keep container paths as-is.
export MSYS_NO_PATHCONV=1
hp() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
docker exec $C mkdir -p /work/pg
docker cp "$(hp "$HERE")/." $C:/work/pg/
docker cp "$(hp "$MIG")" $C:/work/migration.sql
if [ -n "$RB" ]; then docker cp "$(hp "$RB")" $C:/work/rollback.sql; fi
if [ -n "$HMIG" ]; then docker cp "$(hp "$HMIG")" $C:/work/hardening.sql; fi
if [ -n "$HRB" ]; then docker cp "$(hp "$HRB")" $C:/work/hardening.rollback.sql; fi
x() { docker exec -i $C psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
x -U supabase_admin -f /work/pg/00_storage_stub.sql
x -U postgres -f /work/pg/01_live_shapes.sql
x -U postgres -f /work/pg/02_seed.sql
docker exec $C sh -c 'psql -U postgres -d postgres -X -q -At -f /work/pg/snapshot.sql > /work/base_snapshot.txt'
echo "applying migration as role postgres (single transaction)..."
x -U postgres -1 -f /work/migration.sql
if [ -n "$HMIG" ] && [ "${APPLY_HARDENING:-1}" = "1" ]; then
  echo "applying hardening migration as role postgres (single transaction)..."
  x -U postgres -1 -f /work/hardening.sql
fi
echo "setup ok"
