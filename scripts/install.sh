#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="notifications-extra-options@martinille"
DEST="$HOME/.local/share/cinnamon/extensions/$UUID"

mkdir -p "$DEST"
cp -a "$ROOT/$UUID/." "$DEST/"

echo "Installed to $DEST"
echo "Enable it in Cinnamon Extensions: cinnamon-settings extensions"
