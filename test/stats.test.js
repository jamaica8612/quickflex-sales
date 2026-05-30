import test from "node:test";
import assert from "node:assert/strict";

import { percentDelta, formatDelta, csvEscape, buildCsv, weekdayAverages } from "../src/lib/stats.js";

test("percentDelta returns null without a baseline", () => {
  assert.equal(percentDelta(100, 0), null);
  assert.equal(percentDelta(150, 100), 50);
  assert.equal(percentDelta(80, 100), -20);
});

test("formatDelta signs and rounds", () => {
  assert.equal(formatDelta(112, 100), "+12%");
  assert.equal(formatDelta(90, 100), "-10%");
  assert.equal(formatDelta(105, 100), "+5%");
  assert.equal(formatDelta(100.5, 100), "+0.5%"); // <10% keeps one decimal
  assert.equal(formatDelta(100, 0), ""); // no baseline -> blank
});

test("csvEscape quotes only when needed", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvEscape(null), "");
});

test("buildCsv prepends a BOM and uses CRLF", () => {
  const csv = buildCsv(["날짜", "매출"], [["2026-05-30", 12000]]);
  assert.equal(csv.charCodeAt(0), 0xfeff); // Excel-friendly UTF-8 BOM
  assert.equal(csv.slice(1), "날짜,매출\r\n2026-05-30,12000");
});

test("weekdayAverages averages worked days per weekday", () => {
  const out = weekdayAverages([
    { weekday: 1, revenue: 100, worked: true }, // Mon
    { weekday: 1, revenue: 300, worked: true }, // Mon
    { weekday: 1, revenue: 999, worked: false }, // off, ignored
    { weekday: 3, revenue: 500, worked: true }, // Wed
  ]);
  assert.equal(out.length, 7);
  assert.deepEqual(out[1], { weekday: 1, total: 400, days: 2, average: 200 });
  assert.deepEqual(out[3], { weekday: 3, total: 500, days: 1, average: 500 });
  assert.deepEqual(out[0], { weekday: 0, total: 0, days: 0, average: 0 }); // no Sun data
});
