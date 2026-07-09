// Named, data-falsifiable predicates about the schematic.
//
// GATE SCOPING — read before adding anything here.
// A predicate belongs in this file if and only if some realistic mutation of
// the DATA (SYSTEM, PARTS, PN_SYM, NO_RATING_SYM) makes it return ok:false.
// Every id below has a paired mutation in test/mutants.js, and the coverage
// gate fails the build if one is missing.
//
// Renderer guarantees do NOT belong here. `everyLineRendered` survives deleting
// a line from SYSTEM (`.every()` just iterates fewer lines); collision-freeness,
// baseline alignment and connector geometry are falsifiable only by a source
// bug. Those stay inline in run-tests.js and are exempt from the gate. Forcing
// them in would require inventing fake mutations — exactly the decoration this
// suite exists to delete.
//
// The tell that a predicate does not belong: to falsify it you had to mutate
// the renderer, or the mutation moved BOTH sides of the comparison (expectation
// and observation both derive from the same field, so the predicate stays true).
"use strict";

/* ---------- shared traversal ---------- */

// Every item in SYSTEM, descending exactly where buildRefs() descends:
// riser tees, split tee/rejoin, and both split paths. A naive top-level sweep
// misses the accumulator's NGT bushing, which hangs off a riser tee's mount.
function eachItem(SYSTEM, fn) {
  const visit = (it) => {
    if (!it) return;
    fn(it);
    if (it.j === "riser") visit(it.tee);
    if (it.split) {
      visit(it.split.tee); visit(it.split.rejoin);
      (it.split.a || []).forEach(visit); (it.split.b || []).forEach(visit);
    }
  };
  (SYSTEM.lines || []).forEach((L) => (L.items || []).forEach(visit));
}

// Every part key a purchase could hide behind, anywhere in the system.
function partKeys(SYSTEM, PARTS) {
  const keys = [];
  eachItem(SYSTEM, (it) => {
    if (it.p) keys.push(it.p);
    if (it.part) keys.push(it.part);
    if (it.mount) { keys.push(it.mount.p); if (it.mount.via) keys.push(it.mount.via); }
  });
  return [...new Set(keys.filter((k) => k && PARTS[k]))];
}

const line = (SYSTEM, id) => (SYSTEM.lines || []).find((L) => L.id === id);

// A line's items as independent FLOW SEQUENCES: the main run, plus one sequence
// per split path. Adjacency only means something inside a single sequence, so a
// break marker stands where the split was — otherwise the item before a split
// would look adjacent to the item after it.
function sequences(L) {
  if (!L) return [];
  const main = [], out = [];
  (L.items || []).forEach((it) => {
    if (it.split) {
      const { tee, rejoin, a = [], b = [] } = it.split;
      out.push([tee, ...a, rejoin]);
      out.push([tee, ...b, rejoin]);
      main.push(tee, { j: "__break" }, rejoin);
    } else main.push(it);
  });
  out.push(main);
  return out;
}

const splitOf = (SYSTEM, id) => { const L = line(SYSTEM, id); const it = L && (L.items || []).find((x) => x.split); return it ? it.split : null; };
// Which split path is the metered one is decided by the NEEDLE VALVE it carries,
// never by its letter — `a` vs `b` is a port-model detail (a = run, b = branch).
const isNeedle = (PARTS, k) => !!PARTS[k] && PARTS[k].sym === "needle";
const meteredPath = (sp, PARTS) => [sp.a, sp.b].find((p) => (p || []).some((it) => isNeedle(PARTS, it.p))) || null;

const drawnParts = (PARTS, refIndex) => Object.keys(PARTS).filter((k) => refIndex[k] !== undefined);
const realPn = (p) => p.pn && p.pn !== "—" ? p.pn : "";
const occ = (hay, needle) => hay.split(needle).length - 1;
const stripTags = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const textsOf = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

// A part is a purchased fitting if it is an adapter body or a nipple.
const isFitting = (PARTS, key) =>
  !!PARTS[key] && (PARTS[key].sym === "hexAdapter" || /nipple/i.test(PARTS[key].name || ""));

// Needle valves that land straight on a flare cone (the whole point of speccing
// them flare: no adapter between the valve and the run).
const flareValveKeys = (PARTS) =>
  Object.keys(PARTS).filter((k) => PARTS[k].sym === "needle" && String(PARTS[k].ports && PARTS[k].ports.i).startsWith("flare:"));

const ok = (detail) => ({ ok: true, detail });
const no = (detail) => ({ ok: false, detail });

/* ---------- the invariants ---------- */

const INVARIANTS = [
  /* --- the port model: every drawn joint is mechanically assemblable --- */
  {
    id: "portLinterClean",
    describe: "every drawn joint is mechanically assemblable (port linter finds nothing)",
    view: "any",
    run({ app }) {
      const r = app.lintPorts();
      return r.issues.length
        ? no(r.issues.join(" · "))
        : ok(`${r.checked} junctions clean, ${r.skipped} skipped`);
    },
  },
  {
    id: "linterSurfacesAsFit1",
    describe: "the port linter's verdict reaches compliance row FIT-1 (it is not hardcoded)",
    view: "any",
    run({ app, store }) {
      const r = app.lintPorts();
      const row = (store["compTable"].innerHTML.split("<tr>").find((x) => x.includes("FIT-1")) || "");
      if (!row) return no("no FIT-1 row in the compliance table");
      // Report the STATUS and the row's note, not the requirement paragraph —
      // the note is what a seeded defect changes.
      const m = /(DESIGN PASS|REVIEW|FIELD)\s*(.*)$/.exec(stripTags(row));
      const status = m ? m[1] : "?", note = (m ? m[2] : "").trim();
      const detail = `status=${status}; ${note.slice(0, 150)}`;
      const clean = status === "DESIGN PASS" && note.includes(`${r.checked} junctions machine-checked`);
      return r.issues.length === 0 && clean ? ok(detail) : no(detail);
    },
  },

  /* --- purchasing: nothing you must buy may fall off the schedule --- */
  {
    id: "everyPartReachesTheSchedule",
    describe: "every part referenced anywhere in SYSTEM is registered in the parts schedule",
    view: "any",
    run({ SYSTEM, PARTS, refIndex }) {
      // buildRefs() registers it.part only for hose|tube|npt joints. A part hung
      // on any other joint type is a purchase that silently never reaches the
      // schedule — a real purchasing bug, not a rendering one.
      const keys = partKeys(SYSTEM, PARTS);
      const missing = keys.filter((k) => refIndex[k] === undefined);
      return missing.length
        ? no("never reaches the schedule: " + missing.join(", "))
        : ok(`${keys.length} parts all reach the schedule`);
    },
  },
  {
    id: "noAdapterDeclarations",
    describe: "every adapter in the default system is a drawn, purchasable part (no note-only adaptIn/adaptOut/branchAdapt)",
    view: "any",
    run({ SYSTEM }) {
      const found = JSON.stringify(SYSTEM).match(/adaptIn|adaptOut|branchAdapt/g) || [];
      return found.length
        ? no(`${found.length} note-only adapter declaration(s): ${[...new Set(found)].join(", ")}`)
        : ok("all adapters are drawn parts");
    },
  },
  {
    id: "removedFeaturesStayRemoved",
    describe: "the parts schedule grows no verification chips back (VERIFY PN / SPEC VERIFIED / STATUS)",
    view: "any",
    run({ store }) {
      const h = store["partsTable"].innerHTML;
      const back = ["VERIFY PN", "SPEC VERIFIED", "STATUS"].filter((s) => h.includes(s));
      return back.length ? no("schedule re-grew: " + back.join(", ")) : ok("no verification chips");
    },
  },

  /* --- what the external sheet may and may not say --- */
  {
    id: "externalNoDesignations",
    describe: "the external sheet carries no equipment designation anywhere (cells, titles, labels, notes)",
    view: "external",
    run({ svg }) {
      // CGA-510 is a thread standard, not a designation.
      const all = textsOf(svg).join(" | ");
      const stray = [...new Set((all.match(/\b[A-Z]{1,3}-\d+\b/g) || []).filter((x) => x !== "CGA-510"))];
      return stray.length ? no("keys to an off-sheet schedule: " + stray.join(", ")) : ok("nothing keys off-sheet");
    },
  },
  {
    id: "hosesMarkTheirWorkingPressure",
    describe: "every gas hose marks its working pressure on the cell — it is the flexible part most likely to fail",
    view: "external",
    run({ svg, SYSTEM, PARTS }) {
      const hoses = [];
      eachItem(SYSTEM, (it) => { if (it.j === "hose" && it.part) hoses.push(PARTS[it.part]); });
      if (!hoses.length) return no("no hose joints — the rule is untested");
      const unmarked = hoses.filter((h) => !h || typeof h.rating !== "number" || !svg.includes(`WP ${h.rating} psi`));
      if (unmarked.length) return no(`${unmarked.length} of ${hoses.length} hoses state no working pressure`);
      const marked = (svg.match(/WP \d+ psi/g) || []).length;
      return marked === hoses.length
        ? ok(`${hoses.length} hoses, each marked`)
        : no(`${hoses.length} hose joints but ${marked} marked on the drawing`);
    },
  },
  {
    id: "ballValvesNoPnOnDrawing",
    describe: "ball valves print neither maker nor part number on the drawing — the schedule still records both",
    view: "external",
    run({ svg, store, PARTS, refIndex }) {
      // Grounded in the ball valve itself, NOT in PN_SYM. A predicate written as
      // "no non-PN_SYM part prints a number" is vacuous the moment you mutate
      // PN_SYM: the part leaves the filter along with the rule. Quantifying over
      // `sym === "ball"` keeps the observation and the expectation independent,
      // so PN_SYM.add("ball") turns this red.
      const balls = drawnParts(PARTS, refIndex).filter((k) => PARTS[k].sym === "ball");
      if (!balls.length) return no("no ball valve is drawn — the rule is untested");
      const leak = balls.filter((k) => (PARTS[k].mfg && svg.includes(PARTS[k].mfg)) || (realPn(PARTS[k]) && svg.includes(PARTS[k].pn)));
      if (leak.length) return no("maker or part number on the drawing: " + leak.map((k) => `${k} (${PARTS[k].mfg} ${PARTS[k].pn})`).join(", "));
      const sched = store["partsTable"].innerHTML;
      const lost = balls.filter((k) => realPn(PARTS[k]) && !sched.includes(PARTS[k].pn));
      return lost.length
        ? no("the schedule no longer records the number: " + lost.join(", "))
        : ok(`${balls.length} ball valve(s): rating on the drawing, number in the schedule`);
    },
  },
  {
    id: "partsThatCanFailPrintTheirRating",
    describe: "every valve, regulator, gauge and vessel on the drawing states the pressure rating FE-2 judges it against",
    view: "external",
    run({ app, PARTS, refIndex }) {
      // Grounded in PN_SYM, not NO_RATING_SYM: everything with a seat, seal or
      // diaphragm is exactly the set a reviewer must identify by number, so
      // dropping one into NO_RATING_SYM must go red rather than read as vacuous.
      const mute = drawnParts(PARTS, refIndex).filter(
        (k) => app.PN_SYM.has(PARTS[k].sym) && !/psi|no published rating/.test(app.specLine(PARTS[k]))
      );
      return mute.length ? no("states no rating: " + mute.join(", ")) : ok("all pressure-bearing parts rated");
    },
  },
  {
    id: "pnAlwaysNamesItsMaker",
    describe: "every part number on the drawing is preceded by its manufacturer, and ASINs are labelled as ASINs",
    view: "external",
    run({ svg, PARTS, refIndex }) {
      // A bare catalog number identifies nothing, and "Beduan B08C2NLPR5" reads
      // as a Beduan catalog number when it is an Amazon listing id.
      const shown = drawnParts(PARTS, refIndex).filter((k) => realPn(PARTS[k]) && svg.includes(PARTS[k].pn));
      if (shown.length < 4) return no(`only ${shown.length} part numbers reach the drawing — expected the valves/regs/gauges`);
      const bad = shown.filter((k) => {
        const p = PARTS[k], num = p.asin ? "ASIN " + p.pn : p.pn;
        return occ(svg, p.pn) !== occ(svg, `${p.mfg} ${num}`);
      });
      return bad.length ? no("number without its maker: " + bad.join(", ")) : ok(`${shown.length} numbers, each named`);
    },
  },
  {
    id: "marketplacePartsFlaggedAsin",
    describe: "anything sourced off a marketplace listing is flagged asin and renders its id as an ASIN",
    view: "external",
    run({ svg, PARTS, refIndex }) {
      const market = drawnParts(PARTS, refIndex).filter((k) => /amazon/i.test(PARTS[k].vendor || ""));
      if (!market.length) return no("no marketplace-sourced part found — the asin path is untested");
      const unflagged = market.filter((k) => !PARTS[k].asin || !svg.includes("ASIN " + PARTS[k].pn));
      return unflagged.length
        ? no("marketplace id rendered as a catalog number: " + unflagged.join(", "))
        : ok(`${market.length} marketplace parts, all flagged`);
    },
  },
  {
    id: "vesselStatesSpec",
    describe: "the pressure vessel says more than its name and rating — how it is plumbed reaches the drawing",
    view: "external",
    run({ svg, SYSTEM, PARTS }) {
      let mount = null;
      eachItem(SYSTEM, (it) => { if (it.mount && PARTS[it.mount.p] && PARTS[it.mount.p].sym === "tank") mount = it.mount; });
      if (!mount) return no("no mounted pressure vessel found");
      const words = String(mount.note || "").split(/\W+/).filter((w) => w.length >= 5);
      if (words.length < 6) return no(`vessel note is ${words.length} significant words — it regressed to name + rating`);
      const shown = words.filter((w) => svg.includes(w));
      return shown.length / words.length >= 0.9
        ? ok(`${words.length} significant words, ${shown.length} on the drawing`)
        : no(`only ${shown.length}/${words.length} note words reach the drawing`);
    },
  },
  {
    id: "internalHidesMfrPn",
    describe: "the internal packet keys cells to the schedule and prints no manufacturer part number",
    view: "internal",
    run({ svg, PARTS, refIndex, app }) {
      const leak = drawnParts(PARTS, refIndex).filter(
        (k) => app.PN_SYM.has(PARTS[k].sym) && realPn(PARTS[k]) && svg.includes(PARTS[k].pn)
      );
      return leak.length ? no("part number leaked onto the internal sheet: " + leak.join(", ")) : ok("no part numbers");
    },
  },

  /* --- the compliance engine's reading of a rating --- */
  {
    id: "ratingsReportedCorrectly",
    describe: "no part is under-rated for its segment, and an unpublished rating never reads as zero",
    view: "any",
    run({ store, svg }) {
      // `null < op` is true in JS, so an unrated part would silently report as
      // "rated below segment pressure". The two cases must stay distinguishable
      // in all four places they surface: this predicate's DETAIL is what the
      // mutations assert against, so a null that reads as under-rated goes red
      // on the detail even though `ok` is false either way.
      const comp = stripTags(store["compTable"].innerHTML);
      const sched = store["partsTable"].innerHTML;
      const under = /Rating below segment pressure/.test(comp);
      const unpub = /No published pressure rating/.test(comp);
      const bits = [
        `compliance=${under ? "under-rated" : unpub ? "unpublished" : "clean"}`,
        `fe2=${(/FE-2[\s\S]{0,500}?(DESIGN PASS|REVIEW|FIELD)/.exec(comp) || [, "?"])[1]}`,
        `schedule=${sched.includes("not published") ? "not published" : sched.includes("null psi") ? "null psi" : "numeric"}`,
        `drawing=${svg.includes("no published rating") ? "no published rating" : /null/.test(svg) ? "null" : "numeric"}`,
      ];
      return under || unpub ? no(bits.join("; ")) : ok(bits.join("; "));
    },
  },

  /* --- the flare decision: fit a flare valve, buy no adapters --- */
  {
    id: "flareValvesFlankedByBareFlareJoints",
    describe: "every flare needle valve is flanked by bare flare joints (the tube nut lands on its cone)",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const fv = flareValveKeys(PARTS);
      const bad = [];
      (SYSTEM.lines || []).forEach((L) =>
        sequences(L).forEach((seq) =>
          seq.forEach((it, i) => {
            if (!it || !fv.includes(it.p)) return;
            const before = seq[i - 1], after = seq[i + 1];
            const bare = (x) => x && x.j === "flare" && !x.part;
            if (!bare(before) || !bare(after)) bad.push(`${L.id}:${it.tag || it.p}`);
          })
        )
      );
      return bad.length ? no("something sits between the valve and the run: " + bad.join(", ")) : ok(`${fv.length} flare valve types, all bare`);
    },
  },
  {
    id: "flareValvesMaleConesBothEnds",
    describe: "flare needle valves declare male cones both ends (or the linter's gender check is moot)",
    view: "any",
    run({ PARTS }) {
      const fv = flareValveKeys(PARTS);
      if (fv.length < 2) return no(`only ${fv.length} flare needle valve types`);
      const bad = fv.filter((k) => !(PARTS[k].ports.i.endsWith(":M") && PARTS[k].ports.o.endsWith(":M")));
      return bad.length ? no("not male cones both ends: " + bad.join(", ")) : ok(`${fv.length} valve types, male cones`);
    },
  },
  {
    id: "flareValvesOutRateHighestRelief",
    describe: "every flare needle valve out-rates the highest relief setting that can cap its zone",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const sets = [];
      eachItem(SYSTEM, (it) => {
        const m = it.mount || (it.tee && it.tee.mount);
        if (m && m.p === "relief") sets.push(+(/set (\d+) psi/.exec(m.note || "") || [0, 0])[1]);
      });
      if (sets.length < 2) return no(`only ${sets.length} relief settings found`);
      const max = Math.max(...sets);
      const weak = flareValveKeys(PARTS).filter((k) => !(typeof PARTS[k].rating === "number" && PARTS[k].rating > max));
      return weak.length
        ? no(`the weak point on the line at ${max} psi relief: ` + weak.map((k) => `${k}@${PARTS[k].rating}`).join(", "))
        : ok(`all valves out-rate ${max} psi`);
    },
  },
  {
    id: "pilotLineBuysNoFittings",
    describe: "the poofer pilot line buys no fittings at all",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const L = line(SYSTEM, "L4a");
      if (!L) return no("L4a is gone");
      const bought = (L.items || []).filter((it) => isFitting(PARTS, it.p) || isFitting(PARTS, it.part));
      return bought.length ? no("buys " + bought.map((it) => it.p || it.part).join(", ")) : ok("zero fittings");
    },
  },
  {
    id: "splitPathsBuyNoFittings",
    describe: "NEITHER side of the split buys a fitting — the metered run and the solenoid bypass are both bare",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const sp = splitOf(SYSTEM, "L3");
      if (!sp) return no("L3's split is gone");
      // Tube and hose SECTIONS are the run itself, not fittings; only adapter
      // bodies and nipples are purchases. The metered run rides bare flare tube;
      // the solenoid screws onto the tees' male NPT branch bosses.
      const bought = [...(sp.a || []), ...(sp.b || [])].filter((it) => isFitting(PARTS, it.p) || isFitting(PARTS, it.part));
      return bought.length ? no("buys " + bought.map((it) => it.p || it.part).join(", ")) : ok("zero fittings on either path");
    },
  },
  {
    id: "splitMeteredPathNeedleOnly",
    describe: "the split's metered path is needle-only — the solenoid lives on the other path",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const sp = splitOf(SYSTEM, "L3");
      if (!sp) return no("L3's split is gone");
      // Identified by the needle valve it carries, NOT by its letter: which path
      // is `a` and which is `b` is a rendering/port-model detail and has changed.
      const metered = meteredPath(sp, PARTS);
      if (!metered) return no("no needle valve on either split path");
      const sol = metered.filter((it) => it.p && PARTS[it.p] && PARTS[it.p].sym === "sol");
      return sol.length ? no("solenoid in the metered path: " + sol.map((i) => i.tag || i.p).join(", ")) : ok("needle only");
    },
  },

  /* --- the main shut-off must actually shut everything off --- */
  {
    id: "branchesDownstreamOfTheMainShutoff",
    describe: "every branch and the onward run tee off DOWNSTREAM of the root line's main shut-off",
    view: "any",
    run({ SYSTEM, app }) {
      // The failure this exists to prevent: the poofer branch teed off the
      // supply line UPSTREAM of V-2, so closing the valve marked "main
      // emergency shut-off" cut the distribution manifold and left the poofer
      // fed from the cylinders. A shut-off that does not shut everything off
      // is worse than none, because the sheet claims it does.
      const root = app.TREE.root && (SYSTEM.lines || []).find((L) => L.id === app.TREE.root.id);
      if (!root) return no("no root line");
      const emerg = root.items.map((it, i) => (it.emergency ? i : -1)).filter((i) => i >= 0);
      if (!emerg.length) return no("the root line carries no emergency shut-off");
      const main = Math.max(...emerg);
      const fed = [];
      root.items.forEach((it, i) => {
        if (it.branch && it.branch.ref && app.MATCHED.has(it.branch.ref)) fed.push({ i, what: `branch ${it.branch.ref} (${it.tag || it.p})` });
        if (it.j === "off" && it.dir === "out") fed.push({ i, what: `onward run ${it.ref}` });
      });
      if (!fed.length) return no("the root line feeds nothing — the rule is untested");
      const upstream = fed.filter((f) => f.i < main);
      return upstream.length
        ? no(`${root.items[main].tag} does not cut: ` + upstream.map((f) => f.what).join(", "))
        : ok(`${root.items[main].tag} is upstream of all ${fed.length} consumer(s)`);
    },
  },

  /* --- L4b's order is the design; move one and you break two properties --- */
  {
    id: "l4bOrder",
    describe: "L4b order: check valve -> isolation valve -> pilot tee -> relief -> accumulator",
    view: "any",
    run({ SYSTEM, PARTS }) {
      // CV-1 blocks backflow toward the regulator. The isolation valve sits
      // UPSTREAM of the pilot tee, so closing it cuts pilot and accumulator
      // together. The pilot tees off downstream of CV-1 and upstream of the
      // accumulator, so the vessel bleeds down through the burning pilot on a
      // normal shutdown. Move any one and you break one of the other two.
      // Positions are identified by SYMBOL, not by the emergency flag — the
      // e-stop marking is a separate invariant and must fail separately.
      const L = line(SYSTEM, "L4b");
      if (!L) return no("L4b is gone");
      const at = (f) => L.items.findIndex(f);
      const sym = (s) => at((i) => i.p && PARTS[i.p] && PARTS[i.p].sym === s);
      const iCheck = sym("check");
      const iValve = sym("ball");
      const iPilot = at((i) => i.branch && i.branch.ref === "D");
      const iRelief = at((i) => i.mount && i.mount.p === "relief");
      const iAccum = at((i) => i.j === "riser");
      const seq = [iCheck, iValve, iPilot, iRelief, iAccum];
      const named = `check=${iCheck} isolation=${iValve} pilotTee=${iPilot} relief=${iRelief} accum=${iAccum}`;
      if (seq.some((i) => i < 0)) return no("missing element: " + named);
      const sorted = seq.every((v, i) => i === 0 || seq[i - 1] < v);
      return sorted ? ok(named) : no("out of order: " + named);
    },
  },
  {
    id: "eStopCutsPilotAndAccumulator",
    describe: "the isolation valve upstream of the pilot tee is an emergency shut-off",
    view: "any",
    run({ SYSTEM }) {
      const L = line(SYSTEM, "L4b");
      if (!L) return no("L4b is gone");
      const iPilot = L.items.findIndex((i) => i.branch && i.branch.ref === "D");
      if (iPilot < 0) return no("the pilot tee is gone");
      const up = L.items.slice(0, iPilot).filter((i) => i.p && i.tag);
      const valve = up[up.length - 1];
      if (!valve) return no("nothing sits upstream of the pilot tee");
      return valve.emergency === true
        ? ok(`${valve.tag} is an e-stop`)
        : no(`${valve.tag} sits upstream of the pilot tee but is not marked emergency`);
    },
  },
  {
    id: "pilotTeeScrewsInWithoutANipple",
    describe: "the pilot tee's male NPT screws straight into the female port upstream of it — no hex nipple",
    view: "any",
    run({ SYSTEM, PARTS }) {
      // Why F-6 is a STREET tee (male one end): it lands directly on the female
      // outlet ahead of it. Compared against whatever part actually sits
      // upstream (the isolation valve, not the check valve — V-3 is between
      // them by design), so this stays true if L4b is legitimately re-ordered.
      const L = line(SYSTEM, "L4b");
      if (!L) return no("L4b is gone");
      const iPilot = L.items.findIndex((i) => i.branch && i.branch.ref === "D");
      if (iPilot < 0) return no("the pilot tee is gone");
      let iUp = -1;
      for (let i = iPilot - 1; i >= 0; i--) if (L.items[i].p) { iUp = i; break; }
      if (iUp < 0) return no("nothing sits upstream of the pilot tee");
      const up = PARTS[L.items[iUp].p], tee = PARTS[L.items[iPilot].p];
      if (!up.ports || !tee.ports) return no("a custom fabrication has no port model");
      const outlet = up.ports.o.split(":"), inlet = tee.ports.i.split(":");
      const between = L.items.slice(iUp + 1, iPilot).filter((i) => i.part);
      const why = [];
      if (outlet[0] !== inlet[0]) why.push(`thread ${outlet[0]} vs ${inlet[0]}`);
      if (outlet[1] !== inlet[1]) why.push(`size ${outlet[1]} vs ${inlet[1]}`);
      if (outlet[2] === inlet[2]) why.push(`both ${outlet[2]} — two like genders cannot mate`);
      if (between.length) why.push("a nipple sits between: " + between.map((i) => i.part).join(", "));
      return why.length
        ? no(why.join("; "))
        : ok(`${L.items[iUp].tag || iUp} ${outlet.join(":")} into tee ${inlet.join(":")}, nothing between`);
    },
  },
  {
    id: "jetPathSeriesOrder",
    describe: "the jet path tees off before the split, needle then solenoid in series ahead of the mixer",
    view: "any",
    run({ SYSTEM, PARTS, app }) {
      const L = line(SYSTEM, "L3b");
      if (!L) return no("L3b is gone");
      const symAt = (s) => L.items.findIndex((i) => i.p && PARTS[i.p] && PARTS[i.p].sym === s);
      const iN = symAt("needle"), iS = symAt("sol"), iM = symAt("mixer");
      const teed = app.TREE.edges.some((e) => e.ref === "J" && e.kind === "drop");
      const named = `needle=${iN} solenoid=${iS} mixer=${iM} teedOff=${teed}`;
      if (iN < 0 || iS < 0 || iM < 0 || !teed) return no("missing element: " + named);
      return iN < iS && iS < iM ? ok(named) : no("out of order: " + named);
    },
  },
];

/* ---------- evaluation ---------- */

// SYSTEM/PARTS/refIndex are resolved HERE, at evaluation time: applyJSON()
// reassigns SYSTEM and PARTS, buildRefs() reassigns refIndex, so a value
// captured at load time is stale after any mutation. See harness.js.
const ctxFor = (app, store, svg, view) => ({
  app, store, svg, view,
  SYSTEM: app.getSYSTEM(), PARTS: app.getPARTS(), refIndex: app.getRefIndex(),
});

// A predicate that throws is a broken predicate, not a passing mutation —
// callers surface `threw` rather than counting it as a clean red.
function runOne(inv, ctx) {
  try {
    const r = inv.run(ctx);
    return { ok: !!r.ok, detail: String(r.detail == null ? "" : r.detail) };
  } catch (err) {
    return { ok: false, threw: true, detail: `threw: ${err && err.message}` };
  }
}

const drawing = (store) => store["strips"].children[0].innerHTML;

// Predicates never call setView themselves — they declare .view and the runner
// renders each view exactly once (two renders total, not one per predicate).
function evaluateAll(app, store) {
  const results = {};
  const draw = (view) => { app.setView(view); return drawing(store); };

  const ext = draw("external");
  INVARIANTS.filter((i) => i.view !== "internal").forEach((i) => { results[i.id] = runOne(i, ctxFor(app, store, ext, "external")); });
  const int = draw("internal");
  INVARIANTS.filter((i) => i.view === "internal").forEach((i) => { results[i.id] = runOne(i, ctxFor(app, store, int, "internal")); });
  draw("external"); // restore the default view

  return results;
}

// One predicate, one render — mutants.js runs ~30 of these, so it may not pay
// for two renders and 24 predicates per mutation. The app is already rendered
// in the default (external) view when this is called.
function evaluateOne(app, store, inv) {
  if (inv.view === "internal") app.setView("internal");
  return runOne(inv, ctxFor(app, store, drawing(store), inv.view));
}

module.exports = { INVARIANTS, evaluateAll, evaluateOne, eachItem, sequences, line, splitOf, meteredPath, drawnParts, flareValveKeys, textsOf, stripTags };
