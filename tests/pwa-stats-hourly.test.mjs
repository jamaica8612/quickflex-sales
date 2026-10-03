import assert from "node:assert/strict";
import test from "node:test";
import { buildHourlyStats } from "../src/lib/stats-hourly.js";
import { addDays } from "../src/lib/stats-report.js";

function day(dateKey, extra = {}) {
  return { dateKey, worked: true, off: false, count: 100, revenue: 100000, routes: [], ...extra };
}

function timing(dateKey, extra = {}) {
  return {
    user_id: "synthetic-driver", work_id: `synthetic-${dateKey}`, work_date: dateKey, work_shift: "day",
    started_at: `${dateKey}T08:00:00+09:00`, ended_at: `${dateKey}T10:00:00+09:00`,
    active_seconds: 3600, measured_items: 100, route_active_seconds: { "310C": 3600 }, ...extra,
  };
}

function fixtures(count = 3, change = () => ({}), from = "2026-09-26") {
  const days = [], timings = [];
  for (let index = 0; index < count; index += 1) {
    const key = addDays(from, index);
    const edits = change(index, key);
    days.push(day(key, edits.day));
    timings.push(timing(key, edits.timing));
  }
  return { days, timings, asOfDate: addDays(from, count - 1) };
}

test("no measurement hides the card and fewer than three eligible dates withholds hourly numbers", () => {
  const noTiming = buildHourlyStats({ days: [day("2026-10-01")] });
  assert.equal(noTiming.hasTimings, false);
  assert.equal(noTiming.ready, false);
  assert.equal(noTiming.actualHourly, null);
  assert.equal(noTiming.excludedDays, 1);
  assert.deepEqual(noTiming.dailyReviews, [{ dateKey: "2026-10-01", coverage: null, eligible: false, reason: "missing_timing" }]);
  const few = buildHourlyStats(fixtures(2));
  assert.equal(few.hasTimings, true);
  assert.equal(few.measuredDays, 2);
  assert.equal(few.ready, false);
  assert.equal(few.bestActual, null);
});

test("daily revenue includes extras and hourly averages pool revenue and seconds", () => {
  const input = fixtures(3, (index, key) => ({
    day: { revenue: index === 0 ? 120000 : 100000, freshRevenue: index === 0 ? 10000 : 0, backupRevenue: index === 0 ? 10000 : 0 },
    timing: index === 0 ? { ended_at: `${key}T12:00:00+09:00`, active_seconds: 7200, route_active_seconds: { "310C": 7200 } } : {},
  }));
  const result = buildHourlyStats(input);
  assert.equal(result.actualHourly, 320000 / 8);
  assert.equal(result.deliveryHourly, 320000 / 4);
  assert.equal(result.averageNonDeliverySeconds, 4 * 3600 / 3);
  assert.notEqual(result.actualHourly, (30000 + 50000 + 50000) / 3, "never average individual hourly rates");
});

test("exactly eighty percent measured coverage is eligible but below it is excluded", () => {
  const input = fixtures(4, (index) => ({ timing: { measured_items: index === 3 ? 79 : 80 } }));
  const result = buildHourlyStats(input);
  assert.equal(result.ready, true);
  assert.equal(result.measuredDays, 3);
  assert.equal(result.excludedDays, 1);
  assert.ok(result.eligibleDays.every((row) => row.coverage === 0.8));
  assert.deepEqual(result.dailyReviews.at(-1), { dateKey: "2026-09-29", coverage: 0.79, eligible: false, reason: "low_coverage" });
});

test("missing starts or ends, reversed or excessive durations, and zero or invalid active time are excluded", () => {
  const invalid = [
    { started_at: null }, { ended_at: null }, { started_at: "not-a-time" },
    { ended_at: "2026-09-25T10:00:00+09:00" },
    { ended_at: "2026-10-10T10:00:00+09:00" },
    { active_seconds: 0 }, { active_seconds: -1 }, { active_seconds: 7201 },
    { active_seconds: Infinity }, { active_seconds: 3599.5 }, { route_active_seconds: { "310C": -1 } },
    { route_active_seconds: { "310C": "3600" } },
    { route_active_seconds: { "310C": 3661 } },
  ];
  for (const bad of invalid) {
    const input = fixtures(4, (index) => ({ timing: index === 3 ? bad : {} }));
    const result = buildHourlyStats(input);
    assert.equal(result.measuredDays, 3, JSON.stringify(bad));
    assert.equal(result.excludedDays, 1, JSON.stringify(bad));
    assert.equal(result.dailyReviews.at(-1).reason, bad.started_at === null || bad.ended_at === null ? "missing_start_end" : "invalid_timing");
  }
});

test("night work uses its explicit work date rather than its start or end calendar date", () => {
  const input = fixtures(3, (index, key) => ({ timing: {
    work_shift: "night", started_at: `${key}T22:00:00+09:00`,
    ended_at: `${addDays(key, 1)}T02:00:00+09:00`, active_seconds: 7200,
    route_active_seconds: { "310C": 7200 },
  } }));
  const result = buildHourlyStats(input);
  assert.equal(result.measuredDays, 3);
  assert.equal(result.actualHourly, 25000);
  assert.equal(result.bestActual.dateKey, "2026-09-26");
});

test("multiple works on one work date sum their duration and dedupe repeated work ids", () => {
  const input = fixtures();
  input.timings[0] = timing("2026-09-26", { measured_items: 50 });
  input.timings.push({ ...input.timings[0] });
  input.timings.push(timing("2026-09-26", {
    work_id: "synthetic-second-work", started_at: "2026-09-26T12:00:00+09:00",
    ended_at: "2026-09-26T14:00:00+09:00", measured_items: 50,
  }));
  const result = buildHourlyStats(input);
  const first = result.eligibleDays[0];
  assert.equal(first.workSeconds, 14400);
  assert.equal(first.activeSeconds, 7200);
  assert.equal(first.measuredItems, 100);
  assert.equal(result.measuredDays, 3, "work count never substitutes for distinct dates");
  assert.equal(result.actualHourly, 300000 / 8);
});

test("all known finalized work ids need valid timings even when the other work covers ninety percent", () => {
  const input = fixtures(4, (index, key) => ({
    day: index === 3 ? { workIds: [`synthetic-${key}`, "synthetic-untimed-final-work"] } : {},
    timing: index === 3 ? { measured_items: 90 } : {},
  }));
  const result = buildHourlyStats(input);
  assert.equal(result.measuredDays, 3);
  assert.equal(result.excludedDays, 1);
  assert.equal(result.dailyReviews.at(-1).coverage, 0.9);
  assert.equal(result.dailyReviews.at(-1).reason, "missing_timing");
});

test("an invalid provided work excludes the date instead of attaching its revenue to valid work time", () => {
  const input = fixtures(4);
  input.timings.push(timing("2026-09-29", { work_id: "synthetic-bad-work", active_seconds: 0 }));
  assert.equal(buildHourlyStats(input).measuredDays, 3);
});

test("route hourly rates use historical snapshots without fresh-bag or backup additions", () => {
  const input = fixtures(3, (index, key) => ({ day: {
    revenue: 115000, freshRevenue: 5000, backupRevenue: 10000,
    routes: [{ route: "310C", count: 100, unit_snapshot: 1000, unit: 9000, workId: `synthetic-${key}` }],
  } }));
  const result = buildHourlyStats(input);
  assert.equal(result.actualHourly, 57500);
  assert.deepEqual(result.routes, [{ route: "310C", count: 300, revenue: 300000, activeSeconds: 10800, hourly: 100000, days: 3 }]);
});

test("explicit delivery-only revenue preserves the adapter's embedded-backup subtraction", () => {
  const input = fixtures(3, (index, key) => ({ day: {
    routes: [{ route: "310C", count: 100, unit_snapshot: 1030, revenue: 100000, workId: `synthetic-${key}` }],
  } }));
  assert.equal(buildHourlyStats(input).routes[0].hourly, 100000);
});

test("manual quantities, untimed routes, grouped routes and duplicate snapshot rows do not inflate route revenue", () => {
  const input = fixtures(3, (index, key) => ({ day: {
    routes: [
      { route: "310C", count: 100, revenue: 100000, workId: `synthetic-${key}` },
      { route: "310C", count: 100, revenue: 100000, workId: `synthetic-${key}` },
      { route: "310C", count: 1000, revenue: 10000000 },
      { route: "310D", count: 1000, revenue: 10000000, workId: `synthetic-${key}` },
      { route: "310C|310D", count: 1000, revenue: 10000000, workId: `synthetic-${key}` },
    ],
  } }));
  const result = buildHourlyStats(input);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].count, 300);
  assert.equal(result.routes[0].revenue, 300000);
});

test("routes require three distinct eligible dates, not three works on the same date", () => {
  const input = fixtures(3, (index, key) => ({ day: {
    routes: index < 2 ? [{ route: "310C", count: 100, revenue: 100000, workId: `synthetic-${key}` }] : [],
  } }));
  assert.equal(buildHourlyStats(input).ready, true);
  assert.deepEqual(buildHourlyStats(input).routes, []);
  input.days[2].routes.push({ route: "310C", count: 100, revenue: 100000, workId: "synthetic-2026-09-28" });
  input.timings[2].measured_items = 79;
  assert.deepEqual(buildHourlyStats(input).routes, [], "a low-coverage date cannot qualify a route");
  const key = "2026-09-26";
  const works = [0, 1, 2].map((index) => timing(key, { work_id: `synthetic-work-${index}` }));
  const oneDate = buildHourlyStats({
    days: [day(key, { count: 300, revenue: 300000, routes: works.map((work) => ({
      route: "310C", count: 100, revenue: 100000, workId: work.work_id,
    })) })], timings: works,
  });
  assert.equal(oneDate.measuredDays, 1);
  assert.deepEqual(oneDate.routes, [], "three works still supply only one measured date");
});

test("route comparison is shown only when the comparable highest-count and highest-hourly routes differ", () => {
  const input = fixtures(3, (index, key) => ({
    day: { count: 100, routes: [
      { route: "310C", count: 60, revenue: 60000, workId: `synthetic-${key}` },
      { route: "310D", count: 40, revenue: 80000, workId: `synthetic-${key}` },
    ] },
    timing: { route_active_seconds: { "310C": 1800, "310D": 1800 } },
  }));
  const result = buildHourlyStats(input);
  assert.equal(result.comparison.countRoute.route, "310C");
  assert.equal(result.comparison.hourlyRoute.route, "310D");
  input.days.forEach((row) => { row.routes[0].revenue = 100000; });
  assert.equal(buildHourlyStats(input).comparison, null);
  input.days.forEach((row) => {
    row.routes[0].count = 40;
    row.routes[1].count = 60;
    row.routes[0].revenue = row.routes[1].revenue = 60000;
  });
  assert.equal(buildHourlyStats(input).comparison, null, "a tied hourly rate cannot be described as better");
});

test("range filters samples but a measurement in another range still means the driver has measured", () => {
  const input = fixtures(4);
  const result = buildHourlyStats({ ...input, range: { start: "2026-09-27", end: "2026-09-29" } });
  assert.equal(result.measuredDays, 3);
  assert.equal(result.ready, true);
  const empty = buildHourlyStats({ ...input, range: { start: "2026-10-01", end: "2026-10-25" } });
  assert.equal(empty.hasTimings, true);
  assert.equal(empty.ready, false);
});

test("personal hourly records use earliest ties and the existing ten-workday celebration boundary", () => {
  const input = fixtures(10, (index) => ({ day: { revenue: index === 9 ? 120000 : 100000 } }), "2026-09-20");
  const result = buildHourlyStats(input);
  assert.deepEqual(result.bestActual, { value: 60000, dateKey: "2026-09-29", isNew: true });
  const short = { ...input, days: input.days.slice(1), timings: input.timings.slice(1) };
  assert.equal(buildHourlyStats(short).bestActual.isNew, false);
  input.days[9].revenue = 100000;
  assert.deepEqual(buildHourlyStats(input).bestActual, { value: 50000, dateKey: "2026-09-20", isNew: false });
});

test("a high-revenue day without comparable timing cannot win the hourly record", () => {
  const input = fixtures(4, (index) => ({ day: { revenue: index === 3 ? 500000 : 100000 }, timing: { measured_items: index === 3 ? 79 : 100 } }));
  assert.equal(buildHourlyStats(input).bestActual.dateKey, "2026-09-26");
});

test("source rows stay unchanged and future work dates are outside the statistics", () => {
  const input = fixtures(4);
  const before = structuredClone(input);
  const result = buildHourlyStats({ ...input, asOfDate: "2026-09-28" });
  assert.equal(result.measuredDays, 3);
  assert.deepEqual(result.dailyReviews.map((row) => row.dateKey), ["2026-09-26", "2026-09-27", "2026-09-28"]);
  assert.deepEqual(input, before);
});
