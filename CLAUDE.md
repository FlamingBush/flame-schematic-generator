# Flame effect schematic generator

Single-file HTML tool (`fast_schematic_generator.html`) that renders LP-gas flame
effect plumbing schematics for Burning Man FAST review packets. Everything —
data, layout engine, compliance checks, SVG export — lives in the one file's
`<script>` block by design, so an artist can open it from disk with no build step.

## Commands

- `node test/run-tests.js` — full regression suite (no dependencies). Run after ANY change.
- `python3 scripts/validate_svg.py` — strict XML validation of the exported SVG
  (stdlib only); rasterizes to PNG if cairosvg is installed. When changing layout
  or symbols, rasterize and actually look at the PNG — several past bugs were
  only visible, not logical.

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
   the same reserved corridors drops use); `{j:"riser", tee:{...}}` turns
   the band's remaining items into a vertical bottom→top discharge stack (TROW
   mini-grid, `rotate(-90)` symbols, tanks/heads stay upright; `bandUp()`
   reserves the headroom above the strip); and `{j:"turn"}` marks the end of a
   vertical SUPPLY STACK — every item before it renders bottom→top BELOW the
   band centerline (`drawSupply`, same TROW mini-grid), the run turns through
   a bare curve at the centerline (Marcus: no elbow fitting — the NTS line
   just bends; a corner PART right before the marker is still supported and
   masks the bend), and the band continues horizontally after. Cylinders in a stack connect through
   their TOP valve only — never draw the run through a tank body. `xn:n` on a
   part draws n copies of the symbol side by side (standby rail tips, the two
   cylinders) under one balloon. `rev:true` on a part item installs the same
   fitting in the opposite flow direction — the port linter swaps its `i`/`o`
   ends and one schedule row serves both orientations. `chk:true` on an npt
   joint appends `*` to its caption (thread-per-listing, gauge-check on
   receipt — the Beduan solenoids); the footnote lives in GENERAL NOTES.
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
   and the like live in the diagram-wide GENERAL NOTES (legend + export
   header); Marcus asked for ~70% less label text, so resist re-adding
   boilerplate to notes or AUTONOTE. A [joint][hex adapter][joint] sequence
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
   into one standalone document: title, orientation subtitle, the drawing, and
   the SYMBOL LEGEND (`legendLines()`, shared with the on-page `#legend` div —
   the exported sheet is the only thing that decodes its own symbols once it
   leaves the page). The canvas widens if a legend line outruns the artwork.
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
  claims FNPT but the plain 2W-series model number denotes G/BSPP threads in
  the originating product line ("N" variants are NPT) — both solenoids carry a
  gauge-check-threads-on-receipt warning in their specs; neither publishes
  seal material or a fuel-gas listing. Mr. Heater F273754/F273702 part numbers
  are plausible but unconfirmed; Breezliy B08K8NP26L needle valves likewise
  unlisted. Anderson Metals SAE 45° flare catalog items confirmed to exist
  (LP/fuel-gas service in catalog text): 04044-04/-06 union tees, 04052-06
  four-way cross, 04059-060604/-060404 fig 509 reducing tees, 04046 fig 406
  flare x female pipe couplings, 48/54-series flare x NPT half unions (e.g.
  54048-0606). Stanbroil 3/4 in LP air mixer confirmed 3/4 MNPT in / 3/4 FNPT
  out, 300k BTU max. Aquatrol series 140 ASME relief valves are air/inert-gas
  media only — LP suitability is a liaison flag, like the solenoids.
  TWO DIFFERENT COMPANIES both stamp the legacy SAE figure numbers and both are
  called "Anderson" — cite the one you took the spec from. `anderson` =
  Anderson Metals Corp (Kansas City), which lists the needle valves as
  09110-04/-06 but publishes NO gender and NO rating anywhere in its catalog.
  `andersonfittings` = Anderson Copper & Brass Co (Oak Forest, IL), whose
  catalog IS the source for the needle valves: p.130 "NEEDLE VALVE FLARE TO
  FLARE" 110SAE / 115SAE with a drawing showing MALE cones both ends, and
  p.129 "Pressure range up to 150 psi". Anderson Metals is now MIDLAND
  INDUSTRIES: andersonmetals.com 403s to curl and 301-redirects there,
  Midland's needle-valve pages 404, and their
  `cdn.midlandindustries.com/public/pdf/valves.pdf` is a BALL-valve catalog
  with zero needle content — don't re-download it.
- If a run is already flare, fit a flare x flare valve rather than adapting to
  NPT and back (Marcus: cheaper and simpler). The corollary is stronger: make
  the TEES flare too and the adapters on both sides vanish. Two male flare
  cones cannot mate, so a fitting-to-fitting flare junction always needs one
  female swivel (`flareNptF` / cat. U5) or a length of tube between — check the
  gender before assuming a swap saves anything.
- Adapter/nipple purchases went 31 -> 22 by using the catalogs properly. The
  three moves, in descending value: (1) `POL-U2-6` takes the cylinder straight
  to a 3/8 male flare cone, so the hose swivel lands on it and both the old
  POL-to-NPT adapter and the NPT-to-flare adapter are gone; (2) the split tees
  F-10/F-11 became plain flare tees, which let NV-1 become a flare valve and
  left its metered path (TB-10 -> NV-1 -> TB-12) with ZERO fittings, and let
  L3a start on bare tube; (3) `TF1-6B`, a flare tee with a 1/4 FNPT branch,
  carries the tank-pressure gauge while the run stays flare, so the supply
  stack above V-1 needs no hex nipples. What is left is irreducible without
  changing components: every remaining nipple joins two FEMALE NPT ports
  (ball valves, solenoids, regulators, NPT tees are all FNPT), and every
  remaining half-union is where a flare run meets an FNPT valve body.
- The Breezliy ASIN needle valve is GONE (NV-1 now takes 115SAE). The only
  parts still bought off a marketplace listing are the two Beduan solenoids.
- WHERE TO BUY, checked 2026-07-09. Anderson Fittings is an OEM supplier (Marmon
  / Berkshire Hathaway, Frankfort IL) — you buy through distributors, and its
  figure numbers are industry-standard so several makers stamp them.
  110SAE / 115SAE needle valves: BSP Company, Industrial Parts Fittings,
  Installation Parts Supply (also 110SAE-LF lead-free); Midland/Anderson Metals
  lists 110SAE too. TF1-6B female branch tee = Fairview/Fasparts `36-6B`, whose
  SAE 45 flare line IS listed for LP-gas service. POL adapter: Marshall Excelsior
  `ME353` (`psrc:"mecrv"`, MEC RV/LPG catalog p.28 "POL X MALE FLARE", "Male Hard
  Nose 3/8"") — same maker as the MEGR-6120 regulators, stocked everywhere.
  TRAP: many retail listings call ME353 a "male INVERTED flare" fitting. It is
  not; MEC's own catalog puts it under POL X MALE FLARE, and an inverted flare
  will not seal against a 45 deg swivel.
- L4b's order is load-bearing and was arrived at deliberately:
  `PRV-2 -> CV-1 -> V-3 -> F-6 (pilot tee) -> F-15 (relief) -> accumulator ->
  SV-2 -> nozzle`. CV-1 blocks backflow toward the regulator. V-3 is an e-stop
  (`emergency:true`) sitting UPSTREAM of the pilot tee, so closing it cuts supply
  gas to the pilot and the accumulator together. The pilot tees off DOWNSTREAM of
  CV-1 and UPSTREAM of the accumulator, so on a normal shutdown the accumulator
  bleeds down through the continuously-burning pilot instead of sitting charged.
  Move any one of those three and you break one of the other two properties.
  F-6 is `teeStreet14` (Anderson T4-4B street tee): its male NPT screws straight
  into CV-1's female outlet with no hex nipple, and its branch is a flare cone
  that the pilot's copper tube lands on directly.
- The check valve CV-1 STAYS. Marcus asked to remove it ("the regulator does
  that"), then reversed.
- "Continuous flame", never "standing flame".
- The drawing prints a psi rating ONLY where something can fail at pressure.
  Solid-brass fittings (`NO_RATING_SYM`: tees, the cross, adapters, nipples)
  have no seat, seal, or diaphragm and print none — a 500/1000/1200 psi number
  on those cells is noise (Marcus). Custom fabrications (the handmade tips, the
  open pipe discharge) print none either: their "rating" was never sourced from
  anyone. `PARTS[].rating` still carries every number for FE-2 to test against.
- `PN_SYM` decides which cells print `mfg` + part number. BALL VALVES ARE NOT IN
  IT (Marcus) — they show a rating only; the schedule still records the Apollo
  number. Pressure VESSELS are: the accumulator prints "DOT 4BA240 · 250 psi"
  plus a note naming the NGT boss, the no-welds constraint, and the expired
  requal stamp. It is the most unusual component on the sheet and the external
  drawing said almost nothing about it until Marcus caught that.
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

The suite asserts invariants, not snapshots: every text baseline on a band row
or riser mini-grid row, ZERO text-bbox collisions across the entire combined
sheet (translate-resolving parser in `textBoxes()`), no text inside rotated
groups and none inside `SYM` bodies, every derived edge drawing exactly one
connector whose y equals its band's centerline (`data-conn`/`data-cl`), orphan
lines falling back to pentagons, no undefined/NaN leaks, strict escaping in the
export, editor round trip (including hostile strings and an unmatched-ref
line), graceful malformed-JSON handling, and the newer constructs: band chains
render as one strip with a seam (`data-merged`), risers use tcell mini-grid
rows with `rotate(-90)` symbols, split paths draw both corridor elbows, `xn`
tips repeat, and dashed line boxes appear for every line. A CHECK MUST BE ABLE TO FAIL. Before adding one, mutate the thing it guards and
watch it go red; if it stays green it is decoration. Two shapes to refuse:
a constant asserting itself (`PARTS.x.rating === 150` — the guard for a sourced
spec is `psrc` + SOURCES.md, not a test restating the literal), and a string
pinned to incidental output (`svg.includes(">3/8 in tube (5/8-18 UNF)<")`).
Quantify over the data instead: sweep EVERY drawn part, EVERY text node, EVERY
nipple in SYSTEM. The tell that you got it wrong is having to hand-edit tests
every time the design legitimately changes — that happened ~22 times in one
session before the suite was consolidated back from 167 checks to 140.

Both VIEWS are asserted separately —
external draws no balloons and no designations but prints part numbers and
ratings (and keeps fittings generic); internal is the mirror image; switching
back and forth is idempotent; and the collision/baseline invariants must hold
in each. Bugs found by this suite so far: missing `tee` symbol, unescaped `&`
breaking the exported XML, unescaped user strings in the title block, and the
harness DOM stub not dropping `children` on `innerHTML=""` (which let repeated
renders stack strips). Add a check when you fix a bug.

## Roadmap candidates

- Replace PARTS `w`/`h` with real dimensions from vendor spec sheets, then offer
  a true-scale fabrication view as a separate mode.
- Per-branch quantity math → auto BOM with totals and a CSV export.
- Wind-rated pilot options to replace the custom steel-wool pilot (a likely
  FAST discussion point).
- Encode the FAST required-documentation checklist (site plan, operating
  procedure, extinguisher plan) as a cover-sheet generator.

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
