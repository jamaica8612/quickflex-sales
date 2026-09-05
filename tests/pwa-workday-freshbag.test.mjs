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

test("00:00 through 06:59 defaults today's measurement to the previous date", () => {
  const context = vm.createContext({
    addDays: (dateKey, amount) => {
      const date = new Date(`${dateKey}T12:00:00`);
      date.setDate(date.getDate() + amount);
      return date.toISOString().slice(0, 10);
    },
  });
  vm.runInContext(`${extractFunction("measurementWorkDateForClock")}; globalThis.actual = measurementWorkDateForClock;`, context);
  assert.equal(context.actual("2026-09-05", "2026-09-05", 0), "2026-09-04");
  assert.equal(context.actual("2026-09-05", "2026-09-05", 6), "2026-09-04");
  assert.equal(context.actual("2026-09-05", "2026-09-05", 7), "2026-09-05");
  assert.equal(context.actual("2026-09-03", "2026-09-05", 2), "2026-09-03", "a manually selected date stays unchanged");
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
