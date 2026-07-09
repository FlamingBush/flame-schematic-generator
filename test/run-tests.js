// Regression tests for fast_schematic_generator.html — run: node test/run-tests.js
//
// Every check here is exactly one of four kinds, and nothing else is allowed in:
//
//   1. A NAMED INVARIANT in test/invariants.js — quantified over data, and it
//      MUST have a paired mutation in test/mutants.js that turns it red. The
//      coverage gate fails the build otherwise. Run as the first block below.
//   2. A PORT-LINTER DEFECT CLASS, seeded through viaJSON() — these live in
//      test/mutants.js as mutations of `portLinterClean`.
//   3. A GEOMETRY OR STRUCTURAL CHECK — collisions, baselines, clipping,
//      escaping, balanced tags, no undefined/NaN, hostile-data survival. These
//      are renderer guarantees: no data mutation falsifies them, so they are
//      exempt from the mutation gate and stay inline here.
//   4. THE APPROVED SNAPSHOT (test/approved/drawing-{external,internal}.svg).
//      Rendering details live there, not in includes() calls.
//
// Refuse: a constant asserting itself (`PARTS.x.rating === 150`); a string
// pinned to incidental output (`svg.includes(">3/8 in tube (5/8-18 UNF)<")`).
// The tell that you got it wrong is hand-editing tests every time the design
// legitimately changes.
"use strict";
const { loadApp } = require("./harness");
const { textBoxes, rx, clippedByCanvas, collisions, bandChunks, textContents } = require("./geometry");
const { INVARIANTS, evaluateAll, eachItem } = require("./invariants");
const { VIEWS, goldenPath, goldenFor, summarize } = require("./golden");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, detail ? "— " + detail : ""); }
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const noUndefinedNaN = (s) => !/undefined|NaN/.test(s);
const xmlEscaped = (s) => ({
  bareAmp: (s.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g) || []).length,
  rawLt: (s.match(/<(?![a-zA-Z/!?])/g) || []).length,
});

/* ============================ 1. NAMED INVARIANTS ============================ */

console.log("INVARIANTS (each has a paired mutation in test/mutants.js)");
{
  const { store, app } = loadApp();
  const res = evaluateAll(app, store);
  INVARIANTS.forEach((inv) => check(inv.describe, res[inv.id].ok, res[inv.id].detail));
}

/* =========================== 4. APPROVED SNAPSHOT =========================== */

console.log("\nAPPROVED DRAWINGS (golden — regenerate with: npm run approve)");
{
  VIEWS.forEach((view) => {
    const file = goldenPath(view);
    if (!fs.existsSync(file)) {
      check(`${view} drawing has an approved snapshot`, false, "missing — run: npm run approve");
      return;
    }
    const prev = fs.readFileSync(file, "utf8");
    const next = goldenFor(view);
    if (prev === next) { check(`${view} drawing matches the approved snapshot`, true); return; }
    const { report } = summarize(prev, next, { label: view, maxHunks: 8 });
    check(`${view} drawing matches the approved snapshot`, false,
      "\n" + report + "\n    If intentional: `npm run approve`, then LOOK at the PNG it renders.");
  });
}

/* ================= 3. GEOMETRY & STRUCTURE (renderer guarantees) ================= */

console.log("\nLAYOUT & GEOMETRY (internal view)");
{
  const { store, app } = loadApp();
  app.setView("internal");
  const SYSTEM = app.getSYSTEM(), PARTS = app.getPARTS();
  const hosts = store["strips"].children;
  check("one combined svg", hosts.length === 1 && /<svg /.test(hosts[0].innerHTML));
  const svg = hosts[0].innerHTML;
  const chunks = (id) => bandChunks(svg, id);

  // a chained segment renders inside its host's band, not as its own strip
  const hostOf = {};
  Object.entries(app.TREE.chain).forEach(([host, segs]) => segs.forEach((s) => (hostOf[s.id] = host)));
  const bandIdFor = (id) => hostOf[id] || id;
  const chained = Object.values(app.TREE.chain).flatMap((segs) => segs.slice(1).map((s) => s.id));

  check("every line rendered (band, chain seam, or orphan strip)", SYSTEM.lines.every((L) =>
    chained.includes(L.id) || svg.includes(`data-band="${L.id}"`)));
  check("default system: root band carries supply; only the shared tip run is unrooted",
    !!app.TREE.root && app.TREE.orphans.length === 1 && app.TREE.orphans[0].id === "L3r" &&
    svg.includes(`data-band="${app.TREE.root.id}"`));

  // every chained segment draws a seam and never a band of its own
  const seamBad = chained.filter((id) => !svg.includes(`data-merged="${id}"`) || svg.includes(`data-band="${id}"`));
  check("every chained segment renders as a seam inside its host band", chained.length > 0 && seamBad.length === 0,
    seamBad.join(", "));

  // the supply stack absorbs the run's length: the default sheet fits in one
  // row with NO fold. Over-long roots still serpentine exactly once — that
  // path is exercised by the FORCED WRAP section below.
  const loops = [...svg.matchAll(/data-loop="[^"]*" data-y1="(-?[\d.]+)" data-y2="(-?[\d.]+)"/g)];
  check("default sheet needs no fold (supply stack absorbs the length)", loops.length === 0, loops.length + " loops");
  check("branch bands never wrap (no data-row outside the root)",
    [...svg.matchAll(/data-band="([^"]*)"[^>]*data-row=/g)].every((m) => m[1] === app.TREE.root.id));

  // vertical constructs, quantified over the lines that declare them
  const risers = SYSTEM.lines.filter((L) => L.items.some((it) => it.j === "riser"));
  const badRiser = risers.filter((L) => {
    const b = chunks(bandIdFor(L.id));
    return !(b.includes('class="tcell"') && b.includes("rotate(-90)"));
  });
  check("every discharge riser draws a tcell mini-grid with rotate(-90) symbols",
    risers.length > 0 && badRiser.length === 0, badRiser.map((L) => L.id).join(", "));

  // Every cell of a supply stack sits BELOW the centerline, and the stack draws
  // at least one cell per part ahead of the turn. Derived from the data, not a
  // pinned cell count — the stack legitimately shortens when a run is respecced.
  const stacks = SYSTEM.lines.filter((L) => L.items.some((it) => it.j === "turn"));
  const badStack = stacks.filter((L) => {
    const ys = [...chunks(bandIdFor(L.id)).matchAll(/class="tcell" data-y="(-?[\d.]+)"/g)].map((m) => +m[1]);
    const parts = L.items.slice(0, L.items.findIndex((it) => it.j === "turn")).filter((it) => it.p).length;
    return !(ys.length >= parts && ys.length > 0 && ys.every((y) => y > app.CL));
  });
  check("every supply stack opens vertical (one cell per part, all below the centerline)",
    stacks.length > 0 && badStack.length === 0, badStack.map((L) => L.id).join(", "));

  // the pocket beside the stack is real estate: branch bands tuck up into it
  const stackYs = [...chunks("L1").matchAll(/class="tcell" data-y="(-?[\d.]+)"/g)].map((m) => +m[1]);
  const bandY = (id) => { const m = svg.match(new RegExp(`data-band="${id}"[^>]*transform="translate\\((-?[\\d.]+) (-?[\\d.]+)\\)"`)); return m ? +m[2] : null; };
  check("branch bands tuck into the pocket beside the stack",
    bandY("L4") !== null && bandY("L4") < bandY("L1") + Math.max(...stackYs));
  // ...and the stack segment's dashed box notches into an L so the pocket
  // stays outside it — a <path> box rather than a <rect>, one per stack
  check("the stack segment's box notches (an L-shaped path, not a rectangle)",
    (svg.match(/<path [^>]*stroke-dasharray="7 4"/g) || []).length === stacks.length);

  // splits render a parallel metered strip one row below
  const splits = SYSTEM.lines.filter((L) => L.items.some((it) => it.split));
  const badSplit = splits.filter((L) => !chunks(bandIdFor(L.id)).includes(`data-par="${L.id}"`));
  check("every split draws its parallel metered strip", splits.length > 0 && badSplit.length === 0,
    badSplit.map((L) => L.id).join(", "));

  // SYMBOL PHYSICS: manifold outlets leave the body's right face onto one x —
  // the continuing run is one of them, so none may sprout from another face
  const man = app.SYM.manifold(0, { w: 4 }, {});
  // lazy + leading \s, or the greedy form matches stroke-width="1.6"
  const rect = /<rect x="(-?[\d.]+)"[^>]*?\swidth="([\d.]+)"/.exec(man);
  const rightFace = +rect[1] + +rect[2];
  const stubs = [...man.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g)];
  check("manifold outlets fan from the body's right face onto one common x",
    stubs.length >= 2 && stubs.every((s) => Math.abs(+s[1] - rightFace) <= 2 && +s[3] > rightFace) &&
    new Set(stubs.map((s) => s[3])).size === 1);
  check("partless NPT glyph mirrors when the female port is upstream",
    app.jointMarker({ j: "npt" }, 50).includes("scale(-1,1)") && !app.jointMarker({ j: "npt", lr: "M>F" }, 50).includes("scale(-1,1)"));
  check("symbols are text-free (rotatable)", Object.keys(app.SYM).every((k) => !/<text/.test(app.SYM[k](0, { w: 3, h: 3 }, {}))));

  // a hex nipple glyph for every nipple part in SYSTEM (the glyph's center hex
  // body is the unique 6x12 white rect) — tied to the data, never re-pinned
  let nipples = 0;
  eachItem(SYSTEM, (it) => { if (it.part && /nipple/i.test((PARTS[it.part] || {}).name || "")) nipples++; });
  check("a hex nipple is drawn at every female-to-female NPT junction",
    nipples > 0 && (svg.match(/width="6" height="12"/g) || []).length >= nipples, `${nipples} nipples in SYSTEM`);

  // adapters consolidate: interface markers flank the hex body in ONE cell with
  // a combined "A ▸ B" caption, never three spread-out cells carrying a name
  let adapters = 0;
  eachItem(SYSTEM, (it) => { if (it.p && (PARTS[it.p] || {}).sym === "hexAdapter") adapters++; });
  const pairCaptions = (svg.match(/ ▸ /g) || []).length;
  check("adapter cells consolidate into one end-pair caption, with no 'Adapter' name",
    adapters > 0 && pairCaptions >= adapters && !/>Adapter[ <]/.test(svg), `${adapters} adapters, ${pairCaptions} captions`);

  // an xn:n cell repeats the symbol but is identified ONCE
  const xn = [];
  eachItem(SYSTEM, (it) => { if (it.xn > 1 && it.tag) xn.push(it.tag); });
  const xnBad = xn.filter((t) => (svg.match(new RegExp(`>${rx(esc(t))}<`, "g")) || []).length !== 1);
  check("a repeated (xn) cell draws its identification exactly once", xn.length > 0 && xnBad.length === 0, xnBad.join(", "));

  // every emergency:true item carries the orange callout, and only those
  const flagged = SYSTEM.lines.flatMap((L) => L.items).filter((it) => it.emergency);
  check("every emergency:true valve carries the orange callout, and only those",
    flagged.length > 0 && (svg.match(/EMERGENCY FUEL SHUT-OFF/g) || []).length === flagged.length,
    `${flagged.length} flagged: ${flagged.map((f) => f.tag).join(", ")}`);

  // a fan edge's badge states the branch count the DATA declares
  app.TREE.edges.filter((e) => e.kind === "end").forEach((e) =>
    check(`fan ${e.ref}: badge states the ${e.fan} branches the data declares`,
      svg.includes(`one of ${e.fan} identical branches`)));

  // a ref with MULTIPLE producers is a deliberate idiom, not an error: every
  // port marked with it renders the plain pentagon, the consumer renders once
  const prod = {}, cons = {};
  eachItem(SYSTEM, (it) => {
    if (it.branch && it.branch.ref) prod[it.branch.ref] = (prod[it.branch.ref] || 0) + 1;
    if (it.j === "off" && it.dir === "out") prod[it.ref] = (prod[it.ref] || 0) + 1;
    if (it.j === "off" && it.dir === "in") cons[it.ref] = (cons[it.ref] || 0) + 1;
  });
  const multi = Object.keys(prod).filter((r) => prod[r] > 1);
  const multiBad = multi.filter((r) => (svg.match(new RegExp(`>${rx(esc(r))}<`, "g")) || []).length !== prod[r] + (cons[r] || 0));
  check("multi-producer refs render one pentagon per port plus one consumer mark",
    multi.length > 0 && multiBad.length === 0, multiBad.join(", "));

  // connectors: every drop edge draws exactly one connector whose y equals the
  // destination band's centerline; a fan (end) edge instead breaks into a
  // labeled pentagon PAIR — a drawn route would read as a second loop-back
  app.TREE.edges.forEach((e) => {
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

  // PIPE STYLING: colour and width encode material. Orange belongs to flame
  // heads and marked e-stops, so no run line may borrow it, and every colour a
  // run line actually uses must be decoded by the legend — a colour is not
  // self-apparent the way a glyph is.
  const HOSE_C = "#334E68", COPPER_C = "#8C5A2B", FLAME_C = "#C6480A", INKC = "#1F2933", INK2C = "#52606D";
  const hoses = [], tubes = [];
  eachItem(SYSTEM, (it) => { if (it.j === "hose") hoses.push(it); if (it.j === "tube") tubes.push(it); });
  const widthsFor = (colour) => [...new Set([...svg.matchAll(new RegExp(`stroke="${colour}" stroke-width="([\\d.]+)"`, "g"))].map((m) => +m[1]))];
  const hoseW = widthsFor(HOSE_C), copperW = widthsFor(COPPER_C);
  check("hose runs draw in the hose colour, on a single width", hoses.length > 0 && hoseW.length === 1, hoseW.join(","));
  // Width tracks BORE. Derived from the sizes SYSTEM actually declares, never a
  // pinned px value — the widths are a visual choice and will be tuned.
  const bore = (s) => { const [n, d] = String(s).split("/").map(Number); return d ? n / d : n; };
  const sizes = [...new Set(tubes.map((it) => it.size))].sort((a, b) => bore(a) - bore(b));
  check("copper runs draw in the copper colour, one width per bore",
    tubes.length > 0 && copperW.length === sizes.length,
    `${sizes.length} bores (${sizes}) vs ${copperW.length} widths (${copperW})`);
  check("copper line width increases with bore", copperW.slice().sort((a, b) => a - b).every((w, i, a) => i === 0 || a[i - 1] < w));
  // ...and no copper width sits so close to the hose that a BLACK-AND-WHITE
  // print of the packet cannot tell the flexible weak point from rigid tube.
  // The hose need not be fattest (Marcus), but it must be separable.
  check("every copper width is separable from the hose width on a B/W print",
    hoseW.length === 1 && copperW.every((w) => Math.abs(w - hoseW[0]) >= 0.5),
    `hose ${hoseW} vs copper ${copperW}`);
  // Palette guard: every stroke on the sheet is one of the five documented
  // colours. A rogue colour means someone invented a meaning nothing decodes.
  // (Flame orange legitimately strokes flame-head glyphs and e-stop levers, so
  // it cannot be excluded by width — enumerate the palette instead.)
  const PALETTE = new Set([INKC, INK2C, FLAME_C, HOSE_C, COPPER_C, "#fff"]);
  const strokes = new Set([...svg.matchAll(/stroke="(#[0-9A-Fa-f]{3,6})"/g)].map((m) => m[1]));
  const rogue = [...strokes].filter((c) => !PALETTE.has(c));
  check("every stroke colour on the sheet is one the legend can decode", rogue.length === 0, rogue.join(", "));
  const legend = app.legendLines().join(" ");
  check("the legend decodes every pipe colour the drawing uses",
    /hose/i.test(legend) && /copper tube/i.test(legend) && /brass/i.test(legend));

  check("dashed line boxes drawn (one per line segment per row)",
    (svg.match(/stroke-dasharray="7 4"/g) || []).length >= SYSTEM.lines.length);
  check("no fraction glyphs — sizes written out", !textContents(svg).some((t) => /[⅜¼½⅛⅝]/.test(t)));
  check("no undefined/NaN in the drawing", noUndefinedNaN(svg));

  /* --- text geometry: the invariants the sheet lives or dies by --- */
  const boxes = textBoxes(svg);
  check("all <text> elements parseable", !boxes.some((b) => b.malformed), (boxes.find((b) => b.malformed) || {}).malformed);
  check("no text inside rotated symbol groups", !boxes.some((b) => b.rot));

  const bandRows = new Set([app.ROW.balloon + 3.5, app.ROW.jTop, app.ROW.jBot, app.ROW.tag, app.ROW.n1, app.ROW.n2, app.ROW.n3, app.ROW.n4, app.CL + 3.5, 8]);
  const trunkOffs = new Set(Object.values(app.TROW));
  let offGrid = 0, homeless = 0; const offDetail = [];
  boxes.forEach((b) => {
    if (b.malformed) return;
    if (b.band) { if (![...bandRows].some((r) => Math.abs(r - b.localY) < 0.01)) { offGrid++; offDetail.push(b.s + "@band:" + b.localY); } }
    else if (b.cellY !== null) { const o = b.localY - b.cellY; if (![...trunkOffs].some((r) => Math.abs(r - o) < 0.01)) { offGrid++; offDetail.push(b.s + "@trunk:" + o); } }
    else { homeless++; offDetail.push("homeless:" + b.s); }
  });
  check("every text baseline on a band row or riser mini-grid row", offGrid === 0, offDetail.slice(0, 4).join("; "));
  check("every text inside a band/strip/tcell group", homeless === 0, offDetail.slice(0, 4).join("; "));

  const bad = collisions(boxes);
  check("zero text collisions anywhere on the sheet", bad.length === 0, bad.slice(0, 4).join("; "));
  const clip = clippedByCanvas(svg, boxes);
  check("no text clipped by the canvas edge", clip.length === 0, clip.slice(0, 3).join("; "));
}

console.log("\nVIEW MODES (internal packet vs external submission)");
{
  const { store, app } = loadApp();
  const draw = () => store["strips"].children[0].innerHTML;
  const SYSTEM = app.getSYSTEM(), PARTS = app.getPARTS(), refIndex = app.getRefIndex();
  const drawn = Object.keys(PARTS).filter((k) => refIndex[k] !== undefined);

  check("default view is external", app.INTERNAL() === false);
  const ext = draw();

  // deTag strips a leading designation from a run label; whatever the label
  // says AFTER it must survive ("TB-6 × 10 ft" -> "10 ft")
  const remainders = [];
  eachItem(SYSTEM, (it) => {
    const m = it.label && /^[A-Z]{1,3}-\d+\s*×\s*(.+)$/.exec(it.label);
    if (m) remainders.push(m[1]);
  });
  check("stripping designations keeps the run's real information",
    remainders.length > 0 && remainders.every((t) => ext.includes(`>${esc(t)}<`)), remainders.join(", "));

  // A rating means "this can fail at pressure". Solid-brass fittings cannot,
  // and custom fabrications never had a sourced number. Swept over every drawn
  // part against the APP's OWN sets — a local copy would silently drift.
  const strayRating = drawn.filter((k) => app.NO_RATING_SYM.has(PARTS[k].sym) && app.specLine(PARTS[k]) !== "");
  const missingRating = drawn.filter((k) => !app.NO_RATING_SYM.has(PARTS[k].sym) && !/psi|no published rating/.test(app.specLine(PARTS[k])));
  check("fittings and custom fabrications print no rating", strayRating.length === 0, strayRating.join(", "));
  check("everything that can fail at pressure prints one", missingRating.length === 0, missingRating.join(", "));
  check("no part number reaches the drawing outside PN_SYM",
    drawn.every((k) => app.PN_SYM.has(PARTS[k].sym) || !/[A-Z]{2,}-?\d/.test(app.specLine(PARTS[k]))));

  // the external sheet must survive the same geometry invariants as the packet
  const eb = textBoxes(ext);
  check("external: all <text> parseable", !eb.some((b) => b.malformed));
  check("external: no text inside rotated symbol groups", !eb.some((b) => b.rot));
  check("external: zero text collisions anywhere on the sheet", collisions(eb).length === 0, collisions(eb).slice(0, 4).join("; "));
  check("external: no text clipped by the canvas edge", clippedByCanvas(ext, eb).length === 0);
  check("no undefined/NaN in the external drawing", noUndefinedNaN(ext));

  app.setView("internal");
  const int = draw();
  const balloons = (s) => (s.match(/r="9\.5"/g) || []).length;
  check("balloons key cells to the schedule in the internal packet, and nowhere else",
    balloons(ext) === 0 && balloons(int) > 0, `external ${balloons(ext)}, internal ${balloons(int)}`);

  // the internal packet identifies each cell by its equipment designation
  const plainTags = [];
  eachItem(SYSTEM, (it) => { if (it.tag && !it.mount) plainTags.push(it.tag); });
  const missingTag = plainTags.filter((t) => !int.includes(`>${esc(t)}<`));
  check("the internal packet identifies every cell by its equipment designation",
    plainTags.length > 0 && missingTag.length === 0, missingTag.join(", "));

  check("internal: zero text collisions anywhere on the sheet", collisions(textBoxes(int)).length === 0);
  check("switching back and forth is stable", (app.setView("external"), draw() === ext));
}

console.log("\nSVG EXPORT");
{
  const { captured, app } = loadApp();
  app.downloadSVG();
  check("export produced", !!captured.svg && captured.svg.length > 1000);
  check("no undefined/NaN in export", noUndefinedNaN(captured.svg));
  // XML well-formedness essentials without a parser dependency (the strict
  // check is scripts/validate_svg.py, which consumes the file written below)
  const { bareAmp, rawLt } = xmlEscaped(captured.svg);
  check("export: no unescaped & (strict XML)", bareAmp === 0, bareAmp + " found");
  check("export: no stray < (strict XML)", rawLt === 0);
  const opens = (captured.svg.match(/<text[\s>]/g) || []).length;
  const closes = (captured.svg.match(/<\/text>/g) || []).length;
  check("balanced <text> tags", opens === closes, opens + " vs " + closes);
  // the w/h proportions in PARTS are visual only — the sheet must never claim scale
  check("no scale claims in export", !/relative scale|px = 1 in/.test(captured.svg));
  fs.writeFileSync(path.join(__dirname, "export.svg"), captured.svg);
  console.log("    (export written to test/export.svg — validate strictly with: python3 scripts/validate_svg.py)");
}

console.log("\nEXPORTED SVG IS SELF-CONTAINED");
{
  const { captured, app } = loadApp();
  // the legend must ship inside the drawing — it is the only thing that decodes
  // the symbols once the sheet leaves this page. Swept over EVERY legend line
  // rather than spot-checking three of them.
  const missingIn = (svg) => app.legendLines().filter((l) => !svg.includes(esc(l)));
  app.downloadSVG();
  const ext = captured.svg;
  check("external export embeds every legend line", missingIn(ext).length === 0, missingIn(ext).join(" | ").slice(0, 120));
  check("external export carries the general notes", ext.includes(esc(app.generalNotes())));
  check("export is one <svg> and closes", ext.startsWith("<svg") && ext.trim().endsWith("</svg>"));
  // The drawing is declared not to scale everywhere on purpose: the w/h
  // proportions in PARTS are visual only.
  check("external export still declares itself not to scale", /not to scale/.test(ext));
  // The submitted sheet is read on its own. It may not name a document the
  // reviewer does not hold — not even to disclaim it. Swept as a vocabulary,
  // so a new subtitle or legend line cannot quietly reintroduce one.
  const OFF_SHEET = /see packet|off-sheet|parts schedule|balloon/i;
  const offSheet = OFF_SHEET.exec(ext);
  check("external export names no off-sheet document (schedule, packet, balloons)",
    !offSheet, offSheet && `"${offSheet[0]}" — a reviewer holding only this SVG cannot see it`);
  // ...and the submitted legend carries only what the drawing CANNOT say about
  // itself: the pipe colours (a colour is not self-apparent) and the flow
  // orientation. The glyphs, the dashed line boxes and the orange highlight
  // read themselves (Marcus), so none of them earn a line.
  const extLegend = app.legendLines().join(" | ");
  check("external legend carries only the pipe key and the flow orientation",
    /line style/.test(extLegend) && /supply rises/.test(extLegend) &&
    !/pentagon|trapezoid|cone ▸ nut|dashed box|balloon/i.test(extLegend),
    extLegend.slice(0, 90));

  app.setView("internal");
  app.downloadSVG();
  const int = captured.svg;
  check("internal export embeds every legend line", missingIn(int).length === 0, missingIn(int).join(" | ").slice(0, 120));
  check("internal export carries the same general notes", int.includes(esc(app.generalNotes())));
  check("internal export still declares itself not to scale", /not to scale/.test(int));
  // the working packet keeps the full key — its balloons genuinely need decoding
  check("the balloon key ships only where balloons are drawn", int.includes("balloon: parts schedule ref"));
  const intLegend = app.legendLines().join(" | ");
  check("internal legend keeps the full symbol key the external sheet drops",
    /pentagon/i.test(intLegend) && /trapezoid/i.test(intLegend) && /line style/.test(intLegend));
}

console.log("\nPORT LINTER COVERAGE");
{
  // The linter's VERDICT is invariant `portLinterClean`, and the six hand-found
  // defect classes are its mutations in test/mutants.js. What stays here is the
  // structural claim that the walk actually reaches the whole system.
  const { app } = loadApp();
  const r = app.lintPorts();
  check("meaningful coverage (checked many, skipped only customs)", r.checked >= 40 && r.skipped > 0 && r.skipped < 20,
    `checked ${r.checked}, skipped ${r.skipped}`);
}

console.log("\nCOMPLIANCE & PARTS TABLES");
{
  const { store } = loadApp();
  check("parts schedule populated", (store["partsTable"].innerHTML.match(/<tr>/g) || []).length > 15);
  check("compliance schedule populated", (store["compTable"].innerHTML.match(/<tr>/g) || []).length > 10);
  check("field-only items present", store["compTable"].innerHTML.includes("FIELD"));
}

console.log("\nEDITOR ROUND TRIP");
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
  // the badge states the count the DATA declares, not a literal 3
  const fanEdge = app.TREE.edges.find((e) => e.kind === "end");
  check("fan survives the JSON round trip (one-of-n badge, n from the data)",
    !!fanEdge && svg.includes(`one of ${fanEdge.fan} identical branches`));
  check("hostile project name escaped in meta", !store["docMeta"].innerHTML.includes("<script>"));
  const bad = collisions(textBoxes(svg));
  check("still zero text collisions after edit", bad.length === 0, bad.slice(0, 4).join("; "));
  box.value = "{not json";
  app.applyJSON();
  check("malformed JSON reported, no crash", store["jsonMsg"].textContent.startsWith("JSON error"));
}

console.log("\nMULTI-BRANCH & HOSTILE DATA");
{
  const { store, captured, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  // second matched tap on L3, downstream of the split (the corridor-crossing regression)
  const L3 = o.SYSTEM.lines.find((L) => L.id === "L3");
  L3.items.splice(L3.items.findIndex((it) => it.split) + 1, 0,
    { p: "nptTee", tag: "F-T9", branch: { ref: "P2" }, note: "second standby tap" }, { j: "npt", size: "1/4", lr: "M>F" });
  o.SYSTEM.lines.push({ id: "L3c", title: "Second pilot", psi: "60 psi", op: 60,
    items: [{ j: "off", ref: "P2", dir: "in", label: "from F-T9" }, { j: "tube", part: "cu38", size: "3/8", label: "TB-9" }, { p: "pilot", tag: "PL-9", flame: true }] });
  // mid-trunk off-out (must NOT terminate the run)
  const L1 = o.SYSTEM.lines.find((L) => L.id === "L1");
  L1.items.splice(L1.items.length - 2, 0, { j: "off", ref: "Q", dir: "out", label: "aux port (future)" });
  // mount cell directly followed by a left-stub cell (balloon adjacency regression)
  L1.items.splice(L1.items.findIndex((it) => it.tag === "F-5") + 1, 0,
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
    .forEach((m) => { (rows[m[1]] = rows[m[1]] || []).push({ cl: +m[2], w: +m[3], x: +m[4], y: +m[5] }); });
  app.TREE.edges.filter((e) => e.kind === "drop").forEach((e) => {
    // every drop connector leaves straight DOWN from its tee: M x cl V ...
    const m = svg.match(new RegExp(`data-conn="${rx(e.ref)}" data-cly="(-?[\\d.]+)" d="M(-?[\\d.]+) (-?[\\d.]+) V(-?[\\d.]+)`));
    check(`drop ${e.ref}: leaves straight down from its tee, at a host row centerline`,
      !!m && (rows[e.from.id] || []).some((r) => r.cl === +m[3]),
      m && `starts ${m[3]} vs cls ${(rows[e.from.id] || []).map((r) => r.cl).join("/")}`);
    // the initial vertical segment must not slice any strip other than its
    // host's (last-row drops descend all the way into their band; earlier-row
    // drops descend only into their own row gap before jogging left)
    const cross = m ? Object.entries(rows).filter(([id, rs]) =>
      id !== e.from.id && id !== e.to.id && rs.some((r) =>
        +m[2] >= r.x && +m[2] <= r.x + r.w &&
        Math.min(+m[3], +m[4]) < r.y + app.STRIP_H && Math.max(+m[3], +m[4]) > r.y + 1)).map(([id]) => id) : ["no-path"];
    check(`drop ${e.ref}: descent clears sibling strips`, !!m && cross.length === 0, cross.join(","));
  });
  const clip = clippedByCanvas(svg, textBoxes(svg));
  check("long orphan title not clipped by canvas", clip.length === 0, clip.slice(0, 3).join("; "));
  check("mid-run off renders as pentagon stub, run continues", svg.includes(">Q<"));
  check("quoted line id escaped in attributes", svg.includes('data-band="Z&quot;9"'));
  check("no undefined/NaN on hostile data", noUndefinedNaN(svg));
  app.downloadSVG();
  check("hostile export: still no unescaped &", xmlEscaped(captured.svg).bareAmp === 0);
  check("hostile export: quoted attr intact", captured.svg.includes('data-band="Z&quot;9"'));
  const bad = collisions(textBoxes(svg));
  check("hostile render: zero text collisions", bad.length === 0, bad.slice(0, 3).join("; "));
}

console.log("\nFORCED WRAP");
{
  // the serpentine machinery must still work when a root outgrows one row —
  // padded with valve/nipple pairs until it folds
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  const L1 = o.SYSTEM.lines.find((L) => L.id === "L1");
  for (let i = 0; i < 8; i++)
    L1.items.splice(L1.items.length - 1, 0, { j: "npt", size: "1/4", part: "nipple14" }, { p: "ball14", tag: "V-W" + i });
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  const svg = store["strips"].children[0].innerHTML;
  const loops = [...svg.matchAll(/data-loop="[^"]*" data-y1="(-?[\d.]+)" data-y2="(-?[\d.]+)"/g)];
  const cls = new Set([...svg.matchAll(/data-cl="(-?[\d.]+)"/g)].map((m) => m[1]));
  check("over-long root still folds exactly once", loops.length === 1, loops.length + " loops");
  check("the fold joins two row centerlines", loops.length === 1 && loops.every((m) => cls.has(m[1]) && cls.has(m[2])));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
