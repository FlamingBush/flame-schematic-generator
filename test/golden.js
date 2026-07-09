// Approved-snapshot machinery, shared by run-tests.js and approve.js.
//
// The golden guards the INCIDENTAL rendered literals no invariant covers:
// exact path geometry, symbol coordinates, glyph tallies, caption text. Anything
// mechanically important — collisions, baselines, connector alignment, escaping,
// port assemblability, view rules, ratings — is guarded by an invariant, the
// port linter, or a geometry check that runs on every `npm test`. So a
// rubber-stamped `npm run approve` can wave through cosmetic drift only; a real
// regression still goes red regardless of the golden.
//
// Stored CANONICALIZED (a newline between every `><` pair). Verified: this form
// rasterizes to byte-identical pixels vs. the verbatim SVG, parses as strict
// XML, and never splits inside text content — so it is both a reviewable git
// diff and directly openable by rsvg-convert.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./harness");

const VIEWS = ["external", "internal"];
const APPROVED_DIR = path.join(__dirname, "approved");
const goldenPath = (view) => path.join(APPROVED_DIR, `drawing-${view}.svg`);

const canonicalize = (svg) => svg.replace(/></g, ">\n<");

// The <svg> WRAPPER — a standalone, rasterizable document. Not LAST_RENDER.inner,
// which is the contents only. The drawing is date-free (SYSTEM.meta.date reaches
// the EXPORT header, not the drawing), so no normalization is needed here.
function drawingFor(view) {
  const { store, app } = loadApp();
  app.setView(view);
  return store["strips"].children[0].innerHTML;
}

const goldenFor = (view) => canonicalize(drawingFor(view));

/* ---------- line-wise diff (LCS, no dependency) ---------- */

function diffOps(a, b) {
  const n = a.length, m = b.length;
  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] = a[i] === b[j]
        ? lcs[(i + 1) * w + (j + 1)] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + (j + 1)]);

  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: "=", s: a[i], i, j }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + (j + 1)]) { ops.push({ t: "-", s: a[i], i, j }); i++; }
    else { ops.push({ t: "+", s: b[j], i, j }); j++; }
  }
  while (i < n) { ops.push({ t: "-", s: a[i], i, j }); i++; }
  while (j < m) { ops.push({ t: "+", s: b[j], i, j }); j++; }
  return ops;
}

// Consecutive changed ops, padded with `ctx` unchanged lines on each side.
function hunks(ops, ctx = 2) {
  const out = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === "=") { k++; continue; }
    let start = k, end = k;
    while (end < ops.length) {
      if (ops[end].t !== "=") { end++; continue; }
      // keep going if another change is within 2*ctx unchanged lines
      let look = end, run = 0;
      while (look < ops.length && ops[look].t === "=" && run < ctx * 2) { look++; run++; }
      if (look < ops.length && ops[look].t !== "=") { end = look; continue; }
      break;
    }
    const from = Math.max(0, start - ctx), to = Math.min(ops.length, end + ctx);
    out.push({ at: ops[start].i, ops: ops.slice(from, to) });
    k = end;
  }
  return out;
}

const textContent = (l) => { const m = /^<text[^>]*>([^<]*)<\/text>$/.exec(l); return m ? m[1] : null; };

function summarize(oldText, newText, opts = {}) {
  const { maxHunks = 8, label = "" } = opts;
  const a = oldText.split("\n"), b = newText.split("\n");
  const ops = diffOps(a, b);
  const changed = ops.filter((o) => o.t !== "=").length;
  const added = ops.filter((o) => o.t === "+");
  const removed = ops.filter((o) => o.t === "-");
  const addedText = added.map((o) => textContent(o.s)).filter(Boolean);
  const removedText = removed.map((o) => textContent(o.s)).filter(Boolean);

  const lines = [];
  if (!changed) return { changed: 0, chunks: a.length, added: 0, removed: 0, report: "" };

  lines.push(`${label ? label + ": " : ""}${changed} of ${a.length} chunks changed  (+${added.length} / -${removed.length})`);
  if (addedText.length || removedText.length)
    lines.push(`  text nodes: +${addedText.length} / -${removedText.length}`);

  const hs = hunks(ops);
  hs.slice(0, maxHunks).forEach((h) => {
    lines.push(`  @@ chunk ${h.at} @@`);
    h.ops.forEach((o) => lines.push(`   ${o.t === "=" ? " " : o.t} ${o.s.length > 150 ? o.s.slice(0, 147) + "..." : o.s}`));
  });
  if (hs.length > maxHunks) lines.push(`  ... and ${hs.length - maxHunks} more hunk(s)`);

  return { changed, chunks: a.length, added: added.length, removed: removed.length, report: lines.join("\n") };
}

module.exports = { VIEWS, APPROVED_DIR, goldenPath, canonicalize, drawingFor, goldenFor, diffOps, hunks, summarize };
