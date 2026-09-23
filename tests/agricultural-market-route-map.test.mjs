import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendAgriculturalMarketTip, buildAgriculturalMarketTip, isAgriculturalMarketTip, isAgriculturalMarketZone } from "../src/lib/agricultural-market-route-map.js";

test("the market route map is attached only to 311CD322D", () => {
  const zone = { id: "market-zone", name: "311CD322D", is_deleted: false };
  assert.equal(isAgriculturalMarketZone(zone), true);
  assert.equal(isAgriculturalMarketZone({ ...zone, name: "311C" }), false);
  assert.equal(isAgriculturalMarketZone({ ...zone, is_deleted: true }), false);
  const tip = buildAgriculturalMarketTip(zone);
  assert.equal(isAgriculturalMarketTip(tip), true);
  assert.equal(tip.zone_id, zone.id);
  assert.equal(tip.marker_type, "market_map");
  assert.ok(Number.isFinite(tip.lat));
  assert.ok(Number.isFinite(tip.lng));
});

test("attaching the market tip preserves server tips and never duplicates the virtual tip", () => {
  const detail = { zone: { id: "market-zone", name: "311CD322D" }, tips: [{ id: "server-tip" }] };
  const once = appendAgriculturalMarketTip(detail);
  const twice = appendAgriculturalMarketTip(once);
  assert.deepEqual(once.tips.map((tip) => tip.id), ["agricultural-market-route-map", "server-tip"]);
  assert.deepEqual(twice.tips.map((tip) => tip.id), ["agricultural-market-route-map", "server-tip"]);
});

test("the bundled market layout keeps the complete original 1,947-cell grid without a local source path", () => {
  const data = JSON.parse(readFileSync(new URL("../assets/data/agricultural-market-route-map-cells.json", import.meta.url), "utf8"));
  assert.deepEqual(data.region, { rowStart: 2, rowEnd: 36, colStart: 10, colEnd: 68 });
  assert.equal(data.cells.length, 1947);
  assert.equal(Object.hasOwn(data, "source"), false);
  assert.ok(data.cells.some((cell) => cell.cellId === "2:10" && cell.value === "동부청과"));
  assert.ok(data.cells.some((cell) => cell.cellId === "2:29" && cell.value === "부산중앙청과"));
  assert.ok(data.cells.some((cell) => cell.cellId === "2:48" && cell.value === "농협반여공판장"));
});

test("the 322D market map includes the original mubaechu and yangnyeom layouts", () => {
  const data = JSON.parse(readFileSync(new URL("../assets/data/agricultural-market-annexes.json", import.meta.url), "utf8"));
  const { mubaechu, yangnyeom } = data.buildings;

  assert.equal(Object.hasOwn(data, "source"), false);
  assert.deepEqual(
    [mubaechu.rowStart, mubaechu.rowEnd, mubaechu.colStart, mubaechu.colEnd, mubaechu.cells.length],
    [1, 15, 1, 19, 75],
  );
  assert.deepEqual(
    [yangnyeom.rowStart, yangnyeom.rowEnd, yangnyeom.colStart, yangnyeom.colEnd, yangnyeom.cells.length],
    [0, 7, 0, 18, 49],
  );
  assert.ok(mubaechu.cells.some((cell) => cell.vendorName === "일성상회"));
  assert.ok(mubaechu.cells.some((cell) => cell.cellType === "walkway"));
  assert.ok(yangnyeom.cells.some((cell) => cell.vendorName === "고추사랑 참깨마을" && cell.stallNumber === "39"));
  assert.ok(yangnyeom.cells.some((cell) => cell.vendorName === "공동작업장" && cell.cellType === "facility"));
});
