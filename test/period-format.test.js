import test from "node:test";
import assert from "node:assert/strict";

import { periodBounds, periodKeysFor, periodForDate, prevPeriod } from "../src/lib/date.js";
import { formatCalendarWon, formatKoreanWon, formatCompactWonWithUnit } from "../src/lib/format.js";

test("periodBounds spans the 26th of prev month to the 25th", () => {
  const { start, end } = periodBounds(2026, 6); // June settlement
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 4); // May (0-based)
  assert.equal(start.getDate(), 26);
  assert.equal(end.getMonth(), 5); // June
  assert.equal(end.getDate(), 25);
});

test("periodKeysFor yields every day key inclusive", () => {
  const keys = periodKeysFor(2026, 6);
  assert.equal(keys[0], "2026-05-26");
  assert.equal(keys[keys.length - 1], "2026-06-25");
  assert.equal(keys.length, 31);
});

test("periodForDate buckets <=25 into current month, >25 into next", () => {
  assert.deepEqual(periodForDate(new Date(2026, 5, 25)), { year: 2026, month: 6 });
  assert.deepEqual(periodForDate(new Date(2026, 5, 26)), { year: 2026, month: 7 });
  assert.deepEqual(periodForDate(new Date(2026, 11, 26)), { year: 2027, month: 1 }); // year rollover
});

test("prevPeriod steps back one settlement month", () => {
  assert.deepEqual(prevPeriod(2026, 6), { year: 2026, month: 5 });
  assert.deepEqual(prevPeriod(2026, 1), { year: 2025, month: 12 });
});

test("formatCalendarWon uses 만 above 10k, blank for zero", () => {
  assert.equal(formatCalendarWon(0), "");
  assert.equal(formatCalendarWon(9500), "9,500");
  assert.equal(formatCalendarWon(12000), "1.2만");
  assert.equal(formatCalendarWon(20000), "2만");
});

test("formatKoreanWon scales to 만 and 억", () => {
  assert.equal(formatKoreanWon(0), "0");
  assert.equal(formatKoreanWon(50000), "5만");
  assert.equal(formatKoreanWon(123456789), "1.2억");
  assert.equal(formatKoreanWon(2000000000), "20억");
});

test("formatCompactWonWithUnit appends 원", () => {
  assert.equal(formatCompactWonWithUnit(0), "0원");
  assert.equal(formatCompactWonWithUnit(8000), "8,000원");
  assert.equal(formatCompactWonWithUnit(15000), "1.5만원");
});
