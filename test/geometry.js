// Shared SVG parsers for the test suite.
// Lifted verbatim out of run-tests.js so run-tests.js, invariants.js and
// mutants.js all measure the drawing the same way — duplicating these is how
// the assertion and the prover drift apart.
"use strict";

// Parse every <text> in the svg, resolving <g> translate offsets and tagging
// each box with its nearest band/strip/tcell ancestor. Texts inside rotated
// groups are flagged separately (symbols must stay text-free, so there should
// never be any).
function textBoxes(svg) {
  const boxes = []; const stack = [{ x: 0, y: 0, band: false, cellY: null, rot: false }];
  const re = /<g\b[^>]*>|<\/g>|<text [^>]*>[^<]*<\/text>/g; let m;
  while ((m = re.exec(svg))) {
    const tok = m[0];
    if (tok === "</g>") { stack.pop(); continue; }
    if (tok.startsWith("<g")) {
      const fr = { ...stack[stack.length - 1] };
      if (/rotate\(/.test(tok)) fr.rot = true;
      else {
        const t = tok.match(/transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/);
        if (t) { fr.x += +t[1]; fr.y += +t[2]; }
      }
      const cls = tok.match(/class="(\w+)"/);
      if (cls && (cls[1] === "band" || cls[1] === "strip")) { fr.band = true; fr.cellY = null; }
      if (cls && cls[1] === "tcell") { const d = tok.match(/data-y="(-?[\d.]+)"/); fr.cellY = d ? +d[1] : null; fr.band = false; }
      stack.push(fr); continue;
    }
    const a = tok.match(/<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="([\d.]+)" text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/);
    const top = stack[stack.length - 1];
    if (!a) { boxes.push({ malformed: tok }); continue; }
    // measure the RENDERED string, not the escaped markup (&quot; is one glyph)
    const raw = a[5].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const fsz = +a[3], wpx = raw.length * fsz * 0.62;
    const x0 = a[4] === "start" ? +a[1] : +a[1] - wpx / 2;
    boxes.push({
      rot: top.rot, band: top.band, cellY: top.cellY, localY: +a[2], s: a[5],
      x0: top.x + x0, x1: top.x + x0 + wpx, y0: top.y + +a[2] - 0.8 * fsz, y1: top.y + +a[2] + 0.25 * fsz
    });
  }
  return boxes;
}

const rx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // literal string -> regex

function clippedByCanvas(svg, boxes) {
  const dim = svg.match(/<svg width="(\d+)" height="(\d+)"/);
  return boxes.filter(b => !b.malformed && (b.x0 < 0 || b.y0 < 0 || b.x1 > +dim[1] || b.y1 > +dim[2]))
    .map(b => `${b.s}@${Math.round(b.x1)},${Math.round(b.y1)} vs ${dim[1]}x${dim[2]}`);
}

function collisions(boxes) {
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const p = boxes[i], q = boxes[j];
    if (p.malformed || q.malformed) continue;
    if (p.x0 < q.x1 - 1 && q.x0 < p.x1 - 1 && p.y0 < q.y1 - 1 && q.y0 < p.y1 - 1) bad.push(p.s + " | " + q.s);
  }
  return bad;
}

// All row <g>s of one band, concatenated (a band may wrap into several rows).
function bandChunks(svg, id) {
  let s = "", i = 0;
  while ((i = svg.indexOf(`data-band="${id}"`, i)) >= 0) {
    const j = svg.indexOf('class="band" data-band=', i + 1);
    s += svg.slice(i, j < 0 ? undefined : j); i = j < 0 ? svg.length : j;
  }
  return s;
}

// Every rendered <text>'s content, in document order.
function textContents(svg) {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
}

module.exports = { textBoxes, rx, clippedByCanvas, collisions, bandChunks, textContents };
