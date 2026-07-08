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

1. `PARTS` — parts library. Each entry: name, vendor, pn, `verified` flag, spec
   text, pressure rating, symbol key, drawing proportions (`w`/`h`).
2. `SYSTEM` — the system definition: `meta` + `lines[]`. Each line has an
   operating pressure `op` (used by compliance checks) and an ordered `items[]`
   sequence alternating components (`{p, tag, note, emergency, xn}`) and joints
   (`{j: npt|flare|pol|hose|tube|off, ...}`). Two structured items exist:
   `{split:{tee, rejoin, a:[...], b:[...]}}` draws two parallel paths between
   two tees (path b on a full row grid one `PAR_DY` below, entered/left through
   the same reserved corridors drops use), and `{j:"riser", tee:{...}}` turns
   the band's remaining items into a vertical bottom→top discharge stack (TROW
   mini-grid, `rotate(-90)` symbols, tanks/heads stay upright; `bandUp()`
   reserves the headroom above the strip). `xn:n` on a part draws n copies of
   the symbol side by side (standby rail tips) under one balloon.
3. System tree (`deriveTree`) — the drawing is CONNECTED, not letter-matched.
   The existing `ref` fields are pure match keys: `branch:{ref}` on a tee pairs
   with a line whose first item is `{j:"off", dir:"in", ref}`. Every line is a
   horizontal BAND; the root line (first one not starting with an off-in) is
   the outermost band. A band whose LAST item is a 1:1 off-out chains its
   consumer into the same band (`TREE.chain`, seam title + fresh dashed box
   mid-band — how L1+L2 and L4+L4b each read as one run while keeping
   separate `op` pressures); matched tees hang their consumer band BELOW at
   the tee's true x (kind "drop", fed through a reserved 24 px corridor
   cell); a terminal off-out with `fan:n` hangs its consumer under the run's
   end elbow with a one-of-n badge (kind "end", S-routed connector).
   Unmatched refs degrade to the classic pentagon; unreachable lines render
   as standalone strips at the bottom — nothing throws on hostile data.
   Dashed rounded boxes group every numbered line's components per row; keep
   them clear of text rows.
4. Layout engine — the important invariants. Every band renders on the FIXED
   ROW GRID (`ROW`): balloon row / joint-spec row / centerline `CL` /
   joint-detail row / tag row / two note rows; cell widths are computed from
   the widest label (`measure()`), so labels cannot collide. Bands WRAP: rows
   fill toward `SHEET_W` and the run loops back to the band's left margin
   through an S-routed connector (`data-loop`, right lane → return line just
   below the previous row's envelope → left lane), with splits and risers as
   atomic units; the return line must clear both the row's dropped sub-bands
   (placed between rows, right-to-left so corridors never slice a sibling
   strip) and the next row's riser headroom (`row.up`, reserved above its
   strip top). Discharge risers are the one vertical construct: they reuse
   the `TROW` per-cell mini-grid (anchored at each `g.tcell`'s `data-y`),
   flowing bottom → top. Symbols are white-filled bodies over one continuous
   run line, capped 46 px above / 34 px below `CL`, and contain NO text
   whatsoever — that is what makes them rotatable (`rotate(-90)` on risers;
   tanks and flame heads stay upright). Do not reintroduce ad-hoc text
   offsets or text inside `SYM` functions — captions route to the note rows
   via `AUTONOTE` (whose flow arrows turn ↑ on risers). A gauge mounted on a
   regulator attaches to the reg's gauge-port circle, offset from the run —
   never draw it inline as if fuel flowed through it.
5. Port linter (`lintPorts`) — machine check that every drawn joint is
   mechanically assemblable. `PARTS[*].ports` declares each part's end ports
   as `"type:size:gender"` strings (`flare` M = cone, F = swivel nut; size
   `"*"` = takes the tube item's size); `branch`/`gauge` declare side ports;
   `psrc` names the grounding document in `reference/vendor-data/SOURCES.md`
   (`"decl"` = declared from listing text, no fetchable catalog). Item-level
   `adaptIn`/`adaptOut`/`branchAdapt` (`"in>out"`) declare note-only adapter
   stacks; a drawn joint attaches to whichever side of such an adapter its
   thread type matches. The walk covers the root band chain, sub-band chains,
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
   into one standalone document. Every interpolated string MUST pass through
   `esc()`; browsers forgive raw `&`/`<` in-page but the exported .svg must be
   strict XML (regression-tested).

## Hard-won constraints

- The drawing is declared "not to scale" everywhere on purpose. The `w`/`h`
  proportions in PARTS are visual only. Do not add scale claims unless the
  dimensions are replaced with real vendor spec-sheet numbers first.
- `verified:false` parts show a VERIFY PN chip. Verified so far against vendor
  data: Marshall Excelsior MEGR-6120-60 / -6120-30 regulators, confirmed
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
  (LP/fuel-gas service in catalog text): 04044-06 union tee, 04052-06 four-way
  cross, 04056-0604 3/8x1/4 reducing union, 48/54-series flare x NPT half
  unions (e.g. 54048-0606). Never mark a part verified without a source.
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
tips repeat, and dashed line boxes appear for every line. Bugs found by this
suite so far: missing `tee` symbol, unescaped `&` breaking the exported XML,
unescaped user strings in the title block. Add a check when you fix a bug.

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
