// Test harness for fast_schematic_generator.html
// Extracts the embedded <script> and evaluates it against a minimal DOM stub,
// so the render pipeline, layout engine, and SVG export can be tested in Node
// without a browser. No dependencies.
"use strict";
const fs = require("fs");
const path = require("path");

function loadApp(extraJS) {
  const htmlPath = path.join(__dirname, "..", "fast_schematic_generator.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error("no <script> block found in HTML");

  const store = {};
  const makeHost = (id) =>
    store[id] ||
    (store[id] = {
      _html: "",
      // real DOM drops children when innerHTML is cleared; renderSchematic()
      // relies on that to re-render, so the stub must too or repeated renders
      // (e.g. a view-mode switch) would stack strips on top of each other
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; if (v === "") this.children.length = 0; },
      textContent: "",
      value: "",
      children: [],
      appendChild(c) { this.children.push(c); },
    });

  let captured = { svg: null };
  global.document = {
    getElementById: makeHost,
    createElement: (tag) => {
      if (tag === "a")
        return { _h: "", set href(v) { this._h = v; }, get href() { return this._h; }, download: "", click() {} };
      return { className: "", innerHTML: "" };
    },
    querySelectorAll: (sel) => {
      if (sel === "#strips svg") {
        return store["strips"].children.map((div) => {
          const mm = div.innerHTML.match(/<svg width="([\d.]+)" height="([\d.]+)"[^>]*>([\s\S]*)<\/svg>/);
          return { getAttribute: (k) => (k === "width" ? mm[1] : mm[2]), innerHTML: mm[3] };
        });
      }
      return [];
    },
  };
  global.window = { print() {} };
  global.Blob = class { constructor(parts) { this.data = parts.join(""); } };
  global.URL = { createObjectURL: (b) => { captured.svg = b.data; return "blob:x"; } };

  // eval in a function scope; expose the app's top-level bindings we need via a trailer
  const trailer = `;__hooks({SYSTEM,PARTS,ROW,CL,STRIP_H,TRUNK,TROW,SYM,MATCHED,TREE,LAST_RENDER,refIndex,applyJSON,downloadSVG,renderAll,lintPorts,jointMarker,setView,legendLines,specLine,PN_SYM,INTERNAL});`;
  let hooks = null;
  global.__hooks = (h) => { hooks = h; };
  eval(m[1] + trailer);
  delete global.__hooks;

  return { store, captured, app: hooks, extra: extraJS };
}

module.exports = { loadApp };
