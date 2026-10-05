#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
command -v bun >/dev/null || { echo "Install Bun first." >&2; exit 1; }
command -v node >/dev/null || { echo "Install Node.js first." >&2; exit 1; }
[ -d "$ROOT/node_modules" ] || { echo "Run bun install --frozen-lockfile in the repository root first." >&2; exit 1; }
cd "$HERE"
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi
if [ -z "${CHROMIUM_PATH:-}" ]; then
  npx --no-install playwright install chromium
fi
exec node gallery.mjs "$@"
