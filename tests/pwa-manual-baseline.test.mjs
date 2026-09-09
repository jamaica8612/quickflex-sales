import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Real projection functions, synthetic manual-night and automatic-day inputs.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const end = Math.min(...[next, nextAsync, source.length].filter((value) => value > start));
  return source.slice(start, end);
}
function harness() {
  const state = { receiptEntries: {}, entries: {}, automaticSalesOverrides: {} };
  const context = vm.createContext({
    state,
    getRecord: (date) => state.entries[date],
    DEFAULT_BACKUP_UNIT: 30,
    isBackupDriver: () => true,
    defaultFreshUnit: (value) => value == null || value === "" ? 100 : value,
    defaultBackupUnit: (value) => value == null || value === "" ? 30 : value,
    freshbagModeForRecord: (record) => record?.freshbagMode || "single",
    sharedRateForRoutes: () => 0,
    rateFor: () => 0,
    toNum: (value) => Number(value) || 0,
    exactLedgerInteger: (value) => Number.isInteger(Number(value)) ? Number(value) : null,
    splitStoredRoutes: (value) => String(value || "").split("|").filter(Boolean),
    expandRouteText: (value) => String(value || "").split("|").filter(Boolean),
    joinStoredRoutes: (value) => Array.isArray(value) ? value.join("|") : String(value || ""),
    salesDayEditableValues: (row) => ({ fresh_count: row.fresh_count || 0 }),
    workLedgerKey: (owner, work) => `${owner}|${work}`,
    normalizeRoute: (value) => String(value || "").trim().toUpperCase(),
  });
  const names = ["isAutomaticRow", "automaticRows", "manualRows", "hasAutomaticEntries",
    "mergeGroupedRows", "normalizeRecordShape", "entriesFromDb", "effectiveUnit", "calcRecordDetails",
    "normalizeBaseSalesRoute", "seedSalesOverrideRows", "overrideRecordRows", "applyAutomaticSalesOverrideToRecord",
    "manualLedgerItemsForSales", "userDateKey", "automaticBaseBreakdown", "recordRouteAggregates", "salesOverridePayload",
    "startRecordDraft", "cloneRecord", "hasAutomaticSalesOverride"];
  vm.runInContext(names.map(declaration).join("\n") + `\nglobalThis.actual = {${names.join(",")}};`, context);
  return { ...context.actual, state };
}
const date = "2026-09-09";
const day = { work_date: date, is_off: false, fresh_count: 12, fresh_unit: 100, driver_type: "backup" };
const manualNight = { work_date: date, route: "310D", delivery_count: 120, household_count: 90, unit_snapshot: 1050 };
const header = (work, shift, count) => ({ user_id: "fixture-user", work_id: work, work_date: date,
  work_shift: shift, total_items: count, total_households: count, finalized_at: "2026-09-09T12:00:00Z" });
const route = (work, count) => ({ user_id: "fixture-user", work_id: work, route: "232C",
  delivery_count: count, household_count: count, unit_snapshot: 800, sort_order: 0 });

test("daytime automatic receipt adds to manual night sales without changing saved counts or dated rates", () => {
  const { entriesFromDb: readEntries, calcRecordDetails, automaticBaseBreakdown, recordRouteAggregates } = harness();
  const manualRows = [{ ...manualNight }];
  const before = readEntries([day], manualRows)[date];
  assert.equal(before.rows.reduce((sum, row) => sum + Number(row.count), 0), 120);
  const after = readEntries([day], manualRows, [header("day-work", "day", 40)], [route("day-work", 40)])[date];
  assert.equal(after.rows.reduce((sum, row) => sum + Number(row.count), 0), 160);
  assert.equal(after.rows.find((row) => row.route === "310D").unit, 1050);
  assert.equal(after.rows.find((row) => row.route === "232C").unit, 800);
  assert.deepEqual(manualRows, [manualNight], "the DB-input fixture itself is not deleted or zeroed");
  const total = calcRecordDetails(after);
  assert.equal(total.count, 160);
  assert.equal(total.backupRevenueAdditive, 120 * 30);
  assert.equal(total.backupRevenueIncluded, 40 * 30);
  assert.equal(total.revenue, 120 * (1050 + 30) + 40 * 800 + 12 * 100);
  assert.equal(automaticBaseBreakdown(after).get("310D").revenue, 120 * 1080);
  assert.equal(recordRouteAggregates(after).get("310D").count, 120);
  assert.equal(after.freshCount, 12);
});

test("two automatic work receipts on the same date remain additive", () => {
  const entry = harness().entriesFromDb([day], [], [header("night-work", "night", 120), header("day-work", "day", 40)],
    [route("night-work", 120), route("day-work", 40)])[date];
  assert.equal(entry.rows.reduce((sum, row) => sum + Number(row.count), 0), 160);
  assert.equal(entry.automaticWorks.length, 2);
});

test("editing a mixed date includes manual baseline and backup once while its basis remains automatic only", () => {
  const api = harness();
  const record = api.entriesFromDb([day], [manualNight], [header("day-work", "day", 40)], [route("day-work", 40)])[date];
  api.state.receiptEntries[date] = record;
  api.state.entries[date] = record;
  const seed = api.seedSalesOverrideRows(date, null);
  assert.equal(seed.rows.reduce((sum, row) => sum + row.count, 0), 160);
  assert.equal(seed.rows.find((row) => row.route === "310D").unit, 1080);
  assert.equal(seed.rows.find((row) => row.route === "232C").unit, 800);
  assert.equal(api.salesOverridePayload(seed.rows).issues.length, 0);
  assert.equal(JSON.stringify(record.salesBasisCounts), JSON.stringify({ "232C": 40 }));
  const snapshot = {work_date: date, revision: 1, routes: seed.rows.map((row, index) => ({
    route: row.route, delivery_count: row.count, unit_snapshot: row.unit, sort_order: index,
  }))};
  const effective = api.applyAutomaticSalesOverrideToRecord(record, snapshot);
  assert.equal(api.calcRecordDetails(effective).revenue, api.calcRecordDetails(record).revenue);
  assert.equal(api.calcRecordDetails(effective).count, 160, "full snapshot must not add manual120 again");
  assert.equal(effective.rows.every((row) => row.source === "override"), true);
  assert.equal(record.rows.some((row) => !row.source), true, "raw manual baseline remains unchanged");
  const draft = api.startRecordDraft(date);
  assert.equal(api.salesOverridePayload(draft.rows).routes.reduce((sum,row) => sum + row.delivery_count, 0), 160,
    "the normal record editor must seed the same full-date total as the override dialog");
  assert.equal(api.calcRecordDetails(draft).revenue, api.calcRecordDetails(record).revenue);
  assert.equal(JSON.stringify(draft.salesBasisCounts), JSON.stringify({ "232C": 40 }));
});

test("an existing full day override replaces manual and automatic amounts without readding manual baseline", () => {
  const api = harness();
  const original = api.entriesFromDb([day], [manualNight], [header("day-work", "day", 40)], [route("day-work", 40)])[date];
  const snapshot = {work_date: date, revision: 3, routes: [{route:"232C", delivery_count:165, unit_snapshot:1000, sort_order:0}]};
  const effective = api.applyAutomaticSalesOverrideToRecord(original, snapshot);
  assert.equal(api.calcRecordDetails(effective).count, 165);
  assert.equal(api.seedSalesOverrideRows(date, snapshot).rows.reduce((sum,row) => sum + row.count, 0), 165);
});

test("admin sales retain manual baseline unless a full date override replaces that owner date", () => {
  const api = harness();
  const items = [{...manualNight, user_id:"fixture-user"}, {...manualNight, user_id:"other-user"}];
  assert.equal(api.manualLedgerItemsForSales(items, []).length, 2);
  const kept = api.manualLedgerItemsForSales(items, [{user_id:"fixture-user", work_date:date}]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].user_id, "other-user");
  assert.equal(items.length, 2);
});

test("grouped manual counts are preserved for display and editing instead of guessing per route quantities", () => {
  const api = harness();
  const manual = {...manualNight, route:"310C|310D", delivery_count:121};
  const record = api.entriesFromDb([day], [manual], [header("day-work", "day", 40)], [route("day-work", 40)])[date];
  api.state.receiptEntries[date] = record;
  const seed = api.seedSalesOverrideRows(date, null);
  assert.equal(api.calcRecordDetails(record).count, 161);
  assert.equal(seed.rows.find((row) => row.route === "310C|310D").count, 121);
  assert.match(seed.warning, /A\/B 구역별 건수/);
  assert.ok(api.salesOverridePayload(seed.rows).issues.length > 0, "saving requires user to supply split, not a guessed allocation");
});
