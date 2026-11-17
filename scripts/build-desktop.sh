#!/usr/bin/env bash
# Builds dist/SB-Truckin-Pay-Desktop.zip: unzip on Windows and double-click "Start SB Pay".
# Includes the app, its libraries and a private copy of Node.js, so the first start needs no download.
set -euo pipefail
NODE_VERSION=v24.22.3
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/dist"
STAGE="$OUT/stage/SB Truckin Pay"
rm -rf "$OUT/stage" && mkdir -p "$STAGE/app" "$OUT"

cp "$ROOT/desktop/"*.bat "$ROOT/desktop/"*.ps1 "$ROOT/desktop/READ ME FIRST.txt" "$STAGE/"
cp -r "$ROOT/server" "$ROOT/public" "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/app/"
(cd "$STAGE/app" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null)

CACHE="$OUT/node-$NODE_VERSION-win-x64.zip"
[ -f "$CACHE" ] || curl -fsSL -o "$CACHE" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
mkdir -p "$STAGE/node"
unzip -q -j "$CACHE" "node-$NODE_VERSION-win-x64/node.exe" "node-$NODE_VERSION-win-x64/LICENSE" -d "$STAGE/node"

rm -f "$OUT/SB-Truckin-Pay-Desktop.zip"
(cd "$OUT/stage" && zip -qr -9 "$OUT/SB-Truckin-Pay-Desktop.zip" "SB Truckin Pay")
rm -rf "$OUT/stage"
ls -lh "$OUT/SB-Truckin-Pay-Desktop.zip"
