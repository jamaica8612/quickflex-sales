import test from "node:test";
import assert from "node:assert/strict";
import { routeNoteBoundaryDisplay } from "../src/lib/route-note-map-geometry.js";
const west = [[0,0],[1,0],[1,1],[0,1],[0,0]];
const east = [[1,0],[2,0],[2,1],[1,1],[1,0]];
const hole = [[.2,.2],[.3,.2],[.3,.3],[.2,.3],[.2,.2]];
const edges = (display) => display.paths.flatMap((path) => path.slice(0,-1).map((point,index) => [point,path[index+1]]));
test("adjacent postal parts of the same detail code share one outer outline without losing a hole", () => {
  const geometry = { type: "MultiPolygon", coordinates: [[west,hole],[east]], subLabels: ["303A01","303A01"] };
  const original = structuredClone(geometry), display = routeNoteBoundaryDisplay(geometry);
  assert.equal(edges(display).length, 10);
  assert.equal(display.labels.length, 1);
  assert.equal(display.labels[0].text, "303A01");
  assert.deepEqual(geometry, original);
});
test("different detail codes retain a shared dividing line exactly once", () => {
  const display = routeNoteBoundaryDisplay({ type:"MultiPolygon", coordinates:[[west],[east]], subLabels:["303A01","303A02"] });
  assert.equal(edges(display).length, 7); assert.equal(display.labels.length, 2);
});
test("overlapping duplicate outlines remain visible and winding direction does not change joins", () => {
  assert.equal(edges(routeNoteBoundaryDisplay({type:"MultiPolygon",coordinates:[[west],[west]],subLabels:["303A01","303A01"]})).length,4);
  assert.equal(edges(routeNoteBoundaryDisplay({type:"MultiPolygon",coordinates:[[west],[east.toReversed()]],subLabels:["303A01","303A01"]})).length,6);
});
