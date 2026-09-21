import assert from "node:assert/strict";
import test from "node:test";
import { isPointInRouteNoteZone, routeNoteDetailCodes } from "../src/lib/route-note-rules.js";

const ring = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d], [a, b]];

test("detail claims deduplicate repeated postcode parts and include all route prefixes", () => {
  const polygon = { type: "MultiPolygon", coordinates: [[ring(126, 37, 127, 38)]],
    subLabels: ["３０３ ａ ０１", "303A01", "304B02", "303A", "302C02 / 03"], postcodes: ["12345", "12345", "12345"],
    codeGroups: [{ prefix: "304B", codes: [{ label: "304b02", postcode: "12345" }] }] };
  assert.deepEqual(routeNoteDetailCodes(polygon), ["302C02", "302C03", "303A01", "304B02"]);
});

test("point containment includes the outer and hole boundaries but excludes hole interiors", () => {
  const polygon = { type: "MultiPolygon", coordinates: [
    [ring(126, 37, 128, 39), ring(126.5, 37.5, 127.5, 38.5)],
    [ring(130, 35, 131, 36)],
  ] };
  assert.equal(isPointInRouteNoteZone({ lat: 37.2, lng: 126.2 }, polygon), true);
  assert.equal(isPointInRouteNoteZone({ lat: 38, lng: 127 }, polygon), false);
  assert.equal(isPointInRouteNoteZone({ lat: 37.5, lng: 127 }, polygon), true);
  assert.equal(isPointInRouteNoteZone({ lat: 37, lng: 126 }, polygon), true);
  assert.equal(isPointInRouteNoteZone({ lat: 35.5, lng: 130.5 }, polygon), true);
  assert.equal(isPointInRouteNoteZone({ lat: 34, lng: 130 }, polygon), false);
  assert.equal(isPointInRouteNoteZone({ lat: null, lng: 126 }, polygon), false);
});
