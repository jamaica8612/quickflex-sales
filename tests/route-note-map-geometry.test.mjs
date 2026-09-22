import test from "node:test";
import assert from "node:assert/strict";
import { routeNoteBoundaryDisplay, routeNoteLabelGroups } from "../src/lib/route-note-map-geometry.js";
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
  assert.deepEqual(display.labels[0].position, { lat: 5.2 / 15, lng: 10.2 / 15 });
  assert.deepEqual(geometry, original);
});
test("labels join only same-code pieces with a shared outer edge and retain source geometry", () => {
  const remote = [[4,0],[5,0],[5,1],[4,1],[4,0]];
  const vertexTouch = [[2,1],[3,1],[3,2],[2,2],[2,1]];
  const geometry = { type: "MultiPolygon", coordinates: [[west,hole],[east],[remote],[vertexTouch]], subLabels: ["303A01","303A01","303A01","303A01"] };
  const original = structuredClone(geometry);
  const labels = routeNoteLabelGroups(geometry, "parent");
  assert.deepEqual(labels.map(({ text }) => text), ["303A01", "303A01", "303A01"]);
  assert.deepEqual(labels.map(({ position }) => position), [
    { lat: 5.2 / 15, lng: 10.2 / 15 },
    { lat: 2 / 5, lng: 22 / 5 },
    { lat: 7 / 5, lng: 12 / 5 },
  ]);
  assert.deepEqual(geometry, original);
});
test("neighboring codes stay separate, and missing sublabels use the parent name per disconnected piece", () => {
  const other = [[2,0],[3,0],[3,1],[2,1],[2,0]];
  const geometry = { type: "MultiPolygon", coordinates: [[west,hole],[east],[other]], subLabels: ["303A01","303A01","303A02"] };
  assert.deepEqual(routeNoteLabelGroups(geometry, "parent").map(({ text }) => text), ["303A01", "303A02"]);
  const fallback = { type: "MultiPolygon", coordinates: [[west],[other]] };
  assert.deepEqual(routeNoteLabelGroups(fallback, "parent"), [
    { text: "parent", position: { lat: 2 / 5, lng: 2 / 5 } },
    { text: "parent", position: { lat: 2 / 5, lng: 12 / 5 } },
  ]);
  assert.equal(routeNoteBoundaryDisplay(fallback), null);
});
test("different detail codes retain a shared dividing line exactly once", () => {
  const display = routeNoteBoundaryDisplay({ type:"MultiPolygon", coordinates:[[west],[east]], subLabels:["303A01","303A02"] });
  assert.equal(edges(display).length, 7); assert.equal(display.labels.length, 2);
});
test("overlapping duplicate outlines remain visible and winding direction does not change joins", () => {
  assert.equal(edges(routeNoteBoundaryDisplay({type:"MultiPolygon",coordinates:[[west],[west]],subLabels:["303A01","303A01"]})).length,4);
  assert.equal(edges(routeNoteBoundaryDisplay({type:"MultiPolygon",coordinates:[[west],[east.toReversed()]],subLabels:["303A01","303A01"]})).length,6);
});
