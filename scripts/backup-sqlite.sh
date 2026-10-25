#!/usr/bin/env bash
# Online backup of Loophole's SQLite database: a consistent copy made with VACUUM INTO while the
# API and the worker keep running, gzipped into a backup folder. Keeps the newest KEEP (default 14).
#   ./scripts/backup-sqlite.sh [folder, default backups]
# Development: copies DATABASE_PATH (from .env; default data/loophole.sqlite) with the local Bun.
# Production: run with COMPOSE_FILE=compose.prod.yml; the copy is made inside the api container
# and streamed out. README, "Backups", has the restore steps and the Garage notes.
set -euo pipefail
# Copies are private to the user running this: the database holds password hashes and session hashes.
umask 077

cd "$(dirname "$0")/.."

DEST="${1:-backups}"
KEEP="${KEEP:-14}"
NAME="loophole-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
mkdir -p "$DEST"
chmod 700 "$DEST"
# A copy that fails part way leaves no partial file behind.
trap 'rm -f "$DEST/$NAME" "$DEST/$NAME.gz.part"' EXIT

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
