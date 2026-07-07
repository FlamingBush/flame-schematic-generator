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
   sequence alternating components (`{p, tag, note, emergency}`) and joints
   (`{j: npt|flare|pol|hose|tube|off, ...}`).
3. Layout engine — the important invariant. Every strip uses a FIXED ROW GRID
   (`ROW` constant): balloon row / joint-spec row / centerline `CL` / joint-detail
   row / tag row / two note rows. All text is emitted into these rows only; cell
   widths are computed from the widest label (`measure()`), so labels cannot
   collide. Symbols are white-filled bodies drawn over one continuous run line,
   height-capped to 46 px above / 34 px below `CL`, and contain NO text (captions
   route to the note rows via `AUTONOTE`). Do not reintroduce ad-hoc text offsets
   inside `SYM` functions — that was the original alignment bug.
4. Compliance engine (`runChecks`) — rules paraphrased from the published
   Burning Man Flame Effects Guidelines, evaluated against SYSTEM data. Three
   statuses: DESIGN PASS / REVIEW / FIELD. Keep requirement text paraphrased,
   never quoted verbatim.
5. `downloadSVG()` — stacks the strip SVGs into one standalone document.
   Every interpolated string MUST pass through `esc()`; browsers forgive raw
   `&`/`<` in-page but the exported .svg must be strict XML (regression-tested).

## Hard-won constraints

- The drawing is declared "not to scale" everywhere on purpose. The `w`/`h`
  proportions in PARTS are visual only. Do not add scale claims unless the
  dimensions are replaced with real vendor spec-sheet numbers first.
- `verified:false` parts show a VERIFY PN chip. Verified so far against vendor
  data: Marshall Excelsior MEGR-6120-60 / -6120-30 regulators (1/4 FNPT in/out
  + 1/4 FNPT gauge port, max inlet 250 psig, UL 144 NON-relief — external
  overpressure protection flagged). Mr. Heater F273754/F273702 part numbers are
  plausible but unconfirmed; Breezliy B08K8NP26L needle valves and Beduan
  B07N2LGFYS 1/4 in / B07N6246YB 1/2 in solenoids (2W-series, 12 VDC NC,
  ~100 psi max) have no
  published seal material or fuel-gas listing. Never mark a part verified
  without a source.
- Compliance output is a self-review aid, not approval — the footer disclaimer
  and the FOR FAST REVIEW / NOT A BURN LICENSE stamp stay.
- No localStorage/sessionStorage; state lives in the editable JSON box.

## Testing philosophy

The suite asserts invariants, not snapshots: every text baseline on a grid row,
zero horizontal overlaps, uniform strip heights, no undefined/NaN leaks, strict
escaping in the export, editor round trip (including hostile strings), graceful
malformed-JSON handling. Bugs found by this suite so far: missing `tee` symbol,
unescaped `&` breaking the exported XML, unescaped user strings in the title
block. Add a check when you fix a bug.

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
by the HTML tool, kept for the record). The compliance rules were derived from
the published Burning Man Flame Effects Guidelines and the FAST
required-documentation page on burningman.org — re-check those pages each year;
requirements change between events.
