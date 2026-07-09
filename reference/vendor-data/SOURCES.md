# Vendor data vault

Local copies of the vendor documents that ground the port model in
`fast_schematic_generator.html` (`PARTS[*].ports`, `src:` keys). Fetched
2026-07-07 with a browser user-agent; several vendors block automated
fetching, so these copies are committed — the port linter must never depend
on a live fetch. The `.txt` files are pypdf extractions of the PDFs.

## Fetched (src key → file)

- `mec` → `mec-megr6120-manual.pdf` (+ .txt) — MEC form 976, MEGR-6120 series.
  https://hdsupplysolutions.com/wcsstore/ExtendedSitesCatalogAssetStore/product/fm/additional/28/288036_InstallationGuide-PDF.pdf
  Grounds reg60/reg30: "Inlet Connection: 1/4" FNPT · Outlet Connections:
  1/4" FNPT · Gauge Port: 1/4" FNPT" (two gauge ports), max inlet 250 psig,
  UL 144, non-relief.
- `anderson` → `anderson-metals-catalog.pdf` (+ .txt) — Anderson Metals master
  catalog. https://www.kdfasteners.com/assets/pdfs/anderson-metals-catalog.pdf
  Grounds the brass fittings: fig 404 flare tee (04044-06), fig 502 flare
  cross (04052-06), fig 406 flare x female pipe (04046-0604), fig 408
  half-union flare x male pipe (04048-0604, -0606), fig 506 reducing union
  (04056-0604), fig 122 hex nipple MNPT x MNPT (06122-04), fig 123 reducing
  hex nipple (06123-0804 = 1/2 x 1/4), fig 101F forged FNPT tee (06201-04),
  fig 102F forged FNPT cross (06202-04), fig 509 reducing flare tees
  (04059-060604 = 3/8 x 3/8 x 1/4, 04059-060404 = 3/8 x 1/4 x 1/4; the table
  header reads "Flare Three Ends / Read Sizes 1-2-3"), and the straight
  Flare x Flare brass needle valves (09110-04 = cat. 110-SAE 1/4 x 1/4,
  09110-06 = cat. 115-SAE 3/8 x 3/8). NOTE the extracted text's layout:
  each figure name appears BEFORE its size table and the computer-number
  prefix (e.g. "06201-") AFTER it — verified against fig 122/123, and again
  against 09106- (Compression x Compression) / 09110- (Flare x Flare).
  CAVEAT: this catalog states NO pressure ratings and NO end genders
  anywhere. The needle valves' male-cone ends are a declared assumption
  (the norm for a valve inline in a tube run) and their pressure rating is
  unknown — both are called out in the part's spec text and land the part
  on compliance row FE-2 as REVIEW.
- `beduan` → `beduan-2w160-15.html` — mybeduan.com product page for the 1/2 in
  solenoid: "1/2\" female NPT port size, model designation 2W160-15".
  https://mybeduan.com/beduan-brass-electric-solenoid-valve-12-12v-air.html
- `apollo` → `apollo-94a-submittal.pdf` (+ .txt) — Apollo 94A series submittal
  sheet (Aalberts). NPT (female) 1/4"–4", CSA/UL fuel-gas approvals on NPT
  models; grounds ball14's pn: 94A-101-01 is the 1/4" model.
  https://aalberts.compano.com/Data/Environments/000001/Attachment/Bijlage/PRD/ProductGroup/Apollo/Submittal_Tech_Sheets/SS_94A.pdf
- `sturgis` → `mbsturgis-38-sae-adapters.html` — MB Sturgis 3/8 SAE flare
  adapters page: "3/8″ Female SAE Swivel X 1/4″ Male NPTF Adapter" (the
  flareNptF part; Motorsnorkel #2327 is the same fitting but their site
  blocks fetching). https://www.mbsturgis.com/adapters-fittings/sae-flare-adapters/3-8-sae-flare-adapters/
- `stanbroil` → `stanbroil-air-mixer.html` — Stanbroil 3/4" LP Air Mixer Valve
  product page. Grounds the mixer: "3/4\" Male NPT on Incoming Side · 3/4\"
  Female or Male (with included adapter) NPT on Burner Side · Rated BTU's:
  300,000 Max", brass, LP only.
  https://www.stanbroil.com/product/Stanbroil-34-LP-Air-Mixer-Valve-for-Liquid-Propane-Fire-Pits-300K-BTU-Max-Brass.html
- `aquatrol` → `aquatrol-series140.html` + `aquatrol-140-cutsheet.pdf` (+ .txt)
  — Aquatrol Series 140 safety valve (Kingston 112CSS successor; Kingston is
  now part of Aquatrol). Grounds the relief part: "Safety Valve for Air /
  Gas — ASME - NB Section XIII 'UV' for Section VIII Div. 1", B16 brass body,
  stainless disk/spring, 1/4" inlet (orifice A), Series 140 limited to
  350 psi, 0-350 psig settings, NPT. Media is AIR/INERT GAS only — no LP-gas
  listing; flagged for FAST liaison like the solenoids.
  https://aquatrol.com/valve-series/series-140/
  https://aquatrol.com/wp-content/uploads/2026/02/140-cut-sheet.pdf

## Blocked / unavailable (ports stay `src:"decl"` — declared from listing text)

- motorsnorkel.com — HTTP 403 to both curl and WebFetch.
- andersonmetals.com — HTTP 403 to curl; 301-redirects to midlandindustries.com
  (Midland acquired the line). Midland's needle-valve product pages 404, and
  cdn.midlandindustries.com/public/pdf/valves.pdf fetches fine but covers only
  BALL valves — zero needle-valve content, so it was not vaulted. Retail
  listings show 150 psi for Anderson's pipe/compression needle valves but say
  nothing about the flare 09110- models. Checked 2026-07-09.
- mrheater.com — /f273754.html and /f273702.html return 404 (PN pages moved);
  POL x 1/4 MNPT and 3/8 female-swivel hose genders declared from listings.
- mcmaster.com — blocks automated retrieval entirely (check valve, generic
  brass); check14 ports declared.
- Amazon product pages render a JS shell to fetchers — Breezliy needle,
  SENCTRL gauges, Beduan brass 1/4 (B08C2NLPR5) stay declared.

Re-fetch policy: if a spec matters for a new part, try curl with a browser
UA first, save the document here, and add it to this manifest. Never cite a
URL in PARTS without a local copy.
