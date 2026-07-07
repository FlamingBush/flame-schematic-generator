// Regression tests for fast_schematic_generator.html — run: node test/run-tests.js
"use strict";
const { loadApp } = require("./harness");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, detail ? "— " + detail : ""); }
}

console.log("LAYOUT GRID INVARIANTS");
{
  const { store, app } = loadApp();
  const strips = store["strips"].children;
  check("all strips render", strips.length === app.SYSTEM.lines.length);
  check("uniform strip heights", strips.every((c) => c.innerHTML.includes(`height="${app.STRIP_H}"`)));

  const rows = new Set([app.ROW.balloon + 3.5, app.ROW.jTop, app.ROW.jBot, app.ROW.tag, app.ROW.n1, app.ROW.n2, app.CL + 3.5]);
  let offGrid = 0, overlaps = 0;
  const overlapDetail = [];
  strips.forEach((c) => {
    const texts = [...c.innerHTML.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
      .map((m) => ({ x: +m[1], y: +m[2], fs: +m[3], s: m[4] }));
    texts.forEach((t) => { if (![...rows].some((r) => Math.abs(r - t.y) < 0.01)) offGrid++; });
    const byRow = {};
    texts.forEach((t) => (byRow[t.y] = byRow[t.y] || []).push(t));
    Object.values(byRow).forEach((list) => {
      list.sort((a, b) => a.x - b.x);
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1], q = list[i];
        if (q.x - (q.s.length * q.fs * 0.62) / 2 < p.x + (p.s.length * p.fs * 0.62) / 2 - 1) {
          overlaps++; overlapDetail.push(p.s + " | " + q.s);
        }
      }
    });
  });
  check("every text baseline on a grid row", offGrid === 0, offGrid + " off-grid");
  check("no horizontal label overlaps", overlaps === 0, overlapDetail.join("; "));
  const all = strips.map((c) => c.innerHTML).join("");
  check("no undefined/NaN in strip SVG", !/undefined|NaN/.test(all));
  check("emergency shut-offs annotated", (all.match(/EMERGENCY FUEL SHUT-OFF/g) || []).length >= 3);
}

console.log("SVG EXPORT");
{
  const { store, captured, app } = loadApp();
  app.downloadSVG();
  check("export produced", !!captured.svg && captured.svg.length > 1000);
  check("no undefined/NaN in export", !/undefined|NaN/.test(captured.svg));
  // XML well-formedness essentials without a parser dependency:
  const bareAmp = captured.svg.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g) || [];
  check("no unescaped & in export", bareAmp.length === 0, bareAmp.length + " found");
  const rawLt = captured.svg.match(/<(?![a-zA-Z/!?])/g) || [];
  check("no stray < in export", rawLt.length === 0);
  const opens = (captured.svg.match(/<text[\s>]/g) || []).length;
  const closes = (captured.svg.match(/<\/text>/g) || []).length;
  check("balanced <text> tags", opens === closes, opens + " vs " + closes);
  check("no scale claims in export", !/relative scale|px = 1 in/.test(captured.svg));
  fs.writeFileSync(path.join(__dirname, "export.svg"), captured.svg);
  console.log("    (export written to test/export.svg — validate strictly with: python3 scripts/validate_svg.py)");
}

console.log("EDITOR ROUND TRIP");
{
  const { store, app } = loadApp();
  const box = store["jsonBox"];
  const o = JSON.parse(box.value);
  o.SYSTEM.meta.project = 'Mk. III <script>&"test"';
  o.SYSTEM.lines.push({ id: "L9", title: "Editor-added line", psi: "10 psi", op: 10,
    items: [{ j: "off", ref: "Z", dir: "in", label: "test" }, { p: "ball14", tag: "V-99" }, { j: "npt", size: "1/4", lr: "M>F" }, { p: "nozzle", tag: "N-99" }] });
  box.value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  check("re-render succeeds", store["jsonMsg"].textContent === "Re-rendered.");
  check("added line renders", store["strips"].children.length === o.SYSTEM.lines.length);
  check("hostile project name escaped in meta", !store["docMeta"].innerHTML.includes("<script>"));
  box.value = "{not json";
  app.applyJSON();
  check("malformed JSON reported, no crash", store["jsonMsg"].textContent.startsWith("JSON error"));
}

console.log("COMPLIANCE & PARTS TABLES");
{
  const { store } = loadApp();
  check("parts schedule populated", (store["partsTable"].innerHTML.match(/<tr>/g) || []).length > 15);
  check("compliance schedule populated", (store["compTable"].innerHTML.match(/<tr>/g) || []).length > 10);
  check("unverified parts flagged", store["partsTable"].innerHTML.includes("VERIFY PN"));
  check("field-only items present", store["compTable"].innerHTML.includes("FIELD"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
