#!/usr/bin/env bash
# Runs `bun test` several times at once, round after round, to shake out timing-sensitive tests.
# Usage: ./scripts/test-under-load.sh [copies at once, default 6] [rounds, default 5] [bun test args...]
# Prints each failing test (and any Bun crash) with how often it happened; exits 1 if any run failed.
set -uo pipefail

cd "$(dirname "$0")/.."

COPIES="${1:-6}"
ROUNDS="${2:-5}"
shift $(( $# > 2 ? 2 : $# ))
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/loophole-load-XXXXXX")"

echo "Running bun test $* — $COPIES at once, $ROUNDS rounds; load average now: $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || uptime)"
for c in $(seq 1 "$COPIES"); do
  (
    for r in $(seq 1 "$ROUNDS"); do
      if ! bun test "$@" >"$LOGS/run-$c-$r.log" 2>&1; then
        echo "failed" >"$LOGS/run-$c-$r.failed"
      fi
    done
  ) &
done
wait

runs=$((COPIES * ROUNDS))
failed=$(find "$LOGS" -name '*.failed' | wc -l)
echo "$failed of $runs runs failed."
if [ "$failed" -gt 0 ]; then
  grep -h -E '^\(fail\)|panic:|Bun has crashed' "$LOGS"/*.log | sed -E 's/ \[[0-9.]+m?s\]$//' | sort | uniq -c | sort -rn
  echo "Logs: $LOGS"
  exit 1
fi
rm -rf "$LOGS"
