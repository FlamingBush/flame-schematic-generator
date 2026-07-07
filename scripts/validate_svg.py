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

svg = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "test" / "export.svg")
if not svg.exists():
    sys.exit(f"{svg} not found — run `node test/run-tests.js` first to generate it")

root = ET.parse(svg).getroot()
ns = {"s": "http://www.w3.org/2000/svg"}
texts = root.findall(".//s:text", ns)
shapes = sum(len(root.findall(f".//s:{t}", ns)) for t in ("line", "path", "rect", "circle"))
print(f"XML well-formed ✓  ({svg.name}: {len(texts)} text elements, {shapes} shapes, "
      f"canvas {root.get('width')}x{root.get('height')})")

try:
    import cairosvg
    png = svg.with_suffix(".png")
    cairosvg.svg2png(url=str(svg), write_to=str(png), output_width=2400)
    print(f"rasterized ✓  {png}")
except ImportError:
    print("cairosvg not installed — skipping rasterization (pip install cairosvg to enable)")
