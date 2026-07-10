#!/usr/bin/env bash
# Build the submitted packet: the EXTERNAL view, one page per sheet, as a PDF.
#
# rsvg-convert cannot page-split a single SVG, and it ignores all but the first
# input when several are given — so each sheet is converted on its own and the
# pages are joined with pdfunite (poppler). Both are the tools this repo already
# relies on; cairosvg is not installed here.
#
#   ./scripts/make_pdf.sh [outfile.pdf]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/packet.pdf}"
NODE="${NODE:-$HOME/.nvm/versions/node/v22.22.1/bin/node}"   # bare `node` is a broken nvm shim

for bin in rsvg-convert pdfunite; do
  command -v "$bin" >/dev/null || { echo "missing $bin (brew install librsvg poppler)" >&2; exit 1; }
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$NODE" -e '
  const {loadApp}=require(process.argv[1]+"/test/harness.js");
  const fs=require("fs");
  const {app}=loadApp();
  app.setView("external");                       // the packet is the external view
  const docs=app.sheetDocs();
  if(!docs.length) throw new Error("no sheets rendered");
  docs.forEach((d,i)=>fs.writeFileSync(`${process.argv[2]}/sheet-${String(i+1).padStart(2,"0")}.svg`,d));
  console.log(`${docs.length} sheets`);
' "$ROOT" "$TMP"

for f in "$TMP"/sheet-*.svg; do
  rsvg-convert -f pdf "$f" -o "${f%.svg}.pdf"
done

pdfunite "$TMP"/sheet-*.pdf "$OUT"

pages=$(python3 - "$OUT" <<'PY'
import re,sys
d=open(sys.argv[1],'rb').read()
print(len(re.findall(rb'/Type\s*/Page[^sR]', d)) or max([int(x) for x in re.findall(rb'/Count\s+(\d+)', d)] or [0]))
PY
)
echo "wrote $OUT ($pages pages)"
