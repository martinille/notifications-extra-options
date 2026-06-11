#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="notifications-extra-options@martinille"
VERSION="$(jq -r '.version' "$ROOT/$UUID/metadata.json")"
DIST="$ROOT/dist"
ZIP="$DIST/$UUID-v$VERSION.zip"

mkdir -p "$DIST"
rm -f "$ZIP"

(
    cd "$ROOT"
    zip -qr "$ZIP" "$UUID"
)

echo "$ZIP"
