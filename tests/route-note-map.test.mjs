import assert from "node:assert/strict";
import test from "node:test";
import { hasPolygon, polygonCentroid, polygonPoints, polygonRings, toPolygon } from "../src/lib/route-note-map.js";

test("route-note polygon helpers normalize a closed ring without mutating input", () => {
  const points = [{ lat: 37, lng: 127 }, { lat: 37, lng: 128 }, { lat: 38, lng: 127 }];
  const polygon = toPolygon(points);
  assert.equal(polygon.coordinates[0].length, 4);
  assert.deepEqual(points, [{ lat: 37, lng: 127 }, { lat: 37, lng: 128 }, { lat: 38, lng: 127 }]);
  assert.equal(hasPolygon(polygon), true);
  assert.equal(polygonPoints(polygon).length, 4);
});

test("route-note polygon helpers reject incomplete or malformed geometry", () => {
  assert.equal(toPolygon([{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }]), null);
  assert.equal(hasPolygon({ type: "Polygon", coordinates: [[ ["x", 1] ]] }), false);
  assert.equal(polygonCentroid(null), null);
});

test("route-note polygon helpers retain separate multipolygon paths and interior rings", () => {
  const multi = { type: "MultiPolygon", coordinates: [
    [[[127, 37], [128, 37], [127, 38], [127, 37]], [[127.2, 37.2], [127.3, 37.2], [127.2, 37.3], [127.2, 37.2]]],
    [[[129, 39], [130, 39], [129, 40], [129, 39]]],
  ] };
  const rings = polygonRings(multi);
  assert.equal(rings.length, 2);
  assert.equal(rings[0].length, 2);
  assert.equal(rings[1].length, 1);
  assert.equal(polygonPoints(multi).length, 12);
});
