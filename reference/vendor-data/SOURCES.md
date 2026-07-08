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
  hex nipple (06123-0804 = 1/2 x 1/4).
- `beduan` → `beduan-2w160-15.html` — mybeduan.com product page for the 1/2 in
  solenoid: "1/2\" female NPT port size, model designation 2W160-15".
  https://mybeduan.com/beduan-brass-electric-solenoid-valve-12-12v-air.html
- `apollo` → `apollo-94a-submittal.pdf` (+ .txt) — Apollo 94A series submittal
  sheet (Aalberts). NPT (female) 1/4"–4", CSA/UL fuel-gas approvals on NPT
  models. https://aalberts.compano.com/Data/Environments/000001/Attachment/Bijlage/PRD/ProductGroup/Apollo/Submittal_Tech_Sheets/SS_94A.pdf
- `sturgis` → `mbsturgis-38-sae-adapters.html` — MB Sturgis 3/8 SAE flare
  adapters page: "3/8″ Female SAE Swivel X 1/4″ Male NPTF Adapter" (the
  flareNptF part; Motorsnorkel #2327 is the same fitting but their site
  blocks fetching). https://www.mbsturgis.com/adapters-fittings/sae-flare-adapters/3-8-sae-flare-adapters/

## Blocked / unavailable (ports stay `src:"decl"` — declared from listing text)

- motorsnorkel.com — HTTP 403 to both curl and WebFetch.
- mrheater.com — /f273754.html and /f273702.html return 404 (PN pages moved);
  POL x 1/4 MNPT and 3/8 female-swivel hose genders declared from listings.
- mcmaster.com — blocks automated retrieval entirely (check valve, generic
  brass); check14 ports declared.
- Amazon product pages render a JS shell to fetchers — Breezliy needle,
  SENCTRL gauges, Beduan brass 1/4 (B08C2NLPR5) stay declared.

Re-fetch policy: if a spec matters for a new part, try curl with a browser
UA first, save the document here, and add it to this manifest. Never cite a
URL in PARTS without a local copy.
