#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="cinnamon-notifications-fixer@martinille"
EXT="$ROOT/$UUID"

jq empty "$EXT/metadata.json"
jq empty "$EXT/settings-schema.json"
node --check "$EXT/extension.js"

test "$(jq -r '.uuid' "$EXT/metadata.json")" = "$UUID"
test "$(jq -r '.version' "$EXT/metadata.json")" = "1.0.0"
test -f "$EXT/extension.js"
test -f "$EXT/settings-schema.json"
test "$(jq -r '.position.options["Top center"]' "$EXT/settings-schema.json")" = "top-center"
test "$(jq -r '.position.options["Bottom center"]' "$EXT/settings-schema.json")" = "bottom-center"

echo "ok"
