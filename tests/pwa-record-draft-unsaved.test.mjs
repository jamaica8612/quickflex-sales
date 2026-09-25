import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Regression coverage for the false "unsaved changes" prompt: opening a record
// with an automatic (Android measurement app) entry and pressing back without
// changing anything used to trigger confirmLeaveRecordDraft()'s discard prompt,
// because syncFormToRecord() writes input .value strings (e.g. freshUnit "100")
// back over numeric baseline fields (freshUnit 100), making a byte-for-byte
// JSON comparison see a "change" that never happened.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}()`);
  const next = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const end = Math.min(...[next, nextAsync, source.length].filter((value) => value > start));
  return source.slice(start, end);
}

function harness({ record, syncedFields, confirmResult = false }) {
  const state = {
    recordDraft: null,
    recordDraftDate: "",
    recordDraftBaseline: "",
    recordDraftSalesRequestId: "",
    recordDraftSalesPayload: "",
    selectedDate: "2026-09-26",
    entries: { "2026-09-26": record },
    automaticSalesOverrides: {},
  };
  const confirmCalls = [];
  const context = vm.createContext({
    state,
    toNum: (value) => Number(String(value ?? "").replace(/[^\d.-]/g, "")) || 0,
    getRecord: (dateKey) => state.entries[dateKey],
    cloneRecord: (rec) => JSON.parse(JSON.stringify(rec)),
    hasAutomaticEntries: (rec) => Boolean(rec?.automaticWorks?.length),
    hasAutomaticSalesOverride: () => false,
    seedSalesOverrideRows: () => ({ rows: record.rows }),
    el: { app: { dataset: { view: "record" } } },
    window: { confirm: (message) => { confirmCalls.push(message); return confirmResult; } },
    // Stands in for the real DOM round-trip performed by syncFormToRecord():
    // it writes form-input strings (produced from renderEntryForm) back onto
    // the same draft object that the baseline was captured from.
    syncFormToRecord: () => {
      Object.assign(state.recordDraft, syncedFields);
      return state.recordDraft;
    },
  });
  const names = ["normalizeRecordDraftForCompare", "startRecordDraft", "confirmLeaveRecordDraft"];
  vm.runInContext(`${names.map(declaration).join("\n")}\nglobalThis.actual = {${names.join(",")}};`, context);
  return { ...context.actual, state, confirmCalls };
}

test("an untouched automatic record does not trigger the discard prompt", () => {
  const record = {
    off: false,
    rows: [],
    automaticWorks: [{ workId: "w1" }],
    freshCount: 0,
    freshUnit: 100,
    freshSoloCount: 0,
    freshLinkedCount: 0,
    backupUnit: 30,
    returnCount: 0,
    cancellationCount: 0,
  };
  // Mirrors what renderEntryForm()/syncFormToRecord() actually produce for an
  // untouched draft: falsy numeric fields become "" via `value || ""`, and
  // defaultFreshUnit's fallback becomes the input's string value.
  const { startRecordDraft, confirmLeaveRecordDraft, confirmCalls } = harness({
    record,
    syncedFields: { freshCount: "", freshUnit: "100", freshSoloCount: "", freshLinkedCount: "", backupUnit: 30 },
  });
  startRecordDraft("2026-09-26");
  assert.equal(confirmLeaveRecordDraft(), true);
  assert.equal(confirmCalls.length, 0, "must not prompt when nothing actually changed");
});

test("a real edit on the same record still triggers the discard prompt", () => {
  const record = {
    off: false,
    rows: [],
    automaticWorks: [{ workId: "w1" }],
    freshCount: 0,
    freshUnit: 100,
    freshSoloCount: 0,
    freshLinkedCount: 0,
    backupUnit: 30,
    returnCount: 0,
    cancellationCount: 0,
  };
  const { startRecordDraft, confirmLeaveRecordDraft, confirmCalls } = harness({
    record,
    syncedFields: { freshCount: "5", freshUnit: "100", freshSoloCount: "", freshLinkedCount: "", backupUnit: 30 },
    confirmResult: true,
  });
  startRecordDraft("2026-09-26");
  assert.equal(confirmLeaveRecordDraft(), true, "confirm() result must still be honored");
  assert.equal(confirmCalls.length, 1, "must prompt when freshCount actually changed");
});

test("normalizeRecordDraftForCompare treats numeric and numeric-string fields as equal", () => {
  const { normalizeRecordDraftForCompare } = harness({ record: { rows: [] }, syncedFields: {} });
  const numeric = { freshCount: 0, freshUnit: 100, freshSoloCount: 0, freshLinkedCount: 0, backupUnit: 30, rows: [{ route: "A", count: 3, unit: 800, households: 2 }] };
  const stringy = { freshCount: "", freshUnit: "100", freshSoloCount: "", freshLinkedCount: "", backupUnit: "30", rows: [{ route: "A", count: "3", unit: "800", households: "2" }] };
  assert.equal(JSON.stringify(normalizeRecordDraftForCompare(numeric)), JSON.stringify(normalizeRecordDraftForCompare(stringy)));
  const changed = { ...stringy, freshCount: "5" };
  assert.notEqual(JSON.stringify(normalizeRecordDraftForCompare(numeric)), JSON.stringify(normalizeRecordDraftForCompare(changed)));
});
