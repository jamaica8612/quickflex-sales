import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const recordUi = readFileSync(new URL("../src/ui/record.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8");

function extractFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const syncMarker = `function ${name}(`;
  let start = main.indexOf(asyncMarker);
  if (start < 0) start = main.indexOf(syncMarker);
  assert.notEqual(start, -1, `missing ${name}()`);
  const paramsStart = main.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < main.length; index += 1) {
    if (main[index] === "(") paramsDepth += 1;
    if (main[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const bodyStart = main.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") depth -= 1;
    if (depth === 0) return main.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}()`);
}

function loadFunctions(names, sandbox = {}) {
  const context = vm.createContext(sandbox);
  vm.runInContext(`${names.map(extractFunction).join("\n")}\nglobalThis.__actual = { ${names.join(", ")} };`, context);
  return context.__actual;
}

function tagById(id) {
  const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
  assert.ok(match, `missing #${id}`);
  return match[0];
}

test("PWA config names the immutable-receipt detail and date override contracts", () => {
  assert.match(config, /workResultRouteDetails:\s*"quickflex_work_result_route_details"/);
  assert.match(config, /automaticSalesOverrides:\s*"quickflex_automatic_sales_overrides"/);
  assert.match(config, /replaceAutomaticSalesOverride:\s*"quickflex_replace_automatic_sales_override"/);
  assert.match(serviceWorker, /quickflex-shell-v1\.0\.37/);
  assert.match(html, /src\/main\.js\?v=1\.0\.37/);
  assert.match(html, /styles\.css\?v=1\.0\.37/);
  assert.match(html, /퀵플렉스 매출관리 v1\.0\.37/);
  assert.equal(JSON.parse(manifest).version, "1.0.37");
});

test("override payload is a 1..100 row A/B-only full snapshot without household fields", () => {
  const { salesOverridePayload } = loadFunctions([
    "exactLedgerInteger",
    "normalizeBaseSalesRoute",
    "salesOverridePayload",
  ], {
    normalizeRoute: (value) => String(value || "").trim().toUpperCase(),
  });

  const valid = salesOverridePayload([
    { route: "318a", count: "12", unit: "775", households: 99 },
    { route: "318B", delivery_count: 9, unit_snapshot: 805 },
  ]);
  assert.equal(valid.issues.length, 0);
  assert.equal(valid.routes.length, 2);
  assert.equal(valid.routes[0].route, "318A");
  assert.deepEqual(Object.keys(valid.routes[0]).sort(), ["delivery_count", "route", "sort_order", "unit_snapshot"]);
  assert.equal("household_count" in valid.routes[0], false);

  assert.equal(salesOverridePayload([]).issues.some((issue) => issue.includes("1행 이상")), true);
  assert.equal(salesOverridePayload(Array.from({ length: 101 }, (_, index) => ({ route: `318${String.fromCharCode(65 + index % 26)}`, count: 1, unit: 1 }))).issues.some((issue) => issue.includes("최대 100행")), true);
  assert.equal(salesOverridePayload([{ route: "318A01", count: 1, unit: 1 }]).issues.some((issue) => issue.includes("A/B 구역")), true);
  assert.equal(salesOverridePayload([{ route: "318A", count: 1, unit: 1 }, { route: "318A", count: 2, unit: 1 }]).issues.some((issue) => issue.includes("중복")), true);
  assert.equal(salesOverridePayload([{ route: "318A", count: -1, unit: 1 }]).issues.some((issue) => issue.includes("상품수")), true);
});

test("a date override replaces every route sales row and leaves the immutable input untouched", () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const { applyAutomaticSalesOverrideToRecord } = loadFunctions([
    "isAutomaticRow",
    "automaticRows",
    "manualRows",
    "hasAutomaticEntries",
    "overrideRecordRows",
    "applyAutomaticSalesOverrideToRecord",
  ], {
    normalizeRecordShape: clone,
  });
  const original = {
    off: false,
    freshCount: 3,
    automaticWorks: [{ workId: "receipt-1" }],
    rows: [
      { route: "318A", count: 10, unit: 775, source: "automatic", readOnly: true },
      { route: "318B", count: 20, unit: 775, source: "automatic", readOnly: true },
      { route: "999A", count: 999, unit: 1 },
    ],
  };
  const snapshot = {
    work_date: "2026-08-26",
    revision: 2,
    routes: [{ route: "318A", delivery_count: 11, unit_snapshot: 800, sort_order: 0 }],
  };

  const effective = applyAutomaticSalesOverrideToRecord(original, snapshot);
  assert.equal(effective.rows.length, 1, "original and old manual rows must not be added to a full snapshot");
  assert.equal(effective.rows[0].route, "318A");
  assert.equal(effective.rows[0].count, 11);
  assert.equal(effective.rows[0].source, "override");
  assert.equal(effective.freshCount, 3, "date extras survive route replacement");
  assert.equal(original.rows.length, 3, "the immutable in-memory receipt remains unchanged");
  assert.equal(original.rows[0].count, 10);
});

test("admin effective ledger replaces rather than sums an override date", () => {
  const { effectiveAutomaticLedgerItems } = loadFunctions([
    "userDateKey",
    "effectiveAutomaticLedgerItems",
  ], {
    normalizeAutomaticSalesOverride: (row) => row,
  });
  const original = [
    { user_id: "u1", work_date: "2026-08-26", route: "318A", delivery_count: 10 },
    { user_id: "u2", work_date: "2026-08-26", route: "318B", delivery_count: 7 },
  ];
  const overrides = [{
    user_id: "u1",
    work_date: "2026-08-26",
    revision: 1,
    routes: [{ route: "318A", delivery_count: 12, unit_snapshot: 775, sort_order: 0 }],
  }];
  const effective = effectiveAutomaticLedgerItems(original, overrides);

  assert.equal(effective.length, 2);
  assert.equal(effective.filter((row) => row.user_id === "u1").length, 1);
  assert.equal(effective.find((row) => row.user_id === "u1").delivery_count, 12);
  assert.equal(effective.find((row) => row.user_id === "u1").source, "override");
  assert.equal(effective.find((row) => row.user_id === "u2").delivery_count, 7);
});

test("raw A01/A02 detail counts remain unchanged when effective A/B sales differ", () => {
  const effective = new Map([["318A", { route: "318A", count: 3, revenue: 2325 }]]);
  const { selectedDateSalesBreakdown } = loadFunctions([
    "exactLedgerInteger",
    "normalizeBaseSalesRoute",
    "rawDetailBreakdown",
    "selectedDateSalesBreakdown",
  ], {
    normalizeRoute: (value) => String(value || "").trim().toUpperCase(),
    automaticBaseBreakdown: () => effective,
  });
  const model = selectedDateSalesBreakdown({}, [
    { detailRoute: "318A01", baseRoute: "318A", deliveryCount: 4 },
    { detailRoute: "318A02", baseRoute: "318A", deliveryCount: 2 },
  ]);

  assert.equal(model.rows[0].count, 3);
  assert.equal(model.rows[0].detailCount, 6);
  assert.equal(model.rows[0].difference, -3);
  assert.equal(model.rows[0].detailRows[0].count, 4, "raw detail must not be proportionally trimmed");
  assert.equal(model.rows[0].detailRows[1].count, 2);
});

test("partial RPC responses fall back to fetch instead of being normalized as snapshots", () => {
  const calls = [];
  const { automaticSalesOverrideResult } = loadFunctions(["automaticSalesOverrideResult"], {
    normalizeAutomaticSalesOverride: (value) => {
      calls.push(value);
      return value;
    },
  });

  assert.equal(automaticSalesOverrideResult({ status: "updated", revision: 2, total_items: 21 }), null);
  assert.equal(calls.length, 0);
  const full = { work_date: "2026-08-26", routes: [], revision: 2, total_items: 0 };
  assert.equal(automaticSalesOverrideResult(full), full);
  assert.equal(calls.length, 1);
});

test("RPC failure keeps the same editable draft and sends first revision zero without households", async () => {
  const rpcCalls = [];
  const statuses = [];
  const draft = {
    dateKey: "2026-08-26",
    revision: null,
    rows: [{ route: "318A", count: "12", unit: "775" }],
    reason: "",
    requestId: "",
    dirty: true,
    saving: false,
  };
  const state = {
    salesOverrideDraft: draft,
    db: {
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return { data: null, error: { code: "PGRST202", message: "function missing" } };
      },
    },
  };
  const el = {
    salesOverrideReason: { value: "누락 수정" },
    salesOverrideRows: { querySelector: () => null },
  };
  const { saveSalesOverride } = loadFunctions(["persistAutomaticSalesSnapshot", "saveSalesOverride"], {
    state,
    el,
    RPC: { replaceAutomaticSalesOverride: "replace-rpc" },
    currentUserId: () => "u1",
    salesOverridePayload: () => ({ issues: [], routes: [{ route: "318A", delivery_count: 12, unit_snapshot: 775, sort_order: 0 }] }),
    captureAccountContext: () => ({ userId: "u1", epoch: 1 }),
    isAccountContextCurrent: () => true,
    staleAccountSaveError: () => new Error("stale"),
    makeSalesOverrideRequestId: () => "request-1",
    automaticSalesOverrideResult: () => null,
    fetchAutomaticSalesOverrides: async () => ({ rows: [] }),
    normalizeAutomaticSalesOverride: (row) => row,
    renderSalesOverrideRows: () => {},
    setSalesOverrideStatus: (...args) => statuses.push(args),
    isOptionalSalesContractMissing: () => true,
  });

  assert.equal(await saveSalesOverride(), false);
  assert.equal(state.salesOverrideDraft, draft);
  assert.equal(draft.rows[0].count, "12");
  assert.equal(draft.saving, false);
  assert.equal(draft.requestId, "request-1", "the idempotency key survives a failed response for retry");
  assert.equal(rpcCalls[0].args.p_expected_revision, 0);
  assert.equal("household_count" in rpcCalls[0].args.p_routes[0], false);
  assert.equal(statuses.at(-1)[1], "error");
});

test("a late override refetch is account-guarded before writing UI state", () => {
  const source = extractFunction("persistAutomaticSalesSnapshot");
  const refetchAt = source.indexOf("await fetchAutomaticSalesOverrides");
  const returnAt = source.indexOf("return snapshot");
  const postFetchGuardAt = source.indexOf(
    "if (!isAccountContextCurrent(context)) throw staleAccountSaveError();",
    refetchAt,
  );

  assert.ok(refetchAt >= 0, "override fallback refetch must exist");
  assert.ok(postFetchGuardAt > refetchAt, "account guard must run again after the awaited refetch");
  assert.ok(returnAt > postFetchGuardAt, "no replacement-account snapshot may be returned before that guard");
});

test("account reset clears every new sales surface and force-closes an open editor", () => {
  let closed = false;
  const emptyNode = () => ({ innerHTML: "old", value: "old", classList: { add() {}, contains() { return false; } } });
  const state = {
    saveTimer: null,
    flushPromise: {},
    pendingDates: new Set(["2026-08-26"]),
    pendingRates: true,
    profile: {}, rates: [1], defaultRates: [1], routeBundles: [1], entries: { old: 1 },
    receiptEntries: { old: 1 }, automaticSalesOverrides: { old: 1 }, workRouteDetails: { old: 1 },
    salesOverrideContractAvailable: true, workRouteDetailsContractAvailable: true,
    salesOverrideDraft: { rows: [1] }, inspections: {}, inspectionSignature: "x", inspectionDate: "",
    inspectionDraft: {}, rateOfferPrompted: true, statsDetailDate: "x", adminStatsDetailUser: "x",
    recordDraftDate: "x", recordDraft: {}, recordDraftSalesRequestId: "request", recordDraftSalesPayload: "payload", measurementDate: "x", measurementDateAuto: true,
  };
  const el = {
    salesOverrideOverlay: { classList: { contains: () => true } },
    scheduleDraftSection: emptyNode(), scheduleDraftCards: emptyNode(),
    salesOverrideRows: emptyNode(), salesOverrideReason: emptyNode(), salesOverrideStatus: emptyNode(),
    adminRevenueList: emptyNode(), adminRouteList: emptyNode(), adminBundleList: emptyNode(), adminProfiles: emptyNode(),
  };
  const sandbox = {
    state, el,
    clearTimeout: () => {},
    closeSalesOverride: (force) => { closed = force; },
    todayKey: () => "2026-08-26",
    inspectionDraftFromRecord: () => ({}),
    profileSignaturePad: { clear() {} },
    ocrDraftMap: {},
    accountBootTask: {},
  };
  const { clearUserScopedState } = loadFunctions(["clearUserScopedState"], sandbox);
  clearUserScopedState();

  assert.equal(closed, true);
  assert.equal(Object.keys(state.receiptEntries).length, 0);
  assert.equal(Object.keys(state.automaticSalesOverrides).length, 0);
  assert.equal(Object.keys(state.workRouteDetails).length, 0);
  assert.equal(state.salesOverrideContractAvailable, false);
  assert.equal(state.workRouteDetailsContractAvailable, false);
  assert.equal(state.salesOverrideDraft, null);
  assert.equal(state.recordDraftSalesRequestId, "");
  assert.equal(state.recordDraftSalesPayload, "");
});

test("calendar sales correction opens the normal record editor while the fallback dialog stays accessible", () => {
  assert.doesNotMatch(tagById("openSalesOverride"), /aria-haspopup="dialog"/);
  assert.match(main, /openSalesOverride\?\.addEventListener[\s\S]*startRecordDraft\(state\.selectedDate\)[\s\S]*showView\("record"\)/);
  assert.match(tagById("salesOverrideOverlay"), /aria-hidden="true"/);
  assert.match(tagById("salesOverrideOverlay"), /\binert\b/);
  assert.match(tagById("salesOverrideDialog"), /role="dialog"/);
  assert.match(tagById("salesOverrideDialog"), /aria-modal="true"/);
  assert.match(tagById("salesOverrideStatus"), /aria-live="polite"/);
  assert.match(main, /class="sales-override-route"/);
  assert.match(main, /class="sales-override-count"/);
  assert.match(main, /class="sales-override-unit"/);
  assert.match(main, /class="sales-override-delete"/);
  assert.match(main, /salesOverrideAddRoute[\s\S]*draft\.rows\.push/);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*\.sales-override-row\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) 44px/);
  assert.match(css, /\.sales-override-route-field\s*\{\s*grid-column:\s*1 \/ 3/);
  assert.match(css, /\.sales-override-delete\s*\{\s*grid-column:\s*3;\s*grid-row:\s*1 \/ 4/);
  assert.match(css, /\.sales-override-card[\s\S]*overflow-x:\s*hidden/);
});

test("automatic receipt rows are normal editable rows and save through the override contract", () => {
  const renderForm = extractFunction("renderEntryForm");
  const renderRow = extractFunction("renderEntryRow");
  const startDraft = extractFunction("startRecordDraft");
  const saveRecord = extractFunction("saveCurrentRecordAndGoHome");
  assert.match(main, /state\.receiptEntries = entriesFromDb/);
  assert.match(main, /state\.entries = applyAutomaticSalesOverrides\(state\.receiptEntries/);
  assert.match(main, /routeInput\.readOnly = false/);
  assert.doesNotMatch(renderRow, /input\.disabled = true/);
  assert.doesNotMatch(renderRow, /🔒/);
  assert.match(main, /householdField\?\.classList\.add\("hidden"\)/);
  assert.match(renderForm, /el\.addRoute\.disabled = false/);
  assert.match(renderForm, /el\.backupUnit\.disabled = false/);
  assert.match(renderForm, /automaticRecordNotice\?\.classList\.add\("hidden"\)/);
  assert.match(recordUi, /source:\s*"override",\s*readOnly:\s*true/);
  assert.match(startDraft, /seedSalesOverrideRows/);
  assert.match(saveRecord, /persistAutomaticSalesSnapshot/);
  assert.doesNotMatch(startDraft, /todayKey\s*\(/, "past automatic dates must use the same editable draft path");
  assert.doesNotMatch(saveRecord, /todayKey\s*\(/, "past automatic dates must use the same save path");
  assert.match(extractFunction("persistAutomaticSalesSnapshot"), /p_routes:\s*payload\.routes/);
  assert.doesNotMatch(extractFunction("saveSalesOverride"), /household/i);
});

test("leaving an unchanged automatic route field preserves its historical unit", () => {
  const renderRow = extractFunction("renderEntryRow");
  const blurStart = renderRow.indexOf('routeInput.addEventListener("blur"');
  const countStart = renderRow.indexOf('count.addEventListener("input"', blurStart);
  assert.ok(blurStart >= 0 && countStart > blurStart, "route blur handler must be present");
  const blurHandler = renderRow.slice(blurStart, countStart);
  assert.doesNotMatch(blurHandler, /autoUnitForRoutes/, "blur alone must not replace an old unit with today's default rate");
  assert.match(blurHandler, /displayedRouteUnit\(current, current\.rows\[index\]\)/);
});

test("normal record save keeps one request id across a day-field failure and retry", async () => {
  const draft = {
    off: false,
    automaticWorks: [{ workId: "work-1" }],
    rows: [{ route: "324C", count: 10, unit: 1050, source: "override", readOnly: true }],
    backupUnit: 50,
  };
  const state = {
    selectedDate: "2026-08-27",
    db: {},
    automaticSalesOverrides: { "2026-08-27": { revision: 1 } },
    recordDraftSalesRequestId: "",
    recordDraftSalesPayload: "",
  };
  const overrideCalls = [];
  let flushAttempts = 0;
  let commits = 0;
  const toasts = [];
  const { saveCurrentRecordAndGoHome } = loadFunctions(["saveCurrentRecordAndGoHome"], {
    state,
    syncFormToRecord: () => draft,
    hasAutomaticEntries: () => true,
    currentUserId: () => "u1",
    captureAccountContext: () => ({ userId: "u1", epoch: 1 }),
    automaticSalesRequestFingerprint: () => "same-payload",
    makeSalesOverrideRequestId: () => "request-stable",
    persistAutomaticSalesSnapshot: async (args) => {
      overrideCalls.push(args);
      return { work_date: args.dateKey, revision: 2, routes: [] };
    },
    applyAutomaticSalesSnapshot: () => {},
    commitRecordDraft: () => { commits += 1; },
    scheduleSave: () => {},
    ensurePendingSavesFlushed: async () => {
      flushAttempts += 1;
      if (flushAttempts === 1) throw new Error("day upsert failed");
    },
    renderAll: () => {},
    showView: () => {},
    toast: (...args) => toasts.push(args),
  });

  assert.equal(await saveCurrentRecordAndGoHome(), false);
  assert.equal(state.recordDraftSalesRequestId, "request-stable");
  assert.equal(state.recordDraftSalesPayload, "same-payload");
  assert.equal(commits, 0, "the editable draft stays open until date extras persist");

  assert.equal(await saveCurrentRecordAndGoHome(), true);
  assert.deepEqual(overrideCalls.map((call) => call.requestId), ["request-stable", "request-stable"]);
  assert.equal(commits, 1);
  assert.equal(toasts.some(([message]) => String(message).includes("day upsert failed")), true);
});

test("normal record save preserves the draft and id on an override revision conflict", async () => {
  const state = {
    selectedDate: "2026-08-27",
    db: {},
    automaticSalesOverrides: { "2026-08-27": { revision: 3 } },
    recordDraftSalesRequestId: "",
    recordDraftSalesPayload: "",
  };
  let commits = 0;
  const toasts = [];
  const { saveCurrentRecordAndGoHome } = loadFunctions(["saveCurrentRecordAndGoHome"], {
    state,
    syncFormToRecord: () => ({ automaticWorks: [{ workId: "work-1" }], rows: [{ route: "324D", count: 8, unit: 1100 }] }),
    hasAutomaticEntries: () => true,
    currentUserId: () => "u1",
    captureAccountContext: () => ({ userId: "u1", epoch: 1 }),
    automaticSalesRequestFingerprint: () => "conflicting-payload",
    makeSalesOverrideRequestId: () => "request-conflict",
    persistAutomaticSalesSnapshot: async () => {
      const error = new Error("automatic sales override revision conflict");
      error.code = "40001";
      throw error;
    },
    applyAutomaticSalesSnapshot: () => {},
    commitRecordDraft: () => { commits += 1; },
    scheduleSave: () => {},
    ensurePendingSavesFlushed: async () => {},
    renderAll: () => {},
    showView: () => {},
    toast: (...args) => toasts.push(args),
  });

  assert.equal(await saveCurrentRecordAndGoHome(), false);
  assert.equal(state.recordDraftSalesRequestId, "request-conflict");
  assert.equal(commits, 0);
  assert.equal(toasts.at(-1)[0].includes("다른 기기"), true);
});
