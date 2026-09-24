import test from "node:test";
import assert from "node:assert/strict";
import { readFinanceSummary } from "../supabase/functions/noah/finance.js";

const userId = "12345678-1234-4234-8234-123456789abc";
const otherId = "22345678-1234-4234-8234-123456789abc";
const from = "2026-09-21", to = "2026-09-23";
const base = () => ({ quickflex_profiles: [{ id: userId, driver_type: "backup", freshbag_mode: "single", goal_amount: 6_000_000 }],
  quickflex_day_records: [], quickflex_day_route_items: [], quickflex_sales_work_results: [], quickflex_sales_work_routes: [],
  quickflex_sales_overrides: [], quickflex_route_rates: [], quickflex_expenses: [], quickflex_expense_adjustments: [] });

function fakeClient(tables, options = {}) {
  const calls = [];
  return { calls, from(table) {
    assert.ok(Object.hasOwn(tables, table), table);
    const clauses = [], sorts = [], equals = [];
    const query = {
      select(columns, config) { calls.push({ table, columns, count: config?.count }); return this; },
      eq(key, value) { equals.push([key, value]); clauses.push((row) => row[key] === value); return this; },
      gte(key, value) { clauses.push((row) => row[key] >= value); return this; },
      lte(key, value) { clauses.push((row) => row[key] <= value); return this; },
      in(key, values) { clauses.push((row) => values.includes(row[key])); return this; },
      order(key, { ascending } = {}) { sorts.push([key, ascending]); return this; },
      async range(start, end) {
        assert.ok(equals.some(([key, value]) => key === (table === "quickflex_profiles" ? "id" : "user_id") && value === (options.expectedUserId || userId)), `${table} owner predicate`);
        let rows = tables[table].filter((row) => clauses.every((f) => f(row)));
        for (const [key, ascending] of [...sorts].reverse()) rows = rows.toSorted((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (ascending ? 1 : -1));
        const count = rows.length;
        rows = rows.slice(start, end + 1);
        if (options.shortPageTable === table && start >= 500) rows = [];
        return { data: rows, count, error: null };
      },
    };
    return query;
  } };
}

function work(id, date, routes) {
  return { user_id: userId, work_id: id, work_date: date, work_shift: "day", finalized_at: `${date}T10:00:00Z`,
    total_items: routes.reduce((sum, row) => sum + row.delivery_count, 0),
    canonical_payload: { work_date: date, work_shift: "day", total_items: routes.reduce((sum, row) => sum + row.delivery_count, 0), routes },
  };
}
const automatic = (id, route, count, unit, sort_order = 0) => ({ user_id: userId, work_id: id, route,
  delivery_count: count, unit_snapshot: unit, sort_order });

test("finance matches mixed manual and automatic backup, freshbag modes, override and off semantics", async () => {
  const tables = base();
  tables.quickflex_day_records.push(
    { id: 1, user_id: userId, work_date: from, driver_type: "backup", backup_unit: 30, freshbag_mode: "single", fresh_count: 2, fresh_unit: 100 },
    { id: 2, user_id: userId, work_date: "2026-09-22", driver_type: "backup", backup_unit: 40, freshbag_mode: "dual", fresh_solo_count: 1, fresh_linked_count: 2 },
    { id: 3, user_id: userId, work_date: to, is_off: true, fresh_count: 5 },
  );
  tables.quickflex_day_route_items.push(
    { id: 1, user_id: userId, work_date: from, route: "318A", delivery_count: 10, unit_snapshot: 50, sort_order: 0 },
    { id: 2, user_id: userId, work_date: "2026-09-22", route: "318B", delivery_count: 8, unit_snapshot: 50, sort_order: 0 },
    { id: 3, user_id: userId, work_date: to, route: "318C", delivery_count: 3, unit_snapshot: 50, sort_order: 0 },
  );
  const first = automatic("night-one", "318D", 5, 80);
  const team = automatic("team:2026-09-22", "318E", 7, 90);
  tables.quickflex_sales_work_results.push(work("night-one", from, [first]), work("team:2026-09-22", "2026-09-22", [team]));
  tables.quickflex_sales_work_routes.push(first, team);
  tables.quickflex_sales_overrides.push({ user_id: userId, work_date: "2026-09-22", revision: 1, total_items: 4,
    routes: [{ route: "318F", delivery_count: 4, unit_snapshot: 150, sort_order: 0 }] });
  const result = await readFinanceSummary({ client: fakeClient(tables), userId, from, to });
  assert.deepEqual(result.days.map((d) => [d.count, d.revenue, d.workDay, d.off]), [
    [15, 1400, true, false], // 10*50 + 5*80 + 2*100 + manual 10*30
    [4, 1000, true, false], // full-date override 4*150 + dual freshbag 200+2*100; included bonus not additive
    [0, 0, false, true],
  ]);
  assert.equal(result.totals.revenue, 2400);
  assert.equal(result.totals.backupRevenueIncluded, 310);
  assert.equal(result.totals.backupRevenueAdditive, 300);
  assert.equal(result.totals.averageRevenuePerWorkDay, 1200);
  assert.equal(result.goalAmount, 6_000_000);
});

test("finance uses current rate only for missing manual snapshot and totals refunds from outside the period", async () => {
  const tables = base();
  tables.quickflex_profiles[0].driver_type = "fixed";
  tables.quickflex_day_route_items.push({ id: 1, user_id: userId, work_date: from, route: "318A|318B", delivery_count: 2, unit_snapshot: 0, sort_order: 0 });
  tables.quickflex_route_rates.push({ id: 1, user_id: userId, route: "318A", current_unit: 100 }, { id: 2, user_id: userId, route: "318B", current_unit: 100 });
  tables.quickflex_expenses.push(
    { id: "a", user_id: userId, actual_date: from, gross_amount: 1000, category: "식비", status: "confirmed" },
    { id: "b", user_id: userId, actual_date: to, gross_amount: 300, category: "유류", status: "confirmed" },
    { id: "c", user_id: userId, actual_date: from, gross_amount: 9999, category: "식비", status: "draft" },
    { id: "d", user_id: userId, actual_date: from, gross_amount: 9999, category: "식비", status: "trashed" },
    { id: "e", user_id: otherId, actual_date: from, gross_amount: 9999, category: "식비", status: "confirmed" },
  );
  tables.quickflex_expense_adjustments.push(
    { id: "r", expense_id: "a", user_id: userId, actual_date: "2026-10-01", kind: "refund", amount: 300 },
    { id: "m", expense_id: "a", user_id: userId, actual_date: "2026-09-22", kind: "reimbursement", amount: 100 },
    { id: "m2", expense_id: "a", user_id: userId, actual_date: "2026-10-02", kind: "reimbursement", amount: 75 },
  );
  const client = fakeClient(tables);
  const result = await readFinanceSummary({ client, userId, from, to });
  assert.equal(result.totals.revenue, 200);
  assert.equal(result.totals.expenseGross, 1300);
  assert.equal(result.totals.refunds, 300);
  assert.equal(result.totals.expenses, 1000);
  assert.equal(result.totals.reimbursements, 100);
  assert.equal(result.totals.net, -800);
  assert.deepEqual(result.expensesByCategory.map((r) => [r.category, r.net]), [["식비", 700], ["유류", 300]]);
  assert.ok(client.calls.every((call) => call.count === "exact" && !call.columns.includes("signature") && !call.columns.includes("email")));
});

test("finance rejects impossible ranges, incomplete automatic ledger, short pages and excess rows", async () => {
  const tables = base();
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables), userId, from: "2026-02-30", to }), RangeError);
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables), userId, from: "2025-01-01", to }), RangeError);
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables, { expectedUserId: otherId }), userId: otherId, from, to }), /profile unavailable/);
  const item = automatic("x", "318A", 3, 100);
  tables.quickflex_sales_work_results.push(work("x", from, [item]));
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables), userId, from, to }), /incomplete|mismatch/);
  tables.quickflex_sales_work_routes.push({ ...item, delivery_count: 2 });
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables), userId, from, to }), /mismatch/);
  tables.quickflex_sales_work_routes[0].delivery_count = 3;
  assert.equal((await readFinanceSummary({ client: fakeClient(tables), userId, from, to })).totals.revenue, 300);
  tables.quickflex_day_route_items = Array.from({ length: 501 }, (_, id) => ({ id, user_id: userId, work_date: from, route: "318A", delivery_count: 1, unit_snapshot: 1, sort_order: id }));
  assert.equal((await readFinanceSummary({ client: fakeClient(tables), userId, from, to })).totals.revenue, 15_831);
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables, { shortPageTable: "quickflex_day_route_items" }), userId, from, to }), /incomplete/);
  tables.quickflex_day_route_items = Array.from({ length: 10_001 }, (_, id) => ({ id, user_id: userId, work_date: from, route: "318A", delivery_count: 1, unit_snapshot: 1, sort_order: id }));
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables), userId, from, to }), /limit/);
});

test("finance rejects duplicate route names in canonical work payload", async () => {
  const tables = base();
  const a = automatic("work", "318A", 2, 100, 0);
  const b = automatic("work", "318B", 3, 100, 1);
  const header = work("work", from, [a, b]);
  header.canonical_payload.routes = [a, { ...a, delivery_count: 3, sort_order: 1 }];
  tables.quickflex_sales_work_results.push(header);
  tables.quickflex_sales_work_routes.push(a, b);
  await assert.rejects(readFinanceSummary({ client: fakeClient(tables), userId, from, to }), /duplicated/);
});
