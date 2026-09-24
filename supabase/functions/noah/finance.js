// Deterministic settlement read model. The caller must supply the verified user's public JWT client.
const PAGE = 500;
const MAX_ROWS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dayNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Invalid finance date");
  const millis = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== value) throw new RangeError("Invalid finance date");
  return Math.floor(millis / 86_400_000);
}

function nonnegative(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label} in finance ledger`);
  return number;
}

function safeAdd(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Finance total exceeds safe integer range");
  return result;
}

async function paged(client, table, columns, owner, userId, orders, filter = (q) => q) {
  const rows = [];
  let count = null;
  while (true) {
    let query = client.from(table).select(columns, { count: "exact" }).eq(owner, userId);
    query = filter(query);
    for (const [column, ascending] of orders) query = query.order(column, { ascending });
    const result = await query.range(rows.length, rows.length + PAGE - 1);
    if (result?.error) throw result.error;
    if (!Number.isSafeInteger(result?.count) || result.count < 0) throw new Error(`${table} count unavailable`);
    if (count === null) count = result.count;
    if (result.count !== count || count > MAX_ROWS) throw new Error(`${table} changed or exceeds finance read limit`);
    const batch = result.data;
    if (!Array.isArray(batch) || batch.length > PAGE || rows.length + batch.length > MAX_ROWS) throw new Error(`${table} page invalid`);
    rows.push(...batch);
    if (rows.length === count) return rows;
    if (!batch.length) throw new Error(`${table} page incomplete`);
  }
}

const inDates = (from, to, field = "work_date") => (q) => q.gte(field, from).lte(field, to);
const int = (value, fallback, label) => nonnegative(value == null || value === "" ? fallback : value, label);
const routesIn = (value) => [...new Set(String(value || "").toUpperCase().split(/[,\s/|]+/).filter(Boolean).flatMap((part) => {
  const match = part.match(/^(\d+)([A-Z]{2,})$/);
  return match ? [...match[2]].map((letter) => match[1] + letter) : [part];
}))];

function manualUnit(item, rates) {
  const stored = int(item.unit_snapshot, 0, "manual unit");
  if (stored > 0) return stored;
  const routes = routesIn(item.route);
  const units = routes.map((route) => rates.get(route) || 0).filter((unit) => unit > 0);
  return units.length && units.length === routes.length && units.every((unit) => unit === units[0]) ? units[0] : rates.get(String(item.route || "").toUpperCase()) || 0;
}

function verifyWorkLedger(headers, routes) {
  const byId = new Map();
  for (const work of headers) {
    if (!work.work_id || byId.has(work.work_id)) throw new Error("Automatic finance ledger has duplicate or missing work header");
    byId.set(work.work_id, { work, routes: [] });
  }
  for (const row of routes) {
    const entry = byId.get(row.work_id);
    if (!entry) throw new Error("Automatic finance ledger has route without header");
    entry.routes.push(row);
  }
  for (const { work, routes: actual } of byId.values()) {
    const payload = typeof work.canonical_payload === "string" ? JSON.parse(work.canonical_payload) : work.canonical_payload;
    const expected = payload?.routes;
    if (!Array.isArray(expected) || !actual.length || actual.length !== expected.length
      || payload.work_date !== work.work_date || payload.work_shift !== work.work_shift
      || int(payload.total_items, -1, "canonical total") !== int(work.total_items, -1, "work total")) {
      throw new Error("Automatic finance ledger header or route list incomplete");
    }
    const byRoute = new Map();
    let total = 0;
    for (const route of actual) {
      if (!route.route || byRoute.has(route.route)) throw new Error("Automatic finance ledger route duplicated");
      byRoute.set(route.route, route);
      total = safeAdd(total, int(route.delivery_count, 0, "automatic count"));
      int(route.unit_snapshot, 0, "automatic unit");
      int(route.sort_order, 0, "automatic order");
    }
    if (total !== int(work.total_items, 0, "work total")) throw new Error("Automatic finance ledger item count mismatch");
    const expectedNames = new Set();
    for (const route of expected) {
      if (!route?.route || expectedNames.has(route.route)) throw new Error("Automatic finance ledger canonical route duplicated");
      expectedNames.add(route.route);
      const got = byRoute.get(route.route);
      if (!got || ["delivery_count", "unit_snapshot", "sort_order"].some((field) => int(route[field], -1, field) !== int(got[field], -1, field))) {
        throw new Error("Automatic finance ledger canonical route mismatch");
      }
    }
  }
  return byId;
}

function parseOverride(snapshot) {
  const routes = typeof snapshot.routes === "string" ? JSON.parse(snapshot.routes) : snapshot.routes;
  if (!Array.isArray(routes) || !routes.length || routes.length > 100) throw new Error("Invalid finance override");
  const seen = new Set();
  let total = 0;
  for (const row of routes) {
    if (!/^\d{3}[A-Z]$/.test(String(row?.route || "")) || seen.has(row.route)) throw new Error("Invalid finance override route");
    seen.add(row.route);
    total = safeAdd(total, int(row.delivery_count, 0, "override count"));
    int(row.unit_snapshot, 0, "override unit");
    int(row.sort_order, 0, "override order");
  }
  if (total !== int(snapshot.total_items, 0, "override total")) throw new Error("Finance override total mismatch");
  return routes;
}

function numberOfDays(from, to) { return dayNumber(to) - dayNumber(from) + 1; }

export async function readFinanceSummary({ client, userId, from, to }) {
  if (!client?.from || !UUID.test(String(userId))) throw new TypeError("Verified public Supabase client and user required");
  const length = numberOfDays(from, to);
  if (length < 1 || length > 366) throw new RangeError("Finance range must be 1 to 366 days");

  const [profiles, dayRows, itemRows, headers, overrides, rateRows, expenses, periodReimbursements] = await Promise.all([
    paged(client, "quickflex_profiles", "id,driver_type,freshbag_mode,goal_amount", "id", userId, [["id", true]]),
    paged(client, "quickflex_day_records", "id,work_date,is_off,fresh_count,return_count,cancel_count,fresh_unit,backup_unit,driver_type,fresh_solo_count,fresh_linked_count,freshbag_mode", "user_id", userId, [["work_date", true], ["id", true]], inDates(from, to)),
    paged(client, "quickflex_day_route_items", "id,work_date,route,delivery_count,unit_snapshot,sort_order", "user_id", userId, [["work_date", true], ["sort_order", true], ["id", true]], inDates(from, to)),
    paged(client, "quickflex_sales_work_results", "user_id,work_id,work_date,work_shift,total_items,canonical_payload,finalized_at", "user_id", userId, [["finalized_at", true], ["work_id", true]], inDates(from, to)),
    paged(client, "quickflex_sales_overrides", "user_id,work_date,routes,total_items,revision", "user_id", userId, [["work_date", true]], inDates(from, to)),
    paged(client, "quickflex_route_rates", "id,route,current_unit", "user_id", userId, [["route", true], ["id", true]]),
    paged(client, "quickflex_expenses", "id,actual_date,gross_amount,category,status", "user_id", userId, [["actual_date", true], ["id", true]], (q) => inDates(from, to, "actual_date")(q).eq("status", "confirmed")),
    paged(client, "quickflex_expense_adjustments", "id,kind,amount,actual_date", "user_id", userId,
      [["actual_date", true], ["id", true]], (q) => inDates(from, to, "actual_date")(q).eq("kind", "reimbursement")),
  ]);
  if (profiles.length !== 1) throw new Error("Finance profile unavailable");
  const profile = profiles[0];
  const rates = new Map(rateRows.map((row) => [String(row.route || "").toUpperCase(), int(row.current_unit, 0, "route rate")]));
  const workIds = [...new Set(headers.map((row) => row.work_id))];
  const routes = [];
  for (let i = 0; i < workIds.length; i += 40) {
    const batch = await paged(client, "quickflex_sales_work_routes", "user_id,work_id,route,delivery_count,unit_snapshot,sort_order", "user_id", userId, [["work_id", true], ["sort_order", true], ["route", true]], (q) => q.in("work_id", workIds.slice(i, i + 40)));
    routes.push(...batch);
    if (routes.length > MAX_ROWS) throw new Error("Finance work routes exceed read limit");
  }
  const works = verifyWorkLedger(headers, routes);
  const byDate = new Map();
  const ensure = (date) => {
    if (!byDate.has(date)) byDate.set(date, { day: null, manual: [], automatic: [], workCount: 0, override: null });
    return byDate.get(date);
  };
  for (const day of dayRows) {
    const entry = ensure(day.work_date);
    if (entry.day) throw new Error("Duplicate finance day header");
    entry.day = day;
  }
  for (const row of itemRows) ensure(row.work_date).manual.push(row);
  for (const { work, routes: rows } of works.values()) {
    const entry = ensure(work.work_date);
    entry.workCount++;
    entry.automatic.push(...rows);
  }
  for (const row of overrides) {
    const entry = ensure(row.work_date);
    if (entry.override) throw new Error("Duplicate finance override");
    entry.override = parseOverride(row);
  }

  const days = [];
  const totals = { revenue: 0, count: 0, routeRevenue: 0, freshRevenue: 0, backupRevenue: 0,
    backupRevenueIncluded: 0, backupRevenueAdditive: 0, workDays: 0, offDays: 0,
    averageRevenuePerWorkDay: 0, expenseGross: 0, refunds: 0, expenses: 0, reimbursements: 0, net: 0 };
  for (let dayIndex = dayNumber(from); dayIndex <= dayNumber(to); dayIndex++) {
    const date = new Date(dayIndex * 86_400_000).toISOString().slice(0, 10);
    const entry = byDate.get(date) || { day: null, manual: [], automatic: [], workCount: 0, override: null };
    const day = entry.day || {};
    const off = Boolean(day.is_off) && entry.workCount === 0;
    const driverType = day.driver_type || profile.driver_type || "backup";
    const backupUnit = driverType === "backup" ? int(day.backup_unit, 30, "backup unit") : 0;
    const rows = entry.override && entry.workCount ? entry.override.map((row) => ({ ...row, automatic: true }))
      : [...entry.manual.map((row) => ({ ...row, automatic: false })), ...entry.automatic.map((row) => ({ ...row, automatic: true }))];
    let count = 0, routeRevenue = 0, automaticCount = 0, manualCount = 0;
    if (!off) for (const row of rows) {
      const quantity = int(row.delivery_count, 0, "delivery count");
      const unit = row.automatic ? int(row.unit_snapshot, 0, "automatic unit") : manualUnit(row, rates);
      count = safeAdd(count, quantity);
      routeRevenue = safeAdd(routeRevenue, quantity * unit);
      if (row.automatic) automaticCount = safeAdd(automaticCount, quantity);
      else manualCount = safeAdd(manualCount, quantity);
    }
    const mode = day.freshbag_mode === "dual" || day.freshbag_mode === "single" ? day.freshbag_mode : profile.freshbag_mode || "single";
    const freshRevenue = off ? 0 : mode === "dual"
      ? safeAdd(int(day.fresh_solo_count, 0, "fresh solo count") * 200, int(day.fresh_linked_count, 0, "fresh linked count") * 100)
      : int(day.fresh_count, 0, "fresh count") * int(day.fresh_unit, 100, "fresh unit");
    const backupRevenueIncluded = off ? 0 : automaticCount * backupUnit;
    const backupRevenueAdditive = off ? 0 : manualCount * backupUnit;
    const backupRevenue = safeAdd(backupRevenueIncluded, backupRevenueAdditive);
    const revenue = safeAdd(safeAdd(routeRevenue, freshRevenue), backupRevenueAdditive);
    const workDay = !off && (revenue > 0 || entry.workCount > 0);
    const result = { date, revenue, count, routeRevenue, freshRevenue, backupRevenue,
      backupRevenueIncluded, backupRevenueAdditive, workDay, off };
    days.push(result);
    for (const field of ["revenue", "count", "routeRevenue", "freshRevenue", "backupRevenue", "backupRevenueIncluded", "backupRevenueAdditive"]) {
      totals[field] = safeAdd(totals[field], result[field]);
    }
    if (workDay) totals.workDays++;
    if (off) totals.offDays++;
  }

  // Refunds follow the original expense even when the refund date is outside this period.
  const expenseIds = expenses.map((row) => row.id);
  const adjustments = [];
  for (let i = 0; i < expenseIds.length; i += 40) {
    const batch = await paged(client, "quickflex_expense_adjustments", "id,expense_id,kind,amount", "user_id", userId,
      [["expense_id", true], ["id", true]], (q) => q.in("expense_id", expenseIds.slice(i, i + 40)));
    adjustments.push(...batch);
    if (adjustments.length > MAX_ROWS) throw new Error("Finance adjustments exceed read limit");
  }
  const adjustmentByExpense = new Map();
  for (const row of adjustments) {
    const entry = adjustmentByExpense.get(row.expense_id) || { refunds: 0 };
    const amount = int(row.amount, 0, "adjustment amount");
    if (row.kind === "refund") entry.refunds = safeAdd(entry.refunds, amount);
    else if (row.kind !== "reimbursement") throw new Error("Invalid finance adjustment kind");
    adjustmentByExpense.set(row.expense_id, entry);
  }
  const categoryMap = new Map();
  for (const row of expenses) {
    const gross = int(row.gross_amount, 0, "expense amount");
    const adjusted = adjustmentByExpense.get(row.id) || { refunds: 0 };
    if (adjusted.refunds > gross) throw new Error("Expense refunds exceed gross amount");
    totals.expenseGross = safeAdd(totals.expenseGross, gross);
    totals.refunds = safeAdd(totals.refunds, adjusted.refunds);
    const category = String(row.category || "미분류");
    const bucket = categoryMap.get(category) || { category, gross: 0, refunds: 0, net: 0, count: 0 };
    bucket.gross = safeAdd(bucket.gross, gross);
    bucket.refunds = safeAdd(bucket.refunds, adjusted.refunds);
    bucket.net = safeAdd(bucket.net, gross - adjusted.refunds);
    bucket.count++;
    categoryMap.set(category, bucket);
  }
  totals.expenses = totals.expenseGross - totals.refunds;
  for (const row of periodReimbursements) totals.reimbursements = safeAdd(totals.reimbursements, int(row.amount, 0, "reimbursement amount"));
  totals.net = totals.revenue - totals.expenses;
  totals.averageRevenuePerWorkDay = totals.workDays ? totals.revenue / totals.workDays : 0;
  const expensesByCategory = [...categoryMap.values()].sort((a, b) => b.net - a.net || a.category.localeCompare(b.category, "ko"));
  const goalAmount = int(profile.goal_amount, 6_000_000, "monthly goal") || 6_000_000;
  return { from, to, days, totals, expensesByCategory, goalAmount, semantics: {
    period: "Inclusive calendar dates; monthly goal belongs to the app's 26th-to-25th settlement month and is not prorated for arbitrary ranges.",
    revenue: "Historical manual unit snapshots and automatic finalization snapshots; automatic backup bonus is included in its unit, manual backup bonus is additive. An applicable date override replaces all manual and automatic route rows.",
    expenses: "Confirmed expenses dated in the range, less every refund tied to those original expenses regardless of refund date; reimbursements dated in the range are reported separately and do not change displayed net.",
    net: "Revenue minus confirmed expenses after refunds. This is a cash-style displayed remainder, not taxable profit.",
    averageRevenuePerWorkDay: "Revenue divided by days with positive revenue or a completed automatic work header; zero when there are no worked days.",
  } };
}
