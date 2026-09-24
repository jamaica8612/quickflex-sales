import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { koreanDateKey } from "../src/lib/work-date.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function load(name, next, context) {
  const source = main.slice(main.indexOf(`function ${name}(`), main.indexOf(`function ${next}(`));
  const sandbox = vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.actual = ${name};`, sandbox);
  return sandbox.actual;
}
function briefing(overrides = {}) {
  const entries = {
    "2026-09-23": { rows: [], revenue: 400, worked: true },
    "2026-09-24": { rows: [], automatic: true, revenue: 200, worked: true },
    "2026-09-25": { rows: [{ route: "302B" }], revenue: 0, worked: false },
  };
  const state = { entries, profile: { goal_amount: 1000 }, workDateDataLoaded: true,
    workDateScheduleDates: new Set(["2026-09-25"]), activeMeasurementLease: null, ...overrides };
  const context = {
    state, koreanDateKey, currentUserId: () => "owner", isNightShift: () => true,
    currentWorkDates: () => ({ nextWorkDate: "2026-09-25", previousWorkDate: "2026-09-24", reason: "completed" }),
    getRecord: (key) => state.entries[key] || { rows: [] }, hasAutomaticEntries: (record) => Boolean(record.automatic),
    splitStoredRoutes: (text) => text ? text.split("|") : [],
    parseDateKey: (key) => new Date(`${key}T12:00:00`), periodForDate: () => ({ year: 2026, month: 9 }),
    periodKeysFor: () => ["2026-09-23", "2026-09-24", "2026-09-25"],
    statsDailyRecords: () => Object.entries(state.entries).map(([dateKey, record]) => ({ dateKey, ...record })),
    noahTipSnapshots: new Map([["zone-a", { routes: ["302B"], tipCount: 4 }]]),
  };
  return load("currentNoahBriefing", "openNoahLink", context)(new Date("2026-09-24T09:00:00Z"));
}
test("app briefing uses next work date and current settlement snapshots with no service call", () => {
  const result = briefing();
  assert.equal(result.nextWorkDate, "2026-09-25");
  assert.equal(result.workDateCaption, "오늘 밤 9/25 마감");
  assert.equal(result.phase, "completed");
  assert.deepEqual([...result.routes], ["302B"]);
  assert.equal(result.routeTipCount, 4);
  assert.equal(result.goalRequiredPerDay, 400);
  assert.equal(result.closing, true);
});
test("unloaded data never invents routes, tips or target pace", () => {
  const result = briefing({ workDateDataLoaded: false });
  assert.deepEqual([...result.routes], []);
  assert.equal(result.routeTipCount, undefined);
  assert.equal(result.goalRequiredPerDay, undefined);
  assert.equal(result.phase, "default");
});
test("missing future schedules hide required revenue and active work must belong to current account", () => {
  const result = briefing({ workDateScheduleDates: new Set(), activeMeasurementLease: {
    user_id: "another-account", lease_expires_at: "2099-01-01T00:00:00Z", work_date: "2026-09-25",
  } });
  assert.equal(result.goalRequiredPerDay, undefined);
  assert.equal(result.phase, "completed");
});
test("links use existing date/route/range views and ignore unknown or malformed targets", () => {
  const opened = [];
  const state = { profile: { status: "approved" } };
  const open = load("openNoahLink", "bindNoah", {
    state, parseDateKey: (key) => new Date(`${key}T12:00:00`),
    periodForDate: () => ({ year: 2026, month: 9 }),
    selectDate: (date) => { state.selectedDate = date; }, showView: (...args) => opened.push(args),
    dateRangeDayCount: (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1, MAX_CUSTOM_RANGE_DAYS: 366,
  });
  open({ kind: "day", target: { date: "2026-09-24" } });
  assert.equal(state.selectedDate, "2026-09-24");
  assert.equal(opened[0][0], "record");
  open({ kind: "route", target: { zoneId: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(opened[1][0], "routes");
  assert.equal(opened[1][1].route, "11111111-1111-4111-8111-111111111111");
  open({ kind: "stats", target: { from: "2026-08-26", to: "2026-09-25" } });
  assert.equal(state.statsRangeMode, "custom");
  assert.equal(opened[2][0], "stats");
  for (const invalid of [{ kind: "day", target: { date: "2026-02-31" } }, { kind: "url", target: { url: "https://example.com" } },
    { kind: "route", target: { zoneId: "javascript:alert(1)" } }, { kind: "stats", target: { from: "2026-10-01", to: "2026-09-01" } }]) open(invalid);
  assert.equal(opened.length, 3);
});
