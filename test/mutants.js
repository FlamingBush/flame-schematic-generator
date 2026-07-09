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
    mutate(o) {
      const L1 = line(o, "L1");
      L1.items[idxOf(L1, (it) => it.tag === "F-2") + 1] = { j: "npt", size: "1/4", lr: "M>F" };
    },
  },
  {
    invariantId: "portLinterClean",
    name: "backwards thread-direction arrow — M ▸ F where the male port is downstream",
    kind: "json",
    expectDetail: "male port is upstream",
    mutate(o) {
      const L1 = line(o, "L1");
      L1.items[idxOf(L1, (it) => it.tag === "F-8") + 1] = { j: "npt", size: "1/4" };
    },
  },
  {
    invariantId: "portLinterClean",
    name: "a reversible adapter installed backwards (rev flag dropped)",
    kind: "json",
    expectDetail: "NPT joint drawn on a flare end",
    mutate(o) {
      const L = line(o, "L3b");
      delete L.items.find((it) => it.p === "flare14npt" && it.rev).rev;
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
    expectDetail: "nipple1412",
    mutate(o) {
      // The latent bug: {j:"flare", part:"x"} is a purchase that silently never
      // reaches the parts schedule. nipple1412 is used exactly once, so the
      // schedule entry disappears entirely.
      const L = line(o, "L4b");
      const i = idxOf(L, (it) => it.part === "nipple1412");
      L.items[i] = { j: "flare", size: L.items[i].size, part: "nipple1412" };
    },
  },
  {
    invariantId: "noAdapterDeclarations",
    name: "a note-only adapter declaration creeps back in",
    kind: "json",
    expectDetail: "adaptIn",
    mutate(o) {
      const L = line(o, "L4b");
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
      const L = line(o, "L4a");
      L.items[idxOf(L, (it) => it.tag === "NV-2")].note = "trips with SV-9";
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
    invariantId: "pnAlwaysNamesItsMaker",
    name: "a solenoid loses its mfg — a bare catalog number identifies nothing",
    kind: "app",
    expectDetail: "sol14",
    mutate(app) { delete app.getPARTS().sol14.mfg; },
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
      const L = line(o, "L4b");
      delete L.items[idxOf(L, (it) => it.j === "riser")].tee.mount.note;
    },
  },
  {
    invariantId: "internalHidesMfrPn",
    name: "a manufacturer part number leaks into a note on the internal packet",
    kind: "json",
    expectDetail: "sol12",
    mutate(o) {
      const L = line(o, "L4b");
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
    expectDetail: "compliance=unpublished; fe2=REVIEW; schedule=not published; drawing=no published rating",
    mutate(app) { app.getPARTS().reg60.rating = null; },
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
    invariantId: "flareValvesFlankedByBareFlareJoints",
    name: "an adapter installed beside a flare needle valve",
    kind: "json",
    expectDetail: "NV-2",
    mutate(o) {
      const L = line(o, "L4a");
      L.items.splice(idxOf(L, (it) => it.tag === "NV-2"), 0, { p: "flare14npt", tag: "F-X" });
    },
  },
  {
    invariantId: "flareValvesMaleConesBothEnds",
    name: "a flare valve respecced female-ended — two swivels cannot seal on each other",
    kind: "app",
    expectDetail: "needleFlare14",
    mutate(app) { app.getPARTS().needleFlare14.ports.o = "flare:1/4:F"; },
  },
  {
    invariantId: "flareValvesOutRateHighestRelief",
    name: "a needle valve rated below the relief that caps its zone",
    kind: "app",
    expectDetail: "needleFlare14@50",
    mutate(app) { app.getPARTS().needleFlare14.rating = 50; },
  },
  {
    invariantId: "pilotLineBuysNoFittings",
    name: "a hex nipple bought for the pilot line",
    kind: "json",
    expectDetail: "nipple14",
    mutate(o) {
      const L = line(o, "L4a");
      L.items.splice(idxOf(L, (it) => it.tag === "PL-2"), 0, { j: "npt", size: "1/4", part: "nipple14", lr: "M>F" });
    },
  },
  {
    invariantId: "splitPathsBuyNoFittings",
    name: "an adapter bought for the split's metered run",
    kind: "json",
    expectDetail: "flare14npt",
    mutate(o) { meteredOf(o, "L3").push({ p: "flare14npt", tag: "F-M" }); },
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
    expectDetail: "V-2 does not cut: branch B",
    mutate(o) {
      // Both are FNPT and both are flanked by hex nipples, so the system stays
      // lint-clean: only the SAFETY property breaks. That is exactly why the
      // port linter never caught this and an invariant has to.
      const L = line(o, "L1");
      const iV = idxOf(L, (it) => it.tag === "V-2"), iT = idxOf(L, (it) => it.tag === "F-7");
      [L.items[iV], L.items[iT]] = [L.items[iT], L.items[iV]];
    },
  },

  /* --- L4b's order is the design --- */
  {
    invariantId: "l4bOrder",
    name: "V-3 moved downstream of the pilot tee (closing it no longer cuts the pilot)",
    kind: "json",
    expectDetail: "out of order",
    mutate(o) {
      const L = line(o, "L4b");
      const iV = idxOf(L, (it) => it.tag === "V-3"), iT = idxOf(L, (it) => it.tag === "F-6");
      [L.items[iV], L.items[iT]] = [L.items[iT], L.items[iV]];
    },
  },
  {
    invariantId: "eStopCutsPilotAndAccumulator",
    name: "the isolation valve loses its emergency marking",
    kind: "json",
    expectDetail: "not marked emergency",
    mutate(o) { delete line(o, "L4b").items[idxOf(line(o, "L4b"), (it) => it.tag === "V-3")].emergency; },
  },
  {
    invariantId: "pilotTeeScrewsInWithoutANipple",
    name: "a hex nipple inserted ahead of the street tee",
    kind: "json",
    expectDetail: "a nipple sits between",
    mutate(o) {
      const L = line(o, "L4b");
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
