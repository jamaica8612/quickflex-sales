import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunctionDeclaration(name) {
  const asyncMarker = `async function ${name}(`;
  const syncMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  const marker = start >= 0 ? asyncMarker : syncMarker;
  if (start < 0) start = source.indexOf(syncMarker);
  assert.notEqual(start, -1, `${name} must exist in src/main.js`);

  const paramsStart = source.indexOf("(", start + marker.indexOf("function"));
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }

  const bodyStart = source.indexOf("{", paramsEnd);
  let bodyDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") bodyDepth += 1;
    if (source[index] === "}") bodyDepth -= 1;
    if (bodyDepth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadActualFunctions(names, sandbox = {}) {
  const context = vm.createContext(sandbox);
  const declarations = names.map(extractFunctionDeclaration).join("\n");
  vm.runInContext(`${declarations}\nglobalThis.__actual = { ${names.join(", ")} };`, context);
  return { context, ...context.__actual };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSaveHarness() {
  const badges = [];
  const toasts = [];
  const errors = [];
  const state = {
    db: {},
    entries: {},
    pendingDates: new Set(),
    pendingRates: false,
    flushPromise: null,
    recordDraft: null,
    recordDraftDate: "",
  };
  const hooks = {
    persistDay: async () => true,
    persistRates: async () => true,
    loadFromDb: async () => true,
  };
  const sandbox = {
    state,
    currentUserId: () => "user-a",
    captureAccountContext: () => ({ userId: "user-a", authEpoch: 1 }),
    isAccountContextCurrent: (context) => context?.userId === "user-a",
    persistDay: (...args) => hooks.persistDay(...args),
    persistRates: (...args) => hooks.persistRates(...args),
    loadFromDb: (...args) => hooks.loadFromDb(...args),
    setDbBadge: (...args) => badges.push(args),
    cloneRecord: (record) => JSON.parse(JSON.stringify(record)),
    getRecord: (dateKey) => state.entries[dateKey] || { off: false, rows: [], automaticWorks: [] },
    hasAutomaticEntries: (record) => Boolean(
      record?.automaticWorks?.length
      || record?.rows?.some((row) => row?.source === "automatic" || row?.readOnly === true),
    ),
    setRecord: (dateKey, record) => { state.entries[dateKey] = JSON.parse(JSON.stringify(record)); },
    discardRecordDraft: () => {
      state.recordDraft = null;
      state.recordDraftDate = "";
    },
    renderAll: () => {},
    toast: (...args) => toasts.push(args),
    formatLongShort: (dateKey) => dateKey,
    console: { error: (...args) => errors.push(args) },
  };
  const actual = loadActualFunctions([
    "asSaveError",
    "isAutomaticLedgerLockError",
    "staleAccountSaveError",
    "recoverAutomaticLedgerLock",
    "flushSaves",
  ], sandbox);
  return { ...actual, state, hooks, badges, toasts, errors };
}

test("persist failure keeps the date dirty and never reports a saved badge", async () => {
  const harness = createSaveHarness();
  const dateKey = "2026-08-24";
  harness.state.pendingDates.add(dateKey);
  harness.hooks.persistDay = async () => { throw new Error("network unavailable"); };

  await assert.rejects(harness.flushSaves(), /network unavailable/);

  assert.equal(harness.state.pendingDates.has(dateKey), true);
  assert.equal(harness.state.pendingDates.size, 1);
  assert.equal(harness.badges.length, 0, "a failed write must not show a saved badge");
  assert.equal(harness.state.flushPromise, null, "the failed promise must be released for retry");
});

test("an empty flush followed by a same-tick dirty date is not lost", async () => {
  const harness = createSaveHarness();
  const persisted = [];
  harness.hooks.persistDay = async (dateKey) => {
    persisted.push(dateKey);
    return true;
  };

  const emptyFlush = harness.flushSaves();
  harness.state.pendingDates.add("2026-08-25");
  const sameTickFlush = harness.flushSaves();
  await Promise.all([emptyFlush, sameTickFlush]);

  assert.deepEqual(persisted, ["2026-08-25"]);
  assert.equal(harness.state.pendingDates.size, 0);
  assert.equal(harness.state.flushPromise, null);
  assert.equal(harness.badges.length, 1);
});

test("a reentrant flush drains a midflight dirty date and cleans up its promise", async () => {
  const harness = createSaveHarness();
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const persisted = [];
  harness.hooks.persistDay = async (dateKey) => {
    persisted.push(dateKey);
    if (dateKey === "2026-08-26") {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
    return true;
  };

  harness.state.pendingDates.add("2026-08-26");
  const firstFlush = harness.flushSaves();
  await firstStarted.promise;
  harness.state.pendingDates.add("2026-08-27");
  const reentrantFlush = harness.flushSaves();
  releaseFirst.resolve();
  await Promise.all([firstFlush, reentrantFlush]);

  assert.deepEqual(persisted, ["2026-08-26", "2026-08-27"]);
  assert.equal(harness.state.pendingDates.size, 0);
  assert.equal(harness.state.flushPromise, null);
  assert.equal(harness.badges.length, 1);
});

function canonicalHeader(routes, overrides = {}) {
  const totalItems = routes.reduce((sum, row) => sum + row.delivery_count, 0);
  const totalHouseholds = routes.reduce((sum, row) => sum + row.household_count, 0);
  return {
    user_id: "user-a",
    work_id: "work-1",
    work_date: "2026-08-24",
    work_shift: "night",
    total_items: totalItems,
    total_households: totalHouseholds,
    canonical_payload: {
      work_date: "2026-08-24",
      work_shift: "night",
      total_items: totalItems,
      total_households: totalHouseholds,
      routes,
    },
    finalized_at: "2026-08-24T06:00:00+09:00",
    ...overrides,
  };
}

function ledgerValidationHarness() {
  return loadActualFunctions([
    "workLedgerKey",
    "parseCanonicalWorkPayload",
    "exactLedgerInteger",
    "validateWorkLedgerRows",
  ]);
}

test("immutable ledger rejects a header without route rows", () => {
  const { validateWorkLedgerRows } = ledgerValidationHarness();
  const routes = [
    { route: "310A", delivery_count: 10, household_count: 8, unit_snapshot: 1200, sort_order: 0 },
  ];
  const issues = validateWorkLedgerRows([canonicalHeader(routes)], []);

  assert.equal(issues.some((issue) => issue.includes("구역 상세 없음")), true);
  assert.equal(issues.some((issue) => issue.includes("상품 합계 불일치")), true);
});

test("immutable ledger rejects per-route swaps even when grand totals match", () => {
  const { validateWorkLedgerRows } = ledgerValidationHarness();
  const expectedRoutes = [
    { route: "310A", delivery_count: 100, household_count: 80, unit_snapshot: 1200, sort_order: 0 },
    { route: "310B", delivery_count: 50, household_count: 40, unit_snapshot: 1300, sort_order: 1 },
  ];
  const actualRoutes = [
    { user_id: "user-a", work_id: "work-1", ...expectedRoutes[0], delivery_count: 50, household_count: 40 },
    { user_id: "user-a", work_id: "work-1", ...expectedRoutes[1], delivery_count: 100, household_count: 80 },
  ];
  const issues = validateWorkLedgerRows([canonicalHeader(expectedRoutes)], actualRoutes);

  assert.equal(issues.some((issue) => issue.includes("310A delivery_count 불일치")), true);
  assert.equal(issues.some((issue) => issue.includes("310B delivery_count 불일치")), true);
  assert.equal(issues.some((issue) => issue.includes("상품 합계 불일치")), false, "the test keeps totals equal");
});

test("immutable ledger rejects route totals that differ from the header", () => {
  const { validateWorkLedgerRows } = ledgerValidationHarness();
  const expectedRoutes = [
    { route: "310A", delivery_count: 150, household_count: 120, unit_snapshot: 1200, sort_order: 0 },
  ];
  const actualRoutes = [
    { user_id: "user-a", work_id: "work-1", ...expectedRoutes[0], delivery_count: 149 },
  ];
  const issues = validateWorkLedgerRows([canonicalHeader(expectedRoutes)], actualRoutes);

  assert.equal(issues.some((issue) => issue.includes("상품 합계 불일치")), true);
});

test("completed-household differences never block the immutable sales ledger", () => {
  const { validateWorkLedgerRows } = ledgerValidationHarness();
  const expectedRoutes = [
    { route: "310A", delivery_count: 15, household_count: 999, unit_snapshot: 1200, sort_order: 0 },
  ];
  const header = canonicalHeader(expectedRoutes, {
    total_households: -1,
    canonical_payload: {
      work_date: "2026-08-24",
      work_shift: "night",
      total_items: 15,
      total_households: 123456,
      routes: expectedRoutes,
    },
  });
  const actualRoutes = [{
    user_id: "user-a",
    work_id: "work-1",
    ...expectedRoutes[0],
    household_count: -999,
  }];

  assert.equal(validateWorkLedgerRows([header], actualRoutes).length, 0);
});

function createPagedLedgerDb(headerRows, routeRows, requests) {
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }

    select() { return this; }

    eq(field, value) {
      this.filters.push((row) => row[field] === value);
      return this;
    }

    gte(field, value) {
      this.filters.push((row) => row[field] >= value);
      return this;
    }

    lte(field, value) {
      this.filters.push((row) => row[field] <= value);
      return this;
    }

    in(field, values) {
      const allowed = new Set(values);
      this.filters.push((row) => allowed.has(row[field]));
      return this;
    }

    order() { return this; }

    async range(from, to) {
      const sourceRows = this.table === "work-results" ? headerRows : routeRows;
      const filtered = sourceRows.filter((row) => this.filters.every((predicate) => predicate(row)));
      requests.push({ table: this.table, from, to });
      return { data: filtered.slice(from, to + 1), error: null, count: filtered.length };
    }
  }

  return { from: (table) => new Query(table) };
}

test("immutable ledger fetches all 1201 header rows and all 1201 route rows", async () => {
  const requests = [];
  const headerRows = Array.from({ length: 1201 }, (_, index) => ({
    user_id: "user-a",
    work_id: `work-${index}`,
    work_date: "2026-08-24",
    finalized_at: String(index).padStart(4, "0"),
  }));
  const routeRows = Array.from({ length: 1201 }, (_, index) => ({
    user_id: "user-a",
    work_id: "work-0",
    route: `R${index}`,
    sort_order: index,
  }));
  const state = { db: createPagedLedgerDb(headerRows, routeRows, requests) };
  const { fetchWorkResultHeaders, fetchWorkResultRoutes } = loadActualFunctions([
    "fetchPagedRows",
    "fetchWorkResultHeaders",
    "fetchWorkResultRoutes",
  ], {
    state,
    TABLES: { salesWorkResults: "work-results", salesWorkRoutes: "work-result-routes" },
    LEDGER_PAGE_SIZE: 500,
    LEDGER_WORK_ID_BATCH_SIZE: 40,
    WORK_RESULT_SELECT: "header-select",
    WORK_RESULT_ROUTE_SELECT: "route-select",
  });

  const fetchedHeaders = await fetchWorkResultHeaders({ userId: "user-a" });
  const fetchedRoutes = await fetchWorkResultRoutes([headerRows[0]]);

  assert.equal(fetchedHeaders.length, 1201);
  assert.equal(fetchedRoutes.length, 1201);
  assert.deepEqual(
    requests.filter((request) => request.table === "work-results").map(({ from, to }) => [from, to]),
    [[0, 499], [500, 999], [1000, 1499]],
  );
  assert.deepEqual(
    requests.filter((request) => request.table === "work-result-routes").map(({ from, to }) => [from, to]),
    [[0, 499], [500, 999], [1000, 1499]],
  );
});

test("automatic unit snapshots expose backup pay once while manual rows still add it once", () => {
  const { calcRecordDetails } = loadActualFunctions([
    "defaultFreshUnit",
    "defaultBackupUnit",
    "freshbagModeForRecord",
    "isAutomaticRow",
    "effectiveUnit",
    "calcRecordDetails",
  ], {
    DEFAULT_BACKUP_UNIT: 100,
    normalizeRecordShape: (record) => record,
    toNum: (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    },
    freshbagMode: () => "single",
    sharedRateForRoutes: () => 0,
    rateFor: () => 0,
  });
  const base = {
    off: false,
    freshCount: 0,
    freshUnit: 100,
    backupUnit: 100,
    driverType: "backup",
  };

  const automatic = calcRecordDetails({
    ...base,
    rows: [{ route: "310A", count: 10, unit: 1200, source: "automatic", readOnly: true }],
  });
  const manual = calcRecordDetails({
    ...base,
    rows: [{ route: "310A", count: 10, unit: 1100 }],
  });

  assert.equal(automatic.routeRevenue, 12000);
  assert.equal(automatic.backupRevenue, 1000);
  assert.equal(automatic.backupRevenueIncluded, 1000);
  assert.equal(automatic.backupRevenueAdditive, 0);
  assert.equal(automatic.revenue, 12000);
  assert.equal(manual.routeRevenue, 11000);
  assert.equal(manual.backupRevenue, 1000);
  assert.equal(manual.backupRevenueIncluded, 0);
  assert.equal(manual.backupRevenueAdditive, 1000);
  assert.equal(manual.revenue, 12000);
});

test("return count is labeled separately without adding delivery revenue twice", () => {
  const { calcRecordDetails } = loadActualFunctions([
    "defaultFreshUnit",
    "defaultBackupUnit",
    "freshbagModeForRecord",
    "isAutomaticRow",
    "effectiveUnit",
    "calcRecordDetails",
  ], {
    DEFAULT_BACKUP_UNIT: 30,
    normalizeRecordShape: (record) => record,
    toNum: (value) => Number(value) || 0,
    freshbagMode: () => "single",
    sharedRateForRoutes: () => 0,
    rateFor: () => 0,
  });

  const details = calcRecordDetails({
    off: false,
    rows: [{ route: "310A", count: 5, unit: 1000, source: "automatic", readOnly: true }],
    freshCount: 2,
    returnCount: 3,
    freshUnit: 100,
    backupUnit: 0,
    driverType: "fixed",
  });

  assert.equal(details.count, 5);
  assert.equal(details.returnCount, 3);
  assert.equal(details.routeRevenue, 5000);
  assert.equal(details.freshRevenue, 200);
  assert.equal(details.revenue, 5200, "returns are already included in the five delivery items");
});

test("changing an automatic-date backup unit adjusts all-in snapshots by the delta exactly once", () => {
  const record = {
    off: false,
    rows: [{ route: "324C", count: 10, unit: 1030, source: "automatic", readOnly: true }],
    automaticWorks: [{ workId: "work-1" }],
    freshCount: 0,
    freshUnit: 100,
    backupUnit: 30,
    driverType: "backup",
  };
  const state = { recordDraft: record };
  const el = {
    freshCount: { value: "0" },
    freshUnit: { value: "100" },
    freshSoloCount: { value: "0" },
    freshLinkedCount: { value: "0" },
    backupUnit: { value: "50" },
  };
  const common = {
    state,
    el,
    currentRecordDraft: () => state.recordDraft,
    isBackupDriver: () => true,
    defaultBackupUnit: (value) => value == null || value === "" ? 30 : value,
    toNum: (value) => Number(value) || 0,
    hasAutomaticEntries: (value) => value.automaticWorks.length > 0,
    isAutomaticRow: (row) => row.source === "automatic" || row.source === "override" || row.readOnly === true,
    effectiveUnit: (row) => Math.max(0, Number(row.unit) || 0),
    freshbagModeForRecord: () => "single",
  };
  const { syncFormToRecord } = loadActualFunctions(["syncFormToRecord"], common);
  syncFormToRecord();
  syncFormToRecord();

  assert.equal(record.rows[0].unit, 1050, "30→50 raises the all-in snapshot by 20 only once");
  assert.equal(record.backupUnit, 50);

  const { calcRecordDetails } = loadActualFunctions([
    "defaultFreshUnit",
    "defaultBackupUnit",
    "freshbagModeForRecord",
    "isAutomaticRow",
    "effectiveUnit",
    "calcRecordDetails",
  ], {
    DEFAULT_BACKUP_UNIT: 30,
    normalizeRecordShape: (value) => value,
    toNum: common.toNum,
    freshbagMode: () => "single",
    sharedRateForRoutes: () => 0,
    rateFor: () => 0,
  });
  const details = calcRecordDetails(record);
  assert.equal(details.routeRevenue, 10500);
  assert.equal(details.backupRevenue, 500);
  assert.equal(details.backupRevenueAdditive, 0);
  assert.equal(details.revenue, 10500, "the included 500 won is not added a second time");
});

test("reloaded automatic overrides separate the saved base unit from the saved backup unit", () => {
  const isAutomaticRow = (row) => row.source === "automatic" || row.source === "override" || row.readOnly === true;
  const { displayedRouteUnit, storedRouteUnit } = loadActualFunctions(["displayedRouteUnit", "storedRouteUnit"], {
    isAutomaticRow,
    effectiveUnit: (row) => Number(row.unit) || 0,
    freshbagModeForRecord: () => "single",
    defaultBackupUnit: (value) => value == null || value === "" ? 30 : value,
    toNum: (value) => Number(value) || 0,
  });
  const reloadedRecord = { driverType: "backup", backupUnit: 50 };
  const reloadedOverrideRow = { route: "324C", unit: 1050, source: "override", readOnly: true };

  assert.equal(displayedRouteUnit(reloadedRecord, reloadedOverrideRow), 1000);
  assert.equal(storedRouteUnit(reloadedRecord, reloadedOverrideRow, 1000), 1050);
});

test("automatic-date extras persist without deleting the immutable receipt routes", async () => {
  const calls = [];
  const record = {
    off: false,
    automaticWorks: [{ workId: "work-1" }],
    rows: [{ route: "324C", count: 10, unit: 1050, source: "override", readOnly: true }],
    freshCount: 2,
    freshUnit: 100,
    freshSoloCount: 0,
    freshLinkedCount: 0,
    backupUnit: 50,
    driverType: "backup",
    salesDayBasis: { fresh_count: 1 },
    salesDayRevision: 2,
  };
  const db = {
    async rpc(name, args) {
      calls.push({ op: "rpc", name, args });
      return { data: { ...args.p_values, fresh_count: 3, work_date: args.p_work_date, user_id: "user-a", sales_edit_revision: 3 }, error: null };
    },
    from(table) {
      return {
        delete() {
          calls.push({ op: "delete", table });
          return { eq() { return this; }, then(resolve) { resolve({ error: null }); } };
        },
        upsert(payload) {
          calls.push({ op: "upsert", table, payload });
          return Promise.resolve({ error: null });
        },
        insert(payload) {
          calls.push({ op: "insert", table, payload });
          return Promise.resolve({ error: null });
        },
        select() {
          return { eq() { return this; }, limit() { return Promise.resolve({ data: [{ work_id: "work-1" }], error: null }); } };
        },
      };
    },
  };
  const state = { db, recordDraftDate: "2026-08-27", recordDraft: { ...record, freshCount: 4 } };
  const isAutomaticRow = (row) => row?.source === "automatic" || row?.source === "override" || row?.readOnly === true;
  const { persistDay } = loadActualFunctions(["persistDay", "salesDayEditableValues"], {
    state,
    TABLES: { workResults: "work-results", items: "day-items", days: "days" },
    RPC: { updateSalesDay: "update-sales-day" },
    DEFAULT_BACKUP_UNIT: 30,
    captureAccountContext: () => ({ userId: "user-a" }),
    isAccountContextCurrent: () => true,
    normalizeRecordShape: (value) => ({ ...value, rows: [...(value.rows || [])], automaticWorks: [...(value.automaticWorks || [])] }),
    getRecord: () => record,
    hasAutomaticEntries: (value) => value.automaticWorks.length > 0 || value.rows.some(isAutomaticRow),
    manualRows: (value) => value.rows.filter((row) => !isAutomaticRow(row)),
    hasMeaningfulRecord: () => true,
    isBackupDriver: () => true,
    defaultFreshUnit: (value) => value == null || value === "" ? 100 : value,
    defaultBackupUnit: (value) => value == null || value === "" ? 30 : value,
    toNum: (value) => Number(value) || 0,
    joinStoredRoutes: (value) => value,
    effectiveUnit: (row) => Number(row.unit) || 0,
    freshbagModeForRecord: () => "single",
  });

  assert.equal(await persistDay("2026-08-27", { userId: "user-a" }), true);
  assert.equal(calls.some((call) => call.op === "delete" && call.table === "day-items"), false);
  assert.equal(calls.some((call) => call.op === "insert" && call.table === "day-items"), false);
  const dayWrite = calls.find((call) => call.op === "rpc" && call.name === "update-sales-day");
  assert.equal(dayWrite.args.p_values.backup_unit, 50);
  assert.equal(dayWrite.args.p_values.fresh_count, 2);
  assert.equal(dayWrite.args.p_values.freshbag_mode, "single");
  assert.equal(dayWrite.args.p_expected_revision, 2);
  assert.equal(record.salesDayRevision, 3);
  assert.equal(record.freshCount, 3, "late automatic bag is reflected in the saved record");
  assert.equal(state.recordDraft.salesDayRevision, 3, "committing the draft must not restore a stale revision");
  assert.equal(state.recordDraft.freshCount, 5, "two newer draft edits survive alongside the late automatic bag");
  assert.equal(calls.some((call) => call.op === "upsert"), false);
});

test("manual dates are replaced through one atomic RPC without direct route deletion", async () => {
  const calls = [];
  const record = {
    off: false,
    automaticWorks: [],
    rows: [{ route: "310A01", count: 7, households: 5, unit: 1030 }],
    freshCount: 2,
    freshUnit: 100,
    freshSoloCount: 1,
    freshLinkedCount: 1,
    freshbagMode: "dual",
    backupUnit: 30,
    driverType: "backup",
  };
  const db = {
    rpc(name, payload) {
      calls.push({ op: "rpc", name, payload });
      return Promise.resolve({ data: true, error: null });
    },
    from(table) {
      calls.push({ op: "from", table });
      throw new Error("manual persistence must not issue direct table writes");
    },
  };
  const state = { db, entries: { "2026-09-01": record } };
  const { persistDay } = loadActualFunctions(["persistDay"], {
    state,
    RPC: { replaceManualDayRecord: "quickflex_replace_manual_day_record" },
    TABLES: { workResults: "work-results", items: "day-items", days: "days" },
    captureAccountContext: () => ({ userId: "user-a" }),
    isAccountContextCurrent: () => true,
    normalizeRecordShape: (value) => ({ ...value, rows: [...(value.rows || [])], automaticWorks: [...(value.automaticWorks || [])] }),
    getRecord: () => record,
    hasAutomaticEntries: () => false,
    manualRows: (value) => value.rows,
    hasMeaningfulRecord: () => true,
    isBackupDriver: () => true,
    defaultFreshUnit: (value) => value == null || value === "" ? 100 : value,
    defaultBackupUnit: (value) => value == null || value === "" ? 30 : value,
    toNum: (value) => Number(value) || 0,
    joinStoredRoutes: (value) => value,
    effectiveUnit: (row) => Number(row.unit) || 0,
    freshbagModeForRecord: (value) => value.freshbagMode,
  });

  assert.equal(await persistDay("2026-09-01", { userId: "user-a" }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "quickflex_replace_manual_day_record");
  assert.equal(calls[0].payload.p_delete_day, false);
  assert.equal(calls[0].payload.p_freshbag_mode, "dual");
  assert.equal(JSON.stringify(calls[0].payload.p_items), JSON.stringify([{
    route: "310A01",
    delivery_count: 7,
    household_count: 5,
    unit_snapshot: 1030,
    sort_order: 0,
  }]));
});

test("a 55000 automatic-ledger lock reloads that date but preserves unrelated dirty input", async () => {
  const harness = createSaveHarness();
  const lockedDate = "2026-08-28";
  const unrelatedDate = "2026-08-29";
  harness.state.entries = {
    [lockedDate]: { off: false, automaticWorks: [], rows: [{ route: "310A", count: "7", unit: 1000 }] },
    [unrelatedDate]: { off: false, automaticWorks: [], rows: [{ route: "310B", count: "9", unit: 1100 }] },
  };
  harness.state.pendingDates.add(lockedDate);
  harness.state.pendingDates.add(unrelatedDate);
  harness.hooks.persistDay = async (dateKey) => {
    if (dateKey === lockedDate) {
      const error = new Error("immutable ledger trigger");
      error.code = "55000";
      throw error;
    }
    return true;
  };
  harness.hooks.loadFromDb = async () => {
    harness.state.entries = {
      [lockedDate]: {
        off: false,
        automaticWorks: [{ workId: "android-work" }],
        rows: [{ route: "310A", count: 8, unit: 1200, source: "automatic", readOnly: true }],
      },
      [unrelatedDate]: { off: false, automaticWorks: [], rows: [{ route: "310B", count: "1", unit: 1100 }] },
    };
    return true;
  };

  let caught;
  try {
    await harness.flushSaves();
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.code, "55000");
  assert.equal(caught?.quickflexHandled, true);
  assert.equal(harness.state.pendingDates.has(lockedDate), false);
  assert.equal(harness.state.pendingDates.has(unrelatedDate), true);
  assert.equal(harness.state.pendingDates.size, 1);
  assert.equal(harness.state.entries[lockedDate].automaticWorks[0].workId, "android-work");
  assert.equal(harness.state.entries[unrelatedDate].rows[0].count, "9", "the unsaved local edit survives reload");
  assert.equal(harness.badges.length, 0);
  assert.equal(harness.toasts.length, 1);
  assert.equal(harness.state.flushPromise, null);
});
