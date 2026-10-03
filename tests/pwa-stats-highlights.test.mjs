import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPersonalRecords,
  decomposeRevenueChange,
  defaultRemainingDaysOff,
  projectRemainingDays,
  recentOffRatio,
  settlementPeriodForDate,
} from "../src/lib/stats-highlights.js";
import { buildStatsInsights } from "../src/lib/stats-insights.js";
import { addDays, buildStatsReport } from "../src/lib/stats-report.js";

function day(dateKey, revenue, extra = {}) {
  return { dateKey, revenue, worked: true, off: false, ...extra };
}

function pricedDay(dateKey, count, unit, fresh = 0, backup = 0) {
  return {
    dateKey,
    worked: true,
    volumeKnown: true,
    count,
    deliveryRevenue: count * unit,
    freshRevenue: fresh,
    backupRevenue: backup,
    freshCount: fresh / 150,
    revenue: count * unit + fresh + backup,
  };
}

test("settlement periods run from the 26th through the 25th", () => {
  assert.equal(settlementPeriodForDate("2026-10-03").id, "2026-10");
  assert.equal(settlementPeriodForDate("2026-09-26").id, "2026-10");
  assert.equal(settlementPeriodForDate("2026-09-25").id, "2026-09");
  assert.equal(settlementPeriodForDate("2026-12-27").id, "2027-01");
});

test("volume, unit price and extra pay add up to the revenue gap", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let round = 0; round < 50; round += 1) {
    const days = Math.floor(random() * 20) + 1;
    const make = (offset) => Array.from({ length: days }, (_, index) => pricedDay(
      `2026-0${offset}-${String(index + 1).padStart(2, "0")}`,
      Math.round(150 + random() * 200),
      Math.round(850 + random() * 300),
      Math.round(random() * 20) * 150,
      Math.round(random() * 3) * 3000,
    ));
    const current = make(8), previous = make(7);
    const split = decomposeRevenueChange(current, previous);
    const gap = current.reduce((sum, item) => sum + item.revenue, 0) - previous.reduce((sum, item) => sum + item.revenue, 0);
    assert.ok(Math.abs(split.volume + split.unit + split.extra - gap) < 1e-6, `round ${round}`);
    assert.ok(Math.abs(split.other) < 1e-6);
    assert.equal(split.revenueDelta, gap);
  }
});

test("revenue outside delivery and extras is reported separately", () => {
  const current = [{ ...pricedDay("2026-09-26", 100, 1000), revenue: 105000 }];
  const previous = [pricedDay("2026-08-26", 100, 1000)];
  const split = decomposeRevenueChange(current, previous);
  assert.equal(split.volume, 0);
  assert.equal(split.unit, 0);
  assert.equal(split.other, 5000);
});

test("the split is withheld without matching parcel counts", () => {
  const known = pricedDay("2026-09-26", 100, 1000);
  assert.equal(decomposeRevenueChange([known], [{ ...known, volumeKnown: false }]), null);
  assert.equal(decomposeRevenueChange([known, known], [known]), null);
  assert.equal(decomposeRevenueChange([], []), null);
  assert.equal(decomposeRevenueChange([{ ...known, count: 0 }], [known]), null);
});

test("the day-off planner works on remaining calendar days", () => {
  const base = { revenue: 1000, averageRevenue: 100, remainingDays: 10 };
  assert.deepEqual(projectRemainingDays({ ...base, offDays: 2 }), { remainingDays: 10, offDays: 2, workDays: 8, projectedRevenue: 1800 });
  assert.equal(projectRemainingDays({ ...base, offDays: -3 }).offDays, 0);
  assert.equal(projectRemainingDays({ ...base, offDays: 99 }).workDays, 0);
  assert.equal(defaultRemainingDaysOff({ remainingDays: 22, registeredOffDays: 1, unknownDays: 14, offRatio: 1 / 7 }), 3);
  assert.equal(defaultRemainingDaysOff({ remainingDays: 2, registeredOffDays: 3, unknownDays: 0, offRatio: 0.2 }), 2);
});

test("the default day-off share comes from recent recorded days", () => {
  const days = [];
  let key = "2026-09-01";
  for (let index = 0; index < 28; index += 1) {
    days.push(index % 4 === 0 ? { dateKey: key, off: true } : { dateKey: key, worked: true, revenue: 1 });
    key = addDays(key, 1);
  }
  assert.equal(recentOffRatio(days, "2026-09-29"), 7 / 28);
  assert.equal(recentOffRatio(days.slice(0, 5), "2026-09-29"), 1 / 7, "too few recorded days fall back to one a week");
  assert.equal(recentOffRatio(days, "2026-12-31"), 1 / 7, "old records are outside the window");
});

function history(start, count, revenueFor, skip = () => false) {
  const days = [];
  let key = start;
  for (let index = 0; index < count; index += 1) {
    days.push(skip(key) ? { dateKey: key, worked: false, off: true } : day(key, revenueFor(key, index), { volumeKnown: true, count: 100 + index }));
    key = addDays(key, 1);
  }
  return days;
}

test("a record is new only when it beats one set before the running settlement", () => {
  const sundays = (key) => new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
  const days = history("2026-08-01", 64, (key) => (key === "2026-09-29" ? 500 : 200), sundays);
  const records = buildPersonalRecords(days, { asOfDate: "2026-10-03" });
  assert.equal(records.revenue.value, 500);
  assert.equal(records.revenue.dateKey, "2026-09-29");
  assert.equal(records.revenue.isNew, true);
  assert.equal(records.streak.value, 6, "a Sunday off breaks the run");
  assert.equal(records.streak.isNew, false, "a tie does not move the record");
  assert.equal(records.count.dateKey, "2026-10-03");
  assert.equal(records.count.isNew, true);
});

test("new users and first settlements get records without celebrations", () => {
  const few = history("2026-09-26", 6, () => 300);
  const short = buildPersonalRecords(few, { asOfDate: "2026-10-01" });
  assert.equal(short.revenue.isNew, false);
  assert.equal(short.settlement.isNew, false);
  assert.equal(short.streak.value, 6);

  const firstSettlement = history("2026-09-26", 12, (key, index) => 100 + index);
  const first = buildPersonalRecords(firstSettlement, { asOfDate: "2026-10-07" });
  assert.equal(first.revenue.isNew, false, "nothing existed before this settlement to beat");
});

test("a missing day breaks the streak and the best settlement can be the running one", () => {
  const days = [
    ...history("2026-08-26", 31, () => 100),
    ...history("2026-09-26", 8, () => 1000, (key) => key === "2026-09-30"),
  ].filter((item) => item.worked !== false || item.dateKey !== "2026-09-30");
  const records = buildPersonalRecords(days, { asOfDate: "2026-10-03" });
  assert.equal(records.settlement.period.id, "2026-10");
  assert.equal(records.settlement.value, 7000);
  assert.equal(records.settlement.isNew, true);
  assert.equal(records.streak.value, 35, "the gap on 9/30 ends the run that began 8/26");
  assert.equal(records.streak.end, "2026-09-29");
  assert.equal(records.streak.isNew, false, "no earlier run existed to beat");
});

test("parcel records ignore days without a matching count", () => {
  const days = [
    day("2026-09-01", 100, { volumeKnown: false, count: 999 }),
    day("2026-09-02", 100, { volumeKnown: true, count: 200 }),
  ];
  const records = buildPersonalRecords(days, { asOfDate: "2026-09-02" });
  assert.equal(records.count.value, 200);
  assert.equal(buildPersonalRecords([], { asOfDate: "2026-09-02" }), null);
});

test("insights count future days off and split a same-workday change", () => {
  const previous = [pricedDay("2026-08-26", 200, 1000), pricedDay("2026-08-27", 200, 1000), pricedDay("2026-08-28", 200, 1000)];
  const current = [pricedDay("2026-09-26", 220, 1000), pricedDay("2026-09-27", 220, 1000), pricedDay("2026-09-28", 220, 1000, 1500)];
  const future = [
    { dateKey: "2026-09-29", planned: true, worked: false },
    { dateKey: "2026-09-30", off: true, worked: false },
    { dateKey: "2026-10-01", off: true, worked: false },
    ...Array.from({ length: 24 }, (_, index) => ({ dateKey: addDays("2026-10-02", index), planned: true, worked: false })),
  ];
  const days = [...previous, ...current, ...future];
  const report = buildStatsReport({ dailyRecords: days, currentPeriod: { year: 2026, month: 10 }, mode: "thisSettlement", asOfDate: "2026-09-28", goal: 1000 });
  const insights = buildStatsInsights({ days, report, asOfDate: "2026-09-28" });
  assert.equal(insights.outlook.offDaysAhead, 2);
  assert.equal(insights.outlook.remainingDays, 27);
  assert.equal(insights.outlook.openDays, 0);
  assert.equal(insights.outlook.plannedDays, 25);
  assert.equal(insights.drivers.decomposition.volume, 60000);
  assert.equal(insights.drivers.decomposition.unit, 0);
  assert.equal(insights.drivers.decomposition.extra, 1500);
});

test("stats motion waits for its card and keeps only the newest pending run", async () => {
  const { createVisibilityQueue } = await import("../src/lib/motion.js");
  let observerCallback = null;
  const observed = [];
  class FakeObserver {
    constructor(callback) { observerCallback = callback; }
    observe(target) { observed.push(target); }
  }
  const win = { IntersectionObserver: FakeObserver, requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false }) };
  const doc = { hidden: false };
  const entered = [];
  const queue = createVisibilityQueue({ win, doc, onEnter: (card) => entered.push(card) });
  const card = { id: "plan" };
  const runs = [];
  queue.whenVisible(card, "bar", () => runs.push("old"));
  queue.whenVisible(card, "bar", () => runs.push("new"));
  queue.whenVisible(card, "roll", () => runs.push("roll"));
  assert.deepEqual(runs, [], "nothing runs while the card is off screen");
  assert.deepEqual(observed, [card]);
  observerCallback([{ target: card, isIntersecting: true }]);
  assert.deepEqual(runs, ["new", "roll"]);
  assert.deepEqual(entered, [card]);
  queue.whenVisible(card, "bar", () => runs.push("visible"));
  assert.equal(runs.at(-1), "visible", "a visible card runs at once");
  observerCallback([{ target: card, isIntersecting: false }]);
  queue.whenVisible(card, "bar", () => runs.push("later"));
  assert.equal(runs.at(-1), "visible");

  const reduced = createVisibilityQueue({ win: { ...win, matchMedia: () => ({ matches: true }) }, doc });
  let ran = false;
  reduced.whenVisible({}, "bar", () => { ran = true; });
  assert.equal(ran, true, "reduced motion shows the final state immediately");

  const unsupported = createVisibilityQueue({ win: { requestAnimationFrame: () => 0 }, doc });
  ran = false;
  unsupported.whenVisible({}, "bar", () => { ran = true; });
  assert.equal(unsupported.supported, false);
  assert.equal(ran, true);
});

test("open schedule days and an unrecorded today still count as remaining days", () => {
  const worked = ["2026-09-26", "2026-09-27", "2026-09-28"].map((dateKey) => ({ dateKey, worked: true, revenue: 100 }));
  const days = [...worked, { dateKey: "2026-09-30", off: true }, { dateKey: "2026-10-01", planned: true }];
  const report = buildStatsReport({ dailyRecords: days, currentPeriod: { year: 2026, month: 10 }, mode: "thisSettlement", asOfDate: "2026-09-29", goal: 1000 });
  const { outlook } = buildStatsInsights({ days, report, asOfDate: "2026-09-29" });
  assert.equal(outlook.pendingToday, true);
  assert.equal(outlook.remainingDays, 27, "9/29 through 10/25");
  assert.equal(outlook.offDaysAhead, 1);
  assert.equal(outlook.plannedDays, 1);
  assert.equal(outlook.openDays, 25, "today plus 24 future days without a schedule");
  assert.equal(outlook.projectedRevenue, null, "the strict schedule projection stays unavailable");
});
