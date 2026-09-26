import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowPreviousPeriod } from "../src/lib/period-fallback.js";

// A new settlement period (e.g. 9/26–10/25) starts with zero recorded work
// days. Until the driver logs a first non-off day, both 매출노트 and
// 정산노트 should fall back to showing the period that just ended, since
// that is what the driver actually cares about (it is what they get paid).

test("falls back to the previous period once the current period has no recorded work day", () => {
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: 0, previousWorkDays: 20 }), true);
});

test("stays on the current period once at least one work day is recorded", () => {
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: 1, previousWorkDays: 20 }), false);
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: 5, previousWorkDays: 0 }), false);
});

test("brand-new users with no previous data either keep today's empty state", () => {
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: 0, previousWorkDays: 0 }), false);
});

test("treats missing/undefined inputs as zero rather than throwing", () => {
  assert.equal(shouldShowPreviousPeriod({}), false);
  assert.equal(shouldShowPreviousPeriod(), false);
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: undefined, previousWorkDays: 3 }), true);
});

test("never triggers on a negative work-day count for either period", () => {
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: -1, previousWorkDays: 5 }), true, "negative current still counts as 'no work yet'");
  assert.equal(shouldShowPreviousPeriod({ currentWorkDays: 0, previousWorkDays: -1 }), false, "a negative previous count is not real data");
});
