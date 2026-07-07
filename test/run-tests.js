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
function collisions(boxes) {
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const p = boxes[i], q = boxes[j];
    if (p.malformed || q.malformed) continue;
    if (p.x0 < q.x1 - 1 && q.x0 < p.x1 - 1 && p.y0 < q.y1 - 1 && q.y0 < p.y1 - 1) bad.push(p.s + " | " + q.s);
  }
  return bad;
}

console.log("LAYOUT INVARIANTS");
{
  const { store, app } = loadApp();
  const hosts = store["strips"].children;
  check("one combined svg", hosts.length === 1 && /<svg /.test(hosts[0].innerHTML));
  const svg = hosts[0].innerHTML;
  const trunkIds = app.TREE.trunk.filter(e => e.title).map(e => e.title.id);
  check("every line rendered (as trunk segment or band)", app.SYSTEM.lines.every(L =>
    trunkIds.includes(L.id) || svg.includes(`data-band="${L.id}"`)));
  check("default system: trunk carries supply, no orphans", trunkIds.length >= 1 && app.TREE.orphans.length === 0);

  const boxes = textBoxes(svg);
  check("all <text> elements parseable", !boxes.some(b => b.malformed), (boxes.find(b => b.malformed) || {}).malformed);
  check("no text inside rotated symbol groups", !boxes.some(b => b.rot));

  const bandRows = new Set([app.ROW.balloon + 3.5, app.ROW.jTop, app.ROW.jBot, app.ROW.tag, app.ROW.n1, app.ROW.n2, app.CL + 3.5, 8]);
  const trunkOffs = new Set(Object.values(app.TROW));
  let offGrid = 0, homeless = 0; const offDetail = [];
  boxes.forEach(b => {
    if (b.malformed) return;
    if (b.band) { if (![...bandRows].some(r => Math.abs(r - b.localY) < 0.01)) { offGrid++; offDetail.push(b.s + "@band:" + b.localY); } }
    else if (b.cellY !== null) { const o = b.localY - b.cellY; if (![...trunkOffs].some(r => Math.abs(r - o) < 0.01)) { offGrid++; offDetail.push(b.s + "@trunk:" + o); } }
    else { homeless++; offDetail.push("homeless:" + b.s); }
  });
  check("every text baseline on a band row or trunk mini-grid row", offGrid === 0, offDetail.slice(0, 4).join("; "));
  check("every text inside a band/strip/tcell group", homeless === 0, offDetail.slice(0, 4).join("; "));

  const bad = collisions(boxes);
  check("zero text collisions anywhere on the sheet", bad.length === 0, bad.slice(0, 4).join("; "));

  // connectors: every derived edge draws exactly one connector whose y equals
  // the destination band's centerline (real branching, not matching letters)
  app.TREE.edges.forEach(e => {
    const conns = [...svg.matchAll(new RegExp(`data-conn="${rx(e.ref)}" data-cly="(-?[\\d.]+)"`, "g"))];
    const band = svg.match(new RegExp(`data-band="${rx(e.to.id)}" data-cl="(-?[\\d.]+)"`));
    check(`ref ${e.ref} (${e.kind}): one connector, aligned to ${e.to.id} centerline`,
      conns.length === 1 && !!band && conns[0][1] === band[1],
      `${conns.length} conns, cly=${conns[0] && conns[0][1]}, cl=${band && band[1]}`);
  });
  check("all refs resolve in default data — no pentagons drawn", !/h16 l8 10 l-8 10 h-16/.test(svg));
  check("symbols are text-free (rotatable)", Object.keys(app.SYM).every(k => !/<text/.test(app.SYM[k](0, { w: 3, h: 3 }, {}))));
  check("no undefined/NaN in svg", !/undefined|NaN/.test(svg));
  check("emergency shut-offs annotated", (svg.match(/EMERGENCY FUEL SHUT-OFF/g) || []).length >= 3);
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
  const svg = store["strips"].children[0].innerHTML;
  check("unmatched line renders as orphan strip with pentagon", svg.includes('data-band="L9"') && /h16 l8 10 l-8 10 h-16/.test(svg) && svg.includes(">Z<"));
  check("fan:3 survives the JSON round trip (TYP badge drawn)", svg.includes("TYP ×3"));
  check("hostile project name escaped in meta", !store["docMeta"].innerHTML.includes("<script>"));
  const bad = collisions(textBoxes(svg));
  check("still zero text collisions after edit", bad.length === 0, bad.slice(0, 4).join("; "));
  box.value = "{not json";
  app.applyJSON();
  check("malformed JSON reported, no crash", store["jsonMsg"].textContent.startsWith("JSON error"));
}

console.log("MULTI-BRANCH & HOSTILE DATA");
{
  const { store, captured, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  // second matched pilot tap on L3 (the corridor-crossing regression)
  const L3 = o.SYSTEM.lines.find(L => L.id === "L3");
  L3.items.splice(L3.items.findIndex(it => it.tag === "SV-1") + 1, 0,
    { p: "nptTee", tag: "F-9", branch: { ref: "P2" }, note: "second pilot tap" }, { j: "npt", size: "1/4", lr: "M>F" });
  o.SYSTEM.lines.push({ id: "L3b", title: "Second pilot", psi: "60 psi", op: 60,
    items: [{ j: "off", ref: "P2", dir: "in", label: "from F-9" }, { j: "tube", part: "cu38", size: "3/8", label: "TB-9" }, { p: "pilot", tag: "PL-9", flame: true }] });
  // mid-trunk off-out (must NOT terminate the run)
  const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
  L1.items.splice(L1.items.length - 2, 0, { j: "off", ref: "Q", dir: "out", label: "aux port (future)" });
  // line id with a double quote (attribute-injection regression)
  o.SYSTEM.lines.push({ id: 'Z"9', title: 'quoted "id" line', psi: "1 psi", op: 1,
    items: [{ p: "ball14", tag: "V-Q" }, { j: "off", ref: "QQ", dir: "out", label: "loose" }] });
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  check("re-render succeeds", store["jsonMsg"].textContent === "Re-rendered.");
  const svg = store["strips"].children[0].innerHTML;

  const rects = {};
  [...svg.matchAll(/<g class="band" data-band="([^"]*)" data-cl="(-?[\d.]+)" data-w="(-?[\d.]+)" transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/g)]
    .forEach(m => { rects[m[1]] = { w: +m[3], x: +m[4], y: +m[5] }; });
  app.TREE.edges.filter(e => e.kind === "drop").forEach(e => {
    const m = svg.match(new RegExp(`data-conn="${rx(e.ref)}" data-cly="(-?[\\d.]+)" d="M(-?[\\d.]+) (-?[\\d.]+) V(-?[\\d.]+) H(-?[\\d.]+) V(-?[\\d.]+)`));
    const cross = m ? Object.entries(rects).filter(([id, r]) =>
      id !== e.to.id && (!e.from || id !== e.from.id) &&
      +m[5] >= r.x && +m[5] <= r.x + r.w &&
      Math.min(+m[4], +m[6]) < r.y + app.STRIP_H && Math.max(+m[4], +m[6]) > r.y).map(([id]) => id) : ["no-path"];
    check(`drop ${e.ref}: corridor clears sibling bands`, !!m && cross.length === 0, cross.join(","));
  });

  const elbows = svg.match(new RegExp(`M${app.TRUNK.X} (-?[\\d.]+) Q${app.TRUNK.X} `, "g")) || [];
  check("mid-trunk off does not terminate the run (one end elbow)", elbows.length === 1, elbows.length + " elbows");
  check("mid-trunk off renders as pentagon stub", svg.includes(">Q<"));
  check("quoted line id escaped in attributes", svg.includes('data-band="Z&quot;9"'));
  app.downloadSVG();
  const bareAmp = captured.svg.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g) || [];
  check("hostile export: still no unescaped &", bareAmp.length === 0, bareAmp.length + " found");
  check("hostile export: quoted attr intact", captured.svg.includes('data-band="Z&quot;9"'));
  const bad = collisions(textBoxes(svg));
  check("hostile render: zero text collisions", bad.length === 0, bad.slice(0, 3).join("; "));
}
{
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  o.SYSTEM.lines = [
    { id: "R1", title: "Root", psi: "5 psi", op: 5, items: [
      { p: "nptTee", tag: "F-X", branch: { ref: "X" } }, { j: "npt", size: "1/4", lr: "M>F" }, { p: "nozzle", tag: "N-X", flame: true }] },
    { id: "C1", title: "Child", psi: "5 psi", op: 5, items: [
      { j: "off", ref: "X", dir: "in", label: "from F-X" }, { p: "pilot", tag: "PL-X", flame: true }] }];
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  const svg = store["strips"].children[0].innerHTML;
  const runYs = [...svg.matchAll(new RegExp(`<line x1="${app.TRUNK.X}" y1="(-?[\\d.]+)"`, "g"))].map(m => +m[1]);
  check("early take-off: run never starts above the section title", Math.min(...runYs) >= 50, "min y " + Math.min(...runYs));
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
