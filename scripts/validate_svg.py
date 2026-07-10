#!/usr/bin/env python3
"""Strict validation of the exported SVG (test/export.svg by default).

Usage:
  python3 scripts/validate_svg.py [path/to/file.svg]

Always: parses as strict XML (stdlib, no installs) — this is what catches the
class of bug where browsers forgive invalid markup but Inkscape/Illustrator
or a reviewer's tooling will not.

Optional: if cairosvg is installed (pip install cairosvg), also rasterizes to
PNG next to the SVG so a human (or Claude Code reading the image) can inspect
layout visually.
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# The packet is one SVG per SHEET (scripts/make_pdf.sh joins them into the PDF),
# so validate every page, not just one. An explicit path still works.
here = Path(__file__).parent.parent / "test"
if len(sys.argv) > 1:
    pages = [Path(a) for a in sys.argv[1:]]
else:
    pages = sorted(here.glob("export-sheet-*.svg"))
if not pages:
    sys.exit(f"no exported pages in {here} — run `node test/run-tests.js` first to generate them")

ns = {"s": "http://www.w3.org/2000/svg"}
for svg in pages:
    if not svg.exists():
        sys.exit(f"{svg} not found")
    root = ET.parse(svg).getroot()          # raises on any XML defect
    texts = root.findall(".//s:text", ns)
    shapes = sum(len(root.findall(f".//s:{t}", ns)) for t in ("line", "path", "rect", "circle"))
    print(f"XML well-formed ✓  ({svg.name}: {len(texts)} text elements, {shapes} shapes, "
          f"canvas {root.get('width')}x{root.get('height')})")

try:
    import cairosvg
    for svg in pages:
        png = svg.with_suffix(".png")
        cairosvg.svg2png(url=str(svg), write_to=str(png), output_width=2400)
        print(f"rasterized ✓  {png}")
except ImportError:
    print("cairosvg not installed — skipping rasterization (use scripts/make_pdf.sh, which uses rsvg-convert)")
