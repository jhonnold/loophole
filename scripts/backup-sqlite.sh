#!/usr/bin/env bash
# Online backup of Loophole's SQLite database: a consistent copy made with VACUUM INTO while the
# API and the worker keep running, gzipped into a backup folder. Keeps the newest KEEP (default 14).
#   ./scripts/backup-sqlite.sh [folder, default backups]
# Development: copies DATABASE_PATH (from .env; default data/loophole.sqlite) with the local Bun.
# Production: run with COMPOSE_FILE=compose.prod.yml; the copy is made inside the api container
# and streamed out. README, "Backups", has the restore steps and the Garage notes.
set -euo pipefail

cd "$(dirname "$0")/.."

DEST="${1:-backups}"
KEEP="${KEEP:-14}"
NAME="loophole-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
mkdir -p "$DEST"

if [ -n "${COMPOSE_FILE:-}" ]; then
  docker compose exec -T api sh -c \
    "bun apps/server/scripts/backup-db.ts /tmp/$NAME && gzip -c /tmp/$NAME; status=\$?; rm -f /tmp/$NAME; exit \$status" \
    >"$DEST/$NAME.gz.part"
  mv "$DEST/$NAME.gz.part" "$DEST/$NAME.gz"
else
  bun apps/server/scripts/backup-db.ts "$DEST/$NAME"
  gzip "$DEST/$NAME"
fi

# Oldest first out: keep the newest $KEEP backups.
ls -1t "$DEST"/loophole-*.sqlite.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "Backed up to $DEST/$NAME.gz"
