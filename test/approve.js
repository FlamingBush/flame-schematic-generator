// Regenerate the approved drawings — run: npm run approve
//
// Approving is a HUMAN act. This script refuses to be silent about it:
//   1. it diffs the old golden against the new BEFORE overwriting and prints
//      how many chunks you are waving through;
//   2. it rasterizes both views and points you at the PNGs, because the suite
//      cannot see a wrong-LOOKING drawing;
//   3. it exits 1 under CI.
//
// It deliberately does NOT gate on a dirty working tree: once you commit the
// source change the tree is clean, and approve would refuse exactly when you
// legitimately need it.
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { VIEWS, APPROVED_DIR, goldenPath, goldenFor, summarize } = require("./golden");

if (process.env.CI) {
  console.error("approve: refusing to run under CI — approving a drawing is a human act.");
  process.exit(1);
}

fs.mkdirSync(APPROVED_DIR, { recursive: true });

let totalChanged = 0, created = 0;
const pngs = [];

for (const view of VIEWS) {
  const file = goldenPath(view);
  const next = goldenFor(view);

  if (fs.existsSync(file)) {
    const prev = fs.readFileSync(file, "utf8");
    if (prev === next) {
      console.log(`${view}: unchanged (${next.split("\n").length} chunks)`);
    } else {
      const { changed, chunks, report } = summarize(prev, next, { label: view, maxHunks: 8 });
      totalChanged += changed;
      console.log(report);
      console.log("");
    }
  } else {
    created++;
    console.log(`${view}: CREATED — ${next.split("\n").length} chunks, no previous golden to diff against`);
  }

  fs.writeFileSync(file, next);

  // Rasterize so there is something to actually look at. `-b white` matters:
  // the drawing has no background rect, and a transparent PNG renders as a
  // black sheet in most viewers — which is not something you can review.
  const png = path.join(APPROVED_DIR, `drawing-${view}.png`);
  try {
    execFileSync("rsvg-convert", ["-w", "2100", "-b", "white", file, "-o", png], { stdio: "pipe" });
    pngs.push(png);
  } catch (err) {
    console.error(`  ! could not rasterize ${view}: ${err.message.split("\n")[0]}`);
    console.error("    install librsvg (brew install librsvg) — cairosvg is not available here");
  }
}

console.log("─".repeat(72));
if (created) console.log(`${created} golden(s) created.`);
if (totalChanged) console.log(`${totalChanged} chunk(s) changed across ${VIEWS.length} views.`);
if (!created && !totalChanged) console.log("Goldens already up to date — nothing to approve.");

if (pngs.length) {
  console.log("");
  console.log("  LOOK AT THE PNG BEFORE YOU COMMIT — the suite cannot see a wrong-looking drawing:");
  pngs.forEach((p) => console.log("    " + p));
}
console.log("");
console.log("Then commit the golden diff alongside the source change.");
