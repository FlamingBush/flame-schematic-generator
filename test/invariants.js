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
    if (it.j === "riser") { visit(it.tee); (it.down || []).forEach(visit); }
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
    if (it.mount) { keys.push(it.mount.p); [].concat(it.mount.via || []).forEach((v) => keys.push(v)); }
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

// The accumulator hangs BELOW the riser tee as an ordered down-stack.
const accStack = (SYSTEM, id) => { const L = line(SYSTEM, id); const r = L && (L.items || []).find((x) => x.j === "riser"); return (r && r.down) || null; };
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
    id: "gaugesPrintTheirRange",
    describe: "every drawn gauge prints its measuring range on the cell — the rating is the same 300 psi on all three",
    view: "any",
    run({ svg, PARTS, refIndex }) {
      // The range identifies the instrument; the spec line's burst rating does
      // not distinguish a 0-30 gauge from a 0-300 one. Grounded in the range
      // token, NOT in the rating, so the two cannot move together.
      const gauges = drawnParts(PARTS, refIndex).filter((k) => PARTS[k].sym === "gauge");
      if (!gauges.length) return no("no gauges drawn — the rule is untested");
      const bad = gauges.filter((k) => {
        const range = (PARTS[k].name.match(/\d+-\d+ psi/) || [])[0];
        return !range || !svg.includes(range);
      });
      return bad.length ? no(bad.join(", ") + " print no range") : ok(gauges.length + " gauges, each ranged");
    },
  },
  {
    id: "noInchesOnTheSheet",
    describe: "no cell writes inches — fractions are designations, so never \"3/8 in\" and never a 3/8\" inch mark",
    view: "any",
    run({ svg }) {
      // Marcus: the fractions read as brand names, not measurements. Sweeps every
      // rendered text node in whichever view is under test, so a name, a note, a
      // joint caption or a legend line all fail it alike.
      const offenders = textsOf(svg).filter((t) => /\d\s?(?:in\b|&quot;|")/.test(t));
      return offenders.length
        ? no(offenders.slice(0, 3).map((t) => `"${t}"`).join("; "))
        : ok(textsOf(svg).length + " text nodes, no inch written");
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
    describe: "every valve, regulator and vessel on the drawing states the pressure rating FE-2 judges it against",
    view: "external",
    run({ app, PARTS, refIndex }) {
      // Grounded in PN_SYM, not NO_RATING_SYM: everything with a seat, seal or
      // diaphragm is exactly the set a reviewer must identify by number, so
      // dropping one into NO_RATING_SYM must go red rather than read as vacuous.
      // GAUGES are the one PN_SYM symbol exempted, and by name rather than by
      // membership so the exemption cannot silently widen: a gauge states its
      // RANGE instead (gaugesPrintTheirRange / gaugeCellsHideTheBodyRating).
      const mute = drawnParts(PARTS, refIndex).filter(
        (k) => app.PN_SYM.has(PARTS[k].sym) && PARTS[k].sym !== "gauge"
          && !/psi|no published rating/.test(app.specLine(PARTS[k]))
      );
      return mute.length ? no("states no rating: " + mute.join(", ")) : ok("all pressure-bearing parts rated");
    },
  },
  {
    id: "gaugeCellsHideTheBodyRating",
    describe: "no gauge cell prints its body rating — all three are 300 psi, which made every gauge read as a 300 psi gauge",
    view: "external",
    run({ svg, PARTS, refIndex }) {
      // The range "0-300 psi" legitimately ends in the same token, so the search
      // is for a BARE rating: one not preceded by the hyphen of a range.
      const bad = drawnParts(PARTS, refIndex)
        .filter((k) => PARTS[k].sym === "gauge" && typeof PARTS[k].rating === "number")
        .filter((k) => textsOf(svg).some((t) => new RegExp(`(?<![-\\d])${PARTS[k].rating} psi`).test(t)));
      return bad.length
        ? no(bad.join(", ") + " print a bare body rating beside the range")
        : ok("gauge cells state a range and nothing else in psi");
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
      // The vessel sits at the bottom of the accumulator stack, not on a mount.
      const stack = accStack(SYSTEM, "L4b") || [];
      const vessel = stack.find((it) => it.p && PARTS[it.p] && PARTS[it.p].sym === "tank");
      if (!vessel) return no("no pressure vessel in the accumulator stack");
      const words = String(vessel.note || "").split(/\W+/).filter((w) => w.length >= 5);
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

  /* --- metering valves ---
     The flare-decision invariants that lived here (flare valves flanked by bare
     flare joints; male cones both ends; the metered run and the pilot line buying
     nothing) are GONE with the Anderson Fittings 110SAE/115SAE valves. Every one
     of them was a statement about a part that turned out to be unbuyable. The
     RATING check below was the only one making a claim about safety rather than
     about cost, so it survives — re-grounded on every needle valve, not just the
     flare ones. */
  {
    id: "needleValvesOutRateHighestRelief",
    describe: "every needle valve out-rates the highest relief setting that can cap its zone",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const sets = [];
      eachItem(SYSTEM, (it) => {
        const m = it.mount || (it.tee && it.tee.mount);
        if (m && m.p === "relief") sets.push(+(/set (\d+) psi/.exec(m.note || "") || [0, 0])[1]);
      });
      if (sets.length < 2) return no(`only ${sets.length} relief settings found`);
      const max = Math.max(...sets);
      const valves = Object.keys(PARTS).filter((k) => PARTS[k].sym === "needle");
      if (!valves.length) return no("no needle valves — the rule is untested");
      const weak = valves.filter((k) => !(typeof PARTS[k].rating === "number" && PARTS[k].rating > max));
      return weak.length
        ? no(`the weak point on the line at ${max} psi relief: ` + weak.map((k) => `${k}@${PARTS[k].rating}`).join(", "))
        : ok(`all valves out-rate ${max} psi`);
    },
  },
  {
    id: "splitBranchPathTurnsAround",
    describe: "the split's BRANCH path carries a bendable section — it leaves and re-enters through bosses that face the same way",
    view: "any",
    run({ SYSTEM }) {
      const sp = splitOf(SYSTEM, "L3");
      if (!sp) return no("L3's split is gone");
      // Grounded on `b`, which IS the branch path by the port model — not on
      // "the path without the needle valve". Those were the same path until the
      // solenoid moved onto the run, and conflating them is how this predicate
      // would have started guarding the wrong leg.
      // Both branch bosses face the SAME way (down, into the strip), so this path
      // must reverse direction, and only a bendable section reverses it. No rigid
      // chain of adapters, however threaded, spans two same-facing bosses.
      // THE PORT LINTER CANNOT SEE THIS: it mates thread type, size and gender,
      // and a rigid bare solenoid across two bosses lints perfectly clean.
      const branch = sp.b;
      if (!branch || !branch.length) return no("the split has no branch path");
      const bendable = branch.filter((it) => it.j === "tube" || it.j === "hose");
      return bendable.length
        ? ok(`turns on ${bendable.map((it) => it.label || it.part).join(", ")}`)
        : no("the branch path is rigid end to end — it cannot get back to the rejoin tee");
    },
  },
  {
    id: "splitPathsCloseOnASwivel",
    describe: "both split paths land on the rejoin tee through a flare swivel — a tapered thread there cannot be made up",
    view: "any",
    run({ SYSTEM }) {
      const sp = splitOf(SYSTEM, "L3");
      if (!sp) return no("L3's split is gone");
      // The rejoin tee is held by BOTH paths at once, so by the time you close the
      // second one there is nothing left free to rotate. A flare nut tightens
      // without rotating what it grips; a tapered pipe thread does not. Hence the
      // flare tee on the output side. This is the other half of why L3 keeps any
      // flare at all, and it is invisible to the port linter, which is happy to
      // mate an NPT male into an NPT female that can never be turned.
      const bad = [["a", sp.a], ["b", sp.b]]
        .filter(([, p]) => p && p.length)
        .filter(([, p]) => { const last = p[p.length - 1]; return !last || last.j !== "flare"; });
      return bad.length
        ? no("path " + bad.map(([n, p]) => `${n} closes on ${p[p.length - 1].j || p[p.length - 1].p}`).join("; "))
        : ok("both paths close on a flare swivel");
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
    describe: "L4b order: check valve -> pilot tee -> accumulator stack",
    view: "any",
    run({ SYSTEM, PARTS }) {
      // CV-1 blocks backflow toward the regulator. The pilot tees off DOWNSTREAM
      // of CV-1 and UPSTREAM of the accumulator, so on a normal shutdown the
      // vessel bleeds down through the continuously-burning pilot instead of
      // sitting charged. The isolation valve moved INTO the stack and has its own
      // invariant (accumulatorKeepsItsRelief) — this one is about the supply run.
      const L = line(SYSTEM, "L4b");
      if (!L) return no("L4b is gone");
      const at = (f) => L.items.findIndex(f);
      const iCheck = at((i) => i.p && PARTS[i.p] && PARTS[i.p].sym === "check");
      const iPilot = at((i) => i.branch && i.branch.ref === "D");
      const iAccum = at((i) => i.j === "riser");
      const seq = [iCheck, iPilot, iAccum];
      const named = `check=${iCheck} pilotTee=${iPilot} accumulatorStack=${iAccum}`;
      if (seq.some((i) => i < 0)) return no("missing element: " + named);
      const sorted = seq.every((v, i) => i === 0 || seq[i - 1] < v);
      return sorted ? ok(named) : no("out of order: " + named);
    },
  },
  {
    // V-3 stopped being an e-stop when the poofer got killed at V-2 with
    // everything else. What replaces that check is the property the valve is
    // actually FOR: it isolates the vessel from the supply and the dump valve,
    // and from nothing else. The relief must stay on the vessel side of it.
    id: "accumulatorKeepsItsRelief",
    describe: "the accumulator isolation valve cannot shut the vessel off from its own relief",
    view: "any",
    run({ SYSTEM, PARTS }) {
      const stack = accStack(SYSTEM, "L4b");
      if (!stack) return no("L4b has no accumulator stack");
      const at = (f) => stack.findIndex(f);
      // reading DOWN from the supply tee: isolation valve, then the OPD tee,
      // then the vessel. Anything between the valve and the vessel is protected.
      const iBall = at((i) => i.p && PARTS[i.p] && PARTS[i.p].sym === "ball");
      const iRelief = at((i) => i.mount && i.mount.p === "relief");
      const iTank = at((i) => i.p && PARTS[i.p] && PARTS[i.p].sym === "tank");
      const named = `isolation=${iBall} relief=${iRelief} vessel=${iTank}`;
      if ([iBall, iRelief, iTank].some((i) => i < 0)) return no("missing element: " + named);
      return iBall < iRelief && iRelief < iTank
        ? ok("the relief sits between the isolation valve and the vessel: " + named)
        : no("the relief can be isolated from the vessel: " + named);
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
      // "Tees off before the split" read from SYSTEM, not from a pentagon LETTER
      // and not from TREE: the letters get relettered and TREE describes the
      // whole system, while the drawing is now cut into sheets.
      const L3 = line(SYSTEM, "L3");
      const jetRef = L.items[0] && L.items[0].ref;
      const iTee = L3 ? L3.items.findIndex((i) => i.branch && i.branch.ref === jetRef) : -1;
      const iSplit = L3 ? L3.items.findIndex((i) => i.split) : -1;
      const teed = iTee >= 0 && iSplit >= 0 && iTee < iSplit;
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

module.exports = { INVARIANTS, evaluateAll, evaluateOne, eachItem, sequences, line, splitOf, meteredPath, drawnParts, textsOf, stripTags };
