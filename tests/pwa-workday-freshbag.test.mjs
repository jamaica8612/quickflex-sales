import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { measurementWorkDateForClock } from "../src/lib/work-date.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const syncMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start < 0) start = source.indexOf(syncMarker);
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

test("measurement work date follows the noon night boundary and calendar rollover", () => {
  for (const [hour, minute, expected] of [
    [0, 0, "2026-09-09"],
    [7, 0, "2026-09-09"],
    [11, 59, "2026-09-09"],
    [12, 0, "2026-09-10"],
    [21, 0, "2026-09-10"],
  ]) {
    const now = new Date(2026, 8, 9, hour, minute);
    assert.equal(measurementWorkDateForClock(now, "night"), expected);
    assert.equal(measurementWorkDateForClock(now, "day"), "2026-09-09");
  }
  assert.equal(measurementWorkDateForClock(new Date(2026, 8, 30, 12), "night"), "2026-10-01");
  assert.equal(measurementWorkDateForClock(new Date(2026, 11, 31, 12), "night"), "2027-01-01");
});

test("automatic measurement date ignores calendar selection while a manual measurement date survives refresh", () => {
  const context = vm.createContext({
    state: { selectedDate: "2026-08-01", measurementDate: "stale", measurementDateAuto: true },
    isNightShift: () => true,
    measurementWorkDateForClock,
    todayKey: () => "2026-09-09",
    el: { measurementWorkDate: {}, measurementRouteText: {}, measurementRouteHint: {}, measurementScheduleMeta: {}, openPaceApp: {} },
    getRecord: () => ({ off: false, rows: [] }),
    hasAutomaticEntries: () => false,
    formatMonthDay: (key) => key,
  });
  vm.runInContext(["defaultMeasurementWorkDate", "currentMeasurementWorkDate", "renderMeasurementBridge"].map(extractFunction).join("\n"), context);
  assert.equal(context.currentMeasurementWorkDate(new Date(2026, 8, 9, 11, 59)), "2026-09-09");
  assert.equal(context.currentMeasurementWorkDate(new Date(2026, 8, 9, 12, 0)), "2026-09-10");

  context.state.measurementDate = "2026-09-08";
  context.state.measurementDateAuto = false;
  context.renderMeasurementBridge();
  assert.equal(context.el.measurementWorkDate.value, "2026-09-08");
  assert.equal(context.state.measurementDate, "2026-09-08");
});

test("native measurement bridge receives the exact manually requested work date", async () => {
  const messages = [];
  const session = {
    user: { id: "owner-1", email: "jamaica8612@gmail.com" },
    access_token: "access",
    refresh_token: "refresh",
    expires_at: 123,
  };
  const context = vm.createContext({
    state: {
      measurementDate: "2026-09-08",
      measurementDateAuto: false,
      session,
      profile: null,
      db: { auth: { getSession: async () => ({ data: { session }, error: null }) } },
    },
    window: { QuickFlexNative: { postMessage() {} }, location: {} },
    authEventEpoch: 3,
    currentMeasurementWorkDate: () => "2026-09-08",
    getRecord: () => ({ off: false }),
    isNightShift: () => true,
    captureAccountContext: () => ({ userId: "owner-1" }),
    isAccountContextCurrent: () => true,
    sessionUserId: (value) => value?.user?.id || "",
    applyAuthSession() {},
    postNativeMessage: (message) => messages.push(message),
    allocateNativeSessionRevision: () => 9,
    toast() {},
    encodeURIComponent,
  });
  vm.runInContext(`${extractFunction("openPaceMeasurementApp")}; globalThis.openPaceMeasurementApp = openPaceMeasurementApp;`, context);

  await context.openPaceMeasurementApp();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "open_measurement");
  assert.equal(messages[0].workDate, "2026-09-08");
  assert.equal(messages[0].workShift, "night");
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
