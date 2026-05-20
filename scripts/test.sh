#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="cinnamon-notifications-fixer@martinille"
EXT="$ROOT/$UUID"

jq empty "$EXT/metadata.json"
jq empty "$EXT/settings-schema.json"
node --check "$EXT/extension.js"

test "$(jq -r '.uuid' "$EXT/metadata.json")" = "$UUID"
test -f "$EXT/extension.js"
test -f "$EXT/settings-schema.json"

echo "ok"

