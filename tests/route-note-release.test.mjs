import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("new route editor exports and postcode service bypass pre-1.0.86 cached modules", async () => {
  const sw = read("sw.js"), main = read("src/main.js"), ui = read("src/ui/route-notes.js");
  const edges = [
    [main, "./services/route-notes.js?v=2", "./src/services/route-notes.js?v=2"],
    [main, "./ui/route-notes.js?v=15", "./src/ui/route-notes.js?v=15"],
    [ui, "../lib/agricultural-market-route-map.js?v=2", "./src/lib/agricultural-market-route-map.js?v=2"],
    [ui, "./route-note-zone-editor.js?v=7", "./src/ui/route-note-zone-editor.js?v=7"],
    [read("src/ui/route-notes.js"), "../lib/route-note-map.js?v=9", "./src/lib/route-note-map.js?v=9"],
    [read("src/ui/route-note-zone-editor.js"), "../lib/route-note-map.js?v=9", "./src/lib/route-note-map.js?v=9"],
    [read("route-share.js"), "./src/lib/route-note-map.js?v=9", "./src/lib/route-note-map.js?v=9"],
    [read("src/lib/route-note-map.js"), "./route-note-icons.js?v=3", "./src/lib/route-note-icons.js?v=3"],
    [ui, "../lib/route-note-icons.js?v=3", "./src/lib/route-note-icons.js?v=3"],
    [read("src/lib/route-note-map.js"), "./route-note-map-geometry.js?v=2", "./src/lib/route-note-map-geometry.js?v=2"],
    ...["src/services/route-notes.js", "src/ui/route-notes.js", "src/ui/route-note-zone-editor.js"].map((file) => [read(file), "../lib/route-notes.js?v=2", "./src/lib/route-notes.js?v=2"]),
  ];
  for (const [source, specifier, cached] of edges) {
    assert.ok(source.includes(`from "${specifier}"`), specifier);
    assert.ok(sw.includes(`"${cached}"`), cached);
  }
  const rules = await import("../src/lib/route-notes.js?v=2");
  assert.equal(rules.routeNoteZoneNameKey("３１０ c"), "310C");
  const { createRouteNotesService } = await import("../src/services/route-notes.js?v=2");
  assert.equal(typeof createRouteNotesService({ getContext: () => null }).lookupPostcode, "function");
  for (const file of ["index.html", "route-share.html"]) {
    assert.ok(read(file).includes("./styles/route-note-map.css?v=6"), file);
  }
  assert.ok(sw.includes('"./styles/route-note-map.css?v=6"'));
  assert.ok(sw.includes('"./assets/icons/route-notes/phosphor-regular.svg"'));
  assert.ok(sw.includes('"./assets/data/agricultural-market-route-map-cells.json"'));
  assert.ok(sw.includes('"./assets/data/agricultural-market-annexes.json"'));
  assert.ok(sw.includes('"./styles/agricultural-market-route-map.css?v=2"'));
});
