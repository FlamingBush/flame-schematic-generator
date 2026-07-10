# Flame effect schematic generator

Single-file HTML tool (`fast_schematic_generator.html`) that renders LP-gas flame
effect plumbing schematics for Burning Man FAST review packets. Everything —
data, layout engine, compliance checks, SVG export — lives in the one file's
`<script>` block by design, so an artist can open it from disk with no build step.

## Commands

- `npm test` — the full suite: `test/run-tests.js` (invariants + geometry +
  goldens) then `test/mutants.js` (the mutation gates). Run after ANY change.
- `npm run approve` — regenerate `test/approved/drawing-{external,internal}.svg`
  after an INTENTIONAL drawing change. Prints how many chunks you are waving
  through, rasterizes both views, and refuses to run under CI. Look at the PNG.
- `python3 scripts/validate_svg.py` — strict XML validation of the exported SVG
  (stdlib only); rasterizes to PNG if cairosvg is installed. When changing layout
  or symbols, rasterize and actually look at the PNG — several past bugs were
  only visible, not logical. (cairosvg is NOT installed here; use `rsvg-convert`,
  which is what `npm run approve` calls.)

## Architecture (inside the HTML `<script>`)

1. `PARTS` — parts library. Each entry: name, vendor, pn, spec text, pressure
   rating, symbol key, drawing proportions (`w`/`h`). (There is no `verified`
   flag or status chip any more — Marcus removed them — but specs must still
   be grounded in vaulted vendor documents via `psrc`.) `vendor` is the
   schedule's "VENDOR / CATALOG" string and may name a marketplace or a
   distributor; `mfg` is the MANUFACTURER, and it is what the drawing prints
   beside a part number — a bare catalog number identifies nothing (Marcus).
   `asin:true` marks a `pn` that is an Amazon listing id rather than a
   manufacturer part number; it renders as "ASIN B08C2NLPR5" everywhere, or
   "Beduan B08C2NLPR5" would read as a Beduan catalog number and the wrong part
   gets bought. A part with an `mfg` but no `pn` (the SENCTRL gauges) still
   shows its make. `rating:null` means the
   VENDOR PUBLISHES NO RATING — never invent one. Null is not zero: `null < op`
   is `true` in JS, so every rating comparison must test `typeof r === "number"`
   first or an unrated part silently reports as "rated below segment pressure".
   FE-2 separates the two cases and the schedule prints "not published".
2. `SYSTEM` — the system definition: `meta` + `lines[]`. Each line has an
   operating pressure `op` (used by compliance checks) and an ordered `items[]`
   sequence alternating components (`{p, tag, note, emergency, xn}`) and joints
   (`{j: npt|flare|pol|hose|tube|off, ...}`). Three structured constructs:
   `{split:{tee, rejoin, a:[...], b:[...]}}` draws two parallel paths between
   two tees (path b on a full row grid one `PAR_DY` below, entered/left through
   the same reserved corridors drops use). A TEE HAS THREE PORTS: path **a**
   continues through the tee's RUN (`ports.o` → `rejoin.ports.i`), path **b**
   leaves through its BRANCH (`tee.branch` → `rejoin.branch`). `lintPorts`
   models it that way. It used to feed BOTH paths from the outlet, which only
   ever looked right because a plain flare tee carries identical male cones on
   all three ports — it could never catch a branch-port mismatch. Which path is
   "the metered one" is therefore a port-model detail: identify it by the needle
   valve it carries, never by its letter (`meteredPath()` in invariants.js).
   `{j:"riser", tee:{...}}` turns
   the band's remaining items into a vertical bottom→top discharge stack (TROW
   mini-grid, `rotate(-90)` symbols, tanks/heads stay upright; `bandUp()`
   reserves the headroom above the strip); and `{j:"turn"}` marks the end of a
   vertical SUPPLY STACK — every item before it renders bottom→top BELOW the
   band centerline (`drawSupply`, same TROW mini-grid), the run turns through
   a bare curve at the centerline (Marcus: no elbow fitting — the NTS line
   just bends). THE CORNER OVERDRAWS THE LAST STACK CELL. A plain joint survives
   there (a hex nipple, or the copper squiggle that used to sit there), but a
   part with a symbol — especially one with a `mount` on its boss — does not:
   putting the tank-pressure gauge tee at the corner made the bend swallow both
   the tee and its gauge. The collision test never saw it, because it compares
   TEXT boxes, not symbols. End the stack on a joint and let the first
   horizontal cell carry the fitting. The band continues horizontally after.
   Cylinders in a stack connect through
   their TOP valve only — never draw the run through a tank body. `xn:n` on a
   part draws n copies of the symbol side by side (standby rail tips, the two
   cylinders) under one balloon. `rev:true` on a part item installs the same
   fitting in the opposite flow direction — the port linter swaps its `i`/`o`
   ends and one schedule row serves both orientations. (The `chk:true` joint
   flag, which appended a `*` for "gauge-check the thread on receipt", is GONE —
   Marcus has the solenoids in hand and they gauge as NPT, so the asterisks, the
   GENERAL NOTES footnote and the `chkJointsMarked` invariant all went with it.)
   `mount:{..., via:"part"}` hangs a mount through an adapter (the
   accumulator's NGT boss bushing) — drawn as a hex on the hanger stub with
   its own balloon (riser base only). A ref with MULTIPLE producers is a
   DELIBERATE idiom, not an error: every port marked with that ref renders
   the plain pentagon and the consumer line renders once as an orphan strip
   at the bottom — how the ×3 standby tip runs are drawn once (ref "T").
   Cell labels carry part numbers at the end — except adapters, pipe/hose
   sections, and handmade tips, which don't need them (Marcus).
3. System tree (`deriveTree`) — the drawing is CONNECTED, not letter-matched.
   The existing `ref` fields are pure match keys: `branch:{ref}` on a tee pairs
   with a line whose first item is `{j:"off", dir:"in", ref}`. Every line is a
   horizontal BAND; the root line (first one not starting with an off-in) is
   the outermost band. A band whose LAST item is a 1:1 off-out chains its
   consumer into the same band (`TREE.chain`, seam title + fresh dashed box
   mid-band — how L1+L2 and L4+L4b each read as one run while keeping
   separate `op` pressures); matched tees hang their consumer band below the
   host band's whole row block (kind "drop") — the connector leaves straight
   DOWN from the tee glyph (drop-host cells move their text right of the
   symbol to keep that column clear); a terminal off-out with `fan:n` hangs
   its consumer with a one-of-n badge (kind "end", S-routed on the right).
   Unmatched refs degrade to the classic pentagon; unreachable lines render
   as standalone strips at the bottom — nothing throws on hostile data.
   Dashed rounded boxes group every numbered line's components per row; keep
   them clear of text rows.
4. Layout engine — the important invariants. Every band renders on the FIXED
   ROW GRID (`ROW`): balloon row / joint-spec row / centerline `CL` /
   joint-detail row / tag row / two note rows; cell widths are computed from
   the widest label (`measure()`), so labels cannot collide. ONLY THE ROOT
   band wraps, into AT MOST TWO rows — one `data-loop` loop-back through the
   row gap (return line at the gap bottom, above the next row's riser
   headroom `row.up`); more folds were tried and made the sheet unreadable,
   and branch bands must NEVER wrap (Marcus: "don't mess with the bottom
   bulk"). The default sheet no longer folds at all — the supply stack
   absorbs the run's length (`row.down` grows the first row downward, like
   `hasSplit`); the fold machinery stays covered by the FORCED WRAP test.
   The area right of the stack is a POCKET, not dead space: branch bands
   tuck up into it (`placeBand` starts drops below the STRIP content — drop
   tees are always right of the stack — while absX-anchored placements, the
   routed lanes and the fan band, still clear the stack itself), and the
   stack segment's dashed box notches into an L (`notchX`) so the pocket
   stays outside the box. Branch bands hang BELOW the root block in reading order: last-row
   drops descend straight under their tee (right-to-left so a later corridor
   passes left of every sibling); earlier-row drops jog left in their own row
   gap and ride a reserved left-margin lane down past the remaining rows
   (the gutter is sized in `renderSchematic` from the edge count); the
   terminal fan S-routes on the right below everything. Splits and risers
   are atomic units. Discharge risers are the one vertical construct: they reuse
   the `TROW` per-cell mini-grid (anchored at each `g.tcell`'s `data-y`),
   flowing bottom → top. Symbols are white-filled bodies over one continuous
   run line, capped 46 px above / 34 px below `CL`, and contain NO text
   whatsoever — that is what makes them rotatable (`rotate(-90)` on risers;
   tanks and flame heads stay upright). Do not reintroduce ad-hoc text
   offsets or text inside `SYM` functions — captions route to the note rows
   via `AUTONOTE` (whose flow arrows turn ↑ on risers). SYMBOL PHYSICS: never
   show fuel entering or leaving where a part has no port. The tee boss faces
   what it serves (`_bossUp` — up for mounts and unmatched branch stubs, down
   only toward a matched drop connector, sideways in stacks); manifold
   outlets fan from the right face and the continuing run is one of them; a
   gauge mounted on a regulator attaches to the reg's gauge-port circle and
   on a tee it sits on the boss, offset from the run — never draw it inline
   as if fuel flowed through it. The partless NPT glyph mirrors so the male
   taper always points from the male port into the female (`lr:"M>F"` male
   upstream, default female upstream — matching the linter). VERBOSITY: cell
   captions carry only what is unique to the item — joint direction (glyphs
   encode it), hose/tube ratings, solenoid voltage, valve style, POL thread
   and the like live in the diagram-wide GENERAL NOTES (`generalNotes()`, in
   the sheet's top-left header in both views); Marcus asked for ~70% less label
   text, so resist re-adding boilerplate to notes or AUTONOTE. A [joint][hex adapter][joint] sequence
   renders as ONE consolidated cell (markers flanking the hex, sizes in a
   single "A ▸ B" caption), not three spread-out cells.
5. Port linter (`lintPorts`) — machine check that every drawn joint is
   mechanically assemblable. `PARTS[*].ports` declares each part's end ports
   as `"type:size:gender"` strings (`flare` M = cone, F = swivel nut; size
   `"*"` = takes the tube item's size); `branch`/`gauge` declare side ports;
   `psrc` names the grounding document in `reference/vendor-data/SOURCES.md`
   (`"decl"` = declared from listing text, no fetchable catalog). Item-level
   `adaptIn`/`adaptOut`/`branchAdapt` (`"in>out"`) declare note-only adapter
   stacks; a drawn joint attaches to whichever side of such an adapter its
   thread type matches. The DEFAULT system uses none of these — every adapter
   is a drawn part (they're purchases and must reach the schedule; Marcus:
   "it's about what parts we have to buy"); the mechanism stays for
   hostile/legacy data only. The walk covers the root band chain, sub-band chains,
   splits, risers, mounts, branch edges, and orphans; custom fabrications
   without ports are counted skipped, never failed; hostile data must not
   throw. Results surface as compliance row FIT-1 and the suite seeds the
   five hand-found defect classes (F-F without nipple, missing adapter,
   size discontinuity, wrong joint type, backwards arrow) to keep them
   caught. When adding a part, declare its ports and try to vault a source
   document first (curl with a browser UA; see SOURCES.md re-fetch policy).
6. Compliance engine (`runChecks`) — rules paraphrased from the published
   Burning Man Flame Effects Guidelines, evaluated against SYSTEM data. Three
   statuses: DESIGN PASS / REVIEW / FIELD. Keep requirement text paraphrased,
   never quoted verbatim.
7. `downloadSVG()` — wraps `LAST_RENDER` (the single combined schematic SVG,
   mutated in place by `renderSchematic()` so external references stay live)
   into one standalone document, in reading order: title (with the FOR FAST
   REVIEW stamp), the "not to scale" line, `generalNotes()` — the build rules a
   reader wants BEFORE the drawing, hence the top-left header — the drawing,
   then `legendLines()`. The canvas widens if the notes or a legend line outruns
   the artwork. Both the header notes and the legend are shared with the on-page
   `#legend` div (which prepends the notes the same way).
   `legendLines()` is VIEW-DEPENDENT and asymmetric on purpose: **external is
   the pipe-style key plus the flow-orientation line, and nothing else.** Marcus
   cut the rest — the glyphs read themselves (a male taper entering a female
   box, a cone entering a swivel nut), the dashed line boxes and the orange
   flame/e-stop highlight are self-apparent, and the pentagon cross-reference
   went with them. The pipe key is the one thing that cannot go: a COLOUR is not
   self-apparent the way a glyph is. The internal packet keeps the full key
   because its balloons genuinely need decoding. Do not "restore" the external
   glyph key.
   Every interpolated string MUST pass through `esc()`; browsers forgive raw
   `&`/`<` in-page but the exported .svg must be strict XML (regression-tested).

## Two views — the sheet is TWO documents (`VIEW`, `INTERNAL()`)

The `#viewSel` toggle in the toolbar switches `VIEW` and re-renders. They are
not cosmetic variants; each is a different deliverable.

- **internal** — the working PDF packet. Balloons (`balloonCol`/`balloonRow`,
  the ONLY places a balloon is drawn, both gated on `INTERNAL()`) key each cell
  to the parts schedule's REF column, and the equipment designation (`SV-2`,
  `F-15+RV-1`) is the cell's identification line. The compliance table's tag
  references (`Shown: V-1 (L1)`) resolve against the drawing.
- **external** — the standalone SVG that is actually submitted. Nothing points
  at an off-sheet schedule, so each cell identifies ITSELF: `specLine()` prints
  `mfg` + part number for valves, regulators, and gauges only (`PN_SYM`) plus
  the pressure rating FE-2 judges it against. Fittings,
  adapters, tube, and handmade tips stay generic — Marcus: part numbers are for
  what a reviewer must be able to identify exactly. Adapters keep only their
  consolidated "A ▸ B" end-pair caption, no name and no spec line.
  The sheet may not NAME a document the reviewer does not hold — not even to
  disclaim it. "nothing keys to an off-sheet schedule" was itself a reference to
  the off-sheet schedule, and is gone. The suite sweeps the external export for
  the vocabulary `see packet | off-sheet | parts schedule | balloon`.

`external` is the DEFAULT: the safe artifact to hand someone. Both views must
hold every geometry invariant (baselines on the row grid, zero text-bbox
collisions, no text in rotated groups) — the suite asserts each separately.
A part whose `pn` is `"—"` (the SENCTRL gauges, the McMaster check valve)
correctly prints a rating and no number; that is data, not a bug.

## Hard-won constraints

- The drawing is declared "not to scale" everywhere on purpose. The `w`/`h`
  proportions in PARTS are visual only. Do not add scale claims unless the
  dimensions are replaced with real vendor spec-sheet numbers first.
- The schedule renders no verification chips, but the sourcing discipline
  stands: never state a vendor spec without a vaulted source. Confirmed so far
  against vendor data: Marshall Excelsior MEGR-6120-60 / -6120-30 regulators, confirmed
  verbatim from MEC's own bulletin (form 976): 1/4 FNPT in/out + TWO 1/4 FNPT
  gauge ports, max inlet 250 psig, UL 144 NON-relief — external overpressure
  protection flagged. Amazon ASIN B07N2LGFYS is NOT the brass 1/4 in solenoid —
  it is Beduan kl04010, an anodized-ALUMINUM air valve (115 psi, CE only); the
  brass 1/4 in candidate is B08C2NLPR5. Beduan B07N6246YB (2W160-15, 1/2 in)
  claims FNPT and the plain 2W-series model number denotes G/BSPP threads in the
  originating product line ("N" variants are NPT) — the LISTING is ambiguous,
  but Marcus has both valves in hand and they gauge as NPT, so the thread
  question is CLOSED. Do not re-add the gauge-check-on-receipt warning. What is
  still open: neither publishes seal material or a fuel-gas listing, so LP
  compatibility stays a liaison flag. Breezliy B08K8NP26L needle valves likewise
  unlisted. Anderson Metals SAE 45° flare catalog items confirmed to exist
  (LP/fuel-gas service in catalog text): 04044-04/-06 union tees, 04052-06
  four-way cross, 04059-060604/-060404 fig 509 reducing tees, 04046 fig 406
  flare x female pipe couplings, 48/54-series flare x NPT half unions (e.g.
  54048-0606). Stanbroil 3/4 in LP air mixer confirmed 3/4 MNPT in / 3/4 FNPT
  out, 300k BTU max. Aquatrol series 140 ASME relief valves are air/inert-gas
  media only — LP suitability is a liaison flag, like the solenoids.
  TWO DIFFERENT COMPANIES both stamp the legacy SAE figure numbers and both are
  called "Anderson" — cite the one you took the spec from. `anderson` =
  Anderson Metals Corp (Kansas City); `andersonfittings` = Anderson Copper &
  Brass Co (Oak Forest, IL). Both catalogs are still the source for the flare
  FITTINGS. Neither is a source for a needle valve any more.
- A CATALOG ENTRY YOU CANNOT BUY IS NOT A SOURCED PART. The Anderson Fittings
  110SAE / 115SAE flare-to-flare needle valves are DELETED. They were beautifully
  documented — p.130 drawing showing male cones both ends, p.129 "Pressure range
  up to 150 psi" — and they let the metered run and the whole pilot line buy zero
  adapters. But no distributor stocks them, and Marcus could not find so much as a
  photograph of one (Anderson Fittings is an OEM supplier; its catalog is a
  manufacturing document, not a storefront). Vaulting a PDF proved the spec, not
  the availability, and three invariants ended up defending a part nobody can hold.
  `needle` (Breezliy B08K8NP26L, 1/4 FNPT x FNPT) is now the ONLY needle valve on
  the sheet, at NV-1, NV-2 and NV-4 — Marcus owns them. When you vault a source,
  check that somebody sells the thing.
- If a run is already flare, fit a flare x flare valve rather than adapting to
  NPT and back (Marcus: cheaper and simpler). The corollary is stronger: make
  the TEES flare too and the adapters on both sides vanish. Two male flare
  cones cannot mate, so a fitting-to-fitting flare junction always needs one
  female swivel (`flareNptF` / cat. U5) or a length of tube between — check the
  gender before assuming a swap saves anything.
- THE SAME TRICK ON A BRANCH, AND THE ONE PLACE IT DOES NOT WORK: when the
  component hanging off a tee is NPT and the run is flare, do NOT adapt the
  branch — buy the tee with the thread you need on its boss. `flareTeeMpt` =
  Anderson Fittings **T1-6B** (male branch tee, 3/8 flare run x 1/4 MNPT branch,
  T1 series ref SAE 010425, cat. p.16); `TF1-6B` is the FEMALE-branch sibling.
  THIS ONLY PAYS OFF UNDER A **MOUNT** — a dead-end branch (gauge, relief) that
  never has to close. It is WRONG on a bypass, and both are currently dead PARTS
  entries for that reason.
  A BYPASS IS A LOOP, and a loop is governed by geometry, not by threads. The
  two tees' bosses face the SAME way (both toward the parallel strip); a rigid
  two-ported valve has colinear ports facing OPPOSITE ways. So the leg must turn
  90 deg at each end, and no choice of thread on the boss can turn it. It must
  also contain a swivel, because two tapered NPT threads cannot both be made up
  onto tees that the other path already holds rigid. A copper leg is both at
  once — it bends, and its flare nuts are the unions. Today L3's split runs
  `F-10 (nptTee) -> [run] nipple1412 -> SV-1 -> flare38npt12(rev) -> TB-10`
  and `F-10.branch -> nipple14 -> NV-1 -> flare14npt(rev) -> TB-12`, both
  landing on `F-11 (flareTee)`. Note the branch path is not "the bypass" any
  more — the SOLENOID took the run when it grew to 1/2 — so the geometry rule is
  stated over the BRANCH path, whichever valve happens to be on it.
  SV-1 was briefly screwed straight onto two T1-6B bosses to save the half
  unions (Marcus: "that sounds expensive"). It lints clean, renders fine, and
  cannot be built. Guarded now by `splitBranchPathTurnsAround` plus
  `splitPathsCloseOnASwivel`; the invariant that asserted *both* split paths buy
  nothing is what pinned the bug in place, and is gone entirely — its premise
  died with the flare needle valve.
- Adapter/nipple purchases: 31 -> 22 by using the catalogs properly; -> 23 when
  the poofer tee moved below the main shut-off (a safety fix worth one fitting);
  -> 24 when each cylinder got its own shut-off; -> 22 when the split tees became
  male-branch tees and the solenoid's two half unions vanished; -> 24 when
  that turned out to be unbuildable and the half unions came back; -> 23 when
  HS-1 went to an NPT-ended hose and F-2 to a pipe tee; -> **28** when L3 went
  NPT and the unbuyable flare needle valves were replaced by NPT ones. NPT costs
  nipples, and an NPT needle valve costs a half union on each side of it (the
  pilot line went from zero fittings to two); -> 31 with the 1/2 accumulator
  train; -> **29** when both 1/2 tees became street tees. THE COUNT IS NO LONGER
  THE SCORE.
  It fell from 31 to 22 while the sheet quietly acquired an unbuildable loop and
  a valve nobody sells; it rose to 28 buying assemblability and availability.
  Optimise those first and let the count land where it lands.
  Of the original three moves, one stands and two are reversed:
  (1) `POL-U2-6` takes the cylinder straight
  to a 3/8 male flare cone — REVERSED at the cylinder (see the per-cylinder
  shut-off below), still the reason nothing else adapts POL; (2) the split tees
  became plain flare tees so NV-1 could be a flare valve and its path buy nothing
  — DEAD, along with the flare needle valve itself; only `F-11` is still a flare
  tee, and now for the loop-closure reason, not the fitting-count one. Move (3) —
  `TF1-6B`, a flare tee with a 1/4 FNPT
  branch carrying the tank-pressure gauge so the stack above V-1 stayed flare —
  is REVERSED: Marcus judged the copper before the high-pressure hose "way
  easier as NPT", so F-5 is now a plain `nptTee` and `flareTeeFpt` is a dead
  PARTS entry. Fitting count did not change (the deleted flare union and the
  deleted rev'd half-union paid for the new nipple and half-union).
  The split's two half unions are NOT reducible: both valves are FNPT and both
  paths must arrive at F-11 as bendable 3/8 flare tube.
  What is left is irreducible without
  changing components: every remaining nipple joins two FEMALE NPT ports
  (ball valves, solenoids, regulators, NPT tees are all FNPT), and every
  remaining half-union is where a flare run meets an FNPT valve body.
- NEVER WRITE "FNPT" OR "MNPT" WHERE THE PART CLASS ALREADY SAYS IT (Marcus:
  "all my things are just NPT"). A nipple is male both ends; a valve body, a pipe
  tee and a cross are female. So: "Ball valve, 1/4 NPT", "Hex nipple, 1/4 NPT",
  "Tee, 1/2 NPT". Gender survives in a NAME only where it is the part's identity —
  adapters, half unions, hex bushings — because that is the whole
  thing you are buying. It also survives in `spec` prose, which is where a builder
  learns which end is male, and in `ports`, where the LINTER needs it: the gender
  model is what catches a nipple made up against a male port. Only the schedule's
  NAME column was ever the problem. `partText` no longer strips gender from tee
  names, because no drawn tee has any — a STREET tee says "male one end" in the
  word "street", so it is "Street tee, 1/2 NPT", not "1/2 MNPT x 1/2 NPT".
- NEVER WRITE INCHES. Not the word ("3/8 in tube"), not the mark ('3/8" flare').
  The fractions are DESIGNATIONS, closer to brand names than to measurements
  (Marcus) — a 3/8 flare fitting does not measure 3/8 of anything a reviewer
  cares about. So: `3/8 tube`, `1/4 FNPT`, `3/8 Cu`, `1/4 NPT ▸ 3/8 flare`. The
  one true linear dimension on the sheet, the pinpoint tip's stub, spells the
  unit out ("a 1 inch stub"). `noInchesOnTheSheet` sweeps every text node in
  both views; `frac()` no longer appends a mark and no caption may re-add one.
- Cell captions drop everything after the first comma ("Ball valve, 1/4 FNPT
  x FNPT" -> "Ball valve"; narrow beats wide). FOUR exceptions keep more: tees
  carry their exact type, the cross its exact threads, a CYLINDER its
  capacity — the drawing must read "Propane cylinder, 100 lb", because the fuel
  quantity is what the review is about and 100 lb is the fuel team's delivery
  minimum — and a GAUGE its RANGE. `sym:"tank"` keeps its full name for the
  cylinder reason; `sym:"gauge"` keeps its full name, in a mount position too,
  because the range is what identifies the instrument: `pn` is "—" and all three
  gauges share the same 300 psi body rating on the spec line, so without
  "0-30 psi" the cell cannot say which gauge it is. Guarded by
  `gaugesPrintTheirRange`, grounded in the range token so the rating cannot
  move with it. The accumulator is a MOUNT and takes the lowercased short
  name, so it is unaffected.
- The tee SYMBOL is one T-shaped path — a 30x14 run bar plus a perpendicular
  branch stub of the same wall — not a body rect with a tab glued on. Drawn as a
  single path so there is no seam across the crotch and it still rotates whole on
  a riser. It used to be 24x18, near enough a square that it read as a box.
  WIDENING THE BAR WAS NOT ENOUGH, and this is the part that matters: a MOUNT is
  drawn over the stub, so `MOUNT_LIFT` must raise it clear. Most mount symbols
  ATTACH AT CL and grow a neck upward (gauge, relief), so 13 lands that neck on
  the stub; they cannot be lifted further without crossing the 46 px headroom the
  balloon leaders need (they end at `CL-48`). The PILOT is a bare flame ball
  CENTRED on CL with no neck, so at 13 its white body sat straight over the stub
  and EVERY RAIL TEE STILL READ AS A BOX — Marcus saw no change at all. It needs
  its own radius on top (25). Any new mount whose body dips below its attachment
  point needs a `MOUNT_LIFT` entry, and the way you find out is to look at L3r.
- Cell width is the width of the caption's widest LINE, so `wrap2` breaks at the
  separator leaving the narrowest long half, NOT at the one nearest the character
  midpoint. The old rule optimised nothing visible: it put "Flare tee" alone on
  one row and "1/4 tube + pinpoint nozzle" on the next, and the rail tees
  inherited that as their pitch. " + " is a break point and keeps the plus with
  the mount it introduces.
- PIPE STYLING (`runStyle`, `jointGlyph`) — colour AND width both encode
  MATERIAL, never pressure. Hose `#334E68` slate at 3.0 px; copper `#8C5A2B`
  bronze, thickening with bore (1/4 → 2.4, 3/8 → 4.0, 1/2 → 5.2); everything
  else — brass fittings, nipples, the threaded connections either side of them —
  default ink at 2.0. The hose is NOT the fattest line (Marcus fattened the
  copper, then put the hose back); it sits BETWEEN 1/4 and 3/8 copper. Keep every
  copper width ≥0.5 px from the hose width, or a BLACK-AND-WHITE PRINT of the
  packet cannot tell the flexible weak point from rigid tube — FAST packets get
  printed, and the suite checks the separation. FLAME orange is reserved for
  flame heads and marked emergency shut-offs; no run line may borrow it.
  `jointGlyph` is the single place this is drawn — shared by the horizontal band
  cells and the rotated riser cells, so change it once. The suite enumerates the
  whole palette: a stroke colour outside
  {INK, INK2, FLAME, HOSE_C, COPPER_C, #fff} means someone invented a meaning
  nothing decodes. Widths are a VISUAL choice and get retuned — never pin one in
  a test; derive the ordering from the bores SYSTEM declares.
- EACH CYLINDER HAS ITS OWN SHUT-OFF (V-4, drawn once for the twin feed, two
  bought). NOT an e-stop — no orange, no `emergency:true` — just so a bottle can
  be isolated and swapped without bleeding the run down (Marcus: "it just makes
  things less stressful"). No flare ball valve is vaulted anywhere, so it is the
  same Apollo 94A. That makes ME353's flare cone useless at the cylinder, so F-1
  is now `polAdapter` = MEC **ME318** (POL x 1/4 MNPT, hard nose, 7/8 nut, same
  catalog page as ME353) and the valve screws straight on: ONE adapter each side
  of the valve, not two stacked. Two hexAdapter bodies back-to-back share a
  joint, and the consolidator can only caption one of them — the other renders
  as an unlabeled hex. That reverses move (1) at the cylinder only; ME353 is now
  a dead PARTS entry. Fittings 23 -> 24. ME1690/ME1641 are the excess-flow
  variants (the catalog notes excess-flow POLs are UL Listed) if the liaison
  wants one.
- L1 CARRIES NO COPPER, AND NOW ALMOST NO FLARE. The whole depot is NPT land —
  hex nipples between FNPT bodies, nothing flared on site. `F-1` is `polAdapter`
  (POL x 1/4 MNPT), `F-2` is a plain `nptTee`, and `HS-1` is `hoseLPnpt`, an LP
  hose with MALE PIPE THREAD BOTH ENDS: it screws straight into V-4's outlet and
  into F-2, so the two flare adapters that used to flank it are gone (24 -> 23).
  That is safe here because HS-1 is a CHAIN, not a loop — the cylinder end is
  free to rotate, so two tapered threads make up with no swivel between them,
  which is exactly what the L3 bypass could not do. HS-1 is also the one hose
  nobody breaks: a bottle is swapped at the POL, so its swivels bought nothing.
  Flare now survives on L1 at exactly two places, HS-2's swivels (F-21, F-13) —
  that hose IS broken at every setup and a tapered thread wants fresh tape each
  time, so it keeps its swivels. `cu38` is still used on L3/L3a/L3b.
- L3 IS NPT LAND TOO. A flare joint is a 45 deg cone held by nut tension alone,
  and a bush branch out on the playa gets torqued; a tapered thread with gas tape
  survives what a flare seal does not (Marcus). L3 keeps flare in exactly three
  places, ALL at the rejoin, and each is load-bearing:
  (1) `F-11`, a flare tee on the OUTPUT side — its outlet cone feeds the rail's
  copper directly, so the rail costs no adapter; (2) two half unions, one per
  path; (3) two short copper tubes, one per path, whose swivel nuts are the ONLY
  unions in the loop. A SPLIT IS A CLOSED LOOP: F-10 and F-11 are joined twice
  over, so by the time you make up the second path nothing is left free to
  rotate, and a tapered thread cannot be tightened there. Delete either tube and
  the loop cannot be assembled. `splitPathsCloseOnASwivel` and
  `splitBranchPathTurnsAround` guard the two halves of that; the port linter sees
  neither.
- SOLENOIDS ARE 1/2 (`sol12`, Beduan 2W160-15) at SV-1, SV-2 and SV-3 — one part,
  one spare, one harness. The 1/4 `sol14` is a dead PARTS entry. SV-1 sits on the
  split's RUN, not its branch: it is a pilot-operated diaphragm valve that wants
  to be horizontal with its coil up, and a branch boss faces down into the strip.
  The needle valve goes on the branch instead — it hangs rigid off the boss and
  does not care which way up it is. The 1/4 pipe, not the valve, is now the
  restriction. CAVEAT worth remembering: on L3b, NV-4 and SV-3 are in SERIES, so
  the jet's flow is capped by the 1/4 needle valve however big the solenoid is.
- Three parts are still bought off a marketplace listing: the Beduan solenoid,
  the Breezliy needle valve, and the Stanbroil air mixer. Stanbroil publishes NO
  catalog number — its own product page (`psrc:"stanbroil"`) sells the valve
  through one Amazon listing, so `B019RGW4KG` is an ASIN, not a Stanbroil part
  number, and carries `asin:true`.
- A `hexAdapter` consolidates into its "A ▸ B" cell only when a BARE joint sits
  on each side. A nipple joint (`{j:"npt", part:"nipple…"}`) does not count, and
  neither does another hex body — either way the adapter renders as an unlabeled
  hex with no caption at all. That is why `flare38npt12` (Anderson 04048-0608,
  3/8 male flare x 1/2 MNPT) exists: a reducing nipple into a separate 1/4 flare
  coupling costs the same two purchases and leaves the hex mute.
- Gas HOSES mark their working pressure on the cell (`WP 350 psi`, read from
  `PARTS[].rating`, never a literal). A hose is the one flexible, elastomeric
  component on the sheet and the likeliest weak point, so the rating belongs
  beside it and NOT in GENERAL NOTES — a generic note would contradict the
  drawing the moment a different hose is specced. Guarded by
  `hosesMarkTheirWorkingPressure`.
- L1's order is a SAFETY property, not a layout choice:
  `cylinders -> V-1 (depot e-stop) -> F-5 (gauge tee) -> F-21 -> HS-2 -> V-2
  (MAIN e-stop) -> F-7 (poofer tee) -> PRV-1 -> L2`.
  V-2 is the first thing the gas meets when it arrives at the effect, so it is
  upstream of BOTH consumers and closing it kills everything. The poofer tee sits
  after V-2 but BEFORE PRV-1, so L4 still draws tank pressure for a fast
  accumulator refill. Move the tee above V-2 and the valve marked "main emergency
  shut-off" silently stops cutting the poofer — the sheet then lies about a
  life-safety device. It shipped that way until Marcus caught it.
  THE PORT LINTER CANNOT SEE THIS: both orders are mechanically assemblable and
  lint clean. Invariant `branchesDownstreamOfTheMainShutoff` guards it.
  HS-2 is the long run from the propane depot to the piece. F-21 (a rev'd
  `flare14npt`) takes the gauge tee's female pipe port back out to a 3/8 male
  flare cone for the hose swivel; F-7 became an `nptTee` because it now sits
  between two FNPT bodies. Net cost of the whole fix: adapters+nipples 22 -> 23.
  NOTE: a `hexAdapter` body needs a drawn joint on BOTH sides or it renders as
  an UNLABELED HEX — the flanking markers and the "A ▸ B" caption are its only
  label. Putting one straight after a `{j:"turn"}` marker is how you find out.
- LP HOSE ENDS, checked 2026-07-09. Marcus does not need an exact SKU — "just
  something reasonably standard that is marked as compliant on the diagram" — but
  the sheet still may not carry an invented rating, and `hosesMarkTheirWorkingPressure`
  refuses a hose without a numeric one, so an unrated hose is not an option.
  MALE-NPT-BOTH-ENDS LP hose is a standard build, not a special: Thermoid Type 75
  `025LPG` (`psrc:"thermoid"`, vaulted) — 1/4 ID, MPT both ends, 350 psi,
  -40 to 180 F, **UL 21** (which IS the LP-gas hose standard, so unlike the
  solenoids it carries a published fuel-gas listing). New-Line lists the same
  build. It is a distributor item, not big-box. TRAP: the hardware-store hose in
  this size (Mr. Heater 1/4" MPT x 1/4" FPT) has a FEMALE second end and buys a
  hex nipple straight back, and Home Depot's NPT-ended high-pressure hose is 3/8
  (F276124), which does not fit a 1/4 depot. Do not "simplify" HS-1 to either.
- WHERE TO BUY, checked 2026-07-09. Anderson Fittings is an OEM supplier (Marmon
  / Berkshire Hathaway, Frankfort IL) — you buy through distributors, and its
  figure numbers are industry-standard so several makers stamp them.
  The 110SAE / 115SAE needle valves LOOKED buyable from here — several sites list
  the figure numbers — but nothing stocks them, nothing pictures them, and Marcus
  gave up trying. Listing a figure number is not selling a valve. They are gone;
  see the needle-valve entry above. TF1-6B female branch tee = Fairview/Fasparts `36-6B`, whose
  SAE 45 flare line IS listed for LP-gas service. POL adapter: Marshall Excelsior
  `ME353` (`psrc:"mecrv"`, MEC RV/LPG catalog p.28 "POL X MALE FLARE", "Male Hard
  Nose 3/8"") — same maker as the MEGR-6120 regulators, stocked everywhere.
  TRAP: many retail listings call ME353 a "male INVERTED flare" fitting. It is
  not; MEC's own catalog puts it under POL X MALE FLARE, and an inverted flare
  will not seal against a 45 deg swivel.
- L4b's order is load-bearing and was arrived at deliberately. The supply run is
  `PRV-2 -> CV-1 -> F-6 (pilot tee) -> F-12 (supply tee)`, and the ACCUMULATOR
  STACK hangs below F-12, reading DOWN: `V-3 -> F-15 (OPD tee, RV-1) -> adapters
  -> AC-1`. CV-1 blocks backflow toward the regulator. The pilot tees off
  DOWNSTREAM of CV-1 and UPSTREAM of the accumulator, so on a normal shutdown the
  vessel bleeds down through the continuously-burning pilot instead of sitting
  charged (`l4bOrder`).
  THE ISOLATION VALVE'S POSITION IS THE SAFETY PROPERTY: V-3 sits between the
  vessel and everything else EXCEPT ITS RELIEF. Closing it isolates a charged
  accumulator from the supply and from the dump valve, and RV-1 — on the tee
  BELOW V-3 — still protects it. Swap V-3 and F-15 and you can lock a charged
  vessel away from its own relief; that is a safety defect, not a layout tweak.
  Guarded by `accumulatorKeepsItsRelief`.
  V-3 is NOT an e-stop (Marcus). The poofer dies at V-2 with everything else, so
  V-3 carries no `emergency:true`, no orange, and no "marked" note. The invariant
  that asserted it WAS an e-stop is gone; its replacement asserts the relief
  property above, which is what the valve is actually for.
  F-6 is `teeStreet14` (Anderson T4-4B street tee): its male NPT screws straight
  into the female NPT outlet ahead of it — CV-1's, now that V-3 has moved into
  the stack — with no hex nipple, and its branch is a flare cone that the
  pilot's copper tube lands on directly. (Invariant
  `pilotTeeScrewsInWithoutANipple` compares the tee against whatever part is
  actually upstream, so a legitimate re-order of L4b will not make it lie.)
- THE ACCUMULATOR IS A FRESHLY STAMPED CYLINDER, de-valved (Marcus). It is in
  requalification date, unmodified — no welds, no drilling, nothing added — and
  plumbed through its existing 3/4-14 NGT boss with two STOCK adapters:
  `ngtAdapter` (3/4 MNGT x 3/4 MNPT) then `adapt3412` (3/4 FNPT x 1/2 MNPT) up
  into the 1/2 run tee. There is no custom machined part and no interior-inspection
  story any more; compliance row FE-8 states the case plainly instead of arguing
  for an out-of-date vessel. The drawing does NOT say "at the NGT boss" (Marcus) —
  the stack shows a `3/4 NPT ▸ 3/4 NGT` adapter, so the words are redundant.
  The whole vertical path is 1/2 (`teeStreet12`, `nipple12`, `ball12`, `sol12`)
  because the vessel breathes through it on every poof; only RV-1's branch necks
  to 1/4, through `bushing1214` in the mount's `via` slot.
- BOTH 1/2 TEES ARE STREET TEES (Anderson 06227-08, fig 127F, F x M x F). F-12
  points its male run end DOWN into V-3's inlet and F-15 points its male UP into
  V-3's outlet, so the ball valve takes a male thread in each port and the two hex
  nipples that used to flank it are gone. A male end only works where nothing has
  to close on a fixed loop, and the accumulator stack is a CHAIN dead-ending on
  the vessel — each tapered thread is made up by rotating the piece being added.
  IT DOES NOT SAVE MONEY, which is what Marcus asked. Catalog list: a street tee
  is $16.27 against $9.58 + $3.29 for a tee plus a hex nipple, so the swap costs
  about $6.79 and buys two fewer joints on a pressure vessel. Marcus took the
  joints ("doesn't matter, as long as it will fit"). No new invariant guards this:
  the PORT LINTER already refuses a nipple made up against a male port, which is
  the whole property.
- A riser tee that carries a down stack is TURNED ON ITS SIDE in the port model
  as well as the drawing: the horizontal band arrives on its BRANCH, the stack
  leaves through its lower RUN port (`ports.i`), and the discharge leaves through
  `ports.o`. That mapping was cosmetic while every port was 1/2 FNPT; it became
  load-bearing the moment a tee grew a male run end. `lintPorts` mates the band
  into `branchPort(tee)` and walks `down` out of `endPort(tee,"i")`.
- A RISER TEE MAY CARRY A DOWN STACK (`{j:"riser", tee, down:[...]}`) — an
  ordered list of items hanging BELOW the base tee, drawn by the same cell loop
  as the discharge with `dir=+1`. That is how the accumulator stack renders.
  Three things are easy to get wrong here, and all three were:
  (1) `row.down` grows the ROW, but `placeBand`'s POCKET (which lets drop bands
  tuck up beside a supply stack) must read `row.pocket` — only `drawSupply` sets
  it. Reusing `row.down` for both drew the pilot line straight through the vessel.
  (2) segment coords are BAND-LOCAL, the same frame as `CL`; do not subtract `CL`
  when growing `seg().bot` or the dashed box closes through the vessel.
  (3) a lone `hexAdapter` — one with no bare joint on BOTH sides — used to render
  as an unlabeled hex. It now names its own ends from `ports` (`endPair`), so
  `3/4 NPT ▸ 3/4 NGT` appears without a consolidated cell. `RISER.NOR` is now the
  run's inset for upright symbols (tank 30, flame heads 8), not a boolean.
- The check valve CV-1 STAYS. Marcus asked to remove it ("the regulator does
  that"), then reversed.
- "Continuous flame", never "standing flame".
- The drawing prints a psi rating ONLY where something can fail at pressure.
  Solid-brass fittings (`NO_RATING_SYM`: tees, the cross, adapters, nipples)
  have no seat, seal, or diaphragm and print none — a 500/1000/1200 psi number
  on those cells is noise (Marcus). Custom fabrications (the handmade tips, the
  open pipe discharge) print none either: their "rating" was never sourced from
  anyone. BALL VALVES print none as well, for a DIFFERENT reason — a ball valve
  does have a seat, but the whole class is 600 psi WOG brass, an order of
  magnitude above anything on this sheet, so the number tells a reviewer nothing
  (Marcus: "aren't they all high pressure?"). GAUGES print none, for a THIRD
  reason — a gauge's pressure statement is its RANGE. All three share the same
  300 psi body rating, so printing it beside "0-30 psi" made every gauge on the
  sheet read as a 300 psi gauge (Marcus, twice). One psi figure per gauge cell,
  and it is the range. `PARTS[].rating` still carries
  every number for FE-2 to test against, and the schedule still records it.
  A gauge is therefore the ONLY part in `PN_SYM` and `NO_RATING_SYM` at once: its
  cell prints "SENCTRL" and no psi. That broke the inline sweep, which tested
  `specLine(p) !== ""` as a proxy for "prints no rating" — a proxy that held only
  because every other `NO_RATING_SYM` member also prints no maker. It now tests
  the psi figure directly. `gaugeCellsHideTheBodyRating` guards the removal.
- `PN_SYM` decides which cells print `mfg` + part number. BALL VALVES ARE NOT IN
  IT (Marcus) — they show a rating only; the schedule still records the Apollo
  number. RELIEF VALVES ARE NOT IN IT EITHER: they have not been bought, the
  Aquatrol 140A is a candidate whose LP suitability is still a liaison flag, so
  the drawing states the rating the valve must meet and names no part. Same
  treatment, same reason — the schedule keeps the number. Pressure VESSELS are
  in it: the accumulator prints "DOT 4BA240 · 250 psi" plus a note naming the
  NGT boss, the no-welds constraint, and the expired requal stamp. It is the
  most unusual component on the sheet and the external drawing said almost
  nothing about it until Marcus caught that. The vessel note stops at "interior
  inspected" — the photographs are an on-site artifact and the packet is for
  PRELIMINARY review, so neither the drawing nor the schedule cites them.
- `deTag()` strips equipment designations from the EXTERNAL sheet — not just from
  cells but from band titles ("... at PRV-1"), run labels (TB-13, HS-2), off-band
  labels ("from MF-1"), and notes. The suite asserts the external SVG contains no
  `[A-Z]{1,3}-\d+` token at all except `CGA-510`, a thread standard. That test
  also caught a note referencing compliance row "FE-8", which lives only in the
  HTML table — the same dangling-reference bug the balloons had.
- "(5/8-18 UNF)" was removed from the flare tee's name: it is the flare-nut
  thread for 3/8 tube, fully implied by "3/8 in tube", stated by NEITHER vaulted
  catalog (the flare tables list tube OD only, "supplied less nuts"), and it was
  the only thread callout in any part name.
- The toolbar (view toggle, export buttons, JSON editor) sits ABOVE the sheet.
- Compliance output is a self-review aid, not approval — the footer disclaimer
  and the FOR FAST REVIEW / NOT A BURN LICENSE stamp stay.
- No localStorage/sessionStorage; state lives in the editable JSON box.

## Testing philosophy

Every check is exactly one of four kinds, and nothing else is allowed in:

1. **A named invariant** in `test/invariants.js`, quantified over data (sweep
   EVERY drawn part, EVERY text node, EVERY nipple in SYSTEM) — and it MUST have
   a paired mutation in `test/mutants.js` that turns it red. The coverage gate
   fails the build otherwise. Only predicates a *data* mutation can falsify
   belong here.
2. **A port-linter defect class**, seeded through `viaJSON(mutate)` — these are
   mutations of the `portLinterClean` invariant, each with an `expectDetail` so
   it must go red for the RIGHT reason ("needs a nipple", "male port is
   upstream", …).
3. **A geometry or structural check** — collisions, baselines, clipping,
   escaping, balanced tags, no `undefined`/`NaN`, hostile-data survival. These
   are renderer guarantees, exempt from the mutation gate, and stay inline in
   `run-tests.js`.
4. **The approved snapshot** (`test/approved/drawing-{external,internal}.svg`).
   Rendering details live here, not in `includes()` calls.

Refuse: a constant asserting itself (`PARTS.x.rating === 150` — the guard for a
sourced spec is `psrc` + SOURCES.md, not a test restating the literal); a string
pinned to incidental output (`svg.includes(">3/8 in tube (5/8-18 UNF)<")`). The
tell that you got it wrong is hand-editing tests every time the design
legitimately changes — that happened ~22 times in one session before the suite
was rebuilt (167 → 140 → 114 checks + 31 mutants). When the drawing changes on
purpose: `npm run approve`, **look at the PNG it renders**, then commit the
golden diff. A one-word label change now costs zero test edits or one reviewable
golden hunk — never a scavenger hunt through 40 `includes()` calls.

### GATE SCOPING — the one way this collapses

`invariants.js` may hold **only** predicates a DATA mutation can falsify.
Renderer guarantees are not: deleting a line from `SYSTEM` leaves
`everyLineRendered` true (`.every()` just iterates fewer lines) — verified. Same
for `branchBandsNeverWrap`, connector alignment, collision-freeness. They are
category 3 and stay inline. Smuggling one into `invariants.js` forces a fake
mutation and makes the coverage gate unsatisfiable.

> If no clean data/app mutation falsifies a predicate, it is category 3.

The subtler trap, which bit during the migration: **a mutation that moves BOTH
sides of the comparison proves nothing.** `onlyPnSymPartsPrintPartNumbers` — "no
part outside `PN_SYM` prints a number" — stays green under `PN_SYM.add("ball")`,
because the ball valve leaves the filter along with the rule. It became
`ballValvesNoPnOnDrawing`, quantified over `sym === "ball"`, so the observation
and the expectation are independent. Same reasoning made
`partsThatCanFailPrintTheirRating` ground itself in `PN_SYM` while the mutation
targets `NO_RATING_SYM`. If you cannot find such an independent ground, the
predicate is category 3.

**An invariant can PIN A BUG.** A green suite means the data still has the
property you named — never that the property is right. `splitPathsBuyNoFittings`
asserted that neither side of the L3 split buys a fitting; it was true, it was
mutation-covered, and it froze a bypass leg that could not be assembled. The
fitting-count boast was the tell: a predicate that rewards *fewer purchases* is
scoring a proxy, and the drawing is not obliged to make the proxy true.

That family is now EXTINCT, and its death is the lesson. `splitPathsBuyNoFittings`
was narrowed to the metered run, whose "buys nothing" at least had an argument
behind it — NV-1 is a flare valve, so the tube nut lands on its cone. Then the
flare valve turned out to be unbuyable, and the narrowed invariant, the pilot
line's `pilotLineBuysNoFittings`, and both `flareValves*` predicates all died in
one commit. Four checks, all green, all mutation-covered, all defending a part
nobody can hold. Meanwhile the two properties that actually matter — the loop can
be assembled, the branch can turn around — had NO test at all until a loop shipped
that could not be built.

**Assert what would hurt if it were false, not what you are proud of.** A
fitting count is a preference; `splitPathsCloseOnASwivel` is a fact about
whether the thing can be screwed together. Prefer predicates whose violation is
a defect rather than a regret, and ground them in geometry or the port model, not
in a purchase decision that the next conversation may reverse.

**Test-harness liveness.** `applyJSON()` REASSIGNS `SYSTEM` and `PARTS`;
`buildRefs()` REASSIGNS `refIndex`. A reference captured at load time goes stale
the instant anything re-renders, so tests read the pre-mutation data and pass on
a lie. Always go through `app.getSYSTEM()` / `app.getPARTS()` / `app.getRefIndex()`.
`TREE`, `MATCHED`, `PN_SYM` and `NO_RATING_SYM` are mutated in place and stay live.

Both VIEWS are asserted separately — external draws no balloons and no
designations but prints part numbers and ratings (and keeps fittings generic);
internal is the mirror image; switching back and forth is idempotent; and the
collision/baseline invariants must hold in each. Bugs found by this suite so far:
missing `tee` symbol, unescaped `&` breaking the exported XML, unescaped user
strings in the title block, the harness DOM stub not dropping `children` on
`innerHTML=""` (which let repeated renders stack strips), and a `{j:"flare",
part:"x"}` purchase silently never reaching the parts schedule (`buildRefs`
registers `it.part` only for `hose|tube|npt` — now guarded by
`everyPartReachesTheSchedule`). Add a check when you fix a bug.

The REVERSE gate earns its keep too: the first mutation written for
`noInchesOnTheSheet` put inches in `ball14.name` and the invariant stayed green,
because cell captions drop everything after the first comma and "Ball valve,
1/4 in FNPT" renders as "Ball valve". The mutation has to be a TEE, which is one
of the four symbols that print their name whole. A mutation that cannot reach the
drawing proves nothing about the drawing.

## Roadmap candidates

- Replace PARTS `w`/`h` with real dimensions from vendor spec sheets, then offer
  a true-scale fabrication view as a separate mode.
- Per-branch quantity math → auto BOM with totals and a CSV export.
- Wind-rated pilot options to replace the custom steel-wool pilot (a likely
  FAST discussion point).
- Encode the FAST required-documentation checklist (site plan, operating
  procedure, extinguisher plan) as a cover-sheet generator.

## Test layout

```
test/
  harness.js     loadApp() — evaluates the HTML's <script> against a DOM stub.
                 Exposes getSYSTEM/getPARTS/getRefIndex getters; see liveness above.
  geometry.js    shared SVG parsers (textBoxes, collisions, clippedByCanvas,
                 bandChunks, textContents). Required by all three runners —
                 duplicating them is how the assertion and the prover drift apart.
  invariants.js  named, DATA-FALSIFIABLE predicates + evaluateAll/evaluateOne
  mutants.js     the mutation table + three gates (forward / coverage / reverse)
  golden.js      canonicalize, render, LCS diff, hunk reporter
  approve.js     regenerates the goldens; refuses to be silent, refuses under CI
  approved/      drawing-external.svg, drawing-internal.svg (tracked; *.png ignored)
  run-tests.js   runs the invariants, compares the goldens, then the inline
                 geometry/structural + hostile/wrap/editor blocks
```

`run-tests.js` and `mutants.js` are independent entry points; `npm test` runs both.

## Reference material

`reference/` holds the earlier draw.io versions of the same system (superseded
by the HTML tool, kept for the record) and `reference/vendor-data/` — local
copies of the vendor catalogs/spec sheets that ground the port model, with a
SOURCES.md manifest. Many vendors block automated fetching (McMaster,
Motorsnorkel, marshallexcelsior.com; Amazon serves a JS shell), so documents
are vaulted here once and cited by `psrc` key — never cite a live URL in
PARTS without a local copy. The compliance rules were derived from
the published Burning Man Flame Effects Guidelines and the FAST
required-documentation page on burningman.org — re-check those pages each year;
requirements change between events.
