import assert from "node:assert/strict";
import test from "node:test";

import { buildStatsInsights } from "../src/lib/stats-insights.js";
import { buildStatsReport } from "../src/lib/stats-report.js";

const currentPeriod = { year: 2026, month: 8 };

function reportFor(days, options = {}) {
  return buildStatsReport({
    currentPeriod,
    mode: "thisSettlement",
    asOfDate: "2026-07-28",
    goal: 1000,
    dailyRecords: days,
    ...options,
  });
}

test("future zero-value placeholders are schedules, not worked days", () => {
  const days = [
    { dateKey: "2026-07-26", revenue: 100, worked: true },
    { dateKey: "2026-07-27", revenue: 200, worked: true },
    { dateKey: "2026-07-28", revenue: 300, worked: true },
    ...Array.from({ length: 28 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 6, 29 + index));
      const dateKey = date.toISOString().slice(0, 10);
      return { dateKey, revenue: 0, count: 0, planned: true, worked: false };
    }),
  ];
  const insights = buildStatsInsights({ days, report: reportFor(days), asOfDate: "2026-07-28" });

  assert.equal(insights.outlook.workedDays, 3);
  assert.equal(insights.outlook.plannedDays, 28);
  assert.equal(insights.outlook.unknownDays, 0);
  assert.equal(insights.outlook.projectedRevenue, 6200);
});

test("missing future schedules and an unfinished or absent today keep projections unknown", () => {
  const worked = [
    { dateKey: "2026-07-26", revenue: 100, worked: true },
    { dateKey: "2026-07-27", revenue: 200, worked: true },
  ];
  const missing = buildStatsInsights({ days: worked, report: reportFor(worked), asOfDate: "2026-07-28" });
  assert.equal(missing.outlook.unknownDays, 28);
  assert.equal(missing.outlook.pendingToday, true, "an absent today is not treated as completed work");
  assert.equal(missing.outlook.projectedRevenue, null);

  const remaining = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 29 + index));
    return { dateKey: date.toISOString().slice(0, 10), planned: true, worked: false };
  });
  const pendingDays = [
    ...worked,
    { dateKey: "2026-07-28", planned: true, worked: false },
    ...remaining,
  ];
  const pending = buildStatsInsights({
    days: pendingDays,
    report: reportFor(pendingDays),
    asOfDate: "2026-07-28",
  });
  assert.equal(pending.outlook.pendingToday, true);
  assert.equal(pending.outlook.plannedDays, 28, "today is separate from future planned days");
  assert.equal(pending.outlook.projectedRevenue, null);
});

test("required revenue handles no target, achieved targets, and zero planned days", () => {
  const futureOff = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 29 + index));
    return { dateKey: date.toISOString().slice(0, 10), off: true };
  });
  const days = [{ dateKey: "2026-07-26", revenue: 1200, worked: true }, ...futureOff];
  const achieved = buildStatsInsights({ days, report: reportFor(days), asOfDate: "2026-07-28" });
  assert.equal(achieved.outlook.remainingAmount, 0);
  assert.equal(achieved.outlook.requiredDailyRevenue, 0);

  const noTargetReport = reportFor(days, { goal: 0 });
  const noTarget = buildStatsInsights({ days, report: noTargetReport, asOfDate: "2026-07-28" });
  assert.equal(noTarget.outlook.target, null);
  assert.equal(noTarget.outlook.remainingAmount, null);
  assert.equal(noTarget.outlook.requiredDailyRevenue, null);

  const historical = [
    { dateKey: "2026-07-26", revenue: 100, worked: true },
    { dateKey: "2026-07-27", revenue: 100, worked: true },
    { dateKey: "2026-07-28", revenue: 100, worked: true },
  ];
  const futurePlanned = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 29 + index));
    return { dateKey: date.toISOString().slice(0, 10), planned: true, worked: false };
  });
  const projectableDays = [...historical, ...futurePlanned];
  const projectableWithoutTarget = buildStatsInsights({
    days: projectableDays,
    report: reportFor(projectableDays, { goal: 0 }),
    asOfDate: "2026-07-28",
  });
  assert.equal(projectableWithoutTarget.outlook.projectedRevenue, 3100,
    "a target is not required for a schedule-backed projection");

  const required = buildStatsInsights({
    days: projectableDays,
    report: reportFor(projectableDays),
    asOfDate: "2026-07-28",
  });
  assert.equal(required.outlook.requiredDailyRevenue, 700 / 28,
    "only registered future workdays form the requirement denominator");
});

test("drivers compare equal workday samples and use a weighted delivery unit", () => {
  const days = [
    { dateKey: "2026-06-26", worked: true, volumeKnown: true, revenue: 10, count: 1, deliveryRevenue: 100, freshRevenue: 5, backupRevenue: 5 },
    { dateKey: "2026-06-27", worked: true, volumeKnown: true, revenue: 20, count: 9, deliveryRevenue: 450, freshRevenue: 10, backupRevenue: 10 },
    { dateKey: "2026-06-28", worked: true, volumeKnown: true, revenue: 999, count: 100, deliveryRevenue: 10000, freshRevenue: 999 },
    { dateKey: "2026-07-26", worked: true, volumeKnown: true, revenue: 100, count: 2, deliveryRevenue: 300, freshRevenue: 10, backupRevenue: 20 },
    { dateKey: "2026-07-27", worked: true, volumeKnown: true, revenue: 200, count: 8, deliveryRevenue: 800, freshRevenue: 30, backupRevenue: 40 },
  ];
  const insights = buildStatsInsights({ days, report: reportFor(days), asOfDate: "2026-07-28" });

  assert.equal(insights.drivers.available, true);
  assert.deepEqual(insights.drivers.current, {
    averageCount: 5,
    averageDeliveryUnit: 110,
    averageExtraRevenue: 50,
  });
  assert.deepEqual(insights.drivers.previous, {
    averageCount: 5,
    averageDeliveryUnit: 55,
    averageExtraRevenue: 15,
  });
});

test("revenue-only drivers keep extras but never turn missing volume into zero", () => {
  const days = [
    { dateKey: "2026-06-26", worked: true, volumeKnown: true, revenue: 100, count: 2, deliveryRevenue: 200, freshRevenue: 10 },
    { dateKey: "2026-06-27", worked: true, revenue: 200, freshRevenue: 20, backupRevenue: 10 },
    { dateKey: "2026-07-26", worked: true, volumeKnown: true, revenue: 300, count: 3, deliveryRevenue: 450, freshRevenue: 30 },
    { dateKey: "2026-07-27", worked: true, revenue: 400, freshRevenue: 40, backupRevenue: 20 },
  ];
  const insights = buildStatsInsights({ days, report: reportFor(days), asOfDate: "2026-07-28" });

  assert.equal(insights.drivers.available, true, "revenue comparison remains available");
  assert.deepEqual(insights.drivers.current, {
    averageCount: null,
    averageDeliveryUnit: null,
    averageExtraRevenue: 45,
  });
  assert.deepEqual(insights.drivers.previous, {
    averageCount: null,
    averageDeliveryUnit: null,
    averageExtraRevenue: 20,
  });
});

test("projection and typical percentiles retain precision until presentation", () => {
  const historical = [
    { dateKey: "2026-07-26", worked: true, revenue: 100 },
    { dateKey: "2026-07-27", worked: true, revenue: 101 },
    { dateKey: "2026-07-28", worked: true, revenue: 101 },
  ];
  const future = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 29 + index));
    return { dateKey: date.toISOString().slice(0, 10), planned: true, worked: false };
  });
  const days = [...historical, ...future];
  const insights = buildStatsInsights({ days, report: reportFor(days), asOfDate: "2026-07-28" });

  assert.equal(insights.outlook.averageRevenue, 302 / 3);
  assert.equal(insights.outlook.projectedRevenue, 302 + (302 / 3) * 28);
  assert.deepEqual(insights.typical, {
    days: 3,
    medianRevenue: 101,
    lowRevenue: 100.5,
    highRevenue: 101,
  });
});

test("past uncompleted schedules are review dates and outlook applies only in-period", () => {
  const days = [
    { dateKey: "2026-07-26", planned: true, worked: false },
    { dateKey: "2026-07-27", planned: true, off: true, worked: false },
  ];
  const report = reportFor(days);
  const insights = buildStatsInsights({ days, report, asOfDate: "2026-07-28" });
  assert.deepEqual(insights.outlook.reviewDates, ["2026-07-26"]);

  const outside = buildStatsInsights({ days, report, asOfDate: "2026-09-01" });
  assert.equal(outside.outlook.applicable, false);
  assert.equal(outside.outlook.projectedRevenue, null);
  assert.deepEqual(outside.outlook.reviewDates, []);
});

test("drivers stay unavailable when the as-of date is outside the current settlement", () => {
  const days = [
    { dateKey: "2026-06-26", worked: true, volumeKnown: true, revenue: 100, count: 1, deliveryRevenue: 100 },
    { dateKey: "2026-07-26", worked: true, volumeKnown: true, revenue: 200, count: 2, deliveryRevenue: 200 },
  ];
  const report = reportFor(days, { asOfDate: "2026-09-01" });
  assert.equal(report.comparison.available, true, "the source report can still expose a comparison");

  const insights = buildStatsInsights({ days, report, asOfDate: "2026-09-01" });
  assert.equal(insights.outlook.applicable, false);
  assert.deepEqual(insights.drivers, {
    available: false,
    current: {
      averageCount: null,
      averageDeliveryUnit: null,
      averageExtraRevenue: null,
    },
    previous: {
      averageCount: null,
      averageDeliveryUnit: null,
      averageExtraRevenue: null,
    },
  });
});
