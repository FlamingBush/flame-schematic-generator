#!/usr/bin/env bash
# Publish the schematic generator to machine-elves.art.
# Copies the single-file HTML into the site repo, commits directly on main
# (that repo forbids feature branches), pushes, and waits for the Cloudflare
# Pages deploy to go live (scripts/await-deploy.sh polls the deploy-status
# branch; usually ~1 min).
#
# Usage: scripts/publish.sh ["commit message"]
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/fast_schematic_generator.html"
SITE="$HOME/machine-elves.art"
DEST="$SITE/public/fast_schematic_generator-2.html"
MSG="${1:-Schematic update}"

[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
[ -d "$SITE/.git" ] || { echo "site repo not found at $SITE" >&2; exit 1; }

if ! git -C "$SITE" diff --quiet || ! git -C "$SITE" diff --cached --quiet; then
  echo "site repo has uncommitted changes — resolve first" >&2; exit 1
fi

if diff -q "$SRC" "$DEST" >/dev/null 2>&1; then
  echo "already published (no changes)"; exit 0
fi

cp "$SRC" "$DEST"
git -C "$SITE" add public/fast_schematic_generator-2.html
git -C "$SITE" commit -m "$MSG"
git -C "$SITE" push origin main
"$SITE/scripts/await-deploy.sh"
echo "live: https://machine-elves.art/fast_schematic_generator-2"
