import test from "node:test";
import assert from "node:assert/strict";

import { percentDelta, formatDelta, csvEscape, buildCsv } from "../src/lib/stats.js";

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
