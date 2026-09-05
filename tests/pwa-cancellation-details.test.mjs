import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunction(name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\(`, "m");
  const start = main.search(pattern);
  assert.notEqual(start, -1, `missing ${name}`);
  const paramsStart = main.indexOf("(", start);
  let depth = 1;
  let index = paramsStart + 1;
  for (; depth && index < main.length; index += 1) {
    if (main[index] === "(") depth += 1;
    if (main[index] === ")") depth -= 1;
  }
  const bodyStart = main.indexOf("{", index);
  depth = 1;
  for (index = bodyStart + 1; depth && index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") depth -= 1;
  }
  return main.slice(start, index);
}

const shared = [
  "workLedgerKey", "userDateKey", "parseCanonicalWorkPayload", "exactLedgerInteger",
  "normalizeBaseSalesRoute", "workRouteDetailsByDate", "rawDetailBreakdown",
  "formatDetailRouteCount", "isAutomaticRow", "automaticRows", "automaticBaseBreakdown",
  "selectedDateSalesBreakdown", "freshbagModeForRecord", "calcRecordDetails",
];

function load(names = [], extra = {}) {
  const context = vm.createContext({
    normalizeRoute: (value) => String(value || "").trim().toUpperCase(),
    splitStoredRoutes: (value) => String(value || "").split("|").filter(Boolean),
    toNum: (value) => Number(value) || 0,
    effectiveUnit: (row) => Number(row.unit) || 0,
    normalizeRecordShape: (record) => record,
    defaultFreshUnit: (value) => value ?? 100,
    defaultBackupUnit: (value) => value ?? 30,
    freshbagMode: () => "single",
    escapeAttr: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    fmtCount: (value) => `${value}건`,
    fmtWon: (value) => `${value}원`,
    ...extra,
  });
  const functions = [...new Set([...shared, ...names])];
  vm.runInContext(`${functions.map(extractFunction).join("\n")}\nglobalThis.actual = { ${functions.join(",")} };`, context);
  return context.actual;
}

const date = "2026-09-05";
function work(workId = "work-1", userId = "user-1", cancellationCounts = { "310D01": 1 }) {
  return {
    user_id: userId, work_id: workId, work_date: date, cancel_count: 1,
    canonical_payload: { cancellation_detail_counts: cancellationCounts },
  };
}
function detail(workId = "work-1", userId = "user-1", count = 10) {
  return { user_id: userId, work_id: workId, detail_route: "310D01", base_route: "310D", delivery_count: count };
}
function record(count = 10, source = "automatic") {
  return {
    off: false, rows: [{ route: "310D", count, unit: 900, source }],
    freshCount: 0, returnCount: 0, cancellationCount: 1, driverType: "fixed",
  };
}

test("receipt detail joins count each work and user once, including repeated fetched rows", () => {
  const api = load();
  const headers = [work(), work(), work("work-2"), work("work-1", "user-2")];
  headers[2].canonical_payload = JSON.stringify(headers[2].canonical_payload);
  const rows = [detail(), detail(), detail("work-2", "user-1", 5), detail("work-1", "user-2", 2), detail("orphan")];
  const mapped = api.workRouteDetailsByDate(headers, rows);
  assert.equal(mapped[date].length, 3);
  const model = api.rawDetailBreakdown(mapped[date]);
  assert.equal(model.byBase.get("310D").get("310D01"), 17);
  assert.equal(model.cancellationByRoute.get("310D01"), 3);
});

test("legacy overall cancellation totals never become a guessed route annotation", () => {
  const api = load();
  const legacy = { ...work(), canonical_payload: { routes: [], cancel_count: 1 } };
  const mapped = api.workRouteDetailsByDate([legacy], [detail()]);
  assert.equal(mapped[date][0].deliveryCount, 10);
  assert.equal(mapped[date][0].cancellationCount, 0);
  assert.equal(api.rawDetailBreakdown(mapped[date]).cancellationByRoute.size, 0);
});

test("invalid cancellation metadata is ignored without altering inclusive delivery counts", () => {
  const api = load();
  for (const invalid of [null, [], "bad", { "310D01": -1 }, { "310D01": 11 }, { "310D01": "1" }, { "310D01": 0.5 }, { "not-route": 1 }]) {
    const mapped = api.workRouteDetailsByDate([work("work-1", "user-1", invalid)], [detail()]);
    assert.equal(mapped[date][0].deliveryCount, 10);
    assert.equal(mapped[date][0].cancellationCount, 0);
  }
});

test("route label retains the inclusive count and hides only zero cancellation annotations", () => {
  const api = load();
  assert.equal(api.formatDetailRouteCount("310D01", 10, 1), "310D01 10건, 취소 1건");
  assert.equal(api.formatDetailRouteCount("310D01", 1, 1), "310D01 1건, 취소 1건");
  assert.equal(api.formatDetailRouteCount("310D01", 10, 0), "310D01 10건");
  assert.equal(api.formatDetailRouteCount("310D01", null, 1), "310D01 취소 1건");
  assert.equal(api.formatDetailRouteCount("<route>", 1, 1), "&lt;route> 1건, 취소 1건");
});

test("missing raw detail counts preserve cancellation metadata without fabricating zero deliveries", () => {
  const api = load();
  const mapped = api.workRouteDetailsByDate([work()], []);
  assert.equal(mapped[date].length, 1);
  assert.equal(mapped[date][0].deliveryCount, null);
  const model = api.selectedDateSalesBreakdown(record(8, "override"), mapped[date]);
  assert.equal(model.rows[0].count, 8);
  assert.equal(model.rows[0].revenue, 7200);
  assert.equal(model.rows[0].detailRows[0].count, null);
  assert.equal(model.rows[0].detailRows[0].cancellationCount, 1);
  assert.equal(model.rows[0].detailCount, null);
  assert.equal(model.rows[0].difference, null);
  assert.equal(api.formatDetailRouteCount("310D01", model.rows[0].detailRows[0].count, 1), "310D01 취소 1건");
});

test("incomplete work detail quantities stay unknown when another work has a known raw count", () => {
  const api = load();
  const mapped = api.workRouteDetailsByDate([work(), work("work-2")], [detail("work-2")]);
  const model = api.rawDetailBreakdown(mapped[date]);
  assert.equal(model.byBase.get("310D").get("310D01"), null);
  assert.equal(model.cancellationByRoute.get("310D01"), 2);
});

test("cancellation observation metadata is not capped to an independently adjusted detail quantity", () => {
  const api = load();
  const header = { ...work("work-1", "user-1", { "310D01": 2 }), cancel_count: 2 };
  const mapped = api.workRouteDetailsByDate([header], [detail("work-1", "user-1", 1)]);
  assert.equal(mapped[date][0].deliveryCount, 1);
  assert.equal(mapped[date][0].cancellationCount, 2);
});

test("selected date renders detail cancellation while the final count and revenue stay inclusive once", () => {
  const el = {
    selectedDateBreakdown: { classList: { toggle() {} } }, selectedDateBreakdownTitle: {},
    selectedDateBreakdownRows: {}, selectedDateBreakdownNote: {}, openSalesOverride: {},
  };
  const state = { selectedDate: date, workRouteDetails: {}, workRouteDetailsContractAvailable: true };
  const api = load(["renderSelectedDateBreakdown"], { el, state, hasAutomaticEntries: () => true, formatMonthDay: () => "9월 5일" });
  state.workRouteDetails = api.workRouteDetailsByDate([work()], [detail()]);
  api.renderSelectedDateBreakdown(record());
  assert.match(el.selectedDateBreakdownRows.innerHTML, /310D01 10건, 취소 1건/);
  assert.match(el.selectedDateBreakdownRows.innerHTML, /9000원/);
  const totals = api.calcRecordDetails(record());
  assert.equal(totals.count, 10);
  assert.equal(totals.routeRevenue, 9000);
  assert.equal(totals.revenue, 9000);
  assert.equal(totals.cancellationCount, 1);
  state.workRouteDetails = api.workRouteDetailsByDate([work()], []);
  api.renderSelectedDateBreakdown(record());
  assert.match(el.selectedDateBreakdownRows.innerHTML, /310D01 취소 1건/);
  assert.doesNotMatch(el.selectedDateBreakdownRows.innerHTML, /310D01 0건/);
});

test("sales overrides retain their effective totals without reallocating cancellation or raw details", () => {
  const api = load();
  const mapped = api.workRouteDetailsByDate([work()], [detail()]);
  const overridden = record(8, "override");
  const model = api.selectedDateSalesBreakdown(overridden, mapped[date]);
  assert.equal(model.rows[0].count, 8);
  assert.equal(model.rows[0].revenue, 7200);
  assert.equal(model.rows[0].detailRows[0].count, 10);
  assert.equal(model.rows[0].detailRows[0].cancellationCount, 1);
  assert.equal(model.rows[0].difference, -2);
  assert.equal(api.calcRecordDetails(overridden).count, 8);
  assert.equal(api.calcRecordDetails(overridden).revenue, 7200);
});

test("user route statistics show the same annotation and inclusive final quantity", () => {
  const el = { routeStats: {} };
  const state = { workRouteDetails: {} };
  const api = load(["renderRouteStats"], {
    el, state, getRecord: () => record(), isWorkedRecord: () => true,
    recordRouteAggregates: () => new Map([["310D", { count: 10, revenue: 9000 }]]),
    formatRouteLabel: (value) => value,
  });
  state.workRouteDetails = api.workRouteDetailsByDate([work()], [detail()]);
  api.renderRouteStats([date]);
  assert.match(el.routeStats.innerHTML, /310D01 10건, 취소 1건/);
  assert.match(el.routeStats.innerHTML, /<span>10건<\/span>/);
  assert.match(el.routeStats.innerHTML, /9000원/);
  state.workRouteDetails = api.workRouteDetailsByDate([work()], []);
  api.renderRouteStats([date]);
  assert.match(el.routeStats.innerHTML, /310D01 취소 1건/);
  assert.doesNotMatch(el.routeStats.innerHTML, /310D01 0건/);
});

test("admin statistics use receipt-scoped cancellation metadata without multiplying repeated joins", async () => {
  const el = { adminRouteList: {} };
  let rawDetails = [detail(), detail()];
  const itemsQuery = { gte() { return this; }, lte: async () => ({ data: [], error: null }) };
  const state = {
    profile: { role: "admin" }, adminYear: 2026, adminMonth: 9,
    db: { from: (table) => ({ select: () => table === "profiles" ? Promise.resolve({ data: [], error: null }) : itemsQuery }) },
  };
  const api = load(["renderAdminRouteStats"], {
    el, state, TABLES: { profiles: "profiles", items: "items" },
    periodBounds: () => ({ start: date, end: date }), toDateKey: (value) => value,
    loadWorkLedgerForRange: async () => ({ workResults: [work()], workRouteDetails: rawDetails, items: [] }),
    fetchAutomaticSalesOverrides: async () => ({ rows: [] }),
    effectiveAutomaticLedgerItems: () => [{ user_id: "user-1", route: "310D", delivery_count: 10, unit_snapshot: 900, source: "automatic" }],
    joinStoredRoutes: (value) => value, LEGACY_USER_NAMES: new Map(),
    profileNameForDisplay: () => "기사", formatRouteLabel: (value) => value,
  });
  await api.renderAdminRouteStats();
  assert.match(el.adminRouteList.innerHTML, /310D01 10건, 취소 1건/);
  assert.doesNotMatch(el.adminRouteList.innerHTML, /310D01 20건|취소 2건/);
  assert.match(el.adminRouteList.innerHTML, /배송 10건/);
  assert.match(el.adminRouteList.innerHTML, /9000원/);
  rawDetails = [];
  await api.renderAdminRouteStats();
  assert.match(el.adminRouteList.innerHTML, /310D01 취소 1건/);
  assert.doesNotMatch(el.adminRouteList.innerHTML, /310D01 0건/);
});
