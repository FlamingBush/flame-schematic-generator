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

console.log("LAYOUT INVARIANTS");
{
  const { store, app } = loadApp();
  const hosts = store["strips"].children;
  check("one combined svg", hosts.length === 1 && /<svg /.test(hosts[0].innerHTML));
  const svg = hosts[0].innerHTML;
  const chained = Object.values(app.TREE.chain).flatMap(segs => segs.slice(1).map(s => s.id));
  check("every line rendered (band, chain seam, or orphan strip)", app.SYSTEM.lines.every(L =>
    chained.includes(L.id) || svg.includes(`data-band="${L.id}"`)));
  check("default system: root band carries supply, no orphans",
    !!app.TREE.root && app.TREE.orphans.length === 0 && svg.includes(`data-band="${app.TREE.root.id}"`));

  // the main run folds horizontal with EXACTLY one loop-back (two rows) —
  // branch bands never wrap, so no other loops may appear anywhere
  const loops = [...svg.matchAll(/data-loop="[^"]*" data-y1="(-?[\d.]+)" data-y2="(-?[\d.]+)"/g)];
  const cls = new Set([...svg.matchAll(/data-cl="(-?[\d.]+)"/g)].map(m => m[1]));
  check("main run folds exactly once (one loop-back on the whole sheet)", loops.length === 1);
  check("the loop-back joins two row centerlines", loops.every(m => cls.has(m[1]) && cls.has(m[2])));
  check("branch bands never wrap (no data-row outside the root)",
    [...svg.matchAll(/data-band="([^"]*)"[^>]*data-row=/g)].every(m => m[1] === app.TREE.root.id));

  // new constructs: band chain (L4→L4b), discharge riser, split/rejoin
  const bandChunks = id => { // all row <g>s of one band, concatenated
    let s = "", i = 0;
    while ((i = svg.indexOf(`data-band="${id}"`, i)) >= 0) {
      const j = svg.indexOf('class="band" data-band=', i + 1);
      s += svg.slice(i, j < 0 ? undefined : j); i = j < 0 ? svg.length : j;
    }
    return s;
  };
  check("L4b chains into the L4 band (seam, no separate strip)",
    svg.includes('data-merged="L4b"') && !svg.includes('data-band="L4b"') && svg.includes("L4b — Poofer accumulator"));
  const l4band = bandChunks("L4");
  check("riser: L4 discharge turns upward (tcell mini-grid + rotate(-90) symbols)",
    l4band.includes('class="tcell"') && l4band.includes("rotate(-90)"));
  const l3band = bandChunks("L3"), pcl = app.STRIP_H + app.CL;
  check("split: metered path strip renders below with down and up elbows",
    l3band.includes('data-par="L3"') && l3band.includes(`V${pcl - 8} Q`) && l3band.includes(`V${app.CL}"`));
  check("standby rail draws repeated tips (xn)",
    bandChunks("L3a").includes('translate(-22 0)') && bandChunks("L3a").includes('translate(22 0)'));
  check("dashed line boxes drawn (one per line segment per row)",
    (svg.match(/stroke-dasharray="7 4"/g) || []).length >= app.SYSTEM.lines.length);

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
  check("every text baseline on a band row or riser mini-grid row", offGrid === 0, offDetail.slice(0, 4).join("; "));
  check("every text inside a band/strip/tcell group", homeless === 0, offDetail.slice(0, 4).join("; "));

  const bad = collisions(boxes);
  check("zero text collisions anywhere on the sheet", bad.length === 0, bad.slice(0, 4).join("; "));
  const clip = clippedByCanvas(svg, boxes);
  check("no text clipped by the canvas edge", clip.length === 0, clip.slice(0, 3).join("; "));

  // connectors: every drop edge draws exactly one connector whose y equals
  // the destination band's centerline; a fan (end) edge instead breaks into a
  // labeled pentagon PAIR — a drawn route would read as a second loop-back
  app.TREE.edges.forEach(e => {
    if (e.kind === "end") {
      const pout = (svg.match(new RegExp(`data-pout="${rx(e.ref)}"`, "g")) || []).length;
      const pin = (svg.match(new RegExp(`data-pin="${rx(e.ref)}"`, "g")) || []).length;
      check(`ref ${e.ref} (end): labeled pentagon pair, no cross-sheet route`,
        pout === 1 && pin === 1 && !svg.includes(`data-conn="${e.ref}"`), `pout ${pout}, pin ${pin}`);
      return;
    }
    const conns = [...svg.matchAll(new RegExp(`data-conn="${rx(e.ref)}" data-cly="(-?[\\d.]+)"`, "g"))];
    const band = svg.match(new RegExp(`data-band="${rx(e.to.id)}" data-cl="(-?[\\d.]+)"`));
    check(`ref ${e.ref} (${e.kind}): one connector, aligned to ${e.to.id} centerline`,
      conns.length === 1 && !!band && conns[0][1] === band[1],
      `${conns.length} conns, cly=${conns[0] && conns[0][1]}, cl=${band && band[1]}`);
  });
  check("pentagons appear only as the matched fan pair",
    (svg.match(/h16 l8 10 l-8 10 h-16/g) || []).length === 2);
  check("symbols are text-free (rotatable)", Object.keys(app.SYM).every(k => !/<text/.test(app.SYM[k](0, { w: 3, h: 3 }, {}))));
  check("no undefined/NaN in svg", !/undefined|NaN/.test(svg));
  // V-1 (depot) and V-2 (main) are the marked emergency shut-offs; V-3 is a
  // plain convenience valve for testing and must NOT carry the annotation
  check("emergency shut-offs annotated (V-1, V-2 only)", (svg.match(/EMERGENCY FUEL SHUT-OFF/g) || []).length === 2);
  // FNPT-to-FNPT junctions (regs, ball valves, solenoids, NPT tees are all
  // female-ported) must show a hex nipple glyph, never a bare M-into-F marker
  // (the glyph's center hex body is the unique 6x12 white rect)
  check("hex nipples drawn at every female-to-female NPT junction",
    (svg.match(/width="6" height="12"/g) || []).length >= 11);
  // adapters consolidate: interface markers flank the hex body in ONE cell
  // with a combined size caption instead of three spread-out cells
  check("adapter cells consolidated (combined joint caption)",
    (svg.match(/&quot; flare ▸ [⅜¼½⅛⅝]&quot; NPT</g) || []).length >= 3 && svg.includes("CGA-510 POL ▸ ⅜&quot; flare"));
  check("SV-3 removed — metered path is needle-only", !svg.includes("SV-3"));
  check("hose-to-regulator flare x NPT adapters drawn (F-13, F-14)",
    svg.includes("F-13") && svg.includes("F-14"));
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
  check("fan:3 survives the JSON round trip (one-of-n badge drawn)", svg.includes("one of 3 identical branches"));
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
  // second matched tap on L3, downstream of the split (the corridor-crossing regression)
  const L3 = o.SYSTEM.lines.find(L => L.id === "L3");
  L3.items.splice(L3.items.findIndex(it => it.tag === "F-4") + 1, 0,
    { p: "nptTee", tag: "F-T9", branch: { ref: "P2" }, note: "second standby tap" }, { j: "npt", size: "1/4", lr: "M>F" });
  o.SYSTEM.lines.push({ id: "L3b", title: "Second pilot", psi: "60 psi", op: 60,
    items: [{ j: "off", ref: "P2", dir: "in", label: "from F-T9" }, { j: "tube", part: "cu38", size: "3/8", label: "TB-9" }, { p: "pilot", tag: "PL-9", flame: true }] });
  // mid-trunk off-out (must NOT terminate the run)
  const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
  L1.items.splice(L1.items.length - 2, 0, { j: "off", ref: "Q", dir: "out", label: "aux port (future)" });
  // mount cell directly followed by a left-stub cell (balloon adjacency regression)
  L1.items.splice(L1.items.findIndex(it => it.tag === "F-5") + 1, 0,
    { p: "flareTee", tag: "F-Z", branch: { arrow: "in" }, note: "adjacency probe" });
  // line id with a double quote (attribute-injection regression)
  o.SYSTEM.lines.push({ id: 'Z"9', title: 'quoted "id" line', psi: "1 psi", op: 1,
    items: [{ p: "ball14", tag: "V-Q" }, { j: "off", ref: "QQ", dir: "out", label: "loose" }] });
  // tiny orphan band with a long title (canvas-width clipping regression)
  o.SYSTEM.lines.push({ id: "T1", title: "An intentionally very long orphan title to guard the canvas width computation against clipped band headings", psi: "1 psi", op: 1,
    items: [{ p: "pilot", tag: "PL-T" }] });
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  check("re-render succeeds", store["jsonMsg"].textContent === "Re-rendered.");
  const svg = store["strips"].children[0].innerHTML;

  // rows[id] = every drawn row rect of that band (a band may wrap)
  const rows = {};
  [...svg.matchAll(/<g class="band" data-band="([^"]*)" data-cl="(-?[\d.]+)" data-w="(-?[\d.]+)" transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/g)]
    .forEach(m => { (rows[m[1]] = rows[m[1]] || []).push({ cl: +m[2], w: +m[3], x: +m[4], y: +m[5] }); });
  app.TREE.edges.filter(e => e.kind === "drop").forEach(e => {
    // every drop connector leaves straight DOWN from its tee: M x cl V ...
    const m = svg.match(new RegExp(`data-conn="${rx(e.ref)}" data-cly="(-?[\\d.]+)" d="M(-?[\\d.]+) (-?[\\d.]+) V(-?[\\d.]+)`));
    check(`drop ${e.ref}: leaves straight down from its tee, at a host row centerline`,
      !!m && (rows[e.from.id] || []).some(r => r.cl === +m[3]),
      m && `starts ${m[3]} vs cls ${(rows[e.from.id] || []).map(r => r.cl).join("/")}`);
    // the initial vertical segment must not slice any strip other than its
    // host's (last-row drops descend all the way into their band; earlier-row
    // drops descend only into their own row gap before jogging left)
    const cross = m ? Object.entries(rows).filter(([id, rs]) =>
      id !== e.from.id && id !== e.to.id && rs.some(r =>
        +m[2] >= r.x && +m[2] <= r.x + r.w &&
        Math.min(+m[3], +m[4]) < r.y + app.STRIP_H && Math.max(+m[3], +m[4]) > r.y + 1)).map(([id]) => id) : ["no-path"];
    check(`drop ${e.ref}: descent clears sibling strips`, !!m && cross.length === 0, cross.join(","));
  });
  const clip = clippedByCanvas(svg, textBoxes(svg));
  check("long orphan title not clipped by canvas", clip.length === 0, clip.slice(0, 3).join("; "));
  check("mid-run off renders as pentagon stub, run continues", svg.includes(">Q<"));
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
      { p: "ball14", tag: "V-X", branch: { ref: "X" } }, { j: "npt", size: "1/4", lr: "M>F" }, { p: "nozzle", tag: "N-X", flame: true }] },
    { id: "C1", title: "Child", psi: "5 psi", op: 5, items: [
      { j: "off", ref: "X", dir: "in", label: "from F-X" }, { p: "pilot", tag: "PL-X", flame: true }] }];
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  const svg = store["strips"].children[0].innerHTML;
  // non-tee branch host: the drop connector must start at the host band's run
  // centerline (painted under the symbol body), not float at a port offset
  const conn = svg.match(/data-conn="X" data-cly="(-?[\d.]+)" d="M(-?[\d.]+) (-?[\d.]+)/);
  const host = svg.match(/data-band="R1" data-cl="(-?[\d.]+)"/);
  check("take-off from a ball valve starts at the host run centerline",
    !!conn && !!host && conn[3] === host[1], conn && host && `${conn[3]} vs ${host[1]}`);
}

console.log("PORT LINTER");
{
  const { store, app } = loadApp();
  const r = app.lintPorts();
  check("zero issues in the default system", r.issues.length === 0, r.issues.slice(0, 3).join("; "));
  check("meaningful coverage (checked many, skipped only customs)", r.checked >= 40 && r.skipped > 0 && r.skipped < 20,
    `checked ${r.checked}, skipped ${r.skipped}`);
  check("FIT-1 row passes in the compliance table",
    store["compTable"].innerHTML.includes("FIT-1") && store["compTable"].innerHTML.includes("junctions machine-checked"));

  // seed the exact defect classes found by hand review — each must be caught
  const seed = (mutate) => {
    const { store, app } = loadApp();
    const o = JSON.parse(store["jsonBox"].value);
    mutate(o);
    store["jsonBox"].value = JSON.stringify(o);
    store["strips"].children.length = 0;
    app.applyJSON();
    return app.lintPorts();
  };
  // 1) the PRV-1 → V-2 bug: female-to-female drawn as a bare M ▸ F joint
  let r1 = seed(o => {
    const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
    const i = L1.items.findIndex(it => it.p === "reg60") + 1;
    L1.items[i] = { j: "npt", size: "1/4", lr: "M>F" };
  });
  check("catches female-to-female drawn without a nipple", r1.issues.some(s => s.includes("needs a nipple")), r1.issues.join("; "));
  // 2) the missing-adapter bug: hose flare directly into an NPT port
  let r2 = seed(o => {
    const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
    L1.items.splice(L1.items.findIndex(it => it.tag === "F-13"), 1);
  });
  check("catches a missing adapter (two joints in a row)", r2.issues.some(s => s.includes("adapter part is missing")), r2.issues.join("; "));
  // 3) size discontinuity: 1/4 joint drawn against the 3/8 mixer inlet
  let r3 = seed(o => {
    const L3 = o.SYSTEM.lines.find(L => L.id === "L3");
    const i = L3.items.findIndex(it => it.p === "mixer") - 1;
    L3.items[i] = { j: "npt", size: "1/4", lr: "M>F" };
  });
  check("catches a joint size discontinuity", r3.issues.some(s => s.includes("but the")), r3.issues.join("; "));
  // 4) wrong joint type: NPT drawn where the ports are flare
  let r4 = seed(o => {
    const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
    const i = L1.items.findIndex(it => it.tag === "F-2") + 1;
    L1.items[i] = { j: "npt", size: "1/4", lr: "M>F" };
  });
  check("catches an NPT joint drawn on flare ends", r4.issues.some(s => s.includes("NPT joint drawn on a flare end")), r4.issues.join("; "));
  // 5) backwards arrow: M ▸ F where the male port is actually downstream
  let r5 = seed(o => {
    const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
    const i = L1.items.findIndex(it => it.tag === "F-8") + 1;
    L1.items[i] = { j: "npt", size: "1/4" };
  });
  check("catches a backwards thread-direction arrow", r5.issues.some(s => s.includes("male port is upstream")), r5.issues.join("; "));
}

console.log("COMPLIANCE & PARTS TABLES");
{
  const { store } = loadApp();
  check("parts schedule populated", (store["partsTable"].innerHTML.match(/<tr>/g) || []).length > 15);
  check("compliance schedule populated", (store["compTable"].innerHTML.match(/<tr>/g) || []).length > 10);
  check("unverified parts flagged", store["partsTable"].innerHTML.includes("VERIFY PN"));
  check("nipples & adapters reach the schedule via joint parts",
    store["partsTable"].innerHTML.includes("Hex nipple") && store["partsTable"].innerHTML.includes("half union"));
  check("field-only items present", store["compTable"].innerHTML.includes("FIELD"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
