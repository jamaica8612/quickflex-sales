import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Regression coverage: 배송노트 (measurement bridge) used to always say
// "M/D 업무로 시작" even when the selected date is a day off, so a holiday
// like 추석 read as "start work on 9/26" with "휴무" printed right under it.
// renderMeasurementBridge() must switch the headline and hint copy when the
// record for the selected work date is off.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function extractSnippet() {
  const start = source.indexOf("function renderMeasurementBridge(");
  assert.notEqual(start, -1, "missing renderMeasurementBridge()");
  const end = source.indexOf("\nasync function refreshMeasurementAppAvailability(", start);
  assert.notEqual(end, -1, "missing refreshMeasurementAppAvailability() boundary");
  return source.slice(start, end);
}

function harness({ off, rows = [], automaticWorks = [], workDate = "2026-09-26" }) {
  const record = { off, rows, automaticWorks };
  const el = {
    measurementWorkDate: { value: "" },
    measurementRouteText: { textContent: "", toggleAttribute: () => {} },
    measurementScheduleMeta: { textContent: "" },
    measurementRouteHint: { textContent: "" },
    openPaceApp: { dataset: { launchMode: "installed" }, disabled: false, setAttribute() {}, removeAttribute() {} },
    openPaceAppFallback: { hidden: false },
  };
  const context = vm.createContext({
    el,
    navigator: { userAgent: "" },
    currentMeasurementWorkDate: () => workDate,
    getRecord: () => record,
    routeListFromText: (list) => list,
    splitStoredRoutes: (route) => (route ? [route] : []),
    toNum: (value) => Number(value) || 0,
    hasAutomaticEntries: (rec) => Boolean(rec?.automaticWorks?.length),
    isNightShift: () => false,
  });
  vm.runInContext(`${extractSnippet()}\nglobalThis.render = renderMeasurementBridge;`, context);
  context.render();
  return el;
}

test("a day-off date reads as a day off instead of inviting the driver to start work", () => {
  const el = harness({ off: true, workDate: "2026-09-26" });
  assert.equal(el.measurementScheduleMeta.textContent, "9/26은 휴무예요");
  assert.equal(el.measurementRouteText.textContent, "휴무");
  assert.match(el.measurementRouteHint.textContent, /다른 날짜/);
  assert.match(el.measurementRouteHint.textContent, /근무표 날짜/);
  assert.doesNotMatch(el.measurementScheduleMeta.textContent, /업무로 시작/);
});

test("a normal working day keeps the original start-of-work headline", () => {
  const el = harness({ off: false, rows: [{ route: "232C", households: 10 }], workDate: "2026-09-27" });
  assert.equal(el.measurementScheduleMeta.textContent, "9/27 업무로 시작");
  assert.doesNotMatch(el.measurementRouteHint.textContent, /다른 날짜/);
});

test("an automatic-entry day still shows the automatic hint, not the day-off hint", () => {
  const el = harness({ off: false, automaticWorks: [{ workId: "w1" }], rows: [{ route: "232C", households: 5 }] });
  assert.match(el.measurementRouteHint.textContent, /반영된 매출은 기록 화면에서 수정할 수 있습니다/);
});
