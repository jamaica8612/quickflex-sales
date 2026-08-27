import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  buildEqualWorkdayComparison,
  buildStatsReport,
  buildTrend,
  dateRangeDayCount,
  dateKeysBetween,
  normalizeDateKey,
  normalizeStatsDays,
  parseDateKey,
  settlementPeriod,
  settlementPeriodsEndingAt,
} from "../src/lib/stats-report.js";

const currentPeriod = { year: 2026, month: 8 };

test("date keys and settlement boundaries remain calendar-safe across years and leap days", () => {
  assert.equal(normalizeDateKey("2026-02-28"), "2026-02-28");
  assert.equal(normalizeDateKey("2026-02-29"), null);
  assert.equal(normalizeDateKey("2024-02-29"), "2024-02-29");
  assert.equal(normalizeDateKey("2026-8-01"), null);
  assert.equal(normalizeDateKey(parseDateKey("2026-08-01")), "2026-08-01");
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
  assert.deepEqual(dateKeysBetween("2026-02-27", "2026-03-01"), [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
  ]);

  assert.deepEqual(settlementPeriod(2026, 1), {
    id: "2026-01",
    year: 2026,
    month: 1,
    start: "2025-12-26",
    end: "2026-01-25",
  });
});

test("equal-workday comparison ignores off days and truncates the longer previous cycle", () => {
  const { days } = normalizeStatsDays([
    { dateKey: "2026-06-26", revenue: 50, count: 1 },
    { dateKey: "2026-06-27", off: true },
    { dateKey: "2026-06-28", revenue: 100, count: 2 },
    { dateKey: "2026-06-29", revenue: 200, count: 3 },
    { dateKey: "2026-06-30", revenue: 999, count: 9 },
    { dateKey: "2026-07-26", revenue: 100, count: 2 },
    { dateKey: "2026-07-27", off: true },
    { dateKey: "2026-07-28", revenue: 200, count: 4 },
    { dateKey: "2026-07-29", revenue: 300, count: 6 },
  ]);

  const comparison = buildEqualWorkdayComparison(days, currentPeriod);
  assert.equal(comparison.available, true);
  assert.equal(comparison.requiredWorkDays, 3);
  assert.equal(comparison.availablePreviousWorkDays, 4);
  assert.equal(comparison.previous.revenue, 350, "only the first three previous worked days are compared");
  assert.equal(comparison.current.revenue, 600);
  assert.equal(comparison.revenueDelta, 250);
  assert.equal(comparison.revenueDeltaRate, 250 / 350);
  assert.equal(comparison.matchedPreviousThrough, "2026-06-29");
});

test("an incomplete previous cycle never produces a partial or fabricated comparison", () => {
  const { days } = normalizeStatsDays([
    { dateKey: "2026-06-26", revenue: 100 },
    { dateKey: "2026-06-27", revenue: 100 },
    { dateKey: "2026-07-26", revenue: 110 },
    { dateKey: "2026-07-27", revenue: 120 },
    { dateKey: "2026-07-28", revenue: 130 },
  ]);
  const comparison = buildEqualWorkdayComparison(days, currentPeriod);

  assert.equal(comparison.available, false);
  assert.equal(comparison.reason, "previous_insufficient_workdays");
  assert.equal(comparison.requiredWorkDays, 3);
  assert.equal(comparison.availablePreviousWorkDays, 2);
  assert.equal(comparison.previous, null);
  assert.equal(comparison.revenueDelta, null);
  assert.equal(comparison.revenueDeltaRate, null);
});

test("comparison reports both positive and negative deltas without dividing by zero", () => {
  const positive = buildStatsReport({
    currentPeriod,
    dailyRecords: [
      { dateKey: "2026-06-26", revenue: 100, count: 10 },
      { dateKey: "2026-07-26", revenue: 150, count: 8 },
    ],
  }).comparison;
  assert.equal(positive.revenueDelta, 50);
  assert.equal(positive.revenueDeltaRate, 0.5);
  assert.equal(positive.countDelta, -2);
  assert.equal(positive.countDeltaRate, -0.2);

  const negative = buildStatsReport({
    currentPeriod,
    dailyRecords: [
      { dateKey: "2026-06-26", revenue: 200, worked: true },
      { dateKey: "2026-07-26", revenue: 120, worked: true },
    ],
  }).comparison;
  assert.equal(negative.revenueDelta, -80);
  assert.equal(negative.revenueDeltaRate, -0.4);

  const zeroBase = buildStatsReport({
    currentPeriod,
    dailyRecords: [
      { dateKey: "2026-06-26", revenue: 0, worked: true },
      { dateKey: "2026-07-26", revenue: 10, worked: true },
    ],
  }).comparison;
  assert.equal(zeroBase.available, true);
  assert.equal(zeroBase.revenueDelta, 10);
  assert.equal(zeroBase.revenueDeltaRate, null);
});

test("zero-value and no-record reports expose an empty series without fake best data", () => {
  const noRecords = buildStatsReport({ currentPeriod, dailyRecords: [], asOfDate: "2026-08-01" });
  assert.equal(noRecords.empty, true);
  assert.equal(noRecords.trend.isEmpty, true);
  assert.equal(noRecords.trend.granularity, "day");
  assert.equal(noRecords.trend.buckets.length, 7);
  assert.equal(noRecords.summary.revenue, 0);
  assert.equal(noRecords.summary.workDays, 0);
  assert.equal(noRecords.comparison.reason, "current_no_workdays");

  const offOnly = buildStatsReport({
    currentPeriod,
    entries: { "2026-07-26": { off: true, revenue: 0, count: 0 } },
    asOfDate: "2026-07-26",
  });
  assert.equal(offOnly.empty, true, "an off-day must not become a non-zero chart series");
  assert.equal(offOnly.summary.offDays, 1);
  assert.equal(offOnly.summary.recordDays, 1);
});

test("this and last settlement trends use daily buckets and respect the current as-of date", () => {
  const current = buildTrend([], currentPeriod, "thisMonth", { asOfDate: "2026-08-01" });
  assert.equal(current.granularity, "day");
  assert.equal(current.buckets.length, 7);
  assert.equal(current.buckets[0].key, "2026-07-26");
  assert.equal(current.buckets.at(-1).key, "2026-08-01");

  const previous = buildTrend([], currentPeriod, "lastSettlement", { asOfDate: "2026-08-01" });
  assert.equal(previous.granularity, "day");
  assert.equal(previous.buckets[0].key, "2026-06-26");
  assert.equal(previous.buckets.at(-1).key, "2026-07-25");
});

test("last-three-settlement trend aggregates into Monday-based weekly buckets", () => {
  const { days } = normalizeStatsDays([
    { dateKey: "2026-05-26", revenue: 10, count: 1 },
    { dateKey: "2026-05-31", revenue: 15, count: 2 },
    { dateKey: "2026-06-01", revenue: 20, count: 3 },
    { dateKey: "2026-08-25", revenue: 30, count: 4 },
  ]);
  const trend = buildTrend(days, currentPeriod, "last3");

  assert.equal(trend.granularity, "week");
  assert.equal(trend.isEmpty, false);
  assert.equal(trend.buckets[0].key, "2026-05-25");
  assert.equal(trend.buckets[0].start, "2026-05-26", "the first week is clipped to the selected range");
  assert.equal(trend.buckets[0].end, "2026-05-31");
  assert.equal(trend.buckets[0].revenue, 25);
  assert.equal(trend.buckets[1].revenue, 20);
  assert.equal(trend.buckets.reduce((sum, bucket) => sum + bucket.revenue, 0), 75);
});

test("last-twelve trend has one 26th-to-25th bucket per settlement cycle", () => {
  const period = { year: 2026, month: 9 };
  const periods = settlementPeriodsEndingAt(period, 12);
  assert.equal(periods[0].id, "2025-10");
  assert.equal(periods.at(-1).id, "2026-09");

  const { days } = normalizeStatsDays([
    { dateKey: "2025-09-26", revenue: 100 },
    { dateKey: "2025-10-25", revenue: 50 },
    { dateKey: "2025-10-26", revenue: 25 },
    { dateKey: "2026-09-25", revenue: 200 },
  ]);
  const trend = buildTrend(days, period, "last12");

  assert.equal(trend.granularity, "settlement");
  assert.equal(trend.buckets.length, 12);
  assert.equal(trend.buckets[0].key, "2025-10");
  assert.equal(trend.buckets[0].start, "2025-09-26");
  assert.equal(trend.buckets[0].end, "2025-10-25");
  assert.equal(trend.buckets[0].revenue, 150);
  assert.equal(trend.buckets[1].revenue, 25);
  assert.equal(trend.buckets.at(-1).revenue, 200);
});

test("custom ranges share the report path and switch long spans to weekly buckets", () => {
  const short = buildStatsReport({
    currentPeriod,
    mode: "custom",
    customRange: { from: "2026-08-01", to: "2026-08-07" },
    dailyRecords: [{ dateKey: "2026-08-03", revenue: 300, count: 4 }],
    goal: 1000,
  });
  assert.deepEqual(short.range, {
    start: "2026-08-01",
    end: "2026-08-07",
    settlementCount: 0,
  });
  assert.equal(short.summary.revenue, 300);
  assert.equal(short.trend.granularity, "day");
  assert.equal(short.trend.buckets.length, 7);
  assert.equal(short.goal.applicable, false);

  const long = buildStatsReport({
    currentPeriod,
    mode: "custom",
    customRange: { from: "2026-01-01", to: "2026-04-01" },
    dailyRecords: [],
  });
  assert.equal(long.trend.granularity, "week");
  assert.equal(dateRangeDayCount("2026-08-01", "2026-08-07"), 7);
  assert.throws(() => buildStatsReport({
    currentPeriod,
    mode: "custom",
    customRange: { from: "2026-08-07", to: "2026-08-01" },
  }), /시작일과 종료일/);
  assert.throws(() => buildStatsReport({
    currentPeriod,
    mode: "custom",
    customRange: { from: "2020-01-01", to: "2026-08-01" },
  }), /최대 1096일/);
});

test("goal progress applies only to one settlement cycle", () => {
  const common = {
    currentPeriod,
    goal: 1000,
    dailyRecords: [{ dateKey: "2026-07-26", revenue: 250 }],
  };
  const current = buildStatsReport({ ...common, mode: "thisSettlement" });
  const previous = buildStatsReport({
    ...common,
    mode: "lastSettlement",
    dailyRecords: [{ dateKey: "2026-06-26", revenue: 1200 }],
  });
  const last3 = buildStatsReport({ ...common, mode: "last3" });
  const last12 = buildStatsReport({ ...common, mode: "last12" });

  assert.equal(current.goal.applicable, true);
  assert.equal(current.goal.progressPct, 25);
  assert.equal(previous.goal.applicable, true);
  assert.equal(previous.goal.progressPct, 120);
  assert.equal(previous.goal.cappedProgressPct, 100);
  assert.deepEqual(last3.goal, {
    applicable: false,
    target: null,
    progressPct: null,
    cappedProgressPct: null,
  });
  assert.equal(last12.goal.applicable, false);
});

test("normalization sums duplicate date rows and reports malformed keys", () => {
  const normalized = normalizeStatsDays([
    { dateKey: "2026-07-26", revenue: 100, count: 1 },
    { date: "2026-07-26", revenue: 50, deliveryCount: 2 },
    { dateKey: "2026-02-30", revenue: 999 },
  ]);
  assert.equal(normalized.days.length, 1);
  assert.equal(normalized.days[0].revenue, 150);
  assert.equal(normalized.days[0].count, 3);
  assert.equal(normalized.ignoredRecordCount, 1);
});
