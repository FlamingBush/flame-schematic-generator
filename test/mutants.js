// Mutation testing for test/invariants.js — run: node test/mutants.js
//
// A CHECK MUST BE ABLE TO FAIL. Every invariant here is paired with a mutation
// of the DATA that turns it red, and three gates keep it that way:
//
//   1. FORWARD  — every mutant flips its invariant to ok:false (and, where an
//                 expectDetail is given, for the stated reason).
//   2. COVERAGE — every exported invariant id has at least one mutant. This is
//                 what makes "a named invariant MUST have a paired mutation"
//                 enforceable rather than prose in CLAUDE.md.
//   3. REVERSE  — every mutant names a real invariant id, so a typo cannot
//                 silently satisfy gate 2.
//
// Two mutation shapes, mirroring how the app is actually driven:
//   viaJSON — edit the JSON in the editor box and applyJSON() (reassigns
//             SYSTEM/PARTS, exactly as a user edit does)
//   viaApp  — mutate app.PARTS / app.PN_SYM / app.NO_RATING_SYM in place and
//             renderAll() (the sets are const and mutated in place, so this
//             reaches the renderer)
"use strict";
const { loadApp } = require("./harness");
const { INVARIANTS, evaluateOne } = require("./invariants");

/* ---------- mutation shapes ---------- */

function viaJSON(mutate) {
  const { store, app } = loadApp();
  const o = JSON.parse(store["jsonBox"].value);
  mutate(o);
  store["jsonBox"].value = JSON.stringify(o);
  store["strips"].children.length = 0;
  app.applyJSON();
  // A mutation the app refused to load is a mutation that proves nothing.
  const msg = store["jsonMsg"].textContent;
  if (msg !== "Re-rendered.") throw new Error(`applyJSON refused the mutation: ${msg}`);
  return { store, app };
}

function viaApp(mutate) {
  const { store, app } = loadApp();
  mutate(app);
  app.renderAll();
  return { store, app };
}

/* ---------- helpers over the default system ---------- */

const line = (o, id) => o.SYSTEM.lines.find((L) => L.id === id);
const idxOf = (L, f) => L.items.findIndex(f);
const splitOf = (L) => L.items.find((it) => it.split).split;
// the metered path is the one carrying the needle valve, whichever letter it is
const meteredOf = (o, id) => { const sp = splitOf(line(o, id)); return [sp.a, sp.b].find((p) => (p || []).some((it) => /^needle/.test(it.p || ""))); };

/* ---------- the mutation table ---------- */

const MUTANTS = [
  /* --- the six port-linter defect classes found by hand review --- */
  {
    invariantId: "portLinterClean",
    name: "female-to-female NPT drawn without a nipple (the original PRV-1 bug)",
    kind: "json",
    expectDetail: "needs a nipple",
    mutate(o) {
      // Delete the hex nipple feeding the regulator: an FNPT tee outlet then
      // faces an FNPT regulator inlet with a bare M▸F marker between them.
      const L1 = line(o, "L1");
      L1.items[idxOf(L1, (it) => it.p === "reg60") - 1] = { j: "npt", size: "1/4", lr: "M>F" };
    },
  },
  {
    invariantId: "portLinterClean",
    name: "missing adapter — a hose flare lands straight on an NPT port",
    kind: "json",
    expectDetail: "adapter part is missing",
    mutate(o) {
      const L1 = line(o, "L1");
      L1.items.splice(idxOf(L1, (it) => it.tag === "F-13"), 1);
    },
  },
  {
    invariantId: "portLinterClean",
    name: "size discontinuity — a 1/4 joint drawn against the 3/8 mixer inlet",
    kind: "json",
    expectDetail: "but the",
    mutate(o) {
      const L = line(o, "L3b");
      L.items[idxOf(L, (it) => it.p === "mixer") - 1] = { j: "npt", size: "1/4", lr: "M>F" };
    },
  },
  {
    invariantId: "portLinterClean",
    name: "wrong joint type — NPT drawn where both ends are flare",
    kind: "json",
    expectDetail: "NPT joint drawn on a flare end",
    // Seeded on the first flare joint L1 still has (a hose swivel), not on a
    // fitting tag: the depot's thread landscape changes, flare-vs-NPT is the point.
    mutate(o) {
      const L1 = line(o, "L1");
      L1.items[idxOf(L1, (it) => it.j === "flare")] = { j: "npt", size: "1/4", lr: "M>F" };
    },
  },
  {
    invariantId: "portLinterClean",
    name: "backwards thread-direction arrow — M ▸ F where the male port is downstream",
    kind: "json",
    expectDetail: "male port is upstream",
    // Anchored on the ARROW, not on a tag: any legitimate re-plumbing of L1 that
    // still draws a male-upstream NPT joint keeps this defect class seeded.
    mutate(o) {
      const L1 = line(o, "L1");
      delete L1.items[idxOf(L1, (it) => it.j === "npt" && it.lr === "M>F")].lr;
    },
  },
  {
    invariantId: "portLinterClean",
    name: "a reversible adapter installed backwards (rev flag dropped)",
    kind: "json",
    expectDetail: "NPT joint drawn on a flare end",
    // The one rev’d adapter left: the split’s branch-path half union. Dropping rev
    // turns its cone upstream, so the NPT joint ahead of it lands on a flare end.
    mutate(o) {
      delete splitOf(line(o, "L3")).b.find((it) => it.p === "flare14npt" && it.rev).rev;
    },
  },

  /* --- the linter's verdict must actually reach the compliance table --- */
  {
    invariantId: "linterSurfacesAsFit1",
    name: "a seeded junction defect must drop FIT-1 out of DESIGN PASS",
    kind: "json",
    expectDetail: "impossible or under-specified junction(s)",
    mutate(o) {
      const L1 = line(o, "L1");
      L1.items[idxOf(L1, (it) => it.p === "reg60") - 1] = { j: "npt", size: "1/4", lr: "M>F" };
    },
  },

  /* --- purchasing --- */
  {
    invariantId: "everyPartReachesTheSchedule",
    name: "a nipple hung on a flare joint — buildRefs only registers hose|tube|npt parts",
    kind: "json",
    expectDetail: "cu12",
    // The latent bug: {j:"flare", part:"x"} is a purchase that silently never
    // reaches the parts schedule. Anchored on a part used EXACTLY ONCE, so the
    // schedule entry disappears entirely rather than surviving on another line.
    // (nipple1412 held that role until the 1/2 solenoids needed four more of them.)
    mutate(o) {
      const L = line(o, "L1c");
      const i = idxOf(L, (it) => it.part === "cu12");
      L.items[i] = { j: "flare", size: L.items[i].size, part: "cu12" };
    },
  },
  {
    invariantId: "noAdapterDeclarations",
    name: "a note-only adapter declaration creeps back in",
    kind: "json",
    expectDetail: "adaptIn",
    mutate(o) {
      const L = line(o, "L1c");
      L.items[idxOf(L, (it) => it.tag === "CV-1")].adaptIn = "npt:1/4:M>npt:1/4:F";
    },
  },
  {
    invariantId: "removedFeaturesStayRemoved",
    name: "a verification chip re-grows in the parts schedule",
    kind: "app",
    expectDetail: "schedule re-grew",
    mutate(app) {
      app.getPARTS().ball14.spec += " STATUS VERIFY PN";
    },
  },

  /* --- what the external sheet may and may not say --- */
  {
    invariantId: "externalNoDesignations",
    name: "an equipment designation written into a note (notes are not deTag'd)",
    kind: "json",
    expectDetail: "SV-9",
    mutate(o) {
      // NV-2 lives on the pilot tee's rising branch stub, not on a line of its own
      const stub = line(o, "L1c").items.find((it) => it.branchUp).branchUp;
      stub.find((it) => it.tag === "NV-2").note = "trips with SV-9";
    },
  },
  {
    invariantId: "ballValvesNoPnOnDrawing",
    name: "ball valves added to PN_SYM — the Apollo number lands on the drawing",
    kind: "app",
    expectDetail: "maker or part number on the drawing: ball14",
    mutate(app) { app.PN_SYM.add("ball"); },
  },
  {
    // The band title always renders, in both views and on every sheet — an off
    // label may be swallowed by "to sheet n" before it ever reaches the drawing.
    invariantId: "noLineIdsOnTheDrawing",
    name: "a line's title names its own id — the drawing keys to the JSON's numbering",
    kind: "json",
    expectDetail: "drawn on the sheet",
    mutate(o) { const L = line(o, "L3"); L.title = `${L.id} main bush branch`; },
  },
  {
    invariantId: "hosesMarkTheirWorkingPressure",
    name: "the hose loses its published working pressure — the cell stops marking one",
    kind: "app",
    expectDetail: "state no working pressure",
    mutate(app) { app.getPARTS().hoseLP.rating = null; },
  },
  {
    invariantId: "partsThatCanFailPrintTheirRating",
    name: "solenoids added to NO_RATING_SYM — a valve that can fail states no rating",
    kind: "app",
    expectDetail: "states no rating",
    mutate(app) { app.NO_RATING_SYM.add("sol"); },
  },
  {
    invariantId: "gaugeCellsHideTheBodyRating",
    name: "gauges pulled back out of NO_RATING_SYM — the 300 psi body rating lands beside every range",
    kind: "app",
    expectDetail: "bare body rating",
    mutate(app) { app.NO_RATING_SYM.delete("gauge"); },
  },
  {
    invariantId: "pnAlwaysNamesItsMaker",
    name: "a solenoid loses its mfg — a bare catalog number identifies nothing",
    kind: "app",
    expectDetail: "sol12",
    mutate(app) { delete app.getPARTS().sol12.mfg; },
  },
  {
    // pnAlone is an escape hatch from the rule above, so it needs its own gate:
    // an Amazon listing id can never stand on its own, whatever the data claims.
    invariantId: "pnAlwaysNamesItsMaker",
    name: "an ASIN declared pnAlone — a listing id printed with no seller identifies nothing",
    kind: "app",
    expectDetail: "an ASIN cannot stand alone",
    mutate(app) { app.getPARTS().sol12.pnAlone = true; },
  },
  {
    invariantId: "marketplacePartsFlaggedAsin",
    name: "the asin flag is dropped — an Amazon listing id reads as a Beduan catalog number",
    kind: "app",
    expectDetail: "sol12",
    mutate(app) { delete app.getPARTS().sol12.asin; },
  },
  {
    invariantId: "vesselStatesSpec",
    name: "the accumulator's note is deleted — the vessel regresses to name + rating",
    kind: "json",
    expectDetail: "regressed to name + rating",
    mutate(o) {
      const st = line(o, "L1c").items.find((it) => it.j === "riser").down;
      delete st.find((it) => it.p === "accum").note;
    },
  },
  {
    invariantId: "internalHidesMfrPn",
    name: "a manufacturer part number leaks into a note on the internal packet",
    kind: "json",
    expectDetail: "sol12",
    mutate(o) {
      const L = line(o, "L1c");
      L.items[idxOf(L, (it) => it.tag === "SV-2")].note = "poof dump · B07N6246YB";
    },
  },

  /* --- the compliance engine's reading of a rating: null is not zero --- */
  // Mutate a part whose rating actually REACHES the drawing (a regulator, in
  // PN_SYM), so the `drawing=` clause of the detail stays meaningful. Ball
  // valves print no rating any more, so they can no longer prove this.
  {
    invariantId: "ratingsReportedCorrectly",
    name: "an unrated part must read as unpublished, never as under-rated (null < op is true in JS)",
    kind: "app",
    // Seeded on a SOLENOID, not a regulator: this mutation asserts all four
    // surfaces, and the drawing is one of them. Regulators are standard parts and
    // print no rating at all now, so a null there never reaches the sheet.
    expectDetail: "compliance=unpublished; fe2=REVIEW; schedule=not published; drawing=no published rating",
    mutate(app) { app.getPARTS().sol12.rating = null; },
  },
  {
    invariantId: "ratingsReportedCorrectly",
    name: "a genuinely under-rated part is still caught",
    kind: "app",
    expectDetail: "compliance=under-rated",
    mutate(app) { app.getPARTS().reg60.rating = 5; },
  },

  /* --- the flare decision --- */
  {
    invariantId: "needleValvesOutRateHighestRelief",
    name: "a needle valve rated below the relief that caps its zone",
    kind: "app",
    expectDetail: "needle@50",
    mutate(app) { app.getPARTS().needle.rating = 50; },
  },
  {
    invariantId: "gaugesPrintTheirRange",
    name: "a gauge loses its range, leaving only the 300 psi body rating to identify it",
    kind: "json",
    expectDetail: "gauge30",
    mutate(o) { o.PARTS.gauge30.name = "Pressure gauge"; },
  },
  {
    invariantId: "noInchesOnTheSheet",
    name: "a part name written with inches",
    kind: "json",
    expectDetail: "1/4 in",
    // Must be a TEE: tees are the cells that print their name past the first
    // comma, so "Ball valve, 1/4 in FNPT" would render as "Ball valve" and the
    // mutation would never reach the sheet.
    mutate(o) { o.PARTS.nptTee.name = "Tee, 1/4 in FNPT"; },
  },
  {
    // The bug that shipped: a rigid valve screwed straight onto both branch
    // bosses. Lints clean, renders fine, cannot be built.
    invariantId: "splitBranchPathTurnsAround",
    name: "the branch path stripped back to a rigid chain between the two bosses",
    kind: "json",
    expectDetail: "rigid end to end",
    mutate(o) {
      splitOf(line(o, "L3")).b = [{ j: "npt", size: "1/4", lr: "M>F" }, { p: "sol14", tag: "SV-9" }, { j: "npt", size: "1/4" }];
    },
  },
  {
    // The other half: nothing left free to rotate when the last thread is made up.
    invariantId: "splitPathsCloseOnASwivel",
    name: "a split path closing on a tapered thread instead of a flare nut",
    kind: "json",
    expectDetail: "closes on npt",
    mutate(o) {
      const p = splitOf(line(o, "L3")).a;
      p[p.length - 1] = { j: "npt", size: "1/4", lr: "M>F" };
    },
  },
  {
    invariantId: "splitMeteredPathNeedleOnly",
    name: "a solenoid dropped into the metered path",
    kind: "json",
    expectDetail: "SV-9",
    mutate(o) { meteredOf(o, "L3").push({ p: "sol14", tag: "SV-9" }); },
  },

  {
    invariantId: "branchesDownstreamOfTheMainShutoff",
    name: "the poofer tee moved back upstream of the main shut-off (the real defect)",
    kind: "json",
    expectDetail: "V-2 does not cut: branch A",
    mutate(o) {
      // Both are FNPT and both are flanked by hex nipples, so the system stays
      // lint-clean: only the SAFETY property breaks. That is exactly why the
      // port linter never caught this and an invariant has to.
      const L = line(o, "L1");
      const iV = idxOf(L, (it) => it.tag === "V-2"), iT = idxOf(L, (it) => it.tag === "F-7");
      [L.items[iV], L.items[iT]] = [L.items[iT], L.items[iV]];
    },
  },

  /* --- L1c's order is the design --- */
  {
    invariantId: "l1cOrder",
    name: "the pilot tee moved below the accumulator (the vessel can no longer bleed down through it)",
    kind: "json",
    expectDetail: "out of order",
    mutate(o) {
      const L = line(o, "L1c");
      const iR = idxOf(L, (it) => it.j === "riser"), iT = idxOf(L, (it) => it.tag === "F-6");
      [L.items[iR], L.items[iT]] = [L.items[iT], L.items[iR]];
    },
  },
  {
    invariantId: "accumulatorKeepsItsRelief",
    name: "the isolation valve dropped below the OPD tee — a charged vessel can be shut off from its relief",
    kind: "json",
    expectDetail: "can be isolated from the vessel",
    mutate(o) {
      const st = line(o, "L1c").items.find((it) => it.j === "riser").down;
      const iB = st.findIndex((i) => i.tag === "V-3"), iR = st.findIndex((i) => i.mount && /^relief/.test(i.mount.p || ""));
      [st[iB], st[iR]] = [st[iR], st[iB]];
    },
  },
  {
    invariantId: "pilotTeeScrewsInWithoutANipple",
    name: "a hex nipple inserted ahead of the street tee",
    kind: "json",
    expectDetail: "a nipple sits between",
    mutate(o) {
      const L = line(o, "L1c");
      L.items[idxOf(L, (it) => it.tag === "F-6") - 1].part = "nipple14";
    },
  },
  {
    invariantId: "pilotTeeScrewsInWithoutANipple",
    name: "the street tee respecced female-inlet — it can no longer screw into the valve",
    kind: "app",
    expectDetail: "two like genders cannot mate",
    mutate(app) { app.getPARTS().teeStreet14.ports.i = "npt:1/4:F"; },
  },
  {
    invariantId: "jetPathSeriesOrder",
    name: "the jet solenoid moved upstream of its needle valve",
    kind: "json",
    expectDetail: "out of order",
    mutate(o) {
      const L = line(o, "L3b");
      const iN = idxOf(L, (it) => it.tag === "NV-4"), iS = idxOf(L, (it) => it.tag === "SV-3");
      [L.items[iN], L.items[iS]] = [L.items[iS], L.items[iN]];
    },
  },
];

/* ---------- the three gates ---------- */

if (require.main === module) {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const good = (s) => { pass++; console.log("  ✓", s); };
  const bad = (s, d) => { fail++; console.log("  ✗", s, d ? "— " + d : ""); };

  const byId = new Map(INVARIANTS.map((i) => [i.id, i]));

  console.log("GATE 3 — every mutant names a real invariant");
  const unknown = MUTANTS.filter((m) => !byId.has(m.invariantId));
  unknown.length
    ? bad("no mutant names an unknown invariant id", unknown.map((m) => m.invariantId).join(", "))
    : good(`all ${MUTANTS.length} mutants name a real invariant`);

  console.log("\nGATE 2 — every invariant has a paired mutation");
  const covered = new Set(MUTANTS.map((m) => m.invariantId));
  const naked = INVARIANTS.filter((i) => !covered.has(i.id));
  naked.length
    ? bad("every invariant has >=1 mutant", "no mutation can falsify: " + naked.map((i) => i.id).join(", "))
    : good(`all ${INVARIANTS.length} invariants have a paired mutation`);

  console.log("\nGATE 1 — every mutation turns its invariant red");
  MUTANTS.filter((m) => byId.has(m.invariantId)).forEach((m) => {
    const inv = byId.get(m.invariantId);
    const label = `${m.invariantId}: ${m.name}`;
    let res;
    try {
      const { store, app } = m.kind === "json" ? viaJSON(m.mutate) : viaApp(m.mutate);
      res = evaluateOne(app, store, inv);
    } catch (err) {
      bad(label, "the mutation itself threw: " + (err && err.message));
      return;
    }
    // A predicate that throws is a fragile predicate, not a clean red.
    if (res.threw) return bad(label, "the invariant " + res.detail);
    if (res.ok) return bad(label, "invariant stayed GREEN — it cannot fail, so it guards nothing");
    if (m.expectDetail && !res.detail.includes(m.expectDetail))
      return bad(label, `went red for the wrong reason\n      expected: ${m.expectDetail}\n      actual:   ${res.detail}`);
    good(label);
  });

  const ms = Date.now() - t0;
  console.log(`\n${pass} passed, ${fail} failed  (${MUTANTS.length} mutants, ${ms} ms)`);
  if (ms > 1000) console.log(`  ! mutation budget exceeded: ${ms} ms > 1000 ms`);
  process.exit(fail ? 1 : 0);
}

module.exports = { MUTANTS, viaJSON, viaApp };
