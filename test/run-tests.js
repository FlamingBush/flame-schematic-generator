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

console.log("LAYOUT INVARIANTS (internal view)");
{
  const { store, app } = loadApp();
  // this block asserts the INTERNAL packet: balloons key cells to the parts
  // schedule and equipment designations (F-15, RV-1) label them. The external
  // submission sheet is covered in its own block below.
  app.setView("internal");
  const hosts = store["strips"].children;
  check("one combined svg", hosts.length === 1 && /<svg /.test(hosts[0].innerHTML));
  const svg = hosts[0].innerHTML;
  const chained = Object.values(app.TREE.chain).flatMap(segs => segs.slice(1).map(s => s.id));
  check("every line rendered (band, chain seam, or orphan strip)", app.SYSTEM.lines.every(L =>
    chained.includes(L.id) || svg.includes(`data-band="${L.id}"`)));
  check("default system: root band carries supply; only the shared tip run is unrooted",
    !!app.TREE.root && app.TREE.orphans.length === 1 && app.TREE.orphans[0].id === "L3r" &&
    svg.includes(`data-band="${app.TREE.root.id}"`));

  // the supply stack absorbs the run's length: the default sheet fits in one
  // row with NO fold. Over-long roots still serpentine exactly once — that
  // path is exercised by the FORCED WRAP section below.
  const loops = [...svg.matchAll(/data-loop="[^"]*" data-y1="(-?[\d.]+)" data-y2="(-?[\d.]+)"/g)];
  check("default sheet needs no fold (supply stack absorbs the length)", loops.length === 0, loops.length + " loops");
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
  // supply stack: L1 opens as a vertical bottom→top run — every stack cell is
  // a tcell BELOW the band centerline, both cylinders are drawn (tank body
  // rect rx="9"), and the corner elbow's L-body masks the bend
  const l1band = bandChunks("L1");
  const stackYs = [...l1band.matchAll(/class="tcell" data-y="(-?[\d.]+)"/g)].map(m => +m[1]);
  check("supply stack: L1 opens vertical (tcell mini-grid below the centerline)",
    stackYs.length >= 12 && stackYs.every(y => y > app.CL), `${stackYs.length} cells, min ${Math.min(...stackYs)}`);
  check("vertical adapters consolidate (markers flanking the hex in one cell)",
    l1band.includes("CGA-510 POL ▸ 3/8&quot; flare") && bandChunks("L4").includes("▸ 1/2&quot; flare"));
  check("supply stack: both cylinders drawn, bare curve into the horizontal",
    (l1band.match(/rx="9"/g) || []).length === 2 && l1band.includes(`Q80 ${app.CL} 88 ${app.CL} H`));
  // the pocket beside the stack is real estate: branch bands tuck up into it
  // instead of stacking below the whole stack depth, and the L1 box notches
  // so they sit outside it
  const bandY = id => { const m = svg.match(new RegExp(`data-band="${id}"[^>]*transform="translate\\((-?[\\d.]+) (-?[\\d.]+)\\)"`)); return m ? +m[2] : null; };
  const stackBotAbs = bandY("L1") + Math.max(...stackYs);
  check("branch bands tuck into the pocket beside the stack",
    bandY("L4") !== null && bandY("L4") < stackBotAbs, `L4@${bandY("L4")} vs stack bottom ${stackBotAbs}`);
  check("the stack segment's box notches (L-shape, not a full rectangle)",
    (svg.match(/<path [^>]*stroke-dasharray="7 4"/g) || []).length === 1);
  check("POL joint labeled on the supply stack", svg.includes("CGA-510 POL"));
  check("note-only adapters are now drawn parts (all reach the schedule)",
    ["polFlare", "flareTeeFpt", "flare14npt", "cu14", "cu12", "flareTee14", "flareTeeR3814", "flareTeeR1414", "relief", "flare38npt34"].every(k => app.refIndex[k] !== undefined));
  check("no adaptIn/adaptOut/branchAdapt remain in the default system",
    !/adaptIn|adaptOut|branchAdapt/.test(JSON.stringify(app.SYSTEM)));
  check("no port-role copy on the accumulator (the drawing carries it)", !svg.includes("fill in side"));
  check("partless NPT glyph mirrors when the female port is upstream",
    app.jointMarker({ j: "npt" }, 50).includes("scale(-1,1)") && !app.jointMarker({ j: "npt", lr: "M>F" }, 50).includes("scale(-1,1)"));
  check("manifold outlets fan from the right face (run continues as one of 3)",
    /x2="33" y2="101"/.test(app.SYM.manifold(0, { w: 4 }, {})) && /x2="33" y2="123"/.test(app.SYM.manifold(0, { w: 4 }, {})));
  const l3band = bandChunks("L3"), pcl = app.STRIP_H + app.CL;
  check("split: metered path strip renders below with down and up elbows",
    l3band.includes('data-par="L3"') && l3band.includes(`V${pcl - 8} Q`) && l3band.includes(`V${app.CL}"`));
  // rail: 3/8 Cu through two reducing tees, every 1/4 port keyed by a T
  // pentagon; the 1/4 tip run drawn ONCE in its own strip — two tee-mounted
  // tips and a terminal crimped tip (three pilot circles)
  check("standby rail: reducing tees keyed T; tip run drawn once with three tips",
    (bandChunks("L3r").match(/r="9"/g) || []).length === 3 &&
    svg.includes(">Flare tee, reducing,<") && svg.includes(">F-17<") &&
    svg.includes(">F-18+SB-1<") &&
    svg.includes("3 identical tip runs") && svg.includes('data-band="L3r"'));
  check("60 psi distribution protected: RV-2 relief ahead of the manifold",
    svg.includes(">F-20+RV-2<") && svg.includes("RV-2: set 90 psi"));
  check("mixer respecced to the Stanbroil 3/4 in unit",
    svg.includes(">LP air mixer valve<") && svg.includes(">AM-1<") &&
    (svg.match(/3\/8&quot; flare ▸ 3\/4&quot; NPT/g) || []).length === 1);
  check("rail chains downstream of the split (L3a seam on the L3 band)",
    svg.includes('data-merged="L3a"') && !svg.includes('data-band="L3a"'));
  const jet = app.SYSTEM.lines.find(L => L.id === "L3b");
  const jI = t => jet.items.findIndex(it => it.tag === t);
  check("jet path teed off before the split, needle+solenoid in series",
    app.TREE.edges.some(e => e.ref === "J" && e.kind === "drop") &&
    jI("NV-4") > -1 && jI("NV-4") < jI("SV-3") && jI("SV-3") < jI("AM-1"));
  check("dashed line boxes drawn (one per line segment per row)",
    (svg.match(/stroke-dasharray="7 4"/g) || []).length >= app.SYSTEM.lines.length);

  const boxes = textBoxes(svg);
  check("all <text> elements parseable", !boxes.some(b => b.malformed), (boxes.find(b => b.malformed) || {}).malformed);
  check("no text inside rotated symbol groups", !boxes.some(b => b.rot));

  const bandRows = new Set([app.ROW.balloon + 3.5, app.ROW.jTop, app.ROW.jBot, app.ROW.tag, app.ROW.n1, app.ROW.n2, app.ROW.n3, app.ROW.n4, app.CL + 3.5, 8]);
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
  // pentagons: the matched fan pair (C ×2) plus the deliberately-unmatched
  // tip-run key T (F-16 branch, F-17 branch, rail end, tip-run lead-in)
  check("pentagons: fan pair + the four T tip-run marks",
    (svg.match(/h16 l8 10 l-8 10 h-16/g) || []).length === 6 && (svg.match(/>T</g) || []).length === 4);
  check("symbols are text-free (rotatable)", Object.keys(app.SYM).every(k => !/<text/.test(app.SYM[k](0, { w: 3, h: 3 }, {}))));
  check("no undefined/NaN in svg", !/undefined|NaN/.test(svg));
  // V-1 (depot), V-2 (main) and V-3 (poofer accumulator) are all marked
  // emergency shut-offs. Tie the count to the data so flagging another valve
  // can never silently go undrawn.
  const flagged = app.SYSTEM.lines.flatMap(L => L.items).filter(it => it.emergency);
  check("every emergency:true valve carries the orange callout, and only those",
    flagged.length >= 3 && (svg.match(/EMERGENCY FUEL SHUT-OFF/g) || []).length === flagged.length,
    `${flagged.length} flagged: ${flagged.map(f => f.tag).join(", ")}`);
  check("the poofer accumulator ball valve is marked for e-stop",
    flagged.some(f => f.tag === "V-3"));
  // FNPT-to-FNPT junctions (regs, ball valves, solenoids, NPT tees are all
  // female-ported) must show a hex nipple glyph, never a bare M-into-F marker
  // (the glyph's center hex body is the unique 6x12 white rect)
  // tied to the data, not a snapshot: making the runs flare removed nipples,
  // and the count must follow rather than be re-pinned by hand each time
  const nipplesInSystem = (JSON.stringify(app.SYSTEM).match(/"part":"nipple/g) || []).length;
  check("a hex nipple is drawn at every female-to-female NPT junction",
    nipplesInSystem > 0 && (svg.match(/width="6" height="12"/g) || []).length >= nipplesInSystem);
  // adapters consolidate: interface markers flank the hex body in ONE cell
  // with a combined size caption instead of three spread-out cells — in both
  // flow directions (flare▸NPT into valve bodies, NPT▸flare out of tees)
  check("adapter cells consolidated (end-pair caption, no 'Adapter' word)",
    (svg.match(/>[0-9]\/[0-9]&quot; flare ▸ [0-9]\/[0-9]&quot; NPT</g) || []).length >= 3 &&
    (svg.match(/>[0-9]\/[0-9]&quot; NPT ▸ [0-9]\/[0-9]&quot; flare</g) || []).length >= 2 &&
    !/>Adapter[ <]/.test(svg));
  check("no fraction glyphs — sizes written out", !/[⅜¼½⅛⅝]/.test(svg));
  check("no 'teed at F-' or 'from F-' marks", !svg.includes("teed at F") && !svg.includes("from F-"));
  check("tees marked with their exact type, thread designation off the cells",
    svg.includes("1/4 in + relief valve") && svg.includes(">F-7<") && svg.includes(">Flare tee, 3/8 in tube<") &&
    !/Tee, 1\/4 in [FM]NPT/.test(svg));
  check("take-off tees are flare tees; designations on their own line, no mfr numbers",
    svg.includes(">F-3<") && svg.includes(">F-6<") && (svg.match(/>Flare tee[,<]/g) || []).length >= 3 &&
    svg.includes(">SV-2<") && !svg.includes("B07N6246YB") && !svg.includes("04044-06"));
  check("parallel metered path closes through a copper flare link",
    bandChunks("L3").includes(">TB-10<"));
  check("solenoid joints flagged for thread check",
    (svg.match(/&quot; NPT\*/g) || []).length >= 6 &&
    store["legend"].innerHTML.includes("gauge-check on receipt"));
  check("accumulator hangs through the NGT boss adapter",
    app.refIndex.ngtAdapter !== undefined && store["partsTable"].innerHTML.includes("MNGT"));
  check("hoses labeled exactly, designation on its own row",
    svg.includes(">3/8&quot; LP-gas hose<") && svg.includes(">HS-2<"));
  const l3split = app.SYSTEM.lines.find(L => L.id === "L3").items.find(it => it.split).split;
  check("split metered path is needle-only (no solenoid in path b)",
    !(l3split.b || []).some(it => it.p && app.PARTS[it.p] && app.PARTS[it.p].sym === "sol"));
  check("NV-3 removed — rail metered by the split's needle alone", !svg.includes("NV-3"));
  // twin feed: both cylinder chains drawn (two POL glyphs, HS-1 twice plus
  // HS-2 = three hose squiggles in L1), labels and balloons only once
  // the squiggle glyph is shared by hoses AND tube runs, so its raw count is a
  // snapshot; what matters is two cylinder chains, each label drawn once
  check("both tank feed chains drawn, labeled once",
    (l1band.match(/l5 -8 6 16 5 -8/g) || []).length >= 3 &&
    (l1band.match(/r="3\.2"/g) || []).length === 2 &&
    (svg.match(/>HS-1</g) || []).length === 1);
  check("poofer discharge stick: 10 ft of 1/2\" Cu to an open pipe",
    svg.includes(">TB-6 × 10 ft<") && svg.includes(">Open pipe discharge<"));
  // overpressure protection: RV-1 relief on its own tee, downstream of the
  // check valve, upstream of the accumulator riser
  const l4b = app.SYSTEM.lines.find(L => L.id === "L4b");
  const idx = f => l4b.items.findIndex(f);
  check("RV-1 relief mounted downstream of CV-1, before the accumulator",
    app.refIndex.relief !== undefined &&
    idx(it => it.tag === "CV-1") < idx(it => it.tag === "F-15") &&
    idx(it => it.tag === "F-15") < idx(it => it.j === "riser") &&
    svg.includes(">F-15+RV-1<") && svg.includes("RV-1: set 75 psi"));
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
  L3.items.splice(L3.items.findIndex(it => it.split) + 1, 0,
    { p: "nptTee", tag: "F-T9", branch: { ref: "P2" }, note: "second standby tap" }, { j: "npt", size: "1/4", lr: "M>F" });
  o.SYSTEM.lines.push({ id: "L3c", title: "Second pilot", psi: "60 psi", op: 60,
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
  // supply-stack marker in hostile spots: a bare turn and a stack-only line
  o.SYSTEM.lines.push({ id: "T3", title: "Bare turn", psi: "1 psi", op: 1,
    items: [{ j: "turn" }, { p: "pilot", tag: "PL-V" }] });
  o.SYSTEM.lines.push({ id: "T4", title: "Stack-only line", psi: "1 psi", op: 1,
    items: [{ p: "ball14", tag: "V-S" }, { j: "turn" }] });
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
console.log("FORCED WRAP");
{
  // the serpentine machinery must still work when a root outgrows one row —
  // padded with valve/nipple pairs until it folds
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  const L1 = o.SYSTEM.lines.find(L => L.id === "L1");
  for (let i = 0; i < 8; i++)
    L1.items.splice(L1.items.length - 1, 0, { j: "npt", size: "1/4", part: "nipple14" }, { p: "ball14", tag: "V-W" + i });
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  const svg = store["strips"].children[0].innerHTML;
  const loops = [...svg.matchAll(/data-loop="[^"]*" data-y1="(-?[\d.]+)" data-y2="(-?[\d.]+)"/g)];
  const cls = new Set([...svg.matchAll(/data-cl="(-?[\d.]+)"/g)].map(m => m[1]));
  check("over-long root still folds exactly once", loops.length === 1, loops.length + " loops");
  check("the fold joins two row centerlines", loops.length === 1 && loops.every(m => cls.has(m[1]) && cls.has(m[2])));
  check("stack and fold coexist without text collisions", collisions(textBoxes(svg)).length === 0,
    collisions(textBoxes(svg)).slice(0, 3).join("; "));
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
    const L3b = o.SYSTEM.lines.find(L => L.id === "L3b");
    const i = L3b.items.findIndex(it => it.p === "mixer") - 1;
    L3b.items[i] = { j: "npt", size: "1/4", lr: "M>F" };
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
  // 6) a reversible adapter installed the wrong way round (rev flag dropped).
  // L4's rev'd half-union is gone — its branch now leaves F-7 as a flare cone
  // and the hose swivel lands straight on it — so seed L3b's, downstream of SV-3.
  let r6 = seed(o => {
    const L3b = o.SYSTEM.lines.find(L => L.id === "L3b");
    delete L3b.items.find(it => it.p === "flare14npt" && it.rev).rev;
  });
  check("catches an adapter installed backwards (rev dropped)",
    r6.issues.some(s => s.includes("NPT joint drawn on a flare end")), r6.issues.join("; "));
}

console.log("COMPLIANCE & PARTS TABLES");
{
  const { store } = loadApp();
  check("parts schedule populated", (store["partsTable"].innerHTML.match(/<tr>/g) || []).length > 15);
  check("compliance schedule populated", (store["compTable"].innerHTML.match(/<tr>/g) || []).length > 10);
  check("verification chips removed from the schedule",
    !store["partsTable"].innerHTML.includes("VERIFY PN") && !store["partsTable"].innerHTML.includes("SPEC VERIFIED") &&
    !store["partsTable"].innerHTML.includes("STATUS"));
  check("nipples & adapters reach the schedule via joint parts",
    store["partsTable"].innerHTML.includes("Hex nipple") && store["partsTable"].innerHTML.includes("half union"));
  check("field-only items present", store["compTable"].innerHTML.includes("FIELD"));
}

console.log("VIEW MODES (internal packet vs external submission)");
{
  const { store, app } = loadApp();
  const { PARTS } = app;
  const draw = () => store["strips"].children[0].innerHTML;
  const occ = (hay, needle) => hay.split(needle).length - 1;
  // parts actually drawn on the sheet
  const drawn = Object.keys(PARTS).filter(k => app.refIndex[k] !== undefined);
  // the RULE, stated here as the spec the renderer must satisfy
  const NO_RATING = new Set(["tee", "manifold", "hexAdapter", "none", "nozzle", "pilot"]);
  const CARRIES_PN = new Set(["sol", "needle", "check", "relief", "reg", "gauge", "tank"]);

  check("default view is external", app.INTERNAL() === false);
  const ext = draw();
  check("external draws no balloons", !/r="9\.5"/.test(ext));

  // NOTHING on the external sheet may key to an off-sheet schedule — not cells,
  // not band titles ("at PRV-1"), not run labels (TB-13), not notes. This swept
  // up a note citing compliance row "FE-8", which lives only in the HTML table.
  // CGA-510 is a thread standard, not a designation.
  const extText = [...ext.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join(" | ");
  const stray = [...new Set((extText.match(/\b[A-Z]{1,3}-\d+\b/g) || []).filter(x => x !== "CGA-510"))];
  check("external carries no equipment designation anywhere", stray.length === 0, stray.join(", "));
  check("stripping designations keeps the run's real information", ext.includes(">10 ft<"));

  // A bare catalog number identifies nothing, and an ASIN is a marketplace id,
  // not a manufacturer part number. Checked for EVERY number that reaches the
  // drawing, so a new part cannot slip through unlabelled.
  const shown = drawn.filter(k => PARTS[k].pn && PARTS[k].pn !== "—" && ext.includes(PARTS[k].pn));
  const badPn = shown.filter(k => {
    const p = PARTS[k], num = p.asin ? "ASIN " + p.pn : p.pn;
    return occ(ext, p.pn) !== occ(ext, `${p.mfg} ${num}`);
  });
  check("every part number on the drawing is preceded by its maker (ASINs labelled)",
    shown.length >= 4 && badPn.length === 0, badPn.join(", "));
  check("solenoids are the only parts still bought off a marketplace listing",
    drawn.filter(k => PARTS[k].asin).length === 2);
  // ...and the asin FLAG cannot silently go missing: anything sourced from a
  // marketplace must be flagged, or its listing id renders as if it were a
  // manufacturer catalog number ("Beduan B07N6246YB") and the wrong part is bought
  const marketplace = drawn.filter(k => /amazon/i.test(PARTS[k].vendor || ""));
  check("marketplace-sourced parts are flagged and render their id as an ASIN",
    marketplace.length > 0 && marketplace.every(k => PARTS[k].asin && ext.includes("ASIN " + PARTS[k].pn)),
    marketplace.filter(k => !PARTS[k].asin).join(", "));

  // ball valves state a rating but no maker/number (Marcus); the schedule keeps it
  check("ball valves carry no part number on the drawing, but the schedule does",
    !ext.includes("94A-101-01") && !ext.includes("Apollo") &&
    store["partsTable"].innerHTML.includes(">94A-101-01<"));

  // a rating means "this can fail at pressure". Solid brass fittings cannot, and
  // custom fabrications never had a sourced number. Checked over every part.
  const strayRating = drawn.filter(k => NO_RATING.has(PARTS[k].sym) && app.specLine(PARTS[k]) !== "");
  const missingRating = drawn.filter(k => !NO_RATING.has(PARTS[k].sym) && !/psi|no published rating/.test(app.specLine(PARTS[k])));
  check("fittings and custom fabrications print no rating", strayRating.length === 0, strayRating.join(", "));
  check("everything that can fail at pressure prints one", missingRating.length === 0, missingRating.join(", "));
  check("only PN_SYM parts print a part number",
    drawn.every(k => CARRIES_PN.has(PARTS[k].sym) || !/[A-Z]{2,}-?\d/.test(app.specLine(PARTS[k]))));

  // the accumulator is the most unusual component on the sheet and was rendering
  // as a bare "Tee + accumulator" until Marcus caught it
  check("the accumulator states its DOT spec and how it is plumbed",
    ext.includes("DOT 4BA240 · 250 psi") && ext.includes("NGT boss") &&
    ext.includes("no welds") && ext.includes("requal stamp expired"));

  // the external sheet must survive the same geometry invariants as the packet
  const eb = textBoxes(ext);
  check("external: all <text> parseable", !eb.some(b => b.malformed));
  check("external: no text inside rotated symbol groups", !eb.some(b => b.rot));
  const ebad = collisions(eb);
  check("external: zero text collisions anywhere on the sheet", ebad.length === 0, ebad.slice(0, 4).join("; "));
  check("external: no text clipped by the canvas edge", clippedByCanvas(ext, eb).length === 0);

  app.setView("internal");
  const int = draw();
  check("internal restores balloons and equipment designations",
    /r="9\.5"/.test(int) && int.includes(">F-15+RV-1<") && int.includes(">SV-2<"));
  check("internal hides mfr part numbers on the drawing", !int.includes("B07N6246YB"));
  const ibad = collisions(textBoxes(int));
  check("internal: zero text collisions anywhere on the sheet", ibad.length === 0, ibad.slice(0, 4).join("; "));
  check("switching back and forth is stable", (app.setView("external"), draw() === ext));
}

console.log("EXPORTED SVG IS SELF-CONTAINED");
{
  const { captured, app } = loadApp();
  app.downloadSVG();
  const svg = captured.svg;
  // the legend must ship inside the drawing — it is the only thing that
  // decodes the symbols once the sheet leaves this page
  check("export embeds the symbol legend",
    svg.includes("cone ▸ nut") && svg.includes("trapezoid ▸ box") && svg.includes("GENERAL NOTES"));
  check("export legend omits the balloon key in external view",
    !svg.includes("balloon: parts schedule ref"));
  check("export subtitle does not promise an off-sheet schedule",
    !svg.includes("see packet"));
  check("export is one <svg> and closes", svg.startsWith("<svg") && svg.trim().endsWith("</svg>"));

  app.setView("internal");
  app.downloadSVG();
  check("internal export legend restores the balloon key",
    captured.svg.includes("balloon: parts schedule ref"));
}

console.log("UNRATED PARTS (rating:null)");
{
  const { store, app } = loadApp();
  const strip = () => store["compTable"].innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Every default part is now rated (the Anderson Fittings catalog supplied the
  // needle valves' 150 psi), so the null path has to be exercised deliberately.
  check("default system: no part claims an unpublished rating",
    !strip().includes("No published pressure rating"));

  // null coerces to 0 in a `<` comparison, so an unrated part would silently
  // masquerade as "rated below segment pressure". It must read as unpublished.
  app.PARTS.ball14.rating = null;
  app.renderAll();
  check("an unrated part is named as unpublished, not as under-rated",
    strip().includes("No published pressure rating") &&
    strip().includes("V-1") &&
    !strip().includes("Rating below segment pressure"));
  check("an unrated part drops FE-2 to REVIEW", /FE-2[\s\S]{0,500}?REVIEW/.test(strip()));
  check("schedule prints 'not published' rather than 'null psi'",
    store["partsTable"].innerHTML.includes("not published") &&
    !store["partsTable"].innerHTML.includes("null psi"));
  check("the drawing says so too",
    store["strips"].children[0].innerHTML.includes("no published rating"));

  // ...and the fix must not mask a genuinely under-rated part
  app.PARTS.ball14.rating = 5;
  app.renderAll();
  check("a genuinely under-rated part is still caught",
    strip().includes("Rating below segment pressure") && strip().includes("V-1"));

  app.PARTS.ball14.rating = 600;
}

console.log("FLARE VALVES & THE POOFER TRAIN")
{
  const { app } = loadApp();
  const { PARTS, SYSTEM } = app;
  const line = id => SYSTEM.lines.find(l => l.id === id);
  // every item on a line, splits flattened
  const flat = id => line(id).items.flatMap(i => i.split ? [...i.split.a, ...i.split.b] : [i]);
  const buys = id => flat(id).filter(i => (i.p && PARTS[i.p] && PARTS[i.p].sym === "hexAdapter") ||
                                          (i.part && PARTS[i.part] && /nipple/i.test(PARTS[i.part].name)));
  const flareValves = Object.keys(PARTS).filter(k => PARTS[k].sym === "needle" && PARTS[k].ports.i.startsWith("flare:"));

  // THE point of a flare valve: the tube nut lands on its cone, so nothing sits
  // between the valve and the run. Quantified over every use, not spot-checked.
  const flanked = SYSTEM.lines.every(L => {
    const its = L.items.flatMap(i => i.split ? [...i.split.a, ...i.split.b] : [i]);
    return its.every((it, i) => !flareValves.includes(it.p) ||
      (its[i - 1] && its[i - 1].j === "flare" && !its[i - 1].part &&
       its[i + 1] && its[i + 1].j === "flare" && !its[i + 1].part));
  });
  check("every flare needle valve is flanked by bare flare joints", flanked);
  check("flare needle valves declare male cones both ends (or the linter's gender check is moot)",
    flareValves.length >= 2 && flareValves.every(k => PARTS[k].ports.i.endsWith(":M") && PARTS[k].ports.o.endsWith(":M")));

  // the two circuits the flare valves bought us
  check("the poofer pilot line buys no fittings at all", buys("L4a").length === 0);
  check("the split's metered path buys no fittings at all",
    line("L3").items.find(i => i.split).split.b.every(i => !i.p || flareValves.includes(i.p)));

  // a needle valve must out-rate whatever relief caps its zone if a regulator
  // fails, or the valve is the weak point on the line
  const reliefSets = SYSTEM.lines.flatMap(L => L.items)
    .map(it => it.mount || (it.tee && it.tee.mount)).filter(m => m && m.p === "relief")
    .map(m => +(/set (\d+) psi/.exec(m.note || "") || [0, 0])[1]);
  const maxRelief = Math.max(...reliefSets);
  check("every flare needle valve out-rates the highest relief setting that can cap it",
    reliefSets.length >= 2 && flareValves.every(k => PARTS[k].rating > maxRelief),
    `max relief ${maxRelief}`);

  // L4b's order is the design: CV-1 blocks backflow to the regulator; V-3 is an
  // e-stop upstream of the pilot tee so it cuts pilot AND accumulator together;
  // the pilot tees off between them and the accumulator so the vessel bleeds
  // down through the burning pilot on a normal shutdown. Move any one and you
  // break one of the other two properties.
  const l4b = line("L4b").items, at = f => l4b.findIndex(f);
  const iCheck = at(i => i.p === "check14"), iV3 = at(i => i.tag === "V-3"),
        iPilot = at(i => i.branch && i.branch.ref === "D"),
        iRelief = at(i => i.mount && i.mount.p === "relief"), iAccum = at(i => i.j === "riser");
  check("L4b order: check valve -> isolation valve -> pilot tee -> relief -> accumulator",
    iCheck >= 0 && iCheck < iV3 && iV3 < iPilot && iPilot < iRelief && iRelief < iAccum,
    `${iCheck} ${iV3} ${iPilot} ${iRelief} ${iAccum}`);
  check("the isolation valve that cuts the pilot is an emergency shut-off",
    l4b[iV3].emergency === true);
  check("the pilot tee screws into the check valve with no hex nipple",
    l4b[iPilot - 1].part === undefined && PARTS[l4b[iPilot].p].ports.i === "npt:1/4:M");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
