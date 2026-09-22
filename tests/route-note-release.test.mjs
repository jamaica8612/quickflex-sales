import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("new route editor exports and postcode service bypass pre-1.0.86 cached modules", async () => {
  const sw = read("sw.js"), main = read("src/main.js"), ui = read("src/ui/route-notes.js");
  const edges = [
    [main, "./services/route-notes.js?v=2", "./src/services/route-notes.js?v=2"],
    [main, "./ui/route-notes.js?v=7", "./src/ui/route-notes.js?v=7"],
    [ui, "./route-note-zone-editor.js?v=3", "./src/ui/route-note-zone-editor.js?v=3"],
    ...["src/ui/route-notes.js", "src/ui/route-note-zone-editor.js"].map((file) => [read(file), "../lib/route-note-map.js?v=5", "./src/lib/route-note-map.js?v=5"]),
    [read("route-share.js"), "./src/lib/route-note-map.js?v=5", "./src/lib/route-note-map.js?v=5"],
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
    assert.ok(read(file).includes("./styles/route-note-map.css?v=2"), file);
  }
  assert.ok(sw.includes('"./styles/route-note-map.css?v=2"'));
});
