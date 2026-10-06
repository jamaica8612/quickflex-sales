import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { bindCalendarEvents } from "../src/ui/calendar.js";
import { bindRecordEvents } from "../src/ui/record.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

globalThis.window = { matchMedia: () => ({ matches: true }) };
globalThis.document = { hidden: false, querySelectorAll: () => [] };

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.checked = false;
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  fire(type) { return this.listeners.get(type)?.({ target: this }); }
  closest() { return this; }
  setAttribute() {}
  removeAttribute() {}
  getBoundingClientRect() { return { width: 48, height: 48 }; }
}

function calendarHarness(record, overrides = {}) {
  const elements = Object.fromEntries([
    "backFromSettings", "prevMonth", "nextMonth", "todayButton", "homeOffToggle",
    "openRecord", "backToCalendar", "prevDay", "nextDay",
  ].map((key) => [key, new FakeElement()]));
  const calls = { saves: 0, renders: 0, defaults: 0 };
  bindCalendarEvents({
    el: { ...elements, navTabs: [] },
    state: { selectedDate: "2026-10-06" },
    addDays: (date) => date,
    confirmOffWithExistingCounts: () => true,
    confirmLeaveRecordDraft: () => true,
    defaultEntryRows: () => { calls.defaults += 1; throw new Error("must not seed after day-off reset"); },
    discardRecordDraft() {},
    getRecord: () => record,
    hasEnteredCounts: () => false,
    moveMonth() {},
    renderAll: () => { calls.renders += 1; },
    renderEntryForm() {},
    scheduleSave: () => { calls.saves += 1; },
    selectDate() {}, selectToday() {}, showView() {}, startRecordDraft() {},
    ...overrides,
  });
  return { el: elements, calls };
}

function recordHarness(record, overrides = {}) {
  const keys = [
    "offToggle", "addRoute", "freshCount", "freshUnit", "backupUnit", "freshSoloCount",
    "freshLinkedCount", "saveRecord", "saveRate", "rateRoute", "rateUnit",
  ];
  const el = Object.fromEntries(keys.map((key) => [key, new FakeElement()]));
  el.modeBtns = [];
  el.entryRows = { lastElementChild: null };
  const calls = { refresh: 0, renders: 0, defaults: 0 };
  bindRecordEvents({
    el,
    state: { selectedDate: "2026-10-06", rates: [], defaultRates: [], mode: "count" },
    confirmOffWithExistingCounts: () => true,
    currentRecordDraft: () => record,
    defaultEntryRows: () => { calls.defaults += 1; throw new Error("must not seed after day-off reset"); },
    ensurePendingSavesFlushed: async () => {},
    hasAutomaticEntries: () => false,
    hasEnteredCounts: () => false,
    isBackupDriver: () => true,
    refreshTotals: () => { calls.refresh += 1; },
    renderAll() {},
    renderEntryForm: () => { calls.renders += 1; },
    renderMonth() {}, saveCurrentRecordAndGoHome: async () => true, scheduleSave() {},
    syncFormToRecord: () => record, toast() {}, upsertRate: () => true,
    normalizeRoute: (value) => value, isKnownRateRoute: () => true, renderRates() {},
    ...overrides,
  });
  return { el, calls };
}

test("home day-off reset leaves backup route rows empty without calling the old 232C default", () => {
  const record = { off: true, rows: [] };
  const h = calendarHarness(record);
  h.el.homeOffToggle.fire("click");
  assert.deepEqual(record, { off: false, rows: [] });
  assert.deepEqual(h.calls, { saves: 1, renders: 1, defaults: 0 });
});

test("home day-off reset does not insert a configured fixed default route", () => {
  const record = { off: true, rows: [] };
  const h = calendarHarness(record, { defaultEntryRows: () => [{ route: "425B" }] });
  h.el.homeOffToggle.fire("click");
  assert.deepEqual(record.rows, []);
});

test("repeated home on/off changes never repopulate fixed routes", () => {
  const record = { off: true, rows: [] };
  const h = calendarHarness(record);
  h.el.homeOffToggle.fire("click");
  h.el.homeOffToggle.fire("click");
  h.el.homeOffToggle.fire("click");
  assert.equal(record.off, false);
  assert.deepEqual(record.rows, []);
  assert.equal(h.calls.saves, 3);
});

test("rejecting the existing-count confirmation preserves home state, rows, and save queue", () => {
  const rows = [{ route: "403C", count: 7, unit: 900 }];
  const record = { off: false, rows };
  const h = calendarHarness(record, {
    hasEnteredCounts: () => true,
    confirmOffWithExistingCounts: () => false,
  });
  h.el.homeOffToggle.fire("click");
  assert.equal(record.off, false);
  assert.equal(record.rows, rows);
  assert.equal(h.calls.saves, 0);
  assert.equal(h.calls.renders, 0);
});

test("rejecting an automatic-record confirmation also keeps the home receipt untouched", () => {
  const rows = [{ route: "410D", count: 11, source: "automatic", readOnly: true }];
  const record = { off: false, rows, automaticWorks: [{ workId: "synthetic-work" }] };
  const h = calendarHarness(record, {
    hasEnteredCounts: () => true,
    confirmOffWithExistingCounts: () => false,
  });
  h.el.homeOffToggle.fire("click");
  assert.equal(record.off, false);
  assert.equal(record.rows, rows);
  assert.equal(h.calls.saves, 0);
});

test("record editor day-off reset keeps rows empty and rerenders without a default lookup", () => {
  const record = { off: true, rows: [] };
  const h = recordHarness(record);
  h.el.offToggle.checked = false;
  h.el.offToggle.fire("change");
  assert.deepEqual(record, { off: false, rows: [] });
  assert.deepEqual(h.calls, { refresh: 1, renders: 1, defaults: 0 });
});

test("record editor can repeat on/off without restoring account defaults", () => {
  const record = { off: true, rows: [] };
  const h = recordHarness(record);
  for (const checked of [false, true, false]) {
    h.el.offToggle.checked = checked;
    h.el.offToggle.fire("change");
  }
  assert.equal(record.off, false);
  assert.deepEqual(record.rows, []);
  assert.equal(h.calls.renders, 3);
});

test("record editor cancellation restores the checkbox and preserves counted rows", () => {
  const rows = [{ route: "304A", count: 4, unit: 850 }];
  const record = { off: false, rows };
  const h = recordHarness(record, {
    hasEnteredCounts: () => true,
    confirmOffWithExistingCounts: () => false,
  });
  h.el.offToggle.checked = true;
  h.el.offToggle.fire("change");
  assert.equal(h.el.offToggle.checked, false);
  assert.equal(record.off, false);
  assert.equal(record.rows, rows);
  assert.deepEqual(h.calls, { refresh: 0, renders: 0, defaults: 0 });
});

function extractFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}()`);
  const paramsStart = main.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < main.length; index += 1) {
    if (main[index] === "(") paramsDepth += 1;
    if (main[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) { paramsEnd = index; break; }
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

function loadEntriesFromDb() {
  const context = vm.createContext({
    DEFAULT_BACKUP_UNIT: 30,
    emptyRecord: () => ({ off: false, rows: [], automaticWorks: [] }),
    exactLedgerInteger: (value) => Number(value),
    hasAutomaticEntries: (record) => Boolean(record.automaticWorks?.length),
    isBackupDriver: () => false,
    normalizeRecordShape: (record) => ({ automaticWorks: [], ...record, rows: [...(record.rows || [])] }),
    salesDayEditableValues: () => ({}),
    splitStoredRoutes: (route) => route ? [route] : [],
    toNum: (value) => Number(value) || 0,
    workLedgerKey: (user, work) => `${user}:${work}`,
  });
  vm.runInContext(`${extractFunction("entriesFromDb")}\nglobalThis.actual = entriesFromDb;`, context);
  return context.actual;
}

test("DB reconstruction keeps a fixed driver's persisted empty workday empty", () => {
  const entries = loadEntriesFromDb()([{
    work_date: "2026-10-06", is_off: false, driver_type: "fixed",
  }], []);
  assert.equal(entries["2026-10-06"].off, false);
  assert.deepEqual([...entries["2026-10-06"].rows], []);
});

test("DB reconstruction still preserves explicit route quantity and unit snapshots", () => {
  const entries = loadEntriesFromDb()([{
    work_date: "2026-10-06", is_off: false, driver_type: "fixed",
  }], [{
    work_date: "2026-10-06", route: "403C", delivery_count: 23,
    household_count: 9, unit_snapshot: 910,
  }]);
  assert.deepEqual({ ...entries["2026-10-06"].rows[0] }, {
    route: "403C", count: 23, households: 9, unit: 910,
  });
});

test("first draft seeding happens once and its seeded rows are included in the clean baseline", () => {
  const start = extractFunction("startRecordDraft");
  assert.match(start, /defaultEntryRows/);
  assert.doesNotMatch(readFileSync(new URL("../src/ui/calendar.js", import.meta.url), "utf8"), /defaultEntryRows\(\)/);
  assert.doesNotMatch(readFileSync(new URL("../src/ui/record.js", import.meta.url), "utf8"), /defaultEntryRows\(\)/);

  const state = {
    selectedDate: "2026-10-07", entries: {}, recordDraft: null,
    automaticSalesOverrides: {}, recordDraftBaseline: "dirty",
  };
  const context = vm.createContext({
    state,
    cloneRecord: (record) => structuredClone(record),
    defaultEntryRows: () => [{ route: "403C", count: "", unit: 910 }],
    getRecord: () => ({ off: false, rows: [], automaticWorks: [] }),
    hasAutomaticEntries: () => false,
    hasAutomaticSalesOverride: () => false,
    normalizeRecordDraftForCompare: (record) => record,
    seedSalesOverrideRows: () => ({ rows: [] }),
  });
  vm.runInContext(`${start}\nglobalThis.actual = startRecordDraft;`, context);
  const draft = context.actual();
  assert.deepEqual(draft.rows.map((row) => ({ ...row })), [{ route: "403C", count: "", unit: 910 }]);
  assert.equal(state.recordDraftBaseline, JSON.stringify(draft));

  state.selectedDate = "2026-10-08";
  state.entries[state.selectedDate] = { off: false, rows: [] };
  assert.deepEqual(context.actual().rows, [], "an existing empty workday must not be seeded on a later render");
});
