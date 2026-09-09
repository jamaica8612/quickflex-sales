import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test("night measurement defaults to next date and day keeps selected date", () => {
  const context = vm.createContext({
    addDays: (dateKey, amount) => {
      const date = new Date(`${dateKey}T12:00:00`);
      date.setDate(date.getDate() + amount);
      return date.toISOString().slice(0, 10);
    },
  });
  vm.runInContext(`${extractFunction("measurementWorkDateForShift")}; globalThis.actual = measurementWorkDateForShift;`, context);
  assert.equal(context.actual("2026-09-09", "night"), "2026-09-10");
  assert.equal(context.actual("2026-09-09", "day"), "2026-09-09");
  assert.equal(context.actual("2026-09-30", "night"), "2026-10-01");
  assert.equal(context.actual("2026-12-31", "night"), "2027-01-01");
  assert.equal(context.actual("2026-09-03", "day"), "2026-09-03");
});

test("entry defaults do not depend on the clock and a manually edited measurement date survives refresh", () => {
  const context = vm.createContext({
    state: { selectedDate: "2026-09-09", measurementDate: "2026-09-08", measurementDateAuto: false },
    isNightShift: () => true,
    toDateKey: () => "2026-09-09",
    addDays: (key, days) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10),
    el: { measurementWorkDate: {}, measurementRouteText: {}, measurementRouteHint: {}, measurementScheduleMeta: {}, openPaceApp: {} },
    getRecord: () => ({ off: false, rows: [] }),
    hasAutomaticEntries: () => false,
    formatMonthDay: (key) => key,
  });
  vm.runInContext(["measurementWorkDateForShift", "defaultMeasurementWorkDate", "renderMeasurementBridge"].map(extractFunction).join("\n"), context);
  for (const hour of [0, 6, 7, 23]) {
    assert.equal(context.defaultMeasurementWorkDate(new Date(2026, 8, 9, hour)), "2026-09-10");
  }
  context.renderMeasurementBridge();
  assert.equal(context.el.measurementWorkDate.value, "2026-09-08");
  assert.equal(context.state.measurementDate, "2026-09-08");
});

test("fresh-bag revenue follows the saved day mode instead of the current profile mode", () => {
  const context = vm.createContext({
    DEFAULT_BACKUP_UNIT: 30,
    freshbagMode: () => "single",
    normalizeRecordShape: (record) => record,
    toNum: (value) => Number(value) || 0,
    sharedRateForRoutes: () => 0,
    rateFor: () => 0,
  });
  const names = ["defaultFreshUnit", "defaultBackupUnit", "freshbagModeForRecord", "isAutomaticRow", "effectiveUnit", "calcRecordDetails"];
  vm.runInContext(`${names.map(extractFunction).join("\n")}; globalThis.actual = { ${names.join(",")} };`, context);

  const dualDay = context.actual.calcRecordDetails({
    off: false,
    rows: [],
    freshbagMode: "dual",
    freshCount: 99,
    freshSoloCount: 2,
    freshLinkedCount: 3,
    freshUnit: 100,
    backupUnit: 0,
    driverType: "fixed",
  });
  assert.equal(dualDay.freshCount, 5);
  assert.equal(dualDay.freshRevenue, 700);

  context.freshbagMode = () => "dual";
  const singleDay = context.actual.calcRecordDetails({
    off: false,
    rows: [],
    freshbagMode: "single",
    freshCount: 4,
    freshSoloCount: 9,
    freshLinkedCount: 9,
    freshUnit: 100,
    backupUnit: 0,
    driverType: "fixed",
  });
  assert.equal(singleDay.freshCount, 4);
  assert.equal(singleDay.freshRevenue, 400);
});
