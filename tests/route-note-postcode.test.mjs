import assert from "node:assert/strict";
import test from "node:test";
import { createPostcodeHandler } from "../supabase/functions/route-note-postcode/handler.js";
import { transformPostcodeGeometry } from "../supabase/functions/route-note-postcode/geometry.js";

const request = (postcode = "12345") => new Request("https://example.invalid/route-note-postcode", {
  method: "POST", body: JSON.stringify({ postcode }), headers: { authorization: "Bearer member-token" },
});

test("postcode handler scopes lookup to approved membership and returns transformed boundary", async () => {
  let called = 0;
  const fetchImpl = async (_url, options) => {
    called++;
    assert.equal(JSON.parse(options.body).districtNo, "12345");
    assert.ok(options.signal);
    return new Response(JSON.stringify({ results: { content: [{ sbdno: "12345", ctpvNm: "서울", sigNm: "종로구",
      geom: JSON.stringify({ type: "Polygon", coordinates: [[[1000000,2000000],[1000010,2000000],[1000000,2000010],[1000000,2000000]]] }) }] } }));
  };
  const transform = (geometry) => ({ ...geometry, coordinates: [[[127,37],[127.1,37],[127,37.1],[127,37]]] });
  const denied = createPostcodeHandler({ authorize: async () => false, transform, fetchImpl });
  assert.equal((await denied(request())).status, 403);
  assert.equal(called, 0);
  const handler = createPostcodeHandler({ authorize: async () => true, transform, fetchImpl });
  assert.equal((await handler(request("bad"))).status, 400);
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { postcode: "12345", cityName: "서울", districtName: "종로구",
    geometry: { type: "Polygon", coordinates: [[[127,37],[127.1,37],[127,37.1],[127,37]]] } });
  assert.equal(called, 1);
});

test("postcode handler rejects mismatched and oversized upstream responses without revealing details", async () => {
  const mismatch = createPostcodeHandler({ authorize: async () => true, transform: (geometry) => geometry,
    fetchImpl: async () => new Response(JSON.stringify({ results: { content: [{ sbdno: "54321", geom: "{}" }] } })) });
  assert.equal((await mismatch(request())).status, 502);
  const oversized = createPostcodeHandler({ authorize: async () => true, transform: (geometry) => geometry,
    fetchImpl: async () => new Response("x".repeat(2_000_001)) });
  assert.equal((await oversized(request())).status, 502);
});

test("postcode geometry transforms every polygon part and hole, preserving closure", () => {
  const polygon = { type: "MultiPolygon", coordinates: [
    [
      [[100,200],[110,200],[100,210],[100,200]],
      [[102,202],[103,202],[102,203],[102,202]],
    ],
    [[[120,220],[130,220],[120,230],[120,220]]],
  ] };
  let transformed = 0;
  const result = transformPostcodeGeometry(polygon, ([x,y]) => { transformed++; return [x / 10, y / 10]; });
  assert.equal(transformed, 12);
  assert.deepEqual(result.coordinates[0][1][0], [10.2,20.2]);
  assert.deepEqual(result.coordinates[1][0].at(-1), result.coordinates[1][0][0]);
  assert.throws(() => transformPostcodeGeometry({ type: "Polygon", coordinates: [
    [[100,200],[110,200],[100,210],[101,200]],
  ] }, ([x,y]) => [x / 10,y / 10]), /Open ring/);
  assert.throws(() => transformPostcodeGeometry({ type: "Polygon", coordinates: [
    Array.from({ length: 5001 }, () => [100,200]),
  ] }, ([x,y]) => [x / 10,y / 10]), /Too many coordinates/);
});
