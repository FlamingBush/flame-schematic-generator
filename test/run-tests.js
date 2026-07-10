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
const { textBoxes, rx, clippedByCanvas, collisions, bandChunks, textContents, bandBox } = require("./geometry");
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
  check("one preview svg holding every sheet", hosts.length === 1 && /<svg /.test(hosts[0].innerHTML));
  const svg = hosts[0].innerHTML;
  const chunks = (id) => bandChunks(svg, id);

  // The drawing is a SET OF SHEETS. app.SHEETS is what the renderer drew;
  // app.TREE is not — lintPorts() re-derives it over the whole system straight
  // after every render, so its edges describe the system, not the picture.
  const SH = app.SHEETS;
  check("every sheet drawn, each with a root band", SH.length === SYSTEM.sheets.length &&
    SH.every((sh) => sh.root) && (svg.match(/class="sheet"/g) || []).length === SH.length,
    SH.map((sh) => sh.id + ":" + (sh.root && sh.root.id)).join(" "));
  check("every sheet's lines are drawn on that sheet, and no line is drawn twice",
    SYSTEM.lines.every((L) => SH.filter((sh) => sh.lines.includes(L)).length === 1));

  // a chained segment renders inside its host's band, not as its own strip
  const hostOf = {};
  SH.forEach((sh) => Object.entries(sh.chain).forEach(([host, segs]) => segs.forEach((x) => (hostOf[x.id] = host))));
  const bandIdFor = (id) => hostOf[id] || id;
  const chained = SH.flatMap((sh) => Object.values(sh.chain).flatMap((segs) => segs.slice(1).map((x) => x.id)));

  check("every line rendered (band, chain seam, or orphan strip)", SYSTEM.lines.every((L) =>
    chained.includes(L.id) || svg.includes(`data-band="${L.id}"`)));
  // A CHAIN CANNOT CROSS A SHEET. L1+L2 used to read as one run; they are now on
  // sheets 1 and 3, so that seam is gone and B is an off-page pentagon instead.
  check("no chain spans two sheets", chained.every((id) =>
    SH.some((sh) => sh.lines.some((L) => L.id === id) && Object.values(sh.chain).flat().some((x) => x.id === id))));
  const orphans = SH.flatMap((sh) => sh.orphans.map((o) => o.id));
  check("only the shared tip run is unrooted", orphans.length === 1 && orphans[0] === "L3c", orphans.join(","));

  // A chained segment draws a seam and never a band of its own. The DEFAULT
  // sheeting no longer chains anywhere: L1+L2 and L3+L3a were split by sheets
  // already, and L1b+L1c went the same way when L1b joined sheet 1. So this holds
  // vacuously here, and the seam machinery is exercised on a synthetic sheeting
  // in SEAM MACHINERY below — the way FORCED WRAP keeps the fold alive.
  const seamBad = chained.filter((id) => !svg.includes(`data-merged="${id}"`) || svg.includes(`data-band="${id}"`));
  check("any chained segment renders as a seam inside its host band", seamBad.length === 0, seamBad.join(", "));
  check("no chain survives the default sheeting (a chain cannot cross a sheet)",
    chained.length === 0, chained.join(", "));

  // A sheet declaring `fold:true` serpentines its root ONCE; every other sheet
  // fits in one row. Grounded in the sheet definitions, not in a loop count, so
  // folding a different sheet does not silently make this vacuous.
  const loops = [...svg.matchAll(/data-loop="[^"]*" data-y1="(-?[\d.]+)" data-y2="(-?[\d.]+)"/g)];
  const folded = SH.filter((sh) => sh.fold).length;
  check("exactly the sheets that declare fold serpentine, once each",
    loops.length === folded, `${loops.length} loops vs ${folded} folded sheets`);
  const cls = new Set([...svg.matchAll(/data-cl="(-?[\d.]+)"/g)].map((m) => m[1]));
  check("every fold joins two row centerlines", loops.every((m) => cls.has(m[1]) && cls.has(m[2])));
  // a wrapped band belongs to the sheet that declared the fold, and to no other
  const wrapped = [...new Set([...svg.matchAll(/data-band="([^"]*)"[^>]*data-row=/g)].map((m) => m[1]))];
  check("branch bands never wrap (only a folded sheet's root does)",
    wrapped.every((id) => SH.some((sh) => sh.fold && sh.root && sh.root.id === id)),
    wrapped.join(","));

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

  // A drop band must never draw THROUGH the supply stack. It either clears the
  // stack vertically or tucks into the pocket to its right — which of the two is
  // a layout outcome (a folded sheet pushes the drop's tee into row 1, below the
  // stack), so pinning "it tucks" would pin a fold setting. The POCKET block
  // below proves the tuck on the layout that produces it.
  // Measured inside ONE sheet's coordinate space. This check used to compare
  // L1b's band against L1's while they sat on DIFFERENT sheets, both starting at
  // y=0 — it was reading two pages at once and passing on nonsense.
  const sheetOf = (id) => SH.find((sh) => sh.lines.some((L) => L.id === id));
  check("a drop band never draws through the supply stack",
    (() => {
      const sh = sheetOf("L1");
      const b = (id) => bandBox(sh.inner, id);
      const l1 = b("L1"), l4 = b("L1b");
      if (!l1 || !l4 || l1.stackX == null) return false;
      const ys = [...bandChunks(sh.inner, "L1").matchAll(/class="tcell" data-y="(-?[\d.]+)"/g)].map((m) => +m[1]);
      return l4.y >= l1.y + Math.max(...ys) || l4.x >= l1.x + l1.stackX;
    })());
  // ...and NO drop connector's descent crosses the stack either. The connector
  // used to start at `absX + tee.cx`, dropping the row's pocket indent, so on a
  // folded sheet it fell a whole pocket-width LEFT of its own tee and ran
  // straight down through the stack's label column. The collision checks compare
  // TEXT to TEXT and never see a LINE crossing text, so nothing caught it.
  const verticals = (d) => {                       // every vertical run in a path, with its x
    const out = []; let x = 0, y = 0;
    for (const c of d.match(/[A-Za-z][^A-Za-z]*/g) || []) {
      const n = (c.slice(1).match(/-?[\d.]+/g) || []).map(Number);
      if (c[0] === "M" || c[0] === "L") { x = n[0]; y = n[1]; }
      else if (c[0] === "V") { out.push({ x, y0: Math.min(y, n[0]), y1: Math.max(y, n[0]) }); y = n[0]; }
      else if (c[0] === "H") x = n[0];
      else if (c[0] === "Q") { x = n[2]; y = n[3]; }
    }
    return out;
  };
  const crossings = SH.flatMap((sh) => {
    const l1 = bandBox(sh.inner, "L1");
    if (!l1 || l1.stackX == null) return [];
    const ys = [...bandChunks(sh.inner, "L1").matchAll(/class="tcell" data-y="(-?[\d.]+)"/g)].map((m) => +m[1]);
    const boxL = l1.x, boxR = l1.x + l1.stackX, boxT = l1.y + app.CL, boxB = l1.y + Math.max(...ys);
    return [...sh.inner.matchAll(/data-conn="([^"]+)"[^>]*d="([^"]+)"/g)].flatMap(([, ref, d]) =>
      verticals(d).filter((v) => v.x > boxL && v.x < boxR && v.y1 > boxT && v.y0 < boxB)
        .map((v) => `${ref}@x${v.x}`));
  });
  check("no drop connector descends through the supply stack", crossings.length === 0, crossings.join(", "));
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
      svg.includes(`one of ${e.fan} typical branches`)));

  // a ref with MULTIPLE producers is a deliberate idiom, not an error: every
  // port marked with it renders the plain pentagon, the consumer renders once
  const prod = {}, cons = {};
  eachItem(SYSTEM, (it) => {
    if (it.branch && it.branch.ref) prod[it.branch.ref] = (prod[it.branch.ref] || 0) + 1;
    if (it.j === "off" && it.dir === "out") prod[it.ref] = (prod[it.ref] || 0) + 1;
    if (it.j === "off" && it.dir === "in") cons[it.ref] = (cons[it.ref] || 0) + 1;
  });
  const multi = Object.keys(prod).filter((r) => prod[r] > 1);
  // Counted on data-pent (the REF), not on the drawn glyph text: the drawn
  // letters are relettered contiguously from A, so a ref and its letter differ.
  const pentsOf = (r) => (svg.match(new RegExp(`data-pent="${rx(esc(r))}"`, "g")) || []).length;
  const multiBad = multi.filter((r) => pentsOf(r) !== prod[r] + (cons[r] || 0));
  check("multi-producer refs render one pentagon per port plus one consumer mark",
    multi.length > 0 && multiBad.length === 0, multiBad.join(", "));

  // The letters a reviewer reads run contiguously from A in the order the
  // pentagons are met. A ref matched on its own sheet draws a connector and no
  // pentagon, so the raw refs skip (A, D and F are connectors today).
  const drawn = [...svg.matchAll(/data-pent="([^"]*)"/g)].map((m) => m[1]);
  const order = [...new Set(drawn)];
  const glyphs = [...svg.matchAll(/fill="#fff" font-weight="500">([^<]*)</g)].map((m) => m[1]);
  const expect = drawn.map((r) => String.fromCharCode(65 + order.indexOf(r)));
  check("pentagons are lettered contiguously from A in reading order",
    order.length <= 26 && glyphs.join(",") === expect.join(","),
    `${glyphs.join(",")} vs ${expect.join(",")}`);

  // connectors: every drop edge draws exactly one connector whose y equals the
  // destination band's centerline; a fan (end) edge instead breaks into a
  // labeled pentagon PAIR — a drawn route would read as a second loop-back
  // A RISING BRANCH STUB (`branchUp`) is drawn inside its host cell as a vertical
  // stack: no band, no connector, no pentagon — and no line of its own. Its cells
  // must still be real tcells on the mini-grid, or the labels leave the row grid.
  const upHosts = [];
  eachItem(SYSTEM, (it) => { if (it.branchUp && it.branchUp.length) upHosts.push(it); });
  check("a rising branch stub draws a rotated tcell stack, no band and no connector",
    upHosts.length > 0 && upHosts.every((it) => {
      const host = SYSTEM.lines.find((L) => L.items.includes(it));
      const chunk = bandChunks(svg, host.id);
      return chunk.includes('class="tcell"') && chunk.includes("rotate(-90)");
    }) && !/data-conn="D"/.test(svg), `${upHosts.length} stubs`);
  // every part on the stub reaches the drawing (it is a purchase, not decoration)
  check("a rising branch stub's parts are drawn and scheduled",
    upHosts.every((it) => it.branchUp.filter((x) => x.p).every((x) => app.getRefIndex()[x.p] !== undefined)));

  SH.flatMap((sh) => sh.edges).forEach((e) => {
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
  // Tests the RATING, not the whole spec line: a GAUGE is the one part that is in
  // PN_SYM and NO_RATING_SYM at once, so its cell prints "SENCTRL" and no psi.
  const strayRating = drawn.filter((k) => app.NO_RATING_SYM.has(PARTS[k].sym) && /psi|no published rating/.test(app.specLine(PARTS[k])));
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
  const { app } = loadApp();
  // sheetDocs() IS the artifact. downloadPDF() lays these same strings out for
  // the browser's print-to-PDF, and scripts/make_pdf.sh rasterises them into the
  // 4-page packet. Each page must stand alone and each must be strict XML.
  const pages = app.sheetDocs();
  check("export produced one document per sheet",
    pages.length === app.SHEETS.length && pages.every((d) => d.length > 1000),
    `${pages.length} docs vs ${app.SHEETS.length} sheets`);
  check("every exported page is its own <svg> root",
    pages.every((d) => /^<svg xmlns/.test(d) && (d.match(/<svg /g) || []).length === 1));
  // No FOR FAST REVIEW stamp and no "not to scale" line any more (Marcus) — the
  // header carries the sheet's identity and nothing else.
  check("every exported page carries its own title block, notes and legend",
    pages.every((d, i) => d.includes(`SHEET ${i + 1} OF ${pages.length}`) &&
      d.includes("GENERAL NOTES") && d.includes("line style")));
  check("no FAST stamp or scale line survives in the header",
    pages.every((d) => !/FOR FAST REVIEW|not to scale/.test(d)));

  // THE PACKET IS A DOCUMENT. Every page must be the same PAPER — the export used
  // to size each page to its own content, so the four pages came out 25.2in wide
  // and 7.25in to 15.6in tall. Nobody can print or bind that. Orientation may
  // differ per sheet: the paper is what has to be one thing.
  const dims = (d) => (d.match(/^<svg[^>]*width="([^"]+)" height="([^"]+)"/) || []).slice(1);
  const papers = pages.map((d) => dims(d).slice().sort().join(" x "));
  check("every exported page is the same paper", new Set(papers).size === 1, [...new Set(papers)].join(" | "));
  check("exported pages carry a physical page size, not a pixel count",
    pages.every((d) => /^<svg[^>]*width="[\d.]+(in|mm|pt)"/.test(d)));

  // ORIENTATION IS DERIVED, not declared: each sheet prints on whichever page
  // renders its artwork largest, so a sheet that grows a row cannot be stranded
  // on the wrong paper by a stale flag. Checked against the EMITTED document, so
  // a pageFor() that picked the minimum would go red.
  app.SHEETS.forEach((sh, i) => {
    const best = app.PAGES.map((PG) => ({ PG, s: app.pageLayout(sh, PG).s }))
      .reduce((a, b) => (b.s > a.s ? b : a));
    check(`sheet ${sh.n} prints on the orientation that renders it largest (${best.PG.id})`,
      dims(pages[i])[0] === best.PG.cssW && dims(pages[i])[1] === best.PG.cssH,
      `${dims(pages[i]).join("x")} vs ${best.PG.cssW}x${best.PG.cssH}`);
  });
  // scale-to-fit is uniform and never an enlargement: a small sheet stays 1:1
  // rather than blowing its 9px captions up to fill the paper
  const scales = pages.map((d) => +(d.match(/<g transform="translate\([^)]*\) scale\(([\d.]+)\)"/) || [0, 0])[1]);
  check("artwork scaled uniformly, never enlarged", scales.every((s) => s > 0 && s <= 1), scales.join(", "));

  check("no undefined/NaN in any exported page", pages.every(noUndefinedNaN));
  // XML well-formedness essentials without a parser dependency (the strict
  // check is scripts/validate_svg.py, which consumes the file written below)
  const worst = pages.map(xmlEscaped).find((x) => x.bareAmp || x.rawLt) || { bareAmp: 0, rawLt: 0 };
  const { bareAmp, rawLt } = worst;
  check("export: no unescaped & (strict XML)", bareAmp === 0, bareAmp + " found");
  check("export: no stray < (strict XML)", rawLt === 0);
  const opens = pages.reduce((n, d) => n + (d.match(/<text[\s>]/g) || []).length, 0);
  const closes = pages.reduce((n, d) => n + (d.match(/<\/text>/g) || []).length, 0);
  check("balanced <text> tags", opens === closes, opens + " vs " + closes);
  // the w/h proportions in PARTS are visual only — the sheet must never claim scale
  check("no scale claims in export", pages.every((d) => !/relative scale|px = 1 in/.test(d)));
  pages.forEach((d, i) => fs.writeFileSync(path.join(__dirname, `export-sheet-${i + 1}.svg`), d));
  console.log(`    (${pages.length} pages written to test/export-sheet-N.svg — validate strictly with: python3 scripts/validate_svg.py)`);
}

console.log("\nEXPORTED SVG IS SELF-CONTAINED");
{
  const { store, app } = loadApp();
  // the legend must ship inside the drawing — it is the only thing that decodes
  // the symbols once the sheet leaves this page. Swept over EVERY legend line
  // rather than spot-checking three of them.
  // The legend and the notes are PER SHEET now: a page states only the rules that
  // govern what it draws. So each page must embed exactly its OWN lines — and,
  // just as importantly, none of another page's. Both sides come from the app's
  // own per-sheet contract, swept over every page.
  const extPages = app.sheetDocs();
  const ext = extPages.join("\n");
  const flat = (s) => s.replace(/\s+/g, " ").trim();
  const pageText = (d) => flat(textContents(d).join(" "));
  const missingIn = (d, sh) => app.legendLines(sh).filter((l) => !pageText(d).includes(flat(esc(l))));
  check("every external page embeds every legend line that applies to it",
    extPages.every((d, i) => missingIn(d, app.SHEETS[i]).length === 0),
    extPages.map((d, i) => missingIn(d, app.SHEETS[i]).join(" | ")).join(" / ").slice(0, 120));
  // a page that draws no copper must not explain what bronze means
  check("no page carries a legend line for something it does not draw",
    app.SHEETS.every((sh, i) => {
      const mine = app.legendLines(sh).join(" · ");
      return !mine.includes("copper tube") || sh.lines.some((L) => JSON.stringify(L).includes('"tube"'));
    }));
  // GENERAL NOTES wraps across several <text> lines now (as one 372-char line it
  // alone forced a 2421px canvas). Assert the NOTES, not the line breaks: join
  // the page's text nodes and collapse whitespace, so a re-wrap at a different
  // measure is not a test edit but a dropped clause still is.
  // esc(): the notes contain "tips & pilots", which reaches the XML as &amp;
  check("every external page carries the general notes that apply to it",
    extPages.every((d, i) => pageText(d).includes(flat(esc(app.generalNotes(app.SHEETS[i]))))));
  // ...and no page repeats a rule about hardware it does not draw
  check("general notes are scoped to the sheet", app.SHEETS.some((sh) =>
    app.generalNotes(sh) !== app.generalNotes()) && app.SHEETS.every((sh) =>
    app.generalNotes(sh).length <= app.generalNotes().length));
  check("every external page is one <svg> and closes",
    extPages.every((d) => d.startsWith("<svg") && d.trim().endsWith("</svg>")));
  // The "not to scale" LINE is gone from the header (Marcus), but the rule it
  // protected has not: the w/h proportions in PARTS are visual only, so nothing
  // on the sheet may claim a scale. That is what noScaleClaims enforces.
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
  const extLegendLines = app.legendLines();
  const extLegend = extLegendLines.join(" | ");
  // The flow key went too (Marcus): the arrows, pentagons and flame heads say it.
  check("external legend carries only the pipe colour key",
    /line style/.test(extLegend) &&
    !/pentagon|trapezoid|cone ▸ nut|dashed box|balloon|flows left|risers flow|drop below/i.test(extLegend),
    extLegend.slice(0, 90));

  // The internal view has NO EXPORT (Marcus: "I only care about the external
  // pdf"), so its legend is checked where it actually lives — legendLines() and
  // the on-page #legend div — not in a document nothing can produce.
  app.setView("internal");
  const intLegend = app.legendLines();
  const legendDiv = store["legend"].innerHTML;
  // the working packet keeps the full key — its balloons genuinely need decoding
  check("the balloon key exists only where balloons are drawn",
    intLegend.some((l) => /balloon: parts schedule ref/.test(l)) &&
    !extLegendLines.some((l) => /balloon/i.test(l)));
  check("internal legend keeps the full symbol key the external sheet drops",
    /pentagon/i.test(intLegend.join(" | ")) && /trapezoid/i.test(intLegend.join(" | ")) &&
    /line style/.test(intLegend.join(" | ")) && intLegend.length > extLegendLines.length,
    `${intLegend.length} internal lines vs ${extLegendLines.length} external`);
  // the div is NOT escaped and it recolours the orange line, so match on the
  // tail past the word it wraps in a span
  check("the on-page legend leads with the general notes, then the key",
    legendDiv.includes(app.generalNotes()) &&
    intLegend.every((l) => legendDiv.includes(l) || legendDiv.includes(l.slice(6))));
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
  check("unmatched line renders as orphan strip with pentagon", svg.includes('data-band="L9"') && /h16 l8 10 l-8 10 h-16/.test(svg) && svg.includes('data-pent="Z"'));
  // the badge states the count the DATA declares, not a literal 3
  const fanEdge = app.TREE.edges.find((e) => e.kind === "end");
  check("fan survives the JSON round trip (one-of-n badge, n from the data)",
    !!fanEdge && svg.includes(`one of ${fanEdge.fan} typical branches`));
  check("hostile project name escaped in meta", !store["docMeta"].innerHTML.includes("<script>"));
  const bad = collisions(textBoxes(svg));
  check("still zero text collisions after edit", bad.length === 0, bad.slice(0, 4).join("; "));
  box.value = "{not json";
  app.applyJSON();
  check("malformed JSON reported, no crash", store["jsonMsg"].textContent.startsWith("JSON error"));
}

console.log("\nMULTI-BRANCH & HOSTILE DATA");
{
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  // second matched tap on L3, downstream of the split (the corridor-crossing regression)
  const L3 = o.SYSTEM.lines.find((L) => L.id === "L3");
  L3.items.splice(L3.items.findIndex((it) => it.split) + 1, 0,
    { p: "nptTee", tag: "F-T9", branch: { ref: "P2" }, note: "second standby tap" }, { j: "npt", size: "1/4", lr: "M>F" });
  o.SYSTEM.lines.push({ id: "L3c", title: "Second pilot", psi: "60 psi", op: 60,
    items: [{ j: "off", ref: "P2", dir: "in", label: "from F-T9" }, { j: "tube", part: "cu38", size: "3/8", label: "TB-9" }, { p: "pilot", tag: "PL-9", flame: true }] });
  // ...onto the same sheet as its host tee. A drop that crosses a sheet is an
  // off-page pentagon, not a connector, so leaving L3c unassigned would quietly
  // stop exercising the drop-routing this block exists to cover. The other
  // hostile lines below stay unassigned ON PURPOSE — that path must survive too.
  o.SYSTEM.sheets.find((sh) => sh.lines.includes("L3")).lines.push("L3c");
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

  // Drop routing is a PER-SHEET question: each sheet keeps its own coordinate
  // space, so a band on sheet 1 must never be measured against one on sheet 3.
  // sh.inner is that sheet alone, before the stacking translate.
  let dropsChecked = 0;
  app.SHEETS.forEach((sh) => {
    const ssvg = sh.inner;
    // rows[id] = every drawn row rect of that band (a band may wrap)
    const rows = {};
    [...ssvg.matchAll(/<g class="band" data-band="([^"]*)" data-cl="(-?[\d.]+)" data-w="(-?[\d.]+)" transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/g)]
      .forEach((m) => { (rows[m[1]] = rows[m[1]] || []).push({ cl: +m[2], w: +m[3], x: +m[4], y: +m[5] }); });
    sh.edges.filter((e) => e.kind === "drop").forEach((e) => {
      dropsChecked++;
      // every drop connector leaves straight DOWN from its tee: M x cl V ...
      const m = ssvg.match(new RegExp(`data-conn="${rx(e.ref)}" data-cly="(-?[\\d.]+)" d="M(-?[\\d.]+) (-?[\\d.]+) V(-?[\\d.]+)`));
      check(`${sh.id} drop ${e.ref}: leaves straight down from its tee, at a host row centerline`,
        !!m && (rows[e.from.id] || []).some((r) => r.cl === +m[3]),
        m && `starts ${m[3]} vs cls ${(rows[e.from.id] || []).map((r) => r.cl).join("/")}`);
      // the initial vertical segment must not slice any strip other than its
      // host's (last-row drops descend all the way into their band; earlier-row
      // drops descend only into their own row gap before jogging left)
      const cross = m ? Object.entries(rows).filter(([id, rs]) =>
        id !== e.from.id && id !== e.to.id && rs.some((r) =>
          +m[2] >= r.x && +m[2] <= r.x + r.w &&
          Math.min(+m[3], +m[4]) < r.y + app.STRIP_H && Math.max(+m[3], +m[4]) > r.y + 1)).map(([id]) => id) : ["no-path"];
      check(`${sh.id} drop ${e.ref}: descent clears sibling strips`, !!m && cross.length === 0, cross.join(","));
    });
  });
  check("hostile render still exercises drop routing", dropsChecked > 0, dropsChecked + " drops");
  const clip = clippedByCanvas(svg, textBoxes(svg));
  check("long orphan title not clipped by canvas", clip.length === 0, clip.slice(0, 3).join("; "));
  check("mid-run off renders as pentagon stub, run continues", svg.includes('data-pent="Q"'));
  check("quoted line id escaped in attributes", svg.includes('data-band="Z&quot;9"'));
  check("no undefined/NaN on hostile data", noUndefinedNaN(svg));
  const hostilePages = app.sheetDocs();
  check("hostile export: still no unescaped &", hostilePages.every((d) => xmlEscaped(d).bareAmp === 0));
  check("hostile export: quoted attr intact", hostilePages.some((d) => d.includes('data-band="Z&quot;9"')));
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
  // 12, not 8: L1 used to CHAIN L2 into one long band. They now sit on sheets 1
  // and 3, so the band is shorter and needs more padding before it folds. The
  // number is incidental; that it folds exactly once is the point.
  for (let i = 0; i < 12; i++)
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

// Two constructs the DEFAULT sheeting no longer exercises, kept alive here the
// way FORCED WRAP keeps the fold alive. Neither is dead code: the pocket is what
// lets a drop tuck beside a supply stack, and the seam is what makes two lines
// read as one run. Both are one sheet definition away from being live again.
// The one part of the export the harness cannot evaluate: the print STYLESHEET.
// downloadPDF() is correct and sheetDocs() is correct, and the packet still came
// out of the browser as a single blank page, because the CSS hid the container.
// Nothing in the suite looked at the CSS. Now something does.
console.log("\nPRINT PATH (the browser's Save-as-PDF)");
{
  const html = fs.readFileSync(path.join(__dirname, "..", "fast_schematic_generator.html"), "utf8");
  // comments first: the rule below is quoted verbatim in a comment explaining it
  const css = (html.match(/@media print\{([\s\S]*?)\n\}/) || ["", ""])[1].replace(/\/\*[\s\S]*?\*\//g, "");
  // #printSheets IS a body child, so the blanket "hide the app" rule hides the
  // print container too — and `display:none!important` beats the id selector
  // that tries to show it again. It must be excluded at the source.
  const blanket = css.match(/body\.pdfonly\s*>\s*([^{]*)\{[^}]*display:\s*none/);
  check("the print container is not hidden by the blanket hide rule",
    !!blanket && /:not\(#printSheets\)/.test(blanket[1]),
    blanket ? "hides " + blanket[1].trim() : "no blanket rule found");
  check("the print container is shown while printing", /body\.pdfonly\s+#printSheets\{[^}]*display:\s*block/.test(css));
  // Each sheetDoc IS a full page-sized svg; an @page margin would shrink it and
  // spill a blank sheet after every real one. And a bare `@page` cannot be varied
  // per page, so the orientations must be NAMED pages selected by the page div.
  check("@page is named per orientation, sized from PAGES, and adds no margin",
    /@page \$\{P\.id\}\{size:\$\{P\.css\};margin:0\}/.test(html) &&
    /#printSheets \.page\.\$\{P\.id\}\{page:\$\{P\.id\}\}/.test(html));
  check("each printed page div carries its sheet's orientation class",
    /<div class="page \$\{pageFor\(sh\)\.PG\.id\}"/.test(html));
}

console.log("\nPOCKET & SEAM MACHINERY");
{
  // POCKET. Sheet 1 folds, which pushes L1b's tee into row 1 — below the stack.
  // Unfold it and the tee returns to the stack's own row, where the pocket to
  // the right of the stack is the whole point: the band tucks UP into it.
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  o.SYSTEM.sheets.find((s) => s.id === "S1").fold = false;
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  const sh = app.SHEETS.find((s) => s.lines.some((L) => L.id === "L1"));
  const l1 = bandBox(sh.inner, "L1"), l4 = bandBox(sh.inner, "L1b");
  const ys = [...bandChunks(sh.inner, "L1").matchAll(/class="tcell" data-y="(-?[\d.]+)"/g)].map((m) => +m[1]);
  const stackBottom = l1 && l1.y + Math.max(...ys);
  check("unfolded, a drop band tucks up into the pocket beside the stack",
    !!l4 && l4.y < stackBottom, l4 && `band y ${l4.y} vs stack bottom ${stackBottom}`);
  check("...and starts to the right of the stack, never over it",
    !!l4 && l1.stackX != null && l4.x >= l1.x + l1.stackX, l4 && l1 && `band x ${l4.x} vs stack right ${l1.x + l1.stackX}`);
}
{
  // SEAM. A band whose last item is a 1:1 off-out chains its consumer into the
  // same band. No default sheet does that any more (a chain cannot cross a sheet,
  // and the poofer supply sits with L1 while its accumulator is a page away) — so
  // put producer and consumer back on one sheet. Found by LINE, not by sheet id:
  // the sheet order is a layout decision and has already changed once.
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  o.SYSTEM.sheets.forEach((s) => (s.lines = s.lines.filter((id) => id !== "L1b")));
  o.SYSTEM.sheets.find((s) => s.lines.includes("L1c")).lines.unshift("L1b");
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  const svg = store["strips"].children[0].innerHTML;
  const chained = app.SHEETS.flatMap((sh) => Object.values(sh.chain).flatMap((segs) => segs.slice(1).map((x) => x.id)));
  check("a 1:1 off-out chains its consumer into the host band", chained.includes("L1c"), chained.join(", "));
  check("the chained segment renders as a seam, not a band of its own",
    svg.includes('data-merged="L1c"') && !svg.includes('data-band="L1c"'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
