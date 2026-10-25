#!/usr/bin/env bash
# Idempotent bootstrap of the dev Garage node: layout, access key, bucket.
# Usage: docker compose up -d && ./scripts/garage-init.sh
set -euo pipefail

cd "$(dirname "$0")/.."

KEY_ID="GK1a2b3c4d5e6f708192a3b4c5"
SECRET="8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b"
BUCKET="loophole-dev"

garage() {
  docker compose exec -T -e RUST_LOG=warn garage /garage "$@"
}

echo "Waiting for Garage..."
for _ in $(seq 1 30); do
  if garage status >/dev/null 2>&1; then break; fi
  sleep 1
done
garage status >/dev/null

if garage layout show 2>/dev/null | grep -q "No nodes currently have a role"; then
  node_id="$(garage node id -q 2>/dev/null | cut -d@ -f1)"
  echo "Assigning layout to node ${node_id:0:16}"
  garage layout assign -z dc1 -c 1G "$node_id" >/dev/null
  current="$(garage layout show 2>/dev/null | sed -n 's/^Current cluster layout version: //p')"
  garage layout apply --version "$((current + 1))" >/dev/null
else
  echo "Layout already applied"
fi

if garage key info "$KEY_ID" >/dev/null 2>&1; then
  echo "Key $KEY_ID already exists"
else
  echo "Importing key $KEY_ID"
  garage key import --yes -n loophole-dev "$KEY_ID" "$SECRET" >/dev/null
fi

if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket $BUCKET already exists"
else
  echo "Creating bucket $BUCKET"
  garage bucket create "$BUCKET" >/dev/null
fi

garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_ID" >/dev/null
echo "Garage ready: bucket=$BUCKET key=$KEY_ID endpoint=http://localhost:3900 region=garage"
