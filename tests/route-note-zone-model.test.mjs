import test from "node:test";
import assert from "node:assert/strict";
import { appendManualPart, appendPostcode, createZoneGeometryHistory, removePart, restorePostcode, ringPoints, setRingPoints, zonePolygons } from "../src/lib/route-note-zone-model.js";

const ring = (x) => [[x, 37], [x + .01, 37], [x + .01, 37.01], [x, 37]];
const hole = (x) => [[x + .001, 37.001], [x + .002, 37.001], [x + .002, 37.002], [x + .001, 37.001]];
const imported = {
  type: "MultiPolygon", coordinates: [[ring(127), hole(127)], [ring(128)]],
  subLabels: ["302A", "302A"], postcodes: ["06236", "06236"],
  codeGroups: [{ prefix: "302", codes: [{ label: "302A", postcode: "06236" }] }],
  regionName: "서울", source: "postcode-boundary", retained: { original: true },
};

test("moving one vertex keeps holes, other parts, metadata and source input", () => {
  const changed = setRingPoints(imported, 0, 0, ringPoints(imported, 0, 0).map((point, i) => i ? point : { lat: 37.5, lng: 127.5 }));
  assert.deepEqual(changed.coordinates[0][1], imported.coordinates[0][1]);
  assert.deepEqual(changed.coordinates[1], imported.coordinates[1]);
  assert.deepEqual(changed.codeGroups, imported.codeGroups);
  assert.deepEqual(changed.retained, { original: true });
  assert.deepEqual(changed.coordinates[0][0][0], [127.5, 37.5]);
  assert.deepEqual(changed.coordinates[0][0].at(-1), [127.5, 37.5]);
  assert.deepEqual(imported.coordinates[0][0][0], [127, 37]);
});

test("postcode and drawn parts share a zone, undo/redo retain exact rings", () => {
  const history = createZoneGeometryHistory(imported);
  const mixed = appendManualPart(history.get(), [{ lat: 37, lng: 129 }, { lat: 37.01, lng: 129 }, { lat: 37.01, lng: 129.01 }], "302B");
  history.set(mixed);
  assert.equal(mixed.source, "mixed-boundary");
  assert.equal(zonePolygons(history.get()).length, 3);
  history.undo(); assert.deepEqual(history.get(), imported);
  history.redo(); assert.deepEqual(history.get(), mixed);
  assert.deepEqual(removePart(mixed, 2), { ...imported, source: "postcode-boundary" });
});

test("same postcode can hold different detail codes; restore affects selected detail only", () => {
  const lookup = { postcode: "06236", geometry: { type: "MultiPolygon", coordinates: [[ring(130)], [ring(131)]] } };
  const withSecondCode = appendPostcode(imported, lookup, "302B", "302");
  assert.deepEqual(withSecondCode.subLabels, ["302A", "302A", "302B", "302B"]);
  const altered = setRingPoints(withSecondCode, 0, 0, ringPoints(withSecondCode, 0, 0).map((point, index) => index ? point : { lat: 37.2, lng: 127.2 }));
  const restored = restorePostcode(altered, "06236", { postcode: "06236", geometry: { type: "MultiPolygon", coordinates: [[ring(127), hole(127)], [ring(128)]] } }, "302A");
  assert.deepEqual(restored.coordinates.slice(0, 2), imported.coordinates);
  assert.deepEqual(restored.coordinates.slice(2), withSecondCode.coordinates.slice(2));
  assert.deepEqual(restored.codeGroups, withSecondCode.codeGroups);
});

test("one detail code may include multiple postcodes and more than four parts", () => {
  let result = null;
  for (let index = 0; index < 5; index++) {
    const postcode = `0623${index}`;
    result = appendPostcode(result, { postcode, geometry: { type: "Polygon", coordinates: [ring(127 + index)] } }, "310C01", "310C");
  }
  assert.equal(result.coordinates.length, 5);
  assert.deepEqual(result.postcodes, ["06230", "06231", "06232", "06233", "06234"]);
  assert.equal(result.codeGroups[0].codes.length, 5);
  assert.deepEqual(result.subLabels, Array(5).fill("310C01"));
});
